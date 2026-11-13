// node scripts/tactics/check-fxo2.mjs -- FXO2 (U216): the chase panel's catch is one short row per unit, no Foundry:
//   who strikes (with the strike and its target, or "pick a target"), and who reached the fleeing but does not strike with the unit's
//   stuck word; each row's tooltip is its whole sentence, and the beat's whole line stays for the strip's tooltip.
import { readFileSync } from "node:fs";
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import * as V from "./view-pure.mjs";
import * as CP from "./ui/chase-pure.mjs";
import { t as say, EN, PL } from "./lang.mjs";

const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const car = (o = {}) => ({ kind: "vehicle", npc: true, health: 8, vehicle: { type: "ground", speed: 3, maneuver: 1, passengers: 3, weapons: 0 }, ...o });
const t = (k, p, fb) => say(k, p, fb === undefined ? k : fb);
const hiddenOf = (T) => Object.keys(T.c).filter((id) => T.c[id].hidden);
const facts = (T, v, me) => ({ view: v, staff: me === "gm", me, whole: me === "gm" ? (id) => T.c[id] ?? null : undefined,
  c: (id) => (T.c[id] && (me === "gm" || !T.c[id].hidden) ? { name: T.c[id].name ?? id, npc: !!T.c[id].npc, kind: T.c[id].kind ?? null, img: null, way: T.c[id].kind === "vehicle" ? null : CP.wayOf(T.c[id]) } : null), userName: (u) => `User ${u}`, online: () => true, rollBusy: () => false });
const view = (T, me, owns) => (me === "gm" ? T.state : V.viewFor(T.state, { id: me, staff: false, owns }, { hidden: hiddenOf(T), npc: Object.keys(T.c).filter((id) => T.c[id].npc) }));
const panel = (T, me, owns = []) => CP.chaseData(view(T, me, owns), {}, facts(T, view(T, me, owns), me), t);

async function table({ prey, pursuer, started }) {
  const T = new Table();
  T.hero("H1", "p1", { name: "Kid" }).hero("H3", "p3", { name: "Eve", movement: [{ mode: "flight", tier: "basic" }] });
  T.npc("N1", { name: "Doc" }).npc("N2", { name: "Mauler" });
  T.add("V1", car({ name: "Van" }));
  T.order(["H1", "N1", "N2", "H3"]).turn("H1");
  await T.gm({ op: "vehicleSet", vehicle: "V1", seat: { who: "H1", role: "driver" }, ...(started ? { started: true } : {}) });
  eq(code(await T.gm({ op: "chaseStart", prey, pursuer, distance: 1 })), "ok", `table: the chase starts (${pursuer} after ${prey})`);
  eq(code(await T.gm({ op: "chaseRound" })), "ok", "a chase round");
  await T.roll("prey", 0); await T.roll("pursuer", 3);
  eq(T.state.chase.distance, 0, "(caught)");
  return T;
}

/* a van never started reached them with Eve: Eve charges the one target, Kid (the van's driver) does not strike, with the van's stuck word */
{
  const T = await table({ prey: ["N1"], pursuer: ["V1", "H3"], started: false });
  for (const [me, owns] of [["p1", ["H1"]], ["p3", ["H3"]], ["gm", []]]) {
    const c = panel(T, me, owns).catch;
    eq(c.rows.map((r) => [r.kind, r.name, r.tag]), [["strike", "Eve", say("ITAC.chase.catch.at", { what: EN["ITAC.chase.catch.rowCharge"], name: "Doc" })], ["barred", "Kid", EN["ITAC.chase.stuck.notStarted"]]],
      `U216 ${me}: one row per unit: Eve "Charge: Doc", Kid "Not started"`);
    eq(c.rows.map((r) => r.tip), [say("ITAC.chase.catch.whoCharge", { name: "Eve", target: "Doc" }), say("ITAC.chase.catch.barred", { name: "Kid", why: EN["ITAC.reason.notStarted"] })], `U216 ${me}: each row's tooltip is its whole sentence`);
    ok(c.text.includes(c.rows[0].tip) && c.text.includes(c.rows[1].tip), `U216 ${me}: the whole line stays (the strip's tooltip)`);
    ok(c.rows.every((r) => r.tag.length <= 24), `U216 ${me}: the tags are short (${c.rows.map((r) => r.tag)})`);
  }
}
/* two to pick from: the striker's tag says it picks */
{
  const T = await table({ prey: ["N1", "N2"], pursuer: ["H3"], started: true });
  const c = panel(T, "p3", ["H3"]).catch;
  eq(c.rows.map((r) => [r.kind, r.tag]), [["strike", say("ITAC.chase.catch.rowPick", { what: EN["ITAC.chase.catch.rowCharge"] })]], "U216: with two to pick from, the striker's row says pick a target");
}
/* the DOM half draws the rows (no run-on sentence in a filled box); the style has no filled box around the list */
{
  const ui = readFileSync(new URL("./ui/chase.mjs", import.meta.url), "utf8"), css = readFileSync(new URL("../../styles/tactics-chase.css", import.meta.url), "utf8");
  ok(/d\.catch \? catchList\(d\.catch\)/.test(ui) && !/span\.itc-catch/.test(ui), "U216 DOM: the catch is drawn as the row list");
  ok(/\.itc-catch > li/.test(ui) || /ul\.itc-catch/.test(ui), "U216 DOM: a list of rows");
  const box = css.match(/\.itc-catch \{[^}]*\}/)?.[0] ?? "";
  ok(box && !/background/.test(box), "U216 style: the list itself has no filled box");
}
for (const L of [EN, PL]) for (const k of ["ITAC.chase.catch.rowRam", "ITAC.chase.catch.rowCharge", "ITAC.chase.catch.rowPick"]) ok(typeof L[k] === "string" && L[k], `FXO2: ${k} in ${L === EN ? "EN" : "PL"}`);
eq([PL["ITAC.chase.catch.rowRam"], PL["ITAC.chase.catch.rowCharge"]], ["Taran", "Szarża"], "FXO2: the Polish words");
done("check-fxo2");
