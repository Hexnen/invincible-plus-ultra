/* Activity log strings (IPL.*), embedded like scripts/base/lang.mjs: Foundry reads a module's language list only at server start, so t() reads these
   tables directly. Flat keys, English + Polish built from ONE definition so they cannot drift. Entries store a type id and raw data; every sentence is
   built at display time from IPL.Sum.<type>[.<variant>] with {placeholders}, so the language switch applies to old entries too and a translator may
   reorder the words. Names of items, people and book data are never translated. Polish uses nominal phrases after "{who}:" so no gendered verb is needed.
   Plurals: KEY.one / KEY.other (EN) and KEY.one / KEY.few / KEY.many (PL), picked by tn(). Pure module: no Foundry globals except a guarded game.i18n.lang. */
export const EN = {};
export const PL = {};
const T = (key, en, pl) => { EN[key] = en; PL[key] = pl; };
const TP = (key, enOne, enOther, plOne, plFew, plMany) => {
  EN[`${key}.one`] = enOne; EN[`${key}.other`] = enOther;
  PL[`${key}.one`] = plOne; PL[`${key}.few`] = plFew; PL[`${key}.many`] = plMany;
};

/** Sentence variants chosen by the row renderer (entry data -> suffix). Listed here so check-lang can prove every variant string exists. */
export const VARIANTS = Object.freeze({
  "stat.vital": ["up", "down"], "stat.text": ["bio"], "actor.img": ["portrait", "token"], "item.toggle": ["on", "off"], "damage.taken": ["att"],
  "combat.action": ["on", "off"], "actor.created": ["dup"], "card.occupied": ["on", "off"], "event.reroll": ["named"], "event.resolved": ["named"], "event.applied": ["named"], "event.note": ["named"], "event.dismissed": ["named"], "event.undone": ["named"], "upgrade.add": ["starting", "granted", "bought"], "team.join": [], "roll.made": []
});
/** Dynamic key families, checked against the registries by check-lang.mjs. */
export const ATTRS = ["fighting", "agility", "strength", "reason", "intuition", "presence"];
export const VITALS = ["health", "resolve", "slugfest"];
export const TRACKS = ["karma", "reputation", "resources"];
export const TEXTS = ["civilianName", "role", "appearance", "occupation", "personality", "drive", "flaw", "relationships", "team", "teamBase", "biography"];
export const CARD_FIELDS = ["kind", "where", "description", "purpose", "background", "motto"];
export const ITEM_TYPES = ["power", "talent", "gear", "criticalInjury", "powerSource", "boost", "limit", "drawback", "spell"];
export const PATHS = ["name", "level", "powerSource", "power", "cost", "singleUse", "restricted", "lethal", "healingTime", "description", "type"];
export const LEVELS = ["NONE", "LIMITED", "OBSERVER", "OWNER"];
export const STATUSES = ["active", "installing", "disabled", "broken", "lost"];
export const CAUSES = ["manual", "stress", "damage", "undo", "chargen", "base-buy"];
export const SOURCES = ["drop", "chargen", "sheet", "compendium", "transfer"];
export const MODES = ["public", "gm", "blind"];
export const ACTIONS = ["fastAction", "slowAction"];

/* ------------------------------------------------------------------ tab, categories, keys */
T("IPL.Tab", "Log", "Dziennik");
T("IPL.TabAria", "Activity log", "Dziennik aktywności");
T("IPL.TabAriaNew", "Activity log, {n} new", "Dziennik aktywności, nowych: {n}");
T("IPL.Host.Wait", "Loading the log...", "Wczytywanie dziennika...");
T("IPL.Host.Missing", "The activity log is not available.", "Dziennik aktywności jest niedostępny.");
for (const [c, en, pl] of [
  ["stats", "Stats", "Statystyki"], ["items", "Items", "Przedmioty"], ["effects", "Effects", "Efekty"], ["damage", "Damage", "Obrażenia"], ["rolls", "Rolls", "Rzuty"],
  ["combat", "Combat", "Walka"], ["creation", "Creation", "Tworzenie"], ["team", "Team", "Drużyna"], ["notes", "Notes", "Notatki"], ["system", "System", "System"],
  ["card", "Card", "Karta"], ["members", "Members", "Członkowie"], ["upgrades", "Upgrades", "Ulepszenia"], ["events", "Events", "Zdarzenia"], ["gear", "Gear", "Sprzęt"],
  ["sync", "Sync", "Synchronizacja"], ["access", "Access", "Dostęp"]
]) T(`IPL.Cat.${c}`, en, pl);
for (const [k, en, pl] of [
  ["fighting", "Fighting", "Walka wręcz"], ["agility", "Agility", "Zwinność"], ["strength", "Strength", "Siła"], ["reason", "Reason", "Rozum"], ["intuition", "Intuition", "Intuicja"],
  ["presence", "Presence", "Obecność"], ["health", "Health", "Zdrowie"], ["resolve", "Resolve", "Determinacja"], ["slugfest", "Slugfest", "Slugfest"],
  ["karma", "Karma", "Karma"], ["reputation", "Reputation", "Reputacja"], ["resources", "Resources", "Zasoby"],
  ["civilianName", "Civilian name", "Imię cywilne"], ["role", "Role", "Rola"], ["appearance", "Appearance", "Wygląd"], ["occupation", "Occupation", "Zawód"],
  ["personality", "Personality", "Osobowość"], ["drive", "Drive", "Motywacja"], ["flaw", "Flaw", "Wada"], ["relationships", "Relationships", "Relacje"],
  ["team", "Team", "Drużyna"], ["teamBase", "Team base", "Baza drużyny"], ["biography", "Biography", "Biografia"],
  ["kind", "Kind", "Rodzaj"], ["where", "Location", "Lokalizacja"], ["description", "Description", "Opis"], ["purpose", "Purpose", "Cel"], ["background", "Background", "Tło"], ["motto", "Motto", "Motto"]
]) T(`IPL.Key.${k}`, en, pl);
for (const [k, en, pl] of [
  ["power", "power", "moc"], ["talent", "talent", "talent"], ["gear", "gear", "sprzęt"], ["criticalInjury", "critical injury", "krytyczna rana"], ["powerSource", "power source", "źródło mocy"],
  ["boost", "boost", "wzmocnienie"], ["limit", "limit", "ograniczenie"], ["drawback", "drawback", "wada"], ["spell", "spell", "zaklęcie"]
]) T(`IPL.ItemType.${k}`, en, pl);
for (const [k, en, pl] of [
  ["name", "name", "nazwa"], ["level", "level", "poziom"], ["powerSource", "power source", "źródło mocy"], ["power", "power", "moc"], ["cost", "cost", "koszt"],
  ["singleUse", "single use", "jednorazowe"], ["restricted", "restricted", "ograniczone"], ["lethal", "lethal", "śmiertelne"], ["healingTime", "healing time", "czas leczenia"],
  ["description", "description", "opis"], ["type", "type", "typ"]
]) T(`IPL.Path.${k}`, en, pl);
for (const [k, en, pl] of [["NONE", "No access", "Brak dostępu"], ["LIMITED", "Limited", "Ograniczony"], ["OBSERVER", "Observer", "Obserwator"], ["OWNER", "Owner", "Właściciel"]]) T(`IPL.Level.${k}`, en, pl);
for (const [k, en, pl] of [["active", "active", "aktywne"], ["installing", "installing", "w budowie"], ["disabled", "disabled", "wyłączone"], ["broken", "broken", "zepsute"], ["lost", "lost", "utracone"]]) T(`IPL.Status.${k}`, en, pl);
for (const [k, en, pl] of [
  ["manual", "by hand", "ręcznie"], ["stress", "from stress", "ze stresu"], ["damage", "from damage", "z obrażeń"], ["undo", "from an undo", "przez cofnięcie"], ["chargen", "by the generator", "przez generator"], ["base-buy", "base purchase", "zakup bazy"]
]) T(`IPL.Cause.${k}`, en, pl);
for (const [k, en, pl] of [["drop", "dropped on the sheet", "upuszczone na kartę"], ["chargen", "from the generator", "z generatora"], ["sheet", "created on the sheet", "utworzone na karcie"], ["compendium", "from a compendium", "z kompendium"], ["transfer", "given from the base", "przekazane z bazy"]]) T(`IPL.Src.${k}`, en, pl);
for (const [k, en, pl] of [["public", "public roll", "rzut publiczny"], ["gm", "private roll", "rzut prywatny"], ["blind", "blind roll", "rzut w ciemno"]]) T(`IPL.Mode.${k}`, en, pl);
T("IPL.Action.fastAction", "Fast action", "Szybka akcja"); T("IPL.Action.slowAction", "Slow action", "Wolna akcja"); T("IPL.Action.n", "Action {n}", "Akcja {n}");

