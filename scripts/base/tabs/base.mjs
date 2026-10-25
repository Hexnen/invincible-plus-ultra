/* Team & Base card, phase B5: the REAL "Base" tab (replaces the placeholder). Interface: ./index.mjs.
   What it holds: kind and location of the base (each a text field with a dice button; custom text is always allowed), the three team texts
   (Description, Purpose, Background), the "Adversaries hold the base" banner, and the sync status of the heroes' Team / Team base fields.
   Name, rank, motto and picture live in the sheet header (sheet.mjs), not here.
   Rules of this file:
   - Everything is written through ctx.update (store.update) and the api (catalog rolls, sync); no direct flag writes.
   - Rolls: kind = table team-base.<rank> of our chargen-tables pack (api.catalog.rollTeamBase), location = the core book's City Locations (api.catalog.rollCity);
     both use table.roll(), never draw(): nothing is posted to chat. The last roll of a field can be undone (the previous text and roll record come back).
   - Text fields save on change (blur / Enter) and, for the long texts, 1 s after the last keystroke. Optimistic concurrency: the value the user started from is remembered
     per field (`known`); if the card holds something else when the save runs, nothing is overwritten and the user chooses (keep mine / use theirs).
     A save that failed keeps the typed text visible (`held`) instead of silently dropping it at the next repaint.
   - The sheet defers repaints while a text field has focus (sheet.mjs), so typing is never interrupted; module-level state here survives repaints.
   - Listeners are delegated once per panel element (the panel element persists across paints); ctx is looked up per event from CTX. */
import * as P from "../pure.mjs";
import { resolveConflicts } from "../dialogs.mjs";

const CTX = new WeakMap();                 // panel element -> latest ctx
const BOUND = new WeakSet();               // panel elements with listeners
const known = new Map();                   // "<team>:<field>" -> value of the card when the user started editing (last render / last save)
const held = new Map();                    // "<team>:<field>" -> { type: "conflict"|"failed", mine, theirs? }
const timers = new Map();                  // debounce timers for the long texts
const lastRoll = new Map();                // "<team>:<kind|where>" -> { prev, prevRoll, result } (undo)
const busy = new Set();                    // rolls in flight
const exCache = new Map();                 // rank -> { list: string[], at }
let cityOk;                                // undefined (unknown) | true | false
let ideas = { open: false, list: undefined };   // "Need ideas?" disclosure: state + book prompts (read at runtime)

const SAVE_DELAY = 1000;
const FIELDS = {
  kind: { get: (B) => B.base.kind, patch: (v) => ({ base: { kind: v } }), trim: true, max: 160 },
  where: { get: (B) => B.base.where, patch: (v) => ({ base: { where: v } }), trim: true, max: 160 },
  description: { get: (B) => B.base.description, patch: (v) => ({ base: { description: v } }), max: 6000 },
  purpose: { get: (B) => B.purpose, patch: (v) => ({ purpose: v }), max: 2000 },
  background: { get: (B) => B.background, patch: (v) => ({ background: v }), max: 2000 }
};
const keyOf = (ctx, f) => `${ctx.team.id}:${f}`;

