/* Step "talents" (phase 5c): the free HERO TALENT, optional EXTRA TALENTS and DRAWBACKS.
   Layout (one column that scrolls in the wizard body, same grammar as the powers step): sticky budget meter -> "Your talents" (hero talent card,
   the occupation talent as a read-only line, extra talent chips, dice) -> "Choose talents" (paged, searchable catalogue; a switch says whether a
   click makes the hero talent or an extra one, a second switch toggles the archetype's six <-> the whole catalogue) -> "Your drawbacks" (cards with a
   note field) -> "Choose drawbacks" -> "What your picks change" (effects read from the pack items at runtime).
   RULES (arithmetic lives in rules.mjs): the hero talent and the occupation talent (Life step) are free, every further talent costs 1 attribute
   point, every drawback (at most 2) gives 1 back; a talent can be taken once (Windfall excepted), a drawback once (Hard Times excepted).
   Adding an extra talent is refused only when fewer than 6 attribute points would remain; everything else is shown by validateStep.
   DATA: names from ctx.catalog (57 talents, 15 drawbacks) and, with an archetype, the archetype's D6 lists (provider heroTalents / drawbacks).
   The bare talent "Knowledgeable" asks for a subject: it rolls the book's D6 Knowledgeable Subjects table and takes the variant item.
   Descriptions and effect numbers are read at RUNTIME from the pack documents (steps/shared.mjs, bonuses.mjs), never copied into the module.
   DICE: hero talent (D6 on the archetype list, else uniform over the catalogue), random extra talent, random drawback and the subject roll use
   seeded substreams (seed + state.rerolls counters heroTalent / talentAdd / drawbackAdd / knowSubject): undo + roll again = the same result. */
import { t } from "../lang.mjs";
import { ATTRS, ATTR_MIN, MAX_DRAWBACKS, REPEATABLE_TALENTS, REPEATABLE_DRAWBACKS, talentKey, talentLimit, drawbackLimit, budget, slots, validateStep, normName } from "../rules.mjs";
import { setHeroTalent, addExtraTalent, removeExtraTalent, addDrawback, removeDrawback } from "../state.mjs";
import { substream } from "../rng.mjs";
import { FX_FIELDS, fxOf, itemRefs, bonusSum, warmBonuses } from "../bonuses.mjs";
import { esc, icon, msgText, delegate } from "./util.mjs";
import { slug, enrich, descBlock, rowLinks, chip, openBook } from "./shared.mjs";

const PAGE = 12;
const MIN_BUDGET = ATTRS.length * ATTR_MIN;
const nm = normName;
const KNOW = "knowledgeable";
/** a shortlist of the archetype is six entries; anything much longer is the catalogue fallback of the provider */
const isShortlist = (l) => Array.isArray(l) && l.length > 0 && l.length <= 8;

const guardOk = (s, extra = 1) => budget(s) - extra >= MIN_BUDGET;
const said = (ctx, text) => { ctx.data.msg = text; };
const signed = (v) => (v > 0 ? `+${v}` : String(v));

/* ---------------------------------------------------------------- what is taken */
const talentNames = (s, { exceptHero = false } = {}) => [exceptHero ? null : s.heroTalent?.name, s.occTalent?.name, ...s.extraTalents.map((x) => x.name)].filter(Boolean).map(talentKey);
const drawbackNames = (s) => s.drawbacks.map((x) => nm(x.name));
/** may this talent (name) be taken once more? */
function canTakeTalent(s, name, { exceptHero = false } = {}) {
  const k = talentKey(name);
  return talentNames(s, { exceptHero }).filter((x) => x === k).length < talentLimit(name);   // B3 / C4: Durable / Determined up to 5, Windfall no cap, one Knowledgeable subject
}
const canTakeDrawback = (s, name) => drawbackNames(s).filter((x) => x === nm(name)).length < drawbackLimit(name);
/** what the drawback asks you to choose ("source" | "defined" | null): its own flag, else the catalogue's */
const needsOf = (d, x) => x?.needs || d.dneeds?.get(nm(x?.name)) || null;
/** the limit line of a talent row: "up to 5 times" / "several times" */
const limitNote = (name) => { const n = talentLimit(name); return n === Infinity ? t("IPC.Talents.LimitMany") : n > 1 ? t("IPC.Talents.Limit", { n }) : talentKey(name) === KNOW ? t("IPC.Talents.KnowOnce") : ""; };

/* ---------------------------------------------------------------- effect tags (numbers come from the pack effects) */
function fxTags(fx) {
  const parts = FX_FIELDS.filter((k) => fx?.[k]).map((k) => `<span class="ipc-tl-fx">${esc(t(`IPC.Talents.Fx.${k}`, { v: signed(fx[k]) }))}</span>`);
  return parts.join("");
}
const fxText = (fx) => FX_FIELDS.filter((k) => fx?.[k]).map((k) => t(`IPC.Talents.Fx.${k}`, { v: signed(fx[k]) })).join(", ");
const fxSlot = (d, uuid, ref, type) => `<span class="ipc-tl-fxs" data-fxfor="${esc(uuid ?? "")}">${fxTags(d.desc.get(uuid)?.fx ?? fxOf(type, ref))}</span>`;

/** the pack uuid of a state reference: its own, else found by name in the catalogue (imported heroes carry names only) */
const uu = (d, type, ref) => ref?.packUuid || (type === "talent" ? d.tmap : d.dmap).get(nm(ref?.name)) || null;

