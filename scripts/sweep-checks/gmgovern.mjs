/* node scripts/sweep-checks/gmgovern.mjs -- GMGOVERN (2026-11-16): the owner, «wszystko mg wybiera dla stołu. wszystko». A blind review
   of tag 161 found options that were still each player's own (the dice marks under sixes and ones, the comic and caption typefaces, the
   plain-fade switch of the comic slash, the token halo, the combat banner ...): a player with the dice marks off saw none where the GM saw
   them. Now EVERY option of the module is the table's: world scope, chosen by the GM in the table settings window, read-only for the
   players, live on every seat. This check starts every area of the module on a fake Foundry whose settings behave like Foundry v14's
   (as sweep-checks/gmall.mjs) and fails when a seat-visible setting is outside the table's rule again:
   A  inventory: every setting the module registers is world-scoped, or is on the short list of a seat's own memory (table/defs.mjs
      SEAT_MEMORY: hidden, never an option); every setting is classified (a window row, the seat's memory, or a named world setting that
      is no seat picture); the sources name no other client scope; every newly governed option has a row with words in both languages
      that no longer say "this client only";
   B  migration 3: the GM's own earlier browser values become the table's (once; nothing the world already holds is touched; an older
      migration is not run again);
   C  a player's seat: reads the table's values, writes none, is told once, keeps its own memory;
   D  the seat's own safeguards still apply (reduced motion, photosensitive mode, Foundry's interface volume). */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const NAMES = process.argv.includes("--names") ? process.argv[process.argv.indexOf("--names") + 1] : null;   // child run: print the registered words in one language
let n = 0, f = 0;
const ck = (name, ok) => { n++; if (!ok) { f++; console.log("FAIL", name); } };
const MOD = "invincible-plus-ultra";

