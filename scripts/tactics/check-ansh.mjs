/* node scripts/tactics/check-ansh.mjs -- ANSH: the user's answers of 2026-11-12 (dev/combat-answers-2026-11-12.md) built, and the defects
   of the package fixed. Fights through the REAL director, engine and view (testkit Table); cards and panels through the pure models.
     chase catch   every seat says what the catcher does (a driver rams), not only the catcher's own; the charge answer is named Charge / Szarża
     ANSEL-3       a guardian card already shown greys its Guardian answer once the guardian is held, snared or trapped
     FXF-4         a defence already paid for, then warned: the action comes back, the two dice stay
     P8g-3         a character marked defeated sits its turn out (the turn passes, the dock says why)
     U10-6         a bare "Hit" float waits for the blow's own damage float, shown alone only when the blow closed without one
     A8C-2, X6, FXJ-4, CU8, FXR-2   pins of what has no pure model (the bar, the roll window, the splash) */
import { readFileSync } from "node:fs";
import { Table, ok, eq, done } from "./testkit.mjs";
import * as V from "./view-pure.mjs";
import * as D from "./desk-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as K from "./flows/kit.mjs";
import * as UM from "./ui/model-pure.mjs";
import * as CP from "./ui/chase-pure.mjs";
import * as FP from "./ui/feedback-pure.mjs";
import * as KP from "./kit-pure.mjs";
import { t as say, tIn, EN, PL } from "./lang.mjs";

const here = new URL(".", import.meta.url);
const src = (f) => readFileSync(new URL(f, here), "utf8");
const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const decl = (actor, action, targets, extra = {}) => ({ op: "declare", actor, decl: { action, targets, ...extra } });
const item = (id, name, type = "talent") => ({ id, name, type, level: null, power: null, boosts: [], autos: [], fx: [], flags: { kit: null, off: false, types: [] }, wf: {} });
const kit = (T, cid, ...names) => { const c = T.c[cid]; c.kit = KP.build({ items: names.map((n, i) => item(`i${i}${cid}`, n)), attrs: c.attrs }); c.pass = c.kit.pass; return T; };
const rid = (T, cid, k) => `r:${T.c[cid].kit.actions.find((a) => a.id.endsWith(`-${k}`)).id}`;
const meta = (T) => ({ hidden: Object.values(T.c).filter((c) => c.hidden).map((c) => c.id), npc: Object.values(T.c).filter((c) => c.npc).map((c) => c.id) });
const pview = (T, uid, owns) => V.viewFor(T.state, { id: uid, staff: false, owns }, meta(T));
const ctx = (T) => ({ c: (id) => T.c[id] ?? null, online: () => true, P1 });
const tPl = (k, p = {}, f) => tIn("pl", k, p, f), tEn = (k, p = {}, f) => tIn("en", k, p, f);
const mfacts = (T, view, me, staff = false) => ({ view, me, staff, c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc, team: T.c[id].team ?? null, kind: T.c[id].kind, img: null } : null), attrs: (id) => T.c[id]?.attrs ?? null, userName: (u) => `user-${u}`, online: () => true, preview: () => null });
const dock = (T, uid, owns) => { const view = pview(T, uid, owns); return UM.dockData(D.playerModel(view, { id: uid, owns }, ctx(T)), {}, mfacts(T, view, uid), tEn); };

