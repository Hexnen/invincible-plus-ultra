/* Activity log - coalescing, bulk collapse, absorb, explain, roll patch, throttle (phase L2). PURE: no Foundry globals. Spec 2.3, 3.3, 3.4. */
import { typeDef } from "./events.mjs";
import { deepEqual, clone, makeId, normalizeEntry, patchEntry } from "./model.mjs";

/** Timing constants (ms). Spec values; change here only. */
export const TIMING = Object.freeze({
  slidingMs: 2000,        // same key within 2 s extends the entry
  maxMs: 20000,           // an entry never extends past 20 s
  bioSlidingMs: 30000,    // biography: one entry per 30 s per user
  bioMaxMs: 120000,
  bulkWindowMs: 1500,     // bulk collapse window (gap between ops)
  bulkHardMs: 6000,       // hard cap of one bulk group
  bulkEmbedded: 5,        // >= 5 embedded document operations ...
  bulkFields: 8,          // ... or >= 8 changed tracked paths
  bulkKids: 50,
  absorbMs: 3000,
  explainDamageMs: 6000,
  explainStressMs: 4000,
  throttleMax: 200,
  throttleWindowMs: 60000,
  quietFlushMs: 1500,     // writer: flush after this much quiet
  coalesceFlushNote: "open entries are emitted when idle > slidingMs or older than maxMs; forced on unload"
});

/** Types whose repeated edits merge (they carry d.from / d.to). */
export const MERGE_TYPES = new Set([
  "stat.attr", "stat.vital", "stat.track", "stat.text", "actor.rename", "card.edit", "card.rename", "upgrade.count", "upgrade.status",
  "crate.qty", "tracker.edit", "combat.init", "policy.change", "access.owner", "access.default"
]);
export const isMergeable = (ev) => MERGE_TYPES.has(ev.k) && ev.d && ev.d.from !== undefined && ev.d.to !== undefined;
export const keyOf = (ev) => `${ev.actorId}|${ev.k}|${ev.path || ""}|${ev.u || ""}`;
const isBio = (ev) => ev.k === "stat.text" && ev.d && ev.d.key === "biography";
const slidingFor = (ev, T) => (isBio(ev) ? T.bioSlidingMs : T.slidingMs);
const maxFor = (ev, T) => (isBio(ev) ? T.bioMaxMs : T.maxMs);

/* ------------------------------------------------------------------ pure coalescing */
function seqSort(list) { return list.map((e, i) => ({ e, i })).sort((x, y) => (x.e.t - y.e.t) || (x.i - y.i)).map((x) => x.e); }

/** Group one key's time-sorted events into chains (sliding window + max age). */
function chainsOf(events, T) {
  const chains = [];
  for (const ev of events) {
    const cur = chains[chains.length - 1];
    if (cur && ev.t - cur.last <= slidingFor(cur.events[0], T) && ev.t - cur.first <= maxFor(cur.events[0], T)) { cur.events.push(ev); cur.last = Math.max(cur.last, ev.t); }
    else chains.push({ events: [ev], first: ev.t, last: ev.t });
  }
  return chains;
}
function mergeChain(chain) {
  const evs = chain.events;
  const first = evs[0], last = evs[evs.length - 1];
  if (evs.length === 1) return { ...clone(first), n: first.n || 1 };
  const d = { ...clone(first.d), ...clone(last.d), from: clone(first.d.from), to: clone(last.d.to) };
  let n = 0; for (const e of evs) n += e.n || 1;
  const out = { ...clone(first), d, n, t: first.t, t2: chain.last };
  if (last.c) out.c = clone(last.c);
  return out;
}
/** Coalesce a list of raw drafts. Returns {entries: sorted by (t, key), cancelled: n}. Input order is irrelevant for distinct times.
 *  An entry whose merged `to` equals its `from` is cancelled (net no-op). */
export function coalesceEvents(events, T = TIMING) {
  const byKey = new Map(), passthrough = [];
  for (const ev of seqSort(events)) {
    if (!isMergeable(ev)) { passthrough.push({ ...clone(ev), n: ev.n || 1 }); continue; }
    const k = keyOf(ev);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(ev);
  }
  const out = [...passthrough];
  let cancelled = 0;
  for (const list of byKey.values()) {
    for (const ch of chainsOf(list, T)) {
      const m = mergeChain(ch);
      if (deepEqual(m.d.from, m.d.to)) { cancelled++; continue; }
      out.push(m);
    }
  }
  out.sort((a, b) => (a.t - b.t) || (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));
  return { entries: out, cancelled };
}

