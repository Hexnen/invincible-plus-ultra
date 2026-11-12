// node scripts/sweep-checks/t28.mjs  (T059: effectEndWrites with several statusIds must not overwrite itself; T058 needs lang.mjs, not fixed here)
import * as M from "../tactics/mods-pure.mjs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const apply = (st, ws) => { const s = structuredClone(st); for (const w of ws) { if (w.path[0] === "statuses") { if (w.to == null) delete s.statuses[w.path[1]]; else s.statuses[w.path[1]] = w.to; } } return s; };
const mk = (ids, statuses) => ({ round: 1, effects: [{ id: "E1", holder: "H", statusIds: ids }], statuses: { H: statuses } });
const st = mk(["A", "B"], [{ id: "A" }, { id: "B" }, { id: "C" }]);
const out = apply(st, M.effectEndWrites(st, "E1"));
ck("only C remains", JSON.stringify(out.statuses.H.map((s) => s.id)) === '["C"]');
const st2 = mk(["A", "B"], [{ id: "A" }, { id: "B" }]);
ck("all removed -> key gone", apply(st2, M.effectEndWrites(st2, "E1")).statuses.H === undefined);
const st3 = mk(["A"], [{ id: "A" }, { id: "C" }]);
ck("single id", JSON.stringify(apply(st3, M.effectEndWrites(st3, "E1")).statuses.H.map((s) => s.id)) === '["C"]');
const st4 = mk([], [{ id: "A" }]);
ck("no statusIds -> no status write", !M.effectEndWrites(st4, "E1").some((w) => w.path[0] === "statuses"));
console.log(`sweep t28: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
