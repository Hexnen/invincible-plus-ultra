/* Step "review": problems, summary, the PLAN (diff of what apply will change) and the serious destructive confirmation, then apply + undo.
   Everything that writes goes through api.chargen.apply (apply.mjs); this step only reads the plan and passes confirmed:true after the
   player has typed the confirmation word. The plan is re-read right before applying: if it changed since it was shown, it is shown again
   and nothing is written (spec R6).
   Phase 7 (this file): problem list with "Go to" links for every issue (rule issues carry their step, plan errors get one from apply.mjs), the plan as
   collapsible groups with counts (open state remembered), the type-to-confirm word compared IME-safe (NFKC, no zero-width characters, composition-aware,
   capitals do not matter), real stage progress while apply() writes (the whole wizard is locked meanwhile: wizard.setApplying), a failure view that says
   whether the rollback finished and offers "Try again", and a result view with the hero code (+ copy), "Roll another hero", "Open the sheet",
   "Undo this run" and an OPT-IN public chat card (nothing is ever posted unless the button is pressed). */
import { t } from "../lang.mjs";
import { summaryRows } from "./summary.mjs";
import { esc, dl, delegate, icon, msgText, attrLabel, rankName, levelName } from "./util.mjs";
import { heroCode, rollNewHero } from "../reroll.mjs";
import { confirmUndo } from "../dialogs.mjs";

const TYPES = ["powerSource", "power", "boost", "limit", "talent", "drawback"];
const TYPE_ICON = { powerSource: "fa-solid fa-atom", power: "fa-solid fa-bolt", boost: "fa-solid fa-arrow-up-right-dots", limit: "fa-solid fa-lock", talent: "fa-solid fa-star", drawback: "fa-solid fa-skull" };
const SUMMARY_STEPS = ["rank", "concept", "powers", "talents", "attributes", "life", "persona", "team"];
const STAGES = ["snapshot", "wipe", "powerSource", "power", "boost/limit", "talent/drawback", "actor", "health", "base"];
const STAGE_KEY = { "boost/limit": "links", "talent/drawback": "talents" };
const OPEN_ALL_AT = 10;                  // more added items than this: the groups start collapsed (the counts stay visible)

const confirmWord = () => t("IPC.Confirm.Word");
/** compare what was typed with the word: NFKC folds full-width / IME letters, zero-width characters and extra spaces are ignored, capitals do not matter
    (the barrier is a deliberate act of typing a word, not a case-exact password), nothing unlocks while an IME composition is still open */
