/* Tactical combat, the surfaces: THE ACTION DOCK (the player's surface; the same dock serves the GM driving an NPC). DOM + placement only:
   main.mjs hands over the render data of model-pure.dockData and receives clicks through configure({ ... }). No Foundry documents here.
   WHERE (U28, U132): THE FIXED PLACES (ui/slots-pure.mjs). The bar stands at the bottom edge, centred in the free part of the window
   that stays put during a turn: clear of the party column and the map's panels (left), of the sidebar and the open GM desk (right),
   beside a popped-out chat (U136). Foundry's macro bar is folded away while the dock is up (body.ita-tactics, styles/tactics-ui.css;
   the keyboard button on the dock brings it back, and then the bar stands above it). The map's director bar and the chat box of a
   folded sidebar keep the bottom edge: the bar stands between them when it fits there (in one row or in two), else above them. A chat
   toast never moves it (the toasts have a strip of their own). What the table says hangs from the top, under the initiative bar, each
   kind in its own place: the line, under it the questions, the first-fight hint at the right end (placeSlots).
   ONE ROW (U29), read like the unit bar of a tactics game, left to right:
     UNIT    face, name, zone; Health and Resolve as two bars with their numbers
     SLOTS   the two slots of a turn (U31): the long one is the full action (or a second quick one), the short one the quick action; a
             further one only when the character has it; then bonus dice and statuses as small chips
     ACTIONS one picture per action, in the groups of the rules, each carrying THE MARK OF SPEED (dom.speed, the shared kit's marks: long
             bar = full action, short bar = quick action, an open diamond = no action, a question mark = the GM decides) and the bolt of its
             price in stress; the name, the names of the marks and the reason of a greyed one are the tooltip (hover and keyboard focus)
             and the aria-label; a click arms it and the panel's head carries the same marks
     TAIL    Something else, Hold off, the macro bar, End turn
   When the row does not fit (data-tight, measured in place()), the actions take a row of their own over the unit; in the narrowest
   room (data-tight="2") the tail takes a third.
   COST PREVIEW (U30): hovering or focusing anything that carries `pv` (an action, a row of a list, a way of moving, an answer on a
   card, Declare) lights the slot it would spend and shows the Resolve it would cost on the Resolve bar. Only for the character the
   dock drives; nothing is rebuilt for it (attributes on the unit block).
   STRUCTURE: at the bottom the bar and the panel of the armed action (U97: right on the bar, nothing between the two); at the top,
   hanging from the initiative bar, the status line (owed rolls, who else the table waits for, the last news; never whose turn it is:
   the initiative bar says that), under it the questions asked of this user (and the round's summary, the legend), the first-fight
   hint at the band's right end. The panel and the questions scroll inside their own places.
   TOOLTIPS (U88 / U97, ui/tip-pure.mjs): one rule: a tooltip opens outside the block its owner stands in (a card, the panel, the bar),
   never on the answers the person is choosing among nor on the head they belong to.
     panel: declare (target chips + map pick, dice, chance band, Declare) | blocked (reason + ask the GM) | a list (More actions,
            Abilities: rows by kind) | something else | hold off | the own action in progress (what it waits for, change / cancel)
   RESTING (not the user's turn, nothing armed, nothing asked): the unit and its slots; the chevron opens the bar to look or to ask for
   an exception. A question addressed to the user always shows, whoever's turn it is. */
import { h, icon, swap, face, tipLines, speed, stressChip, markOf, actIcon, tipText, askCard, sumCard, legendCard, waitChips, rollChip, visibleRect } from "./dom.mjs";
import { symMark, costMark, markName, hasMarks, plain } from "../../kit.mjs";      // U93: the marks of cost and of things, one kit for every surface
import * as Lay from "./layout-pure.mjs";
import { setVar, varOf } from "./vars.mjs";
import * as Settle from "./settle.mjs";
import * as SP from "./slots-pure.mjs";        // U132: the fixed place of each kind of surface
import * as Slots from "./slots.mjs";
import { autoDelay } from "./news-pure.mjs";      // S105: the end button fills over the time the turn really stands

const ID = "invincible-tactics-dock";
const GAP = 6;
const EDGE = 6;          // px between the bar and the bottom edge of the window
const BAR_BAND = 126;    // px of height the bar itself may take (two rows and a margin): the band its own room is measured in
const TWO_ROWS = 500;    // px the two-row bar needs between what lies on the bottom edge; with less it stands above those things
/* what lies on the bottom edge besides the dock: the map's director bar (GM), the chat box Foundry floats there while the sidebar is folded */
const LOW_OBSTACLES = "#mm-dir-bar, #chat-notifications #chat-message, #chat-notifications .chat-form";
/* what hangs from the top of the window over the middle: the initiative bar (its round label and turn buttons, its tiles and their pip
   tabs), the map's orbit strip. The places of what the table says hang under the lowest of them. */
const TOP_OBSTACLES = "#invincible-combat-bar .icbar-lead, #invincible-combat-bar .icbar-tile, #invincible-combat-bar .icbar-acts:not([hidden]), #invincible-combat-bar .icbar-gma:not([hidden]), #invincible-combat-bar .icbar-shell > .icbar-nav, #mm-orbit-strip";
/* panels of other modules at the left edge that reach down into the dock's band (the map's pins / filter panel, its VRAM meter) */
const LEFT_OBSTACLES = ".mm-filter, #mm-vram";
/* windows that float over the map and reach its bottom edge: Foundry's popped-out chat (U136) */
const FLOATING = "#chat-popout";
let root = null, stack = null, handlers = {}, shown = false, hideTimer = 0, last = null, panelKey = null;
/* perf P2-1 (ui/settle.mjs): `drawn` counts the draws (and what may resize the dock's content without one: a picture or a font that
   finished loading); `kept` is what the last placement read, kept only when that placement changed nothing */
let drawn = 0, kept = null;
/* U132 (slots-pure.mjs): the places outside the bar's stack (name -> the inner box the content goes in); the part of the frame the desk
   and the challenges read, as last told; whether the hint takes the questions' place (a narrow band) */
let slotEls = {}, frameKey = "", shareWas = false;
let hudOpenW = 250, squeezed = false;      // FXU (U194): the challenges' open width (window px), and whether they were told to fold
/* U148: the widest bar each width of room has held (layout-pure.steadyShape), and the growth of one turn the shape allows for */
const shapes = new Map(), SLACK = 32;
const SLOT_NAMES = Object.freeze(["line", "cards", "hint"]);

export function configure(x) { handlers = x ?? {}; }
const set = (patch) => handlers.set?.(patch);
const send = (req, after) => handlers.send?.(req, after);

