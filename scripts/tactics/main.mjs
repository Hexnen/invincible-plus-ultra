/* Tactical combat, package P1: entry point. start() is called from a guarded dynamic import at the tail of scripts/module.js.
   init:  the settings, the module's own Combat class (card initiative, combat-class.mjs), api.tactics.
   ready: the relay, the change notifications (hook "invincible-plus-ultra.tactics" + api.tactics.subscribe), joining and leaving
          combatants (executor), the minimal prompt dialogs.
   With `tacticsInitiative` off, or while Year Zero Engine: Combat is the active tracker, nothing of the tracker is touched: the class is
   not installed and the other parts of the module keep reading yze-combat through scripts/yze.mjs. `tacticsEnabled` only chooses the
   mode a new fight starts in (tactical: rules enforced; free: tracked, nothing refused), spec 1.4.
   Everything is in try / catch: a failure here must not break the tracker. */
import * as Store from "./store.mjs";
import * as Relay from "./relay.mjs";
import * as GM from "./gm.mjs";
import * as Klass from "./combat-class.mjs";
import { attach } from "./api.mjs";
import { t } from "./lang.mjs";

const MOD = Store.MOD;
let started = false;
const last = new Map();        // combat id -> raw state string last announced

function registerSettings() {
  const has = (key) => game.settings.settings.has(`${MOD}.${key}`);
  const reg = (key, data) => { if (!has(key)) game.settings.register(MOD, key, data); };
  const name = (key) => ({ name: t(`ITAC.Settings.${key}.Name`), hint: t(`ITAC.Settings.${key}.Hint`) });
  reg("tacticsEnabled", { ...name("tacticsEnabled"), scope: "world", config: true, type: Boolean, default: false });
  reg("tacticsInitiative", { ...name("tacticsInitiative"), scope: "world", config: true, type: Boolean, default: true, requiresReload: true });
  reg("tacticsRedraw", { ...name("tacticsRedraw"), scope: "world", config: true, type: String, default: "everyRound",
    choices: { everyRound: t("ITAC.Redraw.everyRound"), firstRoundOnly: t("ITAC.Redraw.firstRoundOnly") } });      // [I2] [B2277]
}

const rawOf = (combat) => { const r = combat?.flags?.[MOD]?.tactics?.state; return typeof r === "string" ? r : ""; };
function announce(combat, kind = "state") {
  try {
    const raw = rawOf(combat);
    if (kind === "state" && last.get(combat.id) === raw) return;
    last.set(combat.id, raw);
    Store.notify({ kind, combat, state: Store.stateOf(combat) });
  } catch (e) { console.warn(`${MOD} | tactics announce`, e); }
}

export function start(phases = {}) {
  if (started) return;
  started = true;
  const run = (name, fn) => { if (phases[name]) fn(); else Hooks.once(name, fn); };
  run("init", () => {
    try {
      if (game.system.id !== "invincible") return;
      registerSettings();
      attach();
      const yze = !!game.modules.get("yze-combat")?.active;
      const own = Store.setting("tacticsInitiative", true) !== false && !yze;
      if (own) Klass.install({ late: !!phases.init })       // the import resolved after init: documents may already exist;
      run("ready", async () => {
        try {
          attach();
          Relay.start();
          const Prompts = await import("./ui/prompts.mjs");
          Klass.setEndSceneAsk((combat) => Prompts.sceneEnd(combat));
          Store.subscribe(() => Prompts.sync());
          Hooks.on("updateCombat", (combat, changes) => { if (changes?.flags?.[MOD] !== undefined || "round" in (changes ?? {}) || "turn" in (changes ?? {})) announce(combat); });
          Hooks.on("createCombat", (combat) => announce(combat));
          Hooks.on("deleteCombat", (combat) => { last.delete(combat.id); Store.notify({ kind: "deleted", combat, state: null }); });
          Hooks.on("combatStart", () => Prompts.sync());
          // joining and leaving (spec 3.3): the executor brings the state in line
          Hooks.on("createCombatant", (c) => GM.scheduleRoster(c.parent));
          Hooks.on("deleteCombatant", (c) => GM.scheduleRoster(c.parent));
          Hooks.on("updateCombatant", (c, changes) => { if (changes && ("defeated" in changes || "actorId" in changes || "tokenId" in changes || changes.flags?.[MOD]?.tactics !== undefined)) GM.scheduleRoster(c.parent); });
          // P1 has no engine to run a due trigger: the executor is told, the GM resolves it by hand (the action engine, P2, listens to the same hook)
          Hooks.on(Store.HOOK_GM, (info) => { try { for (const fx of info?.effects ?? []) if (fx.type === "trigger") ui.notifications.info(t("ITAC.Note.Trigger", { name: fx.trigger?.source?.name || fx.trigger?.run?.type || "?" }), { console: false }); } catch { /* no ui */ } });
          Hooks.on("userConnected", () => Prompts.sync());                          // a prompt of a player who left falls to the executor
          for (const c of game.combats ?? []) last.set(c.id, rawOf(c));
          Prompts.sync();
          if (game.user.isGM) {
            if (yze && Store.setting("tacticsEnabled", false) === true) ui.notifications.warn(t("ITAC.Note.Yze"), { permanent: false, console: false });
            else if (own && !Klass.installed()) ui.notifications.warn(t("ITAC.Note.NotInstalled"), { console: false });
          }
        } catch (e) { console.warn(`${MOD} | tactical combat failed to start (ready)`, e); }
      });
    } catch (e) { console.warn(`${MOD} | tactical combat failed to start`, e); }
  });
}
