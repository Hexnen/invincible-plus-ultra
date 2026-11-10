/* node scripts/tactics/check-scheduler.mjs -- the trigger scheduler, "until your next turn", the end-of-scene plan, the challenge clock
   (spec 6.1, 6.8). No Foundry. */
import * as Sch from "./scheduler-pure.mjs";
import { ok, eq, done } from "./testkit.mjs";

const T = (id, at, type, extra = {}) => ({ id, at, subject: {}, run: { type }, source: { kind: "gm", name: id }, ...extra });

/* what is due, and in which order */
const list = [
  T("t1", "roundStart", "other"), T("t2", "roundStart", "challenge"), T("t3", "roundStart", "fireSpread"), T("t4", "roundStart", "fireAttack"),
  T("t5", "turnStart", "other", { subject: { combatant: "a" } }), T("t6", "turnStart", "other", { subject: { combatant: "b" } }), T("t7", "turnStart", "other", { subject: { any: 1 } }),
  T("t8", "zoneEnter", "other", { subject: { zone: "z1" } }), T("t9", "roundEnd", "other"), T("t10", "sceneEnd", "other"), T("t11", "turnStart", "other")
];
eq(Sch.due(list, { at: "roundStart" }).map((t) => t.id), ["t4", "t3", "t2", "t1"], "[OQ-4] round start: fire attacks, fire spread, challenge effects, the rest");
eq(Sch.ROUND_START_ORDER, ["fireAttack", "fireSpread", "challenge"], "[OQ-4] the provisional order is one named constant");
eq(Sch.due([...list, T("t0", "roundStart", "other", { order: -1 })], { at: "roundStart" })[0].id, "t0", "an explicit order wins");
eq(Sch.due(list, { at: "turnStart", combatant: "a" }).map((t) => t.id), ["t5", "t7"], "turn start: the combatant's own triggers and those for anybody");
eq(Sch.due(list, { at: "turnStart", combatant: "zz" }).map((t) => t.id), ["t7"], "a trigger without a subject is not a turn trigger");
eq(Sch.due(list, { at: "zoneEnter", zone: "z1", combatant: "a" }).map((t) => t.id), ["t8"], "zone triggers");
eq(Sch.due(list, { at: "zoneEnter", zone: "z2" }).length, 0, "another zone");
eq(Sch.due([T("r1", "roundEnd", "fireAttack", { subject: { combatant: "a" } }), T("r2", "roundEnd", "other", { subject: { zone: "z1" } }), T("r3", "turnEnd", "other", { subject: { combatant: "a" } })], { at: "roundEnd" }).map((t) => t.id), ["r1", "r2"],
  "at a point of the whole fight the subject says whom a trigger is about: a round-end trigger on one combatant or zone is due at the round's end");
eq(Sch.due(list, { at: "roundEnd" }).map((t) => t.id), ["t9"], "round end");
eq(Sch.due(list, { at: "sceneEnd" }).map((t) => t.id), ["t10"], "scene end");
ok(Sch.POINTS.includes("turnStart") && Sch.CHALLENGE_TIMES.heroTurnStart === "turnStart" && Sch.CHALLENGE_TIMES.endOfRound === "roundEnd", "challenge effect times map onto scheduler points");

/* runs */
let l2 = Sch.ran([T("a", "roundStart", "x"), T("b", "roundStart", "x", { expires: { afterRuns: 2 } })], "a");
eq(l2[0].runs, 1, "a run is counted");
l2 = Sch.ran(Sch.ran(l2, "b"), "b");
eq(l2.map((t) => t.id), ["a"], "a trigger good for two runs is gone after the second");

