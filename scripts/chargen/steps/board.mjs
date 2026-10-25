/* Step "board": the ROLL BOARD (phase 6). Where "Roll a hero" and "Surprise me" land. DECISION (documented in the handoff): a separate step module that the
   shell shows in the stepper only while the wizard is in random mode (right after Start), not a mode of Review: the board is for ROLLING (keep, reroll,
   re-seed, change the dice settings), Review stays the one place that lists problems, the plan and applies. "Looks good" jumps to Review.

   One row per rollable part of the hero: Rank, Concept, Powers, Talents & drawbacks, Attributes, Life, Persona, Team. Each row shows its rolled result
   (the same readable summary rows Review uses), a LOCK toggle (aria-pressed), a REROLL button and "Edit" (jumps to the real step). Rolling one row keeps the
   others; rerolling powers or talents re-balances the attributes (0 points left); locked rows and rows edited by hand survive "Reroll all unlocked".
   Settings (state.rollOpts, remembered per client): spice level presets, five toggles, "within an archetype", "may join a team base". Seed / hero code:
   copy, paste (roll this code), new seed. Everything goes through reroll.mjs (pure, tested in check-rules.mjs); nothing is written to the actor.
   Motion: a rerolled row "lands" (value drops in, a yellow flash, the die icon spins): transform + opacity only, one row at a time (a short stagger for
   "reroll all"), reduced motion = a plain fade. The result of every roll is announced in the shell's live region. */
import { t } from "../lang.mjs";
import { RANK_ORDER, RANKS, ATTRS, attributeBudget, slots } from "../rules.mjs";
import * as RR from "../reroll.mjs";
import { STEP_FIELDS } from "../state.mjs";
import { summaryRows } from "./summary.mjs";
import { esc, dl, delegate, icon, attrShort, rankName } from "./util.mjs";

const ROW_ICON = { rank: "fa-solid fa-ranking-star", concept: "fa-solid fa-lightbulb", powers: "fa-solid fa-bolt", talents: "fa-solid fa-star", attributes: "fa-solid fa-dumbbell", life: "fa-solid fa-briefcase", persona: "fa-solid fa-masks-theater", team: "fa-solid fa-people-group" };
const label = (row) => t(`IPC.Step.${row}.Label`);
const fieldsJson = (s, row) => JSON.stringify((STEP_FIELDS[row] ?? []).map((f) => s[f]));

/** one-line readable result of a row (used for the live announcement) */
function oneLine(s, row) {
  if (row === "rank") return rankName(s.rank);
  if (row === "attributes") return ATTRS.map((k) => `${attrShort(k)} ${s.attrs[k]}`).join(", ");
  return summaryRows(row, s).filter((r) => !r.empty).slice(0, 3).map((r) => r.value).join("; ");
}

/* ---------- row bodies ---------- */
function valueHtml(ctx, row) {
  const s = ctx.state;
  if (row === "rank") {
    const r = RANKS[s.rank];
    return `<label class="ipc-field ipc-bd-rank"><span class="ipc-sr">${esc(t("IPC.Board.Rank"))}</span>
      <select class="ipc-input" name="bd-rank" data-fk="bd-rank">${RANK_ORDER.map((k) => `<option value="${k}"${k === s.rank ? " selected" : ""}>${esc(rankName(k))}</option>`).join("")}</select></label>
      <p class="ipc-muted ipc-bd-sub">${esc(r ? t("IPC.Rank.Numbers", { points: r.points, cap: r.cap, powers: r.powers, rep: r.reputation }) : "")}</p>`;
  }
  if (row === "attributes") {
    const b = attributeBudget(s), left = b.left;
    const status = left === 0 ? `<span class="ipc-bd-pts is-ok">${icon("fa-solid fa-circle-check")} ${esc(t("IPC.Board.PointsDone"))}</span>`
      : `<span class="ipc-bd-pts is-bad">${icon("fa-solid fa-circle-exclamation")} ${esc(left > 0 ? t("IPC.Board.PointsLeft", { n: left }) : t("IPC.Board.PointsOver", { n: -left }))}</span>`;
    return `<ul class="ipc-bd-attrs" aria-label="${esc(t("IPC.Preview.Attrs"))}">${ATTRS.map((k) => `<li><span>${esc(attrShort(k))}</span><b>${s.attrs[k]}</b></li>`).join("")}</ul>
      <p class="ipc-bd-sub">${status} <span class="ipc-muted">${esc(t("IPC.Board.OfPoints", { spent: b.spent, budget: b.budget }))}</span></p>`;
  }
  const rows = summaryRows(row, s).filter((r) => !r.empty);
  let extra = "";
  if (row === "powers") extra = `<p class="ipc-muted ipc-bd-sub">${esc(t("IPC.Preview.Slots", { used: slots(s), max: RANKS[s.rank]?.powers ?? 0 }))}</p>`;
  return rows.length ? `${dl(rows, "ipc-dl ipc-bd-dl")}${extra}` : `<p class="ipc-muted">${esc(t("IPC.Board.Nothing"))}</p>`;
}

