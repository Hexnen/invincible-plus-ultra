// node scripts/tactics/check-defects4.mjs -- the defects D30-D39 of dev/combat-defects.md (adversary 4: initiative, hidden information,
// relay, journal and undo, engine invariants, zones adapter), each reproduction turned into a check that fails on the tree the adversary
// reviewed (dc770ea) and passes on the fix. Scripted table, no Foundry.
import { ok, eqc as eq, done, Table, seeded } from "./testkit.mjs";
import * as R from "./relay-pure.mjs";
import * as V from "./view-pure.mjs";
import * as I from "./initiative-pure.mjs";
import * as Desk from "./desk-pure.mjs";
import * as K from "./kit-pure.mjs";
import { MTable } from "./check-kit-map.mjs";
import * as M from "./mods-pure.mjs";

const code = (env) => env?.error?.code ?? (env?.ok ? (env.changed === false ? "ok(unchanged)" : "ok") : "?");
const why = (env) => env?.error?.params?.reason ?? null;
const ans = (env) => [code(env), why(env)];
/* The scripted table standing closer to the runtime: a PLAYER's request goes through the relay's admission (relay-pure.admit) before the
   director sees it, as relay.mjs onRequest does; view / journal / pub are what that user's client renders from (engine.mjs view, journal, publish). */
class T4 extends Table {
  constructor(o) { super(o); this.gate = new R.Gate(); this.seenRelay = new Map(); this.mid = 0; }
  async preq(userId, req) {
    const a = R.admit({ k: R.KIND.req, id: `m${++this.mid}`, n: "x", proto: R.PROTO, combat: "c", req }, { senderId: userId, user: (id) => (this.users[id] ? { id, staff: !!this.users[id].staff } : null), combatId: "c", gate: this.gate, now: this.now(), seen: this.seenRelay });
    if (!a.ok) return a.env;
    try { return R.wireEnv(await this.handle({ t: "req", user: a.user, rid: a.rid, req: a.req })); } finally { this.gate.release(userId, false); }
  }
  meta() { return { hidden: Object.values(this.c).filter((x) => x.hidden).map((x) => x.id), npc: Object.values(this.c).filter((x) => x.npc).map((x) => x.id) }; }
  viewer(userId) { return { id: userId, staff: !!this.users[userId]?.staff, owns: Object.values(this.c).filter((x) => x.owners.includes(userId)).map((x) => x.id) }; }
  view(userId) { return V.viewFor(this.state, this.viewer(userId), this.meta()); }
  journal(userId) { const v = this.viewer(userId); if (!V.readerNames) return V.journalFor(this.log, v);      /* (the reviewed tree: the journal took the log and the viewer alone) */ const n = V.readerNames(this.state, v, this.meta(), Object.values(this.c).map((x) => ({ id: x.id, name: x.bare ?? x.name, hidden: x.hidden }))); return V.journalFor(this.log, v, { concealed: n.concealed, name: (id) => n.names[id] ?? null }); }
  pub(events = this.events) { return events.map((e) => V.publicEvent(this.state, e, this.meta())).filter(Boolean); }
}
/* answer every open card as the GM (pass / none / first enabled) until none is left */
const settle = async (T) => { for (let n = 0; n < 20 && T.prompts().length; n++) { const p = T.prompts()[0]; await T.gm({ op: "answerFor", prompt: p.id, value: p.multi ? [] : (p.options.find((o) => o.id === "pass" || o.id === "none") ?? p.options.find((o) => !o.disabled)).id }); } };
/* a whole slugfest: declared, defence passed, `sixes` on the attack roll, every later card passed */
const exchange = async (T, user, actor, target, sixes = 2) => { const r = await T.req(user, { op: "declare", actor, decl: { action: "slugfest", targets: [target] } }); if (!r.ok) return r; await settle(T); if (T.top()) await T.roll("attack", sixes); await settle(T); return r; };
const slots = (T) => T.state.init.slots.map((s) => `${s.members.join("+")}:${s.card}`).join(" ");

