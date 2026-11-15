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
   one: a swing goes FWUFF!, a power PFZZT!s, a heavy thing goes GDONK!).
   The owner's rulings (binding): sound words are onomatopoeia, no Polish letters, English first; BOOM / BUM only for a blast WITH fire
   (family fire), a fireless one is KROOM; POW / WHAM / BAM / THUD stay; an ACTION word may be a plain word and is shown in Polish only
   where a Polish word sounds good, as the NOUN of the action (logic.mjs SFX_KEYS, lang.mjs INSPLASH.Word.*). The event carries the English
   word: every seat letters the same word at the same moment, a Polish seat only shows its Polish text.
   The words the owner has not ruled on are listed for his veto in dev/combat-questions.md (WORDPOOL-1). */

/* a family: mood = the LETR intent of its words (letter-plan.mjs reads WORD_MOODS / FAMILY_MOODS); blow = an attack by nature (its roll's
   impact lands on the target even when the roll came without attack data); ranks: [ordinary, strong, critical]; miss = its own misses */
const F = (mood, blow, ordinary, strong, critical, miss = []) => Object.freeze({ mood, blow, ranks: Object.freeze({ ordinary: Object.freeze(ordinary), strong: Object.freeze(strong), critical: Object.freeze(critical) }), miss: Object.freeze(miss) });
export const FAMILIES = Object.freeze({
  slugfest:  F('impact', true, ['POW!', 'BAM!', 'THWAP!'], ['WHAM!', 'SMASH!', 'CRUSH!'], ['HAYMAKER!', 'WHAMM!', 'KA-THWAPP!'], ['FWUFF!']),
  charge:    F('crash', true, ['RUSH!', 'FWOOSH!'], ['CHARGE!', 'RAM!'], ['STAMPEDE!', 'KA-KROOSH!'], ['FWUFF!', 'GDONK!']),
  grapple:   F('impact', true, ['GRAB!', 'CLINCH!'], ['SQUEEZE!', 'LOCK!'], ['VISE!', 'CRUSH!'], ['FWUFF!']),
  block:     F('impact', false, ['GUARD!', 'THUD!'], ['BLOCK!', 'PARRY!'], ['STONEWALL!', 'SHIELD!'], ['GDONK!']),
  dodge:     F('whoosh', false, ['VWISH!', 'FSHH!', 'DODGE!'], ['DASH!', 'FLIP!'], ['FWOOOSHH!', 'BLUR!'], ['GDONK!']),
  shooting:  F('crack', true, ['BLAM!', 'KTAK!'], ['KRAK!', 'BLAMM!'], ['KA-BLAM!', 'BLAM-BLAM!'], ['PTWING!']),
  blast:     F('zap', true, ['ZARK!', 'CHOOM!'], ['KSHOOM!', 'KROOM!'], ['KA-CHOOM!', 'KA-KROOM!'], ['PFZZT!']),
  fire:      F('fire', true, ['FWOOM!', 'FOOMF!'], ['BOOM!', 'FWOOOM!'], ['KA-BOOM!', 'FAWOOOSH!'], ['PFZZT!']),
  zap:       F('zap', true, ['ZZAKT!', 'BZZT!'], ['KZZT!', 'BZZAKT!'], ['KZZRAKK!', 'KRAKOOM!'], ['PFZZT!']),
  cold:      F('crack', true, ['TSHINK!', 'TSIK!'], ['KSHINK!', 'SKRISH!'], ['SHKRAASH!', 'KSHRAKK!'], ['PFZZT!']),
  sonic:     F('roar', true, ['SKREE!', 'VWOMF!'], ['SKREEEK!', 'VWOOOMMF!'], ['SKRREEEEK!', 'KRABWOOMM!'], ['PFZZT!']),
  quake:     F('crash', true, ['GDUMF!', 'HRROMM!'], ['KROOM!', 'HRRRROMM!'], ['KA-KROOM!', 'KRRROOOMM!'], ['GDONK!']),
  kinesis:   F('powerup', true, ['VWOMF!', 'FHOMF!'], ['VWOOOMMF!', 'FHOOOMMF!'], ['VWOOOOMMFF!', 'KA-KROOM!'], ['PFZZT!']),
  water:     F('splash', true, ['PLOOP!', 'GLUB!'], ['PLUNK!', 'SPLOOSH!'], ['KA-SPLOOSH!', 'SPLOOSH!'], ['PFZZT!']),
  wind:      F('whoosh', true, ['FWOOOH!', 'SHWOOOH!'], ['VRROOOOSH!', 'HWRROOOO!'], ['SHWRRROOOOMM!', 'VRRROOOOSHH!'], ['PFZZT!']),
  mind:      F('powerup', true, ['MMNN!', 'HMNN!'], ['VNNNN!', 'MNNNNG!'], ['VNNNNNG!', 'ZNNNNG!'], ['PFZZT!']),
  teleport:  F('zap', false, ['FZIP!', 'VZIP!'], ['VWORP!', 'ZWAP!'], ['VWAMFF!', 'ZWAPP!'], ['PFZZT!']),
  move:      F('whoosh', false, ['VSHEEN!', 'FWOOSH!'], ['ZWAAM!', 'VSHOOM!'], ['ZWAAAMM!', 'VSHOOOM!'], ['FWUFF!', 'GDONK!']),
  force:     F('roar', false, ['HNH!', 'HEAVE!'], ['HRRGH!', 'WRENCH!'], ['NNNRRAAH!', 'KA-KROOSH!'], ['GDONK!']),
  heal:      F('heal', false, ['TLEEN!', 'DLEEN!'], ['TLEENG!', 'SHEENG!'], ['KLEENNG!', 'MIRACLE!'], ['PFZZT!']),
  stealth:   F('whoosh', false, ['SHHT!', 'PSHT!'], ['SHHHT!', 'VANISHING!'], ['VANISHING!', 'PSSSHHT!'], []),
  magic:     F('powerup', false, ['VMM!', 'ZMM!'], ['VZMMM!', 'BZMMM!'], ['VWAAMMM!', 'ZWOOOMM!'], ['PFZZT!']),
  tech:      F('tick', false, ['BIP!', 'TCHIK!'], ['BIP-BIP!', 'KLAK!'], ['BIP-BIP-BIP!', 'FULL ACCESS!'], ['PFZZT!', 'GDONK!']),
  reason:    F('tick', false, ['KTIK!', 'IDEA!'], ['DISCOVERY!', 'SOLUTION!'], ['DISCOVERY!', 'GENIUS!'], []),
  intuition: F('zap', false, ['HUNCH!', 'TINGLE!'], ['SENSE!', 'HUNCH!'], ['SIXTH SENSE!', 'SENSE!'], []),
  presence:  F('roar', false, ['SILENCE!', 'AURA!'], ['COMMAND!', 'ATTENTION!'], ['WRRAAAGH!', 'COMMAND!'], []),
  generic:   F('impact', false, ['SUCCESS!', 'FEAT!'], ['BULLSEYE!', 'TRIUMPH!'], ['LEGEND!', 'BULLSEYE!'], [])
});
export const RANKS = Object.freeze(['ordinary', 'strong', 'critical']);
/* the rank of a success, from its power (0..1, logic.mjs powerOf): one rule for every seat (no seat setting enters it) */
export const STRONG_W = 0.46, CRIT_W = 0.7;
export const wordRank = (P) => (P >= CRIT_W ? 'critical' : P >= STRONG_W ? 'strong' : 'ordinary');
export const familyId = (a) => (Object.hasOwn(FAMILIES, a) ? a : 'generic');
export const poolFor = (family, P) => FAMILIES[familyId(family)].ranks[wordRank(P ?? 0)];
/* the misses every action may have (a reaction to the result, not a sound of the action) */
export const MISS_ANY = Object.freeze(['MISHAP!', 'FIASCO!', 'BLUNDER!']);   // WORDS4: OOPS! YIKES! (exclamations, not nouns) -> the nouns of the failing
export const missFor = (family) => [...MISS_ANY, ...FAMILIES[familyId(family)].miss];
export const FAMILY_MOODS = Object.freeze(Object.fromEntries(Object.entries(FAMILIES).map(([k, f]) => [k, f.mood])));
/* WORDPOOL2: HOW each word sounds, so the engine draws it in the manner of that sound (no fallback): every word of every family and rank
   names its MOOD (the LETR intent: hand, colours, legacy motion) and its engine KIND (the row of the invincible motion table, motion.mjs
   KIND_MOTION: entrance, hold, exit, rhythm of that very sound). Mood and kind are read from the engine's own vocabulary where the word is
   the engine's word (THWAP! = punch, TSHINK! = shatter, FZIP! = teleport, MMNN! = psychic, TLEEN! = chime, SHHT! = shush, BIP! = beep,
   HRROMM! = rumble); an action word takes the sound of the action it names (SQUEEZE! strains: effort; PARRY! rings: clang; DODGE! passes:
   whiff). Keyed per family: KA-KROOM! is a fireless blast in `blast`, a quake's rumble in `quake`. Every seat reads the same table from
   the English word, so the moment stays the same on every seat. */
