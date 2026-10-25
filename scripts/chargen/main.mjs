/* Character generator ("kreator postaci"), entry point. Started from scripts/module.js by a guarded dynamic import (start() below), like the
   other features. Does NOTHING until a click: the wizard (wizard.mjs, ApplicationV2) is imported on the first open.
   Entry points (spec section 4):
     1. a VISIBLE button in the window header of every superhero sheet the user may edit (DOM-injected before the "copy UUID" control;
        idempotent, re-checked on every render of the sheet; client setting "Character generator: header button" hides it);
     2. a 3-dot dropdown entry via the getHeaderControlsInvincibleActorSheet hook (keyboard / discoverability fallback), plus "Undo last
        generation" while an undo backup exists;
     3. api.chargen.open(actor)  (game.modules.get("invincible-plus-ultra").api.chargen).
   Who: the GM always; a player only for an actor they OWN, and only while the world setting "Character generator: players" is on.
   Settings: chargenButton (client, default on), chargenPlayers (world, default on), chargenRank (client, hidden: last used rank),
   chargenRoll (client, hidden: the roll settings of the roll board, JSON). Phase 6: a third 3-dot entry "Surprise me" opens the wizard and rolls a hero at once. */
import { t } from "./lang.mjs";

const MOD = "invincible-plus-ultra";
const SYSTEM = "invincible";
const LOG = `${MOD} (chargen) |`;
export const KEY = { button: "chargenButton", players: "chargenPlayers", rank: "chargenRank", roll: "chargenRoll" };
const ICON = "fa-solid fa-wand-magic-sparkles";

let started = false;
const hookIds = [];
const on = (name, fn) => hookIds.push([name, Hooks.on(name, fn)]);
const get = (key) => { try { return game.settings.get(MOD, key); } catch { return undefined; } };
const chargenApi = () => game.modules.get(MOD)?.api?.chargen;

/** may this user open the generator for this actor? */
export function canUse(actor) {
  if (!actor || actor.documentName !== "Actor" || actor.type !== "superhero" || actor.pack) return false;
  if (!actor.isOwner) return false;
  return !!game.user.isGM || get(KEY.players) !== false;
}

async function resolveActor(ref) {
  if (!ref) return null;
  if (typeof ref === "string") return ref.includes(".") ? await fromUuid(ref) : (game.actors.get(ref) ?? null);
  return ref.actor ?? ref.document ?? ref;
}

/** api.chargen.open(actor | uuid | actorId, { surprise }) -> the wizard application (or null when not allowed). surprise = roll a hero at once and land on the roll board */
export async function open(ref, { surprise = false } = {}) {
  const actor = await resolveActor(ref);
  if (!actor || actor.type !== "superhero") { ui.notifications.warn(t("IPC.Header.NotHero")); return null; }
  if (!canUse(actor)) { ui.notifications.warn(t("IPC.Header.Denied")); return null; }
  const { ChargenApp } = await import("./wizard.mjs");
  return ChargenApp.open(actor, { surprise });
}

async function undoLast(actor) {
  const api = chargenApi();
  if (!api?.apply?.hasUndo(actor)) { ui.notifications.info(t("IPC.Header.NoUndo")); return; }
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: t("IPC.Header.UndoTitle"), icon: "fa-solid fa-rotate-left" }, classes: ["ipc-dialog"],
    content: `<p>${foundry.utils.escapeHTML(t("IPC.Header.UndoBody", { actor: actor.name }))}</p>`,
    yes: { label: t("IPC.Header.UndoYes") }, no: { label: t("IPC.Header.UndoNo"), default: true }, rejectClose: false, modal: false
  });
  if (!ok) return;
  const res = await api.apply.undo(actor);
  (res.ok ? ui.notifications.info : ui.notifications.error).call(ui.notifications, res.message ?? "", { console: false });
}

