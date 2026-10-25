/* Step "powers" (phase 5b): the hero's powers, their levels, boosts and limits, and the power source(s).
   Layout (one column that scrolls in the wizard body): sticky slot / budget meter -> "Your powers" cards -> "Power source" -> "Add a power" catalogue.
   RULES (all arithmetic lives in rules.mjs, this file only asks it): a level and a boost each cost one slot, a limit is free but must pay for
   a level step or a boost of the same power; Massive only for Cosmic Champions, Monstrous never; every slot above the rank costs 2 attribute
   points, every free slot gives 2; an extra source costs 1 point. Adding is refused only when fewer than 6 attribute points would remain (the
   rest is shown as warnings by validateStep).
   DATA: names come from the installed core packs through ctx.catalog (powers 69, boosts / limits by power name, 36 sources). Book descriptions are
   read at RUNTIME from the pack documents (fromUuid), only for the rows on screen (3-4 at a time), cached per window, never copied into the module.
   The long lists are paged (12 rows) and filtered locally; typing in a search box repaints only the list, never the whole step.
   DICE: random power / random source / random boost draw from seeded substreams (seed + state.rerolls counter), so undo + re-roll gives the same
   result. "From archetype" badges: a power / source whose name matches the applied archetype's book suggestion. */
import { t } from "../lang.mjs";
import { ATTRS, ATTR_MIN, SLOT_VALUE, levelCap, powerMaxLevel, slots, budget, powerSlots, validateStep, normName } from "../rules.mjs";
import { addPower, removePower, setPowerLevel, setPowerSource, addBoost, removeBoost, addLimit, removeLimit, addSource, removeSource } from "../state.mjs";
import { substream } from "../rng.mjs";
import { esc, icon, msgText, delegate, levelName } from "./util.mjs";
import { slug, enrich, descBlock, rowLinks, chip, openBook } from "./shared.mjs";   // shared with the talents step (5c)

const PAGE = 12;
const TYPES = ["Attack", "Control", "Defense", "Modification", "Movement", "Sensory"];
const LV_WORDS = ["basic", "major", "massive", "monstrous"];
const nm = normName;
const MIN_BUDGET = ATTRS.length * ATTR_MIN;

/* ---------------------------------------------------------------- helpers on the state */
const norm = nm;
const catOf = (d, name) => d.cat.get(norm(name)) ?? null;
/** would `extraSlots` more slots / `extraSources` more sources still leave an attribute budget the six attributes can hold? */
const guardOk = (s, extraSlots, extraSources = 0) => budget(s) - SLOT_VALUE * extraSlots - extraSources >= MIN_BUDGET;
const said = (ctx, text) => { ctx.data.msg = text; };

/** which of a power's limits pay for nothing (same counting as rules.validate) */
function badLimits(p) {
  const bad = new Set();
  let cl = 0, cb = 0;
  (p.limits ?? []).forEach((l, i) => {
    if (l.grants === "level") { if (++cl > (p.level ?? 0)) bad.add(i); }
    else if (l.grants === "boost") { if (++cb > (p.boosts ?? []).length) bad.add(i); }
    else bad.add(i);
  });
  return bad;
}
const limitRoom = (p) => {
  const lim = p.limits ?? [];
  return {
    level: (p.level ?? 0) - lim.filter((l) => l.grants === "level").length > 0,
    boost: (p.boosts ?? []).length - lim.filter((l) => l.grants === "boost").length > 0
  };
};

/** put a source into the state: replace `targetKey`, or add (the first one also takes every power that has none yet) */
function putSource(st, entry, targetKey) {
  const ref = { name: entry.name, packUuid: entry.packUuid ?? null };
  if (targetKey && st.sources.some((x) => x.key === targetKey)) return { ...st, sources: st.sources.map((x) => (x.key === targetKey ? { ...x, ...ref } : x)) };
  const first = !st.sources.length;
  let ns = addSource(st, ref);
  if (first) { const key = ns.sources[0].key; ns = { ...ns, powers: ns.powers.map((p) => (p.sourceKey ? p : { ...p, sourceKey: key })) }; }
  return ns;
}

/* ---------------------------------------------------------------- pieces of the page */
function status(ctx) {
  const iss = validateStep(ctx.state, "powers");
  if (!iss.issues.length) return `<p class="ipc-status ipc-ok">${icon("fa-solid fa-circle-check")} ${esc(t("IPC.Step.StatusOk"))}</p>`;
  return `<ul class="ipc-status-list">${iss.issues.map((i) => `<li class="${i.severity === "error" ? "ipc-iss-err" : "ipc-iss-warn"}">${icon("fa-solid fa-circle-exclamation")}<span>${esc(msgText(i))}</span></li>`).join("")}</ul>`;
}

