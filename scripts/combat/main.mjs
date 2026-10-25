/* Combat notifications, part of Invincible - Plus Ultra. Started from scripts/module.js by a guarded dynamic import (start() below), the same
   way as the splash and the Challenges HUD: a file added to module.json would need a server restart, an import from an already registered
   script does not. What it does: a banner slides in from the top of the screen when a combat starts, when the round changes and when the
   combat ends. Every client renders its own banner from the hooks below. The DOM / motion layer is banner.mjs.

   WHICH HOOKS (core evidence, client/documents/combat.mjs and client/hooks.mjs, Foundry 14):
     - "combatStart" / "combatRound" / "combatTurn" are NOT used: hooks.mjs documents them as firing "on the initiating client before any
       database update occurs", i.e. only on the client of the GM who clicked, and before the data changed.
     - "updateCombat" fires on EVERY client after the database update (the Document update dispatch); startCombat() updates {round: 1, turn: 0},
       nextRound() / previousRound() update {round, turn}. So `changes.round` is the one signal for start (0 -> 1), round up and round down.
       combat.round already holds the new value; the OLD one is kept here per combat id (combat.previous is only filled after the hook).
     - "deleteCombat" fires on every client when the encounter is ended (endCombat() -> this.delete()); a combat that was started has round > 0.
     - "createCombat" seeds the remembered round (a new combat is at round 0, "not started").
     - A "started: false" transition does not exist as a field (Combat#started is `round > 0`); round going back to 0 from above is treated as
       an end anyway, in case another module does it.
   WHICH COMBAT IS SHOWN (relevant()): the combat that belongs to the scene this client is viewing (combat.scene === canvas.scene), or the
   combat this client has as game.combat (the active / viewed one, also for a combat that has no scene), and only while it is active or
   viewed (an inactive encounter the GM is preparing in the tracker stays silent). A combat on a scene nobody is viewing never shows.
   DEDUPE: the remembered round per combat id (an update that does not change the round is ignored) plus a last-event key per combat
   (kind + round + direction) that ignores an identical event within 1.5 s. MERGE: start carries "Round 1" in the same banner; a round event
   while a round banner is up updates that banner in place; anything else waits in one pending slot (banner.mjs). */
import * as Banner from "./banner.mjs";
import * as Bar from "./bar.mjs";   // the initiative bar (bar.mjs): hooks and settings are registered below, next to the banners'
import { t } from "./lang.mjs";
import { KEY as YZE_KEY } from "../yze.mjs";

const MOD = "invincible-plus-ultra";
const SYSTEM = "invincible";
const LOG = `${MOD} (combat banner) |`;
const KEY = { enabled: "combatBannerEnabled", size: "combatBannerSize", rounds: "combatBannerRounds" };
const DEDUPE_MS = 1500;

let started = false, ready = false;
const hookIds = [];          // [name, id] of every Hooks.on made here, so stop() can remove them
const known = new Map();     // combat id -> the round this client last saw
const lastEvent = new Map(); // combat id -> { key, at }
let onResize = null, raf = 0;

const get = (key) => { try { return game.settings.get(MOD, key); } catch { return undefined; } };
const enabled = () => get(KEY.enabled) !== false;
const edgesOnly = () => get(KEY.rounds) === "edges";