/* ------------------------------------------------------------------ type names (IPL.Type.*) */
const TYPE_NAMES = [
  ["stat.attr", "Attribute change", "Zmiana atrybutu"], ["stat.vital", "Health, Resolve or Slugfest", "Zdrowie, Determinacja lub Slugfest"], ["stat.track", "Karma, Reputation or Resources", "Karma, Reputacja lub Zasoby"],
  ["stat.text", "Text edit", "Edycja tekstu"], ["actor.rename", "Rename", "Zmiana nazwy"], ["actor.img", "Image change", "Zmiana obrazu"],
  ["item.add", "Item added", "Dodano przedmiot"], ["item.remove", "Item removed", "Usunięto przedmiot"], ["item.edit", "Item edited", "Edycja przedmiotu"], ["item.toggle", "Item switched", "Przełączenie przedmiotu"],
  ["effect.add", "Effect added", "Dodano efekt"], ["effect.remove", "Effect removed", "Usunięto efekt"], ["effect.edit", "Effect edited", "Edycja efektu"],
  ["damage.taken", "Damage taken", "Otrzymane obrażenia"], ["damage.undone", "Damage undone", "Cofnięte obrażenia"], ["roll.made", "Roll", "Rzut"],
  ["combat.join", "Joined combat", "Dołączenie do walki"], ["combat.leave", "Left combat", "Opuszczenie walki"], ["combat.turn", "Turn started", "Początek tury"],
  ["combat.action", "Action mark", "Znacznik akcji"], ["combat.init", "Initiative", "Inicjatywa"], ["combat.end", "Combat ended", "Koniec walki"],
  ["chargen.apply", "Generated build applied", "Zastosowano wygenerowaną postać"], ["chargen.undo", "Generated build undone", "Cofnięto wygenerowaną postać"],
  ["team.join", "Joined a team", "Dołączenie do drużyny"], ["team.leave", "Left a team", "Opuszczenie drużyny"], ["team.sync", "Team texts synced", "Synchronizacja tekstów drużyny"],
  ["actor.created", "Hero created", "Utworzenie bohatera"], ["actor.deleted", "Hero deleted", "Usunięcie bohatera"],
  ["access.owner", "Access changed", "Zmiana dostępu"], ["access.default", "Default access changed", "Zmiana dostępu domyślnego"],
  ["note.add", "Note", "Notatka"], ["note.gm", "GM note", "Notatka MG"], ["bulk.change", "Many changes", "Wiele zmian"],
  ["log.start", "Log started", "Początek dziennika"], ["log.gap", "Gap in the log", "Luka w dzienniku"], ["log.prune", "Older entries trimmed", "Przycięto starsze wpisy"],
  ["log.redact", "Entries redacted", "Zredagowane wpisy"], ["log.import", "Entries imported", "Zaimportowane wpisy"], ["log.throttle", "Too many changes", "Zbyt wiele zmian"],
  ["card.edit", "Card edit", "Edycja karty"], ["card.roll", "Card roll", "Rzut karty"], ["card.rename", "Card renamed", "Zmiana nazwy karty"], ["card.img", "Card image", "Obraz karty"],
  ["card.occupied", "Base occupied", "Baza zajęta"], ["member.add", "Member added", "Dodano członka"], ["member.remove", "Member removed", "Usunięto członka"],
  ["upgrade.add", "Upgrade added", "Dodano ulepszenie"], ["upgrade.buy", "Upgrade bought", "Kupiono ulepszenie"], ["upgrade.status", "Upgrade status", "Stan ulepszenia"],
  ["upgrade.count", "Upgrade count", "Liczba ulepszeń"], ["upgrade.remove", "Upgrade removed", "Usunięto ulepszenie"], ["upgrade.note", "Upgrade note", "Notatka ulepszenia"],
  ["event.rolled", "Base event", "Zdarzenie bazy"], ["event.reroll", "Event rolled again", "Ponowny rzut zdarzenia"], ["event.resolved", "Event handled", "Zdarzenie załatwione"],
  ["event.applied", "Event applied", "Zdarzenie zastosowane"], ["event.note", "Event note", "Notatka zdarzenia"],
  ["event.dismissed", "Event dismissed", "Zdarzenie odrzucone"], ["event.undone", "Event undone", "Zdarzenie cofnięte"],
  ["crate.add", "Crate item added", "Dodano do skrzyni"], ["crate.remove", "Crate item removed", "Usunięto ze skrzyni"], ["crate.qty", "Crate quantity", "Ilość w skrzyni"], ["crate.give", "Crate item given", "Wydano ze skrzyni"],
  ["vehicle.add", "Vehicle added", "Dodano pojazd"], ["vehicle.remove", "Vehicle removed", "Usunięto pojazd"], ["vehicle.primary", "Team vehicle set", "Ustawiono pojazd drużyny"],
  ["tracker.edit", "Counter edit", "Zmiana licznika"], ["tracker.remove", "Counter removed", "Usunięto licznik"], ["sync.push", "Texts pushed to heroes", "Wysłano teksty do bohaterów"], ["sync.adopt", "Card taken from a hero", "Karta wzięta od bohatera"],
  ["policy.change", "Policy changed", "Zmiana zasad"], ["base.created", "Base created", "Utworzenie bazy"], ["base.deleted", "Base deleted", "Usunięcie bazy"], ["base.migrated", "Base migrated", "Migracja bazy"]
];
for (const [id, en, pl] of TYPE_NAMES) T(`IPL.Type.${id}`, en, pl);

