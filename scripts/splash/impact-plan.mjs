/* WIRE1: which dice-roll results get an impact frame (the lettering engine's L.impact, scripts/letters/impact/) and how strong. PURE.
   The owner (2026-11-13/14): impact frames may go all out and must be spectacular, but they are a brief accent at the instant the result
   lands, never a lasting cover; one per event, never in a loop; the strongest moment gets the strongest frame; every seat sees the same
   moment. So the choice depends on the event alone (its rarity, the action, a wreck), never on a seat's own settings (the full-screen
   threshold `fullFrom` is a client setting: the critical here is a fixed rarity, the default of that setting), and the strength rises with
   the rarity: a strong result gets a short local accent (no full-field frame), the critical the full set, the rarer the more.
     impactFor(ev, { fx }) -> null | { kind, magnitude (0..2, the engine's), tone?, hitstop? } */
export const CRIT_P = 0.7;      // the critical: about 1 in 60 or rarer (powerOf; the default `fullFrom` of the full-screen moment)
export const STRONG_P = 0.46;   // a strong result: about 1 in 18 or rarer ("UNLIKELY HERO!" and up); below it no impact frame
export const STRONG_MAX = 0.84; // a strong result stays under the engine's full-field strengths (its tier 1: the scene hard black and white for a tick)
/* the kind of a strong result by what the roll does: a blow lands (hit), a charge or a hold crushes (heavy), a shot zaps (shock); what is
   not a blow (a dodge, a block, a clever idea, a presence) only gets the accent behind its word */
export const ACTION_KIND = { slugfest: "hit", generic: "hit", charge: "heavy", grapple: "heavy", shooting: "shock" };
import * as RG from "../impact-rungs.mjs";
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;

/* IMPCALL2 (ADVI2 1; the owner: «Jeden rzut i animacja na kilka minut»): every SUCCESS gets its moment now. An ordinary success (under
   STRONG_P) had none: it gets the callers' own low rung (scripts/impact-rungs.mjs ROLL.ordinary, 7 ticks, no flash) at ORD_MAG (the
   engine's step 1: its cut-in and size rules read a small rung); a strong result its own 9-tick cut (ROLL.strong, one flash) instead of the
   engine's 2-6 tick step 1-2; the critical keeps the engine's ladder (11-24 ticks). `rung` names the rung, `frames` the screen cut (the map
   layer has its own, mapFrames). A failure stays without an impact (nothing landed).
   Effects "reduced" ("Gentle: no flash or particles"; IMPACT5-3: it got a SHORTER critical than the table, 750 instead of 1000 ms, and no
   ordinary moment): the table's impact, the same length and instant, handed to the engine as `gentle` (its local variant: no full frame, no
   hit-stop, no inverted scene, the guard as always) and without the hold of the scene. A seat that cannot show it clean shows it calmer,
   never another story. */
export const ORD_MAG = 0.45;
export function impactFor(ev, o = {}) {
  if (!ev || ev.fail || !Number.isFinite(ev.power)) return null;
  const fx = Number.isFinite(o.fx) ? o.fx : 1;
  if (!(fx > 0)) return null;      // the splash's Effects setting "off": no effects at all
  const P = ev.power;
  if (P < STRONG_P) {
    const out = { kind: ACTION_KIND[ev.action] ?? "word", magnitude: ORD_MAG, rung: "ordinary", frames: RG.framesOf(RG.ROLL.ordinary) };
    if (ev.npc) out.tone = "void";
    if (fx < 1) { out.gentle = true; out.hitstop = false; }
    return out;
  }
  let kind, magnitude;
  if (P >= CRIT_P) {
    /* 1.1 (the engine's tier 2: silhouette frame, the negative slam, the colour split) at the threshold, the whole set (tier 3, 1.35+)
       from about 1 in 120, 2 at the rarest */
    kind = "crit";
    magnitude = 1.1 + 0.9 * clamp((P - CRIT_P) / 0.25) + (ev.wreck ? 0.15 : 0);
  } else {
    kind = ACTION_KIND[ev.action] ?? "word";
    if (ev.wreck && kind === "hit") kind = "heavy";      // the blow wrecks the surroundings too (cracks)
    magnitude = Math.min(STRONG_MAX, 0.45 + 0.35 * clamp((P - STRONG_P) / (CRIT_P - STRONG_P)) + (ev.wreck ? 0.15 : 0));
  }
  const out = { kind, magnitude: r2(clamp(magnitude, 0, 2)), rung: P >= CRIT_P ? "crit" : "strong" };
  if (P < CRIT_P) out.frames = RG.framesOf(RG.ROLL.strong);      // IMPCALL2: the strong result's own 9-tick cut
  if (ev.npc) out.tone = "void";      // a villain's roll: violet and cyan, not the hero's yellow and blue
  if (fx < 1) { out.gentle = true; out.hitstop = false; }      // IMPCALL2: Effects "reduced": the table's impact, gentle (was one strength lower: a shorter cut)
  return out;
}
/* the seed of a roll's impact: the message id every seat shares (the words' seed is the same id + their role) */
export const impactSeed = (seed) => `${seed ?? "x"}:impact`;

