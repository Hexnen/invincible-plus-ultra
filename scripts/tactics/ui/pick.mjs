/* Tactical combat, the surfaces: PICKING A TARGET TOKEN ON THE MAP. While the dock has an action armed that needs a target, a left
   click on the token of a possible target chooses it (and sets Foundry's own target mark on it, so the table sees what is aimed at).
   The candidates are combatant ids from the user's view (model-pure.targetsFor): a token that is not among them is never picked, so
   nothing the view withholds can be chosen here. Foundry's own targeting (the T key, the target tool) picks as well.
   Zones are not picked here: that is the map module's own pick mode, reached through zones-adapter.pick.
   One document-level capture listener while a pick runs, nothing otherwise. NOT VERIFIED beyond the live check noted in the handoff. */
import * as Store from "../store.mjs";

let cur = null;      // { combat, ids:Set, onPick }
let hookId = null;

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
function mark(tok) { try { tok.setTarget(true, { releaseOthers: true }); } catch { /* the mark is a courtesy */ } }
/** show Foundry's target mark on a combatant chosen from the dock's list */
export function show(combat, cid) { const tok = tokenOf(combat, cid); if (tok) mark(tok); }

/** Start (or replace) a pick among `ids`. `onPick(combatantId)` may be called several times until stop(). */
export function start(combat, ids, onPick) {
  try {
    const fresh = !cur;
    cur = { combat, ids: new Set(ids), onPick };
    if (!fresh) return;
    document.addEventListener("pointerdown", onDown, true);
    document.body.classList.add("itd-picking");
    hookId = Hooks.on("targetToken", (user, token, targeted) => {
      try {
        if (!cur || !targeted || user?.id !== game.user.id) return;
        const cid = [...cur.ids].find((id) => tokenOf(cur.combat, id) === token);
        if (cid) cur.onPick(cid);
      } catch { /* ignore */ }
    });
  } catch (e) { console.warn(`${Store.MOD} | tactics pick`, e); }
}
export function stop() {
  if (!cur) return;
  cur = null;
  try { document.removeEventListener("pointerdown", onDown, true); document.body.classList.remove("itd-picking"); if (hookId !== null) Hooks.off("targetToken", hookId); } catch { /* gone */ }
  hookId = null;
}
export const picking = () => !!cur;