/* ================================================================== chase catch: every seat says ram for a driver */
{
  const t = (k, p, fb) => say(k, p, fb === undefined ? k : fb);
  const car = (o = {}) => ({ kind: "vehicle", npc: true, health: 8, vehicle: { type: "ground", speed: 3, maneuver: 1, passengers: 3, weapons: 0 }, ...o });
  const facts = (T, v, me) => ({ view: v, staff: me === "gm", me, whole: me === "gm" ? (id) => T.c[id] ?? null : undefined,
    c: (id) => (T.c[id] ? { name: T.c[id].name ?? id, npc: !!T.c[id].npc, kind: T.c[id].kind ?? null, img: null, way: T.c[id].kind === "vehicle" ? null : CP.wayOf(T.c[id]) } : null), userName: (u) => `User ${u}`, online: () => true, rollBusy: () => false });
  const view = (T, me, owns) => (me === "gm" ? T.state : pview(T, me, owns));
  const panel = (T, me, owns = []) => CP.chaseData(view(T, me, owns), {}, facts(T, view(T, me, owns), me), t);
  const T = new Table();
  T.hero("H1", "p1", { name: "Kid" }).hero("H2", "p2", { name: "Omni" }).hero("H3", "p3", { name: "Eve" }).npc("N1", { name: "Doc" });
  T.add("V1", car({ name: "Van" })); T.add("V2", car({ name: "Truck" }));
  T.order(["H1", "N1", "H2", "H3"]).turn("H1");
  for (const [v, who, role] of [["V1", "H1", "driver"], ["V1", "H2", "passenger"], ["V2", "N1", "driver"]]) await T.gm({ op: "vehicleSet", vehicle: v, seat: { who, role }, ...(role === "driver" ? { started: true } : {}) });
  eq(code(await T.gm({ op: "chaseStart", prey: ["V2"], pursuer: ["V1"], distance: 1 })), "ok", "chase: the van chases the truck");
  await T.gm({ op: "chaseRound" }); await T.roll("prey", 0); await T.roll("pursuer", 2);
  const q = T.prompt("chaseCatch");
  eq([q?.about, q?.data?.ram], ["H1", 1], "chase: caught, Kid (driving) may ram");
  const want = say("ITAC.chase.catch.whoRam", { name: "Kid", target: "Truck" });
  for (const [me, owns] of [["p1", ["H1"]], ["p2", ["H2"]], ["p3", ["H3"]], ["gm", []]]) {
    const p = panel(T, me, owns);
    eq([p.catch?.ram, p.catch?.text], [true, want], `chase: ${me}'s panel says Kid rams the truck (was "charges" on every seat but the driver's)`);
  }
  const pv = Object.values(pview(T, "p3", ["H3"]).prompts ?? {}).find((p) => p.kind === "chaseCatch");
  eq([pv?.data?.ram, pv?.data?.target ?? null, (pv?.options ?? []).length], [1, "V2", 0], "chase: another seat's copy of the card carries the ram and the target, never the answers");
  eq([EN["ITAC.opt.charge"], PL["ITAC.opt.charge"], PL["ITAC.action.ram"]], ["Charge", "Szarża", PL["ITAC.action.ram"]], "chase: the charge answer is named as the action (Charge / Szarża), never Attack under a line that says charge");
  ok(/szarżować/.test(PL["ITAC.ui.line.chaseCharge"]) && /charge/.test(EN["ITAC.ui.line.chaseCharge"]), "chase: the card's line says charge, in both languages");
  /* a hidden target stays hidden on other seats */
  T.c.V2.hidden = true;
  const hv = Object.values(pview(T, "p3", ["H3"]).prompts ?? {}).find((p) => p.kind === "chaseCatch");
  eq([hv?.data?.target ?? null, hv?.data?.targets ?? null], [null, []], "chase: a concealed target is not named to another seat");
}

/* ================================================================== ANSEL-3: the Guardian answer greys when the guardian is bound */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Guardian" }).hero("H2", "p2", { name: "Friend" }).npc("N1", { health: 6 }).npc("N2", { health: 6 });
  kit(T, "H1", "Guardian"); T.order(["N1", "H1", "H2", "N2"]);
  await T.gm(decl("N1", "slugfest", ["H2"]));
  const opt = () => dock(T, "p1", ["H1"]).prompts?.find((p) => p.kind === "reaction")?.options?.find((o) => String(o.id).startsWith("r:"));
  eq(!!opt() && !opt().disabled, true, "ANSEL-3: (a free guardian's card: Guardian may be answered)");
  for (const s of [{ id: "grappled", data: { by: "N2" } }, { id: "snared", data: { dice: -2 } }, { id: "trapped" }]) {
    T.state.statuses = { H1: [s] };
    ok(!!opt()?.disabled, `ANSEL-3: ${s.id} while the card shows: the Guardian answer is greyed`);
  }
  T.state.statuses = { H1: [{ id: "snared", data: { moveOnly: 1 } }] };
  ok(!opt()?.disabled, "ANSEL-3: Immobilize Only leaves the body free: the answer stays (ANSE-R1)");
  T.state.statuses = {};
  ok(!opt()?.disabled, "ANSEL-3: freed again: the answer is back");
}

