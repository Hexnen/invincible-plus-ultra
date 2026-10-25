/* Team & Base card, phase B7: the REAL "Events" tab (replaces the placeholder). Interface: ./index.mjs.
   What it holds: the roll panel (weekly or any-time mode, label, Roll, a GM-only "Post to chat" checkbox and a GM-only forced-result test control), the newest
   event with the band name, the book's result text (read at runtime, the stored 300-character snapshot is only the fallback), the PROPOSED EFFECT as an explicit diff
   ("Break: Laboratory", "Lost: all upgrades (6)") with Apply / Dismiss (GM only, once, one document update) and a one-step Undo, the earlier history (collapsible,
   paged, newest first, state chip, who rolled), notes, and the occupied banner with the same Regain flow as the Base tab. Rules of this file:
   - Everything is written through the api (api.events: roll / reroll / apply / dismiss / repick / undo / setNote / postChat) or ctx.update (Regain); no direct flag writes.
     The diff the GM sees comes from ../ev-pure.mjs plan(), the same function ops.events.apply() writes from.
   - Book text (the result text) is read at runtime through api.catalog.eventText and never stored in the module.
   - Rolling uses the table's roll() (api.events.roll): nothing is drawn and nothing is posted to chat unless the GM ticks "Post to chat".
   - Re-roll prevention: while an event has a proposal that was neither applied nor dismissed, Roll is disabled and says why; the GM can "Roll again instead".
   - Module-level state (mode, typed label, chat checkbox, open details, paging) survives the sheet's repaints; listeners are delegated once per panel element. */
import * as P from "../pure.mjs";
import * as EV from "../ev-pure.mjs";

const CTX = new WeakMap();                 // panel element -> latest ctx
const BOUND = new WeakSet();               // panel elements with listeners
const modes = new Map();                   // team id -> "week" | "any"
const labels = new Map();                  // "<team>:<mode>" -> typed label
const chatOn = new Map();                  // team id -> post to chat (default true)
const shown = new Map();                   // team id -> history rows shown
const opened = new Map();                  // details key -> boolean (user's choice)
const fresh = new Set();                   // event ids that just arrived (they land with a short motion)
const texts = new Map();                   // resultId -> live book text | null
const book = { ok: undefined, at: 0, loading: false };
const busy = new Set();

const ST_ICON = { none: "fa-circle-minus", pending: "fa-hourglass-half", applied: "fa-circle-check", dismissed: "fa-circle-xmark", rerolled: "fa-rotate" };
const KIND_ICON = { disable: "fa-ban", break: "fa-burst", occupy: "fa-lock" };
const q = (root, sel) => root.querySelector(sel);
const startOp = (key) => { if (busy.has(key)) return false; busy.add(key); return true; };
const modeOf = (ctx) => modes.get(ctx.team.id) ?? "week";
const logOf = (B) => P.sortedList(B.events).sort((a, b) => b.at - a.at || b.sort - a.sort);
const hasKey = (ctx, key) => ctx.t(key) !== key;

/* ------------------------------------------------------------------ pieces of text */
function bandName(ctx, ev) {
  const low = EV.bandLow(ev.band);
  const key = `IPB.Ev.Band.${low}`;
  return low !== null && hasKey(ctx, key) ? ctx.t(key) : "";
}
function when(ev) {
  if (!ev.at) return "";
  try { return new Date(ev.at).toLocaleString(game.i18n?.lang || undefined, { dateStyle: "medium", timeStyle: "short" }); } catch { return ""; }
}
function metaLine(ctx, ev) {
  const bits = [];
  if (ev.label) bits.push(ev.label);
  else if (ev.mode === "week" && ev.week) bits.push(ctx.t("IPB.Ev.LabelPh.week", { n: ev.week }));
  else if (ev.mode) bits.push(ctx.t(`IPB.Ev.Mode.${ev.mode}`));
  const d = when(ev); if (d) bits.push(d);
  const who = game.users?.get(ev.by)?.name; if (who) bits.push(ctx.t("IPB.Ev.By", { who }));
  return bits.join(" - ");
}
function propSentence(ctx, ev) {
  const e = ev.effect;
  if (!e) return ctx.t("IPB.Ev.Prop.text");
  const key = `IPB.Ev.Prop.${EV.bandLow(ev.band)}`;
  if (!hasKey(ctx, key)) return ctx.t("IPB.Ev.Prop.text");
  return ctx.t(key, { n: e.kind === "raid" ? e.raid : e.rolled });
}

