/* node scripts/tactics/check-initiative.mjs -- card initiative (spec section 3) : the resumable draw, the turn pointer, holding off,
   GM edits, joining and leaving. Seeded fuzz; no Foundry. */
import * as I from "./initiative-pure.mjs";
import * as S from "./state-pure.mjs";
import { dice, initiative } from "../rules/index.mjs";
import { ok, eq, done } from "./testkit.mjs";

const mk = () => { let n = 0; return (p) => `${p}${++n}`; };
const part = (id, o = {}) => ({ id, hero: false, owners: [], defeated: false, challenge: false, summonOf: null, veteran: false, reflexes: false, resolve: 3, ...o });
const cards = (init) => init.slots.filter((s) => !s.extra).map((s) => s.card);
const sorted = (a) => a.every((v, i) => i === 0 || a[i - 1] < v);

/* run a whole draw, answering every question with `pick`; -> { init, asked } */
function fullDraw(init0, round, parts, opts, rng, pick) {
  const asked = [];
  let r = I.startDraw(init0, round, parts, opts), init = r.init;
  for (const q of r.ask) { const keep = pick(q); asked.push({ ...q, keep }); const a = I.answerVeteran(init, q.slot, keep); ok(a.ok, "veteran answer accepted"); init = a.init; }
  if (r.done) return { init, asked, kept: true };
  for (let g = 0; g < 500; g++) {
    const c = I.continueDraw(init, parts, rng); init = c.init;
    if (c.done) return { init, asked };
    ok(c.ask.length === 1 && c.ask[0].kind === "reflexes", "the draw stops only for one Fast Reflexes holder at a time");
    const q = c.ask[0], card = pick(q);
    asked.push({ ...q, took: card });
    const a = I.answerReflexes(init, q.slot, card, rng); ok(a.ok, "reflexes answer accepted"); init = a.init;
  }
  ok(false, "the draw ends");
  return { init, asked };
}