/* ---------------- a fake Foundry with v14's settings semantics (as gmall.mjs) ---------------- */
const hooks = {};
let hid = 0;
globalThis.Hooks = {
  on: (k, fn) => { (hooks[k] ??= []).push({ id: ++hid, fn }); return hid; },
  once: (k, fn) => { (hooks[k] ??= []).push({ id: ++hid, fn, once: true }); return hid; },
  off: (k, id) => { hooks[k] = (hooks[k] ?? []).filter((h) => h.id !== id && h.fn !== id); },
  callAll: (k, ...a) => { for (const h of [...(hooks[k] ?? [])]) { try { h.fn(...a); } catch { /* an area's ready on the fake */ } if (h.once) Hooks.off(k, h.id); } },
  call: (k, ...a) => { Hooks.callAll(k, ...a); return true; }
};
class LS { constructor() { this.m = new Map(); } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { this.m.set(k, String(v)); } removeItem(k) { this.m.delete(k); } }
const registry = new Map();
let worldStore = new Map(), local = new LS(), isGM = true, worldWrites = [], refused = 0, notes = [], changed = [];
globalThis.localStorage = local;
const settingsApi = {
  settings: registry,
  register: (m, k, o) => registry.set(`${m}.${k}`, { ...o, namespace: m, key: k, id: `${m}.${k}` }),
  registerMenu: (m, k, o) => { settingsApi.menus.set(`${m}.${k}`, o); },
  menus: new Map(),
  get(m, k) {
    const id = `${m}.${k}`, cfg = registry.get(id);
    if (!cfg) throw new Error(`"${id}" is not a registered game setting`);
    if (cfg.scope === "client") { const raw = local.getItem(id); if (raw === null) return structuredClone(cfg.default); try { return JSON.parse(raw); } catch { return raw; } }
    return worldStore.has(id) ? structuredClone(worldStore.get(id)) : structuredClone(cfg.default);
  },
  async set(m, k, v) {
    const id = `${m}.${k}`, cfg = registry.get(id);
    if (!cfg) throw new Error(`"${id}" is not a registered game setting`);
    if (cfg.scope === "client") { local.setItem(id, JSON.stringify(v)); try { cfg.onChange?.(v); } catch { /* fake surfaces */ } return v; }
    if (!isGM) { refused++; throw new Error("User lacks permission to update Setting"); }   // the server's answer
    worldWrites.push([id, v]);
    const had = worldStore.has(id);
    worldStore.set(id, structuredClone(v));
    changed.push(id);
    try { cfg.onChange?.(v); } catch { /* an area's surface is not up on the fake */ }
    Hooks.callAll(had ? "updateSetting" : "createSetting", { key: id, value: v }, {}, {});
    return v;
  },
  storage: { get: (w) => (w === "world" ? { getSetting: (key) => (worldStore.has(key) ? { key, value: worldStore.get(key) } : null) } : w === "client" ? local : null) }
};
const sysLang = { v: NAMES ?? "en" };
globalThis.game = {
  system: { id: "invincible" }, ready: true, settings: settingsApi, user: { get isGM() { return isGM; }, id: "U", name: "U" },
  i18n: { get lang() { return sysLang.v; }, has: () => false, localize: (k) => k, format: (k) => k, translations: {} },
  modules: new Map([[MOD, { id: MOD, active: true }]]), users: [], messages: new Map(), time: { serverTime: 0 }, keybindings: { register() {}, actions: new Map() }, socket: { on() {}, emit() {} }
};
globalThis.ui = { notifications: { info: (m) => notes.push(String(m)), warn: () => {}, error: () => {} } };
let osReduced = false;
globalThis.matchMedia = (q) => ({ matches: /reduced-motion/.test(q) ? osReduced : false, addEventListener() {}, addListener() {} });
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.innerWidth = 1600; globalThis.innerHeight = 900;
const el = () => ({ style: { setProperty() {}, removeProperty() {} }, append() {}, prepend() {}, before() {}, remove() {}, setAttribute() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, dataset: {}, querySelector: () => null, querySelectorAll: () => [] });
globalThis.document = { addEventListener() {}, createElement: el, createElementNS: el, head: el(), body: el(), documentElement: el(), getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], fonts: { load: async () => [], check: () => false, add() {}, ready: Promise.resolve() }, visibilityState: "visible" };
class AppV2 { static DEFAULT_OPTIONS = {}; }
globalThis.foundry = { utils: { mergeObject: (a, b) => Object.assign(a, b), expandObject: (o) => o, getRoute: (p) => p, debounce: (fn) => fn }, applications: { api: { ApplicationV2: AppV2, HandlebarsApplicationMixin: (C) => C, DialogV2: class {} }, instances: new Map(), sheets: {}, ux: {} }, canvas: {}, audio: {} };
globalThis.CONST = { CANVAS_PERFORMANCE_MODES: { LOW: 0 }, TOKEN_DISPOSITIONS: {} };
globalThis.CONFIG = { Canvas: { sceneTransitions: {} } };
globalThis.canvas = { ready: false };
const warn0 = console.warn, err0 = console.error, info0 = console.info;
console.warn = () => {}; console.error = () => {}; console.info = () => {};      // the areas say what they miss on a fake page: not this report
settingsApi.register("core", "photosensitiveMode", { scope: "client", default: false });
settingsApi.register("core", "globalInterfaceVolume", { scope: "client", default: 0.5 });

/* the old world: the GM's own earlier browser values (as Foundry stored them), in a world that has already run GMALL and UNMIRROR */
const D = await import("../table/defs.mjs");
const OLD_GM = {
  diceFxEnabled: false, diceFxOnesPushOnly: false, comicFont: "anton", captionFont: "patrickhand", slashCalm: true, tokenHaloAnimate: false, tokenHaloSize: "large",
  combatBannerEnabled: false, combatBannerSize: "small", combatBarSize: "normal", tacticsUiScale: 120, tacticsSoundVolume: 0.2, partySize: "large", partyDisplay: "full",
  turnSound: true, experimental: true, splashLayer: "overlay"
};
for (const [k, v] of Object.entries(OLD_GM)) local.setItem(`${MOD}.${k}`, JSON.stringify(v));
worldStore.set(`${MOD}.${D.MIGRATED_KEY}`, 2);
worldStore.set(`${MOD}.combatBannerSize`, "large");      // a value the world already holds (set before by a GM): never replaced