/* ------------------------------------------------------------------ sentences (IPL.Sum.*)  {who} = the user, other names are filled by ui/rows.mjs */
const SUM = [
  ["stat.attr", "{who} changed {key} from {from} to {to}", "{who}: {key} z {from} na {to}"],
  ["stat.vital", "{who} changed {key} from {from} to {to}", "{who}: {key} z {from} na {to}"],
  ["stat.vital.up", "{who} restored {abs} {key}", "{who}: {key} +{abs}"],
  ["stat.vital.down", "{who} lost {abs} {key}", "{who}: {key} −{abs}"],
  ["stat.track", "{who} changed {key} from {from} to {to}", "{who}: {key} z {from} na {to}"],
  ["stat.text", "{who} edited {key}", "{who}: edycja pola {key}"],
  ["stat.text.bio", "{who} edited the biography ({len})", "{who}: edycja biografii ({len})"],
  ["actor.rename", "{who} renamed the hero from “{from}” to “{to}”", "{who}: zmiana nazwy z „{from}” na „{to}”"],
  ["actor.img", "{who} changed the image", "{who}: zmiana obrazu"],
  ["actor.img.portrait", "{who} changed the portrait", "{who}: zmiana portretu"],
  ["actor.img.token", "{who} changed the token image", "{who}: zmiana obrazu żetonu"],
  ["item.add", "{who} added {type} {name}{lvl}", "{who}: dodano {type} {name}{lvl}"],
  ["item.remove", "{who} removed {type} {name}", "{who}: usunięto {type} {name}"],
  ["item.edit", "{who} edited {type} {name}: {what}", "{who}: edycja ({type}) {name}: {what}"],
  ["item.toggle", "{who} switched {name} on or off", "{who}: przełączono {name}"],
  ["item.toggle.on", "{who} switched {name} on", "{who}: włączono {name}"],
  ["item.toggle.off", "{who} switched {name} off", "{who}: wyłączono {name}"],
  ["effect.add", "{who} added the effect {name}", "{who}: dodano efekt {name}"],
  ["effect.remove", "{who} removed the effect {name}", "{who}: usunięto efekt {name}"],
  ["effect.edit", "{who} edited the effect {name}", "{who}: edycja efektu {name}"],
  ["damage.taken", "{who} applied {amount} damage", "{who}: obrażenia: {amount}"],
  ["damage.taken.att", "{who} applied {amount} damage from {attacker}", "{who}: obrażenia: {amount} (atakujący: {attacker})"],
  ["damage.undone", "{who} undid damage: Health back from {from} to {to}", "{who}: cofnięto obrażenia, Zdrowie z {from} na {to}"],
  ["roll.made", "{who} rolled {name}: {result}", "{who}: rzut {name}: {result}"],
  ["combat.join", "{who} added the hero to a combat", "{who}: dodano bohatera do walki"],
  ["combat.leave", "{who} removed the hero from a combat", "{who}: usunięto bohatera z walki"],
  ["combat.turn", "Turn started in round {round}", "Początek tury w rundzie {round}"],
  ["combat.action", "{status} changed", "Zmiana: {status}"],
  ["combat.action.on", "{status} used", "Użyto: {status}"],
  ["combat.action.off", "{status} cleared", "Zwolniono: {status}"],
  ["combat.init", "{who} changed initiative from {from} to {to}", "{who}: inicjatywa z {from} na {to}"],
  ["combat.end", "The combat ended after {roundsTxt}", "Koniec walki po {roundsTxt}"],
  ["chargen.apply", "{who} applied a generated build: {summary}", "{who}: zastosowano wygenerowaną postać: {summary}"],
  ["chargen.undo", "{who} undid the generated build", "{who}: cofnięto wygenerowaną postać"],
  ["team.join", "{who} linked the hero to the team {name}", "{who}: powiązano bohatera z drużyną {name}"],
  ["team.leave", "{who} unlinked the hero from the team {name}", "{who}: odłączono bohatera od drużyny {name}"],
  ["team.sync", "Team texts were synced from the team card", "Teksty drużyny zsynchronizowano z karty drużyny"],
  ["actor.created", "{who} created the hero", "{who}: utworzono bohatera"],
  ["actor.created.dup", "{who} duplicated {dupOf}", "{who}: zduplikowano {dupOf}"],
  ["actor.deleted", "{who} deleted the hero {name}", "{who}: usunięto bohatera {name}"],
  ["access.owner", "{who} set {name} to “{to}” (was “{from}”)", "{who}: dostęp dla {name}: „{to}” (było „{from}”)"],
  ["access.default", "{who} set the default access to “{to}” (was “{from}”)", "{who}: dostęp domyślny: „{to}” (było „{from}”)"],
  ["note.add", "{who} wrote: {text}", "{who}: notatka: {text}"],
  ["note.gm", "{who} added a GM note: {text}", "{who}: notatka MG: {text}"],
  ["bulk.change", "{who} made {changes} at once", "{who}: {changes} naraz"],
  ["log.start", "The log started here", "Początek dziennika"],
  ["log.gap", "Changes made while the log was not recording: {changes}", "Zmiany wykonane, gdy dziennik nie zapisywał: {changes}"],
  ["log.prune", "{removed} older entries were trimmed", "Przycięto starsze wpisy: {removed}"],
  ["log.redact", "{who} removed the content of {entries}", "{who}: usunięto treść: {entries}"],
  ["log.import", "{who} imported {entries}", "{who}: zaimportowano: {entries}"],
  ["log.throttle", "Too many changes at once: further entries were skipped", "Zbyt wiele zmian naraz: pominięto kolejne wpisy"],
  ["card.edit", "{who} edited the card field {key}", "{who}: edycja pola karty {key}"],
  ["card.roll", "{who} rolled the {key} table: {result}", "{who}: rzut na tabeli „{key}”: {result}"],
  ["card.rename", "{who} renamed the card from “{from}” to “{to}”", "{who}: zmiana nazwy karty z „{from}” na „{to}”"],
  ["card.img", "{who} changed the card image", "{who}: zmiana obrazu karty"],
  ["card.occupied", "{who} changed whether the base is occupied", "{who}: zmiana zajęcia bazy"],
  ["card.occupied.on", "{who} marked the base as occupied", "{who}: baza oznaczona jako zajęta"],
  ["card.occupied.off", "{who} cleared the occupied mark of the base", "{who}: zdjęto oznaczenie zajęcia bazy"],
  ["member.add", "{who} added {name} to the team", "{who}: {name} dołącza do drużyny"],
  ["member.remove", "{who} removed {name} from the team", "{who}: {name} opuszcza drużynę"],
  ["upgrade.add", "{who} added the upgrade {name}", "{who}: dodano ulepszenie {name}"],
  ["upgrade.add.starting", "{who} chose the starting upgrade {name}", "{who}: wybrano ulepszenie startowe {name}"],
  ["upgrade.add.granted", "{who} granted the upgrade {name}", "{who}: przyznano ulepszenie {name}"],
  ["upgrade.add.bought", "{who} added the upgrade {name} (bought for {paid} karma)", "{who}: dodano ulepszenie {name} (kupione za {paid} karmy)"],
  ["upgrade.buy", "{who} bought the upgrade {name} for {cost} karma", "{who}: kupiono ulepszenie {name} za {cost} karmy"],
  ["upgrade.status", "{who} changed {name} from {from} to {to}", "{who}: {name} z „{from}” na „{to}”"],
  ["upgrade.count", "{who} changed the count of {name} from {from} to {to}", "{who}: liczba {name} z {from} na {to}"],
  ["upgrade.remove", "{who} removed the upgrade {name}", "{who}: usunięto ulepszenie {name}"],
  ["upgrade.note", "{who} edited the note of {name}", "{who}: edycja notatki {name}"],
  ["event.rolled", "{who} rolled a base event: {label}", "{who}: rzut zdarzenia bazy: {label}"],
  ["event.reroll", "{who} rolled the event again", "{who}: ponowny rzut zdarzenia"],
  ["event.resolved", "{who} handled the event", "{who}: zdarzenie załatwione"],
  ["event.applied", "{who} applied the event to the card", "{who}: zdarzenie zastosowano na karcie"],
  ["event.note", "{who} edited the note of an event", "{who}: edycja notatki zdarzenia"],
  ["event.dismissed", "{who} dismissed the proposed effect of an event", "{who}: odrzucono proponowany skutek zdarzenia"],
  ["event.undone", "{who} undid the effect of an event", "{who}: cofnięto skutek zdarzenia"],
  ["event.dismissed.named", "{who} dismissed the proposed effect of the event {name}", "{who}: odrzucono proponowany skutek zdarzenia {name}"],
  ["event.undone.named", "{who} undid the effect of the event {name}", "{who}: cofnięto skutek zdarzenia {name}"],
  ["event.reroll.named", "{who} rolled the event {name} again", "{who}: ponowny rzut zdarzenia {name}"],
  ["event.resolved.named", "{who} handled the event {name}", "{who}: zdarzenie {name} załatwione"],
  ["event.applied.named", "{who} applied the event {name} to the card", "{who}: zdarzenie {name} zastosowano na karcie"],
  ["event.note.named", "{who} edited the note of the event {name}", "{who}: edycja notatki zdarzenia {name}"],
  ["crate.add", "{who} put {name} in the crate", "{who}: dodano do skrzyni {name}"],
  ["crate.remove", "{who} took {name} out of the crate", "{who}: usunięto ze skrzyni {name}"],
  ["crate.qty", "{who} set the quantity of {name} to {qty}", "{who}: ilość {name} = {qty}"],
  ["crate.give", "{who} gave {name} to {to}", "{who}: wydano {name} dla {to}"],
  ["vehicle.add", "{who} added the vehicle {name}", "{who}: dodano pojazd {name}"],
  ["vehicle.remove", "{who} removed the vehicle {name}", "{who}: usunięto pojazd {name}"],
  ["vehicle.primary", "{who} made {name} the team vehicle", "{who}: pojazd drużyny: {name}"],
  ["tracker.remove", "{who} removed the counter {name}", "{who}: usunięto licznik {name}"],
  ["tracker.edit", "{who} changed the counter {name} from {from} to {to}", "{who}: licznik {name} z {from} na {to}"],
  ["sync.push", "{who} pushed the card texts to {members}", "{who}: wysłano teksty karty do: {members}"],
  ["sync.adopt", "{who} took the card texts from {from}", "{who}: karta wzięta od {from}"],
  ["policy.change", "{who} changed the policy {key} from “{from}” to “{to}”", "{who}: zasada {key}: z „{from}” na „{to}”"],
  ["base.created", "{who} created the base {name}", "{who}: utworzono bazę {name}"],
  ["base.deleted", "{who} deleted the base {name}", "{who}: usunięto bazę {name}"],
  ["base.migrated", "{who} migrated the base {name}", "{who}: zmigrowano bazę {name}"],
  ["unknown", "{who} made a change ({type})", "{who}: zmiana ({type})"]
];
for (const [id, en, pl] of SUM) T(`IPL.Sum.${id}`, en, pl);

