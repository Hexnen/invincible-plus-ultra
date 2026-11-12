/* Tactical combat, the surfaces: THE CHASE PANEL (CHASE, CHASE2; DOM only, the data is ui/chase-pure.mjs chaseData).
   USER 2026-11-12: the chase needs its own beautiful, clear panel, one, in the middle; of three trial looks the user kept "the face-off"
   and asked how it holds up in more complex chases. While a chase runs this panel is where every seat reads it and plays it:
     the face-off   the two sides facing each other, the pursuers left (red), the fleeing right (cyan): the face of whoever rolls for the
                    side with why it is them, the side's roll, and under it every unit of the side in one line each (a vehicle with its
                    driver and passengers and their shots, somebody on foot or in the air, who cannot move and why); between the sides the
                    distance as a big number with the zones to capture and to escape
     the obstacle   one band across, with what it does and its rolls
     the beats      the round in the book's order, one arrow each
     the caption    this seat's decision (a paper caption box, only when this seat has something to do) or who the table waits for (quiet)
     the GM's tools folded under it: the next obstacle, the table, the distance, who joins, the ends; a unit drops out from its own line
   (its buttons are the very requests and roll actions the dock and the desk send). Once over, every seat gets the end card.
   PLACE: the middle of the window, under the line that hangs from the initiative bar (and under a question card standing there), over
   the bar and its armed panel; what does not fit scrolls inside the panel. It folds to one strip with the decision's main button. */

import { h, icon, face, markOf, swap, visibleRect } from "./dom.mjs";
import { frameNow } from "./slots.mjs";

const ID = "invincible-tactics-chase", GAP = 8;
let root = null, panel = null, handlers = {}, last = null, folded = false, gmOpen = false, kept = null, aside = false;

export function configure(x) { handlers = x ?? {}; }
export const el = () => root;
export const isShown = () => !!root && !root.classList.contains("itc-hidden");

function ensure() {
  if (root?.isConnected) return;
  root = h("div.itc-hidden", { attrs: { id: ID, role: "region", "aria-label": "chase" }, data: { tooltipDirection: "UP", tooltipClass: "ita-tip" } });
  panel = h("section.itc-panel");
  root.append(panel);
  root.addEventListener("keydown", (e) => { if (e.key === "Tab") e.stopPropagation(); });      // Foundry's own Tab is "next token"
  root.addEventListener("focusin", (e) => { try { const el = e.target.closest?.("[data-tooltip], [data-tooltip-html]"); if (el?.matches(":focus-visible")) handlers.tipShow?.(el); } catch { /* a courtesy */ } });
  root.addEventListener("focusout", () => { try { handlers.tipHide?.(); } catch { /* a courtesy */ } });
  root.addEventListener("load", () => place(), true);
  document.body.appendChild(root);
}

/* ---------- the shared pieces ---------- */
/** one button of the panel: `act` (a roll, accept or push on this client), `req` (a request), `arm` (arm an action on the dock) */
function btn(b, fk, cls = "") {
  const kind = b.primary && !b.disabled ? "main" : b.id === "push" ? "push" : "plain";
  return h(`button.itc-btn${cls}`, {
    fk, tip: b.disabled && typeof b.disabled === "string" ? b.disabled : b.tip ?? null, disabled: !!b.disabled || (!b.fn && !b.act && !b.req && !b.arm),
    text: b.marks ? null : b.label, data: { kind, id: b.id ?? null }, attrs: b.marks ? { "aria-label": b.label } : {},
    on: { click: () => (b.fn ? b.fn() : b.act ? handlers.roll?.(b.act) : b.req ? handlers.send?.(b.req) : b.arm ? handlers.arm?.(b.arm) : null) },
  }, b.marks ? [markOf(b.marks[0], true), h("span", { text: b.label }), b.marks.slice(1).map((m) => markOf(m, true))] : null);
}
const btns = (list, pre) => (list ?? []).map((b) => btn(b, `${pre}:${b.id}`));
const plate = (text, cls = "") => h(`h3.ita-plate${cls}`, { text });
/** a name that may be long: cut with an ellipsis where its box ends, the whole name in its tooltip */
const nm = (sel, text) => h(sel, { text, tip: text, data: { cut: "1" } });
const BEAT_ICON = { obstacle: "fa-road-barrier", prey: "fa-person-running", pursuer: "fa-person-running", result: "fa-arrows-left-right", catch: "fa-hand-back-fist", crew: "fa-crosshairs" };
const WAY_ICON = { driver: "fa-car-side", passenger: "fa-car-side", self: "fa-person-running", fly: "fa-plane-up" };
const unitIcon = (u) => (u.vehicle ? "fa-car-side" : WAY_ICON[u.people[0]?.role] ?? "fa-person-running");

