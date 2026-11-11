// node scripts/tactics/check-defects5.mjs -- the defects D40-D49 of dev/combat-defects.md (adversary 5: preview, rolls and accept / push,
// passed turns, grants and exceptions, scheduler, chase, challenge) and the items of its "unproven" and "not reached" lists that were
// proved, each turned into a check that fails on the tree the adversary reviewed (51c3e1d) and passes on the fix. Scripted table, no Foundry.
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import * as R from "./relay-pure.mjs";
import * as V from "./view-pure.mjs";
import * as K from "./kit-pure.mjs";
import * as M from "./mods-pure.mjs";
import * as Lg from "./ledger-pure.mjs";
import * as P1 from "./economy-pure.mjs";

const code = (env) => env?.error?.code ?? (env?.ok ? (env.changed === false ? "ok(unchanged)" : "ok") : "?");
const why = (env) => env?.error?.params?.reason ?? null;
const ans = (env) => [code(env), why(env)];
/* The scripted table standing closer to the runtime (as check-defects4): a PLAYER's request goes through the relay's admission before the
   director sees it; view is what that user's client renders from. Characters carry items as check-kit.mjs builds them. */
const auto = (id, name, type, o = {}) => ({ id, name, type, show: o.show !== false, attr: o.attr ?? [], bonus: o.bonus ?? 0, stress: o.stress ?? 0, damage: o.damage ?? 0, min: o.min ?? 0, max: o.max ?? 0, bypass: false });
const item = (id, name, type, o = {}) => ({ id, name, type, level: o.level ?? null, power: o.power ?? null, boosts: o.boosts ?? [], autos: o.autos ?? [], fx: o.fx ?? [], flags: { kit: null, off: false, types: [], ...(o.flags ?? {}) }, wf: o.wf ?? {} });
const gun = (id, name, o = {}) => item(id, name, "gear", { autos: [auto("a", name, "rollAttack", { attr: ["agility"], ...o })] });
const decl = (actor, action, extra = {}) => ({ op: "declare", actor, decl: { action, ...extra } });
class T5 extends Table {
  constructor(o) { super(o); this.gate = new R.Gate(); this.seenRelay = new Map(); this.mid = 0; }
  async preq(userId, req) {
    const a = R.admit({ k: R.KIND.req, id: `m${++this.mid}`, n: "x", proto: R.PROTO, combat: "c", req }, { senderId: userId, user: (id) => (this.users[id] ? { id, staff: !!this.users[id].staff } : null), combatId: "c", gate: this.gate, now: this.now(), seen: this.seenRelay });
    if (!a.ok) return a.env;
    try { return R.wireEnv(await this.handle({ t: "req", user: a.user, rid: a.rid, req: a.req })); } finally { this.gate.release(userId, false); }
  }
  meta() { return { hidden: Object.values(this.c).filter((x) => x.hidden).map((x) => x.id), npc: Object.values(this.c).filter((x) => x.npc).map((x) => x.id) }; }
  viewer(userId) { return { id: userId, staff: !!this.users[userId]?.staff, owns: Object.values(this.c).filter((x) => x.owners.includes(userId)).map((x) => x.id) }; }
  view(userId) { return V.viewFor(this.state, this.viewer(userId), this.meta()); }
  give(cid, items, bonus = {}) { const c = this.c[cid]; c.src = items; c.kit = K.build({ items, attrs: c.attrs }); c.pass = c.kit.pass; c.bonus = bonus; return this; }
  facts() { const f = super.facts(), T = this; return { ...f, canTalk: () => true, weapon: (cid, ref) => (ref == null || ref === "unarmed" ? { ...f.weapon(cid, ref), ...(T.c[cid]?.kit?.unarmed ?? {}) } : T.c[cid]?.kit?.weapons.find((w) => w.id === ref) ?? f.weapon(cid, ref)) }; }
  act(cid, k) { return this.c[cid].kit.actions.find((a) => a.id.endsWith(`-${k}`)); }
}
/* answer every open card as the GM (pass / none / first enabled) until none is left */
const settle = async (T) => { for (let n = 0; n < 20 && T.prompts().length; n++) { const p = T.prompts()[0]; await T.gm({ op: "answerFor", prompt: p.id, value: p.multi ? [] : (p.options.find((o) => o.id === "pass" || o.id === "none") ?? p.options.find((o) => !o.disabled)).id }); } };
const stackOf = (T) => T.state.stack.map((i) => [i.actor, i.action, i.cause]);
const paid = (T, cid, action) => T.state.ledger[cid].entries.filter((x) => !x.void && x.action === action).map((x) => [x.cost, T.state.ledger[cid].grants.find((g) => g.id === x.grant)?.kind ?? null]);