/* ---------------------------------------------------------------- pieces of the page */
function status(ctx) {
  const iss = validateStep(ctx.state, "talents");
  if (!iss.issues.length) return `<p class="ipc-status ipc-ok">${icon("fa-solid fa-circle-check")} ${esc(t("IPC.Step.StatusOk"))}</p>`;
  const cls = (i) => (i.severity === "error" ? "ipc-iss-err" : i.severity === "info" ? "ipc-iss-info" : "ipc-iss-warn");
  const ic = (i) => (i.severity === "info" ? "fa-solid fa-circle-info" : "fa-solid fa-circle-exclamation");
  return `<ul class="ipc-status-list">${iss.issues.map((i) => `<li class="${cls(i)}">${icon(ic(i))}<span>${esc(msgText(i))}</span></li>`).join("")}</ul>`;
}

function meter(ctx) {
  const s = ctx.state, r = ctx.rank, b = budget(s), ab = ctx.budget;
  const parts = [t("IPC.Powers.Meter.Base", { n: r.points })];
  const free = r.powers - slots(s);
  if (free > 0) parts.push(t("IPC.Powers.Meter.Free", { pts: 2 * free, n: free }));
  else if (free < 0) parts.push(t("IPC.Powers.Meter.Over", { pts: -2 * free, n: -free }));
  const x = Math.max(0, s.sources.length - 1), e = s.extraTalents.length, dr = s.drawbacks.length;
  if (x) parts.push(t("IPC.Powers.Meter.Sources", { n: x }));
  if (e) parts.push(t("IPC.Powers.Meter.Talents", { n: e }));
  if (dr) parts.push(t("IPC.Powers.Meter.Drawbacks", { n: dr }));
  const placed = ab.left === 0 ? t("IPC.Powers.Meter.PlacedOk", { spent: ab.spent }) : ab.left > 0 ? t("IPC.Powers.Meter.PlacedLeft", { spent: ab.spent, left: ab.left }) : t("IPC.Powers.Meter.PlacedOver", { spent: ab.spent, over: -ab.left });
  return `<div class="ipc-pw-meter ipc-tl-meter" role="group" aria-label="${esc(t("IPC.Talents.Meter.Label"))}">
    <div class="ipc-pw-m-slots"><b>${b}</b><span>${esc(t("IPC.Talents.Meter.Points"))}</span></div>
    <div class="ipc-pw-m-text">
      <p><strong>${esc(t("IPC.Powers.Meter.Need", { budget: b }))}</strong> <span class="ipc-muted">${esc(t("IPC.Powers.Meter.Cap", { cap: r.cap }))}</span></p>
      <p class="ipc-pw-msg" role="status">${ctx.data.msg ? `${icon("fa-solid fa-circle-info")} ${esc(ctx.data.msg)}` : ""}</p>
    </div>
  </div>
  <p class="ipc-pw-parts">${esc(parts.join("  ·  "))}. ${esc(placed)} <button type="button" class="ipc-link" data-act="go-attr" data-fk="go-attr">${esc(t("IPC.Powers.Meter.GoAttr"))}</button></p>`;
}

function heroBlock(ctx) {
  const s = ctx.state, d = ctx.data, h = s.heroTalent;
  const landed = d.landed === "hero" ? " ipc-landed" : "";
  const card = h
    ? `<div class="ipc-pw-card ipc-tl-hero${landed}">
        <div class="ipc-pw-card-head">
          <h4 class="ipc-pw-cname">${esc(h.name)}</h4>
          <span class="ipc-pw-badge">${icon("fa-solid fa-star")} ${esc(t("IPC.Talents.Hero.Badge"))}</span>
          ${fxSlot(d, uu(d, "talent", h), h, "talent")}
          <button type="button" class="ipc-btn ipc-btn-small ipc-btn-danger" data-act="clear-hero" data-fk="clear-hero" aria-label="${esc(t("IPC.Talents.Hero.ClearAria", { name: h.name }))}">${icon("fa-solid fa-xmark")} ${esc(t("IPC.Talents.Hero.Clear"))}</button>
        </div>
        ${descBlock(d, uu(d, "talent", h))}${rowLinks(d, uu(d, "talent", h), h.name)}
      </div>`
    : `<div class="ipc-note-box ipc-pw-empty">${icon("fa-solid fa-star")} ${esc(t("IPC.Talents.Hero.None"))}</div>`;
  const occ = s.occTalent?.name
    ? `<p class="ipc-tl-occ">${icon("fa-solid fa-briefcase")} <span>${esc(t("IPC.Talents.Occ.Have", { name: s.occTalent.name }))}</span> <button type="button" class="ipc-link" data-act="go-life" data-fk="go-life">${esc(t("IPC.Talents.Occ.Open"))}</button></p>`
    : `<p class="ipc-tl-occ">${icon("fa-solid fa-briefcase")} <span>${esc(t("IPC.Talents.Occ.Later"))}</span> <button type="button" class="ipc-link" data-act="go-life" data-fk="go-life">${esc(t("IPC.Talents.Occ.Open"))}</button></p>`;
  const extras = s.extraTalents.length
    ? `<ul class="ipc-chips">${s.extraTalents.map((x, i) => chip(`${esc(x.name)} ${fxSlot(d, uu(d, "talent", x), x, "talent")}`, t("IPC.Talents.Extra.RemoveAria", { name: x.name }), "rm-extra", `data-i="${i}" data-fk="rmx-${i}"`)).join("")}</ul>`
    : `<p class="ipc-muted ipc-pw-none">${esc(t("IPC.Talents.Extra.None"))}</p>`;
  return `<section class="ipc-pw-sec" aria-labelledby="ipc-tl-h-mine">
    <div class="ipc-cn-head"><h3 id="ipc-tl-h-mine" tabindex="-1">${esc(t("IPC.Talents.Mine"))}</h3>
      <span class="ipc-tl-dice">
        <button type="button" class="ipc-btn ipc-btn-small" data-act="roll-hero" data-fk="roll-hero" data-tooltip="${esc(t(d.archHero.length ? "IPC.Talents.Hero.RollTipArch" : "IPC.Talents.Hero.RollTipAll"))}">${icon("fa-solid fa-dice")} ${esc(t("IPC.Talents.Hero.Roll"))}</button>
        <button type="button" class="ipc-btn ipc-btn-small" data-act="roll-extra" data-fk="roll-extra" data-tooltip="${esc(t("IPC.Talents.Extra.RollTip"))}">${icon("fa-solid fa-dice")} ${esc(t("IPC.Talents.Extra.Roll"))}</button>
      </span></div>
    <p class="ipc-cn-sub">${esc(t("IPC.Talents.Mine.Sub"))}</p>
    <div class="ipc-pw-blk-head"><h5>${esc(t("IPC.Talents.Hero.Title"))}</h5><span class="ipc-muted">${esc(t("IPC.Talents.Hero.Free"))}</span></div>
    ${card}
    ${occ}
    <div class="ipc-pw-blk-head"><h5>${esc(t("IPC.Talents.Extra.Title"))}</h5><span class="ipc-muted">${esc(t("IPC.Talents.Extra.Cost"))}</span></div>
    ${extras}
  </section>`;
}

