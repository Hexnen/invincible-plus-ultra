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

/* ---------- THE MARKS (ledger U86 / U93; drawn by styles/kit.css) ----------
   ONE LANGUAGE for every surface. What a thing costs in time, when it is taken, what it costs in stress, and the things that used to
   stand as words (Health, damage, Armor, range, dice, successes, pushing, a critical injury, a condition) are DRAWN; the name of a
   mark is said in the tooltip and to a screen reader, never as a word beside it. The bar is the unit:
     full   a long slanted bar        quick  a short bar            turn  both bars (the whole turn)      long  a bar and a chevron pair
     none   an open diamond           gm     a question mark        out   a hooked arrow, alone or before the bar it is paid with
     stress a bolt on the colour of Resolve, with its number
   A surface never draws a variant of its own. It calls:
     costMark(kind, { out, off, name }) / costMarkHtml(...)   kind: full | quick | turn | long | none | gm | out; out: taken out of turn;
                                                              off: a slot that is spent (the same shape, hollow: never by colour alone)
     stressMark(n, { name }) / stressMarkHtml(...)            the price in stress: the mark with its number (no number: "some stress")
     symMark(kind, { n, glyph, name }) / symMarkHtml(...)     kind: one of SYM_KINDS; n: the number (or text such as "+2") after the mark;
                                                              glyph: for "cond", the Font Awesome class of that condition
   NAMING. A mark is silent (aria-hidden) when what carries it says its name (a button's tooltip and aria-label). A mark that stands by
   itself is given `name`: it then is role="img" with that aria-label and opens that tooltip. `name: true` takes the mark's own name
   (markName) with the number after it.
   INLINE. A sentence may hold a mark as a token: "[[dice:6]]", "[[stress:1]]", "[[full]]". rich(text) gives the nodes, richHtml(text) the
   escaped HTML (a tooltip), plain(text) the words (an aria-label, a notification, anything that cannot draw). */
import * as P from "./kit-signs-pure.mjs";      // U100: the pure core (kinds, classes, names, the map's signs), shared with the tactics models
export const { COST_KINDS, SYM_KINDS, costClasses } = P;
const { KIND, SYM_FA, numOf } = P;
const LANG = () => globalThis.game?.i18n?.lang ?? "en";
/** the name of a mark in the reader's language (kit-lang.mjs) */
export const markName = (kind, lang = LANG()) => P.markName(kind, lang);
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
/** what a mark with a number says: "Stress: 1", "Extra damage: +2", "Dice: 6" ("extra" damage is the damage mark with a number that starts with "+") */
export const markSay = (kind, n = null, lang = LANG()) => P.markSay(kind, n, lang);
const named = (name, kind, n) => { const say = name === true ? markSay(kind, n) : name ? String(name) : null; return say ? ` role="img" aria-label="${esc(say)}" data-tooltip="${esc(say)}"` : ' aria-hidden="true"'; };
export function costMarkHtml(kind, o = {}) {
  const c = costClasses(kind, o), k = KIND(kind);
  if (!c.length) return "";
  const at = named(o.name === true ? (c.length > 1 ? markName(k === "full" ? "outFull" : "outQuick") : markName(k)) : o.name, k, null);
  return c.length > 1 ? `<span class="ipu-costs"${at}>${c.map((x) => `<i class="${x}"></i>`).join("")}</span>` : `<i class="${c[0]}"${at}></i>`;
}
export function stressMarkHtml(n = null, o = {}) {
  const num = Number.isFinite(Number(n)) && n !== null && n !== "" ? String(Math.abs(Number(n))) : "";
  return `<b class="ipu-stress"${named(o.name, "stress", num)}><i class="ipu-cost ipu-k-stress"></i>${num}</b>`;
}
/* Font Awesome draws some (the pictures the interface already had: kit-signs-pure.mjs SYM_FA); kit.css draws the rest as masks (range, Armor) */
export function symMarkHtml(kind, { n = null, glyph = null, name = null } = {}) {
  if (!SYM_KINDS.includes(kind)) return "";
  const fa = kind === "cond" ? glyph : SYM_FA[kind], k = kind === "pierce" ? "armor" : kind;
  const pic = fa ? `<i class="ipu-sym-g fa-solid ${String(fa).replace(/[^a-z0-9 -]/gi, "")}"></i>` : `<i class="ipu-sym-g ipu-cost ipu-k-${k}"></i>`;
  const num = numOf(n);
  return `<span class="ipu-sym ipu-s-${kind}"${named(name, kind, num)}>${kind === "pierce" ? `<span class="ipu-cut">${pic}</span>` : pic}${num ? `<b>${num}</b>` : ""}</span>`;
}
/* U100: a mark as the PIECES the map module draws (moinen-maps zones-api.md section 40), in the reader's language: kit-signs-pure.mjs */
export const markSigns = (kind, o = {}) => P.markSigns(kind, { lang: LANG(), ...o });
const toEl = (html) => { if (!html || typeof document === "undefined") return null; const t = document.createElement("template"); t.innerHTML = html; return t.content.firstElementChild; };
export const costMark = (kind, o = {}) => toEl(costMarkHtml(kind, o));
export const stressMark = (n = null, o = {}) => toEl(stressMarkHtml(n, o));
export const symMark = (kind, o = {}) => toEl(symMarkHtml(kind, o));

