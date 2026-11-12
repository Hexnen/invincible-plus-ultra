import { readFileSync } from "node:fs";
import { normalizeEntry, pageWith, emptyPage } from "../log/model.mjs";
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.error("FAIL", m); } };
// S044: object-valued `more` survives fit()
const nm = (p) => `Item number ${p} with a rather long descriptive name to bloat the entry size ......`;
const add = Array.from({ length: 40 }, (_, i) => ({ t: "power", n: nm(i) }));
const del = Array.from({ length: 40 }, (_, i) => ({ t: "power", n: nm(i + 99) }));
const fields = Array.from({ length: 30 }, (_, i) => "system.some.path." + i);
const e = normalizeEntry({ t: 1700000000000, u: "u1", k: "chargen.apply", d: { runId: "r", mode: "manual", add, del, more: { add: 3, del: 0 }, fields } }, { actorId: "a1", path: "r", now: 1700000000000 });
ok(e && typeof e.d.more === "object", "more stays an object");
ok(e && e.d.more.add >= 3 && Number.isInteger(e.d.more.add) && Number.isInteger(e.d.more.del), "more counts are integers");
ok(e && e.d.add.length + e.d.more.add === 43, "add shown + more.add still totals 43");
ok(e && e.d.del.length + e.d.more.del === 40, "del shown + more.del still totals 40");
// numeric more unchanged
const e2 = normalizeEntry({ t: 1, u: "u", k: "log.gap", d: { changes: Array.from({ length: 400 }, (_, i) => ({ n: nm(i) })) } }, { now: 1 });
ok(typeof e2.d.more === "number", "numeric more still numeric");
// S045: fallback recomputes page stats (logic) and source writes first/last/bytes
const other = pageWith(emptyPage(1), { id: "x1", t: 100, k: "a", u: "", d: {} });
let m = other;
const mine = { id: "y1", t: 500, k: "a", u: "", d: { s: "abc" } };
m = pageWith(m, mine);
ok(m.n === 2 && m.first === 100 && m.last === 500 && m.bytes > other.bytes, "pageWith merge keeps first/last/bytes");
const src = readFileSync(new URL("../log/store.mjs", import.meta.url), "utf8");
const seg = src.slice(src.indexOf("the other scribe tab created the page first"));
ok(/pageWith\(merged/.test(seg) && /log\.first`\]: merged\.first/.test(seg) && /log\.bytes`\]: merged\.bytes/.test(seg), "fallback writes first/last/bytes from merged page");
ok(!/log\.n`\]: c\.flags/.test(seg), "fallback no longer overwrites n with batch count");
console.log(`sweep c13: ${n} checks, ${bad} failed`);
process.exit(bad ? 1 : 0);