/* ---------------------------------------------------------------- fuzz: [I1]-[I7] over many fights */
for (let seed = 1; seed <= 400; seed++) {
  const rng = dice.seededRng(seed), mkId = mk();
  const n = 1 + Math.floor(rng() * 14);
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(part(`c${i}`, { hero: rng() < 0.4, veteran: rng() < 0.3, reflexes: rng() < 0.3, resolve: rng() < 0.15 ? 0 : 3, challenge: rng() < 0.08, defeated: rng() < 0.05, summonOf: rng() < 0.05 ? "c0" : null }));
  const el = parts.filter(I.eligible);
  const npcs = el.filter((p) => !p.hero).map((p) => p.id);
  const groups = npcs.length >= 3 && rng() < 0.5 ? [npcs.slice(0, 2 + Math.floor(rng() * Math.min(3, npcs.length - 2)))] : [];
  const surprised = el.filter(() => rng() < 0.25).map((p) => p.id);
  const pick = (q) => (q.kind === "veteran" ? rng() < 0.6 : q.cards[rng() < 0.5 ? 0 : 1]);
  let { init } = fullDraw(S.newInit(), 1, parts, { redraw: "everyRound", surprised, groups, mkId }, rng, pick);
  const slotsN = el.length - (groups[0]?.length ? groups[0].length - 1 : 0);
  eq(init.slots.length, slotsN, `seed ${seed}: one slot per draw [I4]`);
  eq(init.slots.flatMap((s) => s.members).sort(), el.map((p) => p.id).sort(), `seed ${seed}: exactly the eligible combatants have a card [I12] [I14]`);
  eq(init.deck, initiative.deckSize(slotsN), `seed ${seed}: deck size [I3]`);
  const c1 = cards(init);
  ok(sorted(c1) && c1.every((c) => Number.isInteger(c) && c >= 1 && c <= init.deck), `seed ${seed}: unique cards of the deck in ascending order [I1]`);
  const surSlots = init.slots.filter((s) => s.members.every((m) => surprised.includes(m)));
  if (surSlots.length) {
    const high = Array.from({ length: surSlots.length }, (_, i) => init.deck - i).sort((a, b) => a - b);
    eq(surSlots.map((s) => s.card).sort((a, b) => a - b), high, `seed ${seed}: the surprised hold the highest cards [I5]`);
    eq((init.surprised ?? []).slice().sort(), surSlots.flatMap((s) => s.members).sort(), `seed ${seed}: the surprised are remembered for round 1`);
  }
  ok(!init.draw && !init.pendingDraw, `seed ${seed}: nothing of the draw is left`);
  // round 2: Combat Veteran [I7], Fast Reflexes [I6]
  const before = Object.fromEntries(init.slots.flatMap((s) => s.members.map((m) => [m, s.card])));
  const r2 = fullDraw(init, 2, parts, { redraw: "everyRound", mkId }, rng, pick);
  const c2 = cards(r2.init);
  ok(sorted(c2) && c2.every((c) => c >= 1 && c <= r2.init.deck) && r2.init.slots.length === slotsN, `seed ${seed}: round 2 is a full new draw [I1]`);
  ok(!r2.init.surprised, `seed ${seed}: surprise is a matter of round 1 only [I5]`);
  for (const q of r2.asked) {
    const s = I.slotOf(r2.init, q.member), p = parts.find((x) => x.id === q.member);
    if (q.kind === "veteran") {
      ok(p.veteran && p.resolve > 0 && s.members.length === 1 && q.card === before[q.member], `seed ${seed}: only a Combat Veteran with Resolve is asked, about last round's card [I7]`);
      if (q.keep) eq(s.card, q.card, `seed ${seed}: the kept card stays [I7]`);
    } else {
      ok(p.reflexes && q.cards.length === 2 && q.cards[0] !== q.cards[1], `seed ${seed}: Fast Reflexes sees two different cards [I6]`);
      eq(s.card, q.took, `seed ${seed}: the chosen card is the holder's [I6]`);
    }
  }
  for (const p of el) if (p.veteran && p.resolve === 0) ok(!r2.asked.some((q) => q.kind === "veteran" && q.member === p.id), `seed ${seed}: no keeping a card at Resolve 0 [B2816]`);
  // firstRoundOnly [I2]
  const r3 = I.startDraw(r2.init, 3, parts, { redraw: "firstRoundOnly", mkId });
  ok(r3.done && !r3.ask.length && JSON.stringify(cards(r3.init)) === JSON.stringify(c2), `seed ${seed}: the cards stay when the table redraws only once [I2]`);
  ok(r3.init.slots.every((s) => s.state === "waiting" && !s.done.length) && r3.init.cur === null, `seed ${seed}: the round begins again`);

  /* the turn pointer: everybody acts exactly once, in card order, group members in the GM's order */
  let t = r2.init;
  const acted = [];
  for (let g = 0; g < 200; g++) {
    const nx = I.nextUp(t);
    if (!nx) break;
    t = I.openMember(t, nx.slot, nx.member);
    ok(t.cur === nx.slot && t.curMember === nx.member && I.slotById(t, nx.slot).state === "active", `seed ${seed}: the slot is in progress`);
    acted.push(nx.member);
    t = I.memberDone(t, nx.member);
  }
  eq(acted, r2.init.slots.flatMap((s) => s.members), `seed ${seed}: card order, then the member order inside a group [I1] [I4]`);
  ok(t.slots.every((s) => s.state === "done") && t.cur === null && JSON.stringify(t.trail) === JSON.stringify(acted), `seed ${seed}: the round is over`);
  // step back through the whole round
  let b = t;
  for (let i = acted.length - 1; i >= 0; i--) { const r = I.stepBack(b); ok(r.ok && r.member === acted[i] && r.init.curMember === acted[i], `seed ${seed}: step back to ${acted[i]}`); b = r.init; if (i > 0) { /* its turn is open again; going further back leaves it waiting */ } }
  ok(I.stepBack(b).ok === false, `seed ${seed}: nothing before the first turn`);
}