/* ================================================================== D40: the extra action of Quickness is taken on the own turn or as an
   interrupt of an action somebody declared ([R1] [B1953], [B2292]); never in the middle of another's turn with nothing to interrupt. */
{
  const mk = () => { const T = new T5(); T.hero("H1", "p1").hero("H2", "p2").npc("N1"); T.give("H1", []).give("H2", [item("qu", "Quickness", "power")]).give("N1", []); T.order(["H1", "N1", "H2"]); return T; };
  { const T = mk();
    eq(code(await T.preq("p2", decl("H2", T.act("H2", "quickness").id))), "ok", "D40: the Quickness unit is taken out of turn (it costs nothing by itself)");
    const r = await T.preq("p2", decl("H2", "slugfest", { targets: ["N1"] }));
    eq([code(r), stackOf(T)], ["notYourTurn", []], "D40: a full action with it on another's turn and an empty stack is refused: there is nothing to interrupt");
    eq(code(await T.preq("p1", decl("H1", "slugfest", { targets: ["N1"] }))), "ok", "D40: the one whose turn it is declares");
    eq([T.top().data.window, !!T.top().locked], ["beforeRoll", false], "D40: (its attack stands before its dice)");
    const res = T.c.H2.resolve, i = await T.preq("p2", decl("H2", "slugfest", { targets: ["N1"] }));
    eq([code(i), stackOf(T)], ["ok", [["H1", "slugfest", "turn"], ["H2", "slugfest", "interrupt"]]], "D40 [R1]: the same full action answers the declared attack as an interrupt, before its dice");
    eq([paid(T, "H2", "slugfest"), res - T.c.H2.resolve, Lg.budget(T.state.ledger.H2).full], [[["full", "quickness"]], 1, "open"], "D40 [B1953]: it is paid with the Quickness unit and 1 stress; the base pair is untouched");
    eq(code(await T.preq("p2", decl("H2", "slugfest", { targets: ["N1"] }))), "busy", "D40: once (the unit is used)");
    await settle(T); await T.roll("attack", 1); await settle(T);
    eq(stackOf(T), [["H1", "slugfest", "turn"]], "D40: the interrupt ends and the interrupted attack goes on");
    await settle(T); if (T.top()) { await T.roll("attack", 0); await settle(T); }
    eq(T.state.stack.length, 0, "D40: (and ends)"); }
  { const T = mk();                                                                              // no Quickness unit: nothing changes for anybody else
    await T.preq("p1", decl("H1", "slugfest", { targets: ["N1"] }));
    eq(code(await T.preq("p2", decl("H2", "slugfest", { targets: ["N1"] }))), "busy", "D40: without the unit a full action never interrupts"); }
  { const T = mk(); T.turn("H2");
    await T.preq("p2", decl("H2", T.act("H2", "quickness").id));
    eq(code(await T.preq("p2", decl("H2", "slugfest", { targets: ["N1"] }))), "ok", "D40: on the own turn the base pair pays as before");
    await settle(T); await T.roll("attack", 0); await settle(T);
    eq(code(await T.preq("p2", decl("H2", "slugfest", { targets: ["N1"] }))), "ok", "D40 [B1953]: and the extra action is a second full action of the own turn");
    eq(paid(T, "H2", "slugfest").map((x) => x[1]), ["base", "quickness"], "D40: paid with the extra unit"); }
  { const T = mk(), g = Lg.addGrant(P1.ledgerOf(T.state, "H2"), Lg.grantTemplate("quickness"), "H2").ledger;
    T.state = { ...T.state, ledger: { ...T.state.ledger, H2: g } };
    eq(P1.canPay(T.state, "H2", "full", {}).reason, "notYourTurn", "D40: the bar's question (no interrupt) is answered 'not your turn', so the dock greys what the engine refuses"); }
}

