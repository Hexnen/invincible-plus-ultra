/* Tactical combat, the surfaces: THE ACTION DOCK (the player's surface; the same dock serves the GM driving an NPC). DOM + placement only:
   main.mjs hands over the render data of model-pure.dockData and receives clicks through configure({ ... }). No Foundry documents here.
   WHERE: bottom centre, 6 px above the macro bar: the place of the turn tray, which this dock replaces while tactical combat runs
   (its pips are the budget chips here, its End turn is the red button). Placement is the tray's: measured, never per frame; pushed clear
   of the party column and the map's pins panel (left), of the sidebar, the chat notifications and the GM desk (right); a window too
   narrow lets the bar wrap, and under TIGHT px of room the two side buttons (Something else, Hold off) keep only their glyph.
   HEIGHT (U5, U6): the bar is one flow of buttons (who, the action groups parted by a rule, the tail), two rows at 1366 px. What stands
   above it (panel, questions) ends below whatever hangs from the top of the window over the dock's width (the initiative bar, the map's
   orbit strip): each of them scrolls inside its share instead of climbing over those. Tooltips open away from the other buttons: up from
   the bar's first row, down from its last (place() says which).
   STRUCTURE (bottom up):  waiting line  <  the bar  <  the panel of the armed action  <  the questions asked of this user.
     bar:   [character tabs] [face, name, budget chips, bonus dice, statuses] [action groups] [Something else] [Hold off] [End turn]
     panel: declare (target chips + map pick, dice, chance band, Declare) | blocked (reason + ask the GM) | something else | hold off |
            the own action in progress (what it waits for, change / cancel)
   RESTING (not the user's turn, nothing armed, nothing asked): only the who block; the chevron opens the bar to look or to ask for an
   exception. A question addressed to the user always shows, whoever's turn it is. */
import { h, icon, swap, face, costIcon, askCard, waitChips, rollChip, visibleRect } from "./dom.mjs";

const ID = "invincible-tactics-dock";
const GAP = 6;
const TIGHT = 1000;      // px of room for the bar below which the side buttons are glyphs
/* what hangs from the top of the window and must stay readable above the dock: the initiative bar's tiles and their pip tabs, the map's orbit strip */
const TOP_OBSTACLES = "#invincible-combat-bar .icbar-tile, #invincible-combat-bar .icbar-acts:not([hidden]), #invincible-combat-bar .icbar-gma:not([hidden]), #mm-orbit-strip";
/* panels of other modules at the left edge that reach down into the dock's band (the map's pins / filter panel, its VRAM meter) */
const LEFT_OBSTACLES = ".mm-filter, #mm-vram";
let root = null, stack = null, handlers = {}, shown = false, hideTimer = 0, last = null, panelKey = null;

export function configure(x) { handlers = x ?? {}; }
const set = (patch) => handlers.set?.(patch);
const send = (req, after) => handlers.send?.(req, after);

function ensure(label) {
  if (root?.isConnected) return;
  root = h(`div.itd-hidden`, { attrs: { id: ID, role: "region", "aria-label": label } });
  stack = h("div.itd-stack");
  root.append(stack);
  document.body.appendChild(root);
}

