/* GMALL: the table's settings, the Foundry part. Started from scripts/module.js by a guarded dynamic import (start() below), like the
   other areas. What it does:
   - registers the world setting `lettersTable` (the table's engine preferences) and `tableMigrated`, and ONE settings menu
     ("Comic effects", restricted: false: the GM edits, a player sees the same window read-only) plus a Plus Ultra menu tool;
   - MIRROR: the lettering engine (scripts/letters/, vendored: not edited here) still keeps its preferences as client settings. Every seat
     copies the table's values into them (defs.seatValue: the seat's own reduced motion and Foundry photosensitive mode still apply there;
     the photosensitivity guard is pinned on), at start and on every change of the table's values, so a GM's change reaches every seat's
     next word without a reload. A player who changes one of them by hand (the engine's own window) gets the table's value back; a GM who
     does makes it the table's (the engine's window is then just another door to the same table settings);
   - MIGRATION (once per world, by the first GM seat after the update; GMALL-2): the GM's own earlier client values of every option this
     package moved from client to world become the table's (unless the world already holds a value), and his engine preferences become the
     table's engine preferences. A player's earlier own values are left untouched in his browser (unused; the engine ones are copied once
     to a backup key before the table's values replace them) and he gets one notice that the GM now chooses.
   The window itself is app.mjs (loaded on first open). */
import * as D from "./defs.mjs";
import { t } from "./lang.mjs";

const { MOD, NS, TABLE_KEY, MIGRATED_KEY } = D;
const LOG = `${MOD} (table settings) |`;
const BACKUP = `${MOD}.gmallEngineBackup`;      // localStorage: a player's own engine preferences before the first mirror (kept, unused)
const NOTICED = `${MOD}.gmallNoticed`;          // localStorage: the one-time notice was shown on this browser
let started = false, warned = false, applying = 0, refusedAt = 0, appMod = null;
const once = (e) => { if (!warned) { warned = true; console.warn(LOG, e); } };
const isGM = () => !!game.user?.isGM;
const has = (ns, k) => !!game.settings?.settings?.has?.(`${ns}.${k}`);

/* ---------- the seat ---------- */
export function seat() {
  let osReduced = false, photosensitive = false;
  try { osReduced = !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches; } catch { /* no media queries */ }
  try { photosensitive = has("core", "photosensitiveMode") && !!game.settings.get("core", "photosensitiveMode"); } catch { /* not there */ }
  return { osReduced, photosensitive };
}
export function table() { try { return D.cleanTable(game.settings.get(MOD, TABLE_KEY)); } catch { return D.cleanTable(null); } }
const same = (a, b) => a === b || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-9);

/** copy the table's engine preferences into this seat's engine settings (only what differs; synchronous: client settings) */
export function applySeat() {
  try {
    if (!has(NS, "enabled")) return 0;
    const want = D.seatValues(table(), seat());
    let n = 0;
    applying++;
    try {
      for (const [k, v] of Object.entries(want)) {
        if (v === undefined || !has(NS, k)) continue;
        let cur; try { cur = game.settings.get(NS, k); } catch { cur = undefined; }
        if (same(cur, v)) continue;
        game.settings.set(NS, k, v);    // client scope: written at once, the engine's onChange re-reads its preferences
        n++;
      }
    } finally { applying--; }
    return n;
  } catch (err) { once(err); return 0; }
}

/* a hand change of an engine preference on this seat (the engine's own window, a macro) */
function onClientSetting(key, value) {
  try {
    if (applying || typeof key !== "string") return;
    if (key === "core.photosensitiveMode") { applySeat(); return; }
    if (!key.startsWith(`${NS}.`)) return;
    const k = key.slice(NS.length + 1);
    if (!D.ENGINE_MIRROR.includes(k) && k !== "photosafe") return;
    const want = D.seatValue(table(), k, seat());
    if (same(want, value)) return;
    if (isGM()) {
      const next = D.adopt(table(), k, value, seat());
      if (next) { game.settings.set(MOD, TABLE_KEY, next).catch(once); return; }
    } else if (Date.now() - refusedAt > 4000) { refusedAt = Date.now(); ui.notifications?.info(t("IPT.Notice.refused")); }
    setTimeout(applySeat, 0);          // the table's value back (after the engine's own onChange of this write)
  } catch (err) { once(err); }
}

