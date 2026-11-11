// node scripts/tactics/check-engine.mjs -- the action engine end to end with scripted answers standing in for the humans (no Foundry).
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./mods-pure.mjs";
import * as Lg from "./ledger-pure.mjs";
/* the real end of a turn (ops-pure.mjs through the director): by the owner, or by the GM for an NPC */
const endTurn = (T, user, actor) => T.req(user, { op: "endTurn", actor, round: T.state.round, slot: T.state.init.cur, ...(user === "gm" ? { force: true } : {}) });

const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const snap = (T) => JSON.stringify({ ledger: T.state.ledger, statuses: T.state.statuses, tokens: T.state.tokens, counters: T.state.counters, karma: T.state.karma, effects: T.state.effects });
const hp = (T) => Object.fromEntries(Object.values(T.c).map((c) => [c.id, c.health]));
const base = (opts) => { const T = new Table(opts); T.hero("H1", "p1").hero("H2", "p2").npc("N1", { health: 5, armor: [{ id: "vest", armor: 1 }] }).npc("N2", { health: 4 }); T.order(["H1", "N1", "H2", "N2"]).turn("H1"); return T; };
const slug = (actor, target, extra = {}) => ({ op: "declare", actor, decl: { action: "slugfest", targets: [target], ...extra } });
const SUDDEN = { id: "suddenStrike", flow: "attack", attack: "slugfest", cost: "quick", src: [1619], reaction: { when: ["beforeRoll"], who: "target", effect: "action" } };
const GUARD = { id: "guardian", flow: "plain", cost: "quick", src: [2115], reaction: { when: ["beforeRoll"], who: "any", effect: "swapTarget" } };
const PHASE = { id: "phase", flow: "plain", cost: "quick", src: [1940], stress: { fixed: 1 }, reaction: { when: ["beforeRoll"], who: "target", effect: "autoMiss" } };

/* ================================================================== A: a declared attack through reaction, rolls, stunt, damage, undo */
{
  const T = base();
  const before = snap(T), hp0 = hp(T);
  eq(code(await T.req("p2", slug("H1", "N1"))), "notOwner", "A: a foreign actor is refused");
  eq(code(await T.req("p1", slug("H2", "N1"))), "notOwner", "A: cannot declare for another player's hero");
  eq(code(await T.req("p1", slug("H1", "ZZ"))), "illegal", "A: unknown target is illegal");
  eq(T.state.stack.length, 0, "A: refused declarations leave no instance");
  eq(code(await T.req("p1", slug("H1", "N1"))), "ok", "A: declare");
  let I = T.top();
  eq([I.flow, I.step, I.status, I.locked, I.cause], ["attack", "reactBefore", "waiting", false, "turn"], "A: waits in the reaction window, not locked");
  eq(P1.budget(T.state, "H1").full, "used", "A: the full action is reserved at the declaration");
  const rp = T.prompt("reaction", "N1");
  eq([rp.to, rp.options.map((o) => o.id)], ["gm", ["block", "pass"]], "A: the NPC's reaction card goes to the GM desk with block or pass (no dodge against slugfest)");
  eq(T.requests.length, 0, "A: no die before the window closes");
  eq(code(await T.req("p1", { op: "answer", prompt: rp.id, value: "block" })), "notOwner", "A: the attacker cannot answer the defender's card");
  eq(code(await T.req("p1", slug("H1", "N2"))), "busy", "A: no second action under an open one");
  eq(code(await T.gm({ op: "answerFor", prompt: rp.id, value: "block" })), "ok", "A: GM answers block");
  I = T.top();
  eq([I.step, I.locked], ["roll", true], "A: the declaration locks at the first die");
  eq(P1.budget(T.state, "N1").quick[0], "used", "A: the block costs the defender a quick action");
  eq(T.requests.map((r) => [r.key, r.users, r.dice, r.maxPush]), [["attack", ["p1"], 4, null]], "A: the attacker's owner is asked to roll FIGHTING");
  eq(code(await T.req("p1", { op: "amend", inst: I.id, decl: { targets: ["N2"] } })), "locked", "A: no amend after the lock");
  eq(code(await T.roll("attack", 3, { author: "p2" })), "badInput", "A: a roll from somebody else is ignored");
  eq(code(await T.roll("attack", 3, { rid: "forged" })), "badInput", "A: a roll with a foreign request id is ignored");
  await T.roll("attack", 3, { pushable: true });
  eq(T.requests.map((r) => [r.key, r.users, r.maxPush]).slice(1), [["def:N1", ["gm"], 0]], "A: afterDefence: the defender rolls once the attacker has rolled; defenders never push");
  await T.roll("def:N1", 1);
  eq(T.top().step, "roll", "A: still waiting for the attacker to push or accept");
  await T.roll("attack", 3, { pushable: false });
  I = T.top();
  eq([I.step, I.data.out.N1.hit, I.data.out.N1.net, I.data.out.N1.stunts], ["stunts", true, 2, 1], "A: 3 sixes against 1 = hit with one stunt");
  const sp = T.prompt("stunts");
  eq([sp.to.users, sp.max], [["p1"], 1], "A: the stunt prompt goes to the attacker with the budget");
  eq(code(await T.req("p1", { op: "answer", prompt: sp.id, value: ["doubleDamage@N1", "trap@N1"] })), "badInput", "A: more stunts than sixes refused");
  eq(code(await T.req("p1", { op: "answer", prompt: sp.id, value: ["deadlyHit@N1"] })), "badInput", "A: Deadly Hit needs sharp damage (greyed option refused)");
  eq(code(await T.req("p1", { op: "answer", prompt: sp.id, value: ["doubleDamage@N1"] })), "ok", "A: pick Double Damage");
  eq(T.state.stack.length, 0, "A: the action closed");
  eq(T.c.N1.health, 2, "A: damage 2 doubled before Armor 1 = 3, Health 5 -> 2");
  eq(T.log.list.length, 1, "A: one transaction in the journal");
  eq(T.log.list[0].ops.map((o) => o.t), ["state", "state", "actor"], "A: ops = attacker's entry, defender's entry, Health (the history facts are derived from the entries, no op of their own)");
  eq(Object.keys(T.state.prompts).length, 0, "A: no prompt left behind");
  eq(Object.keys(T.state.txOpen).length, 0, "A: no open transaction left");
  eq(T.evs("actionClosed").length, 1, "A: actionClosed emitted");
  eq(T.evs("damage").map((e) => [e.target, e.base, e.doubled, e.armor, e.taken]), [["N1", 2, true, 1, 3]], "A: damage event");
  eq(P1.history(T.state, "H1", "round", "attacked"), true, "A: history fact 'attacked'");
  // undo restores Health and ledger exactly
  eq(code(await T.req("p1", { op: "undo", tx: T.log.list[0].id })), "noPermission", "A: a player cannot undo");
  eq(code(await T.gm({ op: "undo", tx: T.log.list[0].id })), "ok", "A: undo");
  eq(hp(T), hp0, "A: undo restores Health exactly");
  eq(snap(T), before, "A: undo restores the ledger and all engine state exactly");
  eq(T.log.list[0].state, "undone", "A: the transaction is marked undone");
  eq(code(await T.gm({ op: "undo", tx: T.log.list[0].id })), "gone", "A: no second undo");
  eq(code(await T.req("p1", slug("H1", "N1"))), "ok", "A: after the undo the action is available again");
}