/* ---------- placement (the turn tray's algorithm, with the GM desk as one more thing on the right) ---------- */
export function place() {
  if (!root) return;
  const W = window.innerWidth, H = window.innerHeight;
  const hot = visibleRect(document.getElementById("hotbar"));
  /* other modules park their own strips right above the macro bar (the map director's bar): the dock stands above the highest of them */
  let floor = hot && hot.top > H * 0.4 ? hot.top : H - 14;
  for (const id of ["mm-dir-bar"]) { const r = visibleRect(document.getElementById(id)); if (r && r.top > H * 0.5 && r.top < floor && r.left < W * 0.6 && r.right > W * 0.4) floor = r.top; }
  const bottom = H - floor + GAP;
  const cx0 = hot ? (hot.left + hot.right) / 2 : W / 2;
  let lo = 12, hi = W - 12;
  /* the room above the dock: down from the lowest thing that hangs from the top over the middle of the window */
  let ceil = 8;
  for (const el of document.querySelectorAll(TOP_OBSTACLES)) { const r = visibleRect(el); if (r && r.top < H * 0.4 && r.bottom < H * 0.5 && r.right > W * 0.25 && r.left < W * 0.75) ceil = Math.max(ceil, r.bottom + 8); }
  const room = Math.max(150, H - bottom - ceil);
  root.style.setProperty("--itd-room", `${Math.round(room)}px`);
  const yBot = H - bottom, yTop = yBot - Math.min(stack.offsetHeight || 60, room) - 4;
  const inBand = (r) => r && r.top < yBot && r.bottom > yTop;
  const sb = visibleRect(document.getElementById("sidebar"));
  if (sb && sb.left > W * 0.5) hi = Math.min(hi, sb.left - 12);
  for (const m of document.querySelectorAll("#chat-notifications .chat-message")) { const r = visibleRect(m); if (inBand(r) && r.left > W * 0.3) hi = Math.min(hi, r.left - 10); }
  /* the open GM desk and a panel at the left edge that hangs lower than the top obstacles are kept clear of WHATEVER the dock's height
     is now: a dock that changed its width with every panel that opened made the buttons jump under the pointer (U6) */
  const low = (r) => r && r.bottom > ceil + 60 && r.top < yBot;
  for (const el of document.querySelectorAll("#invincible-tactics-desk .igd, #invincible-tactics-desk .igd-handle")) { const r = visibleRect(el); if ((el.classList.contains("igd") ? low(r) : inBand(r)) && r.left > W * 0.4) hi = Math.min(hi, r.left - 10); }
  const partyEl = document.getElementById("invincible-party"), party = visibleRect(partyEl);
  if (party && party.right < W * 0.5) {
    const kids = [...partyEl.querySelectorAll(".ipt-item")].map(visibleRect).filter(inBand);
    if (kids.length || inBand(party)) lo = Math.max(lo, Math.max(party.right, ...kids.map((k) => k.right)) + 10);
  }
  const pl = visibleRect(document.getElementById("players"));
  if (inBand(pl) && pl.right < W * 0.3) lo = Math.max(lo, pl.right + 8);
  for (const el of document.querySelectorAll(LEFT_OBSTACLES)) { const r = visibleRect(el); if (low(r) && r.right < W * 0.4) lo = Math.max(lo, r.right + 8); }
  const avail = Math.max(280, hi - lo);
  if (avail < TIGHT) root.dataset.tight = "1"; else delete root.dataset.tight;
  root.style.setProperty("--itd-bottom", `${Math.round(bottom)}px`);
  root.style.setProperty("--itd-maxw", `${Math.round(avail)}px`);
  /* the panel and the questions share what is left above the bar: the panel takes what it needs first (it is what the user is doing),
     the questions the rest; each scrolls inside its share */
  const part = (sel) => stack.querySelector(sel)?.offsetHeight ?? 0;
  const fixed = part(".itd-bar") + part(".itd-wait") + 2 * GAP, asks = stack.querySelector(".itd-asks"), panelEl = stack.querySelector(".itd-panel");
  const above = Math.max(120, room - fixed);
  const panelMax = asks && panelEl ? Math.max(110, Math.round(above * 0.6)) : above;
  root.style.setProperty("--itd-panel-maxh", `${Math.round(panelMax)}px`);
  root.style.setProperty("--itd-maxh", `${Math.max(110, Math.round(above - (panelEl ? Math.min(panelEl.scrollHeight + 4, panelMax) + GAP : 0)))}px`);
  tipSides();
  /* what floats at the bottom centre besides the dock (the module's end-of-session notice) stands above it: styles/tactics-ui.css */
  try {
    const clear = Math.round(bottom + Math.min(stack.offsetHeight, room) + 10);
    document.body.style.setProperty("--itd-clear", `${clear}px`);
    /* an open panel that reaches the bars at the top leaves the notice no free strip: it waits until the panel closes rather than lie on the initiative bar */
    document.body.classList.toggle("ita-notice-wait", H - clear - 64 < ceil);
  } catch { /* no body */ }
  const w = Math.min(stack.offsetWidth, avail);
  let cx = cx0;
  if (cx + w / 2 > hi) cx = hi - w / 2;
  if (cx - w / 2 < lo) cx = lo + w / 2;
  root.style.setProperty("--itd-cx", `${Math.round(cx)}px`);
}

