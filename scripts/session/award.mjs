/* End-of-session panel, phase S2 (hardened in S5): AWARD / UNDO / chat summary / log. Runs on a GM client only (the executor in gm.mjs calls it).
   AWARD = begin -> one row per hero -> end, every step an idempotent reducer action (rid = award number + hero). Each hero's karma and the marker flag
   `flags.invincible-plus-ultra.sessionAwards.<sessionId>_<n>` {before, after} are written in ONE actor update, which is then VERIFIED (re-read of karma and marker:
   a vetoed / no-op update is a failed row, never an applied one). A crash between the actor update and the world-setting write is repaired by the resume: it finds
   the marker, checks that it is bound to the award record (after == applyKarma(before, gain, loss)) and the sheet, records the row from it and never applies twice.
   Karma is written ABSOLUTE (`after`, computed from the live `_source` value), so even two GM tabs racing on one hero converge on the same number.
   The award record on the session (rows frozen at awardBegin) is the source of truth: reopen / discard / edits are refused while it exists (pure.mjs).
   UNDO = per row: strict (the hero's karma must still equal what the award left, else the hero is skipped as "drift") or relative (take the applied delta back).
   A missing marker no longer means "restored": the stored row (before / after) decides, with the same drift guard. Undo is also how an interrupted (applying) award is aborted.
   SIDE EFFECTS (chat card, log rows) run in exactly one tab: the one whose `awardFx` claim the session recorded. The chat choice of the confirm dialog wins over the world setting.
   `_failAt` ({ row: index, phase: "actor" | "row" }) throws on purpose, for the crash-resume test (local calls only). */
import * as P from "./pure.mjs";
import * as OP from "./ops-pure.mjs";
import * as Store from "./store.mjs";
import { t } from "./lang.mjs";

const MOD = Store.MOD;
let busy = false;
/** This browser tab: the side effects of one award are claimed by exactly one tab through the `awardFx` action (S4-04). */
const TAB = `t${Math.random().toString(36).slice(2, 10)}`;

const err = (code, params = {}) => ({ ok: false, changed: false, error: { key: `IPL.Session.err.${code}`, code, params } });
const ctxOf = (user) => ({ user: { id: user.id, staff: true }, owns: () => true });
/** The live karma of the sheet. Never clamped down (S4-12): a value above LIMITS.karmaMax is refused by the award instead. */
const karmaOf = (actor) => Math.max(0, Math.trunc(Number(actor?._source?.system?.karma) || 0));
const flagsOf = (actor) => actor?.flags?.[MOD]?.sessionAwards ?? {};
/** v14 ForcedDeletion operator factory (the legacy "-=key" syntax logs a deprecation warning there); null on v13. */
const del = () => globalThis.foundry?.data?.operators?.ForcedDeletion?.create?.();
const delFactory = () => (typeof globalThis.foundry?.data?.operators?.ForcedDeletion?.create === "function" ? del : null);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);

/** One karma writer at a time per hero on this client (S4-13). Other writers (the base karma purchase) can adopt it through api.session._internal.Award.withActorLock. */
const actorLocks = new Map();
export function withActorLock(id, fn) {
  const prev = actorLocks.get(id) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(() => {}, () => {});
  actorLocks.set(id, tail);
  tail.then(() => { if (actorLocks.get(id) === tail) actorLocks.delete(id); });
  return run;
}

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
const nameOf = (id) => game.actors.get(id)?.name ?? Store.current()?.heroes.find((h) => h.id === id)?.name ?? id;

/** Write one hero's award (karma + marker in ONE update) and VERIFY it landed (S4-02): a vetoed / no-op update is a failure, never an applied row.
    A marker that already exists is believed only when it is bound to the award record (S4-11) and the sheet agrees with it.
    Returns { ok, before, after } or { ok: false, reason: "karmaTooBig" | "notApplied" | "markerMismatch" }. */
