/* LTOK: TOKEN REACTIONS, the pure half (no Foundry, no canvas; node-checked by scripts/sweep-checks/ltok.mjs).
   When a character's Health or Resolve changes, its token answers on the map with comic lettering from the shared engine
   (scripts/letters/, contract: LETR API v1). This file decides WHAT is said and HOW it moves; main.mjs only reads Foundry and plays.
     classify(change)         -> { stat, kind, n, r }            what happened and how much
     audience(seat, c, pub)   -> { show, kind, num }              what this seat may be shown (never more than the table was shown)
     look(a, c, lang, seed)   -> { word, mood, sound, colors, sev, amt, magnitude, hold, rotation, side, numbers }   one reaction
     combine(looks)           -> one look per token and moment (both tracks' numbers)
     stage(items)             -> items with { delay, mode, scale }  many tokens at once stay readable
     targetPx / basePx        -> the word's cap height on screen (severity, not chance)
     chooseSlot / slotPoint / clampInto / safeRect / group   -> where the group (word + numbers) stands, in screen px
   Kinds: Health  hit | heavy | down (to 0 = broken [B2707]) | heal | back (up from 0 = rallied [B2773])
          Resolve stress | spent (stress taken by choice: a pushed roll, a power) | regain | out (0 = stressed out [B2816]) | steady (up from 0) */
import { contactMs as wordContact, leadMs } from "../splash/impact-plan.mjs";
import { STEP_AT, SERIES_STEP, SERIES_MAX } from "../letters/impact/plan.mjs";
export { leadMs };
import { REF_VH, REF_VW } from "../same-picture.mjs";      // SAMEPIC: one picture for the table
export { REF_VH, REF_VW };

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

/* PRIV (the owner, 2026-11-14, asked whether a player may keep getting a lighter or other reaction than the GM: «nie»; the earlier ruling:
   GM and players see the same moment). Before, a seat without the right to a character's numbers got a reaction built from what the table
   was told (a hand-edited enemy blow was a plain hit, an enemy knocked down without a card a plain hit, an enemy's stress nothing) while the
   GM got the real one, and the token's animation followed each seat's own word (GM Stagger, player Recoil: ADVI 1, 13, ADVT2 12).
   Now the REACTION is one for every seat that sees the token (shared: its kind, and its amount = the word's loudness and size tier, the
   token's animation, the impact); only the NUMBER is per seat: a seat that may read the character gets the exact one, another seat only a
   number the table was told (the fight's damage event, the Damage Taken card). What is never shown stays the same: a seat that does not see
   the token gets nothing, and a challenge's "Resolve" (its time limit) is the HUD's. */
/** The reaction every seat that sees the token letters, from what happened (c = classify) and what the table was told (pub): -> { kind, amt }
    (amt 0..1: the share of the track or the count over AMT_N, whichever is bigger; a blow the card calls a knock-down is a knock-down) */
export function shared(c, pub = null) {
  if (!c) return null;
  const loss = c.kind === "hit" || c.kind === "heavy" || c.kind === "down";
  const kind = c.stat === "health" && loss && pub?.broken ? "down" : c.kind;
  const byN = Number.isFinite(c.n) && c.n > 0 ? Math.min(1, c.n / AMT_N) : null;
  const amt = Number.isFinite(c.r) ? Math.max(c.r, byN ?? 0) : byN ?? 0.3;
  return { kind, amt: Math.round(amt * 1e6) / 1e6 };
}
/** What one seat is shown. seat = { visible, staff, reader, challenge }: visible = the token is drawn for this user (a hidden token never
    is for a player); reader = may read this character's numbers (the damage card's rule: owner / observer, a hero of a player, a
    challenge). pub = what the table was told in public: { taken, toStress, broken } from a tactical event or the "Damage Taken" card.
    -> { show, kind, num, amt } (kind and amt: the shared reaction, the same on every seat that shows it; num: this seat's number, or null) */
export function audience(seat, c, pub = null) {
  const none = { show: false, kind: null, num: null };
  if (!seat?.visible || !c) return none;
  if (seat.challenge && c.stat === "resolve") return none;      // a challenge's "Resolve" is its time limit: the Challenges HUD shows it
  const s = shared(c, pub);
  if (seat.staff || seat.reader) return { show: true, kind: s.kind, num: c.n > 0 ? c.n : null, exact: true, amt: s.amt };
  return { show: true, kind: s.kind, num: toldNum(c, pub), amt: s.amt };
}
/** the number a seat without the right to read the character may letter: only what the table was told (a loss of Health, or stress the
    fight announced); healing, getting up and a Resolve change nobody announced are seen, not counted */
export function toldNum(c, pub = null) {
  const told = Number.isFinite(pub?.taken) && pub.taken > 0 ? Math.trunc(pub.taken) : null;
  if (!c || told === null) return null;
  if (c.stat === "resolve") return pub.toStress && (c.kind === "stress" || c.kind === "out" || c.kind === "spent") ? told : null;
  return c.kind === "hit" || c.kind === "heavy" || c.kind === "down" ? told : null;
}

/** An event the fight announced with no change of the track behind it (damage on a broken character: Health stays at 0). */
export function fromEvent(pub, stat) {
  const n = Number.isFinite(pub?.taken) ? Math.max(0, Math.trunc(pub.taken)) : 0;
  if (stat === "resolve") return n > 0 ? { stat, kind: "stress", n, r: null } : null;
  if (pub?.broken) return { stat: "health", kind: "down", n, r: null };
  return n > 0 ? { stat: "health", kind: n >= 3 ? "heavy" : "hit", n, r: null } : null;
}

/* ---------------------------------------------------------------- the words: the engine's vocabulary (FXLT2, ADVT2 finding 1)
   The token never ships its own word list (it had dictionary words, non-sounds and Polish diacritics): each reaction asks the shared
   vocabulary (L.word / L.vocab.series of scripts/letters/words.mjs) for a sound of the nearest kind, at a loudness that says how much
   (the tier picks the word, the "!" count 0..2 follows), seeded by the change's shared stamp so every seat letters the same word.
   VOCAB_KIND: the reaction kind -> the vocabulary's sound kind (the first one the engine knows is used). A blow to a body is a punch,
   a heavy one a smash, a fall a thud; healing and getting the nerve back are relief, getting up is a cheer, stress is pain, stress
   taken by choice is effort, stressed out is a sigh. Provisional where the vocabulary has no kind of its own (scratchpad letr
   REQUESTS FXLT2): getting up (back) and steady. */
