/* Activity log - SCRIBE (phase L3). Runs on the active GM client only: post-update hooks -> drafts -> absorb / coalesce / bulk / throttle -> entries -> store.commit.
   It never writes to the logged actor (no loops) and ignores log documents. Attribution = the server-attested userId of the hook; time = options.modifiedTime
   (identical on every client, so two scribe tabs of one GM produce the same deterministic ids). Spec 3.3, 3.4. */
import * as E from "./events.mjs";
import * as M from "./model.mjs";
import * as D from "./diff.mjs";
import * as CO from "./coalesce.mjs";
import * as C from "./capture-pure.mjs";
import * as Store from "./store.mjs";

const MOD = E.MOD_ID;
const LOG = `${MOD} | log |`;
const HOLD = ["item.", "stat.", "team.", "member.", "upgrade.", "crate.", "card."];   // may be absorbed by an explicit parent record: held for the absorb window
const KEEP_RECENT_MS = 60000;
const RUN_HOLD_MS = 20000;

const S = {
  on: false, hooked: false, states: new Map(), snaps: new Map(),
  co: new CO.Coalescer(), ab: new CO.AbsorbBuffer(), thr: new CO.Throttle(), edits: new C.EditBuffer(),
  direct: [], rolls: new Map(), runHold: new Map(), recent: new Map(), init: new Map(),
  dirty: new Set(), timer: 0, chain: Promise.resolve(), skew: 0, lease: true, reconcileTimers: new Map(), cid: Math.random().toString(36).slice(2, 10),
  counts: { hooks: 0, drafts: 0, entries: 0, batches: 0, dropped: 0, failures: 0, gaps: 0, starts: 0 }
};
export const state = S;
export const isScribe = () => S.on;

/* ------------------------------------------------------------------ eligibility */
export function isBaseCard(a) { return a?.flags?.[MOD]?.base?.kind === "teamBase"; }
export function scopeOf(actor, ignoreScope = false) {
  if (!actor || actor.documentName !== "Actor" || actor.isToken) return null;
  if (!Store.enabled()) return null;
  let scope = null;
  if (isBaseCard(actor)) scope = "base";
  else if (E.POLICY.actorTypes.includes(actor.type) || (Store.setting("logActorTypes", "superhero") || "superhero").split(",").includes(actor.type)) scope = "hero";
  if (!scope) return null;
  const lim = Store.scopeIds();
  if (!ignoreScope && lim && !lim.includes(actor.id)) return null;
  return scope;
}
const userName = (id) => game.users.get(id)?.name ?? "";
const timeOf = (options, doc) => {
  const mt = options?.modifiedTime ?? doc?._stats?.modifiedTime;
  if (Number.isFinite(mt)) { S.skew = Math.max(-5000, Math.min(60000, Date.now() - mt)); return mt; }
  return Date.now() - S.skew;
};
const nowT = () => Date.now() - S.skew;

function ctxOf(actor) {
  try {
    const has = (c) => c?.started && c.combatants.some((x) => x.actorId === actor.id);
    const cb = has(game.combat) ? game.combat : game.combats.find(has);
    if (!cb) return undefined;
    return { i: cb.id, r: cb.round, tn: cb.turn };
  } catch { return undefined; }
}

/* ------------------------------------------------------------------ states */
function resolver(actor) { return (id) => actor.items.get(id)?.name ?? id; }
function itemSnaps(actor) {
  const out = {};
  for (const i of actor.items) {
    out[i.id] = D.itemSnap({ type: i.type, name: i.name, level: i._source.system?.level || undefined, active: i.system?.active === true, powerSource: i._source.system?.powerSource || "" }, resolver(actor));
  }
  return out;
}
function buildState(actor, scope) {
  const st = { actorId: actor.id, scope, prev: C.actorMirror(actor._source, scope), items: new Map() };
  if (scope === "hero") for (const i of actor.items) st.items.set(i.id, { m: C.itemMirror(i._source, resolver(actor)), created: 0 });
  return st;
}
const snapNow = (actor, scope) => D.makeSnapshot(C.snapshotSource(actor._source, scope, scope === "hero" ? itemSnaps(actor) : {}), Date.now());

/* ------------------------------------------------------------------ emit / pipeline */
function emit(actor, draft) {
  const st = S.states.get(actor.id);
  if (!st) return;
  if (!Store.setting("logCombat", true) && draft.k.startsWith("combat.")) return;
  if (E.typeDef(draft.k)?.minor && Store.policy().minorRecorded === false) return;
  draft.actorId = actor.id;
  if (draft.c === undefined) { const c = ctxOf(actor); if (c) draft.c = c; }
  if (!E.inScope(draft.k, st.scope)) return;
  S.counts.drafts++;
  if (HOLD.some((p) => draft.k.startsWith(p))) S.ab.push(draft, Date.now()); else S.co.add(draft);
  arm();
}
function arm(ms = 450) { if (!S.timer && S.on) S.timer = setTimeout(() => { S.timer = 0; tick(); }, ms); }
const pending = () => S.co.open + S.ab.pending + S.edits.open.size + S.direct.length + S.runHold.size;
const pendingFor = (actorId) => [...S.co.pending.values()].some((l) => l[0]?.actorId === actorId) || S.co.passthrough.some((d) => d.actorId === actorId) || S.ab.held.some((h) => h.draft.actorId === actorId) || S.ab.ready.some((d) => d.actorId === actorId) || [...S.edits.open.keys()].some((k) => k.startsWith(actorId)) || S.direct.some((e) => e.actorId === actorId) || S.runHold.has(actorId);

