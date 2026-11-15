/* GMALL: the table's settings, pure part (no Foundry). The owner, 2026-11-15: «wszystko mg wybiera dla stołu. wszystko»: every option of
   the roll splash, the token reactions, their animations and the lettering engine is chosen by the GM for the whole table: world scope,
   changed only by the GM, shown read-only to the players, applied live on every seat.

   Two kinds of rows that hold a value:
     mod     a world setting of this module (registered by its own area: splash/main.mjs, tokenreact/main.mjs, tokenanim/main.mjs)
     engine  a preference of the lettering engine. UNMIRROR: since engine 1.9.16 the engine itself holds them as the TABLE's (L.table,
             written by a GM with L.setTable, hook "moinenLettersTable" on every seat, refused on a player's seat). This module keeps no
             copy and writes no engine setting: its window reads L.table and calls L.setTable, nothing else. What a seat may still differ
             in (its own system's reduced motion, Foundry's photosensitive mode) and the photosensitivity guard are the engine's (L.seat).
   An OLDER engine copy (before 1.9.16, no L.setTable) can still win on a page in a broken install (UNMIRROR-1): its preferences are then
   each screen's own; the window shows them read-only with a note and writes nothing (engineMode). */
import { TABLE as LETR, TABLE_OBJECT } from "../letters/prefs.mjs";

export const MOD = "invincible-plus-ultra";
export const NS = "moinen-letters";
export const MIGRATED_KEY = "tableMigrated";      // world Number: the version of this package's migration the world has run
/* 1 = GMALL (the GM's own client values became the table's), 2 = UNMIRROR (the engine holds the lettering table; our old copy is carried) */
export const MIGRATION = 2;
/* GMALL's own world copy of the table's engine preferences (1 .. UNMIRROR). Never written by this module any more; read once to carry it
   into the engine's table (legacyCarry), and offered to the engine's own one-time migration while that has not run (legacyNeeded). */
export const LEGACY_KEY = "lettersTable";

/* the engine preferences the table chooses, in the window's order */
export const ENGINE_KEYS = ["enabled", "face", "movement", "motion", "scale", "palette", "flashes", "impact", "announce", "limitScreen", "limitWorld"]
  .filter((k) => k in LETR);
/* the ones the engine keeps in its world object `moinen-letters.table` (movement and face are its own older world settings). The name
   ENGINE_MIRROR is read by the vendored engine's check-table.mjs section 8 (written while GMALL still mirrored); the engine drops that
   section with its bridge, then this alias can go. */
export const ENGINE_OBJECT = ENGINE_KEYS.filter((k) => TABLE_OBJECT.includes(k));
export const ENGINE_MIRROR = ENGINE_OBJECT;
export const ENGINE_DEFAULTS = Object.fromEntries(ENGINE_KEYS.map((k) => [k, LETR[k].default]));

/** what the running engine offers: "table" (1.9.16+: the table's preferences, L.table / L.setTable), "old" (an older copy won: each
    screen's own client settings), "none" (no engine on this page) */
export function engineMode(L) {
  if (!L || typeof L !== "object") return "none";
  return typeof L.setTable === "function" && L.table && typeof L.table === "object" ? "table" : "old";
}
/** the value of an engine row: the table's (mode "table") or, from an older engine, this screen's own (read-only) */
export function engineValue(L, k) {
  const m = engineMode(L);
  const src = m === "table" ? L.table : m === "old" ? L.prefs ?? {} : {};
  const v = src?.[k];
  if (v === undefined) return ENGINE_DEFAULTS[k];
  return k === "motion" && v === "full" ? "auto" : v;
}
/** what this screen's own signals change here (L.seat: { osReduced, photosensitive }), for the window's "On this screen" line */
export function seatNote(L) {
  if (engineMode(L) !== "table") return null;
  const s = L.seat ?? {}, reduced = !!s.osReduced && engineValue(L, "motion") !== "reduced", photo = !!s.photosensitive;
  return reduced && photo ? "both" : reduced ? "reduced" : photo ? "photo" : "none";
}

