/* Party cards, part of Invincible - Plus Ultra. Started from scripts/module.js by a guarded dynamic import (start() below), the same way as the
   Challenges HUD, the combat bar and the token halo: a file added to module.json would need a server restart, an import from an already
   registered script does not. What it does: at the bottom left of the screen, one slide-out card per PLAYER CHARACTER (actor type "superhero",
   owned by a non-GM user) that has a token on the viewed scene: portrait on the right, Health and Resolve, the player's colour, the fast / slow
   action pips of the running combat. Three display states (Hidden / Peek / Full), a client setting. The DOM layer is panel.mjs; the pips are
   actions.mjs (an adapter that duplicates the bar's logic on top of scripts/yze.mjs).
   PRIVACY. The panel is party information: every client sees the bars of every party member. A token that is hidden (or secret) is not listed
   for players. The world setting "Party: show to players" hides the panel for players (the GM keeps it). Numbers come only from
   actor.system.derived; nothing is read that the client may not already read. */
import * as Panel from "./panel.mjs";
import { groupsFor, isTurnOf, pickCombat, isActionStatus } from "./actions.mjs";
import { t } from "./lang.mjs";

const MOD = "invincible-plus-ultra";
const SYSTEM = "invincible";
const LOG = `${MOD} (party) |`;
export const KEY = { display: "partyDisplay", pips: "partyPips", size: "partySize", players: "partyPlayers", style: "partyStyle" };
const MOVE_ONLY = new Set(["x", "y", "elevation", "rotation", "sort", "_id", "_stats", "movementHistory", "level"]);
const VIDEO = /\.(webm|mp4|m4v|ogv)(\?.*)?$/i;

let started = false, ready = false, down = false, timer = 0, quietNext = false;
const hookIds = [];
const cursor = new Map();   // actor id -> index of the token the next click selects
let hovered = null;

const get = (key) => { try { return game.settings.get(MOD, key); } catch { return undefined; } };
const on = (name, fn) => hookIds.push([name, Hooks.on(name, fn)]);
const displayMode = () => { const v = get(KEY.display); return ["hidden", "peek", "full"].includes(v) ? v : "peek"; };
const allowed = () => !!game.user.isGM || get(KEY.players) !== false;

/* ---------- settings (registered in init) ---------- */
function registerSettings() {
  const has = (key) => game.settings.settings.has(`${MOD}.${key}`);
  if (!has(KEY.display)) game.settings.register(MOD, KEY.display, {
    name: t("IPT.Settings.Display.Name"), hint: t("IPT.Settings.Display.Hint"), scope: "client", config: true, type: String, default: "peek",
    choices: { hidden: t("IPT.Settings.Display.hidden"), peek: t("IPT.Settings.Display.peek"), full: t("IPT.Settings.Display.full") },
    onChange: (v) => { Panel.setDisplay(v); scheduleMeasure(); }
  });
  if (!has(KEY.pips)) game.settings.register(MOD, KEY.pips, {
    name: t("IPT.Settings.Pips.Name"), hint: t("IPT.Settings.Pips.Hint"), scope: "client", config: true, type: Boolean, default: true,
    onChange: (v) => Panel.setPips(v)
  });
  if (!has(KEY.size)) game.settings.register(MOD, KEY.size, {
    name: t("IPT.Settings.Size.Name"), hint: t("IPT.Settings.Size.Hint"), scope: "client", config: true, type: String, default: "normal",
    choices: { small: t("IPT.Settings.Size.small"), normal: t("IPT.Settings.Size.normal"), large: t("IPT.Settings.Size.large") },
    onChange: (v) => { Panel.setSize(v); scheduleMeasure(); }
  });
  if (!has(KEY.style)) game.settings.register(MOD, KEY.style, {   // 'classic' = the original look, 'new' = the overhaul (scoped by the root class ipt-v2); applies live
    name: t("IPT.Settings.Style.Name"), hint: t("IPT.Settings.Style.Hint"), scope: "client", config: true, type: String, default: "new",
    choices: { classic: t("IPT.Settings.Style.classic"), new: t("IPT.Settings.Style.new") },
    onChange: (v) => { Panel.setStyle(v); scheduleMeasure(); }
  });
  if (!has(KEY.players)) game.settings.register(MOD, KEY.players, {   // WORLD: every client re-renders when the GM changes it
    name: t("IPT.Settings.Players.Name"), hint: t("IPT.Settings.Players.Hint"), scope: "world", config: true, type: Boolean, default: true,
    onChange: () => schedule(true)
  });
}

