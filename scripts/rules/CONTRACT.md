# Rules library contract (`scripts/rules/`)

Package P0 of the tactical combat plan (`dev/combat-plan.md`, section 5.5, row "Biblioteka zasad").

## What it is

Pure ES modules that implement the Invincible combat rules as functions. No Foundry globals, no imports from outside this folder, no
`Math.random`, no state kept between calls. The library never rolls dice for live play: Foundry rolls, the library computes pools,
legality, outcomes from the dice it is given, and exact probabilities. Where the book asks for a random choice the function takes
`rng`, a function returning a number in `[0, 1)`.

Nothing here is registered in `module.json` or imported by the running module yet.

## Conventions

- Every rule function carries a comment with its basis: `book N` = line N of `dev/book-dump.txt`, `ruling N` = row N of section 4 of
  `dev/combat-plan.md`. A function without either is a helper, not a rule.
- "Reading:" in a comment marks a choice the text leaves open. All of them are listed at the end of this file.
- The rulebook text is private: code and docs hold numbers, ids and short paraphrases only.
- Inputs are plain data; functions do not modify them and return new plain objects.
- Legality checks return `{ ok, reason }` with a short machine id as reason (the interface greys the option out and shows the reason;
  `gmMayAllow: true` marks the cases where the plan gives the GM a way in).
- Attributes are lower-case ids: `fighting`, `agility`, `strength`, `reason`, `intuition`, `presence`.
- Dice modifiers are lists `[{ source, dice }]` to feed into `dice.buildPool`.

## Tests

Node only, no Foundry, no browser:

```
node scripts/rules/check-all.mjs
```

runs every `check-*.mjs` in one process and exits 1 on any failure. Each file also runs alone (`node scripts/rules/check-zones.mjs`).
`check-pure.mjs` guards the purity rules above.

## Zone graph (input data shape)

The map module supplies this shape; the library does not import map code.

```
ZoneGraphData = { zones: Zone[] | { [id]: Zone }, borders: Border[] }

Zone = {
  id,                    // stable key
  level?: number,        // floor index, informational (0 = ground floor; below ground negative). Floors of a large building are
                         // separate zones joined by borders (stairs), so distance needs no extra rule for them.
  terrain?: "office" | "warehouse" | "street" | "woods" | "building" | "cliffs" | null,   // wrecking table; anything else cannot be wrecked
  rooftop?: boolean,     // a city-map building: its top is an elevated position and flyers pass over it
  empty?: boolean,       // completely empty zone (no Trap stunt)
  wrecked?: boolean,     // already wrecked in this scene
  flammable?: boolean    // holds something that burns (fire spreading)
}

Border = {
  id?,                   // stable key (default "b<index>")
  a, b,                  // zone ids
  wall: null | { armor: number, state: "intact" | "breached" | "removed" },
  door: null | { armor: number, state: "open" | "closed" | "locked" | "sealed" | "breached" }
}

Position = { zone: id, alt: "ground" | "elevated" | "sky" | "orbit" }
```

- No wall, or a wall that is breached or removed: an open border.
- Intact wall without a door: blocked.
- Intact wall with a door: passable when the door is open, closed (unlocked) or breached; blocked when locked or electronically sealed.
- `sky` and `orbit` are off the map: `zone` is ignored there.
- `zones.makeGraph(data)` validates and returns `{ zones: Map, borders, adj: Map }`; every other zone function takes that graph.

Two distances (ruling 23):

- **range** (`borderDistance`, `rangeDistance`, `zonesInRange`): counts borders on the shortest route, blocked ones included.
- **movement** (`moveRoute`, `moveDistance`, `zonesReachable`): passable borders only, by movement profile `{ aerial?, through? }`.

## Modules and exports

### `dice.mjs`
`SUCCESS`, `BANE`, `seededRng(seed)`, `d6(rng)`, `poolSize(n)`, `buildPool(base, mods)`, `tally(dice)`, `rerollable(dice)`,
`applyPush(dice, rerolled, opts)`, `canPush(ctx)`, `OPPOSED_PUSH_ORDERS`, `opposed(activeSixes, passiveSixes)`, `stuntCount(sixes)`,
`HELP_MAX`, `HELP_MAX_MINIONS`, `helpDice(helpers, opts)`, `binomial(n, p)`, `sixesPmf(pool, policy)`, `pAtLeast(pool, need, policy)`,
`pSuccess(pool, policy)`, `expectedPushStress(pool, given)`, `opposedOdds(attackPool, defencePool, push)`, `pHit(attackPool, defencePool, push)`.

