/* The system's roll dialog in the module's look (ledger U69; styles/rolldialog.css does the drawing).
   The system's template, fields, numbers and buttons are left as they are; this file only
     - opens the window at the width of a caption card instead of 600px (the position is still Foundry's: centred, draggable),
     - names the MAIN way to roll (the way the chat is set to roll, the one a Shift-click on the sheet uses anyway), so the stylesheet
       can give it the one yellow button, and puts the name of every other way into its tooltip and its aria-label (they become icon
       buttons; the words stay inside the button for a screen reader),
     - gives the window the module's tooltip panel.
   Nothing is computed here and no button is added, removed, reordered or rewired. If this file does not run, the stylesheet falls
   back to four worded buttons. */
export const WIDTH = 440;
const LEGACY = { publicroll: "public", gmroll: "gm", blindroll: "blind", selfroll: "self" };

/* pure: which of the footer's actions is the main one. One button: that one. Several: the chat's current way, else the first. */
export function mainWay(actions, chatMode) {
  const list = (actions ?? []).filter((a) => a != null);
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const want = LEGACY[chatMode] ?? chatMode;
  return list.includes(want) ? want : list[0];
}

function chatMode() {
  for (const key of ["messageMode", "rollMode"]) {
    try { if (game.settings.settings.has(`core.${key}`)) return game.settings.get("core", key); } catch { /* next */ }
  }
  return null;
}

function dress(app, el, _context, options) {
  if (!el?.classList?.contains("roll-dialog") || !el.classList.contains("invincible")) return;
  if (options?.isFirstRender) { options.position ??= {}; options.position.width = WIDTH; }   // applied by Foundry right after this hook
  el.dataset.tooltipClass ??= "ipu-tip";
  const buttons = [...el.querySelectorAll("footer.form-footer button[data-action]")];
  const main = mainWay(buttons.map((b) => b.dataset.action), chatMode());
  for (const b of buttons) {
    const is = b.dataset.action === main;
    b.toggleAttribute("data-ird-main", is);
    b.dataset.irdWay = is ? "main" : "other";
    const name = b.querySelector("span")?.textContent?.trim();
    if (is || !name) { delete b.dataset.tooltip; b.removeAttribute("aria-label"); continue; }
    b.dataset.tooltip = name;
    b.dataset.tooltipDirection = "UP";
    b.setAttribute("aria-label", name);
  }
}

let started = false;
export function start() {
  if (started || typeof Hooks === "undefined") return;
  started = true;
  for (const name of ["renderInvincibleRollDialog", "renderInvincibleStuntsDialog"]) {
    Hooks.on(name, (...args) => { try { dress(...args); } catch (e) { console.warn("invincible-plus-ultra | roll dialog look", e); } });
  }
}
