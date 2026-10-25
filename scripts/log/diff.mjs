/* Activity log - object diff, path labelling, snapshots (phase L2). PURE: no Foundry globals. Spec 3.4 (1, 3, 6) and 2.1 / 2.2. */
import { MOD_ID } from "./events.mjs";
import { deepEqual, clone, clampText, fnv32 } from "./model.mjs";

export const FLAG = `flags.${MOD_ID}.base`;
export const ATTRS = Object.freeze(["fighting", "agility", "strength", "reason", "intuition", "presence"]);
export const VITALS = Object.freeze(["health", "resolve", "slugfest"]);
export const TRACKS = Object.freeze(["karma", "reputation", "resources"]);
export const TEXT_KEYS = Object.freeze(["civilianName", "role", "appearance", "occupation", "personality", "drive", "flaw", "relationships", "team", "teamBase"]);
export const CARD_FIELDS = Object.freeze(["kind", "where", "description"]);
export const TOP_CARD_FIELDS = Object.freeze(["purpose", "background", "motto"]);
export const TEXT_CLAMP = 120;
export const BIO_CLAMP = 160;

/** Noise that is never logged (spec "Not logged on purpose"). Embedded collections are handled by item / effect snapshots, not by actor paths. */
export const IGNORE = Object.freeze([
  /^_id$/, /^_stats(\.|$)/, /^sort$/, /^folder$/, /^flags\.core(\.|$)/, /^_source(\.|$)/,
  new RegExp(`^flags\\.${MOD_ID.replace(/[-]/g, "\\-")}\\.chargenBackup(\\.|$)`),
  new RegExp(`^flags\\.${MOD_ID.replace(/[-]/g, "\\-")}\\.log(\\.|$)`),
  /^system\.derived\.[^.]+\.(max|min)$/, /^items(\.|$)/, /^effects(\.|$)/, /^token(\.|$)/,
  /^prototypeToken\.(?!texture\.src$)/, /^img\.(?!$)/
]);
export function isIgnored(path, patterns = IGNORE) { return patterns.some((re) => re.test(path)); }

/* ------------------------------------------------------------------ flatten / unflatten */
const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Flatten nested objects to dotted paths. Arrays and empty objects are leaves (compared deeply). "-=key" entries are removals (value undefined). */
export function flatten(obj, prefix = "", out = {}, depth = 0) {
  if (!isPlain(obj)) { if (prefix) out[prefix] = obj; return out; }
  const keys = Object.keys(obj);
  if (!keys.length) { if (prefix) out[prefix] = {}; return out; }
  for (const key of keys) {
    const v = obj[key];
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (key.startsWith("-=")) { out[prefix ? `${prefix}.${key.slice(2)}` : key.slice(2)] = undefined; continue; }
    const p = prefix ? `${prefix}.${key}` : key;
    if (isPlain(v) && depth < 12) flatten(v, p, out, depth + 1);
    else out[p] = Array.isArray(v) ? clone(v) : v;
  }
  return out;
}
export function unflatten(flat) {
  const out = {};
  for (const [path, v] of Object.entries(flat)) {
    if (v === undefined) continue;
    const parts = path.split(".");
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      if (parts[i] === "__proto__" || parts[i] === "constructor") { cur = null; break; }
      if (!isPlain(cur[parts[i]])) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    if (cur && parts[parts.length - 1] !== "__proto__") cur[parts[parts.length - 1]] = Array.isArray(v) ? clone(v) : isPlain(v) ? clone(v) : v;
  }
  return out;
}