/* ---------------------------------------------------------------- Fast Reflexes: the other card goes back before the next draw [I6] */
{
  const rng = dice.seededRng(7), mkId = mk();
  const parts = [part("a", { hero: true, reflexes: true }), part("b", { hero: true }), part("n")];
  const r = I.startDraw(S.newInit(), 1, parts, { mkId });
  const c = I.continueDraw(r.init, parts, rng);
  ok(!c.done && c.ask[0].member === "a", "heroes draw first, the holder is asked [OQ-13]");
  eq(c.init.draw.left.length, 8, "two cards are out of the deck while the holder looks");
  ok(c.init.slots.every((s) => s.card === null), "nobody else has drawn yet");
  eq(I.continueDraw(c.init, parts, rng).done, false, "the draw waits for the answer");
  eq(I.answerReflexes(c.init, c.ask[0].slot, 99, rng).reason, "badInput", "a card that was not drawn is refused");
  eq(I.answerReflexes(c.init, "zz", c.ask[0].cards[0], rng).reason, "gone", "a wrong slot is refused");
  const a = I.answerReflexes(c.init, c.ask[0].slot, c.ask[0].cards[0], rng);
  ok(a.init.draw.left.length === 9 && a.init.draw.left.includes(c.ask[0].cards[1]), "the other card is back in the deck");
  eq(I.answerReflexes(a.init, c.ask[0].slot, c.ask[0].cards[0], rng).reason, "gone", "answering twice is refused");
  const f = I.continueDraw(a.init, parts, rng);
  ok(f.done && f.dealt.length === 2, "the others draw afterwards");
  /* two holders: one at a time */
  const p2 = [part("a", { hero: true, reflexes: true }), part("b", { hero: true, reflexes: true })];
  let x = I.continueDraw(I.startDraw(S.newInit(), 1, p2, { mkId }).init, p2, rng);
  const first = x.ask[0];
  x = I.continueDraw(I.answerReflexes(x.init, first.slot, first.cards[1], rng).init, p2, rng);
  ok(!x.done && x.ask[0].member !== first.member && !x.ask[0].cards.includes(first.cards[1]), "the second holder draws after the first has put a card back");
  /* a group has one card and no holder of its own */
  const p3 = [part("n1", { reflexes: true }), part("n2")];
  const g = I.continueDraw(I.startDraw(S.newInit(), 1, p3, { mkId, groups: [["n1", "n2"]] }).init, p3, rng);
  ok(g.done && g.init.slots.length === 1 && g.init.slots[0].members.length === 2, "a group draws one card [I4]");
}

/* ---------------------------------------------------------------- Combat Veteran details [I7] */
{
  const rng = dice.seededRng(3), mkId = mk();
  const parts = [part("v", { hero: true, veteran: true }), part("w", { hero: true, veteran: true }), part("n")];
  const r1 = fullDraw(S.newInit(), 1, parts, { mkId }, rng, () => true);
  ok(!r1.asked.length, "nobody is asked in round 1 (there is no last card)");
  const s2 = I.startDraw(r1.init, 2, parts, { mkId });
  eq(s2.ask.map((q) => q.member).sort(), ["v", "w"], "both veterans are asked");
  ok(I.continueDraw(s2.init, parts, rng).done === false, "the draw waits for every veteran");
  eq(I.answerVeteran(s2.init, "zz", true).reason, "gone", "unknown slot");
  let i2 = I.answerVeteran(s2.init, s2.ask[0].slot, true).init;
  eq(I.answerVeteran(i2, s2.ask[0].slot, true).reason, "gone", "answering twice is refused");
  i2 = I.answerVeteran(i2, s2.ask[1].slot, false).init;
  const f = I.continueDraw(i2, parts, rng);
  ok(f.done && I.slotById(f.init, s2.ask[0].slot).card === s2.ask[0].card && f.dealt[0].reason === "veteran", "the kept card leaves the deck first");
  ok(new Set(cards(f.init)).size === 3, "no card is dealt twice");
}

