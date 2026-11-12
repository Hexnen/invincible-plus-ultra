// node scripts/sweep-checks/t16.mjs  (T035: child lines of bulk.change/log.gap keep the actor id so item links resolve in the Table log)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const src = readFileSync(fileURLToPath(new URL("../log/ui/rows.mjs", import.meta.url)), "utf8");
const line = src.split("\n").find((l) => l.includes("const ke = {") && l.includes("`${e.id}~k`"));
ck("child entry line found", !!line);
ck("child entry copies aid", /aid:\s*e\.aid/.test(line || ""));
ck("child entry copies sc", /sc:\s*e\.sc/.test(line || ""));
// model of view.mjs ctx.actor(e): aid wins, else source actor
const actor = (e, src0, actors) => (e?.aid ? actors[e.aid] ?? null : src0 ?? null);
const parent = { aid: "A1", sc: "x" };
const mk = (copy) => ({ id: "p~k", ...(copy ? { aid: parent.aid, sc: parent.sc } : {}) });
ck("old shape loses actor in Table log", actor(mk(false), null, { A1: {} }) === null);
ck("new shape resolves actor", actor(mk(true), null, { A1: { ok: 1 } })?.ok === 1);
console.log(`sweep t16: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
