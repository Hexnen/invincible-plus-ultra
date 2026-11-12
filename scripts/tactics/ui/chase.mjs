/* Tactical combat, the surfaces: THE CHASE PANEL (CHASE; DOM only, the data is ui/chase-pure.mjs chaseData).
   USER 2026-11-12: the chase needs its own beautiful, clear panel, one, in the middle. While a chase runs this panel is where every seat
   reads it and plays it: who flees and who pursues, the distance and how near escape or capture is, the round's beats, the decision
   this seat has to make (its buttons are the very requests and roll actions the dock and the desk send), who the table waits for, the
   GM's corrections and, once over, how it ended. THREE LOOKS of the same data, picked by the client setting `tacticsChaseLook` (or
   `game.modules.get(...).api.tactics.ui.chaseLook("B")` for a quick switch):
     A: the road        a wide strip: the zones between the pursuers and the point where the trail is lost, both sides as markers on
                        it, the beats of the round in a row under it, the decision as a caption under that
     B: the face-off    the two sides as big portraits facing each other, the distance as a big number between them, the obstacle
                        under the number, the decision as a caption box across the foot
     C: the storyboard  a narrow column: a small strip of the distance on top, then the round as a list of panels, one per beat, the
                        beat being played open with its decision in it, the ones played say what they came to
   PLACE: the middle of the window, under the line that hangs from the initiative bar (and under a question card standing there), over
   the bar and its armed panel; what does not fit scrolls inside the panel. It folds to one strip with the decision's main button. */

import { h, icon, face, markOf, swap, visibleRect } from "./dom.mjs";
import { frameNow } from "./slots.mjs";

const ID = "invincible-tactics-chase", GAP = 8;
let root = null, panel = null, handlers = {}, last = null, lastLook = "A", folded = false, gmOpen = false, kept = null, aside = false;

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
const BEAT_ICON = { obstacle: "fa-road-barrier", prey: "fa-person-running", pursuer: "fa-person-running", result: "fa-arrows-left-right", catch: "fa-hand-back-fist", crew: "fa-crosshairs" };
const STATE_ICON = { done: "fa-check", now: "fa-play", next: null };
const sideIcon = (s) => (s.units.some((u) => u.vehicle) ? "fa-car-side" : "fa-person-running");

