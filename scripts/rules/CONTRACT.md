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
- Where the book is silent and no ruling exists, the choice is a parameter whose default is the provisional behaviour; every such
  parameter is in the table "Open questions as parameters" and in the readings list. None of them is settled here.
- Additions keep older calls working: no export was renamed or removed. The few changes of behaviour are listed under
  "Changes of behaviour".
- Attributes are lower-case ids: `fighting`, `agility`, `strength`, `reason`, `intuition`, `presence`.
- Dice modifiers are lists `[{ source, dice }]` to feed into `dice.buildPool`.

## Tests

Node only, no Foundry, no browser:

```
node scripts/rules/check-all.mjs
```

runs every check in one process and exits 1 on any failure. Each file also runs alone (`node scripts/rules/check-zones.mjs`).
`check-pure.mjs` guards the purity rules above.

`check-places.mjs` holds the place model. Its world (`check-places-world.mjs`: six zones with floors, rooftops, a wrecked building and
every kind of border; 46 places) is asked for range and for routes (walk, air, through) between every pair of places, 2116 pairs, and the
answers must equal `check-places-golden.mjs`: the answers of the real zones code of the map module on the same world, frozen.

```
node scripts/rules/check-parity-live.mjs [path of the moinen-maps tree]
```

is opt-in and not part of `check-all`: it imports the real zones code (read-only; tree from the argument, else the environment variable
`ZONES_TREE`, else `C:/mmwt-tactics`), builds the same world there, converts its zone and border data with `zones.graphFromZonesApi` and
compares places, range and routes live. Without that tree it says so and exits 0. `--golden` prints the frozen strings again; run it
when the zones contract changes its range or route rules.

## Positions and the zone graph (input data shapes)

One position model, the same as the zones API of the map module: a place is a zone plus a level; the floors of a building are levels
of ONE zone; sky, orbit, another dimension and a running chase are off-map areas. Live distances and routes come from the zones API;
`zones.rangeBetween` and `zones.routeBetween` give the same answers on the same data (see Tests) and exist for checks, simulation and
the encounter balancer. The library does not import map code.

```
ZoneGraphData = { zones: Zone[] | { [id]: Zone }, borders: Border[] }      // zones.graphFromZonesApi builds it from the zones API's data

Zone = {
  id,                    // stable key (the zones API's zone key)
  building?: boolean,    // a building: its top is an elevated position (rooftop) and it may have floors
  rooftop?: boolean,     // older name of the same flag; either one makes the zone a building
  floors?: number,       // floors above the ground floor, as LEVELS of this zone (0 = a plain building or open ground)
  terrain?: "office" | "warehouse" | "street" | "woods" | "building" | "cliffs" | null,   // wrecking table; anything else cannot be wrecked
  terrainUnset?: boolean,// terrain never set on the map: wreckCheck answers "terrainUnset" with gmMayAllow
  empty?: boolean,       // completely empty zone (no Trap stunt)
  wrecked?: boolean,     // already wrecked in this scene: no rooftop, no floors (book 2457)
  flammable?: boolean, water?: boolean,   // fire spreading
  level?: number         // informational only (kept for older data)
}

Border = {
  id?,                   // stable key (default "b<index>")
  a, b,                  // zone ids
  wall: null | { armor: number, state: "intact" | "breached" | "removed", outer?: boolean },
  door: null | { armor: number, state: "open" | "closed" | "locked" | "sealed" | "breached" }
}

Position, any of:
  "z3" | "z3:elevated" | "z3:underground" | "z3:f2" | "@sky" | "@orbit" | "@dimension" | "@chase"     // a spot string of the zones API
  { zone, level: "ground" | "elevated" | "underground" | "floor", floor?, airborne?, area? }          // a place of the zones API
  { zone, alt: "ground" | "elevated" | "underground" | "sky" | "orbit" | "dimension" | "chase", floor?, airborne? }   // the older form
  { area: "sky" | "orbit" | "dimension" | "chase" }

Place (what zones.toPlace returns) = { zone, area, level, floor, airborne, roof, spot }
```

