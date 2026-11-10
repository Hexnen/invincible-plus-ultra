/* Shared by the node checks that need a MAP (not a test itself, never loaded by the module): the fake zones API and the scripted table
   on top of it, taken over from check-move.mjs (which keeps its own copy for now, so that file stays untouched). The fake keeps the
   contract of moinen-maps dev/zones-api.md: places and spots, plan / planAlong / forcedChain / reach, move with the beforeStep listeners,
   apply with inverses. It has no geometry: zones carry a grid position only so that a straight chain exists. A zone may carry
   `terrain` and `rooftop` (what the attack flow reads to wreck it). */
import { Table } from "./testkit.mjs";

/* ------------------------------------------------------------------ the fake map */
export function fakeZones(def) {
  const Z = { zones: def.zones, borders: JSON.parse(JSON.stringify(def.borders)), tokens: {}, states: def.states ?? {}, listeners: [], seq: 0, log: [], cfg: {}, driver: null, picks: [], marks: {} };
  const bkey = (a, b) => (Z.borders[`${a}|${b}`] ? `${a}|${b}` : Z.borders[`${b}|${a}`] ? `${b}|${a}` : null);
  const spotOf = (p) => (p.area ? `@${p.area}` : p.level === "floor" ? `${p.zone}:f${p.floor}` : p.level && p.level !== "ground" ? `${p.zone}:${p.level}` : p.zone);
  const mk = (p) => { const q = { zone: p.zone ?? null, id: p.zone ? Z.zones[p.zone]?.id ?? null : null, area: p.area ?? null, level: p.area ? null : p.level ?? "ground", floor: p.floor ?? null, airborne: p.level === "elevated" && p.airborne === true, roof: p.level === "elevated" && !p.airborne && !!Z.zones[p.zone]?.rooftop, below: null }; q.spot = spotOf(q); return q; };
  const tokId = (t) => (typeof t === "string" ? t : t?.id ?? t?.document?.id);
  function place(where) {
    if (where == null) return null;
    if (typeof where === "object" && (where.id || where.document) && Z.tokens[tokId(where)]) return mk(Z.tokens[tokId(where)]);
    if (typeof where === "object") return where.area ? mk({ area: where.area }) : Z.zones[where.zone] ? mk(where) : null;
    if (where.startsWith("@")) return ["sky", "orbit", "dimension", "chase"].includes(where.slice(1)) ? mk({ area: where.slice(1) }) : null;
    const [zone, lv] = where.split(":"), f = /^f(\d+)$/.exec(lv ?? "");
    if (!Z.zones[zone]) return null;
    return mk(f ? { zone, level: "floor", floor: Number(f[1]) } : { zone, level: lv ?? "ground", airborne: lv === "elevated" && !Z.zones[zone].rooftop });
  }
  const borderOf = (a, b) => {
    const key = bkey(a, b); if (!key) return null;
    const d = Z.borders[key], wallUp = d.wall && d.wall.state === "intact", doorShut = d.doorway && ["locked", "sealed"].includes(d.doorway.state), doorOpen = d.doorway && ["open", "breached", "closed"].includes(d.doorway.state);
    const solid = !!wallUp && !doorOpen;
    return { key, kind: d.wall ? "wall" : "open", armor: d.wall?.armor ?? 0, door: d.doorway?.state ?? null, stops: { walk: solid, air: solid && !d.wall.outer, through: false }, wall: d.wall ? { ...d.wall } : null, doorway: d.doorway ? { ...d.doorway } : null, _doorShut: !!doorShut };
  };
  const stopWay = (way) => (["flight", "air", "leap", "superspeed", "swing"].includes(way) ? "air" : ["through", "burrow", "teleport", "phase"].includes(way) ? "through" : "walk");
  const neighbours = (z) => Object.keys(Z.borders).filter((k) => k.split("|").includes(z)).map((k) => k.split("|").find((x) => x !== z));
  function stepsAlong(from, keys, way, end, forced) {
    const steps = []; let level = from.level, floor = from.floor, air = from.airborne;
    for (let i = 1; i < keys.length; i++) {
      const b = borderOf(keys[i - 1], keys[i]); if (!b) return null;
      const sw = forced ? (from.level === "elevated" ? "air" : "walk") : stopWay(way), last = i === keys.length - 1;
      if (last && end) { level = end.level ?? level; floor = end.floor ?? null; air = end.airborne === true; }
      const to = mk({ zone: keys[i], level, floor, airborne: air });
      steps.push({ kind: "border", from: i === 1 ? from.spot : steps[i - 2].to, to: to.spot, zone: keys[i], level, floor, border: { key: b.key, kind: b.kind, wall: b.wall, doorway: b.doorway, ...(b.stops[sw] ? { blocked: true } : {}), ...(sw === "air" && b.wall?.outer && b.wall.state === "intact" ? { over: true } : {}) } });
    }
    if (keys.length === 1 && end && (end.level ?? "ground") !== from.level) steps.push({ kind: "level", from: from.spot, to: mk({ zone: keys[0], ...end }).spot, zone: keys[0], level: end.level });
    return steps;
  }
  function route(a, b, way, force) {                                    // breadth first, fewest borders; unblocked routes first
    for (const allow of force ? [false, true] : [false]) {
      const prev = { [a]: null }, q = [a];
      while (q.length) {
        const z = q.shift(); if (z === b) { const out = []; for (let x = b; x; x = prev[x]) out.unshift(x); return out; }
        for (const n of neighbours(z).sort()) { if (n in prev) continue; if (borderOf(z, n).stops[stopWay(way)] && !allow) continue; prev[n] = z; q.push(n); }
      }
    }
    return null;
  }
  const costOf = (total, p) => ({ total, speed: p?.speed ?? 1, actions: Math.ceil(total / (p?.speed ?? 1)), stressSpeed: null, stressActions: null, within: total === 0 ? "free" : total <= (p?.speed ?? 1) * (p?.actions ?? 1) ? "plain" : "no" });
  function planOf(from, keys, profile, end, forced) {
    const steps = stepsAlong(from, keys, profile?.way ?? "walk", end, forced); if (!steps) return null;
    const last = steps[steps.length - 1], total = steps.filter((s) => s.kind === "border").length;
    return { way: profile?.way ?? "walk", total, borders: total, levels: steps.length - total, zones: keys.slice(), steps, cost: costOf(total, profile), from, end: last ? place(last.to) : from, ...(forced ? { forced: true } : {}) };
  }
  const api = {
    _: Z, version: () => "fake", canWrite: () => true,
    zoneOfToken: (t) => (Z.tokens[tokId(t)] ? mk(Z.tokens[tokId(t)]) : null), place,
    zone: (key) => (Z.zones[key] ? { key, id: Z.zones[key].id, rooftop: !!Z.zones[key].rooftop, states: { ...(Z.marks[key] ?? {}) }, empty: false } : null),
    zoneStates: (where) => { const p = place(where); return p?.zone ? (Z.states[p.zone] ?? []).filter((s) => !s.at || s.at === p.spot) : []; },
    borderBetween: (a, b) => { const x = borderOf(a, b); if (!x) return null; const { _doorShut, ...rest } = x; return rest; },
    bordersOf: (where) => { const z = place(where)?.zone; return Object.keys(Z.borders).filter((k) => k.split("|").includes(z)).map((k) => api.borderBetween(...k.split("|"))); },
    range: (a, b) => { const pa = place(a), pb = place(b); if (!pa || !pb) return null; if (pa.area || pb.area) return pa.area === pb.area ? { total: 0, borders: 0, levels: 0 } : null; const r = route(pa.zone, pb.zone, "through", false); const levels = pa.level === pb.level ? 0 : 1; return r ? { total: r.length - 1 + levels, borders: r.length - 1, levels } : null; },
    tokensInZone: (where) => { const p = place(where), bare = typeof where === "string" && !where.includes(":") && !where.startsWith("@"); return Object.values(Z.tokens).map((t) => ({ token: { id: t.id }, place: mk(t) })).filter((r) => (bare ? r.place.zone === p?.zone : r.place.spot === p?.spot)); },
    zonesWithin: (where, n) => api.reach(where, { way: "through", speed: n }, { max: n }).map((r) => ({ zone: r.zone, d: r.d })),
    graph: () => ({ zones: Object.keys(Z.zones).map((key) => ({ key, ...Z.zones[key] })), borders: Object.keys(Z.borders).map((key) => ({ key, ...Z.borders[key] })) }),
    profile: (p) => p,
    plan(a, b, profile) {
      const from = place(a), to = place(b); if (!from || !to || from.area || to.area) return null;
      if (to.airborne && profile?.hover === false) return null;
      const keys = route(from.zone, to.zone, profile?.way ?? "walk", !!profile?.force); if (!keys) return null;
      return planOf(from, keys, profile, { level: to.level, floor: to.floor, airborne: to.airborne }, false);
    },
    moveCost(a, b, profile) { const plan = api.plan(a, b, profile); return plan ? { reachable: plan.cost.within !== "no", plan, cost: plan.cost } : null; },
    reach(where, profile, { max } = {}) {
      const from = place(where); if (!from?.zone) return [];
      const d = { [from.zone]: 0 }, q = [from.zone], lim = max ?? (profile?.speed ?? 1) * (profile?.actions ?? 1);
      while (q.length) { const z = q.shift(); if (d[z] >= lim) continue; for (const n of neighbours(z).sort()) { if (n in d) continue; if (borderOf(z, n).stops[stopWay(profile?.way)] && !profile?.force) continue; d[n] = d[z] + 1; q.push(n); } }
      return Object.entries(d).sort((x, y) => x[1] - y[1]).map(([zone, dist]) => ({ zone, id: Z.zones[zone].id, d: dist, cost: costOf(dist, profile) }));
    },
    planAlong(fromRef, keys, { profile, end, forced } = {}) { const from = place(fromRef); if (!from?.zone || !Array.isArray(keys) || keys[0] !== from.zone) return null; return planOf(from, keys, profile, end, !!forced); },
    forcedChain(who, { direction, awayFrom, toward, distance = 1 } = {}) {
      const from = place(who); if (!from?.zone) return null;
      const pos = (z) => Z.zones[z].pos, other = place(awayFrom ?? toward);
      let dx = direction?.dx ?? 0, dy = direction?.dy ?? 0;
      if (other?.zone) { dx = Math.sign(pos(from.zone)[0] - pos(other.zone)[0]) * (awayFrom ? 1 : -1); dy = Math.sign(pos(from.zone)[1] - pos(other.zone)[1]) * (awayFrom ? 1 : -1); }
      if (!dx && !dy) return null;
      const keys = [from.zone]; let end = "distance";
      for (let i = 1; i <= distance; i++) { const p = [pos(from.zone)[0] + dx * i, pos(from.zone)[1] + dy * i], z = Object.keys(Z.zones).find((k) => pos(k)[0] === p[0] && pos(k)[1] === p[1]); if (!z || !bkey(keys[keys.length - 1], z)) { end = "edge"; break; } keys.push(z); }
      const plan = planOf(from, keys, null, { level: from.level, floor: from.floor, airborne: from.level === "elevated" }, true);
      return plan ? { ...plan, ray: { dx, dy, end, points: [] } } : null;
    },
    freeSpot: () => ({ x: 0, y: 0, crowded: false }),
    beforeStep(fn) { Z.listeners.push(fn); return () => { Z.listeners = Z.listeners.filter((x) => x !== fn); }; },
    async move(token, to, { profile, plan, group = [], forced = false, data } = {}) {
      const id = tokId(token), t = Z.tokens[id]; if (!t) return { ok: false, reason: "noToken" };
      const p = plan ?? api.plan(token, to, profile); if (!p) return { ok: false, reason: "noRoute" };
      if (p.from.spot !== mk(t).spot) return { ok: false, reason: "stalePlan" };
      const op = `mv${++Z.seq}`, movers = [id, ...group.map(tokId)], start = movers.map((m) => ({ id: m, zone: Z.tokens[m].zone, alt: Z.tokens[m].level, floor: Z.tokens[m].floor ?? null, air: Z.tokens[m].airborne ?? null, area: Z.tokens[m].area ?? null }));
      let done = 0, stopped = null;
      for (let index = 0; index < p.steps.length; index++) {
        const step = p.steps[index], fromP = mk(t), toP = place(step.to), live = step.kind === "border" ? borderOf(fromP.zone, step.zone) : null;
        const ctx = { op, index, last: index === p.steps.length - 1, step, remaining: p.steps.length - index, token: { id }, group, profile: profile ?? { way: p.way }, plan: p, forced, data, from: fromP, to: toP, border: live ? (({ _doorShut, ...r }) => r)(live) : undefined, statesFrom: api.zoneStates(fromP.spot), statesTo: api.zoneStates(toP.spot) };
        let pass = false;
        try { for (const fn of Z.listeners) { const a = await fn(ctx); if (a === false) { stopped = { index, reason: "listener", data: null, step }; break; } if (a && a.stop) { stopped = { index, reason: a.reason ?? "listener", data: a.data ?? null, step }; break; } if (a && a.pass) pass = true; } } catch { stopped = { index, reason: "error", data: null, step }; }
        if (stopped) break;
        const again = step.kind === "border" ? borderOf(fromP.zone, step.zone) : null, sw = forced ? (fromP.level === "elevated" ? "air" : "walk") : stopWay(profile?.way ?? p.way);
        if (again && again.stops[sw] && !pass) { stopped = { index, reason: "blocked", data: null, step }; break; }
        for (const m of movers) Object.assign(Z.tokens[m], { zone: toP.zone, level: toP.level, floor: toP.floor, airborne: toP.airborne, area: null });
        done++; Z.log.push({ op, step: step.to, movers: movers.slice() });
      }
      return { ok: true, op, done, total: p.steps.length, stopped, place: mk(t), inverse: done ? { op: "tokens", rows: start } : null };
    },
    async moveToZone(token, where, { group = [] } = {}) {
      const id = tokId(token), t = Z.tokens[id], p = place(where); if (!t) return { ok: false, reason: "noToken" }; if (!p) return { ok: false, reason: "noZone" };
      const movers = [id, ...group.map(tokId)], rows = movers.map((m) => ({ id: m, zone: Z.tokens[m].zone, alt: Z.tokens[m].level, floor: Z.tokens[m].floor ?? null, air: Z.tokens[m].airborne ?? null, area: Z.tokens[m].area ?? null }));
      for (const m of movers) Object.assign(Z.tokens[m], p.area ? { area: p.area } : { zone: p.zone, level: p.level, floor: p.floor, airborne: p.airborne, area: null });
      Z.log.push({ put: p.spot, movers });
      return { ok: true, inverse: { op: "tokens", rows }, place: mk(t) };
    },
    async apply(op) {
      if (op.op === "tokens") { const rows = op.rows.map((r) => ({ id: r.id, zone: Z.tokens[r.id].zone, alt: Z.tokens[r.id].level, floor: Z.tokens[r.id].floor ?? null, air: Z.tokens[r.id].airborne ?? null, area: Z.tokens[r.id].area ?? null })); for (const r of op.rows) Object.assign(Z.tokens[r.id], { ...(r.zone !== undefined ? { zone: r.zone } : {}), level: r.alt ?? "ground", floor: r.floor ?? null, airborne: r.air === true, area: r.area ?? null }); return { ok: true, changed: true, inverse: { op: "tokens", rows }, result: null }; }
      if (op.op === "border") { const d = Z.borders[op.border]; if (!d) return { ok: false, reason: "noBorder" }; const inv = { op: "border", border: op.border, ...(op.wall ? { wall: { state: d.wall.state } } : {}), ...(op.door ? { door: { state: d.doorway.state } } : {}) }; if (op.wall) d.wall.state = op.wall.state; if (op.door) d.doorway.state = op.door.state; return { ok: true, changed: true, inverse: inv, result: null }; }
      if (op.op === "zone") { const before = { ...(Z.marks[op.zone] ?? {}) }; Z.marks[op.zone] = { ...before, ...op.patch }; return { ok: true, changed: true, inverse: { op: "zone", zone: op.zone, patch: Object.fromEntries(Object.keys(op.patch).map((k) => [k, before[k] ?? null])) }, result: null }; }
      return { ok: false, reason: "badOp" };
    },
    tactical(cfg) { Z.cfg.tactical = cfg === false ? null : cfg; return true; }, tacticalOn: () => !!Z.cfg.tactical,
    rulesDriver(cfg) { Z.driver = cfg === false ? null : cfg; return true; }, drivenBy: () => (Z.driver ? { id: Z.driver.id, title: Z.driver.title, fireRound: typeof Z.driver.fireRound === "function", distances: Z.driver.distances !== false } : null),
    highlight: () => "h1", clearHighlights: () => 0, showReach: () => "reach", cancelPick: () => {},
    async pick(spec) { Z.picks.push(spec); const want = Z.nextPick; return want ? { ok: true, zone: want.split(":")[0], spot: want, place: place(want), x: 0, y: 0 } : { ok: false, reason: "cancelled" }; },
  };
  return api;
}
/* a small city block:   z1 - z2 - z3 - z4      z2|z3 open, z3|z4 an interior wall (Armor 2) with a locked door (Armor 1)
                          |         |            z1|z5 open, z5|z6 an exterior wall (Armor 3), z3|z6 open, z6 has a rooftop
                         z5 ]wall[ z6                                                                                         */