/* U27: a tooltip of the bar opens away from the bar's other buttons: up from the first row, down from the last one (a bar of one row:
   up, over the map; the panel above is never under the pointer's way to a neighbour) */
function tipSides() {
  const bar = stack.querySelector(".itd-bar");
  if (!bar) return;
  const btns = [...bar.querySelectorAll("button, .itd-zone, .itd-extra[data-tooltip]")], tops = btns.map((b) => b.getBoundingClientRect().top);
  const first = Math.min(...tops), last = Math.max(...tops);
  btns.forEach((b, i) => { b.dataset.tooltipDirection = last - first > 12 && tops[i] > (first + last) / 2 ? "DOWN" : "UP"; });
}

/* ---------- pieces ---------- */
const GLYPH = { door: "fa-door-open", move: "fa-person-running" };
const pip = (p) => h("button.itd-pip", { fk: `pip:${p.key}`, tip: p.tip, disabled: !p.req, data: { state: p.state, kind: p.kind }, attrs: { "aria-label": p.tip }, on: { click: () => p.req && send(p.req) } }, costIcon(p.unit), h("span", { text: p.label }));

function whoBlock(d) {
  const w = d.who;
  return h("div.itd-who", {},
    d.chars.length ? h("div.itd-chars", { attrs: { role: "group" } }, d.chars.map((c) => h(`button.itd-char${c.onTurn ? ".itd-char-turn" : ""}${c.asked ? ".itd-char-asked" : ""}`, { fk: `char:${c.id}`, tip: c.name, attrs: { "aria-pressed": String(c.sel) }, on: { click: () => set({ sel: c.id, armed: null, mode: null, targets: [], tokens: [], text: "" }) } }, face(c.img, c.name)))) : null,
    !d.chars.length ? face(w.img, w.name, "ita-face.itd-face") : null,
    h("div.itd-id", {},
      h("span.itd-nameline", {}, h("span.itd-name", { text: w.name }), w.zone ? h("span.itd-zone", { tip: w.zone.tip, attrs: { tabindex: "0", "aria-label": w.zone.tip } }, icon("fa-location-dot"), h("span", { text: w.zone.label })) : null),
      h("div.itd-pips", { attrs: { role: "group" } }, d.pips.map(pip), d.extras.map((x) => h(`span.itd-extra`, { text: x.label, tip: x.tip || null, data: { kind: x.kind } })), w.free ? h("span.itd-extra", { text: w.freeLabel, data: { kind: "free" } }) : null)));
}
function actionBtn(a) {
  /* P5: the rows of the action tables that are not on the bar open as a list */
  if (a.more) { const m = a.mode ?? "menu";      // "More actions", and (P6) the character's own abilities: one button each, a list behind it
    return h(`button.itd-ghost.itd-more${a.armed ? ".itd-armed" : ""}`, { fk: `more:${m}`, tip: a.tip, attrs: { "aria-pressed": String(!!a.armed), "aria-haspopup": "true" },
      on: { click: () => set(last?.ui?.mode === m ? { mode: null } : { mode: m, armed: null, targets: [], tokens: [], text: "", amend: null, endArmed: false, weapon: null, opts: {}, choice: null }) } }, icon(m === "kit" ? "fa-bolt" : "fa-ellipsis"), h("span", { text: a.label })); }
  return h(`button.itd-act${a.armed ? ".itd-armed" : ""}`, { fk: `act:${a.id}`, data: { urgent: a.urgent ? "1" : null }, disabled: !!a.disabled, clickWhenDisabled: true, tip: a.disabled ? a.disabled : a.costText, attrs: { "aria-pressed": String(!!a.armed), "aria-label": [a.label, a.costText, a.disabled].filter(Boolean).join(", ") },
    on: { click: () => set(a.armed ? { armed: null, mode: null } : { armed: a.id, mode: null, targets: [], tokens: [], text: "", amend: null, endArmed: false, weapon: null, opts: {} }) } }, costIcon(a.cost) ?? (GLYPH[a.glyph] ? icon(GLYPH[a.glyph]) : null), h("span", { text: a.label }));
}
function bar(d) {
  const e = d.end;
  return h("div.itd-bar", {},
    whoBlock(d),
    d.rest ? h("button.itd-peek", { fk: "peek", tip: handlers.label?.("peek"), on: { click: () => set({ peek: true }) } }, icon("fa-chevron-up")) : [
      d.groups.map((g) => h("div.itd-group", { attrs: { role: "group", "aria-label": g.label } }, g.items.map(actionBtn))),
      h("div.itd-tail", {},
        h(`button.itd-ghost${d.other.armed ? ".itd-armed" : ""}`, { fk: "other", tip: `${d.other.label}: ${d.other.tip}`, attrs: { "aria-pressed": String(d.other.armed), "aria-label": d.other.label }, on: { click: () => set(d.other.armed ? { mode: null } : { mode: "other", armed: null, text: "", endArmed: false }) } }, icon("fa-pen"), h("span", { text: d.other.label })),
        h(`button.itd-ghost${d.holdOff.armed ? ".itd-armed" : ""}`, { fk: "hold", disabled: !!d.holdOff.disabled, tip: `${d.holdOff.label}: ${d.holdOff.disabled ?? d.holdOff.tip}`, attrs: { "aria-pressed": String(d.holdOff.armed), "aria-label": d.holdOff.label }, on: { click: () => set(d.holdOff.armed ? { mode: null } : { mode: "holdOff", armed: null, endArmed: false }) } }, icon("fa-hourglass-half"), h("span", { text: d.holdOff.label })),
        h(`button.itd-end${e.armed ? ".itd-end-sure" : ""}`, { fk: "end", disabled: !!e.disabled, tip: e.tip, on: { click: () => (e.confirm && !e.armed ? set({ endArmed: true }) : e.req && send(e.req, { endArmed: false })) } }, icon("fa-forward-step"), h("span", { text: e.label })),
        d.canRest ? h("button.itd-peek", { fk: "peek", tip: handlers.label?.("cancel"), on: { click: () => set({ peek: false, armed: null, mode: null }) } }, icon("fa-chevron-down")) : null),
    ]);
}

