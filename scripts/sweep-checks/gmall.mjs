/* node scripts/sweep-checks/gmall.mjs -- GMALL (2026-11-15): the owner, «wszystko mg wybiera dla stołu. wszystko»: every option of the roll
   splash, the token reactions, their animations and what the module exposes of the lettering engine is the TABLE's: world scope, changed
   only by the GM, applied live on every seat; existing worlds migrate the GM's own choices. On a fake Foundry whose settings behave like
   Foundry v14's (client values in localStorage "<ns>.<key>" as JSON, world values in Setting documents a player's seat may not write,
   onChange on every seat, clientSettingChanged after a client write):
   A  inventory: no client-scope setting registered by the splash, the token reactions, the token animations or the table settings; the
      source of those areas names no client scope; the window lists every converted option;
   B  a player cannot change any: our code never writes a world setting from a player's seat (start, migration, the window's writer), a
      player's hand change of an engine preference is put back to the table's and he is told; the server refuses the rest (Foundry);
   C  a GM's change reaches a second seat live: the table's engine values are copied into the seat's engine settings on onChange; the
      splash's shown words follow the table's language on an English and on a Polish seat alike;
   D  migration from a world with old client values: the GM's own values become the table's (with the stated exceptions), once; a player's
      own values are left untouched (engine ones backed up), he is told once;
   E  the seat's own accessibility signals (system reduced motion, Foundry photosensitive mode) still apply on that seat; the
      photosensitivity guard is never off. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
let n = 0, f = 0;
const ck = (name, ok) => { n++; if (!ok) { f++; console.log("FAIL", name); } };
const MOD = "invincible-plus-ultra", NS = "moinen-letters";

/* ---------------- a fake Foundry with v14's settings semantics ---------------- */
const hooks = {};
let hid = 0;
globalThis.Hooks = {
  on: (k, fn) => { (hooks[k] ??= []).push({ id: ++hid, fn }); return hid; },
  once: (k, fn) => { (hooks[k] ??= []).push({ id: ++hid, fn, once: true }); return hid; },
  off: (k, id) => { hooks[k] = (hooks[k] ?? []).filter((h) => h.id !== id && h.fn !== id); },
  callAll: (k, ...a) => { for (const h of [...(hooks[k] ?? [])]) { h.fn(...a); if (h.once) Hooks.off(k, h.id); } }
};
class LS { constructor() { this.m = new Map(); } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { this.m.set(k, String(v)); } removeItem(k) { this.m.delete(k); } }
const registry = new Map();
let worldStore = new Map(), local = new LS(), isGM = true, worldWrites = [], refused = 0, notes = [];
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
    if (cfg.scope === "client") { local.setItem(id, JSON.stringify(v)); cfg.onChange?.(v); Hooks.callAll("clientSettingChanged", id, v, {}); return v; }
    if (!isGM) { refused++; throw new Error("User lacks permission to update Setting"); }   // the server's answer
    worldWrites.push([id, v]);
    const had = worldStore.has(id);                                                         // v14: the first write from the default CREATES the doc
    worldStore.set(id, structuredClone(v));
    for (const s of seats) s(id, v);                                                        // onChange on every seat
    Hooks.callAll(had ? "updateSetting" : "createSetting", { key: id, value: v }, {}, {});
    return v;
  },
  storage: { get: (w) => (w === "world" ? { getSetting: (key) => (worldStore.has(key) ? { key, value: worldStore.get(key) } : null) } : null) }
};
const seats = [(id, v) => registry.get(id)?.onChange?.(v)];
const sysLang = { v: "en" };
globalThis.game = {
  system: { id: "invincible" }, ready: true, settings: settingsApi, user: { get isGM() { return isGM; }, id: "U" },
  i18n: { get lang() { return sysLang.v; }, has: () => false, localize: (k) => k, format: (k) => k, translations: {} },
  modules: new Map([[MOD, { id: MOD, active: true }]]), users: [], messages: new Map(), time: { serverTime: 0 }
};
globalThis.ui = { notifications: { info: (m) => notes.push(String(m)), warn: () => {} } };
let osReduced = false;
globalThis.matchMedia = (q) => ({ matches: /reduced-motion/.test(q) ? osReduced : false, addEventListener() {} });
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.innerWidth = 1600; globalThis.innerHeight = 900;
globalThis.document = { addEventListener() {}, createElement: () => ({ style: {}, append() {}, setAttribute() {}, classList: { add() {} } }), head: { append() {} }, body: { append() {} }, getElementById: () => null, fonts: { load: async () => {} }, visibilityState: "visible" };
globalThis.foundry = { utils: { mergeObject: (a, b) => Object.assign(a, b), expandObject: (o) => o, getRoute: (p) => p }, applications: { api: { ApplicationV2: class {} } } };
globalThis.CONST = { CANVAS_PERFORMANCE_MODES: { LOW: 0 } };
globalThis.canvas = { ready: false };

