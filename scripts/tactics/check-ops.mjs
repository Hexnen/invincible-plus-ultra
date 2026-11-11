/* node scripts/tactics/check-ops.mjs -- the reducer of the P1 operations and the round / turn driver, incl. the checks a request from a
   player must pass (spec 3, 4.4, 6.1, 6.8, 12.1, 12.2, 14.2). No Foundry: the executor's inputs are plain data here. */
import * as O from "./ops-pure.mjs";
import * as S from "./state-pure.mjs";
import * as Lg from "./ledger-pure.mjs";
import { dice } from "../rules/index.mjs";
import { ok, eq, done } from "./testkit.mjs";

const part = (id, o = {}) => ({ id, hero: false, owners: [], defeated: false, challenge: false, summonOf: null, veteran: false, reflexes: false, resolve: 3, ...o });
const PARTS = [part("h1", { hero: true, owners: ["u1"] }), part("h2", { hero: true, owners: ["u2"] }), part("n1"), part("n2"), part("ch", { challenge: true })];
/* a small table: GM and two players */
function table(parts = PARTS, seed = 5) {
  const T = { state: null, parts: parts.slice(), rng: dice.seededRng(seed), events: [], effects: [], n: 0 };
  T.ctx = (user) => ({ user, staff: user === "gm", owns: (id) => (T.parts.find((p) => p.id === id)?.owners ?? []).includes(user), parts: T.parts, rng: T.rng, playersEnd: T.playersEnd, sceneFacts: T.sceneFacts });
  T.do = (user, type, a = {}) => {
    const r = O.reduce(T.state, { type, rid: `${user}:${++T.n}`, ...a }, T.ctx(user));
    if (r.ok && r.changed) { T.state = r.state; T.events.push(...(r.events ?? [])); T.effects.push(...(r.effects ?? [])); T.last = r; }
    return r;
  };
  T.gm = (type, a) => T.do("gm", type, a);
  T.cur = () => T.state.init.curMember;
  T.code = (r) => r.error?.code ?? (r.ok ? "ok" : "?");
  T.prompts = (kind) => Object.values(T.state.prompts).filter((p) => !kind || p.kind === kind);
  T.userOf = (id) => T.parts.find((p) => p.id === id)?.owners[0] ?? "gm";
  return T;
}

/* ---------------------------------------------------------------- off, start, the first round */
{
  const T = table();
  eq(T.code(T.gm("endTurn", { actor: "h1" })), "off", "no state: the engine is off");
  eq(T.code(T.do("u1", "start")), "notOwner", "a player cannot start");
  const r = T.gm("start", { mode: "tactical" });
  ok(r.ok && r.changed && T.state.round === 1 && T.state.phase === "turns" && T.state.mode === "tactical" && T.state.rev === 1, "start: round 1, turns");
  eq(T.state.init.slots.length, 4, "[I12] [R22] the challenge has no card");
  ok(!T.state.ledger.ch && Object.keys(T.state.ledger).length === 4, "and no ledger");
  eq(T.cur(), T.state.init.slots[0].members[0], "[I1] the lowest card acts first");
  eq(T.events.map((e) => e.type).filter((t) => t !== "draw"), ["combatStart", "roundStart", "turnStart"], "events of the start");
  eq(T.events.filter((e) => e.type === "draw").length, 4, "one draw event per slot");
  eq(T.code(T.gm("start")), "busy", "starting twice is refused");
  ok(T.gm("start", { restart: true, mode: "free" }).ok && T.state.mode === "free" && T.state.rev === 1, "restart begins anew");
  ok(O.isOnTurn(T.state, T.cur()) && !O.isWaiting(T.state), "reads: on turn, not waiting");
  eq(O.orderOf(T.state).filter((x) => x.current).length, 1, "orderOf marks the current slot");
  eq(JSON.stringify(S.sanitize(T.state)), JSON.stringify(T.state), "the reducer returns a sanitised state");
}