/* ================================================================== D30: a slot of the initiative order that a player's view does not hold
   answers a player exactly as a slot that is not there (spec 10; ruling P8-R17). */
{
  const mk = (more = () => {}) => { const T = new T4(); T.hero("H1", "p1").npc("N1").npc("NH", { hidden: true }); more(T); T.order(["H1", "N1", "NH"]); return T; };
  const slotOf = (T, id) => T.state.init.slots.find((s) => s.members.includes(id)).id;
  { const A = mk(), B = mk(), before = slots(A);
    const r = await A.preq("p1", { op: "holdOff", actor: "H1", with: slotOf(A, "NH") }), q = await B.preq("p1", { op: "holdOff", actor: "H1", with: "s999" });
    ok(!A.view("p1").init.slots.some((s) => s.id === slotOf(A, "NH")), "D30: the hidden NPC's slot is not in the player's view");
    eq([ans(r), slots(A), A.state.init.curMember, A.events.length], [ans(q), before, "H1", 0], "D30: holding off with the hidden NPC's slot is refused as a slot that is not there; no card moves, the turn stays, no event"); }
  { const A = mk(); eq(code(await A.preq("p1", { op: "holdOff", actor: "H1", with: slotOf(A, "N1") })), "ok", "D30: a slot the player sees is held off with as before"); }
  { const A = mk(); eq([code(await A.gm({ op: "holdOff", actor: "H1", with: slotOf(A, "NH") })), A.state.init.curMember], ["ok", "NH"], "D30: the GM holds off with any slot"); }
  { const A = mk(); await A.gm({ op: "knowledgeSet", observer: "H1", subject: "N1", value: "unseen" }); const before = slots(A);
    ok(!A.view("p1").init.slots.some((s) => s.id === slotOf(A, "N1")), "D30: the slot of somebody every hero of the player has as unseen is not in the view either");
    eq([ans(await A.preq("p1", { op: "holdOff", actor: "H1", with: slotOf(A, "N1") })), slots(A)], [["illegal", "holdOff"], before], "D30: and it is not held off with"); }
  { const T = new T4(); T.hero("H1", "p1").npc("N1").npc("NH", { hidden: true });                 // a group on one card, one member visible: the view shows the slot, so it can be named
    await T.gm({ op: "start", mode: "tactical", groups: [["N1", "NH"]] }); await settle(T);
    const g = slotOf(T, "N1");
    ok(T.state.init.slots.find((s) => s.id === g).members.length === 2 && T.view("p1").init.slots.some((s) => s.id === g), "D30: a card shared by a hidden and a visible NPC stays in the view");
    if (T.state.init.curMember !== "H1") T.turn("H1");
    const r = await T.preq("p1", { op: "holdOff", actor: "H1", with: g });
    ok(code(r) === "ok" || why(r) === "holdOff", `D30: and the player's request about it is judged by the rules alone (${ans(r)})`);
    const hold = I.holdOffTargets(T.state.init, slotOf(T, "H1")).includes(g);
    eq(code(r) === "ok", hold, "D30: (it is allowed exactly when the order allows it)"); }
}

/* ================================================================== D31: the public event stream holds no initiative record of somebody
   concealed: no `draw`, no line of `roundStart.order`, as the state view of the same moment holds no such slot (spec 10, 16). */
{
  const T = new T4(); T.hero("H1", "p1").npc("N1").npc("NH", { hidden: true });
  await T.gm({ op: "start", mode: "tactical" });
  const hid = T.state.init.slots.find((s) => s.members.includes("NH")), seen = T.view("p1").init.slots.map((s) => s.id).sort();
  const pub = T.pub(), draws = pub.filter((e) => e.type === "draw"), order = pub.find((e) => e.type === "roundStart")?.order ?? [];
  eq([draws.map((e) => e.slot).sort(), order.map((o) => o.slot).sort()], [seen, seen], "D31: the public draws and the public order name exactly the slots of the player's view");
  ok(!JSON.stringify(pub).includes(`"${hid.id}"`) && draws.every((e) => e.members.length) && order.every((o) => o.members.length), "D31: nothing public carries the hidden slot's id, and no record is left with an empty member list");
  eq(T.events.filter((e) => e.type === "draw").length, 3, "D31: the GM's stream keeps all three draws");
  T.npc("NZ", { hidden: true }); T.events = []; await T.gm({ op: "roster" });
  eq([T.events.filter((e) => e.type === "draw").length, T.pub()], [1, []], "D31: a hidden combatant that joins later draws for the GM alone");
  if (T.state.init.curMember !== "H1") T.turn("H1");
  T.events = []; await T.gm({ op: "holdOff", actor: "H1", with: hid.id, force: true });
  const sw = T.pub().filter((e) => e.type === "draw");
  ok(sw.length <= 1 && sw.every((e) => e.members.includes("H1")), "D31: of a swap with a hidden slot the table hears the visible half only");
}
{ /* a card shared by a hidden and a visible NPC is public with the visible member, as in the view */
  const T = new T4(); T.hero("H1", "p1").npc("N1").npc("NH", { hidden: true });
  await T.gm({ op: "start", mode: "tactical", groups: [["N1", "NH"]] });
  const g = T.state.init.slots.find((s) => s.members.includes("N1")), d = T.pub().find((e) => e.type === "draw" && e.slot === g.id);
  eq([g.members.length, d?.members, d?.card], [2, ["N1"], g.card], "D31: a shared card stays public with its visible member");
  /* an unseen one (concealed from somebody) is treated by the public stream as a hidden one */
  const U = new T4(); U.hero("H1", "p1").npc("N1"); U.order(["H1", "N1"]); await U.gm({ op: "knowledgeSet", observer: "H1", subject: "N1", value: "unseen" });
  const ev = { type: "roundStart", order: [{ slot: "sA", card: 1, members: ["H1"] }, { slot: "sB", card: 2, members: ["N1"] }] };
  eq(V.publicEvent(U.state, ev, U.meta())?.order.map((o) => o.slot), ["sA"], "D31: the same for somebody unseen");
  eq([V.publicEvent(U.state, { type: "challenge", challenge: "N1", state: "failed" }, U.meta()), V.publicEvent(U.state, { type: "vehicle", vehicle: "N1", who: "H1", state: "entered" }, U.meta())], [null, null],
    "D31 (sibling): an event that names a concealed one in a field of its own is not public at all");
}

