// node scripts/tactics/check-slots.mjs -- U132 / U134: the fixed places of the surfaces (ui/slots-pure.mjs), "top and bottom", and their wiring.
import { readFileSync } from "node:fs";
import * as SP from "./ui/slots-pure.mjs";
import { EN, PL } from "./lang.mjs";

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log("FAIL", m); } };
const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

/* A. one layout: no switch, no other variant, nothing of them left */
{
  for (const k of ["ITAC.Settings.tacticsSlots.Name", "ITAC.Settings.tacticsSlots.Hint", "ITAC.Slots.off", "ITAC.Slots.a", "ITAC.ui.slots.tabs", "ITAC.ui.slots.ask"]) ok(!(k in EN) && !(k in PL), `A1 ${k} is gone`);
  ok(!/tacticsSlots/.test(read("./main.mjs")) && !/tacticsSlots|slotsMode|getMode/.test(read("./ui/main.mjs")), "A2 the client switch is gone");
  ok(!("modeOf" in SP) && !("tabOf" in SP) && !("TABS" in SP) && !("MODES" in SP), "A3 the pure part knows one layout");
  const all = read("./ui/dock.mjs") + read("./ui/desk.mjs") + read("./ui/main.mjs") + read("./ui/slots.mjs") + read("../../styles/tactics-slots.css") + read("../../styles/tactics-ui.css");
  ok(!/its-window|its-tab|its-ticker|data-slots|ita-slots|itaSlots|placeNow|windowOf|"rail"|\brail\b/.test(all), "A4 nothing of the trial's other variants, the switch or the old column is left");
}

/* B. the frame: the situations of the brief (player / GM, 1600x900 and 1366x768 at 140 %, desk open and folded, 0 / 2 / 8 challenges,
   hints on and off, a popped-out chat over the band) */
