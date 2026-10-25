/* Step "life" (phase 5e): OCCUPATION (22 from the creation tables, each with its Resources value and the book's short description), the free
   OCCUPATION TALENT (D3 per occupation) and the NPC KEY RELATIONSHIP (D3 prompt per occupation + a name).
   One scrolling column (same grammar as the powers / talents steps): a Resources panel -> "Your occupation" (archetype shortlist of three <-> all 22,
   dice, or an own occupation with its own Resources value) -> "Occupation talent" (the occupation's three, dice) -> "Key relationship" (three prompts,
   dice, free text for the person's name and kind, a seeded name roll from the module-owned name lists).
   DATA AT RUNTIME: occupation names + Resources from provider.list("occupations") (the chargen-tables pack), the occupation's talents / prompts from
   provider.list("occupationTalents" | "npcRelations", {occupation}), the short occupation text from the installed core book page "Occupation" (read with
   fromUuid, cached for the window, never stored in the module), talent descriptions from the talent documents (steps/shared.mjs).
   WHAT IT WRITES (state.mjs): occupation, resources (the occupation's value; talent effects such as Windfall come on top through bonuses.mjs),
   occTalent, npcRel {type, name}. apply.mjs turns them into the sheet fields occupation / resources / "NPC: Name (kind)" and the talent item.
   DICE: seeded substreams (seed + state.rerolls counters occupation / occTalent / npcRel / npcName / knowSubject): undo restores the counters, so
   undo + roll again gives the same result. The tables are D3 / D22; a roll is a uniform seeded pick over the table's rows (the same distribution as
   RollTable.roll(), which cannot be seeded). */
import { t } from "../lang.mjs";
import { validateStep, normName, REPEATABLE_TALENTS } from "../rules.mjs";
import { substream } from "../rng.mjs";
import { FX_FIELDS, fxOf, itemRefs, bonusSum, warmBonuses } from "../bonuses.mjs";
import { esc, icon, msgText, delegate } from "./util.mjs";
import { slug, enrich, descBlock, rowLinks, openBook, bindAutosave } from "./shared.mjs";

const nm = normName;
const BOOK = "Compendium.invincible-core.core-book.JournalEntry.Rbx4P6GQT5EoFNUG";
const KNOW = "knowledgeable";
const RES_MIN = 1, RES_MAX = 6;
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const signed = (v) => (v > 0 ? `+${v}` : String(v));
const said = (ctx, text) => { ctx.data.msg = text; };

/* ---------------------------------------------------------------- the book's short occupation text (runtime only) */
async function readOccupationTexts() {
  const map = new Map();
  try {
    const j = await fromUuid(BOOK);
    const page = j?.pages?.find((p) => p.name === "Occupation");
    const html = page?.text?.content;
    if (!html) return map;
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html").body.firstElementChild;
    for (const h of doc.querySelectorAll("h2")) {
      let el = h.nextElementSibling;
      while (el && !["P", "H2", "DIV"].includes(el.tagName)) el = el.nextElementSibling;
      if (el?.tagName === "P") map.set(nm(h.textContent), clean(el.textContent));
    }
  } catch (err) { console.warn("invincible-plus-ultra | chargen: occupation texts unavailable", err); }
  return map;
}

/* ---------------------------------------------------------------- what is taken */
const takenElsewhere = (s) => [s.heroTalent?.name, ...s.extraTalents.map((x) => x.name)].filter(Boolean).map(nm);
function talentTaken(s, name) {
  const k = nm(name);
  return !REPEATABLE_TALENTS.includes(k) && takenElsewhere(s).includes(k);
}
const isBook = (d, name) => !!name && d.allMap.has(nm(name));

/* ---------------------------------------------------------------- small pieces */
function status(ctx) {
  const iss = validateStep(ctx.state, "life");
  if (!iss.issues.length) return `<p class="ipc-status ipc-ok" data-status>${icon("fa-solid fa-circle-check")} ${esc(t("IPC.Step.StatusOk"))}</p>`;
  const cls = (i) => (i.severity === "error" ? "ipc-iss-err" : i.severity === "info" ? "ipc-iss-info" : "ipc-iss-warn");
  return `<ul class="ipc-status-list" data-status>${iss.issues.map((i) => `<li class="${cls(i)}">${icon("fa-solid fa-circle-exclamation")}<span>${esc(msgText(i))}</span></li>`).join("")}</ul>`;
}
const die = (n) => `<span class="ipc-lf-die" aria-hidden="true">${n}</span>`;
const fxTags = (fx) => FX_FIELDS.filter((k) => fx?.[k]).map((k) => `<span class="ipc-tl-fx">${esc(t(`IPC.Talents.Fx.${k}`, { v: signed(fx[k]) }))}</span>`).join("");
const fxText = (fx) => FX_FIELDS.filter((k) => fx?.[k]).map((k) => t(`IPC.Talents.Fx.${k}`, { v: signed(fx[k]) })).join(", ");

