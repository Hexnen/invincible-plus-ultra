/* Challenges HUD strings (INCH.*), embedded because Foundry reads a module's language list only when the server starts.
   main.mjs merges them into game.i18n.translations at runtime (the same approach as scripts/splash/lang.mjs), so settings names and
   game.i18n.localize / format work as usual. Setting names carry a "Challenges: " prefix because they share the Plus Ultra settings list.
   Wording follows the core rulebook: Challenge Rating (CR) and Time Limit (TL); a success lowers CR, CR 0 before TL runs out = overcome. */
export const EN = {
  "INCH.Settings.Enabled.Name": "Challenges: show HUD",
  "INCH.Settings.Enabled.Hint": "Top-right panel listing the challenges (Challenge Rating and Time Limit) on the scene you are viewing (this client only).",
  "INCH.Settings.Scale.Name": "Challenges: scale",
  "INCH.Settings.Scale.Hint": "Size of the HUD. 1 = default.",
  "INCH.Settings.Camera.Name": "Challenges: cinematic camera (Hot Pan & Zoom)",
  "INCH.Settings.Camera.Hint": "GM only. When a challenge enters or leaves the scene (or its progress / time changes) your view glides to its token, holds and glides back; with Hot Pan & Zoom active the players follow. At most one shot per 8 seconds.",
  "INCH.Settings.Camera.off": "Off",
  "INCH.Settings.Camera.lifecycle": "Enter and leave only",
  "INCH.Settings.Camera.all": "Also progress and time changes",
  "INCH.Region": "Challenges",
  "INCH.Handle.Hide": "Hide the challenges",
  "INCH.Handle.Show": "Show the challenges",
  "INCH.Progress": "Progress",
  "INCH.TimeLeft": "Time left",
  "INCH.Cr.Label": "CR",
  "INCH.Tl.Label": "TL",
  "INCH.Cr.Hint": "Challenge Rating",
  "INCH.Tl.Hint": "Time Limit",
  "INCH.Bar.Cr": "{hint}: {value} of {max}. Each success lowers it by 1.",
  "INCH.Bar.Tl": "{hint}: {value} of {max} {unit}.",
  "INCH.Bar.CrNoMax": "{hint}: {value}.",
  "INCH.Bar.TlNoMax": "{hint}: {value} {unit}.",
  "INCH.Overcome": "Overcome",
  "INCH.TimeUp": "Time up",
  "INCH.Hidden": "Hidden",
  "INCH.HiddenTip": "Hidden from players",
  "INCH.More": "+{n} more",
  "INCH.Art.Pan": "Double-click: show this token on the map",
  "INCH.Art.Drag": "Drag onto the map to place a copy (Ctrl: separate new instance)",
  "INCH.Drag.LinkTitle": "Share one set of bars",
  "INCH.Drag.LinkBody": "To share one set of bars, this challenge will be linked to the world actor \"{name}\". Its current values (name, subtitle, CR/TL, image) will be copied to that actor and the token will be linked. Continue?",
  "INCH.Drag.LinkYes": "Link and place",
  "INCH.Drag.Cancel": "Cancel",
  "INCH.Drag.NoSource": "That challenge is no longer on the scene.",
  "INCH.Drag.NoActor": "This challenge has no world actor to copy.",
  "INCH.Drag.ErrLink": "Could not link the challenge to its world actor: {error}",
  "INCH.Drag.ErrCopy": "Could not place the challenge copy: {error}",
  "INCH.Drag.ErrNew": "Could not create a new challenge instance: {error}",
  "INCH.Drag.NewDone": "New challenge actor created: {name}",
  "INCH.Drag.NewDeclined": "Created a separate challenge: {name} (sharing declined; further drags of this challenge create new ones).",
  "INCH.Settings.DragMode.Name": "Challenges: plain drag",
  "INCH.Settings.DragMode.Hint": "GM only. What a plain drag of a challenge portrait onto the map does. Ctrl / Cmd always creates a new instance. Choosing \"Ask\" again also forgets earlier refusals.",
  "INCH.Settings.DragMode.ask": "Ask (share bars, with confirmation)",
  "INCH.Settings.DragMode.share": "Always share bars",
  "INCH.Settings.DragMode.new": "Always create a new instance",
  "INCH.Card.Open": "Press Enter to open the sheet.",
  "INCH.Card.Pan": "Shift+Enter shows the token on the map.",
  "INCH.Live.Cr": "Challenge Rating {value} of {max}, {pct} percent overcome",
  "INCH.Live.CrNoMax": "Challenge Rating {value}",
  "INCH.Live.Tl": "Time Limit {value} of {max} {unit}",
  "INCH.Live.TlNoMax": "Time Limit {value} {unit}",
  "INCH.Live.Overcome": "overcome",
  "INCH.Live.TimeUp": "time is up, not overcome",
  "INCH.Live.Hidden": "hidden from players",
  "INCH.Live.Appeared": "New challenge: {name}",
  "INCH.Live.Gone": "Challenge removed: {name}",
  "INCH.Settings.Visible.Name": "Challenges: visible cards",
  "INCH.Settings.Visible.Hint": "How many challenge cards the panel lists before the rest fold into a \"+N more\" button (click it to see them all in a scrolling list). Auto shows as many as the screen height allows. This client only.",
  "INCH.Settings.Visible.auto": "Auto (fit the screen height)",
  "INCH.Settings.Compact.Name": "Challenges: compact cards",
  "INCH.Settings.Compact.Hint": "A compact card is one short row: name, progress and time, and a small thumbnail to drag from. Auto switches to them when full cards would not fit the screen height.",
  "INCH.Settings.Compact.off": "Off",
  "INCH.Settings.Compact.on": "On",
  "INCH.Settings.Compact.auto": "Auto (when full cards do not fit)",
  "INCH.Fewer": "Show fewer",
  "INCH.MoreDesc": "Shows every challenge. The list scrolls when it is taller than the screen.",
  "INCH.FewerDesc": "Goes back to the first cards only.",
  "INCH.Live.Expanded": "Showing all {n} challenges",
  "INCH.Live.Collapsed": "Showing {n} of {total} challenges",
  "INCH.Live.TimeUpFor": "Time is up for {name}",
  "INCH.Live.OvercomeFor": "{name} overcome",
  "INCH.StepCrUp": "Progress +1 (CR −1)",
  "INCH.StepCrDown": "Progress −1 (CR +1)",
  "INCH.StepTlUp": "Time +1 (TL +1)",
  "INCH.StepTlDown": "Time −1 (TL −1)",
  "INCH.StepShift": "Shift: step of 5",
  "INCH.Settings.CombatTime.Name": "Challenges: time passes on their initiative",
  "INCH.Settings.CombatTime.Hint": "GM only. A challenge that is a combatant in a started combat and counts its time in rounds (Time unit: rounds, the default) loses 1 Time Limit (TL) each time the turn comes up on its own initiative (its first turn in round 1 counts); stepping the turn back past it gives the point back. Challenges whose Time unit is minutes, hours, days or weeks are never touched by combat, and neither are defeated ones or ones without an initiative. Add the challenge tokens to the combat tracker and set their initiative yourself.",
  "INCH.Unit.Tip": "Time unit: {unit}. Change it.",
  "INCH.Unit.Menu": "Time unit",
  "INCH.Unit.Note": "Combat does not count this challenge's time.",
  "INCH.Unit.SheetLabel": "Time unit",
  "INCH.Unit.SheetHint": "What one point of Time Limit is. Only challenges counted in rounds lose Time Limit on their initiative in combat."
};

