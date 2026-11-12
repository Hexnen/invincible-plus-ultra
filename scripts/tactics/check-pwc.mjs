// node scripts/tactics/check-pwc.mjs -- fixer PWC: findings PW004-PW028, PW106 and PW119 of the powers review (attack powers, the element
// controls, Barrier), each block naming its book lines. The kit is built from items as the sheet carries them (K.build) and played through
// the REAL director, engine, ledger and journal on a scripted table (no Foundry). Choices the book leaves open: dev/combat-questions.md, PWC.
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import * as M from "./mods-pure.mjs";
import * as K from "./kit-pure.mjs";
import * as FK from "./flows/kit.mjs";
import { damage } from "../rules/index.mjs";
import { ROWS } from "./kitdata-pure.mjs";
import { EN, PL } from "./lang.mjs";

const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const why = (env) => env?.error?.params?.reason ?? null;
const decl = (actor, action, extra = {}) => ({ op: "declare", actor, decl: { action, ...extra } });
const st = (T, cid) => M.statusesOf(T.state, cid).map((s) => s.id);
const both = (k) => typeof EN[k] === "string" && typeof PL[k] === "string";
const auto = (id, name, type, o = {}) => ({ id, name, type, show: o.show !== false, attr: o.attr ?? [], bonus: o.bonus ?? 0, stress: o.stress ?? 0, damage: o.damage ?? 0, min: o.min ?? 0, max: o.max ?? 0, bypass: false });
const item = (id, name, type, o = {}) => ({ id, name, type, level: o.level ?? null, power: o.power ?? null, boosts: o.boosts ?? [], autos: o.autos ?? [], fx: o.fx ?? [], flags: { kit: null, off: false, types: [], ...(o.flags ?? {}) }, wf: o.wf ?? {} });
const LV = ["Basic", "Major", "Massive", "Monstrous"];
const levels = (pre, name, fn) => LV.map((w, i) => auto(`${pre}${i}`, `${name} - ${w}`, "rollAttack", fn(i)));
const row = (name, of = null) => ROWS.find((r) => r.name === name && (of == null || r.of === of));

/* a table whose characters carry kits, with a small map: zones z1..z4 (the testkit's ranges: one zone apart unless set), zone states and
   the map's state records (`T.dark[zone]`: the records of a darkness, naming its maker) */
class FT extends Table {
  constructor(o) { super(o); this.dark = {}; }
  give(cid, items) { const c = this.c[cid]; c.src = items; c.kit = K.build({ items, attrs: c.attrs }); c.pass = c.kit.pass; c.bonus = {}; c.immunities = [...new Set([...(c.immunities ?? []), ...c.pass.immune])]; return this; }
  facts() {
    const f = super.facts(), T = this;
    const place = (cid) => (T.c[cid] ? { zone: T.c[cid].zone, level: "ground", spot: T.c[cid].zone, area: null } : null);
    return { ...f, canTalk: () => true, weapon: (cid, ref) => (ref == null || ref === "unarmed" ? { ...f.weapon(cid, ref), ...(T.c[cid]?.kit?.unarmed ?? {}) } : T.c[cid]?.kit?.weapons.find((w) => w.id === ref) ?? f.weapon(cid, ref)),
      zones: { place, reach: () => [], zone: (key) => ({ key, tags: [] }), states: (ref) => T.dark[String(ref).split(":")[0]] ?? [],
        graph: () => ({ zones: ["z1", "z2", "z3", "z4"].map((id) => ({ id, flammable: false, tags: [] })), borders: [] }) } };
  }
}
const base = (h1 = [], o = {}) => {
  const T = new FT();
  T.hero("H1", "p1", { zone: "z1", ...(o.h1 ?? {}) }).hero("H2", "p2", { zone: o.h2zone ?? "z1" }).npc("N1", { health: 6, zone: "z1", ...(o.n1 ?? {}) }).npc("N2", { health: 6, zone: "z2", ...(o.n2 ?? {}) });
  T.give("H1", h1).give("H2", o.h2 ?? []).give("N1", o.n1Items ?? []).give("N2", []);
  T.order(["H1", "N1", "H2", "N2"]).turn("H1"); return T;
};
const act = (T, cid, k) => T.c[cid].kit.actions.find((a) => a.id.endsWith(`-${k}`));
const passAll = async (T) => { for (let i = 0; i < 6; i++) { const p = T.prompt("reaction"); if (!p) break; await T.gm({ op: "answerFor", prompt: p.id, value: "pass" }); } };
const noStunts = async (T) => { const p = T.prompt("stunts"); if (p) await T.gm({ op: "answerFor", prompt: p.id, value: [] }); };
const finish = async (T) => { for (let i = 0; i < 8; i++) { const p = T.prompts()[0]; if (!p) break; await T.gm({ op: "answerFor", prompt: p.id, value: p.kind === "stunts" ? [] : p.options?.find((o) => o.id === "pass")?.id ?? p.options?.[0]?.id ?? "pass" }); } };

