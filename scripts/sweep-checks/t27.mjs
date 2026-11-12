// node scripts/sweep-checks/t27.mjs  (T057: a composite part must be pushed as prepaid through data, which pushChild/makeInst copy)
import { Table } from "../tactics/testkit.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const src = readFileSync(fileURLToPath(new URL("../tactics/flows/simple.mjs", import.meta.url)), "utf8");
const line = src.split("\n").find((l) => l.includes("R.push = {") && l.includes("part: 1")) ?? "";
ck("push spec carries data.prepaid", /data:\s*\{\s*prepaid:\s*true\s*\}/.test(line));
ck("no dead top-level prepaid key", !/part: 1, prepaid/.test(line));
const T = new Table(); T.hero("H1", "p1").npc("N2", { health: 4 }); T.order(["H1", "N2"]).turn("H1");
await T.gm({ op: "powerGrant", combatant: "H1", entry: { id: "flurry", flow: "composite", cost: "full", parts: [{ action: "slugfest" }, { action: "slugfest" }] } });
await T.req("p1", { op: "declare", actor: "H1", decl: { action: "flurry", targets: ["N2"] } });
const part = T.state.stack.find((i) => i.part);
ck("composite part instance is prepaid", part?.data?.prepaid === true);
console.log(`sweep t27: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
