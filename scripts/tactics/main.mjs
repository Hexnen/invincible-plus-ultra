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
import { setLive } from "./source.mjs";
import { attach, setRunning, isRunning } from "./api.mjs";
import { t } from "./lang.mjs";

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
  Hooks.on("updateCombat", (combat, changes) => { if (changes?.flags?.[MOD] !== undefined || "round" in (changes ?? {}) || "turn" in (changes ?? {})) announce(combat); });
  Hooks.on("createCombat", (combat) => announce(combat));
  Hooks.on("deleteCombat", (combat) => { last.delete(combat.id); Store.notify({ kind: "deleted", combat, state: null }); });
  Hooks.on("combatStart", () => Prompts.sync());
  // joining and leaving (spec 3.3): the executor brings the state in line
  Hooks.on("createCombatant", (c) => Engine.scheduleRoster(c.parent));
  Hooks.on("deleteCombatant", (c) => Engine.scheduleRoster(c.parent));
  Hooks.on("updateCombatant", (c, changes) => { if (changes && ("defeated" in changes || "actorId" in changes || "tokenId" in changes || changes.flags?.[MOD]?.tactics !== undefined)) Engine.scheduleRoster(c.parent); });
  Hooks.on("userConnected", () => Prompts.sync());                          // a prompt of a player who left falls to the executor
  for (const c of game.combats ?? []) last.set(c.id, rawOf(c));
  Prompts.sync();
  if (Store.iAmExecutor()) {
    if (!Klass.installed()) ui.notifications.warn(t("ITAC.Note.NotInstalled"), { console: false });
    Sys.compat().then((list) => { const badNames = list.filter((x) => !x.ok).map((x) => x.name); if (badNames.length) { console.warn(`${MOD} | tactics: system compatibility`, list); ui.notifications?.warn(t("ITAC.warn.compat", { names: badNames.join(", ") })); } }).catch(() => {});
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
