// node scripts/sweep-checks/t24.mjs  (T042 amend drops the held exception card; T043 aborted knockback leaves no 'landed')
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MTable } from "../tactics/check-kit-map.mjs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const src = readFileSync(fileURLToPath(new URL("../tactics/engine-pure.mjs", import.meta.url)), "utf8");
// T043: source guard on the landed write
const land = src.split("\n").find((l) => l.includes("(P.data.landed ??= {})"));
ck("T043 landed write skips aborted child", !!land && land.includes('I.data.result !== "aborted"') && land.includes('I.status !== "aborted"'));
// T042: source guard + behaviour
ck("T042 opAmend drops the declare exception card", /dropPrompts\(X, \(p\) => p\.inst === inst\.id && p\.step === "declare" && p\.kind === "exception"\)/.test(src));
const mk = () => { const T = new MTable(); T.hero("H1", "p1", { attrs: { strength: 5 } }).npc("N1", { health: 5 }); T.put("H1", "z3").put("N1", "z4"); T.order(["H1", "N1"]); return T; };
{
  const T = mk();
  await T.req("p1", { op: "declare", actor: "H1", decl: { action: "move", to: "z1", exception: { text: "please" } } });
  const held = T.prompts().filter((p) => p.kind === "exception").length;
  ck("T042 setup: exception card open", held === 1);
  const id = T.top().id;
  await T.req("p1", { op: "amend", inst: id, decl: { to: "z2" } });
  ck("T042 no exception card left after amend", T.prompts().filter((p) => p.kind === "exception").length === 0);
  ck("T042 no dead pk.exception on a still-open instance", !T.state.stack.some((i) => i.data?.pk?.exception));
}
console.log(`sweep t24: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
