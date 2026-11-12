/* node scripts/tactics/check-fxu.mjs -- FIXER U (after the live verifier ver12, tree tactics, tag tactics-integrated-59). One block per row;
   each fails on the code before its fix (tactics 793fe37) and pins the fix. Fights run through the REAL director, engine and view
   (testkit Table); placement runs through the pure frame and layout modules; what only Foundry runs is pinned by reading its source.
     D188  the chase panel on a player's seat at 1366 px centred under the map's "Pinezki" aside (and the challenges)
     D189  a vehicle's combatant deleted mid-fight: its record and the driver's "in a vehicle" stay
     D190  the obstacle table off, the GM's round box still says "Obstacle, then both sides roll AGILITY"
     D191  after the GM changed the chase (who is in it, the distance) the panel still reads the last round as the chase of now
     D192  after the chase ended, the players' news line still says "Chase round: the chase goes on"
     U193  a popped-out chat just left of the middle put the band (and the first-fight hint) in the sliver beside the challenges
     U194  1024 px with the sidebar open: the challenges' column over the initiative bar, the line cut to "THE..."
     U195  the GM's own roll waits on the desk's Now tab while the desk stays on the Scene tab */
import { readFileSync } from "node:fs";
import { Table, ok, eq, done } from "./testkit.mjs";
import * as V from "./view-pure.mjs";
import * as D from "./desk-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./ui/model-pure.mjs";
import * as CP from "./ui/chase-pure.mjs";
import * as Veh from "./flows/vehicle.mjs";
import * as SP from "./ui/slots-pure.mjs";
import * as Lay from "./ui/layout-pure.mjs";
import { tIn } from "./lang.mjs";

const here = new URL(".", import.meta.url);
const src = (p) => readFileSync(new URL(p, here), "utf8");
const t = (k, p = {}, f) => tIn("pl", k, p, f);
const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const soft = (mod, n) => (typeof mod[n] === "function" ? mod[n] : () => undefined);      // a helper the fix added: the old tree FAILS, it does not stop
const meta = (T) => ({ hidden: Object.keys(T.c).filter((id) => T.c[id].hidden), npc: Object.keys(T.c).filter((id) => T.c[id].npc) });
const view = (T, me, owns) => (me === "gm" ? T.state : V.viewFor(T.state, { id: me, staff: false, owns }, meta(T)));
const facts = (T, v, me) => ({ view: v, staff: me === "gm", me, whole: me === "gm" ? (id) => T.c[id] ?? null : undefined,
  c: (id) => (T.c[id] ? { name: T.c[id].name ?? id, npc: !!T.c[id].npc, kind: T.c[id].kind ?? null, img: null, way: T.c[id].kind === "vehicle" ? null : CP.wayOf(T.c[id]) } : null),
  userName: (u) => `User ${u}`, online: () => true, rollBusy: () => false, preview: () => null });
const panel = (T, me, owns = [], own = {}) => CP.chaseData(view(T, me, owns), own, facts(T, view(T, me, owns), me), t);
const car = (o = {}) => ({ kind: "vehicle", npc: true, health: 8, vehicle: { type: "ground", speed: 3, maneuver: 1, passengers: 3, weapons: 0 }, ...o });
const answerAll = async (T) => { for (const p of T.prompts()) await T.gm({ op: "answerFor", prompt: p.id, value: "pass" }); };

