/* node scripts/tactics/check-ledger.mjs -- the action ledger (spec section 4) against its rules.
   The truth table: EVERY sequence of up to five payments out of { full on turn, full off turn, quick on turn, quick as an interrupt,
   quick off turn without being an interrupt } is compared with an independent oracle of L1-L5. */
import * as Lg from "./ledger-pure.mjs";
import { ok, eq, done } from "./testkit.mjs";

const KINDS = {
  F: { cost: "full", onTurn: true },                       // full action on the own turn
  f: { cost: "full", onTurn: false },                      // full action out of turn                  [L2] never
  Q: { cost: "quick", onTurn: true },                      // quick action on the own turn
  i: { cost: "quick", onTurn: false, interrupt: true },    // quick action as an interrupt             [L4]
  q: { cost: "quick", onTurn: false }                      // quick action out of turn, not declared as an interrupt   [L4] never
};
/* the oracle: [L1] one full + one quick, or two quick; [L2] full only on the own turn; [L3] two quick forfeit the full; [L4] out of turn only interrupts */
function oracle(seq) {
  let full = 0, quick = 0;
  const res = [];
  for (const k of seq) {
    let legal;
    if (k === "f" || k === "q") legal = false;
    else if (k === "F") legal = full === 0 && quick <= 1;
    else legal = full === 0 ? quick <= 1 : quick === 0;
    if (legal) { if (k === "F") full++; else quick++; }
    res.push(legal);
  }
  return res;
}
function play(seq) {
  let L = Lg.newLedger(1);
  L = Lg.turnStart(L).ledger;
  const res = [];
  for (const k of seq) { const r = Lg.pay(L, KINDS[k], { action: "t" }); res.push(r.ok); if (r.ok) L = r.ledger; }
  return { res, L };
}
const letters = Object.keys(KINDS);
let n = 0;
(function walk(seq) {
  if (seq.length) { n++; eq(play(seq).res, oracle(seq), `sequence ${seq.join("")}`); }
  if (seq.length < 5) for (const l of letters) walk([...seq, l]);
})([]);
ok(n === 5 + 25 + 125 + 625 + 3125, "every sequence up to length 5 was played");

/* the budget read (spec 18) after each legal combination */
const b = (seq) => { const x = Lg.budget(play(seq).L); return [x.full, ...x.quick].join(","); };
eq(b([]), "open,open,open", "fresh budget");
eq(b(["F"]), "used,open,lost", "full spent: one quick left");
eq(b(["F", "Q"]), "used,used,lost", "full + quick");
eq(b(["Q"]), "open,used,open", "one quick spent");
eq(b(["Q", "Q"]), "lost,used,used", "[L3] two quick: the full action is forfeited");
eq(b(["i", "i"]), "lost,used,used", "[L3] two interrupts forfeit the full action too");
eq(b(["Q", "F"]), "used,used,lost", "quick then full");
ok(Lg.spent(play(["F", "Q"]).L) && Lg.spent(play(["Q", "Q"]).L) && !Lg.spent(play(["F"]).L), "spent()");
ok(play(["Q", "Q"]).L.entries.length === 2 && Lg.pay(play(["Q"]).L, KINDS.Q, {}).forfeitsFull === true, "the second quick action says it forfeits the full action");

/* reasons */
let L = Lg.turnStart(Lg.newLedger(1)).ledger;
eq(Lg.canPay(L, KINDS.f).reason, "fullOnTurn", "[L2] reason");
eq(Lg.canPay(L, KINDS.q).reason, "notYourTurn", "[L4] reason");
ok(Lg.canPay(L, KINDS.f).gmMayAllow === true, "the GM may allow");
eq(Lg.canPay(L, { cost: "full", onTurn: false, cause: "help" }).ok, true, "[L9] [I13] a helper's full action is spent on the helped character's turn");
eq(Lg.canPay(L, { cost: "free", onTurn: false, tags: ["ownTurnOnly"] }).reason, "notYourTurn", "[L6] free movement inside a zone only on the own turn");
eq(Lg.canPay(L, { cost: "free", onTurn: true, tags: ["ownTurnOnly"] }).ok, true, "[L6] on the own turn it is free");
eq(Lg.canPay(L, { cost: "none", onTurn: false }).ok, true, "no cost");
eq(Lg.canPay(L, { cost: "weird", onTurn: true }).reason, "badCost", "unknown cost");

