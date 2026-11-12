/* node scripts/tactics/check-uxc.mjs -- UX wave, package "uxc" (THE FLOW): when the game stops, what it asks, how many clicks and keys
   a routine step costs. Rows of dev/combat-usability.md and dev/combat-defects.md ("UX review 1, 2026-11-12"):
     D127  a book villain at 0 Health: the injury it came to is told (journal, news, a float over the token), not a bare die
     U143  a reaction card: a digit sends the answer once the card has stood a moment (one key, not two)
     U144  ending a turn: one rule (nothing left -> it passes by itself; a spare quick action -> one click; "Sure?" only for a whole full action)
     U145  a minion group hit by an area: ONE card (how many, starting at what the damage says, and their fate), plural words
     U149  Guardian is not offered for an enemy an ally attacks
     U153  a card of many stunts: groups of what they do, the greyed ones last
     U157  a challenge whose clock ran down in an earlier fight: one card at the start of the fight
     D131  a fight's summary is shown once (not again when the stopped fight's combat is deleted, after a reload, or with a kept state)
     U158  a chase is set up by side in one click; the rows are folded
   Through the REAL director, engine, ledger and journal (testkit Table) and the real render data (ui/model-pure.mjs). */
import { Table, ok, eq, done } from "./testkit.mjs";
import * as D from "./desk-pure.mjs";
import * as V from "./view-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./ui/model-pure.mjs";
import * as Keys from "./ui/keys-pure.mjs";
import * as FP from "./ui/feedback-pure.mjs";
import * as SC from "./ui/scene-pure.mjs";
import * as KP from "./kit-pure.mjs";
import * as Kit from "./flows/kit.mjs";
import * as C from "./catalog-pure.mjs";
import { t as T0, EN, PL } from "./lang.mjs";

const t = (key, params, fallback) => { ok(fallback !== undefined || key in EN, `the key ${key} exists`); return T0(key, params, fallback); };
const lang = (l) => { globalThis.game = { i18n: { lang: l } }; };
const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const decl = (actor, action, targets, extra = {}) => ({ op: "declare", actor, decl: { action, targets, ...extra } });
const pass = async (T) => { for (const p of T.prompts("reaction")) await T.req(p.to === "gm" ? "gm" : p.to.users[0], { op: p.to === "gm" ? "answerFor" : "answer", prompt: p.id, value: "pass" }); };
const meta = (T) => ({ hidden: Object.values(T.c).filter((c) => c.hidden).map((c) => c.id), npc: Object.values(T.c).filter((c) => c.npc).map((c) => c.id) });
const facts = (T, view, me, staff = false) => ({ view, me, staff, c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc, img: null } : null), attrs: (id) => T.c[id]?.attrs ?? null, userName: (u) => `user-${u}`, preview: () => null });
const ctx = (T) => ({ c: (id) => T.c[id] ?? null, online: () => true, P1 });
const dock = (T, uid, owns, own = {}) => { const view = V.viewFor(T.state, { id: uid, staff: false, owns }, meta(T)); return M.dockData(D.playerModel(view, { id: uid, owns }, ctx(T)), own, facts(T, view, uid), t); };
const staffDock = (T, cid, own = {}) => { const d = D.deskModel(T.state, T.log, ctx(T)); const bar = D.barModel(T.state, cid, { ...ctx(T), staff: true }); return M.dockData({ bars: [bar], prompts: [], mine: [], stack: d.info, waiting: d.waiting, turn: d.turn }, own, facts(T, T.state, "gm", true), t); };
const desk = (T, own = {}) => M.deskData(D.deskModel(T.state, T.log, ctx(T)), own, facts(T, T.state, "gm", true), t);
const item = (id, name) => ({ id, name, type: "talent", level: null, power: null, boosts: [], autos: [], fx: [], flags: { kit: null, off: false, types: [] }, wf: {} });
const give = (T, cid, ...names) => { const c = T.c[cid]; c.kit = KP.build({ items: names.map((n, i) => item(`i${i}${cid}`, n)), attrs: c.attrs }); c.pass = c.kit.pass; return T; };
lang("pl");

