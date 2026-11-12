/* node scripts/tactics/check-fxn.mjs -- FIXER N (after live verifier ver11 and bug hunt 4, tree tactics-bh4). Each block proves one row
   through the REAL director, engine and view (testkit Table) and the real render data, and pins the fix:
     D132   while 3D dice roll and a GM card is held back, the desk's handle badge, the "Now" tab badge and the "waiting for" strip
            disagree: the tab still counts the held card and the strip already names it
     D133   a turn that STARTS with nothing left (the round's actions went on reactions) passes by itself in 1.5 s under a lit bar and the
            first-turn hint "you have a full and a quick action", with no word why
     U162   the attacker's own armed panel shows the roll's result and Push / Accept while the 3D dice are still in the air
     BH4 suspicion 1  a hero driven from two seats: the second seat's auto press of End turn is refused and shows a warning
     BH4 suspicion 2  the sidebar folds once per Combat, not once per fight (a fight started again on the same Combat)
     BH4 suspicion 3  a player's news window follows the fight's lines, not the fight: a restart is seen only with the first new line
     BH4 suspicion 4  an unanswered "old clock" card (U157): the clock still runs at the round's end, "time is up" opens beside it */
import { readFileSync } from "node:fs";
import { Table, ok, eq, done } from "./testkit.mjs";
import * as V from "./view-pure.mjs";
import * as D from "./desk-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./ui/model-pure.mjs";
import * as N from "./ui/news-pure.mjs";
import * as FP from "./ui/feedback-pure.mjs";
import { tIn, EN, PL } from "./lang.mjs";

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
const desk = (T, own = {}) => M.deskData(D.deskModel(T.state, T.log, ctx(T)), own, facts(T, T.state, "gm", true), t);
/* (the helpers the fix added, looked up softly so that the unfixed tree FAILS these checks instead of stopping at a missing name) */
const F = (n, ...a) => (typeof N[n] === "function" ? N[n](...a) : undefined);