/** the decision of this seat (a paper caption: something to do), or who the table waits for (quiet), with the GM's settle buttons */
function decisionBox(d) {
  const dec = d.decision;
  const waits = d.waits?.length ? h("ul.itc-waits", { attrs: { "aria-label": d.labels.waiting } }, d.waits.map((w) => h("li.itc-wait", { data: { optional: w.optional ? "1" : null } },
    h("span.itc-wait-t", { text: w.text }), w.buttons?.length ? h("span.itc-wait-b", {}, btns(w.buttons, `w:${w.id}`)) : null))) : null;
  if (!dec) return waits ? h("div.itc-dec", { data: { kind: "wait" } }, h("p.itc-dec-k", { text: d.labels.waiting }), waits) : null;
  return h("div.itc-dec", { data: { kind: dec.kind, mine: dec.mine ? "1" : null }, attrs: { role: "group", "aria-label": dec.title } },
    h("div.itc-dec-h", {}, plate(dec.title, ".itc-dec-p"), dec.text ? h("p.itc-dec-t", { text: dec.text }) : null),
    dec.buttons?.length ? h("div.itc-dec-b", {}, btns(dec.buttons, "dec")) : null,
    waits);
}
/** the GM's corrections: the obstacle of the next roll, the table on or off, the distance by hand, who joins, the ends of the chase */
function gmBox(d) {
  const g = d.gm;
  if (!g) return null;
  const sel = (fk, label, value, choices, fn) => h("select.itc-sel", { fk, attrs: { "aria-label": label }, on: { change: (e, el) => fn(el.value) } },
    choices.map((c) => h("option", { text: c.label, attrs: { value: c.id, selected: c.id === value } })));
  const body = gmOpen ? h("div.itc-gm-b", {},
    h("label.itc-ctl.itc-c-obs", {}, h("span.itc-k", { text: g.obstacle.label }), sel("gm:obs", g.obstacle.label, g.obstacle.value, g.obstacle.choices, (v) => handlers.own?.({ obstacle: v === "auto" ? null : v }))),
    h("div.itc-ctl.itc-c-tab", {}, h("span.itc-k", { text: g.table.label }), h("button.itc-tog", { fk: "gm:table", attrs: { "aria-pressed": String(g.table.on) }, on: { click: () => handlers.send?.(g.table.req) } }, icon(g.table.on ? "fa-square-check" : "fa-square"), h("span", { text: g.table.label }))),
    h("div.itc-ctl.itc-c-dist", { tip: g.distance.tip }, h("span.itc-k", { text: g.distance.label }), h("span.itc-step", {},
      h("button", { fk: "gm:d-", disabled: !g.distance.minus, attrs: { "aria-label": `${g.distance.label} -1` }, on: { click: () => handlers.send?.(g.distance.minus) } }, icon("fa-minus")),
      h("b", { text: String(g.distance.value), attrs: { "aria-live": "polite" } }),
      h("button", { fk: "gm:d+", disabled: !g.distance.plus, attrs: { "aria-label": `${g.distance.label} +1` }, on: { click: () => handlers.send?.(g.distance.plus) } }, icon("fa-plus")))),
    h("div.itc-ctl.itc-c-join", {}, h("span.itc-k", { text: g.join.label }),
      h("span.itc-join", {}, g.join.choices.length ? sel("gm:join", g.join.label, g.join.value, g.join.choices, (v) => handlers.own?.({ join: v })) : h("span.itc-none", { text: g.join.none }),
        g.join.to.map((b) => btn(b, `gm:${b.id}`, ".itc-small")))),
    h("div.itc-ctl.itc-c-ends", {}, h("span.itc-k", { text: d.labels.ends }), h("span.itc-ends-b", {}, g.ends.map((b) => btn({ ...b, primary: false }, `gm:end:${b.id}`, ".itc-small"))))) : null;
  return h("div.itc-gm", { data: { open: gmOpen ? "1" : null } },
    h("button.itc-gm-h", { fk: "gm:open", attrs: { "aria-expanded": String(gmOpen) }, on: { click: () => { gmOpen = !gmOpen; draw(); } } }, icon("fa-sliders"), h("span", { text: d.labels.gm }), icon(gmOpen ? "fa-chevron-up" : "fa-chevron-down")),
    body);
}
function head(d, extra = null) {
  return h("header.itc-head", {},
    plate(d.title, ".itc-title"),
    h("span.itc-round", { text: d.roundLabel }),
    d.you ? h("span.itc-you", { data: { seat: d.seat }, text: d.you }) : null,
    extra,
    h("button.itc-fold", { fk: "fold", tip: folded ? d.labels.unfold : d.labels.fold, attrs: { "aria-expanded": String(!folded) }, on: { click: () => { folded = !folded; draw(); } } }, icon(folded ? "fa-chevron-down" : "fa-chevron-up")));
}
function rollOf(s) {
  const r = s.roll;
  if (!r || r.state === "none") return null;
  return h("span.itc-roll", { data: { state: r.state } }, r.state === "owed" ? icon("fa-dice") : null, r.text ? h("span", { text: r.text }) : null);
}
/** one person of a unit: face, name (cut at its box), role, the crew's shot (open / used) */
const person = (p) => h("li.itc-person", { data: { mine: p.mine ? "1" : null, crew: p.crew, rolls: p.rolls ? "1" : null } },
  face(p.img, p.name, "itc-face"), nm("span.itc-pn", p.name), h("span.itc-role", { text: p.roleText }),
  p.crew ? h("span.itc-shot", { tip: `${d0.labels.crew}: ${p.crew === "open" ? d0.labels.shotOpen : d0.labels.shotUsed}`, data: { crew: p.crew } }, icon("fa-crosshairs")) : null);