const seat = ({ W, H, k, staff, desk, hud, hints = true, sidebar = 48, pop = false }) => {
  const side = W - sidebar, chatTop = H - 70;
  const lo = 130 * (W / 1600), hi = side - 12;
  const barH = (k > 1.2 ? 2 : 1) * 56 * k, bottom = H - 6, top = bottom - barH;
  const deskBox = desk ? { open: true, x0: side - 330 * k } : null;
  return { W, H, k, staff, hints, top0: 70, topCx: W * 0.47, topL: 160, topR: pop ? side - 360 : null, side, chatTop, hud: hud ? { present: true, x0: side - 330 * Math.min(k, 1.2) } : { present: false },
    desk: deskBox, bar: { lo, hi: deskBox && deskBox.x0 - lo >= SP.SIZE.beside * k ? deskBox.x0 - 10 : hi, top, bottom } };
};
const cases = [];
for (const [W, H, k] of [[1600, 900, 1], [1366, 768, 1.4]]) for (const staff of [false, true]) for (const desk of staff ? [true, false] : [false]) for (const hud of [0, 2, 8]) for (const hints of [true, false]) for (const pop of [false, true]) cases.push({ W, H, k, staff, desk, hud, hints, pop });
for (const c of cases) {
  const s = seat(c), f = SP.frame(s), tag = `${c.W}x${c.H}@${c.k} ${c.staff ? "GM" : "player"}${c.desk ? "+desk" : ""} hud${c.hud}${c.hints ? "" : " nohints"}${c.pop ? " +popout" : ""}`;
  const S = f.slots, bar = SP.box(s.bar.lo, s.bar.top, s.bar.hi, s.bar.bottom);
  const own = Object.entries(S).filter(([name]) => name !== "notice");
  /* nothing covers the bar; no two places share a pixel (the hint on a narrow band takes the questions' place by turns: `share`) */
  for (const [name, b] of Object.entries(S)) ok(!SP.meets(b, bar), `B1 ${tag}: ${name} stays off the bar`);
  for (let i = 0; i < own.length; i++) for (let j = i + 1; j < own.length; j++) if (own[i][1].share !== own[j][0] && own[j][1].share !== own[i][0]) ok(!SP.meets(own[i][1], own[j][1]), `B2 ${tag}: ${own[i][0]} and ${own[j][0]} do not overlap`);
  ok(!SP.meets(S.notice, S.line) && (!S.hint || S.hint.share || !SP.meets(S.notice, S.hint)), `B2b ${tag}: the notice keeps off the line and the hint`);
  for (const [name, b] of own) ok(b.x0 >= 0 && b.y0 >= 0 && b.x1 <= c.W && b.y1 <= c.H && b.x1 - b.x0 >= 120, `B3 ${tag}: ${name} inside the window and usable (${JSON.stringify(b)})`);
  /* the places hang from the top, under the initiative bar, centred under its middle when there is room on both sides */
  for (const [name, b] of Object.entries(S)) ok(b.anchor === "top" && b.y0 >= 70, `B4 ${tag}: ${name} hangs under the initiative bar`);
  ok(S.cards.x1 - S.cards.x0 >= SP.SIZE.card * c.k, `B4b ${tag}: a question card fits across its place`);
  if (c.hud && c.staff) ok(f.band.y1 <= 11 + SP.BAND.max && f.band.y1 >= 11 + SP.BAND.min, `B5 ${tag}: the challenges' band has a fixed height (${f.band.y1})`);
  if (f.desk) {
    ok(f.desk.top >= (c.hud ? f.band.y1 : 11), `B6 ${tag}: the desk (open or folded) starts under the challenges' band`);
    ok(f.desk.floor <= f.toast.top - SP.GAP + 0.5, `B7 ${tag}: the desk ends over the toasts' strip`);
    ok(f.desk.floor - f.desk.top >= 160 || !c.desk, `B8 ${tag}: the open desk keeps room (${f.desk.floor - f.desk.top})`);
    ok(f.desk.top + 40 <= s.bar.top, `B8b ${tag}: the desk's top (and its folded tab) stands over the bar`);
    if (f.desk.under) ok(f.desk.floor <= s.bar.top - 10, `B8c ${tag}: where the bar takes the edge under the desk, the desk ends over it`);
  }
  if (c.hud) for (const [name, b] of own) ok(b.x1 <= s.hud.x0, `B10 ${tag}: ${name} keeps out of the challenges' column`);
  if (c.desk) for (const [name, b] of own) ok(b.x1 <= s.desk.x0, `B11 ${tag}: ${name} keeps off the open desk`);
  if (c.pop) for (const [name, b] of Object.entries(S)) ok(b.x1 <= s.topR, `B11b ${tag}: ${name} keeps beside the popped-out chat`);
  ok(f.reserved.length === 2 && f.reserved.every((b) => b.x1 > b.x0 && b.y1 > b.y0) && !SP.meets(f.reserved[0], bar), `B12 ${tag}: the panel's room and the line's row are declared to the map`);
  ok(f.toast.h >= SP.TOAST.min && f.toast.bottom <= c.H, `B13 ${tag}: the toasts' strip`);
  ok(f.panelMax >= 110 && f.panelMax <= Math.round(c.H * SP.PANEL_SHARE) && s.bar.top - f.panelMax >= 70, `B14 ${tag}: the panel keeps to its share and never reaches the top places' anchor`);
}
/* C. the frame does not read content: the same inputs give the same places (no card count, no toast, no hint text goes in) */
{
  const a = SP.frame(seat(cases[0])), b = SP.frame({ ...seat(cases[0]), cards: 5, toasts: 3, hintText: "x".repeat(400) });
  ok(JSON.stringify(a) === JSON.stringify(b), "C1 content does not move a place");
  const wide = SP.frame(seat({ W: 1600, H: 900, k: 1, staff: false, hud: 0 })), narrow = SP.frame(seat({ W: 1366, H: 768, k: 1.4, staff: true, desk: true, hud: 8 }));
  ok(!wide.slots.hint.share && wide.slots.hint.align === "end", "C2 a wide band: the hint at its right end, beside the questions");
  ok(narrow.slots.hint.share === "cards" && narrow.slots.hint.y0 === narrow.slots.cards.y0, "C3 a narrow band: the hint takes the questions' place");
  const g = SP.frame(seat({ W: 1600, H: 900, k: 1, staff: true, desk: true, hud: 8 })), gf = SP.frame(seat({ W: 1600, H: 900, k: 1, staff: true, desk: false, hud: 8 }));
  ok(g.desk.top === gf.desk.top, "C4 the desk's top is the same open and folded (its tab does not sink)");
  const p8 = SP.frame(seat({ W: 1366, H: 768, k: 1.4, staff: false, hud: 8 })), p2 = SP.frame(seat({ W: 1366, H: 768, k: 1.4, staff: false, hud: 2 }));
  ok(JSON.stringify(p8) === JSON.stringify(p2), "C5 eight challenges place nothing differently from two");
  /* a low window with big surfaces and a tall bar under the desk: the GM's band gives way so the open desk keeps its head and rows */
  const low = (desk) => ({ ...seat({ W: 1366, H: 768, k: 1.4, staff: true, desk, hud: 2 }), bar: { lo: 180, hi: 1300, top: 490, bottom: 688 } });
  const lo = SP.frame(low(true)), lf = SP.frame(low(false));
  ok(lo.desk.under && lo.desk.floor - lo.desk.top >= Math.min(SP.SIZE.desk * 1.4, lo.desk.floor - (11 + SP.BAND.min) - SP.GAP), `C6 the open desk keeps room over a tall bar (${lo.desk.floor - lo.desk.top})`);
  ok(lo.band.y1 === lf.band.y1 && lo.desk.top === lf.desk.top && lo.band.y1 >= 11 + SP.BAND.min, "C7 the band gives way the same open and folded (folding moves nothing), never under its least");
  ok(/\.itd-who/.test(read("./ui/dock.mjs")) && /\.its-slot\[data-slot="line"\] \.itd-news \{[^}]*margin-left: auto/.test(read("../../styles/tactics-slots.css")), "C8 the line's two ends: who the table waits for holds the left, the news the right (neither slides)");
}
/* D. the wiring */
{
  const dock = read("./ui/dock.mjs"), main = read("./ui/main.mjs"), desk = read("./ui/desk.mjs"), ch = read("../challenges/main.mjs"), css = read("../../styles/tactics-slots.css"), sp = read("../../styles/sheet-plus.css");
  ok(/kept = null;\s*placeSlots\(rec\);/.test(dock), "D1 one placement");
  ok(/const topCx = tr > tl \? \(tl \+ tr\) \/ 2 : null;/.test(dock) && /tl = Math\.min\(tl, r\.left\); tr = Math\.max\(tr, r\.right\);/.test(dock), "D2 the top places are centred under the whole initiative bar (not under its active tile)");
  ok(/\.icbar-lead/.test(dock), "D3 the bar's round label (U135) is among what hangs from the top");
  ok((dock.match(/rec\.q\(FLOATING\)/g) ?? []).length === 2 && /Lay\.besideFloating\(lo, hi, r\)/.test(dock), "D4 the popped-out chat (U136): the bar keeps beside it, the top band too");
  ok(/right\.map\(\(r\) => r\.left - 10\)/.test(dock), "D5 a bar lifted over the bottom edge keeps left of the chat box's column (the toasts' strip)");
  ok(/if \(!\(d\?\.show \|\| d\?\.prompts\?\.length \|\| d\?\.sum\)\) \{ place\(\); return hide\(\); \}/.test(dock) && /export const relayout = \(\) => \{ if \(root\) place\(\); \};/.test(dock), "D6 a hidden dock still works the frame out (the desk and the challenges read it)");
  ok(/put\("hint", Slots\.frameNow\(\)\?\.slots\?\.hint\?\.share && asks \? null : hint\);/.test(dock), "D7 on a narrow band the hint waits while a question stands");
  ok(/Zones\.uiInset\(`\$\{MOD\}\.bars`, \{ bottom: "#invincible-tactics-dock:not\(\.itd-hidden\) \.its-bar", top: \(\) => Math\.max\(reachTop\("#invincible-combat-bar"\), Dock\.topReach\(\)\) \}\);/.test(main), "D8 the map's free stretch (and its camera) lies between the bar's stack and what hangs from the top");
  ok(/for \(const name of \["line", "cards"\]\)/.test(dock) && /export function topReach\(\)/.test(dock), "D9 the top inset counts the line and the questions while they show");
  ok(/Slots\.frameNow\(\)\?\.reserved/.test(main), "D10 the reserved places are declared to the map");
  ok(/const fr = Slots\.frameNow\(\);\s+if \(!fr\?\.desk\) \{ handlers\.needFrame\?\.\(\); return; \}/.test(desk) && /needFrame: \(\) =>/.test(main), "D11 the desk stands only in the frame's place (until there is one it asks the dock for it)");
  ok(!/getBoundingClientRect|#chat-notifications|ich-list/.test(desk.slice(desk.indexOf("export function place()"), desk.indexOf("/* ---------- pieces"))), "D12 the desk measures nothing that comes and goes");
  ok(/ipu:ich-floor/.test(ch) && /ipu:ich-floor/.test(main), "D13 the challenges' band is told");
  ok(sp.indexOf("tactics-slots.css") > sp.indexOf("tactics-ui.css"), "D14 the places' sheet comes after the dock's");
  ok(/prefers-reduced-motion/.test(css), "D15 reduced motion");
  ok(!/setProperty\("--its-n|setProperty\("--igd-toast/.test(dock + main), "D16 the numbers for the notice and the toasts go through setVar");
  const TP = await import("./ui/tip-pure.mjs");
  ok(JSON.stringify(TP.orderFor("top")) === JSON.stringify(["down", "side"]) && /orderFor\(b\.closest\("\.its-slot\[data-slot\]"\) \? "top" : "dock"\)/.test(read("./ui/tip.mjs")), "D17 a tooltip of what hangs from the top opens under it, never over the initiative bar");
}
console.log(bad ? `FAIL check-slots: ${bad} of ${n} checks failed` : `OK ${n} checks`);
process.exit(bad ? 1 : 0);
