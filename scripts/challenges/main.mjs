/* Challenges HUD, part of Invincible - Plus Ultra. Started from scripts/module.js by a guarded dynamic import (start() below), the same way
   as the splash: a file added to module.json would need a server restart, an import from an already registered script does not.
   What it does: while the viewed scene has tokens whose actor is of type "challenge", a panel in the top-right corner (never under the
   sidebar) shows one card per token. How the numbers are read (core rulebook, "Challenges"): a challenge has a Challenge Rating (CR,
   system.derived.health) and a Time Limit (TL, system.derived.resolve). Each success lowers CR by 1; CR 0 before TL runs out = overcome,
   TL 0 with CR above 0 = failed. So progress = 1 - CR / max CR and the time bar is TL / max TL. The DOM layer is hud.mjs. */
import * as HUD from "./hud.mjs";
import * as Camera from "./camera.mjs";
import * as Drag from "./drag.mjs";
import * as CombatTime from "./combat.mjs";
import { registerCombatSettings } from "./combat.mjs";
import { t, UNITS, DEFAULT_UNIT, unitOf, unitLabel } from "./lang.mjs";

const MOD = "invincible-plus-ultra";
const SYSTEM = "invincible";
const LOG = `${MOD} (challenges) |`;
const KEY = { enabled: "challengesEnabled", scale: "challengesScale", collapsed: "challengesCollapsed", visible: "challengesVisible", compact: "challengesCompact" };
const KEY_LABEL = "INVINCIBLE.Actor.Challenge.FIELDS.derived.health.value.label";
const KEY_HINT = "INVINCIBLE.Actor.Challenge.FIELDS.derived.health.value.hint";
const KEY_TL_LABEL = "INVINCIBLE.Actor.Challenge.FIELDS.derived.resolve.value.label";
const KEY_TL_HINT = "INVINCIBLE.Actor.Challenge.FIELDS.derived.resolve.value.hint";
const VIDEO = /\.(webm|mp4|m4v|ogv)(\?.*)?$/i;
const MOVE_ONLY = new Set(["x", "y", "elevation", "rotation", "sort", "_id", "_stats", "movementHistory", "level"]);   // token changes that cannot touch a card

let started = false, ready = false, down = false, quietNext = false, timer = 0;

const get = (key) => { try { return game.settings.get(MOD, key); } catch { return undefined; } };
const enabled = () => get(KEY.enabled) !== false;
const readView = () => ({ visible: get(KEY.visible), compact: get(KEY.compact) });

/* ---------- strings: lang.mjs t() resolves them itself (no game.i18n merge needed) ---------- */