/* ================================================================== D41: the read-only preview tells a player nothing about somebody the
   asking character has as `unseen` (spec 10; [B2075], [B1903]). */
{
  const T = new T5(); T.hero("H1", "p1").npc("N1", { name: "Stalker" }).npc("N2");
  T.give("H1", [gun("sr", "Sniper rifle", { bonus: 2, damage: 3, min: 1, max: 10 })]).give("N1", []).give("N2", []); T.order(["H1", "N1", "N2"]);
  const w = T.c.H1.kit.weapons[0].id, pv = async (d, u = "p1") => { const e = u === "gm" ? await T.gm({ op: "preview", actor: "H1", decl: d }) : await T.preq(u, { op: "preview", actor: "H1", decl: d }); return e.preview ? [e.preview.dice, e.preview.mods.map((m) => [m.source, m.dice])] : code(e); };
  const shot = { action: "shoot", targets: ["N1"], weapon: w };
  T.c.N1.zone = "z1"; const near = await pv(shot); T.c.N1.zone = "z2"; const far = await pv(shot);
  ok(JSON.stringify(near) !== JSON.stringify(far), `D41: (a target in sight: the preview knows the minimum range, ${JSON.stringify(near)} against ${JSON.stringify(far)})`);
  await T.gm({ op: "knowledgeSet", observer: "H1", subject: "N1", value: "unseen" });
  eq(ans(await T.preq("p1", decl("H1", "shoot", { targets: ["N1"], weapon: w }))), ["illegal", "unseen"], "D41: (a shot at the unseen one is refused)");
  const nobody = await pv({ action: "shoot", targets: ["nobodyAtAll"], weapon: w });
  T.c.N1.zone = "z1"; const a = await pv(shot); T.c.N1.zone = "z2"; const b = await pv(shot);
  eq([a, b], [nobody, nobody], "D41: the preview of a shot at somebody unseen is the same wherever it stands, and the one a target that is not there gets");
  await T.gm({ op: "statusAdd", combatant: "N1", status: { id: "snared" } }); T.c.N1.zone = "z1";
  eq(await pv({ action: "slugfest", targets: ["N1"] }), await pv({ action: "slugfest", targets: ["nobodyAtAll"] }), "D41: its conditions are not in the modifiers");
  eq(await pv({ action: "shoot", targets: ["N1"], weapon: w, blind: true }), nobody, "D41: nor for a blind shot 'where it should be'");
  ok(JSON.stringify(await pv({ action: "slugfest", targets: ["N1"] }, "gm")).includes("restrained"), "D41: the GM's preview is the full one");
  T.c.N2.zone = "z1"; const seen = await pv({ action: "shoot", targets: ["N2"], weapon: w });
  eq(seen, near, "D41: a target in sight is previewed as before");
}

