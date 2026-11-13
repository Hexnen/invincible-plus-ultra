// node scripts/tactics/check-ansg.mjs -- ANSG: the user's answers of 2026-11-12 (dev/combat-answers-2026-11-12.md) still unbuilt after ANSF:
// FXT-10 (surprise rolled by the game), FXT-9 (Tactical Support on the attack's stunt card), P6b-4 (always huge / tiny change the attributes),
// P8b-1 (the copies take a disease's or poison's damage), P8b-2 (nothing stands a broken primary copy up), FXT-4 (Immobilize Only breaks
// free with the Snare level's penalty: checked), B3 + I4 (the chase is lost AT 5 zones), P6-R10 (a player's hero's abilities by Foundry's
// view right), P6b-R6 (Animal Control takes the animal at once), SWEEPM-11 (an unlinked hero token's roll in the hero's log), SWEEPM-13
// (scripts/sweep-checks/m048.mjs: a player's hero's damage card is open). Fights run through the REAL director, engine and round driver
// (testkit Table); the kit is built from items as the sheet carries them (kit-pure build).
import { readFileSync } from "node:fs";
import { ok, eqc as eq, done, Table, seeded } from "./testkit.mjs";
import * as M from "./mods-pure.mjs";
import * as K from "./kit-pure.mjs";
import * as O from "./ops-pure.mjs";
import * as S from "./state-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import { chase as Chase } from "../rules/index.mjs";
import { EN, PL, t as say } from "./lang.mjs";
import * as UI from "./ui/model-pure.mjs";
import * as Desk from "./desk-pure.mjs";

const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const why = (env) => env?.error?.params?.reason ?? null;
const decl = (actor, action, extra = {}) => ({ op: "declare", actor, decl: { action, ...extra } });
const st = (T, cid) => M.statusesOf(T.state, cid).map((s) => s.id);
const auto = (id, name, type, o = {}) => ({ id, name, type, show: o.show !== false, attr: o.attr ?? [], bonus: o.bonus ?? 0, stress: o.stress ?? 0, damage: o.damage ?? 0, min: o.min ?? 0, max: o.max ?? 0, bypass: false });
const item = (id, name, type, o = {}) => ({ id, name, type, level: o.level ?? null, power: o.power ?? null, boosts: o.boosts ?? [], autos: o.autos ?? [], fx: o.fx ?? [], flags: { kit: null, off: false, types: [], alt: false, ...(o.flags ?? {}) }, wf: o.wf ?? {} });
const LV = ["Basic", "Major", "Massive", "Monstrous"];
const levels = (pre, name, fn) => LV.map((w, i) => auto(`${pre}${i}`, `${name} - ${w}`, "rollAttack", fn(i)));

class FT extends Table {
  give(cid, items) { const c = this.c[cid]; c.src = items; c.kit = K.build({ items, attrs: c.attrs }); c.pass = c.kit.pass; c.bonus = {}; return this; }
  facts() {
    const f = super.facts(), T = this;
    return { ...f, canTalk: () => true, weapon: (cid, ref) => (ref == null || ref === "unarmed" ? { ...f.weapon(cid, ref), ...(T.c[cid]?.kit?.unarmed ?? {}) } : T.c[cid]?.kit?.weapons.find((w) => w.id === ref) ?? f.weapon(cid, ref)) };
  }
}
const base = (h1 = [], o = {}) => {
  const T = new FT();
  T.hero("H1", "p1", { zone: "z1", ...(o.h1 ?? {}) }).hero("H2", "p2", { zone: o.h2zone ?? "z1", ...(o.h2o ?? {}) }).npc("N1", { health: 6, zone: "z1", ...(o.n1 ?? {}) }).npc("N2", { health: 6, zone: "z2" });
  T.give("H1", h1).give("H2", o.h2 ?? []).give("N1", o.n1Items ?? []).give("N2", []);
  T.order(["H1", "N1", "H2", "N2"]).turn("H1"); return T;
};
const act = (T, cid, k) => T.c[cid].kit.actions.find((a) => a.id.endsWith(`-${k}`));
const passAll = async (T) => { for (let i = 0; i < 6; i++) { const p = T.prompt("reaction"); if (!p) break; await T.gm({ op: "answerFor", prompt: p.id, value: "pass" }); } };
const finish = async (T) => { for (let i = 0; i < 8; i++) { const p = T.prompts()[0]; if (!p) break; await T.gm({ op: "answerFor", prompt: p.id, value: p.kind === "stunts" ? [] : p.options?.find((o) => o.id === "pass")?.id ?? p.options?.[0]?.id ?? "pass" }); } };

