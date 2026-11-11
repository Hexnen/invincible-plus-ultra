// node scripts/tactics/check-kit.mjs -- package P6: what a character brings to a fight (powers with their boosts and limits, talents,
// drawbacks, gear), through the REAL director, engine, ledger and journal with a scripted table (no Foundry). The first part checks the
// registry (every compendium item is recognised without a flag, every row is whole, every word exists in both languages); the rest
// drives one entry of each kind and each state, naming its book lines.
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./mods-pure.mjs";
import * as C from "./catalog-pure.mjs";
import * as K from "./kit-pure.mjs";
import * as J from "./journal-pure.mjs";
import { ROWS, NOTES, LEVELS } from "./kitdata-pure.mjs";
import { NAMES } from "./check-kit-names.mjs";
import { EN, PL } from "./lang.mjs";
import { KIT_KINDS } from "./flows/acts.mjs";

const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const why = (env) => env?.error?.params?.reason ?? null;
const decl = (actor, action, extra = {}) => ({ op: "declare", actor, decl: { action, ...extra } });
const st = (T, cid) => M.statusesOf(T.state, cid).map((s) => s.id);
const both = (k) => typeof EN[k] === "string" && typeof PL[k] === "string";

/* ================================================================== the registry */
{
  const cov = K.coverage(), total = Object.values(cov).reduce((s, c) => s + c.total, 0);
  eq(total, ROWS.length, "every row of the data is indexed once");
  eq(Object.keys(cov).sort(), ["boost", "drawback", "gear", "limit", "power", "talent"], "the six categories");
  for (const r of K.allRows()) {
    ok(K.STATES.includes(r.state), `${r.name}: one of the three states`);
    ok(NOTES.includes(r.note) && both(`ITAC.kit.note.${r.note}`), `${r.name}: its note exists in both languages (${r.note})`);
    ok(Array.isArray(r.src) && r.src.length > 0 && r.src.every(Number.isInteger), `${r.name}: cites its book lines`);
    ok(r.state !== "hand" || (!r.acts?.length && !r.fx && !r.opt), `${r.name}: an entry run by hand offers nothing`);
    ok(r.state === "hand" || r.acts?.length || r.atk || r.fx || r.mv || r.pass || r.mods || r.opt || r.weapon || r.cost || ["sheet", "system", "initiative", "off", "interrupt", "gmCard", "zone", "outcome", "roll", "move"].includes(r.note), `${r.name}: an entry that is not by hand has something behind it`);
    for (const a of r.acts ?? []) {
      ok(both(`ITAC.kit.act.${a.k}`), `${r.name}: the action "${a.k}" has a name in both languages`);
      for (const p of a.pick ?? []) ok(/^\d+$/.test(p) || both(`ITAC.kit.pick.${p}`), `${r.name}: the choice "${p}" has a name`);
      ok(a.as || a.reaction || !a.effect || a.effect.kind === "narrative" || KIT_KINDS.includes(a.effect.kind), `${r.name}: the flow knows the effect "${a.effect?.kind}"`);
    }
    for (const o of r.opts ?? []) ok(both(`ITAC.kit.opt.${o.k}`), `${r.name}: the variant "${o.k}" has a name`);
    if (["boost", "limit"].includes(r.cat)) ok(K.allRows().some((p) => p.cat === "power" && p.name === r.of), `${r.name}: belongs to a power of the list (${r.of})`);
  }
  for (const s of [...K.STATES, "off"]) ok(both(`ITAC.kit.state.${s}`), `state ${s} has a name`);
  for (const c of Object.keys(cov)) ok(both(`ITAC.kit.cat.${c}`), `category ${c} has a name`);
  /* every item of the compendia is recognised by its name alone */
  const unknown = NAMES.filter(([type, name]) => !K.rowFor({ type, name }));
  eq(unknown, [], "every compendium item finds its book row without a flag");
  ok(NAMES.length >= 300, "the fixture holds the compendia");
  eq(K.rowFor({ type: "talent", name: "Mój talent", flags: { kit: "Sniper" } })?.name, "Sniper", "a renamed item is known by the GM's flag");
  eq(K.rowFor({ type: "boost", name: "Burst Effect" }, "Light Control")?.of, "Light Control", "a boost that several powers have is told apart by its power");
  eq(K.rowFor({ type: "talent", name: "Knowledgeable (Technology)" })?.name, "Knowledgeable", "a talent with a subject");
  console.log(`  coverage ${Object.entries(cov).map(([c, n]) => `${c} ${n.auto}/${n.assist}/${n.hand}`).join(", ")} (automated / GM confirms / by hand)`);
}