/* ---------------- start every area that registers a setting (init) ---------------- */
const AREAS = ["splash/main.mjs", "tokenreact/main.mjs", "tokenanim/main.mjs", "gore/main.mjs", "diceeffects/main.mjs", "tokenhalo/main.mjs", "combat/main.mjs", "turn/main.mjs",
  "tactics/main.mjs", "challenges/main.mjs", "party/main.mjs", "slash/main.mjs", "fontoption.mjs", "hotpan-quiet.mjs", "base/main.mjs", "chargen/main.mjs", "log/main.mjs", "session/main.mjs", "table/main.mjs"];
const started = {}, mods = {};
for (const a of AREAS) {
  try { const m = await import(`../${a}`); mods[a] = m; m.start({ init: true }); started[a] = true; } catch (e) { started[a] = String(e?.message ?? e); }
}
/* scripts/module.js is the page's entry script (not loadable in node): its two options are registered here exactly as its source does */
const moduleSrc = readFileSync(join(root, "module.js"), "utf8");
for (const [id, key] of [["EXPERIMENTAL", "experimental"], ["INLINE_STUNTS", "inlineStunts"]]) {
  const m = new RegExp(`game\\.settings\\.register\\(MODULE_ID, ${id}, \\{([\\s\\S]*?)\\n  \\}\\);`).exec(moduleSrc);
  const body = m?.[1] ?? "";
  registry.set(`${MOD}.${key}`, { namespace: MOD, key, id: `${MOD}.${key}`, name: /name: "([^"]*)"/.exec(body)?.[1], hint: /hint: "([^"]*)"/.exec(body)?.[1],
    onChange: /onChange:/.test(body) ? () => {} : undefined, scope: /scope: "(\w+)"/.exec(body)?.[1], config: /config: (\w+)/.exec(body)?.[1] === "true", type: Boolean, default: /default: (\w+)/.exec(body)?.[1] === "true", fromSource: !!m });
}
registry.set(`${MOD}.migratedFromSheetPlus`, { namespace: MOD, key: "migratedFromSheetPlus", id: `${MOD}.migratedFromSheetPlus`, scope: /\["migratedFromSheetPlus", "client"\]/.test(moduleSrc) ? "client" : "?", config: false, type: Boolean, default: false });
registry.set(`${MOD}.migratedFromSheetPlusWorld`, { namespace: MOD, key: "migratedFromSheetPlusWorld", id: `${MOD}.migratedFromSheetPlusWorld`, scope: "world", config: false, type: Boolean, default: false });

const ours = [...registry.values()].filter((c) => c.namespace === MOD);
const byKey = (k) => registry.get(`${MOD}.${k}`);

if (NAMES) {      // the child run: the registered words of the newly governed options in this language
  process.stdout.write(JSON.stringify(Object.fromEntries([...new Set([...D.GOVERNED, ...D.ROWS.filter((r) => r.own).map((r) => r.key)])].map((k) => [k, { name: byKey(k)?.name ?? null, hint: byKey(k)?.hint ?? null, choices: byKey(k)?.choices ?? null }]))));
  process.exit(0);
}

/* ---------------- A inventory ---------------- */
for (const a of AREAS) ck(`A1 ${a} starts on the fake (${started[a] === true ? "ok" : started[a]})`, started[a] === true);
ck("A1 module.js: its two options are read from its source", byKey("experimental")?.fromSource && byKey("inlineStunts")?.fromSource);
const notWorld = ours.filter((c) => c.scope !== "world");
ck(`A2 every setting that is not world-scoped is a seat's own memory, named in SEAT_MEMORY (${notWorld.filter((c) => !(c.key in D.SEAT_MEMORY)).map((c) => c.key).join(", ") || "none other"})`,
  notWorld.every((c) => c.scope === "client" && c.key in D.SEAT_MEMORY));
ck("A3 a seat's memory is never an option: hidden from Foundry's settings list", notWorld.every((c) => c.config !== true));
ck(`A4 every name on SEAT_MEMORY is a registered client setting, with a reason (${Object.keys(D.SEAT_MEMORY).filter((k) => byKey(k)?.scope !== "client").join(", ") || "all"})`,
  Object.entries(D.SEAT_MEMORY).every(([k, why]) => byKey(k)?.scope === "client" && typeof why === "string" && why.length > 10));
