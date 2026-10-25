/* Team & Base card, phase B6: the REAL "Upgrades" tab (replaces the placeholder). Interface: ./index.mjs.
   What it holds: the starting-allowance meter of the (derived) rank with the book's recommended picks, the upgrades the team owns (status chip = icon + word,
   source, stack, book effect sentence, dependency warnings, note, GM actions for install / repair / status / remove with an undo bar), the catalog of the book's
   sample upgrades with the LIVE prerequisite state against the team's heroes (met / Too Pricey / needs another upgrade / limit reached) and the buttons that are
   allowed, a custom upgrade (GM), "Adopt upgrades from hero text", the pooled-karma purchase dialog (GM) or "Ask the GM" (players), and a purchase history.
   Rules of this file:
   - Everything is written through the api (api.upgrades / api.karma / api.relay) or ctx.update; no direct flag writes. The rules (prerequisites, Too Pricey,
     stacking, price, which button is allowed) come from pure code (../up-pure.mjs + ../pure.mjs), the same code ops.mjs enforces again at write time.
   - Book text (names, the first effect sentence, the prerequisite line) is read at runtime from api.catalog and never stored in the module.
   - The sheet repaints the body on any actor update and defers it while a text field has focus; module-level state here (filter, typed power, custom
     draft, undo) survives repaints. Listeners are delegated once per panel element, ctx is looked up per event. */
import * as P from "../pure.mjs";
import * as U from "../up-pure.mjs";

const CTX = new WeakMap();                 // panel element -> latest ctx
const BOUND = new WeakSet();               // panel elements with listeners
const cat = { list: undefined, at: 0, loading: false };      // the book's upgrades: undefined (not read yet) | [] (book missing) | Entry[]
const recs = { names: undefined };         // the book's recommended starting picks (our pack table), names only
const filters = new Map();                 // team id -> typed filter
const powers = new Map();                  // "<team>:<key>" -> typed power (Power Effect)
const drafts = new Map();                  // team id -> { name, note } of the custom upgrade
const undoRec = new Map();                 // team id -> { text, patch, timer }
const busy = new Set();                    // operations in flight (no double clicks)
const UNDO_MS = 10000;

const ST_ICON = { active: "fa-circle-check", installing: "fa-hourglass-half", disabled: "fa-ban", broken: "fa-burst", lost: "fa-lock" };
const CS_ICON = { met: "fa-circle-check", tooPricey: "fa-coins", blocked: "fa-lock", unknown: "fa-circle-question", maxed: "fa-layer-group" };
const pk = (ctx, key) => `${ctx.team.id}:${key}`;
const entryOf = (key) => cat.list?.find((c) => c.key === key) ?? null;

/* ------------------------------------------------------------------ render */
function allowanceBlock(ctx, a) {
  const { esc, icon, t, tn, B } = ctx;
  const info = B.rankInfo ?? {};
  const rank = t(`IPB.Rank.${B.rank}`);
  const n = Math.max(a.total, a.used);
  const notches = n ? `<ul class="ipb-up-notches" aria-hidden="true">${Array.from({ length: n }, (_x, i) => `<li data-on="${i < a.used}"${i >= a.total ? ' data-over="true"' : ""}></li>`).join("")}</ul>` : "";
  const lead = a.total ? tn("IPB.Up.AllowLead", a.total, { rank }) : t("IPB.Up.AllowNone", { rank });
  const notes = [];
  if (info.mixed) notes.push(t("IPB.Up.RankMixed"));
  if (info.source && info.source !== "members") notes.push(t("IPB.Up.RankGuess", { rank }));
  if (a.over) notes.push(t("IPB.Up.AllowOver", { used: a.used, total: a.total }));
  const recHtml = recBlock(ctx, a);
  return `<section class="ipb-up-allow" aria-labelledby="${esc(ctx.app.id)}-up-allow-h">
    <h2 class="ipb-bt-h" id="${esc(ctx.app.id)}-up-allow-h">${esc(t("IPB.Up.AllowH"))}</h2>
    <div class="ipb-up-meter">${notches}<p class="ipb-up-meter-text"><strong>${esc(t("IPB.Up.AllowCount", { used: a.used, total: a.total }))}</strong></p></div>
    <p class="ipb-bt-hint">${esc(lead)}</p>
    ${notes.map((x) => `<p class="ipb-bt-warn ipb-up-warn">${icon("fa-solid fa-circle-info")}<span>${esc(x)}</span></p>`).join("")}
    ${recHtml}
    <p class="ipb-bt-hint">${esc(t("IPB.Up.PoolLine", { pool: ctx.stats.karmaPool, cost: P.COST.upgrade, pricey: P.COST.tooPricey }))}</p>
  </section>`;
}

function recBlock(ctx, a) {
  const { esc, t } = ctx;
  const list = U.matchRecommended(recs.names ?? [], cat.list ?? []);
  if (!list.length) return "";
  const own = P.sortedList(ctx.B.upgrades);
  const items = list.map((r) => {
    const have = own.some((u) => u.key === r.key);
    const can = ctx.canEdit && a.left > 0 && !have;
    const label = t("IPB.Up.PickNamed", { name: r.name });
    return `<li>${can
      ? `<button type="button" class="ipb-bt-chip" data-up-act="pick" data-key="${esc(r.key)}" data-fk="up-rec-${esc(r.key)}" aria-label="${esc(label)}"><span>${esc(r.name)}</span></button>`
      : `<span class="ipb-up-recname${have ? " ipb-up-have" : ""}">${have ? ctx.icon("fa-solid fa-check") : ""}${esc(r.name)}</span>`}</li>`;
  }).join("");
  return `<div class="ipb-bt-chips"><span class="ipb-bt-chips-h">${esc(t("IPB.Up.Recs"))}</span><ul>${items}</ul></div>`;
}

function statusChip(ctx, st) {
  return `<span class="ipb-up-chip" data-status="${st}">${ctx.icon(`fa-solid ${ST_ICON[st]}`)}<span>${ctx.esc(ctx.t(`IPB.Status.${st}`))}</span></span>`;
}

