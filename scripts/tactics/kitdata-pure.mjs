/* Tactical combat, package P6: WHAT A CHARACTER BRINGS TO A FIGHT, as data. NO Foundry globals, no imports.
   One row per entry of the book's chapter 3 (powers with their boosts and limits, talents, drawbacks) and of the gear tables.
   `src` = book-dump line numbers only (the text is private). A row is found by the English name of the item (the compendium's and the
   pregenerated heroes' names; an item renamed or translated carries the GM's flag `flags.invincible-plus-ultra.tactics.kit = "<key>"`).

   state  "auto"   the engine applies it (numbers and effects come from the sheet and from this row)
          "assist" the engine offers it and the GM or the player confirms the effect (a card, a chip, one click)
          "hand"   listed for the GM, nothing is applied
   note   one of the NOTE ids below (ITAC.kit.note.<id>): what the engine does, or what is left to the table

   What a row can carry (kit-pure.mjs turns it into profiles, actions, passive facts):
     mv      a way of moving: the Move panel has it (movement-pure / system adapter), the sheet's "N zones" buttons are not repeated
     atk     hints for the item's attack automations: { source, toStress, noDamage, pierce, stunts, area, halveArmor, immuneHuge, noCounter,
             onHit: { status, data?, lv?: [dice per level] } | { stun: 1, resist?: n } | { burn: 1 },
             by: { "<automation name, lower case>": { skip } | hints } }
     acts    actions of the row: [{ k, cost, stress?, roll?, oppose?, target?, pick?, effect, when?, once?, auto?: "<automation name part>" }]
             (when a row has `acts`, the sheet's use / roll automations are not offered a second time unless `keep: 1`)
     fx      the item's active effects are switched from the dock: { cost, stress?, only?: "<effect name part>" }
     pass    passive facts: { regeneration, vacuumSafe, reach, freeHold, deflection, duckWeave, merciless, overconfident, supportive,
             medicalGear, stressArmor: [per level], resist: [per level], immune: "flag" | "nonKinetic", vulnerable: "flag", shrunkDice: [per level], grown }
     mods    dice the sheet does not carry: [{ dice, action?: [ids], attack?: [kinds], attr?, vsHuge?, lv?: [per level] }]
     opt     a boost or limit that changes the attacks of its power: { patch, stress?, optional?, on?: "slug" }
             (PWB: an act's `interrupt: [windows]` = it may also be declared out of turn while somebody else's action waits for its dice
             [B2292]; `fx.interrupt` the same for a switch; `reaction` + `vs` / `mode` / `window` / `weapon` = the answer to an attack
             (kit-pure reactionOf); `atk.reactOnly` = a profile used only by such an answer)
             (`combo: [n per level]` on an action: that many of its `pick` are chosen together, the same one more than once if wished)
     cost    the cost of the row's generic use ("full" unless stated)
     size    [dice per level]: the item's effects "Grow" and "Shrink" are the size the engine reads (grown: reach, stride, immunities [B1975];
             shrunk: fewer dice for physical attacks against [B1976]); a limit with `sizeOnly` leaves one of the two, and with the GM's
             setting `alt` on (ITAC.kit.alt.<id>) the character is always that size (a huge creature [B2499], or tiny) [B1980], [B1981]
     own     the engine applies the entry's dice itself (a dock variant, a rule of its own): what the item's sheet toggle adds is left out of the pools,
             so the two never add up
     why     for a row "by hand": why the book leaves it to the table (ITAC.kit.why.<id>, WHYS below)
   PWC: atk.quake [zones per level] (an Earthquake: wrecks what it covers), atk.vsConductive (dice against a target marked conductive),
     a `by` hint's rangeLv [[min, max] per level]; patch.several (that many targets, one roll), patch.stressOn "hit" (the stress is taken
     when the blow lands), patch.zoneFire (the target's zone set ablaze at that Intensity); an act's oneZone (all its targets in one zone),
     effect.leaveEnds (a barrier gone when its maker or its holder leaves the zone); passOn "fx" (the passive facts count only while the
     power's effect is on, or always on) */

export const LEVELS = Object.freeze(["basic", "major", "massive", "monstrous"]);
export const NOTES = Object.freeze(["attack", "noAttack", "sheet", "move", "toggle", "effect", "token", "outcome", "zone", "map", "gmCard", "flag", "passive", "story", "system", "interrupt",
  "turn", "reaction", "stunt", "crit", "summon", "copies", "source", "initiative", "vehicle", "scene", "unknown", "off", "weapon", "roll", "control", "size", "poison", "resist", "barred", "critTwice", "lacks"]);
/* why a row is left to the table (ITAC.kit.why.<id>): the book gives the engine nothing to apply or to offer there */
export const WHYS = Object.freeze(["talk", "outOfFight", "partOfPower", "gmJudges", "senses", "story", "sheetNumbers", "beforeFight", "systemRoll", "roleplay", "noEffect"]);
const MENTAL = ["reason", "intuition", "presence"];
const row = (cat, name, src, state, note, more = {}) => ({ cat, name, src, state, note, ...more });
const P = (name, src, state, note, more) => row("power", name, src, state, note, more);
const B = (of, name, src, state, note, more) => row("boost", name, src, state, note, { of, ...more });
const L = (of, name, src, state, note, more) => row("limit", name, src, state, note, { of, ...more });
const T = (name, src, state, note, more) => row("talent", name, src, state, note, more);
const D = (name, src, state, note, more) => row("drawback", name, src, state, note, more);
const G = (name, src, state, note, more) => row("gear", name, src, state, note, more);
const moveRow = (name, src) => P(name, src, "auto", "move", { mv: 1 });
const narr = (k, cost, more = {}) => ({ k, cost, effect: { kind: "narrative" }, text: 1, ...more });
const burst = (of, name, src) => B(of, name, src, "auto", "attack", { opt: { patch: { area: 1 }, stress: 1, optional: 1 } });

