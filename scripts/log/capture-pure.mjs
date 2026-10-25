/* Activity log - capture helpers (phase L3). PURE: no Foundry globals, runs in Node and in the browser. The scribe (scribe.mjs) feeds these with plain objects. */
import { MOD_ID } from "./events.mjs";
import { flatten, diffFlat, ATTRS, VITALS, TRACKS, TEXT_KEYS } from "./diff.mjs";
import { clampText, deepEqual, clone } from "./model.mjs";

export const LEVEL_NAMES = Object.freeze({ "-1": "INHERIT", 0: "NONE", 1: "LIMITED", 2: "OBSERVER", 3: "OWNER" });
export const levelName = (n) => (typeof n === "string" ? n : LEVEL_NAMES[n] ?? "NONE");
export const LEVEL_NUM = Object.freeze({ NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 });

/* ------------------------------------------------------------------ actor mirror (tracked source paths, flat) */
/** Flat map of the tracked part of an actor's source data (scope hero | base). Ownership is turned into level names; chargen markers are synthetic paths. */
export function actorMirror(src, scope = "hero") {
  const o = {};
  if (src.name !== undefined) o.name = src.name;
  if (src.img !== undefined) o.img = src.img;
  const tok = src.prototypeToken && src.prototypeToken.texture && src.prototypeToken.texture.src;
  if (tok !== undefined && scope === "hero") o["prototypeToken.texture.src"] = tok;
  const own = src.ownership || {};
  for (const [u, lvl] of Object.entries(own)) o[`ownership.${u}`] = levelName(lvl);
  if (!("default" in own)) o["ownership.default"] = "NONE";
  const f = (src.flags && src.flags[MOD_ID]) || {};
  if (scope === "hero") {
    if (src.system) Object.assign(o, flatten({ system: src.system }));
    if (f.base && f.base.team !== undefined) o[`flags.${MOD_ID}.base.team`] = f.base.team;
    o["__chargen.runId"] = (f.chargen && f.chargen.runId) || "";
    o["__chargen.backup"] = !!f.chargenBackup;
  } else if (f.base) Object.assign(o, flatten({ flags: { [MOD_ID]: { base: f.base } } }));
  return o;
}

/** Persisted snapshot source (makeSnapshot input) from the same plain source data. items: {id: snapString}. */
export function snapshotSource(src, scope, items = {}) {
  const out = { name: src.name, items, ownership: {} };
  const own = src.ownership || {};
  for (const [u, lvl] of Object.entries(own)) out.ownership[u] = levelName(lvl);
  if (!("default" in own)) out.ownership.default = "NONE";
  const sys = src.system || {};
  if (scope === "hero") {
    out.attributes = {}; for (const k of ATTRS) { const v = sys.attributes && sys.attributes[k]; out.attributes[k] = v && typeof v === "object" ? v.value : v; }
    out.derived = {}; for (const k of VITALS) { const v = sys.derived && sys.derived[k]; out.derived[k] = v && typeof v === "object" ? v.value : v; }
    out.tracks = {}; for (const k of TRACKS) { const v = sys[k]; out.tracks[k] = v && typeof v === "object" ? v.value : v; }
    out.texts = {}; for (const k of [...TEXT_KEYS, "biography"]) { const v = sys[k]; out.texts[k] = v && typeof v === "object" ? v.value : v; }
  } else {
    const b = (src.flags && src.flags[MOD_ID] && src.flags[MOD_ID].base) || {};
    const bb = b.base || {};
    out.card = { kind: bb.kind ?? "", where: bb.where ?? "", description: bb.description ?? "", occupied: !!bb.occupied, purpose: b.purpose ?? "", background: b.background ?? "", motto: b.motto ?? "" };
  }
  return out;
}

/* ------------------------------------------------------------------ item mirror */
const ITEM_SKIP = /^system\.(automations|description)(\.|$)/;
/** Flat mirror of an item's tracked data. resolve(id) turns a powerSource id into a name. Long texts / arrays become lengths. */
export function itemMirror(src, resolve = (x) => x) {
  const o = { name: src.name };
  const sys = src.system || {};
  const flat = flatten({ system: sys });
  for (const [p, v] of Object.entries(flat)) {
    if (ITEM_SKIP.test(p)) continue;
    if (p === "system.powerSource") o[p] = v ? resolve(v) : "";
    else if (Array.isArray(v)) o[`${p}#len`] = v.length;
    else o[p] = v;
  }
  if (typeof sys.description === "string") o["description#len"] = sys.description.length;
  if (sys.automations && typeof sys.automations === "object") o["automations#len"] = Object.keys(sys.automations).length;
  return o;
}
/** Diff two item mirrors -> [{p, from, to}] (description / automations / arrays as {p, len:[a,b]}). */
export function diffItemMirror(a, b) {
  const out = [];
  for (const c of diffFlat(a, b, { ignore: [] })) {
    if (c.p.endsWith("#len")) out.push({ p: c.p.slice(0, -4), len: [c.from ?? 0, c.to ?? 0] });
    else out.push({ p: c.p, from: typeof c.from === "string" ? clampText(c.from, 120) : c.from ?? null, to: typeof c.to === "string" ? clampText(c.to, 120) : c.to ?? null });
  }
  return out;
}

