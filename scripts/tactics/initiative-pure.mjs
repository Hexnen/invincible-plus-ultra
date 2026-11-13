/* Tactical combat (package P1): card INITIATIVE (spec section 3). Pure ES module: NO Foundry globals; randomness only through `rng`.
   Node-tested by check-initiative.mjs. The deck rules themselves are the rules library's (scripts/rules/initiative.mjs: deckSize,
   newDeck, shuffle, holdOffTargets, holdOff, sortOrder); this file keeps the slots, the round's draw as a RESUMABLE procedure, and the
   turn pointer.
   Why the draw is not one call of initiative.dealRound [G-L6]: a Fast Reflexes holder must see both cards before choosing and the other
   card goes back into the deck before the next draw [I6] [B2112]; dealRound is synchronous. The draw here follows the same order as
   dealRound (kept cards, surprise cards, heroes, NPCs [OQ-13]) and stops at each holder until the answer arrives.
   Citation marks as in dev/combat-spec.md 0.1. Book text is never quoted.

   Initiative = { deck, slots:[Slot], cur, curMember, prev:{[combatantId]:card}, trail:[combatantId], surprised?, pendingDraw?, draw? }
   Slot = { id, card|null, members:[combatantId], state:"waiting"|"active"|"done"|"lost", heldOff?, done:[combatantId], extra?:{kind,by?}, at? }
   Additions to the spec's shapes, all [D]: `trail` (members in the order their turns ended this round, for the GM's step back), `draw`
   (the unfinished draw: deck left, queue, the holder being waited for), Slot.at (where an extra turn sits in the order). */
import { initiative } from "../rules/index.mjs";

/* [A-1] a combatant added in the middle of a round acts last in it (next free card) and draws normally from the next round */
export const LATE_JOINER = "last";
/* [OQ-17] may the one who held off hold off again when the new turn comes? The book only bars choosing such a character as the partner
   [B2281]. true = as the rules library; false = the bar does not offer it (the GM can swap cards in any case). */
export const HOLD_OFF_AGAIN = true;
/* Hole (reported): which NPC group counts as surprised when only some of its members failed the roll [B2279] vs [B2275]. "all" = the
   group's card is a surprise card only when every member is on the surprised list; the GM builds both the groups and the list. */
export const GROUP_SURPRISE = "all";

const copy = (v) => JSON.parse(JSON.stringify(v));
const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });
const sortKey = (s) => (s.card ?? (s.extra ? s.at ?? 0 : Infinity));
/* [I1] [B2269]: lower card first. An extra turn (no card) sits right after the point where it was inserted (spec 3.2). */
export function sortSlots(slots) {
  return slots.map((s, i) => ({ s, i })).sort((x, y) => (sortKey(x.s) - sortKey(y.s)) || ((x.s.extra ? 1 : 0) - (y.s.extra ? 1 : 0)) || (x.i - y.i)).map((x) => x.s);
}
export const slotOf = (init, memberId) => init.slots.find((s) => !s.extra && s.members.includes(memberId)) ?? null;
export const slotById = (init, id) => init.slots.find((s) => s.id === id) ?? null;
/* who gets a card: a challenge has none [I12] [R22]; summoned allies and controlled animals act on their owner's turn [I14] [B1808], [B1637];
   a combatant marked defeated in Foundry is out of the fight (the tracker's own notion [D]) */
export const eligible = (p) => !!p && !p.defeated && !p.challenge && !p.summonOf && !p.vehicle && !p.noCard;      // P7: a vehicle has no card (its driver acts); nobody has one in a chase [B3432]
const usedCards = (init) => init.slots.map((s) => s.card).filter((c) => c !== null && c !== undefined);
/* [A-1] [R12]: the next card after every card in use; the deck grows when it has to */
function nextFreeCard(init) { const u = usedCards(init); return u.length ? Math.max(...u) + 1 : 1; }

/* after an edit of the slots: a slot in progress whose members have all acted is done, a finished slot that received a member who has
   not acted waits again, and the pointer never names a slot that is not in progress */
function settle(init) {
  for (const s of init.slots) {
    const all = s.members.every((m) => s.done.includes(m));
    if (s.state === "active" && all) s.state = "done";
    else if ((s.state === "done" || s.state === "lost") && !all) s.state = "waiting";
  }
  const cur = slotById(init, init.cur);
  if (!cur || cur.state !== "active") { init.cur = null; init.curMember = null; }
  else if (init.curMember && !cur.members.includes(init.curMember)) init.curMember = null;
  for (const s of init.slots) if (s.state === "active" && s.id !== init.cur) s.state = "waiting";
  return init;
}

