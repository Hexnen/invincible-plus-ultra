// node scripts/tactics/check-desk.mjs -- models of the GM desk and of the player surface: a whole attack driven ONLY through the requests the models offer.
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import * as D from "./desk-pure.mjs";
import * as V from "./view-pure.mjs";
import * as P1 from "./economy-pure.mjs";

const mk = () => { const T = new Table(); T.hero("H1", "p1").hero("H2", "p2").npc("N1", { health: 5 }); T.order(["H1", "N1", "H2"]).turn("H1"); return T; };
const ctx = (T, online = () => true) => ({ c: (id) => T.c[id] ?? null, online, P1 });
const meta = (T) => ({ hidden: [], npc: Object.values(T.c).filter((c) => c.npc).map((c) => c.id) });
const pm = (T, uid, owns) => D.playerModel(V.viewFor(T.state, { id: uid, staff: false, owns }, meta(T)), { id: uid, owns }, ctx(T));

{
  const T = mk();
  let m = pm(T, "p1", ["H1"]);
  eq([m.bars.length, m.bars[0].onTurn, m.bars[0].budget.full, m.prompts.length], [1, true, "open", 0], "player: one bar, on turn, full action open");
  const act = (id) => m.bars[0].actions.find((a) => a.id === id);
  eq([act("slugfest").disabled, act("slugfest").cost, act("gmRoll") ?? null, act("block") ?? null], [null, "full", null, null], "the bar lists actions; no GM roll, no defences");
  eq(pm(T, "p2", ["H2"]).bars[0].actions.find((a) => a.id === "slugfest").disabled, "notYourTurn", "off turn: greyed with the reason");
  eq((await T.req("p1", act("slugfest").req({ targets: ["N1"] }))).ok, true, "declare through the bar's request");
  let d = D.deskModel(T.state, T.log, ctx(T));
  eq(d.cards.map((c) => [c.kind, c.about, c.aboutName, c.options.map((o) => o.id), c.always.map((a) => a.id)]), [["reaction", "N1", "N1", ["block", "pass"], ["block", "pass"]]], "desk: the NPC's reaction card with 'always' variants");
  eq(d.info.map((i) => [i.actor, i.action, i.targets.map((t) => t.id), i.locked, i.commands.map((c) => c.id)]), [["H1", "slugfest", ["N1"], false, ["veto", "amend", "override"]]], "desk: the declaration card with Veto and Amend before the dice");
  eq(d.waiting.map((w) => [w.what, w.to]), [["prompt", "gm"]], "waiting on the GM");
  m = pm(T, "p1", ["H1"]);
  eq([m.mine[0].commands.map((c) => c.id), m.bars[0].actions.find((a) => a.id === "slugfest").disabled, m.waiting.map((w) => w.to)], [["amend", "cancel"], "busy", ["gm"]], "player: own open action with amend/cancel; the bar is busy; sees who is awaited");
  eq(pm(T, "p2", ["H2"]).helpable.map((h) => [h.inst, h.helper]), [[T.top().id, "H2"]], "another player may offer help before the lock");
  eq((await T.gm(d.cards[0].options[0].req)).ok, true, "GM answers through the card's request");
  d = D.deskModel(T.state, T.log, ctx(T));
  eq([d.cards.length, d.info[0].locked, d.info[0].commands.map((c) => c.id), d.info[0].rolls.map((r) => [r.key, r.waiting, r.users])], [0, true, ["override"], [["attack", true, ["p1"]]]], "after the lock: Override only; the pending roll is listed");
  m = pm(T, "p1", ["H1"]);
  eq(m.mine[0].rolls.map((r) => [r.key, r.dice, r.rid != null]), [["attack", 4, true]], "player: the roll that waits for me, with its request id");
  eq(m.mine[0].commands.map((c) => c.id), ["cancel"], "after the lock cancel becomes a request to the GM");
  await T.roll("attack", 3); await T.roll("def:N1", 1);
  m = pm(T, "p1", ["H1"]);
  eq(m.prompts.map((p) => [p.kind, p.multi, p.max]), [["stunts", true, 1]], "player: the stunt prompt");
  const opt = m.prompts[0].options.find((o) => o.id === "doubleDamage@N1");
  eq([opt.disabled, m.prompts[0].options.find((o) => o.id === "deadlyHit@N1").disabled != null, m.prompts[0].options.find((o) => o.id === "deadlyHit@N1").req], [null, true, null], "greyed options carry the reason and no request");
  eq((await T.req("p1", m.prompts[0].answerReq(["doubleDamage@N1"]))).ok, true, "answer through the prompt's request");
  d = D.deskModel(T.state, T.log, ctx(T));
  eq([d.info.length, d.journal.length, d.journal[0].undo.alsoUndoes, d.journal[0].text.length > 0], [0, 1, 0, true], "desk: the closed action in the journal with Undo");
  eq((await T.gm(d.journal[0].undo.req)).ok, true, "undo through the journal's request");
  eq([T.c.N1.health, D.deskModel(T.state, T.log, ctx(T)).journal[0].undo], [5, null], "undone; no second Undo offered");
}
{ // proxy card for an offline addressee; manual instances; player end turn
  const T = mk(); T.turn("N1");
  await T.gm({ op: "declare", actor: "N1", decl: { action: "slugfest", targets: ["H2"] } });
  eq(D.deskModel(T.state, T.log, ctx(T)).cards.length, 0, "the player's prompt is not a desk card while the player is online");
  const d = D.deskModel(T.state, T.log, ctx(T, (u) => u !== "p2"));
  eq(d.cards.map((c) => [c.kind, c.of, c.absent, c.about]), [["proxy", "reaction", ["p2"], "H2"]], "offline addressee: a proxy card");
  eq((await T.gm(d.cards[0].options.find((o) => o.id === "pass").req)).ok, true, "answered for them");
  await T.gm({ op: "abort", inst: T.top().id });
  T.turn("H1");
  await T.req("p1", { op: "other", actor: "H1", text: "swing from the crane" });
  const d2 = D.deskModel(T.state, T.log, ctx(T));
  eq(d2.manual.map((m) => [m.actor, m.text, m.commands.map((c) => c.id)]), [["H1", "swing from the crane", ["resolve", "abort"]]], "'something else' is a manual instance on the desk");
  eq((await T.gm(d2.manual[0].commands[0].req({ cost: "quick", note: "fine" }))).ok, true, "resolved by hand");
  const m = pm(T, "p1", ["H1"]);
  eq([m.bars[0].budget.quick.includes("used") || m.bars[0].budget.full === "used", m.bars[0].endTurn.disabled], [true, null], "the cost shows on the bar; end turn is offered");
  eq((await T.req("p1", m.bars[0].endTurn.req)).ok, true, "end turn through the bar's request");
  eq(pm(T, "p1", ["H1"]).bars[0].endTurn, null, "not on turn any more");
  eq(D.deskModel(null, null).cards, [], "no state: empty model");
}
done("check-desk");