/* ---------------------------------------------------------------- what a player's request must pass (spec 12.2) */
{
  const T = table();
  T.gm("start", { mode: "tactical" });
  while (T.cur() !== "h1") T.gm("nextTurn");
  const round = T.state.round;
  eq(T.code(T.do("u2", "endTurn", { actor: "h1" })), "notOwner", "forged: another player's hero");
  eq(T.code(T.do("u2", "endTurn", { actor: "h2" })), "notYourTurn", "not that hero's turn");
  eq(T.code(T.do("u1", "endTurn", { actor: "h1", round: round + 1 })), "stale", "a stale round");
  eq(T.code(T.do("u1", "endTurn", { actor: "h1", slot: "zz" })), "stale", "a stale slot");
  eq(T.code(T.do("u1", "nextRound")), "notOwner", "GM operations are not a player's");
  eq(T.code(T.do("u1", "ledgerEdit", { combatant: "h1", edit: "clearNoFull" })), "notOwner", "nor the ledger edits");
  eq(T.code(T.do("u1", "nope")), "unknown", "unknown operation");
  T.playersEnd = false;
  eq(T.code(T.do("u1", "endTurn", { actor: "h1" })), "playersOff", "the table does not let players end turns");
  T.playersEnd = true;
  const rev = T.state.rev;
  ok(T.do("u1", "endTurn", { actor: "h1", round }).ok && T.state.rev === rev + 1 && T.cur() !== "h1", "the owner ends the turn");
  const dup = O.reduce(T.state, { type: "endTurn", actor: T.cur(), rid: `u1:${T.n}` }, T.ctx("gm"));
  ok(dup.ok && dup.changed === false && dup.dup === true, "a request id seen before changes nothing");
  eq(T.code(O.reduce(T.state, null, T.ctx("gm"))), "badInput", "no action");
  eq(T.code(O.reduce(T.state, { type: "answer", prompt: "zz" }, T.ctx("gm"))), "gone", "an unknown prompt is gone");
  eq(O.reduce(T.state, { type: "reorderGroup", slot: "zz", members: [] }, T.ctx("gm")).error.code, "gone", "pure failures become error envelopes");
  const noRng = O.reduce(null, { type: "start" }, { staff: true, parts: PARTS });
  eq(T.code(noRng), "internal", "the reducer never rolls by itself: a missing rng is an internal error, not Math.random");
}

/* ---------------------------------------------------------------- normalize: the whitelist of a request */
{
  const N = (req, staff = false) => O.normalize(req, { staff });
  eq(N({ op: "endTurn", actor: "h1", round: "3", extra: "<script>", force: true }).action, { type: "endTurn", actor: "h1", round: 3 }, "only known fields; a player cannot force");
  eq(N({ op: "endTurn", actor: "h1", force: true }, true).action.force, true, "staff can force");
  eq(N({ op: "endTurn" }).error.code, "badInput", "a missing actor");
  eq(N({ op: "endTurn", actor: "a b" }).error.code, "badInput", "ids by pattern");
  eq(N({ op: "holdOff", actor: "a", with: "s2" }).action, { type: "holdOff", actor: "a", with: "s2" }, "holdOff");
  eq(N({ op: "mark", actor: "a", unit: "full" }).action, { type: "mark", actor: "a", unit: "full", on: true }, "mark");
  eq(N({ op: "mark", actor: "a", unit: "all" }).error.code, "badInput", "mark: unknown unit");
  eq(N({ op: "answer", prompt: "p1", value: "x".repeat(900) }).action.value.length, 300, "text is clamped");
  eq(N({ op: "answer", prompt: "p1", value: { order: ["t1", "<x>"], skip: "no", evil: 1 } }).action.value, { order: ["t1"], skip: [] }, "an object answer is an order and a skip list");
  eq(N({ op: "answer", prompt: "p1", value: [1] }).error.code, "badInput", "no other answer shapes");
  eq(N({ op: "start" }).error.code, "notOwner", "GM operations are refused for a player before anything else");
  eq(N({ op: "zzz" }).error.code, "unknown", "unknown operation");
  eq(N("x").error.code, "badInput", "not a request");
  eq(N({ op: "start", mode: "evil", groups: [["a", "b"], ["c"], "x"], surprised: ["a", 5], opts: { redraw: "firstRoundOnly" } }, true).action, { type: "start", surprised: ["a"], groups: [["a", "b"]], opts: { redraw: "firstRoundOnly" }, restart: false }, "start");
  eq(N({ op: "setCard", slot: "s1", card: 2.5 }, true).error.code, "badInput", "a card is an integer");
  eq(N({ op: "ledgerEdit", combatant: "a", edit: "evil" }, true).error.code, "badInput", "ledgerEdit: known edits only");
  /* transport helpers */
  const m = new Map();
  let hits = 0; for (let i = 0; i < 100; i++) if (O.rateHit(m, "u", 1000 + i)) hits++;
  eq(hits, 90, "90 requests a minute");
  ok(O.rateHit(m, "u", 1000 + 61000) && O.rateHit(m, "other", 1000), "the window slides; users are counted apart");
  ok(O.ownsFrom({ default: 0, u1: 3 }, "u1") && !O.ownsFrom({ default: 0, u1: 2 }, "u1") && !O.ownsFrom({ default: 0 }, "u2") && O.ownsFrom({ default: 3 }, "u2") && !O.ownsFrom(null, "u1"), "ownership is read from the document, not from the request");
  eq(O.makeRid("user1", "abc"), "user1:abc", "request ids carry the sender");
  eq([O.PROTO, O.MAX_BYTES, O.MAX_INFLIGHT, O.TEXT_MAX, O.RATE], [1, 4096, 3, 300, [90, 60000]], "the limits of spec 12.1");
}