/** the two radio switches above a list: [{value, label}] */
function switchSet(name, legend, options, current) {
  return `<fieldset class="ipc-opts ipc-opts-types ipc-tl-switch"><legend>${esc(legend)}</legend>${options.map((o) => `<label class="ipc-opt ipc-opt-chip${current === o.value ? " is-on" : ""}"><input type="radio" name="${name}" value="${esc(o.value)}" data-fk="${name}-${esc(o.value)}"${current === o.value ? " checked" : ""}><span class="ipc-opt-text"><span class="ipc-opt-name">${esc(o.label)}</span></span>${icon("fa-solid fa-check ipc-opt-check")}</label>`).join("")}</fieldset>`;
}

/* ---- talents list */
function talentList(ctx) {
  const d = ctx.data;
  return d.tsrc === "arch" && d.archHero.length ? d.archHero : d.talents;
}
function talentRows(ctx) {
  const d = ctx.data, s = ctx.state, q = nm(d.tq);
  const all = talentList(ctx).filter((e) => !q || nm(e.name).includes(q));
  const shown = all.slice(0, d.tlimit);
  const rows = shown.map((e) => {
    const k = talentKey(e.name);
    const isHero = s.heroTalent && talentKey(s.heroTalent.name) === k, isOcc = s.occTalent && talentKey(s.occTalent.name) === k, isExtra = s.extraTalents.some((x) => talentKey(x.name) === k);
    const hero = d.target === "hero";
    const blocked = hero ? (isHero || !canTakeTalent(s, e.name, { exceptHero: true })) : !canTakeTalent(s, e.name);
    const where = isHero ? t("IPC.Talents.Row.IsHero") : isOcc ? t("IPC.Talents.Row.IsOcc") : isExtra ? t("IPC.Talents.Row.IsExtra") : "";
    const bare = nm(e.name) === KNOW;
    const verb = bare ? t("IPC.Talents.Row.RollSubject") : hero ? t("IPC.Talents.Row.Hero") : t("IPC.Talents.Row.Extra");
    const aria = bare ? t("IPC.Talents.Row.RollSubjectAria", { name: e.name }) : t(hero ? "IPC.Talents.Row.HeroAria" : "IPC.Talents.Row.ExtraAria", { name: e.name });
    const btn = blocked
      ? `<button type="button" class="ipc-btn ipc-btn-small" data-act="pick-talent" data-name="${esc(e.name)}" data-uuid="${esc(e.packUuid ?? "")}" data-fk="tl-${esc(slug(e.name))}" aria-disabled="true" aria-label="${esc(t("IPC.Talents.Row.TakenAria", { name: e.name }))}">${icon("fa-solid fa-check")} ${esc(t("IPC.Talents.Row.Taken"))}</button>`
      : `<button type="button" class="ipc-btn ipc-btn-small ipc-btn-primary" data-act="pick-talent" data-name="${esc(e.name)}" data-uuid="${esc(e.packUuid ?? "")}" data-fk="tl-${esc(slug(e.name))}" aria-label="${esc(aria)}">${icon(bare ? "fa-solid fa-dice" : "fa-solid fa-plus")} ${esc(verb)}</button>`;
    return `<li class="ipc-pw-row${where ? " is-added" : ""}">
      <div class="ipc-pw-row-main"><div class="ipc-pw-row-head"><span class="ipc-pw-name">${esc(e.name)}</span>${where ? `<span class="ipc-pw-badge">${esc(where)}</span>` : ""}${limitNote(e.name) ? `<span class="ipc-pw-type">${esc(limitNote(e.name))}</span>` : ""}${fxSlot(d, e.packUuid, e, "talent")}</div>${descBlock(d, e.packUuid)}${rowLinks(d, e.packUuid, e.name)}</div>
      ${btn}
    </li>`;
  }).join("");
  const more = all.length > shown.length ? `<li class="ipc-pw-morerow"><button type="button" class="ipc-btn ipc-btn-small" data-act="tal-more" data-fk="tal-more">${esc(t("IPC.Powers.Cat.More", { n: all.length - shown.length }))}</button></li>` : "";
  d.tcount = all.length;
  return rows ? rows + more : `<li class="ipc-muted ipc-pw-none">${esc(t("IPC.Powers.Cat.None", { q: d.tq }))}</li>`;
}
function talentPanel(ctx) {
  const d = ctx.data, s = ctx.state;
  const rows = talentRows(ctx);
  const target = switchSet("tl-target", t("IPC.Talents.Cat.For"), [{ value: "hero", label: t("IPC.Talents.Cat.ForHero") }, { value: "extra", label: t("IPC.Talents.Cat.ForExtra") }], d.target);
  const src = d.archHero.length ? switchSet("tl-src", t("IPC.Talents.Cat.Source"), [{ value: "arch", label: t("IPC.Talents.Src.Arch", { name: s.archetype ?? "", n: d.archHero.length }) }, { value: "all", label: t("IPC.Talents.Src.All", { n: d.talents.length }) }], d.tsrc) : "";
  return `<section class="ipc-pw-sec" aria-labelledby="ipc-tl-h-cat">
    <div class="ipc-cn-head"><h3 id="ipc-tl-h-cat" tabindex="-1">${esc(t("IPC.Talents.Cat.Title"))}</h3></div>
    <p class="ipc-cn-sub">${esc(t("IPC.Talents.Cat.Hint", { n: d.talents.length }))}</p>
    ${target}${src}
    <div class="ipc-pw-search"><label class="ipc-field"><span>${esc(t("IPC.Talents.Cat.Search"))}</span><input type="search" class="ipc-input" name="tl-q" data-fk="tl-q" value="${esc(d.tq)}" autocomplete="off"></label></div>
    <p class="ipc-pw-results ipc-muted" aria-live="polite" data-results="tal">${esc(t("IPC.Talents.Cat.Results", { n: d.tcount }))}</p>
    <ul class="ipc-pw-rows" data-list="tal">${rows}</ul>
  </section>`;
}