/* ---------- settings (client scope; registered in init, as Foundry wants) ---------- */
function registerSettings() {
  const has = (key) => game.settings.settings.has(`${MOD}.${key}`);
  if (!has(KEY.enabled)) game.settings.register(MOD, KEY.enabled, {
    name: t("INCH.Settings.Enabled.Name"), hint: t("INCH.Settings.Enabled.Hint"), scope: "client", config: true, type: Boolean, default: true,
    onChange: () => { if (enabled()) { Drag.start(); schedule(true); } else { Drag.stop(); HUD.destroy(); } }
  });
  if (!has(KEY.scale)) game.settings.register(MOD, KEY.scale, {
    name: t("INCH.Settings.Scale.Name"), hint: t("INCH.Settings.Scale.Hint"), scope: "client", config: true, type: Number, default: 1,
    range: { min: 0.7, max: 1.4, step: 0.1 }, onChange: (v) => HUD.setScale(v)
  });
  // visible cards: "auto" (fit the screen height) or 1..12. The numeric keys are zero-padded on purpose: integer-like keys would be listed before "auto".
  if (!has(KEY.visible)) game.settings.register(MOD, KEY.visible, {
    name: t("INCH.Settings.Visible.Name"), hint: t("INCH.Settings.Visible.Hint"), scope: "client", config: true, type: String, default: "auto",
    choices: Object.fromEntries([["auto", t("INCH.Settings.Visible.auto")], ...Array.from({ length: 12 }, (_, i) => [String(i + 1).padStart(2, "0"), String(i + 1)])]),
    onChange: () => HUD.setView(readView())
  });
  if (!has(KEY.compact)) game.settings.register(MOD, KEY.compact, {
    name: t("INCH.Settings.Compact.Name"), hint: t("INCH.Settings.Compact.Hint"), scope: "client", config: true, type: String, default: "auto",
    choices: { off: t("INCH.Settings.Compact.off"), on: t("INCH.Settings.Compact.on"), auto: t("INCH.Settings.Compact.auto") },
    onChange: () => HUD.setView(readView())
  });
  if (!has(Camera.CAMERA_KEY)) game.settings.register(MOD, Camera.CAMERA_KEY, {
    name: t("INCH.Settings.Camera.Name"), hint: t("INCH.Settings.Camera.Hint"), scope: "client", config: true, type: String, default: "all",
    choices: { off: t("INCH.Settings.Camera.off"), lifecycle: t("INCH.Settings.Camera.lifecycle"), all: t("INCH.Settings.Camera.all") }
  });
  if (!has(KEY.collapsed)) game.settings.register(MOD, KEY.collapsed, { scope: "client", config: false, type: Boolean, default: false });
}

/* ---------- reading the scene ---------- */
const lbl = (key, fallback) => (game.i18n.has(key) ? game.i18n.localize(key) : t(fallback));

function pictureOf(td, actor) {
  const t = td.texture?.src;
  if (t && !t.includes("*") && !VIDEO.test(t)) return t;   // wildcards and videos cannot sit in an <img>
  const a = actor.img;
  return a && !VIDEO.test(a) ? a : "";
}

/* The challenge's real name. An unlinked token keeps the generic default token name ("Challenge") while its (synthetic) actor carries the name
   the GM typed, so the actor's name leads. A token name that is neither generic nor a copy of the actor's / world actor's name was typed on
   purpose ("Pożar 2"): it leads, and the actor name drops to the small line when there is no subtitle. The subtitle is read from the
   token's own actor (td.actor), never from the world actor. */