/** diff lines of an event: pending = what Apply would do now; applied = what it did (names from the record). -> { lines:[{icon,kind,text}], notes:[text], plan } */
function diffOf(ctx, ev, st) {
  const { t, B } = ctx;
  const e = ev.effect; const lines = []; const notes = [];
  if (!e || !EV.MECHANICAL.includes(e.kind)) return { lines, notes, plan: null };
  const label = (uid) => { const u = B.upgrades[uid]; return u ? `${u.name || u.key}${u.power ? ` (${u.power})` : ""}` : ""; };
  let plan = null;
  if (st === "applied") {
    const uids = Object.keys(e.prev?.after ?? {});
    const names = uids.map(label).filter(Boolean).join(", ");
    if (e.kind !== "occupy" && names) lines.push({ icon: KIND_ICON[e.kind], kind: e.kind, text: t(`IPB.Ev.Diff.${e.kind}`, { names }) });
    if (e.kind === "occupy") {
      lines.push({ icon: "fa-lock", kind: "occupy", text: t("IPB.Ev.Diff.occupy") });
    }
    return { lines, notes, plan: null };
  }
  plan = EV.plan(e, B);
  if (e.kind === "occupy") {
    lines.push(plan.lost ? { icon: "fa-lock", kind: "lost", text: t("IPB.Ev.Diff.lost", { n: plan.lost }) } : { icon: "fa-lock", kind: "lost", text: t("IPB.Ev.Diff.lostNone") });
    if (plan.alreadyOccupied) notes.push(t("IPB.Ev.Diff.already"));
    else lines.push({ icon: "fa-flag", kind: "occupy", text: t("IPB.Ev.Diff.occupy") });
  } else if (plan.changes.length) {
    lines.push({ icon: KIND_ICON[e.kind], kind: e.kind, text: t(`IPB.Ev.Diff.${e.kind}`, { names: plan.changes.map((c) => c.name).join(", ") }) });
  }
  for (const s of plan.skipped) notes.push(t(`IPB.Ev.Diff.skip.${s.why}`, { name: s.name }));
  if (!EV.changesAnything(plan) && !(e.kind === "occupy")) notes.push(t("IPB.Ev.Diff.nothing"));
  return { lines, notes, plan };
}
const diffText = (d) => d.lines.map((l) => l.text).join("; ");

/* ------------------------------------------------------------------ render */
function chip(ctx, st) {
  return `<span class="ipb-ev-chip" data-state="${st}">${ctx.icon(`fa-solid ${ST_ICON[st]}`)}<span>${ctx.esc(ctx.t(`IPB.Ev.State.${st}`))}</span></span>`;
}

function eventBody(ctx, ev, list) {
  const { esc, icon, t } = ctx;
  const st = EV.evState(ev);
  const live = texts.get(ev.resultId) || ev.text;
  const parts = [];
  if (live) parts.push(`<p class="ipb-ev-text">${esc(live)}</p>`);
  if (ev.rerolled) parts.push(`<p class="ipb-bt-hint">${icon("fa-solid fa-rotate")} ${esc(t("IPB.Ev.Rerolled"))}</p>`);
  const e = ev.effect;
  if (e && st !== "none" && st !== "rerolled") {
    const d = diffOf(ctx, ev, st);
    const hint = e.kind === "disable" && hasKey(ctx, "IPB.Ev.Hint.46") ? `<p class="ipb-bt-hint">${icon("fa-solid fa-circle-info")} ${esc(t("IPB.Ev.Hint.46"))}</p>` : "";
    const diffHtml = d.lines.length || d.notes.length
      ? `<div class="ipb-ev-diff"><p class="ipb-ev-diff-h">${esc(t(st === "applied" ? "IPB.Ev.DiffDone" : "IPB.Ev.DiffH"))}</p>`
        + (d.lines.length ? `<ul>${d.lines.map((l) => `<li data-kind="${l.kind}">${icon(`fa-solid ${l.icon}`)}<span>${esc(l.text)}</span></li>`).join("")}</ul>` : "")
        + d.notes.map((n) => `<p class="ipb-bt-hint">${icon("fa-solid fa-circle-info")} ${esc(n)}</p>`).join("") + `</div>` : "";
    parts.push(`<div class="ipb-ev-prop" data-state="${st}"><p class="ipb-ev-prop-h">${esc(t("IPB.Ev.PropH"))}</p><p class="ipb-ev-prop-text">${esc(propSentence(ctx, ev))}</p>${hint}${st === "dismissed" ? "" : diffHtml}</div>`);
    parts.push(actions(ctx, ev, st, d, list));
  } else if (ctx.isStaff && ctx.B.policy.chat !== "off") {
    parts.push(actions(ctx, ev, st, null, list));
  }
  parts.push(noteHtml(ctx, ev));
  return parts.join("");
}

