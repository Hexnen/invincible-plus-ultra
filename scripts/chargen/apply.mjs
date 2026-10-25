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

const msg = (kind, code, params = {}, extra = {}) => ({ code, key: `IPCA.${kind}.${code}`, params, message: t(`IPCA.${kind}.${code}`, params), ...extra });
const getp = (obj, path) => foundry.utils.getProperty(obj, path);
const clone = (x) => (x === undefined ? undefined : foundry.utils.deepClone(x));
const emptyCounts = () => Object.fromEntries([...WIPE_TYPES, "total"].map((k) => [k, 0]));

/* ------------------------------------------------------------------ state -> actor field values */
function fieldValues(state) {
  const f = {};
  const text = (path, v) => { const s = String(v ?? "").trim(); if (s) f[path] = s; };
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
  text("system.team", state.team?.name);
  const ups = (state.team?.upgrades ?? []).filter(Boolean);
  text("system.teamBase", [state.team?.base, ups.length ? `upgrades: ${ups.join(", ")}` : ""].filter(Boolean).join("; "));
  f["system.reputation"] = RANKS[state.rank]?.reputation ?? 0;
  f["system.resources"] = Number(state.resources) || 0;
  return f;
}

/* ------------------------------------------------------------------ item data builders */
function baseItemData(doc, runId) {
  const d = doc.toObject();
  delete d._id; delete d.folder; delete d.ownership; delete d._stats;
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
  const out = { ok: false, actor: { id: actor?.id, name: actor?.name }, runId: foundry.utils.randomID(), errors, warnings, fields: [], creates: [], deletes: [], keeps: [], counts: { create: emptyCounts(), delete: emptyCounts(), fields: 0, keeps: 0 }, destructive: false, _ops: null };
  if (!actor || actor.type !== "superhero") { errors.push(msg("Err", "WrongType", { actor: actor?.name ?? "?" })); return out; }
  if (!actor.isOwner) errors.push(msg("Err", "NotOwner", { actor: actor.name }));
  const v = validate(state);
  for (const i of v.errors) errors.push({ code: i.code, key: i.key, params: i.params, path: i.path, step: i.step, message: i.key });
  if (v.errors.length) errors.unshift(msg("Err", "Invalid", { count: v.errors.length }));
  for (const i of v.warnings ?? []) warnings.push({ code: i.code, key: i.key, params: i.params, path: i.path, step: i.step, message: i.key });
  const av = Catalog.available();
  if (!av.ok) { errors.push(msg("Err", "NoPacks", { missing: av.missing.join(", ") })); return out; }
  if (errors.length) return finishCounts(out, actor, state);

  // resolve every document BEFORE anything is written
  const ops = { sources: [], powers: [], links: [], talents: [] };
  const need = async (type, ref, kind, opts) => {
    const doc = await Catalog.resolveDoc(type, ref, opts);
    if (!doc) errors.push(msg("Err", "Unresolved", { kind, name: ref?.name ?? "?" }));
    return doc;
  };
  for (const s of state.sources ?? []) {
    const doc = await Catalog.resolveDoc("powerSource", s);
    if (!doc) warnings.push(msg("Warn", "CustomSource", { name: s.name }));
    ops.sources.push({ key: s.key, name: doc?.name ?? s.name, doc });
  }
  for (const p of state.powers ?? []) {
    const doc = await need("power", p, "Power", { level: p.level });
    const split = !!doc && (await Catalog.findPower(p))?.split;
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
    out.creates.push({ kind: "power", type: "power", name: p.doc.name, level: lvl(p.state.level), source: src?.name });
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
  const vals = fieldValues(state);
  const flagPath = `flags.${MODULE_ID}.chargen`;
  for (const [path, to] of Object.entries(vals)) {
    const from = getp(actor._source, path) ?? ""; // SOURCE value: actor.system holds effect-modified numbers (Renowned +3 ...)
    if (from !== to) out.fields.push({ path, from, to });
  }
  out.fields.push({ path: flagPath, from: getp(actor._source, flagPath)?.rank ?? null, to: state.rank });
  out._ops = ops;
  out._vals = vals;
  out.ok = true;
  return finishCounts(out, actor, state);
}
function finishCounts(out) {
  for (const c of out.creates) { out.counts.create[c.type]++; out.counts.create.total++; }
  for (const d of out.deletes) { out.counts.delete[d.type]++; out.counts.delete.total++; }
  out.counts.fields = out.fields.length;
  out.counts.keeps = out.keeps.length;
  out.destructive = out.deletes.length > 0;
  out.ok = out.ok && !out.errors.length;
  return out;
}
const publicPlan = (p) => { const { _ops, _vals, ...rest } = p; return rest; };
/** the plan without internals (safe to hand to a UI / JSON) */
export async function planPublic(actor, state) { return publicPlan(await plan(actor, state)); }

/* ------------------------------------------------------------------ apply */
export async function apply(actor, state, { confirmed = false } = {}) {
  const p = await plan(actor, state);
  const base = { ok: false, plan: publicPlan(p), runId: p.runId, errors: p.errors, warnings: p.warnings, created: [], deleted: [] };
  if (!p.ok) return { ...base, message: p.errors[0]?.message ?? "" };
  if (p.destructive && confirmed !== true) {
    const e = msg("Err", "NeedConfirm", { count: p.deletes.length, actor: actor.name });
    return { ...base, errors: [e, ...p.errors], message: e.message };
  }
  const ops = p._ops, vals = p._vals;
  const runId = p.runId;
  const flagPath = `flags.${MODULE_ID}.chargen`;
  const backupPath = `flags.${MODULE_ID}.chargenBackup`;

  // snapshot (everything we are about to overwrite)
  const snap = { runId, at: Date.now(), fields: {}, unset: [], items: actor.items.filter((i) => WIPE_TYPES.includes(i.type)).map((i) => i.toObject()), prevChargen: clone(getp(actor._source, flagPath)), prevBackup: clone(getp(actor._source, backupPath)) };
  for (const path of [...Object.keys(vals), "system.derived.health.value", "system.derived.resolve.value"]) {
    const cur = getp(actor._source, path); // source data, NOT the effect-modified actor.system value
    if (cur === undefined) snap.unset.push(path); else snap.fields[path] = clone(cur);
  }
  const warnings = [...p.warnings];
  let stage = "snapshot";
  const created = [];
  try {
    // 1. wipe
    stage = "wipe";
    if (snap.items.length) await actor.deleteEmbeddedDocuments("Item", snap.items.map((i) => i._id));
    // 2. power sources
    stage = "powerSource";
    const sourceId = {};
    if (ops.sources.length) {
      const data = ops.sources.map((s) => (s.doc ? baseItemData(s.doc, runId) : { name: s.name, type: "powerSource", img: SOURCE_IMG, system: { description: "" }, flags: { [MODULE_ID]: { chargenRun: runId } } }));
      const docs = await actor.createEmbeddedDocuments("Item", data);
      docs.forEach((d, i) => { sourceId[ops.sources[i].key] = d.id; created.push(d.id); });
    }
    // 3. powers
    stage = "power";
    const powerId = {};
    if (ops.powers.length) {
      const data = ops.powers.map((o) => {
        const d = baseItemData(o.doc, runId);
        d.system.powerSource = sourceId[o.state.sourceKey] ?? "";
        if (!o.split && o.state.level > 0) { d.system.level = LEVEL_WORDS[o.state.level]; applyLevelToAutomations(d, o.state.level); }
        return d;
      });
      const docs = await actor.createEmbeddedDocuments("Item", data);
      docs.forEach((d, i) => { powerId[ops.powers[i].key] = d.id; created.push(d.id); });
    }
    // 4. boosts / limits
    stage = "boost/limit";
    if (ops.links.length) {
      const data = ops.links.map((l) => { const d = baseItemData(l.doc, runId); d.system.power = powerId[l.powerKey]; return d; });
      const docs = await actor.createEmbeddedDocuments("Item", data);
      docs.forEach((d) => created.push(d.id));
    }
    // 5. talents / drawbacks
    stage = "talent/drawback";
    if (ops.talents.length) {
      const data = ops.talents.map((x) => { const d = baseItemData(x.doc, runId); if (x.note) d.name = `${d.name} (${x.note})`; return d; });
      const docs = await actor.createEmbeddedDocuments("Item", data);
      docs.forEach((d) => created.push(d.id));
    }
    // 6. actor fields + marker flag + backup
    stage = "actor";
    const update = { ...vals };
    update[flagPath] = { v: 1, runId, rank: state.rank, archetype: state.archetype ?? null, identity: state.identity ?? null, mode: state.mode ?? "manual", seed: state.seed ?? null, createdAt: Date.now(), appliedBy: game.user.id };
    const backup = { runId, at: snap.at, fields: snap.fields, unset: snap.unset, items: snap.items, prevChargen: snap.prevChargen ?? null };
    if (JSON.stringify(backup).length < BACKUP_LIMIT) update[backupPath] = backup;
    else warnings.push(msg("Warn", "NoBackupFlag"));
    await actor.update(update);
    // 7. current Health / Resolve = derived max (after the items' effects exist)
    stage = "health";
    const hp = actor.system.derived.health.max, rp = actor.system.derived.resolve.max;
    await actor.update({ "system.derived.health.value": hp, "system.derived.resolve.value": rp });
  } catch (err) {
    console.error(`${MODULE_ID} | chargen apply failed at ${stage}`, err);
    const reason = err?.message ?? String(err);
    try {
      await restore(actor, snap, created);
      const e = msg("Err", "Failed", { stage, error: reason });
      return { ...base, errors: [e], warnings, created: [], deleted: [], rolledBack: true, message: e.message };
    } catch (rb) {
      console.error(`${MODULE_ID} | chargen rollback failed`, rb);
      memory.set(actor.uuid, snap);
      const e = msg("Err", "RollbackFailed", { stage, error: reason, rollback: rb?.message ?? String(rb), actor: actor.name });
      return { ...base, errors: [e], warnings, rolledBack: false, message: e.message };
    }
  }
  memory.set(actor.uuid, snap);
  const message = t("IPCA.Done.Apply", { actor: actor.name, created: created.length, deleted: snap.items.length, fields: p.fields.length });
  return { ...base, ok: true, errors: [], warnings, created, deleted: snap.items.map((i) => i._id), message };
}

/** put the actor back: delete what this run created, re-create the wiped items with their old ids, restore field values */
async function restore(actor, snap, createdIds = null) {
  const mine = actor.items.filter((i) => (createdIds ? createdIds.includes(i.id) : getp(i, `flags.${MODULE_ID}.chargenRun`) === snap.runId)).map((i) => i.id);
  if (mine.length) await actor.deleteEmbeddedDocuments("Item", mine);
  const clash = new Set(actor.items.map((i) => i.id));
  const back = snap.items.filter((i) => !clash.has(i._id));
  if (back.length) await actor.createEmbeddedDocuments("Item", back, { keepId: true });
  const upd = { ...snap.fields };
  const flagPath = `flags.${MODULE_ID}`;
  if (snap.prevChargen) upd[`${flagPath}.chargen`] = snap.prevChargen; else upd[`${flagPath}.-=chargen`] = null;
  if (createdIds && snap.prevBackup) upd[`${flagPath}.chargenBackup`] = snap.prevBackup; // failed run: the older undo backup stays
  else upd[`${flagPath}.-=chargenBackup`] = null;
  await actor.update(upd);
}

export function hasUndo(actor) {
  return !!actor && (memory.has(actor.uuid) || !!getp(actor._source, `flags.${MODULE_ID}.chargenBackup`));
}

export async function undo(actor) {
  const snap = memory.get(actor?.uuid) ?? getp(actor?._source, `flags.${MODULE_ID}.chargenBackup`);
  if (!snap) { const e = msg("Err", "NoUndo", { actor: actor?.name ?? "?" }); return { ok: false, errors: [e], message: e.message }; }
  if (!actor.isOwner) { const e = msg("Err", "NotOwner", { actor: actor.name }); return { ok: false, errors: [e], message: e.message }; }
  try {
    await restore(actor, snap);
    memory.delete(actor.uuid);
    return { ok: true, errors: [], message: t("IPCA.Done.Undo", { actor: actor.name }) };
  } catch (err) {
    console.error(`${MODULE_ID} | chargen undo failed`, err);
    const e = msg("Err", "UndoFailed", { error: err?.message ?? String(err) });
    return { ok: false, errors: [e], message: e.message };
  }
}

export const applyApi = { plan: planPublic, apply, undo, hasUndo };

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
