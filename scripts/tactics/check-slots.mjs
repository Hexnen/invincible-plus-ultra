// node scripts/tactics/check-slots.mjs -- U132 / U134 (trial): the fixed places of the surfaces (ui/slots-pure.mjs), the switch, the wiring.
import { readFileSync } from "node:fs";
import * as SP from "./ui/slots-pure.mjs";
import { EN, PL } from "./lang.mjs";

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log("FAIL", m); } };
const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

/* A. the switch */
ok(SP.modeOf("A") === "a" && SP.modeOf("x") === "off" && SP.modeOf(null) === "off" && SP.modeOf("c") === "c", "A1 modeOf: a known variant or off");
for (const k of ["ITAC.Settings.tacticsSlots.Name", "ITAC.Settings.tacticsSlots.Hint", "ITAC.Slots.off", "ITAC.Slots.a", "ITAC.Slots.b", "ITAC.Slots.c", "ITAC.ui.slots.tabs", "ITAC.ui.slots.ask", "ITAC.ui.slots.panel", "ITAC.ui.slots.sum", "ITAC.ui.slots.hint", "ITAC.ui.slots.legend"])
  ok(EN[k] && PL[k] && EN[k] !== PL[k], `A2 ${k} in English and in Polish`);
ok(/reg\("tacticsSlots", \{[^}]*scope: "client"[^}]*default: "off"/.test(read("./main.mjs")), "A3 the switch is a client setting, off by default");