/* ================================================================== D42: the GM's card of a free-standing request for an exception names
   what the ENGINE refuses, and the grant overrules that and nothing else (handoff U3; spec 9.12; ruling P9F-R1). */
{
  const mk = () => { const T = new T5(); T.hero("H1", "p1").npc("N1", { name: "Mauler" }); T.give("H1", []).give("N1", []); T.order(["H1", "N1"]).turn("H1"); return T; };
  const ask = (T, more = {}) => T.preq("p1", { op: "exception", actor: "H1", text: "one more punch, please", reason: "noAction", decl: { action: "slugfest", targets: ["N1"] }, ...more });
  const card = (T) => T.prompts().find((x) => x.kind === "exception");
  { const T = mk(); T.c.N1.zone = "z3";                                                           // a crafted request: "no action left" for a punch out of reach
    eq(ans(await T.preq("p1", decl("H1", "slugfest", { targets: ["N1"] }))), ["illegal", "outOfReach"], "D42: (the engine refuses the punch: out of reach)");
    await ask(T);
    eq([card(T).data.reason, card(T).data.reasons, !!card(T).data.waive], ["outOfReach", ["outOfReach"], false], "D42: the card names the engine's own refusal, not the word the client sent");
    await T.gm({ op: "answer", prompt: card(T).id, value: "grant" });
    eq([T.top()?.data.exception?.reason, paid(T, "H1", "slugfest")], ["outOfReach", [["full", "base"]]], "D42: the grant overrules the reach, and the action is paid for as always (nothing about the cost was refused)"); }
  { const T = mk(); T.c.N1.zone = "z3";                                                           // two rules refuse: both are on the card
    await T.preq("p1", { op: "mark", actor: "H1", unit: "full" });
    await ask(T);
    eq([card(T).data.reasons, !!card(T).data.waive], [["noAction", "outOfReach"], true], "D42: every rule that refuses it is on the card");
    await T.gm({ op: "answer", prompt: card(T).id, value: "grant" });
    eq([T.top()?.action, paid(T, "H1", "slugfest").filter((x) => x[0] !== "none").length], ["slugfest", 0], "D42 (P9F-R1): with no action left the granted declaration goes in at no cost"); }
  { const T = mk();                                                                               // the table changes between the request and the answer
    await T.preq("p1", { op: "mark", actor: "H1", unit: "full" });
    await ask(T);
    eq(card(T).data.reasons, ["noAction"], "D42: (asked with no action left, the target in reach)");
    T.c.N1.zone = "z3";
    const g = await T.gm({ op: "answer", prompt: card(T).id, value: "grant" });
    eq([ans(g), T.state.stack.length, !!card(T), card(T)?.data.reasons], [["stale", "noAction"], 0, true, ["noAction", "outOfReach"]], "D42: a grant on a card that is out of date runs nothing; the card now names what refuses");
    const g2 = await T.gm({ op: "answer", prompt: card(T).id, value: "grant" });
    eq([code(g2), T.top()?.data.exception?.reason], ["ok", "outOfReach"], "D42: granted again, with the rule in sight, it runs"); }
  { const T = mk();                                                                               // nothing refuses any more
    await T.preq("p1", { op: "mark", actor: "H1", unit: "full" }); await ask(T);
    await T.preq("p1", { op: "mark", actor: "H1", unit: "full", on: false });
    eq(code(await T.gm({ op: "answer", prompt: card(T).id, value: "grant" })), "stale", "D42: the same when the refusal is gone");
    eq([card(T).data.reasons, card(T).data.reason ?? null, !!card(T).data.waive], [[], null, false], "D42: (the card says nothing refuses)");
    await T.gm({ op: "answer", prompt: card(T).id, value: "grant" });
    eq(paid(T, "H1", "slugfest"), [["full", "base"]], "D42: and the declaration then costs its action"); }
  { const T = mk(); await T.preq("p1", { op: "mark", actor: "H1", unit: "full" }); await ask(T);
    eq(code(await T.gm({ op: "answer", prompt: card(T).id, value: "deny" })), "ok", "D42: a refusal is never out of date"); }
  { const T = mk();                                                                               // a request that names no declaration: the client's word stays (a grant of it runs nothing)
    await T.preq("p1", { op: "exception", actor: "H1", text: "may I?", reason: "noAction" });
    eq([card(T).data.reason, card(T).data.reasons ?? null], ["noAction", null], "D42: a request without a declaration keeps the reason it was sent with"); }
}