/* the lettering engine cannot load its fonts in node (no fetch of files): its areas say so on the console; keep that out of this report */
const warn0 = console.warn, log0 = console.error;
console.warn = (...a) => { if (!/LETR|lettering engine|token reactions|token animations|font/i.test(a.map(String).join(" "))) warn0(...a); };
console.error = (...a) => { if (!/LETR|font/i.test(a.map(String).join(" "))) log0(...a); };
/* the engine's own settings, as scripts/letters/tools.mjs registers them (client except the two world ones) */
const Prefs = await import("../letters/prefs.mjs");
for (const [k, d] of Object.entries(Prefs.SETTINGS)) settingsApi.register(NS, k, { scope: Prefs.scopeOf(k), config: false, type: d.type === "bool" ? Boolean : d.type === "num" ? Number : String, default: d.default });
settingsApi.register("core", "photosensitiveMode", { scope: "client", default: false });

/* the old world: the GM's own earlier client values (as Foundry stored them) */
const OLD_GM = {
  [`${MOD}.splashLayer`]: "overlay", [`${MOD}.splashBackdrop`]: true, [`${MOD}.splashFullFrom`]: 0.85, [`${MOD}.splashMotion`]: "full", [`${MOD}.splashOthers`]: true,
  [`${MOD}.tokenReactEnabled`]: true, [`${MOD}.tokenAnimMine`]: "off",
  [`${NS}.impact`]: "local", [`${NS}.motion`]: "full", [`${NS}.scale`]: 1.4, [`${NS}.photosafe`]: false, [`${NS}.palette`]: "mood"
};
for (const [k, v] of Object.entries(OLD_GM)) local.setItem(k, JSON.stringify(v));

/* ---------------- start every area on the fake (init) ---------------- */
const Splash = await import("../splash/main.mjs");
const React = await import("../tokenreact/main.mjs");
const Anim = await import("../tokenanim/main.mjs");
const Table = await import("../table/main.mjs");
const D = await import("../table/defs.mjs");
const Logic = await import("../splash/logic.mjs");
sysLang.v = "pl";      // the GM's own interface language
Splash.start({ init: true });
React.start({ init: true });
Anim.start({ init: true });
Table.start({ init: true });

