/* Tactical combat (package P1): the combat STATE. Pure ES module: NO Foundry globals, no imports from Foundry, node-tested (check-state.mjs).
   Spec: dev/combat-spec.md sections 1.3, 2 and 10. The state lives on the Combat document as ONE JSON string
   (flags["invincible-plus-ultra"].tactics.state): a write replaces the whole value, no merge semantics [D].
   Fields owned by P1 (init, ledger, triggers, the P1 prompt kinds, opts, free, sched, seq) are sanitised field by field; fields owned by
   later packages (stack, tokens, statuses, counters, effects, items, summons, knowledge, revealed, npc, karma, chase) pass through a
   generic JSON-safe copy so their data survives a P1 write untouched.
   Additions to the spec's State shape, all [D]: `seq` (counter for ids made inside reducers and the action engine), `sched` (which
   scheduler points of the round were already collected, their open queue prompt, and `hold`: the round waits for the trigger instances
   the engine is running), `txOpen` (the open journal transactions of the action engine) and `evSeq` (event counter).
   ONE STATE: the action engine (engine-pure.mjs) works on this very shape; every write of the executor goes through serialize() and every
   read through parse(), so what the engine stores must survive sanitize() unchanged (check-fight.mjs and the engine checks round-trip
   every step). The per-user view lives in view-pure.mjs (viewFor is re-exported there for the spec's name). */

export const MOD_ID = "invincible-plus-ultra";
export const V = 1;
export const SEEN_MAX = 80;
export const MODES = ["tactical", "free", "off"];
export const KINDS = ["combat", "chase"];
export const PHASES = ["draw", "roundStart", "turns", "roundEnd", "sceneEnd", "idle"];
export const SLOT_STATES = ["waiting", "active", "done", "lost"];
export const GRANT_UNITS = ["A", "B", "full", "quick", "any", "fullOnly", "defense"];
export const GRANT_EXPIRES = ["roundEnd", "turnEnd", "used"];
export const ENTRY_COSTS = ["full", "quick", "free", "none"];
export const TRIGGER_POINTS = ["roundStart", "roundEnd", "turnStart", "turnEnd", "sceneEnd", "zoneEnter", "zoneExit", "beforeMove", "onDamaged", "onBroken"];
export const LIMITS = { slots: 200, members: 60, entries: 200, grants: 40, triggers: 400, prompts: 200, options: 60, text: 300, tags: 24, ledgers: 400, depth: 12, list: 600 };

const ID_RE = /^[A-Za-z0-9_.:@|-]{1,64}$/;
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
export const isId = (s) => typeof s === "string" && ID_RE.test(s) && !BAD_KEYS.has(s);
/** D114: on the heroes' side? A superhero actor a player owns, or one the GM put on the map as friendly (a hero the GM runs). A superhero
    actor with no player owner and no friendly token is the GM's: every character of the core book's heroes and villains is a superhero
    actor, villains too, so the type alone put an imported villain on the heroes' side. Any other actor type is the GM's.
    a = { type, owned: a player owns the actor, disposition: the token's (CONST.TOKEN_DISPOSITIONS: 1 friendly) } */
export const heroSide = (a) => !!a && a.type === "superhero" && (a.owned === true || Number(a.disposition) === 1);
/** ANSE (U17-1, the user 2026-11-12): the side a character FIGHTS on (targets, cards, colours): the heroes' side by heroSide, and also an
    ordinary NPC or minion group the GM put on the map as friendly (CONST.TOKEN_DISPOSITIONS 1). A thing (vehicle, challenge) has no side of
    its own here. The NPC rules (wounds, pushing) still follow heroSide (the facts' `npc`). */
export const allySide = (a) => heroSide(a) || (!!a && ["npc", "minions"].includes(a.type) && Number(a.disposition) === 1);
const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
const int = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.trunc(n))) : d; };
const str = (v, max = LIMITS.text) => (typeof v === "string" ? v.slice(0, max) : "");
const idOr = (v, d = null) => (isId(v) ? v : d);
const ids = (v, max = LIMITS.list) => (Array.isArray(v) ? [...new Set(v.filter(isId))].slice(0, max) : []);

