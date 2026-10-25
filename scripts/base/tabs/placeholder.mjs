/* Placeholder tab bodies (phase B4): they only SHOW the live data of the card (counts, names) so the shell can be tested end to end.
   Each one is replaced by its real module in B5 (base), B6 (upgrades), B7 (events), B8 (gear). Interface: ./index.mjs. */
import * as P from "../pure.mjs";

const dl = (rows) => `<dl class="ipb-dl">${rows.map(([k, v]) => `<div class="ipb-dl-row"><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
const note = (ctx) => `<p class="ipb-note-box">${ctx.icon("fa-solid fa-hammer")} <span>${ctx.esc(ctx.t("IPB.Ph.Note"))}</span></p>`;
const val = (ctx, v) => (v ? ctx.esc(v) : `<span class="ipb-muted">${ctx.esc(ctx.t("IPB.Ph.NotSet"))}</span>`);
const list = (items) => `<ul class="ipb-plist">${items.map((x) => `<li>${x}</li>`).join("")}</ul>`;

export const base = {
  id: "base",
  icon: "fa-solid fa-warehouse",
  badge: () => "",
  render(ctx) {
    const { B } = ctx;
    return note(ctx) + dl([
      [ctx.esc(ctx.t("IPB.Ph.Kind")), val(ctx, B.base.kind)],
      [ctx.esc(ctx.t("IPB.Ph.Where")), val(ctx, B.base.where)],
      [ctx.esc(ctx.t("IPB.Ph.Rank")), ctx.esc(ctx.t(`IPB.Rank.${B.rank}`))]
    ]);
  }
};

export const upgrades = {
  id: "upgrades",
  icon: "fa-solid fa-screwdriver-wrench",
  badge: (ctx) => { const a = P.allowance(ctx.B.rank, ctx.B.upgrades); return a.total || a.used ? `${a.used}/${a.total}` : ""; },
  render(ctx) {
    const a = P.allowance(ctx.B.rank, ctx.B.upgrades);
    const owned = P.sortedList(ctx.B.upgrades);
    return note(ctx) + dl([
      [ctx.esc(ctx.t("IPB.Ph.Allowance")), ctx.esc(ctx.t("IPB.Ph.AllowanceValue", { used: a.used, total: a.total }))],
      [ctx.esc(ctx.t("IPB.Ph.Owned")), owned.length
        ? list(owned.map((u) => `${ctx.esc(u.name)}${u.count > 1 ? ` x${u.count}` : ""}${u.power ? ` (${ctx.esc(u.power)})` : ""} <span class="ipb-muted">- ${ctx.esc(ctx.t(`IPB.Status.${u.status}`))}</span>`))
        : `<span class="ipb-muted">${ctx.esc(ctx.t("IPB.Ph.NoUpgrades"))}</span>`]
    ]);
  }
};

export const events = {
  id: "events",
  icon: "fa-solid fa-dice",
  badge: (ctx) => { const n = Object.keys(ctx.B.events).length; return n || ""; },
  render(ctx) {
    const list_ = P.sortedList(ctx.B.events).sort((x, y) => y.at - x.at);
    const last = list_[0];
    return note(ctx) + dl([
      [ctx.esc(ctx.t("IPB.Ph.Events")), String(list_.length)],
      [ctx.esc(ctx.t("IPB.Ph.Latest")), last ? `${ctx.esc(String(last.roll))}${last.label ? ` <span class="ipb-muted">(${ctx.esc(last.label)})</span>` : ""}` : `<span class="ipb-muted">${ctx.esc(ctx.t("IPB.Ph.NoEvents"))}</span>`]
    ]);
  }
};

export const gear = {
  id: "gear",
  icon: "fa-solid fa-van-shuttle",
  badge: (ctx) => { const n = Object.keys(ctx.B.vehicles).length + Object.keys(ctx.B.crate).length; return n || ""; },
  render(ctx) {
    const veh = P.sortedList(ctx.B.vehicles);
    const none = `<span class="ipb-muted">${ctx.esc(ctx.t("IPB.Ph.None"))}</span>`;
    return note(ctx) + dl([
      [ctx.esc(ctx.t("IPB.Ph.Vehicles")), veh.length ? list(veh.map((v) => `${ctx.esc(v.name)}${v.primary ? ` <i class="fa-solid fa-star" aria-hidden="true"></i>` : ""}`)) : none],
      [ctx.esc(ctx.t("IPB.Ph.Crate")), String(Object.keys(ctx.B.crate).length)],
      [ctx.esc(ctx.t("IPB.Ph.Trackers")), String(Object.keys(ctx.B.trackers).length)]
    ]);
  }
};