/* ---- U149: Guardian [B2115] only for somebody of the guardian's own side (provisional, question UXC-3) */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Kid" }).hero("H2", "p2", { name: "Omni" }).npc("N1", { health: 9 }).npc("N2", { health: 9 }); give(T, "H1", "Guardian"); T.order(["H2", "H1", "N1", "N2"]);
  eq(code(await T.req("p2", decl("H2", "slugfest", ["N1"]))), "ok", "U149: an ally attacks an enemy in the guardian's zone");
  eq(T.prompts("reaction").filter((p) => p.about === "H1").length, 0, "U149: the guardian is not stopped with 'take the hit' for the enemy");
  const e = T.c.H1.kit.actions.find((a) => a.id.endsWith("-guardian")), v = { state: T.state, facts: T.facts(), entry: (i) => C.entryFor(T.state, i.actor, i.action, T.facts()) };
  eq(Kit.reactionFor(v, T.top(), "H1", e), [], "U149: the rule names nobody to cover");
  await pass(T); await T.roll("attack", 0);
  T.turn("N1");
  await T.gm(decl("N1", "slugfest", ["H2"]));
  eq(T.prompts("reaction").filter((p) => p.about === "H1").length, 1, "U149: an enemy attacking the ally still asks the guardian");
}

/* ---- U143: one key for the most frequent answer */
{
  const d = { prompts: [{ id: "p9", options: [{ id: "block" }, { id: "pass" }] }] }, fk = "opt:p9:block";
  eq(Keys.plan(d, {}, { key: "1" }), { set: { kopt: fk } }, "U143: a card that has just come up: a digit only chooses (the guard against a key meant for the bar)");
  eq(Keys.plan(d, {}, { key: "1", age: Keys.CARD_SETTLE_MS - 1 }), { set: { kopt: fk } }, "U143: still choosing just before the moment is over");
  eq(Keys.plan(d, {}, { key: "1", age: Keys.CARD_SETTLE_MS }), { click: fk }, "U143: a card that has stood a moment: the digit sends the answer (one key)");
  eq(Keys.plan(d, { kopt: fk }, { key: "1" }), { click: fk }, "U143: the same digit again sends it at once");
  eq(Keys.plan({ prompts: [{ id: "p9", multi: { max: 1 }, options: [{ id: "a" }] }] }, {}, { key: "1", age: 5000 }), { click: "opt:p9:a" }, "U143: a card of several answers still ticks");
}

/* ---- U144: ending a turn */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Eve" }).npc("N1", { name: "Mauler", health: 9 }).npc("N2", { health: 9 }); T.order(["H1", "N1", "N2"]);
  let e = dock(T, "p1", ["H1"]).end;
  eq([e.confirm, e.auto, /Kliknij ponownie/.test(e.tip)], [true, false, true], "U144: a whole full action unused: 'Sure?' is asked and the tip says so");
  await T.req("p1", decl("H1", "slugfest", ["N1"])); await pass(T); await T.roll("attack", 0);
  e = dock(T, "p1", ["H1"]).end;
  eq([e.confirm, e.auto, /Kliknij ponownie/.test(e.tip), /Szybka/.test(e.tip)], [false, false, false, true], "U144: only the spare quick action left: one click, the tip names it and asks for no second click");
  await T.req("p1", { op: "mark", actor: "H1", unit: "quick", on: true });
  e = dock(T, "p1", ["H1"]).end;
  eq([e.auto, e.label, e.confirm], [true, PL["ITAC.ui.end.auto"], false], "U144: nothing left: the turn passes by itself (the button says so)");
  eq(dock(T, "p1", ["H1"], { quiet: true }).end.auto, false, "U144: a seat that only watches (the GM's quiet dock) never passes it");
  eq(code(await T.req("p1", e.req)), "ok", "U144: the same request a click sends");
  T.turn("N1");
  const g = staffDock(T, "N1").end;
  eq([g.confirm, /Kliknij ponownie/.test(g.tip)], [false, false], "U144: the GM's NPC with actions left: one click and the tip does not say 'click again'");
  /* something still owed: no pass by itself */
  const U = new Table(); U.hero("H1", "p1").npc("N1", { health: 9 }); U.order(["H1", "N1"]);
  await U.req("p1", { op: "mark", actor: "H1", unit: "full", on: true }); await U.req("p1", { op: "mark", actor: "H1", unit: "quick", on: true });
  eq(dock(U, "p1", ["H1"]).end.auto, true, "U144: both slots marked by hand: nothing left");
  eq(dock(U, "p1", ["H1"], { armed: "move" }).end.auto, false, "U144: an action armed: the turn waits");
}

