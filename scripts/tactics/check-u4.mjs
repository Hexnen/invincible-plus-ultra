/* node scripts/tactics/check-u4.mjs -- usability rows U9 and U26 (dev/combat-usability.md), through the director on the real state.
   U9: a combatant with nothing to do on its turn (dead, unconscious, broken with no way to get up [B2707], [B2749], [B2773]) does not
       make the table wait: the turn passes by itself, what is due on that turn still comes, the table is told, the GM can still open
       the turn. A broken character that may rally keeps its turn and is offered getting up and nothing else.
   U26: the texts of the row: plural forms, no doubled or placeholder words, one vocabulary (see also check-lang.mjs). */
import { Table, ok, eq, done } from "./testkit.mjs";
import * as P1 from "./economy-pure.mjs";
import * as V from "./view-pure.mjs";
import * as D from "./desk-pure.mjs";
import * as K from "./flows/kit.mjs";
import { EN, PL, t, plural } from "./lang.mjs";

const code = (r) => (r?.ok ? "ok" : r?.error?.code ?? "?");
const end = (T, u, a) => T.req(u, { op: "endTurn", actor: a, round: T.state.round, slot: T.state.init.cur, ...(u === "gm" ? { force: true } : {}) });
const meta = (T) => ({ hidden: Object.values(T.c).filter((c) => c.hidden).map((c) => c.id), npc: Object.values(T.c).filter((c) => c.npc).map((c) => c.id) });
const st = (T, cid, id, more = {}) => T.gm({ op: "statusAdd", combatant: cid, status: { id, ...more } });
const mk = (o = {}) => { const T = new Table(); T.hero("H1", "p1").hero("H2", "p2").npc("N1", { health: 5, ...(o.N1 ?? {}) }).npc("N2", { health: 4, ...(o.N2 ?? {}) }); T.order(["H1", "N1", "H2", "N2"]); return T; };
const ctxOf = (T, staff = false) => ({ c: (id) => T.c[id] ?? null, online: () => true, P1, staff });
const pview = (T, u, owns) => V.viewFor(T.state, { id: u, staff: false, owns }, meta(T));

/* ------------------------------------------------------------------ U9: the pure rule */
{
  const T = mk();
  const so = (cid) => K.sitsOut(T.state, cid, T.c[cid]);
  eq(so("N1"), null, "sitsOut: a healthy combatant acts");
  T.c.N1.health = 0;
  eq(so("N1"), null, "sitsOut: broken with no injury that keeps it down: the turn is its own (it may try to get up)");
  T.c.N1.crits = [9];
  eq(so("N1"), "broken", "sitsOut: broken with an injury of 9 or worse cannot get up");
  T.c.N1.crits = [8];
  eq(so("N1"), null, "sitsOut: an injury of 8 does not keep it down");
  T.c.N1.pass = { noRally: true };
  eq(so("N1"), "broken", "sitsOut: the primary copy that went down does not get up");
  T.c.N1 = { ...T.c.N1, pass: {}, crits: [], health: 5 };
  await st(T, "N1", "unconscious");
  eq(so("N1"), "unconscious", "sitsOut: unconscious, whatever the Health");
  await st(T, "N1", "dead");
  eq(so("N1"), "dead", "sitsOut: dead comes first");
  eq(K.sitsOut(T.state, "X", { kind: "vehicle", health: 0 }), null, "sitsOut: a machine has no such state");
}

