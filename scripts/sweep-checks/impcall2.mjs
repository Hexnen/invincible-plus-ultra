import "../tokenreact/impact-node-prime.mjs";      // the vendored engine's impact table for pure.mjs (on a page: the running engine's L.impact)
// node scripts/sweep-checks/impcall2.mjs  (IMPCALL2, 2026-11-15: the callers' side of the impact frames, ADVI2 items 1, 3, 4, 6, 10).
//   L  the ladders: no rung is nothing or a blink; ordinary < strong < critical (the roll) and scratch < blow < hard blow < heavy (a token's
//      blow) each LONGER, measured on the vendored engine's own plan (what plays); the two lowest no flash, the rest at most the guard's two;
//      every caller drawing carries the figures;
//   F  one event: a reaction on a token the roll's impact has just struck folds into it (no second cut) unless it is stronger, then it plays
//      without a flash (the second beat);
//   A  two tokens hurt unequally: only tokens within ALSO_GAP steps join the host's cut;
//   C  a challenge token is never struck: its rating's fall is progress (no punch, no blow drawings), its time at 0 its failure;
//   W  the wiring in main.mjs / stage.mjs (the landing tells targets + the table's step; an off-view seat gets a gentle edge moment).
import * as P from "../tokenreact/pure.mjs";
import * as RG from "../impact-rungs.mjs";
import * as IP from "../splash/impact-plan.mjs";
import { planImpact, isFlash, safety } from "../letters/impact/plan.mjs";
const fs = await import("node:fs");
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const plan = (spec, seed = "s") => planImpact({ ...spec, seed });
const ticksOf = (spec) => plan(spec).ticks;
const flashOf = (spec) => plan(spec).frames.filter(isFlash).length;
const minOver = (spec) => { let t = Infinity; for (let i = 0; i < 24; i++) t = Math.min(t, plan(spec, `k${i}`).ticks); return t; };

/* ---- L: the roll's ladder ---- */
const ord = IP.impactFor({ power: 0.2, action: "slugfest" }), strong = IP.impactFor({ power: 0.55, action: "slugfest" }), crit = IP.impactFor({ power: 0.7, action: "slugfest" });
/* CALLER6 (engine 1.9.24): a blow's ordinary / strong result is the engine's own step 1 / 2 of its kind (no `frames`); a result that is not a
   blow keeps the callers' cut (the engine's "word" kind is 3 ticks there). Was: `Array.isArray(ord.frames)` (the callers' cut for every action) */
const ordW = IP.impactFor({ power: 0.2, action: "dodge" }), strongW = IP.impactFor({ power: 0.55, action: "dodge" });
ck("L roll: an ordinary success has a moment (was none)", !!ord && ord.rung === "ordinary" && plan(ord).ticks >= 6 && !!ordW && ordW.rung === "ordinary" && Array.isArray(ordW.frames));
ck("L roll: a blow's low rungs are the engine's ladder, a result that is no blow the callers' cut", !ord.frames && !strong.frames && ordW.kind === "word" && Array.isArray(strongW.frames));
ck("L roll: one length per rung whatever the action (blow / shot / charge / no blow)", ["slugfest", "shooting", "charge", "dodge"].every((a) =>
  plan(IP.impactFor({ power: 0.2, action: a })).ticks === plan(ord).ticks && plan(IP.impactFor({ power: 0.55, action: a })).ticks === plan(strong).ticks));
ck("L roll: a failure still none", IP.impactFor({ power: 0.9, fail: true }) === null);
ck("L roll: Effects off none", IP.impactFor({ power: 0.9 }, { fx: 0 }) === null && IP.impactFor({ power: 0.2 }, { fx: 0 }) === null);
for (const pw of [0.2, 0.55, 0.8]) { const a = IP.impactFor({ power: pw }, { fx: 1 }), b = IP.impactFor({ power: pw }, { fx: 0.5 });
  ck(`L roll ${pw}: Effects reduced = the table's impact (same kind, strength, cut), gentle, no hold`, !!b && b.kind === a.kind && b.magnitude === a.magnitude
    && JSON.stringify(b.frames ?? null) === JSON.stringify(a.frames ?? null) && b.gentle === true && b.hitstop === false && a.gentle === undefined); }
