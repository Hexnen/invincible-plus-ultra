/* Rules library: stunt legality and stunt numbers. Pure ES module, no Foundry globals.
   "book N" = line N of dev/book-dump.txt; "ruling N" = row N of section 4 of dev/combat-plan.md. */

/* Stunt ids. multi = may be chosen several times (book 2437, 2518); every other stunt once per target (book 2433, 2515).
   gm = needs the GM's word (book 2441-2442, 2521-2522). */
export const STUNTS = {
  doubleDamage: { multi: false },
  knockback: { multi: false },
  stun: { multi: false },
  bangHeads: { multi: true },
  trap: { multi: false },
  disarm: { multi: false },
  deadlyHit: { multi: false },
  slam: { multi: false },
  suppressed: { multi: false },
  trickShot: { multi: true },
  special: { multi: true, gm: true },
  own: { multi: true, gm: true },
};

/* which stunts each kind of attack offers at all
   slugfest        book 2433-2442
   counterattack   book 2448 + ruling 4: a normal slugfest attack, stunts as usual
   charge          book 2493: only Double Damage and Slam
   grapple         ruling 5 (book example 2505): the grapple that takes hold gives no damage and no stunts
   grappleAttack   book 2497: only Double Damage
   shooting        book 2515-2522
   snare           book 1606: no shooting stunts with the Snare power */
export const STUNTS_BY_ATTACK = {
  slugfest: ["doubleDamage", "knockback", "stun", "bangHeads", "trap", "disarm", "deadlyHit", "special", "own"],
  counterattack: ["doubleDamage", "knockback", "stun", "bangHeads", "trap", "disarm", "deadlyHit", "special", "own"],
  charge: ["doubleDamage", "slam"],
  grapple: [],
  grappleAttack: ["doubleDamage"],
  shooting: ["doubleDamage", "suppressed", "trickShot", "disarm", "deadlyHit", "special", "own"],
  snare: [],
};

/* book 2501: stunts that cannot be used against huge creatures */
export const HUGE_IMMUNE = ["knockback", "stun", "slam", "suppressed", "deadlyHit"];

/* Immunity flags. A target is not "huge or not": different things give different parts of the huge-creature rules.
   huge        book 2499-2503: the five stunts above, grappling (2502) and action banter (2503); attacks elevated targets in slugfest (2500)
   grown       book 1975 (Size Alteration, grown): grappling and the stunts Knockback and Slam only; attacks elevated targets in slugfest.
               (The limit Grow Only, book 1980, can make a hero "always huge"; the book does not say whether that is the huge-creature
               designation of 2499: the caller passes the flag the GM settles on.)
   impervious  book 1888 (Protection boost Impervious): the Deadly Hit stunt
   Ids used in the lists: stunt ids, "grapple", "banter". A target is plain data { huge?, grown?, impervious?, immune?: [id...] }:
   the booleans add their set, `immune` adds single ids (a power or an adventure that says so). */
export const IMMUNITY_SETS = {
  huge: [...HUGE_IMMUNE, "grapple", "banter"],
  grown: ["grapple", "knockback", "slam"],
  impervious: ["deadlyHit"],
};
export function immunitiesOf(target = {}) {
  const out = new Set(Array.isArray(target?.immune) ? target.immune : []);
  for (const [flag, list] of Object.entries(IMMUNITY_SETS)) if (target?.[flag]) for (const id of list) out.add(id);
  return [...out];
}
export const isImmune = (target, what) => immunitiesOf(target).includes(what);
/* book 2500, 1975, 2429: who reaches an elevated target from the ground in slugfest (feeds zones.mjs slugfestReach opts.reachesElevated) */
export const reachesElevated = (attacker = {}) => !!(attacker?.huge || attacker?.grown || attacker?.reachesElevated);
/* book 2435, 2437, 2440: Deadly Hit combines with neither Knockback nor Bang Heads */
export const EXCLUSIVE = [["deadlyHit", "knockback"], ["deadlyHit", "bangHeads"]];

/* Legality of each stunt for one target.
   ctx: { attack, target: { huge?, grown?, impervious?, immune?: [...] } (immunity flags above), sharp, zoneEmpty, movementLeft, otherOpponents,
          targetHoldsItem, chosen: [ids already chosen for this target] }
     sharp            the weapon or power deals sharp damage (book 2440, 2520, 2706)
     zoneEmpty        book 2438: no Trap in a completely empty zone
     movementLeft     book 2494: Slam needs movement left after the point of attack
     otherOpponents   number of further opponents in the target's zone (Bang Heads book 2437, Trick Shot book 2518)
     targetHoldsItem  Disarm needs an item in the target's grasp (book 2439, 2519)
   Returns [{ id, ok, reason, gm }] for every stunt this attack offers. Reasons: "huge" (a huge creature) | "immune" (any other immunity
   flag) | "sharp" | "emptyZone" | "noMovement" | "noOtherTarget" | "noItem" | "chosen" | "exclusive". */