const OPT_ICON = { wreck: "fa-house-crack", area: "fa-burst", fullAuto: "fa-ellipsis" };
const close = () => set({ armed: null, mode: null, targets: [], tokens: [], text: "", amend: null, weapon: null, opts: {} });
const textBox = (value, placeholder, key = "text") => h("textarea.itd-text", { fk: `draft:${key}`, text: value, attrs: { rows: 2, maxlength: 300, placeholder, "aria-label": placeholder }, on: { input: (e, el) => set({ [key]: el.value }) } });
const submit = (s, cls = "") => h(`button.itd-go${cls}`, { fk: `go${cls}`, text: s.label, disabled: !!s.disabled, tip: s.disabled, on: { click: () => s.req && send(s.req, { armed: null, mode: null, targets: [], tokens: [], text: "", amend: null, weapon: null, opts: {} }) } });
const cancelBtn = () => h("button.itd-x", { fk: "x", tip: handlers.label?.("cancel"), on: { click: close } }, icon("fa-xmark"));
const head = (p) => h("header.itd-phead", {}, h("h3.ita-plate", { text: p.title }), p.cost ? h("span.itd-cost", { text: p.cost }) : null, cancelBtn());

function meter(c) {
  return h("div.itd-chance", {}, h("span.itd-k", { text: handlers.label?.("chance") }),
    h("span.itd-meter", { data: { level: c.level }, attrs: { role: "img", "aria-label": c.text } }, [0, 1, 2, 3].map((i) => h(`i${i <= c.level ? ".on" : ""}`))), h("b.itd-band", { text: c.text }),
    c.defended ? h("span.itd-def", {}, h("span", { text: `${c.defended.label}: ` }), h("b", { text: c.defended.text })) : null);
}
/* one way to make a move / one door: the name, what it costs, and when it cannot be done the reason (a click then opens the way to ask) */
const wayRow = (r) => h(`button.itd-way${r.asking ? ".itd-armed" : ""}`, { fk: `way:${r.id}`, disabled: !!r.disabled, clickWhenDisabled: true, data: { warn: r.warn ? "1" : null },
  attrs: { "aria-label": [r.label, ...r.notes, r.disabled].filter(Boolean).join(", "), "aria-pressed": r.disabled ? String(!!r.asking) : null },
  on: { click: () => (r.disabled ? set({ ask: r.asking ? null : r.id, why: "" }) : r.req && send(r.req, { armed: null, mode: null, to: null, ask: null, why: "" })) } },
  costIcon(r.cost), h("span.itd-way-l", { text: r.label }), h("span.itd-way-n", { text: r.notes.join(" · ") }), r.disabled ? h("span.itd-way-why", {}, icon("fa-ban"), h("span", { text: r.disabled })) : null);