/* ================================================================== B: an interrupt that is itself an action, then revalidation [OQ-3] */
for (const choice of ["forfeit", "cancel", "continue", "amend"]) {
  const T = base(); T.turn("N1");
  await T.gm({ op: "powerGrant", combatant: "H2", entry: SUDDEN });
  T.c.N1.health = 1;
  eq(code(await T.gm(slug("N1", "H2"))), "ok", `B(${choice}): NPC attacks`);
  const rp = T.prompt("reaction", "H2");
  eq(rp.options.map((o) => [o.id, o.disabled ?? null]), [["block", null], ["r:suddenStrike", null], ["pass", null]], "B: the target's options");
  await T.req("p2", { op: "answer", prompt: rp.id, value: "r:suddenStrike" });
  eq(T.state.stack.map((i) => [i.actor, i.cause, i.status]), [["N1", "turn", "waiting"], ["H2", "interrupt", "waiting"]], "B: the interrupt is on top of the stack");
  eq(P1.budget(T.state, "H2").quick[0], "used", "B: the interrupt cost a quick action");
  await T.answer("gm", "reaction", "pass", "N1");
  await T.roll("attack", 2);
  await T.req("p2", { op: "answer", prompt: T.prompt("stunts").id, value: [] });
  eq(T.c.N1.health, 0, "B: the interrupt broke the attacker");
  eq(T.prompt("npcBroken", "N1")?.to, "gm", "B: an ordinary NPC at 0 Health is the GM's call");
  await T.answer("gm", "npcBroken", "ko", "N1");
  eq(T.state.stack.length, 1, "B: the interrupt popped");
  const rv = T.prompt("revalidate");
  eq([rv?.to, rv?.data.reasons, rv?.options.map((o) => o.id)], ["gm", ["broken"], ["continue", "amend", "forfeit", "cancel"]], "B: the instance beneath no longer validates -> GM card, no default");
  eq(T.requests.filter((r) => r.combatant === "N1").length, 0, "B: the engine did not decide by itself");
  await T.answer("gm", "revalidate", choice);
  if (choice === "forfeit") { eq(T.state.stack.length, 0, "B: forfeit ends it"); eq(P1.budget(T.state, "N1").full, "used", "B: forfeit = action spent"); eq(T.log.list.at(-1).ops.length, 1, "B: the forfeited cost stays in the journal"); }
  if (choice === "cancel") { eq(T.state.stack.length, 0, "B: cancel ends it"); eq(P1.budget(T.state, "N1").full, "open", "B: cancel = action refunded"); }
  if (choice === "continue") { eq(T.top().step, "roll", "B: continue as declared"); eq(T.lastRequest().combatant, "N1", "B: the attacker is asked to roll"); }
  if (choice === "amend") {
    eq([T.top().data.hold, T.top().locked], ["amend", false], "B: waits for an amended declaration");
    eq(code(await T.gm({ op: "amend", inst: T.top().id, decl: { targets: ["H1"] } })), "ok", "B: amended");
    eq(T.prompt("reaction", "H1")?.to.users, ["p1"], "B: the new target gets its window");
  }
  eq(M.hasStatus(T.state, "N1", "unconscious"), true, "B: knocked out");
}

/* ================================================================== C: counterattack after a block with surplus sixes [R4] */
{
  const T = base();
  await T.req("p1", slug("H1", "N1"));
  await T.answer("gm", "reaction", "block", "N1");
  await T.roll("attack", 1);
  await T.roll("def:N1", 3);
  const cp = T.prompt("counter", "N1");
  eq([T.top().data.out.N1.hit, cp?.options[0].data.sixes], [false, 2], "C: blocked; the defender has 2 sixes beyond those that cancelled");
  await T.answer("gm", "counter", "counter", "N1");
  const sp = T.prompt("stunts");
  eq([T.top().data.kind, T.top().actor, T.top().cause, sp?.max, sp?.to], ["counterattack", "N1", "counter", 1, "gm"], "C: counterattack on the stack: hits automatically, first six is the hit, the rest stunts");
  eq(T.requests.length, 2, "C: no dice and no defence against a counterattack");
  await T.answer("gm", "stunts", []);
  eq([T.state.stack.length, T.c.H1.health], [0, 4], "C: both closed; the attacker took Slugfest Damage 2");
  eq(T.log.list.length, 2, "C: two transactions (counter first, then the attack)");
  eq(code(await T.gm({ op: "undo", tx: T.log.list[0].id })), "ok", "C: undoing the earlier one undoes the later one first (LIFO)");
  eq([T.log.list.map((t) => t.state), T.c.H1.health, P1.budget(T.state, "H1").full, P1.budget(T.state, "N1").quick[0]], [["undone", "undone"], 6, "open", "open"], "C: everything restored");
}

/* ================================================================== D: gate rolls */
{
  const T = base();
  await T.gm({ op: "statusAdd", combatant: "N1", status: { id: "invisible" } });
  await T.req("p1", slug("H1", "N1"));
  eq([T.top().step, T.lastRequest().key, T.lastRequest().maxPush, T.lastRequest().dice, T.lastRequest().attr], ["gate", "gate:0", 0, 1, "intuition"], "D: invisible target -> passive INTUITION at -3 (never below one die), no push");
  eq(T.prompts("reaction").length, 0, "D: the target is not asked before the gate");
  await T.roll("gate:0", 0);
  eq([T.state.stack.length, P1.budget(T.state, "H1").full, T.evs("gate").at(-1).passed, T.log.list.at(-1).label.gm.includes("gateFailed")], [0, "used", false, true], "D: a failed gate spends the action");
  T.turn("H2");
  await T.req("p2", slug("H2", "N1"));
  await T.roll("gate:0", 1);
  eq([T.top().step, T.prompt("reaction", "N1") != null], ["reactBefore", true], "D: a passed gate opens the reaction window");
  // concealed by the GM without a cited number: the GM sets the gate
  const U = base();
  await U.gm({ op: "knowledgeSet", observer: "H1", subject: "N1", value: "unseen" });
  eq((await U.req("p1", slug("H1", "N1"))).error?.params.reason, "unseen", "D: an unseen target is not attackable without the stated intent");
  await U.req("p1", slug("H1", "N1", { blind: true }));
  eq([U.prompt("gate")?.to, U.prompt("gate")?.gmOnlyData], ["gm", 1], "D: attacking where it should be -> the GM sets the gate");
  await U.answer("gm", "gate", { id: "roll", dice: -2 });
  eq([U.lastRequest().key, U.lastRequest().dice], ["gate:0", 1], "D: the GM's gate roll is requested");
  await U.roll("gate:0", 2);
  eq(U.top().step, "reactBefore", "D: passed");
  // low gravity [B1703]
  const L = base(); L.zoneMarks.z1 = { lowgrav: true };
  await L.req("p1", slug("H1", "N1"));
  eq([L.lastRequest().attr, L.lastRequest().maxPush], ["agility", 0], "D: low gravity -> AGILITY roll first");
}

