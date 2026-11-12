// node scripts/sweep-checks/t23.mjs  (T041: endScene accepts a trailing Combat; T040 not fixable in these files)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const src = readFileSync(fileURLToPath(new URL("../tactics/api.mjs", import.meta.url)), "utf8");
const line = src.split("\n").find((l) => l.includes("endScene:") && l.includes("send("));
ck("endScene line found", !!line);
// model: extract the arrow and run it with the module's helpers stubbed
const isCombat = (x) => !!x && typeof x === "object" && x.documentName === "Combat";
const popCombat = (a) => (a.length && (isCombat(a[a.length - 1]) || a[a.length - 1] === undefined) ? a.pop() : undefined);
const sent = [];
const send = (combat, req) => sent.push({ combat, req });
const body = line.trim().replace(/^endScene:\s*/, "").replace(/,$/, "");
const endScene = new Function("popCombat", "isCombat", "send", `return ${body};`)(popCombat, isCombat, send);
const doc = { documentName: "Combat", id: "c1", foo: 1 };
endScene(doc);
ck("combat only: combat routed", sent[0].combat === doc);
ck("combat only: no document junk in request", JSON.stringify(sent[0].req) === '{"op":"endScene"}');
endScene({ force: true }, doc);
ck("opts + combat", sent[1].combat === doc && sent[1].req.force === true && sent[1].req.op === "endScene");
endScene({ force: true });
ck("opts only", sent[2].combat === undefined && sent[2].req.force === true);
endScene();
ck("no args", sent[3].req.op === "endScene");
endScene(undefined, doc);
ck("undefined opts + combat", sent[4].combat === doc);
console.log(`sweep t23: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
