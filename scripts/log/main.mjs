/* Activity log: entry point (phase L3, no UI). start() is called from a guarded dynamic import at the tail of scripts/module.js: registers the settings (init), hides the
   log journals in the sidebar, attaches api.log (ready), starts the relay and elects the scribe (the active GM client). Spec 7. */
import * as E from "./events.mjs";
import * as Store from "./store.mjs";
import * as Scribe from "./scribe.mjs";
import * as Relay from "./relay.mjs";
import { logApi } from "./api.mjs";

const MOD = E.MOD_ID;
let started = false;
const pl = () => game.i18n?.lang === "pl";
const T = (en, pln) => (pl() ? pln : en);

function registerSettings() {
  const has = (key) => game.settings.settings.has(`${MOD}.${key}`);
  const reg = (key, data) => { if (!has(key)) game.settings.register(MOD, key, data); };
  reg("logEnabled", { name: T("Activity log", "Dziennik aktywności"), hint: T("Record what happens to superheroes and team bases (who, when, what changed). Needs a GM connected.", "Zapisuj, co dzieje się z superbohaterami i bazami drużyn (kto, kiedy, co się zmieniło). Wymaga połączonego MG."), scope: "world", config: true, type: Boolean, default: true, onChange: () => Scribe.evaluate().then(() => Scribe.rescan()) });
  reg("logReadAccess", {
    name: T("Who can read a hero's log", "Kto czyta log bohatera"), hint: T("GM only, the hero's owners (default), or owners and observers.", "Tylko MG, właściciele bohatera (domyślnie) albo właściciele i obserwatorzy."),
    scope: "world", config: true, type: String, default: "owners", choices: { gm: T("GM only", "Tylko MG"), owners: T("Owners", "Właściciele"), observers: T("Owners and observers", "Właściciele i obserwatorzy") },
    onChange: async () => { if (Scribe.isScribe()) for (const a of game.actors) if (Scribe.state.states.has(a.id)) await Store.reconcile(a).catch(() => {}); }
  });
  reg("logRetainEntries", { name: T("Log entries kept per hero", "Wpisów logu na bohatera"), hint: T("Oldest blocks are trimmed beyond this (bases keep 60 percent). 0 = keep everything.", "Starsze bloki są przycinane powyżej tej liczby (bazy 60 procent). 0 = bez limitu."), scope: "world", config: true, type: Number, default: E.POLICY.retainHero, range: { min: 0, max: 50000, step: 250 } });
  reg("logPlayerNotes", { name: T("Players may add notes to their log", "Gracze mogą dodawać notatki do logu"), scope: "world", config: true, type: Boolean, default: true });
  reg("logCombat", { name: T("Log combat events", "Loguj zdarzenia walki"), scope: "world", config: true, type: Boolean, default: true });
  reg("logActorTypes", { scope: "world", config: false, type: String, default: "superhero" });
  reg("logScope", { scope: "world", config: false, type: String, default: "", onChange: () => { Scribe.rescan().catch(() => {}); } });
  reg("logPolicy", { scope: "world", config: false, type: String, default: "" });
  reg("logRevealJournals", { name: T("Show the log journals in the sidebar", "Pokaż dzienniki logu na pasku bocznym"), hint: T("They are hidden by default; do not edit them by hand.", "Domyślnie ukryte; nie edytuj ich ręcznie."), scope: "client", config: true, type: Boolean, default: false, onChange: () => ui.journal?.render() });
  reg("logDensity", { scope: "client", config: false, type: String, default: "compact" });
  reg("logShowMinor", { scope: "client", config: false, type: Boolean, default: false });
}

export function start(phases = {}) {
  if (started) return;
  started = true;
  const run = (name, fn) => { if (phases[name]) fn(); else Hooks.once(name, fn); };
  run("init", () => {
    try {
      if (game.system.id !== "invincible") return;
      registerSettings();
      Hooks.on("renderJournalDirectory", Store.hideInDirectory);
      for (const h of ["createJournalEntryPage", "updateJournalEntryPage", "deleteJournalEntryPage"]) {
        Hooks.on(h, (page, a, b) => {
          const j = page.parent;
          if (!Store.isLogJournal(j)) return;
          const aid = j.flags[MOD].log.kind === "gm" ? (String(page.name).split(".")[0] || null) : j.id;
          Store.invalidate();
          const ch = h === "updateJournalEntryPage" ? Object.keys(a?.flags?.[MOD]?.log?.e ?? {}) : Object.keys(page.flags?.[MOD]?.log?.e ?? {});
          Store.emitChange({ actorId: aid, op: h.replace("JournalEntryPage", ""), ids: ch });
        });
      }
      for (const h of ["updateJournalEntry", "deleteJournalEntry", "createJournalEntry"]) Hooks.on(h, (j) => { if (Store.isLogJournal(j)) Store.invalidate(); });
      run("ready", () => {
        const mod = game.modules.get(MOD);
        if (mod) (mod.api ??= {}).log = logApi;
        Relay.start();
        Scribe.evaluate().catch((e) => console.warn(`${MOD} | log: scribe failed to start`, e));
        const re = () => setTimeout(() => Scribe.evaluate().catch(() => {}), 600);
        Hooks.on("userConnected", re);
        Hooks.on("updateUser", (u, ch) => { if ("active" in ch) re(); });
        if (game.user.isGM) ui.journal?.render();
      });
    } catch (e) { console.warn(`${MOD} | activity log failed to start`, e); }
  });
}