/* ---------------------------------------------------------------- holding off [I8] [I9] */
{
  const mkId = mk();
  let init = S.newInit();
  for (const [id, card] of [["a", 1], ["b", 2], ["c", 3], ["d", 4]]) init.slots.push({ id: `s${id}`, card, members: [id], state: "waiting", done: [] });
  init = I.memberDone(I.openMember(init, "sa", "a"), "a");
  init = I.openMember(init, "sb", "b");
  eq(I.holdOffTargets(init, "sb"), ["sc", "sd"], "only those who have not acted yet [I8]");
  eq(I.holdOffTargets(init, "sc"), [], "only the one whose turn it is");
  eq(I.holdOff(init, "sb", "sa").reason, "illegal", "not with one who has acted");
  const h = I.holdOff(init, "sb", "sd");
  ok(h.ok && h.cards.sb === 4 && h.cards.sd === 2, "the cards are swapped [I8]");
  eq(h.init.slots.map((s) => s.id), ["sa", "sd", "sc", "sb"], "the order follows the cards");
  ok(h.init.cur === null && I.nextUp(h.init).slot === "sd", "the partner acts now [I9]");
  ok(I.slotById(h.init, "sb").heldOff === 1 && I.slotById(h.init, "sb").state === "waiting", "the one who held off waits for the new card");
  let i2 = I.openMember(h.init, "sd", "d");
  ok(!I.holdOffTargets(i2, "sd").includes("sb"), "the one who held off cannot be chosen as partner [B2281]");
  i2 = I.memberDone(i2, "d"); i2 = I.memberDone(I.openMember(i2, "sc", "c"), "c"); i2 = I.openMember(i2, "sb", "b");
  eq(I.holdOffTargets(i2, "sb"), [], "nobody is left to hold off for");
  /* a group that is halfway through its turn is not offered the swap */
  let g = S.newInit();
  g.slots.push({ id: "g", card: 1, members: ["x", "y"], state: "waiting", done: [] }, { id: "z", card: 2, members: ["z"], state: "waiting", done: [] });
  g = I.openMember(g, "g", "x");
  eq(I.holdOffTargets(g, "g"), ["z"], "a group may hold off before its first member acts");
  g = I.openMember(I.memberDone(g, "x"), "g", "y");
  eq(I.holdOffTargets(g, "g"), [], "not once a member has acted");
  void mkId;
}

