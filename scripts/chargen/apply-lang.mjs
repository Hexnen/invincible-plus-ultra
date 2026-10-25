/* Strings of the chargen apply layer (IPCA.*), embedded EN + PL. Parity check: node scripts/chargen/apply-check-lang.mjs */
export const EN = {
  "IPCA.Err.Invalid": "The hero is not valid yet ({count} problem(s) to fix first). Nothing was changed.",
  "IPCA.Err.NotOwner": "You do not have permission to change {actor}. Nothing was changed.",
  "IPCA.Err.WrongType": "{actor} is not a superhero. Nothing was changed.",
  "IPCA.Err.NoPacks": "The core book content (module invincible-core) is missing or unreadable: {missing}. Nothing was changed.",
  "IPCA.Err.NeedConfirm": "This replaces {count} existing item(s) of {actor}. Confirm the replacement explicitly. Nothing was changed.",
  "IPCA.Err.Unresolved": "{kind} \"{name}\" was not found in the core book content. Nothing was changed.",
  "IPCA.Err.Failed": "Applying the hero failed at \"{stage}\": {error}. Everything written in this run was rolled back.",
  "IPCA.Err.RollbackFailed": "Applying the hero failed at \"{stage}\": {error}. Rolling back ALSO failed ({rollback}). Check {actor} manually; the previous data is kept in the undo backup.",
  "IPCA.Err.NoUndo": "There is nothing to undo for {actor}.",
  "IPCA.Err.UndoFailed": "Undo failed: {error}.",
  "IPCA.Warn.CustomSource": "Power source \"{name}\" is not in the core book content; a custom power source is created.",
  "IPCA.Warn.NoBackupFlag": "The previous data is too large to store on the hero; undo works only until this window or session is closed.",
  "IPCA.Warn.KeepsItems": "{count} other item(s) (gear, injuries and so on) stay untouched.",
  "IPCA.Warn.HardTimes": "Hard Times: the book text says -2 Resources, the pack effect applies -1; the effect decides what the sheet shows.",
  "IPCA.Done.Apply": "{actor}: {created} item(s) created, {deleted} removed, {fields} field(s) changed.",
  "IPCA.Done.Undo": "{actor}: the previous version was restored."
};

export const PL = {
  "IPCA.Err.Invalid": "Bohater nie jest jeszcze poprawny (najpierw do poprawienia: {count}). Nic nie zostało zmienione.",
  "IPCA.Err.NotOwner": "Nie masz uprawnień do zmiany postaci {actor}. Nic nie zostało zmienione.",
  "IPCA.Err.WrongType": "{actor} nie jest superbohaterem. Nic nie zostało zmienione.",
  "IPCA.Err.NoPacks": "Brakuje treści podręcznika (moduł invincible-core) lub nie można jej odczytać: {missing}. Nic nie zostało zmienione.",
  "IPCA.Err.NeedConfirm": "To zastąpi istniejące przedmioty postaci {actor} (liczba: {count}). Potwierdź zastąpienie wprost. Nic nie zostało zmienione.",
  "IPCA.Err.Unresolved": "{kind} \"{name}\" nie został znaleziony w treści podręcznika. Nic nie zostało zmienione.",
  "IPCA.Err.Failed": "Zastosowanie bohatera nie powiodło się na etapie \"{stage}\": {error}. Wszystko, co zapisano w tym przebiegu, zostało cofnięte.",
  "IPCA.Err.RollbackFailed": "Zastosowanie bohatera nie powiodło się na etapie \"{stage}\": {error}. Cofnięcie TEŻ się nie powiodło ({rollback}). Sprawdź postać {actor} ręcznie; poprzednie dane są w kopii do cofnięcia.",
  "IPCA.Err.NoUndo": "Dla postaci {actor} nie ma czego cofać.",
  "IPCA.Err.UndoFailed": "Cofnięcie nie powiodło się: {error}.",
  "IPCA.Warn.CustomSource": "Źródło mocy \"{name}\" nie istnieje w treści podręcznika; powstanie własne źródło mocy.",
  "IPCA.Warn.NoBackupFlag": "Poprzednie dane są za duże, by zapisać je na postaci; cofanie działa tylko do zamknięcia tego okna lub sesji.",
  "IPCA.Warn.KeepsItems": "Pozostałe przedmioty (liczba: {count}; ekwipunek, rany itd.) zostają nietknięte.",
  "IPCA.Warn.HardTimes": "Ciężkie czasy: tekst podręcznika mówi o -2 Zasobów, efekt w paczce daje -1; to efekt decyduje o tym, co pokaże karta.",
  "IPCA.Done.Apply": "{actor}: utworzono przedmiotów: {created}, usunięto: {deleted}, zmieniono pól: {fields}.",
  "IPCA.Done.Undo": "{actor}: przywrócono poprzednią wersję."
};

let cache = { lang: null, dict: EN };
export function t(key, data) {
  const lang = globalThis.game?.i18n?.lang ?? "en";
  if (cache.lang !== lang) cache = { lang, dict: lang.startsWith("pl") ? { ...EN, ...PL } : EN };
  let s = cache.dict[key] ?? EN[key] ?? key;
  if (data) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in data ? String(data[k]) : m));
  return s;
}
