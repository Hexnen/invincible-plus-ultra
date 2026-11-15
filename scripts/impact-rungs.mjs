/* IMPCALL2: the LOW rungs of the impact ladders, authored by the callers (the roll splash and the token reactions). PURE, no imports.
   The owner (2026-11-15): «Trzeba dopracować Impact frames żeby były bardziej jak sakuga mad ... więcej efektów. Dynamiczniej» and «te
   błyski nie będą w grze jakoś bardzo powtarzane. Jeden rzut i animacja na kilka minut»: a moment comes every few minutes, so no rung may be
   nothing or a blink. The engine's own ladders (scripts/letters/impact/plan.mjs KINDS) are a one-second cut from step 3 up, but its steps
   0-2 are 2-6 ticks (83-250 ms): a scratch was one 83 ms blink, an ordinary roll nothing at all (ADVI2 1). Until the engine lengthens them
   (REQUESTS IMPCALL2-E1) the callers hand those rungs in as their own `frames` (public API: type, ticks, stop, punch, fig, z, kick), built
   from the engine's own drawing types:
     - never a flash on the two lowest rungs (no drawing that changes the scene's brightness: no `ink`, `slam`, `shadow`, `window`, `glare`,
       `swap`, `tear`, `shatter`), at most ONE (the local black-and-white panel `ink`) on the rungs below the critical / heavy; the guard of
       the engine still rations everything, nothing here can raise it;
     - every drawing carries the figures (`fig`), so no splash or ring is ever drawn over the struck token without it (IMPACT5 lesson 3);
     - the cut is one beat: (a lead-in,) the contact (the figure pops, its palette flips), the hold on the figures (palette jumps on ones,
       the frame shaking), the release on twos (ring, halftone, colour split), the settle (own colours, a rim dying out);
     - each rung is LONGER and carries MORE than the one below it, and stays under the next rung of the engine (1.9.22: its step 3 is
       10-11 ticks with two flashes, the shock kind 10 with one), so the critical / the heavy blow stay the longest cut below the knock-down.
   Tick = 1/24 s. The strength the caller passes keeps the engine's step (so its cut-in and size rules read the same rung). */
export const TICK = 1000 / 24;
const F = (type, ticks = 1, fig = "r", o = {}) => Object.freeze({ type, ticks, fig, ...o });
const FLASH = new Set(["ink", "slam", "shadow", "window", "glare", "swap", "tear", "shatter"]);
export const isFlashType = (t) => FLASH.has(t);

/* ---- the roll (splash): ordinary success < strong < critical (the critical is the engine's own ladder, 13-24 ticks) ---- */
export const ROLL = Object.freeze({
  /* an ordinary success: the blow / the result lands: 7 ticks (292 ms), no flash */
  ordinary: Object.freeze([F("lines", 1, "r"), F("pop", 1, "i", { z: 1.25, punch: 0.5 }), F("fig", 1, "n", { z: 1.25 }), F("ring", 1, "h"),
    F("dots", 1, "d"), F("fade", 2, "r")]),
  /* a strong result: a tick of lines, the local black-and-white panel with the figure popped, a held tick, the shake back, the release:
     9 ticks (375 ms), one flash; under the critical (the engine's step 3: 10-11 ticks, two flashes) */
  strong: Object.freeze([F("lines", 1, "k"), F("ink", 1, "o", { z: 1.55, punch: 1 }), F("fig", 1, "i", { z: 1.55, stop: true }),
    F("fig", 1, "p", { z: 1.25, punch: 0.7, kick: -1 }), F("chroma", 1, "h"), F("ring", 1, "d"), F("dots", 1, "n"), F("fade", 2, "r")])
});
/* on a MAP layer the result word is in the scene under the impact: only drawings that leave the word's spot clear (lines, colour split, the
   figures at the target). figs = the roll has a target (its figures carry the cut); without one the lines and the colour split alone */
