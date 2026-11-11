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
/** The system key that carries each term (what the sheet shows). */
const B = "INVINCIBLE.Actor.base.FIELDS.";
export const TERM_KEYS = Object.freeze({
  ...Object.fromEntries(ATTRS.map((a) => [a, `${B}attributes.${a}.label`])),
  health: `${B}derived.health.value.label`, resolve: `${B}derived.resolve.value.label`, karma: `${B}karma.label`,
  reputation: `${B}reputation.label`, resources: `${B}resources.label`, slugfest: `${B}derived.slugfest.label`,
});
