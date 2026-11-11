/* node scripts/tactics/check-u13.mjs -- ledger rows U83, U84, U81 of dev/combat-usability.md.
     A. U83  an answer of a question card that cannot be chosen keeps the size of the others: nothing of the reason is written into it;
             why, and what to do about it, are its tooltip and its aria-label (the dock's cards and the desk's cards are one renderer)
     B. U84  no word about the game system, the engine or automation in what a player reads in a tooltip
     C. U81  an inverse of the map that carries `fireLayer` is left exactly as it came (the U72 repair steps aside) */
import { readFileSync } from "node:fs";
import { Table, ok, eq, done } from "./testkit.mjs";
import * as V from "./view-pure.mjs";
import * as ZP from "./zones-pure.mjs";
import * as M from "./ui/model-pure.mjs";
import * as FP from "./ui/feedback-pure.mjs";
import { tipHtml, tipText } from "./ui/dom.mjs";
import { EN, PL, t as T0 } from "./lang.mjs";

globalThis.game = { i18n: { lang: "en" } };
const lang = (l) => { globalThis.game.i18n.lang = l; };
const t = (key, params, fallback) => { if (fallback === undefined && !(key in EN)) ok(false, `missing key ${key}`); return T0(key, params, fallback); };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const mk = () => { const T = new Table(); T.hero("H1", "p1", { name: "Atom Eve" }).hero("H2", "p2", { name: "Rex" }).npc("N1", { name: "Mauler", health: 5, attrs: { fighting: 9, agility: 8 } }); T.order(["H1", "N1", "H2"]).turn("H1"); return T; };
const meta = (T) => ({ hidden: Object.values(T.c).filter((c) => c.hidden).map((c) => c.id), npc: Object.values(T.c).filter((c) => c.npc).map((c) => c.id) });
const viewOf = (T, uid, owns) => V.viewFor(T.state, { id: uid, staff: false, owns }, meta(T));
const facts = (T, view, me, staff = false) => ({ view, me, staff, c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc, img: null } : null), attrs: (id) => T.c[id]?.attrs ?? null, userName: (u) => `user-${u}` });
const STUNT_WHY = ["sharp", "huge", "immune", "emptyZone", "noMovement", "noOtherTarget", "noItem", "chosen", "exclusive"];

