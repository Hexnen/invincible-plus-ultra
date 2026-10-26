/* End-of-session panel, phase S3: the SUMMARY view (state closed / awarded, or the step after the last question). A real table: hero, the yes answers as numbered
   chips, karma gained, karma lost (only when bad karma is on) and the karma before -> after. Before the award the "after" is a LIVE preview from the heroes' current
   karma; after the award it is what the award wrote. The table is rebuilt only when its content really changed (it holds no focusable control). */
import { t } from "../lang.mjs";
import { el, icon, setText, setAttr, setHidden, portrait } from "./dom.mjs";

const signed = (n, sign) => (n ? `${sign}${n}` : "0");

function row(r, sum) {
  const tr = el("tr", "ips-srow", { "data-id": r.id, "data-missing": r.missing ? "1" : null, "data-applied": r.applied === null ? null : String(r.applied) });
  const inner = el("div", "ips-s-whoin", portrait(r.img), el("span", "ips-s-name", r.name));
  if (r.missing) inner.querySelector(".ips-s-name").append(el("span", "ips-s-missing", t("IPL.Session.UI.Sum.missing")));
  const who = el("th", "ips-s-who", { scope: "row" }, inner);
  const chips = el("ul", "ips-yc");
  if (r.yes.length) for (const y of r.yes) {
    const bad = y.bad, n = bad ? y.n - 10 : y.n;
    chips.append(el("li", "ips-yc-i", { "data-bad": bad ? "1" : null, title: y.label }, bad ? `B${n}` : String(n), el("span", "ips-sr", ` ${y.label}`)));
  } else chips.append(el("li", "ips-yc-none", t("IPL.Session.UI.Sum.noYes")));
  const yes = el("td", "ips-s-yes", { "data-label": t("IPL.Session.UI.Sum.yes") }, chips);
  const gain = el("td", "ips-s-gain", { "data-label": t("IPL.Session.UI.Sum.gain") }, el("span", "ips-num2", signed(r.gain, "+")));
  if (r.overcame) gain.append(el("span", "ips-x2", { title: t("IPL.Session.UI.Sum.flawBonus") }, icon("fa-solid fa-bolt"), "x2", el("span", "ips-sr", ` ${t("IPL.Session.UI.Sum.flawBonus")}`)));
  const cells = [who, yes, gain];
  if (sum.askBad) cells.push(el("td", "ips-s-loss", { "data-label": t("IPL.Session.UI.Sum.loss") }, el("span", "ips-num2", signed(r.loss, "-"))));
  const karma = el("td", "ips-s-karma", { "data-label": t(sum.awarded ? "IPL.Session.UI.Sum.karmaDone" : "IPL.Session.UI.Sum.karmaAfter") });
  if (r.before !== null && r.after !== null && !r.missing && r.applied !== 0) {
    karma.append(el("span", "ips-kv", { "aria-hidden": "true" }, el("span", "ips-kb", String(r.before)), icon("fa-solid fa-arrow-right-long"), el("span", "ips-ka", { "data-up": r.after > r.before ? "1" : r.after < r.before ? "-1" : "0" }, String(r.after))),
      el("span", "ips-sr", t("IPL.Session.UI.Award.row", { name: r.name, before: r.before, after: r.after })));
  } else if (r.applied === 0) karma.append(el("span", "ips-s-state", t("IPL.Session.UI.Sum.state.pending")));
  else if (r.before !== null) karma.append(el("span", "ips-kb", String(r.before)));
  cells.push(karma);
  tr.append(...cells);
  return tr;
}

export function createSummary() {
  const root = el("div", "ips-view ips-view-s");
  const title = el("h3", "ips-plate", { tabindex: "-1", "data-focus-first": "1" }, el("span", "", t("IPL.Session.UI.Sum.title")));
  const stamp = el("span", "ips-stamp", icon("fa-solid fa-circle-check"), el("span", "ips-stamp-t"));
  const top = el("div", "ips-s-top", title, stamp);
  const note = el("p", "ips-s-note");
  const head = el("tr", "", el("th", "", { scope: "col" }, t("IPL.Session.UI.Sum.hero")), el("th", "", { scope: "col" }, t("IPL.Session.UI.Sum.yes")), el("th", "", { scope: "col" }, t("IPL.Session.UI.Sum.gain")), el("th", "ips-s-lossh", { scope: "col" }, t("IPL.Session.UI.Sum.loss")), el("th", "", { scope: "col" }, ""));
  const body = el("tbody");
  const foot = el("tfoot");
  const table = el("table", "ips-table", {}, el("caption", "ips-sr", t("IPL.Session.UI.Sum.title")), el("thead", "", head), body, foot);
  const flaw = el("p", "ips-s-flaw", icon("fa-solid fa-bolt"), el("span", "ips-s-flaw-t"));
  root.append(top, note, el("div", "ips-table-wrap", table), flaw);
  let fp = "";
  return {
    el: root,
    patch(vm) {
      const sum = vm.sum;
      setAttr(root, "data-awarded", sum.awarded ? "1" : null);
      setHidden(stamp, !sum.awarded);
      setText(stamp.querySelector(".ips-stamp-t"), t("IPL.Session.UI.Sum.awarded"));
      const noteKey = sum.awarded ? "" : vm.staff ? "gmHint" : "waiting";
      setHidden(note, !noteKey);
      if (noteKey) setText(note, t(`IPL.Session.UI.Sum.${noteKey}`));
      const f = JSON.stringify([sum, vm.staff]);
      if (f !== fp) {
        fp = f;
        const hasLoss = sum.askBad;
        setHidden(head.querySelector(".ips-s-lossh"), !hasLoss);
        setText(head.lastElementChild, t(sum.awarded ? "IPL.Session.UI.Sum.karmaDone" : "IPL.Session.UI.Sum.karmaAfter"));
        body.replaceChildren(...sum.rows.map((r) => row(r, sum)));
        const tr = el("tr", "ips-s-total", el("th", "", { scope: "row", colspan: "2" }, t("IPL.Session.UI.Sum.total")), el("td", "ips-s-gain", el("span", "ips-num2", signed(sum.gain, "+"))));
        if (hasLoss) tr.append(el("td", "ips-s-loss", el("span", "ips-num2", signed(sum.loss, "-"))));
        tr.append(el("td", "", ""));
        foot.replaceChildren(tr);
        setAttr(table, "data-bad", hasLoss ? "1" : "0");
        setHidden(flaw, !sum.overcame.length);
        if (sum.overcame.length) setText(flaw.querySelector(".ips-s-flaw-t"), t("IPL.Session.Chat.flaw", { names: sum.overcame.join(", ") }));
      }
    }
  };
}