/* ================================================================== D32: the journal a player reads has no line about somebody concealed
   from that player (spec 10 [B2075], [B1903]; P9F-8). */
{
  const T = new T4(); T.hero("H1", "p1").hero("H2", "p2").npc("N1", { name: "Stalker" }); T.order(["N1", "H1", "H2"]);
  await T.gm({ op: "knowledgeSet", observer: "H1", subject: "N1", value: "unseen" });
  await exchange(T, "gm", "N1", "H1");
  eq([T.journal("p1"), T.journal("p2").map((j) => j.text), T.journal("gm").map((j) => j.text).slice(-1)], [[], ["Stalker: {ITAC.action.slugfest} ({ITAC.result.hit})"], ["Stalker: {ITAC.action.slugfest} -> H1 ({ITAC.result.hit})"]],
    "D32: the one who cannot see the attacker reads no line; the player who can, and the GM, read it");
  await T.gm({ op: "knowledgeSet", observer: "H1", subject: "N1", value: "seen" });
  eq(T.journal("p1").length, T.state.knowledge?.H1?.N1 === "unseen" ? 0 : 1, "D32: the line is there once the attacker is seen");
}
{ /* the target concealed from the reader: no line either (the line would tell that somebody is there) */
  const T = new T4(); T.hero("H1", "p1").hero("H2", "p2").npc("N1"); T.order(["H2", "H1", "N1"]);
  await T.gm({ op: "knowledgeSet", observer: "H1", subject: "N1", value: "unseen" });
  await exchange(T, "p2", "H2", "N1");
  eq([T.journal("p1").length, T.journal("p2").length], [0, 1], "D32 (sibling): a line about an action against somebody the reader cannot see is not read by that reader");
}
{ /* the GM's word on a request is for the one who asked (P9F-8) */
  const T = new T4(); T.hero("H1", "p1").hero("H2", "p2").npc("N1"); T.order(["H2", "H1", "N1"]);
  await T.preq("p1", { op: "other", actor: "H1", text: "I shout" }); await T.gm({ op: "answerFor", prompt: T.prompts("exception")[0].id, value: "deny" });
  eq([T.journal("p1").map((j) => j.text), T.journal("p2")], [["H1: {ITAC.journal.exceptionDenied}"], []], "D32 (sibling): the journal line of an answered request is read by the asker alone");
}

/* ================================================================== D33: the names in a player's journal are numbered from the player's own
   list: a hidden namesake is not counted (ruling U5-7). The names are composed as engine.mjs makeFacts does. */
{
  const T = new T4(); T.hero("H1", "p1").npc("N1", { name: "Soldier" }).npc("NH", { name: "Soldier", hidden: true });
  const gmNames = V.distinctNames(Object.values(T.c).map((x) => ({ id: x.id, name: x.name, hidden: x.hidden })));
  for (const [id, n] of Object.entries(gmNames)) { T.c[id].bare = T.c[id].name; T.c[id].name = n; }
  T.order(["N1", "H1", "NH"]);
  await exchange(T, "gm", "N1", "H1");
  eq([T.journal("p1").map((j) => j.text), T.journal("gm").map((j) => [j.text, j.pub])], [["Soldier: {ITAC.action.slugfest} ({ITAC.result.hit})"], [["Soldier #1: {ITAC.action.slugfest} -> H1 ({ITAC.result.hit})", "Soldier #1: {ITAC.action.slugfest} ({ITAC.result.hit})"]]],
    "D33: one visible Soldier beside a hidden one has no number in the player's journal; the GM reads the GM's number");
  ok(!JSON.stringify(T.log.list.map((t) => t.label.pub)).includes("#"), "D33: the stored public line carries no name at all, only the mark");
  eq(Desk.deskModel(T.state, T.log, { c: (id) => T.c[id] ?? null, staff: true })?.journal?.[0]?.pub, "Soldier #1: {ITAC.action.slugfest} ({ITAC.result.hit})", "D33: the desk's own row is put into names too");
  T.c.NH.hidden = false;
  eq(T.journal("p1").map((j) => j.text), ["Soldier #1: {ITAC.action.slugfest} ({ITAC.result.hit})"], "D33: once the namesake is revealed the player's number is the table's");
  delete T.c.N1; await T.gm({ op: "roster" });
  eq(T.journal("p1").map((j) => j.text), ["Soldier: {ITAC.action.slugfest} ({ITAC.result.hit})"], "D33: somebody who has left the fight keeps the plain name in the line");
}

