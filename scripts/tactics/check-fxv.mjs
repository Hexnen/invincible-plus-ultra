/* node scripts/tactics/check-fxv.mjs -- FIXER V (owed work Z20-Z42, Z57, Z58 of dev/combat-decisions.md section 6; tree tactics, tag
   tactics-integrated-61). One block per item; each fails on the code before its fix and pins it. Fights run through the REAL director,
   engine and view (testkit Table); what only Foundry runs is pinned by reading its source.
     Z24 (CU6)        the GM's own "declare anyway" opens no second card of consent on the GM's desk
     Z26 (P8g-4)      "next turn" when nobody can act is refused (state unchanged), not three empty rounds
     Z27 (P8b-7)      what an undo could not take back stays under its journal line on the GM's desk
     Z30 (P6b-14)     sending summoned allies away has its own journal label, not the power's name
     Z33 (P8e-9)      an undone grant takes its card of consent with it
     Z39 (CHASE2-12)  undoing the chase roll that opened the next round takes the fight's round back too
     Z40 (P8d-6)      a roll message with another number of dice than asked (or more sixes than dice) is not taken
     Z32 (P8e-7)      the panel of a declared action names the helpers who joined later and their dice
     Z34 (P8f-5)      the chance "if they resist" of an opposed action is the engine's defending pool, not the bare attribute
     Z35 (P8f-6)      a full-auto series at targets in two zones says "all targets of a series in one zone", not "in another zone"
     Z37 (FXF-11)     a card made again (U121) keeps the picks still valid; Z36 (P8g-6) a failed surface start takes its listeners off
     Z22 (P9-13)      without a map a target chip out of reach is greyed with its reason at once
     Z20 (CI4)        the GM card of a forced move also takes a corrected route (a zone within the distance, picked on the map)
     Z21 (W1-9)       the end-of-turn zone warns "may collapse" (a challenge ending this round) and "someone holds off" (provisional readings)
     Z25 Z28 Z29 Z31 Z42 Z57 Z58  found done already (or fixed by a text edit): pinned as they stand */
import { readFileSync } from "node:fs";
import { Table, ok, eqc as eq, done } from "./testkit.mjs";
import * as D from "./desk-pure.mjs";
import * as V from "./view-pure.mjs";
import * as J from "./journal-pure.mjs";
import * as M from "./ui/model-pure.mjs";
import { tIn, EN, PL } from "./lang.mjs";

const here = new URL(".", import.meta.url);
const src = (p) => readFileSync(new URL(p, here), "utf8");
const css = () => readFileSync(new URL("../../styles/tactics-ui.css", here), "utf8");
const t = (k, p = {}, f) => tIn("pl", k, p, f);
const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const base = (opts) => { const T = new Table(opts); T.hero("H1", "p1").hero("H2", "p2").npc("N1", { health: 5 }).npc("N2", { health: 4 }); T.order(["H1", "N1", "H2", "N2"]).turn("H1"); return T; };
const slug = (actor, target, extra = {}) => ({ op: "declare", actor, decl: { action: "slugfest", targets: [target], ...extra } });
const answerAll = async (T) => { for (let i = 0; i < 12 && T.prompts().length; i++) { const p = T.prompts()[0]; await T.gm({ op: "answerFor", prompt: p.id, value: p.options?.find((o) => o.id === "pass")?.id ?? p.options?.[0]?.id ?? "pass" }); } };

/* ================================================================== Z24 (CU6): the GM's "declare anyway" is its own grant */
{
  const T = base();
  T.setRange("H1", "N1", 2);
  eq(code(await T.gm(slug("H1", "N1"))), "illegal", "Z24: out of reach, refused for the GM too (the panel then offers 'declare anyway')");
  eq(code(await T.gm(slug("H1", "N1", { exception: { text: "GM" } }))), "ok", "Z24: the GM declares anyway");
  eq([T.prompts("exception").length, T.top()?.data.hold ?? null, T.top()?.decl.exception?.state], [0, null, "granted"], "Z24: no second card for the GM; the action runs as a granted exception");
  const U = base(); U.setRange("H1", "N1", 2);
  eq(code(await U.req("p1", slug("H1", "N1", { exception: { text: "I throw a car" } }))), "ok", "Z24: a player's request ...");
  eq(U.prompts("exception").length, 1, "Z24: ... still waits on the GM's card");
}

