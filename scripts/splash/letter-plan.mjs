/* LDIC: the moment after a roll, lettered. PURE (no DOM, no Foundry): turns a splash event (logic.mjs buildEvent) into the list of
   comic letterings that make the moment: the splash word, the push grunt, the wreck crash, the sixes, the odds sentence and its figure,
   the stress number. Each item says WHAT (text), WHEN (delay), HOW BIG (cap height as a share of the viewport height), HOW IT SOUNDS
   (mood + sound for the LETR engine, scripts/letters/), in which COLOURS, in which HAND (the numbers and the caption keep one legible
   hand) and how long it holds. composeMoment() then lays the items out as ONE block (FXLD): stage.mjs turns it into L.play calls.

   What says what (the user's ask: shape, size, colour and motion say how good or bad the roll was, what kind of action, how hard it hit):
   - the KIND of action: each word has its own mood (WHAM! a blunt impact, KRAK! a crack, ZIP! a whoosh, ROAR! a roar ...);
   - how GOOD: power P (rarity) drives size, loudness, pitch, grit and the colour climb (pale yellow -> orange -> rose -> violet, light
     fills as in the Invincible comic's own lettering: flat pale letters, a dark cut line, a block of depth);
   - how BAD: a miss falls (mood fail, falling pitch, cold grey-blue), a routine miss is a small grey mutter, a rare one is loud;
   - the numbers are lettered too, each in its own steady colour so the table learns them: sixes gold, odds white, stress red.

   FXLD (fixer of the ADVD findings 3, 4, 5, 7): the moment is composed, not scattered. The word is the centre; the sixes stamp sits
   tight against the word's right end on its baseline; the sentence and the odds are one caption row just under the word; the stress
   row under that; the push grunt above. Every element is measured (the engine's own plan of that very word) and the whole block is
   placed by the token (above its head, else under its feet, else beside it) or on the screen's focus, then kept inside the free part of
   the window (not under the chat, the bars, the hotbar), shrunk as one when it does not fit. Nothing in the block overlaps. */
import { hueOf, oddsText, oddsLabel, fmtOdds, LBL, say, sfxWord } from './logic.mjs';   // SPLASHPL: sfxWord = the action word as this seat shows it (moods stay keyed by the English word)
import { cleanHere, localCost, shiftInto } from '../same-picture.mjs';   // SAMEPIC: one picture for the table

/* word -> mood (the LETR engine's intents). A word not listed falls back to its action's default. */
export const WORD_MOOD = Object.freeze({
  'HAYMAKER!': 'impact', 'SMASH!': 'crash', 'WHAM!': 'impact', 'BAM!': 'impact', 'THWACK!': 'impact', 'CRUSH!': 'crash',
  'RUSH!': 'whoosh', 'CHARGE!': 'roar', 'WHOOSH!': 'whoosh', 'BARREL!': 'crash', 'STAMPEDE!': 'roar',
  'GRAB!': 'impact', 'LOCK!': 'crack', 'SQUEEZE!': 'roar', 'VISE!': 'crack', 'HOLD!': 'impact',
  'GUARD!': 'impact', 'BRACE!': 'impact', 'SHIELD!': 'impact',
  'ZIP!': 'whoosh', 'DASH!': 'whoosh', 'FLIP!': 'whoosh', 'SWISH!': 'whoosh', 'DUCK!': 'whoosh',
  'BLAM!': 'crack', 'ZAP!': 'zap', 'PEW!': 'zap', 'BANG!': 'crack', 'KRAK!': 'crack',
  'CLICK!': 'tick', 'EUREKA!': 'powerup', 'CALCULATE!': 'tick',
  'TINGLE!': 'zap', 'SENSE!': 'zap', 'HUNCH!': 'tick',
  'HUSH!': 'tick', 'COMMAND!': 'roar', 'ROAR!': 'roar',
  'POW!': 'impact', 'BOOM!': 'boom', 'KAPOW!': 'boom', 'ZOOM!': 'whoosh',
  /* push grunts */
  'STRAIN!': 'roar', 'PUSH!': 'powerup', 'GRRR!': 'roar', 'ALL IN!': 'powerup', 'DIG DEEP!': 'powerup', 'AGAIN!': 'powerup', 'HNNNG!': 'roar', 'ONE MORE!': 'powerup',
  /* wreck */
  'WRECK!': 'crash', 'RUIN!': 'crash', 'KRAKOOM!': 'boom', 'DEMOLISH!': 'crash',
  /* a pushed roll that still failed: the sound of it breaking */
  'CRACK!': 'crack', 'SNAP!': 'crack', 'OUCH!': 'pain'
});
const ACTION_MOOD = { slugfest: 'impact', charge: 'crash', grapple: 'impact', block: 'impact', dodge: 'whoosh', shooting: 'crack', reason: 'tick', intuition: 'zap', presence: 'roar', generic: 'boom' };
/* the sharp/round character of each mood, used to keep the word's own sound when a miss forces the "fail" mood */
const MOOD_SHARP = { impact: 0.7, crack: 0.95, crash: 0.8, boom: 0.25, roar: 0.45, fire: 0.5, whoosh: 0.35, zap: 0.9, tick: 0.6, pain: 0.8, powerup: 0.55, heal: 0.2, splash: 0.15, fail: 0.4 };
const LONG = new Set(['whoosh', 'roar', 'powerup', 'boom']);

export const moodOf = (word, action) => WORD_MOOD[word] ?? ACTION_MOOD[action] ?? 'impact';

