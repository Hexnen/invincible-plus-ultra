/* Polish for the texts the Invincible SYSTEM never sends through a language key (system 2.1.8). The system's files are not touched.
   Three kinds of text, three mechanisms (all wording lives in lang/pl.json + lang/en.json of this module, never here):

   1. Texts with a key: lang/pl.json carries the system's own namespaces (INVINCIBLE.*, YZUR.*, TYPES.*). Foundry merges an active module's
      language file over the system's, so nothing is needed at run time. Declared in module.json "languages": the SERVER reads that list
      at start, so a freshly added entry needs one Foundry restart.
   2. Texts the system passes through game.i18n.localize WITHOUT a key ("Edit", "Delete", "Apply", "Save", "Name", "No", "Duplicate",
      "Power Boost", "Select the attribute": context-menu entries, dialog buttons and window titles are localized by Foundry itself): the
      English literal IS the key, so lang/pl.json simply has top-level entries with those names. Nothing at run time.
   3. Texts that reach the screen raw: notifications (ui.notifications.warn("You are not a GM!")) and three places in templates. Those are
      swapped here: the notifier is wrapped (exact English sentence -> IPU.Sys.<id>), and three narrow DOM fixes run on render.

   What a system update can break (each fails soft: the English text shows again, nothing throws):
   - a NEW key: English until lang/pl.json gets it (scripts/i18n/check-glossary.mjs fails when the installed system has a key we lack);
   - a REWORDED keyless text: the exact-match table below no longer matches (check-glossary compares the table with the system's sources
     when the system is installed next to the module);
   - a changed template: the DOM fixes find nothing. */
import { ATTRS, gradePl } from "./terms.mjs";
const MOD = "invincible-plus-ultra", SYSTEM = "invincible", NS = "IPU.Sys.";

/** id -> the English text exactly as the system's code has it ({name} = any text). Wording of both languages: IPU.Sys.<id> in lang/*.json. */
export const KEYLESS = Object.freeze({
  noResolve: "You don't have enough resolve to use this.",
  badAutomation: "You can't execute this kind of automation",
  needAttribute: "You need to have an attribute selected for the automation.",
  singleUsed: "Single item used and deleted from the sheet.",
  notGM: "You are not a GM!",
  challengeNoItems: "Challenge does not accept any kind of item",
  boostsOnPower: "You can't add boosts/limits directly to the actor. Open a Power and drop the boost/limit on the item sheet.",
  vehicleOnlyWeapons: "Vehicle only accepts Vehicle Weapons.",
  macroOwnedOnly: "You can only create macro buttons for owned Items",
  macroItemGone: "Could not find item {name}. You may need to delete and recreate this macro.",
  migrating: "Migrating your data to version {version}. Please, wait until it finishes.",
  migrated: "Data migrated to version {version}.",
});
/** Texts fixed in the DOM: id -> English text of the template. */
export const DOM_TEXTS = Object.freeze({ condition: "Condition", extraConfiguration: "Extra Configuration" });
/** The system's roll-mode dialog title has a typo ("Invincilble: <flavor>"); shown corrected in every language. */
export const TITLE_TYPO = "Invincilble: ";
/** The system's templates call the CORE's phrases with an English word inside: {{localize 'DOCUMENT.New' type='Automation'}} gives
    "Nowa Automation". id -> [core key, the type word of the template]; the whole phrase in both languages is IPU.Sys.<id>. */
