/* node scripts/tactics/check-state.mjs -- the state shape, the sanitiser against hostile data, request dedupe, and the per-user view
   (spec 1.3, 2, 10). No Foundry. */
import * as S from "./state-pure.mjs";
import { dice } from "../rules/index.mjs";
import { ok, eq, done } from "./testkit.mjs";

/* shape */
const s0 = S.newState({ mode: "tactical", opts: { redraw: "firstRoundOnly", junk: () => 1 } });
ok(s0.v === 1 && s0.rev === 0 && s0.mode === "tactical" && s0.kind === "combat" && s0.round === 0 && s0.phase === "idle", "a new state");
eq(Object.keys(s0).sort(), ["counters", "effects", "evSeq", "free", "init", "items", "karma", "kind", "knowledge", "ledger", "mode", "npc", "opts", "phase", "prompts", "revealed", "rev", "round", "sched", "seen", "seq", "stack", "statuses", "summons", "tokens", "triggers", "txOpen", "v"].sort(), "every field of the spec's State is there (plus seq, sched)");
eq(s0.opts, { redraw: "firstRoundOnly", pushOrder: "afterDefence", playersEnd: true }, "options are typed");
eq(S.newState({ mode: "zzz", kind: "zzz" }).mode + S.newState({ mode: "zzz", kind: "zzz" }).kind, "freecombat", "unknown mode and kind fall back");
eq(S.parse(S.serialize(s0)), s0, "serialize / parse round trip");
eq(S.sanitize(S.sanitize(s0)), S.sanitize(s0), "sanitize is idempotent");
ok(S.parse("") === null && S.parse("{") === null && S.parse("null") === null && S.parse(42) === null && S.sanitize({ v: 2 }) === null && S.sanitize([]) === null, "what is not a state of this version is no state");

/* errors */
eq(S.err("stale", { a: 1 }), { ok: false, changed: false, error: { key: "ITAC.err.stale", code: "stale", params: { a: 1 } } }, "error envelope (spec 12.1)");

/* ids, dedupe */
ok(S.isId("abc.DEF-1_2:3@x|y") && !S.isId("") && !S.isId("a b") && !S.isId("<x>") && !S.isId(5) && !S.isId("x".repeat(65)), "id pattern");
const st = S.newState();
eq([S.nextId(st, "p"), S.nextId(st, "p"), S.nextId(st, "t")], ["p1", "p2", "t3"], "ids from the state's own counter");
for (let i = 0; i < 100; i++) S.stamp(st, `u:${i}`);
ok(st.rev === 100 && st.seen.length === S.SEEN_MAX && S.hasSeen(st, "u:99") && !S.hasSeen(st, "u:5") && !S.hasSeen(st, undefined), "rev counts, the last 80 request ids are remembered");

