// node scripts/tactics/check-fxt.mjs -- fixer FXT: items Z2-Z18 of section 6 of dev/combat-decisions.md ("the code differs from the book"),
// each block naming its book lines. Every block fails on tag tactics-integrated-59 and passes on the fix, except Z5, Z9 and Z13, which the
// code already did (the block pins it). Z10 and Z18 are left (dev/combat-questions.md, FXT). Scripted table, no Foundry.
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./mods-pure.mjs";
import * as K from "./kit-pure.mjs";
import * as MP from "./movement-pure.mjs";
import * as Veh from "./flows/vehicle.mjs";
import * as FK from "./flows/kit.mjs";
import { ROWS } from "./kitdata-pure.mjs";
import { EN, PL } from "./lang.mjs";

const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const why = (env) => env?.error?.params?.reason ?? null;
const decl = (actor, action, extra = {}) => ({ op: "declare", actor, decl: { action, ...extra } });
const st = (T, cid) => M.statusesOf(T.state, cid).map((s) => s.id);
/* a helper the fix added is missing on the old tree: the check fails there instead of crashing the suite */
const soft = (o, name) => (typeof o?.[name] === "function" ? o[name] : () => undefined);
const auto = (id, name, type, o = {}) => ({ id, name, type, show: o.show !== false, attr: o.attr ?? [], bonus: o.bonus ?? 0, stress: o.stress ?? 0, damage: o.damage ?? 0, min: o.min ?? 0, max: o.max ?? 0, bypass: false });
const item = (id, name, type, o = {}) => ({ id, name, type, level: o.level ?? null, power: o.power ?? null, boosts: o.boosts ?? [], autos: o.autos ?? [], fx: o.fx ?? [], flags: { kit: null, off: false, types: [], ...(o.flags ?? {}) }, wf: o.wf ?? {} });
/* the table of check-kit.mjs (characters carry kits) with the small map of check-hazards.mjs (zones z1..z4) */
class FT extends Table {
  constructor(o) { super(o); this.map = { zones: { z1: {}, z2: {}, z3: {}, z4: {} }, borders: [{ id: "z1|z2", a: "z1", b: "z2", wall: null, door: null }], registry: {} }; }
  give(cid, items, bonus = {}) { const c = this.c[cid]; c.src = items; c.kit = K.build({ items, attrs: c.attrs }); c.pass = c.kit.pass; c.bonus = bonus; return this; }
  facts() {
    const f = super.facts(), T = this;
    const place = (cid) => (T.c[cid] ? { zone: T.c[cid].zone, level: "ground", spot: T.c[cid].zone, area: null } : null);
    return { ...f, canTalk: () => true, weapon: (cid, ref) => (ref == null || ref === "unarmed" ? { ...f.weapon(cid, ref), ...(T.c[cid]?.kit?.unarmed ?? {}) } : T.c[cid]?.kit?.weapons.find((w) => w.id === ref) ?? f.weapon(cid, ref)),
      zones: { place, reach: () => [], zone: (key) => (T.map.zones[key] ? { key, tags: [] } : null), states: () => [], graph: () => ({ zones: Object.keys(T.map.zones).map((id) => ({ id, flammable: false, tags: [] })), borders: T.map.borders }) } };
  }
}
const act = (T, cid, k) => T.c[cid].kit.actions.find((a) => a.id.endsWith(`-${k}`));
const base = (hItems = [], o = {}) => { const T = new FT(); T.hero("H1", "p1", { zone: "z1", ...(o.h1 ?? {}) }).hero("H2", "p2", { zone: "z2" }).npc("N1", { health: 6, zone: "z1", ...(o.n1 ?? {}) }).npc("N2", { health: 4, zone: "z4" }); T.give("H1", hItems).give("H2", o.h2Items ?? []).give("N1", o.n1Items ?? []).give("N2", []); T.order(["H1", "N1", "H2", "N2"]).turn("H1"); return T; };
const pass = async (T) => { const p = T.prompt("reaction"); if (p) await T.gm({ op: "answerFor", prompt: p.id, value: "pass" }); };
const noStunts = async (T) => { const p = T.prompt("stunts"); if (p) await T.gm({ op: "answerFor", prompt: p.id, value: [] }); };
const row = (name, of = null) => ROWS.find((r) => r.name === name && (of == null || r.of === of));

