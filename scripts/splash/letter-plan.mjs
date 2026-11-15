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
import { hueOf, oddsText, oddsLabel, fmtOdds, LBL, say, sfxWord, WORD_MOODS, FAMILY_MOODS, soundOf, SFX_KEYS, KEEP_EN, ACTION_WORDS } from './logic.mjs';   // SPLASHPL: sfxWord = the action word as this seat shows it (moods stay keyed by the English word)
import { cleanHere, localCost, shiftInto } from '../same-picture.mjs';   // SAMEPIC: one picture for the table
import * as LC from '../letter-colors.mjs';   // PALETTE: the lettering's colours, one place

/* the push grunts, the wreck and the pushed roll that broke: their sound (mood + the engine's motion row, words.mjs SOUND) */
const OWN_SOUND = Object.freeze({
  /* push grunts: the effort (strained, trembling), the shout of will (rising) */
  'STRAIN!': ['roar', 'effort'], 'PUSH!': ['powerup', 'effort'], 'GRRR!': ['roar', 'snarl'], 'ALL IN!': ['powerup', 'cheer'], 'FULL STRENGTH!': ['powerup', 'effort'],
  'AGAIN!': ['powerup', 'cheer'], 'HNNNG!': ['roar', 'effort'], 'ONE MORE!': ['powerup', 'cheer'],
  /* wreck: what falls apart */
  'WRECK!': ['crash', 'crash'], 'RUIN!': ['crash', 'crumble'], 'KRAKOOM!': ['boom', 'boom'], 'DEMOLITION!': ['crash', 'crash'],
  /* a pushed roll that still failed: the sound of it breaking */
  'SKRAK!': ['crack', 'crack'], 'TSKRIK!': ['crack', 'crack'], 'OUCH!': ['pain', 'pain']
});
/* word -> mood (the LETR engine's intents). WORDPOOL2: every action family's words (words.mjs) plus the grunts and wrecks, each with its own
   mood; nothing falls back to its action's default. */
export const WORD_MOOD = Object.freeze({ ...WORD_MOODS, ...Object.fromEntries(Object.entries(OWN_SOUND).map(([w, [m]]) => [w, m])) });
const ACTION_MOOD = { ...FAMILY_MOODS };
/* the sharp/round character of each mood, used to keep the word's own sound when a miss forces the "fail" mood */
const MOOD_SHARP = { impact: 0.7, crack: 0.95, crash: 0.8, boom: 0.25, roar: 0.45, fire: 0.5, whoosh: 0.35, zap: 0.9, tick: 0.6, pain: 0.8, powerup: 0.55, heal: 0.2, splash: 0.15, fail: 0.4 };
const LONG = new Set(['whoosh', 'roar', 'powerup', 'boom']);

/* the word's own sound in its action family (KA-KROOM! booms in a blast, rumbles in a quake), else its word mood, else the family's */
export const moodOf = (word, action) => soundOf(word, action)?.mood ?? WORD_MOOD[word] ?? ACTION_MOOD[action] ?? 'impact';
/* WORDPOOL2: the engine's motion row of that sound (motion.mjs KIND_MOTION), or null (the mood's row) */
export const kindOf = (word, action) => soundOf(word, action)?.kind ?? OWN_SOUND[word]?.[1] ?? null;

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
/* PALETTE (the owner: «Nie chcę żeby najczęstsze napisy były różowe»): a hero's success from P 0.4 climbs the fight comics' heat ladder
   (letter-colors.mjs CLIMB: orange when strong, red on a gold block when critical), no longer the pale climb into magenta and lilac; an
   opponent's success (shift 150) keeps its own cold climb, which now ends in teal (logic.mjs HUES end at red) */
export function powerColors(P, shift = 0, rank = null, family = null) {
  const c = shift === 0 ? LC.climbOf(P, rank ?? (P >= 0.7 ? 'critical' : 'strong'), family) : null;
  if (c) return c.fill.slice();
  const h = hueOf(P) + shift;
  return [hsl(h + 12, 100, 95), hsl(h, 100, 82), hsl(h - 8, 90, 62)];
}
/* the caption sentence: the same hue, lighter still (it is read, not heard); a hero's strong or critical caption pale apricot (PALETTE) */
export function sayColors(P, shift = 0) {
  if (shift === 0 && P >= 0.4) return LC.SAY_HOT.slice();
  const h = hueOf(P) + shift;
  return [hsl(h, 100, 97), hsl(h, 100, 90), hsl(h, 85, 74)];
}
export const SIX_COLORS = LC.SIX;            // sixes: always gold (the die's best face)
export const ODDS_COLORS = LC.ODDS;          // the odds figure: a plain white stamp
export const STRESS_COLORS = LC.STRESS;      // stress: blood red
export const FAIL_COLORS = LC.FAIL;          // a miss: cold, drained
export const SOFT_COLORS = LC.SOFT;          // a routine miss: a light grey mutter (readable on a dark map)
export const MISS_SAY_COLORS = LC.MISS_SAY;  // UNLUCKY / WHAT A FLOP: pale cold blue

/* FXLD: the numbers and the caption sentence are information, read at a glance: one legible hand for all of them (a partial hand,
   design.mjs merges it over its own choice; the same thing the token reactions pin, REQUESTS ltok 10): the tall narrow face of the
   Invincible lettering (Anton), plain letters, flat, no texture, a light cut line around the ink. The sound word keeps the hand its
   mood picks (variety). */
/* WORDPOOL2: number: true = even letter sizes (design.mjs: no accent shrink of the tail): the comic hand sized the last letters of a caption
   smaller and "LUCKY BREAK!" read "LUCKy BREAK!", "SHATTERED" read "SHATTERed" */
export const INFO_HAND = Object.freeze({ number: true, font: 'anton', treat: 'plain', env: 'flat', tex: 'none', outline: 'sticker', fill: 'flat', shadow: null, shear: 0.05, track: 0.03, hatch: false, bevel: false });
/* the caption row (the sentence and the odds) is the smallest lettering: the light cut line and a puffed ink line are stroked over the
   edges, inwards too, and at caption size they filled Anton's narrow counters (live, 1366: NOT BAD! read HOT RAD!, IN was two
   blocks). So the caption has a thin ink line only, no puff, no extrusion, no gloss: the counters stay open. */
export const CAPTION_HAND = Object.freeze({ ...INFO_HAND, outline: 'ink', out2W: 0, inkW: 0.04, inflate: 0, depth: 0, gloss: false });
/* WORDPOOL2: a plain word (an action word, a shout, a mutter: read, not heard) keeps the hand its mood picks but letters every letter at one
   size: the sound's accent sizing shrank its tail or its first word (IMADło!, "ACCESS" small before GRANTED!, ZMIAŻDŻENie!) and the word read
   as a mistake. Sound words (onomatopoeia) keep their accent. */
export const PLAIN_HAND = Object.freeze({ number: true });
export const isPlainWord = (w) => typeof w === 'string' && (ACTION_WORDS.has(w) || Object.hasOwn(SFX_KEYS, w) || KEEP_EN.includes(w));
const CAPTION_ROLES = new Set(['say', 'odds']);
const INFO_ROLES = new Set(['six', 'say', 'odds', 'stress']);