/* ================================================================== E: retargeting by a third party's reaction; automatic miss */
{
  const T = base(); T.turn("N1");
  await T.gm({ op: "powerGrant", combatant: "H1", entry: GUARD });
  await T.gm(slug("N1", "H2"));
  eq(T.prompts("reaction").map((p) => [p.about, p.options.map((o) => o.id)]), [["H2", ["block", "pass"]], ["H1", ["r:guardian", "pass"]]], "E: the window is open to the target and to the third party who holds a reaction");
  await T.req("p2", { op: "answer", prompt: T.prompt("reaction", "H2").id, value: "pass" });
  eq(T.top().step, "reactBefore", "E: waits for everyone entitled");
  await T.req("p1", { op: "answer", prompt: T.prompt("reaction", "H1").id, value: "r:guardian" });
  eq([T.top().decl.targets, T.top().data.retargets], [["H1"], [{ from: "H2", to: "H1", by: "guardian" }]], "E: the reactor is the target now");
  const np = T.prompt("reaction", "H1");
  eq(np.options.map((o) => [o.id, o.disabled ?? null]), [["block", null], ["pass", null]], "E: the new target gets its own window (the swap took one quick action, the other grant still pays a block)");
  eq(T.top().step, "reactBefore", "E: waits for the new target");
  await T.req("p1", { op: "answer", prompt: np.id, value: "pass" });
  await T.roll("attack", 1);
  eq([T.c.H1.health, T.c.H2.health], [4, 6], "E: the damage went to the new target");
  // GM retarget override
  const G = base();
  await G.req("p1", slug("H1", "N1"));
  eq(code(await G.gm({ op: "retarget", inst: G.top().id, from: "N1", to: "N2" })), "ok", "E: GM retarget");
  eq([G.top().decl.targets, G.prompts("reaction").map((p) => p.about)], [["N2"], ["N2"]], "E: window reopened for the new target only");
  // automatic miss
  const A = base(); A.turn("N1");
  await A.gm({ op: "powerGrant", combatant: "H2", entry: PHASE });
  await A.gm(slug("N1", "H2"));
  await A.req("p2", { op: "answer", prompt: A.prompt("reaction", "H2").id, value: "r:phase" });
  await A.roll("attack", 4);
  eq([A.state.stack.length, A.c.H2.health, A.c.H2.resolve, A.evs("outcome").at(-1).autoMiss], [0, 6, 4, "phase"], "E: auto-miss reaction: no damage, 1 stress paid");
}

/* ================================================================== F: hazard as initiator (fire), injuries, undo */
{
  const T = base(); T.c.H2.health = 2;
  T.dice.push([6, 6, 1], [2, 3, 4], [5]);       // H2: 2 sixes; N2: none; then the injury D6
  eq(code(await T.req("p1", { op: "hazard", hazard: { kind: "fire", intensity: 3 }, targets: ["H2", "N2"] })), "noPermission", "F: players cannot start hazards");
  const b0 = snap(T);
  eq(code(await T.gm({ op: "hazard", hazard: { kind: "fire", intensity: 3 }, targets: ["H2", "N2"] })), "ok", "F: fire attack");
  eq([T.state.stack.length, T.requests.length, T.prompts().length], [0, 0, 0], "F: nobody rolls, pushes or picks stunts for a hazard");
  eq([T.c.H2.health, T.c.N2.health, T.c.H2.crits], [0, 4, [7]], "F: 2 sixes = 4 damage; broken with 2 excess: injury D6 5 + 2 = 7");
  eq([M.hasStatus(T.state, "H2", "burning"), M.hasStatus(T.state, "H2", "broken"), M.hasStatus(T.state, "N2", "burning")], [true, true, false], "F: damage sets on fire");
  eq(T.evs("crit").at(-1).crit.total, 7, "F: crit event");
  await T.gm({ op: "undo", tx: T.log.list.at(-1).id });
  eq([T.c.H2.health, T.c.H2.crits, T.c.H2.items.length, snap(T) === b0], [2, [], 0, true], "F: undo removes the injury item, restores Health and statuses");
  // a burning character outside a burning zone: no damage ends it
  await T.gm({ op: "statusAdd", combatant: "H1", status: { id: "burning" } });
  T.dice.push([2, 2]);
  await T.gm({ op: "hazard", hazard: { kind: "fire", intensity: 2, inZone: false }, targets: ["H1"] });
  eq(M.hasStatus(T.state, "H1", "burning"), false, "F: fire attack outside a burning zone that does no damage ends burning");
  // fixed damage (what a barrier impact hands over), Armor by the GM's tick [OQ-11]
  await T.gm({ op: "hazard", hazard: { kind: "fixed", amount: 3, cause: "barrier" }, targets: ["N1"] });
  eq(T.c.N1.health, 2, "F: fixed damage, Armor line not ticked");
  await T.gm({ op: "hazard", hazard: { kind: "fixed", amount: 2, armor: true, cause: "barrier" }, targets: ["N1"] });
  eq([T.c.N1.health, T.evs("damage").at(-1).source], [1, "barrier"], "F: with the Armor line ticked");
}

/* ================================================================== G: composite action: several rolls, one transaction */
{
  const T = base();
  await T.gm({ op: "powerGrant", combatant: "H1", entry: { id: "flurry", flow: "composite", cost: "full", parts: [{ action: "slugfest" }, { action: "slugfest" }] } });
  const b0 = snap(T), h0 = hp(T);
  eq(code(await T.req("p1", { op: "declare", actor: "H1", decl: { action: "flurry", targets: ["N2"] } })), "ok", "G: composite declared");
  eq(T.state.stack.map((i) => [i.flow, i.part ?? 0, i.tx === T.state.stack[0].tx]), [["composite", 0, true], ["attack", 1, true]], "G: the first part is a child sharing the transaction");
  await T.answer("gm", "reaction", "pass", "N2");
  await T.roll("attack", 1);
  eq([T.state.stack.length, T.top().data.results?.length ?? T.state.stack[0].data.results.length], [2, 1], "G: second part started after the first");
  await T.answer("gm", "reaction", "pass", "N2");
  await T.roll("attack", 0);
  eq([T.state.stack.length, T.c.N2.health, T.log.list.length - 1], [0, 2, 1], "G: both parts ran (hit, miss); ONE transaction (plus the grant edit)");
  eq(P1.ledgerOf(T.state, "H1").entries.filter((e) => !e.void).length, 1, "G: one ledger entry for the whole action");
  await T.gm({ op: "undo", tx: T.log.list.at(-1).id });
  eq([hp(T), snap(T) === b0], [h0, true], "G: one undo takes back the whole composite");
}

