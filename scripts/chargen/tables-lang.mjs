/* Strings of the chargen tables builder (IPCT.*), embedded (Foundry reads a module's language list only at server start).
   Separate from the wizard's own lang.mjs on purpose (other phases create that one). Parity check: node scripts/chargen/tables-check-lang.mjs */
export const EN = {
  "IPCT.Folder.Archetype": "By archetype",
  "IPCT.Folder.Occupation": "By occupation",
  "IPCT.Folder.TeamBase": "Team base by rank",
  "IPCT.Err.NoPack": "The compendium Plus Ultra: Character creation does not exist yet. Restart Foundry once so it picks up the module update, then run build() again.",
  "IPCT.Err.NotGM": "Only the Game Master can build the character creation tables.",
  "IPCT.Err.NoBook": "The core book (module invincible-core, compendium core-book) is not installed or not active in this world.",
  "IPCT.Err.Structure": "The core book does not have the structure the tables builder expects. Nothing was changed. Details: {details}",
  "IPCT.Done.Build": "Character creation tables: {created} created, {updated} updated, {unchanged} unchanged, {skipped} kept because you edited them.",
  "IPCT.Done.Remove": "Character creation tables removed: {removed} tables, {kept} kept because you edited them.",
  "IPCT.Warn.Count": "{list}: expected {expected} entries, the book has {found}."
};

export const PL = {
  "IPCT.Folder.Archetype": "Wg archetypu",
  "IPCT.Folder.Occupation": "Wg zawodu",
  "IPCT.Folder.TeamBase": "Baza drużyny wg rangi",
  "IPCT.Err.NoPack": "Kompendium Plus Ultra: Tworzenie postaci jeszcze nie istnieje. Uruchom Foundry ponownie, aby wczytał aktualizację modułu, a potem wywołaj build() jeszcze raz.",
  "IPCT.Err.NotGM": "Tylko Mistrz Gry może zbudować tabele tworzenia postaci.",
  "IPCT.Err.NoBook": "Podręcznik (moduł invincible-core, paczka core-book) nie jest zainstalowany lub aktywny w tym świecie.",
  "IPCT.Err.Structure": "Podręcznik nie ma struktury, jakiej oczekuje budowniczy tabel. Nic nie zostało zmienione. Szczegóły: {details}",
  "IPCT.Done.Build": "Tabele tworzenia postaci: {created} utworzonych, {updated} zaktualizowanych, {unchanged} bez zmian, {skipped} zachowanych, bo je edytowałeś.",
  "IPCT.Done.Remove": "Tabele tworzenia postaci usunięte: {removed} tabel, {kept} zachowanych, bo je edytowałeś.",
  "IPCT.Warn.Count": "{list}: oczekiwano {expected} pozycji, w podręczniku jest {found}."
};

let cache = { lang: null, dict: EN };
export function t(key, data) {
  const lang = globalThis.game?.i18n?.lang ?? "en";
  if (cache.lang !== lang) cache = { lang, dict: lang.startsWith("pl") ? { ...EN, ...PL } : EN };
  let s = cache.dict[key] ?? EN[key] ?? key;
  if (data) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in data ? String(data[k]) : m));
  return s;
}