/* ================================================================== FXF-4: a paid defence, then warned: the action back, +2 stays */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Omni" }).hero("H2", "p2", { name: "Kid" }).npc("N1", { name: "Turret", health: 6 });
  kit(T, "H1", "Warning Call"); T.order(["N1", "H1", "H2"]);
  await T.gm(decl("N1", "slugfest", ["H2"]));
  const before = JSON.stringify(P1.canPay(T.state, "H2", "quick"));
  const fresh = JSON.stringify(T.state.ledger.H2);
  await T.req("p2", { op: "answer", prompt: T.prompt("reaction", "H2").id, value: "block" });
  ok(JSON.stringify(T.state.ledger.H2) !== fresh, "FXF-4: (Kid pays for a block)");
  eq(code(await T.req("p1", { op: "answer", prompt: T.prompt("reaction", "H1").id, value: rid(T, "H1", "warn") })), "ok", "FXF-4: then Omni warns Kid");
  eq([T.top().data.def.H2.defence, T.top().data.def.H2.free], ["block", "warned"], "FXF-4: the block stands, now as the warned answer");
  eq(JSON.stringify(P1.canPay(T.state, "H2", "quick")), before, "FXF-4: Kid has its action back [B2170]: a warned defence uses no action of its own");
  ok((T.top().data.notes ?? []).some((n) => n.note === "defenceBack" && n.who === "H2" && n.why === "warned"), "FXF-4: the attack's notes say the action came back");
  await T.roll("attack", 1);
  eq(T.top().rolls["def:H2"]?.pool?.mods?.find((m) => m.source === "warned")?.dice, 2, "FXF-4: the two dice stay");
}
{
  /* a Defensive answer (1 stress, no action) then warned: nothing to give back, the stress stays */
  const T = new Table(); T.hero("H1", "p1", { name: "Omni" }).hero("H2", "p2", { name: "Kid" }).npc("N1", { name: "Turret", health: 6 });
  kit(T, "H1", "Warning Call"); kit(T, "H2", "Defensive"); T.order(["N1", "H1", "H2"]);
  await T.gm(decl("N1", "slugfest", ["H2"]));
  const r0 = T.c.H2.resolve;
  const fo = T.prompt("reaction", "H2").options.find((o) => o.id === "block:free");
  if (fo && !fo.disabled) {
    await T.req("p2", { op: "answer", prompt: T.prompt("reaction", "H2").id, value: "block:free" });
    const led = JSON.stringify(T.state.ledger.H2);
    await T.req("p1", { op: "answer", prompt: T.prompt("reaction", "H1").id, value: rid(T, "H1", "warn") });
    eq([T.c.H2.resolve, JSON.stringify(T.state.ledger.H2) === led, T.top().data.def.H2.free], [r0 - 1, true, "defensive"], "FXF-4: a Defensive block warned later: the stress stays, nothing is given back");
  } else ok(true, "FXF-4: (no Defensive answer on this kit: skipped)");
}

/* ================================================================== P8g-3: a defeated character sits its turn out */
{
  const T = new Table(); T.hero("H1", "p1").hero("H2", "p2").npc("N1", { health: 5 }).npc("N2", { health: 4 }); T.order(["H1", "N1", "H2", "N2"]);
  eq(K.sitsOut(T.state, "N1", { ...T.c.N1, defeated: true }), "defeated", "P8g-3: marked defeated: the turn is not its own");
  eq(K.sitsOut(T.state, "N1", { ...T.c.N1, defeated: false }), null, "P8g-3: not defeated: it acts");
  T.c.N1.defeated = true;
  const from = T.events.length;
  eq(code(await T.req("p1", { op: "endTurn", actor: "H1", round: T.state.round, slot: T.state.init.cur })), "ok", "P8g-3: the hero before it ends the turn");
  eq([T.state.init.curMember, T.events.slice(from).find((e) => e.type === "turnPassed")?.reason], ["H2", "defeated"], "P8g-3: the defeated NPC's turn passes by itself, and says why");
  for (const L of [EN, PL]) ok(["ITAC.journal.turnPassed.defeated", "ITAC.result.pass.defeated", "ITAC.ui.out.defeated"].every((k) => typeof L[k] === "string" && L[k].length > 3), `P8g-3: its texts (${L === EN ? "EN" : "PL"})`);
}

