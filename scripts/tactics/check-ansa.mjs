/* node scripts/tactics/check-ansa.mjs -- builder ANSA (2026-11-12): the user's answers about ending a turn
   (dev/combat-answers-2026-11-12.md), each pinned through the REAL director, engine and view (testkit Table) and the real render data:
     UXC-1 (K1)  «pytanie czy koniec ale w pasku inicjatywy na górze dodaj tick że auto skip jeśli brak akcji dostepnych»:
                 End turn ALWAYS asks "End the turn?" (also with both actions spent, also on the GM seat, also out of action); a tick
                 on the initiative bar at the top (each user's own, off by default, kept in the user's layout) lets a turn with nothing
                 left pass by itself, without the question
     FXP-6       «Tick działa też u MG, 3,5 s zostaje»: the tick works on the GM seat too: a spent NPC turn passes by itself with it,
                 waits for End turn and its question without it
     FXN-1       «Tick działa też u MG, 3,5 s zostaje»: with the tick a turn that starts with nothing left passes after 3.5 s with the
                 hourglass line; without it, it waits for the question */
import { readFileSync } from "node:fs";
import { Table, ok, eq, done } from "./testkit.mjs";
import * as V from "./view-pure.mjs";
import * as D from "./desk-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./ui/model-pure.mjs";
import * as N from "./ui/news-pure.mjs";
import * as K from "./ui/keys-pure.mjs";
import * as Lay from "./ui/layout-pure.mjs";
import * as AS from "./ui/autoskip-pure.mjs";
import * as FP from "./ui/feedback-pure.mjs";
import { tIn, EN, PL } from "./lang.mjs";
import { EN as CEN, PL as CPL } from "../combat/lang.mjs";

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
const dock = (T, u, owns, own = {}, autoSkip = false) => { const v = pv(T, u, owns); return M.dockData(D.playerModel(v, { id: u, owns }, ctx(T)), own, { ...facts(T, v, u), autoSkip }, t); };
const gmDock = (T, cid, own = {}, autoSkip = false) => { const d = D.deskModel(T.state, T.log, ctx(T)); const bar = D.barModel(T.state, cid, { ...ctx(T), staff: true }); return M.dockData({ bars: [bar], prompts: [], mine: [], stack: d.info, waiting: d.waiting, turn: d.turn }, own, { ...facts(T, T.state, "gm", true), autoSkip }, t); };
const markAll = async (T, u, cid) => { await T.req(u, { op: "mark", actor: cid, unit: "full", on: true }); await T.req(u, { op: "mark", actor: cid, unit: "quick", on: true }); };