/** Stateful buffer over coalesceEvents: add events as hooks fire, drain at the writer's timer. */
export class Coalescer {
  constructor(T = TIMING) { this.T = T; this.pending = new Map(); this.passthrough = []; this.cancelled = 0; this.size = 0; }
  add(ev) {
    this.size++;
    if (!isMergeable(ev)) { this.passthrough.push({ ...clone(ev), n: ev.n || 1 }); return; }
    const k = keyOf(ev);
    if (!this.pending.has(k)) this.pending.set(k, []);
    this.pending.get(k).push(ev);
  }
  /** Emit finished entries. force = drain everything (unload / hand-over). */
  drain(now, { force = false } = {}) {
    const out = this.passthrough.splice(0);
    for (const [k, list] of [...this.pending]) {
      const sorted = seqSort(list);
      const chains = chainsOf(sorted, this.T);
      const keep = [];
      chains.forEach((ch, i) => {
        const lastChain = i === chains.length - 1;
        const final = force || !lastChain || now - ch.last > slidingFor(ch.events[0], this.T) || now - ch.first > maxFor(ch.events[0], this.T);
        if (final) { const m = mergeChain(ch); if (deepEqual(m.d.from, m.d.to)) this.cancelled++; else out.push(m); }
        else keep.push(...ch.events);
      });
      if (keep.length) this.pending.set(k, keep); else this.pending.delete(k);
    }
    out.sort((a, b) => (a.t - b.t) || (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));
    this.size = this.passthrough.length + [...this.pending.values()].reduce((n, l) => n + l.length, 0);
    return out;
  }
  /** Earliest time a timer should fire (null when nothing open). */
  nextDueAt() {
    let due = null;
    for (const list of this.pending.values()) {
      const ch = chainsOf(seqSort(list), this.T).pop();
      const t = Math.min(ch.last + slidingFor(ch.events[0], this.T) + 1, ch.first + maxFor(ch.events[0], this.T) + 1);
      due = due === null ? t : Math.min(due, t);
    }
    if (this.passthrough.length) due = due === null ? 0 : Math.min(due, 0);
    return due;
  }
  get open() { return [...this.pending.values()].reduce((n, l) => n + l.length, 0) + this.passthrough.length; }
}

/* ------------------------------------------------------------------ bulk collapse */
const EMBEDDED = (k) => k.startsWith("item.") || k.startsWith("effect.");
const NOT_FIELD = (k) => k.startsWith("combat.") || k.startsWith("log.") || k.startsWith("note.") || k.startsWith("bulk.") || k.startsWith("team.sync");
function collapsibleKind(k) {
  const def = typeDef(k);
  if (!def || !def.collapsible) return null;
  if (EMBEDDED(k)) return "embedded";
  if (NOT_FIELD(k)) return null;
  return "field";
}
/** Collapse bursts: per (actorId,u), ops chained by <= 1.5 s gaps, group span <= 6 s; >= 5 embedded ops OR >= 8 fields -> one bulk.change.
 *  Input: drafts sorted or not. Output: new list (bulk.change drafts replace their kids). */