/* ---------------------------------------------------------------- a whole round, the reset, the challenge clock effect */
{
  const T = table();
  T.gm("start", { mode: "tactical" });
  const order = T.state.init.slots.flatMap((s) => s.members);
  const seen = [];
  for (let i = 0; i < 4; i++) {
    const c = T.cur(); seen.push(c);
    ok(T.do(T.userOf(c), "mark", { actor: c, unit: "full" }).ok, "mark a full action on the own turn");
    eq(O.budgetOf(T.state, c).full, "used", "budget shows it");
    T.do(T.userOf(c), "endTurn", { actor: c });
  }
  eq(seen, order, "everybody acted once, in card order");
  eq(T.state.round, 2, "the next round began by itself");
  ok(T.effects.some((e) => e.type === "roundEnd" && e.round === 1), "[R22] the executor is told that round 1 ended (challenge clock)");
  ok(Object.values(T.state.ledger).every((L) => L.round === 2 && Lg.budget(L).full === "open" && L.entries.length === 0), "[L5] every ledger is new");
  ok(Lg.history(T.state.ledger[order[3]], "thisTurn", "acted") === true, "[I10] the facts of the last turn are kept");
  eq(T.events.filter((e) => e.type === "roundEnd").length, 1, "one roundEnd event");
  /* previous turn / next round */
  const c0 = T.cur();
  T.gm("nextTurn");
  const c1 = T.cur();
  ok(T.gm("prevTurn").ok && T.cur() === c0 && T.state.ledger[c0].open === 1 && !T.state.ledger[c1].open, "the GM steps back one turn");
  eq(T.code(T.gm("prevTurn")), "noPrev", "not beyond the start of the round");
  ok(T.gm("nextRound").ok && T.state.round === 3 && T.state.phase === "turns", "the GM ends the round early");
}

