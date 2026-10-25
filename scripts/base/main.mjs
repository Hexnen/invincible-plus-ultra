/* Team & Base card, phase B3: entry point (no UI yet). start() is called from a guarded dynamic import at the tail of scripts/module.js:
   registers the settings (init), hides the cards from the Journal sidebar, keeps card ownership in line with the heroes (active GM only),
   registers the GM relay and attaches api.base. Does nothing heavy until the API is used. */
import * as S from "./store.mjs";
import * as Cat from "./catalog.mjs";
import * as Relay from "./relay.mjs";
import { attach } from "./api.mjs";
import { t } from "./lang.mjs";

const MOD = S.MODULE_ID;
let started = false;

function registerSettings() {
  const has = (key) => game.settings.settings.has(`${MOD}.${key}`);
  if (!has(S.SETTING_SHOW)) {
    game.settings.register(MOD, S.SETTING_SHOW, {
      name: t("IPB.Settings.ShowInJournal.Name"), hint: t("IPB.Settings.ShowInJournal.Hint"), scope: "client", config: true,
      type: Boolean, default: false, onChange: () => ui.journal?.render()
    });
  }
  if (!has("baseHeaderButton")) {
    game.settings.register(MOD, "baseHeaderButton", {
      name: t("IPB.Settings.HeaderButton.Name"), hint: t("IPB.Settings.HeaderButton.Hint"), scope: "client", config: true, type: Boolean, default: true
    });
  }
  if (!has(S.SETTING_PLAYERS_CREATE)) {
    game.settings.register(MOD, S.SETTING_PLAYERS_CREATE, {
      name: t("IPB.Settings.PlayersCreate.Name"), hint: t("IPB.Settings.PlayersCreate.Hint"), scope: "world", config: true, type: Boolean, default: false
    });
  }
}

const iAmActiveGM = () => game.user?.isGM && game.users.activeGM?.id === game.user.id;
let reconcileTimer = 0;
function scheduleReconcile() {
  if (!iAmActiveGM()) return;
  clearTimeout(reconcileTimer);
  reconcileTimer = setTimeout(() => { S.reconcileAll().catch((e) => console.warn(`${MOD} | base: ownership reconcile failed`, e)); }, 400);
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
      Hooks.on("renderJournalDirectory", S.hideInDirectory);
      // a hero joined / left a team, or the card policy changed: the active GM re-grants card ownership
      Hooks.on("updateActor", (_actor, change) => { if (change?.flags?.[MOD]?.base !== undefined || change?.flags?.[MOD]?.["-=base"] !== undefined) scheduleReconcile(); });
      Hooks.on("updateJournalEntry", (entry, change) => { if (S.isCard(entry) && change?.flags?.[MOD]?.base?.policy) scheduleReconcile(); });
      run("ready", () => { attach(); Relay.start(); Cat.start(); scheduleReconcile(); });
    } catch (e) { console.warn(`${MOD} | base card failed to start`, e); }
  });
}