Push policies for odds: `"never"`, `"always"`, `"onFail"` (ruling 3 order "beforeDefence"), `"ifLosing"` (ruling 3 order "afterDefence").

### `zones.mjs`
`ALTITUDES`, `WALL_STATES`, `DOOR_STATES`, `isOffMap(alt)`, `BARRIER_ARMOR`, `WRECK_TABLE`, `makeGraph(data)`, `borderOpen(border)`,
`borderImpedesTalk(border)`, `bordersBetween(graph, a, b)`, `borderBetween(graph, a, b)`, `borderDistance(graph, a, b)`,
`rangeDistance(graph, posA, posB)`, `zonesInRange(graph, zone, n)`, `hasRooftop(zone)`, `moveRoute(graph, from, to, profile)`,
`moveDistance(graph, from, to, profile)`, `zonesReachable(graph, zone, n, profile)`, `straightRoute(graph, from, to)`,
`altitudeChangeCost(fromAlt, toAlt)`, `slugfestReach(graph, attacker, target, opts)`, `MIN_RANGE_PENALTY`, `shootingRange(distance, range)`,
`canShoot(graph, attacker, target, range)`, `canCommunicate(graph, a, b, opts)`, `canBreach(strength, armor)`, `breachOptions(border)`,
`breachOutcome({ strength, armor, sixes, crashing })`, `wreckCheck(zone, strength)`, `forcedMove(graph, { path, distance, damage, targetArmor, decay, elements })`.

### `initiative.mjs`
`BASE_DECK`, `deckSize(draws)`, `newDeck(size)`, `shuffle(rng, cards)`, `isSurprised(intuitionSixes)`, `dealRound(rng, draws, opts)`,
`sortOrder(entries)`, `holdOffTargets(order, id)`, `holdOff(order, id, partnerId)`, `REDRAW_MODES`.

### `crits.mjs`
`CRIT_TABLE`, `MAX_CRIT`, `FAMILY_CAP`, `DEADLY_HIT_MAX_BONUS`, `deadlyHitBonus(taken)`, `resolveCrit({ d6, bonus, prior, cap })`,
`critForHit({ taken, healthBefore, deadlyHit, target })`, `critPenalty(crits, attr, opts)`, `critState(crits)`, `BROKEN_ALLOWED`,
`canRally({ broken, crits })`, `rallyOutcome({ sixes, maxHealth })`, `canStabilize({ crits, attempted, hasGear, power })`, `stabilizeOutcome(sixes)`.

Crits are passed as arrays of table numbers (`[6, 2]`).

### `damage.mjs`
`BODY_ARMOR`, `selectArmor(sources)`, `barrierBreached(source, taken)`, `hitDamage({ base, pulled, doubled, armor, ignoreArmor, source, immunities, vulnerabilities })`,
`baseHealth(attrs)`, `baseResolve(attrs)`, `applyDamage({ health, taken })`, `applyStress({ resolve, stress })`, `canTakeVoluntaryStress(resolve)`,
`recoverResolve({ resolve, max, sixes })`, `recoverAfterScene({ ... })`.

Damage sources are free strings; `"kinetic"` is the default and `"nonKinetic"` in `immunities` means every other source.

### `stunts.mjs`
`STUNTS`, `STUNTS_BY_ATTACK`, `HUGE_IMMUNE`, `EXCLUSIVE`, `stuntOptions(ctx)`, `validateStunts({ picks, sixes, ctxFor })`, `knockbackDistance(strength)`,
`bangHeadsDamage(strength)`, `slamDamage(strength)`, `trickShotDamage(baseDamage)`, `stunOutcome({ taken, presenceSixes })`, `fullAutoDice(targets)`.

Stunt ids: `doubleDamage`, `knockback`, `stun`, `bangHeads`, `trap`, `disarm`, `deadlyHit`, `slam`, `suppressed`, `trickShot`, `special`, `own`.

### `attack.mjs`
`ATTACKS`, `DEFENCES`, `restrained(target)`, `UNAWARE_BONUS`, `attackModifiers({ ... })`, `defenceOptions({ attack, defender, inChase })`,
`resolveAttack({ attack, attackSixes, defence, defenceSixes })`, `resolveAreaAttack({ attackSixes, targets })`, `chargeCheck({ ... })`,
`chargeEndZone(zone)`, `grappleCheck({ targetHuge, usesWeapon })`, `GRAPPLER_ACTIONS`, `HELD_ACTIONS`.