/* the whole order, member by member: [{ slot, card, id, pos, state, extra }] */
export function flat(init) {
  const out = [];
  for (const s of init.slots) s.members.forEach((id, pos) => out.push({ slot: s.id, card: s.card, id, pos, state: s.state, extra: !!s.extra, done: s.done.includes(id) }));
  return out;
}
/* what the Combatant documents hold (spec 3.3): initiative = the card, pos = the place inside the slot; no slot = no initiative */
export function docSync(init) {
  const out = {};
  for (const s of init.slots) { if (s.extra) continue; s.members.forEach((id, pos) => { out[id] = { initiative: s.card ?? null, pos }; }); }
  return out;
}

/* ------------------------------------------------------------------ roster */
/* bring the slots in line with the participants: gone or no longer eligible members leave, new ones get a slot of their own without a card */
function syncSlots(init, parts, mkId) {
  const ok = new Set(parts.filter(eligible).map((p) => p.id));
  for (const s of init.slots) { s.members = s.members.filter((m) => ok.has(m)); s.done = s.done.filter((m) => s.members.includes(m)); }
  init.slots = init.slots.filter((s) => s.members.length);
  const have = new Set(init.slots.filter((s) => !s.extra).flatMap((s) => s.members));
  const added = [];
  for (const p of parts) if (ok.has(p.id) && !have.has(p.id)) { init.slots.push({ id: mkId("s"), card: null, members: [p.id], state: "waiting", done: [] }); added.push(p.id); }
  if (!slotById(init, init.cur)) { init.cur = null; init.curMember = null; }
  else if (init.curMember && !slotById(init, init.cur).members.includes(init.curMember)) init.curMember = null;
  return added;
}

/* ------------------------------------------------------------------ the draw of a round */
/* Begin the draw of `round`. parts = [{ id, hero, defeated, challenge, summonOf, veteran, reflexes, resolve }].
   opts = { redraw: "everyRound"|"firstRoundOnly", surprised:[combatantId] (round 1), groups:[[combatantId...]] (round 1), mkId }.
   -> { init, ask:[{ kind:"veteran", slot, member, card }], done }   done = no draw needed (cards kept [I2]). */
export function startDraw(init0, round, parts, opts = {}) {
  const init = copy(init0);
  const mkId = opts.mkId;
  init.prev = {};
  if (round > 1) for (const s of init.slots) if (!s.extra && s.card !== null) for (const m of s.members) init.prev[m] = s.card;   // [I7]: last round's card
  init.slots = init.slots.filter((s) => !s.extra);                                                                                // an extra turn belongs to its round
  syncSlots(init, parts, mkId);
  if (round === 1) for (const g of opts.groups ?? []) { const r = group(init, g); if (r.ok) Object.assign(init, r.init); }       // [I4] [B2275]
  for (const s of init.slots) { s.state = "waiting"; s.done = []; delete s.heldOff; }
  init.cur = null; init.curMember = null; init.trail = [];
  delete init.surprised; delete init.pendingDraw; delete init.draw;
  if (opts.redraw === "firstRoundOnly" && round > 1) {                                                                            // [I2] [B2277]: the order of round 1 stays
    for (const s of init.slots) if (s.card === null) s.card = nextFreeCard(init);                                                 // [A-1]
    init.deck = Math.max(initiative.deckSize(init.slots.length), ...usedCards(init), 1);
    init.slots = sortSlots(init.slots);
    return { init, ask: [], done: true };
  }
  const size = initiative.deckSize(init.slots.length);                                                                            // [I3] [B2268], [R12]
  const byId = new Map(parts.map((p) => [p.id, p]));
  const sur = new Set(round === 1 ? opts.surprised ?? [] : []);                                                                   // [I5] [B2279]: first round only
  const surprised = init.slots.filter((s) => (GROUP_SURPRISE === "all" ? s.members.every((m) => sur.has(m)) : s.members.some((m) => sur.has(m)))).map((s) => s.id);
  const ask = [];
  if (round > 1) for (const s of init.slots) {
    if (s.members.length !== 1) continue;
    const p = byId.get(s.members[0]), card = init.prev[s.members[0]];
    // [I7] [B2100]: 1 stress to keep last round's card; no voluntary stress at Resolve 0 [B2816]; the card must exist in this round's deck
    if (p?.veteran && Number.isFinite(card) && card <= size && Number(p.resolve) > 0) ask.push({ kind: "veteran", slot: s.id, member: s.members[0], card });
  }
  for (const s of init.slots) s.card = null;
  init.draw = { round, stage: "veteran", size, left: [], queue: [], keeps: {}, surprised, wait: null, vetWait: ask.map((a) => a.slot) };
  return { init, ask, done: false };
}