/* ---------- settings ---------- */
function registerSettings() {
  if (!has(MOD, TABLE_KEY)) game.settings.register(MOD, TABLE_KEY, { scope: "world", config: false, type: Object, default: { ...D.TABLE_DEFAULTS }, onChange: () => applySeat() });
  if (!has(MOD, MIGRATED_KEY)) game.settings.register(MOD, MIGRATED_KEY, { scope: "world", config: false, type: Number, default: 0 });
  const { ApplicationV2 } = foundry.applications.api;
  class TableMenu extends ApplicationV2 { render() { open(); return this; } }
  game.settings.registerMenu(MOD, "tableSettings", { name: t("IPT.Menu.Name"), label: t("IPT.Menu.Label"), hint: t("IPT.Menu.Hint"), icon: "fa-solid fa-burst", type: TableMenu, restricted: false });
}

/* ---------- migration (GMALL-2) ---------- */
function rawClient(key) {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (raw === null || raw === undefined) return undefined;
    try { return JSON.parse(raw); } catch { return raw; }
  } catch { return undefined; }
}
const worldDoc = (key) => { try { return game.settings.storage?.get("world")?.getSetting?.(key, null) ?? null; } catch { return null; } };
/** the GM's migration: what it wrote (for the log and the checks) */
export async function migrate() {
  const out = [];
  if (!isGM()) return out;
  let done = 0; try { done = Number(game.settings.get(MOD, MIGRATED_KEY)) || 0; } catch { return out; }
  if (done >= D.MIGRATION) return out;
  const { coerce } = await import("../splash/migrate.mjs");
  for (const { key } of D.CONVERTED) {
    try {
      const cfg = game.settings.settings.get(`${MOD}.${key}`);
      if (!cfg || cfg.scope !== "world" || worldDoc(`${MOD}.${key}`)) continue;
      const old = coerce(cfg, D.carry(key, rawClient(`${MOD}.${key}`)));
      if (old === undefined || same(old, cfg.default)) continue;
      await game.settings.set(MOD, key, old);
      out.push(key);
    } catch (err) { console.warn(`${LOG} migrate ${key} failed`, err); }
  }
  /* the table's language of the splash words: what the GM saw until now (his own interface language) */
  try {
    if (has(MOD, "splashLang") && !worldDoc(`${MOD}.splashLang`) && game.i18n?.lang === "pl") { await game.settings.set(MOD, "splashLang", "pl"); out.push("splashLang"); }
  } catch (err) { console.warn(`${LOG} migrate splashLang failed`, err); }
  /* the GM's engine preferences become the table's (read from his browser before the mirror writes the table's values there) */
  try {
    if (!worldDoc(`${MOD}.${TABLE_KEY}`) && has(NS, "enabled")) {
      const mine = {};
      for (const k of D.ENGINE_MIRROR) { const v = rawClient(`${NS}.${k}`); if (v !== undefined) mine[k] = v; }
      const next = D.cleanTable(mine), base = D.cleanTable(null);
      if (Object.keys(next).some((k) => !same(next[k], base[k]))) { await game.settings.set(MOD, TABLE_KEY, next); out.push(TABLE_KEY); }
    }
  } catch (err) { console.warn(`${LOG} migrate the engine preferences failed`, err); }
  await game.settings.set(MOD, MIGRATED_KEY, D.MIGRATION);
  if (out.length) console.info(`${LOG} the GM's own choices became the table's: ${out.join(", ")}`);
  return out;
}

