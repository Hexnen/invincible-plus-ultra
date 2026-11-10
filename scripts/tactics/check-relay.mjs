// node scripts/tactics/check-relay.mjs -- the relay's pure half (spec 12): trust, whitelist, limits, replies; then abuse cases against the engine itself.
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import * as R from "./relay-pure.mjs";
import * as D from "./director-pure.mjs";

const users = { gm: { id: "gm", staff: true }, p1: { id: "p1", staff: false }, p2: { id: "p2", staff: false } };
const ctx = (senderId, o = {}) => ({ senderId, user: (id) => users[id] ?? null, combatId: "C1", gate: o.gate ?? new R.Gate(), now: o.now ?? 1000, seen: o.seen ?? new Map() });
const msg = (req, o = {}) => ({ k: "tcreq", id: o.id ?? "7ab", n: "nonce", proto: o.proto ?? 1, mod: "1", combat: o.combat ?? "C1", req });
const code = (a) => (a.ok ? "ok" : a.env?.error?.code ?? null);
const decl = { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1"] } };

/* ---- trust */
eq(code(R.admit(msg(decl), ctx(null))), "untrusted", "no server-supplied sender id: untrusted");
eq(R.admit(msg(decl), ctx(null)).to, null, "and nobody is answered");
eq(code(R.admit(msg(decl), ctx("ghost"))), "untrusted", "a sender the world does not know: untrusted");
eq(code(R.admit({ ...msg(decl), userId: "gm" }, ctx("p1"))), "ok", "a payload user id is ignored");
eq(R.admit({ ...msg(decl), userId: "gm" }, ctx("p1")).user, { id: "p1", staff: false }, "identity = the server's word");
eq(R.admit(msg(decl, { id: "x1" }), ctx("p1")).rid, "p1:x1", "request id = <senderId>:<id>");
eq(R.makeRid("p1", "gm:../x y"), "p1:gmxy", "the id part cannot smuggle another sender or separators");
eq(code(R.admit(msg(decl, { proto: 0 }), ctx("p1"))), "stale", "older protocol: stale");
eq(code(R.admit(msg(decl, { combat: "other" }), ctx("p1"))), "stale", "another combat: stale");
eq(code(R.admit(msg(decl), { ...ctx("p1"), combatId: null })), "off", "no tactical combat: off");
{ const seen = new Map(); R.admit(msg(decl), ctx("p1", { seen })); const again = R.admit(msg(decl), ctx("p1", { seen })); eq([again.ok, again.env, again.to], [false, null, null], "the same envelope twice is ignored silently"); eq(code(R.admit(msg(decl), ctx("p2", { seen }))), "ok", "the same id from another sender is a different request"); }
eq(R.admit({ k: "ssreq" }, ctx("p1")).env, null, "other relays' kinds are not ours");

/* ---- whitelist */
eq(code(R.admit(msg({ op: "undo", tx: "t1" }), ctx("p1"))), "noPermission", "a GM operation from a player");
eq(code(R.admit(msg({ op: "undo", tx: "t1" }), ctx("gm"))), "ok", "staff may send every GM operation");
eq(code(R.admit(msg({ op: "explode" }), ctx("gm"))), "badInput", "unknown operation, even from staff");
eq(code(R.admit(msg(null), ctx("p1"))), "badInput", "no request");
eq(code(R.admit(msg({ op: "declare", actor: "../x", decl: {} }), ctx("p1"))), "badInput", "ids are validated by pattern");
eq(code(R.admit(msg({ op: "declare", actor: "__proto__", decl: {} }), ctx("p1"))), "badInput", "no prototype keys as ids");
{
  const n = R.normalize({ op: "declare", actor: "H1", evil: 1, decl: { action: "slugfest", targets: ["N1", "bad id", 7], secret: 1, mod: 9, forced: { sixes: 6 }, text: "x".repeat(900), exception: { text: "y".repeat(900), state: "granted" }, exploits: [{ id: "e1", stress: 999 }, { id: "!!" }] } });
  eq(Object.keys(n.req).sort(), ["actor", "decl", "op"], "unknown top-level fields are dropped");
  eq([n.req.decl.secret ?? null, n.req.decl.mod ?? null, n.req.decl.forced ?? null, n.req.decl.exception.state ?? null], [null, null, null, null], "GM-only declaration fields never come from a player");
  eq([n.req.decl.targets, n.req.decl.text.length, n.req.decl.exception.text.length, n.req.decl.exploits], [["N1"], 300, 300, [{ id: "e1", stress: 20 }]], "ids filtered, free text clamped to 300, numbers clamped");
}
eq(R.normalize({ op: "answer", prompt: "p1", value: { id: "block", always: true, deep: { a: { b: { c: { d: 1 } } } } } }).req.value, { id: "block", deep: { a: {} } }, "an answer value is shallow plain data; 'always' (NPC policy) is not a player's to set");
eq(R.normalize({ op: "answer", prompt: "p1" }).code, "badInput", "an answer needs a value");
eq(R.normalize({ op: "endTurn", actor: "H1", round: 2, slot: "s3", force: true }).req, { op: "endTurn", actor: "H1", round: 2, slot: "s3" }, "endTurn carries round and slot for the stale check");
eq(R.normalize({ op: "other", actor: "H1", text: "" }).code, "badInput", "empty text");
eq(R.normalize({ op: "other", actor: "H1", text: "z".repeat(5000) }).code, "tooBig", "payload above 4 KB");
eq(R.normalize({ op: "manual", inst: "a1", result: { note: "z".repeat(5000) } }, { staff: true }).ok, true, "staff are not held to 4 KB");
eq(R.sizeOf({ a: "ąę" }), 12, "size is counted in UTF-8 bytes");
for (const op of D.PLAYER_OPS) ok(R.normalize({ op, actor: "H1", inst: "a1", prompt: "p1", helper: "H1", value: "x", text: "t", round: 1, slot: "s1", with: "s2", unit: "full", decl: {} }).ok, `player op ${op} has a shape`);
eq([R.normalize({ op: "holdOff", actor: "H1", with: "s2", force: true, evil: 1 }).req, R.normalize({ op: "holdOff", actor: "H1" }).code], [{ op: "holdOff", actor: "H1", with: "s2" }, "badInput"], "the round driver's player operations pass its own whitelist");
eq([R.normalize({ op: "nextRound" }).code, R.normalize({ op: "start" }).code, R.normalize({ op: "nextRound", force: true }, { staff: true }).ok], ["noPermission", "noPermission", true], "the round belongs to the GM");

/* ---- limits */
{
  const gate = new R.Gate(); let rate = 0, busy = 0, okN = 0;
  for (let i = 0; i < 120; i++) { const r = gate.admit("p1", 1000 + i); if (r === "rate") rate++; else if (r === "busy") busy++; else { okN++; gate.release("p1"); } }
  eq([okN, rate, busy], [90, 30, 0], "90 requests per minute per user, then rate");
  eq(gate.admit("p2", 1100), null, "another user is not affected");
  eq(gate.admit("p1", 1000 + 61000), null, "a minute later the user is admitted again");
  const g2 = new R.Gate();
  eq([g2.admit("p1", 1), g2.admit("p1", 2), g2.admit("p1", 3), g2.admit("p1", 4)], [null, null, null, "busy"], "at most 3 in flight");
  g2.release("p1");
  eq(g2.admit("p1", 5), null, "a finished one frees a place");
  let s = 0; for (let i = 0; i < 500; i++) if (g2.admit("gm", i, true) === null) s++;
  eq(s, 500, "staff are not rate limited");
  const g3 = new R.Gate(); let codes = [];
  for (let i = 0; i < 95; i++) { const a = R.admit(msg(decl, { id: `i${i}` }), ctx("p1", { gate: g3, now: i })); codes.push(code(a)); if (a.ok) g3.release("p1"); }
  eq([codes.filter((c) => c === "ok").length, codes.filter((c) => c === "rate").length], [90, 5], "spam through admit: the limit holds");
}

/* ---- replies */
{
  const pending = new Map([["7ab", { nonce: "N" }]]);
  const res = { k: "tcres", id: "7ab", n: "N", to: "p1", env: { ok: true, changed: true, inst: "a1", state: { secret: 1 } } };
  eq(R.acceptReply(res, { me: "p1", pending, senderIsGM: false }), null, "a reply from a non-GM sender is ignored");
  eq(R.acceptReply({ ...res, n: "guess" }, { me: "p1", pending, senderIsGM: true }), null, "wrong nonce");
  eq(R.acceptReply({ ...res, to: "p2" }, { me: "p1", pending, senderIsGM: true }), null, "addressed to somebody else");
  eq(R.acceptReply({ ...res, id: "zzz" }, { me: "p1", pending, senderIsGM: true }), null, "not pending");
  eq(R.acceptReply(res, { me: "p1", pending, senderIsGM: true }), { id: "7ab", env: { ok: true, changed: true, inst: "a1" }, stale: false }, "accepted; the envelope never carries state");
  eq(R.acceptReply({ ...res, env: R.bad("stale") }, { me: "p1", pending, senderIsGM: true }).stale, true, "a stale answer is flagged (the requester waits 900 ms for a better one)");
  eq(R.wireEnv({ ok: false, error: { code: "made-up", key: "<img>" } }).error, { key: "ITAC.err.internal", code: "internal", params: {} }, "an unknown error code never reaches a client as a key");
  eq(R.wireEnv(null).error.code, "internal", "no envelope: internal");
  for (const c of R.RELAY_CODES) eq(R.bad(c).error.key, `ITAC.err.${c}`, `error key of ${c}`);
}

/* ---- abuse against the engine, through admit */
{
  const T = new Table(); T.hero("H1", "p1").hero("H2", "p2").npc("N1", { health: 5 }); T.order(["H1", "N1", "H2"]).turn("H1");
  const facts = T.facts();
  const send = async (sender, req, id) => { const a = R.admit(msg(req, { id }), { senderId: sender, user: (u) => facts.user(u), combatId: "C1", gate: T.gate ??= new R.Gate(), now: T.now(), seen: T.seenEnv ??= new Map() }); if (!a.ok) return a.env; const env = await T.req(a.user.id, a.req, a.rid); T.gate.release(a.user.id, a.user.staff); return R.wireEnv(env); };
  eq((await send("p2", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1"] } }, "a")).error.code, "notOwner", "a foreign actor");
  eq((await send("p2", { op: "declare", actor: "N1", decl: { action: "slugfest", targets: ["H1"] } }, "b")).error.code, "notOwner", "an NPC is nobody's but the GM's");
  eq((await send("p1", { op: "declare", actor: "H1", decl: { action: "gmRoll", targets: [] } }, "c")).error.code, "noPermission", "the GM's roll action");
  eq((await send("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1"] } }, "d")).ok, true, "a legal declaration");
  eq((await T.req("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1"] } }, "p1:d")).dup, true, "the same request id delivered by a second GM tab is applied once");
  const p = T.prompt("reaction");
  eq((await send("p2", { op: "answer", prompt: p.id, value: "pass" }, "e")).error.code, "notOwner", "answering somebody else's prompt");
  eq((await send("p1", { op: "answer", prompt: p.id, value: { id: "pass", always: true } }, "f")).error.code, "notOwner", "nor the GM's card");
  eq((await send("p2", { op: "cancel", inst: T.top().id }, "g")).error.code, "notOwner", "cancelling somebody else's action");
  eq((await send("p1", { op: "setSixes", inst: T.top().id, roll: "attack", sixes: 9 }, "h")).error.code, "noPermission", "an override from a player");
  eq((await send("p1", { op: "endTurn", actor: "H1", round: 1, slot: T.state.init.cur }, "i")).error.code, "busy", "end of turn under an open action");
  await T.gm({ op: "abort", inst: T.top().id });
  eq((await send("p1", { op: "endTurn", actor: "H1", round: 99, slot: T.state.init.cur }, "j")).error.code, "stale", "a stale end of turn");
  eq(T.state.stack.length, 0, "nothing of the above left a trace");
}
done("check-relay");
