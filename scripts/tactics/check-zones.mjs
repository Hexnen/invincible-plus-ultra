// node scripts/tactics/check-zones.mjs -- the zones side: the ops the engine builds (zones-pure.mjs), the adapter against a fake of the REAL
// zones API (moinen-maps dev/zones-api.md: one write path `apply(op)` that returns the inverse, places with spot strings, movement), and the journal.
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import * as ZP from "./zones-pure.mjs";
import * as Z from "./zones-adapter.mjs";
import * as J from "./journal-pure.mjs";

/* ---- pure: the ops */
for (const [p, want] of [[{ wrecked: true }, true], [{ fire: 12 }, true], [{ fire: 13 }, false], [{ fire: "hot" }, false], [{ lowgrav: null }, true], [{ smoke: true }, false], [{}, false], [null, false], [{ dark: 1 }, false]]) eq(ZP.validZonePatch(p), want, `zone patch ${JSON.stringify(p)}`);
eq(ZP.zoneOp("z3", { wrecked: true, fire: 4 }), { op: "zone", zone: "z3", patch: { wrecked: true, fire: 4 } }, "a zone's own marks are one `zone` op");
eq([ZP.zoneOp("z3", { smoke: true }), ZP.zoneOp("../x", { dark: true }), ZP.zoneOp(null, { dark: true })], [null, null, null], "an unknown state or a bad key gives no op: the engine never invents zone state");
eq(ZP.borderOp("z1|z2", { wall: { state: "breached" } }), { op: "border", border: "z1|z2", wall: { state: "breached" } }, "breach a wall");
eq(ZP.borderOp("z1|z2", { wall: { state: "removed", temp: true }, door: { state: "open" } }), { op: "border", border: "z1|z2", wall: { state: "removed", temp: true }, door: { state: "open" } }, "a wall removed for a while, its door opened");
eq(ZP.borderOp("z1|z2", { restore: true }), { op: "border", border: "z1|z2", restore: true }, "back as built");
eq([ZP.borderOp("z1|z2", { wall: { state: "gone" } }), ZP.borderOp("z1", { door: { state: "open" } }), ZP.borderOp("z1|z2", {})], [null, null, null], "unknown states, a bad border key, nothing to change");
eq(ZP.levelFlags({ level: "elevated", airborne: true }), { alt: "elevated", floor: null, air: true }, "elevated and airborne as the map's token flags");
eq(ZP.levelFlags({ level: "ground" }), { alt: null, floor: null, air: null }, "ground clears the flags");
eq(ZP.levelFlags({ level: "floor", floor: 2 }), { alt: null, floor: 2, air: null }, "a floor");
eq(ZP.levelFlags({ area: "sky" }), { alt: "sky", floor: null, air: null }, "an off-map area");
eq([ZP.levelFlags("z3:f2"), ZP.levelFlags("z3:elevated"), ZP.levelFlags("z3"), ZP.levelFlags("@orbit")], [{ alt: null, floor: 2, air: null }, { alt: "elevated", floor: null, air: null }, { alt: null, floor: null, air: null }, { alt: "orbit", floor: null, air: null }], "places as spot strings");
eq([ZP.levelFlags({ level: "floor", floor: 0 }), ZP.levelFlags({ level: "attic" }), ZP.levelFlags({ area: "hell" }), ZP.levelFlags("@hell"), ZP.levelFlags(7)], [null, null, null, null, null], "unknown levels are refused");
eq(ZP.levelOp("tok1", { level: "elevated" }), { op: "tokens", rows: [{ id: "tok1", alt: "elevated", floor: null, air: null }] }, "a level change is a `tokens` op without x / y: the position on the map is untouched");
eq(ZP.tokenIdOf("Scene.s.Token.t9"), "t9", "token id of a uuid");
eq([ZP.validOp({ op: "batch", ops: [{ op: "zone", zone: "z1", patch: {} }, { op: "edge.add", edge: {} }] }), ZP.validOp({ op: "teleport" }), ZP.validOp({ op: "tokens", rows: [{ x: 1 }] }), ZP.validOp(null)], [true, false, false, false], "shape check of an op");
eq(ZP.changeOf({ op: "zone", zone: "z1", patch: { fire: 3 } }), { zone: "z1", change: { fire: 3 } }, "the zoneChange event of an op");
eq([ZP.isPlaceKey("z3:f2"), ZP.isPlaceKey("@sky"), ZP.isPlaceKey("z3 x"), ZP.isBorderKey("z1|z2"), ZP.isBorderKey("z1")], [true, true, false, true, false], "place and border keys");