/* ================================================================== D43: a chase that ends as a fight draws initiative ([B3436]; spec 9.10;
   ruling P7-R8): a deal of the deck, not "the next free card" for each in list order. */
{
  const cards = (T) => T.state.init.slots.map((s) => [s.card, s.members.join("+")]);
  const deals = [];
  for (const order of [["N2", "H3", "N1", "H2", "H1"], ["H2", "N1", "H1", "N2", "H3"], ["N1", "N2", "H3", "H2", "H1"], ["H3", "H1", "N2", "N1", "H2"]]) {
    const T = new T5(); T.hero("H1", "p1").hero("H2", "p2").npc("N1").npc("N2").hero("H3", "p3"); for (const c of ["H1", "H2", "N1", "N2", "H3"]) T.give(c, []);
    T.order(order);
    await T.gm({ op: "chaseStart", prey: ["N1", "N2"], pursuer: ["H1", "H2", "H3"], distance: 2 });
    eq(T.state.init.slots.length, 0, "D43: (a chase holds no cards)");
    await T.gm({ op: "chaseRound" }); await T.roll("prey", 0); await T.roll("pursuer", 0);
    const round = T.state.round, at = T.events.length;
    await T.gm({ op: "chaseEnd", outcome: "combat" });
    deals.push(JSON.stringify(cards(T)));
    const c = cards(T);
    eq([T.state.kind, T.state.phase, T.state.round, c.length, new Set(c.map((x) => x[0])).size, c.every((x) => Number.isInteger(x[0]) && x[0] >= 1 && x[0] <= T.state.init.deck)], ["combat", "turns", round, 5, 5, true], "D43: after the chase everybody holds a card of the deck, in the same round");
    eq(T.state.init.curMember, c[0][1], "D43: and the lowest card has the turn");
    ok(!T.events.slice(at).some((e) => e.type === "draw" && e.reason === "join"), "D43: nobody is dealt in as a late joiner");
    ok(T.events.slice(at).some((e) => e.type === "roundStart"), "D43: the new order is told to the table");
    ok(["H1", "H2", "H3", "N1", "N2"].every((id) => !!T.state.ledger[id]), "D43: (everybody has a ledger)");
  }
  ok(new Set(deals).size > 1, `D43: the deal differs from fight to fight (${new Set(deals).size} different of ${deals.length})`);
  ok(!deals.every((d) => d === JSON.stringify([[1, "H1"], [2, "H2"], [3, "N1"], [4, "N2"], [5, "H3"]])), "D43: it is not the list order with the cards 1, 2, 3 ...");
  { const T = new T5(); T.hero("H1", "p1").npc("N1"); T.give("H1", []).give("N1", []); T.order(["H1", "N1"]);      // a late joiner of a running round is still last [A-1]
    T.npc("N9"); T.give("N9", []); await T.gm({ op: "roster" });
    eq(T.state.init.slots.find((s) => s.members.includes("N9"))?.card, Math.max(...T.state.init.slots.map((s) => s.card)), "D43: a combatant who joins a running round still gets the next free card [A-1]"); }
}