/* ---------- reading the scene ---------- */
const colorOf = (user) => {
  const c = user?.color;
  const s = String(c?.css ?? c ?? "");
  return /^#[0-9a-f]{6}$/i.test(s) ? s : "#ffe72a";
};
function ownerOf(actor) {
  const users = game.users.filter((u) => !u.isGM && actor.testUserPermission(u, "OWNER"));
  return users.find((u) => u.character?.id === actor.id) ?? users.find((u) => u.active) ?? users[0] ?? null;
}
function pictureOf(td, actor) {
  for (const src of [actor.img, td.texture?.src]) if (src && !String(src).includes("*") && !VIDEO.test(src)) return src;
  return "";
}
const controlledIds = () => { try { return new Set((canvas?.tokens?.controlled ?? []).map((o) => o.document?.id).filter(Boolean)); } catch { return new Set(); } };
const val = (r) => (r && Number.isFinite(Number(r.value)) && Number.isFinite(Number(r.max)) ? { v: Number(r.value), max: Number(r.max) } : null);

/* one entry per actor: the linked token wins, the order is the scene's token order */
function collect() {
  const scene = canvas?.scene, gm = !!game.user.isGM;
  const by = new Map();
  if (!scene) return [];
  for (const td of scene.tokens) {
    const actor = td.actor;
    if (!actor || actor.type !== "superhero" || !actor.hasPlayerOwner) continue;
    if (!gm && (td.hidden || td.isSecret)) continue;
    const e = by.get(actor.id) ?? { actor, tds: [] };
    if (td.actorLink) e.tds.unshift(td); else e.tds.push(td);
    by.set(actor.id, e);
  }
  return [...by.values()].sort((a, b) => a.actor.name.localeCompare(b.actor.name, game.i18n?.lang || undefined) || a.actor.id.localeCompare(b.actor.id));   // stable and predictable: by character name
}
function read(e, sel, combat) {
  const { actor, tds } = e, td = tds[0], gm = !!game.user.isGM;
  const user = ownerOf(actor);
  const d = actor.system?.derived ?? {};
  const hp = val(d.health), rs = val(d.resolve);
  const ids = tds.map((x) => x.id);
  let effects = 0, fxList = [];
  try {
    const live = actor.effects.filter((fx) => !fx.disabled && !fx.isSuppressed && ![...(fx.statuses ?? [])].some(isActionStatus));
    effects = live.length;
    fxList = live.map((fx) => ({ icon: String(fx.img ?? fx.icon ?? ""), name: String(fx.name ?? fx.label ?? "") }));   // for the 'new' style's condition icons
  } catch { effects = 0; fxList = []; }
  let dead = false;
  try { dead = (hp ? hp.v <= 0 : false) || actor.statuses?.has?.(CONFIG.specialStatusEffects?.DEFEATED ?? "dead"); } catch { dead = hp ? hp.v <= 0 : false; }
  const owner = gm || !!actor.isOwner;
  return {
    id: actor.id,
    name: String(td.name || actor.name || "?").normalize("NFC").replace(/\s+/g, " ").trim(),
    player: user?.name ?? "",
    color: colorOf(user),
    img: pictureOf(td, actor),
    tokenIds: ids, count: ids.length,
    hp, rs, effects, fxList, defeated: !!dead,
    active: !!combat && isTurnOf(ids, combat),
    selected: ids.some((id) => sel.has(id)),
    groups: combat ? groupsFor(ids, actor, combat) : null,
    canSelect: gm || tds.some((x) => x.isOwner),
    canPan: gm || owner || !td.hidden,
    canSheet: gm || owner || !!actor.testUserPermission?.(game.user, "OBSERVER")
  };
}