/* ================================================================== Z26 (P8g-4): nobody can act */
{
  const T = base();
  for (const id of ["H1", "H2", "N1", "N2"]) T.c[id].defeated = true;
  for (let i = 0; i < 4; i++) await T.gm({ op: "nextTurn" });      // the defeated are out of the next round's order
  const r0 = T.state.round, s0 = JSON.stringify(T.state.init);
  const r = await T.gm({ op: "nextTurn" });
  eq([code(r), T.state.round, JSON.stringify(T.state.init) === s0], ["nobodyActs", r0, true], "Z26: next turn with nobody able to act is refused, the round stays");
  eq(code(await T.gm({ op: "nextRound" })), "nobodyActs", "Z26: next round too");
  ok(EN["ITAC.err.nobodyActs"] && PL["ITAC.err.nobodyActs"], "Z26: the refusal has words in both languages");
  ok(/c === "nobodyActs"\) info\(errText/.test(src("combat-class.mjs")), "Z26: the GM is told as a note, not an error");
  const U = base();
  eq(code(await U.gm({ op: "nextTurn" })), "ok", "Z26: a normal next turn still goes");
}

/* ================================================================== Z30 (P6b-14): the label of sending allies away */
{
  ok(/e\?\.effect\?\.kind === "dismiss" \? "\{ITAC\.journal\.dismiss\}"/.test(src("engine-pure.mjs")), "Z30: the dismiss entry is labelled as what it is");
  eq([EN["ITAC.journal.dismiss"], PL["ITAC.journal.dismiss"]], ["Allies sent away", "Odesłanie sojuszników"], "Z30: both languages");
}

/* ================================================================== Z33 (P8e-9): an undone grant takes its card */
{
  const T = base();
  eq(code(await T.gm({ op: "ledgerEdit", combatant: "H1", edit: "grant", grant: { template: "guidance", unit: "quick", from: "H2" } })), "ok", "Z33: H2 guides H1 (an action that needs consent)");
  eq(T.prompts("grantConsent").length, 1, "Z33: H1 is asked");
  const tx = T.log.list[T.log.list.length - 1]?.id;
  eq(code(await T.gm({ op: "undo", tx })), "ok", "Z33: the GM undoes the grant");
  eq(T.prompts("grantConsent").length, 0, "Z33: the card of consent went with it");
}