/* ================================================================== D44: holding off moves "on your turn" with the card ([I9] [B2282]): what
   lasts until the next turn of the one who holds off stays, and the turn-start triggers wait for the turn that really comes. */
{
  const plan = { id: "pl1", holder: "H2", dice: 2, scope: { rolls: ["attack"] }, uses: "all", source: { kind: "power", owner: "H1", name: "Action Plan" }, from: "H1", expires: { at: "nextTurnOf", who: "H1" } };
  const mk = async () => { const T = new T5(); T.hero("H1", "p1").hero("H2", "p2").npc("N1").hero("H3", "p3"); for (const c of ["H1", "H2", "N1", "H3"]) T.give(c, []); T.order(["N1", "H1", "H2", "H3"]); await T.gm({ op: "tokenAdd", token: plan }); return T; };
  const alive = (T) => T.state.tokens.some((t) => t.id === "pl1");
  const slotOf = (T, id) => T.state.init.slots.find((s) => s.members.includes(id)).id;
  const end = (T) => T.gm({ op: "endTurn", actor: T.state.init.curMember, force: true });
  { const T = await mk();
    await T.gm({ op: "statusAdd", combatant: "H3", status: { id: "marked", ends: { at: "nextTurnOf", who: "H1" } } });
    await end(T);
    eq([T.state.init.curMember, alive(T), (T.state.statuses.H3 ?? []).length], ["H1", false, 0], "D44: (when the turn of H1 opens, what lasted until then ends)");
    eq(code(await T.preq("p1", { op: "holdOff", actor: "H1", with: slotOf(T, "H3") })), "ok", "D44: H1 holds off behind H3");
    eq([T.state.init.curMember, alive(T), (T.state.statuses.H3 ?? []).map((s) => s.id)], ["H3", true, ["marked"]], "D44 [B2282]: its turn has not happened: the plan dice and the status that last until it are there again");
    await end(T);
    eq([T.state.init.curMember, alive(T)], ["H2", true], "D44: the allies act before H1 with the plan");
    ok(T.preview("p2", "H2", { action: "slugfest", targets: ["N1"] })?.mods?.some((m) => m.dice === 2), "D44: (the dice are in the ally's roll)");
    await end(T);
    eq([T.state.init.curMember, alive(T), (T.state.statuses.H3 ?? []).length], ["H1", false, 0], "D44: they end when the turn of H1 really comes");
    eq(code(await T.preq("p1", decl("H1", "slugfest", { targets: ["N1"] }))), "ok", "D44: (and H1 acts on it)");
    await settle(T); await T.roll("attack", 0); await settle(T);
    await T.preq("p1", { op: "endTurn", actor: "H1" });
    eq([T.state.round, T.state.moved?.H1?.back ?? null], [2, null], "D44: (the mark of the hold-off does not outlive the turn)"); }
  { const T = await mk();                                                                          // the turn-start triggers move too
    await T.gm({ op: "triggerAdd", trigger: { at: "turnStart", subject: { combatant: "H1" }, run: { type: "hazard", hazard: { kind: "fixed", amount: 1 } }, source: { kind: "gm", name: "poison" } } });
    await end(T);
    const q = () => T.prompts("triggerQueue").filter((p) => p.about === "H1");
    eq(q().length, 1, "D44: (the turn-start card of H1 opens with its turn)");
    eq(code(await T.gm({ op: "holdOff", actor: "H1", with: slotOf(T, "H3") })), "ok", "D44: H1 holds off");
    eq([q().length, T.state.sched.done.includes(`${T.state.round}:ts:H1`)], [0, false], "D44 [B2282]: the card nobody answered is withdrawn with the turn");
    await end(T); await end(T);
    eq([T.state.init.curMember, q().length], ["H1", 1], "D44: and asked when the turn really comes"); }
  { const T = await mk();                                                                          // what the GM already ran from the card has happened
    await T.gm({ op: "triggerAdd", trigger: { at: "turnStart", subject: { combatant: "H1" }, run: { type: "hazard", hazard: { kind: "fixed", amount: 1 } }, source: { kind: "gm", name: "poison" } } });
    await end(T);
    const p = T.prompts("triggerQueue").find((x) => x.about === "H1");
    await T.gm({ op: "answerFor", prompt: p.id, value: { order: [], skip: p.options.map((o) => o.id) } });
    await T.gm({ op: "holdOff", actor: "H1", with: slotOf(T, "H3") });
    await end(T); await end(T);
    eq([T.state.init.curMember, T.prompts("triggerQueue").filter((x) => x.about === "H1").length, alive(T)], ["H1", 0, false], "D44: a card the GM answered before the hold-off is not asked a second time"); }
  { const T = await mk(); await end(T);                                                            // the token was replaced meanwhile: no double
    await T.gm({ op: "tokenAdd", token: { ...plan, dice: 1 } });
    await T.gm({ op: "holdOff", actor: "H1", with: slotOf(T, "H3") });
    eq(T.state.tokens.filter((t) => t.id === "pl1").map((t) => t.dice), [1], "D44: what took the place of an ended token since is not doubled"); }
  { const T = await mk(); await end(T); const st = T.state;
    eq([!!st.moved?.H1, V.viewFor(st, T.viewer("p2"), T.meta()).moved === undefined], [true, true], "D44: (the kept moment is not part of a player's view)"); }
}