/* ---- D132: a held card leaves every count and the strip */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Eve" }).npc("N1", { name: "Doc", health: 9 }); T.order(["H1", "N1"]);
  await T.req("p1", decl("H1", "slugfest", ["N1"]));
  const d = desk(T), card = d.cards.find((c) => c.kind === "reaction");
  ok(!!card && d.count === 1 && d.tabs[0].n === 1 && d.waiting.some((w) => w.gm), "D132: the NPC's reaction card stands on the desk, counted, and the strip names the GM");
  const held = N.holdDesk(d, [], (n) => t("ITAC.ui.desk.expand", { n }));
  eq([held.count, held.cards.length], [0, 0], "D132: held while the dice roll: not counted on the handle (SEAM)");
  eq(held.tabs?.find((x) => x.id === "now")?.n, 0, "D132: nor on the badge of the Now tab");
  eq(held.waiting?.some((w) => w.gm), false, "D132: nor named in the 'waiting for' strip before it shows");
  eq(held.labels?.expand, t("ITAC.ui.desk.expand", { n: 0 }), "D132: the folded desk's words count without it too");
  eq(N.holdDesk(d, [card.id]), d, "D132: nothing held: the same desk");
  /* the strip keeps what is not held: a row of two pieces loses only the held one */
  const rows = [{ who: "MG", gm: true, mine: false, what: ["reakcja (Doc)", "rzut"], ids: ["p1", "i1:attack"], since: null, nudge: null }, { who: "Ty", gm: false, mine: true, what: ["x"], ids: ["p9"] }];
  eq(F("holdWaiting", rows, ["p1"])?.map((r) => r.what), [["rzut"], ["x"]], "D132: a row keeps its other pieces");
  eq(F("holdWaiting", rows, ["p9"])?.length, 1, "D132: a row left with nothing goes");
  eq(F("holdWaiting", [{ who: "a", what: ["y"] }], ["p1"])?.length, 1, "D132: a row without ids stays as it is");
  eq(M.waitingData(D.deskModel(T.state, T.log, ctx(T)).waiting, facts(T, T.state, "gm", true), t).find((w) => w.gm)?.ids, [card.id], "D132: each piece of a strip row says which card it is about");
  ok(/data\.waiting = NewsP\.holdWaiting\(data\.waiting, heldIds\)/.test(src("./ui/main.mjs")) && /holdDesk\(deskD, hold\.cards, \(n\) => t\("ITAC\.ui\.desk\.expand"/.test(src("./ui/main.mjs")), "D132: main.mjs holds the dock's line and the desk's strip and words back with the cards");
}

/* ---- U162: the own roll's result waits for its dice */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Eve" }).npc("N1", { name: "Doc", health: 9 }); T.order(["H1", "N1"]);
  await T.req("p1", decl("H1", "slugfest", ["N1"]));
  for (const p of T.prompts("reaction")) await T.gm({ op: "answerFor", prompt: p.id, value: "pass" });
  const owed = dock(T, "p1", ["H1"]);
  const r0 = [...(owed.rolls ?? []), ...(owed.panel?.rolls ?? [])][0];
  eq([owed.panel?.kind, r0?.state], ["mine", "owed"], "U162: the attacker's panel owes the attack roll");
  let was = F("holdRollsIn", owed, { rows: {}, opp: {} }, false) ?? { rows: {}, opp: {} };
  await T.roll("attack", 2, { pushable: true });
  const pushed = () => dock(T, "p1", ["H1"]), rowOf = (d) => [...(d.rolls ?? []), ...(d.panel?.rolls ?? [])][0];
  eq([rowOf(pushed())?.state, rowOf(pushed())?.buttons.map((b) => b.id)], ["push", ["accept", "push"]], "U162: the result came (2 sixes, pushable)");
  const fly = pushed(), h = F("holdRollsIn", fly, was, true);
  eq([rowOf(fly)?.state, rowOf(fly)?.buttons.length, /2/.test(rowOf(fly)?.text ?? "")], ["rolling", 0, false], "U162: while its dice roll the row still says 'rolling': no sixes, no Push / Accept");
  eq(h?.held, true, "U162: and says it held something (main.mjs waits for the dice and draws again)");
  eq(FP.hintOf(fly, ["slots", "speed"], t)?.id ?? null, null, "U162: the push hint waits with it");
  const landed = pushed(); F("holdRollsIn", landed, h, false);
  eq([rowOf(landed)?.state, rowOf(landed)?.buttons.map((b) => b.id)], ["push", ["accept", "push"]], "U162: the dice landed: the result and its buttons");
  const later = pushed(); F("holdRollsIn", later, { rows: { [rowOf(later).id]: { state: "push" } }, opp: {} }, true);
  eq(rowOf(later)?.state, "push", "U162: a result already shown stays shown while some other dice roll");
  /* the defence beside it (U146) waits the same way */
  const panel = { show: true, rolls: [], panel: { kind: "mine", rolls: [], opp: [{ id: "N1", text: "Doc, Blok: 1 · Trafienie" }] } };
  F("holdRollsIn", panel, { rows: {}, opp: { N1: { id: "N1", text: "Doc, Blok: 0" } } }, true);
  eq(panel.panel.opp.map((o) => o.text), ["Doc, Blok: 0"], "U162: the defence keeps what it said while dice roll");
  const fresh = { show: true, rolls: [], panel: { kind: "mine", rolls: [], opp: [{ id: "N1", text: "Doc, Blok: 1" }] } };
  F("holdRollsIn", fresh, { rows: {}, opp: {} }, true);
  eq(fresh.panel.opp.length, 0, "U162: a defence not shown before waits for its dice");
  ok(/rollsWas = NewsP\.holdRollsIn\(data, rollsWas, busy/.test(src("./ui/main.mjs")) && src("./ui/main.mjs").indexOf("NewsP.holdRollsIn(") < src("./ui/main.mjs").indexOf("Feedback.sync("), "U162: main.mjs holds the rows before the hint and the dock are drawn");
}

/* ---- D133: a turn that starts with nothing left */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Kid" }).npc("N1", { name: "A", health: 9 }).npc("N2", { name: "B", health: 9 }); T.order(["N1", "N2", "H1"]);
  const blocked = async (n) => {
    T.turn(n); await T.gm(decl(n, "slugfest", ["H1"]));
    const p = T.prompt("reaction", "H1"); await T.req("p1", { op: "answer", prompt: p.id, value: "block" });
    await T.roll("attack", 0); if (T.top()?.rolls?.["def:H1"]) await T.roll("def:H1", 0);
  };
  await blocked("N1"); await blocked("N2");
  T.turn("H1");
  const b = P1.budget(T.state, "H1");
  eq([b.full, b.quick], ["lost", ["used", "used"]], "D133: two blocks took the round's actions before Kid's turn");
  const d = dock(T, "p1", ["H1"]);
  eq([d.onTurn, d.end.auto, d.end.spent], [true, true, true], "D133: the turn has nothing left from its start: it passes by itself, marked as started empty");
  eq([d.out?.reason, d.out?.text], ["spent", PL["ITAC.ui.out.spent"]], "D133: the bar says why, where the actions stand (the U9 line)");
  eq(FP.hintOf(d, [], t), null, "D133: no first-turn hint promising a full and a quick action");
  eq(F("autoDelay", d.end, 1500), N.AUTO_SPENT_MS, "D133: it stands long enough to read before it goes");
  ok(N.AUTO_SPENT_MS >= 3000, "D133: (at least 3 s)");
  const lists = d.groups.flatMap((g) => g.items).filter((a) => a.more);
  ok(lists.length > 0 && lists.every((a) => !!a.disabled), "D133: the list buttons (More actions, Abilities) are greyed with their rows");
  ok(lists.every((a) => /Pełna|Szybka|akcj/i.test(JSON.stringify(a.tip))), "D133: ... and their tooltip says why");
  /* a turn spent IN the turn passes as before (U144) */
  const U = new Table(); U.hero("H1", "p1").npc("N1", { health: 9 }); U.order(["H1", "N1"]);
  await U.req("p1", { op: "mark", actor: "H1", unit: "full", on: true }); await U.req("p1", { op: "mark", actor: "H1", unit: "quick", on: true });
  const e = dock(U, "p1", ["H1"]);
  eq([e.end.auto, !!e.end.spent, e.out, F("autoDelay", e.end, 1500)], [true, false, null, 1500], "D133: a turn used up in itself: 1.5 s, no 'spent' line (U144 unchanged)");
  ok(/NewsP\.autoDelay\(e, AUTO_END_MS\)/.test(src("./ui/main.mjs")), "D133: main.mjs times the pass by it");
  ok(/d\.out\.reason === "spent"/.test(src("./ui/dock.mjs")) && /fk: `more:\$\{m\}`[^\n]*disabled: !!a\.disabled/.test(src("./ui/dock.mjs")), "D133: dock.mjs draws the line and greys a list button");
  for (const k of ["ITAC.ui.out.spent", "ITAC.reason.spent"]) ok(k in EN && k in PL, `D133: the key ${k} is in English and Polish`);
}