export const VOCAB_KIND = {
  hit: ["punch"], heavy: ["smash"], down: ["thud"], heal: ["relief"], back: ["cheer"],
  stress: ["pain"], spent: ["effort"], regain: ["relief"], out: ["sigh"], steady: ["cheer"]
};
/* how loud each kind is said, from the smallest to the biggest amount (0..1): the vocabulary's tier (s < 0.34 <= m < 0.67 <= l) is the
   word, so a -1 hit says a short small sound and a -6 a long loud one (ADVT2 7: stress -1 and -6 were the same GRRR!) */
export const LOUD = {
  hit: [0.25, 0.66], heavy: [0.55, 1], down: [0.75, 1], heal: [0.25, 0.7], back: [0.5, 0.9],
  stress: [0.25, 0.9], spent: [0.15, 0.4], regain: [0.2, 0.6], out: [0.6, 1], steady: [0.4, 0.8]
};
/* a series of blows on one token (ADVT2 5: three blows 0.9 s apart were the same drawing three times): the next blow within STREAK.ms of
   the last one is step n of ONE growing sound (the vocabulary's series: the same template louder and longer, then its lead-in:
   WHAM! > WHAAM! > KA-WHAAM!), seeded by the first blow's stamp, so every seat that saw the blows letters the same series; the word
   also stands a little bigger each step */
export const STREAK = { ms: 3500, max: 4, grow: 0.14 };
export const isLoss = (kind) => kind === "hit" || kind === "heavy" || kind === "down" || kind === "stress" || kind === "out";
/** the vocabulary's kind for a reaction kind: the first of VOCAB_KIND[kind] the engine knows (has(id) -> bool), else the first */
export function vocabKind(kind, has = null) {
  const list = VOCAB_KIND[kind] ?? [];
  return (has ? list.find((k) => { try { return has(k); } catch { return false; } }) : null) ?? list[0] ?? null;
}
/** The word of one reaction from the engine's vocabulary. lk = look(), vocab = { word(kind, o), series?(kind, n, o), kinds? }.
    o = { lang, seed, step, streakSeed }. -> the text, or null (no vocabulary) */
export function wordFor(lk, vocab, o = {}) {
  if (!lk || !vocab?.word) return null;
  let has = vocab.has ?? null;
  if (!has && vocab.list) { try { const ids = new Set(vocab.list().map((x) => x?.id ?? x)); has = (k) => ids.has(k); } catch { has = null; } }
  const vk = vocabKind(lk.kind, has);
  if (!vk) return null;
  const step = Math.max(0, Math.min(STREAK.max, Math.floor(Number(o.step) || 0)));
  const lang = o.lang === "pl" ? "pl" : "en";
  /* the first blow is step 0 of its own series, so the second one grows from the word that was seen */
  const first = o.streakSeed ?? o.seed;
  try {
    if (vocab.series) {
      const s = vocab.series(vk, step + 1, { lang, loud: lk.loud, seed: `${first}|${vk}` });
      if (s?.[step]?.text) return s[step].text;
    }
    return vocab.word(vk, { lang, loud: lk.loud, seed: `${first}|${vk}`, step })?.text ?? null;
  } catch { return null; }
}

/* the sound of each kind (contract: mood + sound { loud, sharp, long, pitch, rough }); rising kinds rise, heavy ones fall. hold = ms the
   word stands after its entrance: long enough to be read at a glance from across the table (seen live: the engine's 650 ms was gone too soon).
   `sev` = how big the word stands next to a plain hit (1): the worse it is, the bigger (FXLT, review 5: a fall to 0 was the smallest word
   on screen). Down is a crash now (a heavy body hitting the floor), not "fail" (a deflating sigh in a thin hand: it read weak). */
const SOUND = {
  hit: { mood: "impact", sound: { loud: 0.6, sharp: 0.85, long: 0.2, pitch: 0, rough: 0.35 }, sev: 1, hold: 1000 },
  heavy: { mood: "crash", sound: { loud: 0.9, sharp: 0.95, long: 0.5, pitch: -0.2, rough: 0.75 }, sev: 1.5, hold: 1300 },
  down: { mood: "crash", sound: { loud: 1, sharp: 0.6, long: 0.7, pitch: -0.9, rough: 0.6 }, sev: 1.75, hold: 1500 },
  heal: { mood: "heal", sound: { loud: 0.45, sharp: 0.1, long: 0.6, pitch: 0.6, rough: 0 }, sev: 0.95, hold: 1000 },
  back: { mood: "powerup", sound: { loud: 0.8, sharp: 0.5, long: 0.5, pitch: 0.9, rough: 0.2 }, sev: 1.3, hold: 1300 },
  stress: { mood: "pain", sound: { loud: 0.6, sharp: 0.9, long: 0.35, pitch: -0.2, rough: 0.85 }, sev: 1, hold: 1000 },
  spent: { mood: "tick", sound: { loud: 0.3, sharp: 0.6, long: 0.25, pitch: -0.3, rough: 0.4 }, sev: 0.8, hold: 700 },
  regain: { mood: "powerup", sound: { loud: 0.5, sharp: 0.3, long: 0.4, pitch: 0.6, rough: 0.1 }, sev: 0.9, hold: 900 },
  out: { mood: "fail", sound: { loud: 0.8, sharp: 0.2, long: 0.95, pitch: -0.9, rough: 0.3 }, sev: 1.45, hold: 1500 },
  steady: { mood: "powerup", sound: { loud: 0.65, sharp: 0.4, long: 0.45, pitch: 0.8, rough: 0.1 }, sev: 1, hold: 1100 }
};
/* the animation technique per kind (contract v2 in / holdKind / out): picked by the seed among the ones that fit what happened, so two
   hits do not move alike; a blow slams in and shatters, a fall drops and droops, healing and getting up rise, stress buzzes */
export const MOTION = {
  hit: { in: ["slam", "pop"], hold: ["shake", "rattle"], out: ["shatter", "pop"] },
  heavy: { in: ["slam"], hold: ["rattle", "shake"], out: ["shatter", "burst"] },
  down: { in: ["drop"], hold: ["wobble", "rattle"], out: ["fall", "droop"] },
  heal: { in: ["rise", "pop"], hold: ["throb", "boil"], out: ["rise", "dissolve"] },
  back: { in: ["grow", "rise"], hold: ["throb"], out: ["rise"] },
  stress: { in: ["pop", "crackIn"], hold: ["buzz", "wobble"], out: ["droop", "dissolve"] },
  spent: { in: ["pop"], hold: ["boil"], out: ["dissolve"] },
  regain: { in: ["rise", "grow"], hold: ["throb"], out: ["rise"] },
  out: { in: ["drop"], hold: ["wobble"], out: ["droop", "fall"] },
  steady: { in: ["grow"], hold: ["throb"], out: ["rise"] }
};
/* the colours say WHICH track moved: Health hot (loss) or green (back); Resolve is strain: magenta to violet (FXLT, review 11: the cool
   blue with the pain hand's drips read as icicles, cold, not effort); getting the nerve back is teal. Fill light to dark. */