const tO = ticksOf(ord), tS = ticksOf(strong), tC = minOver(crit);
ck(`L roll: ordinary ${tO} < strong ${tS} < critical ${tC} ticks`, tO < tS && tS < tC);
ck("L roll: ordinary at least 6 ticks (250 ms), no flash", tO >= 6 && flashOf(ord) === 0);
ck("L roll: strong at most one flash", flashOf(strong) <= 1 && flashOf(strongW) <= 1);
ck("L roll: the strength keeps the engine's step (ordinary step 1, strong under step 3)", plan(ord).step === 1 && plan(strong).step < 3);
for (const r of ["ordinary", "strong"]) {
  const m = IP.mapFrames(r === "ordinary" ? IP.ORD_MAG : 0.6, null, { figs: true, rung: r }), b = IP.mapFrames(0.6, null, { figs: false, rung: r });
  ck(`L map ${r}: leaves the word's spot clear`, [...m, ...b].every((x) => !IP.COVERS_WORD.includes(x.type)));
  ck(`L map ${r}: no flash`, [...m, ...b].every((x) => !RG.isFlashType(x.type)));
  ck(`L map ${r}: at least 6 ticks`, RG.ticksOf(m) >= 6 && RG.ticksOf(b) >= 6);
  ck(`L map ${r} bare: no figure codes (no target)`, b.every((x) => x.fig === undefined));
}
ck("L map ordinary < strong", RG.ticksOf(IP.mapFrames(0.45, null, { figs: true, rung: "ordinary" })) < RG.ticksOf(IP.mapFrames(0.6, null, { figs: true, rung: "strong" })));

/* ---- L: the blow's ladder ---- */
const blowSpec = (amt, kind = "hit", o = {}) => P.impactOf({ kind, amt, known: true }, 0, o);
const sc = blowSpec(0.1), bl = blowSpec(0.15 + 0.1), hb = blowSpec(0.3, "heavy"), hv = blowSpec(0.6, "heavy"), cr = blowSpec(0.9, "heavy");
ck("L blow: rungs 0..4", [sc, bl, hb, hv, cr].map((s) => s.rung).join() === "0,1,2,3,4");
const lad = [sc, bl, hb].map(ticksOf), heavyMin = Math.min(minOver(hv), minOver({ ...hv, kind: "shock" }));
/* CALLER6 (engine 1.9.24): the rungs are the engine's ladders. Its step 2 (blow, hard blow) lasts 10 ticks and its step 3 (heavy) 10-11
   (pinned there by the rapid series: the engine's open question), so from the blow up a rung is no longer told by its LENGTH (IMPCALL2's
   callers' cuts were 8 / 9 ticks squeezed under that step 3: `lad[1] < lad[2] && lad[2] < heavyMin`) but by its drawings: no rung is
   shorter than the one below, every rung is longer than IMPCALL2's was, and each adds what the one below has not (the weight below) */
const weight = (spec) => { let fl = 0, full = 0, stop = 0; for (let i = 0; i < 24; i++) { const p = plan(spec, `w${i}`); fl = Math.max(fl, p.frames.filter(isFlash).length);
  full = Math.max(full, p.frames.filter((x) => x.full).length); stop = Math.max(stop, p.frames.filter((x) => x.stop).length); } return { fl, full, stop }; };
const W = [sc, bl, hb, hv].map(weight);
ck(`L blow: scratch ${lad[0]} < blow ${lad[1]} <= hard blow ${lad[2]} <= heavy ${heavyMin} ticks`, lad[0] < lad[1] && lad[1] <= lad[2] && lad[2] <= heavyMin);
ck(`L blow: every low rung at least as long as IMPCALL2's own cut (6 / 8 / 9 ticks: ${lad.join(" / ")})`, lad[0] >= 6 && lad[1] >= 8 && lad[2] >= 9);
ck("L blow: a scratch at least 6 ticks (was 2), no flash", lad[0] >= 6 && flashOf(sc) === 0);
ck(`L blow: each rung adds to the one below: the panel (blow), the shatter (hard blow), full frames and a hit-stop (heavy): ${JSON.stringify(W)}`,
  W[0].fl === 0 && W[1].fl === 1 && W[2].fl === 2 && W[1].full === 0 && W[2].full === 0 && W[1].stop === 0 && W[2].stop === 0 && W[3].full >= 1 && W[3].stop >= 1 && W[3].fl >= 2);
ck("L blow: the low rungs never a full-field frame or a hit-stop, in any kind the ladder takes (blow, crushing, shot)", ["hit", "heavy", "shock"].every((k) =>
  [sc, bl, hb].every((s) => { const w = weight({ ...s, kind: k }); return w.full === 0 && w.stop === 0 && w.fl <= 2; })));
