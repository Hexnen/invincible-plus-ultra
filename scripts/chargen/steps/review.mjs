/* Step "review": problems, summary, the PLAN (diff of what apply will change) and the serious destructive confirmation, then apply + undo.
   Everything that writes goes through api.chargen.apply (apply.mjs); this step only reads the plan and passes confirmed:true after the
   player has typed the confirmation word. The plan is re-read right before applying: if it changed since it was shown, it is shown again
   and nothing is written (spec R6). */
import { t } from "../lang.mjs";
import { summaryRows } from "./summary.mjs";
import { esc, dl, delegate, icon, msgText, attrLabel } from "./util.mjs";

const TYPES = ["powerSource", "power", "boost", "limit", "talent", "drawback"];
const TYPE_ICON = { powerSource: "fa-solid fa-atom", power: "fa-solid fa-bolt", boost: "fa-solid fa-arrow-up-right-dots", limit: "fa-solid fa-lock", talent: "fa-solid fa-star", drawback: "fa-solid fa-skull" };
const SUMMARY_STEPS = ["rank", "concept", "powers", "talents", "attributes", "life", "persona", "team"];

const confirmWord = () => t("IPC.Confirm.Word");
const typedOk = (d) => String(d.confirm ?? "").trim().toLowerCase() === confirmWord().toLowerCase();
const planSig = (p) => JSON.stringify([p?.ok, p?.counts, (p?.deletes ?? []).map((x) => x.id), (p?.creates ?? []).map((x) => [x.kind, x.name, x.level]), (p?.errors ?? []).map((e) => e.code)]);

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
  const li = (i, cls, ic) => `<li class="${cls}">${icon(ic)}<span class="ipc-iss-text">${esc(msgText(i))}</span>${i.step ? `<button type="button" class="ipc-link" data-go="${esc(i.step)}">${esc(t("IPC.Review.GoTo", { step: t(`IPC.Step.${i.step}.Label`) }))}</button>` : ""}</li>`;
  return `<ul class="ipc-issues">${errs.map((i) => li(i, "ipc-iss-err", "fa-solid fa-circle-exclamation")).join("")}${planErrs.map((e) => li(e, "ipc-iss-err", "fa-solid fa-circle-exclamation")).join("")}${warns.map((i) => li(i, "ipc-iss-warn", "fa-solid fa-triangle-exclamation")).join("")}</ul>`;
}

function summaryBlock(ctx) {
  return `<div class="ipc-rv-sum">${SUMMARY_STEPS.map((id) => `<section class="ipc-rv-group"><h4>${esc(t(`IPC.Step.${id}.Label`))}</h4>${dl(summaryRows(id, ctx.state))}</section>`).join("")}</div>`;
}

function planBlock(ctx) {
  const d = ctx.data, p = d.plan;
  if (d.planError) return `<p class="ipc-error" role="alert">${icon("fa-solid fa-triangle-exclamation")} ${esc(t("IPC.Review.PlanFailed", { error: d.planError }))}</p>`;
  if (!p) return `<p class="ipc-loading">${icon("fa-solid fa-spinner fa-spin-pulse")} ${esc(t("IPC.Review.Planning"))}</p>`;
  const rows = TYPES.map((k) => ({ k, del: p.counts.delete[k] ?? 0, add: p.counts.create[k] ?? 0 })).filter((r) => r.del || r.add);
  const table = rows.length
    ? `<table class="ipc-table"><thead><tr><th scope="col">${esc(t("IPC.Review.Type"))}</th><th scope="col" class="ipc-num">${esc(t("IPC.Review.Removed"))}</th><th scope="col" class="ipc-num">${esc(t("IPC.Review.Added"))}</th></tr></thead><tbody>${rows.map((r) => `<tr><th scope="row">${icon(TYPE_ICON[r.k])} ${esc(t(`IPC.Type.${r.k}`))}</th><td class="ipc-num${r.del ? " ipc-del" : ""}">${r.del}</td><td class="ipc-num${r.add ? " ipc-add" : ""}">${r.add}</td></tr>`).join("")}</tbody></table>`
    : `<p class="ipc-muted">${esc(t("IPC.Review.NoItems"))}</p>`;
  const adds = p.creates.length
    ? `<details class="ipc-det"><summary>${esc(t("IPC.Review.AddedList", { n: p.creates.length }))}</summary><ul class="ipc-list">${p.creates.map((c) => {
      const bits = [c.level ? t(`IPC.Level.${c.level}`) : "", c.source ? t("IPC.Review.FromSource", { source: c.source }) : "", c.power ? t("IPC.Review.ForPower", { power: c.power }) : "", c.note ?? "", c.custom ? t("IPC.Review.Custom") : ""].filter(Boolean);
      return `<li>${icon(TYPE_ICON[c.type])}<b>${esc(c.name)}</b>${bits.length ? ` <span class="ipc-muted">${esc(bits.join(" - "))}</span>` : ""}</li>`;
    }).join("")}</ul></details>` : "";
  const fields = p.fields.length
    ? `<details class="ipc-det"><summary>${esc(t("IPC.Review.FieldsList", { n: p.fields.length }))}</summary><table class="ipc-table ipc-table-fields"><thead><tr><th scope="col">${esc(t("IPC.Review.Field"))}</th><th scope="col">${esc(t("IPC.Review.Now"))}</th><th scope="col">${esc(t("IPC.Review.New"))}</th></tr></thead><tbody>${p.fields.map((f) => `<tr><th scope="row">${esc(fieldLabel(f.path))}</th><td class="ipc-from">${esc(fieldValue(f.from))}</td><td class="ipc-to">${esc(fieldValue(f.to))}</td></tr>`).join("")}</tbody></table></details>` : "";
  const warns = p.warnings.filter((w) => !String(w.key).startsWith("IPC.Rule."));
  const warnList = warns.length ? `<ul class="ipc-issues">${warns.map((w) => `<li class="ipc-iss-warn">${icon("fa-solid fa-triangle-exclamation")}<span class="ipc-iss-text">${esc(msgText(w))}</span></li>`).join("")}</ul>` : "";
  const changed = d.changed ? `<p class="ipc-banner ipc-banner-warn" role="status">${icon("fa-solid fa-rotate")} ${esc(t("IPC.Review.PlanChanged"))}</p>` : "";
  return `${changed}${table}${adds}${fields}${warnList}`;
}