/* ---- UXC-1: End turn always asks */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Eve" }).npc("N1", { name: "Mauler", health: 9 }).npc("N2", { health: 9 }); T.order(["H1", "N1", "N2"]);
  for (const tick of [false, true]) {
    const e = dock(T, "p1", ["H1"], {}, tick).end;
    eq([e.confirm, e.armed, e.auto, e.ready], [true, false, false, false], `UXC-1: both actions unused, tick ${tick ? "on" : "off"}: End turn asks, nothing passes by itself`);
    const a = dock(T, "p1", ["H1"], { endArmed: true }, tick).end;
    eq([a.armed, a.label, a.ask.title, a.ask.yes, a.ask.no, a.ask.noKey], [true, PL["ITAC.ui.end"], "Koniec tury?", "Tak", "Nie", "Esc"], `UXC-1: pressed once (tick ${tick ? "on" : "off"}): the question stands over the button, Yes / No`);
    ok(/Jeszcze nieużyte: /.test(a.ask.line) && a.ask.line.includes(dock(T, "p1", ["H1"]).slots[0].label), "UXC-1: the question names what is still unused");
  }
  await T.req("p1", decl("H1", "slugfest", ["N1"]));
  for (const p of T.prompts("reaction")) await T.req("gm", { op: "answerFor", prompt: p.id, value: "pass" });
  await T.roll("attack", 0);
  eq([dock(T, "p1", ["H1"]).end.confirm, dock(T, "p1", ["H1"], {}, true).end.auto], [true, false], "UXC-1: only the quick action left: still asked; the tick does not skip a turn that has an action left");
  await T.req("p1", { op: "mark", actor: "H1", unit: "quick", on: true });
  const off = dock(T, "p1", ["H1"]).end, on = dock(T, "p1", ["H1"], {}, true).end;
  eq([off.auto, off.ready, off.confirm, off.label, /zapyta/.test(off.tip)], [false, true, true, PL["ITAC.ui.end"], true], "UXC-1: nothing left, tick off: the turn waits; End turn is ready and asks (also after both actions are spent)");
  eq(dock(T, "p1", ["H1"], { endArmed: true }).end.ask.line, PL["ITAC.ui.endq.none"], "UXC-1: the question says nothing is left");
  eq([on.auto, on.ready, on.confirm, on.label, N.autoDelay(on, 1500)], [true, false, false, PL["ITAC.ui.end.auto"], 1500], "UXC-1: nothing left, tick on: it passes by itself after 1.5 s, without the question (a click passes it at once)");
  eq(dock(T, "p1", ["H1"], { endArmed: true }, true).end.armed, false, "UXC-1: with the tick no question opens over a turn that passes by itself");
  eq(dock(T, "p1", ["H1"], { quiet: true }, true).end.auto, false, "UXC-1: a watching seat never passes a turn, tick or not");
  eq(code(await T.req("p1", off.req)), "ok", "UXC-1: the Yes of the question sends the same request End turn always sent");
  /* the GM's NPC with actions left: asked too */
  const g = gmDock(T, "N1").end;
  eq([g.confirm, g.auto], [true, false], "UXC-1: the GM's NPC turn: End turn asks too");
  eq(gmDock(T, "N1", { endArmed: true }).end.armed, true, "UXC-1: the GM's press opens the question");
}
/* out of action (unconscious): End turn asks as well (one rule) */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Eve" }).npc("N1", { health: 9 }); T.order(["H1", "N1"]);
  await markAll(T, "p1", "H1");
  ok(dock(T, "p1", ["H1"]).end.confirm === true && dock(T, "p1", ["H1"], { endArmed: true }).end.armed === true, "UXC-1: the rule holds after the slots are marked by hand");
}

/* ---- FXP-6: the tick on the GM seat */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Kid" }).hero("H2", "p2", { name: "Eve" }).npc("N1", { name: "Doc", health: 9 }).npc("N2", { name: "Mauler", health: 9 }); T.order(["N1", "H1", "H2", "N2"]);
  await markAll(T, "gm", "N1");
  const off = gmDock(T, "N1").end, on = gmDock(T, "N1", {}, true).end;
  eq([off.auto, off.ready, off.confirm], [false, true, true], "FXP-6: GM tick off: the spent NPC turn waits for End turn and its question");
  eq([on.auto, on.label, N.autoDelay(on, 1500)], [true, PL["ITAC.ui.end.auto"], 1500], "FXP-6: GM tick on: the spent NPC turn passes by itself (no staff exception any more)");
  ok(!/spent && facts\.staff/.test(src("./ui/model-pure.mjs")), "FXP-6: the GM seat's exception (FXP U179) is gone from the model");
}