/* ------------------------------------------------------------------ U9: an unconscious NPC's turn passes by itself */
{
  const T = mk();
  T.c.N1.health = 0;
  await st(T, "N1", "broken"); await st(T, "N1", "unconscious");
  await T.gm({ op: "triggerAdd", trigger: { at: "turnStart", subject: { combatant: "N1" }, run: { type: "note" }, source: { kind: "gm", name: "Poison" } } });
  await T.gm({ op: "triggerAdd", trigger: { at: "turnEnd", subject: { combatant: "N1" }, run: { type: "note" }, source: { kind: "gm", name: "Bleeding" } } });
  await T.gm({ op: "tokenAdd", token: { id: "plan", holder: "H2", dice: 2, scope: { rolls: ["attack"] }, uses: "all", source: { kind: "power", name: "Plan", owner: "N1" }, expires: { at: "nextTurnOf", who: "N1" } } });
  await st(T, "H2", "afflicted", { ends: { at: "turnEndOf", who: "N1" } });
  const from = T.events.length, logFrom = T.log.list.length;
  eq(code(await end(T, "p1", "H1")), "ok", "the hero before it ends the turn");
  eq(T.state.init.curMember, "H2", "the unconscious NPC's turn passed: the next one who can act has the turn");
  const evs = T.events.slice(from).map((e) => [e.type, e.combatant ?? null]);
  eq(evs.filter(([ty]) => ["turnEnd", "turnPassed", "turnStart"].includes(ty)), [["turnEnd", "H1"], ["turnPassed", "N1"], ["turnStart", "H2"]], "events: the turn passes, no turn of the NPC starts or ends");
  eq(T.events.slice(from).find((e) => e.type === "turnPassed")?.reason, "unconscious", "the event says why");
  const slot = T.state.init.slots.find((s) => s.members.includes("N1"));
  eq([slot.state, slot.done], ["done", ["N1"]], "its card is done for this round");
  ok(!T.state.ledger.N1.open, "its ledger is not left open");
  /* what the book still makes happen on that turn */
  const queues = T.prompts("triggerQueue").filter((p) => p.about === "N1").map((p) => [p.data.at, p.options.map((o) => o.label)]);
  eq(queues, [["turnStart", ["Poison"]], ["turnEnd", ["Bleeding"]]], "what is due at the start and at the end of its turn is still put before the GM");
  ok(!(T.state.tokens ?? []).some((x) => x.id === "plan"), "what lasted until its next turn has ended");
  ok(!(T.state.statuses.H2 ?? []).some((s) => s.id === "afflicted"), "what lasted until the end of its turn has ended");
  /* the table is told */
  const line = T.log.list.slice(logFrom).find((x) => /turnPassed/.test(x.label?.gm ?? ""));
  eq([line?.label.gm, line?.label.pub], ["N1: {ITAC.journal.turnPassed.unconscious}", "N1: {ITAC.journal.turnPassed.unconscious}"], "the journal has a line for the GM and for the players");
  const news = pview(T, "p1", ["H1"]).news.filter((n) => n.kind === "turn");
  eq(news.map((n) => [n.actor, n.result]), [["N1", "pass.unconscious"]], "the players' news says whose turn passed and why");
  ok("ITAC.result.pass.unconscious" in EN && "ITAC.result.pass.unconscious" in PL, "and that reads as a sentence in both languages");
}

/* ------------------------------------------------------------------ U9: hidden stays hidden */
{
  const T = mk({ N1: { hidden: true, name: "Secret" } });
  await st(T, "N1", "dead");
  const from = T.events.length;
  await end(T, "p1", "H1");
  eq(T.state.init.curMember, "H2", "a hidden dead NPC's turn passes too");
  const v = pview(T, "p1", ["H1"]);
  ok(!JSON.stringify(v).includes("N1") && !JSON.stringify(v).includes("Secret"), "a player's view carries nothing of it (no news line, no name)");
  const pub = T.events.slice(from).map((e) => V.publicEvent(T.state, e, meta(T))).filter(Boolean);
  ok(!JSON.stringify(pub).includes("N1"), "the public event stream does not carry the passed turn of a hidden combatant");
  const line = T.log.list.find((x) => /turnPassed/.test(x.label?.gm ?? ""));
  eq([line?.label.pub, /Secret/.test(line?.label.gm ?? "")], ["", true], "the journal line is the GM's only");
  eq(V.journalFor(T.log, { id: "p1", staff: false }).filter((r) => /turnPassed|Secret/.test(r.text)).length, 0, "a player's journal has no such row");
}

/* ------------------------------------------------------------------ U9: a broken character that may rally keeps its turn; only getting up is offered */
{
  const T = mk();
  T.c.N1.health = 0; await st(T, "N1", "broken");
  await end(T, "p1", "H1");
  eq(T.state.init.curMember, "N1", "broken, but able to rally: the turn is its own [B2773]");
  const bar = D.barModel(T.state, "N1", ctxOf(T, true));
  eq(bar.actions.map((a) => a.id), ["rally"], "the bar offers getting up and nothing else");
  eq([bar.out?.reason, bar.out?.canRally, bar.out?.label], ["broken", true, "ITAC.ui.out.broken"], "the bar says why");
  eq(bar.endTurn?.noConfirm, true, "ending its turn needs no second click");
  eq(bar.holdOff.disabled, "broken", "it cannot hold off");
  eq(code(await T.gm({ op: "declare", actor: "N1", decl: { action: "rally", targets: [] } })), "ok", "it may declare the rally on itself");
}
{
  const T = mk();
  T.c.H2.health = 0; T.c.H2.crits = [9]; await st(T, "H2", "broken");      // an injury of 9 with the mark missing (set by hand on the sheet)
  await end(T, "p1", "H1"); await end(T, "gm", "N1");
  eq(T.state.init.curMember, "N2", "broken with an injury that keeps it down: the hero's turn passes");
  eq(T.events.find((e) => e.type === "turnPassed")?.reason, "broken", "the reason is the broken state");
  eq(pview(T, "p2", ["H2"]).news.filter((n) => n.kind === "turn").map((n) => n.result), ["pass.broken"], "its player is told");
}