async function applyHero(actor, key, row, pruneOf) {
  const flag = flagsOf(actor)[key];
  if (OP.markerConsistent(flag, row)) {
    const before = Math.max(0, Math.trunc(Number(flag.before))), after = P.applyKarma(before, row.gain, row.loss);
    if (karmaOf(actor) === after) return { ok: true, before, after, resumed: true };               // already written: record it, never apply twice
    if (row.gain || row.loss) return { ok: false, reason: "markerMismatch" };                       // a believable marker the sheet disagrees with: the GM decides (undo / fix the sheet)
  }
  for (let attempt = 0; attempt < 2; attempt++) {                    // a second try covers a concurrent writer landing between our read and our write (S4-13)
    const before = karmaOf(actor);
    if (before > P.LIMITS.karmaMax) return { ok: false, reason: "karmaTooBig" };
    const after = P.applyKarma(before, row.gain, row.loss);
    await actor.update(OP.awardUpdate(MOD, key, before, after, Date.now(), pruneOf(actor), delFactory()), { ipLogCause: "session" });
    const mark = flagsOf(actor)[key];
    if (karmaOf(actor) === after && mark && Number(mark.before) === before && Number(mark.after) === after) return { ok: true, before, after };
  }
  return { ok: false, reason: "notApplied" };
}

