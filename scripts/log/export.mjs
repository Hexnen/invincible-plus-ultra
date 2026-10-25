/* Activity log - export serialisers (phase L2). PURE: no Foundry globals. Spec 3.5. JSON is lossless; CSV / Markdown are for reading. */
import { categoryOf, plainText, typeDef } from "./events.mjs";
import { normalizeEntry, validateEntry, sortEntries, clone } from "./model.mjs";
import { dayKey } from "./filter.mjs";

export const FORMAT = "ip-log";
export const VERSION = 1;
export const BOM = "﻿";
export const CSV_COLUMNS = Object.freeze(["id", "time_iso", "user", "category", "type", "summary", "from", "to", "round", "msg_id", "gm_only"]);
export const MIME = Object.freeze({ json: "application/json", csv: "text/csv;charset=utf-8", md: "text/markdown;charset=utf-8" });

/* ------------------------------------------------------------------ JSON */
/** ctx: {actor:{id,name,uuid,type}, exportedAt, exportedBy, users:{id:name}}. */
export function toJSON(entries, ctx = {}) {
  const doc = {
    format: FORMAT, version: VERSION,
    actor: ctx.actor ? { id: ctx.actor.id, name: ctx.actor.name, uuid: ctx.actor.uuid, type: ctx.actor.type } : null,
    exportedAt: ctx.exportedAt ?? 0, exportedBy: ctx.exportedBy ?? "", users: ctx.users || {},
    entries: sortEntries(entries).map((e) => clone(stripMerged(e)))
  };
  return JSON.stringify(doc, null, 2);
}
/** Parse and validate an export. Invalid entries are skipped and reported; ok=false when the envelope is wrong. */
export function parseJSON(text) {
  let doc;
  try { doc = JSON.parse(String(text).replace(/^﻿/, "")); } catch { return { ok: false, errors: [{ key: "IPL.Val.badJson", field: "" }], entries: [], meta: null }; }
  return parseDoc(doc);
}
/** Validate an already parsed single-actor export document (also used for every member of a bundle). */
export function parseDoc(doc) {
  if (!doc || typeof doc !== "object" || doc.format !== FORMAT) return { ok: false, errors: [{ key: "IPL.Val.badFormat", field: "format" }], entries: [], meta: null };
  if (doc.version !== VERSION) return { ok: false, errors: [{ key: "IPL.Val.badVersion", field: "version" }], entries: [], meta: null };
  if (!Array.isArray(doc.entries)) return { ok: false, errors: [{ key: "IPL.Val.badData", field: "entries" }], entries: [], meta: null };
  const scope = doc.actor && doc.actor.type === "base" ? "base" : "hero";
  const entries = [], errors = [], seen = new Set();
  doc.entries.forEach((raw, i) => {
    const e = normalizeEntry(raw, { now: 0 });
    const v = e ? validateEntry(e, scope) : { ok: false, errors: [{ key: "IPL.Val.notObject", field: "" }] };
    if (!v.ok) { for (const er of v.errors) errors.push({ ...er, index: i }); return; }
    if (seen.has(e.id)) { errors.push({ key: "IPL.Val.duplicate", field: "id", index: i }); return; }
    seen.add(e.id); entries.push(e);
  });
  return { ok: true, errors, entries, meta: { actor: doc.actor, exportedAt: doc.exportedAt, exportedBy: doc.exportedBy, users: doc.users || {} } };
}

/* ------------------------------------------------------------------ bundle (L6: every log of the table in one archive file) */
export const BUNDLE_FORMAT = "ip-log-bundle";
/** logs = [{actor:{id,name,uuid,type}, entries:[...]}]. A bundle holds ordinary single-actor documents, so the importer reuses parseDoc for each. */
export function toBundle(logs, ctx = {}) {
  const doc = {
    format: BUNDLE_FORMAT, version: VERSION, exportedAt: ctx.exportedAt ?? 0, exportedBy: ctx.exportedBy ?? "", users: ctx.users || {},
    logs: logs.map((l) => ({
      format: FORMAT, version: VERSION, actor: l.actor ? { id: l.actor.id, name: l.actor.name, uuid: l.actor.uuid, type: l.actor.type } : null,
      exportedAt: ctx.exportedAt ?? 0, exportedBy: ctx.exportedBy ?? "", users: ctx.users || {}, entries: sortEntries(l.entries).map((e) => clone(stripMerged(e)))
    }))
  };
  return JSON.stringify(doc, null, 2);
}
/** The merged Table log decorates entries with `aid` / `sc`; they never go into a file. */
export function stripMerged(e) { const { aid, sc, ...rest } = e; void aid; void sc; return rest; }

/* ------------------------------------------------------------------ CSV */
/** Quote a CSV cell. Cells that a spreadsheet could run as a formula get a leading apostrophe (strings only). */
export function csvCell(v) {
  if (v === null || v === undefined) return "";
  let s = typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (typeof v === "string" && /^[=+@\t\r]|^-(?!\d)/.test(s) && s.length) s = "'" + s;
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
/** Strict-enough RFC 4180 reader (tests and re-import tools). */
export function parseCSV(text) {
  const s = String(text).replace(/^﻿/, "");
  const rows = []; let row = [], cell = "", q = false, i = 0;
  while (i < s.length) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i += 2; continue; } q = false; i++; continue; }
      cell += c; i++; continue;
    }
    if (c === '"') { q = true; i++; continue; }
    if (c === ",") { row.push(cell); cell = ""; i++; continue; }
    if (c === "\r" && s[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i += 2; continue; }
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; continue; }
    cell += c; i++;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const scalar = (v) => (v === undefined ? "" : v);
