/* TOKANIM: THE TOKEN ITSELF REACTS, the pure half (no Foundry, no canvas; node-checked by scripts/sweep-checks/tokanim.mjs).
   When a token reaction plays (scripts/tokenreact/: a hit, a heavy hit, going down, healing, stress, ...), the token's own picture moves
   with it: it is knocked back, staggers, topples, springs up, flinches, sags. This file decides HOW: the animations as pure curves of
   time, the defaults per reaction kind, how strength follows the amount and the step of a series, and how several layers on one token
   combine. main.mjs only reads Foundry and puts the pose on the token's picture for the length of one drawing (never on its document).
     ANIMS                      the animations: id -> { dur, family, pose(t, A, ctx, out) }
     EVENTS / DEFAULTS          the reaction kinds of tokenreact/pure.mjs and the animation each one gets out of the box
     cleanEvents(v)             a stored table made safe (unknown kinds, animations, strengths dropped or clamped)
     plan(kind, o)              -> one layer: { anim, A, dur, dir, side, seed, at } (o = { amt, step, strength, mode, seed, at, dir })
     poseAt(layer, now, out)    -> the layer's pose now (identity before its contact instant and after its end)
     mix(layers, now, o, base)  -> the token's pose from all its layers (a newer reaction takes over from an older one), on its lying base
     LIE / lyingAt / lieAmount  KODOWN: a token at 0 Health lies until it gets up or is healed (a state under the reactions)
     apply(base, pose, size)    -> the picture's transform: { x, y, rotation, sx, sy, tint } from the base Foundry set
   Pose units: x, y in token widths (world, + = right / down), rot in radians, sx / sy multipliers in the token's own axes, pivot (px, py)
   in token widths from the centre, tint 0xRRGGBB with its strength tk 0..1 (multiplied onto the picture's own tint).
   LYING adds: fy = how flat the picture lies on the floor (1 = not at all), a squash down the SCREEN after the turn, whatever way the token
   faces; dim / dk = the lying state's dim under a reaction's own tint; lie = how far down the token is (0..1). */

export const EVENTS = ["hit", "heavy", "down", "heal", "back", "stress", "spent", "regain", "out", "steady"];

/* ---------------------------------------------------------------- small curves */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const clamp01 = (v) => clamp(v, 0, 1);
const ease = (u) => { u = clamp01(u); return u * u * (3 - 2 * u); };
const easeIn = (u) => { u = clamp01(u); return u * u; };
const easeOut = (u) => { u = clamp01(u); return 1 - (1 - u) * (1 - u); };
/** a bump 0 -> 1 -> 0 over [0, 1] */
const bump = (u) => (u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u));
/** a spring let go at its full stretch: 1 at t = 0, rings at f Hz and dies with time constant T (ms) */
const ring = (t, f, T) => (t < 0 ? 0 : Math.exp(-t / T) * Math.cos(TAU * f * t / 1000));
/** decay 1 -> 0 with time constant T (ms) */
const decay = (t, T) => (t < 0 ? 0 : Math.exp(-t / T));
/** a tremble the same on every seat: a sum of two sines whose phases come from the seed */
const tremble = (t, hz, ph) => 0.65 * Math.sin(TAU * hz * t / 1000 + ph) + 0.35 * Math.sin(TAU * hz * 1.7 * t / 1000 + ph * 2.3);
/** the tail every animation ends with: the last `ms` of the layer fade whatever is left to rest */
const tail = (t, dur, ms = 140) => clamp01((dur - t) / ms);

export const POSE0 = Object.freeze({ x: 0, y: 0, rot: 0, sx: 1, sy: 1, px: 0, py: 0, tint: 0xffffff, tk: 0, fy: 1, dim: 0xffffff, dk: 0, lie: 0 });
export const pose0 = (out = {}) => Object.assign(out, POSE0);

/* the colours the picture is tinted with for a moment: which track moved (the lettering's own families, tokenreact/pure.mjs PALETTE) */
/* PALETTE: stress was the old magenta (0xff4fae), out violet (0xa75cf0): now the blood red and indigo of the words (letter-colors.mjs TINT) */
/* LYING: lie = the dim of a token that lies (a cool dark, "lights out": it darkens the picture without colouring it like a fresh blow) */
export const TINTS = { blow: 0xff4a3a, down: 0xd4231c, heal: 0x8fe86a, stress: 0xd8141f, out: 0x8a7bff, steady: 0x3fd8c4, lie: 0x5a5f6c };

