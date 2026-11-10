/* Tactical combat, package P2: SYSTEM ADAPTER (spec section 11). THE ONLY FILE of the tactics folder that touches the game system `invincible`
   (third-party, hooked, never edited). Everything it relies on that the system does not document is listed in PRIVATE_NAMES; `compat()` checks
   each name against the running system, so a system update shows as one failing list (check-pure.mjs guards that no other file names the system).
   Foundry globals are used only inside functions: importing this file in node is harmless. NOTHING HERE IS VERIFIED LIVE YET (see the handoff). */

export const SYSTEM_ID = "invincible";
export const SYSTEM_VERIFIED = "2.1.8";
const MOD = "invincible-plus-ultra";
const ROLL_DIALOG_PATH = "systems/invincible/system/applications/dialog/roll-dialog.mjs";
const STUNT_DIALOG_PATH = "systems/invincible/system/applications/dialog/stunts.mjs";
const INJURY_PACK = "invincible.critical-injuries";
const INJURY_TABLE = "Compendium.invincible.rolltables.RollTable.lRIHdMV6UBdDaeae";
export const ATTRS = Object.freeze(["fighting", "agility", "strength", "reason", "intuition", "presence"]);
/** Engine field name -> system data path. The journal stores the field name, never the path (journal-pure.mjs, op `actor`). */
export const FIELDS = Object.freeze({ health: "system.derived.health.value", resolve: "system.derived.resolve.value" });

/** Every private name this file uses. `where` is checked by compat(). */
export const PRIVATE_NAMES = Object.freeze([
  { name: "roll dialog class", where: ROLL_DIALOG_PATH, need: "default export; constructor(rollName, { actor, breakdown, bonus, maxPush, rollOptions, attribute }); wait() or render()" },
  { name: "stunts dialog class", where: STUNT_DIALOG_PATH, need: "default export with prototype.wait (wrapped: no pop-up for tactical rolls)" },
  { name: "roll options pass-through", where: "message.rolls[0].options", need: "rollOptions given to the dialog arrive there (tactics = { inst, key, rid })" },
  { name: "roll result getters", where: "message.rolls[0]", need: "successCount, baneCount, pushCount, pushable" },
  { name: "actor attributes", where: "actor.system.attributes.<attr>.value", need: "six attributes" },
  { name: "Health / Resolve", where: "actor.system.derived.health|resolve.{value,max}", need: "numbers; minions: Health value = members" },
  { name: "slugfest damage", where: "actor.system.derived.slugfest.damage", need: "number" },
  { name: "armor", where: "actor.system.bonuses.armorProtection", need: "object of numbers; the highest counts" },
  { name: "actor types", where: "actor.type", need: "superhero | npc | minions | challenge | vehicle" },
  { name: "injury item type", where: "item.type === 'criticalInjury'", need: "embedded Item" },
  { name: "weapon automation", where: "item.system.automations[first].{rollBonus, baseDamage, minRange, maxRange}", need: "gear / power items that attack" },
  { name: "injuries pack", where: INJURY_PACK, need: "Item compendium" },
  { name: "injuries table", where: INJURY_TABLE, need: "RollTable whose results (range) point at the pack's items" },
]);

const route = (p) => globalThis.foundry?.utils?.getRoute?.(p) ?? `/${p}`;
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
let DLG = null, STUNTS = null, INJ = null;

async function rollDialog() { DLG ??= (await import(route(ROLL_DIALOG_PATH)))?.default ?? null; return DLG; }
/** The system's stunt pop-up never opens for a roll that belongs to the engine (spec 11 "Stunts": step 7 of the flow decides). Idempotent, guarded. */
export async function patchStunts() {
  try {
    STUNTS ??= (await import(route(STUNT_DIALOG_PATH)))?.default ?? null;
    const proto = STUNTS?.prototype;
    if (!proto || typeof proto.wait !== "function" || proto.wait.itacPatched) return !!proto;
    const original = proto.wait;
    const wrapped = function (...args) { try { if (tacticsOf(this.message)) return Promise.resolve(undefined); } catch { /* fall through to the system */ } return original.apply(this, args); };
    wrapped.itacPatched = true; if (original.ispPatched) wrapped.ispPatched = true;
    proto.wait = wrapped;
    return true;
  } catch (err) { console.warn(`${MOD} | tactics: stunts dialog not patched`, err); return false; }
}