const S = (txt) => Object.freeze(Object.fromEntries(txt.trim().split(/\s*;\s*/).map((p) => { const [w, mk] = p.split('='); const [mood, kind] = mk.split('/'); return [w.trim(), Object.freeze({ mood, kind })]; })));
export const SOUND = Object.freeze({
  slugfest:  S('POW!=impact/punch; BAM!=impact/punch; THWAP!=impact/punch; WHAM!=impact/punch; SMASH!=crash/smash; CRUSH!=crash/smash; HAYMAKER!=impact/smash; WHAMM!=impact/smash; KA-THWAPP!=impact/smash'),
  charge:    S('RUSH!=whoosh/zoom; FWOOSH!=whoosh/whoosh; CHARGE!=roar/stomp; RAM!=crash/smash; STAMPEDE!=crash/stomp; KA-KROOSH!=crash/smash'),
  grapple:   S('GRAB!=impact/slap; CLINCH!=impact/slap; SQUEEZE!=roar/effort; LOCK!=crack/crack; VISE!=crash/effort; CRUSH!=crash/smash'),
  block:     S('GUARD!=impact/thud; THUD!=impact/thud; BLOCK!=impact/thud; PARRY!=crack/clang; STONEWALL!=crash/stomp; SHIELD!=crack/clang'),
  dodge:     S('VWISH!=whoosh/whoosh; FSHH!=whoosh/whoosh; DODGE!=whoosh/whiff; DASH!=whoosh/zoom; FLIP!=whoosh/whoosh; FWOOOSHH!=whoosh/whoosh; BLUR!=whoosh/zoom'),
  shooting:  S('BLAM!=impact/pistol; KTAK!=crack/rifle; KRAK!=crack/rifle; BLAMM!=crack/rifle; KA-BLAM!=crack/shotgun; BLAM-BLAM!=impact/gunfire'),
  blast:     S('ZARK!=zap/zap; CHOOM!=zap/beam; KSHOOM!=boom/concussion; KROOM!=boom/concussion; KA-CHOOM!=boom/concussion; KA-KROOM!=boom/concussion'),
  fire:      S('FWOOM!=fire/fire; FOOMF!=fire/whump; BOOM!=boom/boom; FWOOOM!=fire/fire; KA-BOOM!=boom/boom; FAWOOOSH!=fire/fire'),
  zap:       S('ZZAKT!=zap/zap; BZZT!=zap/zap; KZZT!=zap/zap; BZZAKT!=zap/zap; KZZRAKK!=zap/zap; KRAKOOM!=boom/thunder'),
  cold:      S('TSHINK!=crack/shatter; TSIK!=crack/shatter; KSHINK!=crack/shatter; SKRISH!=crack/shatter; SHKRAASH!=crack/shatter; KSHRAKK!=crack/shatter'),
  sonic:     S('SKREE!=crack/siren; VWOMF!=boom/shockwave; SKREEEK!=crack/siren; VWOOOMMF!=boom/shockwave; SKRREEEEK!=crack/siren; KRABWOOMM!=boom/sonicboom'),
  quake:     S('GDUMF!=crash/stomp; HRROMM!=crash/rumble; KROOM!=crash/rumble; HRRRROMM!=crash/rumble; KA-KROOM!=crash/smash; KRRROOOMM!=crash/rumble'),
  kinesis:   S('VWOMF!=powerup/shockwave; FHOMF!=powerup/shockwave; VWOOOMMF!=powerup/shockwave; FHOOOMMF!=powerup/shockwave; VWOOOOMMFF!=powerup/shockwave; KA-KROOM!=crash/smash'),
  water:     S('PLOOP!=splash/drip; GLUB!=splash/squish; PLUNK!=splash/splash; SPLOOSH!=splash/splash; KA-SPLOOSH!=splash/splash'),
  wind:      S('FWOOOH!=whoosh/wind; SHWOOOH!=whoosh/wind; VRROOOOSH!=whoosh/wind; HWRROOOO!=whoosh/wind; SHWRRROOOOMM!=whoosh/tornado; VRRROOOOSHH!=whoosh/tornado'),
  mind:      S('MMNN!=powerup/psychic; HMNN!=powerup/psychic; VNNNN!=powerup/psychic; MNNNNG!=powerup/psychic; VNNNNNG!=powerup/psychic; ZNNNNG!=powerup/psychic'),
  teleport:  S('FZIP!=zap/teleport; VZIP!=zap/teleport; VWORP!=zap/teleport; ZWAP!=zap/teleport; VWAMFF!=zap/teleport; ZWAPP!=zap/teleport'),
  move:      S('VSHEEN!=whoosh/zoom; FWOOSH!=whoosh/whoosh; ZWAAM!=whoosh/zoom; VSHOOM!=whoosh/zoom; ZWAAAMM!=whoosh/zoom; VSHOOOM!=whoosh/zoom'),
  force:     S('HNH!=roar/effort; HEAVE!=roar/effort; HRRGH!=roar/effort; WRENCH!=crack/crack; NNNRRAAH!=roar/effort; KA-KROOSH!=crash/smash'),
  heal:      S('TLEEN!=heal/chime; DLEEN!=heal/chime; TLEENG!=heal/chime; SHEENG!=heal/chime; KLEENNG!=heal/chime; MIRACLE!=powerup/cheer'),
  stealth:   S('SHHT!=whoosh/shush; PSHT!=whoosh/shush; SHHHT!=whoosh/shush; VANISHING!=zap/teleport; PSSSHHT!=whoosh/shush'),
  magic:     S('VMM!=powerup/powerup; ZMM!=powerup/powerup; VZMMM!=powerup/powerup; BZMMM!=powerup/powerup; VWAAMMM!=powerup/powerup; ZWOOOMM!=powerup/powerup'),
  tech:      S('BIP!=tick/beep; TCHIK!=tick/click; BIP-BIP!=tick/beep; KLAK!=tick/click; BIP-BIP-BIP!=tick/beep; FULL ACCESS!=powerup/cheer'),
  reason:    S('KTIK!=tick/click; IDEA!=powerup/cheer; DISCOVERY!=powerup/cheer; SOLUTION!=tick/click; GENIUS!=powerup/cheer'),
  intuition: S('HUNCH!=powerup/psychic; TINGLE!=zap/zap; SENSE!=powerup/psychic; SIXTH SENSE!=powerup/psychic'),
  presence:  S('SILENCE!=whoosh/shush; AURA!=powerup/powerup; COMMAND!=roar/cheer; ATTENTION!=roar/cheer; WRRAAAGH!=roar/roar'),
  generic:   S('SUCCESS!=impact/punch; FEAT!=impact/punch; BULLSEYE!=impact/punch; TRIUMPH!=powerup/cheer; LEGEND!=powerup/cheer')
});
/* the misses: the sound of each failing (FWUFF! passes by, PFZZT! sputters, PTWING! ricochets, GDONK! falls flat); MISHAP! FIASCO! BLUNDER!
   are nouns of the failing, drawn in the engine's "fail" mood row (WORDS4: OOPS! YIKES! were exclamations) */