/* ================================================================== Z2 [B1940-1941]: Prolonged Phasing, immune to physical damage: a hazard
   (here a blast) passes the phased character by: no dodge asked, no damage; the one beside it is hit as before */
{
  const T = base();
  await T.gm({ op: "statusAdd", combatant: "H1", status: { id: "intangible" } });
  const h0 = T.c.H1.health, n0 = T.c.N1.health;
  T.dice.push([6, 3, 3, 2, 1, 4]);
  eq(code(await T.gm({ op: "hazardRun", run: { type: "blast", rating: 6 }, subject: { zone: "z1" } })), "ok", "Z2: the GM sets off a blast in the zone");
  eq(T.prompts("hazardDodge").map((p) => p.about), ["N1"], "Z2 [B1941]: the phased hero is not asked to dodge (nothing reaches it)");
  await T.gm({ op: "answerFor", prompt: T.prompt("hazardDodge", "N1").id, value: "pass" });
  eq([T.c.H1.health, n0 - T.c.N1.health > 0, T.state.stack.length], [h0, true, 0], "Z2 [B1941]: the blast leaves the phased hero whole and hurts the NPC beside it");
  ok(soft(FK, "phased")(T.state, "H1") === true, "Z2: one reading of 'phased' for the attack flow and the hazards (flows/kit.mjs)");
}
/* ================================================================== Z3 [B2040]: a portal takes only human-sized characters: a huge or grown
   one moves without the portals (the map's profile names only tunnels as the passages it may use) */
{
  const bigFor = soft(MP, "bigFor");
  eq([bigFor({ huge: true }), bigFor({ pass: { grown: true } }), bigFor({})], [true, true, false], "Z3: huge or grown is not human-sized");
  const p = MP.apiProfile({ way: "walk", zones: 1 }, { big: true }), q = MP.apiProfile({ way: "walk", zones: 1 }, {});
  ok(Array.isArray(p.edges) && !p.edges.includes("portal") && p.edges.includes("tunnel"), "Z3 [B2040]: the profile of a big character leaves the portals out");
  ok(!Array.isArray(q.edges) || q.edges.includes("portal") || q.edges == null, "Z3: a human-sized character keeps them");
}
/* ================================================================== Z4 [B2386]: moving inside a zone needs no action "but can only be done
   on your turn": a player's drag inside the zone off the turn is refused; the GM's passes (gmMayAllow) */
{
  const inZoneDrag = soft(MP, "inZoneDrag");
  const off = { staff: false, tactical: true, free: false, onTurn: false, from: "z1", to: "z1" };
  eq(inZoneDrag(off), "notYourTurn", "Z4: a player's drag inside the zone outside the turn is held");
  eq([inZoneDrag({ ...off, onTurn: true }), inZoneDrag({ ...off, staff: true }), inZoneDrag({ ...off, to: "z2" }), inZoneDrag({ ...off, tactical: false }), inZoneDrag({ ...off, free: true })], [null, null, null, null, null],
    "Z4: on the own turn, by the GM, into another zone (the map prices it), outside tactical play or set free: it passes");
  ok(!!EN["ITAC.why.notYourTurn"] && !!PL["ITAC.why.notYourTurn"], "Z4: the warning reuses the existing text");
}
/* ================================================================== Z5 [B1606-1609]: Snare keeps its level on the status: the penalty to break
   free is the level's (already so since P6; pinned) */
{
  const snare = item("sn", "Snare", "power", { autos: ["basic", "major", "massive", "unlimited"].map((lv, i) => auto(`Sn${i}`, `Snare - ${lv[0].toUpperCase()}${lv.slice(1)}`, "rollAttack", { attr: ["agility"], max: 1, show: i === 2 })) });
  const T = base([snare]);
  await T.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: "sn~Sn2" })); await pass(T); await T.roll("attack", 1); await noStunts(T);
  eq([st(T, "N1"), M.statusesOf(T.state, "N1")[0]?.data?.dice], [["snared"], -4], "Z5 [B1608]: Snare Massive: snared with -4 to break free");
}
/* ================================================================== Z6 [B2526-2527], [B2922]: a blast is dodged like a shot: more sixes on
   the dodge than the blast rolled earn the dodge move, one zone per six more, made by the module (the card of the dodge move) */
{
  const T = base();
  await T.gm({ op: "npcPolicy", combatant: "N1", policy: { dodge: "never" } });
  T.dice.push([6, 3, 3, 2, 1, 4]);
  await T.gm({ op: "hazardRun", run: { type: "blast", rating: 6 }, subject: { zone: "z1" } });
  await T.answer("p1", "hazardDodge", "dodge", "H1");
  await T.roll("def:H1", 3);
  const p = T.prompt("dodgeMove", "H1");
  eq([!!p, p?.data?.zones, p?.to], [true, 2, { users: ["p1"] }], "Z6 [B2527]: two sixes more than the blast: the dodger's card of a dodge move of two zones");
  ok(!!p?.options.some((o) => o.id === "move") && !!p?.options.some((o) => o.id === "pass"), "Z6: by hand (no map option fits) or not at all, as after a shot");
  if (p) await T.req("p1", { op: "answer", prompt: p.id, value: "pass" });
  eq(T.state.stack.length, 0, "Z6: passed, the blast is over");
}
/* ================================================================== Z7 [B1686]: Body Battery, once per scene in the same zone: in another
   zone it works again */
{
  eq(row("Body Battery")?.acts?.[0]?.once, "sceneZone", "Z7: the row says once per scene and zone");
  const T = base([item("ec", "Electricity Control", "power", { boosts: ["bb"] }), item("bb", "Body Battery", "boost", { power: "ec" })]);
  T.c.H1.resolve = 2;
  await T.req("p1", decl("H1", act(T, "H1", "battery").id)); await T.roll("roll", 1);
  const r1 = T.c.H1.resolve;
  await T.gm({ op: "nextRound" }); T.turn("H1");
  eq([code(await T.req("p1", decl("H1", act(T, "H1", "battery").id))), why(T.last)], ["illegal", "usedAlready"], "Z7: twice in the same zone: refused");
  T.c.H1.zone = "z2";
  eq(code(await T.req("p1", decl("H1", act(T, "H1", "battery").id))), "ok", "Z7 [B1686]: in another zone the battery charges again");
  ok(r1 > 2, "Z7: (the first charge gave stress back)");
}
/* ================================================================== Z8 [B1893]: Regeneration heals 1 Health by itself on each turn (no button) */
{
  const T = base([item("re", "Regeneration", "power")], { h1: { health: 3, maxHealth: 6 } });
  T.order(["N1", "H1", "H2", "N2"]).turn("N1");
  eq(T.c.H1.kit.actions.some((a) => a.id.endsWith("-regen")), false, "Z8: no button");
  await T.gm({ op: "endTurn", actor: "N1", round: T.state.round, slot: T.state.init.cur, force: true });
  for (let i = 0; i < 4 && T.state.init.curMember !== "H1"; i++) { const q = T.prompt("triggerQueue"); if (q) await T.gm({ op: "answerFor", prompt: q.id, value: q.options[0].id }); else break; }
  eq([T.state.init.curMember, T.c.H1.health], ["H1", 4], "Z8 [B1893]: at the start of its turn the hero gets 1 Health back");
  const U = base([item("re", "Regeneration", "power")], { h1: { health: 6, maxHealth: 6 } });
  U.order(["N1", "H1", "H2", "N2"]).turn("N1");
  await U.gm({ op: "endTurn", actor: "N1", round: U.state.round, slot: U.state.init.cur, force: true });
  eq(U.c.H1.health, 6, "Z8: never past the maximum");
}
/* ================================================================== Z9 [B1574]: afflicted, a move costs a full action (already so since P3; pinned) */
{
  const T = base();
  await T.gm({ op: "statusAdd", combatant: "H1", status: { id: "afflicted" } });
  ok(MP.conditionsOf(T.state, "H1", T.c.H1).afflicted === true, "Z9 [B1574]: the afflicted status is a condition of the move");
}
/* ================================================================== Z11 [B1944]: Environment Phasing: the trapped target breaks free with
   STRENGTH at -2; [B1822-1828]: a telekinetic throw is a knockback the thrower aims, the level's damage at every impact minus Armor */
{
  const ep = row("Environment Phasing")?.acts?.[0]?.effect;
  eq([ep?.id, ep?.data?.dice, ep?.data?.attr], ["trapped", -2, "strength"], "Z11 [B1944]: the status carries STRENGTH and -2 for the escape");
  const tk = K.build({ items: [item("tk", "Telekinesis", "power", { autos: ["basic", "major", "massive", "unlimited"].map((lv, i) => auto(`Tk${i}`, `Throw Target - ${lv[0].toUpperCase()}${lv.slice(1)}`, "rollAttack", { attr: ["intuition"], max: 2, show: i === 1 })) })], attrs: {} });
  const w = tk.weapons.find((x) => x.onHit?.throw);
  eq([w?.onHit?.throw, w?.onHit?.zones], [4, 3], "Z11 [B1823-1826]: Telekinesis Major throws 3 zones with 4 damage at an impact");
}
/* ================================================================== Z12 [B1816]: allies of Delayed Summoning are not there before their
   summoner's next turn: they cannot be attacked (the GM may allow it) */
{
  const T = base([item("su", "Summoning", "power", { boosts: ["ds"] }), item("ds", "Delayed Summoning", "limit", { power: "su" })]);
  await T.req("p1", decl("H1", act(T, "H1", "summon").id, { opt: "versatile" }));
  const vid = Object.keys(T.c).find((k) => T.c[k].summonOf === "H1");
  eq(soft(FK, "notArrived")(T.state, vid), true, "Z12: the delayed allies wait");
  T.turn("N1");
  const r = await T.gm(decl("N1", "slugfest", { targets: [vid] }));
  eq([code(r), why(r), r?.error?.params?.gmMayAllow], ["illegal", "notArrived", 1], "Z12 [B1816]: they cannot be attacked before they arrive (the GM may allow it)");
  ok(!!EN["ITAC.reason.notArrived"] && !!PL["ITAC.reason.notArrived"], "Z12: the reason has its words");
}
/* ================================================================== Z13 [B1934]: Mass Healing checks every further target (already so; pinned) */
{
  const T = base([item("he", "Healing", "power", { boosts: ["mh"] }), item("mh", "Mass Healing", "boost", { power: "he" })]);
  T.add("H3", { owners: ["p3"], health: 1, maxHealth: 6, zone: "z4" }); T.give("H3", []); T.c.H2.zone = "z1"; T.c.H2.health = 3;
  await T.gm({ op: "roster" });
  eq(code(await T.req("p1", decl("H1", act(T, "H1", "massHeal").id, { targets: ["H2", "H3"] }))), "illegal", "Z13 [B1934]: a further target in another zone is refused");
}
/* ================================================================== Z14 [B1622]: Windup Strike without the wind-up: the bare slugfest attack
   goes ahead, only without STRIKE's effects (the damage bonus) */
{
  const strike = (more) => [item("st", "Strike", "power", { boosts: more.map((m) => m.id) }), ...more];
  const T = base(strike([item("ws", "Windup Strike", "limit", { power: "st" })]), { h1: { slugfest: { damage: 5 } } });
  T.c.H1.slugfest = { ...(T.c.H1.slugfest ?? {}), damage: 5 };
  eq(code(await T.req("p1", decl("H1", "slugfest", { targets: ["N1"] }))), "ok", "Z14 [B1622]: no refusal (noWindup was refused before)");
  await pass(T); await T.roll("attack", 1); await noStunts(T);
  ok(T.c.N1.health > 6 - 5, "Z14: the hit does less than the sheet's slugfest damage, STRIKE's bonus left out");
}
/* ================================================================== Z15 [B1937]: Life Leech on an unwilling target needs a FIGHTING roll to
   touch it; without a six nothing is drained */
{
  const T = base([item("he", "Healing", "power", { boosts: ["ll"] }), item("ll", "Life Leech", "limit", { power: "he" })], { h1: { health: 2, maxHealth: 6 } });
  await T.req("p1", decl("H1", act(T, "H1", "leech").id, { targets: ["N1"] })); await T.roll("roll", 1);
  const q = T.requests.at(-1);
  eq([q?.key, q?.attr], ["touch", "fighting"], "Z15 [B1937]: the FIGHTING roll to touch the unwilling target");
  await T.roll("touch", 0);
  eq([T.c.H1.health, T.c.N1.health], [2, 6], "Z15: no touch, nothing drained");
}
/* ================================================================== Z16 [B3144]: on a mount the handling rolls use the mount's AGILITY */
{
  const v = { state: { statuses: { H1: [{ id: "inVehicle", data: { vehicle: "V1", role: "driver" } }] }, vehicles: { V1: { driver: "H1", crew: [] } } }, facts: { c: (id) => (id === "V1" ? { vehicle: { mountAgility: 4 } } : { attrs: { agility: 1 } }) } };
  eq(soft(Veh, "mountAgility")(v, "V1"), 4, "Z16: the mount's AGILITY");
  eq(soft(Veh, "attackRollBase")(v, { actor: "H1", data: { kind: "ram" } }), 4, "Z16 [B3144]: a ram on the mount rolls the mount's AGILITY, not the rider's");
}
/* ================================================================== Z17 [B3147], [B3439]: a vehicle's own weapons (vehicleWeapon items) are
   fired from aboard: named as veh~<vehicle>~<item>, refused when not aboard or the weapons are disabled */
{
  const parse = soft(Veh, "parseVehRef"), legal = soft(Veh, "weaponLegality");
  eq(parse("veh~V1~gun1"), { vehicle: "V1", item: "gun1" }, "Z17: the weapon reference of a vehicle");
  const v = (stat, rec) => ({ state: { statuses: stat, vehicles: { V1: rec } }, facts: { c: () => ({}) } });
  const aboard = { H1: [{ id: "inVehicle", data: { vehicle: "V1", role: "crew" } }] };
  eq(legal(v({}, { crew: [] }), { actor: "H1", decl: { weapon: "veh~V1~gun1" } })?.reason, "notAboard", "Z17 [B3147]: only from aboard");
  eq(legal(v(aboard, { crew: ["H1"] }), { actor: "H1", decl: { weapon: "veh~V1~gun1" } }), null, "Z17: the crew fires it");
  eq(legal(v(aboard, { crew: ["H1"], off: { weapon: true } }), { actor: "H1", decl: { weapon: "veh~V1~gun1" } })?.reason, "weaponDisabled", "Z17: not with the weapons disabled");
  ok(!!EN["ITAC.reason.weaponDisabled"] && !!PL["ITAC.reason.weaponDisabled"], "Z17: the reason has its words");
}
done("check-fxt");