/** the die on the unit that rolls for its side (a vehicle carries it on its name line) */
const die = (s) => h("span.itc-die", { tip: s.rolls.why ? `${s.rolls.text} (${s.rolls.why})` : s.rolls.text }, icon("fa-dice"));
/** the GM's way out of the chase for one unit (tools open only) */
const drop = (u) => gmOpen && u.drop ? h("button.itc-drop", { fk: `gm:drop:${u.id}`, tip: u.drop.disabled ?? u.drop.label, disabled: !u.drop.req, attrs: { "aria-label": u.drop.label }, on: { click: () => handlers.send?.(u.drop.req) } }, icon("fa-right-from-bracket")) : null;
/** THE ROSTER of a side: one line per unit. A vehicle: its name, then the people aboard; somebody on their own: the person itself.
    The unit that rolls carries the die; one that cannot move says why (dashed); the GM's tools add the way out of the chase. */
/** CHASE2 groups (ours): the GM splits a pursuer off into a group of its own, or puts one that is alone into another group (tools open) */
const gmove = (u) => gmOpen && u.group ? h("button.itc-drop.itc-gmove", { fk: `gm:group:${u.id}`, data: { kind: u.group.kind }, tip: u.group.disabled ?? u.group.label, disabled: !u.group.req, attrs: { "aria-label": u.group.label }, on: { click: () => handlers.send?.(u.group.req) } }, icon(u.group.kind === "merge" ? "fa-object-group" : "fa-object-ungroup")) : null;
const unitLine = (u, s) => h("li.itc-unit", { data: { mine: u.mine ? "1" : null, rolls: u.rolls ? "1" : null, stuck: u.stuck ?? null, vehicle: u.vehicle ? "1" : null } },
  u.vehicle ? h("span.itc-uhead", {}, icon("fa-car-side"), nm("b.itc-un", u.name), u.rolls ? die(s) : null, gmove(u), drop(u)) : null,
  h("ul.itc-people", {}, (u.vehicle ? u.people : u.people.map((p) => ({ ...p, name: u.name }))).map(person)),
  u.vehicle && !u.people.length ? h("span.itc-role", { text: "-" }) : null,
  u.rolls && !u.vehicle ? die(s) : null,
  u.stuckText ? h("span.itc-stuck", { text: u.stuckText }) : null,
  u.vehicle ? null : gmove(u), u.vehicle ? null : drop(u));
