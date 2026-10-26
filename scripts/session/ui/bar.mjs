/* End-of-session panel, phase S3: the GM BAR (staff only), pinned to the bottom of the window. Its buttons depend on where the review is (a question, the summary
   before / after closing, awarded), so the set is rebuilt only when that "place" changes; the labels and states are patched in place. A rebuild keeps focus on
   the control with the same data-fk. One primary button per place (yellow), everything else white. */
import { t } from "../lang.mjs";
import { el, icon, setText, setAttr, setHidden, keepFocus } from "./dom.mjs";

const btn = (act, label, ic, extra = {}) => el("button", `ips-btn${extra.primary ? " ips-btn-primary" : ""}${extra.danger ? " ips-btn-danger" : ""}`,
  { type: "button", "data-ips": act, "data-fk": extra.fk ?? act, title: extra.tip ?? label, "aria-disabled": extra.disabled ? "true" : null }, icon(ic), el("span", "ips-btn-t", label));

export function placeOf(vm) {
  if (vm.view === "question") return vm.index >= vm.total - 1 ? "q-last" : "q";
  return vm.state === "awarded" ? "awarded" : vm.state === "closed" ? "closed" : "summary";
}

export function createBar() {
  const root = el("div", "ips-bar", { role: "toolbar", "aria-label": t("IPL.Session.UI.GmBar") });
  const left = el("div", "ips-bar-l"), right = el("div", "ips-bar-r");
  root.append(left, right);
  let place = "", staff = null;

  const more = () => {
    const toggle = el("button", "ips-btn", { type: "button", "data-ips": "more", "data-fk": "more", "aria-expanded": "false", "aria-controls": "ips-menu" }, icon("fa-solid fa-ellipsis"), el("span", "ips-btn-t", t("IPL.Session.UI.More")));
    const item = (act, label, ic, danger) => el("button", `ips-menu-i${danger ? " is-danger" : ""}`, { type: "button", "data-ips": act, "data-fk": `m-${act}` }, icon(ic), el("span", "", label));
    const menu = el("div", "ips-menu", { id: "ips-menu", hidden: true });
    if (place === "q" || place === "q-last") {
      menu.append(item("toSummary", t("IPL.Session.UI.ToSummary"), "fa-solid fa-list-check"));
      const bad = el("button", "ips-menu-i ips-bad", { type: "button", role: "switch", "data-ips": "bad", "data-fk": "bad", "aria-checked": "false", title: t("IPL.Session.UI.BadTip") },
        el("span", "ips-sw-box ips-bad-box", icon("fa-solid fa-check")), el("span", "", t("IPL.Session.UI.Bad")));
      menu.append(bad);
    }
    if (place !== "awarded") menu.append(item("addHero", t("IPL.Session.UI.Add"), "fa-solid fa-user-plus"), item("removeHero", t("IPL.Session.UI.Remove"), "fa-solid fa-user-minus"), item("discard", t("IPL.Session.UI.Discard"), "fa-solid fa-trash", true));
    return el("div", "ips-more", {}, toggle, menu);
  };

  function rebuild() {
    left.replaceChildren(); right.replaceChildren();
    if (place === "q" || place === "q-last") {
      left.append(btn("prev", t("IPL.Session.UI.Back"), "fa-solid fa-chevron-left"),
        btn("lean", t("IPL.Session.UI.Lean"), "fa-solid fa-thumbs-up", { tip: t("IPL.Session.UI.LeanTip") }),
        more());
      right.append(btn("next", t(place === "q-last" ? "IPL.Session.UI.ToSummary" : "IPL.Session.UI.Next"), "fa-solid fa-chevron-right", { primary: true }));
      right.firstChild.append(right.firstChild.firstChild);                       // icon after the label for a forward action
    } else if (place === "summary") {
      left.append(btn("prev", t("IPL.Session.UI.Back"), "fa-solid fa-chevron-left"), more());
      right.append(btn("award", t("IPL.Session.UI.Award"), "fa-solid fa-trophy", { primary: true }));
    } else if (place === "closed") {
      left.append(btn("reopen", t("IPL.Session.UI.Reopen"), "fa-solid fa-lock-open"), more());
      right.append(btn("award", t("IPL.Session.UI.Award"), "fa-solid fa-trophy", { primary: true }));
    } else if (place === "awarded") {
      left.append(btn("undo", t("IPL.Session.UI.Undo"), "fa-solid fa-rotate-left", { danger: true }), btn("postChat", t("IPL.Session.UI.PostChat"), "fa-solid fa-comment"));
      right.append(btn("dismiss", t("IPL.Session.UI.Dismiss"), "fa-solid fa-box-archive", { primary: true }));
    }
  }

  return {
    el: root,
    menuOpen: () => !!root.querySelector(".ips-menu:not([hidden])"),
    toggleMenu(force) {
      const toggle = root.querySelector('[data-ips="more"]'), menu = root.querySelector(".ips-menu");
      if (!toggle || !menu) return false;
      const open = force === undefined ? menu.hidden : !!force;
      menu.hidden = !open;
      setAttr(toggle, "aria-expanded", open ? "true" : "false");
      if (open) menu.querySelector("button")?.focus({ preventScroll: true });
      return open;
    },
    patch(vm) {
      const show = vm.staff && vm.view !== "none";
      setHidden(root, !show);
      if (!show) { place = ""; return; }
      const p = placeOf(vm);
      if (p !== place || staff !== vm.staff) { place = p; staff = vm.staff; keepFocus(root, rebuild); }
      const prev = root.querySelector('[data-ips="prev"]');
      if (prev) setAttr(prev, "aria-disabled", vm.index <= 0 ? "true" : null);
      const bad = root.querySelector('[data-ips="bad"]');
      if (bad) { setAttr(bad, "aria-checked", vm.askBad ? "true" : "false"); setAttr(bad, "aria-disabled", vm.state === "open" ? null : "true"); }
      const lean = root.querySelector('[data-ips="lean"]');
      if (lean) setAttr(lean, "aria-disabled", vm.undecided.length ? null : "true");
    }
  };
}
