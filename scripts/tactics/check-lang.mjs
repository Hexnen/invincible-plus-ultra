/* Key parity check for tactical combat: node scripts/tactics/check-lang.mjs
   1) EN and PL define exactly the same keys with the same {placeholders}; no empty strings; namespace ITAC.
   2) Every ITAC.* key written as a literal in scripts/tactics is defined in both.
   3) Derived keys exist: every error code the pure code or the transport can answer, the settings, the prompt kinds of P1.
   4) No rule text: no string is long enough to be a quoted rule, and none carries a book reference. */
import { EN, PL, t, errText } from "./lang.mjs";
import * as O from "./ops-pure.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const dir = dirname(fileURLToPath(import.meta.url));
let bad = 0, n = 0;
const fail = (m) => { bad++; console.log("FAIL", m); };
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
for (const k of Object.keys(EN)) { n++; if (!(k in PL)) fail(`in EN, missing in PL: ${k}`); else if (ph(EN[k]) !== ph(PL[k])) fail(`placeholders differ: ${k} (${ph(EN[k])} vs ${ph(PL[k])})`); }
for (const k of Object.keys(PL)) if (!(k in EN)) fail(`in PL, missing in EN: ${k}`);
for (const T of [EN, PL]) for (const [k, v] of Object.entries(T)) {
  n++;
  if (typeof v !== "string" || !v.trim()) fail(`empty string: ${k}`);
  if (!k.startsWith("ITAC.")) fail(`wrong namespace: ${k}`);
  if (v.length > 420) fail(`too long for our own wording: ${k}`);
  if (/\[B\d+\]|\bp\.\s?\d+/.test(v)) fail(`book reference in a string: ${k}`);
}
for (const k of Object.keys(EN)) if (EN[k].length > 40 && EN[k] === PL[k]) fail(`PL identical to EN (untranslated?): ${k}`);
const used = new Set(), codes = new Set();
const files = [...readdirSync(dir).filter((x) => x.endsWith(".mjs") && !x.startsWith("check-") && !["lang.mjs", "testkit.mjs"].includes(x)), ...readdirSync(join(dir, "ui")).filter((x) => x.endsWith(".mjs")).map((x) => `ui/${x}`)];
for (const f of files) {
  const src = readFileSync(join(dir, f), "utf8");
  for (const m of src.matchAll(/["'`](ITAC\.[A-Za-z][\w.]*)["'`]/g)) used.add(m[1]);
  for (const m of src.matchAll(/\berr\("([A-Za-z]+)"/g)) codes.add(m[1]);
  for (const m of src.matchAll(/\? "([A-Za-z]+)" : "([A-Za-z]+)"\)/g)) if (/err\(/.test(src.slice(Math.max(0, m.index - 80), m.index))) { codes.add(m[1]); codes.add(m[2]); }
}
for (const k of used) { n++; if (!(k in EN && k in PL)) fail(`used but not defined in both languages: ${k}`); }
for (const c of ["noGM", "untrusted", "stale", "rate", "badInput", "off", "notOwner", "notYourTurn", "noAction", "locked", "illegal", "unknown", "gone", "busy", "playersOff", "internal"]) codes.add(c);   // spec 12.1
for (const c of codes) { n++; if (!(`ITAC.err.${c}` in EN)) fail(`error code without text: ${c}`); }
const need = [];
for (const k of ["tacticsEnabled", "tacticsInitiative", "tacticsRedraw"]) for (const p of ["Name", "Hint"]) need.push(`ITAC.Settings.${k}.${p}`);
for (const k of ["everyRound", "firstRoundOnly"]) need.push(`ITAC.Redraw.${k}`);
for (const k of O.P1_PROMPTS) if (k !== "triggerQueue") need.push(`ITAC.Prompt.${k}.Title`, `ITAC.Prompt.${k}.Body`);
for (const k of ["roundStart", "roundEnd", "turnStart", "turnEnd"]) need.push(`ITAC.Prompt.triggerQueue.Title.${k}`);
for (const k of need) { n++; if (!(k in EN && k in PL)) fail(`derived key missing: ${k}`); }
/* t() and errText() */
n += 4;
if (t("ITAC.err.stale") !== EN["ITAC.err.stale"]) fail("t() falls back to English outside Foundry");
if (t("ITAC.nope") !== "ITAC.nope") fail("t() returns the key when it is unknown");
if (errText({ key: "ITAC.err.zzz", code: "zzz", params: {} }) !== t("ITAC.err.internal", { msg: "zzz" })) fail("errText of an unknown code is the internal error");
if (!errText({ key: "ITAC.err.internal", code: "internal", params: { msg: "boom" } }).includes("boom")) fail("errText fills parameters");
if (bad) { console.log(`FAIL ${bad}`); process.exit(1); }
console.log(`OK ${n} checks (${Object.keys(EN).length} keys, EN = PL)`);
