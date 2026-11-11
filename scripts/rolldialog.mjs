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
     - (U82) names the attack's facts (damage, least and greatest range, armor, stress price) so the stylesheet can draw each as a
       picture with its number on one strip; the fact's name becomes its tooltip and stays in the window for a screen reader,
     - (U87) marks a range whose least and greatest are the same number (Slugfest: 0 and 0), so the strip shows that number once;
       its tooltip then carries both names, and both numbers with their names stay in the window for a screen reader,
     - (U82) gives a part of the pool whose name does not fit on its line the whole name as its tooltip,
     - gives the window the module's tooltip panel.
   Nothing is computed here (two shown numbers are compared, no more) and no button is added, removed, reordered or rewired. If this file does not run, the stylesheet falls
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

/* U82 the attack's facts by the system's own words for them */
export const FACTS = {
  damage: "INVINCIBLE.Automation.FIELDS.rollAttack.baseDamage.label",
  min: "INVINCIBLE.Automation.FIELDS.rollAttack.minRange.label",
  max: "INVINCIBLE.Automation.FIELDS.rollAttack.maxRange.label",
  armor: "YZUR.CHAT.ROLL.ATTACK.ARMOR",
  stress: "INVINCIBLE.Automation.FIELDS.rollAttribute.stressCost.label"
};
/* pure: which fact a chip's label names (names: kind -> the client's word), or null: an unknown fact keeps its word */
export function factKind(label, names) {
  const text = String(label ?? "").trim();
  if (!text) return null;
  for (const [kind, name] of Object.entries(names ?? {})) if (name === text) return kind;
  return null;
}
/* U87 pure: are the least and the greatest range the same number, so that one number says both? Any equal pair, not only 0 and 0:
   "3 - 3" says no more than "3". A value that is missing or not a number keeps the pair as the system wrote it. */
export function oneRange(min, max) {
  const a = String(min ?? "").trim(), b = String(max ?? "").trim();
  if (!a || !b) return false;
  const x = Number(a), y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && x === y;
}
/* U87 pure: the tooltip of the one number that stands for both ends of the range: both of the system's names */
export const bothNames = (min, max) => `${min} = ${max}`;

function facts(el) {
  const box = el.querySelector("div.separator + div.breakdown");
  if (!box) return;
  const names = Object.fromEntries(Object.entries(FACTS).map(([kind, key]) => [kind, game.i18n.localize(key)]));
  const found = {};
  for (const part of box.querySelectorAll(":scope > div.attribute")) {
    const name = part.querySelector("label.attribute-label")?.textContent?.trim();
    if (!name) continue;
    const kind = factKind(name, names);
    if (kind) { part.dataset.irdFact = kind; found[kind] = part; }
    part.dataset.tooltip = name;
    part.dataset.tooltipDirection = "UP";
    part.querySelector("input")?.setAttribute("aria-label", name);
  }
  const { min, max } = found;
  if (min && max && oneRange(min.querySelector("input")?.value, max.querySelector("input")?.value)) {
    max.dataset.irdSame = "";                                                                          // drawn out of sight, still read out
    min.dataset.tooltip = bothNames(names.min, names.max);
  }
  box.dataset.irdFacts = "";
}
/* a part of the pool is one line; a name longer than the line is cut by the stylesheet and gets itself as the tooltip
   (measured a frame later: the window takes its width after the render hook) */
function longNames(el) {
  requestAnimationFrame(() => {
    for (const label of el.querySelectorAll("div.dices + div.breakdown > div.attribute > label.attribute-label")) {
      if (label.scrollWidth > label.clientWidth + 1) label.dataset.tooltip = label.textContent.trim();
      else delete label.dataset.tooltip;
    }
  });
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
  if (dialog) { facts(el); longNames(el); }
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
