// node scripts/sweep-checks/t19.mjs  (T036: burrowing must not count as a way to reach an elevated altitude)
import { MOVE_MODES, altitudeAccess } from "../rules/movement.mjs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
ck("burrowing refused at elevated", altitudeAccess(MOVE_MODES.burrowing, "elevated").ok === false);
ck("burrowing reason needsAerial", altitudeAccess(MOVE_MODES.burrowing, "elevated").reason === "needsAerial");
ck("teleportation still allowed at elevated", altitudeAccess(MOVE_MODES.teleportation, "elevated").ok === true);
ck("flight still allowed at elevated", altitudeAccess(MOVE_MODES.flight, "elevated").ok === true);
ck("walk still refused at elevated", altitudeAccess(MOVE_MODES.walk, "elevated").reason === "needsAerial");
console.log(`sweep t19: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
