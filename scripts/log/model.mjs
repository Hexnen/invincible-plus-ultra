/* Activity log - entry model (phase L2). PURE: no Foundry globals. Spec sections 3.2, 3.4 (7), 3.5. */
import { typeDef, inScope, MOD_ID } from "./events.mjs";

export const CHUNK_ENTRIES = 250;
export const CHUNK_BYTES = 80 * 1024;
export const ENTRY_MAX_BYTES = 8192;
export const TEXT_MAX = 1000;
export const ENTRY_FLAG_BASE = `flags.${MOD_ID}.log.e`;

/* ------------------------------------------------------------------ hashing / ids */
/** FNV-1a 32 bit over a string. */
export function fnv32(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
/** 3 base-36 chars of the hash. */
export function hash3(str) { return (fnv32(str) % 46656).toString(36).padStart(3, "0"); }

/** Deterministic entry id: time (sortable) + 3 hash chars. Same inputs always give the same id (idempotent double write). */
export function makeId(t, actorId, k, path, u) {
  const tt = Math.max(0, Math.floor(Number(t) || 0));
  return tt.toString(36).padStart(9, "0") + hash3(`${actorId}|${k}|${path || ""}|${u || ""}`);
}
export function isValidId(id) { return typeof id === "string" && /^[0-9a-z]{9}[0-9a-z]{3}$/.test(id); }
export function idTime(id) { return isValidId(id) ? parseInt(id.slice(0, 9), 36) : NaN; }

export function compareEntries(a, b) {
  if (a.t !== b.t) return a.t < b.t ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
export function sortEntries(list) { return list.slice().sort(compareEntries); }

/* ------------------------------------------------------------------ sanitising */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
export function clampText(s, n = TEXT_MAX) {
  const str = typeof s === "string" ? s : s == null ? "" : String(s);
  return str.length > n ? str.slice(0, n) : str;
}
/** Deep sanitise a data object: finite numbers, clamped strings, bounded depth / array / key counts, no prototype keys. */
export function sanitize(v, depth = 0, opts = {}) {
  const maxText = opts.maxText || TEXT_MAX;
  if (v == null) return v === undefined ? undefined : null;
  const t = typeof v;
  if (t === "string") return clampText(v, maxText);
  if (t === "number") return Number.isFinite(v) ? v : null;
  if (t === "boolean") return v;
  if (t === "function" || t === "symbol" || t === "bigint") return undefined;
  if (depth >= 6) return undefined;
  if (Array.isArray(v)) {
    const out = [];
    for (const x of v.slice(0, 100)) { const s = sanitize(x, depth + 1, opts); out.push(s === undefined ? null : s); }
    return out;
  }
  if (t === "object") {
    const out = {};
    let n = 0;
    for (const key of Object.keys(v)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      if (++n > 60) break;
      const s = sanitize(v[key], depth + 1, opts);
      if (s !== undefined) out[clampText(key, 64)] = s;
    }
    return out;
  }
  return undefined;
}
export function byteSize(v) {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  let n = 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xd800 && c < 0xdc00) ? (i++, 4) : 3; }
  return n;
}
/** Shrink arrays inside d until the entry fits ENTRY_MAX_BYTES; as a last resort drop d and flag it. */
function fit(entry) {
  let guard = 0;
  while (byteSize(entry) > ENTRY_MAX_BYTES && guard++ < 12) {
    let shrunk = false;
    const halve = (o) => {
      for (const key of Object.keys(o)) {
        if (Array.isArray(o[key]) && o[key].length > 1) { o[key] = o[key].slice(0, Math.ceil(o[key].length / 2)); shrunk = true; o.more = (o.more || 0) + 1; }
        else if (o[key] && typeof o[key] === "object" && !Array.isArray(o[key])) halve(o[key]);
      }
    };
    halve(entry.d);
    if (!shrunk) { entry.d = {}; entry.tr = 1; break; }
  }
  if (byteSize(entry) > ENTRY_MAX_BYTES) { entry.d = {}; entry.tr = 1; }
  return entry;
}

/* ------------------------------------------------------------------ normalise / validate */
const intOrUndef = (x) => (Number.isFinite(x) ? Math.floor(x) : undefined);

