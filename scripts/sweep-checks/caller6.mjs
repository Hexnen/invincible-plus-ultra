import "../tokenreact/impact-node-prime.mjs";      // the vendored engine's impact table for pure.mjs (on a page: the running engine's L.impact)
// node scripts/sweep-checks/caller6.mjs  (CALLER6, 2026-11-16: plus-ultra's impact-frame callers on LETR 1.9.24 ENG24, contract v27).
//   V  the vendored engine is 1.9.24 or newer and plans what the callers now rely on: `tableMs` on a plan as the engine's I.plan builds it,
//      its steps 0 / 1 / 2 no blink (read from the plan, never a number kept here).
//   T  the TABLE's impact length (impact-rungs tableImpactMs): `plan.tableMs` on every seat, also on a reduced-motion seat whose own plan is
//      one still, for the engine's own ladders too (REQUESTS CALLER5-E1: before, such a seat's target answered up to ~0.9 s early); the table's
//      "off" is 0; an engine before 1.9.24 (no tableMs) keeps CALLER5's estimate. The token reactions' wait after the impact is the same on
//      a full, a photosensitive and a reduced-motion seat for every rung.
//   L  the low rungs: a blow's rungs (roll: ordinary, strong; reaction: scratch, blow, hard blow) are the engine's own ladder of the blow's
//      kind (no `frames`); what the callers still hand in (a roll that is no blow, the map layer's cuts) has the engine's length for that
//      rung, so a rung is one length whatever the action or the layer; a strong result always reads the engine's step 2 and never the
//      ordinary result's cut; nothing below the critical / the heavy blow has a full-field frame or a hit-stop.
//   S  seats: the same call gives the same drawings on two ordinary seats; a photosensitive seat the same length in the gentle variant (no
//      full frame, no hit-stop, rims only, no cut-in); a reduced-motion seat one still and the table's length to wait.
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const fs = await import("node:fs");
import * as P from "../tokenreact/pure.mjs";
import * as RG from "../impact-rungs.mjs";
import * as IP from "../splash/impact-plan.mjs";
import { planImpact, isFlash, safety, stepOf, STEP_AT, LIMITS } from "../letters/impact/plan.mjs";
import { VERSION } from "../letters/engine.mjs";

const SEEDS = Array.from({ length: 24 }, (_, i) => `c6-${i}`);
const FULL = { impact: "full", flashes: true, motion: "auto" }, PHOTO = { ...FULL, flashes: false };
const I = { limits: LIMITS };
/* a plan as the engine's I.plan gives it on a seat (impact/index.mjs planFor: the full plan, its length kept as tableMs, then the seat's safety) */
const seatPlan = (spec, seed, prefs = FULL, env = {}) => { const { rung: _r, ...s } = spec; const p = planImpact({ ...s, seed }); p.tableMs = p.ms; return safety(p, prefs, { flashLog: [], now: 0, t0: 0, callerGentle: s.gentle, ...env }); };
const full = (spec, seed = "s") => { const { rung: _r, ...s } = spec; return planImpact({ ...s, seed }); };
const ticks = (spec) => { const t = new Set(SEEDS.map((sd) => full(spec, sd).ticks)); return t.size === 1 ? [...t][0] : NaN; };      // one length over every seed, else NaN
const roll = (pw, action = "slugfest", o = {}) => IP.impactFor({ power: pw, action, ...o });
const blow = (kind, amt, o = {}) => P.impactOf({ kind, amt, known: true }, 0, o);
const ROLLS = { ordinary: 0.3, strong: 0.55 }, BLOWS = [["scratch", blow("hit", 0.125)], ["blow", blow("hit", 0.25)], ["hard blow", blow("heavy", 0.375)]];
const ACTIONS = ["slugfest", "charge", "grapple", "shooting", "generic", "dodge", "block", "idea"];

/* ---- V: the engine ---- */
{ const v = String(VERSION).split(".").map(Number);
  ck(`V the vendored engine is 1.9.24 or newer (${VERSION})`, v[0] > 1 || (v[0] === 1 && (v[1] > 9 || (v[1] === 9 && v[2] >= 24))));
  const src = fs.readFileSync(new URL("../letters/impact/index.mjs", import.meta.url), "utf8");
  ck("V the engine's I.plan / play / prepare put tableMs on the plan", (src.match(/plan\.tableMs = plan\.ms;/g) ?? []).length >= 3);
  for (const kind of ["hit", "heavy", "shock"]) for (const [m, name] of [[0.25, "step 0"], [0.45, "step 1"], [0.6, "step 2"]])
    ck(`V ${kind} ${name}: no blink on the engine's own ladder (${ticks({ kind, magnitude: m })} ticks)`, ticks({ kind, magnitude: m }) >= 6);
}

