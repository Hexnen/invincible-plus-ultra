// node scripts/rules/check-parity-live.mjs [path of the moinen-maps tree] [--golden]
// OPT-IN, not part of check-all.mjs: compares the library's place model with the real zones code of moinen-maps (read-only import of
// scripts/zones/geometry.mjs, marks.mjs, places.mjs). The tree is taken from the argument, else the environment variable ZONES_TREE,
// else C:/mmwt-tactics. Without that tree the script says so and exits 0. check-places.mjs holds the same world with the answers
// frozen (the golden strings), so check-all needs no other tree; `--golden` prints those strings again from the real code.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as Z from "./zones.mjs";
import { WORLD, PLACES, encode } from "./check-places-world.mjs";
import { ok, eq, done } from "./testkit.mjs";

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith("--")) ?? process.env.ZONES_TREE ?? "C:/mmwt-tactics";
if (!fs.existsSync(path.join(root, "scripts/zones/places.mjs"))) {
  console.log(`check-parity-live: no zones tree at ${root} (skipped)`);
} else {
  const imp = (f) => import(pathToFileURL(path.join(root, f)).href);
  const G = await imp("scripts/zones/geometry.mjs");
  const K = await imp("scripts/zones/marks.mjs");
  const P = await imp("scripts/zones/places.mjs");

  // the world of check-places-world.mjs drawn as the map draws it: a 3 x 2 grid of 100 px zones, keys a b c / d e f
  const L = [[-20, 0, 320, 0], [-20, 100, 320, 100], [-20, 200, 320, 200], [0, -20, 0, 220], [100, -20, 100, 220], [200, -20, 200, 220], [300, -20, 300, 220]];
  const ZZ = G.buildZones(L, { snap: 5, minArea: 100 });
  const zoneAt = (x, y) => G.zoneAt(ZZ, x, y);
  const centre = { a: [50, 50], b: [150, 50], c: [250, 50], d: [50, 150], e: [150, 150], f: [250, 150] };
  const keys = "abcdef";
  const idOfKey = Object.fromEntries(Object.entries(centre).map(([k, [x, y]]) => [k, zoneAt(x, y)]));
  const keyOfId = Object.fromEntries(Object.entries(idOfKey).map(([k, id]) => [id, k]));
  const keyOf = (id) => keyOfId[id] ?? null;
  eq(Object.values(idOfKey).slice().sort(), [0, 1, 2, 3, 4, 5], "the grid has six zones");
  const mid = (p, q) => [(centre[p][0] + centre[q][0]) / 2, (centre[p][1] + centre[q][1]) / 2];
  const walls = WORLD.borders.filter((b) => b.kind !== "open").map((b) => [...mid(b.a, b.b), b.kind]);
  const marks = WORLD.zones.filter((z) => z.marks).map((z) => [...centre[z.key], z.marks]);
  const M = K.resolve(ZZ, walls, marks, zoneAt, 35);
  const C = P.makeCache(ZZ, M);

  // the library's graph, converted from the real zone and border data
  const zoneList = [...keys].map((k) => P.zoneInfo(C, keyOf, idOfKey[k]));
  const borderList = [];
  for (const k of keys) for (const n of zoneList.find((z) => z.key === k).neighbours) borderList.push(P.borderInfo(C, keyOf, idOfKey[k], idOfKey[n]));
  const g = Z.makeGraph(Z.graphFromZonesApi({ zones: zoneList, borders: borderList }));
  const hand = Z.makeGraph(WORLD.graph);
  eq([...g.zones.values()].map((z) => [z.id, z.building, z.floors, z.wrecked, z.terrain, z.terrainUnset]), [...hand.zones.values()].map((z) => [z.id, z.building, z.floors, z.wrecked, z.terrain, !!z.terrainUnset]), "converted zones = the hand-written graph of check-places");
  const sig = (b) => `${[b.a, b.b].sort().join("|")} ${b.wall ? `${b.wall.armor}${b.wall.state}${b.wall.outer ? "o" : ""}` : "-"} ${b.door ? `${b.door.armor}${b.door.state}` : "-"}`;
  eq(g.borders.map(sig).sort(), hand.borders.map(sig).sort(), "converted borders = the hand-written graph of check-places");

  const real = (p) => P.makePlace(M, keyOf, { id: p.key ? idOfKey[p.key] : -1, alt: p.alt, floor: p.floor, air: p.air });
  const mine = (p) => (p.key ? { zone: p.key, alt: p.alt, floor: p.floor, airborne: p.air } : { zone: null, alt: p.alt });
  // places: spot, level, roof / airborne
  let same = 0;
  for (const p of PLACES) {
    const r = real(p), m = Z.toPlace(g, p.key ? mine(p) : { area: p.alt });
    if (r.spot === m.spot && r.level === m.level && r.floor === m.floor && r.roof === m.roof && r.airborne === m.airborne && r.area === m.area) same++;
    else console.log("FAIL place", JSON.stringify(p), JSON.stringify(r), JSON.stringify(m));
    // a place of the zones API is a position of the library as it is
    const viaPlace = Z.toPlace(g, r), viaSpot = Z.toPlace(g, r.spot);
    ok(viaPlace.spot === r.spot && viaPlace.roof === r.roof && viaSpot.spot === r.spot, `a zones-API place and its spot string are positions here (${r.spot})`);
  }
  eq(same, PLACES.length, "every place reads the same on both sides");

  const WAYS = { walk: {}, air: { aerial: true }, through: { through: "any" } };   // A14: one rule for flyers on both sides
  const gold = { range: [], levels: [], walk: [], air: [], through: [] };
  let bad = 0;
  for (const a of PLACES) for (const b of PLACES) {
    const A = real(a), B = real(b), ma = a.key ? mine(a) : { area: a.alt }, mb = b.key ? mine(b) : { area: b.alt };
    const r = P.range(C, A, B), m = Z.rangeBetween(g, ma, mb);
    gold.range.push(r ? r.total : null); gold.levels.push(r ? r.levels : null);
    if (JSON.stringify(r) !== JSON.stringify(m)) { bad++; if (bad < 20) console.log("FAIL range", A.spot, B.spot, JSON.stringify(r), JSON.stringify(m)); }
    for (const [way, profile] of Object.entries(WAYS)) {
      const rr = P.routeLength(C, A, B, way), mm = Z.routeBetween(g, ma, mb, profile);
      gold[way].push(rr ? rr.total : null);
      if (JSON.stringify(rr) !== JSON.stringify(mm)) { bad++; if (bad < 20) console.log("FAIL route", way, A.spot, B.spot, JSON.stringify(rr), JSON.stringify(mm)); }
    }
  }
  eq(bad, 0, `range and routes (walk, air, through) agree with the zones code for all ${PLACES.length * PLACES.length} pairs of places`);
  if (args.includes("--golden")) for (const [k, v] of Object.entries(gold)) console.log(`  ${k}: "${encode(v)}",`);
  done("check-parity-live");
}
