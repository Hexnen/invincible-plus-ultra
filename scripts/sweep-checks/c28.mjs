import { readFileSync } from "node:fs";
import { tallyAdd } from "../tactics/ui/feedback-pure.mjs";
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.error("FAIL", m); } };
// S084 (source text: dock.mjs needs the DOM): the More button's attrs must not sit behind a // comment
const src = readFileSync(new URL("../tactics/ui/dock.mjs", import.meta.url), "utf8");
const line = src.split("\n").find((l) => l.includes("itd-ic-more"));
ok(!!line, "more-button line found");
const ci = line.indexOf("//"), ai = line.indexOf('"aria-haspopup"');
ok(ai >= 0 && (ci < 0 || ci > ai), "aria-haspopup is not inside a // comment");
// S085: the fight tag survives adding an entry
const act = (id, t = "a") => ({ id, kind: "action", round: 1, actor: "x", rows: [{ target: t, hit: true }] });
let t = tallyAdd(null, "c1", [act("n1_F1")]);
ok(t.fight === "F1", "first add tagged");
t = tallyAdd(t, "c1", [act("n1_F1"), act("n2_F1")]);
ok(t.fight === "F1", "tag kept after adding a further entry");
const t2 = tallyAdd(t, "c1", [act("n1_F2")]);
ok(t2.fight === "F2" && Object.keys(t2.entries).length === 1, "new fight tag starts a fresh tally");
console.log(`sweep c28: ${n} checks, ${bad} failed`);
process.exit(bad ? 1 : 0);
