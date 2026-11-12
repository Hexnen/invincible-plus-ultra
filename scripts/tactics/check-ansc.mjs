/* node scripts/tactics/check-ansc.mjs -- ANSC: EVERYTHING WAITS FOR THE 3D DICE (the user 2026-11-12 on U10-9 + UXB-7 + FXJ-3 + SEAM-1:
   «Wszystko czeka, także liczby nad żetonem»). The card, the news line, the own roll rows, the camera's result shot, the auto end and
   an End turn pressed already waited for the dice on this client (D128, FXN, FXJ, SEAM, FXP); every other place that showed a result
   before the dice stopped waits now the same way, at most HOLD_MS, and with 3D dice off or absent nothing waits.
     A  the gate: when the dice hold (diceHolds), and the Foundry side (ui/dicegate.mjs) with Dice So Nice faked: absent, off, rolling,
        stuck past HOLD_MS
     B  U10-9: the numbers over the tokens wait (ui/feedback.mjs flush), the events heard meanwhile join the batch
     C  FXJ-3: the camera's quiet cue of a result (no staged shot) waits too
     D  a roll asked while dice roll is thrown once they landed (relay onRoll, the executor's own sendRoll)
     E  the dock: a new roll row this seat has to throw, and the new "waiting for" pieces, wait; the sound of a new question comes with it
     F  the GM desk: dice, hit or miss, step and text of the rows in progress, the journal, the unit panel, the scene tab, the NPC note;
        a new card does not bring the Now tab forward before it shows
     G  the initiative bar (Health, Resolve, defeated) and the challenges HUD (rating, time; its camera beat), in a tactical fight only
     H  the map's state marks and the chase panel
     I  through the REAL director and view: an attack that puts the target down, seen by the GM and by the target's player
   Pure checks of ui/wait-pure.mjs, a faked Foundry for ui/dicegate.mjs, and the wiring read from the sources. */
import { readFileSync } from "node:fs";
import { Table, ok, eq, done } from "./testkit.mjs";
import * as V from "./view-pure.mjs";
import * as D from "./desk-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./ui/model-pure.mjs";
import * as N from "./ui/news-pure.mjs";
import * as W from "./ui/wait-pure.mjs";
import * as FP from "./ui/feedback-pure.mjs";
import { tIn } from "./lang.mjs";

const src = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r/g, "");
const tr = (l) => (k, p = {}, f) => tIn(l, k, p, f);
const H = W.HOLD_MS;

/* ================================================================== A: the gate */
{
  eq(H, N.HOLD_MS, "A: one HOLD_MS for every surface (news-pure's, 9 s)");
  eq(W.diceHolds(false, null, 5000), { on: false, since: null }, "A: no dice in the air: nothing holds");
  eq(W.diceHolds(false, 1000, 5000), { on: false, since: null }, "A: the dice landed: the clock is let go");
  eq(W.diceHolds(true, null, 5000), { on: true, since: 5000 }, "A: dice first seen rolling: they hold, from now");
  eq(W.diceHolds(true, 5000, 5000 + H), { on: true, since: 5000 }, "A: at HOLD_MS they still hold");
  eq(W.diceHolds(true, 5000, 5001 + H), { on: false, since: 5000 }, "A: past HOLD_MS a stuck flag holds nothing");
}
/* the Foundry side, Dice So Nice faked */
{
  const msgs = [];
  const waits = new Map();
  const setGame = (dice) => { globalThis.game = { messages: { contents: msgs }, ...(dice ? { dice3d: { waitFor3DAnimationByMessageID: (id) => new Promise((r) => waits.set(id, r)) } } : {}) }; };
  const G = await import("./ui/dicegate.mjs");
  /* absent */
  globalThis.game = undefined;
  let n = 0;
  eq(G.busy(), false, "A: no game: not busy");
  eq(G.after(() => n++), false, "A: no game: nothing waits"); eq(n, 1, "A: ... and the thing runs at once");
  setGame(false); msgs.push({ id: "m1", _dice3danimating: true });
  eq(G.on(), false, "A: Dice So Nice absent (no dice3d): nothing holds even with a marked message");
  eq(G.after(() => n++), false, "A: ... after() runs at once"); eq(n, 2, "A: ... ran");
  /* on, but nothing rolling (3D dice off on this client: Dice So Nice never marks the message) */
  msgs.length = 0; msgs.push({ id: "m2" }); setGame(true);
  eq(G.on(), false, "A: 3D dice off on this client (no mark): nothing holds");
  eq(G.after(() => n++), false, "A: ... after() runs at once"); eq(n, 3, "A: ... ran");
  /* rolling */
  msgs.push({ id: "m3", _dice3danimating: true });
  eq(G.busy(), true, "A: a marked message: busy");
  eq(G.on(), true, "A: ... the dice hold");
  let ran = 0;
  eq(G.after(() => ran++), true, "A: after() waits while they roll");
  eq(ran, 0, "A: ... nothing ran yet");
  const p = G.landed();
  ok(p === G.landed(), "A: one landing promise while it waits");
  msgs[msgs.length - 1]._dice3danimating = false; waits.get("m3")?.();
  await p; await new Promise((r) => setTimeout(r, 60));
  eq(ran, 1, "A: landed: the thing ran once");
  eq(G.state().since, null, "A: landed and nothing else rolls: the clock is let go");
  /* stuck past HOLD_MS */
  msgs.push({ id: "m4", _dice3danimating: true });
  eq(G.on(Date.now()), true, "A: a new roll holds");
  eq(G.on(Date.now() + H + 1), false, "A: the same flag past HOLD_MS: it holds nothing (a stuck flag never keeps anything)");
  globalThis.game = undefined;
  const gs = src("./ui/dicegate.mjs");
  ok(/_dice3danimating/.test(gs) && /waitFor3DAnimationByMessageID/.test(gs) && /W\.HOLD_MS \+ 100/.test(gs), "A: the gate reads Dice So Nice's own mark and wait, bounded");
}

