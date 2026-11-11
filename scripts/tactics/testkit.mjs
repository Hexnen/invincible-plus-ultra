/* Shared helpers of the tactics node checks (not a test itself, never loaded by the module).
   Counters: each check-*.mjs runs on import and ends with done(name): "OK <n> checks (name)". `eq` compares in key order (strict);
   `eqc` compares canonically (keys sorted), for records whose key order is not part of the contract.
   A SCRIPTED TABLE stands in for Foundry and for the humans. It implements the host of director-pure.mjs (facts, perform, parts, rng,
   sceneFacts) over plain objects, so whole fights run in node on the REAL state, ledger and round driver:
     const T = new Table(); T.hero("H1", "p1", {...}); T.npc("N1", {...}); T.order(["H1", "N1"]); await T.req("p1", { op: "declare", ... });
     await T.roll("attack", 3, { pushable: true });   T.dice.push([6, 2]);   await T.gm({ op: "answerFor", ... });
   After every step the state and the journal go through serialize / parse exactly as the store writes and reads them; a value the
   sanitizer would lose or change fails a check on the spot. */
import * as D from "./director-pure.mjs";
import * as E from "./engine-pure.mjs";
import * as S from "./state-pure.mjs";
import * as O from "./ops-pure.mjs";
import * as J from "./journal-pure.mjs";

let checks = 0, fails = 0, total = 0, totalFails = 0;
export const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log("FAIL", msg); } };
export const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((q) => [q, x[q]])) : x));
export const eqc = (a, b, msg) => ok(canon(a) === canon(b), `${msg}: got ${canon(a)}, want ${canon(b)}`);
export function done(name) {
  console.log(fails ? `FAIL ${name}: ${fails} of ${checks} checks failed` : `OK ${checks} checks (${name})`);
  total += checks; totalFails += fails; checks = 0; fails = 0;
  if (totalFails) process.exitCode = 1;
}
export const summary = () => ({ checks: total, failed: totalFails });
export const seeded = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/* where two JSON values differ first (for the sanitize round trip) */
function firstDiff(a, b, path = "") {
  if (canon(a) === canon(b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[k], b[k], `${path}/${k}`); if (d) return d; }
  }
  return `${path}: ${canon(a)} -> ${canon(b)}`;
}
const GM = { user: "gm", staff: true, owns: () => true, hold: true };

const ATTRS = { fighting: 4, agility: 3, strength: 4, reason: 2, intuition: 3, presence: 3 };
export class Table {
  constructor(opts = {}) {
    this.c = {}; this.users = { gm: { id: "gm", staff: true, active: true } };
    this.opts = opts; this.state = null; this.log = J.emptyLog();
    this.dice = [];                  // scripted results for executor dice: arrays of faces, taken in order (default: all 3s)
    this.requests = [];              // roll requests the engine issued
    this.performed = [];             // every effect handed to the host
    this.events = []; this.zonesLog = []; this.zoneMarks = {}; this.settings = {};
    this.ranges = {};                // "a|b" -> { total } | null ; default: same zone (0)
    this.clock = 1000; this.n = 0; this.weapons = {};
    this.rng = seeded(1);            // the cards are shuffled with this (order() looks for a seed that deals the wanted order)
  }
  user(id, staff = false) { this.users[id] = { id, staff, active: true }; return this; }
  add(id, o) {
    this.c[id] = { id, name: o.name ?? id, actorUuid: `Actor.${id}`, tokenUuid: `Scene.s.Token.${id}`, owners: o.owners ?? [], npc: !!o.npc, kind: o.kind ?? (o.npc ? "npc" : "hero"), hidden: !!o.hidden, present: true,
      attrs: { ...ATTRS, ...(o.attrs ?? {}) }, health: o.health ?? 6, maxHealth: o.maxHealth ?? o.health ?? 6, resolve: o.resolve ?? 5, maxResolve: o.maxResolve ?? o.resolve ?? 5, crits: o.crits ?? [],
      armor: o.armor ?? [], slugfest: { damage: o.damage ?? 2 }, huge: !!o.huge, grown: !!o.grown, impervious: !!o.impervious, immune: o.immune ?? [], immunities: o.immunities ?? [], vulnerabilities: o.vulnerabilities ?? [], members: o.members, zone: o.zone ?? "z1", items: [],
      powers: o.powers ?? [], movement: o.movement, timeUnit: o.timeUnit, vehicle: o.vehicle, veteran: !!o.veteran, reflexes: !!o.reflexes, defeated: false, summonOf: o.summonOf ?? null, regeneration: !!o.regeneration };
    for (const u of this.c[id].owners) if (!this.users[u]) this.user(u);
    return this;
  }
  hero(id, owner, o = {}) { return this.add(id, { ...o, owners: [owner] }); }
  npc(id, o = {}) { return this.add(id, { ...o, npc: true }); }
  /** Start the fight with the REAL `start` operation of the round driver (cards drawn from the deck) such that the cards fall in this
      order: the seed of the shuffle is searched, nothing is written by hand. The first of the list has the turn afterwards.
      (Synchronous, so it runs the reducer itself; check-fight.mjs starts a fight through the director.) */
  order(ids, start = {}) {
    const action = O.normalize({ op: "start", mode: "tactical", opts: this.opts, restart: true, ...start }, { staff: true }).action;
    for (let seed = 1; seed < 20000; seed++) {
      const r = O.reduce(null, action, { ...GM, parts: this.parts(), rng: seeded(seed) });
      if (!r.ok) throw new Error(`start refused: ${r.error?.code}`);
      if (r.state.phase !== "turns" || JSON.stringify(O.orderOf(r.state).flatMap((s) => s.members)) !== JSON.stringify(ids)) continue;
      this.rng = seeded(seed + 7919); this.seed = seed; this.state = S.parse(S.serialize(r.state)); this.log = J.emptyLog();
      return this;
    }
    throw new Error(`no seed deals the order ${ids.join(",")}`);
  }
  /** The GM steps the turn to `id` with the real operations (nextTurn forwards, prevTurn back), also past an open action. */
  turn(id) {
    for (let guard = 0; guard < 40 && this.state.init.curMember !== id; guard++) {
      const slot = this.state.init.slots.find((s) => s.members.includes(id));
      if (!slot) throw new Error(`turn: ${id} has no card`);
      const back = slot.state === "done" || slot.done.includes(id);
      const r = O.reduce(this.state, { type: back ? "prevTurn" : "nextTurn" }, { ...GM, parts: this.parts(), rng: this.rng });
      if (!r.ok || !r.changed) throw new Error(`turn: cannot reach ${id} (${r.error?.code ?? "unchanged"})`);
      if (r.state.round !== this.state.round) throw new Error(`turn: ${id} is not reachable in this round`);
      this.state = S.parse(S.serialize(r.state));
    }
    if (this.state.init.curMember !== id) throw new Error(`turn: cannot reach ${id}`);
    return this;
  }
  setRange(a, b, total) { this.ranges[[a, b].sort().join("|")] = total == null ? null : { total, borders: total, levels: 0 }; return this; }

