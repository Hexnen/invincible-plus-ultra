// node scripts/tactics/check-hunt2.mjs -- PROOFS of the open defects of "Bug hunt 2, 2026-11-12" (dev/combat-defects.md, rows H2-n).
// In check-all.mjs since the fixes of tactics-fxe (all six fixed). Scripted table, no Foundry (the camera part fakes the globals).
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import * as V from "./view-pure.mjs";
import * as UI from "./ui/model-pure.mjs";
import { t as say } from "./lang.mjs";

const tEN = (k, p = {}, fb) => say(k, p, fb);
const pjournal = (T, owns = ["H1"]) => V.journalFor(T.log, { id: "p1", staff: false, owns }, { concealed: V.concealedFor(T.state, { id: "p1", owns }, { hidden: Object.keys(T.c).filter((id) => T.c[id].hidden) }), name: (id) => T.c[id]?.name }).map((j) => UI.marks(tEN, j.text));

/* ================================================================== H2-1: a challenge's round-point side effect (pushTrigger's fallback) carries no challengeFx:
   the players' news gets an unnamed 'Other' line, also for a challenge hidden from them (not secret); a failed one (pushManual) is right */
{
  const T = new Table();
  T.hero("H1", "p1").npc("N1");
  T.add("CH", { kind: "challenge", npc: true, hidden: true, health: 6, resolve: 5, maxResolve: 5, name: "Secret Ward" });
  T.order(["H1", "N1"]).turn("H1");
  await T.gm({ op: "challengeSetup", challenge: "CH", preset: "magicalWard" });
  await T.gm({ op: "nextRound", force: true });
  const q = T.prompts("triggerQueue").find((p) => (p.options ?? []).some((o) => o.data?.effect === "wardBlast"));
  ok(!!q, "H2-1: (setup) the ward's round-start blast is in the GM's queue");
  if (q) {
    await T.gm({ op: "answerFor", prompt: q.id, value: { order: q.options.filter((o) => o.data?.effect === "wardBlast").map((o) => o.id) } });
    const I = T.state.stack.find((i) => i.data?.trigger?.run?.kind === "wardBlast");
    ok(!!I, "H2-1: (setup) the side effect is the GM's item");
    if (I) {      // fixer fxe: the desk says what it is, not "Time is up" (the ward's blast comes at a round point, not when its time runs out)
      const D = await import("./desk-pure.mjs"), m = D.deskModel(T.state, T.log, { c: (id) => T.c[id] }).manual.find((x) => x.inst === I.id);
      const d = m && UI.manualData(m, {}, null, tEN);
      eq([m?.fx?.round ?? 0, typeof d?.why === "string" && d.why.startsWith("Secret Ward: the ward strikes.")], [1, true], "H2-1: the GM's item names the challenge and its effect without 'Time is up'");
    }
    if (I) await T.gm({ op: "manual", inst: I.id, result: { cost: "none", note: "", damage: [] } });
    const news = V.viewFor(T.state, { id: "p1", staff: false, owns: ["H1"] }, { hidden: ["CH"], npc: ["N1", "CH"] }).news ?? [];
    eq(news.filter((n) => n.tx === undefined && n.kind === "action" && n.action === "other" && !n.actor).length, 0, "H2-1: a side effect of a challenge hidden from the players leaves no news line for them (it is marked secret as U110 marks a failed one)");
    const J = T.state.stack.length ? null : T.state.news?.find((n) => n.action === "other");
    eq(J?.fx ?? null, { challenge: "CH", kind: "wardBlast" }, "H2-1: the news of a challenge's round-point side effect names the challenge and the effect (challengeFx, as pushManual sets it)");
  }
}

/* ================================================================== H2-2: the Doomsday Device's blast (D111) is aimed at an emptied minion group (D110 not applied) */
{
  const T = new Table();
  T.hero("H1", "p1", { zone: "z1" }).npc("N1", { zone: "z2" });
  T.add("G", { npc: true, kind: "minions", health: 0, maxHealth: 10, members: 0, name: "Soldiers", zone: "z1" });
  T.add("CH", { kind: "challenge", npc: true, health: 6, resolve: 3, maxResolve: 3, name: "Device", zone: "z1" });
  T.order(["H1", "N1", "G"]).turn("H1");
  await T.gm({ op: "challengeSetup", challenge: "CH", preset: "doomsdayDevice" });
  T.c.CH.resolve = 1; await T.gm({ op: "nextRound", force: true });
  const p = T.prompt("challengeFail");
  ok(!!p, "H2-2: (setup) time is up");
  if (p) {
    await T.gm({ op: "answer", prompt: p.id, value: "run" });
    const I = T.state.stack.find((i) => i.flow === "blast");
    eq(I?.decl.targets ?? null, ["H1"], "H2-2: the failed device's Blast 10 hits the ones standing in its zone, not a minion group with nobody left (D110: an emptied group is out)");
  }
}