/* a player's seat: keep his own engine preferences once (unused), and tell him once that the GM chooses now */
function playerSeat() {
  try {
    if (isGM()) return;
    const ls = globalThis.localStorage;
    if (!ls) return;
    if (ls.getItem(BACKUP) === null) {
      const mine = {};
      for (const k of [...D.ENGINE_MIRROR, "photosafe"]) { const v = rawClient(`${NS}.${k}`); if (v !== undefined) mine[k] = v; }
      if (Object.keys(mine).length) ls.setItem(BACKUP, JSON.stringify({ at: Date.now(), values: mine }));
    }
    if (ls.getItem(NOTICED) !== null) return;
    let differed = false;
    for (const { key } of D.CONVERTED) {
      const v = rawClient(`${MOD}.${key}`);
      if (v === undefined) continue;
      let cur; try { cur = game.settings.get(MOD, key); } catch { continue; }
      if (!same(D.carry(key, v) ?? cur, cur)) { differed = true; break; }
    }
    if (!differed) {
      const bk = rawClient(BACKUP)?.values ?? {}, want = D.seatValues(table(), seat());
      differed = Object.entries(bk).some(([k, v]) => k in want && !same(v, want[k]));
    }
    if (differed) ui.notifications?.info(t("IPT.Notice.moved"), { permanent: true });
    ls.setItem(NOTICED, String(Date.now()));
  } catch (err) { once(err); }
}

/* ---------- the engine's own settings window: a door to the same table settings ---------- */
function onRenderApp(app, el) {
  try {
    if (app?.id !== "moinen-letters-settings") return;
    const root = el instanceof HTMLElement ? el : el?.[0];
    const form = root?.querySelector?.(".window-content") ?? root;
    if (!form || form.querySelector(".ipt-engine-note")) return;
    const note = document.createElement("div");
    note.className = "ipt-engine-note";
    const p = document.createElement("p");
    p.textContent = isGM() ? t("IPT.Engine.gm") : t("IPT.Engine.player");
    note.append(p);
    if (isGM()) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "ipt-engine-open";
      b.innerHTML = `<i class="fa-solid fa-burst" inert></i> `;
      b.append(document.createTextNode(t("IPT.Engine.open")));
      b.addEventListener("click", () => { app.close?.(); open("letters"); });
      note.append(b);
    } else {
      /* a player sees the values; nothing here can change them (the mirror would put them back anyway) */
      for (const c of form.querySelectorAll("input, select, range-picker, button[type=submit], button[data-action=reset]")) { c.disabled = true; c.setAttribute("aria-disabled", "true"); }
    }
    form.prepend(note);
  } catch (err) { once(err); }
}

/* ---------- the window ---------- */
export async function open(tab = null) {
  try {
    appMod ??= await import("./app.mjs");
    return appMod.open(tab);
  } catch (err) { console.warn(`${LOG} the window did not open`, err); return null; }
}

export function start(phases = {}) {
  try {
    if (started) return true;
    started = true;
    const run = (name, fn) => { if (phases[name]) fn(); else Hooks.once(name, fn); };
    run("init", () => {
      try { registerSettings(); } catch (err) { once(err); }
      Hooks.on("clientSettingChanged", onClientSetting);
      Hooks.on("renderApplicationV2", onRenderApp);
    });
    run("ready", async () => {
      try {
        if (isGM()) await migrate();
        else playerSeat();
      } catch (err) { once(err); }
      applySeat();
      try { globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.addEventListener?.("change", () => applySeat()); } catch { /* no media queries */ }
      try { const Menu = await import("../menu.mjs"); Menu.add({ name: "ipuTable", title: () => t("IPT.Menu.tool"), icon: "fa-solid fa-sliders", order: 5, onChange: () => open() }); } catch (err) { once(err); }
      setTimeout(() => {
        try { const mod = game.modules.get(MOD); if (mod) mod.api = Object.assign(mod.api ?? {}, { table: { open, values: table, seat, seatValues: () => D.seatValues(table(), seat()), applySeat, migrate } }); } catch (err) { once(err); }
      }, 0);
    });
    return true;
  } catch (err) { console.warn(LOG, "start failed", err); return false; }
}