export function tick(force = false) {
  if (!S.on) return;
  const now = Date.now();
  const tNow = now - S.skew;
  // expired chargen holds: emit the items normally
  for (const [aid, h] of [...S.runHold]) {
    if (force || now - h.since > RUN_HOLD_MS) { S.runHold.delete(aid); const a = game.actors.get(aid); if (a) for (const dr of h.adds) emit(a, dr.draft); }
  }
  for (const ed of S.edits.drain(tNow, force)) {
    const [aid, iid, u] = ed.key.split("|");
    const a = game.actors.get(aid); if (!a) continue;
    const it = a.items.get(iid);
    S.co.add({ actorId: aid, k: "item.edit", path: `item:${iid}`, u, t: ed.t, t2: ed.t2, d: { id: iid, name: it?.name ?? ed.base.name, type: it?.type ?? ed.base.type, changes: ed.changes }, ...(ctxOf(a) ? { c: ctxOf(a) } : {}) });
  }
  for (const d of S.ab.drain(tNow, { force })) S.co.add(d);
  let out = CO.collapseBulk(S.co.drain(tNow, { force }));
  const byActor = new Map();
  const put = (e, extra) => { const g = byActor.get(e.actorId) ?? { pub: [], sec: [], patches: [] }; byActor.set(e.actorId, g); (e.v ? g.sec : g.pub).push(e); if (extra) extra(g); };
  for (const dr of out) {
    const st = S.states.get(dr.actorId); if (!st) continue;
    const verdict = S.thr.admit(dr.actorId, now);
    if (verdict === "drop") { S.counts.dropped++; continue; }
    const e = CO.finalizeDraft(dr, { actorId: dr.actorId });
    if (!e) continue;
    const v = M.validateEntry(e, st.scope);
    if (!v.ok) { console.warn(`${LOG} entry refused`, dr.k, v.errors); continue; }
    put({ ...e, actorId: dr.actorId });
    if (verdict === "trip") {
      const tm = CO.finalizeDraft({ actorId: dr.actorId, k: "log.throttle", path: "throttle", u: "", t: dr.t + 1, d: { n: CO.TIMING.throttleMax } }, { actorId: dr.actorId });
      if (tm) put({ ...tm, actorId: dr.actorId });
    }
  }
  for (const e of S.direct.splice(0)) { const st = S.states.get(e.actorId); if (st) put(e); }
  for (const [actorId, g] of byActor) {
    explain(actorId, g);
    S.counts.entries += g.pub.length + g.sec.length;
    for (const e of [...g.pub, ...g.sec]) delete e.actorId;
    S.chain = S.chain.then(() => write(actorId, g, 0));
  }
  for (const id of [...S.dirty]) {
    if (pendingFor(id)) continue;
    S.dirty.delete(id);
    const a = game.actors.get(id), st = S.states.get(id);
    if (a && st) S.chain = S.chain.then(() => persistSnapshot(a, st.scope)).catch((e) => console.warn(`${LOG} snapshot failed`, e));
  }
  if (pending() > 0 || S.dirty.size) arm(force ? 100 : 450);
}

/** cross-entry explanations (spec 2.3) against the batch and the recently flushed entries of the same actor */
function explain(actorId, g) {
  const now = Date.now();
  const rec = (S.recent.get(actorId) ?? []).filter((e) => now - (e._at || 0) < KEEP_RECENT_MS);
  const all = [...rec.map((e) => e), ...g.pub, ...g.sec];
  const patches = [...CO.explainPatches(all), ...undoPatches(all)];
  const inBatch = new Map([...g.pub, ...g.sec].map((e) => [e.id, e]));
  const seen = new Set();
  for (const p of patches) {
    if (seen.has(p.id)) continue; seen.add(p.id);
    if (inBatch.has(p.id)) {
      const e = inBatch.get(p.id), np = M.patchEntry(e, p.patch);
      const list = e.v ? g.sec : g.pub; list[list.indexOf(e)] = np;
    } else {
      const old = rec.find((x) => x.id === p.id);
      if (old) { const np = M.patchEntry(old, p.patch); delete np._at; delete np.actorId; g.patches.push({ entry: np, secret: !!old.v }); Object.assign(old, np); }
    }
  }
  const keep = [...g.pub, ...g.sec].filter((e) => ["stat.vital", "damage.taken", "damage.undone", "roll.made"].includes(e.k)).map((e) => ({ ...e, _at: now }));
  S.recent.set(actorId, [...rec, ...keep].slice(-60));
}
/** a vital change that restores what a damage.undone says is explained by it */
function undoPatches(all) {
  const out = [];
  for (const u of all.filter((e) => e.k === "damage.undone")) {
    for (const v of all) {
      if (v.k !== "stat.vital" || v.g || v.d.key !== "health") continue;
      if (v.d.to - v.d.from === u.d.to - u.d.from && Math.abs(v.t - u.t) <= CO.TIMING.explainDamageMs) out.push({ id: v.id, patch: { h: 1, g: u.id, d: { cause: "undo" } } });
    }
  }
  return out;
}

