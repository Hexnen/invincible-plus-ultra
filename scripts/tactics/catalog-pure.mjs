/* Tactical combat: the SMALLEST action catalog the engine skeleton needs (spec section 8). NO Foundry globals.
   The full catalog (every row of 8.1, every power, talent and weapon) is P5 / P6 and replaces BUILTIN; the shape is the spec's `CatalogEntry`.
   `src` holds book-dump line numbers only (the text is private). Extra fields used by the engine:
     requires  Cond | [Cond...] of rules/conditions.mjs: what must hold to declare the action (evaluated in flows/kit.mjs `requirements`)
     roll.mods [ModRule...] of rules/conditions.mjs: conditional dice modifiers of the actor's roll (flows/kit.mjs `entryMods`)
     attack    id of rules/attack.mjs ATTACKS for flow "attack"
     reaction  for entries usable in a reaction window: { when: [window...], who: "target"|"any", effect: "defence"|"action"|"swapTarget"|"autoMiss"|"note" }
               "action" pushes the entry as an interrupting action on the stack; "swapTarget" makes the reactor the target instead; "autoMiss" makes the
               attack miss that target; "note" only records the reaction for the GM. Which powers and talents give which of these is P6 data. */
import * as M from "./mods-pure.mjs";
import { conditions } from "../rules/index.mjs";
import { ACTIONS } from "./actions-pure.mjs";

export const WINDOWS = Object.freeze(["beforeRoll", "afterRoll", "afterDamage"]);
export const FLOWS = Object.freeze(["attack", "move", "roll", "opposed", "composite", "hazard", "challenge", "chase", "plain", "other", "barrier", "fastball", "release", "act"]);
export const REACTION_EFFECTS = Object.freeze(["defence", "action", "swapTarget", "autoMiss", "note"]);
/** U91: where the book lets a reaction be taken. "targetZone": the reactor stands in the zone of the attacked character (Guardian [B2115]);
    "allyZone": an ally stands in the reactor's own zone (Discretion [B2108]). `reaction.roll: "attack"`: the reactor first rolls FIGHTING
    against a slugfest attack, AGILITY against shooting, and the reaction works only on a success [B2115]. Read by flows/kit.reactionFit. */
export const REACTION_PLACES = Object.freeze(["targetZone", "allyZone"]);

