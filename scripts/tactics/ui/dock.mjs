/* Tactical combat, the surfaces: THE ACTION DOCK (the player's surface; the same dock serves the GM driving an NPC). DOM + placement only:
   main.mjs hands over the render data of model-pure.dockData and receives clicks through configure({ ... }). No Foundry documents here.
   WHERE (U28): at the bottom edge, centred in the free part of the window. Foundry's macro bar is folded away while the dock is up
   (body.ita-tactics, styles/tactics-ui.css; the keyboard button on the dock brings it back, and then the dock stands above it as
   before). Pushed clear of the party column and the map's panels (left), of the sidebar, the chat notifications and the GM desk
   (right). The map's director bar and the chat box of a folded sidebar keep the bottom edge: the dock stands between them when its
   bar fits there (in one row or in two), else above them (place()).
   ONE ROW (U29), read like the unit bar of a tactics game, left to right:
     UNIT    face, name, zone; Health and Resolve as two bars with their numbers
     SLOTS   the two slots of a turn (U31): the long one is the full action (or a second quick one), the short one the quick action; a
             further one only when the character has it; then bonus dice and statuses as small chips
     ACTIONS one picture per action, in the groups of the rules, each carrying THE MARK OF SPEED (dom.speed: long bar = full action,
             short bar = quick action, an open ring = no action) and its Resolve price; the name, the price in words and the reason of a greyed
             one are the tooltip (hover and keyboard focus) and the aria-label; a click arms it and the panel's head says it again
     TAIL    Something else, Hold off, the macro bar, End turn
   When the row does not fit (data-tight, measured in place()), the actions take a row of their own over the unit; in the narrowest
   room (data-tight="2") the tail takes a third.
   COST PREVIEW (U30): hovering or focusing anything that carries `pv` (an action, a row of a list, a way of moving, an answer on a
   card, Declare) lights the slot it would spend and shows the Resolve it would cost on the Resolve bar. Only for the character the
   dock drives; nothing is rebuilt for it (attributes on the unit block).
   STRUCTURE (bottom up):  the bar  <  the status line (who else the table waits for, the last news; never whose turn it is: the
   initiative bar says that)  <  the panel of
   the armed action  <  the questions asked of this user. The panel and the questions scroll inside what is left under the initiative bar.
     panel: declare (target chips + map pick, dice, chance band, Declare) | blocked (reason + ask the GM) | a list (More actions,
            Abilities: rows by kind) | something else | hold off | the own action in progress (what it waits for, change / cancel)
   RESTING (not the user's turn, nothing armed, nothing asked): the unit and its slots; the chevron opens the bar to look or to ask for
   an exception. A question addressed to the user always shows, whoever's turn it is. */
import { h, icon, swap, face, speed, actIcon, tipText, askCard, waitChips, rollChip, visibleRect } from "./dom.mjs";

const ID = "invincible-tactics-dock";
const GAP = 6;
const EDGE = 6;          // px between the dock and the bottom edge of the window
const BAR_BAND = 126;    // px of height the bar itself may take (two rows and the status line): the band its own room is measured in
const TWO_ROWS = 500;    // px the two-row dock needs between what lies on the bottom edge; with less it stands above those things
/* what lies on the bottom edge besides the dock: the map's director bar (GM), the chat box Foundry floats there while the sidebar is folded */
const LOW_OBSTACLES = "#mm-dir-bar, #chat-notifications #chat-message, #chat-notifications .chat-form";
/* what hangs from the top of the window and must stay readable above the dock: the initiative bar's tiles and their pip tabs, the map's orbit strip */
const TOP_OBSTACLES = "#invincible-combat-bar .icbar-tile, #invincible-combat-bar .icbar-acts:not([hidden]), #invincible-combat-bar .icbar-gma:not([hidden]), #mm-orbit-strip";
/* panels of other modules at the left edge that reach down into the dock's band (the map's pins / filter panel, its VRAM meter) */
const LEFT_OBSTACLES = ".mm-filter, #mm-vram";
let root = null, stack = null, handlers = {}, shown = false, hideTimer = 0, last = null, panelKey = null, underTop = null;

export function configure(x) { handlers = x ?? {}; }
const set = (patch) => handlers.set?.(patch);
const send = (req, after) => handlers.send?.(req, after);

