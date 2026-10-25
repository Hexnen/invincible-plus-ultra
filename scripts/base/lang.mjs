/* Team & Base card strings (IPB.*), embedded like scripts/turn/lang.mjs: Foundry reads a module's language list only at server start, so t()
   reads these tables directly (no game.i18n merge). Flat keys, English underneath, Polish on top. Names of upgrades, tables and ranks stay English
   (they are book data). Messages from pure.mjs arrive as KEY + params and are shown with t(key, params). */
export const EN = {
  "IPB.Settings.ShowInJournal.Name": "Team cards: show in the Journal sidebar",
  "IPB.Settings.ShowInJournal.Hint": "Team & base cards are journal entries kept out of the Journal sidebar. Turn this on to see them there (this client only).",
  "IPB.Settings.HeaderButton.Name": "Team cards: button in the hero sheet header",
  "IPB.Settings.HeaderButton.Hint": "Show the Team & base button in the header of hero sheets (this client only).",
  "IPB.Settings.PlayersCreate.Name": "Team cards: players may ask for a new card",
  "IPB.Settings.PlayersCreate.Hint": "A player can create a team card for a hero they own; the request is carried out by the connected GM.",
  "IPB.Default.Name": "New team",
  "IPB.Err.noBook": "The core book module is not available, so this part of the card cannot read the book.",
  "IPB.Err.noPermission": "You do not have permission to do that on this team card.",
  "IPB.Err.tooBig": "The team card would become too large ({bytes} of {limit} bytes).",
  "IPB.Err.noGM": "No GM is connected, so this request cannot be carried out now.",
  "IPB.Err.notFound": "That team, upgrade, event, crate row, vehicle or hero could not be found.",
  "IPB.Err.invalid": "The change was refused because it would make the team card invalid.",
  "IPB.Err.prerequisite": "{name}: the team does not meet the prerequisite.",
  "IPB.Err.stackMax": "{name} is already at its limit ({count} of {max}).",
  "IPB.Err.full": "No more entries fit in this list (limit {cap}).",
  "IPB.Err.badInput": "That input is not valid.",
  "IPB.Err.blocked": "{name} cannot be bought: another upgrade is required first.",
  "IPB.Err.karma": "The karma could not be paid: the cost is {cost}.",
  "IPB.Err.badType": "That kind of item cannot go there.",
  "IPB.Err.relay": "The request to the GM failed or timed out.",
  "IPB.Err.upgradesFull": "The upgrade list is full ({count} of {cap}).",
  "IPB.Err.eventsFull": "The event history is full ({count} of {cap}).",
  "IPB.Err.crateFull": "The crate is full ({count} of {cap} rows).",
  "IPB.Err.vehiclesFull": "The vehicle list is full ({count} of {cap}).",
  "IPB.Err.trackersFull": "The tracker list is full ({count} of {cap}).",
  "IPB.Val.notObject": "The team data is not an object.",
  "IPB.Val.newerVersion": "The team data comes from a newer version of the module (v{v}) and is left as it is.",
  "IPB.Val.rank": "Unknown rank: {rank}.",
  "IPB.Val.nameEmpty": "The team has no name.",
  "IPB.Val.policy": "The edit or chat policy is not valid.",
  "IPB.Val.entry": "An entry is not an object.",
  "IPB.Val.upgradeStatus": "Unknown upgrade status: {status}.",
  "IPB.Val.upgradeCount": "An upgrade count must be a whole number of at least 1 (got {count}).",
  "IPB.Val.upgradeSource": "Unknown upgrade source: {source}.",
  "IPB.Val.startOverAllowance": "{used} starting upgrades are recorded, the rank allows {total}.",
  "IPB.Val.rollRange": "{roll} is not a D66 result.",
  "IPB.Val.bandUnknown": "The event band {band} is not one this module knows.",
  "IPB.Val.manyPrimaryVehicles": "{count} vehicles are marked as the team vehicle.",
  "IPB.Val.trackerOverMax": "A tracker is above its maximum ({value} of {max}).",
  "IPB.Up.preUnknown": "The prerequisite could not be read; the GM decides: {raw}",
  "IPB.Up.preResourcesMet": "Resources {n} is met by {who}.",
  "IPB.Up.preOccupationMet": "{occupation} is met by {who}.",
  "IPB.Up.preGroupUnmet": "Needs Resources {resources} or one of: {occupations}.",
  "IPB.Up.preUpgradeUnmet": "Needs the upgrade {name} first.",
  "IPB.Up.preUpgradeDisabled": "{name} is owned but currently disabled.",
  "IPB.Up.preUpgradeMet": "{name} is owned.",
  "IPB.Up.stackMax": "Already taken {count} of {max} times.",
  "IPB.Karma.badAmount": "The karma amount for a hero is not valid.",
  "IPB.Karma.unknownHero": "A hero in the split is not a member of the team.",
  "IPB.Karma.overKarma": "A hero is asked for more karma than they have ({karma}).",
  "IPB.Karma.poolMismatch": "The split adds up to {total}, the cost is {cost}.",
  "IPB.Chat.Title": "Base event: {team}",
  "IPB.Chat.Roll": "Result {roll}",
  "IPB.Chat.Open": "Open team card"
};

