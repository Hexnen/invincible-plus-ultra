// node scripts/tactics/check-u20.mjs -- ledger rows U88, U97, U89.
//   A. WHERE A TOOLTIP OPENS (ui/tip-pure.mjs): outside the block its owner stands in, never on it; over the block first, beside it when
//      another card or the panel stands there or the window ends, under it last; the bar's tooltips only over the bar; a tight side
//      takes a narrower tooltip; a block as large as the window gets the place that covers least of it
//   B. the drawing (source pins): the rule is wired for the pointer and the keyboard, the dock's blocks are the ones the rule knows,
//      the armed action's panel stands on the bar with the hint and the table's line over it (U97)
//   C. U89: a way of moving or a door that cannot be taken says why AND what to do in its tooltip and its aria-label, the row carries
//      neither sentence, and a click still opens the question to the GM
import { readFileSync } from "node:fs";
import { Table, ok, eq, done } from "./testkit.mjs";
import * as V from "./view-pure.mjs";
import * as D from "./desk-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as UI from "./ui/model-pure.mjs";
import { placeTip, shown, overlap, orderFor, GAP, PAD, NARROW, ORDER } from "./ui/tip-pure.mjs";
import { tipHtml, tipText } from "./ui/dom.mjs";
import { EN, PL, t as T0 } from "./lang.mjs";

globalThis.game = { ...(globalThis.game ?? {}), i18n: { lang: "en" } };
const t = (key, params, fallback) => T0(key, params, fallback);
const R = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h });
const boxOf = (p) => R(p.left, p.top, p.w, p.h);

