/* Tactical combat: the ONE entry point. start() is called from a guarded dynamic import at the tail of scripts/module.js.
   init:  the settings; api.tactics (idle); then, only when tactical combat runs on this world, the module's own Combat class.
   ready: the relay, the executor's hooks (roll messages, joining and leaving combatants), the change notifications for the widgets
          (api.tactics.subscribe), the minimal prompt dialogs.
   WHEN IT RUNS [D]: the world setting `tacticsEnabled` is on AND the module's card initiative is in charge (`tacticsInitiative` on and
   Year Zero Engine: Combat not active). The round driver and the action engine work on one state, so there is no half: without the
   own initiative there is no round for the engine to act in.
   - `tacticsEnabled` off (the default): nothing but the settings and an idle api.tactics exists. No Combat class, no socket listener,
     no hook, no executor: the module behaves exactly as before this feature, and the other parts keep reading yze-combat or the core
     tracker through scripts/yze.mjs.
   - yze-combat active: the same; the GM is told once when the setting is on.
   Everything is in try / catch: a failure here must not break the tracker. */
import * as Store from "./store.mjs";
import * as Relay from "./relay.mjs";
import * as Engine from "./engine.mjs";
import * as Klass from "./combat-class.mjs";
import * as Sys from "./system-adapter.mjs";
import * as Summons from "./summons.mjs";
import { setLive } from "./source.mjs";
import { attach, setRunning, isRunning, tacticsApi } from "./api.mjs";
import { setOddsLook, ODDS_LOOKS } from "../kit.mjs";      // U133 trial: the client switch of the chance's look
import * as Mv from "./movement.mjs";
import { t } from "./lang.mjs";
import * as V from "./view-pure.mjs";

const MOD = Store.MOD;
let started = false;
const last = new Map();        // combat id -> raw state + journal strings last announced

function registerSettings() {
  const has = (key) => game.settings.settings.has(`${MOD}.${key}`);
  const reg = (key, data) => { if (!has(key)) game.settings.register(MOD, key, data); };
  const name = (key) => ({ name: t(`ITAC.Settings.${key}.Name`), hint: t(`ITAC.Settings.${key}.Hint`) });
  reg("tacticsEnabled", { ...name("tacticsEnabled"), scope: "world", config: true, type: Boolean, default: false, requiresReload: true });      // spec 17
  reg("tacticsInitiative", { ...name("tacticsInitiative"), scope: "world", config: true, type: Boolean, default: true, requiresReload: true });
  reg("tacticsRedraw", { ...name("tacticsRedraw"), scope: "world", config: true, type: String, default: "everyRound",
    choices: { everyRound: t("ITAC.Redraw.everyRound"), firstRoundOnly: t("ITAC.Redraw.firstRoundOnly") } });      // [I2] [B2277]
  reg("tacticsPushOrder", { ...name("tacticsPushOrder"), scope: "world", config: true, type: String, default: "afterDefence",
    choices: { afterDefence: t("ITAC.PushOrder.afterDefence"), beforeDefence: t("ITAC.PushOrder.beforeDefence") } });      // [R3] [OQ-9]: read when a fight starts
  /* U53 / U57 / U58: feedback to the player, each user's own (client scope): the first-fight hints and which of them were already
     shown, the summary card, the volume of the two sounds (0 = off) */
  reg("tacticsHints", { ...name("tacticsHints"), scope: "client", config: true, type: Boolean, default: true, onChange: (on) => { try { tacticsApi.ui?.hintsSwitched?.(on); } catch { /* the surfaces are not up */ } } });
  reg("tacticsHintsSeen", { scope: "client", config: false, type: String, default: "[]" });
  reg("tacticsSummary", { ...name("tacticsSummary"), scope: "client", config: true, type: Boolean, default: true });
  reg("tacticsSoundVolume", { ...name("tacticsSoundVolume"), scope: "client", config: true, type: Number, range: { min: 0, max: 1, step: 0.05 }, default: 0.5 });
  /* U62: the size of the dock, the desk and their cards on this browser (a slider; separate from Foundry's interface scale) */
  reg("tacticsUiScale", { ...name("tacticsUiScale"), scope: "client", config: true, type: Number, range: { min: 80, max: 140, step: 5 }, default: 100, onChange: (v) => { try { tacticsApi.ui?.rescale?.(v); } catch { /* the surfaces are not up */ } } });
  /* U133 TRIAL (temporary, removed with the losing looks once the owner chose): how this client draws the chance of each target on the
     map. "off" = the words in the pill over the token, exactly as before; bars / ring / arrow = the kit's mark on the token (ui/board-pure
     oddsShow). Read by the board and the legend (kit.mjs setOddsLook). */
  reg("tacticsOddsLook", { ...name("tacticsOddsLook"), scope: "client", config: true, type: String, default: "off",
    choices: Object.fromEntries(["off", ...ODDS_LOOKS].map((k) => [k, t(`ITAC.OddsLook.${k}`)])),
    onChange: (v) => { setOddsLook(v); try { tacticsApi.ui?.refresh?.(); } catch { /* the surfaces are not up */ } } });
  try { setOddsLook(game.settings.get(MOD, "tacticsOddsLook")); } catch { /* not readable yet: off */ }
}
/** what stands in the way of tactical combat on this world: null (it runs) | "off" | "yze" | "noInitiative" */
export function blocker() {
  try {
    if (game.system.id !== Sys.SYSTEM_ID) return "off";
    if (Store.setting("tacticsEnabled", false) !== true) return "off";
    if (game.modules.get("yze-combat")?.active) return "yze";
    if (Store.setting("tacticsInitiative", true) === false) return "noInitiative";
    return null;
  } catch { return "off"; }
}

