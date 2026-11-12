// node scripts/tactics/check-pwa.mjs -- fixer PWA: the confirmed findings of the powers review that are real by the book, each block
// naming its finding ids and book lines. The powers are the COMPENDIUM's own items (check-pwa-items.mjs: the invincible-core packs as
// read on 2026-11-12) turned into the kit by the system adapter's own reader (kitSource), so what the compendium stores (a "bypass
// armor" switch, an attack kept as a plain roll) is what is checked. Scripted table, the fake map of check-kit-map.mjs where a target moves.
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import { MTable } from "./check-kit-map.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./mods-pure.mjs";
import * as K from "./kit-pure.mjs";
import * as D from "./desk-pure.mjs";
import * as UI from "./ui/model-pure.mjs";
import { kitSource } from "./system-adapter.mjs";
import { EN, PL, t } from "./lang.mjs";
import { REAL } from "./check-pwa-items.mjs";

const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const why = (env) => env?.error?.params?.reason ?? null;
const decl = (actor, action, extra = {}) => ({ op: "declare", actor, decl: { action, ...extra } });
const st = (T, cid) => M.statusesOf(T.state, cid).map((s) => s.id);
/* a compendium item as the actor holds it (Foundry's shape, read by kitSource); `o.power` = the id of the power a boost or limit belongs to */
const real = (name, o = {}) => { const r = REAL[name]; if (!r) throw new Error(`no fixture item ${name}`);
  return { id: o.id ?? r.id, name, type: r.type, system: { level: o.level ?? r.level, power: o.power ?? null, boosts: o.boosts ?? [], automations: r.automations }, effects: [], flags: {} }; };
const kitOf = (items, attrs) => K.build(kitSource({ name: "x", items, system: { attributes: Object.fromEntries(Object.entries(attrs ?? {}).map(([k, v]) => [k, { value: v }])) } }));
const withKit = (B) => class extends B {
  give(cid, items) { const c = this.c[cid]; c.kit = kitOf(items, c.attrs); c.pass = c.kit.pass; if (c.pass.stressArmor) c.armor = [...c.armor.filter((a) => a.id !== "defiance"), { id: "defiance", armor: c.pass.stressArmor, stress: true }]; return this; }
  facts() { const f = super.facts(), T = this; return { ...f, canTalk: () => true, weapon: (cid, ref) => (ref == null || ref === "unarmed" ? { ...f.weapon(cid, ref), ...(T.c[cid]?.kit?.unarmed ?? {}) } : T.c[cid]?.kit?.weapons.find((w) => w.id === ref) ?? f.weapon(cid, ref)) }; }
};
const KT = withKit(Table), KM = withKit(MTable);
const base = (hItems = [], nItems = [], o = {}) => { const T = new KT(); T.hero("H1", "p1", o.h1 ?? {}).hero("H2", "p2", o.h2 ?? {}).npc("N1", { health: 6, ...(o.n1 ?? {}) }).npc("N2", { health: 4, ...(o.n2 ?? {}) });
  T.give("H1", hItems).give("H2", o.h2Items ?? []).give("N1", nItems).give("N2", []); T.order(["H1", "N1", "H2", "N2"]).turn("H1"); return T; };
const wOf = (T, cid, pred) => T.c[cid].kit.weapons.find(pred);
const act = (T, cid, k) => T.c[cid].kit.actions.find((a) => a.id.endsWith(`-${k}`));
const pass = async (T) => { for (const p of T.prompts("reaction")) await T.gm({ op: "answerFor", prompt: p.id, value: "pass" }); };
const noStunts = async (T) => { const p = T.prompt("stunts"); if (p) await T.gm({ op: "answerFor", prompt: p.id, value: [] }); };
const stunts = async (T, list) => { const p = T.prompt("stunts"); if (p) await T.gm({ op: "answerFor", prompt: p.id, value: list }); };
/** shoot with the kit's weapon `w` at N1, nobody defends, `sixes` on the attack, no stunts */
const shoot = async (T, w, sixes = 1, who = "H1", at = "N1", user = "p1") => { const r = await T.req(user, decl(who, w.fam === "slug" ? "slugfest" : "shoot", { targets: [at], weapon: w.id })); await pass(T); await T.roll("attack", sixes); return r; };

