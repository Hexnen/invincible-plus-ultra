// node scripts/tactics/check-u14.mjs -- U85, the panel of the armed action (ledger row U85): one order in every state.
//   A. the model: what is still missing is named (`need`) and, for a target chosen on the map, an empty place in the head says what to
//      do (`slot`); an option's name and what it does are its tooltip; the Resolve price rides with the name
//   B. the keyboard: while a declaration is refused the panel has ONE button (the question to the GM), and Enter is that button
//   C. the drawing (source pins): the head, the refusal line, the foot; no reason written on the surface beside Declare; a way that
//      cannot be taken keeps its size (its reason is the tooltip); the roll stands where the dice and Declare stood
import { readFileSync } from "node:fs";
import { Table, ok, eq, done } from "./testkit.mjs";
import * as V from "./view-pure.mjs";
import * as D from "./desk-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as UI from "./ui/model-pure.mjs";
import * as Keys from "./ui/keys-pure.mjs";
import { EN, PL, t as T0 } from "./lang.mjs";

globalThis.game = { ...(globalThis.game ?? {}), i18n: { lang: "en" } };
const t = (key, params, fallback) => T0(key, params, fallback);
const meta = (T) => ({ hidden: Object.values(T.c).filter((c) => c.hidden).map((c) => c.id), npc: Object.values(T.c).filter((c) => c.npc).map((c) => c.id) });
const viewOf = (T, uid, owns) => V.viewFor(T.state, { id: uid, staff: false, owns }, meta(T));
const ctx = (T) => ({ c: (id) => T.c[id] ?? null, online: () => true, P1 });

/* ------------------------------------------------------------------ A / B. the model and the keys */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Ada" }).hero("H2", "p2", { name: "Rex" }).npc("N1", { name: "Thug", health: 6 }).npc("N3", { name: "Far", health: 6 });
  T.c.N3.zone = "z2"; T.order(["H1", "N1", "H2", "N3"]).turn("H1");
  const reach = {}, ask = async (cid, decl, ids) => { reach[`${cid}|${JSON.stringify(decl)}`] = (await T.req("p1", { op: "preview", actor: cid, decl, of: ids })).preview?.per ?? null; };
  const facts = (view, more = {}) => ({ view, me: "p1", staff: false, c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc, img: null } : null), attrs: (id) => (!T.c[id]?.npc ? T.c[id]?.attrs ?? null : null), userName: (u) => u, weapons: () => [],
    preview: (cid, decl) => T.preview("p1", cid, decl), board: true, onMap: () => true, reach: (cid, decl) => reach[`${cid}|${JSON.stringify(decl)}`] ?? null, ...more });
  const dock = (own, more) => { const view = viewOf(T, "p1", ["H1"]); return UI.dockData(D.playerModel(view, { id: "p1", owns: ["H1"] }, ctx(T)), own, facts(view, more), t); };

  let d = dock({ armed: "slugfest" }), p = d.panel;
  eq([p.kind, p.need, p.slot?.label, !!p.slot?.tip, p.aim], ["declare", "target", EN["ITAC.ui.slot.pick"], true, []], "A: no target yet: the head has an empty place that says what to do, and the panel names what is missing");
  eq([p.submit.req, p.submit.disabled], [null, EN["ITAC.ui.need.target"]], "A: Declare is not ready and its reason is there for the tooltip");
  eq([p.unit, p.stress, typeof p.cost], ["full", 0, "string"], "A: the speed and the Resolve price ride with the name; the price in words is kept for the tooltip");
  const wreck = p.opts.find((o) => o.id === "wreck");
  ok(wreck && wreck.tip?.title === EN["ITAC.ui.arm.wreck"] && wreck.tip.lines[0] === EN["ITAC.ui.arm.wreck.tip"] && wreck.on === false, "A: an option is a switch whose tooltip is its name and what it does");
  eq(Keys.plan(d, {}, { key: "Enter" }), null, "B: Enter does nothing while the target is missing");

  await ask("H1", { action: "slugfest" }, p.targets.map((x) => x.id));
  d = dock({ armed: "slugfest", targets: ["N1"] }); p = d.panel;
  eq([p.need, p.slot, p.aim.map((x) => x.name), !!p.submit.req, p.refused], [null, null, ["Thug"], true, null], "A: a target chosen: its place in the head is filled, nothing is missing, Declare is ready");
  eq(Keys.plan(d, {}, { key: "Enter" })?.click, "go", "B: Enter declares");
  ok(dock({ armed: "slugfest", targets: ["N1"], opts: { wreck: true } }).panel.opts.find((o) => o.id === "wreck").on === true, "A: the switched-on option says so");

  /* a refusal: one button, the question to the GM */
  d = dock({ armed: "slugfest", targets: ["N3"] }); p = d.panel;
  eq([!!p.refused, p.submit.req, p.refused.submit.req, p.refused.submit.disabled], [true, null, null, EN["ITAC.ui.exception.needText"]], "A: a refused declaration: the question to the GM waits for its words");
  eq(Keys.plan(d, {}, { key: "Enter" }), null, "B: Enter sends nothing before the words are written");
  d = dock({ armed: "slugfest", targets: ["N3"], why: "I jump" });
  eq(Keys.plan(d, {}, { key: "Enter" })?.click, "go.itd-go-ask", "B: Enter is the question to the GM");
  /* the executor's own refusal of a declaration that looked fine: Declare would only be refused again, so the one button is the question */
  d = dock({ armed: "slugfest", targets: ["N1"], refused: { action: "slugfest", key: "N1", reason: "rules", params: {} }, why: "please" }); p = d.panel;
  ok(!!p.refused && !!p.submit.req, "B: (the model still holds both requests)");
  eq(Keys.plan(d, {}, { key: "Enter" })?.click, "go.itd-go-ask", "B: while the refusal stands Enter never presses a button the panel does not draw");
  eq(Keys.plan(dock({ armed: "slugfest", targets: ["N1"], refused: { action: "slugfest", key: "N1", reason: "rules", params: {} } }), {}, { key: "Enter" }), null, "B: ... and sends nothing without the words");

  /* several targets: the place asks for all of them */
  for (const k of ["ITAC.ui.slot.pick", "ITAC.ui.slot.picks", "ITAC.ui.slot.tip"]) ok(typeof EN[k] === "string" && typeof PL[k] === "string" && EN[k] !== PL[k], `A: ${k} is said in both languages`);
}