const RETRY = [2000, 5000, 15000];
async function write(actorId, g, attempt) {
  const actor = game.actors.get(actorId);
  const st = S.states.get(actorId);
  if (!actor || !st) return;
  try {
    S.counts.batches++;
    await Store.commit(actor, st.scope, g);
    await Store.pruneIfNeeded(actor, st.scope);
    await persistSnapshot(actor, st.scope);
    for (const e of [...g.pub, ...g.sec]) { try { Hooks.callAll(`${MOD}.logEntry`, { actorId, entry: e }); } catch { /* listener */ } }
  } catch (err) {
    S.counts.failures++; Store.stats.failures++;
    if (attempt < RETRY.length) {
      console.warn(`${LOG} write failed, retry ${attempt + 1}`, err);
      await new Promise((r) => setTimeout(r, RETRY[attempt]));
      return write(actorId, g, attempt + 1);
    }
    console.warn(`${LOG} write dropped after ${RETRY.length} retries (a log.gap is written on the next scribe start)`, err);
  }
}
async function persistSnapshot(actor, scope) {
  if (pendingFor(actor.id)) { S.dirty.add(actor.id); arm(); return; }
  const cur = snapNow(actor, scope);
  const prev = S.snaps.get(actor.id) ?? {};
  const ops = C.snapOps(prev, cur);
  if (!Object.keys(ops.set).some((k) => k !== "at") && !ops.del.length) return;
  await Store.writeSnapshot(actor.id, ops);
  S.snaps.set(actor.id, cur);
}

/* ------------------------------------------------------------------ catch-up / baseline */
async function baselineActor(actor, scope) {
  const st = buildState(actor, scope);
  S.states.set(actor.id, st);
  const had = Store.actorJournal(actor.id);
  const snap = Store.loadSnapshot(actor.id);
  const cur = snapNow(actor, scope);
  if (!had || !snap) {
    const r = await Store.ensureJournal(actor, scope);
    if (r.created || !snap) {
      const e = [];
      if (r.created) { S.counts.starts++; e.push(M.normalizeEntry({ t: actor._stats?.createdTime ?? Date.now(), u: actor._stats?.lastModifiedBy ?? "", k: "log.start", d: { baseline: true } }, { actorId: actor.id, path: "start" })); }
      await Store.commit(actor, scope, { pub: e.filter(Boolean) });
    }
    await Store.writeSnapshot(actor.id, C.snapOps({}, cur));
    S.snaps.set(actor.id, cur);
    return;
  }
  S.snaps.set(actor.id, snap);
  const diffs = D.diffSnapshots(snap, cur);
  if (diffs.length) {
    const g = D.gapChildren(diffs, 30);
    const t = actor._stats?.modifiedTime ?? Date.now();
    const e = M.normalizeEntry({ t, u: actor._stats?.lastModifiedBy ?? "", k: "log.gap", a: 1, d: { from: snap.at ?? 0, to: Date.now(), changes: g.kids, more: g.more, total: g.total } }, { actorId: actor.id, path: "gap" });
    S.counts.gaps++;
    await Store.commit(actor, scope, { pub: [e] });
    const ops = C.snapOps(snap, cur);
    await Store.writeSnapshot(actor.id, ops);
    S.snaps.set(actor.id, cur);
  }
}
export async function catchUp() {
  for (const j of game.journal.contents.filter((x) => x.flags?.[MOD]?.log?.kind === "actor")) {
    const aid = j.flags[MOD].log.actorId;
    if (!game.actors.get(aid) && !j.flags[MOD].log.deletedAt && (!Store.scopeIds() || Store.scopeIds().includes(aid))) {
      const stat = j.flags[MOD].log.type === "base" ? "base" : "hero";
      await Store.commit({ id: aid, name: j.flags[MOD].log.name, uuid: j.flags[MOD].log.actorUuid }, stat, { pub: [M.normalizeEntry({ t: Date.now(), u: "", k: stat === "base" ? "base.deleted" : "actor.deleted", a: 1, d: { name: j.flags[MOD].log.name || "" } }, { actorId: aid, path: "gone" })] });
      await Store.flagJournal(aid, { deletedAt: Date.now() });
    }
  }
  for (const a of game.actors) {
    const scope = scopeOf(a);
    if (!scope) continue;
    try { await baselineActor(a, scope); await Store.reconcile(a); }
    catch (err) { console.warn(`${LOG} catch-up failed for ${a.name}`, err); }
  }
}
/** after the scope setting / enabled flag changed: baseline newly eligible actors, forget the others */
export async function rescan() {
  if (!S.on) return;
  for (const [id] of [...S.states]) { const a = game.actors.get(id); if (!a || !scopeOf(a)) { await flushActor(id); S.states.delete(id); } }
  for (const a of game.actors) { const scope = scopeOf(a); if (scope && !S.states.has(a.id)) { try { await baselineActor(a, scope); await Store.reconcile(a); } catch (e) { console.warn(`${LOG} baseline failed`, e); } } }
}
async function flushActor(id) { void id; tick(true); await S.chain; }

