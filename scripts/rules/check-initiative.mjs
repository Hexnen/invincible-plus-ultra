// node scripts/rules/check-initiative.mjs -- initiative deck logic.
import * as I from "./initiative.mjs";
import { seededRng } from "./dice.mjs";
import { ok, eq, throws, done } from "./testkit.mjs";

eq(I.newDeck(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "ten cards (book 2268)");
eq([I.deckSize(4), I.deckSize(10), I.deckSize(13)], [10, 10, 13], "deck grows beyond ten draws (ruling 12)");
eq(I.shuffle(seededRng(3), I.newDeck()).slice().sort((a, b) => a - b), I.newDeck(), "shuffle keeps the cards");
eq([I.isSurprised(0), I.isSurprised(2)], [true, false], "surprise = failed INTUITION roll");

const ids = (n, p = "c") => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}` }));
for (let seed = 1; seed <= 200; seed++) {
  const r = seededRng(seed);
  const a = I.dealRound(r, ids(4));
  ok(new Set(a.map((e) => e.card)).size === 4 && a.every((e) => e.card >= 1 && e.card <= 10), `unique cards 1..10 (seed ${seed})`);
  ok(a.every((e, i) => i === 0 || a[i - 1].card < e.card), `sorted by card (seed ${seed})`);
  // surprise: three surprised get 8, 9, 10 (book 2279)
  const s = I.dealRound(r, [{ id: "a", surprised: true }, { id: "b", surprised: true }, { id: "c", surprised: true }, { id: "d" }, { id: "e" }]);
  eq(s.filter((e) => e.surprised).map((e) => e.card), [8, 9, 10], `surprised get the worst cards (seed ${seed})`);
  ok(s.filter((e) => !e.surprised).every((e) => e.card <= 7), `others draw from the rest (seed ${seed})`);
  // long deck (ruling 12)
  const big = I.dealRound(r, [...ids(11), { id: "s1", surprised: true }, { id: "s2", surprised: true }]);
  eq(big.filter((e) => e.surprised).map((e) => e.card), [12, 13], `surprised get the top of the longer deck (seed ${seed})`);
  ok(new Set(big.map((e) => e.card)).size === 13, `13 unique cards (seed ${seed})`);
  // Fast Reflexes (book 2112) and Combat Veteran (book 2100)
  const f = I.dealRound(r, [{ id: "npc", fastReflexes: true }, { id: "vet", keep: 4 }, { id: "hero", hero: true, fastReflexes: true }, { id: "x" }]);
  const hero = f.find((e) => e.id === "hero"), npc = f.find((e) => e.id === "npc");
  ok(hero.drawn.length === 2 && hero.card === Math.min(...hero.drawn), `Fast Reflexes keeps the better of two (seed ${seed})`);
  ok(npc.drawn.length === 2 && !npc.drawn.includes(hero.card), `the NPC draws after the hero (seed ${seed})`);
  eq(f.find((e) => e.id === "vet").card, 4, `Combat Veteran keeps the card (seed ${seed})`);
  ok(new Set(f.map((e) => e.card)).size === 4, `no duplicate cards with talents (seed ${seed})`);
}
{
  const r = seededRng(9);
  const f = I.dealRound(r, [{ id: "h", fastReflexes: true }], { choose: (_, cards) => Math.max(...cards) });
  eq(f[0].card, Math.max(...f[0].drawn), "the player may choose the worse card");
  throws(() => I.dealRound(r, [{ id: "h", fastReflexes: true }], { choose: () => 99 }), "choosing a card that was not drawn");
  throws(() => I.dealRound(r, [{ id: "a", keep: 3 }, { id: "b", keep: 3 }]), "two draws cannot keep the same card");
}
// the deal in steps: the holder sees both cards, then chooses (book 2112)
{
  const draws = [{ id: "npcFr", fastReflexes: true }, { id: "vet", keep: 4 }, { id: "h1", hero: true }, { id: "hFr", hero: true, fastReflexes: true }, { id: "s", surprised: true }, { id: "n2" }];
  for (let seed = 1; seed <= 60; seed++) {
    // the same rng gives the same cards in one call and in steps
    const whole = I.dealRound(seededRng(seed), draws, { choose: (_, c) => Math.max(...c) });
    const r = seededRng(seed);
    let s = I.dealStart(r, draws);
    const asked = [];
    while (!s.done) { asked.push(s.pending.id); ok(s.pending.cards.length === 2 && s.pending.cards.every((c) => !s.deck.includes(c)), `two cards out of the deck are shown (seed ${seed})`); s = I.dealContinue(r, s, Math.max(...s.pending.cards)); }
    eq(s.order, whole, `stepwise deal = one-call deal (seed ${seed})`);
    eq(asked, ["hFr", "npcFr"], `heroes are asked before NPCs (seed ${seed})`);
    ok(s.order.find((e) => e.id === "s").card === 10 && s.order.find((e) => e.id === "vet").card === 4, `surprise and Combat Veteran as in the one-call deal (seed ${seed})`);
  }
  const r = seededRng(4);
  const s0 = I.dealStart(r, draws);
  const frozen = JSON.stringify(s0);
  eq(JSON.parse(frozen).pending.id, "hFr", "a DealState is plain data and survives JSON");
  const s1 = I.dealContinue(r, JSON.parse(frozen), s0.pending.cards[1]);
  eq(JSON.stringify(s0), frozen, "dealContinue does not modify the state it is given");
  eq(s1.entries.find((e) => e.id === "hFr").card, s0.pending.cards[1], "the chosen card is kept");
  ok(s1.deck.includes(s0.pending.cards[0]) || s1.pending?.cards.includes(s0.pending.cards[0]) || s1.entries.some((e) => e.card === s0.pending.cards[0]), "the other card went back into the deck");
  throws(() => I.dealContinue(r, s0, 99), "a card that was not shown");
  const end = I.dealContinue(r, s1, s1.pending.cards[0]);
  eq([end.done, end.pending, end.queue.length], [true, null, 0], "done after the last choice");
  eq(I.dealContinue(r, end, 1), end, "continuing a finished deal changes nothing");
  throws(() => I.dealContinue(r, { ...s1, pending: null }, 1), "no choice awaited");
  eq(I.dealStart(seededRng(2), [{ id: "a" }, { id: "b" }]).done, true, "without Fast Reflexes the deal is done at once");
  // draw order option (book 2112 leaves it open: OQ-13)
  const order = (opts) => { const rr = seededRng(11); const seen = []; let st = I.dealStart(rr, draws, opts); while (!st.done) { seen.push(st.entries.filter((e) => !e.kept && !e.surprised).map((e) => e.id).join(",")); st = I.dealContinue(rr, st, st.pending.cards[0]); } return seen; };
  eq(order({}), ["h1", "h1,hFr"], "default: the hero before the holder draws first, holders when their draw comes");
  eq(order({ reflexesFirst: true }), ["", "hFr"], "reflexesFirst: holders draw before everybody else");
  const rf = I.dealRound(seededRng(11), draws, { reflexesFirst: true });
  ok(new Set(rf.map((e) => e.card)).size === draws.length, "reflexesFirst deals unique cards");
}
// the returned card of a Fast Reflexes draw is back in the deck: with ten draws everybody still gets a card
{
  const d = I.dealRound(seededRng(5), [{ id: "fr", hero: true, fastReflexes: true }, ...ids(9)]);
  eq(d.map((e) => e.card), I.newDeck(), "ten draws use all ten cards");
}

// holding off (book 2281-2283)
const order = [{ id: "a", card: 2 }, { id: "b", card: 3, acted: false }, { id: "c", card: 5 }, { id: "grp", card: 7 }];
eq(I.holdOffTargets(order, "a"), ["b", "c", "grp"], "everybody later is a partner");
eq(I.holdOffTargets(order, "c"), ["grp"], "only later turns");
eq(I.holdOffTargets(order.map((e) => (e.id === "c" ? { ...e, heldOff: true } : e)), "a"), ["b", "grp"], "not someone who held off earlier");
eq(I.holdOffTargets(order.map((e) => (e.id === "grp" ? { ...e, acted: true } : e)), "a"), ["b", "c"], "not someone who already acted");
eq(I.holdOffTargets(order.map((e) => (e.id === "a" ? { ...e, acted: true } : e)), "a"), [], "not after your own turn");
{
  const o = I.holdOff(order, "a", "grp");
  eq(o.map((e) => `${e.id}${e.card}`), ["grp2", "b3", "c5", "a7"], "cards and places are swapped");
  eq(o.find((e) => e.id === "a").heldOff, true, "initiator is marked");
  eq(order[0].card, 2, "input order is not modified");
  eq(I.holdOffTargets(o, "b"), ["c"], "the one who held off is no partner any more");
  const again = o.map((e) => (e.id === "grp" ? { ...e, acted: true } : e.id === "b" ? { ...e, card: 8 } : e));   // grp acted; a (card 7, held off) is up, b comes later
  eq(I.holdOffTargets(again, "a"), ["b"], "default: the one who held off may hold off again (book 2281 is silent, OQ-17)");
  eq(I.holdOffTargets(again, "a", { initiatorOnce: true }), [], "initiatorOnce: not twice in a round");
  throws(() => I.holdOff(again, "a", "b", { initiatorOnce: true }), "holdOff honours the option");
  eq(I.holdOff(again, "a", "b").find((e) => e.id === "a").card, 8, "and swaps without it");
  throws(() => I.holdOff(order, "c", "a"), "cannot swap with an earlier turn");
}

done("check-initiative");