/* ---------- the visible header button ---------- */
function syncButton(app, element) {
  const actor = app?.document;
  if (!actor || actor.documentName !== "Actor" || actor.type !== "superhero") return;
  const root = element ?? app.element;
  const header = root?.querySelector?.(".window-header");
  if (!header) return;
  const existing = header.querySelector("[data-ipc-chargen]");
  if (!(get(KEY.button) !== false && canUse(actor))) { existing?.remove(); return; }
  if (existing) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `header-control icon ${ICON} ipc-header-btn`;
  btn.dataset.ipcChargen = "";
  btn.dataset.tooltip = t("IPC.Header.Tooltip");
  btn.setAttribute("aria-label", t("IPC.Header.Button"));
  btn.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); open(actor); });
  const anchor = header.querySelector('[data-action="copyUuid"]') ?? header.querySelector('[data-action="close"]');
  if (anchor) anchor.before(btn); else header.append(btn);
}
function syncAll() {
  try { for (const app of foundry.applications.instances.values()) syncButton(app, app.element); } catch (err) { console.warn(LOG, "header sync failed", err); }
}

/* ---------- settings (registered in init) ---------- */
function registerSettings() {
  const has = (key) => game.settings.settings.has(`${MOD}.${key}`);
  if (!has(KEY.button)) game.settings.register(MOD, KEY.button, {
    name: t("IPC.Settings.Button.Name"), hint: t("IPC.Settings.Button.Hint"), scope: "client", config: true, type: Boolean, default: true, onChange: () => syncAll()
  });
  if (!has(KEY.players)) game.settings.register(MOD, KEY.players, {
    name: t("IPC.Settings.Players.Name"), hint: t("IPC.Settings.Players.Hint"), scope: "world", config: true, type: Boolean, default: true, onChange: () => syncAll()
  });
  if (!has(KEY.rank)) game.settings.register(MOD, KEY.rank, { scope: "client", config: false, type: String, default: "global" });
  if (!has(KEY.roll)) game.settings.register(MOD, KEY.roll, { scope: "client", config: false, type: String, default: "" });   // phase 6: remembered roll settings (JSON)
}

function registerHooks() {
  on("renderApplicationV2", (app, element) => syncButton(app, element));
  on("getHeaderControlsInvincibleActorSheet", (app, controls) => {
    const actor = app.document;
    if (!actor || actor.type !== "superhero") return;
    controls.push({ action: "ipcChargen", icon: ICON, label: t("IPC.Header.Button"), visible: () => canUse(actor), onClick: () => open(actor) });
    controls.push({ action: "ipcChargenSurprise", icon: "fa-solid fa-wand-sparkles", label: t("IPC.Header.Surprise"), visible: () => canUse(actor), onClick: () => open(actor, { surprise: true }) });
    controls.push({ action: "ipcChargenUndo", icon: "fa-solid fa-rotate-left", label: t("IPC.Header.Undo"), visible: () => canUse(actor) && !!chargenApi()?.apply?.hasUndo(actor), onClick: () => undoLast(actor) });
  });
}

function attachApi() {
  const mod = game.modules.get(MOD);
  if (!mod) return;
  (mod.api ??= {});
  mod.api.chargen = { ...(mod.api.chargen ?? {}), open, canUse };
}

export function start(phases = {}) {
  if (started) return;
  started = true;
  const run = (name, fn) => { if (phases[name]) fn(); else Hooks.once(name, fn); };
  const attach = () => { try { attachApi(); } catch (e) { console.warn(LOG, "api not attached", e); } };
  run("init", () => {
    try {
      if (game.system.id !== SYSTEM) return;
      registerSettings();
      registerHooks();
      attach();
      run("ready", () => { attach(); syncAll(); });
    } catch (e) { console.warn(LOG, "start failed", e); }
  });
}

export function stop() {
  for (const [name, id] of hookIds.splice(0)) { try { Hooks.off(name, id); } catch { /* gone */ } }
  document.querySelectorAll("[data-ipc-chargen]").forEach((el) => el.remove());
  started = false;
}
