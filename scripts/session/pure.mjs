/* End-of-session panel, phase S1: PURE rules + state model. No Foundry globals: runs in Node and in the browser.
   Spec: dev/session-spec.md. A SESSION is one plain JSON object; every function here returns NEW objects (inputs are never mutated) and the reducer never
   throws: it answers { ok, session, changed, dup?, error? } where error = { key: "IPL.Session.err.<code>", code, params }.
   TRUST: the reducer never reads "who" from the action; the caller passes ctx.user = { id, staff } taken from the SERVER-verified sender and
   ctx.owns(heroId) answered from the real actor ownership table. A payload can therefore not claim to be someone else.
   Questions are identified by id only (labels are lang keys / own short words); the book text is never stored here. */

export const SCHEMA = 1;
export const MOD_ID = "invincible-plus-ultra";

/** Ten karma questions (1 karma each) then six Bad karma questions (-1 each). `key` = last part of the lang key IPL.Session.q.<key>. */
export const GOOD = Object.freeze([
  { id: "q01", key: "action" }, { id: "q02", key: "social" }, { id: "q03", key: "personality" }, { id: "q04", key: "drive" }, { id: "q05", key: "flaw", flaw: true },
  { id: "q06", key: "risk" }, { id: "q07", key: "bystanders" }, { id: "q08", key: "occupation" }, { id: "q09", key: "drawback" }, { id: "q10", key: "extraordinary" }
].map((q) => Object.freeze({ ...q, group: "good" })));
export const BAD = Object.freeze([
  { id: "b01", key: "failAid" }, { id: "b02", key: "failBystanders" }, { id: "b03", key: "failOccupation" }, { id: "b04", key: "wreckZone" }, { id: "b05", key: "kill" }, { id: "b06", key: "immoral" }
].map((q) => Object.freeze({ ...q, group: "bad" })));
export const FLAW_ID = "q05";
/** Short English labels in our own words (fallback / tests; the UI uses IPL.Session.q.<key>). */
export const LABELS_EN = Object.freeze({
  action: "Took part in an action scene", social: "Took part in a social scene", personality: "Played to your personality", drive: "Played to your drive",
  flaw: "Played to your flaw (or overcame it)", risk: "Risked your life for a teammate or key relationship", bystanders: "Saved innocent lives",
  occupation: "Carried out your occupation's duties", drawback: "Overcame a challenge from a drawback", extraordinary: "Did something that made the table cheer",
  failAid: "Failed to help a teammate or key relationship", failBystanders: "Failed to help bystanders", failOccupation: "Neglected your occupation's duties",
  wreckZone: "Wrecked a zone", kill: "Killed someone", immoral: "Committed another immoral deed"
});
export const LIMITS = Object.freeze({ heroes: 24, name: 80, img: 300, log: 120, seen: 40, awardHistory: 5, karmaMax: 99999, bytes: 200000, logNote: 40 });
export const STATES = Object.freeze(["open", "closed", "awarded", "discarded"]);
export const ACTIONS = Object.freeze(["start", "setQuestion", "next", "prev", "setAnswer", "unlock", "addHero", "removeHero", "setAskBad", "close", "reopen", "awardBegin", "awardRow", "awardEnd", "undoRow", "undoEnd", "discard"]);
export const STAFF_ONLY = Object.freeze(new Set(["start", "setQuestion", "next", "prev", "unlock", "addHero", "removeHero", "setAskBad", "close", "reopen", "awardBegin", "awardRow", "awardEnd", "undoRow", "undoEnd", "discard"]));

const BAD_KEYS = new Set(["__proto__", "constructor", "prototype", "toString", "valueOf", "hasOwnProperty"]);
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const has = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
export const isId = (s) => typeof s === "string" && ID_RE.test(s) && !BAD_KEYS.has(s);
export const clampText = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const safeImg = (s) => { const x = clampText(s, LIMITS.img); return /^\s*(javascript|data|vbscript):/i.test(x) ? "" : x; };
const int = (n, lo, hi, d = lo) => { n = Number(n); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.trunc(n))) : d; };