/* ---------------------------------------------------------------- the animations
   Each pose(t, A, c, out) writes the pose at t ms after the contact instant; A = the strength (1 = normal, about 0.3..2.4), c = { dir
   { x, y } unit vector away from the blow (world), side +1 / -1 (the way it leans), ph (a seeded phase), hold (ms, the down hold) }.
   `dur` is the length at A = 1 (plan() stretches it a little with the amount); a pose at t >= dur is the rest pose. */
export const ANIMS = {
  none: { family: "none", dur: 0, pose: (t, A, c, o) => pose0(o) },
  /* a blow: thrown back on the contact frame (the drawing where the word strikes), rings back past its place and settles */
  recoil: { family: "blow", dur: 520, pose(t, A, c, o) {
    const k = ring(t, 2.4, 115) * tail(t, this.dur * (c.k ?? 1)), sq = decay(t, 70);
    o.x = c.dir.x * 0.15 * A * k; o.y = c.dir.y * 0.15 * A * k;
    o.rot = c.side * 0.13 * A * k;
    o.sx = 1 - 0.09 * A * sq; o.sy = 1 + 0.06 * A * sq;
    o.tint = TINTS.blow; o.tk = 0.55 * decay(t, 140);
    return o;
  } },
  /* a heavy blow: thrown further, reels (a wide sway that dies slowly), dips at the knees once */
  stagger: { family: "blow", dur: 1050, pose(t, A, c, o) {
    const end = tail(t, this.dur * (c.k ?? 1), 220);
    const k = ring(t, 1.3, 260) * end, sq = decay(t, 90);
    o.x = (c.dir.x * 0.25 * A * k) + c.side * 0.035 * A * Math.sin(TAU * 2.2 * t / 1000) * decay(t, 380) * end;
    o.y = c.dir.y * 0.25 * A * k + 0.04 * A * bump((t - 140) / 420) * end;
    o.rot = c.side * (0.24 * A * ring(t, 1.6, 330)) * end;
    o.sx = 1 - 0.13 * A * sq; o.sy = 1 + 0.09 * A * sq - 0.06 * A * bump((t - 140) / 420) * end;
    o.tint = TINTS.blow; o.tk = 0.6 * decay(t, 200);
    return o;
  } },
  /* a blow that rattles it: a fast decaying shake on the spot */
  shake: { family: "blow", dur: 620, pose(t, A, c, o) {
    const env = decay(t, 210) * tail(t, this.dur * (c.k ?? 1));
    o.x = 0.075 * A * env * tremble(t, 11, c.ph) + c.dir.x * 0.05 * A * decay(t, 60);
    o.y = 0.03 * A * env * tremble(t, 9, c.ph + 1.3) + c.dir.y * 0.05 * A * decay(t, 60);
    o.rot = 0.05 * A * env * tremble(t, 7, c.ph + 2.1);
    o.tint = TINTS.blow; o.tk = 0.5 * decay(t, 130);
    return o;
  } },
  /* a blow that spins it round (a cartoon smack): one turn, more with a bigger blow, eased out, then a wobble */
  spin: { family: "blow", dur: 980, pose(t, A, c, o) {
    /* whole turns only (a whole turn ends where it started: the layer's end is seamless); two for the biggest blows */
    const turns = A > 1.6 ? 2 : 1, spinMs = 560 + 120 * turns, u = t / spinMs;
    const wob = t > spinMs ? 0.12 * A * ring(t - spinMs, 3, 120) * tail(t, this.dur * (c.k ?? 1)) : 0;
    o.rot = c.side * ((u < 1 ? easeOut(u) : 1) * turns * TAU + wob);
    o.x = c.dir.x * 0.14 * A * decay(t, 160); o.y = c.dir.y * 0.14 * A * decay(t, 160);
    o.sx = 1 - 0.08 * A * decay(t, 80); o.sy = o.sx;
    o.tint = TINTS.blow; o.tk = 0.5 * decay(t, 150);
    return o;
  } },
  /* going down: thrown back, topples over its feet with gravity, lands with a small rebound.
     KODOWN (owner 2026-11-14, «Tak»: a knocked-down token stays down while it has 0 Health): on a token that is down (c.lie) the fall
     itself is the token's LYING state (lyingAt below, kept by main.mjs until it gets up or is healed), so this layer is only what the
     blow adds on top: the knock, the squash, the landing's squash and rebound; it ends at rest on the lying pose. Without c.lie (a preview
     in the panel, a token that is not at 0) it is the whole fall, a beat lying, and the picture back up, as before. */
  collapse: { family: "down", dur: 2100, pose(t, A, c, o) {
    if (c.lie) {
      const landAt = LIE.fallDelay + LIE.fallMs, end = tail(t, this.dur * (c.k ?? 1), 120), knock = decay(t, 110);
      const land = t >= landAt && t < landAt + 200 ? decay(t - landAt, 60) : 0;
      o.x = c.dir.x * 0.2 * A * knock * end; o.y = c.dir.y * 0.2 * A * knock * end;
      o.rot = t >= landAt ? -(c.lieSide ?? c.side) * LIE.rot * 0.08 * Math.max(0, ring(t - landAt, 4, 70) * Math.sin(Math.PI * clamp01((t - landAt) / 240))) * end : 0;
      o.sx = 1 - (0.1 * A * decay(t, 80) - 0.06 * land) * end; o.sy = 1 + (0.07 * A * decay(t, 80) - 0.14 * land) * end;
      o.tint = TINTS.down; o.tk = 0.6 * decay(t, 160);
      return o;
    }
    const k = c.k ?? 1, fallAt = 70, fallMs = 420, landAt = fallAt + fallMs, hold = (c.hold ?? 900) * k, upAt = landAt + hold, upMs = 520;
    const angle = c.side * Math.min(1.45, 0.95 + 0.25 * A);
    let a = 0;
    if (t < fallAt) a = 0;
    else if (t < landAt) a = easeIn((t - fallAt) / fallMs);
    else if (t < upAt) a = 1 - 0.08 * Math.max(0, ring(t - landAt, 4, 70) * Math.sin(Math.PI * clamp01((t - landAt) / 240)));
    else a = 1 - ease((t - upAt) / upMs);
    const knock = decay(t, 110);
    o.px = 0; o.py = 0.42;      // round its feet
    o.rot = angle * a;
    o.x = c.dir.x * 0.2 * A * knock + c.dir.x * 0.1 * a; o.y = c.dir.y * 0.2 * A * knock + c.dir.y * 0.1 * a;
    const land = t >= landAt && t < landAt + 200 ? decay(t - landAt, 60) : 0;
    o.sx = 1 - 0.1 * A * decay(t, 80) + 0.06 * land - 0.06 * a; o.sy = 1 + 0.07 * A * decay(t, 80) - 0.14 * land - 0.06 * a;
    o.tint = TINTS.down; o.tk = Math.max(0.6 * decay(t, 160), 0.28 * a);
    return o;
  } },
  /* stress: flinches into itself (smaller, a little down) and trembles */
  flinch: { family: "stress", dur: 760, pose(t, A, c, o) {
    const hold = t < 60 ? t / 60 : decay(t - 60, 420) * tail(t, this.dur * (c.k ?? 1), 200);
    o.sx = 1 - 0.09 * A * hold; o.sy = 1 - 0.11 * A * hold;
    o.y = 0.035 * A * hold;
    o.rot = 0.06 * A * hold * tremble(t, 9, c.ph);
    o.x = 0.025 * A * hold * tremble(t, 13, c.ph + 0.7);
    o.tint = TINTS.stress; o.tk = 0.5 * hold;
    return o;
  } },
  /* stress that eats the nerve: a long fine shiver */
  shiver: { family: "stress", dur: 950, pose(t, A, c, o) {
    const env = (t < 80 ? t / 80 : 1) * tail(t, this.dur * (c.k ?? 1), 260);
    o.x = 0.035 * A * env * tremble(t, 14, c.ph);
    o.rot = 0.035 * A * env * tremble(t, 11, c.ph + 1.1);
    o.sx = 1 - 0.03 * A * env; o.sy = 1 - 0.04 * A * env;
    o.tint = TINTS.stress; o.tk = 0.4 * env;
    return o;
  } },
  /* Resolve spent by choice: one tired dip (an exhale), up again */
  sag: { family: "stress", dur: 560, pose(t, A, c, o) {
    const b = bump(t / (this.dur * (c.k ?? 1)));
    o.sy = 1 - 0.09 * A * b; o.sx = 1 + 0.045 * A * b; o.y = 0.035 * A * b;
    o.tint = TINTS.stress; o.tk = 0.3 * b;
    return o;
  } },
  /* Resolve out: slumps down and leans over, trembles, holds, straightens slowly */
  slump: { family: "out", dur: 1700, pose(t, A, c, o) {
    const k = c.k ?? 1, inMs = 360, upAt = inMs + 700 * k, upMs = 520;
    const a = t < inMs ? easeOut(t / inMs) : t < upAt ? 1 : 1 - ease((t - upAt) / upMs);
    o.px = 0; o.py = 0.42;
    o.rot = c.side * 0.26 * Math.min(1.6, A) * a;
    o.y = 0.07 * A * a; o.sy = 1 - 0.13 * A * a; o.sx = 1 + 0.05 * A * a;
    o.x = 0.015 * A * a * tremble(t, 10, c.ph);
    o.tint = TINTS.out; o.tk = 0.45 * a;
    return o;
  } },
  /* healing: lifted a little, stretched taller, comes down soft */
  lift: { family: "heal", dur: 900, pose(t, A, c, o) {
    const u = t / (this.dur * (c.k ?? 1)), b = bump(u), land = u > 0.78 ? bump((u - 0.78) / 0.22) : 0;
    o.y = -0.09 * A * ease(Math.min(1, u * 2.2)) * (1 - ease((u - 0.45) / 0.4));
    o.sy = 1 + 0.08 * A * b - 0.05 * A * land; o.sx = 1 - 0.03 * A * b + 0.04 * A * land;
    o.tint = TINTS.heal; o.tk = 0.5 * b;
    return o;
  } },
  /* back on its feet (Health up from 0): crouches, springs up, lands with a squash */
  rally: { family: "heal", dur: 900, pose(t, A, c, o) {
    const crouch = 150, air = 360, land = 160;
    if (t < crouch) { const u = t / crouch; o.sy = 1 - 0.14 * A * ease(u); o.sx = 1 + 0.08 * A * ease(u); o.y = 0.03 * A * ease(u); }
    else if (t < crouch + air) { const u = (t - crouch) / air; o.y = -0.2 * A * 4 * u * (1 - u); o.sy = 1 + 0.12 * A * (1 - u); o.sx = 1 - 0.06 * A * (1 - u); }
    else { const u = (t - crouch - air) / land; const s = u < 1 ? bump(u) : 0; o.sy = 1 - 0.1 * A * s; o.sx = 1 + 0.07 * A * s; o.y = 0; }
    o.tint = TINTS.heal; o.tk = 0.55 * bump(t / (this.dur * (c.k ?? 1)));
    return o;
  } },
  /* nerve back (Resolve up from 0): a small happy hop */
  hop: { family: "steady", dur: 620, pose(t, A, c, o) {
    const air = 320, u = t / air;
    if (t < air) { o.y = -0.12 * A * 4 * u * (1 - u); o.sy = 1 + 0.06 * A * (1 - u); o.sx = 1 - 0.03 * A * (1 - u); }
    else { const s = bump((t - air) / 160); o.sy = 1 - 0.07 * A * s; o.sx = 1 + 0.05 * A * s; }
    o.tint = TINTS.steady; o.tk = 0.5 * bump(t / (this.dur * (c.k ?? 1)));
    return o;
  } },
  /* Resolve regained: a deep breath in (swells, stands taller), out */
  swell: { family: "steady", dur: 760, pose(t, A, c, o) {
    const b = bump(t / (this.dur * (c.k ?? 1)));
    o.sx = 1 + 0.06 * A * b; o.sy = 1 + 0.08 * A * b; o.y = -0.025 * A * b;
    o.tint = TINTS.steady; o.tk = 0.45 * b;
    return o;
  } }
};
export const ANIM_IDS = Object.keys(ANIMS);

