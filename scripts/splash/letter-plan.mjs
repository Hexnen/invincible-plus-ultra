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
import { hueOf, oddsText, oddsLabel, fmtOdds, LBL, say } from './logic.mjs';

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
export const FLOOR = { word: 30, pre: 22, wreck: 22, six: 21, say: 19, odds: 17, stress: 19 };

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
    const pre = add({ role: 'pre', text: ev.prefix, delay: 0, cap: 0.052, wMax: 0.5, mood: m,
      sound: { loud: 0.5, pitch: 0.6, long: 0.6 }, colors: ['#fff1dc', '#ffc27a', '#e07a2a'], hold: Math.round(420 * holdK), rotation: -4 });
    t = pre.hold + EXIT_MAX + 60;
  }

  if (ev.fail) {
    const soft = !!ev.softFail, dF = clamp(o.dF ?? 0.3, 0, 1);
    const m0 = moodOf(ev.word);
    /* a routine miss mutters (tick, small, grey); a real miss falls (fail); a pushed roll that broke keeps its sound (CRACK! cracks) */
    const mood = soft ? 'tick' : (ev.pushed && WORD_MOOD[ev.word] ? m0 : 'fail');
    const loud = soft ? 0.12 : r1(0.3 + 0.45 * dF + (ev.pushed ? 0.1 : 0));
    const w = add({ role: 'word', text: ev.word, delay: t, cap: r3(soft ? 0.05 : 0.062 + 0.045 * dF + (ev.pushed ? 0.008 : 0)), wMax: soft ? 0.4 : 0.55,
      mood, sound: { loud, pitch: soft ? -0.2 : r1(-0.45 - 0.45 * dF), sharp: MOOD_SHARP[m0] ?? 0.4, rough: soft ? 0 : r1(0.2 + 0.4 * dF) },
      colors: soft ? SOFT_COLORS : FAIL_COLORS, hold: Math.round((soft ? 1300 : 2200 + 600 * dF) * holdK), rotation: soft ? 0 : 5 });
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
    add({ role: 'word', text: ev.word, delay: t, cap: r3(cap), wMax: full ? (wreck ? 0.46 : 0.64) : (wreck ? 0.42 : 0.58), wMin: full ? 0.5 : 0, mood: m, sound,
      colors: P >= 0.4 || o.npc ? powerColors(P, o.npc ? 150 : 0) : null,     // a weak success keeps its mood's own palette (variety); strong ones climb the power scale
      hold, rotation: 0, from: o.token ? 'token' : 90 });
    if (wreck) add({ role: 'wreck', text: ev.wreckWord, delay: t + 520, cap: r3(cap * 0.62), wMax: 0.36,
      mood: moodOf(ev.wreckWord), sound: { loud: r1(Math.min(1, loud + 0.1)), rough: 0.7 }, colors: powerColors(Math.min(1, P + 0.1), -22 + (o.npc ? 150 : 0)), hold: hold - 520, rotation: 8 });
    if (ev.sixes > 0) {
      add({ role: 'six', text: LBL.six(ev.sixes), delay: t + 230, cap: r3((full ? 0.058 : 0.038) + 0.003 * Math.min(4, ev.sixes)), wMax: 0.3,
        mood: 'impact', sound: { loud: r1(0.4 + 0.12 * Math.min(4, ev.sixes)), sharp: 0.75, pitch: 0.3 },
        colors: SIX_COLORS, hold: hold - 230 + 90, rotation: -7 });
    }
    const sentence = ev.tag ? say(ev.tag) : oddsText(P);
    if (sentence && ev.p != null) {
      add({ role: 'say', text: sentence, delay: t + 360, cap: r3((full ? 0.05 : 0.038) + 0.006 * P), wMax: 0.7,
        mood: 'tick', sound: { loud: 0.35, pitch: 0.4, sharp: 0.5 }, colors: sayColors(P, o.npc ? 150 : 0), hold: hold - 360 + 120, rotation: -3 });
      add({ role: 'odds', text: oddsLabel(ev.p) + (ev.pushed ? ' - ' + LBL.push : ''), delay: t + 460, cap: full ? 0.042 : 0.032, wMax: 0.5,
        mood: 'tick', sound: { loud: 0.3, pitch: 0, sharp: 0.6 }, colors: ODDS_COLORS, hold: hold - 460 + 120, rotation: -2 });
    }
  }
  for (const it of items) Object.assign(it, motionOf(it, ev, o));
  for (const it of items) {
    it.hold = Math.max(300, it.hold);
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
  const safeW = Math.max(120, safe.r - safe.l), safeH = Math.max(120, safe.b - safe.t);
  let f = 1, out = null;
  for (let pass = 0; pass < 8; pass++) {
    out = layoutAt(items, frame, measure, f, safeW, vh, sc);
    const bw = out.rect.r - out.rect.l, bh = out.rect.b - out.rect.t;
    const k = Math.min(1, (safeW - 4) / bw, (safeH - 4) / bh);
    if (k >= 0.999) break;
    f *= k * 0.97;
  }
  place(out, frame);
  return out;
}
function layoutAt(items, frame, measure, f, safeW, vh, sc) {
  const sized = items.map(it => {
    let S = Math.max(FLOOR[it.role] ?? 16, (it.cap ?? 0.04) * vh) * sc * f;
    let b = measure(it, S);
    const wMax = (it.wMax ?? 0.6) * safeW;
    if (b.w > wMax) { S *= wMax / b.w; b = measure(it, S); }
    if (it.wMin && b.w < it.wMin * safeW * f) {   // the critical word fills its share of the screen even when it is short
      const S2 = Math.min(S * (it.wMin * safeW * f) / b.w, 0.3 * vh * sc * f);
      if (S2 > S) { S = S2; b = measure(it, S); }
    }
    return { ...it, S: Math.round(S * 10) / 10, w: b.w, h: b.h };
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
  if (word) {
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
    const wordL = word ? word.x - word.w / 2 : -100, rowW = word ? Math.max(word.w, ...[wreck, six].filter(Boolean).map(it => it.x + it.w / 2 - wordL)) : 0;
    const inline = cap.length === 2 && sayI.w + g + odds.w <= Math.max(rowW, 0.9 * safeW);
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
    const gw = frame.gauge?.w ?? 0, gh = frame.gauge?.h ?? 0;
    const w = stress.w + (gw ? g + gw : 0), h = Math.max(stress.h, gh);
    stress.x = -w / 2 + stress.w / 2; stress.y = y + h / 2;
    if (gw) gauge = { x: -w / 2 + stress.w + g, y: y + h / 2 - gh / 2, w: gw, h: gh };   // top-left of the DOM gauge
    y += h;
  }
  const rect = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
  for (const it of sized) {
    if (it.x == null) continue;
    const p = pad(it);
    rect.l = Math.min(rect.l, it.x - it.w / 2 - p); rect.r = Math.max(rect.r, it.x + it.w / 2 + p);
    rect.t = Math.min(rect.t, it.y - it.h / 2 - p); rect.b = Math.max(rect.b, it.y + it.h / 2 + p);
  }
  if (gauge) { rect.l = Math.min(rect.l, gauge.x); rect.r = Math.max(rect.r, gauge.x + gauge.w); rect.b = Math.max(rect.b, gauge.y + gauge.h); }
  return { items: sized.filter(it => it.x != null), rect, gauge, f };
}
/* where the block goes: by the token (above its head, else under its feet, else to its free side) or on the focus point; then shifted
   into the safe rectangle (the window without the chat, the bars and the hotbar) */
function place(out, frame) {
  const safe = frame.safe, r = out.rect, bw = r.r - r.l, bh = r.b - r.t, cx0 = (r.l + r.r) / 2, cy0 = (r.t + r.b) / 2;
  const T = frame.token;
  let dx, dy, side = 'focus';
  const fits = (l, t) => l >= safe.l - 0.5 && t >= safe.t - 0.5 && l + bw <= safe.r + 0.5 && t + bh <= safe.b + 0.5;
  if (T) {
    const gap = 6;
    const cand = [
      ['above', T.x - bw / 2, T.t - gap - bh],
      ['below', T.x - bw / 2, T.b + gap],
      ['right', T.r + gap, T.y - bh / 2],
      ['left', T.l - gap - bw, T.y - bh / 2]
    ];
    /* the first side where it fits after sliding along that side only (never onto the token) */
    let pick = null;
    for (const [s, l, t] of cand) {
      const l2 = s === 'above' || s === 'below' ? clamp(l, safe.l, safe.r - bw) : l;
      const t2 = s === 'left' || s === 'right' ? clamp(t, safe.t, safe.b - bh) : t;
      if (fits(l2, t2)) { pick = [s, l2, t2]; break; }
    }
    pick ??= ['above', cand[0][1], cand[0][2]];
    side = pick[0];
    dx = pick[1] - r.l; dy = pick[2] - r.t;
  } else {
    dx = frame.focus.x - cx0; dy = frame.focus.y - cy0;
  }
  /* inside the safe rectangle in any case */
  const l = clamp(r.l + dx, safe.l, Math.max(safe.l, safe.r - bw)), t = clamp(r.t + dy, safe.t, Math.max(safe.t, safe.b - bh));
  dx = l - r.l; dy = t - r.t;
  for (const it of out.items) { it.x = Math.round(it.x + dx); it.y = Math.round(it.y + dy); }
  if (out.gauge) { out.gauge.x = Math.round(out.gauge.x + dx); out.gauge.y = Math.round(out.gauge.y + dy); }
  out.rect = { l: r.l + dx, t: r.t + dy, r: r.r + dx, b: r.b + dy };
  out.side = side;
}
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
