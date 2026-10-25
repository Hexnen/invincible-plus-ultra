/* Team & Base card (B11, finding A1, user decision): JOIN REQUESTS. A player who owns a hero but may not edit a base cannot just link it: store.link() sends the
   relay op "requestJoin"; the active GM client posts ONE whispered chat card to every GM with Approve / Decline buttons (the queue lives in the chat log, so it
   survives a GM tab being closed). Approving re-checks everything against real documents (store.approveJoin): the hero, the card and that the requester still
   OWNS the hero. A card is only honoured when a GM / assistant authored it (a player can write chat messages with any flags). Browser only. */
import * as S from "./store.mjs";
import { t } from "./lang.mjs";
import { esc } from "./util.mjs";

const MOD = S.MODULE_ID;
export const MAX_PENDING_PER_USER = 5;                       // waiting cards one user may have at the same time
export const flagOf = (m) => m?.flags?.[MOD]?.joinRequest ?? null;

/** The visible card: who asks, what for, and either the two buttons (pending) or the outcome. State lives in the flag, the markup is rebuilt from it. */
export function cardHtml(r) {
  const head = `<h3 class="ipb-chat-h">${esc(t("IPB.Join.Title"))}</h3>`;
  const text = `<p>${esc(t("IPB.Join.Text", { user: r.userName, hero: r.heroName, team: r.teamName }))}</p>`;
  let foot;
  if (r.state === "pending") {
    foot = `<div class="ipb-join-acts"><button type="button" class="ipb-join-btn ipb-join-yes" data-action="ipb-join-approve">${esc(t("IPB.Join.Approve", { hero: r.heroName }))}</button>`
      + `<button type="button" class="ipb-join-btn" data-action="ipb-join-decline">${esc(t("IPB.Join.Decline"))}</button></div>`;
  } else foot = `<p class="ipb-join-state" data-state="${esc(r.state)}">${esc(t(`IPB.Join.State.${r.state}`, { gm: r.byName ?? "" }))}</p>`;
  return `<div class="ipb-chat ipb-join" data-team="${esc(r.teamId)}">${head}${text}${foot}</div>`;
}

/** Messages of requests still waiting (optionally of one user). */
export function pending({ userId, actorId, teamId } = {}) {
  return game.messages.filter((m) => {
    const r = flagOf(m);
    return r?.state === "pending" && (!userId || r.userId === userId) && (!actorId || r.actorId === actorId) && (!teamId || r.teamId === teamId);
  });
}

/** GM client: post the card to every GM. One waiting card per hero + card (a repeated request just returns it). Returns { message, again }. */
export async function post({ actor, team, user }) {
  const same = pending({ actorId: actor.id, teamId: team.id })[0];
  if (same) return { message: same, again: true };
  const r = { state: "pending", actorId: actor.id, teamId: team.id, userId: user.id, userName: user.name, heroName: actor.name, teamName: team.name, at: Date.now() };
  const message = await ChatMessage.create({
    content: cardHtml(r), whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id),
    speaker: { alias: t("IPB.Join.Alias") }, flags: { [MOD]: { joinRequest: r } }
  });
  return { message, again: false };
}

/** GM clicks Approve / Decline. decision "approve" | "decline". Rewrites the card with the outcome. */
export async function decide(message, decision, by = game.user) {
  S.assertStaff(by);
  const r = flagOf(message);
  if (!r || r.state !== "pending") return null;
  if (!S.isStaff(message.author)) throw new S.BaseError("noPermission");               // a card a player wrote himself is never honoured
  const next = { ...r, state: decision === "approve" ? "approved" : "declined", byName: by.name, decidedAt: Date.now() };
  if (decision === "approve") {
    try { await S.approveJoin(r, { by }); } catch (err) { next.state = "invalid"; await message.update({ content: cardHtml(next), [`flags.${MOD}.joinRequest`]: next }); throw err; }
  }
  await message.update({ content: cardHtml(next), [`flags.${MOD}.joinRequest`]: next });
  return next.state;
}

/** renderChatMessageHTML: wire the buttons of a pending card (GM only; everyone else cannot see a whispered card anyway). */
export function bind(message, root, onError) {
  const r = flagOf(message);
  if (!r || !root?.querySelectorAll) return;
  for (const b of root.querySelectorAll("[data-action='ipb-join-approve'], [data-action='ipb-join-decline']")) {
    if (!game.user.isGM) { b.disabled = true; continue; }
    if (b._ipbBound) continue;
    b._ipbBound = true;
    b.addEventListener("click", async (ev) => {
      ev.preventDefault();
      for (const x of root.querySelectorAll(".ipb-join-btn")) x.disabled = true;           // one decision per card
      try { await decide(message, b.dataset.action === "ipb-join-approve" ? "approve" : "decline"); } catch (err) { onError?.(err); }
    });
  }
}