/* ------------------------------------------------------------------ questions */
export const questions = (askBad = false) => (askBad ? [...GOOD, ...BAD] : [...GOOD]);
export const questionById = (id) => GOOD.find((q) => q.id === id) ?? BAD.find((q) => q.id === id) ?? null;
export const isFlawQuestion = (id) => id === FLAW_ID;
export const ALL_IDS = Object.freeze([...GOOD, ...BAD].map((q) => q.id));
/** Number of questions in this session (summary step index = this number). */
export const total = (s) => (s?.askBad ? GOOD.length + BAD.length : GOOD.length);
export const currentQuestion = (s) => (s && s.index < total(s) ? questions(!!s.askBad)[s.index] : null);

/* ------------------------------------------------------------------ karma rules */
/** Karma gained by ONE hero from the answers: 1 per yes among the ten, the flaw question counts 2 when value is 2 (overcame). */
export function gainOf(s, heroId) {
  let g = 0;
  for (const q of GOOD) { const v = cellValue(s, q.id, heroId); if (v >= 1) g += q.flaw && v === 2 ? 2 : 1; }
  return g;
}
/** Bad karma lost (1 per yes), only when the session asks the bad questions. */
export function lossOf(s, heroId) {
  if (!s?.askBad) return 0;
  let l = 0;
  for (const q of BAD) if (cellValue(s, q.id, heroId) >= 1) l++;
  return l;
}
/** The book: karma cannot go below zero. (No upper cap in the book; we only clamp to a sane integer.) */
export const applyKarma = (before, gain, loss) => Math.min(LIMITS.karmaMax, Math.max(0, int(before, 0, LIMITS.karmaMax, 0) + int(gain, 0, 999, 0) - int(loss, 0, 999, 0)));
export const cellValue = (s, qid, heroId) => { const c = s?.answers && has(s.answers, qid) && has(s.answers[qid], heroId) ? s.answers[qid][heroId] : null; return c ? c.v : 0; };
export const cellOf = (s, qid, heroId) => (s?.answers && has(s.answers, qid) && has(s.answers[qid], heroId) ? s.answers[qid][heroId] : null);

/* ------------------------------------------------------------------ construction */
const cleanHero = (h) => (h && typeof h === "object" && isId(h.id) ? { id: h.id, name: clampText(h.name, LIMITS.name) || h.id, img: safeImg(h.img) } : null);
export function newSession({ id, heroes = [], now = 0, by = "", askBad = false } = {}) {
  const seenIds = new Set(), hs = [];
  for (const h of Array.isArray(heroes) ? heroes : []) { const c = cleanHero(h); if (c && !seenIds.has(c.id) && hs.length < LIMITS.heroes) { seenIds.add(c.id); hs.push(c); } }
  return { v: SCHEMA, id: isId(id) ? id : "s" + Math.abs(int(now, 0, 9e15, 0)).toString(36), state: "open", startedAt: int(now, 0, 9e15, 0), updatedAt: int(now, 0, 9e15, 0), rev: 1, gm: isId(by) ? by : "", askBad: !!askBad, index: 0, heroes: hs, answers: {}, award: null, awards: [], log: [], seen: [] };
}