function meter(ctx) {
  const s = ctx.state, r = ctx.rank, S = slots(s), N = r.powers, b = budget(s), ab = ctx.budget;
  const cells = Math.max(N, S, 1);
  const cellHtml = Array.from({ length: cells }, (_, i) => `<i class="ipc-pw-cell${i < S ? " is-used" : ""}${i >= N ? " is-extra" : ""}"></i>`).join("");
  const parts = [t("IPC.Powers.Meter.Base", { n: r.points })];
  if (S < N) parts.push(t("IPC.Powers.Meter.Free", { pts: SLOT_VALUE * (N - S), n: N - S }));
  else if (S > N) parts.push(t("IPC.Powers.Meter.Over", { pts: SLOT_VALUE * (S - N), n: S - N }));
  const x = Math.max(0, s.sources.length - 1), e = s.extraTalents.length, dr = s.drawbacks.length;
  if (x) parts.push(t("IPC.Powers.Meter.Sources", { n: x }));
  if (e) parts.push(t("IPC.Powers.Meter.Talents", { n: e }));
  if (dr) parts.push(t("IPC.Powers.Meter.Drawbacks", { n: dr }));
  const placed = ab.left === 0 ? t("IPC.Powers.Meter.PlacedOk", { spent: ab.spent }) : ab.left > 0 ? t("IPC.Powers.Meter.PlacedLeft", { spent: ab.spent, left: ab.left }) : t("IPC.Powers.Meter.PlacedOver", { spent: ab.spent, over: -ab.left });
  return `<div class="ipc-pw-meter${S > N ? " is-over" : ""}" role="group" aria-label="${esc(t("IPC.Powers.Meter.Label"))}">
    <div class="ipc-pw-m-slots"><b>${S}</b><span>${esc(t("IPC.Powers.Meter.Of", { max: N }))}</span><span class="ipc-pw-cells" aria-hidden="true">${cellHtml}</span></div>
    <div class="ipc-pw-m-text">
      <p><strong>${esc(t("IPC.Powers.Meter.Need", { budget: b }))}</strong> <span class="ipc-muted">${esc(t("IPC.Powers.Meter.Cap", { cap: r.cap }))}</span></p>
      <p class="ipc-pw-msg" role="status">${ctx.data.msg ? `${icon("fa-solid fa-circle-info")} ${esc(ctx.data.msg)}` : ""}</p>
    </div>
  </div>
  <p class="ipc-pw-parts">${esc(parts.join("  ·  "))}. ${esc(placed)} <button type="button" class="ipc-link" data-act="go-attr" data-fk="go-attr">${esc(t("IPC.Powers.Meter.GoAttr"))}</button></p>`;
}

function levelGroup(ctx, p) {
  const s = ctx.state, cap = levelCap(s.rank), ent = catOf(ctx.data, p.name);
  const opts = LV_WORDS.map((w, i) => {
    let why = "";
    if (i === 3) why = t("IPC.Powers.Lv.NoMonstrous");
    else if (i > cap) why = t("IPC.Powers.Lv.NoCosmic");
    else if (Number.isInteger(ent?.maxLevel ?? powerMaxLevel(p)) && i > (ent?.maxLevel ?? powerMaxLevel(p))) why = (ent?.maxLevel ?? powerMaxLevel(p)) === 0 ? t("IPC.Powers.Lv.BasicOnly") : t("IPC.Powers.Lv.NoLevel");   // B2: only the levels the book defines
    else if (ent?.split && !ent.levels[w]) why = t("IPC.Powers.Lv.NoDoc");
    else if (i > p.level && !guardOk(s, i - p.level)) why = t("IPC.Powers.NoBudget");
    const on = p.level === i;
    return `<label class="ipc-lvl${on ? " is-on" : ""}${why ? " is-off" : ""}"${why ? ` data-tooltip="${esc(why)}"` : ""}>
      <input type="radio" name="lv-${esc(p.key)}" value="${i}" data-fk="lv-${esc(p.key)}-${i}"${on ? " checked" : ""}${why && !on ? " disabled" : ""}>
      <span class="ipc-lvl-name">${esc(levelName(i))}</span><small>${esc(t("IPC.Powers.Lv.Cost", { n: i + 1 }))}</small>${why && !on ? `<span class="ipc-sr">, ${esc(why)}</span>` : ""}
    </label>`;
  }).join("");
  return `<fieldset class="ipc-pw-lv"><legend>${esc(t("IPC.Powers.Level"))}</legend><div class="ipc-lvls">${opts}</div></fieldset>`;
}