/** ctx: {scope, users, text(entry) -> string, } */
export function csvRow(e, ctx = {}) {
  const d = e.d || {};
  const gm = e.v || (typeDef(e.k) && typeDef(e.k).vis === "G") ? "1" : "0";
  const row = [
    e.id, new Date(e.t).toISOString(), (ctx.users && ctx.users[e.u]) || e.u, categoryOf(e.k, e.sc || ctx.scope || "hero"), e.k,
    ctx.text ? ctx.text(e) : plainText(e), scalar(d.from), scalar(d.to), e.c && e.c.r != null ? e.c.r : "", d.msgId || "", gm
  ];
  if (ctx.actorNames) row.push((e.aid && ctx.actorNames[e.aid]) || e.aid || "");     // merged Table log: one extra trailing column
  return row;
}
export function toCSV(entries, ctx = {}) {
  const lines = [CSV_COLUMNS.concat(ctx.actorNames ? ["actor"] : []).join(",")];
  for (const e of sortEntries(entries)) lines.push(csvRow(e, ctx).map(csvCell).join(","));
  return BOM + lines.join("\r\n") + "\r\n";
}

/* ------------------------------------------------------------------ Markdown */
export function mdEscape(s) {
  return String(s ?? "").replace(/[\r\n]+/g, " ").replace(/([\\`*_{}\[\]<>#|~])/g, "\\$1");
}
const hhmm = (t, off) => new Date(t + off * 60000).toISOString().slice(11, 16);
/** ctx: {actor, users, text(entry), offsetMin (default 0 = UTC), order "asc"|"desc", labels:{gmOnly, redacted}} */
export function toMarkdown(entries, ctx = {}) {
  const off = ctx.offsetMin ?? 0;
  const L = { gmOnly: "GM only", ...(ctx.labels || {}) };
  const list = sortEntries(entries);
  if (ctx.order === "desc") list.reverse();
  const out = [`# ${mdEscape(ctx.actor && ctx.actor.name ? ctx.actor.name : "Log")}`, ""];
  let day = null;
  for (const e of list) {
    const k = dayKey(e.t, off);
    if (k !== day) { if (day !== null) out.push(""); out.push(`## ${k}`, ""); day = k; }
    const who = (ctx.users && ctx.users[e.u]) || e.u;
    const text = ctx.text ? ctx.text(e) : plainText(e);
    const gm = e.v || (typeDef(e.k) && typeDef(e.k).vis === "G") ? ` _(${mdEscape(L.gmOnly)})_` : "";
    const where = ctx.actorNames && e.aid ? ` [${mdEscape(ctx.actorNames[e.aid] || e.aid)}]` : "";
    out.push(`- ${hhmm(e.t, off)}${where} **${mdEscape(who)}** ${mdEscape(text)}${gm}`);
  }
  return out.join("\n") + "\n";
}

/* ------------------------------------------------------------------ names / dispatch */
export function slug(s) { const t = String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); return (t || "log").slice(0, 40); }
export function exportName(actorName, fmt, now) {
  const d = new Date(now).toISOString();
  const stamp = d.slice(0, 10).replace(/-/g, "") + "-" + d.slice(11, 16).replace(":", "");
  return `ip-log-${slug(actorName)}-${stamp}.${fmt}`;
}
/** Merged (several actors) export: JSON becomes a bundle grouped by `aid` (ctx.actors = {aid: {id,name,uuid,type}}), CSV gets an actor column, Markdown prefixes [actor]. */
export function exportMerged(entries, fmt, ctx = {}) {
  const f = fmt === "csv" ? "csv" : fmt === "md" ? "md" : "json";
  const names = {}; for (const [id, a] of Object.entries(ctx.actors || {})) names[id] = a && a.name;
  let text;
  if (f === "json") {
    const by = new Map();
    for (const e of entries) { if (!by.has(e.aid)) by.set(e.aid, []); by.get(e.aid).push(e); }
    text = toBundle([...by].map(([aid, list]) => ({ actor: (ctx.actors && ctx.actors[aid]) || { id: aid, name: aid, uuid: "", type: list[0] && list[0].sc || "hero" }, entries: list })), ctx);
  } else text = f === "csv" ? toCSV(entries, { ...ctx, actorNames: names }) : toMarkdown(entries, { ...ctx, actor: { name: ctx.title || "Table log" }, actorNames: names, order: ctx.order || "desc" });
  return { filename: exportName(ctx.title || "table-log", f === "json" ? "json" : f, ctx.exportedAt ?? 0), mime: MIME[f], text };
}
/** One call: returns {filename, mime, text}. */
export function exportEntries(entries, fmt, ctx = {}) {
  const f = fmt === "csv" ? "csv" : fmt === "md" ? "md" : "json";
  const text = f === "csv" ? toCSV(entries, ctx) : f === "md" ? toMarkdown(entries, ctx) : toJSON(entries, ctx);
  return { filename: exportName(ctx.actor && ctx.actor.name, f, ctx.exportedAt ?? 0), mime: MIME[f], text };
}