/** CHASE2 groups (ours): one pursuing group: its letter, its own distance to the fleeing (the GM may step it), its roll or how far it moved
    in the round just played, or why it is out (lost them); then its units */
function groupBlock(g) {
  const step = (dir, req) => h("button.itc-gstep", { fk: `gm:gdist:${g.id}:${dir}`, tip: g.gm.tip, disabled: !req, attrs: { "aria-label": `${g.gm.tip} ${dir === "minus" ? "-1" : "+1"}` }, on: { click: () => handlers.send?.(req) } }, icon(dir === "minus" ? "fa-minus" : "fa-plus"));
  const r = rollOf(g);
  return h("li.itc-grp", { data: { lost: g.lost ? "1" : null, mine: g.mine ? "1" : null } },
    h("div.itc-gh", {},
      h("b.itc-gl", { text: g.letter, attrs: { "aria-label": g.label } }),
      gmOpen && g.gm ? step("minus", g.gm.minus) : null,
      h("b.itc-gd", { text: String(g.distance), tip: g.label }),
      gmOpen && g.gm ? step("plus", g.gm.plus) : null,
      g.lost ? h("span.itc-glost", { text: g.lostText }) : g.moved ? h("span.itc-gmv", { text: g.moved.text }) : null,
      r && !g.lost ? h("span.itc-gr", {}, r) : null),
    h("ul.itc-units", { attrs: { "aria-label": g.label } }, g.units.map((u) => unitLine(u, g))));
}
function roster(s) {
  if (s.groups) return h("ol.itc-groups", { attrs: { "aria-label": s.label } }, s.groups.map(groupBlock));
  return h("ul.itc-units", { attrs: { "aria-label": s.label } }, s.units.map((u) => unitLine(u, s)));
}
function obstacleBand(o) {
  if (!o) return null;
  return h("div.itc-obs", { data: { clear: o.clear ? "1" : null } },
    h("div.itc-obs-h", {}, icon(o.clear ? "fa-road" : "fa-road-barrier"), h("b", { text: o.name }), o.tag ? h("span.itc-tag", { text: o.tag }) : null),
    h("p.itc-obs-t", { text: o.fx }),
    o.rolls?.length ? h("div.itc-obs-r", {}, o.rolls.map((r) => h("span.itc-roll", { data: { state: r.state } }, nm("span.itc-on", `${r.whoName}: ${r.attr}`), r.state === "done" || r.state === "push" ? h("span", { text: `[[six:${r.sixes ?? 0}]]` }) : null))) : null);
}