/* ------------------------------------------------------------------ ROLLTARGET: WHERE a roll's impact lands
   The owner (2026-11-14, asked: the result word, the roller or the attack's target?): «cel», the TARGET of the attack. Never the roller
   (ADVI 7: read as if the roller was hit). Where the target comes from:
     - a tactical attack (the roll's tag { inst, key: "attack" }): the targets the exchange HIT (moment.mjs verdict rows; the splash of an
       attack plays only once it hit), combatant ids, sorted so every seat has the same order whatever order the outcomes arrived in;
     - another tactical roll (a defence "def:<id>", a gate, ...): no target (a defence answers a blow, it lands on nobody: ROLLTARGET-4);
     - a roll outside the tactics: the roller's own Foundry targets at the instant of the roll (main.mjs puts them in the roll's flag; GM-
       hidden tokens are left out there), only for a blow (BLOW_ACTIONS: a dodge or a clever idea with a target left selected lands on nobody).
   Provisional (the owner did not decide, logged as questions ROLLTARGET-1..3): no target -> the result word (as before); several targets ->
   the FIRST one only (one impact per event); a target this seat cannot see, or off its view -> the result word on that seat, same instant.
   Pure: rollTargets(...) -> ids; targetChoice(ids, look) -> { id | null, why }. */
export const TARGET_MAX = 8;
const TOKEN_ID = /^[A-Za-z0-9]{16}$/;
export const BLOW_ACTIONS = Object.freeze(["slugfest", "charge", "grapple", "shooting"]);
/* a list from a flag (any client may write one): Foundry ids only, no repeats, at most TARGET_MAX, order kept */
export function cleanTargets(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const x of list) { if (typeof x === "string" && TOKEN_ID.test(x) && !out.includes(x)) out.push(x); if (out.length >= TARGET_MAX) break; }
  return out;
}
/* tag = message.rolls[0].options.tactics; hits = token ids the exchange hit (null = the tactics told nothing: no fight on this client);
   flagged = the Foundry targets in the roll's flag; action = ev.action */
/* WORDPOOL: atk = the roll is a blow (reader.classify: an attack by the system or the tactics, the system's Charge / Grapple); null = not
   known (a roll from before WORDPOOL): then by its action, as before */
export function rollTargets({ tag = null, hits = null, flagged = [], action = null, atk = null } = {}) {
  const tactical = !!(tag && typeof tag === "object" && typeof tag.inst === "string" && tag.inst);
  if (tactical && String(tag.key ?? "") === "attack" && Array.isArray(hits)) return cleanTargets([...hits].sort());
  if (tactical && String(tag.key ?? "") !== "attack") return [];
  return (typeof atk === 'boolean' ? atk : BLOW_ACTIONS.includes(action)) ? cleanTargets(flagged) : [];
}
/* IMPCALL: the targets after the first (the first is the impact's subject) take part in the impact as figures (`also`); the engine draws
   at most 8 figures with the subject and the roller, so at most ALSO_MAX */
export const ALSO_MAX = 6;
export const alsoTargets = (ids) => cleanTargets(ids).slice(1, 1 + ALSO_MAX);
/* look(id) -> "ok" (on this seat's board, seen, in its view) | "unseen" | "off" (seen, off the view) | "gone" (not on this scene) */
export function targetChoice(ids, look) {
  const list = cleanTargets(ids);
  if (!list.length) return { id: null, why: "none" };
  let s = "gone";
  try { s = look(list[0]); } catch (e) { s = "gone"; }
  return s === "ok" ? { id: list[0], why: list.length > 1 ? "first" : "target" } : { id: null, why: s === "unseen" || s === "off" ? s : "gone" };
}

/* ------------------------------------------------------------------ FXI-SPLASH (ADVI 2, 6, 7): WHEN a roll's impact lands
   The owner: the impact frame belongs to the instant the word hits, WITH it (not after it, not a second accent), and it tells the story.
   WHERE: on the target (ROLLTARGET above); a roll with no target this seat may mark: the result word (FXIS-1), never the roller's token. */