export function stuntOptions(ctx) {
  const list = STUNTS_BY_ATTACK[ctx.attack];
  if (!list) throw new Error(`stuntOptions: unknown attack "${ctx.attack}"`);
  const chosen = ctx.chosen ?? [];
  const immune = immunitiesOf(ctx.target ?? {});
  return list.map((id) => {
    const def = STUNTS[id];
    let reason = null;
    if (ctx.target?.huge && HUGE_IMMUNE.includes(id)) reason = "huge";
    else if (immune.includes(id)) reason = "immune";
    else if (id === "deadlyHit" && !ctx.sharp) reason = "sharp";
    else if (id === "trap" && ctx.zoneEmpty) reason = "emptyZone";
    else if (id === "slam" && !(ctx.movementLeft > 0)) reason = "noMovement";
    else if ((id === "bangHeads" || id === "trickShot") && !(ctx.otherOpponents - chosen.filter((c) => c === id).length > 0)) reason = "noOtherTarget";
    else if (id === "disarm" && ctx.targetHoldsItem === false) reason = "noItem";
    else if (!def.multi && chosen.includes(id)) reason = "chosen";
    else if (EXCLUSIVE.some(([a, b]) => (id === a && chosen.includes(b)) || (id === b && chosen.includes(a)))) reason = "exclusive";
    return { id, ok: reason === null, reason, gm: !!def.gm };
  });
}

/* Validate a whole selection. picks: [{ stunt, target }] (target = id of the character the stunt is applied to); sixes = 6s that count
   for the attacker after the defence; ctxFor(target) -> the stuntOptions context of that target (without `chosen`).
   book 2433, 2515: one stunt per 6 beyond the first, each stunt once per target; book 2437, 2518: further stunts are applied to each
   target separately; book 2542 + ruling 14: with an area attack the stunts are distributed among the targets that were hit.
   targets (optional, area and full-auto attacks): the `targets` list of attack.mjs resolveAreaAttack, [{ id, hit, stuntsMax }]. With it
   the per-target cap is checked too: a stunt on a target that was not hit (or is not on the list) gives "notHit", and more stunts on one
   target than its own stuntsMax (the 6s left after its dodge, minus the one that hits) give "targetBudget" (reading 10 of CONTRACT.md,
   assumption A-3 of the spec). `sixes` stays the attacker's 6s: the shared pool is sixes - 1.
   Returns { ok, errors: [{ index, reason }], budget, used, perTarget: { [target]: { used, max } } } (max null without `targets`). */
export function validateStunts({ picks, sixes, ctxFor, targets = null }) {
  const budget = Math.max(0, sixes - 1);
  const errors = [];
  const chosen = new Map();
  const caps = targets ? new Map(targets.map((t) => [t.id, t])) : null;
  picks.forEach((p, index) => {
    const prev = chosen.get(p.target) ?? [];
    const opt = stuntOptions({ ...ctxFor(p.target), chosen: prev }).find((o) => o.id === p.stunt);
    const cap = caps?.get(p.target);
    if (!opt) errors.push({ index, reason: "notOffered" });
    else if (!opt.ok) errors.push({ index, reason: opt.reason });
    else if (caps && !cap?.hit) errors.push({ index, reason: "notHit" });
    else if (caps && prev.length >= (cap.stuntsMax ?? 0)) errors.push({ index, reason: "targetBudget" });
    chosen.set(p.target, [...prev, p.stunt]);
  });
  if (picks.length > budget) errors.push({ index: budget, reason: "budget" });
  const perTarget = {};
  for (const [id, list] of chosen) perTarget[id] = { used: list.length, max: caps ? (caps.get(id)?.hit ? caps.get(id).stuntsMax ?? 0 : 0) : null };
  return { ok: errors.length === 0, errors, budget, used: picks.length, perTarget };
}

/* ------------------------------------------------------------------ numbers ------------------------------------------------------------------ */

const half = (n) => Math.ceil(n / 2);

/* book 2435, 2444: Knockback distance, and its damage on hitting a barrier, = half the attacker's base STRENGTH rounded up (not the
   Slugfest Damage, so Strike or Emanation do not add). Barrier handling: zones.mjs forcedMove with decay 1. */
export const knockbackDistance = (strength) => half(strength);
/* book 2437, 2444: each additional target of Bang Heads takes half base STRENGTH rounded up */
export const bangHeadsDamage = (strength) => half(strength);
/* book 2494: Slam damage on hitting a barrier = half STRENGTH rounded up. Barrier handling: zones.mjs forcedMove with decay 0.
   ruling 7a: the direction is not a choice, the target is pushed further along the charge route. */
export const slamDamage = (strength) => half(strength);
/* book 2518: each additional target of Trick Shot takes the base Damage of the weapon or power */
export const trickShotDamage = (baseDamage) => baseDamage;

/* book 2436, 2517 (Stun, Suppressed): if the target took any damage it makes an immediate PRESENCE roll (no action); on a failure it
   misses its next turn and cannot perform interrupt actions until then (ruling 10: the nearest coming turn is lost).
   Returns { rollNeeded, losesTurn }. presenceSixes may be omitted to learn only whether a roll is needed. */
export function stunOutcome({ taken, presenceSixes = null }) {
  if (!(taken > 0)) return { rollNeeded: false, losesTurn: false };
  return { rollNeeded: true, losesTurn: presenceSixes == null ? null : !(presenceSixes > 0) };
}

/* book 2543: full auto: -1 die for each target beyond the first; all targets in the same zone. */
export const fullAutoDice = (targets) => -Math.max(0, targets - 1);
