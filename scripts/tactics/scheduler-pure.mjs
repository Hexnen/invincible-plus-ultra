/* Tactical combat (package P1): the TRIGGER SCHEDULER and the end-of-scene plan (spec sections 6.1 and 6.8). Pure ES module: NO Foundry
   globals. Node-tested by check-scheduler.mjs.
   Why it exists: Foundry's effect durations assume a fixed turn order; here the order is redrawn every round [plan 5.4].
   The scheduler only says WHAT is due at a point and in which order; each due trigger is then run as its own action instance by the
   engine (P2) or resolved by the GM. Citation marks as in dev/combat-spec.md 0.1. Book text is never quoted.

   Trigger = { id, at, subject:{ combatant?, zone?, any? }, run:{ type, ... }, source, order?, runs?, expires?:{ at, who?, afterRuns? } } */
import { damage } from "../rules/index.mjs";
import * as M from "./mods-pure.mjs";
import { setAt } from "./journal-pure.mjs";

/* [OQ-4] the book gives no order among the things that happen "at the start of the round" ([B2925-2927], [B2845], [B2876]).
   Provisional: fire attacks, then the fire spread rolls, then challenge effects, then everything else; the GM confirms or reorders the queue. */
export const ROUND_START_ORDER = ["fireAttack", "fireSpread", "challenge"];
export const POINTS = ["roundStart", "roundEnd", "turnStart", "turnEnd", "sceneEnd", "zoneEnter", "zoneExit", "beforeMove", "onDamaged", "onBroken"];
/* scheduler points of the rules library's challenge.EFFECT_TIMES (spec 6.1); the other three are not scheduler points */
export const CHALLENGE_TIMES = { roundStart: "roundStart", heroTurnStart: "turnStart", enterZone: "zoneEnter", endOfRound: "roundEnd" };

const rank = (t) => { const i = ROUND_START_ORDER.indexOf(t.run?.type); return i < 0 ? ROUND_START_ORDER.length : i; };

/* does the trigger concern this point? point = { at, combatant?, zone? } */
function concerns(t, point) {
  if (t.at !== point.at) return false;
  const s = t.subject ?? {};
  if (s.any) return true;
  /* a point of the whole fight (round start, round end, scene end) names no combatant and no zone: there the subject says whom the
     trigger is ABOUT (a fire attack on one combatant at the end of the round), not which point it waits for */
  if (point.at === "roundStart" || point.at === "roundEnd" || point.at === "sceneEnd") return (!point.combatant || !s.combatant || s.combatant === point.combatant) && (!point.zone || !s.zone || s.zone === point.zone);
  if (s.combatant) return s.combatant === point.combatant;
  if (s.zone) return s.zone === point.zone;
  return false;
}
/* the triggers due at a point, in the order they are proposed to the GM: explicit `order`, then the provisional kind order at round start, then age */
export function due(triggers, point) {
  return triggers.map((t, i) => ({ t, i })).filter(({ t }) => concerns(t, point))
    .sort((x, y) => ((x.t.order ?? 0) - (y.t.order ?? 0)) || (point.at === "roundStart" ? rank(x.t) - rank(y.t) : 0) || (x.i - y.i)).map(({ t }) => t);
}
/* a trigger ran: count it, and drop it when it was good for that many runs only. -> new list */
export function ran(triggers, id) {
  return triggers.map((t) => (t.id === id ? { ...t, runs: (t.runs ?? 0) + 1 } : t)).filter((t) => !(t.id === id && t.expires?.afterRuns && t.runs >= t.expires.afterRuns));
}
/* what ends when a moment is reached. moment = { at: "roundEnd" } | { at: "sceneEnd" } | { at: "nextTurnOf", who }
   ("until your next turn": Action Plan [B1634], Nullification of a passive power [B1772]; keyed to the combatant, so it moves with the card [I9] [B2282]).
   Works on any list whose items carry `expires` (triggers, and the modifier tokens of P2). -> { keep, gone } */
export function expire(list, moment) {
  const keep = [], gone = [];
  for (const x of list ?? []) {
    const e = x?.expires;
    const hit = !!e && e.at === moment.at && (moment.at !== "nextTurnOf" || e.who === moment.who);
    (hit ? gone : keep).push(x);
  }
  return { keep, gone };
}
/* a combatant left the fight: what was about it goes with it */
export const dropSubject = (triggers, combatant) => triggers.filter((t) => t.subject?.combatant !== combatant && t.expires?.who !== combatant);