const norm = (s) => String(s ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
const lower = (s) => s.toLocaleLowerCase();
function genericNames() {
  const set = new Set(["", "challenge", "wyzwanie"]);
  try {
    const keys = [CONFIG.Actor?.typeLabels?.challenge, "TYPES.Actor.challenge"].filter(Boolean);
    for (const k of keys) set.add(lower(norm(game.i18n.has(k) ? game.i18n.localize(k) : k)));
  } catch { /* the built-in words above are enough */ }
  return set;
}
function titleOf(td, actor) {
  const generic = genericNames();
  const tokenName = norm(td.name), actorName = norm(actor.name), baseName = norm(td.baseActor?.name);
  const sub = typeof actor.system?.subtitle === "string" ? norm(actor.system.subtitle) : "";
  const isGeneric = (s) => generic.has(lower(s));
  const same = (a, b) => !!a && !!b && lower(a) === lower(b);
  const renamed = !!tokenName && !isGeneric(tokenName) && !same(tokenName, actorName) && !same(tokenName, baseName);
  if (renamed) return { name: tokenName, subtitle: sub || (actorName && !isGeneric(actorName) ? actorName : "") };
  return { name: actorName || tokenName || "?", subtitle: sub };
}

/* tokens controlled (selected) on the map, as ids of this scene's token documents */
function controlledIds() {
  try { return new Set((canvas?.tokens?.controlled ?? []).map((t) => t.document?.id).filter(Boolean)); } catch { return new Set(); }
}
const isChallengeToken = (td) => !!td && td.parent === canvas?.scene && td.actor?.type === "challenge" && (!td.hidden || game.user.isGM);

function read(td) {
  const actor = td.actor;
  if (!actor || actor.type !== "challenge") return null;
  if (td.hidden && !game.user.isGM) return null;            // players never see a hidden token's challenge
  const d = actor.system?.derived ?? {};
  const owner = !!actor.isOwner;
  const title = titleOf(td, actor);
  return {
    id: td.id,
    name: title.name,
    subtitle: title.subtitle,
    img: pictureOf(td, actor),
    hidden: !!td.hidden,
    selected: controlledIds().has(td.id),
    cr: d.health?.value, crMax: d.health?.max,
    tl: d.resolve?.value, tlMax: d.resolve?.max,
    unit: unitOf(actor),
    crLabel: lbl(KEY_LABEL, "INCH.Cr.Label"), crHint: lbl(KEY_HINT, "INCH.Cr.Hint"),
    tlLabel: lbl(KEY_TL_LABEL, "INCH.Tl.Label"), tlHint: lbl(KEY_TL_HINT, "INCH.Tl.Hint"),
    canOpen: owner, canPan: owner,
    canAdjust: !!game.user.isGM,   // the hover steppers (GM only)
    canDrag: !!game.user.isGM && !!td.baseActor   // a copy needs the world actor (drag.mjs)
  };
}

function sync() {
  timer = 0;
  const quiet = quietNext;
  quietNext = false;
  try {
    const scene = canvas?.scene;
    if (!ready || down || !scene || !enabled() || game.system.id !== SYSTEM) return HUD.render([], { quiet: true });
    const items = [];
    for (const td of scene.tokens) { const it = read(td); if (it) items.push(it); }   // document order
    HUD.render(items, { quiet });
  } catch (e) { console.warn(LOG, "update failed", e); }
}

/* one debounced entry point for every hook: bursts (a drag, a bulk create, an actor update that touches several fields) cost one pass */
function schedule(quiet = false) {
  if (quiet) quietNext = true;
  clearTimeout(timer);
  timer = setTimeout(sync, 60);
}

const mine = (doc) => !!doc?.parent && doc.parent === canvas?.scene;

/* ---------- the two gestures ---------- */
async function openSheet(id) {
  try {
    const actor = canvas.scene?.tokens.get(id)?.actor;
    const sheet = actor?.sheet;
    if (!sheet || !actor.isOwner) return;
    // GM: the click also selects the token on the map (no pan); a token that is not drawn (no object) is simply skipped
    if (game.user.isGM) { try { canvas.scene.tokens.get(id)?.object?.control({ releaseOthers: true }); } catch { /* not controllable */ } }
    await sheet.render({ force: true });
    sheet.bringToFront?.();
  } catch (e) { console.warn(LOG, "open sheet", e); }
}

function panTo(id) {
  try {
    const td = canvas.scene?.tokens.get(id);
    if (!td || !td.actor?.isOwner) return;
    const size = canvas.grid?.size ?? 100;
    const c = td.object?.center ?? { x: td.x + (td.width * size) / 2, y: td.y + (td.height * size) / 2 };
    canvas.animatePan({ x: c.x, y: c.y, duration: 400 });
  } catch (e) { console.warn(LOG, "pan", e); }
}

/* ---------- time unit (HUD menu, GM only) ----------
   The unit is the actor flag flags[MOD].timeUnit. It is written through token.actor: for an unlinked token that is the synthetic actor, whose update
   is stored in the token's delta (so each unlinked token keeps its own unit); for a linked one it is the world actor. The HUD, the sheet select and
   combat.mjs all re-read it from the actor, the HUD through the same updateActor / updateToken hooks as every other change. */
async function setUnit(id, unit) {
  if (!game.user.isGM || !UNITS.includes(unit)) return;
  const actor = canvas.scene?.tokens.get(id)?.actor;
  if (!actor || actor.type !== "challenge" || unitOf(actor) === unit) return;
  try { await actor.setFlag(MOD, "timeUnit", unit); } catch (e) { console.warn(LOG, "time unit", e); }
}

/* The challenge sheet (system template challenge.hbs, parts re-render freely): one labelled select in the empty third cell of the header's bar grid.
   Its name is the flag path, so the sheet's own submitOnChange form saves it like any other field. Idempotent: added only when missing. */
function injectUnitSelect(app, root) {
  const doc = app?.document;
  if (!doc || doc.documentName !== "Actor" || doc.type !== "challenge" || !(root instanceof HTMLElement)) return;
  const grid = root.querySelector("header.sheet-header .header-fields > div.grid");
  if (!grid || grid.querySelector(".isp-timeunit")) return;
  const cur = unitOf(doc);
  const cell = document.createElement("div");
  cell.className = "form-group isp-timeunit";
  cell.dataset.tooltip = t("INCH.Unit.SheetHint");
  cell.dataset.tooltipDirection = "UP";
  const id = `${app.id}-isp-timeunit`;
  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = t("INCH.Unit.SheetLabel");
  const select = document.createElement("select");
  select.id = id;
  select.name = `flags.${MOD}.timeUnit`;
  select.disabled = !app.isEditable;
  for (const u of UNITS) { const o = new Option(unitLabel(u), u, false, u === cur); select.append(o); }
  const note = document.createElement("small");
  note.className = "isp-tu-note";
  note.textContent = t("INCH.Unit.Note");
  note.hidden = cur === DEFAULT_UNIT;
  select.addEventListener("change", () => { note.hidden = select.value === DEFAULT_UNIT; });
  cell.append(label, select, note);
  grid.append(cell);
}

/* ---------- GM steppers: "+" = more of the good thing (progress: CR - step; time: TL + step), clamped to 0..max ----------
   One queue per token: each step reads the actor's CURRENT value when it runs, so rapid clicks add up. actor.update works for linked tokens (the world
   actor, every linked copy follows) and unlinked ones (the synthetic actor: the change is stored in the token's delta). The bars, numbers, flashes,
   outcome motions and the camera all run from the normal update hooks. */
const queues = new Map();
function adjust(id, kind, dir, step) {
  const run = (queues.get(id) ?? Promise.resolve()).then(() => doAdjust(id, kind, dir, step)).catch((e) => console.warn(LOG, "adjust", e));
  const tail = run.finally(() => { if (queues.get(id) === tail) queues.delete(id); });
  queues.set(id, tail);
}
async function doAdjust(id, kind, dir, step) {
  if (!game.user.isGM || !(dir === 1 || dir === -1)) return;
  const actor = canvas.scene?.tokens.get(id)?.actor;
  if (!actor || actor.type !== "challenge") return;
  const key = kind === "cr" ? "health" : kind === "tl" ? "resolve" : null;
  if (!key) return;
  const d = actor.system?.derived?.[key] ?? {};
  const cur = Number(d.value), max = Number(d.max);
  if (!Number.isFinite(cur)) return;
  let v = cur + (kind === "cr" ? -dir : dir) * Math.max(1, Math.round(step) || 1);
  v = Math.max(0, v);
  if (Number.isFinite(max) && max > 0) v = Math.min(max, v);
  if (v !== cur) await actor.update({ [`system.derived.${key}.value`]: v });
}

/* ---------- placement: top-right, never under the sidebar ----------
   #sidebar holds the tab strip and the chat / directory content. Its box is the whole right-hand column, expanded or collapsed (when
   collapsed only the strip is left). Its left edge is the limit. A ResizeObserver follows the 250 ms expand / collapse animation, the
   window resize covers a moved edge; both end in one rAF-throttled measurement that sets a single CSS variable. */
let raf = 0, observed = null, observedLow = null, ro = null, mo = null;
function measure() {
  raf = 0;
  let right = 0;
  try {
    const r = document.getElementById("sidebar")?.getBoundingClientRect();
    const rr = r ? window.innerWidth - r.left : 0;
    if (r && r.width > 0 && rr > 0 && rr < window.innerWidth * 0.5) right = Math.round(rr);   // only a plausible right-hand column
  } catch { right = 0; }
  HUD.setRight(right);
  HUD.setBottom(lowerLimit(right));
}
/* the lowest y the dock may reach: just above the TOP of whatever occupies the bottom-right area under the dock's columns, else the window's
   bottom margin. v14 puts the floating chat input (#chat-notifications .chat-input, inside #ui-right; #chat-notifications itself is height:0 so
   its children are what takes space), the roll-privacy / chat controls, #players and the hotbar there; each is hit-tested by its rect. */
const LOW_SEL = "#hotbar, #ui-bottom > *, #players, #chat-notifications, #chat-notifications .chat-input, #chat-notifications #chat-controls, #chat-notifications .chat-form, #chat-message, #ui-right-column-1 > *, #ui-right-column-2 > *";
const lowSeen = new Set();
function lowerLimit(right) {
  let y = window.innerHeight - 14;
  try {
    const hb = HUD.box?.();
    const x1 = window.innerWidth - right, x0 = hb && hb.width > 40 ? Math.min(hb.left, x1 - 40) : x1 - 300;
    const hud = document.getElementById("invincible-challenges");
    for (const el of document.querySelectorAll(LOW_SEL)) {
      if (el === hud || el.contains(hud) || hud?.contains(el)) continue;
      if (window.ResizeObserver && ro && !lowSeen.has(el)) { lowSeen.add(el); ro.observe(el); }
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8 || r.height > window.innerHeight * 0.5 || r.top < window.innerHeight * 0.4) continue;   // only a box in the lower part
      if (r.right <= x0 || r.left >= x1) continue;                                                                      // not under the dock
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      y = Math.min(y, Math.round(r.top) - 12);
    }
  } catch { /* the window margin is enough */ }
  return y;
}
const scheduleMeasure = () => { if (!raf) raf = requestAnimationFrame(measure); };
function watchSidebar() {
  const el = document.getElementById("sidebar"), low = document.getElementById("ui-bottom");
  if (el === observed && low === observedLow) return;
  ro?.disconnect();
  lowSeen.clear();
  observed = el;
  observedLow = low;
  if (window.ResizeObserver) { ro ??= new ResizeObserver(scheduleMeasure); if (el) ro.observe(el); if (low) ro.observe(low); }
  mo?.disconnect();
  const ui = document.getElementById("ui-right");
  if (ui && window.MutationObserver) {   // the chat input appears / disappears, a sidebar tab changes (class / hidden only: cheap, and rAF-throttled)
    mo ??= new MutationObserver(scheduleMeasure);
    mo.observe(ui, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "hidden"] });
  }
  scheduleMeasure();
}

