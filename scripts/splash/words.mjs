/* WORDPOOL (ADVX 16): WHICH WORD a roll's splash shows. PURE (no DOM, no Foundry).
   Before: the word came from a pool per "action" (slugfest, charge, grapple, block, dodge, shooting, reason, intuition, presence) and
   everything else fell into one GENERIC pool (POW! BOOM! WHAM! KAPOW! ZOOM!): a plain fighting roll, a power used outside the system's
   attack dialog, every roll of a tactical fight (its dialog has no attack data) and every power that is not a punch or a gun drew a
   random sound from it, ZOOM! for a punch's critical, BOOM! for a fireless blast. And the rank of the result did not choose at all.
   Now the word is chosen from WHAT THE ACTION IS, in this order (familyOf):
     1. a defence of the tactics (roll key "def:*"): block (FIGHTING) or dodge (AGILITY);
     2. the system's own Block / Dodge / Charge / Grapple roll (its localised name in the roll's title, sys-labels);
     3. the power or gear behind the roll (its English data name, the tactics kit row, the automation's name, the roll's title), by the
        words in it (RULES: fire, lightning, ice, sound, mind, teleport, healing ... in English and Polish), first rule that matches;
     4. the attack the system says it is (slugfest / shooting / charge / grapple / ram), a shooting POWER with no telling name is an
        energy blast (the book's Blast: beams, bolts), a shooting weapon a gun;
     5. the attribute rolled (FIGHTING = a blow, AGILITY = movement, STRENGTH = a feat of strength, REASON / INTUITION / PRESENCE);
     6. nothing known: a neutral success shout (generic: no sound of any kind of hit).
   So a new or unknown power still gets a fitting word: by its name, else by its attack, else by its attribute.
   Each family has words per RANK of the result (wordRank: ordinary < 0.46 <= strong < 0.7 <= critical, by the result's power, the same on
   every seat; 0.46 is where the roll's impact frame starts, 0.7 the default critical) and its own misses (the neutral ones plus a fitting
   one: a swing WHIFF!s, a power FIZZLE!s, a heavy thing goes CLUNK!).
   The owner's rulings (binding): sound words are onomatopoeia, no Polish letters, English first; BOOM / BUM only for a blast WITH fire
   (family fire), a fireless one is KROOM; POW / WHAM / BAM / THUD stay; an ACTION word may be a plain word and is shown in Polish only
   where a Polish word sounds good, as the NOUN of the action (logic.mjs SFX_KEYS, lang.mjs INSPLASH.Word.*). The event carries the English
   word: every seat letters the same word at the same moment, a Polish seat only shows its Polish text.
   The words the owner has not ruled on are listed for his veto in dev/combat-questions.md (WORDPOOL-1). */

/* a family: mood = the LETR intent of its words (letter-plan.mjs reads WORD_MOODS / FAMILY_MOODS); blow = an attack by nature (its roll's
   impact lands on the target even when the roll came without attack data); ranks: [ordinary, strong, critical]; miss = its own misses */