function resourcesPanel(ctx) {
  const s = ctx.state, b = bonusSum(s);
  if (!s.occupation) return `<div class="ipc-lf-res is-empty">${icon("fa-solid fa-coins")}<p>${esc(t("IPC.Life.Res.Empty"))}</p></div>`;
  const total = (s.resources || 0) + (b.resources || 0);
  const from = itemRefs(s).map(({ type, ref }) => ({ ref, fx: fxOf(type, ref) })).filter((x) => x.fx?.resources);
  const parts = [t("IPC.Life.Res.Base", { n: s.resources || 0, occupation: s.occupation }), ...from.map((x) => t("IPC.Life.Res.From", { v: signed(x.fx.resources), name: x.ref.name }))];
  return `<div class="ipc-lf-res" role="group" aria-label="${esc(t("IPC.Life.Res.Label"))}">
    <div class="ipc-lf-res-n"><b>${total}</b><span>${esc(t("IPC.Life.Res.Label"))}</span></div>
    <div class="ipc-lf-res-t"><p><strong>${esc(t("IPC.Life.Res.Start", { n: total }))}</strong></p><p class="ipc-muted">${esc(parts.join("  ·  "))}</p></div>
  </div>`;
}

function chosenCheck(on) { return `${icon(on ? "fa-solid fa-check" : "fa-solid fa-plus")} ${esc(t(on ? "IPC.Life.Chosen" : "IPC.Life.Choose"))}`; }

/* ---- occupation */
function occList(ctx) {
  const d = ctx.data;
  return d.occSrc === "arch" && d.archOcc.length ? d.archOcc : d.all;
}
function occRows(ctx) {
  const d = ctx.data, s = ctx.state, cur = nm(s.occupation);
  const inArch = new Set(d.archOcc.map((e) => nm(e.name)));
  return occList(ctx).map((e, i) => {
    const on = nm(e.name) === cur;
    const text = d.occText.get(nm(e.name)) ?? "";
    const dieNo = d.occSrc === "arch" && d.archOcc.length ? die(i + 1) : "";
    return `<li class="ipc-pw-row${on ? " is-added" : ""}${ctx.data.landed === `o:${nm(e.name)}` ? " ipc-landed" : ""}">
      <div class="ipc-pw-row-main"><div class="ipc-pw-row-head">${dieNo}<span class="ipc-pw-name">${esc(e.name)}</span><span class="ipc-pw-badge">${icon("fa-solid fa-coins")} ${esc(t("IPC.Life.Occ.Resources", { n: e.data?.resources ?? "?" }))}</span>${d.occSrc === "all" && inArch.has(nm(e.name)) ? `<span class="ipc-pw-badge ipc-lf-arch">${esc(t("IPC.Life.Occ.FromArch", { name: s.archetype ?? "" }))}</span>` : ""}</div>
        ${text ? `<p class="ipc-pw-desc">${esc(text)}</p>` : ""}</div>
      <button type="button" class="ipc-btn ipc-btn-small${on ? "" : " ipc-btn-primary"}" data-act="pick-occ" data-name="${esc(e.name)}" data-fk="occ-${esc(slug(e.name))}" aria-pressed="${on}" aria-label="${esc(t("IPC.Life.Occ.PickAria", { name: e.name }))}">${chosenCheck(on)}</button>
    </li>`;
  }).join("");
}
function switchSet(name, legend, options, current) {
  return `<fieldset class="ipc-opts ipc-opts-types ipc-tl-switch"><legend>${esc(legend)}</legend>${options.map((o) => `<label class="ipc-opt ipc-opt-chip${current === o.value ? " is-on" : ""}"><input type="radio" name="${name}" value="${esc(o.value)}" data-fk="${name}-${esc(o.value)}"${current === o.value ? " checked" : ""}><span class="ipc-opt-text"><span class="ipc-opt-name">${esc(o.label)}</span></span>${icon("fa-solid fa-check ipc-opt-check")}</label>`).join("")}</fieldset>`;
}
function occSection(ctx) {
  const d = ctx.data, s = ctx.state;
  const open = !s.occupation || d.occOpen;
  const sw = open && d.archOcc.length ? switchSet("occ-src", t("IPC.Life.Occ.Source"), [{ value: "arch", label: t("IPC.Life.Occ.SrcArch", { name: s.archetype ?? "", n: d.archOcc.length }) }, { value: "all", label: t("IPC.Life.Occ.SrcAll", { n: d.all.length }) }], d.occSrc) : "";
  const own = !!s.occupation && !isBook(d, s.occupation);
  const bookCur = s.occupation && isBook(d, s.occupation) ? d.allMap.get(nm(s.occupation)) : null;
  const text = bookCur ? d.occText.get(nm(bookCur.name)) ?? "" : "";
  const curCard = s.occupation && !open
    ? `<div class="ipc-pw-card ipc-lf-cur${d.landed === `o:${nm(s.occupation)}` ? " ipc-landed" : ""}">
        <div class="ipc-pw-card-head"><h4 class="ipc-pw-cname">${esc(s.occupation)}</h4><span class="ipc-pw-badge">${icon("fa-solid fa-coins")} ${esc(t("IPC.Life.Occ.Resources", { n: s.resources || "?" }))}</span>
          <button type="button" class="ipc-btn ipc-btn-small" data-act="open-occ" data-fk="open-occ" aria-expanded="false">${icon("fa-solid fa-repeat")} ${esc(t("IPC.Life.Occ.Change"))}</button></div>
        ${text ? `<p class="ipc-pw-desc">${esc(text)}</p>` : ""}
      </div>`
    : "";
  return `<section class="ipc-pw-sec" aria-labelledby="ipc-lf-h-occ">
    <div class="ipc-cn-head"><h3 id="ipc-lf-h-occ" tabindex="-1">${esc(t("IPC.Life.Occ.Title"))}</h3>
      <button type="button" class="ipc-btn ipc-btn-small" data-act="roll-occ" data-fk="roll-occ" data-tooltip="${esc(t(d.occSrc === "arch" && d.archOcc.length ? "IPC.Life.Occ.RollTipArch" : "IPC.Life.Occ.RollTipAll", { n: d.all.length }))}">${icon("fa-solid fa-dice")} ${esc(t("IPC.Life.Occ.Roll"))}</button></div>
    <p class="ipc-cn-sub">${esc(t("IPC.Life.Occ.Sub"))}</p>
    <p class="ipc-pw-msg" role="status" data-msg="occ">${d.msgFor === "occ" && d.msg ? `${icon("fa-solid fa-circle-info")} ${esc(d.msg)}` : ""}</p>
    ${curCard}${sw}
    ${open ? `<ul class="ipc-pw-rows" data-list="occ">${occRows(ctx)}</ul>` : ""}
    ${open || own ? `<div class="ipc-lf-own${own ? " is-on" : ""}">
      <h4>${esc(t("IPC.Life.Own.Title"))}</h4>
      <p class="ipc-muted ipc-pw-hintline">${esc(t("IPC.Life.Own.Hint"))}</p>
      <div class="ipc-pw-custom">
        <label class="ipc-field"><span>${esc(t("IPC.Life.Own.Name"))}</span><input type="text" class="ipc-input" name="occ-own" data-save="occOwn" data-fk="occ-own" maxlength="60" autocomplete="off" value="${esc(own ? s.occupation : "")}"></label>
        <label class="ipc-field ipc-lf-resin"><span>${esc(t("IPC.Life.Own.Resources", { min: RES_MIN, max: RES_MAX }))}</span><input type="number" class="ipc-input" name="occ-own-res" data-save="occOwnRes" data-fk="occ-own-res" min="${RES_MIN}" max="${RES_MAX}" step="1" inputmode="numeric" value="${own ? esc(s.resources || "") : ""}"></label>
      </div>
    </div>` : ""}
  </section>`;
}

