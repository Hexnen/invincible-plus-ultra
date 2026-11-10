/* shared helpers of the tactics node checks (not a test itself). Each check-*.mjs runs on import and ends with done(name): "OK <n> checks". */
let checks = 0, fails = 0, total = 0, totalFails = 0;
export const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log("FAIL", msg); } };
export const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
export function done(name) {
  console.log(fails ? `FAIL ${name}: ${fails} of ${checks} checks failed` : `OK ${checks} checks (${name})`);
  total += checks; totalFails += fails; checks = 0; fails = 0;
  if (totalFails) process.exitCode = 1;
}
export const summary = () => ({ checks: total, failed: totalFails });