/* ================================================================== H2-4: D106 with an ANSWERED turn-start card: the undo of the chase's end takes the
   card's effect back with it (a dependent transaction), but the moment does not come again when the turn does: the poison is lost */
{
  const car = (o = {}) => ({ kind: "vehicle", npc: true, health: 8, vehicle: { type: "ground", speed: 3, maneuver: 1, passengers: 3, weapons: 0 }, ...o });
  const T = new Table();
  T.hero("H1", "p1").hero("H2", "p2").npc("N1").npc("N2");
  T.add("V1", car({ name: "Van" })).add("V2", car({ name: "Bike" }));
  T.order(["H1", "N1", "H2", "N2"]).turn("H1");
  for (const id of ["H1", "H2", "N1", "N2"]) await T.gm({ op: "triggerAdd", trigger: { at: "turnStart", subject: { combatant: id }, run: { type: "hazard", hazard: { kind: "fixed", amount: 1 } }, source: { kind: "gm", name: `poison ${id}` } } });
  await T.gm({ op: "vehicleSet", vehicle: "V1", seat: { who: "H1", role: "driver" }, started: true });
  await T.gm({ op: "vehicleSet", vehicle: "V2", seat: { who: "N1", role: "driver" }, started: true });
  for (const p of T.prompts("triggerQueue")) await T.gm({ op: "answerFor", prompt: p.id, value: { skip: p.options.map((o) => o.id) } });
  await T.gm({ op: "chaseStart", prey: ["V2"], pursuer: ["V1"], distance: 2 });
  await T.gm({ op: "chaseEnd", outcome: "combat" });
  const tx = T.log.list[T.log.list.length - 1].id, first = T.state.init.curMember, hp0 = T.c[first].health;
  const q = T.prompts("triggerQueue").find((p) => p.about === first);
  ok(!!q, "H2-4: (setup) the first turn of the fight opens with its turn-start card");
  if (q) {
    await T.gm({ op: "answerFor", prompt: q.id, value: { order: q.options.map((o) => o.id) } });      // the poison is run
    ok(T.c[first].health === hp0 - 1, "H2-4: (setup) the poison took its 1");
    const env = await T.gm({ op: "undo", tx });
    eq([env.ok, T.state.kind, T.c[first].health], [true, "chase", hp0], "H2-4: (setup) the end of the chase is undone, and with it the poison (a later transaction that hung on it)");
    await T.gm({ op: "chaseEnd", outcome: "combat" });
    const now = T.state.init.curMember;
    eq([now, T.prompts("triggerQueue").filter((p) => p.about === now).length, T.c[now].health], [first, 1, hp0], "H2-4: the same turn opens again and its turn-start card comes again (its first run was undone); before, its round:ts:member key stayed in sched.done and the poison never ran");
  }
}
/* H2-4, control (fixer fxe): a FORCED single undo of the chase's end leaves the poison's transaction standing: the answered card has
   happened, the moment does not come again (no second poison) */
{
  const car = (o = {}) => ({ kind: "vehicle", npc: true, health: 8, vehicle: { type: "ground", speed: 3, maneuver: 1, passengers: 3, weapons: 0 }, ...o });
  const T = new Table();
  T.hero("H1", "p1").hero("H2", "p2").npc("N1").npc("N2");
  T.add("V1", car({ name: "Van" })).add("V2", car({ name: "Bike" }));
  T.order(["H1", "N1", "H2", "N2"]).turn("H1");
  for (const id of ["H1", "H2", "N1", "N2"]) await T.gm({ op: "triggerAdd", trigger: { at: "turnStart", subject: { combatant: id }, run: { type: "hazard", hazard: { kind: "fixed", amount: 1 } }, source: { kind: "gm", name: `poison ${id}` } } });
  await T.gm({ op: "vehicleSet", vehicle: "V1", seat: { who: "H1", role: "driver" }, started: true });
  await T.gm({ op: "vehicleSet", vehicle: "V2", seat: { who: "N1", role: "driver" }, started: true });
  for (const p of T.prompts("triggerQueue")) await T.gm({ op: "answerFor", prompt: p.id, value: { skip: p.options.map((o) => o.id) } });
  await T.gm({ op: "chaseStart", prey: ["V2"], pursuer: ["V1"], distance: 2 });
  await T.gm({ op: "chaseEnd", outcome: "combat" });
  const tx = T.log.list[T.log.list.length - 1].id, first = T.state.init.curMember, hp0 = T.c[first].health;
  const q = T.prompts("triggerQueue").find((p) => p.about === first);
  if (q) await T.gm({ op: "answerFor", prompt: q.id, value: { order: q.options.map((o) => o.id) } });
  const env = await T.gm({ op: "undo", tx, force: true, drift: "leave" });
  await T.gm({ op: "chaseEnd", outcome: "combat" });
  const now = T.state.init.curMember;
  eq([env.ok, now, T.prompts("triggerQueue").filter((p) => p.about === now).length, T.c[now].health], [true, first, 0, hp0 - 1], "H2-4 (control): a forced single undo of the chase's end keeps the answered card's poison, and the moment does not come a second time");
}