/* ---- colours (fill light -> dark, the engine's `colors`) */
/* the engine reads colours as hex (#rrggbb), so the power scale is converted here */
const hsl = (h, s, l) => {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return '#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('');
};
/* FXLD: the power climb (yellow -> orange -> red -> magenta -> violet) in the comic's manner: pale, nearly flat fills (KRAK!! pale
   orange, SKREE- pale green, CHA-THOOM white), so the dark cut line and the depth block carry the shape and the word reads on any map
   and on the critical's own violet rays (ADVD 5: the old deep purple disappeared on its purple backdrop) */
export function powerColors(P, shift = 0) {
  const h = hueOf(P) + shift;
  return [hsl(h + 12, 100, 95), hsl(h, 100, 82), hsl(h - 8, 90, 62)];
}
/* the caption sentence: the same hue, lighter still (it is read, not heard) */
export function sayColors(P, shift = 0) {
  const h = hueOf(P) + shift;
  return [hsl(h, 100, 97), hsl(h, 100, 90), hsl(h, 85, 74)];
}
export const SIX_COLORS = Object.freeze(['#fff7c8', '#ffd23f', '#e06a00']);      // sixes: always gold (the die's best face)
export const ODDS_COLORS = Object.freeze(['#ffffff', '#e4e9f6', '#8d98b8']);     // the odds figure: a plain white stamp
export const STRESS_COLORS = Object.freeze(['#ffd3d9', '#ff3b52', '#7c0616']);   // stress: blood red
export const FAIL_COLORS = Object.freeze(['#eef0f7', '#a3abc4', '#4a5272']);     // a miss: cold, drained
export const SOFT_COLORS = Object.freeze(['#f0eff6', '#cfcddc', '#8d8ba0']);     // a routine miss: a light grey mutter (readable on a dark map)
export const MISS_SAY_COLORS = Object.freeze(['#f2f5ff', '#c9d4f5', '#7d8fc9']); // UNLUCKY / WHAT A FLOP: pale cold blue

/* FXLD: the numbers and the caption sentence are information, read at a glance: one legible hand for all of them (a partial hand,
   design.mjs merges it over its own choice; the same thing the token reactions pin, REQUESTS ltok 10): the tall narrow face of the
   Invincible lettering (Anton), plain letters, flat, no texture, a light cut line around the ink. The sound word keeps the hand its
   mood picks (variety). */
export const INFO_HAND = Object.freeze({ font: 'anton', treat: 'plain', env: 'flat', tex: 'none', outline: 'sticker', fill: 'flat', shadow: null, shear: 0.05, track: 0.03, hatch: false, bevel: false });
/* the caption row (the sentence and the odds) is the smallest lettering: the light cut line and a puffed ink line are stroked over the
   edges, inwards too, and at caption size they filled Anton's narrow counters (live, 1366: NOT BAD! read HOT RAD!, IN was two
   blocks). So the caption has a thin ink line only, no puff, no extrusion, no gloss: the counters stay open. */
export const CAPTION_HAND = Object.freeze({ ...INFO_HAND, outline: 'ink', out2W: 0, inkW: 0.04, inflate: 0, depth: 0, gloss: false });
const CAPTION_ROLES = new Set(['say', 'odds']);
const INFO_ROLES = new Set(['six', 'say', 'odds', 'stress']);

/* cap height of each lettering, as a share of the viewport height (1366x768 and 1920x1080 alike), and its pixel floor */
export const FLOOR = { word: 30, pre: 22, wreck: 22, six: 21, say: 21, odds: 19, stress: 19 };   // FXI-SPLASH: say 19 -> 21, odds 17 -> 19 (ADVI 11)

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = v => Math.round(v * 100) / 100;
const r3 = v => Math.round(v * 1000) / 1000;

/* ev: the splash event; o: { token (bool), full (bool), holdK, npc (bool), dF (fail strength 0..1), reduced (bool) }.
   -> { items: [{ role, text, delay, cap, wMax, size, mood, sound, colors, hand, hold, rotation, from, in, holdKind, out }], end }
   cap = cap height / viewport height; wMax = the widest it may be, as a share of the free width; size = cap at 768 px (reference) */
