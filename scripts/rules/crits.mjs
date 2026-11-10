/* Rules library: critical injuries, broken characters, rallying, stabilising. Pure ES module, no Foundry globals, no dice rolled here:
   the D6 is an input. Only numbers and ids are stored (the injury texts live in the game system's table).
   "book N" = line N of dev/book-dump.txt; "ruling N" = row N of section 4 of dev/combat-plan.md. */

const FAS = ["fighting", "agility", "strength"];
const RIP = ["reason", "intuition", "presence"];
const pen = (list, n) => Object.fromEntries(list.map((a) => [a, n]));

/* book 2716-2767: the table. pen = dice removed from rolls of that attribute until healed.
   deferred = the penalty starts only after the unconsciousness / immobility / coma has passed (9, 10, 11).
   heal: "hours" | "days" | "weeks" | "months" | null. dying: time left to be stabilised ("hours" | "minutes"). */
export const CRIT_TABLE = [
  null,
  { n: 1, id: "torn-suit", pen: {}, heal: null },
  { n: 2, id: "bruised", pen: pen(FAS, 2), heal: "hours" },
  { n: 3, id: "bloodied", pen: pen(RIP, 2), heal: "hours" },
  { n: 4, id: "beaten-up", pen: pen(FAS, 2), heal: "days" },
  { n: 5, id: "concussed", pen: pen(RIP, 2), heal: "days" },
  { n: 6, id: "battered", pen: pen(FAS, 2), heal: "weeks" },
  { n: 7, id: "crushed-arm", pen: pen(FAS, 2), heal: "weeks", armUnusable: true },
  { n: 8, id: "crushed-leg", pen: pen(FAS, 1), heal: "weeks", groundMoveFullAction: true },
  { n: 9, id: "cracked-skull", pen: pen(RIP, 2), heal: "weeks", unconscious: true, deferred: true },
  { n: 10, id: "crushed", pen: pen(FAS, 2), heal: "months", dying: "hours", deferred: true },
  { n: 11, id: "skewered", pen: { ...pen(FAS, 2), ...pen(RIP, 2) }, heal: "months", dying: "minutes", deferred: true },
  { n: 12, id: "head-crushed", pen: {}, heal: null, dead: true },
  { n: 13, id: "torn-apart", pen: {}, heal: null, dead: true },
];
export const MAX_CRIT = 13;          // book 2764: 13 or more is the last row
export const FAMILY_CAP = 9;         // book 2769: optional cap, every result of 9 or more is the 9

/* book 2440, 2520, 2706: Deadly Hit adds the damage inflicted to the D6, at most +6. */
export const DEADLY_HIT_MAX_BONUS = 6;
export const deadlyHitBonus = (taken) => Math.min(DEADLY_HIT_MAX_BONUS, Math.max(0, taken));

/* Resolve one crit roll. input: { d6, bonus, prior: [n...] (numbers of the crits already suffered), cap }.
   book 2707 D6 + bonus; 2709 +1 for each previous crit, and a result equal to or lower than the worst crit already suffered becomes one
   step worse than that crit (the book's example: battered (6), a 3 becomes 4, shifted to 7); 2764 13+ is one row; 2769 optional cap.
   Returns { roll, n, entry, shifted }. */
export function resolveCrit({ d6, bonus = 0, prior = [], cap = MAX_CRIT }) {
  const roll = d6 + bonus + prior.length;
  let n = roll, shifted = false;
  if (prior.length) {
    const worst = Math.max(...prior);
    if (n <= worst) { n = worst + 1; shifted = true; }
  }
  n = Math.max(1, Math.min(MAX_CRIT, n, cap));
  return { roll, n, entry: CRIT_TABLE[n], shifted };
}

/* Which crit roll, if any, a hit causes. input: { taken (damage after Armor), healthBefore, deadlyHit, target }.
   target: { kind: "hero" | "majorNpc" | "npc" | "minions" | "vehicle", huge?: boolean }.
   book 2707 dropping to 0 Health = broken: roll with the damage in excess of what was needed (example 2792: 7 damage at Health 3 = +4);
   book 2708 damage while already broken, even 1 point: another crit with the whole damage added;
   book 2440/2520 Deadly Hit: a crit when the attack causes damage, bonus = damage up to +6, never against huge creatures;
   ruling 9: Deadly Hit and breaking with the same blow = ONE roll with the higher of the two bonuses (the same is applied when a Deadly
   Hit lands on an already broken target: one roll, higher bonus);
   book 2771 ordinary NPCs: no crit needed, the GM states knocked out or killed; major NPCs roll like heroes;
   book 2828 minions never roll crits; book 3159 vehicles never do.
   Returns { broken (is at 0 Health after the hit), newlyBroken, crit: null | { bonus, cause }, gmChoice } where cause is
   "broken" | "whileBroken" | "deadlyHit" and gmChoice is true when an ordinary NPC was broken (knocked out or killed, GM decides). */
