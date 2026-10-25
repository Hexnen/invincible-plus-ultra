/* One-time copy of this module's settings from its OLD id ("invincible-sheet-plus", the module was called Invincible - Sheet Plus) to the
   current id. Old values are only READ (never deleted or changed). Storage formats are the same as in splash/migrate.mjs:
   - client scope: window.localStorage "<namespace>.<key>", value = JSON.stringify(value)
   - world scope : Setting documents in game.settings.storage.get('world'), key "<namespace>.<key>", value already parsed
   A value is copied only when the new key still holds its default and the old value differs from it. Hidden flags make it run once per client
   (migratedFromSheetPlus) and once per world (migratedFromSheetPlusWorld, GM only); a flag stays unset while some key is not registered yet.
   Message flags are NOT migrated here: module.js reads flags['invincible-plus-ultra'] first and falls back to the old namespace.
   Order: this runs BEFORE the splash's copy of the standalone "invincible-splash" values (splash/main.mjs awaits it), whose copy skips
   every key that already holds a non-default value; so the (newer) Sheet Plus values win over the standalone ones. */
import { coerce } from './splash/migrate.mjs';

const OLD = 'invincible-sheet-plus';
const MOD = 'invincible-plus-ultra';
const LOG = `${MOD} |`;
export const CLIENT_KEYS = ['experimental', 'inlineStunts',
  'splashEnabled', 'splashOthers', 'splashPlacement', 'splashScale', 'splashHold', 'splashEffects', 'splashMotion', 'splashFullscreen', 'splashFullFrom', 'splashDebug', 'splashChat',
  'challengesEnabled', 'challengesScale', 'challengesCamera', 'challengesCollapsed', 'splashMigrated'];
export const WORLD_KEYS = ['splashDry', 'splashK0', 'splashState', 'splashMigratedWorld'];

const readClient = (key) => {
  const raw = window.localStorage?.getItem(`${OLD}.${key}`);
  if (raw === null || raw === undefined) return undefined;
  try { return JSON.parse(raw); } catch (e) { return raw; }
};
const readWorld = (key) => game.settings.storage?.get('world')?.getSetting?.(`${OLD}.${key}`, null)?.value;

let running = null;
/* Idempotent and shared: module.js (ready) and splash/main.mjs (before its own migration) both call it. Never throws. */
export function migrateFromSheetPlus() {
  return running ??= run().catch((e) => console.warn(`${LOG} settings migration from "${OLD}" failed`, e));
}

async function run() {
  const copied = [];
  const pending = [];
  let complete = true;
  const copy = (key, read) => {
    try {
      const cfg = game.settings.settings.get(`${MOD}.${key}`);
      if (!cfg) { complete = false; return; }
      const old = coerce(cfg, read(key));
      if (old === undefined || old === cfg.default) return;
      if (game.settings.get(MOD, key) !== cfg.default) return;
      pending.push(game.settings.set(MOD, key, old).then(() => copied.push(key)).catch((e) => console.warn(`${LOG} migrate ${key} failed`, e)));
    } catch (e) { console.warn(`${LOG} migrate ${key} failed`, e); }
  };
  const done = (flag) => { try { return game.settings.get(MOD, flag); } catch (e) { return true; } };

  try {
    if (game.settings.settings.has(`${MOD}.migratedFromSheetPlus`) && !done('migratedFromSheetPlus')) {
      complete = true;
      for (const k of CLIENT_KEYS) copy(k, readClient);
      await Promise.all(pending.splice(0));
      if (complete) await game.settings.set(MOD, 'migratedFromSheetPlus', true);
    }
  } catch (e) { console.warn(`${LOG} client settings migration failed`, e); }

  try {
    if (game.user?.isGM && game.settings.settings.has(`${MOD}.migratedFromSheetPlusWorld`) && !done('migratedFromSheetPlusWorld')) {
      complete = true;
      for (const k of WORLD_KEYS) copy(k, readWorld);
      await Promise.all(pending.splice(0));
      if (complete) await game.settings.set(MOD, 'migratedFromSheetPlusWorld', true);
    }
  } catch (e) { console.warn(`${LOG} world settings migration failed`, e); }

  if (copied.length) console.info(`${LOG} migrated settings from "${OLD}": ${copied.join(', ')}`);
}