/* ================================================================== D45: the round does not end, and no turn is passed, over a trigger queue
   card that is still open (spec 4.4, 6.1; handoff U4). */
{
  const mk = async () => { const T = new T5(); T.hero("H1", "p1").hero("H2", "p2").npc("N1", { health: 0 }).npc("N2", { health: 0 }); for (const c of ["H1", "H2", "N1", "N2"]) T.give(c, []);
    T.order(["H1", "H2", "N1", "N2"]);
    await T.gm({ op: "statusAdd", combatant: "N1", status: { id: "dead" } }); await T.gm({ op: "statusAdd", combatant: "N2", status: { id: "unconscious" } });
    await T.gm({ op: "triggerAdd", trigger: { at: "turnStart", subject: { combatant: "N2" }, run: { type: "hazard", hazard: { kind: "fixed", amount: 1 } }, source: { kind: "gm", name: "poison" } } });
    await T.gm({ op: "triggerAdd", trigger: { at: "turnEnd", subject: { combatant: "H2" }, run: { type: "fireAttack", intensity: 6 }, source: { kind: "gm", name: "burning" }, expires: { at: "roundEnd" } } });
    await T.preq("p1", { op: "endTurn", actor: "H1" }); return T; };
  const keys = (T) => T.prompts("triggerQueue").map((p) => p.data.key);
  { const T = await mk();
    eq(code(await T.preq("p2", { op: "endTurn", actor: "H2" })), "ok", "D45: H2 ends its turn (a turn-end trigger is due)");
    eq([T.state.round, T.state.init.curMember, keys(T), T.state.triggers.map((t) => t.source.name).sort()], [1, null, ["1:te:H2:s2"], ["burning", "poison"]], "D45: the round waits for the card of H2's turn end: nobody is passed, nothing has expired");
    const at = T.events.length, p = T.prompts("triggerQueue")[0];
    await T.gm({ op: "answerFor", prompt: p.id, value: { order: [], skip: [] } });
    ok(T.events.slice(at).some((e) => e.type === "trigger" && e.run?.type === "fireAttack"), "D45: the GM's answer runs the turn-end trigger");
    for (let n = 0; n < 5 && T.top(); n++) await T.gm({ op: "abort", inst: T.top().id });
    eq([T.state.round, keys(T), T.events.slice(at).filter((e) => e.type === "turnPassed").map((e) => [e.combatant, e.round])], [1, ["1:ts:N2"], [["N1", 1], ["N2", 1]]], "D45: then the two who cannot act are passed, in round 1, and the turn-start card of N2 is asked in round 1");
    const q = T.prompts("triggerQueue")[0];
    await T.gm({ op: "answerFor", prompt: q.id, value: { order: [], skip: q.options.map((o) => o.id) } });
    eq([T.state.round, T.state.init.curMember != null, keys(T).filter((k) => k.startsWith("1:"))], [2, true, []], "D45: with every card answered the round turns"); }
  { const T = new T5(); T.hero("H1", "p1").npc("N1"); T.give("H1", []).give("N1", []); T.order(["H1", "N1"]);      // the last turn of the round, nobody passed
    await T.gm({ op: "triggerAdd", trigger: { at: "turnEnd", subject: { combatant: "N1" }, run: { type: "fireAttack", intensity: 6 }, source: { kind: "gm", name: "burning" }, expires: { at: "roundEnd" } } });
    await T.preq("p1", { op: "endTurn", actor: "H1" }); await T.gm({ op: "endTurn", actor: "N1", force: true });
    eq([T.state.round, keys(T), T.state.triggers.length], [1, ["1:te:N1:s2"], 1], "D45: the same for the turn-end card of the last one in the order");
    const p = T.prompts("triggerQueue")[0];
    await T.gm({ op: "answerFor", prompt: p.id, value: { order: [], skip: p.options.map((o) => o.id) } });
    eq([T.state.round, T.state.triggers.length], [2, 0], "D45: answered, the round ends and its expiry runs"); }
  { const T = new T5(); T.hero("H1", "p1").hero("H2", "p2"); T.give("H1", []).give("H2", []); T.order(["H1", "H2"]);      // a turn somebody takes opens as before
    await T.gm({ op: "triggerAdd", trigger: { at: "turnEnd", subject: { combatant: "H1" }, run: { type: "fireAttack", intensity: 6 }, source: { kind: "gm", name: "burning" } } });
    await T.preq("p1", { op: "endTurn", actor: "H1" });
    eq([T.state.init.curMember, keys(T).length, ans(await T.preq("p2", decl("H2", "slugfest", { targets: ["H1"] })))], ["H2", 1, ["busy", "triggersFirst"]], "D45: the next turn that somebody takes opens over the card; its owner waits for it (P8-R10)"); }
}

