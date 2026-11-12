// node scripts/sweep-checks/m057.mjs  (S057: a relayed award / undo waits long enough for a full roster; other requests keep the 8 s timeout)
import { readFileSync } from "node:fs";
globalThis.game = { modules: { get: () => null } };
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const R = await import("../session/relay.mjs");
const P = await import("../session/pure.mjs");
const S = await import("../session/store.mjs");
const to = R.timeoutFor ?? (() => 8000);
// the GM side's floor for an award: one settle wait per hero commit (plus begin / end), before any server round trip
const floor = (P.LIMITS.heroes + 3) * S.SETTLE_MS;
const perHeroTrip = 600;   // a generous actor.update + setting write on a remote server
ck("award timeout covers a full roster", to({ cmd: "award" }) >= floor + P.LIMITS.heroes * perHeroTrip);
ck("undo timeout covers a full roster", to({ cmd: "undo" }) >= floor + P.LIMITS.heroes * perHeroTrip);
ck("other requests keep 8 s", to({ act: "next" }) === 8000 && to({ cmd: "discard" }) === 8000);
const src = readFileSync(new URL("../session/relay.mjs", import.meta.url), "utf8");
ck("send arms the per-request timeout", /setTimeout\(\(\) => done\(bad\("relay"\)\), timeoutFor\(req\)\)/.test(src));
console.log(`sweep m057: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
