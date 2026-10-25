/* Token halo, part of Invincible - Plus Ultra: an irregular ring of comic halftone dots UNDER a token (hover, selection, active combat turn).
   Started from scripts/module.js by a guarded dynamic import (start() below), the same way as the splash, the Challenges HUD and the combat
   banners: a file added to module.json would need a server restart, an import from an already registered script does not.
   dots.mjs = the pure dot placement, halo.mjs = the PIXI layer (attachment, baking, ticker), this file = settings, state rules, hooks.

   STATE RULES (one variant per token, strongest wins; each needs its own setting):
     turn    the token of game.combat.combatant (core: Token#_refreshTurnMarker uses the same test)        -> accent yellow, outer bead ring
     select  token.controlled                                                                             -> disposition colour
     hover   token.hover (core sets it in PlaceableObject#_onHoverIn / Out and calls the hoverToken hook)  -> disposition colour, lighter
   Nothing is shown for a token this user cannot see (token.visible false: hidden, fogged, other level) or whose disposition is secret for them.
   Disposition colours: dots.mjs PALETTE (FRIENDLY cyan, NEUTRAL yellow, HOSTILE red-ink, SECRET violet-grey), the combat bar's palette.
   Every hook body is wrapped: a failure here logs once and never touches the canvas. */
import * as Halo from "./halo.mjs";
import { PALETTE } from "./dots.mjs";
import { t } from "./lang.mjs";

const MOD = "invincible-plus-ultra";
const SYSTEM = "invincible";
const LOG = `${MOD} (token halo) |`;
const KEY = { enabled: "tokenHaloEnabled", hover: "tokenHaloHover", selected: "tokenHaloSelected", turn: "tokenHaloTurn", size: "tokenHaloSize", motion: "tokenHaloMotion", hideBorder: "tokenHaloHideBorder", hideMarker: "tokenHaloHideMarker" };
const RING = { small: 0.85, normal: 1, large: 1.2 };

let started = false, ready = false, warned = false;
const hookIds = [];
const outTimers = new Map();   // token id -> pending hover-out
const get = (key) => { try { return game.settings.get(MOD, key); } catch { return undefined; } };
const on = (name, fn) => hookIds.push([name, Hooks.on(name, fn)]);
const once = (e) => { if (!warned) { warned = true; console.warn(LOG, "a failure here never affects the canvas:", e); } };

/* ---------- settings (client scope, registered in init) ---------- */
function registerSettings() {
  const has = (key) => game.settings.settings.has(`${MOD}.${key}`);
  const bool = (key, name, hint, def) => { if (!has(key)) game.settings.register(MOD, key, { name: t(name), hint: t(hint), scope: "client", config: true, type: Boolean, default: def, onChange: () => syncAll() }); };
  bool(KEY.enabled, "ITH.Settings.Enabled.Name", "ITH.Settings.Enabled.Hint", true);
  bool(KEY.hover, "ITH.Settings.Hover.Name", "ITH.Settings.Hover.Hint", true);
  bool(KEY.selected, "ITH.Settings.Selected.Name", "ITH.Settings.Selected.Hint", true);
  bool(KEY.turn, "ITH.Settings.Turn.Name", "ITH.Settings.Turn.Hint", true);
  if (!has(KEY.size)) game.settings.register(MOD, KEY.size, {
    name: t("ITH.Settings.Size.Name"), hint: t("ITH.Settings.Size.Hint"), scope: "client", config: true, type: String, default: "normal",
    choices: { small: t("ITH.Settings.Size.small"), normal: t("ITH.Settings.Size.normal"), large: t("ITH.Settings.Size.large") },
    onChange: () => syncAll()
  });
  /* motion replaces the first boolean "tokenHaloAnimate" (its client-storage value is read raw): false -> off, anything else -> calm */
  let legacy = null;
  try { legacy = game.settings.storage.get("client").getItem(`${MOD}.tokenHaloAnimate`); } catch { /* none */ }
  if (!has(KEY.motion)) game.settings.register(MOD, KEY.motion, {
    name: t("ITH.Settings.Motion.Name"), hint: t("ITH.Settings.Motion.Hint"), scope: "client", config: true, type: String, default: legacy === "false" ? "off" : "calm",
    choices: { off: t("ITH.Settings.Motion.off"), calm: t("ITH.Settings.Motion.calm"), lively: t("ITH.Settings.Motion.lively") },
    onChange: () => syncAll()
  });
  bool(KEY.hideBorder, "ITH.Settings.HideBorder.Name", "ITH.Settings.HideBorder.Hint", true);
  bool(KEY.hideMarker, "ITH.Settings.HideMarker.Name", "ITH.Settings.HideMarker.Hint", true);
}