/* ---------- THE FACE-OFF ---------- */
function corner(d, s) {
  const pic = s.who?.img ?? s.lead?.img ?? null, who = s.who?.name ?? s.lead?.name ?? "?";
  return h("div.itc-corner", { data: { side: s.id, mine: s.mine ? "1" : null, winner: d.result?.winner === s.id ? "1" : null } },
    h("div.itc-ch", {},
      h("div.itc-portrait", { attrs: { "aria-hidden": "true" } }, pic ? h("img", { attrs: { alt: "", src: pic, decoding: "async" } }) : h("b", { text: who.charAt(0) }), h("span.itc-pic-ic", {}, icon(s.lead ? unitIcon(s.lead) : "fa-person-running"))),
      h("div.itc-cw", {},
        h("span.itc-sl", { text: s.label }),
        s.rolls.text ? h("span.itc-rolls", {}, nm("span.itc-rt", s.rolls.text), s.rolls.why ? h("span.itc-why", { text: s.rolls.why }) : null) : null,
        h("div.itc-rollbox", {}, rollOf(s) ?? h("span.itc-roll", { data: { state: "none" }, text: "-" })))),
    roster(s));
}
function drawFaceoff(d) {
  const D = d.distance;
  const pips = h("ol.itc-pips", { attrs: { "aria-hidden": "true" } }, Array.from({ length: D.max + 1 }, (_, z) => h("li", { data: { on: z <= D.value && z > 0 ? "1" : null, end: z === D.max ? "1" : null, zero: z === 0 ? "1" : null } })));
  /* CHASE2 groups (ours): under the track, where each pursuing group stands (its letter at its distance) */
  const marks = D.marks ? h("ol.itc-marks", { attrs: { "aria-hidden": "true" } }, Array.from({ length: D.max + 1 }, (_, z) => h("li", {}, D.marks.filter((m) => m.at === z).map((m) => h("b", { text: m.letter, data: { lost: m.lost ? "1" : null, mine: m.mine ? "1" : null } }))))) : null;
  const mid = h("div.itc-mid", { attrs: { role: "img", "aria-label": `${D.unit}. ${D.say}` } },
    h("span.itc-vs", { text: d.result ? d.result.head : D.label ?? d.labels.distance }),
    h("b.itc-huge", { data: { tone: D.status.tone }, text: String(D.value) }),
    D.status.id !== "run" ? h("span.itc-unit-t", { data: { tone: D.status.tone }, text: D.status.text }) : null,
    pips, marks,
    h("span.itc-say", { text: D.say }),
    d.catch ? h("span.itc-catch", { text: d.catch.text }) : null);
  const strip = h("ol.itc-strip", { attrs: { "aria-label": d.labels.round } }, d.beats.map((b) => h("li", { data: { state: b.state }, tip: `${b.label}${b.who ? ` (${b.who})` : ""}${b.text ? `: ${b.text}` : ""}` }, icon(BEAT_ICON[b.id]), h("span", { text: b.label }))));
  return [head(d), h("div.itc-ring", { data: { crowd: d.crowd > 2 ? "1" : null } }, corner(d, d.sides[0]), mid, corner(d, d.sides[1])), obstacleBand(d.obstacle), strip, decisionBox(d), gmBox(d)];
}

/* ---------- folded: one strip ---------- */
function drawFolded(d) {
  const dec = d.decision, main = dec?.buttons?.find((b) => b.primary) ?? null;
  return [head(d, h("span.itc-fd", { data: { tone: d.distance.status.tone } }, h("b", { text: String(d.distance.value) }), h("span", { text: d.distance.say }))),
    dec ? h("div.itc-fdec", {}, h("span", { text: dec.title }), main ? btn(main, `fold:${main.id}`) : null) : null];
}

/* ---------- the end card: everybody sees how it ended ---------- */
function drawEnd(e, title) {
  return [h("header.itc-head", {}, plate(title, ".itc-title")),
    h("div.itc-endc", { data: { outcome: e.outcome }, attrs: { role: "status" } },
      h("b.itc-endt", { text: e.title }), h("p", { text: e.text }),
      h("ul.itc-ends-s", {}, e.sides.map((s) => h("li", { data: { side: s.id } }, h("span.itc-sl", { text: s.label }), h("b", { text: s.names || "-" })))),
      h("span.itc-k", { text: e.rounds })),
    h("div.itc-dec-b", {}, btn({ id: "close", label: e.close.label, primary: true, fn: () => handlers.own?.({ endSeen: e.close.endSeen }) }, "end:close"))];
}

/* ---------- drawing and placing ---------- */
let d0 = null;      // the data being drawn (for the small helpers above)
function draw() {
  if (!root || !last) return;
  const d = last;
  d0 = d.on ? d : null;
  const fold = (folded || aside) && d.on;
  panel.dataset.folded = fold ? "1" : "";
  if (!panel.dataset.folded) delete panel.dataset.folded;
  panel.dataset.seat = d.on ? d.seat : "end";
  panel.dataset.phase = d.on ? d.phase : "end";
  panel.dataset.gm = d.on && gmOpen && d.gm ? "1" : "";
  if (!panel.dataset.gm) delete panel.dataset.gm;
  const nodes = d.on ? (fold ? drawFolded(d) : drawFaceoff(d)) : drawEnd(d.ended, d.title);
  swap(panel, nodes);
  root.setAttribute("aria-label", d.title ?? "chase");
  place();
}
/** the data of chase-pure (null: no chase and no end card); o.aside: an action is armed whose targets are picked on the map (a crew
    member's shot): the panel stands folded to its strip until the action is declared or let go, so the tokens under it can be picked */
