/* End-of-session panel, phase S2: AWARD / UNDO / chat summary / log. Runs on a GM client only (the executor in gm.mjs calls it).
   AWARD = begin -> one row per hero -> end, every step an idempotent reducer action (rid = award number + hero). Each hero's karma and the marker flag
   `flags.invincible-plus-ultra.sessionAwards.<sessionId>_<n>` {before, after} are written in ONE actor update, so a crash between the actor update and the world-setting
   write is repaired by the resume: it finds the marker, records the row from it and never applies twice. Karma is written ABSOLUTE (`after`, computed from the live
   `_source` value), so even two GM tabs racing on one hero converge on the same number.
   UNDO = per row: strict (the hero's karma must still equal what the award left, else the hero is skipped as "drift") or relative (take the applied delta back).
   A missing marker on an applied row means the actor was already restored (crash between actor update and the row record): the row is just recorded.
   `_failAt` ({ row: index, phase: "actor" | "row" }) throws on purpose, for the crash-resume test (local calls only). */
import * as P from "./pure.mjs";
import * as OP from "./ops-pure.mjs";
import * as Store from "./store.mjs";
import { t } from "./lang.mjs";

const MOD = Store.MOD;
let busy = false;

const err = (code, params = {}) => ({ ok: false, changed: false, error: { key: `IPL.Session.err.${code}`, code, params } });
const ctxOf = (user) => ({ user: { id: user.id, staff: true }, owns: () => true });
const karmaOf = (actor) => Math.min(P.LIMITS.karmaMax, Math.max(0, Math.trunc(Number(actor?._source?.system?.karma) || 0)));
const flagsOf = (actor) => actor?.flags?.[MOD]?.sessionAwards ?? {};
/** v14 ForcedDeletion operator factory (the legacy "-=key" syntax logs a deprecation warning there); null on v13. */
const del = () => globalThis.foundry?.data?.operators?.ForcedDeletion?.create?.();
const delFactory = () => (typeof globalThis.foundry?.data?.operators?.ForcedDeletion?.create === "function" ? del : null);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);

/** Guarded log call: only through api.log.record (never imports the log), and a refused / disabled / unknown-type call is silently dropped. */
function logRecord(actor, k, d) {
  try {
    const rec = game.modules.get(MOD)?.api?.log?.record;
    if (typeof rec !== "function" || !actor) return;
    Promise.resolve(rec(actor, { k, d })).catch(() => {});
  } catch { /* the log is optional */ }
}
export const logStart = (session) => { for (const h of session.heroes) logRecord(game.actors.get(h.id), "session.start", { sid: session.id }); };

/** Total of one award run as the API reports it. */
const report = (s) => ({ n: s.award?.n ?? null, state: s.award?.state ?? null, rows: (s.award?.rows ?? []).map((r) => ({ ...r })) });

export async function award(user, { chat = false, _failAt = null } = {}) {
  if (busy) return err("busy");
  busy = true;
  try {
    let s = Store.current();
    if (!s) return err("noSession");
    if (s.state === "awarded") return { ok: true, changed: false, already: true, session: s, ...report(s) };
    if (s.state !== "closed" && s.award?.state !== "applying") return err("badState", { state: s.state });
    const ctx = ctxOf(user), skipped = [];
    if (!s.award) {                                                  // heroes deleted since the start are dropped BEFORE the row set is fixed
      const missing = s.heroes.filter((h) => !game.actors.get(h.id));
      if (missing.length >= s.heroes.length) return err("noHeroes");
      for (const m of missing) {
        const r = await Store.commit({ type: "removeHero", hero: m.id, rid: `awx:${m.id}` }, ctx);
        if (r.ok) skipped.push(m.name);
      }
      s = Store.current();
    }
    if (!s.award || s.award.state !== "applying") {
      const n = (s.awards.length ? Math.max(...s.awards.map((x) => x.n)) : 0) + 1;
      const r = await Store.commit({ type: "awardBegin", rid: `awb${n}` }, ctx);
      if (!r.ok) return r;
      s = Store.current();
    }
    const n = s.award.n, key = P.awardKey(s);
    for (let i = 0; i < s.award.rows.length; i++) {
      const row = s.award.rows[i];
      const live = Store.current()?.award?.rows.find((x) => x.h === row.h);
      if (!live || live.st !== 0) continue;
      const actor = game.actors.get(row.h);
      if (!actor) { skipped.push(row.h); continue; }
      const flag = flagsOf(actor)[key];
      let before;
      if (flag && Number.isFinite(Number(flag.before))) before = Math.max(0, Math.trunc(Number(flag.before)));      // already written: record it, never apply twice
      else {
        before = karmaOf(actor);
        const after = P.applyKarma(before, live.gain, live.loss);
        await actor.update(OP.awardUpdate(MOD, key, before, after, Date.now(), OP.pruneAwardFlags(flagsOf(actor), key), delFactory()), { ipLogCause: "session" });
        if (_failAt?.phase === "actor" && _failAt.row === i) throw new Error("test crash after the actor update");
      }
      const r = await Store.commit({ type: "awardRow", hero: row.h, before, rid: `aw${n}r:${row.h}` }, ctx);
      if (!r.ok) return { ...r, ...report(Store.current() ?? s), resumable: true };
      if (_failAt?.phase === "row" && _failAt.row === i) throw new Error("test crash after the row record");
    }
    const pending = Store.current().award.rows.some((r) => r.st === 0);
    const end = await Store.commit({ type: "awardEnd", partial: pending, rid: `aw${n}e` }, ctx);
    if (!end.ok) return { ...end, resumable: true };
    const done = Store.current();
    afterAward(done);
    if (chat === true || Store.setting(Store.SETTING_CHAT, false) === true) await postSummary(done).catch((e) => console.warn(`${MOD} | session chat summary failed`, e));
    return { ok: true, changed: true, session: done, skipped, ...report(done) };
  } catch (e) {
    console.warn(`${MOD} | session award interrupted (it can be resumed)`, e);
    return { ...err("internal", { msg: String(e?.message ?? e).slice(0, 80) }), resumable: true, ...report(Store.current() ?? { award: null }) };
  } finally { busy = false; }
}

