/* Rules library: challenges. Pure ES module, no Foundry globals. State objects are plain data and every function returns a new one.
   "book N" = line N of dev/book-dump.txt; "ruling N" = row N of section 4 of dev/combat-plan.md. */

/* ruling 15 (book 2337-2379): rolling for an objective costs a full action. */
export const OBJECTIVE_ACTION = "full";

/* Build a challenge state. def: { name, rating, timeLimit (rounds; null = "special", no clock), unit?: "rounds" | "days", ... }.
   book 2837: a Challenge rating and a time limit. */
export function makeChallenge(def) {
  return { ...def, rating: def.rating, maxRating: def.rating, timeLimit: def.timeLimit ?? null, roundsLeft: def.timeLimit ?? null, status: "active", resets: 0, dice: 0 };
}

/* book 2837: about the time limit = a simple problem, about twice = serious, three times or more = a major crisis. */
export function challengeSeverity({ maxRating, timeLimit }) {
  if (!timeLimit) return "special";
  const k = maxRating / timeLimit;
  return k >= 3 ? "major" : k >= 2 ? "serious" : "simple";
}

/* An objective option, e.g. { attr: "strength", minAttr: 5, power: "Blast" }, is open to a hero who meets the attribute minimum and has
   the power it names (book 2857, 2878: "requiring STRENGTH 5 / 7 or higher"; book 2839: a roll is always needed, also with a power).
   hero: { attrs, powers: [name] }. Players may also propose their own approach; the GM decides (book 2839). */
export function objectiveAvailable(option, hero) {
  if (option.minAttr && !((hero.attrs?.[option.attr] ?? 0) >= option.minAttr)) return { ok: false, reason: "attribute" };
  if (option.power && !(hero.powers ?? []).includes(option.power)) return { ok: false, reason: "power" };
  return { ok: true, reason: null };
}

/* book 2841: every 6 rolled for an objective takes 1 point off the rating; at 0 before the time runs out the challenge is overcome.
   Each hero's roll counts on its own (publisher's forum, consistent with 2841). Nothing happens to a challenge that is over. */
export function applyObjectiveRoll(ch, sixes) {
  if (ch.status !== "active") return ch;
  const rating = Math.max(0, ch.rating - Math.max(0, sixes));
  return { ...ch, rating, status: rating === 0 ? "overcome" : "active" };
}

/* ruling 22 (book 2841, example 2871): a challenge has no initiative card; its clock runs down at the END of each round, so a limit of
   N rounds gives N whole rounds. Returns { challenge, failed } (failed true once, in the round the time runs out). */
export function endOfRound(ch) {
  if (ch.status !== "active" || ch.roundsLeft == null) return { challenge: ch, failed: false };
  const roundsLeft = ch.roundsLeft - 1;
  if (roundsLeft > 0) return { challenge: { ...ch, roundsLeft }, failed: false };
  return { challenge: { ...ch, roundsLeft: 0, status: "failed" }, failed: true };
}

/* When the side effects of challenges fire (ruling 22; book 2845, 2876, 2889). */
export const EFFECT_TIMES = ["onStart", "roundStart", "heroTurnStart", "enterZone", "endOfRound", "onFail", "attackWithoutSurprise"];

/* book 2876 Magical Ward: when the time runs out the ward resets its rating to 8 and later attempts get a cumulative -2 dice (until it
   has lain undisturbed for a few hours). Reading: the clock starts again with the reset. */
export function wardReset(ch) {
  const w = ch.ward ?? {};
  return { ...ch, rating: w.resetRating ?? 8, roundsLeft: ch.timeLimit, status: "active", resets: ch.resets + 1, dice: ch.dice - (w.resetDice ?? 2) };
}
/* the ward lay undisturbed for a few hours: the penalty is gone */
export const wardRested = (ch) => ({ ...ch, dice: 0 });

/* The book's example challenges as data: numbers and structure only (book 2842-2892). objectives list the suggested options;
   effects use EFFECT_TIMES. */
