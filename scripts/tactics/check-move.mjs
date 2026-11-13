/* node scripts/tactics/check-move.mjs -- package P3: whole scripted moves through the REAL director, engine, ledger, journal, zones adapter
   and movement side (movement.mjs), against a FAKE ZONES API that keeps the contract of moinen-maps dev/zones-api.md: places and spots
   (section 2), `plan` / `planAlong` / `forcedChain` / `reach` (section 14), `move` with the `beforeStep` listeners asked before every step,
   the border re-read after the listeners, `stopped`, one `tokens` inverse per move, group moves, `moveToZone`, `apply` with inverses
   (section 12), `tactical`, `pick`, `rulesDriver`. The fake has no geometry: zones carry a grid position only so that a straight chain
   exists. Nothing here needs Foundry, a browser or a GPU. */
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import { movement as RM, zones as RZ, hazards as RH, maneuvers as RMan } from "../rules/index.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./mods-pure.mjs";

/* ------------------------------------------------------------------ the fake map */
function fakeZones(def) {
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
  // A14 (the user's answer, as the map's marks.mjs stopped()): a flyer passes over a blocked border with a standing rooftop on exactly one side
  const roofOf = (k) => !!Z.zones[k]?.rooftop && !Z.marks?.[k]?.wrecked;
  const borderOf = (a, b) => {
    const key = bkey(a, b); if (!key) return null;
    const d = Z.borders[key], wallUp = d.wall && d.wall.state === "intact", doorShut = d.doorway && ["locked", "sealed"].includes(d.doorway.state), doorOpen = d.doorway && ["open", "breached", "closed"].includes(d.doorway.state);
    const solid = !!wallUp && !doorOpen;
    return { key, kind: d.wall ? "wall" : "open", armor: d.wall?.armor ?? 0, door: d.doorway?.state ?? null, stops: { walk: solid, air: solid && !d.wall.outer && roofOf(a) === roofOf(b), through: false }, wall: d.wall ? { ...d.wall } : null, doorway: d.doorway ? { ...d.doorway } : null, _doorShut: !!doorShut };
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
      steps.push({ kind: "border", from: i === 1 ? from.spot : steps[i - 2].to, to: to.spot, zone: keys[i], level, floor, border: { key: b.key, kind: b.kind, wall: b.wall, doorway: b.doorway, ...(b.stops[sw] ? { blocked: true } : {}), ...(sw === "air" && ((b.wall?.outer && b.wall.state === "intact") || (b.stops.walk && !b.stops.air)) ? { over: true } : {}) } });
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
    const last = steps[steps.length - 1], borders = steps.filter((s) => s.kind === "border").length, total = steps.length;      // as the map: steps.length === total (a level step is one of them)
    return { way: profile?.way ?? "walk", total, borders, levels: steps.length - borders, zones: keys.slice(), steps, cost: costOf(total, profile), from, end: last ? place(last.to) : from, ...(forced ? { forced: true } : {}) };
  }
  const api = {
    _: Z, version: () => "fake", canWrite: () => true,
    zoneOfToken: (t) => (Z.tokens[tokId(t)] ? mk(Z.tokens[tokId(t)]) : null), place,
    zone: (key) => (Z.zones[key] ? { key, id: Z.zones[key].id, rooftop: !!Z.zones[key].rooftop, states: { ...(Z.marks[key] ?? {}) }, empty: false } : null),
    /* as the map (zones-api.md sections 2, 10): a bare key is EVERY level; a spot with a level, a place or a token is that level and the
       states naming none (`at`: "ground" | "elevated" | "underground" | "f2"); anyLevel says it outright. The ground spot IS the bare key. */
    zoneStates: (where, o = {}) => { const p = place(where), bare = typeof where === "string" && !where.includes(":"), lv = p ? (p.level === "floor" ? `f${p.floor}` : p.level) : null; return p?.zone ? (Z.states[p.zone] ?? []).filter((s) => (o.anyLevel ?? bare) || !s.at || s.at === lv) : []; },
    borderBetween: (a, b) => { const x = borderOf(a, b); if (!x) return null; const { _doorShut, ...rest } = x; return rest; },
    bordersOf: (where) => { const z = place(where)?.zone; return Object.keys(Z.borders).filter((k) => k.split("|").includes(z)).map((k) => api.borderBetween(...k.split("|"))); },
    range: (a, b) => { const pa = place(a), pb = place(b); if (!pa || !pb) return null; if (pa.area || pb.area) return pa.area === pb.area ? { total: 0, borders: 0, levels: 0 } : null; const r = route(pa.zone, pb.zone, "through", false); const levels = pa.level === pb.level ? 0 : 1; return r ? { total: r.length - 1 + levels, borders: r.length - 1, levels } : null; },
    tokensInZone: (where, o = {}) => { const p = place(where), bare = o.anyLevel ?? (typeof where === "string" && !where.includes(":") && !where.startsWith("@")); return Object.values(Z.tokens).map((t) => ({ token: { id: t.id }, place: mk(t) })).filter((r) => (bare ? r.place.zone === p?.zone : r.place.spot === p?.spot)); },
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
    /* the token HUD's altitude button (zones-api.md section 14 "Level changes"): written at once, unless tactical({ levels: true, confirm })
       holds it for a token `when` accepts: then confirm() is asked and only a `true` writes the level */
    async setAltitude(t, spot) {
      const id = tokId(t), cur = Z.tokens[id], to = cur ? place(`${cur.zone}${String(spot).includes(":") ? `:${String(spot).split(":")[1]}` : spot === "ground" ? "" : `:${spot}`}`) : null;
      if (!cur || !to) return false;
      const from = mk(cur), T = Z.cfg.tactical, write = () => { Object.assign(cur, { level: to.level, floor: to.floor, airborne: to.airborne, area: null }); return true; };
      if (from.spot === to.spot) return true;
      if (!T?.levels || !T.confirm || (T.when && !T.when({ id }))) return write();
      const yes = await T.confirm({ token: { id }, from, to, level: true, drop: null, profile: T.profile?.({ id }) ?? null, plan: null, cost: null, reachable: true });
      return yes === true ? write() : false;
    },
    rulesDriver(cfg) { Z.driver = cfg === false ? null : cfg; return true; }, drivenBy: () => (Z.driver ? { id: Z.driver.id, title: Z.driver.title, fireRound: typeof Z.driver.fireRound === "function", distances: Z.driver.distances !== false } : null),
    highlight: () => "h1", clearHighlights: () => 0, showReach: () => "reach", cancelPick: () => {},
    async pick(spec) { Z.picks.push(spec); const want = Z.nextPick; return want ? { ok: true, zone: want.split(":")[0], spot: want, place: place(want), x: 0, y: 0 } : { ok: false, reason: "cancelled" }; },
  };
  return api;
}
/* a small city block:   z1 - z2 - z3 - z4      z2|z3 open, z3|z4 an interior wall (Armor 2) with a locked door (Armor 1)
                          |         |            z1|z5 open, z5|z6 an exterior wall (Armor 3), z3|z6 open, z6 has a rooftop
                         z5 ]wall[ z6                                                                                         */