/** JSON-safe deep copy with caps: drops functions, symbols, hostile keys, anything deeper than LIMITS.depth; never throws. */
export function plain(v, depth = 0, maxStr = 4000, maxDepth = LIMITS.depth) {
  if (v === null || typeof v === "boolean") return v;
  if (v === undefined || typeof v === "function" || typeof v === "symbol") return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return v.slice(0, maxStr);
  if (depth >= maxDepth || typeof v !== "object") return null;
  if (Array.isArray(v)) return v.slice(0, LIMITS.list).map((x) => plain(x, depth + 1, maxStr, maxDepth) ?? null);
  const out = {};
  let n = 0;
  for (const k of Object.keys(v)) {
    if (BAD_KEYS.has(k) || k.length > 80 || ++n > LIMITS.list) continue;
    const c = plain(v[k], depth + 1, maxStr, maxDepth);
    if (c !== undefined) out[k] = c;
  }
  return out;
}
const plainList = (v) => (Array.isArray(v) ? plain(v) : []);
const plainMap = (v) => (isObj(v) ? plain(v) : {});
/* The action engine's own records (instances on the stack, open transactions): an instance keeps a JSON snapshot per step for goToStep,
   and a transaction keeps whole inverse values, so strings and nesting get more room than the generic copy allows [D]. */
const ENGINE_STR = 200000, ENGINE_DEPTH = 24;
const engineList = (v) => (Array.isArray(v) ? plain(v, 0, ENGINE_STR, ENGINE_DEPTH) : []);
const engineMap = (v) => (isObj(v) ? plain(v, 0, ENGINE_STR, ENGINE_DEPTH) : {});
export const clone = (v) => JSON.parse(JSON.stringify(v));

/* ------------------------------------------------------------------ errors (spec 12.1: { key, code, params }, never thrown) */
export const err = (code, params = {}) => ({ ok: false, changed: false, error: { key: `ITAC.err.${code}`, code, params } });

/* ------------------------------------------------------------------ shapes */
export const newInit = () => ({ deck: 10, slots: [], cur: null, curMember: null, prev: {}, trail: [] });

/* H3-1: the fight's own tag. Every id the engine hands out (actions, prompts, roll requests, triggers ...) carries it, so no key built of
   an id (the roll watch, the roller's throw memo, the chat card's tag, a client's open card, the camera's beat) can meet the same id of
   an earlier fight on this Combat or of a fight on another Combat. The executor makes it at start (engine.mjs); a state without one
   (the node tables) keeps the bare ids. */
export const FIGHT_RE = /^[a-z0-9]{4,16}$/;
export const isFight = (f) => typeof f === "string" && FIGHT_RE.test(f);
/** a tag no other fight of any Combat has: the time (ms, base 36) and a little chance (rand in [0, 1)) */
export const makeFight = (now, rand) => `${Math.max(0, Math.trunc(Number(now) || 0)).toString(36)}${Math.trunc((Number(rand) || 0) * 46656).toString(36).padStart(3, "0")}`.slice(-16);
/* FXP (D161): who sits in which vehicle outlives a stop and a restart of the fight on the same Combat (the seats are where the characters
   are, not a matter of one fight): the vehicles' records and the inVehicle marks. -> null | { vehicles, seats: { cid: status } } */
export function crewOf(s) {
  if (!isObj(s?.vehicles) || !Object.keys(s.vehicles).length) return null;
  const seats = {};
  for (const [cid, list] of Object.entries(isObj(s.statuses) ? s.statuses : {})) { const st = Array.isArray(list) ? list.find((x) => x?.id === "inVehicle") : null; if (st) seats[cid] = plain(st); }
  return { vehicles: plain(s.vehicles), seats };
}
export function newState({ mode = "free", kind = "combat", opts = {}, fight = null } = {}) {
  return {
    v: V, rev: 0, seen: [], seq: 0, ...(isFight(fight) ? { fight } : {}),
    mode: MODES.includes(mode) ? mode : "free", kind: KINDS.includes(kind) ? kind : "combat",
    round: 0, phase: "idle",
    init: newInit(), ledger: {}, stack: [], prompts: {}, triggers: [], tokens: [], statuses: {}, counters: {}, effects: [], items: [], summons: [],
    knowledge: {}, revealed: {}, npc: {}, free: {}, karma: [], sched: { done: [] }, txOpen: {}, evSeq: 0,
    opts: sanitizeOpts(opts)
  };
}

