/* node scripts/tactics/check-bh4.mjs -- BUG HUNT 4 (after the UX wave, tag tactics-integrated-54). Each block proves one defect of the
   ledger dev/combat-defects.md ("Bug hunt 4") through the REAL director, engine and view (testkit Table) and the real render data, and
   pins the fix:
     BH4-1  news ids carry the fight's tag ("n12_<fight>", H3-1): the surfaces read every digit of the id as its number, so one fire on
            several characters never became one line, and a fight started again on the same Combat hid its lines behind the numbers
            of the fight before (the turn window, "put away", the round summary's tally)
     BH4-2  the news window took the same combatant's turn in the next round for the same turn (a line stood a turn too long)
     BH4-3  a character broken by a hazard (fire, blast, fall ...) is not called broken on the news line (the attack's line says it)
     BH4-4  the bar offers End turn (and passes the turn by itself) while the engine refuses it: a request of this character waits for
            the GM (an exception asked with no action left) */
import { Table, ok, eq, done } from "./testkit.mjs";
import * as V from "./view-pure.mjs";
import * as D from "./desk-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./ui/model-pure.mjs";
import * as N from "./ui/news-pure.mjs";
import * as FP from "./ui/feedback-pure.mjs";
import { tIn } from "./lang.mjs";

const tr = (l) => (k, p = {}, f) => tIn(l, k, p, f);
const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const meta = (T) => ({ hidden: Object.keys(T.c).filter((id) => T.c[id].hidden), npc: Object.keys(T.c).filter((id) => T.c[id].npc) });
const pv = (T, u, owns) => V.viewFor(T.state, { id: u, staff: false, owns }, meta(T));
const pf = (T, u, view) => ({ view, staff: false, me: u, c: (id) => (T.c[id] ? { name: T.c[id].name ?? id, npc: T.c[id].npc } : null), attrs: (id) => T.c[id]?.attrs ?? null, userName: (x) => `user-${x}` });
const line = (T, u, owns, own = {}, l = "en") => { const v = pv(T, u, owns); return M.newsData(v, own, pf(T, u, v), tr(l)); };
const ctx = (T) => ({ c: (id) => T.c[id] ?? null, online: () => true, P1 });
const dock = (T, u, owns, own = {}, l = "en") => { const v = pv(T, u, owns); return M.dockData(D.playerModel(v, { id: u, owns }, ctx(T)), own, pf(T, u, v), tr(l)); };
const answerAll = async (T, pick = (p) => p.options?.find((o) => o.id === "pass")?.id ?? p.options?.[0]?.id) => { for (let i = 0; i < 8; i++) { const p = T.prompts()[0]; if (!p) break; await T.req("gm", { op: "answerFor", prompt: p.id, value: pick(p) }); } };
/* (the helpers the fix added, looked up softly so that the unfixed tree FAILS these checks instead of stopping at a missing name) */
const fightOfList = (l) => (typeof N.fightOfList === "function" ? N.fightOfList(l) : ""), markOf = (f, n) => (typeof N.markOf === "function" ? N.markOf(f, n) : n), seenNo = (m, f) => (typeof N.seenNo === "function" ? N.seenNo(m, f) : Number(m) || 0);
const TAG = "mh3k9x01a", TAG2 = "mh4p2q7zz";      // tags as engine.mjs makes them (state-pure makeFight: base-36 time + 3 chars, digits among them)
/* two heroes on fire: the round-start queue runs the fire on each (two lines written one right after the other) */
async function twoFires(fight) {
  const T = new Table(); T.hero("H1", "p1", { name: "Kid" }).hero("H2", "p2", { name: "Omni" }).npc("N1", { name: "Thug", health: 9 }); T.order(["H1", "H2", "N1"], fight ? { fight } : {});
  T.dice.push([6, 6, 1, 1, 1, 1], [6, 6, 1, 1, 1, 1]);
  await T.gm({ op: "hazard", hazard: { kind: "fire", intensity: 6, inZone: false }, targets: ["H1", "H2"] });
  for (let i = 0; i < 8 && !T.prompt("triggerQueue"); i++) await T.gm({ op: "nextTurn" });
  await answerAll(T);
  return T;
}