/** Merges bursts of item edits (typing a name) per key; emits when idle > slidingMs or older than maxMs. */
export class EditBuffer {
  constructor(slidingMs = 2000, maxMs = 20000) { this.s = slidingMs; this.m = maxMs; this.open = new Map(); }
  add(key, base, changes, t) {
    let b = this.open.get(key);
    if (!b) { b = { key, base: clone(base), t, last: t, map: new Map() }; this.open.set(key, b); }
    b.last = Math.max(b.last, t);
    for (const c of changes) {
      const cur = b.map.get(c.p);
      if (!cur) b.map.set(c.p, { p: c.p, from: c.from, to: c.to, len: c.len ? [c.len[0], c.len[1]] : undefined });
      else { cur.to = c.to; if (c.len) cur.len = [cur.len ? cur.len[0] : c.len[0], c.len[1]]; }
    }
  }
  drain(now, force = false) {
    const out = [];
    for (const [k, b] of [...this.open]) {
      if (force || now - b.last > this.s || now - b.t > this.m) {
        this.open.delete(k);
        const changes = [...b.map.values()].filter((c) => (c.len ? c.len[0] !== c.len[1] : !deepEqual(c.from, c.to))).map((c) => { const x = { p: c.p }; if (c.len) x.len = c.len; else { x.from = c.from; x.to = c.to; } return x; });
        if (changes.length) out.push({ key: k, base: b.base, t: b.t, t2: b.last, changes });
      }
    }
    return out;
  }
  nextDueAt() { let due = null; for (const b of this.open.values()) { const t = Math.min(b.last + this.s + 1, b.t + this.m + 1); due = due === null ? t : Math.min(due, t); } return due; }
}

/* ------------------------------------------------------------------ chat / rolls */
/** Roll mode from a message-like {whisper:[ids], blind, author} and the GM user ids. "self" = whispered to the author alone. */
export function rollModeOf(msg, gmIds = []) {
  const w = Array.isArray(msg.whisper) ? msg.whisper : [];
  if (msg.blind) return "blind";
  if (!w.length) return "public";
  if (w.length === 1 && w[0] === msg.author) return "self";
  if (w.every((id) => id === msg.author)) return "self";
  return "gm";
}
/** Plain roll facts from a YearZero-like roll object. */
export function rollInfo(roll) {
  const out = { s: 0, b: 0, p: 0, dice: [] };
  if (!roll) return out;
  out.s = Number(roll.successCount) || 0; out.b = Number(roll.baneCount) || 0; out.p = Number(roll.pushCount) || 0;
  try {
    for (const die of roll.dice || []) for (const r of die.results || []) { if (out.dice.length < 24 && Number.isFinite(r.result)) out.dice.push(r.result); }
  } catch { /* ignore */ }
  const o = roll.options || {};
  if (Number.isFinite(Number(o.stressCost)) && Number(o.stressCost) > 0) out.str = Number(o.stressCost);
  if (Number.isFinite(Number(roll.attackDamage)) && Number(roll.attackDamage) > 0) out.dmg = Number(roll.attackDamage);
  return out;
}
/** Damage taken from the card's HTML: [actorName, amount, injuryName?]. */
export function damageFacts(content) {
  const strongs = [...String(content || "").matchAll(/<strong>([\s\S]*?)<\/strong>/g)].map((m) => m[1].replace(/<[^>]*>/g, "").trim());
  const amount = Number(strongs[1]);
  return { name: strongs[0] || "", amount: Number.isFinite(amount) ? amount : 0, injury: strongs[2] || "" };
}

/* ------------------------------------------------------------------ snapshot persistence (flag keys must not contain dots) */
export const encKey = (k) => String(k).replace(/\./g, "~");
export const decKey = (k) => String(k).replace(/~/g, ".");
/** Persisted form: {enc key: value}; texts etc unchanged. */
export function encodeSnap(flat) { const o = {}; for (const [k, v] of Object.entries(flat)) o[encKey(k)] = v; return o; }
export function decodeSnap(enc) { const o = {}; for (const [k, v] of Object.entries(enc || {})) o[decKey(k)] = v; return o; }
/** Diff of two flat snapshots as flag update ops: {set:{enc:value}, del:[enc]}. */
export function snapOps(prev, next) {
  const set = {}, del = [];
  for (const k of Object.keys(next)) if (k !== "at" && !deepEqual(prev[k], next[k])) set[encKey(k)] = next[k];
  for (const k of Object.keys(prev)) if (k !== "at" && !(k in next)) del.push(encKey(k));
  set.at = next.at;
  return { set, del };
}

/* ------------------------------------------------------------------ permissions */
/** Users (non-GM) that get OBSERVER on a log journal. users [{id,isGM}], ownership {userId|default: level}. readAccess gm | owners | observers. */
export function readersOf(ownership, users, readAccess = "owners") {
  const out = [];
  if (readAccess === "gm") return out;
  const need = readAccess === "observers" ? 2 : 3;
  const def = typeof ownership.default === "string" ? (LEVEL_NUM[ownership.default] ?? 0) : ownership.default ?? 0;
  for (const u of users) {
    if (u.isGM) continue;
    const raw = ownership[u.id];
    let lvl = raw === undefined ? def : typeof raw === "string" ? (LEVEL_NUM[raw] ?? 0) : raw;
    if (lvl < 0) lvl = def;
    if (lvl >= need) out.push(u.id);
  }
  return out.sort();
}
/** The ownership object of a log journal. */
export function journalOwnership(readerIds) {
  const o = { default: 0 };
  for (const id of readerIds) o[id] = 2;
  return o;
}
/** Deterministic 16-char document ids (concurrent creation by two scribe tabs collides instead of duplicating). */
export const pageDocId = (actorId, no, secret = false) => `${String(actorId).slice(0, 10).padEnd(10, "0")}${secret ? "s" : "c"}${String(no).padStart(5, "0")}`;
export const GM_JOURNAL_ID = "IPLogGMonly00001";
export const LOG_FOLDER_ID = "IPLogFolder00001";
