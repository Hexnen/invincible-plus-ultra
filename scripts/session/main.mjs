/* End-of-session panel: entry point (phase S2, data layer, no window). start() is called from a guarded dynamic import at the tail of scripts/module.js:
   registers the settings and the (unbound) keybinding at init, attaches api.session, starts the relay, and at ready wires the change notifications: world-setting changes,
   GM connect / disconnect (banner state), hero deletion and ownership changes, and the "the GM started the review" notice for players (an Open button). */
import * as Store from "./store.mjs";
import * as Relay from "./relay.mjs";
import { attach, sessionApi } from "./api.mjs";
import { t } from "./lang.mjs";
import { showNotice, removeNotice } from "./ui/toast.mjs";   // S6: the restyled player notice
import * as Entry from "./ui/entry.mjs";                  // S3: opener registration, Actors directory button, settings menu (the window itself loads on first open)

const MOD = Store.MOD;
let started = false, lastId = undefined;

/** The player notice (Open + close button) lives in ui/toast.mjs since S6; same call shape as before. */
const toast = showNotice;

function announce(info) {
  const s = info.session;
  if (!s || s.state !== "open") { if (!s) lastId = null; removeNotice(); return; }
  if (lastId === s.id) return;
  const first = lastId === undefined;                  // the value loaded with the world: not an announcement
  lastId = s.id;
  if (first || game.user.isGM || s.gm === game.user.id) return;
  if (Store.setting(Store.SETTING_AUTO, true) === false || Store.setting(Store.SETTING_ALLOW, true) === false) return;
  toast(t("IPL.Session.Toast.Started", { gm: game.users.get(s.gm)?.name ?? "GM" }), () => sessionApi.open());
}

/** S4-15: a player who reloads (or joins) while a review is open never saw the "started" toast: show a longer one once, on load. */
function cueOnLoad() {
  const s = Store.current();
  if (!s || s.state !== "open" || game.user.isGM || Store.isStaff(game.user)) return;
  if (Store.setting(Store.SETTING_AUTO, true) === false || Store.setting(Store.SETTING_ALLOW, true) === false) return;
  toast(t("IPL.Session.Toast.Running"), () => sessionApi.open(), 90000);
}

export function start(phases = {}) {
  if (started) return;
  started = true;
  const run = (name, fn) => { if (phases[name]) fn(); else Hooks.once(name, fn); };
  run("init", () => {
    try {
      if (game.system.id !== "invincible") return;
      Store.registerSettings();
      attach();
      if (!game.keybindings.actions.has(`${MOD}.sessionPanel`)) {
        game.keybindings.register(MOD, "sessionPanel", { name: t("IPL.Session.Key.Open.Name"), hint: t("IPL.Session.Key.Open.Hint"), editable: [], restricted: false, onDown: () => { sessionApi.open(); return true; } });
      }
      Entry.registerMenu();
      run("ready", () => {
        attach(); Relay.start();
        Entry.register();
        Hooks.on("renderActorDirectory", Entry.decorateDirectory);
        try { ui.actors?.render?.(); } catch { /* sidebar not ready */ }
        lastId = Store.current()?.id ?? undefined;
        if (lastId === undefined) lastId = null;
        Store.subscribe(announce);
        cueOnLoad();
        const status = (extra = {}) => Store.notify("status", extra);
        // GM connects / disconnects: the banner state (api.session.status().gmOnline) changes
        Hooks.on("userConnected", () => status());
        Hooks.on("updateUser", (_u, ch) => { if ("active" in ch || ch.role !== undefined) status(); });
        // heroes: deleted (the UI shows "deleted hero"), ownership changed (the next click is checked live; the UI re-reads who may tick what)
        const inSession = (actor) => !!Store.current()?.heroes.some((h) => h.id === actor?.id);
        Hooks.on("deleteActor", (actor) => { if (inSession(actor)) Store.notify("actor", { actorId: actor.id, what: "deleted" }); });
        Hooks.on("updateActor", (actor, change) => { if (inSession(actor) && (change?.ownership !== undefined || change?.name !== undefined || change?.img !== undefined)) Store.notify("actor", { actorId: actor.id, what: change.ownership !== undefined ? "ownership" : "info" }); });
        if (Store.iAmActiveGM() && sessionApi.status().resumable) console.info(`${MOD} | session: an award was interrupted; call api.session.award() (or undo()) to continue`);
      });
    } catch (e) { console.warn(`${MOD} | end-of-session data layer failed to start`, e); }
  });
}