/* ------------------------------------------------------------------ A. the rule */
{
  /* the windows the surfaces are judged at, and the interface sizes: a block grows with the size, the tooltip does not */
  const WINS = [{ w: 1366, h: 768 }, { w: 1600, h: 900 }, { w: 1024, h: 700 }], SIZES = [0.8, 1, 1.4], tip = { w: 290, h: 132 };
  let n = 0;
  for (const win of WINS) for (const k of SIZES) {
    /* a question card over the panel over the bar, centred at the bottom edge, as the dock stacks them */
    const cw = Math.min(600 * k, win.w - 24), ch = 190 * k, pw = 380 * k, ph = 96 * k, bw = Math.min(560 * k, win.w - 24), bh = 57 * k;
    const bar = R((win.w - bw) / 2, win.h - 6 - bh, bw, bh), panel = R((win.w - pw) / 2, bar.top - 6 - ph, pw, ph), card = R((win.w - cw) / 2, panel.top - 40 * k - ch, cw, ch);
    /* every answer of the card, row by row: the tooltip is never on the card, whichever answer it belongs to (U88) */
    for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) {
      const owner = R(card.left + 10 + col * (cw - 20) / 4, card.top + 60 * k + row * 38 * k, (cw - 20) / 4 - 8, 32 * k);
      const p = placeTip({ owner, block: card, size: tip, win, avoid: [panel], order: orderFor("block") });
      n++;
      if (overlap(boxOf(p), card) || overlap(boxOf(p), panel) || p.left < PAD || p.top < PAD || p.left + p.w > win.w - PAD || p.top + p.h > win.h - PAD) ok(false, `A: an answer's tooltip left its card alone (${win.w}x${win.h}, size ${k}, row ${row}, col ${col}): ${JSON.stringify(p)}`);
    }
    /* the controls of the panel's foot: never on the panel's own head (U97), and not on the card over it while a side is free */
    for (const x of [0.08, 0.5, 0.92]) {
      const owner = R(panel.left + x * (pw - 40), panel.bottom - 40 * k, 36, 32 * k);
      const p = placeTip({ owner, block: panel, size: tip, win, avoid: [card], order: orderFor("block") });
      n++;
      if (overlap(boxOf(p), panel)) ok(false, `A: a foot control's tooltip left its panel alone (${win.w}x${win.h}, size ${k}): ${JSON.stringify(p)}`);
      if (p.free && overlap(boxOf(p), card)) ok(false, `A: "free" means not on another card (${win.w}x${win.h}, size ${k})`);
    }
    /* the bar: right over the bar, whichever row of it the owner is in */
    for (const y of [bar.top + 4, bar.bottom - 30]) {
      const p = placeTip({ owner: R(bar.left + 200, y, 35, 26), block: bar, size: tip, win, avoid: [card, panel], order: orderFor("bar") });
      n++;
      if (p.side !== "up" || p.top + p.h !== Math.round(bar.top - GAP) || overlap(boxOf(p), bar)) ok(false, `A: a bar tooltip stands right over the bar (${win.w}x${win.h}, size ${k}): ${JSON.stringify(p)}`);
    }
  }
  ok(n === WINS.length * SIZES.length * (12 + 3 + 2), `A: ${n} placements over three windows and three interface sizes kept the block clear`);

  const win = { w: 1600, h: 900 }, card = R(500, 380, 600, 190), owner = R(520, 500, 160, 32), tip1 = { w: 290, h: 132 };
  let p = placeTip({ owner, block: card, size: tip1, win });
  eq([p.side, p.top, p.left, p.free], ["up", 380 - GAP - 132, Math.round(520 + 80 - 145), true], "A: first choice: over the block, centred on the owner's column");
  p = placeTip({ owner, block: card, size: tip1, win, avoid: [R(400, 200, 800, 170)] });
  eq([p.side, p.left, p.top], ["left", 500 - GAP - 290, Math.round(516 - 66)], "A: another card over the block: beside the block at the owner's height, on the side the owner is nearer to");
  p = placeTip({ owner: R(900, 500, 160, 32), block: card, size: tip1, win, avoid: [R(400, 200, 800, 170)] });
  eq([p.side, p.left], ["right", 1100 + GAP], "A: ... the right side for an owner in the right half");
  p = placeTip({ owner, block: R(500, 60, 600, 510), size: tip1, win });
  eq(p.side, "left", "A: no room over a block that reaches the top of the window: beside it");
  /* the desk: a column at the right edge, its tooltips open on the map side whichever half the owner is in */
  const desk = R(1600 - 348 - 60, 11, 348, 700);
  for (const ox of [desk.left + 10, desk.right - 60]) { p = placeTip({ owner: R(ox, 300, 50, 30), block: desk, size: tip1, win, order: ["side", "up", "down"] }); eq([p.side, p.left + p.w <= desk.left - GAP + 1, overlap(boxOf(p), desk)], ["left", true, 0], "A: the desk's tooltips open beside the column, over the map"); }
  /* a side with too little room takes a narrower tooltip, measured again at that width */
  const asked = [], size = (maxW) => { asked.push(maxW); return maxW ? { w: maxW, h: Math.ceil(132 * 290 / maxW) } : tip1; };
  p = placeTip({ owner: R(300, 400, 100, 30), block: R(250, 40, 1100, 600), size, win, order: ["side"] });
  eq([p.side, p.maxW, p.w, overlap(boxOf(p), R(250, 40, 1100, 600))], ["left", 250 - GAP - PAD, 250 - GAP - PAD, 0], "A: a tight side: the tooltip is narrowed to the room and stays off the block");
  ok(asked.includes(null) && asked.includes(250 - GAP - PAD), "A: ... and it is measured again at the narrower width");
  p = placeTip({ owner: R(300, 400, 100, 30), block: R(150, 40, 1300, 600), size, win, order: ["side"] });
  ok(p.maxW === null || p.maxW >= NARROW, "A: never narrower than the floor");
  /* a block as large as the window: the place that covers least of it, inside the window */
  p = placeTip({ owner: R(700, 500, 100, 30), block: R(20, 20, 1560, 860), size: tip1, win });
  ok(p.left >= PAD && p.top >= PAD && p.left + p.w <= win.w - PAD && p.top + p.h <= win.h - PAD && p.free === false, "A: nothing fits outside: the tooltip is pulled into the window and says it is not free");
  /* nothing free of the other cards: the place that covers least of them */
  p = placeTip({ owner, block: card, size: tip1, win, avoid: [R(0, 0, 1600, 372), R(0, 380, 492, 520)], order: ["up", "left"] });
  eq(p.side, "up", "A: every place lies on something: the one that covers least");
  eq(shown(R(100, 100, 200, 300), R(0, 180, 1000, 400)), R(100, 180, 200, 220), "A: a card scrolled half out of its box counts by what shows of it");
  eq([ORDER, orderFor("bar"), orderFor("block")], [["up", "side", "down"], ["up"], ["up", "side", "down"]], "A: the order of places: up, side, down; the bar only up");
}