/* hostile data */
const hostile = JSON.parse(JSON.stringify({
  v: 1, rev: "9", mode: "tactical", round: -5, phase: "nope", seq: 1e99,
  seen: [1, "ok", "x".repeat(500)],
  init: {
    deck: 99999, cur: "s1", curMember: "ghost", trail: ["a", "<img>", 7], surprised: ["a", {}], prev: { a: 3, "b c": 4, d: "x" },
    slots: [
      { id: "s1", card: 3.7, members: ["a", "a", "b c", 5], state: "weird", done: ["a", "zz"] },
      { id: "s1", card: 4, members: ["dup"] }, { id: "s2", card: -3, members: ["a"] }, { id: "s3", card: 5, members: [] }, "junk", null,
      { id: "x1", card: 9, members: ["a"], extra: { kind: "evil", by: "<b>" }, at: 2 }
    ],
    draw: { round: 1, stage: "zz", left: [1, "x", 5000], queue: ["s1", 3], keeps: { s1: 2, "bad key": 1 }, surprised: "no", wait: { slot: "s1", drawn: [1, 2, 3], prompt: {} } },
    pendingDraw: { veteran: ["p1", 3], reflexes: "x" }
  },
  ledger: {
    a: { round: 1, n: 2, grants: [{ id: "gA", unit: "A" }, { id: "g2", unit: "evil" }, { id: "gA", unit: "B" }, { id: "g3", unit: "any", window: "turnOf:b", needsConsent: true, consent: "maybe", stress: -1, source: { __proto__: { x: 1 }, name: "n" } }],
      entries: [{ id: "e1", cost: "full", tags: ["attack", 5], stress: 2 }, { id: "e1", cost: "quick" }, { cost: "full" }, { id: "e2", cost: "zzz", action: "x".repeat(200), target: ["a", "<x>"] }],
      history: { round: { moved: "3", tags: ["a", 1], attacked: 1 }, prevTurn: "x" }, lostTurn: { source: { kind: "stunt" } }, noFull: "x", open: 1 },
    "bad key": { round: 1 }, b: "junk"
  },
  triggers: [{ id: "t1", at: "roundStart", run: { type: "x", fn: null } }, { id: "t1", at: "roundStart", run: { type: "y" } }, { id: "t2", at: "never", run: { type: "x" } }, { id: "t3", at: "turnStart", run: "x" },
    { id: "t4", at: "turnStart", subject: { combatant: "<a>", zone: "z", any: true }, run: { type: "x" }, expires: { at: "weird", who: "a", afterRuns: 2 }, order: "3" }],
  prompts: { p1: { id: "p1", kind: "veteran", to: { users: ["u1", "<u>"] }, options: [{ id: "keep", label: "L".repeat(500), stress: 1 }, { id: "bad id" }, "x"], about: "a", answered: { by: "u1", at: "x", value: { deep: 1 } } }, p2: { id: "other", kind: "x", to: "gm" }, p3: "x" },
  free: { a: 1, "bad key": 1, c: 0 },
  sched: { done: ["1:rs", 5] },
  stack: [{ id: "i1", fn: "x" }], npc: { a: { policy: "secret" } }, counters: { "scene:x": 1 }, chase: { round: 1 },
  opts: { redraw: "evil", playersEnd: "no" }
}));
hostile.init.slots.push({ id: "deep", members: ["m"], card: 1, extra: 5 });
const h = S.sanitize(hostile);
ok(h && h.rev === 9 && h.round === 0 && h.phase === "idle" && Number.isFinite(h.seq), "numbers are clamped, the phase is a known one");
eq(h.seen, ["ok"], "request ids are short strings");
eq(h.init.slots.map((s) => [s.id, s.card, s.members, s.state, s.done]), [["s1", 3, ["a"], "waiting", ["a"]], ["x1", null, ["a"], "waiting", []], ["deep", 1, ["m"], "waiting", []]], "slots: ids by pattern, one slot per combatant, no empty slot, no duplicate id");
eq(h.init.slots[1].extra, { kind: "gm" }, "an extra turn's kind and author are typed");
ok(h.init.deck === 999 && h.init.cur === "s1" && h.init.curMember === null, "the turn pointer never names a stranger");
eq([h.init.trail, h.init.surprised, h.init.prev], [["a"], ["a"], { a: 3 }], "id lists and the last cards");
eq(h.init.draw, { round: 1, stage: "veteran", size: 10, left: [1, 999], queue: ["s1"], keeps: { s1: 2 }, surprised: [], wait: { slot: "s1", drawn: [1, 2], prompt: null }, vetWait: [] }, "the unfinished draw is typed");
eq(h.init.pendingDraw, { veteran: ["p1"], reflexes: [] }, "pendingDraw");
eq(Object.keys(h.ledger), ["a"], "ledgers: only by id, only objects");
eq(h.ledger.a.grants.map((g) => g.id), ["gA", "g3"], "grants: known units, unique ids");
ok(h.ledger.a.grants[1].consent === "pending" && h.ledger.a.grants[1].window === "turnOf:b" && !("stress" in h.ledger.a.grants[1]) && Object.getPrototypeOf(h.ledger.a.grants[1].source) === Object.prototype && h.ledger.a.grants[1].source.x === undefined, "a grant is typed and prototype keys are dropped");
eq(h.ledger.a.entries.map((e) => [e.id, e.cost, e.tags, e.action.length]), [["e1", "full", ["attack"], 5], ["e2", "none", [], 60]], "entries are typed");
eq(h.ledger.a.entries[1].target, ["a"], "targets are ids");
ok(h.ledger.a.history.round.moved === 3 && h.ledger.a.history.round.attacked === 1 && !h.ledger.a.history.prevTurn && h.ledger.a.lostTurn.until === "nextTurnConsumed" && !h.ledger.a.noFull && h.ledger.a.open === 1, "history and the lost turn are typed");
eq(h.triggers.map((t) => t.id), ["t1", "t4"], "triggers: known points, an object to run, unique ids");
eq([h.triggers[1].subject, h.triggers[1].expires, h.triggers[1].order], [{ zone: "z", any: 1 }, { who: "a", afterRuns: 2 }, 3], "trigger fields are typed");
eq(Object.keys(h.prompts), ["p1"], "prompts are keyed by their own id");
ok(h.prompts.p1.to.users.length === 1 && h.prompts.p1.options.length === 1 && h.prompts.p1.options[0].label.length === 120 && h.prompts.p1.answered.at === 0, "a prompt is typed");
eq([h.free, h.sched.done, h.opts.redraw, h.opts.playersEnd], [{ a: 1 }, ["1:rs"], "everyRound", true], "free, sched, opts");
eq([h.stack, h.npc, h.counters, h.chase], [[{ id: "i1", fn: "x" }], { a: { policy: "secret" } }, { "scene:x": 1 }, { round: 1 }], "the fields of later packages survive a P1 write");
/* plain(): depth, functions, cycles */
let deep = {}; let cur = deep; for (let i = 0; i < 40; i++) { cur.n = {}; cur = cur.n; }
ok(JSON.stringify(S.plain(deep)).length < 200, "depth is capped");
const cyc = { a: 1 }; cyc.self = cyc;
ok(S.plain(cyc).a === 1, "a cycle cannot hang the copy");
eq(S.plain({ f: () => 1, s: Symbol("x"), n: NaN, u: undefined, ok: "y", big: "x".repeat(5000) }).ok, "y", "functions and symbols are dropped");
eq(S.plain({ big: "x".repeat(5000) }).big.length, 4000, "strings are capped");
ok(S.plain(Array(5000).fill(1)).length === S.LIMITS.list, "lists are capped");
/* random garbage never throws and always yields null or a stable state */
const rng = dice.seededRng(11);
const junk = (d) => { const r = rng(); if (d > 4 || r < 0.25) return [null, 1, -1, "s", "a".repeat(70), true, 1e99, "", "__proto__"][Math.floor(rng() * 9)]; if (r < 0.55) return Array.from({ length: Math.floor(rng() * 4) }, () => junk(d + 1)); const o = {}; for (const k of ["id", "v", "init", "slots", "members", "card", "ledger", "a", "grants", "entries", "prompts", "p1", "to", "users", "triggers", "run", "type", "at", "draw", "wait"]) if (rng() < 0.3) o[k] = junk(d + 1); return o; };
let stable = 0;
for (let i = 0; i < 3000; i++) {
  const j = junk(0); if (j && typeof j === "object" && !Array.isArray(j) && rng() < 0.7) j.v = 1;
  const r = S.sanitize(j);
  if (r === null) continue;
  stable++;
  if (JSON.stringify(S.sanitize(r)) !== JSON.stringify(r)) { ok(false, `garbage ${i}: sanitize is not stable`); break; }
}
ok(stable > 300, `garbage: ${stable} accepted states were all stable`);

