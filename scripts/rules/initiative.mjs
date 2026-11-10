/* Rules library: initiative deck logic. Pure ES module, no Foundry globals.
   Randomness comes from `rng` (a function returning [0, 1)); nothing here keeps state between calls.
   "book N" = line N of dev/book-dump.txt; "ruling N" = row N of section 4 of dev/combat-plan.md.

   A "draw" is one initiative card to hand out: a hero, a single NPC or a whole NPC group (book 2275: one card for the group, the GM
   orders its members, a swap moves the whole group). A character with several turns per round has several draws (book 2272).
   ruling 1: Quickness is NOT such a power here: it grants an extra action for 1 stress and never an extra card. */

export const BASE_DECK = 10;

/* book 2268: cards 1..10. ruling 12: with more than ten draws the deck grows to one card per draw. */
export const deckSize = (draws) => Math.max(BASE_DECK, draws);
export const newDeck = (size = BASE_DECK) => Array.from({ length: size }, (_, i) => i + 1);

/* Fisher-Yates on a copy */
export function shuffle(rng, cards) {
  const d = cards.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = d[i]; d[i] = d[j]; d[j] = t;
  }
  return d;
}

/* book 2279: a defender who fails the INTUITION roll against a surprise attack (passive, never pushed) is surprised. */
export const isSurprised = (intuitionSixes) => !(intuitionSixes > 0);

/* Deal one round.
   draws: [{ id, hero?: boolean, surprised?: boolean, keep?: number, fastReflexes?: boolean }]
     surprised    first round only (book 2279): gets one of the highest cards, distributed at random BEFORE anybody else draws;
                  ruling 12: with a longer deck these are the highest cards of the longer deck.
     keep         Combat Veteran (book 2100): keeps this card of the previous round instead of drawing (the 1 stress is the caller's job).
     fastReflexes book 2112: draws two cards, keeps one, the other is shuffled back; one character at a time.
   opts.choose(draw, cards) -> the card kept by a Fast Reflexes draw (default: the lowest).
   Heroes draw before NPCs (book 2112); otherwise input order.
   Returns entries [{ id, card, surprised, kept, drawn }] sorted by card (book 2269: lowest acts first). */
export function dealRound(rng, draws, opts = {}) {
  const size = deckSize(draws.length);
  const choose = opts.choose ?? ((_, cards) => Math.min(...cards));
  let deck = newDeck(size);
  const entries = [];
  const take = (card) => {
    if (!deck.includes(card)) throw new Error(`dealRound: card ${card} is not in the deck`);
    deck = deck.filter((c) => c !== card);
  };

  for (const d of draws) {
    if (d.keep == null) continue;
    take(d.keep);
    entries.push({ id: d.id, card: d.keep, surprised: false, kept: true, drawn: [d.keep] });
  }
  const surprised = draws.filter((d) => d.keep == null && d.surprised);
  if (surprised.length) {
    const high = deck.slice().sort((a, b) => b - a).slice(0, surprised.length);
    const dealt = shuffle(rng, high);
    surprised.forEach((d, i) => { take(dealt[i]); entries.push({ id: d.id, card: dealt[i], surprised: true, kept: false, drawn: [dealt[i]] }); });
  }
  deck = shuffle(rng, deck);
  const rest = draws.filter((d) => d.keep == null && !d.surprised);
  const ordered = [...rest.filter((d) => d.hero), ...rest.filter((d) => !d.hero)];
  for (const d of ordered) {
    if (!deck.length) throw new Error("dealRound: the deck ran out of cards");
    if (d.fastReflexes && deck.length >= 2) {
      const drawn = [deck.pop(), deck.pop()];
      const card = choose(d, drawn.slice());
      if (!drawn.includes(card)) throw new Error(`dealRound: ${d.id} chose a card that was not drawn`);
      deck = shuffle(rng, [...deck, drawn.find((c) => c !== card)]);
      entries.push({ id: d.id, card, surprised: false, kept: false, drawn });
    } else {
      const card = deck.pop();
      entries.push({ id: d.id, card, surprised: false, kept: false, drawn: [card] });
    }
  }
  return sortOrder(entries);
}

/* book 2269: card 1 acts first */
export const sortOrder = (entries) => entries.slice().sort((a, b) => a.card - b.card);

/* Holding off (book 2281-2283). order: [{ id, card, acted?: boolean, heldOff?: boolean }]; `id` is the draw whose turn it is now.
   A swap partner must come later in the round, must not have had their turn and must not have held off earlier in the round; they
   cannot refuse; an NPC group swaps as a whole (book 2275: the group is one draw). Spent interrupt actions stay spent and a character
   with no actions left may still hold off (book 2283): neither is a condition here.
   Returns the ids of legal partners. */
export function holdOffTargets(order, id) {
  const me = order.find((e) => e.id === id);
  if (!me || me.acted) return [];
  return order.filter((e) => e.id !== id && e.card > me.card && !e.acted && !e.heldOff).map((e) => e.id);
}

/* swap the cards (and so the places) of the draw holding off and its partner; the initiator is marked as having held off.
   Effects that trigger "on your turn" travel with the card (book 2282): the caller keys them to the turn, not to the card number. */
export function holdOff(order, id, partnerId) {
  if (!holdOffTargets(order, id).includes(partnerId)) throw new Error(`holdOff: ${id} cannot swap with ${partnerId}`);
  const a = order.find((e) => e.id === id), b = order.find((e) => e.id === partnerId);
  return sortOrder(order.map((e) => (e === a ? { ...a, card: b.card, heldOff: true } : e === b ? { ...b, card: a.card } : e)));
}

/* book 2277: optional table rule: draw only in the first round and keep the cards afterwards (holding off still works). */
export const REDRAW_MODES = ["everyRound", "firstRoundOnly"];
