/* node scripts/tactics/check-fxr.mjs -- FIXER R (tree tactics, tag tactics-integrated-59): the third review wave's items whose cause sat in more
   than one file or needed words in the language files, and the logic rows the visual fixer FXQ left. One block per item; each fails on the
   code before its fix and pins the fix. Whole fights run through the REAL director, engine and view (testkit Table); what only Foundry
   runs is pinned by reading its source. (T040 is pinned in check-executor.mjs: Engine.context needs the fake Foundry there.)
     T058  a flier in a high-gravity zone: the greyed move read the raw reason "noAerial"
     T064  the end card of the second chase of one fight was never shown (every chase ended as number 1)
     T065  the catch's ram or charge roll was captioned "AGILITY for the pursuers"
     T046  the chase roll ignored the push rules of its roller (an ordinary NPC, a quick group, Overconfident above half Health)
     T052  the vacuum's rounds of exposure kept counting after the character got back to pressure
     T039  the splash's milestone tags (FIRST SUCCESS! ...) stayed English on a Polish seat
     U185  the initiative bar stayed under a popped-out chat (FXQ-3)
     U187  the players heard nothing of the GM's Apply on a time-up card
     U188  "Drive: done" named no place; a hit that dealt 0 was told with Double Damage
     U190  the hazard form's "Where" named the dead and NPCs already out of the fight
     U191  a card held back while the dice rolled showed its waiting clock with the held seconds counted */
import { readFileSync } from "node:fs";
import { Table, ok, eq, done } from "./testkit.mjs";
import * as V from "./view-pure.mjs";
import * as CP from "./ui/chase-pure.mjs";
import * as M from "./ui/model-pure.mjs";
import * as F from "./ui/feedback-pure.mjs";
import * as MP from "./mods-pure.mjs";
import * as NP from "./ui/news-pure.mjs";
import * as SL from "../splash/logic.mjs";
import * as SLang from "../splash/lang.mjs";
import { tIn, EN, PL } from "./lang.mjs";

const here = new URL(".", import.meta.url);
const src = (p) => readFileSync(new URL(p, here), "utf8");
const tr = (l) => (k, p = {}, f) => tIn(l, k, p, f);
const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const soft = (mod, n) => (typeof mod[n] === "function" ? mod[n] : () => undefined);      // a helper the fix added: the old tree FAILS, it does not stop

/* ================================================================== T058: noAerial has words in both languages */
for (const l of ["en", "pl"]) {
  const t = tr(l);
  const r = M.reasonText(t, "noAerial");
  ok(r && r !== "noAerial", `T058 ${l}: the greyed move's reason reads as words, not the id (got ${JSON.stringify(r)})`);
  const w = F.whyOf(t, "noAerial");
  ok(w && !/noAerial/.test(w.text) && w.fix && !/^ITAC\./.test(w.fix), `T058 ${l}: the sentence under the greyed move and the way round it (${JSON.stringify(w)})`);
}

/* ================================================================== chase helpers (as check-chase) */
const car = (o = {}) => ({ kind: "vehicle", npc: true, health: 8, vehicle: { type: "ground", speed: 3, maneuver: 1, passengers: 3, weapons: 0 }, ...o });
const t = tr("en");
function table() {
  const T = new Table();
  T.hero("H1", "p1", { name: "Kid" }).hero("H2", "p2", { name: "Omni" }).npc("N1", { health: 6, damage: 5, name: "Doc" }).npc("N2", { health: 6, name: "Mauler" });
  T.add("V1", car({ name: "Car" })); T.add("V2", car({ name: "Van" }));
  T.order(["H1", "N1", "H2", "N2"]).turn("H1");
  return T;
}
const facts = (T, v, me) => ({ view: v, staff: me === "gm", me, whole: me === "gm" ? (id) => T.c[id] ?? null : undefined,
  c: (id) => (T.c[id] ? { name: T.c[id].name ?? id, npc: !!T.c[id].npc, kind: T.c[id].kind ?? null, img: null, way: T.c[id].kind === "vehicle" ? null : CP.wayOf(T.c[id]) } : null), userName: (u) => `User ${u}`, online: () => true, rollBusy: () => false });
const view = (T, me, owns) => (me === "gm" ? T.state : V.viewFor(T.state, { id: me, staff: false, owns }, { hidden: [], npc: ["N1", "N2", "V1", "V2"] }));
const panel = (T, me, owns = [], own = {}) => CP.chaseData(view(T, me, owns), own, facts(T, view(T, me, owns), me), t);