/* ================================================================== a table whose characters carry items */
const auto = (id, name, type, o = {}) => ({ id, name, type, show: o.show !== false, attr: o.attr ?? [], bonus: o.bonus ?? 0, stress: o.stress ?? 0, damage: o.damage ?? 0, min: o.min ?? 0, max: o.max ?? 0, bypass: false });
const item = (id, name, type, o = {}) => ({ id, name, type, level: o.level ?? null, power: o.power ?? null, boosts: o.boosts ?? [], autos: o.autos ?? [], fx: o.fx ?? [], flags: { kit: null, off: false, types: [], ...(o.flags ?? {}) }, wf: o.wf ?? {} });
const levels = (name, type, fn) => LEVELS.map((lv, i) => auto(`${name.slice(0, 2)}${i}`, `${name} - ${lv[0].toUpperCase()}${lv.slice(1)}`, type, fn(i)));
const blast = (lv = 0) => item("blast", "Blast", "power", { autos: levels("Blast", "rollAttack", (i) => ({ attr: ["agility"], damage: 3 + i, max: 3 + i, show: i === lv })) });
class Tbl extends Table {
  give(cid, items, bonus = {}) { const c = this.c[cid]; c.src = items; c.kit = K.build({ items, attrs: c.attrs }); c.pass = c.kit.pass; c.bonus = bonus; if (c.pass.stressArmor) c.armor = [...c.armor, { id: "defiance", armor: c.pass.stressArmor, stress: true }]; return this; }
  facts() { const f = super.facts(), T = this; return { ...f, canTalk: () => true, weapon: (cid, ref) => (ref == null || ref === "unarmed" ? { ...f.weapon(cid, ref), ...(T.c[cid]?.kit?.unarmed ?? {}) } : T.c[cid]?.kit?.weapons.find((w) => w.id === ref) ?? f.weapon(cid, ref)) }; }
  async perform(e) {
    if (e.t === "fx" || e.t === "fxSet") {
      this.performed.push(e);
      const c = Object.values(this.c).find((x) => x.actorUuid === (e.uuid ?? e.actorUuid)), fx = c?.src?.find((i) => i.id === (e.item ?? e.itemId))?.fx.find((x) => x.id === (e.fx ?? e.effectId));
      if (!fx) return {};
      const from = fx.on; fx.on = e.on; this.give(c.id, c.src, c.bonus);
      return e.t === "fx" ? { op: { t: "fx", actorUuid: c.actorUuid, itemId: e.item, effectId: e.fx, from, to: e.on } } : {};
    }
    return super.perform(e);
  }
}
const base = (hItems = [], nItems = [], o = {}) => { const T = new Tbl(); T.hero("H1", "p1", o.h1 ?? {}).hero("H2", "p2").npc("N1", { health: 6, ...(o.n1 ?? {}) }).npc("N2", { health: 4, huge: true }); T.give("H1", hItems, o.bonus ?? {}).give("N1", nItems).give("H2", o.h2Items ?? []); T.order(["H1", "N1", "H2", "N2"]).turn("H1"); return T; };
const act = (T, cid, k) => T.c[cid].kit.actions.find((a) => a.id.endsWith(`-${k}`));
const pass = async (T, who = "gm") => { const p = T.prompt("reaction"); if (p) await T.req(who, { op: "answerFor", prompt: p.id, value: "pass" }); };
const noStunts = async (T) => { const p = T.prompt("stunts"); if (p) await T.req("p1", { op: "answer", prompt: p.id, value: [] }); };

