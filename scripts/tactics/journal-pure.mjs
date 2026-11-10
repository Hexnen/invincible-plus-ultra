/* Tactical combat, package P2: JOURNAL WITH UNDO (spec section 15). NO Foundry globals (node-tested in check-journal.mjs).
   A transaction is the list of reversible operations one action instance (or one GM edit) produced. This file owns:
   - state paths and the generic reversible state operation `{ t:"state", patch, inverse }`;
   - the shapes of the document operations and how each one is inverted (the executor only performs them);
   - undo planning: last-in-first-out discipline, the forced single undo and its drift check;
   - the capped log (150 transactions; older ones keep their label only).
   Every op is plain JSON. Nothing here decides a game rule. */

export const LOG_MAX = 150;                 // spec 15: the log keeps the last 150 transactions
export const LOG_V = 1;
const BAD_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
export const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
/* equal as data: the order of keys is not part of a value (the state is rebuilt key by key every time it is stored) */
const canon = (v) => JSON.stringify(v ?? null, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((q) => [q, x[q]])) : x));
export const same = (a, b) => canon(a) === canon(b);

/* ------------------------------------------------------------------ state paths
   A path is an array of segments. A string segment is an object key; a segment "#<id>" addresses the element with that `id` inside an array
   (missing element reads as null; writing null removes it; writing to a missing id appends). So lists of records (tokens, triggers, effects,
   statuses of one combatant, items, summons) are edited one record at a time and an inverse touches only that record. */
export const validPath = (path) => Array.isArray(path) && path.length > 0 && path.length <= 8 && path.every((s) => typeof s === "string" && s.length > 0 && s.length <= 64 && !BAD_KEYS.has(s));
const isIdSeg = (s) => s.charCodeAt(0) === 35;   // "#"

export function getAt(root, path) {
  let cur = root;
  for (const seg of path) {
    if (cur == null) return null;
    if (isIdSeg(seg)) { if (!Array.isArray(cur)) return null; cur = cur.find((e) => e && e.id === seg.slice(1)) ?? null; }
    else { if (!isObj(cur) || !Object.prototype.hasOwnProperty.call(cur, seg)) return null; cur = cur[seg]; }
  }
  return cur ?? null;
}
/** Copy-on-write set. `value` null or undefined removes a key / an array element. Returns the new root (the input is never modified). */
export function setAt(root, path, value) {
  if (!validPath(path)) throw new Error("setAt: bad path");
  const rec = (cur, i) => {
    const seg = path[i], last = i === path.length - 1;
    if (isIdSeg(seg)) {
      const id = seg.slice(1), arr = Array.isArray(cur) ? cur.slice() : [];
      const at = arr.findIndex((e) => e && e.id === id);
      const next = last ? value : rec(at >= 0 ? arr[at] : { id }, i + 1);
      if (next == null) { if (at >= 0) arr.splice(at, 1); }
      else if (at >= 0) arr[at] = next; else arr.push(next);
      return arr;
    }
    const obj = isObj(cur) ? { ...cur } : {};
    const next = last ? value : rec(obj[seg], i + 1);
    if (next == null) delete obj[seg]; else obj[seg] = next;
    return obj;
  };
  return rec(root, 0);
}

/* ------------------------------------------------------------------ operations (spec 15, `Op`)
   state      { t:"state", patch:[[path, to]...], inverse:[[path, from]...] }
   actor      { t:"actor", uuid, path, from, to }              // path = a field name of the system adapter ("health", "resolve"), never a raw system path
   item+ / -  { t:"item+", actorUuid, itemId, data } / { t:"item-", actorUuid, data }
   effect+/-  { t:"effect+", actorUuid, effectId, data } / { t:"effect-", actorUuid, data }
   token+ / - { t:"token+", sceneId, tokenId, data } / { t:"token-", sceneId, data }
   tokenMove  { t:"tokenMove", sceneId, tokenId, from, to }
   zones      { t:"zones", op, inverse }                       // one write of the zones API: the op given to `apply` and the inverse op it returned
   message    { t:"message", id }
   Every op may carry `step` (the step of the instance that produced it; goToStep undoes by it) and `label`. */
export const OP_TYPES = Object.freeze(["state", "actor", "item+", "item-", "effect+", "effect-", "token+", "token-", "tokenMove", "zones", "message"]);

