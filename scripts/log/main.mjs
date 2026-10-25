/* Activity log: entry point (phase L3, no UI). start() is called from a guarded dynamic import at the tail of scripts/module.js: registers the settings (init), hides the
   log journals in the sidebar, attaches api.log (ready), starts the relay and elects the scribe (the active GM client). Spec 7. */
import * as E from "./events.mjs";
import * as Store from "./store.mjs";
import * as Scribe from "./scribe.mjs";
import * as Relay from "./relay.mjs";
import { logApi } from "./api.mjs";
import * as L from "./lang.mjs";

const MOD = E.MOD_ID;
let started = false;
const S = (key, part) => L.t(`IPL.Settings.${key}.${part}`);

function registerSettings() {
  const has = (key) => game.settings.settings.has(`${MOD}.${key}`);
  const reg = (key, data) => { if (!has(key)) game.settings.register(MOD, key, data); };
  const txt = (key) => ({ name: S(key, "Name"), hint: S(key, "Hint") });   // strings live in lang.mjs (EN + PL); the privacy note is in logEnabled and logReadAccess
  reg("logEnabled", { ...txt("logEnabled"), scope: "world", config: true, type: Boolean, default: true, onChange: () => Scribe.evaluate().then(() => Scribe.rescan()) });
  reg("logReadAccess", {
    ...txt("logReadAccess"), scope: "world", config: true, type: String, default: "owners", choices: { gm: S("logReadAccess", "gm"), owners: S("logReadAccess", "owners"), observers: S("logReadAccess", "observers") },
    onChange: async () => { if (Scribe.isScribe()) for (const a of game.actors) if (Scribe.state.states.has(a.id)) await Store.reconcile(a).catch(() => {}); }
  });
  reg("logRetainEntries", { ...txt("logRetainEntries"), scope: "world", config: true, type: Number, default: E.POLICY.retainHero, range: { min: 0, max: 50000, step: 250 } });
  reg("logPlayerNotes", { ...txt("logPlayerNotes"), scope: "world", config: true, type: Boolean, default: true });
  reg("logCombat", { ...txt("logCombat"), scope: "world", config: true, type: Boolean, default: true });
  reg("logActorTypes", { scope: "world", config: false, type: String, default: "superhero" });
  reg("logScope", { scope: "world", config: false, type: String, default: "", onChange: () => { Scribe.rescan().catch(() => {}); } });
  reg("logPolicy", { scope: "world", config: false, type: String, default: "" });
  reg("logRevealJournals", { ...txt("logRevealJournals"), scope: "client", config: true, type: Boolean, default: false, onChange: () => ui.journal?.render() });
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
        import("./ui/hero-tab.mjs").then((m) => {                     // L4: the Log tab of the superhero sheet (adapters: parts, dom)
          logApi.ui = { setTabMode: m.setMode, status: m.status, viewOf: m.viewOf, refresh: m.refreshSheets };
          logApi.open = (target, o) => (target === "all" ? null : m.open(target, o));
          Object.defineProperty(logApi, "tabMode", { get: () => m.tab.mode, configurable: true });
          m.install();
        }).catch((e) => console.warn(`${MOD} | log tab not loaded (everything else is unaffected)`, e));
        Scribe.evaluate().catch((e) => console.warn(`${MOD} | log: scribe failed to start`, e));
        const re = () => setTimeout(() => Scribe.evaluate().catch(() => {}), 600);
        Hooks.on("userConnected", re);
        Hooks.on("updateUser", (u, ch) => { if ("active" in ch) re(); });
        if (game.user.isGM) ui.journal?.render();
      });
    } catch (e) { console.warn(`${MOD} | activity log failed to start`, e); }
  });
}