/* ---- a fake of the real zones API */
function fakeZones() {
  const marks = { z1: { fire: 2 }, z2: {} }, borders = { "z1|z2": { wall: { state: "intact" }, door: null } };
  const tokens = { t1: { id: "t1", uuid: "Scene.s.Token.t1", x: 10, y: 10, zone: "z1", alt: null, floor: null, air: null }, t2: { id: "t2", uuid: "Scene.s.Token.t2", x: 300, y: 10, zone: "z2", alt: null, floor: null, air: null } };
  const spot = (t) => (["sky", "orbit", "dimension", "chase"].includes(t.alt) ? `@${t.alt}` : t.floor ? `${t.zone}:f${t.floor}` : t.alt ? `${t.zone}:${t.alt}` : t.zone);
  const placeOfTok = (t) => ({ zone: t.zone, id: 1, spot: spot(t), area: null, level: t.floor ? "floor" : t.alt ?? "ground", floor: t.floor ?? 0, airborne: t.air === true, roof: false, below: null });
  const log = [], listeners = [];
  let writer = true, v = 1;
  const one = (op) => {
    if (op.op === "zone") {
      if (!(op.zone in marks)) return { ok: false, reason: "badOp" };
      const before = {}; for (const k of Object.keys(op.patch)) before[k] = marks[op.zone][k] ?? null;
      for (const [k, x] of Object.entries(op.patch)) { if (x === null) delete marks[op.zone][k]; else marks[op.zone][k] = x; }
      return { ok: true, changed: true, inverse: { op: "zone", zone: op.zone, patch: before }, result: { key: op.zone, states: { ...marks[op.zone] } } };
    }
    if (op.op === "border") {
      const b = borders[op.border]; if (!b) return { ok: false, reason: "badOp" };
      const play = JSON.parse(JSON.stringify(b));
      if (op.play) Object.assign(b, JSON.parse(JSON.stringify(op.play))); else { if (op.wall) b.wall = { ...b.wall, ...op.wall }; if (op.door) b.door = { ...(b.door ?? {}), ...op.door }; }
      return { ok: true, changed: true, inverse: { op: "border", border: op.border, play }, result: b };
    }
    if (op.op === "tokens") {
      const back = [];
      for (const r of op.rows) { const t = tokens[r.id]; if (!t) return { ok: false, reason: "badOp" }; back.push({ id: t.id, x: t.x, y: t.y, alt: t.alt, floor: t.floor, air: t.air }); }
      for (const r of op.rows) { const t = tokens[r.id]; for (const k of ["x", "y", "alt", "floor", "air"]) if (k in r) t[k] = r[k]; }
      return { ok: true, changed: true, inverse: { op: "tokens", rows: back }, result: op.rows.map((r) => placeOfTok(tokens[r.id])) };
    }
    return { ok: false, reason: "badOp" };
  };
  const api = {
    canWrite: () => writer, version: () => v, EVENT_HOOK: "moinenMapsZoneEvent",
    apply: async (op) => {
      if (!writer) return { ok: false, reason: "notActiveGM" };
      log.push(op);
      if (op.op !== "batch") { const r = one(op); if (r.ok) v++; return r; }
      const inv = []; for (let i = 0; i < op.ops.length; i++) { const r = one(op.ops[i]); if (!r.ok) { for (const u of inv) one(u); return { ok: false, reason: r.reason, at: i }; } inv.unshift(r.inverse); }
      v++; return { ok: true, changed: true, inverse: { op: "batch", ops: inv }, result: [] };
    },
    zoneOfToken: (t) => (t ? placeOfTok(t) : null), place: (w) => (typeof w === "string" ? { zone: w.split(":")[0], spot: w } : null),
    tokensInZone: (where) => { const s = typeof where === "string" ? where : spot(where); return Object.values(tokens).filter((t) => (s.includes(":") || typeof where !== "string" ? spot(t) === s : t.zone === s)).map((t) => ({ token: t, place: placeOfTok(t) })); },
    range: (a, b) => (a.zone === b.zone ? { borders: 0, levels: spot(a) === spot(b) ? 0 : 1, total: spot(a) === spot(b) ? 0 : 1 } : { borders: 1, levels: 0, total: 1 }),
    zone: (w) => ({ key: w, states: { ...(marks[String(w).split(":")[0]] ?? {}) }, empty: false }), zoneStates: () => [{ kind: "fire", level: 2, source: "mark" }],
    borderBetween: (a, b) => borders[[a, b].sort().join("|")] ?? null,
    graph: () => ({ zones: [{ id: "z1" }, { id: "z2" }], borders: [{ id: "z1|z2", a: "z1", b: "z2", wall: { armor: 4, state: borders["z1|z2"].wall.state }, door: null }], edges: [] }),
    profile: (p) => (p?.way ? { speed: 1, actions: 1, ...p } : null),
    moveCost: (a, b, p) => ({ reachable: true, plan: { zones: [a.zone, b] }, cost: { total: 1, speed: p.speed ?? 1, actions: 1, stressActions: null, within: "plain" } }),
    reach: (w, p) => [{ zone: "z1", id: 1, d: 0, cost: { total: 0, within: "free" } }, { zone: "z2", id: 2, d: 1, cost: { total: 1, within: "plain" } }],
    plan: (a, b) => ({ way: "walk", total: 1, zones: [a.zone, b], steps: [{ kind: "border", from: a.zone, to: b, zone: b }] }),
    forcedChain: (who, o) => ({ forced: true, total: o.distance ?? 1, zones: [who.zone, "z2"], steps: [], ray: { end: "distance" } }),
    planAlong: (from, keys, o) => ({ forced: !!o?.forced, zones: [from.zone, ...keys], steps: [] }),
    freeSpot: () => ({ x: 320, y: 20, crowded: false }),
    beforeStep: (fn) => { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1); },
    move: async (t, to, o = {}) => {
      const dest = to ?? o.plan?.zones?.at(-1); if (!t) return { ok: false, reason: "noToken" };
      for (const fn of listeners) { const a = await fn({ token: t, from: placeOfTok(t), to: { zone: dest, spot: dest }, data: o.data }); if (a === false || a?.stop) return { ok: true, op: "m1", done: 0, total: 1, stopped: { index: 0, reason: a?.reason ?? "listener" }, place: placeOfTok(t), inverse: null }; }
      const inverse = { op: "tokens", rows: [{ id: t.id, x: t.x, y: t.y, alt: t.alt, floor: t.floor, air: t.air }] };
      t.zone = dest; t.x = 320; return { ok: true, op: "m1", done: 1, total: 1, stopped: null, place: placeOfTok(t), inverse };
    },
    moveToZone: async (t, where) => { const inverse = { op: "tokens", rows: [{ id: t.id, x: t.x, y: t.y, alt: t.alt, floor: t.floor, air: t.air }] }; t.zone = where; t.x = 320; return { ok: true, inverse, place: placeOfTok(t) }; },
    tactical: (cfg) => { api._tactical = cfg; return true; }, tacticalOn: () => !!api._tactical,
    /* the inverse of a move restores x: the fake keeps the zone with the x it knows */
    _sync: () => { for (const t of Object.values(tokens)) t.zone = t.x < 200 ? "z1" : "z2"; },
  };
  return { api, marks, borders, tokens, log, setWriter: (b) => { writer = b; } };
}