const askRow = (a) => (a ? h("div.itd-pbody.itd-refused", {}, a.reason ? h("p.itd-reason", {}, icon("fa-ban"), h("span", { text: a.reason })) : null,
  a.text !== null ? h("div.itd-col.itd-grow", {}, textBox(a.text, a.placeholder, "why")) : null,
  h("div.itd-col.itd-submit", {}, submit(a.submit, ".itd-go-ask"))) : null);
function movePanel(p) {
  return h("section.itd-panel", { data: { kind: p.kind, picking: p.picking && !p.near.length ? "1" : null } },
    /* U5: the instruction rides in the head, so the panel over the map is two short rows while a zone is picked */
    h("header.itd-phead", {}, h("h3.ita-plate", { text: p.title }), p.dest ? h("span.itd-arrow", {}, icon("fa-arrow-right"), h("b", { text: p.dest.label })) : null,
      p.hint ? h("p.itd-hint.itd-hint-head", {}, icon("fa-map-location-dot"), h("span", { text: p.hint })) : null, cancelBtn()),
    p.empty ? h("div.itd-pbody", {}, h("p.itd-reason", {}, icon("fa-ban"), h("span", { text: p.empty }))) : null,
    p.dest ? h("div.itd-pbody", {}, h("div.itd-ways", { attrs: { role: "group", "aria-label": p.dest.label } }, p.dest.rows.map(wayRow)),
      h("div.itd-col.itd-submit", {}, h("button.itd-ghost", { fk: "again", on: { click: () => set({ to: null, ask: null, why: "" }) } }, icon("fa-map-location-dot"), h("span", { text: p.dest.again })))) : null,
    p.near.length ? h("div.itd-pbody.itd-near", {}, h("span.itd-k", { text: p.nearLabel }), h("div.itd-ways", { attrs: { role: "group", "aria-label": p.nearLabel } }, p.near.map(wayRow))) : null,
    askRow(p.ask));
}
function doorPanel(p) {
  return h("section.itd-panel", { data: { kind: p.kind } }, head(p),
    p.empty ? h("div.itd-pbody", {}, h("p.itd-hint", {}, icon("fa-door-closed"), h("span", { text: p.empty }))) : h("div.itd-pbody", {}, h("div.itd-ways", { attrs: { role: "group", "aria-label": p.title } }, p.rows.map(wayRow))),
    askRow(p.ask));
}
/* P7: the ways of a challenge, one chip each, grouped by what they work on; the last chip is an idea of the player's own */
function approach(a) {
  const chip = (key, label, on, tip, patch, dim = false) => h(`button.itd-chip.itd-chip-plain${dim ? ".itd-chip-dim" : ""}`, { fk: `ap:${key}`, tip, attrs: { "aria-pressed": String(!!on) }, on: { click: () => set(patch) } }, h("span", { text: label }));
  return h("div.itd-col.itd-approach", {}, h("span.itd-k", { text: a.label }),
    a.groups.map((g) => h("div.itd-apg", { attrs: { role: "group", "aria-label": g.label } }, h("span.itd-apn", { text: g.label }), h("div.itd-chips", {}, g.rows.map((r) => chip(r.id, r.label, r.picked, r.tip, { opt: r.id }, r.dim))))),
    a.own.lone ? null : h("div.itd-chips", {}, chip("own", a.own.label, a.own.picked, a.own.tip, { opt: "own" })),
    a.own.attrs ? h("div.itd-apg.itd-apg-wide", { attrs: { role: "group", "aria-label": a.own.attrLabel } }, h("span.itd-apn", { text: a.own.attrLabel }), h("div.itd-chips", {}, a.own.attrs.map((x) => chip(`at:${x.id}`, x.label, x.picked, null, { attr: x.id })))) : null);
}
function panel(p) {
  if (!p) return null;
  if (p.kind === "move") return movePanel(p);
  if (p.kind === "door") return doorPanel(p);
  if (p.kind === "menu") return h("section.itd-panel", { data: { kind: p.kind } }, h("header.itd-phead", {}, h("h3.ita-plate", { text: p.title }), cancelBtn()),
    h("div.itd-pbody", {}, h("div.itd-ways.itd-menu", { attrs: { role: "group", "aria-label": p.title } }, p.rows.map((r) => h("button.itd-way", { fk: `menu:${r.id}`, disabled: !!r.disabled, clickWhenDisabled: true,
      attrs: { "aria-label": [r.label, ...r.notes, r.disabled].filter(Boolean).join(", ") }, on: { click: () => set({ armed: r.id, mode: null, targets: [], tokens: [], text: "", amend: null, endArmed: false, weapon: null, opts: {}, choice: null }) } },
      costIcon(r.cost), h("span.itd-way-l", { text: r.label }), h("span.itd-way-n", { text: r.notes.join(" · ") }), r.disabled ? h("span.itd-way-why", {}, icon("fa-ban"), h("span", { text: r.disabled })) : null))),
      (p.foot ?? []).map((x) => h("p.itd-hint.itd-foot", {}, icon("fa-hand"), h("span", { text: x })))));
  if (p.kind === "declare") {
    const toggle = (key, id, max = 1) => { const cur = (last.ui?.[key] ?? []).slice(); const i = cur.indexOf(id); if (i >= 0) cur.splice(i, 1); else { cur.push(id); while (cur.length > max) cur.shift(); } set({ [key]: cur }); };
    return h("section.itd-panel", { data: { kind: p.kind } }, head(p),
      p.refused ? h("div.itd-pbody.itd-refused.itd-refused-top", {}, h("p.itd-reason", {}, icon("fa-ban"), h("span", { text: p.refused.reason })),
        p.refused.text !== null ? h("div.itd-col.itd-grow", {}, textBox(p.refused.text, p.refused.placeholder, "why")) : null,
        h("div.itd-col.itd-submit", {}, submit(p.refused.submit, ".itd-go-ask"))) : null,
      h("div.itd-pbody", {},
        p.choice ? h("div.itd-col.itd-attrs", {}, h("span.itd-k", { text: p.choice.label }),
          h("div.itd-chips", { attrs: { role: "group", "aria-label": p.choice.label } }, p.choice.items.map((x) => h("button.itd-chip.itd-chip-plain", { fk: `ch:${x.id}`, attrs: { "aria-pressed": String(x.picked) }, on: { click: () => set({ choice: x.id }) } }, h("span", { text: x.label })))),
          p.choice.hint ? h("p.itd-hint", {}, icon("fa-user-shield"), h("span", { text: p.choice.hint })) : null) : null,
        p.targets ? h("div.itd-col.itd-targets", {}, h("span.itd-k", { text: handlers.label?.("target") }),
          h("div.itd-chips", { attrs: { role: "group" } }, p.targets.map((x) => h(`button.itd-chip${x.likely ? "" : ".itd-chip-dim"}`, { fk: `tg:${x.id}`, tip: x.note, attrs: { "aria-pressed": String(x.picked) }, on: { click: () => { toggle("targets", x.id, p.maxTargets ?? 1); handlers.target?.(x.id); } } }, face(x.img, x.name), h("span", { text: x.name })))),
          p.picking ? h("p.itd-hint", {}, icon("fa-crosshairs"), h("span", { text: handlers.label?.("pick.hint") })) : null,
          p.self ? h("p.itd-hint", {}, icon("fa-user"), h("span", { text: p.self })) : null) : null,
        p.weapons || p.opts?.length ? h("div.itd-col.itd-arms", {},
          p.weapons ? [h("span.itd-k", { text: p.weapons.label }), p.weapons.empty ? h("p.itd-hint", {}, icon("fa-ban"), h("span", { text: p.weapons.empty }))
            : h("div.itd-chips", { attrs: { role: "group", "aria-label": p.weapons.label } }, p.weapons.items.map((x) => h("button.itd-chip.itd-chip-arm", { fk: `wp:${x.id}`, tip: x.tip, attrs: { "aria-pressed": String(x.picked) }, on: { click: () => set({ weapon: x.id }) } }, h("span", { text: x.name }))))] : null,
          p.opts?.length ? h("div.itd-chips", { attrs: { role: "group" } }, p.opts.map((o) => h("button.itd-chip.itd-chip-opt", { fk: `op:${o.id}`, tip: o.tip, attrs: { "aria-pressed": String(o.on) }, on: { click: () => set({ opts: { ...(last.ui?.opts ?? {}), [o.id]: !o.on, ...(o.id === "area" && !o.on ? { fullAuto: false } : {}), ...(o.id === "fullAuto" && !o.on ? { area: false } : {}) } }) } }, icon(OPT_ICON[o.id] ?? "fa-circle"), h("span", { text: o.label })))) : null,
          (p.notes ?? []).map((n) => h("p.itd-hint", {}, icon("fa-circle-info"), h("span", { text: n })))) : null,
        p.attrs ? h("div.itd-col.itd-attrs", {}, h("span.itd-k", { text: p.attrs.label }),
          h("div.itd-chips", { attrs: { role: "group", "aria-label": p.attrs.label } }, p.attrs.items.map((x) => h("button.itd-chip.itd-chip-attr", { fk: `at:${x.id}`, attrs: { "aria-pressed": String(x.picked) }, on: { click: () => set({ attr: x.picked ? null : x.id }) } }, x.dice != null ? h("b", { text: String(x.dice) }) : null, h("span", { text: x.label })))),
          p.attrs.hint ? h("p.itd-hint", { text: p.attrs.hint }) : null) : null,
        p.approach ? approach(p.approach) : null,
        p.dest ? h("div.itd-col", {}, h("span.itd-k", { text: p.dest.label }), p.dest.value ? h("b.itd-destv", { text: p.dest.value }) : null,
          h("button.itd-ghost", { fk: "dest", on: { click: () => handlers.zonePick?.() } }, icon("fa-map-location-dot"), h("span", { text: p.dest.pick }))) : null,
        p.text ? h("div.itd-col.itd-grow", {}, textBox(p.text.value, p.text.placeholder)) : null,
        p.pool || p.tokens.length ? h("div.itd-col", {},
          p.pool ? h("div.itd-pool", {}, h("span.itd-k", { text: handlers.label?.("pool") }), h("b.itd-dice", { text: String(p.pool.total) }), h("span.itd-parts", { text: p.pool.parts.map((x) => `${x.label} ${x.dice > 0 && x !== p.pool.parts[0] ? "+" : ""}${x.dice}`).join(" · ") })) : null,
          p.tokens.length ? h("div.itd-chips", {}, p.tokens.map((k) => h("button.itd-chip.itd-chip-token", { fk: `tk:${k.id}`, tip: k.source, attrs: { "aria-pressed": String(k.picked) }, on: { click: () => toggle("tokens", k.id, 12) } }, icon("fa-dice-d6"), h("span", { text: `${k.label} ${k.source}` })))) : null,
          p.chance ? meter(p.chance) : null) : null,
        h("div.itd-col.itd-submit", {}, submit(p.submit), p.submit.disabled ? h("span.itd-why", { text: p.submit.disabled }) : null)));
  }
  if (p.kind === "blocked") return h("section.itd-panel", { data: { kind: p.kind } }, head(p), h("div.itd-pbody", {}, h("p.itd-reason", {}, icon("fa-ban"), h("span", { text: p.reason })), h("div.itd-col.itd-grow", {}, textBox(p.text, p.placeholder)), h("div.itd-col.itd-submit", {}, submit(p.submit, ".itd-go-ask"))));
  if (p.kind === "other") return h("section.itd-panel", { data: { kind: p.kind } }, head(p), h("div.itd-pbody", {}, h("div.itd-col.itd-grow", {}, textBox(p.text, p.placeholder), h("p.itd-hint", { text: p.hint })), h("div.itd-col.itd-submit", {}, submit(p.submit, ".itd-go-ask"))));
  if (p.kind === "holdOff") return h("section.itd-panel", { data: { kind: p.kind } }, head(p), h("div.itd-pbody", {}, h("p.itd-hint", { text: p.hint }),
    h("div.itd-chips", {}, p.targets.map((x) => h("button.itd-chip.itd-chip-card", { fk: `ho:${x.slot}`, on: { click: () => send(x.req, { mode: null }) } }, h("b", { text: String(x.card ?? "?") }), h("span", { text: x.names }))))));
  /* the own action in progress */
  return h("section.itd-panel", { data: { kind: "mine", rolling: p.rolling ? "1" : null } },
    h("header.itd-phead", {}, h("h3.ita-plate", { text: p.title }), p.targets.length ? h("span.itd-arrow", {}, icon("fa-arrow-right"), h("b", { text: p.targets.join(", ") })) : null),
    h("div.itd-pbody", {}, h("p.itd-status", {}, icon(p.rolling ? "fa-dice" : "fa-hourglass-half"), h("span", { text: p.status })), p.text ? h("blockquote.ita-quote", {}, h("span", { text: p.text })) : null,
      h("div.itd-col.itd-submit", {}, p.commands.map((c) => h("button.itd-ghost", { fk: `cmd:${c.id}`, text: c.label, on: { click: () => (c.amend ? handlers.amend?.(p) : c.req && send(c.req)) } })))));
}