/* ================================================================== H2-5: the GM's client gets a reveal shot for every player-side newcomer
   Spec 26, per seat: the GM gets no reveal ("nothing is new to the GM"). camera-pure cues() counts as new whatever enters the GM's ledger
   that is not "mine" (an NPC); a player's summoned allies (or a hero added mid-fight) are not, so the GM's view is taken by a reveal shot. */
{
  const CP = await import("./ui/camera-pure.mjs");
  const v0 = { round: 1, init: { curMember: "N1" }, ledger: { H1: {}, N1: {} }, prompts: {} };
  const v1 = { ...v0, ledger: { ...v0.ledger, S1: {} } };      // S1: the allies a player's hero just summoned
  const own = { me: "gm", staff: true, mine: ["N1"] };
  const now = CP.look(v1, own), all = CP.cues(CP.look(v0, own), now);
  eq([all.filter((c) => c.why === "reveal").length, CP.cueShot(all.find((c) => c.why === "reveal") ?? null, now)], [0, null], "H2-5: a newcomer is no reveal (and no reveal shot) on the GM's client");
  const pown = { me: "p1", staff: false, mine: ["H1"] }, pall = CP.cues(CP.look(v0, pown), CP.look(v1, pown));
  eq(pall.filter((c) => c.why === "reveal").map((c) => c.focus), ["S1"], "H2-5 (control): a player still gets the reveal of a newcomer");
  /* H2-3 (fixer fxe): the rule the camera applies, pure: a card open holds the watcher's cues (level all), not the ones about the user's own units */
  const asked = { asks: { p9: { about: "H1" } } };
  eq([CP.heldByCard({ level: "all" }, asked), CP.heldByCard({ level: "turn" }, asked), CP.heldByCard({ level: "all" }, { asks: {} })], [true, false, false], "H2-3: a card open holds the quiet watcher cues only");
}

