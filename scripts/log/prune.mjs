/* Activity log - retention, pruning, redaction (phase L2). PURE: no Foundry globals. Spec 3.5. */
import { makeId, pageWith, emptyPage, clone, totalCount } from "./model.mjs";

const nz = (v) => (Number.isFinite(v) ? v : 0);
const sortedNos = (pages) => Object.keys(pages).map(Number).sort((a, b) => a - b);

/** Summaries of pages: [{no, n, first, last}] oldest first. */
export function summarizePages(pages) {
  return sortedNos(pages).map((no) => {
    const p = pages[no];
    const ts = Object.values(p.e || {});
    return { no, n: ts.length, first: ts.length ? Math.min(...ts.map((e) => e.t)) : 0, last: ts.length ? Math.max(...ts.map((e) => e.t2 || e.t)) : 0 };
  });
}
/** Status vs a cap (0 = unlimited). */
export function retentionStatus(count, cap) {
  if (!cap) return { cap: 0, count, over: false, ratio: 0, warn: false };
  return { cap, count, over: count > cap, ratio: count / cap, warn: count >= cap * 0.9 };
}

/** Plan a prune: delete the OLDEST WHOLE chunks (never the head, never the only page) while total > cap.
 *  `secret` = optional {no: page} of the GM-only journal for the same actor: chunks whose newest entry is not newer than the cut are dropped too.
 *  Returns null when nothing to do, else {dropPages, dropSecret, removed (public entries), secretRemoved, first, last, marker}. The marker folds in any
 *  earlier log.prune markers that sit in dropped pages, so the running total survives. */
export function planPrune(pages, opts = {}) {
  const cap = opts.cap | 0;
  if (cap <= 0) return null;
  const nos = sortedNos(pages);
  const head = opts.head ?? nos[nos.length - 1];
  let total = totalCount(pages);
  if (total <= cap) return null;
  const drop = [];
  for (const no of nos) {
    if (total <= cap) break;
    if (no === head || nos.length - drop.length <= 1) break;
    drop.push(no); total -= Object.keys(pages[no].e || {}).length;
  }
  if (!drop.length) return null;
  let removed = 0, first = Infinity, last = 0, priorTimes = 0;
  for (const no of drop) {
    for (const e of Object.values(pages[no].e || {})) {
      if (e.k === "log.prune") { removed += nz(e.d && e.d.removed); first = Math.min(first, nz(e.d && e.d.first) || e.t); last = Math.max(last, nz(e.d && e.d.last)); priorTimes += nz(e.d && e.d.times) || 1; }
      else { removed += 1; first = Math.min(first, e.t); last = Math.max(last, e.t2 || e.t); }
    }
  }
  if (!Number.isFinite(first)) first = 0;
  const dropSet = new Set(drop);
  let firstKept = Infinity;
  for (const no of nos) if (!dropSet.has(no)) for (const e of Object.values(pages[no].e || {})) if (e.k !== "log.prune") firstKept = Math.min(firstKept, e.t);
  const markerT = Number.isFinite(firstKept) ? Math.max(1, firstKept - 1) : last + 1;
  const marker = {
    actorId: opts.actorId || "", k: "log.prune", path: "prune", u: "", t: markerT,
    d: { removed, first, last, times: priorTimes + 1 }
  };
  marker.id = makeId(marker.t, marker.actorId, marker.k, marker.path, marker.u);
  const dropSecret = [];
  let secretRemoved = 0;
  if (opts.secret) {
    for (const no of sortedNos(opts.secret)) {
      const es = Object.values(opts.secret[no].e || {});
      if (es.length && es.every((e) => (e.t2 || e.t) <= last)) { dropSecret.push(no); secretRemoved += es.length; }
    }
  }
  return { dropPages: drop, dropSecret, removed, secretRemoved, first, last, marker, keep: total };
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
  for (const p of Object.values(pages)) for (const e of Object.values(p.e || {})) { if (e.k === "log.prune") pruned += nz(e.d && e.d.removed); else live++; }
  return { live, pruned, total: live + pruned };
}