export const PL = {
  "INCH.Settings.Enabled.Name": "Wyzwania: pokaż panel",
  "INCH.Settings.Enabled.Hint": "Panel w prawym górnym rogu z wyzwaniami (Challenge Rating i Time Limit) z oglądanej sceny (tylko na tym kliencie).",
  "INCH.Settings.Scale.Name": "Wyzwania: skala",
  "INCH.Settings.Scale.Hint": "Rozmiar panelu. 1 = domyślny.",
  "INCH.Settings.Camera.Name": "Wyzwania: kamera filmowa (Hot Pan & Zoom)",
  "INCH.Settings.Camera.Hint": "Tylko MG. Gdy wyzwanie wchodzi na scenę lub ją opuszcza (albo zmienia się postęp / czas), Twój widok płynie do jego tokena, zatrzymuje się i wraca; przy aktywnym Hot Pan & Zoom gracze podążają za nim. Najwyżej jedno ujęcie na 8 sekund.",
  "INCH.Settings.Camera.off": "Wyłączona",
  "INCH.Settings.Camera.lifecycle": "Tylko wejście i zejście",
  "INCH.Settings.Camera.all": "Także zmiany postępu i czasu",
  "INCH.Region": "Wyzwania",
  "INCH.Handle.Hide": "Ukryj wyzwania",
  "INCH.Handle.Show": "Pokaż wyzwania",
  "INCH.Progress": "Postęp",
  "INCH.TimeLeft": "Pozostały czas",
  "INCH.Cr.Label": "CR",
  "INCH.Tl.Label": "TL",
  "INCH.Cr.Hint": "Challenge Rating",
  "INCH.Tl.Hint": "Time Limit",
  "INCH.Bar.Cr": "{hint}: {value} z {max}. Każdy sukces obniża go o 1.",
  "INCH.Bar.Tl": "{hint}: {value} z {max} {unit}.",
  "INCH.Bar.CrNoMax": "{hint}: {value}.",
  "INCH.Bar.TlNoMax": "{hint}: {value} {unit}.",
  "INCH.Overcome": "Pokonane",
  "INCH.TimeUp": "Koniec czasu",
  "INCH.Hidden": "Ukryte",
  "INCH.HiddenTip": "Ukryte przed graczami",
  "INCH.More": "+{n} więcej",
  "INCH.Art.Pan": "Dwuklik: pokaż ten token na mapie",
  "INCH.Art.Drag": "Przeciągnij na mapę, aby postawić kopię (Ctrl: osobna, nowa instancja)",
  "INCH.Drag.LinkTitle": "Wspólne paski",
  "INCH.Drag.LinkBody": "Aby kopie miały wspólne paski, to wyzwanie zostanie powiązane z aktorem świata \"{name}\". Jego obecne wartości (nazwa, podtytuł, CR/TL, obraz) zostaną skopiowane do tego aktora, a token zostanie powiązany. Kontynuować?",
  "INCH.Drag.LinkYes": "Powiąż i postaw",
  "INCH.Drag.Cancel": "Anuluj",
  "INCH.Drag.NoSource": "Tego wyzwania nie ma już na scenie.",
  "INCH.Drag.NoActor": "To wyzwanie nie ma aktora świata do skopiowania.",
  "INCH.Drag.ErrLink": "Nie udało się powiązać wyzwania z aktorem świata: {error}",
  "INCH.Drag.ErrCopy": "Nie udało się postawić kopii wyzwania: {error}",
  "INCH.Drag.ErrNew": "Nie udało się utworzyć nowej instancji wyzwania: {error}",
  "INCH.Drag.NewDone": "Utworzono nowego aktora wyzwania: {name}",
  "INCH.Drag.NewDeclined": "Utworzono osobne wyzwanie: {name} (odmówiono wspólnych pasków; kolejne przeciągnięcia tego wyzwania tworzą nowe).",
  "INCH.Settings.DragMode.Name": "Wyzwania: zwykłe przeciągnięcie",
  "INCH.Settings.DragMode.Hint": "Tylko MG. Co robi zwykłe przeciągnięcie portretu wyzwania na mapę. Ctrl / Cmd zawsze tworzy nową instancję. Ponowny wybór „Pytaj” zapomina też wcześniejsze odmowy.",
  "INCH.Settings.DragMode.ask": "Pytaj (wspólne paski, z potwierdzeniem)",
  "INCH.Settings.DragMode.share": "Zawsze wspólne paski",
  "INCH.Settings.DragMode.new": "Zawsze nowa instancja",
  "INCH.Card.Open": "Enter otwiera kartę.",
  "INCH.Card.Pan": "Shift+Enter pokazuje token na mapie.",
  "INCH.Live.Cr": "Challenge Rating {value} z {max}, pokonano {pct} procent",
  "INCH.Live.CrNoMax": "Challenge Rating {value}",
  "INCH.Live.Tl": "Time Limit {value} z {max} {unit}",
  "INCH.Live.TlNoMax": "Time Limit {value} {unit}",
  "INCH.Live.Overcome": "pokonane",
  "INCH.Live.TimeUp": "koniec czasu, nie pokonane",
  "INCH.Live.Hidden": "ukryte przed graczami",
  "INCH.Live.Appeared": "Nowe wyzwanie: {name}",
  "INCH.Live.Gone": "Wyzwanie usunięte: {name}",
  "INCH.Settings.Visible.Name": "Wyzwania: widoczne karty",
  "INCH.Settings.Visible.Hint": "Ile kart wyzwań panel wyświetla, zanim reszta zwinie się w przycisk \"+N więcej\" (kliknij, by zobaczyć wszystkie na przewijanej liście). Auto pokazuje tyle, ile pozwala wysokość ekranu. Tylko ten klient.",
  "INCH.Settings.Visible.auto": "Auto (dopasuj do wysokości ekranu)",
  "INCH.Settings.Compact.Name": "Wyzwania: karty kompaktowe",
  "INCH.Settings.Compact.Hint": "Karta kompaktowa to jeden krótki wiersz: nazwa, postęp i czas oraz mała miniatura do przeciągania. Auto włącza je, gdy pełne karty nie mieszczą się na ekranie.",
  "INCH.Settings.Compact.off": "Wyłączone",
  "INCH.Settings.Compact.on": "Włączone",
  "INCH.Settings.Compact.auto": "Auto (gdy pełne karty się nie mieszczą)",
  "INCH.Fewer": "Pokaż mniej",
  "INCH.MoreDesc": "Pokazuje wszystkie wyzwania. Lista przewija się, gdy jest wyższa niż ekran.",
  "INCH.FewerDesc": "Wraca do samych pierwszych kart.",
  "INCH.Live.Expanded": "Pokazano wszystkie wyzwania: {n}",
  "INCH.Live.Collapsed": "Pokazano wyzwania: {n} z {total}",
  "INCH.Live.TimeUpFor": "Koniec czasu: {name}",
  "INCH.Live.OvercomeFor": "Pokonane: {name}",
  "INCH.StepCrUp": "Postęp +1 (CR −1)",
  "INCH.StepCrDown": "Postęp −1 (CR +1)",
  "INCH.StepTlUp": "Czas +1 (TL +1)",
  "INCH.StepTlDown": "Czas −1 (TL −1)",
  "INCH.StepShift": "Shift: krok 5",
  "INCH.Settings.CombatTime.Name": "Wyzwania: czas płynie z ich inicjatywą",
  "INCH.Settings.CombatTime.Hint": "Tylko MG. Wyzwanie będące uczestnikiem rozpoczętej walki i liczące czas w rundach (Jednostka czasu: rundy, wartość domyślna) traci 1 punkt Time Limit (TL), gdy tura dochodzi do jego własnej inicjatywy (jego pierwsza tura w rundzie 1 też się liczy); cofnięcie tury poza nią oddaje punkt. Wyzwań z jednostką czasu w minutach, godzinach, dniach lub tygodniach walka nigdy nie rusza, podobnie jak pokonanych i tych bez inicjatywy. Tokeny wyzwań dodaj do trackera walki i ustaw im inicjatywę ręcznie.",
  "INCH.Unit.Tip": "Jednostka czasu: {unit}. Zmień.",
  "INCH.Unit.Menu": "Jednostka czasu",
  "INCH.Unit.Note": "Walka nie liczy czasu tego wyzwania.",
  "INCH.Unit.SheetLabel": "Jednostka czasu",
  "INCH.Unit.SheetHint": "Czym jest jeden punkt Time Limit. Tylko wyzwania liczone w rundach tracą Time Limit na swojej inicjatywie w walce."
};