/* ---- T: the table's length ---- */
{ const ko = blow("down", 0.5);
  const specs = [["roll ordinary", roll(0.3)], ["roll strong", roll(0.55)], ["roll strong (no blow)", roll(0.55, "dodge")], ["roll critical", roll(0.95)],
    ...BLOWS, ["heavy", blow("heavy", 0.625)], ["knock-down", ko], ["challenge failure", P.impactOf({ kind: "lapse", amt: 0.5, known: true }, 0)]];
  for (const [name, spec] of specs) {
    let same = true, still = true, older = false, wait = true;
    for (const seed of SEEDS.slice(0, 8)) {
      const a = seatPlan(spec, seed), g = seatPlan(spec, seed, PHOTO), r = seatPlan(spec, seed, FULL, { osReduced: true });
      const want = full(spec, seed).ms, fr = spec.frames;
      if (!(RG.tableImpactMs(a, fr, I) === want && RG.tableImpactMs(g, fr, I) === want && RG.tableImpactMs(r, fr, I) === want)) same = false;
      if (!(r.mode === "static" && r.ms < want && r.tableMs === want)) still = false;
      /* an engine before 1.9.24: no tableMs. A still seat then knows the table's length only for a caller's own cut (CALLER5) */
      const { tableMs: _t, ...old } = r;
      if (!fr && RG.tableImpactMs(old, fr, I) < want) older = true;
      if (fr && RG.tableImpactMs(old, fr, I) !== want) same = false;
      /* the token reactions' wait (the rest of a crowd strikes after the impact) */
      const w = (p) => P.impactAfter(I, { ms: RG.tableImpactMs(p, fr, I) ?? p?.ms });
      if (!(w(a) === w(g) && w(g) === w(r) && w(a) === Math.ceil(want))) wait = false;
    }
    ck(`T ${name}: the table's length on a full, a photosensitive and a reduced-motion seat`, same);
    ck(`T ${name}: the reduced-motion seat's own plan is shorter (one still), its tableMs the table's`, still);
    ck(`T ${name}: the crowd's rest waits the same on every seat`, wait);
    if (!spec.frames) ck(`T ${name}: an engine ladder without tableMs fell back to the still's length (what 1.9.24 answers)`, older);
  }
  ck("T the table's impact off: 0 on every seat, whatever the plan says", RG.tableImpactMs({ mode: "off", ms: 0, tableMs: 458 }, null, I) === 0);
  ck("T no plan: none; a broken tableMs: the estimate", RG.tableImpactMs(null, null, I) === null && RG.tableImpactMs({ mode: "full", ms: 333, tableMs: NaN }, null, I) === 333);
  const rg = fs.readFileSync(new URL("../impact-rungs.mjs", import.meta.url), "utf8");
  ck("T wiring: tableMs is read before the estimate, after the table's off", /if \(plan\.mode === "off"\) return 0;\s*if \(Number\.isFinite\(plan\.tableMs\)\) return Math\.max\(0, plan\.tableMs\);/.test(rg));
}