ck(`A5 every newly governed option is registered, world-scoped and out of Foundry's own list (${D.GOVERNED.filter((k) => !(byKey(k)?.scope === "world" && byKey(k)?.config !== true)).join(", ") || "all"})`,
  D.GOVERNED.every((k) => byKey(k)?.scope === "world" && byKey(k)?.config !== true));
const rowKeys = new Set(D.ROWS.filter((r) => r.src === "mod").map((r) => r.key));
ck(`A6 the window has a row for every newly governed option (${D.GOVERNED.filter((k) => !rowKeys.has(k)).join(", ") || "all"})`, D.GOVERNED.every((k) => rowKeys.has(k)));
ck(`A7 every row of the window names a registered world setting (${[...rowKeys].filter((k) => byKey(k)?.scope !== "world").join(", ") || "all"})`, [...rowKeys].every((k) => byKey(k)?.scope === "world"));
ck("A8 no row twice, no option under two rows", new Set(D.ROWS.map((r) => r.id)).size === D.ROWS.length && rowKeys.size === D.ROWS.filter((r) => r.src === "mod").length);
/* every setting has its place: a window row, the animations' own panel in the window, the seat's memory, or the list below: world
   settings that are not a seat's picture. A NEW setting must be put somewhere on purpose: unclassified = this check fails. */
const PANEL = ["tokenAnimOn", "tokenAnimEvents", "tokenAnimMine"];                       // the token animations' panel, mounted in the Tokens tab
const WORLD_OTHER = {
  /* rules and permissions of the table, GM only, in Foundry's own settings list (never a per-seat picture) */
  basePlayersCreate: "permission", challengesCombatTime: "rule", chargenPlayers: "permission", combatBarPlayers: "what players may see", combatYze: "adaptation to another module",
  logEnabled: "rule", logReadAccess: "permission", logRetainEntries: "storage", logPlayerNotes: "permission", logCombat: "rule", partyPlayers: "what players may see",
  sessionAllowPlayers: "permission", sessionChatSummary: "rule", slashDefault: "the table's default scene transition",
  tacticsEnabled: "rule", tacticsInitiative: "rule", tacticsRedraw: "rule", tacticsPushOrder: "rule",
  /* stored state and bookkeeping (hidden) */
  logRetainBase: "state", logActorTypes: "state", logScope: "state", logPolicy: "state", sessionState: "state", sessionArchive: "state",
  tableMigrated: "bookkeeping", splashMigratedWorld: "bookkeeping", migratedFromSheetPlusWorld: "bookkeeping"
};
const placed = (k) => [rowKeys.has(k), PANEL.includes(k), k in D.SEAT_MEMORY, k in WORLD_OTHER].filter(Boolean).length;
const unplaced = ours.filter((c) => placed(c.key) !== 1).map((c) => `${c.key}:${placed(c.key)}`);
ck(`A9 every registered setting has exactly one place: a window row, the animations panel, the seat's memory or the named world list (${unplaced.join(", ") || "all"})`, unplaced.length === 0);
ck(`A10 the named world list holds only registered world settings (${Object.keys(WORLD_OTHER).filter((k) => byKey(k)?.scope !== "world").join(", ") || "all"})`, Object.keys(WORLD_OTHER).every((k) => byKey(k)?.scope === "world"));
ck("A11 no option of ours shown in Foundry's own list is a seat's own", ours.filter((c) => c.config === true).every((c) => c.scope === "world"));

