/* One-time copy of the standalone "Invincible: Comic Splash" settings into this module's own splash settings.
   Old values are only READ (never deleted or changed), so the standalone module keeps working if it is re-enabled.
   Storage formats (Foundry v14, client/helpers/client-settings.mjs + documents/setting.mjs):
   - client scope: window.localStorage, key "<namespace>.<key>", value = JSON.stringify(value)
   - world scope : Setting documents in game.settings.storage.get('world'), key "<namespace>.<key>"; the stored value is a JSON
                   string that the JSONField parses on load, and an unregistered key (standalone disabled) is left parsed, uncast.
   Runs once per client (hidden client setting splashMigrated) and once per world (hidden world setting splashMigratedWorld, GM only).
   It runs only when the merged splash starts, i.e. when the standalone module is NOT active (see start() in main.mjs). */
const OLD = 'invincible-splash';
const CLIENT_KEYS = ['enabled', 'others', 'placement', 'scale', 'hold', 'effects', 'motion', 'fullscreen', 'fullFrom', 'debug', 'chat'];
const WORLD_KEYS = ['dry', 'k0', 'state'];

/* Hidden bookkeeping settings; called from registerSettings() in main.mjs, after the visible ones. */
export function registerMigrationSettings(MOD) {
  const reg = (key, scope) => {
    if (game.settings.settings.has(`${MOD}.${key}`)) return;
    game.settings.register(MOD, key, { scope, config: false, type: Boolean, default: false });
  };
  reg('splashMigrated', 'client');
  reg('splashMigratedWorld', 'world');
}

/* Coerce an old value into what the registered setting accepts; undefined = reject (keep the new default). */
export function coerce(cfg, v) {
  if (v === null || v === undefined) return undefined;
  if (cfg.type === Boolean) return typeof v === 'boolean' ? v : undefined;
  if (cfg.type === Number) {
    const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
    if (!Number.isFinite(n)) return undefined;
    const r = cfg.range;
    return r ? Math.min(r.max, Math.max(r.min, n)) : n;
  }
  if (cfg.type === String) {
    if (typeof v !== 'string') return undefined;
    return cfg.choices && !Object.hasOwn(cfg.choices, v) ? undefined : v;
  }
  return undefined;
}

function readClient(key) {
  const raw = window.localStorage?.getItem(`${OLD}.${key}`);
  if (raw === null || raw === undefined) return undefined;
  try { return JSON.parse(raw); } catch (e) { return raw; }   // tolerate a bare, non-JSON string
}

function readWorld(key) {
  const doc = game.settings.storage?.get('world')?.getSetting?.(`${OLD}.${key}`, null);
  if (!doc) return undefined;
  return doc.value;   // already parsed by the JSONField; coerce() handles numeric strings
}

/* sk: working key -> module key ('enabled' -> 'splashEnabled'). Never throws. */
export async function migrateSettings(MOD, sk, log) {
  const copied = [];
  const pending = [];
  const copy = (key, read) => {
    try {
      const nk = sk(key);
      const cfg = game.settings.settings.get(`${MOD}.${nk}`);
      if (!cfg) return;
      const old = coerce(cfg, read(key));
      if (old === undefined) return;
      if (game.settings.get(MOD, nk) !== cfg.default) return;   // the user already set a non-default value here: keep it
      if (old === cfg.default) return;
      pending.push(game.settings.set(MOD, nk, old).then(() => copied.push(nk)).catch(e => console.warn(`${log} migrate ${nk} failed`, e)));
    } catch (e) { console.warn(`${log} migrate ${key} failed`, e); }
  };

  try {
    if (!game.settings.get(MOD, 'splashMigrated')) {
      for (const k of CLIENT_KEYS) copy(k, readClient);
      await Promise.all(pending.splice(0));
      await game.settings.set(MOD, 'splashMigrated', true);
    }
  } catch (e) { console.warn(`${log} client settings migration failed`, e); }

  try {
    if (game.user?.isGM && !game.settings.get(MOD, 'splashMigratedWorld')) {
      for (const k of WORLD_KEYS) copy(k, readWorld);
      await Promise.all(pending.splice(0));
      await game.settings.set(MOD, 'splashMigratedWorld', true);
    }
  } catch (e) { console.warn(`${log} world settings migration failed`, e); }

  if (copied.length) console.info(`${log} migrated settings from "${OLD}": ${copied.join(', ')}`);
}