function actions(ctx, ev, st, d, list) {
  const { esc, icon, t } = ctx;
  const out = [];
  const roll = ev.roll;
  if (ctx.isStaff && st === "pending") {
    const mech = d?.plan && EV.changesAnything(d.plan);
    const key = mech ? "IPB.Ev.Apply" : "IPB.Ev.Handled";
    const aria = mech ? "IPB.Ev.ApplyAria" : "IPB.Ev.HandledAria";
    out.push(`<button type="button" class="ipb-btn ipb-btn-small ipb-btn-primary" data-ev-act="apply" data-eid="${esc(ev.id)}" data-fk="ev-apply-${esc(ev.id)}" aria-label="${esc(t(aria, { roll }))}">${icon(mech ? "fa-solid fa-check" : "fa-solid fa-flag-checkered")}${esc(t(key))}</button>`);
    out.push(`<button type="button" class="ipb-btn ipb-btn-small" data-ev-act="dismiss" data-eid="${esc(ev.id)}" data-fk="ev-dismiss-${esc(ev.id)}" aria-label="${esc(t("IPB.Ev.DismissAria", { roll }))}">${icon("fa-solid fa-xmark")}${esc(t("IPB.Ev.Dismiss"))}</button>`);
    if (ev.effect.kind === "disable" || ev.effect.kind === "break") {
      out.push(`<button type="button" class="ipb-btn ipb-btn-small" data-ev-act="repick" data-eid="${esc(ev.id)}" data-fk="ev-repick-${esc(ev.id)}" aria-label="${esc(t("IPB.Ev.RepickAria", { roll }))}">${icon("fa-solid fa-shuffle")}${esc(t("IPB.Ev.Repick"))}</button>`);
    }
  } else if (st === "pending") {
    out.push(`<p class="ipb-bt-hint">${icon("fa-solid fa-hourglass-half")} ${esc(t("IPB.Ev.WaitGM"))}</p>`);
  }
  if (ctx.isStaff && st === "applied" && EV.undoable(ev, list, ctx.B)) {
    out.push(`<button type="button" class="ipb-btn ipb-btn-small" data-ev-act="undo" data-eid="${esc(ev.id)}" data-fk="ev-undo-${esc(ev.id)}" aria-label="${esc(t("IPB.Ev.UndoAria", { roll }))}">${icon("fa-solid fa-rotate-left")}${esc(t("IPB.Ev.Undo"))}</button>`);
  }
  if (ctx.isStaff && ctx.B.policy.chat !== "off") {
    out.push(`<button type="button" class="ipb-bt-link" data-ev-act="chat" data-eid="${esc(ev.id)}" data-fk="ev-chat-${esc(ev.id)}" aria-label="${esc(t("IPB.Ev.PostChatAria", { roll }))}">${icon("fa-solid fa-comment")}${esc(t("IPB.Ev.PostChat"))}</button>`);
  }
  return out.length ? `<div class="ipb-ev-acts">${out.join("")}</div>` : "";
}