/* ================================================================== H: modifier tokens (orders) and use counters */
{
  const T = base();
  eq(code(await T.req("p1", { op: "declare", actor: "H1", decl: { action: "orders", targets: ["H2"], text: "take the left one" } })), "ok", "H: orders");
  eq([T.lastRequest().attr, T.lastRequest().maxPush], ["presence", null], "H: PRESENCE roll, pushable");
  await T.roll("roll", 2);
  const tok = T.state.tokens[0];
  eq([tok.holder, tok.dice, tok.uses, tok.needsGm, tok.expires.at, tok.from], ["H2", 2, 1, 1, "roundEnd", "H1"], "H: +1 die per six on one roll this round, GM-confirmed purpose");
  await endTurn(T, "p1", "H1"); T.turn("H2");
  await T.req("p2", slug("H2", "N2", { tokens: [tok.id, "nope"] }));
  await T.answer("gm", "reaction", "pass", "N2");
  eq(T.prompt("tokenConfirm")?.data.tokens.map((t) => t.dice), [2], "H: the GM confirms that the roll carries out the order");
  eq(T.requests.filter((r) => r.combatant === "H2").length, 0, "H: no die before the confirmation");
  await T.answer("gm", "tokenConfirm", "approve");
  eq([T.lastRequest().dice, T.lastRequest().pool.mods.map((m) => m.dice), T.state.tokens.length], [6, [2], 0], "H: 4 + 2 dice; the token is spent");
  await T.roll("attack", 0);
  await T.gm({ op: "undo", tx: T.log.list.at(-1).id });
  eq(T.state.tokens.length, 1, "H: undoing the attack returns the token");
  // tokens by hand, scope, negative dice and the one-die floor
  await T.gm({ op: "tokenAdd", token: { holder: "N1", dice: -9, scope: { rolls: ["attack"] }, uses: "all", source: { kind: "power", name: "luck" }, expires: { at: "roundEnd" } } });
  eq(M.tokensFor(T.state, "N1", { kind: "block", attr: "fighting" }).length, 0, "H: a token scoped to attacks is not offered on a block");
  eq(M.spendTokens(T.state, "N1", { kind: "attack", attr: "fighting" }, [T.state.tokens.at(-1).id]).writes.length, 0, "H: a token with uses 'all' is not consumed");
  eq(code(await T.gm({ op: "counterSet", key: M.counterKey.round("H1", "banter:N1"), value: 1 })), "ok", "H: counter set");
  eq([M.counterLeft(T.state, M.counterKey.round("H1", "banter:N1"), 1), M.counterReset(T.state, "round").length], [0, 1], "H: counter read and round reset");
  eq(M.expiredTokens(T.state, { at: "roundEnd" }).length, 2, "H: tokens ending at round end");
}

/* ================================================================== I: overrides on every step */
{
  const T = base();
  await T.req("p1", slug("H1", "N1"));
  const id = T.top().id;
  eq(code(await T.req("p1", { op: "setPool", inst: id, roll: "attack", total: 9 })), "noPermission", "I: players cannot override");
  await T.gm({ op: "setPool", inst: id, roll: "attack", total: 9 });
  await T.answer("gm", "reaction", "pass", "N1");
  eq(T.lastRequest().dice, 9, "I: setPool replaces the pool before the roll");
  await T.gm({ op: "setSixes", inst: id, roll: "attack", sixes: 2 });
  eq([T.top().step, T.top().rolls.attack.forced.sixes], ["stunts", 2], "I: setSixes replaces the result without dice");
  await T.gm({ op: "answerFor", prompt: T.prompt("stunts").id, value: [] });
  eq([T.state.stack.length, T.c.N1.health], [0, 4], "I: closed with normal damage");
  // re-open: a new attack, then setOutcome / setDamage / goToStep after the fact are done while it is open
  const U = base();
  await U.req("p1", slug("H1", "N1"));
  const uid = U.top().id;
  await U.answer("gm", "reaction", "block", "N1");
  await U.roll("attack", 1); await U.roll("def:N1", 1);
  eq(U.state.stack.length, 0, "I: tie = miss, closed");
  const V = base();
  await V.req("p1", slug("H1", "N1"));
  const vid = V.top().id;
  await V.gm({ op: "setOutcome", inst: vid, target: "N1", hit: true });
  await V.gm({ op: "setDamage", inst: vid, target: "N1", amount: 4 });
  await V.answer("gm", "reaction", "pass", "N1");
  await V.roll("attack", 0);
  eq([V.state.stack.length, V.c.N1.health, V.log.list.at(-1).label.gm.includes("hit")], [0, 1, true], "I: setOutcome makes a miss a hit; setDamage replaces the damage");
  void uid;
  // skipStep, goToStep, abort
  const W = base();
  await W.req("p1", slug("H1", "N1"));
  const wid = W.top().id;
  await W.gm({ op: "skipStep", inst: wid });
  eq([W.top().step, W.prompts("reaction").length], ["roll", 0], "I: skipStep closes the window with no effect");
  await W.roll("attack", 2);
  eq(W.top().step, "stunts", "I: at stunts");
  eq(code(await W.gm({ op: "goToStep", inst: wid, step: "reactBefore" })), "ok", "I: goToStep back to the window");
  eq([W.top().step, W.top().locked, W.prompts("reaction").length, W.prompts("stunts").length, Object.keys(W.top().rolls)], ["reactBefore", false, 1, 0, []], "I: later results are gone, the window is open again");
  await W.answer("gm", "reaction", "block", "N1");
  await W.roll("attack", 2); await W.roll("def:N1", 0);
  await W.gm({ op: "answerFor", prompt: W.prompt("stunts").id, value: ["doubleDamage@N1"] });
  eq(W.c.N1.health, 2, "I: resolved again after the rewind");
  const X = base();
  await X.req("p1", slug("H1", "N1"));
  await X.answer("gm", "reaction", "block", "N1");
  await X.gm({ op: "abort", inst: X.top().id, refund: false });
  eq([X.state.stack.length, P1.budget(X.state, "H1").full, P1.budget(X.state, "N1").quick[0], Object.keys(X.state.prompts).length], [0, "used", "open", 0], "I: abort without refund: the action is spent, the defender's block is returned");
  const Y = base();
  await Y.req("p1", slug("H1", "N1"));
  await Y.gm({ op: "abort", inst: Y.top().id });
  eq([Y.state.stack.length, P1.budget(Y.state, "H1").full, Y.log.list.length], [0, "open", 0], "I: abort with refund leaves nothing");
  // resolve manually
  const Z = base();
  await Z.req("p1", slug("H1", "N1"));
  await Z.gm({ op: "manual", inst: Z.top().id, result: { note: "by hand", damage: [{ target: "N1", amount: 9 }], statuses: [{ who: "N1", id: "trapped" }] } });
  eq([Z.state.stack.length, Z.c.N1.health, M.hasStatus(Z.state, "N1", "trapped"), Z.log.list.at(-1).label.gm.includes("manual")], [0, 0, true, true], "I: manual resolution applies what the GM entered (Health never below 0)");
  await Z.gm({ op: "undo", tx: Z.log.list.at(-1).id });
  eq([Z.c.N1.health, M.hasStatus(Z.state, "N1", "trapped"), P1.budget(Z.state, "H1").full], [5, false, "open"], "I: and is undoable");
  eq(Z.evs("override").length > 0, true, "I: override events on the GM stream");
}