function rowHtml(ctx, row, i) {
  const s = ctx.state, d = ctx.data, rollable = row !== "rank";
  const mode = rollable ? RR.lockMode(s, row) : "free";
  const kept = mode === "locked" || mode === "edited";
  const errs = (ctx.allIssues.errors ?? []).filter((e) => e.step === row).length;
  const name = label(row);
  const landed = d.landed?.has(row);
  const tag = mode === "locked" ? t("IPC.Board.Locked") : mode === "edited" ? t("IPC.Board.Edited") : "";
  const lock = rollable ? `<button type="button" class="ipc-btn ipc-btn-icon ipc-bd-lock${kept ? " is-on" : ""}" data-act="lock" data-row="${row}" data-fk="lock-${row}" aria-pressed="${kept}"
      aria-label="${esc(t("IPC.Board.LockAria", { row: name }))}" data-tooltip="${esc(mode === "edited" ? t("IPC.Board.EditedTip") : kept ? t("IPC.Board.Unlock", { row: name }) : t("IPC.Board.Lock", { row: name }))}">${icon(kept ? "fa-solid fa-lock" : "fa-solid fa-lock-open")}</button>`
    : `<span class="ipc-bd-lock-gap" aria-hidden="true"></span>`;
  const reroll = rollable ? `<button type="button" class="ipc-btn ipc-btn-small ipc-bd-roll${mode === "locked" ? "" : " ipc-btn-primary"}" data-act="reroll" data-row="${row}" data-fk="reroll-${row}"
      aria-label="${esc(t("IPC.Board.RerollAria", { row: name }))}"${mode === "locked" ? ` aria-disabled="true" aria-describedby="ipc-bd-why-${row}"` : ""}
      data-tooltip="${esc(mode === "locked" ? t("IPC.Board.LockedWhy") : mode === "edited" ? t("IPC.Board.EditedTip") : t("IPC.Board.RerollTip", { row: name }))}"><i class="fa-solid fa-dice${landed ? " ipc-bd-spin" : ""}" aria-hidden="true"></i> ${esc(t("IPC.Board.Reroll"))}</button>
      ${mode === "locked" ? `<span class="ipc-sr" id="ipc-bd-why-${row}">${esc(t("IPC.Board.LockedWhy"))}</span>` : ""}` : "";
  return `<li class="ipc-bd-row${landed ? " ipc-bd-landed" : ""}${kept ? " is-kept" : ""}${rollable ? "" : " ipc-bd-row-fixed"}" data-row="${row}" data-mode="${mode}" style="--ipc-bd-i:${landed ? Math.min(i, 8) : 0}">
    ${lock}
    <div class="ipc-bd-main">
      <h3 class="ipc-bd-name">${icon(ROW_ICON[row])}<span>${esc(name)}</span>${tag ? `<span class="ipc-bd-tag">${esc(tag)}</span>` : ""}${errs ? `<span class="ipc-bd-issue">${icon("fa-solid fa-triangle-exclamation")} ${esc(t("IPC.Board.Problems", { n: errs }))}</span>` : ""}</h3>
      <div class="ipc-bd-val">${valueHtml(ctx, row)}</div>
    </div>
    <div class="ipc-bd-actions">${reroll}<button type="button" class="ipc-btn ipc-btn-small" data-act="edit" data-row="${row}" data-fk="edit-${row}" aria-label="${esc(t("IPC.Board.EditAria", { row: name }))}">${icon("fa-solid fa-pen")} ${esc(t("IPC.Board.Edit"))}</button></div>
  </li>`;
}

