/* Key parity check for the character generator wizard: node scripts/chargen/check-lang.mjs
   1) EN and PL define exactly the same keys, and every {placeholder} of a key exists in both languages.
   2) Every IPC.* key used literally in the code exists in both.
   3) Every issue code of rules.mjs has an IPC.Rule.<code> string.
   4) Key families built with template strings (steps, ranks, levels, attributes, types, fields, stepper states) are complete. */
import { EN, PL } from "./lang.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const dir = dirname(fileURLToPath(import.meta.url));
let bad = 0;
const fail = (m) => { bad++; console.log("FAIL", m); };
const miss = (a, b) => Object.keys(a).filter((k) => !(k in b));
for (const k of miss(EN, PL)) fail(`in EN, missing in PL: ${k}`);
for (const k of miss(PL, EN)) fail(`in PL, missing in EN: ${k}`);
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
for (const k of Object.keys(EN)) if (k in PL && ph(EN[k]) !== ph(PL[k])) fail(`placeholders differ for ${k}: EN {${ph(EN[k])}} PL {${ph(PL[k])}}`);

const files = ["main.mjs", "wizard.mjs", "import.mjs", ...readdirSync(join(dir, "steps")).filter((f) => f.endsWith(".mjs")).map((f) => `steps/${f}`)];
const used = new Set();
for (const f of files) {
  const src = readFileSync(join(dir, f), "utf8");
  for (const m of src.matchAll(/\bt\(\s*"(IPC\.[\w.]+)"/g)) used.add(m[1]);
  for (const m of src.matchAll(/\bt\(\s*[^"`)]*\?\s*"(IPC\.[\w.]+)"\s*:\s*"(IPC\.[\w.]+)"/g)) { used.add(m[1]); used.add(m[2]); }
  for (const m of src.matchAll(/"(IPC\.[A-Z][\w.]*[A-Za-z0-9])"/g)) used.add(m[1]);   // a prefix such as "IPC.Rule." (ends in a dot) is not a key
}
for (const k of used) if (!(k in EN) || !(k in PL)) fail(`used but not defined in both languages: ${k}`);

// every rules.mjs issue code
const rules = readFileSync(join(dir, "rules.mjs"), "utf8");
const codes = new Set([...rules.matchAll(/issue\("([\w.]+)"/g)].map((m) => m[1]));
for (const c of codes) if (!(`IPC.Rule.${c}` in EN) || !(`IPC.Rule.${c}` in PL)) fail(`rule code without a string: IPC.Rule.${c}`);
for (const k of Object.keys(EN)) if (k.startsWith("IPC.Rule.") && !codes.has(k.slice(9))) fail(`string for an unknown rule code: ${k}`);

// families
const fam = (prefix, items, suffixes = [""]) => { for (const i of items) for (const s of suffixes) { const k = `${prefix}${i}${s}`; if (!(k in EN) || !(k in PL)) fail(`family key missing: ${k}`); } };
const STEPS = ["start", "rank", "concept", "powers", "talents", "attributes", "life", "persona", "team", "review"];
fam("IPC.Step.", STEPS, [".Label", ".Title", ".Hint"]);
fam("IPC.Rank.", ["teen", "street", "global", "cosmic"]);
fam("IPC.Level.", ["basic", "major", "massive", "monstrous"]);
fam("IPC.Attr.", ["fighting", "agility", "strength", "reason", "intuition", "presence"]);
fam("IPC.Type.", ["powerSource", "power", "boost", "limit", "talent", "drawback"]);
fam("IPC.Mode.", ["manual", "random"]);
fam("IPC.Identity.", ["secret", "public", "none"]);
fam("IPC.Role.", ["Blaster", "Brains", "Brawn", "Controller", "Defender", "Leader", "Striker", "Wildcard"]);
fam("IPC.Powers.Type.", ["Attack", "Control", "Defense", "Modification", "Movement", "Sensory"]);
fam("IPC.Powers.Pays.", ["level", "boost"]);
fam("IPC.Powers.PaysChip.", ["level", "boost", "none"]);
fam("IPC.Talents.Fx.", ["health", "resolve", "slugfest", "reputation", "resources"]);
fam("IPC.Grad.", Array.from({ length: 13 }, (_, i) => i));
fam("IPC.Attrs.Group.", ["physical", "mental"], ["", ".Sub"]);
fam("IPC.Stepper.State.",["current", "done", "issue", "todo"]);
fam("IPC.Field.", ["name", "civilianName", "role", "appearance", "occupation", "personality", "drive", "flaw", "relationships", "team", "teamBase", "reputation", "resources", "rank"]);

fam("IPC.Persona.", ["Drive", "Flaw"], [".Title", ".Sub", ".Roll", ".RollTipArch", ".RollTipAll", ".Field", ".Ph", ".UseAria"]);   // phase 5e: built with a template string in steps/persona.mjs

fam("IPC.Team.Mode.Set.", ["text", "join", "create"]);                  // phase 5f: built with a template string in steps/team.mjs
fam("IPC.Summary.Mode.", ["text", "join", "create", "member"]);          // phase 5f: built with a template string in steps/summary.mjs

fam("IPC.Step.", ["board"], [".Label", ".Title", ".Hint"]);                                 // phase 6: the roll board is a step module that is not in rules.STEP_IDS
fam("IPC.Board.Spice.", ["simple", "standard", "wild", "custom"], ["", ".Desc"]);            // built with a template string in steps/board.mjs and start.mjs
fam("IPC.Board.Toggle.", ["drawbacks", "extraTalents", "extraSource", "limits", "heroRel", "joinBase"]);
fam("IPC.Board.Scope.", ["free", "arch", "within"]);

console.log(bad ? `${bad} problem(s)` : `OK: ${Object.keys(EN).length} keys, ${used.size} used directly, ${codes.size} rule codes, EN = PL`);
process.exit(bad ? 1 : 0);