/* what fits each kind (the panel lists these first; any animation may be chosen for any kind) */
export const FITS = {
  hit: ["recoil", "shake", "stagger", "spin"], heavy: ["stagger", "spin", "recoil", "shake"], down: ["collapse", "stagger", "spin"],
  heal: ["lift", "swell", "hop"], back: ["rally", "hop", "lift"],
  stress: ["flinch", "shiver", "sag"], spent: ["sag", "flinch", "shiver"], out: ["slump", "shiver", "flinch"],
  regain: ["swell", "lift", "hop"], steady: ["hop", "rally", "swell"]
};
/* the defaults: every reaction kind moves the token out of the box (owner 2026-11-14: "right now the tokens just lie there") */
export const DEFAULTS = Object.freeze({
  hit: { anim: "recoil", str: 1 }, heavy: { anim: "stagger", str: 1 }, down: { anim: "collapse", str: 1 },
  heal: { anim: "lift", str: 1 }, back: { anim: "rally", str: 1 },
  stress: { anim: "flinch", str: 1 }, spent: { anim: "sag", str: 1 }, out: { anim: "slump", str: 1 },
  regain: { anim: "swell", str: 1 }, steady: { anim: "hop", str: 1 }
});
export const STR = { min: 0, max: 2, step: 0.1 };

