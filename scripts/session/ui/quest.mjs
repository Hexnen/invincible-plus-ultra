/* End-of-session panel, phase S3: the QUESTION view. One big question card and the roster of heroes with one large switch each. Built once, then patched from the
   view model: a hero's node keeps its identity (and focus) while the answers change, the question card slides in only when the question itself changes. */
import { t } from "../lang.mjs";
import { el, icon, setText, setAttr, setHidden, portrait, updatePortrait, reconcile, reducedMotion } from "./dom.mjs";

const STATE_ICON = { yes: "fa-solid fa-check", no: "fa-solid fa-xmark", none: "fa-solid fa-minus" };
const STATE_KEY = { yes: "IPL.Session.UI.Yes", no: "IPL.Session.UI.No", none: "IPL.Session.UI.None" };

function makeHero(item) {
  const li = el("li", "ips-hero", { "data-id": item.id, "data-key": item.id });
  const who = el("div", "ips-who",
    el("strong", "ips-name"),
    el("span", "ips-meta", el("span", "ips-pres", { "aria-hidden": "true" }), el("span", "ips-owners"), el("span", "ips-yours", icon("fa-solid fa-star"), el("span", "", t("IPL.Session.UI.Yours")))),
    el("span", "ips-flaw"));
  const sw = el("button", "ips-sw", { type: "button", role: "switch", "data-ips": "cell", "data-fk": `sw-${item.id}`, "aria-checked": "false" },
    el("span", "ips-sw-box", icon(STATE_ICON.none)), el("span", "ips-sw-txt"));
  const lockBtn = el("button", "ips-lock", { type: "button", "data-ips": "unlock", "data-fk": `lock-${item.id}` }, icon("fa-solid fa-lock"));
  const lockMark = el("span", "ips-lock ips-lock-static", { role: "img" }, icon("fa-solid fa-lock"));
  const over = el("button", "ips-over", { type: "button", role: "switch", "data-ips": "over", "data-fk": `ov-${item.id}`, "aria-checked": "false" },
    el("span", "ips-sw-box ips-over-box", icon("fa-solid fa-check")), el("span", "ips-over-txt"));
  const reason = el("span", "ips-sr ips-reason", { id: `ips-r-${item.id}` });
  li.append(portrait("", ""), who, sw, lockBtn, lockMark, over, reason);
  return li;
}

function patchHero(li, h, ctx) {
  const { q, staff } = ctx;
  setAttr(li, "data-v", h.state);
  setAttr(li, "data-mine", h.mine ? "1" : null);
  setAttr(li, "data-locked", h.locked ? "1" : null);
  setAttr(li, "data-busy", h.busy ? "1" : null);
  setAttr(li, "data-off", h.canToggle ? null : "1");
  setAttr(li, "data-missing", h.missing ? "1" : null);
  updatePortrait(li.querySelector(".ips-portrait"), h.img);
  setText(li.querySelector(".ips-name"), h.name);
  const owners = h.owners.length ? t("IPL.Session.UI.PlayedBy", { names: h.owners.map((o) => o.name).join(", ") }) : t("IPL.Session.UI.GmHero");
  setText(li.querySelector(".ips-owners"), owners);
  const dot = li.querySelector(".ips-pres");
  const online = h.owners.some((o) => o.active);
  setHidden(dot, !h.owners.length);
  setAttr(dot, "data-on", online ? "1" : "0");
  setAttr(dot, "title", online ? t("IPL.Session.UI.Online") : t("IPL.Session.UI.Offline"));
  setHidden(li.querySelector(".ips-yours"), !h.mine);
  const flaw = li.querySelector(".ips-flaw");
  setHidden(flaw, !q.flaw);
  if (q.flaw) setText(flaw, h.flaw ? t("IPL.Session.UI.Flaw", { flaw: h.flaw }) : t("IPL.Session.UI.FlawNone"));

  const reasonText = h.reason ? t(`IPL.Session.UI.Reason.${h.reason}`) : "";
  const sw = li.querySelector(".ips-sw");
  setAttr(sw, "aria-checked", h.v !== null && h.v >= 1 ? "true" : "false");
  setAttr(sw, "aria-label", `${t("IPL.Session.UI.Cell", { hero: h.name, question: q.label })} - ${t(STATE_KEY[h.state])}`);         // S4-17: "No" and "Not answered" are both unchecked, so the word is in the name
  setAttr(sw, "aria-disabled", h.canToggle ? null : "true");
  setAttr(sw, "aria-describedby", reasonText ? `ips-r-${h.id}` : null);
  setAttr(sw, "title", reasonText || null);
  const ic = sw.querySelector("i");
  if (ic.className !== STATE_ICON[h.state]) ic.className = STATE_ICON[h.state];
  setText(sw.querySelector(".ips-sw-txt"), t(STATE_KEY[h.state]));
  setText(li.querySelector(".ips-reason"), reasonText);

  const lockBtn = li.querySelector("button.ips-lock"), lockMark = li.querySelector("span.ips-lock");
  setHidden(lockBtn, !(h.locked && staff));
  setHidden(lockMark, !(h.locked && !staff));
  if (h.locked && staff) { setAttr(lockBtn, "aria-label", t("IPL.Session.UI.Unlock", { hero: h.name })); setAttr(lockBtn, "title", t("IPL.Session.UI.Unlock", { hero: h.name })); }
  if (h.locked && !staff) { setAttr(lockMark, "aria-label", t("IPL.Session.UI.Locked")); setAttr(lockMark, "title", t("IPL.Session.UI.Locked")); }

  const over = li.querySelector(".ips-over");
  setHidden(over, !q.flaw);
  if (q.flaw) {
    setAttr(over, "aria-checked", h.overcame ? "true" : "false");
    setAttr(over, "aria-disabled", h.canOver ? null : "true");
    setAttr(over, "aria-describedby", "ips-flawnote");
    setAttr(over, "aria-label", `${h.name}: ${t("IPL.Session.UI.Overcame")}`);
    setAttr(over, "title", h.canOver ? null : reasonText || null);
    setText(over.querySelector(".ips-over-txt"), t("IPL.Session.UI.Overcame"));
    setAttr(li, "data-over", h.overcame ? "1" : null);
  } else setAttr(li, "data-over", null);
}

