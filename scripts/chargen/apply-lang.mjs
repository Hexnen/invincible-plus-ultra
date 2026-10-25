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
  "IPCA.Done.Undo": "{actor}: the previous version was restored.",
  /* phase 5f: team base integration */
  "IPCA.Err.NoBase": "The team base feature is not available, so the hero cannot be tied to a base. Choose \"Text only\" in the Team step. Nothing was changed.",
  "IPCA.Err.BaseNoCreate": "You cannot create a team base here (only the GM can, unless the GM allows players to). Join an existing base or choose \"Text only\". Nothing was changed.",
  "IPCA.Err.BaseGone": "The team base you chose no longer exists or you can no longer see it. Choose another in the Team step. Nothing was changed.",
  "IPCA.Warn.BaseMember": "This hero already belongs to the team base \"{team}\": the Team and Team base texts stay as the base card writes them.",
  "IPCA.Warn.BaseWillCreate": "A new team base \"{team}\" will be created with this hero as its first member. It is a separate actor in the Actors directory.",
  "IPCA.Warn.BaseWillJoin": "This hero will join the team base \"{team}\"; the hero sheet then shows the card's team and base texts.",
  "IPCA.Warn.BaseCreated": "Team base \"{team}\" was created and the hero is its first member.",
  "IPCA.Warn.BaseJoined": "The hero joined the team base \"{team}\".",
  "IPCA.Warn.BaseNoEdit": "You cannot edit the team base \"{team}\" yet, so its kind, location and starting upgrades were not written. Add them on the base sheet.",
  "IPCA.Warn.BaseField": "The kind and location of \"{team}\" could not be written: {error}.",
  "IPCA.Warn.BaseUpgrade": "The starting upgrade \"{name}\" could not be added: {error}.",
  "IPCA.Warn.BaseKept": "The team base \"{team}\" was left in place (other heroes belong to it, or only the GM may delete it); the hero left it."
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
  "IPCA.Done.Undo": "{actor}: przywrócono poprzednią wersję.",
  /* phase 5f: team base integration */
  "IPCA.Err.NoBase": "Funkcja bazy drużyny jest niedostępna, więc nie da się powiązać bohatera z bazą. W kroku Drużyna wybierz „Tylko tekst”. Nic nie zostało zmienione.",
  "IPCA.Err.BaseNoCreate": "Nie możesz tu utworzyć bazy drużyny (może to tylko MG, chyba że pozwoli na to graczom). Dołącz do istniejącej bazy albo wybierz „Tylko tekst”. Nic nie zostało zmienione.",
  "IPCA.Err.BaseGone": "Wybrana baza drużyny już nie istnieje albo już jej nie widzisz. Wybierz inną w kroku Drużyna. Nic nie zostało zmienione.",
  "IPCA.Warn.BaseMember": "Ten bohater należy już do bazy drużyny „{team}”: teksty Drużyna i Baza drużyny zostają takie, jak zapisuje je karta bazy.",
  "IPCA.Warn.BaseWillCreate": "Powstanie nowa baza drużyny „{team}”, a ten bohater będzie jej pierwszym członkiem. To osobny aktor w katalogu Aktorzy.",
  "IPCA.Warn.BaseWillJoin": "Ten bohater dołączy do bazy drużyny „{team}”; karta bohatera pokaże wtedy teksty drużyny i bazy z karty bazy.",
  "IPCA.Warn.BaseCreated": "Baza drużyny „{team}” została utworzona, a bohater jest jej pierwszym członkiem.",
  "IPCA.Warn.BaseJoined": "Bohater dołączył do bazy drużyny „{team}”.",
  "IPCA.Warn.BaseNoEdit": "Nie możesz jeszcze edytować bazy drużyny „{team}”, więc jej rodzaj, położenie i startowe ulepszenia nie zostały zapisane. Dodaj je na karcie bazy.",
  "IPCA.Warn.BaseField": "Nie udało się zapisać rodzaju i położenia bazy „{team}”: {error}.",
  "IPCA.Warn.BaseUpgrade": "Nie udało się dodać startowego ulepszenia „{name}”: {error}.",
  "IPCA.Warn.BaseKept": "Baza drużyny „{team}” została na miejscu (należą do niej inni bohaterowie albo tylko MG może ją usunąć); bohater ją opuścił."
};

let cache = { lang: null, dict: EN };
export function t(key, data) {
  const lang = globalThis.game?.i18n?.lang ?? "en";
  if (cache.lang !== lang) cache = { lang, dict: lang.startsWith("pl") ? { ...EN, ...PL } : EN };
  let s = cache.dict[key] ?? EN[key] ?? key;
  if (data) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in data ? String(data[k]) : m));
  return s;
}
