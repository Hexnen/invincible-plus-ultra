/* Character generator, phase 3b: APPLY (Foundry side). Writes a finished wizard state to an existing superhero actor.
   No UI. Pure helpers live in rules.mjs / state.mjs; content lookup in catalog.mjs; strings in apply-lang.mjs (IPCA.*).

   API (game.modules.get("invincible-plus-ultra").api.chargen.apply):
     plan(actor, state)                 -> Plan, writes NOTHING (but reads the pack documents to check that everything resolves)
     apply(actor, state, {confirmed})   -> Result, writes in the spec's order, rolls back on any error
     undo(actor)                        -> Result, restores the data from before the last apply (memory snapshot, else the actor flag backup)
     hasUndo(actor)                     -> boolean
   Plan = {
     ok, actor:{id,name}, runId, errors:[Msg], warnings:[Msg],       Msg = { code, key:"IPCA.<Err|Warn>.<code>" | rule key, params, message, path?, step? }
     fields:[{ path, label, from, to }],                              only fields that change
     creates:[{ kind, type, name, level?, source?, power?, note? }],  in write order (powerSource, power, boost, limit, talent, drawback)
     deletes:[{ id, type, name }],                                    items that will be removed (powerSource, power, boost, limit, talent, drawback)
     keeps:[{ id, type, name }],                                      every other item (gear, injuries ...), never touched
     counts:{ create:{powerSource,power,boost,limit,talent,drawback,total}, delete:{...same}, fields:n, keeps:n },
     destructive: boolean }                                           true when deletes.length > 0 (apply then needs confirmed:true)
   Result = { ok, errors, warnings, plan, runId, created:[ids], deleted:[ids], rolledBack?, message }
   Order (spec 2.3, decision 3 = destructive replace): wipe the six wizard item types -> sources -> powers (system.powerSource = embedded id) ->
   boosts/limits (system.power = embedded id) -> talents/drawbacks -> ONE actor.update (name, attributes, texts, reputation, resources, role,
   module flag + backup) -> Health/Resolve current = derived max LAST. Transfer-effect bonuses (Windfall, Hard Times, Renowned ...) ride along
   in the copied items and are never pre-added. Empty text values are never written (existing text is not blanked). Karma is not touched.
   Undo: created items are deleted again and the wiped ones are re-created with their OLD ids (keepId), so powerSource/power links survive. */
import { t } from "./apply-lang.mjs";
import * as Catalog from "./catalog.mjs";
import { RANKS, ATTRS, validate } from "./rules.mjs";

const MODULE_ID = "invincible-plus-ultra";
const WIPE_TYPES = ["powerSource", "power", "boost", "limit", "talent", "drawback"];
const LEVEL_WORDS = ["basic", "major", "massive", "monstrous"];
const BACKUP_LIMIT = 150_000;
const SOURCE_IMG = "systems/invincible/assets/icons/powersource.svg";
const memory = new Map(); // actor.uuid -> snapshot (for undo in this session)
/* phase 9 (A1 / A2). UNDO_TTL: an undo offer expires after 24 hours (memory snapshot and flag backup alike); before that, undo refuses to run over later changes of the hero
   unless the caller confirms the listed drift. LOCK_TTL: the per-hero write lock (flag chargenLock {runId, userId, at}) of a running apply is ignored after 90 s (crashed client). */
export const UNDO_TTL = 24 * 3600 * 1000;
export const LOCK_TTL = 90 * 1000;
const inflight = new Set();   // actor.uuid of applies / undos running in THIS client
const lockPath = `flags.${MODULE_ID}.chargenLock`;
/** P11-6: Foundry 14 deprecates the "-=key" deletion syntax; ForcedDeletion where it exists (14), the legacy key on 13 */
const dropKey = (parent, key) => { const FD = globalThis.foundry?.data?.operators?.ForcedDeletion; return FD?.create ? [`${parent}.${key}`, FD.create()] : [`${parent}.-=${key}`, null]; };

const msg = (kind, code, params = {}, extra = {}) => ({ code, key: `IPCA.${kind}.${code}`, params, message: t(`IPCA.${kind}.${code}`, params), ...extra });
const getp = (obj, path) => foundry.utils.getProperty(obj, path);
const clone = (x) => (x === undefined ? undefined : foundry.utils.deepClone(x));
const emptyCounts = () => Object.fromEntries([...WIPE_TYPES, "total"].map((k) => [k, 0]));

/* ------------------------------------------------------------------ team base integration (phase 5f)
   The team / base live in a REAL ACTOR (scripts/base). What the Team step chose (state.team.mode) is carried out AFTER the hero's items and fields are
   written: "create" makes a base actor with this hero as the first member (kind, location, starting upgrades), "join" links the hero to an existing one
   (+ extra starting upgrades), then the card's two texts are mirrored onto the hero with the sync option ipbSync (base/lock.mjs refuses every other writer).
   A hero that is ALREADY a member keeps its fields untouched (the card owns system.team / system.teamBase; nothing to do). Any failure of this stage rolls
   the hero back too (the base side is compensated first: upgrades removed, hero unlinked, a base created by this run deleted when the user may). */