function sync() {
  timer = 0;
  const quiet = quietNext;
  quietNext = false;
  try {
    if (!ready || down || !canvas?.scene || game.system.id !== SYSTEM || !allowed()) return Panel.render([], { quiet: true });
    const sel = controlledIds(), combat = pickCombat();
    const items = collect().map((e) => read(e, sel, combat));
    Panel.render(items, { quiet });
    Panel.setDisplay(displayMode(), { silent: true });
    scheduleMeasure();
  } catch (e) { console.warn(LOG, "update failed", e); }
}
/* one debounced entry point for every hook */
function schedule(quiet = false) {
  if (quiet) quietNext = true;
  clearTimeout(timer);
  timer = setTimeout(sync, 60);
}
const mine = (doc) => !!doc?.parent && doc.parent === canvas?.scene;
const isCardActor = (actor) => !!actor && actor.type === "superhero";

/* ---------- gestures ---------- */
function tokenFor(id) {
  const it = Panel.itemOf(id);
  if (!it) return null;
  const sel = controlledIds();
  let i = cursor.get(id) ?? 0;
  const onIdx = it.tokenIds.findIndex((x) => sel.has(x));
  if (it.count > 1 && onIdx >= 0) i = (onIdx + 1) % it.count;   // clicking again cycles to the next token of the same character
  else if (onIdx >= 0) i = onIdx;
  cursor.set(id, i % Math.max(1, it.count));
  return canvas.scene?.tokens.get(it.tokenIds[i % it.count]) ?? null;
}
function doSelect(id) {
  try {
    const it = Panel.itemOf(id), td = tokenFor(id);
    if (!it?.canSelect || !td?.object) return;
    td.object.control({ releaseOthers: true });   // no pan
  } catch (e) { console.warn(LOG, "select", e); }
}
function doPan(id) {
  try {
    const it = Panel.itemOf(id), o = canvas.scene?.tokens.get(it?.tokenIds[cursor.get(id) ?? 0] ?? "")?.object ?? canvas.scene?.tokens.get(it?.tokenIds[0] ?? "")?.object;
    if (!o || !it?.canPan || !(game.user.isGM || o.visible)) return;
    canvas.animatePan({ x: o.center.x, y: o.center.y, duration: 400 });
  } catch (e) { console.warn(LOG, "pan", e); }
}
async function doSheet(id) {
  try {
    const it = Panel.itemOf(id);
    const actor = canvas.scene?.tokens.get(it?.tokenIds[0] ?? "")?.actor ?? game.actors.get(id);
    if (!actor || !it?.canSheet) return;
    await actor.sheet?.render({ force: true });
    actor.sheet?.bringToFront?.();
  } catch (e) { console.warn(LOG, "sheet", e); }
}
/* hovering a card echoes on the token (the same protected pair core's combat tracker and the combat bar use) */
function hoverCard(id, over, ev) {
  try {
    if (!over) { hovered?._onHoverOut?.(ev); hovered = null; return; }
    const it = Panel.itemOf(id);
    const o = canvas.scene?.tokens.get(it?.tokenIds[0] ?? "")?.object;
    if (!o || !(o.visible || game.user.isGM) || !o._canHover?.(game.user, ev)) return;
    if (hovered && hovered !== o) hovered._onHoverOut?.(ev);
    o._onHoverIn?.(ev, { hoverOutOthers: true });
    hovered = o;
  } catch { hovered = null; }
}
function cycleDisplay() {
  const next = Panel.nextState(displayMode());
  Panel.setDisplay(next);   // immediate; the setting write (client storage) keeps it for the next load
  Promise.resolve(game.settings.set(MOD, KEY.display, next)).catch(() => {});
}