/* a Combat Veteran decided [I7] */
export function answerVeteran(init0, slotId, keep) {
  const d = init0.draw;
  if (!d || d.stage !== "veteran" || !d.vetWait?.includes(slotId)) return fail("gone");
  const init = copy(init0);
  init.draw.vetWait = init.draw.vetWait.filter((x) => x !== slotId);
  const s = slotById(init, slotId), card = s ? init.prev[s.members[0]] : undefined;
  if (keep && s && Number.isFinite(card)) init.draw.keeps[slotId] = card;
  return { ok: true, init, kept: !!(keep && s && Number.isFinite(card)), card: card ?? null, member: s?.members[0] ?? null };
}

/* Carry the draw on as far as it goes without a human. The deal itself is the rules library's (rules/initiative.mjs): `dealStart` opens it
   (kept cards leave the deck [I7]; surprise cards = the highest of the deck, at random among the surprised [I5] [R12]; the rest of the deck
   is shuffled; heroes draw before NPCs [B2112] [OQ-13]) and stops at a Fast Reflexes holder, who takes two cards and chooses [I6];
   `dealContinue` (answerReflexes below) shuffles the other card back; `dealAdvance` deals on from the stored deck and queue. This file only
   keeps the deal in the combat state between the answers (`draw.left` = the deck, `draw.queue` = the slots still to draw, `draw.wait` =
   the two cards out) and maps slots to the library's draws: one draw per slot, a group shares one card and has no holder of its own.
   -> { init, done, ask:[{ kind:"reflexes", slot, member, cards:[a,b] }], dealt:[{ slot, card, members, reason }] } */
