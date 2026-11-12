// node scripts/sweep-checks/fxr.mjs  (FXR: T030 / T034, the log of an actor deleted from a GM client that is not the scribe)
// The scribe (scripts/log/scribe.mjs) runs here with a few Foundry stubs: what it still held for the actor when the deleteJournalEntry hook
// told it of the deletion must not reach the fresh log (drafts not yet written, a batch already queued for the store).
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const gets = [];
globalThis.Hooks = { on() {}, callAll() {} };
globalThis.game = { actors: { get: (id) => { gets.push(id); return null; } }, users: { get: () => null }, settings: { get: () => undefined }, journal: { get: () => null, contents: [] } };
const Sc = await import("../log/scribe.mjs");
const S = Sc.state;
const now = Date.now();
const draft = (actorId, i) => ({ actorId, k: "stat.vital", path: "health", u: "", t: now - 60000 + i, d: { key: "health", from: 5 + i, to: 4 + i } });
const reset = () => { S.on = true; S.states.clear(); for (const a of ["A", "B"]) S.states.set(a, { actorId: a, scope: "hero", prev: {} }); };
/* 1: what is still open for the actor goes with its log */
reset();
for (const a of ["A", "B"]) {
  S.co.add(draft(a, 0)); S.co.passthrough.push({ ...draft(a, 1), n: 1 });
  S.ab.held.push({ draft: { ...draft(a, 2), k: "item.add" }, at: now }); S.ab.ready.push({ ...draft(a, 3), k: "item.add" });
  S.edits.add(`${a}|it1|u1`, { name: "x", type: "power" }, [{ p: "name", from: "x", to: "y" }], now);
  S.direct.push({ id: `e${a}`, actorId: a }); S.runHold.set(a, { adds: [], since: now }); S.dirty.add(a); S.recent.set(a, [{ id: "r" }]);
}
Sc.forget("A");
const has = (a) => ({ co: [...S.co.pending.values()].flat().some((d) => d.actorId === a) || S.co.passthrough.some((d) => d.actorId === a), held: S.ab.held.some((h) => h.draft.actorId === a), ready: S.ab.ready.some((d) => d.actorId === a),
  edits: [...S.edits.open.keys()].some((k) => k.startsWith(`${a}|`)), direct: S.direct.some((e) => e.actorId === a), run: S.runHold.has(a), dirty: S.dirty.has(a), recent: S.recent.has(a) });
const hA = has("A"), hB = has("B");
for (const k of Object.keys(hA)) ck(`T034: forget drops the deleted log's open ${k} of the actor`, hA[k] === false);
ck("T034: ... and keeps every other actor's", Object.values(hB).every(Boolean));
/* 2: a batch the scribe had already queued for the store when the deletion came is not written into the fresh log */
S.co.pending.clear(); S.co.passthrough = []; S.ab.held = []; S.ab.ready = []; S.ab.parents = []; S.edits.open.clear(); S.direct = []; S.runHold.clear(); S.dirty.clear(); S.recent.clear();
reset();
let release; const gate = new Promise((r) => { release = r; });
S.chain = gate;                                                   // the store is busy: tick's batches wait on the chain
S.co.add(draft("A", 10)); S.co.add({ ...draft("B", 11) });
const warn0 = console.warn; console.warn = () => {};
Sc.tick(true);
Sc.forget("A"); S.states.set("A", { actorId: "A", scope: "hero", prev: {} });     // the deleteJournalEntry hook: forget, then rebaseline makes a fresh state
release(); await S.chain.catch(() => {});
console.warn = warn0;
ck("T030: (the other actor's batch was written)", gets.includes("B"));
ck("T030: the batch queued before the deletion is not written into the fresh log", !gets.includes("A"));
/* 3: the fresh log's snapshot is written against what is stored (a part-snapshot written meanwhile loses its stale keys) */
import { readFileSync } from "node:fs";
const sc = readFileSync(new URL("../log/scribe.mjs", import.meta.url), "utf8");
ck("T034: baselineActor writes the fresh snapshot against the stored one", /if \(!had \|\| !snap\) \{[\s\S]*?Store\.writeSnapshot\(actor\.id, C\.snapOps\(snap \?\? \{\}, cur\)\)/.test(sc));
S.on = false;
console.log(`sweep fxr: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