function seedBlock(ctx) {
  const d = ctx.data;
  return `<section class="ipc-bd-seed" aria-labelledby="ipc-bd-seed-h">
    <h3 id="ipc-bd-seed-h" class="ipc-bd-h">${icon("fa-solid fa-seedling")} ${esc(t("IPC.Board.Seed.Label"))}</h3>
    <div class="ipc-bd-seedrow">
      <label class="ipc-field ipc-bd-code"><span class="ipc-sr">${esc(t("IPC.Board.Seed.Label"))}</span>
        <input class="ipc-input ipc-bd-codein" name="bd-code" data-fk="bd-code" spellcheck="false" autocomplete="off" autocapitalize="off" maxlength="80" value="${esc(d.code ?? RR.heroCode(ctx.state))}"${d.codeBad ? ' aria-invalid="true" aria-describedby="ipc-bd-msg"' : ' aria-describedby="ipc-bd-hint"'}></label>
      <button type="button" class="ipc-btn ipc-btn-small" data-act="use-code" data-fk="use-code" data-tooltip="${esc(t("IPC.Board.Seed.UseTip"))}">${icon("fa-solid fa-dice")} ${esc(t("IPC.Board.Seed.Use"))}</button>
      <button type="button" class="ipc-btn ipc-btn-small" data-act="copy-code" data-fk="copy-code">${icon("fa-regular fa-copy")} ${esc(t("IPC.Board.Seed.Copy"))}</button>
      <button type="button" class="ipc-btn ipc-btn-small" data-act="new-seed" data-fk="new-seed" data-tooltip="${esc(t("IPC.Board.Seed.NewTip"))}">${icon("fa-solid fa-shuffle")} ${esc(t("IPC.Board.Seed.New"))}</button>
    </div>
    <p class="ipc-muted ipc-bd-hint" id="ipc-bd-hint">${esc(t("IPC.Board.Seed.Hint"))}</p>
    <p class="ipc-pw-msg ipc-bd-msg" id="ipc-bd-msg" role="status">${d.msg ? `${icon(d.codeBad ? "fa-solid fa-circle-exclamation" : "fa-solid fa-circle-info")} ${esc(d.msg)}` : ""}</p>
  </section>`;
}

function optsBlock(ctx) {
  const s = ctx.state, o = RR.rollOptsOf(s), d = ctx.data;
  const spiceName = o.spice === "custom" ? t("IPC.Board.Spice.custom") : t(`IPC.Board.Spice.${o.spice}`);
  const bases = d.bases ?? 0;
  const spice = [...RR.SPICES].map((k) => `<label class="ipc-opt${o.spice === k ? " is-on" : ""}"><input type="radio" name="bd-spice" value="${k}" data-fk="bd-spice-${k}"${o.spice === k ? " checked" : ""}>
      <span class="ipc-opt-text"><span class="ipc-opt-name">${esc(t(`IPC.Board.Spice.${k}`))}</span><small>${esc(t(`IPC.Board.Spice.${k}.Desc`))}</small></span>${icon("fa-solid fa-check ipc-opt-check")}</label>`).join("");
  const tog = (key, text, on, extra = "") => `<label class="ipc-check"><input type="checkbox" name="bd-${key}" data-fk="bd-${key}"${on ? " checked" : ""}${extra}><span>${esc(text)}</span></label>`;
  return `<details class="ipc-bd-opts" data-opts${d.optsOpen ? " open" : ""}>
    <summary><span class="ipc-bd-h">${icon("fa-solid fa-sliders")} ${esc(t("IPC.Board.Opts.Title"))}</span>
      <span class="ipc-bd-chip">${esc(spiceName)}, ${esc(o.within ? t("IPC.Board.Scope.arch") : t("IPC.Board.Scope.free"))}</span></summary>
    <p class="ipc-muted ipc-bd-hint">${esc(t("IPC.Board.Opts.Hint"))}</p>
    <fieldset class="ipc-opts ipc-bd-spice"><legend class="ipc-sr">${esc(t("IPC.Board.Spice.Legend"))}</legend>${spice}</fieldset>
    <div class="ipc-bd-toggles">
      ${tog("drawbacks", t("IPC.Board.Toggle.drawbacks"), o.drawbacks)}${tog("extraTalents", t("IPC.Board.Toggle.extraTalents"), o.extraTalents)}${tog("extraSource", t("IPC.Board.Toggle.extraSource"), o.extraSource)}
      ${tog("limits", t("IPC.Board.Toggle.limits"), o.limits)}${tog("heroRel", t("IPC.Board.Toggle.heroRel"), o.heroRel)}
    </div>
    <div class="ipc-bd-toggles ipc-bd-scope">
      ${tog("within", t("IPC.Board.Scope.within"), o.within)}
      ${tog("joinBase", t("IPC.Board.Toggle.joinBase"), o.joinBase, bases ? "" : " disabled")}
      ${bases ? "" : `<p class="ipc-muted ipc-bd-hint">${esc(t("IPC.Board.Toggle.joinNone"))}</p>`}
    </div>
  </details>`;
}

