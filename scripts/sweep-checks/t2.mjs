import fs from "node:fs";
import * as P from "../base/pure.mjs";
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log("FAIL", m); } };
const ev = fs.readFileSync(new URL("../base/tabs/events.mjs", import.meta.url), "utf8");
const bs = fs.readFileSync(new URL("../base/tabs/base.mjs", import.meta.url), "utf8");

// T005: each mode radio has a unique data-fk (source text; DOM not runnable in node)
const line = ev.split("\n").find((l) => l.includes("data-ev-mode") && l.includes('type="radio"'));
ok(line && /data-fk="ev-mode-\$\{m\}"/.test(line), "T005 radios carry data-fk ev-mode-<m>");

// T006: the skip rule of adoptCandidates, replicated from source and run on P
ok(bs.includes("P.formatTeamBase({ base: ctx.B.base })"), "T006 source compares formatted head");
function skips(base, text) {
  const norm = (x) => String(x).replace(/\s+/g, " ").trim();
  const um = /(?:^|;)\s*upgrades\s*:/i.exec(norm(text));
  const heroHead = um ? norm(text).slice(0, um.index).trim() : norm(text);
  return heroHead === norm(P.formatTeamBase({ base }));
}
const old = (base, text) => { const p = P.parseTeamBase(text, []); return p.kind === base.kind && p.where === base.where; };
for (const base of [{ kind: "", where: "Pier 4" }, { kind: "Old mill, east wing", where: "Dock" }, { kind: "Loft", where: "" }, { kind: "Loft", where: "Roof" }]) {
  const text = P.formatTeamBase({ base, upgrades: [] });
  ok(skips(base, text), `T006 own text skipped ${JSON.stringify(base)}`);
  ok(skips(base, text + "; upgrades: Vault"), `T006 own text with upgrades skipped`);
}
ok(old({ kind: "", where: "Pier 4" }, "Pier 4") === false, "T006 old logic wrongly offered (documents the bug)");
ok(!skips({ kind: "Loft", where: "Roof" }, "Loft, Attic"), "T006 real difference still offered");
console.log(`sweep t2: ${n} checks, ${bad} failed`);
process.exit(bad ? 1 : 0);
