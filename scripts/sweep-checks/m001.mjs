// node scripts/sweep-checks/m001.mjs  (S001: the debounced base refresh must not drop the scope of an earlier call inside the 60 ms window)
import { readFileSync } from "node:fs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const src = readFileSync(new URL("../base/entry.mjs", import.meta.url), "utf8");
const line = src.split("\n").find((l) => l.startsWith("export const mergeScope ="));
ck("mergeScope defined", !!line);
const merge = line ? new Function(`return ${line.replace("export const mergeScope =", "").trim().replace(/;$/, "")}`)() : (_p, teamId, actorId) => ({ teamId, actorId });
let s = merge(null, "A", "h1");
ck("first call keeps its scope", s.teamId === "A" && s.actorId === "h1");
ck("same scope again stays narrow", merge(s, "A", "h1").teamId === "A");
const w = merge(merge(null, "B", "h1"), "A", null);
ck("two teams widen to all", w.teamId === null && w.actorId === null);
ck("refreshAll folds calls", /refreshScope = mergeScope\(refreshScope, teamId, actorId\)/.test(src) && /const \{ teamId, actorId \} = refreshScope; refreshScope = null;/.test(src));
console.log(`sweep m001: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