function dangerBlock(ctx) {
  const d = ctx.data, p = d.plan;
  if (!p?.destructive) return "";
  const groups = TYPES.map((k) => ({ k, items: p.deletes.filter((x) => x.type === k) })).filter((g) => g.items.length);
  return `<section class="ipc-danger" aria-labelledby="ipc-danger-h">
    <h3 id="ipc-danger-h">${icon("fa-solid fa-triangle-exclamation")} ${esc(t("IPC.Danger.Title", { n: p.deletes.length, actor: ctx.actor.name }))}</h3>
    <p>${esc(t("IPC.Danger.Text"))}</p>
    <div class="ipc-danger-list" tabindex="0" role="group" aria-label="${esc(t("IPC.Danger.ListLabel"))}">${groups.map((g) => `<p><b>${esc(t(`IPC.Type.${g.k}`))} (${g.items.length})</b>: ${esc(g.items.map((x) => x.name).join(", "))}</p>`).join("")}</div>
    <p class="ipc-danger-keep">${esc(p.counts.keeps ? t("IPC.Danger.Keeps", { n: p.counts.keeps }) : t("IPC.Danger.KeepsNone"))} ${esc(t("IPC.Danger.Undo"))}</p>
    <label class="ipc-field ipc-confirm"><span>${esc(t("IPC.Danger.Label", { word: confirmWord() }))}</span>
      <input class="ipc-input" type="text" name="confirm" data-fk="confirm" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(d.confirm ?? "")}" aria-describedby="ipc-apply-why"></label>
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
function applyBlock(ctx) {
  const d = ctx.data, st = applyState(ctx);
  return `<div class="ipc-apply">
    <p class="ipc-apply-why" id="ipc-apply-why" role="status">${esc(st.why)}</p>
    <button type="button" class="ipc-btn ipc-btn-primary ipc-btn-apply" data-act="apply" data-fk="apply"${st.off ? ' aria-disabled="true"' : ""}>${icon(d.busy ? "fa-solid fa-spinner fa-spin-pulse" : "fa-solid fa-wand-magic-sparkles")} ${esc(applyLabel(d.plan))}</button>
  </div>`;
}

function resultBlock(ctx) {
  const d = ctx.data, r = d.result;
  const warns = (r.warnings ?? []).filter((w) => !String(w.key).startsWith("IPC.Rule."));
  if (d.undone) {
    return `<section class="ipc-result" aria-labelledby="ipc-res-h"><h3 id="ipc-res-h" tabindex="-1">${icon("fa-solid fa-rotate-left")} ${esc(t("IPC.Result.UndoneTitle"))}</h3>
      <p>${esc(d.undone.message ?? "")}</p>
      <div class="ipc-actions"><button type="button" class="ipc-btn ipc-btn-primary" data-act="back-review">${esc(t("IPC.Result.BackToReview"))}</button>
      <button type="button" class="ipc-btn" data-act="close">${esc(t("IPC.Result.Close"))}</button></div></section>`;
  }
  if (r.ok) {
    return `<section class="ipc-result ipc-result-ok" aria-labelledby="ipc-res-h"><h3 id="ipc-res-h" tabindex="-1">${icon("fa-solid fa-circle-check")} ${esc(t("IPC.Result.OkTitle"))}</h3>
      <p>${esc(r.message ?? "")}</p>
      ${warns.length ? `<ul class="ipc-issues">${warns.map((w) => `<li class="ipc-iss-warn">${icon("fa-solid fa-triangle-exclamation")}<span class="ipc-iss-text">${esc(msgText(w))}</span></li>`).join("")}</ul>` : ""}
      ${d.undoError ? `<p class="ipc-error" role="alert">${icon("fa-solid fa-triangle-exclamation")} ${esc(d.undoError)}</p>` : ""}
      <div class="ipc-actions">
        <button type="button" class="ipc-btn ipc-btn-primary" data-act="open-sheet">${icon("fa-solid fa-id-card")} ${esc(t("IPC.Result.OpenSheet"))}</button>
        ${ctx.apply.hasUndo(ctx.actor) ? `<button type="button" class="ipc-btn" data-act="undo" data-fk="undo"${d.busy ? ' aria-disabled="true"' : ""}>${icon("fa-solid fa-rotate-left")} ${esc(t("IPC.Result.Undo"))}</button>` : ""}
        <button type="button" class="ipc-btn ipc-btn-quiet" data-act="close">${esc(t("IPC.Result.Close"))}</button>
      </div></section>`;
  }
  const errs = r.errors ?? [];
  return `<section class="ipc-result ipc-result-bad" aria-labelledby="ipc-res-h"><h3 id="ipc-res-h" tabindex="-1">${icon("fa-solid fa-circle-xmark")} ${esc(t("IPC.Result.FailTitle"))}</h3>
    <ul class="ipc-issues">${errs.map((e) => `<li class="ipc-iss-err">${icon("fa-solid fa-circle-exclamation")}<span class="ipc-iss-text">${esc(msgText(e))}</span></li>`).join("")}</ul>
    ${r.rolledBack ? `<p>${esc(t("IPC.Result.RolledBack"))}</p>` : ""}
    <div class="ipc-actions"><button type="button" class="ipc-btn ipc-btn-primary" data-act="back-review">${esc(t("IPC.Result.BackToReview"))}</button></div></section>`;
}

/* ---------- actions ---------- */
async function doApply(ctx) {
  const d = ctx.data;
  if (d.busy) return;
  if (applyState(ctx).off) { ctx.announce(applyState(ctx).why); return; }
  d.busy = true; d.changed = false;
  ctx.rerender();
  try {
    const fresh = await ctx.apply.plan(ctx.actor, ctx.state);
    if (planSig(fresh) !== planSig(d.plan)) {
      d.plan = fresh; d.changed = true; d.busy = false; d.confirm = "";
      ctx.rerender();
      ctx.announce(t("IPC.Review.PlanChanged"));
      return;
    }
    const res = await ctx.busy(ctx.apply.apply(ctx.actor, ctx.state, { confirmed: !d.plan.destructive || typedOk(d) }));
    d.result = res; d.undone = null; d.undoError = "";
    if (res.ok) ctx.app.markApplied();
  } catch (err) {
    console.error("invincible-plus-ultra | chargen apply failed", err);
    d.result = { ok: false, errors: [{ key: "x", message: err?.message ?? String(err) }], warnings: [] };
  }
  d.busy = false;
  ctx.rerender();
  ctx.app.focusBody("#ipc-res-h");
  ctx.announce(d.result.ok ? t("IPC.Result.OkTitle") : t("IPC.Result.FailTitle"));
}

async function doUndo(ctx) {
  const d = ctx.data;
  if (d.busy) return;
  d.busy = true; ctx.rerender();
  const res = await ctx.busy(ctx.apply.undo(ctx.actor));
  d.busy = false;
  if (res.ok) { d.undone = res; ctx.app.markApplied(false); } else d.undoError = res.message ?? "";
  d.plan = null; d.confirm = "";
  ctx.rerender();
  ctx.app.focusBody("#ipc-res-h");
  ctx.announce(res.message ?? "");
}

export default {
  id: "review",
  icon: "fa-solid fa-clipboard-check",

  async load(ctx) {
    const d = ctx.data;   // entering Review always starts from a fresh plan, never from the result of an earlier run
    d.confirm = ""; d.changed = false; d.result = null; d.undone = null; d.undoError = ""; d.busy = false;
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
    delegate(root, "click", "[data-go]", (ev, el) => ctx.go(el.dataset.go));
    delegate(root, "click", "[data-act]", async (ev, el) => {
      if (el.getAttribute("aria-disabled") === "true") { if (el.dataset.act === "apply") ctx.announce(applyState(ctx).why); return; }
      switch (el.dataset.act) {
        case "apply": await doApply(ctx); break;
        case "undo": await doUndo(ctx); break;
        case "open-sheet": ctx.actor.sheet.render({ force: true }); break;
        case "close": ctx.app.close({ force: true }); break;
        case "back-review":
          d.result = null; d.undone = null; d.confirm = "";
          await refreshPlan(ctx);
          ctx.rerender();
          break;
        default: break;
      }
    });
    // typing the confirmation word must not re-render (focus): toggle the button directly
    root.addEventListener("input", (ev) => {
      if (ev.target.name !== "confirm") return;
      d.confirm = ev.target.value;
      const st = applyState(ctx), btn = root.querySelector('[data-act="apply"]'), why = root.querySelector("#ipc-apply-why");
      if (btn) { if (st.off) btn.setAttribute("aria-disabled", "true"); else btn.removeAttribute("aria-disabled"); }
      if (why) why.textContent = st.why;
    });
  }
};
