/* Challenges HUD: dragging a card's portrait onto the map (GM only). Started and stopped from main.mjs; the DOM side (draggable portrait,
   dragstart / dragend listeners, the "dragging" class) is hud.mjs, which hands the gesture to begin() / end() below.
   Payload: text/plain JSON { type: "ichChallenge", sceneId, tokenId, uuid }. Core's canvas drop handler (Canvas#onDrop, board.mjs) adds x / y in
   canvas coordinates and calls the hook  dropCanvasData(canvas, data, event); a handler that returns false stops core's own switch. Core does
   nothing with an unknown type anyway, so we only claim our own.
   Two drops (the Ctrl state is read on the drop event itself):
     plain  = SHARED actor. The new token is LINKED to the source's world actor, so every copy shows and edits the same bars. A source token that
              is still unlinked (its values live in a synthetic actor, token.actor) is linked first, after ONE confirmation: the synthetic actor's
              current name / image / system are copied into the world actor, then token.update({ actorLink: true }). With actorLink true,
              TokenDocument#actor is the world actor (documents/token.mjs get actor), the old delta stays in the source but is ignored.
     Ctrl   = NEW instance. A new world Actor is created from the source's CURRENT data (token.actor.toObject()) and a linked token is placed for it.
   Placement mirrors TokenLayer#_onDropActorData (layers/tokens.mjs): Token._getDropActorPosition with snap = !shiftKey, hidden = GM && altKey. */
import { t } from "./lang.mjs";
import * as Camera from "./camera.mjs";

export const TYPE = "ichChallenge";
const LOG = "invincible-plus-ultra (challenges) |";

let hookId = null, listening = false, dragging = false;
const asking = new Map();   // world actor id -> pending confirmation (concurrent drops of one challenge ask once)

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const msg = (e) => String(e?.message ?? e ?? "");
const sceneOf = (data) => game.scenes.get(data?.sceneId) ?? canvas?.scene ?? null;
const ctrl = (ev) => !!(ev?.ctrlKey || ev?.metaKey);

/* ---------- the gesture (called by hud.mjs) ---------- */
export function begin(tokenId, ev, art) {
  const td = canvas?.scene?.tokens.get(tokenId);
  if (!game.user?.isGM || !td || !ev?.dataTransfer) { ev?.preventDefault?.(); return false; }
  const dt = ev.dataTransfer;
  dt.setData("text/plain", JSON.stringify({ type: TYPE, sceneId: td.parent?.id, tokenId, uuid: td.uuid }));
  dt.effectAllowed = "copyLink";   // "link" = shared actor, "copy" = Ctrl, new instance (dropEffect is switched while dragging over)
  try {
    const src = art?.querySelector?.(".ich-img") ?? art;   // the picture itself: the art box is a clipped parallelogram
    if (src) { const r = src.getBoundingClientRect(); dt.setDragImage(src, Math.round(r.width / 2), Math.round(r.height / 2)); }
  } catch { /* the browser's default ghost is fine */ }
  dragging = true;
  return true;
}
export function end() { dragging = false; }

function onDragOver(ev) {
  if (!dragging || !ev.dataTransfer) return;
  try { ev.dataTransfer.dropEffect = ctrl(ev) ? "copy" : "link"; } catch { /* read-only moment */ }
}

/* ---------- start / stop (idempotent) ---------- */
export function start() {
  if (hookId === null) hookId = Hooks.on("dropCanvasData", onDropCanvasData);
  if (!listening) {
    listening = true;
    document.addEventListener("dragover", onDragOver, true);
    document.addEventListener("dragend", end, true);
    document.addEventListener("drop", end, true);
  }
}
export function stop() {
  if (hookId !== null) { Hooks.off("dropCanvasData", hookId); hookId = null; }
  if (listening) {
    listening = false;
    document.removeEventListener("dragover", onDragOver, true);
    document.removeEventListener("dragend", end, true);
    document.removeEventListener("drop", end, true);
  }
  dragging = false;
  asking.clear();
}

/* ---------- the drop ---------- */
function onDropCanvasData(_canvas, data, event) {
  if (data?.type !== TYPE) return;            // not ours: leave it to core and other modules
  if (!game.user.isGM) return false;          // players cannot place copies; swallow the drop
  place(data, event).catch((e) => console.warn(LOG, "drop", e));
  return false;                               // core must not look at it
}

