/* LTOK: TOKEN REACTIONS, the pure half (no Foundry, no canvas; node-checked by scripts/sweep-checks/ltok.mjs).
   When a character's Health or Resolve changes, its token answers on the map with comic lettering from the shared engine
   (scripts/letters/, contract: LETR API v1). This file decides WHAT is said and HOW it moves; main.mjs only reads Foundry and plays.
     classify(change)         -> { stat, kind, n, r }            what happened and how much
     audience(seat, c, pub)   -> { show, kind, num }              what this seat may be shown (never more than the table was shown)
     look(c, num, lang, seed) -> { word, mood, sound, colors, size, hold, rotation, side, number }   the lettering of one reaction
     stage(items)             -> items with { delay, mode, scale }  many tokens at once stay readable
   Kinds: Health  hit | heavy | down (to 0 = broken [B2707]) | heal | back (up from 0 = rallied [B2773])
          Resolve stress | spent (stress taken by choice: a pushed roll, a power) | regain | out (0 = stressed out [B2816]) | steady (up from 0) */

export const HEALTH = ["hit", "heavy", "down", "heal", "back"];
export const RESOLVE = ["stress", "spent", "regain", "out", "steady"];
/* how much a reaction matters when many come at once: the heaviest keep their full lettering */
export const SEVERITY = { down: 9, out: 7, heavy: 6, back: 5, stress: 4, hit: 3, steady: 3, heal: 2, regain: 2, spent: 1 };

const fin = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);

/** change = { stat: "health" | "resolve", from, to, max, cause: "push" | null } -> { stat, kind, n, r } or null (no change) */
export function classify(change) {
  const stat = change?.stat, from = fin(change?.from), to = fin(change?.to), max = fin(change?.max);
  if ((stat !== "health" && stat !== "resolve") || from === null || to === null || from === to) return null;
  const d = to - from, n = Math.abs(d), r = max && max > 0 ? Math.min(1, n / max) : null;
  if (stat === "health") {
    if (d < 0) return { stat, kind: to <= 0 ? "down" : heavyLoss(n, r) ? "heavy" : "hit", n, r };
    return { stat, kind: from <= 0 ? "back" : "heal", n, r };
  }
  if (d < 0) return { stat, kind: to <= 0 ? "out" : change?.cause === "push" ? "spent" : "stress", n, r };
  return { stat, kind: from <= 0 ? "steady" : "regain", n, r };
}
/* heavy: three points at once, or half of the track (two at least) */
export const heavyLoss = (n, r) => n >= 3 || (r !== null && r >= 0.5 && n >= 2);

/** What one seat is shown. seat = { visible, staff, reader, challenge }: visible = the token is drawn for this user (a hidden token never
    is for a player); reader = may read this character's numbers (the damage card's rule: owner / observer, a hero of a player, a
    challenge). pub = what the table was told in public: { taken, toStress, broken } from a tactical event or the "Damage Taken" card.
    -> { show, kind, num } (num: the number to letter, or null) */
export function audience(seat, c, pub = null) {
  const none = { show: false, kind: null, num: null };
  if (!seat?.visible || !c) return none;
  if (seat.challenge && c.stat === "resolve") return none;      // a challenge's "Resolve" is its time limit: the Challenges HUD shows it
  if (seat.staff || seat.reader) return { show: true, kind: c.kind, num: c.n > 0 ? c.n : null, exact: true };
  const told = Number.isFinite(pub?.taken) && pub.taken > 0 ? Math.trunc(pub.taken) : null;
  if (c.stat === "resolve") {
    /* another character's Resolve is not shown at the table (splash H3-4); only stress the fight announced */
    if (told !== null && pub.toStress && (c.kind === "stress" || c.kind === "out" || c.kind === "spent")) return { show: true, kind: "stress", num: told };
    return none;
  }
  if (c.kind === "hit" || c.kind === "heavy" || c.kind === "down") {
    if (pub?.broken) return { show: true, kind: "down", num: told };
    if (told !== null) return { show: true, kind: told >= 3 ? "heavy" : "hit", num: told };
    return { show: true, kind: "hit", num: null };      // a hand edit: the blow is seen, how much is not
  }
  return { show: true, kind: "heal", num: null };      // healing or getting up: seen, not counted
}

/** An event the fight announced with no change of the track behind it (damage on a broken character: Health stays at 0). */
export function fromEvent(pub, stat) {
  const n = Number.isFinite(pub?.taken) ? Math.max(0, Math.trunc(pub.taken)) : 0;
  if (stat === "resolve") return n > 0 ? { stat, kind: "stress", n, r: null } : null;
  if (pub?.broken) return { stat: "health", kind: "down", n, r: null };
  return n > 0 ? { stat: "health", kind: n >= 3 ? "heavy" : "hit", n, r: null } : null;
}

