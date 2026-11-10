/* Rules library: escapes, action banter, orders, helping, throwing and carrying allies, minions.
   Pure ES module, no Foundry globals. "book N" = line N of dev/book-dump.txt; "ruling N" = row N of section 4 of dev/combat-plan.md. */

import { opposed, helpDice, HELP_MAX, HELP_MAX_MINIONS } from "./dice.mjs";

/* ------------------------------------------------------------------ escapes ------------------------------------------------------------------ */

/* How each restraint is escaped.
   grapple  book 2496: opposed STRENGTH vs STRENGTH against the holder; a quick action for the one breaking free, no action for the holder
   trap     book 2438 (ruling 20): AGILITY or STRENGTH roll, quick action, not opposed
   snare    book 1606-1609 (ruling 21): STRENGTH roll with a penalty, FULL action, not opposed */
export const ESCAPES = {
  grapple: { attrs: ["strength"], action: "quick", opposedBy: "strength" },
  trap: { attrs: ["agility", "strength"], action: "quick", opposedBy: null },
  snare: { attrs: ["strength"], action: "full", opposedBy: null },
};
/* book 1606-1609: dice penalty to break free from Snare by power level */
export const SNARE_ESCAPE_DICE = { basic: -2, major: -3, massive: -4, monstrous: -5 };

/* Outcome of an escape attempt. input: { kind, sixes, holderSixes }. Returns { free }. A tie in the grapple contest fails (book 2243). */
export function escapeOutcome({ kind, sixes, holderSixes = 0 }) {
  const e = ESCAPES[kind];
  if (!e) throw new Error(`escapeOutcome: unknown restraint "${kind}"`);
  return { free: e.opposedBy ? opposed(sixes, holderSixes).win : sixes > 0 };
}

/* ------------------------------------------------------------------ action banter ------------------------------------------------------------------ */

/* book 2784-2785, 2503 + ruling 17: a quick action; opposed PRESENCE against PRESENCE at an opponent in the same zone; a character can
   be the target of banter only once per round; it typically does not work against huge creatures (the GM may allow it).
   input: { sameZone, targetHuge, targetBanteredThisRound, hasQuick }. Returns { ok, reason, gmMayAllow }. */
export const BANTER = { attr: "presence", defenceAttr: "presence", action: "quick" };
export function banterCheck({ sameZone, targetHuge = false, targetBanteredThisRound = false, hasQuick = true }) {
  if (!hasQuick) return { ok: false, reason: "noQuickAction", gmMayAllow: false };
  if (!sameZone) return { ok: false, reason: "zone", gmMayAllow: false };
  if (targetBanteredThisRound) return { ok: false, reason: "oncePerRound", gmMayAllow: false };
  if (targetHuge) return { ok: false, reason: "huge", gmMayAllow: true };
  return { ok: true, reason: null, gmMayAllow: false };
}
/* book 2785: 1 stress for each 6 more than the target rolled */
export const banterStress = (sixes, targetSixes) => opposed(sixes, targetSixes).net;

/* ------------------------------------------------------------------ orders and help ------------------------------------------------------------------ */

/* book 2296-2297: giving orders is a full action with a PRESENCE roll; the target must be able to hear (zones.mjs canCommunicate, a
   device or power counts); every 6 = +1 die to ONE roll of the target later in the same round, only for carrying out the order. */
export const ORDERS = { attr: "presence", action: "full" };
export const ordersBonus = (sixes) => Math.max(0, sixes);

/* book 2238, 2273 + ruling 11: at most three helpers (+1 die each) who can support the action concretely; in an action scene a helper
   pays with their full action of the round, spent on the helped character's turn whatever their own initiative. Without a free full
   action the interface refuses and the GM may accept anyway.
   input: { helpers: [{ id, hasFull }], minions }. Returns { dice, accepted: [id], refused: [{ id, reason, gmMayAllow }] }. */