/** a stored table made safe: every kind present, unknown animations back to the default, strengths clamped */
export function cleanEvents(v) {
  const out = {};
  for (const k of EVENTS) {
    const d = DEFAULTS[k], r = v && typeof v === "object" ? v[k] : null;
    const anim = typeof r?.anim === "string" && ANIMS[r.anim] ? r.anim : d.anim;
    const n = Number(r?.str);
    out[k] = { anim, str: Number.isFinite(n) ? Math.round(clamp(n, STR.min, STR.max) * 100) / 100 : d.str };
  }
  return out;
}

/* ---------------------------------------------------------------- strength: the amount, the series, the setting
   A = strength x (AMT_LO + AMT_K x amount) x (1 + STEP_K x step), at most A_MAX. The amount is the share the lettering uses
   (tokenreact amountOf of the shared reaction: the same on every seat that sees the token, PRIV), the step is the blow's place in its
   series (tokenreact STREAK: 0, 1, 2 ...), so a series BUILDS like the lettering: -1, -1, -3, down reads small, bigger, heavy, a big fall. */
export const SCALE = { amtLo: 0.7, amtK: 0.6, stepK: 0.22, stepMax: 4, aMax: 2.4, durAmt: 0.25, durStep: 0.06, gentle: 0.5, downHold: 800, downHoldAmt: 500 };
/** the motion this seat may see: "full" | "gentle" (smaller moves) | "still" (no movement: the tint alone) | "off" (nothing) */
export function modeOf({ mine = "full", letr = "auto", osReduced = false, low = false } = {}) {
  if (mine === "off") return "off";
  if (letr === "reduced" || ((letr === "auto" || !letr) && osReduced) || low) return "still";
  if (mine === "gentle" || letr === "gentle") return "gentle";
  return "full";
}
/** the photosensitivity side: the tint is a soft pulse; with the guard or flashes off it is weaker and never jumps in on one frame */
export function tintK({ flashes = true, photosafe = true } = {}) { return !flashes ? 0.35 : photosafe ? 0.7 : 1; }

