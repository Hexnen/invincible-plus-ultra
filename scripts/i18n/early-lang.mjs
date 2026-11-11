/* The client's language, known BEFORE Foundry applies it.
   Foundry calls the init hook first and only then reads the client's language (Game#initialize: callAll("init"), registerSettings(),
   i18n.initialize()). During init game.i18n.lang is still the SERVER's default ("en"). Every area of this module names its settings in an
   init hook through its own lang table (t(key) picks the table by game.i18n.lang), so on a Polish client all those names and hints came
   out English and stayed English (found live: "Turn: your-turn message", "Token halo: enabled", ... in the Polish settings window).
   The language a client chose is a client setting, stored in the browser as localStorage["core.language"] (a JSON string). This file reads
   it and, when it is one of OUR languages, puts it on game.i18n.lang at the very start of init. Foundry sets the same value itself a moment
   later (Localization#initialize -> setLanguage), so nothing else changes; an unknown or missing value is left alone.
   scripts/module.js imports this file FIRST, so its init hook runs before every other hook of the module.
   Pure helpers are exported for scripts/i18n/check-glossary.mjs. */
const OURS = ["pl"];

/** The language this browser chose for Foundry, or null (nothing stored, unreadable storage, not a string). */
export function clientLanguage(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.("core.language");
    if (!raw) return null;
    const v = JSON.parse(raw);
    return typeof v === "string" && v ? v : null;
  } catch { return null; }
}
/** Put the client's language on game.i18n.lang when Foundry has not done so yet. Returns the language applied, or null. */
export function applyEarly(i18n = globalThis.game?.i18n, storage = globalThis.localStorage) {
  try {
    const lang = clientLanguage(storage);
    if (!i18n || !lang || !OURS.includes(lang) || i18n.lang === lang) return null;
    i18n.lang = lang;
    return lang;
  } catch { return null; }
}
try { if (globalThis.Hooks) { applyEarly(); Hooks.once("init", () => applyEarly()); } } catch { /* the names stay English until the next render, nothing breaks */ }