/* ================================================================== Z27 (P8b-7): an undo's failures on the desk */
{
  const log = J.markUndone({ v: 1, list: [{ id: "x1", state: "closed", ops: [], round: 1, label: { gm: "a" } }] }, "x1", 5, [{ t: "zones", reason: "refused" }, { t: "actor", reason: "gone" }]);
  eq(log.list[0].undoFailed, [{ t: "zones", reason: "refused" }, { t: "actor", reason: "gone" }], "Z27: the journal entry keeps what the undo could not do");
  const T = base();
  await T.req("p1", slug("H1", "N1"));
  await T.answer("gm", "reaction", "pass", "N1"); await T.roll("attack", 1);
  await answerAll(T);
  const hit = [...T.log.list].reverse().find((x) => x.state === "closed" && x.ops.some((o) => o.t === "actor"));
  ok(hit, "Z27: an attack that wrote a sheet is in the journal");
  if (hit) {
    T.failOn = (e) => (e.undo && e.t === "actor" ? "refuse" : null);
    await T.gm({ op: "undo", tx: hit.id });
    const row = T.log.list.find((x) => x.id === hit.id);
    ok(row?.undoFailed?.some((f) => f.t === "actor"), "Z27: the refused sheet write is kept on the undone entry");
    const dm = D.deskModel(T.state, T.log, { c: (id) => ({ name: id }) }), j = dm.journal.find((x) => x.id === hit.id);
    ok(j?.failed?.length, "Z27: the desk model carries it");
    const dd = M.deskData(dm, {}, { staff: true, c: (id) => ({ name: id }), view: T.state }, t);
    const r = dd.journal.flatMap((g) => g.rows).find((x) => x.id === hit.id);
    eq(r?.failed, "Cofnięcie nie odwróciło: wartość na karcie postaci. Popraw to ręcznie.", "Z27: the desk row says it in words");
  }
  ok(/j\.failed \? h\("span\.igd-jf"/.test(src("ui/desk.mjs")) && /\.igd-jf \{/.test(css()), "Z27: the desk draws the line under the row");
}

/* ================================================================== Z39 (CHASE2-12): the chase roll's round comes back with its undo */
{
  const car = (o = {}) => ({ kind: "vehicle", npc: true, health: 8, vehicle: { type: "ground", speed: 3, maneuver: 1, passengers: 3, weapons: 0 }, ...o });
  const T = new Table();
  T.hero("H1", "p1", { name: "Kid" }).npc("N1", { health: 6, name: "Doc" });
  T.add("V1", car({ name: "Car" })); T.add("V2", car({ name: "Van" }));
  T.order(["H1", "N1"]).turn("H1");
  await T.gm({ op: "vehicleSet", vehicle: "V1", seat: { who: "H1", role: "driver" }, started: true });
  await T.gm({ op: "vehicleSet", vehicle: "V2", seat: { who: "N1", role: "driver" }, started: true });
  await T.gm({ op: "chaseStart", prey: ["V2"], pursuer: ["V1"], distance: 2, obstacles: false });
  const run = async () => { await T.gm({ op: "chaseRound" }); await T.roll("prey", 1); await T.roll("pursuer", 1); await answerAll(T); };
  await run();
  const r1 = T.state.round, n0 = T.log.list.length;
  await run();
  eq(T.state.round, r1 + 1, "Z39: the second roll opened the next round");
  const tx = T.log.list.slice(n0).find((x) => x.inst && x.state === "closed");
  ok(tx && tx.ops[0]?.t === "state" && tx.ops[0].patch.some(([p]) => p[0] === "round"), "Z39: the roll's transaction starts with the round it opened");
  eq(code(await T.gm({ op: "undo", tx: tx?.id })), "ok", "Z39: the GM undoes the roll");
  eq(T.state.round, r1, "Z39: the fight is back in the round it was in");
}

/* ================================================================== Z40 (P8d-6): a roll of another number of dice is not taken */
{
  const T = base();
  await T.req("p1", slug("H1", "N1"));
  await T.answer("gm", "reaction", "pass", "N1");
  const rec = T.top().rolls.attack, want = rec.req.dice;
  const feed = (o) => T.handle({ t: "roll", inst: T.top().id, key: "attack", rid: rec.req.rid, author: "p1", sixes: 1, ones: 0, pushed: 0, pushable: false, messageId: "mx", ...o });
  ok(want > 0, "Z40: the engine asked for a number of dice");
  eq(code(await feed({ dice: want + 3, sixes: want + 1 })), "badInput", "Z40: a message with more dice than asked is refused");
  eq(code(await feed({ dice: want, sixes: want + 1 })), "badInput", "Z40: more sixes than dice is refused");
  eq(T.top().rolls.attack.sixes ?? null, null, "Z40: the roll is still owed");
  eq(code(await feed({ dice: want, sixes: 1 })), "ok", "Z40: the asked number of dice is taken");
  ok(/dice = Number\(roll\.size\)/.test(src("system-adapter.mjs")), "Z40: the chat reader passes the number of dice the system rolled");
}

/* ================================================================== Z32 (P8e-7): a helper who joined after the declaration, on the panel */
{
  const T = base();
  await T.req("p1", slug("H1", "N1"));
  eq(code(await T.req("p2", { op: "help", inst: T.top().id, helper: "H2" })), "ok", "Z32: H2 helps after the declaration");
  eq(T.top().data.help, 1, "Z32: the engine keeps the helper's die on the action");
  const v = V.viewFor(T.state, { id: "p1", staff: false, owns: ["H1"] }, { hidden: [], npc: ["N1", "N2"] });
  const pm = D.playerModel(v, { id: "p1", owns: ["H1"] }, { c: (id) => ({ name: id === "H2" ? "Omni" : id }) });
  eq(pm.mine?.[0]?.help, { dice: 1, who: ["Omni"] }, "Z32: the player's model of the declared action carries the help");
  ok(/i\.help\?\.dice \? t\("ITAC\.ui\.mine\.help"/.test(src("ui/model-pure.mjs")), "Z32: the mine panel says it before the roll");
  eq(tIn("pl", "ITAC.ui.mine.help", { names: "Omni", dice: 1 }), "Pomoc: Omni, +[[dice:1]] do rzutu.", "Z32: in words");
}

/* ================================================================== Z34 (P8f-5): "if they resist" from the engine's pool */
{
  const T = base();
  T.c.N1.attrs = { ...(T.c.N1.attrs ?? {}), presence: 2 };
  const pv = await T.gm({ op: "preview", actor: "H1", decl: { action: "banter", targets: ["N1"] } });
  const resist = pv.preview?.def?.resist;
  ok(Number.isFinite(resist), "Z34: the engine's preview of banter names the dice the target resists with");
  eq(code(await T.gm({ op: "declare", actor: "H1", decl: { action: "banter", targets: ["N1"] } })), "ok", "Z34: banter declared");
  for (let i = 0; i < 4 && !T.top()?.rolls?.["def:N1"]; i++) { if (T.top()?.rolls?.roll && T.top().rolls.roll.sixes == null) await T.roll("roll", 1); else await answerAll(T); }
  eq(T.top()?.rolls?.["def:N1"]?.req?.dice, resist, "Z34: the same number the resisting roll then asks for");
  const a = { opposeAttr: "presence" }, facts = { staff: true, c: () => ({ npc: true }), view: { revealed: {} }, attrs: () => ({ presence: 9 }) };
  eq(M.oddsFor(a, 3, "N1", facts, t, null)?.defended ?? null, null, "Z34: without the engine's number no 'if they resist' (the bare attribute is not used)");
  ok(M.oddsFor(a, 3, "N1", facts, t, { resist: 2 })?.defended, "Z34: with it, the chance is there");
}

/* ================================================================== Z35 (P8f-6): a series aimed at two zones says the series' rule [B2543] */
{
  const T = new Table(); T.hero("H1", "p1").hero("H2", "p2").npc("N1", { health: 6 }).npc("N2", { health: 6 }); T.order(["H1", "N1", "H2", "N2"]);
  T.weapons.smg = { id: "smg", bonus: 1, damage: 2, range: [0, 2], sharp: true, fullAuto: true };
  T.c.N2.zone = "z2";
  const r = await T.req("p1", { op: "declare", actor: "H1", decl: { action: "shoot", targets: ["N1", "N2"], weapon: "smg", fullAuto: true } });
  eq([r.error?.params?.reason, r.error?.params?.series], ["notSameZone", 1], "Z35: refused as a rule of the series");
  const FP = await import("./ui/feedback-pure.mjs");
  eq(FP.whyOf(t, "notSameZone", { series: 1 }), { text: "Wszystkie cele serii muszą stać w jednej strefie.", fix: "Odznacz cel z innej strefy." }, "Z35: the panel's words: all targets in one zone, unpick the other");
  eq(FP.whyOf(t, "notSameZone", {}).text, "Cel stoi w innej strefie.", "Z35: a single target in another zone keeps its own words");
  const L = await import("./lang.mjs");
  ok(/serii/.test(L.errText({ code: "illegal", key: "ITAC.err.illegal", params: { reason: "notSameZone", series: 1 } })) || /series/.test(L.errText({ code: "illegal", key: "ITAC.err.illegal", params: { reason: "notSameZone", series: 1 } })), "Z35: the refusal's notice too");
  const pv = await T.req("p1", { op: "preview", actor: "H1", decl: { action: "shoot", targets: ["N1"], weapon: "smg", fullAuto: true }, of: ["N2"] });
  eq([pv.preview?.per?.N2?.reason, pv.preview?.per?.N2?.params?.series], ["notSameZone", 1], "Z35: the map's answer about a candidate in another zone carries it too");
}

/* ================================================================== Z37 (FXF-11): a stunt card made again keeps the ticks still valid */
{
  const carry = typeof M.carryPicks === "function" ? M.carryPicks : (p) => p;
  const opt = (id, disabled = null) => ({ id, disabled });
  const prev = [{ id: "q1", kind: "stunts", inst: "a5", about: "H1", options: [opt("doubleDamage@N1"), opt("stun@N1"), opt("knockback@N1")] }, { id: "q9", kind: "reaction", inst: "a5", about: "N1", options: [opt("pass")] }];
  const now = [{ id: "q2", kind: "stunts", inst: "a5", about: "H1", options: [opt("doubleDamage@N1"), opt("stun@N1", "used"), opt("bangHeads@N1|N3")] }, { id: "q9", kind: "reaction", inst: "a5", about: "N1", options: [opt("pass")] }];
  const out = carry({ q1: ["doubleDamage@N1", "stun@N1", "knockback@N1"], "tk:q1": ["t1"], q9: ["pass"] }, prev, now);
  eq(out, { q2: ["doubleDamage@N1"], "tk:q2": ["t1"], q9: ["pass"] }, "Z37: the new card keeps what it still offers; a disabled or vanished option drops out");
  eq(carry({ q1: ["stun@N1"] }, prev, [{ ...now[0], about: "H2" }]), { q1: ["stun@N1"] }, "Z37: a card about another character takes nothing over");
  const s = src("ui/main.mjs");
  ok(/st\.dock\.picks = Model\.carryPicks\(st\.dock\.picks, dockCardsWere/.test(s) && /st\.desk\.picks = Model\.carryPicks\(st\.desk\.picks, deskCardsWere/.test(s), "Z37: the dock and the desk carry their picks at every drawing");
}

/* ================================================================== Z36 (P8g-6): a surface start that fails half way leaves nothing on */
{
  const s = src("ui/main.mjs"), a = s.indexOf("export function start() {"), b = s.indexOf("\n}\n", a), body = s.slice(a, b);
  ok(/const Hooks = \{ on: \(hk, fn\) => \{ const id = globalThis\.Hooks\.on\(hk, fn\); offs\.push\(\(\) => globalThis\.Hooks\.off\(hk, id\)\)/.test(body), "Z36: inside start() every Hooks.on is start()'s own, which keeps the way to take it off");
  eq([(body.match(/(?<![\w.])on\(/g) ?? []).length, (body.match(/(window|document)\.addEventListener\(/g) ?? []).length], [0, 0], "Z36: no hook or page listener of start() bypasses the kept list");
  ok(/keep\(Store\.subscribe\(schedule\)\)/.test(body) && /keep\(Zones\.onEvent\(moved\)\)/.test(body) && /keep\(\(\) => Mv\.setDragSurface\(null\)\)/.test(body), "Z36: the store, the map's events and the drag surface too");
  ok(/catch \(e\) \{[\s\S]*for \(const off of offs\.reverse\(\)\)[\s\S]*Dock\.destroy\(\)[\s\S]*Desk\.destroy\(\)[\s\S]*started = false;/.test(body), "Z36: a failure takes them off, removes the half-built surfaces and lets a later start() try again");
}

/* ================================================================== Z22 (P9-13): without a map a chip out of reach is marked at once */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Ada" }).hero("H2", "p2", { name: "Rex" }).npc("N1", { name: "Thug", health: 6 }).npc("N3", { name: "Far", health: 6 });
  T.c.N3.zone = "z2"; T.order(["H1", "N1", "H2", "N3"]).turn("H1");
  const meta = { hidden: [], npc: ["N1", "N3"] }, reach = {}, asked = [];
  const view = () => V.viewFor(T.state, { id: "p1", staff: false, owns: ["H1"] }, meta);
  const facts = (v) => ({ view: v, me: "p1", staff: false, c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc, img: null } : null), attrs: () => null, userName: (u) => u, weapons: () => [],
    preview: (cid, decl) => T.preview("p1", cid, decl), board: false, onMap: () => false, reach: (cid, decl, ids) => { asked.push(ids); return reach[`${cid}|${JSON.stringify(decl)}`] ?? null; } });
  const ctx = { c: (id) => T.c[id] ?? null, online: () => true };
  const dock = (own) => { const v = view(); return M.dockData(D.playerModel(v, { id: "p1", owns: ["H1"] }, ctx), own, facts(v), t); };
  let p = dock({ armed: "slugfest" }).panel;
  ok(asked.length > 0, "Z22: without a map the engine is asked about the candidates too");
  reach[`H1|${JSON.stringify({ action: "slugfest" })}`] = (await T.req("p1", { op: "preview", actor: "H1", decl: { action: "slugfest" }, of: p.targets.map((x) => x.id) })).preview?.per ?? null;
  p = dock({ armed: "slugfest" }).panel;
  const n3 = p.targets.find((x) => x.id === "N3"), n1 = p.targets.find((x) => x.id === "N1");
  eq([n1?.reach, n3?.reach, !!n3?.why], ["in", "out", true], "Z22: the chip out of reach is marked before anything is picked, with its reason");
  p = dock({ armed: "slugfest", targets: ["N3"] }).panel;
  eq([!!p.refused, p.submit.req], [true, null], "Z22: picking it shows the reason at once (the way to ask stands there), not a refusal after Declare");
  const dk = src("ui/dock.mjs");
  ok(/x\.reach === "out" \? "\.itd-chip-out" : ""/.test(dk) && /tip: x\.reach === "out" \? x\.why \?\? x\.note : x\.note/.test(dk) && /\.itd-chip-out \{/.test(css()), "Z22: the dock draws it dashed and grey, the reason as its tooltip");
}

/* ================================================================== Z20 (CI4): the GM corrects the route of a forced move (last: the map fake sets Foundry globals) */
{
  const { MTable } = await import("./check-kit-map.mjs");
  const mk = () => { const T = new MTable(); T.hero("H1", "p1", { attrs: { strength: 5 } }).npc("N1", { health: 5 }); T.put("H1", "z2").put("N1", "z3"); T.order(["H1", "N1"]).turn("H1"); return T; };
  const T = mk();
  eq((await T.gm({ op: "forcedMove", combatant: "N1", awayFrom: "H1", distance: 2, damage: 0, kind: "knockback" })).ok, true, "Z20: a forced move is opened");
  const card = T.prompt("direction"), ids = (card?.options ?? []).map((o) => o.id);
  ok(ids.includes("to:z6") && ids.includes("to:z1") && !ids.includes("to:z3") && !ids.includes("to:z4"), "Z20: the GM's card offers the other zones within the distance (not the start, not the chain's own end)");
  eq(ids.slice(-3), ["go", "goFall", "none"], "Z20: the chain's three answers stay");
  const dd = M.deskData(D.deskModel(T.state, T.log, { c: (id) => ({ name: id }) }), {}, { staff: true, c: (id) => ({ name: id }), view: T.state, zone: (s) => ({ id: Number(String(s).slice(1)), level: "ground" }) }, t);
  const pick = dd.cards[0]?.options?.[0];
  eq([pick?.id, pick?.label, (pick?.zones ?? []).map((z) => z.zone).sort()], ["@zone", "Popraw trasę: wskaż strefę", ids.filter((x) => x.startsWith("to:")).map((x) => x.slice(3)).sort()], "Z20: on the desk it is one pick on the map, in Polish");
  const req = pick?.zoneReq?.("z6");
  ok(req, "Z20: a zone clicked on the map answers the card at once");
  eq((await T.gm(req)).ok, true, "Z20: the GM's correction is accepted");
  eq([T.spot("N1"), T.state.stack.length], ["z6", 0], "Z20: the character is thrown along the corrected route");
  const U = mk();
  await U.gm({ op: "forcedMove", combatant: "N1", direction: "up", distance: 1, damage: 0 });
  ok(!(U.prompt("direction")?.options ?? []).some((o) => String(o.id).startsWith("to:")), "Z20: straight up or down has no zones to pick");
}

/* ================================================================== Z21 (W1-9): "may collapse" and "someone holds off" on the zone where the turn ends */
{
  const BP = await import("./ui/board-pure.mjs");
  const fc0 = typeof BP.forecast === "function" ? BP.forecast : () => ({ collapse: [], held: [] });
  /* a real hold off: the slot is marked and still waits */
  const T = base(); T.order(["N1", "H1", "H2", "N2"]).turn("N1");
  eq(code(await T.gm({ op: "holdOff", actor: "N1", with: T.state.init.slots.find((s) => s.members.includes("H2")).id })), "ok", "Z21: N1 holds off (swaps with H2)");
  const slot = T.state.init.slots.find((s) => s.members.includes("N1"));
  eq([!!slot?.heldOff, slot?.state], [true, "waiting"], "Z21: its slot is marked as held off and still to act");
  const where = { N1: "z1", N2: "z2", H1: "z1", C1: "z1", C2: "z3" };
  const facts = (resolve) => ({ c: (id) => (id.startsWith("N") ? { name: `Npc ${id}`, npc: true } : { name: `Hero ${id}`, npc: false }), where: (id) => where[id],
    special: () => [{ id: "C1", kind: "challenge", name: "Doomsday", resolve, health: 6, timeUnit: "rounds" }, { id: "C2", kind: "challenge", name: "Storm", resolve: 1, health: 8, timeUnit: "rounds" }] });
  const view = { init: T.state.init, challenges: { C1: { effects: [{ when: "onFail", kind: "blast" }] }, C2: { effects: [{ when: "onFail", kind: "bystandersDie" }] } } };
  const Z = { within: () => [] };
  eq(fc0(view, facts(1), "H1", "z1", Z), { collapse: [{ name: "Doomsday", what: "blast" }], held: ["Npc N1"] }, "Z21: in z1 the challenge's end hits and the held-off opponent stands");
  eq(fc0(view, facts(2), "H1", "z1", Z).collapse, [], "Z21: a challenge with more than this round left forecasts nothing");
  eq(fc0(view, facts(1), "H1", "z2", Z), { collapse: [], held: [] }, "Z21: another zone: nothing");
  eq(fc0(view, facts(1), "N2", "z1", Z).held, [], "Z21: one's own side holding off is no threat");
  const w = BP.endWarnings({ list: [], burning: {}, spread: {} }, "z1", {}, Z, t, fc0(view, facts(1), "H1", "z1", Z));
  eq(w.map((x) => x.text), ["Może się zawalić", "Ktoś się wstrzymał"], "Z21: the two chips, in Polish");
  ok(/Doomsday/.test(w[0]?.tip ?? "") && /wybuch/.test(w[0]?.tip ?? "") && /Npc N1/.test(w[1]?.tip ?? ""), "Z21: the tooltips name the challenge, what it does, and who holds off");
  const b = src("ui/board.mjs");
  ok(/BP\.endWarnings\([^\n]*BP\.forecast\(last\.view, last\.facts, who, spot/.test(b) && /BP\.zoneHazards\([^\n]*BP\.forecast\(/.test(b), "Z21: the board hands the forecast to the end-of-turn zone and to the move preview");
}

/* ================================================================== items found already done or not a defect: pinned as they stand */
{
  /* Z25 (FXP-7): "End turn" pressed while the 3D dice fly shows a held state (FXS 9d633fc) */
  const dk = src("ui/dock.mjs"), cs = css();
  ok(/classList\.toggle\("itd-end-held", on\)/.test(dk) && /setAttribute\("aria-busy", "true"\)/.test(dk) && /\.itd-end-held/.test(cs), "Z25: the end-turn button shows it is held while the dice land (class + aria-busy + style)");
  /* Z28 (U11-5 / U11-R4): an inverse that carries the map's own strokes (fireLayer) goes back as the map gave it (U81) */
  const zs = src("zones-pure.mjs");
  ok(/if \(isObj\(inverse\) && isObj\(inverse\.fireLayer\)\) return inverse;/.test(zs), "Z28: an extinguish undo puts back the exact strokes when the map hands them out");
  /* Z29 (U8-5): the GM's nudge plays the existing "the table waits" sound */
  const FP = await import("./ui/feedback-pure.mjs");
  const c1 = FP.cues({ turn: [], asks: [] }, { turn: [], asks: ["n:42"] });
  eq(c1.cue, "wait", "Z29: a nudge on the news line is a new thing to answer: the 'wait' sound plays");
  ok(/data\?\.news\?\.kind === "nudge" \? \[`n:\$\{data\.news\.id\}`\]/.test(src("ui/feedback.mjs")), "Z29: the nudge is fed to the cues");
  /* Z31 (P8e-3): the bar says "busy" exactly where the engine refuses as busy (U77) */
  {
    const P1 = await import("./economy-pure.mjs"), Lg = await import("./ledger-pure.mjs");
    const ctx = (T) => ({ c: (id) => T.c[id] ?? null, online: () => true, P1 });
    const meta = (T) => ({ hidden: [], npc: Object.values(T.c).filter((c) => c.npc).map((c) => c.id) });
    const mk = () => { const T = new Table(); T.hero("H1", "p1").hero("H2", "p2").npc("N1", { health: 6 }); T.order(["H1", "N1", "H2"]);
      T.state.ledger.H2 = Lg.addGrant(P1.ledgerOf(T.state, "H2"), Lg.grantTemplate("quickness"), "H2").ledger; return T; };
    const T0 = mk(); await T0.req("p1", slug("H1", "N1"));
    const bar = D.barModel(V.viewFor(T0.state, { id: "p2", staff: false, owns: ["H2"] }, meta(T0)), "H2", ctx(T0));
    const off = [];
    for (const a of bar.actions) {
      const T = mk(); await T.req("p1", slug("H1", "N1"));
      const env = await T.req("p2", { op: "declare", actor: "H2", decl: { action: a.id, targets: a.needsTarget ? ["N1"] : [] } });
      if ((a.disabled === "busy") !== (env?.error?.code === "busy")) off.push(a.id);
    }
    eq(off, [], "Z31: under an open action the bar and the engine agree on every action that waits (busy)");
  }
  /* Z42 (U4-7): the fight says "Prezencja", never "Charyzma" */
  const Terms = await import("../i18n/terms.mjs");
  const plStrings = Object.entries(PL).filter(([, v]) => typeof v === "string" && /charyzm/i.test(v)).map(([k]) => k);
  eq([Terms.TERMS.pl.presence, plStrings], ["Prezencja", []], "Z42: the Polish attribute is Prezencja; no tactical string says Charyzma");
  /* Z57: the stale [A36] comment about forced moves by hand is gone; Z58: the unused language keys are gone */
  const mp = src("ui/model-pure.mjs");
  ok(!/until a charge is the engine's, the GM orders a forced move/.test(mp) && /a Slam along a charge's path is the engine's own \(\[A36\], P4-1, P4-2\)/.test(mp), "Z57: the comment says what the code does now");
  eq(["ITAC.ui.mine.you", "ITAC.ui.turn.yours", "ITAC.ui.turn.of", "ITAC.ui.turn.round"].filter((k) => k in EN || k in PL), [], "Z58: the unused keys are removed from both languages");
}

done("check-fxv");