/** the decision of this seat, or who the table waits for (with the GM's settle buttons) */
function decisionBox(d, cls = "itc-dec") {
  const dec = d.decision;
  const waits = d.waits?.length ? h("ul.itc-waits", { attrs: { "aria-label": d.labels.waiting } }, d.waits.map((w) => h("li.itc-wait", { data: { optional: w.optional ? "1" : null } },
    h("span.itc-wait-t", { text: w.text }), w.buttons?.length ? h("span.itc-wait-b", {}, btns(w.buttons, `w:${w.id}`)) : null))) : null;
  if (!dec) return waits ? h(`div.${cls}`, { data: { kind: "wait" } }, h("p.itc-dec-k", { text: d.labels.waiting }), waits) : null;
  return h(`div.${cls}`, { data: { kind: dec.kind, mine: dec.mine ? "1" : null }, attrs: { role: "group", "aria-label": dec.title } },
    h("div.itc-dec-h", {}, plate(dec.title, ".itc-dec-p")),
    dec.text ? h("p.itc-dec-t", { text: dec.text }) : null,
    dec.buttons?.length ? h("div.itc-dec-b", {}, btns(dec.buttons, "dec")) : null,
    waits);
}
/** the GM's corrections: the obstacle of the next roll, the table on or off, the distance by hand, the ends of the chase */
function gmBox(d) {
  const g = d.gm;
  if (!g) return null;
  const sel = h("select.itc-sel", { fk: "gm:obs", attrs: { "aria-label": g.obstacle.label }, on: { change: (e, el) => handlers.own?.({ obstacle: el.value === "auto" ? null : el.value }) } },
    g.obstacle.choices.map((c) => h("option", { text: c.label, attrs: { value: c.id, selected: c.id === g.obstacle.value } })));
  const body = gmOpen ? h("div.itc-gm-b", {},
    h("label.itc-ctl", {}, h("span.itc-k", { text: g.obstacle.label }), sel),
    h("div.itc-ctl", {}, h("span.itc-k", { text: g.table.label }), h("button.itc-tog", { fk: "gm:table", attrs: { "aria-pressed": String(g.table.on) }, on: { click: () => handlers.send?.(g.table.req) } }, icon(g.table.on ? "fa-square-check" : "fa-square"), h("span", { text: g.table.label }))),
    h("div.itc-ctl", { tip: g.distance.tip }, h("span.itc-k", { text: g.distance.label }), h("span.itc-step", {},
      h("button", { fk: "gm:d-", disabled: !g.distance.minus, attrs: { "aria-label": `${g.distance.label} -1` }, on: { click: () => handlers.send?.(g.distance.minus) } }, icon("fa-minus")),
      h("b", { text: String(g.distance.value), attrs: { "aria-live": "polite" } }),
      h("button", { fk: "gm:d+", disabled: !g.distance.plus, attrs: { "aria-label": `${g.distance.label} +1` }, on: { click: () => handlers.send?.(g.distance.plus) } }, icon("fa-plus")))),
    h("div.itc-ctl.itc-ends", {}, h("span.itc-k", { text: d.labels.ends }), h("span.itc-ends-b", {}, g.ends.map((b) => btn({ ...b, primary: false }, `gm:end:${b.id}`, ".itc-end"))))) : null;
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
/** the people of one side: faces with their role, the crew's shot (open / used) */
function people(s, small = false) {
  return h("ul.itc-people", { data: { small: small ? "1" : null } }, s.units.flatMap((u) => u.people.map((p) => h("li.itc-person", { data: { mine: p.mine ? "1" : null, crew: p.crew } },
    face(p.img, p.name, "itc-face"), h("span.itc-pn", { text: p.name }), h("span.itc-role", { text: p.roleText }),
    p.crew ? h("span.itc-shot", { tip: `${d0.labels.crew}: ${p.crew === "open" ? "+" : "-"}`, data: { crew: p.crew } }, icon("fa-crosshairs")) : null))));
}
let d0 = null;      // the data being drawn (for the small helpers above)
function rollOf(s) {
  const r = s.roll;
  if (!r || r.state === "none") return null;
  return h("span.itc-roll", { data: { state: r.state } }, r.state === "owed" ? icon("fa-dice") : null, r.text ? h("span", { text: r.text }) : null);
}
function obstacleCard(o, cls = "itc-obs") {
  if (!o) return null;
  return h(`div.${cls}`, { data: { clear: o.clear ? "1" : null } },
    h("div.itc-obs-h", {}, icon(o.clear ? "fa-road" : "fa-road-barrier"), h("b", { text: o.name }), o.tag ? h("span.itc-tag", { text: o.tag }) : null),
    h("p.itc-obs-t", { text: o.fx }),
    o.rolls?.length ? h("div.itc-obs-r", {}, o.rolls.map((r) => h("span.itc-roll", { data: { state: r.state } }, h("span", { text: `${r.whoName}: ${r.attr}` }), r.state === "done" || r.state === "push" ? h("span", { text: `[[six:${r.sixes ?? 0}]]` }) : null))) : null);
}

/* ---------- A: THE ROAD ---------- */
function drawA(d) {
  const D = d.distance, max = D.max, prey = d.sides[1], pur = d.sides[0];
  const cells = [];
  for (let z = 0; z <= max; z++) {
    const at = z === Math.min(D.value, max), was = D.from != null && z === Math.min(D.from, max) && D.from !== D.value;
    cells.push(h("li.itc-zone", { data: { between: z > 0 && z < D.value ? "1" : null, prey: at ? "1" : null, was: was ? "1" : null, end: z === max ? "1" : null, start: z === 0 ? "1" : null } },
      z === 0 ? h("span.itc-mark", { data: { side: "pursuer" } }, face(pur.lead?.img, pur.lead?.name, "itc-face"), icon(sideIcon(pur))) : null,
      at && z > 0 ? h("span.itc-mark", { data: { side: "prey" } }, face(prey.lead?.img, prey.lead?.name, "itc-face"), icon(sideIcon(prey))) : null,
      at && z === 0 ? h("span.itc-mark", { data: { side: "prey", caught: "1" } }, face(prey.lead?.img, prey.lead?.name, "itc-face")) : null,
      was ? h("span.itc-ghost", { attrs: { "aria-hidden": "true" } }) : null,
      h("span.itc-zn", { text: z === max ? "" : String(z) }, z === max ? icon("fa-flag-checkered") : null)));
  }
  const road = h("div.itc-road", { attrs: { role: "img", "aria-label": `${D.unit}. ${D.say}` } },
    h("span.itc-end-l", { text: D.catchText }), h("ol.itc-zones", {}, cells), h("span.itc-end-r", { text: D.escapeText }));
  road.querySelector(".itc-zones").style.setProperty("--n", String(max + 1));
  const names = h("div.itc-names", {},
    h("div.itc-side", { data: { side: "pursuer", mine: pur.mine ? "1" : null } }, h("span.itc-sl", { text: pur.label }), h("b", { text: pur.units.map((u) => u.name).join(", ") }), rollOf(pur)),
    h("div.itc-status", { data: { tone: D.status.tone } }, h("b.itc-big", { text: String(D.value) }), h("span", { text: D.say })),
    h("div.itc-side", { data: { side: "prey", mine: prey.mine ? "1" : null } }, h("span.itc-sl", { text: prey.label }), h("b", { text: prey.units.map((u) => u.name).join(", ") }), rollOf(prey)));
  const beats = h("ol.itc-beats", { attrs: { "aria-label": d.labels.round } }, d.beats.map((b) => h("li.itc-beat", { data: { state: b.state, id: b.id } },
    icon(STATE_ICON[b.state] ?? BEAT_ICON[b.id]), h("span.itc-bl", { text: b.label }), b.text ? h("span.itc-bt", { text: b.text }) : null)));
  return [head(d), road, names, d.obstacle ? obstacleCard(d.obstacle) : null, beats, decisionBox(d), gmBox(d)];
}

/* ---------- B: THE FACE-OFF ---------- */
function drawB(d) {
  const D = d.distance;
  const corner = (s) => h("div.itc-corner", { data: { side: s.id, mine: s.mine ? "1" : null, winner: d.result?.winner === s.id ? "1" : null } },
    h("span.itc-sl", { text: s.label }),
    h("div.itc-portrait", {}, s.lead?.img ? h("img", { attrs: { alt: "", src: s.lead.img, decoding: "async" } }) : h("b", { text: (s.lead?.name ?? "?").charAt(0) }), h("span.itc-pic-ic", {}, icon(sideIcon(s)))),
    h("b.itc-uname", { text: s.units.map((u) => u.name).join(", ") }),
    people(s, true),
    h("div.itc-rollbox", {}, rollOf(s) ?? h("span.itc-roll", { data: { state: "none" }, text: "-" })));
  const pips = h("ol.itc-pips", { attrs: { "aria-hidden": "true" } }, Array.from({ length: D.max + 1 }, (_, z) => h("li", { data: { on: z <= D.value && z > 0 ? "1" : null, end: z === D.max ? "1" : null, zero: z === 0 ? "1" : null } })));
  const mid = h("div.itc-mid", { attrs: { role: "img", "aria-label": `${D.unit}. ${D.say}` } },
    h("span.itc-vs", { text: d.result ? d.result.head : d.roundLabel }),
    h("b.itc-huge", { data: { tone: D.status.tone }, text: String(D.value) }),
    h("span.itc-unit", { text: D.status.text }),
    pips,
    h("span.itc-say", { text: D.say }),
    d.obstacle ? obstacleCard(d.obstacle, "itc-obs.itc-obs-mid") : null);
  const strip = h("ol.itc-strip", { attrs: { "aria-label": d.labels.round } }, d.beats.map((b) => h("li", { data: { state: b.state }, tip: `${b.label}${b.text ? `: ${b.text}` : ""}` }, icon(BEAT_ICON[b.id]), h("span", { text: b.label }))));
  return [head(d), h("div.itc-ring", {}, corner(d.sides[0]), mid, corner(d.sides[1])), strip, decisionBox(d, "itc-dec.itc-caption"), gmBox(d)];
}

/* ---------- C: THE STORYBOARD ---------- */
function drawC(d) {
  const D = d.distance;
  const meter = h("div.itc-meter", { attrs: { role: "img", "aria-label": `${D.unit}. ${D.say}` } },
    h("span.itc-ml", { text: D.catchText }),
    h("span.itc-mbar", {}, h("span.itc-mfill"), h("span.itc-mdot", {}), D.from != null && D.from !== D.value ? h("span.itc-mwas", {}) : null),
    h("span.itc-ml", { text: D.escapeText }),
    h("b.itc-mn", { data: { tone: D.status.tone }, text: String(D.value) }));
  const pct = (n) => `${Math.max(0, Math.min(100, (n / D.max) * 100))}%`;
  meter.querySelector(".itc-mfill").style.width = pct(D.value);
  meter.querySelector(".itc-mdot").style.left = pct(D.value);
  meter.querySelector(".itc-mwas")?.style.setProperty("left", pct(D.from));
  const who = h("p.itc-who", {}, ...d.sides.map((s) => h("span.itc-whos", { data: { side: s.id, mine: s.mine ? "1" : null } }, icon(sideIcon(s)), h("span.itc-sl", { text: s.label }), h("b", { text: s.units.map((u) => u.name).join(", ") }))));
  const decHere = (b) => b.state === "now" || (b.id === "result" && d.phase === "after" && !d.beats.some((x) => x.state === "now"));
  let placed = false;
  const frames = d.beats.map((b) => {
    const open = !placed && decHere(b);
    if (open) placed = true;
    const side = b.id === "prey" ? d.sides[1] : b.id === "pursuer" ? d.sides[0] : null;
    return h("li.itc-frame", { data: { state: b.state, id: b.id, open: open ? "1" : null } },
      h("div.itc-fh", {}, h("span.itc-fic", {}, icon(BEAT_ICON[b.id])), h("b", { text: b.label }), b.who ? h("span.itc-fwho", { text: b.who }) : null, h("span.itc-ft", { text: b.text || "" }), icon(STATE_ICON[b.state] ?? "fa-ellipsis")),
      open && b.id === "obstacle" && d.obstacle ? obstacleCard(d.obstacle) : null,
      open && side ? people(side, true) : null,
      open ? decisionBox(d) : null);
  });
  const rest = placed ? null : decisionBox(d);
  return [head(d), meter, who, h("ol.itc-board", { attrs: { "aria-label": d.labels.round } }, frames), rest, d.phase !== "rolling" && d.obstacle && !placed ? obstacleCard(d.obstacle) : null, gmBox(d)];
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
      h("ul.itc-ends-s", {}, e.sides.map((s) => h("li", {}, h("span.itc-sl", { text: s.label }), h("b", { text: s.names || "-" })))),
      h("span.itc-k", { text: e.rounds })),
    h("div.itc-dec-b", {}, btn({ id: "close", label: e.close.label, primary: true, fn: () => handlers.own?.({ endSeen: e.close.endSeen }) }, "end:close"))];
}