/** One coalesced log row per hero: what earned the karma, and the karma change itself. */
function afterAward(s) {
  const sm = P.summary(s);
  for (const r of s.award?.rows ?? []) {
    if (r.st !== 1) continue;
    const actor = game.actors.get(r.h); if (!actor) continue;
    const row = sm.rows.find((x) => x.hero === r.h);
    logRecord(actor, "session.award", { sid: s.id, gain: r.gain, loss: r.loss, before: r.before, after: r.after, ...(row?.overcame ? { flaw: 1 } : {}) });
    if (row?.yes.length) logRecord(actor, "session.answers", { sid: s.id, yes: row.yes });
  }
}

export async function undo(user, { mode = "strict" } = {}) {
  if (busy) return err("busy");
  busy = true;
  try {
    let s = Store.current();
    if (!s) return err("noSession");
    if (!s.award || !["done", "undoing"].includes(s.award.state)) return err(s.award ? "badState" : "notAwarded", { state: s.state });
    const ctx = ctxOf(user), n = s.award.n, key = P.awardKey(s), results = [], m = mode === "relative" ? "relative" : "strict";
    for (const row of s.award.rows) {
      if (row.st !== 1) continue;
      const actor = game.actors.get(row.h);
      if (!actor) { results.push({ h: row.h, status: "missing" }); continue; }
      if (!flagsOf(actor)[key]) {                                    // marker gone: the actor was already restored before a crash; only the row record is missing
        const r = await Store.commit({ type: "undoRow", hero: row.h, rid: `un${n}r:${row.h}` }, ctx);
        results.push({ h: row.h, status: r.ok ? "ok" : "error", resumed: true });
        continue;
      }
      const cur = karmaOf(actor);
      const plan = P.undoPlan(s, { [row.h]: cur }, m).find((p) => p.h === row.h);
      if (!plan || plan.status !== "ok") { results.push({ h: row.h, status: "drift", expected: row.after, current: cur }); continue; }
      await actor.update(OP.undoUpdate(MOD, key, plan.restoreTo, delFactory()), { ipLogCause: "session" });
      const r = await Store.commit({ type: "undoRow", hero: row.h, rid: `un${n}r:${row.h}` }, ctx);
      results.push({ h: row.h, status: r.ok ? "ok" : "error", from: cur, to: plan.restoreTo, ...(plan.drifted ? { drifted: true } : {}) });
      logRecord(actor, "session.undo", { sid: s.id, before: cur, after: plan.restoreTo });
    }
    // the end marker carries the number of rows undone so far: a second run that made progress is not mistaken for a replay of an earlier partial end
    const undone = (Store.current()?.award?.rows ?? []).filter((r) => r.st === 2).length;
    const end = await Store.commit({ type: "undoEnd", rid: `un${n}e${undone}` }, ctx);
    if (!end.ok) return { ...end, results };
    return { ok: true, changed: true, partial: end.partial === true, results, session: Store.current(), mode: m };
  } catch (e) {
    console.warn(`${MOD} | session undo interrupted (run it again to continue)`, e);
    return { ...err("internal", { msg: String(e?.message ?? e).slice(0, 80) }), resumable: true };
  } finally { busy = false; }
}

/** Public chat message with the awarded karma (names and numbers only, no book text). Needs an award on the session. */
export async function postSummary(session = Store.current()) {
  const s = session;
  if (!s) return err("noSession");
  const rows = (s.award?.rows ?? []).filter((r) => r.st === 1);
  if (!rows.length) return err("badState", { why: "noAward" });
  const sm = P.summary(s), name = (id) => game.actors.get(id)?.name ?? s.heroes.find((h) => h.id === id)?.name ?? id;
  const lines = rows.map((r) => `<li>${esc(r.loss ? t("IPL.Session.Chat.rowLoss", { name: name(r.h), gain: r.gain, loss: r.loss, before: r.before, after: r.after }) : t("IPL.Session.Chat.row", { name: name(r.h), gain: r.gain, before: r.before, after: r.after }))}</li>`).join("");
  const flaw = sm.overcame.filter((id) => rows.some((r) => r.h === id));
  const note = flaw.length ? `<p><em>${esc(t("IPL.Session.Chat.flaw", { names: flaw.map(name).join(", ") }))}</em></p>` : "";
  await ChatMessage.create({ content: `<div class="ipl-session-chat"><h3>${esc(t("IPL.Session.Chat.Title"))}</h3><ul>${lines}</ul>${note}</div>`, speaker: { alias: t("IPL.Session.Chat.Title") } });
  return { ok: true, changed: false, posted: rows.length };
}

/** After an award: move the finished session to the archive and free the slot ("Finish and dismiss"). */
export async function dismiss() {
  const s = Store.current();
  if (!s) return err("noSession");
  if (s.state !== "awarded") return err("badState", { state: s.state });
  await Store.queue(() => Store.archiveSession(s, "awarded"));
  return { ok: true, changed: true, session: null };
}
