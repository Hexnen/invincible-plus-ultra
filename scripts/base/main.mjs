/* Team & Base card: entry point (B3 data layer, B4 windows + entry points in entry.mjs, B4b: the card is an Actor). start() is called from a guarded dynamic
   import at the tail of scripts/module.js: registers the settings (init) and the base actor sheet (sheet.mjs, chosen only for flagged actors), adds the
   Actors-directory button, keeps base ownership in line with the heroes (active GM only), migrates old journal cards (GM), registers the GM relay
   and attaches api.base. Does nothing heavy until the API is used. */
import * as S from "./store.mjs";
import * as Cat from "./catalog.mjs";
import * as Relay from "./relay.mjs";
import { attach } from "./api.mjs";
import * as Entry from "./entry.mjs";
import * as Dir from "./directory.mjs";
import * as Lock from "./lock.mjs";
import { t } from "./lang.mjs";

const MOD = S.MODULE_ID;
let started = false;

function registerSettings() {
  const has = (key) => game.settings.settings.has(`${MOD}.${key}`);
  if (!has("baseHeaderButton")) {
    game.settings.register(MOD, "baseHeaderButton", {
      name: t("IPB.Settings.HeaderButton.Name"), hint: t("IPB.Settings.HeaderButton.Hint"), scope: "client", config: true, type: Boolean, default: true, onChange: () => Entry.syncAll()
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

/** Register the base sheet for the host type: never the default (canBeDefault false), chosen per document through flags.core.sheetClass. Idempotent. */
async function registerSheet() {
  const { BaseSheet } = await import("./sheet.mjs");
  if (CONFIG.Actor.sheetClasses?.[S.HOST_TYPE]?.[S.SHEET_ID]) return;
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MOD, BaseSheet, {
    types: [S.HOST_TYPE], makeDefault: false, canBeDefault: false, label: () => t("IPB.Sheet.Label")
  });
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
      registerSheet().catch((e) => console.warn(`${MOD} | base sheet registration failed`, e));
      Hooks.on("renderActorDirectory", Dir.decorate);
      Hooks.on("preCreateActor", S.forceSheetOnCreate);
      Hooks.on("preDeleteActor", S.guardDelete);
      Hooks.on("preUpdateActor", Lock.guard);
      // a hero joined / left a team (its link flag changed), or a base changed its policy: the active GM re-grants the base's ownership
      Hooks.on("updateActor", (actor, change) => {
        const f = change?.flags?.[MOD];
        if (S.isCard(actor)) { if (f?.base?.policy) scheduleReconcile(); }
        else if (f?.base !== undefined || f?.["-=base"] !== undefined) scheduleReconcile();
      });
      run("ready", () => {
        attach(); Relay.start(); Cat.start(); Entry.start(); ui.actors?.render();
        registerSheet().catch((e) => console.warn(`${MOD} | base sheet registration failed`, e));        // late import: register now (game.ready, so it applies at once)
        if (iAmActiveGM()) S.migrate().then((r) => { if (r.migrated.length) console.info(`${MOD} | base: ${r.migrated.length} journal card(s) converted to actors`, r); scheduleReconcile(); })
          .catch((e) => console.warn(`${MOD} | base: migration failed`, e));
        else scheduleReconcile();
      });
    } catch (e) { console.warn(`${MOD} | base card failed to start`, e); }
  });
}
