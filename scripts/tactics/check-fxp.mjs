/* node scripts/tactics/check-fxp.mjs -- FIXER P (after UX review 2, tree tactics-sweep). One block per row; each fails on the code before
   its fix (tactics-sweep 793a14e) and pins the fix. Whole fights run through the REAL director, engine and view (testkit Table); what
   only Foundry runs is pinned by reading its source.
     D160  a hero owned by two players: the roll went to both owners, the first one online threw it and the acting owner could not push
     D161  stop / start of a fight: no GM control; the crew lost; the desk on its Table tab over waiting cards; the old summary stays
     D162  the player bar's turn label during a hidden combatant's turn
     D163  a hero's death: no card, no defeated mark, the rest heals the dead
     D164  Drive before the vehicle is started: an active Declare that does nothing
     D165  a passenger thrown out of a vehicle stays on its crew list
     U178  End turn while the dice fly: the next turn shows over the dice
     U179  an NPC turn that starts spent passes under the GM's hand
     U181  knockback: the landing never reaches the news line
     U182  Warning Call on every attack on an ally, also from a hidden attacker
     U183  the cost of Charge / boarding learned only after the click
     U184  the GM's move pick on a zone under a token selects that token */
import { readFileSync } from "node:fs";
import { Table, ok, eq, done } from "./testkit.mjs";
import * as E from "./engine-pure.mjs";
import * as V from "./view-pure.mjs";
import * as D from "./desk-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./ui/model-pure.mjs";
import * as N from "./ui/news-pure.mjs";
import { tIn } from "./lang.mjs";

const here = new URL(".", import.meta.url);
const src = (p) => readFileSync(new URL(p, here), "utf8");
const tr = (l) => (k, p = {}, f) => tIn(l, k, p, f);
const t = tr("pl");
const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const decl = (actor, action, targets, extra = {}) => ({ op: "declare", actor, decl: { action, targets, ...extra } });
const meta = (T) => ({ hidden: Object.keys(T.c).filter((id) => T.c[id].hidden), npc: Object.keys(T.c).filter((id) => T.c[id].npc) });
const pv = (T, u, owns) => V.viewFor(T.state, { id: u, staff: false, owns }, meta(T));
const facts = (T, view, me, staff = false) => ({ view, me, staff, c: (id) => (T.c[id] ? { name: T.c[id].name ?? id, npc: T.c[id].npc, img: null } : null), attrs: (id) => T.c[id]?.attrs ?? null, userName: (u) => `user-${u}`, preview: () => null });
const ctx = (T) => ({ c: (id) => T.c[id] ?? null, online: () => true, P1 });
const dock = (T, u, owns, own = {}) => { const v = pv(T, u, owns); return M.dockData(D.playerModel(v, { id: u, owns }, ctx(T)), own, facts(T, v, u), t); };
const rowsOf = (d) => [...(d.rolls ?? []), ...(d.panel?.rolls ?? [])];
const soft = (mod, n) => (typeof mod[n] === "function" ? mod[n] : () => undefined);      // a helper the fix added: the old tree FAILS, it does not stop
const co = (T, id, player, o = {}) => { T.add(id, { owners: ["p1", "p2"], ...o }); T.c[id].player = player; return T; };