/* ---- occupation talent */
function talentSection(ctx) {
  const d = ctx.data, s = ctx.state;
  if (!s.occupation) return `<section class="ipc-pw-sec" aria-labelledby="ipc-lf-h-tal"><div class="ipc-cn-head"><h3 id="ipc-lf-h-tal" tabindex="-1">${esc(t("IPC.Life.Tal.Title"))}</h3></div><div class="ipc-note-box ipc-pw-empty">${icon("fa-solid fa-briefcase")} ${esc(t("IPC.Life.Tal.NeedOcc"))}</div></section>`;
  const info = d.byOcc.get(nm(s.occupation));
  const book = isBook(d, s.occupation);
  const cur = s.occTalent;
  const inList = !!cur?.name && book && !!info?.tal.some((x) => nm(x.name) === nm(cur.name));   // a chosen subject variant (Knowledgeable (Technology)) keeps its card so the subject is visible
  const curCard = inList ? "" : cur?.name
    ? `<div class="ipc-pw-card ipc-tl-hero${d.landed === "tal" ? " ipc-landed" : ""}">
        <div class="ipc-pw-card-head"><h4 class="ipc-pw-cname">${esc(cur.name)}</h4><span class="ipc-pw-badge">${icon("fa-solid fa-briefcase")} ${esc(t("IPC.Life.Tal.Badge"))}</span>${fxSlot(d, uu(d, cur), cur)}
          <button type="button" class="ipc-btn ipc-btn-small ipc-btn-danger" data-act="clear-tal" data-fk="clear-tal" aria-label="${esc(t("IPC.Life.Tal.ClearAria", { name: cur.name }))}">${icon("fa-solid fa-xmark")} ${esc(t("IPC.Life.Tal.Clear"))}</button></div>
        ${descBlock(d, uu(d, cur))}${rowLinks(d, uu(d, cur), cur.name)}
      </div>`
    : `<div class="ipc-note-box ipc-pw-empty">${icon("fa-solid fa-star")} ${esc(t("IPC.Life.Tal.None"))}</div>`;
  let list = "";
  if (book && !info) list = `<p class="ipc-muted ipc-pw-none" data-loading>${icon("fa-solid fa-spinner fa-spin-pulse")} ${esc(t("IPC.Empty.LoadingStep"))}</p>`;
  else if (book && info.tal.length) {
    list = `<p class="ipc-cn-sub">${esc(t("IPC.Life.Tal.Sub", { occupation: s.occupation }))}</p><ul class="ipc-pw-rows" data-list="tal">${info.tal.map((e, i) => {
      const on = !!cur && (nm(cur.name) === nm(e.name) || (nm(e.name) === KNOW && /^knowledgeable\s*\(/i.test(cur.name)));
      const taken = !on && talentTaken(s, e.name);
      const uuid = d.tmap.get(nm(e.name)) ?? "";
      const bare = nm(e.name) === KNOW;
      const btn = taken
        ? `<button type="button" class="ipc-btn ipc-btn-small" data-act="pick-tal" data-name="${esc(e.name)}" data-fk="tal-${i}" aria-disabled="true" aria-label="${esc(t("IPC.Life.Tal.TakenAria", { name: e.name }))}">${icon("fa-solid fa-ban")} ${esc(t("IPC.Talents.Row.Taken"))}</button>`
        : `<button type="button" class="ipc-btn ipc-btn-small${on ? "" : " ipc-btn-primary"}" data-act="pick-tal" data-name="${esc(e.name)}" data-fk="tal-${i}" aria-pressed="${on}" aria-label="${esc(t(bare && !on ? "IPC.Life.Tal.SubjectAria" : "IPC.Life.Tal.PickAria", { name: e.name }))}">${bare && !on ? `${icon("fa-solid fa-dice")} ${esc(t("IPC.Talents.Row.RollSubject"))}` : chosenCheck(on)}</button>`;
      return `<li class="ipc-pw-row${on ? " is-added" : ""}">
        <div class="ipc-pw-row-main"><div class="ipc-pw-row-head">${die(i + 1)}<span class="ipc-pw-name">${esc(e.name)}</span>${taken ? `<span class="ipc-pw-badge">${esc(t("IPC.Life.Tal.TakenBy"))}</span>` : ""}${fxSlot(d, uuid, e)}</div>${descBlock(d, uuid)}${rowLinks(d, uuid, e.name)}</div>
        ${btn}
      </li>`;
    }).join("")}</ul>`;
  } else {
    // an own occupation (or a table without entries): any talent of the book, chosen from a list
    const opts = d.talents.filter((e) => !talentTaken(s, e.name) || nm(e.name) === nm(cur?.name));
    list = `<p class="ipc-cn-sub">${esc(t("IPC.Life.Tal.Own"))}</p>
      <label class="ipc-field ipc-lf-sel"><span>${esc(t("IPC.Life.Tal.OwnLabel"))}</span><select class="ipc-input" name="tal-any" data-fk="tal-any"><option value=""${cur ? "" : " selected"}>${esc(t("IPC.Life.Tal.OwnNone"))}</option>${opts.map((e) => `<option value="${esc(e.name)}"${nm(e.name) === nm(cur?.name) ? " selected" : ""}>${esc(e.name)}</option>`).join("")}</select></label>`;
  }
  return `<section class="ipc-pw-sec" aria-labelledby="ipc-lf-h-tal">
    <div class="ipc-cn-head"><h3 id="ipc-lf-h-tal" tabindex="-1">${esc(t("IPC.Life.Tal.Title"))}</h3>
      ${book ? `<button type="button" class="ipc-btn ipc-btn-small" data-act="roll-tal" data-fk="roll-tal" data-tooltip="${esc(t("IPC.Life.Tal.RollTip"))}">${icon("fa-solid fa-dice")} ${esc(t("IPC.Life.Tal.Roll"))}</button>` : ""}</div>
    <p class="ipc-pw-msg" role="status" data-msg="tal">${d.msgFor === "tal" && d.msg ? `${icon("fa-solid fa-circle-info")} ${esc(d.msg)}` : ""}</p>
    ${curCard}${list}
  </section>`;
}
const uu = (d, ref) => ref?.packUuid || d.tmap.get(nm(ref?.name)) || null;
const fxSlot = (d, uuid, ref) => `<span class="ipc-tl-fxs" data-fxfor="${esc(uuid ?? "")}">${fxTags(d.desc.get(uuid)?.fx ?? fxOf("talent", ref))}</span>`;