const F = (mood, blow, ordinary, strong, critical, miss = []) => Object.freeze({ mood, blow, ranks: Object.freeze({ ordinary: Object.freeze(ordinary), strong: Object.freeze(strong), critical: Object.freeze(critical) }), miss: Object.freeze(miss) });
export const FAMILIES = Object.freeze({
  slugfest:  F('impact', true, ['POW!', 'BAM!', 'THWACK!'], ['WHAM!', 'SMASH!', 'CRUSH!'], ['HAYMAKER!', 'KAPOW!', 'KA-THWAPP!'], ['WHIFF!']),
  charge:    F('crash', true, ['RUSH!', 'WHOOSH!'], ['CHARGE!', 'RAM!'], ['STAMPEDE!', 'KA-KROOSH!'], ['WHIFF!', 'CLUNK!']),
  grapple:   F('impact', true, ['GRAB!', 'GOTCHA!'], ['SQUEEZE!', 'LOCK!'], ['VISE!', 'CRUSH!'], ['WHIFF!']),
  block:     F('impact', false, ['GUARD!', 'THUD!'], ['BLOCK!', 'PARRY!'], ['STONEWALL!', 'SHIELD!'], ['CLUNK!']),
  dodge:     F('whoosh', false, ['ZIP!', 'SWISH!', 'DUCK!'], ['DASH!', 'FLIP!'], ['WHOOSH!', 'BLUR!'], ['CLUNK!']),
  shooting:  F('crack', true, ['BLAM!', 'BANG!'], ['KRAK!', 'BLAMM!'], ['KA-BLAM!', 'BLAM-BLAM!'], ['PTWING!']),
  blast:     F('zap', true, ['ZARK!', 'CHOOM!'], ['KSHOOM!', 'KROOM!'], ['KA-CHOOM!', 'KA-KROOM!'], ['FIZZLE!']),
  fire:      F('fire', true, ['FWOOM!', 'FOOMF!'], ['BOOM!', 'FWOOOM!'], ['KA-BOOM!', 'FAWOOOSH!'], ['FIZZLE!']),
  zap:       F('zap', true, ['ZAP!', 'BZZT!'], ['KZZT!', 'BZZAKT!'], ['KZZRAKK!', 'KRAKOOM!'], ['FIZZLE!']),
  cold:      F('crack', true, ['TSHINK!', 'TSIK!'], ['KSHINK!', 'SKRISH!'], ['SHKRAASH!', 'KSHRAKK!'], ['FIZZLE!']),
  sonic:     F('roar', true, ['SKREE!', 'VWOMF!'], ['SKREEEK!', 'VWOOOMMF!'], ['SKRREEEEK!', 'KRABWOOMM!'], ['FIZZLE!']),
  quake:     F('crash', true, ['GDUMF!', 'GRROMM!'], ['KROOM!', 'GRRRROMM!'], ['KA-KROOM!', 'KRRROOOMM!'], ['CLUNK!']),
  kinesis:   F('powerup', true, ['VWOMF!', 'FHOMF!'], ['VWOOOMMF!', 'FHOOOMMF!'], ['VWOOOOMMFF!', 'KA-KROOM!'], ['FIZZLE!']),
  water:     F('splash', true, ['PLOOP!', 'GLUB!'], ['PLUNK!', 'SPLOOSH!'], ['KA-SPLOOSH!', 'SPLOOSH!'], ['FIZZLE!']),
  wind:      F('whoosh', true, ['FWOOOH!', 'SHWOOOH!'], ['VRROOOOSH!', 'HWRROOOO!'], ['SHWRRROOOOMM!', 'VRRROOOOSHH!'], ['FIZZLE!']),
  mind:      F('powerup', true, ['MMNN!', 'HMNN!'], ['VNNNN!', 'MNNNNG!'], ['VNNNNNG!', 'ZNNNNG!'], ['FIZZLE!']),
  teleport:  F('whoosh', false, ['FZIP!', 'VZIP!'], ['VWORP!', 'ZWAP!'], ['VWAMFF!', 'ZWAPP!'], ['FIZZLE!']),
  move:      F('whoosh', false, ['ZIP!', 'WHOOSH!'], ['ZOOM!', 'VSHOOM!'], ['ZWAAAMM!', 'VSHOOOM!'], ['WHIFF!', 'CLUNK!']),
  force:     F('roar', false, ['HUP!', 'HEAVE!'], ['HRRGH!', 'WRENCH!'], ['NNNRRAAH!', 'KA-KROOSH!'], ['CLUNK!']),
  heal:      F('heal', false, ['TLEEN!', 'DLEEN!'], ['TLEENG!', 'SHEENG!'], ['KLEENNG!', 'MIRACLE!'], ['FIZZLE!']),
  stealth:   F('tick', false, ['SHH!', 'PSHT!'], ['SHHHT!', 'VANISH!'], ['VANISH!', 'PSSSHHT!'], []),
  magic:     F('powerup', false, ['VMM!', 'ZMM!'], ['VZMMM!', 'BZMMM!'], ['VWAAMMM!', 'ZWOOOMM!'], ['FIZZLE!']),
  tech:      F('tick', false, ['BEEP!', 'TCHIK!'], ['BEEP-BEEP!', 'KLAK!'], ['BEEP-BEEP-BEEP!', 'ACCESS GRANTED!'], ['FIZZLE!', 'CLUNK!']),
  reason:    F('tick', false, ['CLICK!', 'AHA!'], ['EUREKA!', 'GOT IT!'], ['EUREKA!', 'GENIUS!'], []),
  intuition: F('zap', false, ['HUNCH!', 'TINGLE!'], ['SENSE!', 'HUNCH!'], ['SIXTH SENSE!', 'SENSE!'], []),
  presence:  F('roar', false, ['HUSH!', 'AHEM!'], ['COMMAND!', 'LISTEN UP!'], ['ROAR!', 'COMMAND!'], []),
  generic:   F('impact', false, ['YES!', 'DONE!'], ['BULLSEYE!', 'YES!'], ['LEGENDARY!', 'BULLSEYE!'], [])
});
export const RANKS = Object.freeze(['ordinary', 'strong', 'critical']);
/* the rank of a success, from its power (0..1, logic.mjs powerOf): one rule for every seat (no seat setting enters it) */
export const STRONG_W = 0.46, CRIT_W = 0.7;
export const wordRank = (P) => (P >= CRIT_W ? 'critical' : P >= STRONG_W ? 'strong' : 'ordinary');
export const familyId = (a) => (Object.hasOwn(FAMILIES, a) ? a : 'generic');
export const poolFor = (family, P) => FAMILIES[familyId(family)].ranks[wordRank(P ?? 0)];
/* the misses every action may have (a reaction to the result, not a sound of the action) */
export const MISS_ANY = Object.freeze(['OOPS!', 'YIKES!', 'BLUNDER!']);
export const missFor = (family) => [...MISS_ANY, ...FAMILIES[familyId(family)].miss];
export const FAMILY_MOODS = Object.freeze(Object.fromEntries(Object.entries(FAMILIES).map(([k, f]) => [k, f.mood])));
/* every success word -> its mood (the LETR intent: the look and motion that fit its sound); a word shared by two families keeps its first */
export const WORD_MOODS = Object.freeze((() => {
  const o = {};
  const SPECIAL = { 'RUSH!': 'whoosh', 'WHOOSH!': 'whoosh', 'CHARGE!': 'roar', 'STAMPEDE!': 'roar', 'SQUEEZE!': 'roar', 'LOCK!': 'crack', 'VISE!': 'crack',
    'CRUSH!': 'crash', 'SMASH!': 'crash', 'PARRY!': 'crack', 'KROOM!': 'boom', 'KA-KROOM!': 'boom', 'KA-CHOOM!': 'boom', 'KSHOOM!': 'boom', 'BOOM!': 'boom',
    'KA-BOOM!': 'boom', 'KRAKOOM!': 'boom', 'KRABWOOMM!': 'boom', 'KA-KROOSH!': 'crash', 'SKREE!': 'crack', 'SKREEEK!': 'crack', 'SKRREEEEK!': 'crack',
    'HEAVE!': 'powerup', 'WRENCH!': 'crack', 'EUREKA!': 'powerup', 'GENIUS!': 'powerup', 'MIRACLE!': 'powerup', 'LEGENDARY!': 'powerup', 'ACCESS GRANTED!': 'powerup' };
  for (const [k, f] of Object.entries(FAMILIES)) for (const r of RANKS) for (const w of f.ranks[r]) if (!(w in o)) o[w] = SPECIAL[w] ?? f.mood;
  for (const w of ['WHIFF!', 'PTWING!']) o[w] = 'whoosh';
  return o;
})());
/* the success words that are SOUNDS (onomatopoeia): never translated, no Polish letters, the owner's sound rules apply. Every other success
   word is an ACTION word (a plain word: GUARD!, HAYMAKER!) with a Polish text where one sounds good (logic.mjs SFX_KEYS). */
