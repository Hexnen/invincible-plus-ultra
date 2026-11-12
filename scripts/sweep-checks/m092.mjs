// node scripts/sweep-checks/m092.mjs  (S092: a character tab picked during one turn is not re-applied when the turn comes back to that character later)
import { readFileSync } from "node:fs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const src = readFileSync(new URL("../turn/main.mjs", import.meta.url), "utf8");
const pinLine = src.split("\n").find((l) => l.startsWith("const pinAt ="));
ck("pinAt defined", !!pinLine);
const pinAt = pinLine ? new Function(`return ${pinLine.slice(pinLine.indexOf("=") + 1).replace(/;\s*\/\/.*$/, "").trim()}`)() : () => "";
ck("buildModel drops a pin from another turn", /if \(pinned && \(pinned\.turnKey !== turnKey \|\| pinned\.at !== pinAt\(combat\)\)\) pinned = null;/.test(src));
ck("onPick records the moment", /onPick: \(key\) => \{ pinned = \{ key, turnKey: [^}]*, at: pinAt\(pickCombat\(\)\) \}/.test(src));
ck("stop() clears the pin", /lastKey\.clear\(\); quiet\.clear\(\); pinned = null;/.test(src));
// model of selKey over A's turn (round 1) -> X -> A again (round 2)
let pinned = null;
const sel = (combat, turnKey, rows) => {
  if (pinned && (pinned.turnKey !== turnKey || pinned.at !== pinAt(combat))) pinned = null;
  return pinned && rows.has(pinned.key) ? pinned.key : turnKey && rows.has(turnKey) ? turnKey : [...rows.keys()][0];
};
const rows = new Map([["A", 1], ["B", 1]]);
pinned = { key: "B", turnKey: "A", at: pinAt({ id: "c", round: 1 }) };
ck("same turn: the pick holds", sel({ id: "c", round: 1 }, "A", rows) === "B");
ck("A's next turn opens on A", sel({ id: "c", round: 2 }, "A", rows) === "A");
pinned = { key: "B", turnKey: "A", at: pinAt({ id: "c", round: 1 }) };
ck("another combat opens on A", sel({ id: "d", round: 1 }, "A", rows) === "A");
console.log(`sweep m092: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