/* the view of one user (spec 10, P1 part) */
const full = S.newState({ mode: "tactical" });
full.round = 2; full.phase = "turns"; full.seen = ["u:1"]; full.rev = 7;
full.init = { deck: 10, cur: "s2", curMember: "HIDDEN1", prev: { HIDDEN1: 2, a: 1 }, trail: ["a", "HIDDEN1"], surprised: ["HIDDEN1", "b"],
  slots: [{ id: "s1", card: 1, members: ["a"], state: "done", done: ["a"] }, { id: "s2", card: 2, members: ["HIDDEN1"], state: "active", done: [] }, { id: "s3", card: 3, members: ["b", "HIDDEN2"], state: "waiting", done: [] },
    { id: "x4", card: null, at: 2, members: ["a"], state: "waiting", done: [], extra: { kind: "mindControl", by: "HIDDEN1" } }],
  draw: { round: 2, stage: "deal", size: 10, left: [4, 5, 6], queue: [], keeps: {}, surprised: [], wait: null, vetWait: [] } };
full.ledger = { a: S.sanitizeLedger({ round: 2, grants: [{ id: "g9", unit: "any", from: "HIDDEN1", kind: "guidance" }], entries: [{ id: "e1", cost: "quick", target: ["HIDDEN2"] }, { id: "e2", cost: "full", target: ["b"] }] }), HIDDEN1: S.sanitizeLedger({ round: 2 }), b: S.sanitizeLedger({ round: 2 }) };
full.triggers = [{ id: "t1", at: "turnStart", subject: { combatant: "HIDDEN1" }, run: { type: "x" }, source: { kind: "gm", name: "" } }, { id: "t2", at: "roundEnd", subject: {}, run: { type: "x" }, source: { kind: "gm", name: "" } }];
full.prompts = { p1: { id: "p1", inst: null, step: "", kind: "triggerQueue", to: "gm", options: [{ id: "t1", label: "x" }], about: "HIDDEN1" }, p2: { id: "p2", inst: null, step: "", kind: "reflexes", to: { users: ["u1"] }, options: [{ id: "3", label: "3" }], about: "a" },
  p3: { id: "p3", inst: null, step: "", kind: "x", to: "gm", options: [{ id: "o", label: "secret" }], gmOnlyData: 1, data: { s: 1 } } };