export const CITY = () => ({
  zones: { z1: { id: 1, pos: [0, 0] }, z2: { id: 2, pos: [1, 0] }, z3: { id: 3, pos: [2, 0] }, z4: { id: 4, pos: [3, 0] }, z5: { id: 5, pos: [0, 1] }, z6: { id: 6, pos: [2, 1], rooftop: true } },
  borders: { "z1|z2": {}, "z2|z3": {}, "z3|z4": { wall: { armor: 2, state: "intact" }, doorway: { armor: 1, state: "locked" } }, "z1|z5": {}, "z5|z6": { wall: { armor: 3, state: "intact", outer: true } }, "z3|z6": {} },
  states: {},
});
const warnings = [];
let FAKE = null;
globalThis.game = { modules: { get: (id) => (id.startsWith("moinen") && FAKE ? { active: true, api: { zones: FAKE } } : null) }, i18n: null, user: { id: "gm", isGM: true } };
globalThis.ui = { notifications: { warn: (m) => warnings.push(m), info: (m) => warnings.push(m) } };
globalThis.Hooks = { on: () => 1, off: () => {} };
const dialogs = [];
globalThis.foundry = { applications: { api: { DialogV2: { wait: async (cfg) => { dialogs.push(cfg); return cfg.buttons[0].action; } } } } };
const Zones = await import("./zones-adapter.mjs");
const Mv = await import("./movement.mjs");
const MP = await import("./movement-pure.mjs");

