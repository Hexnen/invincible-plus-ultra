/* node scripts/sweep-checks/unmirror.mjs -- UNMIRROR (2026-11-15): one truth for the table's lettering preferences, held by the lettering
   engine (1.9.16+: L.table / L.setTable / hook "moinenLettersTable"); this module's window "Comic effects: table settings" reads and writes
   that table and keeps no copy (no world setting of its own, no mirror into the engine, no patch of the engine's window).
   On a fake Foundry with v14's settings semantics (world values in Setting documents with modified times, written only by a GM, onChange and
   create/update/delete hooks on every seat, pre-hooks on the writing seat; client values in localStorage), two seats in one process (a GM
   and a player, each with its own instance of the REAL engine settings code scripts/letters/tools.mjs, of this module's table code and its
   own browser storage and accessibility signals):
   U1 plus-ultra alone and U2 both modules: nothing of ours registered or written for the lettering; every engine preference changed in OUR
      window reaches the player's seat and its next word; the player's window reads it; the player's attempts are refused and write nothing;
      the seat's own reduced motion and photosensitive mode still apply there only (and the window says so on that seat)
   U3 migration of a world that used GMALL's copy (`lettersTable`) before the engine held the table: the engine's own migration takes it,
      nothing is lost, it runs once, and on the next load nothing of ours is registered and the copy is never written again
   U4 a world whose old copy is NEWER than the engine's table (an older engine ran in between): carried; older: left alone
   U5 an older engine copy winning on a page (UNMIRROR-1): the window shows its screen's values read-only, writes nothing, the
      migration waits for a table engine
   U6 the source: no mirror, no engine window patch, no write of the engine's namespace anywhere in scripts/table/ */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const LETTERS = new URL("../letters/", import.meta.url), TABLE = new URL("../table/", import.meta.url);
const NS = "moinen-letters", PU = "invincible-plus-ultra";
let n = 0, f = 0;
const ck = (name, ok) => { n++; if (!ok) { f++; console.log("FAIL", name); } else if (process.env.LETR_VERBOSE) console.log("ok  ", name); };
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

const P = await import(new URL("prefs.mjs", LETTERS));
const Dz = await import(new URL("design.mjs", LETTERS));
const D = await import(new URL("defs.mjs", TABLE));
const { FontBank } = await import(new URL("fontbank.mjs", LETTERS));
const bank = new FontBank();
for (const [id, fo] of Object.entries(Dz.FONTS)) { if (!fo.file || fo.custom) continue; const b = fs.readFileSync(new URL(fo.file, LETTERS)); bank.add(id, b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); }
const fontsApi = { adv: (fid, c) => bank.adv(fid, c) };