/* ================================================================== H2-6: merge leftovers (tactics-cam2 x tactics-fxc in ui/main.mjs, tactics-u21 in model-pure)
   ui/main.mjs registers TWO updateToken handlers for a change of `hidden` (CAM-14: schedule(); U101: moved() now and again 120 ms later):
   the first is subsumed by the second (moved() schedules) and redraws for tokens outside the fight too. model-pure's import line of the kit
   bands lost its comment to the U100 import beside it. */
{
  const fs = await import("node:fs");
  const src = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
  const main = src("./ui/main.mjs"), model = src("./ui/model-pure.mjs");
  eq((main.match(/Hooks\.on\("updateToken",[^\n]*"hidden" in ch/g) ?? []).length, 1, "H2-6: one updateToken handler for a token hidden or shown (the merge left two)");
  eq(/signs-pure\.mjs";[^\n]*\/\/[^\n]*\/\/ the bands of a chance/.test(model), false, "H2-6: the comment of the bands import stands on its own line (the merge glued it after the U100 import's)");
}

/* ================================================================== H2-S1 (a suspicion of the hunt; fixer fxe): the intended target answered with a block (a quick
   action paid), then a guardian dived in and took the hit [B2115]: the block is never rolled (swapTarget drops it) and its quick action
   stays spent. That is the PROVISIONAL behaviour of the open question U19-5 ("Nie oddaje"), so it is pinned here, not changed: when the
   user decides U19-5 the other way, this check is the one to turn round (void the entry `I.data.paid["def:<from>"]` at the swap). */
{
  const KP = await import("./kit-pure.mjs");
  const item = (id, name) => ({ id, name, type: "talent", level: null, power: null, boosts: [], autos: [], fx: [], flags: { kit: null, off: false, types: [] }, wf: {} });
  const T = new Table();
  T.hero("H1", "p1", { name: "Guardian" }).hero("H2", "p2", { name: "Friend" }).npc("N1", { health: 6 }).npc("N2", { health: 6 });
  T.c.H1.kit = KP.build({ items: [item("i0H1", "Guardian")], attrs: T.c.H1.attrs }); T.c.H1.pass = T.c.H1.kit.pass;
  T.order(["N1", "H1", "H2", "N2"]);
  await T.gm({ op: "declare", actor: "N1", decl: { action: "slugfest", targets: ["H2"] } });
  const live = (cid) => (T.state.ledger[cid]?.entries ?? []).filter((e) => !e.void && e.action === "block").length;
  await T.req("p2", { op: "answer", prompt: T.prompt("reaction", "H2").id, value: "block" });
  ok(live("H2") === 1, "H2-S1: (setup) the target's block is paid with a quick action");
  const g = T.c.H1.kit.actions.find((a) => a.id.endsWith("-guardian")).id;
  await T.req("p1", { op: "answer", prompt: T.prompt("reaction", "H1").id, value: `r:${g}` });
  await T.roll("sw:H1", 1);
  eq([T.top()?.decl.targets, live("H2"), T.top()?.data.def?.H2 ?? null], [["H1"], 1, null], "H2-S1: the guardian took the hit: the dropped block's quick action stays spent (U19-5, provisional)");
}
{     // control: the guardian's roll fails, the target's block stands and stays paid
  const KP = await import("./kit-pure.mjs");
  const item = (id, name) => ({ id, name, type: "talent", level: null, power: null, boosts: [], autos: [], fx: [], flags: { kit: null, off: false, types: [] }, wf: {} });
  const T = new Table();
  T.hero("H1", "p1", { name: "Guardian" }).hero("H2", "p2", { name: "Friend" }).npc("N1", { health: 6 }).npc("N2", { health: 6 });
  T.c.H1.kit = KP.build({ items: [item("i0H1", "Guardian")], attrs: T.c.H1.attrs }); T.c.H1.pass = T.c.H1.kit.pass;
  T.order(["N1", "H1", "H2", "N2"]);
  await T.gm({ op: "declare", actor: "N1", decl: { action: "slugfest", targets: ["H2"] } });
  await T.req("p2", { op: "answer", prompt: T.prompt("reaction", "H2").id, value: "block" });
  const g = T.c.H1.kit.actions.find((a) => a.id.endsWith("-guardian")).id;
  await T.req("p1", { op: "answer", prompt: T.prompt("reaction", "H1").id, value: `r:${g}` });
  await T.roll("sw:H1", 0);
  eq([T.top()?.decl.targets, (T.state.ledger.H2.entries ?? []).filter((e) => !e.void && e.action === "block").length, T.top()?.data.def?.H2?.defence ?? null], [["H2"], 1, "block"], "H2-S1 (control): the guardian failed: the block stands, paid");
}

/* ================================================================== H2-S3 (a suspicion of the hunt, proved in the pure tracker and fixed by fixer fxe): a second
   pointer pressed (or released) off the map during a real drag ended the hold; the drag then held still over 1.5 s read as a script */
{
  const MP = await import("./movement-pure.mjs");
  const run = (steps, at) => { const h = MP.handTracker(); for (const [f, ...a] of steps) h[f](...a); return h.byScript(at); };
  eq([run([["down", 0, true, 1], ["down", 100, false, 2], ["up", 150, 2]], 4000), run([["down", 0, true, 1], ["down", 100, false, 2]], 4000)], [false, false], "H2-S3: a pen or a second finger off the map does not end a drag still held on the map");
  eq([run([["down", 0, true, 1], ["down", 100, false, 2], ["up", 200, 1]], 4000), run([["down", 0, true, 1], ["cancel", 100]], 4000)], [true, true], "H2-S3 (control): the drag's own release (or a blur) still ends the hold");
  /* through `listen` with events that carry pointer ids */
  const fns = {}, win = { addEventListener: (n, f) => { fns[n] = f; } }; let now = 0;
  const h = MP.handTracker(); h.listen(win, (e) => e.target === "board", () => now);
  fns.pointerdown({ target: "board", pointerId: 1 }); now = 100; fns.pointerdown({ target: "btn", pointerId: 2 }); now = 150; fns.pointerup({ pointerId: 2 }); now = 4000;
  eq(h.byScript(now), false, "H2-S3: the window listener keeps the map's pointer held");
}

/* ================================================================== H2-3: the action camera moves a player's view while a card waits for that player
   Spec 26: "while a card is open, results play in place only (`still`)"; no opening and no walk shot for a user with a card open. camera.mjs
   onEvent: eventShot gives null then (camera-pure, by design), and the QUIET cue of the same event (eventCue: "attack", "move", level "all")
   is played instead with the map's `frame`; the map's action setting plays level "all" frames (moinen-maps source-stage stageFollow). The
   fallback cue is meant for a map that answered "level" only. Driven here through the real camera.mjs with a fake Foundry and a fake map. */
{
  const frames = [], shots = [], hooks = {};
  const tok = (id) => ({ id: `t_${id}`, hidden: false, object: { visible: true } });
  const ids = ["H1", "H2", "N1"];
  const combat = { id: "C1", combatants: { get: (id) => (ids.includes(id) ? { id, token: tok(id), actor: { testUserPermission: () => false } } : null) } };
  globalThis.CONST = { USER_ROLES: { ASSISTANT: 3 }, DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
  globalThis.Hooks = { on: (n, f) => { (hooks[n] ??= []).push(f); } };
  globalThis.game = { user: { id: "p2", isGM: false, hasRole: () => false }, users: [], combats: { get: (id) => (id === "C1" ? combat : null) },
    modules: { get: (id) => (id === "moinen-maps" ? { active: true, api: { zones: { frame: async (s) => { frames.push(s); return { ok: true }; }, shot: async (s) => { shots.push(s); return { ok: true }; }, shotEnd: () => true, camera: () => ({}) } } } : null) } };
  const Camera = await import("./ui/camera.mjs");
  const Store = await import("./store.mjs");
  ok(Camera.start() === true, "H2-3: (setup) the camera runs with the map's frame and shot");
  const ledger = { H1: {}, H2: {}, N1: {} };
  const view0 = { round: 1, init: { curMember: "N1" }, ledger, prompts: {} };
  const view1 = { ...view0, prompts: { p9: { id: "p9", kind: "reaction", to: { users: ["p2"] }, about: "H2", options: [] } } };      // a card put to p2 (about p2's own hero)
  const ctx = (view) => ({ combat, view, staff: false, model: { bars: [{ combatant: "H2" }] }, dock: {}, data: {} });
  Camera.sync(ctx(view0)); Camera.sync(ctx(view1));
  const tick = () => new Promise((r) => setTimeout(r, 5));
  await tick();
  const f0 = frames.length, s0 = shots.length;
  ok(Camera.state().was && Object.keys(Camera.state().was.asks).length === 1, "H2-3: (setup) the player's look holds the open card");
  const fire = (ev) => { for (const f of hooks[Store.HOOK] ?? []) f({ combat: "C1", ...ev }); };
  fire({ seq: 11, type: "actionDeclared", inst: "a1", actor: "N1", decl: { action: "slugfest" }, targets: ["H1"] });      // somebody else's attack on somebody else
  fire({ seq: 12, type: "actionDeclared", inst: "a2", actor: "N1", decl: { action: "move", to: "z2" }, targets: [] });       // somebody else's walk
  await tick(); await tick();
  eq([frames.length - f0, shots.length - s0], [0, 0], "H2-3: with a card open for this player the camera does not slide to another's attack or walk (no shot, and no quiet frame in its place)");
  /* the result still plays, in place (the map's shot with still: true): that much is right today */
  fire({ seq: 13, type: "outcome", inst: "a1", actor: "N1", target: "H1", hit: true });
  await tick();
  eq(shots.slice(s0).map((s) => [s.beat, s.still]), [["hit", true]], "H2-3: (control) the result plays as a still beat");

  /* H2-S2 (a suspicion of the hunt, proved and fixed by fixer fxe): a reveal in the same redraw as the user's own choice of a unit on the
     dock played the reveal shot over the hand's own cue (spec 26: the user's hand ends a shot, the hand's frame takes over) */
  ids.push("S1");
  const quiet = { ...view0, init: { curMember: "N1" } };
  Camera.sync(ctx(quiet)); await tick();
  const f1 = frames.length, s1 = shots.length;
  Camera.sync({ ...ctx({ ...quiet, ledger: { ...ledger, S1: {} } }), dock: { sel: "H2" } });
  await tick(); await tick();
  eq([frames.slice(f1).map((f) => f.why), shots.slice(s1).map((s) => s.beat)], [["select"], []], "H2-S2: the user's own choice of a unit wins over a reveal in the same redraw (the hand's frame, no reveal shot)");
}

done("check-hunt2");
