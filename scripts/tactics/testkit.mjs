/* Shared helpers of the tactics checks (not a test itself, never loaded by the module): counters, and a SCRIPTED TABLE that stands in for Foundry
   and for the humans. The Table implements the engine's `host` (facts + perform) over plain objects, so whole flows run in node:
     const T = new Table(); T.hero("H1", "p1", {...}); T.npc("N1", {...}); T.order(["H1", "N1"]); await T.req("p1", { op: "declare", ... });
     await T.roll("attack", 3, { pushable: true });   T.dice.push([6, 2]);   await T.gm({ op: "answerFor", ... }); */
import * as E from "./engine-pure.mjs";
import * as P1 from "./p1-standin.mjs";
import * as J from "./journal-pure.mjs";

let checks = 0, fails = 0, total = 0, totalFails = 0;
export const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log("FAIL", msg); } };
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((q) => [q, x[q]])) : x));
export const eq = (a, b, msg) => ok(canon(a) === canon(b), `${msg}: got ${canon(a)}, want ${canon(b)}`);
export const done = (name) => { console.log(`${name}: ${checks} checks, ${fails} failed`); total += checks; totalFails += fails; checks = 0; fails = 0; if (totalFails) process.exitCode = 1; };
export const summary = () => ({ checks: total, failed: totalFails });
export const seeded = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const ATTRS = { fighting: 4, agility: 3, strength: 4, reason: 2, intuition: 3, presence: 3 };
export class Table {
  constructor(opts = {}) {
    this.c = {}; this.users = { gm: { id: "gm", staff: true, active: true } };
    this.state = P1.emptyState(opts); this.log = J.emptyLog();
    this.dice = [];                  // scripted results for executor dice: arrays of faces, taken in order (default: all 3s)
    this.requests = [];              // roll requests the engine issued
    this.performed = [];             // every effect handed to the host
    this.events = []; this.zonesLog = []; this.zoneMarks = {}; this.settings = {};
    this.ranges = {};                // "a|b" -> { total } | null ; default: same zone (0)
    this.clock = 1000; this.n = 0; this.weapons = {};
  }
  user(id, staff = false) { this.users[id] = { id, staff, active: true }; return this; }
  add(id, o) {
    this.c[id] = { id, name: o.name ?? id, actorUuid: `Actor.${id}`, tokenUuid: `Scene.s.Token.${id}`, owners: o.owners ?? [], npc: !!o.npc, kind: o.kind ?? (o.npc ? "npc" : "hero"), hidden: !!o.hidden, present: true,
      attrs: { ...ATTRS, ...(o.attrs ?? {}) }, health: o.health ?? 6, maxHealth: o.maxHealth ?? o.health ?? 6, resolve: o.resolve ?? 5, maxResolve: o.maxResolve ?? o.resolve ?? 5, crits: o.crits ?? [],
      armor: o.armor ?? [], slugfest: { damage: o.damage ?? 2 }, huge: !!o.huge, immunities: o.immunities ?? [], vulnerabilities: o.vulnerabilities ?? [], members: o.members, zone: o.zone ?? "z1", items: [] };
    for (const u of this.c[id].owners) if (!this.users[u]) this.user(u);
    return this;
  }
  hero(id, owner, o = {}) { return this.add(id, { ...o, owners: [owner] }); }
  npc(id, o = {}) { return this.add(id, { ...o, npc: true }); }
  order(ids) { this.state = P1.setOrder(this.state, ids.map((id) => ({ members: [id] }))); return this; }
  turn(id) { this.state = P1.startTurn(this.state, id); return this; }
  setRange(a, b, total) { this.ranges[[a, b].sort().join("|")] = total == null ? null : { total, borders: total, levels: 0 }; return this; }

  /* ---- the engine's host */
  facts() {
    const T = this;
    return {
      c: (id) => (T.c[id] ? T.c[id] : null),
      weapon: (cid, ref) => (ref === "unarmed" || ref == null ? { id: "unarmed", name: "unarmed", bonus: 0, damage: null, range: null, sharp: false } : T.weapons[ref] ?? null),
      range: (a, b) => { const k = [a, b].sort().join("|"); return k in T.ranges ? T.ranges[k] : (T.c[a]?.zone === T.c[b]?.zone ? { total: 0, borders: 0, levels: 0 } : { total: 1, borders: 1, levels: 0 }); },
      zone: (cid) => ({ spot: T.c[cid]?.zone, states: T.zoneMarks[T.c[cid]?.zone] ?? {}, empty: false }),
      inZone: (cid) => Object.values(T.c).filter((x) => x.zone === T.c[cid]?.zone && x.id !== cid).map((x) => x.id),
      user: (uid) => T.users[uid] ?? null,
      actorValue: (uuid, path) => Object.values(T.c).find((x) => x.actorUuid === uuid)?.[path],
    };
  }
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
      case "zones": {
        if (e.isInverse || e.undo) { this.zonesLog.push({ undo: e }); if (e.call === "setZone") this.zoneMarks[e.zone] = { ...(this.zoneMarks[e.zone] ?? {}), ...e.patch }; return {}; }
        const before = { ...(this.zoneMarks[e.zone] ?? {}) };
        this.zoneMarks[e.zone] = { ...before, ...(e.patch ?? {}) };
        this.zonesLog.push(e);
        return { op: { t: "zones", call: e.call, zone: e.zone, patch: e.patch, inverse: { call: "setZone", zone: e.zone, patch: Object.fromEntries(Object.keys(e.patch ?? {}).map((k) => [k, before[k] ?? null])) } } };
      }
      default: return {};
    }
  }

  /* ---- driving */
  async handle(input) {
    const r = await E.handle({ state: this.state, log: this.log }, input, this);
    this.state = r.state; this.log = r.log; this.events.push(...r.events); this.last = r.env;
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