  /* ---- the director's host */
  facts() {
    const T = this;
    return {
      c: (id) => (T.c[id] ? T.c[id] : null),
      weapon: (cid, ref) => (ref === "unarmed" || ref == null ? { id: "unarmed", name: "unarmed", bonus: 0, damage: null, range: null, sharp: false } : T.weapons[ref] ?? null),
      range: (a, b) => { const k = [a, b].sort().join("|"); return k in T.ranges ? T.ranges[k] : (T.c[a]?.zone === T.c[b]?.zone ? { total: 0, borders: 0, levels: 0 } : { total: 1, borders: 1, levels: 0 }); },
      zone: (cid) => ({ spot: T.c[cid]?.zone, key: T.c[cid]?.zone, states: T.zoneMarks[T.c[cid]?.zone] ?? {}, empty: false, terrain: T.terrain?.[T.c[cid]?.zone] ?? "", rooftop: !!T.rooftops?.[T.c[cid]?.zone] }),   // T.terrain = { zone: terrainId }
      inZone: (cid) => Object.values(T.c).filter((x) => x.zone === T.c[cid]?.zone && x.id !== cid).map((x) => x.id),
      inZoneKey: (zone) => Object.values(T.c).filter((x) => x.zone === zone).map((x) => x.id),
      user: (uid) => T.users[uid] ?? null,
      actorValue: (uuid, path) => Object.values(T.c).find((x) => x.actorUuid === uuid)?.[path],
    };
  }
  parts() { return Object.values(this.c).map((x) => ({ id: x.id, hero: !x.npc, owners: x.owners.slice(), defeated: !!x.defeated, challenge: x.kind === "challenge", vehicle: x.kind === "vehicle", summonOf: x.summonOf, veteran: x.veteran, reflexes: x.reflexes, resolve: x.resolve })); }
  sceneFacts() { return Object.values(this.c).map((x) => ({ id: x.id, name: x.name, type: x.kind === "hero" ? "superhero" : x.kind, health: x.health, maxHealth: x.maxHealth, resolve: x.resolve, maxResolve: x.maxResolve, strength: x.attrs.strength, regeneration: x.regeneration })); }
  now() { return ++this.clock; }
  setting(key) { return this.settings[key]; }
  async perform(e) {
    this.performed.push(e);
    const byUuid = (uuid) => Object.values(this.c).find((x) => x.actorUuid === uuid);
    switch (e.t) {
      case "actor": { const c = byUuid(e.uuid), from = c[e.path]; c[e.path] = e.to; return e.undo ? {} : { op: { t: "actor", uuid: e.uuid, path: e.path, from, to: e.to } }; }
      case "critAdd": { const c = byUuid(e.uuid), itemId = `it${++this.n}`; c.crits = [...c.crits, e.n]; c.items.push({ id: itemId, n: e.n }); return { op: { t: "item+", actorUuid: e.uuid, itemId, data: { n: e.n, id: e.id } } }; }
      case "itemDelete": { const c = byUuid(e.actorUuid), it = c.items.find((x) => x.id === e.itemId); c.items = c.items.filter((x) => x !== it); if (it) { const i = c.crits.lastIndexOf(it.n); if (i >= 0) c.crits = c.crits.filter((_, k) => k !== i); } return {}; }
      case "dice": return { result: this.dice.length ? this.dice.shift() : Array.from({ length: e.n }, () => 3) };
      case "rollRequest": this.requests.push(e); return {};
      case "kitFlag": { const c = byUuid(e.uuid), fl = ((c.itemFlags ??= {})[e.item] ??= {}), from = fl[e.key] ?? null; fl[e.key] = e.value ?? null; return e.undo || JSON.stringify(from) === JSON.stringify(e.value ?? null) ? {} : { op: { t: "itemFlag", actorUuid: e.uuid, itemId: e.item, key: e.key, from, to: e.value ?? null } }; }
      case "summonFlag": { const c = this.c[e.combatant], from = c.summonOf ?? null; c.summonOf = e.owner ?? null; return e.undo || from === c.summonOf ? {} : { op: { t: "summonFlag", combatant: e.combatant, from, to: c.summonOf } }; }
      case "zones": {                                                  // the zones API's write path: apply(op) -> { ok, inverse } (zones-api.md section 12), here for { op:"zone" }
        const op = e.op ?? {};
        this.zonesLog.push(e.undo ? { undo: op } : op);
        if (op.op !== "zone") return {};
        const before = { ...(this.zoneMarks[op.zone] ?? {}) };
        this.zoneMarks[op.zone] = { ...before, ...(op.patch ?? {}) };
        for (const [k, v] of Object.entries(this.zoneMarks[op.zone])) if (v === null) delete this.zoneMarks[op.zone][k];
        const inverse = { op: "zone", zone: op.zone, patch: Object.fromEntries(Object.keys(op.patch ?? {}).map((k) => [k, before[k] ?? null])) };
        return e.undo ? {} : { op: { t: "zones", op, inverse } };
      }
      default: return {};
    }
  }

