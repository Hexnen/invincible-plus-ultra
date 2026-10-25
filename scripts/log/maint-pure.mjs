/* Activity log - maintenance, PURE half (phase L6): hostile-file hardened IMPORT planning, trim preview, log health numbers. No Foundry globals.
   An import file is untrusted input (it can be edited by hand or crafted): every limit is checked BEFORE the heavy work, every entry goes through the same
   normalise / validate gate as a live write, ids are re-checked against the target scope, nothing from the file is trusted as an object key except the strictly
   validated 12-char id. Merging is by entry id (deterministic), so importing the same file twice adds nothing. */
import * as M from "./model.mjs";
import * as X from "./export.mjs";
import * as P from "./prune.mjs";

export const LIMITS = Object.freeze({
  fileChars: 8 * 1024 * 1024,        // refuse bigger files before JSON.parse
  entries: 20000,                    // across the whole file
  logs: 300,                         // members of a bundle
  minT: Date.UTC(2000, 0, 1),        // earlier than this is not a plausible entry time
  futureMs: 24 * 3600 * 1000,        // later than now + one day is refused (clock skew allowance)
  retainMax: 50000
});

const bad = (code, extra = {}) => ({ ok: false, errors: [{ key: `IPL.Val.${code}`, field: "", ...extra }], kind: null, logs: [] });

/** Parse an import file (single-actor export or bundle). Returns {ok, kind: "single"|"bundle", logs: [{actor, exportedAt, exportedBy, entries, errors}], errors}. */
export function parseImportFile(text, limits = LIMITS) {
  if (typeof text !== "string" || !text.length) return bad("badJson");
  if (text.length > limits.fileChars) return bad("tooBigFile", { max: limits.fileChars });
  let doc;
  try { doc = JSON.parse(text.replace(/^﻿/, "")); } catch { return bad("badJson"); }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return bad("badFormat");
  let docs;
  let kind = "single";
  if (doc.format === X.BUNDLE_FORMAT) {
    if (doc.version !== X.VERSION) return bad("badVersion");
    if (!Array.isArray(doc.logs) || !doc.logs.length) return bad("noLogs");
    if (doc.logs.length > limits.logs) return bad("tooMany", { max: limits.logs });
    docs = doc.logs; kind = "bundle";
  } else docs = [doc];
  let total = 0;
  for (const d of docs) total += d && Array.isArray(d.entries) ? d.entries.length : 0;
  if (total > limits.entries) return bad("tooMany", { max: limits.entries });
  const logs = [], errors = [];
  for (const d of docs) {
    const r = X.parseDoc(d);
    if (!r.ok) { errors.push(...r.errors); continue; }
    logs.push({ actor: r.meta && r.meta.actor && typeof r.meta.actor === "object" ? { id: String(r.meta.actor.id ?? "").slice(0, 40), name: String(r.meta.actor.name ?? "").slice(0, 120), type: r.meta.actor.type === "base" ? "base" : "hero" } : null, exportedAt: Number(r.meta.exportedAt) || 0, exportedBy: String(r.meta.exportedBy ?? "").slice(0, 80), entries: r.entries, errors: r.errors, dropped: new Set(r.errors.map((e) => e.index)).size });
  }
  if (!logs.length) return { ok: false, kind, errors: errors.length ? errors : [{ key: "IPL.Val.noLogs", field: "" }], logs: [] };
  return { ok: true, kind, logs, errors };
}

/** Plan one import into a target log. opts: {scope: "hero"|"base", actorId, existing: Set(ids), now, userId, from: label for the marker}.
 *  Returns {ok, entries (new ones, flagged `imp`, plus the log.import marker last), fresh, present, invalid, foreign, parsed} or {ok:false, errors}. */
