// node scripts/tactics/check-zones.mjs -- zones adapter: the inverses it builds for zone commands (spec 7.3), against a fake zones API, and through the journal.
import { ok, eq, done } from "./testkit.mjs";
import * as Z from "./zones-adapter.mjs";
import * as J from "./journal-pure.mjs";

/* ---- pure builders */
eq(Z.zoneInverse("z3", { wrecked: true, fire: 4 }, { fire: 2, dark: true }), { call: "setZone", zone: "z3", patch: { wrecked: null, fire: 2 } }, "zone inverse restores exactly the touched keys: an absent mark is cleared, others are left alone");
eq(Z.zoneInverse("z3", { fire: null }, { fire: 6 }), { call: "setZone", zone: "z3", patch: { fire: 6 } }, "clearing a mark is undone by setting it back");
eq(Z.zoneInverse("z3", { fire: 1 }, null).patch, { fire: null }, "no previous marks at all");
eq([Z.zoneInverse(null, {}, {}), Z.zoneInverse("z", null, {})], [null, null], "bad input gives no inverse");
eq(Z.zoneInverseFromEvent({ type: "zoneChanged", zone: "z1", changed: ["fire", "dark"], before: { fire: 3, ice: true }, after: { fire: 0, dark: true } }), { call: "setZone", zone: "z1", patch: { fire: 3, dark: null } }, "the contract's recipe from a zoneChanged event");
eq(Z.levelInverse("Scene.s.Token.t", { zone: "z1", level: "elevated", floor: 0, airborne: true, area: null }), { call: "setLevel", token: "Scene.s.Token.t", to: { level: "elevated", floor: 0, airborne: true } }, "level inverse = the previous level, floor and airborne flag");
eq(Z.levelInverse("Scene.s.Token.t", { zone: null, area: "sky" }).to, { area: "sky" }, "from an off-map area back to that area");
eq(Z.levelInverse("Scene.s.Token.t", { zone: "z1", level: "floor", floor: 2 }).to, { level: "floor", floor: 2, airborne: false }, "a floor");
eq(Z.borderInverse("z1|z2", { kind: "wall", x: 10, y: 20 }), { call: "setBorder", border: "z1|z2", kind: "wall", x: 10, y: 20 }, "border inverse swaps the kind back [G-Z1]");
for (const [p, want] of [[{ wrecked: true }, true], [{ fire: 12 }, true], [{ fire: 13 }, false], [{ fire: "hot" }, false], [{ lowgrav: null }, true], [{ smoke: true }, false], [{}, false], [null, false], [{ dark: 1 }, false]]) eq(Z.validZonePatch(p), want, `zone patch ${JSON.stringify(p)}`);

/* ---- against a fake zones API (the shape of spec 7.3) */
{
  const own = { z1: { fire: 2 } }, tokens = { "Scene.s.Token.t": { uuid: "Scene.s.Token.t", place: { zone: "z1", level: "ground", floor: 0, airborne: false, area: null } } }, borders = { "z1|z2": { key: "z1|z2", kind: "wall", x: 5, y: 6 } };
  const api = {
    idOf: (k) => (k in own || k === "z2" ? `id-${k}` : null), zone: (k) => ({ key: k, states: { ...(own[k] ?? {}), painted: true } }), ownMarksOf: (k) => own[k] ?? {},
    setZone: (id, patch) => { const k = id.slice(3); own[k] = { ...(own[k] ?? {}) }; for (const [a, v] of Object.entries(patch)) { if (v === null) delete own[k][a]; else own[k][a] = v; } return true; },
    zoneOfToken: (t) => t.place, range: () => ({ total: 0, borders: 0, levels: 0 }), setLevel: async (t, to) => { t.place = { ...t.place, ...to }; },
    borderBetween: (a, b) => borders[[a, b].sort().join("|")] ?? null, setBorder: (x, y, kind) => { borders["z1|z2"].kind = kind; },
  };
  globalThis.game = { modules: { get: (id) => (id === "moinen-maps" ? { active: true, api: { zones: api } } : null) } };
  globalThis.fromUuid = async (u) => tokens[u] ?? null;
  eq(Z.available(), true, "API found");
  const before = JSON.stringify(own);
  const r = await Z.perform({ t: "zones", call: "setZone", zone: "z1", patch: { fire: 5, wrecked: true } });
  eq([r.ok, own.z1, r.op.inverse], [true, { fire: 5, wrecked: true }, { call: "setZone", zone: "z1", patch: { fire: 2, wrecked: null } }], "setZone performed; the inverse uses the OWN marks, not the painted layers");
  const undo = await Z.perform(J.inverseEffect(r.op));
  eq([undo.ok, undo.op, JSON.stringify(own)], [true, null, before], "the journal's inverse effect restores the marks exactly and records nothing new");
  eq((await Z.perform({ t: "zones", call: "setZone", zone: "z1", patch: { smoke: true } })).reason, "badPatch", "unknown zone state refused");
  eq((await Z.perform({ t: "zones", call: "setZone", zone: "zz", patch: { dark: true } })).reason, "zoneGone", "a zone key that no longer resolves");
  const l = await Z.perform({ t: "zones", call: "setLevel", token: "Scene.s.Token.t", to: { level: "elevated", airborne: true } });
  eq([l.ok, tokens["Scene.s.Token.t"].place.level, l.op.inverse.to], [true, "elevated", { level: "ground", floor: 0, airborne: false }], "setLevel performed with the previous place as the inverse");
  await Z.perform(J.inverseEffect(l.op));
  eq([tokens["Scene.s.Token.t"].place.level, tokens["Scene.s.Token.t"].place.airborne], ["ground", false], "level undone");
  const b = await Z.perform({ t: "zones", call: "setBorder", border: "z1|z2", kind: "open" });
  eq([b.ok, borders["z1|z2"].kind, b.op.inverse.kind], [true, "open", "wall"], "border kind swapped, inverse = the old kind");
  await Z.perform(J.inverseEffect(b.op));
  eq(borders["z1|z2"].kind, "wall", "border undone");
  eq((await Z.perform({ t: "zones", call: "setBorder", border: "z1|z9", kind: "open" })).reason, "borderGone", "no such border");
  eq((await Z.perform({ t: "zones", call: "teleport" })).reason, "unknownCall", "unknown command");
  globalThis.game = { modules: { get: () => null } };
  eq([Z.available(), Z.range({}, {}), (await Z.perform({ t: "zones", call: "setZone", zone: "z1", patch: { dark: true } })).reason], [false, undefined, "noZonesApi"], "no zones module: range is 'no scene' (undefined), commands are refused, nothing throws");
  delete globalThis.game; delete globalThis.fromUuid;
}
ok(true, "end");
done("check-zones");