/* [L5] reset: nothing carries over, except the facts of the last turns and a pending lost turn */
let r = Lg.pay(L, KINDS.F, { action: "slugfest", tags: ["attack"] }); L = r.ledger;
r = Lg.pay(L, KINDS.Q, { action: "move", tags: ["move"], borders: 2 }); L = r.ledger;
ok(Lg.history(L, "thisTurn", "attacked") === true && Lg.history(L, "thisTurn", "moved") === 2 && Lg.history(L, "round", "acted") === true, "facts of the turn");
L = Lg.turnEnd(L);
let L2 = Lg.newLedger(2, L);
eq(Lg.budget(L2).full + Lg.budget(L2).quick.join(""), "openopenopen", "[L5] a new round gives everything back");
eq(L2.entries.length, 0, "[L5] no entry is carried over");
ok(Lg.history(L2, "thisTurn", "attacked") === true, "[I10] before the next own turn, the last turn is still the one of the round before");
ok(Lg.history(L2, "round", "attacked") === false && Lg.history(L2, "round", "moved") === 0, "the round's own facts are new");
L2 = Lg.turnStart(L2).ledger;
ok(Lg.history(L2, "prevTurn", "attacked") === true && Lg.history(L2, "prevTurn", "moved") === 2 && Lg.history(L2, "thisTurn", "attacked") === false, "[I10] previous turn = the turn of the round before");
ok(Lg.history(L2, "prevTurn", "move") === true && Lg.history(L2, "prevTurn", "nothing") === false, "tags are facts too");

/* interrupts are facts of the round, not of the own turn */
let Li = Lg.turnEnd(Lg.turnStart(Lg.newLedger(1)).ledger);
Li = Lg.pay(Li, KINDS.i, { action: "dodge", tags: ["defence"] }).ledger;
ok(Lg.history(Li, "round", "defence") && !Lg.history(Li, "thisTurn", "defence"), "an interrupt is not part of the own turn");
ok(Li.entries[0].interrupt === 1 && !Li.entries[0].own, "the entry is marked as an interrupt");

/* voiding gives the unit back and removes the fact */
let Lv = Lg.turnStart(Lg.newLedger(1)).ledger;
const pv = Lg.pay(Lv, KINDS.F, { action: "shoot", tags: ["attack", "shot:rifle"] }); Lv = pv.ledger;
eq(Lg.history(Lv, "thisTurn", "shot"), ["rifle"], "shot weapons are recorded");
Lv = Lg.voidEntry(Lv, pv.entry.id).ledger;
ok(Lg.budget(Lv).full === "open" && !Lg.history(Lv, "round", "attacked") && Lg.history(Lv, "thisTurn", "shot").length === 0, "a voided entry never happened");
eq(Lg.voidEntry(Lv, pv.entry.id).reason, "unknownEntry", "voiding twice is refused");
eq(Lg.countTag(Lg.pay(Lv, KINDS.Q, { tags: ["banter"], target: ["x"] }).ledger, "banter", "x"), 1, "countTag by target");

/* [L7] lost turn: consumed at the next turn start, no interrupts until then, survives the round reset */
let Ls = Lg.loseNextTurn(Lg.newLedger(1), { kind: "stunt", name: "stun" });
eq(Lg.canPay(Ls, KINDS.i).reason, "noInterrupts", "[L7] no interrupt actions until the lost turn");
ok(Lg.budget(Ls).lostTurn && Lg.budget(Ls).noInterrupts, "budget shows the lost turn");
Ls = Lg.newLedger(2, Ls);
ok(Ls.lostTurn && Ls.noInterrupts === 1, "[L7] the lost turn waits in the next round");
const ts = Lg.turnStart(Ls);
ok(ts.lost === true && !ts.ledger.lostTurn && !ts.ledger.noInterrupts && !ts.ledger.open, "[L7] the turn is consumed and the ban ends");
eq(Lg.canPay(ts.ledger, KINDS.i).ok, true, "[L7] interrupts are back after the lost turn");
ok(Lg.turnStart(ts.ledger).lost === false, "[L7] only one turn is lost");
ok(!Lg.clearLostTurn(Lg.loseNextTurn(Lg.newLedger(1))).lostTurn, "the GM can clear it");

/* [L8] only the full action is lost, for this round */
let Lf = Lg.loseFull(Lg.turnStart(Lg.newLedger(3)).ledger, null);
eq(Lg.canPay(Lf, KINDS.F).reason, "noFull", "[L8] no full action");
eq(Lg.canPay(Lf, KINDS.Q).ok, true, "[L8] quick actions stay");
eq(Lg.budget(Lf).full, "lost", "[L8] budget");
eq(Lg.budget(Lf).quick[1], Lg.NO_FULL_BLOCKS_SECOND_QUICK ? "lost" : "open", "[L8] the second quick action follows the named constant");
ok(!Lg.newLedger(4, Lf).noFull, "[L8] gone in the next round");
ok(!Lg.clearNoFull(Lf).noFull, "the GM can clear it");

