/* Tactical combat: THE ROLL WATCH (D120), pure. A roll the engine asked for travels twice over the wire: the request to the roller's
   client (relay tcroll, fire and forget) and the answer back (the system's chat message, read on the executor from createChatMessage).
   Either can be lost: a socket that drops or stalls for a moment (seen with the machine short of memory), a hook that fires while the
   executor's own write of the state is still on its way, a claim write the server refused. Before D120 such a roll waited until the GM
   noticed the line "Waiting for ..." and pressed "Ask again". Now the executor looks, every few seconds, at every roll still owed:
     - its answer is in the chat already (a message with the request id) but was not taken: it is fed in again ("feed", at most twice
       per message: a message the engine refuses for a reason of its own is not fed for ever);
     - no answer after RESEND_AT[n] ms: the same request (same id) is sent again ("resend"); the roller's client throws once more only
       when its own throw of that id never got through (relay.mjs onRoll `again`). After the last step the GM's "Ask again" remains.
   The decisions are here; engine.mjs runs them. */
export const FEED_AFTER = 2500;                       // ms after the request before a message in the chat counts as missed
export const RESEND_AT = Object.freeze([8000, 20000, 40000]);
export const FEED_MAX = 2;

/** The rolls of the state still owed: [{ inst, key, rid, at, who, rec }] (a result in, or one the GM set, is not owed). */
export function owedRolls(state) {
  const out = [];
  for (const i of state?.stack ?? []) for (const [key, r] of Object.entries(i?.rolls ?? {})) {
    if (!r?.req?.rid || r.sixes != null || r.forced != null) continue;
    out.push({ inst: i.id, key, rid: r.req.rid, at: Number(r.req.at) || 0, who: r.who ?? null, rec: r });
  }
  return out;
}
/** H3-3: the rolls that are in but still pushable: [{ inst, key, rid, rec }]. They wait for the roller's push or accept, which reach the
    executor only as the system's re-write of the chat card (or its new card): if that is lost, the state keeps the pushable result for
    good. The watch compares them with the card in the chat (`readFor`). */
export function openRolls(state) {
  const out = [];
  for (const i of state?.stack ?? []) for (const [key, r] of Object.entries(i?.rolls ?? {})) {
    if (!r?.req?.rid || r.sixes == null || r.forced != null || r.pushable !== true) continue;
    out.push({ inst: i.id, key, rid: r.req.rid, rec: r });
  }
  return out;
}
/* the card in the chat says more than the state: a push the state has not (more pushes), or the roll accepted (no longer pushable) */
const ahead = (m, rec) => !!m && Number.isFinite(m.sixes) && ((Number(m.pushed) || 0) > (rec.pushed ?? 0) || (m.pushable !== true && m.messageId === rec.messageId));
/** What to do now. memo = { fed: Map(messageId -> n), sent: Map(rid -> { n, at }) } (kept by the caller between calls, changed here);
    messageFor(rid) -> the id of a chat message carrying that request id, or null. -> [{ do: "feed", messageId, rid } | { do: "resend", inst, key, rid, n }] */
