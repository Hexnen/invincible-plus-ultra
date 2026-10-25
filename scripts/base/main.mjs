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
  // B9: GM settings-menu button "Team cards" (the manager window: open / duplicate / export / delete, import, new). The class is imported on the spot
  // (registerMenu needs it now); the window code itself stays light until opened.
  if (!game.settings.menus.has(`${MOD}.teamCards`)) {
    import("./picker.mjs").then(({ PickerApp }) => {
      if (game.settings.menus.has(`${MOD}.teamCards`)) return;
      game.settings.registerMenu(MOD, "teamCards", {
        name: t("IPB.Settings.Cards.Name"), label: t("IPB.Settings.Cards.Label"), hint: t("IPB.Settings.Cards.Hint"),
        icon: "fa-solid fa-people-roof", type: PickerApp, restricted: true
      });
    }).catch((e) => console.warn(`${MOD} | base: settings menu not registered`, e));
  }
  // B9: keybinding "Open my team card" (unbound by default so it cannot collide with another module; the user binds it in Configure Controls)
  if (!game.keybindings.actions.has(`${MOD}.openTeamCard`)) {
    game.keybindings.register(MOD, "openTeamCard", {
      name: t("IPB.Key.Open.Name"), hint: t("IPB.Key.Open.Hint"), editable: [], restricted: false,
      onDown: () => { Entry.openMine(); return true; }
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
      // a base was deleted by any path (directory, API, delete flow): the active GM clears the dangling link flags of its heroes (their Team text stays)
      Hooks.on("deleteActor", (actor) => {
        if (!iAmActiveGM() || !S.isCard(actor)) return;
        for (const h of game.actors.filter((a) => a.type === "superhero" && S.linkOf(a) === actor.id)) S.unlink(h).catch((e) => console.warn(`${MOD} | base: cannot clear the link of ${h.name}`, e));
      });
      // a JOURNAL card appearing at run time can only come from a GM tab running pre-actor module code: the active GM folds it into the actor card (or drops its twin)
      let legacyTimer = 0;
      Hooks.on("createJournalEntry", (j) => {
        if (!iAmActiveGM() || !Number.isInteger(j.flags?.[MOD]?.base?.v)) return;
        clearTimeout(legacyTimer);
        legacyTimer = setTimeout(() => { S.migrate().then((r) => { if (r.migrated.length) { console.info(`${MOD} | base: a stale GM tab made ${r.migrated.length} journal card(s); folded into actors`, r); scheduleReconcile(); } }).catch((e) => console.warn(`${MOD} | base: legacy card cleanup failed`, e)); }, 1500);
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
