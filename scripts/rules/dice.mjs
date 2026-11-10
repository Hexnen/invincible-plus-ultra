/* Rules library: dice, pushing, opposed rolls, helping and success odds.
   Pure ES module: no Foundry globals, no imports. Nothing here rolls dice for live play; functions take dice that were already rolled
   (arrays of d6 faces) or compute exact probabilities. Functions that need randomness take `rng`, a function returning [0, 1).
   "book N" = line N of dev/book-dump.txt; "ruling N" = row N of section 4 of dev/combat-plan.md. */

export const SUCCESS = 6;
export const BANE = 1;

/* seedable PRNG (mulberry32) for tests and repeatable simulations */
export function seededRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const d6 = (rng) => 1 + Math.floor(rng() * 6);

/* book 2235: modifiers add or remove dice; a pool never goes below one die. */
export function poolSize(n) {
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
}

/* book 2207, 2235: pool = attribute (or power) score plus modifiers. mods: [{ source, dice }]. Returns { base, mods, total, dice }. */
export function buildPool(base, mods = []) {
  const list = mods.filter((m) => m && Number.isFinite(m.dice) && m.dice !== 0);
  const total = (Number.isFinite(base) ? base : 0) + list.reduce((s, m) => s + m.dice, 0);
  return { base, mods: list, total, dice: poolSize(total) };
}

/* book 2207, 2224: count successes (6) and banes (1) on rolled dice. */
export function tally(dice) {
  let sixes = 0, ones = 0;
  for (const d of dice) { if (d === SUCCESS) sixes++; else if (d === BANE) ones++; }
  return { size: dice.length, sixes, ones };
}

/* book 2224: a push re-rolls every die that shows neither a 6 nor a 1. Returns the indexes to re-roll. */
export function rerollable(dice) {
  const out = [];
  dice.forEach((d, i) => { if (d !== SUCCESS && d !== BANE) out.push(i); });
  return out;
}

/* book 2224: result of a push. `rerolled` = new faces for the indexes of rerollable(dice), in order. All dice count afterwards and each 1
   showing after the push costs 1 stress. Reading: "all dice count" includes 1s from the first roll (this is also what the game system
   charges); opts.stressOnes "new" counts only 1s that appeared in the re-roll.
   Returns { dice, sixes, ones, stress, pushed: true }. */
export function applyPush(dice, rerolled, opts = {}) {
  const idx = rerollable(dice);
  if (rerolled.length !== idx.length) throw new Error(`applyPush: expected ${idx.length} re-rolled dice, got ${rerolled.length}`);
  const out = dice.slice();
  idx.forEach((i, k) => { out[i] = rerolled[k]; });
  const t = tally(out);
  const before = tally(dice).ones;
  const stress = opts.stressOnes === "new" ? t.ones - before : t.ones;
  return { dice: out, sixes: t.sixes, ones: t.ones, stress, pushed: true };
}

/* May this roll be pushed? ctx: { resolve, passive, pushes (already made), maxPushes (1; talents may raise it), opposedDefender, hazard }.
   book 2227 passive or unaware rolls cannot be pushed; 2228 no push at Resolve 0 (a push is allowed even when the first roll shows more 1s
   than the current Resolve); 2229 only once unless a talent says otherwise; 2241 only the active party of an opposed roll pushes
   (exception: chases, see chase.mjs); 2922 a blast roll is never pushed (plan 5.2: hazards never push). The library makes no difference between heroes and NPCs here: major NPCs push like
   heroes (book 2231), NPCs in general push and take stress the same way (book 3909), a minion group has one Resolve used for pushing
   (book 2830). Which NPCs are offered the push is the engine's policy (open question OQ-12). */
export function canPush(ctx = {}) {
  if (ctx.hazard) return { ok: false, reason: "hazard" };
  if (ctx.passive) return { ok: false, reason: "passive" };
  if (ctx.opposedDefender) return { ok: false, reason: "defender" };
  if (!(ctx.resolve > 0)) return { ok: false, reason: "stressedOut" };
  if ((ctx.pushes ?? 0) >= (ctx.maxPushes ?? 1)) return { ok: false, reason: "alreadyPushed" };
  return { ok: true, reason: null };
}

/* ruling 3: when the attacker may push in an opposed roll is a world setting. "beforeDefence" = the attacker rolls and pushes, then the
   defender rolls; "afterDefence" = both roll, then the attacker may push. The defender never pushes (book 2241, 2446, 2524). */
export const OPPOSED_PUSH_ORDERS = ["beforeDefence", "afterDefence"];

/* book 2240, 2243: opposed roll. Every 6 of the adversary removes one 6 of the active party; the active party wins only with at least one 6
   left (so strictly more 6s). A tie fails for the active party. Returns { net, win, tie, surplus } where surplus = adversary 6s beyond
   what was needed to cancel everything (used by counterattacks and dodge moves). */
export function opposed(activeSixes, passiveSixes) {
  const net = Math.max(0, activeSixes - passiveSixes);
  return { net, win: net > 0, tie: activeSixes === passiveSixes, surplus: Math.max(0, passiveSixes - activeSixes) };
}

/* book 2210: every 6 beyond the first buys one stunt. */
export const stuntCount = (sixes) => Math.max(0, sixes - 1);