function ownedRow(ctx, u, own, hint) {
  const { esc, icon, t } = ctx;
  const B = ctx.B;
  const entry = entryOf(u.key);
  const st = U.shownStatus(u, B.base.occupied);
  // the limit counts every copy of the upgrade (and, for Power Effect, of the same power) whatever its source, so the badge shows the total held
  const held = own.filter((x) => x.key === u.key && (!entry?.perPower || (x.power || "").trim().toLowerCase() === (u.power || "").trim().toLowerCase())).reduce((n, x) => n + x.count, 0);
  const stack = entry && typeof entry.max === "number" && entry.max > 1
    ? `<span class="ipb-up-x">${esc(t("IPB.Up.Stack", { count: held, max: entry.max }))}</span>` : (u.count > 1 ? `<span class="ipb-up-x">x${u.count}</span>` : "");
  const src = u.source === "karma" ? t("IPB.Up.Src.karma", { paid: u.paid }) : t(`IPB.Up.Src.${u.source}`);
  const parts = [];
  if (entry?.effect) parts.push(`<p class="ipb-up-effect">${esc(entry.effect)}</p>`);
  else if (u.key === "custom") parts.push(`<p class="ipb-up-effect ipb-muted">${esc(t("IPB.Up.CustomTag"))}</p>`);
  if (u.status === "installing" && !B.base.occupied) parts.push(`<p class="ipb-bt-hint">${icon("fa-solid fa-hourglass-half")} ${esc(t("IPB.Up.InstallNote"))}</p>`);
  for (const r of U.dependencyIssues(entry, own, u.id)) parts.push(`<p class="ipb-bt-warn ipb-up-warn">${icon("fa-solid fa-triangle-exclamation")}<span>${esc(t(r.key, r.params))}</span></p>`);
  if (hint && hint.key === u.key && u.status === "active") parts.push(`<p class="ipb-bt-hint">${icon("fa-solid fa-graduation-cap")} ${esc(t("IPB.Up.Training", { ten: hint.ten, twenty: hint.twenty }))}</p>`);
  else if (hint && hint.key === "training-simulator" && u.key === "training-facilities") parts.push(`<p class="ipb-bt-hint">${icon("fa-solid fa-graduation-cap")} ${esc(t("IPB.Up.TrainingReplaced"))}</p>`);
  const label = `${u.name}${u.power ? ` (${u.power})` : ""}`;
  // actions
  const acts = [];
  if (ctx.isStaff) {
    if (u.status === "installing") acts.push(`<button type="button" class="ipb-btn ipb-btn-small ipb-btn-primary" data-up-act="installed" data-uid="${esc(u.id)}" data-fk="up-inst-${esc(u.id)}" aria-label="${esc(t("IPB.Up.InstalledAria", { name: label }))}">${icon("fa-solid fa-screwdriver-wrench")}${esc(t("IPB.Up.MarkInstalled"))}</button>`);
    else if (u.status === "broken" || u.status === "disabled") acts.push(`<button type="button" class="ipb-btn ipb-btn-small ipb-btn-primary" data-up-act="repair" data-uid="${esc(u.id)}" data-fk="up-rep-${esc(u.id)}" aria-label="${esc(t("IPB.Up.RepairAria", { name: label }))}">${icon("fa-solid fa-wrench")}${esc(t("IPB.Up.Repair"))}</button>`);
    const opts = P.STATUSES.map((s) => `<option value="${s}"${s === u.status ? " selected" : ""}>${esc(t(`IPB.Status.${s}`))}</option>`).join("");
    acts.push(`<label class="ipb-up-sel"><span class="ipb-sr">${esc(t("IPB.Up.StatusOf", { name: label }))}</span><select class="ipb-input" name="ipb-up-st-${esc(u.id)}" data-up-status="${esc(u.id)}" data-fk="up-st-${esc(u.id)}">${opts}</select></label>`);
  }
  if (ctx.isStaff || (ctx.canEdit && u.source === "start")) {
    const one = u.count > 1;
    const aria = t(one ? "IPB.Up.RemoveOneAria" : "IPB.Up.RemoveAria", { name: label });
    acts.push(`<button type="button" class="ipb-btn ipb-btn-small" data-up-act="remove" data-uid="${esc(u.id)}" data-fk="up-rm-${esc(u.id)}" aria-label="${esc(aria)}">${icon("fa-solid fa-trash-can")}${esc(t(one ? "IPB.Up.RemoveOne" : "IPB.Up.Remove"))}</button>`);
  }
  const note = ctx.canEdit
    ? `<details class="ipb-up-notebox"${u.note ? " open" : ""}><summary>${icon("fa-solid fa-pen")}<span>${esc(t("IPB.Up.NoteSummary"))}</span></summary>`
      + `<input class="ipb-input" type="text" name="ipb-up-note-${esc(u.id)}" data-up-note="${esc(u.id)}" maxlength="300" value="${esc(u.note)}" aria-label="${esc(t("IPB.Up.NoteLabel", { name: label }))}" placeholder="${esc(t("IPB.Up.NotePh"))}" autocomplete="off"></details>`
    : (u.note ? `<p class="ipb-up-note-ro">${icon("fa-solid fa-pen")} ${esc(u.note)}</p>` : "");
  return `<li class="ipb-up-row" data-status="${st}" data-uid="${esc(u.id)}">
    <div class="ipb-up-line">
      <p class="ipb-up-name"><strong>${esc(u.name)}</strong>${u.power ? ` <span class="ipb-up-power">(${esc(u.power)})</span>` : ""}${stack}</p>
      ${statusChip(ctx, st)}
      <span class="ipb-up-src">${esc(src)}</span>
    </div>
    ${parts.join("")}
    ${acts.length ? `<div class="ipb-up-acts">${acts.join("")}</div>` : ""}
    ${note}
  </li>`;
}