/* ------------------------------------------------------------------ plurals used inside sentences and the UI */
TP("IPL.Plural.Entries", "{n} entry", "{n} entries", "{n} wpis", "{n} wpisy", "{n} wpisów");
TP("IPL.Plural.Shown", "{n} of {total} entry shown", "{n} of {total} entries shown", "Widoczne: {n} z {total} wpisu", "Widoczne: {n} z {total} wpisów", "Widoczne: {n} z {total} wpisów");
TP("IPL.Plural.New", "{n} new entry", "{n} new entries", "{n} nowy wpis", "{n} nowe wpisy", "{n} nowych wpisów");
TP("IPL.Plural.Changes", "{n} change", "{n} changes", "{n} zmiana", "{n} zmiany", "{n} zmian");
TP("IPL.Plural.Rounds", "{n} round", "{n} rounds", "{n} rundzie", "{n} rundach", "{n} rundach");
TP("IPL.Plural.Success", "{n} success", "{n} successes", "{n} sukces", "{n} sukcesy", "{n} sukcesów");
TP("IPL.Plural.Bane", "{n} bane", "{n} banes", "{n} jedynka", "{n} jedynki", "{n} jedynek");
TP("IPL.Plural.Matching", "{n} entry matches", "{n} entries match", "Pasuje {n} wpis", "Pasują {n} wpisy", "Pasuje {n} wpisów");
T("IPL.Out.None", "no successes", "brak sukcesów");
T("IPL.Out.Push", "pushed {n}×", "pchnięty {n}×");
T("IPL.Out.Dmg", "damage {n}", "obrażenia {n}");
T("IPL.Out.Stunts", "stunts {n}", "wyczyny {n}");
T("IPL.Out.Stress", "stress {n}", "stres {n}");
T("IPL.Sum.Build", "{add} added, {del} removed, {fields} fields", "dodano {add}, usunięto {del}, pól {fields}");
T("IPL.Sum.BuildRank", "{rank}: {summary}", "{rank}: {summary}");
T("IPL.Sum.Unit.h", "{n} h", "{n} godz.");
T("IPL.Sum.Unit.d", "{n} d", "{n} dn.");
T("IPL.Sum.Unit.min", "{n} min", "{n} min");
T("IPL.Sum.Level", "level {n}", "poziom {n}");
T("IPL.Sum.Chars", "{a} → {b} characters", "znaków: {a} → {b}");
T("IPL.Sum.Empty", "(empty)", "(puste)");
T("IPL.Sum.Characters", "{n} characters", "znaków: {n}");

