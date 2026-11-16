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
/* 1 = GMALL (the GM's own client values became the table's), 2 = UNMIRROR (the engine holds the lettering table; our old copy is carried),
   3 = GMGOVERN (every remaining option of the module became the table's: GOVERNED below) */
export const MIGRATION = 3;
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

/* ---------------------------------------------------------------- GMGOVERN (2026-11-16): the rest of the module
   The owner's ruling covers EVERYTHING a seat shows or hears, not only the comic effects: a blind review of tag 161 found a player with
   the dice glow off who saw no marks where the GM saw them, and a player's own font changing the face of the roll card. So every OPTION
   of this module is the table's now: world scope, chosen by the GM in this window, read-only for the players, live on every seat.
   GOVERNED = the options this package moved from client to world (migration 3: the GM's own earlier browser value becomes the table's,
   where the world holds none yet and it differs from the default).
   What a seat may still differ in is not an option of ours:
     - its own safeguards: the system's reduced motion (every animated area reads it itself), Foundry's photosensitive mode (the comic
       slash, the lettering engine), Foundry's performance mode (the token halo's motion), Foundry's interface volume (scales the
       table's sound volume);
     - SEAT_MEMORY: what the seat itself did last on its own screen (a panel it folded, a view it switched inside a window, a hint it
       has seen). Hidden (config: false), written by the seat's own click, never offered as a choice. A check (sweep-checks/gmgovern.mjs)
       fails when a client-scope setting appears that is not on this list, or one on it becomes a visible option. */
export const GOVERNED = [
  "diceFxEnabled", "diceFxStrength", "diceFxSixes", "diceFxOnes", "diceFxOnesPushOnly", "diceFxOneStyle",
  "tokenHaloEnabled", "tokenHaloHover", "tokenHaloSelected", "tokenHaloTurn", "tokenHaloSize", "tokenHaloMotion", "tokenHaloHideBorder", "tokenHaloHideMarker",
  "experimental",
  "combatBannerEnabled", "combatBannerSize", "combatBannerRounds", "combatBarEnabled", "combatBarSize", "combatBarResources",
  "turnMessage", "turnTray", "turnConfirm", "turnAskAll", "turnGm", "turnSound",
  "tacticsHints", "tacticsSummary", "tacticsSoundVolume", "tacticsUiScale",
  "challengesEnabled", "challengesScale", "challengesVisible", "challengesCompact", "challengesCamera",
  "partyPips", "partySize", "partyStyle",
  "comicFont", "captionFont", "slashCalm",
  "baseHeaderButton", "chargenButton", "inlineStunts", "sessionAutoOpen", "hotpanQuiet", "logRevealJournals"
];
export const SEAT_MEMORY = {
  challengesCollapsed: "the Challenges panel folded or open on this screen (its own handle)",
  partyDisplay: "the party cards hidden, peeking or full on this screen (the panel's own handle cycles it)",
  chargenRank: "the rank last picked in the character generator on this screen",
  chargenRoll: "the roll options last used in the character generator on this screen",
  logDensity: "the density switched inside the Log tab on this screen",
  logShowMinor: "minor entries switched on inside the Log tab on this screen",
  tacticsHintsSeen: "which first-fight hints this screen has already shown",
  migratedFromSheetPlus: "bookkeeping: this browser's old values were copied from the module's earlier id"
};
/** GOVERNED: an old browser value as the table takes it (raw: (key) => that browser's stored value or undefined), or undefined. The
    token halo's motion replaced an earlier boolean "tokenHaloAnimate": a GM who had switched that off keeps "off". */
export function carryGoverned(key, raw) {
  const v = raw(key);
  if (key === "tokenHaloMotion" && v === undefined && raw("tokenHaloAnimate") === false) return "off";
  return v;
}

/* ---------------------------------------------------------------- the window's rows, grouped by what they affect
   A row with own: true takes its name, hint and choice labels from the setting's own registration (its area's strings); the others from
   this window's IPT.Row.* strings.
   row = { id, src: "mod"|"engine"|"info"|"seat", key, type: "bool"|"pick"|"range", choices?, range?, dep?: { id, is } , wide? }
   Choices and ranges of "mod" rows come from the registered setting (main.mjs), of "engine" rows from the engine's SETTINGS. */