export function collapseBulk(entries, T = TIMING) {
  const sorted = entries.map((e, i) => ({ e, i })).sort((a, b) => (a.e.t - b.e.t) || (a.i - b.i)).map((x) => x.e);
  const groups = new Map(); // actor|u -> [group]
  const result = [];
  const closeGroup = (g) => {
    const embedded = g.items.filter((x) => x.kind === "embedded").length;
    const fields = g.items.filter((x) => x.kind === "field").length;
    if (embedded >= T.bulkEmbedded || fields >= T.bulkFields) {
      const kids = g.items.map((x) => x.e);
      const first = kids[0];
      const shown = kids.slice(0, T.bulkKids).map((x) => ({ k: x.k, d: x.d, ...(x.n > 1 ? { n: x.n } : {}) }));
      const bulk = {
        actorId: first.actorId, k: "bulk.change", path: "bulk", u: first.u, t: kids[0].t, t2: Math.max(...kids.map((x) => x.t2 || x.t)),
        d: { n: kids.length, kids: shown, more: Math.max(0, kids.length - T.bulkKids) }, n: 1
      };
      if (first.c) bulk.c = clone(first.c);
      if (kids.some((x) => x.v)) bulk.v = 1;
      result.push(bulk);
    } else for (const x of g.items) result.push(x.e);
  };
  const closers = new Map();
  for (const e of sorted) {
    const kind = collapsibleKind(e.k);
    if (!kind) { result.push(e); continue; }
    const key = `${e.actorId}|${e.u}`;
    let g = groups.get(key);
    const tEnd = e.t2 || e.t;
    if (g && e.t - g.last <= T.bulkWindowMs && e.t - g.first <= T.bulkHardMs) { g.items.push({ e, kind }); g.last = Math.max(g.last, tEnd); }
    else { if (g) closeGroup(g); g = { first: e.t, last: tEnd, items: [{ e, kind }] }; groups.set(key, g); }
    closers.set(key, g);
  }
  for (const g of closers.values()) closeGroup(g);
  result.sort((a, b) => (a.t - b.t) || (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));
  return result;
}

/* ------------------------------------------------------------------ absorb */
function matchesAbsorb(parent, draft) {
  const a = parent.absorb;
  if (!a) return false;
  if (a.actors && a.actors.length && !a.actors.includes(draft.actorId)) return false;
  if (a.types && a.types.length && !a.types.some((p) => draft.k.startsWith(p))) return false;
  if (a.u && draft.u !== a.u) return false;          // L8: a record swallows only the drafts of its OWN user (the server-attested id), never another user's edits
  return draft !== parent;
}
/** Holds hook-derived drafts for the absorb window so an explicit parent record (arriving before or after) can swallow them.
 *  Time is the arrival time `now` given to push / parent / drain. */
export class AbsorbBuffer {
  constructor(ms = TIMING.absorbMs) { this.ms = ms; this.held = []; this.parents = []; this.ready = []; this.absorbed = 0; }
  push(draft, now) {
    for (const p of this.parents) if (now <= p.at + p.ms && matchesAbsorb(p.draft, draft)) { this.absorbed++; p.n++; return "absorbed"; }
    this.held.push({ draft, at: now });
    return "held";
  }
  parent(draft, now) {
    const spec = draft.absorb || {};
    const ms = Number.isFinite(spec.ms) ? spec.ms : this.ms;
    const rec = { draft, at: now, ms, n: 0 };
    const keep = [];
    for (const h of this.held) {
      if (now - h.at <= ms && matchesAbsorb(draft, h.draft)) { rec.n++; this.absorbed++; } else keep.push(h);
    }
    this.held = keep;
    this.parents.push(rec);
    const out = { ...draft }; delete out.absorb;
    this.ready.push(out);
    return rec;
  }
  /** Items ready to be written now: parents, and held drafts whose window passed without a parent. */
  drain(now, { force = false } = {}) {
    const out = this.ready.splice(0);
    const keep = [];
    for (const h of this.held) { if (force || now - h.at >= this.ms) out.push(h.draft); else keep.push(h); }
    this.held = keep;
    this.parents = this.parents.filter((p) => now <= p.at + p.ms);
    return out;
  }
  get pending() { return this.held.length; }
}

