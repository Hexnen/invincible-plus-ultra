/* Checks of ev-pure.mjs (phase B7): node scripts/base/check-ev.mjs */
import * as E from "./ev-pure.mjs";
import * as P from "./pure.mjs";
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log("FAIL", m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

const B = () => ({
  base: { occupied: false },
  upgrades: {
    a: { name: "Laboratory", status: "active", count: 1 }, b: { name: "Concealment", status: "active", count: 2 },
    c: { name: "Workshop", status: "broken", count: 1 }, d: { name: "Power Effect", power: "Flight", status: "installing", count: 1 }, e: { name: "Comm System", status: "disabled", count: 1 }
  }
});

// states
eq(E.evState(null), "none", "null"); eq(E.evState({}), "none", "no effect"); eq(E.evState({ effect: { kind: "none" } }), "none", "none kind");
eq(E.evState({ effect: { kind: "break", applied: false } }), "pending", "pending"); eq(E.evState({ effect: { kind: "break", applied: true } }), "applied", "applied");
eq(E.evState({ effect: { kind: "break", dismissed: true } }), "dismissed", "dismissed"); eq(E.evState({ rerolled: true, effect: { kind: "break" } }), "rerolled", "rerolled wins");
eq(E.evState({ effect: { kind: "break", applied: true, dismissed: true } }), "applied", "applied before dismissed");
eq(E.pendingList([{ effect: { kind: "note" } }, { effect: { kind: "none" } }, { effect: { kind: "raid", applied: true } }]).length, 1, "pendingList");

// band low
eq(E.bandLow("46-52"), 46, "bandLow"); eq(E.bandLow("66-66"), 66, "bandLow 66"); eq(E.bandLow(""), null, "bandLow empty"); eq(E.bandLow(undefined), null, "bandLow undef");

// plan: disable only active ones
let p = E.plan({ kind: "disable", upgrades: ["a", "b", "c", "e", "zzz"] }, B());
eq(p.changes.map((x) => x.uid), ["a", "b"], "disable changes only active");
eq(p.skipped.map((x) => x.why), ["notActive", "notActive", "gone"], "disable skipped reasons");
ok(E.changesAnything(p), "disable changes something");
let pt = E.patchOf(p);
eq(pt.rel, { "upgrades.a.status": "disabled", "upgrades.b.status": "disabled" }, "disable patch");
eq(pt.prev, { statuses: { a: "active", b: "active" }, after: { a: "disabled", b: "disabled" } }, "disable prev");

// break: not on broken; installing and disabled can break
p = E.plan({ kind: "break", upgrades: ["c", "d", "e"] }, B());
eq(p.changes.map((x) => x.uid), ["d", "e"], "break changes"); eq(p.skipped.map((x) => x.why), ["alreadyBroken"], "break skip broken");
ok(p.changes[0].name === "Power Effect (Flight)", "power in name");
// nothing left
p = E.plan({ kind: "break", upgrades: ["c"] }, B()); ok(!E.changesAnything(p), "nothing left");
p = E.plan({ kind: "disable", upgrades: [] }, B()); ok(!E.changesAnything(p), "empty list");
// occupy
p = E.plan({ kind: "occupy" }, B());
ok(p.occupy && !p.alreadyOccupied, "occupy"); eq(p.lost, 6, "lost counts copies (1+2+1+1+1)");
eq(E.patchOf(p), { rel: { "base.occupied": true }, prev: { statuses: {}, after: {}, occupied: false } }, "occupy patch");
const occ = B(); occ.base.occupied = true; p = E.plan({ kind: "occupy" }, occ);
ok(!p.occupy && p.alreadyOccupied, "already occupied"); ok(!E.changesAnything(p), "already occupied changes nothing");
// narrative kinds change nothing
for (const kind of E.NARRATIVE) ok(!E.changesAnything(E.plan({ kind, upgrades: ["a"] }, B())), `${kind} changes nothing`);
ok(!E.changesAnything(E.plan(null, B())), "null effect");
ok(E.plan({ kind: "break", upgrades: ["a"] }, null).skipped.length === 1, "no B tolerated");

// consistency with pure.effectPatch for the happy path
const effPure = P.effectPatch({ kind: "break", upgrades: ["a", "d"] }, B());
eq(E.patchOf(E.plan({ kind: "break", upgrades: ["a", "d"] }, B())).rel, effPure, "same patch as pure.effectPatch when all are eligible");

// undo
const evs = [{ id: "e1", effect: { kind: "break", applied: true, appliedAt: 100, prev: { statuses: { a: "active" }, after: { a: "broken" } } } },
  { id: "e2", effect: { kind: "occupy", applied: true, appliedAt: 200, prev: { statuses: {}, after: {}, occupied: false } } }];
const Bu = B(); Bu.upgrades.a.status = "broken"; Bu.base.occupied = true;
ok(!E.undoable(evs[0], evs, Bu), "older applied event is not undoable while a newer one exists");
ok(E.undoable(evs[1], evs, Bu), "newest applied event is undoable");
const Bn = B(); Bn.base.occupied = false; ok(!E.undoable(evs[1], evs, Bn), "occupied flag changed since");
ok(E.undoable(evs[0], [evs[0]], Bu), "single applied event undoable");
const Bm = B(); Bm.upgrades.a.status = "active"; ok(!E.undoable(evs[0], [evs[0]], Bm), "status changed since");
const Bg = B(); delete Bg.upgrades.a; ok(E.undoable(evs[0], [evs[0]], Bg), "vanished upgrade does not block");
ok(!E.undoable({ id: "x", effect: { applied: true } }, [], Bu), "no record, no undo");
ok(!E.undoable({ id: "x", effect: { applied: false, prev: {} } }, [], Bu), "not applied");
eq(E.undoPatch(evs[0], Bu), { "upgrades.a.status": "active" }, "undoPatch status");
eq(E.undoPatch(evs[1], Bu), { "base.occupied": false }, "undoPatch occupied");
eq(E.undoPatch({ effect: {} }, Bu), {}, "undoPatch none");

// paging
const rows = Array.from({ length: 20 }, (_x, i) => i);
let pg = E.pageSlice(rows, 6); eq([pg.rows.length, pg.more, pg.next], [6, 14, 12], "page 1");
pg = E.pageSlice(rows, 18); eq([pg.rows.length, pg.more], [18, 2], "page 3"); pg = E.pageSlice(rows, 99); eq([pg.rows.length, pg.more], [20, 0], "all");
pg = E.pageSlice([], 6); eq([pg.rows.length, pg.more], [0, 0], "empty"); pg = E.pageSlice(rows, 0); eq(pg.rows.length, 6, "min size");

// weeks, D66
eq(E.nextWeek([]), 1, "week 1"); eq(E.nextWeek([{ mode: "week" }, { mode: "any" }, { mode: "week", rerolled: true }]), 2, "week counts weekly, not rerolled");
for (const v of ["11", "53", " 66 ", 66, "36"]) ok(E.parseD66(v) !== null, `D66 ${v}`);
for (const v of ["", "7", "10", "17", "67", "70", "ab", "5.5", "-11", null, undefined, "1e1", "0x35"]) ok(E.parseD66(v) === null, `not D66 ${v}`);
eq(E.sumCounts({ a: { count: 3 }, b: {} }), 4, "sumCounts");

// the proposal rules of pure.mjs still produce plans this module understands, for every band
for (const low of [11, 41, 44, 46, 53, 61, 64, 66]) {
  const band = Object.keys(P.BAND_CONFIG.bands).find((k) => parseInt(k, 10) === low);
  const up = Object.entries(B().upgrades).map(([id, u]) => ({ id, status: u.status }));
  const eff = P.proposeEffect(band, up, { rng: () => 0.3 });
  if (!eff) { ok(false, `band ${band} no proposal`); continue; }
  const pl = E.plan(eff, B());
  ok(typeof E.evState({ effect: eff }) === "string", `band ${band} state`);
  if (eff.kind === "disable") ok(pl.changes.every((c) => c.from === "active") && eff.upgrades.length === Math.min(eff.rolled, 2), `band ${band} disable picks only active ones (${eff.upgrades})`);
  if (eff.kind === "break") ok(eff.upgrades.length === 1 && pl.changes.length === 1, `band ${band} break one`);
  if (eff.kind === "occupy") ok(pl.occupy, `band ${band} occupy`);
}

console.log(bad ? `${bad} FAILED of ${n}` : `OK ${n} checks`);
process.exit(bad ? 1 : 0);