/* ---------- render ---------- */
export function render(d, ui = {}) {
  try { draw(d, ui); } catch (e) { console.warn("invincible-plus-ultra | tactics dock", e); }
}
function draw(d, ui) {
  last = { d, ui };
  const any = d?.show || d?.prompts?.length;
  if (!any) return hide();
  ensure(handlers.label?.("dock") ?? "");
  root.classList.toggle("itd-turn", !!d.onTurn);
  root.classList.toggle("itd-rest", !!d.rest);
  /* the panel rises once, when it opens: a rebuild of the same panel (a key typed in its text box, a target picked) must not play the
     entry again, whose first frames clip the top of the panel, where the request to the GM is */
  const pk = d.show && d.panel ? `${d.panel.kind}|${d.panel.action ?? ""}` : null;
  root.classList.toggle("itd-same", pk !== null && pk === panelKey);
  panelKey = pk;
  const askH = { send: (req) => send(req), pick: handlers.pick, text: handlers.text, always: handlers.always, zone: handlers.zone, again: handlers.again };
  swap(stack, [
    d.prompts?.length ? h("div.itd-asks", {}, d.prompts.map((a) => askCard(a, askH))) : null,
    d.show ? panel(d.panel) : null,
    d.show ? bar(d) : null,
    /* the line under the bar: whose turn, who the table waits for; and, only while there is one, the roll this user owes or may push
       (U1 / U2: its buttons are here, not on a chat toast) and the last thing the table was told (U10 / U3: one chip, the older lines in
       its tooltip, put away with its x) */
    d.show && (d.waiting?.length || d.turn || d.rolls?.length || d.news) ? h("div.itd-wait", { attrs: { role: "status" } },
      (d.rolls ?? []).map((r) => rollChip(r, { roll: handlers.roll, send: (req) => send(req) })),
      d.turn ? h("span.itd-turnline", { text: d.turn }) : null, waitRest(d).length ? [h("span.itd-k", { text: handlers.label?.("waitingFor") }), waitChips(waitRest(d))] : null,
      d.news ? h("span.itd-news", { data: { tone: d.news.tone }, tip: [d.news.text, ...d.news.older].join("<br>") }, icon("fa-bullhorn"), h("span.itd-news-t", { text: d.news.text }),
        h("button.itd-news-x", { fk: "news:x", tip: d.news.label, attrs: { "aria-label": d.news.label }, on: { click: () => set({ newsSeen: d.news.seen }) } }, icon("fa-xmark"))) : null) : null,
  ]);
  place();
  reveal();
}
/* who the table waits for, without this client's own roll while its chip (with the buttons) already says it */
const waitRest = (d) => (d.rolls?.length ? (d.waiting ?? []).filter((w) => !w.mine || w.what.length > d.rolls.length) : d.waiting ?? []);
function reveal() {
  clearTimeout(hideTimer);
  if (shown) return;
  shown = true;
  root.style.visibility = "";
  requestAnimationFrame(() => requestAnimationFrame(() => root?.classList.remove("itd-hidden")));
}
export function hide() {
  if (!root || !shown) return;
  shown = false;
  root.classList.add("itd-hidden");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { if (root && !shown) root.style.visibility = "hidden"; }, 320);
}
export const relayout = () => { if (root && shown) place(); };
export const el = () => root;
export const isShown = () => shown;
export function destroy() { clearTimeout(hideTimer); root?.remove(); root = stack = null; shown = false; last = null; }