export function render(data, o = {}) {
  try {
    if (!data) { hide(); return; }
    ensure();
    aside = !!o.aside;
    const key = JSON.stringify([data, folded, gmOpen, aside]);
    last = data;
    root.classList.remove("itc-hidden");
    if (key === kept) { place(); return; }
    kept = key;
    draw();
  } catch (e) { console.warn("invincible-plus-ultra | tactics chase panel", e); }
}
export function hide() { last = null; kept = null; if (root) { root.classList.add("itc-hidden"); panel?.replaceChildren(); } }
export function destroy() { root?.remove(); root = panel = null; last = null; kept = null; }

/* THE PLACE: the middle of the window. Across: centred under the initiative bar, as wide as the top band lets (the questions' place).
   Down: from under the line (and under a question card standing in the questions' place) to over the bar and its armed panel.
   `tight`: a low window (under 470 px of room) draws everything a size smaller, so the GM's tools still fit at 1366x768. */
const top0 = (f) => f?.slots?.line ? f.slots.line.y1 : 110;
export function place() {
  try {
    if (!root || root.classList.contains("itc-hidden")) return;
    const W = window.innerWidth, H = window.innerHeight, f = frameNow();
    const dock = document.getElementById("invincible-tactics-dock");
    const cardsIn = dock?.querySelector('.its-slot[data-slot="cards"]:not([data-empty]) > .its-in');
    const cardsR = cardsIn ? [...cardsIn.children].map(visibleRect).filter(Boolean).reduce((a, r) => Math.max(a, r.bottom), 0) : 0;
    const panelR = visibleRect(dock?.querySelector(".itd-panel")), barR = visibleRect(dock?.querySelector(".its-bar .itd-stack") ?? dock?.querySelector(".its-bar"));
    /* centred where the questions hang, as wide as the panel wants (CHASE2: the questions' column alone is too narrow for two sides
       facing each other), inside the window and left of the GM's desk; a first-fight hint standing beside the line pushes the panel
       under it instead of squeezing it */
    let x0 = f?.slots?.cards?.x0 ?? 12, x1 = f?.slots?.cards?.x1 ?? W - 12;
    const scale = Number(getComputedStyle(root).getPropertyValue("--ita-scale")) || Number(getComputedStyle(document.documentElement).getPropertyValue("--ita-scale")) || 1;
    const deskR = visibleRect(document.getElementById("invincible-tactics-desk")), want = 760 * scale;
    const cx = (x0 + x1) / 2, right = deskR && deskR.left > cx ? deskR.left - GAP : W - 12;
    const half = Math.max(x1 - cx, Math.min(want / 2, cx - 12, right - cx));
    x0 = Math.max(12, cx - half); x1 = Math.min(W - 12, cx + half);
    /* a desk standing close (1366 px windows) would squeeze the two sides until names are cut to a few letters: the panel then
       grows to the left instead, as far as the left tool column and the party's tray let it */
    if (x1 - x0 < want - 1) {
      const wins = [...document.querySelectorAll(".window-app, .application:has(> .window-header), body > aside[id]:not(#tooltip)")].map(visibleRect).filter((r) => r && r.right < cx && r.bottom > top0(f) && r.top < H - 40);
      const lim = Math.max(180 * scale, ...wins.map((r) => r.right + GAP));
      x0 = Math.max(Math.min(x0, lim), x1 - want);
    }
    let top = Math.max(f?.slots?.line ? f.slots.line.y1 + 6 : 110, cardsR ? cardsR + GAP : 0);
    const hint = dock?.querySelector('.its-slot[data-slot="hint"]:not([data-empty])') ? f?.slots?.hint : null;
    if (hint && x1 > hint.x0 - GAP && hint.y1 > top) top = hint.y1 + GAP;
    const floor = Math.min(panelR ? panelR.top : H, barR && barR.height ? barR.top : H - 110, H - 40) - GAP;
    root.style.setProperty("--itc-x", `${Math.round((x0 + x1) / 2)}px`);
    root.style.setProperty("--itc-w", `${Math.max(280, Math.round(x1 - x0))}px`);
    root.style.setProperty("--itc-top", `${Math.round(top)}px`);
    root.style.setProperty("--itc-h", `${Math.max(120, Math.round(floor - top))}px`);
    root.dataset.tight = floor - top < 470 ? "1" : "";
    if (!root.dataset.tight) delete root.dataset.tight;
  } catch { /* stays where it was */ }
}