/* book 2238: up to three allies help, +1 die each. book 2827: minions helping minions go up to +9 (ten attack together). */
export const HELP_MAX = 3;
export const HELP_MAX_MINIONS = 9;
export function helpDice(helpers, opts = {}) {
  const cap = opts.minions ? HELP_MAX_MINIONS : HELP_MAX;
  return Math.max(0, Math.min(cap, Math.floor(helpers) || 0));
}

/* ------------------------------------------------------------------ probabilities (exact) ------------------------------------------------------------------ */

const P6 = 1 / 6;
const P_PUSHED_6 = 10 / 36;        // a die ends as a 6 after an unconditional push: 1/6 + 4/6 * 1/6
const P_REROLL_GAIN = 2 / 15;      // a die that is known not to be a 6 becomes one in the push: 4/5 * 1/6
const P_PUSHED_1 = 10 / 36;        // a die ends as a 1 after an unconditional push
const P_FAIL_PUSHED = 26 / 36;     // a die shows no 6 before and after the push

/* binomial distribution as an array: out[k] = P(k successes of n) */
export function binomial(n, p) {
  const out = new Array(n + 1).fill(0);
  out[0] = 1;
  for (let i = 0; i < n; i++) {
    for (let k = i + 1; k >= 1; k--) out[k] = out[k] * (1 - p) + out[k - 1] * p;
    out[0] *= 1 - p;
  }
  return out;
}

/* Distribution of the final number of 6s of a pool. policy: "never" (no push), "always" (push whatever the first roll shows),
   "onFail" (push only when the first roll has no 6). Rests on book 2207, 2224. Returns out[k] = P(k sixes). */
export function sixesPmf(pool, policy = "never") {
  const n = poolSize(pool);
  if (policy === "never") return binomial(n, P6);
  if (policy === "always") return binomial(n, P_PUSHED_6);
  if (policy === "onFail") {
    const first = binomial(n, P6);
    const afterFail = binomial(n, P_REROLL_GAIN);      // given no 6 at first, every die independently gains a 6 with 2/15
    return first.map((p, k) => (k === 0 ? first[0] * afterFail[0] : p + first[0] * afterFail[k]));
  }
  throw new Error(`sixesPmf: unknown policy ${policy}`);
}

/* chance of at least `need` sixes (default 1) */
export function pAtLeast(pool, need = 1, policy = "never") {
  const pmf = sixesPmf(pool, policy);
  let s = 0;
  for (let k = need; k < pmf.length; k++) s += pmf[k];
  return s;
}
export const pSuccess = (pool, policy = "never") => pAtLeast(pool, 1, policy);

/* expected stress of pushing (book 2224, all 1s showing after the push). given: "always" (push whatever happens, per roll made) or
   "onFail" (expected stress per roll when pushing only a roll without 6s). */
export function expectedPushStress(pool, given = "always") {
  const n = poolSize(pool);
  if (given === "always") return n * P_PUSHED_1;
  // onFail: P(no six) * n * P(die ends as 1 | die was not a 6) = (5/6)^n * n * (1/5 + 4/5 * 1/6)
  return Math.pow(5 / 6, n) * n * (1 / 3);
}

/* Opposed roll odds for the active party (book 2240-2243; the defender never pushes).
   push: "never" | "always" | "onFail" (attacker pushes before seeing the defence, only without a 6: ruling 3 "beforeDefence")
       | "ifLosing" (attacker sees the defence first and pushes when not winning: ruling 3 "afterDefence").
   defencePool null/undefined = unopposed. Returns { win, tie, lose, net } with net[k] = P(exactly k sixes left after cancelling), net[0] = P(not winning);
   tie = P(equal 6s, 0-0 included), lose = P(fewer 6s than the defender). */
export function opposedOdds(attackPool, defencePool = null, push = "never") {
  const n = poolSize(attackPool);
  const def = defencePool == null ? [1] : binomial(poolSize(defencePool), P6);
  const net = new Array(n + 1).fill(0);
  let tie = 0, lose = 0;
  const add = (k, d, p) => {
    if (p === 0) return;
    if (k > d) net[k - d] += p; else { net[0] += p; if (k === d) tie += p; else lose += p; }
  };
  if (push !== "ifLosing") {
    const att = sixesPmf(n, push);
    for (let d = 0; d < def.length; d++) for (let k = 0; k <= n; k++) add(k, d, att[k] * def[d]);
  } else {
    const first = binomial(n, P6);
    for (let d = 0; d < def.length; d++) {
      for (let k = 0; k <= n; k++) {
        const p = first[k] * def[d];
        if (k > d) { add(k, d, p); continue; }
        const gain = binomial(n - k, P_REROLL_GAIN);
        for (let g = 0; g < gain.length; g++) add(k + g, d, p * gain[g]);
      }
    }
  }
  const win = net.reduce((s, p, k) => (k > 0 ? s + p : s), 0);
  return { win, tie, lose, net };
}

/* approximate hit chance shown to a player: chance that at least one 6 survives the defence */
export const pHit = (attackPool, defencePool = null, push = "never") => opposedOdds(attackPool, defencePool, push).win;