/* ---- drawbacks */
function drawbackCards(ctx) {
  const s = ctx.state, d = ctx.data;
  if (!s.drawbacks.length) return `<div class="ipc-note-box ipc-pw-empty">${icon("fa-solid fa-link-slash")} ${esc(t("IPC.Talents.Dr.None"))}</div>`;
  return `<ul class="ipc-pw-cards">${s.drawbacks.map((x, i) => `<li class="ipc-pw-card ipc-tl-dr${d.landed === `d${i}` ? " ipc-landed" : ""}">
      <div class="ipc-pw-card-head">
        <h4 class="ipc-pw-cname">${esc(x.name)}</h4>
        <span class="ipc-pw-badge">${icon("fa-solid fa-plus")} ${esc(t("IPC.Talents.Dr.Gives"))}</span>
        ${fxSlot(d, uu(d, "drawback", x), x, "drawback")}
        <button type="button" class="ipc-btn ipc-btn-small ipc-btn-danger" data-act="rm-drawback" data-i="${i}" data-fk="rmd-${i}" aria-label="${esc(t("IPC.Talents.Dr.RemoveAria", { name: x.name }))}">${icon("fa-solid fa-trash")} ${esc(t("IPC.Talents.Dr.Remove"))}</button>
      </div>
      ${descBlock(d, uu(d, "drawback", x))}${rowLinks(d, uu(d, "drawback", x), x.name)}
      ${(() => {
        const need = needsOf(d, x), missing = !!need && !String(x.note ?? "").trim();
        if (!need) return `<label class="ipc-field ipc-tl-note"><span>${esc(t("IPC.Talents.Dr.Note"))}</span><input type="text" class="ipc-input" name="dbnote-${i}" data-fk="dbnote-${i}" maxlength="60" value="${esc(x.note ?? "")}" placeholder="${esc(t("IPC.Talents.Dr.NotePh"))}" autocomplete="off"></label>`;
        // B4: the book asks you to choose when you take this drawback: a visible prompt, a suggestion list of the hero's power sources, a warning (not a block) until it is filled
        const opts = need === "source" ? s.sources.map((z) => `<option value="${esc(z.name)}"></option>`).join("") : "";
        return `<label class="ipc-field ipc-tl-note ipc-tl-choose${missing ? " is-missing" : ""}"><span>${esc(t(`IPC.Talents.Dr.Choose.${need}`))}${missing ? ` <b class="ipc-need">${esc(t("IPC.Talents.Dr.ChooseMissing"))}</b>` : ""}</span>
          <input type="text" class="ipc-input" name="dbnote-${i}" data-fk="dbnote-${i}" maxlength="60" value="${esc(x.note ?? "")}" placeholder="${esc(t("IPC.Talents.Dr.ChoosePh"))}" autocomplete="off"${opts ? ` list="ipc-dl-src-${i}"` : ""} aria-describedby="ipc-ch-${i}"${missing ? ' aria-invalid="true"' : ""}>
          ${opts ? `<datalist id="ipc-dl-src-${i}">${opts}</datalist>` : ""}<small class="ipc-muted" id="ipc-ch-${i}">${esc(t(`IPC.Talents.Dr.ChooseHint.${need}`))}</small></label>`;
      })()}
    </li>`).join("")}</ul>`;
}
function drawbackList(ctx) {
  const d = ctx.data;
  return d.dsrc === "arch" && d.archDr.length ? d.archDr : d.drawbacks;
}
function drawbackRows(ctx) {
  const d = ctx.data, s = ctx.state, q = nm(d.dq);
  const all = drawbackList(ctx).filter((e) => !q || nm(e.name).includes(q));
  const shown = all.slice(0, d.dlimit);
  const full = s.drawbacks.length >= MAX_DRAWBACKS;
  const rows = shown.map((e) => {
    const taken = !canTakeDrawback(s, e.name);
    const btn = taken
      ? `<button type="button" class="ipc-btn ipc-btn-small" data-act="take-drawback" data-name="${esc(e.name)}" data-uuid="${esc(e.packUuid ?? "")}" data-fk="dr-${esc(slug(e.name))}" aria-disabled="true" aria-label="${esc(t("IPC.Talents.Dr.TakenAria", { name: e.name }))}">${icon("fa-solid fa-check")} ${esc(t("IPC.Talents.Row.Taken"))}</button>`
      : `<button type="button" class="ipc-btn ipc-btn-small${full ? "" : " ipc-btn-primary"}" data-act="take-drawback" data-name="${esc(e.name)}" data-uuid="${esc(e.packUuid ?? "")}" data-fk="dr-${esc(slug(e.name))}"${full ? ' aria-disabled="true"' : ""} aria-label="${esc(t("IPC.Talents.Dr.TakeAria", { name: e.name }))}">${icon("fa-solid fa-plus")} ${esc(t("IPC.Talents.Dr.Take"))}</button>`;
    return `<li class="ipc-pw-row${taken ? " is-added" : ""}">
      <div class="ipc-pw-row-main"><div class="ipc-pw-row-head"><span class="ipc-pw-name">${esc(e.name)}</span>${fxSlot(d, e.packUuid, e, "drawback")}</div>${descBlock(d, e.packUuid)}${rowLinks(d, e.packUuid, e.name)}</div>
      ${btn}
    </li>`;
  }).join("");
  const more = all.length > shown.length ? `<li class="ipc-pw-morerow"><button type="button" class="ipc-btn ipc-btn-small" data-act="dr-more" data-fk="dr-more">${esc(t("IPC.Powers.Cat.More", { n: all.length - shown.length }))}</button></li>` : "";
  d.dcount = all.length;
  return rows ? rows + more : `<li class="ipc-muted ipc-pw-none">${esc(t("IPC.Powers.Cat.None", { q: d.dq }))}</li>`;
}
function drawbackPanel(ctx) {
  const d = ctx.data, s = ctx.state;
  const rows = drawbackRows(ctx);
  const src = d.archDr.length ? switchSet("dr-src", t("IPC.Talents.Cat.Source"), [{ value: "arch", label: t("IPC.Talents.Src.Arch", { name: s.archetype ?? "", n: d.archDr.length }) }, { value: "all", label: t("IPC.Talents.Src.All", { n: d.drawbacks.length }) }], d.dsrc) : "";
  return `<section class="ipc-pw-sec" aria-labelledby="ipc-tl-h-drmine">
    <div class="ipc-cn-head"><h3 id="ipc-tl-h-drmine" tabindex="-1">${esc(t("IPC.Talents.Dr.Title"))} <span class="ipc-muted ipc-pw-count">${esc(t("IPC.Talents.Dr.Count", { n: s.drawbacks.length, max: MAX_DRAWBACKS }))}</span></h3>
      <button type="button" class="ipc-btn ipc-btn-small" data-act="roll-drawback" data-fk="roll-drawback" data-tooltip="${esc(t(d.archDr.length ? "IPC.Talents.Dr.RollTipArch" : "IPC.Talents.Dr.RollTipAll"))}">${icon("fa-solid fa-dice")} ${esc(t("IPC.Talents.Dr.Roll"))}</button></div>
    <p class="ipc-cn-sub">${esc(t("IPC.Talents.Dr.Sub", { max: MAX_DRAWBACKS }))} ${esc(t("IPC.Talents.Dr.NoteHint"))}</p>
    ${drawbackCards(ctx)}
  </section>
  <section class="ipc-pw-sec" aria-labelledby="ipc-tl-h-drcat">
    <div class="ipc-cn-head"><h3 id="ipc-tl-h-drcat" tabindex="-1">${esc(t("IPC.Talents.Dr.Cat"))}</h3></div>
    ${src}
    <div class="ipc-pw-search"><label class="ipc-field"><span>${esc(t("IPC.Talents.Dr.Search"))}</span><input type="search" class="ipc-input" name="dr-q" data-fk="dr-q" value="${esc(d.dq)}" autocomplete="off"></label></div>
    <p class="ipc-pw-results ipc-muted" aria-live="polite" data-results="dr">${esc(t("IPC.Talents.Dr.Results", { n: d.dcount }))}</p>
    <ul class="ipc-pw-rows" data-list="dr">${rows}</ul>
  </section>`;
}

