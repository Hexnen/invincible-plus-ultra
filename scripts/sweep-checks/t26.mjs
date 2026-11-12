// node scripts/sweep-checks/t26.mjs  (T046-T056 fixes in flows/chase, hazards, challenge, kit)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as Hz from "../tactics/flows/hazards.mjs";
import * as K from "../tactics/flows/kit.mjs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const src = (p) => readFileSync(fileURLToPath(new URL("../tactics/flows/" + p, import.meta.url)), "utf8");
const lineOf = (s, k) => s.split("\n").find((l) => l.includes(k)) ?? "";

// T046 / T047: chase sideRoll (needs the engine; assert on source)
const ch = lineOf(src("chase.mjs"), "function sideRoll") ? src("chase.mjs").split("function sideRoll")[1].split("\n}")[0] : "";
// T046 not fixed: check-p7 F pins an ordinary NPC prey as pushable
ck("T047 chase roll applies token writes", ch.includes("bp.writes") && ch.includes('t: "state"'));
// T048 hazard rolls
const hz = src("hazards.mjs");
ck("T048 three hazard rolls apply writes", (hz.match(/for \(const wr of bp\.writes\)/g) ?? []).length >= 3);
// T049
ck("T049 toxin save applies writes", lineOf(src("challenge.mjs"), 'K.rollEffect("save"').includes("bp.writes") || src("challenge.mjs").includes("const bp = K.buildPool(v, I, \"save\""));
ck("T049 writes pushed", /bp = K\.buildPool\(v, I, "save"[^\n]*for \(const wr of bp\.writes\)/.test(src("challenge.mjs")));
// T050 zone default targets
const facts = { c: (id) => ({ H: { kind: "hero" }, CH: { kind: "challenge" }, MG: { kind: "minions", health: 0 }, MO: { kind: "minions", health: 3 }, GONE: { kind: "npc", present: false } })[id], inZoneKey: () => ["H", "CH", "MG", "MO", "GONE"] };
const sp = Hz.specOf({ type: "blast", rating: 4 }, { zone: "z1" }, { facts });
ck("T050 zone default skips challenge, emptied group, absent", JSON.stringify(sp.decl.targets) === JSON.stringify(["H", "MO"]));
const sp2 = Hz.specOf({ type: "blast", rating: 4, targets: ["CH"] }, { zone: "z1" }, { facts });
ck("T050 explicit targets untouched", sp2.decl.targets[0] === "CH");
// T051
ck("T051 vulnerable does not breach", hz.includes("barrierBreached(row.barrier, taken) && !row.vulnerable"));
// T054 injective ids
const mkF = (zones) => ({ zones: {}, c: () => ({ present: true }) });
{
  const state = { ledger: {}, challenges: {}, triggers: [] };
  const zs = [{ zone: "z-1", at: "a", intensity: 6, refs: [] }, { zone: "z1", at: "a", intensity: 6, refs: [] }];
  const facts2 = { c: () => ({ present: true, health: 5 }), zones: { __b: zs } };
  // burningZones/occupants need the map; check slug through source instead
  ck("T054 slug keeps - and _", hz.includes('replace(/[^A-Za-z0-9_@-]/g, "")'));
}
// T056 Merciless with two breaks in one step
{
  const hero = { resolve: 1, maxResolve: 4, npc: false, pass: { merciless: true }, kind: "hero" }, foe = (id) => ({ npc: true, kind: "npc", health: 0, maxHealth: 5, pass: { noCrit: true }, id });
  const v = { state: { npc: {} }, facts: { c: (id) => (id === "H" ? hero : foe(id)) } };
  const I = { data: { pk: {}, flags: {} }, decl: {} }, R = { effects: [], events: [], prompts: [] };
  try {
    for (const t of ["A", "B"]) K.brokenAndCrit(v, I, R, t, { taken: 5, healthBefore: 3 }, { by: "H" });
    const w = R.effects.filter((e) => e.t === "actor" && e.path === "resolve").map((e) => e.to);
    ck("T056 second break counts the first gain", w.length === 2 && w[1] === 3);
  } catch (e) { console.log("T056 harness error", e.message); ck("T056 harness", false); }
}
console.log(`sweep t26: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