const E = (k, extra = {}) => ({ id: `letters.${k}`, src: "engine", key: k, ...extra });
const M = (id, key, extra = {}) => ({ id, src: "mod", key, ...extra });
const O = (id, key, on = null, extra = {}) => ({ id, src: "mod", key, own: true, ...(on ? { dep: { id: on, is: true } } : {}), ...extra });
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
    /* GMGOVERN: the marks under the Dice So Nice dice (scripts/diceeffects/) */
    { id: "dice", rows: [O("dice.enabled", "diceFxEnabled"), O("dice.strength", "diceFxStrength", "dice.enabled"), O("dice.sixes", "diceFxSixes", "dice.enabled"),
      O("dice.ones", "diceFxOnes", "dice.enabled"), O("dice.onesPush", "diceFxOnesPushOnly", "dice.ones"), O("dice.oneStyle", "diceFxOneStyle", "dice.ones")] },
    { id: "diag", rows: [M("splash.debug", "splashDebug")] }
  ] },
  { id: "reactions", icon: "fa-solid fa-person-falling-burst", sections: [
    { id: "words", rows: [M("reactions.enabled", "tokenReactEnabled"), M("reactions.size", "tokenReactSize", { dep: { id: "reactions.enabled", is: true } }), M("reactions.layer", "tokenReactLayer", { dep: { id: "reactions.enabled", is: true } })] },
    { id: "anim", panel: "tokenanim" },
    /* GMGOVERN: the halftone ring under a token (scripts/tokenhalo/) */
    { id: "halo", rows: [O("halo.enabled", "tokenHaloEnabled"), O("halo.hover", "tokenHaloHover", "halo.enabled"), O("halo.selected", "tokenHaloSelected", "halo.enabled"), O("halo.turn", "tokenHaloTurn", "halo.enabled"),
      O("halo.size", "tokenHaloSize", "halo.enabled"), O("halo.motion", "tokenHaloMotion", "halo.enabled"), O("halo.hideBorder", "tokenHaloHideBorder", "halo.enabled"), O("halo.hideMarker", "tokenHaloHideMarker", "halo.turn")] }
  ] },
  /* GORE: blood and cracks on the screen (scripts/gore/): the table's too */
  { id: "gore", icon: "fa-solid fa-droplet", sections: [
    { id: "show", rows: [M("gore.blood", "goreBlood"), M("gore.cracks", "goreCracks"), M("gore.seats", "goreSeats"), M("gore.hold", "goreHold")] }
  ] },
  /* GMGOVERN: the fight's own surfaces (scripts/combat/, scripts/turn/, scripts/tactics/) */
  { id: "combat", icon: "fa-solid fa-hand-fist", sections: [
    { id: "banner", rows: [O("combat.banner", "combatBannerEnabled"), O("combat.bannerSize", "combatBannerSize", "combat.banner"), O("combat.bannerRounds", "combatBannerRounds", "combat.banner")] },
    { id: "bar", rows: [O("combat.bar", "combatBarEnabled"), O("combat.barSize", "combatBarSize", "combat.bar"), O("combat.barRes", "combatBarResources", "combat.bar")] },
    { id: "turn", rows: [O("combat.turnMessage", "turnMessage"), O("combat.turnSound", "turnSound", "combat.turnMessage"), O("combat.turnTray", "turnTray"), O("combat.turnConfirm", "turnConfirm"),
      O("combat.turnAskAll", "turnAskAll"), O("combat.turnGm", "turnGm"), O("combat.turnPlayersEnd", "turnPlayersEnd")] },
    { id: "tactics", rows: [O("combat.hints", "tacticsHints"), O("combat.summary", "tacticsSummary"), O("combat.volume", "tacticsSoundVolume"), O("combat.uiScale", "tacticsUiScale")] }
  ] },
  /* GMGOVERN: the panels at the screen's edges (scripts/challenges/, scripts/party/) */
  { id: "panels", icon: "fa-solid fa-table-columns", sections: [
    { id: "challenges", rows: [O("panels.challenges", "challengesEnabled"), O("panels.challengesScale", "challengesScale", "panels.challenges"), O("panels.challengesVisible", "challengesVisible", "panels.challenges"),
      O("panels.challengesCompact", "challengesCompact", "panels.challenges"), O("panels.challengesCamera", "challengesCamera")] },
    { id: "party", rows: [O("panels.partySize", "partySize"), O("panels.partyStyle", "partyStyle"), O("panels.partyPips", "partyPips")] }
  ] },
  /* GMGOVERN: typefaces, sheets, chat and the rest (scripts/fontoption.mjs, base/, chargen/, module.js, slash/, session/, hotpan-quiet.mjs, log/) */
  { id: "interface", icon: "fa-solid fa-font", sections: [
    { id: "fonts", rows: [O("interface.comicFont", "comicFont"), O("interface.captionFont", "captionFont")] },
    { id: "sheets", rows: [O("interface.headerButton", "baseHeaderButton"), O("interface.chargenButton", "chargenButton"), M("interface.inlineStunts", "inlineStunts"), M("interface.sheetBlood", "experimental")] },
    { id: "scene", rows: [O("interface.slashCalm", "slashCalm"), O("interface.hotpanQuiet", "hotpanQuiet")] },
    { id: "session", rows: [O("interface.sessionAutoOpen", "sessionAutoOpen"), O("interface.logRevealJournals", "logRevealJournals")] }
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