const fold = (s) => String(s ?? "").normalize("NFKC").replace(/[​-‍⁠﻿]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
export const typedOk = (d) => !d.composing && fold(d.confirm) === fold(confirmWord());
const planSig = (p) => JSON.stringify([p?.ok, p?.counts, (p?.deletes ?? []).map((x) => x.id), (p?.overwrites ?? []).map((f) => [f.path, f.from, f.to]), (p?.creates ?? []).map((x) => [x.kind, x.name, x.level]), (p?.errors ?? []).map((e) => e.code)]);

/* ---------- plan loading ---------- */
async function refreshPlan(ctx) {
  const d = ctx.data;
  d.plan = null; d.planError = "";
  try { d.plan = await ctx.apply.plan(ctx.actor, ctx.state); } catch (err) {
    console.error("invincible-plus-ultra | chargen plan failed", err);
    d.planError = err?.message ?? String(err);
  }
}

/* ---------- field labels of the diff ---------- */
function fieldLabel(path) {
  const m = path.match(/^system\.attributes\.(\w+)\.value$/);
  if (m) return attrLabel(m[1]);
  if (path.startsWith("flags.")) return t("IPC.Field.rank");
  if (path === "name") return t("IPC.Field.name");
  return t(`IPC.Field.${path.replace(/^system\./, "")}`);
}
const fieldValue = (v) => (v === "" || v === null || v === undefined ? t("IPC.Review.Empty") : String(v));

/* ---------- view pieces ---------- */
function issuesBlock(ctx) {
  const errs = ctx.allIssues.errors, warns = ctx.allIssues.warnings;
  const planErrs = (ctx.data.plan?.errors ?? []).filter((e) => !(String(e.key).startsWith("IPC.Rule.") || e.code === "Invalid"));
  if (!errs.length && !warns.length && !planErrs.length) return `<p class="ipc-ok">${icon("fa-solid fa-circle-check")} ${esc(t("IPC.Review.NoIssues"))}</p>`;
  const li = (i, cls, ic) => {
    const text = msgText(i);
    const link = i.step ? `<button type="button" class="ipc-link" data-go="${esc(i.step)}" aria-label="${esc(t("IPC.Review.GoToAria", { step: t(`IPC.Step.${i.step}.Label`), text }))}">${esc(t("IPC.Review.GoTo", { step: t(`IPC.Step.${i.step}.Label`) }))}</button>` : "";
    return `<li class="${cls}">${icon(ic)}<span class="ipc-iss-text">${esc(text)}</span>${link}</li>`;
  };
  const nErr = errs.length + planErrs.length;
  return `<p class="ipc-rv-counts">${esc(t("IPC.Review.Counts", { e: nErr, w: warns.length }))}</p>
    <ul class="ipc-issues">${errs.map((i) => li(i, "ipc-iss-err", "fa-solid fa-circle-exclamation")).join("")}${planErrs.map((e) => li(e, "ipc-iss-err", "fa-solid fa-circle-exclamation")).join("")}${warns.map((i) => li(i, "ipc-iss-warn", "fa-solid fa-triangle-exclamation")).join("")}</ul>`;
}

function summaryBlock(ctx) {
  return `<div class="ipc-rv-sum">${SUMMARY_STEPS.map((id) => `<section class="ipc-rv-group"><h4>${esc(t(`IPC.Step.${id}.Label`))}</h4>${dl(summaryRows(id, ctx.state))}</section>`).join("")}</div>`;
}

const isOpen = (d, key, dflt) => (d.open && key in d.open ? d.open[key] : dflt);

function addedGroups(d, p) {
  if (!p.creates.length) return "";
  const groups = TYPES.map((k) => ({ k, items: p.creates.filter((c) => c.type === k) })).filter((g) => g.items.length);
  const dflt = p.creates.length <= OPEN_ALL_AT;
  const allOpen = groups.every((g) => isOpen(d, `add:${g.k}`, dflt));
  const row = (c) => {
    const bits = [c.level ? t(`IPC.Level.${c.level}`) : "", c.source ? t("IPC.Review.FromSource", { source: c.source }) : "", c.power ? t("IPC.Review.ForPower", { power: c.power }) : "", c.note ?? "", c.custom ? t("IPC.Review.Custom") : ""].filter(Boolean);
    return `<li>${icon(TYPE_ICON[c.type])}<b>${esc(c.name)}</b>${bits.length ? ` <span class="ipc-muted">${esc(bits.join(" - "))}</span>` : ""}</li>`;
  };
  return `<div class="ipc-groups">
    <div class="ipc-groups-head"><p class="ipc-groups-title">${esc(t("IPC.Review.AddedList", { n: p.creates.length }))}</p>
      ${groups.length > 1 ? `<button type="button" class="ipc-btn ipc-btn-small ipc-btn-quiet" data-act="toggle-groups" data-fk="toggle-groups">${esc(t(allOpen ? "IPC.Review.CollapseAll" : "IPC.Review.ExpandAll"))}</button>` : ""}</div>
    ${groups.map((g) => `<details class="ipc-det ipc-grp" data-grp="add:${g.k}"${isOpen(d, `add:${g.k}`, dflt) ? " open" : ""}><summary>${icon(TYPE_ICON[g.k])} ${esc(t(`IPC.Type.${g.k}`))} <span class="ipc-count">${g.items.length}</span></summary><ul class="ipc-list">${g.items.map(row).join("")}</ul></details>`).join("")}
  </div>`;
}

function planBlock(ctx) {
  const d = ctx.data, p = d.plan;
  if (d.planError) return `<p class="ipc-error" role="alert">${icon("fa-solid fa-triangle-exclamation")} ${esc(t("IPC.Review.PlanFailed", { error: d.planError }))}</p><div class="ipc-actions"><button type="button" class="ipc-btn" data-act="replan" data-fk="replan">${icon("fa-solid fa-rotate")} ${esc(t("IPC.Empty.Retry"))}</button></div>`;
  if (!p) return `<p class="ipc-loading">${icon("fa-solid fa-spinner fa-spin-pulse")} ${esc(t("IPC.Review.Planning"))}</p>`;
  const rows = TYPES.map((k) => ({ k, del: p.counts.delete[k] ?? 0, add: p.counts.create[k] ?? 0 })).filter((r) => r.del || r.add);
  const table = rows.length
    ? `<table class="ipc-table"><thead><tr><th scope="col">${esc(t("IPC.Review.Type"))}</th><th scope="col" class="ipc-num">${esc(t("IPC.Review.Removed"))}</th><th scope="col" class="ipc-num">${esc(t("IPC.Review.Added"))}</th></tr></thead><tbody>${rows.map((r) => `<tr><th scope="row">${icon(TYPE_ICON[r.k])} ${esc(t(`IPC.Type.${r.k}`))}</th><td class="ipc-num${r.del ? " ipc-del" : ""}">${r.del}</td><td class="ipc-num${r.add ? " ipc-add" : ""}">${r.add}</td></tr>`).join("")}</tbody></table>`
    : `<p class="ipc-muted">${esc(t("IPC.Review.NoItems"))}</p>`;
  const fields = p.fields.length
    ? `<details class="ipc-det" data-grp="fields"${isOpen(d, "fields", false) ? " open" : ""}><summary>${esc(t("IPC.Review.FieldsList", { n: p.fields.length }))}</summary><table class="ipc-table ipc-table-fields"><thead><tr><th scope="col">${esc(t("IPC.Review.Field"))}</th><th scope="col">${esc(t("IPC.Review.Now"))}</th><th scope="col">${esc(t("IPC.Review.New"))}</th></tr></thead><tbody>${p.fields.map((f) => `<tr><th scope="row">${esc(fieldLabel(f.path))}</th><td class="ipc-from">${esc(fieldValue(f.from))}</td><td class="ipc-to">${esc(fieldValue(f.to))}</td></tr>`).join("")}</tbody></table></details>` : "";
  const warns = p.warnings.filter((w) => !String(w.key).startsWith("IPC.Rule."));
  const warnList = warns.length ? `<ul class="ipc-issues">${warns.map((w) => `<li class="ipc-iss-warn">${icon("fa-solid fa-triangle-exclamation")}<span class="ipc-iss-text">${esc(msgText(w))}</span></li>`).join("")}</ul>` : "";
  const changed = d.changed ? `<p class="ipc-banner ipc-banner-warn" role="status">${icon("fa-solid fa-rotate")} ${esc(t("IPC.Review.PlanChanged2"))}</p>` : "";
  return `${changed}${table}${addedGroups(d, p)}${fields}${warnList}`;
}

function dangerBlock(ctx) {
  const d = ctx.data, p = d.plan;
  if (!p?.destructive) return "";
  const groups = TYPES.map((k) => ({ k, items: p.deletes.filter((x) => x.type === k) })).filter((g) => g.items.length);
  const ov = p.overwrites ?? [];
  const title = p.deletes.length && ov.length ? t("IPC.Danger.TitleBoth", { n: p.deletes.length, f: ov.length, actor: ctx.actor.name }) : p.deletes.length ? t("IPC.Danger.Title", { n: p.deletes.length, actor: ctx.actor.name }) : t("IPC.Danger.TitleFields", { n: ov.length, actor: ctx.actor.name });
  // B5 (phase 9): the panel names EVERYTHING that is replaced: the items AND every filled-in field with its old and new value
  const fieldsList = ov.length ? `<div class="ipc-danger-fields"><p class="ipc-danger-sub">${esc(t("IPC.Danger.Fields"))}</p>
      <ul class="ipc-danger-list" tabindex="0" aria-label="${esc(t("IPC.Danger.FieldsList"))}">${ov.map((f) => `<li><b>${esc(fieldLabel(f.path))}</b>: <span class="ipc-from">${esc(fieldValue(f.from))}</span> &rarr; <span class="ipc-to">${esc(fieldValue(f.to))}</span></li>`).join("")}</ul></div>` : "";
  return `<section class="ipc-danger" aria-labelledby="ipc-danger-h">
    <h3 id="ipc-danger-h">${icon("fa-solid fa-triangle-exclamation")} ${esc(title)}</h3>
    ${p.deletes.length ? `<p>${esc(t("IPC.Danger.Text"))}</p>
    <div class="ipc-danger-list" tabindex="0" role="group" aria-label="${esc(t("IPC.Danger.ListLabel"))}">${groups.map((g) => `<p><b>${esc(t(`IPC.Type.${g.k}`))} (${g.items.length})</b>: ${esc(g.items.map((x) => x.name).join(", "))}</p>`).join("")}</div>` : `<p>${esc(t("IPC.Danger.TextFields"))}</p>`}
    ${fieldsList}
    <p class="ipc-danger-keep">${esc(t("IPC.Danger.Untouched", { n: p.counts.keeps }))} ${esc(t("IPC.Danger.Undo"))}</p>
    <label class="ipc-field ipc-confirm"><span>${esc(t("IPC.Danger.Label", { word: confirmWord() }))}</span>
      <input class="ipc-input" type="text" name="confirm" data-fk="confirm" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" value="${esc(d.confirm ?? "")}" aria-describedby="ipc-confirm-note ipc-apply-why"></label>
    <p class="ipc-muted ipc-confirm-note" id="ipc-confirm-note">${esc(t("IPC.Danger.CaseNote"))}</p>
  </section>`;
}

function applyState(ctx) {
  const d = ctx.data, p = d.plan;
  const errs = ctx.allIssues.errors.length;
  if (d.busy) return { off: true, why: t("IPC.Review.Applying") };
  if (!p) return { off: true, why: t("IPC.Review.Planning") };
  if (errs) return { off: true, why: t("IPC.Review.Blocked", { n: errs }) };
  if (!p.ok) return { off: true, why: t("IPC.Review.PlanBlocked") };
  if (p.destructive && !typedOk(d)) return { off: true, why: t("IPC.Review.NeedType", { word: confirmWord() }) };
  return { off: false, why: "" };
}
function applyLabel(p) {
  if (!p) return t("IPC.Review.ApplyPlain");
  return p.counts.delete.total ? t("IPC.Review.Apply", { created: p.counts.create.total, deleted: p.counts.delete.total }) : t("IPC.Review.ApplyAdd", { created: p.counts.create.total });
}
function progressBlock(ctx) {
  const d = ctx.data;
  return `<div class="ipc-progress" role="group" aria-label="${esc(t("IPC.Review.ProgressLabel", { actor: ctx.actor.name }))}">
    <progress id="ipc-prog" max="${STAGES.length}" value="${d.stageIdx ?? 0}" aria-label="${esc(t("IPC.Review.ProgressLabel", { actor: ctx.actor.name }))}"></progress>
    <p class="ipc-muted" id="ipc-prog-t">${esc(stageText(d))}</p>
    <p class="ipc-muted">${esc(t("IPC.Review.ApplyingNote", { actor: ctx.actor.name }))}</p>
  </div>`;
}
const stageText = (d) => (d.stage ? t("IPC.Review.Progress", { i: d.stageIdx, n: STAGES.length, stage: t(`IPC.Stage.${STAGE_KEY[d.stage] ?? d.stage}`) }) : t("IPC.Review.Planning"));
/** apply.mjs reports the stage it enters: patch the progress element in place (a re-render would drop the focus and restart nothing useful) */
function setStage(ctx, stage) {
  const d = ctx.data;
  d.stage = stage; d.stageIdx = Math.max(0, STAGES.indexOf(stage)) + 1;
  const root = d.root;
  if (!root?.isConnected) return;
  const bar = root.querySelector("#ipc-prog"), txt = root.querySelector("#ipc-prog-t");
  if (bar) bar.value = d.stageIdx;
  if (txt) txt.textContent = stageText(d);
}
function applyBlock(ctx) {
  const d = ctx.data, st = applyState(ctx);
  return `<div class="ipc-apply" aria-busy="${d.busy ? "true" : "false"}">
    <p class="ipc-apply-why" id="ipc-apply-why" role="status">${esc(st.why)}</p>
    <button type="button" class="ipc-btn ipc-btn-primary ipc-btn-apply" data-act="apply" data-fk="apply"${st.off ? ' aria-disabled="true"' : ""}>${icon(d.busy ? "fa-solid fa-spinner fa-spin-pulse" : "fa-solid fa-wand-magic-sparkles")} ${esc(applyLabel(d.plan))}</button>
  </div>${d.busy ? progressBlock(ctx) : ""}`;
}

/* ---------- the result: what was applied (a snapshot taken at apply time) ---------- */
function shareData(state, actor) {
  const talents = [state.heroTalent, state.occTalent, ...(state.extraTalents ?? [])].filter(Boolean).map((x) => x.name);
  return { name: state.heroName || actor.name, rank: state.rank, powers: (state.powers ?? []).map((p) => (p.level > 0 ? `${p.name} (${levelName(p.level)})` : p.name)), talents };
}
function shareHtml(sn) {
  const list = (a) => (a.length ? a.map(esc).join(", ") : esc(t("IPC.Share.None")));
  return `<div class="ipc-chat-card"><h3 class="ipc-cc-name">${esc(sn.name)}</h3><p class="ipc-cc-rank">${esc(rankName(sn.rank))}</p>
    <p><b>${esc(t("IPC.Share.Powers"))}</b> ${list(sn.powers)}</p><p><b>${esc(t("IPC.Share.Talents"))}</b> ${list(sn.talents)}</p></div>`;
}
function codeBlock(ctx) {
  const s = ctx.state;
  if (s.mode !== "random") return "";
  const edited = Object.values(s.touched ?? {}).some(Boolean);
  return `<div class="ipc-code-row"><span class="ipc-code-label" id="ipc-code-l">${esc(t("IPC.Result.Code"))}</span>
      <code class="ipc-code" id="ipc-code" aria-labelledby="ipc-code-l">${esc(heroCode(s))}</code>
      <button type="button" class="ipc-btn ipc-btn-small" data-act="copy-code" data-fk="copy-code">${icon("fa-regular fa-copy")} ${esc(t("IPC.Result.Copy"))}</button></div>
    <p class="ipc-muted ipc-code-msg" id="ipc-code-msg" role="status">${esc(ctx.data.codeMsg || t(edited ? "IPC.Result.CodeEdited" : "IPC.Result.CodeHint"))}</p>`;
}

function resultBlock(ctx) {
  const d = ctx.data, r = d.result;
  const warns = (r?.warnings ?? []).filter((w) => !String(w.key).startsWith("IPC.Rule."));
  const warnList = warns.length ? `<ul class="ipc-issues">${warns.map((w) => `<li class="ipc-iss-warn">${icon("fa-solid fa-triangle-exclamation")}<span class="ipc-iss-text">${esc(msgText(w))}</span></li>`).join("")}</ul>` : "";
  if (d.undone) {
    return `<section class="ipc-result" aria-labelledby="ipc-res-h"><h3 id="ipc-res-h" tabindex="-1">${icon("fa-solid fa-rotate-left")} ${esc(t("IPC.Result.UndoneTitle"))}</h3>
      <p>${esc(d.undone.message ?? "")}</p>
      <div class="ipc-actions"><button type="button" class="ipc-btn ipc-btn-primary" data-act="back-review">${esc(t("IPC.Result.BackToReview"))}</button>
      <button type="button" class="ipc-btn" data-act="close">${esc(t("IPC.Result.Close"))}</button></div></section>`;
  }
  if (r.ok) {
    const busy = d.busy || d.rolling;
    const sn = d.share ?? shareData(ctx.state, ctx.actor);
    return `<section class="ipc-result ipc-result-ok" aria-labelledby="ipc-res-h"><h3 id="ipc-res-h" tabindex="-1">${icon("fa-solid fa-circle-check")} ${esc(t("IPC.Result.OkTitle"))}</h3>
      <p>${esc(r.message ?? "")}</p>
      <p class="ipc-res-line"><b>${esc(sn.name)}</b> - ${esc(rankName(sn.rank))}. ${esc(t("IPC.Result.Counts", { powers: sn.powers.length, talents: sn.talents.length }))}</p>
      ${warnList}
      ${d.undoError ? `<p class="ipc-error" role="alert">${icon("fa-solid fa-triangle-exclamation")} ${esc(d.undoError)}</p>` : ""}
      ${codeBlock(ctx)}
      <div class="ipc-actions">
        <button type="button" class="ipc-btn ipc-btn-primary" data-act="open-sheet" data-fk="open-sheet">${icon("fa-solid fa-id-card")} ${esc(t("IPC.Result.OpenSheet"))}</button>
        <button type="button" class="ipc-btn" data-act="roll-another" data-fk="roll-another" aria-describedby="ipc-roll-note"${busy ? ' aria-disabled="true"' : ""}>${icon(d.rolling ? "fa-solid fa-spinner fa-spin-pulse" : "fa-solid fa-dice")} ${esc(t(d.rolling ? "IPC.Result.RollBusy" : "IPC.Result.Roll"))}</button>
        <button type="button" class="ipc-btn" data-act="share" data-fk="share" aria-describedby="ipc-share-note"${d.shared || d.sharing ? ' aria-disabled="true"' : ""}>${icon(d.shared ? "fa-solid fa-check" : "fa-regular fa-comment")} ${esc(t(d.shared ? "IPC.Result.Shared" : "IPC.Result.Share"))}</button>
        ${ctx.apply.hasUndo(ctx.actor) ? `<button type="button" class="ipc-btn" data-act="undo" data-fk="undo"${busy ? ' aria-disabled="true"' : ""}>${icon("fa-solid fa-rotate-left")} ${esc(t("IPC.Result.Undo"))}</button>` : ""}
        <button type="button" class="ipc-btn ipc-btn-quiet" data-act="close">${esc(t("IPC.Result.Close"))}</button>
      </div>
      <p class="ipc-muted ipc-res-note" id="ipc-roll-note">${esc(t("IPC.Result.RollNote"))}</p>
      <p class="ipc-muted ipc-res-note" id="ipc-share-note">${esc(t("IPC.Result.ShareNote"))}</p>
      ${d.rollError ? `<p class="ipc-error" role="alert">${icon("fa-solid fa-triangle-exclamation")} ${esc(d.rollError)}</p>` : ""}
      ${d.shareError ? `<p class="ipc-error" role="alert">${icon("fa-solid fa-triangle-exclamation")} ${esc(d.shareError)}</p>` : ""}
    </section>`;
  }
  const errs = r.errors ?? [];
  const note = r.rolledBack === true ? (errs.some((e) => e.code === "Failed") ? "" : `<p>${icon("fa-solid fa-rotate-left")} ${esc(t("IPC.Result.RolledBack"))}</p>`)   // the "Failed" message already says everything was rolled back
    : r.rolledBack === false ? `<p class="ipc-error" role="alert">${icon("fa-solid fa-triangle-exclamation")} ${esc(t("IPC.Result.NotRolledBack", { actor: ctx.actor.name }))}</p>`
    : r.unknown ? `<p class="ipc-error" role="alert">${icon("fa-solid fa-triangle-exclamation")} ${esc(t("IPC.Result.UnknownState", { actor: ctx.actor.name }))}</p>`
    : `<p>${esc(t("IPC.Result.NothingWritten"))}</p>`;
  return `<section class="ipc-result ipc-result-bad" aria-labelledby="ipc-res-h"><h3 id="ipc-res-h" tabindex="-1">${icon("fa-solid fa-circle-xmark")} ${esc(t(r.rolledBack === false || r.unknown ? "IPC.Result.FailPartialTitle" : "IPC.Result.FailTitle"))}</h3>
    <ul class="ipc-issues">${errs.map((e) => `<li class="ipc-iss-err">${icon("fa-solid fa-circle-exclamation")}<span class="ipc-iss-text">${esc(msgText(e))}</span></li>`).join("")}</ul>
    ${note}
    <div class="ipc-actions"><button type="button" class="ipc-btn ipc-btn-primary" data-act="retry" data-fk="retry">${icon("fa-solid fa-rotate")} ${esc(t("IPC.Result.Retry"))}</button>
      <button type="button" class="ipc-btn" data-act="back-review">${esc(t("IPC.Result.BackToReview"))}</button>
      ${r.rolledBack === false && ctx.apply.hasUndo(ctx.actor) ? `<button type="button" class="ipc-btn" data-act="undo" data-fk="undo">${icon("fa-solid fa-rotate-left")} ${esc(t("IPC.Result.Undo"))}</button>` : ""}</div></section>`;
}

/* ---------- actions ---------- */
async function doApply(ctx) {
  const d = ctx.data;
  if (d.busy) return;
  if (applyState(ctx).off) { ctx.announce(applyState(ctx).why); return; }
  d.busy = true; d.changed = false; d.stage = ""; d.stageIdx = 0;
  ctx.app.setApplying(true);
  ctx.rerender();
  ctx.announce(t("IPC.Review.Applying"));
  try {
    const fresh = await ctx.apply.plan(ctx.actor, ctx.state);
    if (planSig(fresh) !== planSig(d.plan)) {
      d.plan = fresh; d.changed = true; d.busy = false; d.confirm = "";
      ctx.app.setApplying(false);
      ctx.rerender();
      ctx.announce(t("IPC.Review.PlanChanged"));
      return;
    }
    // B6 (phase 9): the word only counts for the plan the user was SHOWN; apply() re-plans and refuses (planChanged) when it would delete / overwrite more than that
    const shown = d.plan;
    const res = await ctx.busy(ctx.apply.apply(ctx.actor, ctx.state, {
      confirmed: !!shown.destructive && typedOk(d),
      expect: { deletes: (shown.deletes ?? []).map((x) => x.id), overwrites: (shown.overwrites ?? []).map((f) => f.path) },
      onStage: (st) => setStage(ctx, st)
    }));
    if (res.planChanged) {
      d.plan = res.plan; d.changed = true; d.busy = false; d.confirm = "";
      ctx.app.setApplying(false);
      ctx.rerender();
      ctx.announce(t("IPC.Review.PlanChanged2"));
      return;
    }
    d.result = res; d.undone = null; d.undoError = ""; d.shared = false; d.shareError = ""; d.rollError = ""; d.codeMsg = "";
    if (res.ok) { ctx.app.markApplied(); d.share = shareData(ctx.state, ctx.actor); }
  } catch (err) {
    console.error("invincible-plus-ultra | chargen apply failed", err);
    d.result = { ok: false, unknown: true, errors: [{ key: "x", message: err?.message ?? String(err) }], warnings: [] };
  }
  d.busy = false;
  ctx.app.setApplying(false);
  ctx.rerender();
  ctx.app.focusBody("#ipc-res-h");
  ctx.announce(d.result.ok ? t("IPC.Result.OkTitle") : t("IPC.Result.FailTitle"));
}

async function doUndo(ctx) {
  const d = ctx.data;
  if (d.busy) return;
  let res;
  try { res = await confirmUndo(ctx.actor); } catch (err) { res = { ok: false, message: err?.message ?? String(err) }; }   // phase 9: age + drift list, explicit confirm
  if (res.declined) return;
  d.busy = true; ctx.app.setApplying(true); ctx.rerender();
  d.busy = false; ctx.app.setApplying(false);
  if (res.ok) { d.undone = res; ctx.app.markApplied(false); } else d.undoError = res.message ?? "";
  d.plan = null; d.confirm = "";
  ctx.rerender();
  ctx.app.focusBody("#ipc-res-h");
  ctx.announce(res.message ?? "");
}

/** "Roll another hero": a NEW random hero with the same rank and roll settings, on the same actor. Nothing is written; the roll board opens and Review
    plans against the hero that now stands on the sheet, so replacing it asks for the type-to-confirm word again. */
async function doRollAnother(ctx) {
  const d = ctx.data;
  if (d.busy || d.rolling) return;
  d.rolling = true; d.rollError = "";
  ctx.rerender();
  try {
    let member = null;
    try { member = ctx.api?.base?.find?.(ctx.actor)?.id ?? null; } catch { member = null; }
    const s = ctx.state;
    const res = await ctx.busy(rollNewHero(ctx.provider(), { rank: s.rank, rollOpts: s.rollOpts, member }));
    d.rolling = false;
    ctx.app.markApplied(false);
    ctx.replace(res.state, { visitAll: true, go: "board" });
    ctx.announce(t("IPC.Start.Roll.Done", { name: res.state.heroName || ctx.actor.name }));
  } catch (err) {
    console.error("invincible-plus-ultra | chargen roll another failed", err);
    d.rolling = false;
    d.rollError = t("IPC.Result.RollFailed", { error: err?.message ?? String(err) });
    ctx.rerender();
  }
}

async function doShare(ctx) {
  const d = ctx.data;
  if (d.shared || d.sharing) return;
  d.sharing = true; d.shareError = "";
  ctx.rerender();
  try {
    const Chat = foundry.documents?.ChatMessage ?? globalThis.ChatMessage;
    await Chat.create({ speaker: Chat.getSpeaker({ actor: ctx.actor }), content: shareHtml(d.share ?? shareData(ctx.state, ctx.actor)), flags: { "invincible-plus-ultra": { chargenShare: true } } });
    d.shared = true;
    ctx.announce(t("IPC.Result.Shared"));
  } catch (err) {
    console.error("invincible-plus-ultra | chargen share failed", err);
    d.shareError = t("IPC.Result.ShareFailed", { error: err?.message ?? String(err) });
  }
  d.sharing = false;
  ctx.rerender();
}

async function copyCode(ctx, root) {
  const d = ctx.data, el = root.querySelector("#ipc-code"), text = el?.textContent ?? heroCode(ctx.state);
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { /* fall through to the old way */ }
  if (!ok && el) {
    try { const sel = getSelection(), range = document.createRange(); range.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(range); ok = document.execCommand("copy"); } catch { ok = false; }
  }
  d.codeMsg = t(ok ? "IPC.Result.Copied" : "IPC.Result.CopyFailed");
  const msg = root.querySelector("#ipc-code-msg");
  if (msg) msg.textContent = d.codeMsg;
}

export default {
  id: "review",
  icon: "fa-solid fa-clipboard-check",

  async load(ctx) {
    const d = ctx.data;   // entering Review always starts from a fresh plan, never from the result of an earlier run
    d.confirm = ""; d.changed = false; d.result = null; d.undone = null; d.undoError = ""; d.busy = false; d.composing = false;
    d.shared = false; d.sharing = false; d.shareError = ""; d.rolling = false; d.rollError = ""; d.codeMsg = ""; d.share = null;
    await refreshPlan(ctx);
  },

  async onState(ctx) {
    const d = ctx.data;
    d.confirm = ""; d.changed = false; d.result = null; d.undone = null;
    await refreshPlan(ctx);
    ctx.rerender();
  },

  render(ctx) {
    const d = ctx.data;
    if (d.result || d.undone) return resultBlock(ctx);
    return `<div class="ipc-review">
      <section class="ipc-rv-sec" aria-labelledby="ipc-rv-h1"><h3 id="ipc-rv-h1">${esc(t("IPC.Review.Problems"))}</h3>${issuesBlock(ctx)}</section>
      <section class="ipc-rv-sec" aria-labelledby="ipc-rv-h2"><h3 id="ipc-rv-h2">${esc(t("IPC.Review.Changes"))}</h3>${planBlock(ctx)}</section>
      ${dangerBlock(ctx)}
      ${applyBlock(ctx)}
      <section class="ipc-rv-sec" aria-labelledby="ipc-rv-h3"><h3 id="ipc-rv-h3">${esc(t("IPC.Review.Summary"))}</h3>${summaryBlock(ctx)}</section>
    </div>`;
  },

  mount(ctx, root) {
    const d = ctx.data;
    d.root = root;
    delegate(root, "click", "[data-go]", (ev, el) => ctx.go(el.dataset.go));
    delegate(root, "click", "[data-act]", async (ev, el) => {
      if (el.getAttribute("aria-disabled") === "true") { if (el.dataset.act === "apply") ctx.announce(applyState(ctx).why); return; }
      switch (el.dataset.act) {
        case "apply": await doApply(ctx); break;
        case "undo": await doUndo(ctx); break;
        case "roll-another": await doRollAnother(ctx); break;
        case "share": await doShare(ctx); break;
        case "copy-code": await copyCode(ctx, root); break;
        case "open-sheet": ctx.actor.sheet.render({ force: true }); break;
        case "close": ctx.app.close({ force: true }); break;
        case "replan":
          await refreshPlan(ctx);
          ctx.rerender();
          break;
        case "toggle-groups": {
          const groups = [...root.querySelectorAll("details[data-grp]")], open = !groups.every((g) => g.open);
          d.open ??= {};
          for (const g of groups) { g.open = open; d.open[g.dataset.grp] = open; }
          el.textContent = t(open ? "IPC.Review.CollapseAll" : "IPC.Review.ExpandAll");
          break;
        }
        case "retry":     // the failed run was rolled back (or refused): plan again, keep the typed word, put the focus on Apply
          d.result = null; d.undone = null;
          await refreshPlan(ctx);
          ctx.rerender();
          ctx.app.focusBody('[data-act="apply"]');
          break;
        case "back-review":
          d.result = null; d.undone = null; d.confirm = "";
          await refreshPlan(ctx);
          ctx.rerender();
          break;
        default: break;
      }
    });
    // remember which plan groups the user opened (the body is repainted while applying / sharing)
    root.addEventListener("toggle", (ev) => { const el = ev.target; if (el instanceof HTMLDetailsElement && el.dataset.grp) (d.open ??= {})[el.dataset.grp] = el.open; }, true);
    // typing the confirmation word must not re-render (focus): toggle the button directly. An IME composition never unlocks it.
    const refresh = () => {
      const st = applyState(ctx), btn = root.querySelector('[data-act="apply"]'), why = root.querySelector("#ipc-apply-why");
      if (btn) { if (st.off) btn.setAttribute("aria-disabled", "true"); else btn.removeAttribute("aria-disabled"); }
      if (why) why.textContent = st.why;
    };
    root.addEventListener("compositionstart", (ev) => { if (ev.target.name === "confirm") { d.composing = true; refresh(); } });
    root.addEventListener("compositionend", (ev) => { if (ev.target.name === "confirm") { d.composing = false; d.confirm = ev.target.value; refresh(); } });
    root.addEventListener("input", (ev) => {
      if (ev.target.name !== "confirm") return;
      d.confirm = ev.target.value;
      if (ev.isComposing) d.composing = true;
      refresh();
    });
    root.addEventListener("keydown", (ev) => {     // Enter in the word field only moves to the (now unlocked) Apply button; it never applies by itself
      if (ev.target.name !== "confirm" || ev.key !== "Enter" || ev.isComposing) return;
      ev.preventDefault();
      if (!applyState(ctx).off) root.querySelector('[data-act="apply"]')?.focus();
      else ctx.announce(applyState(ctx).why);
    });
  }
};