const rawOf = (combat) => { const f = combat?.flags?.[MOD]?.tactics; return `${typeof f?.state === "string" ? f.state : ""}\n${typeof f?.log === "string" ? f.log : ""}`; };
function announce(combat) {
  try {
    const raw = rawOf(combat);
    if (last.get(combat.id) === raw) return;
    last.set(combat.id, raw);
    Store.notify({ kind: "state", combat, state: Store.stateOf(combat) });
  } catch (e) { console.warn(`${MOD} | tactics announce`, e); }
}

/** ready: everything that listens. Only called when tactical combat runs on this world. */
async function startRunning() {
  Relay.start();
  Engine.start();
  const Prompts = await import("./ui/prompts.mjs");
  Klass.setEndSceneAsk((combat) => Prompts.sceneEnd(combat));
  Store.subscribe(() => Prompts.sync());
  /* the designed surfaces (ui/main.mjs: the action dock and the GM desk); when they cannot start, the minimal dialogs above stay in charge */
  /* one more try after a pause: a module fetch that fails once (a busy server) must not leave a player on the fallback dialogs for the whole session */
  const load = () => import("./ui/main.mjs").catch(() => new Promise((r) => setTimeout(r, 1500)).then(() => import(`./ui/main.mjs?retry=${Date.now()}`)));
  try { const UI = await load(); if (UI.start()) Prompts.setSurfaces(true); } catch (e) { console.warn(`${MOD} | tactics surfaces failed to start`, e); }
  Hooks.on("updateCombat", (combat, changes) => { if (changes?.flags?.[MOD] !== undefined || "round" in (changes ?? {}) || "turn" in (changes ?? {})) announce(combat); });
  Hooks.on("createCombat", (combat) => announce(combat));
  Hooks.on("deleteCombat", (combat) => { last.delete(combat.id); Store.notify({ kind: "deleted", combat, state: null }); Summons.clearCopies(combat.id); });   // D98
  Hooks.on("combatStart", () => Prompts.sync());
  Hooks.on("preCreateChatMessage", (m) => Sys.keepRollPrivate(m));       // U7: a roll for the GM alone stays so when it is pushed
  // joining and leaving (spec 3.3): the executor brings the state in line
  Hooks.on("createCombatant", (c) => Engine.scheduleRoster(c.parent));
  Hooks.on("deleteCombatant", (c) => Engine.scheduleRoster(c.parent));
  Hooks.on("updateCombatant", (c, changes) => { if (changes && ("defeated" in changes || "actorId" in changes || "tokenId" in changes || changes.flags?.[MOD]?.tactics !== undefined)) Engine.scheduleRoster(c.parent); });
  Hooks.on("userConnected", () => Prompts.sync());                          // a prompt of a player who left falls to the executor
  /* U113 (view-pure.hideFollows): in a running fight the token's and the combatant's "hidden" are one switch. Carried on the client of
     the GM who flipped one (the token HUD, the tracker's eye), never by anybody else: no echo, no second writer. */
  const fighting = (c) => { try { return !!c && !!Store.stateOf(c); } catch { return false; } };
  Hooks.on("updateToken", (td, ch, _o, userId) => {
    try {
      if (userId !== game.user.id || !Store.isStaff(game.user) || !ch || !("hidden" in ch)) return;
      for (const c of game.combats ?? []) if (fighting(c)) for (const cb of c.combatants) if (cb.tokenId === td.id && cb.sceneId === td.parent?.id && V.hideFollows(ch.hidden, cb.hidden)) cb.update({ hidden: ch.hidden }).catch(() => {});
    } catch (e) { console.warn(`${MOD} | tactics: token hidden`, e); }
  });
  Hooks.on("updateCombatant", (cb, ch, _o, userId) => {
    try {
      if (userId !== game.user.id || !Store.isStaff(game.user) || !ch || !("hidden" in ch) || !fighting(cb.parent)) return;
      const td = cb.token;
      if (td && V.hideFollows(ch.hidden, td.hidden)) td.update({ hidden: ch.hidden }).catch(() => {});
    } catch (e) { console.warn(`${MOD} | tactics: combatant hidden`, e); }
  });
  for (const c of game.combats ?? []) last.set(c.id, rawOf(c));
  Prompts.sync();
  const moveHost = { ...Engine.moveHost(), request: (req) => tacticsApi.request(req) };
  Mv.install(moveHost); Hooks.on("canvasReady", () => Mv.install(moveHost));      // P3: step listener, the map's rules driver, cost confirmation on a dragged token
  if (Store.iAmExecutor()) {
    if (!Klass.installed()) ui.notifications.warn(t("ITAC.Note.NotInstalled"), { console: false });
    Sys.compat().then((list) => {
      const { changed, closed } = Sys.compatNotes(list);
      if (changed.length || closed.length) console.warn(`${MOD} | tactics: system compatibility`, list);
      if (changed.length) ui.notifications?.warn(t("ITAC.warn.compat", { names: changed.join(", ") }));
      if (closed.length) ui.notifications?.warn(t("ITAC.warn.packsClosed", { names: closed.join(", ") }), { permanent: false });      // U73: the server's matter, not the system's
    }).catch(() => {});
  }
}