export function plan(state, now, { messageFor, readFor = null, memo }) {
  const acts = [];
  /* H3-3: a pushable roll whose card in the chat is ahead of the state for FEED_AFTER (the hook's own way had its time) is fed in again,
     at most FEED_MAX times per state of that card. memo.ahead: "<messageId>:<pushed>:<pushable>" -> when first seen ahead */
  memo.ahead ??= new Map();
  for (const o of readFor ? openRolls(state) : []) {
    const m = readFor(o.rid);
    if (!ahead(m, o.rec)) continue;
    const k = `${m.messageId}:${Number(m.pushed) || 0}:${m.pushable === true ? 1 : 0}`, first = memo.ahead.get(k);
    if (first == null) { memo.ahead.set(k, now); continue; }
    if (now - first < FEED_AFTER) continue;
    const n = memo.fed.get(k) ?? 0;
    if (n < FEED_MAX) { memo.fed.set(k, n + 1); acts.push({ do: "feed", messageId: m.messageId, rid: o.rid }); }
  }
  if (memo.ahead.size > 300) memo.ahead.clear();
  for (const o of owedRolls(state)) {
    const age = now - o.at;
    if (!(age >= FEED_AFTER)) continue;
    const mid = messageFor(o.rid);
    if (mid) {
      const n = memo.fed.get(mid) ?? 0;
      if (n < FEED_MAX) { memo.fed.set(mid, n + 1); acts.push({ do: "feed", messageId: mid, rid: o.rid }); }
      continue;
    }
    /* H3-5: the memo is the executor's own (lost with a reload, or when another GM becomes the executor). The step after a send waits
       for the schedule's own gap since THAT send too, so a roll owed for long is asked again once, then on the schedule's later steps,
       never on every look. memo.sent: rid -> { n, at } (the count and the time of the last send) */
    const sent = memo.sent.get(o.rid) ?? { n: 0, at: null }, n = sent.n;
    const gapOk = sent.at == null || now - sent.at >= RESEND_AT[n] - (RESEND_AT[n - 1] ?? 0);
    if (n < RESEND_AT.length && age >= RESEND_AT[n] && gapOk) { memo.sent.set(o.rid, { n: n + 1, at: now }); acts.push({ do: "resend", inst: o.inst, key: o.key, rid: o.rid, n: n + 1 }); }
  }
  if (memo.fed.size > 300) memo.fed.clear();
  if (memo.sent.size > 300) memo.sent.clear();
  return acts;
}

/* D122: a request that came LATE (not lost) is followed by the watch's `again` copies of it, which the roller's client also gets late.
   Each copy then threw once more (ROLL_RETRY_MS after the last throw): three cards, three sets of dice, only the first counts. A copy
   is thrown only when no answer to that request is in this client's chat: a message whose tag carries the same request id (and the same
   combat when both say one), written by one of the users asked. The answer the executor has not taken yet is the watch's to feed.
   answered(messages, req, users, tagOf) -> true when the throw is in already. */
export function answered(messages, req, users, tagOf) {
  if (typeof req?.rid !== "string" || !req.rid) return false;
  const asked = new Set(Array.isArray(users) ? users : []);
  for (const m of messages ?? []) {
    const tg = tagOf(m);
    if (!tg || tg.rid !== req.rid || (tg.combat && req.combat && tg.combat !== req.combat)) continue;
    const by = m?.author?.id ?? m?.author ?? null;
    if (asked.has(by)) return true;
  }
  return false;
}

/* U137: the fight a roll card belongs to. A card whose tag names a combat that is gone (deleted, an earlier fight) belongs to no fight
   on the table: its buttons are settled, never read against the fight there now. A card with no combat in its tag (older cards) reads
   the fight on the table, as before. cardCombat(tag, get, current) -> the combat or null */
export function cardCombat(tag, get, current) {
  if (typeof tag?.combat === "string" && tag.combat) return get(tag.combat) ?? null;
  return current ?? null;
}

/* U129: the system's roll card keeps its Push / Accept buttons until the system itself redraws it, so a card whose roll the fight has
   settled otherwise (the GM accepted it for the player, a later push made a new card, the action ended) kept live-looking buttons.
   cardState(view, tag, messageId) -> "open" (the buttons still mean something, or the roll is not taken yet) | "settled". */
/** FXP (D160): a roll card of the fight that another user threw: its Push / Accept are not this user's (only the author may change the
    card; a co-owner's buttons failed without a word). The GM's seat keeps them. -> true when they are switched off here */
export const cardOther = (authorId, userId, staff = false) => !staff && !!authorId && !!userId && authorId !== userId;
export function cardState(view, tag, messageId) {
  const inst = (view?.stack ?? []).find((i) => i?.id === tag?.inst), r = inst?.rolls?.[tag?.key];
  if (!r || r.forced != null) return "settled";
  if (r.sixes == null) return r.req?.rid == null || r.req.rid === tag.rid ? "open" : "settled";
  return r.pushable === true && r.messageId === messageId ? "open" : "settled";
}