/* ------------------------------------------------------------------ U9: the bar of somebody who is out */
{
  const T = mk();
  const healthy = D.barModel(pview(T, "p1", ["H1"]), "H1", ctxOf(T));
  eq([healthy.out, healthy.endTurn?.noConfirm, healthy.actions.length > 3], [null, false, true], "a hero in good shape: the whole bar, and the second click on End turn stays");
  eq(D.barModel(T.state, "N2", ctxOf(T, true)).out, null, "a healthy NPC is not out");
  T.turn("N1");
  eq(D.barModel(T.state, "N1", ctxOf(T, true)).endTurn?.noConfirm, true, "P9-5: an NPC in the GM's hands ends its turn with one click");
  eq(D.barModel(T.state, "N1", ctxOf(T, false)).endTurn?.noConfirm, false, "not so for a player who runs one");
  for (const s of ["unconscious", "dead"]) {
    const U = mk(); U.turn("N1");                                     // the GM stepped to it by hand (the reducer's own nextTurn, no pass)
    await st(U, "N1", "broken"); await st(U, "N1", s);
    const bar = D.barModel(U.state, "N1", ctxOf(U, true));
    eq([bar.actions.length, bar.out?.reason, bar.out?.canRally, bar.endTurn?.noConfirm], [0, s, false, true], `${s}: no action is offered, the bar says why, End turn is one click`);
  }
  const U = mk(); U.turn("N1"); U.c.N1.health = 0;
  await st(U, "N1", "broken"); await st(U, "N1", "dying", { data: { within: "hours" } });
  const bar = D.barModel(U.state, "N1", ctxOf(U, true));
  eq([bar.actions.length, bar.out?.canRally], [0, false], "dying: it cannot get up, nothing is offered");
  for (const k of ["broken", "unconscious", "dead"]) ok(`ITAC.ui.out.${k}` in EN && `ITAC.ui.out.${k}` in PL && `ITAC.journal.turnPassed.${k}` in PL && `ITAC.result.pass.${k}` in PL, `texts of the ${k} state exist`);
}

/* ------------------------------------------------------------------ U9: the GM can still open the turn */
{
  const T = mk();
  await st(T, "N1", "unconscious");
  await end(T, "p1", "H1");
  eq(T.state.init.curMember, "H2", "passed");
  eq(code(await T.gm({ op: "prevTurn", force: true })), "ok", "the GM steps back");
  eq(T.state.init.curMember, "N1", "and the passed turn is open (it does not pass again)");
  eq(code(await end(T, "gm", "N1")), "ok", "the GM ends it by hand");
  eq(T.state.init.curMember, "H2", "the hero's turn comes back, resumed");
  eq(code(await T.gm({ op: "insertTurn", combatant: "N1" })), "ok", "the GM gives it an extra turn");
  await end(T, "p2", "H2");
  eq(T.state.init.curMember, "N1", "an inserted turn is never passed: the GM asked for it");
  /* the mark removed: next round it acts as anybody */
  await T.gm({ op: "statusRemove", combatant: "N1", id: "unconscious" });
  eq(K.sitsOut(T.state, "N1", T.c.N1), null, "with the mark gone it acts again");
}

/* ------------------------------------------------------------------ U9: when nobody could act, the round does not run by itself */
{
  const T = mk();
  for (const c of ["N1", "H2", "N2"]) await st(T, c, "unconscious");
  const round = T.state.round;
  await end(T, "p1", "H1");
  eq(T.state.round, round + 1, "the others pass, the round turns once");
  eq(T.state.init.curMember, "H1", "and the one who can act has the turn again");
  await st(T, "H1", "unconscious");
  const r2 = T.state.round;
  await end(T, "gm", "H1");
  ok(T.state.round - r2 <= 1 && !!T.state.init.curMember, "everybody is out: a turn stays open for the GM instead of rounds running away");
}