/* ---- FXN-1: a turn that starts with nothing left */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Kid" }).npc("N1", { name: "A", health: 9 }).npc("N2", { name: "B", health: 9 }); T.order(["N1", "N2", "H1"]);
  const blocked = async (n) => {
    T.turn(n); await T.gm(decl(n, "slugfest", ["H1"]));
    const p = T.prompt("reaction", "H1"); await T.req("p1", { op: "answer", prompt: p.id, value: "block" });
    await T.roll("attack", 0); if (T.top()?.rolls?.["def:H1"]) await T.roll("def:H1", 0);
  };
  await blocked("N1"); await blocked("N2");
  T.turn("H1");
  const on = dock(T, "p1", ["H1"], {}, true), off = dock(T, "p1", ["H1"]);
  eq([on.end.auto, on.end.spent, N.autoDelay(on.end, 1500), on.out?.reason, on.out?.text], [true, true, 3500, "spent", PL["ITAC.ui.out.spent"]], "FXN-1: tick on: started spent: passes after 3.5 s, the hourglass line says it will");
  eq([off.end.auto, off.end.ready, off.end.confirm, !!off.end.spent, off.out?.reason, off.out?.text], [false, true, true, true, "spent", PL["ITAC.ui.out.spentAsk"]], "FXN-1: tick off: it waits for End turn and its question; the hourglass line says why, not that it passes");
  eq([FP.hintOf(on, [], t), FP.hintOf(off, [], t)], [null, null], "FXN-1: no first-turn hint either way");
  ok(N.AUTO_SPENT_MS === 3500, "FXN-1: 3.5 s stays");
  /* the GM's NPC that starts spent: FXP-6 + FXN-1 together */
  const G = new Table(); G.hero("H1", "p1", { name: "Kid" }).hero("H2", "p2", { name: "Eve" }).npc("N1", { name: "Doc", health: 9 }).npc("N2", { health: 9 }); G.order(["H1", "H2", "N1", "N2"]);
  const hit = async (h, u) => { G.turn(h); await G.req(u, decl(h, "slugfest", ["N1"])); const p = G.prompt("reaction", "N1"); if (p) await G.answer("gm", "reaction", "block", "N1"); for (let i = 0; i < 4; i++) { const k = Object.keys(G.top()?.rolls ?? {}).find((x) => G.top().rolls[x].sixes == null); if (!k) break; await G.roll(k, 0); } };
  await hit("H1", "p1"); await hit("H2", "p2"); G.turn("N1");
  const gOn = gmDock(G, "N1", {}, true), gOff = gmDock(G, "N1");
  eq([gOn.end.auto, gOn.end.spent, N.autoDelay(gOn.end, 1500)], [true, true, 3500], "FXN-1 + FXP-6: the GM's tick: an NPC turn that starts spent passes after 3.5 s");
  eq([gOff.end.auto, gOff.end.confirm, gOff.out?.reason], [false, true, "spent"], "FXN-1 + FXP-6: without it: the hourglass line, End turn asks");
}

/* ---- the keys: Space opens the question and answers Yes; Esc answers No first */
{
  const d = { show: true, rest: false, prompts: [], end: { req: { op: "endTurn" }, armed: false, confirm: true } };
  eq(K.plan(d, {}, { key: " " }), { click: "end" }, "keys: Space presses End turn (which opens the question)");
  const a = { ...d, end: { ...d.end, armed: true } };
  eq(K.plan(a, { endArmed: true }, { key: " " }), { click: "end" }, "keys: Space again is the question's Yes");
  eq(K.plan(a, { endArmed: true }, { key: "Enter" }), { click: "end" }, "keys: Enter is the Yes too");
  eq(K.plan(a, { endArmed: true, armed: "move" }, { key: "Escape" }), { set: { endArmed: false } }, "keys: Esc answers No before it puts anything else away");
  eq(K.plan(d, { armed: "move" }, { key: "Escape" }), { set: { armed: null, mode: null, amend: null } }, "keys: without the question Esc does what it did");
  ok(/st\.dock\.endArmed\) && Dock\.el\(\)\?\.contains\(document\.activeElement\)\) \{[^\n]*setDock\(st\.dock\.endArmed \? \{ endArmed: false \}/.test(src("./ui/main.mjs")), "keys: Esc with the focus in the dock answers No too");
}

/* ---- the tick: shared switch, kept per user */
{
  const seen = [];
  const off = AS.listen((v) => seen.push(v));
  eq([AS.get(), AS.set(true, { quiet: true }), seen], [false, true, []], "tick: off at first; loading what was stored tells nobody");
  AS.set(false, { quiet: true });
  eq([AS.toggle(), AS.toggle(), seen], [true, false, [true, false]], "tick: a click flips it and every listener hears it");
  AS.set(false); eq(seen.length, 2, "tick: setting the same value again is no change");
  off(); AS.toggle(); eq(seen.length, 2, "tick: an unsubscribed listener hears nothing"); AS.set(false, { quiet: true });
  eq([Lay.clean(null).autoSkip, Lay.clean({ autoSkip: true }).autoSkip, Lay.clean({ autoSkip: "yes" }).autoSkip], [false, true, false], "tick: the user's layout keeps it; off by default; only true is on");
  eq([Lay.stored(Lay.clean({ autoSkip: true })), Lay.stored(Lay.clean(null))], [{ autoSkip: true }, {}], "tick: stored only when on (an untouched layout stores nothing)");
  eq(Lay.merge(Lay.clean({ keys: true }), { autoSkip: true }), { hotbar: false, keys: true, desk: null, folds: {}, autoSkip: true }, "tick: a flip merges into the layout, the rest kept");
  const main = src("./ui/main.mjs");
  ok(/AutoSkip\.set\(layout\.autoSkip, \{ quiet: true \}\)/.test(main) && /AutoSkip\.listen\(\(on\) => \{ remember\(\{ autoSkip: on \}\); schedule\(\); \}\)/.test(main), "tick: main.mjs loads it from the user's layout, writes a flip back and draws the dock again");
  ok(/autoSkip: AutoSkip\.get\(\)/.test(main), "tick: the dock's model reads it (facts.autoSkip)");
}