/* grants (spec 4.2) */
let Lq = Lg.turnStart(Lg.newLedger(1)).ledger;
let g = Lg.addGrant(Lq, Lg.grantTemplate("quickness"), "me"); Lq = g.ledger;
eq(Lg.addGrant(Lq, Lg.grantTemplate("quickness"), "me").reason, "oncePerRound", "[R1] Quickness once per round");
Lq = Lg.pay(Lq, KINDS.F, {}).ledger; Lq = Lg.pay(Lq, KINDS.Q, {}).ledger;
eq(Lg.canPay(Lq, KINDS.F).reason, "noAction", "base pair spent");
eq(Lg.canPay(Lq, { ...KINDS.F, grant: g.grant.id, resolve: 3 }).pay, { grant: g.grant.id, stress: 1 }, "[R1] the extra action costs 1 stress");
eq(Lg.canPay(Lq, { ...KINDS.F, grant: g.grant.id, resolve: 0 }).reason, "noStress", "[B2816] no voluntary stress at Resolve 0");
eq(Lg.canPay(Lq, { cost: "full", onTurn: false, interrupt: true, grant: g.grant.id, resolve: 3 }).ok, true, "[R1] [L2] the Quickness action may be a full action out of turn, as an interrupt");
eq([Lg.canPay(Lq, { cost: "full", onTurn: false, grant: g.grant.id, resolve: 3 }).reason, Lg.canPay(Lq, { cost: "quick", onTurn: false, grant: g.grant.id, resolve: 3 }).reason], ["notYourTurn", "notYourTurn"], "D40 [R1] [B1953], [B2292]: out of turn with nothing to interrupt the Quickness unit pays nothing");
eq(Lg.canPay({ ...Lq, grants: Lq.grants.map((x) => (x.kind === "quickness" ? { ...x, window: "anytime" } : x)) }, { cost: "full", onTurn: false, grant: g.grant.id, resolve: 3 }).reason, "notYourTurn", "D40: the grant of an older state (window anytime) is read the same way");
eq(Lg.canPay(Lq, { cost: "full", onTurn: false, cause: "help", grant: g.grant.id, resolve: 3 }).ok, true, "D40 [B2273]: helping on another's turn stays payable with it");
eq(Lg.grantTemplate("quickness").window, "turnOrInterrupt", "D40: the window of the Quickness unit is the own turn or an interrupt");
eq(Lg.payOptions(Lq, { ...KINDS.F, resolve: 2 }).map((o) => o.kind), ["quickness"], "payOptions lists the grant when the base pair is spent");
const pq = Lg.pay(Lq, { ...KINDS.F, grant: g.grant.id, resolve: 3 }, { action: "x" });
ok(pq.ok && pq.entry.stress === 1 && pq.entry.grant === g.grant.id, "paying with the grant records grant and stress");
eq(Lg.canPay(pq.ledger, { ...KINDS.F, grant: g.grant.id }).reason, "grantUsed", "a grant pays once");
eq(Lg.budget(pq.ledger).grants.map((x) => x.state), ["used"], "budget lists grants");
ok(Lg.newLedger(2, pq.ledger).grants.length === 2, "[L5] grants do not survive the round");

/* a grant from another character needs consent [plan 5.3] [B1708] */
let Lr = Lg.newLedger(1);
g = Lg.addGrant(Lr, Lg.grantTemplate("guidance", { from: "guide", unit: "full" }), "me"); Lr = g.ledger;
ok(g.grant.needsConsent === 1 && g.grant.consent === "pending", "consent is pending");
eq(Lg.canPay(Lr, { cost: "full", onTurn: false, turnOf: "guide", grant: g.grant.id }).reason, "grantConsent", "not usable before consent");
let Lyes = Lg.setConsent(Lr, g.grant.id, true).ledger;
eq(Lg.canPay(Lyes, { cost: "full", onTurn: false, turnOf: "guide", grant: g.grant.id }).ok, true, "[B1708] [L2] a bonus full action on the guide's turn");
eq(Lg.canPay(Lyes, { cost: "full", onTurn: false, turnOf: "other", grant: g.grant.id }).reason, "grantWindow", "[B1708] only on the guide's turn");
eq(Lg.canPay(Lyes, { cost: "quick", onTurn: false, turnOf: "guide", grant: g.grant.id }).reason, "grantUnit", "[B1708] the guide chose the kind of action");
ok(Lg.expireTurnOf(Lyes, "guide").grants.length === 2 && Lg.expireTurnOf(Lyes, "other").grants.length === 3, "[B1708] gone when the guide's turn ends");
const Lno = Lg.setConsent(Lr, g.grant.id, false).ledger;
eq(Lg.canPay(Lno, { cost: "full", onTurn: false, turnOf: "guide", grant: g.grant.id }).reason, "grantRefused", "[B1708] a refused grant is gone");
eq(Lg.budget(Lno).grants[0].state, "refused", "budget shows the refusal");
ok(!Lg.addGrant(Lg.newLedger(1), { kind: "gm", unit: "any", from: "me" }, "me").grant.needsConsent, "a grant from oneself needs no consent");