function noteHtml(ctx, ev) {
  const { esc, icon, t } = ctx;
  if (!ctx.canEdit) return ev.note ? `<p class="ipb-up-note-ro">${icon("fa-solid fa-pen")} ${esc(ev.note)}</p>` : "";
  return `<details class="ipb-up-notebox" data-ev-det="note:${esc(ev.id)}"${ev.note || opened.get(`note:${ev.id}`) ? " open" : ""}><summary>${icon("fa-solid fa-pen")}<span>${esc(t("IPB.Ev.Note"))}</span></summary>`
    + `<input class="ipb-input" type="text" name="ipb-ev-note-${esc(ev.id)}" data-ev-note="${esc(ev.id)}" maxlength="300" value="${esc(ev.note)}" aria-label="${esc(t("IPB.Ev.NoteLabel", { roll: ev.roll }))}" placeholder="${esc(t("IPB.Ev.NotePh"))}" autocomplete="off"></details>`;
}

function headHtml(ctx, ev, tag = "p") {
  const { esc, t } = ctx;
  const st = EV.evState(ev);
  const name = bandName(ctx, ev);
  return `<div class="ipb-ev-head">
    <span class="ipb-ev-no" aria-hidden="true">${esc(String(ev.roll))}</span>
    <div class="ipb-ev-headtext"><${tag} class="ipb-ev-title" tabindex="-1" data-ev-focus="${esc(ev.id)}"><span class="ipb-sr">${esc(t("IPB.Ev.Result", { roll: ev.roll }))}: </span>${esc(name || t("IPB.Ev.Result", { roll: ev.roll }))}</${tag}>
      <p class="ipb-ev-meta">${esc(metaLine(ctx, ev))}</p></div>
    ${chip(ctx, st)}
  </div>`;
}

function latestBlock(ctx, ev, list) {
  return `<section class="ipb-ev-latest" aria-labelledby="${ctx.esc(ctx.app.id)}-ev-latest-h">
    <h2 class="ipb-bt-h" id="${ctx.esc(ctx.app.id)}-ev-latest-h">${ctx.esc(ctx.t("IPB.Ev.Latest"))}</h2>
    <article class="ipb-ev-card${fresh.has(ev.id) ? " ipb-ev-land" : ""}" data-state="${EV.evState(ev)}" data-eid="${ctx.esc(ev.id)}">${headHtml(ctx, ev)}${eventBody(ctx, ev, list)}</article>
  </section>`;
}

function historyBlock(ctx, older, list) {
  if (!older.length) return "";
  const { esc, tn, t } = ctx;
  const n = shown.get(ctx.team.id) ?? EV.PAGE_SIZE;
  const page = EV.pageSlice(older, n);
  const rows = page.rows.map((ev) => {
    const st = EV.evState(ev);
    const key = `row:${ev.id}`;
    const open = opened.has(key) ? opened.get(key) : st === "pending";
    return `<li><details class="ipb-ev-row${fresh.has(ev.id) ? " ipb-ev-land" : ""}" data-ev-det="${esc(key)}" data-state="${st}"${open ? " open" : ""}>
      <summary><span class="ipb-ev-no ipb-ev-no-s">${esc(String(ev.roll))}</span><span class="ipb-ev-rowname">${esc(bandName(ctx, ev) || t("IPB.Ev.Result", { roll: ev.roll }))}</span>${chip(ctx, st)}<span class="ipb-ev-meta">${esc(metaLine(ctx, ev))}</span></summary>
      <div class="ipb-ev-rowbody">${eventBody(ctx, ev, list)}</div></details></li>`;
  }).join("");
  const more = page.more ? `<button type="button" class="ipb-btn ipb-btn-small" data-ev-act="more" data-fk="ev-more">${esc(tn("IPB.Ev.More", Math.min(page.more, EV.PAGE_SIZE)))}</button>` : "";
  const open = opened.has("hist") ? opened.get("hist") : true;
  return `<section class="ipb-ev-hist"><details data-ev-det="hist"${open ? " open" : ""}><summary class="ipb-ev-histsum"><span class="ipb-bt-h">${esc(t("IPB.Ev.HistH", { n: older.length }))}</span></summary>
    <ol class="ipb-ev-list">${rows}</ol>${more}${list.length >= P.LIMITS.events ? `<p class="ipb-bt-hint">${ctx.icon("fa-solid fa-circle-info")} ${esc(t("IPB.Ev.Cap", { n: P.LIMITS.events }))}</p>` : ""}</details></section>`;
}