export function createQuestion() {
  const root = el("div", "ips-view ips-view-q");
  const num = el("span", "ips-num", el("span", "ips-num-n"), el("span", "ips-num-of"));
  const chip = el("span", "ips-chip");
  const label = el("h3", "ips-q-label", { id: "ips-qh", tabindex: "-1", "data-focus-first": "1" });
  const text = el("p", "ips-q-text");
  const hint = el("p", "ips-q-hint");
  const flawNote = el("p", "ips-q-flaw", { id: "ips-flawnote" }, icon("fa-solid fa-bolt"), " ", el("span", "", t("IPL.Session.UI.OvercameHint")));
  const card = el("article", "ips-q", { "aria-labelledby": "ips-qh" }, el("div", "ips-q-top", num, chip), label, text, hint, flawNote);
  const legend = el("legend", "ips-sr", t("IPL.Session.UI.Roster"));
  const count = el("span", "ips-count");
  const wait = el("span", "ips-wait");
  const note = el("p", "ips-note");
  const list = el("ul", "ips-heroes", { "data-count": "0" });
  const roster = el("fieldset", "ips-roster", {}, legend, el("p", "ips-rhead", count, " ", wait), note, list);
  root.append(card, roster);
  const nodes = new Map();
  let lastQ = null, lastIndex = null, dense = null;

  return {
    el: root,
    heroNodes: nodes,
    patch(vm) {
      const q = vm.q;
      const changed = lastQ !== q.id;
      setText(root.querySelector(".ips-num-n"), String(q.n));
      setText(root.querySelector(".ips-num-of"), `/${q.of}`);
      setText(chip, t(q.group === "bad" ? "IPL.Session.Group.bad" : "IPL.Session.Group.good"));
      setAttr(chip, "data-group", q.group);
      setText(label, q.label);
      setText(text, q.text ?? "");
      setHidden(text, !q.text);
      setText(hint, t("IPL.Session.UI.Hint"));
      setAttr(card, "data-group", q.group);
      setAttr(card, "data-flaw", q.flaw ? "1" : null);
      setHidden(flawNote, !q.flaw);
      setText(count, t("IPL.Session.UI.Answered", { n: vm.counts.answered, total: vm.counts.total }));
      const all = vm.counts.total > 0 && vm.counts.answered >= vm.counts.total;
      const short = vm.counts.waiting.map((n) => { const c = [...n]; return c.length > 22 ? `${c.slice(0, 21).join("")}…` : n; });
      setText(wait, all ? t("IPL.Session.UI.AllAnswered") : short.length > 3 ? t("IPL.Session.UI.WaitingMore", { names: short.slice(0, 3).join(", "), n: short.length - 3 }) : t("IPL.Session.UI.Waiting", { names: short.join(", ") }));
      setAttr(wait, "data-done", all ? "1" : null);
      // a short line for players: what they can do here (never for the GM)
      let noteKey = "";
      if (!vm.staff) noteKey = !vm.allowPlayers ? "off" : vm.mineAny ? "mine" : "watch";
      setHidden(note, !noteKey);
      if (noteKey) setText(note, t(`IPL.Session.UI.Banner.${noteKey}`));
      const d = vm.heroes.length > 8 ? "1" : "0";
      if (dense !== d) { dense = d; setAttr(list, "data-dense", d); }
      setAttr(list, "data-count", String(Math.min(vm.heroes.length, 9)));
      reconcile(list, vm.heroes.map((h) => ({ ...h, key: h.id })), makeHero, (n, h) => patchHero(n, h, { q, staff: vm.staff }), nodes);
      if (changed && lastQ !== null) this.slide(vm.index - (lastIndex ?? vm.index));
      lastQ = q.id; lastIndex = vm.index;
    },
    /** The question changed: the card and the roster slide in a few pixels (transform + opacity only; reduced motion = a plain fade). */
    slide(dir) {
      const els = [card, list];
      const rm = reducedMotion();
      for (const n of els) {
        try { n.getAnimations().forEach((a) => a.cancel()); } catch { /* old engine */ }
        const from = rm ? { opacity: 0 } : { opacity: 0, transform: `translateX(${dir < 0 ? -22 : 22}px)` };
        n.animate?.([from, rm ? { opacity: 1 } : { opacity: 1, transform: "none" }], { duration: rm ? 120 : 190, easing: "cubic-bezier(.16, 1, .3, 1)" });
      }
    }
  };
}
