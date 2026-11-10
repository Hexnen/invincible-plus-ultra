/* shared helpers of the rules checks (not a test itself). Each check-*.mjs runs on import and ends with done(name). */
let checks = 0, fails = 0, total = 0, totalFails = 0;
export const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log("FAIL", msg); } };
export const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
export const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b} +-${tol}`);
export const throws = (fn, msg) => { let t = false; try { fn(); } catch { t = true; } ok(t, `${msg}: expected a throw`); };
export function done(name) {
  console.log(`${name}: ${checks} checks, ${fails} failed`);
  total += checks; totalFails += fails; checks = 0; fails = 0;
  if (totalFails) process.exitCode = 1;
}
export const summary = () => ({ checks: total, failed: totalFails });