/* ------------------------------------------------------------------ render */
function extraHtml(ctx, f) {
  const rec = held.get(keyOf(ctx, f));
  if (!rec) return "";
  const { esc, icon, t } = ctx;
  if (rec.type === "failed") return `<p class="ipb-bt-warn">${icon("fa-solid fa-triangle-exclamation")}<span>${esc(t("IPB.Bt.Failed"))}</span></p>`;
  return `<div class="ipb-bt-conflict" role="group" aria-label="${esc(t("IPB.Bt.ConflictTitle"))}">`
    + `<p class="ipb-bt-warn">${icon("fa-solid fa-triangle-exclamation")}<span>${esc(t("IPB.Bt.ConflictTitle"))}</span></p>`
    + `<p class="ipb-bt-theirs-h">${esc(t("IPB.Bt.ConflictTheirs"))}</p><p class="ipb-bt-theirs">${rec.theirs ? esc(rec.theirs) : `<span class="ipb-muted">${esc(t("IPB.Bt.Empty"))}</span>`}</p>`
    + `<p class="ipb-bt-hint">${esc(t("IPB.Bt.ConflictMine"))}</p>`
    + `<div class="ipb-bt-actions"><button type="button" class="ipb-btn ipb-btn-small ipb-btn-primary" data-bt-act="keep-mine" data-bt-field="${f}" data-fk="bt-keep-${f}">${esc(t("IPB.Bt.KeepMine"))}</button>`
    + `<button type="button" class="ipb-btn ipb-btn-small" data-bt-act="use-theirs" data-bt-field="${f}" data-fk="bt-theirs-${f}">${esc(t("IPB.Bt.UseTheirs"))}</button></div></div>`;
}

/** value shown in a field: what the user is holding (conflict / failed save) or the card's value; also remembers the start value */
function shown(ctx, f) {
  const cur = FIELDS[f].get(ctx.B);
  known.set(keyOf(ctx, f), cur);
  return held.get(keyOf(ctx, f))?.mine ?? cur;
}

function rolledLine(ctx, which) {
  const { esc, icon, t, B } = ctx;
  const rec = B.base.rolls?.[which];
  const cur = B.base[which];
  if (!rec?.resultName || rec.resultName !== cur) return "";
  const fresh = Date.now() - (rec.at || 0) < 1500;
  const text = which === "kind"
    ? t("IPB.Bt.RolledKind", { rank: t(`IPB.Rank.${rec.rank || B.rank}`), name: rec.resultName })
    : t("IPB.Bt.RolledWhere", { roll: rec.roll ?? "?", table: rec.table || "", name: rec.resultName });
  const lr = lastRoll.get(keyOf(ctx, which));
  const undo = ctx.canEdit && lr && lr.result === cur
    ? ` <button type="button" class="ipb-bt-link" data-bt-act="undo" data-bt-field="${which}" data-fk="bt-undo-${which}">${icon("fa-solid fa-rotate-left")}${esc(t("IPB.Bt.UndoRoll"))}</button>` : "";
  return `<p class="ipb-bt-rolled${fresh ? " ipb-bt-land" : ""}">${icon("fa-solid fa-dice")}<span>${esc(text)}</span>${undo}</p>`;
}