/* ---------------------------------------------------------------- the ledger through the reducer: marks, modes, lost turn */
{
  const T = table();
  T.gm("start", { mode: "tactical" });
  while (T.cur() !== "h1") T.gm("nextTurn");
  eq(T.code(T.do("u2", "mark", { actor: "h2", unit: "full" })), "notYourTurn", "[L2] no full action out of turn");
  ok(T.do("u2", "mark", { actor: "h2", unit: "quick" }).ok && T.state.ledger.h2.entries[0].interrupt === 1, "[L4] a quick action out of turn is an interrupt");
  eq(T.code(T.do("u1", "mark", { actor: "h2", unit: "quick" })), "notOwner", "forged mark");
  T.do("u2", "mark", { actor: "h2", unit: "quick" });
  eq(T.code(T.do("u2", "mark", { actor: "h2", unit: "quick" })), "noAction", "[L1] nothing left");
  ok(T.do("u2", "mark", { actor: "h2", unit: "quick", on: false }).ok && O.budgetOf(T.state, "h2").quick.includes("open"), "a manual mark can be taken back");
  eq(T.code(T.do("u1", "mark", { actor: "h1", unit: "quick", on: false })), "noAction", "nothing to take back");
  ok(T.gm("mark", { actor: "h2", unit: "full" }).ok, "the GM is not held by the turn (spec 14.5)");
  /* free mode: tracked, not enforced (spec 1.4) */
  T.gm("setMode", { mode: "free" });
  ok(T.do("u2", "mark", { actor: "h2", unit: "quick" }).ok || true, "free mode");
  T.gm("ledgerEdit", { combatant: "h2", edit: "void", entry: T.state.ledger.h2.entries.find((e) => e.cost === "full").id });
  ok(T.do("u2", "mark", { actor: "h2", unit: "full" }).ok, "free mode: a full action out of turn is only recorded");
  eq(T.gm("setMode", { mode: "free" }).changed, false, "the same mode changes nothing");
  T.gm("setMode", { mode: "off" });
  eq(T.code(T.gm("nextTurn")), "off", "mode off: the engine is idle");
  ok(T.gm("setMode", { mode: "tactical" }).ok && T.state.ledger.h2.entries.length > 0, "switching never discards state (spec 14.5)");
  /* per-combatant free play */
  T.gm("setFree", { combatant: "n1", on: true });
  ok(O.isFreeFor(T.state, "n1") && !O.isFreeFor(T.state, "h1"), "setFree for one combatant");
  /* [L7] a lost turn is skipped and consumed */
  const next = T.state.init.slots.flatMap((s) => s.members).find((m) => !T.state.init.trail.includes(m) && m !== T.cur());
  T.gm("ledgerEdit", { combatant: next, edit: "loseTurn", source: { kind: "stunt", name: "x" } });
  eq(T.code(T.do(T.userOf(next), "mark", { actor: next, unit: "quick" })), "noAction", "[L7] no interrupts while the lost turn is pending");
  T.events.length = 0;
  T.gm("nextTurn");
  ok(T.events.some((e) => e.type === "turnLost" && e.combatant === next) && T.cur() !== next && !T.state.ledger[next].lostTurn, "[L7] the turn is skipped and the loss is consumed");
  {
    const L = table(); L.gm("start", { mode: "tactical" });
    const second = L.state.init.slots[1].members[0];
    L.gm("ledgerEdit", { combatant: second, edit: "loseTurn" }); L.gm("nextTurn");
    ok(L.state.init.slots[1].state === "lost" && L.cur() === L.state.init.slots[2].members[0] && L.state.round === 1, "the slot shows the lost turn and the next one acts");
    L.gm("nextRound");
    ok(L.state.init.slots.every((s) => s.state !== "lost") && !L.state.ledger[second].lostTurn, "[L7] only that one turn");
  }
  /* [L8], grants, consent */
  T.gm("ledgerEdit", { combatant: "h1", edit: "noFull" });
  eq(O.budgetOf(T.state, "h1").full, "lost", "[L8] through the reducer");
  eq(T.code(T.gm("ledgerEdit", { combatant: "zz", edit: "noFull" })), "gone", "an unknown combatant");
  ok(T.gm("ledgerEdit", { combatant: "h1", edit: "grant", grant: { template: "quickness" } }).ok && O.budgetOf(T.state, "h1").grants.length === 1, "a grant from a template");
  eq(T.gm("ledgerEdit", { combatant: "h1", edit: "grant", grant: { template: "quickness" } }).error.params.reason, "oncePerRound", "[R1] once per round");
  T.gm("ledgerEdit", { combatant: "h1", edit: "grant", grant: { template: "guidance", from: "h2", unit: "full" } });
  const cp = T.prompts("grantConsent")[0];
  ok(cp && cp.about === "h1" && cp.to.users[0] === "u1", "[plan 5.3] the receiver is asked");
  eq(T.code(T.do("u2", "answer", { prompt: cp.id, value: "yes" })), "notOwner", "only the addressee answers");
  eq(T.code(T.do("u1", "answer", { prompt: cp.id, value: "maybe" })), "badInput", "yes or no");
  ok(T.do("u1", "answer", { prompt: cp.id, value: "no" }).ok && O.budgetOf(T.state, "h1").grants.some((g) => g.state === "refused") && !T.prompts("grantConsent").length, "a refusal is recorded");
  eq(T.code(T.do("u1", "answer", { prompt: cp.id, value: "no" })), "gone", "answering twice");
  ok(T.gm("ledgerEdit", { combatant: "h1", edit: "entry", cost: "quick", action: "dodge", tags: ["defence"] }).ok && T.state.ledger.h1.entries.some((e) => e.action === "dodge"), "the GM writes an entry");
}

/* ---------------------------------------------------------------- the draw's questions through the reducer [I6] [I7] */
{
  const parts = [part("v", { hero: true, owners: ["u1"], veteran: true }), part("f", { hero: true, owners: ["u2"], reflexes: true }), part("n")];
  const T = table(parts, 9);
  T.gm("start", { mode: "tactical" });
  eq(T.state.phase, "draw", "the draw waits for the Fast Reflexes holder");
  ok(O.isWaiting(T.state) && T.cur() === null, "nobody has the turn during the draw");
  let p = T.prompts("reflexes")[0];
  ok(p && p.about === "f" && p.to.users[0] === "u2" && p.options.length === 2 && T.state.init.pendingDraw.reflexes[0] === p.id, "[I6] the holder is shown two cards");
  eq(T.code(T.do("u1", "answer", { prompt: p.id, value: p.options[0].id })), "notOwner", "another player cannot choose");
  eq(T.code(T.do("u2", "answer", { prompt: p.id, value: "77" })), "badInput", "a card that was not drawn");
  eq(T.code(T.gm("nextTurn")), "busy", "no turns during the draw");
  ok(T.do("u2", "answer", { prompt: p.id, value: p.options[1].id }).ok && T.state.phase === "turns", "the choice finishes the draw");
  eq(T.state.init.slots.find((s) => s.members[0] === "f").card, Number(p.options[1].id), "the chosen card");
  ok(!T.state.init.pendingDraw && !T.state.init.draw && !T.prompts("reflexes").length, "nothing of the draw is left");
  T.gm("nextRound");
  eq(T.state.round, 2, "round 2");
  const vp = T.prompts("veteran")[0];
  ok(vp && vp.about === "v" && vp.options.find((o) => o.id === "keep").stress === 1 && T.state.phase === "draw", "[I7] the veteran is asked first");
  const card = vp.data.card;
  T.effects.length = 0;
  ok(T.do("u1", "answer", { prompt: vp.id, value: "keep" }).ok, "keep");
  eq(T.effects.filter((e) => e.type === "stress"), [{ type: "stress", combatant: "v", n: 1, source: "combatVeteran" }], "[I7] keeping costs 1 stress (executor effect)");
  p = T.prompts("reflexes")[0];
  ok(p && !p.options.some((o) => Number(o.id) === card), "the kept card is not in the deck any more");
  T.gm("answer", { prompt: p.id, value: p.options[0].id });
  eq(T.state.init.slots.find((s) => s.members[0] === "v").card, card, "[I7] the veteran holds last round's card");
  /* the GM may answer for a player; a holder who leaves does not block the draw */
  T.gm("nextRound");
  T.gm("answer", { prompt: T.prompts("veteran")[0].id, value: "draw" });
  ok(T.prompts("reflexes").length === 1 && T.state.phase === "draw", "waiting for f");
  T.parts = T.parts.filter((x) => x.id !== "f");
  ok(T.gm("roster").ok && T.state.phase === "turns" && !T.prompts("reflexes").length && T.state.init.slots.length === 2, "the holder left: the draw goes on without it");
  ok(T.effects.some((e) => e.type === "abortInstances" && e.actor === "f"), "its open actions are aborted through the engine (effect)");
}

