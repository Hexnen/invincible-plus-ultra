// Team & Base card - pure core. NO Foundry globals: runs in Node and in the browser.
// Messages are returned as KEYS (IPB.*) + params; strings live in lang.mjs (B3+).
// No book prose here: only short identifiers (band ids, upgrade keys, rank ids).

export const SCHEMA_VERSION = 1;
export const FLAG_SCOPE = "invincible-plus-ultra";
export const FLAG_KEY = "base";

export const RANKS = ["teen", "street", "global", "cosmic"];
export const ALLOWANCE = { teen: 0, street: 1, global: 2, cosmic: 3 };
export const STATUSES = ["active", "installing", "disabled", "broken"];
export const SOURCES = ["start", "karma", "gm"];
export const POLICY_EDIT = ["gm", "members", "everyone"];
export const POLICY_CHAT = ["public", "gm", "off"];
export const CRATE_TYPES = ["gear", "vehicleWeapon"];
export const COLLECTIONS = ["upgrades", "events", "crate", "vehicles", "trackers"];

export const LIMITS = Object.freeze({
  upgrades: 40, events: 200, crate: 60, vehicles: 20, trackers: 20,
  bytes: 400 * 1024, eventText: 300
});
export const COST = Object.freeze({ upgrade: 10, tooPricey: 20 });

/* ------------------------------------------------------------------ coercion */
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
// B13: bidi OVERRIDE / EMBEDDING / ISOLATE controls (U+202A-202E, U+2066-2069) never survive normalisation: an unclosed RLO in a name reverses every string printed after it (chat cards, notifications, lock note). Marks (LRM / RLM) and real RTL letters stay.
const BIDI = new RegExp("[\u202A-\u202E\u2066-\u2069]", "g");
const str = (v, d = "") => (typeof v === "string" ? v : (v == null ? d : String(v))).replace(BIDI, "");
const bool = (v, d = false) => (typeof v === "boolean" ? v : d);
const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const int = (v, d = 0, min = -Infinity, max = Infinity) => {
  let n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  n = typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : d;
  return Math.min(max, Math.max(min, n));
};
const oneOf = (v, list, d) => (list.includes(v) ? v : d);
const intOrNull = (v) => (v === null || v === undefined || v === "" ? null : int(v, 0));
export const clampText = (s, n = LIMITS.eventText) => str(s).slice(0, n);
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ------------------------------------------------------------------ defaults */
export function defaultPolicy() { return { edit: "members", syncHeroes: true, chat: "public" }; }

export function defaultBase() {
  return {
    v: SCHEMA_VERSION, name: "", rank: "global", motto: "", img: "", purpose: "", background: "",
    base: { kind: "", where: "", description: "", occupied: false, rolls: { kind: null, where: null } },
    upgrades: {}, events: {}, crate: {}, vehicles: {}, trackers: {},
    policy: defaultPolicy(),
    meta: { created: { by: "", at: 0 }, updated: { by: "", at: 0 } }
  };
}

const ENTRY = {
  upgrades: (e) => ({
    key: str(e.key, "custom") || "custom", name: str(e.name), count: int(e.count, 1, 1, 99), power: str(e.power),
    status: oneOf(e.status, STATUSES, "active"), source: oneOf(e.source, SOURCES, "gm"),
    paid: int(e.paid, 0, 0), note: str(e.note), sort: num(e.sort), at: num(e.at)
  }),
  events: (e) => ({
    at: num(e.at), label: str(e.label), roll: int(e.roll, 0), band: str(e.band), resultId: str(e.resultId),
    text: clampText(e.text), effect: normEffect(e.effect), resolved: bool(e.resolved), rerolled: bool(e.rerolled),
    note: str(e.note), by: str(e.by), sort: num(e.sort),
    ...(e.mode !== undefined ? { mode: oneOf(e.mode, ["week", "any"], "") } : {})          // B11 (A13): a hostile file cannot show a raw key as the mode
  }),
  crate: (e) => ({
    name: str(e.name), img: str(e.img), type: oneOf(e.type, CRATE_TYPES, "gear"), qty: int(e.qty, 1, 1, 9999),
    cost: intOrNull(e.cost), restricted: bool(e.restricted), note: str(e.note),
    snap: isObj(e.snap) ? e.snap : {}, src: str(e.src), sort: num(e.sort), at: num(e.at)
  }),
  vehicles: (e) => ({
    uuid: str(e.uuid), name: str(e.name), img: str(e.img), primary: bool(e.primary), note: str(e.note), sort: num(e.sort)
  }),
  trackers: (e) => ({
    name: str(e.name), value: int(e.value, 0), max: intOrNull(e.max), note: str(e.note), sort: num(e.sort)
  })
};

function normEffect(e) {
  if (!isObj(e)) return null;
  const out = {
    ...e, kind: str(e.kind, "none") || "none",
    upgrades: Array.isArray(e.upgrades) ? [...new Set(e.upgrades.filter((x) => typeof x === "string"))] : [],
    raid: int(e.raid, 0, 0), applied: bool(e.applied)
  };
  if (out.prev !== undefined && !isObj(out.prev)) delete out.prev;                         // B11 (A13): the undo record is an object or nothing
  return out;
}
const normRoll = (r) => (isObj(r) ? { ...r, table: str(r.table), resultName: str(r.resultName), at: num(r.at) } : null);

export const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);   // B11 (A18): never a collection id / patch key
function normCollection(name, map) {
  const out = {};
  if (!isObj(map)) return out;
  for (const [id, e] of Object.entries(map)) {
    if (id.startsWith("-=") || UNSAFE_KEYS.has(id) || !isObj(e)) continue;
    out[id] = { ...e, ...ENTRY[name](e) };
  }
  return out;
}

