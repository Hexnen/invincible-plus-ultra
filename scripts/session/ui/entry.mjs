/* End-of-session panel, phase S3: the ENTRY POINTS. This file is small and loaded with the data layer; the window itself (panel.mjs and its views, about 60 KB) is
   imported the first time somebody opens it. Wires: api.session.open() / close() (registerOpener), the keybinding (main.mjs already calls open()), the toast's Open
   button (same), the GM's "End session" button in the Actors directory header (a player gets "Review in progress" there only while a review runs), and the module
   settings menu entry. */
import * as Store from "../store.mjs";
import { sessionApi as api } from "../api.mjs";
import { t } from "../lang.mjs";

const MOD = Store.MOD;
const IDLE = "ips-panel";
let loading = null;
const load = () => (loading ??= import("./panel.mjs").catch((e) => { loading = null; console.warn(`${MOD} | session: the panel window failed to load`, e); throw e; }));

export function register() {
  api.registerOpener(async (opts) => (await load()).SessionPanel.open(opts), () => foundry.applications.instances.get(IDLE)?.close());
  // a review starting or ending changes what the directory button says: repaint the sidebar once when that flips
  let had = !!Store.current();
  Store.subscribe((info) => {
    const now = !!info.session;
    if (now === had) return;
    had = now;
    try { ui.actors?.render?.(); } catch { /* sidebar not ready */ }
  });
}

/** renderActorDirectory(app, element): the GM button "End session"; for a player only while a review is running. */
export function decorateDirectory(app, html) {
  try {
    const root = html instanceof HTMLElement ? html : html?.[0] ?? app?.element;
    const actions = root?.querySelector?.(".directory-header .header-actions");
    if (!actions) return;
    const running = !!Store.current();
    const show = Store.isStaff(game.user) || running;
    let btn = actions.querySelector(".ips-dir-btn");
    if (!show) { btn?.remove(); return; }
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button"; btn.className = "ips-dir-btn";
      btn.addEventListener("click", (ev) => { ev.preventDefault(); api.open(); });
      actions.append(btn);
    }
    const label = running ? t("IPL.Session.UI.Dir.running") : t("IPL.Session.UI.Dir.button");
    btn.dataset.running = running ? "1" : "0";
    btn.dataset.tooltip = t("IPL.Session.UI.Dir.tip");
    btn.setAttribute("aria-label", label);
    const ic = Object.assign(document.createElement("i"), { className: "fa-solid fa-flag-checkered" });
    ic.setAttribute("aria-hidden", "true");
    btn.replaceChildren(ic, Object.assign(document.createElement("span"), { textContent: label }));
  } catch (e) { console.warn(`${MOD} | session: directory button failed`, e); }
}

/** The settings-menu button: a tiny ApplicationV2 whose render() just opens the real panel (like the Table log menu). */
export function menuClass() {
  const { ApplicationV2 } = foundry.applications.api;
  return class SessionMenu extends ApplicationV2 {
    async render() { api.open(); return this; }
  };
}
export function registerMenu() {
  if (game.settings.menus.has(`${MOD}.sessionPanel`)) return;
  game.settings.registerMenu(MOD, "sessionPanel", { name: t("IPL.Session.UI.Menu.name"), label: t("IPL.Session.UI.Menu.label"), hint: t("IPL.Session.UI.Menu.hint"), icon: "fa-solid fa-flag-checkered", type: menuClass(), restricted: false });
}