function sanitizeOpts(o) {
  const out = isObj(o) ? plain(o) : {};
  out.redraw = out.redraw === "firstRoundOnly" ? "firstRoundOnly" : "everyRound";
  out.pushOrder = out.pushOrder === "beforeDefence" ? "beforeDefence" : "afterDefence";
  out.playersEnd = out.playersEnd !== false;
  return out;
}

function sanitizeSlot(r) {
  if (!isObj(r) || !isId(r.id)) return null;
  const members = ids(r.members, LIMITS.members);
  if (!members.length) return null;
  const s = { id: r.id, card: r.card === null || r.card === undefined ? null : int(r.card, 1, 999, null), members, state: SLOT_STATES.includes(r.state) ? r.state : "waiting", done: ids(r.done, LIMITS.members).filter((m) => members.includes(m)) };
  if (r.heldOff) s.heldOff = 1;
  if (isObj(r.extra)) { s.extra = { kind: r.extra.kind === "mindControl" ? "mindControl" : "gm" }; if (isId(r.extra.by)) s.extra.by = r.extra.by; s.at = int(r.at, 0, 999, 0); s.card = null; }
  return s;
}
function sanitizeInit(r) {
  const out = newInit();
  if (!isObj(r)) return out;
  out.deck = int(r.deck, 1, 999, 10);
  const seen = new Set(), taken = new Set();
  for (const raw of Array.isArray(r.slots) ? r.slots.slice(0, LIMITS.slots) : []) {
    const s = sanitizeSlot(raw);
    if (!s || seen.has(s.id)) continue;
    if (!s.extra) { s.members = s.members.filter((m) => !taken.has(m)); for (const m of s.members) taken.add(m); }   // one combatant, one slot (extra turns aside)
    if (!s.members.length) continue;
    seen.add(s.id); out.slots.push(s);
  }
  out.cur = seen.has(r.cur) ? r.cur : null;
  const curSlot = out.slots.find((s) => s.id === out.cur);
  out.curMember = curSlot && curSlot.members.includes(r.curMember) ? r.curMember : null;
  if (isObj(r.prev)) for (const [k, v] of Object.entries(r.prev).slice(0, LIMITS.ledgers)) { const c = int(v, 1, 999, null); if (isId(k) && c !== null) out.prev[k] = c; }
  out.trail = ids(r.trail);
  const lost = ids(r.lost).filter((m) => out.trail.includes(m));      // FXG2: lost turns of this round, passed over by the step back
  if (lost.length) out.lost = lost;
  const sur = ids(r.surprised);
  if (sur.length) out.surprised = sur;
  if (isObj(r.pendingDraw)) { const pd = { veteran: ids(r.pendingDraw.veteran), reflexes: ids(r.pendingDraw.reflexes) }; if (pd.veteran.length || pd.reflexes.length) out.pendingDraw = pd; }
  if (isObj(r.draw)) {
    const d = r.draw;
    const cards = (a) => (Array.isArray(a) ? a.map((c) => int(c, 1, 999, null)).filter((c) => c !== null).slice(0, 999) : []);
    out.draw = { round: int(d.round, 0, 1e6, 0), stage: d.stage === "deal" ? "deal" : "veteran", size: int(d.size, 1, 999, 10), left: cards(d.left), queue: ids(d.queue), keeps: {}, surprised: ids(d.surprised), wait: null, vetWait: ids(d.vetWait) };
    if (isId(d.surpriseWait)) out.draw.surpriseWait = d.surpriseWait;      // ANSG (FXT-10): the GM's surprise card the deal waits for
    if (isObj(d.keeps)) for (const [k, v] of Object.entries(d.keeps)) { const c = int(v, 1, 999, null); if (isId(k) && c !== null) out.draw.keeps[k] = c; }
    if (isObj(d.wait) && isId(d.wait.slot)) out.draw.wait = { slot: d.wait.slot, drawn: cards(d.wait.drawn).slice(0, 2), prompt: idOr(d.wait.prompt) };
  }
  return out;
}