{
  const F = fakeZones();
  globalThis.game = { modules: { get: (id) => (id === "moinen-maps" ? { active: true, api: { zones: F.api } } : null) } };
  const hooks = {}; globalThis.Hooks = { on: (n, fn) => { hooks[n] = fn; return 7; }, off: (n) => { delete hooks[n]; } };
  eq([Z.available(), Z.canWrite(), Z.version()], [true, true, 1], "API found; this client may write");
  /* queries: places as spot strings */
  eq([Z.spotOf(F.tokens.t1), Z.placeOf(F.tokens.t1).level, Z.spotOf(null)], ["z1", "ground", null], "where a token is: the place and its spot string");
  eq(Z.tokensInZone(F.tokens.t1).map((t) => t.id), ["t1"], "who shares the zone: token documents out of the API's { token, place } rows");
  eq(Z.rowsInZone("z2").map((r) => [r.token.id, r.place.spot]), [["t2", "z2"]], "the same with the places");
  eq([Z.range(F.tokens.t1, F.tokens.t2).total, Z.zoneOf("z1").states.fire, Z.zoneStates("z1")[0].kind, Z.borderBetween("z1", "z2").wall.state, Z.graph().borders[0].wall.armor], [1, 2, "fire", "intact", 4], "range, zone data, states, border, graph");
  /* writes: apply and the inverse it returns */
  const before = JSON.stringify(F.marks);
  const r = await Z.perform({ t: "zones", op: ZP.zoneOp("z1", { fire: 5, wrecked: true }) });
  eq([r.ok, F.marks.z1, r.op], [true, { fire: 5, wrecked: true }, { t: "zones", op: { op: "zone", zone: "z1", patch: { fire: 5, wrecked: true } }, inverse: { op: "zone", zone: "z1", patch: { fire: 2, wrecked: null } } }], "a zone write goes through apply; the journal op carries the inverse the API returned");
  const undo = await Z.perform(J.inverseEffect(r.op));
  eq([undo.ok, undo.op, JSON.stringify(F.marks)], [true, null, before], "the journal's inverse effect gives that inverse back to apply: the marks are exactly as before, nothing new is recorded");
  const l = await Z.perform({ t: "zones", op: ZP.levelOp("t1", { level: "elevated", airborne: true }) });
  eq([l.ok, Z.spotOf(F.tokens.t1), F.tokens.t1.x, l.op.inverse], [true, "z1:elevated", 10, { op: "tokens", rows: [{ id: "t1", x: 10, y: 10, alt: null, floor: null, air: null }] }], "a level change: the spot changes, the position does not");
  await Z.perform(J.inverseEffect(l.op));
  eq([Z.spotOf(F.tokens.t1), F.tokens.t1.air], ["z1", null], "level undone");
  const b = await Z.perform({ t: "zones", op: ZP.borderOp("z1|z2", { wall: { state: "breached" } }) });
  eq([b.ok, F.borders["z1|z2"].wall.state, b.op.inverse], [true, "breached", { op: "border", border: "z1|z2", play: { wall: { state: "intact" }, door: null } }], "a wall breached; the inverse is the play record before, as the API gave it");
  await Z.perform(J.inverseEffect(b.op));
  eq(F.borders["z1|z2"].wall.state, "intact", "border undone");
  const bt = await Z.perform({ t: "zones", op: { op: "batch", ops: [ZP.zoneOp("z2", { dark: true }), ZP.borderOp("z1|z2", { wall: { state: "removed", temp: true } })] } });
  eq([bt.ok, bt.op.inverse.ops.map((o) => o.op)], [true, ["border", "zone"]], "several changes of one action are one batch with one inverse (last first)");
  await Z.perform(J.inverseEffect(bt.op));
  eq([F.marks.z2, F.borders["z1|z2"].wall.state], [{}, "intact"], "batch undone");
  eq((await Z.perform({ t: "zones", op: { op: "batch", ops: [ZP.zoneOp("z2", { dark: true }), { op: "zone", zone: "zz", patch: { dark: true } }] } })).reason, "badOp", "a refused batch is refused whole");
  eq(F.marks.z2, {}, "and took back what it had done");
  eq([(await Z.perform({ t: "zones", op: { op: "teleport" } })).reason, (await Z.perform({ t: "zones", op: null })).reason, (await Z.perform({ t: "zones", op: ZP.zoneOp("z1", { smoke: true }) })).reason], ["badOp", "badOp", "badOp"], "an unknown op never reaches the map");
  F.setWriter(false);
  eq([Z.canWrite(), (await Z.perform({ t: "zones", op: ZP.zoneOp("z1", { dark: true }) })).reason, F.log.length], [false, "notActiveGM", 9], "only the active GM's client writes: refused before the map is called");
  F.setWriter(true);
  /* movement */
  eq([Z.profile({ way: "walk" }).speed, Z.profile({}), Z.moveCost(F.tokens.t1, "z2", { way: "walk" }).cost.within, Z.reach(F.tokens.t1, { way: "walk" }).map((x) => x.zone), Z.plan(F.tokens.t1, "z2", { way: "walk" }).zones], [1, null, "plain", ["z1", "z2"], ["z1", "z2"]], "profile, cost, reach, plan");
  eq([Z.forcedChain(F.tokens.t2, { awayFrom: F.tokens.t1, distance: 2 }).forced, Z.planAlong(F.tokens.t2, ["z1"], { forced: true }).zones, Z.freeSpot("z2").crowded], [true, ["z2", "z1"], false], "forced chain, the GM's edited chain, a free spot");
  const asked = []; const off = Z.beforeStep((ctx) => { asked.push(ctx.to.zone); return asked.length === 1 ? { stop: true, reason: "fire" } : true; });
  const m0 = await Z.move(F.tokens.t1, "z2", { profile: { way: "walk" } });
  eq([m0.ok, m0.done, m0.stopped.reason, m0.journal, F.tokens.t1.zone], [true, 0, "fire", null, "z1"], "the step listener is asked before the step and stops the move: nothing to journal");
  const m1 = await Z.move(F.tokens.t1, "z2", { profile: { way: "walk" }, data: { inst: "a1" } });
  eq([m1.done, F.tokens.t1.zone, m1.journal], [1, "z2", { t: "zones", op: { op: "move", id: "m1", done: 1 }, inverse: { op: "tokens", rows: [{ id: "t1", x: 10, y: 10, alt: null, floor: null, air: null }] } }], "a move returns a `tokens` inverse: the journal op of the move");
  await Z.perform(J.inverseEffect(m1.journal)); F.api._sync();
  eq([F.tokens.t1.x, F.tokens.t1.zone], [10, "z1"], "undo puts the mover back where it started");
  off(); asked.length = 0; await Z.move(F.tokens.t1, "z2", {}); eq(asked.length, 0, "the listener is off"); await Z.perform({ t: "zones", op: { op: "tokens", rows: [{ id: "t1", x: 10 }] } }); F.api._sync();
  const mz = await Z.moveToZone(F.tokens.t2, "z1");
  eq([mz.ok, mz.place.spot, mz.journal.inverse.rows[0].x], [true, "z1", 300], "placing a token into a zone gives an inverse too");
  eq([Z.tactical({ profile: () => ({ way: "walk" }), confirm: () => false }), Z.tacticalOn(), (await Z.move(null, "z2")).ok], [true, true, false], "cost confirmation on a drag is switched per client; a refused move is not ok");
  let got = null; const offEv = Z.onEvent((type, p) => { got = [type, p.zone]; }); hooks.moinenMapsZoneEvent("zoneChanged", { zone: "z1" }); offEv();
  eq([got, "moinenMapsZoneEvent" in hooks], [["zoneChanged", "z1"], false], "the map's events arrive on its one hook");

  /* through the engine: a GM zone edit is one journaled transaction whose undo is apply(inverse) */
  const T = new Table(); T.hero("H1", "p1").npc("N1"); T.order(["H1", "N1"]).turn("H1");
  const inner = T.perform.bind(T);
  T.perform = async (e) => { if (e.t !== "zones") return inner(e); const res = await Z.perform(e); return res.ok ? { op: res.op } : res; };      // as the executor does
  eq((await T.gm({ op: "zoneSet", zone: "z2", patch: { dark: true, fire: 3 } })).ok, true, "GM edit zoneSet");
  eq([F.marks.z2, T.log.list.at(-1).ops.find((o) => o.t === "zones")?.inverse], [{ dark: true, fire: 3 }, { op: "zone", zone: "z2", patch: { dark: null, fire: null } }], "the map was written and the transaction holds the API's inverse");
  eq((await T.gm({ op: "zoneSet", zone: "zz", patch: { dark: true } })).error?.code, "illegal", "the map's refusal is the engine's answer; nothing is journaled");
  const tx = T.log.list.at(-1).id;
  eq([(await T.gm({ op: "undo", tx })).ok, F.marks.z2], [true, {}], "undo of the transaction restores the zone through apply(inverse)");
  eq((await T.gm({ op: "borderSet", border: "z1|z2", door: { state: "locked" } })).ok, true, "GM edit borderSet");
  eq(F.borders["z1|z2"].door, { state: "locked" }, "the door is locked on the map");
  eq((await T.gm({ op: "levelSet", token: "Scene.s.Token.t2", to: "@sky" })).ok, true, "GM edit levelSet with a spot string");
  eq(Z.spotOf(F.tokens.t2), "@sky", "the token is in the sky");

  globalThis.game = { modules: { get: () => null } };
  eq([Z.available(), Z.canWrite(), Z.range({}, {}), Z.spotOf({}), Z.tokensInZone("z1"), Z.reach({}, {}), (await Z.perform({ t: "zones", op: ZP.zoneOp("z1", { dark: true }) })).reason, (await Z.move({}, "z1")).reason], [false, false, undefined, null, [], [], "noZonesApi", "noZonesApi"], "no zones module: range is 'no scene' (undefined), writes and moves are refused, nothing throws");
  delete globalThis.game; delete globalThis.Hooks;
}
ok(true, "end");
done("check-zones");
