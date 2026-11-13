/* node scripts/tactics/check-fxs2.mjs -- designer FXS2 (2026-11-13): the usability rows U229..U235 of the 1366x768 / 1920x1080 live fight
   (dev/combat-usability.md), pinned through the real view, chase panel and dock data (testkit Table), the pure camera rule and the sources:
     U229  the GM chase panel at 1366: the four ends always in reach as icon buttons, the panel keeps over the director bar and the hotbar,
           and a panel that would scroll goes tight
     U230  an action armed on the dock frames the target candidates its panel covers (camera-pure.aimRoom + camera.mjs)
     U231  during a chase a player is not told "not your turn, wait for your card"
     U232  the bar's numbers stand at once on a fresh row (no count-up after a reload); the map's progress line keeps over the dock (map repo)
     U233  the chase's two counts are two items, not one sentence
     U234  the stunts card: the stunts on an opponent brought in stand folded to their caption; a compact two-up grid; the challenges'
           band fits their rows so the desk under it is taller; the comic splash keeps off the open desk
     U235  the fight's end card is not part of the top inset (the VRAM meter's spot) */
import { readFileSync } from "node:fs";
import { ok, eq, done, Table } from "./testkit.mjs";
import * as V from "./view-pure.mjs";
import * as D from "./desk-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./ui/model-pure.mjs";
import * as CP from "./ui/chase-pure.mjs";
import * as CamP from "./ui/camera-pure.mjs";
import * as SP from "./ui/slots-pure.mjs";
import * as FB from "./ui/feedback-pure.mjs";
import { tIn, EN, PL } from "./lang.mjs";

const here = new URL(".", import.meta.url);
const src = (p) => readFileSync(new URL(p, here), "utf8");
const tr = (l) => (k, p = {}, f) => tIn(l, k, p, f);
const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const hiddenOf = (T) => Object.keys(T.c).filter((id) => T.c[id].hidden);
const npcOf = (T) => Object.keys(T.c).filter((id) => T.c[id].npc);
const view = (T, me, owns) => (me === "gm" ? T.state : V.viewFor(T.state, { id: me, staff: false, owns }, { hidden: hiddenOf(T), npc: npcOf(T) }));
const facts = (T, v, me) => ({ view: v, staff: me === "gm", me, whole: me === "gm" ? (id) => T.c[id] ?? null : undefined,
  c: (id) => (T.c[id] && (me === "gm" || !T.c[id].hidden) ? { name: T.c[id].name ?? id, npc: !!T.c[id].npc, kind: T.c[id].kind ?? null, img: null, way: CP.wayOf(T.c[id]) } : null),
  attrs: (id) => T.c[id]?.attrs ?? null, userName: (u) => `User ${u}`, online: () => true });
const ctx = (T) => ({ c: (id) => T.c[id] ?? null, online: () => true, P1, kit: (id) => T.c[id]?.kit ?? null });

async function chaseTable(distance = 2) {
  const T = new Table();
  T.hero("H1", "p1", { name: "Kid" }).hero("H2", "p2", { name: "Omni" });
  T.npc("N1", { name: "Doc" }).npc("N2", { name: "Mauler" });
  T.order(["H1", "N1", "H2", "N2"]).turn("H1");
  eq(code(await T.gm({ op: "chaseStart", prey: ["N1", "N2"], pursuer: ["H1", "H2"], distance })), "ok", "table: the chase starts");
  return T;
}

