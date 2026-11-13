/**
 * Roll board logic (phase 6) - PURE (Node + browser, no Foundry globals, no UI strings), shared by the Roll board step, the Start step,
 * the "Roll this step" footer button and the "Surprise me" entry. Built on random.mjs (rollAll / rollStep) and state.mjs.
 *
 * ROLL OPTIONS (state.rollOpts, serialised with the state, so undo / redo / drafts keep them; null = defaults)
 *   { spice, drawbacks, extraTalents, extraSource, limits, variance, heroRel, within, joinBase }
 *   "Spice level" presets (the five visible toggles + variance are set together; spice "custom" = the toggles match no preset):
 *     simple    nothing optional: no drawbacks, no extra talents, one source, no limits, exact rank power count, no second hero relationship
 *     standard  drawbacks and extra talents may appear, limits sometimes, one source, exact power count, a second hero relationship (the default)
 *     wild      everything may appear: drawbacks, extra talents, a second source, limits, +-1 power slot
 *   within    false = a fully random hero from the whole pool (user decision 2), true = "roll within an archetype"
 *   joinBase  false = the team part is text only (default), true = may join an existing base card
 *
 * ROWS of the board = rank + the seven rollable steps of random.mjs. A row is KEPT (survives "Reroll all unlocked") when every field of the step is
 * locked (state.locks) or the user edited the step by hand (state.touched). The lock button on a row sets / clears both.
 * Rolling a row never marks it touched; an explicit reroll of a row clears its "edited" flag.
 *
 * SEED: seed + rank + options reproduce a hero (same world content). The shareable HERO CODE is "seed:rank:spice:free|arch:solo|join".
 * GENR-1 (FXT2): the code carries no reroll counters and no kept values, so it reproduces only a FRESH roll. state.rolledAs = {code, print} is stamped by
 * every fresh roll (rollNewHero, a reseed / reroll-all / rank change with nothing kept); codeMatches(state) says whether the code still rolls the hero on
 * screen, and the board / result view say so when it does not. "Reroll all unlocked" with nothing kept therefore moves to a new (derived) seed.
 */
import { rollAll, rollStep, newSeed } from "./random.mjs";
import { createState, patch, setRank, STEP_FIELDS } from "./state.mjs";
import { RANKS, RANK_ORDER } from "./rules.mjs";

export { newSeed };
export const BOARD_ROWS = ["rank", "concept", "powers", "talents", "attributes", "life", "persona", "team"];
export const ROLLABLE = ["concept", "powers", "talents", "attributes", "life", "persona", "team"];
export const SPICES = ["simple", "standard", "wild"];
export const SPICE_TOGGLES = ["drawbacks", "extraTalents", "extraSource", "limits", "heroRel"];
const PRESET = {
  simple: { drawbacks: false, extraTalents: false, extraSource: false, limits: false, variance: false, heroRel: false },
  standard: { drawbacks: true, extraTalents: true, extraSource: false, limits: true, variance: false, heroRel: true },
  wild: { drawbacks: true, extraTalents: true, extraSource: true, limits: true, variance: true, heroRel: true }
};
const PRESET_KEYS = [...SPICE_TOGGLES, "variance"];
export const DEFAULT_ROLL = { spice: "standard", ...PRESET.standard, within: false, joinBase: false };

const detect = (o) => SPICES.find((k) => PRESET_KEYS.every((f) => !!PRESET[k][f] === !!o[f])) ?? "custom";

/** the roll options of a state, every key defaulted, `spice` recomputed from the toggles */
export function rollOptsOf(state) {
  const o = { ...DEFAULT_ROLL, ...(state?.rollOpts ?? {}) };
  for (const k of [...PRESET_KEYS, "within", "joinBase"]) o[k] = !!o[k];
  o.spice = detect(o);
  return o;
}
/** options for random.mjs */
export function randomOpts(ro) {
  return {
    withinArchetype: ro.within, drawbacks: ro.drawbacks, extraTalents: ro.extraTalents, extraSource: ro.extraSource,
    slotVariance: ro.variance, limitChance: ro.limits ? (ro.variance ? 0.5 : 0.25) : 0, heroRel: ro.heroRel, joinBase: ro.joinBase
  };
}
export const optsFor = (state) => randomOpts(rollOptsOf(state));

