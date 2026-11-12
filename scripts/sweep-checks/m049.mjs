// node scripts/sweep-checks/m049.mjs  (S049: an untargeted verdict does not settle on the first reported miss when another target's hit arrives a moment later)
const Moment = await import("../moment.mjs");
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// a player's client: N1's miss and N2's hit arrive as two socket messages, a few ms apart (separate tasks)
const p1 = Moment.verdict("s1", { cap: 3000 });
Moment.told("s1", "N1", false);
await sleep(30);
Moment.told("s1", "N2", true);
ck("split burst: a later hit still counts", (await p1) === true);
// all misses, split: false, after the exchange went quiet
const t0 = Date.now();
const p2 = Moment.verdict("s2", { cap: 3000 });
Moment.told("s2", "N1", false);
await sleep(30);
Moment.told("s2", "N2", false);
const v2 = await p2;
ck("all misses -> false", v2 === false);
ck("false waits for the quiet time, not the cap", Date.now() - t0 < 2000);
// asked after the rows are in and quiet: answers at once
await sleep(10);
ck("asked late: false right away", (await Moment.verdict("s2", { cap: 5 })) === false);
// per-target reads unchanged
ck("targeted miss is immediate", (await Moment.verdict("s1", { target: "N1", cap: 5 })) === false);
ck("unknown -> null at the cap", (await Moment.verdict("zz", { cap: 10 })) === null);
console.log(`sweep m049: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