export const PALETTE = {
  health: ["#fff4b8", "#ffb02e", "#d4231c"],
  down: ["#ffe1d0", "#e8452c", "#6e0f12"],
  heal: ["#efffd9", "#7fd65a", "#1d7a36"],
  resolve: ["#ffe3f3", "#ff4fae", "#8a1468"],
  out: ["#f1e3ff", "#a75cf0", "#3a1470"],
  steady: ["#e6fff9", "#3fd8c4", "#145f7a"]
};
const PAL_OF = { hit: "health", heavy: "health", down: "down", heal: "heal", back: "heal", stress: "resolve", spent: "resolve", regain: "steady", out: "out", steady: "steady" };

/* ---------------------------------------------------------------- numbers: ONE hand for every number (FXLT, review 3)
   A number is information, not a sound: it is lettered the same way every time, in a face whose digits cannot be mistaken (Bungee:
   its 1 has a flag AND a foot, its 7 none, its minus a thick bar at mid height; FXLT2, ADVT2 13: Titan One's 1 has a big flag and no
   foot, so a reduced-motion "-7" read as a flagged "1" and its low thin minus merged with map labels into "="; the Bangers italic 1 read
   as a 7), flat (no warp, no tilt of its own), a black ink line inside a white cut
   edge so it holds on any map, a short extrusion for weight; only the colour says which track and which way. Passed to the engine as
   `hand` (contract v2: pins the look; the engine merges it over its own choice). */
export const NUM_PAL = {
  "health-": { fill: ["#fffbe6", "#ffd84a", "#ff7a1a"], ext: "#7a1608" },
  "health+": { fill: ["#f4fff0", "#97f27e", "#22a84a"], ext: "#0b3a1a" },
  "resolve-": { fill: ["#fff0f9", "#ff8fd2", "#d81f9a"], ext: "#3d0a33" },
  "resolve+": { fill: ["#ecfffb", "#7ff2df", "#17a69c"], ext: "#073b3a" }
};
export function numHand(stat, sign) {
  const p = NUM_PAL[`${stat === "resolve" ? "resolve" : "health"}${sign === "+" ? "+" : "-"}`];
  return {
    font: "bungee", treat: "plain", env: "flat", tex: "none", outline: "sticker", fill: "vgrad", stack: "stack", colorFam: "num",
    pal: { fill: p.fill.slice(), ext: p.ext, out2: "#ffffff", ink: "#160a14" }, ink: "#160a14",
    inkW: 0.07, out2W: 0.075, inflate: 0, depth: 0.12, depthAng: Math.PI * 0.3, shadow: { d: 0.1, ang: Math.PI * 0.3, a: 0.5 },
    gloss: true, shadowStyle: "flat", hatch: false, bevel: false, shear: 0, track: -0.03, hueJitter: 0,
    id: `bungee/plain/flat/num${stat === "resolve" ? "R" : "H"}${sign === "+" ? "p" : "m"}/sticker/vgrad`
  };
}
/* a number's own sound: even, not rough (rough = each digit tilted on its own), a little louder when bigger */
const numSound = (sign, amt) => ({ loud: Math.min(1, 0.5 + amt * 0.3), sharp: 0.5, long: 0.1, pitch: 0, rough: 0, peak: 0.5 });

/* ---------------------------------------------------------------- size: severity, not chance (FXLT, review 5)
   The word's cap height ON SCREEN is planned here and handed to the engine as a `scale` on its own size model (main.mjs measures the
   model's natural size with L.sizeOf and scales it to this target): base = a third of the token on screen, never under the legible floor,
   never over 7 % of the view's height; times the kind's severity, the amount, and a little more for a short word (the eye weighs a word
   by its area: "BĘC!" must not look lighter than "BACH!"). Below the floor the engine's legible clamp flattens every size to the same
   floor, so the base starts at the floor and severity lifts it from there. */
export const SIZE_RULE = { tokenK: 0.3, floorVh: 0.03, floorMin: 15, floorMax: 34, baseMaxVh: 0.065, shortLen: 5, shortPow: 0.35, numK: 0.8, crowdNumK: 1,
  capVh: 0.14, widthTok: 3, widthVw: 0.3, aspect: 0.85, amtLo: 0.8, amtK: 0.7 };      /* seen live (lane 8, grid 350 at zoom 0.42): with the base at 7 % of the view a fall's word ran 900 px wide; now the cap
  stays under 12 % of the view height and the word (estimated 0.85 cap per letter) under 3 tokens or 30 % of the view width, whichever is wider.
  numK: a number beside a word was 0.62 of its cap and read as a footnote live (lane 8 zoom 1.2: -3 at 47 px beside BLAMM! at 76 px, but the
  word's drawn box with depth and outline is 1.46 caps tall against the number's 0.96, so the number looked under half the word); 0.8 now.
  FXLT2 (ADVT2 7: a plain hit stood 50-60 px beside a 160-560 px token, -15 as big as -4): the base may reach 6.5 % of the view, the cap
  14 %, and the amount scales the word from 0.8x (the least) to 1.5x (the most) instead of +25 % at most */
/* FXI-TOKEN (ADVI 16: at zoom 0.2 the words were very small): the legible floor is 3 % of the view height (was 2.6 %), at most 34 px */
export function basePx(tokenPx, vh) {
  const floor = Math.max(SIZE_RULE.floorMin, Math.min(SIZE_RULE.floorMax, vh * SIZE_RULE.floorVh));
  return Math.max(floor, Math.min(vh * SIZE_RULE.baseMaxVh, tokenPx * SIZE_RULE.tokenK));
}
const letters = (w) => [...String(w ?? "")].filter((ch) => /[\p{L}\p{N}]/u.test(ch)).length;
/** the cap height (screen px) one reaction's word should have: kind, amount 0..1, the word, the token's size on screen, the view height */
export function targetPx(kind, amt, word, tokenPx, vh, vw = vh * 16 / 9, k = 1) {
  const s = SOUND[kind]; if (!s) return 0;
  const n = Math.max(2, letters(word)), short = Math.max(1, (SIZE_RULE.shortLen / n) ** SIZE_RULE.shortPow);
  const want = basePx(tokenPx, vh) * s.sev * (SIZE_RULE.amtLo + SIZE_RULE.amtK * Math.max(0, Math.min(1, amt))) * short * k;
  const widthCap = Math.max(SIZE_RULE.widthTok * tokenPx, SIZE_RULE.widthVw * vw) / (SIZE_RULE.aspect * (n + 0.5));
  return Math.max(Math.min(want, vh * SIZE_RULE.capVh, widthCap), basePx(tokenPx, vh) * Math.min(1, s.sev) * Math.min(1, k));
}
/** the drawn word against the same limits (FXLT, seen on lane 20 with engine 1.6.0): the cap height obeys targetPx, but a tall hand (stacked
    letters, a deep extrusion: "FLUMP!" drew 2.1 caps tall) or a wide one still covered three tokens at zoom 0.42. Once the engine has
    measured the drawn box (hold box, in caps) the word shrinks so the box stays under capVh x 1.25 of the view height and inside the width cap.
    -> a factor <= 1 for the scale */