/* ================================================================== B: U10-9 the numbers over the tokens */
{
  const fb = src("./ui/feedback.mjs");
  const gate = fb.indexOf("if (Gate.on()) { Gate.after(() => flush(combatId)); return; }"), take = fb.indexOf("const list = pending[combatId] ?? []; pending[combatId] = null;");
  ok(gate > 0 && take > gate, "B: flush asks the gate BEFORE it takes the batch (the events heard meanwhile join it)");
  ok(fb.indexOf("createScrollingText") > take, "B: the scrolling text is made after the gate");
  ok(/import \* as Gate from "\.\/dicegate\.mjs";/.test(fb), "B: feedback.mjs uses the dice gate");
  ok(/if \(!pending\[ev\.combat\]\) \{ pending\[ev\.combat\] = \[\]; setTimeout\(\(\) => flush\(ev\.combat\), 120\); \}/.test(fb), "B: while a batch waits no second flush is started (the batch stays open)");
}

/* ================================================================== C: FXJ-3 the camera's quiet cue */
{
  const cam = src("./ui/camera.mjs");
  ok(/if \(isResultEvent\(ev\) && Gate\.on\(\)\) \{ Gate\.after\(/.test(cam), "C: a result's quiet cue waits for the dice");
  ok(cam.indexOf("if (s && Zones.hasShot()) { queueShot(ev, s, c, combat); return; }") < cam.indexOf("if (isResultEvent(ev) && Gate.on())"), "C: the staged shot keeps its own wait (FXJ: queueShot / diceSettled), in order");
  ok(/function cueNow\(ev, s, c, combat\) \{\n  try \{/.test(cam), "C: the cue itself is one function, run now or after the dice");
  for (const t of ["outcome", "damage", "broken", "forcedMove"]) ok(W.isResultEvent({ type: t }), `C: ${t} is a result`);
  for (const t of ["actionDeclared", "actionClosed", "move"]) ok(!W.isResultEvent({ type: t }), `C: ${t} is no result (it never waits)`);
}

/* ================================================================== D: a roll asked while dice roll */
{
  const rl = src("./relay.mjs"), en = src("./engine.mjs");
  ok(/Gate\.after\(\(\) => Sys\.rollNow\(req, \(s\) =>/.test(rl), "D: a player's requested roll is thrown once the dice in the air have landed");
  ok(/if \(mine\) Gate\.after\(\(\) => Sys\.rollNow\(req, labelOf/.test(en), "D: the executor's own requested roll (an NPC's, an absent player's) too");
  ok(!/\n  Sys\.rollNow\(req,/.test(rl), "D: no throw left outside the gate in the relay");
}

/* ================================================================== E: the dock */
{
  /* new roll rows */
  const row = (id, state) => ({ id, state, text: `${id} ${state}` });
  let d = { show: true, rolls: [row("i1:attack", "owed")] };
  let r = W.holdNewRolls(null, d, true);
  eq(d.rolls.length, 1, "E: the first look shows what there is (nothing to compare with)");
  d = { show: true, rolls: [row("i1:attack", "push"), row("i2:injury", "owed")] };
  r = W.holdNewRolls(r.memo, d, true);
  eq(d.rolls.map((x) => x.id), ["i1:attack"], "E: while the dice roll a NEW roll row to throw (the injury) waits");
  eq(r.hidden, ["i2:injury"], "E: ... and says which");
  eq(r.held, true, "E: ... held");
  d = { show: true, rolls: [row("i1:attack", "done"), row("i3:defence", "rolling")] };
  W.holdNewRolls(r.memo, d, true);
  eq(d.rolls.map((x) => x.id), ["i1:attack", "i3:defence"], "E: a new row that reads 'rolling' (its own dice in the air) shows (FXN keeps it)");
  d = { show: true, rolls: [row("i1:attack", "push"), row("i2:injury", "owed")] };
  r = W.holdNewRolls(r.memo, d, false);
  eq(d.rolls.length, 2, "E: landed: the new row shows");
  d = { show: true, rolls: [], panel: { kind: "mine", rolls: [row("i9:attack", "owed")] } };
  W.holdNewRolls(r.memo, d, true);
  eq(d.panel.rolls.length, 0, "E: the armed panel's rows wait the same way");
  d = { show: true, rolls: [row("i5:x", "owed")] };
  W.holdNewRolls(["a"], d, false);
  eq(d.rolls.length, 1, "E: no dice (3D off or absent): nothing waits");
  /* the waiting strip */
  const w0 = [{ who: "Kid", what: ["attack"], ids: ["i1:attack"] }];
  let h = W.holdWaitNew(null, w0, false);
  const w1 = [{ who: "Kid", what: ["attack", "injury"], ids: ["i1:attack", "i2:injury"] }, { who: "GM", what: ["reaction"], ids: ["p7"] }, { who: "GM", what: ["x"] }];
  const h1 = W.holdWaitNew(h.memo, w1, true);
  eq(h1.rows, [{ who: "Kid", what: ["attack"], ids: ["i1:attack"] }, { who: "GM", what: ["x"] }], "E: while the dice roll the new pieces of 'waiting for' wait (a row left empty goes, a row without ids stays)");
  eq(W.holdWaitNew(h1.memo, w1, false).rows, w1, "E: landed: they show");
  eq(W.holdWaitNew(["i1:attack"], w0, true).held, false, "E: nothing new: nothing held");
  /* the sound */
  const model = { prompts: [{ id: "p1" }, { id: "p2" }], rolls: [{ inst: "i2", key: "injury", state: "owed", users: ["u1"] }, { inst: "i1", key: "attack", state: "push", users: ["u1"] }], bars: [] };
  const a = W.heldAsks(model, null, ["p2"], ["i2:injury"]);
  eq(FP.asksOf(a.model, "u1", false), ["p:p1", "r:i1:attack"], "E: the sound hears no held question and no held roll");
  eq(FP.asksOf(W.heldAsks(model, null, [], []).model, "u1", false), ["p:p1", "p:p2", "r:i2:injury", "r:i1:attack"], "E: nothing held: it hears all");
  eq(W.heldAsks(model, [{ id: "c1" }, { id: "c2" }], ["c2"], []).cards, [{ id: "c1" }], "E: the GM's held card makes no sound before it shows");
  const mn = src("./ui/main.mjs");
  ok(/const newRolls = Wait\.holdNewRolls\(ansc\.rolls, data, diceNow\)/.test(mn) && mn.indexOf("Wait.holdNewRolls(") > mn.indexOf("NewsP.holdRollsIn(") && mn.indexOf("Wait.holdNewRolls(") < mn.indexOf("Dock.render(data, st.dock)"), "E: main.mjs holds new rows after FXN, before the dock draws");
  ok(/const wDock = Wait\.holdWaitNew\(ansc\.waitDock, data\.waiting, diceNow\)/.test(mn), "E: the dock's strip");
  ok(/const asks = Wait\.heldAsks\(model, desk\?\.cards \?\? null, allIds\.filter\(\(id\) => !shownIds\.includes\(id\)\), newRolls\.hidden\)/.test(mn) && /Feedback\.sync\(\{ combat, facts, model: asks\.model, data, cards: asks\.cards,/.test(mn), "E: the sounds hear the held lists");
  ok(/if \(anscHeld\) diceThen\(\);/.test(mn), "E: what is held is drawn again when the dice land (diceThen)");
}

/* ================================================================== F: the GM desk */
{
  const st = (id, rolls, outcomes, step) => ({ id, rolls, outcomes, step, text: `t-${step}`, commands: [] });
  const desk0 = { show: true, tab: "now", stack: [st("i1", [{ key: "attack", text: "waiting 5 dice" }], [], "roll")], journal: [{ round: 1, label: "R1", rows: [{ id: "j1", text: "Kid moved" }] }], npcs: [{ id: "N1", note: null, policy: [] }], kit: null, scene: null };
  let h = W.holdDeskResults(null, desk0, false);
  eq(h.desk, desk0, "F: no dice: the desk as it is");
  const desk1 = { ...desk0, stack: [st("i1", [{ key: "attack", text: "done: 2 sixes" }], [{ name: "Boss", text: "Hit", hit: true }], "damage")], journal: [{ round: 1, label: "R1", rows: [{ id: "j1", text: "Kid moved" }, { id: "j2", text: "Kid hits Boss: 3" }] }], npcs: [{ id: "N1", note: "out of Resolve", policy: [{ id: "x" }] }] };
  const h1 = W.holdDeskResults(h.memo, desk1, true);
  eq(h1.desk.stack[0].rolls, desk0.stack[0].rolls, "F: the row in progress keeps its dice while they roll");
  eq(h1.desk.stack[0].outcomes, [], "F: ... no hit or miss yet");
  eq(h1.desk.stack[0].step, "roll", "F: ... the step it showed");
  eq(h1.desk.journal[0].rows.map((x) => x.id), ["j1"], "F: the journal's new line waits");
  eq(h1.desk.npcs[0].note, null, "F: an NPC's 'out of Resolve' waits");
  eq(h1.desk.npcs[0].policy, [{ id: "x" }], "F: ... its controls do not");
  eq(h1.held, true, "F: held");
  const desk2 = { ...desk1, stack: [] };
  const h2 = W.holdDeskResults(h1.memo, desk2, true);
  eq(h2.desk.stack.map((x) => x.id), ["i1"], "F: a row that closed meanwhile stays until the dice land");
  eq(W.holdDeskResults(h2.memo, desk2, false).desk, desk2, "F: landed: everything as it is");
  /* the unit panel and the scene tab */
  const u = (vit) => ({ id: "N1", name: "Boss", vitals: vit, states: [], last: [], zone: "z1" });
  const k0 = { show: true, tab: "kit", stack: [], journal: [], npcs: [], kit: { unit: u("6/6"), groups: [] } };
  const hk = W.holdDeskResults(null, k0, false);
  const hk1 = W.holdDeskResults(hk.memo, { ...k0, kit: { unit: { ...u("3/6"), states: [{ id: "broken" }] }, groups: [1] } }, true);
  eq([hk1.desk.kit.unit.vitals, hk1.desk.kit.unit.states, hk1.desk.kit.groups], ["6/6", [], [1]], "F: the unit panel keeps Health and states, the rest of the tab follows");
  const s0 = { show: true, tab: "scene", stack: [], journal: [], npcs: [], scene: { chase: { distance: 3 } } };
  const hs = W.holdDeskResults(null, s0, false);
  eq(W.holdDeskResults(hs.memo, { ...s0, scene: { chase: { distance: 1 } } }, true).desk.scene, { chase: { distance: 3 } }, "F: the scene tab stays as it was");
  eq(W.holdDeskResults(hs.memo, { ...s0, tab: "now", scene: null }, true).desk.scene, null, "F: ... a tab switched away is no scene tab to hold");
  const mn = src("./ui/main.mjs");
  ok(/const dr = Wait\.holdDeskResults\(ansc\.desk, deskD, diceNow\)/.test(mn) && mn.indexOf("Wait.holdDeskResults(") < mn.indexOf("if (deskD) Desk.render(deskD, st.desk);"), "F: main.mjs holds the desk before it draws");
  ok(/cardsWere = diceNow && fresh \? cardsWere : ids;/.test(mn) && /if \(fresh && !diceNow && st\.desk\.tab !== "now"/.test(mn), "F: a held card does not bring the Now tab forward; it does when it shows");
  ok(mn.indexOf("const diceNow = Wait.diceHolds(diceBusy(), diceWas?.since, Date.now()).on;") < mn.indexOf("const ids = Model.deskDue(desk)"), "F: the gate is asked before the desk's tab is chosen");
}

/* ================================================================== G: the initiative bar and the challenges HUD */
{
  const tile = (id, v, defeated = false) => ({ id, name: id, hp: { v, max: 6 }, rs: { v: 5, max: 5 }, showHp: true, showRs: true, defeated, init: 3 });
  let h = W.holdById(null, [tile("a", 6), tile("b", 4)], W.BAR_HELD, false);
  const now = [tile("a", 0, true), tile("b", 4), tile("c", 6)];
  const h1 = W.holdById(h.memo, now, W.BAR_HELD, true);
  eq(h1.items.map((x) => [x.id, x.hp.v, x.defeated]), [["a", 6, false], ["b", 4, false], ["c", 6, false]], "G: a tile keeps Health and 'defeated' while the dice roll; a new tile shows");
  eq(W.holdById(h1.memo, now, W.BAR_HELD, false).items, now, "G: landed: the numbers as they are");
  eq(W.holdById(h.memo, now, W.BAR_HELD, true, { hideNew: true }).items.length, 2, "G: (hideNew drops a new row)");
  const card = (id, cr) => ({ id, name: id, cr, crMax: 5, tl: 3, tlMax: 4, selected: false });
  const hc = W.holdById(null, [card("ch", 5)], W.HUD_HELD, false);
  eq(W.holdById(hc.memo, [{ ...card("ch", 4), selected: true }], W.HUD_HELD, true).items[0], { ...card("ch", 5), selected: true }, "G: a challenge card keeps its rating, the selection follows");
  const bar = src("../combat/bar.mjs"), hud = src("../challenges/main.mjs");
  ok(/let tac = false; try \{ tac = !!Tac\.tacticsState\(combat\); \} catch \{ tac = false; \}/.test(bar) && /holdById\(barHeld\?\.combat === combat\.id \? barHeld\.memo : null, items, BAR_HELD, tac && Gate\.on\(\)\)/.test(bar), "G: the bar holds in a tactical fight only");
  ok(/Gate\.landed\(\)\.then\(\(\) => \{ barWait = false; schedule\(\); \}\)/.test(bar), "G: the bar is drawn again once the dice landed");
  ok(bar.indexOf("BAR_HELD, tac && Gate.on()") < bar.indexOf("it.dup = { k: ids.indexOf(it.id) + 1"), "G: held before the duplicates are made compact");
  ok(/holdById\(hudHeld\?\.scene === scene\.id \? hudHeld\.memo : null, items, HUD_HELD, fightHere\(scene\) && Gate\.on\(\)\)/.test(hud) && /Gate\.landed\(\)\.then\(\(\) => \{ hudWait = false; schedule\(\); \}\)/.test(hud), "G: the challenges HUD holds in a tactical fight and draws again after");
  ok(/if \(o\?\.ipuTactics && canvas\?\.scene && fightHere\(canvas\.scene\)\) Gate\.after\(beat\); else beat\(\);/.test(hud), "G: the challenge camera's beat of the engine's write waits; a GM's own edit does not");
  ok(/c\.started && \(!c\.scene \|\| c\.scene\.id === scene\.id\) && !!tacticsState\(c\)/.test(hud), "G: 'a tactical fight on this scene'");
}

/* ================================================================== H: the map's marks and the chase panel */
{
  let h = W.holdKeys(null, { N1: [] }, false);
  const h1 = W.holdKeys(h.memo, { N1: [{ id: "broken" }], H1: [{ id: "airborne" }] }, true);
  eq(h1.obj, { N1: [] }, "H: while the dice roll the map marks keep the states they showed (broken waits; a new key waits)");
  eq(W.holdKeys(h1.memo, { N1: [{ id: "broken" }] }, false).obj, { N1: [{ id: "broken" }] }, "H: landed: the marks as they are");
  eq(W.holdKeys(null, { a: 1 }, true).obj, { a: 1 }, "H: first look: as it is");
  eq(W.holdKeys({ a: 1 }, { a: 1 }, true).held, false, "H: nothing changed: nothing held");
  const c0 = { on: true, phase: "rolling", dist: 3 }, hc = W.holdWhole(null, c0, false);
  eq(W.holdWhole(hc.memo, { on: true, phase: "after", dist: 1 }, true).value, c0, "H: the chase panel stays as it was while the dice roll");
  eq(W.holdWhole(hc.memo, { on: true, phase: "after", dist: 1 }, false).value, { on: true, phase: "after", dist: 1 }, "H: landed: as it is");
  const mn = src("./ui/main.mjs");
  ok(/const boardView = bS\.held \|\| bP\.held \? \{ \.\.\.facts\.view, statuses: bS\.obj, prompts: bP\.obj \} : facts\.view;/.test(mn) && /Board\.sync\(data, \{ combat, facts, view: boardView,/.test(mn), "H: the board draws its marks from the held statuses and questions");
  ok(/const ch = Wait\.holdWhole\(ansc\.chase, chaseD, diceNow\)/.test(mn) && mn.indexOf("Wait.holdWhole(ansc.chase") < mn.indexOf("ChaseUI.render(chaseD"), "H: the chase panel is held before it draws");
}

/* ================================================================== I: through the real engine */
{
  const T = new Table();
  T.hero("H1", "p1", { name: "Kid" }).npc("N1", { name: "Boss", health: 2 }); T.weapons.gun = { id: "gun", name: "gun", bonus: 1, damage: 3, range: [0, 3], sharp: false };
  T.order(["H1", "N1"]).turn("H1");
  const meta = () => ({ hidden: [], npc: ["N1"] });
  const ctx = { c: (id) => T.c[id] ?? null, online: () => true, P1 };
  const gmFacts = () => ({ view: T.state, staff: true, me: "gm", c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc } : null), attrs: (id) => T.c[id]?.attrs ?? null, userName: (x) => x, online: () => true });
  const desk = () => M.deskData(D.deskModel(T.state, T.log, ctx), {}, gmFacts(), tr("en"));
  const pview = () => V.viewFor(T.state, { id: "p1", staff: false, owns: ["H1"] }, meta());
  await T.req("p1", { op: "declare", actor: "H1", decl: { action: "shoot", targets: ["N1"], weapon: "gun" } });
  for (const p of T.prompts()) await T.gm({ op: "answerFor", prompt: p.id, value: "pass" });
  const before = desk(), vBefore = pview();
  let mDesk = W.holdDeskResults(null, before, false).memo;
  const mStat = W.holdKeys(null, vBefore.statuses, false).memo;
  await T.roll("attack", 3, { pushable: false });
  for (const p of T.prompts()) await T.gm({ op: "answerFor", prompt: p.id, value: (p.options ?? [])[0]?.id ?? "pass" });
  const after = desk(), vAfter = pview();
  const changed = JSON.stringify(after.stack) !== JSON.stringify(before.stack) || JSON.stringify(after.journal) !== JSON.stringify(before.journal);
  ok(changed, "I: (the roll changed what the desk says)");
  const held = W.holdDeskResults(mDesk, after, true);
  const rowsOf = (d) => (d.journal ?? []).flatMap((r) => r.rows.map((x) => x.id));
  eq(rowsOf(held.desk), rowsOf(before), "I: while the dice roll the GM's journal says no more than before the roll");
  eq((held.desk.stack ?? []).map((x) => [x.id, x.rolls, x.outcomes]), (before.stack ?? []).map((x) => [x.id, x.rolls, x.outcomes]), "I: ... and the rows in progress say the dice they said");
  eq(W.holdDeskResults(held.memo, after, false).desk, after, "I: landed: the desk says it all");
  const statsAfter = W.holdKeys(mStat, vAfter.statuses, true);
  eq(JSON.stringify(statsAfter.obj ?? {}), JSON.stringify(vBefore.statuses ?? {}), "I: the target's map marks are those of before the roll while the dice roll");
  /* the news line of the same moment is held by D128 (news-pure diceHold): the two agree */
  const pf = (view) => ({ view, staff: false, me: "p1", c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc } : null), attrs: (id) => T.c[id]?.attrs ?? null, userName: (x) => x });
  const n0 = M.newsData(vBefore, {}, pf(vBefore), tr("en")), n1 = M.newsData(vAfter, {}, pf(vAfter), tr("en"));
  const hold = N.diceHold({ prompts: [], cards: [], news: n0, since: 0 }, { prompts: [], cards: [], news: n1, at: 10 }, true);
  eq(hold.news?.id ?? null, n0?.id ?? null, "I: the news line keeps what it said before the roll (D128), as the desk and the marks do");
  ok(T.evs("outcome").length > 0, "I: (the engine knew the outcome at once: the events that the numbers over the tokens follow)");
  const floats = FP.floats(T.events.filter((e) => ["outcome", "damage", "broken"].includes(e.type)), tr("en"));
  ok(floats.length > 0, "I: (those events make numbers over the tokens: they are what feedback.mjs holds until the dice land)");
}

done("check-ansc");
