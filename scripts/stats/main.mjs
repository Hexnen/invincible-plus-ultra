/* Plus Ultra STATISTICS and the PLUS ULTRA MENU: entry point, called from a guarded dynamic import at the tail of scripts/module.js.
   init: the (unbound) keybinding, the store's change hooks, the Journals sidebar filter. ready: the menu group in the scene controls with
   its first tool, api.stats and api.menu, and on the active GM's client the capture (and the catch-up of the chat written while no GM was
   connected). Nothing here costs a frame during play: the capture does a little work per event or chat card on one client, and the store
   writes at most once per 0.8 s; the other clients only mark their cache stale until the window is opened. */
import * as Store from "./store.mjs";
import * as Capture from "./capture.mjs";
import * as P from "./pure.mjs";
import * as Menu from "../menu.mjs";
import { t } from "./lang.mjs";

const MOD = Store.MOD;
let started = false, capturing = false;
const openStats = (o) => import("./app.mjs").then((m) => m.open(o)).catch((e) => console.warn(`${MOD} | statistics window`, e));
const sections = [];      // fight sections registered before the window was loaded (api.stats.fightSections)

async function evaluate() {
  try {
    if (!Store.isWriter()) return;
    if (!capturing) {                    // the hooks are put on once; each of them asks isWriter() itself, so a GM hand-over needs nothing more
      capturing = true;
      let stateOf = null;
      try { stateOf = (await import("../tactics/source.mjs")).tacticsState; } catch { /* no tactics: loose rolls only */ }
      Capture.start({ stateOf });
      import("./titles.mjs").then((m) => m.start(game.modules.get(MOD)?.api?.stats ?? {})).catch((e) => console.warn(`${MOD} | stats titles not started`, e));      // AWRD
    }
    const n = Capture.catchUp();
    if (n) console.log(`${MOD} | stats: ${n} chat cards caught up`);
  } catch (e) { console.warn(`${MOD} | stats capture not started`, e); }
}

export function start(phases = {}) {
  if (started) return;
  started = true;
  const run = (name, fn) => { if (phases[name]) fn(); else Hooks.once(name, fn); };
  run("init", () => {
    try {
      if (game.system.id !== "invincible") return;
      if (!game.keybindings.actions.has(`${MOD}.statsOpen`)) game.keybindings.register(MOD, "statsOpen", { name: t("IPU.Key.stats.Name"), hint: t("IPU.Key.stats.Hint"), editable: [], restricted: false, onDown: () => { openStats(); return true; } });
      Hooks.on("renderJournalDirectory", Store.hideInDirectory);
      for (const hk of ["createJournalEntryPage", "updateJournalEntryPage", "deleteJournalEntryPage", "createJournalEntry", "updateJournalEntry", "deleteJournalEntry"]) Hooks.on(hk, (doc) => { if (Store.isStats(doc)) Store.changed(); });
      Menu.start();
      Menu.add({ name: "stats", title: () => t("IPU.Menu.stats"), icon: "fa-solid fa-chart-simple", order: 1, onChange: () => openStats() });
      run("ready", () => {
        const mod = game.modules.get(MOD);
        if (mod) {
          mod.api ??= {};
          mod.api.menu = { add: Menu.add, remove: Menu.remove, list: Menu.list };
          mod.api.stats = {
            open: openStats, data: () => Store.all(), pure: P,
            /* the next package (titles) registers a renderer here; see app.mjs FIGHT SECTIONS and pure.newFight TITLES */
            fightSections: sections,
            /* AWRD: `meta` (titles-pure: { v, small? }) is kept as rec.tm: the titles were counted (none for a fight too small for them) */
            setTitles: async (f, titles, meta) => { if (!Store.isWriter()) return false; const rec = Store.fightRec(f); if (!rec) return false; Store.fight(f, { ...rec, titles: Array.isArray(titles) ? titles.slice(0, 40) : [], ...(meta && typeof meta === "object" ? { tm: meta } : {}) }); await Store.settle(); return true; },
            deleteFight: async (f) => { if (!Store.isWriter()) return false; Store.dropFight(f); await Store.settle(); return true; },
            reset: Store.reset, settle: Store.settle
          };
          import("./app.mjs").then((m) => { for (const fn of sections) m.fightSections.push(fn); sections.length = 0; mod.api.stats.fightSections = m.fightSections; }).catch(() => { /* loaded on first open */ });
        }
        evaluate();
        const re = () => setTimeout(() => evaluate(), 800);
        Hooks.on("userConnected", re);
        Hooks.on("updateUser", (u, ch) => { if ("active" in ch || "role" in ch) re(); });
      });
    } catch (e) { console.warn(`${MOD} | statistics failed to start`, e); }
  });
}