function placeField(ctx, which) {
  const { esc, icon, t, B, canEdit } = ctx;
  const id = `${ctx.app.id}-bt-${which}`;
  const label = t(which === "kind" ? "IPB.Bt.Kind" : "IPB.Bt.Where");
  const value = B.base[which];
  if (!canEdit) {
    return `<div class="ipb-bt-field"><p class="ipb-bt-label">${esc(label)}</p><p class="ipb-bt-ro">${value ? esc(value) : `<span class="ipb-muted">${esc(t("IPB.Bt.Empty"))}</span>`}</p>${rolledLine(ctx, which)}</div>`;
  }
  const rollLabel = t(which === "kind" ? "IPB.Bt.RollKind" : "IPB.Bt.RollWhere");
  let note = "";
  let disabled = false;
  let chips = "";
  if (which === "kind") {
    const ex = exCache.get(B.rank);
    if (ex && !ex.list.length) { disabled = true; note = t("IPB.Bt.NoKindTable"); }
    if (ex?.list.length) {
      chips = `<div class="ipb-bt-chips" role="group" aria-label="${esc(t("IPB.Bt.Examples"))}"><span class="ipb-bt-chips-h">${esc(t("IPB.Bt.Examples"))}</span><ul>`
        + ex.list.map((n) => {
          const on = n.toLowerCase() === value.trim().toLowerCase();
          return `<li><button type="button" class="ipb-bt-chip" data-bt-act="chip" data-name="${esc(n)}" aria-pressed="${on}" aria-label="${esc(t("IPB.Bt.UseExample", { name: n }))}">${on ? icon("fa-solid fa-check") : ""}<span>${esc(n)}</span></button></li>`;
        }).join("") + `</ul></div>`;
    }
  } else if (cityOk === false) { disabled = true; note = t("IPB.Bt.NoCityTable"); }
  return `<div class="ipb-bt-field" data-bt-block="${which}">
    <div class="ipb-bt-lrow"><label class="ipb-bt-label" for="${esc(id)}">${esc(label)}</label><span class="ipb-bt-status" data-bt-status="${which}" role="status"></span></div>
    <div class="ipb-bt-inline">
      <input id="${esc(id)}" class="ipb-input" type="text" name="ipb-bt-${which}" data-bt-field="${which}" maxlength="${FIELDS[which].max}" value="${esc(shown(ctx, which))}" placeholder="${esc(t(which === "kind" ? "IPB.Bt.KindPh" : "IPB.Bt.WherePh"))}" autocomplete="off">
      <button type="button" class="ipb-btn ipb-btn-primary ipb-btn-icon" data-bt-act="roll" data-bt-field="${which}" data-fk="bt-roll-${which}" aria-label="${esc(rollLabel)}" data-tooltip="${esc(rollLabel)}"${disabled ? ' aria-disabled="true"' : ""}>${icon("fa-solid fa-dice")}</button>
    </div>
    <div data-bt-extra="${which}">${extraHtml(ctx, which)}</div>
    <p class="ipb-bt-note" data-bt-note="${which}" role="status">${esc(note)}</p>
    ${chips}${rolledLine(ctx, which)}
  </div>`;
}

function textField(ctx, f) {
  const { esc, icon, t, B, canEdit } = ctx;
  const key = f[0].toUpperCase() + f.slice(1);
  const label = t(`IPB.Bt.${key}`);
  const id = `${ctx.app.id}-bt-${f}`;
  const value = FIELDS[f].get(B);
  const big = f === "description";
  if (!canEdit) {
    return `<div class="ipb-bt-field${big ? " ipb-bt-big" : ""}"><p class="ipb-bt-label">${esc(label)}</p><p class="ipb-bt-ro ipb-bt-ro-text">${value ? esc(value) : `<span class="ipb-muted">${esc(t("IPB.Bt.Empty"))}</span>`}</p></div>`;
  }
  const ideasBlock = big ? `<details class="ipb-bt-ideas" data-bt-ideas${ideas.open ? " open" : ""}><summary>${icon("fa-solid fa-lightbulb")}<span>${esc(t("IPB.Bt.Ideas"))}</span></summary>`
    + `<div class="ipb-bt-ideas-body" data-bt-ideas-body>${ideasBody(ctx)}</div></details>` : "";
  return `<div class="ipb-bt-field${big ? " ipb-bt-big" : ""}" data-bt-block="${f}">
    <div class="ipb-bt-lrow"><label class="ipb-bt-label" for="${esc(id)}">${esc(label)}</label><span class="ipb-bt-status" data-bt-status="${f}" role="status"></span></div>
    <p class="ipb-bt-hint" id="${esc(id)}-h">${esc(t(`IPB.Bt.${key}Hint`))}</p>
    <textarea id="${esc(id)}" class="ipb-input ipb-bt-area" name="ipb-bt-${f}" data-bt-field="${f}" aria-describedby="${esc(id)}-h" maxlength="${FIELDS[f].max}" placeholder="${esc(t(`IPB.Bt.${key}Ph`))}" spellcheck="true">${esc(shown(ctx, f))}</textarea>
    <div data-bt-extra="${f}">${extraHtml(ctx, f)}</div>
    ${ideasBlock}
  </div>`;
}