/* ------------------------------------------------------------------ hooks */
const guard = (name, fn) => (...args) => { if (!S.on) return; S.counts.hooks++; try { return fn(...args); } catch (err) { console.warn(`${LOG} ${name} capture failed`, err); } };
const actorOfDoc = (doc) => { const p = doc?.parent; if (p?.documentName === "Actor") return p; return null; };
const elig = (actor) => (actor && S.states.has(actor.id) ? S.states.get(actor.id) : null);

const onUpdateActor = guard("updateActor", (actor, changes, options, userId) => {
  const scope = scopeOf(actor);
  if (!scope) return;
  const st = S.states.get(actor.id);
  if (!st) { S.states.set(actor.id, buildState(actor, scope)); return; }
  const before = st.prev, after = C.actorMirror(actor._source, scope);
  st.prev = after;
  const diffs = D.diffFlat(before, after);
  if (!diffs.length) return;
  const t = timeOf(options, actor), u = userId ?? "";
  if (diffs.some((c) => c.p.startsWith("ownership"))) scheduleReconcile(actor);
  const bk = diffs.find((c) => c.p === "__chargen.backup");
  const drafts = D.draftsFromDiff(diffs.filter((c) => !c.p.startsWith("__chargen")), { scope, before, after, ipbSync: !!options?.ipbSync, nameOf: (id) => game.actors.get(id)?.name ?? "" });
  for (const dr of drafts) if (dr.k === "access.owner") dr.d.name = userName(dr.d.user);
  const cgFlag = actor.flags?.[MOD]?.chargen;
  const runBefore = before["__chargen.runId"];
  if (bk && bk.to === true && scope === "hero") {          // chargen apply: ONE summary entry, children absorbed
    const hold = S.runHold.get(actor.id); S.runHold.delete(actor.id);
    const add = (hold?.adds ?? []).map((x) => ({ t: x.draft.d.type, n: x.draft.d.name, ...(x.draft.d.level ? { l: x.draft.d.level } : {}) }));
    const now = Date.now();
    const dels = S.ab.held.filter((h) => h.draft.actorId === actor.id && h.draft.k === "item.remove" && now - h.at <= 6000).map((h) => ({ t: h.draft.d.type, n: h.draft.d.name }));
    const fields = drafts.filter((x) => !x.k.startsWith("team.") && !x.k.startsWith("access.")).map((x) => x.path).slice(0, 30);
    const d = { runId: cgFlag?.runId ?? "", rank: cgFlag?.rank ?? undefined, archetype: cgFlag?.archetype ?? undefined, mode: cgFlag?.mode ?? "manual", add: add.slice(0, 40), del: dels.slice(0, 40), more: { add: Math.max(0, add.length - 40), del: Math.max(0, dels.length - 40) }, fields, destructive: dels.length > 0 };
    S.ab.parent({ actorId: actor.id, k: "chargen.apply", path: d.runId, u: cgFlag?.appliedBy || u, t, d, ...(ctxOf(actor) ? { c: ctxOf(actor) } : {}), absorb: { actors: [actor.id], types: ["item.", "stat.", "team."], ms: 6000 } }, now);
    for (const dr of drafts) if (dr.k.startsWith("team.") || dr.k.startsWith("access.")) pushDraft(actor, dr, u, t);
    arm(); return;
  }
  if (bk && bk.to === false && scope === "hero") {         // chargen undo
    S.ab.parent({ actorId: actor.id, k: "chargen.undo", path: String(runBefore || ""), u, t, d: { runId: String(runBefore || "") }, absorb: { actors: [actor.id], types: ["item.", "stat.", "team."], ms: 6000 } }, Date.now());
    for (const dr of drafts) if (dr.k.startsWith("team.") || dr.k.startsWith("access.")) pushDraft(actor, dr, u, t);
    arm(); return;
  }
  for (const dr of drafts) pushDraft(actor, dr, u, t);
});
function pushDraft(actor, dr, u, t) {
  emit(actor, { ...dr, u, t });
  if ((dr.k === "team.join" || dr.k === "team.leave") && dr.d.baseId) {      // mirrored into the base's own log (member.add / member.remove)
    const base = game.actors.get(dr.d.baseId);
    if (base && S.states.has(base.id)) emit(base, { k: dr.k === "team.join" ? "member.add" : "member.remove", path: `member:${actor.id}`, u, t, d: { id: actor.id, name: M.clampText(actor.name, 120) }, actorId: base.id });
  }
}
function scheduleReconcile(actor) {
  clearTimeout(S.reconcileTimers.get(actor.id));
  S.reconcileTimers.set(actor.id, setTimeout(() => { Store.reconcile(actor).catch((e) => console.warn(`${LOG} reconcile failed`, e)); }, 600));
}