export const ACTION_WORDS = Object.freeze(new Set(['HAYMAKER!', 'SMASH!', 'CRUSH!', 'RUSH!', 'CHARGE!', 'RAM!', 'STAMPEDE!', 'GRAB!', 'GOTCHA!', 'SQUEEZE!',
  'LOCK!', 'VISE!', 'GUARD!', 'BLOCK!', 'PARRY!', 'STONEWALL!', 'SHIELD!', 'DASH!', 'FLIP!', 'DUCK!', 'BLUR!', 'HEAVE!', 'WRENCH!', 'MIRACLE!', 'VANISH!',
  'ACCESS GRANTED!', 'GOT IT!', 'GENIUS!', 'HUNCH!', 'TINGLE!', 'SENSE!', 'SIXTH SENSE!', 'HUSH!', 'COMMAND!', 'LISTEN UP!', 'ROAR!', 'YES!', 'DONE!',
  'BULLSEYE!', 'LEGENDARY!', 'EUREKA!', 'CLICK!']));

/* ---------- what the action is ---------- */
/* a stem matches at the start of a word (Polish letters count as letters) */
const W = (...stems) => new RegExp(`(^|[^\\p{L}])(${stems.join('|')})`, 'iu');
/* the rules on the names of the power / gear / automation / roll title: first match wins (order matters: a FIREarm is a gun, a SHOCKwave
   a quake, an Ice ARMOR is cold, an Energy ABSORPTION a defence) */