export const ROLL_MAP = Object.freeze({
  ordinary: Object.freeze([F("lines", 1, "r"), F("fig", 1, "i", { z: 1.25, punch: 0.5 }), F("fig", 1, "n", { z: 1.25 }), F("lines", 1, "h"), F("fig", 1, "d"), F("fig", 2, "o")]),
  strong: Object.freeze([F("lines", 1, "k"), F("lines", 1, "n"), F("chroma", 1, "o", { punch: 0.5 }), F("fig", 1, "i", { z: 1.55, stop: true }),
    F("fig", 1, "p", { z: 1.25, punch: 0.6, kick: -1 }), F("lines", 1, "h"), F("fig", 1, "d"), F("fig", 2, "o")])
});
export const ROLL_MAP_BARE = Object.freeze({
  ordinary: Object.freeze([F("lines", 1, null), F("lines", 1, null), F("chroma", 1, null, { punch: 0.5 }), F("lines", 2, null), F("lines", 2, null)]),
  strong: Object.freeze([F("lines", 1, null), F("lines", 1, null), F("chroma", 1, null, { punch: 1 }), F("lines", 2, null), F("chroma", 1, null), F("lines", 1, null), F("lines", 2, null)])
});

/* ---- the token reactions: scratch < blow < hard blow < (engine 1.9.22: heavy / crushing 10-11 ticks two flashes, knock-down 17-24) ---- */
export const REACT = Object.freeze([
  /* 0 scratch: the figure flips and pops, a splash, a ring: 6 ticks (250 ms; was one 83 ms blink), no flash */
  Object.freeze([F("pop", 1, "n", { z: 1.25, punch: 0.5 }), F("fig", 1, "i", { z: 1.25 }), F("splat", 1, "h"), F("ring", 1, "d"), F("fade", 2, "r")]),
  /* 1 blow: the star, the black-and-white panel with the figure popped, the shake back, the ring: 8 ticks (333 ms), one flash */
  Object.freeze([F("pop", 1, "i", { z: 1.25, punch: 0.5 }), F("ink", 1, "o", { z: 1.55, punch: 1 }), F("fig", 1, "p", { z: 1.25, punch: 0.7, kick: -1 }), F("fig", 1, "h"),
    F("ring", 2, "d"), F("fade", 2, "r")]),
  /* 2 hard blow: a tick of lines, the panel, a held tick, cracks running out, the release: 9 ticks (375 ms), one flash */
  Object.freeze([F("lines", 1, "k"), F("ink", 1, "o", { z: 1.55, punch: 1 }), F("fig", 1, "i", { z: 1.55, stop: true }), F("cracks", 1, "p", { z: 1.25, punch: 0.7, kick: -1 }),
    F("fig", 1, "h", { punch: 0.5 }), F("dots", 1, "n"), F("cracks", 1, "r"), F("fade", 2, "r")])
]);

/* ---- things that are not characters (IMPCALL2, item 4): a CHALLENGE token (the system's challenge actor: Health = its Challenge rating,
   Resolve = its Time limit [B2837-B2841]). A six on an objective takes one point of the rating: that is the heroes' PROGRESS, never a blow
   to the challenge; the rating at 0 = the challenge dealt with; the time limit running out first = the challenge FAILED. No punch, no
   kick back, no splash, no cracks: progress gets a light focus (rings, the figure lit and turned), the overcome a bright release, the
   failure a dark, held beat (the black frame with the torn window, the colour split). ---- */
export const CHALLENGE = Object.freeze({
  /* progress (a point of the rating or more): 8 ticks (333 ms), no flash */
  gain: Object.freeze([F("lines", 1, "r"), F("ring", 1, "n", { z: 1.25 }), F("fig", 1, "h"), F("ring", 2, "d"), F("dots", 1, "o"), F("fade", 2, "r")]),
  /* overcome (rating 0): 14 ticks (583 ms), no flash: rings out, the figure cycling its colours, a halftone release */
  won: Object.freeze([F("lines", 1, "r"), F("lines", 1, "n"), F("ring", 1, "h", { z: 1.55 }), F("fig", 1, "d", { z: 1.25 }), F("ring", 2, "n"), F("fig", 1, "h"),
    F("dots", 2, "d"), F("ring", 2, "o"), F("fade", 3, "r")]),
  /* failed (time ran out with rating left): 16 ticks (667 ms), one flash held (the torn window), no punch along a blow (nobody struck it) */
  lapse: Object.freeze([F("lines", 1, "k"), F("lines", 1, "n"), F("window", 2, "o", { stop: true }), F("fig", 1, "i", { stop: true }), F("chroma", 1, "d"),
    F("fig", 1, "h"), F("ring", 2, "n"), F("dots", 2, "d"), F("fig", 2, "o"), F("fade", 3, "r")])
});

