// node scripts/sweep-checks/fxb2.mjs  (FXB2: the rest of FXY's U178 finding. The End press got its own run clock (news-pure diceRun,
// main.mjs diceSince); three more readers of the old clock (the last draw's diceWas.since, cleared only by a draw while no dice roll)
// could go stale the same way: the draw's diceHold (held cards, the line, the own roll rows, endWhileDice), the auto end's timer
// (main.mjs autoEnd) and ANSC's gate (Wait.diceHolds in main.mjs refresh, and ui/dicegate.mjs with its own `since`).
// The defect, for each: roll A flies while a draw (or a gate call) happens, nothing is held so no draw / landed() follows its landing;
// roll B a minute later: the clock still says A's time, past HOLD_MS, so B's result is shown over its flying dice.)
import { readFileSync } from "node:fs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const rd = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const N = await import("../tactics/ui/news-pure.mjs");
const W = await import("../tactics/ui/wait-pure.mjs");
const { diceHold, diceRun, diceClock, endWhileDice, HOLD_MS } = N;

const T0 = 1_000_000, TB = T0 + 60_000;      // roll A seen at T0; roll B a minute later
const plain = { label: "End", tip: "End [Space]" }, autoEnd = { auto: true, label: "auto", tip: "auto", req: { op: "endTurn" } };
/* what refresh() keeps across draws, old and new wiring: draw 1 while A flies (nothing held), no draw after A lands, draw 2 at B + 0.3 s
   with a new card and a new line */
const shown0 = { prompts: ["p1"], cards: [], news: { id: "n1" } };
const draw = (wasClock, prev, at, busy, now) => diceHold(wasClock(prev), { ...now, at }, busy);
/* old: diceHold(diceWas, ...) */
const old1 = draw((p) => p, { ...shown0, since: null }, T0 + 300, true, shown0);
const old2 = draw((p) => p, old1, TB + 300, true, { prompts: ["p1", "p2"], cards: [], news: { id: "n2" } });
/* new: diceHold(diceClock(diceWas, diceSince()), ...) */
let run = diceRun(null, ["A"], T0 + 300);
const new1 = draw((p) => diceClock(p, run?.since), { ...shown0, since: null }, T0 + 300, true, shown0);
run = diceRun(run, ["B"], TB + 300);      // the next call sees B (A landed, nobody asked in between)
const new2 = draw((p) => diceClock(p, run?.since), new1, TB + 300, true, { prompts: ["p1", "p2"], cards: [], news: { id: "n2" } });

/* ================================================================== reader 1: diceHold (the held cards, the line, the roll rows) */
ck("diceHold (the defect, kept as evidence): the old clock is A's on roll B, so B's card and line are NOT held", old1.since === T0 + 300 && old2.since === T0 + 300 && old2.held === false && old2.prompts.includes("p2") && old2.news.id === "n2");
ck("diceHold (fix): with the run's clock B's new card waits for its dice", new2.since === TB + 300 && new2.held === true && !new2.prompts.includes("p2") && new2.prompts.includes("p1"));
ck("diceHold (fix): ... and the line keeps what it said", new2.news.id === "n1");
const new3 = draw((p) => diceClock(p, diceRun(run, ["B"], TB + HOLD_MS + 301)?.since), new2, TB + HOLD_MS + 301, true, { prompts: ["p1", "p2"], cards: [], news: { id: "n2" } });
ck("diceHold (fix): a stuck flag on B still holds nothing past HOLD_MS", new3.held === false && new3.prompts.includes("p2"));
const new4 = draw((p) => diceClock(p, diceRun(run, [], TB + 3000)?.since), new2, TB + 3000, false, { prompts: ["p1", "p2"], cards: [], news: { id: "n2" } });
ck("diceHold (fix): B landed: everything shows, the clock is let go", new4.held === false && new4.since === null && new4.prompts.includes("p2"));
ck("diceClock: nothing shown yet stays nothing (no hold on the first draw)", diceClock(null, 5) === null && diceClock(undefined, 5) === null);
ck("diceClock: nothing in the air -> since null", diceClock({ prompts: [], since: 7 }, undefined).since === null);
ck("diceClock: does not touch what was shown", JSON.stringify(diceClock({ prompts: ["a"], cards: ["c"], news: { id: "x" }, since: 1 }, 9)) === JSON.stringify({ prompts: ["a"], cards: ["c"], news: { id: "x" }, since: 9 }));
/* the roll rows (holdRollsIn) and endWhileDice read hold.since: on roll B the old one let them go, the new one holds */
ck("roll rows (FXN, reads hold.since): old clock: not held on B; new: held", !(TB + 300 - old2.since <= HOLD_MS) && TB + 300 - new2.since <= HOLD_MS);
/* a message joining the dice in the air keeps the run's clock (two rolls overlapping are one wait, as before) */
const both = diceRun(diceRun(null, ["A"], T0), ["A", "B"], T0 + 2000);
ck("diceRun: B thrown while A still flies: one run, A's clock (bounded by HOLD_MS as before)", both.since === T0);

