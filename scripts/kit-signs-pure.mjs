/* THE MARKS, their pure core (ledger U86 / U93 / U100). NO Foundry or browser globals: the tactics surfaces' pure models (node-tested,
   check-pure.mjs) build the map's signs from here. scripts/kit.mjs re-exports everything below and adds the drawing as HTML and DOM, the
   inline tokens, the legend and the reader's language from Foundry. One set of kinds, one set of class names, one set of pictures.
     COST_KINDS, SYM_KINDS, costClasses(kind, { out, off })      what kit.css draws, by class
     markName(kind, lang), markSay(kind, n, lang)                the names (kit-lang.mjs); `lang` always given here
     markSigns(kind, { n, out, off, name, glyph, lang })         U100: one mark as the PIECES the map module draws where it draws a text
                                                                 (moinen-maps zones-api.md section 40, "signs"), see below */
import { MARK_EN, MARK_PL } from "./kit-lang.mjs";
import { MARK_SVG } from "./kit-marks.mjs";

export const COST_KINDS = Object.freeze(["full", "quick", "turn", "long", "none", "gm", "out", "stress"]);
export const SYM_KINDS = Object.freeze(["health", "damage", "armor", "pierce", "rmin", "rmax", "range", "dice", "six", "push", "crit", "cond"]);
export const KIND = (k) => (k === "free" ? "none" : COST_KINDS.includes(k) ? k : null);
/* Font Awesome draws these (the pictures the interface already had); kit.css draws the rest as masks (range, Armor) */
export const SYM_FA = Object.freeze({ health: "fa-heart", damage: "fa-burst", dice: "fa-dice-d6", six: "fa-dice-six", push: "fa-arrows-rotate", crit: "fa-bone" });
export const numOf = (n) => (n === null || n === undefined || n === "" ? "" : String(n).replace(/[<>&"']/g, ""));
/** the name of a mark in `lang` (kit-lang.mjs) */
export function markName(kind, lang = "en") {
  const k = kind === "free" ? "none" : kind, T = String(lang).startsWith("pl") ? MARK_PL : MARK_EN;
  return T[k] ?? MARK_EN[k] ?? String(kind ?? "");
}
/** what a mark with a number says: "Stress: 1", "Extra damage: +2", "Dice: 6" ("extra" damage is the damage mark with a number that starts with "+") */
export function markSay(kind, n = null, lang = "en") {
  const num = numOf(n), k = kind === "damage" && num.startsWith("+") ? "extra" : kind;
  return num ? `${markName(k, lang)}: ${num}` : markName(k, lang);
}
/* pure: the class names of the mark(s) of one cost, first to last (out of turn: the hook, then the action's bar) */
export function costClasses(kind, { out = false, off = false } = {}) {
  const k = KIND(kind);
  if (!k) return [];
  const one = (x, more = "") => `ipu-cost ipu-k-${x}${more}`;
  if (off && (k === "full" || k === "quick")) return [one(k, " ipu-off")];
  if (!out || !(k === "full" || k === "quick")) return [one(k)];
  return [one("out"), one(k)];
}

/* ---- U100: A MARK WHERE THE MAP DRAWS. The map draws a caller's sign without knowing what it means: `el` is the SAME drawing as kit.mjs
   costMarkHtml / stressMarkHtml / symMarkHtml (a tree of i / b / span with the kit's classes, so kit.css gives it its look:
   check-marks.mjs section E renders it the map's way and compares), `img` + `w` the same picture for the map's canvas labels
   (kit-marks.mjs, generated with kit.css), `icon` the Font Awesome picture where the kit uses one, `color` its colour there.
   Returns the PIECES of one mark: two signs for an action taken out of turn (the hook, then the bar; the pair is named on the first).
   `name` as in the HTML builders (true: the mark's own name in `lang`). */
export const SIGN_INK = Object.freeze({ cost: 0xffe72a, stress: 0x3bb8e8 });          // --ipu-yellow, --ipu-cyan-lt (check-marks E)
const picOf = (k) => (MARK_SVG[k] ? { img: MARK_SVG[k].uri, w: MARK_SVG[k].w } : {});
export function markSigns(kind, { n = null, out = false, off = false, name = null, glyph = null, lang = "en" } = {}) {
  const sayOf = (k, num) => (name === true ? markSay(k, num, lang) : name ? String(name) : null);
  if (kind === "stress") {
    const num = Number.isFinite(Number(n)) && n !== null && n !== "" ? String(Math.abs(Number(n))) : "";
    return [{ name: sayOf("stress", num), el: { tag: "b", cls: "ipu-stress", kids: [{ tag: "i", cls: "ipu-cost ipu-k-stress" }], ...(num ? { text: num } : {}) }, ...picOf("stress"), ...(num ? { n: num } : {}), color: SIGN_INK.stress }];
  }
  if (SYM_KINDS.includes(kind)) {
    const fa = kind === "cond" ? glyph : SYM_FA[kind], k = kind === "pierce" ? "armor" : kind, num = numOf(n);
    const pic = fa ? { tag: "i", cls: `ipu-sym-g fa-solid ${String(fa).replace(/[^a-z0-9 -]/gi, "")}` } : { tag: "i", cls: `ipu-sym-g ipu-cost ipu-k-${k}` };
    const el = { tag: "span", cls: `ipu-sym ipu-s-${kind}`, kids: [kind === "pierce" ? { tag: "span", cls: "ipu-cut", kids: [pic] } : pic, ...(num ? [{ tag: "b", text: num }] : [])] };
    return [{ name: sayOf(kind, num), el, ...(fa ? { icon: `fa-solid ${fa}` } : picOf(k)), ...(num ? { n: num } : {}), color: SIGN_INK.cost }];
  }
  const c = costClasses(kind, { out, off }), k = KIND(kind);
  if (!c.length) return [];
  const say = name === true ? (c.length > 1 ? markName(k === "full" ? "outFull" : "outQuick", lang) : markName(k, lang)) : name ? String(name) : null;
  return c.map((cls, i) => { const kk = cls.match(/ipu-k-([a-z]+)/)[1], hollow = cls.includes("ipu-off"); return { name: i === 0 ? say : null, el: { tag: "i", cls }, ...picOf(hollow ? `${kk}-off` : kk), color: SIGN_INK.cost }; });
}