export function continueDraw(init0, parts, rng) {
  const init = copy(init0);
  const d = init.draw;
  const dealt = [];
  if (!d) return { init, done: true, ask: [], dealt };
  const byId = new Map(parts.map((p) => [p.id, p]));
  const drawOf = (s, extra = {}) => ({ id: s.id, hero: !!byId.get(s.members[0])?.hero, fastReflexes: s.members.length === 1 && !!byId.get(s.members[0])?.reflexes, ...extra });
  const take = (entries) => {
    for (const e of entries) {
      const s = slotById(init, e.id);
      if (!s) continue;
      s.card = e.card;
      dealt.push({ slot: s.id, card: e.card, members: s.members.slice(), reason: e.kept ? "veteran" : e.surprised ? "surprise" : "draw" });
    }
  };
  const hold = (ds) => {
    d.left = ds.deck.slice(); d.queue = ds.queue.map((q) => q.id);
    d.wait = ds.pending ? { slot: ds.pending.id, drawn: ds.pending.cards.slice(), prompt: null } : null;
  };
  if (d.stage === "veteran") {
    if (d.vetWait?.length || d.surpriseWait) return { init, done: false, ask: [], dealt };      // ANSG (FXT-10): the GM's surprise card first
    d.stage = "deal";
    const open = init.slots.filter((s) => s.card === null);
    const size = initiative.deckSize(open.length), seen = new Set();
    /* a kept card must be a card of this round's deck, and only one slot keeps it; a card from a longer deck of an earlier round is kept
       beside the deck (nobody else can draw it) */
    const keepOf = (s) => { const c = d.keeps[s.id]; if (!Number.isFinite(c) || seen.has(c)) return null; seen.add(c); return c; };
    let draws = [], beside = [];
    const kept = open.map((s) => ({ s, keep: keepOf(s) }));
    /* dealStart builds its deck from the draws it is given, so a card set aside shrinks it: set aside again until every kept card is in it */
    let cap = size;
    for (;;) {
      draws = []; beside = [];
      for (const { s, keep } of kept) {
        if (keep != null && keep > cap) { beside.push({ id: s.id, card: keep, kept: true }); continue; }
        draws.push(drawOf(s, { ...(keep != null ? { keep } : {}), surprised: keep == null && d.surprised.includes(s.id) }));
      }
      const next = initiative.deckSize(draws.length);
      if (next >= cap) break;
      cap = next;
    }
    d.size = Math.max(size, ...Object.values(d.keeps), 1);
    take(beside);
    const ds = initiative.dealStart(rng, draws, {});
    take(ds.entries);
    hold(ds);
  }
  if (d.wait) return { init, done: false, ask: d.wait.prompt ? [] : [{ kind: "reflexes", slot: d.wait.slot, member: slotById(init, d.wait.slot)?.members[0] ?? null, cards: d.wait.drawn.slice() }], dealt };
  /* after a choice, and for slots that joined while the draw was waiting [A-1]: deal on from the stored deck, as far as it has cards */
  const queue = d.queue.map((id) => slotById(init, id)).filter((s) => s && s.card === null).slice(0, d.left.length);
  if (queue.length) {
    const ds = initiative.dealAdvance({ done: false, pending: null, entries: [], deck: d.left.slice(), queue: queue.map((s) => drawOf(s)), order: null });
    take(ds.entries);
    hold(ds);
    if (d.wait) return { init, done: false, ask: [{ kind: "reflexes", slot: d.wait.slot, member: slotById(init, d.wait.slot)?.members[0] ?? null, cards: d.wait.drawn.slice() }], dealt };
  }
  for (const s of init.slots) if (s.card === null && !s.extra) { s.card = nextFreeCard(init); dealt.push({ slot: s.id, card: s.card, members: s.members.slice(), reason: "draw" }); }   // more joiners than cards left: never leave a slot without a card
  if (d.round === 1 && d.surprised.length) init.surprised = d.surprised.flatMap((sid) => slotById(init, sid)?.members ?? []);
  init.deck = Math.max(d.size, ...usedCards(init), 1);
  delete init.draw; delete init.pendingDraw;
  init.slots = sortSlots(init.slots);
  return { init, done: true, ask: [], dealt };
}

/* the Fast Reflexes holder chose [I6]: the other card is shuffled back before anybody else draws (the library's dealContinue) */
export function answerReflexes(init0, slotId, card, rng) {
  const w = init0.draw?.wait;
  if (!w || w.slot !== slotId) return fail("gone");
  if (!w.drawn.includes(card)) return fail("badInput");
  const init = copy(init0);
  const d = init.draw, s = slotById(init, slotId);
  const ds = initiative.dealContinue(rng, { done: false, pending: { id: slotId, cards: w.drawn.slice(0, 2), draw: { id: slotId } }, entries: [], deck: d.left.slice(), queue: [{ id: slotId }], order: null }, card);
  if (s) s.card = card;
  d.left = ds.deck.slice();
  d.wait = null;
  d.queue = d.queue.filter((x) => x !== slotId);
  return { ok: true, init, dealt: s ? [{ slot: s.id, card, members: s.members.slice(), reason: "reflexes" }] : [] };
}