/* ---------------- the fake Foundry (world shared, seats apart) ---------------- */
class LS { constructor(o = {}) { this.m = new Map(Object.entries(o).map(([k, v]) => [k, JSON.stringify(v)])); } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { this.m.set(k, String(v)); } removeItem(k) { this.m.delete(k); } }
const SWAP = ["game", "Hooks", "localStorage", "ui", "matchMedia", "MoinenLetters"];
function makeWorld(docs = {}) {
  const world = { store: new Map(), at: new Map(), now: 10_000, seats: [], writes: [] };
  for (const [id, [v, t]] of Object.entries(docs)) { world.store.set(id, clone(v)); world.at.set(id, t); }
  const put = (s) => { for (const k of SWAP) globalThis[k] = s[k === "localStorage" ? "ls" : k]; };
  world.with = (seat, fn) => { const prev = world.cur; world.cur = seat; put(seat); try { return fn(); } finally { if (prev) { world.cur = prev; put(prev); } } };
  world.run = async (seat, fn) => { world.cur = null; world.cur = seat; put(seat); const r = await fn(); await tick(5); return r; };
  return world;
}
function makeSeat(world, { name, gm, ls = {}, modules = [PU] }) {
  const reg = new Map(), menus = new Map(), hooks = {}, notes = [], fired = {};
  let hid = 0;
  const Hooks = {
    on: (k, fn) => { (hooks[k] ??= []).push({ id: ++hid, fn }); return hid; },
    once: (k, fn) => { (hooks[k] ??= []).push({ id: ++hid, fn, once: true }); return hid; },
    off: (k, id) => { hooks[k] = (hooks[k] ?? []).filter((h) => h.id !== id); },
    callAll: (k, ...a) => { fired[k] = (fired[k] ?? 0) + 1; for (const h of [...(hooks[k] ?? [])]) { if (h.once) Hooks.off(k, h.id); h.fn(...a); } return true; },
    call: (k, ...a) => { for (const h of [...(hooks[k] ?? [])]) { if (h.once) Hooks.off(k, h.id); if (h.fn(...a) === false) return false; } return true; }
  };
  const seat = { name, gm, reg, menus, Hooks, notes, fired, ls: new LS(ls), sig: { osReduced: false }, ui: { notifications: { info: (m) => notes.push(String(m)), warn: (m) => notes.push(String(m)), error: (m) => notes.push(`ERR ${m}`) } } };
  seat.matchMedia = (q) => ({ matches: /reduced-motion/.test(q) ? seat.sig.osReduced : false, addEventListener() {} });
  const doc = (id) => (world.store.has(id) ? { key: id, value: JSON.stringify(world.store.get(id)), _stats: { modifiedTime: world.at.get(id) } } : null);
  const settings = {
    settings: reg, menus,
    register: (ns, k, o) => reg.set(`${ns}.${k}`, { ...o, namespace: ns, key: k, id: `${ns}.${k}`, scope: o.scope ?? "client" }),
    registerMenu: (ns, k, o) => menus.set(`${ns}.${k}`, o),
    get(ns, k) {
      const id = `${ns}.${k}`, cfg = reg.get(id);
      if (!cfg) throw new Error(`"${id}" is not a registered game setting`);
      if (cfg.scope === "client") { const raw = seat.ls.getItem(id); if (raw === null) return clone(cfg.default); try { return JSON.parse(raw); } catch { return raw; } }
      return world.store.has(id) ? clone(world.store.get(id)) : clone(cfg.default);
    },
    async set(ns, k, v) {
      const id = `${ns}.${k}`, cfg = reg.get(id);
      if (!cfg) throw new Error(`"${id}" is not a registered game setting`);
      if (cfg.scope === "client") { seat.ls.setItem(id, JSON.stringify(v)); cfg.onChange?.(v); Hooks.callAll("clientSettingChanged", id, v, {}); return v; }
      const had = world.store.has(id), d = { key: id, value: v };
      if (Hooks.call(had ? "preUpdateSetting" : "preCreateSetting", d, { value: v }, {}, name) === false) { if (had) return clone(world.store.get(id)); throw new TypeError("Cannot read properties of undefined (reading 'value')"); }
      if (!seat.gm) { seat.ui.notifications.error("lacks permission"); throw new Error(`User ${name} lacks permission`); }
      world.store.set(id, clone(v)); world.at.set(id, ++world.now);
      world.writes.push([name, id, clone(v)]);
      for (const s of world.seats) world.with(s, () => { s.reg.get(id)?.onChange?.(clone(v)); s.Hooks.callAll(had ? "updateSetting" : "createSetting", { key: id, value: clone(v) }, {}, name); });
      return v;
    },
    storage: { get: (w) => (w === "world" ? { getSetting: (key) => doc(key) } : null) }
  };
  seat.game = {
    user: { id: name, name, isGM: gm }, users: { get: () => null }, ready: false, settings, keybindings: { register() {} },
    i18n: { lang: "en", format: (k) => k, localize: (k) => k, has: () => false, translations: {} },
    socket: { emit() {}, on() {} }, time: { serverTime: 0 },
    modules: new Map(modules.map((id) => [id, { id, active: true }]))
  };
  world.seats.push(seat);
  return seat;
}
/* the engine's play path as far as the preferences reach (as scripts/letters/check-table.mjs): options filter, plan, plan filter */
function fakeEngine({ old = false } = {}) {
  const ext = { opts: [], plan: [], start: [], preview: [] };
  const L = {
    _ext: ext, limits: { screen: 16, world: 48 }, version: old ? "1.9.14" : "test", _mode: "smooth", _face: "league",
    stream: () => ({}), gridClock() {}, ready: () => Promise.resolve(),
    motionMode(m) { if (m) L._mode = m; return L._mode; }, invFace(fc) { if (fc) L._face = fc; return L._face; },
    play(text, opts = {}) {
      let o = { ...opts };
      for (const fn of ext.opts) { const r = fn(o); if (r === null) return { off: true }; if (r) o = r; }
      const plan = Dz.makePlan(text, { ...o, look: { style: "invincible", face: L._face, motion: L._mode, ...(o.look ?? {}) } }, fontsApi, []);
      for (const fn of ext.plan) fn(plan, { opts: o, size: 40, space: "screen" });
      return { off: false, plan, opts: o };
    }
  };
  if (old) L.prefs = { ...P.cleanAll({}), scale: 1.3, impact: "local" };   // an older engine: this screen's own client values
  return L;
}
let inst = 0;
async function bootSeat(world, seat, { oldEngine = false } = {}) {
  const k = ++inst;
  const L = fakeEngine({ old: oldEngine });
  seat.L = L;
  seat.MoinenLetters = { engine: () => Promise.resolve(L) };
  globalThis.foundry ??= { applications: { api: { ApplicationV2: class {} } }, utils: { expandObject: (o) => o, mergeObject: (a, b) => Object.assign(a, b) } };
  globalThis.document ??= { addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {} }), body: { appendChild() {} }, head: { append() {} }, getElementById: () => null };
  globalThis.window ??= globalThis;
  seat.game.settings.register("core", "photosensitiveMode", { scope: "client", default: false });
  seat.Table = await import(new URL(`main.mjs?seat=${k}`, TABLE));
  seat.App = await import(new URL(`app.mjs?seat=${k}`, TABLE));
  if (!oldEngine) seat.T = await import(new URL(`tools.mjs?seat=${k}`, LETTERS));
  world.with(seat, () => {
    seat.Table.start({});                           // registers at init, like the module's start (phases not run yet)
    seat.Hooks.callAll("init");
    if (seat.T) {
      seat.T.init({ engine: () => Promise.resolve(L), _engine: L, build: { version: "test", hash: null, module: null } });
      seat.T.state.clock.start = () => {};
      seat.Hooks.callAll("setup");
    }
    seat.App.useEngine(L);
  });
  return seat;
}
async function readyAll(world, wait = 60) { for (const s of world.seats) { s.game.ready = true; await world.run(s, async () => { s.Hooks.callAll("ready"); await tick(wait); }); } }
const word = (world, s, t = "KRAK!", o = {}) => world.with(s, () => s.L.play(t, { mood: "crack", seed: "u1", ...o }));
const row = (id) => D.rowById(id);
const gmWrite = (world, gm, id, v) => world.run(gm, async () => { await gm.App.write(row(id), v); await tick(5); });
const noOurs = (world) => !world.writes.some(([, id]) => id === `${PU}.${D.LEGACY_KEY}`);