/* ---- the initiative bar draws the tick (scripts/combat/bar.mjs) */
{
  const bar = src("../combat/bar.mjs");
  ok(/skipB = mk\("button", "icbar-skip"\)/.test(bar) && /skipB\.setAttribute\("role", "checkbox"\)/.test(bar), "bar: the tick is a button with the checkbox role");
  ok(/tail\.append\(skipB, nextB\)/.test(bar) && /shell\.append\(lead, scroller, tail\)/.test(bar), "bar: it stands at the bar's right end, over the GM's next-turn button");
  ok(/if \(ev\.target\.closest\?\.\("\.icbar-skip"\)\) \{ AutoSkip\.toggle\(\); return; \}/.test(bar), "bar: a click flips it");
  ok(/skipB\.hidden = !tactical/.test(bar) && /tactical = !!Tac\.sourceOf\(curCombat\)/.test(bar), "bar: shown in a fight of tactical combat only, on every seat (the GM's too)");
  ok(/setAttribute\("aria-checked", v\.checked\)/.test(bar) && /AutoSkip\.listen\(\(\) => paintSkip\(\)\)/.test(bar), "bar: it says whether it is ticked and follows every flip");
  for (const k of ["ICB.Bar.AutoSkip", "ICB.Bar.AutoSkip.on", "ICB.Bar.AutoSkip.off"]) ok(k in CEN && k in CPL, `bar: the key ${k} is in English and Polish`);
  eq(CPL["ICB.Bar.AutoSkip"], "Auto-pomiń turę bez akcji", "bar: the tick's Polish name is the user's words, close and short");
  const css = src("../../styles/combat.css");
  ok(/\.icbar-skip\[aria-checked="true"\] \.icbar-skip-box/.test(css) && /\.icbar-shell > \.icbar-tail/.test(css), "bar: the stylesheet draws the ticked box and the right column");
}

/* ---- the dock draws the question (scripts/tactics/ui/dock.mjs) */
{
  const dk = src("./ui/dock.mjs");
  ok(/const ENDQ_GUARD_MS = 350;/.test(dk) && /if \(Date\.now\(\) - endAskedAt < ENDQ_GUARD_MS\) return;/.test(dk), "dock: a double click never ends a turn by itself (the second press within 350 ms is not taken)");
  ok(/h\("div\.itd-endq"/.test(dk) && /itd-endq-yes/.test(dk) && /itd-endq-no[^\n]*set\(\{ endArmed: false \}\)/.test(dk), "dock: the balloon over End turn: title, line, Yes, No (No closes it)");
  ok(/\.itd-end-ready/.test(dk), "dock: End turn with nothing left (tick off) is drawn ready");
  const css = src("../../styles/tactics-ui.css");
  ok(/\.itd-endq \{/.test(css) && /\.itd-endq::before/.test(css) && /@media \(prefers-reduced-motion: reduce\) \{ \.itd-endq \{ animation: none; \} \}/.test(css), "dock: the stylesheet draws the balloon with its tail, still under reduced motion");
  for (const k of ["ITAC.ui.endq.title", "ITAC.ui.endq.left", "ITAC.ui.endq.none", "ITAC.ui.endq.yes", "ITAC.ui.endq.no", "ITAC.ui.end.readyTip", "ITAC.ui.out.spentAsk"]) ok(k in EN && k in PL, `dock: the key ${k} is in English and Polish`);
}
done("check-ansa");