function ownedBlock(ctx, own) {
  const { esc, icon, t } = ctx;
  const hint = U.trainingHint(own, ctx.B.base.occupied);
  const rec = undoRec.get(ctx.team.id);
  const undo = rec ? `<p class="ipb-up-undo" role="status">${icon("fa-solid fa-trash-can")}<span>${esc(rec.text)}</span><button type="button" class="ipb-bt-link" data-up-act="undo" data-fk="up-undo">${icon("fa-solid fa-rotate-left")}${esc(t("IPB.Up.Undo"))}</button></p>` : "";
  const empty = `<p class="ipb-muted ipb-up-empty">${esc(t(ctx.canEdit ? "IPB.Up.EmptyEdit" : "IPB.Up.EmptyRo"))}</p>`;
  return `<section class="ipb-up-owned" aria-labelledby="${esc(ctx.app.id)}-up-own-h">
    <h2 class="ipb-bt-h" id="${esc(ctx.app.id)}-up-own-h">${esc(t("IPB.Up.OwnedH"))}</h2>
    ${undo}
    ${own.length ? `<ul class="ipb-up-list">${own.map((u) => ownedRow(ctx, u, own, hint)).join("")}</ul>` : empty}
  </section>`;
}

function adoptBlock(ctx, own) {
  if (!ctx.canEdit || !cat.list?.length) return "";
  const { esc, icon, t, tn } = ctx;
  const miss = adoptCandidates(ctx, own);
  if (!miss.length) return "";
  const names = miss.map(P.formatUpgrade).join(", ");
  return `<section class="ipb-up-adopt" aria-label="${esc(t("IPB.Up.Adopt"))}">
    <p class="ipb-bt-warn ipb-up-warn">${icon("fa-solid fa-file-import")}<span>${esc(tn("IPB.Up.AdoptLead", miss.length, { names }))}</span></p>
    <div class="ipb-bt-actions"><button type="button" class="ipb-btn ipb-btn-small" data-up-act="adopt" data-fk="up-adopt">${icon("fa-solid fa-file-import")}${esc(t("IPB.Up.Adopt"))}</button></div>
  </section>`;
}

