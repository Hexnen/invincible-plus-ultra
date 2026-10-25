/* Hot Pan quiet notices, part of Invincible - Plus Ultra. Started from scripts/module.js by a guarded dynamic import (start() below).
   Hot Pan & Zoom! (module "hot-pan") announces "Screen is remote controlled by the gamemaster!" / "Screen control has been released." (and the
   Auto Focus equivalents) on EVERY client through socketlib, by function reference, so the function cannot be replaced afterwards, and its own
   settings cannot silence every branch. So the one place that works is the notifications API: this wraps Notifications#notify (info / warn /
   error all go through it, client/applications/ui/notifications.mjs) and drops ONLY a notice whose text is exactly one of those hand-over
   messages. The texts are built at call time from Hot Pan's own localization (game.i18n "hot-pan.*", as its Config.localize does), so a
   language change or an edited translation keeps matching. Everything else passes through untouched (same this, args and return value). */
const MOD = "invincible-plus-ultra";
const HOTPAN = "hot-pan";
const KEY = "hotpanQuiet";
const FLAG = Symbol.for(`${MOD}.hotpanQuiet`);
const TITLE_FALLBACK = "Hot Pan & Zoom!";

const STR = {
  en: { name: "Hot Pan: hide notices", hint: "Hide the \"Screen is remote controlled by the gamemaster\" / \"Screen control has been released\" notices of Hot Pan & Zoom! (this client only). Other Hot Pan messages and all other notifications are not affected." },
  pl: { name: "Hot Pan: ukryj komunikaty", hint: "Ukrywa komunikaty Hot Pan & Zoom! o przejęciu i oddaniu kontroli nad ekranem (tylko ten klient). Pozostałe komunikaty Hot Pan i wszystkie inne powiadomienia działają bez zmian." }
};
const tr = (k) => { const l = globalThis.game?.i18n?.lang === "pl" ? "pl" : "en"; return STR[l][k]; };

let started = false;

const enabled = () => { try { return game.settings.get(MOD, KEY) !== false; } catch { return true; } };
const loc = (key) => { try { const k = `${HOTPAN}.${key}`; return game.i18n.has(k) ? game.i18n.localize(k) : ""; } catch { return ""; } };
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => "\\" + c);

/* Is this notification text one of Hot Pan's control hand-over messages? (exact, case-sensitive, after trim) */
function isHandOver(message) {
  if (typeof message !== "string") return false;
  const text = message.trim();
  if (!text || text.length > 400) return false;
  const title = game.modules.get(HOTPAN)?.title || TITLE_FALLBACK;
  const titles = title === TITLE_FALLBACK ? [title] : [title, TITLE_FALLBACK];
  for (const ti of titles) {
    for (const key of ["onOffUIMessage.whenON", "onOffUIMessage.whenOFF", "autoFocus.msg.whenOFF"]) {
      const s = loc(key);
      if (s && text === `${ti} ${s}`.trim()) return true;
    }
    const on = loc("autoFocus.msg.whenON");
    if (on) {
      const re = new RegExp(`^${escapeRe(`${ti} ${on}`).replace(escapeRe("{mode}"), "[^\n]{1,80}")}$`);
      if (re.test(text)) return true;
    }
  }
  return false;
}

function install() {
  try {
    if (!game.modules.get(HOTPAN)?.active) return;
    const n = ui?.notifications;
    const orig = n?.notify;
    if (typeof orig !== "function" || orig[FLAG]) return;
    const wrapped = function (message, ...rest) {
      try {
        if (enabled() && isHandOver(message)) {
          const nop = () => {};
          return { id: -1, type: "info", message: String(message), active: false, progress: false, permanent: false, console: false, pct: 0, remove: nop, update: nop };
        }
      } catch (err) { console.warn(`${MOD} | hot-pan quiet notices`, err); }
      return orig.call(this, message, ...rest);
    };
    wrapped[FLAG] = true;
    n.notify = wrapped;
  } catch (err) { console.warn(`${MOD} | hot-pan quiet notices not installed`, err); }
}

function registerSettings() {
  try {
    if (game.settings.settings.has(`${MOD}.${KEY}`)) return;
    game.settings.register(MOD, KEY, { name: tr("name"), hint: tr("hint"), scope: "client", config: true, type: Boolean, default: true });
  } catch (err) { console.warn(`${MOD} | hot-pan quiet setting`, err); }
}

export function start(phases = {}) {
  if (started) return;
  started = true;
  const run = (name, fn) => { if (phases[name]) fn(); else Hooks.once(name, fn); };
  run("init", registerSettings);
  run("ready", install);
}
