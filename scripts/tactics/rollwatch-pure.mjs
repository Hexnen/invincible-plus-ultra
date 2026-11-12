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
/** What to do now. memo = { fed: Map(messageId -> n), sent: Map(rid -> n) } (kept by the caller between calls, changed here);
    messageFor(rid) -> the id of a chat message carrying that request id, or null. -> [{ do: "feed", messageId, rid } | { do: "resend", inst, key, rid, n }] */
export function plan(state, now, { messageFor, memo }) {
  const acts = [];
  for (const o of owedRolls(state)) {
    const age = now - o.at;
    if (!(age >= FEED_AFTER)) continue;
    const mid = messageFor(o.rid);
    if (mid) {
      const n = memo.fed.get(mid) ?? 0;
      if (n < FEED_MAX) { memo.fed.set(mid, n + 1); acts.push({ do: "feed", messageId: mid, rid: o.rid }); }
      continue;
    }
    const sent = memo.sent.get(o.rid) ?? 0;
    if (sent < RESEND_AT.length && age >= RESEND_AT[sent]) { memo.sent.set(o.rid, sent + 1); acts.push({ do: "resend", inst: o.inst, key: o.key, rid: o.rid, n: sent + 1 }); }
  }
  if (memo.fed.size > 300) memo.fed.clear();
  if (memo.sent.size > 300) memo.sent.clear();
  return acts;
}