async function place(data, event) {
  const scene = canvas?.scene;
  if (!scene || !canvas.dimensions?.rect?.contains(data.x, data.y)) return;
  const src = sceneOf(data)?.tokens.get(data.tokenId) ?? null;
  if (!src?.actor) return void ui.notifications.warn(t("INCH.Drag.NoSource"));
  const base = src.baseActor;
  if (!base) return void ui.notifications.warn(t("INCH.Drag.NoActor"));
  const point = { x: data.x, y: data.y, elevation: data.elevation };

  if (ctrl(event)) {
    let actor = null;
    try {
      actor = await createInstance(src, base);
      await createToken(actor, src, point, event);
      ui.notifications.info(t("INCH.Drag.NewDone", { name: actor.name }));
    } catch (e) {
      console.warn(LOG, "new instance", e);
      if (actor) { try { await actor.delete(); } catch { /* leave it: the user can delete it */ } }   // do not leave an orphan behind a failed placement
      ui.notifications.error(t("INCH.Drag.ErrNew", { error: msg(e) }));
    }
    return;
  }

  try {
    if (!(await ensureLinked(src, base))) return;       // declined
  } catch (e) {
    console.warn(LOG, "link", e);
    return void ui.notifications.error(t("INCH.Drag.ErrLink", { error: msg(e) }));
  }
  try { await createToken(base, src, point, event); }
  catch (e) { console.warn(LOG, "copy", e); ui.notifications.error(t("INCH.Drag.ErrCopy", { error: msg(e) })); }
}

/* shared actor: the source must be linked to the world actor too. Returns false when the GM declines. */
async function ensureLinked(src, base) {
  if (src.actorLink) return true;
  let pending = asking.get(base.id);
  if (!pending) {
    pending = confirmAndLink(src, base).finally(() => asking.delete(base.id));
    asking.set(base.id, pending);
  }
  return pending;
}
async function confirmAndLink(src, base) {
  if (src.actorLink) return true;   // a concurrent drop got here first
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: t("INCH.Drag.LinkTitle") },
    content: `<p>${esc(t("INCH.Drag.LinkBody", { name: base.name }))}</p>`,
    yes: { label: t("INCH.Drag.LinkYes") },
    no: { label: t("INCH.Drag.Cancel") },
    rejectClose: false,
    modal: true
  });
  if (!ok) return false;
  const live = src.actor.toObject();   // source data of the synthetic actor = base + the token's delta, no derived values
  Camera.hush(4000);                   // the numbers jump to the token's values: not a cinematic moment
  const mine = live.flags?.["invincible-plus-ultra"];   // this module's flags (the time unit) travel with the numbers
  await base.update({ name: live.name, img: live.img, system: foundry.utils.deepClone(live.system), ...(mine ? { flags: { "invincible-plus-ultra": foundry.utils.deepClone(mine) } } : {}) });
  await src.update({ actorLink: true });
  return true;
}

/* Ctrl: a new world actor holding the source's current state */
function uniqueName(name) {
  const used = new Set(game.actors.map((a) => a.name));
  if (!used.has(name)) return name;
  let n = 2;
  while (used.has(`${name} ${n}`)) n++;
  return `${name} ${n}`;
}
async function createInstance(src, base) {
  const data = src.actor.toObject();
  delete data._id;
  delete data._stats;
  data.name = uniqueName(data.name || base.name);
  data.folder = base.folder?.id ?? null;
  data.ownership = foundry.utils.deepClone(base.ownership);
  data.prototypeToken = base.prototypeToken.toObject();
  data.prototypeToken.name = data.name;
  return Actor.implementation.create(data, { renderSheet: false });
}

/* a linked token for `actor`, looking like the source token, placed the way core places a dropped actor */
async function createToken(actor, src, point, event) {
  const scene = canvas.scene;
  const d = src.toObject();
  for (const k of ["_id", "_stats", "delta", "movementHistory", "_regions", "x", "y"]) delete d[k];
  Object.assign(d, {
    actorId: actor.id, actorLink: true, name: actor.name,
    hidden: !!(game.user.isGM && event?.altKey),
    sort: Math.max((canvas.tokens.getMaxSort?.() ?? 0) + 1, 0)
  });
  const doc = new CONFIG.Token.documentClass(d, { parent: scene });
  let pos;
  try { pos = CONFIG.Token.objectClass._getDropActorPosition(doc, point, { snap: !event?.shiftKey }); }
  catch (e) {   // an internal core helper: fall back to a plain centred, grid-snapped position
    console.warn(LOG, "drop position helper unavailable", e);
    const size = canvas.grid.size, w = (doc.width ?? 1) * size, h = (doc.height ?? 1) * size;
    pos = { x: point.x - w / 2, y: point.y - h / 2 };
    if (!event?.shiftKey) pos = canvas.grid.getSnappedPoint(pos, { mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_VERTEX });
  }
  doc.updateSource(pos);
  canvas.tokens.activate();
  return doc.constructor.create(doc, { parent: scene });
}
