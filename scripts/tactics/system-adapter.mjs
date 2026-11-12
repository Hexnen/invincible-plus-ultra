/* Tactical combat: SYSTEM ADAPTER (spec section 11). THE ONLY FILE of the tactics folder that touches the game system `invincible`
   (third-party, hooked, never edited). Everything it relies on that the system does not document is listed in PRIVATE_NAMES; `compat()` checks
   each name against the running system, so a system update shows as one failing list (check-pure.mjs guards that no other file names the system).
   Foundry globals are used only inside functions: importing this file in node is harmless. NOTHING HERE IS VERIFIED LIVE YET (see the handoff).
   Three groups: who takes part in a round (participants, talents, ownership, the end-of-scene facts: the round driver's readers),
   what a combatant is for an action (actorFacts, weaponFacts: the action engine's readers), and the writes and rolls of the engine.
   Talents: the system gives them no key, only a name. C8 (the user, 2026-11-12, K5: «Po identyfikatorze z kompendium»): Combat Veteran and
   Fast Reflexes are recognised FIRST by the compendium identifier the item came from (its compendium source, or its own id on an imported
   pregenerated character: scripts/i18n/item-ids.mjs), so a renamed or translated talent still counts; then by the explicit actor flag
   flags.<module>.tactics.talents = { combatVeteran, fastReflexes }; then by the English item name (case-insensitive) as the last fallback. */
import * as S from "./state-pure.mjs";
import * as O from "./ops-pure.mjs";
import { weapons, vehicles } from "../rules/index.mjs";
import * as Kit from "./kit-pure.mjs";
import * as Moves from "./moves-pure.mjs";
import { note as trace } from "./trace-pure.mjs";
export { trace };      // D125: the engine's facts reader notes a combatant it cannot read through the same trace
import { labelVariants } from "../i18n/sys-labels.mjs"; import { PACK_IDS, EMBEDDED_IDS } from "../i18n/item-ids.mjs";      // C8: the talents' compendium ids
import { showKit } from "../i18n/kit-names.mjs";      // what the kit SHOWS takes the name this client displays; it is still built from the stored names
import { cardTitle } from "./lang.mjs";

export const SYSTEM_ID = "invincible";
export const SYSTEM_VERIFIED = "2.1.8";
const MOD = "invincible-plus-ultra";
const ROLL_DIALOG_PATH = "systems/invincible/system/applications/dialog/roll-dialog.mjs";
const STUNT_DIALOG_PATH = "systems/invincible/system/applications/dialog/stunts.mjs";
const INJURY_PACK = "invincible.critical-injuries";
const INJURY_TABLE = "Compendium.invincible.rolltables.RollTable.lRIHdMV6UBdDaeae";
export const ATTRS = Object.freeze(["fighting", "agility", "strength", "reason", "intuition", "presence"]);
/** Engine field name -> system data path. The journal stores the field name, never the path (journal-pure.mjs, op `actor`). */
export const FIELDS = Object.freeze({ health: "system.derived.health.value", resolve: "system.derived.resolve.value", maxHealth: "system.derived.health.max", maxResolve: "system.derived.resolve.max" });     // D102: maxHealth / maxResolve (a challenge preset sets the rating and the time limit)

