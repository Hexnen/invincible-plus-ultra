/* node scripts/tactics/check-source.mjs -- the read side used by the turn tray, the initiative bar, the party cards, the token halo and
   the Challenges time, on plain objects shaped like a Combat document. No Foundry. */
import * as Src from "./source.mjs";
import * as O from "./ops-pure.mjs";
import * as S from "./state-pure.mjs";
import * as Lg from "./ledger-pure.mjs";
import { dice } from "../rules/index.mjs";
import { ok, eq, done } from "./testkit.mjs";

const part = (id, o = {}) => ({ id, hero: false, owners: [], defeated: false, challenge: false, summonOf: null, veteran: false, reflexes: false, resolve: 3, ...o });
const parts = [part("ca", { hero: true, owners: ["u1"] }), part("cb"), part("cc", { challenge: true })];
const ctx = { user: "gm", staff: true, owns: () => true, parts, rng: dice.seededRng(4) };
const doc = (state) => ({ id: "combat1", flags: { [S.MOD_ID]: { tactics: { state: state ? S.serialize(state) : "" } } }, combatants: [{ id: "ca", tokenId: "ta" }, { id: "cb", tokenId: "tb" }, { id: "cc", tokenId: "tc" }] });

/* not ours */
for (const c of [null, undefined, {}, { flags: {} }, doc(null), { flags: { [S.MOD_ID]: { tactics: { state: "{broken" } } } }, { flags: { [S.MOD_ID]: { tactics: { state: 5 } } } }]) {
  ok(Src.tacticsState(c) === null && Src.sourceOf(c) === null && Src.waiting(c) === false && Src.groupsFor(["ta"], c) === null && Src.isTurnOf(["ta"], c) === false && Src.onTurn(c).length === 0, "a combat without the module's state is not ours");
}

let st = O.reduce(null, { type: "start", mode: "tactical" }, ctx).state;
let c = doc(st);
eq(Src.sourceOf(c), "tactics", "a combat with the module's state");
ok(Src.tacticsState(c) === Src.tacticsState(c), "the parsed state is cached by the raw flag");
const cur = st.init.curMember, other = cur === "ca" ? "cb" : "ca";
const tok = (id) => `t${id.slice(1)}`;
ok(!Src.waiting(c) && Src.isTurnOf([tok(cur)], c) && !Src.isTurnOf([tok(other)], c) && !Src.isTurnOf([], c), "whose turn it is");
eq(Src.onTurn(c), [cur], "onTurn");
let g = Src.groupsFor([tok(cur)], c);
eq(g.map((x) => [x.id, x.slot, x.slots, x.active, x.tactics]), [[cur, 1, 1, true, true]], "one group per combatant of the token");
eq(g[0].pips.map((p) => [p.id, p.k, p.lk, p.state]), [["tac:full", "slow", "full", "open"], ["tac:quick", "fast", "quick", "open"]], "U31: two slots, the big one (full) and the small one (quick)");
ok(Src.groupsFor(["tc"], c) === null && Src.groupsFor(["zz"], c) === null, "[I12] a challenge has no pips; a stranger neither");
eq(Src.groupsFor(["zz", tok(other)], c)[0].active, false, "the first token that is in the fight");
/* marks */
eq(Src.pipClick(g[0].pips, "tac:full"), { unit: "full", on: true }, "a click on an open pip marks it");
st = O.reduce(st, { type: "mark", actor: cur, unit: "full" }, ctx).state; c = doc(st);
g = Src.groupsFor([tok(cur)], c);
eq(g[0].pips.map((p) => [p.lk, p.state]), [["full", "used"], ["quick", "open"]], "[L1] the full action spends the big slot; the quick one stays");
eq([Src.pipClick(g[0].pips, "tac:full"), Src.pipClick(g[0].pips, "tac:quick2"), Src.pipClick(g[0].pips, "nope")], [{ unit: "full", on: false }, null, null], "a used pip is taken back, an unknown one does nothing");
st = O.reduce(st, { type: "ledgerEdit", combatant: cur, edit: "void", entry: st.ledger[cur].entries[0].id }, ctx).state;
st = O.reduce(O.reduce(st, { type: "mark", actor: cur, unit: "quick" }, ctx).state, { type: "mark", actor: cur, unit: "quick" }, ctx).state;
eq(Src.groupsFor([tok(cur)], doc(st))[0].pips.map((p) => [p.lk, p.unit, p.state]), [["quick", "quick", "used"], ["quick", "quick", "used"]], "[L3] two quick actions: the big slot reads as spent on a quick one");
eq(Src.pipClick(Src.groupsFor([tok(cur)], doc(st))[0].pips, "tac:full"), { unit: "quick", on: false }, "and its mark is taken back as a quick action");
{ const one = O.reduce(O.reduce(st, { type: "mark", actor: cur, unit: "quick", on: false }, ctx).state, { type: "mark", actor: cur, unit: "quick", on: false }, ctx).state, q = O.reduce(one, { type: "mark", actor: cur, unit: "quick" }, ctx).state;
  eq(Src.groupsFor([tok(cur)], doc(q))[0].pips.map((p) => [p.lk, p.state]), [["full", "open"], ["quick", "used"]], "one quick action: the small slot, the big one still whole"); }
eq([Lg.slots({ full: "lost", quick: ["open", "open"] })[0], Lg.slots({ full: "lost", quick: ["open", "lost"] })[0].state, Lg.slots(null).map((x) => x.state)], [{ id: "A", state: "open", as: null, unit: "quick", only: "quick" }, "lost", ["lost", "lost"]], "[L8] the big slot without its full action takes a quick one; nothing left: lost");
/* a lost turn shows on the group */
st = O.reduce(st, { type: "ledgerEdit", combatant: other, edit: "loseTurn" }, ctx).state;
ok(Src.groupsFor([tok(other)], doc(st))[0].lostTurn === true, "[L7] the lost turn is visible");
/* waiting: draw, queues, scene end, off */
const drawing = O.reduce(null, { type: "start" }, { ...ctx, parts: [part("ca", { reflexes: true }), part("cb")], rng: dice.seededRng(2) }).state;
ok(drawing.phase === "draw" && Src.waiting(doc(drawing)) && !Src.isTurnOf(["ta"], doc(drawing)) && Src.groupsFor(["ta"], doc(drawing))[0].active === false, "while the cards are dealt nobody has the turn");
const ended = O.reduce(st, { type: "endScene" }, ctx).state;
ok(Src.waiting(doc(ended)) && Src.groupsFor(["ta"], doc(ended)) === null, "after the scene: no turn, no pips");
const off = O.reduce(st, { type: "setMode", mode: "off" }, ctx).state;
ok(Src.groupsFor(["ta"], doc(off)) === null && Src.sourceOf(doc(off)) === "tactics", "mode off: no pips, the initiative is still the module's");
/* combatants given as a collection */
const coll = { ...doc(st), combatants: { contents: [{ id: cur, tokenId: "tx" }] } };
ok(Src.isTurnOf(["tx"], coll), "a Collection of combatants is read too");
eq(Src.pipsOf(st.ledger[other]).length, 2, "pipsOf");

done("check-source");
