/* End-of-session panel, phase S2: PURE helpers of the data layer (no Foundry globals; tested in check-session.mjs): request validation for the relay,
   rate limiting, ownership from a table, the default roster, flag pruning, the book parser (our own regex, no DOM), karma update patches. */
import * as P from "./pure.mjs";

export const PROTO = 1;                       // relay protocol number: bump when a request's meaning changes (older GM tabs answer "stale")
export const REQ_MAX_BYTES = 2048;            // non-staff request size cap (spec 3)
export const STAFF_MAX_BYTES = 16384;
export const RATE = Object.freeze([60, 60000]);          // non-staff: 60 requests per minute and user
export const CHANGE_RATE = Object.freeze([24, 60000]);   // non-staff: at most 24 CHANGING answers per minute and user (each one costs the GM a write and a settle delay)
export const MAX_INFLIGHT = 3;                           // non-staff: requests of one user that may wait in the GM queue at once; the rest is dropped early
export const PLAYER_ACTS = Object.freeze(["setAnswer"]);
export const STAFF_ACTS = Object.freeze(["setQuestion", "next", "prev", "setAnswer", "unlock", "removeHero", "setAskBad", "close", "reopen"]);
export const STAFF_CMDS = Object.freeze(["start", "addHero", "award", "undo", "discard", "dismiss", "postSummary"]);
export const KEEP_AWARD_FLAGS = 5;
export const ARCHIVE_MAX = 20;

const has = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
const bad = (code, params = {}) => ({ ok: false, error: { key: `IPL.Session.err.${code}`, code, params } });
export const fail = bad;

/** Ownership from the explicit table only (the GM ROLE of a claimed id never counts): owner level 3 by default. */
export function ownsFrom(ownership, userId, ownerLevel = 3) {
  const o = ownership && typeof ownership === "object" ? ownership : {};
  const lvl = has(o, userId) ? o[userId] : o.default;
  return Number(lvl ?? 0) >= ownerLevel;
}

/** Sliding window limiter: true = admitted. map = Map<key, number[]>. */
export function rateHit(map, key, now, max = RATE[0], win = RATE[1]) {
  const arr = (map.get(key) ?? []).filter((t) => now - t < win);
  if (arr.length >= max) { map.set(key, arr); return false; }
  arr.push(now); map.set(key, arr);
  if (map.size > 500) for (const [k, v] of map) if (!v.some((t) => now - t < win)) map.delete(k);
  return true;
}

/** Number of timestamps still inside the window (does not add one). */
export function rateCount(map, key, now, win = RATE[1]) { return (map.get(key) ?? []).filter((t) => now - t < win).length; }
/** Valid ids of a list, or null when there are more than `max` (S4-10: the caller refuses instead of truncating). */
const idList = (v, max = P.LIMITS.heroes) => { const ids = [...new Set((Array.isArray(v) ? v : []).filter(P.isId))]; return ids.length > max ? null : ids; };
const str = (v, n = 40) => (typeof v === "string" ? v.slice(0, n) : "");
const opt = (o) => { const r = {}; for (const k of Object.keys(o)) if (o[k] !== undefined) r[k] = o[k]; return r; };

/** Validate and NORMALISE a request ({id, act:{type,...}} or {id, cmd:"name", args:{}}). Only whitelisted fields survive, so no payload can smuggle a rid,
    a user id, a `before` value or any other reducer input. Players: only setAnswer. Returns { ok, kind, act|cmd,args } or { ok:false, error }. */
