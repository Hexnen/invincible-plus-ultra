/* LDIC: the moment after a roll, lettered. PURE (no DOM, no Foundry): turns a splash event (logic.mjs buildEvent) into the list of
   comic letterings that make the moment: the sound word, the push grunt, the wreck crash, the sixes, the odds sentence and its figure,
   the stress number. Each item says WHAT (text), WHERE (percent of the stage box), WHEN (delay), HOW BIG and HOW IT SOUNDS (mood + sound
   for the LETR engine, scripts/letters/), in which COLOURS and for how long it holds. stage.mjs turns it into L.play calls.

   What says what (the user's ask: shape, size, colour and motion say how good or bad the roll was, what kind of action, how hard it hit):
   - the KIND of action: each sound word has its own mood (WHAM! a blunt impact, KRAK! a crack, ZIP! a whoosh, ROAR! a roar ...),
     so the letter shapes stand for the sound (sharp splinters for a crack, round swell for a boom, a smear for a whoosh);
   - how GOOD: power P (rarity) drives loudness (size, weight), pitch (rising), grit and the colour climb yellow -> red -> violet;
   - how BAD: a miss falls (mood fail, falling pitch, cold grey-blue), a routine miss is a small grey mutter, a rare one is loud;
   - the numbers are lettered too, each in its own steady colour so the table learns them: sixes gold, odds white, stress red. */
import { hueOf, oddsText, oddsLabel, fmtOdds, LBL, say } from './logic.mjs';

/* sound word -> mood (the LETR engine's intents). A word not listed falls back to its action's default. */
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
const hsl = (h, s, l) => `hsl(${Math.round(((h % 360) + 360) % 360)},${s}%,${l}%)`;
/* the power climb of the old splash (yellow -> orange -> red -> magenta -> violet), lettering-strength: a light top, a strong middle, a deep base */
export function powerColors(P, shift = 0) {
  const h = hueOf(P) + shift;
  return [hsl(h + 22, 100, 86), hsl(h, 100, 56), hsl(h - 12, 95, 33)];
}
export const SIX_COLORS = Object.freeze(['#fff7c8', '#ffd23f', '#e06a00']);      // sixes: always gold (the die's best face)
export const ODDS_COLORS = Object.freeze(['#ffffff', '#e4e9f6', '#8d98b8']);     // the odds figure: a plain white stamp
export const STRESS_COLORS = Object.freeze(['#ffd3d9', '#ff3b52', '#7c0616']);   // stress: blood red
export const FAIL_COLORS = Object.freeze(['#eef0f7', '#a3abc4', '#4a5272']);     // a miss: cold, drained
export const SOFT_COLORS = Object.freeze(['#e2e1ea', '#b9b7c8', '#6d6b80']);     // a routine miss: a grey mutter

