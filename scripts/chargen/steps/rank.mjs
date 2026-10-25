/* Step "rank" (phase 5a): four rank cards as ONE radio group (native <input type="radio">: Tab enters the group, arrow keys move AND select,
   the same way a screen reader expects). Every card shows the numbers of rules.mjs RANKS (attribute points, cap, starting powers, Reputation);
   Global Guardian carries the "book default" tag. The rank decides the whole budget, so a change never edits anything silently: the later steps
   keep their data and a notice lists what no longer fits (rule issues that depend on the rank), with one explicit button that rebalances the
   attribute values (rules.reconcileAttributes). Everything is one undo step. Remembering the last rank is done by the shell (commit -> chargenRank). */
import { t } from "../lang.mjs";
import { RANK_ORDER, RANKS, ATTRS, validate, validateStep, budget, reconcileAttributes } from "../rules.mjs";
import { setRank } from "../state.mjs";
import { esc, icon, rankName, msgText, delegate } from "./util.mjs";

/** rule issues whose outcome depends on the rank */
const RANK_CODES = new Set(["attr.cap", "attr.over", "attr.unspent", "budget.range", "power.level.massive", "slots.over", "slots.min", "upgrades.over"]);
const rankIssues = (state) => validate(state).issues.filter((i) => RANK_CODES.has(i.code) && i.severity !== "info");
const hasLater = (s) => !!(s.powers?.length || s.team?.upgrades?.length || s.touched?.powers || s.touched?.attributes || ATTRS.some((k) => s.attrs?.[k] !== 2));

function card(r, selected) {
  const R = RANKS[r];
  const stat = (n, label) => `<span class="ipc-rk-stat"><b>${n}</b><small>${esc(label)}</small></span>`;
  return `<label class="ipc-rk${selected ? " is-on" : ""}">
    <input type="radio" name="rank" value="${r}" data-fk="rank-${r}"${selected ? " checked" : ""}>
    <span class="ipc-rk-head">
      <span class="ipc-rk-name">${esc(rankName(r))}</span>
      ${r === "global" ? `<span class="ipc-rk-tag">${esc(t("IPC.Rank.Default"))}</span>` : ""}
      <span class="ipc-rk-sel">${icon("fa-solid fa-check")} ${esc(t("IPC.Step.Selected"))}</span>
    </span>
    <span class="ipc-rk-stats">${stat(R.points, t("IPC.Rank.Points"))}${stat(R.cap, t("IPC.Rank.Cap"))}${stat(R.powers, t("IPC.Rank.Powers"))}${stat(R.reputation, t("IPC.Rank.Rep"))}</span>
  </label>`;
}

function status(ctx) {
  const iss = validateStep(ctx.state, "rank");
  if (!iss.issues.length) return `<p class="ipc-status ipc-ok">${icon("fa-solid fa-circle-check")} ${esc(t("IPC.Step.StatusOk"))}</p>`;
  return `<ul class="ipc-status-list">${iss.issues.map((i) => `<li class="${i.severity === "error" ? "ipc-iss-err" : "ipc-iss-warn"}">${icon("fa-solid fa-circle-exclamation")}<span>${esc(msgText(i))}</span></li>`).join("")}</ul>`;
}

function notice(ctx) {
  const n = ctx.data.notice, s = ctx.state;
  if (!n || n.to !== s.rank) return "";
  const items = rankIssues(s);
  const name = rankName(s.rank);
  if (!n.later) return "";
  if (!items.length && !n.archetype) return `<div class="ipc-banner ipc-banner-ok" role="status">${icon("fa-solid fa-circle-check")}<p>${esc(t("IPC.Rank.ChangedOk", { rank: name }))}</p></div>`;
  const attrIssue = items.some((i) => i.code.startsWith("attr.") || i.code === "budget.range");
  const re = reconcileAttributes(s.attrs, budget(s), RANKS[s.rank].cap);
  const canRebalance = attrIssue && re.ok;
  return `<div class="ipc-banner ipc-banner-warn ipc-rk-notice" role="status">${icon("fa-solid fa-triangle-exclamation")}<div class="ipc-rk-notice-body">
      ${items.length ? `<p>${esc(t("IPC.Rank.Changed", { rank: name }))}</p><ul class="ipc-issues">${items.map((i) => `<li class="${i.severity === "error" ? "ipc-iss-err" : "ipc-iss-warn"}">${icon("fa-solid fa-circle-exclamation")}<span class="ipc-iss-text">${esc(msgText(i))}</span></li>`).join("")}</ul>` : `<p>${esc(t("IPC.Rank.ChangedOk", { rank: name }))}</p>`}
      ${n.archetype ? `<p>${esc(t("IPC.Rank.Readapt", { name: n.archetype }))}</p>` : ""}
      <span class="ipc-banner-actions">
        ${canRebalance ? `<button type="button" class="ipc-btn ipc-btn-small ipc-btn-primary" data-act="rebalance" data-fk="rebalance">${icon("fa-solid fa-scale-balanced")} ${esc(t("IPC.Rank.Rebalance", { n: budget(s) }))}</button>` : ""}
        ${n.archetype ? `<button type="button" class="ipc-btn ipc-btn-small" data-act="to-concept" data-fk="to-concept">${esc(t("IPC.Rank.ToConcept"))}</button>` : ""}
      </span></div></div>`;
}

export default {
  id: "rank",
  icon: "fa-solid fa-ranking-star",

  render(ctx) {
    const s = ctx.state;
    return `<div class="ipc-rank">
      ${status(ctx)}
      <fieldset class="ipc-rk-set"><legend class="ipc-sr">${esc(t("IPC.Rank.Group"))}</legend>${RANK_ORDER.map((r) => card(r, r === s.rank)).join("")}</fieldset>
      <p class="ipc-rk-gm">${icon("fa-solid fa-users")} <span>${esc(t("IPC.Rank.GmNote"))}</span></p>
      <div class="ipc-rk-live">${notice(ctx)}</div>
    </div>`;
  },

  mount(ctx, root) {
    root.addEventListener("change", (ev) => {
      const el = ev.target;
      if (!(el instanceof HTMLInputElement) || el.name !== "rank" || !RANKS[el.value] || el.value === ctx.state.rank) return;
      const prev = ctx.state;
      const next = setRank(prev, el.value);
      // the notice only matters when later steps already hold data; it is evaluated live against the new state
      ctx.data.notice = { from: prev.rank, to: el.value, later: hasLater(prev), archetype: prev.archetype && prev.powers?.length ? prev.archetype : null };
      ctx.commit(next, { body: true });
      const R = RANKS[el.value];
      ctx.announce(t("IPC.Rank.Announce", { rank: rankName(el.value), points: R.points, cap: R.cap }));
    });
    delegate(root, "click", "[data-act]", (ev, el) => {
      const act = el.dataset.act;
      if (act === "to-concept") return ctx.go("concept");
      if (act === "rebalance") {
        const s = ctx.state, re = reconcileAttributes(s.attrs, budget(s), RANKS[s.rank].cap);
        if (!re.ok) return;
        ctx.commit({ ...s, attrs: re.attrs }, { body: true, touch: false });
        ctx.announce(t("IPC.Rank.Rebalanced", { n: budget(s) }));
      }
    });
  },

  /** undo / redo / roll / draft changed the state from outside: a stale "rank changed" notice would lie */
  onState(ctx) { ctx.data.notice = null; }
};

