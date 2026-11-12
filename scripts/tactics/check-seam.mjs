/* node scripts/tactics/check-seam.mjs -- THE SEAMS of the UX wave (packages uxa, uxb, uxc, uxd merged into one branch): the places where
   two packages changed the same flow, each green on its own. Every block names the two rows it joins.
     A  U141 x U145  the news line counts the fallen minions whichever card the GM settled them on (the one card, the standing fate's
                     number card, a hazard's card); no second card
     B  U141 x D127  the news line of a key NPC put down says both: broken, and the injury the die came to
     C  U141 x D127  a chain or a hazard told as one line keeps every row's minions and injury; "no damage" never swallows one
     D  U144 x D128  the turn that passes by itself waits for the 3D dice still in the air (news-pure endWhileDice, main.mjs)
     E  U144 x U148  a resting dock never passes a turn by itself; the dock that passes it is never the resting one
     F  U143 x D128  a card held back for the dice is not the card the digit key answers; its 0.7 s count from when it shows
     G  D128 x U140  the desk counts no card held back for the dice (badge, igd-busy: an idle desk steps back while aiming)
     H  U145 x U154  the minion card's counter holds to the desk's edge with the answers it changes; the "Stary czas" card's answers hold too
     I  U159 x U145 / U157  the waiting line names the GM's new cards in words
   Through the REAL director, engine and view (testkit Table) and the real render data (ui/model-pure.mjs). */
import { readFileSync } from "node:fs";
import { Table, ok, eq, done } from "./testkit.mjs";
import * as V from "./view-pure.mjs";
import * as D from "./desk-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./ui/model-pure.mjs";
import * as N from "./ui/news-pure.mjs";
import { EN, PL, tIn } from "./lang.mjs";

const src = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const tr = (l) => (k, p = {}, f) => tIn(l, k, p, f);
const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const meta = (T) => ({ hidden: Object.keys(T.c).filter((id) => T.c[id].hidden), npc: Object.keys(T.c).filter((id) => T.c[id].npc) });
const pv = (T, u, owns) => V.viewFor(T.state, { id: u, staff: false, owns }, meta(T));
const pf = (T, u, view) => ({ view, staff: false, me: u, c: (id) => (T.c[id] ? { name: T.c[id].name ?? id, npc: T.c[id].npc } : null), attrs: (id) => T.c[id]?.attrs ?? null, userName: (x) => `user-${x}` });
const line = (T, u, owns, l = "en") => { const v = pv(T, u, owns); return M.newsData(v, {}, pf(T, u, v), tr(l)); };
const ctx = (T) => ({ c: (id) => T.c[id] ?? null, online: () => true, P1 });
/* ANSA (UXC-1): these seams are about a turn that passes by itself, which it does only with the auto-skip tick on: this seat has it on */
const dock = (T, u, owns, own = {}, l = "en", autoSkip = true) => { const v = pv(T, u, owns); return M.dockData(D.playerModel(v, { id: u, owns }, ctx(T)), own, { ...pf(T, u, v), autoSkip }, tr(l)); };
const gmFacts = (T) => ({ view: T.state, staff: true, me: "gm", c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc } : null), attrs: (id) => T.c[id]?.attrs ?? null, userName: (x) => x, online: () => true });
const desk = (T, l = "en") => M.deskData(D.deskModel(T.state, T.log, ctx(T)), {}, gmFacts(T), tr(l));
const pass = async (T) => { for (const p of T.prompts("reaction")) await T.req("gm", { op: "answerFor", prompt: p.id, value: "pass" }); };
/* an area shot of Kid's into the zone of a boss and a group of five */
const areaShot = async (setup = () => {}) => {
  const T = new Table(); T.hero("H1", "p1", { name: "Kid" }).npc("N1", { name: "Boss", health: 6 }); T.weapons.nade = { id: "nade", bonus: 0, damage: 3, range: [0, 1], area: true };
  T.add("M1", { npc: true, kind: "minions", members: 5, health: 5, name: "Soldier", zone: "z2" }); T.c.N1.zone = "z2"; T.order(["H1", "N1", "M1"]).turn("H1");
  await setup(T);
  await T.req("p1", { op: "declare", actor: "H1", decl: { action: "shoot", targets: ["M1"], weapon: "nade", area: true } });
  await pass(T); await T.roll("attack", 1);
  return T;
};
const settle = async (T) => { if (T.prompt("stunts")) await T.answer("p1", "stunts", []); };