function historyBlock(ctx) {
  const log = U.purchaseLog(ctx.B.upgrades);
  if (!log.length) return "";
  const { esc, t } = ctx;
  const total = log.reduce((n, x) => n + x.paid, 0);
  const lines = log.slice(0, 30).map((x) => {
    const split = U.formatSplit(x.split);
    const date = x.at ? new Date(x.at).toLocaleDateString(game.i18n?.lang || undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
    return `<li><span class="ipb-up-hist-date">${esc(date)}</span> <span class="ipb-up-hist-name">${esc(x.name)}</span> <span class="ipb-up-hist-cost">${esc(split ? t("IPB.Up.HistLine", { cost: x.paid, split }) : t("IPB.Up.HistLineNoSplit", { cost: x.paid }))}</span></li>`;
  }).join("");
  return `<details class="ipb-up-hist"><summary>${ctx.icon("fa-solid fa-clock-rotate-left")}<span>${esc(t("IPB.Up.HistH", { n: log.length, total }))}</span></summary><ol reversed class="ipb-up-hist-list">${lines}</ol></details>`;
}

/* ----- catalog */
function reasonKeys(why) { return why ? `${why.key}|${JSON.stringify(why.params)}` : ""; }

function catalogRow(ctx, c, own, left) {
  const { esc, icon, t } = ctx;
  const power = powers.get(pk(ctx, c.key)) ?? "";
  const s = U.catalogState(c, { members: ctx.facts, owned: own, power, staff: ctx.isStaff, left, canEdit: ctx.canEdit });
  const haveN = own.filter((u) => u.key === c.key).reduce((n, u) => n + u.count, 0);
  const limit = c.perPower && typeof c.max === "number" ? t("IPB.Up.LimitPer", { max: c.max })
    : typeof c.max === "number" && c.max > 1 ? t("IPB.Up.Limit", { max: c.max }) : c.max === null ? t("IPB.Up.LimitMany") : "";
  const pre = c.prereq?.none
    ? `<p class="ipb-up-pre"><span class="ipb-muted">${esc(t("IPB.Up.PreNone"))}</span></p>`
    : `<p class="ipb-up-pre"><span class="ipb-up-ps" data-state="${s.state}">${icon(`fa-solid ${CS_ICON[s.state]}`)}<span>${esc(stateWord(ctx, s))}</span></span>`
      + `<span class="ipb-up-pretext"><span class="ipb-muted">${esc(t("IPB.Up.PreLabel"))}:</span> ${esc(c.prereqRaw)}</span></p>`
      + (s.ev.reasons.length ? `<p class="ipb-bt-hint ipb-up-reasons">${esc(s.ev.reasons.map((r) => t(r.key, r.params)).join(" "))}</p>` : "");
  const powerIn = c.perPower
    ? `<label class="ipb-up-power-in"><span>${esc(t("IPB.Up.PowerLabel"))}</span><input class="ipb-input" type="text" name="ipb-up-pw-${esc(c.key)}" data-up-power="${esc(c.key)}" maxlength="60" value="${esc(power)}" placeholder="${esc(t("IPB.Up.PowerPh"))}" autocomplete="off"></label>` : "";
  return `<li class="ipb-up-crow" data-key="${esc(c.key)}" data-state="${s.state}">
    <div class="ipb-up-line"><p class="ipb-up-name"><strong>${esc(c.name)}</strong></p>
      ${haveN ? `<span class="ipb-up-own">${esc(t("IPB.Up.Have", { count: haveN }))}</span>` : ""}${limit ? `<span class="ipb-up-limit">${esc(limit)}</span>` : ""}</div>
    ${c.effect ? `<p class="ipb-up-effect">${esc(c.effect)}</p>` : ""}
    ${pre}
    ${powerIn}
    <div class="ipb-up-acts" data-up-actions="${esc(c.key)}">${actionsHtml(ctx, c.key, s, left)}</div>
  </li>`;
}

function stateWord(ctx, s) {
  const { t } = ctx;
  if (s.state === "tooPricey") return t("IPB.Up.State.tooPricey", { cost: s.cost.cost });
  return t(`IPB.Up.State.${s.state}`);
}

/** the buttons of a catalog row (also repainted alone while the user types the power / custom name) */
function actionsHtml(ctx, key, s, left) {
  const { esc, icon, t } = ctx;
  const custom = key === "custom";
  // B12: a catalog row never carries the yellow primary (17 rows = 17 competing primaries); the view's primaries are the owned-row repairs above
  const btn = (act, label, ok, primary, extra = "") => `<button type="button" class="ipb-btn ipb-btn-small${primary ? " ipb-btn-primary" : ""}" data-up-act="${act}" data-key="${esc(key)}" data-fk="up-${act}-${esc(key)}"${ok ? "" : ' aria-disabled="true"'}${extra}>${label}</button>`;
  const out = [];
  const whys = [];
  const cost = s.cost.cost;
  if (ctx.canEdit && left > 0) { out.push(btn("pick", `${icon("fa-solid fa-flag")}${esc(t("IPB.Up.Pick"))}`, s.start.ok, false)); if (!s.start.ok) whys.push(s.start.why); }
  if (ctx.isStaff) {
    const label = cost == null ? t("IPB.Up.Buy") : custom ? t("IPB.Up.Buy") : t("IPB.Up.BuyCost", { cost });
    out.push(btn("buy", `${icon("fa-solid fa-coins")}${esc(label)}`, s.buy.ok, false));
    if (!s.buy.ok) whys.push(s.buy.why);
    out.push(btn("grant", `${icon("fa-solid fa-gift")}${esc(t("IPB.Up.Grant"))}`, s.grant.ok, false));
    if (!s.grant.ok && s.grant.why?.key !== "IPB.Up.staffOnly") whys.push(s.grant.why);
  } else if (ctx.canEdit) {
    const label = cost == null ? t("IPB.Up.Ask") : t("IPB.Up.AskCost", { cost });
    out.push(btn("ask", `${icon("fa-solid fa-hand")}${esc(label)}`, s.buy.ok, false));
    if (!s.buy.ok) whys.push(s.buy.why);
  }
  const seen = new Set();
  const why = whys.filter((w) => w && !seen.has(reasonKeys(w)) && seen.add(reasonKeys(w))).map((w) => `<p class="ipb-up-why">${icon("fa-solid fa-circle-info")}<span>${esc(t(w.key, w.params))}</span></p>`).join("");
  return out.join("") + why;
}

function customRow(ctx, own, left) {
  const { esc, t } = ctx;
  const d = drafts.get(ctx.team.id) ?? { name: "", note: "" };
  const s = U.catalogState({ key: "custom" }, { members: ctx.facts, owned: own, staff: ctx.isStaff, left, canEdit: ctx.canEdit });
  const named = d.name.trim().length > 0;
  const gate = (x) => (named ? x : { ok: false, why: { key: "IPB.Up.needName", params: {} } });
  const s2 = { ...s, start: gate(s.start), buy: gate(s.buy), grant: gate(s.grant) };
  return `<li class="ipb-up-crow ipb-up-custom" data-key="custom" data-state="met">
    <div class="ipb-up-line"><p class="ipb-up-name"><strong>${esc(t("IPB.Up.CustomH"))}</strong></p></div>
    <p class="ipb-bt-hint">${esc(t("IPB.Up.CustomHint"))}</p>
    <div class="ipb-up-custom-in">
      <label class="ipb-up-power-in"><span>${esc(t("IPB.Up.CustomName"))}</span><input class="ipb-input" type="text" name="ipb-up-cname" data-up-draft="name" maxlength="80" value="${esc(d.name)}" autocomplete="off"></label>
      <label class="ipb-up-power-in"><span>${esc(t("IPB.Up.CustomNote"))}</span><input class="ipb-input" type="text" name="ipb-up-cnote" data-up-draft="note" maxlength="300" value="${esc(d.note)}" autocomplete="off"></label>
    </div>
    <div class="ipb-up-acts" data-up-actions="custom">${actionsHtml(ctx, "custom", s2, left)}</div>
  </li>`;
}

function catalogBlock(ctx, own, a) {
  const { esc, icon, t } = ctx;
  if (!ctx.canEdit) return "";
  const q = filters.get(ctx.team.id) ?? "";
  let body;
  if (cat.list === undefined) body = `<p class="ipb-muted" role="status">${esc(t("IPB.Up.CatLoading"))}</p>`;
  else if (!cat.list.length) body = `<p class="ipb-up-nocat">${icon("fa-solid fa-book-skull")}<span>${esc(t("IPB.Up.CatNone"))}</span></p>`;
  else body = catalogListHtml(ctx, own, a.left, q);
  const hid = ctx.members.hidden ? `<p class="ipb-bt-hint">${icon("fa-solid fa-eye-slash")} ${esc(t("IPB.Foot.Visible"))}</p>` : "";
  const filter = cat.list?.length
    ? `<label class="ipb-up-filter"><span>${esc(t("IPB.Up.FilterLabel"))}</span><input class="ipb-input" type="search" name="ipb-up-filter" data-up-filter value="${esc(q)}" placeholder="${esc(t("IPB.Up.FilterPh"))}" autocomplete="off"></label>` : "";
  return `<section class="ipb-up-cat" aria-labelledby="${esc(ctx.app.id)}-up-cat-h">
    <h2 class="ipb-bt-h" id="${esc(ctx.app.id)}-up-cat-h">${esc(t("IPB.Up.CatH"))}</h2>
    <p class="ipb-bt-hint">${esc(t(ctx.isStaff ? "IPB.Up.CatLeadGm" : "IPB.Up.CatLead"))}</p>
    ${hid}${filter}
    <div data-up-catalog>${body}</div>
    ${ctx.isStaff ? `<ul class="ipb-up-clist ipb-up-clist-custom">${customRow(ctx, own, a.left)}</ul>` : ""}
  </section>`;
}

function catalogListHtml(ctx, own, left, q) {
  const list = U.filterCatalog(cat.list, q);
  if (!list.length) return `<p class="ipb-muted" role="status">${ctx.esc(ctx.t("IPB.Up.NoMatch", { q }))}</p>`;
  return `<ul class="ipb-up-clist">${list.map((c) => catalogRow(ctx, c, own, left)).join("")}</ul>`;
}

function render(ctx) {
  const { esc, icon, t, B } = ctx;
  const own = P.sortedList(B.upgrades);
  const a = P.allowance(B.rank, B.upgrades);
  const banner = B.base.occupied ? `<div class="ipb-bt-occupied" role="status">${icon("fa-solid fa-triangle-exclamation")}<p>${esc(t("IPB.Up.Lost"))}</p></div>` : "";
  const ro = ctx.canEdit ? "" : `<p class="ipb-bt-hint ipb-up-ro">${icon("fa-solid fa-lock")} ${esc(t("IPB.Up.ReadOnly"))}</p>`;
  return `<div class="ipb-up${ctx.canEdit ? "" : " ipb-up-readonly"}">
    ${banner}
    <div class="ipb-up-left">${allowanceBlock(ctx, a)}${ownedBlock(ctx, own)}${adoptBlock(ctx, own)}${historyBlock(ctx)}${ro}</div>
    ${ctx.canEdit ? `<div class="ipb-up-right">${catalogBlock(ctx, own, a)}</div>` : ""}
  </div>`;
}

/* ------------------------------------------------------------------ loading (book data, read once per session) */
async function ensureCatalog(root) {
  const ctx = CTX.get(root);
  if (!ctx || cat.loading) return;
  if (cat.list !== undefined && (cat.list.length || Date.now() - cat.at < 15000)) return;     // an empty list is retried now and then (the book may load late)
  cat.loading = true;
  let list = [];
  try { list = (await ctx.api.catalog.upgrades()) ?? []; } catch { list = []; }
  const changed = cat.list === undefined || cat.list.length !== list.length;
  cat.list = list; cat.at = Date.now(); cat.loading = false;
  if (changed) CTX.get(root)?.rerender();
}
async function ensureRecs(root) {
  const ctx = CTX.get(root);
  if (!ctx || recs.names !== undefined) return;
  recs.names = [];
  try { recs.names = (await ctx.api.catalog.recommendedUpgrades()) ?? []; } catch { recs.names = []; }
  if (recs.names.length) CTX.get(root)?.rerender();
}

/** hero texts (the Team base line of every visible member) -> the upgrades named there that the card lacks */
function adoptCandidates(ctx, own = P.sortedList(ctx.B.upgrades)) {
  if (!cat.list?.length) return [];
  const lists = [];
  for (const a of ctx.members) {
    const text = String(a._source?.system?.teamBase ?? "").trim();
    if (text) lists.push(P.parseTeamBase(text, cat.list).upgrades);
  }
  return U.missingFromText(U.unionAdoptions(lists), own);
}

/* ------------------------------------------------------------------ actions */
const q = (root, sel) => root.querySelector(sel);
function startOp(key) { if (busy.has(key)) return false; busy.add(key); return true; }

function rowState(ctx, key) {
  const own = P.sortedList(ctx.B.upgrades);
  const a = P.allowance(ctx.B.rank, ctx.B.upgrades);
  const custom = key === "custom";
  const entry = custom ? { key: "custom" } : entryOf(key);
  const power = custom ? "" : (powers.get(pk(ctx, key)) ?? "");
  const s = U.catalogState(entry, { members: ctx.facts, owned: own, power, staff: ctx.isStaff, left: a.left, canEdit: ctx.canEdit });
  return { entry, s, power, left: a.left, own };
}

/** repaint only the buttons of one catalog row (the user is typing in the row's own field) */
function paintActions(root, key) {
  const ctx = CTX.get(root);
  const el = q(root, `[data-up-actions="${CSS.escape(key)}"]`);
  if (!ctx || !el) return;
  let { s, left } = rowState(ctx, key);
  if (key === "custom") {
    const named = (drafts.get(ctx.team.id)?.name ?? "").trim().length > 0;
    const gate = (x) => (named ? x : { ok: false, why: { key: "IPB.Up.needName", params: {} } });
    s = { ...s, start: gate(s.start), buy: gate(s.buy), grant: gate(s.grant) };
  }
  el.innerHTML = actionsHtml(ctx, key, s, left);
}

async function doAdd(root, key, source) {
  const ctx = CTX.get(root);
  if (!ctx || !ctx.canEdit) return;
  const custom = key === "custom";
  const { entry, s, power } = rowState(ctx, key);
  const d = drafts.get(ctx.team.id) ?? { name: "", note: "" };
  const name = custom ? d.name.trim() : entry?.name;
  if (!name) return;
  const gate = source === "start" ? s.start : s.grant;
  if (!gate.ok) { ctx.announce(ctx.t(gate.why.key, gate.why.params)); return; }
  const op = `add:${ctx.team.id}:${key}`;
  if (!startOp(op)) return;
  try {
    const id = await ctx.run(ctx.api.upgrades.add(ctx.team.id, custom ? "custom" : key, { source, power, name: custom ? name : "", note: custom ? d.note.trim() : "" }));
    if (!id) return;
    if (custom) { drafts.delete(ctx.team.id); for (const sel of ["name", "note"]) { const i = q(root, `[data-up-draft="${sel}"]`); if (i) i.value = ""; } paintActions(root, "custom"); }
    else if (power) { powers.delete(pk(ctx, key)); const i = q(root, `[data-up-power="${CSS.escape(key)}"]`); if (i) i.value = ""; }
    ctx.announce(ctx.t(source === "start" ? "IPB.Up.Added" : "IPB.Up.Granted", { name: power ? `${name} (${power})` : name }));
  } finally { busy.delete(op); }
}

async function doStatus(root, uid, status, label) {
  const ctx = CTX.get(root);
  if (!ctx || !ctx.isStaff) return;
  const u = ctx.B.upgrades[uid];
  if (!u || u.status === status) return;
  const res = await ctx.run(ctx.api.upgrades.setStatus(ctx.team.id, uid, status));
  if (res) ctx.announce(ctx.t(status === "active" && u.status === "installing" ? "IPB.Up.Installed" : "IPB.Up.StatusSet", { name: label ?? u.name, status: ctx.t(`IPB.Status.${status}`) }));
}

function setUndo(ctx, text, patch) {
  const prev = undoRec.get(ctx.team.id);
  if (prev) clearTimeout(prev.timer);
  const id = ctx.team.id;
  const timer = setTimeout(() => { undoRec.delete(id); CTX.get(rootOf(id))?.rerender?.(); }, UNDO_MS);
  undoRec.set(id, { text, patch, timer });
}
const ROOTS = new Map();                     // team id -> panel element (for the undo timer)
const rootOf = (id) => ROOTS.get(id);

async function doRemove(root, uid) {
  const ctx = CTX.get(root);
  if (!ctx) return;
  const u = ctx.B.upgrades[uid];
  if (!u) return;
  if (!(ctx.isStaff || (ctx.canEdit && u.source === "start"))) return;
  const op = `rm:${ctx.team.id}:${uid}`;
  if (!startOp(op)) return;
  try {
    const label = `${u.name}${u.power ? ` (${u.power})` : ""}`;
    const snapshot = foundry.utils.deepClone(ctx.B.upgrades[uid]);
    const one = u.count > 1;
    const res = await ctx.run(one ? ctx.api.upgrades.setCount(ctx.team.id, uid, u.count - 1) : ctx.api.upgrades.remove(ctx.team.id, uid));
    if (res === null) return;
    const text = ctx.t(one ? "IPB.Up.RemovedOne" : "IPB.Up.Removed", { name: label });
    setUndo(ctx, text, one ? { upgrades: { [uid]: { count: snapshot.count } } } : { upgrades: { [uid]: snapshot } });
    ctx.announce(text);
    CTX.get(root)?.rerender();
  } finally { busy.delete(op); }
}
async function doUndo(root) {
  const ctx = CTX.get(root);
  const rec = ctx && undoRec.get(ctx.team.id);
  if (!rec) return;
  clearTimeout(rec.timer); undoRec.delete(ctx.team.id);
  const res = await ctx.update(rec.patch);
  if (res) ctx.announce(ctx.t("IPB.Up.UndoDone"));
  CTX.get(root)?.rerender();
}

async function doAsk(root, key) {
  const ctx = CTX.get(root);
  if (!ctx || !ctx.canEdit) return;
  const { entry, s, power } = rowState(ctx, key);
  if (!entry || !s.buy.ok) { if (s.buy.why) ctx.announce(ctx.t(s.buy.why.key, s.buy.why.params)); return; }
  const op = `ask:${ctx.team.id}:${key}`;
  if (!startOp(op)) return;
  try {
    const what = ctx.t("IPB.Up.AskWhat", { name: power ? `${entry.name} (${power})` : entry.name, cost: s.cost.cost });
    const res = await ctx.run(ctx.api.relay.request("ask", { teamId: ctx.team.id, what }));
    if (res) { ui.notifications?.info(ctx.t("IPB.Up.AskSent"), { console: false }); ctx.announce(ctx.t("IPB.Up.AskSent")); }
  } finally { busy.delete(op); }
}

/* ----- pooled karma purchase (GM) */
async function doBuy(root, key) {
  const ctx = CTX.get(root);
  if (!ctx || !ctx.isStaff) return;
  const custom = key === "custom";
  const { entry, s, power } = rowState(ctx, key);
  const d = drafts.get(ctx.team.id) ?? { name: "", note: "" };
  const name = custom ? d.name.trim() : entry?.name;
  if (!name) return;
  if (!s.buy.ok) { ctx.announce(ctx.t(s.buy.why.key, s.buy.why.params)); return; }
  const op = `buy:${ctx.team.id}:${key}`;
  if (!startOp(op)) return;
  try {
    const label = power ? `${name} (${power})` : name;
    const picked = await poolDialog(ctx, { name: label, cost: s.cost.cost, kind: s.cost.kind });
    if (!picked) return;
    const out = await ctx.run(ctx.api.karma.buy(ctx.team.id, custom ? "custom" : key, picked.split, {
      power, name: custom ? name : "", note: custom ? d.note.trim() : "", cost: picked.cost !== s.cost.cost ? picked.cost : null
    }));
    if (!out) return;
    if (custom) { drafts.delete(ctx.team.id); for (const sel of ["name", "note"]) { const i = q(root, `[data-up-draft="${sel}"]`); if (i) i.value = ""; } paintActions(root, "custom"); }
    else if (power) { powers.delete(pk(ctx, key)); const i = q(root, `[data-up-power="${CSS.escape(key)}"]`); if (i) i.value = ""; }
    ctx.announce(ctx.t("IPB.Up.Bought", { name: label, cost: out.cost, split: U.formatSplit(out.split.map((x) => ({ id: x.actorId, amount: x.amount })), new Map(ctx.facts.map((m) => [m.id, m.name]))) }));
  } finally { busy.delete(op); }
}

async function poolDialog(ctx, spec) {
  const { esc, t } = ctx;
  const { DialogV2 } = foundry.applications.api;
  const facts = ctx.facts.map((m) => ({ ...m }));
  const uid = foundry.utils.randomID(6);
  const kindText = t(`IPB.Karma.Kind.${spec.kind === "tooPricey" ? "tooPricey" : spec.kind === "unknown" ? "unknown" : "normal"}`, { cost: P.COST.upgrade, pricey: P.COST.tooPricey });
  const rows = facts.map((m) => `<li class="ipb-kp-row">
      <label class="ipb-kp-name" for="${uid}-${esc(m.id)}">${esc(m.name)}</label>
      <span class="ipb-kp-has">${esc(t("IPB.Karma.Has", { karma: m.karma }))}</span>
      <input id="${uid}-${esc(m.id)}" type="number" inputmode="numeric" min="0" max="${m.karma}" step="1" value="0" data-kp-amt="${esc(m.id)}"${m.karma < 1 ? " disabled" : ""}>
      <span class="ipb-kp-after" data-kp-after="${esc(m.id)}"></span></li>`).join("");
  const content = `<div class="ipb-kp">
      <p class="ipb-kp-lede">${esc(t("IPB.Karma.Lede", { name: spec.name }))}</p>
      <label class="ipb-kp-cost"><span>${esc(t("IPB.Karma.CostLabel"))}</span><input type="number" inputmode="numeric" min="0" max="99" step="1" value="${spec.cost}" data-kp-cost></label>
      <p class="ipb-kp-hint">${esc(kindText)}</p>
      ${facts.length ? `<ul class="ipb-kp-list">${rows}</ul>` : `<p class="ipb-kp-warn">${esc(t("IPB.Karma.NoHeroes"))}</p>`}
      <div class="ipb-kp-sum"><p role="status" class="ipb-kp-pool" data-kp-pool></p><button type="button" class="ipb-kp-even" data-kp-even>${esc(t("IPB.Karma.Even"))}</button></div>
      <p class="ipb-kp-warn" role="status" data-kp-warn></p>
    </div>`;
  let read = () => null;
  const result = await DialogV2.wait({
    window: { title: t("IPB.Karma.Title", { name: spec.name }), icon: "fa-solid fa-coins" },
    classes: ["ipb-dialog", "ipb-kp-dialog"], position: { width: 540 },
    content,
    render: (_ev, dialog) => {
      const el = dialog.element ?? dialog;
      const buyBtn = el.querySelector('button[data-action="buy"]');
      const amts = [...el.querySelectorAll("[data-kp-amt]")];
      const costIn = el.querySelector("[data-kp-cost]");
      const poolEl = el.querySelector("[data-kp-pool]");
      const warnEl = el.querySelector("[data-kp-warn]");
      const cost = () => Math.max(0, Math.min(99, parseInt(costIn.value, 10) || 0));
      const split = () => amts.map((i) => ({ actorId: i.dataset.kpAmt, amount: Math.max(0, Math.min(Number(i.max) || 0, parseInt(i.value, 10) || 0)) }));
      const even = () => {
        const plan = P.planKarma(facts.map((m) => ({ id: m.id, karma: m.karma })), cost());
        // pool too small: offer everything the heroes have, so the GM sees how far short it is and can lower the price
        for (const i of amts) i.value = String(plan ? (plan.find((p) => p.actorId === i.dataset.kpAmt)?.amount ?? 0) : (facts.find((m) => m.id === i.dataset.kpAmt)?.karma ?? 0));
      };
      const refresh = () => {
        const c = cost(), sp = split(), total = sp.reduce((n, x) => n + x.amount, 0);
        const pool = facts.reduce((n, m) => n + m.karma, 0);
        for (const r of U.previewKarma(facts, sp)) { const a = el.querySelector(`[data-kp-after="${CSS.escape(String(r.id))}"]`); if (a) a.textContent = t("IPB.Karma.After", { after: r.after }); }
        poolEl.textContent = t("IPB.Karma.Pool", { total, cost: c });
        poolEl.dataset.ok = String(total === c);
        const missing = c - total;
        warnEl.textContent = pool < c ? t("IPB.Karma.Short", { pool, missing: c - pool }) : missing > 0 ? t("IPB.Karma.Missing", { n: missing }) : missing < 0 ? t("IPB.Karma.TooMuch", { n: -missing }) : "";
        const ok = total === c && pool >= c;
        const names = U.formatSplit(sp.map((x) => ({ ...x, name: facts.find((m) => m.id === x.actorId)?.name })));
        if (buyBtn) { buyBtn.disabled = !ok; buyBtn.setAttribute("aria-disabled", String(!ok)); buyBtn.textContent = ok && names ? t("IPB.Karma.Confirm", { name: spec.name, split: names }) : t("IPB.Karma.ConfirmBare", { name: spec.name }); }
      };
      read = () => { const c = cost(), sp = split(); return P.validateSplit(sp, facts, c).ok ? { cost: c, split: sp.filter((x) => x.amount > 0) } : null; };
      el.addEventListener("input", (ev) => { if (ev.target === costIn) even(); refresh(); });
      el.querySelector("[data-kp-even]")?.addEventListener("click", () => { even(); refresh(); });
      even(); refresh();
    },
    buttons: [
      { action: "buy", label: t("IPB.Karma.ConfirmBare", { name: spec.name }), default: true, callback: () => read() },
      { action: "cancel", label: t("IPB.Karma.Cancel"), callback: () => null }
    ],
    rejectClose: false, modal: false
  });
  return result && typeof result === "object" ? result : null;
}

/* ----- adopt upgrade names from the heroes' Team base text */
async function doAdopt(root) {
  const ctx = CTX.get(root);
  if (!ctx || !ctx.canEdit) return;
  const miss = adoptCandidates(ctx);
  if (!miss.length) return;
  const { esc, t, tn } = ctx;
  const a = P.allowance(ctx.B.rank, ctx.B.upgrades);
  const total = miss.reduce((n, u) => n + u.count, 0);
  const fits = total <= a.left;
  const { DialogV2 } = foundry.applications.api;
  const list = `<ul class="ipb-kp-adopt-list">${miss.map((u) => `<li>${esc(P.formatUpgrade(u))}</li>`).join("")}</ul>`;
  const asStart = `<label class="ipb-radio"><input type="radio" name="as" value="start"${fits || !ctx.isStaff ? " checked" : ""}> <span>${esc(t("IPB.Up.AdoptStart", { left: a.left }))}</span></label>`;
  const asGm = ctx.isStaff ? `<label class="ipb-radio"><input type="radio" name="as" value="gm"${fits ? "" : " checked"}> <span>${esc(t("IPB.Up.AdoptGm"))}</span></label>` : "";
  const as = await DialogV2.wait({
    window: { title: t("IPB.Up.AdoptTitle"), icon: "fa-solid fa-file-import" }, classes: ["ipb-dialog", "ipb-kp-dialog"], position: { width: 500 },
    content: `<div class="ipb-kp"><p class="ipb-kp-lede">${esc(t("IPB.Up.AdoptReads"))}</p>${list}<fieldset class="ipb-kp-as"><legend>${esc(t("IPB.Up.AdoptAs"))}</legend>${asStart}${asGm}</fieldset></div>`,
    buttons: [
      { action: "yes", label: tn("IPB.Up.AdoptYes", miss.length), default: true, callback: (_ev, button) => button.form?.elements?.as?.value ?? "start" },
      { action: "no", label: t("IPB.Up.AdoptNo"), callback: () => null }
    ],
    rejectClose: false, modal: false
  });
  if (as !== "start" && as !== "gm") return;
  if (as === "gm" && !ctx.isStaff) return;
  const fresh = ctx.api.get(ctx.team.id);
  if (!fresh) return;
  const patch = { upgrades: {} };
  let sort = P.nextSort(fresh.upgrades);
  for (const u of miss) {
    const def = u.key !== "custom" ? entryOf(u.key) : null;
    patch.upgrades[foundry.utils.randomID(16)] = { key: def?.key ?? "custom", name: def?.name ?? u.name, count: u.count, power: u.power, status: "active", source: as, paid: 0, note: "", sort: sort++, at: Date.now() };
  }
  const res = await ctx.run(ctx.update(patch));
  if (res) ctx.announce(tn("IPB.Up.AdoptDone", miss.length));
}

/* ------------------------------------------------------------------ delegated events */
function bind(root) {
  root.addEventListener("click", (ev) => {
    const el = ev.target instanceof Element ? ev.target.closest("[data-up-act]") : null;
    if (!el || !root.contains(el)) return;
    const act = el.dataset.upAct;
    if (el.getAttribute("aria-disabled") === "true") {            // a refused action says why instead of doing nothing
      const ctx = CTX.get(root);
      const why = el.closest("[data-up-actions]")?.querySelector(".ipb-up-why");
      if (ctx && why) ctx.announce(why.textContent.trim());
      return;
    }
    const key = el.dataset.key, uid = el.dataset.uid;
    if (act === "pick") doAdd(root, key, "start");
    else if (act === "grant") doAdd(root, key, "gm");
    else if (act === "buy") doBuy(root, key);
    else if (act === "ask") doAsk(root, key);
    else if (act === "installed" || act === "repair") doStatus(root, uid, "active");
    else if (act === "remove") doRemove(root, uid);
    else if (act === "undo") doUndo(root);
    else if (act === "adopt") doAdopt(root);
  });
  root.addEventListener("input", (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    const ctx = CTX.get(root);
    if (!el || !ctx) return;
    if (el.matches("[data-up-filter]")) {
      filters.set(ctx.team.id, el.value);
      const box = q(root, "[data-up-catalog]");
      const a = P.allowance(ctx.B.rank, ctx.B.upgrades);
      if (box && cat.list?.length) box.innerHTML = catalogListHtml(ctx, P.sortedList(ctx.B.upgrades), a.left, el.value);
    } else if (el.matches("[data-up-power]")) {
      powers.set(pk(ctx, el.dataset.upPower), el.value);
      paintActions(root, el.dataset.upPower);
    } else if (el.matches("[data-up-draft]")) {
      const d = drafts.get(ctx.team.id) ?? { name: "", note: "" };
      d[el.dataset.upDraft] = el.value;
      drafts.set(ctx.team.id, d);
      paintActions(root, "custom");
    }
  });
  root.addEventListener("change", (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    const ctx = CTX.get(root);
    if (!el || !ctx) return;
    if (el.matches("[data-up-status]")) doStatus(root, el.dataset.upStatus, el.value);
    else if (el.matches("[data-up-note]")) {
      const uid = el.dataset.upNote;
      const u = ctx.B.upgrades[uid];
      if (u && el.value !== u.note) ctx.run(ctx.api.upgrades.setNote(ctx.team.id, uid, el.value.trim()));
    }
  });
  root.addEventListener("keydown", (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    if (!el || !el.matches("input.ipb-input")) return;
    if (ev.key === "Enter") { ev.preventDefault(); if (!el.matches("[data-up-filter]")) el.blur(); }
    else if (ev.key === "Escape") {
      ev.stopPropagation();                                           // the core closes the window on Escape otherwise
      const ctx = CTX.get(root);
      if (el.matches("[data-up-filter]")) { el.value = ""; filters.set(ctx.team.id, ""); el.dispatchEvent(new Event("input", { bubbles: true })); }
      else if (el.matches("[data-up-note]")) el.value = ctx?.B.upgrades[el.dataset.upNote]?.note ?? el.value;
      el._upEsc = true;
    }
  });
  root.addEventListener("keyup", (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    if (ev.key === "Escape" && el?._upEsc) { ev.stopPropagation(); el._upEsc = false; if (!el.matches("[data-up-filter]")) el.blur(); }
  });
}

export const upgrades = {
  id: "upgrades",
  icon: "fa-solid fa-screwdriver-wrench",
  badge: (ctx) => { const n = U.ownedCount(P.sortedList(ctx.B.upgrades)); return n || ""; },
  render,
  mount(ctx, root) {
    CTX.set(root, ctx);
    ROOTS.set(ctx.team.id, root);
    if (!BOUND.has(root)) { BOUND.add(root); bind(root); }
    ensureCatalog(root);                       // the effect sentences are shown to everybody who can read the card
    if (ctx.canEdit) ensureRecs(root);
  }
};
export default upgrades;