/* ================================================================== PW001, PW102 [B1591], [B2682], [B1865]: Distress has to pierce Armor;
   the remaining damage is stress. Ordinary Armor counts, Defiance counts, the better one of them (one Armor at a time); only Mental
   Distress ignores Armor [B1596]. The compendium item carries the system's "bypass armor" switch: the book row wins over it. */
{
  const dsOf = (T) => wOf(T, "H1", (w) => w.of === "Distress" && !w.tag);
  let T = base([real("Distress")], [], { n1: { armor: [{ id: "vest", armor: 2 }], resolve: 8 } });
  eq([dsOf(T)?.toStress, dsOf(T)?.ignoreArmor, dsOf(T)?.damage], [true, false, 3], "PW102: the compendium's Distress inflicts stress and does NOT ignore Armor (the book row wins over the bypass switch)");
  await shoot(T, dsOf(T)); await noStunts(T);
  eq([T.c.N1.resolve, T.c.N1.health], [7, 6], "PW001 [B1591]: Distress 3 against a vest of Armor 2: 1 stress");
  T = base([real("Distress")], [], { n1: { armor: [{ id: "vest", armor: 3 }], resolve: 8 } });
  await shoot(T, dsOf(T)); await noStunts(T);
  eq(T.c.N1.resolve, 8, "PW001: Distress 3 against Armor 3: nothing gets through");
  T = base([real("Distress")], [], { n1: { armor: [{ id: "vest", armor: 3 }], resolve: 8 } });
  await shoot(T, dsOf(T), 2); await stunts(T, ["doubleDamage@N1"]);
  eq(T.c.N1.resolve, 5, "PW001 [B1591], [B2434]: Double Damage before Armor: 6 - 3 = 3 stress");
  T = base([real("Distress", { level: "major" })], [], { n1: { armor: [{ id: "vest", armor: 2 }, { id: "defiance", armor: 3, stress: true }], resolve: 8 } });
  await shoot(T, dsOf(T)); await noStunts(T);
  eq(T.c.N1.resolve, 7, "PW001 [B1865], [B2682]: Distress 4 against a vest 2 and Defiance 3: the better one counts, 1 stress");
  T = base([real("Distress", { level: "major" })], [], { n1: { armor: [{ id: "vest", armor: 5 }, { id: "defiance", armor: 3, stress: true }], resolve: 8 } });
  await shoot(T, dsOf(T)); await noStunts(T);
  eq(T.c.N1.resolve, 8, "PW102: Distress 4 against a vest 5 and Defiance 3: the vest stops it");
  T = base([real("Distress", { id: "ds" }), real("Mental Distress", { id: "md", power: "ds" })], [], { n1: { armor: [{ id: "vest", armor: 5 }], resolve: 8 } });
  const md = wOf(T, "H1", (w) => w.of === "Distress");
  eq(md?.ignoreArmor, true, "[B1596]: with Mental Distress Armor has no effect");
  await shoot(T, md); await noStunts(T);
  eq(T.c.N1.resolve, 5, "[B1596]: Mental Distress 3 against Armor 5: 3 stress");
  /* a Barrier [B1859] is Armor too: it stops Distress, and is breached when the stress gets through it */
  T = base([real("Distress", { level: "major" })], [], { n1: { resolve: 8 } });
  T.state.effects = [M.makeEffect({ id: "bar1", kind: "barrier", holder: "N1", source: { kind: "power", owner: "N2", name: "Barrier" }, data: { armor: 3, by: "N2" }, ends: { at: "breached" } })];
  await shoot(T, dsOf(T)); await noStunts(T);
  eq([T.c.N1.resolve, (T.state.effects ?? []).some((e) => e.id === "bar1")], [7, false], "PW001 [B1859]: Distress 4 through a Barrier 3: 1 stress, the Barrier is breached");
  ok(!/vest does not count/.test(String(EN["ITAC.kit.note.attack"] ?? "")), "PW001: no text says the vest does not count");
}