/* ------------------------------------------------------------------ end of scene (spec 6.8)
   facts = [{ id, type, health, maxHealth, resolve, maxResolve, strength, regeneration? }] for the characters of the fight.
   -> lines [{ id, health:{ from, to }, resolve:{ from, to } }] with only the lines that change something.
   Health comes back by STRENGTH a few minutes after the scene [B2779]; Regeneration heals everything [B1893]; Resolve is NOT restored
   (that needs a social scene [B2819], so the library is called with socialScene:false); Resolve above the maximum is dropped [B1686];
   critical injuries stay [B2780] (nothing here touches them).
   Left to the GM (holes, reported): minion groups (their Health is their head count [B2828] and the book does not say that members come
   back), vehicles (Durability is repaired, not recovered [B3250]) and challenges get no line. */
export const SCENE_RECOVERY_TYPES = ["superhero", "npc"];
export function sceneEndPlan(facts) {
  const lines = [];
  for (const f of facts ?? []) {
    if (!SCENE_RECOVERY_TYPES.includes(f.type)) continue;
    const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const health = n(f.health), maxHealth = n(f.maxHealth), resolve = n(f.resolve), maxResolve = n(f.maxResolve);
    const r = damage.recoverAfterScene({ health, maxHealth, resolve, maxResolve, strength: n(f.strength), presence: 0, span: "minutes", socialScene: false });
    const toHealth = f.regeneration ? maxHealth : Math.max(health, Math.min(maxHealth, r.health));
    const toResolve = Math.min(resolve, maxResolve);
    if (toHealth === health && toResolve === resolve) continue;
    lines.push({ id: f.id, health: { from: health, to: toHealth }, resolve: { from: resolve, to: toResolve } });
  }
  return lines;
}
/* what the state loses at the end of the scene: triggers and modifier tokens that end with it, ongoing effects lasting "a few minutes" or
   the scene [B1650], scene-scoped use counters (spec 6.4). Wrecked zones and border states are not touched (a GM act [plan 5.4, 5.7.4]). */
export function sceneEndCleanup(state) {
  const r = endEffects({ ...state, effects: state.effects ?? [], tokens: state.tokens ?? [], triggers: state.triggers ?? [], statuses: state.statuses ?? {} }, { at: "sceneEnd" });
  const out = { triggers: expire(r.state.triggers, { at: "sceneEnd" }).keep, tokens: expire(r.state.tokens, { at: "sceneEnd" }).keep, effects: r.state.effects, statuses: r.state.statuses, counters: {}, ended: r.ended };
  for (const [k, v] of Object.entries(state.counters ?? {})) if (!SCENE_COUNTERS.some((p) => k.startsWith(p))) out.counters[k] = v;
  return out;
}
/* use counters that do not outlive the scene (spec 6.4, 6.8): per round, per scene and per zone; the per-session ones stay */
export const SCENE_COUNTERS = ["scene:", "round:", "zone:"];
/* Ongoing effects that end at a point (spec 6.5): { at: "sceneEnd" | "roundEnd" } or { at: "nextTurnOf" | "turnEndOf", who }. An effect that
   ends takes along what it registered (its tokens, triggers and statuses: mods-pure.effectEndWrites). -> { state, ended: [Effect] } */
export function endEffects(state, point) {
  const keyed = point.at === "nextTurnOf" || point.at === "turnEndOf";
  const ended = (state.effects ?? []).filter((e) => e?.ends?.at === point.at && (!keyed || e.ends.who === point.who));
  let s = state;
  for (const e of ended) for (const w of M.effectEndWrites(s, e.id)) s = setAt(s, w.path, w.to);
  return { state: s, ended };
}

/* ------------------------------------------------------------------ the challenge clock [R22] [I12]
   A challenge has no card; a time limit counted in rounds runs down at the END of each round (example [B2871]).
   -> { value, changed, failed }  failed = the limit ran out with this tick. */
export function clockTick({ value, max }, delta = -1) {
  const v = Number(value), m = Number(max);
  if (!(m > 0) || !Number.isFinite(v)) return { value: v, changed: false, failed: false };
  const next = Math.min(m, Math.max(0, v + delta));
  return { value: next, changed: next !== v, failed: delta < 0 && v > 0 && next === 0 };
}