/* ------------------------------------------------------------------ explain */
/** Patches {id, patch} that explain vital changes (spec 2.3). entries: ONE actor's entries (any mix of flushed / new). Idempotent. */
export function explainPatches(entries, T = TIMING) {
  const out = [];
  const dmg = entries.filter((e) => e.k === "damage.taken");
  const rolls = entries.filter((e) => e.k === "roll.made" && (e.d.p || 0) > 0 && e.d.str > 0);
  const usedDmg = new Set(entries.filter((e) => e.g && e.k === "stat.vital").map((e) => e.g));
  for (const v of entries) {
    if (v.k !== "stat.vital" || v.g) continue;
    const delta = v.d.to - v.d.from;
    if (v.d.key === "health") {
      let best = null;
      for (const x of dmg) {
        if (usedDmg.has(x.id)) continue;
        const xd = x.d.to - x.d.from;
        if (xd !== delta) continue;
        const dt = Math.abs(v.t - (x.t2 || x.t));
        if (dt <= T.explainDamageMs && (!best || dt < best.dt)) best = { x, dt };
      }
      if (best && best.x.v && !v.v) { if (!(v.d && v.d.cause === "damage")) out.push({ id: v.id, patch: { d: { cause: "damage" } } }); }     // L8: a GM-only card must not hide a public change (no hide, no link to a secret id)
      else if (best) { usedDmg.add(best.x.id); out.push({ id: v.id, patch: { h: 1, g: best.x.id, d: { cause: "damage" } } }); }
    } else if (v.d.key === "resolve" && delta < 0) {
      let best = null;
      for (const r of rolls) {
        if (-delta !== r.d.str) continue;
        const dt = Math.abs(v.t - (r.t2 || r.t));
        if (dt <= T.explainStressMs && (!best || dt < best.dt)) best = { r, dt };
      }
      if (best) out.push({ id: v.id, patch: { g: best.r.id, d: { cause: "stress" } } });
    }
  }
  return out;
}
export function applyExplain(entries, T = TIMING) {
  const patches = new Map(explainPatches(entries, T).map((p) => [p.id, p.patch]));
  return entries.map((e) => (patches.has(e.id) ? patchEntry(e, patches.get(e.id)) : e));
}

/* ------------------------------------------------------------------ roll push patch */
/** A push arrives as a changed message: patch the same roll entry (p+1, new dice / s / b, history of the previous result). */
export function patchRoll(entry, update, now) {
  const d = entry.d || {};
  const hist = [...(d.hist || []), { s: d.s, b: d.b }].slice(-10);
  const next = { ...entry, d: { ...d, p: (d.p || 0) + 1, hist } };
  for (const k of ["s", "b", "dice", "dmg", "st", "str"]) if (update[k] !== undefined) next.d[k] = clone(update[k]);
  if (Number.isFinite(now)) next.t2 = Math.max(next.t2 || next.t, now);
  return next;
}

/* ------------------------------------------------------------------ throttle */
/** More than `max` entries in `windowMs` for one actor: trip once (marker), then drop until the window cools. */
export class Throttle {
  constructor(max = TIMING.throttleMax, windowMs = TIMING.throttleWindowMs) { this.max = max; this.windowMs = windowMs; this.state = new Map(); }
  admit(actorId, now) {
    let s = this.state.get(actorId);
    if (!s) { s = { times: [], tripped: false, dropped: 0 }; this.state.set(actorId, s); }
    while (s.times.length && now - s.times[0] >= this.windowMs) s.times.shift();
    if (s.times.length === 0 && s.tripped) { s.tripped = false; }
    if (s.times.length >= this.max) {
      s.dropped++;
      if (!s.tripped) { s.tripped = true; return "trip"; }
      return "drop";
    }
    s.times.push(now);
    return "ok";
  }
  dropped(actorId) { const s = this.state.get(actorId); return s ? s.dropped : 0; }
  reset(actorId) { this.state.delete(actorId); }
}

/** Fixed-window counter per key (relay senders, L8): hit() is true while the key stays within `max` hits per `windowMs`, false when the call is over the limit. */
export class RateLimiter {
  constructor() { this.state = new Map(); }
  hit(key, now, max, windowMs) {
    let s = this.state.get(key);
    if (!s) { s = { times: [] }; this.state.set(key, s); if (this.state.size > 500) this.state.delete(this.state.keys().next().value); }
    while (s.times.length && now - s.times[0] >= windowMs) s.times.shift();
    if (s.times.length >= max) return false;
    s.times.push(now);
    return true;
  }
  /** Peek without counting. */
  left(key, now, max, windowMs) { const s = this.state.get(key); if (!s) return max; return Math.max(0, max - s.times.filter((t) => now - t < windowMs).length); }
  reset() { this.state.clear(); }
}

/* ------------------------------------------------------------------ finalise */
/** Turn a coalesced / collapsed draft into a stored entry (deterministic id from the FIRST time). */
export function finalizeDraft(draft, opts = {}) {
  const raw = { ...draft };
  raw.id = makeId(draft.t, draft.actorId || opts.actorId || "", draft.k, draft.path || "", draft.u || "");
  return normalizeEntry(raw, opts);
}