/* ================================================================== level and profiles [B1580-1583] */
{
  const k = K.build({ items: [blast(1)], attrs: {} });
  eq([k.weapons.length, k.weapons[0].damage, k.weapons[0].range, k.weapons[0].fam, k.rows[0].state, k.rows[0].lv], [1, 4, [0, 4], "shoot", "auto", 1], "Blast at Major: one attack, with the numbers of that level");
  const b = K.build({ items: [{ ...blast(0), boosts: ["bu", "dd"] }, item("bu", "Burst Effect", "boost", { power: "blast" }), item("dd", "Deadly Blast", "boost", { power: "blast" }), item("rr", "Reduced Range", "limit", { power: "blast" })], attrs: {} });
  eq(b.weapons.map((w) => [w.sharp, w.range, !!w.area, w.stress]), [[true, [0, 1], false, 0], [true, [0, 1], true, 1]], "Blast with Deadly, Reduced Range and Burst: sharp, range 0 to 1, and a whole-zone variant for 1 stress [B1584-1588]");
  const off = K.build({ items: [{ ...blast(0), flags: { off: true } }, item("bu", "Burst Effect", "boost", { power: "blast" })], attrs: {} });
  eq([off.weapons.length, off.rows.map((r) => r.state)], [0, ["off", "off"]], "a power the GM switched off brings nothing, nor do its boosts");
  const un = K.build({ items: [item("x", "Homebrew Ray", "power", { autos: [auto("a", "Homebrew Ray", "usePower", { stress: 1 })] }), item("y", "Lucky coin", "gear")], attrs: {} });
  eq(un.rows.map((r) => [r.state, r.note, r.unknown]), [["assist", "unknown", 1], ["hand", "unknown", 1]], "an unknown item is never silent: its use button becomes an action the GM confirms, or it is listed by hand");
}