/* ---- a mark inside a sentence: [[kind]] or [[kind:n]] ---- */
const TOKEN = /\[\[([a-z]+)(?::([^\]\[]{0,12}))?\]\]/g;
const tokenHtml = (kind, n, name) => (kind === "stress" ? stressMarkHtml(n, { name }) : SYM_KINDS.includes(kind) ? symMarkHtml(kind, { n, name }) : KIND(kind) ? costMarkHtml(kind, { name }) : "");
export const hasMarks = (text) => typeof text === "string" && text.includes("[[");
/** the sentence as words: every token says its name ("Dice: 6") */
export const plain = (text, lang) => String(text ?? "").replace(TOKEN, (m, k, n) => (tokenHtml(k, n, null) ? markSay(k, n ?? null, lang) : m));
/** the sentence as escaped HTML, its tokens drawn; each mark names itself (tooltip, screen reader) unless `silent` */
export function richHtml(text, { silent = false } = {}) {
  const s = String(text ?? ""); let out = "", at = 0;
  for (const m of s.matchAll(TOKEN)) { const html = tokenHtml(m[1], m[2] ?? null, silent ? null : true); out += esc(s.slice(at, m.index)) + (html || esc(m[0])); at = m.index + m[0].length; }
  return out + esc(s.slice(at));
}
/** the sentence as DOM nodes (text and marks) */
export function rich(text, o = {}) {
  if (typeof document === "undefined") return [];
  const t = document.createElement("template"); t.innerHTML = richHtml(text, o);
  return [...t.content.childNodes];
}

/* ---- THE LEGEND: every mark with its name, in the order a player meets them (legendHtml draws it; the dock opens it) ---- */
export const LEGEND = Object.freeze([
  { group: "time", rows: [["full", () => costMarkHtml("full")], ["quick", () => costMarkHtml("quick")], ["turn", () => costMarkHtml("turn")], ["long", () => costMarkHtml("long")], ["none", () => costMarkHtml("none")],
    ["gm", () => costMarkHtml("gm")], ["out", () => costMarkHtml("out")], ["outQuick", () => costMarkHtml("quick", { out: true })], ["outFull", () => costMarkHtml("full", { out: true })], ["spent", () => `<span class="ipu-costs" aria-hidden="true">${costMarkHtml("full", { off: true })}${costMarkHtml("quick", { off: true })}</span>`]] },
  { group: "things", rows: [["stress", () => stressMarkHtml(1)], ["health", () => symMarkHtml("health", { n: 9 })], ["damage", () => symMarkHtml("damage", { n: 3 })], ["extra", () => symMarkHtml("damage", { n: "+2" })],
    ["armor", () => symMarkHtml("armor", { n: 2 })], ["pierce", () => symMarkHtml("pierce")], ["range", () => symMarkHtml("range", { n: 0 })], ["rmin", () => symMarkHtml("rmin", { n: 1 })], ["rmax", () => symMarkHtml("rmax", { n: 3 })]] },
  { group: "roll", rows: [["dice", () => symMarkHtml("dice", { n: 6 })], ["six", () => symMarkHtml("six", { n: 2 })], ["push", () => symMarkHtml("push")], ["crit", () => symMarkHtml("crit")],
    ["cond", () => symMarkHtml("cond", { glyph: "fa-face-dizzy" }) + symMarkHtml("cond", { glyph: "fa-hands-holding" })]] },
]);
export function legendHtml(lang = globalThis.game?.i18n?.lang ?? "en") {
  const col = (g) => `<div class="ipu-legend-col"><h4 class="ipu-legend-h">${esc(markName(`legend.${g.group}`, lang))}</h4><dl>${g.rows.map(([id, draw]) => `<div class="ipu-legend-row"><dt>${draw()}</dt><dd>${esc(markName(id, lang))}</dd></div>`).join("")}</dl></div>`;
  return `<div class="ipu-legend">${LEGEND.map(col).join("")}</div>`;
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