/* ---------- hooks ---------- */
function registerHooks() {
  Hooks.on("canvasReady", () => { down = false; watchSidebar(); schedule(true); });
  Hooks.on("canvasTearDown", () => {
    down = true;
    clearTimeout(timer);
    timer = 0;
    Camera.cancel();
    HUD.render([], { quiet: true });   // the cards slide out; the next canvasReady brings the new scene's in
  });
  // the camera (camera.mjs) is an optional extra: it only runs on the GM client that made the change and never touches the HUD when it fails
  const cam = (fn, ...args) => { try { fn(...args); } catch (e) { console.warn(LOG, "camera", e); } };
  Hooks.on("createToken", (td, _o, userId) => { if (mine(td)) schedule(); cam(Camera.onCreate, td, userId); });
  Hooks.on("deleteToken", (td, _o, userId) => { if (mine(td)) schedule(); cam(Camera.onDelete, td, userId); });
  Hooks.on("updateToken", (td, changes, _o, userId) => {
    if (mine(td)) cam(Camera.onUpdateToken, td, changes, userId);
    if (!mine(td)) return;
    if (Object.keys(changes ?? {}).every((k) => MOVE_ONLY.has(k))) return;   // dragging a token must not cost a pass per step
    schedule();
  });
  // actor data: linked tokens read the world actor, unlinked ones a synthetic actor whose changes arrive via updateToken (delta) as well
  Hooks.on("updateActor", (actor, changes, _o, userId) => { if (actor?.type === "challenge") { schedule(); cam(Camera.onUpdateActor, actor, changes, userId); } });
  Hooks.on("renderApplicationV2", (app, el) => { try { injectUnitSelect(app, el); } catch (e) { console.warn(LOG, "sheet time unit", e); } });
  Hooks.on("deleteActor", (actor) => { if (actor?.type === "challenge") schedule(); });
  Hooks.on("createActor", (actor) => { if (actor?.type === "challenge") schedule(); });
  Hooks.on("updateScene", (scene) => { if (scene === canvas?.scene) schedule(); });
  Hooks.on("i18nInit", () => { HUD.destroy(); schedule(true); });   // labels are resolved when a card is built: rebuild after the language is (re)loaded
  // selection: classes only; a selected card that is not in the visible set triggers one normal sync, which promotes it
  Hooks.on("controlToken", () => {
    if (!ready || down) return;
    const complete = HUD.setSelection(controlledIds());
    // over the cap, promotions / demotions need the (incremental) render; otherwise the class toggle above was all
    if (!complete || (!HUD.isExpanded() && (canvas?.scene?.tokens.filter(isChallengeToken).length ?? 0) > HUD.visibleLimit())) schedule();
  });
  Hooks.on("hoverToken", (token, hovered) => {
    const td = token?.document;
    if (ready && isChallengeToken(td)) HUD.setHover(td.id, !!hovered);
  });
  Hooks.on("changeSidebarTab", () => { scheduleMeasure(); setTimeout(scheduleMeasure, 300); });
  Hooks.on("collapseSidebar", () => { scheduleMeasure(); setTimeout(scheduleMeasure, 300); });   // the animation is also followed by the observer; this is the fallback
}