/* a frames list ready for L.impact.play (fresh objects; `fig: null` dropped) */
export const framesOf = (list) => (list ?? []).map((f) => { const o = { ...f }; if (o.fig == null) delete o.fig; return o; });
export const ticksOf = (list) => (list ?? []).reduce((a, f) => a + (Number(f?.ticks) || 1), 0);
export const flashesOf = (list) => (list ?? []).filter((f) => isFlashType(typeof f === "string" ? f : f?.type)).length;

/* ---- one event, one impact (IMPCALL2, item 3: a critical that dealt damage played the roll's one-second cut and, ~80 ms after it, the
   damage reaction's own cut on the same token; the guard then thinned the second to an orange star over the token). The roll's moment and
   the damage it causes are ONE event: a reaction on a token that a roll's impact has just struck (shared data: the roll's targets and the
   table's strength of its impact, the same on every seat) gets no impact of its own when its rung is not above the roll's; when it is
   (an ordinary roll, then the knock-down) it plays as the event's SECOND BEAT: the reaction's own cut without the drawings that change the
   scene's brightness (the scene already flashed for this event; the guard would thin them into a star over the token anyway), each one
   turned into the figures' own drawing at the same ticks. Steps are the engine's (stepOf of the drawn strength). ---- */
export function foldWith(reactStep, rollStep) {
  if (!Number.isFinite(rollStep)) return "own";
  if (!Number.isFinite(reactStep) || reactStep <= rollStep) return "fold";
  return "beat";
}
/* the second beat: frames = the engine's plan of the reaction's own impact (I.plan(spec).frames) -> the same cut, flash drawings turned into
   the figures' drawing (held, the figure enlarged in its negative), every drawing with the figures */
export function beatFrames(frames) {
  return (frames ?? []).map((f) => {
    const o = { type: f.type, ticks: f.ticks, stop: !!f.stop, punch: Number(f.punch) || 0 };
    if (f.kick < 0) o.kick = -1;
    if (f.fig) o.fig = f.fig;
    if (Number(f.z) > 1) o.z = f.z;
    if (FLASH.has(f.type)) { o.type = "fig"; o.fig = f.fig && f.fig !== "o" ? f.fig : "i"; o.z = Math.max(o.z ?? 1, 1.25); }
    if (!o.fig) o.fig = "r";
    return o;
  });
}

/* ---- two tokens hurt unequally at once (IMPCALL2, item 10: the -1 got the same full colour treatment as the -8 beside it): the engine
   gives every `also` figure the drawing's treatment, so only the tokens whose own rung is within ALSO_GAP of the struck one join the cut;
   a lighter one keeps its own word, number and motion and, when it strikes alone after the cut, its own (lower) rung ---- */
export const ALSO_GAP = 1;
export const alsoFits = (ownRung, hostRung) => Number.isFinite(ownRung) && Number.isFinite(hostRung) && ownRung >= hostRung - ALSO_GAP;

/* CALLER5: the length of the TABLE's impact (ms), from the engine's plan of it on this seat (I.plan). Full and gentle seats plan the table's
   ticks (the gentle variant keeps the timing); "off" is the table's setting (every seat 0). A reduced-motion seat's plan is its one still
   drawing: a caller's own cut is counted from its frames as the engine counts them (each drawing at most maxFrameTicks, the whole at most
   maxTicks); the engine's own ladder cannot be read there yet (REQUESTS CALLER5-E1), so the still's length stands. */
export function tableImpactMs(plan, frames, I) {
  if (!plan || typeof plan !== "object") return null;
  if (plan.mode === "full" || plan.mode === "local") return Math.max(0, Number(plan.ms) || 0);
  if (plan.mode === "off") return 0;
  if (Array.isArray(frames) && frames.length) {
    const fMax = Number(I?.limits?.maxFrameTicks) || 4, all = Number(I?.limits?.maxTicks) || 24;
    let t = 0;
    for (const f of frames) t += Math.max(1, Math.min(fMax, Math.round(Number(typeof f === "string" ? 1 : f?.ticks) || 1)));
    return Math.min(all, t) * TICK;
  }
  return Math.max(0, Number(plan.ms) || 0);
}