export const TICK = 1000 / 24;
/* the instant the word hits, in ms from the word's start, read from the engine's plan of that very word (the same seed and options as
   the play): the first entrance picture that carries the contact (a burst or a dust puff: the squash on the surface), else the engine's
   own flash frame, else the entrance picture where the word is biggest. A plan without an entrance timeline (another engine) may name
   the contact itself (plan.contactMs); else 0 (the word's first picture). */
export function contactMs(plan) {
  if (Number.isFinite(plan?.contactMs)) return Math.max(0, plan.contactMs);
  /* engine 1.9 (MOTION2): the word moves on pose keys (plan.motion.entKeys); its impact accent, when it has one, IS the contact and
     covers the first tick; else the first squash pose (wider than tall, or the reverse: the word flattened on the surface), else the
     biggest pose */
  const mo = plan?.motion;
  if (mo && Array.isArray(mo.entKeys) && mo.entKeys.length) {
    if (mo.flash && !mo.reduced) return 0;
    const pose = (k) => k?.[1] ?? {};
    const sq = mo.entKeys.find((k) => { const p = pose(k), sx = Number(p.sx) || 1, sy = Number(p.sy) || 1; return sx / sy >= 1.15 || sy / sx >= 1.3; });
    if (sq) return Math.round(Number(sq[0]) || 0);
    let best = -1, at = 0;
    for (const k of mo.entKeys) { const p = pose(k), v = (Number(p.s) || 1) * Math.max(Number(p.sx) || 1, Number(p.sy) || 1); if (v > best + 1e-6) { best = v; at = Number(k[0]) || 0; } }
    return Math.round(at);
  }
  const ent = plan?.timeline?.ent;
  if (!Array.isArray(ent) || !ent.length) return 0;
  const has = (p, ks) => Array.isArray(p?.fx) && p.fx.some((f) => ks.includes(f?.k));
  let i = ent.findIndex((p) => has(p, ["burst", "dust"]));
  if (i < 0) i = ent.findIndex((p) => p?.impact);
  if (i < 0) { let best = -1; ent.forEach((p, k) => { const s = sizeOf(p); if (s > best + 1e-6) { best = s; i = k; } }); }
  let a = 0; for (let k = 0; k < i; k++) a += Number(ent[k]?.ticks) || 0;
  return Math.round(a * TICK);
}
/* how much bigger than its hold picture the word gets during its entrance (the slam's smear reaches 1.6-1.8x): the layout keeps that
   room free too, else the word's biggest drawing crosses the bars or leaves the screen (ADVI 11: CRUSH! cut by the left edge) */
const sizeOf = (p) => { const g = p?.g ?? {}; const s = Number(g.s) || 1; return s * Math.max(Number(g.sx) || 1, Number(g.sy) || 1) * (p?.smear?.zoom ? 1 + p.smear.zoom * 0.5 : 1); };
export const GROW_MAX = 2;
export function growOf(plan) {
  const mo = plan?.motion;
  if (mo && Array.isArray(mo.entKeys) && mo.entKeys.length) {   // engine 1.9: the pose keys (and the stepped slam's smear picture)
    const keys = Math.max(1, ...mo.entKeys.map((k) => { const p = k?.[1] ?? {}; return (Number(p.s) || 1) * Math.max(Number(p.sx) || 1, Number(p.sy) || 1); }));
    const smear = (plan?.timeline?.ent ?? []).some((p) => p?.smear) ? 1.3 : 1;
    return clamp(Math.max(keys, smear), 1, GROW_MAX);
  }
  const ent = plan?.timeline?.ent;
  if (!Array.isArray(ent) || !ent.length) return 1;
  return clamp(Math.max(1, ...ent.map(sizeOf)), 1, GROW_MAX);
}
/* the impact's own build: the drawings before its peak (the gathering speed lines) come BEFORE the word hits, so its peak drawing falls on
   the contact tick */
export function leadMs(frames) {
  if (!Array.isArray(frames)) return 0;
  let a = 0;
  for (const f of frames) { const t = typeof f === "string" ? f : f?.type; if (t !== "lines") break; a += Number(typeof f === "string" ? 1 : f.ticks) || 1; }
  return Math.round(a * TICK);
}
/* On a map layer the words are drawn IN the scene, under the impact's overlay (ADVI 6: the black shadow frame hid HAYMAKER!, the slam's ink
   star blacked it out). There the impact keeps the word readable: only drawings that leave the word's own spot clear (focus lines that
   start outside it, a torn window around it on the scene's negative, the colour split of the whole scene). It still builds: lines
   gather, the peak lands on the contact, the lines carry it away; the rarer the result, the more of it. The shock ring is not used
   there: seen live (FXI-SPLASH strip after-5) its halftone disc sat over the word's letters for two ticks. */
