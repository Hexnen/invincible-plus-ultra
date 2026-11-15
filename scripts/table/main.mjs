/* GMALL: the table's settings, the Foundry part. Started from scripts/module.js by a guarded dynamic import (start() below), like the
   other areas. What it does:
   - registers `tableMigrated` and ONE settings menu ("Comic effects", restricted: false: the GM edits, a player sees the same window
     read-only) plus a Plus Ultra menu tool;
   - the lettering engine's preferences are the ENGINE's table (UNMIRROR, engine 1.9.16+: L.table / L.setTable / hook
     "moinenLettersTable"): one truth, held by the engine; this module keeps no copy, mirrors nothing and patches no engine window. Its
     window reads L.table and calls L.setTable (app.mjs);
   - MIGRATION (once per world, by the first GM seat after the update): GMALL (1) the GM's own earlier client values of every option this
     package moved from client to world become the table's (unless the world already holds a value); UNMIRROR (2) GMALL's own world copy
     of the lettering preferences (`lettersTable`) is handed to the engine: registered for the engine's own one-time migration while that
     has not run (defs.legacyNeeded), and carried with L.setTable where it is newer than the engine's table (defs.legacyCarry). A player's
     earlier own values are left untouched in his browser (unused); he gets one notice that the GM now chooses (the engine tells him about
     the lettering itself).
   The window itself is app.mjs (loaded on first open). */
import * as D from "./defs.mjs";
import { t } from "./lang.mjs";

const { MOD, NS, MIGRATED_KEY, LEGACY_KEY } = D;
const LOG = `${MOD} (table settings) |`;
const NOTICED = `${MOD}.gmallNoticed`;          // localStorage: the one-time notice was shown on this browser
let started = false, warned = false, appMod = null;
const once = (e) => { if (!warned) { warned = true; console.warn(LOG, e); } };
const isGM = () => !!game.user?.isGM;
const same = (a, b) => a === b || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-9);

/* ---------- the engine ---------- */
let engineP = null;
/** the lettering engine that runs on this page (the registry's winner), or null */
export function engine() {
  /* the page's registry (globalThis.MoinenLetters, the same object every copy's index.mjs uses) first; our own copy's entry otherwise */
  engineP ??= (typeof globalThis.MoinenLetters?.engine === "function" ? Promise.resolve(globalThis.MoinenLetters.engine()) : import("../letters/index.mjs").then((m) => m.letters()))
    .catch((err) => { once(err); return null; });
  return engineP;
}
/** the table's lettering preferences as the engine holds them (an older engine: this screen's own, read-only) */
export async function values() {
  const L = await engine();
  return Object.fromEntries(D.ENGINE_KEYS.map((k) => [k, D.engineValue(L, k)]));
}
let oldSaid = false;
/** an older engine copy won on this page (UNMIRROR-1): say it once on the console; the window shows it */
function sayOld(L) {
  if (oldSaid || D.engineMode(L) !== "old") return;
  oldSaid = true;
  console.warn(`${LOG} the lettering engine on this page (${L?.version ?? "?"}) is older than 1.9.16: its preferences are each screen's own there, not the table's. Update the module that carries it (moinen-maps or this one).`);
}

/* ---------- settings ---------- */
const worldDoc = (key) => { try { return game.settings.storage?.get("world")?.getSetting?.(key, null) ?? null; } catch { return null; } };
const docValue = (doc) => { if (!doc) return undefined; const v = doc.value; if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return v; } };
const docTime = (doc) => { const n = Number(doc?._stats?.modifiedTime ?? doc?._stats?.createdTime); return Number.isFinite(n) ? n : NaN; };
function registerSettings() {
  if (!game.settings.settings.has(`${MOD}.${MIGRATED_KEY}`)) game.settings.register(MOD, MIGRATED_KEY, { scope: "world", config: false, type: Number, default: 0 });
  /* GMALL's old copy: registered only while the engine's own migration still has to take it (written by nobody here) */
  try {
    if (D.legacyNeeded({ legacyDoc: worldDoc(`${MOD}.${LEGACY_KEY}`), engineMigrated: docValue(worldDoc(`${NS}.tableMigrated`)) }) && !game.settings.settings.has(`${MOD}.${LEGACY_KEY}`))
      game.settings.register(MOD, LEGACY_KEY, { scope: "world", config: false, type: Object, default: {} });
  } catch (err) { once(err); }
  const { ApplicationV2 } = foundry.applications.api;
  class TableMenu extends ApplicationV2 { render() { open(); return this; } }
  game.settings.registerMenu(MOD, "tableSettings", { name: t("IPT.Menu.Name"), label: t("IPT.Menu.Label"), hint: t("IPT.Menu.Hint"), icon: "fa-solid fa-burst", type: TableMenu, restricted: false });
}