/* ---------------- carrying GMALL's old copy into the engine's table (once, by a GM seat; UNMIRROR) ----------------
   The engine's own one-time migration (1.9.16) takes plus-ultra's `lettersTable` first when that setting is REGISTERED; so while the
   world holds our old copy and the engine has not migrated yet, we register it (config: false, written by nobody) for that run. */
export function legacyNeeded({ legacyDoc, engineMigrated }) {
  return !!legacyDoc && !(Number(engineMigrated) >= 1);
}
/** after the engine's migration: the values to give L.setTable, or null. Our old copy wins where the engine migrated in THIS session
    (fresh: it had not when this page started, so its table can only hold what its migration took; an engine that no longer reads our
    copy would have taken the GM's old browser values instead) or where our copy is NEWER than the engine's table document (a world that
    ran an older engine with GMALL after the engine had migrated), and only where it differs. Stamps are the Setting documents' modified
    times (ms); a missing engine document counts as oldest. */
export function legacyCarry({ legacy, legacyAt, engineAt, table, fresh = false }) {
  if (!legacy || typeof legacy !== "object") return null;
  if (!fresh && Number.isFinite(engineAt) && !(Number(legacyAt) > engineAt)) return null;
  const out = {};
  for (const k of ENGINE_OBJECT) {
    if (!(k in legacy)) continue;
    let v = legacy[k];
    if (k === "motion" && v === "full") v = "auto";
    const d = LETR[k];
    const ok = d.type === "bool" ? typeof v === "boolean" : d.type === "pick" ? d.choices.includes(v) : Number.isFinite(Number(v));
    if (!ok) continue;
    if (d.type === "num") v = Math.max(d.min, Math.min(d.max, Number(v)));
    if (table?.[k] !== v) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/* ---------------------------------------------------------------- the settings this package moved from client to world
   area, key (in this module), and how an old client value is carried over (migration.mjs). */
export const CONVERTED = [
  ...["enabled", "others", "placement", "scale", "hold", "effects", "motion", "fullscreen", "fullFrom", "debug", "lettering", "layer", "chat", "backdrop"]
    .map((k) => ({ area: "splash", key: "splash" + k.charAt(0).toUpperCase() + k.slice(1) })),
  { area: "tokenreact", key: "tokenReactEnabled" },
  { area: "tokenanim", key: "tokenAnimMine" }
];
/** an old client value as the table takes it, or undefined (keep the table's default). The GM's own screen choice becomes the table's,
    unless a table setting for the same thing already existed (that one wins): the animations' own "Off on this screen" next to the
    table's on/off switch is not carried. "Always animate" becomes "Full" (a seat's own reduced motion applies). */
export function carry(key, v) {
  if (key === "tokenAnimMine" && v === "off") return undefined;
  if (key === "splashMotion" && v === "full") return "auto";
  return v;
}

/* ---------------------------------------------------------------- the window's rows, grouped by what they affect
   row = { id, src: "mod"|"engine"|"info"|"seat", key, type: "bool"|"pick"|"range", choices?, range?, dep?: { id, is } , wide? }
   Choices and ranges of "mod" rows come from the registered setting (main.mjs), of "engine" rows from the engine's SETTINGS. */
const E = (k, extra = {}) => ({ id: `letters.${k}`, src: "engine", key: k, ...extra });
const M = (id, key, extra = {}) => ({ id, src: "mod", key, ...extra });
export const TABS = [
  { id: "letters", icon: "fa-solid fa-burst", sections: [
    { id: "look", rows: [E("enabled"), E("face", { dep: { id: "letters.enabled", is: true } }), E("scale", { dep: { id: "letters.enabled", is: true } }), E("palette", { dep: { id: "letters.enabled", is: true } })] },
    { id: "motion", rows: [E("movement", { dep: { id: "letters.enabled", is: true } }), E("motion", { dep: { id: "letters.enabled", is: true } }), E("flashes", { dep: { id: "letters.enabled", is: true } }), E("impact", { dep: { id: "letters.enabled", is: true } }), { id: "letters.photosafe", src: "info", key: "photosafe" }, { id: "letters.seat", src: "seat", key: "seat" }] },
    { id: "more", rows: [E("announce", { dep: { id: "letters.enabled", is: true } }), E("limitScreen", { dep: { id: "letters.enabled", is: true } }), E("limitWorld", { dep: { id: "letters.enabled", is: true } })] }
  ] },
  { id: "splash", icon: "fa-solid fa-dice-six", sections: [
    { id: "show", rows: [M("splash.enabled", "splashEnabled"), M("splash.others", "splashOthers", { dep: { id: "splash.enabled", is: true } }), M("splash.chat", "splashChat")] },
    { id: "moment", rows: [M("splash.lettering", "splashLettering", { dep: { id: "splash.enabled", is: true } }), M("splash.layer", "splashLayer", { dep: { id: "splash.lettering", is: true } }),
      M("splash.tableScale", "splashTableScale", { dep: { id: "splash.lettering", is: true } }), M("splash.tableHold", "splashTableHold", { dep: { id: "splash.lettering", is: true } }),
      M("splash.placement", "splashPlacement", { dep: { id: "splash.lettering", is: false } }), M("splash.scale", "splashScale", { dep: { id: "splash.lettering", is: false } }), M("splash.hold", "splashHold", { dep: { id: "splash.lettering", is: false } })] },
    { id: "crit", rows: [M("splash.fullscreen", "splashFullscreen", { dep: { id: "splash.enabled", is: true } }), M("splash.fullFrom", "splashFullFrom", { dep: { id: "splash.fullscreen", is: true } }),
      M("splash.backdrop", "splashBackdrop", { dep: { id: "splash.enabled", is: true } }), M("splash.effects", "splashEffects", { dep: { id: "splash.enabled", is: true } }), M("splash.motion", "splashMotion", { dep: { id: "splash.enabled", is: true }, choices: ["auto", "reduced"] })] },
    { id: "narrator", rows: [M("splash.dry", "splashDry"), M("splash.k0", "splashK0"), M("splash.state", "splashState")] },
    { id: "diag", rows: [M("splash.debug", "splashDebug")] }
  ] },
  { id: "reactions", icon: "fa-solid fa-person-falling-burst", sections: [
    { id: "words", rows: [M("reactions.enabled", "tokenReactEnabled"), M("reactions.size", "tokenReactSize", { dep: { id: "reactions.enabled", is: true } }), M("reactions.layer", "tokenReactLayer", { dep: { id: "reactions.enabled", is: true } })] },
    { id: "anim", panel: "tokenanim" }
  ] },
  { id: "lang", icon: "fa-solid fa-language", sections: [
    { id: "words", rows: [M("lang.splash", "splashLang"), M("lang.reactions", "tokenReactLang")] }
  ] }
];
export const ROWS = TABS.flatMap((t) => t.sections.flatMap((s) => s.rows ?? []));
export const rowById = (id) => ROWS.find((r) => r.id === id) ?? null;
/** a row shows when its dependency holds (values = { rowId: value }) */
export function shown(row, values) {
  if (!row.dep) return true;
  const parent = rowById(row.dep.id);
  if (parent && !shown(parent, values)) return false;
  return values[row.dep.id] === row.dep.is;
}

/** the engine choice list and range of an engine row */
export function engineSpec(k) {
  const d = LETR[k];
  if (!d) return null;
  if (d.type === "bool") return { type: "bool" };
  if (d.type === "pick") return { type: "pick", choices: d.choices.slice() };
  return { type: "range", range: { min: d.min, max: d.max, step: d.step } };
}
