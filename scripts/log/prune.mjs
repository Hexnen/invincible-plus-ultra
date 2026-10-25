/* Activity log - retention, pruning, redaction (phase L2). PURE: no Foundry globals. Spec 3.5. */
import { makeId, pageWith, emptyPage, clone, totalCount, entriesOf, isEntryLike } from "./model.mjs";

const nz = (v) => (Number.isFinite(v) ? v : 0);
const sortedNos = (pages) => Object.keys(pages).map(Number).sort((a, b) => a - b);

/** Summaries of pages: [{no, n, first, last}] oldest first. */
export function summarizePages(pages) {
  return sortedNos(pages).map((no) => {
    const p = pages[no];
    const ts = entriesOf(p);
    return { no, n: ts.length, first: ts.length ? Math.min(...ts.map((e) => e.t)) : 0, last: ts.length ? Math.max(...ts.map((e) => e.t2 || e.t)) : 0 };
  });
}
/** Status vs a cap (0 = unlimited). */
export function retentionStatus(count, cap) {
  if (!cap) return { cap: 0, count, over: false, ratio: 0, warn: false };
  return { cap, count, over: count > cap, ratio: count / cap, warn: count >= cap * 0.9 };
}

/** Time key of a page for the drop order: the oldest real entry (markers and unusable values ignored), never later than `now` (a page full of future-dated
 *  imported entries must not look "newest"). Pages are dropped by this key, not by their number (L8: an import lands in side pages of its own). */
function pageKey(page, now) {
  const es = entriesOf(page).filter((e) => e.k !== "log.prune");
  const all = es.length ? es : entriesOf(page);
  let f = all.length ? Math.min(...all.map((e) => e.t)) : nz(page && page.first);
  if (Number.isFinite(now)) f = Math.min(f, now);
  return f;
}

/** Plan a prune: delete the OLDEST WHOLE chunks (by time, never the head, never the only page) while total > cap.
 *  `secret` = optional {no: page} of the GM-only journal for the same actor: a secret chunk is dropped only when ALL its entries are older than the oldest KEPT public
 *  entry (L8: it used to compare with the newest dropped entry, so one forged far-future entry in a dropped chunk wiped every secret page).
 *  Returns null when nothing to do, else {dropPages, dropSecret, removed (public entries), secretRemoved, first, last, marker}. The marker folds in any
 *  earlier log.prune markers that sit in dropped pages, so the running total survives. */
export function planPrune(pages, opts = {}) {
  const cap = opts.cap | 0;
  if (cap <= 0) return null;
  const nos = sortedNos(pages);
  const head = opts.head ?? nos[nos.length - 1];
  let total = totalCount(pages);
  if (total <= cap) return null;
  const keyOf = new Map(nos.map((no) => [no, pageKey(pages[no], opts.now)]));
  const order = nos.slice().sort((a, b) => (keyOf.get(a) - keyOf.get(b)) || (a - b));
  const drop = [];
  for (const no of order) {
    if (total <= cap) break;
    if (no === head) continue;
    if (nos.length - drop.length <= 1) break;
    drop.push(no); total -= Object.keys(pages[no].e || {}).length;
  }
  if (!drop.length) return null;
  drop.sort((a, b) => a - b);
  let removed = 0, first = Infinity, last = 0, priorTimes = 0;
  for (const no of drop) {
    for (const e of entriesOf(pages[no])) {
      if (e.k === "log.prune") { removed += nz(e.d && e.d.removed); first = Math.min(first, nz(e.d && e.d.first) || e.t); last = Math.max(last, nz(e.d && e.d.last)); priorTimes += nz(e.d && e.d.times) || 1; }
      else { removed += 1; first = Math.min(first, e.t); last = Math.max(last, e.t2 || e.t); }
    }
  }
  if (!Number.isFinite(first)) first = 0;
  const dropSet = new Set(drop);
  let firstKept = Infinity;
  for (const no of nos) if (!dropSet.has(no)) for (const e of entriesOf(pages[no])) if (e.k !== "log.prune") firstKept = Math.min(firstKept, e.t);
  const markerT = Number.isFinite(firstKept) ? Math.max(1, firstKept - 1) : last + 1;
  const marker = {
    actorId: opts.actorId || "", k: "log.prune", path: "prune", u: "", t: markerT,
    d: { removed, first, last, times: priorTimes + 1 }
  };
  marker.id = makeId(marker.t, marker.actorId, marker.k, marker.path, marker.u);
  const dropSecret = [];
  let secretRemoved = 0;
  if (opts.secret) {
    const cut = Number.isFinite(firstKept) && firstKept <= last ? firstKept - 1 : last;       // a forged / skewed "last" can never reach past the oldest kept entry
    for (const no of sortedNos(opts.secret)) {
      const es = entriesOf(opts.secret[no]);
      if (es.length && es.every((e) => (e.t2 || e.t) <= cut)) { dropSecret.push(no); secretRemoved += es.length; }
    }
  }
  return { dropPages: drop, dropSecret, removed, secretRemoved, first, last, marker, keep: total };
}

