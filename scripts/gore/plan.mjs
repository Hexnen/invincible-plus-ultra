/* GORE: blood and cracks on the screen, the PURE part (no Foundry, no DOM; node checks: scripts/sweep-checks/gore.mjs).
   The owner, 2026-11-15: «Nowy efekt, krew na ekranie i drugi pęknięcia. Warto pixelartowe. Krew będzie potencjalnie pojawiać się przy
   obrażeniach postaci. Więc muszą pojawiać się jak chlapanie.»

   Both effects live ON THE GLASS of the table's view (screen space), drawn as pixel art on a fixed grid of art pixels (ART_CSS CSS px
   each, a whole number of device px: raster.mjs, main.mjs). Everything here is a pure function of (seed, strength, grid size, time since
   the contact): every seat with the same seed sees the same splash at the same instant, laid out in fractions of its own view.

   BLOOD, one splash in layers (animation principles):
     primary   tick 0 the BURST (a small ragged core, spray lines shooting the way it flies), tick 1 the SQUASH (flattened, bigger
               than it settles), tick 2.. a ragged body; crown spikes shoot out on ticks 1-2 and end in round beads
     secondary DROPS carry the splash (GORE2, the owner: «krew potrzebuję też kropel bo na razie to jest bardziej jakby ktoś napluł»):
               flung drops seen in flight the tick before they land, squashed on landing, round or exclamation-mark shaped (head out,
               tail home), trails of shrinking drops along the way it flew, mist; all land by distance (ticks 1-6)
     consequence the bottom rim swells into beads (anticipation) and RUNS: stick-slip drips down the glass; the blood DRIES
               (wet with a glint -> drying -> a dark crust, the rim darkest) and DIMS SMOOTHLY over its whole life (GORE3, the owner:
               «Krew stopniowo przygasa a powinna płynnie»: one continuous age per splash, colours and alpha glide every tick, no stage
               jumps); it CLEARS by CRUMBLING (GORE2): an erosion front by distance from the edge of EVERYTHING drawn (drips included:
               GORE3, «osypanie brzydko się urywa na dole»), on ones, with a dry ochre crust ring (GOREPINK: it was a pale salmon; no colour of the blood is pink, raster.mjs, tone.mjs), flakes that fall off; never a fade or dither
     placement (GORE3, finding 5 of the blind review): beside the STRUCK token as this seat sees it, on its far side from the
               attacker, sized by the token on this screen (capped), never on a screen whose view does not hold the token; the whole
               splash and its clearing stay inside the view (nothing is ever cut by an edge)
   CRACKS (GORE2 «gdzieś w rogach np.», GORE3 «Pęknięcia nie powinny być od impactów tylko np z rogów»): the glass breaks FROM a
     CORNER of the screen: see-through hairlines start at the corner and on its two edges and run inward (a quarter web whose centre
     is the corner itself, no strike point inside the view), a glint, a few crumbs; they hold, then the cracked glass FALLS OUT.
   SAFETY: an arrival is ONE change of the picture; big arrivals keep at least ARRIVAL_GAP ms apart (<= 2 a second, the photo-safety
   rationing of the impact frames: LIMITS.fullPerSec 2); a photosensitive seat gets the dim palette (no saturated red: R share < 0.7) and
   every arrival under SAFE_AREA of the view (WCAG 2.3.1's small safe area); a reduced-motion seat gets each stage as a still (no
   flight, no running, no glint, no chips). The middle of the view stays readable (CENTRE: big blobs never centred there, blood there
   drawn see-through). */

export const TICK_MS = 1000 / 24;          // the comic's beat: arrivals and runs step on it
export const ART_CSS = 3;                  // one art pixel = round(3 x DPR) device px (the map's lens grid: one look on the glass)
export const ARRIVAL_GAP = 500;            // ms between two big arrivals on one seat (<= 2 a second)
export const SAFE_GAP = 1000;              // ... on a photosensitive seat
export const SAFE_AREA = 0.025;            // photosensitive seat: one arrival covers at most this share of the view
export const MAX_LIVE = 6;                 // splashes alive at once; the oldest dissolves early beyond (GORE3: 8 -> 6, no piling)
export const NEAR_K = 1.1;                 // GORE3: a splash's body radius at most this x the struck token's radius on this screen
export const R_MIN = 0.02;                 // ... but never under this share of the view's short side (pixel art stays readable)
/* GOREUI (blind review of tag 161, D10: at zoom 0.2 a knock-down's blood spanned about three token widths): beside a token drawn
   small the body was as wide as the token (NEAR_K), a knock-down's second blow as big again beside it, and the drops as many and
   flying as far (5.6 body radii) as at full size, so the whole splash was four to five token widths. `far` says how small the struck
   token is on this screen: 0 from a token radius of FAR.from of the view's short side up (there NEAR_K does not bind a full blow and
   every plan is what it was), 1 at FAR.full and under. As far grows the body's cap goes from NEAR_K to NEAR_K x FAR.body token radii
   (never under R_FLOOR art px: a blot of five art pixels still reads as pixel art), the drops, mist and trails thin out to FAR.thin
   of their number and fly FAR.spread as far past the body's rim, the drops' size follows the body, a knock-down's second blow is at
   most FAR.second of the first's cap (it is the weaker blow: 0.67 is its size against the first where nothing caps them) and is left
   out from far = FAR.noSecond on (two blots side by side were most of the width). */
export const R_FLOOR = 2.5;                // art px: the smallest body radius beside a token at any zoom
export const FAR = { from: 0.057, full: 0.027, body: 0.75, second: 0.67, noSecond: 0.5, thin: 0.4, spread: 0.5 };
export const EDGE = 2;                     // art px: nothing of a splash is drawn closer to the view's edge (never cut by it)
export const TOK_GAP = 1.5;                // GORE4, art px: nothing of a splash is drawn closer to the struck token's rim (beside it, never on it)
/* GORECLEAR (live 2026-11-16: a knock-down's splash lay over the neighbouring token and over the sound word of its own blow): the blood
   also keeps clear of what this seat hands it as KEEP-OUTS (opts.keep): the other tokens it sees (discs) and the standing lettering
   (boxes). Nothing of a splash is laid closer than KEEP_GAP art px to one. It still lands: the body takes the cheapest clean place round
   the struck token (another way, a little farther out, a little smaller), never under the smallest KEEP_SHRINK share of its size. */
export const KEEP_GAP = 1.5;               // art px: nothing of a splash is drawn closer to another token's rim or a word's ink
export const KEEP_MAX = 64;                // keep-outs read per splash
export const KEEP_SHRINK = [1, 0.84, 0.7]; // the sizes tried among keep-outs (share of the splash's size beside its token)
export const KEEP_FAR = 3.2;               // how much farther out than GORE4's place the body may land, in body radii
export const MASK_GAP = 0.75;               // art px round a token's rim the glass keeps free of blood while the token is under it
export const CLEAR_FAST = 760;             // ms a splash takes to crumble away when lettering comes to stand where it lies (the last FLAKE_MS only flakes)
export const WORD_TOL = { px: 4, share: 0.012 };      // a splash gives way to lettering once more of its ink than this lies under it
export const GUARD_TICKS = 3;              // the lettering is asked for every this many ticks while blood is on the glass
export const KEEP_COST = { turn: 0.9, out: 1.7, shrink: 2.6, fan: 5 };      // per 20 degrees turned, per body radius farther, per size step, for a fully blocked spray
export const CENTRE = { rx: 0.30, ry: 0.28, alpha: 0.55 };      // the readable middle: an ellipse (fractions of the view) and blood's alpha there
export const BIG = 0.4;                    // an arrival from this strength up counts in the rationing
export const DISSOLVE = 1500;              // ms blood takes to crumble away (the last FLAKE_MS of it only flakes still falling)
export const FLAKE_MS = 420;               // ms a flake of dried crust falls before it is gone
export const FALL = 1200;                  // ms cracked glass takes to fall out (shards one after another, each FALL_MS)
export const FALL_MS = 520;