function ideasBody(ctx) {
  const { esc, t } = ctx;
  if (ideas.list === undefined) return `<p class="ipb-muted">${esc(t("IPB.Bt.IdeasLoading"))}</p>`;
  if (!ideas.list.length) return `<p class="ipb-muted">${esc(t("IPB.Bt.IdeasNone"))}</p>`;
  return `<p class="ipb-bt-hint">${esc(t("IPB.Bt.IdeasLead"))}</p><ul class="ipb-bt-prompts">${ideas.list.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>`;
}

const STATE_ICON = { same: "fa-circle-check", push: "fa-rotate", conflict: "fa-triangle-exclamation", kept: "fa-hand" };
function rowState(r) {
  const s = [r.team, r.teamBase];
  return s.includes("conflict") ? "conflict" : s.includes("push") ? "push" : s.includes("kept") ? "kept" : "same";
}

/** heroes whose Team base text reads differently from the card (candidates for "Adopt from hero text") */
function adoptCandidates(ctx) {
  const out = [];
  for (const a of ctx.members) {
    const text = String(a._source?.system?.teamBase ?? "").trim();
    if (!text) continue;
    const p = P.parseTeamBase(text, []);
    if (!p.kind && !p.where) continue;
    if (p.kind === ctx.B.base.kind && p.where === ctx.B.base.where) continue;
    out.push({ actor: a, text, kind: p.kind, where: p.where });
  }
  return out;
}

function syncSection(ctx) {
  const { esc, icon, t, B } = ctx;
  let rows = [];
  let want = { team: "", teamBase: "" };
  try { rows = ctx.api.sync.status(B.id); want = ctx.api.sync.format(B.id); } catch (err) { console.warn("invincible-plus-ultra (base) | sync status", err); }
  const line = (v) => (v ? esc(v) : `<span class="ipb-muted">${esc(t("IPB.Bt.SyncEmptyLine"))}</span>`);
  const mirror = `<dl class="ipb-bt-mirror"><div><dt>${esc(t("IPB.Sync.Field.team"))}</dt><dd>${line(want.team)}</dd></div><div><dt>${esc(t("IPB.Sync.Field.teamBase"))}</dt><dd>${line(want.teamBase)}</dd></div></dl>`;
  let list = `<p class="ipb-muted">${esc(t("IPB.Bt.SyncNone"))}</p>`;
  if (rows.length) {
    list = `<ul class="ipb-bt-heroes">${rows.map((r) => {
      const s = rowState(r);
      return `<li><span class="ipb-bt-hero-name">${esc(r.name)}</span><span class="ipb-bt-state" data-state="${s}">${icon(`fa-solid ${STATE_ICON[s]}`)}<span>${esc(t(`IPB.Bt.State.${s}`))}</span></span>`
        + (r.dirty && !r.canWrite ? `<span class="ipb-bt-hint">${esc(t("IPB.Bt.SyncNoWrite"))}</span>` : "") + `</li>`;
    }).join("")}</ul>`;
  }
  const writable = rows.some((r) => r.dirty && r.canWrite);
  const anyDirty = rows.some((r) => r.dirty);
  const off = !B.policy.syncHeroes;
  const update = writable && !off
    ? `<button type="button" class="ipb-btn ipb-btn-small ipb-btn-primary" data-bt-act="sync" data-fk="bt-sync">${icon("fa-solid fa-rotate")}${esc(t("IPB.Bt.SyncUpdate"))}</button>` : "";
  const ok = rows.length && !anyDirty ? `<p class="ipb-bt-hint">${icon("fa-solid fa-circle-check")} ${esc(t("IPB.Bt.SyncAllGood"))}</p>` : "";
  const offNote = off ? `<p class="ipb-bt-hint">${icon("fa-solid fa-ban")} ${esc(t("IPB.Sync.Disabled"))}</p>` : "";
  const adopt = adoptCandidates(ctx).length
    ? `<button type="button" class="ipb-btn ipb-btn-small" data-bt-act="adopt" data-fk="bt-adopt">${icon("fa-solid fa-file-import")}${esc(t("IPB.Bt.Adopt"))}</button>` : "";
  return `<section class="ipb-bt-sync" aria-labelledby="${esc(ctx.app.id)}-bt-sync-h">
    <h2 class="ipb-bt-h" id="${esc(ctx.app.id)}-bt-sync-h">${esc(t("IPB.Bt.SyncH"))}</h2>
    <p class="ipb-bt-hint">${esc(t("IPB.Bt.SyncLead"))}</p>
    ${mirror}${list}${offNote}${ok}
    ${update || adopt ? `<div class="ipb-bt-actions">${update}${adopt}</div>` : ""}
  </section>`;
}