export const MISS_SOUND = S('FWUFF!=fail/whiff; PFZZT!=fail/fizzle; PTWING!=fail/ricochet; GDONK!=fail/thud; MISHAP!=fail/sigh; FIASCO!=fail/pain; BLUNDER!=fail/sigh');
/* the sound of a word in its family (a miss: its miss sound), or null */
export const soundOf = (word, family) => SOUND[familyId(family)]?.[word] ?? MISS_SOUND[word] ?? null;
/* every success word -> its mood, for the callers that key by the word alone (letter-plan WORD_MOOD); a word shared by two families keeps
   its first family's mood here, soundOf() gives each family its own */
export const WORD_MOODS = Object.freeze((() => {
  const o = {};
  for (const f of Object.keys(FAMILIES)) for (const [w, s] of Object.entries(SOUND[f])) if (!(w in o)) o[w] = s.mood;
  for (const [w, s] of Object.entries(MISS_SOUND)) if (!(w in o)) o[w] = s.mood;
  return o;
})());
/* the success words that are SOUNDS (onomatopoeia): never translated, no Polish letters, the owner's sound rules apply. Every other success
   word is an ACTION word (a plain word: GUARD!, HAYMAKER!) with a Polish text where one sounds good (logic.mjs SFX_KEYS). WORDPOOL2: an action
   word is the NOUN of the action, never the imperative, in both languages (the owner: «zmiażdżenie» not «zmiażdż»): DODGE! not DUCK!,
   ATTENTION! not LISTEN UP!, VANISHING! not VANISH!.
   WORDS4 (the owner's word rulings over every pool): an action word is a NOUN or noun phrase, never an order, an adverb, an exclamation or a
   sentence (GOTCHA! -> CLINCH!, GOT IT! -> SOLUTION!, AHA! -> IDEA!, EUREKA! -> DISCOVERY!, YES! -> SUCCESS!, DONE! -> FEAT!, LEGENDARY! ->
   LEGEND!, ACCESS GRANTED! -> FULL ACCESS!, HUSH! -> SILENCE!); a sound is a spelled sound, never a plain word that also means something
   (BANG! -> KTAK!, ZAP! -> ZZAKT!, BEEP! -> BIP!, SHH! -> SHHT!, CLICK! -> KTIK!, ROAR! -> WRRAAAGH!, AHEM! -> AURA!, WHIFF! -> FWUFF!,
   FIZZLE! -> PFZZT!): the engine's ICONIC list keeps some of them for its own banks only provisionally (WORD2); the owner ruled POW / WHAM /
   BAM / THUD and the water words alone. Open choices: combat-questions.md WORDS4-n. */
export const ACTION_WORDS = Object.freeze(new Set(['HAYMAKER!', 'SMASH!', 'CRUSH!', 'RUSH!', 'CHARGE!', 'RAM!', 'STAMPEDE!', 'GRAB!', 'CLINCH!', 'SQUEEZE!',
  'LOCK!', 'VISE!', 'GUARD!', 'BLOCK!', 'PARRY!', 'STONEWALL!', 'SHIELD!', 'DASH!', 'FLIP!', 'DODGE!', 'BLUR!', 'HEAVE!', 'WRENCH!', 'MIRACLE!', 'VANISHING!',
  'FULL ACCESS!', 'SOLUTION!', 'GENIUS!', 'HUNCH!', 'TINGLE!', 'SENSE!', 'SIXTH SENSE!', 'SILENCE!', 'AURA!', 'COMMAND!', 'ATTENTION!', 'SUCCESS!', 'FEAT!',
  'BULLSEYE!', 'TRIUMPH!', 'LEGEND!', 'DISCOVERY!', 'IDEA!']));

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