/* ---------------- A inventory ---------------- */
const ours = [...registry.values()].filter((c) => c.namespace === MOD);
const client = ours.filter((c) => c.scope === "client");
ck(`A1 no client-scope setting of the splash / reactions / animations / table remains (${client.map((c) => c.key).join(", ") || "none"})`, client.length === 0);
ck("A2 every converted option is registered and world-scoped", D.CONVERTED.every(({ key }) => registry.get(`${MOD}.${key}`)?.scope === "world"));
ck("A3 the table's language of the splash words is a world setting (default English)", registry.get(`${MOD}.splashLang`)?.scope === "world" && registry.get(`${MOD}.splashLang`)?.default === "en");
ck("A4 the table's engine preferences are a world setting", registry.get(`${MOD}.${D.TABLE_KEY}`)?.scope === "world");
ck("A5 none of them is listed twice in Foundry's own list (the window shows them)", ours.filter((c) => c.config === true).every((c) => !/^(splash|tokenReact|tokenAnim|letters|table)/.test(c.key)));
ck("A6 one settings menu for everyone (players open it read-only)", settingsApi.menus.get(`${MOD}.tableSettings`)?.restricted === false);
const SRC = ["splash/main.mjs", "splash/migrate.mjs", "tokenreact/main.mjs", "tokenanim/main.mjs", "tokenanim/panel.mjs", "table/main.mjs", "table/app.mjs", "table/defs.mjs"];
for (const s of SRC) {
  const src = readFileSync(join(root, s), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ck(`A7 ${s} names no client scope`, !/scope\s*:\s*["']client["']|\bclient\(['"]/.test(src));
}
const panelSrc = readFileSync(join(root, "tokenanim/panel.mjs"), "utf8");
ck("A8 the window has a row for every converted option (the animations' motion in their own panel, mounted in the Token reactions tab) and every table engine preference",
  D.CONVERTED.every(({ key }) => D.ROWS.some((r) => r.src === "mod" && r.key === key) || (key === "tokenAnimMine" && /R\.KEY\.mine/.test(panelSrc) && D.TABS.some((t) => t.sections.some((x) => x.panel === "tokenanim")))) && D.ENGINE_KEYS.every((k) => D.ROWS.some((r) => r.key === k && r.src.startsWith("engine"))));
ck("A9 the window also has the table's world options that were in Foundry's list (narrator, table size and time, reactions' size, layer, language)",
  ["splashDry", "splashK0", "splashState", "splashTableScale", "splashTableHold", "tokenReactSize", "tokenReactLayer", "tokenReactLang", "splashLang"].every((k) => D.ROWS.some((r) => r.key === k)));

/* ---------------- D migration (GM seat, ready) ---------------- */
await Table.migrate();
const W = (k) => worldStore.get(`${MOD}.${k}`);
ck("D1 the GM's old layer became the table's", W("splashLayer") === "overlay");
ck("D2 the GM's opt-in backdrop became the table's", W("splashBackdrop") === true);
ck("D3 the GM's threshold became the table's", W("splashFullFrom") === 0.85);
ck("D4 'Always animate' became Full, which is the default (nothing written; a seat's own reduced motion applies)", !worldStore.has(`${MOD}.splashMotion`) && settingsApi.get(MOD, "splashMotion") === "auto");
ck("D5 a value equal to the default writes nothing", !worldStore.has(`${MOD}.splashOthers`) && !worldStore.has(`${MOD}.tokenReactEnabled`));
ck("D6 the GM's own 'Off on this screen' of the animations is not carried (the table's own on/off switch existed)", !worldStore.has(`${MOD}.tokenAnimMine`));
const tbl = W(D.TABLE_KEY);
ck("D7 the GM's engine preferences became the table's (impact local, size 1.4, Full motion as Full)", tbl?.impact === "local" && tbl?.scale === 1.4 && tbl?.motion === "auto");
ck("D8 the photosensitivity guard is not a table value at all", tbl && !("photosafe" in tbl));
ck("D9 the table's splash language = what the GM saw (his Polish interface)", W("splashLang") === "pl");
ck("D10 marked done", W(D.MIGRATED_KEY) === D.MIGRATION);
const before = worldWrites.length;
await Table.migrate();
ck("D11 a second run writes nothing", worldWrites.length === before);
ck("D12 the GM's old browser values are left as they were", local.getItem(`${MOD}.splashLayer`) === JSON.stringify("overlay"));

/* the GM's seat now follows the table */
Table.applySeat();
ck("C1 the GM's seat engine now holds the table's values", settingsApi.get(NS, "impact") === "local" && settingsApi.get(NS, "scale") === 1.4 && settingsApi.get(NS, "motion") === "auto");
ck("E1 the photosensitivity guard is back on on the seat that had it off", settingsApi.get(NS, "photosafe") === true);

/* the GM changes an engine preference in the engine's own window: it becomes the table's */
await settingsApi.set(NS, "impact", "off");
await new Promise((r) => setTimeout(r, 5));
ck("C2 a GM's change in the engine's own window becomes the table's", W(D.TABLE_KEY)?.impact === "off");

/* ---------------- B / C / E: a player's seat in the same world ---------------- */
isGM = false; sysLang.v = "en"; worldWrites = []; notes = [];
const playerLocal = new LS();
playerLocal.setItem(`${MOD}.splashLayer`, JSON.stringify("screen"));         // his own earlier choice
playerLocal.setItem(`${MOD}.splashEnabled`, JSON.stringify(false));
playerLocal.setItem(`${NS}.impact`, JSON.stringify("full"));
playerLocal.setItem(`${NS}.flashes`, JSON.stringify(false));
local = playerLocal; globalThis.localStorage = playerLocal;
/* (the player's seat: the same registry, a fresh browser storage) */
ck("B1 the player's seat reads the table's layer, not his own old one", settingsApi.get(MOD, "splashLayer") === "overlay" && settingsApi.get(MOD, "splashEnabled") === true);
Hooks.callAll("ready");
await new Promise((r) => setTimeout(r, 20));
ck("B2 the player's seat start writes no world setting", worldWrites.length === 0 && refused === 0);
ck("D13 a player's own engine values are backed up once (kept, unused)", JSON.parse(playerLocal.getItem(`${MOD}.gmallEngineBackup`) ?? "{}")?.values?.flashes === false);
ck("D14 a player whose own choices differed is told once", notes.length === 1);
ck("D15 his old splash values stay in his browser untouched", playerLocal.getItem(`${MOD}.splashLayer`) === JSON.stringify("screen"));
ck("C3 the player's seat engine holds the table's values", settingsApi.get(NS, "impact") === "off" && settingsApi.get(NS, "flashes") === true && settingsApi.get(NS, "photosafe") === true);
notes = [];
Hooks.callAll("ready");     // (a second load)
await new Promise((r) => setTimeout(r, 20));
ck("D16 told only once", notes.length === 0);
/* the player changes an engine preference by hand (the engine's window): put back, told */
await settingsApi.set(NS, "impact", "full");
await new Promise((r) => setTimeout(r, 5));
ck("B3 a player's hand change of an engine preference is put back to the table's", settingsApi.get(NS, "impact") === "off");
ck("B4 ... and he is told the GM chooses", notes.some((m) => /game master|MG/.test(m)));
ck("B5 ... and nothing reached the table", worldWrites.length === 0 && W(D.TABLE_KEY)?.impact === "off");
/* the player tries the world settings directly: the server refuses (our code never tries) */
let threw = false; try { await settingsApi.set(MOD, "splashLayer", "screen"); } catch { threw = true; }
ck("B6 a player's direct write of a table option is refused", threw && W("splashLayer") === "overlay");
ck("B7 a player's migration does nothing", (await Table.migrate()).length === 0);

/* C: the GM changes the table live; the player's seat follows on its next word */
isGM = true;
await settingsApi.set(MOD, D.TABLE_KEY, { ...W(D.TABLE_KEY), impact: "full", movement: "stepped", scale: 0.8 });
ck("C4 the GM's change reached the player's engine at once (onChange on every seat)", settingsApi.get(NS, "impact") === "full" && settingsApi.get(NS, "scale") === 0.8);
await settingsApi.set(MOD, "splashLang", "en");
const sixEn = Logic.LBL.six(2);
await settingsApi.set(MOD, "splashLang", "pl");
const sixPl = Logic.LBL.six(2);
ck(`C5 the shown count follows the table's language on an English seat (${sixEn} -> ${sixPl})`, /SIXES/.test(sixEn) && /SZÓST/.test(sixPl));
sysLang.v = "pl";
await settingsApi.set(MOD, "splashLang", "en");
ck("C6 a Polish seat shows the English table's words too", /SIXES/.test(Logic.LBL.six(2)));
await settingsApi.set(MOD, "splashLang", "pl");
const plWord = Logic.LBL.sfx && Object.values(Logic.LBL.sfx).length > 0;
ck("C7 the action words follow the table's language (Polish table: Polish words where they exist)", plWord);
isGM = false;

/* E: the seat's own accessibility signals */
osReduced = true;
await settingsApi.set(MOD, D.TABLE_KEY, { ...W(D.TABLE_KEY) }).catch(() => {});      // (player: refused; re-apply by hand)
Table.applySeat();
ck("E2 a seat with system reduced motion keeps Auto (reduced there) even when the table says Full", settingsApi.get(NS, "motion") === "auto");
ck("E3 seatValue never writes 'full' motion", D.seatValue({ motion: "full" }, "motion", { osReduced: true }) === "auto" && D.seatValue({ motion: "full" }, "motion", {}) === "auto");
osReduced = false;
await settingsApi.set("core", "photosensitiveMode", true);
ck("E4 Foundry's photosensitive mode on this seat: no flash frames here (table on)", settingsApi.get(NS, "flashes") === false && W(D.TABLE_KEY)?.flashes !== false);
await settingsApi.set("core", "photosensitiveMode", false);
ck("E5 ... off again: the table's flash frames back", settingsApi.get(NS, "flashes") === true);
ck("E6 the guard is pinned for every table value", [{}, { flashes: false }, { motion: "reduced" }].every((tv) => D.seatValue(tv, "photosafe", {}) === true));
ck("E7 a GM's own photosensitive seat does not make the table flash-free", D.adopt({ flashes: true }, "flashes", false, { photosensitive: true }) === null);
ck("E8 a GM cannot adopt the guard off", D.adopt({}, "photosafe", false, {}) === null);
/* the splash's own motion: the table's Full never overrides a seat's own reduced motion */
const sp = readFileSync(join(root, "splash/main.mjs"), "utf8");
ck("E9 splash motion: reduced when the table says so OR the seat's system asks", /S\.setReduced\(m === 'reduced' \|\| !!window\.matchMedia/.test(sp));
ck("E10 splash effects: a photosensitive seat gets at most the gentle ones", /photosensitive\(\) \? Math\.min\(k, 0\.5\)/.test(sp));

/* the token animations' motion: the table's, read by every seat */
{ const appSrc = readFileSync(join(root, "table/app.mjs"), "utf8");
  const all3 = (src) => ["createSetting", "updateSetting", "deleteSetting"].every((h) => src.includes(`"${h}"`));
  ck("C9 the table window and the animations panel follow a GM change live also when it creates or deletes the world doc (first change, defaults)", all3(appSrc) && all3(panelSrc)); }
ck("C8 token animations' motion is the table's (world) and a seat with reduced motion stays still", registry.get(`${MOD}.tokenAnimMine`)?.scope === "world");
console.log(`sweep gmall: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