const onCreateItem = guard("createItem", (item, options, userId) => {
  const actor = actorOfDoc(item); const st = elig(actor);
  if (!st || st.scope !== "hero") return;
  const t = timeOf(options, item);
  st.items.set(item.id, { m: C.itemMirror(item._source, resolver(actor)), created: t });
  const d = { id: item.id, name: M.clampText(item.name, 120), type: item.type };
  const lvl = item._source.system?.level; if (lvl) d.level = String(lvl);
  const run = item.flags?.[MOD]?.chargenRun;
  if (run) d.src = "chargen"; else if (item._stats?.compendiumSource) d.src = "compendium";
  const draft = { k: "item.add", path: `item:${item.id}`, u: userId ?? "", t, d };
  if (run) { let h = S.runHold.get(actor.id); if (!h) { h = { runId: run, adds: [], since: Date.now() }; S.runHold.set(actor.id, h); } draft.actorId = actor.id; h.adds.push({ draft }); arm(1000); return; }
  emit(actor, draft);
});
const onDeleteItem = guard("deleteItem", (item, options, userId) => {
  const actor = actorOfDoc(item); const st = elig(actor);
  if (!st || st.scope !== "hero") return;
  st.items.delete(item.id);
  const d = { id: item.id, name: M.clampText(item.name, 120), type: item.type };
  const lvl = item._source.system?.level; if (lvl) d.level = String(lvl);
  emit(actor, { k: "item.remove", path: `item:${item.id}`, u: userId ?? "", t: timeOf(options, item), d });
});
const onUpdateItem = guard("updateItem", (item, changes, options, userId) => {
  const actor = actorOfDoc(item); const st = elig(actor);
  if (!st || st.scope !== "hero") return;
  const rec = st.items.get(item.id);
  const next = C.itemMirror(item._source, resolver(actor));
  st.items.set(item.id, { m: next, created: rec?.created ?? 0 });
  if (!rec) return;
  const t = timeOf(options, item);
  if (t - rec.created < 3000) return;                                // creation noise
  const ch = C.diffItemMirror(rec.m, next);
  if (!ch.length) return;
  S.edits.add(`${actor.id}|${item.id}|${userId ?? ""}`, { name: item.name, type: item.type }, ch, t);
  arm();
});

const ACTION_RE = /^(fastAction|slowAction|action[1-9])$/;
function effectEvent(kind, effect, changes, options, userId) {
  const parent = effect.parent;
  const t = timeOf(options, effect), u = userId ?? "";
  if (parent?.documentName === "Item") {
    const actor = actorOfDoc(parent); const st = elig(actor);
    if (!st || st.scope !== "hero") return;
    if (kind !== "update" || !("disabled" in (changes ?? {}))) return;
    const on = parent.effects.some((e) => !e.disabled);
    emit(actor, { k: "item.toggle", path: `toggle:${parent.id}`, u, t, d: { id: parent.id, name: M.clampText(parent.name, 120), type: parent.type, on } });
    return;
  }
  const actor = parent?.documentName === "Actor" ? parent : null; const st = elig(actor);
  if (!st || st.scope !== "hero") return;
  const statuses = [...(effect.statuses ?? [])];
  const act = statuses.find((s) => ACTION_RE.test(s));
  if (act) { if (kind !== "update") emit(actor, { k: "combat.action", path: `act:${act}`, u, t, d: { status: act, on: kind === "create" } }); return; }
  const base = { id: effect.id, name: M.clampText(effect.name ?? "", 120) };
  if (kind === "create") emit(actor, { k: "effect.add", path: `fx:${effect.id}`, u, t, d: { ...base, statuses } });
  else if (kind === "delete") emit(actor, { k: "effect.remove", path: `fx:${effect.id}`, u, t, d: { ...base, statuses } });
  else {
    const ch = []; if ("disabled" in (changes ?? {})) ch.push({ p: "disabled", from: !changes.disabled, to: !!changes.disabled });
    if (changes?.duration) ch.push({ p: "duration", from: null, to: JSON.stringify(changes.duration).slice(0, 80) });
    if (ch.length) emit(actor, { k: "effect.edit", path: `fx:${effect.id}`, u, t, d: { ...base, changes: ch } });
  }
}
const onFxCreate = guard("createActiveEffect", (e, o, u) => effectEvent("create", e, null, o, u));
const onFxUpdate = guard("updateActiveEffect", (e, c, o, u) => effectEvent("update", e, c, o, u));
const onFxDelete = guard("deleteActiveEffect", (e, o, u) => effectEvent("delete", e, null, o, u));