const saved = Object.fromEntries([...SWAP, "foundry", "document"].map((k) => [k, globalThis[k]]));
const warn0 = console.warn, info0 = console.info;
console.warn = () => {}; console.info = () => {};
try {
  /* ---------------- U1 / U2: the two situations, a fresh world ---------------- */
  for (const [label, modules] of [["plus-ultra alone", [PU]], ["both modules", ["moinen-maps", PU]]]) {
    const world = makeWorld();
    const gm = makeSeat(world, { name: "GM", gm: true, modules }), pl = makeSeat(world, { name: "Player", gm: false, modules });
    await bootSeat(world, gm); await bootSeat(world, pl);
    await readyAll(world);
    ck(`${label}: no world setting of ours holds the lettering (nothing registered)`, !gm.reg.has(`${PU}.${D.LEGACY_KEY}`) && !pl.reg.has(`${PU}.${D.LEGACY_KEY}`));
    ck(`${label}: our window reads the engine's table (mode "table")`, D.engineMode(gm.L) === "table" && D.engineMode(pl.L) === "table");
    ck(`${label}: the migration marks done without touching the engine's table`, world.store.get(`${PU}.${D.MIGRATED_KEY}`) === D.MIGRATION && !world.writes.some(([, id]) => id === `${NS}.table`));
    /* every engine preference, changed in OUR window by the GM: the player's seat follows on its next word, his window reads it */
    const CHANGES = [["scale", 1.7], ["palette", "contrast"], ["motion", "gentle"], ["motion", "reduced"], ["flashes", false], ["impact", "local"], ["announce", false],
      ["limitScreen", 5], ["limitWorld", 12], ["movement", "stepped"], ["face", "anton"], ["enabled", false]];
    for (const [k, v] of CHANGES) {
      const before = pl.fired.moinenLettersTable ?? 0;
      await gmWrite(world, gm, `letters.${k}`, v);
      await tick(140);                                         // the window's 120 ms gathering of quick changes
      const plv = world.with(pl, () => pl.App.values()[`letters.${k}`]);
      ck(`${label}: ${k} = ${v} in our window reaches the engine's table and the player's seat`, gm.T.state.table[k] === v && pl.T.state.table[k] === v);
      ck(`${label}: ... the player's window shows it and follows live (hook)`, plv === v && (pl.fired.moinenLettersTable ?? 0) > before);
    }
    ck(`${label}: ... on the player's next word: off when lettering is off`, word(world, pl).off === true);
    await gmWrite(world, gm, "letters.enabled", true); await tick(140);
    { const w = word(world, pl); ck(`${label}: ... the player's next word carries size, motion, face (${w.opts._k}, ${w.opts.reduced}, ${w.plan?.hand?.font})`, w.opts._k === 1.7 && w.opts.reduced === true && w.plan.hand.font === "anton" && pl.L._mode === "stepped"); }
    ck(`${label}: ... limits reach the player's engine`, pl.L.limits.screen === 5 && pl.L.limits.world === 12);
    /* quick changes (a slider dragged) go out as ONE write of the table object */
    { const w0 = world.writes.length;
      let settled = 0;
      await world.run(gm, async () => { const ps = [gm.App.write(row("letters.scale"), 1.1), gm.App.write(row("letters.scale"), 1.2), gm.App.write(row("letters.palette"), "cvd")];
        for (const p of ps) p.then(() => settled++, () => {});
        await Promise.race([Promise.all(ps), tick(1000)]); });
      await tick(20);
      const ws = world.writes.slice(w0);
      ck(`${label}: three quick changes in the window = one write of the engine's table (${ws.length})`, ws.length === 1 && ws[0][1] === `${NS}.table` && pl.T.state.table.scale === 1.2 && pl.T.state.table.palette === "cvd");
      ck(`${label}: ... and every one of the three changes learns it was saved (${settled}/3)`, settled === 3); }
    /* the player: refused everywhere, nothing written */
    { const snap = JSON.stringify([...world.store]); const w0 = world.writes.length; pl.notes.length = 0;
      let rej = false; try { await world.run(pl, () => pl.App.write(row("letters.scale"), 2.5)); } catch { rej = true; }
      ck(`${label}: the player's change in our window is refused`, rej);
      const r = await world.run(pl, () => pl.L.setTable({ scale: 2.5, enabled: false }));
      ck(`${label}: the player's L.setTable is refused and he is told the GM chooses`, r === false && pl.notes.some((m) => /Refused/.test(m)));
      try { await world.run(pl, () => pl.game.settings.set(NS, "table", { scale: 2.5 })); } catch { /* stopped */ }
      ck(`${label}: the player's direct write is stopped on his seat (no error from the server on his screen)`, !pl.notes.some((m) => /^ERR/.test(m)));
      ck(`${label}: ... and nothing at all was written`, JSON.stringify([...world.store]) === snap && world.writes.length === w0); }
    /* the seat's own signals: on that seat only, and our window says so there */
    pl.sig.osReduced = true; world.with(pl, () => pl.T.readPrefs());
    await gmWrite(world, gm, "letters.motion", "auto"); await tick(140);
    { const wp = word(world, pl), wg = word(world, gm);
      ck(`${label}: a player whose system asks for reduced motion gets it at the table's Full; the GM keeps full; the table unchanged`, wp.opts.reduced === true && wg.opts.reduced === false && pl.T.state.table.motion === "auto");
      ck(`${label}: ... the player's window says so on his screen only`, world.with(pl, () => pl.App.values()["letters.seat"]) === "reduced" && world.with(gm, () => gm.App.values()["letters.seat"]) === "none"); }
    pl.sig.osReduced = false;
    await gmWrite(world, gm, "letters.flashes", true); await tick(140);
    await world.run(pl, () => pl.game.settings.set("core", "photosensitiveMode", true));
    ck(`${label}: Foundry's photosensitive mode: no flash frames on that seat only (table on)`, pl.T.state.table.flashes === true && pl.T.state.prefs.flashes === false && gm.T.state.prefs.flashes === true);
    ck(`${label}: ... and the window names it`, ["photo", "both"].includes(world.with(pl, () => pl.App.values()["letters.seat"])));
    ck(`${label}: the guard is on on every seat`, pl.T.state.prefs.photosafe === true && gm.T.state.prefs.photosafe === true);
    await world.run(pl, () => pl.game.settings.set("core", "photosensitiveMode", false));
    ck(`${label}: nothing of ours written in the whole run (one truth: the engine's table)`, noOurs(world) && !world.writes.some(([, id]) => id.startsWith(`${PU}.`) && id !== `${PU}.${D.MIGRATED_KEY}`));
  }

  /* ---------------- U3: a world from GMALL (our old copy), engine not migrated yet ---------------- */
  {
    const legacy = { enabled: true, motion: "gentle", scale: 1.25, palette: "cvd", flashes: false, impact: "local", announce: true, limitScreen: 9, limitWorld: 30 };
    const world = makeWorld({ [`${PU}.${D.LEGACY_KEY}`]: [legacy, 5000], [`${PU}.${D.MIGRATED_KEY}`]: [1, 5000], [`${NS}.movement`]: ["stepped", 5000] });
    const gm = makeSeat(world, { name: "GM", gm: true, ls: { [`${NS}.scale`]: 2, [`${NS}.palette`]: "contrast" } }), pl = makeSeat(world, { name: "Player", gm: false, ls: { [`${NS}.flashes`]: true } });
    await bootSeat(world, gm); await bootSeat(world, pl);
    ck("migration: our old copy is offered to the engine's own migration (registered on every seat)", gm.reg.has(`${PU}.${D.LEGACY_KEY}`) && pl.reg.has(`${PU}.${D.LEGACY_KEY}`));
    await readyAll(world, 120);
    const tb = world.store.get(`${NS}.table`);
    ck(`migration: every value the GM had chosen in our window is the engine's table now (${JSON.stringify(tb)})`, D.ENGINE_OBJECT.every((k) => tb?.[k] === legacy[k]));
    ck("migration: the GM's own older browser values did not win over the table he chose", tb?.scale === 1.25 && tb?.palette === "cvd");
    ck("migration: movement (already the engine's) kept", pl.T.state.table.movement === "stepped");
    ck("migration: the player's seat applies the migrated table", pl.T.state.table.scale === 1.25 && pl.T.state.prefs.flashes === false && pl.T.state.prefs.impact === "local");
    ck("migration: marked done once (ours 2, the engine's 1)", world.store.get(`${PU}.${D.MIGRATED_KEY}`) === D.MIGRATION && world.store.get(`${NS}.tableMigrated`) === 1);
    const w0 = world.writes.length;
    await world.run(gm, () => gm.Table.migrate());
    ck("migration: a second run writes nothing", world.writes.length === w0);
    ck("migration: our old copy stays in the world as it was (nothing deleted)", JSON.stringify(world.store.get(`${PU}.${D.LEGACY_KEY}`)) === JSON.stringify(legacy));
    /* the next load: nothing of ours registered; a GM change never writes our old copy again */
    const gm2 = makeSeat(world, { name: "GM", gm: true }), pl2 = makeSeat(world, { name: "Player", gm: false });
    world.seats.splice(0, 2);
    await bootSeat(world, gm2); await bootSeat(world, pl2); await readyAll(world);
    ck("next load: our old copy is not registered any more", !gm2.reg.has(`${PU}.${D.LEGACY_KEY}`) && !pl2.reg.has(`${PU}.${D.LEGACY_KEY}`));
    const w1 = world.writes.length;
    await gmWrite(world, gm2, "letters.scale", 0.9); await tick(140);
    ck("next load: a GM change goes only to the engine's table (our old copy never written again)", world.writes.slice(w1).every(([, id]) => id === `${NS}.table`) && world.writes.length > w1 && pl2.T.state.table.scale === 0.9);
  }

  /* ---------------- U4: our old copy newer / older than the engine's table ---------------- */
  for (const [label, legacyAt, want] of [["newer", 9000, 0.8], ["older", 1000, 1.2]]) {
    const world = makeWorld({ [`${NS}.table`]: [{ ...P.TABLE_DEFAULTS, movement: undefined, face: undefined, scale: 1.2 }, 5000], [`${NS}.tableMigrated`]: [1, 5000],
      [`${PU}.${D.LEGACY_KEY}`]: [{ scale: 0.8, impact: "off" }, legacyAt], [`${PU}.${D.MIGRATED_KEY}`]: [1, 5000] });
    const gm = makeSeat(world, { name: "GM", gm: true }), pl = makeSeat(world, { name: "Player", gm: false });
    await bootSeat(world, gm); await bootSeat(world, pl);
    ck(`old copy ${label}: not offered to the engine's migration (it has run)`, !gm.reg.has(`${PU}.${D.LEGACY_KEY}`));
    await readyAll(world, 120);
    ck(`old copy ${label}: the table's size is ${want} on both seats`, gm.T.state.table.scale === want && pl.T.state.table.scale === want && (want === 0.8 ? pl.T.state.table.impact === "off" : pl.T.state.table.impact === "full"));
    ck(`old copy ${label}: marked done`, world.store.get(`${PU}.${D.MIGRATED_KEY}`) === D.MIGRATION);
  }
  ck("legacyCarry: an invalid stored value is never carried", D.legacyCarry({ legacy: { scale: "x", motion: "full", impact: "loud" }, legacyAt: 2, engineAt: 1, table: { motion: "gentle" } })?.motion === "auto" && !("scale" in (D.legacyCarry({ legacy: { scale: "x", motion: "full" }, legacyAt: 2, engineAt: 1, table: {} }) ?? {})));

  /* ---------------- U5: an older engine copy wins (UNMIRROR-1) ---------------- */
  {
    const world = makeWorld({ [`${PU}.${D.LEGACY_KEY}`]: [{ scale: 0.8 }, 5000], [`${PU}.${D.MIGRATED_KEY}`]: [1, 5000] });
    const gm = makeSeat(world, { name: "GM", gm: true });
    await bootSeat(world, gm, { oldEngine: true }); await readyAll(world, 40);
    ck("older engine: mode old, the window reads this screen's own values", D.engineMode(gm.L) === "old" && world.with(gm, () => gm.App.values()["letters.scale"]) === 1.3);
    let rej = false; try { await world.run(gm, async () => { await gm.App.write(row("letters.scale"), 2); }); } catch { rej = true; }
    ck("older engine: the GM's change is not taken (nothing written)", rej && !world.writes.length);
    ck("older engine: the migration waits for a table engine (not marked)", world.store.get(`${PU}.${D.MIGRATED_KEY}`) === 1);
    ck("older engine: the window has nothing to say about this screen", world.with(gm, () => gm.App.values()["letters.seat"]) === null);
  }

  /* ---------------- U6: the source ---------------- */
  {
    const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const src = ["main.mjs", "app.mjs", "defs.mjs"].map((fn) => code(fs.readFileSync(join(root, "table", fn), "utf8"))).join("\n");
    ck("source: no mirror (no clientSettingChanged, no applySeat, no seatValue)", !/clientSettingChanged|applySeat|seatValue|adopt\(/.test(src));
    ck("source: no patch of the engine's window", !/renderApplicationV2|moinen-letters-settings|ipt-engine-note/.test(src));
    ck("source: nothing written under the engine's namespace by hand (only L.setTable)", !/settings\.set\(\s*NS/.test(src) && /L\.setTable\(/.test(src));
    ck("source: our old copy is never written", !/settings\.set\(\s*MOD\s*,\s*(LEGACY_KEY|TABLE_KEY|"lettersTable")/.test(src));
  }
} finally {
  await tick(650);   /* each booted engine seat says hello 500 ms after ready: let it run on the fake table */
  for (const [k, v] of Object.entries(saved)) globalThis[k] = v;
  console.warn = warn0; console.info = info0;
}
console.log(`sweep unmirror: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