/* ---------------- seeded numbers ---------------- */
export function hash(str) {
  let h = 2166136261 >>> 0;
  const s = String(str ?? "");
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
export function rng(seed) {
  let a = (typeof seed === "number" ? seed : hash(seed)) >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, u) => a + (b - a) * u;
const easeOut = (u) => 1 - (1 - clamp(u, 0, 1)) ** 2;

/* ---------------- the table's options (world, GM: scripts/gore/main.mjs registers them) ---------------- */
/* GOREOWN (the owner, 2026-11-16: blood and cracks only for the token's owner). Who is shown a hurt character's blood and cracks:
     "owner"   (the default) only the seats of the players who own the character (each of them, when several do); the GM's seat only
               for a character no player owns (provisional, question GOREOWN-1);
     "owners"  the character's owners and the GM (the GM for every character);
     "all"     every seat that sees the character.
   The choice is stored under a NEW key (goreWho). The earlier key (OLD_SEATS_KEY: "all" by default, or "owners") is read by nobody
   any more: whatever a world stored there, the table starts on "owner", on every seat at once and with no migration step, and the GM
   may then choose again in the window. The old document is left in the world untouched (an older build of the module still finds it). */
export const KEYS = { blood: "goreBlood", cracks: "goreCracks", seats: "goreWho", hold: "goreHold" };
export const OLD_SEATS_KEY = "goreSeats";
export const SEATS = ["owner", "owners", "all"];
export const DEFAULTS = { goreBlood: 2, goreCracks: 2, goreWho: "owner", goreHold: 1 };
/** whether a seat is shown an effect of a character under the table's choice (visibility is asked apart: main.mjs mayShow).
    gm: the seat is a GM's; owner: the seat's user owns the character; playerOwned: some player (not a GM) owns it */
export function seatShows(seats, { gm = false, owner = false, playerOwned = false } = {}) {
  if (seats === "all") return true;
  if (seats === "owners") return !!gm || !!owner;
  return gm ? !playerOwned : !!owner;
}
/* the 0..3 slider (the owner's size rule for the map lettering, 2026-11-15: 0 = none, 2 = the normal size): strength x */
export const LEVEL = [0, 0.65, 1, 1.3];
export function cleanOpts(v = {}) {
  const lvl = (x, d) => (Number.isFinite(Number(x)) ? clamp(Math.round(Number(x)), 0, 3) : d);
  return {
    blood: lvl(v.goreBlood, DEFAULTS.goreBlood),
    cracks: lvl(v.goreCracks, DEFAULTS.goreCracks),
    seats: SEATS.includes(v.goreWho) ? v.goreWho : DEFAULTS.goreWho,
    hold: Number.isFinite(Number(v.goreHold)) ? clamp(Number(v.goreHold), 0.5, 2) : DEFAULTS.goreHold
  };
}

/* ---------------- from a change of a character to an effect (GORE-1, GORE-2, GORE-3: provisional, combat-questions.md) ----------------
   change = { stat: "health" | "resolve", from, to, max, type: actor type, push: the character chose that stress }
   -> null | { kind: "blood" | "cracks", strength 0..1, down } */
export function effectOf(ch) {
  if (!ch || ch.type === "challenge") return null;      // a challenge's "Health" is its Challenge Rating: nothing bleeds
  if (!Number.isFinite(ch.from) || !Number.isFinite(ch.to) || !(ch.to < ch.from)) return null;
  const loss = ch.from - ch.to, max = Math.max(1, Number.isFinite(ch.max) && ch.max > 0 ? ch.max : Math.max(ch.from, 1));
  const share = clamp(loss / max, 0, 1);
  const down = ch.to <= 0;
  let s = clamp(0.22 + 0.85 * share, 0.22, 0.9);
  if (down) s = 1;
  if (ch.stat === "health") return { kind: ch.type === "vehicle" ? "cracks" : "blood", strength: s, down };
  if (ch.stat === "resolve") return ch.push ? null : { kind: "cracks", strength: down ? 1 : clamp(s * 0.9, 0.2, 0.85), down };
  return null;
}
/** the strength a seat plays: the effect's, times the table's level (0 = off) */
export function scaled(strength, level) {
  const k = LEVEL[clamp(Math.round(level ?? 2), 0, 3)];
  return k ? clamp(strength * k, 0.12, 1.25) : 0;
}

/* ---------------- the grid ---------------- */
/** the art grid for a view of vw x vh CSS px at dpr: px = device px per art px (whole), w x h art px covering the view */
export function grid(vw, vh, dpr = 1) {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const px = Math.max(1, Math.round(ART_CSS * d));
  const w = Math.max(8, Math.ceil((vw * d) / px)), h = Math.max(8, Math.ceil((vh * d) / px));
  return { px, w, h, dpr: d, css: px / d, vw, vh };
}

/* ---------------- arrivals (rationing; pure so the checks can run it) ---------------- */
/** when an effect asked for at `want` (ms) may arrive, given this seat's earlier big arrivals (sorted ms); small ones are never moved */
export function arrivalAt(want, strength, past = [], safe = false) {
  if (strength < BIG && !safe) return want;
  const gap = safe ? SAFE_GAP : ARRIVAL_GAP;
  let t = want;
  for (const p of [...past].sort((a, b) => a - b)) if (t < p + gap && t > p - gap) t = p + gap;
  return t;
}

/* ---------------- BLOOD: the plan of one splash ----------------
   opts = { strength, seed, dir (radians, the way the blood flies; null = from the seed), at ({ fx, fy } fractions; null = by dir),
            safe (photosensitive), still (reduced motion), hold (x) }; g = grid(...) */
export function bloodPlan(g, opts = {}) {
  const r = rng(`blood|${opts.seed ?? "x"}`);
  let s = clamp(Number(opts.strength) || 0.5, 0.12, 1.25);
  const m = Math.min(g.w, g.h);
  let dir = Number.isFinite(opts.dir) ? opts.dir : r() * Math.PI * 2;
  /* GORE2 (the owner: «krew potrzebuję też kropel bo na razie to jest bardziej jakby ktoś napluł»): a SMALLER body and much more of the
     blood in DROPS (crown spikes with beads, flung drops shaped like an exclamation mark, trails of drops along the way it flew) */
  let R = (0.017 + 0.046 * Math.min(s, 1) + 0.012 * Math.max(0, s - 1)) * m;
  /* photosensitive seat: the whole splash (body + crown + drops ~ 2.6 x the body's area) under SAFE_AREA of the view */
  if (opts.safe) R = Math.min(R, Math.sqrt((SAFE_AREA * g.w * g.h) / (Math.PI * 2.6)));
  /* GORE3 (finding 5): beside the struck token as this seat sees it. near = { fx, fy (its middle), fr (its radius / the view's short
     side) }: the splash is sized by the token on this screen (a far zoom = a small token = a small splash, never a screen-sized blot over
     the board) and lands just past the token on the side away from the attacker (the token stays readable) */
  const near = opts.near && Number.isFinite(opts.near.fx) && Number.isFinite(opts.near.fy) ? opts.near : null;
  const tokR = near ? Math.max(1, (Number(near.fr) || 0.03) * m) : 0;
  const Rfree = R;
  /* GOREUI: far = how small the struck token is drawn (0 = FAR.from of the short side and over, 1 = FAR.full and under) */
  const Rk = R_MIN * m, cap = NEAR_K * tokR;
  const far = near ? clamp((FAR.from * m - tokR) / ((FAR.from - FAR.full) * m), 0, 1) : 0;
  if (near) {
    if (far > 0) { const c = Math.max(R_FLOOR, cap * lerp(1, FAR.body, far)); R = Math.min(R, opts.second ? Math.max(R_FLOOR, FAR.second * c) : c); }
    else R = Math.min(R, Math.max(Rk, cap));
  }
  /* GORE4 (GORE3's own weak point: a splash beside a token at the view's edge was pushed back by the edge ONTO the token's rim): the
     blood stands BESIDE the struck token, never on it. tok = the disc nothing of the splash may enter (its rim + TOK_GAP art px).
     When the side the blood flies to has no room between the token and the view's edge, the whole splash turns to the nearest side
     that has (the seed picks left or right first); its seeded numbers are the same either way (dir is only added to them). */
  const tok = near ? { x: near.fx * g.w, y: near.fy * g.h, r: tokR + TOK_GAP } : null;
  const hasAt = !!(opts.at && Number.isFinite(opts.at.fx) && Number.isFinite(opts.at.fy));
  const keepOf = (rad) => rad * 1.36 + EDGE + 1;
  /* GORECLEAR: the keep-outs on this grid: discs { x, y, r } and boxes { x0, y0, x1, y1 }, each grown by KEEP_GAP */
  const obs = [];
  for (const q of Array.isArray(opts.keep) ? opts.keep.slice(0, KEEP_MAX) : []) {
    if (!q) continue;
    if (Number.isFinite(q.fx) && Number.isFinite(q.fy) && Number.isFinite(q.fr)) obs.push({ x: q.fx * g.w, y: q.fy * g.h, r: Math.max(1, q.fr * m) + KEEP_GAP });
    else if (Number.isFinite(q.l) && Number.isFinite(q.t) && q.r > q.l && q.b > q.t) obs.push({ x0: q.l * g.w - KEEP_GAP, y0: q.t * g.h - KEEP_GAP, x1: q.r * g.w + KEEP_GAP, y1: q.b * g.h + KEEP_GAP });
  }
  for (const o of obs) { if (o.r !== undefined) { o.bx0 = o.x - o.r; o.bx1 = o.x + o.r; o.by0 = o.y - o.r; o.by1 = o.y + o.r; } else { o.bx0 = o.x0; o.bx1 = o.x1; o.by0 = o.y0; o.by1 = o.y1; } }
  /* how far (x, y) is from a keep-out's edge (art px; under 0 = inside it) */
  const gapTo = (o, x, y) => { if (o.r !== undefined) return Math.hypot(x - o.x, y - o.y) - o.r; const ax = Math.max(o.x0 - x, 0, x - o.x1), ay = Math.max(o.y0 - y, 0, y - o.y1); return ax || ay ? Math.hypot(ax, ay) : -Math.min(x - o.x0, o.x1 - x, y - o.y0, o.y1 - y); };
  /* (a keep-out's own box first: most of them are nowhere near the point asked) */
  const onKeep = (x, y, rad) => { for (const o of obs) { if (x < o.bx0 - rad || x > o.bx1 + rad || y < o.by0 - rad || y > o.by1 + rad) continue; if (gapTo(o, x, y) < rad) return true; } return false; };
  const gapAt = (x, y) => { let v = Infinity; for (const o of obs) { const q = gapTo(o, x, y); if (q < v) v = q; } return v; };
  /* the draw order of the seeded numbers below never changes with the placement, so every seat draws the same splash */
  const reach = lerp(0.68, 0.88, r());
  const perp = (r() - 0.5) * 0.5;
  const sm = Math.min(s, 1);
  /* the body: a ragged blot (four rim harmonics, the highest makes it spiky), never a smooth glob; laid out round (0, 0) first, moved to
     its place once that is known (GORE4: the place follows from the body's own outline) */
  const lob = [0, 1, 2, 3].map(() => r() * Math.PI * 2);
  const amp = [lerp(0.07, 0.13, r()), lerp(0.05, 0.09, r()), lerp(0.04, 0.07, r()), lerp(0.05, 0.09, r())];
  /* lumps round its rim (GORECLEAR: their seeded shares are drawn once, the blobs are built for a size: bodyAt) */
  const nb = 5 + Math.round(5 * sm);
  const lumps = [];
  for (let i = 0; i < nb; i++) lumps.push({ a: r() * Math.PI * 2, kd: lerp(0.8, 1.02, r()), kr: lerp(0.16, 0.32, r()), lob: [r() * 6, r() * 6, r() * 6] });
  const bodyAt = (rad) => {
    const bl = [{ x: 0, y: 0, r: rad, h: 1, at: 0, main: true, lob, amp, fq: [3, 5, 9, 15], e: 1.08 }];
    for (const q of lumps) { const d = rad * q.kd, rr = rad * q.kr; bl.push({ x: Math.cos(q.a) * d, y: Math.sin(q.a) * d, r: rr, h: 0.85, at: 1, lob: q.lob, amp: [0.1, 0.06, 0.03], e: 1 }); }
    return bl;
  };
  let none = false, spot = null, keepHow = null;
  if (tok && !hasAt && obs.length) {
    /* GORECLEAR: among keep-outs the body takes the cheapest CLEAN place round its token: each way (20 degree steps from the way it
       flies), the nearest distance where its whole outline (burst, squash, settled, lumps) is clear of the token, every keep-out and
       the view's edge; the cost weighs the turn, the distance, the size and how much of its spray would be lost there */
    const first = hash(`side|${opts.seed ?? "x"}`) & 1 ? 1 : -1;
    KEEP_SHRINK.forEach((ks, si) => {
      const rad = R * ks, k = keepOf(rad), bl = bodyAt(rad);
      for (let j = 0; j <= 18; j++) {
        const a = dir + first * (j & 1 ? 1 : -1) * Math.ceil(j / 2) * (Math.PI / 9), ol = bodyOutline(bl, a), ca = Math.cos(a), sa = Math.sin(a);
        const d0 = tok.r + rad * 0.5, dMax = tok.r + rad * (2.4 + KEEP_FAR) + 3;
        /* the body with its middle d from the token's: 1 clean, 0 not, -1 past the view's edge (nothing farther either) */
        const cleanAt = (d) => {
          const x = tok.x + ca * d, y = tok.y + sa * d;
          if (x < k || y < k || x > g.w - k || y > g.h - k) return d > tok.r + rad * 1.8 + 2 ? -1 : 0;
          /* the nearest keep-out from the body's middle: far = clean at once; inside the body's smallest drawing (0.8 of its radius) = taken */
          const g0 = gapAt(x, y);
          if (g0 < rad * 0.8) return 0;
          if (g0 >= rad * 1.5 + 2 && Math.hypot(x - tok.x, y - tok.y) >= tok.r + rad * 1.5 + 2) return 1;
          for (const [px, py, pr] of ol) {
            if (Math.hypot(x + px - tok.x, y + py - tok.y) < tok.r + pr) return 0;
            if (onKeep(x + px, y + py, pr)) return 0;
          }
          return 1;
        };
        /* in steps of two art px, then back to the nearest half px that is still clean (beside its token as close as GORE4 stood it) */
        for (let d = d0; d <= dMax; d += 2) {
          const c = cleanAt(d);
          if (c < 0) break;
          if (!c) continue;
          for (const back of [1.5, 1, 0.5]) if (d - back >= d0 && cleanAt(d - back) === 1) { d -= back; break; }
          const x = tok.x + ca * d, y = tok.y + sa * d;
          /* the spray's fan from there: the share of it that would fall on a keep-out, the token or outside the view */
          let lost = 0, nfan = 0;
          for (const u of [1.7, 2.6, 3.6, 4.6]) for (const da of [-0.45, -0.15, 0.15, 0.45]) { const fx = x + Math.cos(a + da) * rad * u, fy = y + Math.sin(a + da) * rad * u; nfan++; if (fx < EDGE + 2 || fy < EDGE + 2 || fx > g.w - 3 - EDGE || fy > g.h - 3 - EDGE || Math.hypot(fx - tok.x, fy - tok.y) < tok.r + 2 || onKeep(fx, fy, 2)) lost++; }
          const cost = Math.ceil(j / 2) * KEEP_COST.turn + ((d - d0) / rad) * KEEP_COST.out + si * KEEP_COST.shrink + (lost / nfan) * KEEP_COST.fan;
          if (!spot || cost < spot.cost - 1e-9) spot = { cost, a, x, y, rad };
          break;
        }
      }
    });
    /* no clean place at any way, distance or size tried: this seat draws no blood rather than blood on a neighbour's portrait or on
       the lettering (main.mjs: the seat's log counts it) */
    if (spot) { R = spot.rad; dir = spot.a; keepHow = "clean"; } else { none = true; keepHow = "none"; }
  }
  if (tok && !hasAt && !obs.length) {
    const first = hash(`side|${opts.seed ?? "x"}`) & 1 ? 1 : -1;
    const room = (a, rad) => { const d = tok.r + rad * 1.8 + 2, k = keepOf(rad), x = tok.x + Math.cos(a) * d, y = tok.y + Math.sin(a) * d; return x >= k && y >= k && x <= g.w - k && y <= g.h - k; };
    let found = null;
    for (let shrink = 0; shrink < 5 && found === null; shrink++) {
      for (let j = 0; j <= 18 && found === null; j++) { const a = dir + first * (j & 1 ? 1 : -1) * Math.ceil(j / 2) * (Math.PI / 9); if (room(a, R)) found = a; }
      if (found === null) R *= 0.8;
    }
    if (found === null) none = true; else dir = found;
  }
  const dx = Math.cos(dir), dy = Math.sin(dir);
  const blobs = bodyAt(R);
  /* the body's outline round its middle: the settled blot (stretched along its way), its burst and squash frames, the lumps as discs */
  const outline = bodyOutline(blobs, dir);
  const clearAt = (x, y) => (!tok || outline.every(([px, py, pr]) => Math.hypot(x + px - tok.x, y + py - tok.y) >= tok.r + pr)) && (!obs.length || outline.every(([px, py, pr]) => !onKeep(x + px, y + py, pr)));
  /* GORE3: the body and its rim lumps lie wholly inside the view (EDGE art px clear of it); what flies farther is trimmed below */
  const keep = keepOf(R);
  const inView = (x, y) => [keep * 2 < g.w ? clamp(x, keep, g.w - keep) : g.w / 2, keep * 2 < g.h ? clamp(y, keep, g.h - keep) : g.h / 2];
  let cx, cy;
  if (spot) { cx = spot.x; cy = spot.y; }
  else if (hasAt) {
    /* a given place (a public call, a knock-down's second blow): kept, but moved straight away from the token while it would lie on it */
    [cx, cy] = inView(opts.at.fx * g.w, opts.at.fy * g.h);
    if (tok && !clearAt(cx, cy)) {
      const ax = cx - tok.x, ay = cy - tok.y, al = Math.hypot(ax, ay) || 1;
      let ok = false;
      for (let d = al; d <= tok.r + R * 3 && !ok; d += 0.5) { const [x, y] = inView(tok.x + (ax / al) * d, tok.y + (ay / al) * d); if (clearAt(x, y)) { cx = x; cy = y; ok = true; } }
      if (!ok) none = true;
    }
    /* GORECLEAR: a given place that lies on a keep-out is not taken (the caller tries another: the second blow below) */
    if (obs.length && !none && !clearAt(cx, cy)) none = true;
  } else if (tok) {
    /* as close beside the token as its own outline allows (GORE3 stood it at a fixed distance: its lumps could touch the rim) */
    const far = tok.r + R * 2.4 + 3;
    [cx, cy] = inView(tok.x + dx * far, tok.y + dy * far);
    for (let d = tok.r + R * 0.5; d < far; d += 0.5) { const [x, y] = inView(tok.x + dx * d, tok.y + dy * d); if (clearAt(x, y)) { cx = x; cy = y; break; } }
    if (!clearAt(cx, cy)) none = true;
  } else {
    /* no token (a public call): on the side of the view the blood flies to, off the middle */
    [cx, cy] = inView(g.w / 2 + (dx * reach - dy * perp) * g.w / 2, g.h / 2 + (dy * reach + dx * perp) * g.h / 2);
  }
  for (const b of blobs) { b.x += cx; b.y += cy; }
  /* crown spikes: thin spokes out of the rim, most of them the way it flew, each ending in a round bead (the comic's splat) */
  const tendrils = [];
  const nt = 6 + Math.round(10 * sm);
  for (let i = 0; i < nt; i++) {
    const fwd = r() < 0.7;
    const a = fwd ? dir + (r() - 0.5) * Math.PI * 1.0 : (i / nt) * Math.PI * 2 + r() * 0.4;
    const len = R * lerp(0.5, fwd ? 2.6 : 1.2, r() ** 0.8) * (0.75 + 0.25 * sm);
    const w0 = Math.max(1.2, R * lerp(0.1, 0.2, r()));
    const x0 = cx + Math.cos(a) * R * 0.82, y0 = cy + Math.sin(a) * R * 0.82;
    const bend = (r() - 0.5) * 0.3;
    tendrils.push({ x: x0, y: y0, a, len, w0, bend, bead: Math.max(1, lerp(1.1, 2.6, r()) * Math.min(1, (R / 14) ** 0.5)), at: 1, grow: 2 });
  }
  /* drops: flung out of the hit, FLYING on the tick before they land (a head with a speed trail), then a round drop or, the faster
     ones farther out, an exclamation-mark drop (the head away from the hit, a tail pointing home); they land by distance */
  const sats = [];
  const ns = Math.round(14 + 46 * sm);
  /* a drop's size follows the blow, not the (smaller) body: the drops carry the splash */
  /* GORE4: ... but beside a small token (a far zoom) the drops shrink with the body (GORE3 kept them full size: drops as big as the
     body itself, their tails longer than the way they had flown) */
  /* GOREUI: at a far zoom (far > 0) the drops go on shrinking with the body (linear under Rk), single art pixels at the floor */
  const unit = Math.max(0.85, ((0.03 + 0.085 * sm) * m / 14) ** 0.5 * 0.95) * clamp((Math.max(R, far > 0 ? Rk : 0) / Rfree) ** 0.5, 0.5, 1) * (far > 0 ? Math.min(1, R / Rk) : 1);
  /* ... and fewer of them: of every list thrown below the i-th stays while floor((i + 1) q) > floor(i q) (the seeded numbers are all
     drawn as before, so the splash is the same one, thinner) */
  const thinQ = far > 0 ? lerp(1, FAR.thin, far) : 1;
  /* ... and they land nearer: a distance d from the body's middle becomes R + (d - R) x spread */
  const spread = far > 0 ? lerp(1, FAR.spread, far) : 1;
  const flown = (d) => (spread < 1 ? R + (d - R) * spread : d);
  const thin = (list) => { if (thinQ >= 1) return; for (let i = list.length - 1; i >= 0; i--) if (!(Math.floor((i + 1) * thinQ) > Math.floor(i * thinQ))) list.splice(i, 1); };
  for (let i = 0; i < ns; i++) {
    const fwd = r() < 0.78;
    const a = fwd ? dir + (r() - 0.5) * Math.PI * 0.8 : r() * Math.PI * 2;
    const k = fwd ? lerp(1.3, 5.6, r() ** 0.9) : lerp(1.2, 2.6, r());
    const dist = flown(R * k);
    const big = r() < 0.3;
    const rad = Math.max(far > 0 ? 0.5 : 0.6, (big ? lerp(1.9, 3.2, r()) : lerp(0.7, 1.8, r())) * unit * lerp(1.15, 0.7, (k - 1.15) / 3.5));
    /* a tail points home and ends before the body (GORE4: never through it and out of its far side) */
    const tail = k > 1.9 && r() < 0.7 ? Math.min(Math.max(2, rad * lerp(2.2, 4.2, r())), dist - R) : 0;
    const x = cx + Math.cos(a) * dist, y = cy + Math.sin(a) * dist;
    sats.push({ x, y, r: rad, a, tail, at: 1 + Math.min(5, Math.floor((k - 1.1) * 1.4)), h: 0.82, k });
  }
  /* trails: lines of drops along the way it flew, smaller and sparser away from the hit (a flung arc of blood) */
  const ntr = 1 + Math.round(2.4 * sm);
  for (let j = 0; j < ntr; j++) {
    const a0 = dir + (r() - 0.5) * 0.9, curve = (r() - 0.5) * 0.25;
    let d = R * lerp(1.25, 1.6, r());
    const end = R * lerp(4, 6.4, r()) * (0.75 + 0.25 * sm);
    let rad = Math.max(0.9, 1.9 * unit * lerp(0.85, 1.15, r()));
    while (d < end) {
      const a = a0 + curve * (d / R);
      const k = d / R;
      const fd = flown(d);
      sats.push({ x: cx + Math.cos(a) * fd, y: cy + Math.sin(a) * fd, r: rad, a, tail: rad > 1.4 && r() < 0.35 ? Math.min(rad * 2.5, Math.max(0, fd - R)) : 0, at: 1 + Math.min(5, Math.floor((k - 1.1) * 1.4)), h: 0.82, k, trail: true });
      d += Math.max(2.2, rad * lerp(2.2, 3.6, r()));
      rad = Math.max(0.6, rad * lerp(0.82, 0.95, r()));
    }
  }
  thin(sats);
  /* GORE3: nothing reaches the view's edge (a drop or a tendril cut by it would end in a straight line) and no drop lands on the struck
     token (it stays readable); a tendril too long for the room is shortened, a drop that would not fit is not thrown */
  const fits = (x, y, rad) => x - rad >= EDGE && y - rad >= EDGE && x + rad <= g.w - 1 - EDGE && y + rad <= g.h - 1 - EDGE;
  /* GORE4: ... and nothing lies on the struck token or crosses it on its way (a drop lands beyond the token only when its whole flight
     from the body passes clear of it; a tail, a crown spike, a spray line, a drip stop short of it) */
  /* GORECLEAR: ... nor on any keep-out (another token, the lettering), by the same rules */
  const onTok = (x, y, rad) => (!!tok && Math.hypot(x - tok.x, y - tok.y) < tok.r + rad + 0.75) || (obs.length > 0 && onKeep(x, y, rad + 0.75));
  const crosses = (x0, y0, x1, y1, rad) => { if (!tok && !obs.length) return false; const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0))); for (let i = 0; i <= n; i++) if (onTok(x0 + (x1 - x0) * (i / n), y0 + (y1 - y0) * (i / n), rad)) return true; return false; };
  for (let i = sats.length - 1; i >= 0; i--) {
    const q = sats[i], ux = Math.cos(q.a), uy = Math.sin(q.a);
    if (!fits(q.x, q.y, q.r * 1.4 + 1) || crosses(cx + ux * R * 0.8, cy + uy * R * 0.8, q.x, q.y, q.r * 1.4)) sats.splice(i, 1);
  }
  for (const td of tendrils) {
    const tip = (L) => [td.x + Math.cos(td.a + td.bend) * L, td.y + Math.sin(td.a + td.bend) * L];
    const hits = (L) => { if (!tok && !obs.length) return false; const n = Math.max(2, Math.ceil(L)); for (let i = 0; i <= n; i++) { const u = i / n, a = td.a + td.bend * u; if (onTok(td.x + Math.cos(a) * L * u, td.y + Math.sin(a) * L * u, Math.max(td.w0 / 2, i === n ? td.bead : 0))) return true; } return false; };
    while (td.len > 0.5 && (!fits(...tip(td.len), td.bead + 1) || hits(td.len))) td.len *= 0.85;
    if (hits(td.len)) td.len = 0;      // it starts too near the rim: no spike there
  }
  for (let i = tendrils.length - 1; i >= 0; i--) if (!(tendrils[i].len > 0)) tendrils.splice(i, 1);
  /* mist: single pixels and pairs in a wide cone */
  const mist = [];
  const nm = Math.round(8 + 60 * sm);
  for (let i = 0; i < nm; i++) {
    const a = dir + (r() - 0.5) * Math.PI * 1.2, dist = flown(R * lerp(1.3, 5.6, r()));
    mist.push({ x: cx + Math.cos(a) * dist, y: cy + Math.sin(a) * dist, two: r() < 0.25, at: 2 + Math.floor(r() * 4) });
  }
  thin(mist);
  /* the burst frame (tick 0): spray lines out of the hit, the way it flies (no glob in flight) */
  const streaks = [];
  for (let i = 0; i < 5 + Math.round(6 * sm); i++) { const a = dir + (r() - 0.5) * Math.PI * 0.9; streaks.push({ a, d0: R * lerp(0.5, 0.9, r()), len: R * lerp(0.9, 2.2, r()), w: Math.max(1, R * lerp(0.05, 0.1, r())) }); }
  for (let i = mist.length - 1; i >= 0; i--) if (!fits(mist[i].x, mist[i].y, 1.5) || onTok(mist[i].x, mist[i].y, 1.5)) mist.splice(i, 1);
  for (const st of streaks) {
    const end = (L) => [cx + Math.cos(st.a) * (st.d0 + L), cy + Math.sin(st.a) * (st.d0 + L)];
    while (st.len > 0.5 && (!fits(...end(st.len), st.w + 1) || crosses(...end(0), ...end(st.len), st.w))) st.len *= 0.85;
    if (crosses(...end(0), ...end(st.len), st.w)) st.len = 0;
  }
  for (let i = streaks.length - 1; i >= 0; i--) if (!(streaks[i].len > 0)) streaks.splice(i, 1);
  /* a drip runs straight down: it stops above the token when the token lies under it */
  const dripRoom = (x, y0) => { let room = g.h - 1 - EDGE - 3 - y0; if ((tok && Math.abs(x - tok.x) < tok.r + 4) || obs.length) for (let d = 0; d < room; d += 0.5) if (onTok(x, y0 + d, 2.75)) { room = Math.max(0, d - 1); break; } return room; };
  /* drips: from the lowest parts of the big blobs, a bead swells, then runs stick-slip */
  const drips = [];
  const nd = 1 + Math.round(4 * Math.min(s, 1));
  for (let i = 0; i < nd; i++) {
    const u = (i + 0.5) / nd, a = Math.PI / 2 + (u - 0.5) * 1.6 + (r() - 0.5) * 0.25;
    const x0 = cx + Math.cos(a) * R * 0.86, y0 = cy + Math.sin(a) * R * 0.86;
    drips.push(dripOf(r, x0, y0, R * lerp(0.7, 2.3, r()) * (0.6 + 0.4 * Math.min(s, 1)), lerp(450, 1100, r()), R > 14 ? 2 : 1, dripRoom(x0, y0)));
  }
  for (const sat of sats) if (sat.r >= 1.9 && !sat.tail && r() < 0.45) drips.push(dripOf(r, sat.x, sat.y + sat.r * 0.8, sat.r * lerp(3, 7, r()), lerp(700, 1600, r()), 1, dripRoom(sat.x, sat.y + sat.r * 0.8)));
  thin(drips);
  /* life: wet, drying, dried, cleared (ms after contact). GORE2 (the owner: «Krew bardzo słabo znika»): it clears by CRUMBLING, not by a
     screen-door dither: the dried crust erodes from its thin parts inward (mist and small drops first, the body's heart last) on twos,
     flakes of crust break off the eroding edge and fall (raster.mjs drawBlood) */
  const hold = clamp(Number(opts.hold) || 1, 0.5, 2);
  const wet = 2600 + 1500 * sm;
  const life = { wet, dry: wet + 1800, gone: (5500 + 5500 * sm) * hold, dissolve: DISSOLVE };
  life.gone = Math.max(life.gone, life.dry + 600);
  const glints = blobs.filter((b) => b.r >= 5).map((b) => ({ x: b.x - b.r * 0.42, y: b.y - b.r * 0.45, big: b.r >= 12 }));
  /* a knock-down's second blow: a second splash two ticks later, beside the first */
  /* tok: the disc the blood keeps out of (raster.mjs: no flake of its crust falls onto the token either) */
  const plan = { kind: "blood", seed: opts.seed ?? "x", s, dir, dx, dy, R, cx, cy, blobs, tendrils, sats, mist, streaks, drips, glints, life, tok,
    safe: !!opts.safe, still: !!opts.still, g: { w: g.w, h: g.h } };
  /* no room beside the token anywhere in this view (a token filling the screen): this seat draws no blood rather than blood on it */
  if (none) Object.assign(plan, { none: true, blobs: [], tendrils: [], sats: [], mist: [], streaks: [], drips: [], glints: [] });
  /* GORECLEAR: what it kept clear of and how it was placed (only among keep-outs: a plan without them is exactly GORE4's) */
  if (obs.length) Object.assign(plan, { keep: obs, keepHow: keepHow ?? (none ? "none" : "clean") });
  if (s >= 0.98 && !opts.second && !opts.safe && !none && far < FAR.noSecond) {
    const sg = r() < 0.5 ? 1 : -1, a2 = dir + sg * lerp(0.6, 1.1, r());
    /* GORECLEAR: among keep-outs the second blow tries the other ways round the first when its own place is taken */
    for (const turn of obs.length ? [0, -1.4, 0.7, -2.1, 1.4, -2.8, 2.1] : [0]) {
      const a = a2 + sg * turn;
      const p2 = bloodPlan(g, { ...opts, strength: 0.55, seed: `${opts.seed}|2`, dir: a, second: true,
        at: { fx: clamp((cx + Math.cos(a) * R * 2.2) / g.w, 0.04, 0.96), fy: clamp((cy + Math.sin(a) * R * 2.2) / g.h, 0.04, 0.96) } });
      if (!p2.none) { plan.second = { plan: p2, delay: 2 * TICK_MS }; break; }
    }
  }
  return plan;
}
/* GORE4: the body's outline as [x, y, r] discs round its middle (r = 0: a point of the main blot's rim, the farthest of its burst,
   squash and settled drawings: raster.mjs blob(); the lumps as discs with their own lobes) */
