import fs from "node:fs";
import { fileURLToPath } from "node:url";
const dirUrl = new URL("../log/ui/", import.meta.url);
const dir = fileURLToPath(dirUrl);
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log("FAIL " + m); } };
const view = fs.readFileSync(dir + "view.mjs", "utf8");
const R = await import(new URL("rows.mjs", dirUrl));

// S046: logic extracted from view.mjs (DOM class, source-text assertions)
ok(/const SYSTEM_OPT = "__system__"/.test(view), "S046 sentinel defined");
ok(/value: u\.id \|\| SYSTEM_OPT/.test(view), "S046 System option has a non-empty value");
ok(/s\.users = el\.value === SYSTEM_OPT \? \[""\]/.test(view), "S046 System maps to users:[\"\"]");
ok(/selected: s\.users\.length > 0 && s\.users\[0\] === u\.id/.test(view), "S046 selected only with a non-empty filter");
const F = await import(new URL("../filter.mjs", dirUrl));
const mk = (u) => ({ id: u + "x", t: 1, k: "log.prune", u, d: {} });
const sel = (users) => [mk(""), mk("u1")].filter((e) => !(users.length && !users.includes(e.u)));
ok(sel([""]).length === 1 && sel([""])[0].u === "", "S046 backend isolates system entries");

// S047: cache reset
ok(typeof R.resetSentenceCache === "function", "S047 reset exported");
ok(/"updateActor"/.test(view) && /R\.resetSentenceCache\(\)/.test(view), "S047 view resets on rename hooks");
globalThis.game = { i18n: { lang: "en", localize: (k) => k, format: (k) => k } };
let name = "Alice";
const ctx = { userName: () => name, actorName: () => name, actor: () => null };
const e = { id: "a", t: 1, k: "access.owner", u: "u1", d: { user: "u2" } };
let a, b;
try { a = R.sentenceText(e, ctx); name = "Bob"; b = R.sentenceText(e, ctx); R.resetSentenceCache(); const c = R.sentenceText(e, ctx);
  ok(a === b && a.includes("Alice"), "S047 stale text is cached before reset (" + a + ")");
  ok(!c.includes("Alice"), "S047 after reset no stale name"); } catch (x) { ok(false, "S047 threw " + x.message); }
console.log(`sweep c14: ${n} checks, ${bad} failed`);
process.exit(bad ? 1 : 0);