/* ---------- what a token should show right now ---------- */
function colorOf(doc) {
  const D = CONST.TOKEN_DISPOSITIONS;
  switch (doc.disposition) {
    case D.HOSTILE: return PALETTE.hostile;
    case D.NEUTRAL: return PALETTE.neutral;
    case D.SECRET: return PALETTE.secret;
    default: return PALETTE.friendly;
  }
}

function wantFor(token) {
  if (!ready || get(KEY.enabled) === false || !canvas?.ready) return null;
  if (!token || token.destroyed || token.isPreview || !token.document || !token.mesh) return null;
  if (!token.visible || token.document.isSecret) return null;
  const isTurn = game.combat?.combatant?.tokenId === token.id;
  let variant = null;
  if (isTurn && get(KEY.turn) !== false) variant = "turn";
  else if (token.controlled && get(KEY.selected) !== false) variant = "select";
  else if (token.hover && get(KEY.hover) !== false) variant = "hover";
  if (!variant) return null;
  return {
    variant,
    color: variant === "turn" ? PALETTE.turn : colorOf(token.document),
    ring: RING[get(KEY.size)] ?? 1,
    motion: get(KEY.motion) ?? "calm",
    hideBorder: get(KEY.hideBorder) !== false,
    hideMarker: get(KEY.hideMarker) !== false
  };
}

function sync(token) {
  try { Halo.update(token, wantFor(token)); } catch (e) { once(e); }
}
function syncAll() {
  try {
    if (!canvas?.ready) return;
    for (const token of canvas.tokens.placeables) sync(token);
  } catch (e) { once(e); }
}

/* ---------- hooks (registered once) ---------- */
function registerHooks() {
  if (hookIds.length) return;
  on("refreshToken", (token, flags) => {
    if (!ready) return;
    if (Halo.has(token.id) || flags?.refreshState || flags?.refreshTurnMarker || flags?.refreshVisibility) sync(token);
  });
  /* hover-out waits 80 ms: moving between adjacent tokens must not flash the ring off and on (the textures are cached, nothing is re-baked) */
  on("hoverToken", (token, hovered) => {
    clearTimeout(outTimers.get(token.id)); outTimers.delete(token.id);
    if (hovered) return sync(token);
    outTimers.set(token.id, setTimeout(() => { outTimers.delete(token.id); sync(token); }, 80));
  });
  on("controlToken", (token) => sync(token));
  on("destroyToken", (token) => { try { Halo.remove(token.id); } catch (e) { once(e); } });
  on("canvasTearDown", () => { try { Halo.destroyAll(false); } catch (e) { once(e); } });   // before the groups are torn down; the tokens go with the scene
  on("canvasReady", () => setTimeout(syncAll, 0));
  const later = () => setTimeout(syncAll, 0);
  on("createCombat", later); on("updateCombat", later); on("deleteCombat", later); on("updateCombatant", later); on("deleteCombatant", later);
  on("createCombatant", later);
}

function onReady() {
  ready = true;
  const mod = game.modules.get(MOD);
  if (mod) mod.api = { ...(mod.api ?? {}), tokenHalo: { refresh: syncAll, info: Halo.info, stop } };
  syncAll();
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
    } catch (e) { once(e); }
  });
}

export function stop() {
  for (const [name, id] of hookIds.splice(0)) { try { Hooks.off(name, id); } catch { /* gone */ } }
  try { Halo.destroyAll(true); } catch { /* canvas gone */ }
  for (const id of outTimers.values()) clearTimeout(id);
  outTimers.clear();
  ready = false; started = false;
}