function bodyOutline(blobs, dir) {
  const out = [], main = blobs[0], N = 96;
  const sum = main.amp.reduce((a, c) => a + c, 0);
  for (let j = 0; j < N; j++) {
    const th = (j / N) * 2 * Math.PI - Math.PI, phi = th - dir;
    let v = 0;
    for (let q = 0; q < main.fq.length; q++) v += main.amp[q] * Math.sin(main.fq[q] * th + main.lob[q]);
    const settled = main.r * (1 + v) / Math.hypot(Math.cos(phi) / main.e, Math.sin(phi));
    const squash = main.r * 1.1 * (1 + 0.5 * v);
    const burst = main.r * 0.55 * (1 + 1.8 * v);
    /* + the rim's finest lobe between two samples, and the pixel grid */
    const rho = Math.max(settled, squash, burst) + main.r * sum * 0.12 + 1;
    out.push([Math.cos(th) * rho, Math.sin(th) * rho, 0]);
  }
  for (const b of blobs.slice(1)) { const sa = b.amp.reduce((a, c) => a + c, 0); out.push([b.x, b.y, b.r * Math.max(1 + sa, 1.1 * (1 + 0.5 * sa)) + 1]); }
  return out;
}
function dripOf(r, x, y, len, start, w, room = Infinity) {
  len = Math.max(0, Math.min(len, room));
  /* stick-slip: segments of (wait ms, slide px, speed px/s); the bead swells for `swell` ms before the first slide */
  const segs = [];
  let sum = 0;
  while (sum < len) {
    const d = Math.min(len - sum, lerp(3, 12, r()));
    segs.push({ wait: lerp(60, 300, r()), d, v: lerp(70, 170, r()) });
    sum += d;
  }
  return { x, y, len: sum, start, swell: 320, segs, wob: r() * 6, w };
}
/** how far a drip has run at ms after contact (px), and whether it is moving */
export function dripAt(d, ms) {
  let t = ms - d.start - d.swell;
  if (t <= 0) return { y: 0, moving: false, swell: clamp((ms - d.start) / d.swell, 0, 1) };
  let y = 0;
  for (const s of d.segs) {
    if (t < s.wait) return { y, moving: false, swell: 1 };
    t -= s.wait;
    const need = (s.d / s.v) * 1000;
    if (t < need) return { y: y + s.d * (t / need), moving: true, swell: 1 };
    t -= need; y += s.d;
  }
  return { y: d.len, moving: false, swell: 1 };
}

