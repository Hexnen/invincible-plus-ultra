// node scripts/tactics/check-fxe3.mjs -- fixer FXE3 (findings of the live fight FF6, dev/combat-defects.md and combat-usability.md):
//   D204  the chase's "escaped" end card named a hidden NPC to the players (it left the Combat, so Foundry's hidden switch no longer
//         covered it); the same hole for any hidden combatant deleted mid-fight (its journal lines, its events)
//   hunt  other ways a player learnt of a hidden NPC: the undo line of a hidden action, a turn passed while hidden (after a reveal), the
//         engine's own dice cards (an injury of a hidden NPC, its fall) and their speaker, a name read for an id the player may not know
//   D206  the party column drew the skull on a hero who is only broken (0 Health)
//   U204  "Drop the barrier" offered with no barrier up (refused only after Declare)
//   U205  the round-start fire roll's news line did not name the zone
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import * as V from "./view-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as CP from "./ui/chase-pure.mjs";
import * as UI from "./ui/model-pure.mjs";
import * as D from "./desk-pure.mjs";
import * as K from "./kit-pure.mjs";
import * as Src from "./source.mjs";
import { t as say, EN, PL } from "./lang.mjs";
import { MTable } from "./check-kit-map.mjs";
import { readFileSync } from "node:fs";

const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const t = (k, p, fb) => say(k, p, fb === undefined ? k : fb);
const src = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
/* the meta the runtime builds (engine.mjs metaOf): the hidden switches of who is in the Combat now, and who left it hidden */
const metaOf = (T, flagList = null) => ({ hidden: [...Object.values(T.c).filter((c) => c.hidden).map((c) => c.id), ...(V.leftHidden?.(T.state, flagList, (id) => !!T.c[id]) ?? [])], npc: Object.values(T.c).filter((c) => c.npc).map((c) => c.id) });
const pv = (T, me, owns, flagList = null) => V.viewFor(T.state, { id: me, staff: false, owns }, metaOf(T, flagList));