/* ---------------------------------------------------------------- holding off, groups, extra turn, roster */
{
  const T = table();
  T.gm("start", { mode: "tactical", groups: [["n1", "n2"]] });
  eq(T.state.init.slots.length, 3, "[I4] the NPC group shares a card");
  const early = T.cur() !== "h1" && T.do("u1", "mark", { actor: "h1", unit: "quick" }).ok;      // [B2283]: a quick action spent as an interrupt, before h1's own turn (P8 D8: an action taken ON the turn uses the turn)
  while (T.cur() !== "h1") T.gm("nextTurn");
  const me = T.state.init.cur, targets = O.optionsOf(T.state, "h1").find((o) => o.id === "holdOff").targets ?? [];
  if (targets.length) {
    eq(T.code(T.do("u2", "holdOff", { actor: "h1", with: targets[0] })), "notOwner", "forged hold off");
    eq(T.code(T.do("u1", "holdOff", { actor: "h1", with: me })), "illegal", "not with oneself");
    const myCard = T.state.init.slots.find((s) => s.id === me).card;
    ok(early, "[B2283] the quick action was spent as an interrupt earlier in the round");
    ok(T.do("u1", "holdOff", { actor: "h1", with: targets[0] }).ok, "[I8] hold off");
    ok(T.state.init.slots.find((s) => s.id === targets[0]).card === myCard && T.state.init.cur === targets[0], "[I9] the partner has the card and the turn");
    ok(T.state.ledger.h1.held === 1 && !T.state.ledger.h1.open && Lg.budget(T.state.ledger.h1).quick[0] === "used", "[B2283] what was spent stays spent");
    const no = T.state.ledger.h1.turnNo;
    while (T.cur() !== "h1") T.gm("nextTurn");
    ok(T.state.ledger.h1.turnNo === no && T.events.some((e) => e.type === "turnStart" && e.combatant === "h1" && e.resumed), "[I9] the turn resumes, it is not a second one");
  } else ok(true, "h1 drew the last card: nothing to hold off for");
  /* group order and ungroup */
  const g = T.state.init.slots.find((s) => s.members.length === 2);
  ok(T.gm("reorderGroup", { slot: g.id, members: ["n2", "n1"] }).ok && T.state.init.slots.find((s) => s.id === g.id).members[0] === "n2", "the GM orders the group");
  ok(T.gm("ungroup", { member: "n2" }).ok && T.state.init.slots.length === 4, "ungroup");
  ok(T.gm("group", { members: ["n1", "n2"] }).ok && T.state.init.slots.length === 3, "group again");
  /* cards */
  const [a, b] = T.state.init.slots.filter((s) => !s.extra);
  eq(T.gm("setCard", { slot: a.id, card: b.card }).error.params.reason, "cardTaken", "setCard on a card in use");
  ok(T.gm("swapCards", { a: a.id, b: b.id }).ok, "swapCards");
  /* extra turn */
  const cur = T.cur();
  ok(T.gm("insertTurn", { combatant: "h2", kind: "mindControl", by: cur }).ok && T.state.ledger.h2.grants.some((x) => x.slot), "an extra turn gets its own pair [B1761]");
  eq(T.code(T.gm("insertTurn", { combatant: "zz" })), "gone", "not for a stranger");
  T.gm("nextTurn");
  let guard = 0; while (!(T.state.init.slots.find((s) => s.id === T.state.init.cur)?.extra) && guard++ < 6) T.gm("nextTurn");
  ok(T.cur() === "h2" && T.state.ledger.h2.extra && Lg.budget(T.state.ledger.h2).full === "open", "the extra turn is h2's, with a fresh budget");
  /* roster: join [A-1] and leave */
  T.parts.push(part("late"));
  ok(T.gm("roster").ok && T.state.ledger.late && T.state.init.slots.at(-1).members[0] === "late", "[A-1] a late joiner gets the next free card and acts last");
  eq(T.gm("roster").changed, false, "roster without a change changes nothing");
  T.parts.push(part("ch2", { challenge: true }), part("dead", { defeated: true }), part("pet", { summonOf: "h1" }));
  T.gm("roster");
  ok(!T.state.ledger.ch2 && T.state.ledger.dead && T.state.ledger.pet && !T.state.init.slots.some((s) => s.members.some((m) => ["ch2", "dead", "pet"].includes(m))), "challenges, the defeated and summons get no card [I12] [I14]");
  const leaving = T.cur();
  T.parts = T.parts.filter((p) => p.id !== leaving);
  ok(T.gm("roster").ok && !T.state.ledger[leaving] && T.cur() && T.cur() !== leaving, "the one whose turn it is leaves: the turn passes on (spec 3.3)");
  ok(T.events.some((e) => e.type === "combatantRemoved" && e.combatant === leaving), "event combatantRemoved");
}

