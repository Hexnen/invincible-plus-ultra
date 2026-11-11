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
import { ROWS, NOTES, LEVELS, WHYS } from "./kitdata-pure.mjs";
import { NAMES } from "./check-kit-names.mjs";
import { EN, PL } from "./lang.mjs";
import { KIT_KINDS } from "./flows/acts.mjs";
import { marked } from "./flows/kit.mjs";

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
    ok(r.state === "hand" || r.acts?.length || r.atk || r.fx || r.mv || r.pass || r.mods || r.opt || r.weapon || r.cost || r.size || r.sizeOnly || r.lockFx || r.bars || r.throwOf || ["sheet", "system", "initiative", "off", "interrupt", "gmCard", "zone", "outcome", "roll", "move"].includes(r.note), `${r.name}: an entry that is not by hand has something behind it`);
    ok(r.state === "hand" ? WHYS.includes(r.why) && both(`ITAC.kit.why.${r.why}`) : !r.why, `${r.name}: by hand only with the reason the book leaves it to the table, in both languages (${r.why ?? "none"})`);
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
  give(cid, items, bonus = {}) { const c = this.c[cid]; c.src = items; c.kit = K.build({ items, attrs: c.attrs }); c.pass = c.kit.pass; c.bonus = bonus; c.grown = c.pass.grown === true; c.huge = (c.hugeBase ??= c.huge) || c.pass.huge === true; if (c.pass.stressArmor) c.armor = [...c.armor, { id: "defiance", armor: c.pass.stressArmor, stress: true }]; return this; }
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
  /* both are journaled: the undo writes back what stood there */
  eq([T.c.H1.itemFlags.blast.off, T.c.N2.summonOf, T.state.summons.map((s) => [s.owner, s.combatants])], [true, "N1", [["N1", ["N2"]]]], "the flags stand, and the round driver knows who acts on whose turn [I14]");
  ok(!T.state.init.slots.some((s) => s.members.includes("N2")), "a summoned combatant holds no card of its own");
  const [a, b] = T.log.list.slice(-2).map((x) => x.id);
  eq(code(await T.gm({ op: "undo", tx: b })), "ok", "summonSet: undone through the journal");
  eq([T.c.N2.summonOf, T.state.summons, T.state.init.slots.some((s) => s.members.includes("N2"))], [null, [], true], "the flag is back, the combatant draws a card again");
  eq(code(await T.gm({ op: "undo", tx: a })), "ok", "kitFlag: undone through the journal");
  eq(T.c.H1.itemFlags.blast.off, null, "the item's flag is back");
}
/* ================================================================== Summoning [B1808-1816]: allies that really stand in the fight */
{
  const summ = (level = "basic", more = []) => [item("su", "Summoning", "power", { level }), ...more];
  const slotOf = (T, id) => T.state.init.slots.some((s) => s.members.includes(id));
  const T = base(summ());
  const a = act(T, "H1", "summon"), dm = act(T, "H1", "dismiss");
  eq([a.pick, a.cost, a.kit.state], [["versatile", "powered", "more"], "full", "assist"], "Summoning at Basic: one feature to choose, a full action");
  eq([code(await T.req("p1", decl("H1", dm.id))), why(T.last)], ["illegal", "noSummons"], "nothing to dismiss yet");
  eq(code(await T.req("p1", decl("H1", a.id, { opt: "more" }))), "ok", "summon: declared");
  const sid = Object.keys(T.c).find((k) => T.c[k].summonOf === "H1"), S1 = T.c[sid];
  eq([S1.kind, S1.members, S1.attrs.strength, S1.resolve, S1.owners, S1.npc], ["minions", 5, 4, 6, ["p1"], false], "five allies as one group of minions: attributes 4, Resolve 6, run by the summoner's player [B1808], [B1811]");
  eq([T.state.summons.map((s) => [s.owner, s.combatants]), slotOf(T, sid), P1.budget(T.state, sid).full, P1.budget(T.state, "H1").full], [[["H1", [sid]]], false, "open", "used"], "they hold no card and act on the summoner's turn, also the turn they appear");
  eq(code(await T.req("p1", decl(sid, "slugfest", { targets: ["N1"] }))), "ok", "the player declares the group's attack on the hero's own turn");
  await pass(T); await T.roll("attack", 0);
  eq([code(await T.gm({ op: "declare", actor: "H1", gm: true, decl: { action: a.id, opt: "more" } })), why(T.last)], ["illegal", "summonsOut"], "no second group while the first is out [B1812]");
  /* the journal: the arrival is one transaction, undone as one */
  const tx = T.log.list.find((x) => x.ops.some((o) => o.t === "summon+"));
  ok(!!tx, "the arrival is journaled");
  /* broken allies leave by themselves; the leave is journaled and can be undone */
  await T.gm({ op: "setHealth", combatant: sid, value: 0 });
  eq([!!T.c[sid], T.state.summons, !!T.state.ledger[sid], T.log.list.at(-1).ops.map((o) => o.t)], [false, [], false, ["summon-"]], "a broken group leaves the fight (token, combatant, its place in the round)");
  await T.gm({ op: "undo", tx: T.log.list.at(-1).id });
  eq([!!T.c[sid], T.state.summons.map((s) => s.combatants)], [true, [[sid]]], "undo of the leave: the group stands again (the GM sets its Health)");
  await T.gm({ op: "setHealth", combatant: sid, value: 3 });
  /* dismissed by a full action */
  eq(code(await T.gm({ op: "declare", actor: "H1", gm: true, decl: { action: dm.id } })), "ok", "dismiss");
  eq([!!T.c[sid], T.state.summons], [false, []], "dismissed: gone [B1812]");
  /* the summoner is broken: the allies go */
  const U = base(summ("major"));
  const ua = act(U, "H1", "summon");
  eq(ua.pick.length, 6, "Major: two features, the same one twice if wished [B1813]");
  eq([code(await U.req("p1", decl("H1", ua.id, { opt: "powered" }))), why(U.last)], ["illegal", "noChoice"], "one feature is not a choice at Major");
  await U.req("p1", decl("H1", ua.id, { opt: "powered+more", text: "wolves with a Blast" }));
  const uid = Object.keys(U.c).find((k) => U.c[k].summonOf === "H1");
  eq([U.c[uid].members, U.c.H1.resolve, U.performed.filter((e) => e.t === "message").map((e) => [e.key, e.gmOnly, e.params.powered, e.params.text])], [5, 4, [["ITAC.msg.summonFinish", 1, 1, "wolves with a Blast"]]], "powered and more: 1 stress, five allies, the GM is told what to finish on the group's sheet [B1810]");
  await U.gm({ op: "undo", tx: U.log.list.at(-1).id });
  eq([!!U.c[uid], U.state.summons, U.c.H1.resolve, P1.budget(U.state, "H1").full], [false, [], 5, "open"], "undo of the summoning: the group is gone, the stress and the action are back");
  await U.req("p1", decl("H1", ua.id, { opt: "more+more" }));
  const uid2 = Object.keys(U.c).find((k) => U.c[k].summonOf === "H1");
  eq(U.c[uid2].members, 7, "more twice: seven");
  await U.gm({ op: "setHealth", combatant: "H1", value: 0 });
  eq([!!U.c[uid2], U.state.summons], [false, []], "the summoner is broken: the allies leave [B1812]");
  /* Delayed Summoning [B1816]; the end of the scene */
  const V = base([item("su", "Summoning", "power", { boosts: ["ds"] }), item("ds", "Delayed Summoning", "limit", { power: "su" })]);
  await V.req("p1", decl("H1", act(V, "H1", "summon").id, { opt: "versatile" }));
  const vid = Object.keys(V.c).find((k) => V.c[k].summonOf === "H1");
  eq([V.c[vid].members, code(await V.req("p1", decl(vid, "slugfest", { targets: ["N1"] }))), V.state.summons[0].wait], [3, "notYourTurn", [vid]], "Delayed Summoning: three allies that do not act on the turn they appear");
  V.turn("N1").turn("H2").turn("N2");
  await V.gm({ op: "nextRound" });
  for (let i = 0; i < 6 && V.state.init.curMember !== "H1"; i++) await V.gm({ op: "nextTurn" });
  eq([V.state.round, V.state.summons[0].wait, code(await V.req("p1", decl(vid, "slugfest", { targets: ["N1"] })))], [2, undefined, "ok"], "they act from the summoner's next turn on");
  await pass(V); await V.roll("attack", 0);
  await V.gm({ op: "endScene" });
  eq([V.state.phase, !!V.c[vid]], ["sceneEnd", false], "the scene ends: summoned allies are gone");
}
/* ================================================================== Animal Control [B1637]: the controlled animal acts on the hero's turn */
{
  const T = base([item("ac", "Animal Control", "power")]);
  const a = act(T, "H1", "control");
  eq([code(await T.req("p1", decl("H1", a.id, { targets: ["N2"] }))), why(T.last)], ["illegal", "hugeTarget"], "not a huge creature");
  T.setRange("H1", "N1", 2);
  eq([code(await T.req("p1", decl("H1", a.id, { targets: ["N1"] }))), why(T.last)], ["illegal", "tooFar"], "this zone or the next");
  T.setRange("H1", "N1", 1);
  await T.req("p1", decl("H1", a.id, { targets: ["N1"], text: "the guard dog" }));
  eq(T.prompt("outcome")?.to, "gm", "the GM confirms that it is an animal and that it obeys");
  await T.gm({ op: "answerFor", prompt: T.prompt("outcome").id, value: "success" });
  eq([T.c.N1.summonOf, T.state.summons.map((s) => [s.owner, s.combatants]), T.state.init.slots.some((s) => s.members.includes("N1")), P1.budget(T.state, "N1").full], ["H1", [["H1", ["N1"]]], false, "open"], "controlled: it acts on the hero's turn, the very same turn too");
  await T.gm({ op: "setHealth", combatant: "H1", value: 0 });
  ok(!!T.c.N1, "a controlled animal is not removed like summoned allies");
}
/* ================================================================== entries that used to be run by hand */
{
  const strike = (more) => [item("st", "Strike", "power", { boosts: more.map((m) => m.id) }), ...more];
  /* Toxic Strike [B1621] */
  const T = base(strike([item("tx", "Toxic Strike", "boost", { power: "st" })]), [], { n1: { health: 6 } });
  await T.req("p1", decl("H1", "slugfest", { targets: ["N1"] })); await pass(T); await T.roll("attack", 1); await noStunts(T);
  eq([T.c.N1.health < 6, M.statusesOf(T.state, "N1").find((s) => s.id === "sick")?.data], [true, { toxic: 1, virulence: 0 }], "Toxic Strike: a hit that does damage poisons the target");
  const h0 = T.c.N1.health;
  await T.gm({ op: "endTurn", actor: "H1" });
  for (let i = 0; i < 4 && !T.requests.some((r) => r.label === "ITAC.roll.disease"); i++) { const q = T.prompt("triggerQueue"); if (q) await T.gm({ op: "answerFor", prompt: q.id, value: q.options[0].id }); else break; }
  ok(T.state.init.curMember === "N1" && T.requests.some((r) => r.label === "ITAC.roll.disease" && r.attr === "strength" && r.combatant === "N1"), "at the start of the victim's turn the engine asks for its STRENGTH roll");
  await T.roll("roll", 0);
  eq([T.c.N1.health, M.hasStatus(T.state, "N1", "sick")], [h0 - 1, true], "failed: 1 damage past the armor, the poison stays");
  /* a roll the target makes to resist: Terrifying Illusions [B1717], Phobic [B2187] */
  const U = base([item("il", "Illusion", "power", { boosts: ["ti"] }), item("ti", "Terrifying Illusions", "boost", { power: "il" }), item("ph", "Phobic", "drawback")]);
  await U.req("p1", decl("H1", act(U, "H1", "terrify").id, { targets: ["N1"] }));
  eq([U.lastRequest().key, U.lastRequest().attr, U.lastRequest().combatant], ["res:N1", "intuition", "N1"], "Terrifying Illusions: the target rolls INTUITION, no action of its own");
  await U.roll("res:N1", 1);
  eq([U.c.N1.resolve, M.hasStatus(U.state, "N1", "stunned")], [3, false], "one six: 2 of the 3 stress land, the turn is kept");
  await U.gm({ op: "declare", actor: "H1", gm: true, decl: { action: act(U, "H1", "terrify").id, targets: ["N1"] } }); await U.roll("res:N1", 0);
  eq([U.c.N1.resolve, M.hasStatus(U.state, "N1", "stunned"), !!U.state.ledger.N1.lostTurn], [0, true, true], "no six: all 3 stress and the next turn is lost");
  const V = base([item("ph", "Phobic", "drawback")]);
  await V.req("p1", decl("H1", act(V, "H1", "phobia").id)); await V.roll("res:H1", 0);
  eq([P1.budget(V.state, "H1").full, P1.budget(V.state, "H1").quick], ["used", ["used", "lost"]], "Phobic: the PRESENCE roll failed, this turn is lost");
  /* Mass Healing [B1934], Cleansing Healing [B1935], Resilience [B2160], Life Leech [B1937] */
  const W = base([item("he", "Healing", "power", { boosts: ["mh", "ch"] }), item("mh", "Mass Healing", "boost", { power: "he" }), item("ch", "Cleansing Healing", "boost", { power: "he" }), item("rs", "Resilience", "talent")], [], { h1: { health: 2, maxHealth: 6 } });
  W.add("H3", { owners: ["p3"], health: 1, maxHealth: 6 }); W.c.H2.health = 3;
  await W.gm({ op: "roster" });
  await W.req("p1", decl("H1", act(W, "H1", "massHeal").id, { targets: ["H2", "H3"] })); await W.roll("roll", 1);
  eq([W.c.H2.health, W.c.H3.health, W.c.H1.resolve], [6, 4, 4], "Mass Healing: one roll heals both, 1 stress for the second target");
  eq([code(await W.gm({ op: "declare", actor: "H1", gm: true, decl: { action: act(W, "H1", "resilience").id, opt: "3" } })), W.c.H1.health, W.c.H1.resolve], ["ok", 5, 1], "Resilience: 3 damage just taken become 3 stress");
  await W.gm({ op: "statusAdd", combatant: "H2", status: { id: "sick" } });
  await W.gm({ op: "declare", actor: "H1", gm: true, decl: { action: act(W, "H1", "cleanse").id, targets: ["H2"] } }); await W.roll("roll", 1);
  ok(!M.hasStatus(W.state, "H2", "sick"), "Cleansing Healing: the sickness is gone");
  const X = base([item("he", "Healing", "power", { boosts: ["ll"] }), item("ll", "Life Leech", "limit", { power: "he" })], [], { h1: { health: 2, maxHealth: 6 } });
  await X.req("p1", decl("H1", act(X, "H1", "leech").id, { targets: ["N1"] })); await X.roll("roll", 1);
  eq([X.c.H1.health, X.c.N1.health], [5, 3], "Life Leech: what the healer gains the target loses");
  /* Windup Strike [B1622]; Requires Activation (Defiance) [B1869]; an extra target for a point of stress [B1763] */
  const Y = base([...strike([item("ws", "Windup Strike", "limit", { power: "st" })]), item("df", "Defiance", "power", { boosts: ["ra"] }), item("ra", "Requires Activation (Defiance)", "limit", { power: "df" }),
    item("mc", "Mind Control", "power", { boosts: ["ac"] }), item("ac", "Area Control", "boost", { power: "mc" })]);
  eq([code(await Y.req("p1", decl("H1", "slugfest", { targets: ["N1"] }))), why(Y.last), Y.last.error.params.gmMayAllow], ["illegal", "noWindup", 1], "Windup Strike: no unarmed attack before the quick action (the GM may allow it)");
  await Y.req("p1", decl("H1", act(Y, "H1", "ready").id));
  eq(code(await Y.req("p1", decl("H1", "slugfest", { targets: ["N1"] }))), "ok", "readied: the attack goes ahead");
  await pass(Y); await Y.roll("attack", 0);
  eq([Y.c.H1.pass.defianceOff, marked(Y.state, "H1", "defiance", true)], [true, false], "Defiance that needs activating is off at first");
  await Y.gm({ op: "declare", actor: "H1", gm: true, decl: { action: act(Y, "H1", "activate").id } });
  eq([marked(Y.state, "H1", "defiance", true), code(await Y.gm({ op: "declare", actor: "H1", gm: true, decl: { action: act(Y, "H1", "activate").id } })), why(Y.last)], [true, "illegal", "usedAlready"], "activated for the scene, once");
  const r0 = Y.c.H1.resolve;
  await Y.gm({ op: "declare", actor: "H1", gm: true, decl: { action: act(Y, "H1", "many").id, opt: "2" } });
  eq(Y.c.H1.resolve, r0 - 2, "Area Control: two targets beyond the first, 2 stress");
  /* Killer [B2121], Lucky Break [B2149], Sequestered Original [B1915]: the injury roll */
  const crit = async (nItems, hItems) => { const Z = base(hItems, nItems, { h1: { health: 1, maxHealth: 6 } }); Z.turn("N1"); Z.dice = [[2, 5]]; await Z.gm(decl("N1", "slugfest", { targets: ["H1"] })); await pass(Z); await Z.roll("attack", 1); const p = Z.prompt("stunts"); if (p) await Z.gm({ op: "answerFor", prompt: p.id, value: [] });
    return [Z.performed.filter((e) => e.t === "dice" && String(e.why).startsWith("crit")).map((e) => e.n), Z.evs("crit").map((e) => e.crit.roll)]; };
  eq(await crit([], []), [[1], [3]], "an ordinary injury: one die (2, and 1 for the hit)");
  eq(await crit([item("ki", "Killer", "talent")], []), [[2], [6]], "Killer: two dice, the higher is kept");
  eq(await crit([], [item("lb", "Lucky Break", "talent")]), [[2], [3]], "Lucky Break: two dice, the lower is kept");
  eq(await crit([], [item("du", "Duplication", "power", { boosts: ["so"] }), item("so", "Sequestered Original", "boost", { power: "du" })]), [[], []], "Sequestered Original: broken, no injury is rolled");
  /* an attack of the book on an item with no attack data of its own (a hand-made item the GM mapped to the entry) */
  const bare = K.build({ items: [item("db", "Blast", "power")], attrs: { agility: 4 } });
  eq([bare.weapons.length, bare.rows.find((r) => r.item === "db").state, bare.rows.find((r) => r.item === "db").note], [0, "assist", "noAttack"], "an attack entry on an item without attack numbers is not called automated: the row says what is missing");
  /* what the builder makes of the rest */
  const k = K.build({ items: [item("mc", "Mind Control", "power", { boosts: ["hy"] }), item("hy", "Hypnosis", "limit", { power: "mc" }), item("si", "Signature Item", "power", { boosts: ["th"] }), item("th", "Throwable Item", "boost", { power: "si" }),
    item("sw", "Swimming", "power", { boosts: ["fs"] }), item("fs", "Fast Swimmer", "boost", { power: "sw" }), item("du", "Duplication", "power", { boosts: ["so"] }), item("so", "Sequestered Original", "boost", { power: "du" }),
    item("ki", "Killer", "talent"), item("em", "Emanation", "power", { boosts: ["ce"], fx: [{ id: "e", name: "Emanation", on: true }] }), item("ce", "Continual Emanation", "limit", { power: "em" }), item("an", "Analysis", "talent")], attrs: { strength: 5 } });
  eq([k.actions.some((a) => a.kit.item === "mc"), k.rows.find((r) => r.item === "mc").barred], [false, 1], "Hypnosis: Mind Control is not offered during a fight [B1764]");
  eq(k.weapons.filter((w) => w.id === "th~throw").map((w) => [w.fam, w.damage, w.range]), [["shoot", 3, [0, 3]]], "Throwable Item: a shooting attack, damage and range half the STRENGTH [B1970]");
  eq([k.pass.fastSwim, k.pass.noCrit, k.pass.killer, k.actions.some((a) => a.kit.item === "em")], [true, true, true, false], "Fast Swimmer, Sequestered Original and Killer are facts the engine reads; a continual Emanation is never switched off");
  eq(k.rows.find((r) => r.item === "an").why, "outOfFight", "a row left to the table carries its reason");
}
/* ================================================================== Size Alteration [B1974-1981]: the size has its effects */
{
  const size = (level, grow, shrink, more = []) => [item("sz", "Size Alteration", "power", { level, boosts: more.map((m) => m.id), fx: [{ id: "g", name: "Grow", on: grow }, { id: "s", name: "Shrink", on: shrink }] }), ...more];
  const T = base(size("basic", false, false), size("major", false, true));
  eq(T.c.H1.kit.actions.filter((x) => x.effect.kind === "toggle").map((x) => [x.name, x.cost]), [["Grow", "full"], ["Shrink", "full"]], "growing and shrinking are full actions of the dock");
  eq([T.c.H1.grown, T.c.N1.pass.shrunkDice], [false, 3], "the size is read from the sheet's effects: nobody grown, the NPC shrunk at Major");
  eq(code(await T.req("p1", decl("H1", "slugfest", { targets: ["N1"] }))), "ok", "an attack on the shrunk character");
  await pass(T);
  eq(T.requests.find((r) => r.key === "attack").pool.mods.filter((m) => m.source === "shrunk").map((m) => m.dice), [-3], "physical attacks against a shrunk character lose 3 dice at Major [B1977]");
  await T.roll("attack", 0);
  const U = base(size("basic", false, false));
  await U.req("p1", decl("H1", U.c.H1.kit.actions.find((x) => x.name === "Grow").id));
  eq([U.c.H1.grown, U.c.H1.pass.shrunkDice ?? 0], [true, 0], "Grow switched on from the dock: the character is grown");
  U.turn("N1");
  eq([code(await U.gm(decl("N1", "grapple", { targets: ["H1"] }))), why(U.last)], ["illegal", "immune"], "a grown character cannot be grappled [B1975]");
  await U.gm(decl("N1", "slugfest", { targets: ["H1"] })); await pass(U, "gm"); await U.roll("attack", 4);
  const offered = (U.prompt("stunts")?.options ?? []).filter((o) => ["knockback", "slam"].includes(o.data?.stunt) && o.data?.target === "H1").map((o) => [o.data.stunt, o.disabled ?? null]);
  ok(offered.length >= 1 && offered.every((o) => o[1] === "immune"), `Knockback and Slam are refused against a grown character [B1975]: ${JSON.stringify(offered)}`);
  /* the limits: one direction only, or always that size */
  const g = K.build({ items: size("basic", false, false, [item("go", "Grow Only", "limit", { power: "sz" })]), attrs: {} });
  eq([g.actions.filter((x) => x.effect.kind === "toggle").map((x) => x.name), g.rows.find((r) => r.name === "Grow Only").alt], [["Grow"], "huge"], "Grow Only: the dock offers only growing; the GM may say 'always huge'");
  const h = K.build({ items: size("basic", false, false, [item("go", "Grow Only", "limit", { power: "sz", flags: { alt: true } })]), attrs: {} });
  eq([h.actions.filter((x) => x.effect.kind === "toggle").length, h.pass.huge, h.pass.grown ?? false, h.rows.find((r) => r.name === "Size Alteration").state], [0, true, false, "auto"], "always huge: a huge creature, nothing to switch [B1980]");
  const s = K.build({ items: size("massive", false, false, [item("so", "Shrink Only", "limit", { power: "sz", flags: { alt: true } })]), attrs: {} });
  eq([s.actions.filter((x) => x.effect.kind === "toggle").length, s.pass.shrunkDice], [0, 4], "always tiny: attacks against lose the dice of the level all the time [B1981]");
  const W = base([blast(0)]);
  eq(code(await W.gm({ op: "kitFlag", combatant: "H1", item: "blast", key: "alt", value: true })), "ok", "the GM's setting travels as a journaled operation");
}
/* ================================================================== Defensive [B2105]: offered when the attack comes, never ahead of it */
{
  const T = base([item("de", "Defensive", "talent")], [], { h1: { resolve: 2, maxResolve: 5 } });
  ok(!T.c.H1.kit.actions.some((x) => /defensive/.test(x.id)), "Defensive: no action of its own in the dock (nothing is armed without an attack)");
  T.turn("N1");
  await T.gm(decl("N1", "slugfest", { targets: ["H1"] }));
  let p = T.prompt("reaction");
  eq(p.options.map((o) => [o.id, o.cost, o.stress ?? 0, o.disabled ?? null]), [["block", "quick", 0, null], ["block:free", "none", 1, null], ["pass", undefined, 0, null]], "Defensive: the defence that fits the attack is also offered for 1 stress and no action");
  eq(p.to, { users: ["p1"] }, "the question goes to the player");
  await T.req("p1", { op: "answer", prompt: p.id, value: "block:free" });
  eq([T.c.H1.resolve, P1.budget(T.state, "H1").quick], [1, ["open", "open"]], "1 stress, the quick action is still there");
  await T.roll("attack", 1); await T.roll("def:H1", 2);
  await T.req("p1", { op: "answer", prompt: T.prompt("counter").id, value: "pass" });
  T.turn("H2").turn("N2");
  await T.gm(decl("N2", "slugfest", { targets: ["H1"] }));
  p = T.prompt("reaction");
  await T.req("p1", { op: "answer", prompt: p.id, value: "block:free" });
  eq(T.c.H1.resolve, 0, "again in the same round, as long as there is Resolve");
  await T.roll("attack", 0);
  const U = base([item("de", "Defensive", "talent")], [], { h1: { resolve: 0, maxResolve: 5 } });
  U.turn("N1"); await U.gm(decl("N1", "slugfest", { targets: ["H1"] }));
  eq(U.prompt("reaction").options.filter((o) => o.id.endsWith(":free")).map((o) => o.disabled), ["stressedOut"], "without Resolve it is shown and refused");
}
/* ================================================================== the five talents the dock runs itself: the sheet's switch is not counted a second time */
{
  const k = K.build({ items: [item("sn", "Sniper", "talent"), item("rf", "Rapid Fire", "talent"), item("hh", "Hard Hitter", "talent"), item("ma", "Martial Arts", "talent"), item("bt", "Bigger They Are", "talent"), item("ev", "Evasive", "talent")], attrs: {} });
  eq(k.sheetSkip.slice().sort(), ["Bigger They Are", "Hard Hitter", "Martial Arts", "Rapid Fire", "Sniper"], "their sheet effects are left out of the pools (the engine applies the dice itself)");
}
/* ================================================================== adversary 3 (combat-defects.md D20, D22, D23, D25) */
const gun = (id, name, o = {}) => item(id, name, "gear", { autos: [auto("a", name, "rollAttack", { attr: ["agility"], ...o })] });
const nextRoundOf = async (T) => { T.turn("N1"); T.turn("H2"); T.turn("N2"); await T.gm({ op: "nextRound" }).catch(() => {}); if (T.state.init?.curMember !== "H1") T.turn("H1"); };
/* ---- D20: Duplication. Any damage goes to the copy bonus first [B1910]; the bonus is added to every slugfest and shooting attack [B1908] */
{
  const copies = (T, c = "H1") => T.state.effects.find((e) => e.kind === "copies" && e.holder === c)?.data?.n ?? 0;
  const mk = async (extra = []) => { const T = base([item("du", "Duplication", "power"), ...extra], [], { h1: { health: 8, maxHealth: 8, resolve: 5 } }); await T.req("p1", decl("H1", act(T, "H1", "copies").id)); return T; };
  { const T = await mk(); T.dice.push([6, 6, 1, 1, 1, 1]);
    await T.gm({ op: "hazard", hazard: { kind: "fire", intensity: 6 }, targets: ["H1"] });
    eq([copies(T), T.c.H1.health], [0, 7], "D20: a fire's 4 damage takes the 3 copies first, 1 goes on to Health [B1910]"); }
  { const T = await mk();
    await T.gm({ op: "hazard", hazard: { kind: "fixed", amount: 2, armor: false, source: "kinetic", cause: "fall" }, targets: ["H1"] });
    eq([copies(T), T.c.H1.health], [1, 8], "D20: fixed damage (a fall, a barrier, a slam) is taken by the copies"); }
  { const T = await mk(); T.dice.push([6, 1, 1, 1, 1, 1]);
    await T.gm({ op: "hazardRun", run: { type: "blast", rating: 6, targets: ["H1"] } }); await T.answer("p1", "hazardDodge", "pass", "H1");
    eq([copies(T), T.c.H1.health], [0, 8], "D20: a blast's damage is taken by the copies"); }
  { const T = await mk(); T.turn("N1");
    await T.gm(decl("N1", "slugfest", { targets: ["H1"] }));
    await T.gm({ op: "manual", inst: T.top().id, result: { note: "by hand", damage: [{ target: "H1", amount: 4 }] } });
    eq([copies(T), T.c.H1.health], [0, 7], "D20: damage the GM enters by hand is damage too: copies first"); }
  { const T = await mk([item("td", "Traumatic Duplication", "limit", { power: "du" })]), r0 = T.c.H1.resolve;
    await T.gm({ op: "hazard", hazard: { kind: "fixed", amount: 2, armor: false, source: "kinetic", cause: "fall" }, targets: ["H1"] });
    eq([copies(T), T.c.H1.health, r0 - T.c.H1.resolve], [1, 8, 1], "D20: Traumatic Duplication costs its stress when the copies take damage outside an attack as well [B1916]"); }
  for (const action of ["slugfest", "grapple"]) {
    const T = await mk(); await nextRoundOf(T);
    eq(code(await T.req("p1", decl("H1", action, { targets: ["N1"] }))), "ok", `D20: ${action} with copies out`);
    const rp = T.prompt("reaction"); if (rp) await T.answer("gm", "reaction", "pass", rp.about);
    eq((T.requests.filter((r) => r.key === "attack").at(-1)?.pool?.mods ?? []).filter((m) => m.source === "copies").map((m) => m.dice), [3], `D20: the copy bonus is in the ${action} pool [B1908], [B2431]`);
  }
}
/* ---- D22: Sequestered Original: the broken primary copy is killed and cannot be rallied [B1915] */
{
  const T = base([item("du", "Duplication", "power", { boosts: ["so"] }), item("so", "Sequestered Original", "boost", { power: "du" })], [], { h1: { health: 2, maxHealth: 8 } });
  eq([T.c.H1.kit.pass.noCrit, T.c.H1.kit.pass.noRally], [true, true], "D22: the boost says both halves of the book line: no injury, no rallying");
  T.turn("N1");
  await T.gm(decl("N1", "slugfest", { targets: ["H1"] })); await T.answer("p1", "reaction", "pass", "H1"); await T.roll("attack", 1);
  eq([T.c.H1.health, M.hasStatus(T.state, "H1", "broken")], [0, true], "D22: the primary copy is broken by the hit");
  T.turn("H1");
  eq([code(await T.req("p1", decl("H1", "rally"))), why(T.last), T.last.error?.params?.gmMayAllow], ["illegal", "rallyCopy", 1], "D22: it cannot rally itself (the GM may rule otherwise)");
  T.turn("H2");
  eq([code(await T.req("p2", decl("H2", "rally", { targets: ["H1"] }))), why(T.last)], ["illegal", "rallyCopy"], "D22: nor can a friend rally it");
  const U = base([item("du", "Duplication", "power")], [], { h1: { health: 2, maxHealth: 8 } });
  U.turn("N1"); await U.gm(decl("N1", "slugfest", { targets: ["H1"] })); await U.answer("p1", "reaction", "pass", "H1"); await U.roll("attack", 1);
  for (const p of U.prompts()) if (p.kind !== "reaction") await U.gm({ op: "answerFor", prompt: p.id, value: p.options?.[0]?.id ?? "pass" }).catch(() => {});
  U.turn("H2");
  ok(why(await U.req("p2", decl("H2", "rally", { targets: ["H1"] }))) !== "rallyCopy", "D22: a duplicator without the boost is rallied as anybody");
}
/* ---- D23: the book's weapon table is the profile where the item is silent or says less [B2541-2546], [B2576-2590] */
{
  for (const [name, o] of [["Taser", { bonus: 1, damage: 2 }], ["Pepper Spray", { bonus: 2, damage: 1 }]]) {
    const T = base([gun("w", name, o)], []), w = T.c.H1.kit.weapons[0];
    eq([w.fam, w.range, w.stunEffect], ["shoot", [0, 0], true], `D23: ${name} is a ranged weapon of range 0/0 with the table's STUN effect mark, not a slugfest weapon`);
    eq([code(await T.req("p1", decl("H1", "slugfest", { targets: ["N1"], weapon: w.id }))), T.state.stack.length], ["illegal", 0], `D23: ${name} is not swung in a slugfest`);
    eq(code(await T.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: w.id }))), "ok", `D23: ${name} is shot in the same zone`);
    eq((T.prompt("reaction", "N1")?.options ?? []).filter((x) => !x.disabled).map((x) => x.id).sort(), ["dodge", "pass"], `D23: ${name} is dodged, never blocked`);
  }
  { const T = base([gun("sr", "Sniper rifle", { bonus: 2, damage: 3, min: 1, max: 10 })], []), w = T.c.H1.kit.weapons[0];
    T.setRange("H1", "N1", 2);
    eq([w.noMove, code(await T.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: w.id })))], [true, "ok"], "D23: a Sniper rifle is fired by somebody who has not moved");
    await T.answer("gm", "reaction", "pass", "N1"); await T.roll("attack", 0);
    const r = await T.req("p1", decl("H1", "move", {}));
    eq([code(r), why(r), r.error?.params?.gmMayAllow], ["illegal", "firedNoMove", 1], "D23: and then there is no moving for the rest of that round [B2545]");
    await nextRoundOf(T);
    ok(why(await T.req("p1", decl("H1", "move", {}))) !== "firedNoMove", "D23: the next round the shooter moves again"); }
  { const T = base([gun("hg", "Hand grenade", { damage: 3, max: 1 })], []), w = T.c.H1.kit.weapons[0];
    eq([w.singleUse, code(await T.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: w.id })))], [true, "ok"], "D23: a Hand grenade is thrown");
    await T.answer("gm", "reaction", "pass", "N1"); await T.roll("attack", 0);
    await nextRoundOf(T);
    const r = await T.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: w.id }));
    eq([code(r), why(r), r.error?.params?.gmMayAllow], ["illegal", "weaponUsed", 1], "D23: single use: gone after the throw, hit or miss [B2541] (a second one from the pack is the GM's word)"); }
  { const kit = K.build({ items: [gun("cm", "Cruise missile", { damage: 9 }), gun("nm", "Nuclear missile", { damage: 12 }), gun("mg", "Machinegun", { bonus: 2, damage: 3, min: 1, max: 6 }), gun("rl", "Rocket launcher", { damage: 5, min: 1, max: 4 })], attrs: {} });
    eq(kit.weapons.map((w) => [w.name, !!w.noMove, !!w.singleUse]), [["Machinegun", true, false], ["Rocket launcher", false, true]], "D23: Machinegun: no movement; Rocket launcher: single use");
    eq(kit.rows.filter((r) => /missile/.test(r.name)).map((r) => [r.state, r.why]), [["hand", "gmJudges"], ["hand", "gmJudges"]], "D23: a weapon whose range is in miles is no zone weapon: by hand, the GM judges"); }
  for (const k of ["stunEffect", "singleUse", "noMove"]) ok(typeof EN[`ITAC.ui.weapon.${k}`] === "string" && typeof PL[`ITAC.ui.weapon.${k}`] === "string", `D23: "${k}" is said in both languages`);
}
/* ---- D25: Medical instruments require the Medic talent [B3309] */
{
  const mi = item("mi", "Medical instruments", "gear"), medic = item("md", "Medic", "talent");
  const dice = (items) => { const kit = K.build({ items, attrs: { reason: 3 } }); return [K.modsFor(kit, { action: "stabilize", attr: "reason" }).map((m) => m.dice), kit.pass.medicalGear === true]; };
  eq(dice([mi]), [[], false], "D25: without Medic the instruments give no dice and no right to stabilise");
  eq(dice([medic, mi]), [[2, 2], true], "D25: with Medic they do");
  const row = K.build({ items: [mi], attrs: {} }).rows.find((r) => r.name === "Medical instruments");
  eq([row?.state, row?.note, NOTES.includes("lacks")], ["hand", "lacks", true], "D25: the row says what is missing");
  ok(ROWS.filter((r) => r.needs).every((r) => ROWS.some((x) => x.name === r.needs || x.key === r.needs)), "D25: every requirement names a row of the registry");
}
done("check-kit");
