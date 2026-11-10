// node scripts/tactics/check-journal.mjs -- journal primitives (spec 15): paths, reversible ops, fine-grained diffs, the log cap, undo planning, drift.
import { ok, eqc as eq, done, seeded } from "./testkit.mjs";
import * as J from "./journal-pure.mjs";

/* ---- paths */
{
  const s = { a: { b: 1 }, list: [{ id: "x", n: 1 }, { id: "y", n: 2 }] };
  eq([J.getAt(s, ["a", "b"]), J.getAt(s, ["list", "#y", "n"]), J.getAt(s, ["list", "#z"]), J.getAt(s, ["nope", "deeper"])], [1, 2, null, null], "getAt: keys, #id elements, missing = null");
  const t = J.setAt(s, ["list", "#y", "n"], 5);
  eq([t.list[1].n, s.list[1].n, t.a === s.a], [5, 2, true], "setAt is copy-on-write and shares untouched branches");
  eq(J.setAt(s, ["list", "#x"], null).list.map((e) => e.id), ["y"], "writing null removes the element");
  eq(J.setAt(s, ["list", "#z"], { id: "z" }).list.map((e) => e.id), ["x", "y", "z"], "a missing id appends");
  eq(J.setAt(s, ["a", "b"], null).a, {}, "null removes a key");
  eq(J.setAt({}, ["p", "q", "#i", "v"], 1), { p: { q: [{ id: "i", v: 1 }] } }, "missing parents are created");
  for (const p of [[], ["__proto__"], ["a", "constructor"], ["a", ""], "a", ["a", 1], Array(9).fill("a")]) { let threw = false; try { J.setAt({}, p, 1); } catch { threw = true; } ok(threw, `setAt refuses the path ${JSON.stringify(p)}`); }
  eq({}.polluted ?? null, null, "no prototype pollution");
}
/* ---- reversible state ops */
{
  const s = { tokens: [{ id: "t1", dice: 1 }], ledger: { H1: { entries: [{ id: "e1" }] } } };
  const r = J.stateOp(s, ["tokens", "#t1", "dice"], 3);
  eq([r.state.tokens[0].dice, J.applyStateOp(r.state, r.op, true)], [3, s], "apply and invert");
  eq(J.stateOp(s, ["tokens", "#t1", "dice"], 1).op, null, "no change, no op");
  const f = J.fineStateOp(s, ["ledger", "H1"], { entries: [{ id: "e1" }, { id: "e2", cost: "full" }], facts: { attacked: 1 } });
  eq(f.op.patch.map(([p]) => p.join("/")).sort(), ["ledger/H1/entries/#e2", "ledger/H1/facts"], "a fine op writes only what differs (one new entry, one new key)");
  // two transactions touching different records of one list: undoing the first leaves the second
  const a = J.fineStateOp(s, ["tokens"], [...s.tokens, { id: "t2", dice: 2 }]);
  const b = J.fineStateOp(a.state, ["tokens"], [...a.state.tokens, { id: "t3", dice: 3 }]);
  eq(J.applyStateOp(b.state, a.op, true).tokens.map((t) => t.id), ["t1", "t3"], "undoing the earlier op keeps the later record");
  eq(J.diffWrites([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "a" }], ["l"]).length, 1, "a changed order is written whole");
  eq(J.diffWrites([1, 2], [1, 2, 3], ["l"]), [[["l"], [1, 2, 3]]], "lists without ids are written whole");
}
/* ---- property: random state edits always invert exactly */
{
  const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((q) => [q, x[q]])) : x));
  const rnd = seeded(11), pick = (a) => a[Math.floor(rnd() * a.length)];
  const gen = (d) => { const r = rnd(); if (d > 3 || r < 0.25) return pick([0, 1, "s", true, 7]);   // null is "absent" in the state, never a stored value if (r < 0.5) return Array.from({ length: Math.floor(rnd() * 4) }, (_, i) => ({ id: `i${i}${pick(["", "x"])}`, v: gen(d + 1) })).filter((e, i, l) => l.findIndex((x) => x.id === e.id) === i);
    return Object.fromEntries(Array.from({ length: Math.floor(rnd() * 4) }, (_, i) => [`k${i}`, gen(d + 1)])); };
  let bad = 0, fwd = 0;
  for (let i = 0; i < 500; i++) {
    const before = { root: gen(0) }, target = gen(0);
    const r = J.fineStateOp(before, ["root"], target);
    if (!r.op) continue;
    if (!J.same(J.getAt(r.state, ["root"]), target ?? null) && !(target === null && r.state.root === undefined)) fwd++;
    if (canon(J.applyStateOp(r.state, r.op, true)) !== canon(before)) bad++;       // list order included; key order of objects is not state
  }
  eq([fwd, bad], [0, 0], "500 random edits: forward gives the target, inverse gives the original (record order kept)");
}
/* ---- inverse effects of document ops */
eq(J.inverseEffect({ t: "actor", uuid: "A", path: "health", from: 5, to: 2 }), { t: "actor", uuid: "A", path: "health", to: 5, expect: 2 }, "actor: write the old value, expecting the new");
eq(J.inverseEffect({ t: "item+", actorUuid: "A", itemId: "I", data: {} }).t, "itemDelete", "a created item is deleted");
eq(J.inverseEffect({ t: "item-", actorUuid: "A", data: { _id: "I" } }), { t: "itemCreate", actorUuid: "A", data: { _id: "I" }, keepId: true }, "a deleted item is recreated with its id");
eq(J.inverseEffect({ t: "tokenMove", sceneId: "S", tokenId: "T", from: { x: 1 }, to: { x: 2 } }).to, { x: 1 }, "token move back");
eq(J.inverseEffect({ t: "zones", op: { op: "zone", zone: "z", patch: { wrecked: true } }, inverse: { op: "zone", zone: "z", patch: { wrecked: null } } }), { t: "zones", op: { op: "zone", zone: "z", patch: { wrecked: null } }, isInverse: true }, "zones: the inverse op the zones API returned is given back to it");
eq(J.inverseEffect({ t: "zones", op: { op: "zone", zone: "z", patch: { wrecked: true } } }), null, "zones: a write that returned no inverse cannot be undone by the journal");
ok(J.same({ a: 1, b: { c: 2, d: [1, { e: 1, f: 2 }] } }, { b: { d: [1, { f: 2, e: 1 }], c: 2 }, a: 1 }) && !J.same({ a: [1, 2] }, { a: [2, 1] }), "equal as data: key order does not matter (the stored state is rebuilt key by key), list order does");
eq(J.inverseEffect({ t: "zones", call: "setZone" }), null, "a zone op without an inverse cannot be undone (and is reported)");
eq(J.inverseEffect({ t: "message", id: "M" }), { t: "messageStrike", id: "M" }, "messages are struck through, never deleted");
for (const t of J.OP_TYPES) ok(t === "state" || J.inverseEffect({ t, inverse: {}, data: {} }) != null, `op type ${t} has an inverse`);
/* ---- the log */
{
  let log = J.emptyLog();
  for (let i = 0; i < 400; i++) log = J.pushLog(log, J.closeTx(J.addOp(J.newTx({ id: `t${i}`, at: i }), { t: "message", id: `m${i}` })));
  eq([log.list.length, log.list.filter((t) => t.ops).length, log.list.at(-1).id, log.list[0].id], [300, 150, "t399", "t100"], "the last 150 keep their ops, 150 older keep the label only, the rest is gone");
  eq(J.undoOrder(log, "t100"), null, "a label-only transaction cannot be undone");
  eq(J.undoOrder(log, "t397"), ["t399", "t398", "t397"], "LIFO: later ones first");
  log = J.markUndone(log, "t398", 9);
  eq(J.undoOrder(log, "t397"), ["t399", "t397"], "already undone ones are skipped");
  eq(J.undoOrder(log, "t398"), null, "an undone transaction is not undone twice");
  eq(J.undoOrder(log, "nope"), null, "unknown transaction");
  eq(J.parseLog(J.serializeLog(log)).list.length, 300, "round trip");
  eq([J.parseLog("{{{").list, J.parseLog({ v: 99, list: [1] }).list, J.parseLog(JSON.stringify({ v: 1, list: [{ id: "a", state: "open", ops: [] }, { id: 1 }, null] })).list], [[], [], []], "garbage, a foreign version and open/broken rows are dropped");
  const again = J.pushLog(J.pushLog(J.emptyLog(), { id: "a", state: "closed", ops: [] }), { id: "a", state: "closed", ops: [{ t: "message", id: "m" }] });
  eq(again.list.length, 1, "pushing the same transaction id replaces it");
}
/* ---- drift */
{
  const op = { t: "actor", uuid: "A", path: "health", from: 5, to: 3 };
  eq([J.driftOf(op, 3), J.driftOf(op, 1)?.current], [null, 1], "no drift when the world still holds what the op wrote");
  eq([J.resolveDrift(op, 1, "restore"), J.resolveDrift(op, 1, "difference"), J.resolveDrift(op, 1, "leave")], [5, 3, undefined], "restore / apply the difference / leave");
  eq(J.resolveDrift({ ...op, from: "a", to: "b" }, "c", "difference"), "a", "difference on non-numbers falls back to restore");
  const s = { x: { y: 2 } }, so = { t: "state", patch: [[["x", "y"], 1]], inverse: [[["x", "y"], 0]] };
  eq([J.driftOf(so, s)?.current, J.driftOf(so, { x: { y: 1 } })], [2, null], "state op drift");
}
done("check-journal");
