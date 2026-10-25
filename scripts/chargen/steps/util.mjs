/* Small helpers shared by the wizard shell and every step module (no state, no Foundry writes).
   Step modules: import what they need from here instead of re-implementing it. */
import { t } from "../lang.mjs";
import { ATTRS } from "../rules.mjs";

/** HTML-escape a value for a template string */
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** localised attribute name; the SYSTEM label wins (the sheet shows it), our own table is the fallback */
export function attrLabel(k) {
  const key = `INVINCIBLE.Actor.base.FIELDS.attributes.${k}.label`;
  try { if (globalThis.game?.i18n?.has(key)) return game.i18n.localize(key); } catch { /* fall through */ }
  return t(`IPC.Attr.${k}`);
}
/** three-letter tag of an attribute, taken from the same label the sheet shows (FIG, AGI ...) */
export const attrShort = (k) => attrLabel(k).replace(/[^\p{L}]/gu, "").slice(0, 3).toUpperCase();
export const rankName = (k) => t(`IPC.Rank.${k}`);
export const levelName = (n) => t(`IPC.Level.${["basic", "major", "massive", "monstrous"][n] ?? "basic"}`);

/** text of a rules / plan message: rule issues carry a key + params, apply messages carry a ready localised text */
export function msgText(m) {
  if (!m) return "";
  if (typeof m.key === "string" && m.key.startsWith("IPC.Rule.")) {
    const params = { ...(m.params ?? {}) };
    if (params.attr) params.attr = attrLabel(params.attr);
    if (params.rank) params.rank = rankName(params.rank);
    return t(m.key, params);
  }
  return m.message ?? m.key ?? "";
}

/** delegated listener: handler(event, matchedElement) */
export function delegate(root, type, selector, handler) {
  root.addEventListener(type, (ev) => {
    const el = ev.target instanceof Element ? ev.target.closest(selector) : null;
    if (el && root.contains(el)) handler(ev, el);
  });
}

/** icon markup (FontAwesome, decorative) */
export const icon = (cls) => `<i class="${esc(cls)}" aria-hidden="true"></i>`;

/** HTML of a <dl> from rows [{label, value, empty}] (value is plain text, escaped here) */
export function dl(rows, cls = "ipc-dl") {
  return `<dl class="${cls}">${rows.map((r) => `<div class="ipc-dl-row${r.empty ? " ipc-empty" : ""}"><dt>${esc(r.label)}</dt><dd>${r.empty ? esc(t("IPC.Summary.None")) : esc(r.value)}</dd></div>`).join("")}</dl>`;
}

export { ATTRS };