/* ================================================================== J: automatic passes and NPC defaults */
{
  const T = base();
  await T.gm({ op: "statusAdd", combatant: "N1", status: { id: "unaware" } });
  await T.req("p1", slug("H1", "N1"));
  eq([T.top().step, T.prompts().length, Object.values(T.state.prompts)[0].auto, T.lastRequest().pool.mods], ["roll", 0, { option: "pass", reason: "unaware" }, [{ source: "unaware", dice: 2 }]], "J: an unaware target cannot block: passed automatically, +2 for the attacker");
  const U = base(); U.turn("N1");
  U.state = { ...U.state, ledger: { ...U.state.ledger, H2: { ...Lg.newLedger(1), grants: Lg.newLedger(1).grants.map((g) => ({ ...g, usedBy: "x" })) } } };
  await U.gm(slug("N1", "H2"));
  eq([U.top().step, Object.values(U.state.prompts)[0].auto.reason], ["roll", "noOption"], "J: no quick action left -> never shown");
  const V = base();
  await V.gm({ op: "npcPolicy", combatant: "N1", policy: { block: "always", onBroken: "ko" } });
  await V.req("p1", slug("H1", "N1"));
  eq([V.top().step, Object.values(V.state.prompts).find((p) => p.kind === "reaction").auto, V.top().data.def.N1.defence], ["roll", { option: "block", reason: "npcDefault" }, "block"], "J: NPC default reaction");
  const W = base();
  await W.req("p1", slug("H1", "N1"));
  await W.gm({ op: "answerFor", prompt: W.prompt("reaction").id, value: { id: "block", always: true } });
  eq(W.state.npc.N1.block, "always", "J: 'always do this for this NPC'");
  // stun: immediate passive PRESENCE roll, lost turn
  const S = base(); S.c.H1.attrs.fighting = 6;
  await S.req("p1", slug("H1", "N2"));
  await S.answer("gm", "reaction", "pass", "N2");
  await S.roll("attack", 3);
  await S.req("p1", { op: "answer", prompt: S.prompt("stunts").id, value: ["stun@N2", "trap@N2"] });
  eq([S.lastRequest().key, S.lastRequest().attr, S.lastRequest().maxPush, S.lastRequest().users], ["stun:N2", "presence", 0, ["gm"]], "J: Stun -> the target's passive PRESENCE roll");
  await S.roll("stun:N2", 0);
  eq([S.state.stack.length, !!S.state.ledger.N2.lostTurn, S.state.ledger.N2.noInterrupts, M.hasStatus(S.state, "N2", "stunned"), M.hasStatus(S.state, "N2", "trapped")], [0, true, 1, true, true], "J: failed -> misses the next turn, no interrupts; Trap applied");
  S.turn("H2");
  await S.req("p2", slug("H2", "N2"));
  eq(Object.values(S.state.prompts).find((p) => p.about === "N2")?.auto?.reason, "noOption", "J: a stunned target has no reaction (auto-pass)");
}

