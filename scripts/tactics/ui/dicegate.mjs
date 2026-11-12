/* Tactical combat, the surfaces: THE DICE GATE (ANSC), the Foundry side of ui/wait-pure.mjs. Are the 3D dice of a roll still rolling on
   THIS client (Dice So Nice marks the chat message `_dice3danimating` in its own createChatMessage hook and clears it when the throw
   is over; the same reading as ui/main.mjs diceBusy and ui/camera.mjs diceSettled), and "do this once they have landed". At most
   HOLD_MS from when this client first saw them (a stuck flag never keeps anything). No Dice So Nice, or its 3D dice switched off on
   this client: the flag is never set, `on()` is false and `after(fn)` runs fn at once. Used by the numbers over tokens, the camera's
   quiet cues, the roll requests, the initiative bar and the challenges HUD. Everything in try / catch: a gate must never break a caller. */
import * as W from "./wait-pure.mjs";
import { diceRun } from "./news-pure.mjs";

let run = null, landing = null;
const recent = () => { try { return (game.messages?.contents ?? []).slice(-12).filter((m) => m?._dice3danimating); } catch { return []; } };
/* FXB2 (U178): the clock is the run of messages in the air (news-pure diceRun), not the last call's: a run nobody asked about after it
   landed (nothing was held, so no landed()) left `since` behind, and the next roll found it past HOLD_MS and held nothing */
const clock = (now) => { try { run = diceRun(run, recent().map((m) => m.id), now); } catch { run = null; } return run?.since ?? null; };
/** 3D dice roll on this client now */
export function busy() {
  try { return typeof game.dice3d?.waitFor3DAnimationByMessageID === "function" && recent().length > 0; } catch { return false; }
}
/** do the dice hold the surfaces now (busy, and not longer than HOLD_MS) */
export function on(now = Date.now()) {
  return W.diceHolds(busy(), clock(now), now).on;
}
/** a promise that resolves when the dice rolling now have landed (at most HOLD_MS + 0.1 s) */
export function landed() {
  if (landing) return landing;
  const d = globalThis.game?.dice3d, list = recent();
  landing = Promise.race([Promise.all(list.map((m) => Promise.resolve(d?.waitFor3DAnimationByMessageID?.(m.id)).catch(() => {}))), new Promise((r) => setTimeout(r, W.HOLD_MS + 100))])
    .catch(() => {}).finally(() => { landing = null; clock(Date.now()); });
  return landing;
}
/** run fn now when nothing holds, else once the dice have landed (asked again then: dice thrown meanwhile hold it too, never past
    HOLD_MS). -> true when it waits */
export function after(fn) {
  let wait = false;
  try { wait = on(); } catch { wait = false; }
  if (!wait) { try { fn(); } catch (e) { console.warn("invincible-plus-ultra (dice gate) |", e); } return false; }
  landed().then(() => setTimeout(() => after(fn), 30));
  return true;
}
export const state = () => ({ busy: busy(), since: clock(Date.now()), waiting: !!landing });