/* ================================================================== T064: two chases in one fight, each end card shown once */
{
  const T = table();
  eq(code(await T.gm({ op: "chaseStart", prey: ["N1"], pursuer: ["H1"], distance: 3 })), "ok", "T064: (chase 1 starts)");
  eq(code(await T.gm({ op: "chaseEnd", outcome: "escaped" })), "ok", "T064: (chase 1 ends)");
  const n1 = T.state.chaseEnded?.n;
  eq(panel(T, "p1", ["H1"], { endSeen: n1 }), null, "T064: chase 1's card put away");
  eq(code(await T.gm({ op: "chaseStart", prey: ["N2"], pursuer: ["H2"], distance: 2 })), "ok", "T064: (chase 2 starts in the same fight)");
  eq(code(await T.gm({ op: "chaseEnd", outcome: "gaveUp" })), "ok", "T064: (chase 2 ends)");
  const n2 = T.state.chaseEnded?.n;
  ok(Number(n2) > Number(n1), `T064: the second chase's end has a later number than the first (${n1} -> ${n2})`);
  const card = panel(T, "p1", ["H1"], { endSeen: n1 });
  eq([card?.ended?.outcome ?? null, card?.ended?.close?.endSeen ?? null], ["gaveUp", n2], "T064: a seat that put chase 1's card away is shown how chase 2 ended");
  eq(panel(T, "p1", ["H1"], { endSeen: n2 }), null, "T064: ... and can put that one away too");
  eq(code(await T.gm({ op: "undo", tx: T.log.list[T.log.list.length - 1].id })), "ok", "T064: (the end of chase 2 undone)");
  eq(code(await T.gm({ op: "chaseEnd", outcome: "combat" })), "ok", "T064: (ended again)");
  eq(T.state.chaseEnded?.n, n2, "T064: an undone and repeated end keeps its chase's number");
  /* a private window: the browser stores nothing, the page's own record still closes the card */
  const seen = soft(CP, "endSeenOf");
  eq([seen("cbt1", null, "cbt1:2"), seen("cbt1", "cbt1:1", "cbt1:2"), seen("cbt1", "cbt1:3", null), seen("cbt1", "other:4", null), seen("cbt1", null, null)], [2, 2, 3, null, null], "T064: the put-away number: the browser's or the page's, the later wins, another fight's never");
  const mn = src("./ui/main.mjs");
  ok(/chaseSeenMem = `\$\{c\.id\}:\$\{patch\.endSeen\}`;\s*try \{ globalThis\.localStorage\?\.setItem\(CHASE_SEEN, chaseSeenMem\)/.test(mn) && /endSeen: ChaseP\.endSeenOf\(combat\.id, stored, chaseSeenMem\)/.test(mn), "T064: ui/main.mjs keeps the put-away card in the page as well as in the browser and reads both");
}

/* ================================================================== T065: the charge set off by a catch names its own roll */
{
  const T = table();
  await T.gm({ op: "chaseStart", prey: ["N1"], pursuer: ["H1"], distance: 1 });
  await T.gm({ op: "chaseRound", obstacle: "deadEnd" });
  await T.roll("pursuer", 1);
  const cp = T.prompt("chaseCatch");
  eq(code(await T.req("p1", { op: "answer", prompt: cp.id, value: "attack" })), "ok", "T065: (Kid charges)");
  for (let i = 0; i < 4; i++) { const p = Object.values(T.state.prompts).find((x) => !x.answered && x.to === "gm"); if (!p) break; await T.answer("gm", p.kind, p.options?.find((o) => o.id === "pass")?.id ?? p.options?.[0]?.id); }
  const d = panel(T, "p1", ["H1"]);
  const roll = T.top()?.rolls?.attack;
  eq(d?.decision?.kind, "catchRoll", "T065: (Kid's decision is the charge roll)");
  const text = d?.decision?.text ?? "";
  ok(text && text !== t("ITAC.chase.do.rollText.pursuer", { dice: d?.decision?.dice ?? "?" }) && !/AGILITY for the pursuers/.test(text), `T065: the charge roll is not captioned as the chase's AGILITY roll (${JSON.stringify(text)})`);
  ok(!roll?.attr || text.includes(M.attrText(t, roll.attr)), `T065: it names the attribute the charge rolls (${roll?.attr})`);
  for (const [l, L] of [["en", EN], ["pl", PL]]) ok(typeof L["ITAC.chase.do.catchText"] === "string" && typeof L["ITAC.chase.do.catchDice"] === "string", `T065 ${l}: the catch roll's caption exists`);
}

/* ================================================================== T046: each side's chase roll under its roller's own push rule */
{
  const T = table();
  T.c.H2.pass = { overconfident: 1 }; T.c.H2.maxHealth = T.c.H2.maxHealth ?? T.c.H2.health;
  await T.gm({ op: "chaseStart", prey: ["N1"], pursuer: ["H1"], distance: 2 });
  await T.gm({ op: "chaseRound" });
  const prey = T.requests.slice(-1)[0];
  await T.roll("prey", 1);
  const pur = T.requests.slice(-1)[0];
  eq([[prey?.key, prey?.combatant, prey?.maxPush], [pur?.key, pur?.combatant, pur?.maxPush]], [["prey", "N1", 0], ["pursuer", "H1", null]], "T046: an ordinary NPC's chase roll is not pushed [B2231]; the hero's is [B3433]");
  await T.roll("pursuer", 1);
  await T.gm({ op: "chaseEnd", outcome: "combat" });
  await T.gm({ op: "chaseStart", prey: ["N2"], pursuer: ["H2"], distance: 2 });
  await T.gm({ op: "chaseRound" }); await T.roll("prey", 1);
  const oc = T.requests.slice(-1)[0];
  eq([oc?.combatant, oc?.maxPush], ["H2", 0], "T046: Overconfident above half Health: the chase roll is not pushed either [B2186]");
}

/* ================================================================== T052: leaving the vacuum ends the exposure [B2929] */
class HT extends Table {      // as check-hazards: a table with a map whose zones carry tags
  constructor(o) { super(o); this.map = { zones: { z1: { tags: ["vacuum"] }, z2: {} }, areas: {} }; }
  facts() {
    const f = super.facts(), T = this;
    const place = (cid) => (T.c[cid] ? { zone: T.c[cid].zone, level: "ground", spot: T.c[cid].zone, area: null } : null);
    return { ...f, zones: { place, zone: (key) => (T.map.zones[key] ? { key, tags: T.map.zones[key].tags ?? [] } : null), states: () => [], graph: () => ({ zones: [], borders: [] }) } };
  }
}
{
  const T = new HT(); T.hero("H1", "p1", { zone: "z1" }).npc("N1", { health: 5, zone: "z2" }); T.order(["H1", "N1"]).turn("H1");
  const endTurn = (actor) => T.req("gm", { op: "endTurn", actor, round: T.state.round, slot: T.state.init.cur, force: true });
  async function nextRound() {
    for (let g = 0, n = 0; g < 40 && n < 6 && T.state.phase === "turns"; g++) {
      if (T.state.init.curMember) { await endTurn(T.state.init.curMember); n++; continue; }
      const p = T.prompts("triggerQueue")[0]; if (!p) break;
      await T.gm({ op: "answerFor", prompt: p.id, value: { order: [], skip: p.options.map((o) => o.id) } });
    }
    T.turn("H1");
  }
  const vac = () => MP.counterGet(T.state, MP.counterKey.scene("H1", "vacuum"));
  async function vacuumRoll() {
    const q = T.prompts("triggerQueue").find((p) => p.about === "H1" && p.options.some((o) => o.data?.type === "vacuum"));
    if (!q) return null;
    await T.gm({ op: "answer", prompt: q.id, value: { order: [] } });
    const r = T.lastRequest(); await T.roll("roll", 1); return r?.key === "roll" ? r.dice : null;
  }
  await nextRound();
  const d1 = await vacuumRoll();
  await T.gm({ op: "hazardRun", run: { type: "vacuum" }, subject: { combatant: "H1" } });
  const d2 = T.lastRequest()?.dice; await T.roll("roll", 1);
  eq([d1, d2, vac()], [4, 3, 2], "T052: (two rounds out in the vacuum: unmodified, then one die less)");
  T.c.H1.zone = "z2";                                           // back inside, at pressure
  await nextRound();
  eq([T.prompts("triggerQueue").some((p) => p.about === "H1"), vac()], [false, 0], "T052: a turn that starts at pressure ends the exposure");
  T.c.H1.zone = "z1";                                           // out again
  await nextRound();
  eq(await vacuumRoll(), 4, "T052: the next time out, the first roll is unmodified again");
  /* still out (or suffocating): the count goes on */
  await nextRound();
  eq(await vacuumRoll(), 3, "T052: a turn still in the vacuum keeps counting");
}

/* ================================================================== T039: the milestone tags in the table's language (D129) */
{
  const TAGS = ["FIRST SUCCESS!", "PUSH PAYS OFF!", "FIRST DOUBLE!", "NEW PERSONAL BEST!"];
  const plOf = (w) => SLang.PL[`INSPLASH.Say.${SL.SAYS[w]}`];
  ok(TAGS.every((w) => w in SL.SAYS && SLang.EN[`INSPLASH.Say.${SL.SAYS[w]}`] === w && plOf(w) && plOf(w) !== w), "T039: each milestone tag has its EN original and a Polish word");
  SL.setLabels({ words: Object.fromEntries(Object.values(SL.SAYS).map((k) => [k, SLang.PL[`INSPLASH.Say.${k}`]])) });
  eq(TAGS.map((w) => SL.say(w)), TAGS.map((w) => plOf(w) ?? w), "T039: on a PL seat the tags read Polish");
  ok(TAGS.every((w) => SL.say(w) !== w), "T039: ... none of them stays English");
  SL.setLabels({ words: {} });
  const sp = src("../splash/splash.mjs"), mn = src("../splash/main.mjs");
  ok(/labelOverride\?\.text \?\? \(tag \? say\(tag\) : oddsText\(P\)\)/.test(sp) && /ev\.tag \? say\(ev\.tag\) : oddsText/.test(mn) && /word = \(tag && say\(tag\)\) \|\| label/.test(mn), "T039: the ribbon, the screen reader's line and the chat badge all go through say()");
}

/* ================================================================== U185: the bar keeps beside a popped-out chat */
{
  const bar = src("../combat/bar.mjs"), cm = src("../combat/main.mjs");
  ok(/chat-popout[\s\S]{0,400}besideFloating\(/.test(bar) && (bar.match(/= beside\(/g) ?? []).length >= 2, "U185: combat/bar.mjs place() takes the side of a popped-out chat, on the top row and on the low row");
  const L = await import("./ui/layout-pure.mjs"), min = Number(/const BESIDE_MIN = (\d+)/.exec(bar)?.[1] ?? 200);
  eq(L.besideFloating(330, 984, { left: 533, right: 833 }, min, 10), { lo: 330, hi: 984 }, "U185, superseded by FXX: a chat over the middle at 1366 leaves no side a bar reads in (193 px): the strip keeps its room (in a fight the chat parks in the right column, check-fxx.mjs)");
  ok(/\["changeSidebarTab", "renderChatLog", "closeChatLog"\]/.test(cm), "U185: the bar is placed again when the chat pops out or comes back");
}

/* ================================================================== U187: the time-up card's Apply is told to the players */
{
  const W = new Table();
  W.hero("H1", "p1").hero("H2", "p2").npc("N1", { health: 6 });
  W.add("CH", { kind: "challenge", npc: true, health: 2, resolve: 3, maxResolve: 3, name: "Ward", zone: null });
  W.order(["H1", "N1", "H2"]).turn("H1");
  await W.gm({ op: "challengeSetup", challenge: "CH", preset: "magicalWard" });
  for (let i = 0; i < 3 && !W.prompt("challengeFail"); i++) {
    await W.gm({ op: "nextRound", force: true });
    const q = W.prompt("triggerQueue"); if (q) await W.gm({ op: "answer", prompt: q.id, value: { skip: (q.options ?? []).map((o) => o.id) } });
  }
  const f = W.prompt("challengeFail");
  ok(!!f, "U187: (the ward's time ran out)");
  if (f) {
    const before = (W.state.news ?? []).length;
    await W.gm({ op: "answer", prompt: f.id, value: "run" });
    const pv = V.viewFor(W.state, { id: "p1", staff: false, owns: ["H1"] }, { hidden: [], npc: ["N1", "CH"] });
    const nd = M.newsData(pv, {}, { staff: false, me: "p1", view: pv, c: (id) => (W.c[id] ? { name: W.c[id].name ?? id } : null) }, tr("pl"));
    ok((W.state.news ?? []).length > before && (nd?.text ?? "").includes(PL["ITAC.result.wardReset"]), `U187: a player's news line says what Apply did (${JSON.stringify(nd?.text)})`);
  }
}

/* ================================================================== U188: the news line of a drive and of a hit that dealt nothing */
{
  const fx = { staff: false, me: "p1", c: (id) => ({ name: { K: "Kid", O: "Omni", M: "Mauler" }[id] ?? id }), zone: (spot) => ({ id: Number(String(spot).replace(/\D/g, "")) || null, title: `Strefa ${String(spot).replace(/\D/g, "")}` }) };
  const vw = (n) => ({ round: 1, news: [{ id: "n1_f1", round: 1, ...n }] });
  const plain = M.newsData(vw({ kind: "action", actor: "K", action: "drive", flow: "vehicle", result: "done", rows: [] }), {}, fx, tr("pl"));
  const drove = M.newsData(vw({ kind: "action", actor: "K", action: "drive", flow: "vehicle", result: "done", to: "z7", rows: [] }), {}, fx, tr("pl"));
  ok(drove?.text && drove.text !== plain?.text && /7/.test(drove.text), `U188: "Drive" names where it went (${JSON.stringify(drove?.text)} vs ${JSON.stringify(plain?.text)})`);
  const nil = M.newsData(vw({ kind: "action", actor: "M", action: "shoot", result: "hit", rows: [{ target: "O", hit: true, taken: 0, stunts: ["doubleDamage"] }] }), {}, fx, tr("pl"));
  ok(nil?.text && nil.text.includes(PL["ITAC.ui.news.noDamage"]) && !nil.text.includes(PL["ITAC.stunt.doubleDamage"]), `U188: a hit that dealt nothing says "no damage" and no Double Damage (${JSON.stringify(nil?.text)})`);
  const real = M.newsData(vw({ kind: "action", actor: "M", action: "shoot", result: "hit", rows: [{ target: "O", hit: true, taken: 4, stunts: ["doubleDamage"] }] }), {}, fx, tr("pl"));
  ok(real?.text && real.text.includes(PL["ITAC.stunt.doubleDamage"]), `U188: ... a hit that did damage still names its Double Damage (${JSON.stringify(real?.text)})`);
  ok(/to: I\.data\.mv\.at\.slice\(0, 80\)/.test(src("./engine-pure.mjs")), "U188: the engine's news of a move or drive keeps where it ended");
}

/* ================================================================== U190: who a hazard on a zone is offered against */
{
  const vw = { statuses: { D: [{ id: "dead" }], K: [{ id: "unconscious" }], B: [{ id: "broken" }], NB: [{ id: "broken" }] } };
  const fit = soft(M, "hazardFit");
  eq(["A", "D", "K", "B", "NB"].map((id) => fit(vw, id, { health: id === "A" ? 5 : 0 }, id === "NB")), [true, false, true, true, false], "U190: the dead and an NPC out of the fight are left out; a broken or unconscious hero stays [B2708]");
  ok(/\.filter\(\(id\) => hazardFit\(facts\.view, id/.test(src("./ui/model-pure.mjs")), "U190: the form's zones list and target only those");
}

/* ================================================================== U191: the waiting clock of a held card starts when it shows */
{
  const hs = soft(NP, "heldShown"), ss = soft(NP, "shownSince");
  let m = hs({}, ["c1"], ["c0"], 1000);
  eq(m, { c1: null }, "U191: a card held while the dice roll is tracked; one never held is not");
  m = hs(m, [], ["c0", "c1"], 4000);
  eq(m, { c1: 4000 }, "U191: when it shows, it is shown from then");
  m = hs(m, [], ["c0", "c1"], 9000);
  eq(m, { c1: 4000 }, "U191: ... and keeps that time");
  eq(ss([{ since: 500, ids: ["c1"] }, { since: 500, ids: ["c0", "c1"] }, { since: 500 }], m), [{ since: 4000, ids: ["c1"] }, { since: 500, ids: ["c0", "c1"] }, { since: 500 }], "U191: the row of a held card counts from when it showed; a row with a piece never held keeps the asked time");
  eq(hs(m, [], [], 9500), {}, "U191: a card gone is forgotten");
  ok(/heldSeen = NewsP\.heldShown\(/.test(src("./ui/main.mjs")) && /NewsP\.shownSince\(deskD\.waiting, heldSeen\)/.test(src("./ui/main.mjs")), "U191: ui/main.mjs feeds the desk's waiting strip through it");
}

done("check-fxr");