/* ================================================================== PW101 [B1625]: Stun works only if it penetrates Armor. The compendium's
   Stun carries the "bypass armor" switch; the book row keeps Armor in. */
{
  const stunOf = (T) => wOf(T, "H1", (w) => w.of === "Stun");
  let T = base([real("Stun")], [], { n1: { armor: [{ id: "vest", armor: 3 }] } });
  eq([stunOf(T)?.ignoreArmor, stunOf(T)?.pierce, stunOf(T)?.noDamage], [false, true, true], "PW101: the compendium's Stun has to pierce Armor");
  await shoot(T, stunOf(T)); await noStunts(T);
  eq([T.requests.some((r) => r.key === "ohs:N1"), T.state.stack.length, st(T, "N1")], [false, 0, []], "PW101 [B1625]: Stun 3 against Armor 3: no PRESENCE roll, nothing happens");
  T = base([real("Stun")], [], { n1: { armor: [{ id: "vest", armor: 2 }] } });
  await shoot(T, stunOf(T)); await noStunts(T);
  eq([T.lastRequest()?.key, T.c.N1.health], ["ohs:N1", 6], "PW101: Stun 3 against Armor 2 gets through: the PRESENCE roll, no damage");
  await T.roll("ohs:N1", 0);
  ok(st(T, "N1").includes("stunned"), "PW101: a failed roll stuns");
  T = base([real("Stun")], [], { n1: { armor: [{ id: "vest", armor: 5 }] } });
  await shoot(T, stunOf(T), 2); await stunts(T, ["doubleDamage@N1"]);
  eq(T.lastRequest()?.key, "ohs:N1", "PW101 [B1625]: Double Damage (6) gets through Armor 5");
}

/* ================================================================== PW016 [B1675]: Shockwave aims the quake at one target: a normal attack
   with base Damage one step higher; the area the power always has is not forced on it. Reach: the zones the quake covers at the level
   (question PWA-1). */
{
  const items = (lv) => [real("Earthquake", { id: "eq", level: lv }), real("Shockwave", { id: "sw", power: "eq" })];
  let T = base(items("basic"));
  const sw = wOf(T, "H1", (w) => w.tag === "Shockwave"), q = wOf(T, "H1", (w) => w.of === "Earthquake" && !w.tag);
  eq([sw?.area, sw?.always ?? null, sw?.damage, sw?.range, q?.always], [false, null, 3, [0, 0], ["area"]], "PW016: Shockwave has no area and Damage 3; the plain quake keeps its area");
  eq(code(await shoot(T, sw, 1)), "ok", "PW016: the Shockwave attack is declared");
  await noStunts(T);
  eq([T.c.N1.health, T.c.N2.health, T.state.stack.length], [3, 4, 0], "PW016: one target takes 3, nobody else in the zone");
  eq(T.events.filter((e) => e.type === "actionClosed").map((e) => e.summary.result).includes("illegal"), false, "PW016: the attack is not closed as illegal");
  T = base(items("major"));
  eq(wOf(T, "H1", (w) => w.tag === "Shockwave")?.range, [0, 2], "PW016 [B1672]: at Major the quake reaches two zones out: so does the Shockwave");
}

/* ================================================================== PW071 [B1690], [B2926], [B1879]: a target catches fire only if it takes
   damage from the attack */
{
  const fcOf = (T) => wOf(T, "H1", (w) => w.of === "Fire Control");
  let T = base([real("Fire Control")], [], { n1: { immunities: ["fire"] } });
  await shoot(T, fcOf(T)); await noStunts(T);
  eq([T.c.N1.health, st(T, "N1").includes("burning")], [6, false], "PW071: immune to fire: no damage, not set alight");
  T = base([real("Fire Control")], [], { n1: { armor: [{ id: "vest", armor: 3 }] } });
  await shoot(T, fcOf(T)); await noStunts(T);
  eq([T.c.N1.health, st(T, "N1").includes("burning")], [6, false], "PW071: Armor stops all 3: not set alight");
  T = base([real("Fire Control")]);
  await shoot(T, fcOf(T)); await noStunts(T);
  eq([T.c.N1.health, st(T, "N1").includes("burning")], [3, true], "PW071: damage taken: on fire");
}