/* ================================================================== D34: on an empty stack a new action is the action of the one whose turn
   it is [B2290], [B2292]; a player out of turn cannot put one there by naming something that costs no action (ruling P8-R11). */
{
  const mk = () => { const T = new T4(); T.hero("H1", "p1").hero("H2", "p2").npc("N1"); T.order(["H2", "H1", "N1"]); return T; };
  const stack = (T) => T.state.stack.map((i) => `${i.action}/${i.actor}/${i.status}`);
  { const T = mk(), r = await T.preq("p1", { op: "declare", actor: "H1", decl: { action: "other", text: "I shout a warning" } });
    eq([code(r), stack(T), T.prompts("exception").map((p) => [p.to, p.about, p.data?.text, p.data?.other])], ["ok", [], [["gm", "H1", "I shout a warning", 1]]], "D34: 'something else' declared by a player out of turn is a card for the GM, not an action on the stack");
    const d = await T.preq("p2", { op: "declare", actor: "H2", decl: { action: "slugfest", targets: ["N1"] } });
    eq(code(d), "ok", "D34: the one whose turn it is acts on");
    const V2 = mk(); await V2.preq("p1", { op: "other", actor: "H1", text: "I shout a warning" });
    eq([stack(V2), V2.prompts("exception").map((p) => [p.to, p.about, p.data?.text, p.data?.other])], [[], [["gm", "H1", "I shout a warning", 1]]], "D34: exactly what the op `other` makes of it"); }
  { const T = mk(); await T.preq("p1", { op: "declare", actor: "H1", decl: { action: "other", text: "x" } });
    eq(code(await T.preq("p2", { op: "endTurn", actor: "H2" })), "ok", "D34: and the turn can be ended"); }
  { const T = mk(); eq([code(await T.preq("p1", { op: "declare", actor: "H1", decl: { action: "other" } })), stack(T), T.prompts().length], ["notYourTurn", [], 0], "D34: without a text there is nothing to ask: refused, not your turn"); }
  { const T = mk(); eq([code(await T.preq("p1", { op: "declare", actor: "H1", decl: { action: "release" } })), stack(T)], ["notYourTurn", []], "D34 (sibling): another built-in that costs no action is refused out of turn, as the bar shows it"); }
  { const T = mk(); eq([code(await T.preq("p2", { op: "declare", actor: "H2", decl: { action: "other", text: "I look around" } })), stack(T)], ["ok", ["other/H2/manual"]], "D34: on the player's own turn 'something else' is the action it was"); }
  { const T = mk(); eq([code(await T.gm({ op: "declare", actor: "H1", decl: { action: "other", text: "the GM's hand" } })), stack(T)], ["ok", ["other/H1/manual"]], "D34: the GM declares it for anybody at any time"); }
  { const T = mk(); await T.gm({ op: "setFree", combatant: "H1", free: true });
    const r = await T.preq("p1", { op: "declare", actor: "H1", decl: { action: "other", text: "x" } });
    ok(code(r) === "ok" && (!T.state.free?.H1 || stack(T).length === 1), "D34: a participant the GM marked free is not held to the turn"); }
  /* the same door for what a kit uses without an action */
  const item = (id, name, type) => ({ id, name, type, level: null, power: null, boosts: [], autos: [], fx: [], flags: { kit: null, off: false, types: [] }, wf: {} });
  const kit = () => { const T = mk(); const c = T.c.H1; c.health = 4; c.kit = K.build({ items: [item("ph", "Phobic", "drawback"), item("re", "Regeneration", "power"), item("di", "Discretion", "talent")], attrs: c.attrs }); c.pass = c.kit.pass; return T; };
  const act = (T, k) => T.c.H1.kit.actions.find((a) => a.id.endsWith(`-${k}`)).id;
  { const T = kit(), r = await T.preq("p1", { op: "declare", actor: "H1", decl: { action: act(T, "phobia") } });
    eq([code(r), stack(T), T.requests.length, T.prompts("exception").map((p) => [p.to, p.about, p.data?.decl?.action])], ["ok", [], 0, [["gm", "H1", act(T, "phobia")]]], "D34 (sibling): a kit use without an action that waits for a roll is, out of turn, a request to the GM that carries the declaration");
    eq(code(await T.preq("p2", { op: "declare", actor: "H2", decl: { action: "slugfest", targets: ["N1"] } })), "ok", "D34 (sibling): nobody is held meanwhile");
    await settle(T); if (T.top()) await T.roll("attack", 0); await settle(T);
    const U = kit(); await U.preq("p1", { op: "declare", actor: "H1", decl: { action: act(U, "phobia") } });
    await U.gm({ op: "answerFor", prompt: U.prompts("exception")[0]?.id, value: "grant" });
    eq([stack(U).map((x) => x.split("/").slice(0, 2).join("/")), U.requests.length], [[`${act(U, "phobia")}/H1`], 1], "D34 (sibling): the GM's yes runs it: the roll is asked for"); }
  { const T = kit(), r = await T.preq("p1", { op: "declare", actor: "H1", decl: { action: act(T, "regen") } });
    eq([code(r), stack(T), T.c.H1.health, T.prompts().length], ["ok", [], 5, 0], "D34: a kit use that ends at once (Regeneration) goes through out of turn and holds nobody"); }
  { const T = kit(); const id = T.c.H1.kit.actions.find((a) => a.reactionOnly)?.id;
    eq([!!id, code(await T.preq("p1", { op: "declare", actor: "H1", decl: { action: id } })), stack(T)], [true, "unknown", []], "D34 (sibling): what exists only as an answer in a reaction window (Discretion) cannot be declared by a player as an action"); }
}