export function fitDrawn({ cap, hbW, hbH, tokenPx, vh, vw = vh * 16 / 9 }) {
  if (!(cap > 0) || !(hbW > 0) || !(hbH > 0)) return 1;
  const maxH = vh * SIZE_RULE.capVh * 1.25, maxW = Math.max(SIZE_RULE.widthTok * tokenPx, SIZE_RULE.widthVw * vw);
  return Math.min(1, maxH / (cap * hbH), maxW / (cap * hbW));
}
/* the engine's magnitude (contract v4, 0..2): it lifts the engine's ceiling for the worst blows; the size itself is targetPx */
export const magOf = (kind, amt = 0.3) => { const s = SOUND[kind]; return s ? Math.round(Math.max(0, Math.min(1.2, (s.sev - 0.7) * 0.9 + 0.15 * amt)) * 100) / 100 : 0.5; };

/* a small, stable hash: the same seed gives the same choice on every seat */
export function hash(s) { let h = 2166136261 >>> 0; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }

/** The seed of one change: the token, the track and the moment the server stamped on the document. Never the values: the hand, the tilt
    and the word derive from it, and a player must not be able to work hidden Health back out of them (FXLT, review 18); and never what
    one seat happened to see before (review 15: each seat's own `from` and its own last word gave two seats two words). */
export const seedOf = (tokId, stat, stamp) => `${tokId}|${stat}|${stamp ?? ""}`;

/** How much happened, 0..1, as this seat may know it (FXLT2, ADVT2 7: -15 stood as big as -4). A reader: the share of the track or the
    count over AMT_N, whichever is bigger (a -15 on a long track is still a lot); another seat: the told number alone; nothing told: 0.3. */
export const AMT_N = 8;
export function amountOf(a, c) {
  if (Number.isFinite(a?.amt)) return Math.max(0, Math.min(1, a.amt));      // PRIV: the shared reaction's amount, the same on every seat
  const r = a?.exact && Number.isFinite(c?.r) ? c.r : null;      // the share of the track only for a seat that may read the track
  const byN = Number.isFinite(a?.num) && a.num > 0 ? Math.min(1, a.num / AMT_N) : null;
  if (r !== null) return Math.max(r, byN ?? 0);
  return byN ?? 0.3;
}
/** The lettering of one reaction. a = audience result { kind, num, exact }, c = classify result (for r). Deterministic in (a, c, lang,
    seed): every seat with the same audience letters it the same. vocab (the engine's vocabulary, optional): the word is filled in here;
    without it `word` is null and main.mjs fills it (wordFor) once the engine is up. -> plan for main.mjs. */
export function look(a, c, lang, seed, vocab = null, o = {}) {
  const kind = a?.kind;
  const s = SOUND[kind];
  if (!s) return null;
  const h = hash(`${seed}|${kind}`);
  const amt = amountOf(a, c);
  const [lo, hi] = LOUD[kind] ?? [0.3, 0.7];
  const loud = Math.round(Math.max(0, Math.min(1, lo + (hi - lo) * amt)) * 1000) / 1000;
  const rot = (((h >>> 8) % 13) - 6) * (kind === "down" || kind === "out" ? 1.5 : 1);      // -6..6 degrees, more for a fall
  const side = (h >>> 4) % 2 ? 1 : -1;      // the number stands on this side of the word
  const colors = PALETTE[PAL_OF[kind]];
  const stat = HEALTH.includes(kind) ? "health" : "resolve";
  const sign = kind === "heal" || kind === "back" || kind === "regain" || kind === "steady" ? "+" : "-";
  const number = Number.isFinite(a.num) && a.num > 0 && kind !== "spent"      /* spent: the pushed roll's splash already shows the stress */
    ? numberLook(stat, sign, a.num, amt)
    : null;
  const mo = MOTION[kind], at = (list, k) => list[(h >>> k) % list.length];
  const motion = { in: at(mo.in, 11), holdKind: at(mo.hold, 14), out: at(mo.out, 17) };
  const lk = { kind, stat, word: null, vk: vocabKind(kind), loud, step: 0, motion, mood: s.mood, sound: { ...s.sound, loud }, colors, sev: s.sev, amt, magnitude: magOf(kind, amt), hold: s.hold, rotation: Math.round(rot), side, numbers: number ? [number] : [], number };
  if (vocab) lk.word = wordFor(lk, vocab, { lang, seed, step: o.step, streakSeed: o.streakSeed });
  return lk;
}
/** one number: text, the fixed hand, its sound, a fixed small tilt (none of its own randomness) */
export function numberLook(stat, sign, n, amt = 0.3) {
  const hand = numHand(stat, sign);
  return { text: `${sign}${n}`, stat, sign, mood: "impact", sound: numSound(sign, amt), hand, colors: hand.pal.fill.slice(), in: "pop", holdKind: "shake", out: "pop" };
}

/** Two tracks changed on one token in one moment (a hit that also cost Resolve; a pushed roll during a hit): ONE reaction, the heavier
    kind's word, and both numbers (FXLT, review 4: the second play stopped the first and, sorted by severity, the lighter one won).
    looks: [look] of one token -> one look (numbers: Health first). */
export function combine(looks) {
  const list = (looks ?? []).filter(Boolean);
  if (list.length <= 1) return list[0] ?? null;
  const main = list.slice().sort((a, b) => (SEVERITY[b.kind] ?? 0) - (SEVERITY[a.kind] ?? 0))[0];
  const nums = list.flatMap((l) => l.numbers ?? []).sort((a, b) => (a.stat === "health" ? 0 : 1) - (b.stat === "health" ? 0 : 1));
  return { ...main, numbers: nums, number: nums[0] ?? null, also: list.filter((l) => l !== main).map((l) => l.kind) };
}

/** A reaction arrives while another plays on the same token: "replace" (the new one is as bad or worse, or the old one has been read),
    or "queue" (a lighter one waits until the heavier one has been read: the worse news is not cut off by a smaller one). FXLT2 (ADVT2 5:
    a heal 1.2 s after a hit waited ~2 s, for the hit's whole hold and exit): "read" is READ_MS after its start, not its whole span;
    queueWait says how long the lighter one waits. */