function rollPanel(ctx, list) {
  const { esc, icon, t } = ctx;
  const id = ctx.team.id;
  const mode = modeOf(ctx);
  const pend = EV.pendingList(list)[0] ?? null;
  const noBook = book.ok === false;
  const week = EV.nextWeek(list);
  const typed = labels.get(`${id}:${mode}`) ?? "";
  const ph = mode === "week" ? t("IPB.Ev.LabelPh.week", { n: week }) : t("IPB.Ev.LabelPh.any");
  const blocked = noBook || !!pend;
  const why = noBook ? t("IPB.Ev.NoBook") : pend ? t("IPB.Ev.PendingBlock", { roll: pend.roll }) : "";
  const seg = ["week", "any"].map((m) => `<label class="ipb-ev-seg"><input type="radio" name="ipb-ev-mode-${esc(id)}" value="${m}" data-ev-mode${mode === m ? " checked" : ""}><span>${esc(t(m === "week" ? "IPB.Ev.ModeWeek" : "IPB.Ev.ModeAny"))}</span></label>`).join("");
  const chatOff = ctx.B.policy.chat === "off";
  const chatBox = ctx.isStaff ? `<label class="ipb-ev-check"><input type="checkbox" data-ev-chat${chatOn.get(id) !== false && !chatOff ? " checked" : ""}${chatOff ? " disabled" : ""}><span>${esc(t("IPB.Ev.Chat"))}</span></label>${chatOff ? `<p class="ipb-bt-hint">${esc(t("IPB.Ev.ChatOff"))}</p>` : ""}` : "";
  const again = pend && ctx.isStaff
    ? `<button type="button" class="ipb-bt-link" data-ev-act="again" data-eid="${esc(pend.id)}" data-fk="ev-again" aria-label="${esc(t("IPB.Ev.RollAgainAria", { roll: pend.roll }))}">${icon("fa-solid fa-rotate")}${esc(t("IPB.Ev.RollAgain"))}</button>` : "";
  const test = ctx.isStaff ? `<details class="ipb-ev-test" data-ev-det="test"${opened.get("test") ? " open" : ""}><summary>${icon("fa-solid fa-flask")}<span>${esc(t("IPB.Ev.Test"))}</span></summary>
      <p class="ipb-bt-hint">${esc(t("IPB.Ev.TestHint"))}</p>
      <div class="ipb-ev-testrow"><label class="ipb-ev-testlabel"><span>${esc(t("IPB.Ev.TestLabel"))}</span><input class="ipb-input" type="text" inputmode="numeric" maxlength="2" size="3" name="ipb-ev-test-${esc(id)}" data-ev-test autocomplete="off" placeholder="53"></label>
      <button type="button" class="ipb-btn ipb-btn-small" data-ev-act="test" data-fk="ev-test"${blocked ? ' aria-disabled="true"' : ""}>${icon("fa-solid fa-dice")}${esc(t("IPB.Ev.TestBtn"))}</button></div>
      <p class="ipb-bt-warn" role="status" data-ev-testwarn></p></details>` : "";
  return `<section class="ipb-ev-roll" aria-labelledby="${esc(ctx.app.id)}-ev-roll-h">
    <h2 class="ipb-bt-h" id="${esc(ctx.app.id)}-ev-roll-h">${esc(t("IPB.Ev.RollH"))}</h2>
    <fieldset class="ipb-ev-mode"><legend>${esc(t("IPB.Ev.ModeLegend"))}</legend><div class="ipb-ev-segs">${seg}</div><p class="ipb-bt-hint">${esc(t(`IPB.Ev.ModeHint.${mode}`))}</p></fieldset>
    <label class="ipb-bt-field"><span class="ipb-bt-label">${esc(t("IPB.Ev.Label"))}</span><input class="ipb-input" type="text" name="ipb-ev-label-${esc(id)}" data-ev-label maxlength="60" value="${esc(typed)}" placeholder="${esc(ph)}" autocomplete="off"></label>
    ${chatBox}
    <div class="ipb-bt-actions"><button type="button" class="ipb-btn ipb-btn-primary" data-ev-act="roll" data-fk="ev-roll"${blocked ? ' aria-disabled="true"' : ""}>${icon("fa-solid fa-dice")}${esc(t("IPB.Ev.Roll"))}</button>${again}</div>
    ${why ? `<p class="ipb-ev-why" data-ev-why>${icon(noBook ? "fa-solid fa-circle-exclamation" : "fa-solid fa-hourglass-half")}<span>${esc(why)}</span></p>` : ""}
    ${test}
  </section>`;
}

