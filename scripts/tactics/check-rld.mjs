/* node scripts/tactics/check-rld.mjs -- RLD: a reload in a fight. The files of the tactical surfaces (ui/prompts.mjs, ui/main.mjs) are
   fetched and evaluated from init on (main.mjs preload), and started at ready as before. That is only safe while loading them does
   nothing but define: no hook, no listener, no timer, no read of game / canvas / ui / document / window at load. This suite loads both
   files (and everything they import) with every one of those watched, and pins how main.mjs uses the early load. */
import { readFileSync } from "node:fs";
import { ok, done } from "./testkit.mjs";

const touched = [];
const watch = (name) => Object.defineProperty(globalThis, name, { configurable: true, get() { touched.push(name); return undefined; } });
for (const g of ["game", "canvas", "ui", "document", "window", "CONFIG", "foundry"]) if (!(g in globalThis)) watch(g);
const hooked = [];
globalThis.Hooks = { on: (h) => { hooked.push(h); return 0; }, once: (h) => { hooked.push(h); return 0; }, off: () => {}, callAll: () => {}, call: () => true };
const timers = [];
const realST = globalThis.setTimeout, realSI = globalThis.setInterval;
globalThis.setTimeout = (...a) => { timers.push("setTimeout"); return realST(...a); };
globalThis.setInterval = (...a) => { timers.push("setInterval"); return realSI(...a); };
let loaded = true;
try { await import("./ui/prompts.mjs"); await import("./ui/main.mjs"); } catch (e) { loaded = false; console.log("load error", e); }
globalThis.setTimeout = realST; globalThis.setInterval = realSI;
ok(loaded, "RLD: ui/prompts.mjs and ui/main.mjs load outside a Foundry page");
ok(hooked.length === 0, `RLD: loading the surfaces registers no hook (got ${hooked.join(", ") || "none"})`);
ok(timers.length === 0, `RLD: loading the surfaces starts no timer (got ${timers.join(", ") || "none"})`);
ok(touched.length === 0, `RLD: loading the surfaces reads no Foundry or page global (got ${[...new Set(touched)].join(", ") || "none"})`);

const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
ok(/if \(!why && typeof document !== "undefined"\) preload\(\);/.test(main), "RLD: the early load runs at init, only where tactical combat runs and on a page");
ok(/early \?\?= \{ prompts: import\("\.\/ui\/prompts\.mjs"\)\.catch\(\(\) => import\("\.\/ui\/prompts\.mjs"\)\), ui: import\("\.\/ui\/main\.mjs"\)\.catch\(\(\) => surfacesFile\(\)\) \}/.test(main), "RLD: a failed early fetch is asked again");
ok(/await \(early\?\.prompts \?\? import\("\.\/ui\/prompts\.mjs"\)\)/.test(main) && /await \(early\?\.ui \?\? surfacesFile\(\)\); if \(UI\.start\(\)\)/.test(main), "RLD: startRunning (ready) still starts the prompts and the surfaces, from the early load when there is one");
ok(/setTimeout\(r, 1500\)\)\.then\(\(\) => import\(`\.\/ui\/main\.mjs\?retry=/.test(main), "the surfaces keep their one retry after a pause");
done("rld");