/* a small, stable hash: the same seed gives the same choice on every seat (tokenreact/pure.mjs hash) */
export function hash(s) { let h = 2166136261 >>> 0; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }

/** one layer for one reaction. kind = the reaction kind (tokenreact's shared reaction: every seat that sees the token alike, PRIV), o = { amt 0..1, step, strength,
    anim (override), mode, tk, seed, at (contact instant, ms on performance.now), dir ({x,y} away from the blow, null = from the seed) }
    -> null (nothing to play) | { kind, anim, A, k, dur, at, c: { dir, side, ph, k, hold }, still, tk } */
export function plan(kind, o = {}) {
  const row = o.row ?? DEFAULTS[kind];
  if (!row) return null;
  const anim = ANIMS[o.anim ?? row.anim] ? (o.anim ?? row.anim) : "none";
  const def = ANIMS[anim];
  const mode = o.mode ?? "full";
  if (anim === "none" || mode === "off" || !(def.dur > 0)) return null;
  const str = Number.isFinite(Number(o.strength)) ? clamp(Number(o.strength), STR.min, STR.max) : row.str ?? 1;
  if (!(str > 0)) return null;
  const amt = clamp01(Number(o.amt) || 0), step = clamp(Math.floor(Number(o.step) || 0), 0, SCALE.stepMax);
  let A = str * (SCALE.amtLo + SCALE.amtK * amt) * (1 + SCALE.stepK * step);
  A = Math.min(SCALE.aMax, A);
  if (mode === "gentle") A *= SCALE.gentle;
  const k = 1 + SCALE.durAmt * (amt - 0.3) + SCALE.durStep * step;      // the length: a little longer for more, and along a series
  const h = hash(`${o.seed ?? ""}|${kind}|anim`);
  let dir = o.dir && Number.isFinite(o.dir.x) && Number.isFinite(o.dir.y) && Math.hypot(o.dir.x, o.dir.y) > 1e-6 ? norm(o.dir) : null;
  if (!dir) { const s = h & 1 ? 1 : -1; dir = norm({ x: s, y: -0.25 }); }      // no seen attacker: a seeded side, the same everywhere
  const side = dir.x >= 0 ? 1 : -1;
  const ph = ((h >>> 3) % 6283) / 1000;
  const hold = (SCALE.downHold + SCALE.downHoldAmt * amt) * (1 + 0.15 * step);
  /* KODOWN: o.lie = the token is down and stays lying (main.mjs keeps the lying state): the collapse is only the blow on top of the fall */
  const lie = !!o.lie && anim === "collapse";
  const dur = lie ? Math.round((LIE.fallDelay + LIE.fallMs + 320) * k) : Math.round(def.dur * k + (anim === "collapse" ? hold - 900 : 0));
  const c = { dir, side, ph, k, hold };
  if (lie) { c.lie = true; c.lieSide = o.lieSide === -1 || o.lieSide === 1 ? o.lieSide : side; }
  return { kind, anim, A: Math.round(A * 1000) / 1000, k, dur, at: Number.isFinite(o.at) ? o.at : 0, c, still: mode === "still", tk: Number.isFinite(o.tk) ? o.tk : 1, step, amt, lie };
}