/* ---- key relationship */
function relSection(ctx) {
  const d = ctx.data, s = ctx.state;
  if (!s.occupation) return `<section class="ipc-pw-sec" aria-labelledby="ipc-lf-h-rel"><div class="ipc-cn-head"><h3 id="ipc-lf-h-rel" tabindex="-1">${esc(t("IPC.Life.Rel.Title"))}</h3></div><div class="ipc-note-box ipc-pw-empty">${icon("fa-solid fa-user-group")} ${esc(t("IPC.Life.Rel.NeedOcc"))}</div></section>`;
  const info = d.byOcc.get(nm(s.occupation));
  const book = isBook(d, s.occupation);
  let rows = "";
  if (book && !info) rows = `<p class="ipc-muted ipc-pw-none">${icon("fa-solid fa-spinner fa-spin-pulse")} ${esc(t("IPC.Empty.LoadingStep"))}</p>`;
  else if (book && info.rel.length) {
    rows = `<ul class="ipc-pw-rows" data-list="rel">${info.rel.map((e, i) => {
      const on = nm(s.npcRel.type) === nm(e.name);
      return `<li class="ipc-pw-row${on ? " is-added" : ""}${d.landed === `r${i}` ? " ipc-landed" : ""}">
        <div class="ipc-pw-row-main"><div class="ipc-pw-row-head">${die(i + 1)}<span class="ipc-pw-name">${esc(e.name)}</span></div>${e.text ? `<p class="ipc-pw-desc">${esc(e.text)}</p>` : ""}</div>
        <button type="button" class="ipc-btn ipc-btn-small${on ? "" : " ipc-btn-primary"}" data-act="pick-rel" data-i="${i}" data-fk="rel-${i}" aria-pressed="${on}" aria-label="${esc(t("IPC.Life.Rel.PickAria", { name: e.name }))}">${chosenCheck(on)}</button>
      </li>`;
    }).join("")}</ul>`;
  }
  const line = s.npcRel.name || s.npcRel.type ? `NPC: ${[s.npcRel.name, s.npcRel.type ? `(${s.npcRel.type})` : ""].filter(Boolean).join(" ")}` : "";
  return `<section class="ipc-pw-sec" aria-labelledby="ipc-lf-h-rel">
    <div class="ipc-cn-head"><h3 id="ipc-lf-h-rel" tabindex="-1">${esc(t("IPC.Life.Rel.Title"))}</h3>
      ${book ? `<button type="button" class="ipc-btn ipc-btn-small" data-act="roll-rel" data-fk="roll-rel" data-tooltip="${esc(t("IPC.Life.Rel.RollTip"))}">${icon("fa-solid fa-dice")} ${esc(t("IPC.Life.Rel.Roll"))}</button>` : ""}</div>
    <p class="ipc-cn-sub">${esc(t("IPC.Life.Rel.Sub"))}</p>
    <p class="ipc-pw-msg" role="status" data-msg="rel">${d.msgFor === "rel" && d.msg ? `${icon("fa-solid fa-circle-info")} ${esc(d.msg)}` : ""}</p>
    ${rows}
    <div class="ipc-lf-npc">
      <div class="ipc-lf-npc-name">
        <label class="ipc-field"><span>${esc(t("IPC.Life.Rel.Name"))}</span><input type="text" class="ipc-input" name="npc-name" data-save="npcName" data-fk="npc-name" maxlength="60" autocomplete="off" value="${esc(s.npcRel.name)}"></label>
        <button type="button" class="ipc-btn ipc-btn-small" data-act="roll-npcname" data-fk="roll-npcname" data-tooltip="${esc(t("IPC.Life.Rel.NameRollTip"))}" aria-label="${esc(t("IPC.Life.Rel.NameRollAria"))}">${icon("fa-solid fa-dice")} ${esc(t("IPC.Life.Rel.NameRoll"))}</button>
      </div>
      <label class="ipc-field"><span>${esc(t("IPC.Life.Rel.Kind"))}</span><input type="text" class="ipc-input" name="npc-type" data-save="npcType" data-fk="npc-type" maxlength="80" autocomplete="off" value="${esc(s.npcRel.type)}" placeholder="${esc(t("IPC.Life.Rel.KindPh"))}"></label>
      <p class="ipc-muted ipc-pw-hintline">${esc(t("IPC.Life.Rel.Hint"))} <code class="ipc-lf-line" data-npcline>${esc(line || t("IPC.Summary.None"))}</code></p>
    </div>
  </section>`;
}