const facts = (r) => {
  const f = { moved: int(r?.moved, 0, 999, 0), tags: Array.isArray(r?.tags) ? [...new Set(r.tags.filter((x) => typeof x === "string").map((x) => x.slice(0, 40)))].slice(0, LIMITS.tags * 4) : [] };
  if (r?.movedWithinZone) f.movedWithinZone = 1;
  if (r?.attacked) f.attacked = 1;
  if (r?.acted) f.acted = 1;
  if (Array.isArray(r?.shot) && r.shot.length) f.shot = r.shot.filter((x) => typeof x === "string").map((x) => x.slice(0, 80)).slice(0, 20);
  return f;
};
function sanitizeGrant(r) {
  if (!isObj(r) || !isId(r.id) || !GRANT_UNITS.includes(r.unit)) return null;
  const g = { id: r.id, kind: str(r.kind, 40) || "gm", unit: r.unit, window: /^(ownTurn|anytime|interrupt|turnOrInterrupt|turnOf:[A-Za-z0-9_.-]{1,64})$/.test(r.window) ? r.window : "ownTurn", expires: GRANT_EXPIRES.includes(r.expires) ? r.expires : "roundEnd" };
  if (isId(r.from)) g.from = r.from;
  if (isObj(r.source)) g.source = plain(r.source);
  if (Number(r.stress) > 0) g.stress = int(r.stress, 1, 99, 1);
  if (r.needsConsent) { g.needsConsent = 1; g.consent = ["pending", "yes", "no"].includes(r.consent) ? r.consent : "pending"; }
  if (isId(r.usedBy)) g.usedBy = r.usedBy;
  if (isId(r.slot)) g.slot = r.slot;
  if (isObj(r.data)) g.data = plain(r.data);
  return g;
}
function sanitizeEntry(r) {
  if (!isObj(r) || !isId(r.id)) return null;
  const e = { id: r.id, round: int(r.round, 0, 1e6, 0), action: str(r.action, 60) || "other", inst: idOr(r.inst), cost: ENTRY_COSTS.includes(r.cost) ? r.cost : "none", tags: Array.isArray(r.tags) ? r.tags.filter((x) => typeof x === "string").map((x) => x.slice(0, 40)).slice(0, LIMITS.tags) : [] };
  for (const k of ["slot", "onTurnOf", "grant"]) if (isId(r[k])) e[k] = r[k];
  for (const k of ["interrupt", "void", "own", "forced"]) if (r[k]) e[k] = 1;
  if (Number(r.stress) > 0) e.stress = int(r.stress, 1, 99, 1);
  if (Number.isFinite(Number(r.turnNo))) e.turnNo = int(r.turnNo, 0, 1e6, 0);
  if (Number.isFinite(Number(r.borders))) e.borders = int(r.borders, 0, 99, 1);
  for (const k of ["zoneFrom", "zoneTo"]) if (typeof r[k] === "string" && r[k]) e[k] = r[k].slice(0, 60);
  if (Array.isArray(r.target)) e.target = ids(r.target, 60);
  return e;
}
export function sanitizeLedger(r) {
  if (!isObj(r)) return null;
  const L = { round: int(r.round, 0, 1e6, 0), n: int(r.n, 0, 1e9, 0), turnNo: int(r.turnNo, 0, 1e6, 0), turnRound: int(r.turnRound, 0, 1e6, 0), grants: [], entries: [], history: { round: facts(r.history?.round) } };
  const seen = new Set();
  for (const raw of Array.isArray(r.grants) ? r.grants.slice(0, LIMITS.grants) : []) { const g = sanitizeGrant(raw); if (g && !seen.has(g.id)) { seen.add(g.id); L.grants.push(g); } }
  for (const raw of Array.isArray(r.entries) ? r.entries.slice(0, LIMITS.entries) : []) { const e = sanitizeEntry(raw); if (e && !seen.has(e.id)) { seen.add(e.id); L.entries.push(e); } }
  if (isObj(r.history?.prevTurn)) L.history.prevTurn = facts(r.history.prevTurn);
  if (isObj(r.history?.thisTurn)) L.history.thisTurn = facts(r.history.thisTurn);
  if (isObj(r.lostTurn)) L.lostTurn = { until: "nextTurnConsumed", source: plain(r.lostTurn.source ?? null) };
  if (r.noInterrupts) L.noInterrupts = 1;
  if (isObj(r.noFull)) L.noFull = { round: int(r.noFull.round, 0, 1e6, 0), source: plain(r.noFull.source ?? null) };
  if (r.open) L.open = 1;
  if (r.held) L.held = 1;
  if (isId(r.extra)) L.extra = r.extra;
  return L;
}