/* ================================================================== D188: the chase panel keeps clear of the Pinezki aside and the challenges */
{
  /* the player's seat of the verifier's shot 17 (1366 x 768): Pinezki at the left to x 320, the challenges from x 1000, initiative bar 410..940 */
  const bar = { lo: 220, hi: 990, top: 650, bottom: 760 };
  const fr = SP.frame({ W: 1366, H: 768, k: 1, staff: false, hints: false, top0: 112, topCx: 675, topL: 328, side: 1320, hud: { present: true, x0: 1000 }, desk: null, bar });
  eq(fr.across, { lo: 328, hi: 990 }, "D188: the frame says the top band's free stretch (right of the map's panels, left of the challenges)");
  const cx = (fr.slots.cards.x0 + fr.slots.cards.x1) / 2, span = soft(Lay, "chaseSpan")(cx, 760, Math.max(fr.across?.lo ?? 12, 180), fr.across?.hi ?? 1354) ?? { x0: cx - 380, x1: cx + 380 };
  ok(span.x0 >= 328 && span.x1 <= 990, `D188: the panel stands right of the Pinezki aside and left of the challenges (got ${span.x0}..${span.x1})`);
  eq(soft(Lay, "chaseSpan")(960, 760, 328, 1545), { x0: 580, x1: 1340 }, "D188: with room (1920 px) the panel stays centred under the bar, 760 px wide, as before");
  eq(soft(Lay, "chaseSpan")(400, 760, 328, 1545), { x0: 328, x1: 1088 }, "D188: centred too far left it slides right only as far as it must");
  eq(soft(Lay, "chaseSpan")(600, 760, 328, 500), { x0: 328, x1: 608 }, "D188: a room under the least width keeps the least from its left end");
  const ch = src("./ui/chase.mjs");
  ok(/Lay\.chaseSpan\(/.test(ch) && /f\?\.across\?\.lo/.test(ch) && /f\?\.across\?\.hi/.test(ch), "D188: the panel's place reads the band's stretch on every seat, not only beside the GM's desk");
  ok(!/if \(x1 - x0 < want - 1\)/.test(ch), "D188: the old rule (look left only when the panel was squeezed by the desk) is gone");
}

/* ================================================================== D189: a vehicle that leaves the fight */
{
  const T = new Table();
  T.hero("H1", "p1", { name: "Kid" }).hero("H2", "p2", { name: "Omni" }).npc("N1", { name: "Doc" }); T.add("V1", car({ name: "Van" }));
  T.order(["H1", "N1", "H2"]).turn("H1");
  await T.gm({ op: "vehicleSet", vehicle: "V1", seat: { who: "H1", role: "driver" }, started: true });
  await T.gm({ op: "vehicleSet", vehicle: "V1", seat: { who: "H2", role: "passenger" } });
  const inV = (id) => (T.state.statuses?.[id] ?? []).some((s) => s.id === "inVehicle");
  eq([!!T.state.vehicles?.V1, inV("H1"), inV("H2")], [true, true, true], "D189: (the van with Kid at the wheel and Omni aboard)");
  delete T.c.V1; const env = await T.gm({ op: "roster" });
  eq(code(env), "ok", "D189: (the roster after the van's combatant is deleted)");
  eq([T.state.vehicles?.V1 ?? null, inV("H1"), inV("H2")], [null, false, false], "D189: the van's record goes and nobody is in it any more");
  ok(T.events.some((e) => e.type === "status" && e.target === "H1" && e.status?.id === "inVehicle" && e.status.on === false), "D189: the driver's mark coming off is an event (the surfaces and the journal hear it)");
  eq(Veh.rideOf(T.state, "H1"), null, "D189: Kid rides nothing (no 'get out first' on his move)");
}
{
  /* a passenger who leaves frees the seat; the van stays */
  const T = new Table();
  T.hero("H1", "p1", { name: "Kid" }).hero("H2", "p2", { name: "Omni" }).npc("N1", { name: "Doc" }); T.add("V1", car({ name: "Van" }));
  T.order(["H1", "N1", "H2"]).turn("H1");
  await T.gm({ op: "vehicleSet", vehicle: "V1", seat: { who: "H1", role: "driver" } });
  await T.gm({ op: "vehicleSet", vehicle: "V1", seat: { who: "H2", role: "passenger" } });
  delete T.c.H2; await T.gm({ op: "roster" });
  eq([T.state.vehicles?.V1?.driver, T.state.vehicles?.V1?.crew], ["H1", []], "D189: a passenger who leaves the fight frees the seat; the driver stays at the wheel");
}

/* ================================================================== D190: no obstacle table, no "Obstacle" in the GM's round box */
{
  const T = new Table();
  T.hero("H1", "p1", { name: "Kid" }).npc("N1", { name: "Mauler" }); T.order(["H1", "N1"]).turn("H1");
  eq(code(await T.gm({ op: "chaseStart", prey: ["N1"], pursuer: ["H1"], distance: 3 })), "ok", "D190: (a chase without the obstacle table)");
  eq(panel(T, "gm").decision?.text, "Obie strony rzucają na ZWINNOŚĆ.", "D190: the table off: the round box says only that both sides roll");
  eq(panel(T, "gm", [], { obstacle: "shortcut" }).decision?.text, tIn("pl", "ITAC.chase.gm.rollText"), "D190: an obstacle the GM named for the next roll: it is said");
  await T.gm({ op: "chaseSet", obstacles: true });
  eq(panel(T, "gm").decision?.text, tIn("pl", "ITAC.chase.gm.rollText"), "D190: the table on: the obstacle is said, as before");
  eq(tIn("en", "ITAC.chase.gm.rollTextPlain"), "Both sides roll AGILITY.", "D190: the English text");
}

/* ================================================================== D191: the last round is history once the GM changed the chase */
{
  const T = new Table();
  T.hero("H1", "p1", { name: "Kid" }).npc("N1", { name: "Mauler A" }).npc("N2", { name: "Soldier" }); T.order(["H1", "N1", "N2"]).turn("H1");
  await T.gm({ op: "chaseStart", prey: ["N1"], pursuer: ["H1"], distance: 1 });
  eq(code(await T.gm({ op: "chaseRound" })), "ok", "D191: (the round)");
  await T.roll("prey", 0); await T.roll("pursuer", 1);
  await answerAll(T);
  const a = panel(T, "p1", ["H1"]);
  eq([a.phase, a.distance.value, a.result?.caught, !!a.catch], ["after", 0, true, true], "D191: (caught at 0: the panel reads the round as the chase of now)");
  eq(a.sides[1].rolls.text.includes("Mauler A"), true, "D191: (the one who rolled for the prey is named)");
  await T.gm({ op: "chaseSet", unit: "N2", side: "prey" });
  await T.gm({ op: "chaseSet", distance: 3 });
  const p = panel(T, "p1", ["H1"]), g = panel(T, "gm");
  eq([p.result, p.catch, p.distance.value], [null, null, 3], "D191: after the GM's changes the heading over the distance is no longer the round's 'Caught', nor the catch line");
  ok(p.sides[1].rolls.why !== tIn("pl", "ITAC.chase.why.only"), `D191: the prey side of two is not told 'the only one moving' any more (got ${p.sides[1].rolls.why})`);
  ok(g.sides[1].rolls.why !== tIn("pl", "ITAC.chase.why.only"), `D191: nor the GM (got ${g.sides[1].rolls.why})`);
  eq(p.beats.find((b) => b.id === "result")?.text, tIn("pl", "ITAC.chase.res.caught"), "D191: the result beat keeps what the round came to (history), without the stale distances");
  eq(T.state.chase.last?.edited, 1, "D191: the record says it was edited after the round");
}
{
  /* a GM change that is not about who or how far (the table toggle) leaves the record as the chase of now */
  const T = new Table();
  T.hero("H1", "p1", { name: "Kid" }).npc("N1", { name: "Mauler A" }); T.order(["H1", "N1"]).turn("H1");
  await T.gm({ op: "chaseStart", prey: ["N1"], pursuer: ["H1"], distance: 2 });
  await T.gm({ op: "chaseRound" }); await T.roll("prey", 0); await T.roll("pursuer", 1); await answerAll(T);
  await T.gm({ op: "chaseSet", obstacles: true });
  const p = panel(T, "p1", ["H1"]);
  eq([!!p.result, T.state.chase.last?.edited ?? null], [true, null], "D191: the obstacle table switched on: the round's result still stands");
}

/* ================================================================== D192: the chase round's line goes with the chase */
{
  const T = new Table();
  T.hero("H1", "p1", { name: "Kid" }).npc("N1", { name: "Mauler A" }); T.order(["H1", "N1"]).turn("H1");
  await T.gm({ op: "chaseStart", prey: ["N1"], pursuer: ["H1"], distance: 2 });
  await T.gm({ op: "chaseRound" }); await T.roll("prey", 1); await T.roll("pursuer", 1); await answerAll(T);
  const nf = (v) => ({ view: v, staff: false, me: "p1", c: (id) => (T.c[id] ? { name: T.c[id].name } : null) });
  const on = view(T, "p1", ["H1"]), during = M.newsData(on, {}, nf(on), t);
  ok(/pościg/i.test(during?.text ?? ""), `D192: (while the chase runs the round's line is there for the panel to trim: ${during?.text})`);
  eq(code(await T.gm({ op: "chaseEnd", outcome: "combat" })), "ok", "D192: (the GM ends the chase: to combat)");
  const v = view(T, "p1", ["H1"]), after = M.newsData(v, {}, nf(v), t);
  ok(!/pościg trwa/i.test(after?.text ?? ""), `D192: after the chase the players' line no longer says 'Chase round: the chase goes on' (got ${after?.text ?? null})`);
  ok(!(after?.older ?? []).some((x) => /pościg trwa/i.test(x)), "D192: nor among the older lines");
}

/* ================================================================== U193: the band keeps to the wider side of a popped-out chat */
{
  /* the verifier's shot 44 (1920 x 1080): Pinezki to 320, the chat popped out at 810..1105, the challenges from 1555, the sidebar from 1870 */
  const bar = { lo: 230, hi: 1600, top: 960, bottom: 1070 };
  const fl = { left: 810, right: 1105 }, base = { W: 1920, H: 1080, k: 1, staff: false, hints: true, top0: 118, topCx: 805, side: 1870, hud: { present: true, x0: 1555 }, desk: null, bar };
  const fr = SP.frame({ ...base, topL: 328, floats: [fl] });
  const meets = (s) => !!s && s.x0 < fl.right && fl.left < s.x1;
  ok(!meets(fr.slots.hint) && !meets(fr.slots.line) && !meets(fr.slots.cards), `D/U193: the line, the questions and the hint keep clear of the chat (hint ${JSON.stringify(fr.slots.hint)})`);
  ok(fr.slots.hint && fr.slots.hint.x1 - fr.slots.hint.x0 >= SP.SIZE.card, `U193: the hint keeps at least a card's width (got ${fr.slots.hint ? fr.slots.hint.x1 - fr.slots.hint.x0 : 0})`);
  eq(soft(Lay, "bandBeside")(328, 1545, fl), { lo: 328, hi: 800 }, "U193: the wider side of the chat is its left (472 px against 430 px)");
  eq(soft(Lay, "bandBeside")(328, 1545, { left: 600, right: 900 }), { lo: 910, hi: 1545 }, "U193: a chat further left leaves the right side, the wider one");
  const dk = src("./ui/dock.mjs");
  ok(!/\(r\.left \+ r\.right\) \/ 2 > W \/ 2\) topR/.test(dk) && /floats\.push/.test(dk) && /topL, topR, floats/.test(dk), "U193: the dock hands the floating windows to the frame instead of choosing a side by their middle");
  /* the chat at the right edge (the usual popout) changes nothing */
  const fr2 = SP.frame({ ...base, topL: 328, floats: [{ left: 1300, right: 1600 }] }), fr0 = SP.frame({ ...base, topL: 328, topR: 1300 });
  eq([fr2.slots.line, fr2.slots.hint], [fr0.slots.line, fr0.slots.hint], "U193: a chat popped out at the right keeps the band as before");
}