Attack ids: `slugfest`, `charge`, `grapple`, `grappleAttack`, `counterattack`, `shooting`, `ram`.
Target conditions: `held`, `snared`, `trapped`, `unaware`, `noInterrupts`, `carriedAloft`, `hasQuick`.

### `maneuvers.mjs`
`ESCAPES`, `SNARE_ESCAPE_DICE`, `escapeOutcome({ kind, sixes, holderSixes })`, `BANTER`, `banterCheck({ ... })`, `banterStress(sixes, targetSixes)`,
`ORDERS`, `ordersBonus(sixes)`, `helpCheck({ helpers, minions })`, `fastballCheck({ throwerStrength, thrownStrength, friendly })`,
`carryCheck({ ... })`, `carryEndsAloft(endAlt)`, `MINION_ATTACK_SIZE`, `minionAttacks(count)`, `splitMinions(count, max)`, `minionDamage({ members, taken })`.

### `hazards.mjs`
`FIRE_DAMAGE_PER_SIX`, `firePool(intensity)`, `fireDamage(sixes)`, `fireAttackDue({ when, inBurningZone, burning })`, `fireOutcome({ ... })`,
`EXTINGUISH`, `extinguishOutcome(sixes)`, `fireSpreadRoll(d6)`, `fireSpreadTargets(graph, zone, burning)`, `pickFireSpread(rng, graph, zone, burning)`,
`fallDice(fromAlt)`, `fallOutcome({ dice, agilitySixes, canGrab, immune })`, `blastDamage(rating)`, `blastPool(rating)`,
`blastOutcome({ rating, sixes, targets }, rng)`, `VACUUM_PROTECTION`, `vacuumDice(roundOfExposure)`, `vacuumOutcome(sixes)`, `DISEASE`,
`diseaseDice(virulence)`, `diseaseStep({ state, sixes, broken })`.

### `weapons.mjs`
`WEAPONS`, `VEHICLE_WEAPONS`, `weaponProfile(weapon)`, `isRanged(profile)`, `usesLeft(profile, used)`, `noMovementCheck(profile, { movedThisRound })`.

### `vehicles.mjs`
`VEHICLES`, `VEHICLE_ACTIONS`, `HANDLE_ATTR`, `vehicleMoveZones(vehicle)`, `ramProfile({ agility, vehicle })`, `canRamVehicle(ownMax, targetMax)`,
`vehicleHit({ durability, max, armor, amount, componentHits })`, `COMPONENT_DAMAGE`, `componentDamage(d6, ctx)`, `ramOccupantDamage({ wrecked, taken })`,
`crashFallDice({ type, alt, wrecked })`, `repairOutcome({ durability, max, sixes })`, `weaponMayTarget(profile, targetClass)`.

### `chase.mjs`
`CHASE_END_DISTANCE`, `CHASE_PUSH_ORDER`, `CHASE_ROUND`, `chaseModifier(ownSpeed, otherSpeed)`, `chaseModifiers({ ... })`, `chaseRoll({ ... })`,
`CHASE_OBSTACLES`, `chaseObstacle(tens, ones)`, `applyObstacle({ obstacle, distance, results })`, `chaseRoller(members)`, `chaseAdvance(positions, sixes)`.

### `challenge.mjs`
`OBJECTIVE_ACTION`, `makeChallenge(def)`, `challengeSeverity(ch)`, `objectiveAvailable(option, hero)`, `applyObjectiveRoll(ch, sixes)`, `endOfRound(ch)`,
`EFFECT_TIMES`, `wardReset(ch)`, `wardRested(ch)`, `BOOK_CHALLENGES`, `toxinOutcome(sixes)`.

### `index.mjs`
Re-exports every module as a namespace: `import { zones, dice } from "./rules/index.mjs"`.

## Rulings of plan section 4 and where they live