/* ---- chat: rolls, damage taken, undo */
const DAMAGE_FLAVOR = () => game.i18n.localize("INVINCIBLE.Chat.DamageInfo.DamageTaken");
const speakerActor = (m) => { try { return m.speakerActor ?? game.actors.get(m.speaker?.actor) ?? null; } catch { return null; } };
const isDamageCard = (m) => !!m?.flavor && m.flavor.trim() === DAMAGE_FLAVOR();
const onCreateMessage = guard("createChatMessage", (message, options, userId) => {
  const actor = speakerActor(message); const st = elig(actor);
  if (!st || st.scope !== "hero") return;
  const gmIds = game.users.filter((x) => x.isGM).map((x) => x.id);
  const author = message.author?.id ?? message.author ?? userId;
  const mode = C.rollModeOf({ whisper: message.whisper, blind: message.blind, author }, gmIds);
  if (mode === "self") return;                                       // the roller chose that nobody sees it
  const t = Number(message.timestamp) || Date.now();
  if (isDamageCard(message)) return damageTaken(actor, message, mode, t, userId);
  if (!message.rolls?.length) return;
  const roll = message.rolls[0], info = C.rollInfo(roll);
  const name = M.clampText(message.flavor || roll.options?.splash?.attribute || "", 80);
  const d = { msgId: message.id, name, mode, s: info.s, b: info.b, p: info.p, dice: info.dice };
  if (info.str) d.str = info.str; if (info.dmg) d.dmg = info.dmg;
  const key = `${actor.id}|${name}`;
  const prev = S.rolls.get(key);
  if (info.p > 0 && prev && prev.p === info.p - 1 && Date.now() - prev.at < 600000 && prev.mode === mode) {   // a push = delete + new message: patch the same entry
    const patched = CO.patchRoll({ ...prev.entry }, { s: info.s, b: info.b, dice: info.dice, dmg: info.dmg, str: info.str }, t);
    patched.d = { ...patched.d, msgId: message.id };
    prev.entry = patched; prev.p = info.p; prev.at = Date.now();
    const pending = S.direct.findIndex((x) => x.id === patched.id);
    if (pending >= 0) S.direct[pending] = { ...patched, actorId: actor.id };
    else queuePatch(actor, patched, mode !== "public");
    arm(); return;
  }
  const dr = { actorId: actor.id, k: "roll.made", path: message.id, u: userId ?? "", t, d, ...(ctxOf(actor) ? { c: ctxOf(actor) } : {}), ...(mode !== "public" ? { v: 1 } : {}) };
  const e = CO.finalizeDraft(dr, { actorId: actor.id });
  if (!e) return;
  S.rolls.set(key, { entry: e, p: info.p, at: Date.now(), mode });
  if (S.rolls.size > 200) S.rolls.delete(S.rolls.keys().next().value);
  S.direct.push({ ...e, actorId: actor.id }); S.counts.drafts++;
  arm();
});
function queuePatch(actor, entry, secret) {
  const st = S.states.get(actor.id);
  const e = { ...entry }; delete e.actorId;
  S.chain = S.chain.then(() => Store.commit(actor, st.scope, { patches: [{ entry: e, secret }] })).catch((err) => console.warn(`${LOG} patch failed`, err));
}
function damageTaken(actor, message, mode, t, userId) {
  const f = C.damageFacts(message.content);
  const dmg = message.flags?.[MOD]?.dmg ?? {};
  const d = { msgId: message.id, amount: f.amount, from: Number.isFinite(dmg.from) ? dmg.from : null, to: Number.isFinite(dmg.to) ? dmg.to : null };
  if (Number.isFinite(dmg.max)) d.max = dmg.max;
  if (dmg.attacker?.name) d.attacker = { name: M.clampText(dmg.attacker.name, 80), ...(dmg.attacker.id ? { uuid: String(dmg.attacker.id) } : {}) };
  if (f.injury) { d.broken = true; d.injury = { name: M.clampText(f.injury, 80) }; }
  const dr = { actorId: actor.id, k: "damage.taken", path: message.id, u: userId ?? "", t, d, ...(ctxOf(actor) ? { c: ctxOf(actor) } : {}), ...(mode !== "public" ? { v: 1 } : {}) };
  S.dmg.set(message.id, { id: M.makeId(t, actor.id, "damage.taken", message.id, dr.u), from: d.from, to: d.to, v: dr.v });
  setTimeout(() => {                                                 // the undo ledger is written about 0.5 s after the card: link the attack message
    try { const l = game.modules.get(MOD)?.api?.ledgerFor?.(message.id); if (l?.attack?.id) dr.d.atkMsgId = l.attack.id; } catch { /* optional */ }
    if (S.on) { emit(actor, dr); }
  }, 1400);
}
S.dmg = new Map();
const onDeleteMessage = guard("deleteChatMessage", (message, options, userId) => {
  if (!isDamageCard(message)) return;
  const rec = S.dmg.get(message.id);
  const actor = speakerActor(message); const st = elig(actor);
  if (!rec || !st || rec.from === null) return;
  if (Number(actor.system?.derived?.health?.value) !== rec.from) return;      // the card was just deleted by hand: not an undo
  S.dmg.delete(message.id);
  emit(actor, { k: "damage.undone", path: message.id, u: userId ?? "", t: timeOf(options, message) || nowT(), d: { msgId: message.id, of: rec.id, from: rec.to, to: rec.from }, ...(rec.v ? { v: 1 } : {}) });
});