/* ================================================================== U194: the challenges fold where the middle has no room */
{
  const sq = soft(Lay, "hudSqueezed");
  eq(sq(328, 668, 250, 340), true, "U194: 1024 px, sidebar open (middle 328..668): the open column leaves no room for the line: it folds");
  eq(sq(328, 1054, 250, 340), false, "U194: 1366 px, sidebar open: room enough, it stays open");
  eq(sq(328, 968, 250, 340), false, "U194: 1024 px, sidebar folded: it stays open");
  eq(sq(12, 1858, 310, 340), false, "U194: 1920 px: it stays open");
  eq(sq(328, 668, 0, 340), false, "U194: no column, nothing to fold");
  const dk = src("./ui/dock.mjs"), mn = src("./ui/main.mjs"), hud = src("../challenges/hud.mjs"), chm = src("../challenges/main.mjs");
  ok(/Lay\.hudSqueezed\(topL, (?:side|hudSide) - 12, hudOpenW, SP\.SIZE\.card \* k\)/.test(dk) && /handlers\.ichSqueeze\?\.\(squeeze\)/.test(dk), "U194: the dock decides it from the band's stretch and tells the challenges (FXX: the stretch beside the challenges' own height, check-fxx.mjs)");
  const he = soft(Lay, "hudEdge");
  eq([he(true, false, 700), he(false, false, 700), he(false, true, 425), he(false, false, null)], [null, 700, null, null], "U194: a folded column keeps nothing of the band; an open one keeps its edge");
  ok(/x0: Lay\.hudEdge\(hudFolded, squeezed, hudR\?\.left \?\? null\)/.test(dk), "U194: the dock takes the column's edge from hudEdge");
  /* live 1024 px, Pinezki open, the squeezed column peeked open: the hint card kept a ~80 px column (one word per line) */
  const peekBase = { W: 1024, H: 768, k: 1, staff: false, hints: true, top0: 118, topCx: 512, side: 728, topL: 328, desk: null, bar: { lo: 240, hi: 660, top: 625, bottom: 760 } };
  const fp = SP.frame({ ...peekBase, hud: { present: true, x0: he(false, true, 425) } }), hw = fp.slots.hint ? fp.slots.hint.x1 - fp.slots.hint.x0 : 0;
  ok(hw >= 300, `U194: a column peeked open while squeezed leaves the hint card its width (got ${hw})`);
  ok(/ipu:ich-squeeze/.test(mn) && /ipu:ich-squeeze/.test(chm) && /HUD\.setSqueezed/.test(chm), "U194: the word goes to the challenges HUD");
  ok(/export function setSqueezed/.test(hud) && /const folded = \(\) => \(squeezed \? !peek : collapsed\)/.test(hud) && /if \(squeezed\) \{ peek = !peek; drawFold\(\); return; \}/.test(hud), "U194: the HUD folds while squeezed without touching the user's own setting; its handle still opens it");
}

