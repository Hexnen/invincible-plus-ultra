// node scripts/tactics/check-uxa.mjs -- UX wave (U127), package A: WHERE THINGS SIT AND WHAT THEY COVER (UX review 1, 2026-11-12).
//   D126  the chat toasts end where Foundry's toast list ends, the desk ends above them; their strip is a place the map keeps clear of
//   U140  while this user aims, the panels that are not the hand's own step back (dimmed, click-through)
//   U148  the bar keeps its shape: decided by the widest bar its room has held; the resting bar keeps every button in place
//   U150  the sidebar folds once when a fight of ours is begun; the toasts' strip is avoided by the "My view" chip
//   U152  a player's first look at a fight goes to the own unit; the macro bar starts folded
//   U154 / U155  the answer of a card on the desk holds to the desk's bottom edge
//   U160  the map's zone picks show no banner: the armed panel by the hand says what is asked
import { readFileSync } from "node:fs";
import { ok, eq, done } from "./testkit.mjs";
import * as SP from "./ui/slots-pure.mjs";
import * as Lay from "./ui/layout-pure.mjs";
import * as CP from "./ui/camera-pure.mjs";
import { EN, PL } from "./lang.mjs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const dock = read("./ui/dock.mjs"), main = read("./ui/main.mjs"), board = read("./ui/board.mjs"), cam = read("./ui/camera-pure.mjs");
const slotsCss = read("../../styles/tactics-slots.css"), uiCss = read("../../styles/tactics-ui.css");