export const ROWS = Object.freeze([
  /* ================================================================ ATTACK POWERS [B1570-1628] */
  P("Affliction", [1574], "auto", "attack", { atk: { noDamage: 1, pierce: 1, stunts: "doubleOnly", onHit: { status: "afflicted", data: { dice: -3 } } } }),
  B("Affliction", "Mental Affliction", [1575], "auto", "attack", { opt: { patch: { attrs: MENTAL, ignoreArmor: 1 } } }),
  B("Affliction", "Potent Affliction", [1576], "auto", "attack", { opt: { patch: { onHitData: { dice: -4 } } } }),
  L("Affliction", "Requires Touch (Affliction)", [1577], "auto", "attack", { opt: { patch: { fam: "slug" } } }),
  P("Blast", [1580, 1581, 1582, 1583], "auto", "attack", { atk: {} }),
  burst("Blast", "Burst Effect (Blast)", [1584]),
  B("Blast", "Quick Blast", [1585], "assist", "reaction", { acts: [{ k: "quickBlast", as: "shoot", cost: "quick", stress: 1, reaction: "action", vs: "shooting", weapon: "parent" }] }),      // PWB (PW002, PW112)
  B("Blast", "Deadly Blast", [1586], "auto", "attack", { opt: { patch: { sharp: 1 } } }),
  L("Blast", "Exhausting Blast", [1587], "auto", "attack", { opt: { patch: { stress: 1 } } }),
  L("Blast", "Reduced Range (Blast)", [1588], "auto", "attack", { opt: { patch: { range: [0, 1] } } }),
  P("Distress", [1591, 1592, 1593, 1594], "auto", "attack", { atk: { toStress: 1, stunts: "doubleOnly" } }),
  burst("Distress", "Burst Effect (Distress)", [1595]),
  B("Distress", "Mental Distress", [1596], "auto", "attack", { opt: { patch: { attrs: MENTAL, ignoreArmor: 1 } } }),
  L("Distress", "Exhausting Distress", [1597], "auto", "attack", { opt: { patch: { stress: 1 } } }),
  L("Distress", "Reduced Range (Distress)", [1598], "auto", "attack", { opt: { patch: { range: [0, 1] } } }),
  P("Emanation", [1601], "auto", "toggle", { fx: { cost: "quick", interrupt: ["beforeRoll"] } }),      // PWB (PW003): "even as an interrupt"
  B("Emanation", "Potent Emanation", [1602], "auto", "toggle", { fx: { cost: "quick" }, pass: { touchHarm: 4 }, passOn: "fx" }),      // PWC (PW004) [B1602]: a slugfest blow that lands on the holder of the aura costs its striker 4 damage
  L("Emanation", "Continual Emanation", [1603], "auto", "toggle", { lockFx: 1 }),
  P("Snare", [1606, 1607, 1608, 1609], "auto", "attack", { atk: { noDamage: 1, stunts: "none", immuneHuge: 1, onHit: { status: "snared", lv: [-2, -3, -4, -5] } } }),
  B("Snare", "Multiple Snares", [1610], "auto", "attack", { opt: { patch: { several: 3 } } }),      // PWC (PW006) [B1610]: up to three targets in range, one roll, each dodges on its own
  L("Snare", "Immobilize Only", [1611], "auto", "attack", { opt: { patch: { onHitData: { moveOnly: 1 } } } }),      // PWC (PW005) [B1611]: snared, only moving is barred; breaking free stays SNARE's (full action, the level's penalty: FXT-4)
  P("Strike", [1614, 1615, 1616, 1617], "auto", "sheet", { acts: [], pass: { strike: [1, 2, 3, 4] } }),      // Z14: the bonus the sheet's slugfest damage holds, taken off without the wind-up [B1622]
  B("Strike", "Piercing Strike", [1618], "auto", "attack", { opt: { patch: { ignoreArmor: 1, stressOn: "hit" }, stress: 1, optional: 1, on: "slug" } }),      // PWC (PW009) [B1618]: the stress is taken when the blow hits
  B("Strike", "Sudden Strike", [1619], "assist", "reaction", { acts: [{ k: "suddenStrike", as: "slugfest", cost: "quick", stress: 1, reaction: "action", vs: "slugfest", weapon: "unarmed" }] }),      // PWB (PW112)
  B("Strike", "Deadly Strike", [1620], "auto", "attack", { opt: { patch: { sharp: 1 }, on: "slug" } }),
  B("Strike", "Toxic Strike", [1621], "auto", "poison", { opt: { patch: { onHit: { status: "sick", data: { toxic: 1, virulence: 0 }, ifDamage: 1 } }, on: "slug" } }),
  L("Strike", "Windup Strike", [1622], "assist", "effect", { pass: { windup: 1 }, acts: [{ k: "ready", cost: "quick", effect: { kind: "mark", id: "windup" } }] }),
  P("Stun", [1625], "auto", "attack", { atk: { noDamage: 1, pierce: 1, stunts: "doubleOnly", immuneHuge: 1, onHit: { stun: 1 } } }),
  B("Stun", "Mental Stun", [1626], "auto", "attack", { opt: { patch: { attrs: MENTAL, ignoreArmor: 1 } } }),
  B("Stun", "Potent Stun", [1627], "auto", "attack", { opt: { patch: { resist: -2 } } }),
  L("Stun", "Requires Touch (Stun)", [1628], "auto", "attack", { opt: { patch: { fam: "slug" } } }),

  /* ================================================================ CONTROL POWERS [B1631-1847] */
  P("Action Plan", [1634], "auto", "token", { acts: [{ k: "plan", cost: "full", roll: { attr: "reason" }, pick: ["attack", "defend", "misdirect"], effect: { kind: "plan" } }] }),
  P("Animal Control", [1637], "assist", "control", { acts: [{ k: "control", cost: "full", target: { who: "any", n: [1, 12] }, oneZone: 1, immuneHuge: 1, near: 1, effect: { kind: "narrative", then: "control" }, text: 1 },      // PWC (PW012) [B1637]: all the animals of the target zone
    narr("command", "quick", { roll: { attr: "presence" } })] }),
  B("Animal Control", "Animal Mindlink", [1638], "hand", "story", { why: "talk" }),
  L("Animal Control", "Specific Animal Only", [1639, 1640, 1641], "hand", "story", { why: "gmJudges" }),
  P("Cold Control", [1644, 1645, 1646, 1647, 1648, 1649], "assist", "zone", { atk: { source: "cold", by: { "immobilize target": { skip: 1 } } },
    acts: [narr("zone", "full"), { k: "barrier", cost: "quick", interrupt: ["beforeRoll"], target: { who: "ally", n: [0, 1] }, sameZone: 1, effect: { kind: "barrier", armor: [3, 3, 3, 3], max: 3, leaveEnds: 1 } }],      // PWB (PW015): on your turn or as an interrupt [B1646]; PWC (PW013, PW014): in your zone; gone when you or the target leave it
    opts: [{ k: "immobilise", patch: { noDamage: 1, onHit: { status: "immobilised" } } }] }),
  B("Cold Control", "Ice Armor", [1650], "auto", "toggle", { fx: { cost: "quick", interrupt: ["beforeRoll"] } }),      // PWB (PW015)
  B("Cold Control", "Ice Slide", [1651], "auto", "move", { mv: 1 }),
  P("Darkness Control", [1654, 1655, 1656, 1657], "assist", "zone", { cost: "full" }),
  B("Darkness Control", "Dreadful Darkness", [1658], "assist", "resist", { acts: [{ k: "dread", cost: "none", target: { who: "any", n: [1, 1] }, effect: { kind: "resist", attr: "intuition", stress: 2 } }] }),
  P("Dimensional Travel", [1661], "assist", "outcome", { cost: "quick" }),
  B("Dimensional Travel", "Additional Travelers", [1662], "hand", "story", { why: "partOfPower" }),      // PWC (PW027): part of a travel, ruled when the power is used
  B("Dimensional Travel", "Quick Travel", [1663, 1664], "assist", "reaction", { acts: [narr("travel", "quick", { stress: 1, interrupt: ["beforeRoll"] }), { k: "travelAway", cost: "quick", stress: 1, effect: { kind: "narrative" }, reaction: "autoMiss" }] }),      // PWB (PW026, PW111)
  B("Dimensional Travel", "Create Portals", [1665, 1666], "assist", "outcome", { cost: "full" }),
  L("Dimensional Travel", "Parallel Dimensions Only", [1667], "hand", "story", { why: "gmJudges" }),
  L("Dimensional Travel", "Specific Dimension", [1668], "hand", "story", { why: "gmJudges" }),
  P("Earthquake", [1671, 1672, 1673, 1674], "auto", "attack", { atk: { area: 1, always: ["area"], range: [0, 0], quake: [1, 2, 3, 4] } }),      // PWC (PW017, PW018) [B1671-1674]: wrecks the 1-4 adjacent zones it covers; never a zone wrecked or unwreckable
  B("Earthquake", "Shockwave", [1675], "assist", "attack", { opt: { patch: { area: 0, damagePlus: 1, quake: 0 }, optional: 1 } }),
  B("Earthquake", "Earth Drift", [1676], "auto", "move", { mv: 1 }),
  P("Electricity Control", [1679, 1680, 1681, 1682, 1683, 1684], "auto", "attack", { atk: { source: "electricity", halveArmor: 1, vsConductive: 2, by: { stun: { noDamage: 1, pierce: 1, halveArmor: 1, onHit: { stun: 1 }, rangeLv: [[0, 1], [0, 2], [0, 3], [0, 4]] } } }, acts: [narr("zone", "full")] }),      // PWC (PW019, PW020) [B1680-1684]: +2 against a conductive target; the stun reaches as far as the attack
  B("Electricity Control", "Discharge", [1685], "auto", "attack", { pass: { discharge: 10 } }),      // PWC (PW021) [B1685]: no action of its own, asked after an electric hit
  B("Electricity Control", "Body Battery", [1686], "auto", "effect", { acts: [{ k: "battery", cost: "full", roll: { attrs: MENTAL }, effect: { kind: "gainResolve", per: 3, over: 1 }, once: "sceneZone" }] }),      // Z7: once per scene in the same zone
  P("Fire Control", [1689, 1690, 1691, 1692, 1693, 1694], "assist", "zone", { atk: { source: "fire", onHit: { burn: 1, ifDamage: 1 } }, pass: { immune: ["fire"] }, acts: [narr("zone", "full")],      // PWC (PW022, PW023) [B1690-1691]: only a target that takes damage burns, at the base Damage
    opts: [{ k: "blaze", patch: { zoneFire: 6 }, stress: 1 }] }),      // PWC (PW024) [B1692]: for 1 stress the target's zone is set ablaze at Intensity 6
  burst("Fire Control", "Conflagration", [1695, 1696]),
  B("Fire Control", "Firestarter", [1697], "assist", "zone", { acts: [narr("blaze", "full")] }),
  L("Fire Control", "Destructive Flames", [1698, 1699], "hand", "story", { why: "gmJudges" }),
  P("Gravity Control", [1702, 1703, 1704], "assist", "zone", { cost: "full" }),
  B("Gravity Control", "Precise Control", [1705], "hand", "story", { why: "partOfPower" }),
  P("Guidance", [1708, 1709], "assist", "gmCard", { acts: [{ k: "guide", cost: "full", roll: { attr: "presence" }, target: { who: "ally", n: [1, 6] }, talk: 1, effect: { kind: "guidance" } },      // PWD (PW033) [B1708]: one ally per six takes a bonus action on the guide's turn
    { k: "guideDefence", cost: "quick", roll: { attr: "presence" }, effect: { kind: "narrative" }, reaction: "guide" }] }),      // PWB (PW034, PW121) [B1709]
  /* PWD (PW035, PW036, PW107, PW032): the target sees through the illusion with a passive INTUITION roll, -1/-2/-3 dice at Major/Massive/Monstrous; no effect
     on huge creatures; your zone or an adjacent one [B1712-1715]. With Terrifying Illusions the same roll costs the target 3 stress minus its sixes [B1717]. */
  P("Illusion", [1712, 1713, 1714, 1715], "assist", "resist", { cost: "full", acts: [{ k: "cast", cost: "full", target: { who: "any", n: [1, 1] }, near: 1, immuneHuge: 1, text: 1, with: { terrifyingillusions: { stress: 3, loseTurn: 1 } },
    effect: { kind: "resist", attr: "intuition", dice: [0, -1, -2, -3], illusion: 1 } }] }),
  B("Illusion", "Area Projection", [1716], "assist", "resist", { acts: [{ k: "area", cost: "full", stress: 1, target: { who: "any", n: [1, 12] }, near: 1, immuneHuge: 1, text: 1, with: { terrifyingillusions: { stress: 3, loseTurn: 1 } },
    effect: { kind: "resist", attr: "intuition", dice: [0, -1, -2, -3], illusion: 1 } }] }),
  B("Illusion", "Terrifying Illusions", [1717], "assist", "resist", { acts: [{ k: "terrify", cost: "none", target: { who: "any", n: [1, 1] }, near: 1, immuneHuge: 1, effect: { kind: "resist", attr: "intuition", stress: 3, loseTurn: 1, dice: [0, -1, -2, -3], illusion: 1 } }] }),
  B("Illusion", "Remote Projection", [1718], "assist", "outcome", { acts: [narr("remote", "full", { stress: 1 })] }),
  B("Illusion", "Dream Projection", [1719], "hand", "story", { why: "outOfFight" }),
  P("Light Control", [1722, 1723], "assist", "zone", { atk: { noDamage: 1, ignoreArmor: 1, stunts: "noDamage", immuneHuge: 1, onHit: { stun: 1 } }, acts: [narr("zone", "full")] }),
  burst("Light Control", "Burst Effect (Light Control)", [1724]),
  P("Luck Control", [1727, 1728, 1729, 1730], "assist", "token", { acts: [{ k: "luck", cost: "quick", stress: 1, target: { who: "any", n: [0, 1] }, near: 1, pick: ["good", "bad"], effect: { kind: "luck", lv: [1, 2, 3, 4] } }] }),      // PWD (PW031, PW032): yourself too; your zone or an adjacent one [B1727]
  L("Luck Control", "Good Luck Only", [1731], "auto", "token", { opt: { luck: "good" } }),
  L("Luck Control", "Bad Luck Only", [1732], "auto", "token", { opt: { luck: "bad" } }),
  /* PWD (PW046) [B1735], [B1744]: the weight limit up to 2 steps higher for as much stress; (PW045) [B1737] a block of an attack that uses metal, even a shot,
     the GM confirms the metal; (PW044) [B1745] the zone the matter comes from wrecked for bonus dice, the weight limit of the level standing in for STRENGTH */
  P("Magnetism Control", [1735, 1736, 1737, 1738, 1739, 1740, 1741], "assist", "zone", { atk: {}, acts: [narr("zone", "full", { label: "weigh", pick: ["0", "1", "2"], stressPick: 1 })], opts: [{ k: "immobilise", patch: { noDamage: 1, onHit: { status: "immobilised" } } }],
    pass: { metalBlock: [3, 4, 5, 6] } }),
  P("Matter Control", [1744, 1745, 1746, 1747, 1748, 1749], "assist", "zone", { atk: { wreckWeight: [4, 6, 8, 10] }, acts: [narr("zone", "full", { label: "weigh", pick: ["0", "1", "2"], stressPick: 1 })], opts: [{ k: "area", patch: { area: 1 }, stress: 1 }] }),
  L("Matter Control", "Specific Matter", [1750], "hand", "story", { why: "gmJudges" }),
  P("Mimicry", [1753, 1754, 1755, 1756], "assist", "gmCard", { cost: "full", acts: [narr("mimic", "full", { target: { who: "any", n: [1, 1] }, sameZone: 1 })] }),      // PWD (PW041) [B1753]: a target in your zone
  B("Mimicry", "Multiple Mimicry", [1757], "hand", "story", { why: "partOfPower" }),
  B("Mimicry", "Power Leech", [1758], "assist", "attack", { opt: { patch: { noDamage: 1 }, optional: 1, on: "slug" } }),
  /* PWD (PW040-PW043) [B1761-1763]: a sentient creature in your zone or an adjacent one, never a huge one; a win gives it a full turn at once on your
     command, then it loses its next ordinary turn (the GM's word on the card first); Area Control: 1 stress per target beyond the first, each rolls */
  P("Mind Control", [1761, 1762], "assist", "gmCard", { acts: [{ k: "control", label: "mind", cost: "full", roll: { attr: "presence" }, oppose: { attr: "presence", who: "target" }, target: { who: "enemy", n: [1, 1] }, effect: { kind: "narrative", then: "mindControl" }, immuneHuge: 1, near: 1, text: 1 }] }),
  B("Mind Control", "Area Control", [1763], "assist", "gmCard", { acts: [{ k: "many", label: "minds", cost: "full", roll: { attr: "presence" }, oppose: { attr: "presence", who: "targets" }, target: { who: "enemy", n: [1, 12] }, stressExtra: 1, immuneHuge: 1, near: 1, text: 1, effect: { kind: "narrative", then: "mindControl" } }] }),
  L("Mind Control", "Hypnosis", [1764, 1765], "auto", "barred", { bars: 1 }),
  L("Mind Control", "Requires Touch", [1766, 1767, 1768], "assist", "attack", { opt: { patch: { noDamage: 1 }, optional: 1, on: "slug" } }),
  P("Nullification", [1772, 1773, 1774, 1775], "assist", "gmCard", { acts: [{ k: "nullify", cost: "quick", roll: { attr: "presence" }, oppose: { attr: "presence", who: "target", optional: true }, target: { who: "any", n: [0, 1] }, effect: { kind: "narrative" } }] }),
  P("Plant Control", [1778, 1779, 1780, 1781, 1782, 1783, 1784], "assist", "zone", { atk: { noCounter: 1, reach: [1, 2, 3, 4] }, acts: [narr("zone", "full")] }),      // PWD (PW047, PW049): no counterattack [B1779]; a target in the plants' zones, 1-4 adjacent zones from your own or the next [B1778-1784]
  burst("Plant Control", "Massive Growth", [1785, 1786]),
  B("Plant Control", "Lifeseed", [1787], "assist", "zone", { acts: [narr("seed", "quick", { stress: 1 })] }),
  P("Sorcery", [1790], "assist", "gmCard", { cost: "full", acts: [{ k: "spell", cost: "full", roll: { attr: "presence" }, effect: { kind: "spell" }, text: 1 }, { k: "spellOn", cost: "none", stress: 1, effect: { kind: "spellOn" }, text: 1 }] }),      // PWD (PW050) [B1790]
  B("Sorcery", "Signature Spell", [1791], "hand", "story", { why: "partOfPower" }),
  L("Sorcery", "Ritual Casting", [1792], "auto", "barred", { bars: 1 }),
  P("Sound Control", [1799, 1800], "assist", "zone", { atk: { noDamage: 1, ignoreArmor: 1, stunts: "noDamage", immuneHuge: 1, onHit: { stun: 1 } } }),
  burst("Sound Control", "Sonic Boom", [1801]),
  B("Sound Control", "Sonar", [1802, 1803, 1804, 1805], "hand", "passive", { why: "senses" }),
  P("Summoning", [1808, 1809, 1810, 1811, 1812, 1813, 1814, 1815], "assist", "summon", { acts: [{ k: "summon", cost: "full", pick: ["versatile", "powered", "more"], combo: [1, 2, 3, 4], effect: { kind: "summon" }, text: 1 },
    { k: "dismiss", cost: "full", effect: { kind: "dismiss" } }] }),
  L("Summoning", "Delayed Summoning", [1816], "auto", "turn", { pass: { summonDelay: 1 } }),
  P("Technology Control", [1819], "assist", "outcome", { cost: "full", keep: 1, acts: [narr("seize", "full", { roll: { attr: "agility" } })] }),      // PWD (PW051) [B1819]: a weapon taken over fires in the same action, on AGILITY
  /* PWD (PW054) [B1828]: the compendium's Monstrous attack says Damage 5, Range 0/6; the book Damage 6, Range 0/5. `errata`: the numbers of the level are
     put right when the item still carries exactly the compendium's wrong ones (a GM's own numbers stay). (PW055) [B1822], [B1829]: the weight limit
     up to 2 steps higher for as much stress; up to 9 targets, 1 stress each beyond the first */
  P("Telekinesis", [1822, 1823, 1824, 1825, 1826, 1827, 1828], "assist", "gmCard", { atk: { by: { "throw target": { noDamage: 1, stunts: "none", throws: [3, 4, 5, 6], zones: [2, 3, 4, 5] } },
    errata: [null, null, null, { from: { damage: 5, range: [0, 6] }, to: { damage: 6, range: [0, 5] } }] }, by: { telekinesis: { pick: ["0", "1", "2"], stressPick: 1, label: "weigh" } } }),
  B("Telekinesis", "Multiple Targets", [1829], "assist", "gmCard", { acts: [narr("many", "full", { pick: ["1", "2", "3", "4", "5", "6", "7", "8"], stressPick: 1 })] }),
  /* PWD (PW056) [B1832]: the sweep moves the target (never a huge one) into an adjacent zone of the attacker's choice instead of damage; (PW057) the
     compendium's Range 0/2, 0/3, 0/4 at Major-Monstrous is put right to the book's 0/1 (higher levels widen the zones, not the range) */
  P("Water Control", [1832, 1833, 1834, 1835], "assist", "zone", { atk: { errata: [null, { from: { range: [0, 2] }, to: { range: [0, 1] } }, { from: { range: [0, 3] }, to: { range: [0, 1] } }, { from: { range: [0, 4] }, to: { range: [0, 1] } }] },
    acts: [narr("zone", "full")], opts: [{ k: "area", patch: { area: 1 }, stress: 1 }, { k: "sweep", patch: { noDamage: 1, sweep: 1, immuneHuge: 1 } }] }),
  B("Water Control", "Wellspring", [1836], "assist", "outcome", { acts: [narr("water", "none", { stress: 1 })] }),
  L("Water Control", "Submersion", [1837], "hand", "story", { why: "gmJudges" }),
  P("Weather Control", [1840, 1841, 1842, 1843, 1844], "assist", "zone", { atk: {}, acts: [narr("zone", "full")] }),
  burst("Weather Control", "Hurricane", [1845]),
  B("Weather Control", "Cyclone", [1846], "assist", "resist", { acts: [{ k: "cyclone", cost: "none", target: { who: "any", n: [1, 1] }, effect: { kind: "resist", attr: "strength", thrown: 1, wreck: 1 } }] }),      // PWD (PW059) [B1846]: the zone is wrecked; who fails is thrown into an adjacent zone of your choice
  L("Weather Control", "Air Control Only", [1847], "hand", "story", { why: "gmJudges" }),

  /* ================================================================ DEFENSE POWERS [B1850-1893] */
  P("Adaptation", [1854, 1855, 1856], "assist", "outcome", { cost: "full", pass: { vacuumSafe: 1 } }),
  P("Barrier", [1859, 1860, 1861, 1862], "auto", "effect", { acts: [{ k: "barrier", cost: "quick", interrupt: ["beforeRoll"], target: { who: "ally", n: [0, 1] }, sameZone: 1, effect: { kind: "barrier", armor: [3, 4, 5, 6], max: 3 } }] }),      // PWB: also as an interrupt; PWC (PW106) [B1859]: a target in your zone
  P("Defiance", [1865, 1866, 1867, 1868], "auto", "passive", { pass: { stressArmor: [3, 4, 5, 6], resist: [3, 4, 5, 6] }, acts: [] }),
  L("Defiance", "Requires Activation (Defiance)", [1869], "auto", "effect", { pass: { defianceOff: 1 }, acts: [{ k: "activate", cost: "quick", interrupt: ["beforeRoll"], effect: { kind: "mark", id: "defiance", scene: 1 } }] }),      // PWB (PW065)
  P("Immortality", [1872, 1873, 1874, 1875, 1876], "hand", "story", { why: "story" }),
  P("Immunity", [1879], "assist", "flag", { pass: { immune: "flag" }, acts: [] }),
  B("Immunity", "Full Immunity", [1880], "auto", "passive", { pass: { immune: ["nonKinetic"] } }),
  P("Protection", [1883, 1884, 1885, 1886], "auto", "sheet", { acts: [] }),
  B("Protection", "Energy Absorption", [1887], "auto", "token", { pass: { absorb: 1 } }),
  B("Protection", "Impervious", [1888], "auto", "passive", { pass: { impervious: 1 } }),
  B("Protection", "Redirecting Blast", [1889], "assist", "reaction", { atk: { reactOnly: 1, range: [0, 3] }, acts: [{ k: "redirect", as: "shoot", cost: "quick", reaction: "action", window: "afterDamage", vs: "absorbed", weapon: "own" }] }),      // PWB (PW112)
  L("Protection", "Requires Activation (Protection)", [1890], "assist", "toggle", { fx: { cost: "quick", ofParent: 1, interrupt: ["beforeRoll"] } }),      // PWB (PW065)
  P("Regeneration", [1893], "auto", "turn", { pass: { regeneration: 1 } }),      // Z8: heals by itself on each turn (engine-pure, effect "regen"); the button is gone

  /* ================================================================ MODIFICATION POWERS [B1896-1989] */
  moveRow("Adhesion", [1900]),
  P("Camouflage", [1903], "assist", "gmCard", { cost: "quick" }),
  B("Camouflage", "Shared Camouflage", [1904], "assist", "gmCard", { acts: [narr("share", "quick", { pick: ["1", "2", "3"], stressPick: 1 })] }),
  P("Duplication", [1907, 1908, 1909, 1910, 1911, 1912, 1913], "auto", "copies", { acts: [{ k: "copies", cost: "full", stress: 1, effect: { kind: "copies", lv: [3, 5, 7, 9] } },
    { k: "copyAct", cost: "none", stress: 1, effect: { kind: "grant", template: "gm", unit: "full", expires: "turnEnd" }, once: "round" }, { k: "reabsorb", cost: "full", effect: { kind: "reabsorb" } }] }),
  B("Duplication", "Restorative Duplication", [1914], "auto", "copies", { acts: [{ k: "restore", cost: "full", stress: 1, effect: { kind: "reabsorb", heal: 1 } }] }),
  B("Duplication", "Sequestered Original", [1915], "auto", "passive", { pass: { noCrit: 1, noRally: 1 } }),      // [B1915]: the broken primary copy is killed: no injury, no rallying
  L("Duplication", "Traumatic Duplication", [1916], "auto", "copies", { pass: { traumatic: 1 } }),
  P("Elongation", [1919], "auto", "passive", { pass: { reach: 1 }, acts: [] }),
  B("Elongation", "Plasticity", [1920], "auto", "sheet", { pass: { armorOnly: ["kinetic"] } }),
  B("Elongation", "Stretch Grapple", [1921], "auto", "sheet"),
  B("Elongation", "Elongated Stride", [1922], "auto", "move", { mv: 1 }),
  P("Extra Limb(s)", [1925, 1926, 1927, 1928], "auto", "sheet", { pass: { freeHold: 1 }, names: ["Extra Limbs"], acts: [] }),
  B("Extra Limb(s)", "Multiple Limbs", [1929], "assist", "gmCard", { acts: [narr("hold", "full", { roll: { attr: "fighting" } })] }),
  P("Healing", [1932], "auto", "effect", { acts: [{ k: "heal", cost: "full", roll: { attr: "presence" }, target: { who: "ally", n: [0, 1] }, effect: { kind: "heal", per: 3 }, touch: 1 }] }),
  B("Healing", "Distant Healing", [1933], "auto", "effect", { pass: { healReach: 1 } }),
  B("Healing", "Mass Healing", [1934], "auto", "effect", { acts: [{ k: "massHeal", cost: "full", roll: { attr: "presence" }, target: { who: "ally", n: [1, 4] }, stressExtra: 1, sameZone: 1, effect: { kind: "heal", per: 3, mass: 1 } }] }),
  B("Healing", "Cleansing Healing", [1935], "auto", "effect", { acts: [{ k: "cleanse", cost: "full", roll: { attr: "presence" }, target: { who: "ally", n: [0, 1] }, touch: 1, effect: { kind: "cleanse" } }] }),
  B("Healing", "Miraculous Recovery", [1936], "assist", "crit", { acts: [narr("recover", "full", { roll: { attr: "presence" }, target: { who: "ally", n: [0, 1] }, touch: 1 })] }),
  L("Healing", "Life Leech", [1937], "assist", "effect", { acts: [{ k: "leech", cost: "full", roll: { attr: "presence" }, target: { who: "any", n: [1, 1] }, touch: 1, effect: { kind: "leech", per: 3 } }] }),
  P("Intangibility", [1940], "assist", "reaction", { acts: [{ k: "phase", cost: "quick", stress: 1, effect: { kind: "narrative" }, reaction: "autoMiss" }] }),
  B("Intangibility", "Prolonged Phasing", [1941], "auto", "effect", { acts: [{ k: "phased", cost: "quick", effect: { kind: "status", id: "intangible", on: "self", toggle: 1 } }] }),
  B("Intangibility", "Controlled Phasing", [1942], "auto", "effect", { acts: [{ k: "solid", cost: "none", stress: 1, effect: { kind: "mark", id: "solid" } }] }),
  B("Intangibility", "Shared Intangibility", [1943], "assist", "gmCard", { acts: [narr("share", "none", { pick: ["1", "2", "3", "4"], stressPick: 1 })] }),
  B("Intangibility", "Environment Phasing", [1944], "auto", "effect", { acts: [{ k: "envPhase", cost: "full", target: { who: "enemy", n: [1, 1] }, effect: { kind: "status", id: "trapped", on: "target", data: { dice: -2, attr: "strength" } }, sameZone: 1 }] }),      // Z11: STRENGTH with -2 to break free
  P("Life Support", [1947], "assist", "outcome", { cost: "none", pass: { vacuumSafe: 1 } }),
  B("Life Support", "Effective Support", [1948], "hand", "story", { why: "outOfFight" }),
  L("Life Support", "Breathing Only", [1949, 1950], "hand", "story", { why: "outOfFight" }),
  P("Quickness", [1953], "auto", "effect", { acts: [{ k: "quickness", cost: "none", effect: { kind: "grant", template: "quickness" }, once: "round", anytime: 1 }] }),
  P("Shapeshifting", [1956], "assist", "outcome", { cost: "full" }),
  B("Shapeshifting", "Potent Form", [1957], "auto", "toggle", { fx: { cost: "none" } }),
  L("Shapeshifting", "Specific Form", [1958], "hand", "story", { why: "gmJudges" }),
  P("Signature Item", [1961, 1965, 1966, 1967, 1968], "auto", "sheet", { acts: [] }),
  B("Signature Item", "Blocking Item", [1969], "auto", "sheet"),
  B("Signature Item", "Throwable Item", [1970], "auto", "attack", { throwOf: 1 }),
  L("Signature Item", "Item Dependent", [1971], "hand", "source", { why: "sheetNumbers" }),
  P("Size Alteration", [1974, 1975, 1976, 1977, 1978, 1979], "auto", "size", { fx: { cost: "full" }, size: [2, 3, 4, 5] }),
  L("Size Alteration", "Grow Only", [1980], "auto", "size", { sizeOnly: "grow", alt: "huge" }),
  L("Size Alteration", "Shrink Only", [1981], "auto", "size", { sizeOnly: "shrink", alt: "tiny" }),
  P("Transformation", [1984, 1985, 1986, 1987, 1988], "assist", "outcome", { atk: { ignoreArmor: 1, range: [0, 0] }, acts: [narr("matter", "full")] }),
  L("Transformation", "Temporary Transformation", [1989], "hand", "story", { why: "outOfFight" }),

  /* ================================================================ MOVEMENT POWERS [B1992-2042] */
  moveRow("Burrowing", [1995]), B("Burrowing", "Tunneling", [1996], "auto", "move", { mv: 1 }),
  moveRow("Flight", [1999, 2000, 2001, 2002]), B("Flight", "Interstellar Flight", [2003], "hand", "story", { why: "outOfFight" }), L("Flight", "Gliding", [2004], "auto", "move", { mv: 1 }),
  P("Leaping", [2007, 2008, 2009, 2010], "auto", "move", { mv: 1, fx: { cost: "none", only: "leaping" } }),
  moveRow("Super-Speed", [2013, 2014, 2015, 2016]), B("Super-Speed", "Fast Tasks", [2017], "hand", "story", { why: "gmJudges" }), B("Super-Speed", "Untouchable Speed", [2018], "assist", "reaction", { mv: 1, acts: [{ k: "dash", cost: "quick", stress: 1, effect: { kind: "narrative" }, reaction: "moveAway", mode: "superSpeed" }] }),      // PWB (PW090)
  moveRow("Swimming", [2021]), B("Swimming", "Fast Swimmer", [2022], "auto", "move", { pass: { fastSwim: 1 } }), L("Swimming", "Surface Breather", [2023], "hand", "story", { why: "outOfFight" }),
  P("Swinging", [2027, 2028, 2029], "auto", "move", { mv: 1, atk: { noDamage: 1, stunts: "none", pull: 1 } }),
  B("Swinging", "Fast Swinging", [2030], "auto", "move", { pass: { fastSwing: 1 } }), L("Swinging", "Brachiation", [2031], "auto", "move", { mv: 1 }),
  moveRow("Teleportation", [2034, 2035, 2036, 2037]), B("Teleportation", "Teleport Allies", [2038], "assist", "move", { mv: 1 }), B("Teleportation", "Quick Teleport", [2039], "assist", "reaction", { mv: 1, acts: [{ k: "blink", cost: "quick", stress: 1, effect: { kind: "narrative" }, reaction: "moveAway", mode: "teleportation" }] }),      // PWB (PW090)
  B("Teleportation", "Portal", [2040], "assist", "outcome", { cost: "full" }), B("Teleportation", "Distant Travel", [2041], "hand", "story", { why: "outOfFight" }), L("Teleportation", "Specific Location (Teleport)", [2042], "hand", "story", { why: "gmJudges" }),

  /* ================================================================ SENSORY POWERS [B2045-2091] */
  P("Clairvoyance", [2048, 2049, 2050, 2051, 2052], "assist", "outcome", { cost: "full" }),
  L("Clairvoyance", "Specific Location (CLAIRVOYANCE)", [2053], "hand", "story", { why: "gmJudges" }),
  P("Danger Sense", [2058], "hand", "initiative", { why: "beforeFight" }),
  P("Detection", [2061], "assist", "outcome", { cost: "quick" }),
  P("Empathy", [2064], "assist", "effect", { acts: [{ k: "sense", cost: "full", effect: { kind: "narrative" }, text: 1 },
    { k: "sap", cost: "full", roll: { attr: "presence" }, target: { who: "enemy", n: [1, 1] }, effect: { kind: "sap", per: 1 }, sameZone: 1 },
    { k: "soothe", cost: "full", roll: { attr: "presence" }, target: { who: "ally", n: [1, 1] }, effect: { kind: "gainResolve", per: 3 }, sameZone: 1 }] }),
  B("Empathy", "Mass Empathy", [2065], "assist", "outcome", { acts: [narr("mass", "full", { stress: 1, roll: { attr: "presence" } })] }),
  P("Enhanced Senses", [2068], "assist", "outcome", { cost: "none" }),
  B("Enhanced Senses", "Detect Lies", [2069], "hand", "story", { why: "senses" }), B("Enhanced Senses", "Penetrating Sense", [2070], "hand", "story", { why: "senses" }),
  L("Enhanced Senses", "Specific Sense", [2071], "hand", "story", { why: "gmJudges" }), L("Enhanced Senses", "Reduced Sense", [2072], "hand", "story", { why: "gmJudges" }),
  P("Invisibility", [2075], "auto", "effect", { acts: [{ k: "vanish", cost: "quick", effect: { kind: "status", id: "invisible", on: "self", toggle: 1 } }] }),
  P("Postcognition", [2078], "hand", "story", { why: "senses" }),
  P("Precognition", [2081, 2082], "assist", "outcome", { cost: "full" }),
  P("Telepathy", [2085, 2086, 2087], "assist", "outcome", { cost: "quick", keep: 1, by: { "read deeper thoughts": { cost: "full", target: { who: "any", n: [0, 1] }, oppose: { attr: "presence", who: "target", optional: true } } },      // PWD (PW118) [B2086]: opposed by PRESENCE if resisted
    acts: [narr("sense", "quick", { roll: { attr: "intuition" } })] }),      // [B2087]: lifeforms within 3 zones
  B("Telepathy", "Distant Telepathy", [2088], "assist", "outcome", { acts: [narr("distant", "quick", { stress: 1 })] }), B("Telepathy", "Telepathic Link", [2089], "assist", "outcome", { acts: [narr("link", "full", { stress: 1 })] }), B("Telepathy", "Memory Alteration", [2090], "assist", "outcome", { cost: "full" }),
  L("Telepathy", "Read Only", [2091], "hand", "story", { why: "gmJudges" }),

  /* ================================================================ TALENTS [B2094-2171] */
  T("Analysis", [2097], "hand", "scene", { why: "outOfFight" }),
  T("Bigger They Are", [2098], "auto", "roll", { own: 1, mods: [{ dice: 2, attack: ["slugfest", "grappleAttack"], vsHuge: 1 }], acts: [] }),
  T("Charger", [2099], "auto", "sheet"),
  T("Combat Veteran", [2100], "auto", "initiative"),
  T("Commander", [2101], "auto", "effect", { acts: [{ k: "orders", cost: "quick", as: "orders" }] }),
  T("Compelling", [2102], "auto", "system"), T("Coordinated", [2103], "auto", "system"), T("Cunning", [2104], "auto", "system"),
  T("Defensive", [2105], "auto", "reaction", { pass: { defensive: 1 }, acts: [] }),
  T("Deflection", [2106], "auto", "passive", { pass: { deflection: 1 } }),
  T("Determined", [2107], "auto", "sheet"),
  T("Discretion", [2108], "assist", "reaction", { acts: [{ k: "discretion", cost: "none", stress: 1, roll: { attr: "presence" }, effect: { kind: "narrative" }, reaction: "allySwap", place: "allyZone" }] }),
  T("Duck & Weave", [2109], "auto", "passive", { pass: { duckWeave: 1 } }),
  T("Durable", [2110], "auto", "sheet"),
  T("Evasive", [2111], "auto", "sheet"),
  T("Fast Reflexes", [2112], "auto", "initiative"),
  T("Find Weakness", [2113], "assist", "stunt", { pass: { findWeakness: 1 } }),
  T("Formidable", [2114], "auto", "system"),
  T("Guardian", [2115], "assist", "reaction", { acts: [{ k: "guardian", cost: "quick", effect: { kind: "narrative" }, reaction: "swapTarget", place: "targetZone", check: "attack" }] }),
  T("Hard Hitter", [2116], "auto", "token", { own: 1, acts: [{ k: "windup", cost: "quick", effect: { kind: "aim", dice: 2, rolls: ["attack"], attrs: ["fighting"], until: "roundEnd" } }] }),
  T("Indomitable", [2117], "hand", "roll", { why: "systemRoll" }),
  T("Insightful", [2118], "auto", "system"),
  T("Inspiration", [2119], "auto", "effect", { acts: [{ k: "inspire", cost: "quick", target: { who: "ally", n: [1, 1] }, pick: ["1", "2", "3", "4", "5"], effect: { kind: "inspire" } }] }),
  T("Investigator", [2120], "hand", "scene", { why: "outOfFight" }),
  T("Killer", [2121], "auto", "critTwice", { pass: { killer: 1 } }),
  T("Knowledgeable", [2146], "assist", "roll", { names: ["Knowledgeable (Current Events)", "Knowledgeable (Esoteric Lore)", "Knowledgeable (Humanities)", "Knowledgeable (Natural Sciences)", "Knowledgeable (Social Sciences)", "Knowledgeable (Technology)"], cost: "quick", prefix: 1 }),
  T("Leader", [2147], "auto", "effect", { acts: [{ k: "speech", cost: "full", stress: 1, roll: { attr: "presence" }, effect: { kind: "resolveAll" } }] }),
  T("Loner", [2148], "hand", "scene", { why: "outOfFight" }),
  T("Lucky Break", [2149], "auto", "critTwice", { pass: { luckyBreak: 1 } }),
  T("Manipulator", [2150], "assist", "roll", { acts: [{ k: "manipulate", cost: "full", as: "persuade", dice: 2 }] }),
  T("Martial Arts", [2151], "auto", "attack", { own: 1, acts: [{ k: "quickStrike", cost: "quick", as: "slugfest", dice: -2, unarmed: 1 }] }),
  T("Medic", [2152], "auto", "roll", { mods: [{ dice: 2, action: ["stabilize"], attr: "reason" }], acts: [{ k: "medicRally", cost: "full", as: "rally", attr: "reason", other: 1 }] }),
  T("Menacing", [2153], "assist", "roll", { acts: [{ k: "menace", cost: "full", as: "persuade", attr: "strength", dice: 2 }] }),
  T("Merciless", [2154], "auto", "passive", { pass: { merciless: 1 } }),
  T("Mighty", [2155], "auto", "system"),
  T("Motivator", [2156], "auto", "effect", { acts: [{ k: "motivate", cost: "quick", as: "rally", dice: 2, other: 1 }] }),
  T("Pilot", [2157], "auto", "roll", { mods: [{ dice: 2, action: ["vehicleHandle", "ram"], attr: "agility" }], acts: [] }),
  T("Rapid Fire", [2158], "auto", "attack", { own: 1, acts: [{ k: "quickShot", cost: "quick", as: "shoot", dice: -2 }] }),
  T("Renowned", [2159], "hand", "story", { why: "sheetNumbers" }),
  T("Resilience", [2160], "assist", "effect", { acts: [{ k: "resilience", cost: "none", pick: ["1", "2", "3", "4", "5", "6"], effect: { kind: "convert" } }] }),
  T("Second Wind", [2161], "auto", "effect", { acts: [{ k: "secondWind", cost: "full", as: "rally", attr: "strength", self: 1 }] }),
  T("Sharp-Tongued", [2162], "auto", "roll", { mods: [{ dice: 2, action: ["banter"] }], acts: [] }),
  T("Sniper", [2163], "auto", "token", { own: 1, acts: [{ k: "aim", cost: "quick", effect: { kind: "aim", dice: 2, rolls: ["attack"], attrs: ["agility"] } }] }),
  T("Stealthy", [2164], "hand", "initiative", { why: "beforeFight" }),
  T("Streetwise", [2165], "hand", "initiative", { why: "beforeFight" }),
  T("Subdue", [2166], "auto", "sheet"),
  T("Supportive", [2167], "auto", "passive", { pass: { supportive: 1 } }),
  T("Tactical Support", [2168], "assist", "token", { acts: [{ k: "support", cost: "none", target: { who: "ally", n: [1, 1] }, pick: ["1", "2", "3"], effect: { kind: "support", per: 2 } }] }),
  T("Unconventional Wisdom", [2169], "assist", "outcome", { acts: [narr("wisdom", "none", { roll: { attr: "intuition" } })] }),
  T("Warning Call", [2170], "assist", "reaction", { acts: [{ k: "warn", cost: "quick", effect: { kind: "narrative" }, reaction: "warn" }] }),
  T("Windfall", [2171], "hand", "story", { why: "sheetNumbers" }),

  /* ================================================================ DRAWBACKS [B2174-2193] */
  D("Alternate Form", [2179], "assist", "source", { fx: { cost: "full", stress: 1 } }),
  D("Bloodlust", [2180], "hand", "gmCard", { why: "roleplay" }),
  D("Cursed", [2181], "assist", "toggle", { fx: { cost: "none", gm: 1 } }),
  D("Frightful", [2182], "hand", "story", { why: "gmJudges" }),
  D("Gear Dependent", [2183], "assist", "off", { acts: [] }),
  D("Hard Times", [2184], "hand", "story", { why: "sheetNumbers" }),
  D("Obsessed", [2185], "assist", "toggle", { fx: { cost: "none", gm: 1 } }),
  D("Overconfident", [2186], "auto", "passive", { pass: { overconfident: 1 }, acts: [] }),
  D("Phobic", [2187], "assist", "resist", { acts: [{ k: "phobia", cost: "none", effect: { kind: "resist", attr: "presence", forfeit: 1 } }] }),
  D("Power Loss", [2188], "assist", "off", { acts: [] }),
  D("Reliant", [2189], "assist", "toggle", { fx: { cost: "none", gm: 1 } }),
  D("Stranger", [2190], "hand", "story", { why: "gmJudges" }),
  D("Super Suit", [2191], "assist", "source", { fx: { cost: "full" } }),
  D("Targeted", [2192], "hand", "story", { why: "story" }),
  D("Vulnerable", [2193], "assist", "flag", { pass: { vulnerable: "flag" } }),

  /* ================================================================ GEAR: weapons [B2531-2676], armor [B2682-2700], other gear [B3254-3360] */
  ...["Blunt melee weapon", "Sharp melee weapon", "Taser", "Pepper Spray", "Handgun", "Shotgun", "Hunting rifle", "Sniper rifle", "Submachine gun", "Assault rifle", "Machinegun", "Plasma rifle"].map((n) => G(n, [2531, 2676], "auto", "weapon", { weapon: 1 })),
  ...["Hand grenade", "Rocket launcher", "Cruise missile", "Nuclear missile"].map((n) => G(n, [2531, 2676], "auto", "weapon", { weapon: 1, single: 1 })),
  G("Smoke grenade", [2531, 2676], "assist", "zone", { weapon: 1 }),
  ...["Kevlar vest", "Riot gear", "Archaic armor"].map((n) => G(n, [2682, 2700], "auto", "sheet")),
  ...["Air-to-air missile launcher", "Autocannon", "Energy torpedo", "Flamethrower", "Plasma cannon", "Ship laser", "Tactical missile launcher", "Tank cannon", "Turbolaser battery"].map((n) => G(n, [3149, 3219], "assist", "vehicle", { weapon: 1, mounted: 1 })),
  G("Medical instruments", [3309, 2777], "auto", "passive", { needs: "Medic", pass: { medicalGear: 1 }, mods: [{ dice: 2, action: ["stabilize"], item: 1 }], acts: [] }),      // [B3309]: "Requires the Medic talent" [B2152]
  G("First aid kit", [3254, 3360], "assist", "roll", { cost: "full", prefix: 1 }),
  ...["Binoculars", "Drone, personal", "Laboratory instruments", "Supercomputer", "Tools, aerial vehicle", "Tools, armor", "Tools, general", "Tools, ground vehicle", "Tools, weapons"].map((n) => G(n, [3254, 3360], "assist", "roll", { cost: "full", prefix: 1 })),
  ...["Handcuffs", "Electronic restraints"].map((n) => G(n, [3322, 3329], "assist", "gmCard", { cost: "full", prefix: 1 })),
  ...["Comic book collection", "Compact mechanical gills (C.M.G.)", "Computer", "Nano tracer"].map((n) => G(n, [3254, 3360], "hand", "story", { why: "story" })),
]);