/* ------------------------------------------------------------------ permissions (ctx = { user: { id, staff }, owns(heroId) -> bool }) */
const isStaff = (ctx) => ctx?.user?.staff === true;
export const heroIn = (s, heroId) => !!s && Array.isArray(s.heroes) && s.heroes.some((h) => h.id === heroId);
export const canView = (ctx) => !!ctx?.user && typeof ctx.user.id === "string";
export const canNavigate = (ctx, s) => !!s && s.state === "open" && isStaff(ctx);
export const canManage = (ctx) => isStaff(ctx);
/** May this user set the answer of heroId on question qid? Players: only own hero, only the question on screen, never a GM-decided cell. */
export function canAnswer(ctx, s, heroId, qid) {
  if (!s || s.state !== "open" || !heroIn(s, heroId) || !questions(!!s.askBad).some((q) => q.id === qid)) return false;
  if (isStaff(ctx)) return true;
  if (!ctx?.user || typeof ctx.owns !== "function" || ctx.owns(heroId) !== true) return false;
  const q = currentQuestion(s);
  if (!q || q.id !== qid) return false;
  return !cellOf(s, qid, heroId)?.g;
}

/* ------------------------------------------------------------------ derivations */
/** Per hero: yes ids, gain (with flaw bonus), loss, net, overcame; plus totals. Order = heroes order. */
export function summary(s) {
  const qs = questions(!!s?.askBad);
  const rows = (s?.heroes ?? []).map((h) => {
    const yes = qs.filter((q) => cellValue(s, q.id, h.id) >= 1).map((q) => q.id);
    const overcame = cellValue(s, FLAW_ID, h.id) === 2;
    const gain = gainOf(s, h.id), loss = lossOf(s, h.id);
    return { hero: h.id, name: h.name, yes, gain, loss, net: gain - loss, overcame, flawBonus: overcame ? 1 : 0 };
  });
  return { rows, gain: rows.reduce((a, r) => a + r.gain, 0), loss: rows.reduce((a, r) => a + r.loss, 0), net: rows.reduce((a, r) => a + r.net, 0), overcame: rows.filter((r) => r.overcame).map((r) => r.hero) };
}
/** Progress: per question { answered, yes, pending: [heroId] }, overall counts, and the on-screen question. */
export function progress(s) {
  const qs = questions(!!s?.askBad), hs = s?.heroes ?? [];
  const per = {};
  for (const q of qs) {
    const pending = hs.filter((h) => !cellOf(s, q.id, h.id)).map((h) => h.id);
    per[q.id] = { answered: hs.length - pending.length, yes: hs.filter((h) => cellValue(s, q.id, h.id) >= 1).length, pending };
  }
  const cur = currentQuestion(s);
  return { index: s?.index ?? 0, total: qs.length, atSummary: !!s && s.index >= qs.length, per, answered: Object.values(per).reduce((a, p) => a + p.answered, 0), cells: qs.length * hs.length, current: cur ? { id: cur.id, ...per[cur.id] } : null };
}
export const view = (s) => (!s ? "none" : s.state !== "open" || s.index >= total(s) ? "summary" : "question");

/* ------------------------------------------------------------------ award / undo plans */
export function awardPlan(s, karmaNow = {}) {
  const sm = summary(s);
  return sm.rows.map((r) => { const before = int(karmaNow?.[r.hero], 0, LIMITS.karmaMax, 0); const after = applyKarma(before, r.gain, r.loss); return { h: r.hero, gain: r.gain, loss: r.loss, before, after, delta: after - before }; });
}
/** Undo plan with a drift guard. mode "strict": a hero whose karma is not what the award left is skipped (status "drift"); "relative": take the applied delta back from the
    current value (clamped at 0). status: ok | drift | notApplied (never awarded / already undone). */
export function undoPlan(s, karmaNow = {}, mode = "strict") {
  const rows = s?.award?.rows ?? [];
  return rows.map((r) => {
    if (r.st !== 1) return { h: r.h, status: "notApplied", expected: r.after, current: null, restoreTo: null };
    const cur = Number(karmaNow?.[r.h]);
    const current = Number.isFinite(cur) ? cur : null;
    if (current === null) return { h: r.h, status: "drift", expected: r.after, current: null, restoreTo: null };
    if (current === r.after) return { h: r.h, status: "ok", expected: r.after, current, restoreTo: r.before };
    if (mode === "relative") return { h: r.h, status: "ok", expected: r.after, current, restoreTo: Math.max(0, current - (r.after - r.before)), drifted: true };
    return { h: r.h, status: "drift", expected: r.after, current, restoreTo: null };
  });
}
/** Key under which the GM side stores the applied marker on the hero (flags.<MOD_ID>.sessionAwards.<key>): same key = already applied. */
export const awardKey = (s) => (s?.award ? `${s.id}_${s.award.n}` : null);