export function sanitizeTrigger(r) {
  if (!isObj(r) || !isId(r.id) || !TRIGGER_POINTS.includes(r.at) || !isObj(r.run) || typeof r.run.type !== "string") return null;
  const t = { id: r.id, at: r.at, subject: {}, run: plain(r.run), source: isObj(r.source) ? plain(r.source) : { kind: "gm", name: "" } };
  if (isObj(r.subject)) { if (isId(r.subject.combatant)) t.subject.combatant = r.subject.combatant; if (typeof r.subject.zone === "string" && r.subject.zone) t.subject.zone = r.subject.zone.slice(0, 60); if (r.subject.any) t.subject.any = 1; }
  if (Number.isFinite(Number(r.order))) t.order = int(r.order, -999, 999, 0);
  if (Number(r.runs) > 0) t.runs = int(r.runs, 0, 1e6, 0);
  if (isObj(r.expires)) {
    const x = {};
    if (["roundEnd", "sceneEnd", "nextTurnOf"].includes(r.expires.at)) x.at = r.expires.at;
    if (isId(r.expires.who)) x.who = r.expires.who;
    if (Number(r.expires.afterRuns) > 0) x.afterRuns = int(r.expires.afterRuns, 1, 1e6, 1);
    if (x.at || x.afterRuns) t.expires = x;
  }
  return t;
}

export function sanitizePrompt(r) {
  if (!isObj(r) || !isId(r.id) || typeof r.kind !== "string") return null;
  const p = { id: r.id, inst: idOr(r.inst), step: r.step === null ? null : str(r.step, 40), kind: r.kind.slice(0, 40), to: r.to === "gm" ? "gm" : { users: ids(r.to?.users, 40) }, options: [] };
  if (isId(r.about)) p.about = r.about;
  if (Number.isFinite(r.at)) p.at = r.at;                                                   // U59: when it was asked
  for (const o of Array.isArray(r.options) ? r.options.slice(0, LIMITS.options) : []) {
    if (!isObj(o) || !isId(String(o.id))) continue;
    const q = { id: String(o.id), label: str(o.label, 120) };
    if (typeof o.name === "string" && o.name) q.name = o.name.slice(0, 120);
    if (o.cost !== undefined) q.cost = plain(o.cost);
    if (Number(o.stress) > 0) q.stress = int(o.stress, 1, 99, 1);
    if (Number.isFinite(Number(o.dice)) && o.dice !== undefined && o.dice !== null) q.dice = int(o.dice, -99, 99, 0);
    if (typeof o.disabled === "string" && o.disabled) q.disabled = o.disabled.slice(0, 60);
    if (o.data !== undefined) q.data = plain(o.data);
    p.options.push(q);
  }
  for (const k of ["multi", "free", "gmOnlyData"]) if (r[k]) p[k] = 1;
  for (const k of ["min", "max"]) if (Number.isFinite(Number(r[k])) && r[k] !== undefined && r[k] !== null) p[k] = int(r[k], 0, 999, 0);
  if (isObj(r.auto)) p.auto = plain(r.auto);
  if (isObj(r.answered)) p.answered = { by: idOr(r.answered.by, ""), at: int(r.answered.at, 0, 1e15, 0), value: plain(r.answered.value ?? null) };
  if (isObj(r.data)) p.data = plain(r.data);
  return p;
}