/* ------------------------------------------------------------------ diff */
/** Diff two flat maps. Result sorted by path: [{p, from, to, kind: "add"|"remove"|"change"}]. A key present with value undefined counts as absent. */
export function diffFlat(a, b, opts = {}) {
  const ignore = opts.ignore || IGNORE;
  const out = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const p of [...keys].sort()) {
    if (isIgnored(p, ignore)) continue;
    const ha = own(a, p) && a[p] !== undefined, hb = own(b, p) && b[p] !== undefined;
    if (!ha && !hb) continue;
    if (ha && hb) { if (!deepEqual(a[p], b[p])) out.push({ p, from: clone(a[p]), to: clone(b[p]), kind: "change" }); }
    else if (hb) out.push({ p, from: undefined, to: clone(b[p]), kind: "add" });
    else out.push({ p, from: clone(a[p]), to: undefined, kind: "remove" });
  }
  return out;
}
export function diffObjects(a, b, opts = {}) { return diffFlat(flatten(a), flatten(b), opts); }
/** Apply a diff to a flat map (returns a new map). Inverse of diffFlat for the non-ignored paths. */
export function applyFlat(flat, changes) {
  const out = { ...flat };
  for (const c of changes) { if (c.kind === "remove") delete out[c.p]; else out[c.p] = clone(c.to); }
  return out;
}
export function applyDiff(obj, changes) { return unflatten(applyFlat(flatten(obj), changes)); }

/** Turn a Foundry-style `changes` object (post hook) into list [{p, to, kind}] (no from; the snapshot gives it). */
export function flattenChanges(changes) {
  const flat = flatten(changes);
  return Object.entries(flat).map(([p, to]) => (to === undefined ? { p, kind: "remove", to: undefined } : { p, kind: "set", to }));
}

/* ------------------------------------------------------------------ labelling */
const seg = (p) => p.split(".");
/** Classify a changed path into {k, ...} (the event type id and keys) or null when the path is not tracked. */
export function classify(path, scope = "hero") {
  if (isIgnored(path)) return null;
  const s = seg(path);
  if (path === "name") return { k: scope === "base" ? "card.rename" : "actor.rename" };
  if (path === "img") return { k: scope === "base" ? "card.img" : "actor.img", what: "portrait" };
  if (path === "prototypeToken.texture.src") return scope === "base" ? null : { k: "actor.img", what: "token" };
  if (s[0] === "ownership") return s[1] === "default" && s.length === 2 ? { k: "access.default" } : s.length === 2 ? { k: "access.owner", user: s[1] } : null;
  if (scope === "base") return classifyBase(path);
  if (s[0] === "system") {
    if (s[1] === "attributes" && ATTRS.includes(s[2]) && (s.length === 3 || (s.length === 4 && s[3] === "value"))) return { k: "stat.attr", key: s[2] };
    if (s[1] === "derived" && VITALS.includes(s[2]) && s.length === 4 && s[3] === "value") return { k: "stat.vital", key: s[2] };
    if (TRACKS.includes(s[1]) && (s.length === 2 || (s.length === 3 && s[2] === "value"))) return { k: "stat.track", key: s[1] };
    if (TEXT_KEYS.includes(s[1]) && s.length === 2) return { k: "stat.text", key: s[1] };
    if (s[1] === "biography" && (s.length === 2 || (s.length === 3 && s[2] === "value"))) return { k: "stat.text", key: "biography" };
    return null;
  }
  if (path === `${FLAG}.team`) return { k: "team.link" };
  return null;
}
const ID_FAMILIES = Object.freeze({
  upgrades: { add: "upgrade.add", remove: "upgrade.remove", fields: { status: "upgrade.status", count: "upgrade.count", note: "upgrade.note" }, idKey: "key" },
  events: { add: "event.rolled", fields: { rerolled: "event.reroll", resolved: "event.resolved", "effect.applied": "event.applied", note: "event.note" }, idKey: "eid" },
  crate: { add: "crate.add", remove: "crate.remove", fields: { qty: "crate.qty" }, idKey: "cid" },
  vehicles: { add: "vehicle.add", remove: "vehicle.remove", fields: { primary: "vehicle.primary" }, idKey: "vid" },
  trackers: { add: null, remove: null, fields: { value: "tracker.edit" }, idKey: "id" }
});
export { ID_FAMILIES };
function classifyBase(path) {
  const pre = FLAG + ".";
  if (!path.startsWith(pre)) return null;
  const s = path.slice(pre.length).split(".");
  if (s[0] === "base") {
    if (s[1] === "occupied" && s.length === 2) return { k: "card.occupied" };
    if (s[1] === "rolls" && (s[2] === "kind" || s[2] === "where") && s.length === 3) return { k: "card.roll", table: s[2] };
    if (CARD_FIELDS.includes(s[1]) && s.length === 2) return { k: "card.edit", field: s[1] };
    return null;
  }
  if (TOP_CARD_FIELDS.includes(s[0]) && s.length === 1) return { k: "card.edit", field: s[0] };
  if (s[0] === "policy" && s.length === 2) return { k: "policy.change", key: s[1] };
  const fam = ID_FAMILIES[s[0]];
  if (fam && s.length >= 2) {
    const id = s[1], rest = s.slice(2).join(".");
    if (!rest) return { k: fam.add || "x", family: s[0], id, whole: true };
    return { k: null, family: s[0], id, rest };
  }
  return null;
}