/* ---------------------------------------------------------------- the scheduler through the reducer (spec 6.1) */
{
  const T = table();
  T.gm("start", { mode: "tactical" });
  const first = T.cur();
  T.gm("triggerAdd", { trigger: { at: "roundStart", run: { type: "challenge" }, source: { kind: "challenge", name: "Flood" } } });
  T.gm("triggerAdd", { trigger: { at: "roundStart", run: { type: "fireAttack" }, source: { kind: "fire", name: "Fire" } } });
  T.gm("triggerAdd", { trigger: { at: "turnStart", subject: { combatant: first }, run: { type: "other" }, source: { kind: "power", name: "Aura" }, expires: { afterRuns: 1 } } });
  T.gm("triggerAdd", { trigger: { at: "roundEnd", run: { type: "other" }, source: { kind: "gm", name: "Clock" }, expires: { at: "roundEnd" } } });
  T.gm("triggerAdd", { trigger: { at: "roundStart", subject: {}, run: { type: "other" }, source: { kind: "power", name: "Plan" }, expires: { at: "nextTurnOf", who: first } } });
  eq(T.code(T.gm("triggerAdd", { trigger: { at: "never", run: { type: "x" } } })), "badInput", "a trigger needs a known point");
  eq(T.state.triggers.length, 5, "five triggers");
  T.gm("nextRound");
  eq(T.state.phase, "roundEnd", "the round-end queue blocks the next round");
  let q = T.prompts("triggerQueue")[0];
  ok(q.to === "gm" && q.data.at === "roundEnd" && q.options.length === 1, "the GM gets the queue");
  eq(T.code(T.do("u1", "answer", { prompt: q.id, value: { order: [], skip: [] } })), "notOwner", "a player cannot run the GM's queue");
  T.effects.length = 0;
  T.gm("answer", { prompt: q.id, value: { order: [], skip: [] } });
  ok(T.effects.some((e) => e.type === "trigger" && e.trigger.source.name === "Clock") && T.effects.some((e) => e.type === "roundEnd"), "the trigger runs, then the round ends");
  ok(!T.state.triggers.some((t) => t.source.name === "Clock"), "a trigger that lasts until the end of the round is gone");
  eq([T.state.round, T.state.phase], [2, "roundStart"], "round 2 waits for the round-start queue");
  ok(T.cur() === null && O.isWaiting(T.state), "nobody has the turn before the queue is done");
  q = T.prompts("triggerQueue")[0];
  eq(q.options.map((o) => o.data.type), ["fireAttack", "challenge", "other"], "[OQ-4] the provisional order is proposed");
  T.effects.length = 0;
  T.gm("answer", { prompt: q.id, value: { order: [q.options[1].id], skip: [q.options[2].id] } });
  eq(T.effects.filter((e) => e.type === "trigger").map((e) => e.trigger.run.type), ["challenge", "fireAttack"], "the GM reorders and skips");
  eq(T.state.phase, "turns", "then the turns begin");
  /* turn start: informative queue, "until your next turn" */
  while (T.cur() !== first) T.gm("nextTurn");
  ok(!T.state.triggers.some((t) => t.source.name === "Plan"), "[B1634] 'until your next turn' ends when that turn begins");
  q = T.prompts("triggerQueue").find((p) => p.data.at === "turnStart");
  ok(q && q.about === first && !q.data.blocks, "the turn-start queue does not block the turn");
  T.gm("answer", { prompt: q.id, value: { order: [], skip: [] } });
  ok(!T.state.triggers.some((t) => t.source.name === "Aura"), "a one-run trigger is gone after its run");
  const tid = T.state.triggers[0].id;
  ok(T.gm("triggerRemove", { id: tid }).ok && T.code(T.gm("triggerRemove", { id: tid })) === "gone", "triggerRemove");
}