/* ---------------- CRACKS: the plan of one break ----------------
   GORE2 (the owner: «Nich pęknięcia będą dużo subtelniejsze, gdzieś w rogach np.»): small, see-through, in a CORNER of the view (the
   seed picks the corner, so every seat shows the same one). GORE3 (the owner: «Pęknięcia nie powinny być od impactów tylko np z
   rogów»): the glass breaks FROM that corner, not from a strike point: the web's centre is the screen's corner itself (a little crushed
   glass right in it), the main cracks start in the corner and on its two edges and run INTO the view, fanning across the corner's
   quarter; rings are arcs round the corner. A broken Resolve breaks it twice: a second burst three ticks later from farther along the
   same corner's edges. It ends by FALLING OUT (GORE2): the cracked glass breaks into the shards its own cracks drew and they drop out
   one after another, the crushed corner first (raster.mjs shardsOf). */
export const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];      // top left, top right, bottom right, bottom left (fractions of the view)
/* GOREUI (blind review of tag 161, D6: level 3 was not visibly bigger than level 2). The table's level reached a break only through its
   strength (x LEVEL), and a web's reach grew by 0.13 of the short side over the WHOLE strength range, capped at strength 1: the same
   blow at level 2 and 3 differed by 13 % in reach, a broken Resolve by nothing. The level now also sizes the web itself:
   CRACK_LEVEL x its reach (and the stretch of the corner's edges it starts on), so one blow at the three levels is a small break by the
   corner / today's web / a web about a third as far again with one more ring. All three are the same hairlines (the same colours and
   alphas: none is louder, a higher level is only larger); level 2 is exactly the web it was. */