function render(ctx) {
  const { esc, icon, t, B, canEdit, isStaff } = ctx;
  const occupied = B.base.occupied
    ? `<div class="ipb-bt-occupied" role="status">${icon("fa-solid fa-triangle-exclamation")}<p>${esc(t("IPB.Bt.Occupied"))}</p>`
      + (isStaff ? `<button type="button" class="ipb-btn ipb-btn-small" data-bt-act="regain" data-fk="bt-regain">${esc(t("IPB.Bt.Regain"))}</button>` : "") + `</div>` : "";
  return `<div class="ipb-bt${canEdit ? "" : " ipb-bt-readonly"}">
    ${occupied}
    <div class="ipb-bt-side">
      <section class="ipb-bt-place" aria-labelledby="${esc(ctx.app.id)}-bt-place-h">
        <h2 class="ipb-bt-h" id="${esc(ctx.app.id)}-bt-place-h">${esc(t("IPB.Bt.Place"))}</h2>
        ${placeField(ctx, "kind")}${placeField(ctx, "where")}
      </section>
      ${canEdit ? syncSection(ctx) : ""}
    </div>
    <div class="ipb-bt-texts">${textField(ctx, "description")}${textField(ctx, "purpose")}${textField(ctx, "background")}</div>
  </div>`;
}

/* ------------------------------------------------------------------ saving */
const q = (root, sel) => root.querySelector(sel);
function setStatus(root, f, kind) {
  const el = q(root, `[data-bt-status="${f}"]`);
  const ctx = CTX.get(root);
  if (!el || !ctx) return;
  clearTimeout(el._t);
  el.dataset.kind = kind || "";
  el.textContent = kind === "saving" ? ctx.t("IPB.Bt.Saving") : kind === "saved" ? ctx.t("IPB.Bt.Saved") : "";
  if (kind === "saved") el._t = setTimeout(() => { el.textContent = ""; el.dataset.kind = ""; }, 2200);
}
function paintExtra(root, f) {
  const ctx = CTX.get(root);
  const el = q(root, `[data-bt-extra="${f}"]`);
  if (ctx && el) el.innerHTML = extraHtml(ctx, f);
}
function setNote(root, which, text) {
  const el = q(root, `[data-bt-note="${which}"]`);
  if (el) el.textContent = text;
}

/** Save `raw` into field f unless the card changed under the user. */
async function commitValue(root, f, raw) {
  const ctx = CTX.get(root);
  if (!ctx || !ctx.canEdit) return;
  const spec = FIELDS[f];
  const key = keyOf(ctx, f);
  clearTimeout(timers.get(key)); timers.delete(key);
  if (held.get(key)?.type === "conflict") return;                 // only the two buttons resolve a conflict
  const val = spec.trim ? raw.trim() : raw.replace(/\s+$/, "");
  const fresh = ctx.api.get(ctx.team.id);
  if (!fresh) return;
  const cur = spec.get(fresh);
  if (val === cur) { held.delete(key); known.set(key, cur); paintExtra(root, f); setStatus(root, f, ""); return; }
  const base = known.get(key) ?? cur;
  if (cur !== base) {                                              // somebody else wrote this field since the user started
    held.set(key, { type: "conflict", mine: val, theirs: cur });
    paintExtra(root, f); setStatus(root, f, "");
    ctx.announce(ctx.t("IPB.Bt.ConflictTitle"));
    return;
  }
  setStatus(root, f, "saving");
  const res = await ctx.update(spec.patch(val));
  if (res) { held.delete(key); known.set(key, val); setStatus(root, f, "saved"); }
  else { held.set(key, { type: "failed", mine: val }); setStatus(root, f, ""); }
  paintExtra(root, f);
}