/* ---- effects panel */
function fxPanel(ctx) {
  const s = ctx.state, b = bonusSum(s), r = ctx.rank;
  const items = itemRefs(s).map(({ type, ref }) => ({ ref, fx: fxOf(type, ref) })).filter((x) => x.fx && FX_FIELDS.some((k) => x.fx[k]));
  const list = items.length ? `<ul class="ipc-tl-fxlist">${items.map((x) => `<li><b>${esc(x.ref.name)}</b> ${esc(fxText(x.fx))}</li>`).join("")}</ul>` : `<p class="ipc-muted">${esc(t("IPC.Talents.Fx.None"))}</p>`;
  const rep = b.reputation ? t("IPC.Talents.Fx.Rep", { total: r.reputation + b.reputation, base: r.reputation, delta: signed(b.reputation) }) : t("IPC.Talents.Fx.RepBase", { total: r.reputation });
  const res = b.resources ? `<p>${icon("fa-solid fa-coins")} ${esc(t("IPC.Talents.Fx.Res", { delta: signed(b.resources) }))}</p>` : "";
  return `<section class="ipc-pw-sec ipc-tl-fxsec" aria-labelledby="ipc-tl-h-fx">
    <div class="ipc-cn-head"><h3 id="ipc-tl-h-fx" tabindex="-1">${esc(t("IPC.Talents.Fx.Title"))}</h3></div>
    <p class="ipc-cn-sub">${esc(t("IPC.Talents.Fx.Sub"))}</p>
    ${list}
    <p>${icon("fa-solid fa-ranking-star")} ${esc(rep)}</p>${res}
  </section>`;
}

