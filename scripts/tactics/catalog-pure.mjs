/* Tactical combat, package P2: the SMALLEST action catalog the engine skeleton needs (spec section 8). NO Foundry globals.
   The full catalog (every row of 8.1, every power, talent and weapon) is P5 / P6 and replaces BUILTIN; the shape is the spec's `CatalogEntry`.
   `src` holds book-dump line numbers only (the text is private). Extra fields used by the engine:
     attack    id of rules/attack.mjs ATTACKS for flow "attack"
     reaction  for entries usable in a reaction window: { when: [window...], who: "target"|"any", effect: "defence"|"action"|"swapTarget"|"autoMiss"|"note" }
               "action" pushes the entry as an interrupting action on the stack; "swapTarget" makes the reactor the target instead; "autoMiss" makes the
               attack miss that target; "note" only records the reaction for the GM. Which powers and talents give which of these is P6 data. */
import * as M from "./mods-pure.mjs";

export const WINDOWS = Object.freeze(["beforeRoll", "afterRoll", "afterDamage"]);
export const FLOWS = Object.freeze(["attack", "move", "roll", "opposed", "composite", "hazard", "challenge", "chase", "plain", "other"]);
export const REACTION_EFFECTS = Object.freeze(["defence", "action", "swapTarget", "autoMiss", "note"]);

export const BUILTIN = Object.freeze({
  slugfest: { id: "slugfest", label: "ITAC.action.slugfest", src: [2341, 2425], kind: "builtin", cost: "full", flow: "attack", attack: "slugfest", roll: { attr: "fighting" }, target: { who: "enemy", n: [1, 1] }, defense: "block", stunts: "slugfest", tags: ["attack"] },
  shoot: { id: "shoot", label: "ITAC.action.shoot", src: [2347, 2510], kind: "builtin", cost: "full", flow: "attack", attack: "shooting", roll: { attr: "agility" }, target: { who: "enemy", n: [1, 1] }, defense: "dodge", stunts: "shooting", tags: ["attack", "shot"] },
  grapple: { id: "grapple", label: "ITAC.action.grapple", src: [2496], kind: "builtin", cost: "full", flow: "attack", attack: "grapple", roll: { attr: "fighting" }, target: { who: "enemy", n: [1, 1] }, defense: "block", stunts: "none", tags: ["attack"] },
  block: { id: "block", label: "ITAC.action.block", src: [2310, 2446, 2447], kind: "builtin", cost: "quick", flow: "plain", interrupt: { on: ["beforeRoll"] }, roll: { attr: "fighting", passive: false }, reaction: { when: ["beforeRoll"], who: "target", effect: "defence" }, tags: ["defence"] },
  dodge: { id: "dodge", label: "ITAC.action.dodge", src: [2313, 2524, 2525], kind: "builtin", cost: "quick", flow: "plain", interrupt: { on: ["beforeRoll"] }, roll: { attr: "agility", passive: false }, reaction: { when: ["beforeRoll"], who: "target", effect: "defence" }, tags: ["defence"] },
  orders: { id: "orders", label: "ITAC.action.orders", src: [2362, 2297], kind: "builtin", cost: "full", flow: "roll", roll: { attr: "presence" }, target: { who: "ally", n: [1, 1] }, effect: { token: "orders" }, tags: [] },
  other: { id: "other", label: "ITAC.action.other", src: [2208], kind: "builtin", cost: "none", flow: "other", tags: [] },
  gmRoll: { id: "gmRoll", label: "ITAC.action.gmRoll", src: [2208], kind: "builtin", cost: "none", flow: "roll", roll: { attr: null }, tags: [] },
});

const str = (v, n = 40) => (typeof v === "string" ? v.slice(0, n) : "");
/** Normalise a catalog entry given as data (GM op `powerGrant`, later P6). Unknown fields are dropped; returns null when unusable. */
export function sanitizeEntry(e) {
  if (!e || typeof e !== "object" || !/^[A-Za-z0-9_-]{1,32}$/.test(e.id ?? "") || !FLOWS.includes(e.flow)) return null;
  const cost = ["full", "quick", "free", "none"].includes(e.cost) ? e.cost : "full";
  const out = { id: e.id, label: str(e.label, 80) || e.id, name: str(e.name, 80), src: Array.isArray(e.src) ? e.src.filter(Number.isInteger).slice(0, 12) : [], kind: "custom", cost, flow: e.flow, tags: Array.isArray(e.tags) ? e.tags.map((x) => str(x, 24)).filter(Boolean).slice(0, 12) : [] };
  if (e.flow === "attack") out.attack = ["slugfest", "shooting", "grapple", "grappleAttack", "charge", "ram"].includes(e.attack) ? e.attack : "slugfest";
  if (e.roll && typeof e.roll === "object") out.roll = { attr: str(e.roll.attr, 12) || null, passive: e.roll.passive === true };
  if (Number.isInteger(e.stress?.fixed) && e.stress.fixed > 0) out.stress = { fixed: Math.min(20, e.stress.fixed) };
  if (e.damage && typeof e.damage === "object") out.damage = { base: Number.isFinite(e.damage.base) ? Math.max(0, Math.trunc(e.damage.base)) : undefined, ...M.damageTags(e.damage), none: e.damage.none === true };
  if (Array.isArray(e.range) && e.range.length === 2) out.range = [Math.max(0, Math.trunc(e.range[0]) || 0), Math.max(0, Math.trunc(e.range[1]) || 0)];
  if (e.reaction && typeof e.reaction === "object" && REACTION_EFFECTS.includes(e.reaction.effect)) {
    out.reaction = { when: (Array.isArray(e.reaction.when) ? e.reaction.when : []).filter((w) => WINDOWS.includes(w)), who: e.reaction.who === "target" ? "target" : "any", effect: e.reaction.effect };
    out.interrupt = { on: out.reaction.when };
  }
  if (Array.isArray(e.parts)) out.parts = e.parts.map((p) => ({ action: str(p?.action, 32) })).filter((p) => p.action).slice(0, 6);     // composite flow
  return out;
}
/** The entry `actionId` as `cid` may use it: a builtin, or one granted to that combatant (spec 6.5 `borrowedPower`, GM op powerGrant). */
export function entryFor(state, cid, actionId) {
  if (typeof actionId !== "string") return null;
  const granted = cid ? M.grantedEntries(state, cid).find((e) => e.id === actionId) : null;
  return granted ?? (Object.prototype.hasOwnProperty.call(BUILTIN, actionId) ? BUILTIN[actionId] : null);
}
export const entriesFor = (state, cid) => [...Object.values(BUILTIN), ...M.grantedEntries(state, cid)];
/** Reaction entries `cid` holds for a window (the two built-in defences are handled by the attack flow through the rules library, not from here). */
export const reactionsFor = (state, cid, when) => M.grantedEntries(state, cid).filter((e) => e.reaction && e.reaction.effect !== "defence" && e.reaction.when.includes(when));
