/* Team & Base card UI helpers (phase B4): HTML escape, icon markup, error reporting. Browser only (uses foundry / ui). */
import { t } from "./lang.mjs";

export const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
export const icon = (classes) => `<i class="${esc(classes)}" aria-hidden="true"></i>`;
export const rankName = (rank) => t(`IPB.Rank.${rank}`);

/** Show a BaseError (or any error) as a notification; the console keeps the details. */
export function reportError(err) {
  console.warn("invincible-plus-ultra (base) |", err);
  const msg = err?.name === "BaseError" ? err.message : (err?.message || String(err));
  ui.notifications?.error(msg, { console: false });
}
/** await a promise; on failure report it and resolve null. */
export async function guard(promise) {
  try { return await promise; } catch (err) { reportError(err); return null; }
}