/** Live compatibility check: [{ name, ok, detail }]. Run from api.tactics.compat() or at start (logged once when something fails). */
export async function compat() {
  const out = [], add = (name, ok, detail = "") => out.push({ name, ok: !!ok, detail });
  add("system id and version", game.system?.id === SYSTEM_ID, `${game.system?.id} ${game.system?.version} (verified ${SYSTEM_VERIFIED})`);
  try { const D = await rollDialog(); add("roll dialog class", typeof D === "function" && (typeof D.prototype.wait === "function" || typeof D.prototype.render === "function")); } catch (e) { add("roll dialog class", false, String(e)); }
  try { add("stunts dialog class", await patchStunts()); } catch (e) { add("stunts dialog class", false, String(e)); }
  const a = game.actors?.find((x) => ["superhero", "npc"].includes(x.type));
  if (a) {
    add("actor attributes", ATTRS.every((k) => Number.isFinite(a.system?.attributes?.[k]?.value)));
    add("Health / Resolve", Number.isFinite(a.system?.derived?.health?.value) && Number.isFinite(a.system?.derived?.resolve?.value));
    add("slugfest damage", Number.isFinite(a.system?.derived?.slugfest?.damage));
    add("armor", a.system?.bonuses === undefined || typeof a.system.bonuses === "object");
  } else add("actor data", false, "no superhero or npc actor in the world to look at");
  add("injuries pack", !!game.packs?.get(INJURY_PACK));
  try { add("injuries table", !!(await fromUuid(INJURY_TABLE))); } catch (e) { add("injuries table", false, String(e)); }
  const m = [...(game.messages?.contents ?? [])].reverse().find((x) => x.rolls?.[0]?.options?.game === "inv" || x.rolls?.[0]?.terms?.[0]?.constructor?.TYPE === "base");
  if (m) add("roll result getters", ["successCount", "baneCount", "pushCount"].every((k) => Number.isFinite(m.rolls[0][k])) && typeof m.rolls[0].pushable === "boolean");
  else add("roll result getters", false, "no system roll in the chat log to look at");
  return out;
}

/* ------------------------------------------------------------------ facts about a combatant's actor (what engine-pure's facts.c(cid) carries) */
const injuryNumber = (item) => { const f = item.flags?.[MOD]?.tactics?.crit; if (Number.isFinite(f)) return f; const n = INJ?.byName?.get(item.name); return Number.isFinite(n) ? n : null; };
export function actorFacts(actor) {
  if (!actor) return null;
  const s = actor.system ?? {};
  const attrs = Object.fromEntries(ATTRS.map((k) => [k, num(s.attributes?.[k]?.value)]));
  const armorMax = Math.max(0, ...Object.values(s.bonuses?.armorProtection ?? {}).map((v) => num(v)));
  const kind = actor.type === "superhero" ? "hero" : actor.type === "minions" ? "minions" : actor.type === "challenge" ? "challenge" : actor.type === "vehicle" ? "vehicle" : "npc";
  const flags = actor.flags?.[MOD]?.tactics ?? {};
  return {
    kind, npc: kind !== "hero", attrs,
    health: num(s.derived?.health?.value), maxHealth: num(s.derived?.health?.max), resolve: num(s.derived?.resolve?.value), maxResolve: num(s.derived?.resolve?.max),
    crits: actor.items.filter((i) => i.type === "criticalInjury").map(injuryNumber).filter((n) => n != null),
    unknownInjuries: actor.items.filter((i) => i.type === "criticalInjury" && injuryNumber(i) == null).length,     // injuries added by hand that the table does not resolve: shown to the GM, never guessed
    armor: armorMax > 0 ? [{ id: "armor", armor: armorMax }] : [],
    slugfest: { damage: num(s.derived?.slugfest?.damage) },
    members: kind === "minions" ? num(s.derived?.health?.value) : undefined,           // the system keeps a group's size as its Health [B2827]
    huge: flags.huge === true, major: flags.major === true, immunities: Array.isArray(flags.immunities) ? flags.immunities : [], vulnerabilities: Array.isArray(flags.vulnerabilities) ? flags.vulnerabilities : [],
  };
}
/** A weapon (or attacking power) of the actor as the attack flow needs it. `ref` = item id or uuid. Sharp damage has no system field: the item flag
    `flags.invincible-plus-ultra.tactics.sharp` (set by the GM) carries it [R9]; absent = not sharp. Returns null when the item is not the actor's. */