/* ------------------------------------------------------------------ C. the drawing */
{
  const dock = readFileSync(new URL("./ui/dock.mjs", import.meta.url), "utf8"), css = readFileSync(new URL("../../styles/tactics-ui.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  ok(/const head = \(p, x = true\) => h\("header\.itd-phead", \{\}, what\(p\), aim\(/.test(dock), "C: every kind of the panel has the same head: what, then on whom");
  ok(/itd-tgt-none[^\n]*slot\.tip[^\n]*slot\.label/.test(dock), "C: the empty place of the target says what to do and carries the tooltip");
  ok(/list\.length > 1 \? h\("span\.itd-tgt", \{ tip: x\.name/.test(dock), "C: several targets are pictures, each with its name as the tooltip");
  ok(/ref \? submit\(ref\.submit, "\.itd-go-ask"\) : submit\(p\.submit, "", p\.pv\)/.test(dock), "C: the foot ends with ONE button: Declare, or the question to the GM while refused (the cost preview stays on Declare)");
  ok(!/itd-why/.test(dock) && !/itd-why/.test(css), "C: no reason is written beside Declare (it is the button's tooltip)");
  ok(/tip: s\.disabled \|\| null/.test(dock), "C: why a button cannot be pressed is its tooltip");
  ok(/button\.itd-tog", \{ fk: `op:\$\{o\.id\}`, tip: o\.tip, attrs: \{ "aria-pressed"/.test(dock) && !/itd-chip-opt/.test(dock), "C: an option is a picture switch with a tooltip, the same focus key as before");
  ok(/p\.pool \? h\("div\.itd-pool", \{ tip: p\.pool\.tip \? \{ \.\.\.p\.pool\.tip, title: handlers\.label\?\.\("pool"\) \}/.test(dock), "C: the dice are a number; 'your dice' and where they come from are the tooltip");
  ok(!/itd-way-why/.test(dock) && /tip: r\.disabled \? \{ why: \{ text: r\.disabled \} \} : null/.test(dock), "C (U83): a way that cannot be taken says why in its tooltip and keeps its size");
  ok(/y\.id === "push"\) - \(x\.id === "push"\)/.test(dock), "C: in the action's own panel Push stands before Accept, which stands where Declare stood");
  for (const fk of ["`wp:${x.id}`", "`tk:${k.id}`", "`ch:${x.id}`", "`at:${x.id}`", "`tg:${x.id}`", '"dest"', "`cmd:${c.id}`", "`go${cls}`", '"x"']) ok(dock.includes(`fk: ${fk}`), `C: the control ${fk} keeps its focus key`);
  ok(/\.itd-pfoot \{[^}]*flex-wrap: wrap[^}]*justify-content: flex-end/.test(css) && /\.itd-how \{[^}]*margin-right: auto/.test(css), "C: the foot: how on the left, the dice and the button on the right");
  ok(/\.itd-tgt \.ita-face, \.itd-tgt-hole \{[^}]*width: 30px; height: 30px/.test(css) && !/data-kind="declare"\] \.itd-phead \.itd-tgt \.ita-face/.test(css), "C: the target's picture has one size before the declaration and after it");
  ok(/\.itd-tgt-hole \{[^}]*border: 2px dashed/.test(css), "C: the empty place is a dashed frame (not colour alone)");
  ok(/\.itd-tog\[aria-pressed="true"\] \{[^}]*background: var\(--ita-yellow\)[^}]*box-shadow/.test(css), "C: a switched-on option is filled and raised");
  ok(/\.itd-refusal \{[^}]*border-bottom: 1px dashed/.test(css) && !/itd-refused/.test(css) && !/itd-refused/.test(dock), "C: a refusal is one line under the head");
  ok(/\.itd-panel \.ita-rollbtn\[data-id="push"\] \{[^}]*background: transparent/.test(css), "C: in the panel Accept is the yellow button and Push the hollow one");
  ok(/:is\(\.itd-mini, \.itd-x, \.itd-tog/.test(css), "C: the switches grow for touch with the other small buttons");
}

done("check-u14");