/* B. the frame: the situations of the brief (player / GM, 1600x900 and 1366x768 at 140 %, desk open and folded, 0 / 2 / 8 challenges) */
const seat = ({ W, H, k, staff, desk, hud, hints = true, sidebar = 48 }) => {
  const side = W - sidebar, chatTop = H - 70;
  const lo = 130 * (W / 1600), hi = side - 12;
  const barH = (k > 1.2 ? 2 : 1) * 56 * k, bottom = H - 6, top = bottom - barH;
  const deskBox = desk ? { open: true, x0: side - 330 * k, x1: side - 8, w: 322 * k } : null;
  return { W, H, k, staff, hints, top0: 70, side, chatTop, hud: hud ? { present: true, x0: side - 330 * Math.min(k, 1.2), y1: 11 + hud * 124 } : { present: false },
    desk: deskBox, bar: { lo, hi: deskBox && deskBox.x0 - lo >= SP.SIZE.beside * k ? deskBox.x0 - 10 : hi, top, bottom, cx: (lo + hi) / 2 } };
};
const cases = [];
for (const [W, H, k] of [[1600, 900, 1], [1366, 768, 1.4]]) for (const staff of [false, true]) for (const desk of staff ? [true, false] : [false]) for (const hud of [0, 2, 8]) for (const hints of [true, false]) cases.push({ W, H, k, staff, desk, hud, hints });
for (const mode of ["a", "b", "c"]) {
  for (const c of cases) {
    const f = SP.frame({ mode, ...seat(c) }), tag = `${mode} ${c.W}x${c.H}@${c.k} ${c.staff ? "GM" : "player"}${c.desk ? "+desk" : ""} hud${c.hud}${c.hints ? "" : " nohints"}`;
    const S = f.slots, bar = SP.box(f.bar?.lo ?? seat(c).bar.lo, seat(c).bar.top, seat(c).bar.hi, seat(c).bar.bottom);
    const own = Object.entries(S).filter(([k]) => k !== "notice" && k !== "rail");
    /* nothing covers the bar; no two places share a pixel (the rail is the frame of b's three places) */
    for (const [name, b] of own) ok(!SP.meets(b, bar), `B1 ${tag}: ${name} stays off the bar`);
    for (let i = 0; i < own.length; i++) for (let j = i + 1; j < own.length; j++) ok(!SP.meets(own[i][1], own[j][1]), `B2 ${tag}: ${own[i][0]} and ${own[j][0]} do not overlap`);
    for (const [name, b] of own) ok(b.x0 >= 0 && b.y0 >= 0 && b.x1 <= c.W && b.y1 <= c.H && b.x1 - b.x0 >= 120, `B3 ${tag}: ${name} inside the window and usable (${JSON.stringify(b)})`);
    /* the places hanging from the top stay under the initiative bar; the challenges' band and the desk never share the column */
    for (const [name, b] of own) if (b.anchor === "top") ok(b.y0 >= 70, `B4 ${tag}: ${name} under the initiative bar`);
    if (c.hud && (c.desk || mode === "b")) ok(f.band.y1 <= 11 + SP.BAND.max && f.band.y1 >= 11 + SP.BAND.min, `B5 ${tag}: the challenges' band has a fixed height (${f.band.y1})`);
    if (f.desk) {
      ok(f.desk.top >= (c.hud ? f.band.y1 : 11), `B6 ${tag}: the desk starts under the challenges' band`);
      ok(f.desk.floor <= f.toast.top - SP.GAP + 0.5, `B7 ${tag}: the desk ends over the toasts' strip`);
      ok(f.desk.floor - f.desk.top >= 160 || !c.desk, `B8 ${tag}: the open desk keeps room (${f.desk.floor - f.desk.top})`);
      if (c.desk && mode === "b") ok(S.rail.x1 <= seat(c).desk.x0, `B9 ${tag}: the rail stands beside the desk`);
    }
    if (c.hud && mode !== "c") for (const [name, b] of own) if (b.x1 > (seat(c).hud.x0 ?? 1e9)) ok(b.y0 >= f.band.y1, `B10 ${tag}: ${name} keeps out of the challenges' band`);
    if (c.desk) for (const [name, b] of own) ok(b.x1 <= seat(c).desk.x0 || b.y0 >= f.desk.floor, `B11 ${tag}: ${name} keeps off the open desk`);
    ok(f.reserved.length >= 1 && f.reserved.every((b) => b.x1 > b.x0 && b.y1 > b.y0), `B12 ${tag}: the reserved boxes are declared to the map`);
    ok(f.toast.h >= SP.TOAST.min && f.toast.bottom <= c.H, `B13 ${tag}: the toasts' strip`);
  }
}
/* C. the frame does not read content: the same inputs give the same places (no card count, no toast, no hint text goes in) */
{
  const a = SP.frame({ mode: "a", ...seat(cases[0]) }), b = SP.frame({ mode: "a", ...seat(cases[0]), cards: 5, toasts: 3 });
  ok(JSON.stringify(a) === JSON.stringify(b), "C1 content does not move a place");
  const off = SP.frame({ mode: "off", ...seat(cases[0]) });
  ok(!Object.keys(off.slots).length && !off.desk && !off.band, "C2 off: no places, the desk and the challenges as before");
}
/* D. the window of c */
{
  ok(SP.tabOf({ ask: 1, panel: true }, {}) === "ask", "D1 a question first");
  ok(SP.tabOf({ ask: 1, panel: true }, { picked: "panel" }) === "panel", "D2 the user's tab");
  ok(SP.tabOf({ ask: 2, panel: true }, { picked: "panel", fresh: true }) === "ask", "D3 a new question comes forward");
  ok(SP.tabOf({ panel: true, hint: true }, {}) === "panel", "D4 the action before the hint");
  ok(SP.tabOf({ hint: true, legend: true }, { picked: "panel" }) === "hint", "D5 a tab that went: the next by the order");
  ok(SP.tabOf({}, {}) === null, "D6 nothing: no window");
}
/* E. the wiring: off leaves today's code paths; the map is told; the challenges listen */
{
  const dock = read("./ui/dock.mjs"), main = read("./ui/main.mjs"), desk = read("./ui/desk.mjs"), ch = read("../challenges/main.mjs"), css = read("../../styles/tactics-slots.css"), sp = read("../../styles/sheet-plus.css");
  ok(/if \(Slots\.getMode\(\) === "off"\) placeNow\(rec\); else placeSlots\(rec\);/.test(dock), "E1 off: the placement of today");
  ok(/if \(m === "off"\) swap\(stack, \[asksOf\(prompts, !!d\.sum, legendOn\), wait, hint, pnl, barEl\]\);/.test(dock), "E2 off: the column of today, in its order");
  ok(/Zones\.uiInset\(`\$\{MOD\}\.bars`, \{ bottom: "#invincible-tactics-dock", top: "#invincible-combat-bar" \}\);/.test(main) && /Zones\.uiAvoid\(`\$\{MOD\}\.panels`, \["#invincible-tactics-dock", "#invincible-tactics-desk", "#invincible-party", "#invincible-challenges"\]\);/.test(main), "E3 off: the map is told what it was told before");
  ok(/fr\?\.reserved/.test(main) && /its-bar \.itd-bar/.test(main), "E4 on: the bar is the bottom inset, the places are declared");
  ok(/const fr = Slots\.frameNow\(\);\s+if \(fr\?\.desk\)/.test(desk), "E5 the desk reads its part of the frame");
  ok(/ipu:ich-floor/.test(ch) && /ipu:ich-floor/.test(main), "E6 the challenges' band is told");
  ok(/\[data-slots\]/.test(css) && !/^[^/]*#invincible-tactics-dock\s*\{/m.test(css), "E7 the trial's rules apply only with the switch on");
  ok(sp.indexOf("tactics-slots.css") > sp.indexOf("tactics-ui.css"), "E8 the trial's sheet comes after the dock's");
  ok(/prefers-reduced-motion/.test(css), "E9 reduced motion");
  ok(!/setProperty\("--its-/.test(main), "E10 the notice's numbers go through setVar");
}
console.log(bad ? `FAIL check-slots: ${bad} of ${n} checks failed` : `OK ${n} checks`);
process.exit(bad ? 1 : 0);