/* ================================================================== U231: no "not your turn" in a chase */
{
  for (const [l, L] of [["en", EN], ["pl", PL]]) {
    for (const k of ["ITAC.why.chase.notYourTurn", "ITAC.fix.chase.notYourTurn", "ITAC.reason.chase.notYourTurn"]) ok(typeof L[k] === "string" && L[k].length > 3, `U231 ${l}: ${k} is worded`);
    ok(!/card|kart/i.test(L["ITAC.why.chase.notYourTurn"] + L["ITAC.fix.chase.notYourTurn"]), `U231 ${l}: the chase words name no initiative card`);
  }
  const seen = [];
  const t0 = (k) => { seen.push(k); return k; };
  const tc = FB.chaseT(t0);
  eq([tc("ITAC.why.notYourTurn"), tc("ITAC.fix.notYourTurn"), tc("ITAC.reason.notYourTurn"), tc("ITAC.ui.end")],
    ["ITAC.why.chase.notYourTurn", "ITAC.fix.chase.notYourTurn", "ITAC.reason.chase.notYourTurn", "ITAC.ui.end"], "U231: chaseT swaps only the not-your-turn words");

  const T = await chaseTable();
  for (const l of ["en", "pl"]) {
    const t = tr(l), v = view(T, "p2", ["H2"]);
    eq(v.kind, "chase", `U231 ${l} premise: the player's view is a chase`);
    const d = M.dockData(D.playerModel(v, { id: "p2", owns: ["H2"] }, ctx(T)), { who: "H2" }, facts(T, v, "p2"), t);
    const s = JSON.stringify(d);
    const L = l === "en" ? EN : PL;
    ok(!s.includes(L["ITAC.why.notYourTurn"]) && !s.includes(L["ITAC.fix.notYourTurn"]), `U231 ${l}: the dock in a chase never says "not your turn / wait for your card"`);
  }
  /* outside a chase the words are the old ones (the swap is chase-only) */
  const F = new Table();
  F.hero("H1", "p1", { name: "Kid" }).hero("H2", "p2", { name: "Omni" }).npc("N1", { name: "Doc" });
  F.order(["H1", "N1", "H2"]).turn("H1");
  const v = view(F, "p2", ["H2"]), d = M.dockData(D.playerModel(v, { id: "p2", owns: ["H2"] }, ctx(F)), { who: "H2" }, facts(F, v, "p2"), tr("en"));
  ok(!JSON.stringify(d).includes(EN["ITAC.why.chase.notYourTurn"]), "U231: in a fight the chase words never show");
  ok(/if \(facts\?\.view\?\.kind === "chase" && facts\.view\.chase\) t = chaseT\(t\);/.test(src("./ui/model-pure.mjs")), "U231: dockData speaks the chase's words in a chase");
}

