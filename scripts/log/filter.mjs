/* Activity log - filtering, search, grouping, counts (phase L2). PURE: no Foundry globals. Spec 6.1. */
import { categoryOf, severityOf, CATEGORIES } from "./events.mjs";

export const SESSION_GAP_MS = 4 * 3600 * 1000;
export const DAY_MS = 86400000;

/** Default filter: nothing selected, minor hidden, explained (h:1) rows hidden. */
export function defaultFilter() {
  return { cats: [], users: [], actors: [], from: null, to: null, roundFrom: null, roundTo: null, search: "", showMinor: false, onlyMine: false, includeHidden: false };
}

/* ------------------------------------------------------------------ text */
/** Lowercase, strip diacritics (Polish included) so "zolw" finds "żółw". */
export function fold(s) {
  return String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/ø/g, "o").replace(/đ/g, "d");
}
const blobCache = new WeakMap();
function collect(v, out, depth = 0) {
  if (v == null || depth > 6) return;
  if (typeof v === "string") out.push(v);
  else if (typeof v === "number" || typeof v === "boolean") out.push(String(v));
  else if (Array.isArray(v)) for (const x of v) collect(x, out, depth + 1);
  else if (typeof v === "object") for (const x of Object.values(v)) collect(x, out, depth + 1);
}
/** Lazily cached lowercase search blob of an entry (type id, all data values, optional extra text from the renderer). */
export function searchBlob(entry, extra = "") {
  let b = blobCache.get(entry);
  if (b === undefined) {
    const parts = [entry.k, entry.u];
    collect(entry.d, parts);
    b = fold(parts.join(" "));
    blobCache.set(entry, b);
  }
  return extra ? b + " " + fold(extra) : b;
}
export function matchesSearch(entry, query, ctx = {}) {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const userName = ctx.users && ctx.users[entry.u] ? ctx.users[entry.u] : "";
  const extra = (ctx.textOf ? ctx.textOf(entry) : "") + " " + userName;
  const blob = searchBlob(entry, extra);
  return terms.every((t) => blob.includes(t));
}

/* ------------------------------------------------------------------ time helpers */
export const defaultOffsetMin = () => -new Date().getTimezoneOffset();
export function dayStart(t, offsetMin = 0) { return Math.floor((t + offsetMin * 60000) / DAY_MS) * DAY_MS - offsetMin * 60000; }
export function dayKey(t, offsetMin = 0) { return new Date(t + offsetMin * 60000).toISOString().slice(0, 10); }

/** Sessions: runs of entries whose consecutive gaps are <= gap. Input need not be sorted. */
export function sessionsOf(entries, gap = SESSION_GAP_MS) {
  const ts = entries.map((e) => [e.t, e.t2 || e.t]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [t, t2] of ts) {
    const cur = out[out.length - 1];
    if (cur && t - cur.to <= gap) { cur.to = Math.max(cur.to, t2); cur.count++; }
    else out.push({ from: t, to: t2, count: 1 });
  }
  return out;
}
/** Date presets -> {from, to} (null = open). */
export function datePreset(name, now, entries = [], offsetMin = 0) {
  switch (name) {
    case "today": return { from: dayStart(now, offsetMin), to: null };
    case "yesterday": return { from: dayStart(now, offsetMin) - DAY_MS, to: dayStart(now, offsetMin) - 1 };
    case "7days": return { from: now - 7 * DAY_MS, to: null };
    case "lastSession": { const s = sessionsOf(entries); const l = s[s.length - 1]; return l ? { from: l.from, to: null } : { from: null, to: null }; }
    default: return { from: null, to: null };
  }
}

