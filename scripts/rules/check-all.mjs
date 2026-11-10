// node scripts/rules/check-all.mjs -- runs every check of the rules library in one process (exit code 1 on any failure).
import { summary } from "./testkit.mjs";
await import("./check-pure.mjs");
await import("./check-dice.mjs");
await import("./check-zones.mjs");
await import("./check-places.mjs");
await import("./check-movement.mjs");
await import("./check-conditions.mjs");
await import("./check-initiative.mjs");
await import("./check-crits.mjs");
await import("./check-attack.mjs");
await import("./check-hazards.mjs");
const s = summary();
console.log(`rules: ${s.checks} checks, ${s.failed} failed`);
