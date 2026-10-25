/**
 * Seedable PRNG for the character generator (pure ES module: Node + browser, no Foundry globals).
 *
 * cyrb128 string hash -> mulberry32. A seed is any string. Every generator step draws from its own
 * SUBSTREAM (`substream(seed, name)`), so re-rolling one step never changes another.
 * Math.random is used in exactly one place: newSeed().
 */

function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return (h1 ^ h2 ^ h3 ^ h4) >>> 0;
}

function mulberry32(a) {
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh short base36 seed (the only non-deterministic function in the generator). */
export function newSeed() {
  return Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, "0");
}

/** Create a generator from a seed string. */
export function createRng(seed) {
  const f = mulberry32(cyrb128(String(seed)));
  const rng = {
    seed: String(seed),
    /** float in [0,1) */
    float: f,
    /** integer 0..n-1 */
    int: (n) => Math.floor(f() * n),
    /** integer lo..hi inclusive */
    range: (lo, hi) => lo + Math.floor(f() * (hi - lo + 1)),
    chance: (p) => f() < p,
    /** one die with x sides: 1..x */
    die: (x) => 1 + Math.floor(f() * x),
    d3: () => 1 + Math.floor(f() * 3),
    d6: () => 1 + Math.floor(f() * 6),
    /** 2D6 -> { dice:[a,b], total } (personality uses the two dice as two picks) */
    twoD6() { const dice = [rng.d6(), rng.d6()]; return { dice, total: dice[0] + dice[1] }; },
    /** D66: tens die and units die -> 11..66 */
    d66() { return rng.d6() * 10 + rng.d6(); },
    /** NdX -> { dice, total } */
    ndx(n, x) { const dice = []; for (let i = 0; i < n; i++) dice.push(rng.die(x)); return { dice, total: dice.reduce((a, b) => a + b, 0) }; },
    /** uniform element (undefined for an empty array) */
    pick: (arr) => arr[Math.floor(f() * arr.length)],
    /** weighted element; weightFn(item, index) >= 0 */
    weighted(items, weightFn) {
      let total = 0;
      const ws = items.map((it, i) => { const w = Math.max(0, weightFn(it, i)); total += w; return w; });
      if (!items.length) return undefined;
      if (total <= 0) return items[Math.floor(f() * items.length)];
      let r = f() * total;
      for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r < 0) return items[i]; }
      return items[items.length - 1];
    },
    /** shuffled copy (Fisher-Yates) */
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    },
    /** k distinct elements */
    sample: (arr, k) => rng.shuffle(arr).slice(0, k)
  };
  return rng;
}

/** Independent stream for a named part of a hero: same seed + same name => same numbers. */
export function substream(seed, name) {
  return createRng(`${seed}:${name}`);
}