/* ------------------------------------------------------------------ actions */
async function ensureExamples(ctx) {
  const rank = ctx.B.rank;
  const hit = exCache.get(rank);
  if (hit && (hit.list.length || Date.now() - hit.at < 15000)) return;
  const list = await ctx.api.catalog.teamBaseExamples(rank);
  const had = hit ? hit.list.length : -1;
  exCache.set(rank, { list, at: Date.now() });
  if (had !== list.length) ctx.rerender();
}
async function ensureCity(ctx) {
  if (cityOk !== undefined) return;
  let ok = false;
  try { ok = !!(await ctx.api.catalog.cityTable()); } catch { ok = false; }
  cityOk = ok;
  if (!ok) ctx.rerender();
}
async function ensureIdeas(root) {
  const ctx = CTX.get(root);
  if (!ctx || ideas.list !== undefined) return;
  try { ideas.list = await ctx.api.catalog.describingPrompts(); } catch { ideas.list = []; }
  const body = q(root, "[data-bt-ideas-body]");
  const c = CTX.get(root);
  if (body && c) body.innerHTML = ideasBody(c);
}

async function doRoll(root, which) {
  const ctx = CTX.get(root);
  if (!ctx || !ctx.canEdit) return;
  const key = keyOf(ctx, which);
  if (busy.has(key)) return;
  busy.add(key);
  setNote(root, which, "");
  try {
    const B = ctx.api.get(ctx.team.id);
    if (!B) return;
    let rec, name;
    if (which === "kind") {
      const r = await ctx.run(ctx.api.catalog.rollTeamBase(B.rank));
      name = String(r?.name ?? "").trim();
      if (!name) { setNote(root, which, ctx.t(r === null ? "IPB.Bt.NoKindTable" : "IPB.Bt.NoResult")); return; }
      rec = { table: `team-base.${B.rank}`, rank: B.rank, resultName: name, at: Date.now() };
    } else {
      const r = await ctx.run(ctx.api.catalog.rollCity());
      name = String(r?.name ?? "").trim();
      if (!name) { setNote(root, which, ctx.t(r === null ? "IPB.Bt.NoCityTable" : "IPB.Bt.NoResult")); return; }
      rec = { table: r.tableName || "City Locations", roll: r.roll, resultName: name, at: Date.now() };
    }
    lastRoll.set(key, { prev: B.base[which], prevRoll: B.base.rolls?.[which] ?? null, result: name });
    held.delete(key);
    const res = await ctx.update({ base: { [which]: name, rolls: { [which]: rec } } });
    if (res) { known.set(key, name); ctx.announce(ctx.t("IPB.Bt.RollDone", { name })); }
    else lastRoll.delete(key);
  } finally { busy.delete(key); }
}

async function doUndo(root, which) {
  const ctx = CTX.get(root);
  if (!ctx || !ctx.canEdit) return;
  const key = keyOf(ctx, which);
  const lr = lastRoll.get(key);
  const B = ctx.api.get(ctx.team.id);
  if (!lr || !B || B.base[which] !== lr.result) { lastRoll.delete(key); ctx.rerender(); return; }
  const res = await ctx.update({ base: { [which]: lr.prev, rolls: { [which]: lr.prevRoll } } });
  if (res) { lastRoll.delete(key); held.delete(key); known.set(key, lr.prev); ctx.announce(ctx.t("IPB.Bt.UndoDone")); }
}