/* ================================================================== D160: one roller, the acting seat */
{
  const T = new Table(); co(T, "K", "p2", { name: "Kid" }); T.hero("O", "p1", { name: "Omni" }).npc("N1", { name: "Doc", health: 9 }); T.order(["K", "N1", "O"]);
  eq(code(await T.req("p2", decl("K", "slugfest", ["N1"]))), "ok", "D160: (p2 declares Kid's slugfest)");
  for (const p of T.prompts("reaction")) await T.gm({ op: "answerFor", prompt: p.id, value: "pass" });
  eq(T.lastRequest()?.users, ["p2"], "D160: Kid's own attack roll goes to the seat that declared it alone, not to every owner");
  await T.roll("attack", 2, { pushable: true });
  const p2 = rowsOf(dock(T, "p2", ["K"]))[0], p1 = rowsOf(dock(T, "p1", ["K", "O"]))[0];
  eq(p2?.buttons.map((b) => b.id), ["accept", "push"], "D160: the acting owner gets Accept and Push (the card is his)");
  eq(p1?.buttons?.map((b) => b.id) ?? [], [], "D160: the other owner gets no Push / Accept he could not carry out");
  await T.roll("attack", 3, { author: "p1", pushed: 1, pushable: false });                 // a card by the other owner arrives
  eq(T.top()?.rolls?.attack?.sixes ?? T.state.stack.at(-1)?.rolls?.attack?.sixes, 2, "D160: and is not taken for the acting owner's roll");
}
{
  /* who throws a roll that is not the character's own action: its assigned player; nobody assigned: the one who declared, else the first online */
  const X = (users, c) => ({ facts: { user: (u) => users[u] ?? null, c: () => c } });
  const U = { p1: { id: "p1", active: true }, p2: { id: "p2", active: true }, p3: { id: "p3", active: false } };
  const K = { id: "K", owners: ["p1", "p2"], player: "p2" };
  eq(soft(E, "rollUsers")(X(U, K), K, { actor: "O", by: "p1" }), ["p2"], "D160: Kid's defence against Omni's player: Kid's assigned player throws it");
  eq(soft(E, "rollUsers")(X(U, K), K, { actor: "K", by: "p1" }), ["p1"], "D160: Kid's own action declared by the other owner: that owner throws (he is at the dock)");
  eq(soft(E, "rollUsers")(X(U, { ...K, player: null }), { ...K, player: null }, { actor: "N", by: "gm" }), ["p1"], "D160: nobody assigned: the first owner online");
  eq(soft(E, "rollUsers")(X(U, { ...K, player: "p3", owners: ["p3", "p2"] }), { ...K, player: "p3", owners: ["p3", "p2"] }, null), ["p2"], "D160: the assigned player is away: an owner at the table");
  eq(soft(E, "rollUsers")(X(U, { ...K, owners: ["p3"] }), { ...K, owners: ["p3"] }, null), ["gm"], "D160: no owner at the table: the GM's desk");
  ok(/player: Sys\.playerOf\(actor\)/.test(src("./engine.mjs")) && /export function playerOf\(actor\)[^\n]*u\.character\?\.id === id/.test(src("./system-adapter.mjs")), "D160: the executor's facts carry the assigned player (Foundry's user.character)");
}

/* ================================================================== D163: a hero's death is a step */
async function slain(answer, o = {}) {
  const T = new Table(o.opts ?? {}); T.hero("H1", "p1", { name: "Eve", health: 1, maxHealth: 6, crits: o.crits ?? [] }).npc("N1", { name: "Imm", health: 9, damage: 8 }); T.order(["N1", "H1"]);
  await T.gm(decl("N1", "slugfest", ["H1"]));
  let card = null;
  for (let i = 0; i < 12; i++) {
    const ps = T.prompts(), top = T.top(), owed = Object.entries(top?.rolls ?? {}).find(([, r]) => r.sixes == null);
    if (ps.length) { const p = ps[0]; if (p.kind === "heroDead") { card = p; if (!answer) break; } await T.req(p.to === "gm" ? "gm" : "p1", { op: p.to === "gm" ? "answerFor" : "answer", prompt: p.id, value: p.kind === "heroDead" ? answer : p.options?.find((x) => /pass/.test(x.id))?.id ?? p.options?.[0]?.id }); continue; }
    if (owed) { T.dice.push([6]); await T.roll(owed[0], owed[0] === "attack" ? 1 : 0); continue; }
    break;
  }
  return { T, card };
}
{
  const { T, card } = await slain(null);
  eq([card?.kind, card?.to, card?.about, card?.options?.map((x) => x.id), card?.data?.n], ["heroDead", "gm", "H1", ["dead", "cap9"], 13], "D163: an injury that kills a hero (13, [B2765]) stops on a GM card first: dies / injury 9 [B2767-2769]");
  eq([T.c.H1.crits, T.c.H1.defeated], [[], false], "D163: nothing is written while the card waits");
  ok(D.CARD_KINDS.includes("heroDead") && t("ITAC.card.heroDead") === "Śmierć" && tr("en")("ITAC.opt.cap9") === "Injury 9 instead", "D163: the card is a desk card with its words in both languages");
  const w = M.waitingData(D.playerModel(pv(T, "p1", ["H1"]), { id: "p1", owns: ["H1"] }, ctx(T)).waiting, facts(T, pv(T, "p1", ["H1"]), "p1"), t);
  ok(w.some((r) => r.gm && r.what.some((x) => /śmierć/.test(x))), "D163: the player's strip says the table waits for the GM's word on the death");
}
{
  const { T } = await slain("dead");
  eq([T.c.H1.crits, T.c.H1.defeated, (T.state.statuses?.H1 ?? []).map((s) => s.id)], [[13], true, ["broken", "dead"]], "D163: 'Dies': the injury is written, the hero is dead and marked defeated in the tracker");
  const tx = T.log.list[T.log.list.length - 1].id;
  await T.gm({ op: "undo", tx });
  eq([T.c.H1.crits, T.c.H1.defeated], [[], false], "D163: undo takes the death and the defeated mark back");
}
{
  const { T } = await slain("cap9");
  eq([T.c.H1.crits, T.c.H1.defeated, (T.state.statuses?.H1 ?? []).map((s) => s.id)], [[9], false, ["broken", "unconscious"]], "D163: 'Injury 9': the book's softer table, knocked out, not defeated");
}
{
  const { card } = await slain(null, { opts: { critCap9: true } });
  eq(card, null, "D163: a fight played with the family cap asks nothing (nobody dies of an injury)");
  const Sch = await import("./scheduler-pure.mjs");
  const facts0 = [{ id: "H1", type: "superhero", health: 0, maxHealth: 6, resolve: 3, maxResolve: 5, strength: 3 }, { id: "H2", type: "superhero", health: 0, maxHealth: 6, resolve: 3, maxResolve: 5, strength: 3 }];
  const st = { statuses: { H1: [{ id: "dead", source: { kind: "crit", name: "x" } }] } };
  eq(Sch.sceneEndPlan(facts0, st).map((l) => l.id), ["H2"], "D163: the rest after the fight heals nobody dead");
  ok(/sceneEndPlan\(Sys\.sceneFacts\(c\), Store\.stateOf\(c\)\)/.test(src("./api.mjs")) && /sceneEndPlan\(W\.ctx\.sceneFacts \?\? \[\], s\)/.test(src("./ops-pure.mjs")), "D163: both the GM's end dialog and the end itself read the plan with the fight's statuses");
}

