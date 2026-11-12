// node scripts/sweep-checks/c24.mjs  (S069: sanitized decl flags noPush/secret are the number 1; simple.mjs roll step must honour them)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const src = readFileSync(fileURLToPath(new URL("../tactics/flows/simple.mjs", import.meta.url)), "utf8");
const line = src.split("\n").find((l) => l.includes('K.rollEffect("roll", I.actor, attr, bp.pool') && l.includes("e?.roll?.passive"));
ck("roll line found", !!line);
const pm = line.match(/passive: (.*?), secret: (.*?), label/);
ck("flag expressions extracted", !!pm);
const mk = (x) => new Function("e", "d", `return ${x};`);
const passive = mk(pm[1]), secret = mk(pm[2]);
// sanitizeDecl output form (engine-pure.mjs): flag = 1
ck("noPush 1 -> passive", passive({}, { noPush: 1 }) === true);
ck("secret 1 -> secret", secret({}, { secret: 1 }) === true);
ck("noPush true still passive", passive({}, { noPush: true }) === true);
ck("secret true still secret", secret({}, { secret: true }) === true);
ck("absent flags false", passive({}, {}) === false && secret({}, {}) === false);
ck("entry passive kept", passive({ roll: { passive: true } }, {}) === true);
console.log(`sweep c24: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