/* ------------------------------------------------------------------ the view */
const UI = [
  ["Region", "Activity log", "Dziennik aktywności"],
  ["Search", "Search the log", "Szukaj w dzienniku"],
  ["SearchPh", "Item, person, value", "Przedmiot, osoba, wartość"],
  ["SearchClear", "Clear the search", "Wyczyść wyszukiwanie"],
  ["Filters", "Filters", "Filtry"],
  ["FiltersOn", "Filters ({n})", "Filtry ({n})"],
  ["Categories", "Categories", "Kategorie"],
  ["All", "All", "Wszystko"],
  ["Person", "Person", "Osoba"],
  ["Everyone", "Everyone", "Wszyscy"],
  ["When", "When", "Kiedy"],
  ["AnyTime", "Any time", "Zawsze"],
  ["Today", "Today", "Dziś"],
  ["Yesterday", "Yesterday", "Wczoraj"],
  ["LastSession", "Last session", "Ostatnia sesja"],
  ["Days7", "Last 7 days", "Ostatnie 7 dni"],
  ["From", "From", "Od"],
  ["To", "To", "Do"],
  ["Rounds", "Combat rounds", "Rundy walki"],
  ["RoundFrom", "From round", "Od rundy"],
  ["RoundTo", "To round", "Do rundy"],
  ["ShowMinor", "Show minor events", "Pokaż drobne zdarzenia"],
  ["ShowMinorHint", "Turn starts, action marks, initiative, image changes", "Początki tur, znaczniki akcji, inicjatywa, zmiany obrazów"],
  ["OnlyMine", "Only my changes", "Tylko moje zmiany"],
  ["ClearFilters", "Clear filters", "Wyczyść filtry"],
  ["Density", "Row detail", "Szczegółowość wierszy"],
  ["Compact", "Compact", "Zwięźle"],
  ["Detailed", "Detailed", "Szczegółowo"],
  ["Export", "Export", "Eksport"],
  ["ExportView", "This view ({n})", "Ten widok ({n})"],
  ["ExportAll", "Everything ({n})", "Wszystko ({n})"],
  ["ExportAs", "Save as {format}", "Zapisz jako {format}"],
  ["Exported", "Saved {file}", "Zapisano {file}"],
  ["ExportFailed", "The file could not be saved.", "Nie udało się zapisać pliku."],
  ["AddNote", "Add a note", "Dodaj notatkę"],
  ["NoteLabel", "Note", "Notatka"],
  ["NotePh", "What should the table remember?", "Co stół ma zapamiętać?"],
  ["NoteGm", "Only the GM sees this note", "Tę notatkę widzi tylko MG"],
  ["NoteSave", "Add note", "Dodaj"],
  ["NoteCancel", "Cancel", "Anuluj"],
  ["NoteAdded", "Note added.", "Dodano notatkę."],
  ["NoteFailed", "The note could not be added. A GM must be connected.", "Nie udało się dodać notatki. Potrzebny jest połączony MG."],
  ["NoteEmpty", "Write something first.", "Najpierw coś napisz."],
  ["NoteLeft", "{n} characters left", "Pozostało znaków: {n}"],
  ["Details", "Details", "Szczegóły"],
  ["Collapse", "Hide details", "Ukryj szczegóły"],
  ["Expand", "Show details", "Pokaż szczegóły"],
  ["RowAria", "{time}, {sentence}", "{time}, {sentence}"],
  ["ShowChat", "Show chat card", "Pokaż kartę na czacie"],
  ["ChatGone", "Chat card deleted", "Karta usunięta z czatu"],
  ["OpenItem", "Open item", "Otwórz przedmiot"],
  ["ItemGone", "Item deleted", "Przedmiot usunięty"],
  ["OpenActor", "Open sheet", "Otwórz kartę"],
  ["ActorGone", "Sheet not available", "Karta niedostępna"],
  ["Annotate", "Annotate", "Dodaj adnotację"],
  ["AnnotatePh", "A note only the GM sees", "Notatka widoczna tylko dla MG"],
  ["AnnotateSave", "Save annotation", "Zapisz adnotację"],
  ["Redact", "Redact", "Zredaguj"],
  ["RedactAsk", "Remove the content of this entry? A marker stays.", "Usunąć treść tego wpisu? Zostanie znacznik."],
  ["RedactYes", "Yes, remove the content", "Tak, usuń treść"],
  ["RedactFailed", "Only the GM client that records the log can redact. Reload this window if it just changed.", "Redagować może tylko klient MG, który zapisuje dziennik. Odśwież to okno, jeśli właśnie się zmienił."],
  ["GmOnly", "GM only", "Tylko MG"],
  ["GmOnlyTip", "Only the GM sees this entry. This is a display rule of the interface, not encryption.", "Ten wpis widzi tylko MG. To reguła wyświetlania w interfejsie, nie szyfrowanie."],
  ["Approx", "Approximate", "Przybliżone"],
  ["ApproxTip", "Reconstructed after the fact; the exact time and author may differ.", "Odtworzone po fakcie; dokładny czas i autor mogą się różnić."],
  ["Relayed", "Relayed", "Przekazane"],
  ["RelayedTip", "Sent by a player's client; the author is the one claimed there.", "Wysłane z klienta gracza; autor jest taki, jaki tam zadeklarowano."],
  ["Merged", "{n} edits merged", "Połączone edycje: {n}"],
  ["RoundBadge", "R{n}", "R{n}"],
  ["RoundTip", "Combat round {n}", "Runda walki {n}"],
  ["NowCalled", "Now called {name}", "Teraz nazywa się {name}"],
  ["FromTo", "from {from} to {to}", "z {from} na {to}"],
  ["Up", "up", "w górę"],
  ["Down", "down", "w dół"],
  ["Field", "Field", "Pole"],
  ["Before", "Before", "Przed"],
  ["After", "After", "Po"],
  ["Dice", "Dice", "Kości"],
  ["DieSuccess", "{n}, success", "{n}, sukces"],
  ["DieBane", "{n}, bane", "{n}, jedynka"],
  ["DieNeutral", "{n}", "{n}"],
  ["PushHistory", "Earlier results", "Wcześniejsze wyniki"],
  ["Added", "Added", "Dodano"],
  ["Removed", "Removed", "Usunięto"],
  ["MoreItems", "and {n} more", "i {n} więcej"],
  ["ShowAllKids", "Show all {n}", "Pokaż wszystkie ({n})"],
  ["Children", "What changed", "Co się zmieniło"],
  ["Notes", "GM notes on this entry", "Notatki MG do tego wpisu"],
  ["Cause", "Cause", "Przyczyna"],
  ["Source", "Source", "Źródło"],
  ["Time", "Time", "Czas"],
  ["Author", "Author", "Autor"],
  ["System", "The system", "System"],
  ["UnknownUser", "Former user", "Dawny użytkownik"],
  ["Level", "level {n}", "poziom {n}"],
  ["LenChange", "{a} → {b} characters", "znaków: {a} → {b}"],
  ["Day", "{date}", "{date}"],
  ["SessionBreak", "New session after {gap}", "Nowa sesja po {gap}"],
  ["ShowOlder", "Show older entries", "Pokaż starsze wpisy"],
  ["ShowOlderN", "Show older entries ({n} more)", "Pokaż starsze wpisy (jeszcze {n})"],
  ["EndOfLog", "That is the start of the log.", "To początek dziennika."],
  ["NewPill", "Show {n}", "Pokaż: {n}"],
  ["Unseen", "{n} new", "nowe: {n}"],
  ["Loading", "Loading the log", "Wczytywanie dziennika"],
  ["Off", "The activity log is off.", "Dziennik aktywności jest wyłączony."],
  ["OffGm", "The activity log is off. Turn it on in the module settings (Activity log).", "Dziennik aktywności jest wyłączony. Włącz go w ustawieniach modułu (Dziennik aktywności)."],
  ["Empty", "Nothing logged yet.", "Jeszcze nic nie zapisano."],
  ["EmptyHint", "From now on, changes appear here: stats, items, effects, damage, rolls, combat, the character generator, team links and notes.", "Od teraz tu pojawią się zmiany: statystyki, przedmioty, efekty, obrażenia, rzuty, walka, generator postaci, powiązania z drużyną i notatki."],
  ["EmptyBase", "From now on, changes appear here: the card, members, upgrades, events, gear, syncing and notes.", "Od teraz tu pojawią się zmiany: karta, członkowie, ulepszenia, zdarzenia, sprzęt, synchronizacja i notatki."],
  ["EmptyFiltered", "No entries match these filters.", "Żaden wpis nie pasuje do filtrów."],
  ["EmptyFilteredMinor", "Minor events are hidden. Turn them on in Filters to see turn starts and action marks.", "Drobne zdarzenia są ukryte. Włącz je w Filtrach, by zobaczyć początki tur i znaczniki akcji."],
  ["NoPermission", "The GM keeps this log private.", "MG utrzymuje ten dziennik jako prywatny."],
  ["NoScribe", "No GM is connected. Changes made now are not recorded as they happen; they are added as one catch-up entry when the GM returns.", "Żaden MG nie jest połączony. Zmiany wykonane teraz nie są zapisywane na bieżąco; po powrocie MG zostaną dodane jako jeden wpis nadrabiający."],
  ["Error", "The log could not be read.", "Nie udało się odczytać dziennika."],
  ["Retry", "Try again", "Spróbuj ponownie"],
  ["Showing", "Showing the newest {n}", "Wyświetlono najnowsze: {n}"],
  ["Entries", "Entries", "Wpisy"],
  ["NoTab", "The log tab is only shown to the GM and the owners of this hero.", "Zakładka dziennika jest widoczna tylko dla MG i właścicieli tego bohatera."]
];
for (const [k, en, pl] of UI) T(`IPL.UI.${k}`, en, pl);
T("IPL.UI.Err.noGM", "No GM is connected.", "Żaden MG nie jest połączony.");
T("IPL.UI.Err.noPermission", "You may not do that.", "Nie masz do tego uprawnień.");
T("IPL.UI.Err.badInput", "That input is not valid.", "Nieprawidłowe dane.");
T("IPL.UI.Err.rate", "Too many log entries in a short time. Wait a moment and try again.", "Za dużo wpisów w krótkim czasie. Odczekaj chwilę i spróbuj ponownie.");
T("IPL.UI.Err.disabled", "The activity log is off.", "Dziennik aktywności jest wyłączony.");
T("IPL.UI.Err.notFound", "That entry no longer exists.", "Tego wpisu już nie ma.");

/* ------------------------------------------------------------------ validation messages (model.mjs / export.mjs return IPL.Val.<code> keys) */
for (const [k, en, pl] of [
  ["notObject", "The entry is not an object.", "Wpis nie jest obiektem."], ["noType", "The entry has no type.", "Wpis nie ma typu."], ["badType", "Unknown entry type.", "Nieznany typ wpisu."],
  ["badScope", "The entry type does not belong to this kind of log.", "Typ wpisu nie należy do tego rodzaju dziennika."], ["badTime", "The entry has no valid time.", "Wpis nie ma poprawnego czasu."],
  ["noUser", "The entry has no author.", "Wpis nie ma autora."], ["badId", "The entry id is not valid.", "Identyfikator wpisu jest nieprawidłowy."], ["badData", "The entry data is not valid.", "Dane wpisu są nieprawidłowe."],
  ["missing", "A required field is missing.", "Brakuje wymaganego pola."], ["tooBig", "The entry is too large.", "Wpis jest zbyt duży."], ["badJson", "The file is not valid JSON.", "Plik nie jest poprawnym JSON-em."],
  ["badFormat", "The file is not an activity log export.", "Plik nie jest eksportem dziennika aktywności."], ["badVersion", "The export has an unsupported version.", "Eksport ma nieobsługiwaną wersję."],
  ["duplicate", "The entry appears twice.", "Wpis występuje dwukrotnie."]
]) T(`IPL.Val.${k}`, en, pl);

