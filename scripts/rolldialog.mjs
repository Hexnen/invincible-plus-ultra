/* The system's roll windows in the module's look (ledger U69; styles/rolldialog.css does the drawing):
     the roll dialog (InvincibleRollDialog) and its stunts sibling: form.application.invincible.roll-dialog
     the small DialogV2 windows the system opens around a roll (class roll-application): which way to roll a power's use, a choice
     (the kind of slugfest, which use of a power, which attribute), tick boxes of boosts and limits, the "broken, roll anyway?" question.
   The system's templates, fields, numbers and buttons are left as they are; this file only
     - opens the roll dialog at the width of a caption card instead of 600px (the position is still Foundry's: centred, draggable),
     - names the MAIN button so the stylesheet can give it the one yellow button of the kit: among the ways to roll it is the way the
       chat is set to roll (the one a Shift-click on the sheet uses anyway), in a question it is the default answer,
     - when the buttons are the ways to roll, puts the name of every other way into its tooltip and its aria-label (they become icon
       buttons; the words stay inside the button for a screen reader),
     - gives the window the module's tooltip panel.
   Nothing is computed here and no button is added, removed, reordered or rewired. If this file does not run, the stylesheet falls
   back to worded buttons. */
export const WIDTH = 440;
const LEGACY = { publicroll: "public", gmroll: "gm", blindroll: "blind", selfroll: "self" };
const WAYS = new Set(["public", "gm", "blind", "self"]);
const way = (a) => LEGACY[a] ?? a;

/* pure: are these buttons the ways to roll (and nothing else)? */
export function areWays(actions) {
  const list = (actions ?? []).filter((a) => a != null);
  return list.length > 1 && list.every((a) => WAYS.has(way(a)));
}
/* pure: which of the footer's actions is the main one. One button: that one. The ways to roll: the chat's current way, else the first.
   Anything else: the default answer, else the first. */
export function mainWay(actions, chatMode, defaultAction = null) {
  const list = (actions ?? []).filter((a) => a != null);
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  if (areWays(list)) return list.find((a) => way(a) === way(chatMode)) ?? list[0];
  return list.includes(defaultAction) ? defaultAction : list[0];
}

function chatMode() {
  for (const key of ["messageMode", "rollMode"]) {
    try { if (game.settings.settings.has(`core.${key}`)) return game.settings.get("core", key); } catch { /* next */ }
  }
  return null;
}

function dress(app, el, _context, options) {
  const cl = el?.classList;
  const dialog = !!cl?.contains("roll-dialog") && cl.contains("invincible"), small = !!cl?.contains("roll-application") && cl.contains("dialog");
  if (!dialog && !small) return;
  if (dialog && options?.isFirstRender) { options.position ??= {}; options.position.width = WIDTH; }   // applied by Foundry right after this hook
  el.dataset.tooltipClass ??= "ipu-tip";
  if (cl.contains("choices-dialog")) return;                                                           // a list of answers: every one can be pressed, none is "the" one
  const buttons = [...el.querySelectorAll("footer.form-footer button[data-action]")];
  const actions = buttons.map((b) => b.dataset.action), ways = areWays(actions);
  const main = mainWay(actions, chatMode(), buttons.find((b) => b.autofocus || b.hasAttribute("autofocus"))?.dataset.action ?? null);
  for (const b of buttons) {
    const is = b.dataset.action === main;
    b.toggleAttribute("data-ird-main", is);
    b.dataset.irdWay = is ? "main" : ways ? "other" : "worded";
    const name = b.querySelector("span")?.textContent?.trim();
    if (is || !ways || !name) continue;
    b.dataset.tooltip = name;
    b.dataset.tooltipDirection = "UP";
    b.setAttribute("aria-label", name);
  }
}

let started = false;
export function start() {
  if (started || typeof Hooks === "undefined") return;
  started = true;
  for (const name of ["renderInvincibleRollDialog", "renderInvincibleStuntsDialog", "renderDialogV2"]) {
    Hooks.on(name, (...args) => { try { dress(...args); } catch (e) { console.warn("invincible-plus-ultra | roll dialog look", e); } });
  }
}
