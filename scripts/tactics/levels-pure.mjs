/* Tactical combat, D125: THE LEVEL OF A POWER and the tier of a way of moving. NO Foundry globals.
   The system keeps a power's level as a free string field (`level`) that the item sheet offers blank, as "(dynamic)": a blank level is
   then read from the power's visible automations (an automation shown for selection whose name says "basic", "major", "massive" or
   "monstrous"; the first of those words in that order decides for one automation, and the highest over the automations wins). That is the
   system's own reading (its power data model); this file reads the same way. When nothing names a level, the book's rule holds: a power
   whose level is not given is at its basic level [B298], [B1214].
   Used by the kit (kit-pure.levelOf), by the ways of moving an actor's items give (moves-pure) and by movement-pure.modesOf, which turns
   any level into a tier the rules library has for that way of moving. */
import { movement } from "../rules/index.mjs";
import { LEVELS } from "./kitdata-pure.mjs";

/* An automation counts when it is shown for selection. Three shapes reach here: the system's own automation (`showAsSelection`; a missing
   field is not shown, as the system reads it), the kit's plain item (kitSource: `sel` = the system's flag, `show` its older reading) and a
   hand-made one in the checks (`show` alone, missing = shown). */
const shown = (a) => (!a || typeof a !== "object" ? false : "sel" in a ? a.sel === true : "show" in a ? a.show !== false : a.showAsSelection === true);
const listOf = (autos) => (Array.isArray(autos) ? autos : autos && typeof autos === "object" ? Object.values(autos) : []);
/** The level one automation's name gives: the system's order (basic before major before massive before monstrous). -> 0..3 | -1 */
export function nameLevel(name) {
  const n = String(name ?? "").toLowerCase();
  return LEVELS.findIndex((w) => n.includes(w));
}
/** The level of a power. level: the item's field; autos: its automations (the system's object or a list).
    -> { lv: 0..3, word, from: "own" | "automations" | "default", odd: the field held a value that is no level (read like a blank one) } */
export function powerLevel(level, autos) {
  const raw = String(level ?? "").trim().toLowerCase(), own = LEVELS.indexOf(raw);
  if (own >= 0) return { lv: own, word: LEVELS[own], from: "own", odd: false };
  const lv = Math.max(-1, ...listOf(autos).filter(shown).map((a) => nameLevel(a.name)));
  return lv >= 0 ? { lv, word: LEVELS[lv], from: "automations", odd: raw !== "" } : { lv: 0, word: LEVELS[0], from: "default", odd: raw !== "" };     // [B298], [B1214]
}
/** The tier the rules library has for a way of moving (rules/movement.mjs MOVE_MODES), from any level word or tier.
    A level above what the way has is its highest tier up to that level (most ways of moving have only the basic one [B298]); a blank is basic;
    anything else is basic too, marked `odd` for the trace. A way the library does not know is passed on untouched (moveProfile answers).
    -> { tier, odd } */
export function tierFor(mode, raw) {
  const r = String(raw ?? "").trim().toLowerCase(), tiers = movement.MOVE_MODES?.[mode]?.tiers;
  if (!tiers) return { tier: raw ?? "basic", odd: false };
  if (Object.hasOwn(tiers, r)) return { tier: r, odd: false };
  const i = LEVELS.indexOf(r);
  if (i >= 0) return { tier: LEVELS.slice(0, i + 1).reverse().find((w) => Object.hasOwn(tiers, w)) ?? "basic", odd: false };
  return { tier: "basic", odd: r !== "" };
}