/** Any value -> a valid State, or null when it is not a state of this version. Never throws; hostile data never survives. */
export function sanitize(raw) {
  try {
    if (!isObj(raw) || raw.v !== V) return null;
    const s = newState({ mode: raw.mode, kind: raw.kind, opts: raw.opts, fight: raw.fight });
    s.rev = int(raw.rev, 0, 1e12, 0);
    s.seq = int(raw.seq, 0, 1e12, 0);
    s.seen = Array.isArray(raw.seen) ? raw.seen.filter((x) => typeof x === "string" && x.length <= 120).slice(-SEEN_MAX) : [];
    s.round = int(raw.round, 0, 1e6, 0);
    s.phase = PHASES.includes(raw.phase) ? raw.phase : "idle";
    s.init = sanitizeInit(raw.init);
    if (isObj(raw.ledger)) for (const [k, v] of Object.entries(raw.ledger).slice(0, LIMITS.ledgers)) { const L = isId(k) ? sanitizeLedger(v) : null; if (L) s.ledger[k] = L; }
    const tSeen = new Set();
    for (const r of Array.isArray(raw.triggers) ? raw.triggers.slice(0, LIMITS.triggers) : []) { const t = sanitizeTrigger(r); if (t && !tSeen.has(t.id)) { tSeen.add(t.id); s.triggers.push(t); } }
    if (isObj(raw.prompts)) for (const [k, v] of Object.entries(raw.prompts).slice(0, LIMITS.prompts)) { const p = sanitizePrompt(v); if (p && p.id === k) s.prompts[k] = p; }
    if (isObj(raw.free)) for (const k of Object.keys(raw.free).slice(0, LIMITS.ledgers)) if (isId(k) && raw.free[k]) s.free[k] = 1;
    s.sched = { done: Array.isArray(raw.sched?.done) ? raw.sched.done.filter((x) => typeof x === "string" && x.length <= 120).slice(-400) : [] };
    if (typeof raw.sched?.hold === "string" && raw.sched.hold) s.sched.hold = raw.sched.hold.slice(0, 120);
    if (isObj(raw.moved) && Object.keys(raw.moved).length) s.moved = Object.fromEntries(Object.entries(raw.moved).filter(([k, v]) => isId(k) && isObj(v)).slice(0, LIMITS.ledgers).map(([k, v]) => [k, plain(v)]));      // D44: what the opening of a turn ended, kept while that turn may still be handed on (ops-pure.momentKept)
    s.evSeq = int(raw.evSeq, 0, 1e12, 0);
    s.stack = engineList(raw.stack); s.tokens = plainList(raw.tokens); s.effects = plainList(raw.effects); s.items = plainList(raw.items);
    s.summons = plainList(raw.summons); s.karma = plainList(raw.karma);
    if (Array.isArray(raw.news)) s.news = plainList(raw.news).slice(-12);      // what the table was told happened (engine-pure.pushNews)
    s.statuses = plainMap(raw.statuses); s.counters = plainMap(raw.counters); s.knowledge = plainMap(raw.knowledge); s.revealed = plainMap(raw.revealed); s.npc = plainMap(raw.npc);
    if (isObj(raw.teams)) { const tm = Object.fromEntries(Object.entries(raw.teams).filter(([k, v]) => isId(k) && (v === "heroes" || v === "gm")).slice(0, LIMITS.ledgers)); if (Object.keys(tm).length) s.teams = tm; }      // FXR2 (FF8-D3): the side of each ally marked "summoned by" (ops-pure sideNews)
    if (isObj(raw.chase)) s.chase = plain(raw.chase);
    if (isObj(raw.chaseEnded)) s.chaseEnded = plain(raw.chaseEnded);       // CHASE (U168): how the last chase ended (engine-pure chaseEnd)
    if (isObj(raw.vehicles)) s.vehicles = plain(raw.vehicles);               // P7: who sits where, what is broken (flows/vehicle.mjs)
    if (isObj(raw.challenges)) s.challenges = plain(raw.challenges);         // P7: the objectives and side effects the GM set up (flows/challenge.mjs)
    s.txOpen = engineMap(raw.txOpen);                             // the action engine keeps its open transactions here [D]
    return s;
  } catch { return null; }
}
export const serialize = (state) => JSON.stringify(sanitize(state));
export function parse(text) {
  if (typeof text !== "string" || !text) return null;
  try { return sanitize(JSON.parse(text)); } catch { return null; }
}

/* ------------------------------------------------------------------ ids, request dedupe */
export const idOf = (state, prefix, n) => `${prefix}${n}${isFight(state?.fight) ? `_${state.fight}` : ""}`;      // H3-1: "a4_<fight>"
export const nextId = (state, prefix) => idOf(state, prefix, ++state.seq);
export const hasSeen = (state, rid) => !!rid && Array.isArray(state?.seen) && state.seen.includes(rid);
/** rev + 1 and the request id remembered (last 80) [spec 1.3]. Mutates the given (already cloned) state. */
export function stamp(state, rid) {
  state.rev = (state.rev ?? 0) + 1;
  if (rid) { state.seen.push(String(rid).slice(0, 120)); if (state.seen.length > SEEN_MAX) state.seen.splice(0, state.seen.length - SEEN_MAX); }
  return state;
}

