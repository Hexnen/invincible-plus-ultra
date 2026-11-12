// node scripts/sweep-checks/c0.mjs  (S002: reroll of a pruned event must not write delete + stub for one key)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as P from "../base/pure.mjs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
// behaviour model of the patch building in events.roll (code needs Foundry globals)
const src = readFileSync(fileURLToPath(new URL("../base/ops.mjs", import.meta.url)), "utf8");
const line = src.split("\n").find((l) => l.includes("patch.events[rerollOf]"));
ck("flag line guarded against pruned key", !!line && line.includes("-=${rerollOf}"));
const build = (B, id, rerollOf, guarded) => {
  const patch = { events: { [id]: { at: 1e12 } } };
  const merged = { ...B.events, [id]: { at: 1e12 } };
  for (const old of P.pruneEvents(merged)) if (old !== id) patch.events[`-=${old}`] = null;
  if (rerollOf && B.events[rerollOf] && (!guarded || !(`-=${rerollOf}` in patch.events))) patch.events[rerollOf] = { rerolled: true };
  return patch;
};
const events = {}; for (let i = 0; i < 200; i++) events["e" + i] = { at: 1000 + i };
const bad = build({ events }, "new", "e0", false);
ck("unguarded writes both keys (old bug)", "-=e0" in bad.events && "e0" in bad.events);
const ok = build({ events }, "new", "e0", true);
ck("guarded: delete only", "-=e0" in ok.events && !("e0" in ok.events));
const ok2 = build({ events }, "new", "e5", true);
ck("normal reroll still flags", ok2.events.e5?.rerolled === true);
console.log(`sweep c0: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
