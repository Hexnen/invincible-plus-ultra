// node scripts/sweep-checks/d215.mjs  (D215: the token halo's baked textures must not keep their 8x multisample buffers, and the cache of
// unused rings is held to a GPU byte budget)
import { readFileSync } from "node:fs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const src = readFileSync(new URL("../tokenhalo/halo.mjs", import.meta.url), "utf8");
const pick = (start) => { const i = src.indexOf(start); return i < 0 ? "" : src.slice(i, src.indexOf("\n}\n", i) + 2); };

// 1. bake: every generateTexture result goes through flatten (the multisampled texture never reaches the cache)
const bakeSrc = pick("function bake(");
const gens = bakeSrc.match(/r\.generateTexture\(/g) ?? [];
const flat = bakeSrc.match(/flatten\(r, r\.generateTexture\(/g) ?? [];
ck("bake found", !!bakeSrc);
ck("every bake output is flattened", gens.length === 2 && flat.length === 2);
ck("bake still draws with multisample (the look)", /multisample: PIXI\.MSAA_QUALITY\?\.HIGH/.test(bakeSrc));
ck("bake trims after evict", /evict\(key\);\s*\n\s*trim\(key\);/.test(bakeSrc));

// 2. flatten: copies into a plain render texture (no multisample) of the same size and resolution, destroys the multisampled one
const flatSrc = pick("function flatten(");
ck("flatten found", !!flatSrc);
const made = [], destroyed = [];
class RT { constructor(o) { Object.assign(this, o); made.push(this); } destroy(b) { destroyed.push([this, b]); } static create(o) { return new RT(o); } }
const PIXI = { RenderTexture: RT, SCALE_MODES: { LINEAR: 1 }, Sprite: class { constructor(t) { this.texture = t; } destroy() { this.gone = true; } } };
const renders = [];
const r = { render: (spr, o) => renders.push({ spr, o }) };
const flatten = new Function("PIXI", flatSrc + "; return flatten;")(PIXI);
const msaa = { width: 800, height: 800, resolution: 2, multisample: 8, destroy(b) { destroyed.push([this, b]); } };
const out = flatten(r, msaa);
ck("plain texture: same size and resolution", out.width === 800 && out.height === 800 && out.resolution === 2);
ck("plain texture: no multisample asked", out.multisample === undefined);
ck("copied once into the plain texture, cleared", renders.length === 1 && renders[0].o.renderTexture === out && renders[0].o.clear === true && renders[0].spr.texture === msaa);
ck("the multisampled texture is destroyed with its base", destroyed.some(([t, b]) => t === msaa && b === true));
ck("the copy sprite is destroyed", renders[0].spr.gone === true);
// a failing render still frees the multisampled texture
destroyed.length = 0;
try { flatten({ render() { throw new Error("x"); } }, msaa); } catch { /* expected */ }
ck("a failed copy still frees the multisampled texture", destroyed.some(([t]) => t === msaa));

// 3. trim: oldest unused rings go until the cache fits CACHE_BYTES; rings in use and the one just baked stay
const trimSrc = pick("function trim(");
ck("trim found", !!trimSrc);
const runTrim = (entries, budget, keep) => {
  const cache = new Map(entries), dropped = [];
  new Function("cache", "CACHE_BYTES", "dropTextures", trimSrc + "; return trim;")(cache, budget, (rec) => dropped.push(rec))(keep);
  return { cache, dropped };
};
const MB = 1048576;
let t = runTrim([["a", { refs: 0, bytes: 20 * MB }], ["b", { refs: 1, bytes: 20 * MB }], ["c", { refs: 0, bytes: 20 * MB }], ["d", { refs: 0, bytes: 20 * MB }]], 45 * MB, "d");
ck("over budget: oldest unused dropped first, in-use kept", !t.cache.has("a") && t.cache.has("b") && !t.cache.has("c") && t.cache.has("d") && t.dropped.length === 2);
t = runTrim([["a", { refs: 0, bytes: 10 * MB }], ["b", { refs: 0, bytes: 10 * MB }]], 45 * MB, "b");
ck("under budget: nothing dropped", t.cache.size === 2 && t.dropped.length === 0);
t = runTrim([["a", { refs: 2, bytes: 100 * MB }], ["k", { refs: 0, bytes: 100 * MB }]], 45 * MB, "k");
ck("only in-use + the fresh one: both stay even over budget", t.cache.size === 2 && t.dropped.length === 0);
const cb = /const CACHE_BYTES = (\d+) \* 1024 \* 1024;/.exec(src);
ck("byte budget set (64-512 MB)", !!cb && +cb[1] >= 64 && +cb[1] <= 512);

console.log(`sweep d215: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