/* ------------------------------------------------------------------ U26: plural forms */
{
  const pl = (n) => plural("pl", n, ["kość", "kości", "kości"]);
  eq([1, 2, 3, 4, 5, 11, 12, 14, 21, 22, 25, 102, 112, 0].map(pl), ["kość", "kości", "kości", "kości", "kości", "kości", "kości", "kości", "kości", "kości", "kości", "kości", "kości", "kości"], "Polish: one / few / many (the die word has one form for both)");
  const z = (n) => plural("pl", n, ["strefę", "strefy", "stref"]);
  eq([1, 2, 4, 5, 12, 22, 25, 100].map(z), ["strefę", "strefy", "strefy", "stref", "stref", "strefy", "stref", "stref"], "Polish: 1 strefę, 2-4 strefy, 5+ stref, 12-14 stref, 22 strefy");
  eq([1, 2, 0].map((n) => plural("en", n, ["die", "dice"])), ["die", "dice", "dice"], "English: one / other");
  eq(plural("pl", "x", ["a", "b", "c"]), "c", "not a number: the last form");
  const was = globalThis.game;
  try {
    globalThis.game = { i18n: { lang: "pl" } };
    eq([1, 2, 5].map((n) => t("ITAC.ui.bonusDice", { n })), ["+1 kość", "+2 kości", "+5 kości"], "PL: +1 kość, not '+1 kości'");
    eq([1, 3, 5].map((n) => t("ITAC.ui.line.knockDir", { target: "X", n }).split(".")[0]), ["X leci o 1 strefę", "X leci o 3 strefy", "X leci o 5 stref"], "PL: no 'stref(y)'");
    eq(t("ITAC.ui.line.attPool", { dice: 1, attr: "Walka" }), "Atakujący rzuca 1 kością (Walka).", "PL: the instrumental too");
    eq(t("ITAC.ui.line.forcedShort", { n: 1, of: 3 }), "Na mapie jest miejsce na 1 z 3 stref.", "PL: the noun follows the second number");
    eq(t("ITAC.ui.stress", { n: 1 }), "stres: 1", "PL: no '1 stresu'");
    /* the waiting line: no word twice, no two brackets in a row */
    const about = (roll) => t("ITAC.ui.wait.about", { what: t("ITAC.ui.wait.roll", { roll: t(`ITAC.roll.${roll}`) }), name: "Omni-Man" });
    eq([about("attack"), about("roll")], ["rzut: Atak (Omni-Man)", "rzut: Akcja (Omni-Man)"], "PL: 'rzut (Atak) (Omni-Man)' and 'rzut (Rzut)' are gone");
    eq(t("ITAC.Scene.Line", { name: "X", from: 0, to: 2 }), "X: Zdrowie z 0 na 2", "PL: the recovery line");
    globalThis.game = { i18n: { lang: "en" } };
    eq([1, 2].map((n) => t("ITAC.ui.bonusDice", { n })), ["+1 die", "+2 dice"], "EN: +1 die");
    eq(t("ITAC.ui.wait.about", { what: t("ITAC.ui.wait.roll", { roll: t("ITAC.roll.roll") }), name: "Omni-Man" }), "roll: Action (Omni-Man)", "EN: no 'roll (Roll)'");
  } finally { globalThis.game = was; }
}

/* ------------------------------------------------------------------ U26: one vocabulary in the Polish table */
{
  const bad = [[/\bHealth\b/, "Health (Zdrowie)"], [/\bResolve\b/, "Resolve (Determinacja)"], [/(?<!\p{L})BN(?!\p{L})/u, "BN (NPC)"], [/\(y\)|\(ów\)|\(e\)/, "a bracketed ending"], [/wyzwalacz/i, "wyzwalacz"],
    [/\bbez tego\b/, "a placeholder word"], [/(?<!\p{L})dok(u|iem)?(?!\p{L})|(?<!\p{L})pulpi/iu,"dok / pulpit (pasek akcji, biurko MG)"], [/\btoken/i, "token (żeton)"], [/Zręczno|Charyzm|Obecnoś/, "an attribute name unlike the glossary's (Zwinność, Prezencja)"],
    [/(?<!\p{L})cech[aęy](?!\p{L})(?!.*liczą się same)/iu,"cecha for an attribute (atrybut)"], [/\b1 stresu\b|\{n\} stresu/, "'n stresu'"], [/\{(n|dice)\} kości|\{(n|dice)\} kośćmi/, "a die count without its plural forms"]];
  for (const [k, v] of Object.entries(PL)) for (const [re, what] of bad) ok(!re.test(v), `PL ${k}: ${what} in "${v.slice(0, 60)}"`);
  for (const [k, v] of Object.entries(EN)) ok(!/\(s\)|\{(n|dice)\} dice\b/.test(v), `EN ${k}: a count without its plural forms in "${v.slice(0, 60)}"`);
  for (const T of [EN, PL]) for (const [k, v] of Object.entries(T)) for (const m of v.matchAll(/\{(\w+)\|([^{}]*)\}/g)) {
    ok(v.includes(`{${m[1]}}`), `${k}: the plural mark counts {${m[1]}}, which the string also shows`);
    eq(m[2].split("|").length, T === PL ? 3 : 2, `${k}: ${T === PL ? "three Polish" : "two English"} forms`);
  }
  for (const k of ["ITAC.card.npcBroken", "ITAC.prompt.npcBroken"]) ok(!/0 (Zdrowia|Health)/.test(PL[k]) && !/0 Health/.test(EN[k]), `${k}: the title does not repeat the card's own line`);
}
done("check-u4");
