/* ONE source for the names of the six attributes and the character's resources, in both languages.
   The lang tables of the module (chargen IPC.*, log IPL.*, tactics ITAC.*, combat ICB.*, party IPT.*) take these names from here instead of
   spelling them again, so a term cannot be rendered two ways. The Polish column must equal the labels of the system translation
   (lang/pl.json: INVINCIBLE.Actor.base.FIELDS.*) and the English column the system's own en.json: scripts/i18n/check-glossary.mjs proves both.
   Decisions: dev/glossary-pl.md (Presence = Prezencja, Resolve = Determinacja, Slugfest = Bijatyka). Pure data, no Foundry. */
export const ATTRS = Object.freeze(["fighting", "agility", "strength", "reason", "intuition", "presence"]);
export const TERMS = Object.freeze({
  en: Object.freeze({
    fighting: "Fighting", agility: "Agility", strength: "Strength", reason: "Reason", intuition: "Intuition", presence: "Presence",
    health: "Health", resolve: "Resolve", karma: "Karma", reputation: "Reputation", resources: "Resources", slugfest: "Slugfest",
  }),
  pl: Object.freeze({
    fighting: "Walka", agility: "Zwinność", strength: "Siła", reason: "Rozum", intuition: "Intuicja", presence: "Prezencja",
    health: "Zdrowie", resolve: "Determinacja", karma: "Karma", reputation: "Reputacja", resources: "Zasoby", slugfest: "Bijatyka",
  }),
});
/** Polish accusative of the attributes ("rzut na Walkę"). */
export const ATTR_ACC_PL = Object.freeze({ fighting: "Walkę", agility: "Zwinność", strength: "Siłę", reason: "Rozum", intuition: "Intuicję", presence: "Prezencję" });
/* GRADES of an attribute (the word beside its number: "Good", "Astounding"). User decision 2026-11-11 (dev/glossary-pl.md): in Polish the
   adjective AGREES with the attribute's gender: "Oszałamiająca Walka", "Fenomenalna Siła", "Dobry Rozum". A grade shown with no attribute
   beside it keeps the masculine form (the dictionary form; it is also what lang/pl.json carries under the system's keys, because the
   system's template asks for ONE word per grade, whatever the attribute). gradePl(n, attr) is the one place that picks the form. */
export const ATTR_GENDER_PL = Object.freeze({ fighting: "f", agility: "f", strength: "f", reason: "m", intuition: "f", presence: "f" });
export const GRADES_PL = Object.freeze({
  m: Object.freeze(["Brak", "Słaby", "Przeciętny", "Dobry", "Świetny", "Niezwykły", "Niesamowity", "Zdumiewający", "Oszałamiający", "Fenomenalny", "Niebywały", "Boski", "Niezwyciężony"]),
  f: Object.freeze(["Brak", "Słaba", "Przeciętna", "Dobra", "Świetna", "Niezwykła", "Niesamowita", "Zdumiewająca", "Oszałamiająca", "Fenomenalna", "Niebywała", "Boska", "Niezwyciężona"]),
});
export const gradePl = (n, attr = null) => GRADES_PL[ATTR_GENDER_PL[attr] ?? "m"][Number(n)] ?? null;
/** The system key that carries each term (what the sheet shows). */
const B = "INVINCIBLE.Actor.base.FIELDS.";
export const TERM_KEYS = Object.freeze({
  ...Object.fromEntries(ATTRS.map((a) => [a, `${B}attributes.${a}.label`])),
  health: `${B}derived.health.value.label`, resolve: `${B}derived.resolve.value.label`, karma: `${B}karma.label`,
  reputation: `${B}reputation.label`, resources: `${B}resources.label`, slugfest: `${B}derived.slugfest.label`,
});
