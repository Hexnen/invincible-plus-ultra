// node scripts/rules/check-dice.mjs -- dice, pushing, opposed rolls, odds (no Foundry).
import * as D from "./dice.mjs";
import { ok, eq, near, throws, done } from "./testkit.mjs";

// pool never below one die (book 2235)
eq(D.poolSize(0), 1, "pool floor 0");
eq(D.poolSize(-4), 1, "pool floor negative");
eq(D.poolSize(5.9), 5, "pool floors fractions");
eq(D.poolSize(NaN), 1, "pool NaN");
eq(D.buildPool(6, [{ source: "crit", dice: -2 }, { source: "help", dice: 3 }, null, { source: "x", dice: 0 }]).dice, 7, "buildPool sums modifiers");
eq(D.buildPool(2, [{ source: "min range", dice: -3 }]).dice, 1, "buildPool keeps one die");
eq(D.buildPool(2, [{ source: "min range", dice: -3 }]).total, -1, "buildPool reports the raw total");

// tally and push (book 2224)
eq(D.tally([6, 6, 1, 3, 4]), { size: 5, sixes: 2, ones: 1 }, "tally");
eq(D.rerollable([6, 1, 2, 5, 6, 3]), [2, 3, 5], "rerollable skips 6 and 1");
{
  const p = D.applyPush([6, 1, 2, 5], [1, 6]);
  eq(p.dice, [6, 1, 1, 6], "push replaces only re-rollable dice");
  eq([p.sixes, p.ones, p.stress], [2, 2, 2], "push: every 1 showing costs stress");
  eq(D.applyPush([6, 1, 2, 5], [1, 6], { stressOnes: "new" }).stress, 1, "push: optional new-ones-only count");
  // book 2528 example: two 6s and no 1, push gives one more 6 and one 1 = 1 stress
  eq(D.applyPush([6, 6, 2, 3, 4], [6, 1, 3]).stress, 1, "book shooting example stress");
  throws(() => D.applyPush([6, 1, 2], [1, 1]), "push with a wrong number of dice");
}

// push legality
eq(D.canPush({ resolve: 3 }).ok, true, "push allowed");
eq(D.canPush({ resolve: 0 }).reason, "stressedOut", "no push when stressed out (book 2228)");
eq(D.canPush({ resolve: 3, passive: true }).reason, "passive", "no push on passive rolls (book 2227)");
eq(D.canPush({ resolve: 3, pushes: 1 }).reason, "alreadyPushed", "only once (book 2229)");
eq(D.canPush({ resolve: 3, pushes: 1, maxPushes: 2 }).ok, true, "talent allows a second push");
eq(D.canPush({ resolve: 3, opposedDefender: true }).reason, "defender", "defender never pushes (book 2241)");
eq(D.canPush({ resolve: 3, hazard: true }).reason, "hazard", "hazards never push (book 2922)");

// opposed (book 2240, 2243)
eq(D.opposed(3, 1), { net: 2, win: true, tie: false, surplus: 0 }, "opposed win");
eq(D.opposed(2, 2), { net: 0, win: false, tie: true, surplus: 0 }, "opposed tie fails");
eq(D.opposed(0, 0).win, false, "opposed 0-0 fails");
eq(D.opposed(1, 3), { net: 0, win: false, tie: false, surplus: 2 }, "opposed surplus for the defender");
eq(D.stuntCount(3), 2, "stunts = sixes beyond the first");
eq(D.stuntCount(0), 0, "no stunts without sixes");

// help (book 2238, 2827)
eq([D.helpDice(2), D.helpDice(5), D.helpDice(12, { minions: true }), D.helpDice(-1)], [2, 3, 9, 0], "help dice caps");

// exact odds
near(D.pSuccess(1), 1 / 6, 1e-12, "1 die");
near(D.pSuccess(6), 1 - Math.pow(5 / 6, 6), 1e-12, "6 dice");
near(D.pSuccess(4, "onFail"), 1 - Math.pow(26 / 36, 4), 1e-12, "push on fail success chance");
near(D.pSuccess(4, "always"), 1 - Math.pow(26 / 36, 4), 1e-12, "always push has the same success chance");
for (const pol of ["never", "always", "onFail"]) near(D.sixesPmf(7, pol).reduce((a, b) => a + b, 0), 1, 1e-12, `pmf sums to 1 (${pol})`);
near(D.pAtLeast(5, 2), 1 - Math.pow(5 / 6, 5) - 5 * (1 / 6) * Math.pow(5 / 6, 4), 1e-12, "at least two sixes");
{
  const o = D.opposedOdds(5, 3);
  near(o.win + o.tie + o.lose, 1, 1e-12, "opposed odds sum to 1");
  near(o.net.reduce((a, b) => a + b, 0), 1, 1e-12, "net pmf sums to 1");
  near(D.opposedOdds(5).win, D.pSuccess(5), 1e-12, "unopposed = plain success");
  ok(D.pHit(5, 3, "ifLosing") > D.pHit(5, 3, "onFail"), "pushing after seeing the defence is at least as good");
  ok(D.pHit(5, 3, "onFail") > D.pHit(5, 3, "never"), "pushing helps");
}

// Monte Carlo cross-check of the push formulas (seeded, small)
{
  const r = D.seededRng(42), N = 40000, n = 5, dn = 3;
  let onFail = 0, ifLosing = 0, stress = 0, always2 = 0;
  for (let i = 0; i < N; i++) {
    const dice = Array.from({ length: n }, () => D.d6(r));
    const def = D.tally(Array.from({ length: dn }, () => D.d6(r))).sixes;
    const reroll = () => D.applyPush(dice, D.rerollable(dice).map(() => D.d6(r)));
    const t = D.tally(dice);
    const pushed = reroll();
    if ((t.sixes > 0 ? t.sixes : pushed.sixes) > def) onFail++;
    if ((t.sixes > def ? t.sixes : pushed.sixes) > def) ifLosing++;
    stress += pushed.stress;
    if (pushed.sixes >= 2) always2++;
  }
  near(onFail / N, D.pHit(n, dn, "onFail"), 0.012, "MC opposed onFail");
  near(ifLosing / N, D.pHit(n, dn, "ifLosing"), 0.012, "MC opposed ifLosing");
  near(stress / N, D.expectedPushStress(n), 0.03, "MC expected push stress");
  near(always2 / N, D.pAtLeast(n, 2, "always"), 0.012, "MC two sixes after a push");
  let s = 0, cnt = 0;
  const r2 = D.seededRng(7);
  for (let i = 0; i < N; i++) {
    const dice = Array.from({ length: n }, () => D.d6(r2));
    if (D.tally(dice).sixes === 0) s += D.applyPush(dice, D.rerollable(dice).map(() => D.d6(r2))).stress;
    cnt++;
  }
  near(s / cnt, D.expectedPushStress(n, "onFail"), 0.03, "MC expected stress when pushing only failures");
}

done("check-dice");