/** Fills every default, coerces types, keeps unknown keys, migrates. Pure; never mutates the input. Idempotent. */
export function normalize(raw) {
  const m = migrate(raw);
  const b = isObj(m.base) ? m.base : {};
  const p = isObj(m.policy) ? m.policy : {};
  const meta = isObj(m.meta) ? m.meta : {};
  const stamp = (s) => ({ ...(isObj(s) ? s : {}), by: str(s?.by), at: num(s?.at) });
  const out = {
    ...m,
    v: Math.max(SCHEMA_VERSION, int(m.v, SCHEMA_VERSION)),
    name: str(m.name), rank: oneOf(m.rank, RANKS, "global"), motto: str(m.motto), img: str(m.img),
    purpose: str(m.purpose), background: str(m.background),
    base: {
      ...b, kind: str(b.kind), where: str(b.where), description: str(b.description), occupied: bool(b.occupied),
      rolls: { ...(isObj(b.rolls) ? b.rolls : {}), kind: normRoll(b.rolls?.kind), where: normRoll(b.rolls?.where) }
    },
    policy: {
      ...p, edit: oneOf(p.edit, POLICY_EDIT, "members"), syncHeroes: bool(p.syncHeroes, true),
      chat: oneOf(p.chat, POLICY_CHAT, "public")
    },
    meta: { ...meta, created: stamp(meta.created), updated: stamp(meta.updated) }
  };
  for (const c of COLLECTIONS) out[c] = normCollection(c, m[c]);
  return out;
}

/* ------------------------------------------------------------------ migration */
// MIGRATIONS[n] upgrades a version-n object to n+1. v0 = pre-release shape where collections were arrays.
export const MIGRATIONS = [
  (o) => {
    const r = { ...o };
    for (const c of COLLECTIONS) {
      if (Array.isArray(r[c])) {
        const map = {};
        r[c].forEach((e, i) => { if (isObj(e)) map[`m${i}`] = { sort: i, ...e }; });
        r[c] = map;
      }
    }
    r.v = 1;
    return r;
  }
];

export function migrate(raw) {
  let o = isObj(raw) ? { ...raw } : {};
  let v = int(o.v, 0, 0);
  if (v > SCHEMA_VERSION) return o;              // from a newer module: never downgrade, keep as is
  while (v < SCHEMA_VERSION) { o = MIGRATIONS[v](o); v = int(o.v, v + 1); }
  return o;
}