/* ================================================================== PW039 [B1772-1775]: Nullification as an interrupt of a power about to be
   used: an opposed PRESENCE roll before the target's dice; a win forfeits the target's action; only powers of its own level or lower */
{
  const setup = (lv = "basic", npcLv = "basic") => { const T = base([real("Nullification", { level: lv })], [real("Distress", { level: npcLv })]); T.turn("N1"); return T; };
  const nu = (T) => act(T, "H1", "nullify");
  let T = setup();
  eq([nu(T)?.cost, nu(T)?.interrupt?.on], ["quick", ["beforeRoll"]], "PW039: a quick action that may interrupt");
  const ds = wOf(T, "N1", (w) => w.of === "Distress");
  eq(code(await T.gm(decl("N1", "shoot", { targets: ["H2"], weapon: ds.id }))), "ok", "PW039: N1 uses Distress on H2");
  const bar = D.barModel({ ...T.state, stack: T.state.stack }, "H1", { P1, kit: (id) => T.c[id]?.kit, c: (id) => T.c[id] });
  eq(bar.actions.find((a) => a.id === nu(T).id)?.disabled ?? null, null, "PW039: the bar offers Nullification while the power waits for its dice");
  eq(code(await T.req("p1", decl("H1", nu(T).id, { targets: ["N1"] }))), "ok", "PW039: declared as an interrupt");
  await T.roll("roll", 2); await T.roll("def:N1", 1);
  eq([T.state.stack.length, T.c.H2.resolve, T.requests.some((r) => r.key === "attack")], [0, 5, false], "PW039 [B1774]: the power is negated: N1's action is forfeit, H2 untouched, no attack roll");
  eq([P1.budget(T.state, "N1").full, P1.budget(T.state, "H1").quick.includes("used")], ["used", true], "PW039: N1's full action is spent; H1 paid its quick action");
  T = setup();
  await T.gm(decl("N1", "shoot", { targets: ["H2"], weapon: wOf(T, "N1", (w) => w.of === "Distress").id }));
  await T.req("p1", decl("H1", nu(T).id, { targets: ["N1"] }));
  await T.roll("roll", 1); await T.roll("def:N1", 1);
  eq([T.state.stack.length, T.top()?.actor], [1, "N1"], "PW039 [B2243]: a tie fails: N1's attack goes on");
  T = setup("basic", "major");
  await T.gm(decl("N1", "shoot", { targets: ["H2"], weapon: wOf(T, "N1", (w) => w.of === "Distress").id }));
  const r1 = await T.req("p1", decl("H1", nu(T).id, { targets: ["N1"] }));
  eq([code(r1), why(r1)], ["illegal", "powerTooHigh"], "PW039 [B1773]: a basic Nullification cannot negate a Major power");
  T = setup("major", "major");
  await T.gm(decl("N1", "shoot", { targets: ["H2"], weapon: wOf(T, "N1", (w) => w.of === "Distress").id }));
  eq(code(await T.req("p1", decl("H1", nu(T).id, { targets: ["N1"] }))), "ok", "PW039 [B1776]: a Major one can");
  T = setup();
  await T.gm(decl("N1", "slugfest", { targets: ["H2"] }));
  const r2 = await T.req("p1", decl("H1", nu(T).id, { targets: ["N1"] }));
  eq([code(r2), why(r2), r2?.error?.params?.gmMayAllow], ["illegal", "noPower", 1], "PW039: a bare-handed blow is no power");
  T = setup();
  await T.gm(decl("N1", "shoot", { targets: ["H2"], weapon: wOf(T, "N1", (w) => w.of === "Distress").id }));
  eq(why(await T.req("p1", decl("H1", nu(T).id, { targets: ["H2"] }))), "nullifyWho", "PW039: aimed at the one using the power");
  T = base([real("Nullification")]);
  eq(code(await T.req("p1", decl("H1", nu(T).id, { targets: ["N1"] }))), "ok", "PW039: on its own turn it is still used (an ongoing effect, a passive power)");
  await T.roll("roll", 1); await T.roll("def:N1", 0);
  ok(!!T.prompt("outcome"), "PW039: on its own turn the GM says what was negated");
  for (const k of ["nullifyWho", "noPower", "powerTooHigh"]) ok(!!EN[`ITAC.reason.${k}`] && !!PL[`ITAC.reason.${k}`], `PW039: the reason ${k} has words`);
}