/** Build the reversible state op for writing `to` at `path` of `state`. Returns { state, op } (op null when nothing changes). */
export function stateOp(state, path, to) {
  const from = getAt(state, path);
  if (same(from, to)) return { state, op: null };
  return { state: setAt(state, path, to ?? null), op: { t: "state", patch: [[path, to ?? null]], inverse: [[path, clone(from)]] } };
}
/** Apply the forward or the inverse side of a state op. */
export function applyStateOp(state, op, inverse = false) {
  let s = state;
  const list = inverse ? [...op.inverse].reverse() : op.patch;
  for (const [path, value] of list) s = setAt(s, path, clone(value));
  return s;
}

/** The request that undoes one op, in the vocabulary of the executor's `perform` (engine-pure.mjs "effects"). State ops are applied by the caller. */
export function inverseEffect(op) {
  switch (op.t) {
    case "actor": return { t: "actor", uuid: op.uuid, path: op.path, to: op.from, expect: op.to };
    case "item+": return { t: "itemDelete", actorUuid: op.actorUuid, itemId: op.itemId };
    case "item-": return { t: "itemCreate", actorUuid: op.actorUuid, data: op.data, keepId: true };
    case "effect+": return { t: "effectDelete", actorUuid: op.actorUuid, effectId: op.effectId };
    case "effect-": return { t: "effectCreate", actorUuid: op.actorUuid, data: op.data, keepId: true };
    case "token+": return { t: "tokenDelete", sceneId: op.sceneId, tokenId: op.tokenId };
    case "token-": return { t: "tokenCreate", sceneId: op.sceneId, data: op.data, keepId: true };
    case "tokenMove": return { t: "tokenMove", sceneId: op.sceneId, tokenId: op.tokenId, to: op.from, expect: op.to };
    case "zones": return op.inverse ? { t: "zones", op: op.inverse, isInverse: true } : null;
    case "message": return { t: "messageStrike", id: op.id };      // spec 15: struck through, never deleted (the dice stay)
    default: return null;
  }
}

/* ------------------------------------------------------------------ transactions */
export function newTx({ id, inst = null, label = null, by = null, at = 0, round = 0 }) {
  return { id, inst, label: label ?? { pub: "", gm: "" }, by, at, round, ops: [], state: "open" };
}
export const addOp = (tx, op, step = null) => ({ ...tx, ops: [...tx.ops, step ? { ...op, step } : op] });
export const closeTx = (tx, label = null) => ({ ...tx, state: "closed", label: label ?? tx.label });

/* ------------------------------------------------------------------ the log (Combat flag `tactics.log`, one JSON string) */
export const emptyLog = () => ({ v: LOG_V, list: [] });
export function pushLog(log, tx) {
  const list = [...(log?.list ?? []).filter((t) => t.id !== tx.id), tx];
  const cut = Math.max(0, list.length - LOG_MAX);
  // spec 15: older transactions lose their ops (label only). They are kept as "label only" rows for the journal view, at most another LOG_MAX of them.
  const slim = list.slice(0, cut).map((t) => (t.ops ? { id: t.id, inst: t.inst, label: t.label, by: t.by, at: t.at, round: t.round, state: t.state, ops: null } : t));
  return { v: LOG_V, list: [...slim.slice(-LOG_MAX), ...list.slice(cut)] };
}
export function parseLog(raw) {
  try {
    const o = typeof raw === "string" ? (raw ? JSON.parse(raw) : null) : raw;
    if (!isObj(o) || o.v !== LOG_V || !Array.isArray(o.list)) return emptyLog();
    const list = o.list.filter((t) => isObj(t) && typeof t.id === "string" && ["closed", "undone"].includes(t.state) && (t.ops === null || Array.isArray(t.ops)));
    return { v: LOG_V, list };
  } catch { return emptyLog(); }
}
export const serializeLog = (log) => JSON.stringify(log ?? emptyLog());

/* ------------------------------------------------------------------ undo planning
   spec 15: default discipline is last-in-first-out: undoing an older transaction first undoes the later ones. A forced single undo is allowed
   with a drift check per op. */
