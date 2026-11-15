/* PALETTE (2026-11-15, the owner: «Haymaker, to chyba opis z fighting? Jest różowy. Nie chcę żeby najczęstsze napisy były różowe»): the
   colours of the module's own lettering (the dice-roll splash, scripts/splash/; the token reactions, scripts/tokenreact/) in ONE place. PURE
   (no DOM, no Foundry) except the guarded hook at the end, which only follows the table's palette.

   Where the pink came from: the splash's "power climb" (FXLD, logic.mjs hueOf: yellow -> orange -> red -> MAGENTA -> VIOLET, pale fills)
   painted every roll from P 0.5 up in rose, pink, magenta or lilac: every strong and critical word of every family (HAYMAKER! in lilac,
   KA-THWAPP! in hot pink), their captions and the wreck; and the token reactions' Resolve family (stress words, Resolve numbers, the
   token's tint) was magenta, "out" violet.

   The system now: the colours that carry a superhero fight comic's sound effects. Flat saturated faces, a thin black keyline, one
   deep duplicate block (the engine's invincible look, LOOK2). The ordinary result keeps the colour of its own sound (the engine's: blows
   white on red, blasts yellow, fire orange, zaps cyan, water blue, rock bone); a better result climbs the HEAT ladder of the fight
   comics' biggest effects: orange (strong) -> red on a gold block (critical, the loudest thing on the table). Misses stay cold grey-blue,
   sixes gold, the odds a white stamp, stress blood red, a wreck the colour of rubble. Token reactions: Health loss amber, a knock-down
   white on red (the knock-out blow), healing green, Resolve loss blood red (the splash's stress colour: one colour for strain at the
   table), broken (Resolve 0) indigo, Resolve back teal. No pink or magenta anywhere: OKLCH hue 290..360 and 0..15 with chroma >= 0.04 and
   lightness >= 0.3 (sweep-checks/palette.mjs). The table's two other palettes (the engine's `palette` preference, a table setting):
   "contrast" keeps our faces but makes the dark ones light (the engine then inks keyline and block black), "cvd" swaps to the Okabe-Ito
   hues that stay apart for protan, deutan and tritan viewers (the engine leaves a caller's own colours alone, so the swap is ours). */

export const PALETTES = Object.freeze(['mood', 'contrast', 'cvd']);
let current = 'mood';
/** the table's palette (the engine's L.table.palette): the same on every seat. Returns the palette in use. */
export function usePalette(p) { current = PALETTES.includes(p) ? p : 'mood'; return current; }
export const paletteNow = () => current;
const pick = (v) => (v && !Array.isArray(v) && typeof v === 'object' && 'mood' in v ? (v[current] ?? v.mood) : v);
const fz = (o) => Object.freeze(o);

