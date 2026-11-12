/* node scripts/tactics/check-fxx.mjs -- FIXER XX (tree tactics, tag tactics-integrated-63): the fight screen with a popped-out chat.
   Foundry opens the popped-out chat in the middle of the window, as tall as it. At 1366 px FXR (U185) moved the initiative bar into the
   ~190 px left beside it, where it read as a squashed strip, and the chase panel's end card ran under the window. FXX parks the chat in
   the right column while a fight is shown (combat/chat-park.mjs) and makes every fight surface that keeps clear of the sidebar keep clear
   of the parked chat the same way. The rules are pure (combat/chat-park-pure.mjs) and run here; the wiring that only Foundry runs is
   pinned by reading its source. Numbers are the live ones (lane 5, 1366x768 and 1920x1080). */
import { readFileSync } from "node:fs";
import { ok, eq, done } from "./testkit.mjs";
import * as P from "../combat/chat-park-pure.mjs";
import * as L from "./ui/layout-pure.mjs";

const here = new URL(".", import.meta.url);
const src = (p) => readFileSync(new URL(p, here), "utf8");
const R = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });

/* ================================================================== the parking rules */
{
  /* the sidebar's left edge: the collapsed tab strip, the open sidebar, or the window's edge when there is no plausible column */
  eq(P.sideLeft(R(1318, 0, 1366, 768), 1366), 1318, "FXX: the collapsed sidebar's tab strip is the right column's edge");
  eq(P.sideLeft(R(1018, 0, 1366, 768), 1366), 1018, "FXX: the open sidebar is");
  eq(P.sideLeft(null, 1366), 1366, "FXX: no sidebar: the window's edge");
  eq(P.sideLeft(R(0, 0, 1366, 768), 1366), 1366, "FXX: a 'sidebar' wider than half the window is no column");

  /* where the chat parks: right edge PARK_GAP left of the column */
  eq(P.parkSpot(1318, 300), { left: 1012 }, "FXX (1366): the chat parks against the tab strip");
  eq(P.parkSpot(1872, 300), { left: 1566 }, "FXX (1920): ... and at full HD");
  eq(P.parkSpot(200, 300), { left: 0 }, "FXX: never off the window");

  /* where Foundry opens it (live: 533..833 at 1366) is the default; a parked one is parked */
  ok(P.isFoundryDefault(R(533, 0, 833, 768), 1366), "FXX: Foundry's centred popout is recognised (1366)");
  ok(P.isFoundryDefault(R(810, 0, 1110, 1080), 1920), "FXX: ... and at 1920");
  ok(!P.isFoundryDefault(R(200, 40, 500, 700), 1366), "FXX: a dragged chat is not the default");
  ok(P.isParked(R(1012, 0, 1312, 768), 1318, 1366), "FXX: the parked chat stands in the right column");
  ok(P.isParked(R(1000, 0, 1300, 768), 1318, 1366), "FXX: a user nudge of a few px still counts as parked");
  ok(!P.isParked(R(533, 0, 833, 768), 1318, 1366), "FXX: the centred chat is not parked");
  ok(!P.isParked(R(1012, 0, 1312, 0), 1318, 1366), "FXX: a chat with no height (minimised to nothing) is not");

  /* when to park */
  const W = 1366, side = 1318;
  eq(P.parkNow({ fight: false, rect: R(533, 0, 833, 768), W, side, last: null }), null, "FXX: outside a fight the chat stays where Foundry opened it");
  eq(P.parkNow({ fight: true, rect: R(533, 0, 833, 768), W, side, last: null }), { left: 1012 }, "FXX: in a fight Foundry's centred chat parks in the right column");
  eq(P.parkNow({ fight: true, rect: R(200, 40, 500, 700), W, side, last: { left: 1012, top: 0 } }), null, "FXX: a chat the user dragged elsewhere stays there");
  eq(P.parkNow({ fight: true, rect: R(1012, 0, 1312, 768), W, side, last: { left: 1012, top: 0 } }), null, "FXX: a parked chat is not moved again");
  eq(P.parkNow({ fight: true, rect: R(1012, 0, 1312, 1080), W: 1920, side: 1872, last: { left: 1012, top: 0 } }), { left: 1566 }, "FXX: the window grew: the chat we parked follows the column");
  eq(P.parkNow({ fight: true, rect: R(1012, 0, 1312, 768), W, side: 1018, last: { left: 1012, top: 0 } }), { left: 712 }, "FXX: the sidebar opened: the chat we parked moves left of it");
  eq(P.parkNow({ fight: true, rect: null, W, side, last: null }), null, "FXX: no chat, nothing to do");

  /* the right column every fight surface keeps clear of */
  eq(P.rightEdge(1318, R(1012, 0, 1312, 768), 1366), 1012, "FXX: a parked chat is the right column's edge");
  eq(P.rightEdge(1318, R(533, 0, 833, 768), 1366), 1318, "FXX: a chat elsewhere is not (the surfaces' own 'beside' rules handle it)");
  eq(P.rightEdge(1318, null, 1366), 1318, "FXX: no chat: the sidebar");
}