/* ================================================================== D164: Drive is greyed with its reason until the vehicle runs */
{
  const T = new Table(); T.hero("H1", "p2", { name: "Kid" }).add("V", { name: "Van", kind: "vehicle", vehicle: { type: "ground", speed: 3, maneuver: 0, passengers: 3 } }).npc("N1"); T.order(["H1", "N1"]);
  T.state = { ...T.state, vehicles: { V: { driver: "H1", crew: [] } }, statuses: { ...(T.state.statuses ?? {}), H1: [{ id: "inVehicle", source: { kind: "gm", name: "vehicle" }, data: { vehicle: "V", role: "driver" } }] } };
  const bctx = { ...ctx(T), special: () => [{ id: "V", name: "Van", kind: "vehicle" }] };
  const act = (st, id) => D.barModel(pv({ ...T, state: st }, "p2", ["H1"]), "H1", bctx).actions.find((a) => a.id === id);
  eq([act(T.state, "vehicleHandle")?.disabled, act(T.state, "vehicleStart")?.disabled], ["notStarted", null], "D164: before the start, Drive is greyed with 'start the vehicle first' (Start is offered)");
  const run = { ...T.state, vehicles: { V: { driver: "H1", crew: [], started: 1 } } };
  eq(act(run, "vehicleHandle")?.disabled, null, "D164: once it runs, Drive is offered");
  eq(act({ ...T.state, vehicles: { V: { driver: "H1", crew: [], started: 1, off: { engine: 1 } } } }, "vehicleHandle")?.disabled, "engineDisabled", "D164: an engine out says so");
  ok(t("ITAC.reason.notStarted") === "najpierw uruchom pojazd", "D164: the reason is the drive flow's own word");
  /* a refusal of a zone declaration (drive, fastball) is shown for that zone: main.mjs keys it by `to`, the panel looked it up by the targets */
  const v = pv({ ...T, state: run }, "p2", ["H1"]), bar = D.barModel(v, "H1", bctx), a = bar.actions.find((x) => x.id === "vehicleHandle");
  const own = { armed: "vehicleHandle", to: "z7", refused: { action: "vehicleHandle", key: "z7", reason: "handledTwice", params: {} } };
  const d = M.dockData(D.playerModel(v, { id: "p2", owns: ["H1"] }, bctx), own, facts({ ...T, state: run }, v, "p2"), t);
  const panel = d.panel?.kind === "declare" ? d.panel : null;
  ok(!!a && !!panel && !!panel.refused?.reason && /ruszył/.test(panel.refused.reason) && !!panel.refused.submit, `D164: the engine's refusal of the drive to that zone stands in the panel with the way to ask (${JSON.stringify(panel?.refused ?? d.panel?.kind ?? null).slice(0, 120)})`);
}