/* ------------------------------------------------------------------ the view of one user (spec 10; P1 part)
   viewer = { gm: boolean, userId, hidden: [combatantId...] } where `hidden` are the combatants Foundry itself hides from that user.
   For a non-GM: every record that names a hidden combatant is removed, whatever package wrote it (a generic scrub, so a later field
   cannot leak by being forgotten here), NPC policies and the request ids are dropped, and GM-desk prompts lose their options when
   they are marked gmOnlyData. P2 extends this for roll pools, secret rolls and unrevealed NPC numbers. */
const REMOVE = Symbol("remove");
const names = (str, hidden) => { for (const h of hidden) if (str.includes(h)) return true; return false; };
/* A record goes as a whole when one of its own string properties, or one of its own lists of strings, names a hidden combatant; a child
   record that goes takes only itself along; a key that names a hidden combatant loses its value. */
function scrub(v, hidden) {
  if (typeof v === "string") return names(v, hidden) ? REMOVE : v;
  if (Array.isArray(v)) return v.map((x) => scrub(x, hidden)).filter((x) => x !== REMOVE);
  if (isObj(v)) {
    const out = {};
    for (const [k, c] of Object.entries(v)) {
      if (names(k, hidden)) continue;
      if (typeof c === "string") { if (names(c, hidden)) return REMOVE; out[k] = c; continue; }
      if (Array.isArray(c) && c.some((x) => typeof x === "string" && names(x, hidden))) return REMOVE;
      const r = scrub(c, hidden);
      if (r !== REMOVE) out[k] = r;
    }
    return out;
  }
  return v;
}
export function viewFor(state, viewer = {}) {
  const s = sanitize(state);
  if (!s || viewer.gm === true) return s;
  const hidden = new Set(ids(viewer.hidden));
  s.seen = []; s.npc = {};
  for (const p of Object.values(s.prompts)) {
    const mine = p.to !== "gm" && p.to.users.includes(viewer.userId);
    if (p.gmOnlyData && !mine) { p.options = []; delete p.data; delete p.auto; if (p.answered) p.answered.value = null; }
  }
  delete s.init.draw;                                 // the cards still in the deck are nobody's business
  if (!hidden.size) return s;
  // initiative: hidden members leave their slots; a slot left empty disappears; nobody learns whose turn it is when that one is hidden
  const init = s.init, slots0 = init.slots.length;
  init.slots = init.slots.map((sl) => ({ ...sl, members: sl.members.filter((m) => !hidden.has(m)), done: sl.done.filter((m) => !hidden.has(m)), ...(sl.extra?.by && hidden.has(sl.extra.by) ? { extra: { kind: sl.extra.kind } } : {}) })).filter((sl) => sl.members.length);
  if (!init.slots.some((sl) => sl.id === init.cur)) { init.cur = null; init.curMember = null; }
  else if (hidden.has(init.curMember)) init.curMember = null;
  if (init.slots.length < slots0) init.deck = Math.max(10, ...init.slots.map((sl) => sl.card ?? 0));      // P8d: a deck grown for slots the viewer does not see would count them [I3] [R12]; the highest card in sight says all the viewer may know
  init.trail = init.trail.filter((m) => !hidden.has(m));
  if (init.lost) { init.lost = init.lost.filter((m) => !hidden.has(m)); if (!init.lost.length) delete init.lost; }
  if (init.surprised) init.surprised = init.surprised.filter((m) => !hidden.has(m));
  s.triggers = s.triggers.filter((t) => !hidden.has(t.subject.combatant) && !hidden.has(t.expires?.who));       // a trigger about a hidden combatant goes as a whole
  const keep = { v: s.v, rev: s.rev, seq: s.seq, ...(s.fight ? { fight: s.fight } : {}), mode: s.mode, kind: s.kind, round: s.round, phase: s.phase, seen: [] };
  const out = { ...keep };
  for (const [k, val] of Object.entries(s)) {
    if (k in keep) continue;
    const r = scrub(val, hidden);
    out[k] = r === REMOVE ? (Array.isArray(val) ? [] : {}) : r;
  }
  return sanitize(out);
}