/* ================================================================== D37: the target of an open attack leaves the fight (spec 3.3; spec 0
   principle 4). Nothing waits for a card that is gone, and nothing hits nobody. */
{
  const mk = () => { const T = new T4(); T.hero("H1", "p1").npc("N1").npc("N2"); T.order(["H1", "N1", "N2"]); return T; };
  const st = (T) => T.state.stack.map((i) => `${i.action}/${i.actor}->${i.decl.targets} ${i.step} ${i.status}${i.data.hold ? ` hold:${i.data.hold}` : ""}`);
  const paid = (T) => (T.state.ledger.H1?.entries ?? []).filter((e) => !e.void).map((e) => e.cost);
  const open = async () => { const T = mk(); await T.preq("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1"] } }); return T; };
  const leave = async (T, id = "N1") => { delete T.c[id]; return T.gm({ op: "roster" }); };
  const card = (T) => T.prompts("revalidate")[0] ?? null;
  { const T = await open(); await leave(T);
    eq([st(T), T.prompts().map((p) => [p.kind, p.to, p.about, p.options.map((o) => o.id), p.data?.reasons])], [["slugfest/H1-> reactBefore waiting hold:revalidate"], [["revalidate", "gm", "H1", ["amend", "forfeit", "cancel"], ["noTarget"]]]],
      "D37 (a): the target left while its defence card was open: the attack is held on a card of the GM (aim again, give up with or without the cost)");
    ok(Desk.waitingOn(T.state).some((w) => w.kind === "revalidate" && w.to === "gm"), "D37 (a): the desk says what the table waits for");
    await T.gm({ op: "answerFor", prompt: card(T)?.id, value: "cancel" });
    eq([st(T), paid(T), code(await T.preq("p1", { op: "endTurn", actor: "H1" }))], [[], [], "ok"], "D37 (a): given up: off the stack, the action is the attacker's again, the turn can be ended"); }
  { const T = await open(); await leave(T); await T.gm({ op: "answerFor", prompt: card(T)?.id, value: "forfeit" });
    eq([st(T), paid(T)], [[], ["full"]], "D37 (a): forfeited: off the stack, the action stays spent"); }
  { const T = await open(); await leave(T); await T.gm({ op: "answerFor", prompt: card(T)?.id, value: "amend" });
    const r = await T.preq("p1", { op: "amend", inst: T.top()?.id, decl: { targets: ["N2"] } });
    eq([code(r), T.top()?.decl.targets, T.prompts().map((p) => [p.kind, p.about])], ["ok", ["N2"], [["reaction", "N2"]]], "D37 (a): aimed again by its owner, it goes on against the new target");
    await settle(T); await T.roll("attack", 2); await settle(T);
    eq([st(T), T.journal("gm").map((j) => j.text)], [[], ["H1: {ITAC.action.slugfest} -> N2 ({ITAC.result.hit})"]], "D37 (a): and ends as an ordinary attack on that target"); }
  { const T = await open(); await settle(T); const before = T.requests.length; await leave(T);
    await T.roll("attack", 3);
    eq([st(T).map((x) => x.replace(/ (roll|reactBefore) /, " * ")), !!card(T), T.journal("gm").filter((j) => /result\.hit/.test(j.text)), before], [["slugfest/H1-> * waiting hold:revalidate"], true, [], 1],
      "D37 (b): the target left after its defence, before the dice: the dice hit nobody, the attack waits for the GM's word; the journal records no hit");
    await T.gm({ op: "answerFor", prompt: card(T)?.id, value: "cancel" });
    eq([st(T), paid(T)], [[], []], "D37 (b): given up and refunded"); }
  { const T = new T4(); T.hero("H1", "p1").npc("N1").npc("N2"); T.weapons.smg = { id: "smg", bonus: 1, damage: 2, range: [0, 2], sharp: true, fullAuto: true }; T.order(["H1", "N1", "N2"]);
    const r = await T.preq("p1", { op: "declare", actor: "H1", decl: { action: "shoot", targets: ["N1", "N2"], weapon: "smg", fullAuto: true } });
    await leave(T);
    eq([code(r), T.top()?.decl.targets, !!T.top()?.data.hold, T.prompts().map((p) => [p.kind, p.about])], ["ok", ["N2"], false, [["reaction", "N2"]]], "D37: one of several targets left: the attack goes on against the rest, held by nobody");
    await settle(T); await T.roll("attack", 2); await settle(T);
    eq(st(T), [], "D37: and comes to its end"); }
  { const T = mk(); T.hero("H2", "p2"); await T.gm({ op: "roster" }); await T.preq("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1"] } });
    const h = await T.preq("p2", { op: "help", inst: T.top()?.id, helper: "H2" }); await leave(T, "H2");
    eq([code(h), T.top()?.decl.helpers], ["ok", []], "D37 (sibling): a helper who left the fight no longer helps the open action"); }
}

