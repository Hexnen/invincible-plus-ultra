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
  'STRAIN!': ['roar', 'effort'], 'EFFORT!': ['powerup', 'effort'], 'GRRR!': ['roar', 'snarl'], 'GAMBLE!': ['powerup', 'cheer'], 'FULL STRENGTH!': ['powerup', 'effort'],
  'RETRY!': ['powerup', 'cheer'], 'HNNNG!': ['roar', 'effort'], 'COMEBACK!': ['powerup', 'cheer'],
  /* wreck: what falls apart (WORDS4: the cave-in BTHOOM!, not the thunder's KRAKOOM!) */
  'WRECK!': ['crash', 'crash'], 'RUIN!': ['crash', 'crumble'], 'BTHOOM!': ['crash', 'crumble'], 'DEMOLITION!': ['crash', 'crash'],
  /* a pushed roll that still failed: the sound of it breaking (WORDS4: OUCH! -> the engine's pain sound GHAA!) */
  'SKRAK!': ['crack', 'crack'], 'TSKRIK!': ['crack', 'crack'], 'GHAA!': ['pain', 'pain']
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
/* CRITFREEZE (live, two seats: a critical's layout is ONE call of 0.15-0.45 s, the search below; laid out ahead while the dice roll it held
   the page for that long in one task: the picture froze 176-218 ms, then twice more for the layouts that follow it). The same search, cut
   into STEPS: composeMomentSteps is the search as a generator that hands the page back between its tries (one size or split tried per
   step); composeMoment runs it to its end in one go, as before. Whoever steps it (stage.mjs, a sliced prepare) gets the very same block:
   the steps only say where the work may pause, nothing is read between them that the search did not already hold. */
