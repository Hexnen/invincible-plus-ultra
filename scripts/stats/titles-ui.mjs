/* Plus Ultra STATISTICS, THE TITLES OF A FIGHT (package AWRD) in the statistics window: the section under a fight's summary (registered
   on api.stats.fightSections, app.mjs FIGHT SECTIONS) and the strip of titles a character or a player collected. Plain DOM; the model is
   titles-pure.cardOf / chipsOf, so the window says exactly what the end-of-fight card said. Styles: styles/stats.css "titles". */
import * as TP from "./titles-pure.mjs";

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === null || v === undefined || v === false) continue; if (k === "class") el.className = v; else if (k === "text") el.textContent = v; else el.setAttribute(k, v === true ? "" : String(v)); }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
};
const icon = (fa) => h("i", { class: `fa-solid ${fa}`, "aria-hidden": "true" });
function face(img, name) {
  const box = h("span", { class: "ipu-aw-face", "aria-hidden": "true" });
  const letter = () => { box.textContent = [...String(name ?? "?")][0]?.toUpperCase() ?? "?"; };
  if (img) { const i = h("img", { src: img, alt: "", loading: "lazy" }); i.addEventListener("error", () => { i.remove(); letter(); }); box.append(i); } else letter();
  return box;
}

/** the fight section: fn({ rec, rows, titles, gm, t }) -> HTMLElement */
export function fightSection({ rec, gm, t }) {
  const m = TP.cardOf(rec, { gm }, t);
  const head = h("h3", { class: "ipu-aw-h" }, icon("fa-trophy"), h("span", { text: t("IPU.Awrd.collected") }));
  if (m.state !== "ok") return h("div", { class: "ipu-aw", "data-state": m.state }, head, h("p", { class: "ipu-aw-note", text: t(m.state === "small" ? "IPU.Awrd.small" : m.state === "none" ? "IPU.Awrd.none" : "IPU.Awrd.waitGm") }));
  const mvp = m.mvp.map((x) => h("div", { class: "ipu-aw-mvp", "aria-label": `${x.name}: ${x.who.n}. ${x.why}` },
    h("span", { class: "ipu-aw-burst", "aria-hidden": "true" }, face(x.who.i, x.who.n)),
    h("div", { class: "ipu-aw-mvp-t" }, h("span", { class: "ipu-aw-mvp-k", "data-tooltip": x.tip, text: x.name }), h("b", { text: x.who.n }), h("small", { text: x.why }))));
  const list = h("ul", { class: "ipu-aw-list" }, m.list.map((x) => h("li", { class: "ipu-aw-row", "data-id": x.id, "aria-label": `${x.name}: ${x.who.n}. ${x.why}` },
    h("span", { class: "ipu-aw-badge", "data-id": x.id, "data-tooltip": x.tip, "aria-hidden": "true" }, icon(x.icon)),
    h("span", { class: "ipu-aw-t" }, h("span", { class: "ipu-aw-name", text: x.name }), h("small", { text: x.why })),
    h("span", { class: "ipu-aw-who" }, face(x.who.i, x.who.n), h("span", { text: x.who.n })))));
  return h("div", { class: "ipu-aw", "data-state": "ok" }, head, mvp, m.list.length ? list : null);
}

/** the titles a character or a player collected: [{ id, icon, n, label, tip }] -> a strip, or null */
export function collectedStrip(items, t) {
  if (!items?.length) return null;
  return h("div", { class: "ipu-aw-got", role: "list", "aria-label": t("IPU.Awrd.collected") },
    h("span", { class: "ipu-st-chips-t", text: t("IPU.Awrd.collected") }),
    items.map((x) => h("span", { class: "ipu-aw-chip", role: "listitem", "data-id": x.id, "data-tooltip": x.tip, "aria-label": `${x.label}: ${x.n}` },
      h("span", { class: "ipu-aw-badge", "data-id": x.id, "aria-hidden": "true" }, icon(x.icon)), h("span", { text: x.label }), h("b", { text: t("IPU.Awrd.times", { n: x.n }) }))));
}