export async function award(user, { chat = undefined, _failAt = null } = {}) {
  if (busy) return err("busy");
  busy = true;
  try {
    let s = Store.current();
    if (!s) return err("noSession");
    if (s.state === "awarded") return { ok: true, changed: false, already: true, session: s, ...report(s) };
    if (s.state !== "closed" && s.award?.state !== "applying") return err("badState", { state: s.state });
    if (s.award && s.award.state !== "applying") return err("badState", { state: s.state });
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
      const r = await Store.commit({ type: "awardBegin", rid: `awb${n}`, ...(typeof chat === "boolean" ? { chat } : {}) }, ctx);
      if (!r.ok) return r;
      s = Store.current();
    }
    const n = s.award.n, key = P.awardKey(s), failed = [];
    for (let i = 0; i < s.award.rows.length; i++) {
      const row = s.award.rows[i];
      const cur = Store.current();                                    // S4-01: the award may have been undone / replaced by a second GM tab since the last hero
      if (!cur || cur.id !== s.id || cur.award?.n !== n || cur.award?.state !== "applying") return { ...err(cur ? "badState" : "noSession", { why: "aborted" }), ...report(cur ?? { award: null }) };
      const live = cur.award.rows.find((x) => x.h === row.h);
      if (!live || live.st !== 0) continue;
      const actor = game.actors.get(row.h);
      if (!actor) { skipped.push(row.h); continue; }
      const res = await withActorLock(actor.id, () => applyHero(actor, key, live, (a) => OP.pruneAwardFlags(flagsOf(a), key)));
      if (_failAt?.phase === "actor" && _failAt.row === i) throw new Error("test crash after the actor update");
      if (!res.ok) { failed.push({ h: row.h, name: actor.name, reason: res.reason }); continue; }
      const r = await Store.commit({ type: "awardRow", hero: row.h, before: res.before, rid: `aw${n}r:${row.h}` }, ctx);
      if (!r.ok) return { ...r, ...report(Store.current() ?? s), resumable: true };
      if (_failAt?.phase === "row" && _failAt.row === i) throw new Error("test crash after the row record");
    }
    if (failed.length) return { ...err("applyFailed", { names: failed.map((f) => f.name).join(", ") }), changed: true, failed, resumable: true, skipped, ...report(Store.current() ?? s) };
    const pending = Store.current().award.rows.some((r) => r.st === 0);
    const end = await Store.commit({ type: "awardEnd", partial: pending, rid: `aw${n}e` }, ctx);
    if (!end.ok && Store.current()?.award?.state !== "done") return { ...end, resumable: true };
    const done = Store.current();
    // S4-04: the side effects run in exactly ONE tab: the one whose claim the session recorded
    const claim = await Store.commit({ type: "awardFx", tab: TAB, rid: `aw${n}fx:${TAB}` }, ctx);
    if (claim.ok && Store.current()?.award?.fx === TAB) {
      afterAward(done);
      const setting = Store.setting(Store.SETTING_CHAT, false) === true;
      const want = typeof chat === "boolean" ? chat : typeof done.award.chat === "boolean" ? done.award.chat : setting;      // S4-05: the dialog's choice wins over the world default
      if (want) await postSummary(done).catch((e) => console.warn(`${MOD} | session chat summary failed`, e));
    }
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
    const s = Store.current();
    if (!s) return err("noSession");
    if (!s.award || !["applying", "done", "undoing"].includes(s.award.state)) return err(s.award ? "badState" : "notAwarded", { state: s.state });
    const ctx = ctxOf(user), n = s.award.n, key = P.awardKey(s), results = [], m = mode === "relative" ? "relative" : "strict";
    const restore = async (actor, restoreTo, marker) => {
      await actor.update(OP.undoUpdate(MOD, key, restoreTo, delFactory(), !!marker), { ipLogCause: "session" });
      return karmaOf(actor) === restoreTo && (!marker || !flagsOf(actor)[key]);              // S4-02: verify the restore landed
    };
    for (const row of s.award.rows) {
      const actor = game.actors.get(row.h);
      if (row.st === 0) {                                              // interrupted award: a hero written but never recorded still carries its marker; take it back too
        const mk = actor && flagsOf(actor)[key];
        if (mk && OP.markerConsistent(mk, row) && karmaOf(actor) === Math.trunc(Number(mk.after))) {
          const ok = await withActorLock(actor.id, () => restore(actor, Math.max(0, Math.trunc(Number(mk.before))), mk));
          results.push({ h: row.h, status: ok ? "ok" : "failed", orphan: true });
        }
        continue;
      }
      if (row.st !== 1) continue;
      if (!actor) { results.push({ h: row.h, status: "missing" }); continue; }
      const out = await withActorLock(actor.id, async () => {
        const cur = karmaOf(actor), marker = flagsOf(actor)[key];
        // S4-03: the award record on the session is the source of truth. No marker and the sheet already shows `before`: restored before a crash, only the row record is missing.
        if (!marker && cur === row.before && row.before !== row.after) return { status: "ok", resumed: true };
        const plan = P.undoPlan(s, { [row.h]: cur }, m).find((p) => p.h === row.h);
        if (!plan || plan.status !== "ok") return { status: "drift", expected: row.after, current: cur };
        const landed = await restore(actor, plan.restoreTo, marker);
        return landed ? { status: "ok", from: cur, to: plan.restoreTo, ...(plan.drifted ? { drifted: true } : {}), ...(marker ? {} : { fromRecord: true }), logged: true } : { status: "failed", from: cur, to: plan.restoreTo };
      });
      if (out.status === "ok") {
        const r = await Store.commit({ type: "undoRow", hero: row.h, rid: `un${n}r:${row.h}` }, ctx);
        const { logged, ...pub } = out;
        results.push({ h: row.h, ...pub, status: r.ok ? "ok" : "error" });
        if (logged) logRecord(actor, "session.undo", { sid: s.id, before: out.from, after: out.to });
      } else results.push({ h: row.h, ...out });
    }
    // the end marker carries the number of rows undone so far: a second run that made progress is not mistaken for a replay of an earlier partial end
    const undone = (Store.current()?.award?.rows ?? []).filter((r) => r.st === 2).length;
    const end = await Store.commit({ type: "undoEnd", rid: `un${n}e${undone}` }, ctx);
    if (!end.ok) return { ...end, results };
    const failed = results.filter((r) => r.status === "failed");
    return { ok: true, changed: true, partial: end.partial === true, results, session: Store.current(), mode: m, ...(failed.length ? { failed: failed.map((f) => nameOf(f.h)) } : {}) };
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

/** After an award: move the finished session to the archive and free the slot ("Finish and dismiss"). The LATEST state is re-read inside the queue (S4-14). */
export async function dismiss() {
  const s0 = Store.current();
  if (!s0) return err("noSession");
  if (s0.state !== "awarded") return err("badState", { state: s0.state });
  if (busy) return err("busy");                                       // an undo / award of this tab is still running
  return await Store.queue(async () => {
    const cur = Store.current();
    if (!cur || cur.id !== s0.id) return err("noSession");
    if (cur.state !== "awarded" || cur.award?.state !== "done") return err("badState", { state: cur.state });      // not while an undo has begun (partial undo / second tab)
    await Store.archiveSession(cur, "awarded");
    return { ok: true, changed: true, session: null };
  });
}