export const BUILTIN = Object.freeze({
  slugfest: { id: "slugfest", label: "ITAC.action.slugfest", src: [2341, 2425], kind: "builtin", cost: "full", flow: "attack", attack: "slugfest", roll: { attr: "fighting" }, target: { who: "enemy", n: [1, 1] }, defense: "block", stunts: "slugfest", tags: ["attack"] },
  shoot: { id: "shoot", label: "ITAC.action.shoot", src: [2347, 2510], kind: "builtin", cost: "full", flow: "attack", attack: "shooting", roll: { attr: "agility" }, target: { who: "enemy", n: [1, 1] }, defense: "dodge", stunts: "shooting", tags: ["attack", "shot"] },
  grapple: { id: "grapple", label: "ITAC.action.grapple", src: [2496], kind: "builtin", cost: "full", flow: "attack", attack: "grapple", roll: { attr: "fighting" }, target: { who: "enemy", n: [1, 1] }, defense: "block", stunts: "none", tags: ["attack"] },
  /* P4: the special attacks [B2490-2497]. A charge is priced by the attack flow (the full action here, the quick action with its move); `area` and
     `fullAuto` on an entry allow those options without a weapon that has them (powers, P6). */
  charge: { id: "charge", label: "ITAC.action.charge", src: [2344, 2490, 2491, 2492, 2493, 2494], kind: "builtin", cost: "full", flow: "attack", attack: "charge", roll: { attr: "strength" }, target: { who: "enemy", n: [1, 1] }, defense: "dodge", stunts: "charge", tags: ["attack", "move", "charge"] },
  grappleAttack: { id: "grappleAttack", label: "ITAC.action.grappleAttack", src: [2497], kind: "builtin", cost: "full", flow: "attack", attack: "grappleAttack", roll: { attr: "fighting" }, target: { who: "enemy", n: [1, 1] }, stunts: "grappleAttack", tags: ["attack"] },
  release: { id: "release", label: "ITAC.action.release", src: [2497], kind: "builtin", cost: "none", flow: "release", tags: [] },
  block: { id: "block", label: "ITAC.action.block", src: [2310, 2446, 2447], kind: "builtin", cost: "quick", flow: "plain", interrupt: { on: ["beforeRoll"] }, roll: { attr: "fighting", passive: false }, reaction: { when: ["beforeRoll"], who: "target", effect: "defence" }, tags: ["defence"] },
  dodge: { id: "dodge", label: "ITAC.action.dodge", src: [2313, 2524, 2525], kind: "builtin", cost: "quick", flow: "plain", interrupt: { on: ["beforeRoll"] }, roll: { attr: "agility", passive: false }, reaction: { when: ["beforeRoll"], who: "target", effect: "defence" }, tags: ["defence"] },
  orders: { id: "orders", label: "ITAC.action.orders", src: [2362, 2297], kind: "builtin", cost: "full", flow: "roll", roll: { attr: "presence" }, target: { who: "ally", n: [1, 1] }, effect: { token: "orders" }, tags: [] },
  other: { id: "other", label: "ITAC.action.other", src: [2208], kind: "builtin", cost: "none", flow: "other", tags: [] },
  /* P3 movement (flows/move.mjs). `cost` of a move is nominal: the flow prices the declared route (quick or full by the way of moving and the
     conditions, free inside the zone on the own turn [L6]); the ways of moving come from the mover's powers (movement-pure.modesOf), not from entries.
     An entry may fix a way with `move: { mode }` (the interrupt moves of P6: Untouchable Speed [B2018], Quick Teleport [B2039]). */
  move: { id: "move", label: "ITAC.action.move", src: [2383, 2385, 2386, 2387, 2388, 2394, 2417, 2419], kind: "builtin", cost: "quick", flow: "move", tags: ["move"] },
  openDoor: { id: "openDoor", label: "ITAC.action.openDoor", src: [2418], kind: "builtin", cost: "none", flow: "barrier", door: "openDoor", tags: [] },
  breachDoor: { id: "breachDoor", label: "ITAC.action.breachDoor", src: [2418], kind: "builtin", cost: "quick", flow: "barrier", door: "breachDoor", roll: { attr: "strength" }, tags: [] },
  unseal: { id: "unseal", label: "ITAC.action.unseal", src: [2418], kind: "builtin", cost: "full", flow: "barrier", door: "unseal", roll: { attr: "reason" }, tags: [] },
  fastball: { id: "fastball", label: "ITAC.action.fastball", src: [2389, 2390], kind: "builtin", cost: "full", flow: "fastball", target: { who: "ally", n: [1, 1] }, tags: ["move"] },
  /* P7 (flows/challenge.mjs, flows/vehicle.mjs). `when` names the situation in which the bar offers the entry (desk-pure.mjs); the flow
     checks the rule. The ram is the attack flow with the attack `ram`; its base damage comes from the vehicle. */
  objective: { id: "objective", label: "ITAC.action.objective", src: [2837, 2841], kind: "builtin", cost: "full", flow: "challenge", target: { who: "challenge", n: [1, 1] }, when: "challenge", tags: [] },
  vehicleEnter: { id: "vehicleEnter", label: "ITAC.action.vehicleEnter", src: [2325, 2332], kind: "builtin", cost: "quick", flow: "seat", target: { who: "vehicle", n: [1, 1] }, when: "onFoot", tags: [] },
  vehicleExit: { id: "vehicleExit", label: "ITAC.action.vehicleExit", src: [2325, 2332], kind: "builtin", cost: "quick", flow: "seat", when: "aboard", tags: [] },
  vehicleStart: { id: "vehicleStart", label: "ITAC.action.vehicleStart", src: [2325, 2332], kind: "builtin", cost: "quick", flow: "seat", when: "driver", tags: [] },
  vehicleHandle: { id: "vehicleHandle", label: "ITAC.action.vehicleHandle", src: [2941, 3146], kind: "builtin", cost: "quick", flow: "drive", when: "driver", tags: ["vehicleHandle", "move"] },
  ram: { id: "ram", label: "ITAC.action.ram", src: [3148, 3223], kind: "builtin", cost: "full", flow: "attack", attack: "ram", roll: { attr: "agility" }, target: { who: "enemy", n: [1, 1] }, defense: "block", stunts: "slugfest", when: "driver", tags: ["attack"] },
  gmRoll: { id: "gmRoll", label: "ITAC.action.gmRoll", src: [2208], kind: "builtin", cost: "none", flow: "roll", roll: { attr: null }, tags: [] },
  ...ACTIONS,                       // P5: the other rows of the two action tables and the escapes (actions-pure.mjs, flow "act")
});