export function planMoment(ev, o = {}) {
  o = { npc: !!ev.npc, dF: failStrength(ev), ...o };
  const holdK = o.holdK || 1, full = !!o.full;
  const items = [];
  const add = it => { items.push(it); return it; };
  let t = 0;

  /* a pushed roll: the grunt first, rising (the effort), then the result, after the grunt's exit (ADVD 7: they overlapped ~0.5 s) */
  if (ev.pushed && ev.prefix) {
    const m = moodOf(ev.prefix);
    /* FXLD2 (ADVD2 11): the grunt is a beat of its own, not a footnote: about 1.4x the old cap (live 1920 HNNNG! was ~40 px) and held
       long enough to read before the result comes */
    const pre = add({ role: 'pre', text: sfxWord(ev.prefix), delay: 0, cap: PRE_CAP, wMax: 0.5, mood: m,
      sound: { loud: 0.6, pitch: 0.6, long: 0.6 }, colors: ['#fff1dc', '#ffc27a', '#e07a2a'], hold: Math.round(PRE_HOLD * holdK), rotation: -4 });
    t = pre.hold + EXIT_MAX + 60;
  }

  if (ev.fail) {
    const soft = !!ev.softFail, dF = clamp(o.dF ?? 0.3, 0, 1);
    const m0 = moodOf(ev.word);
    /* a routine miss mutters (tick, small, grey); a real miss falls (fail); a pushed roll that broke keeps its sound (CRACK! cracks) */
    const mood = soft ? 'tick' : (ev.pushed && WORD_MOOD[ev.word] ? m0 : 'fail');
    const loud = soft ? 0.12 : r1(0.3 + 0.45 * dF + (ev.pushed ? 0.1 : 0));
    /* FXLD2 (ADVD2 10): a routine miss is quiet but readable: the soft cap and hold were too small (NEXT! tiny on the head ring, ~1.5 s) */
    const w = add({ role: 'word', text: sfxWord(ev.word), en: ev.word, delay: t, cap: r3(soft ? SOFT_CAP : 0.062 + 0.045 * dF + (ev.pushed ? 0.008 : 0)), wMax: soft ? 0.4 : 0.55,
      mood, sound: { loud, pitch: soft ? -0.2 : r1(-0.45 - 0.45 * dF), sharp: MOOD_SHARP[m0] ?? 0.4, rough: soft ? 0 : r1(0.2 + 0.4 * dF) },
      colors: soft ? SOFT_COLORS : FAIL_COLORS, hold: Math.round((soft ? SOFT_HOLD : 2200 + 600 * dF) * holdK), rotation: soft ? 0 : 5 });
    /* a rare miss also says how rare: the sentence and the figure */
    if (!soft && dF > 0.3 && !ev.pushed && ev.failP) {
      add({ role: 'say', text: say(dF > 0.6 ? 'WHAT A FLOP!' : 'UNLUCKY!'), delay: t + 330, cap: 0.04, wMax: 0.6,
        mood: 'tick', sound: { loud: 0.35, pitch: -0.3 }, colors: MISS_SAY_COLORS, hold: Math.max(400, w.hold - 330), rotation: -3 });
      add({ role: 'odds', text: LBL.miss(fmtOdds(Math.round(1 / ev.failP))), delay: t + 430, cap: 0.033, wMax: 0.6,
        mood: 'tick', sound: { loud: 0.3, pitch: 0 }, colors: ODDS_COLORS, hold: Math.max(400, w.hold - 430), rotation: -2 });
    }
  } else {
    const P = ev.power ?? 0, tier = ev.tier ?? 1, m = moodOf(ev.word, ev.action);
    const loud = r1(0.3 + 0.7 * P);
    const sound = { loud, pitch: r1(0.15 + 0.6 * P), rough: r1(P > 0.55 ? 0.25 + 0.5 * P : 0.1) };
    if (LONG.has(m)) sound.long = r1(0.45 + 0.35 * P);
    const hold = Math.round((2400 + 1600 * P) * holdK);
    const wreck = !!ev.wreckWord;
    /* ADVD 5: the critical (full screen) is the biggest thing the table sees: about 60 % of the free width, at least as present as the
       old jagged panel; a token-sized success grows with its rarity */
    const cap = full ? 0.2 + 0.06 * P : 0.064 + 0.07 * P + 0.002 * Math.min(tier, 10);
    add({ role: 'word', text: sfxWord(ev.word), en: ev.word, delay: t, cap: r3(cap), wMax: full ? (wreck ? 0.46 : 0.64) : (wreck ? 0.42 : 0.58), wMin: full ? 0.5 : 0, mood: m, sound,
      colors: P >= 0.4 || o.npc ? powerColors(P, o.npc ? 150 : 0) : null,     // a weak success keeps its mood's own palette (variety); strong ones climb the power scale
      hold, rotation: 0, from: o.token ? 'token' : 90 });
    if (wreck) add({ role: 'wreck', text: sfxWord(ev.wreckWord), delay: t + 520, cap: r3(cap * 0.62), wMax: 0.36,
      mood: moodOf(ev.wreckWord), sound: { loud: r1(Math.min(1, loud + 0.1)), rough: 0.7 }, colors: powerColors(Math.min(1, P + 0.1), -22 + (o.npc ? 150 : 0)), hold: hold - 520, rotation: 8 });
    if (ev.sixes > 0) {
      add({ role: 'six', text: LBL.six(ev.sixes), delay: t + 230, cap: r3((full ? 0.058 : 0.038) + 0.003 * Math.min(4, ev.sixes)), wMax: 0.3,
        mood: 'impact', sound: { loud: r1(0.4 + 0.12 * Math.min(4, ev.sixes)), sharp: 0.75, pitch: 0.3 },
        colors: SIX_COLORS, hold: hold - 230 + 90, rotation: -7 });
    }
    const sentence = ev.tag ? say(ev.tag) : oddsText(P);
    if (sentence && ev.p != null) {
      add({ role: 'say', text: sentence, delay: t + 360, cap: r3((full ? 0.053 : 0.043) + 0.006 * P), wMax: 0.7,   // FXI-SPLASH (ADVI 11): the caption was too small to read
        mood: 'tick', sound: { loud: 0.35, pitch: 0.4, sharp: 0.5 }, colors: sayColors(P, o.npc ? 150 : 0), hold: hold - 360 + 120, rotation: -3 });
      add({ role: 'odds', text: oddsLabel(ev.p) + (ev.pushed ? ' - ' + LBL.push : ''), delay: t + 460, cap: full ? 0.045 : 0.037, wMax: 0.5,
        mood: 'tick', sound: { loud: 0.3, pitch: 0, sharp: 0.6 }, colors: ODDS_COLORS, hold: hold - 460 + 120, rotation: -2 });
    }
  }
  for (const it of items) Object.assign(it, motionOf(it, ev, o));
  for (const it of items) {
    it.hold = Math.max(300, it.hold);
    it.rot0 = it.rotation || 0;   // SAMEPIC: the tilt every seat lays the block out with (a reduced seat draws it upright in that place)
    if (o.reduced) it.rotation = 0;
    if (INFO_ROLES.has(it.role)) it.hand = CAPTION_ROLES.has(it.role) ? CAPTION_HAND : INFO_HAND;
    it.magnitude = magnitudeOf(it, ev);
    it.size = Math.round(Math.max(FLOOR[it.role] ?? 16, it.cap * REF_VH));
  }
  const end = Math.max(0, ...items.map(it => it.delay + it.hold));
  return { items, end };
}
/* the longest exit the engine plays (contract: about 0.3-0.5 s) */
export const EXIT_MAX = 500;
/* FXLD2: the push grunt and the routine miss (ADVD2 10, 11) */
export const MAP_CRIT_CAP = 0.14;   // a critical on a map layer: letter height as a share of the board's 'screen' (5 grid squares)
export const PRE_CAP = 0.074, PRE_HOLD = 620, SOFT_CAP = 0.064, SOFT_HOLD = 2100;
/* FXLD2 (ADVD2 2): on the map the words are part of the board: an exit that travels (letters falling, flying apart, zipping away)
   crosses the neighbours' tokens (live 1920: the falling letters dropped across Omni-Man and Atom Eve). On a map layer each exit stays
   where the word stood. */