/* ------------------------------------------------------------------ settings (GM-facing) */
const SECRECY_EN = "Privacy note: the log is hidden by the interface, not encrypted. Every connected client receives all world data, so a player who knows the browser console can read logs that the interface hides from them (like whispered chat).";
const SECRECY_PL = "Uwaga o prywatności: dziennik jest ukrywany przez interfejs, a nie szyfrowany. Każdy połączony klient dostaje wszystkie dane świata, więc gracz znający konsolę przeglądarki może odczytać dzienniki, które interfejs mu ukrywa (tak jak szepty na czacie).";
T("IPL.Settings.logEnabled.Name", "Activity log", "Dziennik aktywności");
T("IPL.Settings.logEnabled.Hint", `Record what happens to superheroes and team bases: who changed what, when, with before and after values. Needs a GM connected to record. ${SECRECY_EN}`, `Zapisuj, co dzieje się z superbohaterami i bazami drużyn: kto, co, kiedy i jak się zmieniło. Do zapisu potrzebny jest połączony MG. ${SECRECY_PL}`);
T("IPL.Settings.logReadAccess.Name", "Who can read a hero's log", "Kto czyta dziennik bohatera");
T("IPL.Settings.logReadAccess.Hint", `The GM always can. Choose whether the hero's owners, or owners and observers, also see the Log tab. Private and blind rolls and GM notes are shown to the GM only. ${SECRECY_EN}`, `MG zawsze. Wybierz, czy zakładkę Dziennik widzą też właściciele bohatera, albo właściciele i obserwatorzy. Rzuty prywatne i w ciemno oraz notatki MG widzi tylko MG. ${SECRECY_PL}`);
T("IPL.Settings.logReadAccess.gm", "GM only", "Tylko MG");
T("IPL.Settings.logReadAccess.owners", "GM and owners", "MG i właściciele");
T("IPL.Settings.logReadAccess.observers", "GM, owners and observers", "MG, właściciele i obserwatorzy");
T("IPL.Settings.logRetainEntries.Name", "Log entries kept per hero", "Wpisy dziennika na bohatera");
T("IPL.Settings.logRetainEntries.Hint", "When a log grows beyond this, the oldest block is trimmed and a marker stays (team bases keep 60 percent unless the Table log sets a limit for them). 0 keeps everything, which makes the world heavier. The Table log (button above) can trim, export and import logs.", "Gdy dziennik urośnie ponad tę liczbę, najstarszy blok jest przycinany i zostaje znacznik (bazy drużyn zachowują 60 procent, chyba że Dziennik stołu ustawi dla nich własny limit). 0 zachowuje wszystko, co obciąża świat. Dziennik stołu (przycisk wyżej) potrafi przycinać, eksportować i importować dzienniki.");
T("IPL.Settings.logPlayerNotes.Name", "Players may add notes to their log", "Gracze mogą dodawać notatki do dziennika");
T("IPL.Settings.logPlayerNotes.Hint", "Owners can write a note into the log of their own hero. They cannot edit or delete anything. Notes travel through a connected GM; with no GM connected a note waits on the player's device and is added, marked unverified, when a GM returns.", "Właściciele mogą dopisać notatkę do dziennika własnego bohatera. Nie mogą niczego edytować ani usuwać. Notatki przechodzą przez połączonego MG; gdy nie ma MG, notatka czeka na urządzeniu gracza i po powrocie MG jest dodawana jako niezweryfikowana.");
T("IPL.Settings.logTable.Name", "Table log", "Dziennik stołu");
T("IPL.Settings.logTable.Label", "Open the Table log", "Otwórz Dziennik stołu");
T("IPL.Settings.logTable.Hint", `GM only. Every hero and team base log in one timeline, plus the health of the logs, limits, trim, export and import, and logs of deleted actors. ${SECRECY_EN}`, `Tylko MG. Dzienniki wszystkich bohaterów i baz drużyn na jednej osi czasu, a do tego stan dzienników, limity, przycinanie, eksport i import oraz dzienniki usuniętych postaci. ${SECRECY_PL}`);
T("IPL.Keybind.Table.Name", "Open the Table log", "Otwórz Dziennik stołu");
T("IPL.Keybind.Table.Hint", "GM only. Not bound by default.", "Tylko MG. Domyślnie bez skrótu.");
T("IPL.Settings.logCombat.Name", "Log combat events", "Zapisuj zdarzenia walki");
T("IPL.Settings.logCombat.Hint", "Joining and leaving a combat, turn starts, action marks and initiative. Turn starts, action marks and initiative are minor events and stay hidden unless the Log tab asks for them.", "Dołączanie do walki i wychodzenie z niej, początki tur, znaczniki akcji i inicjatywa. Początki tur, znaczniki akcji i inicjatywa to drobne zdarzenia, ukryte, dopóki zakładka Dziennik o nie nie poprosi.");
T("IPL.Settings.logRevealJournals.Name", "Show the log journals in the sidebar", "Pokaż dzienniki logu na pasku bocznym");
T("IPL.Settings.logRevealJournals.Hint", "They are hidden by default; do not edit them by hand. This client only.", "Domyślnie ukryte; nie edytuj ich ręcznie. Tylko ten klient.");

/* ------------------------------------------------------------------ L6: Table log, maintenance, import, offline queue */
TP("IPL.Plural.Logs", "{n} log", "{n} logs", "{n} dziennik", "{n} dzienniki", "{n} dzienników");
TP("IPL.Plural.Chunks", "{n} block", "{n} blocks", "{n} blok", "{n} bloki", "{n} bloków");
TP("IPL.Plural.Queued", "{n} entry made while no GM was connected is waiting on this device and will be recorded when a GM returns.", "{n} entries made while no GM was connected are waiting on this device and will be recorded when a GM returns.", "{n} wpis wykonany bez połączonego MG czeka na tym urządzeniu i zostanie zapisany po powrocie MG.", "{n} wpisy wykonane bez połączonego MG czekają na tym urządzeniu i zostaną zapisane po powrocie MG.", "{n} wpisów wykonanych bez połączonego MG czeka na tym urządzeniu i zostanie zapisanych po powrocie MG.");
for (const [k, en, pl] of [
  ["ChatDerived", "From chat", "Z czatu"],
  ["ChatDerivedTip", "Built from a chat message. The author, time and content come from the browser of whoever sent it and are not verified by the server.", "Zbudowany z wiadomości na czacie. Autor, czas i treść pochodzą z przeglądarki nadawcy i nie są weryfikowane przez serwer."],
  ["Damaged", "This entry is damaged and cannot be shown ({type}).", "Ten wpis jest uszkodzony i nie można go wyświetlić ({type})."],
  ["Imported", "Imported", "Zaimportowany"],
  ["ImportedTip", "Added from a file. The author and time are as stated in that file, not verified.", "Dodany z pliku. Autor i czas są takie, jak podano w pliku, bez weryfikacji."],
  ["Unverified", "Unverified", "Niezweryfikowany"],
  ["UnverifiedTip", "Sent from a player's device while no GM was connected and recorded later. The author and time are as that device claimed.", "Wysłany z urządzenia gracza, gdy nie było MG, i zapisany później. Autor i czas są takie, jak zadeklarowało to urządzenie."],
  ["NoteQueued", "Saved on this device. It is added to the log when a GM connects.", "Zapisano na tym urządzeniu. Trafi do dziennika, gdy połączy się MG."],
  ["NoteQueuedFull", "The waiting list on this device is full; the oldest waiting entry was dropped.", "Lista oczekujących na tym urządzeniu jest pełna; najstarszy oczekujący wpis został pominięty."],
  ["TableEmpty", "Changes to heroes and team bases appear here once logging is on.", "Zmiany bohaterów i baz drużyn pojawią się tu, gdy zapis jest włączony."]
]) T(`IPL.UI.${k}`, en, pl);
for (const [k, en, pl] of [["tooBigFile", "The file is too large (limit 8 MB).", "Plik jest zbyt duży (limit 8 MB)."], ["tooMany", "The file holds too many entries or logs.", "Plik zawiera zbyt wiele wpisów lub dzienników."],
  ["noLogs", "The file contains no logs.", "Plik nie zawiera dzienników."], ["scopeMismatch", "This log belongs to the other kind of actor (hero or team base).", "Ten dziennik należy do innego rodzaju postaci (bohater albo baza drużyny)."]]) T(`IPL.Val.${k}`, en, pl);

