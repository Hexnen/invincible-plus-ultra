/* End-of-session panel: entry point (phase S2, data layer, no window). start() is called from a guarded dynamic import at the tail of scripts/module.js:
   registers the settings and the (unbound) keybinding at init, attaches api.session, starts the relay, and at ready wires the change notifications: world-setting changes,
   GM connect / disconnect (banner state), hero deletion and ownership changes, and the "the GM started the review" notice for players (an Open button). */
import * as Store from "./store.mjs";
import * as Relay from "./relay.mjs";
import { attach, sessionApi } from "./api.mjs";
import { t } from "./lang.mjs";

const MOD = Store.MOD;
let started = false, lastId = undefined;

/** A small self-contained notice with an Open button (S3 may restyle it); removes itself after 25 s. */
function toast(text, onOpen) {
  try {
    document.getElementById("ipl-session-toast")?.remove();
    const el = document.createElement("div");
    el.id = "ipl-session-toast"; el.setAttribute("role", "status");
    el.style.cssText = "position:fixed;right:16px;bottom:72px;z-index:99999;max-width:340px;display:flex;gap:10px;align-items:center;padding:10px 12px;background:#14161c;color:#f2efe6;border:2px solid #f4c20d;border-radius:4px;font:14px/1.3 system-ui,sans-serif;box-shadow:0 4px 16px #000a";
    const span = document.createElement("span"); span.textContent = text;
    const b = document.createElement("button"); b.type = "button"; b.textContent = t("IPL.Session.Toast.Open"); b.style.cssText = "cursor:pointer;padding:4px 10px;font:inherit;font-weight:700;background:#f4c20d;color:#111;border:0;border-radius:3px";
    b.addEventListener("click", () => { el.remove(); onOpen(); });
    el.append(span, b); document.body.append(el);
    setTimeout(() => el.remove(), 25000);
  } catch { /* no DOM */ }
}

function announce(info) {
  const s = info.session;
  if (!s || s.state !== "open") { if (!s) lastId = null; return; }
  if (lastId === s.id) return;
  const first = lastId === undefined;                  // the value loaded with the world: not an announcement
  lastId = s.id;
  if (first || game.user.isGM || s.gm === game.user.id) return;
  if (Store.setting(Store.SETTING_AUTO, true) === false || Store.setting(Store.SETTING_ALLOW, true) === false) return;
  toast(t("IPL.Session.Toast.Started", { gm: game.users.get(s.gm)?.name ?? "GM" }), () => sessionApi.open());
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
      run("ready", () => {
        attach(); Relay.start();
        lastId = Store.current()?.id ?? undefined;
        if (lastId === undefined) lastId = null;
        Store.subscribe(announce);
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