- No wall, or a wall that is breached or removed: an open border.
- Intact wall without a door: blocked.
- Intact wall with a door: passable when the door is open, closed (unlocked) or breached; blocked when locked or electronically sealed.
- A string that names a zone of the graph is that zone, whatever characters it has; otherwise it is parsed as a spot.
- Elevated over a standing building is its rooftop unless `airborne` is set; over open ground or a wrecked building it is the air.
- A floor the building does not have (or lost when wrecked) reads as the ground.
- Off-map areas: `zone` is ignored; everybody in the same area shares one zone; there is no range and no route into or out of one.
- `zones.makeGraph(data)` validates and returns `{ zones: Map, borders, adj: Map }`; every other zone function takes that graph.
- An older graph that models every floor as a zone of its own still works with every function (floors are then borders).

Two distances (ruling 23):

- **range** (`rangeBetween`, `rangeDistance`, `borderDistance`, `zonesInRange`): borders on the shortest route, blocked ones included,
  plus the levels between the two places (ruling 2: a ground / elevated difference adds one, two elevated places add nothing, floors add
  one each, a rooftop is above the top floor from inside and one zone up from outside).
- **movement** (`routeBetween`, `moveRoute`, `moveDistance`, `zonesReachable`): passable borders only, by movement profile
  `{ aerial?, through?: "open" | "any", over?: "rooftop" | "exterior" }`; `routeBetween` adds the levels climbed. The profile matching
  the zones API's ways: walk `{}`, air `{ aerial: true, over: "exterior" }`, through `{ through: "any" }`. The ways `swim` and `swing`
  have no profile here (their zone rules are the map's, ZR-5).

Numbers instead of a graph: `slugfestReachAt` and `canCommunicateAt` take the zones API's `range(a, b)` result and the two places'
`level` / `area`, so the engine can ask them with live data and no graph.

## Modules and exports

### `dice.mjs`
`SUCCESS`, `BANE`, `seededRng(seed)`, `d6(rng)`, `poolSize(n)`, `buildPool(base, mods)`, `tally(dice)`, `rerollable(dice)`,
`applyPush(dice, rerolled, opts)`, `canPush(ctx)`, `OPPOSED_PUSH_ORDERS`, `opposed(activeSixes, passiveSixes)`, `stuntCount(sixes)`,
`HELP_MAX`, `HELP_MAX_MINIONS`, `HELP_DICE`, `HELP_DICE_SUPPORTIVE`, `helperDice(helper)`, `helpDice(helpers, opts)`, `binomial(n, p)`,
`sixesPmf(pool, policy)`, `pAtLeast(pool, need, policy)`, `pSuccess(pool, policy)`, `expectedPushStress(pool, given)`,
`opposedOdds(attackPool, defencePool, push)`, `pHit(attackPool, defencePool, push)`.

Push policies for odds: `"never"`, `"always"`, `"onFail"` (ruling 3 order "beforeDefence"), `"ifLosing"` (ruling 3 order "afterDefence").

`helpDice(helpers, opts)`: `helpers` is a number (as before: one die each) or a list `[{ id?, supportive?, dice? }]`; each helper gives
`helperDice` (1; 2 with Supportive; `dice` overrides). The cap (`HELP_MAX`, `HELP_MAX_MINIONS` with `opts.minions`) is on the NUMBER of
helpers; the largest contributions count.

### `zones.mjs`
Data: `ALTITUDES`, `LEVELS`, `AREAS`, `WALL_STATES`, `DOOR_STATES`, `BARRIER_ARMOR`, `WRECK_TABLE`, `BORDER_KINDS`, `MIN_RANGE_PENALTY`.

Graph and borders: `makeGraph(data)`, `graphFromZonesApi({ zones, borders })`, `borderOpen(border)`, `borderImpedesTalk(border)`,
`bordersBetween(graph, a, b)`, `borderBetween(graph, a, b)`, `hasRooftop(zone)`, `floorsOf(zone)`.

Positions: `isOffMap(alt)`, `parseSpot(string)`, `toPlace(graph, position)`, `sameSpot(graph, a, b)`, `heightOf(graph, position)`.

Range: `borderDistance(graph, zoneA, zoneB)`, `rangeBetween(graph, a, b) -> { borders, levels, total } | null`,
`rangeDistance(graph, a, b) -> number | Infinity`, `zonesInRange(graph, zone, n)`, `shootingRange(distance, range)`,
`canShoot(graph, attacker, target, range)`.

Movement: `moveRoute(graph, from, to, profile)`, `moveDistance(graph, from, to, profile)`, `zonesReachable(graph, zone, n, profile)`,
`straightRoute(graph, from, to)`, `routeBetween(graph, a, b, profile) -> { borders, levels, total } | null`,
`altitudeChangeCost(fromAlt, toAlt) -> "none" | "quick" | "full" | "gm"`.

Reach and talking: `slugfestReach(graph, attacker, target, opts)`, `slugfestReachAt(range, attacker, target, opts)`,
`canCommunicate(graph, a, b, opts)`, `canCommunicateAt(range, a, b, { link, impeded })`.

Barriers and terrain: `canBreach(strength, armor)`, `breachOptions(border)`, `breachOutcome({ strength, armor, sixes, crashing })`,
`wreckCheck(zone, strength)`, `forcedMove(graph, { path, distance, damage, targetArmor, decay, elements })`.

- `graphFromZonesApi`: `zones` as `api.zoneList()` gives them (`key, building, floors, terrain, empty, tags, states`), `borders` as
  `api.bordersOf` / `api.borderBetween` give them (`key, zones: [a, b], kind`, and where the map has them `wall: { armor, state, outer }`,
  `doorway: { armor, state }`). A border with its own `wall` / `doorway` is taken as it is; a one-kind border is translated with
  `BORDER_KINDS`. The wall around an older door mark has an ASSUMED Armor (interior wall) and carries `armorAssumed: true`.
- `slugfestReach*` reasons: `altitude` (an off-map area between them), `noRange`, `distance`, `elevated` (ground against elevated without
  `huge` / `reachesElevated`), `level` (another floor or underground). `opts: { range, huge, reachesElevated }`.
- `wreckCheck` reasons now include `terrainUnset` (with `gmMayAllow`).
- `passFor` profile option `over`: `"rooftop"` (default, reading 4) or `"exterior"` (the zones API's reading: over walls marked `outer`).

### `movement.mjs`
`TRAVEL_TIERS`, `MOVE_MODES`, `moveProfile(mode, { tier, speed, aerial })`, `moveConditions(profile, conditions)`,
`moveCost(distance, profile, { conditions, resolve, quickOnly })`, `movesNeeded(distance, profile)`, `moveReach(profile, { conditions, resolve })`,
`altitudeAccess(profile, to)`, `glidingCheck(fromHeight, toHeight)`, `ALTITUDE_HEIGHT`, `teleportAllies(others)` (added by P3, movement).

Prices a move whose length is a route's `total` (the zones API's `routeLength`, or `zones.routeBetween`).

- Modes: `walk`, `grown`, `earthDrift`, `iceSlide` (book 1651), `wings` (book 1956), `elongatedStride`, `burrowing`, `flight`, `leaping`, `superSpeed`, `teleportation`, `swimming`,
  `swinging`, and `"vehicle"` (needs `speed`). Tiers: `basic | major | massive | monstrous` for flight, leaping, super-speed and
  teleportation; `basic | fast` for swimming and swinging.
- `MoveProfile = { mode, way, zones, stressZones | null, stress: 1, actions: ["quick"] | ["quick", "full"], medium, assumed, ends?, vertical? }`;
  `way` is the zones contract's route kind (`walk | air | through | swim | swing`).
- Conditions (flags the caller sets for this move): `crushedLeg`, `afflicted`, `storm`, `highGravity`.
  `moveConditions -> { full: [conditions], roll: null | "strength", blocked: null | "noAerial", unsettled: [conditions] }`.
- `moveCost -> { ok, reason, gmMayAllow?, options: [{ action: "none" | "quick" | "full", stress: 0 | 1, zones }], roll, full, unsettled, onTurnOnly }`;
  reasons `noRoute`, `noAerial`, `tooFar` (more than one move action: see `movesNeeded`), `stressedOut`, `quickOnly`. Distance 0 is a move
  inside the zone: no action, own turn only. The stress option is listed only where the plain move does not reach.
- Not here: how many actions the mover has left and whether a full action may pay for a quick one (action economy, P1); the change
  to or from an off-map area (`zones.altitudeChangeCost`); where a way may end (`ends` is data for the caller).

### `conditions.mjs`
`COND_OPS`, `factOf(snapshot, path)`, `evalCond(cond, snapshot, opts)`, `evalConds(conds, snapshot, opts)`, `onlyNeedsGm(conds, snapshot, opts)`,
`evalModRules(rules, snapshot, opts)`, `modRules(rules, snapshot, opts)`, `validateCond(cond, at)`.

The evaluator of the action catalog's predicates (spec section 8). It holds no rule: the catalog writes the predicate next to its book
line, this module answers it against a read-only snapshot of plain data.

```
Cond = true | false | [Cond...]                      // a list = all
     | { all: [Cond...] } | { any: [Cond...] } | { not: Cond }
     | { fact: "path.to.value", op?, value? | ref?: "other.path" }
            // op: truthy (default) | falsy | eq (default with value / ref) | ne | gt | gte | lt | lte | in | has
     | { check: "name", args?: { key: value | { ref: "path" } } }      // opts.checks[name](args, snapshot) -> boolean | { ok, reason, gmMayAllow }
     | { gm: "id" }                                   // holds only when id is in opts.confirmed (Set | list | { id: true })
   every object form may carry `reason` and `gmMayAllow`

ModRule = { source, dice: n | { ref: "path", times?, min?, max? }, when?: Cond, attrs?: [attr], rolls?: [roll kind] }
```

- `evalCond -> { ok, reason, gmMayAllow, needsGm: [ids] }`; the reason is the first failing condition's (default: the fact path, the
  check's own reason or name, the gm id, `"not"`, `"none"`, `"never"`). A check nobody supplied fails with `unknownCheck`, `gmMayAllow`
  and `needsGm: ["check:name"]`. A malformed condition throws; `validateCond` reports faults without evaluating.
- `evalConds` (the `requires` / `filter` list of an entry): the same result plus `failed`, every failing condition's result in order.
- `onlyNeedsGm`: true when nothing but the GM's word stands between the failure and success.
- `evalModRules -> { mods: [{ source, dice }], pending: [{ source, dice, needsGm, reason }] }` with `opts: { attr, roll, checks, confirmed }`;
  `modRules` returns just `mods`, ready for `dice.buildPool`.
- A catalog entry names a check of this library by supplying it in `opts.checks`, e.g.
  `{ inRange: ({ from, to, range }) => zones.canShoot(graph, from, to, range) }`.

### `initiative.mjs`
`BASE_DECK`, `deckSize(draws)`, `newDeck(size)`, `shuffle(rng, cards)`, `isSurprised(intuitionSixes)`, `dealRound(rng, draws, opts)`,
`dealStart(rng, draws, opts)`, `dealContinue(rng, state, card)`, `sortOrder(entries)`, `holdOffTargets(order, id, opts)`,
`holdOff(order, id, partnerId, opts)`, `REDRAW_MODES`.

- The deal in steps: `dealStart` deals until somebody with a choice between two cards (Fast Reflexes) has drawn, and returns
  `DealState = { done, pending: null | { id, cards: [a, b], draw }, entries, deck, queue, order }`; `dealContinue(rng, state, card)` takes the
  chosen card and goes on. `dealRound` is the same deal with the choices made by `opts.choose` (same rng, same cards as before).
- `dealAdvance(state)` deals the plain draws of a stored `DealState` (with `pending: null`) on until the next choice or the end; it takes
  no rng and never changes the state it is given. For a table that keeps the deal between answers and resumes it from the stored deck and queue.
- `opts.reflexesFirst` (dealStart, dealRound): those with a choice draw before the others (OQ-13; default: in the given order).
- `opts.initiatorOnce` (holdOffTargets, holdOff): a character who already swapped this round as the initiator may not start another
  (OQ-17; default: no such limit).

### `crits.mjs`
`CRIT_TABLE`, `MAX_CRIT`, `FAMILY_CAP`, `DEADLY_HIT_MAX_BONUS`, `deadlyHitBonus(taken)`, `resolveCrit({ d6, bonus, prior, cap })`,
`critForHit({ taken, healthBefore, deadlyHit, target })`, `critPenalty(crits, attr, opts)`, `critState(crits)`, `BROKEN_ALLOWED`,
`canRally({ broken, crits, primaryCopy })` (book 1915: `primaryCopy` = the broken one is the primary copy of Sequestered Original, reason `"copy"`), `rallyOutcome({ sixes, maxHealth })`, `canStabilize({ crits, attempted, hasGear, power })`, `stabilizeOutcome(sixes)`.

Crits are passed as arrays of table numbers (`[6, 2]`). `critForHit` asks `stunts.isImmune(target, "deadlyHit")`.

### `damage.mjs`
`BODY_ARMOR`, `selectArmor(sources, opts)`, `barrierBreached(source, taken)`, `halvedArmor(armor)`, `absorbByCopies({ taken, copies })`,
`resilienceConvert({ taken, resolve, convert }, opts)`, `hitDamage({ base, pulled, doubled, armor, ignoreArmor, source, immunities, vulnerabilities })`,
`resolveHit({ ... })`, `baseHealth(attrs)`, `baseResolve(attrs)`, `applyDamage({ health, taken })`, `applyStress({ resolve, stress })`,
`canTakeVoluntaryStress(resolve)`, `recoverResolve({ resolve, max, sixes })`, `recoverAfterScene({ ... })`.

Damage sources are free strings; `"kinetic"` is the default and `"nonKinetic"` in `immunities` means every other source.

- `selectArmor(sources, { source, toStress })`: an armor source may carry `only: [damage sources]` (it counts against those only) and
  `stress: true` (it counts against attacks on Resolve only).
- `resolveHit({ base, pulled, doubled, addAfterDouble, source, immunities, vulnerabilities, armor, armorSources, ignoreArmor, halveArmor,
  toStress, copies, resilience, resolve })` runs the whole chain of one hit in the book's order and returns
  `{ raw, armor, armorSource, through, barrierBreached, immune, vulnerable, copies: { before, absorbed, left, gone }, converted, taken, stress }`.
  `ignoreArmor`: `true` or `"exceptStress"`. `hitDamage` is unchanged and remains for callers that need only the first steps.
- `recoverAfterScene({ health, maxHealth, resolve, maxResolve, strength, presence, span, socialScene, loner, regeneration })`.

### `stunts.mjs`
`STUNTS`, `STUNTS_BY_ATTACK`, `HUGE_IMMUNE`, `IMMUNITY_SETS`, `immunitiesOf(target)`, `isImmune(target, what)`, `reachesElevated(attacker)`,
`EXCLUSIVE`, `stuntOptions(ctx)`, `validateStunts({ picks, sixes, ctxFor, targets })`, `knockbackDistance(strength)`, `bangHeadsDamage(strength)`,
`slamDamage(strength)`, `trickShotDamage(baseDamage)`, `stunOutcome({ taken, presenceSixes })`, `fullAutoDice(targets)`.

Stunt ids: `doubleDamage`, `knockback`, `stun`, `bangHeads`, `trap`, `disarm`, `deadlyHit`, `slam`, `suppressed`, `trickShot`, `special`, `own`.

- Immunity flags of a target: `huge` (the huge creature's list plus grapple and banter), `grown` (grapple, Knockback, Slam),
  `impervious` (Deadly Hit), and a free list `immune: [ids]`. `immunitiesOf` gives the union; `stuntOptions` greys an immune stunt with
  reason `immune`. Whether a partly huge character counts as huge is the caller's flag (the GM's word), not decided here.
- `validateStunts` with `targets` (the list `attack.resolveAreaAttack` returns): every target's stunts are paid from that target's own
  budget; reasons `notHit` (a target not on the list or missed) and `targetBudget`; the result also carries `perTarget`.

### `attack.mjs`
`ATTACKS`, `DEFENCES`, `restrained(target)`, `UNAWARE_BONUS`, `attackModifiers({ ... })`, `defenceOptions({ attack, defender, inChase })`,
`resolveAttack({ attack, attackSixes, defence, defenceSixes })`, `resolveAreaAttack({ attackSixes, targets })`, `chargeCheck({ ... })`,
`chargeEndZone(zone)`, `grappleCheck({ targetHuge, usesWeapon, target })`, `GRAPPLER_ACTIONS`, `HELD_ACTIONS`.

Attack ids: `slugfest`, `charge`, `grapple`, `grappleAttack`, `counterattack`, `shooting`, `ram`.
Target conditions: `held`, `snared`, `trapped`, `unaware`, `noInterrupts`, `carriedAloft`, `hasQuick`, `out` (out of action: the reason id, book 2707), `holding` (holds somebody in a grapple, book 2497).
`grappleCheck`: `target` (immunity flags as above) may be given instead of, or beside, `targetHuge`.

### `maneuvers.mjs`
`ESCAPES`, `SNARE_ESCAPE_DICE`, `escapeOutcome({ kind, sixes, holderSixes })`, `BANTER`, `banterCheck({ ... })`, `banterStress(sixes, targetSixes)`,
`ORDERS`, `ordersBonus(sixes)`, `helpCheck({ helpers, minions })`, `fastballCheck({ throwerStrength, thrownStrength, friendly })`,
`carryCheck({ ... })`, `carryEndsAloft(endAlt)`, `MINION_ATTACK_SIZE`, `minionAttacks(count)`, `splitMinions(count, max)`, `minionDamage({ members, taken })`.

- `helpCheck`: helpers `[{ id, hasFull, supportive?, dice? }]`; the result also carries `perHelper` (dice of each helper that counts).
- `banterCheck({ sameZone, targetHuge, target, targetBanteredThisRound, hasQuick })`: `target` with immunity flags; reasons `huge` and
  `immune` come with `gmMayAllow`.

### `hazards.mjs`
`FIRE_DAMAGE_PER_SIX`, `firePool(intensity)`, `fireDamage(sixes)`, `fireAttackDue({ when, inBurningZone, burning })`, `fireOutcome({ ... })`,
`EXTINGUISH`, `extinguishOutcome(sixes)`, `fireSpreadRoll(d6)`, `fireSpreadTargets(graph, zone, burning, opts)`,
`pickFireSpread(rng, graph, zone, burning, opts)`, `fallDice(fromAlt)`, `fallOutcome({ dice, agilitySixes, canGrab, immune })`, `blastDamage(rating)`,
`blastPool(rating)`, `blastOutcome({ rating, sixes, targets: [{ id, dodgeSixes, armor, vulnerable, immune }] }, rng)` (book 2193: `vulnerable` doubles and removes Armor, also in `fireOutcome({ ..., vulnerable })`), `VACUUM_PROTECTION`, `vacuumDice(roundOfExposure)`, `vacuumOutcome(sixes)`,
`DISEASE`, `diseaseDice(virulence)`, `diseaseStep({ state, sixes, broken })`.

Fire spread options: `doors: "pass" | "block"`, `needFlammable: true | false`, `water: "burns" | "never"` (defaults first).

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
| 2 range to elevated targets, sky and orbit | `zones.rangeBetween`, `zones.rangeDistance`, `zones.slugfestReach`, `zones.slugfestReachAt` |
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
| 14 area attacks, full auto | `attack.resolveAreaAttack`, `stunts.validateStunts` (with `targets`: each target's own budget), `stunts.fullAutoDice` |
| 15 objective roll costs a full action | `challenge.OBJECTIVE_ACTION` |
| 16 return from sky or orbit | not a rule function: a GM-approved choice (engine) |
| 17 banter | `maneuvers.BANTER`, `maneuvers.banterCheck`, `maneuvers.banterStress` |
| 18 Teleportation is a quick action only | `movement.MOVE_MODES.teleportation` (`actions: ["quick"]`), `movement.moveCost`; `zones` offers `through: "any"` for its distance |
| 19 dodged charge | `attack.chargeEndZone`, `attack.chargeCheck` |
| 20 Trap | `stunts.stuntOptions` (empty zone), `attack.defenceOptions`, `maneuvers.ESCAPES.trap` |
| 21 Snare | `attack.restrained`, `attack.defenceOptions`, `maneuvers.ESCAPES.snare`, `maneuvers.SNARE_ESCAPE_DICE` |
| 22 challenge clock and side effects | `challenge.endOfRound`, `challenge.EFFECT_TIMES`, `BOOK_CHALLENGES[*].effects` |
| 23 range and walls | `zones` two distance families (`rangeBetween` counts blocked borders, `routeBetween` does not cross them) |
| 24 minions above 10 | `maneuvers.splitMinions`, `maneuvers.minionAttacks` |
| 25 chase pushes | `chase.CHASE_PUSH_ORDER` |

## Open questions as parameters

None of these is settled; the default is the provisional behaviour and the other value is the other reading. The engine passes what
the table decides.

| Question | Parameter | Default | Other |
|---|---|---|---|
| OQ-13 who draws first when somebody chooses between two cards | `initiative.dealStart / dealRound` `opts.reflexesFirst` | false: in the given order | true: those with a choice first |
| OQ-14 flyers and blocked borders | movement profile `over` | `"rooftop"` (reading 4) | `"exterior"` (the zones API's reading ZR-3) |
| OQ-15 what stops fire and what burns | `hazards.fireSpreadTargets` `opts.doors`, `opts.needFlammable`, `opts.water` | `"pass"`, true, `"burns"` | `"block"`, false, `"never"` (the map's own fire round, ZR-8) |
| OQ-17 hold-off swaps per round | `initiative.holdOffTargets / holdOff` `opts.initiatorOnce` | false | true |
| OQ-18 wrecking a zone whose terrain was never set | `zone.terrainUnset` | `wreckCheck` answers `terrainUnset` with `gmMayAllow` | the GM sets the terrain |
| OQ-12 which NPCs push | none: `dice.canPush` makes no difference between heroes and NPCs | | the engine's policy |
| movement condition against a quick-only way | `movement.moveCost` `opts.quickOnly` | `"full"` | `"blocked"` |
| Resilience above current Resolve | `damage.resilienceConvert` `opts.uncapped` | false: capped at Resolve | true |
| attacks that ignore Armor against stress armor | `damage.resolveHit` `ignoreArmor` | `true`: every armor | `"exceptStress"` |

## Changes of behaviour (everything else only adds)

- `damage.recoverAfterScene`: `socialScene` now defaults to `false` (it was `true`); Resolve is clamped to its maximum; new `loner`,
  `regeneration`. A caller that relied on the old default must pass `socialScene: true`.
- `zones.isOffMap`: true for `dimension` and `chase` as well as `sky` and `orbit`.
- `zones.altitudeChangeCost`: may answer `"gm"` (to or from `dimension` / `chase`) and prices `underground` (`"quick"`).
- `zones.rangeDistance` with positions that carry floors or underground now counts those levels (older positions: unchanged).
- `zones.slugfestReach`: new reasons `level`, `noRange`; `zones.wreckCheck`: new reason `terrainUnset`.
- `stunts.stuntOptions`: an immune target's stunt is refused with reason `immune` where the flags are given.
- Results that gained fields: `maneuvers.helpCheck` (`perHelper`), `stunts.validateStunts` (`perTarget`).
- Citations corrected (vehicle chapter, weapon tables, NPC pushing): comments only.

## Readings (choices the text leaves open; each is marked "Reading:" or explained in the code)

All of them stay open.

1. `dice.applyPush`: stress = every 1 showing after the push, 1s of the first roll included (the game system charges the same); `stressOnes: "new"` gives the other count.
2. `zones.borderImpedesTalk`: an intact wall impedes talking unless its door is open or breached.
3. `zones.canCommunicate`: adjacency is horizontal; ground and elevated characters of the same or neighbouring zones can talk.
   3a. Other level differences (floors, underground) count as vertical zones: the next floor is adjacent, two floors apart is not.
4. `zones` aerial movement: a flyer crosses a blocked border when one of its two zones has a rooftop (book: flyers pass over buildings). A freestanding wall is not crossed. The other reading is the profile option `over: "exterior"`.
5. `zones.slugfestReach`: the altitude difference counts as in ruling 2, so a range-1 attack (wrecking) reaches an elevated target in the attacker's own zone, and the next floor.
6. `zones.forcedMove`: a border is a barrier when it is not open for movement; the wall's Armor is used unless the caller names the door.
7. `damage.selectArmor`: on equal ratings the non-Barrier armor is used, so the Barrier is not spent. `barrierBreached`: only when the Barrier was the armor that counted and damage got through.
8. `damage.hitDamage`, `damage.resolveHit`: Double Damage and Vulnerable both double (x4 together); a vulnerability wins over an immunity to the same source. `addAfterDouble` is added after Double Damage and before the Vulnerable doubling.
9. `crits.critForHit`: a Deadly Hit on a target that is already broken gives one roll with the higher bonus (ruling 9 applied by analogy).
10. `attack.resolveAreaAttack`: a target can only receive stunts paid for by 6s left after its own dodge.
11. `hazards.blastOutcome`: a dodge is the usual opposed roll; an extra 6 dealt to a target that dodged is lost.
12. `hazards.diseaseStep`: Armor does not reduce disease damage.
13. `chase.chaseRoll`: the prey is lost when the distance exceeds the end distance (5), not when it reaches it.
14. `challenge.wardReset`: the ward's three-round clock starts again after a reset.
15. `maneuvers.splitMinions`: the even split is a suggestion; the book lets the GM divide freely.
16. `vehicles.ramProfile`: ram damage uses the vehicle's Durability rating (its maximum), not the points left.
17. `movement.MOVE_MODES`: the book does not class leaping, super-speed and swinging as ground or aerial movement. Provisional: leaping and swinging aerial, super-speed ground; `moveCost` lists the condition under `unsettled` and sets `gmMayAllow` where it blocks.
18. `movement.moveConditions`: the caller says whether a zone's condition (storm, high gravity) holds for a move; the book does not say whether the zone left, the zone entered or every zone passed counts.
19. `movement.moveCost`: a condition that makes movement a full action makes Teleportation (a quick action only, ruling 18) a full action; `quickOnly: "blocked"` is the other reading.
20. `zones.rangeBetween`, `zones.routeBetween`: the zones contract's readings are taken over so that both sides agree: underground is one level below the ground (ZR-1); a flyer or a mover that passes through changes level inside the move at no cost (ZR-2); only a mover that passes through reaches or leaves underground (ZR-4).
21. `zones.altitudeChangeCost`: ground to underground is priced like ground to elevated ("quick"); the plan's areas `dimension` and `chase` have no cost in the book ("gm").
22. `zones.graphFromZonesApi`: the wall around an older "door" / "locked" mark is taken as an interior wall (`armorAssumed`).
23. `dice.helpDice`: the cap of three helpers is on the number of helpers, so three Supportive helpers give +6.
24. `stunts.validateStunts` with `targets`: a stunt aimed at somebody the area attack did not hit is refused (`notHit`).
25. `damage.absorbByCopies`: damage beyond the copies destroyed carries over to the character's Health.
26. `damage.resilienceConvert`: the damage turned into stress is capped at the current Resolve (`uncapped` is the other reading).
27. `damage.resolveHit`: an attack that ignores Armor ignores armor against stress too (`ignoreArmor: "exceptStress"` is the other reading).
28. `stunts.IMMUNITY_SETS.huge`: a huge creature's immunity list is extended with grapple and banter from their own rules; whether a character who is only sometimes or partly huge carries the flag is the GM's word.
29. `movement.altitudeAccess`: sky high and orbit are open only to ways of moving that may end in the air (flight, wings, an aerial vehicle); the book names no list, so every other way is refused with `gmMayAllow`.