export const PL = {
  "IPB.Settings.ShowInJournal.Name": "Karty drużyn: pokaż w panelu Dzienników",
  "IPB.Settings.ShowInJournal.Hint": "Karty drużyny i bazy to wpisy dziennika ukryte w panelu Dzienników. Włącz, aby widzieć je tam (tylko ten klient).",
  "IPB.Settings.HeaderButton.Name": "Karty drużyn: przycisk w nagłówku karty bohatera",
  "IPB.Settings.HeaderButton.Hint": "Pokaż przycisk Drużyna i baza w nagłówku kart bohaterów (tylko ten klient).",
  "IPB.Settings.PlayersCreate.Name": "Karty drużyn: gracze mogą poprosić o nową kartę",
  "IPB.Settings.PlayersCreate.Hint": "Gracz może utworzyć kartę drużyny dla swojego bohatera; prośbę wykonuje połączony MG.",
  "IPB.Default.Name": "Nowa drużyna",
  "IPB.Err.noBook": "Moduł z podręcznikiem nie jest dostępny, więc ta część karty nie może czytać podręcznika.",
  "IPB.Err.noPermission": "Nie masz uprawnień do tej czynności na karcie drużyny.",
  "IPB.Err.tooBig": "Karta drużyny stałaby się zbyt duża ({bytes} z {limit} bajtów).",
  "IPB.Err.noGM": "Żaden MG nie jest połączony, więc tej prośby nie da się teraz wykonać.",
  "IPB.Err.notFound": "Nie znaleziono drużyny, ulepszenia, zdarzenia, wiersza skrzyni, pojazdu ani bohatera.",
  "IPB.Err.invalid": "Zmiana została odrzucona, bo uszkodziłaby kartę drużyny.",
  "IPB.Err.prerequisite": "{name}: drużyna nie spełnia wymagań wstępnych.",
  "IPB.Err.stackMax": "{name} osiągnęło już limit ({count} z {max}).",
  "IPB.Err.full": "Na tej liście nie zmieści się więcej wpisów (limit {cap}).",
  "IPB.Err.badInput": "Te dane są nieprawidłowe.",
  "IPB.Err.blocked": "Nie można kupić: {name}. Najpierw potrzebne jest inne ulepszenie.",
  "IPB.Err.karma": "Nie udało się zapłacić karmą: koszt to {cost}.",
  "IPB.Err.badType": "Ten rodzaj przedmiotu nie może tam trafić.",
  "IPB.Err.relay": "Prośba do MG nie powiodła się lub trwała zbyt długo.",
  "IPB.Err.upgradesFull": "Lista ulepszeń jest pełna ({count} z {cap}).",
  "IPB.Err.eventsFull": "Historia zdarzeń jest pełna ({count} z {cap}).",
  "IPB.Err.crateFull": "Skrzynia jest pełna ({count} z {cap} wierszy).",
  "IPB.Err.vehiclesFull": "Lista pojazdów jest pełna ({count} z {cap}).",
  "IPB.Err.trackersFull": "Lista liczników jest pełna ({count} z {cap}).",
  "IPB.Val.notObject": "Dane drużyny nie są obiektem.",
  "IPB.Val.newerVersion": "Dane drużyny pochodzą z nowszej wersji modułu (v{v}) i zostają bez zmian.",
  "IPB.Val.rank": "Nieznana ranga: {rank}.",
  "IPB.Val.nameEmpty": "Drużyna nie ma nazwy.",
  "IPB.Val.policy": "Zasady edycji lub czatu są nieprawidłowe.",
  "IPB.Val.entry": "Wpis nie jest obiektem.",
  "IPB.Val.upgradeStatus": "Nieznany stan ulepszenia: {status}.",
  "IPB.Val.upgradeCount": "Liczba ulepszeń musi być liczbą całkowitą co najmniej 1 (jest {count}).",
  "IPB.Val.upgradeSource": "Nieznane źródło ulepszenia: {source}.",
  "IPB.Val.startOverAllowance": "Zapisano {used} ulepszeń startowych, ranga pozwala na {total}.",
  "IPB.Val.rollRange": "{roll} nie jest wynikiem K66.",
  "IPB.Val.bandUnknown": "Przedział zdarzeń {band} nie jest znany temu modułowi.",
  "IPB.Val.manyPrimaryVehicles": "Wiele pojazdów ({count}) jest oznaczonych jako pojazd drużyny.",
  "IPB.Val.trackerOverMax": "Licznik przekracza maksimum ({value} z {max}).",
  "IPB.Up.preUnknown": "Nie udało się odczytać wymagań; decyduje MG: {raw}",
  "IPB.Up.preResourcesMet": "Zasoby {n} spełnia: {who}.",
  "IPB.Up.preOccupationMet": "{occupation} spełnia: {who}.",
  "IPB.Up.preGroupUnmet": "Wymaga Zasobów {resources} albo jednego z zawodów: {occupations}.",
  "IPB.Up.preUpgradeUnmet": "Najpierw potrzebne jest ulepszenie {name}.",
  "IPB.Up.preUpgradeDisabled": "{name} jest posiadane, ale chwilowo wyłączone.",
  "IPB.Up.preUpgradeMet": "{name} jest posiadane.",
  "IPB.Up.stackMax": "Wzięte już {count} z {max} razy.",
  "IPB.Karma.badAmount": "Ilość karmy dla bohatera jest nieprawidłowa.",
  "IPB.Karma.unknownHero": "Bohater z podziału nie należy do drużyny.",
  "IPB.Karma.overKarma": "Od bohatera żądane jest więcej karmy, niż ma ({karma}).",
  "IPB.Karma.poolMismatch": "Podział daje {total}, koszt to {cost}.",
  "IPB.Chat.Title": "Zdarzenie w bazie: {team}",
  "IPB.Chat.Roll": "Wynik {roll}",
  "IPB.Chat.Open": "Otwórz kartę drużyny"
};

const fill = (s, data) => String(s).replace(/\{(\w+)\}/g, (_m, k) => (data?.[k] ?? `{${k}}`));
const lang = () => { try { return globalThis.game?.i18n?.lang ?? "en"; } catch { return "en"; } };

/** t("IPB.Err.noBook") or t("IPB.Err.stackMax", {name, count, max}). Falls back to English, then to the key. */
export function t(key, data) {
  const table = lang().startsWith("pl") ? PL : EN;
  return fill(table[key] ?? EN[key] ?? key, data);
}
/** Plural-aware: tn("IPB.X", 3, data) picks KEY.one / KEY.few / KEY.many (Polish) or KEY.one / KEY.other (English) when they exist, else KEY. */
export function tn(key, n, data = {}) {
  const pl = lang().startsWith("pl");
  const mod10 = n % 10, mod100 = n % 100;
  const form = pl ? (n === 1 ? "one" : mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14) ? "few" : "many") : (n === 1 ? "one" : "other");
  const table = pl ? PL : EN;
  const k = `${key}.${form}` in table ? `${key}.${form}` : key;
  return t(k, { n, ...data });
}
