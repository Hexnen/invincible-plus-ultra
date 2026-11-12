import { readFileSync } from "node:fs";
import { sortedList } from "../base/pure.mjs";
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.error("FAIL " + m); } };
// S008
const l = sortedList({ A: { id: "B", sort: 1 }, B: { sort: 2 } });
ok(l[0].id === "A" && l[1].id === "B", "S008 map key wins over stored id");
// S006 (source assertions; DOM not available in node)
const src = readFileSync(new URL("../base/sheet.mjs", import.meta.url), "utf8");
ok(/_onClose\([^)]*\)\s*\{[^}]*#sizeObs\?\.disconnect\(\)/.test(src), "S006 observer disconnected on close");
ok(/_onRender[\s\S]{0,300}this\.#watchSize\(\)/.test(src), "S006 observer re-attached per render");
ok((src.match(/new ResizeObserver/g) || []).length === 1 && !/#bind\(\) \{[\s\S]*new ResizeObserver[\s\S]*#bindDrop/.test(src), "S006 observer no longer created once inside #bind");
console.log(`sweep c1: ${n} checks, ${bad} failed`);
process.exit(bad ? 1 : 0);