/* ---------------------------------------------------------------- KODOWN: lying while Health is 0
   The owner (2026-11-14, asked "ma leżeć, dopóki ma 0 Zdrowia?": «Tak»): a knocked-down token stays down for as long as it has 0 Health,
   on every seat that sees it, and rises only when it gets up or is healed (that rise plays with the getting-up / healing reaction).
   Lying is a STATE of the token, not a reaction layer: main.mjs keeps one per token { side, fallAt, upAt } and draws it under the
   reactions (mix's base), so a newer reaction never takes it over and a reload, a late seat or a scene change shows it again at once.
   Everything here is a pure function of that state and the clock: the same pose on every seat for the same state.
     side      from the token's id (lieSide): the same on every seat and after any reload (an attacker's side would not survive a reload)
     fallAt    when it starts to fall (-Infinity = already lying: a scene that loads with it at 0); the reaction's blow sets it (lieFallAt),
               else the state change itself after LIE.grace (no reaction on this seat: the reactions off, the word dropped)
     upAt      when it starts to rise (Infinity = lying); the getting-up / healing reaction's blow, else the change after LIE.grace */
/* CROWDKO (D10: the picture tipped 1.25 rad round a point 0.3 below its centre, so it slid ~0.35 of a square sideways and its corners lay on
   the neighbour's square; on a round portrait a disc turned 72 degrees reads as no change). Now it lies ON ITS OWN SQUARE: turned a quarter
   round its centre (a figure on its side reads as down on a round portrait too), flattened across the turn (a body lying on the floor seen
   from above: the disc reads as an oval), a little smaller, a touch towards the square's foot, and darker. Every pose of the fall and the
   lying pose stay inside the square (the turned box is scaled to fit: inSquare); a square portrait turned a quarter fills its square again */
/* LYING (D10 again, seen live on tag 159: the tokens of a fight are turned to face, so a quarter turn alone made a lying round portrait
   look like a standing one that faces another way, sometimes more upright than before; the squash ran along the token's own axis, which
   points anywhere; the dim was a faint red; and a reaction on a lying token (Resolve out: the slump leans round its feet) slid the
   lying picture a quarter of a square onto its neighbour for over a second). Now the picture lies like a disc tipped onto the floor:
   after the turn it is squashed down the SCREEN (fy: every lying token is the same low oval, whatever way it faces), darker (TINTS.lie),
   and while it lies every reaction played on it keeps it on its own square (mix: slack is all the room outside the square it may take) */
export const LIE = Object.freeze({ rot: Math.PI / 2, py: 0, size: 0.08, flat: 0.62, drop: 0.08, slack: 0.04, loose: 0.6, fallDelay: 70, fallMs: 420, upMs: 520, tk: 0.85, grace: 4000 });
/** the scale (<= 1) that keeps a w x h box (token widths, centred) turned by rot inside its own square */
export const inSquare = (w, h, rot) => { const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot)); return Math.min(1, 1 / Math.max(w * c + h * s, w * s + h * c, 1e-6)); };
export const lieSide = (id) => (hash(`${id ?? ""}|lie`) & 1 ? 1 : -1);
/** when a reaction's layer makes the token fall: the collapse falls on its own clock (70 ms after the blow), another animation the GM
    chose for going down plays first and the token topples over at its middle */
export const lieFallAt = (L) => (L ? L.at + (L.anim === "collapse" ? LIE.fallDelay : Math.round(L.dur * 0.55)) : null);
/** how far down the token is at `now`, 0 (upright) .. 1 (lying) */
export function lieAmount(S, now) {
  if (!S) return 0;
  const down = (t) => (S.fallAt === -Infinity ? 1 : !Number.isFinite(S.fallAt) || t < S.fallAt ? 0 : easeIn((t - S.fallAt) / LIE.fallMs));
  if (Number.isFinite(S.upAt) && now >= S.upAt) return down(S.upAt) * (1 - ease((now - S.upAt) / LIE.upMs));
  return down(now);
}
/** the state has risen fully: nothing left to draw */
export const lieDone = (S, now) => !!S && Number.isFinite(S.upAt) && now >= S.upAt + LIE.upMs;
/** the lying pose: turned a quarter round its centre, a little smaller, inside its own square at every instant of the fall (CROWDKO,
    D10), flat on the floor (fy, LYING) and dim; still (reduced motion) = the dim alone, no tipping. tk = the tint factor */