/* ================================================================== an attack power through the attack flow; the sheet's bonus dice */
{
  const T = base([blast(1)], [], { bonus: { agility: 2 } });
  T.c.N1.bonus = { dodge: 2 };
  eq(code(await T.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: "blast~Bl1" }))), "ok", "Blast: declared as the weapon of Shoot");
  await T.gm({ op: "answerFor", prompt: T.prompt("reaction").id, value: "dodge" });
  eq(T.requests.find((r) => r.key === "attack").dice, 5, "the attack pool: AGILITY 3 + 2 from the sheet's effects");
  await T.roll("attack", 2);
  eq(T.lastRequest().dice, 5, "the defender's dodge: AGILITY 3 + 2 from an Evasive-like effect [B2111]");
  await T.roll("def:N1", 0); await noStunts(T);
  eq(T.c.N1.health, 2, "Blast Major: damage 4 [B1581]");
}
/* ================================================================== Snare [B1606-1609]: no damage, the status with the level's dice, not against huge */
{
  const snare = item("sn", "Snare", "power", { autos: levels("Snare", "rollAttack", (i) => ({ attr: ["agility"], max: 1, show: i === 1 })) });
  const T = base([snare]);
  eq([code(await T.req("p1", decl("H1", "shoot", { targets: ["N2"], weapon: "sn~Sn1" }))), why(T.last)], ["illegal", "hugeTarget"], "Snare: not against a huge creature");
  await T.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: "sn~Sn1" })); await pass(T); await T.roll("attack", 3);
  eq(T.prompt("stunts"), null, "Snare: no stunts are offered");
  eq([T.c.N1.health, st(T, "N1"), M.statusesOf(T.state, "N1")[0]?.data?.dice], [6, ["snared"], -3], "Snare Major: no damage, snared with -3 to break free");
}
/* ================================================================== Stun [B1625-1627], Defiance [B1865]: it has to get through the Armor; PRESENCE or the turn is lost */
{
  const stun = item("st", "Stun", "power", { boosts: ["ps"], autos: [auto("a", "Stun", "rollAttack", { attr: ["agility"], damage: 3, max: 3 })] });
  const T = base([stun, item("ps", "Potent Stun", "boost", { power: "st" })], [item("df", "Defiance", "power")]);
  await T.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: "st~a" })); await pass(T); await T.roll("attack", 1);
  eq([T.lastRequest().key, T.lastRequest().attr, T.lastRequest().dice, T.lastRequest().maxPush], ["ohs:N1", "presence", 4, 0], "Stun: PRESENCE 3, -2 Potent Stun, +3 Defiance, no push");
  await T.roll("ohs:N1", 0);
  eq([T.c.N1.health, st(T, "N1"), !!T.state.ledger.N1.lostTurn], [6, ["stunned"], true], "Stun: no damage; a failed roll costs the next turn");
  const U = base([stun], [], { n1: { armor: [{ id: "a", armor: 3 }] } });
  await U.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: "st~a" })); await pass(U); await U.roll("attack", 1);
  eq([U.state.stack.length, st(U, "N1")], [0, []], "Stun: Armor 3 stops Damage 3, nothing happens");
}
/* ================================================================== Affliction [B1574-1576]: -3 on every roll, shaken off once a round */
{
  const T = base([item("af", "Affliction", "power", { autos: [auto("a", "Affliction", "rollAttack", { attr: ["agility"], damage: 3, max: 1 })] })]);
  await T.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: "af~a" })); await pass(T); await T.roll("attack", 1);
  eq([st(T, "N1"), T.c.N1.health], [["afflicted"], 6], "Affliction: the status, no damage");
  T.turn("N1");
  eq(code(await T.gm(decl("N1", "shakeOff"))), "ok", "the afflicted one may try to shake it off (no action)");
  eq(T.lastRequest().dice, 1, "the PRESENCE roll carries the penalty: 3 - 3, never under one die");
  await T.roll("roll", 0);
  eq([st(T, "N1"), code(await T.gm(decl("N1", "shakeOff"))), why(T.last)], [["afflicted"], "illegal", "usedAlready"], "one attempt a round");
}
/* ================================================================== Distress [B1591], Defiance [B1865]: stress, stopped by Armor against stress only */
{
  const ds = item("ds", "Distress", "power", { autos: [auto("a", "Distress", "rollAttack", { attr: ["agility"], damage: 4, max: 2 })] });
  const T = base([ds], [item("df", "Defiance", "power")], { n1: { armor: [{ id: "vest", armor: 5 }] } });
  await T.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: "ds~a" })); await pass(T); await T.roll("attack", 1);
  eq([T.c.N1.health, T.c.N1.resolve], [6, 4], "Distress 4 against Defiance 3: 1 stress, the vest does not count");
}
/* ================================================================== Barrier [B1859-1862]: Armor until breached */
{
  const T = base([item("ba", "Barrier", "power", { autos: [auto("a", "Barrier", "usePower")] })]);
  eq(T.c.H1.kit.actions.map((a) => a.id.split("-").pop()), ["barrier"], "Barrier: its own action, the sheet's use button is not offered twice");
  eq(code(await T.req("p1", decl("H1", act(T, "H1", "barrier").id, { targets: ["H2"] }))), "ok", "Barrier: raised on an ally");
  eq([T.state.effects.filter((e) => e.kind === "barrier").map((e) => [e.holder, e.data.armor]), P1.budget(T.state, "H1").quick.filter((q) => q === "used").length], [[["H2", 3]], 1], "Barrier: Armor 3 on the ally, a quick action");
  T.turn("N1");
  await T.gm(decl("N1", "slugfest", { targets: ["H2"] })); await T.req("p2", { op: "answer", prompt: T.prompt("reaction").id, value: "pass" }); await T.roll("attack", 2);
  const p = T.prompt("stunts"); await T.gm({ op: "answerFor", prompt: p.id, value: [`doubleDamage@H2`] });
  eq([T.c.H2.health, T.state.effects.filter((e) => e.kind === "barrier").length], [5, 0], "Barrier: 2 x 2 damage against Armor 3 leaves 1, and the breached barrier is gone");
}
/* ================================================================== Duplication [B1907-1913]: the copy bonus */
{
  const T = base([item("du", "Duplication", "power", { boosts: ["rd"] }), item("rd", "Restorative Duplication", "boost", { power: "du" })], [], { h1: { health: 3, maxHealth: 6 } });
  eq(code(await T.req("p1", decl("H1", act(T, "H1", "copies").id))), "ok", "Duplication: declared");
  eq([M.statusesOf(T.state, "H1").length, T.state.effects.find((e) => e.kind === "copies")?.data?.n, T.c.H1.resolve, P1.budget(T.state, "H1").full], [0, 3, 4, "used"], "copies: bonus 3, 1 stress, a full action");
  T.turn("N1");
  await T.gm(decl("N1", "slugfest", { targets: ["H1"] })); await T.req("p1", { op: "answer", prompt: T.prompt("reaction").id, value: "pass" }); await T.roll("attack", 1);
  eq([T.c.H1.health, T.state.effects.find((e) => e.kind === "copies")?.data?.n], [3, 1], "damage 2 goes to the copies first [B1910]");
  T.turn("H2"); T.turn("N2");
  await T.gm({ op: "nextRound" }).catch(() => {});
}
{
  const T = base([item("du", "Duplication", "power", { level: "major" })]);
  await T.req("p1", decl("H1", act(T, "H1", "copies").id));
  eq(T.state.effects.find((e) => e.kind === "copies")?.data?.n, 5, "Duplication Major: copy bonus 5 [B1911]");
  await T.gm({ op: "ledgerEdit", combatant: "H1", edit: "grant", grant: { template: "gm", unit: "full" } });
  await T.req("p1", decl("H1", "slugfest", { targets: ["N1"] })); await pass(T);
  eq(T.requests.find((r) => r.key === "attack").dice, 9, "the copy bonus is added to the attack: FIGHTING 4 + 5 [B1908]");
}
/* ================================================================== Healing [B1932], Empathy [B2064], Inspiration [B2119], Leader [B2147] */
{
  const T = base([item("he", "Healing", "power"), item("in", "Inspiration", "talent"), item("le", "Leader", "talent")]);
  T.c.H2.health = 1; T.c.H2.resolve = 1;
  await T.req("p1", decl("H1", act(T, "H1", "heal").id, { targets: ["H2"] })); await T.roll("roll", 1);
  eq(T.c.H2.health, 4, "Healing: 3 Health per six");
  eq([code(await T.req("p1", decl("H1", act(T, "H1", "inspire").id, { targets: ["H2"] }))), why(T.last)], ["illegal", "noChoice"], "Inspiration: how much has to be chosen");
  await T.req("p1", decl("H1", act(T, "H1", "inspire").id, { targets: ["H2"], opt: "3" }));
  eq([T.c.H1.resolve, T.c.H2.resolve], [2, 4], "Inspiration: 3 stress taken, 3 Resolve given");
}
{
  const T = base([item("le", "Leader", "talent")]);
  T.c.H2.resolve = 1;
  await T.req("p1", decl("H1", act(T, "H1", "speech").id)); await T.roll("roll", 2);
  eq([T.c.H1.resolve, T.c.H2.resolve, T.c.N1.resolve], [4, 3, 5], "Leader: 1 stress, every other hero regains the sixes; the other side does not");
}
/* ================================================================== Action Plan [B1634], Luck Control [B1727], Sniper [B2163] */
{
  const T = base([item("ap", "Action Plan", "power"), item("sn", "Sniper", "talent"), item("lu", "Luck Control", "power", { level: "major" })]);
  await T.req("p1", decl("H1", act(T, "H1", "aim").id));
  eq(T.state.tokens.map((t) => [t.holder, t.dice, t.scope.attrs, t.expires.at]), [["H1", 2, ["agility"], "turnEndOf"]], "Sniper: a quick action gives +2 to an AGILITY attack this turn");
  await T.req("p1", decl("H1", act(T, "H1", "plan").id, { opt: "defend" })); await T.roll("roll", 2);
  eq(T.state.tokens.filter((t) => t.source.name === "Action Plan").map((t) => [t.holder, t.dice, t.scope.rolls]), [["H2", 2, ["block", "dodge"]]], "Action Plan: +1 die per six to the other heroes' defences");
  await T.gm({ op: "ledgerEdit", combatant: "H1", edit: "grant", grant: { template: "gm", unit: "quick" } });
  eq(code(await T.req("p1", decl("H1", act(T, "H1", "luck").id, { targets: ["N1"], opt: "bad" }))), "ok", "Luck Control: declared");
  eq([T.state.tokens.find((t) => t.holder === "N1")?.dice, T.state.tokens.find((t) => t.holder === "N1")?.forced, T.c.H1.resolve], [-2, 1, 4], "Luck Control Major: -2 dice on the target's next roll, 1 stress");
  T.turn("N1");
  await T.gm(decl("N1", "scan"));
  eq(T.lastRequest().dice, 1, "the bad luck is on the target's roll without anybody choosing it: INTUITION 3 - 2");
}
/* ================================================================== Rapid Fire [B2158], Martial Arts [B2151], Commander [B2101]: a builtin action at another price */
{
  const gun = item("gun", "Handgun", "gear", { autos: [auto("a", "Handgun", "rollAttack", { attr: ["agility"], bonus: 1, damage: 2, max: 1 })] });
  const T = base([gun, item("rf", "Rapid Fire", "talent"), item("ma", "Martial Arts", "talent"), item("co", "Commander", "talent")]);
  eq([act(T, "H1", "quickShot").cost, act(T, "H1", "quickStrike").cost, act(T, "H1", "orders").cost], ["quick", "quick", "quick"], "three quick variants");
  eq([code(await T.req("p1", decl("H1", act(T, "H1", "quickStrike").id, { targets: ["N1"], weapon: "gun~a" }))), why(T.last)], ["illegal", "noWeapon"], "Martial Arts: unarmed only");
  await T.req("p1", decl("H1", act(T, "H1", "quickShot").id, { targets: ["N1"], weapon: "gun~a" })); await pass(T);
  eq([T.requests.find((r) => r.key === "attack").dice, P1.budget(T.state, "H1").full, T.top().data.kind], [2, "open", "shooting"], "Rapid Fire: AGILITY 3 + 1 handgun - 2, the full action stays");
}
/* ================================================================== switching a form or a size: the sheet's own effect, journaled and undone */
{
  const T = base([item("sz", "Size Alteration", "power", { fx: [{ id: "g", name: "Grow", on: false }, { id: "s", name: "Shrink", on: false }] })]);
  eq(T.c.H1.kit.actions.map((a) => [a.effect.kind, a.name, a.fxOn]), [["toggle", "Grow", false], ["toggle", "Shrink", false]], "Size Alteration: one switch per effect of the item");
  await T.req("p1", decl("H1", T.c.H1.kit.actions[0].id));
  eq([T.performed.filter((e) => e.t === "fx").map((e) => [e.item, e.fx, e.on]), T.c.H1.kit.actions[0].fxOn, P1.budget(T.state, "H1").full], [[["sz", "g", true]], true, "used"], "Grow: the effect is switched on, a full action [B1974]");
  const tx = T.log.list[T.log.list.length - 1];
  ok(tx.ops.some((o) => o.t === "fx"), "the switch is in the journal");
  await T.gm({ op: "undo", tx: tx.id });
  eq([T.performed.filter((e) => e.t === "fxSet").map((e) => e.on), T.c.H1.kit.actions[0].fxOn], [[false], false], "undo switches it back");
  eq(J.inverseEffect({ t: "fx", actorUuid: "A", itemId: "I", effectId: "E", from: false, to: true }), { t: "fxSet", actorUuid: "A", itemId: "I", effectId: "E", on: false }, "the inverse of a switch");
}
/* ================================================================== passives: Overconfident [B2186], Merciless [B2154], Deflection [B2106], Supportive [B2167] */
{
  const T = base([item("oc", "Overconfident", "drawback"), item("me", "Merciless", "talent")], [item("de", "Deflection", "talent")], { h1: { resolve: 3, maxResolve: 5 }, n1: { health: 2 } });
  await T.req("p1", decl("H1", "slugfest", { targets: ["N1"] })); await pass(T);
  eq(T.requests.find((r) => r.key === "attack").maxPush, 0, "Overconfident: no push above half Health");
  await T.roll("attack", 1);
  const nb = T.prompt("npcBroken"); if (nb) await T.gm({ op: "answerFor", prompt: nb.id, value: "ko" });
  eq([T.c.N1.health, T.c.H1.resolve], [0, 4], "Merciless: 1 Resolve for breaking an enemy");
}
{
  const gun = item("gun", "Handgun", "gear", { autos: [auto("a", "Handgun", "rollAttack", { attr: ["agility"], bonus: 1, damage: 2, max: 1 })] });
  const T = base([gun], [item("de", "Deflection", "talent")]);
  await T.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: "gun~a" }));
  eq(T.prompt("reaction").options.map((o) => o.id), ["block", "dodge", "pass"], "Deflection: a shot may be blocked");
  const U = base([gun]);
  await U.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: "gun~a" }));
  eq(U.prompt("reaction").options.map((o) => o.id), ["dodge", "pass"], "without it only a dodge");
}
/* ================================================================== Quickness [B1953], Regeneration [B1893], an unknown item, a reaction */
{
  const T = base([item("qu", "Quickness", "power"), item("re", "Regeneration", "power"), item("x", "Homebrew Ray", "power", { autos: [auto("a", "Homebrew Ray", "usePower", { stress: 1 })] }), item("it", "Intangibility", "power")], [], { h1: { health: 4, maxHealth: 6 } });
  await T.req("p1", decl("H1", act(T, "H1", "quickness").id));
  eq([T.state.ledger.H1.grants.filter((g) => g.kind === "quickness").length, code(await T.req("p1", decl("H1", act(T, "H1", "quickness").id))), why(T.last)], [1, "illegal", "usedAlready"], "Quickness: one extra unit a round");
  await T.req("p1", decl("H1", act(T, "H1", "regen").id));
  eq([T.c.H1.health, code(await T.req("p1", decl("H1", act(T, "H1", "regen").id)))], [5, "illegal"], "Regeneration: 1 Health, once a round");
  await T.req("p1", decl("H1", act(T, "H1", "u0").id, { text: "a ray of my own" }));
  eq([T.prompt("outcome")?.to, T.prompt("outcome")?.data?.name, T.c.H1.resolve, P1.budget(T.state, "H1").full], ["gm", "Homebrew Ray", 4, "used"], "an unknown power: its cost and stress are taken, the GM says what it does");
  await T.gm({ op: "answerFor", prompt: T.prompt("outcome").id, value: "success" });
  eq(C.reactionsFor(T.state, "H1", "beforeRoll", T.facts()).map((e) => [e.reaction.effect, e.stress?.fixed]), [["autoMiss", 1]], "Intangibility: a reaction that makes the attack miss, for 1 stress [B1940]");
  T.turn("N1");
  await T.gm(decl("N1", "slugfest", { targets: ["H1"] }));
  const p = T.prompt("reaction"), r = p.options.find((o) => o.id.startsWith("r:"));
  await T.req("p1", { op: "answer", prompt: p.id, value: r.id }); await T.roll("attack", 3);
  eq([T.c.H1.health, T.c.H1.resolve], [5, 3], "phasing: the attack misses, 1 stress");
}
/* ================================================================== the GM's settings travel as operations */
{
  const T = base([blast(0)]);
  eq(code(await T.gm({ op: "kitFlag", combatant: "H1", item: "blast", key: "off", value: true })), "ok", "kitFlag: accepted");
  eq(T.performed.filter((e) => e.t === "kitFlag").map((e) => [e.item, e.key, e.value]), [["blast", "off", true]], "kitFlag: handed to the host");
  eq(code(await T.req("p1", { op: "kitFlag", combatant: "H1", item: "blast", key: "off", value: true })), "noPermission", "kitFlag: the GM's only");
  await T.gm({ op: "summonSet", combatant: "N2", owner: "N1" });
  eq(T.performed.filter((e) => e.t === "summonFlag").map((e) => [e.combatant, e.owner]), [["N2", "N1"]], "summonSet: who summoned whom [B1808]");
  eq(code(await T.gm({ op: "summonSet", combatant: "N2", owner: "N2" })), "badInput", "nobody summons itself");
}
done("check-kit");