export function weaponFacts(actor, ref) {
  const item = actor?.items?.get?.(ref) ?? actor?.items?.find?.((i) => i.uuid === ref) ?? null;
  if (!item) return null;
  const autos = item.system?.automations ?? {}, a = autos[Object.keys(autos)[0]] ?? {};
  const min = num(a.minRange, NaN), max = num(a.maxRange, NaN);
  return { id: item.id, name: item.name, bonus: num(a.rollBonus), damage: Number.isFinite(Number(a.baseDamage)) && Number(a.baseDamage) > 0 ? Number(a.baseDamage) : null,
    range: Number.isFinite(max) && (min > 0 || max > 0) ? [Number.isFinite(min) ? min : 0, max] : null, sharp: item.flags?.[MOD]?.tactics?.sharp === true };
}
/** The value behind an engine field name (drift check of an undo, journal-pure.driftOf). */
export const actorValue = (actor, field) => (FIELDS[field] ? num(foundry.utils.getProperty(actor, FIELDS[field]), null) : null);
/** Write an engine field. Returns the journal op. The option `ipuTactics` lets the legacy heuristics of scripts/module.js skip or label it (spec 1.3). */
export async function setActorField(actor, field, to, txId) {
  const path = FIELDS[field];
  if (!actor || !path) return null;
  const from = num(foundry.utils.getProperty(actor, path), 0);
  const value = Math.max(0, Math.trunc(num(to)));
  if (from !== value) await actor.update({ [path]: value }, { ipuTactics: txId ?? true });
  return { t: "actor", uuid: actor.uuid, path: field, from, to: value };
}

/* ------------------------------------------------------------------ critical injuries: the number comes from the rules library, the item from the system's pack */
async function injuries() {
  if (INJ) return INJ;
  const byNumber = new Map(), byName = new Map();
  try {
    const table = await fromUuid(INJURY_TABLE);
    for (const r of table?.results ?? []) {
      const [lo, hi] = r.range ?? [];
      const uuid = r.documentUuid ?? (r.documentCollection && r.documentId ? `Compendium.${r.documentCollection}.Item.${r.documentId}` : null);
      const name = r.name ?? r.text ?? r.description ?? "";
      if (!Number.isFinite(lo)) continue;
      for (let n = lo; n <= (Number.isFinite(hi) ? hi : lo); n++) byNumber.set(n, { uuid, name });
      if (name) byName.set(name, lo);
    }
  } catch (err) { console.warn(`${MOD} | tactics: injuries table unreadable`, err); }
  INJ = { byNumber, byName, top: Math.max(0, ...byNumber.keys()) };
  return INJ;
}
export const warmUp = async () => { await injuries(); await patchStunts(); };
/** Embed injury number `n` on the actor. Returns the journal op `item+`, or null when the pack has no such row (then the GM is told by the executor). */
export async function addInjury(actor, n, txId) {
  const idx = await injuries();
  const row = idx.byNumber.get(n) ?? idx.byNumber.get(Math.min(n, idx.top));           // 13+ is one row [B2764]
  let data = null;
  try { const src = row?.uuid ? await fromUuid(row.uuid) : null; if (src) data = src.toObject(); } catch { /* below */ }
  if (!data) { const pack = game.packs.get(INJURY_PACK); const hit = row?.name ? pack?.index?.find((e) => e.name === row.name) : null; if (hit) data = (await pack.getDocument(hit._id))?.toObject() ?? null; }
  if (!data || !actor) return null;
  delete data._id;
  data.flags = { ...(data.flags ?? {}), [MOD]: { ...(data.flags?.[MOD] ?? {}), tactics: { crit: n, tx: txId ?? null } } };
  const [item] = await actor.createEmbeddedDocuments("Item", [data], { ipuTactics: txId ?? true });
  return item ? { t: "item+", actorUuid: actor.uuid, itemId: item.id, data: { name: item.name, crit: n } } : null;
}

