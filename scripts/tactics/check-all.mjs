// node scripts/tactics/check-all.mjs -- runs every check of tactical combat (package P1) in one process (exit code 1 on any failure).
// check-lang.mjs prints its own line and exits by itself on failure; it runs last.
import { summary } from "./testkit.mjs";
await import("./check-pure.mjs");
await import("./check-state.mjs");
await import("./check-ledger.mjs");
await import("./check-initiative.mjs");
await import("./check-scheduler.mjs");
await import("./check-ops.mjs");
await import("./check-source.mjs");
await import("./check-facing.mjs");
const s = summary();
console.log(`tactics: ${s.checks} checks, ${s.failed} failed`);
await import("./check-lang.mjs");