/** Entries that arrived through the relay (flag `rel`: notes, queued player records) are the ones a user can mass-produce. They get a protected budget of their own:
 *  when they exceed `noteCap` the OLDEST of them go first (down to `keepTo`), so a flood never pushes server-attested history out through the chunk prune.
 *  Returns null, or {byPage: {no: [ids]}, removed, first, last, marker} (the marker says how many were dropped and over which time span). */
export function planNoteTrim(pages, opts = {}) {
  const noteCap = opts.noteCap | 0;
  if (noteCap <= 0) return null;
  const list = [];
  for (const no of sortedNos(pages)) for (const [id, e] of Object.entries(pages[no].e || {})) if (isEntryLike(e) && e.rel && !String(e.k).startsWith("log.")) list.push({ no, id, e });
  if (list.length <= noteCap) return null;
  list.sort((a, b) => (a.e.t - b.e.t) || (a.id < b.id ? -1 : 1));
  const keepTo = Math.max(0, Math.min(noteCap, opts.keepTo ?? Math.floor(noteCap * 0.8)));
  const gone = list.slice(0, list.length - keepTo);
  const byPage = {};
  let first = Infinity, last = 0;
  for (const g of gone) { (byPage[g.no] ||= []).push(g.id); first = Math.min(first, g.e.t); last = Math.max(last, g.e.t2 || g.e.t); }
  const marker = { actorId: opts.actorId || "", k: "log.prune", path: "prune-notes", u: "", t: last + 1, d: { removed: gone.length, first, last, times: 1, notes: 1 } };
  marker.id = makeId(marker.t, marker.actorId, marker.k, marker.path, marker.u);
  return { byPage, removed: gone.length, first, last, marker, left: list.length - gone.length };
}

/** Apply a plan to in-memory pages (tests, and the writer's local index). Returns {pages, secret}; the marker lands in the head page. */
export function applyPrune(pages, plan, opts = {}) {
  if (!plan) return { pages, secret: opts.secret };
  const out = { ...pages };
  for (const no of plan.dropPages) delete out[no];
  const nos = sortedNos(out);
  const head = opts.head ?? nos[nos.length - 1];
  const { actorId, ...m } = plan.marker;
  const entry = { id: plan.marker.id, t: m.t, u: "", k: "log.prune", d: clone(m.d) };
  out[head] = pageWith(out[head] || emptyPage(head), entry);
  let secret = opts.secret;
  if (secret) { secret = { ...secret }; for (const no of plan.dropSecret) delete secret[no]; }
  return { pages: out, secret };
}

/* ------------------------------------------------------------------ redaction */
/** A redacted entry keeps its id, time and the GM-only flag; content, links and user are gone, the marker says who redacted. */
export function redactEntry(entry, by) {
  const stub = { id: entry.id, t: entry.t, u: by || "", k: "log.redact", d: { by: by || "", n: 1 } };
  if (entry.v) stub.v = 1;
  return stub;
}
/** Redact ids out of an id-keyed map. Returns {map, redacted:[ids], missing:[ids]}; already-redacted entries are skipped (idempotent). */
export function redactMany(map, ids, by) {
  const out = { ...map }, redacted = [], missing = [];
  for (const id of ids) {
    const e = out[id];
    if (!e) { missing.push(id); continue; }
    if (e.k === "log.redact") continue;
    out[id] = redactEntry(e, by); redacted.push(id);
  }
  return { map: out, redacted, missing };
}

/** Whole-log accounting helper used by the property tests: non-marker entries + sum of prune markers = everything ever written. */
export function accounted(pages) {
  let live = 0, pruned = 0;
  for (const p of Object.values(pages)) for (const e of entriesOf(p)) { if (e.k === "log.prune") pruned += nz(e.d && e.d.removed); else live++; }
  return { live, pruned, total: live + pruned };
}