/* ---------- A. U83 ---------- */
for (const l of ["en", "pl"]) {
  lang(l);
  const T = mk(), view = viewOf(T, "p1", ["H1"]);
  const so = (stunt, more = {}) => ({ id: `${stunt}@N1`, label: `ITAC.stunt.${stunt}`, data: { stunt, target: "N1" }, req: { op: "answer" }, ...more });
  const stunts = { id: "p", kind: "stunts", about: "H1", to: { combatant: "H1" }, multi: true, min: 0, max: 1, answerReq: (v) => ({ v }), options: [so("doubleDamage"), so("deadlyHit", { disabled: "sharp" })] };
  for (const desk of [false, true]) {
    const a = M.askData(stunts, { t, facts: facts(T, desk ? T.state : view, desk ? "gm" : "p1", desk), own: {}, desk }), on = a.options[0], off = a.options[1], w = `${l} ${desk ? "desk" : "dock"}`;
    eq([off.disabled, off.req, off.tip?.why?.text, off.tip?.why?.fix], [t("ITAC.why.stunt.sharp"), null, t("ITAC.why.stunt.sharp"), t("ITAC.fix.stunt.sharp")], `A1 ${w}: the greyed stunt says why and what to do in its tooltip, and sends nothing`);
    eq([off.tip.lines, off.tip.title, off.tip.cost], [[t("ITAC.ui.stunt.tip.deadlyHit")], null, null], `A2 ${w}: above the reason the tooltip still says what the stunt does; no name (the tile shows it), no price (a stunt has none)`);
    eq([on.disabled, on.tip?.why ?? null, on.tip?.lines?.length], [null, null, 1], `A3 ${w}: a stunt that can be taken has no reason anywhere`);
    ok(!/\{\w+|ITAC\./.test(JSON.stringify(off.tip)), `A4 ${w}: nothing unfilled in the tooltip`);
    const html = tipHtml(off.tip), said = tipText(off.tip);
    ok(/class="ita-tt-why"/.test(html) && /class="ita-tt-no"/.test(html) && /class="ita-tt-fix"/.test(html) && html.indexOf("ita-tt-why") > html.indexOf(off.tip.lines[0].slice(0, 12).replace(/&/g, "&amp;")), `A5 ${w}: drawn as the reason-and-remedy block of U54 / U68, under what the stunt does`);
    ok(said.includes(off.tip.why.text) && said.includes(off.tip.why.fix), `A6 ${w}: a screen reader is told the reason and the remedy`);
  }
  /* an answer that shows its price only as the mark of speed: the tooltip of the greyed one says the price in words, labelled (U68) */
  const react = { id: "r", kind: "reaction", about: "H1", to: { combatant: "H1" }, data: {}, answerReq: (v) => ({ v }), options: [
    { id: "block", label: "ITAC.opt.block", cost: "quick", disabled: "noQuickAction" }, { id: "dodge", label: "ITAC.opt.dodge", cost: "quick", req: { op: "answer" } },
    { id: "block:free", label: "ITAC.opt.block", cost: "none", stress: 1, disabled: "stressedOut" }, { id: "pass", label: "ITAC.opt.pass", req: { op: "answer" } }, { id: "odd", label: "ITAC.opt.pass", disabled: "somethingNew" }] };
  const r = M.askData(react, { t, facts: facts(T, view, "p1"), own: {} }), by = (id) => r.options.find((x) => x.id === id);
  eq([by("block").tip.cost.toLowerCase(), by("block").tip.why], [t("ITAC.ui.tip.cost", { cost: T0("ITAC.cost.quick") }).toLowerCase(), FP.whyOf(t, "noQuickAction", {}, { ask: false })], `A7 ${l}: a greyed reaction: "Costs: quick action", then the reason and the remedy`);
  ok(by("block").tip.cost !== by("block").tip.why.text && /[.!?]$/.test(by("block").tip.why.text), `A8 ${l}: the reason is a sentence, not the words of the price (U68)`);
  eq([by("dodge").tip, by("pass").tip], [null, null], `A9 ${l}: an answer that can be given and has nothing more to say has no tooltip`);
  eq([by("block:free").tip.cost, by("block:free").tip.why.text], [null, t("ITAC.why.stressedOut")], `A10 ${l}: a price the tile writes out in words is not repeated in the tooltip (U51)`);
  eq([typeof by("odd").disabled, by("odd").tip.why.text, by("odd").tip.why.fix], ["string", by("odd").disabled, null], `A11 ${l}: an unknown reason still gets its sentence in the tooltip; a card's answer has no "ask the GM" click`);
  for (const id of STUNT_WHY) {
    const w = FP.whyOf(t, id, {}, { ask: false, ctx: "stunt" });
    ok(w.text === t(`ITAC.why.stunt.${id}`) && w.fix === t(`ITAC.fix.stunt.${id}`) && /[.!?]$/.test(w.text) && /[.!?]$/.test(w.fix), `A12 ${l} ${id}: a stunt's refusal is a sentence with what to do`);
    ok(typeof (l === "en" ? EN : PL)[`ITAC.why.stunt.${id}`] === "string" && typeof (l === "en" ? EN : PL)[`ITAC.fix.stunt.${id}`] === "string", `A13 ${l} ${id}: said in this language`);
  }
}
{ /* the renderer and the stylesheet: nothing of the reason inside the tile; told apart without hovering; reachable by keyboard */
  const dom = read("./ui/dom.mjs"), css = read("../../styles/tactics-ui.css"), opt = dom.slice(dom.indexOf("const opt = (o) =>"), dom.indexOf("/* U23: the stunts stand in their groups"));
  ok(opt.length > 200 && !/ita-opt-why/.test(dom) && !/ita-opt-why/.test(css), "A14: no element of an answer carries the reason any more (dom + stylesheet)");
  ok(!/text: o\.disabled/.test(opt), "A15: the reason's text is not a child of the answer");
  ok(/o\.disabled \? h\("i\.fa-solid\.fa-ban\.ita-opt-no"/.test(opt) && /\.ita-opt-l > \.ita-opt-no \{[^}]*font-size: 11px/.test(css), "A16: a greyed answer carries the no-entry mark after its name, inside the name's own line (no second line)");
  ok(/\.ita-opt\[aria-disabled="true"\] \{[^}]*border: 2px dashed[^}]*cursor: help/.test(css), "A17: dashed frame (shape, not colour alone) and the pointer that says there is more to read");
  ok(/"aria-label": \[o\.label, o\.cost, o\.note, o\.tip\?\.lines\?\.\[0\], o\.disabled, o\.tip\?\.why\?\.fix\]/.test(opt), "A18: the aria-label says name, price, what it does, why not, what to do");
  ok(/h\("button\.ita-opt"/.test(opt) && /disabled: !!o\.disabled, tip: o\.tip \?\? null/.test(opt) && /if \(p\.disabled\) el\.setAttribute\("aria-disabled", "true"\)/.test(dom) && !/el\.disabled\s*=/.test(dom),
    "A19: a greyed answer is a button with aria-disabled (never the disabled attribute): it stays in the Tab order and its tooltip opens on focus");
  for (const f of ["./ui/dock.mjs", "./ui/desk.mjs"]) ok(/addEventListener\("focusin"[^\n]*tipShow/.test(read(f)), `A20 ${f}: the surface opens a tooltip on keyboard focus`);
  ok(!/ita-opt-why|itd-opt-why/.test(read("./ui/desk.mjs") + read("./ui/dock.mjs") + read("./ui/prompts.mjs")), "A21: the desk and the dock draw cards through the one renderer, with no reason line of their own");
}

/* ---------- B. U84 ---------- */
{
  const BAD = /game system|system gry|systemu gry|systemowi gry|\bengine\b|silnik|automat|by hand|ręcznie|the module|moduł|executor|wykonawc/i;
  for (const [name, L] of [["en", EN], ["pl", PL]]) {
    ok(!BAD.test(L["ITAC.ui.rollbar.push.tip"]) && /1/.test(L["ITAC.ui.rollbar.push.tip"]), `B1 ${name}: the Push button's tooltip says what pushing costs, not who counts it ("${L["ITAC.ui.rollbar.push.tip"]}")`);
    /* what a player may read in a tooltip or a hint: every ".tip" / ".hint" text, the first-fight hints, the reasons and remedies, the
       effect lines of the abilities. Left out: Foundry's settings window, the GM's own tools (hazard tool, "always" switch, kit notes
       of the desk's Abilities tab) and a vehicle's engine, which is a thing in the fiction. */
    const GM_ONLY = /^ITAC\.(Settings\.|ui\.hz\.|ui\.always|ui\.kit\.gmWord|kit\.(note|why|state)\.|ui\.vehicle\.|ui\.policy\.|ui\.table\.|ui\.force\.|ui\.karma\.)/;
    const keys = Object.keys(L).filter((k) => !GM_ONLY.test(k) && (/\.tip(\.|$)/.test(k) || /\.hint(\.|$)/i.test(k) || /^ITAC\.(hint|why|fix)\./.test(k) || /^ITAC\.kit\.fx\./.test(k)));
    ok(keys.length > 300, `B2 ${name}: the tooltips and hints a player may read (${keys.length})`);
    const bad = keys.filter((k) => BAD.test(String(L[k])));
    eq(bad, [], `B3 ${name}: none of them talks about the game system, the engine or automation (U67)`);
  }
  lang("en");
  const btn = M.rollButtons({ state: "push", users: ["p1"], messageId: "m1", inst: "i", key: "k", rid: "r" }, { me: "p1", staff: false }, t).find((b) => b.id === "push");
  eq(btn?.tip, EN["ITAC.ui.rollbar.push.tip"], "B4: that sentence is the tooltip of the player's Push button");
}

/* ---------- C. U81 ---------- */
{
  const out = { op: "zone", zone: "z3", patch: { fire: null } };
  const truth = { op: "zone", zone: "z3", patch: { fire: null }, fireLayer: { back: [{ id: "s1", level: 7 }], out: [] } };
  const got = ZP.repaintInverse(out, truth, 7);
  ok(got === truth && got.patch.fire === null, "C1: an inverse that carries the map's own strokes goes back exactly as it came: no fire is put into its patch");
  eq(ZP.repaintInverse(out, { op: "zone", zone: "z3", patch: { fire: null }, fireLayer: { back: [], out: ["s9"] } }, 7).patch.fire, null, "C2: also when the layer part only names strokes to put out");
  eq(ZP.repaintInverse(out, { op: "zone", zone: "z3", patch: { fire: null } }, 7), { op: "zone", zone: "z3", patch: { fire: 7 } }, "C3: a map that hands out no fireLayer (an older one) still gets the U72 repair");
  for (const junk of [null, "x", 3, [1]]) eq(ZP.repaintInverse(out, { op: "zone", zone: "z3", patch: { fire: null }, fireLayer: junk }, 7).patch.fire, 7, `C4: a fireLayer that is no record (${JSON.stringify(junk)}) is not taken for the map's strokes`);
  const lit = { op: "zone", zone: "z3", patch: { fire: 6 } }, back = { op: "zone", zone: "z3", patch: { fire: null }, fireLayer: { back: [], out: ["s2"] } };
  ok(ZP.repaintInverse(lit, back, 0) === back, "C5: the inverse of a fire that was lit passes untouched too");
  const src = read("./zones-adapter.mjs");
  ok(/inverse: ZP\.repaintInverse\(op, r\.inverse \?\? null, painted\)/.test(src) && /if \(e\?\.isInverse \? !op \|\| typeof op !== "object" : !ZP\.validOp\(op\)\)/.test(src), "C6: the adapter journals what repaintInverse answers and hands an inverse back to the map as it was journaled");
}

done("check-u13");