/* ------------------------------------------------------------------ filtering */
/** Does an entry pass the filter? ctx: {scope, userId, users, textOf}. */
export function matches(entry, f, ctx = {}) {
  if (entry.h && !f.includeHidden) return false;
  if (!f.showMinor && severityOf(entry.k) === 0) return false;
  if (f.cats && f.cats.length && !f.cats.includes(categoryOf(entry.k, entry.sc || ctx.scope || "hero"))) return false;
  if (f.actors && f.actors.length && !f.actors.includes(entry.aid)) return false;     // merged Table log only: entries carry `aid` (actor / log id) and `sc` (hero | base)
  if (f.users && f.users.length && !f.users.includes(entry.u)) return false;
  if (f.from != null && (entry.t2 || entry.t) < f.from) return false;
  if (f.to != null && entry.t > f.to) return false;
  if (f.roundFrom != null || f.roundTo != null) {
    const r = entry.c && entry.c.r;
    if (r == null) return false;
    if (f.roundFrom != null && r < f.roundFrom) return false;
    if (f.roundTo != null && r > f.roundTo) return false;
  }
  if (f.onlyMine && entry.u !== ctx.userId) return false;
  if (f.search && !matchesSearch(entry, f.search, ctx)) return false;
  return true;
}
export function filterEntries(entries, f, ctx = {}) {
  const flt = { ...defaultFilter(), ...f };
  const out = [];
  for (const e of entries) if (matches(e, flt, ctx)) out.push(e);
  return out;
}

/** Counts per category under every filter EXCEPT the category chips (so chips show what each would add). */
export function countsByCategory(entries, f, ctx = {}) {
  const flt = { ...defaultFilter(), ...f, cats: [] };
  const scope = ctx.scope || "hero";
  const cats = {};
  for (const c of CATEGORIES[scope] || CATEGORIES.hero) cats[c] = 0;
  let all = 0;
  for (const e of entries) {
    if (!matches(e, flt, ctx)) continue;
    all++;
    const c = categoryOf(e.k, e.sc || scope);
    cats[c] = (cats[c] || 0) + 1;
  }
  return { all, cats };
}
/** Counts per actor under every filter EXCEPT the actor chips (merged Table log). Returns Map(aid -> n). */
export function countsByActor(entries, f, ctx = {}) {
  const flt = { ...defaultFilter(), ...f, actors: [] };
  const out = new Map();
  for (const e of entries) if (matches(e, flt, ctx)) out.set(e.aid, (out.get(e.aid) || 0) + 1);
  return out;
}
export function usersOf(entries) {
  const m = new Map();
  for (const e of entries) m.set(e.u, (m.get(e.u) || 0) + 1);
  return [...m].map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n || (a.id < b.id ? -1 : 1));
}
/** Round bounds of the loaded log, or null when there is no combat context (the round filter is then hidden). */
export function roundBounds(entries) {
  let lo = null, hi = null;
  for (const e of entries) { const r = e.c && e.c.r; if (r == null) continue; lo = lo === null ? r : Math.min(lo, r); hi = hi === null ? r : Math.max(hi, r); }
  return lo === null ? null : { min: lo, max: hi };
}

/* ------------------------------------------------------------------ grouping */
/** Group by local day. order "desc" (default, newest first) or "asc". Each item: {entry, sessionBreak, gapMs} where sessionBreak = gap to the
 *  chronologically previous entry in the given list exceeds the session gap. Day labels: "today" | "yesterday" | "date". */
export function groupByDay(entries, opts = {}) {
  const offsetMin = opts.offsetMin ?? 0, now = opts.now ?? Date.now(), gap = opts.sessionGapMs ?? SESSION_GAP_MS;
  const asc = entries.slice().sort((a, b) => (a.t - b.t) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const items = [];
  let prevEnd = null;
  for (const e of asc) {
    const gapMs = prevEnd === null ? null : e.t - prevEnd;
    items.push({ entry: e, gapMs, sessionBreak: gapMs !== null && gapMs > gap });
    prevEnd = Math.max(prevEnd ?? 0, e.t2 || e.t);
  }
  const days = [];
  const today = dayKey(now, offsetMin), yesterday = dayKey(now - DAY_MS, offsetMin);
  for (const it of items) {
    const key = dayKey(it.entry.t, offsetMin);
    let g = days[days.length - 1];
    if (!g || g.key !== key) {
      g = { key, start: dayStart(it.entry.t, offsetMin), label: key === today ? "today" : key === yesterday ? "yesterday" : "date", count: 0, items: [] };
      days.push(g);
    }
    g.items.push(it); g.count++;
  }
  if (opts.order !== "asc") { days.reverse(); for (const g of days) g.items.reverse(); }
  return days;
}