/* ---------------------------------------------------------------- data + actions */
async function ensureOcc(ctx, name) {
  const d = ctx.data, k = nm(name);
  if (!name || !isBook(d, name) || d.byOcc.has(k)) return;
  const P = ctx.provider();
  try {
    const [tal, rel] = await Promise.all([P.list("occupationTalents", { occupation: name }), P.list("npcRelations", { occupation: name })]);
    d.byOcc.set(k, { tal, rel });
  } catch (err) {
    console.warn("invincible-plus-ultra | chargen: occupation lists failed", name, err);
    d.byOcc.set(k, { tal: [], rel: [] });
  }
}

async function syncArchetype(ctx) {
  const d = ctx.data, name = ctx.state.archetype ?? null;
  if (d.archFor === name) return false;
  d.archFor = name; d.archOcc = [];
  if (name) {
    try {
      const l = await ctx.provider().list("occupations", { archetype: name });
      if (d.archFor !== name) return false;
      d.archOcc = l.length && l.length <= 8 ? l : [];
    } catch (err) { console.warn("invincible-plus-ultra | chargen: archetype occupations failed", err); }
  }
  if (d.srcName !== name) { d.srcName = name; d.occSrc = d.archOcc.length ? "arch" : "all"; }
  else if (!d.archOcc.length) d.occSrc = "all";
  return true;
}