/* ================================================================== D35: NOT A DEFECT of the code; the entry A19 was stale. The book gives
   the highest cards to the defenders who failed the roll [B2279] and lets the GM put a group of NPCs on one card [B2275]; it does not
   say what a group does when only some of its members failed. The behaviour since P1 (initiative-pure.GROUP_SURPRISE = "all"): the
   group's card is a surprise card only when EVERY member is on the list; the GM builds both the groups and the list. Question P8d-1. */
{
  eq(I.GROUP_SURPRISE, "all", "D35: the constant");
  let part = 0, whole = 0, lone = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const mk = async (surprised) => { const T = new T4(); T.hero("H1", "p1").hero("H2", "p2").hero("H3", "p3").npc("N1").npc("N2"); T.rng = seeded(seed); await T.gm({ op: "start", mode: "tactical", groups: [["N1", "N2"]], surprised }); return T; };
    const top = (T, id) => { const g = T.state.init.slots.find((x) => x.members.includes(id)); return g.card === Math.max(...T.state.init.slots.map((x) => x.card)) && g.card === T.state.init.deck; };
    const A = await mk(["N1"]), B = await mk(["N1", "N2"]), C = await mk(["H1"]);
    if (top(A, "N1")) part++; if (top(B, "N1")) whole++; if (top(C, "H1")) lone++;
    if (seed === 1) eq([A.state.init.surprised ?? [], B.state.init.surprised?.slice().sort(), A.state.init.slots.find((x) => x.members.includes("N1")).members.length], [[], ["N1", "N2"], 2], "D35: a group with one surprised member is not on the list of the surprised; a group surprised as a whole is");
  }
  eq([whole, lone], [60, 60], "D35: a group whose members are all surprised, and a single surprised defender, hold the highest card of the deck in every start [B2279]");
  ok(part < 30, `D35: a group with only one surprised member draws with everybody else (the highest card in ${part} of 60 starts, by chance)`);
}

/* ================================================================== D36: NOT A DEFECT of the code; the entry C10 was read too widely. C10
   is about the turn pointer: a finished round is not opened again (prevTurn stops at the first turn of a round). The undo of the journal
   is not bound to the round (spec 15; plan 5.6): what an older exchange did to the world is given back; only the ledgers of the finished
   round are left alone, because actions are reset at the start of every round and nothing is carried over [B2293] [L5]. Question P8d-2. */
{
  const T = new T4(); T.hero("H1", "p1").npc("N1", { health: 6 }); T.order(["H1", "N1"]);
  await exchange(T, "p1", "H1", "N1", 3);
  const tx = T.log.list.at(-1), hp = T.c.N1.health;
  await T.preq("p1", { op: "endTurn", actor: "H1" }); await T.gm({ op: "nextTurn" }); await settle(T);
  eq([tx.round, T.state.round, hp < 6], [1, 2, true], "D36: the exchange of round 1, seen from round 2");
  const first = T.state.init.curMember, back = await T.gm({ op: "prevTurn" });
  eq([code(back), T.state.round, T.state.init.curMember], ["noPrev", 2, first], "D36 (C10): the finished round is not opened again: no step back from the first turn of a round");
  const led = JSON.stringify(T.state.ledger), r = await T.gm({ op: "undo", tx: tx.id });
  eq([code(r), T.c.N1.health, T.log.list.find((t) => t.id === tx.id).state, JSON.stringify(T.state.ledger) === led], ["ok", 6, "undone", true],
    "D36: the undo of the journal reaches over the round: the damage is given back, the line is marked undone, and the ledgers of the new round are untouched [B2293]");
}

/* ================================================================== D38: an undo gives back what still exists; somebody who has left the
   fight gets no ledger back (spec 3.3, 15). */
{
  const T = new T4(); T.hero("H1", "p1").npc("N1", { health: 6 }); T.order(["H1", "N1"]);
  await exchange(T, "p1", "H1", "N1", 3);
  const tx = T.log.list.at(-1).id, hp = T.c.N1.health;
  delete T.c.H1; await T.gm({ op: "roster" });
  const r = await T.gm({ op: "undo", tx });          // the kit fails a check by itself when the state does not survive the round trip of the store
  eq([code(r), Object.keys(T.state.ledger), hp, T.c.N1.health, Object.keys(T.state.statuses ?? {}).includes("H1")], ["ok", ["N1"], 4, 6, false],
    "D38: undoing the exchange of an attacker who has left gives the target its Health back and writes no ledger for the one who is gone");
  const U = new T4(); U.hero("H1", "p1").npc("N1", { health: 6 }); U.order(["H1", "N1"]);
  await exchange(U, "p1", "H1", "N1", 3); const n = U.state.ledger.H1.entries.filter((e) => !e.void).length;
  await U.gm({ op: "undo", tx: U.log.list.at(-1).id });
  eq([n, U.state.ledger.H1.entries.filter((e) => !e.void).length, U.c.N1.health], [1, 0, 6], "D38: with the attacker still in the fight the undo gives the action back as before");
}