/* ---- U145: one card for a minion group hit by an area */
{
  const T = new Table(); T.hero("H1", "p1").hero("H2", "p2").npc("N1", { health: 6 }).npc("N2", { health: 6 }); T.add("M1", { npc: true, name: "Soldiers", kind: "minions", members: 6, health: 6 });
  T.weapons.nade = { id: "nade", bonus: 0, damage: 3, range: [0, 3], blast: 2, area: true }; T.order(["H1", "N1", "H2", "N2", "M1"]);
  eq(code(await T.req("p1", decl("H1", "shoot", ["N1"], { weapon: "nade", area: true }))), "ok", "U145: an area shot into the group's zone");
  await pass(T); await T.roll("attack", 1);
  const q = T.prompt("minionsQuick");
  eq([q?.about, T.prompt("minionLoss"), q?.data?.suggested], ["M1", null, 3], "U145: one card for the group, starting at what the damage says");
  const a = desk(T).cards.find((c) => c.kind === "minionsQuick");
  eq([a?.count?.value, a?.options.map((o) => o.label)], [3, [PL["ITAC.opt.ko.n"].replace("{n}", "3"), PL["ITAC.opt.kill.n"].replace("{n}", "3")]], "U145: the card shows the number (3) and two answers that say it back, in the plural");
  eq(code(await T.answer("gm", "minionsQuick", "kill:3", "M1")), "ok", "U145: one click");
  eq([T.prompt("minionsFate"), T.c.M1.health], [null, 3], "U145: no second question; three of the group are gone");
  /* a group whose fate is the GM's standing answer: the number alone, one answer */
  const U = new Table(); U.hero("H1", "p1").npc("N1", { health: 6 }); U.add("M1", { npc: true, name: "Soldiers", kind: "minions", members: 6, health: 6 }); U.weapons.nade = T.weapons.nade; U.order(["H1", "N1", "M1"]);
  await U.gm({ op: "npcPolicy", combatant: "M1", policy: { onBroken: "ko" } });
  await U.req("p1", decl("H1", "shoot", ["N1"], { weapon: "nade", area: true })); await pass(U); await U.roll("attack", 1);
  const b = desk(U).cards.find((c) => c.kind === "minionLoss");
  eq([b?.count?.value, b?.options.length, b?.options[0]?.label], [3, 1, PL["ITAC.opt.minionsFall"].replace("{n}", "3")], "U145: the number-only card is the same counter with one answer, not a row of equal buttons");
}

/* ---- U153: a card of many stunts */
{
  const T = new Table(); T.hero("H1", "p1", { damage: 3 }).npc("N1", { health: 20 }); T.order(["H1", "N1"]);
  await T.req("p1", decl("H1", "slugfest", ["N1"])); await pass(T); await T.roll("attack", 4);
  const c = dock(T, "p1", ["H1"]).prompts[0], groups = [...new Set(c.options.map((o) => o.group?.label ?? ""))];
  eq(groups, [PL["ITAC.ui.stunt.th.harm"], PL["ITAC.ui.stunt.th.control"], PL["ITAC.ui.stunt.g.more"], PL["ITAC.ui.stunt.th.own"]], "U153: the stunts stand in four groups of what they do");
  const keys = c.options.filter((o) => !o.disabled).map((o) => o.key);
  eq([keys.join(""), c.options.findIndex((o) => o.disabled && o.group?.label === PL["ITAC.ui.stunt.th.harm"]) === 1], ["1234567", true], "U153: the keys follow the order shown; a greyed stunt stands last in its group");
}

/* ---- U157: a challenge's clock from an earlier fight */
{
  const T = new Table(); T.hero("H1", "p1").npc("N1").add("C1", { npc: true, kind: "challenge", name: "Reactor", health: 6, resolve: 0, maxResolve: 2, timeUnit: "rounds" }).add("C2", { npc: true, kind: "challenge", name: "Fresh", health: 3, resolve: 3, maxResolve: 3, timeUnit: "rounds" });
  eq(code(await T.gm({ op: "start", mode: "tactical", opts: {} })), "ok", "U157: a new fight starts");
  eq(T.prompts().filter((p) => p.kind === "challengeStale").map((p) => [p.about, p.data.left, p.data.max]), [["C1", 0, 2]], "U157: the GM is asked about the challenge whose time ran down before (only that one)");
  const card = desk(T).cards.find((c) => c.kind === "challengeStale");
  ok(card && card.lines.join(" ").includes("0 z 2") && card.options.length === 2, "U157: the card says how much was left and offers two answers");
  eq(code(await T.gm({ op: "answerFor", prompt: T.prompt("challengeStale")?.id, value: "reset" })), "ok", "U157: start the clock again");
  eq([T.c.C1.resolve, /clockReset/.test(T.log.list.at(-1)?.label?.gm ?? "")], [2, true], "U157: its time is back at the limit, in the journal (the GM can undo it)");
  const U = new Table(); U.hero("H1", "p1").add("C1", { npc: true, kind: "challenge", name: "Reactor", health: 6, resolve: 1, maxResolve: 2, timeUnit: "rounds" });
  await U.gm({ op: "start", mode: "tactical", opts: {} });
  await U.gm({ op: "answerFor", prompt: U.prompt("challengeStale")?.id, value: "keep" });
  eq([U.c.C1.resolve, U.prompt("challengeStale")], [1, null], "U157: 'leave it' changes nothing");
}