const baseApi = () => globalThis.game?.modules?.get(MODULE_ID)?.api?.base ?? null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** phase 7: the GM may always use the generator; a player only while the world setting chargenPlayers is on (checked again at write time, the window may have been open for a while) */
function mayUse() {
  try { return !!game.user.isGM || game.settings.get(MODULE_ID, "chargenPlayers") !== false; } catch { return true; }
}
function teamIntent(actor, state) {
  const B = baseApi();
  const mode = state.team?.mode ?? "text";
  let card = null;
  try { card = B?.find?.(actor) ?? null; } catch { card = null; }
  if (card) return { action: "member", B, card };
  if (mode === "join" || mode === "create") return { action: mode, B };
  return { action: "text", B };
}
function canCreateBase(B) {
  try { return !!B && (B.isStaff() || game.settings.get(MODULE_ID, "basePlayersCreate") === true); } catch { return false; }
}
/** "Power Effect (Flight)" -> { name, power } */
function splitUpgrade(s) {
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(String(s ?? "").trim());
  return m ? { name: m[1].trim(), power: m[2].trim() } : { name: String(s ?? "").trim(), power: "" };
}
/** Reverse what a run did on the base side. Returns [Msg] (notes for the user); never throws. */
async function undoBase(actor, run) {
  const notes = [];
  const B = baseApi();
  if (!B || !run?.baseId) return notes;
  try {
    const base = B.cardById(run.baseId);
    if (base && run.added?.length && B.canEdit(base)) for (const id of run.added) { try { await B.upgrades.remove(base, id); } catch (err) { console.warn(`${MODULE_ID} | chargen: could not remove upgrade ${id}`, err); } }
    if (run.linked && B.find(actor)?.id === run.baseId) await B.unlink(actor);
    if (run.created && base) {
      if (B.isStaff() && B.members(base, { all: true }).length === 0) await B.remove(base);
      else notes.push(msg("Warn", "BaseKept", { team: base.name }));
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | chargen: undoing the base step failed`, err);
    notes.push(msg("Warn", "BaseKept", { team: run.name ?? "" }));
  }
  return notes;
}
/** Create / join the base, add the starting upgrades, mirror the texts. Returns the run record (kept for undo). Throws after compensating. */
async function applyBase(actor, state, ti, warnings) {
  const B = ti.B, tm = state.team ?? {};
  const run = { action: ti.action, baseId: null, name: "", created: false, linked: false, added: [] };
  try {
    let base;
    if (ti.action === "create") {
      const v = await B.create({ name: String(tm.name ?? "").trim(), rank: state.rank, fromActor: actor });
      base = B.cardById(v.id);
      run.created = true; run.linked = true;
      // the hero's own link is the truth: if two GM clients both answered a relayed request (one of them running older module code) the hero is linked to
      // the card the LAST answer made; write to that one so the hero and its card agree
      for (let i = 0; i < 20 && !B.find(actor); i++) await sleep(100);
      const lk = B.find(actor);
      if (lk && lk.id !== v.id) base = B.cardById(lk.id);
    } else {
      base = B.cardById(tm.baseId);
      if (!base) throw new Error(t("IPCA.Err.BaseGone"));
      const lk = await B.link(actor, base);
      if (lk?.requested) {          // B11: a player who cannot edit that base only sends a join REQUEST; the GM must approve. The hero is not a member (yet).
        run.baseId = base.id; run.name = base.name; run.requested = true;
        warnings.push(msg("Warn", "BaseRequested", { team: base.name }));
        return run;
      }
      run.linked = true;
    }
    if (!base) throw new Error(t("IPCA.Err.BaseGone"));
    run.baseId = base.id; run.name = base.name;
    if (!B.isStaff()) for (let i = 0; i < 60 && !B.canEdit(base); i++) await sleep(100);   // the GM's ownership grant arrives as a separate update
    const canEdit = B.canEdit(base);
    const wants = (ti.action === "create" && (String(tm.base ?? "").trim() || String(tm.where ?? "").trim())) || (tm.upgrades ?? []).length;
    if (wants && !canEdit) warnings.push(msg("Warn", "BaseNoEdit", { team: base.name }));
    else {
      if (ti.action === "create" && (String(tm.base ?? "").trim() || String(tm.where ?? "").trim())) {
        try { await B.update(base.id, { base: { kind: String(tm.base ?? "").trim(), where: String(tm.where ?? "").trim() } }); }
        catch (err) { warnings.push(msg("Warn", "BaseField", { team: base.name, error: err?.message ?? String(err) })); }
      }
      for (const raw of tm.upgrades ?? []) {
        const { name, power } = splitUpgrade(raw);
        if (!name) continue;
        try {
          const before = Object.keys(B.get(base.id)?.upgrades ?? {});
          const entry = await B.catalog.upgrade(name);
          const id = await B.upgrades.add(base.id, entry ? entry.key : "custom", { source: "start", power: entry?.perPower ? power : "", name: entry ? "" : name });
          if (!before.includes(id)) run.added.push(id);
        } catch (err) { warnings.push(msg("Warn", "BaseUpgrade", { name: raw, error: err?.message ?? String(err) })); }
      }
    }
    // the hero sheet mirrors the card (one-way, the card is the source of truth); written with the sync option the lock guard allows
    const f = B.sync.format(base.id);
    await actor.update({ "system.team": f.team, "system.teamBase": f.teamBase, [`flags.${MODULE_ID}.${B.pure.FLAG_KEY}.pushed`]: { team: f.team, teamBase: f.teamBase } }, { ipbSync: true });
    warnings.push(ti.action === "create" ? msg("Warn", "BaseCreated", { team: base.name }) : msg("Warn", "BaseJoined", { team: base.name }));
    return run;
  } catch (err) {
    await undoBase(actor, run);
    throw err;
  }
}

/* ------------------------------------------------------------------ state -> actor field values */
function fieldValues(state, skipTeam = false) {
  const f = {};
  // phase 11 (P11-1): a tampered draft / import could carry control characters, bidi overrides (spoofing) or megabytes of text: strip and cap what is written
  const text = (path, v) => { const s = String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g, "").trim().slice(0, path === "name" || path === "system.civilianName" ? 60 : 1200); if (s) f[path] = s; };
  text("name", state.heroName);
  text("system.civilianName", state.civilianName);
  text("system.role", state.role);
  text("system.appearance", state.appearance);
  for (const k of ATTRS) f[`system.attributes.${k}.value`] = Number(state.attrs?.[k]) || 0;
  text("system.occupation", state.occupation);
  text("system.personality", (state.personality ?? []).filter(Boolean).join(", "));
  const nameText = (x) => (x ? (x.text ? `${x.name}. ${x.text}` : x.name) : "");
  text("system.drive", nameText(state.drive));
  text("system.flaw", nameText(state.flaw));
  const rel = [];
  if (state.npcRel?.type || state.npcRel?.name) rel.push(`NPC: ${[state.npcRel.name, state.npcRel.type ? `(${state.npcRel.type})` : ""].filter(Boolean).join(" ")}`);
  if (state.heroRel?.name) rel.push(`Hero: ${state.heroRel.name}`);
  text("system.relationships", rel.join("\n"));
  if (!skipTeam) {   // phase 5f: a hero that belongs to (or is about to join) a team base card does NOT get these two texts from the wizard: the card owns them (base/lock.mjs)
    text("system.team", state.team?.name);
    const ups = (state.team?.upgrades ?? []).filter(Boolean);
    const head = [state.team?.base, state.team?.where].map((x) => String(x ?? "").trim()).filter(Boolean).join(", ");
    text("system.teamBase", [head, ups.length ? `upgrades: ${ups.join(", ")}` : ""].filter(Boolean).join("; "));
  }
  f["system.reputation"] = RANKS[state.rank]?.reputation ?? 0;
  f["system.resources"] = Number(state.resources) || 0;
  return f;
}

/* ------------------------------------------------------------------ item data builders */
function baseItemData(doc, runId) {
  const d = doc.toObject();
  delete d._id; delete d.folder; delete d.ownership; delete d._stats;
  if (d.flags && "exportSource" in d.flags) delete d.flags.exportSource;   // P11-7: pack items still carry the pre-v13 flag; creating them triggered a "failed data migration" warning per item
  d.flags = foundry.utils.mergeObject(d.flags ?? {}, { [MODULE_ID]: { chargenRun: runId } });
  return d;
}
/** non-split powers keep ALL level automations in one doc: show those of the chosen level (convention of the sample heroes, spec A6) */
function applyLevelToAutomations(data, level) {
  const au = data.system?.automations;
  if (!au || !level) return;
  const word = LEVEL_WORDS[level];
  for (const a of Object.values(au)) {
    const m = /\b(basic|major|massive|monstrous)\b/i.exec(a.name ?? "");
    if (!m) continue;
    const w = m[1].toLowerCase();
    a.showAsSelection = w === word || (w === "basic" && a.type === "rollAttack");
  }
}

/* ------------------------------------------------------------------ plan */
export async function plan(actor, state) {
  const errors = [], warnings = [];
  const out = { ok: false, actor: { id: actor?.id, name: actor?.name }, runId: foundry.utils.randomID(), errors, warnings, fields: [], overwrites: [], creates: [], deletes: [], keeps: [], counts: { create: emptyCounts(), delete: emptyCounts(), fields: 0, keeps: 0 }, destructive: false, _ops: null };
  if (!actor || actor.type !== "superhero") { errors.push(msg("Err", "WrongType", { actor: actor?.name ?? "?" })); return out; }
  if (!actor.isOwner) errors.push(msg("Err", "NotOwner", { actor: actor.name }));
  if (!mayUse()) errors.push(msg("Err", "NotAllowed"));
  const v = validate(state);
  for (const i of v.errors) errors.push({ code: i.code, key: i.key, params: i.params, path: i.path, step: i.step, message: i.key });
  if (v.errors.length) errors.unshift(msg("Err", "Invalid", { count: v.errors.length }));
  for (const i of v.warnings ?? []) warnings.push({ code: i.code, key: i.key, params: i.params, path: i.path, step: i.step, message: i.key });
  const ti = teamIntent(actor, state);                                  // phase 5f: team base integration
  const relayOk = !!game.user.isGM || (!!game.modules.get("socketlib")?.active && !!game.modules.get(MODULE_ID)?.socket);   // B11: players reach the GM only through socketlib
  if ((ti.action === "create" || ti.action === "join") && !relayOk) errors.push(msg("Err", "NoRelay", {}, { step: "team" }));
  else if (ti.action === "member") warnings.push(msg("Warn", "BaseMember", { team: ti.card.name }));
  else if (ti.action === "create") {
    if (!ti.B) errors.push(msg("Err", "NoBase", {}, { step: "team" }));
    else if (!canCreateBase(ti.B)) errors.push(msg("Err", "BaseNoCreate", {}, { step: "team" }));
    else warnings.push(msg("Warn", "BaseWillCreate", { team: String(state.team?.name ?? "").trim() || "?" }));
  } else if (ti.action === "join") {
    const target = ti.B?.cardById?.(state.team?.baseId);
    if (!ti.B) errors.push(msg("Err", "NoBase", {}, { step: "team" }));
    else if (!target || !target.testUserPermission(game.user, "LIMITED")) errors.push(msg("Err", "BaseGone", {}, { step: "team" }));
    else warnings.push(msg("Warn", "BaseWillJoin", { team: target.name }));
  }
  const av = Catalog.available();
  if (!av.ok) { errors.push(msg("Err", "NoPacks", { missing: av.missing.join(", ") })); return out; }
  if (errors.length) return finishCounts(out, actor, state);

  // resolve every document BEFORE anything is written
  const ops = { sources: [], powers: [], links: [], talents: [] };
  const need = async (type, ref, kind, opts) => {
    const doc = await Catalog.resolveDoc(type, ref, opts);
    if (!doc) errors.push(msg("Err", "Unresolved", { kind, name: ref?.name ?? "?" }, { step: kind === "Talent" || kind === "Drawback" ? "talents" : "powers" }));
    return doc;
  };
  for (const s of state.sources ?? []) {
    const doc = await Catalog.resolveDoc("powerSource", s);
    if (!doc) warnings.push(msg("Warn", "CustomSource", { name: s.name }));
    ops.sources.push({ key: s.key, name: doc?.name ?? s.name, doc });
  }
  for (const p of state.powers ?? []) {
    const doc = await need("power", p, "Power", { level: p.level });
    const ent = doc ? await Catalog.findPower(p) : null;
    const split = !!ent?.split;
    // B2: the book defines no such level for this power (the rules check uses the same table once the catalogue was read; this is the authoritative re-check)
    if (ent && Number.isInteger(ent.maxLevel) && p.level > ent.maxLevel) errors.push({ code: "power.level.none", key: "IPC.Rule.power.level.none", params: { name: p.name, max: ent.maxLevel }, path: "powers", step: "powers", message: "IPC.Rule.power.level.none" });
    ops.powers.push({ key: p.key, state: p, doc, split });
    for (const b of p.boosts ?? []) ops.links.push({ type: "boost", powerKey: p.key, powerName: p.name, doc: await need("boost", b, "Boost", { power: p.name }) });
    for (const l of p.limits ?? []) ops.links.push({ type: "limit", powerKey: p.key, powerName: p.name, doc: await need("limit", l, "Limit", { power: p.name }) });
  }
  const tal = [];
  if (state.heroTalent) tal.push({ type: "talent", ref: state.heroTalent });
  if (state.occTalent) tal.push({ type: "talent", ref: state.occTalent });
  for (const x of state.extraTalents ?? []) tal.push({ type: "talent", ref: x });
  for (const x of state.drawbacks ?? []) tal.push({ type: "drawback", ref: x, note: x.note });
  for (const x of tal) ops.talents.push({ ...x, doc: await need(x.type, x.ref, x.type === "talent" ? "Talent" : "Drawback") });
  if ((state.drawbacks ?? []).some((d) => Catalog.norm(d.name) === "hard times")) warnings.push(msg("Warn", "HardTimes"));
  if (errors.length) return finishCounts(out, actor, state);

  // creates (display list in write order)
  const lvl = (n) => (n > 0 ? LEVEL_WORDS[n] : undefined);
  for (const s of ops.sources) out.creates.push({ kind: "powerSource", type: "powerSource", name: s.name, custom: !s.doc });
  for (const p of ops.powers) {
    const src = ops.sources.find((s) => s.key === p.state.sourceKey);
    out.creates.push({ kind: "power", type: "power", name: p.doc.name, level: lvl(p.state.level), source: src?.name, ...(String(p.state.note ?? "").trim() ? { note: String(p.state.note).trim() } : {}) });
  }
  for (const l of ops.links) out.creates.push({ kind: l.type, type: l.type, name: l.doc.name, power: l.powerName });
  for (const x of ops.talents) out.creates.push({ kind: x.type, type: x.type, name: x.doc.name, ...(x.note ? { note: x.note } : {}) });

  // deletes / keeps
  for (const it of actor.items) {
    if (WIPE_TYPES.includes(it.type)) out.deletes.push({ id: it.id, type: it.type, name: it.name });
    else out.keeps.push({ id: it.id, type: it.type, name: it.name });
  }
  if (out.keeps.length) warnings.push(msg("Warn", "KeepsItems", { count: out.keeps.length }));

  // field diff
  const vals = fieldValues(state, ti.action !== "text");
  const flagPath = `flags.${MODULE_ID}.chargen`;
  for (const [path, to] of Object.entries(vals)) {
    const from = getp(actor._source, path) ?? ""; // SOURCE value: actor.system holds effect-modified numbers (Renowned +3 ...)
    if (from !== to) out.fields.push({ path, from, to });
  }
  out.fields.push({ path: flagPath, from: getp(actor._source, flagPath)?.rank ?? null, to: state.rank });
  // B5 (phase 9): fields that REPLACE data the hero already has (not blanks / the sheet defaults). Together with the wiped items they make the apply destructive.
  const meaningful = (f) => {
    if (f.path === "name" || f.path.startsWith("flags.") || f.from === "" || f.from == null) return false;
    if (/^system\.attributes\.\w+\.value$/.test(f.path)) return Number(f.from) !== 2;
    if (f.path === "system.reputation") return Number(f.from) > 0;
    if (f.path === "system.resources") return Number(f.from) > 1;
    return String(f.from).trim() !== "";
  };
  out.overwrites = out.fields.filter(meaningful);
  if (out.overwrites.length || out.deletes.length) { const nm = out.fields.find((f) => f.path === "name" && String(f.from ?? "").trim()); if (nm) out.overwrites.unshift(nm); }
  out._ops = ops;
  out._vals = vals;
  out._team = ti;
  out.ok = true;
  return finishCounts(out, actor, state);
}
function finishCounts(out) {
  for (const c of out.creates) { out.counts.create[c.type]++; out.counts.create.total++; }
  for (const d of out.deletes) { out.counts.delete[d.type]++; out.counts.delete.total++; }
  out.counts.fields = out.fields.length;
  out.counts.keeps = out.keeps.length;
  out.destructive = out.deletes.length > 0 || (out.overwrites?.length ?? 0) > 0;
  out.ok = out.ok && !out.errors.length;
  return out;
}
const publicPlan = (p) => { const { _ops, _vals, _team, ...rest } = p; return rest; };
/** the plan without internals (safe to hand to a UI / JSON) */
export async function planPublic(actor, state) { return publicPlan(await plan(actor, state)); }

/* ------------------------------------------------------------------ apply */
const userName = (id) => game.users?.get(id)?.name ?? "?";
/** A1 (phase 9): one write at a time per hero, across clients. In-memory set for this client + a flag {runId, userId, at} (TTL) for the others. Best effort in the
    absence of a server-side transaction: after writing the flag we wait one round trip and check that OUR run id is the one that stuck; the loser backs off. */
async function acquireLock(actor, lockId) {
  if (inflight.has(actor.uuid)) return { ok: false, by: game.user.name };
  const cur = getp(actor._source, lockPath);
  if (cur?.runId && Date.now() - (cur.at ?? 0) < LOCK_TTL) return { ok: false, by: userName(cur.userId) };
  inflight.add(actor.uuid);
  try {
    await actor.update({ [lockPath]: { runId: lockId, userId: game.user.id, at: Date.now() } });
    await sleep(300);
    const now = getp(actor._source, lockPath);
    if (now?.runId !== lockId) { inflight.delete(actor.uuid); return { ok: false, by: userName(now?.userId) }; }
  } catch (err) { inflight.delete(actor.uuid); throw err; }
  return { ok: true };
}
async function releaseLock(actor, lockId) {
  inflight.delete(actor.uuid);
  try { if (getp(actor._source, lockPath)?.runId === lockId) await actor.update(Object.fromEntries([dropKey(`flags.${MODULE_ID}`, "chargenLock")])); } catch (err) { console.warn(`${MODULE_ID} | chargen: could not release the lock`, err); }
}
/** run fn() holding the hero's write lock; the loser gets a Busy error and nothing is written */
async function withLock(actor, fn, busyResult) {
  if (!actor || actor.type !== "superhero" || !actor.isOwner || !mayUse()) return fn();   // the refusals below report these themselves
  const lockId = foundry.utils.randomID();
  let lock;
  try { lock = await acquireLock(actor, lockId); } catch (err) { console.warn(`${MODULE_ID} | chargen: lock failed`, err); return fn(); }
  if (!lock.ok) return busyResult(lock.by);
  try { return await fn(); } finally { await releaseLock(actor, lockId); }
}

export function apply(actor, state, opts = {}) {
  return withLock(actor, () => applyLocked(actor, state, opts), (by) => {
    const e = msg("Err", "Busy", { actor: actor.name, user: by });
    return { ok: false, busy: true, plan: null, runId: null, errors: [e], warnings: [], created: [], deleted: [], message: e.message };
  });
}

/** expect (B6) = { deletes:[item ids], overwrites:[paths] } what the user was shown; the fresh plan may not delete / overwrite anything more than that */
async function applyLocked(actor, state, { confirmed = false, onStage: onStageRaw = null, expect = null } = {}) {
  const onStage = (st) => { try { onStageRaw?.(st); } catch { /* a progress callback must never break a write */ } };   // phase 7: Review shows real progress
  const p = await plan(actor, state);
  const base = { ok: false, plan: publicPlan(p), runId: p.runId, errors: p.errors, warnings: p.warnings, created: [], deleted: [] };
  if (!p.ok) return { ...base, message: p.errors[0]?.message ?? "" };
  if (expect) {
    const seenDel = new Set(expect.deletes ?? []), seenOv = new Set(expect.overwrites ?? []);
    if (p.deletes.some((d) => !seenDel.has(d.id)) || (p.overwrites ?? []).some((f) => !seenOv.has(f.path))) {
      const e = msg("Err", "PlanChanged", { actor: actor.name });
      return { ...base, planChanged: true, errors: [e], message: e.message };
    }
  }
  if (p.destructive && confirmed !== true) {
    const e = msg("Err", "NeedConfirm", { count: p.deletes.length, fields: p.overwrites.length, actor: actor.name });
    return { ...base, errors: [e, ...p.errors], message: e.message };
  }
  const ops = p._ops, vals = p._vals;
  const runId = p.runId;
  const flagPath = `flags.${MODULE_ID}.chargen`;
  const backupPath = `flags.${MODULE_ID}.chargenBackup`;

  // snapshot (everything we are about to overwrite)
  const snap = { runId, at: Date.now(), fields: {}, unset: [], items: actor.items.filter((i) => WIPE_TYPES.includes(i.type)).map((i) => i.toObject()), prevChargen: clone(getp(actor._source, flagPath)), prevBackup: clone(getp(actor._source, backupPath)) };
  const ti = p._team ?? { action: "text" };
  const mirrored = ti.action === "join" || ti.action === "create" ? ["system.team", "system.teamBase"] : [];   // the base step overwrites these through the card mirror: undo must restore them
  for (const path of [...Object.keys(vals), ...mirrored, "system.derived.health.value", "system.derived.resolve.value"]) {
    const cur = getp(actor._source, path); // source data, NOT the effect-modified actor.system value
    if (cur === undefined) snap.unset.push(path); else snap.fields[path] = clone(cur);
  }
  const warnings = [...p.warnings];
  let stage = "snapshot";
  const created = [];
  try {
    // 1. wipe
    stage = "wipe"; onStage?.(stage);
    // A1: re-read which of the snapshotted items still exist right now (a GM may have deleted one on the sheet meanwhile); only ids THIS run deletes are ever restored
    snap.wiped = [];
    const present = snap.items.map((i) => i._id).filter((id) => actor.items.has(id));
    if (present.length) {
      try { await actor.deleteEmbeddedDocuments("Item", present); snap.wiped = present; }
      catch (err) { snap.wiped = present.filter((id) => !actor.items.has(id)); throw err; }   // whatever really went away before the failure is restored by the rollback
    }
    // 2. power sources
    stage = "powerSource"; onStage?.(stage);
    const sourceId = {};
    if (ops.sources.length) {
      const data = ops.sources.map((s) => (s.doc ? baseItemData(s.doc, runId) : { name: s.name, type: "powerSource", img: SOURCE_IMG, system: { description: "" }, flags: { [MODULE_ID]: { chargenRun: runId } } }));
      const docs = await actor.createEmbeddedDocuments("Item", data);
      docs.forEach((d, i) => { sourceId[ops.sources[i].key] = d.id; created.push(d.id); });
    }
    // 3. powers
    stage = "power"; onStage?.(stage);
    const powerId = {};
    if (ops.powers.length) {
      const data = ops.powers.map((o) => {
        const d = baseItemData(o.doc, runId);
        d.system.powerSource = sourceId[o.state.sourceKey] ?? "";
        if (String(o.state.note ?? "").trim()) d.name = `${d.name} (${String(o.state.note).trim()})`;
        if (!o.split && o.state.level > 0) { d.system.level = LEVEL_WORDS[o.state.level]; applyLevelToAutomations(d, o.state.level); }
        return d;
      });
      const docs = await actor.createEmbeddedDocuments("Item", data);
      docs.forEach((d, i) => { powerId[ops.powers[i].key] = d.id; created.push(d.id); });
    }
    // 4. boosts / limits
    stage = "boost/limit"; onStage?.(stage);
    if (ops.links.length) {
      const data = ops.links.map((l) => { const d = baseItemData(l.doc, runId); d.system.power = powerId[l.powerKey]; return d; });
      const docs = await actor.createEmbeddedDocuments("Item", data);
      docs.forEach((d) => created.push(d.id));
    }
    // 5. talents / drawbacks
    stage = "talent/drawback"; onStage?.(stage);
    if (ops.talents.length) {
      const data = ops.talents.map((x) => { const d = baseItemData(x.doc, runId); if (x.note) d.name = `${d.name} (${x.note})`; return d; });
      const docs = await actor.createEmbeddedDocuments("Item", data);
      docs.forEach((d) => created.push(d.id));
    }
    // 6. actor fields + marker flag + backup
    stage = "actor"; onStage?.(stage);
    const update = { ...vals };
    update[flagPath] = { v: 1, runId, rank: state.rank, archetype: state.archetype ?? null, identity: state.identity ?? null, mode: state.mode ?? "manual", seed: state.seed ?? null, createdAt: Date.now(), appliedBy: game.user.id };
    const backup = { runId, at: snap.at, fields: snap.fields, unset: snap.unset, items: snap.items, wiped: snap.wiped, prevChargen: snap.prevChargen ?? null };
    if (JSON.stringify(backup).length < BACKUP_LIMIT) update[backupPath] = backup;
    else warnings.push(msg("Warn", "NoBackupFlag"));
    await actor.update(update);
    // 7. current Health / Resolve = derived max (after the items' effects exist)
    stage = "health"; onStage?.(stage);
    const hp = actor.system.derived.health.max, rp = actor.system.derived.resolve.max;
    await actor.update({ "system.derived.health.value": hp, "system.derived.resolve.value": rp });
    // 8. team base (phase 5f): AFTER the hero is complete; its own failure compensates the base side, then the catch below rolls the hero back
    if (ti.action === "join" || ti.action === "create") {
      stage = "base"; onStage?.(stage);
      snap.base = await applyBase(actor, state, ti, warnings);
      try { if (update[backupPath]) await actor.update({ [`${backupPath}.base`]: snap.base }); }
      catch (err) { console.warn(`${MODULE_ID} | chargen: could not store the base record in the backup`, err); }
    }
  } catch (err) {
    console.error(`${MODULE_ID} | chargen apply failed at ${stage}`, err);
    const reason = String(err?.message ?? err).replace(/[\s.]+$/, "");   // P11-5: the message templates add their own full stop
    try {
      await restore(actor, snap, created);
      const e = msg("Err", "Failed", { stage, error: reason });
      return { ...base, errors: [e], warnings, created: [], deleted: [], rolledBack: true, message: e.message };
    } catch (rb) {
      console.error(`${MODULE_ID} | chargen rollback failed`, rb);
      memory.set(actor.uuid, snap);
      const e = msg("Err", "RollbackFailed", { stage, error: reason, rollback: String(rb?.message ?? rb).replace(/[\s.]+$/, ""), actor: actor.name });
      return { ...base, errors: [e], warnings, rolledBack: false, message: e.message };
    }
  }
  // A2: remember what the hero looked like right after this run, so undo can tell later changes from this run's own writes
  try {
    snap.after = fingerprint(actor, [...Object.keys(vals), ...mirroredPaths(p), "system.derived.health.value", "system.derived.resolve.value"], created);
    if (getp(actor._source, backupPath)) await actor.update({ [`${backupPath}.after`]: snap.after }, { ipbSync: true });
  } catch (err) { console.warn(`${MODULE_ID} | chargen: could not store the undo fingerprint`, err); }
  memory.set(actor.uuid, snap);
  const message = t("IPCA.Done.Apply", { actor: actor.name, created: created.length, deleted: snap.wiped.length, fields: p.fields.length });
  // P11-4: the plan's future-tense notes ("will be created / joined") must not stay next to the past-tense line of what the run just did
  const done = snap.base ? warnings.filter((w) => w.code !== "BaseWillCreate" && w.code !== "BaseWillJoin") : warnings;
  return { ...base, ok: true, errors: [], warnings: done, created, deleted: [...snap.wiped], message };
}
const mirroredPaths = (p) => (p._team && (p._team.action === "join" || p._team.action === "create") ? ["system.team", "system.teamBase"] : []);
function fingerprint(actor, paths, createdIds) {
  const fields = {};
  for (const path of new Set(paths)) fields[path] = clone(getp(actor._source, path)) ?? null;
  const items = {};
  for (const id of createdIds) { const it = actor.items.get(id); if (it) items[id] = { name: it.name, mt: it._stats?.modifiedTime ?? 0 }; }
  return { fields, items, known: actor.items.filter((i) => WIPE_TYPES.includes(i.type)).map((i) => i.id) };
}

/** put the actor back: delete what this run created, re-create the wiped items with their old ids, restore field values */
async function restore(actor, snap, createdIds = null) {
  const mine = actor.items.filter((i) => (createdIds ? createdIds.includes(i.id) : getp(i, `flags.${MODULE_ID}.chargenRun`) === snap.runId)).map((i) => i.id);
  if (mine.length) await actor.deleteEmbeddedDocuments("Item", mine);
  const clash = new Set(actor.items.map((i) => i.id));
  // A1: only items THIS run deleted come back (snap.wiped; older backups without the list restore everything), never one somebody else removed, never over an id that exists now
  const wiped = Array.isArray(snap.wiped) ? new Set(snap.wiped) : null;
  const back = snap.items.filter((i) => !clash.has(i._id) && (!wiped || wiped.has(i._id)));
  if (back.length) await actor.createEmbeddedDocuments("Item", back, { keepId: true });
  const upd = { ...snap.fields };
  for (const path of snap.unset ?? []) if (typeof getp(actor._source, path) === "string") upd[path] = "";   // a text field that did not exist before the run goes back to empty (found in 5f: undo left the texts behind)
  const flagPath = `flags.${MODULE_ID}`;
  if (snap.prevChargen) upd[`${flagPath}.chargen`] = snap.prevChargen; else { const [k, v] = dropKey(flagPath, "chargen"); upd[k] = v; }
  if (createdIds && snap.prevBackup) upd[`${flagPath}.chargenBackup`] = snap.prevBackup; // failed run: the older undo backup stays
  else { const [k, v] = dropKey(flagPath, "chargenBackup"); upd[k] = v; }
  // B11 patch (phase 9): a hero that is (still) a team MEMBER does not get the old team texts back behind the card's back; the lock guard then also protects this update
  let member = false;
  try { member = !!baseApi()?.find?.(actor); } catch { member = false; }
  if (member) for (const k of ["system.team", "system.teamBase"]) delete upd[k];
  await actor.update(upd, member ? {} : { ipbSync: true });   // not a member: our own legitimate writer for the team texts (a no-op option otherwise)
}

const snapOf = (actor) => (actor ? memory.get(actor.uuid) ?? getp(actor._source, `flags.${MODULE_ID}.chargenBackup`) ?? null : null);

/** A2 (phase 9): is there something to undo, how old is it, and what changed on the hero since the run? Sync, reads only the actor. The offer expires after UNDO_TTL.
    drift = { fields:[{path, expected, now}], itemsEdited:[names], itemsMissing:[names], itemsAdded:[names] }; clean = nothing drifted; unknown = a backup from before this check existed. */
export function undoStatus(actor) {
  const snap = snapOf(actor);
  if (!snap) return { available: false };
  const age = Date.now() - (Number(snap.at) || 0);
  if (!Number.isFinite(age) || age > UNDO_TTL) return { available: false, expired: true, age };
  const drift = { fields: [], itemsEdited: [], itemsMissing: [], itemsAdded: [] };
  const aft = snap.after;
  if (aft && typeof aft === "object") {
    for (const [path, v] of Object.entries(aft.fields ?? {})) {
      const now = clone(getp(actor._source, path)) ?? null;
      if (JSON.stringify(now) !== JSON.stringify(v)) drift.fields.push({ path, expected: v, now });
    }
    for (const [id, info] of Object.entries(aft.items ?? {})) {
      const it = actor.items.get(id);
      if (!it) drift.itemsMissing.push(info.name);
      else if ((it._stats?.modifiedTime ?? 0) !== info.mt) drift.itemsEdited.push(it.name);
    }
    const known = new Set(aft.known ?? []);
    for (const it of actor.items) if (WIPE_TYPES.includes(it.type) && !known.has(it.id)) drift.itemsAdded.push(it.name);
  }
  const n = drift.fields.length + drift.itemsEdited.length + drift.itemsMissing.length + drift.itemsAdded.length;
  return { available: true, at: snap.at, age, drift, clean: !!aft && n === 0, unknown: !aft, changes: n };
}

export function hasUndo(actor) { return undoStatus(actor).available === true; }

export function undo(actor, opts = {}) {
  return withLock(actor, () => undoLocked(actor, opts), (by) => {
    const e = msg("Err", "Busy", { actor: actor.name, user: by });
    return { ok: false, busy: true, errors: [e], message: e.message };
  });
}
async function undoLocked(actor, { confirmDrift = false } = {}) {
  const st = undoStatus(actor);
  const snap = st.available ? snapOf(actor) : null;
  if (!snap) {
    const e = st.expired ? msg("Err", "UndoExpired", { actor: actor?.name ?? "?" }) : msg("Err", "NoUndo", { actor: actor?.name ?? "?" });
    if (st.expired) { memory.delete(actor.uuid); }
    return { ok: false, errors: [e], message: e.message };
  }
  if (!actor.isOwner) { const e = msg("Err", "NotOwner", { actor: actor.name }); return { ok: false, errors: [e], message: e.message }; }
  if (!mayUse()) { const e = msg("Err", "NotAllowed"); return { ok: false, errors: [e], message: e.message }; }
  if (!st.clean && confirmDrift !== true) {   // the hero changed after the run (or the backup predates this check): never overwrite that silently
    const e = msg("Err", "UndoStale", { actor: actor.name, count: st.changes });
    return { ok: false, needsConfirm: true, status: st, errors: [e], message: e.message };
  }
  try {
    const warnings = await undoBase(actor, snap.base);   // phase 5f: unlink the hero / remove what the run added to the base BEFORE the texts are restored
    await restore(actor, snap);
    memory.delete(actor.uuid);
    return { ok: true, errors: [], warnings, message: t("IPCA.Done.Undo", { actor: actor.name }) };
  } catch (err) {
    console.error(`${MODULE_ID} | chargen undo failed`, err);
    const e = msg("Err", "UndoFailed", { error: String(err?.message ?? err).replace(/[\s.]+$/, "") });
    return { ok: false, errors: [e], message: e.message };
  }
}

export const applyApi = { plan: planPublic, apply, undo, hasUndo, undoStatus };

/** attaches api.chargen.{catalog, provider, apply} (the wizard UI of later phases uses these) */
export function start() {
  Catalog.start();
  const attach = () => {
    const mod = game.modules.get(MODULE_ID);
    if (!mod) return;
    (mod.api ??= {});
    mod.api.chargen = { ...(mod.api.chargen ?? {}), apply: applyApi };
  };
  if (globalThis.game?.ready) attach(); else { Hooks.once("init", attach); Hooks.once("ready", attach); }
}