function sourceCell(ctx, p) {
  const s = ctx.state;
  if (s.sources.length >= 2) {
    return `<div class="ipc-pw-src"><label class="ipc-field"><span>${esc(t("IPC.Powers.Source"))}</span><select class="ipc-input" name="srcfor-${esc(p.key)}" data-fk="srcfor-${esc(p.key)}">${s.sources.map((x) => `<option value="${esc(x.key)}"${x.key === p.sourceKey ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label></div>`;
  }
  const only = s.sources[0];
  return `<div class="ipc-pw-src"><span class="ipc-pw-src-l">${esc(t("IPC.Powers.Source"))}</span><span class="${only ? "" : "ipc-muted"}">${esc(only ? only.name : t("IPC.Powers.SourceNone"))}</span></div>`;
}

function pickerRows(ctx, p, kind) {
  const d = ctx.data, list = (kind === "boost" ? d.boostCache : d.limitCache).get(norm(p.name));
  if (!list) return `<p class="ipc-loading">${icon("fa-solid fa-spinner fa-spin-pulse")} ${esc(t("IPC.Powers.Loading"))}</p>`;
  const used = new Set((kind === "boost" ? p.boosts : p.limits).map((x) => norm(x.name)));
  const avail = list.filter((e) => !used.has(norm(e.name)));
  if (!avail.length) return `<p class="ipc-muted">${esc(t(kind === "boost" ? "IPC.Powers.BoostEmpty" : "IPC.Powers.LimitEmpty"))}</p>`;
  const grants = d.pick.grants, room = limitRoom(p);
  const can = kind === "boost" ? guardOk(ctx.state, 1) : !!grants && room[grants];
  return `<ul class="ipc-pw-rows ipc-pw-rows-sm">${avail.map((e) => `<li class="ipc-pw-row">
      <div class="ipc-pw-row-main"><span class="ipc-pw-name">${esc(e.name.replace(/\s*\([^)]*\)\s*$/, ""))}</span>${descBlock(d, e.packUuid)}${rowLinks(d, e.packUuid, e.name)}</div>
      <button type="button" class="ipc-btn ipc-btn-small" data-act="${kind === "boost" ? "add-boost" : "add-limit"}" data-key="${esc(p.key)}" data-name="${esc(e.name)}" data-uuid="${esc(e.packUuid ?? "")}" data-fk="${kind}-${esc(p.key)}-${esc(slug(e.name))}"${can ? "" : ' aria-disabled="true"'}>${icon("fa-solid fa-plus")} ${esc(t(kind === "boost" ? "IPC.Powers.BoostTake" : "IPC.Powers.LimitTake"))}</button>
    </li>`).join("")}</ul>`;
}

function boostBlock(ctx, p) {
  const d = ctx.data, open = d.pick?.key === p.key && d.pick.name === p.name && d.pick.kind === "boost";
  const chips = p.boosts.map((b, i) => chip(esc(b.name), t("IPC.Powers.BoostRemoveAria", { name: b.name }), "rm-boost", `data-key="${esc(p.key)}" data-i="${i}" data-fk="rmb-${esc(p.key)}-${i}"`)).join("");
  return `<div class="ipc-pw-blk">
    <div class="ipc-pw-blk-head"><h5>${esc(t("IPC.Powers.Boosts"))}</h5><span class="ipc-muted">${esc(t("IPC.Powers.BoostCost"))}</span>
      <button type="button" class="ipc-btn ipc-btn-small" data-act="pick" data-kind="boost" data-key="${esc(p.key)}" data-fk="pick-b-${esc(p.key)}" aria-expanded="${open}">${icon(open ? "fa-solid fa-chevron-up" : "fa-solid fa-plus")} ${esc(t(open ? "IPC.Powers.Close" : "IPC.Powers.BoostAdd"))}</button></div>
    ${p.boosts.length ? `<ul class="ipc-chips">${chips}</ul>` : `<p class="ipc-muted ipc-pw-none">${esc(t("IPC.Powers.BoostNone"))}</p>`}
    ${open ? `<div class="ipc-pw-picker"><div class="ipc-pw-picker-head"><button type="button" class="ipc-btn ipc-btn-small" data-act="rand-boost" data-key="${esc(p.key)}" data-fk="rand-b-${esc(p.key)}">${icon("fa-solid fa-dice")} ${esc(t("IPC.Powers.BoostRoll"))}</button></div>${pickerRows(ctx, p, "boost")}</div>` : ""}
  </div>`;
}

function limitBlock(ctx, p) {
  const d = ctx.data, open = d.pick?.key === p.key && d.pick.name === p.name && d.pick.kind === "limit", bad = badLimits(p), room = limitRoom(p);
  const chips = p.limits.map((l, i) => chip(`${esc(l.name)} <small>${esc(l.grants ? t(`IPC.Powers.PaysChip.${l.grants}`) : t("IPC.Powers.PaysChip.none"))}</small>${bad.has(i) ? ` ${icon("fa-solid fa-triangle-exclamation")}` : ""}`, t("IPC.Powers.LimitRemoveAria", { name: l.name }), "rm-limit", `data-key="${esc(p.key)}" data-i="${i}" data-fk="rml-${esc(p.key)}-${i}"`, bad.has(i) ? " is-bad" : "")).join("");
  let picker = "";
  if (open) {
    const g = d.pick.grants;
    const radio = (v) => {
      const ok = room[v];
      return `<label class="ipc-lvl${g === v ? " is-on" : ""}${ok ? "" : " is-off"}"><input type="radio" name="pick-grants-${esc(p.key)}" value="${v}" data-fk="pg-${esc(p.key)}-${v}"${g === v ? " checked" : ""}${ok ? "" : " disabled"}><span class="ipc-lvl-name">${esc(t(`IPC.Powers.Pays.${v}`))}</span>${ok ? "" : `<small>${esc(t(v === "level" ? "IPC.Powers.PaysNeedLevel" : "IPC.Powers.PaysNeedBoost"))}</small>`}</label>`;
    };
    picker = `<div class="ipc-pw-picker"><p class="ipc-muted ipc-pw-hintline">${esc(t("IPC.Powers.LimitHint"))}</p>
      <fieldset class="ipc-pw-lv"><legend>${esc(t("IPC.Powers.PaysFor"))}</legend><div class="ipc-lvls">${radio("level")}${radio("boost")}</div></fieldset>
      ${room.level || room.boost ? pickerRows(ctx, p, "limit") : `<p class="ipc-note-box">${esc(t("IPC.Powers.LimitNoRoom"))}</p>`}</div>`;
  }
  return `<div class="ipc-pw-blk">
    <div class="ipc-pw-blk-head"><h5>${esc(t("IPC.Powers.Limits"))}</h5><span class="ipc-muted">${esc(t("IPC.Powers.LimitFree"))}</span>
      <button type="button" class="ipc-btn ipc-btn-small" data-act="pick" data-kind="limit" data-key="${esc(p.key)}" data-fk="pick-l-${esc(p.key)}" aria-expanded="${open}">${icon(open ? "fa-solid fa-chevron-up" : "fa-solid fa-plus")} ${esc(t(open ? "IPC.Powers.Close" : "IPC.Powers.LimitAdd"))}</button></div>
    ${p.limits.length ? `<ul class="ipc-chips">${chips}</ul>` : `<p class="ipc-muted ipc-pw-none">${esc(t("IPC.Powers.LimitNone"))}</p>`}
    ${bad.size ? `<p class="ipc-error ipc-pw-bad" role="alert">${icon("fa-solid fa-triangle-exclamation")} ${esc(t("IPC.Powers.LimitBad"))}</p>` : ""}
    ${picker}
  </div>`;
}

function powerCard(ctx, p) {
  const d = ctx.data, ent = catOf(d, p.name);
  const fromArch = d.archNames?.has(norm(p.name));
  const landed = d.landed === `p:${p.key}`;
  return `<li class="ipc-pw-card${landed ? " ipc-landed" : ""}" data-key="${esc(p.key)}">
    <div class="ipc-pw-card-head">
      <h4 class="ipc-pw-cname">${esc(p.name)}</h4>
      ${ent ? `<span class="ipc-pw-type">${esc(t(`IPC.Powers.Type.${ent.type}`))}</span>` : `<span class="ipc-pw-type ipc-pw-unknown">${esc(t("IPC.Powers.Unknown"))}</span>`}
      ${fromArch ? `<span class="ipc-pw-badge">${icon("fa-solid fa-scroll")} ${esc(t("IPC.Powers.FromArchetype"))}</span>` : ""}
      <span class="ipc-pw-slotchip">${esc(t("IPC.Powers.SlotsN", { n: powerSlots(p) }))}</span>
      <button type="button" class="ipc-btn ipc-btn-small ipc-btn-danger" data-act="remove-power" data-key="${esc(p.key)}" data-fk="rm-${esc(p.key)}" aria-label="${esc(t("IPC.Powers.RemoveAria", { name: p.name }))}">${icon("fa-solid fa-trash")} ${esc(t("IPC.Powers.Remove"))}</button>
    </div>
    <div class="ipc-pw-card-grid">${levelGroup(ctx, p)}${sourceCell(ctx, p)}</div>
    ${boostBlock(ctx, p)}
    ${limitBlock(ctx, p)}
  </li>`;
}

function minePanel(ctx) {
  const s = ctx.state;
  return `<section class="ipc-pw-sec" aria-labelledby="ipc-pw-h-mine">
    <div class="ipc-cn-head"><h3 id="ipc-pw-h-mine" tabindex="-1">${esc(t("IPC.Powers.Mine"))} <span class="ipc-muted ipc-pw-count">${esc(t("IPC.Powers.MineCount", { n: s.powers.length }))}</span></h3></div>
    <p class="ipc-cn-sub">${esc(t("IPC.Powers.LevelsNote"))}</p>
    ${s.powers.length ? `<ul class="ipc-pw-cards">${s.powers.map((p) => powerCard(ctx, p)).join("")}</ul>` : `<div class="ipc-note-box ipc-pw-empty">${icon("fa-solid fa-bolt")} ${esc(t("IPC.Powers.Empty"))}</div>`}
  </section>`;
}

/* ---- power sources */
function sourceRows(ctx) {
  const d = ctx.data, q = norm(d.sq), s = ctx.state;
  const have = new Set(s.sources.map((x) => norm(x.name)));
  const all = d.sources.filter((e) => !q || norm(e.name).includes(q));
  const shown = all.slice(0, d.slimit);
  const verb = targetVerb(ctx);
  const rows = shown.map((e) => {
    const taken = have.has(norm(e.name));
    return `<li class="ipc-pw-row${taken ? " is-added" : ""}">
      <div class="ipc-pw-row-main"><span class="ipc-pw-name">${esc(e.name)}</span>${descBlock(d, e.packUuid)}${rowLinks(d, e.packUuid, e.name)}</div>
      <button type="button" class="ipc-btn ipc-btn-small${taken ? "" : " ipc-btn-primary"}" data-act="src-use" data-name="${esc(e.name)}" data-uuid="${esc(e.packUuid ?? "")}" data-fk="srcuse-${esc(slug(e.name))}"${taken ? ' aria-disabled="true"' : ""}>${taken ? icon("fa-solid fa-check") : icon("fa-solid fa-plus")} ${esc(taken ? t("IPC.Powers.Cat.Added") : verb)}</button>
    </li>`;
  }).join("");
  const more = all.length > shown.length ? `<li class="ipc-pw-morerow"><button type="button" class="ipc-btn ipc-btn-small" data-act="src-more" data-fk="src-more">${esc(t("IPC.Powers.Cat.More", { n: all.length - shown.length }))}</button></li>` : "";
  return rows ? rows + more : `<li class="ipc-muted ipc-pw-none">${esc(t("IPC.Powers.Cat.None", { q: d.sq }))}</li>`;
}
function targetVerb(ctx) {
  const d = ctx.data, s = ctx.state;
  if (d.target && s.sources.some((x) => x.key === d.target)) return t("IPC.Powers.Src.Replace");
  return s.sources.length ? t("IPC.Powers.Src.UseExtra") : t("IPC.Powers.Src.Use");
}
function targetLine(ctx) {
  const d = ctx.data, s = ctx.state, cur = d.target ? s.sources.find((x) => x.key === d.target) : null;
  if (cur) return `<p class="ipc-pw-target">${icon("fa-solid fa-pen")} ${esc(t("IPC.Powers.Src.TargetChange", { name: cur.name }))} <button type="button" class="ipc-link" data-act="src-cancel" data-fk="src-cancel">${esc(t("IPC.Powers.Src.Cancel"))}</button></p>`;
  return `<p class="ipc-pw-target">${icon("fa-solid fa-arrow-right")} ${esc(s.sources.length ? t("IPC.Powers.Src.TargetExtra") : t("IPC.Powers.Src.TargetFirst"))}</p>`;
}

function sourcePanel(ctx) {
  const d = ctx.data, s = ctx.state;
  const chips = s.sources.map((x) => {
    const n = s.powers.filter((p) => p.sourceKey === x.key).length;
    const arch = d.suggestNames?.has(norm(x.name));
    return `<li class="ipc-src-item">
      <span class="ipc-src-name">${esc(x.name)}</span>
      ${arch ? `<span class="ipc-pw-badge">${icon("fa-solid fa-scroll")} ${esc(t("IPC.Powers.FromArchetype"))}</span>` : ""}
      <span class="ipc-muted ipc-src-use">${esc(n ? t("IPC.Powers.Src.UsedBy", { n }) : t("IPC.Powers.Src.Unused"))}</span>
      <button type="button" class="ipc-btn ipc-btn-small" data-act="src-change" data-key="${esc(x.key)}" data-fk="srcch-${esc(x.key)}" aria-label="${esc(t("IPC.Powers.Src.ChangeAria", { name: x.name }))}">${esc(t("IPC.Powers.Src.Change"))}</button>
      <button type="button" class="ipc-btn ipc-btn-small ipc-btn-danger" data-act="src-remove" data-key="${esc(x.key)}" data-fk="srcrm-${esc(x.key)}" aria-label="${esc(t("IPC.Powers.Src.RemoveAria", { name: x.name }))}">${icon("fa-solid fa-trash")}</button>
    </li>`;
  }).join("");
  const sug = (d.suggest ?? []).filter((e) => !s.sources.some((x) => norm(x.name) === norm(e.name)));
  return `<section class="ipc-pw-sec" aria-labelledby="ipc-pw-h-src">
    <div class="ipc-cn-head"><h3 id="ipc-pw-h-src" tabindex="-1">${esc(t("IPC.Powers.Src.Title"))}</h3>
      <button type="button" class="ipc-btn ipc-btn-small" data-act="src-roll" data-fk="src-roll" data-tooltip="${esc(t("IPC.Powers.Src.RollTip"))}">${icon("fa-solid fa-dice")} ${esc(t("IPC.Powers.Src.Roll"))}</button></div>
    <p class="ipc-cn-sub">${esc(t("IPC.Powers.Src.Hint"))}</p>
    ${s.sources.length ? `<ul class="ipc-src-list">${chips}</ul>` : `<p class="ipc-note-box">${icon("fa-solid fa-circle-info")} ${esc(t("IPC.Powers.Src.None"))}</p>`}
    ${targetLine(ctx)}
    ${sug.length ? `<div class="ipc-pw-suggest"><span class="ipc-muted">${esc(t("IPC.Powers.Src.Suggested", { name: s.archetype ?? "" }))}</span> ${sug.map((e) => `<button type="button" class="ipc-btn ipc-btn-small" data-act="src-use" data-name="${esc(e.name)}" data-uuid="" data-fk="srcsug-${esc(slug(e.name))}">${icon("fa-solid fa-scroll")} ${esc(e.name)}</button>`).join(" ")}</div>` : ""}
    <div class="ipc-pw-custom"><label class="ipc-field"><span>${esc(t("IPC.Powers.Src.Custom"))}</span><input type="text" class="ipc-input" name="src-custom" data-fk="src-custom" maxlength="80" value="${esc(d.custom)}" placeholder="${esc(t("IPC.Powers.Src.CustomPh"))}" autocomplete="off"></label>
      <button type="button" class="ipc-btn" data-act="src-custom" data-fk="src-custom-add">${esc(t("IPC.Powers.Src.CustomAdd"))}</button></div>
    <div class="ipc-pw-search"><label class="ipc-field"><span>${esc(t("IPC.Powers.Src.Search", { n: d.sources.length }))}</span><input type="search" class="ipc-input" name="src-q" data-fk="src-q" value="${esc(d.sq)}" autocomplete="off"></label></div>
    <ul class="ipc-pw-rows ipc-pw-src-rows" data-list="src">${sourceRows(ctx)}</ul>
  </section>`;
}

/* ---- the catalogue of powers */
function catalogRows(ctx) {
  const d = ctx.data, s = ctx.state, q = norm(d.q);
  const have = new Set(s.powers.map((p) => norm(p.name)));
  const all = d.powers.filter((p) => (d.type === "all" || p.type === d.type) && (!q || norm(p.name).includes(q)));
  const shown = all.slice(0, d.limit);
  const rows = shown.map((e) => {
    const on = have.has(norm(e.name));
    return `<li class="ipc-pw-row${on ? " is-added" : ""}">
      <div class="ipc-pw-row-main"><div class="ipc-pw-row-head"><span class="ipc-pw-name">${esc(e.name)}</span><span class="ipc-pw-type">${esc(t(`IPC.Powers.Type.${e.type}`))}</span>${e.split ? `<span class="ipc-pw-type">${esc(t("IPC.Powers.Levels"))}</span>` : ""}</div>${descBlock(d, e.packUuid)}${rowLinks(d, e.packUuid, e.name)}</div>
      <button type="button" class="ipc-btn ipc-btn-small${on ? "" : " ipc-btn-primary"}" data-act="toggle-power" data-name="${esc(e.name)}" data-fk="pw-${esc(slug(e.name))}" aria-pressed="${on}" aria-label="${esc(t(on ? "IPC.Powers.Cat.RemoveAria" : "IPC.Powers.Cat.AddAria", { name: e.name }))}">${icon(on ? "fa-solid fa-check" : "fa-solid fa-plus")} ${esc(t(on ? "IPC.Powers.Cat.Added" : "IPC.Powers.Cat.Add"))}</button>
    </li>`;
  }).join("");
  const more = all.length > shown.length ? `<li class="ipc-pw-morerow"><button type="button" class="ipc-btn ipc-btn-small" data-act="cat-more" data-fk="cat-more">${esc(t("IPC.Powers.Cat.More", { n: all.length - shown.length }))}</button></li>` : "";
  d.count = all.length;
  return rows ? rows + more : `<li class="ipc-muted ipc-pw-none">${esc(t("IPC.Powers.Cat.None", { q: d.q }))}</li>`;
}

function catalogPanel(ctx) {
  const d = ctx.data;
  const rows = catalogRows(ctx);
  const types = ["all", ...TYPES].map((ty) => `<label class="ipc-opt ipc-opt-chip${d.type === ty ? " is-on" : ""}"><input type="radio" name="pwtype" value="${ty}" data-fk="pwtype-${ty}"${d.type === ty ? " checked" : ""}><span class="ipc-opt-text"><span class="ipc-opt-name">${esc(ty === "all" ? t("IPC.Powers.Cat.All") : t(`IPC.Powers.Type.${ty}`))}</span></span>${icon("fa-solid fa-check ipc-opt-check")}</label>`).join("");
  return `<section class="ipc-pw-sec" aria-labelledby="ipc-pw-h-cat">
    <div class="ipc-cn-head"><h3 id="ipc-pw-h-cat" tabindex="-1">${esc(t("IPC.Powers.Cat.Title"))}</h3>
      <button type="button" class="ipc-btn ipc-btn-small" data-act="rand-power" data-fk="rand-power" data-tooltip="${esc(t("IPC.Powers.Cat.RollTip"))}">${icon("fa-solid fa-dice")} ${esc(t("IPC.Powers.Cat.Roll"))}</button></div>
    <p class="ipc-cn-sub">${esc(t("IPC.Powers.Cat.Hint", { n: d.powers.length }))}</p>
    <div class="ipc-pw-search"><label class="ipc-field"><span>${esc(t("IPC.Powers.Cat.Search"))}</span><input type="search" class="ipc-input" name="pw-q" data-fk="pw-q" value="${esc(d.q)}" autocomplete="off"></label></div>
    <fieldset class="ipc-opts ipc-opts-types"><legend class="ipc-sr">${esc(t("IPC.Powers.Cat.Type"))}</legend>${types}</fieldset>
    <p class="ipc-pw-results ipc-muted" aria-live="polite" data-results>${esc(t("IPC.Powers.Cat.Results", { n: d.count }))}</p>
    <ul class="ipc-pw-rows" data-list="cat">${rows}</ul>
  </section>`;
}

/* ---------------------------------------------------------------- actions */
function ensureLists(ctx, power) {
  const d = ctx.data, key = norm(power);
  if (d.boostCache.has(key) && d.limitCache.has(key)) return Promise.resolve();
  return Promise.all([ctx.catalog.boostsFor(power), ctx.catalog.limitsFor(power)]).then(([b, l]) => { d.boostCache.set(key, b); d.limitCache.set(key, l); });
}

function addPowerEntry(ctx, e, how = "added") {
  const s = ctx.state, d = ctx.data;
  if (s.powers.some((p) => norm(p.name) === norm(e.name))) return false;
  if (!guardOk(s, 1)) { said(ctx, t("IPC.Powers.NoBudget")); ctx.rerender(); return false; }
  d.msg = "";
  const ns = addPower(s, { name: e.name, packUuid: e.packUuid ?? null, level: 0 });
  d.landed = `p:${ns.powers[ns.powers.length - 1].key}`;
  return ns;
}

async function seededDraw(ctx, counter, pool, weight) {
  const s = ctx.state, n = s.rerolls?.[counter] ?? 0;
  const rng = substream(s.seed, `${counter}:${n}`);
  const e = weight ? rng.weighted(pool, weight) : rng.pick(pool);
  return { e, n };
}

async function randomPower(ctx) {
  const d = ctx.data, s = ctx.state;
  if (!guardOk(s, 1)) { said(ctx, t("IPC.Powers.NoBudget")); return ctx.rerender(); }
  const list = await ctx.provider().list("powers", { rank: s.rank });
  const have = new Set(s.powers.map((p) => norm(p.name)));
  const pool = list.filter((e) => !have.has(norm(e.name)));
  if (!pool.length) return;
  const types = new Set(s.powers.map((p) => catOf(d, p.name)?.type));
  const { e, n } = await seededDraw(ctx, "powerAdd", pool, (x) => (x.type && !types.has(x.type) ? 2 : 1));
  const ns = addPowerEntry(ctx, e);
  if (!ns) return;
  ctx.commit({ ...ns, rerolls: { ...ns.rerolls, powerAdd: n + 1 } }, { body: true });
  ctx.announce(t("IPC.Powers.Rolled", { name: e.name }));
}

async function randomSource(ctx) {
  const d = ctx.data, s = ctx.state, P = ctx.provider();
  const target = d.target && s.sources.some((x) => x.key === d.target) ? d.target : null;
  if (!target && s.sources.length && !guardOk(s, 0, 1)) { said(ctx, t("IPC.Powers.NoBudget")); return ctx.rerender(); }
  const used = new Set(s.sources.map((x) => norm(x.name)));
  const list = (await P.list("powerSources", {})).filter((e) => !used.has(norm(e.name)));
  if (!list.length) return;
  const n = s.rerolls?.sourceRoll ?? 0;
  const rng = substream(s.seed, `sourceRoll:${n}`);
  let e = null;
  if (typeof P.roll === "function") for (let i = 0; i < 3 && !e; i++) { const r = await P.roll("powerSources", rng, {}); if (r && !used.has(norm(r.name))) e = r; }
  e ??= rng.pick(list);
  d.target = null; d.msg = "";
  ctx.update((st) => ({ ...putSource(st, e, target), rerolls: { ...st.rerolls, sourceRoll: n + 1 } }), { body: true });
  ctx.announce(t("IPC.Powers.Src.Rolled", { name: e.name }));
}

async function randomBoost(ctx, key) {
  const s = ctx.state, p = s.powers.find((x) => x.key === key);
  if (!p) return;
  if (!guardOk(s, 1)) { said(ctx, t("IPC.Powers.NoBudget")); return ctx.rerender(); }
  await ensureLists(ctx, p.name);
  const used = new Set(p.boosts.map((b) => norm(b.name)));
  const pool = (ctx.data.boostCache.get(norm(p.name)) ?? []).filter((e) => !used.has(norm(e.name)));
  if (!pool.length) return ctx.rerender();
  const { e, n } = await seededDraw(ctx, "boostRoll", pool);
  ctx.data.msg = "";
  ctx.update((st) => ({ ...addBoost(st, key, e), rerolls: { ...st.rerolls, boostRoll: n + 1 } }), { body: true });
  ctx.announce(t("IPC.Powers.Added", { name: e.name, used: slots(ctx.state), max: ctx.rank.powers }));
}

function useSource(ctx, name, uuid) {
  const d = ctx.data, s = ctx.state;
  if (s.sources.some((x) => norm(x.name) === norm(name))) { said(ctx, t("IPC.Powers.Src.Dup", { name })); return ctx.rerender(); }
  const target = d.target && s.sources.some((x) => x.key === d.target) ? d.target : null;
  if (!target && s.sources.length && !guardOk(s, 0, 1)) { said(ctx, t("IPC.Powers.NoBudget")); return ctx.rerender(); }
  d.target = null; d.msg = "";
  const entry = { name, packUuid: uuid || null };
  ctx.update((st) => putSource(st, entry, target), { body: true });
  ctx.announce(t("IPC.Powers.Src.Chosen", { name }));
}

/* ---------------------------------------------------------------- the step */
async function syncArchetype(ctx) {
  const d = ctx.data, name = ctx.state.archetype ?? null;
  if (d.archFor === name) return false;
  d.archFor = name;
  d.archNames = new Set(); d.suggest = []; d.suggestNames = new Set();
  if (!name) return true;
  try {
    const [a, src] = await Promise.all([ctx.catalog.getArchetype(name), ctx.provider().list("powerSources", { archetype: name })]);
    if (d.archFor !== name) return false;
    d.archNames = new Set((a?.powers ?? []).map((p) => norm(p.name)));
    d.suggest = src ?? []; d.suggestNames = new Set(d.suggest.map((e) => norm(e.name)));
  } catch (err) { console.warn("invincible-plus-ultra | chargen: archetype data failed", err); }
  return true;
}

export default {
  id: "powers",
  icon: "fa-solid fa-bolt",

  async load(ctx) {
    const d = ctx.data;
    Object.assign(d, { desc: new Map(), inflight: new Map(), open: new Set(), boostCache: new Map(), limitCache: new Map(), q: "", sq: "", type: "all", limit: PAGE, slimit: PAGE, custom: "", target: null, pick: null, msg: "", count: 0 });
    d.powers = await ctx.catalog.powers();
    d.cat = new Map(d.powers.map((p) => [norm(p.name), p]));
    d.sources = await ctx.catalog.powerSources();
    d.archFor = undefined;
    await syncArchetype(ctx);
  },

  render(ctx) {
    return `<div class="ipc-powers">
      ${status(ctx)}
      ${meter(ctx)}
      ${minePanel(ctx)}
      ${sourcePanel(ctx)}
      ${catalogPanel(ctx)}
    </div>`;
  },

  mount(ctx, root) {
    const d = ctx.data;
    // the archetype may have changed in the Concept step: refresh the badges / shortlist once
    syncArchetype(ctx).then((changed) => { if (changed && root.isConnected) ctx.rerender(); });
    enrich(root, d);
    if (d.landed) { requestAnimationFrame(() => root.querySelector(".ipc-landed")?.scrollIntoView({ block: "nearest" })); d.landed = null; }

    const repaintLists = () => {
      const cat = root.querySelector('[data-list="cat"]'), src = root.querySelector('[data-list="src"]');
      if (cat) cat.innerHTML = catalogRows(ctx);
      if (src) src.innerHTML = sourceRows(ctx);
      const res = root.querySelector("[data-results]");
      if (res) res.textContent = t("IPC.Powers.Cat.Results", { n: d.count });
      enrich(root, d);
    };
    let timer = 0;
    root.addEventListener("input", (ev) => {
      const el = ev.target;
      if (!(el instanceof HTMLInputElement)) return;
      if (el.name === "pw-q") { d.q = el.value; d.limit = PAGE; }
      else if (el.name === "src-q") { d.sq = el.value; d.slimit = PAGE; }
      else if (el.name === "src-custom") { d.custom = el.value; return; }
      else return;
      clearTimeout(timer);
      timer = setTimeout(repaintLists, 90);
    });
    root.addEventListener("keydown", (ev) => {
      const el = ev.target;
      if (ev.key === "Enter" && el instanceof HTMLInputElement && el.name === "src-custom") { ev.preventDefault(); root.querySelector('[data-act="src-custom"]')?.click(); }
      else if ((ev.key === "Delete" || ev.key === "Backspace") && el instanceof HTMLElement && el.dataset.act === "toggle-power" && el.getAttribute("aria-pressed") === "true") { ev.preventDefault(); el.click(); }
    });

    root.addEventListener("change", (ev) => {
      const el = ev.target, s = ctx.state;
      if (el instanceof HTMLSelectElement && el.name.startsWith("srcfor-")) {
        const key = el.name.slice(7);
        ctx.update((st) => setPowerSource(st, key, el.value), { body: true });
        return;
      }
      if (!(el instanceof HTMLInputElement) || el.type !== "radio") return;
      if (el.name === "pwtype") { d.type = el.value; d.limit = PAGE; ctx.rerender(); return; }
      if (el.name.startsWith("pick-grants-")) { d.pick = { ...d.pick, grants: el.value }; ctx.rerender(); return; }
      if (el.name.startsWith("lv-")) {
        const key = el.name.slice(3), lv = Number(el.value), p = s.powers.find((x) => x.key === key);
        if (!p || lv === p.level) return;
        if (lv > p.level && !guardOk(s, lv - p.level)) { said(ctx, t("IPC.Powers.NoBudget")); ctx.rerender(); return; }
        d.msg = "";
        ctx.update((st) => setPowerLevel(st, key, lv), { body: true });
        ctx.announce(t("IPC.Powers.LevelSet", { name: p.name, level: levelName(lv), used: slots(ctx.state), max: ctx.rank.powers }));
      }
    });

    delegate(root, "click", "[data-act]", async (ev, el) => {
      if (el.getAttribute("aria-disabled") === "true") {
        if (el.dataset.act === "add-boost" || el.dataset.act === "add-limit") { said(ctx, t(el.dataset.act === "add-boost" ? "IPC.Powers.NoBudget" : "IPC.Powers.LimitNoRoom")); ctx.rerender(); }
        return;
      }
      const act = el.dataset.act, s = ctx.state;
      const refocus = (sel) => requestAnimationFrame(() => ctx.app.focusBody(sel));
      switch (act) {
        case "go-attr": ctx.go("attributes"); break;
        case "toggle-power": {
          const name = el.dataset.name, hit = s.powers.find((p) => norm(p.name) === norm(name));
          if (hit) {
            ctx.update((st) => removePower(st, hit.key), { body: true });
            ctx.announce(t("IPC.Powers.Removed", { name, used: slots(ctx.state), max: ctx.rank.powers }));
          } else {
            const e = d.cat.get(norm(name)), ns = addPowerEntry(ctx, e ?? { name });
            if (!ns) break;
            ctx.commit(ns, { body: true });
            ctx.announce(t("IPC.Powers.Added", { name, used: slots(ctx.state), max: ctx.rank.powers }));
          }
          break;
        }
        case "remove-power": {
          const p = s.powers.find((x) => x.key === el.dataset.key);
          if (!p) break;
          if (d.pick?.key === p.key) d.pick = null;
          ctx.update((st) => removePower(st, p.key), { body: true });
          ctx.announce(t("IPC.Powers.Removed", { name: p.name, used: slots(ctx.state), max: ctx.rank.powers }));
          refocus("#ipc-pw-h-mine");
          break;
        }
        case "rand-power": await randomPower(ctx); break;
        case "more": { const u = el.dataset.uuid; if (d.open.has(u)) d.open.delete(u); else d.open.add(u); ctx.rerender(); break; }
        case "book": openBook(el.dataset.uuid); break;
        case "cat-more": { const first = d.limit; d.limit += PAGE; ctx.rerender(); const e = d.powers.filter((p) => (d.type === "all" || p.type === d.type) && (!norm(d.q) || norm(p.name).includes(norm(d.q))))[first]; if (e) refocus(`[data-fk="pw-${slug(e.name)}"]`); break; }
        case "src-more": { const first = d.slimit; d.slimit += PAGE; ctx.rerender(); const e = d.sources.filter((x) => !norm(d.sq) || norm(x.name).includes(norm(d.sq)))[first]; if (e) refocus(`[data-fk="srcuse-${slug(e.name)}"]`); break; }
        case "pick": {
          const key = el.dataset.key, kind = el.dataset.kind, p = s.powers.find((x) => x.key === key);
          if (!p) break;
          if (d.pick?.key === key && d.pick.kind === kind) { d.pick = null; ctx.rerender(); break; }
          const room = limitRoom(p);
          try { await ensureLists(ctx, p.name); } catch (err) { console.warn("invincible-plus-ultra | chargen: boost / limit lists failed", err); }
          d.pick = { key, name: p.name, kind, grants: room.level ? "level" : room.boost ? "boost" : null };
          ctx.rerender();
          break;
        }
        case "add-boost": {
          const key = el.dataset.key;
          if (!guardOk(s, 1)) { said(ctx, t("IPC.Powers.NoBudget")); ctx.rerender(); break; }
          d.msg = "";
          ctx.update((st) => addBoost(st, key, { name: el.dataset.name, packUuid: el.dataset.uuid || null }), { body: true });
          ctx.announce(t("IPC.Powers.Added", { name: el.dataset.name, used: slots(ctx.state), max: ctx.rank.powers }));
          break;
        }
        case "rm-boost": {
          const key = el.dataset.key, i = Number(el.dataset.i), name = s.powers.find((x) => x.key === key)?.boosts[i]?.name ?? "";
          ctx.update((st) => removeBoost(st, key, i), { body: true });
          ctx.announce(t("IPC.Powers.Removed", { name, used: slots(ctx.state), max: ctx.rank.powers }));
          refocus(`[data-fk="pick-b-${key}"]`);
          break;
        }
        case "rand-boost": await randomBoost(ctx, el.dataset.key); break;
        case "add-limit": {
          const key = el.dataset.key, grants = d.pick?.grants;
          if (!grants) break;
          ctx.update((st) => addLimit(st, key, { name: el.dataset.name, packUuid: el.dataset.uuid || null, grants }), { body: true });
          ctx.announce(t("IPC.Powers.LimitAdded", { name: el.dataset.name, used: slots(ctx.state), max: ctx.rank.powers }));
          break;
        }
        case "rm-limit": {
          const key = el.dataset.key, i = Number(el.dataset.i);
          ctx.update((st) => removeLimit(st, key, i), { body: true });
          refocus(`[data-fk="pick-l-${key}"]`);
          break;
        }
        case "src-use": useSource(ctx, el.dataset.name, el.dataset.uuid); break;
        case "src-change": d.target = el.dataset.key; ctx.rerender(); refocus('[data-fk="src-q"]'); break;
        case "src-cancel": d.target = null; ctx.rerender(); break;
        case "src-remove": {
          const x = s.sources.find((z) => z.key === el.dataset.key);
          if (d.target === el.dataset.key) d.target = null;
          ctx.update((st) => removeSource(st, el.dataset.key), { body: true });
          ctx.announce(t("IPC.Powers.Src.Removed", { name: x?.name ?? "" }));
          refocus("#ipc-pw-h-src");
          break;
        }
        case "src-roll": await randomSource(ctx); break;
        case "src-custom": {
          const name = d.custom.trim().replace(/\s+/g, " ");
          if (!name) { said(ctx, t("IPC.Powers.Src.CustomEmpty")); ctx.rerender(); break; }
          const known = d.sources.find((e) => norm(e.name) === norm(name));
          d.custom = "";
          useSource(ctx, known?.name ?? name, known?.packUuid ?? "");
          break;
        }
        default: break;
      }
    });
  },

  onState(ctx) {
    const d = ctx.data;
    if (!d.desc) return;
    d.msg = ""; d.landed = null; d.pick = null; d.target = null;
  }
};