const CITY = () => ({
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
const ZP = await import("./zones-pure.mjs");

class MTable extends Table {
  constructor(def = CITY()) { super(); FAKE = fakeZones(def); this.map = FAKE; Mv.uninstall(); FAKE._.listeners = []; Zones.beforeStep((ctx) => MP.stepVerdict(ctx)); }
  handle(input) { FAKE = this.map; return super.handle(input); }      // the adapter talks to this table's map
  put(cid, spot) { const p = this.map.place(spot); this.map._.tokens[cid] = { id: cid, zone: p.zone, level: p.level, floor: p.floor, airborne: p.airborne, area: p.area }; return this; }
  spot(cid) { return this.map.zoneOfToken(cid)?.spot ?? null; }
  tok(cid) { return this.map._.tokens[cid] ? { id: cid } : null; }
  facts() {
    FAKE = this.map;
    const f = super.facts(), tok = (cid) => this.tok(cid), by = (t) => t?.id ?? null, Zf = Mv.zoneFacts(tok, by);
    return { ...f, zones: Zf, range: (a, b) => Zones.range(tok(a), tok(b)), canTalk: (a, b) => Mv.talk(Zf, a, b)?.ok,
      zone: (cid) => { const p = Zf.place(cid); return p ? { spot: p.spot, key: p.zone, level: p.level, area: p.area, airborne: p.airborne, states: {}, empty: false } : null; },
      inZone: (cid) => Zf.at(Zf.place(cid)?.spot).filter((x) => x !== cid), inZoneKey: (z) => Zones.tokensInZone(z).map(by).filter(Boolean) };      // as engine.mjs: a key is every level, "z:ground" the ground alone
  }
  async perform(e) {
    if (e.t === "zmove" || e.t === "zput") { this.performed.push(e); return Mv.performMove(e, (cid) => this.tok(cid)); }
    if (e.t === "zones") { this.performed.push(e); const r = await Zones.perform(e); return r.ok ? (r.op ? { op: r.op, result: r.result } : { result: r.result }) : { ok: false, reason: r.reason }; }
    return super.perform(e);
  }
}
const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const why = (env) => env?.error?.params?.reason ?? null;
const base = (def) => { const T = new MTable(def); T.hero("H1", "p1", { attrs: { strength: 5 } }).hero("H2", "p2", { attrs: { strength: 2 } }).npc("N1", { health: 5 }); T.put("H1", "z1").put("H2", "z1").put("N1", "z2"); T.order(["H1", "N1", "H2"]); return T; };
const mv = (actor, to, extra = {}) => ({ op: "move", actor, to, ...extra });
const entries = (T, cid) => T.state.ledger[cid].entries.filter((e) => !e.void);
const lastTx = (T) => T.log.list[T.log.list.length - 1];
const FLY = [{ mode: "flight", tier: "basic" }];

/* ---- A. one zone on foot: a quick action, the token goes step by step, one transaction, undo puts everything back */
{
  const T = base();
  const walk = RM.moveCost(1, RM.moveProfile("walk"), {});
  eq((await T.req("p1", mv("H1", "z2"))).ok, true, "A: a move is accepted");
  eq([T.spot("H1"), T.state.stack.length], ["z2", 0], "A: the token is in the next zone and the action closed");
  const e = entries(T, "H1")[0];
  eq([e.action, e.tags.includes("move"), e.zoneFrom, e.zoneTo], ["move", true, "z1", "z2"], "A: the ledger entry carries the move and its zones");
  eq(P1.budget(T.state, "H1")[walk.options[0].action] !== "open", true, "A: the action the rules library named is spent");
  eq(P1.history(T.state, "H1", "thisTurn", "move"), true, "A: the history fact `moved` is set (derived from the entry)");
  const evm = T.evs("move").pop();
  eq([evm.combatant, evm.from, evm.to, evm.stopped], ["H1", "z1", "z2", null], "A: the move is announced on the event stream");
  eq(T.map._.log.length, 1, "A: one step was written by the map");
  const tx = lastTx(T);
  ok(tx.ops.some((o) => o.t === "zones" && o.inverse?.op === "tokens"), "A: the journal keeps the map's own inverse");
  eq((await T.gm({ op: "undo", tx: tx.id })).ok, true, "A: undo");
  eq([T.spot("H1"), entries(T, "H1").length], ["z1", 0], "A: undo puts the token back and frees the action");
}
/* ---- B. distance and legality come from the rules library */
{
  const T = base();
  const two = RM.moveCost(2, RM.moveProfile("walk"), {});
  const r = await T.req("p1", mv("H1", "z3"));
  eq(r.ok, two.ok && two.options.some((o) => o.stress === 0), "B: two zones on foot in one action: as the rules library says");
  eq((await T.req("p1", mv("H1", "z9"))).error.params.reason, "noZone", "B: an unknown zone is refused");
  eq(why(await T.req("p1", mv("H1", "z2", { mode: "flight" }))), "noMode", "B: a way of moving the character does not have is refused");
  eq(code(await T.req("p2", mv("H1", "z2"))), "notOwner", "B: only the owner moves a character");
  eq(code(await T.req("p2", mv("H2", "z2"))), "notYourTurn", "B: a move costs an action of the own turn [L3]");
  eq(why(await T.req("p1", mv("H1", "z4"))), "barrier", "B: behind a wall");
  const T2 = base(); await T2.gm({ op: "statusAdd", combatant: "H1", status: { id: "grappled", data: { by: "N1" } } });
  eq(why(await T2.req("p1", mv("H1", "z2"))), "held", "B: a held character does not move [B2496]");
  eq(MP.cannotMove(T2.state, "H1", { ...T2.c.H1, health: 0 }), "broken", "B: a broken character does not move");
}
/* ---- C. inside the zone: free, own turn only [L6] */
{
  const T = base();
  eq((await T.req("p1", mv("H1", "z1"))).ok, true, "C: a move inside the zone on the own turn");
  const e = entries(T, "H1")[0];
  eq([e.tags.includes("moveInZone"), P1.budget(T.state, "H1").quick, T.map._.log.length], [true, P1.budget(base().state, "H1").quick, 0], "C: it costs nothing, is recorded, and the map moves nobody");
  eq([code(await T.req("p2", mv("H2", "z1"))), why(T.last)], ["illegal", "notYourTurn"], "C: not on another's turn");
}
/* ---- D. flight: further, over the exterior wall, ends in the air or on a roof; a mover that must land cannot end in the air */
{
  const T = base(); T.c.H1.movement = FLY;
  const fl = RM.moveProfile("flight", { tier: "basic" });
  const opts = MP.moveOptions(T.facts().zones, T.state, "H1", T.c.H1);
  ok(opts.some((o) => o.mode === "flight" && o.to === "z6:elevated" && o.elevated === "roof" && !o.disabled), "D: the options name the rooftop for a flyer");
  ok(opts.some((o) => o.mode === "walk" && o.to === "z2" && o.cost === "quick" && !o.disabled), "D: and the zones on foot with their cost");
  ok(opts.every((o) => /^[A-Za-z0-9_.:@|-]{1,64}$/.test(o.id)), "D: option ids are prompt-safe");
  ok(opts.some((o) => o.area === "sky"), "D: a flyer is offered sky high");
  eq((await T.req("p1", mv("H1", "z2:elevated", { mode: "flight" }))).ok, true, "D: a flight into the air above the next zone");
  eq([T.spot("H1"), T.map.zoneOfToken("H1").airborne], ["z2:elevated", true], "D: the flyer hovers there");
  const W = base();
  eq(why(await W.req("p1", mv("H1", "z2:elevated"))), RM.altitudeAccess(RM.moveProfile("walk"), "elevated").reason, "D: on foot nobody ends in the air");
  ok(fl.ends.includes("air"), "D: (a flyer may)");
  const L = base(); L.c.H1.movement = [{ mode: "leaping", tier: "basic" }];
  eq((await L.req("p1", mv("H1", "z2:elevated", { mode: "leaping" }))).ok, false, "D: a leaper must land [ZR-3]");
}
/* ---- E. fire on the way: the move stops, the fire attacks, the move goes on; all of it is one transaction */
{
  const def = CITY(); def.states.z2 = [{ id: "s1", kind: "fire", level: 2 }];
  const T = base(def); T.c.H1.movement = FLY; T.put("N1", "z4");
  T.dice.push([6, 6]);
  const fo = RH.fireOutcome({ sixes: 2, armor: 0, inBurningZone: true, wasBurning: false, immune: false });
  eq((await T.req("p1", mv("H1", "z3", { mode: "flight" }))).ok, true, "E: a flight through a burning zone");
  eq([T.spot("H1"), T.state.stack.length], ["z3", 0], "E: the mover arrives");
  eq(T.c.H1.health, 6 - fo.taken, "E: the fire attacked on entering [B2925]");
  eq(M.hasStatus(T.state, "H1", "burning"), !!fo.burning, "E: and set the mover on fire as the rules library says");
  eq(T.performed.filter((e) => e.t === "zmove").length, 2, "E: two stretches: up to the fire, then the rest");
  eq(T.log.list.length, 1, "E: ONE journal transaction");
  await T.gm({ op: "undo", tx: lastTx(T).id });
  eq([T.spot("H1"), T.c.H1.health, M.hasStatus(T.state, "H1", "burning"), entries(T, "H1").length], ["z1", 6, false, 0], "E: undo reverses position, wound, status and cost together");
  /* a mover broken by the fire stays where it burns */
  const B = base(def); B.c.H1.movement = FLY; B.c.H1.health = 1; B.put("N1", "z4"); B.dice.push([6, 6], [3]);
  await B.req("p1", mv("H1", "z3", { mode: "flight" }));
  for (let i = 0; i < 4 && B.state.stack.length; i++) { const p = B.prompts()[0]; if (p) await B.req("gm", { op: "answerFor", prompt: p.id, value: p.options[0].id }); }
  eq([B.spot("H1"), B.evs("move").pop()?.stopped], ["z2", "broken"], "E: broken by the fire, the move ends in the burning zone");
  /* arriving in a burning zone */
  const A = base(def); A.dice.push([1, 1]);
  await A.req("p1", mv("H1", "z2"));
  eq([A.spot("H1"), A.performed.filter((e) => e.t === "dice").length], ["z2", 1], "E: the fire attacks a mover that ends in the burning zone, once");
}
/* ---- F. leaving darkness: an AGILITY roll that costs nothing; the maker is exempt [B1654] */
{
  const def = CITY(); def.states.z1 = [{ id: "d1", kind: "dark", owner: "N1" }];
  const T = base(def);
  await T.req("p1", mv("H1", "z2"));
  const rq = T.lastRequest();
  eq([T.spot("H1"), rq.attr, rq.maxPush, T.top()?.step], ["z1", "agility", null, "travel"], "F: leaving the dark asks an AGILITY roll that may be pushed (ANSF: A11 + SWEEP-R7, the user 2026-11-12, active movement; was: not pushed)");
  await T.roll("dark:z1", 0);
  eq([T.spot("H1"), T.state.stack.length, T.evs("move").pop().stopped], ["z1", 0, "dark"], "F: failed: the mover stays in the dark, the action is spent");
  eq(entries(T, "H1").length, 1, "F: (the cost stays paid [OQ-20])");
  const S = base(def); await S.req("p1", mv("H1", "z2")); await S.roll("dark:z1", 2);
  eq(S.spot("H1"), "z2", "F: one six finds the way out");
  const def2 = CITY(); def2.states.z1 = [{ id: "d1", kind: "dark", owner: "H1" }];
  const O = base(def2); await O.req("p1", mv("H1", "z2"));
  eq([O.spot("H1"), O.requests.length], ["z2", 0], "F: the maker of the darkness is not held by it");
}
/* ---- G. barriers: crash through as part of the move [B2419]; break a locked door, open one [B2418] */
{
  const T = base(); T.put("H1", "z3");
  const b = MP.barrierOf(T.facts().zones.border("z3|z4"));
  eq([b.element, b.armor], ["door", 1], "G: the door is what a crash goes through where one stands");
  eq(why(await T.req("p1", mv("H1", "z4"))), "barrier", "G: a wall refuses a plain move");
  eq((await T.req("p1", mv("H1", "z4", { force: true }))).ok, true, "G: declared with force");
  eq([T.spot("H1"), T.lastRequest().attr], ["z3", "strength"], "G: the mover stands at the barrier and rolls STRENGTH");
  await T.roll("bar:z3|z4", 1);
  eq([T.spot("H1"), T.map.borderBetween("z3", "z4").doorway.state, T.state.stack.length], ["z4", "breached", 0], "G: success: the door is breached and the mover is through");
  ok(T.evs("zoneChange").some((e) => e.border === "z3|z4"), "G: the breach is announced");
  await T.gm({ op: "undo", tx: lastTx(T).id });
  eq([T.spot("H1"), T.map.borderBetween("z3", "z4").doorway.state], ["z3", "locked"], "G: undo restores the door and the mover");
  /* failure: stopped at the barrier, damage = its Armor */
  const F = base(); F.put("H1", "z3");
  await F.req("p1", mv("H1", "z4", { force: { "z3|z4": "wall" } })); await F.roll("bar:z3|z4", 0);
  const out = RZ.breachOutcome({ strength: 5, armor: 2, sixes: 0, crashing: true });
  eq([F.spot("H1"), F.c.H1.health, F.evs("move").pop().stopped, F.state.stack.length], ["z3", 6 - out.damage, "barrier", 0], "G: failure: stopped, hurt by the wall's Armor");
  /* too weak: STRENGTH against Armor decides before any roll */
  const W = base(); W.put("H2", "z3"); W.turn("H2"); W.map._.borders["z3|z4"].wall.armor = 9; W.map._.borders["z3|z4"].doorway.armor = 9;
  eq([why(await W.req("p2", mv("H2", "z4", { force: true }))), RZ.canBreach(2, 9)], ["tooWeak", false], "G: a barrier too strong for the mover is refused");
  /* the door as an action */
  const D = base(); D.put("H1", "z3");
  eq(why(await D.req("p1", mv("H1", "z1|z2", { action: "breachDoor" }))), "noDoor", "G: no door on an open border");
  eq(why(await D.req("p1", mv("H1", "z3|z4", { action: "openDoor" }))), "doorState", "G: a locked door does not simply open");
  eq((await D.req("p1", mv("H1", "z3|z4", { action: "breachDoor" }))).ok, true, "G: breaking the locked door is declared");
  eq(entries(D, "H1")[0].action, "breachDoor", "G: a quick action is paid");
  await D.roll("roll", 1);
  eq([D.map.borderBetween("z3", "z4").doorway.state, D.state.stack.length], ["breached", 0], "G: the door gives way");
  eq((await D.req("p1", mv("H1", "z4"))).ok, true, "G: and the way is open");
  const U = base(); U.put("H1", "z3"); U.map._.borders["z3|z4"].doorway.state = "sealed";
  await U.req("p1", mv("H1", "z3|z4", { action: "unseal" }));
  eq([U.lastRequest().attr, entries(U, "H1")[0].action], ["reason", "unseal"], "G: an electronic lock is a REASON roll for a full action");
  await U.roll("roll", 1);
  eq(U.map.borderBetween("z3", "z4").doorway.state, "open", "G: unlocked");
  const C = base(); C.put("H1", "z3"); C.map._.borders["z3|z4"].doorway.state = "closed"; C.map._.borders["z3|z4"].wall.state = "intact";
  eq((await C.req("p1", mv("H1", "z3|z4", { action: "openDoor" }))).ok, true, "G: an unlocked door opens without a roll");
  eq([C.map.borderBetween("z3", "z4").doorway.state, entries(C, "H1").length, C.requests.length], ["open", 0, 0], "G: and without an action");
}
/* ---- H. teleport: an arrival, nothing in between; quick action only [R18] */
{
  const def = CITY(); def.states.z2 = [{ id: "s1", kind: "fire", level: 3 }];
  const T = base(def); T.c.H1.movement = [{ mode: "teleportation", tier: "basic" }];
  const tp = RM.moveProfile("teleportation", { tier: "basic" }), d = Math.min(2, tp.zones);
  const to = d >= 2 ? "z3" : "z2";
  const r = await T.req("p1", mv("H1", "z3", { mode: "teleportation" }));
  if (tp.zones >= 2) {
    eq([r.ok, T.spot("H1"), T.performed.filter((e) => e.t === "zput").length, T.performed.filter((e) => e.t === "dice").length], [true, "z3", 1, 0], "H: a teleport arrives without passing the burning zone");
    eq(entries(T, "H1")[0].unit ?? entries(T, "H1")[0].cost ?? "quick", "quick", "H: for a quick action");
  } else eq(why(r), "tooFar", `H: beyond the reach of a basic teleport (${to})`);
}
/* ---- I. sky high and the return [B2387], [R16] */
{
  const T = base(); T.c.H1.movement = FLY;
  const W = base();
  eq([why(await W.req("p1", mv("H1", "@sky"))), RM.altitudeAccess(RM.moveProfile("walk"), "sky").reason], ["needsFlight", "needsFlight"], "I: on foot nobody goes sky high");
  eq((await T.req("p1", mv("H1", "@sky", { mode: "flight" }))).ok, true, "I: a flyer goes sky high");
  eq([T.spot("H1"), entries(T, "H1").map((e) => e.unit ?? null).length, P1.budget(T.state, "H1").full !== "open"], ["@sky", 1, true], "I: for a full action");
  await T.gm({ op: "nextTurn" }); T.turn("H1");
  if (T.state.round === 1) { /* the same round: the full action is gone */ eq(code(await T.req("p1", mv("H1", "z3", { mode: "flight" }))), "illegal", "I: no second full action this round"); }
  const R = base(); R.c.H1.movement = FLY; R.put("H1", "@sky");
  eq((await R.req("p1", mv("H1", "z4", { mode: "flight" }))).ok, true, "I: the return is declared");
  eq([R.prompt("moveApprove")?.to, R.spot("H1"), entries(R, "H1").length], ["gm", "@sky", 0], "I: the GM approves the zone of return first [R16]; nothing is paid yet");
  await R.answer("gm", "moveApprove", "approve");
  eq([R.spot("H1"), entries(R, "H1").length, R.state.stack.length], ["z4", 1, 0], "I: approved: the full action is paid and the flyer is back on the map");
  const X = base(); X.c.H1.movement = FLY; X.put("H1", "@sky");
  await X.req("p1", mv("H1", "z4", { mode: "flight" })); await X.answer("gm", "moveApprove", "refuse");
  eq([X.spot("H1"), entries(X, "H1").length, X.state.stack.length], ["@sky", 0, 0], "I: refused: nothing moved, nothing paid");
}
/* ---- J. carrying [B2392] and pulling a held opponent [B2497] */
{
  const T = base(); T.c.H1.movement = FLY;
  eq(why(await T.req("p1", mv("H1", "z2", { carry: ["H2"] }))), RMan.carryCheck({ canFly: false }).reason === "cannotFly" ? "cannotCarry" : "?", "J: on foot nobody is carried");
  eq(why(await T.req("p1", mv("H1", "z2", { mode: "flight", carry: ["N1"] }))), "carryZone", "J: the carried character starts in the flyer's zone");
  eq((await T.req("p1", mv("H1", "z2:elevated", { mode: "flight", carry: ["H2"] }))).ok, true, "J: a flyer carries one character");
  eq([T.spot("H1"), T.spot("H2"), M.conditions(T.state, "H2").carriedAloft === true], ["z2:elevated", "z2:elevated", true], "J: both end in the air together and are carried aloft");
  eq(T.map._.log.at(-1).movers, ["H1", "H2"], "J: the map moved them as one group");
  await T.gm({ op: "undo", tx: lastTx(T).id });
  eq([T.spot("H1"), T.spot("H2"), M.hasStatus(T.state, "H2", "carried")], ["z1", "z1", false], "J: undo brings both back");
  const G = base(); G.put("N1", "z1");
  await G.gm({ op: "statusAdd", combatant: "H1", status: { id: "grappling", data: { held: "N1" } } });
  await G.req("p1", mv("H1", "z2"));
  eq([G.spot("H1"), G.spot("N1")], ["z2", "z2"], "J: the holder of a grapple pulls the held opponent along");
}
/* ---- K. forced movement as a service: the GM's card, the chain from the map, barriers, the fall */
{
  const T = base(); T.put("N1", "z3"); T.put("H1", "z2");
  eq((await T.gm({ op: "forcedMove", combatant: "N1", awayFrom: "H1", distance: 2, damage: 4, kind: "knockback" })).ok, true, "K: a forced move is opened");
  const card = T.prompt("direction");
  eq([card.to, card.data.zones, card.data.walls.map((w) => w.border), T.spot("N1")], ["gm", ["z3", "z4"], ["z3|z4"], "z3"], "K: the GM's card shows the chain and the wall on it; nothing moved yet");
  await T.answer("gm", "direction", "go");
  eq([T.spot("N1"), T.map.borderBetween("z3", "z4").wall.state, T.c.N1.health, T.state.stack.length], ["z4", "breached", 1, 0], "K: thrown through a wall weaker than the blow: the wall breaks, the blow is felt, the target lands beyond");
  await T.gm({ op: "undo", tx: lastTx(T).id });
  eq([T.spot("N1"), T.map.borderBetween("z3", "z4").wall.state, T.c.N1.health], ["z3", "intact", 5], "K: undo restores wall, wound and position");
  const S = base(); S.put("N1", "z3"); S.put("H1", "z2");
  await S.gm({ op: "forcedMove", combatant: "N1", awayFrom: "H1", distance: 2, damage: 2 }); await S.answer("gm", "direction", "go");
  eq([S.spot("N1"), S.map.borderBetween("z3", "z4").wall.state, S.c.N1.health], ["z3", "intact", 3], "K: a wall as strong as the blow stops the target, which takes the blow");
  const N = base(); N.put("N1", "z3"); N.put("H1", "z2");
  await N.gm({ op: "forcedMove", combatant: "N1", awayFrom: "H1", distance: 1, damage: 0 }); await N.answer("gm", "direction", "none");
  eq([N.spot("N1"), N.state.stack.length], ["z3", 0], "K: the GM may leave the target where it is");
  const P = base(); P.put("H2", "z2");
  eq((await P.req("p1", { op: "forcedMove", combatant: "H2", awayFrom: "H1", distance: 1 })).error.code, "noPermission", "K: only the GM throws characters around");
  /* the fall */
  const F = base(); F.put("N1", "z2:elevated"); F.dice.push([5]);
  await F.gm({ op: "fall", combatant: "N1" });
  eq([F.lastRequest().attr, F.lastRequest().maxPush], ["agility", 0], "K: a fall asks AGILITY, no action, no push [B2391]");
  await F.roll("agi", 1);
  const fo = RH.fallOutcome({ dice: [5], agilitySixes: 1 });
  eq([F.spot("N1"), F.c.N1.health, F.state.stack.length], ["z2", 5 - fo.damage, 0], "K: lands on the ground with the damage the rules library gives");
  eq(RH.fallDice("ground"), 0, "K: nobody falls from the ground");
  const G = base(); await G.gm({ op: "fall", combatant: "N1" });
  eq([G.state.stack.length, G.c.N1.health], [0, 5], "K: a fall from the ground is nothing");
  const C = base(); C.put("N1", "z1:elevated"); C.put("H1", "z1"); C.put("H2", "z5");
  await C.gm({ op: "forcedMove", combatant: "N1", direction: { dx: 1, dy: 0 }, distance: 1 });
  C.dice.push([2]); await C.answer("gm", "direction", "goFall"); await C.roll("agi", 0);
  eq([C.spot("N1"), C.c.N1.health, C.log.list.length], [C.spot("N1").split(":")[0], 3, 1], "K: thrown in the air and falling afterwards [A7]: one transaction");
}
/* ---- L. Fastball Special [B2390] */
{
  const T = base();
  const fc = RMan.fastballCheck({ throwerStrength: 5, thrownStrength: 2 });
  eq((await T.req("p1", { op: "declare", actor: "H1", decl: { action: "fastball", targets: ["H2"], to: "z3" } })).ok, true, "L: the stronger hero throws the weaker one");
  eq([T.spot("H2"), T.spot("H1"), entries(T, "H1")[0].action, entries(T, "H2").length, fc.zones >= 2], ["z3", "z1", "fastball", 0, true], "L: the thrown one travels, the thrower pays the full action");
  const W = base(); W.turn("H2");
  eq(why(await W.req("p2", { op: "declare", actor: "H2", decl: { action: "fastball", targets: ["H1"], to: "z2" } })), "tooWeak", "L: the thrown character must be weaker");
  const R = base();
  eq(why(await R.gm({ op: "declare", actor: "H1", decl: { action: "fastball", targets: ["N1"], to: "z3" } })), "carryZone", "L: from the thrower's own zone only");
  /* ANSH (P8f-1, the user 2026-11-12: «Zezwolić, MG rozstrzyga bez liczb»): not refused; it waits on the GM's card, which names the rule */
  { const e = await R.req("p1", { op: "declare", actor: "H1", decl: { action: "fastball", targets: ["N1"], to: "z3" } }); const p = R.prompts("exception")[0];
    eq([why(e), p?.data?.reason, p?.data?.reasons], [null, "strangerAlly", ["carryZone"]], "L + P8f-1: a player's hero throws no NPC whose numbers are not revealed without the GM (D54: the player is not told why; the GM's card says)"); }
}
/* ---- M. the dodge move [B2526]: zones offered on the prompt, the move is part of the attack's transaction */
{
  const T = base(); T.put("N1", "z1"); T.weapons.pistol = { id: "pistol", name: "Pistol", bonus: 1, damage: 2, range: [0, 2], sharp: false };
  await T.req("p1", { op: "declare", actor: "H1", decl: { action: "shoot", weapon: "pistol", targets: ["N1"] } });
  await T.answer("gm", "reaction", "dodge", "N1"); await T.roll("attack", 1); await T.roll("def:N1", 3);
  const p = T.prompt("dodgeMove"), o = p.options.find((x) => x.data?.to === "z2");
  ok(!!o && p.options.some((x) => x.id === "pass") && p.options.some((x) => x.id === "move"), "M: the dodge move offers the zones within reach, by hand, or pass");
  await T.answer("gm", "dodgeMove", o.id);
  eq([T.spot("N1"), T.state.stack.length, entries(T, "N1").filter((e) => e.action === "move").length, T.log.list.length], ["z2", 0, 0, 1], "M: the dodger moved, free of cost, inside the attack's transaction");
}
/* ---- N. the step listener leaves other moves alone; stale and blocked stretches */
{
  const T = base();
  const r = await T.map.move({ id: "H1" }, "z2", { profile: { way: "walk", speed: 1 } });
  eq([r.ok, r.stopped, T.spot("H1")], [true, null, "z2"], "N: a move that is not the engine's passes the listener untouched");
  eq(MP.stepVerdict({ data: {} }), null, "N: no verdict without the engine's mark");
  eq(MP.stepVerdict({ data: { ipu: { mover: "H1", cleared: {}, forced: 1 } }, from: { spot: "z3" }, statesFrom: [], statesTo: [], border: { key: "z3|z4", stops: { walk: true } }, profile: { way: "walk" } }).reason, "ipu.hit", "N: a thrown character meets the barrier");
  eq(MP.stateFlags([{ kind: "fire", level: 3 }, { kind: "weather", data: { type: "storm" }, owner: "H1" }, { kind: "gravity", data: { mode: "low" } }], "H1"), { fire: 3, dark: false, storm: false, highGravity: false, lowGravity: true }, "N: zone states as the rules read them (the maker of a storm is exempt)");
}
/* ---- O. conditions at the start: low gravity AGILITY [B1703]; a zone state met on the way is the GM's card [LR-18] */
{
  const def = CITY(); def.states.z1 = [{ id: "g1", kind: "gravity", data: { mode: "low" } }];
  const T = base(def); await T.req("p1", mv("H1", "z2"));
  eq([T.lastRequest()?.attr, T.spot("H1")], ["agility", "z1"], "O: low gravity asks AGILITY before the move");
  await T.roll("start", 0);
  eq([T.spot("H1"), T.evs("move").pop().stopped], ["z1", "rollFailed"], "O: failed: no move");
  const def2 = CITY(); def2.states.z2 = [{ id: "w1", kind: "weather", data: { type: "storm" } }];
  const S = base(def2); S.c.H1.movement = FLY; S.put("N1", "z4");
  await S.req("p1", mv("H1", "z3", { mode: "flight" }));
  eq([S.prompt("moveStop")?.data.why, S.spot("H1")], [["storm"], "z2"], "O: entering a storm on the way stops the move for the GM's word");
  await S.answer("gm", "moveStop", "continue");
  eq(S.spot("H1"), "z3", "O: continue");
  const X = base(def2); X.c.H1.movement = FLY; X.put("N1", "z4");
  await X.req("p1", mv("H1", "z3", { mode: "flight" })); await X.answer("gm", "moveStop", "stop");
  eq([X.spot("H1"), X.evs("move").pop().stopped], ["z2", "storm"], "O: or stop there");
}
/* ---- P. the Foundry side: listener, rules driver, drag confirmation, pick, communication */
{
  const T = base(); const sent = [];
  const h = { cid: (td) => (T.c[td?.id] ? td.id : null), c: (cid) => T.c[cid] ?? null, state: () => T.state, facts: () => T.facts(), request: async (req) => { sent.push(req); return T.req("p1", req); } };
  eq(Mv.install(h), true, "P: installed on a scene with zones");
  eq([T.map.drivenBy()?.id, T.map.drivenBy()?.fireRound, T.map._.driver.wreck("office")], ["invincible-plus-ultra", true, ""], "P: the map's rules driver is this module: no fire round, no wrecking numbers of the map's own");
  const cfg = T.map._.cfg.tactical;
  eq([cfg.gm, cfg.when({ id: "H1" }), cfg.when({ id: "nobody" }), typeof cfg.profile({ id: "H1" }).speed], [true, true, false, "number"], "P: cost confirmation on drags of combat tokens, the GM's too");
  const res = cfg.confirm({ token: { id: "H1" }, to: T.map.place("z2") });
  eq(res, false, "P: the drag itself never moves the token");
  await new Promise((r) => setTimeout(r, 5));
  eq([sent[0]?.op, sent[0]?.actor, sent[0]?.to, T.spot("H1"), dialogs.length], ["move", "H1", "z2", "z2", 1], "P: confirmed: the move goes to the executor as a request and the engine moves the token");
  T.map._.nextPick = "z3";
  await Mv.pickMove(h, "H1");
  ok(T.map._.picks[0].zones.some((z) => z.zone === "z3" || z.zone === "z1"), "P: the pick offers the reachable zones");
  eq(Mv.api.installed(), true, "P: api.tactics.movement is live");
  ok(Array.isArray(Mv.api.options("H1")), "P: options through the API");
  const Zf = T.facts().zones;
  eq([Mv.talk(Zf, "H1", "H2").ok, Mv.talk(Zf, "H1", "N1")?.ok], [T.spot("H1") === T.spot("H2") || RZ.canCommunicateAt(Zf.range("H1", "H2"), Zf.place("H1"), Zf.place("H2"), {}).ok, RZ.canCommunicateAt(Zf.range("H1", "N1"), Zf.place("H1"), Zf.place("N1"), {}).ok], "P: communication range is the rules library's answer [Z11]");
  T.put("H2", "z4"); T.put("H1", "z3");
  eq([Mv.talk(Zf, "H1", "H2").ok, Mv.talk(Zf, "H1", "H2").reason, Mv.talk(Zf, "H1", "H2", true).ok], [false, "wall", true], "P: a wall between neighbours impedes talk; a link does not care");
  Mv.uninstall();
  eq([T.map.drivenBy(), T.map.tacticalOn()], [null, false], "P: uninstall steps down");
}
/* ---- Q. the surfaces over movement (ui/model-pure.mjs on the real options): the dock's move and door panels send only what they
        carry, a refused way names its reason and the way to ask, the desk's cards of a move read as sentences, nothing shows a raw key */
{
  const UI = await import("./ui/model-pure.mjs"), D = await import("./desk-pure.mjs"), V = await import("./view-pure.mjs"), { t } = await import("./lang.mjs");
  const lang = (l) => { globalThis.game.i18n = { lang: l }; };
  const setup = (place = {}) => {
    const T = base(); T.c.H1.movement = FLY;
    for (const [cid, spot] of Object.entries(place)) T.put(cid, spot);
    const h = { cid: (td) => (T.c[td?.id] ? td.id : null), c: (cid) => T.c[cid] ?? null, state: () => T.state, facts: () => T.facts(), request: async (req) => T.req("p1", req) };
    Mv.uninstall(); Mv.install(h);
    const ctx = { c: (id) => T.c[id] ?? null, online: () => true, P1 }, meta = { hidden: [], npc: ["N1"] };
    const facts = (uid, staff, view) => ({ view, me: uid, staff, c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc, img: null } : null), attrs: (id) => T.c[id]?.attrs ?? null, userName: (u) => u,
      move: (id) => ({ options: Mv.api.options(id), why: Mv.api.why(id) }), doors: (id) => Mv.api.doors(id),
      zone: (spot) => { const p = T.map.place(spot); return p ? { id: p.id, level: p.level, floor: p.floor, area: p.area, roof: p.roof } : null; } });
    const dock = (uid, cid, own = {}) => { const view = V.viewFor(T.state, { id: uid, staff: false, owns: [cid] }, meta); return UI.dockData(D.playerModel(view, { id: uid, owns: [cid] }, ctx), own, facts(uid, false, view), t); };
    const staffDock = (cid, own = {}) => { const d = D.deskModel(T.state, T.log, ctx); return UI.dockData({ bars: [D.barModel(T.state, cid, ctx)], prompts: [], mine: [], stack: d.info, waiting: d.waiting, turn: d.turn }, own, facts("gm", true, T.state), t); };
    const desk = (own = {}) => UI.deskData(D.deskModel(T.state, T.log, ctx), own, facts("gm", true, T.state), t);
    return { T, dock, staffDock, desk };
  };
  const texts = (v) => { const out = []; JSON.stringify(v, (k, x) => { if (typeof x === "string" && !x.includes("|z") && !["id", "zone", "to", "border", "action", "color", "style", "kind", "cost", "op", "actor", "mode", "combatant", "awayFrom", "by"].includes(k)) out.push(x); return typeof x === "function" ? undefined : x; }); return out.join(" | "); };
  const shown = (v, where) => { const s = texts(v); ok(!/ITAC\.|\bz\d\b/.test(s), `${where}: no raw key and no raw zone key is shown (${s.match(/ITAC\.[\w.]+|\bz\d\b/)?.[0] ?? ""})`); return s; };
  for (const l of ["en", "pl"]) {
    lang(l);
    { // a move from the dock: the map is offered the zones, the panel lists the ways to the chosen one, the row's request moves the token
      const { T, dock } = setup();
      let d = dock("p1", "H1", { armed: "move" });
      eq([d.panel.kind, d.panel.picking, !!d.panel.hint, d.panel.dest], ["move", true, true, null], `Q ${l}: Move armed: the panel asks for a zone on the map`);
      const z2 = d.panel.zones.find((z) => z.zone === "z2");
      eq([z2?.color, !!z2?.label, !!z2?.tip, d.panel.zones.every((z) => typeof z.zone === "string" && z.color)], ["move", true, true, true], `Q ${l}: the neighbouring zone is offered in the plain colour with its price`);
      ok(new Set(d.panel.zones.map((z) => z.zone)).size === d.panel.zones.length, `Q ${l}: one entry per zone, whatever the ways into it`);
      shown(d, `Q ${l} move, picking`);
      d = dock("p1", "H1", { armed: "move", to: "z2" });
      const walk = d.panel.dest.rows.find((r) => r.id === "walk|z2"), fly = d.panel.dest.rows.filter((r) => r.id.startsWith("flight|"));
      eq([d.panel.picking, d.panel.dest.zone, d.panel.dest.label, walk.disabled, walk.say.length > 0, fly.length], [false, "z2", t("ITAC.ui.zone", { n: 2 }), null, true, 2], `Q ${l}: the chosen zone lists every way into it with its cost (on foot, flying low, staying in the air)`);
      eq(walk.req, { op: "declare", actor: "H1", decl: { action: "move", to: "z2", mode: "walk" } }, `Q ${l}: the row carries the declaration of that move`);
      shown(d, `Q ${l} move, chosen`);
      eq([(await T.req("p1", walk.req)).ok, T.spot("H1")], [true, "z2"], `Q ${l}: the row's request moves the token through the engine`);
      eq([d.panel.near.length, dock("p1", "H1", { armed: "move" }).panel.near.some((r) => r.id.startsWith("flight|@sky"))], [0, true], `Q ${l}: off-map places a flyer can go to are listed in the panel, not on the map, and give way once a zone is chosen`);
    }
    { // a way the rules refuse: shown with the reason; the player asks with a reason, which becomes a card of the GM
      const { T, dock, desk } = setup({ H1: "z5" });
      T.c.H1.movement = []; T.c.H1.attrs.strength = 0;
      let d = dock("p1", "H1", { armed: "move", to: "z6" });
      const z6 = dock("p1", "H1", { armed: "move" }).panel.zones.find((z) => z.zone === "z6"), row = d.panel.dest?.rows[0];
      eq([z6?.color, z6?.style, !!row?.disabled, row?.req ?? null, d.panel.ask], ["blocked", "dashed", true, null, null], `Q ${l}: a zone behind a wall too strong is shown as blocked, its row says why and sends nothing`);
      d = dock("p1", "H1", { armed: "move", to: "z6", ask: row.id });
      eq([!!d.panel.ask.reason, d.panel.ask.submit.req, !!d.panel.ask.submit.disabled], [true, null, true], `Q ${l}: asking the GM needs a reason first`);
      d = dock("p1", "H1", { armed: "move", to: "z6", ask: row.id, why: "I know a way through" });
      const req = d.panel.ask.submit.req;
      eq([req.op, req.decl.action, req.decl.to, req.decl.exception.text], ["declare", "move", "z6", "I know a way through"], `Q ${l}: the question is the same move with a request for an exception`);
      shown(d, `Q ${l} move, asking`);
      eq([(await T.req("p1", req)).ok, desk().cards[0]?.kind, T.spot("H1")], [true, "exception", "z5"], `Q ${l}: it becomes a card on the GM desk and nothing moves`);
    }
    { // not the mover's turn: the player gets the reason and the free request; the GM's dock moves the character anyway at no cost
      const { T, dock, staffDock } = setup();
      const p = dock("p2", "H2", { armed: "move", peek: true }).panel;
      eq([p.kind, !!p.reason], ["blocked", true], `Q ${l}: off turn a player's Move is refused with the reason and the way to ask`);
      let d = staffDock("H2", { armed: "move", to: "z2" });
      const row = d.panel.dest.rows[0];
      eq([d.panel.kind, !!row.disabled, row.req], ["move", true, null], `Q ${l}: the GM's dock still shows the ways, refused by the action economy`);
      d = staffDock("H2", { armed: "move", to: "z2", ask: row.id });
      eq([d.panel.ask.text, d.panel.ask.submit.req.gm, d.panel.ask.submit.req.decl.to], [null, true, "z2"], `Q ${l}: the GM declares it anyway, costs waived, without writing a reason`);
      eq([(await T.gm(d.panel.ask.submit.req)).ok, T.spot("H2"), entries(T, "H2").filter((e) => e.cost === "quick" || e.cost === "full").length], [true, "z2", 0], `Q ${l}: the token moves and no action of the character is spent`);
    }
    { // doors
      const { T, dock } = setup({ H1: "z3" });
      let d = dock("p1", "H1", { armed: "breachDoor" });
      const row = d.panel.rows[0];
      eq([d.panel.kind, row.id, row.disabled, row.notes.length + row.marks.length, d.panel.borders[0].border], ["door", "z3|z4", null, 2, "z3|z4"], `Q ${l}: the locked door of the mover's zone is offered for breaking, with its state and Armor, and marked on the map`);
      eq(row.req, { op: "declare", actor: "H1", decl: { action: "breachDoor", to: "z3|z4" } }, `Q ${l}: the door row carries the declaration`);
      shown(d, `Q ${l} door`);
      eq(d.groups.find((g) => g.id === "move").items.map((a) => a.id).filter((id) => /Door|unseal/.test(id)), ["breachDoor"], `Q ${l}: at a locked door only breaking it is a button of the bar`);
      const o = dock("p1", "H1", { armed: "openDoor", ask: "z3|z4", why: "the guard has the key" }).panel;
      eq([!!o.rows[0].disabled, o.rows[0].req, o.ask.submit.req.decl.exception.text, o.ask.submit.req.decl.to], [true, null, "the guard has the key", "z3|z4"], `Q ${l}: opening a locked door is refused with its state; the question to the GM carries the door`);
      eq(dock("p1", "H1", { armed: "openDoor" }).panel.rows.length > 0 && dock("p1", "H1", { armed: "unseal" }).panel.rows[0].req, null, `Q ${l}: a lock that is not electronic cannot be worked`);
      T.put("H1", "z1");
      ok(!dock("p1", "H1").groups.flatMap((g) => g.items).some((a) => /Door|unseal/.test(a.id)), `Q ${l}: away from every door the bar has no door button`);
      eq([dock("p1", "H1", { armed: "openDoor" }).panel.rows.length, !!dock("p1", "H1", { armed: "openDoor" }).panel.empty], [0, true], `Q ${l}: a zone without a door says so`);
      T.put("H1", "z3");
      eq([(await T.req("p1", row.req)).ok, T.state.stack.length > 0 || T.map.borderBetween("z3", "z4").doorway.state !== "locked"], [true, true], `Q ${l}: the door action runs through the engine`);
    }
    { // the GM's side: ordering a forced move by hand, the card that shows where the character flies
      const { T, desk } = setup();
      let k = desk({ tab: "table", force: { who: "N1", from: "H1", distance: 2, damage: 1 } });
      eq([desk({ tab: "table" }).force.push.req, !!desk({ tab: "table" }).force.push.disabled, k.force.push.req], [null, true, { op: "forcedMove", combatant: "N1", awayFrom: "H1", by: "H1", distance: 2, damage: 1, kind: "knockback" }], `Q ${l}: the desk orders a forced move once it knows who and away from whom`);
      eq((await T.gm(k.force.push.req)).ok, true, `Q ${l}: the order is accepted`);
      k = desk();
      const card = k.cards[0];
      eq([card.kind, card.title, card.map?.zones.length > 1, card.options.map((o) => o.id)], ["direction", t("ITAC.ui.card.forced"), true, ["@zone", "go", "goFall", "none"]], `Q ${l}: the card of a forced move names itself, carries the chain for the map and the three answers (FXV CI4: and the GM's correction, a zone picked on the map)`);
      ok(card.lines.some((x) => typeof x === "string" && x.includes(t("ITAC.ui.zone", { n: 3 }))), `Q ${l}: the chain is read out in zone numbers`);
      shown(k, `Q ${l} desk, forced move`);
      eq([(await T.gm(card.options.find((o) => o.id === "go").req)).ok, T.spot("N1") !== "z2"], [true, true], `Q ${l}: the answer of the card moves the character`);
      eq(desk({ force: { who: "N1" } }).force.fall.req, { op: "fall", combatant: "N1" }, `Q ${l}: a fall is ordered for one character`);
    }
    { // the move a dodge earns: the places fold into one pick on the map; several ways into one zone become buttons
      const { T } = setup();
      const f = { view: T.state, me: "p1", staff: false, c: (id) => (T.c[id] ? { name: T.c[id].name, npc: false } : null), zone: (s) => ({ id: Number(String(s).slice(1, 2)), level: String(s).includes(":") ? "elevated" : "ground", roof: false }) };
      const p = { id: "q1", kind: "dodgeMove", about: "H1", aboutName: "Hero", data: { zones: 1 }, answerReq: (value) => ({ value }), options: [
        { id: "walk|z2", label: "ITAC.opt.moveTo", data: { to: "z2", zone: "z2", mode: "walk" }, req: { n: 1 } }, { id: "flight|z2:elevated", label: "ITAC.opt.moveTo", data: { to: "z2:elevated", zone: "z2", mode: "flight", elevated: "air" }, req: { n: 2 } },
        { id: "flight|z5", label: "ITAC.opt.moveTo", data: { to: "z5", zone: "z5", mode: "flight" }, req: { n: 3 } }, { id: "move", label: "ITAC.opt.dodgeMove", req: { n: 4 } }, { id: "pass", label: "ITAC.opt.pass", req: { n: 5 } }] };
      let a = UI.askData(p, { t, facts: f, own: {} });
      eq([a.options.map((o) => o.id), a.options[0].zones.map((z) => z.zone), a.options[0].zoneReq("z5"), a.options[0].zoneReq("z2"), a.options[1].label], [["@zone", "move", "pass"], ["z2", "z5"], { n: 3 }, null, t("ITAC.ui.move.byHand")],
        `Q ${l}: one button picks on the map; a zone with one way answers at once, a zone with two waits for the way`);
      a = UI.askData(p, { t, facts: f, own: { zone: { q1: "z2" } } });
      eq([a.options.map((o) => o.id), a.options[0].req, a.options[1].req, a.options[2].again], [["walk|z2", "flight|z2:elevated", "@again", "move", "pass"], { n: 1 }, { n: 2 }, true], `Q ${l}: the ways into the picked zone are the answers; "another zone" forgets the pick`);
      shown(a, `Q ${l} dodge move`);
    }
  }
  lang("en");
  Mv.uninstall();
}
/* ---- an undo whose map inverse is refused: the rest is undone and the answer names what stayed */
{
  const T = base();
  await T.req("p1", mv("H1", "z2"));
  const apply0 = T.map.apply; T.map.apply = async () => ({ ok: false, reason: "noToken" });
  const r = await T.gm({ op: "undo", tx: lastTx(T).id });
  T.map.apply = apply0;
  eq([code(r), r.undone?.length, r.failed, T.spot("H1"), entries(T, "H1").length, lastTx(T).state], ["ok", 1, [{ tx: lastTx(T).id, t: "zones", reason: "noToken" }], "z2", 0, "undone"], "undo: the map refused to put the token back: the action is given back all the same and the answer says which write stayed");
  eq(T.events.filter((e) => e.type === "undo").at(-1)?.failed, [{ t: "zones", reason: "noToken" }], "undo: the event carries it for the GM's desk");
  const U = base(); await U.req("p1", mv("H1", "z2"));
  const u = await U.gm({ op: "undo", tx: lastTx(U).id });
  eq([code(u), "failed" in u, U.spot("H1"), "failed" in U.events.filter((e) => e.type === "undo").at(-1)], ["ok", false, "z1", false], "undo: nothing is named when everything went back");
}
/* ---- R. [D21] a level change made with the map's token HUD is movement with a price [B2386-2388]: held, confirmed, sent as a `move` */
{
  const T = base(); T.c.H1.movement = FLY; const sent = [], tick = () => new Promise((r) => setTimeout(r, 5));
  const h = { cid: (td) => (T.c[td?.id] ? td.id : null), c: (cid) => T.c[cid] ?? null, state: () => T.state, facts: () => T.facts(), request: async (req) => { sent.push(req); return T.req("p1", req); } };
  Mv.install(h);
  eq(T.map._.cfg.tactical.levels, true, "R: the map is told to hold level changes too");
  const d0 = dialogs.length;
  let r = await T.map.setAltitude({ id: "H1" }, "elevated"); await tick();
  eq([r, sent.length, sent[0]?.op, sent[0]?.actor, sent[0]?.to, sent[0]?.mode, dialogs.length - d0], [false, 1, "move", "H1", "z1:elevated", "flight", 1], "R: the HUD's altitude button writes nothing itself: the price is confirmed and a `move` request goes to the executor");
  eq([T.spot("H1"), entries(T, "H1").map((e) => e.action ?? e.tags?.[0] ?? null).length, P1.budget(T.state, "H1").quick.filter((q) => q === "used").length], ["z1:elevated", 1, 1], "R: the engine changes the level and the ledger is paid one quick action [B2386]");
  const w0 = warnings.length;
  r = await T.map.setAltitude({ id: "H2" }, "elevated"); await tick();
  eq([r, sent.length, T.spot("H2"), warnings.length > w0], [false, 1, "z1", true], "R: somebody on foot does not rise into the air by the button: no request, the token stays, the reason is said");
  r = await T.map.setAltitude({ id: "H1" }, "z1:f2"); await tick();
  eq([r, sent[1]?.op, sent[1]?.to], [false, "move", "z1:f2"], "R: a level the Move panel does not list (a floor) is priced for that very place and sent the same way");
  T.put("H1", "z1");
  let seen = null; Mv.setDragSurface((cid, to) => { seen = [cid, to]; return true; });
  const n = sent.length, d1 = dialogs.length;
  r = await T.map.setAltitude({ id: "H1" }, "elevated"); await tick();
  eq([r, seen, sent.length - n, dialogs.length - d1, T.spot("H1")], [false, ["H1", "z1:elevated"], 0, 0, "z1"], "R: with the dock running the price is shown there (one place for it), and the token waits");
  Mv.setDragSurface(null);
  T.map._.tokens.X = { id: "X", zone: "z1", level: "ground", floor: null, airborne: false, area: null };
  eq([await T.map.setAltitude({ id: "X" }, "elevated"), T.map.zoneOfToken("X").spot], [true, "z1:elevated"], "R: a token outside the fight changes level freely");
  eq(MP.optionsTo(T.facts().zones, T.state, "H1", T.c.H1, "nowhere"), [], "R: no such place, no option");
  Mv.uninstall();
}
/* ---- S. [D26] "this level" asked with a ground spot: the ground spot is the bare zone key, which the map reads as every level */
{
  const def = CITY(); def.states = { z1: [{ id: "s1", kind: "gravity", data: { mode: "low" }, at: "elevated" }, { id: "s2", kind: "fire", level: 2, at: "f2" }, { id: "s3", kind: "weather", data: { type: "fog" } }] };
  const T = base(def); T.c.H2.movement = FLY; T.put("H2", "z1:elevated");
  const Z = T.facts().zones, ids = (l) => l.map((s) => s.id);
  eq([ZP.levelRef("z1"), ZP.levelRef("z1:elevated"), ZP.levelRef("z1:f2"), ZP.levelRef("@sky"), ZP.levelRef(null)], ["z1:ground", "z1:elevated", "z1:f2", "@sky", null], "S: a ground spot names the ground outright; every other reference passes unchanged");
  eq([ids(Zones.zoneStates("z1")), ids(Zones.zoneStates("z1:ground"))], [["s1", "s2", "s3"], ["s3"]], "S: (the map: a bare key is every level, \"z1:ground\" the ground alone)");
  eq([ids(Z.states("z1")), ids(Z.states("z1:elevated")), ids(Z.states("z1:f2")), ids(Z.statesAll("z1"))], [["s3"], ["s1", "s3"], ["s2", "s3"], ["s1", "s2", "s3"]], "S: the states of a spot are those of its level and those naming none; every level only when asked");
  eq([Z.at("z1"), Z.at("z1:elevated"), T.facts().inZoneKey("z1").sort(), T.facts().inZoneKey("z1:ground")], [["H1"], ["H2"], ["H1", "H2"], ["H1"]], "S: who is on a spot: that level; a zone key given to an area effect: every level, \"z1:ground\" the ground");
  eq([MP.priceMove(Z, T.state, "H1", T.c.H1, { to: "z2", mode: "walk" }).roll, MP.priceMove(Z, T.state, "H2", T.c.H2, { to: "z2:elevated", mode: "flight" }).roll], [null, "agility"], "S: low gravity stored on \"elevated\" asks its roll of the flyer up there, not of the walker below [B1703]");
  eq([Mv.levelStates({ id: "H1" }, { states: { lowgrav: true, fire: 2, wrecked: true } }), Mv.levelStates({ id: "H2" }, { states: { lowgrav: true, fire: 2 } })], [{ wrecked: true }, { lowgrav: true }], "S: a combatant's zone facts carry the states of its own level (wrecking stays the zone's)");
  eq(ZP.propsOfStates([{ kind: "fire", level: 3 }, { kind: "fire", level: 1 }, { kind: "dark" }, { kind: "gravity", data: { mode: "low" } }, { kind: "gravity", data: { mode: "high" } }, null]), { fire: 3, dark: true, lowgrav: true }, "S: state records read as zone properties the way the map reads them");
  /* a fire on the ground is fought on the ground: the hazard side still sees every level of the zone */
  ok(typeof Z.statesAll === "function" && ids(Z.statesAll("z1:elevated")).length === 3, "S: the fire round reads the whole zone, whichever spot names it");
}
done("check-move");