/* ================================================================== D46: what hangs on the turn of somebody who has left the fight ends with
   the leaving ([B1634]; spec 3.3). */
{
  const T = new T5(); T.hero("H1", "p1").hero("H2", "p2").npc("N1").hero("H3", "p3"); for (const c of ["H2", "N1", "H3"]) T.give(c, []);
  T.give("H1", [item("ap", "Action Plan", "power")]); T.order(["H1", "H2", "N1", "H3"]);
  eq(code(await T.preq("p1", decl("H1", (T.act("H1", "plan") ?? T.c.H1.kit.actions[0]).id, { opt: "attack" }))), "ok", "D46: (H1 declares the plan)");
  if (T.top()) await T.roll(Object.keys(T.top().rolls)[0], 2);
  await settle(T);
  const planTokens = () => T.state.tokens.filter((t) => t.expires?.who === "H1").map((t) => t.holder).sort();
  eq(planTokens(), ["H2", "H3"], "D46: (the allies hold plan dice until the next turn of H1)");
  await T.gm({ op: "statusAdd", combatant: "H2", status: { id: "marked", ends: { at: "nextTurnOf", who: "H1" } } });
  await T.gm({ op: "statusAdd", combatant: "H3", status: { id: "kept", ends: { at: "nextTurnOf", who: "H3" } } });
  await T.gm({ op: "tokenAdd", token: { id: "other", holder: "H3", dice: 1, scope: { rolls: ["attack"] }, uses: "all", source: { kind: "gm", name: "x" }, expires: { at: "nextTurnOf", who: "H3" } } });
  await T.req("p1", { op: "endTurn", actor: "H1" });
  delete T.c.H1; await T.gm({ op: "roster" });
  eq([planTokens(), (T.state.statuses.H2 ?? []).map((s) => s.id)], [[], []], "D46: the planner leaves the fight: the plan dice and the status that waited for its turn are gone");
  eq([T.state.tokens.map((t) => t.id), (T.state.statuses.H3 ?? []).map((s) => s.id)], [["other"], ["kept"]], "D46: what waits for somebody else's turn stays");
  eq(T.preview("p2", "H2", { action: "slugfest", targets: ["N1"] })?.mods?.filter((m) => String(m.source).startsWith("token")) ?? [], [], "D46: the ally's roll has no plan dice");
}

done("check-defects5");