export function lyingAt(S, now, out = {}, o = {}) {
  pose0(out);
  const a = lieAmount(S, now);
  if (!(a > 0)) return out;
  out.px = 0; out.py = LIE.py;
  if (!o.still) {
    const rot = (S.side === -1 ? -1 : 1) * LIE.rot * a;
    let s = 1 - LIE.size * a;
    s *= inSquare(s, s, rot);
    /* LYING: the squash is down the screen, after the turn (apply), not along the token's own axis: a token turned to face lies as flat */
    const fy = 1 - (1 - LIE.flat) * a;
    const tall = fy * s * (Math.abs(Math.sin(rot)) + Math.abs(Math.cos(rot)));      // the turned, flattened picture's height, token widths
    out.rot = rot; out.sx = s; out.sy = s; out.fy = fy; out.y = Math.min(LIE.drop * a, Math.max(0, (1 - tall) / 2));
  }
  out.tint = TINTS.lie; out.tk = clamp01(LIE.tk * a * (Number.isFinite(o.tk) ? o.tk : 1)); out.lie = a;
  return out;
}
const norm = (v) => { const n = Math.hypot(v.x, v.y) || 1; return { x: v.x / n, y: v.y / n }; };

/** the layer's pose at `now` (ms, the clock of `at`): the rest pose before the contact and after the end. still = the tint alone */
export function poseAt(L, now, out = {}) {
  pose0(out);
  if (!L) return out;
  const t = now - L.at;
  if (t < 0 || t >= L.dur) return out;
  ANIMS[L.anim].pose.call({ dur: L.dur / L.k }, t, L.A, L.c, out);
  if (L.still) { const tint = out.tint, tk = out.tk; pose0(out); out.tint = tint; out.tk = tk * 0.6; }
  out.tk = clamp01(out.tk * (L.tk ?? 1));
  /* the tint comes in over 40 ms at least (no one-frame jump: photosensitivity) */
  if (t < 40) out.tk *= t / 40;
  for (const k of ["x", "y", "rot", "px", "py", "tk"]) if (!Number.isFinite(out[k])) out[k] = POSE0[k];
  for (const k of ["sx", "sy"]) out[k] = Number.isFinite(out[k]) ? clamp(out[k], 0.5, 1.6) : 1;
  return out;
}
export const isRest = (p) => !p || (Math.abs(p.x) < 1e-5 && Math.abs(p.y) < 1e-5 && Math.abs(p.rot) < 1e-5 && Math.abs(p.sx - 1) < 1e-5 && Math.abs(p.sy - 1) < 1e-5 && p.tk < 1e-3 && (p.fy ?? 1) > 1 - 1e-5 && (p.dk ?? 0) < 1e-3);
/** a move held inside `lim`: as it is up to 0.6 of the room, then eased so it never passes the room (no hard stop) */
export function held(v, lim) {
  if (!(lim > 1e-9)) return 0;
  const a = Math.abs(v), k = 0.6 * lim;
  return a <= k ? v : Math.sign(v) * (k + (lim - k) * Math.tanh((a - k) / (lim - k)));
}
/** half the box of a picture sx x sy (token widths), turned by rot, then squashed down the screen by fy -> { hw, hh } */
export const boxOf = (sx, sy, rot, fy = 1) => { const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot)); return { hw: (Math.abs(sx) * c + Math.abs(sy) * s) / 2, hh: fy * (Math.abs(sx) * s + Math.abs(sy) * c) / 2 }; };

/* a newer reaction takes over from an older one on the same token: the older fades out over TAKEOVER ms from the newer one's contact */
export const TAKEOVER = 160;
/** the token's pose from its layers (oldest first), each converted to a pose round the centre, then added (moves, turns) or multiplied
    (sizes); the strongest tint wins. -> { x, y, rot, sx, sy, tint, tk } (x, y in token sizes) */