/* ================================================================== D165: thrown out of a vehicle leaves its seat */
{
  const K = await import("./flows/kit.mjs");
  const T = new Table(); T.hero("E", "p3", { name: "Eve", zone: "z11" }).hero("H1", "p2", { zone: "z4" }).add("V", { kind: "vehicle", zone: "z4" }); T.order(["E", "H1"]);
  const seat = (id, role) => ({ id: "inVehicle", source: { kind: "gm", name: "vehicle" }, data: { vehicle: "V", role } });
  const state = { ...T.state, vehicles: { V: { driver: "H1", crew: ["E"], started: 1 } }, statuses: { E: [seat("E", "passenger")], H1: [seat("H1", "driver")] } };
  const vv = { state, facts: T.facts() };
  const fx = K.separated(vv, ["E"]);
  eq(fx, [{ t: "state", path: ["vehicles", "V"], to: { driver: "H1", crew: [], started: 1 } }, { t: "status-", who: "E", id: "inVehicle" }], "D165: a passenger knocked to another zone is off the crew list and loses the mark");
  T.c.E.zone = "z4";
  eq(K.separated(vv, ["E"]), [], "D165: one still where the vehicle is keeps the seat");
  T.c.H1.zone = "z9";
  eq(K.separated(vv, ["H1"])[0]?.to?.driver, null, "D165: a driver thrown out leaves the wheel empty");
  T.c.V.zone = "z9"; T.c.E.zone = "z9";
  eq(K.separated(vv, ["V", "H1", "E"]), [], "D165: the vehicle driven with everybody aboard parts nobody");
  ok(/K\.separated\(v, \[mv\.who\]\)/.test(src("./flows/move.mjs")), "D165: the forced move's landing runs the separation");
}

/* ================================================================== U181 + D165 on the map: an NPC's knockback throws a passenger out */
{
  const { MTable } = await import("./check-kit-map.mjs");
  const pass = async (T) => { for (const p of T.prompts("reaction")) await T.req(p.to === "gm" ? "gm" : p.to.users[0], { op: p.to === "gm" ? "answerFor" : "answer", prompt: p.id, value: "pass" }); };
  const mk = () => { const T = new MTable(); T.hero("E", "p3", { name: "Eve", health: 9 }).hero("H1", "p2", { name: "Kid" }).npc("N1", { name: "Imm", attrs: { strength: 2 }, health: 9 }).add("V", { name: "Van", kind: "vehicle", vehicle: { type: "ground", speed: 3, maneuver: 0, passengers: 3 } });
    T.put("E", "z2").put("H1", "z2").put("N1", "z2").put("V", "z2"); T.order(["N1", "E", "H1"]);
    const seat = (role) => ({ id: "inVehicle", source: { kind: "gm", name: "vehicle" }, data: { vehicle: "V", role } });
    T.state = { ...T.state, vehicles: { V: { driver: "H1", crew: ["E"], started: 1 } }, statuses: { ...(T.state.statuses ?? {}), E: [seat("passenger")], H1: [seat("driver")] } };
    return T; };
  const T = mk();
  await T.gm(decl("N1", "slugfest", ["E"])); await pass(T);
  await T.roll("attack", 2);
  for (const p of T.prompts()) if (p.kind !== "stunts") await T.req(p.to === "gm" ? "gm" : p.to.users[0], { op: p.to === "gm" ? "answerFor" : "answer", prompt: p.id, value: p.options?.find((o) => /pass|none/.test(o.id))?.id ?? p.options?.[0]?.id });
  const st = T.prompt("stunts");
  if (st) await T.gm({ op: "answerFor", prompt: st.id, value: ["knockback@E"] });
  const kd = T.prompt("knockDir");
  ok(!!kd && kd.to === "gm", "U181: (the GM names the NPC's knockback direction)");
  if (kd) await T.gm({ op: "answerFor", prompt: kd.id, value: "to:z1" });
  eq(T.prompt("direction"), null, "U181: a plain path of an NPC's knockback (on the map, no wall, on the ground) needs no second card");
  for (let i = 0; i < 6 && T.state.stack.length; i++) { const p = T.prompts()[0]; if (!p) break; await T.req(p.to === "gm" ? "gm" : p.to.users[0], { op: p.to === "gm" ? "answerFor" : "answer", prompt: p.id, value: p.options?.[0]?.id }); }
  eq([T.spot("E"), T.state.stack.length], ["z1", 0], "U181: Eve lands one zone toward z1 and the attack closes");
  eq([T.state.vehicles.V.crew, (T.state.statuses?.E ?? []).some((s) => s.id === "inVehicle")], [[], false], "D165: thrown out of the van: off its crew list, no seat mark");
  const row = (T.state.news ?? []).filter((n) => n.kind === "action" && n.actor === "N1").at(-1)?.rows?.find((r) => r.target === "E");
  eq([row?.land, row?.seat], ["z1", "V"], "U181: the attack's news row says where she landed and what threw her out");
  const v = pv(T, "p3", ["E"]), line = M.newsData(v, {}, { ...facts(T, v, "p3"), zoneName: (z) => z }, t);
  ok(/ląduje/.test(line?.text ?? "") && /wypada z pojazdu \(Van\)/.test(line?.text ?? ""), `U181: the players' news line tells the landing and the throw out of the vehicle (${line?.text})`);
  /* a hero's knockback: the GM still confirms the player's word on the path (spec 9.5 step 6) */
  const H = mk(); H.order(["E", "N1", "H1"]); H.state = { ...H.state, vehicles: { V: { driver: "H1", crew: [], started: 1 } }, statuses: {} };
  H.c.E.attrs.strength = 2;
  await H.req("p3", decl("E", "slugfest", ["N1"])); await pass(H); await H.roll("attack", 2);
  const sp = H.prompt("stunts"); if (sp) await H.req("p3", { op: "answer", prompt: sp.id, value: ["knockback@N1"] });
  const k2 = H.prompt("knockDir"); if (k2) await H.req("p3", { op: "answer", prompt: k2.id, value: "to:z1" });
  ok(!!H.prompt("direction"), "U181: a hero's knockback still goes to the GM's confirmation card");
}