/* positions in percent of the stage box (stage.mjs: 16:9 on screen, 4:3 around a token with the token in the middle) */
export const POS = {
  screen: { word: [50, 42], wordW: [36, 42], wreck: [79, 60], pre: [50, 13], six: [77, 75], say: [35, 79], odds: [35, 93], stress: [30, 9],
    fail: [50, 42], failSay: [50, 72], failOdds: [50, 86] },
  token: { word: [50, 17], wordW: [37, 17], wreck: [80, 32], pre: [50, 4], six: [86, 54], say: [50, 85], odds: [50, 96], stress: [17, 29],
    fail: [50, 19], failSay: [50, 84], failOdds: [50, 95] }
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = v => Math.round(v * 100) / 100;

/* ev: the splash event; o: { W (stage width px), token (bool), holdK, npc (bool), dF (fail strength 0..1, from stage.mjs),
   reduced (bool) }. -> { items: [{ role, text, at:[x%,y%], delay, size, maxWidth, mood, sound, colors, hold, rotation, from }], end } */
export function planMoment(ev, o = {}) {
  o = { npc: !!ev.npc, dF: failStrength(ev), ...o };
  const W = o.W || 760, u = clamp(W / 760, 0.5, 2.2), holdK = o.holdK || 1, pos = o.token ? POS.token : POS.screen;
  const items = [];
  const add = it => { items.push(it); return it; };
  let t = 0;

  /* a pushed roll: the grunt first, rising (the effort), then the result */
  if (ev.pushed && ev.prefix) {
    const m = moodOf(ev.prefix);
    add({ role: 'pre', text: ev.prefix, at: pos.pre, delay: 0, size: Math.round(30 * u), maxWidth: Math.round(W * 0.6), mood: m,
      sound: { loud: 0.5, pitch: 0.6, long: 0.6 }, colors: ['#ffe2b8', '#ff9330', '#a8400a'], hold: Math.round(420 * holdK), rotation: -4 });
    t = 620;
  }

  if (ev.fail) {
    const soft = !!ev.softFail, dF = clamp(o.dF ?? 0.3, 0, 1);
    const m0 = moodOf(ev.word);
    /* a routine miss mutters (tick, small, grey); a real miss falls (fail); a pushed roll that broke keeps its sound (CRACK! cracks) */
    const mood = soft ? 'tick' : (ev.pushed && WORD_MOOD[ev.word] ? m0 : 'fail');
    const loud = soft ? 0.12 : r1(0.3 + 0.45 * dF + (ev.pushed ? 0.1 : 0));
    add({ role: 'word', text: ev.word, at: pos.fail, delay: t, size: Math.round((soft ? 26 : 34 + 26 * dF + (ev.pushed ? 6 : 0)) * u),
      maxWidth: Math.round(W * (soft ? 0.5 : 0.7)), mood, sound: { loud, pitch: soft ? -0.2 : r1(-0.45 - 0.45 * dF), sharp: MOOD_SHARP[m0] ?? 0.4, rough: soft ? 0 : r1(0.2 + 0.4 * dF) },
      colors: soft ? SOFT_COLORS : FAIL_COLORS, hold: Math.round((soft ? 1300 : 2200 + 600 * dF) * holdK), rotation: soft ? 0 : 5 });
    /* a rare miss also says how rare: the sentence and the figure (the old ribbon) */
    if (!soft && dF > 0.3 && !ev.pushed && ev.failP) {
      const wordHold = items[items.length - 1].hold;
      add({ role: 'say', text: say(dF > 0.6 ? 'WHAT A FLOP!' : 'UNLUCKY!'), at: pos.failSay, delay: t + 330, size: Math.round(22 * u), maxWidth: Math.round(W * 0.6),
        mood: 'fail', sound: { loud: 0.35, pitch: -0.3 }, colors: ['#dde5ff', '#8fa3d9', '#36457a'], hold: Math.max(400, wordHold - 330), rotation: -3 });
      add({ role: 'odds', text: LBL.miss(fmtOdds(Math.round(1 / ev.failP))), at: pos.failOdds, delay: t + 430, size: Math.round(17 * u), maxWidth: Math.round(W * 0.6),
        mood: 'tick', sound: { loud: 0.3, pitch: 0 }, colors: ODDS_COLORS, hold: Math.max(400, wordHold - 430), rotation: -2 });
    }
  } else {
    const P = ev.power ?? 0, tier = ev.tier ?? 1, m = moodOf(ev.word, ev.action);
    const loud = r1(0.3 + 0.7 * P);
    const sound = { loud, pitch: r1(0.15 + 0.6 * P), rough: r1(P > 0.55 ? 0.25 + 0.5 * P : 0.1) };
    if (LONG.has(m)) sound.long = r1(0.45 + 0.35 * P);
    const hold = Math.round((2400 + 1600 * P) * holdK);
    const wreck = !!ev.wreckWord;
    add({ role: 'word', text: ev.word, at: wreck ? pos.wordW : pos.word, delay: t, size: Math.round((30 + 62 * P + 1.6 * Math.min(tier, 10)) * u),
      maxWidth: Math.round(W * (wreck ? 0.46 : (o.token ? 0.8 : 0.74))), mood: m, sound,
      colors: P >= 0.4 || o.npc ? powerColors(P, o.npc ? 150 : 0) : null,     // a weak success keeps its mood's own palette (variety); strong ones climb the power scale
      hold, rotation: 0, from: o.token ? 'token' : 90 });
    if (wreck) add({ role: 'wreck', text: ev.wreckWord, at: pos.wreck, delay: t + 520, size: Math.round((26 + 40 * P) * u), maxWidth: Math.round(W * 0.34),
      mood: moodOf(ev.wreckWord), sound: { loud: r1(Math.min(1, loud + 0.1)), rough: 0.7 }, colors: powerColors(Math.min(1, P + 0.1), -22 + (o.npc ? 150 : 0)), hold: hold - 520, rotation: 8 });
    if (ev.sixes > 0) {
      add({ role: 'six', text: `${ev.sixes} ${ev.sixes === 1 ? 'SIX' : 'SIXES'}`, at: pos.six, delay: t + 170, size: Math.round((22 + 10 * Math.min(1, ev.sixes / 4)) * u),
        maxWidth: Math.round(W * (o.token ? 0.3 : 0.36)), mood: 'impact', sound: { loud: r1(0.4 + 0.12 * Math.min(4, ev.sixes)), sharp: 0.75, pitch: 0.3 },
        colors: SIX_COLORS, hold: hold - 170 + 90, rotation: -7 });
    }
    const sentence = ev.tag ? say(ev.tag) : oddsText(P);
    if (sentence && ev.p != null) {
      add({ role: 'say', text: sentence, at: pos.say, delay: t + 330, size: Math.round((19 + 6 * P) * u), maxWidth: Math.round(W * (o.token ? 0.82 : 0.5)),
        mood: 'tick', sound: { loud: 0.35, pitch: 0.4, sharp: 0.5 }, colors: powerColors(P, o.npc ? 150 : 0), hold: hold - 330 + 120, rotation: -3 });
      add({ role: 'odds', text: oddsLabel(ev.p) + (ev.pushed ? '\n' + LBL.push : ''), at: pos.odds, delay: t + 430, size: Math.round(16 * u), maxWidth: Math.round(W * (o.token ? 0.7 : 0.46)),
        mood: 'tick', sound: { loud: 0.3, pitch: 0, sharp: 0.6 }, colors: ODDS_COLORS, hold: hold - 430 + 120, rotation: -2 });
    }
  }
  for (const it of items) Object.assign(it, motionOf(it, ev, o));
  /* never smaller than a readable cap height (1366x768 with the chat open); sizes are cap heights in screen px */
  const MIN = { word: 24, pre: 20, wreck: 20, six: 20, say: 16, odds: 14, stress: 18 };
  for (const it of items) { it.size = Math.max(MIN[it.role] ?? 14, it.size); it.hold = Math.max(300, it.hold); if (o.reduced) it.rotation = 0; }
  const end = Math.max(0, ...items.map(it => it.delay + it.hold));
  return { items, end };
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

/* how hard a miss lands, 0..1, from its rarity: routine (more likely than not) is quiet, a rare miss of a strong hero is loud */
export function failStrength(ev) {
  if (!ev?.fail) return 0;
  return ev.failP == null ? 0.3 : clamp(Math.log(0.5 / ev.failP) / Math.log(10), 0, 1);
}

/* the stress number joins the moment: "STRESS +2" lettered in pain red beside the Resolve gauge (the gauge itself stays a gauge) */
export function planStress(stress, o = {}) {
  const W = o.W || 760, u = clamp(W / 760, 0.5, 2.2), pos = o.token ? POS.token : POS.screen;
  return { role: 'stress', text: LBL.stress(stress), at: pos.stress, delay: 0, size: Math.max(18, Math.round((20 + 3 * Math.min(4, stress)) * u)),
    maxWidth: Math.round(W * 0.3), mood: 'pain', sound: { loud: r1(Math.min(0.9, 0.35 + 0.12 * stress)), pitch: -0.3 }, colors: STRESS_COLORS,
    hold: Math.round(2600 * (o.holdK || 1)), rotation: o.reduced ? 0 : -5, in: 'slam', holdKind: 'throb', out: 'fall' };
}

/* the engine letters A-Z, Polish letters, digits, ! ? - + ' . and spaces: other marks of our texts are rewritten
   (the ellipsis of HMM… -> three dots, the thousands comma of 1,234 -> 1234, the middle dot -> a new line) */
export function letterable(text) {
  return String(text ?? '').replace(/…/g, '...').replace(/(\d),(?=\d{3})/g, '$1').replace(/\s*·\s*/g, '\n').replace(/[^\p{L}\p{N}!?\-+'. \n]/gu, '');
}

/* the seed of one lettering: the same message gives the same lettering on every client */
export const seedOf = (base, role) => (base == null ? undefined : `${base}:${role}`);