/** Normalise a raw entry-like object. opts: {actorId, path, now}. Returns a new plain entry or null when it is not an object. */
export function normalizeEntry(raw, opts = {}) {
  if (!raw || typeof raw !== "object") return null;
  const t = Number.isFinite(raw.t) ? Math.floor(raw.t) : Number.isFinite(opts.now) ? Math.floor(opts.now) : NaN;
  const e = {
    id: typeof raw.id === "string" ? raw.id : undefined,
    t,
    u: typeof raw.u === "string" ? clampText(raw.u, 32) : "",
    k: typeof raw.k === "string" ? raw.k : "",
    d: raw.d && typeof raw.d === "object" && !Array.isArray(raw.d) ? sanitize(raw.d) : {}
  };
  const t2 = intOrUndef(raw.t2); if (t2 !== undefined && t2 > t) e.t2 = t2;
  const n = intOrUndef(raw.n); if (n !== undefined && n > 1) e.n = Math.min(n, 1e6);
  if (raw.c && typeof raw.c === "object") {
    const c = {};
    if (typeof raw.c.i === "string") c.i = clampText(raw.c.i, 32);
    const r = intOrUndef(raw.c.r); if (r !== undefined) c.r = r;
    const tn = intOrUndef(raw.c.tn); if (tn !== undefined) c.tn = tn;
    if (Object.keys(c).length) e.c = c;
  }
  { const def = typeof raw.k === "string" ? typeDef(raw.k) : null; if (raw.v || (def && def.vis === "G")) e.v = 1; }   // GM-only types (registry vis "G") are secret whatever the caller passed
  if (typeof raw.g === "string" && raw.g) e.g = clampText(raw.g, 16);
  if (raw.a) e.a = 1;
  if (raw.h) e.h = 1;
  if (raw.rel) e.rel = 1;
  if (raw.tr) e.tr = 1;
  if (!e.id && Number.isFinite(t) && e.k) e.id = makeId(t, opts.actorId || "", e.k, opts.path || "", e.u);
  fit(e);
  return e;
}

/** Validation errors are message KEYS (translated by the UI): IPL.Val.<code>. */
export function validateEntry(e, scope = "hero") {
  const errors = [];
  const err = (code, field) => errors.push({ key: `IPL.Val.${code}`, field });
  if (!e || typeof e !== "object") { err("notObject", ""); return { ok: false, errors }; }
  if (typeof e.k !== "string" || !e.k) err("noType", "k");
  else if (!typeDef(e.k)) err("badType", "k");
  else if (!inScope(e.k, scope)) err("badScope", "k");
  if (!Number.isFinite(e.t) || e.t <= 0) err("badTime", "t");
  if (typeof e.u !== "string") err("noUser", "u");
  if (!isValidId(e.id)) err("badId", "id");
  else if (Number.isFinite(e.t) && idTime(e.id) !== e.t) err("badId", "id");
  if (!e.d || typeof e.d !== "object" || Array.isArray(e.d)) err("badData", "d");
  else {
    const def = typeDef(e.k);
    if (def) for (const f of def.req) if (e.d[f] === undefined) err("missing", `d.${f}`);
  }
  if (byteSize(e) > ENTRY_MAX_BYTES) err("tooBig", "");
  return { ok: errors.length === 0, errors };
}

/** Convenience: build a complete entry from a draft {k, d, t, u, ...} in one call. Returns {entry, errors}. */
export function buildEntry(draft, opts = {}) {
  const entry = normalizeEntry(draft, opts);
  if (!entry) return { entry: null, errors: [{ key: "IPL.Val.notObject", field: "" }] };
  const v = validateEntry(entry, opts.scope || "hero");
  return { entry, errors: v.errors };
}

/* ------------------------------------------------------------------ merge / patch */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a == null || b == null || typeof a !== "object") return typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false; return true; }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) { if (!Object.prototype.hasOwnProperty.call(b, k) || !deepEqual(a[k], b[k])) return false; }
  return true;
}
export function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

function mergeData(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b)) {
    if (FORBIDDEN_KEYS.has(k)) continue;
    if (b[k] === null) delete out[k];
    else if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) out[k] = mergeData(out[k], b[k]);
    else out[k] = clone(b[k]);
  }
  return out;
}
/** Apply a patch to an entry: `d` is deep-merged (null deletes a key), other keys replace (null / undefined removes the flag). The id is never changed. */
export function patchEntry(entry, patch) {
  const out = clone(entry);
  for (const k of Object.keys(patch || {})) {
    if (k === "id" || FORBIDDEN_KEYS.has(k)) continue;
    if (k === "d") out.d = mergeData(out.d || {}, patch.d || {});
    else if (patch[k] === null || patch[k] === undefined) delete out[k];
    else out[k] = clone(patch[k]);
  }
  return out;
}
/** Deterministic, commutative pick between two versions of the same entry id (more coalesced edits win, then the later one, then lexicographic). */
export function mergeEntry(a, b) {
  if (!a) return b; if (!b) return a;
  const na = a.n || 1, nb = b.n || 1;
  if (na !== nb) return na > nb ? a : b;
  const ta = a.t2 || a.t, tb = b.t2 || b.t;
  if (ta !== tb) return ta > tb ? a : b;
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  return sa >= sb ? a : b;
}
/** Merge two id-keyed maps. */
export function mergeEntryMaps(a, b) {
  const out = { ...a };
  for (const id of Object.keys(b || {})) out[id] = mergeEntry(out[id], b[id]);
  return out;
}

