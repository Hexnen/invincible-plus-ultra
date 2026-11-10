// node scripts/tactics/check-all.mjs -- runs every check of the tactics folder (package P2) in one process (exit code 1 on any failure).
import { summary } from "./testkit.mjs";
await import("./check-pure.mjs");
await import("./check-journal.mjs");
await import("./check-engine.mjs");
await import("./check-view.mjs");
await import("./check-relay.mjs");
await import("./check-desk.mjs");
await import("./check-zones.mjs");
await import("./check-lang.mjs");
await import("./check-executor.mjs");       // last: it installs a fake Foundry in globalThis
const s = summary();
console.log(`tactics: ${s.checks} checks, ${s.failed} failed`);