/* ---------- settings (client scope; registered in init, as Foundry wants) ---------- */
function registerSettings() {
  const has = (key) => game.settings.settings.has(`${MOD}.${key}`);
  if (!has(KEY.enabled)) game.settings.register(MOD, KEY.enabled, {
    name: t("ICB.Settings.Enabled.Name"), hint: t("ICB.Settings.Enabled.Hint"), scope: "client", config: true, type: Boolean, default: true,
    onChange: (v) => { if (!v) Banner.clear(); }
  });
  if (!has(KEY.size)) game.settings.register(MOD, KEY.size, {
    name: t("ICB.Settings.Size.Name"), hint: t("ICB.Settings.Size.Hint"), scope: "client", config: true, type: String, default: "normal",
    choices: { small: t("ICB.Settings.Size.small"), normal: t("ICB.Settings.Size.normal"), large: t("ICB.Settings.Size.large") },
    onChange: (v) => Banner.setSize(v)
  });
  if (!has(KEY.rounds)) game.settings.register(MOD, KEY.rounds, {
    name: t("ICB.Settings.Rounds.Name"), hint: t("ICB.Settings.Rounds.Hint"), scope: "client", config: true, type: String, default: "all",
    choices: { all: t("ICB.Settings.Rounds.all"), edges: t("ICB.Settings.Rounds.edges") }
  });
  // the initiative bar (bar.mjs)
  if (!has(Bar.KEY.enabled)) game.settings.register(MOD, Bar.KEY.enabled, {
    name: t("ICB.Settings.BarEnabled.Name"), hint: t("ICB.Settings.BarEnabled.Hint"), scope: "client", config: true, type: Boolean, default: true,
    onChange: () => Bar.refresh()
  });
  if (!has(Bar.KEY.size)) game.settings.register(MOD, Bar.KEY.size, {
    name: t("ICB.Settings.BarSize.Name"), hint: t("ICB.Settings.BarSize.Hint"), scope: "client", config: true, type: String, default: "normal",
    choices: { small: t("ICB.Settings.Size.small"), normal: t("ICB.Settings.Size.normal"), large: t("ICB.Settings.Size.large") },
    onChange: (v) => Bar.setSize(v)
  });
  if (!has(Bar.KEY.res)) game.settings.register(MOD, Bar.KEY.res, {
    name: t("ICB.Settings.BarRes.Name"), hint: t("ICB.Settings.BarRes.Hint"), scope: "client", config: true, type: String, default: "both",
    choices: { both: t("ICB.Settings.BarRes.both"), health: t("ICB.Settings.BarRes.health"), none: t("ICB.Settings.BarRes.none") },
    onChange: () => Bar.schedule()
  });
  if (!has(Bar.KEY.players)) game.settings.register(MOD, Bar.KEY.players, {   // WORLD: every client re-renders when the GM changes it
    name: t("ICB.Settings.BarPlayers.Name"), hint: t("ICB.Settings.BarPlayers.Hint"), scope: "world", config: true, type: String, default: "friendly",
    choices: { friendly: t("ICB.Settings.BarPlayers.friendly"), all: t("ICB.Settings.BarPlayers.all"), none: t("ICB.Settings.BarPlayers.none") },
    onChange: () => Bar.schedule()
  });
  // Year Zero Engine Combat adaptations (scripts/yze.mjs yzeOn()): action pips on the bar, the Challenges and the party cards
  if (!has(YZE_KEY)) game.settings.register(MOD, YZE_KEY, {
    name: t("ICB.Settings.Yze.Name"), hint: t("ICB.Settings.Yze.Hint"), scope: "world", config: true, type: Boolean, default: true,
    onChange: () => Bar.schedule()
  });
}

/* ---------- which combat is mine ---------- */
function relevant(combat) {
  try {
    if (!combat) return false;
    const onMyScene = !!combat.scene && combat.scene.id === canvas?.scene?.id;
    const mine = game.combat?.id === combat.id;
    if (!onMyScene && !mine) return false;
    return !!(combat.active || combat.isView || mine);
  } catch { return false; }
}

/* ---------- from a hook to a banner ---------- */
function emit(combat, ev) {
  try {
    const key = `${ev.kind}:${ev.round ?? ev.rounds ?? ""}:${ev.back ? "b" : ""}`;
    const now = performance.now();
    const last = lastEvent.get(combat.id);
    if (last && last.key === key && now - last.at < DEDUPE_MS) return;
    lastEvent.set(combat.id, { key, at: now });
    if (lastEvent.size > 40) lastEvent.delete(lastEvent.keys().next().value);
    Banner.show({ ...ev, id: combat.id });
  } catch (e) { console.warn(LOG, "emit failed", e); }
}

/* Year Zero Engine: Combat (resetEachRound) updates the combat several times per round: setHistory (flags), the initiative reset, the redraw
   (turn: 0, diff: false) and only then core's {round, turn}. None of the first ones carries `round`, so the guard below already makes the round
   banner fire exactly once, on the final update; the start banner comes after the duplicates and the first draw (startCombat() awaits them). */
function onUpdateCombat(combat, changes) {
  try {
    if (!combat || changes?.round === undefined) return;
    const to = Number(combat.round) || 0;
    const from = known.has(combat.id) ? known.get(combat.id) : (to === 1 ? 0 : to);   // an unseen combat: only a jump to round 1 is a start
    known.set(combat.id, to);
    // the bar mounts first (same tick), so the start banner already finds its bottom edge (--icbar-bottom) and lands under it
    if (from === 0 && to >= 1) Bar.syncNow({ loud: true, prefer: combat });
    if (from === to || !ready || !enabled() || !relevant(combat)) return;
    if (from === 0 && to >= 1) return emit(combat, { kind: "start", round: to, count: combat.combatants?.size ?? 0 });
    if (to === 0 && from > 0) return emit(combat, { kind: "end", rounds: from });
    if (edgesOnly()) return;
    emit(combat, { kind: "round", round: to, back: to < from });
  } catch (e) { console.warn(LOG, "updateCombat failed", e); }
}

function onDeleteCombat(combat) {
  try {
    if (!combat) return;
    known.delete(combat.id);
    Bar.removed(combat.id);
    const rounds = Number(combat.round) || 0;
    const show = ready && enabled() && rounds > 0 && relevant(combat);
    if (show) emit(combat, { kind: "end", rounds });
    setTimeout(() => lastEvent.delete(combat.id), DEDUPE_MS * 2);
  } catch (e) { console.warn(LOG, "deleteCombat failed", e); }
}