export const CRACK_LEVEL = [0, 0.66, 1, 1.35];
/** a web's reach from its corner as a share of the view's short side: strength (already x the table's LEVEL), the table's level, a
    photosensitive seat */
export function crackReachOf(strength, level = 2, safe = false) {
  const sm = Math.min(clamp(Number(strength) || 0.5, 0.12, 1.25), 1);
  return (0.1 + 0.13 * sm) * (safe ? 0.8 : 1) * CRACK_LEVEL[clamp(Math.round(Number.isFinite(level) ? level : 2), 1, 3)];
}
/** the corner a seed breaks (0..3: CORNERS) when nothing else decides */
export const seedCorner = (seed) => Math.floor(rng(`cracks|${seed ?? "x"}`)() * 4);
/* GOREUI (D6: the web lay over the toolbar's and the sidebar's icons and over a panel's header): the cracks are drawn UNDER the
   interface now (main.mjs), so nothing of the interface is ever under them; a corner that the interface, a token or a map marker fills
   would hide the web or be crossed by it, so each seat breaks the corner that shows the web best. scores = for each corner the share
   (0..1) of the web's quarter that is taken there on this seat. The seed's corner is kept whenever it is within CORNER_TOL of the
   freest (seats with alike screens still break the same corner); else the next such corner clockwise from it. */