export const MAP_FRAMES = [
  ["lines", "lines"],
  ["lines", { type: "chroma", ticks: 1, punch: 0.5 }, { type: "lines", ticks: 2 }],
  ["lines", { type: "window", ticks: 2, punch: 1 }, "chroma", { type: "lines", ticks: 2 }],
  ["lines", { type: "window", ticks: 2, punch: 1, stop: true }, { type: "chroma", ticks: 2 }, { type: "lines", ticks: 2 }]
];
export const COVERS_WORD = ["pop", "splat", "ink", "slam", "shadow", "glare", "swap", "smear", "dots", "shatter", "rip", "tear", "fade", "ring"];
/* CALLERS2 (engine 1.9.18): the engine's four strengths come from the running engine (I = L.impact: tierOf, seriesBoost), no hand copy of
   its thresholds. A splash impact is no series (seriesBoost(0) = 0), so its tier is I.tierOf(magnitude) as the engine's plan reads it. An
   engine without tierOf (before 1.9.18) gets the lowest map build: drawings that leave the word clear, never more than the engine may give. */
export function tierOfImpact(magnitude, I) {
  const m = Math.min(2, (Number(magnitude) || 0) + (typeof I?.seriesBoost === "function" ? I.seriesBoost(0) : 0));
  const t = typeof I?.tierOf === "function" ? Number(I.tierOf(m)) : 0;
  return Number.isInteger(t) ? Math.max(0, Math.min(MAP_FRAMES.length - 1, t)) : 0;
}
/* IMPCALL (engine 1.9.20 / 1.9.21: the tokens take part, their colours turned at their own luminance, popped; the owner: «bardziej jak
   sakuga MAD ... odwrócenia kolorów na tokenach, akcent na ich krawędziach, więcej efektów, dynamiczniej», and a roll is a rare table show):
   a map critical WITH a target (the roll's shared targets: the same frames on every seat, whether or not this seat may draw the target) keeps
   its build and peak and then holds on the struck figures: palette jumps on ones (hue negative, hue cycle, duotone, the negative / its held
   twin), pops, a kick back, the figure back in its own colours. Every added drawing is the engine's `fig` type (the scene untouched, nothing
   over the word's spot but a small star at the target) and comes AFTER the peak, so the peak, the word's lead-in and the moment's instant
   are the same as without (fxi-splash M, impcall C). Rims before the peak (`r`), the figure in its own colours on the torn window (`o`). */
export const MAP_FIGS = [
  null,
  null,
  { lead: ["r", "o", "i", "n"], tail: [{ type: "fig", ticks: 2, fig: "h", z: 1.25 }, { type: "fig", ticks: 2, fig: "d", punch: 0.6, kick: -1 }, { type: "fig", ticks: 3, fig: "o" }] },
  { lead: ["r", "o", "i", "n"], tail: [{ type: "fig", ticks: 1, fig: "h", z: 1.55, punch: 0.6, kick: -1 }, { type: "fig", ticks: 1, fig: "d", z: 1.25 }, { type: "fig", ticks: 2, fig: "i" }, { type: "fig", ticks: 2, fig: "n" }, { type: "fig", ticks: 3, fig: "o" }] }
];
/* CALLER5: the length of the TABLE's impact: impact-rungs.mjs tableImpactMs (shared with the token reactions) */
export const tableImpactMs = RG.tableImpactMs;
/* CALLER5 (engine 1.9.23: with no struck figure the attacker `from` is the cut-in's star): a map cut carries the figures' drawings when the
   roll has a target OR its roller stands on the table (both shared data: the same drawings on every seat; the engine draws a figure only
   where it may be seen) */
export const hasFigures = (targets, roller) => (Array.isArray(targets) && targets.length > 0) || roller === true;
export const mapFrames = (magnitude, I, o = {}) => {
  /* IMPCALL2: the ordinary and the strong result have their own map cuts (impact-rungs ROLL_MAP: the figures at the target; ROLL_MAP_BARE:
     lines and the colour split only), longer than the old tier 0-1 builds; the critical keeps the tiers below */
  if (o.rung === "ordinary" || o.rung === "strong") return RG.framesOf((o.figs ? RG.ROLL_MAP : RG.ROLL_MAP_BARE)[o.rung]);
  const tier = tierOfImpact(magnitude, I);
  const base = MAP_FRAMES[tier].map((f) => (typeof f === "string" ? f : { ...f }));
  const add = o.figs ? MAP_FIGS[tier] : null;
  if (!add) return base;
  return [...base.map((f, i) => ({ ...(typeof f === "string" ? { type: f, ticks: 1 } : f), fig: add.lead[Math.min(i, add.lead.length - 1)] })), ...add.tail.map((f) => ({ ...f }))];
};