/* ------------------------------------------------------------------ pages / chunks */
export const pad4 = (n) => String(n).padStart(4, "0");
/** Page name of chunk `no`; secret journal pages are prefixed with the actor id. */
export function chunkName(no, actorId) { return (actorId ? `${actorId}.` : "") + "c" + pad4(no); }
export function parseChunkName(name) {
  const m = /^(?:([^.]+)\.)?c(\d{4,})$/.exec(String(name || ""));
  return m ? { actorId: m[1] || null, no: parseInt(m[2], 10) } : null;
}
/** Update path for one entry inside a page (partial diff write). */
export function entryPath(id) { return `${ENTRY_FLAG_BASE}.${id}`; }
export function emptyPage(no) { return { v: 1, no, n: 0, first: 0, last: 0, bytes: 0, e: {} }; }

/** Add (or overwrite, idempotent) an entry in a page object; returns a new page. Byte count is kept incrementally (an overwrite recomputes). */
export function pageWith(page, entry) {
  const old = page.e || {};
  const existed = Object.prototype.hasOwnProperty.call(old, entry.id);
  const e = { ...old, [entry.id]: entry };
  const tl = entry.t2 || entry.t;
  let first, last, bytes;
  if (existed) {
    const vals = Object.values(e);
    first = Math.min(...vals.map((x) => x.t)); last = Math.max(...vals.map((x) => x.t2 || x.t)); bytes = byteSize(e);
  } else {
    const empty = Object.keys(old).length === 0;
    first = empty ? entry.t : Math.min(page.first || entry.t, entry.t);
    last = empty ? tl : Math.max(page.last || 0, tl);
    bytes = (page.bytes || 0) + byteSize(entry) + 1;
  }
  return { ...page, e, n: Object.keys(e).length, first, last, bytes };
}
export function pageStats(page) { return { n: Object.keys(page.e || {}).length, bytes: byteSize(page.e || {}) }; }

/** Build an id -> chunk no index from {no: page} maps. */
export function buildIndex(pages) {
  const idx = new Map();
  for (const [no, p] of Object.entries(pages)) for (const id of Object.keys(p.e || {})) idx.set(id, Number(no));
  return idx;
}

/** Plan a batch write. state = {head, pages:{no:page}}; entries to write. Entries whose id already exists are rewritten in their own page (patch / idempotent);
 *  new ones go to the head page, rotating when it holds >= 250 entries or would pass 80 KB. Returns {head, pages(new), touched:[no], created:[no], added, rewritten}. */
export function planWrite(state, entries, limits = {}) {
  const maxN = limits.maxEntries || CHUNK_ENTRIES, maxB = limits.maxBytes || CHUNK_BYTES;
  const pages = { ...(state.pages || {}) };
  let head = state.head || 1;
  if (!pages[head]) pages[head] = emptyPage(head);
  const idx = buildIndex(pages);
  const touched = new Set(), created = new Set(); let added = 0, rewritten = 0;
  for (const entry of entries) {
    const known = idx.get(entry.id);
    if (known !== undefined) {
      pages[known] = pageWith(pages[known], entry); idx.set(entry.id, known); touched.add(known); rewritten++;
      continue;
    }
    let p = pages[head];
    const sz = byteSize(entry);
    if (Object.keys(p.e).length >= maxN || (Object.keys(p.e).length > 0 && (p.bytes || byteSize(p.e)) + sz > maxB)) {
      head += 1; pages[head] = emptyPage(head); created.add(head); p = pages[head];
    }
    pages[head] = pageWith(p, entry); idx.set(entry.id, head); touched.add(head); added++;
  }
  return { head, pages, touched: [...touched].sort((a, b) => a - b), created: [...created], added, rewritten };
}

/** Merge several page objects into one array sorted by (t,id); duplicates by id are merged with mergeEntry. */
export function readAll(pages) {
  const map = {};
  for (const p of Object.values(pages)) for (const [id, e] of Object.entries(p.e || {})) map[id] = mergeEntry(map[id], e);
  return sortEntries(Object.values(map));
}
export function totalCount(pages) { let n = 0; for (const p of Object.values(pages)) n += Object.keys(p.e || {}).length; return n; }