export const READ_MS = 700;
export function overlap(playingSev, playingAge, playingSpan, newSev) {
  if (!Number.isFinite(playingSev)) return "play";
  if (newSev >= playingSev) return "replace";
  return playingAge < Math.min(playingSpan, READ_MS) ? "queue" : "replace";
}
export const queueWait = (playingAge, playingSpan) => Math.max(0, Math.min(playingSpan, READ_MS) - playingAge);

/** Many reactions in one moment (an area attack, fire at a round's start): the heaviest keep word + number, the next ones the number
    alone, a hit whose number this seat may not see gets a small word ("mark") so a visible blow never goes unanswered (FXLT, review 6);
    over the cap the rest are left out; entrances are staggered and sizes shrink a little with the crowd. items: [{ key, sev, hasNum }]
    -> the same items (sorted, heaviest first) with { delay ms, mode: "full" | "number" | "mark" | "none", scale } */
export const CROWD = { full: 3, shown: 10, gapFull: 140, gapCrowd: 70, markK: 0.8 };
export function stage(items) {
  const list = (items ?? []).filter(Boolean).slice().sort((a, b) => (b.sev ?? 0) - (a.sev ?? 0));
  const n = list.length, crowd = n > CROWD.full;
  /* FXI-TOKEN (ADVI 15: seven tokens hit at once, only two had a word): three keep their word in a big crowd too; the words may shrink to a
     free side now (fitSlot) */
  const full = CROWD.full, scale = n <= 1 ? 1 : n <= 3 ? 0.95 : n <= 6 ? 0.86 : 0.78;
  let t = 0, shown = 0;
  return list.map((it, i) => {
    let mode = i < full ? "full" : it.hasNum ? "number" : "mark";
    if (shown >= CROWD.shown) mode = "none";
    if (mode !== "none") shown++;
    const out = { ...it, mode, scale: mode === "mark" ? scale * CROWD.markK : scale, delay: mode === "none" ? 0 : t };
    if (mode !== "none") t += crowd ? CROWD.gapCrowd : CROWD.gapFull;
    return out;
  });
}

/* ---------------------------------------------------------------- where it stands (FXLT, reviews 1, 6, 12)
   All in screen px of the client. The word (and its number beside it) is a GROUP box; it is placed once, at its start, on the side of
   its token that is free: above first, then the upper corners, the sides, below, and last ON its own token (in a packed crowd the sound
   sits over the one who took the blow rather than over a neighbour: review 6 saw Eve's word on Omni-Man); a side is worse the more it
   covers other tokens (heavily: that is a wrong attribution), other words of the moment and the token's own face, and much worse the
   more it sticks out of the safe rect (the view minus the interface and the director's letterbox bars). Afterwards it follows its token (same side) and is pushed back into the safe rect every frame
   while its token is on screen (a token off screen keeps its word with it: a word pinned to the edge would point at nothing). */
export const SLOTS = ["above", "aboveR", "aboveL", "right", "left", "below", "on"];
/* FXLT2 (ADVT2 6, 10): a word over another word of the moment is unreadable (crowd words overlapped) and a word under a floating panel
   (the challenge cards, the map's VRAM meter, the party cards) is unseen: both now cost more than sticking out of the view */
/* FXI-TOKEN (ADVI 5: KA-WRAAAAMM!!, KA-THOOOOOM!! stood on their own token for the whole 1.3-1.5 s hold): the owner, words must not hide the
   token for long; covering the own token now costs nearly as much as covering another (was 0.6) */
export const SLOT_K = { own: 2, token: 2.5, word: 4, panel: 8 };      // what covering costs: the own token, another token, another word, a panel
/** the group's centre for one slot. tok = { x, y, w, h } (screen), box = { w, h } (the group with its motion room) */
export function slotPoint(slot, tok, box, gap = 4) {
  const cx = tok.x + tok.w / 2, cy = tok.y + tok.h / 2;
  switch (slot) {
    case "above": return { x: cx, y: tok.y - gap - box.h / 2 + tok.h * 0.12 };
    case "aboveR": return { x: tok.x + tok.w * 0.75 + box.w * 0.25, y: tok.y - gap - box.h / 2 + tok.h * 0.2 };
    case "aboveL": return { x: tok.x + tok.w * 0.25 - box.w * 0.25, y: tok.y - gap - box.h / 2 + tok.h * 0.2 };
    case "right": return { x: tok.x + tok.w + gap + box.w / 2, y: cy - tok.h * 0.1 };
    case "left": return { x: tok.x - gap - box.w / 2, y: cy - tok.h * 0.1 };
    case "on": return { x: cx, y: cy - tok.h * 0.12 };
    default: return { x: cx, y: tok.y + tok.h + gap + box.h / 2 };
  }
}
const rectAt = (p, box) => ({ x: p.x - box.w / 2, y: p.y - box.h / 2, w: box.w, h: box.h });
const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
/** how far a rect sticks out of the safe rect (area outside) */
export function outside(r, safe) { return r.w * r.h - inter(r, { x: safe.l, y: safe.t, w: safe.r - safe.l, h: safe.b - safe.t }); }
/** pick the slot. blocked = [{ x, y, w, h, k }] (k = weight, SLOT_K: other tokens, words); own = the token itself (its face) */
export function chooseSlot(tok, box, safe, blocked = [], { prefer = 0 } = {}) {
  return fitSlot(tok, box, safe, blocked, { prefer, ks: [1] }).slot;
}
/* FXI-TOKEN (ADVI 5, 16): a side that is not free is not taken at full size any more. A big word (a heavy blow, a grown step of a series)
   whose every side covered a neighbour, a panel, its own token or the view's edge stood ON its token for its whole hold, or was pushed by
   the view's edge back over it, or ~300 px away from a token in a corner. Now the group may shrink (FIT.ks) to take a free side, at a cost
   that keeps it big when it can be; the slot "on" (over its own token) is never chosen; the side the series' last word took is kept (keep)
   only while it stays about as good as the best (FIT.keepBonus): a word that grew out of its side moves. */
