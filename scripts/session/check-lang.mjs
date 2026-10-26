/* Key parity check for the end-of-session panel: node scripts/session/check-lang.mjs
   1) EN and PL define exactly the same keys with the same {placeholders}. 2) Every IPL.Session.* key written as a literal in scripts/session is defined in both.
   3) Derived keys exist: error codes (reducer + transport), question labels, settings, states. 4) No empty strings, no leftover English in PL values that equal EN for long text. */
import { EN, PL } from "./lang.mjs";
import * as P from "./pure.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const dir = dirname(fileURLToPath(import.meta.url));
let bad = 0, n = 0;
const fail = (m) => { bad++; console.log("FAIL", m); };
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
for (const k of Object.keys(EN)) { n++; if (!(k in PL)) fail(`in EN, missing in PL: ${k}`); else if (ph(EN[k]) !== ph(PL[k])) fail(`placeholders differ: ${k} (${ph(EN[k])} vs ${ph(PL[k])})`); }
for (const k of Object.keys(PL)) if (!(k in EN)) fail(`in PL, missing in EN: ${k}`);
for (const T of [EN, PL]) for (const [k, v] of Object.entries(T)) { n++; if (typeof v !== "string" || !v.trim()) fail(`empty string: ${k}`); if (!k.startsWith("IPL.Session.")) fail(`wrong namespace: ${k}`); }
for (const k of Object.keys(EN)) if (/^IPL\.Session\.(Chat|Toast|Open|Status)\./.test(k) && EN[k].length > 40 && EN[k] === PL[k]) fail(`PL identical to EN (untranslated?): ${k}`);
const used = new Set();
const files = [...readdirSync(dir).filter((x) => x.endsWith(".mjs") && !["lang.mjs", "check-lang.mjs", "check-session.mjs"].includes(x)).map((x) => x),
  ...readdirSync(join(dir, "ui")).filter((x) => x.endsWith(".mjs") && !["lang-ui.mjs", "check-ui.mjs"].includes(x)).map((x) => `ui/${x}`)];
for (const f of files) {
  const src = readFileSync(join(dir, f), "utf8");
  for (const m of src.matchAll(/["'`](IPL\.Session\.[A-Za-z][\w.]*)["'`]/g)) used.add(m[1]);
  for (const m of src.matchAll(/bad\("([A-Za-z]+)"/g)) used.add(`IPL.Session.err.${m[1]}`);
  for (const m of src.matchAll(/\berr\("([A-Za-z]+)"/g)) used.add(`IPL.Session.err.${m[1]}`);
  for (const m of src.matchAll(/\bfail\("([A-Za-z]+)"/g)) used.add(`IPL.Session.err.${m[1]}`);
  for (const m of src.matchAll(/\bcode: "([A-Za-z]+)"/g)) used.add(`IPL.Session.err.${m[1]}`);
}
for (const k of used) { n++; if (!(k in EN && k in PL)) fail(`used but not defined in both languages: ${k}`); }
const need = [];
for (const c of ["noPermission", "badInput", "noSession", "exists", "noHeroes", "badState", "range", "unknownHero", "unknownQuestion", "locked", "notCurrent", "tooMany", "incomplete", "internal", "noGM", "untrusted", "rate", "tooBig", "stale", "relay", "playersOff", "noActor", "busy", "notAwarded"]) need.push(`IPL.Session.err.${c}`);
for (const q of [...P.GOOD, ...P.BAD]) need.push(`IPL.Session.q.${q.key}`);
for (const s of P.STATES) need.push(`IPL.Session.State.${s}`);
for (const g of ["good", "bad"]) need.push(`IPL.Session.Group.${g}`);
for (const k of ["allowPlayers", "autoOpen", "chatSummary"]) for (const p of ["Name", "Hint"]) need.push(`IPL.Session.Settings.${k}.${p}`);
for (const c of ["closed", "notMine", "noGM", "playersOff", "locked", "summary"]) need.push(`IPL.Session.UI.Reason.${c}`);   // built as a template string by ui/model.mjs
for (const c of ["Yes", "No", "None"]) need.push(`IPL.Session.UI.${c}`);
for (const k of need) { n++; if (!(k in EN && k in PL)) fail(`derived key missing: ${k}`); }
// every error code the reducer can answer is covered (grep pure.mjs for err("code"))
const pure = readFileSync(join(dir, "pure.mjs"), "utf8");
for (const m of pure.matchAll(/\berr\("([A-Za-z]+)"/g)) { n++; if (!(`IPL.Session.err.${m[1]}` in EN)) fail(`reducer error without text: ${m[1]}`); }
if (bad) { console.log(`FAIL ${bad}`); process.exit(1); }
console.log(`OK ${n} checks (${Object.keys(EN).length} keys, EN = PL)`);