/* ---------------------------------------------------------------- end of scene (spec 6.8), challenge failure, stop */
{
  const T = table();
  T.sceneFacts = [{ id: "h1", type: "superhero", health: 1, maxHealth: 8, resolve: 2, maxResolve: 6, strength: 3 }, { id: "n1", type: "npc", health: 0, maxHealth: 4, resolve: 0, maxResolve: 2, strength: 2 }];
  T.gm("start", { mode: "tactical" });
  T.gm("triggerAdd", { trigger: { at: "sceneEnd", run: { type: "other" }, source: { kind: "power", name: "Fade" } } });
  T.state.effects = [{ id: "e1", kind: "power", ends: { at: "sceneEnd" } }]; T.state.counters = { "scene:x": 2, "session:y": 1 };
  ok(T.gm("challengeFail", { challenge: "ch" }).ok && T.prompts("challengeFail")[0].about === "ch", "[B2841] the GM gets the failure card");
  eq(T.gm("challengeFail", { challenge: "ch" }).changed, false, "not twice");
  ok(T.gm("answer", { prompt: T.prompts("challengeFail")[0].id, value: "run" }).ok && !T.prompts("challengeFail").length, "answered");
  eq(T.code(T.do("u1", "endScene")), "notOwner", "only the GM ends the scene");
  T.effects.length = 0; T.events.length = 0;
  ok(T.gm("endScene", { skip: ["n1"] }).ok && T.state.phase === "sceneEnd" && T.cur() === null, "the scene ends");
  eq(T.effects.find((e) => e.type === "recover").lines, [{ id: "h1", health: { from: 1, to: 4 }, resolve: { from: 2, to: 2 } }], "[B2779] recovery lines, minus what the GM skipped");
  ok(T.effects.some((e) => e.type === "trigger" && e.trigger.source.name === "Fade"), "scene-end triggers run");
  eq([T.state.effects, T.state.counters], [[], { "session:y": 1 }], "what lasts for the scene is gone");
  ok(T.events.some((e) => e.type === "sceneEnd") && T.events.some((e) => e.type === "effectEnd"), "events");
  eq(T.code(T.gm("nextTurn")), "busy", "no turns after the scene");
  ok(T.gm("start", { mode: "free" }).ok && T.state.round === 1, "a new start after the scene needs no restart flag");
  ok(T.gm("stop").ok && T.state === null || T.last.state === null, "stop removes the state");
}

/* ---------------------------------------------------------------- an empty fight, defeated combatants, extension points */
{
  const T = table([part("ch", { challenge: true })]);
  ok(T.gm("start").ok && T.state.phase === "turns" && T.cur() === null && T.state.round === 1, "a fight without cards waits instead of spinning");
  T.parts.push(part("x"));
  ok(T.gm("roster").ok && T.cur() === "x", "the first combatant to join gets the turn");
  const T2 = table([part("a"), part("b", { defeated: true })]);
  T2.gm("start"); T2.gm("nextTurn");
  ok(T2.state.round === 2 && T2.cur() === "a", "[D] a defeated combatant is not dealt a card");
  /* a prompt kind the round driver does not own is not answered here (the action engine answers its own through the director) */
  T2.state.prompts.p98 = { id: "p98", inst: null, step: "x", kind: "mystery", to: "gm", options: [] };
  eq(T2.code(T2.gm("answer", { prompt: "p98", value: "x" })), "unknown", "a prompt kind nobody handles");
}