/* the sources: a client scope appears only where a seat's memory is registered, always hidden */
const files = [];
(function walk(dir) { for (const e of readdirSync(dir)) { const p = join(dir, e); if (statSync(p).isDirectory()) { if (e !== "letters" && e !== "sweep-checks") walk(p); } else if (/\.(mjs|js)$/.test(e) && !/^check[-.]|\.test\./.test(e)) files.push(p); } })(root);
let clientLines = 0, badLines = [];
for (const p of files) {
  const src = readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  src.split("\n").forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");
    if (!/scope\s*:\s*["'](client|user)["']/.test(code)) return;
    clientLines++;
    if (!/config:\s*false/.test(code)) badLines.push(`${relative(root, p)}:${i + 1}`);
  });
}
ck(`A12 a client scope is written only on a hidden registration (${badLines.join(", ") || "none other"})`, badLines.length === 0);
const literalMemory = Object.keys(D.SEAT_MEMORY).length - 1;      // all but module.js's bookkeeping flag (registered from a list)
ck(`A13 as many client registrations in the sources as names on SEAT_MEMORY (${clientLines} of ${literalMemory})`, clientLines === literalMemory);
ck("A14 module.js names a client scope only for its bookkeeping flag", (moduleSrc.match(/["']client["']/g) ?? []).length === 1 && /\["migratedFromSheetPlus", "client"\]/.test(moduleSrc));
ck("A15 the default of the halo is the same on every seat (no browser value read at registration)", byKey("tokenHaloMotion")?.default === "calm" && !/storage\.get\("client"\)/.test(readFileSync(join(root, "tokenhalo/main.mjs"), "utf8")));

/* the words of the newly governed rows, in both languages (a child run per language: the areas resolve their strings when they register) */
const wordsIn = (lang) => JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), "--names", lang], { encoding: "utf8", maxBuffer: 1 << 24 }));
const EN = wordsIn("en"), PL = wordsIn("pl");
const SEATISH = /this client|this browser|this device|on this screen|ten klient|tym kliencie|tej przeglądarce|tym urządzeniu|na tym ekranie/i;
const T = await import("../table/lang.mjs");
const ownRows = D.ROWS.filter((r) => r.own);
for (const r of ownRows) {
  const e = EN[r.key], p = PL[r.key];
  if (!e) { ck(`A16 ${r.key}: an own-worded row names a registered option`, false); continue; }
  const okWords = (w) => typeof w?.name === "string" && w.name.length > 2 && !/^[A-Z]{2,5}\.[\w.]+$/.test(w.name) && typeof w.hint === "string" && w.hint.length > 8 && !/^[A-Z]{2,5}\.[\w.]+$/.test(w.hint);
  ck(`A16 ${r.key}: a name and a hint in English and in Polish`, okWords(e) && okWords(p) && e.hint !== p.hint);
  ck(`A17 ${r.key}: the words no longer say the option is this screen's own`, !SEATISH.test(`${e.name} ${e.hint}`) && !SEATISH.test(`${p.name} ${p.hint}`));
  const ch = byKey(r.key)?.choices;
  if (ch) ck(`A18 ${r.key}: every choice labelled in both languages`, Object.keys(ch).every((c) => String(e.choices?.[c] ?? "").length > 0 && String(p.choices?.[c] ?? "").length > 0));
}
for (const r of D.ROWS.filter((x) => x.src === "mod" && !x.own && D.GOVERNED.includes(x.key)))
  ck(`A19 ${r.key}: the window's own words in both languages`, ["Name", "Hint"].every((s) => T.EN[`IPT.Row.${r.id}.${s}`] && T.PL[`IPT.Row.${r.id}.${s}`]));
const App = await import("../table/app.mjs");
ck("A20 inside its own section a row drops its area's prefix, elsewhere it keeps the full name",
  App.words(D.rowById("halo.hover")).name === "On hover" && App.words(D.rowById("dice.enabled")).name === "Enabled" && /:/.test(App.words(D.rowById("interface.slashCalm")).name) && App.words(D.rowById("interface.comicFont")).name === "Comic lettering");

/* ---------------- B migration 3 (GM seat, ready) ---------------- */
const Table = mods["table/main.mjs"];
Table.ENGINE_WAIT_MS !== undefined;
const out = await Table.migrate();
const W = (k) => worldStore.get(`${MOD}.${k}`);
ck("B1 the GM's dice marks switched off stay off, for the table", W("diceFxEnabled") === false && W("diceFxOnesPushOnly") === false);
ck("B2 the GM's typefaces became the table's", W("comicFont") === "anton" && W("captionFont") === "patrickhand");
ck("B3 the GM's plain fade, halo size, panel size, interface size, volume, turn sound and sheet blood became the table's",
  W("slashCalm") === true && W("tokenHaloSize") === "large" && W("partySize") === "large" && W("tacticsUiScale") === 120 && W("tacticsSoundVolume") === 0.2 && W("turnSound") === true && W("experimental") === true);