export const FIT = { ks: [1, 0.86, 0.74, 0.62, 0.52], shrinkK: 1.6, keepBonus: 0.12 };
export const FIT_SLOTS = SLOTS.filter((s) => s !== "on");
/** -> { slot, k (scale of the group box), score } */
export function fitSlot(tok, box, safe, blocked = [], { prefer = 0, keep = null, ks = FIT.ks } = {}) {
  let best = { slot: FIT_SLOTS[0], k: 1, score: Infinity };
  const own = { ...tok, k: SLOT_K.own }, A = box.w * box.h;
  for (const k of ks) {
    const b = { w: box.w * k, h: box.h * k };
    FIT_SLOTS.forEach((slot, i) => {
      const r = rectAt(slotPoint(slot, tok, b), b);
      let s = i * 0.04 * b.w * b.h + (1 - k) * A * FIT.shrinkK;      // the order is the preference: above unless it costs; then size
      if (prefer && ((prefer > 0 && slot === "aboveL") || (prefer < 0 && slot === "aboveR"))) s += 0.02 * b.w * b.h;
      if (keep && slot === keep) s -= FIT.keepBonus * A;
      for (const q of [own, ...blocked]) s += inter(r, q) * (q.k ?? 1);
      if (safe) s += outside(r, safe) * 6;
      if (s < best.score) best = { slot, k, score: s };
    });
  }
  return best;
}
/* SAMEPIC (owner, binding: the GM and the players see the SAME moment; ADVX 9, 13: one hit, another size and side per seat, a word cut by
   the view's top on one seat and whole on the other). The side and size are fitted on what every seat shares (the token, the tokens nobody
   hides, the other words of the moment, the splash's block) inside the STANDARD view (same-picture.mjs: Foundry's bars reserved alike, the
   sidebar as if open), and kept unless THIS seat would really cut it (a smaller window, a sidebar wider than the reserve) or hide it under
   its own panel (the GM's desk): only then is it fitted again here with those too. -> fitSlot's result + { same } (false = moved here) */
export function fitSame(tok, box, std, real, shared = [], local = [], o = {}) {
  const a = fitSlot(tok, box, std, shared, o);
  const b = { w: box.w * a.k, h: box.h * a.k }, r = rectAt(slotPoint(a.slot, tok, b), b);
  const outR = real ? outside(r, real) : 0, outS = std ? outside(r, std) : 0;
  const clean = outR <= outS + 1 && !local.some((q) => inter(r, q) > 1);
  if (clean) return { ...a, same: true };
  return { ...fitSlot(tok, box, real ?? std, [...shared, ...local], { ...o, keep: o.keep ?? a.slot }), same: false };      // the shared side is kept while it stays about as good
}
/** is the token on the view (see ON_VIEW) */
/* FXLT2 (ADVT2 11: a visible token at the view's edge, partly under the side controls or the hotbar, got nothing at 35 %): a token
   counts when ON_VIEW of it is inside the safe rect, or its centre is; its word is placed on the inward side (chooseSlot) */
export const ON_VIEW = 0.15;
export const onView = (r, safe) => {
  if (!r || !safe) return false;
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  if (cx >= safe.l && cx <= safe.r && cy >= safe.t && cy <= safe.b) return true;
  return inter(r, { x: safe.l, y: safe.t, w: safe.r - safe.l, h: safe.b - safe.t }) >= ON_VIEW * r.w * r.h;
};
/** FXLT2: move a group centre out of floating panels (rects { x, y, w, h }): for each panel it overlaps, the smallest of the four moves
    that clears it, preferring one that stays inside the safe rect; two passes (a move off one panel onto another) */
export function avoidRects(p, box, rects = [], safe = null) {
  let c = { x: p.x, y: p.y };
  for (let pass = 0; pass < 2; pass++) for (const q of rects ?? []) {
    if (!q || !(q.w > 0) || !(q.h > 0) || !inter(rectAt(c, box), q)) continue;
    const moves = [{ x: q.x - box.w / 2 - 2 - c.x, y: 0 }, { x: q.x + q.w + box.w / 2 + 2 - c.x, y: 0 }, { x: 0, y: q.y - box.h / 2 - 2 - c.y }, { x: 0, y: q.y + q.h + box.h / 2 + 2 - c.y }]
      .map((d) => ({ d, n: Math.hypot(d.x, d.y), out: safe ? outside(rectAt({ x: c.x + d.x, y: c.y + d.y }, box), safe) : 0 }))
      .sort((a, b) => (a.out - b.out) || (a.n - b.n));
    c = { x: c.x + moves[0].d.x, y: c.y + moves[0].d.y };
  }
  return c;
}
/** push a group centre into the safe rect (a group bigger than the rect is centred in it) */
export function clampInto(p, box, safe) {
  if (!safe) return p;
  const fit = (v, half, lo, hi) => (hi - lo < half * 2 ? (lo + hi) / 2 : Math.max(lo + half, Math.min(hi - half, v)));
  return { x: fit(p.x, box.w / 2, safe.l, safe.r), y: fit(p.y, box.h / 2, safe.t, safe.b) };
}
/** the safe rect: the canvas view minus whatever hugs one of its edges (the sidebar, the hotbar and the chat input, the scene bar, the
    controls) and minus the director's letterbox bars, with a small margin. view = { l, t, r, b }; covers = [{ x, y, w, h }] */
export function safeRect(view, covers = [], margin = 8) {
  const s = { ...view };
  const W = view.r - view.l, H = view.b - view.t;
  for (const c of covers) {
    if (!c || !(c.w > 0) || !(c.h > 0)) continue;
    const r = c.x + c.w, b = c.y + c.h;
    if (r <= view.l || c.x >= view.r || b <= view.t || c.y >= view.b) continue;      // not over the view
    const cuts = [];
    if (c.w < W * 0.6 && r >= view.r - 24) cuts.push(["r", c.x, (view.r - c.x) / W]);
    if (c.w < W * 0.6 && c.x <= view.l + 24) cuts.push(["l", r, (r - view.l) / W]);
    if (c.h < H * 0.5 && b >= view.b - 24) cuts.push(["b", c.y, (view.b - c.y) / H]);
    if (c.h < H * 0.5 && c.y <= view.t + 24) cuts.push(["t", b, (b - view.t) / H]);
    if (!cuts.length) continue;
    const [side, v] = cuts.sort((x, y) => x[2] - y[2])[0];      // cut the thinner way (a bar along the bottom cuts the bottom)
    if (side === "r") s.r = Math.min(s.r, v); else if (side === "l") s.l = Math.max(s.l, v); else if (side === "b") s.b = Math.min(s.b, v); else s.t = Math.max(s.t, v);
  }
  return { l: s.l + margin, t: s.t + margin, r: s.r - margin, b: s.b - margin };
}
/** the group of one reaction in screen px: the word box and its numbers beside it (on `side`, a little lower: a tag on the word, not on
    the token's face, review 12). cap = word cap height, aspect = word width / cap; numCap; up / down = room for the motion (a rise goes
    up about half a cap, a drop comes from above, an overshoot swells ~15 %). -> { w, h, word: {dx, dy}, nums: [{dx, dy}] } offsets from
    the group centre */