/* ---- bug hunt 4, suspicion 1: the second seat's auto press */
{
  eq([F("autoQuiet", { code: "stale" }), F("autoQuiet", { code: "notYourTurn" }), F("autoQuiet", { code: "busy" }), F("autoQuiet", { code: "illegal" })], [true, true, false, false], "BH4 s1: a press that came after the turn moved on is quiet; a real refusal is not");
  const T = new Table(); T.hero("H1", "p1").npc("N1", { health: 9 }); T.order(["H1", "N1"]);
  await T.req("p1", { op: "mark", actor: "H1", unit: "full", on: true }); await T.req("p1", { op: "mark", actor: "H1", unit: "quick", on: true });
  const req = dock(T, "p1", ["H1"]).end.req;
  const first = await T.req("p1", req), second = await T.req("p1", req);
  eq([code(first), F("autoQuiet", second?.error)], ["ok", true], "BH4 s1: the same press twice (two seats): the second is refused with a code an auto press keeps quiet");
  const m = src("./ui/main.mjs");
  ok(/send\("dock", n\.req, \{ endArmed: false \}, \{ auto: true \}\)/.test(m) && /!\(how\.auto && NewsP\.autoQuiet\(env\.error\)\)/.test(m), "BH4 s1: main.mjs sends the auto press as such and does not show its late refusal");
}

/* ---- bug hunt 4, suspicions 2 and 3: a fight started again on the same Combat */
{
  const TAG = "mh3k9x01a", TAG2 = "mh4p2q7zz";
  const T = new Table(); T.hero("H1", "p1").npc("N1", { health: 9 }); T.order(["H1", "N1"], { fight: TAG });
  const v = pv(T, "p1", ["H1"]);
  eq(v.fight, TAG, "BH4 s2/s3: a player's view carries the fight's tag (it is in every id already)");
  eq(F("fightNow", v), TAG, "BH4 s3: the fight of a view with no lines yet is known");
  ok(F("foldKey", "c1", v) !== F("foldKey", "c1", { ...v, fight: TAG2 }) && F("foldKey", "c1", v) === F("foldKey", "c1", { ...v }), "BH4 s2: the sidebar folds once per fight: a new fight on the same Combat folds it again");
  const win = N.newsWindow(null, { combat: "c1", fight: TAG, round: 2, member: "N1", newest: 7 });
  const again = N.newsWindow(win, { combat: "c1", fight: F("fightNow", { fight: TAG2, news: [] }), round: 1, member: null, newest: 0 });
  eq([again.fight, again.from], [TAG2, 0], "BH4 s3: the window opens for the new fight at once, before its first line");
  const m = src("./ui/main.mjs");
  ok(/fight: NewsP\.fightNow\(facts\.view\)/.test(m) && /foldedFor === key/.test(m), "BH4 s2/s3: main.mjs keys the window and the fold by the fight");
}