/* ------------------------------------------------------------------ the turn pointer */
/* who is next: the remaining members of the slot in progress (the GM's order inside a group [I4]), else the first waiting slot in card order */
export function nextUp(init) {
  const act = init.slots.find((s) => s.state === "active");
  if (act) { const m = act.members.find((x) => !act.done.includes(x)); if (m) return { slot: act.id, member: m }; }
  const s = init.slots.find((x) => x.state === "waiting" && x.members.some((m) => !x.done.includes(m)));
  return s ? { slot: s.id, member: s.members.find((m) => !s.done.includes(m)) } : null;
}
export function openMember(init0, slotId, member) {
  const init = copy(init0), s = slotById(init, slotId);
  if (!s || !s.members.includes(member)) return init0;
  s.state = "active"; init.cur = s.id; init.curMember = member;
  return init;
}
/* the member's turn is over (or was the lost one [L7]) */
export function memberDone(init0, member, { lost = false } = {}) {
  const init = copy(init0), s = slotById(init, init.cur);
  if (!s) return init0;
  if (!s.done.includes(member)) s.done.push(member);
  init.trail.push(member);
  init.curMember = null;
  if (s.members.every((m) => s.done.includes(m))) { s.state = lost && s.members.length === 1 ? "lost" : "done"; init.cur = null; }
  return init;
}
/* the GM ends the round early: whatever has not acted does not act (a pending lost turn is not consumed by this) */
export function closeRound(init0) {
  const init = copy(init0);
  for (const s of init.slots) if (s.state === "waiting" || s.state === "active") { s.state = "done"; s.done = s.members.slice(); }   // settle() re-derives state from done: skipped members count as having acted, or a later edit would make the slot wait again
  init.cur = null; init.curMember = null;
  return init;
}
/* the GM steps back to the member whose turn ended last in this round; -> { ok, init, member, suspended } */
export function stepBack(init0) {
  if (!init0.trail.length) return fail("noPrev");
  const init = copy(init0);
  const member = init.trail.pop();
  const suspended = init.curMember;
  const curS = slotById(init, init.cur);
  const s = curS?.done.includes(member) ? curS : [...init.slots].reverse().find((x) => x.done.includes(member) && x.state !== "waiting") ?? null;
  if (!s) return fail("noPrev");
  for (const x of init.slots) if (x.state === "active" && x.id !== s.id) x.state = "waiting";
  s.done = s.done.filter((m) => m !== member); s.state = "active";
  init.cur = s.id; init.curMember = member;
  return { ok: true, init, member, suspended };
}

/* ------------------------------------------------------------------ holding off [I8] [I9] [B2281-2283] */
const order = (init) => init.slots.filter((s) => !s.extra && s.card !== null).map((s) => ({ id: s.id, card: s.card, acted: s.state === "done" || s.state === "lost" || s.done.length > 0, heldOff: !!s.heldOff }));
/* the slots the slot in progress may swap cards with. Not offered once a member of a group has already acted this turn (hole, reported:
   the book treats a group as one draw [B2275] and says nothing about a group that is halfway through its turn). */
export function holdOffTargets(init, slotId) {
  const me = slotById(init, slotId);
  if (!me || me.extra || init.cur !== slotId || me.done.length) return [];
  if (me.heldOff && !HOLD_OFF_AGAIN) return [];
  return initiative.holdOffTargets(order(init), slotId);
}
/* swap the cards; the partner cannot refuse and, having the earlier card now, is the slot whose turn it is. -> { ok, init, cards } */
export function holdOff(init0, slotId, partnerId) {
  if (!holdOffTargets(init0, slotId).includes(partnerId)) return fail("illegal");
  const init = copy(init0);
  const next = initiative.holdOff(order(init), slotId, partnerId);
  for (const e of next) { const s = slotById(init, e.id); s.card = e.card; if (e.heldOff) s.heldOff = 1; }
  const me = slotById(init, slotId);
  me.state = "waiting";
  init.cur = null; init.curMember = null;
  init.slots = sortSlots(init.slots);
  return { ok: true, init, cards: { [slotId]: me.card, [partnerId]: slotById(init, partnerId).card } };
}