/* cap height of each lettering, as a share of the viewport height (1366x768 and 1920x1080 alike), and its pixel floor */
export const FLOOR = { word: 30, pre: 22, wreck: 22, six: 21, say: 21, odds: 19, stress: 19 };   // FXI-SPLASH: say 19 -> 21, odds 17 -> 19 (ADVI 11)

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/* CRITPEAK (ADVX 2, 3, 4, 15; the owner's standard: the lettering BUILDS, a critical is the biggest, loudest thing the table sees, a
   strong roll clearly more than an ordinary one, a pushed roll a beat of its own, readable at the sizes that really occur).
   ONE rule for the block: each lettering has a RANK (what the roll was) and from it a nominal size (`cap`) and a floor (`min`), both as a
   share of the reference height (same-picture.mjs REF_VH, on screen). The layout may shrink the block to make room (composeMoment), but
   never a part below its floor, and the floors keep the ranks apart: the weakest strong roll's floor is over the biggest ordinary roll, the
   critical's floor over the biggest strong roll (RANK_WORD). Before: the floor was applied BEFORE the layout's shrink (FLOOR * f, so no
   floor at all), a crowded or long critical shrank below a strong roll (83 vs 81 px), the map layer capped the critical at 0.14 of its
   board height (under an ordinary roll's word), and the map never looked at the zoom (a 16 px word at the far view). The info lines rank
   with their word: a critical's sentence, odds and sixes are never smaller than a strong roll's (RANK_INFO). On the map the same floors
   hold ON SCREEN (scene px = screen px / zoom) and the board size stands only while it is at most MAP_MAX over the nominal screen size. */
export const STRONG_P = 0.1;   // the power from which a success carries a sentence (logic.mjs ODDS: NOT BAD! from 0.10): a strong roll
export const RANK_WORD = Object.freeze({
  ordinary: { cap: (P) => 0.078 + 0.05 * clamp(P, 0, STRONG_P), min: 0.066 },                  // ~70-75 px at 900, floor 59
  strong: { cap: (P) => 0.108 + 0.06 * clamp((P - STRONG_P) / 0.6, 0, 1), min: 0.1 },          // ~97-151 px, floor 90 (> 75)
  critical: { cap: (P) => 0.22 + 0.035 * clamp(P, 0, 1), min: 0.2 },                           // ~230 px, floor 180 (> 151 x MAP_MAX)
  miss: { cap: (dF) => 0.06 + 0.025 * clamp(dF, 0, 1), min: 0.05 },                            // a miss is never louder than a success
  soft: { cap: () => 0.06, min: 0.05 }
});
/* the info lines of each rank: [cap, floor] (share of the reference height); a critical's floors stand over a strong roll's caps */
export const RANK_INFO = Object.freeze({
  six: { ordinary: [0.042, 0.034], strong: [0.046, 0.036], critical: [0.064, 0.055] },
  say: { strong: [0.046, 0.034], critical: [0.066, 0.056], miss: [0.04, 0.032] },
  odds: { strong: [0.04, 0.03], critical: [0.056, 0.048], miss: [0.035, 0.029] },
  stress: [0.044, 0.034]
});
/* CRITPEAK (ADVX 4): a map moment whose word (screen px at this seat's zoom) is under word, or a caption under info, is a speck on this
   seat: it plays on the screen layer there (stage.mjs playLetters) */
