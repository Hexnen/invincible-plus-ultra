/* End-of-session panel, phase S3: the view when NO review is running. A player sees one calm sentence; the GM sees the roster picker (heroes owned by a player are
   ticked, any other hero can be ticked too) and the Start button. The ticks live in this view (a Map) so a repaint caused by a world update never loses them. */
import { t } from "../lang.mjs";
import { LIMITS } from "../pure.mjs";
import { el, icon, setText, setAttr, setHidden, portrait, updatePortrait } from "./dom.mjs";

export function createStart() {
  const root = el("div", "ips-view ips-view-start");
  const head = el("h3", "ips-start-h", { tabindex: "-1", "data-focus-first": "1" }, t("IPL.Session.UI.Start.none"));
  const player = el("p", "ips-start-p ips-start-player", t("IPL.Session.UI.Start.player"));
  const lede = el("p", "ips-start-p ips-start-gm", t("IPL.Session.UI.Start.gm"));
  const legend = el("legend", "ips-rlegend", t("IPL.Session.UI.Start.pick"));
  const list = el("ul", "ips-picklist");
  const empty = el("p", "ips-note", t("IPL.Session.UI.Start.empty"));
  const count = el("p", "ips-count");
  const bad = el("label", "ips-check", { title: t("IPL.Session.UI.BadTip") }, el("input", "", { type: "checkbox", name: "askBad", "data-fk": "askBad" }), el("span", "", t("IPL.Session.UI.Bad")));
  const go = el("button", "ips-btn ips-btn-primary", { type: "button", "data-ips": "start", "data-fk": "start" }, icon("fa-solid fa-flag-checkered"), el("span", "", t("IPL.Session.UI.Start.go")));
  const pick = el("fieldset", "ips-roster ips-pick", {}, legend, list, empty, count);
  const actions = el("div", "ips-start-actions", bad, go);
  root.append(head, player, lede, pick, actions);
  const checked = new Map();          // hero id -> boolean, kept across repaints
  let sig = "";

  const selected = () => [...list.querySelectorAll('input[type="checkbox"]:checked')].map((i) => i.value);
  const refreshCount = () => { const n = selected().length; setText(count, t("IPL.Session.UI.Start.count", { n, max: LIMITS.heroes })); setAttr(go, "aria-disabled", n ? null : "true"); };
  list.addEventListener("change", (ev) => {
    const i = ev.target;
    if (i instanceof HTMLInputElement) { checked.set(i.value, i.checked); refreshCount(); }
  });

  return {
    el: root,
    selected,
    askBad: () => bad.querySelector("input").checked,
    /** vm + candidates = [{ id, name, img, def }] */
    patch(vm, candidates = []) {
      const gm = vm.staff;
      setHidden(player, gm); setHidden(lede, !gm); setHidden(pick, !gm); setHidden(actions, !gm);
      if (!gm) return;
      const s = JSON.stringify(candidates.map((c) => [c.id, c.name, c.img, c.def]));
      if (s !== sig) {
        sig = s;
        for (const c of candidates) if (!checked.has(c.id)) checked.set(c.id, !!c.def);
        list.replaceChildren(...candidates.map((c) => {
          const input = el("input", "", { type: "checkbox", value: c.id, name: `h-${c.id}`, "data-fk": `h-${c.id}` });
          input.checked = checked.get(c.id) === true;
          const lab = el("label", "ips-pick-row", {}, input, portrait(c.img), el("span", "ips-pick-name", c.name), el("span", "ips-chip", { "data-group": c.def ? "good" : "other" }, t(c.def ? "IPL.Session.UI.Start.default" : "IPL.Session.UI.Start.other")));
          return el("li", "", {}, lab);
        }));
      }
      setHidden(empty, candidates.length > 0);
      refreshCount();
    }
  };
}