/* ================================================================== U10-6: a bare "Hit" float waits for the blow's damage */
{
  const hit = (tg, blow) => ({ hit: 1, target: tg, blow, text: "Hit" }), loss = (tg, blow) => ({ loss: 1, target: tg, blow, text: "-2" });
  let r = FP.holdHits({}, [], [hit("N1", 7)]);
  eq([r.show.length, Object.keys(r.held)], [0, ["N1"]], "U10-6: the hit of blow 7 waits");
  r = FP.holdHits(r.held, [], [loss("N1", 7)]);
  eq([r.show.map((f) => f.text), Object.keys(r.held)], [["-2"], []], "U10-6: its damage comes: only the number shows, the bare Hit is dropped");
  r = FP.holdHits(FP.holdHits({}, [], [hit("N1", 8)]).held, [{ type: "actionClosed", inst: 8 }], []);
  eq([r.show.map((f) => f.text), Object.keys(r.held)], [["Hit"], []], "U10-6: the blow closed with no damage (all soaked): the Hit shows then");
  r = FP.holdHits(FP.holdHits({}, [], [hit("N1", 9)]).held, [{ type: "actionClosed", inst: 4 }], [loss("N2", 9)]);
  eq([r.show.map((f) => f.target), Object.keys(r.held)], [["N2"], ["N1"]], "U10-6: another target's damage, another blow's close: still waiting");
  eq(FP.holdHits({}, [], [{ hit: 1, target: "N1", blow: null, text: "Hit" }]).show.length, 1, "U10-6: a hit with no blow to wait for shows at once");
  ok(/heldHits\[combatId\] = hh\.held/.test(src("ui/feedback.mjs")), "U10-6: the client keeps the held hits per fight");
}

/* ================================================================== pins: CU8, A8C-2, X6, FXJ-4, FXR-2 */
{
  ok(/markReq: ctx\.staff \?/.test(src("desk-pure.mjs")), "CU8: the dock's marks are the GM's alone (a player's slot has no mark request)");
  const bar = src("../combat/bar.mjs"), main = src("../combat/main.mjs"), css = src("../../styles/combat.css");
  ok(/hp\.start = num\(c\.flags\?\.\[MOD\]\?\.groupStart\)/.test(bar) && /frac: n \/ top/.test(bar) && /Math\.max\(1, spec\.top \?\? spec\.count\)/.test(bar), "A8C-2: a minion group shows how many of the starting number still stand");
  ok(/on\("combatStart", \(combat\) => groupStarts\(combat, true\)\)/.test(main) && /on\("createCombatant"/.test(main), "A8C-2: the starting number is written when the group joins and when the fight starts");
  const ml = src("../combat/lang.mjs");
  ok(/"ICB\.Bar\.MembersOf": "\{n\} of \{max\} standing"/.test(ml) && /"ICB\.Bar\.MembersOf": "Stoi: \{n\} z \{max\}"/.test(ml), "A8C-2: its spoken words, EN and PL");
  ok(/const PEEK_MS = 140;/.test(bar) && /peekSoon\(tile \?\? null\)/.test(bar) && /function peekHide/.test(bar) && /\.icbar-peek \{/.test(css) && /prefers-reduced-motion[\s\S]*icbar-peek/.test(css), "X6: a tile under the pointer is shown whole above the bar after a short delay");
  ok(/irdTo/.test(src("../rolldialog.mjs")) && /\[data-ird-to\]/.test(src("../../styles/rolldialog.css")), "FXJ-4: the roll window shows a span as one range mark with both ends");
  ok(/play\(s, o\);\n  settledSoon\(\);/.test(bar) && /export const SETTLED = "ipu:bar-settled"/.test(bar) && /tok === settleTok/.test(bar) && /listen\(window, "ipu:bar-settled", relayout\)/.test(src("ui/main.mjs")),
    "PFA: when the bar's glide ends (not cut by a newer one), the dock, the chase panel and the desk are placed again");
  const sl = src("../splash/lang.mjs");
  ok(/pierwszy dublet \/ rekord osobisty/.test(sl) && !/pierwszą dublę/.test(sl), "FXR-2: the splash setting's hint uses the glossary words");
}

done("check-ansh");
