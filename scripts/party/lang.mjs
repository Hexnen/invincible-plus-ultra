/* Party cards strings (IPT.*), embedded because Foundry reads a module's language list only when the server starts.
   t() reads these tables directly (no game.i18n merge), the same approach as the Challenges HUD and the combat bar. Flat keys, English
   underneath, Polish on top. Setting names carry a "Party: " / "Drużyna: " prefix because they share the Plus Ultra settings list.
   Parity check: node scripts/party/check-lang.mjs */
export const EN = {
  "IPT.Settings.Display.Name": "Party: display",
  "IPT.Settings.Display.Hint": "The character cards at the bottom left (player characters that have a token on the scene you are viewing). Hidden: only a small tab. Peek: only the portraits stick out, hover one to slide its card all the way out. Full: every card is out. This client only.",
  "IPT.Settings.Display.hidden": "Hidden",
  "IPT.Settings.Display.peek": "Peek (portraits only)",
  "IPT.Settings.Display.full": "Full",
  "IPT.Settings.Pips.Name": "Party: show action pips",
  "IPT.Settings.Pips.Hint": "Show which fast / slow actions each character has used this round while a combat is running (needs Year Zero Engine: Combat). This client only.",
  "IPT.Settings.Size.Name": "Party: size",
  "IPT.Settings.Size.Hint": "How big the party cards are. This client only.",
  "IPT.Settings.Size.small": "Small",
  "IPT.Settings.Size.normal": "Normal",
  "IPT.Settings.Size.large": "Large",
  "IPT.Settings.Style.Name": "Party: card style",
  "IPT.Settings.Style.Hint": "Classic: the original cards. New: the overhaul (bigger Health, condition icons, a Health / Resolve meter on the portrait edge that stays visible in the portraits-only view). Applies at once. This client only.",
  "IPT.Settings.Style.classic": "Classic",
  "IPT.Settings.Style.new": "New",
  "IPT.Settings.Players.Name": "Party: show to players",
  "IPT.Settings.Players.Hint": "GM only. When off, players do not get the party cards (the GM still sees them).",
  "IPT.Region": "Party",
  "IPT.Handle.Label": "Party",
  "IPT.Handle.Aria": "Party cards: {state}. Press to change to {next}.",
  "IPT.State.hidden": "hidden",
  "IPT.State.peek": "portraits only",
  "IPT.State.full": "full",
  "IPT.Player": "Player {name}",
  "IPT.Health": "Health",
  "IPT.Resolve": "Resolve",
  "IPT.Of": "{label} {value} of {max}",
  "IPT.Low": "low",
  "IPT.Defeated": "Defeated",
  "IPT.Turn": "Active turn",
  "IPT.Effects": "{n} active effects",
  "IPT.Tokens": "{n} tokens on the scene, click again for the next one",
  "IPT.Pip.fast": "Fast action",
  "IPT.Pip.slow": "Slow action",
  "IPT.Pip.one": "Action",
  "IPT.Pip.used": "used",
  "IPT.Pip.open": "available",
  "IPT.Pip.past": "not tracked",
  "IPT.Slot": "action {n} of {m}",
  "IPT.Hint": "Enter selects the token, Shift+Enter opens the sheet, Space pins the card open.",
  "IPT.Live.Appeared": "{name} joined the party cards",
  "IPT.Live.Gone": "{name} left the party cards"
};

export const PL = {
  "IPT.Settings.Display.Name": "Drużyna: wyświetlanie",
  "IPT.Settings.Display.Hint": "Karty postaci w lewym dolnym rogu (postacie graczy, które mają token na oglądanej scenie). Ukryte: tylko mała zakładka. Wyglądanie: wystają same portrety, najedź na jeden, by wysunąć jego kartę do końca. Pełne: wszystkie karty wysunięte. Tylko ten klient.",
  "IPT.Settings.Display.hidden": "Ukryte",
  "IPT.Settings.Display.peek": "Wyglądanie (same portrety)",
  "IPT.Settings.Display.full": "Pełne",
  "IPT.Settings.Pips.Name": "Drużyna: znaczniki akcji",
  "IPT.Settings.Pips.Hint": "Pokazuje, które szybkie / wolne akcje każda postać zużyła w tej rundzie, gdy trwa walka (wymaga Year Zero Engine: Combat). Tylko ten klient.",
  "IPT.Settings.Size.Name": "Drużyna: rozmiar",
  "IPT.Settings.Size.Hint": "Jak duże są karty drużyny. Tylko ten klient.",
  "IPT.Settings.Size.small": "Mały",
  "IPT.Settings.Size.normal": "Normalny",
  "IPT.Settings.Size.large": "Duży",
  "IPT.Settings.Style.Name": "Drużyna: styl kart",
  "IPT.Settings.Style.Hint": "Klasyczny: dotychczasowe karty. Nowy: przebudowa (większe Health, ikony stanów, miernik Health / Resolve na krawędzi portretu, widoczny też w widoku samych portretów). Działa od razu. Tylko ten klient.",
  "IPT.Settings.Style.classic": "Klasyczny",
  "IPT.Settings.Style.new": "Nowy",
  "IPT.Settings.Players.Name": "Drużyna: pokaż graczom",
  "IPT.Settings.Players.Hint": "Tylko MG. Po wyłączeniu gracze nie dostają kart drużyny (MG nadal je widzi).",
  "IPT.Region": "Drużyna",
  "IPT.Handle.Label": "Drużyna",
  "IPT.Handle.Aria": "Karty drużyny: {state}. Naciśnij, aby zmienić na: {next}.",
  "IPT.State.hidden": "ukryte",
  "IPT.State.peek": "same portrety",
  "IPT.State.full": "pełne",
  "IPT.Player": "Gracz {name}",
  "IPT.Health": "Health",
  "IPT.Resolve": "Resolve",
  "IPT.Of": "{label} {value} z {max}",
  "IPT.Low": "niskie",
  "IPT.Defeated": "Pokonany",
  "IPT.Turn": "Aktywna tura",
  "IPT.Effects": "Aktywne efekty: {n}",
  "IPT.Tokens": "Tokenów na scenie: {n}, kliknij ponownie po następny",
  "IPT.Pip.fast": "Szybka akcja",
  "IPT.Pip.slow": "Wolna akcja",
  "IPT.Pip.one": "Akcja",
  "IPT.Pip.used": "użyta",
  "IPT.Pip.open": "dostępna",
  "IPT.Pip.past": "bez śledzenia",
  "IPT.Slot": "akcja {n} z {m}",
  "IPT.Hint": "Enter zaznacza token, Shift+Enter otwiera kartę, Spacja przypina kartę.",
  "IPT.Live.Appeared": "{name} dołącza do kart drużyny",
  "IPT.Live.Gone": "{name} znika z kart drużyny"
};

/* Local resolver. Language: game.i18n.lang, PL on top of EN. A missing key shows the key (never throws). */
let cacheLang = null, cache = EN;
export function t(key, data) {
  const lang = globalThis.game?.i18n?.lang ?? "en";
  if (lang !== cacheLang) { cacheLang = lang; cache = lang === "pl" ? { ...EN, ...PL } : EN; }
  const s = cache[key] ?? key;
  return data ? s.replace(/\{(\w+)\}/g, (m, k) => (data[k] === undefined ? m : String(data[k]))) : s;
}