/** Every private name this file uses. `where` is checked by compat(). */
export const PRIVATE_NAMES = Object.freeze([
  { name: "roll dialog class", where: ROLL_DIALOG_PATH, need: "default export; constructor(rollName, { actor, breakdown, bonus, maxPush, rollOptions, attribute }); wait() or render()" },
  { name: "stunts dialog class", where: STUNT_DIALOG_PATH, need: "default export with prototype.wait (wrapped: no pop-up for tactical rolls)" },
  { name: "roll options pass-through", where: "message.rolls[0].options", need: "rollOptions given to the dialog arrive there (tactics = { inst, key, rid })" },
  { name: "roll without the dialog", where: ROLL_DIALOG_PATH, need: "prototype._prepareContext() and prototype._roll({ submitter: { dataset: { action: <chat mode> } } }) (U2 / U7: the engine's rolls are thrown at once)" },
  { name: "push / accept of a roll", where: "ui.chat.options.actions.{pushRoll, acceptRoll}", need: "handlers that read the message id from event.target.closest('[data-message-id]').dataset (U1: the dock's own buttons)" },
  { name: "roll result getters", where: "message.rolls[0]", need: "successCount, baneCount, pushCount, pushable" },
  { name: "actor attributes", where: "actor.system.attributes.<attr>.value", need: "six attributes" },
  { name: "Health / Resolve", where: "actor.system.derived.health|resolve.{value,max}", need: "numbers; minions: Health value = members" },
  { name: "slugfest damage", where: "actor.system.derived.slugfest.damage", need: "number" },
  { name: "armor", where: "actor.system.bonuses.armorProtection", need: "object of numbers; the highest counts" },
  { name: "actor types", where: "actor.type", need: "superhero | npc | minions | challenge | vehicle" },
  { name: "injury item type", where: "item.type === 'criticalInjury'", need: "embedded Item" },
  { name: "weapon automation", where: "item.system.automations[first].{rollBonus, baseDamage, minRange, maxRange}", need: "gear / power items that attack" },
  { name: "item automations", where: "item.system.automations{}.{name,type,showAsSelection,attribute,rollBonus,stressCost,baseDamage,minRange,maxRange,bypassArmor}", need: "P6: what an item does; item.system.{level,power,boosts}" },
  { name: "sheet bonuses", where: "actor.system.bonuses.<key>{}", need: "P6: numbers per source; keys = the six attributes, attack, block, dodge, charge, grapple, armorProtection" },
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

/** U73 (pure): is the pack `id` ("invincible.critical-injuries") one the system declares (`declared`: the pack names of its manifest)
    and the world does not have (`has(id)`)? Then the server could not open it; the system did not change. */
export const closedPack = (id, declared, has) => { const [sys, name] = String(id ?? "").split("."); return sys === SYSTEM_ID && !!name && (declared ?? []).includes(name) && !has(id); };
/** U73 (pure): the compat list in the two sentences the GM is told: what changed in the system, and which compendia the server did not open. */
export const compatNotes = (list) => { const bad = (list ?? []).filter((x) => !x.ok); return { changed: bad.filter((x) => !x.closed).map((x) => x.name), closed: [...new Set(bad.filter((x) => x.closed).map((x) => x.closed))] }; };
/** Live compatibility check: [{ name, ok, detail }]. Run from api.tactics.compat() or at start (logged once when something fails). */
export async function compat() {
  const out = [], add = (name, ok, detail = "") => out.push({ name, ok: !!ok, detail });
  add("system id and version", game.system?.id === SYSTEM_ID, `${game.system?.id} ${game.system?.version} (verified ${SYSTEM_VERIFIED})`);
  try { const D = await rollDialog(); add("roll dialog class", typeof D === "function" && (typeof D.prototype.wait === "function" || typeof D.prototype.render === "function")); } catch (e) { add("roll dialog class", false, String(e)); }
  try { const D = await rollDialog(); add("roll without the dialog", typeof D?.prototype?._prepareContext === "function" && typeof D?.prototype?._roll === "function"); } catch (e) { add("roll without the dialog", false, String(e)); }
  { const acts = ui.chat?.options?.actions ?? CONFIG.ui?.chat?.DEFAULT_OPTIONS?.actions; add("push / accept of a roll", typeof acts?.pushRoll === "function" && typeof acts?.acceptRoll === "function"); }
  try { add("stunts dialog class", await patchStunts()); } catch (e) { add("stunts dialog class", false, String(e)); }
  const a = game.actors?.find((x) => ["superhero", "npc"].includes(x.type));
  if (a) {
    add("actor attributes", ATTRS.every((k) => Number.isFinite(a.system?.attributes?.[k]?.value)));
    add("Health / Resolve", Number.isFinite(a.system?.derived?.health?.value) && Number.isFinite(a.system?.derived?.resolve?.value));
    add("slugfest damage", Number.isFinite(a.system?.derived?.slugfest?.damage));
    add("armor", a.system?.bonuses === undefined || typeof a.system.bonuses === "object");
  } else add("actor data", false, "no superhero or npc actor in the world to look at");
  /* U73: a compendium the system's manifest still declares but this server did not open is NOT a changed system: the world runs without
     it (a second Foundry server on the same data folder holds the pack's files, or the pack is damaged). It is named as that (`closed`),
     with its own sentence (main.mjs), so the GM looks at the server and not at the system's version. */
  const closed = (id) => closedPack(id, [...(game.system?.packs ?? [])].map((p) => p?.name ?? p?.id ?? ""), (k) => !!game.packs?.get(k));
  const pack = (name, id, ok) => out.push({ name, ok: !!ok, detail: !ok && closed(id) ? "the server did not open this compendium" : "", ...(!ok && closed(id) ? { closed: id } : {}) });
  pack("injuries pack", INJURY_PACK, !!game.packs?.get(INJURY_PACK));
  let table = false; try { table = !!(await fromUuid(INJURY_TABLE)); } catch { table = false; }
  pack("injuries table", INJURY_TABLE.split(".").slice(1, 3).join("."), table);
  const m = [...(game.messages?.contents ?? [])].reverse().find((x) => x.rolls?.[0]?.options?.game === "inv" || x.rolls?.[0]?.terms?.[0]?.constructor?.TYPE === "base");
  if (m) add("roll result getters", ["successCount", "baneCount", "pushCount"].every((k) => Number.isFinite(m.rolls[0][k])) && typeof m.rolls[0].pushable === "boolean");
  else add("roll result getters", false, "no system roll in the chat log to look at");
  return out;
}

/* ------------------------------------------------------------------ facts about a combatant's actor (what engine-pure's facts.c(cid) carries) */
/* ------------------------------------------------------------------ who takes part in a round (the round driver's readers) */
export const TALENT_NAMES = { combatVeteran: ["combat veteran"], fastReflexes: ["fast reflexes"] };
/* C8 (K5): the compendium identifiers of the two talents (the generated table: 16 characters each, glued together) */
export const TALENT_IDS = Object.freeze(Object.fromEntries([["combatVeteran", "Combat Veteran"], ["fastReflexes", "Fast Reflexes"]].map(([k, en]) => [k, new Set(`${PACK_IDS.talent?.[en] ?? ""}${EMBEDDED_IDS.talent?.[en] ?? ""}`.match(/.{16}/g) ?? [])])));
/** C8: does this talent item come from the compendium entry of `key` (its compendium source, else its own id: an imported pregenerated character)? */
export const talentById = (item, key) => { const ids = TALENT_IDS[key], src = String(item?._stats?.compendiumSource ?? item?._source?._stats?.compendiumSource ?? item?.flags?.core?.sourceId ?? "").split(".").pop(); return !!ids && item?.type === "talent" && (ids.has(src) || ids.has(String(item.id ?? item._id ?? ""))); };
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export const actorOf = (c) => c?.token?.actor ?? c?.actor ?? null;
export function hasTalent(actor, key) {
  try {
    if (actor?.items?.some?.((i) => talentById(i, key))) return true;                // C8 (K5): the compendium identifier first
    const flag = actor?.flags?.[MOD]?.tactics?.talents?.[key];
    if (typeof flag === "boolean") return flag;                                       // then the flag, then the English name
    const names = TALENT_NAMES[key] ?? [];
    return !!actor?.items?.some?.((i) => i.type === "talent" && names.includes(norm(i.name)));
  } catch { return false; }
}
/** the non-GM users who own the combatant's actor (the ones a prompt about it is addressed to) */
export function ownersOf(actor) {
  try { return game.users.filter((u) => !u.isGM && O.ownsFrom(actor?.ownership, u.id, CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3)).map((u) => u.id); } catch { return []; }
}
/** FXP (D160): the player whose assigned character (Foundry's user.character) this actor is, or null: the acting seat of a co-owned hero */
export function playerOf(actor) { try { const id = actor?.isToken ? (actor.token?.actorId ?? actor.id) : actor?.id; return game.users.find((u) => !u.isGM && u.character?.id === id)?.id ?? null; } catch { return null; } }
/** does this user own the combatant (its actor's REAL ownership table; a claimed role never counts)? */
export function owns(combatant, user) {
  const a = actorOf(combatant); return !!a && !!user && O.ownsFrom(a.ownership, user.id, CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3);
}
/** One Participant of ops-pure for a Combatant document. */
export function participant(c) {
  const a = actorOf(c);
  const summonOf = c?.flags?.[MOD]?.tactics?.summonOf;
  return {
    id: c.id,
    hero: S.heroSide(a ? { type: a.type, owned: ownersOf(a).length > 0, disposition: c.token?.disposition ?? a.prototypeToken?.disposition } : null),      // heroes draw before NPCs [B2112] [OQ-13]; D114: a book villain (a superhero actor) is no hero
    owners: ownersOf(a),
    defeated: !!c.isDefeated,
    challenge: a?.type === "challenge",                              // no card [I12] [R22]
    vehicle: a?.type === "vehicle",                                  // P7: no card either, the people aboard act [B2936]
    summonOf: S.isId(summonOf) ? summonOf : null,                    // acts on its owner's turn [I14]; set by the action engine or the GM
    summonDelayed: c?.flags?.[MOD]?.tactics?.summon?.delayed === 1,  // [B1816]: not on the turn it appears
    veteran: hasTalent(a, "combatVeteran"),                          // [I7]
    reflexes: hasTalent(a, "fastReflexes"),                          // [I6]
    resolve: num(a?.system?.derived?.resolve?.value, 0)
  };
}
export const participants = (combat) => { try { return combat.combatants.map(participant); } catch { return []; } };
/** combatants Foundry hides from a non-GM user (spec 10) */
export const hiddenIds = (combat) => { try { return combat.combatants.filter((c) => c.hidden).map((c) => c.id); } catch { return []; } };

/** the facts of the end-of-scene plan (spec 6.8) for every combatant with an actor */
export function sceneFacts(combat) {
  const out = [];
  try {
    for (const c of combat.combatants) {
      const a = actorOf(c);
      if (!a) continue;
      const d = a.system?.derived ?? {};
      out.push({ id: c.id, name: c.name, type: a.type, health: num(d.health?.value), maxHealth: num(d.health?.max), resolve: num(d.resolve?.value), maxResolve: num(d.resolve?.max),
        strength: num(a.system?.attributes?.strength?.value), regeneration: a.flags?.[MOD]?.tactics?.regeneration === true || kitOf(a).pass.regeneration === true });   // Regeneration [B1893]: no key in the system, the flag is set by the GM or P6
    }
  } catch (err) { trace("dropped", "facts", combat?.name ?? "", "", "", err); }      // D125: the end-of-scene facts stop there, and the GM is told
  return out;
}

/* ------------------------------------------------------------------ what a combatant is for an action (the action engine's readers) */
/* D100: when the table was not read yet (or the first read failed) it is asked for again, at most every 5 s: the next reading of the facts has it */
let injAsked = 0; const injuryNumber = (item) => { const f = item.flags?.[MOD]?.tactics?.crit; if (Number.isFinite(f)) return f; if (!INJ && Date.now() - injAsked > 5000) { injAsked = Date.now(); injuries().catch(() => {}); } const n = INJ?.byName?.get(item.name); return Number.isFinite(n) ? n : null; };
/* P3: the ways of moving an actor has: moves-pure.mjs reads the plain items made here (D125: the level as the system reads it, one bad item
   costs that item only); the GM may add ways by hand: flags.<module>.tactics.movement = [{ mode, tier }]. Speeds and rules: scripts/rules/movement.mjs. */
export function movementOf(actor) {
  try {
    const plain = (it) => { try { return { id: it.id, name: it.name, type: it.type, src: it._stats?.compendiumSource ?? null, level: it.system?.level ?? null, autos: it.system?.automations ?? null, boosts: it.system?.boosts }; } catch (err) { trace("dropped", "movement", actor.name, it?.name, "", err); return null; } };
    return Moves.movementOf([...actor.items].map(plain).filter(Boolean), actor.flags?.[MOD]?.tactics?.movement, actor.name);      // one item that cannot be read costs that item only
  } catch (err) { trace("dropped", "movement", actor?.name, "", "", err); return []; }      // an actor the adapter cannot read moves on foot, and the GM is told
}
/* ------------------------------------------------------------------ P6: what the character brings (kit-pure.mjs reads these plain items) */
const listOf = (v) => (v == null ? [] : typeof v === "string" ? [v] : typeof v[Symbol.iterator] === "function" ? [...v] : []).filter((x) => typeof x === "string" && x);
export function kitSource(actor) {
  const items = [];
  try {
    for (const it of actor.items) {
      const sy = it.system ?? {}, fl = it.flags?.[MOD]?.tactics ?? {};
      items.push({ id: it.id, name: it.name, type: it.type, level: sy.level ?? null, power: typeof sy.power === "string" ? sy.power : null, boosts: listOf(sy.boosts),
        autos: Object.entries(sy.automations ?? {}).map(([id, a]) => ({ id: a?._id ?? id, name: String(a?.name ?? ""), type: String(a?.type ?? ""), show: a?.showAsSelection !== false, sel: a?.showAsSelection === true, attr: listOf(a?.attribute).filter((x) => ATTRS.includes(x)),
          bonus: num(a?.rollBonus), stress: num(a?.stressCost), damage: num(a?.baseDamage), min: num(a?.minRange), max: num(a?.maxRange), bypass: a?.bypassArmor === true })),
        fx: [...(it.effects ?? [])].map((e) => ({ id: e.id, name: e.name, on: e.disabled !== true })),
        flags: { kit: typeof fl.kit === "string" ? fl.kit : null, off: fl.off === true, types: listOf(fl.types).slice(0, 12), alt: fl.alt === true }, wf: weaponFlags(it) });
    }
  } catch (err) { trace("dropped", "kit", actor?.name, "", "", err); }      // an actor the adapter cannot read brings nothing (D125: and the GM is told)
  return { who: actor?.name ?? "", items, attrs: Object.fromEntries(ATTRS.map((k) => [k, num(actor?.system?.attributes?.[k]?.value)])) };
}
/* built once per sheet and kept until any item or effect of the world changes (the kit is asked for on every render and every roll) */
const KITS = new Map(); let kitHooks = false;
export function kitOf(actor) {
  try {
    if (!actor) return Kit.EMPTY;
    if (!kitHooks && globalThis.Hooks) { kitHooks = true; for (const k of ["createItem", "updateItem", "deleteItem", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect", "updateActor"]) Hooks.on(k, () => KITS.clear()); }
    const key = actor.uuid ?? actor.id;
    if (!KITS.has(key)) KITS.set(key, showKit(Kit.build(kitSource(actor)), actor));
    return KITS.get(key);
  } catch (err) { trace("dropped", "kit", actor?.name, "", "", err); return Kit.EMPTY; }
}
/** The dice the sheet's active effects add (the system's own roll buttons add the same): per attribute and per kind of roll. */
export function sheetBonuses(actor, kit = null) {
  /* left out: the group's size (the attack flow counts it [B2827]) and the toggles of entries the engine applies itself (Sniper, Rapid Fire, Hard Hitter,
     Martial Arts, Bigger They Are: a dock variant or a rule of the engine), so a switched-on sheet effect and the dock never add up */
  /* the system names the group bonus with its LOCALIZED type label ("Minions" / "Sługusy"): every known rendering is skipped */
  const skip = new Set([...labelVariants("TYPES.Actor.minions"), ...((kit ?? kitOf(actor)).sheetSkip ?? [])]);
  const b = actor?.system?.bonuses ?? {}, sum = (k) => Object.entries(b[k] ?? {}).reduce((a, [src, v]) => a + (skip.has(src) ? 0 : num(v)), 0), out = {};
  for (const k of [...ATTRS, "attack", "block", "dodge", "charge", "grapple"]) { const v = sum(k); if (v) out[k] = v; }
  const sl = num(actor?.system?.derived?.slugfest?.bonus) || sum("system.derived.slugfest.bonus") || sum("derived.slugfest.bonus");
  if (sl) out.slugfest = sl;
  return out;
}
/** Set one of the GM's item flags (kit: a book row, off: out of the fight, types: what an Immunity is about). GM client only. Returns the journal op `itemFlag`
    (what stood there before), or null when the item is gone. */
export async function setKitFlag(actorUuid, itemId, key, value) {
  const a = await fromUuid(actorUuid), it = a?.items?.get?.(itemId);
  if (!it || !KIT_FLAGS.includes(key)) return null;
  const raw = it.flags?.[MOD]?.tactics?.[key], from = raw === undefined ? null : JSON.parse(JSON.stringify(raw)), to = value ?? null;
  if (JSON.stringify(from) === JSON.stringify(to)) return null;
  await it.update({ [`flags.${MOD}.tactics.${key}`]: to }, { ipuTactics: true });
  return { t: "itemFlag", actorUuid: a.uuid, itemId, key, from, to };
}
export const KIT_FLAGS = Object.freeze(["kit", "off", "types", "alt"]);
/** Switch an item's active effect (a form, a size, a stance). Returns the journal op `fx`. */
export async function setItemEffect(actor, itemId, effectId, on) {
  const fx = actor?.items?.get?.(itemId)?.effects?.get?.(effectId);
  if (!fx) return null;
  const from = fx.disabled !== true;
  if (from !== !!on) await fx.update({ disabled: !on }, { ipuTactics: true });
  return { t: "fx", actorUuid: actor.uuid, itemId, effectId, from, to: !!on };
}
export function actorFacts(actor) {
  if (!actor) return null;
  const s = actor.system ?? {};
  const attrs = Object.fromEntries(ATTRS.map((k) => [k, num(s.attributes?.[k]?.value)]));
  const kind = actor.type === "superhero" ? "hero" : actor.type === "minions" ? "minions" : actor.type === "challenge" ? "challenge" : actor.type === "vehicle" ? "vehicle" : "npc";
  const flags = actor.flags?.[MOD]?.tactics ?? {};
  const armorMax = kind === "vehicle" ? num(s.armour) : Math.max(0, ...Object.values(s.bonuses?.armorProtection ?? {}).map((v) => num(v)));
  const kit = ["hero", "npc", "minions"].includes(kind) ? kitOf(actor) : Kit.EMPTY, pass = kit.pass, bonus = kind === "vehicle" || kind === "challenge" ? {} : sheetBonuses(actor, kit);
  if (kind === "minions") delete bonus.attack;                                       // the group's own bonus: the rules library counts the members [B2827]
  /* P6: each source of Armor on its own (Plasticity stops kinetic damage only [B1920]); Defiance is Armor against stress [B1865] */
  const armors = kind === "vehicle" ? (armorMax > 0 ? [{ id: "armor", armor: armorMax }] : []) : Object.entries(s.bonuses?.armorProtection ?? {}).filter(([, v]) => num(v) > 0).map(([k, v]) => ({ id: String(k).slice(0, 40), armor: num(v), ...(pass.armorOnly && /plasticity/i.test(k) ? { only: pass.armorOnly } : {}) }));
  if (pass.stressArmor > 0) armors.push({ id: "defiance", armor: pass.stressArmor, stress: true });
  /* P7: a challenge counts its time in the unit of the challenges HUD (missing = rounds); a vehicle carries its table row [B2936-2941] */
  const p7 = kind === "challenge" ? { timeUnit: actor.flags?.[MOD]?.timeUnit ?? "rounds" } : kind === "vehicle" ? { vehicle: { type: s.type ?? "ground", speed: Math.max(1, num(s.speed)), maneuver: num(s.maneuverability), passengers: num(s.passengers), ...mountOf(actor),
    weapons: actor.items.filter((i) => weaponFacts(actor, i.id)?.damage != null).length } } : { powers: actor.items.filter((i) => i.type === "power").map((i) => String(i.name ?? "").slice(0, 60)).slice(0, 40) };
  return {
    kind, npc: !S.heroSide({ type: actor.type, owned: ownersOf(actor).length > 0, disposition: (actor.token ?? actor.prototypeToken)?.disposition }), attrs, ...p7,      // H3-4: the one side rule (the engine's facts set it per token)
    health: num(s.derived?.health?.value), maxHealth: num(s.derived?.health?.max), resolve: num(s.derived?.resolve?.value), maxResolve: num(s.derived?.resolve?.max),
    crits: actor.items.filter((i) => i.type === "criticalInjury").map(injuryNumber).filter((n) => n != null),
    unknownInjuries: actor.items.filter((i) => i.type === "criticalInjury" && injuryNumber(i) == null).length,     // injuries added by hand that the table does not resolve: shown to the GM, never guessed
    armor: armors, kit, pass, bonus,
    slugfest: { damage: num(s.derived?.slugfest?.damage) },
    members: kind === "minions" ? num(s.derived?.health?.value) : undefined,           // the system keeps a group's size as its Health [B2827]
    huge: flags.huge === true || pass.huge === true, grown: flags.grown === true || pass.grown === true, impervious: flags.impervious === true || pass.impervious === true, immune: Array.isArray(flags.immune) ? flags.immune.filter((x) => typeof x === "string").slice(0, 24) : [],   // the rules library's immunity flags: the GM's word, set on the actor
    regeneration: flags.regeneration === true || pass.regeneration === true, veteran: hasTalent(actor, "combatVeteran"), reflexes: hasTalent(actor, "fastReflexes"),
    movement: kind === "vehicle" ? [{ mode: "vehicle", speed: p7.vehicle.speed, aerial: ["aerial", "space"].includes(p7.vehicle.type) }] : movementOf(actor).map((m) => ((m.mode === "swimming" && pass.fastSwim) || (m.mode === "swinging" && pass.fastSwing) ? { ...m, tier: "fast" } : ["swimming", "swinging"].includes(m.mode) ? { ...m, tier: "basic" } : m)),      // [B2022], [B2030]
    vacuumSafe: flags.vacuumSafe === true || pass.vacuumSafe === true || actor.items.some((i) => Moves.NAME_TYPES.includes(i.type) && /^(adaptation|lifesupport)$/.test(String(i.name ?? "").toLowerCase().replace(/[^a-z]/g, ""))),   // [B2929]: a suit or a hull is the GM's flag
    major: flags.major === true, immunities: [...(Array.isArray(flags.immunities) ? flags.immunities : []), ...pass.immune], vulnerabilities: [...(Array.isArray(flags.vulnerabilities) ? flags.vulnerabilities : []), ...pass.vulnerable],
  };
}
/** Z17 [B3147]: one weapon of a vehicle (its `vehicleWeapon` items) as the attack flow needs it; `ref` = "veh~<vehicle>~<item>" */
const vehicleWeapon = (vehicleActor, ref) => { const item = String(ref ?? "").split("~")[2], w = vehicleActor && item ? weaponFacts(vehicleActor, item, Kit.EMPTY) : null; return w ? { ...w, id: ref, name: String(w.name ?? "").slice(0, 60) } : null; };
/** Z17: the weapons of the vehicle `vid` for one of its crew (the dock's weapon chips) */
export const vehicleWeapons = (vehicleActor, vid) => { try { return [...(vehicleActor?.items ?? [])].filter((it) => it.type === "vehicleWeapon").map((it) => vehicleWeapon(vehicleActor, `veh~${vid}~${it.id}`)).filter((w) => w && (w.damage != null || w.range)).slice(0, 12); } catch { return []; } };
/** Z16 [B3144]: a vehicle that is a mount: the GM's flag `flags.invincible-plus-ultra.tactics.mountAgility` (a number), else the row of the
    book's vehicle table with that name (Horse: AGILITY 4). -> { mountAgility } | {} */
function mountOf(actor) {
  const f = Number(actor?.flags?.[MOD]?.tactics?.mountAgility), row = Object.entries(vehicles.VEHICLES).find(([k]) => k.toLowerCase() === String(actor?.name ?? "").trim().toLowerCase())?.[1];
  return Number.isFinite(f) && f >= 0 ? { mountAgility: Math.trunc(f) } : row?.mount && Number.isFinite(row.mountAgility) ? { mountAgility: row.mountAgility } : {}; }
/** A weapon (or attacking power) of the actor as the attack flow needs it. `ref` = item id or uuid. Sharp damage has no system field: the item flag
    `flags.invincible-plus-ultra.tactics.sharp` (set by the GM) carries it [R9]; absent = not sharp. Returns null when the item is not the actor's. */
export function weaponFacts(actor, ref, kit = null, combat = null) {
  if (combat && /^veh~[^~]+~[^~]+$/.test(String(ref))) return vehicleWeapon(actorOf(combat.combatants.get(String(ref).split("~")[1])), ref);      // Z17 [B3147]: a weapon of the vehicle aboard (flows/vehicle.mjs vehRef)
  const k = kit ?? kitOf(actor), prof = k.weapons.find((w) => w.id === ref) ?? k.weapons.find((w) => w.item === ref && !w.id.includes("+") && !w.id.startsWith("unarmed~"));     // P6: a profile of the kit (level, boosts, what a hit does)
  if (prof) return prof;
  const item = actor?.items?.get?.(ref) ?? actor?.items?.find?.((i) => i.uuid === ref) ?? null;
  if (!item) return null;
  const autos = item.system?.automations ?? {}, a = autos[Object.keys(autos)[0]] ?? {};
  const min = num(a.minRange, NaN), max = num(a.maxRange, NaN);
  return { id: item.id, name: item.name, bonus: num(a.rollBonus), damage: Number.isFinite(Number(a.baseDamage)) && Number(a.baseDamage) > 0 ? Number(a.baseDamage) : null,
    range: Number.isFinite(max) && (min > 0 || max > 0) ? [Number.isFinite(min) ? min : 0, max] : null, ...weaponFlags(item) };
}
/* Sharp, full auto and area have no system field. The GM's item flags `flags.invincible-plus-ultra.tactics.{sharp, fullAuto, area}` decide (true or
   false); without a flag, an item named exactly like a row of the book's weapon table takes that row's features. */
function weaponFlags(item) {
  const f = item.flags?.[MOD]?.tactics ?? {}, row = Object.entries(weapons.WEAPONS).find(([k]) => k.toLowerCase() === String(item.name ?? "").trim().toLowerCase())?.[1] ?? {};
  const pick = (flag, table) => (typeof f[flag] === "boolean" ? f[flag] : table === true);
  return { sharp: pick("sharp", row.sharp), fullAuto: pick("fullAuto", row.fullAuto), area: pick("area", row.areaEffect) };
}
/** The items of the actor an attack can be made with (an automation that carries damage or a range), as weaponFacts gives them. */
export const weaponList = (actor) => { try { const k = kitOf(actor), have = new Set(k.weapons.map((w) => w.item)); return [...k.weapons, ...[...(actor?.items ?? [])].filter((it) => !have.has(it.id)).map((it) => weaponFacts(actor, it.id, k)).filter((w) => w && (w.damage != null || w.range))].slice(0, 40); } catch (err) { trace("dropped", "weapons", actor?.name, "", "", err); return []; } };
/** P6 [B1808]: a summoned group is a token of one "minions" actor kept for the purpose (the GM may give it a portrait); the numbers of the book
    and the summoner's ownership sit on the token's own delta. -> { actor, delta } */
export async function summonGroup(e, owner) {
  const actor = game.actors.find((a) => a.type === "minions" && a.flags?.[MOD]?.tactics?.summonTemplate) ?? await Actor.create({ name: e.template, type: "minions", flags: { [MOD]: { tactics: { summonTemplate: true } } } }, { ipuTactics: true });
  return { actor, delta: { name: e.name, ownership: { ...(owner?.ownership ?? {}) }, system: { attributes: Object.fromEntries(ATTRS.map((k) => [k, { value: 4 }])), derived: { health: { value: Math.max(1, Math.trunc(num(e.members, 3))) }, resolve: { value: 6 } } } } };
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
    const table = (await fromUuid(INJURY_TABLE).catch(() => null)) ?? game.tables?.get(INJURY_TABLE.split(".").pop()) ?? game.tables?.getName?.("Critical Injuries");   // D127: the world's imported copy when the system pack is not loaded
    for (const r of table?.results ?? []) {
      const [lo, hi] = r.range ?? [];
      const uuid = r.documentUuid ?? (r.documentCollection && r.documentId ? `Compendium.${r.documentCollection}.Item.${r.documentId}` : null);
      const name = r.name ?? r.text ?? r.description ?? "";
      if (!Number.isFinite(lo)) continue;
      for (let n = lo; n <= (Number.isFinite(hi) ? hi : lo); n++) byNumber.set(n, { uuid, name });
      if (name) byName.set(name, lo);
    }
  } catch (err) { console.warn(`${MOD} | tactics: injuries table unreadable`, err); }
  /* D100: only a table that was READ is kept. An early read that fails or finds nothing (the pack not loaded yet) is tried again by the
     next caller instead of leaving every injury of the session unresolved. */
  const idx = { byNumber, byName, top: Math.max(0, ...byNumber.keys()) };
  if (byNumber.size) INJ = idx;
  return idx;
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
async function dialogFor(req, labelOf) {
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
  const opts = { actor, breakdown, bonus: 0, rollOptions: { tactics: { inst: req.inst, key: req.key, rid: req.rid, ...(req.combat ? { combat: req.combat } : {}), ...(req.mode === "gm" ? { mode: "gm" } : {}) } }, attribute: req.attr ?? undefined };
  if (req.maxPush === 0) opts.maxPush = 0;                                               // passive and defender rolls are never pushed [B2227], [B2241]
  return new Dlg(cardTitle(String(req.label ?? req.key), req.pool, labelOf), opts);      // U125 (c): Warning Call's dice named on the card
}
/* U2 / U7: an engine roll is thrown AT ONCE on the roller's client: no dialog to read, to dismiss or to pick a chat mode in. The pool is
   the engine's and the dialog had nothing to decide about it; who may see the dice is the engine's word too (req.mode "gm": a hidden
   combatant, a secret roll), everything else of a fight is rolled in the open. The dice are still the system's own roll and chat card.
   One throw per request id on this client; `force` (the dock's "Roll" after a throw that never arrived) throws again. */
const thrown = new Map();                                                                 // H3-1: "<combat>|<rid>" (the rid carries the fight's tag)
export const rollStarted = (rid, combat = null) => thrown.get(`${combat ?? ""}|${rid}`) ?? [...thrown].find(([k]) => k.endsWith(`|${rid}`))?.[1] ?? 0;
export const ROLL_RETRY_MS = 4000;
export async function rollNow(req, labelOf = (s) => s, { force = false } = {}) {
  const tk = `${req?.combat ?? ""}|${req?.rid ?? ""}`, at = thrown.get(tk) ?? 0;
  if (at && !(force && Date.now() - at >= ROLL_RETRY_MS)) return null;
  thrown.set(tk, Date.now()); if (thrown.size > 200) thrown.delete(thrown.keys().next().value);
  try {
    const dlg = await dialogFor(req, labelOf);
    if (typeof dlg._prepareContext !== "function" || typeof dlg._roll !== "function") return typeof dlg.wait === "function" ? dlg.wait() : dlg.render({ force: true });      // the system changed: its dialog, as before
    await dlg._prepareContext();
    return await dlg._roll({ submitter: { dataset: { action: req.mode === "gm" ? "gm" : "public" } } }, undefined, undefined);
  } catch (err) { thrown.delete(tk); throw err; }
}
/* U1: the system's own "push" and "accept" of a roll, pressed from the tactical surfaces. They are the chat log's click handlers and read
   nothing but the message id from the event, so they are called with a stand-in event; the system's rules (stress, max pushes) stay its own. */
async function chatAction(name, messageId) {
  const message = game.messages.get(messageId);
  if (!message || !tacticsOf(message)) return false;
  const fn = ui.chat?.options?.actions?.[name] ?? CONFIG.ui?.chat?.DEFAULT_OPTIONS?.actions?.[name];
  if (typeof fn !== "function") throw new Error(`no ${name} in the system's chat log`);
  await fn.call(ui.chat ?? null, { target: { closest: () => ({ dataset: { messageId } }) }, preventDefault() {}, stopPropagation() {} });
  return true;
}
export const pushRoll = (messageId) => chatAction("pushRoll", messageId);
export const acceptRoll = (messageId) => chatAction("acceptRoll", messageId);
/** U7: a roll the engine marked for the GM alone stays so when its card is made again (the system's push writes a new message in the
    roller's own chat mode). Called from preCreateChatMessage on every client. */
export function keepRollPrivate(message) {
  try {
    if (message?.rolls?.[0]?.options?.tactics?.mode !== "gm") return;
    const gms = game.users.filter((u) => u.isGM).map((u) => u.id);
    message.updateSource({ whisper: gms, blind: false });
  } catch (err) { console.warn(`${MOD} | tactics: private roll`, err); }
}
/** The engine tag of a chat message's roll, or null. */
export function tacticsOf(message) {
  const t = message?.rolls?.[0]?.options?.tactics;
  return t && typeof t.inst === "string" && typeof t.key === "string" && typeof t.rid === "string" ? { inst: t.inst, key: t.key, rid: t.rid, ...(typeof t.combat === "string" ? { combat: t.combat.slice(0, 64) } : {}) } : null;
}
/** Read an engine roll from its chat message (executor). Identity = the message author as the server delivered it. */
export function readRollMessage(message) {
  const tag = tacticsOf(message), roll = message?.rolls?.[0];
  if (!tag || !roll) return null;
  const sixes = Number(roll.successCount), ones = Number(roll.baneCount);
  if (!Number.isFinite(sixes)) return null;
  const dice = Number(roll.size);                                                          // FXV (P8d-6): how many dice were thrown (yzur: a push keeps the number)
  return { ...tag, author: message.author?.id ?? null, sixes, ones: Number.isFinite(ones) ? ones : 0, pushed: num(roll.pushCount), pushable: roll.pushable === true, messageId: message.id, ...(Number.isFinite(dice) && dice > 0 ? { dice } : {}) };
}
/** Journal op `message` inverse: struck through, never deleted (spec 15). */
export async function strikeMessage(id) {
  const m = game.messages.get(id);
  if (m) await m.update({ [`flags.${MOD}.tactics.undone`]: true }, { ipuTactics: true });
}
/** Is this document update one the engine made (legacy code may skip it)? */
export const isEngineUpdate = (options) => options?.ipuTactics !== undefined;
