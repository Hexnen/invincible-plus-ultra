// node scripts/tactics/check-fxl2.mjs -- FXL2: faults of the second full live fight (FF7).
//   U212 a standing building with storeys [B2416] (P8b-6, P8b-R11: a storey is one zone of vertical movement): the move offers each
//        storey as a place of its own (from outside, from the ground of the building, from a storey, from the rooftop), priced by the
//        map's plan; a storey never becomes the one-click way; a wrecked building has none; a drag onto a zone is its ground
//   U214 the GM desk: opening a folded section scrolls the desk's body so the section's controls (the Table tab's "Kto") are not left
//        under its fold, where a click reached the map
//   U215 the GM desk's Scene tab: a set-up (not running) chase stands after the vehicles and challenges, so a vehicle's "Posadź" is
//        not pushed under the fold by the chase's form
import { readFileSync } from "node:fs";
import { ok, eqc as eq, done } from "./testkit.mjs";
import * as MP from "./movement-pure.mjs";
import { t as say, EN, PL } from "./lang.mjs";
import { revealBy } from "./ui/desk.mjs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const t = (k, prm, fb) => say(k, prm, fb);

/* ================================================================== a fake map: z1 open ground, z2 a building with two storeys, z3 a wrecked
   building with two storeys; z1|z2 and z1|z3 open. Plans as zones-api.md sections 2-3: walking climbs the storeys (a storey its number,
   the rooftop one above the top storey), a flyer crossing zones changes level as part of the move, a level change inside one zone is 1. */
function fakeMap(at, zones = { z1: {}, z2: { building: true, floors: 2, rooftop: true }, z3: { building: true, floors: 2, rooftop: false, wrecked: true } }) {
  const parse = (s) => { const [zone, lv] = String(s).split(":"), f = /^f(\d+)$/.exec(lv ?? ""); return zones[zone] ? { zone, spot: s === `${zone}:ground` ? zone : s, level: f ? "floor" : lv ?? "ground", floor: f ? Number(f[1]) : 0, area: null, airborne: lv === "elevated" && !zones[zone].rooftop } : null; };
  const height = (p) => (p.level === "floor" ? p.floor : p.level === "elevated" ? (zones[p.zone].rooftop ? (zones[p.zone].floors ?? 0) + 1 : 1) : 0);
  const nb = (a, b) => a === b ? 0 : [a, b].includes("z1") ? 1 : 2;
  const places = { ...at };
  return {
    place: (cid) => (places[cid] ? parse(places[cid]) : null), placeOf: (s) => parse(s), states: () => [], zone: (k) => (zones[k] ? { key: k, ...zones[k] } : null),
    reach: (cid, prof, max) => Object.keys(zones).map((z) => ({ zone: z, d: nb(parse(places[cid]).zone, z) })).filter((r) => r.d <= max),
    plan: (cid, to, prof) => {
      const a = parse(places[cid]), b = typeof to === "string" ? parse(to) : parse(to.level === "floor" ? `${to.zone}:f${to.floor}` : to.level && to.level !== "ground" ? `${to.zone}:${to.level}` : to.zone);
      if (!a || !b) return null;
      const borders = nb(a.zone, b.zone), walk = prof.way === "walk";
      if (walk && (b.airborne || (b.level === "elevated" && !zones[b.zone].rooftop))) return null;
      const levels = walk ? (a.zone === b.zone ? Math.abs(height(a) - height(b)) : height(a) + height(b)) : (borders ? 0 : height(a) === height(b) ? 0 : 1);
      return { total: borders + levels, zones: [...new Set([a.zone, b.zone])], steps: [] };
    },
  };
}
const walker = { id: "H1", name: "Kid", attrs: { strength: 3 }, resolve: 3, health: 6, movement: [] };
const flyer = { id: "H1", name: "Kid", attrs: { strength: 3 }, resolve: 3, health: 6, movement: [{ mode: "flight", tier: "basic" }] };
const state = { statuses: {}, stack: [], prompts: {}, budgets: {} };
const pay = () => ({ ok: true });
const opts = (where, c) => MP.moveOptions(fakeMap({ H1: where }), state, "H1", c, pay);
const tos = (list, pred = () => true) => list.filter(pred).map((o) => `${o.mode}|${o.to}`);