/* ---- bug hunt 4, suspicion 4: the clock of a challenge with its "old clock" card open */
{
  const U = new Table(); U.hero("H1", "p1").add("C1", { npc: true, kind: "challenge", name: "Reactor", health: 6, resolve: 1, maxResolve: 3, timeUnit: "rounds" });
  eq(code(await U.gm({ op: "start", mode: "tactical", opts: {} })), "ok", "BH4 s4: a fight starts with a challenge whose clock ran before");
  ok(!!U.prompt("challengeStale"), "BH4 s4: the GM's card 'old clock' opens");
  await U.gm({ op: "nextTurn" });
  eq([U.state.round, U.c.C1.resolve, !!U.prompt("challengeFail")], [2, 1, false], "BH4 s4: the round ended with the card unanswered: the clock did not run and 'time is up' did not open beside it");
  await U.gm({ op: "answerFor", prompt: U.prompt("challengeStale")?.id, value: "reset" });
  eq([U.c.C1.resolve, !!U.prompt("challengeFail")], [3, false], "BH4 s4: 'Reset' then puts it back with no failure card standing");
  await U.gm({ op: "nextTurn" });
  eq(U.c.C1.resolve, 2, "BH4 s4: once answered, the clock runs at the round's end as before");
  const W = new Table(); W.hero("H1", "p1").add("C1", { npc: true, kind: "challenge", name: "Reactor", health: 6, resolve: 1, maxResolve: 3, timeUnit: "rounds" });
  await W.gm({ op: "start", mode: "tactical", opts: {} }); await W.gm({ op: "answerFor", prompt: W.prompt("challengeStale")?.id, value: "keep" }); await W.gm({ op: "nextTurn" });
  eq([W.c.C1.resolve, !!W.prompt("challengeFail")], [0, true], "BH4 s4: 'leave it' and the round's end: the clock runs out and 'time is up' opens (as before)");
}

/* ---- ver11: a news line two turns old (a move-only turn, then the turn of somebody concealed from this player) */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Kid" }).hero("H2", "p2", { name: "Eve" }).npc("N1", { name: "Immortal", health: 9 }).npc("N2", { name: "Turret", health: 9, hidden: true }); T.order(["H2", "N1", "N2", "H1"]);
  const memberOf = (v) => (typeof N.memberOf === "function" ? N.memberOf(v) : v?.init?.curMember ?? null);
  const step = (win) => { const v = pv(T, "p1", ["H1"]); return N.newsWindow(win, { combat: "c1", fight: N.fightNow?.(v) ?? "", round: v.round, member: memberOf(v), newest: N.newest(v.news) }); };
  const shown = (win) => { const v = pv(T, "p1", ["H1"]); return M.newsData(v, { newsFrom: win.from }, facts(T, v, "p1"), t); };
  let win = step(null);
  await T.req("p2", decl("H2", "slugfest", ["N1"]));
  for (const p of T.prompts("reaction")) await T.gm({ op: "answerFor", prompt: p.id, value: "pass" });
  await T.roll("attack", 1);
  eq([T.state.stack.length, T.prompts().length], [0, 0], "ver11: Eve's blow is closed (one six, no stunts)");
  win = step(win);
  ok(!!shown(win), "ver11: Eve's attack line stands in her own turn on Kid's seat");
  T.turn("N1"); win = step(win);
  ok(!!shown(win), "ver11: and through the next turn (Immortal only moves)");
  T.turn("N2"); win = step(win);
  eq(pv(T, "p1", ["H1"]).init.curMember, null, "ver11: the turret's turn is concealed from Kid's player");
  eq(shown(win), null, "ver11: the line no longer stands two turns after it was made (the concealed turn is a turn too)");
  eq([N.memberOf?.({ phase: "turns", init: { curMember: null, slots: [{ state: "done" }, { state: "done" }] } }), N.memberOf?.({ phase: "round", init: { curMember: null } })], ["@unseen:2", null], "ver11: a concealed turn is named by nobody; between turns there is none");
  ok(/member: NewsP\.memberOf\(facts\.view\)/.test(src("./ui/main.mjs")), "ver11: main.mjs feeds the window the turn as the view shows it");
}

done("check-fxn");