/* ---------------------------------------------------------------- dice and actions */
async function subjectRoll(ctx) {
  const P = ctx.provider(), s = ctx.state, d = ctx.data;
  let list = [];
  try { list = await P.list("knowledgeableSubjects", {}); } catch (err) { console.warn("invincible-plus-ultra | chargen: subjects table failed", err); }
  if (!list.length) list = d.talents.filter((e) => /^knowledgeable\s*\(/i.test(e.name));
  if (!list.length) return null;
  const m = s.rerolls?.knowSubject ?? 0;
  const die = substream(s.seed, `knowSubject:${m}`).d6();
  const e = list[(die - 1) % list.length];
  return { e, die, m };
}

/** commit a talent as hero / extra; `entry` is a catalogue-like {name, packUuid}; `roll` carries the counter bumps of a dice roll */
function commitTalent(ctx, entry, target, bumps = {}, note = "") {
  const s = ctx.state, d = ctx.data;
  const ref = { name: entry.name, packUuid: entry.packUuid ?? null };
  if (target === "hero") {
    if (!canTakeTalent(s, ref.name, { exceptHero: true })) { said(ctx, t("IPC.Talents.Dup", { name: ref.name })); ctx.rerender(); return false; }
    d.msg = note; d.landed = "hero";
    ctx.update((st) => ({ ...setHeroTalent(st, ref), rerolls: { ...st.rerolls, ...bumps } }), { body: true });
    ctx.announce(t("IPC.Talents.Hero.Set", { name: ref.name }));
    return true;
  }
  if (!canTakeTalent(s, ref.name)) { said(ctx, t("IPC.Talents.Dup", { name: ref.name })); ctx.rerender(); return false; }
  if (!guardOk(s, 1)) { said(ctx, t("IPC.Talents.NoBudget")); ctx.rerender(); return false; }
  d.msg = note;
  ctx.update((st) => ({ ...addExtraTalent(st, ref), rerolls: { ...st.rerolls, ...bumps } }), { body: true });
  ctx.announce(t("IPC.Talents.Extra.Added", { name: ref.name, budget: budget(ctx.state) }));
  return true;
}

/** a bare "Knowledgeable" becomes a subject variant (D6 table); returns {entry, bumps, note} or null when nothing could be rolled */
async function expandKnowledgeable(ctx, e, bumps = {}) {
  if (nm(e.name) !== KNOW) return { entry: e, bumps, note: "" };
  const r = await subjectRoll(ctx);
  if (!r) { said(ctx, t("IPC.Talents.Know.Fail")); ctx.rerender(); return null; }
  return { entry: r.e, bumps: { ...bumps, knowSubject: r.m + 1 }, note: t("IPC.Talents.Know.Rolled", { die: r.die, name: r.e.name }) };
}

function nextFree(list, start, ok) {
  for (let i = 0; i < list.length; i++) { const e = list[(start + i) % list.length]; if (ok(e)) return e; }
  return null;
}

async function rollHero(ctx) {
  const s = ctx.state, d = ctx.data;
  const arch = d.archHero.length > 0, list = arch ? d.archHero : d.talents;
  const n = s.rerolls?.heroTalent ?? 0;
  const rng = substream(s.seed, `heroTalent:${n}`);
  const die = arch && list.length === 6 ? rng.d6() : null;
  const start = die ? die - 1 : rng.int(list.length);
  const e = nextFree(list, start, (x) => canTakeTalent(s, x.name, { exceptHero: true }) && nm(x.name) !== nm(s.heroTalent?.name ?? ""));
  if (!e) return;
  const x = await expandKnowledgeable(ctx, e, { heroTalent: n + 1 });
  if (!x) return;
  const note = x.note || (die ? t("IPC.Talents.Hero.Rolled", { die, name: e.name }) : "");
  commitTalent(ctx, x.entry, "hero", x.bumps, note);
}

async function rollExtra(ctx) {
  const s = ctx.state, d = ctx.data;
  if (!guardOk(s, 1)) { said(ctx, t("IPC.Talents.NoBudget")); return ctx.rerender(); }
  const n = s.rerolls?.talentAdd ?? 0;
  const rng = substream(s.seed, `talentAdd:${n}`);
  const pool = d.talents.filter((x) => canTakeTalent(s, x.name) && !REPEATABLE_TALENTS.includes(nm(x.name)));
  if (!pool.length) return;
  const e = rng.pick(pool);
  const x = await expandKnowledgeable(ctx, e, { talentAdd: n + 1 });
  if (!x) return;
  commitTalent(ctx, x.entry, "extra", x.bumps, x.note);
}

function rollDrawback(ctx) {
  const s = ctx.state, d = ctx.data;
  if (s.drawbacks.length >= MAX_DRAWBACKS) { said(ctx, t("IPC.Talents.Dr.Max", { max: MAX_DRAWBACKS })); return ctx.rerender(); }
  const arch = d.archDr.length > 0, list = arch ? d.archDr : d.drawbacks;
  const n = s.rerolls?.drawbackAdd ?? 0;
  const rng = substream(s.seed, `drawbackAdd:${n}`);
  const die = arch && list.length === 6 ? rng.d6() : null;
  const e = nextFree(list, die ? die - 1 : rng.int(list.length), (x) => canTakeDrawback(s, x.name) && !REPEATABLE_DRAWBACKS.includes(nm(x.name)));
  if (!e) return;
  d.msg = die ? t("IPC.Talents.Hero.Rolled", { die, name: e.name }) : "";
  d.landed = `d${s.drawbacks.length}`;
  ctx.update((st) => ({ ...addDrawback(st, { name: e.name, packUuid: e.packUuid ?? null, note: "", needs: needsOf(d, e) }), rerolls: { ...st.rerolls, drawbackAdd: n + 1 } }), { body: true });
  ctx.announce(t("IPC.Talents.Dr.Added", { name: e.name, budget: budget(ctx.state) }));
}

function takeDrawback(ctx, name, uuid) {
  const s = ctx.state, d = ctx.data;
  if (s.drawbacks.length >= MAX_DRAWBACKS) { said(ctx, t("IPC.Talents.Dr.Max", { max: MAX_DRAWBACKS })); return ctx.rerender(); }
  if (!canTakeDrawback(s, name)) { said(ctx, t("IPC.Talents.Dr.Dup", { name })); return ctx.rerender(); }
  d.msg = ""; d.landed = `d${s.drawbacks.length}`;
  ctx.update((st) => addDrawback(st, { name, packUuid: uuid || null, note: "", needs: needsOf(d, { name }) }), { body: true });
  ctx.announce(t("IPC.Talents.Dr.Added", { name, budget: budget(ctx.state) }));
}

/* ---------------------------------------------------------------- the step */
async function syncArchetype(ctx) {
  const d = ctx.data, name = ctx.state.archetype ?? null;
  if (d.archFor === name) return false;
  d.archFor = name;
  d.archHero = []; d.archDr = [];
  if (name) {
    try {
      const P = ctx.provider();
      const [h, dr] = await Promise.all([P.list("heroTalents", { archetype: name }), P.list("drawbacks", { archetype: name })]);
      if (d.archFor !== name) return false;
      d.archHero = isShortlist(h) ? h : [];
      d.archDr = isShortlist(dr) ? dr : [];
    } catch (err) { console.warn("invincible-plus-ultra | chargen: archetype lists failed", err); }
  }
  if (d.srcName !== name) {   // the switches fall back to their default only when the archetype itself changed
    d.srcName = name;
    d.tsrc = d.archHero.length ? "arch" : "all";
    d.dsrc = d.archDr.length ? "arch" : "all";
    d.tlimit = PAGE; d.dlimit = PAGE;
  } else {
    if (!d.archHero.length) d.tsrc = "all";
    if (!d.archDr.length) d.dsrc = "all";
  }
  return true;
}

export default {
  id: "talents",
  icon: "fa-solid fa-star",

  async load(ctx) {
    const d = ctx.data;
    Object.assign(d, { desc: new Map(), inflight: new Map(), open: new Set(), tq: "", dq: "", tlimit: PAGE, dlimit: PAGE, tcount: 0, dcount: 0, target: ctx.state.heroTalent ? "extra" : "hero", tsrc: "all", dsrc: "all", archHero: [], archDr: [], msg: "", landed: null, srcName: undefined });
    d.fxPaint = fxTags;
    d.talents = await ctx.catalog.talents();
    d.drawbacks = await ctx.catalog.drawbacks();
    d.tmap = new Map(d.talents.map((e) => [nm(e.name), e.packUuid]));
    d.dmap = new Map(d.drawbacks.map((e) => [nm(e.name), e.packUuid]));
    d.dneeds = new Map(d.drawbacks.filter((e) => e.needs).map((e) => [nm(e.name), e.needs]));
    d.archFor = undefined;
    await syncArchetype(ctx);
  },

  render(ctx) {
    return `<div class="ipc-powers ipc-talents">
      ${status(ctx)}
      ${meter(ctx)}
      ${heroBlock(ctx)}
      ${talentPanel(ctx)}
      ${drawbackPanel(ctx)}
      ${fxPanel(ctx)}
    </div>`;
  },

  mount(ctx, root) {
    const d = ctx.data;
    syncArchetype(ctx).then((changed) => { if (changed && root.isConnected) ctx.rerender(); });
    warmBonuses(ctx.state, ctx.catalog).then((grew) => { if (grew && root.isConnected) ctx.rerender(); }).catch(() => {});
    enrich(root, d);
    if (d.landed) { requestAnimationFrame(() => root.querySelector(".ipc-landed")?.scrollIntoView({ block: "nearest" })); d.landed = null; }

    const repaint = () => {
      const tal = root.querySelector('[data-list="tal"]'), dr = root.querySelector('[data-list="dr"]');
      if (tal) tal.innerHTML = talentRows(ctx);
      if (dr) dr.innerHTML = drawbackRows(ctx);
      const rt = root.querySelector('[data-results="tal"]'), rd = root.querySelector('[data-results="dr"]');
      if (rt) rt.textContent = t("IPC.Talents.Cat.Results", { n: d.tcount });
      if (rd) rd.textContent = t("IPC.Talents.Dr.Results", { n: d.dcount });
      enrich(root, d);
    };
    let timer = 0;
    root.addEventListener("input", (ev) => {
      const el = ev.target;
      if (!(el instanceof HTMLInputElement)) return;
      if (el.name === "tl-q") { d.tq = el.value; d.tlimit = PAGE; }
      else if (el.name === "dr-q") { d.dq = el.value; d.dlimit = PAGE; }
      else if (el.name.startsWith("dbnote-")) {
        const i = Number(el.name.slice(7)), val = el.value.replace(/\s+/g, " ").slice(0, 60);
        ctx.update((st) => ({ ...st, drawbacks: st.drawbacks.map((x, j) => (j === i ? { ...x, note: val } : x)) }), { coalesce: `dbnote-${i}` });
        return;
      } else return;
      clearTimeout(timer);
      timer = setTimeout(repaint, 90);
    });
    root.addEventListener("change", (ev) => {
      const el = ev.target;
      if (el instanceof HTMLInputElement && el.name?.startsWith("dbnote-")) { ctx.rerender(); return; }   // the "still to choose" marker follows the field once it is left
      if (!(el instanceof HTMLInputElement) || el.type !== "radio") return;
      if (el.name === "tl-target") { d.target = el.value; ctx.rerender(); }
      else if (el.name === "tl-src") { d.tsrc = el.value; d.tlimit = PAGE; ctx.rerender(); }
      else if (el.name === "dr-src") { d.dsrc = el.value; d.dlimit = PAGE; ctx.rerender(); }
    });

    delegate(root, "click", "[data-act]", async (ev, el) => {
      const act = el.dataset.act, s = ctx.state;
      const refocus = (sel) => requestAnimationFrame(() => ctx.app.focusBody(sel));
      if (el.getAttribute("aria-disabled") === "true") {
        if (act === "take-drawback" && s.drawbacks.length >= MAX_DRAWBACKS && canTakeDrawback(s, el.dataset.name)) { said(ctx, t("IPC.Talents.Dr.Max", { max: MAX_DRAWBACKS })); ctx.rerender(); }
        return;
      }
      switch (act) {
        case "go-attr": ctx.go("attributes"); break;
        case "go-life": ctx.go("life"); break;
        case "more": { const u = el.dataset.uuid; if (d.open.has(u)) d.open.delete(u); else d.open.add(u); ctx.rerender(); break; }
        case "book": openBook(el.dataset.uuid); break;
        case "tal-more": { const first = d.tlimit; d.tlimit += PAGE; ctx.rerender(); const e = talentList(ctx).filter((x) => !nm(d.tq) || nm(x.name).includes(nm(d.tq)))[first]; if (e) refocus(`[data-fk="tl-${slug(e.name)}"]`); break; }
        case "dr-more": { const first = d.dlimit; d.dlimit += PAGE; ctx.rerender(); const e = drawbackList(ctx).filter((x) => !nm(d.dq) || nm(x.name).includes(nm(d.dq)))[first]; if (e) refocus(`[data-fk="dr-${slug(e.name)}"]`); break; }
        case "pick-talent": {
          const name = el.dataset.name, uuid = el.dataset.uuid;
          const x = await expandKnowledgeable(ctx, { name, packUuid: uuid || null });
          if (x) commitTalent(ctx, x.entry, d.target, x.bumps, x.note);
          break;
        }
        case "clear-hero":
          ctx.update((st) => setHeroTalent(st, null), { body: true });
          ctx.announce(t("IPC.Talents.Hero.Cleared"));
          refocus("#ipc-tl-h-mine");
          break;
        case "rm-extra": {
          const i = Number(el.dataset.i), name = s.extraTalents[i]?.name ?? "";
          d.msg = "";
          ctx.update((st) => removeExtraTalent(st, i), { body: true });
          ctx.announce(t("IPC.Talents.Extra.Removed", { name, budget: budget(ctx.state) }));
          refocus("#ipc-tl-h-mine");
          break;
        }
        case "roll-hero": await rollHero(ctx); break;
        case "roll-extra": await rollExtra(ctx); break;
        case "roll-drawback": rollDrawback(ctx); break;
        case "take-drawback": takeDrawback(ctx, el.dataset.name, el.dataset.uuid); break;
        case "rm-drawback": {
          const i = Number(el.dataset.i), name = s.drawbacks[i]?.name ?? "";
          d.msg = "";
          ctx.update((st) => removeDrawback(st, i), { body: true });
          ctx.announce(t("IPC.Talents.Dr.Removed", { name, budget: budget(ctx.state) }));
          refocus("#ipc-tl-h-drmine");
          break;
        }
        default: break;
      }
    });
  },

  onState(ctx) {
    const d = ctx.data;
    if (!d.desc) return;
    d.msg = ""; d.landed = null; d.archFor = undefined;
  }
};