ck("B4 the halo's older on/off switch (off) is carried as motion off", W("tokenHaloMotion") === "off");
ck("B5 a value the world already holds is never replaced by the GM's browser value", W("combatBannerSize") === "large");
ck("B6 a value equal to the default writes nothing", !worldStore.has(`${MOD}.combatBarSize`));
ck("B7 the GM's banner switched off stays off", W("combatBannerEnabled") === false);
ck("B8 an older migration is not run again (GMALL's keys are left alone in a world that ran it)", !worldStore.has(`${MOD}.splashLayer`));
ck("B9 the seat's own memory is not moved to the world", !worldStore.has(`${MOD}.partyDisplay`) && settingsApi.get(MOD, "partyDisplay") === "full");
ck("B10 marked done (3)", W(D.MIGRATED_KEY) === 3 && D.MIGRATION === 3);
ck(`B11 it reports what it wrote (${out.length})`, out.includes("diceFxEnabled") && out.includes("comicFont") && !out.includes("combatBannerSize"));
const before = worldWrites.length;
await Table.migrate();
ck("B12 a second run writes nothing", worldWrites.length === before);
ck("B13 the GM's old browser values are left as they were", local.getItem(`${MOD}.comicFont`) === JSON.stringify("anton"));
ck("B14 every governed key the migration can carry: registered with a type the carry understands", D.GOVERNED.every((k) => [Boolean, Number, String].includes(byKey(k)?.type)));

/* ---------------- C a player's seat in the same world ---------------- */
isGM = false; worldWrites = []; notes = []; refused = 0;
const playerLocal = new LS();
playerLocal.setItem(`${MOD}.diceFxEnabled`, JSON.stringify(true));           // his own earlier choices
playerLocal.setItem(`${MOD}.comicFont`, JSON.stringify("bangers"));
playerLocal.setItem(`${MOD}.partyDisplay`, JSON.stringify("hidden"));
playerLocal.setItem(`${MOD}.gmallNoticed`, "1");                             // he saw GMALL's notice before
local = playerLocal; globalThis.localStorage = playerLocal;
ck("C1 the player's seat reads the table's dice marks and typeface, not his own old ones", settingsApi.get(MOD, "diceFxEnabled") === false && settingsApi.get(MOD, "comicFont") === "anton");
ck("C2 his own folded panel is still his", settingsApi.get(MOD, "partyDisplay") === "hidden");
const ready = async () => { const log0 = console.log; console.log = () => {}; Hooks.callAll("ready"); await new Promise((r) => setTimeout(r, 30)); console.log = log0; };
await ready();
ck(`C3 the player's seat start writes no world setting (${worldWrites.length} written, ${refused} refused)`, worldWrites.length === 0 && refused === 0);
ck(`C4 a player whose own choices differed is told once (${notes.length})`, notes.length === 1 && notes[0] === T.t("IPT.Notice.governed"));
notes = [];
await ready();
ck("C5 told only once", notes.length === 0);
let threw = 0;
for (const k of D.GOVERNED) { try { await settingsApi.set(MOD, k, byKey(k).default); } catch { threw++; } }
ck("C6 a player's direct write of any governed option is refused", threw === D.GOVERNED.length && W("comicFont") === "anton");
ck("C7 a player's migration does nothing", (await Table.migrate()).length === 0);
await settingsApi.set(MOD, "partyDisplay", "peek");
ck("C8 the player still folds his own panel", settingsApi.get(MOD, "partyDisplay") === "peek" && refused === D.GOVERNED.length);
ck("C9 his old values stay in his browser untouched", playerLocal.getItem(`${MOD}.comicFont`) === JSON.stringify("bangers"));
/* the GM changes an option: the player's seat reads the new value at once */
isGM = true; changed = [];
await settingsApi.set(MOD, "diceFxEnabled", true); await settingsApi.set(MOD, "tokenHaloEnabled", false); await settingsApi.set(MOD, "comicFont", "komikah");
isGM = false;
ck("C10 a GM's change is what the player's seat reads next", settingsApi.get(MOD, "diceFxEnabled") === true && settingsApi.get(MOD, "tokenHaloEnabled") === false && settingsApi.get(MOD, "comicFont") === "komikah");
const live = D.GOVERNED.filter((k) => typeof byKey(k)?.onChange === "function");
const LIVE_NEED = ["diceFxEnabled", "diceFxStrength", "diceFxSixes", "diceFxOnes", "tokenHaloEnabled", "tokenHaloHover", "tokenHaloSelected", "tokenHaloTurn", "tokenHaloSize", "tokenHaloMotion",
  "combatBannerEnabled", "combatBannerSize", "combatBarEnabled", "combatBarSize", "combatBarResources", "turnMessage", "turnTray", "challengesEnabled", "challengesScale", "challengesVisible", "challengesCompact",
  "partyPips", "partySize", "partyStyle", "comicFont", "captionFont", "tacticsUiScale", "tacticsHints", "baseHeaderButton", "chargenButton", "experimental", "logRevealJournals"];
