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
  return res;
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
    const res = await rollAll(patch(state, { locks: hold }), P, o);
    next = patch(res.state, { locks: state.locks });
  } else if ((step === "powers" || step === "talents") && !state.locks.attrs && state.touched.attributes) {
    // attributes edited by hand are kept: plan the new powers / talents around their sum instead of re-balancing them
    next = patch(await rollStep(patch(state, { locks: { ...state.locks, attrs: true } }), step, P, o), { locks: state.locks });
  } else next = await rollStep(state, step, P, o);   // powers / talents re-balance the unlocked attributes inside rollStep
  return next === state ? state : dropTouched(next, step);
}
/** reroll every row that is not kept */
export async function rerollUnlocked(state, P) {
  return rollAll(state, P, optsFor(state));
}
/** same hero rules, a new (or typed) seed: counters restart so the result equals a fresh roll of that seed, kept rows stay */
export async function reseed(state, seed, P) {
  // start from a clean slate (only kept rows carry their values over): a roll never reads the stale values of the rows it replaces, so the
  // result equals a fresh roll of that seed
  let s = patch(createState({ seed: String(seed), rank: state.rank, mode: "random" }), { rollOpts: state.rollOpts, locks: state.locks, touched: state.touched, identity: state.identity, appearance: state.appearance });
  for (const step of ROLLABLE) if (isKept(state, step)) for (const f of fieldsOf(step)) s = patch(s, { [f]: state[f] });
  if (state.team?.mode === "member") s = patch(s, { team: state.team });
  return rollAll(s, P, optsFor(state));
}
/** change the rank on the board: the powers count and caps change, so every row that is not kept is rolled again */
export async function changeRank(state, rank, P) {
  if (!RANKS[rank] || rank === state.rank) return { state };
  return rollAll(setRank(state, rank), P, optsFor(state));
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