export function start(phases = {}) {
  if (started) return;
  started = true;
  const run = (name, fn) => { if (phases[name]) fn(); else Hooks.once(name, fn); };
  run("init", () => {
    try {
      if (game.system.id !== Sys.SYSTEM_ID) { setLive(false); return; }
      registerSettings();
      attach();
      const why = blocker();
      setRunning(!why); setLive(!why);
      if (!why) Klass.install({ late: !!phases.init });        // the import resolved after init: documents may already exist
      run("ready", async () => {
        try {
          attach();
          /* D109: a GM's client writes the language it reads on its own user: a player's client says an intention (only the GMs see it, ui/board.mjs) in it */
          try { const u = game.user, lang = game.i18n?.lang; if (!why && u?.isGM && lang && typeof u.setFlag === "function" && u.getFlag(MOD, "lang") !== lang) u.setFlag(MOD, "lang", lang).catch(() => {}); } catch { /* the intention keeps the player's words */ }
          if (!why) await startRunning();
          else if (why !== "off" && game.user.isGM) ui.notifications.warn(t(why === "yze" ? "ITAC.Note.Yze" : "ITAC.Note.NoInitiative"), { permanent: false, console: false });
        } catch (e) { console.warn(`${MOD} | tactical combat failed to start (ready)`, e); }
      });
    } catch (e) { console.warn(`${MOD} | tactical combat failed to start`, e); }
  });
}
export const running = isRunning;
/** Test helper: let start() run again (a reload of the world, as far as this file is concerned). */
export const _reset = () => { started = false; };