const plainText = (html) => String(html == null ? "" : html).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const clampStr = (v, n) => (typeof v === "string" ? clampText(v, n) : v);
/** Hex-ish short digest of a text (used in snapshots so a long text costs a few bytes + a prefix). */
export const digest = (s) => fnv32(String(s)).toString(36);

/** Turn a raw diff (from diffFlat over before/after actor data) into event drafts [{k, path, d, id?}] for a scope.
 *  opts: {scope, before, after (flat maps, for names), option flags {ipbSync}, vitalCause}. Untracked paths are dropped. */
export function draftsFromDiff(changes, opts = {}) {
  const scope = opts.scope || "hero";
  const before = opts.before || {}, after = opts.after || {};
  const out = [];
  const families = new Map(); // "family|id" -> list of {rest, c}
  let linkChange = null;
  for (const c of changes) {
    const cl = classify(c.p, scope);
    if (!cl) continue;
    if (cl.k === "team.link") { linkChange = c; continue; }
    if (cl.k === null) { const key = `${cl.family}|${cl.id}`; if (!families.has(key)) families.set(key, { family: cl.family, id: cl.id, list: [] }); families.get(key).list.push({ rest: cl.rest, c }); continue; }
    if (cl.whole) { const key = `${cl.family}|${cl.id}`; if (!families.has(key)) families.set(key, { family: cl.family, id: cl.id, list: [] }); families.get(key).whole = c; continue; }
    const d = {};
    switch (cl.k) {
      case "stat.attr": Object.assign(d, { key: cl.key, from: c.from, to: c.to }); break;
      case "stat.vital": Object.assign(d, { key: cl.key, from: c.from, to: c.to }); if (opts.vitalCause) d.cause = opts.vitalCause; break;
      case "stat.track": Object.assign(d, { key: cl.key, from: c.from, to: c.to }); if (opts.trackCause) d.cause = opts.trackCause; break;
      case "stat.text":
        if (cl.key === "biography") {
          const a = plainText(c.from), b = plainText(c.to);
          Object.assign(d, { key: "biography", len: [a.length, b.length], to: clampText(b, BIO_CLAMP) });
        } else Object.assign(d, { key: cl.key, from: clampStr(c.from ?? "", TEXT_CLAMP), to: clampStr(c.to ?? "", TEXT_CLAMP) });
        break;
      case "actor.rename": case "card.rename": Object.assign(d, { from: clampStr(c.from ?? "", TEXT_CLAMP), to: clampStr(c.to ?? "", TEXT_CLAMP) }); break;
      case "actor.img": Object.assign(d, { what: cl.what }); break;
      case "card.img": break;
      case "access.default": Object.assign(d, { from: c.from ?? "NONE", to: c.to ?? "NONE" }); break;
      case "access.owner": Object.assign(d, { user: cl.user, from: c.from ?? "NONE", to: c.kind === "remove" ? "NONE" : (c.to ?? "NONE") }); break;
      case "card.edit": {
        Object.assign(d, { field: cl.field, from: clampStr(c.from ?? "", 160), to: clampStr(c.to ?? "", 160) });
        if (typeof c.to === "string" && c.to.length > 160) d.len = [String(c.from ?? "").length, c.to.length];
        break;
      }
      case "card.roll": Object.assign(d, { table: cl.table, roll: c.to, result: after[`${FLAG}.${cl.table === "kind" ? "base.kind" : "base.where"}`] ?? null }); break;
      case "card.occupied": Object.assign(d, { on: !!c.to }); break;
      case "policy.change": Object.assign(d, { key: cl.key, from: c.from, to: c.to }); break;
      default: continue;
    }
    if (cl.k === "stat.text" && (cl.key === "team" || cl.key === "teamBase") && opts.ipbSync) {
      out.push({ k: "team.sync", path: "sync", d: { fields: ["team", "teamBase"] }, merge: "team.sync" });
      continue;
    }
    if (d.from !== undefined && d.to !== undefined && deepEqual(d.from, d.to) && cl.k !== "actor.img" && cl.k !== "card.img") continue;
    out.push({ k: cl.k, path: c.p, d });
  }
  if (linkChange) {
    const had = linkChange.from, has = linkChange.kind === "remove" ? null : linkChange.to;
    if (had && had !== has) out.push({ k: scope === "base" ? "member.remove" : "team.leave", path: c0(linkChange.p), d: { baseId: had, name: opts.nameOf ? opts.nameOf(had) : "" } });
    if (has && had !== has) out.push({ k: scope === "base" ? "member.add" : "team.join", path: c0(linkChange.p), d: { baseId: has, name: opts.nameOf ? opts.nameOf(has) : "" } });
  }
  for (const f of families.values()) out.push(...familyDrafts(f, before, after));
  return out;
}
const c0 = (p) => p;

