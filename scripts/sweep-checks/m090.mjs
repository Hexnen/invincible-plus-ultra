// node scripts/sweep-checks/m090.mjs  (S090: a calm hover / select ring fades out on leave even when the ticker had stopped after its pop-in)
import { readFileSync } from "node:fs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const src = readFileSync(new URL("../tokenhalo/halo.mjs", import.meta.url), "utf8");
const pick = (start) => { const i = src.indexOf(start); return i < 0 ? "" : src.slice(i, src.indexOf("\n}\n", i) + 2); };
const leaveSrc = pick("function leave(h, token) {");
const startSrc = src.split("\n").find((l) => l.startsWith("function startTicker()"));
ck("leave found", !!leaveSrc && !!startSrc);
// run leave() with the ticker stopped (static calm ring after ~190 ms)
const run = () => {
  const env = { tickerOn: false, destroyed: 0, added: 0 };
  const fn = new Function("env", `
    let tickerOn = env.tickerOn;
    const canvas = { app: { ticker: { add() { env.added++; } } } };
    const tick = () => {};
    const nowMs = () => 1000;
    const restoreCore = () => {};
    const destroyRecord = () => { env.destroyed++; };
    ${startSrc}
    ${leaveSrc}
    const h = { motion: true, leaving: false };
    leave(h, {});
    env.h = h; env.tickerOn = tickerOn;`);
  fn(env);
  return env;
};
const e = run();
ck("not destroyed at once", e.destroyed === 0);
ck("marked leaving (fade-out plays)", e.h.leaving === true && e.h.leaveAt === 1000);
ck("ticker started for the fade", e.tickerOn === true && e.added === 1);
// motion off: still removed at once
const offSrc = leaveSrc;
const env2 = { destroyed: 0 };
new Function("env", `let tickerOn = false; const canvas = { app: { ticker: { add() {} } } }; const tick = () => {}; const nowMs = () => 0; const restoreCore = () => {}; const destroyRecord = () => { env.destroyed++; }; ${startSrc} ${offSrc} leave({ motion: false }, {});`)(env2);
ck("motion off: removed at once", env2.destroyed === 1);
console.log(`sweep m090: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