export const MAP_EXITS = Object.freeze(['pop', 'shrink', 'burst']);
export function mapExit(it) {
  if (MAP_EXITS.includes(it.out)) return it.out;
  if (it.out === 'shatter' || it.out === 'zipout') return 'burst';
  return 'shrink';
}

/* The motion technique of each lettering (the engine's entrance / hold / exit by name): the word's mood already picks a fitting
   motion (a crack splinters in, a whoosh zips); the RESULT adds on top: a top roll slams in, shakes and bursts, a miss drops, sags
   and droops away, a routine miss pops and dissolves; the numbers are stamps (slam / pop in, steady boil, pop / shrink out), the
   stress throbs and falls. Pictures change on the engine's stepped clock (on twos and threes), never smoothly. */
export function motionOf(it, ev, o = {}) {
  const P = ev.power ?? 0, dF = o.dF ?? 0;
  switch (it.role) {
    case 'word':
      if (ev.fail) {
        if (ev.softFail) return { in: 'pop', holdKind: 'boil', out: 'dissolve' };
        if (ev.pushed && (it.mood === 'crack' || it.mood === 'pain')) return { holdKind: 'rattle' };
        return { in: 'drop', holdKind: 'wobble', out: dF > 0.6 ? 'fall' : 'droop' };
      }
      if (it.mood === 'whoosh') return P >= 0.75 ? { in: 'zip', holdKind: 'shake', out: 'zipout' } : {};
      if (P >= 0.75) return { in: 'slam', holdKind: 'shake', out: it.mood === 'crack' || it.mood === 'zap' ? 'shatter' : 'burst' };
      if (P < 0.2) return { holdKind: 'boil' };
      return {};
    case 'pre': return { holdKind: 'rattle' };
    case 'wreck': return { in: 'drop', holdKind: 'rattle', out: 'fall' };
    case 'six': return { in: 'slam', holdKind: ev.sixes >= 3 ? 'throb' : 'boil', out: 'pop' };
    case 'say': return ev.fail ? { in: 'drop', holdKind: 'boil', out: 'droop' } : { in: 'pop', holdKind: 'boil', out: 'shrink' };
    case 'odds': return { in: 'pop', holdKind: 'boil', out: 'shrink' };
    case 'stress': return { in: 'slam', holdKind: 'throb', out: 'fall' };
    default: return {};
  }
}

/* the event's MAGNITUDE (how big the moment is), handed to the engine for its own choices (techniques, flashes) */
export const REF_VH = 768;
export function magnitudeOf(it, ev) {
  const P = ev.power ?? 0, dF = failStrength(ev);
  switch (it.role) {
    case 'word': return ev.fail ? (ev.softFail ? 0.05 : r1(0.15 + 0.35 * dF + (ev.pushed ? 0.1 : 0))) : r1(0.15 + 0.85 * P + Math.max(0, P - 0.8) * 1.5);
    case 'wreck': return r1(Math.min(1.4, 0.25 + 0.85 * P + Math.max(0, P - 0.8) * 1.5));
    case 'six': return r1(0.35 + 0.1 * Math.min(4, ev.sixes ?? 1));
    case 'stress': return r1(0.35 + 0.1 * Math.min(4, ev.stress ?? 1));
    case 'pre': return 0.5;
    case 'say': return 0.4;
    case 'odds': return 0.3;
    default: return 0.5;
  }
}

/* how hard a miss lands, 0..1, from its rarity: routine (more likely than not) is quiet, a rare miss of a strong hero is loud */
export function failStrength(ev) {
  if (!ev?.fail) return 0;
  return ev.failP == null ? 0.3 : clamp(Math.log(0.5 / ev.failP) / Math.log(10), 0, 1);
}

/* the stress number joins the moment: "STRESS +2" lettered in pain red beside the Resolve gauge (the gauge itself stays a gauge) */
export function planStress(stress, o = {}) {
  const it = { role: 'stress', text: LBL.stress(stress), delay: 0, cap: r3(0.04 + 0.003 * Math.min(4, stress)), wMax: 0.3,
    mood: 'pain', sound: { loud: r1(Math.min(0.9, 0.35 + 0.12 * stress)), pitch: -0.3 }, colors: STRESS_COLORS, hand: INFO_HAND,
    hold: Math.round(2600 * (o.holdK || 1)), rotation: o.reduced ? 0 : -5, in: 'slam', holdKind: 'throb', out: 'fall' };
  it.rot0 = -5;   // SAMEPIC: laid out with the tilt every seat has
  it.magnitude = magnitudeOf(it, { stress });
  it.size = Math.round(Math.max(FLOOR.stress, it.cap * REF_VH));
  return it;
}

