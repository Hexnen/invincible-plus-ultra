import { readFileSync } from "node:fs";
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log("FAIL", m); } };
const src = readFileSync(new URL("../tokenhalo/halo.mjs", import.meta.url), "utf8");
const m = src.match(/function evict\([^)]*\) \{[\s\S]*?\n\}\n/);
ok(!!m, "evict found");
const MAX_KEYS = 40;
const run = () => {
  const cache = new Map(); const dropped = [];
  const dropTextures = (r) => dropped.push(r);
  for (let i = 0; i < 40; i++) cache.set("k" + i, { refs: 1 });
  const fresh = { refs: 0 }; cache.set("new", fresh);
  const evict = new Function("cache", "MAX_KEYS", "dropTextures", m[0] + "; return evict;")(cache, MAX_KEYS, dropTextures);
  return { cache, dropped, fresh, evict };
};
const t = run();
t.evict("new");
ok(!t.dropped.includes(t.fresh) && t.cache.get("new") === t.fresh, "fresh record survives eviction when all others are referenced");
ok(/evict\(key\)/.test(src), "bake passes its key to evict");
// old behaviour (no keep arg) would drop it
const t2 = run(); t2.evict();
ok(t2.dropped.includes(t2.fresh), "without keep the fresh record is dropped (documents the old bug)");
// unreferenced old entries are still evicted
const c = new Map(); for (let i = 0; i < 41; i++) c.set("k" + i, { refs: 0 });
const d = []; new Function("cache", "MAX_KEYS", "dropTextures", m[0] + "; return evict;")(c, 40, (r) => d.push(r))("k40");
ok(c.size === 40 && c.has("k40") && !c.has("k0"), "oldest unreferenced still evicted");
console.log(`sweep c30: ${n} checks, ${bad} failed`);
process.exit(bad ? 1 : 0);