function on(name, fn) { hookIds.push([name, Hooks.on(name, fn)]); }

function registerHooks() {
  if (hookIds.length) return;   // registered once
  on("createCombat", (combat) => { try { known.set(combat.id, Number(combat.round) || 0); } catch { /* ignore */ } });
  on("updateCombat", onUpdateCombat);
  on("deleteCombat", onDeleteCombat);
  on("canvasTearDown", () => { Banner.clear(true); Bar.setDown(true); });   // another scene: a banner / the bar of this one must not follow
  on("collapseSidebar", () => { Banner.relayout(); setTimeout(Banner.relayout, 320); Bar.relayout(false); setTimeout(() => Bar.relayout(false), 320); });
  registerBarHooks();
}

/* ---------- the initiative bar: every hook ends in Bar.schedule() (one 60 ms debounced pass; bar.mjs decides what it shows) ---------- */
const MOVE_ONLY = new Set(["x", "y", "elevation", "rotation", "sort", "_id", "_stats", "movementHistory", "level"]);   // token changes that cannot touch a tile
function registerBarHooks() {
  on("canvasReady", () => { Bar.setDown(false); Bar.schedule(); });
  on("createCombat", () => Bar.schedule());
  on("updateCombat", () => Bar.schedule());
  on("createCombatant", () => Bar.schedule(true));
  on("updateCombatant", () => Bar.schedule(true));
  on("deleteCombatant", () => Bar.schedule(true));
  on("renderCombatTracker", () => Bar.schedule());   // the tracker may have switched the viewed combat
  on("updateScene", (scene) => { if (scene === canvas?.scene) Bar.schedule(); });
  on("updateToken", (td, changes) => {
    if (!Bar.touchesToken(td)) return;
    if (Object.keys(changes ?? {}).every((k) => MOVE_ONLY.has(k))) return;   // dragging a token must not cost a pass per step
    Bar.schedule();
  });
  on("updateActor", (actor) => { if (Bar.touchesActor(actor)) Bar.schedule(); });
  const effect = (e) => { try { if (e?.parent?.documentName === "Actor" && Bar.touchesActor(e.parent)) Bar.schedule(); } catch { /* ignore */ } };
  on("createActiveEffect", effect);   // the defeated status lives on an effect
  on("deleteActiveEffect", effect);
  on("controlToken", () => Bar.paintSelection());
  on("hoverToken", (token, hovered) => Bar.echo(token, hovered));
  on("changeSidebarTab", () => { Bar.relayout(false); setTimeout(() => Bar.relayout(false), 300); });
}

function onReady() {
  try {
    ready = true;
    known.clear();
    for (const c of game.combats ?? []) known.set(c.id, Number(c.round) || 0);
    Banner.setSize(get(KEY.size));
    Bar.setSize(get(Bar.KEY.size));
    Bar.setReady(true);
    Bar.setDown(!canvas?.scene);
    Bar.schedule();
    onResize = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; Banner.relayout(); Bar.relayout(false); }); };
    window.addEventListener("resize", onResize);
    const mod = game.modules.get(MOD);
    if (mod) mod.api = { ...(mod.api ?? {}), combatBanner: { preview, clear: () => Banner.clear(true), stop } };
    console.log(`${LOG} ready`);
  } catch (e) { console.warn(LOG, "ready failed", e); }
}

/* game.modules.get("invincible-plus-ultra").api.combatBanner.preview("start" | "round" | "back" | "end", n): a banner without a combat */
function preview(kind = "round", n = 2) {
  const id = "preview";
  const ev = kind === "start" ? { kind: "start", round: 1, count: 4 }
    : kind === "end" ? { kind: "end", rounds: n }
    : { kind: "round", round: n, back: kind === "back" };
  Banner.show({ ...ev, id });
}

/* ---------- start / stop (called from module.js; both idempotent) ----------
   phases = { init, setup, ready }: the Foundry start-up phases already passed when the dynamic import finished (module.js records them from its
   first line). A phase that has passed runs at once, the others wait for their hook. */
export function start(phases = {}) {
  if (started) return;
  started = true;
  const run = (name, fn) => { if (phases[name]) fn(); else Hooks.once(name, fn); };
  run("init", () => {
    if (game.system.id !== SYSTEM) return;
    registerSettings();
    registerHooks();
    run("ready", onReady);
  });
}

export function stop() {
  for (const [name, id] of hookIds.splice(0)) { try { Hooks.off(name, id); } catch { /* gone */ } }
  if (onResize) { window.removeEventListener("resize", onResize); onResize = null; }
  cancelAnimationFrame(raf); raf = 0;
  Banner.destroy();
  Bar.destroy();
  known.clear(); lastEvent.clear();
  ready = false; started = false;
}