export const CORNER_TOL = 0.12;
export function pickCorner(seed, scores = null) {
  const c0 = seedCorner(seed);
  if (!Array.isArray(scores) || scores.length !== 4 || !scores.every((v) => Number.isFinite(v))) return c0;
  const best = Math.min(...scores);
  for (let k = 0; k < 4; k++) { const c = (c0 + k) % 4; if (scores[c] <= best + CORNER_TOL) return c; }
  return c0;
}
/** the points (fractions of the view) a seat probes to score a corner: a grid over the quarter disc of the web's reach (share of the
    view's short side) round that corner */
export function cornerProbe(corner, reach, vw, vh, n = 9) {
  const [kx, ky] = CORNERS[((corner % 4) + 4) % 4], R = reach * Math.min(vw, vh), out = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const dx = ((i + 0.5) / n) * R, dy = ((j + 0.5) / n) * R;
    if (dx * dx + dy * dy > R * R) continue;
    out.push({ fx: (kx ? vw - dx : dx) / vw, fy: (ky ? vh - dy : dy) / vh });
  }
  return out;
}
export function crackPlan(g, opts = {}) {
  const r = rng(`cracks|${opts.seed ?? "x"}`);
  const s = clamp(Number(opts.strength) || 0.5, 0.12, 1.25);
  const sm = Math.min(s, 1);
  const m = Math.min(g.w, g.h);
  const seeded = Math.floor(r() * 4);      // (always drawn: the web's own numbers do not depend on which corner it breaks)
  const corner = Number.isInteger(opts.corner) ? ((opts.corner % 4) + 4) % 4 : seeded;
  const level = clamp(Math.round(Number.isFinite(opts.level) ? opts.level : 2), 1, 3), lk = CRACK_LEVEL[level];
  const [kx, ky] = CORNERS[corner];
  const sx = kx ? -1 : 1, sy = ky ? -1 : 1;                   // the way into the view from that corner
  const ox = kx * g.w, oy = ky * g.h;                         // the corner: the web's centre (a pixel's edge, not inside the view)
  /* a direction into the view by its angle across the corner's quarter: u 0 = along the horizontal edge, 1 = along the vertical one */
  const way = (u) => Math.atan2(sy * Math.sin(u * Math.PI / 2), sx * Math.cos(u * Math.PI / 2));
  const reach = (0.1 + 0.13 * sm) * m * (opts.safe ? 0.8 : 1) * lk;      // = crackReachOf x m (in this order: level 2 is the web it was, to the last bit)
  const rc = Math.max(1.6, lerp(1.8, 3.4, sm));
  const strikes = [{ x: ox, y: oy, at: 0, s, corner: true }];
  const craters = [{ x: ox, y: oy, r: rc, at: 0, seed: r() * 1e9 }];
  const lines = [];      // { pts: [[x, y, d]...] (d = distance from the corner), t0 (ms the line starts), speed (px/ms), lvl, wave }
  const chips = [], facets = [];
  const speed = reach / 190;
  const waves = s >= 0.95 && !opts.safe ? 2 : 1;
  const mains = [];
  for (let wv = 0; wv < waves; wv++) {
    const n = wv ? 3 : 4 + Math.round(3 * sm);
    const at = wv * 3 * TICK_MS;
    for (let i = 0; i < n; i++) {
      /* spread across the quarter, a little random; a crack starts IN the corner or ON one of its two edges (the second burst farther
         out along them), never inside the view */
      const u = clamp((i + 0.5) / n + (r() - 0.5) * (0.6 / n), 0.06, 0.94);
      const onEdge = wv ? 1 : r() < 0.55 ? 1 : 0;
      const e = onEdge ? (wv ? lerp(0.09, 0.2, r()) : lerp(0.02, 0.07, r())) * m * lk : 0;
      const alongX = u < 0.5;                                 // a crack aiming low in the quarter starts on the horizontal edge
      let x0 = ox + sx * (alongX ? e : 0), y0 = oy + sy * (alongX ? 0 : e);
      if (!onEdge) { const a0 = way(u); x0 += Math.cos(a0) * rc; y0 += Math.sin(a0) * rc; }
      const a = way(onEdge ? clamp(alongX ? u + 0.12 : u - 0.12, 0.08, 0.92) : u);
      const L = reach * lerp(0.5, 1, r() ** 0.7) * (wv ? 0.8 : 1);
      const pts = walk(r, x0, y0, a, L, 0.18, Math.hypot(x0 - ox, y0 - oy), [ox, oy], [sx, sy]);
      const t0 = at + (Math.hypot(x0 - ox, y0 - oy) / speed) * 0.5;      // the break spreads out of the corner along the edges
      lines.push({ pts, t0, speed, lvl: 0, wave: wv });
      mains.push({ pts, t0 });
      const nbr = Math.round(lerp(0, 1.3, sm) * r() + (L > reach * 0.7 ? 1 : 0));
      for (let b = 0; b < nbr; b++) {
        const k = Math.floor(lerp(0.35, 0.75, r()) * (pts.length - 1));
        const p = pts[k];
        const ba = a + (r() < 0.5 ? 1 : -1) * lerp(0.35, 0.7, r());
        const bp = walk(r, p[0], p[1], ba, (pts[pts.length - 1][2] - p[2]) * lerp(0.3, 0.6, r()), 0.3, p[2], [ox, oy], [sx, sy]);
        lines.push({ pts: bp, t0: t0 + ((p[2] - pts[0][2]) / speed) * 0.9, speed: speed * 0.8, lvl: 1, wave: wv });
      }
    }
  }
  /* rings: jagged arcs round the corner joining neighbouring main cracks (the quarter web); the cells between are the glass's FACETS,
     faintly lit or shaded (alternating), and the SHARDS that fall out at the end */
  const radial = mains.filter((q) => q.pts[q.pts.length - 1][2] > reach * 0.35);
  const angOf = (q) => { const e = q.pts[q.pts.length - 1]; return Math.atan2(e[1] - oy, e[0] - ox); };
  radial.sort((p, q) => angOf(p) - angOf(q));
  const angs = radial.map(angOf);
  const nr = 1 + (sm > 0.55 ? 1 : 0) + (level >= 3 ? 1 : 0);      // GOREUI: the largest web has one more ring
  const rhos = [];
  for (let k = 0; k < nr; k++) {
    const rho = reach * lerp(0.28, 0.62, (k + 0.3 + r() * 0.5) / nr);
    rhos.push(rho);
    for (let i = 0; i + 1 < radial.length; i++) {
      if (r() < (k === 0 ? 0.15 : 0.3)) continue;
      const A = atRadius(radial[i].pts, rho, ox, oy), B = atRadius(radial[i + 1].pts, rho * lerp(0.92, 1.08, r()), ox, oy);
      if (!A || !B) continue;
      const pts = [[A[0], A[1], rho]];
      const sag = (r() - 0.35) * 0.14 * rho;
      for (const v of [0.33, 0.66]) {
        const qx = A[0] + (B[0] - A[0]) * v, qy = A[1] + (B[1] - A[1]) * v;
        const vx = qx - ox, vy = qy - oy, vl = Math.hypot(vx, vy) || 1;
        pts.push([qx + (vx / vl) * sag + (r() - 0.5) * 2, qy + (vy / vl) * sag + (r() - 0.5) * 2, rho]);
      }
      pts.push([B[0], B[1], rho]);
      for (let j = 1; j < pts.length; j++) pts[j][2] = pts[j - 1][2] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]);
      lines.push({ pts, t0: Math.max(radial[i].t0, radial[i + 1].t0) + (rho / speed) * 0.9 + 30 * k, speed: speed * 0.9, lvl: 2, wave: 0 });
    }
  }
  if (!opts.safe) for (let k = 0; k < nr; k++) for (let i = 0; i + 1 < angs.length; i++) {
    facets.push({ x: ox, y: oy, a0: angs[i], a1: angs[i + 1], r0: k ? rhos[k - 1] * 0.97 : rc, r: rhos[k] * 0.97, light: (i + k) & 1, at: 60 + (rhos[k] / speed) });
  }
  Object.assign(strikes[0], { angs: [...angs], rhos, reach, rc });
  /* a few glass crumbs drop out of the crushed corner */
  const nc = opts.still ? 0 : 2 + Math.round(3 * sm);
  for (let i = 0; i < nc; i++) chips.push({ x: ox + sx * lerp(0.5, 2.5, r()) * rc, y: oy + sy * lerp(0.5, 2.5, r()) * rc, vx: sx * lerp(8, 40, r()), vy: lerp(-30, 10, r()), at: r() * 140, big: r() < 0.3, spin: Math.floor(r() * 3) });
  const hold = clamp(Number(opts.hold) || 1, 0.5, 2);
  const life = { gone: (4500 + 4000 * sm) * hold, fall: FALL };
  const maxD = Math.max(1, ...lines.map((l) => l.pts[l.pts.length - 1][2]));
  return { kind: "cracks", seed: opts.seed ?? "x", s, level, corner, origin: { x: ox, y: oy }, waves, strikes, craters, lines, chips, facets, life, maxD, safe: !!opts.safe, still: !!opts.still, g: { w: g.w, h: g.h } };
}
/* a wandering crack from (x, y) along a, L px; d = its distance from `from` (the corner) when given, else its path length */
function walk(r, x, y, a, L, jit, d0, from = null, into = null) {
  const pts = [[x, y, d0]];
  let d = d0, ang = a, run = 0;
  while (run < L) {
    const st = lerp(2, 4.5, r());
    const was = ang;
    ang += (r() - 0.5) * jit * 2;
    ang = a + clamp(ang - a, -0.45, 0.45);
    /* GORE3: a corner crack keeps heading INTO the view (both of its steps away from the corner's two edges), never back out along one */
    if (into && (Math.cos(ang) * into[0] < 0.1 || Math.sin(ang) * into[1] < 0.1)) ang = was;
    x += Math.cos(ang) * st; y += Math.sin(ang) * st; run += st;
    d = from ? Math.max(d + 0.5, Math.hypot(x - from[0], y - from[1])) : d + st;
    pts.push([x, y, d]);
  }
  return pts;
}
function atRadius(pts, rho, ox, oy) {
  for (const p of pts) if (Math.hypot(p[0] - ox, p[1] - oy) >= rho) return p;
  return null;
}
/** how far a crack line reaches at ms after contact (px of path) */
export function crackReach(line, ms, still = false) {
  if (still) return Infinity;
  const t = ms - line.t0;
  if (t < 0) return 0;
  const total = line.pts[line.pts.length - 1][2] - line.pts[0][2];
  const T = total / line.speed;
  return line.pts[0][2] + total * easeOut(t / Math.max(1, T));
}
/** ms after contact when the glass starts to fall out */
export const breakAt = (p) => p.life.gone - p.life.fall;

/** ms after contact when a plan is over */
export const endOf = (p) => (p.kind === "blood" ? p.life.gone + p.life.dissolve + (p.second ? p.second.delay : 0) : p.life.gone);
