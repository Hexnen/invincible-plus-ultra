import { readFileSync } from "node:fs";
import { claimHeld, CLAIM_STALE_MS } from "../tactics/store.mjs";
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.error("FAIL", m); } };
const now = 1_000_000;
// S080
ok(claimHeld(`k|other|${now - 1000}`, "k", "me", now), "fresh claim of another tab blocks");
ok(!claimHeld(`k|old|${now - CLAIM_STALE_MS - 1}`, "k", "me", now), "stale claim of a dead tab does not block");
ok(claimHeld(`k|me|${now - 99999}`, "k", "me", now), "own claim is held");
ok(!claimHeld(`j|other|${now}`, "k", "me", now), "other key is free");
ok(claimHeld("k|other", "k", "me", now), "legacy claim without a time still blocks");
// S083 (source text: needs Foundry globals)
const src = readFileSync(new URL("../tactics/summons.mjs", import.meta.url), "utf8");
ok(/for \(const sc of game\.scenes \?\? \[\]\) if \(!scenes\.has\(sc\) && sc\.tokens\.some\(\(td\) => copyOf\(td\)\?\.combat === combat\.id\)\) scenes\.add\(sc\)/.test(src), "S083 syncCopies visits scenes holding this combat's copies");
console.log(`sweep c26: ${n} checks, ${bad} failed`);
process.exit(bad ? 1 : 0);