/* ---- combat */
const combatActor = (cm) => { const a = cm?.actor ?? game.actors.get(cm?.actorId); return a && !a.isToken ? a : null; };
const onCreateCombatant = guard("createCombatant", (cm, options, userId) => { const a = combatActor(cm); if (!elig(a)) return; emit(a, { k: "combat.join", path: `c:${cm.combat?.id}`, u: userId ?? "", t: timeOf(options, cm), d: { combatId: cm.combat?.id ?? "", ...(cm.combat?.round ? { round: cm.combat.round } : {}) }, c: undefined }); });
const onDeleteCombatant = guard("deleteCombatant", (cm, options, userId) => { const a = combatActor(cm); if (!elig(a)) return; emit(a, { k: "combat.leave", path: `c:${cm.combat?.id}`, u: userId ?? "", t: timeOf(options, cm), d: { combatId: cm.combat?.id ?? "", ...(cm.combat?.round ? { round: cm.combat.round } : {}) } }); });
const onUpdateCombat = guard("updateCombat", (combat, changes, options, userId) => {
  if (!("turn" in changes) && !("round" in changes)) return;
  if (!combat.started) return;
  const cm = combat.combatant; const a = combatActor(cm); if (!elig(a)) return;
  emit(a, { k: "combat.turn", path: `turn:${combat.round}:${combat.turn}`, u: userId ?? "", t: timeOf(options, combat), d: { round: combat.round, turn: combat.turn } });
});
const onUpdateCombatant = guard("updateCombatant", (cm, changes, options, userId) => {
  if (!("initiative" in changes)) return;
  const a = combatActor(cm); if (!elig(a)) return;
  const from = S.init.get(cm.id) ?? null; S.init.set(cm.id, cm.initiative);
  emit(a, { k: "combat.init", path: `init:${cm.id}`, u: userId ?? "", t: timeOf(options, cm), d: { from, to: changes.initiative } });
});
const onDeleteCombat = guard("deleteCombat", (combat, options, userId) => {
  const seen = new Set();
  for (const cm of combat.combatants) { const a = combatActor(cm); if (!a || seen.has(a.id) || !elig(a)) continue; seen.add(a.id); emit(a, { k: "combat.end", path: `c:${combat.id}`, u: userId ?? "", t: timeOf(options, combat), d: { combatId: combat.id, rounds: combat.round ?? 0 } }); }
});

/* ---- actor lifecycle */
const onCreateActor = guard("createActor", async (actor, options, userId) => {
  const scope = scopeOf(actor); if (!scope) return;
  const t = timeOf(options, actor);
  try {
    const r = await Store.ensureJournal(actor, scope);
    S.states.set(actor.id, buildState(actor, scope));
    const dup = actor._stats?.duplicateSource;
    const e = [];
    if (r.created) {
      e.push(M.normalizeEntry({ t, u: userId ?? "", k: scope === "base" ? "base.created" : "actor.created", d: scope === "base" ? { name: M.clampText(actor.name, 120) } : { ...(dup ? { dupOf: { id: dup } } : {}) } }, { actorId: actor.id, path: "created" }));
      e.push(M.normalizeEntry({ t: t + 1, u: userId ?? "", k: "log.start", d: { baseline: true } }, { actorId: actor.id, path: "start" }));
    }
    await Store.commit(actor, scope, { pub: e.filter(Boolean) });
    const cur = snapNow(actor, scope); await Store.writeSnapshot(actor.id, C.snapOps({}, cur)); S.snaps.set(actor.id, cur);
  } catch (err) { console.warn(`${LOG} createActor failed`, err); }
});
const onDeleteActor = guard("deleteActor", async (actor, options, userId) => {
  const st = S.states.get(actor.id); if (!st) return;
  S.states.delete(actor.id);
  try {
    await Store.commit(actor, st.scope, { pub: [M.normalizeEntry({ t: timeOf(options, actor), u: userId ?? "", k: st.scope === "base" ? "base.deleted" : "actor.deleted", d: { name: M.clampText(actor.name, 120) } }, { actorId: actor.id, path: "deleted" })] });
    await Store.flagJournal(actor.id, { deletedAt: Date.now() });
  } catch (err) { console.warn(`${LOG} deleteActor failed`, err); }
});