function familyDrafts(f, before, after) {
  const fam = ID_FAMILIES[f.family];
  const base = `${FLAG}.${f.family}.${f.id}`;
  const nameOf = (flat) => flat[`${base}.name`] ?? flat[`${base}.label`] ?? "";
  const out = [];
  const countOf = (flat) => flat[`${base}.count`] ?? flat[`${base}.qty`];
  const removedAll = f.list.length > 0 && f.list.every((x) => x.c.kind === "remove") && !Object.keys(after).some((k) => k.startsWith(base + "."));
  const addedAll = f.list.length > 0 && f.list.every((x) => x.c.kind === "add") && !Object.keys(before).some((k) => k.startsWith(base + "."));
  const idKey = fam.idKey;
  const withKey = (d) => { if (f.family === "upgrades") { const k = after[`${base}.key`] ?? before[`${base}.key`]; if (k) { d.uid = f.id; d.key = k; } } return d; };   // L3: the card key (catalog slug) for upgrades, the row id kept as uid
  if ((addedAll || (f.whole && f.whole.kind === "add")) && fam.add) {
    const d = { [idKey]: f.id, name: clampStr(nameOf(after), TEXT_CLAMP) };
    if (f.family === "upgrades") { d.count = countOf(after) ?? 1; const pw = after[`${base}.power`]; if (pw) d.power = clampStr(pw, TEXT_CLAMP); }
    else if (f.family === "events") { d.roll = after[`${base}.roll`] ?? null; d.band = after[`${base}.band`] ?? ""; d.label = clampStr(after[`${base}.label`] ?? "", TEXT_CLAMP); d.text = clampStr(after[`${base}.text`] ?? "", 120); }
    else if (f.family === "crate") { d.qty = countOf(after) ?? 1; d.type = after[`${base}.type`] ?? ""; }
    out.push({ k: fam.add, path: base, d: withKey(d) });
    return out;
  }
  if ((removedAll || (f.whole && f.whole.kind === "remove")) && fam.remove) {
    const d = { [idKey]: f.id, name: clampStr(nameOf(before), TEXT_CLAMP) };
    if (f.family === "upgrades") d.count = countOf(before) ?? 1;
    else if (f.family === "crate") d.qty = countOf(before) ?? 1;
    out.push({ k: fam.remove, path: base, d: withKey(d) });
    return out;
  }
  for (const { rest, c } of f.list) {
    const k = fam.fields[rest];
    if (!k) continue;
    const nm = clampStr(nameOf(after) || nameOf(before), TEXT_CLAMP);
    const d = { [idKey]: f.id, name: nm };
    if (k === "upgrade.status" || k === "upgrade.count") { d.from = c.from; d.to = c.to; }
    else if (k === "crate.qty") { d.qty = c.to; d.from = c.from; d.type = after[`${base}.type`] ?? ""; }
    else if (k === "tracker.edit") { d.from = c.from; d.to = c.to; }
    else if (k === "vehicle.primary") { if (!c.to) continue; }
    else if (k === "event.applied") { if (!c.to) continue; d.effect = { kind: after[`${base}.effect.kind`] ?? "" }; }
    else if ((k === "event.reroll" || k === "event.resolved") && !c.to) continue;
    out.push({ k, path: `${base}.${rest}`, d: withKey(d) });
  }
  return out;
}