export function helpCheck({ helpers, minions = false }) {
  const cap = minions ? HELP_MAX_MINIONS : HELP_MAX;
  const accepted = [], refused = [];
  for (const h of helpers) {
    if (h.hasFull === false) refused.push({ id: h.id, reason: "noFullAction", gmMayAllow: true });
    else if (accepted.length >= cap) refused.push({ id: h.id, reason: "tooMany", gmMayAllow: false });
    else accepted.push(h.id);
  }
  return { dice: helpDice(accepted.length, { minions }), accepted, refused };
}

/* ------------------------------------------------------------------ throwing and carrying allies ------------------------------------------------------------------ */

/* book 2389-2390 Fastball Special: a full action; a friendly character with LOWER STRENGTH is thrown a number of zones equal to the
   difference of the two STRENGTH scores; the throw may end at elevated altitude and may be part of the thrown character's charge.
   Returns { ok, reason, zones }. */
export function fastballCheck({ throwerStrength, thrownStrength, friendly = true }) {
  if (!friendly) return { ok: false, reason: "notFriendly", zones: 0 };
  if (!(thrownStrength < throwerStrength)) return { ok: false, reason: "strength", zones: 0 };
  return { ok: true, reason: null, zones: throwerStrength - thrownStrength };
}

/* book 2392 carrying: a flyer may carry ONE other character, who starts and ends the move in the flyer's zone; not together with a
   charge; if they stay airborne afterwards neither can attack, block or dodge until they have landed.
   input: { canFly, alreadyCarrying, sameZone, charging }. Returns { ok, reason }. */
export function carryCheck({ canFly, alreadyCarrying = false, sameZone = true, charging = false }) {
  if (!canFly) return { ok: false, reason: "cannotFly" };
  if (alreadyCarrying) return { ok: false, reason: "oneOnly" };
  if (!sameZone) return { ok: false, reason: "zone" };
  if (charging) return { ok: false, reason: "charge" };
  return { ok: true, reason: null };
}
/* book 2392: after a carry that ends airborne both are "carriedAloft" (see attack.mjs defenceOptions) until landing */
export const carryEndsAloft = (endAlt) => endAlt === "elevated";

/* ------------------------------------------------------------------ minions ------------------------------------------------------------------ */

/* book 2825-2831 + ruling 24.
   A group moves as one character and stays in one zone (2826); it has 1 Health per member and each point of damage removes one member,
   knocked out or killed as the GM chooses, never a crit (2828); one Resolve score for the group (2830); powers such as Snare or
   Telekinesis affect the group as one character (2829). */
export const MINION_ATTACK_SIZE = 10;

/* book 2827: each remaining minion may attack alone, or they attack together with the helping rule, +1 die per helper up to +9, so
   at most ten in one attack. Returns the attacks a group of `count` members makes when attacking together: [{ members, helpDice }]. */
export function minionAttacks(count) {
  const out = [];
  for (let left = Math.max(0, Math.floor(count)); left > 0; left -= MINION_ATTACK_SIZE) {
    const members = Math.min(MINION_ATTACK_SIZE, left);
    out.push({ members, helpDice: helpDice(members - 1, { minions: true }) });
  }
  return out;
}
/* book 2831 + ruling 24: more than ten minions are divided into several groups. Returns the sizes, as even as possible. */
export function splitMinions(count, max = MINION_ATTACK_SIZE) {
  const n = Math.max(0, Math.floor(count));
  if (n <= max) return n ? [n] : [];
  const groups = Math.ceil(n / max), base = Math.floor(n / groups), extra = n % groups;
  return Array.from({ length: groups }, (_, i) => base + (i < extra ? 1 : 0));
}
/* book 2828: damage to a group. Returns { members, removed, wiped }. */
export function minionDamage({ members, taken }) {
  const removed = Math.min(members, Math.max(0, taken));
  return { members: members - removed, removed, wiped: members - removed === 0 };
}
