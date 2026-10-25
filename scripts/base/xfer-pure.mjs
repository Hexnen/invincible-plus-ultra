// Team & Base card - EXPORT / IMPORT, pure part (phase B9). NO Foundry globals: runs in Node and in the browser.
// A base travels as one JSON document: the normalized card data (no derived rank, no marker, no meta, no book text: the per-event result text is
// dropped, the book is re-read at runtime), the members by id / uuid / name (so an import can find the heroes again), crate snapshots and vehicle
// references as stored. Import never trusts the file: parseImport() re-normalizes and validates, planImport() remaps heroes and vehicles through
// callbacks the Foundry side supplies and reports what could not be remapped. Messages are IPB.Xfer.* keys + params (strings live in lang.mjs).
import * as P from "./pure.mjs";

export const FORMAT = "invincible-plus-ultra.team-base";
export const FORMAT_VERSION = 1;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_MEMBERS = 40;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
const clone = (o) => JSON.parse(JSON.stringify(o));
const PORTABLE_KEYS = ["motto", "purpose", "background", "base", "policy"];

/** The part of a card that travels, normalized: stored rank kept (creation default), event text emptied (book text), no marker / meta / name / picture. */
export function portable(raw) {
  const B = P.normalize(clone(isObj(raw) ? raw : {}));
  const out = { rank: B.rank };
  for (const k of PORTABLE_KEYS) out[k] = clone(B[k]);
  for (const c of P.COLLECTIONS) out[c] = clone(B[c]);
  for (const e of Object.values(out.events)) e.text = "";
  return out;
}

const cleanMember = (m) => ({ id: str(m?.id).slice(0, 40), uuid: str(m?.uuid).slice(0, 120), name: str(m?.name).slice(0, 80) });
const safeImg = (s) => { const v = str(s).trim(); return v && !/^(data|blob|javascript):/i.test(v) && v.length <= 400 ? v : ""; };

/** { B (stored or view shape), name, img, members:[{id,uuid,name}], moduleVersion, now } -> the document written to the file. */
export function buildExport({ B, name, img = "", members = [], moduleVersion = "", now = 0 } = {}) {
  return {
    format: FORMAT, formatVersion: FORMAT_VERSION, schema: P.SCHEMA_VERSION, moduleVersion: str(moduleVersion), exportedAt: Number(now) || 0,
    name: P.clampText(str(name).trim() || str(B?.name).trim(), 80), img: safeImg(img),
    data: portable(B),
    members: (Array.isArray(members) ? members : []).slice(0, MAX_MEMBERS).map(cleanMember)
  };
}

/** Counts shown before / after an import. */
export function describe(doc) {
  const d = doc?.data ?? {};
  return {
    upgrades: Object.values(d.upgrades ?? {}).reduce((n, u) => n + (Number(u?.count) || 1), 0),
    events: Object.keys(d.events ?? {}).length, crate: Object.keys(d.crate ?? {}).length,
    vehicles: Object.keys(d.vehicles ?? {}).length, trackers: Object.keys(d.trackers ?? {}).length, members: (doc?.members ?? []).length
  };
}

/** text | object -> { ok, doc, problems:[{level:"error"|"warn", key, params}] }. doc is re-normalized (never the raw input); ok is false when problems has an error. */
export function parseImport(input) {
  const problems = [];
  const bad = (key, params = {}) => { problems.push({ level: "error", key, params }); return { ok: false, doc: null, problems }; };
  let raw = input;
  if (typeof input === "string") {
    if (input.length > MAX_FILE_BYTES) return bad("IPB.Xfer.Err.tooBig", { mb: Math.round(MAX_FILE_BYTES / 1048576) });
    try { raw = JSON.parse(input); } catch { return bad("IPB.Xfer.Err.notJson"); }
  }
  if (!isObj(raw) || raw.format !== FORMAT) return bad("IPB.Xfer.Err.notFormat");
  const fv = Number(raw.formatVersion);
  if (!Number.isInteger(fv) || fv < 1) return bad("IPB.Xfer.Err.notFormat");
  if (fv > FORMAT_VERSION) return bad("IPB.Xfer.Err.newer", { v: fv });
  if (!isObj(raw.data)) return bad("IPB.Xfer.Err.noData");
  if (Number(raw.schema) > P.SCHEMA_VERSION) problems.push({ level: "warn", key: "IPB.Xfer.Warn.newerSchema", params: { v: raw.schema } });
  const data = portable(raw.data);
  for (const i of P.validate({ ...data, name: str(raw.name) || "x" })) if (i.level === "error") problems.push({ level: "error", key: i.key, params: i.params ?? {} });
  const members = (Array.isArray(raw.members) ? raw.members : []).filter(isObj).slice(0, MAX_MEMBERS).map(cleanMember);
  const doc = { format: FORMAT, formatVersion: FORMAT_VERSION, name: P.clampText(str(raw.name).trim(), 80), img: safeImg(raw.img), data, members };
  return { ok: !problems.some((p) => p.level === "error"), doc, problems };
}