const str = (v, n = 40) => (typeof v === "string" ? v.slice(0, n) : "");
const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
const data = (v) => { try { const s = JSON.stringify(v); return s && s.length <= 4000 ? JSON.parse(s) : undefined; } catch { return undefined; } };
/** A predicate given as data: kept only when rules/conditions.mjs finds no fault in it. -> Cond | undefined */
export function sanitizeCond(c) {
  const v = data(c);
  if (v === undefined || v === null) return undefined;
  try { return conditions.validateCond(v).length ? undefined : v; } catch { return undefined; }
}
/** -> [ModRule...] | undefined (one bad rule spoils the list: a modifier is never half applied) */
export function sanitizeModRules(list) {
  if (!Array.isArray(list) || list.length > 24) return undefined;
  const out = [];
  for (const r of list) {
    if (!isObj(r) || typeof r.source !== "string" || !r.source) return undefined;
    const dice = Number.isFinite(r.dice) ? Math.trunc(r.dice) : isObj(r.dice) && typeof r.dice.ref === "string" ? data(r.dice) : undefined;
    if (dice === undefined) return undefined;
    const m = { source: r.source.slice(0, 40), dice };
    if (r.when !== undefined) { const w = sanitizeCond(r.when); if (w === undefined) return undefined; m.when = w; }
    for (const k of ["attrs", "rolls"]) if (Array.isArray(r[k])) m[k] = r[k].map((x) => str(x, 24)).filter(Boolean).slice(0, 12);
    out.push(m);
  }
  return out;
}
/** Normalise a catalog entry given as data (GM op `powerGrant`, later P6). Unknown fields are dropped; returns null when unusable. */
export function sanitizeEntry(e) {
  if (!e || typeof e !== "object" || !/^[A-Za-z0-9_-]{1,32}$/.test(e.id ?? "") || !FLOWS.includes(e.flow)) return null;
  const cost = ["full", "quick", "free", "none"].includes(e.cost) ? e.cost : "full";
  const out = { id: e.id, label: str(e.label, 80) || e.id, name: str(e.name, 80), src: Array.isArray(e.src) ? e.src.filter(Number.isInteger).slice(0, 12) : [], kind: "custom", cost, flow: e.flow, tags: Array.isArray(e.tags) ? e.tags.map((x) => str(x, 24)).filter(Boolean).slice(0, 12) : [] };
  if (e.flow === "attack") out.attack = ["slugfest", "shooting", "grapple", "grappleAttack", "charge", "ram"].includes(e.attack) ? e.attack : "slugfest";
  if (e.roll && typeof e.roll === "object") out.roll = { attr: str(e.roll.attr, 12) || null, passive: e.roll.passive === true };
  if (e.roll?.mods !== undefined) { const m = sanitizeModRules(e.roll.mods); if (!m || !out.roll) return null; if (m.length) out.roll.mods = m; }
  if (e.requires !== undefined) { const r = sanitizeCond(e.requires); if (r === undefined) return null; out.requires = r; }       // a requirement that cannot be read makes the entry unusable, it is never dropped silently
  if (Number.isInteger(e.stress?.fixed) && e.stress.fixed > 0) out.stress = { fixed: Math.min(20, e.stress.fixed) };
  if (e.damage && typeof e.damage === "object") out.damage = { base: Number.isFinite(e.damage.base) ? Math.max(0, Math.trunc(e.damage.base)) : undefined, ...M.damageTags(e.damage), none: e.damage.none === true };
  for (const k of ["area", "fullAuto"]) if (e[k] === true) out[k] = true;                                  // [B2542], [B2543]
  if (Array.isArray(e.range) && e.range.length === 2) out.range = [Math.max(0, Math.trunc(e.range[0]) || 0), Math.max(0, Math.trunc(e.range[1]) || 0)];
  if (e.reaction && typeof e.reaction === "object" && REACTION_EFFECTS.includes(e.reaction.effect)) {
    out.reaction = { when: (Array.isArray(e.reaction.when) ? e.reaction.when : []).filter((w) => WINDOWS.includes(w)), who: e.reaction.who === "target" ? "target" : "any", effect: e.reaction.effect,
      ...(REACTION_PLACES.includes(e.reaction.place) ? { place: e.reaction.place } : {}), ...(e.reaction.roll === "attack" ? { roll: "attack" } : {}) };      // U91
    out.interrupt = { on: out.reaction.when };
  }
  if (e.flow === "move" && e.move && typeof e.move === "object" && /^[A-Za-z]{1,24}$/.test(e.move.mode ?? "")) out.move = { mode: e.move.mode };     // a way of moving fixed by the entry
  if (Array.isArray(e.parts)) out.parts = e.parts.map((p) => ({ action: str(p?.action, 32) })).filter((p) => p.action).slice(0, 6);     // composite flow
  return out;
}
/** The entry `actionId` as `cid` may use it: a builtin, or one granted to that combatant (spec 6.5 `borrowedPower`, GM op powerGrant). */
export function entryFor(state, cid, actionId, facts = null) {
  if (typeof actionId !== "string") return null;
  const granted = cid ? M.grantedEntries(state, cid).find((e) => e.id === actionId) : null;
  return granted ?? (Object.prototype.hasOwnProperty.call(BUILTIN, actionId) ? BUILTIN[actionId] : null) ?? (actionId.startsWith("k-") ? kitEntries(facts, cid).find((e) => e.id === actionId) ?? null : null);
}
/** P6: the entries a combatant's own powers, talents and gear give (kit-pure.mjs builds them; they live in the facts, never in the state). */
export const kitEntries = (facts, cid) => { try { return (cid && facts?.c?.(cid)?.kit?.actions) || []; } catch { return []; } };
/** [B2497] While holding somebody the holder may only move (with the one held) and make a grapple attack, until it lets go. This is the
    one test of "is this entry one of the other actions": a full or quick action that is not a reaction. What costs nothing (talking,
    opening a door on the way, the GM's "something else") is not an action in that sense. Used by the declare gate (flows/kit.mjs) and by the bar. */
export const HOLDER_FLOWS = Object.freeze(["move", "release", "other", "plain"]);
export const holderBlocks = (e) => !!e && (e.cost === "full" || e.cost === "quick") && !e.reaction && e.id !== "grappleAttack" && !HOLDER_FLOWS.includes(e.flow);
export const entriesFor = (state, cid, facts = null) => [...Object.values(BUILTIN), ...M.grantedEntries(state, cid), ...kitEntries(facts, cid).filter((e) => !e.reactionOnly)];
/** Reaction entries `cid` holds for a window (the two built-in defences are handled by the attack flow through the rules library, not from here). */
export const reactionsFor = (state, cid, when, facts = null) => [...M.grantedEntries(state, cid), ...kitEntries(facts, cid)].filter((e) => e.reaction && e.reaction.effect !== "defence" && e.reaction.when.includes(when));
