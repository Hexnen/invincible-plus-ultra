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
   opts.reflexesFirst: see dealStart.
   Heroes draw before NPCs (book 2112); otherwise input order.
   Returns entries [{ id, card, surprised, kept, drawn }] sorted by card (book 2269: lowest acts first).
   This is the deal in one call (dealStart + dealContinue with `choose` answering at once); the same `rng` gives the same cards either way. */
export function dealRound(rng, draws, opts = {}) {
  const choose = opts.choose ?? ((_, cards) => Math.min(...cards));
  let s = dealStart(rng, draws, opts);
  while (!s.done) s = dealContinue(rng, s, choose(s.pending.draw, s.pending.cards.slice()));
  return s.order;
}

/* The same deal in steps, for a table where the Fast Reflexes holder has to SEE the two cards before choosing (book 2112: draw two,
   choose one, shuffle the other back; several holders one at a time).
   dealStart(rng, draws, opts) deals until the first Fast Reflexes draw and returns a DealState; dealContinue(rng, state, card) takes
   the holder's choice and deals on. A DealState is plain data (it can be stored while the choice is awaited) and is never modified:
     { done, pending: null | { id, cards: [a, b], draw }, entries, deck, queue, order: null | entries sorted by card (when done) }
   pending.cards are the two cards drawn and still out of the deck; `card` must be one of them.
   opts.reflexesFirst (default false): book 2112 says only that holders are resolved one at a time and that heroes draw before NPCs.
     false: all heroes draw, then all NPCs, each holder resolved when its own draw comes (input order inside each side);
     true:  the Fast Reflexes holders draw first (heroes, then NPCs), then the other heroes, then the other NPCs.
   Which of the two the table uses is open (question OQ-13 of the handoff); the GM may change any card in any case. */
export function dealStart(rng, draws, opts = {}) {
  let deck = newDeck(deckSize(draws.length));
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
  const side = (list) => [...list.filter((d) => d.hero), ...list.filter((d) => !d.hero)];
  const queue = opts.reflexesFirst ? [...side(rest.filter((d) => d.fastReflexes)), ...side(rest.filter((d) => !d.fastReflexes))] : side(rest);
  return dealAdvance({ done: false, pending: null, entries, deck, queue, order: null });
}
export function dealContinue(rng, state, card) {
  if (state.done) return state;
  if (!state.pending) throw new Error("dealContinue: no choice is awaited");
  const { id, cards } = state.pending;
  if (!cards.includes(card)) throw new Error(`dealRound: ${id} chose a card that was not drawn`);
  const deck = shuffle(rng, [...state.deck, cards.find((c) => c !== card)]);
  const entries = [...state.entries, { id, card, surprised: false, kept: false, drawn: cards.slice() }];
  return dealAdvance({ done: false, pending: null, entries, deck, queue: state.queue.slice(1), order: null });
}
/* deal plain draws until a Fast Reflexes draw (or the end); works on the fresh state object it is given */
function dealAdvance(s) {
  const deck = s.deck.slice(), entries = s.entries.slice(), queue = s.queue.slice();
  while (queue.length) {
    const d = queue[0];
    if (!deck.length) throw new Error("dealRound: the deck ran out of cards");
    if (d.fastReflexes && deck.length >= 2) return { done: false, pending: { id: d.id, cards: [deck.pop(), deck.pop()], draw: d }, entries, deck, queue, order: null };
    const card = deck.pop();
    queue.shift();
    entries.push({ id: d.id, card, surprised: false, kept: false, drawn: [card] });
  }
  return { done: true, pending: null, entries, deck, queue, order: sortOrder(entries) };
}

/* book 2269: card 1 acts first */
export const sortOrder = (entries) => entries.slice().sort((a, b) => a.card - b.card);

/* Holding off (book 2281-2283). order: [{ id, card, acted?: boolean, heldOff?: boolean }]; `id` is the draw whose turn it is now.
   A swap partner must come later in the round, must not have had their turn and must not have held off earlier in the round; they
   cannot refuse; an NPC group swaps as a whole (book 2275: the group is one draw). Spent interrupt actions stay spent and a character
   with no actions left may still hold off (book 2283): neither is a condition here.
   opts.initiatorOnce (default false): the book bars a swap WITH someone who held off earlier in the round and is silent about the one
   who held off holding off again when the new turn comes (question OQ-17 of the handoff). false: they may; true: they may not.
   Returns the ids of legal partners. */
export function holdOffTargets(order, id, opts = {}) {
  const me = order.find((e) => e.id === id);
  if (!me || me.acted) return [];
  if (opts.initiatorOnce && me.heldOff) return [];
  return order.filter((e) => e.id !== id && e.card > me.card && !e.acted && !e.heldOff).map((e) => e.id);
}

/* swap the cards (and so the places) of the draw holding off and its partner; the initiator is marked as having held off.
   Effects that trigger "on your turn" travel with the card (book 2282): the caller keys them to the turn, not to the card number. */
export function holdOff(order, id, partnerId, opts = {}) {
  if (!holdOffTargets(order, id, opts).includes(partnerId)) throw new Error(`holdOff: ${id} cannot swap with ${partnerId}`);
  const a = order.find((e) => e.id === id), b = order.find((e) => e.id === partnerId);
  return sortOrder(order.map((e) => (e === a ? { ...a, card: b.card, heldOff: true } : e === b ? { ...b, card: a.card } : e)));
}

/* book 2277: optional table rule: draw only in the first round and keep the cards afterwards (holding off still works). */
export const REDRAW_MODES = ["everyRound", "firstRoundOnly"];
