// node scripts/tactics/check-all.mjs -- runs every check of tactical combat (exit code 1 on any failure) and adds up the counts.
// Each suite runs in its own node process: two of them (check-facing, check-executor) install a fake Foundry in globalThis and the
// Foundry-facing modules keep per-process state, so they cannot share one.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const SUITES = ["pure", "chase", "state", "ledger", "initiative", "scheduler", "ops", "source", "journal", "engine", "view", "relay", "desk", "ui", "zones", "move", "p7", "defects", "defects4", "defects5", "defects6", "defects7", "defects8", "fight", "attacks", "acts", "hazards", "kit", "int", "lang", "glossary", "names", "u4", "u8", "u10", "u11", "u13", "u14", "u17", "u19", "u20", "board", "facing", "executor", "cam", "fxc", "fxd", "hunt2", "fxf", "fxg", "perf", "fxh", "fxi", "fxj", "hunt3", "rlabel", "fxl", "odds", "fxm", "slots", "uxa", "uxc", "uxb", "seam", "bh4", "fxo", "fxn", "sweep", "perf4", "fxp", "fxr", "fxt", "fxu", "fxv", "fxx", "ansc", "ansa", "ansb", "anse", "ansel", "pwb", "pwd", "pwc", "pwa", "fxa2", "ansd", "pwe", "pfa", "ansf", "ansg", "ansh", "ansi", "fxc2", "fxu3", "fxe3", "fxg2", "fxl2", "fxj2", "fxk2", "tacb", "fxo2", "stat", "awrd", "rld", "fxp2",      // BH4: bug hunt 4 (check-bh4.mjs); SEAM: where the UX packages meet (check-seam.mjs)
  "../check-kit", "../check-marks"];      // U79: the shared kit's own checks (scripts/check-kit.mjs) run with the suite: a kit change that breaks a surface fails here too
let checks = 0, failed = 0, broken = 0;
for (const s of SUITES) {
  const r = spawnSync(process.execPath, [s.startsWith("../") ? join(dir, "..", `${s.slice(3)}.mjs`) : join(dir, `check-${s}.mjs`)], { encoding: "utf8" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split(/\r?\n/);
  const last = out.filter((l) => /^(OK \d+ checks|FAIL (check-|\d+ of \d+))/.test(l)).pop() ?? "";
  const okm = /^OK (\d+) checks/.exec(last), fm = /^FAIL check-[\w-]+: (\d+) of (\d+) checks failed/.exec(last) ?? /^FAIL (\d+) of (\d+)/.exec(last);
  if (okm && r.status === 0) { checks += Number(okm[1]); console.log(`  ${last}`); continue; }
  if (fm) { checks += Number(fm[2]); failed += Number(fm[1]); } else broken++;
  console.log(out.filter((l) => l.startsWith("FAIL")).slice(0, 20).join("\n") || out.slice(-12).join("\n"));
  console.log(`  check-${s}: FAILED${fm ? "" : " (did not finish)"}`);
}
console.log(`tactics: ${checks} checks, ${failed} failed${broken ? `, ${broken} suite(s) did not finish` : ""}`);
process.exit(failed || broken ? 1 : 0);