function render(ctx) {
  const { esc, icon, t } = ctx;
  const list = logOf(ctx.B);
  const [latest, ...older] = list;
  const occupied = ctx.B.base.occupied
    ? `<div class="ipb-bt-occupied" role="status">${icon("fa-solid fa-triangle-exclamation")}<p>${esc(t("IPB.Bt.Occupied"))}</p>`
      + (ctx.isStaff ? `<button type="button" class="ipb-btn ipb-btn-small" data-ev-act="regain" data-fk="ev-regain">${esc(t("IPB.Bt.Regain"))}</button>` : "") + `</div>` : "";
  const left = ctx.canEdit
    ? rollPanel(ctx, list)
    : `<p class="ipb-bt-hint ipb-up-ro">${icon("fa-solid fa-lock")} ${esc(t("IPB.Ev.ReadOnly"))}</p>`;
  const right = latest
    ? latestBlock(ctx, latest, list) + historyBlock(ctx, older, list)
    : `<p class="ipb-muted ipb-ev-empty">${esc(t(ctx.canEdit ? "IPB.Ev.Empty" : "IPB.Ev.EmptyRo"))}</p>`;
  return `<div class="ipb-ev${ctx.canEdit ? "" : " ipb-ev-readonly"}">
    ${occupied}
    <div class="ipb-ev-left">${left}</div>
    <div class="ipb-ev-right">${right}</div>
  </div>`;
}

/* ------------------------------------------------------------------ book (table + live result texts) */
async function ensureBook(root) {
  const ctx = CTX.get(root);
  if (!ctx || book.loading) return;
  if (book.ok === true || (book.ok === false && Date.now() - book.at < 15000)) return;
  book.loading = true;
  let ok = false;
  try { ok = !!(await ctx.api.catalog.eventsTable()); } catch { ok = false; }
  const changed = book.ok !== ok && !(book.ok === undefined && ok);
  book.ok = ok; book.at = Date.now(); book.loading = false;
  if (changed) CTX.get(root)?.rerender();
}
async function ensureTexts(root) {
  const ctx = CTX.get(root);
  if (!ctx || book.ok === false) return;
  const list = logOf(ctx.B);
  const want = list.slice(0, 1 + (shown.get(ctx.team.id) ?? EV.PAGE_SIZE)).map((e) => e.resultId).filter((id) => id && !texts.has(id));
  if (!want.length) return;
  for (const id of want) texts.set(id, null);                         // claim now: no second request while loading
  let changed = false;
  await Promise.all([...new Set(want)].map(async (id) => {
    try { const x = await ctx.api.catalog.eventText(id); texts.set(id, x || null); if (x) { const ev = list.find((e) => e.resultId === id); if (ev && x !== ev.text) changed = true; } } catch { texts.set(id, null); }
  }));
  if (changed) CTX.get(root)?.rerender();
}

/* ------------------------------------------------------------------ actions */
function focusLater(root, eid) {
  // no preventScroll: on a narrow window the result lies below the roll panel and must scroll into view
  setTimeout(() => { const el = root.isConnected ? q(root, `[data-ev-focus="${CSS.escape(eid)}"]`) : null; el?.focus(); }, 350);
}
const pendingOf = (ctx) => EV.pendingList(logOf(ctx.api.get(ctx.team.id) ?? ctx.B))[0] ?? null;