/* ---- L: the low rungs ---- */
{ const eng = { ordinary: ticks({ kind: "hit", magnitude: IP.ORD_MAG }), strong: ticks({ kind: "hit", magnitude: IP.STRONG_MIN }) };
  ck(`L the engine's bound of step 2 is the strong result's floor (${IP.STRONG_MIN} / ${STEP_AT[1]})`, IP.STRONG_MIN === STEP_AT[1] && stepOf(IP.ORD_MAG) === 1 && IP.STRONG_MAX < STEP_AT[2]);
  ck(`L the engine's lengths: ordinary ${eng.ordinary} < strong ${eng.strong} ticks`, eng.ordinary >= 6 && eng.ordinary < eng.strong);
  for (const a of ACTIONS) {
    const o = roll(ROLLS.ordinary, a), s = roll(ROLLS.strong, a), blowKind = !!IP.ACTION_KIND[a];
    ck(`L roll ${a}: ${blowKind ? "the engine's ladder (no frames)" : "the callers' cut (no blow)"}`, blowKind ? !o.frames && !s.frames && o.kind !== "word" : Array.isArray(o.frames) && Array.isArray(s.frames) && o.kind === "word");
    ck(`L roll ${a}: ordinary ${ticks(o)} and strong ${ticks(s)} ticks = the rung's one length`, ticks(o) === eng.ordinary && ticks(s) === eng.strong);
    ck(`L roll ${a}: ordinary no flash, step 1`, SEEDS.every((sd) => full(o, sd).frames.filter(isFlash).length === 0 && full(o, sd).step === 1));
    let ok = true;
    for (let pw = IP.STRONG_P; pw < IP.CRIT_P; pw += 0.01) for (const wreck of [false, true]) { const q = roll(pw, a, { wreck }), p = full(q);
      if (!(q.rung === "strong" && p.step === 2 && p.ticks === eng.strong && p.frames.every((x) => !x.full && !x.stop) && p.frames.filter(isFlash).length >= 1 && p.frames.filter(isFlash).length <= LIMITS.fullPerImpact)) ok = false; }
    ck(`L roll ${a}: every strong result (wreck or not) the engine's step 2: a flash panel, never a full-field frame or a hit-stop, never the ordinary cut`, ok);
    ck(`L roll ${a}: strong < critical`, ticks(s) < Math.min(...SEEDS.map((sd) => full(roll(IP.CRIT_P, a), sd).ticks)));
  }
  for (const layer of ["ROLL", "ROLL_MAP", "ROLL_MAP_BARE"]) for (const r of ["ordinary", "strong"])
    ck(`L ${layer}.${r}: the engine's length for the rung (${RG.ticksOf(RG[layer][r])} / ${eng[r]} ticks)`, RG.ticksOf(RG[layer][r]) === eng[r]);
  for (const layer of ["ROLL", "ROLL_MAP", "ROLL_MAP_BARE"]) for (const r of ["ordinary", "strong"])
    ck(`L ${layer}.${r}: no hit-stop below the critical (the engine's rule from 1.9.24: its steps 0-2 hold nothing)`, RG[layer][r].every((x) => !x.stop));
  ck("L the callers keep no cut of their own for a blow's rungs", RG.REACT === undefined && BLOWS.every(([, s]) => s && !s.frames));
  const T = BLOWS.map(([, s]) => ticks(s));
  ck(`L reaction: scratch ${T[0]} < blow ${T[1]} <= hard blow ${T[2]} ticks, none a blink`, T[0] >= 6 && T[0] < T[1] && T[1] <= T[2]);
  for (const [name, s] of BLOWS) for (const o of [{}, { dtype: "laser" }, { dtype: "fire" }]) { const q = P.impactOf({ kind: s.kind === "heavy" ? "heavy" : "hit", amt: name === "scratch" ? 0.125 : name === "blow" ? 0.25 : 0.375, known: true }, 0, o);
    ck(`L reaction ${name} ${o.dtype ?? ""}: the engine's ladder, the rung's length, no full-field frame, no hit-stop`, !q.frames && ticks(q) === ticks(s) && SEEDS.every((sd) => full(q, sd).frames.every((x) => !x.full && !x.stop))); }
  ck("L reaction: a scratch never flashes (a blow, a shot)", SEEDS.every((sd) => full(BLOWS[0][1], sd).frames.filter(isFlash).length === 0 && full({ ...BLOWS[0][1], kind: "shock" }, sd).frames.filter(isFlash).length === 0));
}

/* ---- S: seats ---- */
{ const sig = (p) => p.frames.map((x) => `${x.type}:${x.fig ?? ""}:${x.cu ?? ""}:${x.kb ?? ""}:${x.z ?? ""}:${x.ticks}:${x.full ? 1 : 0}`).join(" ");
  for (const [name, spec] of [["roll ordinary", roll(0.3)], ["roll ordinary (shot)", roll(0.3, "shooting")], ["roll strong", roll(0.55)], ["roll strong (charge)", roll(0.55, "charge")], ...BLOWS]) {
    let same = true, photo = true, still = true, show = true;
    for (const seed of SEEDS) {
      const a = seatPlan(spec, seed), b = seatPlan(spec, seed, { ...FULL }, { now: 9000, t0: 9000 }), g = seatPlan(spec, seed, PHOTO), r = seatPlan(spec, seed, FULL, { osReduced: true });
      if (sig(a) !== sig(b) || a.ms !== b.ms) same = false;
      if (!(g.mode === "local" && g.ticks === a.ticks && g.ms === a.ms && g.frames.every((x) => !x.full && !x.stop && (x.fig == null || x.fig === "r") && x.cu == null))) photo = false;
      if (!(r.mode === "static" && r.frames.filter((x) => x.type !== "rest").length === 1 && r.frames.every((x) => !x.punch && !x.stop) && r.tableMs === a.ms)) still = false;
      /* a show for its whole length: the figures and the cut-in on every drawing, still moving on the last */
      const live = a.frames.filter((x) => x.type !== "rest");
      if (!(live.every((x) => typeof x.fig === "string" && x.fig && x.cu > 0) && live.every((x) => x.ticks <= 2))) show = false;
    }
    ck(`S ${name}: two ordinary seats, the same drawings and length`, same);
    ck(`S ${name}: a photosensitive seat: the same length, rims only, no cut-in, no full frame, no hit-stop`, photo);
    ck(`S ${name}: a reduced-motion seat: one still, the table's length to wait`, still);
    ck(`S ${name}: the figures and the cut-in on every drawing, no drawing held over two ticks`, show);
  }
}
console.log(`sweep caller6: ${n} checks, ${f} failed`);
if (f) process.exit(1);