/* ---------------- the splash ---------------- */
const INK = '#141414', PAPER = '#ffffff';
/* the heat ladder of a success from P 0.4: [fill light, mid (the flat face), dark], block = the duplicate behind the letters */
export const CLIMB = fz({
  strong: fz({ mood: fz({ fill: fz(['#ffd7a6', '#ff8a1f', '#c24a0a']), ext: '#5c170b' }),
    contrast: fz({ fill: fz(['#ffe6c7', '#ffb066', '#ff8a1f']), ext: '#000000' }),
    cvd: fz({ fill: fz(['#ffe2a0', '#e69f00', '#a35a00']), ext: '#3a2000' }) }),
  /* a family whose ordinary words the engine already letters in red (force: HNH! HEAVE!) keeps red when strong, never cooler */
  strongRed: fz({ mood: fz({ fill: fz(['#ffc2b8', '#ec2a2b', '#7c0616']), ext: '#3b0710' }),
    contrast: fz({ fill: fz(['#ffd9d0', '#ff8a78', '#ff5a44']), ext: '#000000' }),
    cvd: fz({ fill: fz(['#ffd2a8', '#d55e00', '#7a2a00']), ext: '#2a0a00' }) }),
  critical: fz({ mood: fz({ fill: fz(['#ffc2b8', '#ec2a2b', '#7c0616']), ext: '#ffd31a' }),
    contrast: fz({ fill: fz(['#ffd9d0', '#ff8a78', '#ff5a44']), ext: '#000000' }),
    cvd: fz({ fill: fz(['#ffd2a8', '#d55e00', '#7a2a00']), ext: '#f0e442' }) })
});
/* families whose ordinary words are already hot (the engine's red), by family id (the check reads the engine's own faces to keep this true) */
export const HOT_FAMILY = fz({ force: 'strongRed' });
/* the caption of a strong or critical roll (the sentence): pale apricot, read not heard; a weaker roll keeps the old pale tint */
export const SAY_HOT = fz(['#fff8ec', '#ffe6c4', '#f6c27e']);
/* the wreck beside a smashing blow: the colour of rubble (the engine's stone), its own block */
export const WRECK = fz({ fill: fz(['#f5ecda', '#e7d5b2', '#b89a6a']), ext: '#5a391b' });
/* the fixed ones (unchanged: the table has learnt them) */
export const SIX = fz(['#fff7c8', '#ffd23f', '#e06a00']);       // sixes: always gold (the die's best face)
export const ODDS = fz(['#ffffff', '#e4e9f6', '#8d98b8']);      // the odds figure: a plain white stamp
export const STRESS = fz(['#ffd3d9', '#ff3b52', '#7c0616']);    // stress: blood red (the light stop is never painted: flat face = mid)
/* the stress number in the table's palette: blood red; lighter on high contrast (7:1 on its black keyline), vermilion for colour-blind eyes */
export const stressColors = () => pick({ mood: STRESS, contrast: fz(['#ffe9e2', '#ff8a78', '#ff5a44']), cvd: fz(['#ffd2a8', '#d55e00', '#7a2a00']) }).slice();
export const FAIL = fz(['#eef0f7', '#a3abc4', '#4a5272']);      // a miss: cold, drained
export const SOFT = fz(['#f0eff6', '#cfcddc', '#8d8ba0']);      // a routine miss: a light grey mutter
export const MISS_SAY = fz(['#f2f5ff', '#c9d4f5', '#7d8fc9']);  // UNLUCKY / WHAT A FLOP: pale cold blue

/** the climb step of a success word: null (the sound's own colour) or { fill, ext } for this palette */
export function climbOf(P, rank, family) {
  if (!(P >= 0.4)) return null;
  /* high contrast paints every block black, so a hot family's red is kept for the critical alone there: rank still reads by the face */
  const step = rank === 'critical' ? 'critical' : (current === 'contrast' ? 'strong' : (HOT_FAMILY[family] ?? 'strong'));
  return pick(CLIMB[step]);
}
/** the engine hand that pins the climb's block (the engine's `colors` set the faces only; the block would stay the sound's own, and a
    red face on the blows' red block vanishes) */
export const climbHand = (c) => (c ? { pal: { fill: c.fill.slice(), ext: c.ext, out2: PAPER, ink: INK } } : null);