/* ================================================================== PW048 [B1779]: a grapple made with the plants: no hold to keep, the target
   is immobilised (no physical action, slugfest and shooting included) until it breaks free with STRENGTH (a full action) */
{
  const T = base([real("Plant Control")]);
  const pl = wOf(T, "H1", (w) => w.of === "Plant Control");
  eq(pl?.grip, "immobilised", "PW048: the plant attack can grapple");
  eq(code(await T.req("p1", decl("H1", "grapple", { targets: ["N1"], weapon: pl.id }))), "ok", "PW048: a grapple with the plants is legal");
  await pass(T); await T.roll("attack", 1);
  eq([st(T, "N1"), st(T, "H1"), T.c.N1.health], [["immobilised"], [], 6], "PW048 [B1779]: the target is immobilised, the hero holds nothing, no damage");
  T.turn("N1");
  const r = await T.gm(decl("N1", "shoot", { targets: ["H1"] }));
  eq(code(r), "illegal", "PW048 [B1779]: the immobilised target makes no shooting attack");
  eq(code(await T.gm(decl("N1", "escapeImmobilised"))), "ok", "PW048: it breaks free with STRENGTH (full action)");
  eq(T.lastRequest()?.attr, "strength", "PW048: the roll is STRENGTH");
}

/* ================================================================== PW053, PW113 [B1822-1828]: Telekinesis "Throw Target" is a plain AGILITY
   roll in the compendium: it is the throwing attack of Z11 (dodged like a shot, thrown like Knockback, the level's damage at each impact) */
{
  const kit = kitOf([real("Telekinesis", { level: "major" })], {});
  const w = kit.weapons.find((x) => x.onHit?.throw);
  eq([w?.name, w?.fam, w?.range, w?.noDamage, w?.onHit], ["Telekinesis: Throw Target", "shoot", [0, 1], true, { throw: 4, zones: 3 }], "PW053: the compendium's Throw Target is the throw: Major throws 3 zones, 4 at an impact");
  eq(kit.actions.map((a) => a.name).filter((n) => /Throw/.test(n)), [], "PW113: not offered a second time as a narrative action");
  ok(kit.actions.some((a) => a.name === "Telekinesis"), "PW053: moving objects stays the GM's action");
  const T = new KM(); T.hero("H1", "p1").npc("N1", { health: 9 }); T.put("H1", "z1").put("N1", "z2"); T.give("H1", [real("Telekinesis")]).give("N1", []); T.order(["H1", "N1"]);
  const tw = wOf(T, "H1", (x) => x.onHit?.throw);
  eq(code(await T.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: tw.id }))), "ok", "PW053: thrown at a target in the next zone");
  const rb = T.prompt("reaction", "N1");
  ok(rb?.options.some((o) => o.id === "dodge"), "PW053 [B1823]: the target may dodge, as a shot");
  await pass(T); await T.roll("attack", 1); await noStunts(T);
  eq(T.prompt("knockDir")?.data?.distance, 2, "PW053 [B1823]: thrown like Knockback: the thrower names the way, 2 zones at basic");
}