/* ================================================================== FXLD: composition
   measure(item, S) -> { w, h }: the box of the item's hold picture in px when drawn at S px per unit (stage.mjs asks the engine for
   the plan of that very word; estimateBox without it). frame: { vh, scale (user x engine), safe: { l, t, r, b }, focus: { x, y },
   token: { x, y, l, t, r, b } | null, gauge: { w, h } | null }.
   -> { items: [{ ...item, x, y, S, w, h }], rect: { l, t, r, b }, gauge: { x, y } | null, f, side }
   All in client px; x, y = the centre of each box (the engine's anchor "center"). */
export function estimateBox(it, S) {
  const lines = String(it.text ?? '').split('\n');
  const n = Math.max(...lines.map(l => l.length), 1);
  return { w: S * (0.56 * n + 0.3), h: S * (1.18 * lines.length + 0.12) };
}
/* room each box keeps for its own motion (slam overshoot, shake, warp) on top of the hold picture: share of S per side */
export const PAD = 0.14;
export function composeMoment(items, frame, measure = estimateBox) {
  const safe = frame.safe, vh = frame.vh || 768, sc = frame.scale || 1;
  const safeW = Math.max(120, Math.min(safe.r - safe.l, frame.freeW ?? Infinity)), safeH = Math.max(120, Math.min(safe.b - safe.t, frame.freeH ?? Infinity));
  let f = 1, out = null, stack = false, clean = null;
  const T = frame.token;
  for (let pass = 0; pass < 14; pass++) {
    out = layoutAt(items, frame, measure, f, safeW, vh, sc, stack);
    const bw = out.rect.r - out.rect.l, bh = out.rect.b - out.rect.t;
    let k = Math.min(1, (safeW - 4) / bw, (safeH - 4) / bh);
    /* by a token: when no side of it has room for the block, the block shrinks (to 0.6 at most) to the side with the most room
       rather than landing on the token (live 1920: the caption sat on Kid Omni-Man's art). A critical (wMin) covers the screen anyway. */
    if (k >= 0.999 && T && !items.some(it => it.wMin)) {
      const g = 6, fitK = (w, h) => Math.min((safeW - 4) / bw, (safeH - 4) / bh, w / bw, h / bh);
      const best = Math.max(fitK(safeW, T.t - g - safe.t), fitK(safeW, safe.b - T.b - g), fitK(safe.r - T.r - g, safeH), fitK(T.l - g - safe.l, safeH));
      if (best < 0.999 && best >= 0.6 * Math.min(1, k) && f > 0.6) k = Math.max(best, 0.6 / f);
    }
    if (k >= 0.999) {
      /* FXLD2: nothing clean on any side (neighbours, pins, dice around): first the narrower block (the sixes under the word instead
         of beside it), then shrink a little (to 0.6 of the size at most; to 0.4 while the block would still cover the hero or the
         rolling token, which must never happen) and try again */
      place(out, frame, f <= 0.6);
      if (!(frame.avoid?.length || frame.token)) return out;
      /* a clean place that is detached from the token (live, The Warehouse: every side of Kid Omni-Man touched a neighbour or a pin,
         and the clean place lay beyond Omni-Man, out of the view of a seat looking at the roller) is kept only as a fallback: a
         smaller block that fits right by the token wins */
      if (!out.hit) {
        const off = T ? detached(out.rect, T, frame) : 0;
        if (off <= 0) return out;
        if (!clean || off < clean.off - 1) { clean = out; clean.off = off; }   // the nearest clean place so far
      }
      if (!stack && out.items.some(it => it.role === 'six' || it.role === 'wreck')) { stack = true; continue; }
      out.heavy = out.heavy ?? 0;
      /* the floor: 0.6; 0.4 while the hero would be covered; 0.45 while the only clean places are away from the hero */
      if (f <= (out.heavy > 0 ? 0.4 : clean ? 0.45 : 0.6)) return clean ?? out;
      f *= 0.88;
      continue;
    }
    f *= k * 0.97;
  }
  if (clean) return clean;
  place(out, frame);
  return out;
}
/* how far the block stands off the token beyond a few gaps (0: it touches the token's side, as a block placed by it does) */
export function detached(rect, T, frame) {
  const dx = Math.max(0, T.l - rect.r, rect.l - T.r), dy = Math.max(0, T.t - rect.b, rect.t - T.b);
  return Math.max(0, Math.hypot(dx, dy) - 3 * (frame.gap ?? 6));
}
function layoutAt(items, frame, measure, f, safeW, vh, sc, stack = false) {
  const sized = items.map(it => {
    let S = Math.max(FLOOR[it.role] ?? 16, (it.cap ?? 0.04) * vh) * sc * f;
    let b = measure(it, S);
    const wMax = (it.wMax ?? 0.6) * safeW;
    if (b.w > wMax) { S *= wMax / b.w; b = measure(it, S); }
    if (it.wMin && b.w < it.wMin * safeW * f) {   // the critical word fills its share of the screen even when it is short
      const S2 = Math.min(S * (it.wMin * safeW * f) / b.w, 0.3 * vh * sc * f);
      if (S2 > S) { S = S2; b = measure(it, S); }
    }
    return { ...it, S: Math.round(S * 10) / 10, w: b.w, h: b.h, grow: Math.max(1, Number(b.grow) || 1) };
  });
  const get = r => sized.find(x => x.role === r);
  const word = get('word'), pre = get('pre'), six = get('six'), wreck = get('wreck'), sayI = get('say'), odds = get('odds'), stress = get('stress');
  const unit = word ? word.S : (stress ? stress.S : 30);
  const g = Math.max(5, 0.16 * unit);                 // the gap between the parts of the block
  const pad = it => PAD * it.S;
  /* rows, top to bottom; x relative to the word's centre (0), y = the top of each row */
  let y = 0;
  const put = (it, x, top) => { it.x = x; it.y = top + it.h / 2; };
  if (pre) { put(pre, 0, y); y += pre.h + pad(pre) * 2 + g; }
  /* the narrow block: the word alone on its row, the caption right under it, the wreck and the sixes on a row under that */
  const stackRow = () => {
    const row = [wreck, six].filter(Boolean);
    if (!row.length) return;
    const w = row.reduce((s, it) => s + it.w + 2 * pad(it), 0) + g * (row.length - 1), h = Math.max(...row.map(it => it.h));
    let x = -w / 2;
    for (const it of row) { it.x = x + pad(it) + it.w / 2; it.y = y + h - it.h / 2; x += it.w + 2 * pad(it) + g; }
    y += h + g;
  };
  if (word && stack) {
    put(word, 0, y);
    y += word.h + g + pad(word);
    /* FXI-SPLASH (ADVI 11: "4 SZOSTKI" stood under the caption): the block reads top-down in the order it lands: the word, the sixes
       (+230 ms), then the sentence and the odds (+360 / +460 ms) */
    stackRow();
  } else if (word) {
    put(word, 0, y);
    let right = word.w / 2;
    if (wreck) { put(wreck, right + g + wreck.w / 2 + pad(wreck), y); right = wreck.x + wreck.w / 2; }
    if (six) { const x = right + g * 0.6 + pad(six) + six.w / 2; six.x = x; six.y = y + word.h - six.h / 2; }   // the stamp on the word's baseline, tight to its end
    /* the word row centred as a whole: shift every part left by half of what hangs to the right */
    const rowR = Math.max(word.w / 2, ...[wreck, six].filter(Boolean).map(it => it.x + it.w / 2)), shift = (rowR - word.w / 2) / 2;
    for (const it of [word, wreck, six].filter(Boolean)) it.x -= shift;
    y += word.h + g + pad(word);
  } else for (const it of [wreck, six].filter(Boolean)) { put(it, 0, y); y += it.h + g; }   // a lone part still gets its row
  /* the caption: sentence and figure on one row when they fit the word row's width (or 90 % of the free width), else stacked */
  const cap = [sayI, odds].filter(Boolean);
  if (cap.length) {
    const wordL = word ? word.x - word.w / 2 : -100, rowW = word ? Math.max(word.w, ...[wreck, six].filter(it => it && it.x != null).map(it => it.x + it.w / 2 - wordL)) : 0;
    const inline = cap.length === 2 && sayI.w + g + odds.w <= (stack ? rowW : Math.max(rowW, 0.9 * safeW));   // the narrow block keeps the caption to the word's width
    if (inline) {
      const w = sayI.w + g + odds.w, h = Math.max(sayI.h, odds.h);
      /* under the word, indented a little from its left edge (a caption, not a centred label); wider than the word row: centred */
      const rowL = wordL, rowR = wordL + rowW;
      const L0 = !word || w >= rowW ? (word ? (rowL + rowR) / 2 : 0) - w / 2 : Math.min(rowL + 0.25 * unit, rowR - w);
      sayI.x = L0 + sayI.w / 2; sayI.y = y + h - sayI.h / 2;
      odds.x = L0 + sayI.w + g + odds.w / 2; odds.y = y + h - odds.h / 2;
      y += h + g;
    } else for (const it of cap) { put(it, 0, y); y += it.h + g * 0.6; }
  }
  let gauge = null;
  if (stress) {
    const gw = (frame.gauge?.w ?? 0) * f, gh = (frame.gauge?.h ?? 0) * f;   // the gauge shrinks with the block (live: a full-size gauge beside words shrunk to 0.6)
    const w = stress.w + (gw ? g + gw : 0), h = Math.max(stress.h, gh);
    stress.x = -w / 2 + stress.w / 2; stress.y = y + h / 2;
    if (gw) gauge = { x: -w / 2 + stress.w + g, y: y + h / 2 - gh / 2, w: gw, h: gh, k: f };   // top-left of the DOM gauge; k: its scale
    y += h;
  }
  const rect = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
  for (const it of sized) {
    if (it.x == null) continue;
    /* FXI-SPLASH (ADVI 11): the block's outline holds each part's biggest entrance drawing too (the slam's smear grows the word 1.6-1.8x
       around its centre for a tick or two: live it crossed the left bar and left the screen); the parts' spacing stays the hold's (the
       captions come after the entrance is over) */
    const p = pad(it), px = Math.max(p, (it.grow - 1) / 2 * it.w + p * 0.5), py = Math.max(p, (it.grow - 1) / 2 * it.h + p * 0.5);
    rect.l = Math.min(rect.l, it.x - it.w / 2 - px); rect.r = Math.max(rect.r, it.x + it.w / 2 + px);
    rect.t = Math.min(rect.t, it.y - it.h / 2 - py); rect.b = Math.max(rect.b, it.y + it.h / 2 + py);
  }
  if (gauge) { rect.l = Math.min(rect.l, gauge.x); rect.r = Math.max(rect.r, gauge.x + gauge.w); rect.b = Math.max(rect.b, gauge.y + gauge.h); }
  return { items: sized.filter(it => it.x != null), rect, gauge, f };
}
/* where the block goes: by the token (above its head, else under its feet, else to its free side) or on the focus point; inside the safe
   rectangle (the window without the chat, the bars and the hotbar; on a map layer: the scene). FXLD2 (ADVD2 3, 6, 7): the block also
   keeps off everything in frame.avoid (the neighbours' tokens, map note pins, resting dice, panels; the hero of a critical): each side
   of the token is tried at several places along it, and the first place (in side order, nearest first) that touches nothing wins; when
   none is clean, the place with the least overlap (out.hit > 0 tells composeMoment to shrink and try again). */
