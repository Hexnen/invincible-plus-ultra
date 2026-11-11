/* The shared kit (ledger U65, styles/kit.css): one tooltip look outside the fight.
   Foundry reads the class of a tooltip from the nearest [data-tooltip-class] of the element under the pointer (TooltipManager.activate).
   This file names that class for every tooltip that opens inside one of the module's surfaces and has none yet, so the sheets, the chat
   cards, the windows and the map pieces show the dock's panel (#tooltip.ipu-tip) instead of Foundry's default one. The dock and the GM desk
   name their own class on their roots (ita-tip), the chat tags name isp-tip: both are left alone. Nothing is rebuilt, no text changes.

   A NEW SURFACE either puts data-tooltip-class="ipu-tip" on its root, or adds its root selector to SURFACES. */
const TIP = "ipu-tip";
export const SURFACES = [
  ".invincible.sheet",                      // the character, challenge, vehicle and item sheets
  ".invincible-plus-ultra",                 // the creator, team & base, the log view, the session review
  "li.chat-message",                        // chat cards (sidebar, pop-out, the notification pile)
  "#invincible-party", "#invincible-challenges", "#invincible-combat-bar", "#invincible-turn-tray",
  ".ipl", ".ich-umenu", ".ips-notice",
  ".ipb-dialog", ".ipb-kp-dialog", ".ipb-dialog-safe", ".ipc-dialog", ".ipl-dialog", ".ips-dialog", ".ips-dialog-safe", ".itn-dialog"
].join(", ");
const HAS_TIP = "[data-tooltip], [data-tooltip-html], [data-tooltip-text]";

/* pure: the class to name on `el`, or null (not a tooltip owner, outside the surfaces, or a class is already named above it) */
export function tipClassFor(el) {
  if (!el?.matches?.(HAS_TIP)) return null;
  if (el.closest("[data-tooltip-class]")) return null;
  return el.closest(SURFACES) ? TIP : null;
}

function onEnter(ev) {
  const el = ev.target;
  if (!(el instanceof Element)) return;
  if (tipClassFor(el)) el.dataset.tooltipClass = TIP;
}

let started = false;
export function start() {
  if (started || typeof document === "undefined") return;
  started = true;
  /* capture on the document runs before Foundry's own capture listener on the body, so the class is there when the tooltip opens;
     focusin covers the surfaces that open a tooltip on keyboard focus */
  document.addEventListener("pointerenter", onEnter, { capture: true, passive: true });
  document.addEventListener("focusin", onEnter, { capture: true, passive: true });
}