export function planImport(log, opts = {}) {
  const scope = opts.scope === "base" ? "base" : "hero";
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const existing = opts.existing instanceof Set ? opts.existing : new Set(opts.existing || []);
  if (!log || !Array.isArray(log.entries)) return { ok: false, errors: [{ key: "IPL.Val.badData", field: "entries" }] };
  if (log.actor && log.actor.type && log.actor.type !== scope) return { ok: false, errors: [{ key: "IPL.Val.scopeMismatch", field: "actor.type" }] };
  const fresh = [], seen = new Set();
  const foreign = !!(log.actor && log.actor.id && opts.actorId && log.actor.id !== opts.actorId);
  let present = 0, invalid = log.dropped || 0, markers = 0;     // entries the file parser already refused count as refused
  for (const raw of log.entries) {
    const e = M.normalizeEntry(raw, { now: 0 });
    const v = e ? M.validateEntry(e, scope) : { ok: false };
    if (!v.ok || e.t < (opts.minT ?? LIMITS.minT) || e.t > now + LIMITS.futureMs) { invalid++; continue; }
    if (seen.has(e.id)) { invalid++; continue; }
    seen.add(e.id);
    if (foreign && (e.k === "log.start" || e.k === "log.import" || e.k === "log.prune")) { markers++; continue; }   // bookkeeping of ANOTHER log: meaningless here
    if (existing.has(e.id)) { present++; continue; }
    fresh.push({ ...e, imp: 1 });
  }
  const out = M.sortEntries(fresh);
  if (out.length) {
    const sig = M.fnv32(out.map((x) => x.id).join(",")).toString(36);
    const marker = M.normalizeEntry({ t: now, u: String(opts.userId ?? ""), k: "log.import", d: { n: out.length, from: String(opts.from ?? (log.actor && log.actor.name) ?? "").slice(0, 120) } }, { actorId: opts.actorId || "", path: `imp:${sig}` });
    out.push(marker);
  }
  return { ok: true, entries: out, fresh: fresh.length, present, invalid, markers, parsed: log.entries.length, foreign };
}

/** What a trim to `keep` entries would drop. pages / secret = {no: page}. Returns {noop, pages, entries, secretEntries, remain, first, last} (counts are exactly what planPrune will remove). */
export function trimPreview(pages, secret, opts = {}) {
  const keep = Math.max(0, Math.floor(Number(opts.keep) || 0));
  const total = M.totalCount(pages);
  const nos = Object.keys(pages).map(Number).sort((a, b) => a - b);
  const plan = keep > 0 ? P.planPrune(pages, { cap: keep, head: opts.head ?? nos[nos.length - 1], actorId: opts.actorId || "", secret, now: opts.now }) : null;
  if (!plan) return { noop: true, pages: 0, entries: 0, secretEntries: 0, remain: total, first: 0, last: 0, total, chunks: nos.length };
  return { noop: false, pages: plan.dropPages.length, secretPages: plan.dropSecret.length, entries: plan.removed, secretEntries: plan.secretRemoved, remain: plan.keep, first: plan.first, last: plan.last, total, chunks: nos.length };
}

/** Numbers about one log from its readable entries (public + secret). */
export function summarizeEntries(entries) {
  const s = { total: entries.length, secret: 0, gaps: 0, throttles: 0, prunes: 0, pruned: 0, imports: 0, importedEntries: 0, unverified: 0, approx: 0, redacted: 0, first: 0, last: 0 };
  for (const e of entries) {
    if (e.v) s.secret++;
    if (e.k === "log.gap") s.gaps++;
    else if (e.k === "log.throttle") s.throttles++;
    else if (e.k === "log.prune") { s.prunes += (e.d && e.d.times) || 1; s.pruned += (e.d && Number(e.d.removed)) || 0; }
    else if (e.k === "log.import") { s.imports++; s.importedEntries += (e.d && Number(e.d.n)) || 0; }
    else if (e.k === "log.redact") s.redacted++;
    if (e.rel && e.a) s.unverified++;
    if (e.a) s.approx++;
    const t = e.t, t2 = e.t2 || e.t;
    if (!s.first || t < s.first) s.first = t;
    if (t2 > s.last) s.last = t2;
  }
  return s;
}

/** A retention number typed by a person: integer 0..retainMax, or null when it is not a number. */
export function parseRetention(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(LIMITS.retainMax, Math.floor(n)));
}
/** Usage state for a meter: {ratio, state: "ok"|"warn"|"over"|"unlimited"}. */
export function usageState(count, cap) {
  if (!cap) return { ratio: 0, state: "unlimited" };
  const ratio = count / cap;
  return { ratio, state: count > cap ? "over" : ratio >= 0.9 ? "warn" : "ok" };
}