/* ---------- time unit of a challenge ----------
   Stored as the actor flag flags["invincible-plus-ultra"].timeUnit (a missing / unknown value = "rounds", so every older challenge stays in rounds).
   Only "rounds" is counted by the combat tracker (combat.mjs). Names live in code tables, not in i18n keys, because Polish needs four forms. */
export const UNITS = ["rounds", "minutes", "hours", "days", "weeks"];
export const DEFAULT_UNIT = "rounds";
export const unitOf = (actor) => { const v = actor?.flags?.["invincible-plus-ultra"]?.timeUnit; return UNITS.includes(v) ? v : DEFAULT_UNIT; };

const U_EN = { rounds: ["round", "rounds"], minutes: ["minute", "minutes"], hours: ["hour", "hours"], days: ["day", "days"], weeks: ["week", "weeks"] };
/* [after 1 (nominative), after 2-4, after 5+ (genitive plural), genitive singular, menu label] */
const U_PL = {
  rounds: ["runda", "rundy", "rund", "rundy", "Rundy"], minutes: ["minuta", "minuty", "minut", "minuty", "Minuty"], hours: ["godzina", "godziny", "godzin", "godziny", "Godziny"],
  days: ["dzień", "dni", "dni", "dnia", "Dni"], weeks: ["tydzień", "tygodnie", "tygodni", "tygodnia", "Tygodnie"]
};
const isPl = () => (globalThis.game?.i18n?.lang ?? "en") === "pl";
/* The unit's name for a number. of = false: the noun counted by n ("1 runda", "3 rundy", "5 rund"; EN "1 round", "3 rounds");
   of = true: after "X z" / "X of" ("3 z 1 rundy", "3 z 6 rund"). Polish rule as in module.js successWord (n % 10 in 2..4, not n % 100 in 12..14). */