const area = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
/* an avoided box may weigh more than its area (w: the hero of a critical is never covered while a pin or a panel can still give way) */
export function blockHits(rect, avoid = []) { let s = 0; for (const a of avoid) s += area(rect, a) * (a.w ?? 1); return s; }
/* slides along a side, in shares of the block's own size (never far from the token: live, a block that slid half a scene away
   no longer belonged to its roll) */
const SLIDE = [0, -0.3, 0.3, -0.6, 0.6, -0.9, 0.9, -1.2, 1.2];
const SIDE_COST = { above: 0, below: 0.15, right: 0.3, left: 0.35 };
function place(out, frame, far = false) {
  const safe = frame.safe, r = out.rect, bw = r.r - r.l, bh = r.b - r.t;
  const T = frame.token, avoid = frame.avoid ?? [];
  const at = (l, t) => ({ l, t, r: l + bw, b: t + bh });
  const inSafe = (l, t) => [clamp(l, safe.l, Math.max(safe.l, safe.r - bw)), clamp(t, safe.t, Math.max(safe.t, safe.b - bh))];
  let best = null, side = 'focus';
  /* the score: anything touched first (the token four times as bad), then the distance from the token (or the focus) in block sizes
     plus a small preference of the sides (above, below, right, left) */
  const ref = T ? { x: T.x, y: T.y } : frame.focus, unit = Math.max(1, Math.hypot(bw, bh));
  const consider = (s, l, t, pref) => {
    [l, t] = inSafe(l, t);
    const q = at(l, t), onT = T ? area(q, { l: T.l - (frame.gap ?? 6) + 1, t: T.t - (frame.gap ?? 6) + 1, r: T.r + (frame.gap ?? 6) - 1, b: T.b + (frame.gap ?? 6) - 1 }) : 0;
    const hit = blockHits(q, avoid) + onT * 4, heavy = onT + blockHits(q, avoid.filter(a => (a.w ?? 1) >= 10));
    const d = Math.hypot(l + bw / 2 - ref.x, t + bh / 2 - ref.y) / unit;
    const score = (hit > 0.5 ? 1e6 + hit : 0) + d + pref;
    if (!best || score < best.score) best = { s, l, t, hit, heavy, score };
  };
  if (T) {
    const gap = frame.gap ?? 6;
    const cand = [
      ['above', T.x - bw / 2, T.t - gap - bh, 'x'],
      ['below', T.x - bw / 2, T.b + gap, 'x'],
      ['right', T.r + gap, T.y - bh / 2, 'y'],
      ['left', T.l - gap - bw, T.y - bh / 2, 'y']
    ];
    for (const [s, l, t, ax] of cand) {
      const span = ax === 'x' ? bw : bh;
      /* only along that side: a place that the safe clamp pushes back onto the token scores the token hit */
      for (const k of SLIDE) consider(s, ax === 'x' ? l + k * span : l, ax === 'y' ? t + k * span : t, SIDE_COST[s]);
    }
    /* a crowded spot (neighbours all round, dice beside, a pin): once the block has shrunk as far as it may, any clean place of the
       free area beats covering something; the nearest such place wins */
    if (far && best.hit > 0.5) {
      const W = safe.r - safe.l, H = safe.b - safe.t;
      for (let gy = 0; gy <= 8; gy++) for (let gx = 0; gx <= 8; gx++) consider('focus', safe.l + gx / 8 * (W - bw), safe.t + gy / 8 * (H - bh), 1);
    }
  } else {
    const W = safe.r - safe.l, H = safe.b - safe.t;
    for (const dy of [0, -0.12, 0.12, -0.24, 0.24, -0.36, 0.36]) for (const dx of [0, -0.15, 0.15, -0.3, 0.3, -0.45, 0.45]) consider('focus', frame.focus.x - bw / 2 + dx * W, frame.focus.y - bh / 2 + dy * H, 0);
    if (far && best.hit > 0.5) for (let gy = 0; gy <= 8; gy++) for (let gx = 0; gx <= 8; gx++) consider('focus', safe.l + gx / 8 * (W - bw), safe.t + gy / 8 * (H - bh), 0.5);
  }
  side = best.s;
  const dx = best.l - r.l, dy = best.t - r.t;
  for (const it of out.items) { it.x = Math.round(it.x + dx); it.y = Math.round(it.y + dy); }
  if (out.gauge) { out.gauge.x = Math.round(out.gauge.x + dx); out.gauge.y = Math.round(out.gauge.y + dy); }
  out.rect = { l: r.l + dx, t: r.t + dy, r: r.r + dx, b: r.b + dy };
  out.side = side;
  out.hit = best.hit;
  out.heavy = best.heavy;
}
/* SAMEPIC (owner: the GM and the players see the SAME moment): a block composed from the shared frame (same-picture.mjs) is checked against
   THIS seat's own limits (local = { safe, avoid }: its real view edge, the sidebar it really has open, its own panels on a layer under them).
   Clean -> unchanged (every seat with this view shows it alike). Otherwise the smallest shift that clears it, when that shift lands on no
   shared thing it did not already touch (the token, a neighbour, a pin); else a new layout inside this seat's limits (recompose()).
   Between the two: the same block shrunk in place (SHRINK_LOCAL steps) and shifted the least way that clears it.
   -> { out, moved: 'none' | 'shift' | 'shrink' | 'layout', k?, d?: { dx, dy } } */