| Ruling | Where |
|---|---|
| 1 Quickness: extra action, no extra card | `initiative.mjs` header (no card logic for it; the action grant is the action ledger's, P1) |
| 2 range to elevated targets, sky and orbit | `zones.rangeDistance`, `zones.slugfestReach` |
| 3 push order in opposed rolls | `dice.OPPOSED_PUSH_ORDERS`, `dice.opposedOdds` policies, `dice.canPush({ opposedDefender })` |
| 4 counterattack | `attack.resolveAttack`, `attack.defenceOptions`, `stunts.STUNTS_BY_ATTACK.counterattack` |
| 5 first grapple | `attack.resolveAttack` (no stunts), `stunts.STUNTS_BY_ATTACK.grapple`; no damage is the caller's (it applies none) |
| 6 held target | `attack.defenceOptions`, `attack.attackModifiers` |
| 7 Knockback direction, 7a Slam direction | `zones.forcedMove` takes the path; who chooses it is the engine's (P4) |
| 8 Knockback into barriers | `zones.forcedMove` |
| 9 Deadly Hit + broken by the same blow | `crits.critForHit` |
| 10 lost turn | `stunts.stunOutcome`, `attack.defenceOptions({ defender.noInterrupts })`; the turn bookkeeping is P1 |
| 11 help without a free full action | `maneuvers.helpCheck` |
| 12 more than 10 combatants | `initiative.deckSize`, `initiative.dealRound` |
| 13 Barrier and own Armor | `damage.selectArmor`, `damage.barrierBreached` |
| 14 area attacks, full auto | `attack.resolveAreaAttack`, `stunts.validateStunts`, `stunts.fullAutoDice` |
| 15 objective roll costs a full action | `challenge.OBJECTIVE_ACTION` |
| 16 return from sky or orbit | not a rule function: a GM-approved choice (engine) |
| 17 banter | `maneuvers.BANTER`, `maneuvers.banterCheck`, `maneuvers.banterStress` |
| 18 Teleportation is a quick action only | action catalogue (not this package); `zones` offers `through: "any"` for its distance |
| 19 dodged charge | `attack.chargeEndZone`, `attack.chargeCheck` |
| 20 Trap | `stunts.stuntOptions` (empty zone), `attack.defenceOptions`, `maneuvers.ESCAPES.trap` |
| 21 Snare | `attack.restrained`, `attack.defenceOptions`, `maneuvers.ESCAPES.snare`, `maneuvers.SNARE_ESCAPE_DICE` |
| 22 challenge clock and side effects | `challenge.endOfRound`, `challenge.EFFECT_TIMES`, `BOOK_CHALLENGES[*].effects` |
| 23 range and walls | `zones` two distance families |
| 24 minions above 10 | `maneuvers.splitMinions`, `maneuvers.minionAttacks` |
| 25 chase pushes | `chase.CHASE_PUSH_ORDER` |

## Readings (choices the text leaves open; each is marked "Reading:" or explained in the code)

1. `dice.applyPush`: stress = every 1 showing after the push, 1s of the first roll included (the game system charges the same); `stressOnes: "new"` gives the other count.
2. `zones.borderImpedesTalk`: an intact wall impedes talking unless its door is open or breached.
3. `zones.canCommunicate`: adjacency is horizontal; ground and elevated characters of the same or neighbouring zones can talk.
4. `zones` aerial movement: a flyer crosses a blocked border when one of its two zones has a rooftop (book: flyers pass over buildings). A freestanding wall is not crossed.
5. `zones.slugfestReach`: the altitude difference counts as in ruling 2, so a range-1 attack (wrecking) reaches an elevated target in the attacker's own zone.
6. `zones.forcedMove`: a border is a barrier when it is not open for movement; the wall's Armor is used unless the caller names the door.
7. `damage.selectArmor`: on equal ratings the non-Barrier armor is used, so the Barrier is not spent. `barrierBreached`: only when the Barrier was the armor that counted and damage got through.
8. `damage.hitDamage`: Double Damage and Vulnerable both double (x4 together); a vulnerability wins over an immunity to the same source.
9. `crits.critForHit`: a Deadly Hit on a target that is already broken gives one roll with the higher bonus (ruling 9 applied by analogy).
10. `attack.resolveAreaAttack`: a target can only receive stunts paid for by 6s left after its own dodge.
11. `hazards.blastOutcome`: a dodge is the usual opposed roll; an extra 6 dealt to a target that dodged is lost.
12. `hazards.diseaseStep`: Armor does not reduce disease damage.
13. `chase.chaseRoll`: the prey is lost when the distance exceeds the end distance (5), not when it reaches it.
14. `challenge.wardReset`: the ward's three-round clock starts again after a reset.
15. `maneuvers.splitMinions`: the even split is a suggestion; the book lets the GM divide freely.
16. `vehicles.ramProfile`: ram damage uses the vehicle's Durability rating (its maximum), not the points left.