function render(ctx) {
  const rows = ["rank", ...RR.ROLLABLE];
  const open = RR.unlockedRows(ctx.state).length;
  return `<div class="ipc-board">
    ${seedBlock(ctx)}
    ${optsBlock(ctx)}
    <ol class="ipc-bd-rows" aria-label="${esc(t("IPC.Board.RowsLabel"))}">${rows.map((r, i) => rowHtml(ctx, r, i)).join("")}</ol>
    <div class="ipc-bd-bar">
      <button type="button" class="ipc-btn${open ? "" : " ipc-btn-quiet"}" data-act="reroll-all" data-fk="reroll-all"${open ? "" : ' aria-disabled="true" aria-describedby="ipc-bd-allwhy"'}>${icon("fa-solid fa-dice")} ${esc(open ? t("IPC.Board.All", { n: open }) : t("IPC.Board.AllNone"))}</button>
      ${open ? "" : `<span class="ipc-muted" id="ipc-bd-allwhy">${esc(t("IPC.Board.AllKept"))}</span>`}
      <button type="button" class="ipc-btn ipc-btn-primary ipc-bd-go" data-act="go-review" data-fk="go-review">${icon("fa-solid fa-clipboard-check")} ${esc(t("IPC.Board.Go"))}</button>
    </div>
  </div>`;
}

/* ---------- actions ---------- */
const changedRows = (a, b) => new Set(["rank", ...RR.ROLLABLE].filter((r) => fieldsJson(a, r) !== fieldsJson(b, r)));

function show(ctx, next, { landed, say, msg = "" } = {}) {
  const d = ctx.data;
  d.landed = landed ?? new Set();
  d.code = null; d.codeBad = false; d.msg = msg;
  ctx.commit(next, { touch: false, body: true });
  if (say) ctx.announce(say);
}

async function reroll(ctx, row) {
  const d = ctx.data, s = ctx.state;
  if (RR.lockMode(s, row) === "locked") { d.msg = t("IPC.Board.LockedWhy"); ctx.announce(t("IPC.Board.LockedWhy")); return; }
  const next = await ctx.busy(RR.rerollRow(s, row, ctx.provider(), { force: true }));
  if (next === s) { ctx.announce(t("IPC.Board.NoChange", { row: label(row) })); return; }
  show(ctx, next, { landed: changedRows(s, next), say: t("IPC.Board.Rerolled", { row: label(row), what: oneLine(next, row) }) });
}
async function rerollAll(ctx) {
  const s = ctx.state, n = RR.unlockedRows(s).length;
  if (!n) { ctx.announce(t("IPC.Board.AllKept")); return; }
  const res = await ctx.busy(RR.rerollUnlocked(s, ctx.provider()));
  show(ctx, res.state, { landed: changedRows(s, res.state), say: t("IPC.Board.RerolledAll", { n, kept: RR.ROLLABLE.length - n }) });
}
async function reseedTo(ctx, seed, base = null) {
  const s = base ?? ctx.state, n = RR.unlockedRows(s).length;
  const res = await ctx.busy(RR.reseed(s, seed, ctx.provider()));
  show(ctx, res.state, { landed: changedRows(ctx.state, res.state), say: t("IPC.Board.Seeded", { seed, n, kept: RR.ROLLABLE.length - n }) });
}
async function useCode(ctx, root) {
  const d = ctx.data, text = root.querySelector('[name="bd-code"]')?.value ?? "";
  const code = RR.parseHeroCode(text);
  if (!code) { d.code = text; d.codeBad = true; d.msg = t("IPC.Board.Seed.Bad"); ctx.rerender(); ctx.announce(d.msg); return; }
  await reseedTo(ctx, code.seed, RR.withCode(ctx.state, code));
}
async function copyCode(ctx, root) {
  const d = ctx.data, input = root.querySelector('[name="bd-code"]'), text = input?.value || RR.heroCode(ctx.state);
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { /* fall through to the old way */ }
  if (!ok && input) { try { input.select(); ok = document.execCommand("copy"); } catch { ok = false; } }
  d.msg = ok ? t("IPC.Board.Seed.Copied") : t("IPC.Board.Seed.CopyFailed");
  const el = root.querySelector("#ipc-bd-msg");
  if (el) el.innerHTML = `${icon(ok ? "fa-solid fa-circle-check" : "fa-solid fa-circle-exclamation")} ${esc(d.msg)}`;
  ctx.announce(d.msg);
}

