import { readFileSync } from "node:fs";
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.error("FAIL", m); } };
const src = readFileSync(new URL("../challenges/hud.mjs", import.meta.url), "utf8");
ok(/card\.paintTok = \(card\.paintTok \|\| 0\) \+ 1/.test(src), "paint bumps token");
ok(/const apply = \(\) => \{\s*\n\s*if \(card\.paintTok !== tok\) return;/.test(src), "apply guarded by token");
// logic model: deferred first apply must not overwrite a newer immediate apply
function paint(card, v, first, raf) {
  const tok = card.paintTok = (card.paintTok || 0) + 1;
  const apply = () => { if (card.paintTok !== tok) return; card.v = v; };
  if (first) raf.push(apply); else apply();
}
const card = {}, raf = [];
paint(card, 1, true, raf); paint(card, 2, false, raf); raf.forEach((f) => f());
ok(card.v === 2, "stale deferred apply skipped");
const c2 = {}, r2 = []; paint(c2, 5, true, r2); r2.forEach((f) => f());
ok(c2.v === 5, "lone first paint still lands");
console.log(`sweep c4: ${n} checks, ${bad} failed`);
process.exit(bad ? 1 : 0);