/* ------------------------------------------------------------------ B. the drawing */
{
  const src = (f) => readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const tip = src("./ui/tip.mjs"), main = src("./ui/main.mjs"), dock = src("./ui/dock.mjs"), dom = src("./ui/dom.mjs");
  ok(/tm\._setAnchor = function \(direction\)/.test(tip) && /if \(anchor\(this\)\) return;/.test(tip) && /return own\.call\(this, direction\)/.test(tip), "B: Foundry's own placement is wrapped once: ours for the dock and the desk, Foundry's for everything else");
  ok(/typeof tm\._setAnchor !== "function"\) return/.test(tip) && /tooltipDirection: "UP"/.test(dock), "B: without that method nothing is wrapped and the dock's old direction still holds");
  ok(/Tip\.start\(game\.tooltip\)/.test(main) && /tipShow = \(el\) => \{ try \{ game\.tooltip\?\.activate\(el\)/.test(main), "B: the keyboard's tooltip goes through the same manager, so through the same rule");
  const blocks = /const DOCK_BLOCKS = "([^"]+)"/.exec(tip)?.[1].split(", ") ?? [];
  eq(blocks, [".ita-ask", ".itd-panel", ".itd-bar", ".itd-wait", ".itd-hint1"], "B: the blocks of the dock");
  ok(/h\(`article\.ita-ask/.test(dom) && /h\("section\.itd-panel"/.test(dock) && /h\("div\.itd-bar"/.test(dock) && /h\("div\.itd-wait"/.test(dock) && /h\("div\.itd-hint1"/.test(dock), "B: ... are the ones the dock draws");
  ok(/KEEP_OFF = `\$\{DOCK\} \.ita-ask, \$\{DOCK\} \.itd-panel`/.test(tip) && /b\.classList\.contains\("itd-bar"\) \? "bar" : "block"/.test(tip), "B: a tooltip keeps off the other cards and the panel; the bar's own stand over the bar");
  ok(/el\.closest\("\.igd"\)/.test(tip) && /order: \["side", "up", "down"\]/.test(tip), "B: the desk is one block: its tooltips open beside the column");
  /* U97: the stack, bottom up: bar, panel, hint, the table's line, the questions */
  const draw = dock.slice(dock.indexOf("swap(stack, ["), dock.indexOf("/* U41: the answer the keyboard chose"));
  const at = (re) => draw.search(re), order = [at(/h\("div\.itd-asks"/), at(/h\("div\.itd-wait"/), at(/h\("div\.itd-hint1"/), at(/d\.show \? panel\(d\.panel\) : null/), at(/d\.show \? bar\(d\) : null/)];
  ok(order.every((x) => x >= 0) && order.every((x, i) => i === 0 || x > order[i - 1]), "B (U97): the armed action's panel stands right on the bar; the hint, the table's line and the questions stand over it");
  ok(/hint\?\.dataset\.at && !stack\.querySelector\(":scope > \.itd-panel"\)/.test(dock) && /else if \(hint\) delete hint\.dataset\.tick/.test(dock), "B (U97): a hint that no longer stands on the bar drops its tick (it would point at the panel)");
}

/* ------------------------------------------------------------------ C. U89: the rows of the move / door panel */
{
  const meta = (T) => ({ hidden: [], npc: Object.values(T.c).filter((c) => c.npc).map((c) => c.id) });
  const viewOf = (T, uid, owns) => V.viewFor(T.state, { id: uid, staff: false, owns }, meta(T));
  const ctx = (T) => ({ c: (id) => T.c[id] ?? null, online: () => true, P1 });
  const T = new Table(); T.hero("H1", "p1", { name: "Ada" }).npc("N1", { name: "Thug", health: 6 }); T.order(["H1", "N1"]).turn("H1");
  const doors = [{ to: "z1|z2", zone: "z2", state: "closed", armor: 1, actions: { openDoor: null, breachDoor: "doorState", unseal: "doorState" } },
    { to: "z1|z3", zone: "z3", state: "locked", armor: 3, actions: { openDoor: "doorState", breachDoor: "tooWeak", unseal: "doorState" } },
    { to: "z1|z4", zone: "z4", state: "open", armor: 1, actions: { openDoor: "doorState", breachDoor: "doorState", unseal: "doorState" } }];
  const facts = (view, staff) => ({ view, me: "p1", staff, c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc, img: null } : null), attrs: () => null, userName: (u) => u, weapons: () => [], doors: () => doors, zone: (spot) => ({ id: String(spot).replace(/\D/g, ""), title: null }) });
  const panel = (own, staff = false) => { const view = viewOf(T, "p1", ["H1"]); return UI.dockData(D.playerModel(view, { id: "p1", owns: ["H1"] }, ctx(T)), own, facts(view, staff), t).panel; };

  let p = panel({ armed: "openDoor" });
  eq(p?.kind, "door", "C: the door panel");
  const [free, locked, open] = p.rows;
  eq([free.disabled, free.why, !!free.req], [null, null, true], "C: a door that can be opened: no reason, a request");
  eq(locked.why, { text: EN["ITAC.why.doorState.locked"], fix: EN["ITAC.fix.doorState.locked"] }, "C: a locked door under Open: why, and what to do with such a door");
  eq(open.why, { text: EN["ITAC.why.doorState.open"], fix: EN["ITAC.fix.doorState.open"] }, "C: an open door under Open: why, and what to do");
  ok(typeof locked.disabled === "string" && locked.req === null && locked.asking === false, "C: the refused row keeps its reason for the question's line and asks nothing by itself");
  ok(locked.notes.every((x) => x !== locked.why.text && x !== locked.why.fix && x !== locked.disabled) && !locked.label.includes(locked.why.text), "C: neither sentence is among what the row shows (its name, its state, its Armor)");
  eq(free.notes.length, locked.notes.length, "C: a refused row shows as many things as one that can be taken: it keeps its size");
  /* the tooltip and the aria-label the dock builds from the row (dock.mjs wayRow) */
  const html = tipHtml({ why: locked.why }), say = [locked.label, ...locked.notes, locked.disabled, locked.why?.fix].filter(Boolean).join(", ");
  ok(html.includes(`<p class="ita-tt-no">${EN["ITAC.why.doorState.locked"]}</p>`) && html.includes(`<p class="ita-tt-fix">${EN["ITAC.fix.doorState.locked"]}</p>`), "C: the tooltip: the reason, then the remedy");
  ok(say.includes(locked.disabled) && say.includes(EN["ITAC.fix.doorState.locked"]) && tipText({ why: locked.why }).includes(EN["ITAC.fix.doorState.locked"]), "C: the screen reader's label ends with the reason and the remedy");
  /* a reason with no remedy of its own: the remedy is what a click on the row does */
  p = panel({ armed: "breachDoor" });
  eq(p.rows[1].why.fix, EN["ITAC.fix.ask"], "C: too weak for the door: the remedy is the question to the GM a click opens");
  eq(panel({ armed: "breachDoor" }, true).rows[1].why.fix, EN["ITAC.fix.gm"], "C: ... for the GM: allowing it anyway");
  /* a click: the row is asked about, the question to the GM stands under the list with the reason as a whole sentence */
  p = panel({ armed: "openDoor", ask: "z1|z3" });
  eq([p.rows[1].asking, p.ask?.reason, typeof p.ask?.text, !!p.ask?.submit], [true, EN["ITAC.why.doorState.locked"], "string", true], "C: a click on the refused row still opens the question to the GM, which names the reason once, as a sentence");
  ok(!/\.\.$/.test(p.ask.reason) && !/: [A-Z]/.test(p.ask.reason), "C: ... no sentence inside a sentence");
  p = panel({ armed: "openDoor", ask: "z1|z3", why: "I have the key" });
  ok(!!p.ask.submit.req && p.ask.submit.disabled === null, "C: with words the question can be sent");
  const dock = readFileSync(new URL("./ui/dock.mjs", import.meta.url), "utf8"), css = readFileSync(new URL("../../styles/tactics-ui.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  ok(/tip: r\.disabled \? \{ why: r\.why \?\? \{ text: r\.disabled \} \} : null/.test(dock) && /\[r\.label, \.\.\.r\.notes, r\.disabled, r\.why\?\.fix\]/.test(dock), "C: the row's tooltip is why + what to do; its aria-label says both");
  ok(/r\.disabled \? set\(\{ ask: r\.asking \? null : r\.id, why: "" \}\)/.test(dock) && /clickWhenDisabled: true, pv: r\.pv/.test(dock), "C: a click on a refused row opens (and closes) the question, as before");
  ok(!/itd-way-why/.test(dock) && !/itd-way-why/.test(css) && /\.itd-way\[aria-disabled="true"\] \{[^}]*border: 2px dashed/.test(css) && /r\.disabled \? icon\("fa-ban"\)/.test(dock), "C: no reason inside the row; a refused row is told apart by its dashed frame and the no-entry sign");
  for (const s of ["open", "breached", "closed", "locked", "sealed"]) for (const k of [`ITAC.why.doorState.${s}`, `ITAC.fix.doorState.${s}`]) ok(typeof EN[k] === "string" && typeof PL[k] === "string" && EN[k] !== PL[k] && /[.]$/.test(EN[k]) && /[.]$/.test(PL[k]), `C: ${k} is a sentence in both languages`);
  /* the ways of a move (the panel without the map's preview): the same two sentences on a way that cannot be taken */
  const model = readFileSync(new URL("./ui/model-pure.mjs", import.meta.url), "utf8");
  ok(/why: disabled \? \(mine \? wayWhy\(t, facts, ref\.reason, ref\.params\) : wayWhy\(t, facts, o\.disabled\)\) : null/.test(model) && /disabled: r\.disabled, why: r\.why, asking:/.test(model), "C: a way of moving that cannot be taken carries why and what to do, down to the row");
}

done("check-u20");