/* ================================================================== K: player requests and their refusals */
{
  const T = base();
  eq(code(await T.req("p2", slug("H2", "N1"))), "notYourTurn", "K: a full action only on your own turn");
  eq(code(await T.req("p1", { op: "declare", actor: "H1", decl: { action: "nonsense", targets: [] } })), "unknown", "K: unknown action");
  eq(code(await T.req("p1", { op: "declare", actor: "H1", decl: { action: "block", targets: ["N1"] } })), "unknown", "K: a defence is not declared as an action");
  T.setRange("H1", "N1", 2);
  const r = await T.req("p1", slug("H1", "N1"));
  eq([code(r), r.error.params.reason, r.error.key], ["illegal", "outOfReach", "ITAC.err.illegal"], "K: out of slugfest reach");
  const x = await T.req("p1", slug("H1", "N1", { exception: { text: "I throw a car" } }));
  eq([code(x), T.prompt("exception")?.data.reason, T.top().status], ["ok", "outOfReach", "waiting"], "K: the same with an exception request waits on the GM desk");
  await T.answer("gm", "exception", "deny");
  eq([T.state.stack.length, P1.budget(T.state, "H1").full], [0, "open"], "K: denied: removed and refunded");
  await T.req("p1", slug("H1", "N1", { exception: { text: "please" } }));
  await T.answer("gm", "exception", "grant");
  eq(T.top().step, "reactBefore", "K: granted: the action runs");
  eq(code(await T.req("p1", { op: "amend", inst: T.top().id, decl: { targets: ["N2"] } })), "ok", "K: amend before the lock");
  eq([T.top().decl.targets, T.prompts("reaction").map((p) => p.about)], [["N2"], ["N2"]], "K: amended; the window reopened for the new target");
  eq(code(await T.req("p2", { op: "cancel", inst: T.top().id })), "notOwner", "K: only the owner cancels");
  eq(code(await T.req("p1", { op: "cancel", inst: T.top().id })), "ok", "K: cancel before the lock");
  eq([T.state.stack.length, P1.budget(T.state, "H1").full, T.log.list.length], [0, "open", 0], "K: removed and refunded");
  await T.req("p1", slug("H1", "N2"));
  await T.answer("gm", "reaction", "pass", "N2");
  const c = await T.req("p1", { op: "cancel", inst: T.top().id });
  eq([code(c), T.prompt("exception")?.data.reason], ["ok", "cancelLocked"], "K: cancel after the lock becomes a desk card");
  await T.answer("gm", "exception", "forfeit");
  eq([T.state.stack.length, P1.budget(T.state, "H1").full], [0, "used"], "K: the GM rules it forfeit");
  // duplicate request id, end turn
  const U = base();
  eq(code(await U.req("p1", slug("H1", "N1"), "p1:same")), "ok", "K: first delivery");
  const d = await U.req("p1", slug("H1", "N1"), "p1:same");
  eq([d.ok, d.dup, U.state.stack.length], [true, true, 1], "K: the same request id twice is applied once (two GM tabs)");
  eq(code(await U.req("p1", { op: "endTurn", actor: "H1", round: 1, slot: U.state.init.cur })), "busy", "K: no end of turn under an open action");
  await U.gm({ op: "abort", inst: U.top().id });
  eq(code(await U.req("p1", { op: "endTurn", actor: "H1", round: 7, slot: U.state.init.cur })), "stale", "K: stale end-turn refused");
  eq(code(await U.req("p2", { op: "endTurn", actor: "H1", round: 1, slot: U.state.init.cur })), "notOwner", "K: end turn by a stranger");
  U.settings.turnPlayersEnd = false;
  eq(code(await U.req("p1", { op: "endTurn", actor: "H1", round: 1, slot: U.state.init.cur })), "playersOff", "K: world setting turnPlayersEnd");
  U.settings.turnPlayersEnd = true;
  eq(code(await U.req("p1", { op: "endTurn", actor: "H1", round: 1, slot: U.state.init.cur })), "ok", "K: end turn");
  eq(U.state.init.curMember, "N1", "K: next in order");
  // help [L9], [R11]
  const H = base();
  await H.req("p1", slug("H1", "N1"));
  eq(code(await H.req("p2", { op: "help", inst: H.top().id, helper: "H2" })), "ok", "K: help offered");
  eq([H.top().decl.helpers, P1.budget(H.state, "H2").full], [[{ id: "H2", consent: "yes" }], "used"], "K: the helper's full action is spent on the helped character's turn");
  H.state = { ...H.state, ledger: { ...H.state.ledger, N2: P1.pay(H.state, "N2", "full", { force: true }, { action: "x" }).ledger } };
  await H.gm({ op: "help", inst: H.top().id, helper: "N2" });
  eq([H.prompt("helpOverride")?.about, H.top().decl.helpers[1]], ["N2", { id: "N2", consent: "pending" }], "K: no free full action -> refused by the interface, GM card");
  await H.answer("gm", "helpOverride", "accept");
  await H.answer("gm", "reaction", "pass", "N1");
  eq(H.lastRequest().pool.mods, [{ source: "help", dice: 2 }], "K: +1 die per accepted helper");
  // something else
  const O = base();
  eq(code(await O.req("p1", { op: "other", actor: "H1", text: "I rip the lamp post out" })), "ok", "K: something else");
  eq([O.top().flow, O.top().status, O.top().decl.text], ["other", "manual", "I rip the lamp post out"], "K: a GM-driven instance");
  await O.gm({ op: "manual", inst: O.top().id, result: { cost: "full", note: "ok" } });
  eq([O.state.stack.length, P1.budget(O.state, "H1").full], [0, "used"], "K: the GM sets the cost");
  eq(code(await O.req("p1", { op: "exception", actor: "H1", text: "may I?" })), "ok", "K: free-standing exception request");
  eq(O.prompt("exception")?.data.text, "may I?", "K: card on the desk");
  await O.answer("gm", "exception", "grant");
  eq(O.prompts().length, 0, "K: answered and closed");
  eq([O.top()?.flow, O.top()?.status, O.top()?.decl.text, O.state.news.at(-1)?.kind, O.state.news.at(-1)?.granted, O.state.news.at(-1)?.ran], ["other", "manual", "may I?", "exception", true, 2], "K (U3): a granted free-standing request opens the action by hand for the GM and tells the asker");
  await O.gm({ op: "manual", inst: O.top().id, result: { cost: "none" } });
  eq([code(await O.req("p1", { op: "move", actor: "H1", to: "z2" })), O.last.error?.params?.reason], ["illegal", "noZones"], "K: a move on a scene without zones is refused (the GM resolves it by hand; check-move.mjs runs the flow)");
}

/* ================================================================== L: free mode and switching off */
{
  const T = base();
  await T.gm({ op: "setFree", combatant: "H1", on: true });
  await T.req("p1", slug("H1", "N1", { targets: ["N1"] }));
  eq([T.top().status, T.prompts().length, P1.budget(T.state, "H1").full], ["manual", 0, "open"], "L: a free participant is logged as declared: no validation, no prompts, no cost");
  await T.gm({ op: "manual", inst: T.top().id, result: {} });
  await T.gm({ op: "setFree", combatant: "H1", on: false });
  await T.req("p1", slug("H1", "N1"));
  await T.gm({ op: "setMode", mode: "free" });
  eq([T.state.stack.length, T.top().status], [1, "manual"], "L: switching the mode never discards state; open instances are parked as manual");
  await T.gm({ op: "setMode", mode: "off" });
  eq(code(await T.req("p1", slug("H1", "N1"))), "off", "L: off");
}

/* ================================================================== M: push order switch [R3] */
{
  const T = base({ pushOrder: "beforeDefence" });
  await T.req("p1", slug("H1", "N1"));
  await T.answer("gm", "reaction", "block", "N1");
  await T.roll("attack", 1, { pushable: true });
  eq(T.requests.length, 1, "M: beforeDefence: no defender die while the attacker may still push");
  await T.roll("attack", 3, { pushed: 1 });
  eq(T.requests.map((r) => r.key), ["attack", "def:N1"], "M: then the defender rolls");
  await T.roll("def:N1", 1, { pushable: true });
  eq(T.top().rolls["def:N1"].pushable, false, "M: a defender's roll is never pushable, whatever the message says");
}

