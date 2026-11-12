// node scripts/sweep-checks/t29.mjs  (T060: events of a closed round carry that round, not the next one)
import * as O from "../tactics/ops-pure.mjs";
import { dice } from "../rules/index.mjs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const part = (id, o = {}) => ({ id, hero: false, owners: [], defeated: false, challenge: false, summonOf: null, veteran: false, reflexes: false, resolve: 3, ...o });
const parts = [part("h1", { hero: true, owners: ["u1"] }), part("n1")];
const rng = dice.seededRng(5);
let state = null, k = 0; const events = [];
const ctx = (user) => ({ user, staff: user === "gm", owns: (id) => (parts.find((p) => p.id === id)?.owners ?? []).includes(user), parts, rng });
const run = (user, type, a = {}) => { const r = O.reduce(state, { type, rid: `${user}:${++k}`, ...a }, ctx(user)); if (r.ok && r.changed) { state = r.state; events.push(...(r.events ?? [])); } return r; };
run("gm", "start", { mode: "tactical" });
for (let i = 0; i < 2; i++) {
  const c = state.init.curMember, u = parts.find((p) => p.id === c).owners[0] ?? "gm";
  run(u, "endTurn", { actor: c });
}
ck("round advanced", state.round === 2);
const re = events.filter((e) => e.type === "roundEnd");
ck("one roundEnd event", re.length === 1);
ck("roundEnd event is round 1", re[0]?.round === 1);
ck("turnEnd events of round 1 are round 1", events.filter((e) => e.type === "turnEnd").every((e) => e.round === 1));
ck("draw events of round 2 are round 2", events.filter((e) => e.type === "draw").slice(-1).every((e) => e.round === 2));
console.log(`sweep t29: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
