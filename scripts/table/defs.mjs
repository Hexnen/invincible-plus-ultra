/* GMALL: the table's settings, pure part (no Foundry). The owner, 2026-11-15: «wszystko mg wybiera dla stołu. wszystko»: every option of
   the roll splash, the token reactions, their animations and what this module exposes of the lettering engine is chosen by the GM for
   the whole table: world scope, changed only by the GM, shown read-only to the players, applied live on every seat.

   Three kinds of rows:
     mod     a world setting of this module (registered by its own area: splash/main.mjs, tokenreact/main.mjs, tokenanim/main.mjs)
     engine  an engine preference (namespace "moinen-letters"). The engine (vendored, not ours to edit) still keeps these as CLIENT
             settings; the table's value lives in OUR world setting `lettersTable` and every seat copies it into its engine settings
             (main.mjs mirror). seatValue() is the one place that says what a seat may differ in: its own system's reduced motion and
             Foundry's photosensitive mode (the orchestrator's provisional limit, GMALL-1), and the engine's photosensitivity guard,
             which no setting turns off.
     engineWorld  an engine preference that is already the GM's (movement, face): written to the engine's own world setting.

   The provisional limit (told to the owner, not yet answered): what a seat's own operating system, browser or Foundry core says about
   accessibility is still honoured ON THAT SEAT; the engine's safety limits are never weakened by any setting. */
import { SETTINGS as LETR, DEFAULTS as LETR_DEFAULTS, clean as letrClean } from "../letters/prefs.mjs";

export const MOD = "invincible-plus-ultra";
export const NS = "moinen-letters";
export const TABLE_KEY = "lettersTable";          // world Object: the table's engine preferences
export const MIGRATED_KEY = "tableMigrated";      // world Number: the version of the GMALL migration this world has run
export const MIGRATION = 1;

/* the engine preferences the table chooses (client settings in the engine, mirrored on every seat) */
export const ENGINE_KEYS = ["enabled", "face", "movement", "motion", "scale", "palette", "flashes", "impact", "announce", "limitScreen", "limitWorld"]
  .filter((k) => k in LETR);
export const ENGINE_MIRROR = ENGINE_KEYS.filter((k) => LETR[k].scope !== "world");      // movement and face are already the engine's world settings
export const ENGINE_WORLD = ENGINE_KEYS.filter((k) => LETR[k].scope === "world");
/* the engine's "full" motion overrides a seat's own reduced-motion switch; the table's "Full" is stored as "auto" (full motion unless the
   seat's own system asks for less), so the GM is offered Full / Gentle / Reduced */
export const MOTION_CHOICES = ["auto", "gentle", "reduced"];
export const TABLE_DEFAULTS = Object.fromEntries(ENGINE_MIRROR.map((k) => [k, LETR_DEFAULTS[k]]));

/** a stored table value, cleaned (a hand-edited or older value never breaks a seat) */
export function cleanTable(v) {
  const o = v && typeof v === "object" ? v : {};
  const out = {};
  for (const k of ENGINE_MIRROR) {
    let x = letrClean(k, k in o ? o[k] : TABLE_DEFAULTS[k]);
    if (k === "motion" && x === "full") x = "auto";
    out[k] = x;
  }
  return out;
}

/** what THIS seat writes into its engine setting k, from the table's values and the seat's own accessibility signals
    seat = { osReduced (prefers-reduced-motion), photosensitive (Foundry core.photosensitiveMode) } */
export function seatValue(table, k, seat = {}) {
  const t = cleanTable(table);
  if (k === "photosafe") return true;                                       // the guard is never weakened by a setting
  if (!(k in t)) return undefined;
  if (k === "motion") return t.motion === "full" ? "auto" : t.motion;      // a seat's own reduced motion always applies ("auto" honours it)
  if (k === "flashes") return t.flashes && !seat.photosensitive;            // Foundry's photosensitive mode on this seat: no flash frames
  return t[k];
}
/** every engine client setting this seat should hold */
export function seatValues(table, seat = {}) {
  const o = {};
  for (const k of [...ENGINE_MIRROR, "photosafe"]) o[k] = seatValue(table, k, seat);
  return o;
}
/** a GM changed an engine client setting by hand (the engine's own window): the table's new value, or null when it is not the table's to
    take (photosafe is pinned; a value that only reflects this seat's own accessibility is not adopted) */
export function adopt(table, k, v, seat = {}) {
  if (!ENGINE_MIRROR.includes(k)) return null;
  if (k === "flashes" && seat.photosensitive && v === false) return null;
  const t = cleanTable(table);
  const nv = letrClean(k, v);
  const cur = k === "motion" ? t.motion : t[k];
  const want = k === "motion" && nv === "full" ? "auto" : nv;
  return want === cur ? null : { ...t, [k]: want };
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
   row = { id, src: "mod"|"engine"|"engineWorld"|"info", key, type: "bool"|"pick"|"range", choices?, range?, dep?: { id, is } , wide? }
   Choices and ranges of "mod" rows come from the registered setting (main.mjs), of "engine" rows from the engine's SETTINGS. */
const E = (k, extra = {}) => ({ id: `letters.${k}`, src: LETR[k]?.scope === "world" ? "engineWorld" : "engine", key: k, ...extra });
const M = (id, key, extra = {}) => ({ id, src: "mod", key, ...extra });
export const TABS = [
  { id: "letters", icon: "fa-solid fa-burst", sections: [
    { id: "look", rows: [E("enabled"), E("face", { dep: { id: "letters.enabled", is: true } }), E("scale", { dep: { id: "letters.enabled", is: true } }), E("palette", { dep: { id: "letters.enabled", is: true } })] },
    { id: "motion", rows: [E("movement", { dep: { id: "letters.enabled", is: true } }), E("motion", { dep: { id: "letters.enabled", is: true } }), E("flashes", { dep: { id: "letters.enabled", is: true } }), E("impact", { dep: { id: "letters.enabled", is: true } }), { id: "letters.photosafe", src: "info", key: "photosafe" }] },
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
  if (k === "motion") return { type: "pick", choices: MOTION_CHOICES.slice() };
  if (d.type === "bool") return { type: "bool" };
  if (d.type === "pick") return { type: "pick", choices: d.choices.slice() };
  return { type: "range", range: { min: d.min, max: d.max, step: d.step } };
}