/* ------------------------------------------------------------------ GM edits (spec 14.2) */
export function setCard(init0, slotId, card, { swap = false } = {}) {
  const init = copy(init0), s = slotById(init, slotId);
  if (!s || s.extra) return fail("gone");
  if (!Number.isInteger(card) || card < 1 || card > 999) return fail("badInput");
  const other = init.slots.find((x) => x.id !== slotId && !x.extra && x.card === card);
  if (other) { if (!swap) return fail("cardTaken"); other.card = s.card; }
  s.card = card;
  init.deck = Math.max(init.deck, card);
  init.slots = sortSlots(init.slots);
  return { ok: true, init };
}
export function swapCards(init0, a, b) {
  const init = copy(init0), x = slotById(init, a), y = slotById(init, b);
  if (!x || !y || x.extra || y.extra || a === b) return fail("gone");
  [x.card, y.card] = [y.card, x.card];
  init.slots = sortSlots(init.slots);
  return { ok: true, init };
}
/* [I4] [B2275]: several NPCs on one card; they act on the same turn in the order the GM chooses (the member order) */
export function group(init0, memberIds) {
  const idsIn = [...new Set(memberIds ?? [])];
  const init = copy(init0);
  const target = slotOf(init, idsIn[0]);
  if (!target || idsIn.length < 2) return fail("badInput");
  for (const m of idsIn.slice(1)) {
    const s = slotOf(init, m);
    if (!s) return fail("gone");
    if (s.id === target.id) continue;
    s.members = s.members.filter((x) => x !== m);
    const wasDone = s.done.includes(m); s.done = s.done.filter((x) => x !== m);
    target.members.push(m); if (wasDone) target.done.push(m);
  }
  init.slots = init.slots.filter((s) => s.members.length);
  settle(init);
  return { ok: true, init, slot: target.id };
}
export function ungroup(init0, memberId, mkId) {
  const init = copy(init0), s = slotOf(init, memberId);
  if (!s || s.members.length < 2) return fail("badInput");
  const wasDone = s.done.includes(memberId);
  s.members = s.members.filter((x) => x !== memberId); s.done = s.done.filter((x) => x !== memberId);
  const cur = init.curMember === memberId;
  const n = { id: mkId("s"), card: nextFreeCard(init), members: [memberId], state: wasDone ? "done" : "waiting", done: wasDone ? [memberId] : [] };   // [A-1]
  init.slots.push(n);
  if (cur) init.curMember = null;
  init.deck = Math.max(init.deck, n.card);
  init.slots = sortSlots(init.slots);
  settle(init);
  return { ok: true, init, slot: n.id };
}
export function reorderGroup(init0, slotId, members) {
  const init = copy(init0), s = slotById(init, slotId);
  if (!s) return fail("gone");
  const want = [...new Set(members ?? [])];
  if (want.length !== s.members.length || !want.every((m) => s.members.includes(m))) return fail("badInput");
  s.members = want;
  return { ok: true, init };
}
/* a combatant joins a running round [A-1] (LATE_JOINER "last") */
export function addCombatant(init0, id, mkId) {
  if (slotOf(init0, id)) return { ok: true, init: init0, slot: slotOf(init0, id).id, changed: false };
  const init = copy(init0);
  const s = { id: mkId("s"), card: init.draw ? null : nextFreeCard(init), members: [id], state: "waiting", done: [] };
  init.slots.push(s);
  if (init.draw?.stage === "deal") init.draw.queue.push(s.id);
  if (s.card !== null) init.deck = Math.max(init.deck, s.card);
  init.slots = sortSlots(init.slots);
  return { ok: true, init, slot: s.id, card: s.card, changed: true };
}
/* a combatant leaves (spec 3.3): its slot goes when it was the only member */
export function removeCombatant(init0, id) {
  const init = copy(init0);
  const wasCurrent = init.curMember === id;
  const gone = [];
  for (const s of init.slots) { if (!s.members.includes(id)) continue; s.members = s.members.filter((m) => m !== id); s.done = s.done.filter((m) => m !== id); if (!s.members.length) gone.push(s.id); }
  init.slots = init.slots.filter((s) => s.members.length);
  if (wasCurrent) init.curMember = null;
  settle(init);
  init.trail = init.trail.filter((m) => m !== id);
  delete init.prev[id];
  if (init.surprised) init.surprised = init.surprised.filter((m) => m !== id);
  if (init.draw) {
    const d = init.draw;
    d.queue = d.queue.filter((x) => !gone.includes(x)); d.vetWait = (d.vetWait ?? []).filter((x) => !gone.includes(x)); d.surprised = d.surprised.filter((x) => !gone.includes(x));
    for (const g of gone) delete d.keeps[g];
    if (d.wait && gone.includes(d.wait.slot)) { d.left.push(...d.wait.drawn); d.wait = null; }
  }
  return { init, wasCurrent, slotsGone: gone };
}
/* an extra turn without a card, right after the current point of the order (spec 3.2; Mind Control [B1761], or the GM) */
export function insertTurn(init0, { combatant, kind = "gm", by = null }, mkId) {
  const init = copy(init0);
  const cur = slotById(init, init.cur);
  const lastDone = [...init.slots].reverse().find((s) => s.state === "done" || s.state === "lost");
  const at = cur ? sortKey(cur) : lastDone ? sortKey(lastDone) : 0;
  const s = { id: mkId("x"), card: null, at: Number.isFinite(at) ? at : 0, members: [combatant], state: "waiting", done: [], extra: { kind: kind === "mindControl" ? "mindControl" : "gm" } };
  if (by) s.extra.by = by;
  init.slots.push(s);
  init.slots = sortSlots(init.slots);
  return { ok: true, init, slot: s.id };
}