function ensure(label) {
  if (root?.isConnected) return;
  root = h(`div.itd-hidden`, { attrs: { id: ID, role: "region", "aria-label": label }, data: { tooltipDirection: "UP", tooltipClass: "ita-tip" } });
  stack = h("div.itd-stack");
  root.append(stack);
  /* U30: the cost preview follows the pointer and the keyboard focus; a tooltip opens for the keyboard as it does for the pointer */
  root.addEventListener("pointerover", (e) => preview(e.target));
  root.addEventListener("pointerout", (e) => { if (!root.contains(e.relatedTarget) || !e.relatedTarget?.closest?.("[data-pv]")) preview(null); });
  root.addEventListener("focusin", (e) => { preview(e.target); try { const el = e.target.closest?.("[data-tooltip], [data-tooltip-html]"); if (el?.matches(":focus-visible")) handlers.tipShow?.(el); } catch { /* a courtesy */ } });
  root.addEventListener("focusout", () => { preview(null); try { handlers.tipHide?.(); } catch { /* a courtesy */ } });
  /* Tab walks the buttons of the surface: Foundry's own key handler (on the window) would take it for "next token" */
  root.addEventListener("keydown", (e) => { if (e.key === "Tab") e.stopPropagation(); });
  document.body.appendChild(root);
}

/* ---------- U30: the cost of what is under the pointer, on the slots and on the Resolve bar ---------- */
function preview(from) {
  try {
    if (!stack) return;
    const el = from?.closest?.("[data-pv]") ?? null, who = last?.d?.who?.id ?? null;
    const on = el && el.getAttribute("aria-disabled") !== "true" && (!el.dataset.pvFor || el.dataset.pvFor === who) ? el : null;
    for (const s of stack.querySelectorAll(".itd-slot")) { if (on && s.dataset.key === on.dataset.pvSlot) s.dataset.pv = on.dataset.pvForfeits ? "forfeit" : "1"; else delete s.dataset.pv; }
    const rs = stack.querySelector('.itd-vital[data-id="resolve"]');
    if (rs) {
      const n = on ? Math.min(Number(on.dataset.pvStress) || 0, Number(rs.dataset.v) || 0) : 0;
      if (n > 0) { rs.dataset.pv = "1"; rs.style.setProperty("--itd-pv", String(n)); rs.querySelector(".itd-vdelta").textContent = `-${n}`; }
      else { delete rs.dataset.pv; rs.style.removeProperty("--itd-pv"); rs.querySelector(".itd-vdelta").textContent = ""; }
    }
  } catch { /* a courtesy */ }
}