/* ------------------------------------------------------------------ snapshots / catch-up */
/** Item snapshot string "type|name|level|active|powerSource name" (spec 3.2). */
export function itemSnap(item, resolve = (x) => x) {
  const clean = (s) => String(s ?? "").replace(/\|/g, "/");
  const ps = item.powerSource ? resolve(item.powerSource) : "";
  return [clean(item.type), clean(item.name), item.level ?? "", item.active ? 1 : 0, clean(ps)].join("|");
}
export function parseItemSnap(str) {
  const [type = "", name = "", level = "", active = "0", powerSource = ""] = String(str).split("|");
  return { type, name, level: level === "" ? null : Number(level), active: active === "1", powerSource };
}
/** Field-level diff of two item snapshot strings -> [{p, from, to}] with the catalogue paths. */
export function diffItemSnap(from, to) {
  const a = parseItemSnap(from), b = parseItemSnap(to);
  const out = [];
  if (a.name !== b.name) out.push({ p: "name", from: a.name, to: b.name });
  if (a.level !== b.level) out.push({ p: "system.level", from: a.level, to: b.level });
  if (a.powerSource !== b.powerSource) out.push({ p: "system.powerSource", from: a.powerSource, to: b.powerSource });
  return out;
}
export function activeFlipped(from, to) { return parseItemSnap(from).active !== parseItemSnap(to).active; }

/** Compare two item maps (id -> snapshot string): added / removed / changed (+ toggled). */
export function diffItemMaps(a, b) {
  const added = [], removed = [], changed = [], toggled = [];
  for (const id of Object.keys(b).sort()) {
    if (!own(a, id)) added.push({ id, snap: b[id] });
    else if (a[id] !== b[id]) {
      const ch = diffItemSnap(a[id], b[id]);
      if (ch.length) changed.push({ id, changes: ch, snap: b[id] });
      if (activeFlipped(a[id], b[id])) toggled.push({ id, on: parseItemSnap(b[id]).active, snap: b[id] });
      if (!ch.length && !activeFlipped(a[id], b[id])) changed.push({ id, changes: [{ p: "type", from: parseItemSnap(a[id]).type, to: parseItemSnap(b[id]).type }], snap: b[id] });
    }
  }
  for (const id of Object.keys(a).sort()) if (!own(b, id)) removed.push({ id, snap: a[id] });
  return { added, removed, changed, toggled };
}

/** Make a flat snapshot (spec 3.2) from plain actor data: {name, attributes{k}, derived{k}, tracks, texts, items:{id: snapString}, ownership{}, card{}}. */
export function makeSnapshot(src, now = 0) {
  const s = {};
  if (src.name != null) s.n = src.name;
  for (const k of ATTRS) if (src.attributes && src.attributes[k] !== undefined) s[`a.${k}`] = src.attributes[k];
  for (const k of VITALS) if (src.derived && src.derived[k] !== undefined) s[`v.${k}`] = src.derived[k];
  for (const k of TRACKS) if (src.tracks && src.tracks[k] !== undefined) s[`t.${k}`] = src.tracks[k];
  for (const k of [...TEXT_KEYS, "biography"]) if (src.texts && src.texts[k] !== undefined) s[`s.${k}`] = textSnap(src.texts[k]);
  for (const [id, v] of Object.entries(src.items || {})) s[`i.${id}`] = v;
  for (const [u, lvl] of Object.entries(src.ownership || {})) s[`o.${u}`] = lvl;
  for (const [p, v] of Object.entries(src.card || {})) s[`b.${p}`] = typeof v === "string" ? textSnap(v) : v;
  s.at = now;
  return s;
}
/** Texts are stored as "digest:first 120 chars" so a change is detected cheaply and the catch-up can still show a short before. */
export function textSnap(v) { const str = plainText(v); return `${digest(str)}:${clampText(str, TEXT_CLAMP)}`; }
const textPart = (s) => String(s).slice(String(s).indexOf(":") + 1);

