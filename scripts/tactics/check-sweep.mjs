// node scripts/tactics/check-sweep.mjs -- SWEEP-T: the findings of the whole-codebase read that were held back for a rules or visibility
// judgement (S063 ... S089). One block per finding that turned out a defect; each fails on the code before its fix. The blocks that
// need the DOM or Foundry run against a scripted stand-in (pick.mjs, dom.mjs), or read the source where nothing can run in node.
import { readFileSync } from "node:fs";
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import * as C from "./catalog-pure.mjs";
import * as K from "./kit-pure.mjs";
import * as FK from "./flows/kit.mjs";
import * as P1 from "./economy-pure.mjs";
import * as Lg from "./ledger-pure.mjs";
import * as S from "./state-pure.mjs";
import * as V from "./view-pure.mjs";
import * as D from "./desk-pure.mjs";
import * as R from "./relay-pure.mjs";
import * as FP from "./ui/feedback-pure.mjs";
import { movementOf } from "./moves-pure.mjs";
import { roll } from "./flows/simple.mjs";
import { objective } from "./flows/challenge.mjs";
import { drive } from "./flows/vehicle.mjs";
import { travel } from "./flows/move.mjs";
import { EN, PL } from "./lang.mjs";

const src = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const code = (env) => env?.error?.code ?? (env?.ok ? (env.changed === false ? "ok(unchanged)" : "ok") : "?");
const why = (env) => env?.error?.params?.reason ?? null;
const decl = (actor, action, extra = {}) => ({ op: "declare", actor, decl: { action, ...extra } });
const vOf = (T) => { const f = T.facts(); return { state: T.state, facts: f, entry: (i) => C.entryFor(T.state, i.actor, i.action, f) }; };
const rolls = (R0) => R0.effects.filter((e) => e.t === "roll");

/* ================================================================== S074: Exhausting Blast / Distress cost 1 stress a use [B1587], [B1597] */
{
  const LV = ["basic", "major", "massive", "monstrous"];
  const auto = (id, name, type, o = {}) => ({ id, name, type, show: o.show !== false, attr: o.attr ?? [], bonus: 0, stress: 0, damage: o.damage ?? 0, min: 0, max: o.max ?? 0, bypass: false });
  const item = (id, name, type, o = {}) => ({ id, name, type, level: null, power: o.power ?? null, boosts: o.boosts ?? [], autos: o.autos ?? [], fx: [], flags: { kit: null, off: false, types: [] }, wf: {} });
  const power = (id, name) => item(id, name, "power", { autos: LV.map((lv, i) => auto(`${id}${i}`, `${name} - ${lv[0].toUpperCase()}${lv.slice(1)}`, "rollAttack", { attr: ["agility"], damage: 3 + i, max: 3 + i, show: i === 0 })) });
  for (const [p, l] of [["Blast", "Exhausting Blast"], ["Distress", "Exhausting Distress"]]) {
    const plain = K.build({ items: [power("pw", p)], attrs: {} }).weapons[0];
    const kit = K.build({ items: [{ ...power("pw", p), boosts: ["lm"] }, item("lm", l, "limit", { power: "pw" })], attrs: {} });
    eq([plain.stress, kit.weapons.length, kit.weapons[0].stress], [0, 1, 1], `S074: ${p} with ${l} costs 1 stress a use`);
  }
}