/* ================================================================== D39: the zones adapter says "no map here" (undefined: nothing is asked
   of range, the GM settles positions) when the scene has no zones, when a token cannot be placed, or when one stands outside every
   zone; `null` stays the answer of the map itself, "no attack possible" (spec 7.3; zones-api.md sections 2, 3). */
{
  globalThis.Hooks ??= { on: () => 1, off: () => {} };
  let fake = null;
  const game0 = globalThis.game;                 // the map table of check-kit-map.mjs put its own fake there: given back below
  globalThis.game = { ...(globalThis.game ?? {}), modules: { get: () => (fake ? { active: true, api: { zones: fake } } : null) } };
  const Z = await import("./zones-adapter.mjs");
  const place = (zone, area = null) => ({ zone, id: zone ? 1 : -1, spot: zone, area, level: area ? null : "ground" });
  const api = (places, range, keys = ["z1", "z2"]) => ({ zoneOfToken: (t) => places[t.id] ?? null, place: () => null, range, keys: () => keys, version: () => "x", canWrite: () => true });
  const a = { id: "a" }, b = { id: "b" };
  eq(String(Z.range(a, b)), "undefined", "D39: no map module: nothing is asked");
  fake = api({ a: place(null), b: place(null) }, () => null, []);
  eq([String(Z.range(a, b)), Z.available(), Z.usable?.()], ["undefined", true, false], "D39: a scene without zones: undefined, not a refusal of every attack");
  fake = api({ a: place("z1"), b: place(null) }, () => null);
  eq(String(Z.range(a, b)), "undefined", "D39: one of the two stands outside every zone: undefined");
  fake = api({ a: place("z1") }, () => null);
  eq(String(Z.range(a, b)), "undefined", "D39: a token of a scene that is not open on the executor has no place: undefined");
  fake = api({ a: place("z1"), b: place("z2") }, () => ({ total: 1, borders: 1, levels: 0 }));
  eq([Z.range(a, b), Z.usable?.()], [{ total: 1, borders: 1, levels: 0 }, true], "D39: on a map both stand on, the range of the map");
  fake = api({ a: place("z1"), b: place("@sky", "sky") }, () => null);
  eq(Z.range(a, b), null, "D39: the null of the map itself (to an off-map area) stays: no attack possible");
  /* and what the engine makes of the two answers */
  const mk = (range) => { const T = new T4(); T.hero("H1", "p1").npc("N1"); T.order(["H1", "N1"]); const f0 = T.facts.bind(T); T.facts = () => ({ ...f0(), range }); return T; };
  fake = api({ a: place(null), b: place(null) }, () => null, []);
  const A = mk(() => Z.range({ id: "a" }, { id: "b" })), r = await A.preq("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1"] } });
  eq([code(r), A.prompts().map((p) => p.kind)], ["ok", ["reaction"]], "D39: on a scene without zones an attack is declared and runs (the GM settles the positions)");
  fake = api({ a: place("z1"), b: place("@sky", "sky") }, () => null);
  const B = mk(() => Z.range({ id: "a" }, { id: "b" }));
  eq(ans(await B.preq("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1"] } })), ["illegal", "noRange"], "D39: where the map itself says no attack is possible it is still refused");
  globalThis.game = game0;
}