export const withSpice = (state, spice) => patch(state, { rollOpts: { ...rollOptsOf(state), ...(PRESET[spice] ?? {}), spice } });
export const withToggle = (state, key, on) => patch(state, { rollOpts: { ...rollOptsOf(state), [key]: !!on } });

// ---------- locks / kept rows ----------
const fieldsOf = (step) => STEP_FIELDS[step] ?? [];
export function lockMode(state, step) {
  const f = fieldsOf(step), n = f.filter((k) => state.locks?.[k]).length;
  if (f.length && n === f.length) return "locked";
  if (state.touched?.[step]) return "edited";
  return n ? "partial" : "free";
}
/** kept = survives "Reroll all unlocked" */
export const isKept = (state, step) => lockMode(state, step) === "locked" || lockMode(state, step) === "edited";
export function toggleRowLock(state, step) {
  const locks = { ...state.locks }, touched = { ...state.touched };
  if (isKept(state, step)) { for (const k of fieldsOf(step)) delete locks[k]; delete touched[step]; }
  else for (const k of fieldsOf(step)) locks[k] = true;
  return patch(state, { locks, touched });
}
/** rows a "Reroll all unlocked" would roll */
export const unlockedRows = (state) => ROLLABLE.filter((s) => !isKept(state, s));

const dropTouched = (state, step) => { if (!state.touched?.[step]) return state; const touched = { ...state.touched }; delete touched[step]; return patch(state, { touched }); };

// ---------- rolling ----------
/** a brand new random hero (Start step, Surprise me) */
export async function rollNewHero(P, { rank, seed = newSeed(), rollOpts = null, member = null } = {}) {
  let base = patch(createState({ seed, rank, mode: "random" }), { rollOpts });
  if (member) base = patch(base, { team: { ...base.team, mode: "member", baseId: member } });   // the hero already belongs to a base card: its texts are not rolled
  const res = await rollAll(base, P, optsFor(base));
  return { ...res, state: stamp(res.state) };
}
/** reroll ONE row. Locked / edited-by-hand rows are refused unless `force` (an explicit click on the dice of an edited row is allowed: pass force). */
export async function rerollRow(state, step, P, { force = false, opts = null, cascade = true } = {}) {
  if (!ROLLABLE.includes(step)) return state;
  const mode = lockMode(state, step);
  if (mode === "locked" || (mode === "edited" && !force)) return state;
  const o = opts ?? optsFor(state);
  let next;
  if (step === "concept" && o.withinArchetype && cascade) {
    // a new archetype changes every pool that depends on it: re-roll those rows too, unless they are kept; rank and team stay
    const hold = { ...state.locks };
    for (const k of [...fieldsOf("team"), "rank"]) hold[k] = true;
    const free = { ...state.touched }; delete free.concept;   // a forced reroll of a hand-edited concept must really roll it (rollAll skips touched steps)
    const res = await rollAll(patch(state, { locks: hold, touched: free }), P, o);
    next = patch(res.state, { locks: state.locks });
  } else if ((step === "powers" || step === "talents") && !state.locks.attrs && state.touched.attributes) {
    // attributes edited by hand are kept: plan the new powers / talents around their sum instead of re-balancing them
    const held = patch(state, { locks: { ...state.locks, attrs: true } }), rolled = await rollStep(held, step, P, o);
    next = rolled === held ? state : patch(rolled, { locks: state.locks });   // nothing rolled (no plan fits the kept sum): report "no change"
  } else next = await rollStep(state, step, P, o);   // powers / talents re-balance the unlocked attributes inside rollStep
  return next === state ? state : dropTouched(next, step);
}
/** reroll every row that is not kept. GENR-1 (FXT2): with NOTHING kept this is a whole new hero, so it gets a new seed (derived from the old seed and a
    counter, so the step stays deterministic) and its hero code reproduces it; with kept rows the result depends on the kept values, which no code carries */