/* ---------- placement: bottom left, above Foundry's own UI ----------
   The column may occupy [top, bottom] on the left edge. Bottom = the smallest top of any lower-screen UI element that overlaps the column's
   horizontal extent (the FULL card width, whatever the state, so a state change never moves it) minus 12; top = the lowest bottom of the scene
   controls (top-left) plus 12. Every element is hit-tested by its rect and ResizeObserved; also window resize, collapseSidebar, hotbar renders. */
const LOW_SEL = "#players, #players-active, #players-inactive, #hotbar, #ui-bottom > *";   // leaf boxes: core's #ui-left-column-* and #scene-controls are tall, transparent flex columns
const HIGH_SEL = "#scene-controls-layers > *, #scene-controls-tools > *";   // the real buttons (li), not their full-height menus
const seen = new Set();
let ro = null, mo = null, raf = 0;
function measure() {
  raf = 0;
  try {
    const box = Panel.box();
    const sc = Panel.SIZES[get(KEY.size)] ?? 1;
    const x1 = (box && box.width > 40 ? Math.min(box.width, 288 * sc) : 264 * sc) + 16 * sc;   // the FULL card width (+ room for the lean)
    const own = document.getElementById("invincible-party");
    const H = window.innerHeight;
    let bottom = H - 14, top = 0;
    const visible = (el) => { const cs = getComputedStyle(el); return cs.display !== "none" && cs.visibility !== "hidden"; };
    for (const el of document.querySelectorAll(`${LOW_SEL}, ${HIGH_SEL}`)) {
      if (el === own || el.contains(own) || own?.contains(el)) continue;
      if (window.ResizeObserver && ro && !seen.has(el)) { seen.add(el); ro.observe(el); }
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8 || r.left >= x1 || r.right <= 0) continue;   // not over the column
      if (!visible(el)) continue;
      if (el.matches(HIGH_SEL)) {
        if (r.top < H * 0.5 && r.height < H * 0.9) top = Math.max(top, Math.round(r.bottom) + 12);
      } else if (r.top > H * 0.4 && r.height < H * 0.5) bottom = Math.min(bottom, Math.round(r.top) - 12);
    }
    Panel.setBounds(top, bottom);
  } catch (e) { console.warn(LOG, "measure", e); }
}
function scheduleMeasure() { if (!raf) raf = requestAnimationFrame(measure); }
/* PERF: the observed subtrees also hold things that change all the time without moving a box: core's FPS counter (class + text, ~4 per second) and the chat
   timestamps (text nodes, every few seconds). Only a class / hidden change outside the FPS counter, or an ELEMENT added / removed, can move a measured box. */
const layoutRelevant = (recs) => recs.some((r) => {
  const host = r.target?.nodeType === 1 ? r.target : r.target?.parentElement;
  if (host?.closest?.("#performance-stats")) return false;
  if (r.type === "attributes") return true;
  for (const n of r.addedNodes) if (n.nodeType === 1) return true;
  for (const n of r.removedNodes) if (n.nodeType === 1) return true;
  return false;
});
function watch() {
  if (!window.ResizeObserver) return;
  ro ??= new ResizeObserver(scheduleMeasure);
  const ui = document.getElementById("ui-left") ?? document.getElementById("interface");
  if (ui && window.MutationObserver && !mo) {
    mo = new MutationObserver((recs) => { if (layoutRelevant(recs)) scheduleMeasure(); });   // the hotbar / players list change class or hidden; rAF-throttled
    mo.observe(ui, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "hidden"] });
  }
  const bottom = document.getElementById("ui-bottom");
  if (bottom && !seen.has(bottom)) { seen.add(bottom); ro.observe(bottom); }
  scheduleMeasure();
}