/* ------------------------------------------------------------------ rolls */
const attrLabel = (a) => { const k = `INVINCIBLE.Actor.base.FIELDS.attributes.${a}.label`, t = game.i18n.localize(k); return t === k ? a : t; };
/** On the ROLLER's client: open the system's roll dialog for an engine roll request. The dice are evaluated here, as everywhere in Foundry (spec 11).
    `labelOf(source)` localises a modifier source (lang.mjs). Deliberately no `attackInfo`: the system then adds neither its stunt pop-up nor its
    "apply damage" button to the card, and steps 7-8 of the flow stay the engine's. */
export async function openRoll(req, labelOf = (s) => s) {
  const Dlg = await rollDialog();
  if (typeof Dlg !== "function") throw new Error("roll dialog unavailable");
  const actor = req.actorUuid ? await fromUuid(req.actorUuid) : null;
  if (!actor) throw new Error("no actor for the roll");
  const breakdown = {};
  const put = (name, v) => { if (!v) return; let k = String(name), i = 2; while (k in breakdown) k = `${name} (${i++})`; breakdown[k] = v; };
  put(req.attr ? attrLabel(req.attr) : labelOf("base"), num(req.pool?.base));
  for (const m of req.pool?.mods ?? []) put(labelOf(m.source), num(m.dice));
  const sum = Object.values(breakdown).reduce((a, b) => a + b, 0);
  if (sum !== num(req.dice)) put(labelOf("floor"), num(req.dice) - sum);                 // the one-die floor of the rules library, shown as its own line
  const opts = { actor, breakdown, bonus: 0, rollOptions: { tactics: { inst: req.inst, key: req.key, rid: req.rid } }, attribute: req.attr ?? undefined };
  if (req.maxPush === 0) opts.maxPush = 0;                                               // passive and defender rolls are never pushed [B2227], [B2241]
  const dlg = new Dlg(String(req.label ?? req.key), opts);
  return typeof dlg.wait === "function" ? dlg.wait() : dlg.render({ force: true });
}
/** The engine tag of a chat message's roll, or null. */
export function tacticsOf(message) {
  const t = message?.rolls?.[0]?.options?.tactics;
  return t && typeof t.inst === "string" && typeof t.key === "string" && typeof t.rid === "string" ? { inst: t.inst, key: t.key, rid: t.rid } : null;
}
/** Read an engine roll from its chat message (executor). Identity = the message author as the server delivered it. */
export function readRollMessage(message) {
  const tag = tacticsOf(message), roll = message?.rolls?.[0];
  if (!tag || !roll) return null;
  const sixes = Number(roll.successCount), ones = Number(roll.baneCount);
  if (!Number.isFinite(sixes)) return null;
  return { ...tag, author: message.author?.id ?? null, sixes, ones: Number.isFinite(ones) ? ones : 0, pushed: num(roll.pushCount), pushable: roll.pushable === true, messageId: message.id };
}
/** Journal op `message` inverse: struck through, never deleted (spec 15). */
export async function strikeMessage(id) {
  const m = game.messages.get(id);
  if (m) await m.update({ [`flags.${MOD}.tactics.undone`]: true }, { ipuTactics: true });
}
/** Is this document update one the engine made (legacy code may skip it)? */
export const isEngineUpdate = (options) => options?.ipuTactics !== undefined;