export const RULES = Object.freeze([
  ['shooting', W('gun', 'pistol', 'rifle', 'firearm', 'revolver', 'shotgun', 'sniper', 'bullet', 'arrow', 'shoot', 'shot\\b', 'bow\\b', 'crossbow', 'pistolet', 'karabin', 'strzelb', 'rewolwer', 'łuk', 'strzał')],
  ['quake', W('earthquake', 'quake', 'tremor', 'seism', 'shockwave', 'ground pound', 'burrow', 'tectonic', 'trzęsien', 'wstrząs', 'kopan')],
  ['fire', W('fire', 'flame', 'flaming', 'burn', 'pyro', 'inferno', 'heat', 'lava', 'magma', 'napalm', 'ogie', 'ogni', 'ognist', 'płom', 'płon', 'pożar', 'żar')],
  ['zap', W('lightning', 'electr', 'shock', 'thunder', 'storm hammer', 'taser', 'volt', 'spark', 'battery', 'discharge', 'piorun', 'błyskaw', 'elektr', 'iskr')],
  ['cold', W('cold', 'ice', 'frost', 'freez', 'cryo', 'snow', 'lód', 'lod', 'mróz', 'mroź', 'zamraż', 'śnie')],
  ['mind', W('mind', 'mental', 'psych', 'psion', 'telepath', 'brain', 'illusion', 'phantasm', 'dream', 'umysł', 'mentaln', 'psych', 'telepat', 'iluzj')],
  ['sonic', W('sonic', 'sound', 'scream', 'distress', 'battle cry', 'shout', 'sonar', 'sono', 'vibrat', 'dźwięk', 'krzyk', 'wrzask', 'sonar')],
  ['teleport', W('teleport', 'portal', 'dimension', 'warp', 'blink', 'jaunt', 'teleport', 'wymiar')],
  ['heal', W('heal', 'regenerat', 'first aid', 'medic', 'medical', 'restor', 'cure', 'lecz', 'regener', 'apteczk', 'medyczn')],
  ['stealth', W('invisib', 'camoufl', 'intangib', 'phas', 'stealth', 'shadow step', 'niewidz', 'kamufl', 'niematerial')],
  ['water', W('water', 'hydro', 'wave', 'tide', 'swim', 'aqua', 'wod', 'pływ', 'fal')],
  ['wind', W('weather', 'wind', 'cyclone', 'tornado', 'hurricane', 'gust', 'pogod', 'wiatr', 'cyklon', 'huragan')],
  ['kinesis', W('telekin', 'gravity', 'grav', 'magnet', 'matter', 'force push', 'grawit', 'magnet', 'materi')],
  ['tech', W('technolog', 'tech', 'hack', 'cyber', 'computer', 'drone', 'robot', 'gadget', 'komputer', 'dron', 'technolog')],
  ['magic', W('sorcer', 'spell', 'magic', 'arcane', 'summon', 'luck', 'nullif', 'darkness', 'shadow', 'mimicry', 'duplicat', 'shapeshift', 'transform', 'size alter', 'czar', 'magi', 'przywoł', 'szczęści', 'ciemnoś', 'cień')],
  ['block', W('barrier', 'shield', 'protect', 'armor', 'armour', 'absor', 'defian', 'immun', 'immortal', 'life support', 'adaptation', 'bariera', 'tarcz', 'ochron', 'pancerz', 'zbroj', 'odporn')],
  ['grapple', W('grapple', 'grab', 'snare', 'web', 'net\\b', 'limb', 'tentacle', 'plant', 'vine', 'bola', 'chwyt', 'sieć', 'kończyn', 'macka', 'rośl', 'pnącz')],
  ['move', W('flight', 'fly', 'leap', 'jump', 'speed', 'quickness', 'swing', 'adhesion', 'run\\b', 'lot\\b', 'skok', 'szybk', 'bieg')],
  ['charge', W('charge', 'ram\\b', 'tackle', 'szarż', 'taran')],
  ['slugfest', W('strike', 'punch', 'fist', 'kick', 'claw', 'sword', 'blade', 'hammer', 'elongat', 'slugfest', 'cios', 'pięś', 'uderz', 'kopni', 'pazur', 'miecz', 'ostrz', 'młot', 'bijaty')],
  ['blast', W('blast', 'beam', 'ray', 'laser', 'energy', 'bolt', 'plasma', 'stun', 'afflict', 'emanation', 'light', 'grenade', 'missile', 'rocket', 'podmuch', 'promie', 'wiązk', 'energi', 'plazm', 'granat', 'rakiet')],
  ['intuition', W('sense', 'precog', 'postcog', 'clairvoy', 'detect', 'empath', 'danger', 'zmysł', 'wykryw', 'jasnowidz', 'empat')],
  ['reason', W('action plan', 'tactic', 'plan\\b', 'taktyk')],
  ['presence', W('guidance', 'leader', 'animal', 'command', 'order', 'przywódz', 'zwierz', 'rozkaz')]
]);
/* a family from free text (names): the first rule whose stem starts one of its words, else null */
export function familyByName(...texts) {
  const t = texts.filter((x) => typeof x === 'string' && x.trim()).join(' | ').slice(0, 400);
  if (!t) return null;
  for (const [fam, re] of RULES) if (re.test(t)) return fam;
  return null;
}
const ATTR_FAMILY = Object.freeze({ fighting: 'slugfest', agility: 'move', strength: 'force', reason: 'reason', intuition: 'intuition', presence: 'presence' });
const ATTACK_FAMILY = Object.freeze({ slugfest: 'slugfest', shooting: 'shooting', charge: 'charge', grapple: 'grapple', grappleAttack: 'grapple', ram: 'charge' });
/** what the action is -> { action: family id, attack: bool }.
    o: { attackType (system: slugfest | shooting | charge), attribute, sysAction (block | dodge | charge | grapple: the system's own roll by its
    title), names: [power / gear / automation / roll title ...], itemType (power | gear | vehicleWeapon | ...), tactics: { key, what: { a, p, n } } } */
