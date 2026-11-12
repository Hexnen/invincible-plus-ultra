import * as I from "../tactics/initiative-pure.mjs";
import { newInit } from "../tactics/state-pure.mjs";
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.error("FAIL " + m); } };
const mk = () => { let k = 0; return (p) => `${p}${++k}`; };
const part = (id, o = {}) => ({ id, hero: false, owners: [], defeated: false, challenge: false, summonOf: null, veteran: false, reflexes: false, resolve: 3, ...o });
const mid = mk();
const rng = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

// S075: a closed round stays closed after settle() (group/ungroup/removeCombatant)
{
  const ids = ["a", "b", "c"], parts = ids.map((i) => part(i));
  let init = I.addCombatant(I.addCombatant(I.addCombatant(newInit(), "a", mid).init, "b", mid).init, "c", mid).init;
  init.slots.forEach((s, i) => { s.card = i + 1; });
  const closed = I.closeRound(init);
  ok(I.nextUp(closed) === null, "S075 closed round has nobody up");
  const after = I.removeCombatant(closed, "c").init;
  ok(I.nextUp(after) === null, "S075 removal in the close window does not revive skipped slots");
  ok(after.slots.every((s) => s.state === "done"), "S075 slots stay done after removal");
}

// S077: two veterans keep 12 and 11, one slot leaves -> no throw
{
  const parts = Array.from({ length: 12 }, (_, i) => part("p" + i, { veteran: i < 2 }));
  let init = parts.reduce((a, p) => I.addCombatant(a, p.id, mid).init, newInit());
  init.slots.forEach((s, i) => { s.card = i === 0 ? 12 : i === 1 ? 11 : i - 1; });
  let r = I.startDraw(init, 2, parts, { mkId: mid, redraw: "everyRound" });
  init = r.init;
  ok(r.ask.length === 2, "S077 both veterans asked");
  for (const q of r.ask) { const a = I.answerVeteran(init, q.slot, true); if (!a.ok) console.error(a); init = a.init; }
  init = I.removeCombatant(init, "p5").init;
  const left = parts.filter((p) => p.id !== "p5");
  let threw = false, c;
  try { c = I.continueDraw(init, left, rng); } catch (e) { threw = true; }
  ok(!threw, "S077 continueDraw does not throw");
  if (!threw) {
    let cur = c.init;
    for (let g = 0; g < 50 && !c.done; g++) { c = I.continueDraw(cur, left, rng); cur = c.init; }
    ok(c.done, "S077 draw completes");
    const cs = c.init.slots.map((s) => s.card);
    ok(new Set(cs).size === cs.length && cs.every((x) => x !== null), "S077 all cards distinct");
  }
}
console.log(`sweep c25: ${n} checks, ${bad} failed`);
process.exit(bad ? 1 : 0);