/* ================================================================== B3 + I4 [B3436]: the prey is lost AT the end distance */
{
  eq([4, 5, 6].map((d) => Chase.chaseRoll({ distance: d, preySixes: 0, pursuerSixes: 0, endDistance: 5 }).escaped), [false, true, true], "B3: at 5 zones (the end distance) the prey is lost; at 4 the chase goes on");
  eq(Chase.chaseRoll({ distance: 4, preySixes: 2, pursuerSixes: 1, endDistance: 5 }), { distance: 5, winner: "prey", caught: false, escaped: true }, "B3: one six more from 4 zones: lost at 5");
  const T = new Table();
  T.hero("H1", "p1").npc("N1"); T.order(["H1", "N1"]);
  await T.gm({ op: "chaseStart", prey: ["N1"], pursuer: ["H1"], distance: 4 });
  await T.gm({ op: "chaseRound", obstacle: "clear" });
  await T.roll("prey", 2); await T.roll("pursuer", 1);
  eq([T.state.chase.distance, T.state.chase.last?.escaped], [5, 1], "B3: the chase round that ends at 5 zones is an escape (the engine; the panel's numbers: check-chase A)");
}
/* ================================================================== P6b-4 [B1975-1981]: always huge / always tiny change the attributes */
{
  const sa = (lv, kid, fxOn = false) => [item("sa", "Size Alteration", "power", { boosts: [kid.id], autos: [], fx: [{ id: "g", name: "Grow", on: fxOn }, { id: "s", name: "Shrink", on: false }], level: lv }), kid];
  const grow = (alt) => item("go", "Grow Only", "limit", { power: "sa", flags: { alt } }), shrink = (alt) => item("so", "Shrink Only", "limit", { power: "sa", flags: { alt } });
  eq(K.build({ items: sa(null, grow(true)) }).pass.alwaysSize, { size: "grow", n: 2 }, "P6b-4: always huge at the basic level: the size change of +2 / -2");
  eq(K.build({ items: sa(null, grow(false)) }).pass.alwaysSize, undefined, "P6b-4: Grow Only without the GM's 'always': nothing changes the attributes");
  eq(K.build({ items: sa(null, grow(true), true) }).pass.alwaysSize, undefined, "P6b-4: the sheet's own Grow effect is on: the sheet has it already, nothing is added");
  eq(K.build({ items: sa(null, shrink(true)) }).pass.alwaysSize?.size, "shrink", "P6b-4: always tiny");
  const attrs = { fighting: 4, agility: 5, strength: 6, reason: 2, intuition: 3, presence: 3 };
  eq(K.sizeAttrs(attrs, 3, { size: "grow", n: 2 }), { attrs: { ...attrs, strength: 8, agility: 3 }, slugfest: 4 }, "P6b-4 [B1975]: grown: STRENGTH +2, AGILITY -2, slugfest damage follows half the STRENGTH");
  eq(K.sizeAttrs(attrs, 3, { size: "shrink", n: 3 }), { attrs: { ...attrs, strength: 3, agility: 8 }, slugfest: 2 }, "P6b-4 [B1976], [B1977]: shrunk (Major): AGILITY +3, STRENGTH -3");
  eq(K.sizeAttrs({ ...attrs, strength: 11, agility: 2 }, 6, { size: "grow", n: 3 }).attrs, { ...attrs, strength: 12, agility: 1 }, "P6b-4 [B1975]: at most 12, at least 1");
  eq(K.sizeAttrs(attrs, 3, null), { attrs, slugfest: 3 }, "P6b-4: nothing set, nothing changed");
  const src = readFileSync(new URL("./system-adapter.mjs", import.meta.url), "utf8");
  ok(/if \(pass\.alwaysSize\) \(\{ attrs, slugfest: slug \} = Kit\.sizeAttrs\(attrs, slug, pass\.alwaysSize\)\)/.test(src) && /slugfest: \{ damage: slug \}/.test(src), "P6b-4: the adapter's facts (attributes the pools read, slugfest damage) take the size");
}
/* ================================================================== FXT-4 (PWC-11 checked) [B1606-1611]: Immobilize Only breaks free with the
   Snare level's penalty; a snare the GM puts on from the status menu stays at -2 */
{
  const snare = (lv) => [item("sn", "Snare", "power", { boosts: ["io"], autos: levels("Sn", "Snare", (i) => ({ attr: ["agility"], max: 1, show: i === lv })) }), item("io", "Immobilize Only", "limit", { power: "sn" })];
  const T = base(snare(1));
  await T.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: "sn~Sn1" })); await passAll(T); await T.roll("attack", 1); await finish(T);
  eq([st(T, "N1"), M.statusesOf(T.state, "N1")[0]?.data?.moveOnly], [["snared"], 1], "FXT-4: Immobilize Only snares (moving only)");
  T.turn("N1");
  eq(code(await T.gm(decl("N1", "escapeSnare"))), "ok", "FXT-4: the snared one breaks free as from a Snare");
  const r = T.lastRequest();
  eq([r.attr, r.pool.mods.find((m) => m.source === "snare")?.dice], ["strength", -3], "FXT-4: the Major level's -3 (the power's level), not the basic -2");
  const U = base();
  await U.gm({ op: "statusAdd", combatant: "N1", status: { id: "snared" } });
  U.turn("N1"); await U.gm(decl("N1", "escapeSnare"));
  eq(U.lastRequest().pool.mods.find((m) => m.source === "snare")?.dice, -2, "FXT-4: a snare from the GM's status menu: -2");
}
/* ================================================================== P8b-1 + P8b-R2 [B1910]: a disease's or a poison's damage goes to the copies first */
{
  const T = base([item("du", "Duplication", "power")]);
  await T.req("p1", decl("H1", act(T, "H1", "copies").id));
  eq(T.state.effects.find((e) => e.kind === "copies")?.data?.n, 3, "P8b-1: copy bonus 3");
  const h0 = T.c.H1.health;
  await T.gm({ op: "hazardRun", run: { type: "disease", virulence: 0, name: "Swamp fever" }, subject: { combatant: "H1" } }); await T.roll("roll", 0);
  eq([T.c.H1.health, T.state.effects.find((e) => e.kind === "copies")?.data?.n, st(T, "H1")], [h0, 2, ["sick"]], "P8b-1: the disease's 1 damage takes a copy, Health stays");
  await T.gm({ op: "hazardRun", run: { type: "disease", virulence: 0, name: "Snake venom" }, subject: { combatant: "H1" } }); await T.roll("roll", 0);
  eq([T.c.H1.health, T.state.effects.find((e) => e.kind === "copies")?.data?.n], [h0, 1], "P8b-1: a poison too");
  const dmg = T.evs("damage").filter((e) => e.dtype === "disease").pop();
  eq([dmg?.base, dmg?.taken, dmg?.copies?.absorbed], [1, 0, 1], "P8b-1: the damage line says the copies took it");
  /* Life Leech stays on Health: the leech takes from the target's Health, past the copies (P8b-R2) */
  const L = base([item("du", "Duplication", "power")], { n1Items: [item("hl", "Healing", "power", { boosts: ["ll"] }), item("ll", "Life Leech", "limit", { power: "hl" })], n1: { health: 6, maxHealth: 9 } });
  await L.req("p1", decl("H1", act(L, "H1", "copies").id));
  L.turn("N1");
  const leech = act(L, "N1", "leech") ?? L.c.N1.kit.actions.find((a) => a.effect?.kind === "leech");
  ok(!!leech, "P8b-R2: the leech action exists");
  if (leech) {
    const hh = L.c.H1.health;
    await L.gm(decl("N1", leech.id, { targets: ["H1"] }));
    await L.roll("roll", 1); await L.roll("touch", 1);
    eq([L.c.H1.health < hh, L.state.effects.find((e) => e.kind === "copies")?.data?.n], [true, 3], "P8b-R2: Life Leech drains Health, the copies stay");
  }
}
/* ================================================================== P8b-2 + P8b-R4 [B1915]: nothing stands a broken primary copy up */
{
  const dup = [item("du", "Duplication", "power", { boosts: ["so"] }), item("so", "Sequestered Original", "boost", { power: "du" })];
  const T = base(dup, { h2: [item("hl", "Healing", "power")], h1: { health: 0, maxHealth: 6 } });
  T.turn("H2");
  const heal = T.c.H2.kit.actions.find((a) => a.effect?.kind === "heal");
  ok(!!heal, "P8b-2: the healer has its heal");
  const r = await T.req("p2", decl("H2", heal.id, { targets: ["H1"] }));
  eq([code(r), why(r), r?.error?.params?.gmMayAllow ?? null], ["illegal", "rallyCopy", 1], "P8b-2: healing the broken primary copy is refused (the GM may allow)");
  eq(T.c.H1.health, 0, "P8b-2: still down");
  const U = base(dup, { h2: [item("hl", "Healing", "power")], h1: { health: 3, maxHealth: 6 } });
  U.turn("H2");
  eq(code(await U.req("p2", decl("H2", heal.id, { targets: ["H1"] }))), "ok", "P8b-2: a primary copy still standing is healed as before");
  const V = base([], { h2: [item("hl", "Healing", "power")], h1: { health: 0, maxHealth: 6 } });
  V.turn("H2");
  eq(code(await V.req("p2", decl("H2", heal.id, { targets: ["H1"] }))), "ok", "P8b-2: a broken hero without Sequestered Original is healed as before");
}
/* ================================================================== P6b-R6 [B1637]: Animal Control takes the animal at once, no roll */
{
  const T = base([item("ac", "Animal Control", "power")]);
  const a = act(T, "H1", "control");
  eq(a?.roll ?? null, null, "P6b-R6: no roll");
  eq(code(await T.req("p1", decl("H1", a.id, { targets: ["N1"] }))), "ok", "P6b-R6: declared");
  eq([T.prompt("outcome"), T.c.N1.summonOf, P1.budget(T.state, "H1").full, T.requests.filter((q) => q.combatant === "H1").length], [null, "H1", "used", 0], "P6b-R6: no GM card, the animal is the hero's at once, a full action, no dice");
  const cmd = act(T, "H1", "command");
  eq([cmd?.cost, cmd?.roll?.attr], ["quick", "presence"], "P6b-R6: an unusual order is the PRESENCE roll (quick)");
}
/* ================================================================== FXT-9 [B2168]: Tactical Support on the attack's stunt card */
{
  const T = base([item("ts", "Tactical Support", "talent")]);
  ok(T.c.H1.pass.tacticalSupport === true, "FXT-9: the talent is known");
  ok(!!act(T, "H1", "support"), "FXT-9: the button stays");
  await T.req("p1", decl("H1", "slugfest", { targets: ["N1"] })); await passAll(T); await T.roll("attack", 3);
  const p = T.prompt("stunts");
  const sup = (p?.options ?? []).filter((o) => o.data?.stunt === "support");
  eq([...new Set(sup.map((o) => o.data.target))], ["H2"], "FXT-9: support is offered for the ally in reach (not the foe, not the attacker)");
  eq(sup.map((o) => o.id), ["support@H2|1", "support@H2|2"], "FXT-9: one option per surplus six");
  eq([code(await T.gm({ op: "answerFor", prompt: p.id, value: ["support@N1|1"] })), why(T.last)], ["illegal", "notOffered"], "FXT-9: not for a foe");
  eq([code(await T.gm({ op: "answerFor", prompt: p.id, value: ["support@H2|1", "support@H2|2", "doubleDamage@N1"] })), p.max], ["badInput", 2], "FXT-9: support counts against the sixes (two surplus sixes, three picks refused)");
  eq(code(await T.gm({ op: "answerFor", prompt: p.id, value: ["support@H2|1", "support@H2|2"] })), "ok", "FXT-9: both sixes to the ally");
  await finish(T);
  const tk = (T.state.tokens ?? []).filter((x) => x.holder === "H2");
  eq(tk.map((x) => [x.dice, x.scope, x.uses, x.from]), [[4, { next: 1 }, 1, "H1"]], "FXT-9: +2 dice per six to the ally's next attribute roll");
  eq(T.c.N1.health, 6 - 2, "FXT-9: the blow itself hits as usual (no Double Damage taken)");
  ok(typeof EN["ITAC.stunt.support"] === "string" && PL["ITAC.stunt.support"] === "Wsparcie", "FXT-9: the stunt's name (PL: Wsparcie)");
  const W4 = base([item("ts", "Tactical Support", "talent")]);
  await W4.req("p1", decl("H1", "slugfest", { targets: ["N1"] })); await passAll(W4); await W4.roll("attack", 5);
  eq((W4.prompt("stunts")?.options ?? []).filter((o) => o.data?.stunt === "support").length, 4, "FXT-9 [B2168]: every surplus six may go to support (the book has no cap)");
  const U = base([]);
  await U.req("p1", decl("H1", "slugfest", { targets: ["N1"] })); await passAll(U); await U.roll("attack", 3);
  ok(!(U.prompt("stunts")?.options ?? []).some((o) => o.data?.stunt === "support"), "FXT-9: without the talent no support");
  const F = base([item("ts", "Tactical Support", "talent")], { h2zone: "z9" }); F.setRange("H1", "H2", 2);
  await F.req("p1", decl("H1", "slugfest", { targets: ["N1"] })); await passAll(F); await F.roll("attack", 3);
  ok(!(F.prompt("stunts")?.options ?? []).some((o) => o.data?.stunt === "support"), "FXT-9: an ally two zones away is out of reach [B2168]");
}
/* ================================================================== FXT-10 [B2279]: a surprise attack: the game rolls the defenders' passive INTUITION */
{
  const GM = { user: "gm", staff: true, owns: () => true, hold: true };
  const parts = [{ id: "H1", hero: true, owners: ["p1"], intuition: 3 }, { id: "H2", hero: true, owners: ["p2"], intuition: 2 }, { id: "N1", hero: false, owners: [], intuition: 2 }, { id: "N2", hero: false, owners: [], intuition: 2 }, { id: "N3", hero: false, owners: [], intuition: 1 }];
  const start = (surprise, seed) => O.reduce(null, O.normalize({ op: "start", mode: "tactical", restart: true, surprise }, { staff: true }).action, { ...GM, parts, rng: seeded(seed) });
  const r = start("npcs", 3);
  const p = Object.values(r.state.prompts).find((x) => x.kind === "surprise");
  eq([r.ok, r.state.phase, !!p, p?.to, p?.multi, p?.options.map((o) => o.id)], [true, "draw", true, "gm", 1, ["N1", "N2", "N3"]], "FXT-10: the deal waits for the GM's card; the defenders are the side named (the NPCs)");
  eq(p.options.map((o) => o.data.dice), [2, 2, 1], "FXT-10: each rolls its INTUITION dice");
  ok(p.options.every((o) => o.data.faces.length === o.data.dice && o.data.sixes === o.data.faces.filter((f) => f === 6).length), "FXT-10: the faces and the sixes of each roll are on the card");
  eq(p.data.failed, p.options.filter((o) => o.data.sixes === 0).map((o) => o.id), "FXT-10: those who rolled no six stand as surprised");
  ok(r.state.init.slots.every((s) => s.card === null), "FXT-10: no card dealt yet");
  eq(code(O.reduce(r.state, O.normalize({ op: "answer", prompt: p.id, value: { order: [], skip: ["N2", "N3"] } }, { staff: false }).action, { user: "p1", staff: false, owns: () => false, parts, rng: seeded(1) })), "notOwner", "FXT-10: only the GM answers");
  const a = O.reduce(r.state, O.normalize({ op: "answer", prompt: p.id, value: { order: [], skip: ["N2"] } }, { staff: true }).action, { ...GM, parts, rng: seeded(5) });
  const card = (id) => a.state.init.slots.find((s) => s.members.includes(id))?.card;
  eq([a.ok, a.state.phase !== "draw"], [true, true], "FXT-10: the GM's word (here: N1 and N3, the GM's correction) deals the cards");
  const others = a.state.init.slots.filter((x) => !x.members.some((m) => m === "N1" || m === "N3")).map((x) => x.card);
  ok(Math.min(card("N1"), card("N3")) > Math.max(...others), "FXT-10 [B2279]: the surprised get the worst cards (the highest of the deck, I5)");
  eq([M.statusesOf(a.state, "N1").map((s) => s.id), M.statusesOf(a.state, "N3").map((s) => s.id), M.statusesOf(a.state, "N2").map((s) => s.id)], [["unaware"], ["unaware"], []], "FXT-10: the surprised are unaware (A6: until their first turn ends)");
  /* the GM's desk card: the defenders with their rolls, the failures ticked, the answer in the round card's shape */
  const names = { N1: "Mauler", N2: "Thug", N3: "Rat" };
  const dcard = Desk.deskModel(r.state, null, { c: (id) => (names[id] ? { name: names[id], npc: true } : null) }).cards.find((c) => c.kind === "surprise");
  const ad = dcard && UI.askData(dcard, { t: (k, prm, fb) => say(k, prm, fb), facts: { c: (id) => (names[id] ? { name: names[id] } : null) }, own: {}, desk: true });
  eq(ad?.title, EN["ITAC.Prompt.surprise.Title"], "FXT-10: the card's title");
  eq(ad?.options.map((o) => [o.id, o.picked]), p.options.map((o) => [o.id, p.data.failed.includes(o.id)]), "FXT-10: those who rolled no six stand ticked");
  ok(ad?.options.every((o, i) => o.label.startsWith(`${names[o.id]}: `) && o.label.includes(String(p.options[i].data.sixes))), "FXT-10: each line names the defender and its sixes");
  eq(ad?.submit?.req, { op: "answerFor", prompt: p.id, value: { order: [], skip: p.options.map((o) => o.id).filter((id) => !p.data.failed.includes(id)) } }, "FXT-10: confirming sends the list as it stands");
  const viaDesk = O.reduce(r.state, O.normalize({ ...ad.submit.req, op: "answer" }, { staff: true }).action, { ...GM, parts, rng: seeded(5) });
  eq([viaDesk.ok, viaDesk.state.phase !== "draw"], [true, true], "FXT-10: the desk's answer deals the cards");
  const b = O.reduce(r.state, O.normalize({ op: "answer", prompt: p.id, value: { order: [], skip: ["N1", "N2", "N3"] } }, { staff: true }).action, { ...GM, parts, rng: seeded(5) });
  eq([b.ok, b.state.phase !== "draw", Object.values(b.state.statuses ?? {}).flat().length], [true, true, 0], "FXT-10: the GM may clear the list: an ordinary deal");
  const h = start("heroes", 3);
  eq(Object.values(h.state.prompts).find((x) => x.kind === "surprise")?.options.map((o) => o.id), ["H1", "H2"], "FXT-10: the heroes surprised: the heroes roll");
  const n = start(undefined, 3);
  eq([Object.values(n.state.prompts).some((x) => x.kind === "surprise"), n.state.phase], [false, "turns"], "FXT-10: no surprise: the deal as before");
  const g = O.reduce(null, O.normalize({ op: "start", mode: "tactical", restart: true, surprise: "npcs", surprised: ["N2"] }, { staff: true }).action, { ...GM, parts, rng: seeded(3) });
  eq([Object.values(g.state.prompts).some((x) => x.kind === "surprise"), g.state.phase], [false, "turns"], "FXT-10: the GM's own list (the API) wins over the roll");
  eq(S.parse(S.serialize(r.state)).init.draw?.surpriseWait, r.state.init.draw.surpriseWait, "FXT-10: the waiting deal survives the store");
}
{ /* FXT-10: the GM's field on the tracker reaches the start */
  const cc = readFileSync(new URL("./combat-class.mjs", import.meta.url), "utf8"), mn = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  ok(/Relay\.request\(this\.id, \{ op: "start", restart: true, \.\.\.\(surprise \? \{ surprise \} : \{\}\) \}\)/.test(cc), "FXT-10: Begin Combat hands the GM's mark to the start");
  ok(/data-action="startCombat"/.test(cc) && /combat\.round > 0/.test(cc) && /Store\.isStaff\(game\.user\)/.test(cc), "FXT-10: the field sits by Begin Combat, for the GM, before the fight");
  ok(/Hooks\.on\("renderCombatTracker", \(app, html\) => Klass\.surpriseField\(app, html\)\)/.test(mn), "FXT-10: drawn with the tracker");
  for (const k of ["ITAC.ui.surprise.npcs", "ITAC.ui.surprise.heroes", "ITAC.ui.surprise.on", "ITAC.ui.surprise.off"]) ok(typeof EN[k] === "string" && typeof PL[k] === "string", `FXT-10: ${k} in both languages`);
}
/* ================================================================== SWEEPM-11: an unlinked hero token's roll goes into the hero's log */
{
  const src = readFileSync(new URL("../log/scribe.mjs", import.meta.url), "utf8");
  const i = src.indexOf("const onCreateMessage ="), body = src.slice(i, src.indexOf("\n});", i));
  ok(/const rollActorOf = \(speaker\) => \(speaker\?\.isToken \? game\.actors\.get\(speaker\.id\) \?\? null : speaker\);/.test(src), "SWEEPM-11: the roll of a token's synthetic actor is the world actor's");
  ok(body.includes("rollActorOf(speaker)") && body.includes("elig(actor)"), "SWEEPM-11: the hook still asks elig (S042) of the world actor");
  ok(/if \(viaToken && \(isDamageCard\(message\) \|\| !message\.rolls\?\.length\)\) return;/.test(body), "SWEEPM-11: only the roll: the damage card of such a copy stays out");
  ok(body.indexOf("if (tok && tok !== actor.name) d.tok = tok;") > 0, "SWEEPM-11: the token's own name rides along when it differs");
}
/* ================================================================== P6-R10: who reads a player's hero's abilities */
{
  const src = readFileSync(new URL("./system-adapter.mjs", import.meta.url), "utf8");
  const i = src.indexOf("export function mayReadKit("), fnSrc = src.slice(i, src.indexOf("\n}\n", i) + 2).replace("export ", "");
  const may = new Function("game", `${fnSrc}; return mayReadKit;`)({ user: { id: "u2" } });
  const actor = (type, perm, playerOwner = true) => ({ type, isOwner: perm === "OWNER", hasPlayerOwner: playerOwner, testUserPermission: (_u, lvl) => ({ NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 })[perm] >= ({ LIMITED: 1, OBSERVER: 2, OWNER: 3 })[lvl] });
  eq([may(actor("superhero", "OBSERVER")), may(actor("superhero", "LIMITED")), may(actor("superhero", "NONE"))], [true, false, false], "P6-R10: a player's hero: who may view the sheet (Observer) reads its abilities; Limited or none: no");
  eq([may(actor("npc", "OBSERVER")), may(actor("superhero", "OBSERVER", false))], [false, false], "P6-R10: an NPC, or a hero no player owns, stays the GM's and the owner's (spec 10)");
  eq(may(actor("npc", "OWNER")), true, "P6-R10: the owner always");
  const eng = readFileSync(new URL("./engine.mjs", import.meta.url), "utf8");
  ok((eng.match(/Sys\.mayReadKit\(a\)/g) ?? []).length === 2, "P6-R10: the engine's context gives the kit and the sheet's dice by that right");
}
done("check-ansg");