/** Turns a parsed doc into the card to create. ctx = {
 *    hero(member) -> { id, name } | null | "other" (found but already in another base) | "skip",   // "skip": members are not wanted (duplicate): not reported
 *    vehicle(entry) -> { uuid, name, img } | null,                                                  // null: the vehicle cannot be found, it is removed
 *    userId, now, name (override) }
 *  -> { B, name, img, link:[heroId], report:{ linked:[name], other:[name], missing:[name], vehiclesKept, vehiclesRemapped, vehiclesDropped:[name], vehiclesDuplicate:[name], buysRemapped } }.
 *  B is the stored shape (defaultBase merged with the data, meta stamped); the marker and the picture are added by the host (cardActorData). */
export function planImport(doc, ctx = {}) {
  const report = { linked: [], other: [], missing: [], vehiclesKept: 0, vehiclesRemapped: 0, vehiclesDropped: [], vehiclesDuplicate: [], buysRemapped: 0 };
  const data = portable(doc?.data);
  const idMap = {};
  const link = [];
  for (const m of doc?.members ?? []) {
    const r = ctx.hero ? ctx.hero(m) : "skip";
    if (r === "skip") continue;
    if (r === "other") { report.other.push(m.name || m.id); continue; }
    if (!r || !r.id) { report.missing.push(m.name || m.id); continue; }
    if (link.includes(r.id)) continue;
    link.push(r.id);
    report.linked.push(r.name || m.name);
    if (m.id) idMap[m.id] = r.id;
  }
  // vehicles: keep (same uuid), remap (found another way) or drop (reported); never two rows for one actor; the star survives on the first remaining row
  const hadPrimary = Object.values(data.vehicles).some((v) => v.primary);
  const seen = new Set();
  const vehicles = {};
  for (const [id, v] of Object.entries(data.vehicles).sort((a, b) => (a[1].sort - b[1].sort) || (a[0] < b[0] ? -1 : 1))) {
    const r = ctx.vehicle ? ctx.vehicle(v) : v;
    if (!r || !r.uuid) { report.vehiclesDropped.push(v.name || v.uuid); continue; }
    if (seen.has(r.uuid)) { report.vehiclesDuplicate.push(v.name); continue; }
    seen.add(r.uuid);
    if (r.uuid === v.uuid) report.vehiclesKept++; else report.vehiclesRemapped++;
    vehicles[id] = { ...v, uuid: r.uuid, name: r.name ?? v.name, img: r.img ?? v.img };
  }
  if (hadPrimary && Object.keys(vehicles).length && !Object.values(vehicles).some((v) => v.primary)) {
    const first = Object.entries(vehicles).sort((a, b) => (a[1].sort - b[1].sort) || (a[0] < b[0] ? -1 : 1))[0][0];
    vehicles[first].primary = true;
  }
  data.vehicles = vehicles;
  // karma purchase logs name the paying heroes by id: follow the remapped ones (others keep their old id and name, harmless history)
  for (const u of Object.values(data.upgrades)) {
    for (const b of Array.isArray(u.buys) ? u.buys : []) for (const s of Array.isArray(b?.split) ? b.split : []) if (s && idMap[s.id]) { s.id = idMap[s.id]; report.buysRemapped++; }
  }
  const now = Number(ctx.now) || 0, by = str(ctx.userId);
  const name = P.clampText(str(ctx.name).trim() || str(doc?.name).trim() || "Team", 80);
  const B = P.normalize({ ...P.defaultBase(), ...data, name, img: "", meta: { created: { by, at: now }, updated: { by, at: now } } });
  return { B, name, img: safeImg(doc?.img), link, report };
}

/** True when two cards carry the same portable data (the round-trip check). */
export const samePortable = (a, b) => JSON.stringify(sortKeys(portable(a))) === JSON.stringify(sortKeys(portable(b)));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

/** What deleting a base costs (for the confirm dialog). members = hero names, B = normalized card. */
export function deleteImpact(B, members = []) {
  const d = describe({ data: B, members });
  return { heroes: members.length, upgrades: d.upgrades, events: d.events, crate: d.crate, vehicles: d.vehicles, trackers: d.trackers };
}

/** A safe file name for the export (letters, digits, dashes). */
export const fileName = (name) => `${P.slug(name) || "team-base"}.ipb-team.json`;