export default {
  id: "board",
  icon: "fa-solid fa-dice",

  async load(ctx) {
    const d = ctx.data;
    d.landed = new Set(); d.msg = ""; d.code = null; d.codeBad = false;
    try { d.bases = (await ctx.provider().list("existingBases", {})).length; } catch { d.bases = 0; }
  },

  render,

  onState(ctx) { ctx.data.code = null; ctx.data.codeBad = false; ctx.data.msg = ""; ctx.data.landed = new Set(); },

  mount(ctx, root) {
    const d = ctx.data;
    // the landing animation plays once: forget it after the frame is painted
    if (d.landed?.size) { const done = () => { d.landed = new Set(); }; requestAnimationFrame(() => requestAnimationFrame(done)); }
    root.querySelector("[data-opts]")?.addEventListener("toggle", (ev) => { d.optsOpen = ev.target.open; });
    delegate(root, "click", "[data-act]", async (ev, el) => {
      if (el.getAttribute("aria-disabled") === "true") {
        if (el.dataset.act === "reroll") ctx.announce(t("IPC.Board.LockedWhy")); else if (el.dataset.act === "reroll-all") ctx.announce(t("IPC.Board.AllKept"));
        return;
      }
      const row = el.dataset.row;
      switch (el.dataset.act) {
        case "lock": {
          const next = RR.toggleRowLock(ctx.state, row), kept = RR.isKept(next, row);
          show(ctx, next, { landed: new Set(), say: t(kept ? "IPC.Board.NowLocked" : "IPC.Board.NowUnlocked", { row: label(row) }) });
          break;
        }
        case "reroll": await reroll(ctx, row); break;
        case "edit": ctx.go(row); break;
        case "reroll-all": await rerollAll(ctx); break;
        case "new-seed": await reseedTo(ctx, RR.newSeed()); break;
        case "use-code": await useCode(ctx, root); break;
        case "copy-code": await copyCode(ctx, root); break;
        case "go-review": ctx.go("review"); break;
        default: break;
      }
    });
    root.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target?.name === "bd-code") { ev.preventDefault(); useCode(ctx, root); } });
    root.addEventListener("input", (ev) => { if (ev.target?.name === "bd-code") { d.code = ev.target.value; d.codeBad = false; } });
    root.addEventListener("change", async (ev) => {
      const el = ev.target, s = ctx.state;
      if (!(el instanceof HTMLElement)) return;
      if (el.name === "bd-rank") {
        const res = await ctx.busy(RR.changeRank(s, el.value, ctx.provider())), n = RR.unlockedRows(s).length;
        show(ctx, res.state, { landed: changedRows(s, res.state), say: t("IPC.Board.RankChanged", { rank: rankName(el.value), n, kept: RR.ROLLABLE.length - n }) });
      } else if (el.name === "bd-spice") {
        ctx.commit(RR.withSpice(s, el.value), { touch: false, body: true });
        ctx.announce(t("IPC.Board.SpiceSet", { spice: t(`IPC.Board.Spice.${el.value}`) }));
      } else if (el.name?.startsWith("bd-") && el instanceof HTMLInputElement && el.type === "checkbox") {
        const key = el.name.slice(3);
        ctx.commit(RR.withToggle(s, key, el.checked), { touch: false, body: true });
      }
    });
  }
};