ck(`C11 an option whose picture is standing on the screen repaints on every seat when the table changes it (onChange; missing: ${LIVE_NEED.filter((k) => !live.includes(k)).join(", ") || "none"})`, LIVE_NEED.every((k) => live.includes(k)));

/* ---------------- D the seat's own safeguards ---------------- */
const Slash = mods["slash/main.mjs"];
ck("D1 comic slash: the table's plain fade is what every seat gets", Slash.calmHere(true, { reduced: false, photosensitive: false }) === true && Slash.calmHere(false, { reduced: false, photosensitive: false }) === false);
ck("D2 comic slash: a seat's reduced motion or photosensitive mode gives it the plain fade whatever the table chose", Slash.calmHere(false, { reduced: true, photosensitive: false }) === true && Slash.calmHere(false, { reduced: false, photosensitive: true }) === true);
osReduced = true;
ck("D3 comic slash reads the seat's own system setting", Slash.calmHere(false) === true);
osReduced = false; playerLocal.setItem("core.photosensitiveMode", "true");
ck("D4 comic slash reads Foundry's photosensitive mode of the seat", Slash.calmHere(false) === true);
playerLocal.removeItem("core.photosensitiveMode");
ck("D5 with neither, the seat follows the table", Slash.calmHere(false) === false);
const FP = await import("../tactics/ui/feedback-pure.mjs");
ck("D6 the fight's sounds: the table's volume at Foundry's default interface volume", FP.seatVolume(0.5, 0.5) === 0.5 && FP.seatVolume(0.2, 0.5) === 0.2 && FP.seatVolume(0, 0.5) === 0);
ck("D7 a seat that muted or lowered Foundry's interface sounds hears them so", FP.seatVolume(0.5, 0) === 0 && FP.seatVolume(0.5, 0.25) === 0.25 && FP.seatVolume(1, 1) === 1 && FP.seatVolume(0.5, undefined) === 0.5);
const src = (p) => readFileSync(join(root, p), "utf8");
ck("D8 the fight's sounds are played at the seat volume", /FP\.seatVolume\(setting\("tacticsSoundVolume", 0\.5\)/.test(src("tactics/ui/feedback.mjs")));
for (const p of ["tokenhalo/halo.mjs", "combat/banner.mjs", "combat/bar.mjs", "turn/message.mjs", "party/panel.mjs", "challenges/hud.mjs", "challenges/camera.mjs", "slash/main.mjs"])
  ck(`D9 ${p} still reads the seat's own reduced motion`, /prefers-reduced-motion: reduce/.test(src(p)));
ck("D10 the dice marks stand still under a seat's reduced motion (stylesheet)", /prefers-reduced-motion: reduce/.test(readFileSync(join(root, "..", "styles", "diceeffects.css"), "utf8")));
ck("D11 the halo's motion also yields to the seat's Foundry performance mode", /performanceMode/.test(src("tokenhalo/halo.mjs")));

console.warn = warn0; console.error = err0; console.info = info0;
console.log(`sweep gmgovern: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