/* ------------------------------------------------------------------ explicit records (api / relay) */
export function recordLocal(actor, spec, userId, { rel = false } = {}) {
  const st = S.states.get(actor.id);
  if (!st) return null;
  const t = Number.isFinite(spec.t) ? Math.floor(spec.t) : nowT();
  const draft = { actorId: actor.id, k: spec.k, path: String(spec.rid || "rec"), u: userId, t, d: spec.d ?? {}, ...(spec.v ? { v: 1 } : {}), ...(rel ? { rel: 1 } : {}), ...(spec.a ? { a: 1 } : {}) };
  if (ctxOf(actor) && !draft.c) draft.c = ctxOf(actor);
  const probe = M.buildEntry(draft, { scope: st.scope, actorId: actor.id });
  if (probe.errors.length) return { error: probe.errors };
  const id = M.makeId(t, actor.id, spec.k, draft.path, userId);
  S.counts.drafts++;
  if (spec.absorb) {
    const a = spec.absorb;
    S.ab.parent({ ...draft, absorb: { actors: Array.isArray(a.actors) && a.actors.length ? a.actors : [actor.id], types: Array.isArray(a.types) ? a.types : [], ms: Math.min(10000, Number(a.ms) || 3000) } }, Date.now());
    arm();
  } else emit(actor, draft);
  return { id };
}

/* ------------------------------------------------------------------ lifecycle */
function registerHooks() {
  if (S.hooked) return;
  S.hooked = true;
  Hooks.on("updateActor", onUpdateActor);
  Hooks.on("createItem", onCreateItem); Hooks.on("updateItem", onUpdateItem); Hooks.on("deleteItem", onDeleteItem);
  Hooks.on("createActiveEffect", onFxCreate); Hooks.on("updateActiveEffect", onFxUpdate); Hooks.on("deleteActiveEffect", onFxDelete);
  Hooks.on("createChatMessage", onCreateMessage); Hooks.on("deleteChatMessage", onDeleteMessage);
  Hooks.on("createCombatant", onCreateCombatant); Hooks.on("deleteCombatant", onDeleteCombatant); Hooks.on("updateCombatant", onUpdateCombatant);
  Hooks.on("updateCombat", onUpdateCombat); Hooks.on("deleteCombat", onDeleteCombat);
  Hooks.on("createActor", onCreateActor); Hooks.on("deleteActor", onDeleteActor);
  window.addEventListener("pagehide", () => { if (S.on) tick(true); });
}

/* tab lease (courtesy only: deterministic ids make a double write harmless) */
let bc = null; const peers = new Map();
function lease() {
  try {
    if (!bc && typeof BroadcastChannel !== "undefined") {
      bc = new BroadcastChannel("ip-log-scribe");
      bc.onmessage = (m) => { const x = m.data; if (x?.cid && x.cid !== S.cid) { peers.set(x.cid, Date.now()); if (x.hello) bc.postMessage({ cid: S.cid }); } };
      setInterval(() => { try { bc.postMessage({ cid: S.cid }); } catch { /* closed */ } }, 5000);
      bc.postMessage({ cid: S.cid, hello: 1 });
    }
  } catch { bc = null; }
  const now = Date.now();
  for (const [c, t] of peers) if (now - t > 12000) peers.delete(c);
  return ![...peers.keys()].some((c) => c < S.cid);
}
export async function evaluate() {
  const should = Store.enabled() && game.user.isGM && game.users.activeGM?.id === game.user.id && lease();
  if (should && !S.on) {
    S.on = true; registerHooks();
    for (const c of game.combats ?? []) for (const cm of c.combatants) S.init.set(cm.id, cm.initiative);
    try { await Store.ensureFolder(); await catchUp(); } catch (err) { console.warn(`${LOG} catch-up failed`, err); }
    Hooks.callAll(`${MOD}.scribe`, { on: true });
  } else if (!should && S.on) { tick(true); S.on = false; Hooks.callAll(`${MOD}.scribe`, { on: false }); }
  return S.on;
}
export function summary() {
  return { on: S.on, cid: S.cid, peers: peers.size, actors: [...S.states.values()].map((s) => ({ id: s.actorId, scope: s.scope })), open: { co: S.co.open, held: S.ab.pending, edits: S.edits.open.size, direct: S.direct.length, runHold: S.runHold.size }, counts: { ...S.counts }, store: { ...Store.stats }, skew: S.skew };
}
export async function drain() { tick(true); await S.chain; tick(true); await S.chain; }