/* ================================================================== U182: no Warning Call against an attacker the warner cannot see */
{
  const KP = await import("./kit-pure.mjs");
  const item = (id, name) => ({ id, name, type: "talent", level: null, power: null, boosts: [], autos: [], fx: [], flags: { kit: null, off: false, types: [] }, wf: {} });
  const team = (hidden) => { const T = new Table(); T.hero("H1", "p1", { name: "Omni" }).hero("H2", "p2", { name: "Kid" }).npc("N1", { name: "Turret", health: 6, hidden }); const c = T.c.H1; c.kit = KP.build({ items: [item("w1", "Warning Call")], attrs: c.attrs }); c.pass = c.kit.pass; T.order(["N1", "H1", "H2"]); return T; };
  const warns = (T) => (T.prompt("reaction", "H1")?.options ?? []).some((o) => String(o.id).endsWith("-warn") || /warn/.test(String(o.data?.effect ?? "")));
  const A = team(false); await A.gm(decl("N1", "slugfest", ["H2"]));
  ok(warns(A), "U182: (a turret everybody sees hits Kid: Omni may warn him [B2170])");
  const B = team(true); await B.gm(decl("N1", "slugfest", ["H2"]));
  eq(warns(B), false, "U182: a turret the GM hides hits Kid: Omni gets no Warning Call card (he cannot see the shot coming)");
  const C = team(false); C.state = { ...C.state, knowledge: { H1: { N1: "unseen" } } }; await C.gm(decl("N1", "slugfest", ["H2"]));
  eq(warns(C), false, "U182: nor against an attacker Omni has as unseen");
}

