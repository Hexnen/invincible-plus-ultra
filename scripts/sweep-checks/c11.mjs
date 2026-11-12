import { readFileSync } from "node:fs";
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.error("FAIL", m); } };
const src = readFileSync(new URL("../fontoption.mjs", import.meta.url), "utf8");
// fontoption needs DOM/Foundry globals, so assert on the source text of the fix
ok(/coverageCache\.delete\(found\.url\);[^\n]*\n\s*return null;/.test(src), "failed coverage read drops its cache entry");
ok(/onChange: \(\) => \{ probeCache = null; coverageCache\.clear\(\);/.test(src), "setting change clears coverage cache");

// logic model of the cache with the fix: failure is retried, then succeeds
const cache = new Map();
let fileOk = false;
const measure = (url) => {
  if (!cache.has(url)) cache.set(url, (async () => {
    await null;
    if (!fileOk) { cache.delete(url); return null; }
    return { missing: [] };
  })());
  return cache.get(url);
};
ok(await measure("u") === null, "first read fails");
fileOk = true;
ok((await measure("u"))?.missing, "retry after fixing the file succeeds");
console.log(`sweep c11: ${n} checks, ${bad} failed`);
process.exit(bad ? 1 : 0);
