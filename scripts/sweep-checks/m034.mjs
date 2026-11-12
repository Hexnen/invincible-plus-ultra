// node scripts/sweep-checks/m034.mjs  (S034: the start banner counts only combatants this client may see; S035: a scene-less combat's end banner
// does not depend on game.combat still pointing at the deleted combat)
import { readFileSync } from "node:fs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
globalThis.game = { user: { isGM: false } };
const Bar = await import("../combat/bar.mjs");
const src = readFileSync(new URL("../combat/main.mjs", import.meta.url), "utf8");
const bar = readFileSync(new URL("../combat/bar.mjs", import.meta.url), "utf8");
// S034
ck("bar exports seen()", typeof Bar.seen === "function");
const seen = Bar.seen ?? ((c) => !!c);
const cs = [{ visible: true, token: {} }, { visible: true, token: {} }, { visible: true, token: {} }, { visible: false, token: { hidden: true } }, { visible: false, token: { hidden: true } }];
ck("player sees 3 of 5 (2 hidden ambushers)", cs.filter((c) => seen(c)).length === 3);
ck("secret token not counted", !seen({ visible: true, token: { isSecret: true } }));
game.user.isGM = true;
ck("GM counts all", cs.filter((c) => seen(c)).length === 5);
game.user.isGM = false;
ck("start banner count filtered by seen", /kind: "start", round: to, count: combat\.combatants\?\.filter\?\.\(\(c\) => Bar\.seen\(c\)\)\.length/.test(src) && !/count: combat\.combatants\?\.size/.test(src));
ck("bar tiles use the same rule", /if \(!seen\(c\)\) return null;/.test(bar));
// S035
const del = src.slice(src.indexOf("function onDeleteCombat"), src.indexOf("function on(name, fn)"));
ck("deleteCombat falls back to the remembered relevance of a scene-less combat", /\(relevant\(combat\) \|\| was\)/.test(del) && /const was = !combat\.scene && heard\.delete\(combat\.id\)/.test(del));
ck("relevance remembered on the round change", /if \(!combat\.scene\) \{ if \(relevant\(combat\)\) heard\.add\(combat\.id\); else heard\.delete\(combat\.id\); \}/.test(src));
// model of the hook order: collection.delete -> _onDelete (tracker may switch game.combat) -> deleteCombat
const model = (fixed) => { const heard = new Set(["c1"]); let gameCombat = "c1"; const relevant = (id) => gameCombat === id; gameCombat = "c2"; const was = heard.delete("c1"); return fixed ? relevant("c1") || was : relevant("c1"); };
ck("model: old rule drops the end banner", model(false) === false);
ck("model: fixed rule shows it", model(true) === true);
console.log(`sweep m034: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