export const MAP_READ = { word: 22, info: 12 };
/* the board's scale on a seat's view against the screen rule (GRID_VH squares x zoom over REF_VH) within which a moment stays on the map */
export const MAP_BAND = Object.freeze([0.25, 1.25]);
export const MAP_UP = 1.6;   // a board block too big for a close view comes to the screen at most this much bigger (stage.mjs)
export const PRE_MIN = 0.072;  // the push grunt's floor: a beat of its own (ADVX 15: 47-53 px live)
export const MAP_MAX = 1.15;    // on the map the board size stands while it is at most this much over the nominal screen size
export const GAUGE_MIN = 0.9, GAUGE_MAX = 1.4;   // the Resolve gauge's scale on screen (its figures ~20-23 px at 1; ADVX 15: microscopic)
export const rankOf = (ev, full) => (ev.fail ? (ev.softFail ? 'soft' : 'miss') : full ? 'critical' : (ev.power ?? 0) >= STRONG_P ? 'strong' : 'ordinary');
const info = (role, rank) => { const t = RANK_INFO[role]; const v = Array.isArray(t) ? t : (t[rank] ?? t.strong ?? t.ordinary); return { cap: v[0], min: v[1] }; };
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
    const pre = add({ role: 'pre', text: sfxWord(ev.prefix), delay: 0, cap: PRE_CAP, min: PRE_MIN, wMax: 0.5, mood: m, kind: kindOf(ev.prefix),
      sound: { loud: 0.6, pitch: 0.6, long: 0.6 }, colors: ['#fff1dc', '#ffc27a', '#e07a2a'], hold: Math.round(PRE_HOLD * holdK), rotation: -4 });
    t = pre.hold + EXIT_MAX + 60;
  }

  const rank = rankOf(ev, full);
  if (ev.fail) {
    const soft = !!ev.softFail, dF = clamp(o.dF ?? 0.3, 0, 1);
    const m0 = moodOf(ev.word);
    /* a routine miss mutters (tick, small, grey); a real miss falls (fail); a pushed roll that broke keeps its sound (CRACK! cracks) */
    const mood = soft ? 'tick' : (ev.pushed && WORD_MOOD[ev.word] ? m0 : 'fail');
    const loud = soft ? 0.12 : r1(0.3 + 0.45 * dF + (ev.pushed ? 0.1 : 0));
    /* FXLD2 (ADVD2 10): a routine miss is quiet but readable: the soft cap and hold were too small (NEXT! tiny on the head ring, ~1.5 s) */
    const w = add({ role: 'word', text: sfxWord(ev.word), en: ev.word, delay: t, cap: r3(RANK_WORD[rank].cap(dF)), min: RANK_WORD[rank].min, rank, wMax: soft ? 0.4 : 0.55,
      mood, kind: soft ? null : kindOf(ev.word, ev.action), sound: { loud, pitch: soft ? -0.2 : r1(-0.45 - 0.45 * dF), sharp: MOOD_SHARP[m0] ?? 0.4, rough: soft ? 0 : r1(0.2 + 0.4 * dF) },
      colors: soft ? SOFT_COLORS : FAIL_COLORS, hold: Math.round((soft ? SOFT_HOLD : 2200 + 600 * dF) * holdK), rotation: soft ? 0 : 5 });
    /* a rare miss also says how rare: the sentence and the figure */
    if (!soft && dF > 0.3 && !ev.pushed && ev.failP) {
      add({ role: 'say', text: say(dF > 0.6 ? 'WHAT A FLOP!' : 'UNLUCKY!'), delay: t + 330, ...info('say', 'miss'), wMax: 0.6,
        mood: 'tick', sound: { loud: 0.35, pitch: -0.3 }, colors: MISS_SAY_COLORS, hold: Math.max(400, w.hold - 330), rotation: -3 });
      add({ role: 'odds', text: LBL.miss(fmtOdds(Math.round(1 / ev.failP))), delay: t + 430, ...info('odds', 'miss'), wMax: 0.6,
        mood: 'tick', sound: { loud: 0.3, pitch: 0 }, colors: ODDS_COLORS, hold: Math.max(400, w.hold - 430), rotation: -2 });
    }
  } else {
    const P = ev.power ?? 0, tier = ev.tier ?? 1, m = moodOf(ev.word, ev.action);
    const loud = r1(0.3 + 0.7 * P);
    const sound = { loud, pitch: r1(0.15 + 0.6 * P), rough: r1(P > 0.55 ? 0.25 + 0.5 * P : 0.1) };
    if (LONG.has(m)) sound.long = r1(0.45 + 0.35 * P);
    const hold = Math.round((2400 + 1600 * P) * holdK);
    const wreck = !!ev.wreckWord;
    /* ADVD 5: the critical (full screen) is the biggest thing the table sees; a token-sized success grows with its rarity. CRITPEAK: by
       its rank (RANK_WORD), the critical up to nearly the whole free width (a long Polish word must not shrink it under a strong roll) */
    const cap = RANK_WORD[rank].cap(P);
    const climb = o.npc ? null : LC.climbOf(P, rank, ev.action);   // PALETTE: the heat ladder (faces) and its block (the hand's pal)
    add({ role: 'word', text: sfxWord(ev.word), en: ev.word, delay: t, cap: r3(cap), min: RANK_WORD[rank].min, rank, wMax: full ? (wreck ? 0.6 : 0.92) : (wreck ? 0.46 : 0.66), wMin: full ? 0.5 : 0, mood: m, kind: kindOf(ev.word, ev.action), sound,
      colors: climb ? climb.fill.slice() : o.npc ? powerColors(P, 150) : null,     // a weak success keeps its mood's own palette (variety); strong ones climb the heat ladder
      pal: LC.climbHand(climb)?.pal, hold, rotation: 0, from: o.token ? 'token' : 90 });
    /* PALETTE: the wreck in the colour of rubble (it climbed the power scale shifted to pink); an opponent's keeps its cold climb */
    if (wreck) add({ role: 'wreck', text: sfxWord(ev.wreckWord), delay: t + 520, cap: r3(cap * 0.62), min: r3(RANK_WORD[rank].min * 0.55), wMax: 0.4,
      mood: moodOf(ev.wreckWord), kind: kindOf(ev.wreckWord), sound: { loud: r1(Math.min(1, loud + 0.1)), rough: 0.7 }, colors: o.npc ? powerColors(Math.min(1, P + 0.1), 128) : LC.WRECK.fill.slice(), hold: hold - 520, rotation: 8 });
    if (ev.sixes > 0) {
      add({ role: 'six', text: LBL.six(ev.sixes), delay: t + 230, ...info('six', rank), wMax: 0.36,
        mood: 'impact', sound: { loud: r1(0.4 + 0.12 * Math.min(4, ev.sixes)), sharp: 0.75, pitch: 0.3 },
        colors: SIX_COLORS, hold: hold - 230 + 90, rotation: -7 });
    }
    const sentence = ev.tag ? say(ev.tag) : oddsText(P);
    if (sentence && ev.p != null) {
      add({ role: 'say', text: sentence, delay: t + 360, ...info('say', rank), wMax: 0.8,   // FXI-SPLASH (ADVI 11): the caption was too small to read
        mood: 'tick', sound: { loud: 0.35, pitch: 0.4, sharp: 0.5 }, colors: sayColors(P, o.npc ? 150 : 0), hold: hold - 360 + 120, rotation: -3 });
      add({ role: 'odds', text: oddsLabel(ev.p) + (ev.pushed ? ' - ' + LBL.push : ''), delay: t + 460, ...info('odds', rank), wMax: 0.6,
        mood: 'tick', sound: { loud: 0.3, pitch: 0, sharp: 0.6 }, colors: ODDS_COLORS, hold: hold - 460 + 120, rotation: -2 });
    }
  }
  for (const it of items) Object.assign(it, motionOf(it, ev, o));
  for (const it of items) {
    it.hold = Math.max(300, it.hold);
    it.rot0 = it.rotation || 0;   // SAMEPIC: the tilt every seat lays the block out with (a reduced seat draws it upright in that place)
    if (o.reduced) it.rotation = 0;
    if (INFO_ROLES.has(it.role)) it.hand = CAPTION_ROLES.has(it.role) ? CAPTION_HAND : INFO_HAND;
    else if (isPlainWord(it.role === 'word' ? ev.word : it.role === 'pre' ? ev.prefix : it.role === 'wreck' ? ev.wreckWord : null)) it.hand = PLAIN_HAND;
    /* PALETTE: the climb's block rides on the hand (colour only: the engine merges the hand's pal, nothing else of the hand changes) */
    if (it.pal) it.hand = { ...(it.hand ?? {}), pal: it.pal };
    delete it.pal;
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
export const PRE_CAP = 0.086, PRE_HOLD = 620, SOFT_CAP = 0.064, SOFT_HOLD = 2100;
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
  /* WORDPOOL2: the item's kind (the engine's motion row of its sound) gives everything these pins leave open: the ordinary and strong
     word's entrance, hold and exit, and always the sound's rhythm, flash and life. The pins say how good or bad the roll was (a top roll
     slams, a miss falls, a routine miss mutters) and win over the row (question WORDPOOL2-2). */
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
  const it = { role: 'stress', text: LBL.stress(stress), delay: 0, ...info('stress'), wMax: 0.36,
    mood: 'pain', sound: { loud: r1(Math.min(0.9, 0.35 + 0.12 * stress)), pitch: -0.3 }, colors: LC.stressColors(), hand: INFO_HAND,
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
/* CRITPEAK: the block's search, one order for every rank and layer:
   1. the size that fits the free part of the view (f0; no part under its floor, see sizeOf);
   2. by the token (above, below, right, left, slid along each side; the critical: round the focus), at f0 x 1, 0.9, 0.8, 0.7, 0.6 (the
      narrower stacked block at each size too): the first place that touches nothing and stands by the token wins;
   3. else the nearest place anywhere in the free part that touches nothing, at the biggest of those sizes (before: the block kept
      shrinking by the token down to 0.4-0.45: the far-view speck of ADVX 4, where every place by a tiny token touches a neighbour);
   4. else the place that covers the least, weighed: the roller and the roll's targets 50, tokens 10, panels 20, a pin 1.
   "By the token" = within half the block's smaller side (or three gaps) of it: at the far view a few px of board is the whole room. */
export const F_STEPS = Object.freeze([1, 0.9, 0.8, 0.7, 0.6]);
export function composeMoment(items, frame, measure = estimateBox) {
  const safe = frame.safe, vh = frame.vh || 768, sc = frame.scale || 1;
  const safeW = Math.max(120, Math.min(safe.r - safe.l, frame.freeW ?? Infinity)), safeH = Math.max(120, Math.min(safe.b - safe.t, frame.freeH ?? Infinity));
  const T = frame.token;
  const canStack = items.some(it => it.role === 'six' || it.role === 'wreck');
  let f0 = 1;
  for (let pass = 0; pass < 8; pass++) {
    const o = layoutAt(items, frame, measure, f0, safeW, vh, sc, false);
    const k = Math.min(1, (safeW - 4) / (o.rect.r - o.rect.l), (safeH - 4) / (o.rect.b - o.rect.t));
    if (k >= 0.999 || f0 < 0.25) break;
    f0 *= k * 0.97;
  }
  if (!(frame.avoid?.length || T)) { const o = layoutAt(items, frame, measure, f0, safeW, vh, sc, false); place(o, frame); o.clean = true; return o; }
  /* a word row (the word and its sixes side by side) wider than the free part even at its floors stands only stacked */
  const wideOk = !canStack || (() => { const o = layoutAt(items, frame, measure, f0, safeW, vh, sc, false); return o.rect.r - o.rect.l <= safeW + 1; })();
  const tries = [];
  for (const k of F_STEPS) for (const stack of canStack ? (wideOk ? [false, true] : [true]) : [false]) tries.push([f0 * k, stack]);
  let best = null;
  const keep = (o) => { if (!best || o.hit < best.hit - 0.5) best = o; };
  const byT = (o) => !T || detached(o.rect, T, frame) <= 0;
  /* clean: nothing covered but a pin's speck (a pin weighs 1, a token 10 or 50: HIT_EPS of the frame's height squared is a few px of a
     token's rim at most) */
  const clean = (o) => o.hit <= HIT_EPS * vh * vh;
  /* MAPSEAT: in the wide window a split block counts only while its two parts stand together: the gap between the head and the caption no
     more than SPLIT_GAP of the taller part's height (live, The Warehouse crowd: the caption 3900 scene px from its word, on no seat's view) */
  const tog = (o) => !frame.together || !splitApart(o);
  const whole = (far, list = items) => {
    const seen = new Set();
    for (const [f, stack] of tries) {
      const o = layoutAt(list, frame, measure, f, safeW, vh, sc, stack);
      const sig = stack + ':' + Math.round(o.rect.r - o.rect.l) + 'x' + Math.round(o.rect.b - o.rect.t);
      if (seen.has(sig)) continue;   // every part at its floor already: the same block again
      seen.add(sig);
      place(o, frame, far);
      if (clean(o) && tog(o) && (far || byT(o))) return o;
      keep(o);
    }
    return null;
  };
  /* the block in two (CRITPEAK): the HEAD (the grunt, the word, the wreck) and the CAPTION (the sixes, the sentence, the odds, the stress
     and its gauge), each placed clean on its own side of what it describes, the caption off the head: a critical frames the struck pair
     with its word above and its caption below when no single place holds the whole block (live, The Warehouse at 0.8: two tokens side by
     side leave a 256 px band above and a 156 px band below; the whole critical block is 370 px tall) */
  const split = (far, list = items) => {
    for (const roles of [HEAD_ROLES, HEAD_SIX]) { const o = splitBy(far, list, roles); if (o) return o; }
    return null;
  };
  const splitBy = (far, list, roles) => {
    const head = list.filter(it => roles.has(it.role)), tail = list.filter(it => !roles.has(it.role));
    if (!head.length || !tail.length || (roles === HEAD_SIX && !head.some(it => it.role === 'six'))) return null;
    for (const [f, stack] of tries) {
      const a = layoutAt(head, frame, measure, f, safeW, vh, sc, stack);
      place(a, frame, far);
      const fb = { ...frame, avoid: [...(frame.avoid ?? []), { ...a.rect, w: TOKEN_W }] };
      let b = null;
      for (const st of [false, true]) {   // the caption on one row, or the sentence over its figure when the row finds no room
        const b1 = layoutAt(tail, fb, measure, f, safeW, vh, sc, st);
        /* without a token (a full critical) the caption is sought right under its head, then over it, before anywhere round the focus */
        const g0 = frame.gap ?? 6, th = b1.rect.b - b1.rect.t, hx = (a.rect.l + a.rect.r) / 2;
        const fb2 = T ? fb : { ...fb, focus: { x: hx, y: a.rect.b + g0 + th / 2 }, under: a.rect.b + g0 };
        place(b1, fb2, far);
        if (!T && b1.hit > 0.5) { const b2 = layoutAt(tail, fb, measure, f, safeW, vh, sc, st); place(b2, { ...fb, focus: { x: hx, y: a.rect.t - g0 - th / 2 }, under: a.rect.t - g0 - th }, far); if (b2.hit < b1.hit) Object.assign(b1, b2); }
        /* neither under nor over its head is free (a crowded board, live: The Warehouse at 0.45, GM's screen fallback): the caption anywhere
           in the view, before the head gives way onto the hero (the caption over a bystander's rim is the lesser cover) */
        if (!T && b1.hit > 0.5) { const b3 = layoutAt(tail, fb, measure, f, safeW, vh, sc, st); place(b3, fb, far); if (b3.hit < b1.hit) Object.assign(b1, b3); }
        if (!b || b1.hit < b.hit) b = b1;
        if (clean(b) && (far || byT(b))) break;
      }
      const r = { l: Math.min(a.rect.l, b.rect.l), t: Math.min(a.rect.t, b.rect.t), r: Math.max(a.rect.r, b.rect.r), b: Math.max(a.rect.b, b.rect.b) };
      /* CALLERS2: the split block keeps its parts' standing footprint (per side, the larger of the two) for a seat's own panels (localFix) */
      const ff = (a.foot || b.foot) ? Object.fromEntries(['l', 't', 'r', 'b'].map(k => [k, Math.max(a.foot?.[k] ?? 0, b.foot?.[k] ?? 0)])) : null;
      const o = { items: [...a.items, ...b.items], rect: r, parts: [a.rect, b.rect], gauge: b.gauge ?? a.gauge, f, side: a.side, hit: a.hit + b.hit, heavy: (a.heavy ?? 0) + (b.heavy ?? 0), split: true, ...(ff ? { foot: ff } : {}) };
      if (clean(o) && tog(o) && (far || (byT(a) && byT(b)))) return o;
      keep(o);   // the least covering of all, when nothing is clean
    }
    return null;
  };
  /* a board with no clean place for the critical at its floor: its word may come down to TIGHT_CRIT of that floor (still over any strong
     roll's floor) before the block stands on a token */
  const tight = items.some(it => it.rank === 'critical') ? items.map(it => (it.rank === 'critical' && it.min ? { ...it, min: it.min * TIGHT_CRIT } : it)) : null;
  const found = whole(false) ?? split(false) ?? (tight && (whole(false, tight) ?? split(false, tight))) ?? whole(true) ?? split(true) ?? (tight && (whole(true, tight) ?? split(true, tight)));
  if (found) { found.clean = true; return found; }
  /* MAPSEAT (CRITPEAK-9: on a crowded board the critical lay over a bystander's edge): the map's board window holds no clean place for the
     block: it is sought again in the WIDER shared window (frame.wide, the same on every seat) before it lies on anyone. A seat whose view
     does not show that place plays the moment on its screen layer (same-picture.mjs mapSeat) */
  if (frame.wide && best && coverMax(best, frame) > RIM_OK) {
    const o = composeMoment(items, { ...frame, safe: frame.wide, wide: null, together: true, boardWin: frame.safe }, measure);
    /* only a block that still stands together (splitApart; the inner pass may hand back its least-covering split, apart or not) */
    if (o && !splitApart(o) && coverMax(o, frame) < coverMax(best, frame)) { o.wide = true; return o; }
  }
  /* CALLERS2: no clean place for the block with its standing ink (the footprint spacing and the footprint off what it describes): a clean
     place for its letters' outline (as before the footprint was counted) beats lying on a token or a panel with the whole word (live
     harness, a player's critical on a crowded board: with the footprint the least-covering block stood on a bystander and the party cards
     at full size; the outline-clean block is the one shown before). Only then the least covering one */
  if (!frame.bare && items.some(it => measure(it, 40)?.room)) {
    const o = composeMoment(items, { ...frame, bare: true }, measure);
    if (o?.clean) { o.bare = true; return o; }
    /* neither is clean: the one whose letters cover least, of the three: with the footprint, its outline with the footprint's spacing, and
       the outline alone as before the footprint was counted (live harness, the GM's critical on a crowded board: the least-covering block
       with the footprint put 3 SIXES' letters 42 px onto a bystander; the block shown before only grazed its own words) */
    const o0 = composeMoment(items, { ...frame, bare: true }, (it, S) => { const { room, ...b } = measure(it, S); return b; });
    let pick = best, ph = best ? letterHits(best, frame) : Infinity;
    for (const c of [o, o0]) if (c && letterHits(c, frame) < ph - 0.5) { pick = c; ph = letterHits(c, frame); }
    if (pick !== best) pick.bare = true;
    return pick;
  }
  return best;
}
/* CALLERS2: what a block's letters (each item's box, no footprint) cover of the frame's obstacles and token (the token weighs TOKEN_W) */
function letterHits(o, frame) {
  const T = frame.token, g = frame.gap ?? 6;
  let h = 0;
  for (const it of o.items ?? []) {
    if (it.x == null) continue;
    const q = { l: it.x - it.w / 2, t: it.y - it.h / 2, r: it.x + it.w / 2, b: it.y + it.h / 2 };
    h += blockHits(q, frame.avoid ?? []) + (T ? area(q, { l: T.l - g + 1, t: T.t - g + 1, r: T.r + g - 1, b: T.b + g - 1 }) * TOKEN_W : 0);
  }
  return h;
}
/* MAPSEAT: a block that touches a token's box by at most RIM_OK of it (its rim, a few px of the art's edge) does not lie on it */
export const RIM_OK = 0.02;
/* MAPSEAT: a split block whose head and caption stand more than SPLIT_GAP of the taller part's height apart (provisional MAPSEAT-3) */
export const SPLIT_GAP = 1;
export function splitApart(o) {
  if (!o?.parts) return false;
  const [a, b] = o.parts, gx = Math.max(0, a.l - b.r, b.l - a.r), gy = Math.max(0, a.t - b.b, b.t - a.b);
  return Math.hypot(gx, gy) > SPLIT_GAP * Math.max(a.b - a.t, b.b - b.t);
}
/* the largest share of any token's box (the frame's token and every token obstacle) the block's parts cover */
export function coverMax(o, frame) {
  const boxes = [frame.token, ...(frame.avoid ?? []).filter((a) => (a.w ?? 1) >= OTHER_W)].filter(Boolean);
  let worst = 0;
  for (const q of boxes) {
    const A = Math.max(1, (q.r - q.l) * (q.b - q.t));
    let c = 0;
    for (const it of o.items ?? []) c += area({ l: it.x - it.w / 2, t: it.y - it.h / 2, r: it.x + it.w / 2, b: it.y + it.h / 2 }, q);
    worst = Math.max(worst, c / A);
  }
  return worst;
}
export const TIGHT_CRIT = 0.85;
export const HIT_EPS = 0.0002;
/* the parts of a block that stay together when it is split (CRITPEAK): the rest is its caption */
export const HEAD_ROLES = new Set(['pre', 'word', 'wreck']);
export const HEAD_SIX = new Set(['pre', 'word', 'wreck', 'six']);   // the sixes with the word, when the caption alone finds room   // the sixes open the caption (a wide head row stuck out of the view)
/* how far the block stands off the token beyond its room (0: it stands by the token). The room: three gaps, or half the block's smaller
   side (CRITPEAK: at the far view the gap is a few px and every clean place counted as "away", so the block shrank to a speck) */
export function detached(rect, T, frame) {
  const dx = Math.max(0, T.l - rect.r, rect.l - T.r), dy = Math.max(0, T.t - rect.b, rect.t - T.b);
  const room = Math.max(3 * (frame.gap ?? 6), Math.min(0.5 * Math.min(rect.r - rect.l, rect.b - rect.t), 0.6 * (T.r - T.l)));   // CRITPEAK: a big block a little further, never past 0.6 of the token
  return Math.max(0, Math.hypot(dx, dy) - room);
}
/* CRITPEAK: one lettering's size at layout shrink f: its nominal size (cap x the frame's height: the reference window on screen, the
   board's GRID_VH squares on the map, held within 1..MAP_MAX of the nominal SCREEN size: frame units = screen px x px), never under its
   rank's floor (scaled alike) nor the pixel floor ON SCREEN. frame: { vh, ref (the reference height, px), px (frame units per screen px),
   maxK, scale } */
export function sizeOf(it, frame, f = 1) {
  const vh = frame.vh || 768, sc = frame.scale || 1, ref = frame.ref ?? vh, px = frame.px ?? 1;
  const cap = it.cap ?? 0.04;
  /* m: the board's size against the screen rule: on the map the board height (vh) over the reference height at this zoom, held to 1..maxK
     (the far view letters as the screen does, a close view at most maxK bigger); ONE factor for the whole block, so the floors scale with it
     and the ranks stay apart (a per-item clamp put an ordinary word at the map's ceiling against a strong word at its floor) */
  const m = frame.maxK ? clamp(vh / (ref * px), 1, frame.maxK) : vh / ref;
  const base = cap * ref * px * m * sc;
  const lo = Math.max((FLOOR[it.role] ?? 16) * px, (it.min ?? 0) * ref * px * m) * sc;
  return { S: Math.max(lo, base * f), lo, base };
}
/* CALLERS2 (engine 1.9.18, L.measure standBox): what a lettering needs past its hold box on each side, in px at S px per cap: its STANDING
   footprint as the engine measures it at that size (m.footAt(S) -> { l, r, u, d } caps past the hold box: hold poses and turns, the life of
   a held word, keyline, the map's ink rim, the coloured duplicate block, hold extras; stage.mjs asks L.measure, this module mirrors none of
   the engine's tables) and its entrance reach (m.reach, caps from the centre; kept for the record, CALLERS-2).
   m = { w, h, reach?, footAt? } -> { room: { stand: { l, r, u, d } px, l, r, u, d } } or {} */
export function roomOf(m, S) {
  if (!(S > 0) || typeof m?.footAt !== "function") return {};
  const f = m.footAt(S);
  if (!f) return {};
  const st = { l: Math.max(0, f.l * S), r: Math.max(0, f.r * S), u: Math.max(0, f.u * S), d: Math.max(0, f.d * S) };
  const hw = m.w * S / 2, hh = m.h * S / 2, re = m.reach ?? { l: 0, r: 0, u: 0, d: 0 };
  return { room: { stand: st, l: Math.max(st.l, re.l * S - hw), r: Math.max(st.r, re.r * S - hw), u: Math.max(st.u, re.u * S - hh), d: Math.max(st.d, re.d * S - hh) } };
}
function layoutAt(items, frame, measure, f, safeW, vh, sc, stack = false) {
  const sized = items.map(it => {
    const z = sizeOf(it, frame, f);
    let S = z.S;
    let b = measure(it, S);
    /* too wide for its share: narrower, but not under its floor unless the floor itself is wider than the free part (CRITPEAK) */
    const wMax = (it.wMax ?? 0.6) * safeW;
    /* the floor itself gives way only to the free width, measured on the entrance's biggest drawing (the slam's smear grows the word: ADVI 11,
       CRUSH! left the screen) */
    const gw = Math.max(1, Number(b.grow) || 1);   // CALLERS: the measured reach, when there is one
    if (b.w > wMax || b.w * gw > safeW - 8) { const k = wMax / b.w, kAll = (safeW - 8) / (b.w * gw); S = Math.min(Math.max(S * k, Math.min(z.lo, S * kAll)), S * Math.min(1, kAll)); b = measure(it, S); }
    if (it.wMin && b.w < it.wMin * safeW * f) {   // the critical word fills its share of the screen even when it is short
      const S2 = Math.min(S * (it.wMin * safeW * f) / b.w, 1.15 * z.base * f);
      if (S2 > S) { S = S2; b = measure(it, S); }
    }
    return { ...it, S: Math.round(S * 10) / 10, w: b.w, h: b.h, grow: Math.max(1, Number(b.grow) || 1), room: b.room ?? null };
  });
  const get = r => sized.find(x => x.role === r);
  const word = get('word'), pre = get('pre'), six = get('six'), wreck = get('wreck'), sayI = get('say'), odds = get('odds'), stress = get('stress');
  const unit = word ? word.S : (stress ? stress.S : 30);
  const g = Math.max(5, 0.16 * unit);                 // the gap between the parts of the block
  const pad = it => PAD * it.S;
  /* rows, top to bottom; x relative to the word's centre (0), y = the top of each row */
  let y = 0;
  const put = (it, x, top) => { it.x = x; it.y = top + it.h / 2; };
  /* CALLERS2 (engine 1.9.18, L.measure stand): a part's standing ink reaches past its hold box (a caption's sticker outline and its coloured
     block reach ~0.45 cap down and right): the parts are spaced so that no part's ink lands on another's letters. Each next row keeps at
     least the upper row's ink below it plus its own ink above it (+1 px) from the row above (the two inks never meet: each moves with its
     own life); side by side the same with the ink to the right and left. Without a measured footprint (no engine) nothing changes */
  const ink = (it, k) => Math.max(0, Number(it?.room?.stand?.[k]) || 0);
  let last = null, used = 0;
  const bump = (row) => { row = row.filter(Boolean); if (last && row.length) { const need = Math.max(...last.map(it => ink(it, 'd'))) + Math.max(...row.map(it => ink(it, 'u'))) + 1; if (need > used) y += need - used; } };
  const ended = (row, gap) => { last = row.filter(Boolean); used = gap; };
  const sideGap = (a, b, have) => Math.max(have, ink(a, 'r') + ink(b, 'l') + 1);
  /* CRITPEAK: the push grunt has left before the result comes (planMoment: the word waits for its exit), so it stands IN the word's place,
     as big as the word row allows: a beat of its own where the eye already is, and the block one row shorter (ADVX 15: the pushed cluster
     was the tallest block and shrank most) */
  if (pre && !word) { put(pre, 0, y); y += pre.h + pad(pre) * 2 + g; ended([pre], pad(pre) * 2 + g); }
  /* the narrow block: the word alone on its row, the caption right under it, the wreck and the sixes on a row under that */
  const stackRow = () => {
    const row = [wreck, six].filter(Boolean);
    if (!row.length) return;
    bump(row);
    const gw = row.length === 2 ? sideGap(row[0], row[1], pad(row[0]) + g + pad(row[1])) - pad(row[0]) - pad(row[1]) : g;
    const w = row.reduce((s, it) => s + it.w + 2 * pad(it), 0) + gw * (row.length - 1), h = Math.max(...row.map(it => it.h));
    let x = -w / 2;
    for (const it of row) { it.x = x + pad(it) + it.w / 2; it.y = y + h - it.h / 2; x += it.w + 2 * pad(it) + gw; }
    y += h + g; ended(row, g);
  };
  if (word && stack) {
    bump([word]); put(word, 0, y);
    y += word.h + g + pad(word); ended([word], g + pad(word));
    /* FXI-SPLASH (ADVI 11: "4 SZOSTKI" stood under the caption): the block reads top-down in the order it lands: the word, the sixes
       (+230 ms), then the sentence and the odds (+360 / +460 ms) */
    stackRow();
  } else if (word) {
    bump([word, wreck, six]); put(word, 0, y);
    let right = word.w / 2, prev = word;
    if (wreck) { put(wreck, right + sideGap(word, wreck, g + pad(wreck)) + wreck.w / 2, y); right = wreck.x + wreck.w / 2; prev = wreck; }
    if (six) { const x = right + sideGap(prev, six, g * 0.6 + pad(six)) + six.w / 2; six.x = x; six.y = y + word.h - six.h / 2; }   // the stamp on the word's baseline, tight to its end
    /* the word row centred as a whole: shift every part left by half of what hangs to the right */
    const rowR = Math.max(word.w / 2, ...[wreck, six].filter(Boolean).map(it => it.x + it.w / 2)), shift = (rowR - word.w / 2) / 2;
    for (const it of [word, wreck, six].filter(Boolean)) it.x -= shift;
    y += word.h + g + pad(word); ended([word, wreck, six], g + pad(word));
  } else for (const it of [wreck, six].filter(Boolean)) { bump([it]); put(it, 0, y); y += it.h + g; ended([it], g); }   // a lone part still gets its row
  if (pre && word) { pre.x = word.x; pre.y = word.y + word.h / 2 - pre.h / 2; }   // on the word's baseline, centred on it
  /* the caption: sentence and figure on one row when they fit the word row's width (or 90 % of the free width), else stacked */
  const cap = [sayI, odds].filter(Boolean);
  if (cap.length) {
    const wordL = word ? word.x - word.w / 2 : -100, rowW = word ? Math.max(word.w, ...[wreck, six].filter(it => it && it.x != null).map(it => it.x + it.w / 2 - wordL)) : 0;
    const cg = cap.length === 2 ? sideGap(sayI, odds, g) : g;
    const inline = cap.length === 2 && sayI.w + cg + odds.w <= (stack ? rowW : Math.max(rowW, 0.9 * safeW));   // the narrow block keeps the caption to the word's width
    if (inline) {
      bump(cap);
      const w = sayI.w + cg + odds.w, h = Math.max(sayI.h, odds.h);
      /* under the word, indented a little from its left edge (a caption, not a centred label); wider than the word row: centred */
      const rowL = wordL, rowR = wordL + rowW;
      const L0 = !word || w >= rowW ? (word ? (rowL + rowR) / 2 : 0) - w / 2 : Math.min(rowL + 0.25 * unit, rowR - w);
      sayI.x = L0 + sayI.w / 2; sayI.y = y + h - sayI.h / 2;
      odds.x = L0 + sayI.w + cg + odds.w / 2; odds.y = y + h - odds.h / 2;
      y += h + g; ended(cap, g);
    } else for (const it of cap) { bump([it]); put(it, 0, y); y += it.h + g * 0.6; ended([it], g * 0.6); }
  }
  let gauge = null;
  if (stress) {
    /* the gauge shrinks with the block (live: a full-size gauge beside words shrunk to 0.6), never under a readable scale (CRITPEAK, ADVX 15) */
    const gMin = frame.gaugeMin ?? GAUGE_MIN, gk = clamp(f, gMin, Math.max(gMin, frame.gaugeMax ?? 1));
    const gw = (frame.gauge?.w ?? 0) * gk, gh = (frame.gauge?.h ?? 0) * gk;
    bump([stress]);
    const w = stress.w + (gw ? g + gw : 0), h = Math.max(stress.h, gh);
    stress.x = -w / 2 + stress.w / 2; stress.y = y + h / 2;
    if (gw) gauge = { x: -w / 2 + stress.w + g, y: y + h / 2 - gh / 2, w: gw, h: gh, k: gk };   // top-left of the DOM gauge; k: its scale
    y += h;
  }
  const rect = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity }, fr = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
  for (const it of sized) {
    if (it.x == null) continue;
    /* FXI-SPLASH (ADVI 11): the block's outline holds each part's biggest entrance drawing too (the slam's smear grows the word 1.6-1.8x
       around its centre for a tick or two: live it crossed the left bar and left the screen); the parts' spacing stays the hold's (the
       captions come after the entrance is over) */
    const p = pad(it), px = Math.max(p, (it.grow - 1) / 2 * it.w + p * 0.5), py = Math.max(p, (it.grow - 1) / 2 * it.h + p * 0.5);
    rect.l = Math.min(rect.l, it.x - it.w / 2 - px); rect.r = Math.max(rect.r, it.x + it.w / 2 + px);
    rect.t = Math.min(rect.t, it.y - it.h / 2 - py); rect.b = Math.max(rect.b, it.y + it.h / 2 + py);
    /* CALLERS: with the engine's measure, each part's STANDING footprint (the life of a held word + the map's ink rim: drawn for its whole
       hold) is kept off the tokens, pins and panels (place: foot). The outline itself (the view's edge, the seat rule, the panels a seat
       steps back) stays the letters' as before: a rim a few px past a seat's view edge must not send that seat to its screen layer. The
       entrance's full reach (a whoosh sweeps in from the side, 1.7 caps past the biggest pose) is NOT added: an entrance passes over things
       for a few frames (provisional, CALLERS-2) */
    const st = it.room?.stand ?? { l: 0, r: 0, u: 0, d: 0 };   // CALLERS2: per side (a duplicate block reaches right and down)
    fr.l = Math.min(fr.l, it.x - it.w / 2 - Math.max(px, st.l)); fr.r = Math.max(fr.r, it.x + it.w / 2 + Math.max(px, st.r));
    fr.t = Math.min(fr.t, it.y - it.h / 2 - Math.max(py, st.u)); fr.b = Math.max(fr.b, it.y + it.h / 2 + Math.max(py, st.d));
  }
  if (gauge) { rect.l = Math.min(rect.l, gauge.x); rect.r = Math.max(rect.r, gauge.x + gauge.w); rect.b = Math.max(rect.b, gauge.y + gauge.h); }
  const foot = Number.isFinite(fr.l) ? { l: Math.max(0, rect.l - fr.l), t: Math.max(0, rect.t - fr.t), r: Math.max(0, fr.r - rect.r), b: Math.max(0, fr.b - rect.b) } : null;
  return { items: sized.filter(it => it.x != null), rect, gauge, f, ...(foot && !frame.bare && (foot.l || foot.t || foot.r || foot.b) ? { foot } : {}) };
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
const SLIDE = [0, -0.15, 0.15, -0.3, 0.3, -0.45, 0.45, -0.6, 0.6, -0.75, 0.75, -0.9, 0.9, -1.05, 1.05, -1.2, 1.2];   // CRITPEAK: finer (a floored caption needs the gap between two neighbours)
const SIDE_COST = { above: 0, below: 0.15, right: 0.3, left: 0.35 };
/* CRITPEAK: what a hit weighs (blockHits: area x w): the token the block describes and the roll's targets 50, other tokens 10 (heavy),
   a panel 20 (stage.mjs UI_WEIGHT), a map pin 1 (it may give way when nothing else can) */
export const TOKEN_W = 50, TARGET_W = 50, OTHER_W = 10;
function place(out, frame, far = false) {
  const safe = frame.safe, r = out.rect, bw = r.r - r.l, bh = r.b - r.t;
  const T = frame.token, avoid = frame.avoid ?? [];
  const at = (l, t) => ({ l, t, r: l + bw, b: t + bh });
  const inSafe = (l, t) => [clamp(l, safe.l, Math.max(safe.l, safe.r - bw)), clamp(t, safe.t, Math.max(safe.t, safe.b - bh))];
  let best = null, side = 'focus';
  /* the score: anything touched first (the token four times as bad), then the distance from the token (or the focus) in block sizes
     plus a small preference of the sides (above, below, right, left) */
  const ref = T ? { x: T.x, y: T.y } : frame.focus, unit = Math.max(1, Math.hypot(bw, bh));
  const ft = out.foot ?? null;   // CALLERS: the standing footprint past the outline (rim + life), kept off what the block must not cover
  const consider = (s, l, t, pref) => {
    [l, t] = inSafe(l, t);
    const q0 = at(l, t), q = ft ? { l: q0.l - ft.l, t: q0.t - ft.t, r: q0.r + ft.r, b: q0.b + ft.b } : q0, onT = T ? area(q, { l: T.l - (frame.gap ?? 6) + 1, t: T.t - (frame.gap ?? 6) + 1, r: T.r + (frame.gap ?? 6) - 1, b: T.b + (frame.gap ?? 6) - 1 }) : 0;
    const hit = blockHits(q, avoid) + onT * TOKEN_W, heavy = onT + blockHits(q, avoid.filter(a => (a.w ?? 1) >= 10));
    const d = Math.hypot(l + bw / 2 - ref.x, t + bh / 2 - ref.y) / unit;
    const score = (hit > 0.5 ? 1e6 + hit : 0) + d + pref;
    if (!best || score < best.score) best = { s, l, t, hit, heavy, score };
  };
  if (T) {
    const gap = frame.gap ?? 6;
    const fo = ft ?? { l: 0, t: 0, r: 0, b: 0 };   // CALLERS: the footprint stands off the token too
    const cand = [
      ['above', T.x - bw / 2, T.t - gap - bh - fo.b, 'x'],
      ['below', T.x - bw / 2, T.b + gap + fo.t, 'x'],
      ['right', T.r + gap + fo.l, T.y - bh / 2, 'y'],
      ['left', T.l - gap - bw - fo.r, T.y - bh / 2, 'y']
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
      for (let gy = 0; gy <= 12; gy++) for (let gx = 0; gx <= 12; gx++) consider('focus', safe.l + gx / 12 * (W - bw), safe.t + gy / 12 * (H - bh), 1);
    }
  } else {
    const W = safe.r - safe.l, H = safe.b - safe.t;
    /* a caption sought along its head's edge (composeMoment, split): slid sideways first, then the focus grid */
    if (frame.under != null) {
      for (const k of SLIDE) consider('focus', frame.focus.x - bw / 2 + k * bw, frame.under, -1);
      for (const q of avoid) { consider('focus', q.r + 2, frame.under, -1); consider('focus', q.l - 2 - bw, frame.under, -1); }   // just clear of each obstacle
    }
    for (const dy of [0, -0.12, 0.12, -0.24, 0.24, -0.36, 0.36]) for (const dx of [0, -0.15, 0.15, -0.3, 0.3, -0.45, 0.45]) consider('focus', frame.focus.x - bw / 2 + dx * W, frame.focus.y - bh / 2 + dy * H, 0);
    if (far && best.hit > 0.5) for (let gy = 0; gy <= 12; gy++) for (let gx = 0; gx <= 12; gx++) consider('focus', safe.l + gx / 12 * (W - bw), safe.t + gy / 12 * (H - bh), 0.5);
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
export function localFix(out, frame, local0, std, recompose) {
  if (!out?.rect || !Number.isFinite(out.rect.l)) return { out, moved: 'none' };
  /* CALLERS2 (CALLERS-3 decided by the standard: lettering never covers a panel): this seat's own panels are kept off the block's standing
     ink (out.foot: the life of a held word and the outline round the letters, per side), not only off its letters' outline. Done by
     growing each panel by the footprint (a rect grown by foot meets panel q exactly when the rect meets q grown the other way), and the
     view (this seat's and the standard one) shrunk by it: the view's edge is where the panels round it begin (live harness: the GM's chat
     card began 2 px past the standard view, and the odds' rim stood 7 px on it) */
  const ft = out.foot;
  const local = ft && local0 ? { ...local0, safe: local0.safe ? insetBy(local0.safe, ft) : local0.safe, avoid: (local0.avoid ?? []).map(q => ({ ...q, l: q.l - ft.r, t: q.t - ft.b, r: q.r + ft.l, b: q.b + ft.t })) } : local0;
  std = ft && std ? insetBy(std, ft) : std;
  /* CRITPEAK: a split block (head and caption apart, composeMoment) is judged by its PARTS: the union of the two stands on the very tokens
     they frame, so a guard on the union shrank both onto the roller (the shared-hit base was the union's own cover) */
  const parts = out.parts?.length ? out.parts : [out.rect];
  if (parts.every(q => cleanHere(q, std, local))) return { out, moved: 'none' };
  const r = out.rect, T = frame.token, gp = frame.gap ?? 6;
  const hit1 = q => blockHits(q, frame.avoid ?? []) + (T ? area(q, { l: T.l - gp + 1, t: T.t - gp + 1, r: T.r + gp - 1, b: T.b + gp - 1 }) * TOKEN_W : 0);
  const tf = (q, d, k = 1, ax = 0, ay = 0) => ({ l: ax + (q.l - ax) * k + d.dx, t: ay + (q.t - ay) * k + d.dy, r: ax + (q.r - ax) * k + d.dx, b: ay + (q.b - ay) * k + d.dy });
  const sharedHit = (d, k, ax, ay) => parts.reduce((s, q) => s + hit1(tf(q, d, k, ax, ay)), 0);
  const costHere = (d, k, ax, ay) => parts.reduce((s, q) => s + localCost(tf(q, d, k, ax, ay), local), 0);
  const base = sharedHit({ dx: 0, dy: 0 }, 1, 0, 0);
  /* the shifts that could clear the parts (scaled by k about ax, ay): into the view, then off each panel a part touches (the four ways out,
     each brought back into view) */
  const shiftsFor = (k, ax, ay) => {
    const ps = parts.map(q => tf(q, { dx: 0, dy: 0 }, k, ax, ay));
    const u = { l: Math.min(...ps.map(q => q.l)), t: Math.min(...ps.map(q => q.t)), r: Math.max(...ps.map(q => q.r)), b: Math.max(...ps.map(q => q.b)) };
    const tries = [shiftInto(u, local.safe ?? u)];
    for (const rq of ps) for (const q of local.avoid ?? []) {
      if (!area(rq, q)) continue;
      for (const d of [{ dx: q.l - rq.r - 2, dy: 0 }, { dx: q.r - rq.l + 2, dy: 0 }, { dx: 0, dy: q.t - rq.b - 2 }, { dx: 0, dy: q.b - rq.t + 2 }]) {
        tries.push(d);
        const m = { l: u.l + d.dx, t: u.t + d.dy, r: u.r + d.dx, b: u.b + d.dy }, s1 = shiftInto(m, local.safe ?? m);
        tries.push({ dx: d.dx + s1.dx, dy: d.dy + s1.dy });
      }
    }
    return tries.sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy));
  };
  const apply = (d, k, ax, ay) => {
    const mv = (x, a0, dd) => Math.round(a0 + (x - a0) * k + dd);
    for (const it of out.items) { it.x = mv(it.x, ax, d.dx); it.y = mv(it.y, ay, d.dy); if (k !== 1) { it.S = Math.round(it.S * k * 10) / 10; it.w *= k; it.h *= k; } }
    if (out.gauge) { out.gauge.x = mv(out.gauge.x, ax, d.dx); out.gauge.y = mv(out.gauge.y, ay, d.dy); if (k !== 1) { out.gauge.w *= k; out.gauge.h *= k; out.gauge.k = (out.gauge.k ?? 1) * k; } }
    out.rect = tf(r, d, k, ax, ay);
    if (out.parts) out.parts = out.parts.map(q => tf(q, d, k, ax, ay));
    if (k !== 1) out.f = (out.f ?? 1) * k;
  };
  for (const d of shiftsFor(1, 0, 0)) {
    if (costHere(d, 1, 0, 0) > 1 || sharedHit(d, 1, 0, 0) > base + 0.5) continue;
    apply(d, 1, 0, 0);
    return { out, moved: 'shift', d };
  }
  /* then the same picture a little smaller, about its point nearest the token (or the focus), shifted in: same side, same order, only the
     size differs (a seat with a much smaller window: closer to the shared picture than another side would be) */
  const ref = T ? { x: T.x, y: T.y } : frame.focus ?? { x: (r.l + r.r) / 2, y: (r.t + r.b) / 2 };
  const anchors = [[Math.max(r.l, Math.min(r.r, ref.x)), Math.max(r.t, Math.min(r.b, ref.y))], [(r.l + r.r) / 2, (r.t + r.b) / 2], [r.l, r.t], [r.r, r.t], [r.l, r.b], [r.r, r.b]];
  /* a split block (head and caption framing what they describe): each part shrinks about its point nearest the other part, so the gap
     between them (the roller, the target) stays clear; the two parts then move as one */
  if (parts.length === 2) {
    const ctr = (q) => ({ x: (q.l + q.r) / 2, y: (q.t + q.b) / 2 });
    const anc = parts.map((q, i) => { const o = ctr(parts[1 - i]); return [Math.max(q.l, Math.min(q.r, o.x)), Math.max(q.t, Math.min(q.b, o.y))]; });
    const pOf = (x, y) => { let bi = 0, bd = Infinity; parts.forEach((q, i) => { const dd = Math.hypot(Math.max(0, q.l - x, x - q.r), Math.max(0, q.t - y, y - q.b)); if (dd < bd) { bd = dd; bi = i; } }); return bi; };
    const tfp = (i, k, d) => tf(parts[i], d, k, anc[i][0], anc[i][1]);
    const hitP = (k, d) => tfp(0, k, d) && hit1(tfp(0, k, d)) + hit1(tfp(1, k, d));
    const costP = (k, d) => localCost(tfp(0, k, d), local) + localCost(tfp(1, k, d), local);
    for (const k of SHRINK_LOCAL) {
      const ps = [tfp(0, k, { dx: 0, dy: 0 }), tfp(1, k, { dx: 0, dy: 0 })];
      const u = { l: Math.min(ps[0].l, ps[1].l), t: Math.min(ps[0].t, ps[1].t), r: Math.max(ps[0].r, ps[1].r), b: Math.max(ps[0].b, ps[1].b) };
      const tries = [{ dx: 0, dy: 0 }, shiftInto(u, local.safe ?? u)];
      for (const rq of ps) for (const q of local.avoid ?? []) {   // off each of this seat's panels a part touches, brought back into view
        if (!area(rq, q)) continue;
        for (const d0 of [{ dx: q.l - rq.r - 2, dy: 0 }, { dx: q.r - rq.l + 2, dy: 0 }, { dx: 0, dy: q.t - rq.b - 2 }, { dx: 0, dy: q.b - rq.t + 2 }]) {
          const m = { l: u.l + d0.dx, t: u.t + d0.dy, r: u.r + d0.dx, b: u.b + d0.dy }, s1 = shiftInto(m, local.safe ?? m);
          tries.push(d0, { dx: d0.dx + s1.dx, dy: d0.dy + s1.dy });
        }
      }
      tries.sort((p1, p2) => Math.hypot(p1.dx, p1.dy) - Math.hypot(p2.dx, p2.dy));
      let d = tries.find(s => costP(k, s) <= 1 && hitP(k, s) <= base + 0.5);   // no worse than the shared picture
      let dd = d ? [d, d] : null;
      /* or the one part a panel of this seat covers moves off it alone (the other stays): each keeps its side of what it describes */
      if (!dd) for (const i of [0, 1]) {
        const own = [shiftInto(ps[i], local.safe ?? ps[i])];
        for (const q of local.avoid ?? []) if (area(ps[i], q)) own.push({ dx: q.l - ps[i].r - 2, dy: 0 }, { dx: q.r - ps[i].l + 2, dy: 0 }, { dx: 0, dy: q.t - ps[i].b - 2 }, { dx: 0, dy: q.b - ps[i].t + 2 });
        own.sort((p1, p2) => Math.hypot(p1.dx, p1.dy) - Math.hypot(p2.dx, p2.dy));
        const z = { dx: 0, dy: 0 };
        for (const di of own) {
          const pair = i === 0 ? [di, z] : [z, di], qa = tfp(0, k, pair[0]), qb = tfp(1, k, pair[1]);
          if (area(qa, qb) || localCost(qa, local) + localCost(qb, local) > 1 || hit1(qa) + hit1(qb) > base + 0.5) continue;
          dd = pair; break;
        }
        if (dd) break;
      }
      if (!dd) continue;
      d = dd[0];
      const mv = (x, a0, d1) => Math.round(a0 + (x - a0) * k + d1);
      for (const it of out.items) { const i = pOf(it.x, it.y); it.x = mv(it.x, anc[i][0], dd[i].dx); it.y = mv(it.y, anc[i][1], dd[i].dy); it.S = Math.round(it.S * k * 10) / 10; it.w *= k; it.h *= k; }
      if (out.gauge) { const i = pOf(out.gauge.x, out.gauge.y); out.gauge.x = mv(out.gauge.x, anc[i][0], dd[i].dx); out.gauge.y = mv(out.gauge.y, anc[i][1], dd[i].dy); out.gauge.w *= k; out.gauge.h *= k; out.gauge.k = (out.gauge.k ?? 1) * k; }
      out.parts = [tfp(0, k, dd[0]), tfp(1, k, dd[1])];
      out.rect = { l: Math.min(out.parts[0].l, out.parts[1].l), t: Math.min(out.parts[0].t, out.parts[1].t), r: Math.max(out.parts[0].r, out.parts[1].r), b: Math.max(out.parts[0].b, out.parts[1].b) };
      out.f = (out.f ?? 1) * k;
      return { out, moved: 'shrink', k, d };
    }
  }
  for (const k of SHRINK_LOCAL) for (const [ax, ay] of (T && !out.parts ? anchors.slice(0, 1) : anchors)) {
    const d = shiftsFor(k, ax, ay).find(s => costHere(s, k, ax, ay) <= 1 && sharedHit(s, k, ax, ay) <= base + 0.5);
    if (!d) continue;
    apply(d, k, ax, ay);
    return { out, moved: 'shrink', k, d };
  }
  const o2 = recompose ? recompose() : null;
  return o2 ? { out: o2, moved: 'layout' } : { out, moved: 'none' };
}
/* a rect less a footprint {l, t, r, b} (never inside out: a footprint wider than the rect leaves its centre line) */
function insetBy(s, f) {
  const l = s.l + (f.l || 0), r = s.r - (f.r || 0), t = s.t + (f.t || 0), b = s.b - (f.b || 0);
  return { ...s, l: Math.min(l, (s.l + s.r) / 2), r: Math.max(r, (s.l + s.r) / 2), t: Math.min(t, (s.t + s.b) / 2), b: Math.max(b, (s.t + s.b) / 2) };
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