/* Defensive: a block or dodge without an action for 1 stress, repeatable [B2105] */
let Ld = Lg.addGrant(Lg.newLedger(1), Lg.grantTemplate("defender"), "me");
const dreq = { cost: "quick", onTurn: false, interrupt: true, tags: ["defence"], grant: Ld.grant.id, resolve: 2 };
let d1 = Lg.pay(Ld.ledger, dreq, { action: "block", tags: ["defence"] });
let d2 = Lg.pay(d1.ledger, dreq, { action: "dodge", tags: ["defence"] });
ok(d1.ok && d2.ok && Lg.budget(d2.ledger).quick.join("") === "openopen", "[B2105] repeatable and no action of the base pair is spent");
eq(Lg.canPay(Ld.ledger, { ...dreq, tags: [] }).reason, "grantUnit", "[B2105] only a block or dodge");
eq(Lg.removeGrant(Ld.ledger, Ld.grant.id).ledger.grants.length, 2, "removeGrant");
eq(Lg.removeGrant(Ld.ledger, Lg.BASE_A).reason, "baseGrant", "the base pair cannot be removed");
ok(Lg.grantTemplate("nope") === null && Lg.addGrant(Lg.newLedger(1), { unit: "zzz" }).reason === "badGrant", "unknown grants are refused");

/* an extra turn has its own pair [B1761] (spec 3.2, 4.4) */
let Lx = Lg.turnStart(Lg.newLedger(1)).ledger;
Lx = Lg.pay(Lx, KINDS.F, {}).ledger; Lx = Lg.pay(Lx, KINDS.Q, {}).ledger; Lx = Lg.turnEnd(Lx);
Lx = Lg.addTurnPair(Lx, "x9", "mindControl", "ctrl");
const xs = Lg.turnStart(Lx, { extra: "x9" });
ok(xs.extra === true && xs.ledger.extra === "x9" && xs.ledger.turnNo === Lx.turnNo, "an extra turn does not roll the facts of the own turns");
let Lx2 = xs.ledger;
eq(Lg.budget(Lx2).full + Lg.budget(Lx2).quick.join(""), "openopenopen", "[B1761] a complete fresh turn");
Lx2 = Lg.pay(Lx2, KINDS.Q, {}).ledger; Lx2 = Lg.pay(Lx2, KINDS.Q, {}).ledger;
eq(Lg.canPay(Lx2, KINDS.F).reason, "noAction", "[B1761] full + quick, or two quick");
Lx2 = Lg.turnEnd(Lx2);
ok(!Lx2.extra && Lg.budget(Lx2).full === "used" && Lg.budget(Lx2).quick[0] === "used", "after the extra turn the base pair is what it was");

/* hold off: the turn is suspended and resumes without counting twice [I9] */
let Lh = Lg.turnStart(Lg.newLedger(1)).ledger;
const no0 = Lh.turnNo;
Lh = Lg.turnSuspend(Lh);
ok(Lh.held === 1 && !Lh.open, "suspended");
const rs = Lg.turnStart(Lh);
ok(rs.resumed === true && rs.ledger.turnNo === no0 && rs.ledger.open === 1, "[I9] the turn resumes, it is not a second turn");
ok(Lg.turnReopen(Lg.turnEnd(rs.ledger)).open === 1, "turnReopen");

/* free mode / GM: only "is a unit left" is checked */
let Lfree = Lg.newLedger(1);
ok(Lg.canPay(Lfree, { cost: "full", onTurn: false, force: true }).ok && Lg.canPay(Lg.loseNextTurn(Lfree), { cost: "quick", onTurn: false, force: true }).ok, "force ignores the turn and the interrupt ban");
Lfree = Lg.pay(Lfree, { cost: "full", onTurn: false, force: true }, {}).ledger;
eq(Lg.canPay(Lfree, { cost: "full", onTurn: false, force: true }).reason, "noAction", "force still cannot spend what is spent");

done("check-ledger");