/* ---------- migration ---------- */
function rawClient(key) {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (raw === null || raw === undefined) return undefined;
    try { return JSON.parse(raw); } catch { return raw; }
  } catch { return undefined; }
}
/* the engine's own migration runs at its ready (async): wait for its mark (or give up after a while; the carry then compares stamps) */
export let ENGINE_WAIT_MS = 8000;
async function engineMigrated() {
  const done = () => { try { return Number(docValue(worldDoc(`${NS}.tableMigrated`))) >= 1; } catch { return false; } };
  const until = Date.now() + ENGINE_WAIT_MS;
  while (!done() && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  return done();
}
/** the GM's migration: what it wrote (for the log and the checks) */
export async function migrate() {
  const out = [];
  if (!isGM()) return out;
  let done = 0; try { done = Number(game.settings.get(MOD, MIGRATED_KEY)) || 0; } catch { return out; }
  if (done >= D.MIGRATION) return out;
  if (done < 1) {
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
      if (game.settings.settings.has(`${MOD}.splashLang`) && !worldDoc(`${MOD}.splashLang`) && game.i18n?.lang === "pl") { await game.settings.set(MOD, "splashLang", "pl"); out.push("splashLang"); }
    } catch (err) { console.warn(`${LOG} migrate splashLang failed`, err); }
    /* (the GM's own old lettering preferences: the engine's own migration takes them, 1.9.16) */
  }
  /* UNMIRROR: GMALL's old copy of the lettering preferences into the engine's table (only where it is newer than the engine's) */
  try {
    const legacyDoc = worldDoc(`${MOD}.${LEGACY_KEY}`);
    if (legacyDoc) {
      const L = await engine();
      if (D.engineMode(L) !== "table") return out;     // no table engine on this page: nothing marked, tried again on a later start
      await engineMigrated();
      const engDoc = worldDoc(`${NS}.table`);
      const next = D.legacyCarry({ legacy: docValue(legacyDoc), legacyAt: docTime(legacyDoc), engineAt: engDoc ? docTime(engDoc) : NaN, table: L.table });
      if (next && await L.setTable(next)) out.push(`${NS}.table (${Object.keys(next).join(", ")})`);
    }
  } catch (err) { console.warn(`${LOG} carrying the old lettering table failed`, err); return out; }
  await game.settings.set(MOD, MIGRATED_KEY, D.MIGRATION);
  if (out.length) console.info(`${LOG} the GM's own choices became the table's: ${out.join(", ")}`);
  return out;
}

/* a player's seat: told once that the GM chooses the splash and reaction options now (the engine tells him about the lettering itself) */
function playerSeat() {
  try {
    if (isGM()) return;
    const ls = globalThis.localStorage;
    if (!ls || ls.getItem(NOTICED) !== null) return;
    let differed = false;
    for (const { key } of D.CONVERTED) {
      const v = rawClient(`${MOD}.${key}`);
      if (v === undefined) continue;
      let cur; try { cur = game.settings.get(MOD, key); } catch { continue; }
      if (!same(D.carry(key, v) ?? cur, cur)) { differed = true; break; }
    }
    if (differed) ui.notifications?.info(t("IPT.Notice.moved"), { permanent: true });
    ls.setItem(NOTICED, String(Date.now()));
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
    });
    run("ready", async () => {
      try {
        if (isGM()) migrate().catch(once);     // may wait for the engine's own migration: never holds up the rest of the start
        else playerSeat();
      } catch (err) { once(err); }
      engine().then(sayOld).catch(once);
      try { const Menu = await import("../menu.mjs"); Menu.add({ name: "ipuTable", title: () => t("IPT.Menu.tool"), icon: "fa-solid fa-sliders", order: 5, onChange: () => open() }); } catch (err) { once(err); }
      setTimeout(() => {
        try { const mod = game.modules.get(MOD); if (mod) mod.api = Object.assign(mod.api ?? {}, { table: { open, values, engine, migrate } }); } catch (err) { once(err); }
      }, 0);
    });
    return true;
  } catch (err) { console.warn(LOG, "start failed", err); return false; }
}