async function doRoll(root, { total = undefined, reroll = null } = {}) {
  const ctx = CTX.get(root);
  if (!ctx || !ctx.canEdit) return;
  if (book.ok === false) { ctx.announce(ctx.t("IPB.Ev.NoBook")); return; }
  const pend = pendingOf(ctx);
  if (pend && !reroll) { ctx.announce(ctx.t("IPB.Ev.PendingBlock", { roll: pend.roll })); return; }
  const op = `roll:${ctx.team.id}`;
  if (!startOp(op)) return;
  try {
    const id = ctx.team.id;
    const mode = modeOf(ctx);
    const list = logOf(ctx.api.get(id) ?? ctx.B);
    const typed = (labels.get(`${id}:${mode}`) ?? "").trim();
    const week = mode === "week" ? EV.nextWeek(list) : 0;               // an untyped weekly label is stored as the number only, so it reads in the viewer's language
    const chat = ctx.isStaff && chatOn.get(id) !== false && ctx.B.policy.chat !== "off";
    const res = await ctx.run(reroll ? ctx.api.events.reroll(id, reroll, { chat }) : ctx.api.events.roll(id, { label: typed, mode, week, chat, total }));
    if (!res) return;
    labels.delete(`${id}:${mode}`);
    const input = q(root, "[data-ev-label]"); if (input) input.value = "";
    fresh.add(res.id); setTimeout(() => fresh.delete(res.id), 1500);
    ctx.announce(ctx.t("IPB.Ev.Rolled", { roll: res.roll, band: bandName(ctx, res) || ctx.t("IPB.Ev.Result", { roll: res.roll }) }));
    focusLater(root, res.id);
  } finally { busy.delete(op); }
}

async function doTest(root) {
  const ctx = CTX.get(root);
  if (!ctx || !ctx.isStaff) return;
  const input = q(root, "[data-ev-test]"); const warn = q(root, "[data-ev-testwarn]");
  const n = EV.parseD66(input?.value);
  if (n === null) { if (warn) warn.textContent = ctx.t("IPB.Ev.TestBad", { value: input?.value || "-" }); return; }
  if (warn) warn.textContent = "";
  await doRoll(root, { total: n });
}

async function doApply(root, eid) {
  const ctx = CTX.get(root);
  if (!ctx || !ctx.isStaff) return;
  const ev = ctx.B.events[eid]; if (!ev) return;
  const op = `apply:${eid}`; if (!startOp(op)) return;
  try {
    const d = diffOf(ctx, { id: eid, ...ev }, "pending");
    const res = await ctx.run(ctx.api.events.apply(ctx.team.id, eid));
    if (!res) return;
    ctx.announce(EV.changesAnything(res.plan) ? ctx.t("IPB.Ev.Applied", { diff: diffText(d) }) : ctx.t("IPB.Ev.Handled.done", { roll: ev.roll }));
    focusLater(root, eid);
  } finally { busy.delete(op); }
}
async function doDismiss(root, eid) {
  const ctx = CTX.get(root);
  const ev = ctx?.B.events[eid]; if (!ctx || !ctx.isStaff || !ev) return;
  const op = `dismiss:${eid}`; if (!startOp(op)) return;
  try { if (await ctx.run(ctx.api.events.dismiss(ctx.team.id, eid))) { ctx.announce(ctx.t("IPB.Ev.Dismissed", { roll: ev.roll })); focusLater(root, eid); } } finally { busy.delete(op); }
}
async function doRepick(root, eid) {
  const ctx = CTX.get(root);
  const ev = ctx?.B.events[eid]; if (!ctx || !ctx.isStaff || !ev) return;
  const op = `repick:${eid}`; if (!startOp(op)) return;
  try {
    if (!(await ctx.run(ctx.api.events.repick(ctx.team.id, eid)))) return;
    const fresh2 = ctx.api.get(ctx.team.id);
    const e = fresh2?.events[eid]?.effect;
    const names = (e?.upgrades ?? []).map((u) => fresh2.upgrades[u]?.name).filter(Boolean).join(", ");
    ctx.announce(ctx.t("IPB.Ev.Repicked", { names: names || "-" }));
  } finally { busy.delete(op); }
}
async function doUndo(root, eid) {
  const ctx = CTX.get(root);
  const ev = ctx?.B.events[eid]; if (!ctx || !ctx.isStaff || !ev) return;
  const op = `undo:${eid}`; if (!startOp(op)) return;
  try { if (await ctx.run(ctx.api.events.undo(ctx.team.id, eid))) { ctx.announce(ctx.t("IPB.Ev.Undone", { roll: ev.roll })); focusLater(root, eid); } } finally { busy.delete(op); }
}
async function doChat(root, eid) {
  const ctx = CTX.get(root);
  if (!ctx || !ctx.isStaff || !ctx.B.events[eid]) return;
  const op = `chat:${eid}`; if (!startOp(op)) return;
  try { if (await ctx.run(ctx.api.events.postChat(ctx.team.id, eid))) ctx.announce(ctx.t("IPB.Ev.Posted")); } finally { busy.delete(op); }
}