export function normalizeRequest(req, { staff = false } = {}) {
  if (!req || typeof req !== "object" || Array.isArray(req)) return bad("badInput");
  let size = 0; try { size = JSON.stringify(req).length; } catch { return bad("badInput"); }
  if (size > (staff ? STAFF_MAX_BYTES : REQ_MAX_BYTES)) return bad("tooBig", { bytes: size });
  if (req.act !== undefined && req.cmd !== undefined) return bad("badInput");
  if (req.act !== undefined) {
    const a = req.act;
    if (!a || typeof a !== "object" || typeof a.type !== "string") return bad("badInput");
    if (!(staff ? STAFF_ACTS : PLAYER_ACTS).includes(a.type)) return bad(STAFF_ACTS.includes(a.type) || STAFF_CMDS.includes(a.type) || P.STAFF_ONLY.has(a.type) ? "noPermission" : "badInput");
    switch (a.type) {
      case "setAnswer": return { ok: true, kind: "act", act: { type: "setAnswer", hero: str(a.hero), q: str(a.q, 10), value: a.value } };
      case "unlock": return { ok: true, kind: "act", act: { type: "unlock", hero: str(a.hero), q: str(a.q, 10) } };
      case "removeHero": return { ok: true, kind: "act", act: { type: "removeHero", hero: str(a.hero) } };
      case "setQuestion": return { ok: true, kind: "act", act: { type: "setQuestion", index: a.index } };
      case "setAskBad": return { ok: true, kind: "act", act: { type: "setAskBad", value: a.value === true } };
      default: return { ok: true, kind: "act", act: { type: a.type } };
    }
  }
  if (req.cmd !== undefined) {
    if (!staff) return bad("noPermission");
    const c = req.cmd, g = req.args && typeof req.args === "object" ? req.args : {};
    if (typeof c !== "string" || !STAFF_CMDS.includes(c)) return bad("badInput");
    switch (c) {
      case "start": { const ids = g.heroes === undefined ? undefined : idList(g.heroes); if (ids === null) return bad("tooMany", { max: P.LIMITS.heroes }); return { ok: true, kind: "cmd", cmd: c, args: opt({ heroes: ids, askBad: g.askBad === true, includeGm: g.includeGm === true }) }; }
      case "addHero": return { ok: true, kind: "cmd", cmd: c, args: { hero: str(g.hero) } };
      case "award": return { ok: true, kind: "cmd", cmd: c, args: { chat: typeof g.chat === "boolean" ? g.chat : undefined, _failAt: undefined } };
      case "undo": return { ok: true, kind: "cmd", cmd: c, args: { mode: g.mode === "relative" ? "relative" : "strict" } };
      default: return { ok: true, kind: "cmd", cmd: c, args: {} };
    }
  }
  return bad("badInput");
}

/** Request id the GM side gives a reducer action: namespaced with the VERIFIED sender, so nobody can pre-poison another user's dedupe slot. */
export const makeRid = (senderId, reqId) => `${String(senderId).slice(0, 18)}:${String(reqId ?? "").replace(/[^\w-]/g, "").slice(0, 20)}`.slice(0, 40);

/** Default roster: superhero actors that are not team cards and (unless includeGm) have a player owner. actors = [{id,name,img,type,card,playerOwned}]. */
export function defaultRoster(actors, { includeGm = false } = {}) {
  return (actors ?? []).filter((a) => a && a.type === "superhero" && !a.card && (includeGm || a.playerOwned)).map((a) => ({ id: a.id, name: a.name, img: a.img }));
}
/** Does anybody who is not a GM own this actor (explicit OWNER entry or default OWNER)? users = [{id, isGM}]. */
export function playerOwned(ownership, users, ownerLevel = 3) {
  const o = ownership && typeof ownership === "object" ? ownership : {};
  if (Number(o.default ?? 0) >= ownerLevel) return true;
  return (users ?? []).some((u) => u && !u.isGM && has(o, u.id) && Number(o[u.id]) >= ownerLevel);
}