export function mix(layers, now, out = {}, base = null) {
  pose0(out);
  const p = {};
  let tkMax = 0, lie = 0, baseTk = 0;
  /* KODOWN: the lying state (lyingAt) is the base every reaction plays on top of; it is never taken over */
  if (base && !isRest(base)) {
    const c = centred(base);
    out.x = c.x; out.y = c.y; out.rot = base.rot; out.sx = base.sx; out.sy = base.sy;
    out.fy = Number.isFinite(base.fy) ? base.fy : 1; lie = clamp01(base.lie ?? 0); baseTk = base.tk;
  }
  for (let i = 0; i < (layers?.length ?? 0); i++) {
    const L = layers[i];
    let w = 1;
    const next = layers[i + 1];
    if (next && now >= next.at) w = clamp01(1 - (now - next.at) / TAKEOVER);
    if (w <= 0) continue;
    poseAt(L, now, p);
    p.rot = ((p.rot % TAU) + TAU + Math.PI) % TAU - Math.PI;      // whole turns are no turn: a spun token fading out turns back the short way
    const c = centred(p);
    out.x += c.x * w; out.y += c.y * w; out.rot += p.rot * w;
    out.sx *= 1 + (p.sx - 1) * w; out.sy *= 1 + (p.sy - 1) * w;
    if (p.tk * w > tkMax) { tkMax = p.tk * w; out.tint = p.tint; }
  }
  out.tk = tkMax;
  /* LYING: the lying dim stays under a reaction's own tint (a blow on a lying token still flushes it); alone it is the pose's tint */
  if (baseTk > 0) { if (tkMax > 1e-3) { out.dim = base.tint; out.dk = baseTk; } else { out.tint = base.tint; out.tk = baseTk; } }
  /* LYING: a token that lies stays on its own square under every reaction: whatever the layers add (a knock, a lean round the feet, a
     slump, a hop) is held to the room its lying picture has inside the square plus LIE.slack; the further up it is (a fall that has not
     landed, a rise), the freer it moves, and a standing token is not held at all */
  if (lie > 0) {
    out.lie = lie;
    const free = LIE.slack + (1 - lie) * LIE.loose;
    let b = boxOf(out.sx, out.sy, out.rot, out.fy);
    /* a reaction that turns it (a spin, a lean) or swells it: the picture gives way in size, as in the fall (inSquare), never in place */
    const fit = Math.min(1, (0.5 + free) / Math.max(b.hw, b.hh, 1e-6));
    if (fit < 1) { out.sx *= fit; out.sy *= fit; b = boxOf(out.sx, out.sy, out.rot, out.fy); }
    out.x = held(out.x, Math.max(0, 0.5 + free - b.hw)); out.y = held(out.y, Math.max(0, 0.5 + free - b.hh));
  }
  return out;
}
/** a pose turned and sized round its pivot, as a move of the centre (token sizes): pivot + R(rot) . S . (centre - pivot) */
export function centred(p) {
  const dx = -p.px * p.sx, dy = -p.py * p.sy;      // all in units of the token's width (isotropic)
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  return { x: p.x + p.px + dx * c - dy * s, y: p.y + p.py + dx * s + dy * c };
}
/** a tint toward `color` by tk, multiplied onto the picture's own tint */
export function tintOf(base, color, tk) {
  if (!(tk > 0)) return base;
  const ch = (v, sh) => (v >> sh) & 255;
  const out = [16, 8, 0].map((sh) => { const t = 255 + (ch(color, sh) - 255) * clamp01(tk); return Math.round(ch(base, sh) * t / 255); });
  return (out[0] << 16) | (out[1] << 8) | out[2];
}
/** the picture's transform: base = { x, y, rotation, sx, sy, tint } as Foundry (or whoever) set it this frame, pose = mix(), size = the
    token's size in world px { w, h } -> the transform to draw this frame with.
    LYING: pose.fy < 1 squashes the turned picture down the screen. A turn and a scale in the picture's own axes cannot say that for a
    token that faces any way, so the two axes get their own directions (skewX / skewY, PIXI's transform: x axis at rotation + skewY, y axis
    at rotation - skewX) and lengths; with fy = 1 both skews are 0 and nothing changes */
export function apply(base, pose, size) {
  const rotation = base.rotation + pose.rot, fy = Number.isFinite(pose.fy) ? pose.fy : 1;
  let sx = base.sx * pose.sx, sy = base.sy * pose.sy, skewX = 0, skewY = 0;
  if (fy < 1 - 1e-6) {
    const c = Math.cos(rotation), s = Math.sin(rotation);
    skewY = Math.atan2(fy * s, c) - rotation; skewX = rotation - Math.atan2(s, fy * c);
    sx *= Math.hypot(c, fy * s); sy *= Math.hypot(s, fy * c);
  }
  return {
    x: base.x + pose.x * size.w, y: base.y + pose.y * size.w,
    rotation, sx, sy, skewX, skewY,
    tint: tintOf(tintOf(base.tint ?? 0xffffff, pose.dim ?? 0xffffff, pose.dk ?? 0), pose.tint, pose.tk)
  };
}
/** the 2 x 2 matrix a transform { rotation, sx, sy, skewX, skewY } draws with (PIXI's own formula): [a, b, c, d] */
export const matrixOf = (t) => [Math.cos(t.rotation + (t.skewY ?? 0)) * t.sx, Math.sin(t.rotation + (t.skewY ?? 0)) * t.sx, -Math.sin(t.rotation - (t.skewX ?? 0)) * t.sy, Math.cos(t.rotation - (t.skewX ?? 0)) * t.sy];