export class MTable extends Table {
  constructor(def = CITY()) { super(); FAKE = fakeZones(def); this.map = FAKE; Mv.uninstall(); FAKE._.listeners = []; Zones.beforeStep((ctx) => MP.stepVerdict(ctx)); }
  handle(input) { FAKE = this.map; return super.handle(input); }      // the adapter talks to this table's map
  put(cid, spot) { const p = this.map.place(spot); this.map._.tokens[cid] = { id: cid, zone: p.zone, level: p.level, floor: p.floor, airborne: p.airborne, area: p.area }; return this; }
  spot(cid) { return this.map.zoneOfToken(cid)?.spot ?? null; }
  tok(cid) { return this.map._.tokens[cid] ? { id: cid } : null; }
  facts() {
    FAKE = this.map;
    const f = super.facts(), tok = (cid) => this.tok(cid), by = (t) => t?.id ?? null, Zf = Mv.zoneFacts(tok, by);
    return { ...f, zones: Zf, range: (a, b) => Zones.range(tok(a), tok(b)), canTalk: (a, b) => Mv.talk(Zf, a, b)?.ok,
      zone: (cid) => { const p = Zf.place(cid), z = p?.zone ? this.map._.zones[p.zone] : null; return p ? { spot: p.spot, key: p.zone, level: p.level, area: p.area, airborne: p.airborne, states: { ...(this.map._.marks[p.zone] ?? {}) }, empty: z?.empty === true, terrain: z?.terrain ?? "", rooftop: !!z?.rooftop } : null; },
      inZone: (cid) => Zf.at(Zf.place(cid)?.spot).filter((x) => x !== cid), inZoneKey: (z) => Zf.at(z) };
  }
  async perform(e) {
    if (e.t === "zmove" || e.t === "zput") { this.performed.push(e); return Mv.performMove(e, (cid) => this.tok(cid)); }
    if (e.t === "zones") { this.performed.push(e); const r = await Zones.perform(e); return r.ok ? (r.op ? { op: r.op, result: r.result } : { result: r.result }) : { ok: false, reason: r.reason }; }
    return super.perform(e);
  }
}