/* ================================================================== U233: the two counts as two items */
{
  const T = await chaseTable(2);
  for (const l of ["en", "pl"]) {
    const t = tr(l), P = CP.chaseData(view(T, "gm", []), {}, facts(T, view(T, "gm", []), "gm"), t), D0 = P.distance;
    eq(D0.run?.map((x) => x.id), ["catch", "escape"], `U233 ${l}: a running chase has its two counts as items`);
    eq(D0.run.map((x) => x.n), [D0.toCatch, D0.toEscape], `U233 ${l}: each item carries its own number`);
    ok(D0.run.every((x) => typeof x.label === "string" && x.label && !x.label.startsWith("ITAC.")), `U233 ${l}: each item is labelled`);
  }
  const cs = src("./ui/chase.mjs");
  ok(/D\.run\?\.length \? h\("span\.itc-say\.itc-run"/.test(cs) && /h\("span\.itc-run-i"/.test(cs), "U233: the panel draws the counts as separate items");
  ok(/\.itc-run-i/.test(src("../../styles/tactics-chase.css")), "U233: the items have their own style");
}

/* ================================================================== U229: the GM chase panel */
{
  const cs = src("./ui/chase.mjs"), css = src("../../styles/tactics-chase.css");
  ok(/END_ICON = \{ escaped: "fa-person-running", caught: "fa-hand-back-fist", gaveUp: "fa-flag", combat: "fa-swords" \}/.test(cs), "U229: each end of the chase has its icon");
  ok(/h\("div\.itc-gm-row"/.test(cs) && /h\("div\.itc-gm-ends"/.test(cs), "U229: the ends stand in the GM row, outside the folded tools");
  ok(/\["mm-dir-bar", "hotbar"\]/.test(cs), "U229: the panel's floor keeps over the director bar and the hotbar");
  ok(/tight = panel\.scrollHeight > panel\.clientHeight \+ 2/.test(cs), "U229: a panel that would scroll goes tight");
  ok(/container: itc \/ inline-size/.test(css) && /@container itc \(max-width: 660px\)/.test(css), "U229: the narrow panel lays its face-off as a band");
  ok(/\.itc-ib/.test(css) && /prefers-reduced-motion/.test(css), "U229: icon buttons styled, reduced motion kept");
}

/* ================================================================== U230: the candidates the panel covers are framed */
{
  const base = { armed: null, who: "N1", cands: [] };
  eq(CamP.aimRoom(base, { armed: "slugfest", who: "N1", cands: ["H1", "H2", "N1"] }), { focus: "N1", cands: ["H1", "H2"] }, "U230: arming an action with targets asks for room");
  eq(CamP.aimRoom({ armed: "slugfest", who: "N1" }, { armed: "slugfest", who: "N1", cands: ["H1"] }), null, "U230: the same armed action does not ask again");
  eq(CamP.aimRoom(base, { armed: "move", who: "N1", cands: ["H1"] }), null, "U230: Move has its own cue");
  eq(CamP.aimRoom(base, { armed: "slugfest", who: "N1", cands: [] }), null, "U230: nothing to pick, nothing to frame");
  eq(CamP.aimRoom(base, { armed: null, who: "N1", cands: ["H1"] }), null, "U230: nothing armed, nothing to frame");
  const L = CamP.look({ round: 1, init: { curMember: "N1" }, prompts: {}, stack: [], statuses: {}, ledger: {}, members: { N1: {}, H1: {} } }, { who: "N1", armed: "slugfest", cands: ["H1", "ZZ"] });
  ok(Array.isArray(L.cands), "U230: look carries the candidates");
  const cam = src("./ui/camera.mjs");
  ok(/const room = before \? CP\.aimRoom\(before, now\) : null;\s*if \(room\) aimLater\(combat, room\);/.test(cam), "U230: the surface asks the map for room on arming");
  ok(/why: "aimRoom"/.test(cam) && /hand: true/.test(cam), "U230: by the map's frame (least slide), as the user's own hand");
}

/* ================================================================== U234: the stunts card and the desk's room */
{
  const dom = src("./ui/dom.mjs"), css = src("../../styles/tactics-ui.css");
  ok(/const FOLDS = \(g\) => typeof g\.id === "string" && g\.id\.startsWith\("on:"\) && g\.items\.length > 2;/.test(dom), "U234: the stunts on another opponent fold to their caption");
  ok(/h\("details\.ita-optg\.ita-optg-fold"/.test(dom) && /g\.items\.some\(\(o\) => o\.picked\)/.test(dom), "U234: a native disclosure, open when one of its stunts is ticked");
  ok(/\.ita-ask\[data-kind="stunts"\] \.ita-opts \{ display: grid; grid-template-columns: repeat\(auto-fill, minmax\(138px, 1fr\)\)/.test(css), "U234: the stunts lie two-up");
  /* the band fits the challenges' rows on the GM seat, never under its least; the player's seat is as it was */
  const seat = (end, staff = true) => SP.frame({ W: 1366, H: 768, k: 1, staff, hints: false, top0: 90, topCx: 683, topL: 330, side: 1318, chatTop: 700, listEnd: null,
    hud: { present: true, x0: 1000, end }, desk: { open: true, x0: 960 }, bar: { lo: 330, hi: 900, top: 650, bottom: 760 } });
  const whole = seat(null), fit = seat(125), many = seat(260), tiny = seat(40);
  ok(fit.band.y1 < whole.band.y1 && fit.desk.top < whole.desk.top, `U234: two challenges (rows end at 125) give the desk their unused band (${whole.desk.top} -> ${fit.desk.top})`);
  eq(fit.desk.floor, whole.desk.floor, "U234: the desk's floor does not move");
  ok(tiny.band.y1 >= 11 + SP.BAND.min, "U234: the band never ends under its least");
  ok(many.band.y1 <= whole.band.y1, "U234: rows under the band's end leave the band as it is");
  eq(seat(125, false).band.y1, seat(null, false).band.y1, "U234: a player's band is as it was");
  ok(/end: hudEnd/.test(src("./ui/dock.mjs")) && /\.ich-more:not\(\.ich-leaving\)/.test(src("./ui/dock.mjs")), "U234: the dock tells the frame where the rows end only while all of them show");
  ok(/new MutationObserver\(.*relayout\(\).*\.observe\(ichList, \{ childList: true \}\)/.test(src("./ui/main.mjs")), "U234: rows coming and going lay the band out again");
  ok(/#invincible-tactics-desk:not\(\.igd-collapsed\) \.igd/.test(src("../splash/stage.mjs")), "U234: the comic splash keeps off the open desk");
}

/* ================================================================== U232: the bar's numbers on a fresh row */
{
  const bar = src("../combat/bar.mjs");
  ok(/row\.n\.classList\.add\("icbar-now"\);\s*row\.n\.style\.setProperty\("--icbar-n", String\(shownCount\)\);/.test(bar), "U232: a fresh row's number stands at once");
  ok(/\.icbar-num\.icbar-now \{ transition: none; \}/.test(src("../../styles/combat.css")), "U232: with no count-up");
}

/* ================================================================== U235: the fight's end card is not the top inset */
{
  const dk = src("./ui/dock.mjs");
  ok(/name === "cards" && slotEls\.cards\.querySelector\('\.ita-sum\[data-kind="fight"\]'\)/.test(dk), "U235: the end card of the fight does not push the top inset (the VRAM meter's spot) down");
}

done("fxs2");
