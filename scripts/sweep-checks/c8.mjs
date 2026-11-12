import { readFileSync } from "node:fs";
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.error("FAIL", m); } };
const src = readFileSync(new URL("../chargen/steps/talents.mjs", import.meta.url), "utf8");
// source assertions (the step needs Foundry globals, so it cannot run in node)
ok(/case "tal-more":[^\n]*hit\(nm\(d\.tq\), x\.name, nm, "talent"\)\)\[first\]/.test(src), "tal-more refocus uses hit()");
ok(/case "dr-more":[^\n]*hit\(nm\(d\.dq\), x\.name, nm, "drawback"\)\)\[first\]/.test(src), "dr-more refocus uses hit()");
ok(!/case "(tal|dr)-more":[^\n]*nm\(x\.name\)\.includes/.test(src), "no English-only filter left in handlers");
// logic model: Polish-only query must pick the same list as the render
const pl = { Strong: "Silny", Fast: "Szybki" };
const nm = (s) => String(s ?? "").toLowerCase();
const hit = (q, name, norm) => !q || norm(name).includes(q) || norm(pl[name] ?? name).includes(q);
const list = [{ name: "Strong" }, { name: "Fast" }];
const q = nm("szyb");
ok(list.filter((x) => hit(q, x.name, nm))[0]?.name === "Fast", "new filter finds Polish-only match");
ok(list.filter((x) => !q || nm(x.name).includes(q))[0] === undefined, "old filter found nothing");
console.log(`sweep c8: ${n} checks, ${bad} failed`);
process.exit(bad ? 1 : 0);