/* ---------------------------------------------------------------- the words: comic sounds of the language, not translations */
export const WORDS = {
  en: {
    hit: ["POW!", "WHAM!", "THWACK!", "SMACK!", "BAM!", "KLUNK!"],
    heavy: ["KRAKOOM!", "WHAMMM!", "KA-BLAM!", "SKRAKK!", "BLAMM!"],
    down: ["THUD!", "KRUNCH!", "FLUMP!", "WHUMP!"],
    heal: ["PHEW!", "AAAH...", "HAAH!"],
    back: ["HUP!", "HRAAH!", "UP!"],
    stress: ["NGH!", "ARGH!", "GNNH!", "GRRR!"],
    spent: ["HNNG!", "HUFF!", "HMPF!"],
    regain: ["HAH!", "YES!", "OKAY!"],
    out: ["UGH...", "OOF...", "HAAH..."],
    steady: ["HAH!", "RIGHT!"]
  },
  pl: {
    hit: ["ŁUP!", "BACH!", "PAC!", "TRZASK!", "BUCH!", "PAF!"],
    heavy: ["ŁUBUDU!", "TRRACH!", "BUM!", "ŁUP-ŁUP!", "BRRUM!"],
    down: ["BĘC!", "ŁUPS!", "PLASK!", "GRUCH!"],
    heal: ["UFF!", "AACH...", "HAA!"],
    back: ["HOP!", "HYC!", "RAAA!"],
    stress: ["NGH!", "AARGH!", "GRRR!", "UGH!"],
    spent: ["HYYY!", "NNNGH!", "UMPF!"],
    regain: ["HA!", "TAK!", "DOBRA!"],
    out: ["UCH...", "OCH...", "EEEH..."],
    steady: ["HA!", "JUŻ!"]
  }
};

/* the sound of each kind (contract: mood + sound { loud, sharp, long, pitch, rough }); rising kinds rise, heavy ones fall */
const SOUND = {
  hit: { mood: "impact", sound: { loud: 0.5, sharp: 0.85, long: 0.2, pitch: 0, rough: 0.35 }, size: 0.92, hold: 650 },
  heavy: { mood: "crash", sound: { loud: 0.9, sharp: 0.95, long: 0.5, pitch: -0.2, rough: 0.75 }, size: 1.18, hold: 900 },
  down: { mood: "fail", sound: { loud: 0.8, sharp: 0.55, long: 0.8, pitch: -0.85, rough: 0.55 }, size: 1.12, hold: 1100 },
  heal: { mood: "heal", sound: { loud: 0.35, sharp: 0.1, long: 0.6, pitch: 0.6, rough: 0 }, size: 0.8, hold: 700 },
  back: { mood: "powerup", sound: { loud: 0.75, sharp: 0.5, long: 0.5, pitch: 0.9, rough: 0.2 }, size: 1.05, hold: 900 },
  stress: { mood: "pain", sound: { loud: 0.5, sharp: 0.9, long: 0.35, pitch: -0.2, rough: 0.85 }, size: 0.88, hold: 700 },
  spent: { mood: "tick", sound: { loud: 0.25, sharp: 0.6, long: 0.25, pitch: -0.3, rough: 0.4 }, size: 0.66, hold: 500 },
  regain: { mood: "powerup", sound: { loud: 0.4, sharp: 0.3, long: 0.4, pitch: 0.6, rough: 0.1 }, size: 0.8, hold: 650 },
  out: { mood: "fail", sound: { loud: 0.55, sharp: 0.2, long: 0.95, pitch: -0.9, rough: 0.3 }, size: 0.98, hold: 1100 },
  steady: { mood: "powerup", sound: { loud: 0.6, sharp: 0.4, long: 0.45, pitch: 0.8, rough: 0.1 }, size: 0.9, hold: 800 }
};
/* the colours say WHICH track moved: Health warm (loss) or green (back), Resolve cool; fill light to dark */
export const PALETTE = {
  health: ["#fff4b8", "#ffb02e", "#d4231c"],
  down: ["#ffe1d0", "#e8452c", "#6e0f12"],
  heal: ["#efffd9", "#7fd65a", "#1d7a36"],
  resolve: ["#e6f8ff", "#45bdf0", "#2a3f9e"],
  out: ["#e9e6ff", "#8a7ff0", "#33236e"],
  steady: ["#e6fff9", "#3fd8c4", "#145f7a"]
};
const PAL_OF = { hit: "health", heavy: "health", down: "down", heal: "heal", back: "heal", stress: "resolve", spent: "resolve", regain: "steady", out: "out", steady: "steady" };