/* ---------- hooks (registered once) ---------- */
function registerHooks() {
  if (hookIds.length) return;
  on("canvasReady", () => { down = false; watch(); schedule(true); });
  on("canvasTearDown", () => { down = true; clearTimeout(timer); timer = 0; cursor.clear(); hoverCard(null, false); Panel.destroy(); });
  on("createToken", (td) => { if (mine(td)) schedule(); });
  on("deleteToken", (td) => { if (mine(td)) schedule(); });
  on("updateToken", (td, changes) => {
    if (!mine(td)) return;
    if (Object.keys(changes ?? {}).every((k) => MOVE_ONLY.has(k))) return;   // a drag must not cost a pass per step
    schedule();
  });
  on("updateActor", (actor, changes) => {
    if (!isCardActor(actor)) return;
    const keys = Object.keys(changes ?? {});
    if (keys.some((k) => ["name", "img", "system", "flags", "ownership", "effects", "prototypeToken"].includes(k))) schedule();
  });
  on("createActor", (actor) => { if (isCardActor(actor)) schedule(); });
  on("deleteActor", (actor) => { if (isCardActor(actor)) schedule(); });
  const fx = (e) => { try { if (e?.parent?.documentName === "Actor" && isCardActor(e.parent)) schedule(); } catch { /* ignore */ } };   // the action pips and conditions are effects
  on("createActiveEffect", fx); on("updateActiveEffect", fx); on("deleteActiveEffect", fx);
  on("updateUser", (_u, changes) => { if ("color" in (changes ?? {}) || "character" in (changes ?? {}) || "name" in (changes ?? {})) schedule(); });
  on("updateScene", (scene) => { if (scene === canvas?.scene) schedule(); });
  for (const h of ["createCombat", "updateCombat", "deleteCombat", "createCombatant", "updateCombatant", "deleteCombatant"]) on(h, () => schedule());
  on("controlToken", () => { if (ready && !down) Panel.setSelection(controlledIds()); });
  on("hoverToken", (token, over) => { if (ready && !down) Panel.setEcho(token?.document?.id, !!over); });
  on("collapseSidebar", () => { scheduleMeasure(); setTimeout(scheduleMeasure, 320); });
  on("renderHotbar", () => { scheduleMeasure(); setTimeout(scheduleMeasure, 320); });
  on("renderPlayers", () => scheduleMeasure());
  on("i18nInit", () => { Panel.destroy(); schedule(true); });   // labels are resolved when a card is built
}

function onReady() {
  ready = true;
  Panel.configure({ select: doSelect, pan: doPan, sheet: doSheet, hover: hoverCard, cycle: cycleDisplay });
  Panel.setSize(get(KEY.size) ?? "normal");
  Panel.setPips(get(KEY.pips) !== false);
  Panel.setStyle(get(KEY.style));
  Panel.setDisplay(displayMode(), { silent: true });
  window.addEventListener("resize", scheduleMeasure);
  watch();
  const mod = game.modules.get(MOD);
  if (mod) mod.api = { ...(mod.api ?? {}), party: { refresh: () => schedule(true), stop } };
  if (canvas?.scene) { down = false; schedule(true); }   // the canvas may already be drawn by the time this runs
  console.log(`${LOG} ready`);
}

/* ---------- start / stop (called from module.js; both idempotent) ----------
   phases = { init, setup, ready }: the Foundry start-up phases already passed when the dynamic import finished. */
export function start(phases = {}) {
  if (started) return;
  started = true;
  const run = (name, fn) => { if (phases[name]) fn(); else Hooks.once(name, fn); };
  run("init", () => {
    try {
      if (game.system.id !== SYSTEM) return;
      registerSettings();
      registerHooks();
      run("ready", onReady);
    } catch (e) { console.warn(LOG, "start failed", e); }
  });
}

export function stop() {
  for (const [name, id] of hookIds.splice(0)) { try { Hooks.off(name, id); } catch { /* gone */ } }
  window.removeEventListener("resize", scheduleMeasure);
  cancelAnimationFrame(raf); raf = 0;
  ro?.disconnect(); ro = null; mo?.disconnect(); mo = null; seen.clear();
  clearTimeout(timer); timer = 0;
  Panel.destroy();
  ready = false; started = false;
}