export const DOC_PHRASES = Object.freeze({
  docNewEffect: ["DOCUMENT.New", "Effect"], docCreateEffect: ["DOCUMENT.Create", "Effect"], docDeleteEffect: ["DOCUMENT.Delete", "Effect"], docUpdateEffect: ["DOCUMENT.Update", "Effect"],
  docNewAutomation: ["DOCUMENT.New", "Automation"], docDeleteAutomation: ["DOCUMENT.Delete", "Automation"], docDuplicateAutomation: ["DOCUMENT.Duplicate", "Automation"],
  docNewBoost: ["DOCUMENT.New", "Boost"], docDeleteBoost: ["DOCUMENT.Delete", "Boost"], docUpdateBoost: ["DOCUMENT.Update", "Boost"],
  docDeleteLimit: ["DOCUMENT.Delete", "Limit"], docUpdateLimit: ["DOCUMENT.Update", "Limit"],
  docNewFeature: ["DOCUMENT.New", "feature"], docDeleteFeature: ["DOCUMENT.Delete", "feature"], docUpdateFeature: ["DOCUMENT.Update", "feature"],
});
/** The blank option of the power-level select is written in the template (blank="(dynamic)"); its Polish is the system key below. */
export const BLANK_LEVEL = Object.freeze({ text: "(dynamic)", key: "INVINCIBLE.Item.Power.FIELDS.level.dynamic" });
const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
/** The placeholder of the name field in the system's sheet templates (a literal, no key). */
export const NAME_PLACEHOLDER = "Name";

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MATCHERS = Object.entries(KEYLESS).map(([id, en]) => {
  const names = [...en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  const re = new RegExp(`^${en.split(/\{\w+\}/).map(escRe).join("(.+?)")}$`);
  return { id, names, re };
});
const RAW_KEY = /^(INVINCIBLE|YZUR|TYPES)\.[\w.]+$/;

/** Pure: the id and data of a keyless system text, or null. */
export function matchKeyless(message) {
  if (typeof message !== "string") return null;
  const text = message.trim();
  for (const { id, names, re } of MATCHERS) {
    const m = re.exec(text);
    if (m) return { id, data: Object.fromEntries(names.map((n, i) => [n, m[i + 1]])) };
  }
  return null;
}
/** The text to show for a notification of the system (unchanged when it is not one of the system's keyless texts). */
export function translateNotice(message, i18n = globalThis.game?.i18n) {
  try {
    if (typeof message !== "string" || !i18n) return message;
    if (RAW_KEY.test(message.trim())) return i18n.has(message.trim()) ? i18n.localize(message.trim()) : message;   // the system passes some KEYS raw
    const hit = matchKeyless(message);
    if (!hit || !i18n.has(NS + hit.id)) return message;
    return Object.keys(hit.data).length ? i18n.format(NS + hit.id, hit.data) : i18n.localize(NS + hit.id);
  } catch { return message; }
}

function wrapNotifier() {
  const n = globalThis.ui?.notifications;
  if (!n || n.__ipuSysTexts || typeof n.notify !== "function") return !!n?.__ipuSysTexts;
  const notify = n.notify;
  n.notify = function (message, ...rest) { return notify.call(this, translateNotice(message), ...rest); };
  n.__ipuSysTexts = true;
  return true;
}
const sysText = (id) => { const k = NS + id; return game.i18n.has(k) ? game.i18n.localize(k) : null; };
function swapText(root, selector, id) {
  const to = sysText(id), from = DOM_TEXTS[id];
  if (!to || to === from || !root?.querySelectorAll) return;
  for (const el of root.querySelectorAll(selector)) {
    if (el.children.length === 0 && el.textContent.trim() === from) el.textContent = el.textContent.replace(from, to);
  }
}
/** Pure: what the core made of each phrase in this language -> our text. `i18n` needs has / localize / format. */
export function docPhraseMap(i18n) {
  const map = new Map();
  for (const [id, [key, type]] of Object.entries(DOC_PHRASES)) {
    if (!i18n.has(NS + id) || !i18n.has(key)) continue;
    const from = squash(i18n.format(key, { type })), to = i18n.localize(NS + id);
    if (from && to && from !== to) map.set(from, to);
  }
  return map;
}
let docMap = null;
function swapDocPhrases(root) {
  docMap ??= docPhraseMap(game.i18n);
  if (!docMap.size || !root?.querySelectorAll) return;
  for (const el of root.querySelectorAll("a, button, [data-tooltip]")) {
    const tip = el.getAttribute("data-tooltip");                       // the templates break some of these over two lines: compare with the spaces squashed
    if (tip && docMap.has(squash(tip))) el.setAttribute("data-tooltip", docMap.get(squash(tip)));
    for (const n of el.childNodes) if (n.nodeType === 3 && docMap.has(squash(n.nodeValue))) n.nodeValue = n.nodeValue.replace(n.nodeValue.trim(), docMap.get(squash(n.nodeValue)));
  }
  if (game.i18n.has(BLANK_LEVEL.key)) for (const o of root.querySelectorAll('select option[value=""]')) if (o.textContent.trim() === BLANK_LEVEL.text) o.textContent = game.i18n.localize(BLANK_LEVEL.key);
}
const rootOf = (html) => (html instanceof HTMLElement ? html : html?.[0] ?? null);
/* The grade beside an attribute on the system's actor sheet (templates/actor/header.hbs: <div class="attribute {{name}}"> ... <label
   class="graduation">): the template localizes ONE key per grade, so the word cannot agree with the attribute through lang/pl.json. In
   Polish the label is rewritten on render with the agreeing form (terms.mjs gradePl); the key keeps the masculine form for every other use. */
function agreeGrades(app, el) {
  if (game.i18n.lang !== "pl") return;
  const attrs = app?.document?.system?.attributes;
  if (!attrs) return;
  for (const box of el.querySelectorAll(".attribute")) {
    const k = ATTRS.find((a) => box.classList.contains(a)), label = k ? box.querySelector("label.graduation") : null, word = label ? gradePl(attrs[k]?.value, k) : null;
    if (word && label.textContent.trim() !== word) label.textContent = word;
  }
}

/** Called when the module's script loads. That is BEFORE Foundry knows the system (game.system is not there yet), and, because the file
    is imported dynamically, it may also be AFTER the init hook has fired: so start now when the system is known, else on init. */
export function init() {
  if (globalThis.game?.system?.id) start(); else Hooks.once("init", start);
}
let started = false;
function start() {
  if (started || game.system?.id !== SYSTEM) return;
  started = true;
  for (const hook of ["init", "setup", "ready"]) Hooks.once(hook, wrapNotifier);
  wrapNotifier();
  // the roll card: "<li><strong>Condition</strong>: ..." (templates/dice/infos.hbs)
  Hooks.on("renderChatMessageHTML", (_m, html) => { try { swapText(rootOf(html), "li > strong", "condition"); } catch { /* cosmetic */ } });
  // the item sheet's automation rows: label="Extra Configuration" (templates/item/automation-parts/*.hbs); the roll-mode dialog's title
  Hooks.on("renderApplicationV2", (app, element) => {
    try {
      const el = rootOf(element) ?? app?.element;
      if (!el?.classList) return;
      if (el.classList.contains("invincible") && el.classList.contains("item")) swapText(el, "label", "extraConfiguration");
      if (el.classList.contains("invincible")) swapDocPhrases(el);
      if (el.classList.contains("invincible") && el.classList.contains("actor")) agreeGrades(app, el);
      // the name field of every sheet: placeholder='Name' (templates/actor/header.hbs, challenge.hbs, vehicle.hbs, item/header.hbs); "Name" is a literal key of lang/pl.json
      if (el.classList.contains("invincible") && game.i18n.has(NAME_PLACEHOLDER)) for (const inp of el.querySelectorAll(`input[name="name"][placeholder="${NAME_PLACEHOLDER}"]`)) inp.placeholder = game.i18n.localize(NAME_PLACEHOLDER);
      const title = el.querySelector?.(".window-header .window-title");
      if (title && title.textContent.startsWith(TITLE_TYPO)) title.textContent = `Invincible: ${title.textContent.slice(TITLE_TYPO.length)}`;
    } catch { /* cosmetic */ }
  });
  const warn = () => {
    try {
      if (game.i18n.lang === "pl" && game.i18n.localize("INVINCIBLE.Actor.Tabs.Portrait") !== "Portret") {
        console.warn(`${MOD} | The Polish translation of the Invincible system (lang/pl.json) is not loaded: restart the Foundry server once so it reads this module's language list.`);
      }
    } catch { /* nothing to report */ }
  };
  if (game.ready) warn(); else Hooks.once("ready", warn);
}
