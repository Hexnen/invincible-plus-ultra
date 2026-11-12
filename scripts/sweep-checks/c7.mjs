import { readFileSync } from "node:fs";
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.error("FAIL", m); } };
const rd = (f) => readFileSync(new URL("../chargen/steps/" + f, import.meta.url), "utf8");
const review = rd("review.mjs"), powers = rd("powers.mjs"), persona = rd("persona.mjs");

// S026: the lock is raised BEFORE confirmUndo and lowered in a finally (source text: DOM / Foundry code cannot run in node)
const undo = review.slice(review.indexOf("async function doUndo"), review.indexOf("async function doRollAnother"));
ok(undo.indexOf("d.busy = true") !== -1 && undo.indexOf("d.busy = true") < undo.indexOf("await confirmUndo"), "S026 lock raised before confirmUndo");
ok(/finally \{ d\.busy = false; ctx\.app\.setApplying\(false\); \}/.test(undo), "S026 lock lowered in finally");
// logic model: a second click while the first is pending is refused
async function doUndo(d, confirm) { if (d.busy) return "refused"; d.busy = true; try { await confirm(); } finally { d.busy = false; } return "ran"; }
{ const d = {}; let rel; const p1 = doUndo(d, () => new Promise((r) => (rel = r))); const second = await doUndo(d, async () => {}); rel(); await p1;
  ok(second === "refused" && d.busy === false, "S026 model: re-entry refused, lock released"); }

// S027: more-handlers use the same hit() filter as the list
ok(/case "cat-more".*hit\(norm\(d\.q\), p\.name, norm, "power"\)\)\[first\]/.test(powers), "S027 cat-more uses hit");
ok(/case "src-more".*hit\(norm\(d\.sq\), x\.name, norm, "powerSource"\)\)\[first\]/.test(powers), "S027 src-more uses hit");
ok(!/norm\(p\.name\)\.includes\(norm\(d\.q\)\)/.test(powers) && !/norm\(x\.name\)\.includes\(norm\(d\.sq\)\)/.test(powers), "S027 English-only filter gone");
{ // model with a Polish-only match
  const fold = (x) => x.normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/g, "l");
  const norm = (x) => String(x).toLowerCase();
  const pol = { Beam: "Wiązka", Wall: "Ściana" };
  const hit = (q, name) => !q || norm(name).includes(q) || norm(fold(pol[name] ?? name)).includes(q);
  const list = ["Beam", "Wall"], q = "wiaz";
  ok(list.filter((x) => hit(q, x))[0] === "Beam" && list.filter((x) => norm(x).includes(q))[0] === undefined, "S027 model: English-only filter misses the row");
}

// S028: failed list load shows the empty state, retried on next open; rand-boost caught
ok(/function failLists/.test(powers) && /failLists\(d, lk\)/.test(powers), "S028 pick catch fills caches");
ok(/case "rand-boost": \{\s*\n\s*try \{ await randomBoost[^\n]*catch/.test(powers), "S028 rand-boost caught");
ok(/listFailed\?\.has\(lk\)/.test(powers), "S028 retry on reopen");
{
  const d = { boostCache: new Map(), limitCache: new Map() };
  const failLists = (d, key) => { if (!d.boostCache.has(key)) d.boostCache.set(key, []); if (!d.limitCache.has(key)) d.limitCache.set(key, []); (d.listFailed ??= new Set()).add(key); };
  failLists(d, "x");
  ok(d.boostCache.get("x") !== undefined && d.limitCache.get("x") !== undefined, "S028 model: no cache hole (no endless spinner)");
}

// S029: a second mount during the fetch awaits the same promise (behavioural model of the new syncArchetype)
function mk(load) {
  return async function sync(d, name) {
    if (d.archFor === name) return d.archPending ?? false;
    d.archFor = name;
    const run = load(d);
    d.archPending = run;
    try { return await run; } finally { if (d.archPending === run) d.archPending = null; }
  };
}
{
  const sync = mk(async (d) => { await new Promise((r) => setTimeout(r, 5)); d.arr = [1]; return true; });
  const d = {}; const a = sync(d, "A"), b = sync(d, "A");
  ok((await a) === true && (await b) === true, "S029 model: both mounts told to repaint");
  ok((await sync(d, "A")) === false, "S029 model: settled -> no repaint loop");
}
for (const [nm, src] of [["persona", persona], ["powers", powers]]) {
  ok(/return d\.archPending \?\? false;/.test(src) && /d\.archPending = run;/.test(src), `S029 ${nm} shares the in-flight promise`);
}
console.log(`sweep c7: ${n} checks, ${bad} failed`);
process.exit(bad ? 1 : 0);