ck("L blow: an energy blow is the engine's shot ladder at the rung's strength, the rung's length", blowSpec(0.25, "hit", { dtype: "laser" }).kind === "shock"
  && ticksOf(blowSpec(0.25, "hit", { dtype: "laser" })) === lad[1] && ticksOf(blowSpec(0.1, "hit", { dtype: "laser" })) === lad[0]);
ck("L blow: every rung the engine's own ladder", [sc, bl, hb, hv, cr].every((s) => !s.frames));
for (const [name, list] of [["ROLL", Object.values(RG.ROLL)], ["ROLL_MAP", Object.values(RG.ROLL_MAP)], ["CHALLENGE", Object.values(RG.CHALLENGE)]])
  for (const l of list) {
    ck(`L ${name}: every drawing carries the figures`, l.every((x) => typeof x.fig === "string" && x.fig));
    ck(`L ${name}: at most one flash, at most the engine's max ticks`, RG.flashesOf(l) <= 1 && RG.ticksOf(l) <= 24);
    ck(`L ${name}: a kick only with a punch`, l.every((x) => !x.kick || x.punch > 0));
  }
/* reduced / gentle seats: the engine still owns the safety (its gentle variant of a caller cut changes no full scene) */
const P0 = { impact: "full", flashes: true, motion: "full" };
for (const s of [ord, strong, sc, bl, hb, ...P.CHALLENGE_KINDS.map((k) => P.impactOf({ kind: k, amt: 0.5 }, 0))]) {
  const g = safety(plan(s), P0, { flashLog: [], now: 0, t0: 0, callerGentle: true });
  ck(`L gentle ${s.rung ?? s.kind}: the engine's gentle variant (no full frame, no hit-stop)`, g.mode === "local" && g.frames.every((x) => !x.full && !x.stop));
  const r = safety(plan(s), { ...P0, motion: "reduced" }, { flashLog: [], now: 0, t0: 0 });
  ck(`L reduced ${s.rung ?? s.kind}: one still drawing, no punch`, r.frames.every((x) => !x.punch && !x.stop));
}

/* ---- F: one event ---- */
const fold = (spec, step) => P.foldOf(spec, 0, Number.isFinite(step) ? { step } : null).how;
ck("F: no roll struck it: own", fold(sc, null) === "own" && fold(hv, null) === "own");
ck("F: ordinary roll + scratch = one event (fold)", fold(sc, plan(ord).step) === "fold");
ck("F: critical roll + its heavy damage = one event (fold)", fold(hv, plan(crit).step) === "fold" && fold(cr, plan(crit).step) === "fold");
const ko = P.impactOf({ kind: "down", amt: 0.5, known: true }, 0);
ck("F: ordinary roll + knock-down = the second beat", fold(ko, plan(ord).step) === "beat");
const bf = RG.beatFrames(plan(ko).frames);
ck("F: the second beat has no flash, the same length, figures on every drawing", planImpact({ ...ko, frames: bf, seed: "b" }).frames.filter(isFlash).length === 0
  && RG.ticksOf(bf) === plan(ko).ticks && bf.every((x) => x.fig));
ck("F: the drawn step counts the series' boost", P.drawnStep(sc, 3) >= P.drawnStep(sc, 0));

/* ---- A: two tokens hurt unequally ---- */
const st = (s) => P.drawnStep(s, 0);
ck("A: a scratch beside a heavy blow does not join its cut", !P.alsoJoins(st(sc), st(hv)));
ck("A: a scratch beside a knock-down does not join", !P.alsoJoins(st(sc), st(ko)));
ck("A: a blow beside a hard blow joins", P.alsoJoins(st(bl), st(hb)));
ck("A: equal blows join", P.alsoJoins(st(hv), st(hv)));

