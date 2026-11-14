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
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;

export function impactFor(ev, o = {}) {
  if (!ev || ev.fail || !Number.isFinite(ev.power) || ev.power < STRONG_P) return null;
  const fx = Number.isFinite(o.fx) ? o.fx : 1;
  if (!(fx > 0)) return null;      // the splash's Effects setting "off": no effects at all
  const P = ev.power;
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
  const out = { kind, magnitude: r2(clamp(magnitude, 0, 2)) };
  if (ev.npc) out.tone = "void";      // a villain's roll: violet and cyan, not the hero's yellow and blue
  if (fx < 1) { out.magnitude = r2(Math.max(0.2, out.magnitude - 0.5)); out.hitstop = false; }      // Effects "reduced": one strength lower, no hold of the scene
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
export function rollTargets({ tag = null, hits = null, flagged = [], action = null } = {}) {
  const tactical = !!(tag && typeof tag === "object" && typeof tag.inst === "string" && tag.inst);
  if (tactical && String(tag.key ?? "") === "attack" && Array.isArray(hits)) return cleanTargets([...hits].sort());
  if (tactical && String(tag.key ?? "") !== "attack") return [];
  return BLOW_ACTIONS.includes(action) ? cleanTargets(flagged) : [];
}
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
export const tierOf = (m) => (m < 0.35 ? 0 : m < 0.85 ? 1 : m < 1.35 ? 2 : 3);   // the engine's four strengths (impact/plan.mjs tierOf)
export const mapFrames = (magnitude) => MAP_FRAMES[tierOf(Number(magnitude) || 0)].map((f) => (typeof f === "string" ? f : { ...f }));