function ensure(label) {
  if (root?.isConnected) return;
  root = h(`div.itd-hidden`, { attrs: { id: ID, role: "region", "aria-label": label }, data: { tooltipDirection: "UP", tooltipClass: "ita-tip" } });
  stack = h("div.itd-stack");
  /* U132: the root covers the window (it takes no pointer); the bar's stack and each place are boxes of their own in it */
  slotEls = {};
  root.append(h("div.its-slot.its-bar", {}, stack));
  for (const name of SLOT_NAMES) { const inner = h("div.its-in"); root.append(h("div.its-slot", { data: { slot: name, empty: "1" } }, inner)); slotEls[name] = inner; }
  /* U30: the cost preview follows the pointer and the keyboard focus; a tooltip opens for the keyboard as it does for the pointer */
  root.addEventListener("pointerover", (e) => preview(e.target));
  root.addEventListener("pointerout", (e) => { if (!root.contains(e.relatedTarget) || !e.relatedTarget?.closest?.("[data-pv]")) preview(null); });
  root.addEventListener("focusin", (e) => { preview(e.target); try { const el = e.target.closest?.("[data-tooltip], [data-tooltip-html]"); if (el?.matches(":focus-visible")) handlers.tipShow?.(el); } catch { /* a courtesy */ } });
  root.addEventListener("focusout", () => { preview(null); try { handlers.tipHide?.(); } catch { /* a courtesy */ } });
  /* Tab walks the buttons of the surface: Foundry's own key handler (on the window) would take it for "next token" */
  root.addEventListener("keydown", (e) => { if (e.key === "Tab") e.stopPropagation(); });
  /* U105: a panel taller than its room scrolls; while more of it lies below, its foot says so (data-more). Scroll does not bubble: caught here */
  root.addEventListener("scroll", (e) => { if (e.target?.classList?.contains("itd-panel")) markMore(e.target); }, true);
  /* perf P2-1: a picture of the dock that finished loading may have changed its size: the next placement is done in full */
  root.addEventListener("load", () => { drawn++; }, true);
  try { document.fonts?.addEventListener?.("loadingdone", () => { drawn++; }); } catch { /* no font events */ }
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

/* ---------- placement: THE FIXED PLACES (U132, slots-pure.mjs) ----------
   perf P2-1 (ui/settle.mjs): a placement whose last run changed nothing, with everything it read reading the same, is skipped; the
   placement itself (placeSlots) asks the page through `rec` so that what it read is known. It also runs while the dock is hidden (the
   GM desk and the challenges read the frame on every seat, whether the bar shows or not). */
export function place() {
  if (!root) return;
  const facts = () => [drawn, window.innerWidth, window.innerHeight, Lay.factor(document.body)];
  if (kept && Settle.sameFacts(kept.facts, facts()) && Settle.unchanged(kept.read, visibleRect) && Settle.sameFacts(kept.sizes, sizesNow())) return;
  const f = facts(), before = outcome(), rec = Settle.recorder(document, visibleRect);
  kept = null;
  placeSlots(rec);
  if (Settle.sameFacts(before, outcome())) kept = { facts: f, read: rec.take(), sizes: sizesNow() };
}
/* the dock's own sizes: its stack and the content of each place */
const sizesNow = () => [...Settle.sizesOf(stack), ...Object.values(slotEls).flatMap((el) => Settle.sizesOf(el))];
/* everything a placement writes: the dock's attributes and numbers, each place's box, the frame told to the desk and the challenges,
   the notice's place */
function outcome() {
  return [root.style.cssText, root.dataset.tight ?? "", stack?.parentElement?.style.cssText ?? "", Object.values(slotEls).map((el) => `${el.parentElement?.style.cssText ?? ""}/${el.parentElement?.dataset.anchor ?? ""}/${el.parentElement?.dataset.align ?? ""}`).join("|"),
    frameKey, varOf("--its-nt"), varOf("--its-nx"), varOf("--igd-toast-maxh")];
}
/* The bar stands at the bottom edge; its room is worked out from what stays put during a turn only: the sidebar, the party column, the
   players list, the map's panels at the left, a popped-out chat, the director bar and the chat box on the edge, the open GM desk. A
   chat toast never moves it (the toasts have their own strip). Every other place follows from that frame and from nothing that comes
   and goes. */
function placeSlots(rec) {
  const W = window.innerWidth, H = window.innerHeight, k = Lay.factor(document.body);
  const hot = rec.rect(rec.one("#hotbar"));
  const ground = hot && hot.top > H * 0.4 ? hot.top : H - EDGE + GAP;
  /* the initiative bar (and the map's orbit strip): the places hang under its lowest piece, centred under the whole of it (its middle
     does not follow the active tile) */
  let ceil = 8, tl = Infinity, tr = -Infinity;
  for (const el of rec.q(TOP_OBSTACLES)) { const r = rec.rect(el); if (r && r.top < H * 0.4 && r.bottom < H * 0.5 && r.right > W * 0.25 && r.left < W * 0.75) { ceil = Math.max(ceil, r.bottom + 8); tl = Math.min(tl, r.left); tr = Math.max(tr, r.right); } }
  const topCx = tr > tl ? (tl + tr) / 2 : null;
  const sb = rec.rect(rec.one("#sidebar")), side = sb && sb.left > W * 0.5 ? sb.left : W;
  let topL = 12, topR = null;
  for (const el of rec.q(LEFT_OBSTACLES)) { const r = rec.rect(el); if (r && r.width && r.top < H * 0.5 && r.right < W * 0.4) topL = Math.max(topL, r.right + 8); }
  /* U136: a window floating over the map (the popped-out chat) that reaches into the top band: the band keeps to its side of it */
  /* FXU (U193): the band keeps to the WIDER side of it (slots-pure.frame with layout-pure.bandBeside), not to the side its middle is on */
  const floats = [];
  for (const el of rec.q(FLOATING)) { const r = rec.rect(el); if (r && r.width && r.top < ceil + 200 && r.bottom > ceil) floats.push({ left: r.left, right: r.right }); }
  const deskR = rec.rect(rec.one("#invincible-tactics-desk .igd"));
  const band = BAR_BAND * k;
  /* the free band at the bottom between what stands at the sides */
  const sides = (floor) => {
    let lo = 12, hi = Math.min(W - 12, side - 12);
    const yBot = floor - GAP, yTop = yBot - band - 4, inBand = (r) => r && r.top < yBot && r.bottom > yTop;
    const partyEl = rec.one("#invincible-party"), party = rec.rect(partyEl);
    if (party && party.right < W * 0.5) {
      const kids = rec.q(".ipt-item", partyEl).map((el) => rec.rect(el)).filter(inBand);
      if (kids.length || inBand(party)) lo = Math.max(lo, Math.max(party.right, ...kids.map((x) => x.right)) + 10);
    }
    /* Foundry's players list: its box is narrower than the lists inside it */
    for (const el of rec.q("#players, #players > *")) { const r = rec.rect(el); if (inBand(r) && r.right < W * 0.3) lo = Math.max(lo, r.right + 8); }
    /* a panel of the map at the left edge counts once it reaches the lower half of the window or the bar's band */
    for (const el of rec.q(LEFT_OBSTACLES)) { const r = rec.rect(el); if (r && r.right < W * 0.4 && r.top < floor && (r.bottom > H * 0.5 || inBand(r))) lo = Math.max(lo, r.right + 8); }
    /* U136: a window that floats over the map, as tall as the window (the popped-out chat): the bar keeps to the wider side of it; it
       stays under it only when neither side has room for a bar */
    for (const el of rec.q(FLOATING)) { const r = rec.rect(el); if (inBand(r)) ({ lo, hi } = Lay.besideFloating(lo, hi, r)); }
    return { lo, hi };
  };
  const barEl = stack.querySelector(".itd-bar");
  delete root.dataset.tight;
  /* U62: the stack is drawn at the user's size (CSS zoom). Its own lengths (offsetWidth, scrollWidth) are in its unscaled pixels, the
     room is in window pixels: every length read from inside the stack is multiplied by k before it meets the room. */
  const natU = barEl ? barEl.scrollWidth + 2 / k : 0, natural = natU * k;
  /* U163: the size the bar itself is drawn at (layout-pure.barFit): the user's size, or less where its two rows would not fit */
  let kb = k;
  let pick = sides(ground), floor = ground;
  /* U48 as a rule of the frame, not of the content: beside the open desk the bar keeps its row when the room there is wide enough;
     else it takes the whole bottom edge and the desk ends above it */
  const deskSide = !!deskR && deskR.left > W * 0.4;
  const under = deskSide && deskR.left - pick.lo < SP.SIZE.beside * k;
  if (deskSide && !under) pick.hi = Math.min(pick.hi, deskR.left - 10);
  /* WHAT LIES ON THE BOTTOM EDGE besides the bar: the map's director bar (GM, left) and the chat box of a folded sidebar (right). The
     bar stands BETWEEN them, in one row when that fits and in two when not; only when even two rows have no room there does it stand
     ABOVE them, and then left of the chat box's column (the toasts float there) */
  const lows = [];
  for (const el of rec.q(LOW_OBSTACLES)) { const r = rec.rect(el); if (r && r.height < 90 && r.bottom > ground - 70 && r.top < ground && r.right > pick.lo && r.left < pick.hi) lows.push(r); }
  if (lows.length) {
    const mid = (pick.lo + pick.hi) / 2, B = { ...pick };
    for (const r of lows) { if ((r.left + r.right) / 2 < mid) B.lo = Math.max(B.lo, r.right + 10); else B.hi = Math.min(B.hi, r.left - 10); }
    if (B.hi - B.lo >= Math.min(natural, TWO_ROWS * k)) pick = B;
    else {
      floor = Math.min(ground, ...lows.map((r) => r.top));
      const keep = pick.hi, right = lows.filter((r) => (r.left + r.right) / 2 > W / 2);
      pick = sides(floor); pick.hi = Math.min(pick.hi, keep, ...right.map((r) => r.left - 10));
    }
  }
  const { lo, hi } = pick, bottom = H - floor + GAP, avail = Math.max(280, hi - lo);
  root.style.setProperty("--itd-bottom", `${Math.round(bottom)}px`);
  root.style.setProperty("--itd-maxw", `${Math.round(avail)}px`);
  /* one row when it fits; else the actions go over the unit; "2": even the unit and the tail do not share a row. U148: decided by the
     widest bar this room has held (layout-pure.steadyShape), so the shape does not change under the pointer within a turn or a fight */
  if (barEl) {
    const inner = [".itd-unit", ".itd-slots", ".itd-tail"].reduce((n, q) => n + (barEl.querySelector(q)?.offsetWidth ?? 0), 44);
    const acts = barEl.querySelector(".itd-acts")?.offsetWidth ?? 0;
    const shape = Lay.barFit(shapes, avail, k, { natural: natU, inner, acts }, SLACK);
    if (shape.tight) root.dataset.tight = String(shape.tight);
    kb = shape.scale;
  }
  const barSlot = stack.parentElement;
  if (Math.abs(kb - k) > 1e-3) barSlot.style.setProperty("--ita-scale", String(kb)); else barSlot.style.removeProperty("--ita-scale");
  /* the bar is centred in its room (over the macro bar when that is open), whatever its width now: its middle stays put */
  const cx = Lay.barCentre(lo, hi, barEl ? barEl.offsetWidth * kb : 280, hot && hot.top > H * 0.4 ? (hot.left + hot.right) / 2 : null);      // U185: the whole bar stays in its room
  root.style.setProperty("--itd-cx", `${cx}px`);
  /* U164: with no bar at all (the fight is over, its summary stands) no bar's height is kept free under the questions' place */
  const barH = barEl ? barEl.offsetHeight * kb : (last?.d?.who ? 60 * k : 0), barTop = H - bottom - barH;
  /* the frame */
  const chat = rec.q("#chat-notifications #chat-message, #chat-notifications .chat-form").map((el) => rec.rect(el)).find((r) => r && r.top > H * 0.4 && r.left > W * 0.5) ?? null;
  /* D126: where Foundry's toast list really ends (it shows only while a toast stands) and the chat box's column */
  const list = rec.rect(rec.one("#chat-notifications .overflow")), notes = rec.rect(rec.one("#chat-notifications"));
  const colOf = chat ?? (notes && notes.left > W * 0.5 ? notes : null);
  const hudEl = rec.one("#invincible-challenges"), hudR = rec.rect(hudEl);
  const hudOn = !!hudR && rec.q("#invincible-challenges .ich-item").length > 0;
  /* FXU (U194): the challenges' column folds to its handle where the middle has no room for it beside the line (layout-pure.hudSqueezed);
     its open width is remembered while it is folded. A folded column (by the user or by the squeeze) keeps nothing of the band: its
     handle stands over the initiative bar's row, not in the band */
  const hudFolded = !!hudEl?.classList?.contains("ich-collapsed");
  if (hudOn && !hudFolded && hudR.width > 40) hudOpenW = hudR.width;
  const squeeze = hudOn && Lay.hudSqueezed(topL, side - 12, hudOpenW, SP.SIZE.card * k);
  if (squeeze !== squeezed) { squeezed = squeeze; handlers.ichSqueeze?.(squeeze); }
  const fr = SP.frame({ W, H, k, staff: !!handlers.staff?.(), hints: !!handlers.hintsOn?.(), top0: ceil, topCx, topL, topR, floats, side, chatTop: chat?.top ?? null,
    listEnd: list && list.left > W * 0.5 ? list.bottom : null, chatX: colOf ? [colOf.left, colOf.right] : null,
    hud: { present: hudOn, x0: Lay.hudEdge(hudFolded, squeezed, hudR?.left ?? null) }, desk: deskSide ? { open: true, x0: deskR.left } : null,
    bar: { lo, hi, top: barTop, bottom: H - bottom } });
  Slots.setFrame(fr);
  root.style.setProperty("--itd-panel-maxh", `${fr.panelMax}px`);
  root.style.setProperty("--itd-up-maxw", `${Math.round(Math.max(280, fr.up.hi - fr.up.lo))}px`);
  /* each place: its box (anchored at its top; what it holds grows down and scrolls at the far end) */
  for (const [name, inner] of Object.entries(slotEls)) {
    const s = fr.slots[name], el = inner.parentElement, st = el.style;
    if (!s) { st.display = "none"; continue; }
    st.display = ""; st.left = `${s.x0}px`; st.width = `${s.x1 - s.x0}px`; st.top = `${s.y0}px`;
    st.setProperty("--its-h", `${s.y1 - s.y0}px`); st.setProperty("--its-w", `${s.x1 - s.x0}px`);
    el.dataset.anchor = s.anchor; el.dataset.align = s.align;
  }
  /* the questions reach down to the bar; with the user's armed panel open they stop over it (the panel's height from its layout box,
     not its rect: it may still be rising) */
  const pe = stack.querySelector(":scope > .itd-panel");
  if (slotEls.cards && fr.slots.cards) {
    const s = fr.slots.cards, ptop = pe ? barTop - pe.offsetHeight * kb - GAP * k : Infinity;
    const end = ptop > s.y0 + 60 ? Math.min(s.y1, ptop - GAP) : s.y1;
    slotEls.cards.parentElement.style.setProperty("--its-h", `${Math.round(end - s.y0)}px`);
  }
  /* the end-of-session notice in its own place, never hidden for a panel; the chat toasts held to their strip (U6, U134) */
  try {
    const n = fr.slots.notice;
    setVar("--igd-toast-maxh", `${fr.toast.h}px`);
    setVar("--its-nt", n ? `${n.y0}px` : null);
    setVar("--its-nx", n ? `${Math.round(Math.max(n.x0 + 230, n.x1 - 230))}px` : null);
  } catch { /* no body */ }
  /* the panel on the bar keeps to the room over it */
  let dx = 0;
  if (pe) { const pw = pe.offsetWidth * kb; dx = Math.max(0, fr.up.lo - (cx - pw / 2)); if (cx + dx + pw / 2 > fr.up.hi) dx = Math.min(dx, fr.up.hi - pw / 2 - cx); requestAnimationFrame(() => markMore(pe)); }
  root.style.setProperty("--itd-up-dx", `${Math.round(dx)}px`);
  /* the desk and the challenges read their part of the frame: told only when it changed */
  const key = JSON.stringify([fr.desk, fr.band, fr.toast]);
  if (key !== frameKey) { frameKey = key; handlers.ichFloor?.(fr.band?.present ? fr.band.y1 : null); handlers.deskRelayout?.(); }
  /* whether the hint takes the questions' place is the frame's; when that flips, the pieces are put again (once) */
  const share = !!fr.slots.hint?.share;
  if (share !== shareWas) { shareWas = share; if (last) requestAnimationFrame(() => { if (last) render(last.d, last.ui); }); }
}
/** how far down the places of what the table says reach now (the line and the questions; 0: nothing shows): the map's camera frames
    under them (ui/main.mjs declares it as the top inset, zones-api.md sections 23 and 38) */
export function topReach() {
  try {
    if (!root || !shown) return 0;
    let y = 0;
    for (const name of ["line", "cards"]) { const el = slotEls[name]?.parentElement; if (el && !el.dataset.empty) { const r = visibleRect(el); if (r) y = Math.max(y, r.bottom); } }
    return Math.round(y);
  } catch { return 0; }
}

/* U105: is there more of the panel below what shows? (the foot then carries the sign; the last pixel of rounding counts as the end) */
function markMore(el) {
  try { if (el.scrollHeight - el.clientHeight - el.scrollTop > 2) el.dataset.more = "1"; else delete el.dataset.more; } catch { /* a courtesy */ }
}

/* ---------- pieces ---------- */
const keyAttrs = (key) => (key ? { "aria-keyshortcuts": key } : {});
/* a slot of the turn is a control with five states (free, granted, being paid, spent, lost: U63, each its own drawing); its free
   shape IS the bar of the kit's marks (long = the full action, short = a quick one), so the bar teaches its own legend */
const slot = (p) => h("button.itd-slot", { fk: `slot:${p.key}`, tip: p.tip, disabled: !p.req, data: { key: p.key, kind: p.kind, state: p.state, as: p.as, extra: p.extra ? "1" : null }, attrs: { "aria-label": p.tip }, on: { click: () => p.req && send(p.req) } }, h("i"));
/* U93: under a way or a door: what has no mark in words, then the marks of the model (a door's Armor), each naming itself */
const wayNotes = (r) => (r.notes.length || r.marks?.length ? h("span.itd-way-n", {}, r.notes.length ? h("span", { text: r.notes.join(" \u00b7 ") }) : null, (r.marks ?? []).map((m) => markOf(m))) : null);
/* U93: Health is the heart, Resolve the bolt (the same bolt a price in stress carries: stress is taken from this bar) */
const vital = (v) => h("div.itd-vital", { data: { id: v.id, v: v.v }, attrs: { role: "img", "aria-label": v.say, style: `--itd-v:${v.v};--itd-max:${v.max}` } },
  v.id === "health" ? symMark("health") : costMark("stress"), h("span.itd-vbar", {}, h("i.itd-vfill"), h("i.itd-vpv")), h("b.itd-vnum", {}, h("span", { text: String(v.v) }), h("small", { text: `/${v.max}` })), h("b.itd-vdelta"));
/* U99: a minion group counts who of it stands (its Health): the number and the group's picture, the words in the tooltip; no bar (the
   system's top of ten is no fact of the group) */
const members = (g) => h("div.itd-vital", { data: { id: "members" }, tip: g.label, attrs: { role: "img", tabindex: "0", "aria-label": g.label } }, icon("fa-people-group"), h("b.itd-vnum", {}, h("span", { text: String(g.n) })));
/* U93: what the character has besides its two slots. A granted unit that is no slot keeps its name (it is no price), its price in
   stress is the chip beside it; bonus dice: the die with their number (the model's text carries the mark); a condition: its picture in the
   kit's frame. Each names itself in its tooltip and to a screen reader. */
function extra(x) {
  const say = [x.label, x.tip].filter(Boolean).join(". ");
  if (x.kind === "status") return h("span.itd-extra", { tip: say, data: { kind: x.kind, id: x.id, mark: "1" }, attrs: { tabindex: "0", role: "img", "aria-label": say } }, symMark("cond", { glyph: x.icon }));
  if (x.kind === "grant" && x.stress) return h("span.itd-extra", { tip: say, data: { kind: x.kind }, attrs: { tabindex: "0", "aria-label": say } }, h("span", { text: x.label }), stressChip(x.stress));
  return h("span.itd-extra", { text: x.label, tip: x.tip || null, data: { kind: x.kind }, attrs: x.tip ? { tabindex: "0" } : {} });
}

const nameParts = (name) => { const m = /^(.*\S)\s+(#\d+)$/.exec(String(name ?? "")); return m ? [h("span.itd-name", { text: m[1] }), h("b.itd-nameno", { text: m[2] })] : h("span.itd-name", { text: name }); };
function unit(d) {
  const w = d.who;
  return [h("div.itd-unit", {},
    d.chars.length ? h("div.itd-chars", { attrs: { role: "group" } }, d.chars.map((c) => h(`button.itd-char${c.onTurn ? ".itd-char-turn" : ""}${c.asked ? ".itd-char-asked" : ""}`, { fk: `char:${c.id}`, tip: c.name, attrs: { "aria-pressed": String(c.sel) }, on: { click: () => set({ sel: c.id, armed: null, mode: null, targets: [], tokens: [], text: "" }) } }, face(c.img, c.name)))) : null,
    !d.chars.length ? face(w.img, w.name, "ita-face.itd-face") : null,
    h("div.itd-id", {},
      /* a namesake's number ("Turret #2") never falls to the ellipsis: it is what tells the two apart, and the bar is where the name stands */
      h("span.itd-nameline", {}, nameParts(w.name), w.zone ? h("span.itd-zone", { tip: w.zone.tip, attrs: { tabindex: "0", "aria-label": `${w.zone.say}. ${w.zone.tip}` } }, icon("fa-location-dot"), h("span", { text: w.zone.label })) : null),
      d.vitals.length || d.group ? h("div.itd-vitals", {}, d.group ? members(d.group) : null, d.vitals.map(vital)) : null)),
  h("div.itd-slots", { attrs: { role: "group", "aria-label": handlers.label?.("slots") } }, d.slots.map(slot),
    d.extras.map(extra), w.free ? h("span.itd-extra", { text: w.freeLabel, data: { kind: "free" } }) : null)];
}
const rs = (n) => stressChip(n);
/* FXS (U183 look): an action that takes a second unit as well (Szarża: the full action and the quick one) shows both marks, side by side
   as the kit sets a pair (.ipu-costs); the button's tooltip and aria-label already say both */
const speeds = (cost, also) => { const a = speed(cost), b = also === "full" || also === "quick" ? speed(also) : null; return a && b ? h("span.ipu-costs.itd-also", { attrs: { "aria-hidden": "true" } }, a, b) : a; };
function actionBtn(a) {
  /* P5 / P6: the other rows of the action tables, and the character's own abilities: one button each, a list behind it */
  if (a.more) { const m = a.mode ?? "menu";
    return h(`button.itd-ic.itd-ic-more${a.armed ? ".itd-armed" : ""}`, { fk: `more:${m}`, tip: a.tip, data: { key: a.key ?? null }, disabled: !!a.disabled, clickWhenDisabled: true, attrs: { "aria-pressed": String(!!a.armed), "aria-haspopup": "true", "aria-label": a.label, ...keyAttrs(a.key) },      // FXN (D133): greyed as its rows are; it still opens
      on: { click: () => set(last?.ui?.mode === m ? { mode: null } : { mode: m, armed: null, targets: [], tokens: [], text: "", amend: null, endArmed: false, weapon: null, opts: {}, choice: null }) } }, actIcon(a.icon), icon("fa-caret-up")); }
  return h(`button.itd-ic${a.armed ? ".itd-armed" : ""}`, { fk: `act:${a.id}`, data: { urgent: a.urgent ? "1" : null, key: a.key ?? null }, disabled: !!a.disabled, clickWhenDisabled: true, tip: a.tip, pv: a.pv, attrs: { "aria-pressed": String(!!a.armed), "aria-label": tipText(a.tip), ...keyAttrs(a.key) },
    on: { click: () => set(a.armed ? { armed: null, mode: null } : { armed: a.id, mode: null, targets: [], tokens: [], text: "", amend: null, endArmed: false, weapon: null, opts: {} }) } }, actIcon(a.icon), speeds(a.cost, a.also), rs(a.stress));
}
/* FXS (U178 look): End turn pressed while the dice still roll is held until they land (main.mjs send); a press that has not gone through
   after a moment shows as taken: the button stays pressed in and filled (.itd-end-held, aria-busy) until the request is answered. A press
   answered at once (no dice) never shows it. It reads End turn again, not the "Sure?" of a confirmed press (endLabel: the button's
   own name, kept from its last unconfirmed draw). */
let endHeld = false, endHeldT = 0, endLabel = null, endWas = null;
const endMark = (on) => {
  endHeld = on; const b = root?.querySelector(".itd-end"), sp = b?.querySelector(":scope > span"); if (!b) return;
  b.classList.toggle("itd-end-held", on);
  if (on) { b.setAttribute("aria-busy", "true"); if (sp && endLabel) { endWas = sp.textContent; sp.textContent = endLabel; } }
  else { b.removeAttribute("aria-busy"); if (sp && endWas !== null && sp.textContent === endLabel) sp.textContent = endWas; endWas = null; }
};
function endPress(req) {
  clearTimeout(endHeldT);
  endHeldT = setTimeout(() => endMark(true), 150);
  return Promise.resolve(send(req, { endArmed: false })).finally(() => { clearTimeout(endHeldT); endMark(false); });
}
const CAM_ICON = { action: "fa-clapperboard", turn: "fa-video", off: "fa-video-slash", all: "fa-film" };
/* W1 (U42): how much the map's camera follows the fight, this user's own switch (turn -> off -> all) */
const cameraBtn = (d) => (d.camera ? h("button.itd-mini", { fk: "camera", tip: d.camera.tip, data: { cam: d.camera.follow }, attrs: { "aria-label": d.camera.tip }, on: { click: () => set({ camera: d.camera.next }) } }, icon(CAM_ICON[d.camera.follow] ?? "fa-video")) : null);
/* U93: where a player looks a mark up: the legend of the marks, a card over the bar (the kit draws it) */
const legendBtn = () => h("button.itd-mini", { fk: "legend", tip: markName("legend"), attrs: { "aria-pressed": String(!!last?.ui?.legend), "aria-label": markName("legend") }, on: { click: () => set({ legend: !last?.ui?.legend }) } }, icon("fa-shapes"));
const hotbarBtn = (d) => h("button.itd-mini", { fk: "hotbar", tip: d.hotbar.tip ?? d.hotbar.label, attrs: { "aria-pressed": String(d.hotbar.open), "aria-label": d.hotbar.label }, on: { click: () => set({ hotbar: !d.hotbar.open }) } }, icon("fa-keyboard"));
function bar(d) {
  const e = d.end;
  if (e && !e.armed && e.label) endLabel = e.label;      // FXS (U178): the name a held press shows
  /* U148 (UX review 1): the resting bar (another's turn) keeps every button where the bar of a turn has it: the actions stand dimmed
     (a click on one still arms it, as the chevron did, and its panel says why not now), the tail keeps its order; only the last small
     button turns from "fold" to "open". Before, the resting bar was the unit and four small buttons, so every button moved on each turn
     change and a click meant for "Move" switched the camera off. */
  return h("div.itd-bar", {},
    unit(d),
    [
      h("div.itd-acts", { attrs: d.rest ? { "aria-disabled": "true" } : {} }, d.out ? h("p.itd-out", { data: { reason: d.out.reason } }, icon(d.out.reason === "dead" ? "fa-skull" : d.out.reason === "unconscious" ? "fa-bed" : d.out.reason === "spent" ? "fa-hourglass-end" : "fa-heart-crack"), h("span", { text: d.out.text })) : null, d.groups.map((g) => h("div.itd-group", { attrs: { role: "group", "aria-label": g.label } }, g.items.map(actionBtn)))),
      h("div.itd-tail", {},
        h(`button.itd-ic.itd-ic-ghost${d.other.armed ? ".itd-armed" : ""}`, { fk: "other", tip: d.other.tip, attrs: { "aria-pressed": String(d.other.armed), "aria-label": d.other.label }, on: { click: () => set(d.other.armed ? { mode: null } : { mode: "other", armed: null, text: "", endArmed: false }) } }, actIcon("@other")),
        h(`button.itd-ic.itd-ic-ghost${d.holdOff.armed ? ".itd-armed" : ""}`, { fk: "hold", disabled: !!d.holdOff.disabled, tip: d.holdOff.tip, attrs: { "aria-pressed": String(d.holdOff.armed), "aria-label": d.holdOff.label }, on: { click: () => set(d.holdOff.armed ? { mode: null } : { mode: "holdOff", armed: null, endArmed: false }) } }, actIcon("@hold")),
        h(`button.itd-end${e.armed ? ".itd-end-sure" : ""}${e.auto ? ".itd-end-auto" : ""}${endHeld ? ".itd-end-held" : ""}`, { fk: "end", disabled: !!e.disabled || !!d.rest, tip: e.tip, /* U148: resting, End turn keeps its place and ends nothing */ attrs: { "aria-label": `${e.label}. ${e.tip}`, "aria-keyshortcuts": "Space", "aria-busy": endHeld ? "true" : null, style: e.auto ? `--itd-end-ms: ${autoDelay(e)}ms` : null }, on: { click: () => (e.confirm && !e.armed ? set({ endArmed: true }) : e.req && endPress(e.req)) } }, actIcon("@end"), h("span", { text: endHeld && endLabel ? endLabel : e.label })),
        legendBtn(), cameraBtn(d), hotbarBtn(d),
        d.rest ? h("button.itd-mini", { fk: "peek", tip: handlers.label?.("peek"), on: { click: () => set({ peek: true }) } }, icon("fa-chevron-up"))
          : d.canRest ? h("button.itd-mini", { fk: "peek", tip: handlers.label?.("cancel"), on: { click: () => set({ peek: false, armed: null, mode: null }) } }, icon("fa-chevron-down")) : null),
    ]);
}

const OPT_ICON = { wreck: "fa-house-crack", area: "fa-burst", fullAuto: "fa-ellipsis" };
const KIT_STATE = { auto: "fa-gears", assist: "fa-user-check", hand: "fa-hand", off: "fa-ban" };
const close = () => set({ armed: null, mode: null, targets: [], tokens: [], text: "", amend: null, weapon: null, opts: {} });
const textBox = (value, placeholder, key = "text") => h("textarea.itd-text", { fk: `draft:${key}`, text: value, attrs: { rows: 2, maxlength: 300, placeholder, "aria-label": placeholder }, on: { input: (e, el) => set({ [key]: el.value }) } });
const submit = (s, cls = "", pv = null) => h(`button.itd-go${cls}`, { fk: `go${cls}`, text: s.label, disabled: !!s.disabled, tip: s.disabled || null, pv: s.disabled ? null : pv, on: { click: () => s.req && send(s.req, { armed: null, mode: null, targets: [], tokens: [], text: "", amend: null, weapon: null, opts: {} }) } });
const cancelBtn = () => h("button.itd-x", { fk: "x", tip: handlers.label?.("cancel"), on: { click: close } }, icon("fa-xmark"));
/* U85: THE PANEL OF THE ARMED ACTION reads in one order in every state, and nothing in it changes place between them:
     the head   WHAT (the name on its plate, the mark of its speed, its Resolve price; the words are the tooltip)  ->  ON WHOM (the
                target's picture and name; several targets: pictures, the names in their tooltips; none yet: an empty dashed place
                that says what to do)  ...  x
     a refusal  (only when there is one) the reason and the words for the GM, under the head, above everything that stays put
     the body   (only for an action that asks for more) a choice, an attribute, a way, a place, a few words
     the foot   HOW on the left (weapons, the options as picture switches, bonus dice)  |  on the right THE DICE and, last, the ONE
                button: Declare, or the question to the GM while the declaration is refused. Once declared the same foot carries
                Change / Withdraw as small picture buttons on the left and, where the dice and Declare stood, the roll with Accept / Push. */
/* U93: the price is the kit's marks (the model's `price`: the bar of the action on the plate, out of turn its hook before it, the
   chip of stress beside it); their names are the tooltip's price line, each mark with its name, and what a screen reader is told */
const what = (p) => h("div.itd-what", { tip: p.price ? { cost: p.price.say, price: { parts: p.price.parts } } : p.unit && p.cost ? { cost: p.cost } : null, attrs: p.price || (p.unit && p.cost) ? { tabindex: "0", "aria-label": `${p.title}, ${p.price?.say ?? p.cost}` } : {} },
  h("h3.ita-plate", {}, h("span", { text: p.title }), speed(p.price?.unit ?? p.unit, { out: !!p.price?.out })), rs(p.price?.stress ?? p.stress), p.cost && !speed(p.price?.unit ?? p.unit) && !(p.price?.stress) ? h("span.itd-cost", { text: p.cost }) : null);      // the mark of speed rides on the plate, as it does on the action's button
const aim = (list, slot = null) => (list?.length || slot ? h("span.itd-arrow", {}, icon("fa-arrow-right"),
  list?.length ? list.map((x) => (list.length > 1 ? h("span.itd-tgt", { tip: x.name, attrs: { tabindex: "0", role: "img", "aria-label": x.name } }, face(x.img, x.name)) : h("span.itd-tgt", {}, face(x.img, x.name), h("b", { text: x.name }))))
    : h("span.itd-tgt.itd-tgt-none", { tip: slot.tip, attrs: { tabindex: "0", "aria-label": `${slot.label}. ${slot.tip}` } }, h("span.itd-tgt-hole", {}, icon("fa-crosshairs")), h("b", { text: slot.label }))) : null);
const head = (p, x = true) => h("header.itd-phead", {}, what(p), aim(p.aim ?? (p.kind === "mine" ? p.targets : null), p.slot), x ? cancelBtn() : null);
/* the reason of a refusal and the words for the GM: one line under the head (the button that sends it stands in the foot, where Declare stood) */
const refusal = (r, key = "why") => h("div.itd-refusal", { attrs: { role: "status" } }, r.reason ? h("p.itd-reason", {}, icon("fa-ban"), h("span", { text: r.reason })) : null, r.text !== null && r.text !== undefined ? textBox(r.text, r.placeholder, key) : null);
const cap = (p, id, text) => h(`span.itd-k${p.need === id ? ".itd-k-need" : ""}`, {}, p.need === id ? icon("fa-caret-right") : null, h("span", { text }));
const CMD_ICON = { amend: "fa-pen", cancel: "fa-rotate-left", cancelAsk: "fa-reply", abort: "fa-ban" };

function meter(c) {
  return h("div.itd-chance", { tip: handlers.label?.("chance"), attrs: { tabindex: "0", "aria-label": `${handlers.label?.("chance")}: ${c.text}` } },
    h("span.itd-meter", { data: { level: c.level }, attrs: { role: "img", "aria-label": c.text } }, [0, 1, 2, 3].map((i) => h(`i${i <= c.level ? ".on" : ""}`))), h("b.itd-band", { text: c.text }),
    c.defended ? h("span.itd-def", {}, h("span", { text: `${c.defended.label}: ` }), h("b", { text: c.defended.text })) : null);
}
/* one way to make a move / one door: the name, what it costs, and when it cannot be done the reason (a click then opens the way to ask) */
const wayRow = (r) => h(`button.itd-way${r.asking ? ".itd-armed" : ""}`, { fk: `way:${r.id}`, disabled: !!r.disabled, clickWhenDisabled: true, pv: r.pv, data: { warn: r.warn ? "1" : null }, tip: r.disabled ? { why: r.why ?? { text: r.disabled } } : null,
  attrs: { "aria-label": [r.label, ...(r.say ?? r.notes), r.disabled, r.why?.fix].filter(Boolean).join(", "), "aria-pressed": r.disabled ? String(!!r.asking) : null },
  on: { click: () => (r.disabled ? set({ ask: r.asking ? null : r.id, why: "" }) : r.req && send(r.req, { armed: null, mode: null, to: null, ask: null, why: "" })) } },
  h("span.itd-way-l", {}, r.disabled ? icon("fa-ban") : r.warn ? icon("fa-triangle-exclamation") : null, h("span", { text: r.label }), speed(r.cost), stressChip(r.stress)), wayNotes(r));      // U83 / U89: why a way cannot be taken and what to do about it are its tooltip and its aria-label (and the line of the question to the GM a click opens): the row keeps its size
const askRow = (a) => (a ? [a.reason || a.text !== null ? refusal({ reason: a.reason ?? "", text: a.text, placeholder: a.placeholder }) : null, h("footer.itd-pfoot", {}, h("span.itd-how"), submit(a.submit, ".itd-go-ask"))] : null);
function movePanel(p) {
  if (p.bare && !p.empty) return null;      // W1 (U32): the map shows where, how and for what price; nothing to say here
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
   Resolve price (U67: how an ability is run is a small mark on the GM's dock only). The tooltip says what the entry does and its price in words, nothing the row already
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
    (p.foot ?? []).map((x) => h("p.itd-hint.itd-foot", {}, icon("fa-circle-info"), h("span", { text: x }))));
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
  if (p.kind === "blocked") return h("section.itd-panel", { data: { kind: p.kind } }, head(p), refusal(p, "text"), h("footer.itd-pfoot", {}, h("span.itd-how"), submit(p.submit, ".itd-go-ask")));
  if (p.kind === "declare") {
    const toggle = (key, id, max = 1) => { const cur = (last.ui?.[key] ?? []).slice(); const i = cur.indexOf(id); if (i >= 0) cur.splice(i, 1); else { cur.push(id); while (cur.length > max) cur.shift(); } set({ [key]: cur }); };
    const offMap = p.targets && (!p.onMap || p.targets.some((x) => !x.map) || p.self);
    const body = [
      /* U160: an area put on the map: the one instruction stands here, by the hand (the map's pick shows no banner of its own then) */
      p.pickHint ? h("p.itd-hint.itd-pickhint", { attrs: { role: "status" } }, icon("fa-map-location-dot"), h("span", { text: p.pickHint })) : null,
      p.choice ? h("div.itd-col.itd-attrs", {}, cap(p, "choice", p.choice.label),
        h("div.itd-chips", { attrs: { role: "group", "aria-label": p.choice.label } }, p.choice.items.map((x) => h("button.itd-chip.itd-chip-plain", { fk: `ch:${x.id}`, attrs: { "aria-pressed": String(x.picked) }, on: { click: () => set({ choice: x.id }) } }, h("span", { text: x.label })))),
        p.choice.hint ? h("p.itd-hint", {}, icon("fa-user-shield"), h("span", { text: p.choice.hint })) : null) : null,
      /* W1 (U33): a target that stands on the map is chosen there; a chip is left only for one that does not (another scene, out of sight) */
      offMap ? h("div.itd-col.itd-targets", {}, p.targets.some((x) => !x.map) ? cap(p, p.slot ? "" : "target", handlers.label?.("target")) : null,
        h("div.itd-chips", { attrs: { role: "group" } }, p.targets.filter((x) => !x.map).map((x) => h(`button.itd-chip${x.likely ? "" : ".itd-chip-dim"}${x.reach === "out" ? ".itd-chip-out" : ""}`, { fk: `tg:${x.id}`, tip: x.reach === "out" ? x.why ?? x.note : x.note, attrs: { "aria-pressed": String(x.picked) }, on: { click: () => { toggle("targets", x.id, p.maxTargets ?? 1); handlers.target?.(x.id); } } }, face(x.img, x.name), h("span", { text: x.name })))),
        p.picking && !p.onMap ? h("p.itd-hint", {}, icon("fa-crosshairs"), h("span", { text: handlers.label?.("pick.hint") })) : null,
        p.self ? h("p.itd-hint", {}, icon("fa-user"), h("span", { text: p.self })) : null) : null,
      p.attrs ? h("div.itd-col.itd-attrs", {}, cap(p, "attr", p.attrs.label),
        h("div.itd-chips", { attrs: { role: "group", "aria-label": p.attrs.label } }, p.attrs.items.map((x) => h("button.itd-chip.itd-chip-attr", { fk: `at:${x.id}`, attrs: { "aria-pressed": String(x.picked) }, on: { click: () => set({ attr: x.picked ? null : x.id }) } }, x.dice != null ? h("b", { text: String(x.dice) }) : null, h("span", { text: x.label })))),
        p.attrs.hint && p.need !== "attr" ? h("p.itd-hint", { text: p.attrs.hint }) : null) : null,      // (what is still to choose is marked on the caption and said by Declare's tooltip: not a third time here)
      p.approach ? approach(p.approach) : null,
      p.dest ? h("div.itd-col", {}, cap(p, "zone", p.dest.label), p.dest.value ? h("b.itd-destv", { text: p.dest.value }) : null,
        h("button.itd-ghost", { fk: "dest", on: { click: () => handlers.zonePick?.() } }, icon("fa-map-location-dot"), h("span", { text: p.dest.pick }))) : null,
      p.text ? h("div.itd-col.itd-grow", {}, textBox(p.text.value, p.text.placeholder)) : null,
    ].filter(Boolean);
    const ref = p.refused;
    return h("section.itd-panel", { data: { kind: p.kind, need: p.need ?? null } }, head(p),
      ref ? refusal(ref) : null,
      body.length ? h("div.itd-pbody", {}, body) : null,
      h("footer.itd-pfoot", {},
        /* HOW: what the attack is made with, the options as switches (a picture each; the name and what it does are the tooltip), bonus dice */
        h("div.itd-how", {},
          p.weapons ? (p.weapons.empty ? h("p.itd-hint", {}, icon("fa-ban"), h("span", { text: p.weapons.empty }))
            : h("div.itd-chips", { attrs: { role: "group", "aria-label": p.weapons.label } }, p.weapons.items.map((x) => h("button.itd-chip.itd-chip-arm", { fk: `wp:${x.id}`, tip: x.tip, attrs: { "aria-pressed": String(x.picked) }, on: { click: () => set({ weapon: x.id }) } }, h("span", { text: x.name }))))) : null,
          p.opts?.length ? h("div.itd-togs", { attrs: { role: "group" } }, p.opts.map((o) => h("button.itd-tog", { fk: `op:${o.id}`, tip: o.tip, attrs: { "aria-pressed": String(o.on), "aria-label": typeof o.tip === "object" ? tipText(o.tip) : o.label }, on: { click: () => set({ opts: { ...(last.ui?.opts ?? {}), [o.id]: !o.on, ...(o.id === "area" && !o.on ? { fullAuto: false } : {}), ...(o.id === "fullAuto" && !o.on ? { area: false } : {}) } }) } }, icon(OPT_ICON[o.id] ?? "fa-circle")))) : null,
          p.tokens.length ? h("div.itd-chips", {}, p.tokens.map((k) => h("button.itd-chip.itd-chip-token", { fk: `tk:${k.id}`, tip: k.source, attrs: { "aria-pressed": String(k.picked) }, on: { click: () => toggle("tokens", k.id, 12) } }, hasMarks(k.label) ? null : icon("fa-dice-d6"), h("span", { text: `${k.label} ${k.source}` })))) : null),
        /* THE DICE (U55: the number; where they come from is the tooltip, on hover and on keyboard focus), then the one button */
        h("div.itd-act", {}, p.chance ? meter(p.chance) : null,
        p.pool ? h("div.itd-pool", { tip: p.pool.tip ? { ...p.pool.tip, title: handlers.label?.("pool") } : handlers.label?.("pool"), data: { sum: p.pool.tip ? "1" : null }, attrs: { tabindex: "0", "aria-label": `${handlers.label?.("pool")}: ${p.pool.tip?.say ?? p.pool.total}` } }, symMark("dice"), h("b.itd-dice", { text: String(p.pool.total) })) : null,      /* U93: the kit's die */
        ref ? submit(ref.submit, ".itd-go-ask") : submit(p.submit, "", p.pv))));      // the dice and the button are one group: a narrow panel wraps the weapons, never these two apart
  }
  if (p.kind === "other") return h("section.itd-panel", { data: { kind: p.kind } }, head(p), h("div.itd-pbody", {}, h("div.itd-col.itd-grow", {}, textBox(p.text, p.placeholder))), h("footer.itd-pfoot", {}, h("div.itd-how", {}, h("p.itd-hint", { text: p.hint })), submit(p.submit, ".itd-go-ask")));
  if (p.kind === "holdOff") return h("section.itd-panel", { data: { kind: p.kind } }, head(p), h("div.itd-pbody", {}, h("p.itd-hint", { text: p.hint }),
    h("div.itd-chips", {}, p.targets.map((x) => h("button.itd-chip.itd-chip-card", { fk: `ho:${x.slot}`, on: { click: () => send(x.req, { mode: null }) } }, h("b", { text: String(x.card ?? "?") }), h("span", { text: x.names }))))));
  /* the own action in progress. U52: the roll lives HERE (its dice or its sixes with Roll / Accept / Push; no chip in the line over
     the bar, no sentence about it), and every target stands with its picture (those the viewer's view holds).
     U85: the same head and the same foot as before it was declared: Change / Withdraw where the options stood, the roll where the
     dice and Declare stood */
  return h("section.itd-panel", { data: { kind: "mine", rolling: p.rolling ? "1" : null } },
    head(p, false),
    p.text ? h("div.itd-pbody", {}, h("blockquote.ita-quote", {}, h("span", { text: p.text }))) : null,
    h("footer.itd-pfoot", {},
      h("div.itd-how", {}, p.commands.map((c) => h("button.itd-mini", { fk: `cmd:${c.id}`, tip: c.label, attrs: { "aria-label": c.label }, on: { click: () => (c.amend ? handlers.amend?.(p) : c.req && send(c.req)) } }, icon(CMD_ICON[c.id] ?? "fa-circle")))),
      p.status ? h("p.itd-status", {}, hasMarks(p.status) ? null : icon(p.rolling ? "fa-dice" : "fa-hourglass-half"), h("span", { text: p.status })) : null,
      /* UXB (U146): what the defence threw stands before the attacker's own roll, so a miss explains itself */
      p.opp?.length ? h("div.itd-opp", { attrs: { role: "status" } }, p.opp.map((o) => h("span.ita-roll", { data: { state: "opp" } }, icon("fa-shield-halved"), h("span.ita-roll-t", { text: o.text })))) : null,
      p.rolls.length ? h("div.itd-myrolls", { attrs: { role: "status" } }, p.rolls.map((r) => rollChip({ ...r, buttons: [...(r.buttons ?? [])].sort((x, y) => (y.id === "push") - (x.id === "push")) }, { roll: handlers.roll, send: (req) => send(req) }))) : null));      // Accept (or Roll) last, where Declare stood; Push before it
}

/* ---------- render ---------- */
export function render(d, ui = {}) {
  try { draw(d, ui); } catch (e) { console.warn("invincible-plus-ultra | tactics dock", e); }
}
function draw(d, ui) {
  last = { d, ui };
  ensure(handlers.label?.("dock") ?? "");
  /* nothing to show: the dock hides, but its frame is still worked out (the desk and the challenges stand in it on every seat) */
  if (!(d?.show || d?.prompts?.length || d?.sum)) { place(); return hide(); }
  root.classList.toggle("itd-turn", !!d.onTurn);
  root.classList.toggle("itd-rest", !!d.rest);
  /* the panel rises once, when it opens: a rebuild of the same panel (a key typed in its text box, a target picked) must not play the
     entry again, whose first frames clip the top of the panel, where the request to the GM is */
  const pk = d.show && d.panel ? `${d.panel.kind}|${d.panel.list ?? d.panel.action ?? ""}` : null;
  root.classList.toggle("itd-same", pk !== null && pk === panelKey);
  panelKey = pk;
  const askH = { send: (req) => send(req), pick: handlers.pick, text: handlers.text, always: handlers.always, zone: handlers.zone, again: handlers.again, locate: handlers.locate };
  /* U57: the summary of the round (or of the fight) that just ended stands where the questions stand, after them */
  const asksOf = (prompts, sum, legend) => (prompts.length || sum || legend ? h("div.itd-asks", {}, prompts.map((a) => askCard(a, askH)), sum ? sumCard(d.sum, { sumClose: handlers.sumClose }) : null,
    legend ? legendCard({ legendClose: () => set({ legend: false }) }) : null) : null);
  const legendOn = !!(ui.legend && d.show), prompts = d.prompts ?? [];
  /* the line of the table, only while it has something the rest of the screen does not say (U51 / U52: model-pure.dockData):
     a roll this user owes or may push that is not the roll of its own action (that one stands in the action's panel), who ELSE the
     table waits for, and the last thing the table was told (U10 / U3: one chip, the older lines in
     its tooltip, put away with its x) */
  /* two ends, each anchored: what the table waits for grows from the left end of the line, the news from the right end, so neither
     slides when the other comes, goes or changes its length */
  const whoOn = !!(d.waiting?.length || d.turn || d.rolls?.length);
  const wait = d.show && (whoOn || d.news) ? h("div.itd-wait", { attrs: { role: "status" } },
    whoOn ? h("span.itd-who", (d.rolls ?? []).map((r) => rollChip(r, { roll: handlers.roll, send: (req) => send(req) })),
      d.turn ? h("span.itd-turnline", { text: d.turn }) : null, d.waiting?.length ? [h("span.itd-k", { text: handlers.label?.("waitingFor") }), waitChips(d.waiting)] : null) : null,
    d.news ? h("span.itd-news", { data: { tone: d.news.tone }, tip: d.news.older.length ? d.news.older : null, attrs: { tabindex: "0", "aria-label": [d.news.text, ...d.news.older].join(". ") } },  icon(d.news.icon ?? "fa-comment-dots"), h("span.itd-news-t", { text: d.news.text }),
      h("button.itd-news-x", { fk: "news:x", tip: d.news.label, attrs: { "aria-label": d.news.label }, on: { click: () => set({ newsSeen: d.news.seen }) } }, icon("fa-xmark"))) : null) : null;
  /* U53: one first-fight hint, in its own place at the right end of the top band (or in the questions' place on a narrow band) */
  const hint = d.show && d.hint ? h("div.itd-hint1", { attrs: { role: "note" } }, icon("fa-lightbulb"), h("span", { text: d.hint.text }),
    h("button.itd-hint1-x", { fk: "hint:x", text: d.hint.close, on: { click: () => handlers.hintClose?.(d.hint.id) } })) : null;
  /* U97: THE PANEL OF THE ARMED ACTION STANDS ON THE BAR: it is the armed button said in full, and nothing comes between the two.
     U132: what the table says hangs from the top, each kind in its own place (slots-pure.mjs frame) */
  swap(stack, [d.show ? panel(d.panel) : null, d.show ? bar(d) : null]);
  const put = (name, node) => { const el = slotEls[name]; swap(el, [node]); if (node) delete el.parentElement.dataset.empty; else el.parentElement.dataset.empty = "1"; };
  const asks = asksOf(prompts, !!d.sum, legendOn);
  put("cards", asks);
  put("line", wait);
  /* a narrow band: the hint takes the questions' place, the questions first (the hint waits while a question stands) */
  put("hint", Slots.frameNow()?.slots?.hint?.share && asks ? null : hint);
  /* U41: the answer the keyboard chose on a card (Enter sends it) */
  try { const kp = d.keys?.chosen; if (kp) for (const el of root.querySelectorAll(".ita-opt, .ita-submit")) if (el.dataset.fk === kp) { el.dataset.kpick = "1"; el.scrollIntoView?.({ block: "nearest" }); } } catch { /* a courtesy */ }
  /* U51: the news chip's tooltip holds the older lines; the last line joins them only when the chip had to cut it short */
  try { const nt = root.querySelector(".itd-news-t"); if (nt && d.news && nt.scrollWidth > nt.clientWidth + 1) nt.parentElement.dataset.tooltip = tipLines([d.news.text, ...d.news.older]); } catch { /* a courtesy */ }
  drawn++;      // perf P2-1: new content: the placement is done in full
  place();
  reveal();
  try { preview(root.querySelector("[data-pv]:hover, [data-pv]:focus-visible")); } catch { /* a courtesy */ }      // the pointer may still rest on what it was previewing
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
export const relayout = () => { if (root) place(); };      // hidden too: the frame is the desk's and the challenges' as well
/** U41: a key of the keyboard is a click on the control with that focus key (keys-pure.plan) -> was there one? */
export function press(fk) { try { const el = root && shown ? [...root.querySelectorAll("[data-fk]")].find((e) => e.dataset.fk === fk) : null; if (!el) return false; el.click(); return true; } catch { return false; } }
export const el = () => root;
export const isShown = () => shown;
export function destroy() { if (squeezed) { squeezed = false; handlers.ichSqueeze?.(false); } clearTimeout(hideTimer); root?.remove(); root = stack = null; shown = false; last = null; kept = null; slotEls = {}; frameKey = ""; shareWas = false; Slots.setFrame(null); }