/* ---- C: a challenge ---- */
const ch = (o) => P.challengeOf(o)?.kind ?? null;
ck("C: rating 6 -> 3 is progress", ch({ stat: "health", from: 6, to: 3, max: 6 }) === "gain");
ck("C: rating to 0 is overcome", ch({ stat: "health", from: 1, to: 0, max: 6 }) === "won");
ck("C: rating up (a ward reset, the GM) no reaction", ch({ stat: "health", from: 2, to: 6, max: 6 }) === null);
ck("C: the time limit ticking down no reaction", ch({ stat: "resolve", from: 4, to: 3, max: 6, cr: 2 }) === null);
ck("C: time to 0 with rating left is failure", ch({ stat: "resolve", from: 1, to: 0, max: 6, cr: 2 }) === "lapse");
ck("C: time to 0 after the rating hit 0 no failure", ch({ stat: "resolve", from: 1, to: 0, max: 6, cr: 0 }) === null);
const seatC = { visible: true, staff: false, reader: true, challenge: true };
ck("C: a failure is shown, a time tick is the HUD's", P.audience(seatC, P.challengeOf({ stat: "resolve", from: 1, to: 0, max: 6, cr: 2 })).show
  && !P.audience(seatC, { stat: "resolve", kind: "stress", n: 1, r: 0.2 }).show);
ck("C: a hidden challenge token shows nothing", !P.audience({ ...seatC, visible: false }, P.challengeOf({ stat: "health", from: 6, to: 3, max: 6 })).show);
for (const k of P.CHALLENGE_KINDS) {
  const s = P.impactOf({ kind: k, amt: 0.5, known: true }, 0);
  ck(`C ${k}: an impact, the tone-only kind, not a blow`, !!s && s.kind === "word" && !s.rung);
  ck(`C ${k}: no punch, no kick, no blow drawings`, s.frames.every((x) => !x.punch && !x.kick && !["cracks", "splat", "ink", "slam", "shatter", "pop"].includes(x.type)));
  ck(`C ${k}: lettered (a word kind, a motion, a palette)`, !!P.look({ kind: k, num: 2, amt: 0.5 }, null, "en", "s") && !!P.ANIM_KIND[k]);
}
ck("C: progress < overcome < failure in length; only the failure flashes", ticksOf(P.impactOf({ kind: "gain", amt: 0.5 }, 0)) < ticksOf(P.impactOf({ kind: "won", amt: 0.5 }, 0))
  && ticksOf(P.impactOf({ kind: "won", amt: 0.5 }, 0)) < ticksOf(P.impactOf({ kind: "lapse", amt: 0.5 }, 0))
  && flashOf(P.impactOf({ kind: "gain", amt: 0.5 }, 0)) === 0 && flashOf(P.impactOf({ kind: "won", amt: 0.5 }, 0)) === 0 && flashOf(P.impactOf({ kind: "lapse", amt: 0.5 }, 0)) === 1);
ck("C: the rating's number in the good news' colour", P.look({ kind: "gain", num: 3, amt: 0.5 }, null, "en", "s").number.hand.id.includes("numRp"));

/* ---- W: wiring ---- */
const main = fs.readFileSync(new URL("../tokenreact/main.mjs", import.meta.url), "utf8"), stage = fs.readFileSync(new URL("../splash/stage.mjs", import.meta.url), "utf8");
ck("W: build classifies a challenge with challengeOf", /actor\?\.type === "challenge"[\s\S]{0,120}P\.challengeOf\(/.test(main));
ck("W: the landing records the struck targets + step", /data\.targets[\s\S]{0,200}struck\.set\(/.test(main));
ck("W: land folds the moment's impact", /P\.foldOf\(/.test(main) && /how === "fold"/.test(main) && /RG\.beatFrames\(/.test(main));
ck("W: also only within the gap", /P\.alsoJoins\(/.test(main));
ck("W: a folded blow's word does not flash again", /it\.impact \|\| it\.folded\)\) wordOpts\.flash = false/.test(main));
ck("W: an off-view seat: a gentle impact on the edge word, no attacker/also", /spec\.gentle = true/.test(main) && /!edge && src/.test(main) && /also\.length && !edge/.test(main));
ck("W: the token moves as its nearest kind", /P\.ANIM_KIND\[it\.lk\.kind\]/.test(main));
ck("W: the splash tells targets and the TABLE's step on landing", /ctl\.tableStep = p\.step/.test(stage) && /targets: ctl\.targets\.slice\(\), step: ctl\.tableStep/.test(stage)
  && /I\.plan\?\.\(\{ \.\.\.ts, reduced: false \}\)/.test(stage));
ck("W: the splash hands Effects reduced to the engine as gentle", /if \(q\.gentle === true\) s\.gentle = true/.test(stage));
ck("W: the splash hands the rung to the map layer and the screen cut", /rung: q\.rung/.test(stage) && /Array\.isArray\(q\.frames\)/.test(stage));

console.log(`sweep impcall2: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