/* a small, stable hash: the same seed gives the same choice on every seat */
export function hash(s) { let h = 2166136261 >>> 0; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
const pick = (list, h, avoid) => { let i = h % list.length; if (list.length > 1 && list[i] === avoid) i = (i + 1) % list.length; return list[i]; };

/** The lettering of one reaction. a = audience result { kind, num }, c = classify result (for r), last = the word this kind said last
    on this seat (never the same twice in a row). -> plan for main.mjs (sizes are factors of the world base size). */
export function look(a, c, lang, seed, last = null) {
  const kind = a?.kind;
  const s = SOUND[kind];
  if (!s) return null;
  const words = (WORDS[lang] ?? WORDS.en)[kind] ?? WORDS.en[kind];
  const h = hash(`${seed}|${kind}`);
  const word = pick(words, h, last);
  /* how much: the share of the track (when known to this seat) or the plain count swells the loud and the size a little */
  const r = a.exact && Number.isFinite(c?.r) ? c.r : null;      // the share of the track only for a seat that may read the track
  const amt = r !== null ? r : Number.isFinite(a.num) ? Math.min(1, a.num / 5) : 0.3;
  const loud = Math.max(0, Math.min(1, s.sound.loud + (amt - 0.3) * 0.35));
  const rot = (((h >>> 8) % 17) - 8) * (kind === "down" || kind === "out" ? 1.4 : 1);      // -8..8 degrees, more for a fall
  const side = (h >>> 4) % 2 ? 1 : -1;      // the number sits on this shoulder of the token
  const colors = PALETTE[PAL_OF[kind]];
  const sign = HEALTH.includes(kind) ? (kind === "heal" || kind === "back" ? "+" : "-") : (kind === "regain" || kind === "steady" ? "+" : "-");
  const number = Number.isFinite(a.num) && a.num > 0 && kind !== "spent"      /* spent: the pushed roll's splash already shows the stress */
    ? { text: `${sign}${a.num}`, mood: sign === "+" ? "heal" : "impact", sound: { loud: Math.min(1, 0.3 + amt * 0.4), sharp: sign === "+" ? 0.2 : 0.7, long: 0.25, pitch: sign === "+" ? 0.5 : -0.1, rough: 0.2 }, size: 0.62 + amt * 0.18, colors }
    : null;
  return { kind, word, mood: s.mood, sound: { ...s.sound, loud }, colors, size: s.size * (0.94 + amt * 0.16), hold: s.hold, rotation: Math.round(rot), side, number };
}

/** Many reactions in one moment (an area attack, fire at a round's start): the heaviest keep word + number, the next ones the number
    alone, the rest are left out; entrances are staggered and sizes shrink a little with the crowd. items: [{ key, sev, hasNum }]
    -> the same items (sorted, heaviest first) with { delay ms, mode: "full" | "number" | "none", scale } */
export const CROWD = { full: 3, shown: 10, gapFull: 140, gapCrowd: 70 };
export function stage(items) {
  const list = (items ?? []).filter(Boolean).slice().sort((a, b) => (b.sev ?? 0) - (a.sev ?? 0));
  const n = list.length, crowd = n > CROWD.full;
  const full = n > 6 ? 2 : CROWD.full, scale = n <= 1 ? 1 : n <= 3 ? 0.95 : n <= 6 ? 0.86 : 0.78;
  let t = 0, shown = 0;
  return list.map((it, i) => {
    let mode = i < full ? "full" : it.hasNum ? "number" : "none";
    if (mode !== "none" && shown >= CROWD.shown) mode = "none";
    if (mode !== "none") shown++;
    const out = { ...it, mode, scale, delay: mode === "none" ? 0 : t };
    if (mode !== "none") t += crowd ? CROWD.gapCrowd : CROWD.gapFull;
    return out;
  });
}

/** May this seat read the character's numbers (the damage card's rule, scripts/module.js dmgMayRead)? who = { gm, type, playerHero, observer } */
export const mayRead = (who) => !!who && (!!who.gm || who.type === "challenge" || (who.type === "superhero" && !!who.playerHero) || !!who.observer);

/** The public damage line of the system's "Damage Taken" card: "<strong>Name</strong> took <strong>N</strong> damage." (+ a second
    paragraph when a critical injury followed, i.e. Health went to 0). -> { taken, broken } or null */
export function damageLine(html) {
  const s = String(html ?? "");
  const paras = s.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) ?? [];
  const first = paras[0] ?? s;
  const nums = [...first.matchAll(/<strong\b[^>]*>\s*(\d+)\s*<\/strong>/gi)];
  if (!nums.length) return null;
  return { taken: Number(nums[nums.length - 1][1]), broken: paras.length > 1 };
}