export function familyOf(o = {}) {
  const tac = o.tactics && typeof o.tactics === 'object' ? o.tactics : null, what = tac?.what && typeof tac.what === 'object' ? tac.what : null;
  const key = String(tac?.key ?? '');
  const attack = String(what?.a ?? o.attackType ?? '');
  const isAttack = !!ATTACK_FAMILY[attack] || key === 'attack';
  const out = (action) => ({ action, attack: isAttack });
  if (key.startsWith('def:')) return { action: o.attribute === 'agility' ? 'dodge' : 'block', attack: false };
  if (o.sysAction && Object.hasOwn(FAMILIES, o.sysAction) && !what?.p) return { action: o.sysAction, attack: o.sysAction === 'charge' || o.sysAction === 'grapple' || isAttack };
  /* the most telling name first: the tactics kit row (the power's English key), its item, then the caller's names in their order */
  let named = null;
  for (const n of [what?.p, what?.n, ...(Array.isArray(o.names) ? o.names : [])]) if ((named = familyByName(n))) break;
  if (named) return out(named);
  if (ATTACK_FAMILY[attack]) {
    const fam = ATTACK_FAMILY[attack];
    /* the book's Blast is beams, bolts, arrows: a shooting POWER with no telling name is an energy blast; a weapon (gear) is a gun */
    if (fam === 'shooting' && (what?.p || o.itemType === 'power')) return { action: 'blast', attack: true };
    return { action: fam, attack: true };
  }
  if (ATTR_FAMILY[o.attribute]) return out(ATTR_FAMILY[o.attribute]);
  return out('generic');
}
