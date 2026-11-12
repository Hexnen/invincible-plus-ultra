// node scripts/sweep-checks/m009.mjs  (S009/S010: the gear tab's undo is re-checked against the team as it is now: one star, no duplicate rows, cap)
import { readFileSync } from "node:fs";
import * as P from "../base/pure.mjs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
ck("undoPatch exists", typeof P.undoPatch === "function");
const U = P.undoPatch ?? ((B, patch) => ({ patch }));
const after = (B, patch) => { const r = U(B, patch); if (r.error) return r; const out = structuredClone(B); for (const col of ["vehicles", "crate"]) for (const [id, v] of Object.entries(r.patch[col] ?? {})) out[col][id] = { ...(out[col][id] ?? {}), ...v }; return out; };
const A = { uuid: "Actor.A", name: "A", primary: true, sort: 1 };
// S009: the only (star) vehicle removed, another added (becomes the star), then undo
let B = { vehicles: { b: { uuid: "Actor.B", name: "B", primary: true, sort: 2 } }, crate: {} };
let o = after(B, { vehicles: { a: A } });
ck("S009 one star after undo", Object.values(o.vehicles).filter((v) => v.primary).length === 1 && o.vehicles.a?.primary === true);
// two-vehicle case still works (old demotion of next kept)
B = { vehicles: { b: { uuid: "Actor.B", name: "B", primary: true, sort: 2 } }, crate: {} };
o = after(B, { vehicles: { a: A, b: { primary: false } } });
ck("two-vehicle undo restores the old star only", o.vehicles.a?.primary === true && o.vehicles.b?.primary === false);
// S010 vehicle: the same actor added again in the window -> no second row with that uuid, today's star kept
B = { vehicles: { c: { uuid: "Actor.A", name: "A", primary: true, sort: 3 } }, crate: {} };
o = after(B, { vehicles: { a: A } });
ck("S010 no duplicate vehicle uuid", Object.values(o.vehicles).filter((v) => v.uuid === "Actor.A").length === 1);
B = { vehicles: { c: { uuid: "Actor.A", name: "A", primary: false, sort: 3 }, b: { uuid: "Actor.B", name: "B", primary: true, sort: 2 } }, crate: {} };
o = after(B, { vehicles: { a: A, b: { primary: false } } });
ck("S010 duplicate drop keeps a star", Object.values(o.vehicles).filter((v) => v.primary).length === 1);
// S010 crate: the same item added again -> quantities merge into one row
B = { vehicles: {}, crate: { n: { src: "Item.X", name: "X", qty: 1, sort: 1 } } };
o = after(B, { crate: { old: { src: "Item.X", name: "X", qty: 3, sort: 1 } } });
ck("S010 crate merges into the row that is back", Object.keys(o.crate).length === 1 && o.crate.n.qty === 4);
// cap: a full list refuses like the add path
const full = { vehicles: {}, crate: Object.fromEntries(Array.from({ length: P.LIMITS.crate }, (_x, i) => [`r${i}`, { src: `Item.${i}`, name: "r", qty: 1, sort: i }])) };
const r = U(full, { crate: { old: { src: "Item.new", name: "N", qty: 1, sort: 0 } } });
ck("cap refuses", r.error === "full" && r.cap === P.LIMITS.crate);
// plain restore unchanged
B = { vehicles: {}, crate: {} };
o = after(B, { crate: { old: { src: "Item.X", name: "X", qty: 2 } } });
ck("plain restore", o.crate.old?.qty === 2);
const gear = readFileSync(new URL("../base/tabs/gear.mjs", import.meta.url), "utf8");
ck("doUndo uses undoPatch", /P\.undoPatch\(/.test(gear));
console.log(`sweep m009: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
