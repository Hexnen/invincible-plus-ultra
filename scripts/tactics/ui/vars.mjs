/* Tactical combat, the surfaces: NUMBERS FOR OTHER PARTS OF THE PAGE (perf P2). The dock and the desk measure themselves and tell a few
   elements elsewhere on the page where to stand (the end-of-session notice, the chat toasts, the bar and the
   dock above Dice So Nice). Those numbers used to be custom properties on <body>: a custom property is inherited, so every new value
   restyled ALL the page's elements (about 7 000 - 10 000 with the sidebar and the chat log), 90-190 ms per value on a seat, two or
   three times per redraw of the dock: the redraw hitch of a turn change. Here each number is a declaration in ONE constructed style
   sheet, on the elements that read it (`USERS`), so a new value restyles those few elements only (1-3 ms). Same values, same var()
   names, same fallbacks in styles/*.css: nothing on screen changes. An unchanged value is not written at all.
   Without constructed style sheets (an old browser) the old way is kept: the property on <body>. Plain DOM, no Foundry globals. */

/** which elements read each number (the selectors of the rules in styles/*.css that use it) */
export const USERS = Object.freeze({
  "--itd-clear": ".ips-notice",                                           // tactics-ui.css: the end-of-session notice above the dock
  "--igd-toast-maxh": "#chat-notifications .overflow",                    // tactics-ui.css (U6): the chat toasts' strip under the open desk
  "--ita-dice-z": "#invincible-combat-bar, #invincible-tactics-dock",      // combat.css / tactics-ui.css (U108): above Dice So Nice's canvas
  "--its-nt": ".ips-notice",                                              // tactics-slots.css (U132 trial): the notice's own place, its top
  "--its-nx": ".ips-notice",                                              // ... and its middle
});

let sheet = null, failed = false;
const rules = new Map();                 // name -> CSSStyleRule
const values = new Map();                // name -> the value written last ("" = none)

function own(doc) {
  if (failed) return null;
  try {
    if (!sheet) {
      if (typeof CSSStyleSheet !== "function" || !Array.isArray(doc.adoptedStyleSheets)) { failed = true; return null; }
      sheet = new CSSStyleSheet();
    }
    /* another script may have replaced the document's list: ours goes back at the end (it then wins ties, as the body's own style did) */
    if (!doc.adoptedStyleSheets.includes(sheet)) doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
    return sheet;
  } catch { failed = true; return null; }
}
function ruleOf(s, name) {
  let r = rules.get(name);
  if (r && [...s.cssRules].includes(r)) return r;
  const i = s.insertRule(`${USERS[name]} {}`, s.cssRules.length);
  r = s.cssRules[i]; rules.set(name, r);
  return r;
}
/** set (value a string) or remove (value null / "") one number; -> true when something was written */
export function setVar(name, value, doc = globalThis.document) {
  const v = value === null || value === undefined ? "" : String(value);
  if (!doc || values.get(name) === v) return false;
  values.set(name, v);
  const s = USERS[name] ? own(doc) : null;
  try {
    if (!s) { if (v) doc.body?.style.setProperty(name, v); else doc.body?.style.removeProperty(name); return true; }
    const r = ruleOf(s, name);
    if (v) r.style.setProperty(name, v); else r.style.removeProperty(name);
  } catch { /* the number stays as it was: the element keeps its fallback */ }
  return true;
}
/** what was written last (tests, a look from the console) */
export const varOf = (name) => values.get(name) ?? "";
/** for the node checks: forget everything */
export function _reset() { sheet = null; failed = false; rules.clear(); values.clear(); }