async function resolveHeld(root, f, keep) {
  const ctx = CTX.get(root);
  if (!ctx) return;
  const key = keyOf(ctx, f);
  const rec = held.get(key);
  if (!rec) return;
  const el = q(root, `[data-bt-field="${f}"]`);
  if (keep) {
    held.delete(key);
    const res = await ctx.update(FIELDS[f].patch(rec.mine));
    if (res) { known.set(key, rec.mine); setStatus(root, f, "saved"); } else held.set(key, { type: "failed", mine: rec.mine });
  } else {
    held.delete(key);
    known.set(key, rec.theirs);
    if (el) el.value = rec.theirs;
  }
  paintExtra(root, f);
  el?.focus();
}

async function doSync(root) {
  const ctx = CTX.get(root);
  if (!ctx) return;
  const res = await ctx.run(ctx.api.sync.push(ctx.team.id, { resolve: resolveConflicts }));
  if (!res) return;
  const msg = res.disabled ? ctx.t("IPB.Sync.Disabled") : res.pushed.length ? ctx.tn("IPB.Sync.Done", res.pushed.length) : ctx.t("IPB.Sync.Nothing");
  ui.notifications?.info(msg, { console: false });
  ctx.announce(msg);
  ctx.rerender();
}

async function doAdopt(root) {
  const ctx = CTX.get(root);
  if (!ctx || !ctx.canEdit) return;
  const cands = adoptCandidates(ctx);
  if (!cands.length) return;
  const { esc, t } = ctx;
  const { DialogV2 } = foundry.applications.api;
  const options = cands.map((c, i) => `<option value="${i}">${esc(c.actor.name)}</option>`).join("");
  const info = (c) => `<p class="ipb-muted">${esc(t("IPB.Bt.AdoptReads"))}</p><p><q>${esc(c.text)}</q></p><p>${esc(t("IPB.Bt.AdoptResult", { kind: c.kind || "-", where: c.where || "-" }))}</p>`;
  const picked = await DialogV2.wait({
    window: { title: t("IPB.Bt.AdoptTitle"), icon: "fa-solid fa-file-import" },
    classes: ["ipb-dialog"], position: { width: 480 },
    content: `<label class="ipb-dlg-field"><span>${esc(t("IPB.Bt.AdoptHero"))}</span><select name="hero"${cands.length === 1 ? " disabled" : ""}>${options}</select></label><div data-adopt-info>${info(cands[0])}</div>`,
    render: (_ev, dialog) => {
      const el = dialog.element ?? dialog;
      const sel = el.querySelector("select[name=hero]");
      sel?.addEventListener("change", () => { const box = el.querySelector("[data-adopt-info]"); if (box) box.innerHTML = info(cands[Number(sel.value)] ?? cands[0]); });
    },
    buttons: [
      { action: "yes", label: t("IPB.Bt.AdoptYes"), default: true, callback: (_ev, button) => Number(button.form?.elements?.hero?.value ?? 0) },
      { action: "no", label: t("IPB.Bt.AdoptNo"), callback: () => null }
    ],
    rejectClose: false, modal: false
  });
  if (typeof picked !== "number") return;
  const c = cands[picked];
  if (!c) return;
  const res = await ctx.update({ base: { kind: c.kind, where: c.where, rolls: { kind: null, where: null } } });
  if (res) {
    for (const f of ["kind", "where"]) { held.delete(keyOf(ctx, f)); lastRoll.delete(keyOf(ctx, f)); }
    ctx.announce(t("IPB.Bt.AdoptDone", { name: c.actor.name }));
  }
}