/* ================================================================== U179: a spent NPC turn waits for the GM's click on the GM seat */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Kid" }).hero("H2", "p2", { name: "Eve" }).npc("N1", { name: "Doc", health: 9 }).npc("N2", { name: "Mauler", health: 9 }); T.order(["H1", "H2", "N1", "N2"]);
  const blocked = async (h, u) => {      // a hero's attack the NPC blocks: its actions of the round go on reactions before its turn (D133)
    T.turn(h); await T.req(u, decl(h, "slugfest", ["N1"]));
    const p = T.prompt("reaction", "N1"); if (p) await T.answer("gm", "reaction", "block", "N1");
    for (let i = 0; i < 4; i++) { const k = Object.keys(T.top()?.rolls ?? {}).find((x) => T.top().rolls[x].sixes == null); if (!k) break; await T.roll(k, 0); }
  };
  await blocked("H1", "p1"); await blocked("H2", "p2");
  T.turn("N1");
  const b = P1.budget(T.state, "N1");
  const staffDock = (cid) => { const d = D.deskModel(T.state, T.log, ctx(T)); const bar = D.barModel(T.state, cid, { ...ctx(T), staff: true }); return M.dockData({ bars: [bar], prompts: [], mine: [], stack: d.info, waiting: d.waiting, turn: d.turn }, {}, facts(T, T.state, "gm", true), t); };
  const g = staffDock("N1");
  eq([b.full !== "open", g.onTurn, !!g.end.spent, g.end.auto, g.out?.reason, !!g.end.disabled, g.end.confirm], [true, true, true, false, "spent", false, false],
    "U179: an NPC turn that starts spent stands on the GM seat: marked spent, the bar says why, one click ends it, nothing passes by itself");
  ok(!!g.end.req, "U179: the GM's End turn carries its request");
  /* a player's own spent turn still passes by itself (D133 unchanged) */
  ok(/const autoEnd = auto && !\(spent && facts\.staff\)/.test(src("./ui/model-pure.mjs")), "U179: the rule is the seat's: staff only");
}

