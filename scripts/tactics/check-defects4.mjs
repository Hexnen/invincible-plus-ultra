// node scripts/tactics/check-defects4.mjs -- the defects D30-D39 of dev/combat-defects.md (adversary 4: initiative, hidden information,
// relay, journal and undo, engine invariants, zones adapter), each reproduction turned into a check that fails on the tree the adversary
// reviewed (dc770ea) and passes on the fix. Scripted table, no Foundry.
import { ok, eqc as eq, done, Table, seeded } from "./testkit.mjs";
import * as R from "./relay-pure.mjs";
import * as V from "./view-pure.mjs";
import * as I from "./initiative-pure.mjs";
import * as Desk from "./desk-pure.mjs";
import * as K from "./kit-pure.mjs";

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

done("check-defects4");