/** Keys of `sessionAwards` flags to delete so that at most `keep` remain (newest by `at`; keepKey is never deleted). */
export function pruneAwardFlags(flags, keepKey, keep = KEEP_AWARD_FLAGS) {
  const rows = Object.entries(flags && typeof flags === "object" ? flags : {}).filter(([k, v]) => k !== keepKey && v && typeof v === "object").sort((a, b) => (Number(b[1].at) || 0) - (Number(a[1].at) || 0));
  return rows.slice(Math.max(0, keep - 1)).map(([k]) => k);
}
/** The ONE actor update that applies a karma award: karma + the idempotence marker (+ pruned old markers). `del` = factory of the v14 ForcedDeletion operator (the legacy "-=key" syntax is deprecated in v14 and used when no factory is given). */
export function awardUpdate(mod, key, before, after, at, prune = [], del = null) {
  const d = { "system.karma": after, [`flags.${mod}.sessionAwards.${key}`]: { before, after, at } };
  for (const k of prune) { if (del) d[`flags.${mod}.sessionAwards.${k}`] = del(); else d[`flags.${mod}.sessionAwards.-=${k}`] = null; }
  return d;
}
/** The ONE actor update that takes a row back: karma restored + marker removed. */
export const undoUpdate = (mod, key, restoreTo, del = null, withMarker = true) => {
  const d = { "system.karma": restoreTo };
  if (withMarker) { if (del) d[`flags.${mod}.sessionAwards.${key}`] = del(); else d[`flags.${mod}.sessionAwards.-=${key}`] = null; }
  return d;
};
/** Is a pre-existing applied marker believable for this row (S4-11)? It must be bound to the award record: after == applyKarma(before, gain, loss). */
export const markerConsistent = (flag, row) => !!flag && typeof flag === "object" && Number.isFinite(Number(flag.before)) && Number.isFinite(Number(flag.after))
  && Math.trunc(Number(flag.after)) === P.applyKarma(Math.max(0, Math.trunc(Number(flag.before))), row?.gain, row?.loss);

/** Archive entry list normaliser: accepts the stored JSON string, returns [{ at, reason, session }] (max 20, sessions re-sanitised, no log/seen). */
export function parseArchive(raw) {
  try {
    const arr = typeof raw === "string" ? (raw ? JSON.parse(raw) : []) : raw;
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const e of arr) {
      const s = P.sanitize(e?.session);
      if (!s) continue;
      out.push({ at: Number.isFinite(e.at) ? e.at : 0, reason: ["discarded", "awarded"].includes(e.reason) ? e.reason : "awarded", session: { ...s, log: [], seen: [] } });
    }
    return out.slice(-ARCHIVE_MAX);
  } catch { return []; }
}
/** Push a finished session on the archive (same id replaces the older copy), keep the newest 20. */
export function pushArchive(list, session, reason, at) {
  const s = P.sanitize(session);
  const base = (list ?? []).filter((e) => e.session.id !== session?.id);
  if (!s) return base.slice(-ARCHIVE_MAX);
  return [...base, { at, reason: reason === "discarded" ? "discarded" : "awarded", session: { ...s, log: [], seen: [] } }].slice(-ARCHIVE_MAX);
}

/* ------------------------------------------------------------------ the book (runtime text only; nothing here contains book text) */
const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&apos;": "'", "&nbsp;": " ", "&rsquo;": "’", "&lsquo;": "‘", "&ldquo;": "“", "&rdquo;": "”" };
const decode = (s) => s.replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Math.min(0x10ffff, Number(n)))).replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(Math.min(0x10ffff, parseInt(n, 16)))).replace(/&[a-z]+;|&#39;/gi, (m) => ENT[m.toLowerCase()] ?? m);
const plain = (html) => P.clampText(decode(String(html).replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@UUID\[[^\]]*\]/g, "").replace(/<[^>]*>/g, " ")), 300);
/** Parse the page HTML: a list under a heading "Karma" (ten items) and one under "Bad Karma" (six). Each list is accepted only when its length is right. */
export function parseBook(html) {
  const out = { good: null, bad: null };
  try {
    const src = String(html ?? "");
    if (src.length > 400000) return out;
    const parts = src.split(/<h2[^>]*>/i);
    for (const part of parts.slice(1)) {
      const end = part.search(/<\/h2>/i);
      if (end < 0) continue;
      const title = plain(part.slice(0, end)), body = part.slice(end + 5);
      const ul = /<ul[^>]*>([\s\S]*?)<\/ul>/i.exec(body);
      if (!ul) continue;
      const items = [...ul[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => plain(m[1])).filter(Boolean);
      if (/^bad\s+karma$/i.test(title) && !out.bad && items.length === P.BAD.length) out.bad = items;
      else if (/^karma$/i.test(title) && !out.good && items.length === P.GOOD.length) out.good = items;
    }
  } catch { /* hostile / odd page: report nothing, the caller falls back to our labels */ }
  return out;
}