function onReady() {
  ready = true;
  CombatTime.start();   // every client tracks the rounds; only the active GM applies them (combat.mjs)
  if (game.user.isGM && enabled()) Drag.start();   // idempotent: one dropCanvasData hook + three document listeners, however often the HUD is rebuilt
  HUD.configure({ dragStart: Drag.begin, dragEnd: Drag.end, open: openSheet, pan: panTo, known: (id) => isChallengeToken(canvas?.scene?.tokens.get(id)), remeasure: scheduleMeasure, toggle: (c) => game.settings.set(MOD, KEY.collapsed, !!c).catch(() => {}), adjust, setUnit });
  HUD.setScale(get(KEY.scale) ?? 1);
  HUD.setView(readView());
  HUD.setCollapsed(!!get(KEY.collapsed), true);
  window.addEventListener("resize", scheduleMeasure);
  watchSidebar();
  const mod = game.modules.get(MOD);
  if (mod) mod.api = { ...(mod.api ?? {}), challenges: { refresh: () => schedule(true), clear: () => HUD.destroy(), focus: Camera.focus } };
  if (canvas?.scene) { down = false; schedule(true); }   // the canvas may already be drawn by the time this runs
  console.log(`${LOG} ready`);
}

/* ---------- start (called from module.js)
   phases = { init, setup, ready }: the Foundry start-up phases already passed when the dynamic import finished (module.js records them from its
   first line). A phase that has passed runs at once, the others wait for their hook. */
export function start(phases = {}) {
  if (started) return;
  started = true;
  const run = (name, fn) => { if (phases[name]) fn(); else Hooks.once(name, fn); };
  run("init", () => {
    if (game.system.id !== SYSTEM) return;
    registerSettings(); registerCombatSettings();
    registerHooks();
    run("ready", onReady);
  });
}