/* ================================================================== the bar beside a chat the user put over the middle */
{
  const bar = src("../combat/bar.mjs");
  const min = Number(/const BESIDE_MIN = (\d+)/.exec(bar)?.[1] ?? 0);
  ok(min >= 280, `FXX: the bar keeps beside a floating chat only where a readable bar fits (BESIDE_MIN ${min} >= 280)`);
  eq(L.besideFloating(330, 984, { left: 533, right: 833 }, min, 10), { lo: 330, hi: 984 }, "FXX (1366, chat dragged back to the middle): no 190 px strip; the bar keeps its room");
  eq(L.besideFloating(330, 1500, { left: 810, right: 1110 }, min, 10), { lo: 330, hi: 800 }, "FXX (1920, chat in the middle): a 470 px side reads as a bar and is taken");
}

/* ================================================================== the wiring (only Foundry runs it) */
{
  const cp = src("../combat/chat-park.mjs"), cm = src("../combat/main.mjs"), bar = src("../combat/bar.mjs"), ban = src("../combat/banner.mjs");
  const ch = src("../challenges/main.mjs"), desk = src("./ui/desk.mjs"), dock = src("./ui/dock.mjs"), tm = src("./ui/main.mjs"), tray = src("../turn/tray.mjs");
  ok(/Hooks\.on\("renderChatLog", \(app\) => \{ if \(app\?\.isPopout\)/.test(cp) && /Hooks\.on\("closeChatLog"/.test(cp) && /Hooks\.on\("collapseSidebar"/.test(cp)
    && /addEventListener\("resize"/.test(cp) && /addEventListener\("ipu:fight-ui"/.test(cp), "FXX: the chat is parked when it pops out, the sidebar or the window changes, or the bar comes up");
  ok(/app\.setPosition\(\{ left: spot\.left \}\)/.test(cp), "FXX: parking moves the window across only (Foundry keeps its top and height)");
  ok(/new MutationObserver\(tell\)/.test(cp) && /attributeFilter: \["style", "class"\]/.test(cp) && /new Event\(MOVED\)/.test(cp), "FXX: every move of the chat window (a drag too) is told as ipu:chat-moved once it settles");
  ok(/ChatPark\.start\(\{ fight: \(\) => Bar\.isShowing\(\) \}\)/.test(cm) && /addEventListener\(ChatPark\.MOVED, onResize\)/.test(cm), "FXX: combat/main.mjs starts the parking (a fight = the initiative bar showing) and places the bar and banner again on a move");
  ok((bar.match(/fightUi\(\)/g) ?? []).length >= 2 && /new Event\("ipu:fight-ui"\)/.test(bar), "FXX: the bar tells when it comes up (mounted or back from leaving)");
  ok(/const rr = W - rightWall\(\)/.test(ban), "FXX: the banner's and the bar's free area end at the right column (sidebar or parked chat)");
  ok(/const rr = window\.innerWidth - rightWall\(\)/.test(ch) && /addEventListener\(CHAT_MOVED, scheduleMeasure\)/.test(ch), "FXX: the challenges keep left of a parked chat and move when it does");
  ok(/--igd-right", `\$\{Math\.max\(0, Math\.round\(W - rightWall\(\)\)\)\}px`/.test(desk), "FXX: the GM desk keeps left of a parked chat");
  ok(/side = ChatPark\.rightEdge\(/.test(dock), "FXX: the dock's frame (line, questions, chase panel's stretch, desk) ends at a parked chat");
  ok(/Math\.min\(r && r\.width > 120[^\n]*parkedLeft\(\)\)/.test(tm) && /addEventListener\(CHAT_MOVED/.test(tm), "FXX: the map's room and the token pan keep left of a parked chat; tactical surfaces are placed again on a move");
  ok(/hi = Math\.min\(hi, parkedLeft\(\) - 12\)/.test(tray), "FXX: the turn tray keeps left of a parked chat");
}

done("check-fxx");
