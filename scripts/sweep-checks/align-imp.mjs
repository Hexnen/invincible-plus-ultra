/* ALIGN (engine 1.9.1, contract v11): both callers now hand the impact its BLOW instant (`blowAt`, the word's contact) instead of a
   start they computed themselves; the engine starts the impact `plan.peakMs` earlier (impact/index.mjs play: startAt wins, else
   blowAt - peakMs). The checks that read a played spec's start or peak read them through these, with the engine's own plan, so they keep
   measuring the same thing (when the impact starts, when its strongest drawing shows), whichever way the caller gave the time.
   effective(spec) = the strength the engine draws (magnitude + the series boost, = planImpact(spec).magnitude). Run alone it checks
   itself and the token side's series (withSeries). */
import { planImpact } from "../letters/impact/plan.mjs";

const full = (spec) => planImpact({ ...spec, reduced: false });
/** this page's instant the impact starts (its first drawing) */
export const impStart = (spec) => (Number.isFinite(spec?.startAt) ? spec.startAt : Number.isFinite(spec?.blowAt) ? spec.blowAt - full(spec).peakMs : NaN);
/** this page's instant of its strongest drawing (the blow) */
export const impBlow = (spec) => (Number.isFinite(spec?.startAt) ? spec.startAt + full(spec).peakMs : Number.isFinite(spec?.blowAt) ? spec.blowAt : NaN);
/** the strength drawn */
export const effective = (spec) => full(spec).magnitude;

/* run alone (the sweep runner runs every file here): the helpers agree with the engine's own player rule */
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let n = 0, f = 0;
  const ck = (c, m) => { n++; if (!c) { f++; console.log("FAIL " + m); } };
  const sp = { kind: "crit", magnitude: 1.7, seed: "a" }, pk = planImpact(sp).peakMs;
  ck(pk > 0, `a critical has a lead-in before its blow (${pk} ms)`);
  ck(impStart({ ...sp, blowAt: 1000 }) === 1000 - pk && impBlow({ ...sp, blowAt: 1000 }) === 1000, "blowAt: the start is peakMs before the blow");
  ck(impStart({ ...sp, startAt: 500, blowAt: 1000 }) === 500, "startAt wins when both are given (as the engine)");
  ck(effective({ kind: "hit", magnitude: 0.45, series: 2 }) === 0.75, "the strength drawn includes the series boost");
  /* the token side's series (tokenreact/pure.mjs withSeries): the engine's boost grows a blow INSIDE its rung, never into the next strength */
  const P = await import("../tokenreact/pure.mjs");
  const { stepOf } = await import("../letters/impact/plan.mjs").then((m) => ({ stepOf: (x) => planImpact({ kind: "hit", magnitude: x }).step }));
  for (const [r, R] of P.RUNGS.entries()) {
    let last = -1, okIn = true, okUp = true;
    for (let k = 0; k <= 4; k++) {
      const sp = P.withSeries({ ...R }, k), e = effective(sp);
      if (stepOf(e) !== stepOf(R.magnitude) || e > P.IMPACT_TOP + 1e-9 || e < R.magnitude - 1e-9 || sp.magnitude < 0) okIn = false;
      if (e < last - 1e-9) okUp = false;
      last = e;
      if (k && !(sp.series >= 1 && sp.series <= k)) okIn = false;      // a weak rung may carry fewer places (no negative strength passed)
      if (Math.abs(P.effectiveMagnitude(sp) - e) > 0.011) okIn = false;
    }
    ck(okIn, `rung ${r} (${R.kind} ${R.magnitude}): every place of a series stays in the rung's strength, under IMPACT_TOP`);
    ck(okUp, `rung ${r}: a later place is never drawn weaker`);
  }
  ck(effective(P.withSeries({ kind: "hit", magnitude: 0.6 }, 1)) > 0.6, "a second blow on the same rung is drawn harder (the series grows inside the rung)");
  ck(P.withSeries({ kind: "hit", magnitude: 0.6 }, 0).series === undefined, "the first blow carries no series");
  console.log(`sweep align-imp: ${n} checks, ${f} failed`);
  process.exit(f ? 1 : 0);
}