/* ------------------------------------------------------------------ reducer */
const err = (code, params = {}) => ({ ok: false, changed: false, error: { key: `IPL.Session.err.${code}`, code, params } });
const done = (session, extra = {}) => ({ ok: true, changed: true, session, ...extra });
const pushLog = (log, e) => [...log, e].slice(-LIMITS.log);
const setCell = (answers, qid, heroId, cell) => ({ ...answers, [qid]: { ...(has(answers, qid) ? answers[qid] : {}), [heroId]: cell } });
const dropHero = (answers, heroId) => { const out = {}; for (const q of Object.keys(answers)) { const o = {}; for (const h of Object.keys(answers[q])) if (h !== heroId) o[h] = answers[q][h]; if (Object.keys(o).length) out[q] = o; } return out; };

export function reduce(session, action, ctx = {}) {
  try { return reduceInner(session, action, ctx); } catch (e) { return err("internal", { msg: String(e?.message ?? e).slice(0, 80) }); }
}
function reduceInner(s, a, ctx) {
  if (!a || typeof a !== "object" || typeof a.type !== "string" || !ACTIONS.includes(a.type)) return err("badInput");
  if (!ctx || typeof ctx !== "object" || !ctx.user || !isId(ctx.user.id)) return err("noPermission");
  const staff = isStaff(ctx), now = int(ctx.now, 0, 9e15, 0), rid = typeof a.rid === "string" ? a.rid.slice(0, 40) : "";
  if (STAFF_ONLY.has(a.type) && !staff) return err("noPermission");
  if (a.type === "start") {
    if (s && (s.state === "open" || s.state === "closed" || s.state === "awarded")) return err("exists");
    const n = newSession({ id: a.id, heroes: a.heroes, now, by: ctx.user.id, askBad: a.askBad === true });
    if (!n.heroes.length) return err("noHeroes");
    return done({ ...n, log: [{ t: now, u: ctx.user.id, a: "start", n: n.heroes.length }] });
  }
  if (!s || typeof s !== "object" || s.v !== SCHEMA) return err("noSession");
  if (rid && s.seen.includes(rid)) return { ok: true, changed: false, dup: true, session: s };
  if (s.state === "discarded") return err("badState");
  const N = total(s);
  const fin = (next, entry) => done({ ...next, rev: s.rev + 1, updatedAt: now, log: pushLog(s.log, { t: now, u: ctx.user.id, ...entry }), seen: rid ? [...s.seen, rid].slice(-LIMITS.seen) : s.seen }, { event: entry.a });
  const needOpen = () => (s.state === "open" ? null : err("badState", { state: s.state }));
  switch (a.type) {
    case "setQuestion": case "next": case "prev": {
      const bad = needOpen(); if (bad) return bad;
      let idx = a.type === "next" ? s.index + 1 : a.type === "prev" ? s.index - 1 : a.index;
      if (!Number.isInteger(idx) || idx < 0 || idx > N) return err(a.type === "setQuestion" && !Number.isInteger(idx) ? "badInput" : "range", { index: idx });
      if (idx === s.index) return { ok: true, changed: false, session: s };
      return fin({ ...s, index: idx }, { a: "q", q: idx });
    }
    case "setAnswer": {
      const bad = needOpen(); if (bad) return bad;
      if (!isId(a.hero) || typeof a.q !== "string") return err("badInput");
      if (!heroIn(s, a.hero)) return err("unknownHero");
      const q = questions(!!s.askBad).find((x) => x.id === a.q); if (!q) return err("unknownQuestion");
      const v = a.value;
      if (v !== 0 && v !== 1 && v !== 2) return err("badInput");
      if (v === 2 && !q.flaw) return err("badInput", { why: "flaw2" });
      if (!canAnswer(ctx, s, a.hero, a.q)) {
        if (!staff && ctx.owns?.(a.hero) === true && cellOf(s, a.q, a.hero)?.g) return err("locked");
        if (!staff && ctx.owns?.(a.hero) === true && currentQuestion(s)?.id !== a.q) return err("notCurrent");
        return err("noPermission");
      }
      const old = cellOf(s, a.q, a.hero);
      const cell = staff ? { v, g: 1 } : { v };
      if (old && old.v === cell.v && !!old.g === !!cell.g) return { ok: true, changed: false, session: s };
      return fin({ ...s, answers: setCell(s.answers, a.q, a.hero, cell) }, { a: "ans", h: a.hero, q: a.q, v });
    }
    case "unlock": {
      const bad = needOpen(); if (bad) return bad;
      const c = isId(a.hero) && typeof a.q === "string" ? cellOf(s, a.q, a.hero) : null;
      if (!c) return err("unknownHero");
      if (!c.g) return { ok: true, changed: false, session: s };
      return fin({ ...s, answers: setCell(s.answers, a.q, a.hero, { v: c.v }) }, { a: "unlock", h: a.hero, q: a.q });
    }
    case "addHero": {
      if ((s.state !== "open" && s.state !== "closed") || s.award) return err("badState");
      const h = cleanHero(a.hero); if (!h) return err("badInput");
      if (heroIn(s, h.id)) return { ok: true, changed: false, session: s };
      if (s.heroes.length >= LIMITS.heroes) return err("tooMany");
      return fin({ ...s, heroes: [...s.heroes, h] }, { a: "add", h: h.id });
    }
    case "removeHero": {
      if ((s.state !== "open" && s.state !== "closed") || s.award) return err("badState");
      if (!isId(a.hero) || !heroIn(s, a.hero)) return err("unknownHero");
      if (s.heroes.length <= 1) return err("noHeroes");
      return fin({ ...s, heroes: s.heroes.filter((h) => h.id !== a.hero), answers: dropHero(s.answers, a.hero) }, { a: "rem", h: a.hero });
    }
    case "setAskBad": {
      const bad = needOpen(); if (bad) return bad;
      const v = a.value === true;
      if (v === !!s.askBad) return { ok: true, changed: false, session: s };
      const n = { ...s, askBad: v };
      return fin({ ...n, index: Math.min(s.index, total(n)) }, { a: "bad", v: v ? 1 : 0 });
    }
    case "close": {
      const bad = needOpen(); if (bad) return bad;
      return fin({ ...s, state: "closed", index: N }, { a: "close" });
    }
    case "reopen": {
      if (s.state !== "closed") return err("badState", { state: s.state });
      return fin({ ...s, state: "open" }, { a: "reopen" });
    }
    case "discard": {
      if (s.state === "awarded") return err("badState", { state: s.state });
      return fin({ ...s, state: "discarded" }, { a: "discard" });
    }
    case "awardBegin": {
      if (s.state !== "closed") return err("badState", { state: s.state });
      if (s.award && s.award.state !== "undone") return err("badState");
      const sm = summary(s);
      const n = (s.awards.length ? Math.max(...s.awards.map((x) => x.n)) : 0) + 1;
      const rows = sm.rows.map((r) => ({ h: r.hero, gain: r.gain, loss: r.loss, before: null, after: null, st: 0 }));
      return fin({ ...s, award: { n, state: "applying", at: now, by: ctx.user.id, rows } }, { a: "award.begin", n });
    }
    case "awardRow": {
      if (!s.award || s.award.state !== "applying") return err("badState");
      const row = s.award.rows.find((r) => r.h === a.hero); if (!row) return err("unknownHero");
      if (row.st === 1) return { ok: true, changed: false, session: s };
      const before = Number(a.before);
      if (!Number.isFinite(before) || before < 0) return err("badInput");
      const b = int(before, 0, LIMITS.karmaMax, 0), after = applyKarma(b, row.gain, row.loss);
      return fin({ ...s, award: { ...s.award, rows: s.award.rows.map((r) => (r === row ? { ...r, before: b, after, st: 1 } : r)) } }, { a: "award.row", h: row.h, d: after - b });
    }
    case "awardEnd": {
      if (!s.award || s.award.state !== "applying") return err("badState");
      if (s.award.rows.some((r) => r.st === 0) && a.partial !== true) return err("incomplete");
      return fin({ ...s, state: "awarded", award: { ...s.award, state: "done", doneAt: now } }, { a: "award.end" });
    }
    case "undoRow": {
      if (!s.award || (s.award.state !== "done" && s.award.state !== "undoing")) return err("badState");
      const row = s.award.rows.find((r) => r.h === a.hero); if (!row) return err("unknownHero");
      if (row.st === 2) return { ok: true, changed: false, session: s };
      if (row.st !== 1) return err("badState");
      return fin({ ...s, award: { ...s.award, state: "undoing", rows: s.award.rows.map((r) => (r === row ? { ...r, st: 2 } : r)) } }, { a: "undo.row", h: row.h });
    }
    case "undoEnd": {
      if (!s.award || (s.award.state !== "done" && s.award.state !== "undoing")) return err("badState");
      if (s.award.rows.some((r) => r.st === 1)) return { ...fin({ ...s, award: { ...s.award, state: "done" } }, { a: "undo.partial" }), partial: true };
      const rec = { n: s.award.n, at: s.award.at, undoneAt: now, rows: s.award.rows };
      return fin({ ...s, state: "closed", award: null, awards: [...s.awards, rec].slice(-LIMITS.awardHistory) }, { a: "undo.end" });
    }
    default: return err("badInput");
  }
}