/* ---------- drawing and placing ---------- */
function draw() {
  if (!root || !last) return;
  const d = last;
  d0 = d.on ? d : null;
  panel.dataset.look = lastLook;
  const fold = (folded || aside) && d.on;
  panel.dataset.folded = fold ? "1" : "";
  if (!panel.dataset.folded) delete panel.dataset.folded;
  panel.dataset.seat = d.on ? d.seat : "end";
  panel.dataset.phase = d.on ? d.phase : "end";
  const nodes = d.on ? (fold ? drawFolded(d) : lastLook === "B" ? drawB(d) : lastLook === "C" ? drawC(d) : drawA(d)) : drawEnd(d.ended, d.title);
  swap(panel, nodes);
  root.setAttribute("aria-label", d.title ?? "chase");
  place();
}
/** the data of chase-pure (null: no chase and no end card), the look (A, B or C); o.aside: an action is armed whose targets are picked
    on the map (a crew member's shot): the panel stands folded to its strip until the action is declared or let go, so the tokens under it can be picked */
export function render(data, look = "A", o = {}) {
  try {
    if (!data) { hide(); return; }
    ensure();
    aside = !!o.aside;
    const key = JSON.stringify([data, look, folded, gmOpen, aside]);
    last = data; lastLook = look;
    root.classList.remove("itc-hidden");
    if (key === kept) { place(); return; }
    kept = key;
    draw();
  } catch (e) { console.warn("invincible-plus-ultra | tactics chase panel", e); }
}
export function hide() { last = null; kept = null; if (root) { root.classList.add("itc-hidden"); panel?.replaceChildren(); } }
export function destroy() { root?.remove(); root = panel = null; last = null; kept = null; }