/* ================================================================== N: grapple, shooting, heroes' injuries, stress to Resolve, minions, facts */
{
  const T = base();
  await T.req("p1", { op: "declare", actor: "H1", decl: { action: "grapple", targets: ["N1"] } });
  await T.answer("gm", "reaction", "pass", "N1");
  await T.roll("attack", 3);
  eq([T.state.stack.length, T.c.N1.health, M.hasStatus(T.state, "N1", "grappled"), M.hasStatus(T.state, "H1", "grappling"), T.prompts().length], [0, 5, true, true, 0], "N: the grapple that takes hold: no damage, no stunts, statuses set");
  eq(M.conditions(T.state, "N1").held, true, "N: grappled maps to the library's 'held'");
  await endTurn(T, "p1", "H1"); T.turn("H2");
  await T.req("p2", slug("H2", "N1"));
  eq([Object.values(T.state.prompts)[0].auto?.reason, T.lastRequest().pool.mods], ["noOption", [{ source: "restrained", dice: 2 }]], "N: a held target cannot defend; +2 in slugfest");
  // shooting
  const S = base(); S.weapons.pistol = { id: "pistol", name: "Pistol", bonus: 1, damage: 2, range: [0, 2], sharp: true };
  eq((await S.req("p1", { op: "declare", actor: "H1", decl: { action: "shoot", targets: ["N1"] } })).error.params.reason, "noWeapon", "N: shooting needs a weapon");
  S.setRange("H1", "N1", 3);
  eq((await S.req("p1", { op: "declare", actor: "H1", decl: { action: "shoot", weapon: "pistol", targets: ["N1"] } })).error.params.reason, "tooFar", "N: beyond the maximum range");
  S.setRange("H1", "N1", null);
  eq((await S.req("p1", { op: "declare", actor: "H1", decl: { action: "shoot", weapon: "pistol", targets: ["N1"] } })).error.params.reason, "noRange", "N: no attack to or from an off-map area");
  S.setRange("H1", "N1", 2);
  await S.req("p1", { op: "declare", actor: "H1", decl: { action: "shoot", weapon: "pistol", targets: ["N1"] } });
  eq(S.prompt("reaction").options.map((o) => o.id), ["dodge", "pass"], "N: a shot is answered by a dodge");
  await S.answer("gm", "reaction", "dodge", "N1");
  eq([S.lastRequest().attr, S.lastRequest().dice], ["agility", 4], "N: AGILITY + weapon bonus");
  await S.roll("attack", 1); await S.roll("def:N1", 3);
  eq([S.prompt("dodgeMove")?.options[0].data.zones, S.prompt("counter")], [2, null], "N: a dodge with surplus sixes offers the dodge move, not a counterattack");
  await S.answer("gm", "dodgeMove", "pass");
  eq(S.state.stack.length, 0, "N: closed");
  // a hero broken by an attack: injury D6 + excess; Deadly Hit with sharp damage [R9]
  const C = base(); C.turn("N1"); C.c.H2.health = 1; C.weapons.blade = { id: "blade", name: "Blade", bonus: 0, damage: 3, range: null, sharp: true };
  C.dice.push([4]);
  await C.gm(slug("N1", "H2", { weapon: "blade" }));
  await C.req("p2", { op: "answer", prompt: C.prompt("reaction", "H2").id, value: "pass" });
  await C.roll("attack", 2);
  await C.answer("gm", "stunts", ["deadlyHit@H2"]);
  eq([C.c.H2.health, C.c.H2.crits, C.top()?.id ?? null], [0, [7], null], "N: 3 damage at Health 1: excess 2, Deadly Hit bonus 3 -> one roll with the higher bonus: 4 + 3 = 7");
  // toStress damage
  const R = base();
  await R.gm({ op: "powerGrant", combatant: "H1", entry: { id: "mindBlast", flow: "attack", attack: "shooting", cost: "full", damage: { base: 2, toStress: true, source: "psychic" }, range: [0, 3] } });
  R.weapons.mind = { id: "mind", name: "mind", bonus: 0, damage: 2, range: [0, 3] };
  await R.req("p1", { op: "declare", actor: "H1", decl: { action: "mindBlast", weapon: "mind", targets: ["N1"] } });
  await R.answer("gm", "reaction", "pass", "N1");
  await R.roll("attack", 1);
  eq([R.c.N1.health, R.c.N1.resolve], [5, 3], "N: damage turned into stress lowers Resolve, Armor not used");
  // minions attack together
  const Mn = base(); Mn.npc("G1", { kind: "minions", members: 5, health: 5 }); Mn.order(["G1", "H1", "N1", "H2", "N2"]);
  await Mn.gm(slug("G1", "H1"));
  await Mn.req("p1", { op: "answer", prompt: Mn.prompt("reaction").id, value: "pass" });
  eq(Mn.lastRequest().pool.mods, [{ source: "minions", dice: 4 }], "N: five minions attack with the helping rule: +4");
}

/* ================================================================== O: journal discipline: forced single undo with a drift check */
{
  const T = base();
  await T.req("p1", slug("H1", "N1")); await T.answer("gm", "reaction", "pass", "N1"); await T.roll("attack", 1);
  await endTurn(T, "p1", "H1"); T.turn("N1"); await endTurn(T, "gm", "N1"); T.turn("H2");
  await T.req("p2", slug("H2", "N1")); await T.answer("gm", "reaction", "pass", "N1"); await T.roll("attack", 1);
  eq([T.c.N1.health, T.log.list.length], [3, 2], "O: two attacks on N1");
  const first = T.log.list[0].id;
  const d = await T.gm({ op: "undo", tx: first, force: true });
  eq([code(d), d.error.params.list.map((x) => [x.t, x.expected, x.current])], ["drift", [["actor", 4, 3]]], "O: forced single undo: the Health moved on since -> listed, nothing changed");
  eq(T.c.N1.health, 3, "O: nothing applied yet");
  await T.gm({ op: "undo", tx: first, force: true, drift: "difference" });
  eq([T.c.N1.health, T.log.list.map((t) => t.state), P1.budget(T.state, "H1").full, P1.budget(T.state, "H2").full], [4, ["undone", "closed"], "open", "used"], "O: 'apply the difference' gives the first hit back and leaves the later action alone");
  const U = base();
  await U.req("p1", slug("H1", "N1")); await U.answer("gm", "reaction", "pass", "N1"); await U.roll("attack", 1);
  await U.gm({ op: "setHealth", combatant: "N1", value: 1 });
  eq(U.log.list.length, 2, "O: a GM edit is a transaction of its own");
  await U.gm({ op: "undo", tx: U.log.list[0].id, force: true, drift: "leave" });
  eq(U.c.N1.health, 1, "O: 'leave' keeps the drifted value");
  await U.gm({ op: "undo", tx: U.log.list[1].id });
  eq(U.c.N1.health, 4, "O: undoing the edit restores what it replaced");
  // zone command with an inverse built by the adapter joins the journal
  await U.gm({ op: "zoneSet", zone: "z1", patch: { wrecked: true } });
  eq(U.zoneMarks.z1.wrecked, true, "O: zone command performed");
  await U.gm({ op: "undo", tx: U.log.list.at(-1).id });
  eq([U.zoneMarks.z1.wrecked ?? null, U.zonesLog.at(-1).undo], [null, { op: "zone", zone: "z1", patch: { wrecked: null } }], "O: undo gives the inverse the zones API returned back to it");
  eq(code(await U.gm({ op: "zoneSet", zone: "z1", patch: { smoke: true } })), "badInput", "O: the engine never invents a zone state");
  const sl = U.state.init.slots.find((x) => x.members.includes("H1"));
  eq([code(await U.gm({ op: "setCard", combatant: "H1", card: 3 })), code(await U.gm({ op: "setCard", slot: sl.id, card: 10 })), U.state.init.slots.find((x) => x.id === sl.id).card], ["badInput", "ok", 10], "O: initiative operations run in the round driver, through the same door");
  eq(code(await U.gm({ op: "explode" })), "badInput", "O: unknown operation");
}