/* ---- A: U141 x U145 */
{
  let T = await areaShot();
  eq([T.prompt("minionsQuick")?.about, T.prompt("minionLoss"), T.prompt("minionsFate")], ["M1", null, null], "A U145: the area shot asks the GM ONE card for the group");
  eq(code(await T.answer("gm", "minionsQuick", "kill:2", "M1")), "ok", "A U145: one click (2, killed)");
  await settle(T);
  eq([T.prompt("minionsFate"), T.c.M1.health], [null, 3], "A U145: no second card; two are gone");
  ok(/Soldier: hit, \[\[damage:2\]\], 2 down/.test(line(T, "p1", ["H1"])?.text ?? ""), `A U141: the line counts the two the GM's one card felled (${line(T, "p1", ["H1"])?.text})`);
  ok(/Soldier: trafienie, \[\[damage:2\]\], padło: 2/.test(line(T, "p1", ["H1"], "pl")?.text ?? ""), "A U141: in Polish: padło: 2");
  eq((T.state.news ?? []).at(-1)?.rows?.find((r) => r.target === "M1")?.out, 2, "A U141: the engine's row carries the number the card gave, not the damage's (3)");

  T = await areaShot();
  eq(code(await T.answer("gm", "minionsQuick", "none", "M1")), "ok", "A U145: 'nobody falls' on the one card");
  await settle(T);
  const r = (T.state.news ?? []).at(-1)?.rows?.find((x) => x.target === "M1");
  eq([r?.out, r?.taken, T.c.M1.health, /down/.test(line(T, "p1", ["H1"])?.text ?? "")], [undefined, 0, 5, false], "A U141: none fell: the line counts none (no '0 down')");

  /* the GM's standing fate: the number-only card, the fate answers itself; the line counts them the same */
  T = await areaShot(async (U) => { await U.gm({ op: "npcPolicy", combatant: "M1", policy: { onBroken: "ko" } }); });
  eq([T.prompt("minionLoss")?.about, T.prompt("minionsQuick")], ["M1", null], "A U145: a group with a standing fate gets the number card");
  eq(code(await T.answer("gm", "minionLoss", "n:3", "M1")), "ok", "A U145: the number (3)");
  await settle(T);
  eq(T.prompts().filter((p) => p.kind === "minionsFate" && !p.auto).length, 0, "A U145: no fate card to answer (the standing answer said it)");
  ok(/Soldier: hit, \[\[damage:3\]\], 3 down/.test(line(T, "p1", ["H1"])?.text ?? ""), `A U141: the standing-fate group's fallen are counted too (${line(T, "p1", ["H1"])?.text})`);

  /* a blast the GM lets loose on the group: the hazard's minion card is the same one card, and its line counts them */
  const H = new Table(); H.hero("H1", "p1", { name: "Kid" }).npc("N1", { name: "Boss" }); H.add("M1", { npc: true, kind: "minions", members: 5, health: 5, name: "Soldier" }); H.order(["H1", "N1", "M1"]).turn("H1");
  H.dice.push([6, 6, 6, 1, 1, 1]);
  eq(code(await H.gm({ op: "hazardRun", run: { type: "blast", rating: 6, targets: ["M1"] } })), "ok", "A: the GM lets a blast loose on the group");
  for (let i = 0; i < 6 && !H.prompt("minionsQuick"); i++) {
    const p = H.prompts()[0]; if (!p) break;
    await H.req("gm", { op: "answerFor", prompt: p.id, value: p.options?.find((o) => o.id === "pass" || o.id === "none")?.id ?? p.options?.[0]?.id });
  }
  const q = H.prompt("minionsQuick");
  ok(q && !H.prompt("minionLoss"), `A U145: a hazard on the group asks the one card too (${H.prompts().map((p) => p.kind)})`);
  if (q) {
    eq(code(await H.answer("gm", "minionsQuick", "ko:2", "M1")), "ok", "A U145: the hazard's card answered (2, knocked out)");
    eq([H.prompt("minionsFate"), H.c.M1.health], [null, 3], "A U145: no fate card after the hazard's");
    const t = M.newsData({ news: (H.state.news ?? []).slice(-1), round: H.state.round }, {}, { ...gmFacts(H), staff: false, me: "p1" }, tr("en"))?.text ?? "";
    ok(/Soldier: .*2 down/.test(t), `A U141: the hazard's line counts them (${t})`);
  }
}