export const BOOK_CHALLENGES = {
  burningBuilding: {
    name: "Burning Building", rating: 6, timeLimit: null,
    effects: [
      { when: "onStart", kind: "fire", intensity: 8, wrecksZone: true, killsBystanders: true },      // the fire itself then follows hazards.mjs
      { when: "roundStart", kind: "fireSpread", zones: 1, automatic: true },
    ],
    onOvercome: { kind: "fireOut", everywhere: true },
    objectives: [{ id: "fightFlames", options: [
      { attr: "reason", power: "Water Control" }, { attr: "reason", power: "Telekinesis" }, { attr: "agility" }, { attr: "strength" },
      { attr: "reason", power: "Weather Control" }, { attr: "agility", power: "Flight" }, { attr: "agility", power: "Super-Speed" }, { attr: "reason", power: "Transformation" },
    ] }],
  },
  complexInvestigation: {
    name: "Complex Investigation", rating: 4, timeLimit: 2, unit: "days", rollsPerHero: "oncePerDay",
    objectives: [
      { id: "gatherInformation", options: [{ attr: "presence" }, { attr: "intuition" }, { attr: "intuition", power: "Telepathy" }] },
      { id: "researchAndAnalyze", options: [{ attr: "reason" }] },
    ],
  },
  doomsdayDevice: {
    name: "Doomsday Device", rating: 6, timeLimit: 3,
    effects: [{ when: "onFail", kind: "blast", rating: 10 }],
    objectives: [
      { id: "smashTheMechanism", options: [{ attr: "strength", minAttr: 5 }] },
      { id: "overrideTheSystem", options: [{ attr: "reason" }] },
      { id: "shortOutTheConsole", options: [{ attr: "agility", power: "Blast" }, { attr: "reason", power: "Matter Control" }] },
    ],
  },
  extremeWeather: {
    name: "Extreme Weather", rating: 8, timeLimit: 4, area: "zoneAndAdjacent",
    effects: [{ when: "onStart", kind: "wreckZones", automatic: true }, { when: "onFail", kind: "bystandersDie" }],
    objectives: [
      { id: "tameTheWeather", options: [{ attr: "reason", power: "Weather Control" }, { attr: "reason", power: "Cold Control" }, { attr: "reason", power: "Fire Control" }, { attr: "reason", power: "Water Control" }] },
      { id: "produceShelter", options: [{ attr: "strength" }, { attr: "reason", power: "Matter Control" }, { attr: "reason", power: "Transformation" }, { attr: "reason", power: "Telekinesis" }] },
      { id: "rescueBystanders", options: [{ attr: "agility" }] },
    ],
  },
  hostageNegotiation: {
    name: "Hostage Negotiation", rating: 3, timeLimit: 3,
    effects: [
      { when: "onFail", kind: "hostagesDie" },
      { when: "attackWithoutSurprise", kind: "hostagesDie", immediate: true },
      { when: "endOfRound", kind: "hostagesDie", ifObjectiveStarted: "freeHostages" },
    ],
    objectives: [{ id: "freeHostages", options: [{ attr: "agility" }] }, { id: "navigateDemands", options: [{ attr: "presence" }] }],
  },
  magicalWard: {
    name: "Magical Ward", rating: 9, timeLimit: 3,
    ward: { agility: 8, damage: 5, range: 0, areaEffect: true, resetRating: 8, resetDice: 2 },
    effects: [{ when: "enterZone", kind: "wardBlast" }, { when: "roundStart", kind: "wardBlast" }, { when: "onFail", kind: "wardReset" }],
    objectives: [
      { id: "dispelMagic", options: [{ attr: "presence", power: "Nullification" }, { attr: "presence", power: "Sorcery" }] },
      { id: "breakTheSeal", options: [{ attr: "strength", minAttr: 7 }, { attr: "agility", power: "Blast" }, { attr: "reason", power: "Fire Control" }, { attr: "reason", power: "Matter Control" }, { attr: "reason", power: "Transformation" }] },
    ],
  },
  runawayTrain: {
    name: "Runaway Train", rating: 4, timeLimit: 3,
    effects: [{ when: "onFail", kind: "crash" }],
    objectives: [
      { id: "slowTheTrain", options: [{ attr: "strength" }, { attr: "reason", power: "Barrier" }, { attr: "reason", power: "Matter Control" }, { attr: "reason", power: "Snare" }, { attr: "reason", power: "Transformation" }] },
      { id: "evacuatePassengers", options: [{ attr: "agility" }, { attr: "strength" }, { attr: "reason", power: "Telekinesis" }, { attr: "reason", power: "Matter Control" }] },
      { id: "restoreSystemsAccess", options: [{ attr: "reason" }] },
    ],
  },
  toxicAccident: {
    name: "Toxic Accident", rating: 10, timeLimit: 5, zones: 5,
    effects: [
      { when: "heroTurnStart", kind: "toxin", attr: "strength", onFail: "loseFullAction", protection: ["suit", "lifeSupport"] },
      { when: "onFail", kind: "bystandersDie" },
    ],
    objectives: [
      { id: "neutralizeTheToxin", options: [{ attr: "reason", power: "Matter Control" }, { attr: "reason", power: "Nullification" }, { attr: "reason", power: "Electricity Control" }, { attr: "reason", power: "Plant Control" }, { attr: "reason", power: "Transformation" }] },
      { id: "createContainment", options: [{ attr: "strength" }, { attr: "reason", power: "Barrier" }, { attr: "reason", power: "Matter Control" }, { attr: "reason", power: "Transformation" }, { attr: "reason", power: "Telekinesis" }] },
      { id: "rescueBystanders", options: [{ attr: "agility" }] },
    ],
  },
};

/* book 2889: the toxin of a Toxic Accident: an unprotected hero rolls STRENGTH at the start of their turn and loses the full action of
   the round on a failure. */
export const toxinOutcome = (sixes) => ({ losesFullAction: !(sixes > 0) });