/* ================================================================== PW072 [B1925-1928]: Extra Limb(s): other actions while the grapple is held,
   still one target at a time */
{
  const T = base([real("Extra Limb(s)")]);
  eq(T.c.H1.pass.freeHold, true, "PW072: the compendium's Extra Limb(s) holds freely");
  await T.req("p1", decl("H1", "grapple", { targets: ["N1"] })); await pass(T); await T.roll("attack", 1);
  eq(st(T, "H1"), ["grappling"], "PW072: holding N1");
  T.state = { ...T.state, ledger: { ...T.state.ledger, H1: P1.ledgerOf(T.state, "H1") } };
  await T.gm({ op: "grant", combatant: "H1", unit: "full" }).catch(() => null);
  const bar = D.barModel(T.state, "H1", { P1, kit: (id) => T.c[id]?.kit, c: (id) => T.c[id] });
  ok(bar.actions.filter((a) => ["slugfest", "shoot", "rally"].includes(a.id)).every((a) => a.disabled !== "grappling"), "PW072: the bar does not grey the holder's other actions");
  T.turn("N1"); T.turn("H2"); await T.gm({ op: "nextRound" }).catch(() => null);
  if (T.state.init.curMember !== "H1") T.turn("H1");
  const r = await T.req("p1", decl("H1", "slugfest", { targets: ["N2"] }));
  ok(why(r) !== "grappling", `PW072 [B1926]: the holder attacks somebody else (${code(r)} ${why(r)})`);
  const U = base([real("Extra Limb(s)")]);
  await U.req("p1", decl("H1", "grapple", { targets: ["N1"] })); await pass(U); await U.roll("attack", 1);
  U.turn("N1"); U.turn("H2"); await U.gm({ op: "nextRound" }).catch(() => null);
  if (U.state.init.curMember !== "H1") U.turn("H1");
  eq(why(await U.req("p1", decl("H1", "grapple", { targets: ["N2"] }))), "grappling", "PW072 [B1926]: still one grapple at a time");
  const V = base([]);
  await V.req("p1", decl("H1", "grapple", { targets: ["N1"] })); await pass(V); await V.roll("attack", 1);
  V.turn("N1"); V.turn("H2"); await V.gm({ op: "nextRound" }).catch(() => null);
  if (V.state.init.curMember !== "H1") V.turn("H1");
  eq(why(await V.req("p1", decl("H1", "slugfest", { targets: ["N2"] }))), "grappling", "[B2497]: without the power the holder does nothing else");
}

/* ================================================================== PW083, PW109 [B1940-1942]: intangible (Prolonged Phasing) a character cannot
   affect the physical world; mental powers still work; Controlled Phasing (1 stress) makes it solid for a single action */
{
  const items = () => [real("Intangibility", { id: "in" }), real("Prolonged Phasing", { id: "pp", power: "in" }), real("Controlled Phasing", { id: "cp", power: "in" }), real("Distress", { id: "ds" })];
  let T = base(items());
  eq(code(await T.req("p1", decl("H1", act(T, "H1", "phased").id))), "ok", "PW083: Prolonged Phasing");
  eq(st(T, "H1"), ["intangible"], "PW083: intangible");
  let r = await T.req("p1", decl("H1", "slugfest", { targets: ["N1"] }));
  eq([code(r), why(r), r?.error?.params?.gmMayAllow], ["illegal", "intangible", 1], "PW083 [B1941]: no slugfest while intangible");
  r = await T.req("p1", decl("H1", "grapple", { targets: ["N1"] }));
  eq(why(r), "intangible", "PW083: no grapple either");
  const ds = wOf(T, "H1", (w) => w.of === "Distress");
  eq(code(await T.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: ds.id }))), "ok", "PW083 [B1941]: a mental power still works (Distress inflicts stress)");
  T = base(items());
  await T.req("p1", decl("H1", act(T, "H1", "phased").id));
  eq(code(await T.req("p1", decl("H1", act(T, "H1", "solid").id))), "ok", "PW109 [B1942]: Controlled Phasing: 1 stress");
  eq(code(await T.req("p1", decl("H1", "slugfest", { targets: ["N1"] }))), "ok", "PW109: solid for one action: the slugfest is allowed");
  await pass(T); await T.roll("attack", 1); await noStunts(T);
  eq([T.c.N1.health < 6, M.counterGet(T.state, M.counterKey.round("H1", "solid")), st(T, "H1")], [true, 0, ["intangible"]], "PW109: the blow lands; the mark is spent, still intangible");
  ok(!!EN["ITAC.reason.intangible"] && !!PL["ITAC.reason.intangible"], "PW083: the reason has words");
}