/* ================================================================== the unproven list of adversary 4, proved in node and fixed */
/* `help` naming the action of a hidden NPC: it was CARRIED OUT (the hero's full action went into the hidden NPC's attack) */
{
  const mk = async (id) => { const T = new T4(); T.hero("H1", "p1").npc("N1").npc("NH", { hidden: true }).npc("NV"); T.order(["NH", "NV", "H1", "N1"]); if (id !== "NH") T.turn(id); await T.gm({ op: "declare", actor: id, decl: { action: "slugfest", targets: ["N1"] } }); return T; };
  const paid = (T) => (T.state.ledger.H1?.entries ?? []).filter((e) => !e.void).length;
  { const T = await mk("NH"), r = await T.preq("p1", { op: "help", inst: T.top().id, helper: "H1" }), q = await T.preq("p1", { op: "help", inst: "a999", helper: "H1" });
    eq([ans(r), T.top().decl.helpers ?? [], paid(T)], [ans(q), [], 0], "P8d: helping the action of a hidden NPC answers as an action that is not there; nobody helps, nothing is spent"); }
  { const T = await mk("NV"); await T.gm({ op: "knowledgeSet", observer: "H1", subject: "NV", value: "unseen" });
    eq([code(await T.preq("p1", { op: "help", inst: T.top().id, helper: "H1" })), paid(T)], ["gone", 0], "P8d: the same for the action of somebody the helper cannot see"); }
  { const T = await mk("NV"); eq([code(await T.preq("p1", { op: "help", inst: T.top().id, helper: "H1" })), T.top().decl.helpers.map((h) => h.id), paid(T)], ["ok", ["H1"], 1], "P8d: an action in plain sight is helped as before"); }
  { const T = await mk("NH"); eq(code(await T.gm({ op: "help", inst: T.top().id, helper: "H1" })), "ok", "P8d: the GM puts a helper on any action"); }
}
/* a deck grown above ten cards for combatants the viewer does not see */
{
  let lower = 0, right = 0, gmDeck = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const T = new T4(); T.hero("H1", "p1"); for (let i = 1; i <= 9; i++) T.npc(`N${i}`); for (let i = 1; i <= 3; i++) T.npc(`X${i}`, { hidden: true });
    T.rng = seeded(seed); await T.gm({ op: "start", mode: "tactical" }); await settle(T);
    const v = T.view("p1").init, top = Math.max(...v.slots.map((s) => s.card));
    if (top < T.state.init.deck) lower++;
    if (v.slots.length === 10 && v.deck === Math.max(10, top)) right++;
    if (T.view("gm").init.deck === 13 && T.state.init.deck === 13) gmDeck++;
  }
  ok(lower >= 1, `P8d: in some starts the highest card is held by somebody hidden (${lower} of 12)`);
  eq([right, gmDeck], [12, 12], "P8d: the deck a player's view names is the highest card in sight (ten at least), not the count that includes hidden slots; the GM's view keeps the deck");
}
/* amend of a priced action: a move declared against the rules with a request for an exception has no price; changed into a legal move
   it is priced then (before, it ran for nothing) */
{
  const mk = () => { const T = new MTable(); T.hero("H1", "p1", { attrs: { strength: 5 } }).npc("N1", { health: 5 }); T.put("H1", "z3").put("N1", "z4"); T.order(["H1", "N1"]); return T; };
  const paid = (T) => T.state.ledger.H1.entries.filter((e) => !e.void).map((e) => e.cost);
  { const T = mk(), r = await T.req("p1", { op: "declare", actor: "H1", decl: { action: "move", to: "z1", exception: { text: "please" } } });
    eq([code(r), T.top()?.data.hold, paid(T), T.spot("H1")], ["ok", "exception", [], "z3"], "P8d: a move the rules refuse, declared with a request for an exception, waits for the GM and has no price yet");
    const a = await T.req("p1", { op: "amend", inst: T.top().id, decl: { to: "z2" } });
    eq([ans(a).join("/"), T.spot("H1"), paid(T), T.state.stack.length, T.prompts().length], ["ok/", "z2", ["quick"], 0, 0], "P8d: changed into a legal move it runs and costs what that move costs"); }
  { const T = mk(); await T.req("p1", { op: "mark", actor: "H1", unit: "quick", on: true }); await T.req("p1", { op: "mark", actor: "H1", unit: "quick", on: true });
    await T.gm({ op: "declare", actor: "H1", gm: true, decl: { action: "move", to: "z1", exception: { text: "please" } } });
    const held = T.top()?.data.hold === "exception" || T.top()?.status === "manual", n = paid(T).length;
    const a = held ? await T.req("p1", { op: "amend", inst: T.top().id, decl: { to: "z2" } }) : null;
    ok(!held || (code(a) !== "ok" && T.spot("H1") === "z3" && paid(T).length === n), `P8d: with nothing left to pay with the change is refused and nobody moves (${a ? ans(a) : "not held"})`); }
}

/* ================================================================== docs against code, spec 6.3 [B2279], [B2430]: a defender on the list of
   the surprised is unaware from the start (the spec was right, `start` wrote no status); only the GM clears it [OQ-7]. */
{
  const T = new T4(); T.hero("H1", "p1").npc("N1").npc("N2");
  await T.gm({ op: "start", mode: "tactical", surprised: ["N1", "ghost"] }); await settle(T);
  const st = (id) => M.statusesOf(T.state, id).map((s) => s.id);
  eq([st("N1"), st("N2"), st("H1"), Object.keys(T.state.statuses)], [["unaware"], [], [], ["N1"]], "spec 6.3: the surprised defender is unaware from the start, nobody else, and no entry for an id that is not in the fight");
  ok(T.events.some((e) => e.type === "status" && e.target === "N1" && e.status?.id === "unaware" && e.status.on === true), "spec 6.3: the status is announced");
  if (T.state.init.curMember !== "H1") T.turn("H1");
  await T.preq("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1"] } });
  const p = T.state.prompts[Object.keys(T.state.prompts).find((k) => T.state.prompts[k].kind === "reaction" && T.state.prompts[k].about === "N1")];
  eq([p?.auto?.reason ?? null, (p?.options ?? []).filter((o) => !o.disabled && o.id !== "pass").map((o) => o.id)], ["unaware", []], "spec 6.3 [B2430]: the unaware defender neither blocks nor dodges");
  await settle(T);
  eq(T.lastRequest()?.pool?.mods?.find((m) => /unaware/i.test(String(m.source)))?.dice ?? null, 2, "spec 6.3 [B2430]: the slugfest attacker rolls two dice more");
  await T.roll("attack", 0); await settle(T);
  eq([code(await T.gm({ op: "statusRemove", combatant: "N1", id: "unaware" })), st("N1")], ["ok", []], "spec 6.3 [OQ-7]: it stays until the GM takes it away");
}

done("check-defects4");