export function localFix(out, frame, local, std, recompose) {
  if (!out?.rect || !Number.isFinite(out.rect.l) || cleanHere(out.rect, std, local)) return { out, moved: 'none' };
  const r = out.rect, T = frame.token, gp = frame.gap ?? 6;
  const sharedHit = q => blockHits(q, frame.avoid ?? []) + (T ? area(q, { l: T.l - gp + 1, t: T.t - gp + 1, r: T.r + gp - 1, b: T.b + gp - 1 }) * 4 : 0);
  const base = sharedHit(r);
  /* shifts: into the view, then off each panel it touches (the four ways out), the nearest that is clean and touches nothing new */
  /* the shifts that could clear rect r: into the view, then off each panel it touches (the four ways out, each brought back into view) */
  const shiftsFor = (r) => {
    const tries = [shiftInto(r, local.safe ?? r)];
    for (const q of local.avoid ?? []) {
      if (!area(r, q)) continue;
      for (const d of [{ dx: q.l - r.r - 2, dy: 0 }, { dx: q.r - r.l + 2, dy: 0 }, { dx: 0, dy: q.t - r.b - 2 }, { dx: 0, dy: q.b - r.t + 2 }]) {
        tries.push(d);
        const m = { l: r.l + d.dx, t: r.t + d.dy, r: r.r + d.dx, b: r.b + d.dy }, s1 = shiftInto(m, local.safe ?? m);
        tries.push({ dx: d.dx + s1.dx, dy: d.dy + s1.dy });
      }
    }
    return tries.sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy));
  };
  for (const d of shiftsFor(r)) {
    const q = { l: r.l + d.dx, t: r.t + d.dy, r: r.r + d.dx, b: r.b + d.dy };
    if (localCost(q, local) > 1 || sharedHit(q) > base + 0.5) continue;
    for (const it of out.items) { it.x = Math.round(it.x + d.dx); it.y = Math.round(it.y + d.dy); }
    if (out.gauge) { out.gauge.x = Math.round(out.gauge.x + d.dx); out.gauge.y = Math.round(out.gauge.y + d.dy); }
    out.rect = q;
    return { out, moved: 'shift', d };
  }
  /* then the same picture a little smaller, about its corner nearest the token (or the focus), shifted in: same side, same order,
     only the size differs (a seat with a much smaller window: closer to the shared picture than another side would be) */
  const ref = T ? { x: T.x, y: T.y } : frame.focus ?? { x: (r.l + r.r) / 2, y: (r.t + r.b) / 2 };
  /* the anchor: the block's point nearest the token first (it stays by it), then its centre and corners (a critical without a token) */
  const anchors = [[Math.max(r.l, Math.min(r.r, ref.x)), Math.max(r.t, Math.min(r.b, ref.y))], [(r.l + r.r) / 2, (r.t + r.b) / 2], [r.l, r.t], [r.r, r.t], [r.l, r.b], [r.r, r.b]];
  for (const k of SHRINK_LOCAL) for (const [ax, ay] of (T ? anchors.slice(0, 1) : anchors)) {
    const sc = { l: ax + (r.l - ax) * k, t: ay + (r.t - ay) * k, r: ax + (r.r - ax) * k, b: ay + (r.b - ay) * k };
    let d = null, q = null;
    for (const s of shiftsFor(sc)) {
      const m = { l: sc.l + s.dx, t: sc.t + s.dy, r: sc.r + s.dx, b: sc.b + s.dy };
      if (localCost(m, local) <= 1 && sharedHit(m) <= base * k * k + 0.5) { d = s; q = m; break; }
    }
    if (!d) continue;
    const mv = (x, a0, dd) => Math.round(a0 + (x - a0) * k + dd);
    for (const it of out.items) { it.x = mv(it.x, ax, d.dx); it.y = mv(it.y, ay, d.dy); it.S = Math.round(it.S * k * 10) / 10; it.w *= k; it.h *= k; }
    if (out.gauge) { out.gauge.x = mv(out.gauge.x, ax, d.dx); out.gauge.y = mv(out.gauge.y, ay, d.dy); out.gauge.w *= k; out.gauge.h *= k; out.gauge.k = (out.gauge.k ?? 1) * k; }
    out.rect = q; out.f = (out.f ?? 1) * k;
    return { out, moved: 'shrink', k, d };
  }
  const o2 = recompose ? recompose() : null;
  return o2 ? { out: o2, moved: 'layout' } : { out, moved: 'none' };
}
/* how far a seat may shrink the shared block in place before it lays it out anew (SAMEPIC) */
export const SHRINK_LOCAL = Object.freeze([0.94, 0.88, 0.82, 0.76, 0.7, 0.64]);

/* two boxes of a composed moment overlap (with their motion room) -> true; used by the checks */
export function overlaps(a, b, room = 0) {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w + 2 * room && Math.abs(a.y - b.y) * 2 < a.h + b.h + 2 * room;
}

/* the engine letters A-Z, Polish letters, digits, ! ? - + ' . and spaces: other marks of our texts are rewritten
   (the ellipsis of HMM… -> three dots, the thousands comma of 1,234 -> 1234, the middle dot -> a space) */
export function letterable(text) {
  return String(text ?? '').replace(/…/g, '...').replace(/(\d),(?=\d{3})/g, '$1').replace(/\s*·\s*/g, ' ').replace(/[^\p{L}\p{N}!?\-+'. \n]/gu, '');
}

/* the seed of one lettering: the same message gives the same lettering on every client */
export const seedOf = (base, role) => (base == null ? undefined : `${base}:${role}`);