/* ---- BH4-1 (a): one fire on two characters at the round's start is one line, also with the fight's tag in the ids */
{
  const bare = await twoFires(null), tagged = await twoFires(TAG);
  const fires = (T) => (T.state.news ?? []).filter((n) => n.flow === "hazard" && n.round === 2);
  eq([fires(bare).length, fires(tagged).length], [2, 2], "BH4-1: the engine writes the two round-start fires as two lines (premise)");
  ok(fires(tagged).every((n) => n.id.endsWith(`_${TAG}`)), `BH4-1: the ids carry the fight's tag (premise: ${fires(tagged).map((n) => n.id)})`);
  eq(N.newsNo(fires(tagged)[0]), N.newsNo(fires(bare)[0]), "BH4-1: a line's number is its sequence, whatever the tag");
  eq(N.groups(fires(bare)).length, 1, "BH4-1: untagged: the two fires are one group (premise)");
  eq(N.groups(fires(tagged)).length, 1, "BH4-1: tagged: the two fires are one group too (the queue chains them: the second is the first's child)");
  const say = (T) => line(T, "p1", ["H1"])?.text ?? "";
  eq(say(tagged), say(bare), "BH4-1: the player's line is the same with the tag");
  ok(/no damage: (Kid, Omni|Omni, Kid)$/.test(say(tagged)), `BH4-1: one line names both ("${say(tagged)}")`);
  /* the rule for lines with no chain between them (news-pure sameHazard: the very next line), with the ids as the engine writes them */
  const strip = (n) => { const { parent, ...rest } = n; return rest; };
  eq([N.groups(fires(bare).map(strip)).length, N.groups(fires(tagged).map(strip)).length], [1, 1], "BH4-1: one hazard on two, written one right after the other: one line, tag or no tag");
}

/* ---- BH4-1 (b): the fight is started again on the same Combat: its lines count from 1 again under a new tag */
{
  const one = await twoFires(TAG), two = await twoFires(TAG2);
  const v1 = pv(one, "p1", ["H1"]), v2 = pv(two, "p1", ["H1"]);
  /* the client saw the first fight to its end: the window, and the line put away */
  let w = N.newsWindow(null, { combat: "C1", fight: fightOfList(v1.news), round: 2, member: "H1", newest: N.newest(v1.news) });
  w = N.newsWindow(w, { combat: "C1", fight: fightOfList(v1.news), round: 2, member: "H2", newest: N.newest(v1.news) + 9 });
  const seen = M.newsData(v1, {}, pf(one, "p1", v1), tr("en"))?.seen;
  ok(seen != null, "BH4-1: the first fight's line can be put away (premise)");
  /* the same Combat, a new fight: the first line of it */
  const first = { ...v2, news: (v2.news ?? []).slice(0, 1) };
  w = N.newsWindow(w, { combat: "C1", fight: fightOfList(first.news), round: 1, member: "H1", newest: N.newest(first.news) });
  eq(w.from, 0, "BH4-1: a new fight on the same Combat opens its own window (every line of it is new)");
  const d = M.newsData(first, { newsSeen: seen, newsFrom: w.from }, pf(two, "p1", first), tr("en"));
  ok(!!d && /Fire/.test(d.text), `BH4-1: the new fight's first line is shown, not hidden behind the old fight's numbers (${JSON.stringify(d?.text ?? null)})`);
  /* the mark of a line put away counts only within its own fight */
  eq([seenNo(markOf(TAG, 7), TAG), seenNo(markOf(TAG, 7), TAG2), seenNo(7, ""), seenNo(undefined, TAG)], [7, 0, 7, 0], "BH4-1: markOf / seenNo");
  /* the summary's tally: a fight started again does not count the actions of the fight before */
  const t1 = FP.tallyAdd(null, "C1", v1.news), t2 = FP.tallyAdd(t1, "C1", first.news);
  ok(Object.keys(t1.entries).length > 0, "BH4-1: the first fight's tally holds its lines (premise)");
  eq(Object.keys(t2.entries).length, (first.news ?? []).filter((n) => n.kind === "action" && (n.rows ?? []).length).length, "BH4-1: the tally of the new fight holds none of the old fight's lines");
  ok(FP.tallyAdd(t2, "C1", first.news) === t2, "BH4-1: the same lines again change nothing");
}