/* ================================================================== S085: a stored tally keeps its fight's tag */
{
  const raw = { combat: "c1", fight: "F1", entries: { 1: { round: 1, actor: "a", undone: 0, rows: [{ target: "b", hit: true }] } } };
  const back = FP.tallyOf(JSON.parse(JSON.stringify(raw)), "c1");
  eq(back?.fight, "F1", "S085: the tally read back from storage carries its fight's tag");
  const next = FP.tallyAdd(back, "c1", [{ id: "n1_F2", kind: "action", round: 1, actor: "x", rows: [{ target: "y", hit: true }] }]);
  eq([next.fight, Object.keys(next.entries).length], ["F2", 1], "S085: a fight started again on the same Combat after a reload starts its own tally");
  eq([FP.tallyOf(raw, "c2"), FP.tallyOf({ combat: "c1", entries: [] }, "c1"), FP.tallyOf(null, "c1")], [null, null, null], "S085: another combat's tally, or junk, is not read");
  ok(/FP\.tallyOf\(/.test(src("./ui/feedback.mjs")), "S085: loadTally reads through tallyOf");
}

/* ================================================================== S088: every extra unit a grant can carry has a name */
for (const u of S.GRANT_UNITS.filter((x) => !["A", "B", "full", "quick"].includes(x))) ok(!!EN[`ITAC.ui.pip.${u}`] && !!PL[`ITAC.ui.pip.${u}`], `S088: the unit "${u}" of an extra has a name in both languages`);

/* ================================================================== S070 / S068: the roll and objective flows count a Supportive helper and keep the no-push rules */
{
  const T = new Table(); T.hero("H1", "p1").hero("H2", "p2").npc("N1").add("CH1", { npc: true, kind: "challenge" }); T.order(["H1", "N1", "H2"]).turn("H1");
  T.c.H2.pass = { supportive: true };
  const ord = { id: "a1", actor: "H1", action: "orders", flow: "roll", data: {}, rolls: {}, decl: { action: "orders", targets: ["H2"], helpers: [{ id: "H2", consent: "yes" }], tokens: [] } };
  const obj = { id: "a2", actor: "H1", action: "objective", flow: "objective", data: {}, rolls: {}, decl: { action: "objective", attr: "agility", targets: ["CH1"], helpers: [{ id: "H2", consent: "yes" }], tokens: [] } };
  const help = (p) => p.pool.mods.find((m) => m.source === "help")?.dice ?? 0;
  eq([help(roll.preview(vOf(T), ord)), help(objective.preview(vOf(T), obj))], [2, 2], "S070: a Supportive helper gives +2 dice to a roll and to an objective [B2167]");
  eq([rolls(roll.steps.roll(vOf(T), ord))[0].maxPush, rolls(objective.steps.roll(vOf(T), obj))[0].maxPush], [null, null], "S068: a hero may push both");
  T.c.H1.pass = { overconfident: true };
  eq([rolls(roll.steps.roll(vOf(T), ord))[0].maxPush, rolls(objective.steps.roll(vOf(T), obj))[0].maxPush], [0, 0], "S068: Overconfident above half Health pushes neither [B2186]");
  T.c.H1.pass = {}; T.c.H1.health = 3;
  eq(rolls(objective.steps.roll(vOf(T), obj))[0].maxPush, null, "S068: (at half Health or below the push is back)");
  const N = { ...obj, actor: "N1" };
  T.state = { ...T.state, npc: { ...(T.state.npc ?? {}), N1: { push: "never" } } };
  eq(rolls(objective.steps.roll(vOf(T), N))[0].maxPush, 0, "S068: an NPC the GM set to never push does not push an objective roll");
}

/* ================================================================== S067: a Barrier is Armor against a blast, and a blast that gets through breaches it [B1859], [R13] */
{
  const HT = class extends Table {};
  const T = new HT(); T.hero("H1", "p1", { zone: "z1" }).npc("N1", { health: 6, zone: "z1" }); T.order(["H1", "N1"]).turn("H1");
  eq(code(await T.gm({ op: "effectAdd", effect: { kind: "barrier", holder: "N1", data: { armor: 2 }, source: { kind: "power", owner: "H1", name: "Barrier" } } })), "ok", "S067: (a Barrier of Armor 2 on N1)");
  T.dice.push([6, 3, 3, 2, 1, 4]);                                // one six: Damage 3, nobody doubled
  await T.gm({ op: "hazardRun", run: { type: "blast", rating: 6 }, subject: { zone: "z1" } });
  for (let n = 0; n < 6 && T.prompts().length; n++) { const p = T.prompts()[0]; await T.gm({ op: "answerFor", prompt: p.id, value: p.options.find((o) => o.id === "pass")?.id ?? p.options[0].id }); }
  eq([T.c.N1.health, T.state.effects.filter((e) => e.kind === "barrier").length], [5, 0], "S067: Damage 3 against the Barrier's Armor 2 leaves 1, and the breached Barrier is gone");
}

/* ================================================================== S078: Gliding limits Flight only [B2004] */
{
  const FLIGHT = "Compendium.invincible-core.powers.Item.E6B4T5jbhoxFOqRC", LEAP = "Compendium.invincible-core.powers.Item.XH6BNrsuvt6H7BvT", GLIDE = "Compendium.invincible-core.limits.Item.qXCQsdc6tlqalEcX";
  const PORT = "Compendium.invincible-core.boosts.Item.dntiWPrtTegqNRAi", TELE = "Compendium.invincible-core.powers.Item.JeaiOHbh5MSrPakm";
  const m = movementOf([{ id: "f", name: "Flight", type: "power", src: FLIGHT, boosts: ["g"] }, { id: "g", name: "Gliding", type: "limit", src: GLIDE }, { id: "l", name: "Leaping", type: "power", src: LEAP },
    { id: "t", name: "Teleportation", type: "power", src: TELE, boosts: ["a"] }, { id: "a", name: "Teleport Allies", type: "boost", src: PORT }]);
  const of = (mode) => m.find((x) => x.mode === mode);
  eq([of("flight").limits, of("leaping").limits, of("leaping").boosts, of("teleportation").boosts], [["gliding"], [], [], ["teleportAllies"]], "S078: a limit or boost changes the way of moving it belongs to, no other");
}

/* ================================================================== S071: a drive ends the grapple of an occupant with somebody left behind [B2497] */
{
  const T = new Table(); T.hero("H1", "p1").npc("N1").add("V1", { npc: true, kind: "vehicle" }); T.order(["H1", "N1"]).turn("H1");
  await T.gm({ op: "statusAdd", combatant: "H1", status: { id: "grappling", data: { held: "N1" } } });
  await T.gm({ op: "statusAdd", combatant: "N1", status: { id: "grappled", data: { by: "H1" } } });
  const at = { V1: "z3", H1: "z3", N1: "z1" }, v = vOf(T); v.facts = { ...v.facts, zones: { place: (id) => ({ spot: at[id] }) } };
  const inst = { id: "d1", actor: "H1", action: "vehicleHandle", flow: "drive", data: { mv: { who: "V1", driver: "H1", from: "z1", to: "z3", group: ["H1"] } }, rolls: {}, decl: { action: "vehicleHandle" } };
  const out = drive.steps.arrive(v, inst);
  eq(out.effects.filter((e) => e.t === "status-").map((e) => [e.who, e.id]).sort(), [["H1", "grappling"], ["N1", "grappled"]], "S071: the driver who drove off holds nobody left behind");
}

/* ================================================================== S073: the driver rolls a driven vehicle out of the dark, with its Maneuverability [B1654], [B2940] */
{
  const T = new Table(); T.hero("H1", "p1", { attrs: { agility: 4 } }).npc("N1").add("V1", { npc: true, kind: "vehicle", vehicle: { maneuver: 2 } }); T.order(["H1", "N1"]).turn("H1");
  const inst = { id: "d2", actor: "H1", action: "vehicleHandle", flow: "drive", rolls: {}, decl: { action: "vehicleHandle" },
    data: { mv: { who: "V1", driver: "H1", from: "z1", to: "z2", zones: ["z1", "z2"], group: [], seg: 0, cleared: {} }, res: { "seg:0": { ok: true, spot: "z1", stop: { reason: "ipu.dark", data: { spot: "z1" } }, left: ["z1", "z2"] } } } };
  const run = (owner) => { const v = vOf(T); v.facts = { ...v.facts, zones: { states: () => [{ id: "d1", kind: "dark", owner }] } }; const I = FK.draft(inst), R0 = FK.result(I); travel(v, I, R0); return { r: rolls(R0)[0], I }; };
  const { r } = run("N1");
  eq([r?.who, r?.attr, r?.pool.base, r?.pool.mods.find((x) => x.source === "maneuverability")?.dice, r?.maxPush], ["H1", "agility", 4, 2, null], "S073: the driver's AGILITY plus the vehicle's Maneuverability, pushed like any active move (ANSF: A11 + SWEEP-R7, the user 2026-11-12; was: not pushed)");
  const own = run("H1");
  eq([own.r ?? null, !!own.I.data.mv.cleared["dark:z1"]], [null, true], "S073: a driver who made the darkness is not held by it [B1654]");
}

/* ================================================================== S076: what is done in a commanded turn is not the own turn's [B1761] */
{
  const F = { cost: "full", onTurn: true }, Q = { cost: "quick", onTurn: true };
  let L = Lg.turnStart(Lg.newLedger(1)).ledger;
  L = Lg.pay(L, Q, { action: "move", tags: ["move"], borders: 1 }).ledger; L = Lg.turnEnd(L);
  L = Lg.addTurnPair(L, "x9", "mindControl", "ctrl"); L = Lg.turnStart(L, { extra: "x9" }).ledger;
  L = Lg.pay(L, F, { action: "slugfest", tags: ["attack"] }).ledger; L = Lg.pay(L, Q, { action: "move", tags: ["move"], borders: 2 }).ledger;
  eq([Lg.history(L, "thisTurn", "moved"), Lg.history(L, "thisTurn", "attacked"), Lg.history(L, "round", "moved"), Lg.history(L, "round", "attacked")], [1, false, 3, true], "S076: the commanded turn's move and attack count for the round, not for the own turn");
  let U = Lg.turnStart(Lg.newLedger(1)).ledger; U = Lg.turnSuspend(U);
  U = Lg.addTurnPair(U, "x8", "gm", "gm"); U = Lg.turnStart(U, { extra: "x8" }).ledger; U = Lg.pay(U, Q, { action: "move", tags: ["move"] }).ledger; U = Lg.turnEnd(U);
  ok(!Lg.turnUsed(U), "S076: an inserted turn does not use the own turn that was handed on [B2282]");
}

/* ================================================================== S063 / S064: GM-run trigger items, and asking again after a "deny" */
{
  const T = new Table(); T.hero("H1", "p1").hero("H2", "p2").npc("N1"); T.order(["N1", "H1", "H2"]);
  await T.gm({ op: "triggerAdd", trigger: { at: "turnStart", subject: { combatant: "H1" }, run: { type: "gm" }, source: { kind: "gm", name: "toxin" } } });
  await T.gm({ op: "endTurn", actor: T.state.init.curMember, force: true });
  const q = T.prompts("triggerQueue")[0];
  await T.gm({ op: "answerFor", prompt: q.id, value: { order: q.options.map((o) => o.id), skip: [] } });
  const I = T.state.stack.find((i) => i.cause === "trigger" && i.actor === "H1");
  ok(!!I, "S063: (the trigger put a GM item about H1 on the stack)");
  eq([code(await T.req("p1", { op: "cancel", inst: I.id })), code(await T.req("p1", { op: "amend", inst: I.id, decl: { action: "other", text: "nothing" } }))], ["notOwner", "notOwner"], "S063: the owner neither cancels nor rewrites what a trigger brought");
  ok(T.state.stack.some((i) => i.id === I.id) && T.state.stack.find((i) => i.id === I.id).decl.text === "toxin", "S063: the GM's item stands as it was");
  const mine = D.playerModel(V.viewFor(T.state, { id: "p1", staff: false, owns: ["H1"] }, { hidden: [], npc: ["N1"] }), { id: "p1", staff: false, owns: ["H1"] }, {}).mine.find((m) => m.inst === I.id);
  eq(mine?.commands ?? null, [], "S063: and the player's desk offers no Change or Cancel on it");
  eq(code(await T.gm({ op: "cancel", inst: I.id })), "ok", "S063: the GM still can");
}
{
  const T = new Table(); T.hero("H1", "p1").npc("N1", { health: 6 }); T.order(["H1", "N1"]).turn("H1");
  await T.req("p1", decl("H1", "slugfest", { targets: ["N1"] }));
  for (let n = 0; n < 6 && T.prompts().length; n++) { const p = T.prompts()[0]; await T.gm({ op: "answerFor", prompt: p.id, value: p.options.find((o) => o.id === "pass")?.id ?? p.options[0].id }); }
  const I = T.top();
  ok(I?.locked === true, "S064: (the attack is locked at its roll)");
  await T.req("p1", { op: "cancel", inst: I.id });
  const ask1 = T.prompts("exception").find((p) => p.data?.reason === "cancelLocked");
  ok(!!ask1, "S064: cancelling a locked action asks the GM");
  await T.req("p1", { op: "cancel", inst: I.id });
  eq(T.prompts("exception").filter((p) => p.data?.reason === "cancelLocked").length, 1, "S064: one card at a time");
  await T.gm({ op: "answerFor", prompt: ask1.id, value: "deny" });
  ok(!T.prompts("exception").some((p) => p.data?.reason === "cancelLocked"), "S064: (the GM said no)");
  await T.req("p1", { op: "cancel", inst: I.id });
  const ask2 = T.prompts("exception").find((p) => p.data?.reason === "cancelLocked");
  ok(!!ask2 && ask2.id !== ask1.id, "S064: after a no the player may ask again: a new card");
}

/* ================================================================== S066: an item is picked up where it lies [B2316] */
{
  const T = new Table(); T.hero("H1", "p1", { zone: "z1" }).npc("N1"); T.order(["H1", "N1"]).turn("H1");
  await T.gm({ op: "itemState", item: { id: "far", name: "pipe", owner: "N1", state: "ground", zone: "z4" } });
  await T.gm({ op: "itemState", item: { id: "near", name: "bat", owner: "N1", state: "ground", zone: "z1" } });
  const r = await T.req("p1", decl("H1", "pickUp", { item: "far" }));
  eq([code(r), why(r), r.error?.params?.gmMayAllow], ["illegal", "noItem", 1], "S066: an item in another zone is not within reach (the GM may allow)");
  eq([code(await T.req("p1", decl("H1", "pickUp", { item: "near" }))), T.state.items.find((i) => i.id === "near").holder], ["ok", "H1"], "S066: one in the zone is picked up");
}

/* ================================================================== S065: a vehicle or challenge whose token is hidden is concealed */
{
  ok(V.concealed({ hidden: false }, { hidden: true }) && V.concealed({ hidden: true }, null) && !V.concealed({ hidden: false }, { hidden: false }), "S065: concealed by the combatant's flag or the token's");
  const line = src("./engine.mjs").split("\n").find((l) => l.includes("special: () =>"));
  ok(!!line && /V\.concealed\(cb, tokenOf\(cb\)\)/.test(line) && !/!cb\.hidden\b/.test(line), "S065: context().special leaves out what is concealed by its token too");
}

/* ================================================================== S081: the executor says it took a request; the requester then waits for the work */
{
  const pending = new Map([["7ab", { nonce: "n1" }]]);
  const wip = R.makeWorking({ id: "7ab", n: "n1", to: "p1" });
  eq([wip.k, R.acceptWorking(wip, { me: "p1", pending, senderIsGM: true })], ["tcwip", "7ab"], "S081: a working word for my pending request is taken");
  eq([R.acceptWorking(wip, { me: "p1", pending, senderIsGM: false }), R.acceptWorking({ ...wip, n: "zz" }, { me: "p1", pending, senderIsGM: true }), R.acceptWorking(wip, { me: "p2", pending, senderIsGM: true })], [null, null, null], "S081: only from a GM, with the nonce, to me");
  ok(R.LIMITS.working > R.LIMITS.timeout, "S081: the work may take longer than the wait for a GM");
  const rs = src("./relay.mjs");
  ok(rs.indexOf("R.makeWorking(") > 0 && rs.indexOf("R.makeWorking(") < rs.indexOf("await Engine.exec(game.users.get(a.user.id)"), "S081: the executor sends it before carrying the request out");
  ok(/R\.acceptWorking\(/.test(rs) && /working: \(\) =>/.test(rs), "S081: the requester's timer moves on to the working limit");
}

/* ================================================================== S087: a word tooltip is text, not markup (Foundry reads data-tooltip as HTML) */
{
  const el = () => ({ dataset: {}, attrs: {}, className: "", setAttribute(k, v) { this.attrs[k] = v; }, append() {}, addEventListener() {} });
  globalThis.document = { createElement: () => el(), createTextNode: (t) => ({ t }) };
  const Dom = await import("./ui/dom.mjs");
  eq(Dom.h("span", { tip: "Tom <b>&</b> Jerry" }).dataset.tooltip, "Tom &lt;b&gt;&amp;&lt;/b&gt; Jerry", "S087: a name with markup reads as written");
  eq(Dom.h("span", { tip: ["a<b", "c&d"] }).dataset.tooltip, "a&lt;b<br>c&amp;d", "S087: the older news lines, each escaped, one under the other");
  const dk = src("./ui/dock.mjs");
  ok(!/older\.join\("<br>"\)/.test(dk) && !/\]\.join\("<br>"\)/.test(dk), "S087: the dock joins no raw lines into a tooltip");
}

/* ================================================================== S089: a click on a token picks it once (the hook fires inside setTarget) */
{
  const hooks = {}; let hid = 0;
  globalThis.Hooks = { on: (n, f) => { (hooks[n] ??= new Map()).set(++hid, f); return hid; }, off: (n, id) => hooks[n]?.delete(id), callAll: (n, ...a) => { for (const f of hooks[n]?.values() ?? []) f(...a); } };
  globalThis.game = { user: { id: "u1" } };
  const listeners = [], board = { id: "board" };
  globalThis.document = { addEventListener: (t, f) => listeners.push(f), removeEventListener: () => {}, body: { classList: { add() {}, remove() {} } }, getElementById: () => board, createElement: () => ({ dataset: {} }) };
  const tok = { visible: true, bounds: { contains: () => true }, document: { sort: 0 }, isTargeted: false, setTarget(on) { if (!this.isTargeted && on) { this.isTargeted = on; Hooks.callAll("targetToken", game.user, tok, on); } } };   // as Foundry: TargetSet.add calls the hook at once
  globalThis.canvas = { app: { canvas: board }, canvasCoordinatesFromClient: (p) => p };
  const combat = { combatants: { get: (id) => (id === "c1" ? { token: { object: tok } } : null) } };
  const Pick = await import("./ui/pick.mjs");
  let targets = [];
  Pick.setPlain(false);
  Pick.start(combat, ["c1"], (cid) => { targets = targets.includes(cid) ? targets.filter((x) => x !== cid) : [...targets, cid]; });      // the dock's toggle for several targets
  listeners[0]({ button: 0, target: board, clientX: 1, clientY: 1, stopImmediatePropagation() {}, preventDefault() {} });
  eq(targets, ["c1"], "S089: a click on an untargeted token picks it (several targets)");
  tok.isTargeted = false; Hooks.callAll("targetToken", game.user, tok, true);
  eq(targets, [], "S089: Foundry's own targeting (the T key) still picks, here toggling it off again");
  Pick.stop();
}

done("check-sweep");
