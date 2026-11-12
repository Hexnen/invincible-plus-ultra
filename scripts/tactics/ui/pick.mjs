/* Tactical combat, the surfaces: PICKING A TARGET TOKEN ON THE MAP. While the dock has an action armed that needs a target, a left
   click on the token of a possible target chooses it (and, on a map without the board of W1, sets Foundry's own target mark on it).
   The candidates are combatant ids from the user's view (model-pure.targetsFor): a token that is not among them is never picked, so
   nothing the view withholds can be chosen here. Foundry's own targeting (the T key, the target tool) picks as well.
   Zones are not picked here: that is the map module's own pick mode, reached through zones-adapter.pick.
   One document-level capture listener while a pick runs, nothing otherwise. NOT VERIFIED beyond the live check noted in the handoff. */
import * as Store from "../store.mjs";
import * as Aim from "./aim.mjs";      // perf4: the aim mark on the panels that step back (ui/aim-pure.mjs)

let cur = null;      // { combat, ids:Set, onPick }
let hookId = null;
let mine = new Set();      // U21: the tokens whose target mark this surface set (never a mark the user set for something else)
let plain = false;         // W1: the map itself rings who is chosen (ui/board.mjs): Foundry's target mark is then not set here
export const setPlain = (on) => { plain = !!on; };

const boardEl = () => { try { return canvas?.app?.canvas ?? canvas?.app?.view ?? document.getElementById("board"); } catch { return null; } };
const tokenOf = (combat, cid) => { try { return combat?.combatants?.get(cid)?.token?.object ?? null; } catch { return null; } };

function hit(ev) {
  try {
    const p = canvas.canvasCoordinatesFromClient({ x: ev.clientX, y: ev.clientY });
    let best = null;
    for (const cid of cur.ids) {
      const tok = tokenOf(cur.combat, cid);
      if (!tok?.visible || !tok.bounds?.contains(p.x, p.y)) continue;
      if (!best || (tok.document?.sort ?? 0) >= (best.tok.document?.sort ?? 0)) best = { cid, tok };
    }
    return best;
  } catch { return null; }
}
function onDown(ev) {
  try {
    if (!cur || ev.button !== 0 || ev.target !== boardEl()) return;
    const b = hit(ev);
    if (!b) return;
    ev.stopImmediatePropagation(); ev.preventDefault();
    mark(b.tok);
    cur.onPick(b.cid);
  } catch (e) { console.warn(`${Store.MOD} | tactics pick`, e); }
}
/* S089: Foundry calls the targetToken hook inside setTarget, at once. A mark this surface sets is not a pick of the user's: the click
   that set it picks by itself (onDown), a mark shown for the dock's own choice (show) was picked there. Counted twice, a pick of
   several targets put the token in and took it out again. */
let marking = false;
function mark(tok) { if (plain) return; marking = true; try { tok.setTarget(true, { releaseOthers: true }); mine.clear(); mine.add(tok); } catch { /* the mark is a courtesy */ } finally { marking = false; } }
/** U21: the marks this surface set stay only on what is still aimed at: the targets picked in the open panel and those of this user's
    actions in progress. A mark on anybody else (the action was withdrawn, vetoed, undone, or is over) is taken off. `ids` = combatant ids. */
export function keep(combat, ids = []) {
  try {
    if (!mine.size) return;
    const want = new Set(ids.map((id) => tokenOf(combat, id)).filter(Boolean));
    const gone = [...mine].filter((tok) => !want.has(tok));
    mine = new Set([...mine].filter((tok) => want.has(tok)));
    for (const tok of gone) { try { if (tok.isTargeted && !tok.destroyed) tok.setTarget(false, { releaseOthers: false }); } catch { /* the token is gone */ } }
  } catch (e) { console.warn(`${Store.MOD} | tactics pick`, e); }
}
/** U19: show on the map whom a card is about: Foundry's own hover look of the token (this client only; a token the user cannot see is left alone) */
export function locate(combat, cid, on) {
  try {
    const tok = tokenOf(combat, cid);
    if (!tok || !tok.visible) return;
    if (on) tok._onHoverIn?.(new PointerEvent("pointerenter"), { hoverOutOthers: true }); else tok._onHoverOut?.(new PointerEvent("pointerleave"));
  } catch { /* a courtesy */ }
}
/** show Foundry's target mark on a combatant chosen from the dock's list */
export function show(combat, cid) { const tok = tokenOf(combat, cid); if (tok) mark(tok); }

/** Start (or replace) a pick among `ids`. `onPick(combatantId)` may be called several times until stop(). */
export function start(combat, ids, onPick) {
  try {
    const fresh = !cur;
    cur = { combat, ids: new Set(ids), onPick };
    if (!fresh) return;
    document.addEventListener("pointerdown", onDown, true);
    document.body.classList.add("itd-picking"); Aim.sync();      // perf4: the aim mark with the class, before anything looks at the screen
    hookId = Hooks.on("targetToken", (user, token, targeted) => {
      try {
        if (!cur || !targeted || marking || user?.id !== game.user.id) return;
        const cid = [...cur.ids].find((id) => tokenOf(cur.combat, id) === token);
        if (cid) { mine.add(token); cur.onPick(cid); }
      } catch { /* ignore */ }
    });
  } catch (e) { console.warn(`${Store.MOD} | tactics pick`, e); }
}
export function stop() {
  if (!cur) return;
  cur = null;
  try { document.removeEventListener("pointerdown", onDown, true); document.body.classList.remove("itd-picking"); Aim.sync(); if (hookId !== null) Hooks.off("targetToken", hookId); } catch { /* gone */ }
  hookId = null;
}
export const picking = () => !!cur;