for (const [k, en, pl] of [
  ["Title", "Table log", "Dziennik stołu"],
  ["OpenTip", "Open the log of the whole table (GM only)", "Otwórz dziennik całego stołu (tylko MG)"],
  ["OpenBadge", "{n} new", "nowe: {n}"],
  ["TabsAria", "Table log sections", "Sekcje dziennika stołu"],
  ["TabTimeline", "Timeline", "Oś czasu"],
  ["TabMaint", "Maintenance", "Konserwacja"],
  ["Actors", "Heroes and bases", "Bohaterowie i bazy"],
  ["AllActors", "Everyone", "Wszyscy"],
  ["Orphan", "deleted", "usunięty"],
  ["MoreActors", "Show all {n}", "Pokaż wszystkie ({n})"],
  ["FewerActors", "Show fewer", "Pokaż mniej"],
  ["OpenActor", "Open {name}", "Otwórz: {name}"],
  ["ScopeHero", "Hero", "Bohater"],
  ["ScopeBase", "Team base", "Baza drużyny"],
  ["ScopeOrphan", "Deleted actor", "Usunięta postać"],
  ["Back", "Back to the timeline", "Wróć do osi czasu"],
  ["Closed", "The Table log is for the GM only.", "Dziennik stołu jest tylko dla MG."]
]) T(`IPL.Table.${k}`, en, pl);

for (const [k, en, pl] of [
  ["Health", "Health", "Stan dziennika"],
  ["Logs", "Logs", "Dzienniki"],
  ["Limits", "Limits", "Limity"],
  ["HLogging", "Logging", "Zapis"],
  ["HOn", "On", "Włączony"],
  ["HOff", "Off. Turn it on in the module settings.", "Wyłączony. Włącz go w ustawieniach modułu."],
  ["HScribe", "Scribe", "Skryba"],
  ["HScribeMe", "{name}, this browser", "{name}, ta przeglądarka"],
  ["HScribeOther", "{name}, another browser", "{name}, inna przeglądarka"],
  ["HScribeNone", "No GM is connected, so nothing is being recorded.", "Nie ma połączonego MG, więc nic nie jest zapisywane."],
  ["HScribeHint", "The scribe is the connected GM's browser that writes the log.", "Skryba to przeglądarka połączonego MG, która zapisuje dziennik."],
  ["HRead", "Who reads", "Kto czyta"],
  ["HStored", "Stored", "Zapisane"],
  ["HStoredV", "{logs}, {entries}, {size}", "{logs}, {entries}, {size}"],
  ["HNear", "Near their limit", "Blisko limitu"],
  ["HNone", "None", "Brak"],
  ["HNearV", "{n} of {total}", "{n} z {total}"],
  ["HGaps", "Catch-up gaps", "Luki do nadrobienia"],
  ["HGapsHint", "Entries added after the GM had been away.", "Wpisy dodane po nieobecności MG."],
  ["HThrottle", "Throttled bursts", "Ograniczone serie"],
  ["HThrottleHint", "A macro or import changed so much so fast that the surplus was dropped.", "Makro lub import zmieniły tyle i tak szybko, że nadmiar odrzucono."],
  ["HUnverified", "Late entries from players", "Spóźnione wpisy graczy"],
  ["HUnverifiedHint", "Sent from a player's device while no GM was connected; their author and time are not verified.", "Wysłane z urządzenia gracza, gdy nie było MG; ich autor i czas nie są zweryfikowane."],
  ["HImported", "Imported entries", "Zaimportowane wpisy"],
  ["HPruned", "Trimmed away so far", "Dotąd przycięte"],
  ["HSession", "This browser session", "Ta sesja przeglądarki"],
  ["HSessionV", "{batches} writes, {failed} failed, {dropped} dropped by the throttle, {waiting} waiting", "zapisów: {batches}, nieudanych: {failed}, odrzuconych przez ogranicznik: {dropped}, oczekujących: {waiting}"],
  ["HQueue", "Offline queue (this device)", "Kolejka offline (to urządzenie)"],
  ["HQueueV", "{n} waiting", "oczekujących: {n}"],
  ["HQueueEmpty", "Empty", "Pusta"],
  ["HQueueHint", "A player's device keeps entries made while no GM is connected until a GM returns. A GM device never queues.", "Urządzenie gracza przechowuje wpisy wykonane bez połączonego MG, dopóki MG nie wróci. Urządzenie MG nic nie kolejkuje."],
  ["HNotLogged", "Actors without a log", "Postacie bez dziennika"],
  ["HNotLoggedHint", "Heroes and bases that have not changed since logging began.", "Bohaterowie i bazy, które nie zmieniły się od włączenia zapisu."],
  ["HRefresh", "Refresh", "Odśwież"],
  ["RHero", "Entries kept per hero", "Wpisy na bohatera"],
  ["RBase", "Entries kept per team base", "Wpisy na bazę drużyny"],
  ["RAuto", "Automatic: 60 percent of the hero limit ({n})", "Automatycznie: 60 procent limitu bohatera ({n})"],
  ["RHint", "0 keeps everything. Once a log passes its limit, the oldest block is trimmed at the next write. Use Trim to do it now, with a preview.", "0 zachowuje wszystko. Gdy dziennik przekroczy limit, najstarszy blok jest przycinany przy następnym zapisie. Przycisk Przytnij robi to od razu, z podglądem."],
  ["RSave", "Save limits", "Zapisz limity"],
  ["RSaved", "Limits saved.", "Zapisano limity."],
  ["RBad", "Enter a whole number from 0 to 50000.", "Wpisz liczbę całkowitą od 0 do 50000."],
  ["TName", "Log", "Dziennik"],
  ["TKind", "Kind", "Rodzaj"],
  ["TEntries", "Entries", "Wpisy"],
  ["TSize", "Size", "Rozmiar"],
  ["TLast", "Last entry", "Ostatni wpis"],
  ["TNotes", "Flags", "Znaczniki"],
  ["TActions", "Actions", "Akcje"],
  ["TAria", "Logs of this table", "Dzienniki tego stołu"],
  ["TUsage", "{count} of {cap}", "{count} z {cap}"],
  ["TNoCap", "{count}, no limit", "{count}, bez limitu"],
  ["TSecret", "{n} private", "prywatnych: {n}"],
  ["TNever", "never", "nigdy"],
  ["Gaps", "Gaps {n}", "Luki {n}"],
  ["Throttled", "Throttled {n}", "Ogran. {n}"],
  ["Late", "Late {n}", "Spóźn. {n}"],
  ["ImportedN", "Imported {n}", "Import {n}"],
  ["Open", "Open", "Otwórz"],
  ["OpenAria", "Open {name}", "Otwórz: {name}"],
  ["Manage", "Manage", "Zarządzaj"],
  ["ManageAria", "Manage the log of {name}", "Zarządzaj dziennikiem: {name}"],
  ["ExportAs", "Export as {format}", "Eksportuj jako {format}"],
  ["ImportInto", "Import into this log…", "Importuj do tego dziennika…"],
  ["Trim", "Trim…", "Przytnij…"],
  ["Delete", "Delete this log…", "Usuń ten dziennik…"],
  ["ExportArchive", "Export everything", "Eksportuj wszystko"],
  ["ExportArchiveTip", "One archive file with every log. Import reads it back log by log.", "Jeden plik archiwum ze wszystkimi dziennikami. Import wczytuje go dziennik po dzienniku."],
  ["ImportFile", "Import a file…", "Importuj plik…"],
  ["NoLogs", "No logs exist yet. Turn logging on, then change a hero or a team base.", "Nie ma jeszcze dzienników. Włącz zapis, a potem zmień bohatera lub bazę drużyny."],
  ["NotAllowed", "Only the GM can manage the logs.", "Dziennikami może zarządzać tylko MG."],
  ["Failed", "That did not work: {why}", "To się nie udało: {why}"]
]) T(`IPL.Maint.${k}`, en, pl);
for (const [k, en, pl] of [["ok", "within the limit", "w granicach limitu"], ["warn", "close to the limit", "blisko limitu"], ["over", "over the limit", "ponad limitem"], ["unlimited", "no limit", "bez limitu"]]) T(`IPL.Maint.State.${k}`, en, pl);