/* ---------- placement ---------- */
export function place() {
  if (!root) return;
  const W = window.innerWidth, H = window.innerHeight;
  const hot = visibleRect(document.getElementById("hotbar"));
  const ground = hot && hot.top > H * 0.4 ? hot.top : H - EDGE + GAP;
  /* the room above the dock: down from the lowest thing that hangs from the top over the middle of the window */
  let ceil = 8;
  for (const el of document.querySelectorAll(TOP_OBSTACLES)) { const r = visibleRect(el); if (r && r.top < H * 0.4 && r.bottom < H * 0.5 && r.right > W * 0.25 && r.left < W * 0.75) ceil = Math.max(ceil, r.bottom + 8); }
  /* the free band between what stands at the sides, for a dock whose bottom is at `floor` */
  let deskOff = false;
  const sides = (floor, tall = stack.offsetHeight || 60, bar = false) => {
    let lo = 12, hi = W - 12;
    const yBot = floor - GAP, yTop = yBot - Math.min(tall, Math.max(150, yBot - ceil)) - 4, inBand = (r) => r && r.top < yBot && r.bottom > yTop;
    const sb = visibleRect(document.getElementById("sidebar"));
    if (sb && sb.left > W * 0.5) hi = Math.min(hi, sb.left - 12);
    for (const m of document.querySelectorAll("#chat-notifications .chat-message")) { const r = visibleRect(m); if (inBand(r) && r.left > W * 0.3) hi = Math.min(hi, r.left - 10); }
    /* the open GM desk and a panel at the left edge that hangs lower than the top obstacles are kept clear of WHATEVER the dock's height
       is now: a dock that changed its width with every panel that opened made the buttons jump under the pointer (U6) */
    const low = (r) => r && r.bottom > ceil + 60 && r.top < floor;
    if (!(bar && deskOff)) for (const el of document.querySelectorAll("#invincible-tactics-desk .igd, #invincible-tactics-desk .igd-handle")) { const r = visibleRect(el); if ((el.classList.contains("igd") ? low(r) : inBand(r)) && r.left > W * 0.4) hi = Math.min(hi, r.left - 10); }
    const partyEl = document.getElementById("invincible-party"), party = visibleRect(partyEl);
    if (party && party.right < W * 0.5) {
      const kids = [...partyEl.querySelectorAll(".ipt-item")].map(visibleRect).filter(inBand);
      if (kids.length || inBand(party)) lo = Math.max(lo, Math.max(party.right, ...kids.map((k) => k.right)) + 10);
    }
    /* Foundry's players list: its box is narrower than the lists inside it */
    for (const el of document.querySelectorAll("#players, #players > *")) { const r = visibleRect(el); if (inBand(r) && r.right < W * 0.3) lo = Math.max(lo, r.right + 8); }
    /* a panel of the map at the left edge counts once it reaches the lower half of the window, or the dock's stack has grown up to it:
       the bar itself lies on the bottom edge now, far under the pins panel, and must not give up its one row for it */
    for (const el of document.querySelectorAll(LEFT_OBSTACLES)) { const r = visibleRect(el); if (r && r.right < W * 0.4 && r.top < floor && (r.bottom > H * 0.5 || inBand(r))) lo = Math.max(lo, r.right + 8); }
    return { lo, hi, floor };
  };
  /* WHAT LIES ON THE BOTTOM EDGE besides the dock: the map's director bar (GM, left) and the chat box of a folded sidebar (right). The
     dock stands BETWEEN them, in one row when that fits and in two when not (two rows on the edge take no more of the map than one
     row lifted over those things, and less of its width); only when even two rows have no room there does it stand ABOVE them. */
  const barEl = stack.querySelector(".itd-bar");
  delete root.dataset.tight;
  const natural = barEl ? barEl.scrollWidth + 2 : 0;
  /* U48: THE BOTTOM EDGE IS THE BAR'S. Where the open GM desk would squeeze the bar into three rows (a 1366 px window with the sidebar
     open too), the bar takes the edge under the desk instead and the desk ends above it (desk.mjs reads data-under); the panel and the
     questions above the bar still keep clear of the desk. Tried only when the first pass ends in three rows. */
  const deskOpen = !!visibleRect(document.querySelector("#invincible-tactics-desk .igd"));
  for (const off of [false, true]) {
  deskOff = off; delete root.dataset.tight;
  const lows = [], wide = sides(ground, BAR_BAND, true);
  for (const el of document.querySelectorAll(LOW_OBSTACLES)) { const r = visibleRect(el); if (r && r.height < 90 && r.bottom > ground - 70 && r.top < ground && r.right > wide.lo && r.left < wide.hi) lows.push(r); }
  const between = (A) => {
    const mid = (A.lo + A.hi) / 2, B = { ...A };
    for (const r of lows) { if ((r.left + r.right) / 2 < mid) B.lo = Math.max(B.lo, r.right + 10); else B.hi = Math.min(B.hi, r.left - 10); }
    return B;
  };
  /* THE BAR keeps the room of its own height: a panel that opens above it reaches up beside other things (the party, the players
     list), and a bar that folded into two rows for that made its buttons jump under the pointer. The panel and the questions get
     the narrower room of the whole stack and are shifted into it (--itd-up-dx). */
  let pick = wide, up = sides(ground);
  if (lows.length) {
    const B = between(wide);
    if (B.hi - B.lo >= Math.min(natural, TWO_ROWS)) { pick = B; up = between(up); }
    else { const f = Math.min(ground, ...lows.map((r) => r.top)); pick = sides(f, BAR_BAND, true); up = sides(f); }
  }
  up = { lo: Math.max(up.lo, pick.lo), hi: Math.min(up.hi, pick.hi) };
  const { lo, hi, floor } = pick;
  const bottom = H - floor + GAP;
  const room = Math.max(150, H - bottom - ceil);
  root.style.setProperty("--itd-room", `${Math.round(room)}px`);
  const avail = Math.max(280, hi - lo);
  root.style.setProperty("--itd-bottom", `${Math.round(bottom)}px`);
  root.style.setProperty("--itd-maxw", `${Math.round(avail)}px`);
  root.style.setProperty("--itd-up-maxw", `${Math.round(Math.max(280, Math.min(avail, up.hi - up.lo)))}px`);
  /* one row when it fits; else the actions go under the unit (measured above, with the row laid out unbroken) */
  if (natural > avail) { root.dataset.tight = "1"; if ([".itd-unit", ".itd-slots", ".itd-tail"].reduce((n, q) => n + (barEl.querySelector(q)?.offsetWidth ?? 0), 44) > avail) root.dataset.tight = "2"; }      // "2": even the unit and the tail do not share a row (a 1366 px window with the sidebar and the desk open)
  /* the panel and the questions share what is left above the bar: the panel takes what it needs first (it is what the user is doing),
     the questions the rest; each scrolls inside its share */
  const part = (sel) => stack.querySelector(sel)?.offsetHeight ?? 0;
  const fixed = part(".itd-bar") + part(".itd-wait") + 2 * GAP, asks = stack.querySelector(".itd-asks"), panelEl = stack.querySelector(".itd-panel");
  const above = Math.max(120, room - fixed);
  const panelMax = asks && panelEl ? Math.max(110, Math.round(above * 0.6)) : above;
  root.style.setProperty("--itd-panel-maxh", `${Math.round(panelMax)}px`);
  root.style.setProperty("--itd-maxh", `${Math.max(110, Math.round(above - (panelEl ? Math.min(panelEl.scrollHeight + 4, panelMax) + GAP : 0)))}px`);
  /* what floats at the bottom centre besides the dock (the module's end-of-session notice) stands above it: styles/tactics-ui.css */
  try {
    const clear = Math.round(bottom + Math.min(fixed - GAP, room) + 10);
    document.body.style.setProperty("--itd-clear", `${clear}px`);
    /* U47: the notice stands right above the bar; while a panel or a question is open over the bar it waits (it would float over the
       middle of the map, above what the user is doing) */
    document.body.classList.toggle("ita-notice-wait", !!(panelEl || asks) || H - clear - 64 < ceil);
  } catch { /* no body */ }
  const w = Math.min(stack.offsetWidth, avail);
  let cx = hot ? (hot.left + hot.right) / 2 : (lo + hi) / 2;
  if (cx + w / 2 > hi) cx = hi - w / 2;
  if (cx - w / 2 < lo) cx = lo + w / 2;
  root.style.setProperty("--itd-cx", `${Math.round(cx)}px`);
  let dx = 0;
  for (const el of stack.querySelectorAll(":scope > :is(.itd-panel, .itd-asks)")) { const pw = el.offsetWidth; dx = Math.max(dx, up.lo - (cx - pw / 2)); if (cx + dx + pw / 2 > up.hi) dx = Math.min(dx, up.hi - pw / 2 - cx); }
  root.style.setProperty("--itd-up-dx", `${Math.round(dx)}px`);
  if (root.dataset.tight !== "2" || !deskOpen) break;
  }
  const under = deskOff && deskOpen, top = under ? Math.round(barEl?.getBoundingClientRect().top ?? 0) : null;
  if (under) root.dataset.under = "1"; else delete root.dataset.under;
  if (top !== underTop) { underTop = top; handlers.deskRelayout?.(); }
}