/* THE PLACE: the middle of the window. Across: centred under the initiative bar, as wide as the top band lets (the questions' place).
   Down: from under the line (and under a question card standing in the questions' place) to over the bar and its armed panel. */
export function place() {
  try {
    if (!root || root.classList.contains("itc-hidden")) return;
    const W = window.innerWidth, H = window.innerHeight, f = frameNow();
    const dock = document.getElementById("invincible-tactics-dock");
    const cardsIn = dock?.querySelector('.its-slot[data-slot="cards"]:not([data-empty]) > .its-in');
    const cardsR = cardsIn ? [...cardsIn.children].map(visibleRect).filter(Boolean).reduce((a, r) => Math.max(a, r.bottom), 0) : 0;
    const panelR = visibleRect(dock?.querySelector(".itd-panel")), barR = visibleRect(dock?.querySelector(".its-bar .itd-stack") ?? dock?.querySelector(".its-bar"));
    /* as wide as the top band, centred where the questions hang: the first-fight hint's column is the panel's too, unless a hint stands there */
    let x0 = f?.slots?.cards?.x0 ?? 12, x1 = f?.slots?.cards?.x1 ?? W - 12;
    const hintOn = !!dock?.querySelector('.its-slot[data-slot="hint"]:not([data-empty])'), R = hintOn ? (f?.slots?.hint?.x0 ?? x1 + GAP) - GAP : f?.slots?.notice?.x1 ?? x1;
    const cx = (x0 + x1) / 2, half = Math.max(x1 - cx, Math.min(R - cx, cx - 12));
    x0 = Math.max(12, cx - half); x1 = Math.min(W - 12, cx + half);
    const top = Math.max(f?.slots?.line ? f.slots.line.y1 + 6 : 110, cardsR ? cardsR + GAP : 0);
    const floor = Math.min(panelR ? panelR.top : H, barR && barR.height ? barR.top : H - 110, H - 40) - GAP;
    root.style.setProperty("--itc-x", `${Math.round((x0 + x1) / 2)}px`);
    root.style.setProperty("--itc-w", `${Math.max(280, Math.round(x1 - x0))}px`);
    root.style.setProperty("--itc-top", `${Math.round(top)}px`);
    root.style.setProperty("--itc-h", `${Math.max(120, Math.round(floor - top))}px`);
    root.dataset.tight = floor - top < 420 ? "1" : "";
    if (!root.dataset.tight) delete root.dataset.tight;
  } catch { /* stays where it was */ }
}