/* ---- D131: the summary of a fight is shown once */
{
  const F = (n, ...a) => (typeof FP[n] === "function" ? FP[n](...a) : undefined);      // (absent before D131: the check fails, it does not stop)
  const tally = { combat: "c1", entries: { 1: { round: 1, actor: "H1", rows: [{ target: "N1", hit: true, taken: 2 }] } } };
  let done = [];
  const over = F("fightOver", tally, "c1", done) ?? {}; done = over.done;
  eq(over.card, true, "D131: the fight ends (its scene ended): its card, once");
  eq(F("fightOver", tally, "c1", done)?.card, false, "D131: the GM stops it later, or deletes its combat: no card again");
  eq(F("tallyFor", null, "c1", [{ id: "n1", kind: "action", round: 1, rows: [{ target: "N1", hit: true }] }], done), null, "D131: a kept state (scene ended) does not build a new tally for the same fight");
  eq(F("doneLive", done, "c1", { phase: "sceneEnd" }), ["c1"], "D131: a fight still over stays summed up");
  eq(F("doneLive", done, "c1", { phase: "turns" }), [], "D131: the same combat started again is a new fight");
  eq(F("doneOf", Array.from({ length: 30 }, (_, i) => `c${i}`))?.length, FP.DONE_MAX, "D131: the list stays short");
}

/* ---- U158: a chase set up by side */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Eve" }).hero("H2", "p2", { name: "Kid" }).npc("N1", { name: "Mauler" }).npc("N2", { name: "Soldier" }); T.order(["H1", "N1", "H2", "N2"]);
  const f = facts(T, T.state, "gm", true), s0 = SC.sceneData(T.state, {}, f, t).chase;
  eq([s0.presets?.length, s0.rows?.open, s0.start.req], [2, false, null], "U158: two side buttons; the rows are folded; nothing to start yet");
  const s1 = SC.sceneData(T.state, { side: s0.presets?.find((p) => p.id === "prey").side ?? {} }, f, t).chase;
  eq([s1.start.req?.prey, s1.start.req?.pursuer, s1.presets?.find((p) => p.id === "prey").on], [["H1", "H2"], ["N1", "N2"], true], "U158: one click: the heroes flee, the others pursue; the chase can start");
  eq(SC.sceneData(T.state, { rows: true }, f, t).chase.rows?.open, true, "U158: the rows open for an exception");
}

/* ---- D127: a book villain at 0 Health (type superhero on the GM's side: kind "hero", npc) [B2707], [B2771], [B3907] */
{
  const T = new Table(); T.hero("H1", "p1", { damage: 4, name: "Eve" }).npc("N2", { health: 3, kind: "hero", name: "Doc Seismic" }); T.order(["H1", "N2"]);
  await T.req("p1", decl("H1", "slugfest", ["N2"])); await pass(T);
  T.dice.push([2]);
  await T.roll("attack", 1);
  eq([T.prompt("npcBroken"), T.c.N2.crits], [null, [3]], "D127: a key NPC rolls its injury like a hero, no card [B2771]");
  ok((T.state.statuses.N2 ?? []).some((s) => s.id === "broken"), "D127: and is broken (the map's mark)");
  const L = T.log.list.at(-1)?.label ?? {};
  ok(/\[Doc Seismic: \{ITAC\.journal\.crit\} 3 \(\{ITAC\.crit\.bloodied\}\)\]/.test(L.gm ?? "") && /\{c:N2\}: \{ITAC\.journal\.crit\} 3/.test(L.pub ?? ""), `D127: the journal says what the die came to (${L.gm})`);
  const n = (T.state.news ?? []).at(-1);
  eq(n?.rows?.[0]?.crit, { n: 3, id: "bloodied" }, "D127: so does the table's news");
  eq(M.marks(t, L.gm), "Eve: Bijatyka -> Doc Seismic (trafienie) [Doc Seismic: rana krytyczna 3 (Zakrwawiony!)]", "D127: in the reader's words");
  const fl = FP.floats([{ type: "crit", target: "N2", crit: { roll: 3, total: 3, id: "bloodied" } }], t);
  eq(fl.map((x) => x.text), ["Rana 3: Zakrwawiony!"], "D127: and over the token");
  ok(Object.keys(EN).filter((k) => k.startsWith("ITAC.crit.")).length === 13 && Object.keys(EN).filter((k) => k.startsWith("ITAC.crit.")).every((k) => PL[k]), "D127: every row of the injury table is named in both languages");
}

done("check-uxc");