/* ================================================================== PW004 [B1601-1603]: Potent Emanation: who touches its holder while the
   aura is on takes 4 damage (PWC-1: a blow of the slugfest family that lands; the striker's Armor counts) */
{
  const em = (on) => [item("em", "Emanation", "power", { boosts: ["pe"], fx: [{ id: "f1", name: "Emanation", on }] }), item("pe", "Potent Emanation", "boost", { power: "em" })];
  eq([K.build({ items: em(false) }).pass.touchHarm, K.build({ items: em(true) }).pass.touchHarm], [undefined, 4], "PW004 [B1602]: the touch harm counts only while the aura is on");
  eq(K.build({ items: [...em(false), item("ce", "Continual Emanation", "limit", { power: "em" })] }).pass.touchHarm, 4, "PW004 [B1603]: Continual Emanation keeps it on");
  const T = base([], { n1Items: em(true) });
  const h0 = T.c.H1.health;
  eq(code(await T.req("p1", decl("H1", "slugfest", { targets: ["N1"] }))), "ok", "PW004: H1 strikes the holder of the aura");
  await passAll(T); await T.roll("attack", 1); await noStunts(T); await finish(T);
  eq([h0 - T.c.H1.health, T.state.stack.length], [4, 0], "PW004 [B1602]: the blow lands, the striker takes 4 damage");
  const U = base([], { n1Items: em(true), h1: { armor: [{ id: "vest", armor: 3 }] } });
  await U.req("p1", decl("H1", "slugfest", { targets: ["N1"] })); await passAll(U); await U.roll("attack", 1); await noStunts(U); await finish(U);
  eq(U.c.H1.health, 5, "PW004 (PWC-1): the striker's Armor 3 counts against the 4");
  const V = base([], { n1Items: em(true) });
  await V.req("p1", decl("H1", "slugfest", { targets: ["N1"] })); await passAll(V); await V.roll("attack", 0); await finish(V);
  eq(V.c.H1.health, 6, "PW004: a blow that misses touches nothing");
}
/* ================================================================== PW005 [B1611] (FXT-4): Immobilize Only: snared, only moving is barred; the
   way out is SNARE's (with the level's penalty) */
{
  const snare = (lv, extra = []) => [item("sn", "Snare", "power", { boosts: extra.map((x) => x.id), autos: levels("Sn", "Snare", (i) => ({ attr: ["agility"], max: 1, show: i === lv })) }), ...extra];
  const io = item("io", "Immobilize Only", "limit", { power: "sn" });
  const T = base(snare(1, [io]));
  await T.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: "sn~Sn1" })); await passAll(T); await T.roll("attack", 1); await finish(T);
  const s = M.statusesOf(T.state, "N1")[0];
  eq([s?.id, s?.data?.dice, s?.data?.moveOnly], ["snared", -3, 1], "PW005 [B1611], FXT-4: snared, the Major level's -3 to break free, moving only");
  const c = M.conditions(T.state, "N1");
  eq([c.snared, c.rooted], [false, true], "PW005: not snared for attacks, rooted for moving");
  T.turn("N1");
  eq([code(await T.gm(decl("N1", "charge", { targets: ["N2"] }))), why(T.last)], ["illegal", "snared"], "PW005 [B1611]: no charge (it moves)");
  eq(code(await T.gm(decl("N1", "slugfest", { targets: ["H1"] }))), "ok", "PW005 [B1611]: a slugfest attack is allowed");
}
/* ================================================================== PW006 [B1610]: Multiple Snares: up to three targets in range, one roll */
{
  const sn = [item("sn", "Snare", "power", { boosts: ["ms"], autos: levels("Sn", "Snare", (i) => ({ attr: ["agility"], max: 1, show: i === 0 })) }), item("ms", "Multiple Snares", "boost", { power: "sn" })];
  eq(K.build({ items: sn }).weapons.map((w) => w.several), [3], "PW006: the snare takes up to three");
  const T = base(sn);
  T.npc("N3", { zone: "z3" }).npc("N4", { zone: "z1" }); T.give("N3", []).give("N4", []);
  eq([code(await T.req("p1", decl("H1", "shoot", { targets: ["N1", "N2", "N3", "N4"], weapon: "sn~Sn0" }))), why(T.last)], ["illegal", "tooManyTargets"], "PW006: four are too many");
  eq(code(await T.req("p1", decl("H1", "shoot", { targets: ["N1", "N2", "N3"], weapon: "sn~Sn0" }))), "ok", "PW006 [B1610]: three targets in three zones, all in range");
  await passAll(T);
  eq(T.requests.filter((r) => r.key === "attack").length, 1, "PW006: one attack roll");
  await T.roll("attack", 1); await finish(T);
  eq([st(T, "N1"), st(T, "N2"), st(T, "N3")], [["snared"], ["snared"], ["snared"]], "PW006: each target that does not dodge is snared");
}
/* ================================================================== PW007 [B1575], [B1596], [B1626]: the Mental boost lets the attack use a
   mental attribute; the attack's own one is kept when it rolls more */
{
  const af = (b) => [item("af", "Affliction", "power", { boosts: ["ma"], autos: [auto("a", "Affliction", "rollAttack", { attr: ["agility"], damage: 3, max: 1 })] }), item("ma", "Mental Affliction", "boost", { power: "af" })];
  const k1 = K.build({ items: af(), attrs: { agility: 6, reason: 3, intuition: 2, presence: 2 } });
  eq(k1.weapons.map((w) => [w.attr, w.alt ?? null, w.ignoreArmor]), [["reason", null, true], [null, "agility", true]], "PW007: the mental variant and the AGILITY one, both ignoring Armor");
  const k2 = K.build({ items: af(), attrs: { agility: 2, reason: 5, intuition: 3, presence: 3 } });
  eq(k2.weapons.length, 1, "PW007: only the mental one when it rolls more");
  ok(both("ITAC.kit.opt.alt"), "PW007: the variant's label exists in both languages");
}
/* ================================================================== PW011 [B1626], [B1628]: Mental Stun with Requires Touch: the same attack
   whatever the order of the items */
{
  const stun = item("st", "Stun", "power", { boosts: ["ms", "rt"], autos: [auto("a", "Stun", "rollAttack", { attr: ["agility"], damage: 3, max: 3 })] });
  const ms = item("ms", "Mental Stun", "boost", { power: "st" }), rt = item("rt", "Requires Touch (Stun)", "limit", { power: "st" }), attrs = { reason: 5 };
  const a = K.build({ items: [stun, ms, rt], attrs }).weapons, b = K.build({ items: [stun, rt, ms], attrs }).weapons;
  eq(JSON.stringify(a), JSON.stringify(b), "PW011: the order of the items changes nothing");
  eq([a[0].fam, a[0].attr], ["slug", "reason"], "PW011 [B1626], [B1628]: a blow, rolled with the mental attribute");
}
/* ================================================================== PW008, PW009 [B1618-1621]: Piercing Strike keeps Deadly and Toxic Strike;
   its stress is taken when it hits */
{
  const kit = [item("sk", "Strike", "power", { boosts: ["ps", "ds", "ts"] }), item("ps", "Piercing Strike", "boost", { power: "sk" }), item("ds", "Deadly Strike", "boost", { power: "sk" }), item("ts", "Toxic Strike", "boost", { power: "sk" })];
  const w = K.build({ items: kit }).weapons.find((x) => x.id === "unarmed~ps");
  eq([w?.ignoreArmor, w?.sharp, w?.onHit?.status, w?.stress, w?.stressOn], [true, true, "sick", 1, "hit"], "PW008 [B1618-1621]: the piercing blow is still sharp and toxic");
  const T = base(kit);
  await T.req("p1", decl("H1", "slugfest", { targets: ["N1"], weapon: "unarmed~ps" })); await passAll(T);
  await T.roll("attack", 0); await finish(T);
  eq(T.c.H1.resolve, 5, "PW009 [B1618]: a miss costs no stress");
  T.turn("H2"); T.turn("N2");
  await T.gm({ op: "nextRound" }); T.turn("H1");
  await T.req("p1", decl("H1", "slugfest", { targets: ["N1"], weapon: "unarmed~ps" })); await passAll(T);
  eq(T.c.H1.resolve, 5, "PW009: nothing taken on declaring");
  await T.roll("attack", 1); await finish(T);
  eq(T.c.H1.resolve, 4, "PW009 [B1618]: the hit costs 1 stress");
}
/* ================================================================== PW012 [B1637]: Animal Control takes all the animals of the target zone */
{
  const T = base([item("ac", "Animal Control", "power")], { n2: { zone: "z2" } });
  T.npc("A1", { zone: "z2" }).npc("A2", { zone: "z2" }).npc("A3", { zone: "z3" }); T.give("A1", []).give("A2", []).give("A3", []);
  const a = act(T, "H1", "control");
  eq(a?.target?.n, [1, 12], "PW012: the action takes several");
  eq([code(await T.req("p1", decl("H1", a.id, { targets: ["A1", "A3"] }))), why(T.last)], ["illegal", "notSameZone"], "PW012 [B1637]: the animals of ONE zone");
  eq(code(await T.req("p1", decl("H1", a.id, { targets: ["A1", "A2"] }))), "ok", "PW012: two animals of z2");
  for (let i = 0; i < 4 && T.state.stack.length; i++) { const k = Object.keys(T.top()?.rolls ?? {}).find((x) => !T.top().rolls[x].result); if (k) await T.roll(k, 2); else await finish(T); }
  await finish(T);
  eq([T.c.A1.summonOf, T.c.A2.summonOf], ["H1", "H1"], "PW012 [B1637]: both are controlled");
}
/* ================================================================== PW013, PW014, PW106 [B1646-1647], [B1859]: the barriers are raised on
   somebody in your zone; the ice barrier ends when either of the two leaves the zone it was made in */
{
  const T = base([item("cc", "Cold Control", "power")], { h2zone: "z2" });
  const a = act(T, "H1", "barrier");
  eq([code(await T.req("p1", decl("H1", a.id, { targets: ["H2"] }))), why(T.last)], ["illegal", "notSameZone"], "PW014 [B1646]: not on an ally in another zone");
  T.c.H2.zone = "z1";
  eq(code(await T.req("p1", decl("H1", a.id, { targets: ["H2"] }))), "ok", "PW014: on an ally in the same zone");
  for (let i = 0; i < 3 && T.state.stack.length; i++) { const k = Object.keys(T.top()?.rolls ?? {})[0]; if (k) await T.roll(k, 1); else await finish(T); }
  const e = T.state.effects.find((x) => x.kind === "barrier");
  eq([e?.holder, e?.data?.zone], ["H2", "z1"], "PW013: the ice barrier remembers its zone");
  T.c.H1.zone = "z2";
  const out = FK.separated({ state: T.state, facts: T.facts() }, ["H1"]);
  ok(out.some((w) => w.t === "state"), "PW013 [B1647]: its maker left the zone: the barrier ends");
  T.c.H1.zone = "z1";
  eq(FK.separated({ state: T.state, facts: T.facts() }, ["H1"]).filter((w) => w.t === "state").length, 0, "PW013: while both stay, it stays");
  const U = base([item("ba", "Barrier", "power", { autos: [auto("a", "Barrier", "usePower")] })], { h2zone: "z2" });
  eq([code(await U.req("p1", decl("H1", act(U, "H1", "barrier").id, { targets: ["H2"] }))), why(U.last)], ["illegal", "notSameZone"], "PW106 [B1859]: Barrier: a target in your zone");
  ok(!U.state.effects.some((x) => x.kind === "barrier" && x.data?.zone), "PW106: a plain Barrier is not tied to the zone");
}
/* ================================================================== PW017, PW018 [B1671-1674]: Earthquake wrecks the zones it covers: never
   one already wrecked or one that cannot be; from Major on two to four zones next to each other */
{
  const eqk = (lv) => [item("eq", "Earthquake", "power", { autos: levels("Eq", "Earthquake", (i) => ({ attr: ["might"], damage: 3 + i, show: i === lv })) })];
  const T = base(eqk(0));
  T.terrain = { z1: "street", z2: "street" };
  eq(code(await T.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: "eq~Eq0" }))), "ok", "PW017: the quake in the own zone");
  await passAll(T); await T.roll("attack", 1); await finish(T);
  eq(!!T.zoneMarks.z1?.wrecked, true, "PW017 [B1671]: the zone is wrecked");
  T.turn("H2"); T.turn("N2"); await T.gm({ op: "nextRound" }); T.turn("H1");
  eq([code(await T.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: "eq~Eq0" }))), why(T.last)], ["illegal", "wreckDone"], "PW017 [B1671]: not in a zone already wrecked");
  const U = base(eqk(0)); U.terrain = { z1: "sky" };
  eq([code(await U.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: "eq~Eq0" }))), why(U.last)], ["illegal", "wreckTerrain"], "PW017 [B1671]: not where nothing can be wrecked");
  eq([code(await U.req("p1", decl("H1", "shoot", { targets: ["N1", "N2"], weapon: "eq~Eq0" }))), why(U.last)][1] !== null, true, "PW018: a Basic quake covers one zone");
  const V = base(eqk(1));
  eq(K.build({ items: eqk(1) }).weapons[0].quake, 2, "PW018 [B1672]: Major covers two zones");
  eq(code(await V.req("p1", decl("H1", "shoot", { targets: ["N1", "N2"], weapon: "eq~Eq1" }))), "ok", "PW018 [B1672]: Major: the own zone and the next");
  await passAll(V);
  const hit = V.top()?.decl?.targets ?? [];
  ok(hit.includes("N1") && hit.includes("N2") && hit.includes("H2"), "PW018: everybody in both zones");
  await V.roll("attack", 1); await finish(V);
  eq([!!V.zoneMarks.z1?.wrecked, !!V.zoneMarks.z2?.wrecked], [true, true], "PW018: both zones wrecked");
  const W = base(eqk(1)); W.npc("N3", { zone: "z4" }); W.give("N3", []); W.setRange("N1", "N3", 2); W.setRange("H1", "N3", 2);
  eq([code(await W.req("p1", decl("H1", "shoot", { targets: ["N1", "N3"], weapon: "eq~Eq1" }))), why(W.last)], ["illegal", "quakeApart"], "PW018: the zones lie next to each other");
  eq([code(await W.req("p1", decl("H1", "shoot", { targets: ["N1", "N2", "N3"], weapon: "eq~Eq1" }))), why(W.last)], ["illegal", "quakeZones"], "PW018: no more zones than the level");
  for (const k of ["quakeZones", "quakeApart"]) ok(both(`ITAC.reason.${k}`), `PW018: ${k} in both languages`);
  const sw = K.build({ items: [{ ...eqk(1)[0], boosts: ["sw"] }, item("sw", "Shockwave", "boost", { power: "eq" })] }).weapons.find((x) => x.tag);
  eq([sw?.area, sw?.quake], [false, undefined], "PW017: Shockwave strikes one target and wrecks nothing");
}
/* ================================================================== PW019, PW119, PW020 [B1680-1684]: Electricity Control: +2 against a
   conductive target (a status the GM marks); the stun reaches as far as the attack */
{
  const ec = (lv) => [item("ec", "Electricity Control", "power", { autos: [...levels("Ec", "Electricity Control", (i) => ({ attr: ["agility"], damage: 3 + i, max: 1 + i, show: i === lv })), ...LV.map((w, i) => auto(`St${i}`, `Stun - ${w}`, "rollAttack", { attr: ["agility"], damage: 3 + i, max: 1, show: i === lv }))] })];
  eq(K.build({ items: ec(2) }).weapons.map((w) => w.range), [[0, 3], [0, 3]], "PW020 [B1683]: at Massive the stun reaches three zones like the attack");
  const T = base(ec(0));
  const n = (T2) => T2.preview("p1", "H1", { action: "shoot", targets: ["N1"], weapon: "ec~Ec0" })?.dice;
  const d0 = n(T);
  eq(code(await T.gm({ op: "statusAdd", combatant: "N1", status: { id: "conductive" } })), "ok", "PW019: the GM marks the target conductive");
  eq(n(T) - d0, 2, "PW019, PW119 [B1680]: +2 dice against it");
  ok(both("ITAC.status.conductive") && both("ITAC.mod.conductive"), "PW019: named in both languages");
}
/* ================================================================== PW021 [B1685]: Discharge: after an electric hit, up to 10 stress (no more
   than the Resolve) for as much damage, after Double Damage */
{
  eq(damage.hitDamage({ base: 3, doubled: true, plus: 2, armor: 4 }).taken ?? null, 4, "PW021: (3 x 2) + 2 - Armor 4");
  const kit = [item("ec", "Electricity Control", "power", { boosts: ["di"], autos: [auto("a", "Electricity Control", "rollAttack", { attr: ["agility"], damage: 3, max: 1 })] }), item("di", "Discharge", "boost", { power: "ec" })];
  eq(K.build({ items: kit }).actions.filter((a) => /discharge/i.test(a.name)).length, 0, "PW021: no action of its own");
  const T = base(kit);
  await T.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: "ec~a" })); await passAll(T); await T.roll("attack", 1); await noStunts(T);
  const p = T.prompt("discharge", "H1");
  eq(p?.options?.length, 6, "PW021: asked after the hit: 0 to 5 (the Resolve)");
  await T.req("p1", { op: "answer", prompt: p.id, value: "n:2" }); await finish(T);
  eq([T.c.N1.health, T.c.H1.resolve], [6 - 5, 3], "PW021 [B1685]: damage 3 + 2, 2 stress");
  ok(both("ITAC.opt.discharge") && both("ITAC.prompt.discharge"), "PW021: the card in both languages");
}
/* ================================================================== PW022, PW023, PW024 [B1690-1692]: Fire Control: a target that takes
   damage burns at the attack's base Damage; for 1 stress the target's zone is set ablaze at Intensity 6 */
{
  const fc = [item("fc", "Fire Control", "power", { autos: [auto("a", "Fire Control", "rollAttack", { attr: ["agility"], damage: 4, max: 2 })] })];
  const ws = K.build({ items: fc }).weapons;
  eq([ws[0].onHit?.data?.intensity, ws[0].onHit?.ifDamage, ws[1]?.opt, ws[1]?.zoneFire, ws[1]?.stress], [4, 1, "blaze", 6, 1], "PW022, PW024: Intensity 4 (the Damage); the ablaze variant for 1 stress");
  const T = base(fc, { n2: { immunities: ["fire"] } });
  await T.req("p1", decl("H1", "shoot", { targets: ["N2"], weapon: "fc~a" })); await passAll(T); await T.roll("attack", 1); await finish(T);
  eq([T.c.N2.health, st(T, "N2").filter((s) => s !== "reaction")], [6, []], "PW023 [B1691]: no damage, no fire on it");
  const U = base(fc);
  await U.req("p1", decl("H1", "shoot", { targets: ["N2"], weapon: "fc~a+0" })); await passAll(U);
  eq([U.zoneMarks.z2?.fire, U.c.H1.resolve], [6, 4], "PW024 [B1692]: the target's zone ablaze at 6, 1 stress");
}
/* ================================================================== PW025 [B1654]: in a darkness: -2 dice on attacks in the same zone, none
   into another zone; its maker is not touched */
{
  const T = base();
  const pool = (who, t) => T.preview(who === "H1" ? "p1" : "gm", who, { action: "slugfest", targets: [t] })?.dice;
  const d0 = pool("H1", "N1");
  T.dark.z1 = [{ kind: "dark", owner: "H2" }];
  eq(pool("H1", "N1") - d0, -2, "PW025 [B1654]: -2 on an attack in the same zone");
  eq([code(await T.req("p1", decl("H1", "shoot", { targets: ["N2"] }))), why(T.last)], ["illegal", "inDarkness"], "PW025 [B1654]: no attack into another zone");
  T.dark.z1 = [{ kind: "dark", owner: "H1" }];
  eq(pool("H1", "N1"), d0, "PW025: the maker sees through its own darkness");
  ok(both("ITAC.reason.inDarkness") && both("ITAC.mod.dark"), "PW025: in both languages");
}
/* ================================================================== PW027 [B1662]: Additional Travelers: part of the travel, not "outside a fight" */
eq(row("Additional Travelers")?.why, "partOfPower", "PW027: the reason it is by hand");
/* ================================================================== PW028 [B1723], [B1800]: an area attack of a power that does not work on
   huge creatures passes them by and hits the others */
{
  const lc = [item("lc", "Light Control", "power", { boosts: ["be"], autos: [auto("a", "Light Control", "rollAttack", { attr: ["agility"], damage: 3, max: 2 })] }), item("be", "Burst Effect", "boost", { power: "lc" })];
  const w = K.build({ items: lc }).weapons.find((x) => x.area);
  ok(!!w, "PW028: (the burst variant)");
  const T = base(lc, { n1: { huge: true }, n2: { zone: "z1" } });
  eq(code(await T.req("p1", decl("H1", "shoot", { targets: ["N2"], weapon: w?.id, area: 1 }))), "ok", "PW028: declared on the zone");
  const ts = T.top()?.decl?.targets ?? [];
  eq([ts.includes("N1"), ts.includes("N2"), T.top()?.data?.result ?? null], [false, true, null], "PW028: the huge one is passed by, the attack goes on");
}

done("pwc");