export function group({ cap, aspect, tall = null, nums = [], numCap, side = 1, up = 0.5, down = 0.25 }) {
  const ww = cap * Math.max(0.6, aspect) * (tall ? 1.04 : 1.12), wh = cap * (tall ? tall * 1.04 : 1.3);      // tall/aspect measured from the drawn word: a small margin only
  /* FXI-TOKEN (ADVI 5: "-15" ran under the challenge cards, "-3" onto a neighbour): Bungee digits with their cut edge and extrusion draw about
     0.8 of a cap wide, not 0.68: the group box (and so the side chosen for it) holds the whole number */
  const nw = nums.map((t) => numCap * (0.25 + 0.8 * letters(t) + (/^[+-]/.test(t) ? 0.55 : 0)));
  const colW = nw.length ? Math.max(...nw) : 0, nh = numCap * 1.25;
  const gap = colW ? cap * 0.28 : 0;    // seen live: "BLAMM!-3" touched and read as one word; at 0.1 a cap the left-hand number still
                                        // touched (the drawn word overruns its hold box on the left, lane 8 still6); 0.28 clears both sides
  const w = ww + (colW ? colW * 1.02 + gap : 0), h = Math.max(wh, wh * 0.35 + nh * nw.length) + cap * (up + down);
  const top = -h / 2 + cap * up;
  const wordC = { dx: -side * (colW ? (colW * 1.02 + gap) / 2 : 0), dy: top + wh / 2 };
  const numsC = nw.map((x, i) => ({ dx: wordC.dx + side * (ww / 2 + gap + colW * 0.51), dy: top + wh * 0.62 + nh * i }));
  return { w, h, word: wordC, nums: numsC };
}

/* ---------------------------------------------------------------- the impact frame (WIRE1; the engine's L.impact, scripts/letters/impact/)
   The owner (2026-11-13/14): impact frames may go all out and must be spectacular; a brief accent at the instant of the blow, never a
   lasting cover; one per event, never in a loop; a series of blows BUILDS and the strongest moment gets the strongest frame; GM and players
   see the same moment unless privacy requires otherwise.
   So the impact is chosen from the SHARED reaction (PRIV: `shared`, the one every seat that sees the token letters; before, WIRE1 chose it
   from what the table was told, publicSeat, so a hand-edited enemy blow was a scratch under the GM's heavy word): every seat that sees the
   token gets the same kind and strength. Blows and stress only (a heal, getting up, regaining nerve or stress spent by choice get
   none).
   FXI-TOKEN (ADVI 3: every blow of strength 0.35-0.85 played the same four drawings: a -1 scratch turned the whole view hard black and
   white like a -15, and the steps of a series 0.44 / 0.64 / 0.84 could not be told apart): a blow is one RUNG of a ladder whose rungs are
   different DRAWINGS with today's engine (impact/plan.mjs KINDS: a kind's tier changes at 0.35 / 0.85 / 1.35), not a strength that only
   moves inside one tier:
     0 scratch   hit   0.25   two small local drawings (star, splash) round the token
     1 blow      hit   0.6    the scene in hard black and white for a tick, star, halftone
     2 hard blow heavy 0.75   the same with cracks running out (shatter) instead of the halftone
     3 heavy     heavy 1.05   black frame with the struck figure's silhouette, the inverted slam, a hit-stop, cracks
     4 crushing  crit  1.3    speed lines, the silhouette frame, a longer slam, the chromatic split (the strongest a blow that does not
                              fell gets)
   then going down: ko 1.45..2 (the whole set, the longest hold). The rung of a blow is its size as the table knows it (a told number or a
   public track; a blow whose size nobody was told is a scratch: it cannot say more without telling hidden Health), plus ONE RUNG for each
   next blow of a series (STREAK), so -1, -1, -3 reads scratch, blow, crushing. A stunt's doubled damage [B2434] is one rung more in the
   critical's frames; energy crackles (shock) on the rung's strength. Stress takes the same ladder in its own colour (void); stressed out is
   a knock-out frame below the whole set. */
export const RUNGS = [
  { kind: "hit", magnitude: 0.25 },
  { kind: "hit", magnitude: 0.6 },
  { kind: "heavy", magnitude: 0.75 },
  { kind: "heavy", magnitude: 1.05 },
  { kind: "crit", magnitude: 1.3, tone: "fire" }
];
export const IMPACT = {
  hit: { ladder: true }, heavy: { ladder: true }, stress: { ladder: true, tone: "void" },
  out: { kind: "ko", base: 1.05, amt: 0.25, tone: "void" },
  down: { kind: "ko", base: 1.45, amt: 0.45 }
};
export const IMPACT_STEP = 1;        // rungs per next blow of one series
export const IMPACT_TOP = 1.34;      // the ceiling of every blow but going down (the engine's whole set starts at 1.35)
/* what the hit was made of, from the fight's public damage event (`dtype`): energy crackles (the shock kind), the rest only tints */
export const ENERGY = new Set(["electricity", "energy", "lightning", "laser", "plasma", "light", "sonic", "radiation", "force"]);
export const DTYPE_TONE = { fire: "fire", heat: "fire", electricity: "volt", lightning: "volt", cold: "volt", ice: "volt", energy: "volt", laser: "volt", plasma: "volt",
  acid: "toxic", poison: "toxic", disease: "toxic", toxic: "toxic", psychic: "void", mental: "void", darkness: "void" };
/** the seat every seat agrees on: it sees the token, it is no GM and it may read the numbers only by the public rule (a player's hero, a
    challenge) */
export const publicSeat = (who = {}) => ({ visible: true, staff: false, challenge: who.type === "challenge", reader: mayRead({ gm: false, type: who.type, playerHero: !!who.playerHero, observer: false }) });
/** the rung of a blow as the table knows it: pub = { kind, amt, known } (known = a number was told or the track is public) */
export function rungOf(pub) {
  const amt = Math.max(0, Math.min(1, Number(pub?.amt) || 0));
  if (pub?.known === false) return 0;
  if (pub?.kind === "heavy") return amt < 0.5 ? 2 : amt < 0.8 ? 3 : 4;
  if (pub?.kind === "stress") return amt < 0.2 ? 0 : amt < 0.3 ? 1 : amt < 0.5 ? 2 : amt < 0.8 ? 3 : 4;
  return amt < 0.2 ? 0 : 1;      // a hit: under three points
}
/** pub = { kind, amt, known } as the table knows it (audience(publicSeat) + amountOf); step = the blow's step in its series;
    o = { dtype, doubled } -> null | { kind, magnitude, tone?, rung? } */