/* ---- B: U141 x D127 (the key NPC of check-uxc D127: broken by the blow, the injury rolled like a hero's) */
{
  const T = new Table(); T.hero("H1", "p1", { damage: 4, name: "Eve" }).npc("N2", { health: 3, kind: "hero", name: "Doc Seismic" }); T.order(["H1", "N2"]);
  await T.req("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N2"] } }); await pass(T);
  T.dice.push([2]); await T.roll("attack", 1); await settle(T);
  const row = (T.state.news ?? []).at(-1)?.rows?.[0];
  eq([row?.down, row?.crit], [1, { n: 3, id: "bloodied" }], "B: the engine's row has both uxb's `down` and uxc's `crit` (the union of newsRow)");
  for (const l of ["en", "pl"]) {
    const t = tr(l), text = line(T, "p1", ["H1"], l)?.text ?? "", crit = t("ITAC.float.crit", { n: 3, name: t("ITAC.crit.bloodied") });
    ok(text.includes(t("ITAC.status.broken").toLowerCase()) && text.includes(crit), `B (${l}): the line says broken AND the injury (${text})`);
    ok(text.indexOf(t("ITAC.status.broken").toLowerCase()) < text.indexOf(crit), `B (${l}): broken first, then what it came to`);
  }
}

/* ---- C: U141 x D127, the lines told as one */
{
  const g = N.groups([{ id: "n1", kind: "action", flow: "hazard", hazard: "fire", round: 2, rows: [{ target: "a", taken: 3, crit: { n: 5, id: "bloodied" } }] }, { id: "n2", kind: "action", flow: "hazard", hazard: "fire", round: 2, rows: [{ target: "m", taken: 2, out: 2 }] }]).map(N.merged);
  eq(g[0][0].rows, [{ target: "a", taken: 3, crit: { n: 5, id: "bloodied" } }, { target: "m", taken: 2, out: 2 }], "C: one fire on two is one line that keeps the injury and the fallen minions");
  const t = tr("en"), facts = { staff: false, me: "p", c: (id) => ({ name: id.toUpperCase() }) };
  const text = M.newsData({ news: g[0], round: 2 }, {}, facts, t)?.text ?? "";
  ok(text.includes(t("ITAC.float.crit", { n: 5, name: t("ITAC.crit.bloodied") })) && /M: \[\[damage:2\]\], 2 down/.test(text), `C: both are said (${text})`);
  const z = M.newsData({ news: [{ id: "n9", kind: "action", flow: "hazard", hazard: "fire", round: 2, rows: [{ target: "a", taken: 0 }, { target: "b", taken: 0, crit: { n: 2, id: "bloodied" } }] }], round: 2 }, {}, facts, t)?.text ?? "";
  ok(z.includes(t("ITAC.float.crit", { n: 2, name: t("ITAC.crit.bloodied") })), `C: "no damage: A, B" never swallows a row that tells an injury (${z})`);
}

