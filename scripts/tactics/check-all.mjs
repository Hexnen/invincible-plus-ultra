// node scripts/tactics/check-all.mjs -- runs every check of tactical combat (exit code 1 on any failure) and adds up the counts.
// Each suite runs in its own node process: two of them (check-facing, check-executor) install a fake Foundry in globalThis and the
// Foundry-facing modules keep per-process state, so they cannot share one.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const SUITES = ["pure", "state", "ledger", "initiative", "scheduler", "ops", "source", "journal", "engine", "view", "relay", "desk", "ui", "zones", "move", "p7", "defects", "defects4", "fight", "attacks", "acts", "hazards", "kit", "int", "lang", "glossary", "u4", "board", "facing", "executor"];
let checks = 0, failed = 0, broken = 0;
for (const s of SUITES) {
  const r = spawnSync(process.execPath, [join(dir, `check-${s}.mjs`)], { encoding: "utf8" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split(/\r?\n/);
  const last = out.filter((l) => /^(OK \d+ checks|FAIL check-)/.test(l)).pop() ?? "";
  const okm = /^OK (\d+) checks/.exec(last), fm = /^FAIL check-[\w-]+: (\d+) of (\d+) checks failed/.exec(last);
  if (okm && r.status === 0) { checks += Number(okm[1]); console.log(`  ${last}`); continue; }
  if (fm) { checks += Number(fm[2]); failed += Number(fm[1]); } else broken++;
  console.log(out.filter((l) => l.startsWith("FAIL")).slice(0, 20).join("\n") || out.slice(-12).join("\n"));
  console.log(`  check-${s}: FAILED${fm ? "" : " (did not finish)"}`);
}
console.log(`tactics: ${checks} checks, ${failed} failed${broken ? `, ${broken} suite(s) did not finish` : ""}`);
process.exit(failed || broken ? 1 : 0);