/* ---- D126: the toasts' strip */
{
  const H = 900;
  /* Foundry's grid ended the toast list 80 px over the chat box: the strip ends there, not at the chat box */
  const s0 = SP.toastStrip({ H, chatTop: 826 }), s1 = SP.toastStrip({ H, chatTop: 826, listEnd: 747 });
  eq([s0.bottom, s1.bottom, s1.top, s1.h], [820, 747, 615, 132], "D126: the strip ends where the toast list really ends when that is higher than the chat box");
  eq(SP.toastStrip({ H, chatTop: 826, listEnd: 860 }).bottom, 820, "D126: a list measured lower than the chat box changes nothing");
  eq(SP.toastStrip({ H, chatTop: 826, listEnd: 100 }).bottom, 820, "D126: a list measured in the upper part (not the floating toasts) is not taken");
  /* the frame: the GM desk ends above the strip, whatever the strip's real end */
  const base = { W: 1600, H, k: 1, staff: true, hints: false, top0: 70, topCx: 700, topL: 160, side: 1552, chatTop: 826, hud: { present: true, x0: 1240 }, desk: { open: true, x0: 1180 },
    bar: { lo: 230, hi: 1170, top: 800, bottom: 894 } };
  for (const listEnd of [null, 747, 700]) {
    const f = SP.frame({ ...base, listEnd, chatX: [1250, 1550] });
    ok(f.desk.floor <= f.toast.top - SP.GAP, `D126: the desk ends above the toasts (list end ${listEnd}): floor ${f.desk.floor}, strip top ${f.toast.top}`);
    eq([f.toast.box.x0, f.toast.box.x1, f.toast.box.y0, f.toast.box.y1], [1250, 1550, f.toast.top, f.toast.bottom], `D126 / U150: the strip's box (list end ${listEnd}) is the chat column over the strip`);
  }
  eq(SP.frame({ ...base }).toast.box, undefined, "D126: no chat column measured: no box");
  ok(/listEnd: list && list\.left > W \* 0\.5 \? list\.bottom : null/.test(dock) && /#chat-notifications \.overflow/.test(dock), "D126: the dock measures where Foundry's toast list ends");
  ok(/body\.ita-tactics #chat-notifications \{ grid-template-rows: 1fr auto; \}/.test(slotsCss), "D126: the toast grid's lower row takes the chat box's own height (the toasts end right over it)");
  ok(/frameNow\(\)\?\.toast\?\.box/.test(main), "D126 / U150: the toasts' strip is one of the boxes the map's chip and menus keep clear of (uiAvoid)");
}

/* ---- U148: the bar keeps its shape */
{
  const memo = new Map();
  eq(Lay.steadyShape(memo, 1000, 900, 500, 32).tight, 0, "U148: a bar that fits with room to spare stays one row");
  eq(Lay.steadyShape(memo, 1000, 980, 500, 32).tight, 1, "U148: a bar within the slack of the room goes over two rows");
  eq(Lay.steadyShape(memo, 1000, 900, 500, 32).tight, 1, "U148: ... and stays so when it is narrower again (no flip back under the pointer)");
  eq(Lay.steadyShape(memo, 1400, 900, 500, 32).tight, 0, "U148: another room (a wider window) is decided afresh");
  eq(Lay.steadyShape(memo, 600, 700, 590, 32).tight, 2, "U148: even the unit and the tail do not share a row: the third form");
  eq(Lay.steadyShape(null, 1000, 900, 500, 0).tight, 0, "U148: no memory: decided by the bar alone");
  ok(/Lay\.steadyShape\(shapes, avail, natural, inner, SLACK \* k\)/.test(dock) && !/if \(natural > avail\) \{ root\.dataset\.tight/.test(dock), "U148: the dock decides its shape through steadyShape");
  /* the resting bar: the same pieces as the bar of a turn, the actions dimmed, End turn inert */
  ok(!/d\.rest \? h\("div\.itd-tail", \{\}, legendBtn\(\)/.test(dock), "U148: the resting bar is no longer the short form (unit + four small buttons)");
  ok(/h\("div\.itd-acts", \{ attrs: d\.rest \? \{ "aria-disabled": "true" \} : \{\} \}/.test(dock), "U148: the resting bar keeps the actions (marked as standing back)");
  ok(/fk: "end", disabled: !!e\.disabled \|\| !!d\.rest/.test(dock), "U148: resting, End turn keeps its place and ends nothing");
  ok(/d\.rest \? h\("button\.itd-mini", \{ fk: "peek"/.test(dock) && /: d\.canRest \? h\("button\.itd-mini", \{ fk: "peek"/.test(dock), "U148: the last small button is the same place resting (open) or not (fold)");
  ok(/#invincible-tactics-dock\.itd-rest \.itd-acts[^{]*\{ opacity: \.42/.test(uiCss) && /itd-rest \.itd-ic\[data-key\]::before \{ content: none; \}/.test(uiCss), "U148: resting, the actions are dimmed and carry no key marks");
}

/* ---- U140: aiming */
{
  const sel = /body\.ita-tactics:is\(\.mm-z-picking, \.itd-picking\) :is\(#invincible-challenges, #invincible-tactics-desk:not\(\.igd-busy\) \.igd, #invincible-tactics-dock \.its-slot\[data-slot="line"\] \.its-in\)( \*)? \{ pointer-events: none !important; \}|body\.ita-tactics:is\(\.mm-z-picking, \.itd-picking\) :is\(#invincible-challenges, #invincible-tactics-desk:not\(\.igd-busy\) \.igd, #invincible-tactics-dock \.its-slot\[data-slot="line"\] \.its-in\),/;
  ok(sel.test(slotsCss), "U140: while aiming, the challenges, a desk with nothing waiting and the line take no pointer");
  ok(/\.its-slot\[data-slot="line"\] \.its-in \{ opacity: \.26;/.test(slotsCss), "U140: ... and stand back (dimmed)");
  ok(!/:is\(\.mm-z-picking, \.itd-picking\)[^{]*data-slot="cards"/.test(slotsCss), "U140: the questions put to this user are never made click-through");
}

/* ---- U150: the sidebar at the fight's start */
{
  ok(/function fightStart\(combat\) \{[\s\S]{0,260}if \(!combat\?\.started \|\| foldedFor === combat\.id\) return;[\s\S]{0,80}foldedFor = combat\.id;[\s\S]{0,80}if \(ui\.sidebar\?\.expanded\) ui\.sidebar\.collapse\(\);/.test(main), "U150: the sidebar folds once per fight, when a begun fight is first seen");
  ok(/fightStart\(combat\);/.test(main), "U150: ... looked at on every redraw of a fight");
}

/* ---- U152: a player who joins */
{
  const now = { round: 2, cur: "N1", known: ["H1", "N1"], asks: {}, mine: ["H1"], staff: false, who: "H1", sel: null, armed: null, targets: [] };
  eq(CP.cues(null, now).map((c) => [c.why, c.focus, c.hand]), [["join", "H1", false]], "U152: a player's first look goes to the own unit");
  eq(CP.cues(null, { ...now, staff: true, mine: ["N1"], who: "N1" }), [], "U152: the GM's first look moves nothing (the GM placed the view)");
  eq(CP.cues(null, { ...now, mine: [], who: null }), [], "U152: a player with no unit in the fight: nothing");
  eq(CP.LEVEL.join, "turn", "U152: the join cue plays at the switch's turn level (the user's switch off: nothing)");
  ok(/st\.dock\.hotbar = false;/.test(main) && !/st\.dock\.hotbar = layout\.hotbar/.test(main), "U152: the macro bar starts folded in every session");
  ok(/why: "join"/.test(cam), "U152: the cue is the camera's own (camera-pure)");
}

/* ---- U154 / U155: the desk's answers */
{
  ok(/#invincible-tactics-desk \.ita-ask > \.ita-submit, #invincible-tactics-desk \.ita-ask:not\(\[data-wide\]\):not\(:has\(> \.ita-submit\)\) > \.ita-opts \{ position: sticky; bottom: 0;/.test(uiCss), "U154 / U155: a card's one button or its short row of answers holds to the desk's bottom edge");
  ok(/\.ita-ask:not\(\[data-wide\]\):not\(:has\(> \.ita-submit\)\) > \.ita-opts \{[^}]*background: var\(--ita-tile\)/.test(uiCss), "U155: ... on a band of the card's own colour");
}

/* ---- U160: one instruction, by the hand */
{
  ok(/Zones\.pickArea\(\{[^\n]*banner: false/.test(board) && /Zones\.pickMove\(\{[^\n]*banner: false/.test(board), "U160: the board's picks of a zone ask the map for no banner");
  ok(/data\.panel\.kind === "move" && data\.panel\.picking && data\.panel\.ways && data\.panel\.bare\) data\.panel = \{ \.\.\.data\.panel, bare: false \}/.test(main), "U160: a move pick gets its panel with the instruction in its head");
  ok(/Board\.areaMode\(data\.panel\)\) data\.panel = \{ \.\.\.data\.panel, pickHint: t\("ITAC\.map\.area\.pick"\) \}/.test(main) && /p\.pickHint \? h\("p\.itd-hint\.itd-pickhint"/.test(dock), "U160: an area attack says what to click in its armed panel");
  ok(EN["ITAC.map.area.pick"] && PL["ITAC.map.area.pick"] && PL["ITAC.map.area.pick"] !== EN["ITAC.map.area.pick"], "U160: the instruction in both languages");
}
done("check-uxa");
