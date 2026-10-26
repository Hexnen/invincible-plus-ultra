/* Node check of the view model (ui/model.mjs): node scripts/session/ui/check-ui.mjs -> OK. The DOM code is verified live (dev/session-live-tests.js + screenshots). */
import * as P from "../pure.mjs";
import * as M from "./model.mjs";

let n = 0, bad = 0;
const eq = (a, b, m) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { bad++; console.log("FAIL", m, JSON.stringify(a), "!=", JSON.stringify(b)); } };
const heroes = [{ id: "h1", name: "Alpha", img: "" }, { id: "h2", name: "Beta", img: "" }, { id: "h3", name: "Gamma", img: "" }];
const gm = { id: "gm1", staff: true }, p1 = { id: "u1", staff: false };
const owner = { h1: "u1", h2: "u2" };
const mk = (askBad = false) => P.reduce(null, { type: "start", id: "s1", heroes, askBad }, { user: gm, now: 1 }).session;
const act = (s, a, user = gm) => { const r = P.reduce(s, a, { user, now: 2, owns: (h) => owner[h] === user.id }); if (!r.ok) throw new Error(JSON.stringify(r.error)); return r.session; };
const info = (id) => ({ id, name: heroes.find((h) => h.id === id).name, img: "", karma: 3, flaw: id === "h1" ? "Reckless" : "", owners: [], mine: owner[id] === "u1" });
const env = (s, me, extra = {}) => ({ s, me, status: { gmOnline: true, allowPlayers: true, ...extra }, info, questions: [] });

let s = mk();
let vm = M.build(env(s, p1));
eq(vm.view, "question", "view question"); eq(vm.total, 10, "10 questions"); eq(vm.dots.length, 10, "10 dots"); eq(vm.dots[0].state, "current", "dot 0 current");
eq(vm.heroes.map((h) => h.canToggle), [true, false, false], "player may tick only own hero");
eq(vm.heroes[1].reason, "notMine", "reason notMine");
eq(M.build(env(s, gm)).heroes.map((h) => h.canToggle), [true, true, true], "GM may tick all");
eq(vm.q.of, 10, "group size"); eq(vm.counts.answered, 0, "none answered"); eq(vm.counts.waiting.length, 3, "three waiting");
eq(M.build(env(s, p1, { gmOnline: false })).heroes[0].reason, "noGM", "GM absent pauses the player's own cell");
eq(M.build(env(s, p1, { allowPlayers: false })).heroes[0].reason, "playersOff", "players off");
// GM decides a cell: locked for the owner
s = act(s, { type: "setAnswer", hero: "h1", q: "q01", value: 0 });
vm = M.build(env(s, p1));
eq(vm.heroes[0].reason, "locked", "GM-decided cell is locked for the owner"); eq(vm.heroes[0].locked, true, "lock flag"); eq(vm.heroes[0].state, "no", "explicit no");
// optimistic value wins over the stored one
const pend = new Map([["h2|q01", { v: 1 }]]);
vm = M.build({ ...env(s, gm), pending: pend });
eq(vm.heroes[1].state, "yes", "pending shows"); eq(vm.heroes[1].busy, true, "pending flag"); eq(vm.counts.answered, 2, "pending counts as answered");
// flaw question
s = act(s, { type: "setQuestion", index: 4 });
vm = M.build(env(s, gm));
eq(vm.q.flaw, true, "flaw question"); eq(vm.heroes.every((h) => h.canOver), true, "GM may mark overcame");
eq(vm.heroes[0].flaw, "Reckless", "flaw text live");
// bad karma group numbering
s = act(s, { type: "setAskBad", value: true });
vm = M.build(env(s, gm));
eq(vm.total, 16, "16 with bad karma"); eq(vm.dots[10].group, "bad", "dot 11 is bad"); eq(vm.dots[10].n, 1, "bad numbering restarts"); eq(vm.dots[15].n, 6, "bad 6");
s = act(s, { type: "setQuestion", index: 12 });
vm = M.build(env(s, gm)); eq(vm.q.of, 6, "bad group size"); eq(vm.q.n, 3, "bad question number");
// summary
s = act(act(s, { type: "setQuestion", index: 16 }), { type: "close" });
vm = M.build({ ...env(s, p1), summary: { rows: P.summary(s).rows, plan: P.awardPlan(s, { h1: 3, h2: 3, h3: 3 }), missing: [] } });
eq(vm.view, "summary", "summary view"); eq(vm.sum.rows.length, 3, "three rows"); eq(vm.heroes.length, 0, "no roster in summary");
eq(M.reasonOf({ s, staff: true, mine: true, cell: null, gmOnline: true, allowPlayers: true, atQuestion: false }), "closed", "closed review reason");
eq(M.build(env(null, p1)).view, "none", "no session");
eq(M.stateOf(null), "none", "stateOf none"); eq(M.stateOf(0), "no", "stateOf no"); eq(M.stateOf(2), "yes", "stateOf 2");
if (bad) { console.log(`FAIL ${bad} of ${n}`); process.exit(1); }
console.log(`OK ${n} checks`);