export function unitName(unit, n, of = false) {
  const u = UNITS.includes(unit) ? unit : DEFAULT_UNIT;
  const k = Number.isFinite(Number(n)) ? Math.abs(Math.round(Number(n))) : 0;
  if (!isPl()) return U_EN[u][k === 1 ? 0 : 1];
  const w = U_PL[u];
  if (of) return k === 1 ? w[3] : w[2];
  if (k === 1) return w[0];
  return k % 10 >= 2 && k % 10 <= 4 && !(k % 100 >= 12 && k % 100 <= 14) ? w[1] : w[2];
}
/* the unit as a menu / select label ("Rounds", "Rundy") */
export const unitLabel = (unit) => { const u = UNITS.includes(unit) ? unit : DEFAULT_UNIT; return isPl() ? U_PL[u][4] : U_EN[u][1].replace(/^./, (c) => c.toUpperCase()); };

/* Local resolver: the HUD never depends on game.i18n having these keys (a missing merge once showed raw "INCH.REGION" keys; a key that is
   both a leaf and a parent, like INCH.CR and INCH.CR.Hint, also breaks expandObject). Language: game.i18n.lang, PL on top of EN. */
let cacheLang = null, cache = EN;
export function t(key, data) {
  const lang = globalThis.game?.i18n?.lang ?? "en";
  if (lang !== cacheLang) { cacheLang = lang; cache = lang === "pl" ? { ...EN, ...PL } : EN; }
  const s = cache[key] ?? key;
  return data ? s.replace(/\{(\w+)\}/g, (m, k) => (data[k] === undefined ? m : String(data[k]))) : s;
}