/* ================================================================== U212: storeys are places of the move */
{
  eq([MP.storeysOf({ rooftop: true, floors: 2 }), MP.storeysOf({ rooftop: false, floors: 2 }), MP.storeysOf({ rooftop: true, floors: 0 }), MP.storeysOf(null), MP.storeysOf({ rooftop: true, floors: 99 })], [2, 0, 0, 0, MP.MAX_STOREYS],
    "U212: the storeys of a standing building are its `floors`; a wrecked one (no rooftop) and a plain one none; a wild number is capped");
  /* from outside, on foot: the ground of z2 only - its first storey is two zones of movement (in, then up the stairs), out of one
     quick action of walking (one zone [B2383]): not offered, as a zone out of reach is not */
  const o1 = opts("z1", walker), w1 = tos(o1, (o) => o.zone === "z2");
  eq(w1, ["walk|z2"], "U212: from outside on foot: the ground of the building (a storey is a second move)");
  ok(!o1.some((o) => o.zone === "z3" && o.floor), "U212: a wrecked building has no storeys to climb [B2457]");
  /* inside the building, on its ground: up the stairs to the first storey (one zone), as a row of the zone stood in */
  const g = opts("z2", walker), gh = tos(g, (o) => o.here);
  eq(gh, ["walk|z2:f1"], "U212: on the ground of the building: up the stairs to the first storey, a move inside the zone (the second is two zones up)");
  const f1 = g.find((o) => o.to === "z2:f1");
  eq([f1.floor, f1.zone, f1.disabled, f1.here, f1.cost], [1, "z2", null, 1, "quick"], "U212: a storey is a row of its own: its number, its zone, one quick action [B2416]");
  /* on a storey: down to the ground on foot (the stairs; before, only a way that is not walking could leave a level), the other storey */
  const s = opts("z2:f1", walker), sh = tos(s, (o) => o.here);
  ok(sh.includes("walk|z2") && sh.includes("walk|z2:f2") && !sh.includes("walk|z2:f1"), `U212: on the first storey: down the stairs to the ground and up to the second, not the one stood on (${sh})`);
  /* on the second storey on foot: the ground is two storeys down, out of one move - not offered greyed (FF7 after the fix: "too far"),
     the first storey is */
  const s2 = tos(opts("z2:f2", walker), (o) => o.here);
  eq(s2, ["walk|z2:f1"], "U212: on the second storey on foot: down one storey; the ground (two down) is not offered");
  /* a flyer on the rooftop (FF7: Kid Omni-Man glided onto the roof of z2): the storeys below it as well */
  const r = opts("z2:elevated", flyer), rh = tos(r, (o) => o.here && o.floor);
  ok(rh.includes("flight|z2:f2") && rh.includes("flight|z2:f1"), `U212: from the rooftop the storeys below (${rh})`);
  /* a flyer from outside: the storeys too, as the map prices them (by a window: zones-api.md section 3) */
  const fo = tos(opts("z1", flyer), (o) => o.zone === "z2" && o.floor);
  ok(fo.includes("flight|z2:f1") && fo.includes("flight|z2:f2"), `U212: a flyer from outside: the storeys as the map prices them (${fo})`);
  /* the menu rows name the storey */
  const src = read("./ui/model-pure.mjs");
  ok(/o\.floor \? t\("ITAC\.ui\.way\.floor", \{ n: o\.floor \}\)/.test(src) && /\(x\.floor \? 1 : 0\) - \(y\.floor \? 1 : 0\)/.test(src), "U212: a way's row names its storey; a storey sorts after the ground at the same price (never the one-click way)");
  eq([EN["ITAC.ui.way.floor"], PL["ITAC.ui.way.floor"]], ["to floor {n}", "na piętro {n}"], "U212: the storey has its words in both languages");
  /* a drag onto a zone (no level named) is its ground, never a storey */
  ok(/!o\.elevated && !o\.floor && !to\.includes\(":"\)/.test(read("./movement.mjs")), "U212: a token dragged onto z2 asks for the ways to its ground, not to its storeys");
  /* the dodge move's card carries the storey, so its row names it */
  ok((read("./flows/attack.mjs").match(/\.\.\.\(x\.floor \? \{ floor: x\.floor \} : \{\}\)/g) ?? []).length === 2 && /\.\.\.\(x\.floor \? \{ floor: x\.floor \} : \{\}\)/.test(read("./flows/hazards.mjs")), "U212: a dodge move's options carry the storey");
}

/* ================================================================== U214 / U215: the GM desk */
{
  const body = { top: 100, bottom: 400 };
  eq([revealBy({ top: 150, bottom: 380 }, body), revealBy({ top: 300, bottom: 520 }, body), revealBy({ top: 200, bottom: 900 }, body), revealBy({ top: 100, bottom: 400 }, body)], [0, 120, 100, 0],
    "U214: a section opened inside the body is not scrolled; one under the fold scrolls up by what it lacks; a tall one stops with its head at the top");
  const src = read("./ui/desk.mjs");
  ok(/data: \{ fold: shut \? "shut" : "open", fid: id \}/.test(src) && /handlers\.fold\?\.\(id\); if \(shut\) reveal\(id\);/.test(src),
    "U214: a folded section names itself and opening it brings it into view");
  ok(/c\.on \? \[section\(c\.title, 0, chase\), \.\.\.parts\] : \[\.\.\.parts, section\(c\.title, 0, chase\)\]/.test(src),
    "U215: a running chase leads the Scene tab; a chase only being set up stands after the vehicles and challenges");
}

done("check-fxl2");