/** the bare "Knowledgeable" asks for a subject: roll the book's D6 table (seeded) and take the variant item */
async function subjectRoll(ctx) {
  const d = ctx.data, s = ctx.state;
  let list = [];
  try { list = await ctx.provider().list("knowledgeableSubjects", {}); } catch (err) { console.warn("invincible-plus-ultra | chargen: subjects table failed", err); }
  if (!list.length) list = d.talents.filter((e) => /^knowledgeable\s*\(/i.test(e.name));
  if (!list.length) return null;
  const m = s.rerolls?.knowSubject ?? 0;
  const n = substream(s.seed, `knowSubject:${m}`).d6();
  return { e: list[(n - 1) % list.length], die: n, m };
}

async function chooseOccupation(ctx, entry, { rolled = null } = {}) {
  const d = ctx.data, s = ctx.state;
  if (nm(entry.name) === nm(s.occupation) && isBook(d, s.occupation)) return;
  await ensureOcc(ctx, entry.name);
  const info = d.byOcc.get(nm(entry.name)) ?? { tal: [], rel: [] };
  const prev = d.byOcc.get(nm(s.occupation));
  const prevPrompts = (prev?.rel ?? []).map((r) => nm(r.name));
  const keepTal = s.occTalent?.name && info.tal.some((x) => nm(x.name) === nm(s.occTalent.name) || (nm(x.name) === KNOW && /^knowledgeable\s*\(/i.test(s.occTalent.name)));
  const resources = entry.data?.resources ?? s.resources ?? RES_MIN;
  d.landed = `o:${nm(entry.name)}`; d.msgFor = "occ";
  d.msg = rolled ?? (keepTal || !s.occTalent?.name ? "" : t("IPC.Life.Occ.TalentReset", { name: s.occTalent.name }));
  ctx.update((st) => ({
    ...st, occupation: entry.name, resources,
    occTalent: keepTal ? st.occTalent : null,
    npcRel: { ...st.npcRel, type: prevPrompts.includes(nm(st.npcRel.type)) ? "" : st.npcRel.type }
  }), { body: true });
  ctx.announce(t("IPC.Life.Occ.Set", { name: entry.name, n: resources }));
}

function nextFree(list, start, ok) {
  for (let i = 0; i < list.length; i++) { const e = list[(start + i) % list.length]; if (ok(e)) return e; }
  return null;
}

async function rollOccupation(ctx) {
  const s = ctx.state, d = ctx.data;
  const pool = occList(ctx);
  if (!pool.length) return;
  const n = s.rerolls?.occupation ?? 0;
  const rng = substream(s.seed, `occupation:${n}`);
  const idx = rng.int(pool.length);
  const e = nextFree(pool, idx, (x) => nm(x.name) !== nm(s.occupation)) ?? pool[idx];
  const rolled = pool.length <= 6 ? t("IPC.Life.Rolled", { die: pool.indexOf(e) + 1, name: e.name }) : t("IPC.Life.RolledPlain", { name: e.name });
  const bump = (st) => ({ ...st, rerolls: { ...st.rerolls, occupation: n + 1 } });
  await ensureOcc(ctx, e.name);
  const info = d.byOcc.get(nm(e.name)) ?? { tal: [], rel: [] };
  const prevPrompts = (d.byOcc.get(nm(s.occupation))?.rel ?? []).map((r) => nm(r.name));
  const keepTal = s.occTalent?.name && info.tal.some((x) => nm(x.name) === nm(s.occTalent.name) || (nm(x.name) === KNOW && /^knowledgeable\s*\(/i.test(s.occTalent.name)));
  d.landed = `o:${nm(e.name)}`; d.msgFor = "occ"; d.msg = rolled;
  ctx.update((st) => bump({
    ...st, occupation: e.name, resources: e.data?.resources ?? st.resources ?? RES_MIN,
    occTalent: keepTal ? st.occTalent : null,
    npcRel: { ...st.npcRel, type: prevPrompts.includes(nm(st.npcRel.type)) ? "" : st.npcRel.type }
  }), { body: true });
  ctx.announce(t("IPC.Life.Occ.Set", { name: e.name, n: e.data?.resources ?? "" }));
}

/** commit the occupation talent (an entry {name, packUuid}); `bumps` = counters of a dice roll */
function commitTalent(ctx, entry, bumps = {}, note = "") {
  const d = ctx.data, s = ctx.state;
  if (talentTaken(s, entry.name)) { d.msgFor = "tal"; d.msg = t("IPC.Life.Tal.Dup", { name: entry.name }); ctx.rerender(); return false; }
  d.msgFor = "tal"; d.msg = note; d.landed = "tal";
  ctx.update((st) => ({ ...st, occTalent: { name: entry.name, packUuid: entry.packUuid ?? d.tmap.get(nm(entry.name)) ?? null }, rerolls: { ...st.rerolls, ...bumps } }), { body: true });
  ctx.announce(t("IPC.Life.Tal.Set", { name: entry.name }));
  return true;
}
async function takeTalent(ctx, entry, bumps = {}, rolledNote = "") {
  if (nm(entry.name) !== KNOW) return commitTalent(ctx, entry, bumps, rolledNote);
  const r = await subjectRoll(ctx);
  if (!r) { ctx.data.msgFor = "tal"; ctx.data.msg = t("IPC.Talents.Know.Fail"); ctx.rerender(); return false; }
  return commitTalent(ctx, r.e, { ...bumps, knowSubject: r.m + 1 }, t("IPC.Talents.Know.Rolled", { die: r.die, name: r.e.name }));
}
async function rollTalent(ctx) {
  const s = ctx.state, d = ctx.data;
  const info = d.byOcc.get(nm(s.occupation));
  const list = info?.tal ?? [];
  if (!list.length) return;
  const n = s.rerolls?.occTalent ?? 0;
  const rng = substream(s.seed, `occTalent:${n}`);
  const idx = rng.int(list.length);
  const e = nextFree(list, idx, (x) => !talentTaken(s, x.name) && nm(x.name) !== nm(s.occTalent?.name ?? "")) ?? nextFree(list, idx, (x) => !talentTaken(s, x.name));
  if (!e) { d.msgFor = "tal"; d.msg = t("IPC.Life.Tal.AllTaken"); ctx.rerender(); return; }
  await takeTalent(ctx, e, { occTalent: n + 1 }, t("IPC.Life.Rolled", { die: list.indexOf(e) + 1, name: e.name }));
}

function setPrompt(ctx, e, i, bumps = {}, note = "") {
  const d = ctx.data;
  d.landed = `r${i}`; d.msgFor = "rel"; d.msg = note;
  ctx.update((st) => ({ ...st, npcRel: { ...st.npcRel, type: e.name }, rerolls: { ...st.rerolls, ...bumps } }), { body: true });
  ctx.announce(t("IPC.Life.Rel.Set", { name: e.name }));
}
function rollRelationship(ctx) {
  const s = ctx.state, d = ctx.data;
  const list = d.byOcc.get(nm(s.occupation))?.rel ?? [];
  if (!list.length) return;
  const n = s.rerolls?.npcRel ?? 0;
  const idx = substream(s.seed, `npcRel:${n}`).int(list.length);
  const e = nextFree(list, idx, (x) => nm(x.name) !== nm(s.npcRel.type)) ?? list[idx];
  setPrompt(ctx, e, list.indexOf(e), { npcRel: n + 1 }, t("IPC.Life.Rolled", { die: list.indexOf(e) + 1, name: e.name }));
}
async function rollNpcName(ctx) {
  const s = ctx.state, d = ctx.data;
  const n = s.rerolls?.npcName ?? 0;
  const rng = substream(s.seed, `npcName:${n}`);
  let name = "";
  try {
    const P = ctx.provider();
    if (typeof P.roll === "function") name = (await P.roll("civilianNames", rng, { purpose: "npc" }))?.name ?? "";
    if (!name) { const l = await P.list("civilianNames", { purpose: "npc" }); name = rng.pick(l)?.name ?? ""; }
  } catch (err) { console.warn("invincible-plus-ultra | chargen: name roll failed", err); }
  if (!name) { d.msgFor = "rel"; d.msg = t("IPC.Life.Rel.NameFail"); ctx.rerender(); return; }
  d.msgFor = "rel"; d.msg = t("IPC.Life.Rel.NameRolled", { name });
  ctx.update((st) => ({ ...st, npcRel: { ...st.npcRel, name }, rerolls: { ...st.rerolls, npcName: n + 1 } }), { body: true });
  ctx.announce(t("IPC.Life.Rel.NameRolled", { name }));
}

/* ---------------------------------------------------------------- the step */
export default {
  id: "life",
  icon: "fa-solid fa-briefcase",

  async load(ctx) {
    const d = ctx.data;
    Object.assign(d, { desc: new Map(), inflight: new Map(), open: new Set(), byOcc: new Map(), archOcc: [], occSrc: "all", srcName: undefined, archFor: undefined, msg: "", msgFor: "", landed: null, occOpen: false });
    d.fxPaint = fxTags;
    d.all = await ctx.provider().list("occupations", {});
    d.allMap = new Map(d.all.map((e) => [nm(e.name), e]));
    d.talents = await ctx.catalog.talents();
    d.tmap = new Map(d.talents.map((e) => [nm(e.name), e.packUuid]));
    d.occText = await readOccupationTexts();
    await syncArchetype(ctx);
    await ensureOcc(ctx, ctx.state.occupation);
  },

  render(ctx) {
    return `<div class="ipc-powers ipc-life">
      ${status(ctx)}
      ${resourcesPanel(ctx)}
      ${occSection(ctx)}
      ${talentSection(ctx)}
      ${relSection(ctx)}
    </div>`;
  },

  mount(ctx, root) {
    const d = ctx.data;
    syncArchetype(ctx).then((changed) => { if (changed && root.isConnected) ctx.rerender(); });
    ensureOcc(ctx, ctx.state.occupation).then(() => { if (root.isConnected && root.querySelector("[data-loading], .ipc-pw-none .fa-spinner")) ctx.rerender(); });
    warmBonuses(ctx.state, ctx.catalog).then((grew) => { if (grew && root.isConnected) ctx.rerender(); }).catch(() => {});
    enrich(root, d);
    if (d.landed) { requestAnimationFrame(() => root.querySelector(".ipc-landed")?.scrollIntoView({ block: "nearest" })); d.landed = null; }

    const swap = (sel, html) => { const el = root.querySelector(sel); if (!el) return; const tpl = document.createElement("template"); tpl.innerHTML = html.trim(); const n = tpl.content.firstElementChild; if (n) el.replaceWith(n); };
    const patchBelow = () => {
      swap(".ipc-lf-res", resourcesPanel(ctx));
      swap('section[aria-labelledby="ipc-lf-h-tal"]', talentSection(ctx));
      swap('section[aria-labelledby="ipc-lf-h-rel"]', relSection(ctx));
      enrich(root, d);
    };
    const refreshStatus = () => {
      const st = root.querySelector("[data-status]");
      if (st) st.outerHTML = status(ctx);
      const line = root.querySelector("[data-npcline]"), r = ctx.state.npcRel;
      if (line) line.textContent = r.name || r.type ? `NPC: ${[r.name, r.type ? `(${r.type})` : ""].filter(Boolean).join(" ")}` : t("IPC.Summary.None");
    };
    const saver = bindAutosave(root, ctx, {
      apply(key, value) {
        const v = clean(value);
        if (key === "npcName") ctx.update((st) => ({ ...st, npcRel: { ...st.npcRel, name: v } }), { coalesce: "npcName" });
        else if (key === "npcType") ctx.update((st) => ({ ...st, npcRel: { ...st.npcRel, type: v } }), { coalesce: "npcType" });
        else if (key === "occOwn" || key === "occOwnRes") {
          const name = clean(root.querySelector('[name="occ-own"]')?.value);
          const res = Math.min(RES_MAX, Math.max(RES_MIN, parseInt(root.querySelector('[name="occ-own-res"]')?.value, 10) || ctx.state.resources || RES_MIN));
          if (!name) return;
          if (isBook(d, name)) return;   // a book name is picked from the list, not typed
          ctx.update((st) => ({ ...st, occupation: name, resources: res, occTalent: isBook(d, st.occupation) ? null : st.occTalent }), { coalesce: "occOwn" });
          patchBelow();   // the typing field keeps its focus: only the panels that depend on the occupation are swapped
        }
      },
      after: refreshStatus
    });

    root.addEventListener("change", (ev) => {
      const el = ev.target;
      if (el instanceof HTMLInputElement && el.type === "radio" && el.name === "occ-src") { d.occSrc = el.value; ctx.rerender(); }
      else if (el instanceof HTMLSelectElement && el.name === "tal-any") {
        const name = el.value;
        if (!name) { ctx.update((st) => ({ ...st, occTalent: null }), { body: true }); return; }
        takeTalent(ctx, { name, packUuid: d.tmap.get(nm(name)) ?? null });
      } else if (el instanceof HTMLInputElement && el.name === "occ-own-res") saver.flush();
    });

    delegate(root, "click", "[data-act]", async (ev, el) => {
      saver.flush();
      const act = el.dataset.act, s = ctx.state;
      if (el.getAttribute("aria-disabled") === "true") {
        if (act === "pick-tal") { d.msgFor = "tal"; d.msg = t("IPC.Life.Tal.Dup", { name: el.dataset.name }); ctx.rerender(); }
        return;
      }
      const refocus = (sel) => requestAnimationFrame(() => ctx.app.focusBody(sel));
      switch (act) {
        case "more": { const u = el.dataset.uuid; if (d.open.has(u)) d.open.delete(u); else d.open.add(u); ctx.rerender(); break; }
        case "book": openBook(el.dataset.uuid); break;
        case "pick-occ": {
          const e = d.allMap.get(nm(el.dataset.name));
          if (!e) break;
          if (nm(e.name) === nm(s.occupation)) { d.occOpen = false; ctx.rerender(); refocus("#ipc-lf-h-tal"); break; }
          d.occOpen = false;
          await chooseOccupation(ctx, e);
          refocus("#ipc-lf-h-tal");
          break;
        }
        case "open-occ": d.occOpen = true; ctx.rerender(); refocus('[data-list="occ"] [data-act="pick-occ"]'); break;
        case "roll-occ": d.occOpen = false; await rollOccupation(ctx); break;
        case "pick-tal": { const info = d.byOcc.get(nm(s.occupation)); const e = info?.tal.find((x) => nm(x.name) === nm(el.dataset.name)); if (e && !(s.occTalent && nm(s.occTalent.name) === nm(e.name))) await takeTalent(ctx, e); break; }
        case "roll-tal": await rollTalent(ctx); break;
        case "clear-tal": d.msgFor = ""; d.msg = ""; ctx.update((st) => ({ ...st, occTalent: null }), { body: true }); ctx.announce(t("IPC.Life.Tal.Cleared")); refocus("#ipc-lf-h-tal"); break;
        case "pick-rel": { const list = d.byOcc.get(nm(s.occupation))?.rel ?? []; const i = Number(el.dataset.i); if (list[i] && nm(s.npcRel.type) !== nm(list[i].name)) setPrompt(ctx, list[i], i); break; }
        case "roll-rel": rollRelationship(ctx); break;
        case "roll-npcname": await rollNpcName(ctx); break;
        default: break;
      }
    });
  },

  onState(ctx) {
    const d = ctx.data;
    if (!d.desc) return;
    d.msg = ""; d.msgFor = ""; d.landed = null; d.archFor = undefined;
  }
};
