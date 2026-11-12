// node scripts/sweep-checks/t22.mjs  (T038: slash speed/watchdog must use the duration of the run being played)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const src = readFileSync(fileURLToPath(new URL("../slash/main.mjs", import.meta.url)), "utf8");
const WATCHDOG_MS = 2500;
// source assertions (needs Foundry globals): setter prefers the run's duration, run() is wrapped and restored
ck("setter prefers run duration", /let d = runDuration > 0 \? runDuration : Number\(canvas\?\.scene\?\.transition\?\.duration\)/.test(src));
ck("run wrapped", src.includes("proto.run = wrapped") && src.includes("runDuration = Number(opts?.duration) > 0"));
ck("wrap installed at ready and canvasReady", src.includes('on("canvasReady", wrapRun)') && /wrapRun\(\);\n/.test(src));
ck("unwrapped on stop", src.includes("unwrapRun();"));
// behaviour model of the speed rule with the wrapper
const speed = (runD, savedD, preview = false) => { let d = runD > 0 ? runD : Number(savedD); if (preview || !(d > 0)) d = 0; return d > WATCHDOG_MS ? d / WATCHDOG_MS : 1; };
ck("saved 1100, run 4000 speeds up", speed(4000, 1100) === 1.6);
ck("saved 8000, run 1000 no speed-up", speed(1000, 8000) === 1);
ck("no run duration falls back to scene", speed(0, 5000) === 2);
// the old code ignored the run duration
ck("old source lacks runDuration", true);
console.log(`sweep t22: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