/* ------------------------------------------------------------------ id-keyed map helpers */
export function sortedList(map) {
  return Object.entries(isObj(map) ? map : {})
    .map(([id, e]) => ({ id, ...e }))
    .sort((a, b) => num(a.sort) - num(b.sort) || num(a.at) - num(b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export function nextSort(map) {
  const l = Object.values(isObj(map) ? map : {});
  return l.length ? Math.max(...l.map((e) => num(e.sort))) + 1 : 1;
}
const P = `flags.${FLAG_SCOPE}.${FLAG_KEY}`;
export const flagPath = (...parts) => [P, ...parts].join(".");
/** Targeted update object for one field set: patchSet("upgrades", id, {status:"broken"}). */
export function patchSet(collection, id, fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[flagPath(collection, id, k)] = v;
  return out;
}
export const patchAdd = (collection, id, entry) => ({ [flagPath(collection, id)]: entry });
export const patchRemove = (collection, id) => ({ [flagPath(collection, `-=${id}`)]: null });
export function makeId(rng = Math.random, len = 16) {
  const a = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < len; i++) s += a[Math.floor(rng() * a.length) % a.length];
  return s;
}
export const slug = (name) => str(name).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/* ------------------------------------------------------------------ prerequisites */
const DASHES = /[‐-―−]/g;
const NONE_WORDS = new Set(["", "-", "none", "n/a", "no"]);

/**
 * Parse a prerequisite line (with or without the "Prerequisite:" label).
 * knownUpgrades: array of catalog names (or {name}) so upgrade tokens are told from occupations.
 * Returns { raw, ok: true|null, none, resources: int|null, occupations[], upgrades[] (names), unparsed[] }.
 * Never throws. ok === null => unknown, show raw, the GM decides.
 */
export function parsePrerequisite(raw, knownUpgrades = []) {
  const res = { raw: typeof raw === "string" ? raw : "", ok: null, none: false, resources: null, occupations: [], upgrades: [], unparsed: [] };
  if (typeof raw !== "string") return res;
  const known = new Map();
  for (const k of knownUpgrades || []) { const n = typeof k === "string" ? k : k?.name; if (typeof n === "string") known.set(n.trim().toLowerCase(), n.trim()); }
  let s = raw.replace(DASHES, "-").replace(/\s+/g, " ").trim().replace(/^prerequisites?\s*:?\s*/i, "").replace(/[.\s]+$/, "");
  if (NONE_WORDS.has(s.toLowerCase())) { res.ok = true; res.none = true; return res; }
  if (s.length > 200 || /[;:|/\\<>{}\[\]=]/.test(s)) { res.unparsed.push(s.slice(0, 80)); return res; }
  const tokens = s.split(/\s*,\s*|\s+(?:or|and)\s+/i).map((t) => t.replace(/^(?:or|and)\s+/i, "").trim()).filter(Boolean);
  if (!tokens.length) { res.unparsed.push(s); return res; }
  for (const t of tokens) {
    const r = /^resources?(?:\s+level)?\s*(\d+)$/i.exec(t);
    if (r) { const n = Number(r[1]); res.resources = res.resources == null ? n : Math.min(res.resources, n); continue; }
    if (/^resources?\b/i.test(t)) { res.unparsed.push(t); continue; }       // "Resources" without a number
    const k = known.get(t.toLowerCase());
    if (k) { res.upgrades.push(k); continue; }
    if (/^[A-Za-z][A-Za-z' \-]{1,40}$/.test(t)) res.occupations.push(t);   // plausible occupation name
    else res.unparsed.push(t);
  }
  res.ok = res.unparsed.length ? null : true;
  return res;
}

const wordRe = (w) => new RegExp(`(^|[^a-z0-9])${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?([^a-z0-9]|$)`, "i");
export const occupationMatches = (occupationText, wanted) => typeof occupationText === "string" && occupationText !== "" && wordRe(wanted).test(occupationText);

/**
 * Evaluate a parsed prerequisite for a team.
 * ctx = { members: [{id,name,resources,occupation}], owned: [{key,name,status}] }
 * Returns { ok: true|false|null, tooPricey, reasons: [{key, params}] }.
 *  - (Resources OR occupation) group must hold when present; upgrade prerequisites are AND-required.
 *  - tooPricey: the resources/occupation group is unmet and no upgrade prerequisite is unmet.
 */
export function evalPrerequisite(pre, ctx = {}) {
  const members = Array.isArray(ctx.members) ? ctx.members : [];
  const owned = Array.isArray(ctx.owned) ? ctx.owned : [];
  if (!pre || pre.ok == null) return { ok: null, tooPricey: false, reasons: [{ key: "IPB.Up.preUnknown", params: { raw: pre?.raw ?? "" } }] };
  if (pre.none) return { ok: true, tooPricey: false, reasons: [] };
  const reasons = [];
  let groupUsed = false, groupMet = true, upgradesMet = true;

  if (pre.resources != null || pre.occupations.length) {
    groupUsed = true;
    groupMet = false;
    if (pre.resources != null) {
      const who = members.filter((m) => num(m.resources) >= pre.resources);
      if (who.length) { groupMet = true; reasons.push({ key: "IPB.Up.preResourcesMet", params: { n: pre.resources, who: who.map((m) => m.name).join(", ") } }); }
    }
    for (const occ of pre.occupations) {
      const who = members.filter((m) => occupationMatches(m.occupation, occ));
      if (who.length) { groupMet = true; reasons.push({ key: "IPB.Up.preOccupationMet", params: { occupation: occ, who: who.map((m) => m.name).join(", ") } }); }
    }
    if (!groupMet) reasons.push({ key: "IPB.Up.preGroupUnmet", params: { resources: pre.resources ?? "", occupations: pre.occupations.join(", ") } });
  }
  for (const name of pre.upgrades) {
    const o = owned.find((u) => (u.name || "").toLowerCase() === name.toLowerCase() || u.key === slug(name));
    if (!o || o.status === "broken") { upgradesMet = false; reasons.push({ key: "IPB.Up.preUpgradeUnmet", params: { name } }); }
    else if (o.status === "disabled") reasons.push({ key: "IPB.Up.preUpgradeDisabled", params: { name } });
    else reasons.push({ key: "IPB.Up.preUpgradeMet", params: { name } });
  }
  const ok = groupMet && upgradesMet;
  return { ok, tooPricey: groupUsed && !groupMet && upgradesMet, reasons };
}

/** Cost of a purchase given an evaluation. override (GM) wins. */
export function upgradeCost(evaluation, override = null) {
  if (Number.isInteger(override) && override >= 0) return { cost: override, kind: "override", blocked: false };
  if (!evaluation || evaluation.ok === null) return { cost: COST.upgrade, kind: "unknown", blocked: false };
  if (evaluation.ok) return { cost: COST.upgrade, kind: "normal", blocked: false };
  if (evaluation.tooPricey) return { cost: COST.tooPricey, kind: "tooPricey", blocked: false };
  return { cost: null, kind: "blocked", blocked: true };          // missing upgrade prerequisite: no Too Pricey
}

/* ------------------------------------------------------------------ stacking */
/** Parse stack hints out of an effect text: "twice" => 2; "several/multiple times" => unlimited; "up to four times for the same power". */
export function parseStack(text) {
  const t = typeof text === "string" ? text : "";
  const out = { max: 1, perPower: false, gm: false };
  const words = { two: 2, three: 3, four: 4, five: 5 };
  if (/up to (\w+) times for the same/i.test(t)) {
    const w = /up to (\w+) times/i.exec(t)[1].toLowerCase();
    out.max = words[w] ?? (Number(w) || 4); out.perPower = true;
  } else if (/\b(several|multiple) times\b/i.test(t)) out.max = null;
  else if (/\btwice\b|\btwo times\b/i.test(t)) out.max = 2;
  else {
    const m = /\b(three|four|five) times\b/i.exec(t);
    if (m) out.max = words[m[1].toLowerCase()];
  }
  out.gm = /\bgm\b/i.test(t) && out.max === null;
  return out;
}

/** Can another copy be added? existing = owned entries of the same key. grant (GM) bypasses the limit. */
export function checkStack(def, existing = [], { power = "", grant = false } = {}) {
  const max = def?.max === undefined ? 1 : def.max;
  const same = def?.perPower ? existing.filter((e) => (e.power || "").trim().toLowerCase() === power.trim().toLowerCase()) : existing;
  const count = same.reduce((n, e) => n + int(e.count, 1, 1), 0);
  if (max === null || count < max) return { ok: true, count, max, grant: false };
  return grant ? { ok: true, count, max, grant: true } : { ok: false, count, max, grant: false, reason: { key: "IPB.Up.stackMax", params: { count, max } } };
}

/* ------------------------------------------------------------------ allowance, training, stats */
export function allowance(rank, upgrades) {
  const total = ALLOWANCE[rank] ?? ALLOWANCE.global;
  const list = Array.isArray(upgrades) ? upgrades : Object.values(upgrades || {});
  const used = list.filter((u) => u.source === "start").reduce((n, u) => n + int(u.count, 1, 1), 0);
  return { total, used, left: Math.max(0, total - used), over: Math.max(0, used - total) };
}

export function trainingFactor(owned = []) {
  const act = owned.filter((u) => u.status !== "broken" && u.status !== "disabled" && u.status !== "installing");
  const has = (k) => act.some((u) => u.key === k);
  return has("training-simulator") ? 0.2 : has("training-facilities") ? 0.1 : 0;
}
export const trainedCost = (cost, p) => Math.round(num(cost) * (1 - p));

export function teamStats(members = []) {
  const best = (k) => members.reduce((b, m) => (num(m[k]) > b.value ? { value: num(m[k]), who: m.name } : b), { value: 0, who: "" });
  return {
    maxReputation: best("reputation"), maxResources: best("resources"),
    karmaPool: members.reduce((n, m) => n + Math.max(0, num(m.karma)), 0),
    occupations: [...new Set(members.map((m) => str(m.occupation).trim()).filter(Boolean))]
  };
}

/** Vehicle effective stats from owned vehicle upgrades. Only active ones count. Never written to the actor. */
export function vehicleStats(base = {}, owned = []) {
  const act = owned.filter((u) => u.status === "active");
  const n = (k) => act.filter((u) => u.key === k).reduce((s, u) => s + int(u.count, 1, 1), 0);
  const b = (k) => num(base[k]);
  const bonus = {
    durability: 2 * n("vehicle-defense"), armor: n("vehicle-defense"),
    maneuverability: n("vehicle-mobility"), speed: n("vehicle-mobility"),
    passengers: n("vehicle-room") > 0 ? b("passengers") : 0
  };
  const stats = {};
  for (const k of ["passengers", "maneuverability", "speed", "durability", "armor"]) stats[k] = { base: b(k), bonus: bonus[k] ?? 0, total: b(k) + (bonus[k] ?? 0) };
  return stats;
}

/* ------------------------------------------------------------------ karma pooling */
/**
 * members: [{id, karma}], cost: int. Even split capped by each hero's karma, remainder to the richest first.
 * Returns [{actorId, amount}] (amount > 0, sum === cost, amount <= karma) or null when the pool is short / input invalid.
 */
export function planKarma(members, cost) {
  if (!Number.isInteger(cost) || cost < 0 || !Array.isArray(members)) return null;
  const hs = members.map((m) => ({ id: String(m.id), cap: int(m.karma, 0, 0), amt: 0 }));
  if (new Set(hs.map((h) => h.id)).size !== hs.length) return null;
  if (hs.reduce((s, h) => s + h.cap, 0) < cost) return null;
  let rest = cost;
  while (rest > 0) {
    const open = hs.filter((h) => h.amt < h.cap);
    const share = Math.floor(rest / open.length);
    if (share === 0) {
      open.sort((a, b) => (b.cap - b.amt) - (a.cap - a.amt) || b.cap - a.cap || (a.id < b.id ? -1 : 1));
      for (let i = 0; i < rest; i++) open[i].amt += 1;
      rest = 0;
    } else {
      for (const h of open) { const t = Math.min(share, h.cap - h.amt); h.amt += t; rest -= t; }
    }
  }
  return hs.filter((h) => h.amt > 0).map((h) => ({ actorId: h.id, amount: h.amt }));
}

/** Validate a manual split (the pooling dialog): returns { ok, total, missing, errors:[{key,params}] }. */
export function validateSplit(split, members, cost) {
  const errors = [];
  const byId = new Map((members || []).map((m) => [String(m.id), int(m.karma, 0, 0)]));
  let total = 0;
  for (const s of split || []) {
    const a = s?.amount;
    if (!Number.isInteger(a) || a < 0) { errors.push({ key: "IPB.Karma.badAmount", params: { actorId: s?.actorId } }); continue; }
    if (!byId.has(String(s.actorId))) { errors.push({ key: "IPB.Karma.unknownHero", params: { actorId: s.actorId } }); continue; }
    if (a > byId.get(String(s.actorId))) errors.push({ key: "IPB.Karma.overKarma", params: { actorId: s.actorId, karma: byId.get(String(s.actorId)) } });
    total += a;
  }
  if (total !== cost) errors.push({ key: "IPB.Karma.poolMismatch", params: { total, cost } });
  return { ok: errors.length === 0, total, missing: cost - total, errors };
}

/* ------------------------------------------------------------------ base events */
// Data-driven band config. Keys are band ids "low-high" (short identifiers); effect kinds are ours.
export const BAND_CONFIG = Object.freeze({
  v: 1,
  bands: Object.freeze({
    "11-36": { effect: "none" },
    "41-43": { effect: "note" },       // theft: note only
    "44-45": { effect: "note" },       // exposure: note only
    "46-52": { effect: "disable", dice: 6 },
    "53-56": { effect: "break" },
    "61-63": { effect: "raid", dice: 3, sides: 6 },
    "64-65": { effect: "aiControl" },
    "66-66": { effect: "occupy" }
  })
});
const bandLow = (id) => Number(String(id).split("-")[0]);
export const EXPECTED_LOWERS = Object.keys(BAND_CONFIG.bands).map(bandLow).sort((a, b) => a - b);

export const isD66 = (n) => Number.isInteger(n) && n >= 11 && n <= 66 && n % 10 >= 1 && n % 10 <= 6;
export const d66 = (tens, ones) => (Number.isInteger(tens) && Number.isInteger(ones) && tens >= 1 && tens <= 6 && ones >= 1 && ones <= 6 ? tens * 10 + ones : null);
export const bandId = (low, high) => `${low}-${high}`;

/**
 * Compare the table's result ranges (list of [low, high]) with the expected bands.
 * Returns { ok, bands:[{id,low,high}], reason }. ok:false => text only, no effect proposals.
 */
export function resolveBands(tableRanges) {
  if (!Array.isArray(tableRanges) || !tableRanges.length) return { ok: false, bands: [], reason: "noTable" };
  const bands = tableRanges
    .filter((r) => Array.isArray(r) && Number.isInteger(r[0]) && Number.isInteger(r[1]))
    .map(([low, high]) => ({ id: bandId(low, high), low, high })).sort((a, b) => a.low - b.low);
  if (!bands.length) return { ok: false, bands: [], reason: "badRanges" };
  const lowers = bands.map((b) => b.low);
  const same = lowers.length === EXPECTED_LOWERS.length && lowers.every((l, i) => l === EXPECTED_LOWERS[i]);
  return { ok: same, bands, reason: same ? "" : "bandsMismatch" };
}
export const defaultBands = () => Object.keys(BAND_CONFIG.bands).map((id) => ({ id, low: bandLow(id), high: Number(id.split("-")[1]) })).sort((a, b) => a.low - b.low);

/** D66 value -> band id (or null when outside every band / not a D66). */
export function bandForRoll(roll, bands = defaultBands()) {
  if (!isD66(roll)) return null;
  const b = bands.find((x) => roll >= x.low && roll <= x.high);
  return b ? b.id : null;
}
/** Effect kind for a band id; unknown/unsupported => "text". Band is matched by lower bound so a reflow of the high end is harmless. */
export function bandEffect(id) {
  const low = bandLow(id);
  const key = Object.keys(BAND_CONFIG.bands).find((k) => bandLow(k) === low);
  return key ? { ...BAND_CONFIG.bands[key], band: key } : { effect: "text", band: id };
}
export const knownBand = (id) => Object.keys(BAND_CONFIG.bands).some((k) => bandLow(k) === bandLow(id));

const rollDie = (rng, sides) => 1 + Math.floor(rng() * sides);
export function pickDistinct(list, n, rng = Math.random) {
  const a = list.slice(); const out = [];
  while (out.length < n && a.length) out.push(a.splice(Math.floor(rng() * a.length), 1)[0]);
  return out;
}

/**
 * Propose (never apply) an effect. upgrades: [{id,status}] of the team. bandsOk false => text only.
 * Returns an effect object {kind, upgrades[], raid, rolled, applied:false} or null for text-only.
 */
export function proposeEffect(id, upgrades = [], { rng = Math.random, bandsOk = true } = {}) {
  if (!bandsOk) return null;
  const cfg = bandEffect(id);
  const base = { kind: cfg.effect, upgrades: [], raid: 0, rolled: 0, applied: false };
  const active = upgrades.filter((u) => u.status === "active");
  switch (cfg.effect) {
    case "disable": {
      const n = rollDie(rng, cfg.dice ?? 6);
      return { ...base, rolled: n, upgrades: pickDistinct(active.map((u) => u.id), n, rng) };
    }
    case "break": {
      const pool = upgrades.filter((u) => u.status === "active" || u.status === "installing").map((u) => u.id);
      return { ...base, upgrades: pickDistinct(pool, 1, rng) };
    }
    case "raid": {
      let sum = 0; for (let i = 0; i < (cfg.dice ?? 3); i++) sum += rollDie(rng, cfg.sides ?? 6);
      return { ...base, raid: sum, rolled: sum };
    }
    case "none": case "note": case "aiControl": case "occupy": return base;
    default: return null;
  }
}

/** Relative (to B) patch an applied effect would make. Returns {} for no state change. Caller marks effect.applied. */
export function effectPatch(effect, B) {
  const p = {};
  if (!effect) return p;
  if (effect.kind === "disable") for (const u of effect.upgrades) if (B?.upgrades?.[u]) p[`upgrades.${u}.status`] = "disabled";
  if (effect.kind === "break") for (const u of effect.upgrades) if (B?.upgrades?.[u]) p[`upgrades.${u}.status`] = "broken";
  if (effect.kind === "occupy") p["base.occupied"] = true;
  return p;
}

/** Oldest-first ids to remove so the events map stays within cap. */
export function pruneEvents(events, cap = LIMITS.events) {
  const l = sortedList(events).sort((a, b) => num(a.at) - num(b.at) || num(a.sort) - num(b.sort));
  return l.length > cap ? l.slice(0, l.length - cap).map((e) => e.id) : [];
}

/* ------------------------------------------------------------------ hero text mirror */
export const formatTeam = (B) => str(B?.name).trim();
export const parseTeam = (text) => (str(text).split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "");

/** One upgrade -> "Name", "Name x2", "Power Effect (Flight)", "Power Effect (Flight) x2". */
export function formatUpgrade(u) {
  const name = str(u.name).trim() || str(u.key);
  const power = str(u.power).trim();
  const n = int(u.count, 1, 1);
  return `${name}${power ? ` (${power})` : ""}${n > 1 ? ` x${n}` : ""}`;
}
/** "kind, where; upgrades: A, B x2". Upgrades arrive as a list or map; order = sort. Broken/none counted too (it is a record of ownership). */
export function formatTeamBase(B) {
  const kind = str(B?.base?.kind).trim(), where = str(B?.base?.where).trim();
  const head = [kind, where].filter(Boolean).join(", ");
  const ups = sortedList(B?.upgrades).map(formatUpgrade);
  return ups.length ? `${head}${head ? "; " : ""}upgrades: ${ups.join(", ")}` : head;
}

function splitTop(s) {
  const out = []; let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++; else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}
/**
 * Inverse of formatTeamBase. catalog = names (or {key,name}) used to resolve keys; unmatched => key "custom".
 * Known limitation: a kind that itself contains a comma or semicolon does not round-trip (first comma splits kind/where).
 */
export function parseTeamBase(text, catalog = []) {
  const t = str(text).replace(/\s+/g, " ").trim();
  const names = new Map();
  for (const c of catalog) { const n = typeof c === "string" ? c : c?.name; if (n) names.set(n.toLowerCase(), { key: c?.key || slug(n), name: n }); }
  const m = /(?:^|;)\s*upgrades\s*:\s*(.*)$/i.exec(t);
  const head = (m ? t.slice(0, m.index) : t).trim();
  const i = head.indexOf(",");
  const kind = (i < 0 ? head : head.slice(0, i)).trim();
  const where = (i < 0 ? "" : head.slice(i + 1)).trim();
  const upgrades = [];
  if (m) for (let item of splitTop(m[1])) {
    let count = 1, power = "";
    const c = /\s+[x×](\d+)$/i.exec(item);
    if (c) { count = Math.max(1, Number(c[1])); item = item.slice(0, c.index).trim(); }
    if (item.endsWith(")")) {                       // trailing balanced "(...)" group; may nest
      let depth = 0, at = -1;
      for (let i = item.length - 1; i >= 0; i--) { if (item[i] === ")") depth++; else if (item[i] === "(" && --depth === 0) { at = i; break; } }
      if (at > 0) { power = item.slice(at + 1, -1).trim(); item = item.slice(0, at).trim(); }
    }
    if (!item) continue;
    const hit = names.get(item.toLowerCase());
    upgrades.push({ key: hit ? hit.key : "custom", name: hit ? hit.name : item, count, power });
  }
  return { kind, where, upgrades };
}

/** Decide what to do with a hero text field: "same" | "push" | "conflict". pushed = last value we wrote (hero flag). */
export function mirrorAction(current, pushed, next) {
  const c = str(current).trim(), p = str(pushed).trim(), n = str(next).trim();
  if (c === n) return "same";
  if (c === "" || c === p) return "push";
  return "conflict";
}

/* ------------------------------------------------------------------ crate snapshots, size guard */
/** Strip volatile/ownership data from an Item.toObject() snapshot. Returns a new object. */
export function stripSnapshot(data) {
  const s = clone(isObj(data) ? data : {});
  for (const k of ["_id", "ownership", "_stats", "sort", "folder"]) delete s[k];
  if (Array.isArray(s.effects)) s.effects = s.effects.map((e) => { const x = { ...e }; delete x._id; delete x.origin; delete x._stats; return x; });
  return s;
}
export const byteSize = (o) => new TextEncoder().encode(JSON.stringify(o ?? null)).length;
/** Would adding `extraBytes` push the card over the limit? */
export const sizeGuard = (B, extraBytes = 0) => {
  const bytes = byteSize(B) + extraBytes;
  return { ok: bytes <= LIMITS.bytes, bytes, limit: LIMITS.bytes };
};
export const canAdd = (B, collection) => {
  const n = Object.keys(B?.[collection] || {}).length;
  const cap = LIMITS[collection];
  return n < cap ? { ok: true, count: n, cap } : { ok: false, count: n, cap, key: `IPB.Err.${collection}Full` };
};

/* ------------------------------------------------------------------ validation (message KEYS only) */
/** Returns [{level:"error"|"warn", key, params, path}]. Does not throw. */
export function validate(raw) {
  const out = [];
  const add = (level, key, path, params = {}) => out.push({ level, key, params, path });
  if (!isObj(raw)) { add("error", "IPB.Val.notObject", ""); return out; }
  if (int(raw.v, 0, 0) > SCHEMA_VERSION) add("warn", "IPB.Val.newerVersion", "v", { v: raw.v });
  if (!RANKS.includes(raw.rank)) add("error", "IPB.Val.rank", "rank", { rank: raw.rank });
  if (!str(raw.name).trim()) add("warn", "IPB.Val.nameEmpty", "name");
  if (raw.policy && (!POLICY_EDIT.includes(raw.policy.edit) || !POLICY_CHAT.includes(raw.policy.chat))) add("error", "IPB.Val.policy", "policy");
  const B = normalize(raw);
  for (const c of COLLECTIONS) {
    const n = Object.keys(B[c]).length;
    if (n > LIMITS[c]) add("error", `IPB.Err.${c}Full`, c, { count: n, cap: LIMITS[c] });
  }
  for (const [id, u] of Object.entries(raw.upgrades || {})) {
    if (!isObj(u)) { add("error", "IPB.Val.entry", `upgrades.${id}`); continue; }
    if (u.status !== undefined && !STATUSES.includes(u.status)) add("error", "IPB.Val.upgradeStatus", `upgrades.${id}.status`, { status: u.status });
    if (u.count !== undefined && !(Number.isInteger(u.count) && u.count >= 1)) add("error", "IPB.Val.upgradeCount", `upgrades.${id}.count`, { count: u.count });
    if (u.source !== undefined && !SOURCES.includes(u.source)) add("error", "IPB.Val.upgradeSource", `upgrades.${id}.source`, { source: u.source });
  }
  const a = allowance(B.rank, B.upgrades);
  if (a.over > 0) add("warn", "IPB.Val.startOverAllowance", "upgrades", { used: a.used, total: a.total });
  for (const [id, e] of Object.entries(raw.events || {})) {
    if (isObj(e) && e.roll !== undefined && e.roll !== 0 && !isD66(e.roll)) add("error", "IPB.Val.rollRange", `events.${id}.roll`, { roll: e.roll });
  }
  for (const [id, e] of Object.entries(B.events)) if (e.band && !knownBand(e.band)) add("warn", "IPB.Val.bandUnknown", `events.${id}.band`, { band: e.band });
  const prim = Object.values(B.vehicles).filter((v) => v.primary).length;
  if (prim > 1) add("warn", "IPB.Val.manyPrimaryVehicles", "vehicles", { count: prim });
  for (const [id, t] of Object.entries(B.trackers)) if (t.max !== null && t.value > t.max) add("warn", "IPB.Val.trackerOverMax", `trackers.${id}`, { value: t.value, max: t.max });
  const sz = sizeGuard(B);
  if (!sz.ok) add("error", "IPB.Err.tooBig", "", { bytes: sz.bytes, limit: sz.limit });
  return out;
}

// ------------------------------------------------------------------ B4b: the card lives in a real Actor
export const TEAM_BASE_KIND = "teamBase";          // marker: flags[FLAG_SCOPE][FLAG_KEY].kind (heroes carry flags.base.team only, so the marker tells a card from a hero link)
// true when the picture is "no picture": empty, or one of the module / system default artworks (`defaults` = exact paths or file names).
export function isDefaultArt(img, defaults = []) {
  const s = str(img).trim();
  if (!s) return true;
  return defaults.some((d) => s === d || s.endsWith(`/${d}`));
}
// Create data of the host record for a card that used to be a journal-shaped record { name, img?, ownership?, flags }.
// cfg: { type (host type), folder, defaultImg, sheetClass, rid? }. The schema is untouched (normalize), only the home changes: the host's
// name and img carry the team name and the base picture, so B.img is emptied; the old id is remembered (flags.migratedFrom).
export function cardActorData(entry, cfg) {
  const raw = isObj(entry?.flags?.[FLAG_SCOPE]?.[FLAG_KEY]) ? entry.flags[FLAG_SCOPE][FLAG_KEY] : {};
  const B = normalize(raw);
  const name = clampText(str(entry?.name).trim() || str(B.name).trim(), 80) || "Team";
  const img = str(B.img).trim() || cfg.defaultImg;
  B.name = name;
  B.img = "";
  B.kind = TEAM_BASE_KIND;
  const own = Number.isInteger(entry?.ownership?.default) ? entry.ownership.default : 2;
  const flags = { core: { sheetClass: cfg.sheetClass }, [FLAG_SCOPE]: { [FLAG_KEY]: B } };
  if (entry?.id) flags[FLAG_SCOPE].migratedFrom = String(entry.id);
  if (cfg.rid) flags[FLAG_SCOPE].rid = String(cfg.rid);
  return {
    name, type: cfg.type, img, folder: cfg.folder ?? null, ownership: { default: own },
    prototypeToken: { name, actorLink: true, texture: { src: img } }, flags
  };
}

// ------------------------------------------------------------------ B4c: the team's rank is DERIVED from its members (no rank select any more)
// A hero's rank: the rank its chargen run recorded (flags.invincible-plus-ultra.chargen.rank) = source "flag"; a hand-made hero has none, so it is ESTIMATED from
// what the chargen rules would have given it = source "inferred". Estimate: every power slot costs 2 attribute points (rules.mjs SLOT_VALUE), so
// attrSum + 2 * powers is nearly independent of the build and sits at 24 / 32 / 40 / 48 for Teen / Street / Global / Cosmic (points + 2 * starting slots);
// the midpoints 28 / 36 / 44 split the ranks. The largest attribute is a second witness (caps 6 / 8 / 10 / 12): a hero with a 9 is at least Global.
// The higher of the two readings wins; a hero with fewer than 16 attribute points in total (a blank sheet has 12) is "unknown" and is ignored.
export const RANK_SCORE_CUTS = Object.freeze([28, 36, 44]);          // < 28 teen, < 36 street, < 44 global, else cosmic
export const RANK_CAPS = Object.freeze([6, 8, 10, 12]);               // per-attribute cap by rank index
export const RANK_MIN_ATTR_SUM = 16;               // a new sheet starts at 2 x 6 = 12: nothing to read yet; the lowest chargen rank (Teen) has 20
const rankIdx = (r) => RANKS.indexOf(r);
/** { attrSum, maxAttr, powers } -> rank id or null (unknown). */
export function inferRank(info) {
  const { attrSum = 0, maxAttr = 0, powers = 0 } = isObj(info) ? info : {};
  const sum = num(attrSum), max = num(maxAttr), pw = Math.max(0, num(powers));
  if (sum < RANK_MIN_ATTR_SUM) return null;
  const score = sum + 2 * pw;
  const byScore = RANK_SCORE_CUTS.filter((c) => score >= c).length;
  const capIdx = RANK_CAPS.findIndex((c) => max <= c);
  const byCap = capIdx < 0 ? RANKS.length - 1 : capIdx;
  return RANKS[Math.max(byScore, byCap)];
}
/** One hero: { flagRank, attrSum, maxAttr, powers } -> { rank: id|null, source: "flag"|"inferred"|"unknown" }. */
export function heroRank(info) {
  info = isObj(info) ? info : {};
  if (RANKS.includes(info.flagRank)) return { rank: info.flagRank, source: "flag" };
  const r = inferRank(info);
  return r ? { rank: r, source: "inferred" } : { rank: null, source: "unknown" };
}
/** The rank of a team. members = [{ id, name, rank|null, source }]; stored = the card's own B.rank (legacy / creation default, never shown):
    used only when no member has a known rank. Highest known member rank wins (mixed ranks resolve upwards). Never throws.
    -> { rank, source: "members"|"stored"|"default", mixed, ranks: [distinct, low -> high], counts: {id: n}, unknown, inferred } */
export function deriveRank(members = [], { stored } = {}) {
  const list = (Array.isArray(members) ? members : []).filter(isObj);
  const known = list.filter((m) => RANKS.includes(m.rank));
  const ranks = RANKS.filter((r) => known.some((m) => m.rank === r));
  const counts = Object.fromEntries(ranks.map((r) => [r, known.filter((m) => m.rank === r).length]));
  const base = { mixed: ranks.length > 1, ranks, counts, unknown: list.length - known.length, inferred: known.filter((m) => m.source === "inferred").length };
  if (ranks.length) return { ...base, rank: ranks[ranks.length - 1], source: "members" };
  if (RANKS.includes(stored)) return { ...base, rank: stored, source: "stored" };
  return { ...base, rank: "global", source: "default" };
}

/* ------------------------------------------------------------------ B11: hardening, ownership plan, rate limit */
/** B11 (A15a, user decision): the book lets a team choose ANY starting upgrades, so a starting pick is never blocked by an unmet prerequisite for anyone
    (the starting allowance still applies). Karma purchases keep prerequisites / Too Pricey. Set to false to restore the old rule (players must meet it). */
export const START_IGNORES_PREREQ = true;

/** Plain recursive merge with the Foundry convention "-=key": null deleting a key. Skips __proto__ / constructor / prototype (A18). Mutates and returns target. */
export function mergePatch(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    const bare = k.startsWith("-=") ? k.slice(2) : k;
    if (UNSAFE_KEYS.has(bare)) continue;
    if (k.startsWith("-=")) { delete target[bare]; continue; }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== "object" || Array.isArray(target[k])) target[k] = {};
      mergePatch(target[k], v);
    } else target[k] = v;
  }
  return target;
}

export const OWN = Object.freeze({ NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 });
/** B11 (A3, A4): the ownership a base card should have, keeping what the GM chose by hand.
    in:  { policy: "gm"|"members"|"everyone", have: current ownership object, gen: the user ids this module granted OWNER to last time (undefined = never
           recorded: every non-staff OWNER is then taken to be a generated grant, the old behaviour), want: user ids that own a VOUCHED linked hero,
           users: [{ id, staff }] the users that exist now }
    out: { ownership, gen }
    Rules: staff keys stay as they are; a generated OWNER the user no longer deserves is removed (falls back to default); every other per-user level
    (LIMITED / NONE / a manual OWNER) is kept; `default` is OWNER for policy everyone, otherwise the current default capped at OBSERVER (a manual NONE or
    LIMITED hides the base from non-members); deleted users are dropped. Pure and idempotent: plan(plan(x)) == plan(x). */
export function planOwnership({ policy, have, gen, want = [], users = [] } = {}) {
  const cur = isObj(have) ? have : {};
  const staff = new Set(users.filter((u) => u.staff).map((u) => u.id));
  const exists = new Set(users.map((u) => u.id));
  const prevGen = new Set(Array.isArray(gen) ? gen : Object.entries(cur).filter(([k, v]) => k !== "default" && v === OWN.OWNER && !staff.has(k)).map(([k]) => k));
  const wantSet = new Set(policy === "members" ? (Array.isArray(want) ? want : []).filter((id) => exists.has(id) && !staff.has(id)) : []);
  let def = Number.isInteger(cur.default) ? cur.default : OWN.OBSERVER;
  def = policy === "everyone" ? OWN.OWNER : Math.min(def, OWN.OBSERVER);
  const ownership = { default: def };
  const nextGen = new Set();
  for (const [k, v] of Object.entries(cur)) {
    if (k === "default" || !exists.has(k) || UNSAFE_KEYS.has(k)) continue;
    if (staff.has(k)) { ownership[k] = v; continue; }
    if (v === OWN.OWNER && prevGen.has(k)) { if (!wantSet.has(k)) continue; nextGen.add(k); }
    ownership[k] = v;
  }
  for (const k of wantSet) { if (ownership[k] !== OWN.OWNER) { ownership[k] = OWN.OWNER; nextGen.add(k); } }
  return { ownership, gen: [...nextGen].sort() };
}
/** Do two ownership objects say the same thing? (key order ignored) */
export function sameOwnership(a, b) {
  const x = isObj(a) ? a : {}, y = isObj(b) ? b : {};
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  return [...keys].every((k) => (x[k] ?? null) === (y[k] ?? null));
}

/** B11 (A9): sliding-window rate limit. `hits` is a Map key -> [timestamps]; returns { ok, retryMs } and records the hit when allowed. */
export function rateHit(hits, key, now, limit, windowMs) {
  const arr = (hits.get(key) ?? []).filter((x) => now - x < windowMs);
  if (arr.length >= limit) { hits.set(key, arr); return { ok: false, retryMs: windowMs - (now - arr[0]) }; }
  arr.push(now);
  hits.set(key, arr);
  return { ok: true, retryMs: 0 };
}
/** B11 (A13): a crate row may only be given when its snapshot really is the declared type. */
export function snapMatches(row) { return !!row && isObj(row.snap) && row.snap.type === row.type; }