/* ---- BH4-2: the same combatant last in a round and first in the next: two turns */
{
  let w = N.newsWindow(null, { combat: "c", fight: "", round: 1, member: "A", newest: 4 });
  w = N.newsWindow(w, { combat: "c", fight: "", round: 1, member: "A", newest: 6 });
  eq(w.from, 3, "BH4-2: the same turn: the lines stand (premise)");
  w = N.newsWindow(w, { combat: "c", fight: "", round: 2, member: "A", newest: 7 });
  eq([w.from, w.mark], [3, 7], "BH4-2: A again in round 2 is the next turn: round 1's lines stand once more");
  w = N.newsWindow(w, { combat: "c", fight: "", round: 2, member: "B", newest: 7 });
  eq(w.from, 7, "BH4-2: ... and go with the turn after it");
}

/* ---- BH4-3: broken by a hazard: the line says so, as an attack's line does */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Kid" }).npc("N1", { name: "Thug", health: 2 }); T.order(["H1", "N1"]);
  T.dice.push([6, 6, 6, 1, 1, 1]);
  eq(code(await T.gm({ op: "hazardRun", run: { type: "blast", rating: 6, targets: ["N1"] } })), "ok", "BH4-3: the GM lets a blast loose on a thug of 2 Health");
  await answerAll(T, (p) => p.options?.find((o) => o.id === "pass" || o.id === "ko")?.id ?? p.options?.[0]?.id);
  ok((T.state.statuses?.N1 ?? []).some((s) => s.id === "broken"), "BH4-3: the thug is broken (premise)");
  const row = (T.state.news ?? []).at(-1)?.rows?.find((r) => r.target === "N1");
  eq(row?.down, 1, `BH4-3: the engine's row says it put the thug down (${JSON.stringify(row)})`);
  ok(/broken/.test(line(T, "p1", ["H1"])?.text ?? ""), `BH4-3: the player's line says broken (${line(T, "p1", ["H1"])?.text})`);
}

/* ---- BH4-4: a request for an exception waits for the GM: the engine refuses End turn ("busy"); the bar must not offer it or pass it */
const spent = async () => {
  const T = new Table(); T.hero("H1", "p1", { name: "Eve" }).npc("N1", { name: "Mauler", health: 9 }); T.order(["H1", "N1"]);
  await T.req("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1"] } });
  for (const p of T.prompts("reaction")) await T.req("gm", { op: "answerFor", prompt: p.id, value: "pass" });
  await T.roll("attack", 0);
  await T.req("p1", { op: "mark", actor: "H1", unit: "quick", on: true });
  return T;
};
{
  const T = await spent();
  eq(dock(T, "p1", ["H1"]).end.auto, true, "BH4-4: nothing left: the turn would pass by itself (premise, U144)");
  eq(code(await T.req("p1", { op: "exception", actor: "H1", text: "one more punch" })), "ok", "BH4-4: Eve asks the GM for an exception");
  ok(!!T.prompt("exception", "H1"), "BH4-4: the GM's card stands (premise)");
  eq(code(await T.req("p1", dock(T, "p1", ["H1"]).end.req)), "busy", "BH4-4: the engine refuses to end the turn while the request waits (spec 4.4; premise)");
}
{
  const T = await spent();
  await T.req("p1", { op: "exception", actor: "H1", text: "one more punch" });
  const e = dock(T, "p1", ["H1"]).end;
  eq([e.auto, !!e.disabled], [false, true], "BH4-4: the bar neither passes the turn by itself nor offers End while the GM decides");
  eq(D.barModel(T.state, "H1", { ...ctx(T), staff: true }).endTurn?.disabled, "busy", "BH4-4: the GM's bar of the hero says the same");
  const x = T.prompt("exception", "H1");
  eq(code(await T.req("gm", { op: "answerFor", prompt: x.id, value: "deny" })), "ok", "BH4-4: the GM says no");
  const e2 = dock(T, "p1", ["H1"]).end;
  eq([e2.auto, e2.disabled], [true, null], "BH4-4: then nothing is left again: the turn passes by itself");
  eq(code(await T.req("p1", e2.req)), "ok", "BH4-4: and the engine takes it");
}

done("check-bh4");