export function critForHit({ taken, healthBefore, deadlyHit = false, target = {} }) {
  const kind = target.kind ?? "hero";
  const wasBroken = healthBefore <= 0;
  const newlyBroken = !wasBroken && taken > 0 && taken >= healthBefore;
  const out = { broken: wasBroken || newlyBroken, newlyBroken, crit: null, gmChoice: false };
  if (taken <= 0 || kind === "minions" || kind === "vehicle") return out;
  const rollsCrits = kind === "hero" || kind === "majorNpc";
  const deadly = deadlyHit && !target.huge ? deadlyHitBonus(taken) : null;
  if (!rollsCrits) {
    out.gmChoice = newlyBroken || wasBroken;
    if (deadly != null && !out.gmChoice) out.crit = { bonus: deadly, cause: "deadlyHit" };
    return out;
  }
  if (wasBroken) out.crit = { bonus: Math.max(taken, deadly ?? 0), cause: "whileBroken" };
  else if (newlyBroken) {
    const excess = taken - healthBefore;
    out.crit = deadly != null && deadly > excess ? { bonus: deadly, cause: "deadlyHit" } : { bonus: excess, cause: "broken" };
  } else if (deadly != null) out.crit = { bonus: deadly, cause: "deadlyHit" };
  return out;
}

/* book 2709: modifiers of several crits to the same attribute do not add up: only the worst counts. crits: [n...].
   opts.includeDeferred false (default) leaves out penalties that start only after recovery (9-11): those characters are out of action
   anyway. Returns the number of dice to remove (0, 1 or 2). */
export function critPenalty(crits, attr, opts = {}) {
  let worst = 0;
  for (const n of crits) {
    const e = CRIT_TABLE[Math.min(MAX_CRIT, n)];
    if (!e || (e.deferred && !opts.includeDeferred)) continue;
    const p = e.pen[attr] ?? 0;
    if (p > worst) worst = p;
  }
  return worst;
}

/* What the crits do to a character. crits: [n...].
   book 2749 (9) unconscious; 2753 (10) dies unless stabilised within hours; 2757 (11) within minutes; 2761-2765 (12, 13) dead;
   2745 (8) ground movement is a full action; 2741 (7) one arm unusable; 2773 no rallying with a 9 or worse.
   Returns { unconscious, dying: null | "hours" | "minutes", dead, canRally, groundMoveFullAction, armUnusable }. */
export function critState(crits) {
  const s = { unconscious: false, dying: null, dead: false, canRally: true, groundMoveFullAction: false, armUnusable: false };
  for (const n of crits) {
    const e = CRIT_TABLE[Math.min(MAX_CRIT, n)];
    if (!e) continue;
    if (e.unconscious) s.unconscious = true;
    if (e.dying && s.dying !== "minutes") s.dying = e.dying;
    if (e.dead) s.dead = true;
    if (e.groundMoveFullAction) s.groundMoveFullAction = true;
    if (e.armUnusable) s.armUnusable = true;
    if (e.n >= 9) s.canRally = false;
  }
  return s;
}

/* book 2707: while broken a character is out of action: no movement, no attribute rolls, no powers. The only thing a broken character
   may attempt is to rally (book 2773). */
export const BROKEN_ALLOWED = ["rally"];

/* Rallying (book 2773-2775): only when broken and without a 9+ crit; a full action on the broken character's own turn with a PRESENCE
   roll, or another character who can communicate with them rolls PRESENCE instead; 1 Health back per 6; the crit stays.
   Returns { ok, reason } for the attempt. */
export function canRally({ broken, crits = [] }) {
  if (!broken) return { ok: false, reason: "notBroken" };
  if (!critState(crits).canRally) return { ok: false, reason: "crit" };
  return { ok: true, reason: null };
}
export function rallyOutcome({ sixes, maxHealth }) {
  const health = Math.min(maxHealth, Math.max(0, sixes));
  return { rallied: health > 0, health };
}

/* Stabilising (book 2777, 2359): REASON roll, a full action, needs advanced medical gear (certain powers also stabilise), one attempt only.
   Returns { ok, reason } for the attempt and the outcome of the roll. */
export function canStabilize({ crits = [], attempted = false, hasGear = false, power = false }) {
  const s = critState(crits);
  if (s.dead || !s.dying) return { ok: false, reason: "notDying" };
  if (attempted) return { ok: false, reason: "alreadyTried" };
  if (!hasGear && !power) return { ok: false, reason: "gear" };
  return { ok: true, reason: null };
}
export const stabilizeOutcome = (sixes) => ({ stabilized: sixes > 0 });