/* ------------------------------------------------------------------ delegated events */
function bind(root) {
  const schedule = (el) => {
    const ctx = CTX.get(root);
    if (!el || !ctx) return;
    const f = el.dataset.btField;
    const key = keyOf(ctx, f);
    if (held.get(key)?.type === "conflict") return;
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => { commitValue(root, f, el.value); }, SAVE_DELAY));
  };
  // B13 (IME): nothing is saved, blurred or reverted while a composition is open; the autosave starts when it ends
  root.addEventListener("input", (ev) => { if (!ev.isComposing) schedule(ev.target instanceof Element ? ev.target.closest("textarea[data-bt-field]") : null); });
  root.addEventListener("compositionend", (ev) => schedule(ev.target instanceof Element ? ev.target.closest("textarea[data-bt-field]") : null));
  root.addEventListener("change", (ev) => {
    const el = ev.target instanceof Element ? ev.target.closest("[data-bt-field]") : null;
    if (el && el.matches("input, textarea")) commitValue(root, el.dataset.btField, el.value);
  });
  root.addEventListener("keydown", (ev) => {
    const el = ev.target instanceof Element ? ev.target.closest("[data-bt-field]") : null;
    if (!el || !el.matches("input, textarea")) return;
    if (ev.isComposing || ev.keyCode === 229) return;             // B13: Enter / Escape belong to the IME while it composes
    const ctx = CTX.get(root);
    if (ev.key === "Enter" && el.tagName === "INPUT") { ev.preventDefault(); el.blur(); }
    else if (ev.key === "Escape" && ctx) {
      ev.stopPropagation();                                        // the core closes the window on Escape otherwise
      const key = keyOf(ctx, el.dataset.btField);
      clearTimeout(timers.get(key)); timers.delete(key);
      const rec = held.get(key);
      el.value = rec?.mine ?? known.get(key) ?? el.value;
      el._btEsc = true;
    }
  });
  root.addEventListener("keyup", (ev) => {
    const el = ev.target instanceof Element ? ev.target.closest("[data-bt-field]") : null;
    if (ev.key === "Escape" && el?._btEsc) { ev.stopPropagation(); el._btEsc = false; el.blur(); }
  });
  root.addEventListener("click", (ev) => {
    const el = ev.target instanceof Element ? ev.target.closest("[data-bt-act]") : null;
    if (!el || !root.contains(el) || el.getAttribute("aria-disabled") === "true") return;       // a disabled dice button: its reason is printed under the field
    const act = el.dataset.btAct;
    const f = el.dataset.btField;
    if (act === "roll") doRoll(root, f);
    else if (act === "undo") doUndo(root, f);
    else if (act === "chip") {
      const ctx = CTX.get(root);
      if (!ctx?.canEdit) return;
      held.delete(keyOf(ctx, "kind"));
      ctx.update({ base: { kind: el.dataset.name } }).then((r) => { if (r) { known.set(keyOf(ctx, "kind"), el.dataset.name); ctx.announce(ctx.t("IPB.Bt.RollDone", { name: el.dataset.name }).replace(/^[^:]*:\s*/, "")); } });
    }
    else if (act === "keep-mine") resolveHeld(root, f, true);
    else if (act === "use-theirs") resolveHeld(root, f, false);
    else if (act === "sync") doSync(root);
    else if (act === "adopt") doAdopt(root);
    else if (act === "regain") CTX.get(root)?.update({ base: { occupied: false } }).then((r) => { if (r) CTX.get(root)?.announce(CTX.get(root).t("IPB.Bt.Regained")); });
  });
  root.addEventListener("toggle", (ev) => {
    const el = ev.target;
    if (!(el instanceof Element) || !el.matches("[data-bt-ideas]")) return;
    ideas.open = el.open;
    if (el.open) ensureIdeas(root);
  }, true);
}

export const base = {
  id: "base",
  icon: "fa-solid fa-warehouse",
  badge: () => "",
  render,
  mount(ctx, root) {
    CTX.set(root, ctx);
    if (!BOUND.has(root)) { BOUND.add(root); bind(root); }
    if (!ctx.canEdit) return;
    ensureExamples(ctx);
    ensureCity(ctx);
    if (ideas.open) ensureIdeas(root);
  }
};
export default base;