/** Transactions that must be undone to undo `txId` in LIFO order (newest first, `txId` last). null when it cannot be undone. */
export function undoOrder(log, txId) {
  const list = log?.list ?? [];
  const at = list.findIndex((t) => t.id === txId);
  if (at < 0) return null;
  const t = list[at];
  if (t.state !== "closed" || !Array.isArray(t.ops)) return null;
  const later = list.slice(at + 1).filter((x) => x.state === "closed");
  if (later.some((x) => !Array.isArray(x.ops))) return null;
  return [...later.reverse().map((x) => x.id), txId];
}
/** Drift of one op against the present: `current` is what the world holds now at the op's target (the caller reads it). For a state op pass the state.
    Returns null (no drift) or { op, expected, current }. */
export function driftOf(op, current) {
  if (op.t === "state") {
    for (const [path, to] of op.patch) { const cur = getAt(current, path); if (!same(cur, to)) return { op, path, expected: to, current: cur }; }
    return null;
  }
  if (op.t === "actor" || op.t === "tokenMove") return same(current, op.to) ? null : { op, expected: op.to, current };
  return null;
}
/** How a drifted numeric actor op is resolved (spec 15: restore, apply the difference, or leave). Returns the value to write, or undefined for "leave". */
export function resolveDrift(op, current, mode) {
  if (mode === "leave") return undefined;
  if (mode === "difference" && typeof op.from === "number" && typeof op.to === "number" && typeof current === "number") return current + (op.from - op.to);
  return op.from;      // "restore"
}
export const markUndone = (log, txId, at) => ({ v: LOG_V, list: (log?.list ?? []).map((t) => (t.id === txId ? { ...t, state: "undone", undoneAt: at } : t)) });

/* ------------------------------------------------------------------ fine-grained writes
   The smallest list of [path, to] leaf writes that turns `before` into `after` below `base`. Objects are compared key by key and lists of records with
   unique string ids element by element ("#id" segments), so two transactions that touch different records of one list (two ledger entries, two tokens)
   never overwrite each other when one of them is undone. Anything else (scalars, other arrays, a changed order) is written whole. */
const idList = (a) => Array.isArray(a) && a.length > 0 && a.every((e) => isObj(e) && typeof e.id === "string" && e.id.length > 0 && e.id.length < 63 && !e.id.includes("#")) && new Set(a.map((e) => e.id)).size === a.length;
const okKey = (k) => k.length > 0 && k.length <= 64 && !BAD_KEYS.has(k) && k.charCodeAt(0) !== 35;
export function diffWrites(before, after, base) {
  if (same(before, after)) return [];
  if (base.length < 7) {
    if (isObj(before) && isObj(after)) {
      const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
      if (keys.every(okKey)) return keys.flatMap((k) => diffWrites(before[k], after[k], [...base, k]));
    }
    if ((idList(before) || (Array.isArray(before) && !before.length)) && (idList(after) || (Array.isArray(after) && !after.length)) && (before.length || after.length)) {
      const b = new Map(before.map((e) => [e.id, e])), a = new Map(after.map((e) => [e.id, e]));
      const kept = after.filter((e) => b.has(e.id)).map((e) => e.id), was = before.filter((e) => a.has(e.id)).map((e) => e.id);
      const appended = after.slice(kept.length).every((e) => !b.has(e.id));
      // removed records must be the tail of `before`: an inverse can only re-append, so a record taken from the middle would come back in another place
      const gone = before.filter((e) => !a.has(e.id)).map((e) => e.id), tail = same(before.slice(before.length - gone.length).map((e) => e.id), gone);
      if (same(kept, was) && appended && tail) return [...kept, ...gone.reverse(), ...after.slice(kept.length).map((e) => e.id)].flatMap((id) => diffWrites(b.get(id), a.get(id), [...base, `#${id}`]));
    }
  }
  return [[base, after ?? null]];
}
/** One reversible state op for writing `to` at `path`, as fine-grained as diffWrites allows. Returns { state, op } (op null when nothing changes). */
export function fineStateOp(state, path, to) {
  const patch = diffWrites(getAt(state, path), to ?? null, path);
  if (!patch.length) return { state, op: null };
  const inverse = patch.map(([p]) => [p, clone(getAt(state, p))]);
  let s = state;
  for (const [p, v] of patch) s = setAt(s, p, clone(v));
  return { state: s, op: { t: "state", patch, inverse } };
}