/* ---------- pieces ---------- */
const keyAttrs = (key) => (key ? { "aria-keyshortcuts": key } : {});
const slot = (p) => h("button.itd-slot", { fk: `slot:${p.key}`, tip: p.tip, disabled: !p.req, data: { key: p.key, kind: p.kind, state: p.state, as: p.as, extra: p.extra ? "1" : null }, attrs: { "aria-label": p.tip }, on: { click: () => p.req && send(p.req) } }, h("i"));
const vital = (v) => h("div.itd-vital", { data: { id: v.id, v: v.v }, attrs: { role: "img", "aria-label": v.say, style: `--itd-v:${v.v};--itd-max:${v.max}` } },
  icon(v.id === "health" ? "fa-heart" : "fa-bolt"), h("span.itd-vbar", {}, h("i.itd-vfill"), h("i.itd-vpv")), h("b.itd-vnum", {}, h("span", { text: String(v.v) }), h("small", { text: `/${v.max}` })), h("b.itd-vdelta"));

const nameParts = (name) => { const m = /^(.*\S)\s+(#\d+)$/.exec(String(name ?? "")); return m ? [h("span.itd-name", { text: m[1] }), h("b.itd-nameno", { text: m[2] })] : h("span.itd-name", { text: name }); };
function unit(d) {
  const w = d.who;
  return [h("div.itd-unit", {},
    d.chars.length ? h("div.itd-chars", { attrs: { role: "group" } }, d.chars.map((c) => h(`button.itd-char${c.onTurn ? ".itd-char-turn" : ""}${c.asked ? ".itd-char-asked" : ""}`, { fk: `char:${c.id}`, tip: c.name, attrs: { "aria-pressed": String(c.sel) }, on: { click: () => set({ sel: c.id, armed: null, mode: null, targets: [], tokens: [], text: "" }) } }, face(c.img, c.name)))) : null,
    !d.chars.length ? face(w.img, w.name, "ita-face.itd-face") : null,
    h("div.itd-id", {},
      /* a namesake's number ("Turret #2") never falls to the ellipsis: it is what tells the two apart, and the bar is where the name stands */
      h("span.itd-nameline", {}, nameParts(w.name), w.zone ? h("span.itd-zone", { tip: w.zone.tip, attrs: { tabindex: "0", "aria-label": `${w.zone.say}. ${w.zone.tip}` } }, icon("fa-location-dot"), h("span", { text: w.zone.label })) : null),
      d.vitals.length ? h("div.itd-vitals", {}, d.vitals.map(vital)) : null)),
  h("div.itd-slots", { attrs: { role: "group", "aria-label": handlers.label?.("slots") } }, d.slots.map(slot),
    d.extras.map((x) => h(`span.itd-extra`, { text: x.label, tip: x.tip || null, data: { kind: x.kind }, attrs: x.tip ? { tabindex: "0" } : {} })), w.free ? h("span.itd-extra", { text: w.freeLabel, data: { kind: "free" } }) : null)];
}
const rs = (n) => (n ? h("b.ita-rs", { text: `-${n}`, attrs: { "aria-hidden": "true" } }) : null);
function actionBtn(a) {
  /* P5 / P6: the other rows of the action tables, and the character's own abilities: one button each, a list behind it */
  if (a.more) { const m = a.mode ?? "menu";
    return h(`button.itd-ic.itd-ic-more${a.armed ? ".itd-armed" : ""}`, { fk: `more:${m}`, tip: a.tip, data: { key: a.key ?? null }, attrs: { "aria-pressed": String(!!a.armed), "aria-haspopup": "true", "aria-label": a.label, ...keyAttrs(a.key) },
      on: { click: () => set(last?.ui?.mode === m ? { mode: null } : { mode: m, armed: null, targets: [], tokens: [], text: "", amend: null, endArmed: false, weapon: null, opts: {}, choice: null }) } }, actIcon(a.icon), icon("fa-caret-up")); }
  return h(`button.itd-ic${a.armed ? ".itd-armed" : ""}`, { fk: `act:${a.id}`, data: { urgent: a.urgent ? "1" : null, key: a.key ?? null }, disabled: !!a.disabled, clickWhenDisabled: true, tip: a.tip, pv: a.pv, attrs: { "aria-pressed": String(!!a.armed), "aria-label": tipText(a.tip), ...keyAttrs(a.key) },
    on: { click: () => set(a.armed ? { armed: null, mode: null } : { armed: a.id, mode: null, targets: [], tokens: [], text: "", amend: null, endArmed: false, weapon: null, opts: {} }) } }, actIcon(a.icon), speed(a.cost), rs(a.stress));
}
const hotbarBtn = (d) => h("button.itd-mini", { fk: "hotbar", tip: d.hotbar.tip ?? d.hotbar.label, attrs: { "aria-pressed": String(d.hotbar.open), "aria-label": d.hotbar.label }, on: { click: () => set({ hotbar: !d.hotbar.open }) } }, icon("fa-keyboard"));
function bar(d) {
  const e = d.end;
  return h("div.itd-bar", {},
    unit(d),
    d.rest ? h("div.itd-tail", {}, hotbarBtn(d), h("button.itd-mini", { fk: "peek", tip: handlers.label?.("peek"), on: { click: () => set({ peek: true }) } }, icon("fa-chevron-up"))) : [
      h("div.itd-acts", {}, d.out ? h("p.itd-out", { data: { reason: d.out.reason } }, icon(d.out.reason === "dead" ? "fa-skull" : d.out.reason === "unconscious" ? "fa-bed" : "fa-heart-crack"), h("span", { text: d.out.text })) : null, d.groups.map((g) => h("div.itd-group", { attrs: { role: "group", "aria-label": g.label } }, g.items.map(actionBtn)))),
      h("div.itd-tail", {},
        h(`button.itd-ic.itd-ic-ghost${d.other.armed ? ".itd-armed" : ""}`, { fk: "other", tip: d.other.tip, attrs: { "aria-pressed": String(d.other.armed), "aria-label": d.other.label }, on: { click: () => set(d.other.armed ? { mode: null } : { mode: "other", armed: null, text: "", endArmed: false }) } }, actIcon("@other")),
        h(`button.itd-ic.itd-ic-ghost${d.holdOff.armed ? ".itd-armed" : ""}`, { fk: "hold", disabled: !!d.holdOff.disabled, tip: d.holdOff.tip, attrs: { "aria-pressed": String(d.holdOff.armed), "aria-label": d.holdOff.label }, on: { click: () => set(d.holdOff.armed ? { mode: null } : { mode: "holdOff", armed: null, endArmed: false }) } }, actIcon("@hold")),
        h(`button.itd-end${e.armed ? ".itd-end-sure" : ""}`, { fk: "end", disabled: !!e.disabled, tip: e.tip, attrs: { "aria-label": `${e.label}. ${e.tip}`, "aria-keyshortcuts": "Space" }, on: { click: () => (e.confirm && !e.armed ? set({ endArmed: true }) : e.req && send(e.req, { endArmed: false })) } }, actIcon("@end"), h("span", { text: e.label })),
        hotbarBtn(d),
        d.canRest ? h("button.itd-mini", { fk: "peek", tip: handlers.label?.("cancel"), on: { click: () => set({ peek: false, armed: null, mode: null }) } }, icon("fa-chevron-down")) : null),
    ]);
}

const OPT_ICON = { wreck: "fa-house-crack", area: "fa-burst", fullAuto: "fa-ellipsis" };
const KIT_STATE = { auto: "fa-gears", assist: "fa-user-check", hand: "fa-hand", off: "fa-ban" };
const close = () => set({ armed: null, mode: null, targets: [], tokens: [], text: "", amend: null, weapon: null, opts: {} });
const textBox = (value, placeholder, key = "text") => h("textarea.itd-text", { fk: `draft:${key}`, text: value, attrs: { rows: 2, maxlength: 300, placeholder, "aria-label": placeholder }, on: { input: (e, el) => set({ [key]: el.value }) } });
const submit = (s, cls = "", pv = null, said = false) => h(`button.itd-go${cls}`, { fk: `go${cls}`, text: s.label, disabled: !!s.disabled, tip: said ? null : s.disabled, pv: s.disabled ? null : pv, on: { click: () => s.req && send(s.req, { armed: null, mode: null, targets: [], tokens: [], text: "", amend: null, weapon: null, opts: {} }) } });
const cancelBtn = () => h("button.itd-x", { fk: "x", tip: handlers.label?.("cancel"), on: { click: close } }, icon("fa-xmark"));
const head = (p) => h("header.itd-phead", {}, h("h3.ita-plate", { text: p.title }), p.cost ? h("span.itd-cost", {}, speed(p.unit), h("span", { text: p.cost })) : null, cancelBtn());

function meter(c) {
  return h("div.itd-chance", {}, h("span.itd-k", { text: handlers.label?.("chance") }),
    h("span.itd-meter", { data: { level: c.level }, attrs: { role: "img", "aria-label": c.text } }, [0, 1, 2, 3].map((i) => h(`i${i <= c.level ? ".on" : ""}`))), h("b.itd-band", { text: c.text }),
    c.defended ? h("span.itd-def", {}, h("span", { text: `${c.defended.label}: ` }), h("b", { text: c.defended.text })) : null);
}
/* one way to make a move / one door: the name, what it costs, and when it cannot be done the reason (a click then opens the way to ask) */
const wayRow = (r) => h(`button.itd-way${r.asking ? ".itd-armed" : ""}`, { fk: `way:${r.id}`, disabled: !!r.disabled, clickWhenDisabled: true, pv: r.pv, data: { warn: r.warn ? "1" : null },
  attrs: { "aria-label": [r.label, ...r.notes, r.disabled].filter(Boolean).join(", "), "aria-pressed": r.disabled ? String(!!r.asking) : null },
  on: { click: () => (r.disabled ? set({ ask: r.asking ? null : r.id, why: "" }) : r.req && send(r.req, { armed: null, mode: null, to: null, ask: null, why: "" })) } },
  h("span.itd-way-l", {}, h("span", { text: r.label }), speed(r.cost)), h("span.itd-way-n", { text: r.notes.join(" · ") }), r.disabled ? h("span.itd-way-why", {}, icon("fa-ban"), h("span", { text: r.disabled })) : null);
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
/* U23: a list behind one button (More actions; Abilities by kind). One line per entry: its picture, its name, the mark of its speed, its
   Resolve price and, for an ability, how it is run. The tooltip says in words what the marks stand for and nothing the row already
   says (U51); the aria-label says all of it.
   U49: in the Abilities list the uses of one power stand under its name, said once (entries of the model, in its columns): a row
   under a name carries only the use; a power with one use is one row, its name first and the use after it. */
function listPanel(p) {
  const row = (r, under = false) => h(`button.itd-row${under ? ".itd-row-sub" : ""}`, { fk: `menu:${r.id}`, disabled: !!r.disabled, clickWhenDisabled: true, tip: r.tip, pv: r.pv, data: { state: r.state ?? null, key: r.key ?? null },
    attrs: { "aria-label": [r.label, ...r.notes, r.disabled].filter(Boolean).join(", "), ...keyAttrs(r.key) }, on: { click: () => set({ armed: r.id, mode: null, targets: [], tokens: [], text: "", amend: null, endArmed: false, weapon: null, opts: {}, choice: null }) } },
    actIcon(r.icon), r.of === undefined ? h("span.itd-row-l", { text: r.label }) : under ? h("span.itd-row-l", { text: r.use ?? r.of }) : h("span.itd-row-l", {}, h("span", { text: r.of }), r.use ? h("small", { text: r.use }) : null),
    speed(r.cost), rs(r.stress), r.state ? icon(KIT_STATE[r.state] ?? "fa-circle") : null);
  const entry = (e) => (e.head ? h("div.itd-entry", { attrs: { role: "group", "aria-label": e.name } }, h("span.itd-entry-n", { text: e.name }), e.rows.map((r) => row(r, true))) : e.rows.map((r) => row(r)));
  const rows = (g) => (g.cols ? h("div.itd-cols", {}, g.cols.map((c) => h("div.itd-colm", {}, c.map((i) => entry(g.entries[i]))))) : h("div.itd-rows", {}, g.rows.map((r) => row(r))));
  return h("section.itd-panel", { data: { kind: p.kind, list: p.list } }, h("header.itd-phead", {}, h("h3.ita-plate", { text: p.title }), cancelBtn()),
    h("div.itd-lists", {}, p.groups.map((g) => h("div.itd-list", { attrs: { role: "group", "aria-label": g.label ?? p.title } }, g.label ? h("span.itd-k", { text: g.label }) : null, rows(g)))),
    (p.foot ?? []).map((x) => h("p.itd-hint.itd-foot", {}, icon("fa-hand"), h("span", { text: x }))));
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
  if (p.kind === "menu") return listPanel(p);
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
        p.pool || p.tokens.length ? h("div.itd-col.itd-odds", {},
          p.pool ? h("div.itd-pool", {}, h("span.itd-k", { text: handlers.label?.("pool") }), h("b.itd-dice", { text: String(p.pool.total) }), h("span.itd-parts", { text: p.pool.parts.map((x) => `${x.label} ${x.dice > 0 && x !== p.pool.parts[0] ? "+" : ""}${x.dice}`).join(" · ") })) : null,
          p.tokens.length ? h("div.itd-chips", {}, p.tokens.map((k) => h("button.itd-chip.itd-chip-token", { fk: `tk:${k.id}`, tip: k.source, attrs: { "aria-pressed": String(k.picked) }, on: { click: () => toggle("tokens", k.id, 12) } }, icon("fa-dice-d6"), h("span", { text: `${k.label} ${k.source}` })))) : null,
          p.chance ? meter(p.chance) : null) : null,
        h("div.itd-col.itd-submit", {}, p.submit.disabled ? h("span.itd-why", { text: p.submit.disabled }) : null, submit(p.submit, "", p.pv, true))));      // U51: why it cannot be declared is written beside the button, not said again in its tooltip
  }
  if (p.kind === "blocked") return h("section.itd-panel", { data: { kind: p.kind } }, head(p), h("div.itd-pbody", {}, h("p.itd-reason", {}, icon("fa-ban"), h("span", { text: p.reason })), h("div.itd-col.itd-grow", {}, textBox(p.text, p.placeholder)), h("div.itd-col.itd-submit", {}, submit(p.submit, ".itd-go-ask"))));
  if (p.kind === "other") return h("section.itd-panel", { data: { kind: p.kind } }, head(p), h("div.itd-pbody", {}, h("div.itd-col.itd-grow", {}, textBox(p.text, p.placeholder), h("p.itd-hint", { text: p.hint })), h("div.itd-col.itd-submit", {}, submit(p.submit, ".itd-go-ask"))));
  if (p.kind === "holdOff") return h("section.itd-panel", { data: { kind: p.kind } }, head(p), h("div.itd-pbody", {}, h("p.itd-hint", { text: p.hint }),
    h("div.itd-chips", {}, p.targets.map((x) => h("button.itd-chip.itd-chip-card", { fk: `ho:${x.slot}`, on: { click: () => send(x.req, { mode: null }) } }, h("b", { text: String(x.card ?? "?") }), h("span", { text: x.names }))))));
  /* the own action in progress. U52: the roll lives HERE (its dice or its sixes with Roll / Accept / Push; no chip in the line over
     the bar, no sentence about it), and every target stands with its picture (those the viewer's view holds) */
  return h("section.itd-panel", { data: { kind: "mine", rolling: p.rolling ? "1" : null } },
    h("header.itd-phead", {}, h("h3.ita-plate", { text: p.title }), p.targets.length ? h("span.itd-arrow", {}, icon("fa-arrow-right"), p.targets.map((x) => h("span.itd-tgt", {}, face(x.img, x.name), h("b", { text: x.name })))) : null),
    h("div.itd-pbody", {}, p.rolls.length ? h("div.itd-myrolls", { attrs: { role: "status" } }, p.rolls.map((r) => rollChip(r, { roll: handlers.roll, send: (req) => send(req) }))) : null,
      p.status ? h("p.itd-status", {}, icon(p.rolling ? "fa-dice" : "fa-hourglass-half"), h("span", { text: p.status })) : null, p.text ? h("blockquote.ita-quote", {}, h("span", { text: p.text })) : null,
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
  const pk = d.show && d.panel ? `${d.panel.kind}|${d.panel.list ?? d.panel.action ?? ""}` : null;
  root.classList.toggle("itd-same", pk !== null && pk === panelKey);
  panelKey = pk;
  const askH = { send: (req) => send(req), pick: handlers.pick, text: handlers.text, always: handlers.always, zone: handlers.zone, again: handlers.again, locate: handlers.locate };
  swap(stack, [
    d.prompts?.length ? h("div.itd-asks", {}, d.prompts.map((a) => askCard(a, askH))) : null,
    d.show ? panel(d.panel) : null,
    /* the line on top of the bar, only while it has something the rest of the screen does not say (U51 / U52: model-pure.dockData):
       a roll this user owes or may push that is not the roll of its own action (that one stands in the action's panel), who ELSE the
       table waits for, and the last thing the table was told (U10 / U3: one chip, the older lines in
       its tooltip, put away with its x) */
    d.show && (d.waiting?.length || d.turn || d.rolls?.length || d.news) ? h("div.itd-wait", { attrs: { role: "status" } },
      (d.rolls ?? []).map((r) => rollChip(r, { roll: handlers.roll, send: (req) => send(req) })),
      d.turn ? h("span.itd-turnline", { text: d.turn }) : null, d.waiting?.length ? [h("span.itd-k", { text: handlers.label?.("waitingFor") }), waitChips(d.waiting)] : null,
      d.news ? h("span.itd-news", { data: { tone: d.news.tone }, tip: d.news.older.length ? d.news.older.join("<br>") : null, attrs: { tabindex: "0", "aria-label": [d.news.text, ...d.news.older].join(". ") } },  icon("fa-comment-dots"), h("span.itd-news-t", { text: d.news.text }),
        h("button.itd-news-x", { fk: "news:x", tip: d.news.label, attrs: { "aria-label": d.news.label }, on: { click: () => set({ newsSeen: d.news.seen }) } }, icon("fa-xmark"))) : null) : null,
    d.show ? bar(d) : null,
  ]);
  /* U41: the answer the keyboard chose on a card (Enter sends it) */
  try { const kp = d.keys?.chosen; if (kp) for (const el of stack.querySelectorAll(".ita-opt, .ita-submit")) if (el.dataset.fk === kp) { el.dataset.kpick = "1"; el.scrollIntoView?.({ block: "nearest" }); } } catch { /* a courtesy */ }
  /* U51: the news chip's tooltip holds the older lines; the last line joins them only when the chip had to cut it short */
  try { const nt = stack.querySelector(".itd-news-t"); if (nt && d.news && nt.scrollWidth > nt.clientWidth + 1) nt.parentElement.dataset.tooltip = [d.news.text, ...d.news.older].join("<br>"); } catch { /* a courtesy */ }
  place();
  reveal();
  try { preview(stack.querySelector("[data-pv]:hover, [data-pv]:focus-visible")); } catch { /* a courtesy */ }      // the pointer may still rest on what it was previewing
}
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
/** U41: a key of the keyboard is a click on the control with that focus key (keys-pure.plan) -> was there one? */
export function press(fk) { try { const el = root && shown ? [...root.querySelectorAll("[data-fk]")].find((e) => e.dataset.fk === fk) : null; if (!el) return false; el.click(); return true; } catch { return false; } }
export const el = () => root;
export const isShown = () => shown;
export function destroy() { clearTimeout(hideTimer); root?.remove(); root = stack = null; shown = false; last = null; }