full.npc = { HIDDEN1: { policy: 1 }, b: { policy: 2 } };
full.statuses = { HIDDEN2: [{ id: "st1" }], a: [{ id: "st2", by: "HIDDEN1" }, { id: "st3" }] };
full.free = { HIDDEN1: 1, a: 1 };
full.tokens = [{ id: "k1", holder: "a", from: "HIDDEN2" }, { id: "k2", holder: "b" }];
full.stack = [{ id: "i1", actor: "HIDDEN1", targets: ["a"] }, { id: "i2", actor: "a", targets: [{ id: "b" }] }];
full.revealed = { HIDDEN1: { a: 1 } }; full.knowledge = { a: { HIDDEN2: 1, b: 1 } };
const gmView = S.viewFor(full, { gm: true });
eq(gmView, S.sanitize(full), "the GM sees everything");
const v = S.viewFor(full, { gm: false, userId: "u1", hidden: ["HIDDEN1", "HIDDEN2"] });
const text = JSON.stringify(v);
ok(!text.includes("HIDDEN1") && !text.includes("HIDDEN2"), "no record names a combatant Foundry hides from the user");
ok(v.init.cur === null && v.init.curMember === null, "nobody learns that a hidden combatant has the turn");
eq(v.init.slots.map((s) => [s.id, s.members]), [["s1", ["a"]], ["s3", ["b"]], ["x4", ["a"]]], "hidden members leave their slots, empty slots disappear");
ok(!v.init.draw, "the cards left in the deck are not sent");
eq([v.seen, v.npc], [[], {}], "request ids and NPC policies are not sent");
eq(Object.keys(v.ledger).sort(), ["a", "b"], "a hidden combatant's ledger is not sent");
eq([v.ledger.a.grants.map((g) => g.id), v.ledger.a.entries.map((e) => e.id)], [[], ["e2"]], "records that name a hidden combatant go as a whole");
eq([v.triggers.map((t) => t.id), Object.keys(v.prompts).sort(), v.tokens.map((t) => t.id), v.stack.map((t) => t.id)], [["t2"], ["p2", "p3"], ["k2"], ["i2"]], "triggers, prompts, tokens, instances");
ok(v.prompts.p3.options.length === 0 && !v.prompts.p3.data, "a GM-only prompt keeps no options or data");
eq([v.statuses, v.free, v.revealed, v.knowledge], [{ a: [{ id: "st3" }] }, { a: 1 }, {}, { a: { b: 1 } }], "maps keyed by a hidden combatant lose the key");
ok(v.rev === 7 && v.round === 2 && v.mode === "tactical", "the public header stays");
const open = S.viewFor(full, { gm: false, userId: "u1", hidden: [] });
ok(open.init.curMember === "HIDDEN1" && !open.init.draw && open.seen.length === 0, "nothing hidden: only the deck, the ids and the policies are held back");
/* property: whatever the state, a hidden id never leaks */
for (let seed = 1; seed <= 300; seed++) {
  const r = dice.seededRng(seed), idsAll = ["a", "b", "c", "SECRETX", "SECRETY"];
  const pick = () => idsAll[Math.floor(r() * idsAll.length)];
  const any = (d) => { const x = r(); if (d > 3 || x < 0.3) return x < 0.15 ? pick() : Math.floor(r() * 9); if (x < 0.6) return Array.from({ length: 1 + Math.floor(r() * 3) }, () => any(d + 1)); const o = {}; for (let i = 0; i < 3; i++) o[r() < 0.4 ? pick() : `k${i}`] = any(d + 1); return o; };
  const st2 = S.newState();
  st2.init.slots = idsAll.map((id, i) => ({ id: `s${i}`, card: i + 1, members: r() < 0.3 ? [id, pick()] : [id], state: "waiting", done: [] }));
  st2.init.cur = "s3"; st2.init.curMember = "SECRETX";
  for (const k of ["stack", "tokens", "effects", "items", "summons", "karma"]) st2[k] = Array.from({ length: 3 }, () => any(0));
  for (const k of ["statuses", "counters", "knowledge", "revealed", "npc"]) st2[k] = any(1);
  for (const id of idsAll) st2.ledger[id] = S.sanitizeLedger({ round: 1, entries: [{ id: "e1", cost: "quick", target: [pick()], onTurnOf: pick() }], grants: [{ id: "g1", unit: "any", from: pick() }] });
  st2.triggers = [{ id: "t1", at: "turnStart", subject: { combatant: pick() }, run: { type: "x", who: pick() }, source: { kind: "gm", name: "" }, expires: { at: "nextTurnOf", who: pick() } }];
  const out = JSON.stringify(S.viewFor(st2, { gm: false, userId: "u", hidden: ["SECRETX", "SECRETY"] }));
  if (out.includes("SECRETX") || out.includes("SECRETY")) { ok(false, `view leak, seed ${seed}`); break; }
  if (seed === 300) ok(true, "300 random states: no hidden id in any view");
}

done("check-state");
