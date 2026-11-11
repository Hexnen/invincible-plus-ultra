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

/* ---------- THE MARKS OF COST (ledger U86; drawn by styles/kit.css) ----------
   One piece for every surface: what a thing costs in time (a full action, a quick one, the whole turn, longer than a turn, no action, a
   price the GM names), when it is taken (out of turn: an interrupt) and what it costs in stress. A surface never writes the cost as a word
   beside the thing: it draws the mark, and the mark's NAME goes to the tooltip and the aria-label of whatever carries it.
     costMark(kind, { out, v })      -> an element (the DOM surfaces)        kind: one of COST_KINDS except "stress"; out: taken out of turn
     costMarkHtml(kind, { out, v })  -> the same as a string (tooltips; classes only, so Foundry's cleaning keeps it)
     stressMark(n, { v }) / stressMarkHtml(n, { v })   the price in stress: the mark with its number (no number: "some stress")
   U86-SCAFFOLD: `v` and costVersion() exist only while three versions are compared (stage 1). Stage 2 drops the parameter, the version
   class and costVersion(); every caller then draws the one set unconditionally. */
export const COST_KINDS = Object.freeze(["full", "quick", "turn", "long", "none", "gm", "out", "stress"]);
export const COST_VERSIONS = Object.freeze(["a", "b", "c"]);      // U86-SCAFFOLD
const U86_KEY = "ipu.u86";                                         // U86-SCAFFOLD
/** U86-SCAFFOLD: the version this browser compares ("a" | "b" | "c"), or null: the interface as it is today */
export function costVersion() { try { const v = globalThis.localStorage?.getItem(U86_KEY); return COST_VERSIONS.includes(v) ? v : null; } catch { return null; } }
const KIND = (k) => (k === "free" ? "none" : COST_KINDS.includes(k) ? k : null);
/* pure: the class names of the mark(s) of one cost, first to last. Version b has no mark of its own for "out of turn": the action's
   slice stands alone, out of the dial; the other versions put the out-of-turn mark before the action's. */
export function costClasses(kind, { out = false, v = costVersion() } = {}) {
  const k = KIND(kind);
  if (!k || k === "stress" || !COST_VERSIONS.includes(v)) return [];
  const one = (x, more = "") => `ipu-cost ipu-cost-${v} ipu-k-${x}${more}`;
  if (k === "out") return [one("out")];
  if (!out || !(k === "full" || k === "quick")) return [one(k)];
  return v === "b" ? [one(k, " ipu-out")] : [one("out"), one(k)];
}
export function costMarkHtml(kind, o = {}) {
  const c = costClasses(kind, o);
  return c.length > 1 ? `<span class="ipu-costs">${c.map((x) => `<i class="${x}"></i>`).join("")}</span>` : c.length ? `<i class="${c[0]}"></i>` : "";
}
export function stressMarkHtml(n = null, { v = costVersion() } = {}) {
  if (!COST_VERSIONS.includes(v)) return "";
  const num = Number.isFinite(Number(n)) && n !== null && n !== "" ? String(Math.abs(Number(n))) : "";
  return `<b class="ipu-stress"><i class="ipu-cost ipu-cost-${v} ipu-k-stress"></i>${num}</b>`;
}
const toEl = (html) => { if (!html || typeof document === "undefined") return null; const t = document.createElement("template"); t.innerHTML = html; const el = t.content.firstElementChild; el?.setAttribute("aria-hidden", "true"); return el; };
export const costMark = (kind, o = {}) => toEl(costMarkHtml(kind, o));
export const stressMark = (n = null, o = {}) => toEl(stressMarkHtml(n, o));

/* THE MARKS OF THINGS (second part of U86): Health, damage, Armor, range, dice, successes, pushing, a critical injury, a condition.
     symMark(kind, { n, v, glyph }) / symMarkHtml(...)   kind: one of SYM_KINDS; n: the number (or text such as "+2", "0-2") written after
                                                          the mark; glyph: for "cond", the Font Awesome class of that condition
   Where the interface already had a picture (the heart of Health, the burst of damage dealt, the die, each condition's own picture) the
   sets keep it; a version draws its own only where SYM_FA has no entry for it (then styles/kit.css has a mask for that kind).
   "Extra" damage is the damage mark with a number that starts with "+"; "ignores Armor" (pierce) is the Armor mark cut through. */
export const SYM_KINDS = Object.freeze(["health", "damage", "armor", "pierce", "rmin", "rmax", "dice", "six", "push", "crit", "cond"]);
const SYM_FA = {      // U86-SCAFFOLD: three tables; stage 2 keeps one
  a: { health: "fa-heart", damage: "fa-burst", armor: "fa-shield", pierce: "fa-shield", dice: "fa-dice-d6", six: "fa-dice-six", push: "fa-arrows-rotate", crit: "fa-bone" },
  b: { health: "fa-heart", damage: "fa-burst", armor: "fa-vest", pierce: "fa-vest", dice: "fa-dice-d6", six: "fa-star", push: "fa-repeat", crit: "fa-bandage" },
  c: {},
};
export function symMarkHtml(kind, { n = null, v = costVersion(), glyph = null } = {}) {
  if (!SYM_KINDS.includes(kind) || !COST_VERSIONS.includes(v)) return "";
  const fa = kind === "cond" ? glyph : SYM_FA[v][kind], k = kind === "pierce" && !fa ? "armor" : kind;
  const pic = fa ? `<i class="ipu-sym-g fa-solid ${String(fa).replace(/[^a-z0-9 -]/gi, "")}"></i>` : `<i class="ipu-sym-g ipu-cost ipu-cost-${v} ipu-k-${k}"></i>`;
  const num = n === null || n === undefined || n === "" ? "" : `<b>${String(n).replace(/[<>&"']/g, "")}</b>`;
  return `<span class="ipu-sym ipu-sym-${v} ipu-s-${kind}">${kind === "pierce" ? `<span class="ipu-cut">${pic}</span>` : pic}${num}</span>`;
}
export const symMark = (kind, o = {}) => toEl(symMarkHtml(kind, o));

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
