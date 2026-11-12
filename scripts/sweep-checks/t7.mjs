// node scripts/sweep-checks/t7.mjs  (T014 forced concept reroll with touched; T015 no-change identity)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const src = readFileSync(fileURLToPath(new URL("../chargen/reroll.mjs", import.meta.url)), "utf8");
// code needs the real provider (only inside check-rules), so assert on the source of the fix and model the logic
const cascade = src.slice(src.indexOf('step === "concept" && o.withinArchetype'), src.indexOf("} else if ((step"));
ck("T014 cascade drops touched.concept before rollAll", /delete free\.concept/.test(cascade) && /rollAll\(patch\(state, \{ locks: hold, touched: free \}\)/.test(cascade));
const attr = src.slice(src.indexOf("attributes edited by hand"), src.indexOf("} else next = await rollStep"));
ck("T015 returns original state when rollStep rolled nothing", /rolled === held \? state/.test(attr));
// model: rollAll freezes touched steps; rollStep returns its input when every field is frozen
const frozenAll = (touched) => !!touched.concept;
ck("model T014: old call was a no-op", frozenAll({ concept: true }) === true);
const free = { concept: true, powers: true }; delete free.concept;
ck("model T014: new call rolls, other touched stay", frozenAll(free) === false && free.powers === true);
const state = { locks: {} }, patch = (s, p) => ({ ...s, ...p });
const held = patch(state, { locks: { attrs: true } }), rolled = held;
ck("model T015: old code broke identity", patch(rolled, { locks: state.locks }) !== state);
ck("model T015: new code keeps identity", (rolled === held ? state : patch(rolled, {})) === state);
console.log(`sweep t7: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