/* ------------------------------------------------------------------ delegated events */
function bind(root) {
  root.addEventListener("click", (ev) => {
    const el = ev.target instanceof Element ? ev.target.closest("[data-ev-act]") : null;
    if (!el || !root.contains(el)) return;
    const ctx = CTX.get(root);
    if (el.getAttribute("aria-disabled") === "true") {            // a refused action says why instead of doing nothing
      const why = q(root, "[data-ev-why]");
      if (ctx && why) ctx.announce(why.textContent.trim());
      return;
    }
    const act = el.dataset.evAct, eid = el.dataset.eid;
    if (act === "roll") doRoll(root);
    else if (act === "test") doTest(root);
    else if (act === "again") doRoll(root, { reroll: eid });
    else if (act === "apply") doApply(root, eid);
    else if (act === "dismiss") doDismiss(root, eid);
    else if (act === "repick") doRepick(root, eid);
    else if (act === "undo") doUndo(root, eid);
    else if (act === "chat") doChat(root, eid);
    else if (act === "more" && ctx) { shown.set(ctx.team.id, (shown.get(ctx.team.id) ?? EV.PAGE_SIZE) + EV.PAGE_SIZE); ctx.rerender(); ensureTexts(root); }
    else if (act === "regain" && ctx?.isStaff) ctx.update({ base: { occupied: false } }).then((r) => { if (r) ctx.announce(ctx.t("IPB.Bt.Regained")); });
  });
  root.addEventListener("input", (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    const ctx = CTX.get(root);
    if (!el || !ctx) return;
    if (el.matches("[data-ev-label]")) labels.set(`${ctx.team.id}:${modeOf(ctx)}`, el.value);
  });
  root.addEventListener("change", (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    const ctx = CTX.get(root);
    if (!el || !ctx) return;
    if (el.matches("[data-ev-mode]")) { modes.set(ctx.team.id, el.value === "any" ? "any" : "week"); ctx.rerender(); }
    else if (el.matches("[data-ev-chat]")) chatOn.set(ctx.team.id, el.checked);
    else if (el.matches("[data-ev-note]")) {
      const eid = el.dataset.evNote; const cur = ctx.B.events[eid];
      if (cur && el.value.trim() !== cur.note) ctx.run(ctx.api.events.setNote(ctx.team.id, eid, el.value.trim()));
    }
  });
  root.addEventListener("keydown", (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    if (!el || !el.matches("input.ipb-input")) return;
    if (ev.isComposing || ev.keyCode === 229) return;                 // B13 (IME): Enter / Escape belong to the composition
    const ctx = CTX.get(root);
    if (ev.key === "Enter") { ev.preventDefault(); if (el.matches("[data-ev-test]")) doTest(root); else el.blur(); }
    else if (ev.key === "Escape") {
      ev.stopPropagation();                                           // the core closes the window on Escape otherwise
      if (el.matches("[data-ev-note]")) el.value = ctx?.B.events[el.dataset.evNote]?.note ?? el.value;
      else if (el.matches("[data-ev-label]")) { el.value = ""; labels.delete(`${ctx.team.id}:${modeOf(ctx)}`); }
      el._evEsc = true;
    }
  });
  root.addEventListener("keyup", (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    if (ev.key === "Escape" && el?._evEsc) { ev.stopPropagation(); el._evEsc = false; el.blur(); }
  });
  root.addEventListener("toggle", (ev) => {                          // remember which details the user opened or closed (the body repaints on every update)
    const el = ev.target instanceof Element ? ev.target : null;
    const key = el?.dataset?.evDet;
    if (key) opened.set(key, el.open);
  }, true);
}

export const events = {
  id: "events",
  icon: "fa-solid fa-dice",
  badge: (ctx) => EV.pendingList(P.sortedList(ctx.B.events)).length || "",
  render,
  mount(ctx, root) {
    CTX.set(root, ctx);
    if (!BOUND.has(root)) { BOUND.add(root); bind(root); }
    ensureBook(root);
    ensureTexts(root);
  }
};
export default events;