export function composeMoment(items, frame, measure = estimateBox) { return runSteps(composeMomentSteps(items, frame, measure)); }
export function runSteps(g) { let r; while (!(r = g.next()).done); return r.value; }
export function* composeMomentSteps(items, frame, measure = estimateBox) {
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
  yield;
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
  const whole = function* (far, list = items) {
    const seen = new Set();
    for (const [f, stack] of tries) {
      yield;
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
  const split = function* (far, list = items) {
    for (const roles of [HEAD_ROLES, HEAD_SIX]) { const o = yield* splitBy(far, list, roles); if (o) return o; }
    return null;
  };
  const splitBy = function* (far, list, roles) {
    const head = list.filter(it => roles.has(it.role)), tail = list.filter(it => !roles.has(it.role));
    if (!head.length || !tail.length || (roles === HEAD_SIX && !head.some(it => it.role === 'six'))) return null;
    for (const [f, stack] of tries) {
      yield;
      const a = layoutAt(head, frame, measure, f, safeW, vh, sc, stack);
      place(a, frame, far);
      const fb = { ...frame, avoid: [...(frame.avoid ?? []), { ...a.rect, w: PART_W }] };   // SPLASHBLOCK: the caption never on its own word
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
        yield;
      }
      const r = { l: Math.min(a.rect.l, b.rect.l), t: Math.min(a.rect.t, b.rect.t), r: Math.max(a.rect.r, b.rect.r), b: Math.max(a.rect.b, b.rect.b) };
      /* CALLERS2: the split block keeps its parts' standing footprint (per side, the larger of the two) for a seat's own panels (localFix) */
      const ff = (a.foot || b.foot) ? Object.fromEntries(['l', 't', 'r', 'b'].map(k => [k, Math.max(a.foot?.[k] ?? 0, b.foot?.[k] ?? 0)])) : null;
      const o = { items: [...a.items, ...b.items], rect: r, parts: [a.rect, b.rect], partFeet: [a.foot ?? null, b.foot ?? null], gauge: b.gauge ?? a.gauge, f, side: a.side, hit: a.hit + b.hit, heavy: (a.heavy ?? 0) + (b.heavy ?? 0), split: true, ...(ff ? { foot: ff } : {}) };
      if (clean(o) && tog(o) && (far || (byT(a) && byT(b)))) return o;
      keep(o);   // the least covering of all, when nothing is clean
    }
    return null;
  };
  /* a board with no clean place for the critical at its floor: its word may come down to TIGHT_CRIT of that floor (still over any strong
     roll's floor) before the block stands on a token */
  const tight = items.some(it => it.rank === 'critical') ? items.map(it => (it.rank === 'critical' && it.min ? { ...it, min: it.min * TIGHT_CRIT } : it)) : null;
  const found = (yield* whole(false)) ?? (yield* split(false)) ?? (tight && ((yield* whole(false, tight)) ?? (yield* split(false, tight)))) ?? (yield* whole(true)) ?? (yield* split(true)) ?? (tight && ((yield* whole(true, tight)) ?? (yield* split(true, tight))));
  if (found) { found.clean = true; return found; }
  /* MAPSEAT (CRITPEAK-9: on a crowded board the critical lay over a bystander's edge): the map's board window holds no clean place for the
     block: it is sought again in the WIDER shared window (frame.wide, the same on every seat) before it lies on anyone. A seat whose view
     does not show that place plays the moment on its screen layer (same-picture.mjs mapSeat) */
  if (frame.wide && best && coverMax(best, frame) > RIM_OK) {
    const o = yield* composeMomentSteps(items, { ...frame, safe: frame.wide, wide: null, together: true, boardWin: frame.safe }, measure);
    /* only a block that still stands together (splitApart; the inner pass may hand back its least-covering split, apart or not) */
    if (o && !splitApart(o) && coverMax(o, frame) < coverMax(best, frame)) { o.wide = true; return o; }
  }
  /* CALLERS2: no clean place for the block with its standing ink (the footprint spacing and the footprint off what it describes): a clean
     place for its letters' outline (as before the footprint was counted) beats lying on a token or a panel with the whole word (live
     harness, a player's critical on a crowded board: with the footprint the least-covering block stood on a bystander and the party cards
     at full size; the outline-clean block is the one shown before). Only then the least covering one */
  if (!frame.bare && items.some(it => measure(it, 40)?.room)) {
    const o = yield* composeMomentSteps(items, { ...frame, bare: true }, measure);
    if (o?.clean) { o.bare = true; return o; }
    /* neither is clean: the one whose letters cover least, of the three: with the footprint, its outline with the footprint's spacing, and
       the outline alone as before the footprint was counted (live harness, the GM's critical on a crowded board: the least-covering block
       with the footprint put 3 SIXES' letters 42 px onto a bystander; the block shown before only grazed its own words) */
    const o0 = yield* composeMomentSteps(items, { ...frame, bare: true }, (it, S) => { const { room, ...b } = measure(it, S); return b; });
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
  const boxes = [frame.token, ...(frame.avoid ?? []).filter((a) => (a.w ?? 1) >= OTHER_W && !a.star)].filter(Boolean);   // CAPSTAR: a cut-in's reach is no token
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
/* SPLASHBLOCK (seen live, the GM's fight critical on a crowded board, sheet capstar after3: '6 SIXES' drawn across the end of 'HAYMAKER!'):
   where nothing is clean the least-covering search weighed the caption part on its own word part like a token (TOKEN_W), under the star's
   cut-in (STAR_W), so the caption went onto its own word to spare the star. A block's own parts never lie on each other: the other part
   weighs PART_W per px2, over anything else a block can cover (a whole star at STAR_W is ~1.2e7; a 40 x 40 px overlap of the parts 1.6e7) */
export const PART_W = 1e4;
/* CAPSTAR: the impact's cut-in (engine 1.9.23 IMPACT5) draws the STAR of the blow (the struck token, else the roller the blow comes from)
   enlarged at its own place for the whole cut: up to CUT.want of the view's short side (at least CUT.min x its token, never past CUT.max), as
   far as the strength's CU_TOP goes. A block laid out round the token's plain box put its captions across that enlarged figure (live, the GM's
   critical: "THE ODDS ARE SHATTERED!" over the starred target). The star's cut-in reach is an obstacle of its own (STAR_W per px2: twice the
   token itself, on top of the target's own weight where they overlap: during the cut it IS the moment; never counted as a token's cover,
   coverMax), so the lettering frames the star instead of covering it. Live (the GM's fight critical on a crowded board, no clean place,
   the least-covering arrangement): at 20 and at 50 the captions still lay across the star (a caption touching its own word's stand weighed
   as much); at 100 the same board puts them under the word, off every figure, the small '6 SIXES' tucked against the word's end
   (provisional CAPSTAR-1).
   Mirrored from the engine (scripts/letters/impact/draw.mjs CUT_WANT, plan.mjs LIMITS.cutMax / CU_TOP; pinned by sweep-checks/capstar.mjs);
   the running engine's LIMITS.cutMax wins when it gives one. `reach` = the extra the contact's pop and the drift along the blow add (the pop
   multiplies by up to 1 + 0.45 (z - 1) inside the cap, the drift moves the star up to 0.22 of its size on the release while it shrinks back). */
export const CUT = Object.freeze({ want: 0.34, max: 0.44, min: 1.3, top: Object.freeze([0.5, 0.6, 0.8, 1, 1, 1]), reach: 1.12 });
export const STAR_W = 100;
/* the star's cut-in box: c = its centre, size = its token's drawn size (the larger side), u = the view's short side (all in one unit),
   step = the impact's strength 0..5 (the engine's stepOf), max = the engine's LIMITS.cutMax when known -> { l, t, r, b, x, y } */
export function starBox(c, size, u, step, max = CUT.max) {
  if (!c || !(size > 0) || !(u > 0)) return null;
  const top = CUT.top[Math.max(0, Math.min(5, Math.round(Number(step) || 0)))] ?? 1, cap = max * u;
  let s = 1;
  if (size < cap) s = 1 + (Math.min(cap / size, Math.max(CUT.want * u / size, CUT.min)) - 1) * top;
  const half = Math.max(size, Math.min(cap, size * s * CUT.reach)) / 2;
  return { x: c.x, y: c.y, l: c.x - half, t: c.y - half, r: c.x + half, b: c.y + half };
}
/* CRITLATE: the place a block of one size finds in one frame is the same every time it is asked (composeMoment asks it again for every
   shrink step and split it retries: on a crowded critical 2881 place() calls, 969 different). Kept by the frame's CONTENT (its frame objects
   are made anew for each try) and the block's size and footprint; a bounded memo */
const FRAME_KEY = new WeakMap(), PLACE_MEMO = new Map(), PLACE_MAX = 4000;
const frameKey = (f) => { let k = FRAME_KEY.get(f); if (k === undefined) { try { k = JSON.stringify(f); } catch (e) { k = null; } FRAME_KEY.set(f, k); } return k; };
function place(out, frame, far = false) {
  const safe = frame.safe, r = out.rect, bw = r.r - r.l, bh = r.b - r.t;
  const T = frame.token, avoid = frame.avoid ?? [];
  const ft0 = out.foot ?? null, pk = `${bw}|${bh}|${far ? 1 : 0}|${ft0 ? `${ft0.l}|${ft0.t}|${ft0.r}|${ft0.b}` : '-'}`;
  const fk = frameKey(frame), mk = fk == null ? null : fk + '#' + pk;
  const hit0 = mk == null ? null : PLACE_MEMO.get(mk);
  if (hit0) return placeAt(out, r, hit0);
  const at = (l, t) => ({ l, t, r: l + bw, b: t + bh });
  const inSafe = (l, t) => [clamp(l, safe.l, Math.max(safe.l, safe.r - bw)), clamp(t, safe.t, Math.max(safe.t, safe.b - bh))];
  let best = null, side = 'focus';
  /* the score: anything touched first (the token four times as bad), then the distance from the token (or the focus) in block sizes
     plus a small preference of the sides (above, below, right, left) */
  const ref = T ? { x: T.x, y: T.y } : frame.focus, unit = Math.max(1, Math.hypot(bw, bh));
  const ft = out.foot ?? null;   // CALLERS: the standing footprint past the outline (rim + life), kept off what the block must not cover
  /* CRITLATE (cost: a crowded critical's layout took 0.3-0.45 s in one task, on the moment's own instant): the same choice, cheaper. A place
     whose distance and side preference alone already reach a clean best's score cannot win (its score is at least that), so its hits are not
     counted; the heavy share is counted only for a new best. Exact: the same best on every input (check-critlate.mjs, fingerprint) */
  const heavyAvoid = avoid.filter(a => (a.w ?? 1) >= 10), tg = frame.gap ?? 6;
  const tokR = T ? { l: T.l - tg + 1, t: T.t - tg + 1, r: T.r + tg - 1, b: T.b + tg - 1 } : null;
  const consider = (s, l, t, pref) => {
    [l, t] = inSafe(l, t);
    const d = Math.hypot(l + bw / 2 - ref.x, t + bh / 2 - ref.y) / unit;
    if (best && best.hit <= 0.5 && d + pref >= best.score) return;
    const q0 = at(l, t), q = ft ? { l: q0.l - ft.l, t: q0.t - ft.t, r: q0.r + ft.r, b: q0.b + ft.b } : q0, onT = tokR ? area(q, tokR) : 0;
    const hit = blockHits(q, avoid) + onT * TOKEN_W;
    const score = (hit > 0.5 ? 1e6 + hit : 0) + d + pref;
    if (!best || score < best.score) best = { s, l, t, hit, heavy: onT + blockHits(q, heavyAvoid), score };
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
  if (mk != null) { PLACE_MEMO.set(mk, best); if (PLACE_MEMO.size > PLACE_MAX) PLACE_MEMO.delete(PLACE_MEMO.keys().next().value); }
  placeAt(out, r, best);
}
function placeAt(out, r, best) {
  const dx = best.l - r.l, dy = best.t - r.t;
  for (const it of out.items) { it.x = Math.round(it.x + dx); it.y = Math.round(it.y + dy); }
  if (out.gauge) { out.gauge.x = Math.round(out.gauge.x + dx); out.gauge.y = Math.round(out.gauge.y + dy); }
  out.rect = { l: r.l + dx, t: r.t + dy, r: r.r + dx, b: r.b + dy };
  out.side = best.s;
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
/* SPLASHSAME (owner: the GM and every player see the SAME picture; ADVS2 D2: a GM at 1600 x 900, zoom 0.5 and a player at 1366 x 768, zoom 0.8
   saw the critical in two arrangements, the ordinary roll's caption beside the word on one seat and under it on the other, and a 1000 x 620 seat
   drew smaller words with BIGGER captions). The screen block is now composed ONCE as the TABLE's block (stage.mjs tableFrame: the reference
   window round the roller at the board's reference scale, from documents only: every seat composes the same block whatever its window, zoom or
   panels) and each seat only PLACES that block (seatPlace):
   - the same arrangement and the same relative sizes: the block's parts keep their places to each other; a window too small for it shows it
     uniformly smaller (one factor k for every part, sizes in the same ratios);
   - the same place relative to what it describes: each part keeps its side of the roller (above, below, left, right) and its offset from the
     roller's box; a bigger token on a closer zoom pushes the part out by the token's growth on that side (the gap to the token stays);
   - a seat that cannot show it clean there (a neighbour that is nearer on its zoom, its view's edge, its own panel) moves a part the least
     it can AWAY from the roller (never toward it) and along its side; else anywhere clean in its view nearest the place (the owner's ruling: a
     seat that cannot show the block clean may show it farther away but clean); only then smaller (SHRINK_LOCAL), still in the same ratios;
     nothing clean at all: the least covering of the first ones (provisional SPLASHSAME-1).
   table: { items, parts?, rect, foot?, gauge?, hero: the roller's box in the table's px } ; seat: { hero: its box on this seat (px), safe: the seat's
   free view, avoid: [{ l, t, r, b, w }] (its tokens, pins, panels; px), gap }.
   -> { items, rect, parts?, gauge, foot?, k, moved: 'none' | 'shift' | 'far' | 'shrink' | 'least', d: [{ dx, dy }] per part } */
export const AWAY_STEPS = Object.freeze([0, 6, 12, 20, 30, 45, 65, 90, 120, 160, 210, 270, 340, 420, 520, 640]);
export const SEAT_SHRINK = Object.freeze([0.94, 0.88, 0.82, 0.76, 0.7, 0.64, 0.58, 0.52, 0.46, 0.4]);
export const ALONG_STEPS =Object.freeze([0, -0.15, 0.15, -0.3, 0.3, -0.45, 0.45, -0.6, 0.6, -0.8, 0.8, -1, 1]);
/* the seat's own factor (its free view against the table's, by area: a narrow window is not punished twice, k0 fits the block's width) */
export function seatFactor(safe, ts) {
  return ts && safe ? clamp(Math.sqrt((safe.r - safe.l) / Math.max(1, ts.r - ts.l) * (safe.b - safe.t) / Math.max(1, ts.b - ts.t)), 0.3, 1) : 1;
}
/* CRITFREEZE: the placing in steps, as composeMoment's (seatPlaceSteps hands the page back between the sizes and arrangements it tries
   and, in the least-covering search, between the word part's places); seatPlace runs it to its end in one go, as before */
export function seatPlace(table, seat) { return runSteps(seatPlaceSteps(table, seat)); }
export function* seatPlaceSteps(table, seat) {
  const H0 = table.hero, H = seat.hero, avoid = seat.avoid ?? [], gp = seat.gap ?? 6;
  let safe = seat.safe;   // SPLASHCLEAR: the seat's wider room (seat.wide) replaces it for the last moves only
  const c = (q) => ({ x: (q.l + q.r) / 2, y: (q.t + q.b) / 2 });
  const parts0 = table.parts?.length === 2 ? table.parts : [table.rect];
  const pOf = (x, y) => { let bi = 0, bd = Infinity; parts0.forEach((q, i) => { const dd = Math.hypot(Math.max(0, q.l - x, x - q.r), Math.max(0, q.t - y, y - q.b)); if (dd < bd) { bd = dd; bi = i; } }); return bi; };
  /* SPLASHBLOCK: a block placed once already (the canonical seat's, stage.mjs compose) says which part each of its lines is and in what
     order the table set them (pi, gpi, rel): its parts may stand nearer each other than their padded rooms (their rooms overlapping), where
     the nearest room no longer tells a line's part nor the rooms their order */
  const ipi = table.pi?.length === table.items.length ? table.pi : table.items.map((it) => pOf(it.x, it.y));
  const gpi = table.gauge ? (table.gpi ?? pOf(table.gauge.x + table.gauge.w / 2, table.gauge.y + table.gauge.h / 2)) : null;
  const h0 = c(H0), h1 = c(H), dhx = (H.r - H.l - (H0.r - H0.l)) / 2, dhy = (H.b - H.t - (H0.b - H0.t)) / 2;
  /* each part's side of the roller (on the table) and its place here: the same offset from the roller, out by the token's growth on that side */
  const P = parts0.map((q) => {
    let sx = q.r <= H0.l ? -1 : q.l >= H0.r ? 1 : 0, sy = q.b <= H0.t ? -1 : q.t >= H0.b ? 1 : 0;
    const qc = c(q);
    if (!sx && !sy) { const vx = qc.x - h0.x, vy = qc.y - h0.y; if (Math.abs(vx) * (H0.b - H0.t) > Math.abs(vy) * (H0.r - H0.l)) sx = Math.sign(vx) || 1; else sy = Math.sign(vy) || -1; }
    const tx = h1.x - h0.x + sx * dhx, ty = h1.y - h0.y + sy * dhy;
    const r = { l: q.l + tx, t: q.t + ty, r: q.r + tx, b: q.b + ty };
    const n = Math.hypot(sx, sy) || 1;
    return { q, r, tx, ty, away: { x: sx / n, y: sy / n }, along: { x: -sy / n, y: sx / n } };
  });
  /* each part's standing footprint (the table measured it per part: a caption's duplicate block reaches further than the word's) */
  const feet = parts0.length === 2 && table.partFeet ? table.partFeet : [table.foot];
  const F = (i) => feet[i] ?? table.foot ?? { l: 0, t: 0, r: 0, b: 0 };
  const Hg = { l: H.l - gp + 1, t: H.t - gp + 1, r: H.r + gp - 1, b: H.b + gp - 1 };
  /* what a part covers for its hold: its letters' boxes and their standing ink (the engine's stand: life + rim) where the table measured
     them; the outline's entrance room (the slam's smear) only has to stay in the view (inSafe): an entrance passes over things for a few
     frames (CALLERS-2). Without the items' stand: the outline and its foot, as the table placed it */
  const cores = parts0.map((_, i) => {
    const r = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
    for (let n = 0; n < table.items.length; n++) {
      const it = table.items[n];
      if (ipi[n] !== i || !(it.w > 0)) continue;
      /* no measured stand (no engine measure): its letters' box and a hair (2 px: never abutting what it keeps off), as the table's own
         last word on a block (letterHits) */
      const st = it.room?.stand ?? { l: 2, r: 2, u: 2, d: 2 };
      r.l = Math.min(r.l, it.x - it.w / 2 - st.l); r.r = Math.max(r.r, it.x + it.w / 2 + st.r); r.t = Math.min(r.t, it.y - it.h / 2 - st.u); r.b = Math.max(r.b, it.y + it.h / 2 + st.d);
    }
    if (table.gauge && gpi === i) { const g = table.gauge; r.l = Math.min(r.l, g.x); r.t = Math.min(r.t, g.y); r.r = Math.max(r.r, g.x + g.w); r.b = Math.max(r.b, g.y + g.h); }
    return Number.isFinite(r.l) ? r : null;
  });
  const boxAt = (c, i, q, k) => { const p = P[i]; if (!c) return null; const tf = (x, ax, t, dd) => ax + (x + t - ax) * k + dd, dx = q.l - (q.ax + (p.r.l - q.ax) * k), dy = q.t - (q.ay + (p.r.t - q.ay) * k);
    return { l: tf(c.l, q.ax, p.tx, dx), t: tf(c.t, q.ay, p.ty, dy), r: tf(c.r, q.ax, p.tx, dx), b: tf(c.b, q.ay, p.ty, dy) }; };
  const coreAt = (i, q, k) => boxAt(cores[i], i, q, k);
  /* SPLASHBLOCK: each part's LETTERS (its items' own boxes, line by line, no standing ink): one part's letters never lie on the other's
     (PART_W; their standing ink meeting weighs as before, TOKEN_W). Line by line, not the part's outline: a caption line may stand beside
     the end of the word inside the word part's outline, as the table lays it */
  const bares = parts0.map((_, i) => table.items.filter((it, n) => it.w > 0 && ipi[n] === i).map((it) => ({ l: it.x - it.w / 2, t: it.y - it.h / 2, r: it.x + it.w / 2, b: it.y + it.h / 2 })));
  const bareAt = (i, q, k) => bares[i].map((c) => boxAt(c, i, q, k));
  const bareU = (i, q, k) => { const B = bareAt(i, q, k); return B.length ? { l: Math.min(...B.map((c) => c.l)), t: Math.min(...B.map((c) => c.t)), r: Math.max(...B.map((c) => c.r)), b: Math.max(...B.map((c) => c.b)) } : null; };
  /* the parts already placed, as obstacles of the next: [core, i, q, k] -> their standing ink (TOKEN_W) and their letters (PART_W, `bare`) */
  const partsAs = (list) => list.flatMap(([c, i, q, k]) => [{ ...c, w: TOKEN_W }, ...bareAt(i, q, k).map((b) => ({ ...b, w: PART_W, bare: true }))]);
  const hitOf = (q, k, i, more = []) => {
    const ft = F(i), g = coreAt(i, q, k) ?? { l: q.l - ft.l * k, t: q.t - ft.t * k, r: q.r + ft.r * k, b: q.b + ft.b * k };
    let s = blockHits(g, avoid) + area(g, Hg) * TOKEN_W, B = null;
    for (const m of more) {
      if (!m.bare) { s += area(g, m) * (m.w ?? 1); continue; }
      B ??= bareAt(i, q, k);
      for (const b of B) s += area(b, m) * m.w;
    }
    return s;
  };
  const inSafe = (q) => q.l >= safe.l - 1 && q.t >= safe.t - 1 && q.r <= safe.r + 1 && q.b <= safe.b + 1;
  const eps = HIT_EPS * 900 * 900;
  /* a part at scale k about its point nearest the roller, moved by d */
  const at = (p, k, d) => { const ax = clamp(h1.x, p.r.l, p.r.r), ay = clamp(h1.y, p.r.t, p.r.b); return { l: ax + (p.r.l - ax) * k + d.dx, t: ay + (p.r.t - ay) * k + d.dy, r: ax + (p.r.r - ax) * k + d.dx, b: ay + (p.r.b - ay) * k + d.dy, ax, ay }; };
  /* the block whole in this seat's view: one factor for every part (a window smaller than the block) */
  /* the seat's own factor for EVERY moment it shows (its free view against the table's): a smaller window shows the whole table picture
     uniformly smaller, so on one seat the ranks keep their order (ordinary < strong < critical) and their floors scale with it */
  const kSeat = seatFactor(safe, table.tsafe);
  const U0 = { l: Math.min(...parts0.map((q) => q.l)), t: Math.min(...parts0.map((q) => q.t)), r: Math.max(...parts0.map((q) => q.r)), b: Math.max(...parts0.map((q) => q.b)) };
  /* by the block's own size (not by its parts pushed apart round a bigger token: a close view that cannot hold the parts round its roller
     moves them, it does not shrink the whole picture under its ranks) */
  /* (nor by its parts as the table spread them round a bigger roller: here they stand by this seat's smaller one) */
  const U1 = { l: Math.min(...P.map((p) => p.r.l)), t: Math.min(...P.map((p) => p.r.t)), r: Math.max(...P.map((p) => p.r.r)), b: Math.max(...P.map((p) => p.r.b)) };
  /* (SPLASHBLOCK: a block already fitted into a view of this size, table.rigid, is not fitted a second time) */
  const fitM = 4;
  const k0 = table.rigid ? Math.min(1, kSeat) : Math.min(kSeat, (safe.r - safe.l - fitM) / Math.max(1, Math.min(U0.r - U0.l, U1.r - U1.l)), (safe.b - safe.t - fitM) / Math.max(1, Math.min(U0.b - U0.t, U1.b - U1.t)));
  /* how small a seat may draw it for room: never a word under its RANK's floor (RANK_WORD min, the critical TIGHT_CRIT of it: so the ranks read in
     order on every seat, ADVS2 D6), never a word under MAP_READ.word nor a caption under MAP_READ.info. Only a window too small for the block at
     its floors goes under them (k0) */
  const ref = table.ref ?? 900, sc = table.scale ?? 1;
  const kFloor = Math.max(0, ...table.items.map((it) => {
    const read = (it.role === 'word' || it.role === 'pre' ? MAP_READ.word : MAP_READ.info) / Math.max(1, it.S);
    /* the rank's own floor (a tight table already lowered it.min by TIGHT_CRIT), the info lines' floors of their rank (RANK_INFO) too */
    const rm = it.role === 'word' ? (RANK_WORD[it.rank]?.min ?? it.min) : (it.min ?? 0);
    const rank = rm ? kSeat * rm * ref * sc * (it.role === 'word' && it.rank === 'critical' ? TIGHT_CRIT : 1) / Math.max(1, it.S) : 0;
    return Math.max(read, rank);
  }));
  const kMin = Math.min(k0, Math.max(kFloor, k0 * SEAT_SHRINK[SEAT_SHRINK.length - 1]));
  const ks = [k0, ...SEAT_SHRINK.map((s) => k0 * s)].filter((k, i) => i === 0 || k >= kMin - 1e-9);
  const z = { dx: 0, dy: 0 };
  /* the moves of one part, nearest first: out from the roller and along its side (never toward him: checked by the token's weight) */
  const movesOf = (p, k) => {
    const q = at(p, k, z), w = q.r - q.l, h = q.b - q.t, span = Math.abs(p.along.x) * w + Math.abs(p.along.y) * h;
    const out = [];
    for (const a of AWAY_STEPS) for (const s of ALONG_STEPS) {
      const d = { dx: p.away.x * a + p.along.x * s * span, dy: p.away.y * a + p.along.y * s * span };
      out.push({ d, cost: a + Math.abs(s) * span * 0.5 });
      /* brought back into the view when the move leaves it */
      const m = { l: q.l + d.dx, t: q.t + d.dy, r: q.r + d.dx, b: q.b + d.dy }, si = SP_shiftInto(m, safe);
      if (si.dx || si.dy) out.push({ d: { dx: d.dx + si.dx, dy: d.dy + si.dy }, cost: a + Math.abs(s) * span * 0.5 + Math.hypot(si.dx, si.dy) });
    }
    return out.sort((x, y) => x.cost - y.cost);
  };
  /* anywhere in the view, nearest the part's place first */
  const farOf = (p, k) => {
    const q = at(p, k, z), w = q.r - q.l, h = q.b - q.t, W = safe.r - safe.l - w, Hh = safe.b - safe.t - h, out = [];
    for (let gy = 0; gy <= 16; gy++) for (let gx = 0; gx <= 16; gx++) {
      const l = safe.l + Math.max(0, W) * gx / 16, t = safe.t + Math.max(0, Hh) * gy / 16;
      out.push({ d: { dx: l - q.l, dy: t - q.t }, cost: Math.hypot(l - q.l, t - q.t) });
    }
    return out.sort((x, y) => x.cost - y.cost);
  };
  /* a split block keeps its arrangement on every seat: the parts stay in the table's order (the word above its caption stays above it, a
     caption beside it stays on that side), however far a seat moves them (ADVS2 D2: the critical's caption under the word on one seat, over
     it on the other) */
  const T0 = parts0[0], T1 = parts0[1];
  const rel = T1 ? (table.rel ?? { v: T0.b <= T1.t + 1 ? -1 : T1.b <= T0.t + 1 ? 1 : 0, h: T0.r <= T1.l + 1 ? -1 : T1.r <= T0.l + 1 ? 1 : 0 }) : null;
  const orderOk = (i, q, q0) => {
    if (!rel || i !== 1 || !q0) return true;
    if (rel.v < 0 && q0.b > q.t + 2) return false;
    if (rel.v > 0 && q.b > q0.t + 2) return false;
    if (rel.h < 0 && q0.r > q.l + 2) return false;
    if (rel.h > 0 && q.r > q0.l + 2) return false;
    return true;
  };
  /* SPLASHBLOCK: the same order read by the parts' LETTERS (not their padded room): where nothing is clean (least), the word may stand as
     near its caption as their letters allow before either lies on the star or on a fighter */
  const orderInk = (q, q0, k) => {
    if (!rel || !q0) return true;
    const a = bareU(0, q0, k) ?? q0, b = bareU(1, q, k) ?? q, g = 2;
    if (rel.v < 0 && a.b > b.t + g) return false;
    if (rel.v > 0 && b.b > a.t + g) return false;
    if (rel.h < 0 && a.r > b.l + g) return false;
    if (rel.h > 0 && b.r > a.l + g) return false;
    return true;
  };
  /* ... and by their MIDDLES alone (the letters themselves kept apart by PART_W): a line of the caption may stand past the word's end */
  const orderMid = (q, q0, k) => {
    if (!rel || !q0) return true;
    const a = bareU(0, q0, k) ?? q0, b = bareU(1, q, k) ?? q, ax = (a.l + a.r) / 2, ay = (a.t + a.b) / 2, bx = (b.l + b.r) / 2, by = (b.t + b.b) / 2;
    if (rel.v < 0 && ay >= by) return false;
    if (rel.v > 0 && by >= ay) return false;
    if (rel.h < 0 && ax >= bx) return false;
    if (rel.h > 0 && bx >= ax) return false;
    return true;
  };
  /* a split block is split only to frame the roller (CRITPEAK: head on one side, caption on the other); parts placed apart that no longer
     have the roller between them are a block torn open for nothing (the caption hundreds of px from its word, check-fxld F4): such a seat
     joins them again (tryJoined) */
  const frames = (a, b, h) => {
    const ox = (q) => q.l < h.r && q.r > h.l, oy = (q) => q.t < h.b && q.b > h.t;   // the roller between them, not off to one side
    if (rel.v < 0) return a.b <= h.t + gp && b.t >= h.b - gp && ox(a) && ox(b);
    if (rel.v > 0) return b.b <= h.t + gp && a.t >= h.b - gp && ox(a) && ox(b);
    if (rel.h < 0) return a.r <= h.l + gp && b.l >= h.r - gp && oy(a) && oy(b);
    if (rel.h > 0) return b.r <= h.l + gp && a.l >= h.r - gp && oy(a) && oy(b);
    return true;
  };
  const gapOf = (a, b) => (rel.v ? Math.max(0, a.t - b.b, b.t - a.b) : Math.max(0, a.l - b.r, b.l - a.r));
  const tc0 = rel ? (cores[0] ?? parts0[0]) : null, tc1 = rel ? (cores[1] ?? parts0[1]) : null;
  const tFrames = rel ? frames(tc0, tc1, H0) : false, tGap = rel ? gapOf(tc0, tc1) : 0;
  const framesOk = (i, q1, q00, k) => {
    if (!rel || i !== 1 || !q00) return true;
    /* by what the parts draw (their cores), not their padded room */
    const q0 = coreAt(0, q00, k) ?? q00, q = coreAt(1, q1, k) ?? q1;
    if (tFrames) return frames(q0, q, H);
    /* a split that does not frame the roller on the table: its parts no farther apart here than there (the roller's growth allowed) */
    return gapOf(q0, q) <= tGap * k + 2 * Math.max(0, rel.v ? dhy : dhx) + 4;
  };
  /* a split block whose parts find no clean place round this seat's roller: the caption part joined to the word part again on the
     table's side of it (under it, over it, beside it, centred), the two moved as ONE block (out from the roller, along, then anywhere in
     the view): the caption right under the word, as a block without the split (check-fxld F4) */
  /* the word part on its table side of the roller (out along its side's axis at least: a block above him stays above him) */
  const sideOk = (c) => { const ax = Math.sign(P[0].away.x), ay = Math.sign(P[0].away.y);
    return (ax > 0 && c.l >= H.r - gp) || (ax < 0 && c.r <= H.l + gp) || (ay < 0 && c.b <= H.t + gp) || (ay > 0 && c.t >= H.b - gp) || (!ax && !ay); };
  /* the block's middle on its table side of the roller too (each axis where the table's middle stands clear of his centre) */
  const midOf = (a, b) => ({ x: (Math.min(a.l, b.l) + Math.max(a.r, b.r)) / 2, y: (Math.min(a.t, b.t) + Math.max(a.b, b.b)) / 2 });
  const tMid = rel ? midOf(tc0, tc1) : null;
  const midOk = (a, b) => { const m = midOf(a, b); for (const ax of ['x', 'y']) { const t = tMid[ax] - h0[ax]; if (Math.abs(t) > 40 && (m[ax] - h1[ax]) * Math.sign(t) < 0.4 * Math.abs(t)) return false; } return true; };
  /* joined: the caption part back under (over, beside) the word part as on a block that was never split, or the word part back over the
     caption part (whichever keeps the block on its side of the roller), the two moved as ONE block */
  const tryJoined = (k, anySide = false, least = false) => {
    if (!rel || P.length !== 2) return null;
    let low = null;
    const q0 = at(P[0], k, z), q1 = at(P[1], k, z), w0 = q0.r - q0.l, h0q = q0.b - q0.t, w1 = q1.r - q1.l, h1q = q1.b - q1.t;
    for (const anchor of [0, 1]) {
      /* the other part's offset to stand joined to the anchor */
      let j;
      if (anchor === 0) { const jl = rel.v ? (q0.l + q0.r) / 2 - w1 / 2 : rel.h < 0 ? q0.r : q0.l - w1, jt = rel.v ? (rel.v < 0 ? q0.b : q0.t - h1q) : (q0.t + q0.b) / 2 - h1q / 2; j = { dx: jl - q1.l, dy: jt - q1.t }; }
      else { const jl = rel.v ? (q1.l + q1.r) / 2 - w0 / 2 : rel.h < 0 ? q1.l - w0 : q1.r, jt = rel.v ? (rel.v < 0 ? q1.t - h0q : q1.b) : (q1.t + q1.b) / 2 - h0q / 2; j = { dx: jl - q0.l, dy: jt - q0.t }; }
      const A = anchor === 0 ? q0 : q1, B = anchor === 0 ? q1 : q0;
      const U = { l: Math.min(A.l, B.l + j.dx), t: Math.min(A.t, B.t + j.dy), r: Math.max(A.r, B.r + j.dx), b: Math.max(A.b, B.b + j.dy) };
      const W = safe.r - safe.l - (U.r - U.l), Hh = safe.b - safe.t - (U.b - U.t);
      if (W < 0 || Hh < 0) continue;
      const cands = movesOf(P[anchor], k).map((c) => c.d);
      const grid = [];
      for (let gy = 0; gy <= 16; gy++) for (let gx = 0; gx <= 16; gx++) { const l = safe.l + W * gx / 16, t = safe.t + Hh * gy / 16; grid.push({ dx: l - U.l, dy: t - U.t, c: Math.hypot(l - U.l, t - U.t) }); }
      grid.sort((a, b) => a.c - b.c);
      for (const d of [...cands, ...grid]) {
        const dj = { dx: j.dx + d.dx, dy: j.dy + d.dy }, d0 = anchor === 0 ? d : dj, d1 = anchor === 0 ? dj : d;
        const a = at(P[0], k, d0), b = at(P[1], k, d1);
        if (!inSafe(a) || !inSafe(b)) continue;
        const ca = coreAt(0, a, k) ?? a, cb = coreAt(1, b, k) ?? b;
        if (!anySide && !(sideOk(ca) && midOk(ca, cb))) continue;
        const h = hitOf(a, k, 0) + hitOf(b, k, 1, partsAs([[ca, 0, a, k]]));
        if (least) { if (!low || h < low.sum - 0.5) low = { sum: h, ds: [{ dx: d0.dx, dy: d0.dy }, { dx: d1.dx, dy: d1.dy }] }; continue; }
        if (h <= eps) return [{ dx: d0.dx, dy: d0.dy }, { dx: d1.dx, dy: d1.dy }];
      }
    }
    return low;
  };
  /* a part moved on its own side keeps the side its middle had on the table (on each axis where that middle stood clear of the roller's):
     a "shift" along the side that carried the block from under him to over him was another picture (samepic S4, the GM's desk) */
  const keepsSide = (i, q, k) => {
    const c = coreAt(i, q, k) ?? q, t0 = cores[i] ?? parts0[i];
    for (const ax of ['x', 'y']) {
      const lo = ax === 'x' ? 'l' : 't', hi = ax === 'x' ? 'r' : 'b', t = (t0[lo] + t0[hi]) / 2 - h0[ax];
      if (Math.abs(t) > 40 && ((c[lo] + c[hi]) / 2 - h1[ax]) * Math.sign(t) < 0.4 * Math.abs(t) * k) return false;
    }
    return true;
  };
  const tryK = (k, far) => {
    const ds = [], placed = [], qs = [];
    for (let i = 0; i < P.length; i++) {
      const p = P[i], more = partsAs(placed);
      const cands = far ? [...movesOf(p, k), ...farOf(p, k)] : movesOf(p, k);
      const hit = cands.find(({ d }) => { const q = at(p, k, d); return inSafe(q) && orderOk(i, q, qs[0]) && framesOk(i, q, qs[0], k) && (far || keepsSide(i, q, k)) && hitOf(q, k, i, more) <= eps; });
      if (!hit) return null;
      ds.push(hit.d); { const q = at(p, k, hit.d); placed.push([coreAt(i, q, k) ?? q, i, q, k]); qs.push(q); }
    }
    return ds;
  };
  /* the order (the owner's ruling: a seat that cannot show it clean shows it farther away but clean, before it shows it smaller): its own
     side at its size; anywhere clean at its size; its own side smaller down to the floor; anywhere smaller; nothing clean: where it covers
     least at the allowed sizes, the parts in the table's order, swapped only when that order cannot be kept readable (provisional
     SPLASHSAME-1) */
  /* what the table's own block covers at the table (its letters and stand against the documents as the reference zoom shows them, and its
     roller): a seat whose plain place covers no more than that keeps the table's place (the table accepted that cover for every seat; a seat
     moving off it alone drew another picture, samepic S1: the critical on a board with a neighbour by the roller) */
  const tHit = table.avoid1 ? cores.reduce((s, c, i) => s + (c ? blockHits(c, table.avoid1) + area(c, { l: H0.l - gp + 1, t: H0.t - gp + 1, r: H0.r + gp - 1, b: H0.b + gp - 1 }) * TOKEN_W : Infinity), 0) : null;
  /* only at a zoom the table planned round (TABLE_ZOOMS in stage.mjs, 1 .. 0.5 of the reference): further out or closer the documents
     stand elsewhere round the roller than any the table weighed, and the seat seeks its clean place */
  const zr = (H.r - H.l) / Math.max(1, H0.r - H0.l);
  /* a block taken as it is (table.rigid) is in the view when its LETTERS are (where nothing was clean the canonical seat may have let a
     part's entrance room pass the edge);
     seat.slack: how far past the view's band they may stand, the few px the roller stands off where the canonical seat had him) */
  const inView = (i, q, k) => { if (!table.rigid) return inSafe(q); const c = bareU(i, q, k) ?? q, m = seat.slack ?? 1; return c.l >= safe.l - m && c.t >= safe.t - m && c.r <= safe.r + m && c.b <= safe.b + m; };
  /* SPLASHBLOCK (seen live: where the board left no clean place the canonical block was refused on nearly every seat, for the few px2 it
     lay on that seat's own panel or the few per cent more it covered there, and each seat then searched by itself: two arrangements on two
     seats that look at the same shot). seat.asIs: a block taken as it is where nothing is clean anyway: it stands wherever its letters
     are in this seat's view, whatever it covers there (the caller has seen that this seat has no clean place of its own either) */
  const asIs = !!(table.rigid && seat.asIs);
  const plain = () => {
    if (tHit == null || !Number.isFinite(tHit) || zr < 0.45 || zr > 1.05) return null;
    let s = 0;
    const placed = [];
    for (let i = 0; i < P.length; i++) {
      const q = at(P[i], k0, z);
      if (!inView(i, q, k0)) return null;
      /* (a block taken as it is, table.rigid: its parts stand to each other as they stood, whatever they cover of each other) */
      s += hitOf(q, k0, i, table.rigid ? [] : partsAs(placed));
      /* never onto this seat's own things (its panels, its resting dice under the bars): the table never weighed them */
      const c = coreAt(i, q, k0) ?? q;
      if (!asIs && seat.own?.length && blockHits(c, seat.own) > 0.5) return null;
      placed.push([c, i, q, k0]);
    }
    return asIs || s <= tHit + eps ? P.map(() => z) : null;
  };
  /* SPLASHBLOCK: the table's block as ONE piece, shifted the least way that brings it inside this seat's view (table.rigid: a block composed
     at this seat's own zoom, stage.mjs compose). The arrangement, the sizes and the parts' places to each other stay the table's; only a
     shift that makes it cover more than the table's own block covers (or puts it on this seat's own panel) sends the seat on to its own
     search below. A shift is continuous in the seat's view: two seats a few px apart get two blocks a few px apart, never two arrangements */
  const rigid = () => {
    if (!table.rigid || tHit == null || !Number.isFinite(tHit)) return null;
    const qs = P.map((p, i) => { const q = at(p, k0, z); return bareU(i, q, k0) ?? q; });
    const U = { l: Math.min(...qs.map((q) => q.l)), t: Math.min(...qs.map((q) => q.t)), r: Math.max(...qs.map((q) => q.r)), b: Math.max(...qs.map((q) => q.b)) };
    const d = SP_shiftInto(U, safe);
    if (!d.dx && !d.dy) return null;
    let s = 0;
    for (let i = 0; i < P.length; i++) {
      const q = at(P[i], k0, d);
      if (!inView(i, q, k0)) return null;
      s += hitOf(q, k0, i);
      const c = coreAt(i, q, k0) ?? q;
      if (!asIs && seat.own?.length && blockHits(c, seat.own) > 0.5) return null;
    }
    return asIs || s <= tHit + eps ? P.map(() => ({ dx: d.dx, dy: d.dy })) : null;
  };
  let k = k0, ds = null, moved = 'none';
  if ((ds = plain())) moved = 'none';
  /* (SPLASHBLOCK: a caller that only asks whether the table's own place holds on this seat) */
  else if (seat.plainOnly) return null;
  else if ((ds = rigid())) moved = 'shift';
  /* (a caller that takes this block as it is, moved in one piece at most, or not at all) */
  else if (seat.rigidOnly) return null;
  else if ((ds = tryK(k0, false))) moved = ds.every((d) => !d.dx && !d.dy) ? 'none' : 'shift';
  yield;
  /* on its own side of the roller, in its arrangement, smaller (one factor: the relative sizes kept) before the parts are joined (another
     arrangement) and before anywhere else at its size (the place relative to him is part of the picture: a block that changes side reads
     as another picture, samepic S1; provisional SPLASHSAME-6) */
  if (!ds) for (const kk of ks.slice(1)) { ds = tryK(kk, false); if (ds) { k = kk; moved = 'shrink'; break; } yield; }
  if (!ds) for (const kk of ks) { ds = tryJoined(kk); if (ds) { k = kk; moved = 'joined'; break; } yield; }
  if (!ds && (ds = tryK(k0, true))) moved = 'far';
  if (!ds) yield;
  if (!ds && (ds = tryJoined(k0, true))) moved = 'far';
  if (!ds) for (const kk of ks.slice(1)) { yield; ds = tryK(kk, true); if (!ds) { yield; ds = tryJoined(kk, true); } if (ds) { k = kk; moved = 'far'; break; } }
  /* SPLASHCLEAR (the owner: a seat that cannot show the block clean may show it farther away but clean): before it lies on anything, the seat
     looks again in ALL of its own free view (seat.wide: its window minus the bars it really has, its own panels still kept off by avoid), not
     only inside the reserve band every seat keeps (the sidebar as if open): a GM with the sidebar folded has 300 px more room on the right
     (live, crowded board: the critical's word over a bystander though the band's right edge was free map). Only here: every clean place in the
     band keeps its picture (the same on every seat) */
  if (!ds && seat.wide && (seat.wide.l < safe.l - 1 || seat.wide.t < safe.t - 1 || seat.wide.r > safe.r + 1 || seat.wide.b > safe.b + 1)) {
    safe = { l: Math.min(safe.l, seat.wide.l), t: Math.min(safe.t, seat.wide.t), r: Math.max(safe.r, seat.wide.r), b: Math.max(safe.b, seat.wide.b) };
    for (const kk of ks) { yield; ds = tryK(kk, true); if (!ds) { yield; ds = tryJoined(kk, true); } if (ds) { k = kk; moved = 'far'; break; } }
    /* the wider room is for CLEAN places only: the least covering stays in the band (its weights already weigh a bystander against a panel) */
    if (!ds) safe = seat.safe;
  }
  /* (SPLASHSEAT: a caller that asks only for a CLEAN place: the least-covering search below, the dear one, is its own to decide) */
  if (!ds && seat.cleanOnly) return null;
  if (!ds) {
    /* at each allowed size the parts' least covering places; the size that covers least wins (the bigger one on a tie) */
    moved = 'least';
    /* the table's order always (the arrangement is the picture: live, the GM's critical swapped to caption over word while the player's
       kept it); the parts swapped only when no allowed size has any place for them in order in the view at all */
    /* a split block in order at one size: the word part's least covering places tried in turn with the caption's best in order after each
       (taking the word part's single least covering place first could leave its caption no place in order in the view).
       -> { sum, ds, hard: what it lays on the stars or on its own letters } */
    const splitAt = function* (kk) {
      const c0 = [];
      for (const { d } of [...movesOf(P[0], kk), ...farOf(P[0], kk)]) { const q = at(P[0], kk, d); if (inSafe(q)) c0.push({ d, q, h: hitOf(q, kk, 0) }); }
      c0.sort((a, b) => a.h - b.h);
      yield;
      /* SPLASHBLOCK: EVERY place of the word part with every place of the caption (the word's 60 least covering places alone could all
         stand where no caption fits in order: live, the crowded GM view, "no place in order" and the parts swapped). The caption's places
         weighed once against the board, least first; per pair only the two parts against each other, and a pair that cannot beat the
         best is not weighed at all */
      const c1 = [];
      for (const { d } of [...movesOf(P[1], kk), ...farOf(P[1], kk)]) { const q = at(P[1], kk, d); if (inSafe(q)) c1.push({ d, q, h: hitOf(q, kk, 1) }); }
      c1.sort((a, b) => a.h - b.h);
      yield;
      const pairs = function* (order, lim = Infinity) {
        let best = null;
        for (const a of lim < c0.length ? c0.slice(0, lim) : c0) {
          if (best && a.h >= best.sum - 0.5) break;
          yield;
          const core = coreAt(0, a.q, kk) ?? a.q, more = partsAs([[core, 0, a.q, kk]]);
          for (const b of c1) {
            if (best && a.h + b.h >= best.sum - 0.5) break;
            if (!order(b.q, a.q)) continue;
            const h = a.h + b.h + hitOf(b.q, kk, 1, more) - hitOf(b.q, kk, 1);
            if (!best || h < best.sum - 0.5) best = { sum: h, ds: [a.d, b.d] };
          }
        }
        return best;
      };
      /* what a choice lays on the moment's stars (the star's cut-in, the target, the roller: the weights from TOKEN_W up) or on its own
         other part's letters */
      const heavy = avoid.filter((a) => (a.w ?? 1) >= TOKEN_W);
      const hard = (c) => {
        const q0 = at(P[0], kk, c.ds[0]), q1 = at(P[1], kk, c.ds[1]), g0 = coreAt(0, q0, kk) ?? q0, g1 = coreAt(1, q1, kk) ?? q1;
        let v = blockHits(g0, heavy) + blockHits(g1, heavy) + (area(g0, Hg) + area(g1, Hg)) * TOKEN_W;
        for (const a of bareAt(0, q0, kk)) for (const b of bareAt(1, q1, kk)) v += area(a, b) * PART_W;
        return v;
      };
      /* SPLASHBLOCK: only a choice that lies on the stars (or has no place in order at all) looks further, a step at a time:
         1 the parts as near each other as their LETTERS allow (tighter than the table set them), or the two JOINED (the caption right
           under, over or beside its word, moved as one block);
         2 the caption's lines past the word's end (its middle still on its side of the word's middle: a short line beside the last letter,
           the long ones under it), where the view is not as tall as the two one under the other.
         Each settles: the places tried stand a step of the view apart (1/16 of its free room: 30-70 px), so the best of them may graze the
         star by a few px where a place a few px on is clear; each part in turn is nudged (64 .. 4 px, the eight ways) while the two together
         cover less. The caption must not buy the star's clear face by lying on its own word (live, the crowded GM view: "6 SIXES" on the
         end of the critical's word), nor its order by lying on the star */
      const inInk = (i, q) => { const c = bareU(i, q, kk) ?? q; return c.l >= safe.l - 1 && c.t >= safe.t - 1 && c.r <= safe.r + 1 && c.b <= safe.b + 1; };
      const settle = (cand, order, ink = false) => {
        const tot = (d0, d1) => { const q0 = at(P[0], kk, d0), q1 = at(P[1], kk, d1); if (!(ink ? inInk(0, q0) && inInk(1, q1) : inSafe(q0) && inSafe(q1)) || !order(q1, q0)) return Infinity;
          return hitOf(q0, kk, 0) + hitOf(q1, kk, 1, partsAs([[coreAt(0, q0, kk) ?? q0, 0, q0, kk]])); };
        let cur = { ds: cand.ds.map((d) => ({ dx: d.dx, dy: d.dy })), sum: tot(cand.ds[0], cand.ds[1]) };
        if (!Number.isFinite(cur.sum)) return cand;
        for (const st of [64, 32, 16, 8, 4]) for (let n = 0; n < 8; n++) {
          let nx = null;
          for (const i of [0, 1]) for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
            const ds2 = cur.ds.map((d, j) => (j === i ? { dx: d.dx + ux * st, dy: d.dy + uy * st } : d)), v = tot(ds2[0], ds2[1]);
            if (v < (nx?.sum ?? cur.sum) - 0.5) nx = { ds: ds2, sum: v };
          }
          if (!nx) break;
          cur = nx;
        }
        return cur.sum < cand.sum - 0.5 ? cur : cand;
      };
      const byInk = (q, q0) => orderInk(q, q0, kk), byMid = (q, q0) => orderMid(q, q0, kk);
      /* first as before: the word part's 60 least covering places, the caption's best in order after each. Wherever that choice keeps off
         the stars, it stands (the weights were tuned on it: a wider search trades a bystander at a far zoom for the party corner) */
      const byRoom = (q, q0) => orderOk(1, q, q0);
      let cand = yield* pairs(byRoom, 60);
      /* 0 EVERY place of the word part with every place of the caption (the word's 60 least covering places alone could all stand where
           no caption fits in order: live, the crowded GM view, "no place in order" and the parts swapped) */
      if (!cand || hard(cand) > eps) { const t = yield* pairs(byRoom); if (t && (!cand || t.sum < cand.sum - 0.5)) cand = t; }
      for (const order of [byInk, byMid]) {
        if (cand && hard(cand) <= eps) break;
        const t = yield* pairs(order); if (t && (!cand || t.sum < cand.sum - 0.5)) cand = t;
        if (order === byInk) { yield; const j = tryJoined(kk, true, true); if (j && (!cand || j.sum < cand.sum - 0.5)) cand = j; }
        yield;
        if (cand) cand = settle(cand, order);
      }
      if (!cand) return { sum: 1e15, ds: [z, z], hard: Infinity };
      /* 3 and, still on them, by their LETTERS alone inside the view (their entrance room and standing ink may pass its edge) */
      if (hard(cand) > eps) { yield; cand = settle(cand, byMid, true); }
      return { ...cand, hard: hard(cand) };
    };
    let bestAll = null;
    for (const keep of [true, false]) for (const kk of ks) {
      if (!keep && (!rel || (bestAll && bestAll.sum < 1e15))) break;
      yield;
      const dd = [], placed = [], qs = [];
      let sum = 0;
      if (keep && rel && P.length === 2) {
        const cand = yield* splitAt(kk);
        if (!bestAll || cand.sum < bestAll.sum * 0.9 - 0.5) bestAll = { k: kk, ds: cand.ds, sum: cand.sum, keep, hard: cand.hard };
        continue;
      }
      for (let i = 0; i < P.length; i++) {
        const p = P[i], more = partsAs(placed);
        let best = null;
        for (const { d } of [...movesOf(p, kk), ...farOf(p, kk)]) { const q = at(p, kk, d); if (!inSafe(q) || (keep && !orderOk(i, q, qs[0]))) continue; const h = hitOf(q, kk, i, more); if (!best || h < best.h - 0.5) best = { d, h }; }
        const d = best?.d ?? z;
        sum += best ? best.h : 1e15;   // no place at all (in the view, in order): never chosen over one that has
        dd.push(d); { const q = at(p, kk, d); placed.push([coreAt(i, q, kk) ?? q, i, q, kk]); qs.push(q); }
      }
      if (!bestAll || sum < bestAll.sum * (keep ? 0.9 : 0.5) - 0.5) bestAll = { k: kk, ds: dd, sum, keep };
    }
    k = bestAll.k; ds = bestAll.ds; if (!bestAll.keep) moved = 'swapped';
  }
  if (moved === 'none' && k < 0.999) moved = 'scaled';
  /* apply: every item (and the gauge) with its part */
  const mv = (i, x, y) => { const p = P[i], q = at(p, k, ds[i]); return { x: q.ax + (x + p.tx - q.ax) * k + ds[i].dx, y: q.ay + (y + p.ty - q.ay) * k + ds[i].dy }; };
  const items = table.items.map((it, n) => {
    const i = ipi[n], m = mv(i, it.x, it.y);
    return { ...it, x: Math.round(m.x), y: Math.round(m.y), ...(k !== 1 ? { S: Math.round(it.S * k * 10) / 10, w: it.w * k, h: it.h * k } : {}) };
  });
  let gauge = table.gauge ? { ...table.gauge } : null;
  if (gauge) { const i = gpi, m = mv(i, gauge.x, gauge.y); Object.assign(gauge, { x: Math.round(m.x), y: Math.round(m.y), w: gauge.w * k, h: gauge.h * k, k: (gauge.k ?? 1) * k }); }
  const parts = P.map((p, i) => { const q = at(p, k, ds[i]); return { l: q.l, t: q.t, r: q.r, b: q.b }; });
  const rect = { l: Math.min(...parts.map((q) => q.l)), t: Math.min(...parts.map((q) => q.t)), r: Math.max(...parts.map((q) => q.r)), b: Math.max(...parts.map((q) => q.b)) };
  return { ...table, items, rect, ...(parts.length === 2 ? { parts, pi: ipi, gpi, rel } : {}), gauge, k, moved, d: ds.map((d) => ({ dx: Math.round(d.dx), dy: Math.round(d.dy) })), f: (table.f ?? 1) * k,
    hit: P.reduce((s, p, i) => s + hitOf(at(p, k, ds[i]), k, i), 0) };
}
const SP_shiftInto = shiftInto;
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