/* ---- P. catalog predicates through rules/conditions.mjs: `requires` at declaration, `roll.mods` in the pool */
{
  const FIN = { id: "finisher", flow: "attack", attack: "slugfest", cost: "full", roll: { attr: "fighting", mods: [
      { source: "wounded", dice: 2, when: { fact: "target.health", op: "lte", value: 2 } },
      { source: "oath", dice: 1, when: { gm: "oath" } },
      { source: "shotOnly", dice: 3, rolls: ["shot"] }] },
    requires: [{ check: "hasStatus", args: { id: "grappled", who: { ref: "target.id" } }, reason: "targetNotHeld" }, { fact: "sameZone", reason: "notSameZone" }] };
  const T = base();
  eq(code(await T.gm({ op: "powerGrant", combatant: "H1", entry: { ...FIN, id: "broken1", requires: { fact: 7 } } })), "badInput", "P: an entry whose requirement cannot be read is refused whole");
  eq(code(await T.gm({ op: "powerGrant", combatant: "H1", entry: { ...FIN, id: "broken2", roll: { attr: "fighting", mods: [{ source: "x", dice: "many" }] } } })), "badInput", "P: so is one with an unreadable modifier rule");
  eq(code(await T.gm({ op: "powerGrant", combatant: "H1", entry: FIN })), "ok", "P: an entry with requirements and conditional modifiers is granted");
  const passN1 = async () => { const p = T.prompt("reaction", "N1"); if (p) await T.req("gm", { op: "answerFor", prompt: p.id, value: "pass" }); };
  const fin = (extra = {}) => ({ op: "declare", actor: "H1", decl: { action: "finisher", targets: ["N1"], ...extra } });
  const r0 = await T.req("p1", fin());
  eq([code(r0), r0.error.params.reason, r0.error.params.why, r0.error.params.target, T.state.stack.length], ["illegal", "requirement", "targetNotHeld", "N1", 0], "P: the requirement fails with its own reason: nothing is declared, nothing is paid");
  await T.gm({ op: "statusAdd", combatant: "N1", status: { id: "grappled" } });
  T.setRange("H1", "N1", 1);
  eq((await T.req("p1", fin())).error.params.why, "notSameZone", "P: every condition of the list must hold; facts come from the snapshot (range)");
  T.setRange("H1", "N1", 0);
  eq(code(await T.req("p1", fin())), "ok", "P: with the requirements met the action is declared");
  await passN1();
  eq([T.lastRequest().pool.mods.map((m) => m.source), T.top().data.notes?.filter((n) => n.note === "modNeedsGm").map((n) => n.source)], [["restrained"], ["oath"]], "P: none of the entry's modifiers applies at Health 5 (the held target gives its own); the one only the GM can vouch for is noted for the desk, not guessed");
  await T.gm({ op: "abort", inst: T.top().id });
  T.c.N1.health = 2;
  eq(code(await T.gm({ ...fin({ confirmed: ["oath"] }), gm: true })), "ok", "P: declared by the GM, who vouches for the condition");
  await passN1();
  eq(T.lastRequest().pool.mods, [{ source: "restrained", dice: 2 }, { source: "wounded", dice: 2 }, { source: "oath", dice: 1 }], "P: conditional modifiers enter the pool when their condition holds; a rule for another kind of roll does not");
  await T.gm({ op: "abort", inst: T.top().id });
  eq((await T.req("p1", fin({ confirmed: ["oath"] }))).ok && !T.top().decl.confirmed, true, "P: a player cannot vouch for a GM condition");
  await T.gm({ op: "abort", inst: T.top().id });
  // a check nobody supplies needs the GM's word: the exception path of spec 9.12
  await T.gm({ op: "powerGrant", combatant: "H1", entry: { id: "ritual", flow: "roll", cost: "full", roll: { attr: "presence" }, requires: { check: "moonIsFull" } } });
  const r1 = await T.req("p1", { op: "declare", actor: "H1", decl: { action: "ritual" } });
  eq([code(r1), r1.error.params.why, r1.error.params.gmMayAllow], ["illegal", "unknownCheck", 1], "P: a check the engine does not know fails and says the GM may allow it");
  eq(code(await T.req("p1", { op: "declare", actor: "H1", decl: { action: "ritual", exception: { text: "the moon is full tonight" } } })), "ok", "P: asked as an exception it becomes the GM's card");
  eq(T.prompt("exception")?.data.reason, "requirement", "P: the exception card names the requirement");
  // history check: a question to the real ledger
  const H = base();
  await H.gm({ op: "powerGrant", combatant: "H1", entry: { id: "second", flow: "roll", cost: "quick", roll: { attr: "agility" }, requires: { not: { check: "history", args: { scope: "round", tag: "attack" } }, reason: "alreadyAttacked" } } });
  eq(code(await H.req("p1", { op: "declare", actor: "H1", decl: { action: "second" } })), "ok", "P: history check before any attack");
  await H.gm({ op: "abort", inst: H.top().id });
  await H.req("p1", slug("H1", "N1")); await H.gm({ op: "abort", inst: H.top().id });
  eq(code(await H.req("p1", { op: "declare", actor: "H1", decl: { action: "second" } })), "ok", "P: an aborted attack left no history (its entry was taken back)");
  await H.gm({ op: "abort", inst: H.top().id });
  await H.req("p1", slug("H1", "N1"));
  await H.req("gm", { op: "answerFor", prompt: H.prompt("reaction", "N1").id, value: "pass" });
  await H.roll("attack", 0);
  eq([H.state.stack.length, (await H.req("p1", { op: "declare", actor: "H1", decl: { action: "second" } })).error?.params?.why ?? null], [0, "alreadyAttacked"], "P: after a finished attack the real ledger's history answers the check");
  // immunity flags of the rules library (huge, grown, impervious, a free list): the engine passes them, the library decides
  const G = new Table(); G.hero("H1", "p1").npc("N1", { grown: true }).npc("N2", { huge: true }).npc("N3", { immune: ["grapple"] }).npc("N4"); G.order(["H1", "N1", "N2", "N3", "N4"]).turn("H1");
  const grab = async (t) => { const r = await G.req("p1", { op: "declare", actor: "H1", decl: { action: "grapple", targets: [t] } }); if (r.ok) await G.gm({ op: "abort", inst: G.top().id }); return r.ok ? "ok" : r.error.params.reason; };
  eq([await grab("N1"), await grab("N2"), await grab("N3"), await grab("N4")], ["immune", "huge", "immune", "ok"], "P: a grown target, a huge one and one on the free list cannot be grappled; an ordinary one can");
}

done("check-engine");