  /* ---- driving */
  async handle(input) {
    const r = await D.handle({ state: this.state, log: this.log }, input, this);
    if (r.state) {
      const back = S.parse(S.serialize(r.state));
      const d = firstDiff(JSON.parse(JSON.stringify(r.state)), back);
      if (d) ok(false, `the state does not survive the store's sanitize round trip at ${d}`);
      this.state = back;
    } else this.state = null;
    this.log = J.parseLog(J.serializeLog(r.log));
    this.events.push(...r.events); this.last = r.env;
    return r.env;
  }
  req(userId, req, rid = `${userId}:t${++this.n}`) { return this.handle({ t: "req", user: { id: userId, staff: !!this.users[userId]?.staff }, rid, req }); }
  gm(req) { return this.req("gm", req); }
  /** Deliver the result of the pending roll `key` of the top (or given) instance, as the chat reader would. */
  roll(key, sixes, o = {}) {
    const inst = o.inst ? this.state.stack.find((i) => i.id === o.inst) : this.top();
    const rec = inst?.rolls?.[key];
    return this.handle({ t: "roll", inst: inst?.id, key, rid: o.rid ?? rec?.req?.rid, author: o.author ?? (rec?.req?.users?.[0] ?? "gm"), sixes, ones: o.ones ?? 0, pushed: o.pushed ?? 0, pushable: o.pushable === true, messageId: `m${++this.n}` });
  }
  top() { return E.topInstance(this.state); }
  prompts(kind = null) { return E.openPrompts(this.state).filter((p) => !kind || p.kind === kind); }
  prompt(kind, about = null) { return this.prompts(kind).find((p) => !about || p.about === about) ?? null; }
  answer(userId, kind, value, about = null) { const p = this.prompt(kind, about); return p ? this.req(userId, { op: userId === "gm" ? "answerFor" : "answer", prompt: p.id, value }) : Promise.resolve({ ok: false, error: { code: "noPrompt" } }); }
  lastRequest() { return this.requests[this.requests.length - 1] ?? null; }
  evs(type) { return this.events.filter((e) => e.type === type); }
}
