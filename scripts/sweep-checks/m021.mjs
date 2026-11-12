// node scripts/sweep-checks/m021.mjs  (S021: Life step's "taken" test uses talentKey like rules.validate: one Knowledgeable per hero, any subject)
import { readFileSync } from "node:fs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const L = await import("../chargen/steps/life.mjs");
const R = await import("../chargen/rules.mjs");
const src = readFileSync(new URL("../chargen/steps/life.mjs", import.meta.url), "utf8");
ck("life uses talentKey for the taken test", /map\(talentKey\)/.test(src) && /const k = talentKey\(name\);/.test(src));
const taken = L.talentTaken ?? (() => false);
const s = { heroTalent: { name: "Knowledgeable (Technology)" }, extraTalents: [] };
ck("bare Knowledgeable is taken", taken(s, "Knowledgeable") === true);
ck("another subject is taken", taken(s, "Knowledgeable (Science)") === true);
ck("agrees with validate (talentKey)", R.talentKey("Knowledgeable (Science)") === R.talentKey("Knowledgeable (Technology)"));
ck("other talents unaffected", taken(s, "Tough") === false && taken({ heroTalent: { name: "Tough" }, extraTalents: [] }, "Tough") === true);
ck("repeatable still free", taken({ heroTalent: { name: "Durable" }, extraTalents: [] }, "Durable") === false);
console.log(`sweep m021: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