for (const [k, en, pl] of [
  ["Title", "Trim the log of {name}", "Przytnij dziennik: {name}"],
  ["Lede", "Drop the oldest blocks and keep the newest entries. Blocks are removed whole, so a few more than the number below may stay.", "Usuń najstarsze bloki i zostaw najnowsze wpisy. Bloki znikają w całości, więc może zostać nieco więcej niż podana liczba."],
  ["Keep", "Entries to keep", "Wpisy do zachowania"],
  ["Holds", "Now: {entries} in {chunks}.", "Teraz: {entries} w {chunks}."],
  ["Will", "This removes {entries} in {pages}, from {first} to {last}. {remain} stay. A marker in the log records the trim.", "To usunie {entries} w {pages}, od {first} do {last}. Zostanie {remain}. Znacznik w dzienniku zapisze przycięcie."],
  ["Secret", "It also removes {entries} that only the GM sees.", "Usunie też {entries}, które widzi tylko MG."],
  ["Nothing", "Nothing to trim: the log already holds no more than this, or it is one block.", "Nie ma co przycinać: dziennik ma nie więcej wpisów albo jest jednym blokiem."],
  ["Export", "Download the log as JSON first", "Najpierw pobierz dziennik jako JSON"],
  ["Go", "Remove {entries}", "Usuń: {entries}"],
  ["Done", "Trimmed: {removed} removed, {remain} remain.", "Przycięto: usunięto {removed}, zostało {remain}."],
  ["Bad", "Enter a number above 0.", "Wpisz liczbę większą od 0."]
]) T(`IPL.Trim.${k}`, en, pl);
for (const [k, en, pl] of [
  ["Title", "Delete the log of {name}?", "Usunąć dziennik: {name}?"],
  ["Lede", "This permanently deletes {entries}{secret} and the saved baseline the log compares against. It cannot be undone.", "To trwale usunie {entries}{secret} oraz zapisany stan wyjściowy, z którym dziennik porównuje zmiany. Nie można tego cofnąć."],
  ["SecretPart", ", plus {entries} that only the GM sees", ", a także {entries}, które widzi tylko MG"],
  ["Live", "{name} still exists. Its log starts again from now; everything before is gone.", "{name} nadal istnieje. Jego dziennik zacznie się od nowa od teraz; wszystko wcześniej przepadnie."],
  ["Orphan", "{name} was deleted. Only this log remains.", "{name} został usunięty. Zostaje tylko ten dziennik."],
  ["Backup", "Download the log as JSON first", "Najpierw pobierz dziennik jako JSON"],
  ["Go", "Delete the log of {name}", "Usuń dziennik: {name}"],
  ["Done", "Log deleted.", "Dziennik usunięty."]
]) T(`IPL.Del.${k}`, en, pl);
for (const [k, en, pl] of [
  ["Title", "Import a log file", "Importuj plik dziennika"],
  ["TitleInto", "Import into the log of {name}", "Importuj do dziennika: {name}"],
  ["Lede", "Choose a file exported from the log (one log or the archive). Entries already present are skipped, so importing the same file again changes nothing.", "Wybierz plik wyeksportowany z dziennika (jeden dziennik albo archiwum). Wpisy, które już są, są pomijane, więc ponowny import tego samego pliku nic nie zmienia."],
  ["File", "Log file (.json)", "Plik dziennika (.json)"],
  ["Reading", "Reading the file…", "Wczytywanie pliku…"],
  ["Line", "{name}: {fresh} new, {present} already there, {invalid} refused", "{name}: nowych {fresh}, już były {present}, odrzuconych {invalid}"],
  ["Foreign", "This file was exported from {from}; its entries are merged into {name}.", "Ten plik pochodzi z: {from}; jego wpisy zostaną scalone z: {name}."],
  ["SkipNoTarget", "{name}: no log or actor with that id exists in this world. Skipped.", "{name}: w tym świecie nie ma dziennika ani postaci o takim identyfikatorze. Pominięto."],
  ["SkipScope", "{name}: a hero log cannot go into a team base, or the reverse. Skipped.", "{name}: dziennik bohatera nie może trafić do bazy drużyny ani odwrotnie. Pominięto."],
  ["SkipNoMember", "This archive has no log for this actor.", "To archiwum nie zawiera dziennika tej postaci."],
  ["Note", "Imported entries are marked as imported: their author and time are as the file states, not verified.", "Zaimportowane wpisy są oznaczone: ich autor i czas są takie, jak w pliku, bez weryfikacji."],
  ["Go", "Import {entries}", "Importuj: {entries}"],
  ["Nothing", "Nothing new to import.", "Nie ma nic nowego do zaimportowania."],
  ["Done", "Imported {entries} into {logs}.", "Zaimportowano {entries} do: {logs}."],
  ["Refused", "The file cannot be imported", "Nie można zaimportować pliku"],
  ["Errors", "{n} entries in the file were refused because they are not valid.", "Odrzucono wpisy z pliku, bo są nieprawidłowe: {n}."]
]) T(`IPL.Imp.${k}`, en, pl);
T("IPL.Dlg.Cancel", "Cancel", "Anuluj");

/* ------------------------------------------------------------------ lookup */
const fill = (s, data) => String(s).replace(/\{(\w+)\}/g, (_m, k) => (data?.[k] ?? `{${k}}`));
const lang = () => { try { return globalThis.game?.i18n?.lang ?? "en"; } catch { return "en"; } };
export const isPl = () => lang().startsWith("pl");

/** t("IPL.UI.Search") or t("IPL.Sum.stat.attr", {who, key, from, to}). Falls back to English, then to the key. */
export function t(key, data) { return fill((isPl() ? PL : EN)[key] ?? EN[key] ?? key, data); }
export const has = (key) => key in EN;
/** Plural-aware: tn("IPL.Plural.New", 3) picks KEY.one / KEY.few / KEY.many (Polish) or KEY.one / KEY.other. */
export function tn(key, n, data = {}) {
  const pl = isPl(), a = Math.abs(n), mod10 = a % 10, mod100 = a % 100;
  const form = pl ? (a === 1 ? "one" : mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14) ? "few" : "many") : (a === 1 ? "one" : "other");
  const table = pl ? PL : EN;
  const k = `${key}.${form}` in table ? `${key}.${form}` : `${key}.other` in table ? `${key}.other` : key;
  return t(k, { n, ...data });
}