/* expiry: round end, scene end, "until your next turn" keyed to the combatant [B1634] [B1772] [I9] */
const ex = [
  { id: 1, expires: { at: "roundEnd" } }, { id: 2, expires: { at: "nextTurnOf", who: "a" } }, { id: 3, expires: { at: "nextTurnOf", who: "b" } }, { id: 4, expires: { at: "sceneEnd" } }, { id: 5 }
];
eq(Sch.expire(ex, { at: "roundEnd" }).gone.map((x) => x.id), [1], "round end");
eq(Sch.expire(ex, { at: "nextTurnOf", who: "a" }).gone.map((x) => x.id), [2], "until a's next turn");
eq(Sch.expire(ex, { at: "nextTurnOf", who: "a" }).keep.map((x) => x.id), [1, 3, 4, 5], "the rest stays");
eq(Sch.expire(ex, { at: "sceneEnd" }).gone.map((x) => x.id), [4], "scene end");
eq(Sch.expire(undefined, { at: "roundEnd" }), { keep: [], gone: [] }, "no list");
eq(Sch.dropSubject([T("x", "turnStart", "o", { subject: { combatant: "a" } }), T("y", "roundEnd", "o", { expires: { at: "nextTurnOf", who: "a" } }), T("z", "roundEnd", "o")], "a").map((t) => t.id), ["z"], "a combatant who leaves takes its triggers along");

/* end of scene (spec 6.8) */
const facts = [
  { id: "h", type: "superhero", health: 2, maxHealth: 8, resolve: 1, maxResolve: 6, strength: 3 },
  { id: "full", type: "superhero", health: 8, maxHealth: 8, resolve: 6, maxResolve: 6, strength: 3 },
  { id: "cap", type: "npc", health: 7, maxHealth: 8, resolve: 9, maxResolve: 6, strength: 4 },
  { id: "regen", type: "superhero", health: 0, maxHealth: 9, resolve: 2, maxResolve: 6, strength: 1, regeneration: true },
  { id: "mob", type: "minions", health: 1, maxHealth: 6, resolve: 0, maxResolve: 0, strength: 3 },
  { id: "car", type: "vehicle", health: 1, maxHealth: 6, strength: 3 },
  { id: "ch", type: "challenge", health: 0, maxHealth: 0 },
  { id: "bad", type: "npc", health: "x", maxHealth: null, resolve: undefined, maxResolve: NaN, strength: "?" }
];
const plan = Sch.sceneEndPlan(facts);
eq(plan.map((l) => l.id), ["h", "cap", "regen"], "only heroes and NPCs whose values change get a line");
eq(plan[0], { id: "h", health: { from: 2, to: 5 }, resolve: { from: 1, to: 1 } }, "[B2779] Health comes back by STRENGTH; [B2819] Resolve is not restored");
eq(plan[1], { id: "cap", health: { from: 7, to: 8 }, resolve: { from: 9, to: 6 } }, "[B2779] not above the maximum; [B1686] Resolve above the maximum is dropped");
eq(plan[2].health, { from: 0, to: 9 }, "[B1893] Regeneration heals everything");
eq(Sch.sceneEndPlan(null), [], "no facts");
const clean = Sch.sceneEndCleanup({
  triggers: [{ id: "a", expires: { at: "sceneEnd" } }, { id: "b" }], tokens: [{ id: "k", expires: { at: "sceneEnd" } }, { id: "l", expires: { at: "roundEnd" } }],
  effects: [{ id: "e1", ends: { at: "sceneEnd" } }, { id: "e2", ends: { at: "never" } }], counters: { "scene:x": 1, "round:y": 2, "session:z": 3 }
});
eq([clean.triggers.map((t) => t.id), clean.tokens.map((t) => t.id), clean.effects.map((t) => t.id), clean.ended.map((t) => t.id), clean.counters], [["b"], ["l"], ["e2"], ["e1"], { "session:z": 3 }], "what ends with the scene is gone, the rest stays");
eq(Sch.sceneEndCleanup({}).triggers, [], "an empty state");

/* the challenge clock [R22] */
eq(Sch.clockTick({ value: 3, max: 5 }), { value: 2, changed: true, failed: false }, "one round, one tick");
eq(Sch.clockTick({ value: 1, max: 5 }), { value: 0, changed: true, failed: true }, "the limit runs out");
eq(Sch.clockTick({ value: 0, max: 5 }), { value: 0, changed: false, failed: false }, "it does not fail twice");
eq(Sch.clockTick({ value: 4, max: 5 }, +1), { value: 5, changed: true, failed: false }, "a step back refunds");
eq(Sch.clockTick({ value: 5, max: 5 }, +1).changed, false, "never above the limit");
eq(Sch.clockTick({ value: 2, max: 0 }).changed, false, "a challenge without a time limit has no clock");
eq(Sch.clockTick({ value: "x", max: 5 }).changed, false, "garbage is left alone");

done("check-scheduler");
