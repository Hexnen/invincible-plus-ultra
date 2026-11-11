// node scripts/tactics/check-defects4.mjs -- the defects D30-D39 of dev/combat-defects.md (adversary 4: initiative, hidden information,
// relay, journal and undo, engine invariants, zones adapter), each reproduction turned into a check that fails on the tree the adversary
// reviewed (dc770ea) and passes on the fix. Scripted table, no Foundry.
import { ok, eqc as eq, done, Table, seeded } from "./testkit.mjs";
import * as R from "./relay-pure.mjs";
import * as V from "./view-pure.mjs";
import * as I from "./initiative-pure.mjs";
import * as Desk from "./desk-pure.mjs";

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
  journal(userId) { const v = this.viewer(userId), n = V.readerNames(this.state, v, this.meta(), Object.values(this.c).map((x) => ({ id: x.id, name: x.bare ?? x.name, hidden: x.hidden }))); return V.journalFor(this.log, v, { concealed: n.concealed, name: (id) => n.names[id] ?? null }); }
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

done("check-defects4");