export function impactOf(pub, step = 0, o = {}) {
  const row = IMPACT[pub?.kind];
  if (!row) return null;
  const amt = Math.max(0, Math.min(1, Number(pub.amt) || 0)), n = Math.max(0, Math.min(STREAK.max, Math.floor(Number(step) || 0)));
  if (row.ladder) {
    const blow = pub.kind === "hit" || pub.kind === "heavy";
    let r = Math.min(RUNGS.length - 1, rungOf(pub) + IMPACT_STEP * n);
    if (blow && o.doubled) r = Math.min(RUNGS.length - 1, r + 1);      // a stunt doubled the damage [B2434]: one rung more, the critical's frames
    const R = RUNGS[r];
    const kind = blow && o.doubled ? "crit" : blow && ENERGY.has(o.dtype) ? "shock" : R.kind;
    const out = { kind, magnitude: Math.min(IMPACT_TOP, R.magnitude), rung: r };
    const tone = row.tone ?? DTYPE_TONE[o.dtype] ?? (kind === "crit" && !o.doubled ? R.tone : null);
    if (tone) out.tone = tone;
    return out;
  }
  let m = row.base + row.amt * amt + 0.1 * n;
  m = pub.kind === "down" ? Math.max(1.45, Math.min(2, m)) : Math.min(IMPACT_TOP, m);
  const out = { kind: row.kind, magnitude: Math.round(m * 100) / 100 };
  const tone = row.tone ?? DTYPE_TONE[o.dtype];
  if (tone) out.tone = tone;
  return out;
}

/* ALIGN (engine 1.9.1 `series`): a blow's place in its series is handed to the engine (`series: n`: it adds I.series.step = 0.15 of strength
   per place, at most I.series.max = 4 places), so every caller builds a series alike. The ladder above still climbs one RUNG per place
   (other drawings: the engine's series alone would leave -1, -1, -1 three scratches, ADVI 3); the engine's boost then only grows the
   drawings INSIDE the rung's own strength: capped under the next strength bound (STEP_AT) and under IMPACT_TOP, so a series never reaches
   the full-field frames of a heavier rung or the whole set only going down gets. spec.magnitude is what the caller passes; the strength
   drawn is magnitude + the boost (effectiveMagnitude, = the engine's plan.magnitude). */
export const SERIES = { step: SERIES_STEP, max: SERIES_MAX };
export const effectiveMagnitude = (spec) => Math.round(((Number(spec?.magnitude) || 0) + SERIES.step * Math.max(0, Math.min(SERIES.max, Math.floor(Number(spec?.series) || 0)))) * 100) / 100;
export function withSeries(spec, step) {
  let n = Math.max(0, Math.min(SERIES.max, Math.floor(Number(step) || 0)));
  if (!spec || !n) return spec;
  const m = Number(spec.magnitude) || 0;
  const bound = STEP_AT.find((b) => b > m + 1e-9) ?? 2.01;
  const top = Math.min(bound - 0.01, spec.kind === "ko" ? 2 : IMPACT_TOP);
  const want = Math.max(m, Math.min(top, m + SERIES.step * n));      // the strength drawn: grown inside the rung, never under the rung
  n = Math.min(n, Math.floor(want / SERIES.step + 1e-9));            // a weak rung late in a series: fewer places, never a negative strength passed
  if (!n) return { ...spec, magnitude: want };
  return { ...spec, series: n, magnitude: Math.round((want - SERIES.step * n) * 1000) / 1000 };
}

/* ---------------------------------------------------------------- one instant for the word and its impact (FXI-TOKEN, ADVI 2 and 13)
   The impact frame came 0.17-0.2 s AFTER the word had reached full size (it was timed to the end of the word's whole entrance), and the GM's
   came 125-375 ms after the player's on the same blow (each seat timed it to its own word, and seats letter different words by privacy).
   Now the blow has ONE instant, the same on every seat: HIT_LEAD after the moment plays; the impact starts on it, and each seat's word is
   started earlier by its own entrance's CONTACT (the drawing where it strikes: the squash with its burst or the landing's dust, else its
   flash frame; contactMs), so every word strikes exactly on the impact whatever its entrance. HIT_LEAD covers the longest
   contact of the entrances these reactions use (a slam with its wind-up and flash: 5 drawings of the 24-tick clock), so no word has to
   start in the past. Numbers pop NUM_AFTER the instant (once the word has struck: review 13). */
export const TICK_MS = 1000 / 24;
export const HIT_LEAD = Math.round(5 * TICK_MS + 20);
export const NUM_AFTER = Math.round(4 * TICK_MS);
/** the contact of a word's entrance in ms from its start (plan = the engine's word plan, or its timeline); reduced = the still entrance: 0.
    The engine's own `plan.contactMs` wins when it has one (scratchpad letr REQUESTS FXIS-E1); else, as the roll splash reads it
    (splash/impact-plan.mjs), the first drawing with a burst or the landing's dust (the squash on contact), else the word's flash frame */
export function contactMs(plan, reduced = false) {
  /* ALIGN (engine 1.9.1, contract v11): the engine's plan.contactMs is right for every seat, ALSO under reduced motion (a reduced word fades
     in to end ON the full entrance's contact, FIN-ENGINE FXIS-E4), so it is read before the reduced shortcut; before, a reduced seat started
     its word on the blow's instant and the word landed one contact late. The 0 stays for a plan that names no contact (another engine). */
  if (Number.isFinite(plan?.contactMs) && plan.contactMs >= 0) return plan.contactMs;
  if (reduced) return 0;
  /* FIN-CALLERS: engine 1.9 (MOTION2) moves the word on pose keys and its pictures carry no burst or dust: read the contact as the roll
     splash does (one rule for both callers: the word's own accent tick, else its squash pose, else its biggest pose) */
  if (Array.isArray(plan?.motion?.entKeys) && plan.motion.entKeys.length) return wordContact(plan);
  const ent = (plan?.timeline ?? plan)?.ent;
  if (!Array.isArray(ent) || !ent.length) return 0;
  let a = 0, total = 0, flash = null;
  for (const p of ent) total += Number(p?.ticks) || 0;
  for (const p of ent) {
    if (p?.fx?.some?.((f) => f?.k === "burst" || f?.k === "dust")) return a * TICK_MS;
    if (p?.impact && flash === null) flash = a * TICK_MS;
    a += Number(p?.ticks) || 0;
  }
  if (flash !== null) return flash;
  return total * TICK_MS * 0.5;      // no marked contact: half-way through the entrance (the engine's own fallback for its push)
}

/** Is a roll card's roll one whose Resolve cost the character chose (a pushed roll, a power's stress cost)? The system lowers Resolve for
    exactly those (helpers/rolls.mjs applyStress, roll-dialog stressCost). Any other roll by the actor says nothing (review 16). */
export const choseStress = (roll) => { try { return !!roll && ((Number(roll.pushCount) || 0) > 0 || !!roll.pushed || (Number(roll.options?.stressCost) || 0) > 0); } catch { return false; } };

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
