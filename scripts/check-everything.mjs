// node scripts/check-everything.mjs -- runs EVERY test suite of the module, each in its own node process, prints one total and
// exits 1 if any suite fails or does not finish. Suites print their counts in different words; the count of a suite is the first
// number its last summary line gives (checks, else keys). The i18n glossary/names checks and the shared kit's checks are left out
// here because the tactics runner already runs them (scripts/tactics/check-glossary.mjs, check-names.mjs, ../check-kit, ../check-marks).
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const SUITES = [
  "tactics/check-all.mjs", "rules/check-all.mjs", "rules/check-parity-live.mjs",
  "base/check-base.mjs", "base/check-ev.mjs", "base/check-up.mjs", "base/check-lang.mjs",
  "chargen/check-rules.mjs", "chargen/check-lang.mjs", "chargen/apply-check-lang.mjs", "chargen/tables-check-lang.mjs",
  "log/check-log.mjs", "log/check-lang.mjs",
  "session/check-session.mjs", "session/ui/check-ui.mjs", "session/check-lang.mjs",
  "combat/check-lang.mjs", "diceeffects/check-lang.mjs", "party/check-lang.mjs", "slash/check-lang.mjs", "tokenhalo/check-lang.mjs", "turn/check-lang.mjs",
  // the sweep fixers' standalone checks (each prints "sweep cN: N checks, F failed"): every file in sweep-checks, so new ones join by themselves
  ...readdirSync(join(dir, "sweep-checks")).filter((f) => f.endsWith(".mjs")).sort((a, b) => a.localeCompare(b, "en", { numeric: true })).map((f) => `sweep-checks/${f}`),
];
// Summary line shapes, most specific first: "tactics: N checks, F failed", "rules: N checks, F failed", "check-x: N checks, F failed",
// "N checks, F failed", "OK N checks", "check-lang OK: N checks", "OK: N keys", "OK N checks (N keys ...)".
const COUNT = [/^tactics: (\d+) checks, (\d+) failed/, /^rules: (\d+) checks, (\d+) failed/, /(\d+) checks, (\d+) failed/,
  /OK:? (\d+) checks/, /OK: (\d+) keys/];
let checks = 0, failed = 0, bad = 0;
for (const s of SUITES) {
  const r = spawnSync(process.execPath, [join(dir, s)], { encoding: "utf8", maxBuffer: 64 << 20 });
  const lines = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split(/\r?\n/);
  let n = null, f = 0;
  for (const re of COUNT) {
    const hit = [...lines].reverse().map((l) => re.exec(l)).find(Boolean);
    if (hit) { n = Number(hit[1]); f = hit[2] != null ? Number(hit[2]) : 0; break; }
  }
  if (n == null && r.status === 0 && lines.some((l) => /\bOK\b|exits 0|no tree|skipp/i.test(l))) n = 0;
  const pass = r.status === 0 && n != null;
  checks += n ?? 0;
  if (!pass) { bad++; failed += f || (n == null ? 0 : f); }
  console.log(`  ${pass ? "ok  " : "FAIL"} ${s.padEnd(34)} ${n ?? "?"} checks${f ? `, ${f} failed` : ""}${pass ? "" : ` (exit ${r.status})`}`);
  if (!pass) console.log(lines.filter((l) => /FAIL|Error|error/.test(l)).slice(0, 12).map((l) => `       ${l}`).join("\n") || lines.slice(-8).map((l) => `       ${l}`).join("\n"));
}
console.log(`everything: ${SUITES.length} suites, ${checks} checks, ${failed} failed${bad ? `, ${bad} suite(s) failed` : ""}`);
process.exit(bad ? 1 : 0);