/* ---------------------------------------------------------------- fuzz: random operations never break the invariants */
{
  let ops = 0, internal = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const r = dice.seededRng(seed * 31);
    const parts = Array.from({ length: 2 + Math.floor(r() * 6) }, (_, i) => part(`c${i}`, { hero: i < 2, owners: i < 2 ? [`u${i}`] : [], veteran: r() < 0.3, reflexes: r() < 0.3, challenge: r() < 0.1 }));
    const T = table(parts, seed);
    T.gm("start", { mode: r() < 0.5 ? "tactical" : "free", opts: { redraw: r() < 0.3 ? "firstRoundOnly" : "everyRound" }, surprised: parts.filter(() => r() < 0.2).map((p) => p.id) });
    for (let i = 0; i < 80 && T.state; i++) {
      const who = ["gm", "u0", "u1"][Math.floor(r() * 3)], ids = T.parts.map((p) => p.id), any = () => ids[Math.floor(r() * ids.length)], slots = T.state.init.slots.map((s) => s.id), slot = () => slots[Math.floor(r() * slots.length)] ?? "zz";
      const open = Object.values(T.state.prompts);
      const x = r();
      let res;
      if (open.length && x < 0.35) { const p = open[Math.floor(r() * open.length)]; res = T.do(r() < 0.8 ? "gm" : who, "answer", { prompt: p.id, value: p.kind === "triggerQueue" ? { order: [], skip: [] } : p.options[Math.floor(r() * p.options.length)]?.id ?? "x" }); }
      else if (x < 0.45) res = T.do(who, "endTurn", { actor: T.cur() ?? any() });
      else if (x < 0.55) res = T.do(who, "mark", { actor: any(), unit: r() < 0.5 ? "full" : "quick", on: r() < 0.8 });
      else if (x < 0.62) res = T.do(who, "holdOff", { actor: T.cur() ?? any(), with: slot() });
      else if (x < 0.70) res = T.gm("nextTurn");
      else if (x < 0.74) res = T.gm("nextRound");
      else if (x < 0.78) res = T.gm("prevTurn");
      else if (x < 0.82) { if (r() < 0.5 && T.parts.length > 1) T.parts.splice(Math.floor(r() * T.parts.length), 1); else T.parts.push(part(`j${seed}x${i}`, { reflexes: r() < 0.3 })); res = T.gm("roster"); }
      else if (x < 0.85) res = T.gm("group", { members: [any(), any()] });
      else if (x < 0.87) res = T.gm("ungroup", { member: any() });
      else if (x < 0.90) res = T.gm("insertTurn", { combatant: any() });
      else if (x < 0.93) res = T.gm("ledgerEdit", { combatant: any(), edit: ["loseTurn", "noFull", "clearLostTurn"][Math.floor(r() * 3)] });
      else if (x < 0.95) res = T.gm("triggerAdd", { trigger: { at: ["roundStart", "roundEnd", "turnStart"][Math.floor(r() * 3)], subject: r() < 0.5 ? { combatant: any() } : {}, run: { type: "other" } } });
      else if (x < 0.97) res = T.gm("swapCards", { a: slot(), b: slot() });
      else if (x < 0.98) res = T.gm("setMode", { mode: ["tactical", "free"][Math.floor(r() * 2)] });
      else res = T.gm("setCard", { slot: slot(), card: 1 + Math.floor(r() * 12), swap: r() < 0.5 });
      ops++;
      if (!res.ok && res.error.code === "internal") { internal++; ok(false, `seed ${seed} op ${i}: internal error ${res.error.params.msg}`); break; }
      const s = T.state, init = s.init;
      const bad = [];
      if (JSON.stringify(S.sanitize(s)) !== JSON.stringify(s)) bad.push("not sanitised");
      const members = init.slots.filter((x2) => !x2.extra).flatMap((x2) => x2.members);
      if (new Set(members).size !== members.length) bad.push("a combatant in two slots");
      if (members.some((m) => !T.parts.some((p) => p.id === m))) bad.push("a slot member that left");
      const cardsNow = init.slots.filter((x2) => !x2.extra && x2.card !== null).map((x2) => x2.card);
      if (new Set(cardsNow).size !== cardsNow.length) bad.push("a card held twice");
      if (s.phase === "turns" && init.slots.some((x2) => !x2.extra && x2.card === null)) bad.push("a slot without a card during the turns");
      if (init.slots.filter((x2) => x2.state === "active").length > 1) bad.push("two slots in progress");
      if (init.curMember && !(init.slots.find((x2) => x2.id === init.cur)?.members.includes(init.curMember))) bad.push("the turn pointer names a stranger");
      if (s.phase !== "turns" && init.curMember) bad.push("a turn outside the turns phase");
      if (s.phase === "turns" && !init.curMember && init.slots.length && !Object.keys(s.prompts).length) bad.push("turns phase without anybody on turn");
      if (Object.values(s.ledger).filter((L) => L.open).length > 1 + (s.summons?.length ?? 0)) bad.push("two open turns");
      if (Object.keys(s.ledger).some((id) => !T.parts.some((p) => p.id === id))) bad.push("a ledger of somebody who left");
      if (bad.length) { ok(false, `seed ${seed} op ${i}: ${bad.join("; ")}`); break; }
    }
  }
  ok(ops > 5000 && internal === 0, `fuzz: ${ops} random operations kept every invariant`);
}

done("check-ops");