/* ---------------------------------------------------------------- GM edits, joining, leaving, extra turns */
{
  const mkId = mk();
  let init = S.newInit();
  for (const [id, card] of [["a", 1], ["b", 2], ["c", 3]]) init.slots.push({ id: `s${id}`, card, members: [id], state: "waiting", done: [] });
  eq(I.setCard(init, "sa", 2).reason, "cardTaken", "a card in use is refused without swap");
  eq(I.setCard(init, "sa", 2, { swap: true }).init.slots.map((s) => s.id), ["sb", "sa", "sc"], "setCard with swap");
  eq(I.setCard(init, "sa", 14).init.deck, 14, "a card beyond the deck grows the deck");
  eq(I.setCard(init, "sa", 0).reason, "badInput", "card 0 is no card");
  eq(I.swapCards(init, "sa", "sc").init.slots.map((s) => s.id), ["sc", "sb", "sa"], "swapCards");
  const gr = I.group(init, ["b", "c"]);
  ok(gr.ok && gr.init.slots.length === 2 && I.slotOf(gr.init, "c").id === "sb" && I.slotOf(gr.init, "c").card === 2, "group: several on one card [I4]");
  eq(I.reorderGroup(gr.init, "sb", ["c", "b"]).init.slots[1].members, ["c", "b"], "the GM chooses the order inside the group");
  eq(I.reorderGroup(gr.init, "sb", ["c"]).reason, "badInput", "the order must name every member");
  const un = I.ungroup(gr.init, "c", mkId);
  ok(un.ok && I.slotOf(un.init, "c").card === 3 && un.init.slots.length === 3, "ungroup: the next free card [A-1]");
  eq(I.group(init, ["a"]).reason, "badInput", "a group needs two");
  /* joining [A-1] */
  let run = I.openMember(init, "sa", "a");
  const j = I.addCombatant(run, "n", mkId);
  const walk = []; let wi = j.init;
  for (let g = 0; g < 20; g++) { const nx = I.nextUp(wi); if (!nx) break; wi = I.memberDone(I.openMember(wi, nx.slot, nx.member), nx.member); walk.push(nx.member); }
  ok(j.changed && j.card === 4 && walk[walk.length - 1] === "n" && walk.length === 4, "a late joiner acts last in the round [A-1]");
  ok(I.addCombatant(j.init, "n", mkId).changed === false, "joining twice changes nothing");
  eq(I.docSync(j.init), { a: { initiative: 1, pos: 0 }, b: { initiative: 2, pos: 0 }, c: { initiative: 3, pos: 0 }, n: { initiative: 4, pos: 0 } }, "docSync");
  /* leaving */
  const lv = I.removeCombatant(run, "a");
  ok(lv.wasCurrent && lv.init.cur === null && lv.init.curMember === null && lv.slotsGone[0] === "sa" && I.nextUp(lv.init).member === "b", "the current combatant leaves: the turn passes on");
  const lv2 = I.removeCombatant(run, "c");
  ok(!lv2.wasCurrent && lv2.init.curMember === "a" && lv2.init.slots.length === 2, "another one leaves: the turn stays");
  const gl = I.removeCombatant(I.openMember(gr.init, "sb", "b"), "b");
  ok(gl.wasCurrent && gl.init.cur === "sb" && I.nextUp(gl.init).member === "c", "a group member leaves: the group goes on");
  /* during a draw */
  const parts = [part("a", { reflexes: true, hero: true }), part("b")];
  const rng = dice.seededRng(1);
  const w = I.continueDraw(I.startDraw(S.newInit(), 1, parts, { mkId }).init, parts, rng);
  const out = I.removeCombatant(w.init, "a");
  ok(out.init.draw.wait === null && out.init.draw.left.length === 10, "a holder who leaves gives both cards back");
  const fin = I.continueDraw(I.addCombatant(out.init, "q", mkId).init, [part("b"), part("q")], rng);
  ok(fin.done && fin.init.slots.length === 2 && fin.init.slots.every((s) => s.card !== null), "a combatant who joins during the draw gets a card with the others");
  /* extra turn (spec 3.2) */
  let e = I.memberDone(I.openMember(init, "sa", "a"), "a");
  e = I.openMember(e, "sb", "b");
  const x = I.insertTurn(e, { combatant: "a", kind: "mindControl", by: "b" }, mkId);
  eq(x.init.slots.map((s) => s.id), ["sa", "sb", x.slot, "sc"], "an extra turn sits right after the current point");
  ok(I.slotById(x.init, x.slot).extra.kind === "mindControl" && I.slotById(x.init, x.slot).card === null, "it has no card");
  ok(I.nextUp(I.memberDone(x.init, "b")).slot === x.slot, "it comes next");
  ok(I.slotOf(x.init, "a").id === "sa" && !("x" in I.docSync(x.init)), "the combatant's own slot stays its slot");
  ok(I.startDraw(x.init, 2, [part("a"), part("b"), part("c")], { mkId }).init.slots.length === 3, "an extra turn does not outlive its round");
  ok(I.closeRound(e).slots.every((s) => s.state === "done"), "closeRound");
  ok(I.sortSlots([{ id: "n", card: null, members: ["n"] }, { id: "a", card: 5, members: ["a"] }])[0].id === "a", "a slot without a card sorts last");
}

done("check-initiative");
