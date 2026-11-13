// node scripts/tactics/check-fxp2.mjs -- fixer FXP2 (TOGL-D1, STAT-14): the party column ran over the lower left-menu buttons at 1366x768.
//   The placement counted a scene-controls button only when it started in the upper half of the window; a longer menu (the Plus Ultra star,
//   the map's toggles) ended under the column's header. Now every button counts, and a menu too long for the party below it puts the column
//   to the right of the buttons that reach into its band (scripts/party/place.mjs), clipped at its own left edge so peeking cards never slide
//   under the menu.
import { ok, eqc as eq, done } from "./testkit.mjs";
import { placeColumn, GAP, GAP_X } from "../party/place.mjs";
import { readFileSync } from "node:fs";

const src = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const rect = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t });
/* a menu column: n buttons of 32 + 8 gap from y0 */
const col = (x, y0, n, s = 40) => Array.from({ length: n }, (_, i) => rect(x, y0 + i * s, x + 32, y0 + i * s + 32));
const hit = (at, width, need, menu, H) => {
  const top = Math.max(at.top, at.bottom - need);   // the column is bottom-anchored and as tall as it needs (or as the band)
  return menu.filter((r) => r.left < at.left + width && r.right > at.left && r.top < at.bottom && r.bottom > top).length;
};
const players = rect(16, 700, 215, 755);
const need4 = 34 + 4 * 48 + 3 * 5;   // handle + 4 compact cards (panel.mjs H / G / HANDLE at scale 1)

/* ---- the reported case: 1366x768, layers column of 15 buttons runs to y 608 (past the half) ---- */
{
  const H = 768, W = 300, layers = col(16, 16, 15);
  const at = placeColumn({ H, width: W, menu: layers, low: [players], need: need4 });
  ok(at.top > 0 || at.left > 0, "TOGL-D1: a layers column past the window's half is counted");
  eq(hit(at, W, need4, layers, H), 0, "TOGL-D1: no menu button under the party column (1366x768, long layers column)");
  eq([at.beside, at.left], [true, 48 + GAP_X], "TOGL-D1: too little room under it for 4 compact cards -> the column stands right of the layers column");
  ok(at.bottom === 700 - GAP && at.bottom - at.top >= need4, "TOGL-D1: beside the menu the column keeps its bottom above the players list and room for the whole party");
}
/* ---- the tools column runs low too: step right of both ---- */
{
  const H = 768, W = 300, menu = [...col(16, 16, 15), ...col(56, 16, 14)];
  const at = placeColumn({ H, width: W, menu, low: [players], need: need4 });
  eq(hit(at, W, need4, menu, H), 0, "TOGL-D1: layers and tools both long: no button covered");
  eq(at.left, 88 + GAP_X, "TOGL-D1: ... the column stands right of the tools column");
}
/* ---- a short tools column: still right of it, so switching the menu group (tools 3..14 buttons) never moves the column sideways ---- */
{
  const H = 768, W = 300, layers = col(16, 16, 15);
  const lefts = [3, 5, 9, 12, 14].map((n) => placeColumn({ H, width: W, menu: [...layers, ...col(56, 16, n)], low: [players], need: need4 }));
  eq([...new Set(lefts.map((a) => a.left))], [88 + GAP_X], "TOGL-D1: beside the menu the column stands right of both columns, whatever the open group");
  ok(lefts.every((a, i) => hit(a, W, need4, [...layers, ...col(56, 16, [3, 5, 9, 12, 14][i])], H) === 0), "TOGL-D1: ... and covers no button in any group");
  const only = placeColumn({ H, width: W, menu: layers, low: [players], need: need4 });
  eq(only.left, 48 + GAP_X, "TOGL-D1: with no tools column (a group without tools) right of the layers");
}
/* ---- upper panels: the map's pins panel and a VRAM meter dragged high bound the top beside the menu ---- */
{
  const H = 768, W = 300, menu = [...col(16, 16, 15), ...col(56, 16, 12)], pins = rect(96, 95, 300, 270), vramHigh = rect(96, 280, 300, 330);
  const at = placeColumn({ H, width: W, menu, low: [players, vramHigh], upper: [pins], need: need4 });
  eq([at.left, at.top], [88 + GAP_X, 330 + GAP], "upper panels: the column beside the menu stays under the pins panel and a high VRAM meter");
  const low = placeColumn({ H, width: W, menu: col(16, 16, 6), low: [players, rect(16, 600, 216, 640)], need: 0 });
  eq(low.bottom, 600 - GAP, "a VRAM meter standing low still bounds the bottom (U47)");
}
/* ---- the tools column (the map group's 9 sections + 3 toggles) ending at y 492, room enough under it: stays at the left edge ---- */
{
  const H = 768, W = 300, tools = col(56, 12, 12), menu = [...col(16, 16, 10), ...tools];
  const at = placeColumn({ H, width: W, menu, low: [players], need: 34 + 2 * 48 + 5 });
  eq([at.left, at.top], [0, tools.at(-1).bottom + GAP], "TOGL-D1: the tools column's last button (past the half) sets the top; 2 cards fit under it at the edge");
  eq(hit(at, W, 34 + 2 * 48 + 5, menu, H), 0, "TOGL-D1: ... the director-bar toggle is not covered");
}
/* ---- 1920x1080: the same menu fits above: unchanged placement at the left edge ---- */
{
  const H = 1080, W = 300, menu = [...col(16, 16, 15), ...col(56, 16, 12)], pl = rect(16, 1012, 215, 1067);
  const at = placeColumn({ H, width: W, menu, low: [pl], need: need4 });
  eq([at.left, at.top, at.bottom], [0, 16 + 14 * 40 + 32 + GAP, 1012 - GAP], "1920x1080: room under the menu: the column stays at the edge, top under the last button");
}
/* ---- a short menu: as before (top under the menu, bottom over the players list) ---- */
{
  const H = 768, W = 300, menu = col(16, 16, 6);
  eq(placeColumn({ H, width: W, menu, low: [players], need: need4 }), { left: 0, top: 16 + 5 * 40 + 32 + GAP, bottom: 700 - GAP, beside: false }, "short menu: the old placement");
  eq(placeColumn({ H, width: W, menu: [], low: [], need: 0 }), { left: 0, top: 0, bottom: H - 14, beside: false }, "nothing on screen: full height at the edge");
  eq(placeColumn({ H, width: W, menu: [rect(0, 0, 40, H)], low: [], need: need4 }).left, 0, "a full-height container is not a button");
}
/* ---- the runtime uses it ---- */
{
  const M = src("../party/main.mjs"), P = src("../party/panel.mjs"), C = src("../../styles/party.css");
  ok(/placeColumn\(\{ H, width: x1, menu, low, upper, need: Panel\.minNeed\(\) \}\)/.test(M) && /Panel\.setBounds\(at\.top, at\.bottom, at\.left\)/.test(M), "main.mjs measure places the column through place.mjs");
  ok(!/r\.top < H \* 0\.5/.test(M), "the upper-half filter on menu buttons is gone");
  ok(/export const minNeed = /.test(P) && /--ipt-left/.test(P), "panel: minNeed and the left offset");
  ok(/left: var\(--ipt-left, 0px\)/.test(C) && /clip-path: inset\(-100vh -100vw -100vh 0\)/.test(C), "css: the column stands at --ipt-left and clips at its own left edge");
}
done("check-fxp2");