/* ================================================================== reader 2: the auto end (endWhileDice in the draw + autoEnd's timer) */
ck("auto end (the defect): with the old clock the draw at B leaves `auto` on: the turn would pass 1.5 s later over the dice", endWhileDice(autoEnd, { busy: true, since: old2.since, at: TB + 300 }, plain).auto === true);
ck("auto end (fix): the draw at B turns it into the plain End until the dice land", (() => { const e = endWhileDice(autoEnd, { busy: true, since: new2.since, at: TB + 300 }, plain); return e.auto === false && e.dice === 1 && e.label === "End"; })());
/* autoEnd's timer (main.mjs): `diceBusy() && now - (clock ?? now) <= HOLD_MS` -> wait */
const timerWaits = (clock, at) => at - (clock ?? at) <= HOLD_MS;
ck("auto end timer (the defect): at B + 1.5 s the old clock says too long: it presses over the dice", !timerWaits(old2.since, TB + 1800));
ck("auto end timer (fix): the run's clock says B is 1.5 s in the air: it waits for them", timerWaits(diceRun(run, ["B"], TB + 1800).since, TB + 1800));
ck("auto end timer (fix): a stuck flag never keeps the turn", !timerWaits(diceRun(run, ["B"], TB + HOLD_MS + 400).since, TB + HOLD_MS + 400));

/* ================================================================== reader 3: ANSC's gate (Wait.diceHolds) in main.mjs refresh */
ck("ANSC gate in refresh (the defect): the old clock holds nothing on B (numbers, desk rows, state marks, chase panel)", W.diceHolds(true, old2.since, TB + 300).on === false);
ck("ANSC gate in refresh (fix): the run's clock holds on B", W.diceHolds(true, diceRun(run, ["B"], TB + 300).since, TB + 300).on === true);

/* ================================================================== reader 3b: ui/dicegate.mjs (the bar's Health / Resolve, the HUD, camera, feedback, roll requests) */
{
  const msgs = [];
  globalThis.game = { messages: { contents: msgs }, dice3d: { waitFor3DAnimationByMessageID: () => new Promise(() => {}) } };
  const G = await import("../tactics/ui/dicegate.mjs");
  msgs.push({ id: "A", _dice3danimating: true });
  ck("dicegate: roll A, the bar draws while it flies: holds", G.on(T0) === true);
  msgs[0]._dice3danimating = false;      // A lands; nothing was held, so nobody waits on landed() and nobody asks the gate
  msgs.push({ id: "B", _dice3danimating: true });
  ck("dicegate (the defect fixed): roll B a minute later holds from its own first sight (base: false, A's clock)", G.on(TB + 300) === true);
  ck("dicegate: B's own clock", G.state().since !== T0);
  ck("dicegate: B stuck past HOLD_MS holds nothing", G.on(TB + 300 + HOLD_MS + 1) === false);
  msgs[1]._dice3danimating = false;
  ck("dicegate: nothing in the air: the clock is let go", G.on(TB + 20000) === false && G.state().since === null);
  delete globalThis.game;
}

/* ================================================================== the wiring */
{
  const main = rd("../tactics/ui/main.mjs"), gate = rd("../tactics/ui/dicegate.mjs");
  ck("main.mjs: nothing reads the last draw's clock any more (diceWas.since)", !/diceWas\?*\.since/.test(main));
  ck("main.mjs: the draw's diceHold gets the run's clock", /hold = NewsP\.diceHold\(NewsP\.diceClock\(diceWas, diceSince\(\)\), \{/.test(main));
  ck("main.mjs: ANSC's gate in the draw reads the run's clock", /const diceNow = Wait\.diceHolds\(diceBusy\(\), diceSince\(\), Date\.now\(\)\)\.on;/.test(main));
  ck("main.mjs: the auto end's timer reads the run's clock", /autoTimer = setTimeout\(\(\) => \{ try \{ if \(diceBusy\(\) && Date\.now\(\) - \(diceSince\(\) \?\? Date\.now\(\)\) <= NewsP\.HOLD_MS\)/.test(main));
  ck("main.mjs: endWhileDice and the roll rows still read hold.since (now the run's)", /NewsP\.endWhileDice\(data\.end, \{ busy, since: hold\.since, at: now \}/.test(main) && /holdRollsIn\(data, rollsWas, busy && !\(Number\.isFinite\(hold\.since\)/.test(main));
  ck("dicegate.mjs: the clock is the run of messages in the air (diceRun), no `since` kept by the last call", /import \{ diceRun \} from "\.\/news-pure\.mjs";/.test(gate) && /run = diceRun\(run, recent\(\)\.map\(\(m\) => m\.id\), now\)/.test(gate) && !/\bsince = r\.since/.test(gate) && /W\.diceHolds\(busy\(\), clock\(now\), now\)/.test(gate));
}

console.log(`sweep fxb2: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