/* ---------------- the token reactions ---------------- */
/* fill light -> dark: a word's flat face is the mid stop */
export const TOKEN = fz({
  health: fz({ mood: fz(['#fff4b8', '#ffb02e', '#d4231c']), cvd: fz(['#fff3b0', '#e69f00', '#a35a00']) }),
  down: fz({ mood: fz(['#ffffff', '#fbfaf3', '#d0262a']) }),
  heal: fz({ mood: fz(['#efffd9', '#7fd65a', '#1d7a36']), cvd: fz(['#e0f3ff', '#56b4e9', '#0072b2']) }),
  resolve: fz({ mood: fz(['#ffe2d8', '#ff3b52', '#7c0616']), contrast: fz(['#ffe9e2', '#ff8a78', '#ff5a44']), cvd: fz(['#ffd2a8', '#d55e00', '#7a2a00']) }),
  out: fz({ mood: fz(['#ecebff', '#8a7bff', '#2a1f7a']), contrast: fz(['#f1efff', '#aea4ff', '#8a7bff']), cvd: fz(['#ffffff', '#bbbbbb', '#5e5e5e']) }),
  steady: fz({ mood: fz(['#e6fff9', '#3fd8c4', '#145f7a']), cvd: fz(['#fffbd0', '#f0e442', '#9a8a00']) })
});
/* the duplicate block of each token word (the engine's own block of the sound otherwise: a white knock-out face needs its red block) */
export const TOKEN_EXT = fz({ down: '#b8211b', resolve: '#3b0710', out: '#1c1450' });
export const tokenColors = (fam) => pick(TOKEN[fam] ?? TOKEN.health).slice();
export function tokenHand(fam) {
  const ext = TOKEN_EXT[fam];
  if (!ext) return null;
  const f = tokenColors(fam);
  return { pal: { fill: f, ext: current === 'contrast' ? '#000000' : ext, out2: PAPER, ink: INK } };
}
/* the numbers: one hand for every number, only the colour says the track and the way (fill light -> dark, painted as a top-down gradient) */
export const NUM = fz({
  'health-': fz({ mood: fz({ fill: fz(['#fffbe6', '#ffd84a', '#ff7a1a']), ext: '#7a1608' }), cvd: fz({ fill: fz(['#fffbe0', '#f0e442', '#e69f00']), ext: '#4a3000' }) }),
  'health+': fz({ mood: fz({ fill: fz(['#f4fff0', '#97f27e', '#22a84a']), ext: '#0b3a1a' }), cvd: fz({ fill: fz(['#eef8ff', '#9fd8ff', '#56b4e9']), ext: '#0a2c4a' }) }),
  'resolve-': fz({ mood: fz({ fill: fz(['#fff1ea', '#ff7f6e', '#d8141f']), ext: '#3a0610' }), cvd: fz({ fill: fz(['#ffe2c8', '#ff9a4a', '#d55e00']), ext: '#3a1200' }) }),
  'resolve+': fz({ mood: fz({ fill: fz(['#ecfffb', '#7ff2df', '#17a69c']), ext: '#073b3a' }), cvd: fz({ fill: fz(['#fffbd0', '#f0e442', '#9a8a00']), ext: '#2a2600' }) })
});
export const numPal = (key) => { const p = pick(NUM[key] ?? NUM['health-']); return { fill: p.fill.slice(), ext: p.ext }; };
/* the token picture's tint for a moment (tokenanim): the same families as the words */
export const TINT = fz({ blow: 0xff4a3a, down: 0xd4231c, heal: 0x8fe86a, stress: 0xd8141f, out: 0x8a7bff, steady: 0x3fd8c4 });

/* ---------------- colour measures (the checks and the sheets use them) ---------------- */
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (hex) => { const n = parseInt(String(hex).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => lin(v / 255)); };
export function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export function oklch(hex) { const [L, a, b] = oklab(rgb(hex)); return { L, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 }; }
/** pink or magenta: OKLCH hue 290..360 or 0..15, chroma >= 0.04 (not a grey), lightness >= 0.3 (a darker colour reads as a dark block) */
export const PINK = fz({ from: 290, to: 15, minC: 0.04, minL: 0.3 });
export function isPink(hex) { if (!/^#[0-9a-f]{6}$/i.test(hex ?? '')) return false; const o = oklch(hex); return o.C >= PINK.minC && o.L >= PINK.minL && (o.h >= PINK.from || o.h < PINK.to); }
export const luminance = (hex) => { const [r, g, b] = rgb(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/* colour-vision deficiency, full severity (Machado, Oliveira and Fernandes 2009), on linear RGB */
const CVD_M = fz({
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]]
});
export const VISIONS = Object.freeze(['normal', 'protan', 'deutan', 'tritan']);
export function seenAs(hex, vision = 'normal') {
  const c = rgb(hex), M = CVD_M[vision];
  return M ? M.map((row) => Math.min(1, Math.max(0, row[0] * c[0] + row[1] * c[1] + row[2] * c[2]))) : c;
}
/** OKLab distance of two colours as a viewer with that vision sees them */
export function deltaE(a, b, vision = 'normal') { const p = oklab(seenAs(a, vision)), q = oklab(seenAs(b, vision)); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); }
/** heat of a face on the fight ladder: yellow, white, cold or neutral 0, orange 1, red 2 (OKLCH hue 90 -> 55 -> 27, chroma >= 0.1) */
export function heatOf(hex) { const o = oklch(hex); if (o.C < 0.1 || o.h > 100 || o.h < 0) return 0; return Math.max(0, Math.min(2, o.h >= 55 ? (90 - o.h) / 35 : 1 + (55 - o.h) / 28)); }

/* ---------------- follow the table's palette (Foundry only; nothing in node) ---------------- */
if (globalThis.Hooks?.on) {
  globalThis.Hooks.on('moinenLettersTable', (table) => usePalette(table?.palette));
  globalThis.Hooks.once?.('ready', () => { try { Promise.resolve(globalThis.MoinenLetters?.engine?.()).then((L) => { if (L?.table?.palette) usePalette(L.table.palette); }).catch(() => {}); } catch { /* no engine */ } });
}