/* ------------------------------------------------------------------ serialisation / hostile input */
const cleanAward = (aw, ids) => {
  if (!aw || typeof aw !== "object") return null;
  const rows = [];
  for (const r of Array.isArray(aw.rows) ? aw.rows : []) {
    if (!r || !isId(r.h) || !ids.has(r.h) || rows.some((x) => x.h === r.h) || rows.length >= LIMITS.heroes) continue;
    const st = int(r.st, 0, 2, 0);
    rows.push({ h: r.h, gain: int(r.gain, 0, 999, 0), loss: int(r.loss, 0, 999, 0), before: st ? int(r.before, 0, LIMITS.karmaMax, 0) : null, after: st ? int(r.after, 0, LIMITS.karmaMax, 0) : null, st });
  }
  const state = ["applying", "done", "undoing"].includes(aw.state) ? aw.state : "done";
  return { n: int(aw.n, 1, 9999, 1), state, at: int(aw.at, 0, 9e15, 0), by: isId(aw.by) ? aw.by : "", ...(aw.doneAt ? { doneAt: int(aw.doneAt, 0, 9e15, 0) } : {}), rows };
};
/** Any value (object or JSON string) -> a valid session or null. Never throws; unknown keys are dropped; ids/keys are validated (no prototype keys). */
export function sanitize(raw) {
  try {
    let o = raw;
    if (typeof raw === "string") { if (raw.length > LIMITS.bytes) return null; o = JSON.parse(raw); }
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    if (o.v !== SCHEMA || !isId(o.id) || !STATES.includes(o.state)) return null;
    const hs = [], seen = new Set();
    for (const h of Array.isArray(o.heroes) ? o.heroes : []) { const c = cleanHero(h); if (c && !seen.has(c.id) && hs.length < LIMITS.heroes) { seen.add(c.id); hs.push(c); } }
    if (!hs.length) return null;
    const askBad = o.askBad === true;
    const answers = {};
    if (o.answers && typeof o.answers === "object") {
      for (const qid of ALL_IDS) {
        if (!has(o.answers, qid) || !o.answers[qid] || typeof o.answers[qid] !== "object") continue;
        const row = {};
        for (const hid of Object.keys(o.answers[qid])) {
          if (!seen.has(hid) || BAD_KEYS.has(hid)) continue;
          const c = o.answers[qid][hid]; if (!c || typeof c !== "object") continue;
          let v = int(c.v, 0, 2, 0); if (v === 2 && qid !== FLAW_ID) v = 1;
          row[hid] = c.g ? { v, g: 1 } : { v };
        }
        if (Object.keys(row).length) answers[qid] = row;
      }
    }
    const N = askBad ? 16 : 10;
    const log = (Array.isArray(o.log) ? o.log : []).filter((e) => e && typeof e === "object").slice(-LIMITS.log).map((e) => ({ t: int(e.t, 0, 9e15, 0), u: isId(e.u) ? e.u : "", a: clampText(e.a, LIMITS.logNote), ...(isId(e.h) ? { h: e.h } : {}), ...(typeof e.q === "string" && (ALL_IDS.includes(e.q) || /^\d{1,2}$/.test(e.q)) ? { q: e.q } : Number.isInteger(e.q) ? { q: int(e.q, 0, 16, 0) } : {}), ...(Number.isFinite(e.v) ? { v: int(e.v, -999, 999, 0) } : {}), ...(Number.isFinite(e.d) ? { d: int(e.d, -99999, 99999, 0) } : {}), ...(Number.isFinite(e.n) ? { n: int(e.n, 0, 9999, 0) } : {}) }));
    const awards = (Array.isArray(o.awards) ? o.awards : []).slice(-LIMITS.awardHistory).map((x) => x && typeof x === "object" ? { n: int(x.n, 1, 9999, 1), at: int(x.at, 0, 9e15, 0), undoneAt: int(x.undoneAt, 0, 9e15, 0), rows: (Array.isArray(x.rows) ? x.rows : []).slice(0, LIMITS.heroes).filter((r) => r && isId(r.h)).map((r) => ({ h: r.h, gain: int(r.gain, 0, 999, 0), loss: int(r.loss, 0, 999, 0), before: r.before == null ? null : int(r.before, 0, LIMITS.karmaMax, 0), after: r.after == null ? null : int(r.after, 0, LIMITS.karmaMax, 0), st: int(r.st, 0, 2, 0) })) } : null).filter(Boolean);
    const out = { v: SCHEMA, id: o.id, state: o.state, startedAt: int(o.startedAt, 0, 9e15, 0), updatedAt: int(o.updatedAt, 0, 9e15, 0), rev: int(o.rev, 1, 9e15, 1), gm: isId(o.gm) ? o.gm : "", askBad, index: int(o.index, 0, N, 0), heroes: hs, answers, award: cleanAward(o.award, seen), awards, log, seen: (Array.isArray(o.seen) ? o.seen : []).filter((x) => typeof x === "string").map((x) => x.slice(0, 40)).slice(-LIMITS.seen) };
    if (out.award && out.state !== "awarded" && out.award.state !== "applying" && out.state !== "discarded") out.state = "awarded";
    if (out.state === "awarded" && !out.award) out.state = "closed";
    return out;
  } catch { return null; }
}
export const serialize = (s) => JSON.stringify(sanitize(s) ?? null);
export const parse = (str) => sanitize(str);
/** Ownership snapshot helper: which of the given heroes does a user own (used by tests and the GM side). */
export const ownedBy = (s, ctx) => (s?.heroes ?? []).filter((h) => ctx.owns?.(h.id) === true).map((h) => h.id);