export async function rerollUnlocked(state, P) {
  if (!ROLLABLE.some((s) => isKept(state, s))) return reseed(state, nextSeed(state), P);
  return rollAll(state, P, optsFor(state));
}
/** same hero rules, a new (or typed) seed: counters restart so the result equals a fresh roll of that seed, kept rows stay */
export async function reseed(state, seed, P) {
  // start from a clean slate (only kept rows carry their values over): a roll never reads the stale values of the rows it replaces, so the
  // result equals a fresh roll of that seed
  let s = patch(createState({ seed: String(seed), rank: state.rank, mode: "random" }), { rollOpts: state.rollOpts, locks: state.locks, touched: state.touched, identity: state.identity, appearance: state.appearance });
  const kept = ROLLABLE.filter((step) => isKept(state, step));
  for (const step of kept) for (const f of fieldsOf(step)) s = patch(s, { [f]: state[f] });
  if (state.team?.mode === "member") s = patch(s, { team: state.team });
  const res = await rollAll(s, P, optsFor(state));
  // only a roll with no kept row equals what the code rolls; otherwise the stamp of the previous roll stays and no longer matches
  return kept.length ? res : { ...res, state: stamp(res.state) };
}
/** change the rank on the board: the powers count and caps change, so every row that is not kept is rolled again. With nothing kept the SAME seed is
    rolled fresh at the new rank (GENR-1: the code "seed:newrank:..." then reproduces the hero) */
export async function changeRank(state, rank, P) {
  if (!RANKS[rank] || rank === state.rank) return { state };
  if (!ROLLABLE.some((s) => isKept(state, s))) return reseed(setRank(state, rank), state.seed, P);
  return rollAll(setRank(state, rank), P, optsFor(state));
}

// ---------- does the hero code still reproduce the hero on screen? (GENR-1) ----------
/** fingerprint of everything a roll decides (the fields of the rollable rows and the rank); locks, edits flags, counters, identity and appearance excluded */
export function heroPrint(state) {
  const text = JSON.stringify(["rank", ...ROLLABLE.flatMap(fieldsOf)].map((f) => state?.[f] ?? null));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${h.toString(36)}.${text.length.toString(36)}`;
}
/** mark a state as "exactly what its hero code rolls" */
export const stamp = (state) => patch(state, { rolledAs: { code: heroCode(state), print: heroPrint(state) } });
/** true when pasting heroCode(state) rolls exactly this hero (same world content): the code and every rolled value are those of a fresh roll.
    A row reroll, a reroll / rank change around kept rows, a hand edit that changed a value, or a changed roll setting makes it false. */
export const codeMatches = (state) => !!state?.rolledAs && state.rolledAs.code === heroCode(state) && state.rolledAs.print === heroPrint(state);
/** a new seed derived from the current one (deterministic: the same state rerolled gives the same new hero) */
function nextSeed(state) {
  let h = 0x811c9dc5;
  for (const ch of `${state.seed}:all:${heroPrint(state)}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36).padStart(6, "0").slice(-6);
}

// ---------- hero code ----------
const SEED_RE = /^[A-Za-z0-9_-]{1,24}$/;
export const heroCode = (state) => {
  const o = rollOptsOf(state);
  return [state.seed, state.rank, o.spice, o.within ? "arch" : "free", o.joinBase ? "join" : "solo"].join(":");
};
/** parse "seed" or "seed:rank:spice:free|arch:solo|join" -> partial settings, or null when the seed part is invalid */
export function parseHeroCode(text) {
  const parts = String(text ?? "").trim().split(":").map((x) => x.trim());
  if (!SEED_RE.test(parts[0] ?? "")) return null;
  const out = { seed: parts[0] };
  if (RANK_ORDER.includes(parts[1])) out.rank = parts[1];
  if (SPICES.includes(parts[2])) out.spice = parts[2];
  if (parts[3] === "arch" || parts[3] === "free") out.within = parts[3] === "arch";
  if (parts[4] === "join" || parts[4] === "solo") out.joinBase = parts[4] === "join";
  return out;
}
/** state with the settings of a parsed code applied (rank, spice preset, scope, team tie); the seed is applied by reseed() */
export function withCode(state, code) {
  let s = state;
  if (code.rank && code.rank !== s.rank) s = setRank(s, code.rank);
  if (code.spice) s = withSpice(s, code.spice);
  if (code.within != null) s = withToggle(s, "within", code.within);
  if (code.joinBase != null) s = withToggle(s, "joinBase", code.joinBase);
  return s;
}