/* ================================================================== D162: the bar's spoken line during a turn this client may not see */
{
  const b = src("../combat/bar.mjs");
  ok(/function say\(text\) \{\s*if \(live && text === null\) \{ clearTimeout\(liveTimer\); live\.textContent = ""; return; \}/.test(b), "D162: say(null) empties the live region (it is not 'say nothing new')");
  ok(/if \(act && \(loud \|\| sameCombat\)\) say\([^\n]*\n\s*else if \(!act && !model\.waiting\) say\(null\);/.test(b), "D162: a new turn of a combatant hidden from this client clears the last turn's words");
}

/* ================================================================== U178: End turn pressed while the dice fly is sent when they land */
{
  const f = soft(N, "endAfterDice"), req = { op: "endTurn", actor: "H1", round: 2, slot: "s1" };
  eq([f(req, { busy: true, since: 1000, at: 1900 }), f(req, { busy: false, since: null, at: 1900 }), f(req, { busy: true, since: 1000, at: 1000 + N.HOLD_MS + 1 }), f({ op: "declare" }, { busy: true, since: 1000, at: 1900 })],
    [true, false, false, false], "U178: End turn waits for dice in the air (0.9 s after a push), not when none fly, not past HOLD_MS, nothing else waits");
  const m = src("./ui/main.mjs"), at = m.indexOf("async function send(");
  ok(at > 0 && /if \(NewsP\.endAfterDice\(req, \{ busy: diceBusy\(\)[^\n]*\)\) await diceLanded\(\);/.test(m.slice(at, at + 400)), "U178: main.mjs send() holds the End turn request until the dice land, before it reaches the executor");
}

/* ================================================================== D160 (live): the co-owner's Push / Accept on another's roll card */
{
  const RW = await import("./rollwatch-pure.mjs"), { EN, PL } = await import("./lang.mjs"), f = soft(RW, "cardOther");
  eq([f("u1", "u2", false), f("u1", "u1", false), f("u1", "gm", true), f(null, "u2", false)], [true, false, false, false], "D160: another player's roll card: its buttons are not this seat's (the GM keeps them)");
  ok(/const other = !off && RW\.cardOther\(msg\?\.author\?\.id, game\.user\.id, Store\.isStaff\(game\.user\)\);/.test(src("./ui/main.mjs")) && /b\.disabled = off \|\| other;/.test(src("./ui/main.mjs")), "D160: main.mjs greys them with a word why");
  ok("ITAC.ui.chat.notYours" in EN && "ITAC.ui.chat.notYours" in PL, "D160: the word why in English and Polish");
}

/* ================================================================== D161: the vehicle crew outlives a stop and a restart */
{
  const O = await import("./ops-pure.mjs"), S = await import("./state-pure.mjs");
  const T = new Table(); T.hero("H1", "p1", { name: "Eve" }).hero("H2", "p2", { name: "Kid" }).npc("N1", { name: "Doc", health: 9 });
  T.add("V1", { kind: "vehicle", npc: true, health: 8, vehicle: { type: "ground", speed: 3, maneuver: 1, passengers: 3, weapons: 0 } }); T.order(["H1", "H2", "N1"]);
  const seat = (vid, role) => ({ id: "inVehicle", source: { kind: "gm", name: "vehicle" }, data: { vehicle: vid, role } });
  const s0 = JSON.parse(JSON.stringify(T.state));
  s0.vehicles = { V1: { driver: "H1", crew: ["H2"], started: 1 } };
  s0.statuses = { ...(s0.statuses ?? {}), H1: [seat("V1", "driver")], H2: [seat("V1", "passenger")] };
  const crew = soft(S, "crewOf")(s0);
  eq([crew?.vehicles?.V1?.driver, crew?.vehicles?.V1?.crew, Object.keys(crew?.seats ?? {}).sort()], ["H1", ["H2"], ["H1", "H2"]], "D161: crewOf keeps the vehicles' records and the inVehicle marks");
  const ctx = { user: "gm", staff: true, owns: () => true, hold: true, parts: T.parts(), rng: () => 0.5 };
  const seated = (s) => [s?.vehicles?.V1?.driver ?? null, s?.vehicles?.V1?.crew ?? [], (s?.statuses?.H1 ?? []).some((x) => x.id === "inVehicle" && x.data?.role === "driver"), (s?.statuses?.H2 ?? []).some((x) => x.id === "inVehicle")];
  const r1 = O.reduce(s0, O.normalize({ op: "start", mode: "tactical", restart: true }, { staff: true }).action, ctx);
  eq([r1.ok !== false, r1.state?.round, ...seated(r1.state)], [true, 1, "H1", ["H2"], true, true], "D161: a restart of a running fight: round 1 again, the crew still sits (Eve drives)");
  const r2 = O.reduce(null, O.normalize({ op: "start", mode: "tactical", crew }, { staff: true }).action, ctx);
  eq(seated(r2.state), ["H1", ["H2"], true, true], "D161: a start after a stop sits the crew kept by the stop");
  const gone = { ...ctx, parts: T.parts().filter((p) => p.id !== "H2") };
  eq(seated(O.reduce(null, O.normalize({ op: "start", mode: "tactical", crew }, { staff: true }).action, gone).state), ["H1", [], true, false], "D161: one no longer in the fight is not sat again");
  const st = src("./store.mjs"), en = src("./engine.mjs");
  ok(/const was = stateOf\(combat\), crew = was \? S\.crewOf\(was\) : null;/.test(st) && /tactics\.crew`\]: crew \? JSON\.stringify\(crew\) : ""/.test(st), "D161: the store keeps the seats when the state is cleared (stop)");
  ok(/r\.op === "start"\) r = \{[^\n]*crew: Store\.crewKept\(combat\)/.test(en), "D161: the executor hands the kept seats to the next start");
}

/* ================================================================== D161 / U180: the desk after a restart; the GM's stop and start again */
{
  const FB = await import("./ui/feedback-pure.mjs"), { EN, PL } = await import("./lang.mjs");
  const fresh = soft(M, "freshCards");
  eq([fresh(null, ["c1", "c2"]), fresh(["c1"], ["c1"]), fresh(["c1"], ["c1", "c2"]), fresh(null, [])], [true, false, true, false],
    "D161: the first look at a fight with cards waiting brings the Now tab forward (a restart opened on the Table tab over two cards)");
  ok(/fresh = Model\.freshCards\(cardsWere, ids\);/.test(src("./ui/main.mjs")), "D161: main.mjs takes the Now tab forward by that rule");
  const stale = soft(FB, "sumStale"), card = { id: "f:C1" };
  eq([stale(card, "C1", { phase: "turns", round: 1 }), stale(card, "C1", { phase: "sceneEnd", round: 3 }), stale(card, "C1", null), stale({ id: "r:C1:2" }, "C1", { phase: "turns", round: 1 }), stale(card, "C2", { phase: "turns", round: 1 })],
    [true, false, false, false, false], "D161: the stopped fight's summary goes when the same Combat fights again, not while the scene's end stands, not with no fight");
  ok(/if \(sum && FP\.sumStale\(sum\.card, combat\.id, view\)\) \{ clearTimeout\(sumTimer\); sum = null; \}/.test(src("./ui/feedback.mjs")), "D161: feedback.mjs drops it at the next redraw");
  const T = new Table(); T.hero("H1", "p1", { name: "Eve" }).npc("N1", { name: "Doc", health: 9 }); T.order(["H1", "N1"]);
  const gmFacts = facts(T, T.state, "gm", true), dd = (own) => M.deskData(D.deskModel(T.state, T.log, ctx(T)), own, gmFacts, t);
  const f0 = dd({}).fight;
  eq(f0?.cmds?.map((c) => [c.id, c.label, c.confirm, c.armed, JSON.stringify(c.req)]), [["restart", "Zacznij od nowa", true, false, '{"op":"start","restart":true}'], ["stop", "Zatrzymaj walkę", true, false, '{"op":"stop"}']],
    "U180: the Table tab offers Start again and Stop the fight, each asking first");
  eq(dd({ sure: "fight:restart" }).fight?.cmds?.map((c) => [c.id, c.armed]), [["restart", true], ["stop", false]], "U180: the first click arms it (Sure?), the second sends it");
  ok(/d\.fight \? foldSec\("fight"[^\n]*\n[^\n]*c\.confirm && !c\.armed \? set\(\{ sure: `fight:\$\{c\.id\}` \}\) : send\(c\.req, \{ sure: null, tab: "now" \}\)/.test(src("./ui/desk.mjs")), "U180: desk.mjs draws them with the desk's own buttons in a section of the Table tab");
  for (const k of ["ITAC.ui.fight.title", "ITAC.ui.fight.restart", "ITAC.ui.fight.stop", "ITAC.ui.fight.hint"]) ok(k in EN && k in PL && EN[k] !== PL[k], `U180: ${k} in English and Polish`);
  ok(/tactics\.crew`\]: crew \? JSON\.stringify\(crew\) : "", round: 0, turn: null \}/.test(src("./store.mjs")), "U180: a stopped fight is not started any more (the tracker offers its begin, which starts it again with the crew)");
  const T2 = new Table(); T2.hero("H1", "p1").npc("N1", { health: 9 }); T2.order(["H1", "N1"]);
  eq(code(await T2.gm({ op: "start", restart: true })), "ok", "U180: the GM's Start again is a request the executor takes while a fight runs");
  eq([T2.state?.round, code(await T2.gm({ op: "stop" })), T2.state ?? null], [1, "ok", null], "U180: the GM's Stop the fight clears the state");
}

/* ================================================================== U183: what a charge takes is on the bar before the click */
{
  const { MTable } = await import("./check-kit-map.mjs");
  const T = new MTable(); T.hero("H1", "p1", { name: "Omni", attrs: { strength: 6 } }).npc("N1", { name: "Doc", health: 9 }); T.put("H1", "z1").put("N1", "z3"); T.order(["H1", "N1"]);
  const cx = { c: (id) => T.c[id] ?? null, online: () => true, P1 };
  const charge = () => D.barModel(T.state, "H1", cx).actions.find((x) => x.id === "charge");
  const a0 = charge();
  eq([a0?.disabled ?? null, a0?.also ?? null], [null, "quick"], "U183: a fresh turn: the charge is offered, named as a full AND a quick action");
  const bar = D.barModel(T.state, "H1", cx), d = M.dockData({ bars: [bar], prompts: [], mine: [], stack: [], waiting: [], turn: { combatant: "H1", name: "Omni", round: 1 } }, {}, facts(T, T.state, "p1"), t);
  const it = (d.groups ?? []).flatMap((g) => g.items ?? []).find((x) => x.id === "charge") ?? null;
  ok(!!it && /Pełna akcja \+ Szybka akcja|pełna akcja \+ szybka akcja/i.test(`${it.costText} ${it.tip?.cost}`) && (it.tip?.price?.parts ?? []).map((p) => p.mark).join(",") === "full,quick",
    `U183: the bar's button says both units in words and in marks (${it?.costText} | ${it?.tip?.cost})`);
  eq(code(await T.req("p1", { op: "declare", actor: "H1", decl: { action: "move", targets: [], to: "z2" } })), "ok", "U183: (a move takes the quick action)");
  eq(charge()?.disabled ?? null, "chargeActions", "U183: after the quick action is used, the charge is greyed with its reason BEFORE the click");
  eq((await T.req("p1", decl("H1", "charge", ["N1"]))).error?.params?.reason, "chargeActions", "U183: the bar says what the engine says");
}

done("check-fxp");
