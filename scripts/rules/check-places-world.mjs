/* Shared data of check-places.mjs and check-parity-live.mjs (not a test itself): one small world with floors, rooftops, a wrecked
   building and every kind of border, written once as the map's zones API would give it and once as the library's graph.

   A 3 x 2 grid, keys:   a b c
                         d e f
   a  street                       b  building with 3 floors (office)     c  plain building
   d  wrecked building, 2 floors   e  building with 1 floor               f  open ground, terrain never set
   borders: a|b exterior wall, b|c door, c|f interior wall, d|e locked door, b|e reinforced wall, a|d and e|f open. */

const B = (a, b, kind) => ({ a, b, kind });
const WALLS = { door: [{ armor: 2, state: "intact" }, { armor: 1, state: "closed" }], locked: [{ armor: 2, state: "intact" }, { armor: 2, state: "locked" }],
  wall: [{ armor: 2, state: "intact" }, null], outer: [{ armor: 3, state: "intact", outer: true }, null], reinforced: [{ armor: 4, state: "intact" }, null], open: [null, null] };

const zones = [
  { key: "a", marks: { terrain: "street" } },
  { key: "b", marks: { building: true, floors: 3, terrain: "office" } },
  { key: "c", marks: { building: true } },
  { key: "d", marks: { building: true, floors: 2, wrecked: true, terrain: "none" } },
  { key: "e", marks: { building: true, floors: 1, terrain: "warehouse" } },
  { key: "f", marks: null },
];
const borders = [B("a", "b", "outer"), B("b", "c", "door"), B("c", "f", "wall"), B("d", "e", "locked"), B("b", "e", "reinforced"), B("a", "d", "open"), B("e", "f", "open")];

export const WORLD = {
  zones, borders,
  /* the same world as the library's ZoneGraphData */
  graph: {
    zones: zones.map(({ key, marks: m }) => ({ id: key, building: !!m?.building, rooftop: !!m?.building, floors: m?.floors ?? 0, wrecked: !!m?.wrecked,
      terrain: m?.terrain && m.terrain !== "none" ? m.terrain : null, terrainUnset: !m?.terrain })),
    borders: borders.map(({ a, b, kind }) => ({ id: [a, b].sort().join("|"), a, b, wall: WALLS[kind][0], door: WALLS[kind][1] })),
  },
};

/* every place asked about: per zone the ground, a rooftop / the air, the air explicitly, underground, floors 1-3; then the four areas */
export const PLACES = [];
for (const key of "abcdef") {
  PLACES.push({ key, alt: "ground", floor: 0 }, { key, alt: "elevated", floor: 0 }, { key, alt: "elevated", floor: 0, air: true }, { key, alt: "underground", floor: 0 },
    { key, alt: "ground", floor: 1 }, { key, alt: "ground", floor: 2 }, { key, alt: "ground", floor: 3 });
}
for (const alt of ["sky", "orbit", "dimension", "chase"]) PLACES.push({ key: null, alt, floor: 0 });

/* numbers 0-35 as one base-36 character each, null as "-" */
export const encode = (list) => list.map((v) => (v == null ? "-" : v.toString(36))).join("");
export const decode = (s) => [...s].map((c) => (c === "-" ? null : parseInt(c, 36)));