/* ---- D: U144 x D128 */
{
  const end = { auto: true, label: "Turn ends", tip: "auto", req: { op: "endTurn" }, confirm: false }, plain = { label: "End turn", tip: "tip" };
  eq(N.endWhileDice(end, { busy: false, since: null, at: 5000 }, plain), end, "D: no dice in the air: the turn passes by itself as uxc made it");
  const w = N.endWhileDice(end, { busy: true, since: 4000, at: 5000 }, plain);
  eq([w.auto, w.label, w.tip, w.dice, w.req], [false, "End turn", "tip", 1, end.req], "D: dice in the air: the plain End turn (one click still ends it), the timer waits");
  eq(N.endWhileDice(end, { busy: true, since: 4000, at: 4000 + N.HOLD_MS + 1 }, plain).auto, true, "D: a stuck dice flag never keeps the turn (at most HOLD_MS)");
  eq(N.endWhileDice({ ...end, auto: false }, { busy: true, since: 1, at: 2 }, plain).dice, undefined, "D: a turn that does not pass by itself is not touched");
  const main = src("./ui/main.mjs");
  const iWait = main.indexOf("NewsP.endWhileDice(data.end"), iAuto = main.indexOf("autoEnd(combat, data)"), iHold = main.indexOf("if (hold.held)");
  ok(iHold > 0 && iWait > iHold && iAuto > iWait, "D: main.mjs: the dice hold, then the auto end's wait, then the timer is armed from what is shown");
  ok(/if \(data\.end\.dice\) diceThen\(\)/.test(main), "D: main.mjs: when the dice land the dock is drawn again (the 1.5 s start then)");
  ok(/autoTimer = setTimeout\(\(\) => \{ try \{ if \(diceBusy\(\) && Date\.now\(\) - \(diceWas\?\.since \?\? Date\.now\(\)\) <= NewsP\.HOLD_MS\) \{ autoKey = null; diceThen\(\); return; \}/.test(main), "D: main.mjs: dice thrown within the 1.5 s stop the press; it is armed again after them (bounded by HOLD_MS)");
}

/* ---- E: U144 x U148 */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Eve" }).hero("H2", "p2", { name: "Kid" }).npc("N1", { health: 9 }); T.order(["H1", "H2", "N1"]).turn("H1");
  await T.req("p1", { op: "mark", actor: "H1", unit: "full", on: true }); await T.req("p1", { op: "mark", actor: "H1", unit: "quick", on: true });
  const mine = dock(T, "p1", ["H1"]), other = dock(T, "p2", ["H2"]), quiet = dock(T, "p1", ["H1"], { quiet: true });
  eq([mine.end.auto, mine.rest], [true, false], "E: nothing left on my own turn: the turn passes by itself, the dock is not resting");
  eq([other.end.auto, other.rest], [false, true], "E: another's turn: the resting dock (uxa) has nothing that passes by itself (uxc)");
  eq(quiet.end.auto, false, "E: a seat that only watches never passes it");
  for (const [n, d] of [["mine", mine], ["other", other], ["quiet", quiet], ["peek", dock(T, "p2", ["H2"], { peek: true })]]) ok(!(d.rest && d.end.auto), `E: ${n}: never resting and passing by itself at once`);
  ok(/fk: "end", disabled: !!e\.disabled \|\| !!d\.rest/.test(src("./ui/dock.mjs")), "E: and the resting End turn is inert (dock.mjs), so Dock.press('end') on it does nothing");
}

/* ---- F: U143 x D128 */
{
  const main = src("./ui/main.mjs");
  const iFilter = main.indexOf("data.prompts = (data.prompts ?? []).filter((p) => hold.prompts.includes(p.id))"), iTop = main.indexOf("const top = data?.prompts?.[0]?.id ?? null"), iLast = main.indexOf("lastDock = data; lastModel = model;");
  ok(iFilter > 0 && iTop > iFilter && iLast > iFilter, "F: main.mjs: the keys act on (lastDock) and time (cardTop) the cards that SHOW, after the dice hold");
  /* the hold keeps the shown card on top; the new one comes when the dice land and only then starts its 0.7 s */
  let was = N.diceHold(null, { prompts: ["p1"], cards: [], news: null, at: 0 }, false);
  const held = N.diceHold({ ...was }, { prompts: ["p2", "p1"], cards: [], news: null, at: 100 }, true);
  eq([held.held, held.prompts], [true, ["p1"]], "F: a card that came while the dice roll is held; the top card stays the one shown");
  const out = N.diceHold({ ...held }, { prompts: ["p2", "p1"], cards: [], news: null, at: 2500 }, false);
  eq([out.held, out.prompts[0]], [false, "p2"], "F: the dice landed: the new card shows (main.mjs then starts its 0.7 s from now)");
}

/* ---- G: D128 x U140 */
{
  const d = { show: true, count: 3, cards: [{ id: "a" }, { id: "b" }], title: "x" };
  eq(N.holdDesk(d, ["a"]), { show: true, count: 2, cards: [{ id: "a" }], title: "x" }, "G: a held card is not counted (badge, igd-busy)");
  eq(N.holdDesk(d, ["a", "b"]), d, "G: nothing held: the same desk");
  eq(N.holdDesk({ show: true, count: 1, cards: [{ id: "a" }] }, []).count, 0, "G: the only card held: an idle desk (it may step back while the user aims)");
  ok(/deskD = NewsP\.holdDesk\(deskD, hold\.cards[,)]/.test(src("./ui/main.mjs")) && /root\.classList\.toggle\("igd-busy", d\.count > 0\)/.test(src("./ui/desk.mjs")), "G: main.mjs hands the desk that count; desk.mjs reads busy from it");
}

/* ---- H: U145 x U154 */
{
  const T = await areaShot();
  const a = desk(T).cards.find((c) => c.kind === "minionsQuick");
  ok(a?.count && a.options.length <= 4 && !a.submit, "H: the minion card has a counter and a short row of answers (the band that holds to the edge)");
  const dom = src("./ui/dom.mjs"), css = readFileSync(new URL("../../styles/tactics-ui.css", import.meta.url), "utf8");
  ok(/const countBand = \(a, count, opts\) => \(count \? h\("div\.ita-band", \{\}, count, opts\) : opts\);/.test(dom) && /countBand\(a, a\.count \? h\("div\.ita-count"/.test(dom), "H: dom.mjs: the counter and its answers are one band");
  ok(/^\.ita-band \{ display: contents; \}/m.test(css), "H: outside the desk the band is no box (the dock's cards unchanged)");
  ok(/#invincible-tactics-desk \.ita-ask:not\(\[data-wide\]\):not\(:has\(> \.ita-submit\)\) > \.ita-band \{ display: flex; flex-direction: column; gap: 6px; position: sticky; bottom: -12px;[^}]*background: var\(--ita-tile\)/.test(css), "H: on the desk the band holds to the bottom edge like the answers alone do (U154)");
  const S = new Table(); S.hero("H1", "p1").npc("N1").add("C1", { npc: true, kind: "challenge", name: "Reactor", health: 6, resolve: 0, maxResolve: 2, timeUnit: "rounds" });
  await S.gm({ op: "start", mode: "tactical", opts: {} });
  const s = desk(S).cards.find((c) => c.kind === "challengeStale");
  ok(s && s.options.length === 2 && !s.count && !s.submit, "H: the 'Stary czas' card is a short row of answers: it holds to the edge (U154)");
}

/* ---- I: U159 x U145 / U157 */
{
  const T = await areaShot();
  for (const l of ["en", "pl"]) {
    const w = M.waitingData(D.deskModel(T.state, T.log, ctx(T)).waiting, { ...gmFacts(T), staff: false, me: "p1" }, tr(l));
    const txt = w.flatMap((r) => r.what).join(" | ");
    ok(w.some((r) => r.gm) && txt.length > 0 && !/ITAC\./.test(txt), `I (${l}): the player is told in words that the GM settles the minion card (${txt})`);
  }
  const S = new Table(); S.hero("H1", "p1").npc("N1").add("C1", { npc: true, kind: "challenge", name: "Reactor", health: 6, resolve: 0, maxResolve: 2, timeUnit: "rounds" });
  await S.gm({ op: "start", mode: "tactical", opts: {} });
  const txt = M.waitingData(D.deskModel(S.state, S.log, ctx(S)).waiting, { ...gmFacts(S), staff: false, me: "p1" }, tr("pl")).flatMap((r) => r.what).join(" | ");
  ok(/stary czas/i.test(txt) && !/ITAC\./.test(txt), `I: the "Stary czas" card in the waiting line (${txt})`);
}

/* every key the seam reads exists in both languages */
for (const k of ["ITAC.ui.news.out", "ITAC.float.crit", "ITAC.ui.end", "ITAC.ui.end.tip", "ITAC.ui.end.auto", "ITAC.ui.key.space", "ITAC.opt.ko.n", "ITAC.opt.kill.n", "ITAC.card.challengeStale", "ITAC.card.minionsQuick"]) ok(k in EN && k in PL, `the key ${k} is in English and Polish`);

done("check-seam");