/** Diff two snapshots -> sorted list [{k:"a.fighting", kind, from, to}]; the `at` field and equal values are ignored. */
export function diffSnapshots(a, b) {
  const out = [];
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    if (k === "at") continue;
    const ha = own(a, k), hb = own(b, k);
    if (ha && hb) { if (!deepEqual(a[k], b[k])) out.push({ k, kind: "change", from: a[k], to: b[k] }); }
    else if (hb) out.push({ k, kind: "add", from: undefined, to: b[k] });
    else out.push({ k, kind: "remove", from: a[k], to: undefined });
  }
  return out;
}
/** Convert snapshot diffs to catch-up children [{k, d}] (at most `max`, rest counted). */
export function gapChildren(diffs, max = 30) {
  const kids = [];
  for (const df of diffs) {
    const [pre, ...rest] = df.k.split("."); const key = rest.join(".");
    let k, d;
    if (pre === "a") { k = "stat.attr"; d = { key, from: df.from, to: df.to }; }
    else if (pre === "v") { k = "stat.vital"; d = { key, from: df.from, to: df.to }; }
    else if (pre === "t") { k = "stat.track"; d = { key, from: df.from, to: df.to }; }
    else if (pre === "s") { k = "stat.text"; d = { key, from: df.from === undefined ? "" : textPart(df.from), to: df.to === undefined ? "" : textPart(df.to) }; }
    else if (pre === "n") { k = "actor.rename"; d = { from: df.from, to: df.to }; }
    else if (pre === "o") {
      k = key === "default" ? "access.default" : "access.owner";
      d = key === "default" ? { from: df.from ?? "NONE", to: df.to ?? "NONE" } : { user: key, from: df.from ?? "NONE", to: df.to ?? "NONE" };
    } else if (pre === "i") {
      if (df.kind === "add") { const p = parseItemSnap(df.to); k = "item.add"; d = { id: key, name: p.name, type: p.type, level: p.level ?? undefined }; }
      else if (df.kind === "remove") { const p = parseItemSnap(df.from); k = "item.remove"; d = { id: key, name: p.name, type: p.type }; }
      else {
        const p = parseItemSnap(df.to);
        const ch = diffItemSnap(df.from, df.to);
        if (activeFlipped(df.from, df.to)) { k = "item.toggle"; d = { id: key, name: p.name, type: p.type, on: p.active }; }
        else { k = "item.edit"; d = { id: key, name: p.name, type: p.type, changes: ch }; }
      }
    } else if (pre === "b") { k = "card.edit"; d = { field: key, from: typeof df.from === "string" ? textPart(df.from) : df.from, to: typeof df.to === "string" ? textPart(df.to) : df.to }; }
    else continue;
    kids.push({ k, d });
  }
  return { kids: kids.slice(0, max), more: Math.max(0, kids.length - max), total: kids.length };
}

/** The hero-side link draft (team.join / team.leave) mirrored into the base log as member.add / member.remove (spec 2.2). */
export function baseMirror(draft, hero) {
  if (!draft || (draft.k !== "team.join" && draft.k !== "team.leave")) return null;
  return { k: draft.k === "team.join" ? "member.add" : "member.remove", d: { id: hero.id, name: clampText(hero.name || "", TEXT_CLAMP) } };
}