/* ================================================================== D204: the chase's end card */
const car = (o = {}) => ({ kind: "vehicle", npc: true, health: 8, vehicle: { type: "ground", speed: 3, maneuver: 1, passengers: 3, weapons: 0 }, ...o });
{
  const T = new Table();
  T.hero("H1", "p1", { name: "Kid" }).hero("H2", "p2", { name: "Omni" });
  T.npc("N1", { name: "Doc" }).npc("N4", { name: "Turret", hidden: true });
  T.add("V1", car({ name: "Van" }));
  T.order(["H1", "N1", "H2", "N4"]).turn("H1");
  await T.gm({ op: "vehicleSet", vehicle: "V1", seat: { who: "H1", role: "driver" }, started: true });
  eq(code(await T.gm({ op: "chaseStart", prey: ["N1", "N4"], pursuer: ["V1"], distance: 4 })), "ok", "D204 table: the heroes chase Doc and the hidden turret");
  eq(code(await T.gm({ op: "chaseEnd", outcome: "escaped" })), "ok", "D204: the GM ends the chase: they got away");
  eq([!!T.c.N1, !!T.c.N4], [false, false], "D204: both fleeing NPCs left the Combat");
  eq((T.state.chaseEnded.gone ?? []).map((x) => [x.id, x.hid ?? 0]).sort(), [["N1", 0], ["N4", 1]], "D204: the end record marks the one Foundry hid");
  const v = pv(T, "p1", ["H1"]);
  ok(!/N4|Turret/.test(JSON.stringify(v)), "D204: nothing in the player's view names or points at the hidden turret");
  const facts = { staff: false, me: "p1", c: (id) => (T.c[id] ? { name: T.c[id].name } : null), userName: () => "", online: () => true, rollBusy: () => false };
  const card = CP.chaseData(v, {}, facts, t);
  eq([card?.ended?.outcome, card.ended.sides.find((s) => s.id === "prey").units, /Doc/.test(card.ended.gone ?? ""), /Turret/.test(JSON.stringify(card))], ["escaped", ["Doc"], true, false],
    "D204: the player's end card names Doc (who was seen) and never the turret, neither among the fleeing nor among those who left");
  const gm = CP.chaseData(T.state, {}, { ...facts, staff: true, me: "gm" }, t);
  ok(/Turret/.test(gm.ended.gone) && gm.ended.sides.find((s) => s.id === "prey").units.includes("Turret"), "D204: the GM's card still names it");
  /* the public event of the end carries no id of the hidden one */
  const ev = { type: "chase", state: "end", outcome: "escaped", gone: ["N1", "N4"] };
  eq(V.publicEvent(T.state, ev, metaOf(T))?.gone, ["N1"], "D204: the public event of the end lists only who the table saw leave");
  /* the journal: a line about the gone turret stays the GM's */
  const log = { list: [{ id: "t1", round: 1, at: 1, state: "closed", label: { pub: "{c:H1}: x", who: { H1: "Kid", N4: "Turret" } } }, { id: "t2", round: 1, at: 2, state: "closed", label: { pub: "{c:H1}: y", who: { H1: "Kid" } } }] };
  const rn = V.readerNames(T.state, { id: "p1", owns: ["H1"] }, metaOf(T), [{ id: "H1", name: "Kid" }]);
  eq(V.journalFor(log, { id: "p1", staff: false, owns: ["H1"] }, { concealed: rn.concealed, name: (id) => rn.names[id] ?? null }).map((x) => x.id), ["t2"], "D204: a journal line about the turret that left hidden stays from the player");
  /* the undo brings it back: its own switch is read again (here: revealed meanwhile) */
  T.c.N4 = { ...(T.c.N1 ?? {}), id: "N4", name: "Turret", hidden: false, npc: true };
  eq((V.leftHidden ?? (() => null))(T.state, null, (id) => !!T.c[id]), [], "D204: one who is back in the Combat is read from its own switch, not the record");
}
const hla = (...a) => (typeof V.hidLeftAdd === "function" ? V.hidLeftAdd(...a) : "missing");
/* a hidden combatant the GM deletes mid-fight: the Combat's own list (engine.mjs noteHiddenLeave, preDeleteCombatant) */
{
  eq([hla(null, "N9"), hla(["N9"], "N9"), hla(["a"], "")], [["N9"], null, null], "D204: the list of who left hidden grows by one id, once");
  eq(hla(Array.from({ length: (V.HID_LEFT_MAX ?? 200) }, (_, i) => `x${i}`), "y").length, (V.HID_LEFT_MAX ?? 200), "D204: the list is bounded");
  eq((V.leftHidden ?? (() => null))({}, ["N9", 3, "N8"], (id) => id === "N8"), ["N9"], "D204: the Combat's list counts, who is present again does not");
  const E = src("./engine.mjs"), M = src("./main.mjs");
  ok(/const metaOf = \(combat, state = Store\.stateOf\(combat\)\) => \(\{ hidden: \[\.\.\.combat\.combatants[^\n]*V\.leftHidden\(state, combat\.flags\?\.\[MOD\]\?\.hidLeft/.test(E), "D204: the runtime's meta adds who left hidden (the end record and the Combat's list)");
  ok(/const meta = metaOf\(combat, state \?\? Store\.stateOf\(combat\)\)/.test(E) && /V\.viewFor\(state, viewer\(user, c\), metaOf\(c, state\)\)/.test(E), "D204: the events and the view read the meta of the state they carry");
  ok(/Hooks\.on\("preDeleteCombatant", \(cb\) => \{ try \{ const c = cb\?\.parent, list = c && game\.user\?\.isGM && Store\.stateOf\(c\) && V\.concealed\(cb, cb\.token\) \? V\.hidLeftAdd\(c\.flags\?\.\[MOD\]\?\.hidLeft, cb\.id\) : null; if \(list\) c\.update\(\{ \[`flags\.\$\{MOD\}\.hidLeft`\]: list \}/.test(M), "D204: a hidden combatant is written down before it is deleted");
  ok(/names\[cb\.id\] \?\? \(Store\.isStaff\(game\.user\) \? cb\.name : t\("ITAC\.Someone"\)\)/.test(E), "hunt: a name asked for an id the player may not know reads \"someone\", never the combatant's own name");
}

/* ================================================================== hunt: the undo of a hidden action, a turn passed hidden */
const base = () => { const T = new Table(); T.hero("H1", "p1").hero("H2", "p2").npc("N1", { health: 5 }).npc("N2", { health: 4 }); T.order(["H1", "N1", "H2", "N2"]).turn("H1"); return T; };
const slug = (actor, target) => ({ op: "declare", actor, decl: { action: "slugfest", targets: [target] } });
const settle = async (T) => { for (let n = 0; n < 12 && T.prompts().length; n++) { const p = T.prompts()[0]; await T.gm({ op: "answerFor", prompt: p.id, value: p.multi ? [] : (p.options.find((o) => o.id === "pass" || o.id === "none") ?? p.options.find((o) => !o.disabled)).id }); } };
{
  const H = base(); H.c.N1.hidden = true; H.turn("N1");
  await H.gm(slug("N1", "H2")); await H.answer("p2", "reaction", "pass", "H2"); await H.roll("attack", 2); await settle(H);
  eq(H.state.news.at(-1)?.hid, 1, "hunt table: the hidden NPC's attack is a line kept from the table");
  eq(code(await H.gm({ op: "undo", tx: H.log.list.filter((x) => x.state === "closed" && x.ops?.length).at(-1).id })), "ok", "hunt: the GM takes it back");
  const u = H.state.news.at(-1);
  eq([u.kind, u.hid, u.hidA], ["undo", 1, 1], "hunt: the undo line is kept from the table like the line it takes back");
  H.c.N1.hidden = false;      // the GM reveals the NPC afterwards
  for (const [me, owns] of [["p1", ["H1"]], ["p2", ["H2"]]]) ok(!pv(H, me, owns).news.some((n) => n.kind === "undo" && (n.actor === "N1" || n.action)), `hunt (${me}): after the reveal no undo line names the hidden NPC or what it did`);
}
{
  const E = src("./engine-pure.mjs");
  ok(/pushNews\(X, \{ kind: "turn", actor: fx\.combatant, result: `pass\.\$\{why\}`, \.\.\.\(c\.hidden \? \{ hid: 1, hidA: 1 \} : \{\}\) \}\)/.test(E), "hunt: a turn passed while hidden is a line kept from the table (also after a reveal)");
  const B = base(); await B.gm({ op: "noop" });
  const s = { ...B.state, news: [{ id: "n1", round: 1, kind: "turn", actor: "N1", result: "pass.broken", hid: 1, hidA: 1 }] };
  eq((V.viewFor(s, { id: "p1", staff: false, owns: ["H1"] }, { hidden: [] }).news ?? []).length, 0, "hunt: such a line is not shown after the reveal");
}
/* the engine's own dice: about somebody hidden they go to the GM alone */
{
  const fall = async (hidden) => {
    const F = new MTable(); F.hero("H1", "p1").npc("N1", { health: 6, hidden }); F.put("H1", "z3").put("N1", "z2:elevated"); F.order(["H1", "N1"]); F.dice.push([5]); F.performed.length = 0;
    await F.gm({ op: "fall", combatant: "N1" }); await F.roll("agi", 0); await settle(F);
    return F.performed.filter((e) => e.t === "dice");
  };
  const dice = await fall(true);
  ok(dice.length > 0 && dice.every((e) => e.gm === 1), `hunt: the dice of a hidden NPC's fall are for the GM (${dice.map((e) => `${e.why}:${e.gm ?? 0}`).join(",")})`);
  const d2 = await fall(false);
  ok(d2.length > 0 && d2.every((e) => !e.gm), "hunt: the dice of a visible NPC stay public");
  const E = src("./engine.mjs");
  ok(/const card = V\.diceCard\(e, MOD, /.test(E) && /ChatMessage\.create\(card\.seal\(await roll\.toMessage\(card\.data, \{ create: false, \.\.\.mode \}\)\)/.test(E), "hunt: the engine's dice card is built by diceCard");
  const dc = typeof V.diceCard === "function" ? V.diceCard : () => null;
  const pub = dc({ why: "crit:N1" }, "m", "Injury", "Gamemaster", () => ["g1"]), sec = dc({ why: "crit:N1", gm: 1 }, "m", "Injury", "Gamemaster", () => ["g1"]);
  eq([pub?.data.speaker, pub?.data.whisper, pub?.data.flags.m.tactics.dice, pub?.mode], [{ scene: null, actor: null, token: null, alias: "Gamemaster" }, undefined, "crit:N1", {}], "hunt: a public dice card speaks for the user, never the GM's selected token");
  eq([sec?.data.whisper, sec?.data.flags.m.tactics.dice, sec?.mode, sec?.seal({ whisper: [], rolls: [1] }).whisper], [["g1"], "crit", { messageMode: "gm", rollMode: "gmroll" }, ["g1"]], "hunt: a hidden one's dice card goes to the GMs (whisper kept after toMessage) and its flag carries no id");
}

/* ================================================================== D206: broken is not dead */
const life = (...a) => (typeof Src.lifeOf === "function" ? Src.lifeOf(...a) : null);
{
  const S = (state = null, defeated = []) => ({ combatants: { get: (id) => ({ defeated: defeated.includes(id) }) }, flags: state ? { "invincible-plus-ultra": { tactics: { state: JSON.stringify(state) } } } : {} });
  eq(life(S(), ["c1"], { v: 0, max: 9 }), { dead: false, broken: true }, "D206 [B2707]: 0 Health is broken, not dead");
  eq(life(null, [], { v: 0, max: 9 }), { dead: false, broken: true }, "D206: also outside a fight");
  eq(life(S(), ["c1"], { v: 3, max: 9 }), { dead: false, broken: false }, "D206: with Health, neither");
  eq(life(S(), ["c1"], { v: 0, max: 9 }, true), { dead: true, broken: false }, "D206: the defeated mark on the actor is dead");
  eq(life(S(null, ["c1"]), ["c1"], { v: 0, max: 9 }), { dead: true, broken: false }, "D206: a combatant marked defeated (the fight marks the dead so) is dead");
  const P = src("../party/main.mjs"), PN = src("../party/panel.mjs"), C = readFileSync(new URL("../../styles/party.css", import.meta.url), "utf8");
  ok(/const \{ dead, broken \} = Tac\.lifeOf\(combat, cids, hp, mark\)/.test(P) && !/hp\.v <= 0 : false\) \|\|/.test(P), "D206: the party card reads its life by that rule (no skull for hp <= 0)");
  ok(/toggleAttribute\("data-broken", !item\.defeated && !!item\.broken\)/.test(PN) && /\[data-broken\] \.ipt-skull::before \{ content: "\\f7a9"/.test(C), "D206: a broken hero shows the cracked heart (fa-heart-crack), the skull stays for the dead");
  const L = src("../party/lang.mjs");
  ok(/"IPT\.Broken": "Broken"/.test(L) && /"IPT\.Broken": "Złamany"/.test(L), "D206: its spoken name in both languages");
}

/* ================================================================== U204: no barrier, no drop */
{
  const item = (id, name, type, o = {}) => ({ id, name, type, level: null, power: o.power ?? null, boosts: o.boosts ?? [], autos: [], fx: [], flags: { kit: null, off: false, types: [] }, wf: {} });
  const T = new Table(); T.hero("H1", "p1").hero("H2", "p2").npc("N1"); T.order(["H1", "N1", "H2"]).turn("H1");
  T.c.H1.kit = K.build({ items: [item("ba", "Barrier", "power")], attrs: T.c.H1.attrs }); T.c.H1.pass = T.c.H1.kit.pass;
  T.c.H2.zone = T.c.H1.zone;
  const ctx = { c: (id) => T.c[id] ?? null, kit: (id) => T.c[id]?.kit ?? null, online: () => true, P1 };
  const drop = () => D.barModel(V.viewFor(T.state, { id: "p1", staff: false, owns: ["H1"] }, { hidden: [], npc: ["N1"] }), "H1", ctx).actions.find((a) => a.id.endsWith("-dropBarrier"));
  eq(drop()?.disabled, "noBarrierUp", "U204: with no barrier up, the drop is greyed before Declare");
  const put = T.c.H1.kit.actions.find((a) => a.id.endsWith("-barrier"));
  eq(code(await T.req("p1", { op: "declare", actor: "H1", decl: { action: put.id, targets: ["H2"] } })), "ok", "U204: a barrier goes up");
  eq(drop()?.disabled ?? null, null, "U204: now the drop is offered");
  const w = (L) => [L["ITAC.reason.noBarrierUp"], L["ITAC.why.noBarrierUp"], L["ITAC.fix.noBarrierUp"]].every((x) => typeof x === "string" && x);
  ok(w(EN) && w(PL), "U204: the reason in both languages (a fix of its own: no \"ask the GM\")");
}

/* ================================================================== U205: the fire roll names its zone */
{
  const facts = { staff: false, c: () => null, zone: (z) => ({ title: `Zone ${String(z).replace(/^z/, "")}` }) };
  const line = (n) => UI.newsData({ round: 2, news: [{ id: "n5_f", round: 2, kind: "action", action: "fireSpread", flow: "hazard", status: "closed", rows: [], ...n }] }, {}, facts, t)?.text ?? "";
  const out = line({ zone: "z10", result: "out" }), stays = line({ zone: "z7", result: "stays" }), spreads = line({ zone: "z7", result: "spreads", to: "z11" });
  ok(/10/.test(out) && out.includes(EN["ITAC.result.out"]) && !out.includes(EN["ITAC.action.fireSpread"]), `U205: "the fire goes out" names the zone (${out})`);
  ok(/7/.test(stays) && stays.includes(EN["ITAC.result.stays"]), `U205: "the fire stays" names the zone (${stays})`);
  ok(/7/.test(spreads) && /11/.test(spreads), `U205: a spread names where from and where to (${spreads})`);
  ok(typeof PL["ITAC.ui.news.spreadTo"] === "string" && typeof EN["ITAC.ui.news.spreadTo"] === "string", "U205: both languages");
  ok(/I\.action === "fireSpread" && typeof I\.data\?\.hz\?\.zone === "string"/.test(src("./engine-pure.mjs")), "U205: the engine writes the zone on the news line of the fire roll");
}
done("check-fxe3");