/* ================================================================== PW088, PW114 [B2029-2031]: Swinging's Pull: a shooting attack without
   damage that pulls the target from the adjacent zone into the swinger's own; the weight rule (question PWA-4); Brachiation cannot pull */
{
  const T = new KM(); T.hero("H1", "p1").npc("N1", { health: 6 }); T.put("H1", "z1").put("N1", "z2"); T.give("H1", [real("Swinging")]).give("N1", []); T.order(["H1", "N1"]);
  const pw = wOf(T, "H1", (w) => w.onHit?.pull);
  eq([pw?.fam, pw?.range, pw?.noDamage, pw?.stunts], ["shoot", [0, 1], true, "none"], "PW088: the compendium's Pull is a shot without damage");
  eq(code(await T.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: pw.id }))), "ok", "PW088: Pull at the next zone");
  await pass(T); await T.roll("attack", 2); await noStunts(T);
  if (T.prompt("direction")) await T.answer("gm", "direction", "go", "N1");
  eq([T.spot("N1"), T.c.N1.health, T.state.stack.length], ["z1", 6, 0], "PW088 [B2029]: N1 is pulled into the swinger's zone, unhurt");
  const U = new KM(); U.hero("H1", "p1").npc("N1", { health: 6, huge: true }); U.put("H1", "z1").put("N1", "z2"); U.give("H1", [real("Swinging")]).give("N1", []); U.order(["H1", "N1"]);
  const r = await U.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: wOf(U, "H1", (w) => w.onHit?.pull).id }));
  eq([why(r), r?.error?.params?.gmMayAllow], ["tooHeavy", 1], "PW114 [B2029]: a huge target is too heavy (the GM may allow)");
  const kb = kitOf([real("Swinging", { id: "sg" }), real("Brachiation", { id: "br", power: "sg" })], {});
  eq(kb.weapons.filter((w) => w.onHit?.pull).length, 0, "PW114 [B2031]: with Brachiation there is no Pull");
}

/* ================================================================== the UI: the grapple panel offers the plants (the same weapon picker the
   slugfest panel has); nothing for a hero without them */
{
  const panel = (T, armed, more = {}) => { const facts = { view: T.state, me: "gm", staff: true, c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc, img: null } : null), attrs: (id) => T.c[id]?.attrs ?? null, userName: (u) => u,
    weapons: (cid) => T.c[cid]?.kit?.weapons ?? [], preview: () => null };
    return UI.dockData({ bars: [D.barModel(T.state, "H1", { P1, kit: (id) => T.c[id]?.kit, c: (id) => T.c[id] })], prompts: [], mine: [], stack: [], waiting: [], turn: null }, { armed, ...more }, facts, t).panel; };
  const T = base([real("Plant Control")]), g = panel(T, "grapple");
  eq(g?.weapons?.items?.map((x) => x.id), ["unarmed", wOf(T, "H1", (w) => w.grip).id], "PW048: the grapple panel offers bare hands and the plants");
  eq(g.weapons.items.find((x) => x.picked)?.id, "unarmed", "PW048: bare hands stay the first choice");
  const pid = wOf(T, "H1", (w) => w.grip).id;
  eq(panel(T, "grapple", { weapon: pid, targets: ["N1"] })?.submit?.req?.decl?.weapon, pid, "PW048: the plants picked: the declaration carries them");
  eq(panel(base([]), "grapple")?.weapons ?? null, null, "PW048: a hero without the plants sees the grapple panel as before");
}

done("check-pwa");