/* ================================================================== U195: a roll asked of the GM brings the desk's Now tab */
{
  const T = new Table();
  T.hero("H1", "p1", { name: "Kid" }).npc("N1", { name: "Soldier" }); T.weapons.gun = { id: "gun", name: "gun", bonus: 1, damage: 3, range: [0, 3], sharp: false };
  T.order(["N1", "H1"]).turn("N1");
  eq(code(await T.gm({ op: "declare", actor: "N1", decl: { action: "shoot", targets: ["H1"], weapon: "gun" } })), "ok", "U195: (the GM declares the NPC's shot)");
  await answerAll(T);
  const ctx = { c: (id) => T.c[id] ?? null, online: () => true, P1 };
  const desk0 = D.deskModel(T.state, T.log, ctx), due0 = soft(M, "deskDue")(desk0) ?? (desk0.cards ?? []).map((c) => c.id);
  ok(due0.some((id) => /^roll:/.test(id)), `U195: the NPC's dice owed by the GM count as waiting on the GM's hand (got ${JSON.stringify(due0)})`);
  await T.roll("attack", 2, { pushable: true });
  const desk1 = D.deskModel(T.state, T.log, ctx), due1 = soft(M, "deskDue")(desk1) ?? (desk1.cards ?? []).map((c) => c.id);
  ok(M.freshCards(due0, due1), "U195: 'You: accept or push' is new: the Now tab comes forward");
  eq(M.freshCards(due1, due1), false, "U195: the same roll still waiting brings nothing (the GM may stay on another tab)");
  const mn = src("./ui/main.mjs");
  ok(/const ids = Model\.deskDue\(desk\), fresh = Model\.freshCards\(cardsWere, ids\)/.test(mn), "U195: the desk's tab follows what waits on the GM, not its cards alone");
  /* a chase round's rolls are the chase panel's */
  eq(soft(M, "deskDue")({ cards: [], info: [{ inst: "i1", flow: "chase", rolls: [{ key: "prey", state: "owed", users: ["gm"] }] }, { inst: "i2", parent: "i1", flow: "attack", rolls: [{ key: "attack", state: "push", users: ["gm"] }] }] }), [], "U195: a chase round's rolls stay on the chase panel");
  eq(soft(M, "deskDue")({ cards: [], info: [{ inst: "i3", flow: "attack", rolls: [{ key: "attack", state: "owed", users: ["p1"] }] }] }), [], "U195: a player's roll is not the GM's");
}

done("check-fxu");
