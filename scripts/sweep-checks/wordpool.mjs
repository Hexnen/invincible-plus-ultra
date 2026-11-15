/* node scripts/sweep-checks/wordpool.mjs -- WORDPOOL (ADVX 16): the dice splash's word fits WHAT THE ACTION IS, at every rank of the result,
   in English and in Polish, for every action the system can roll (scripts/splash/words.mjs).
     R  the rules on every word: sound words are onomatopoeia in plain letters (no Polish letters, upper case, a shout); BOOM / BUM only for a
        blast with fire (family fire); POW / WHAM / BAM / THUD stay; no family borrows the generic shouts; ZOOM! only moves, BOOM! only burns;
        every family has its own words at every rank (two or more), the ranks differ;
     L  both languages: every action x rank x language shows a word that passes; an action word is shown in Polish only as a keyed noun
        (no imperative), else stays English on purpose (KEEP_EN); a sound word is never translated; the event keeps the English word;
     C  what the action is: every power of the book and boost (the tactics kit table), the system's own rolls, every attribute, the tactics
        defence and attack rolls, a gun, a renamed or unknown power: each gets its family, never the generic one when anything is known;
     E  the event: the word drawn comes from its family's pool at its rank (many seeds), a critical never draws an ordinary word, a punch
        never ZOOM!s; a flag cannot put another action's word on the roll; misses fit (a gun's miss is no FIZZLE!, a power's no PTWING!);
     T  where the roll's impact lands: a blow by its attack flag, a roll from before WORDPOOL by its action as before;
     W  wiring: the roll dialog hands the item and the tactics roll's `what` to the classifier, the tactics engine sends `what` with the roll. */
import fs from "node:fs";
import { ok, eq, done, summary, seeded } from "../tactics/testkit.mjs";
import * as SL from "../splash/logic.mjs";
import * as WD from "../splash/words.mjs";
import * as IP from "../splash/impact-plan.mjs";
import { classify } from "../splash/reader.mjs";
import { EN, PL } from "../splash/lang.mjs";
import { bannedIn } from "../i18n/glossary-banned.mjs";

const src = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const FAM = Object.keys(WD.FAMILIES);
const pool = (f, r) => WD.FAMILIES[f].ranks[r];
const isSound = (w) => !WD.ACTION_WORDS.has(w);
const SOUND_OK = /^[A-Z][A-Z-]*!$/;               // plain capitals, hyphens, one "!" (no Polish letters, no spaces)
const FIRE_BLAST = /B[O0]{2,}M|BU+M\b|BUM/;       // the owner: BOOM / BUM only for a blast with fire
const plLabels = () => Object.fromEntries(Object.values(SL.SFX_KEYS).map((k) => [k, PL[`INSPLASH.Word.${k}`]]));

/* ---- R: the rules on every word */
eq(WD.RANKS, ["ordinary", "strong", "critical"], "R: three ranks");
ok(FAM.length >= 20, `R: many families (${FAM.length})`);
for (const f of FAM) for (const r of WD.RANKS) {
  const p = pool(f, r);
  ok(p.length >= 2 && new Set(p).size === p.length, `R: ${f} ${r}: two or more words, no repeats (${p.join(" ")})`);
  for (const w of p) {
    if (isSound(w)) ok(SOUND_OK.test(w), `R: ${f} ${r}: the sound ${w} is plain capitals with its "!"`);
    else ok(/^[A-Z][A-Z !\x27-]*!$/.test(w), `R: ${f} ${r}: the action word ${w} is an English shout`);
    if (f !== "fire") ok(!FIRE_BLAST.test(w.replace(/-/g, "")), `R: ${f} ${r}: ${w} is no BOOM / BUM (fire only)`);
  }
}
for (const f of FAM) ok(WD.RANKS.some((r, i) => i && pool(f, r).some((w) => !pool(f, WD.RANKS[i - 1]).includes(w))), `R: ${f}: a better rank brings new words`);
ok(pool("fire", "strong").includes("BOOM!") && pool("fire", "critical").includes("KA-BOOM!"), "R: a fire blast may BOOM");
ok(pool("blast", "strong").includes("KROOM!") && pool("quake", "strong").includes("KROOM!"), "R: a fireless blast KROOMs");
for (const w of ["POW!", "WHAM!", "BAM!"]) ok(SL.ACTIONS.slugfest.includes(w), `R: ${w} stays (a blow)`);
ok(SL.ACTIONS.block.includes("THUD!"), "R: THUD! stays (a blow stopped)");
const generic = new Set(SL.ACTIONS.generic);
for (const f of FAM.filter((x) => x !== "generic")) for (const w of SL.ACTIONS[f]) ok(!generic.has(w), `R: ${f} does not borrow the generic ${w}`);
for (const w of SL.ACTIONS.generic) ok(WD.ACTION_WORDS.has(w), `R: the generic words are shouts of success, no sound of a hit (${w})`);
const where = (w) => FAM.filter((f) => SL.ACTIONS[f].includes(w));
/* WORDPOOL2: ZOOM! and KAPOW! were dictionary words (the engine's deny list): the move's ZWAAM! and the punch's WHAMM! took their places */
eq(where("ZWAAM!"), ["move"], "R: ZWAAM! only moves");
eq(where("BOOM!"), ["fire"], "R: BOOM! only burns");
eq(where("WHAMM!"), ["slugfest"], "R: WHAMM! only punches");
for (const w of Object.keys(WD.WORD_MOODS)) ok(typeof WD.WORD_MOODS[w] === "string", `R: ${w} has a mood`);
for (const f of FAM) for (const w of SL.ACTIONS[f]) ok(w in WD.WORD_MOODS, `R: every success word has its mood (${f} ${w})`);

/* ---- S (WORDPOOL2): every word is drawn in the manner of its own sound, and the sound words keep the owner's rules */
{
  const DZ = await import("../letters/design.mjs"), MO = await import("../letters/motion.mjs"), LW = await import("../letters/words.mjs");
  const LP = await import("../splash/letter-plan.mjs");
  const MOODS = new Set(DZ.MOOD_IDS), KINDS = new Set(Object.keys(MO.KIND_MOTION));
  const good = (s) => s && MOODS.has(s.mood) && KINDS.has(s.kind);
  for (const f of FAM) {
    eq(Object.keys(WD.SOUND[f]).sort(), [...SL.ACTIONS[f]].sort(), `S: ${f}: the sound table names exactly its words`);
    for (const r of WD.RANKS) for (const w of pool(f, r)) {
      const s = WD.soundOf(w, f);
      ok(good(s), `S: ${f} ${r} ${w}: its own mood and engine kind (${s?.mood}/${s?.kind})`);
      eq([LP.moodOf(w, f), LP.kindOf(w, f)], [s?.mood, s?.kind], `S: ${f} ${w}: the lettering takes that sound, no fallback`);
    }
    for (const w of SL.missFor(f)) ok(good(WD.soundOf(w, f)), `S: ${f}: the miss ${w} has its sound`);
  }
  for (const w of [...SL.PUSHPRE, ...SL.WRECK, ...SL.PUSHFAIL.filter((x) => !(x in SL.SFX_KEYS))]) ok(w in LP.WORD_MOOD && MOODS.has(LP.moodOf(w)) && KINDS.has(LP.kindOf(w)), `S: ${w}: its own mood and kind (${LP.moodOf(w)}/${LP.kindOf(w)})`);
  eq([LP.moodOf("KA-KROOM!", "blast"), LP.moodOf("KA-KROOM!", "quake"), LP.kindOf("KROOM!", "blast"), LP.kindOf("KROOM!", "quake")], ["boom", "crash", "concussion", "rumble"], "S: a word shared by two families sounds as each family's");
  const fams = new Set(FAM.map((f) => JSON.stringify(Object.values(WD.SOUND[f]).map((s) => s.kind).sort())));
  ok(fams.size >= FAM.length - 2, `S: the families are drawn in their own manners (${fams.size} different kind sets of ${FAM.length})`);
  /* the item carries the kind to the engine (stage engineOpts) */
  const evOf2 = (o) => SL.buildEvent({ newSixes: 0, rerolled: 0, pushed: false, stress: 0, ...o }, { rng: () => 0.3, st: null, dryN: 0 });
  for (const f of FAM) { const ev = evOf2({ n: 5, sixes: 3, action: f }), it = LP.planMoment(ev, {}).items.find((i) => i.role === "word"); eq(it.kind, WD.soundOf(ev.word, f).kind, `S: ${f}: the word item carries its kind (${it.kind})`); }
  ok(/if \(it\.kind\) o\.kind = it\.kind;/.test(src("../splash/stage.mjs")), "S: the stage hands the kind to the engine");
  /* the owner's sound rules, measured with the engine's own deny list and sayability: no dictionary word, no near-word, sayable, no
     Polish letter (an ICONIC word passes the deny list by itself) */
  const SOUNDS = new Set([...FAM.flatMap((f) => SL.ACTIONS[f]), ...SL.FAIL, ...SL.PUSHPRE, ...SL.PUSHFAIL, ...SL.WRECK].filter((w) => !WD.ACTION_WORDS.has(w) && !(w in SL.SFX_KEYS) && !SL.KEEP_EN.includes(w)));
  for (const w of SOUNDS) {
    const t = w.replace(/!+$/, "");
    eq(LW.refusal(t, "en", { group: "voice" }), null, `S: the sound ${w} is no English dictionary word or near-word`);
    eq(LW.sayable(t, "en"), null, `S: the sound ${w} can be said`);
    ok(!/[ĄĆĘŁŃÓŚŹŻ]/u.test(w), `S: the sound ${w} has no Polish letter`);
  }
  ok(LP.INFO_HAND.number === true && LP.CAPTION_HAND.number === true, "S: the caption and number hand letters every letter at one size (no LUCKy BREAK!)");
}

/* ---- L: both languages */
SL.setLabels({ sfx: plLabels() });
const IMPERATIVE = /(AJ|UJ|IJ|YJ|ŹDŹ|ZBURZ|ROZWAL|ŁAP|FORSUJ|TRZYMAJ|PATRZ|SŁUCHAJ|BIERZ)!$/u;
for (const f of FAM) for (const r of WD.RANKS) for (const w of pool(f, r)) {
  const pl = SL.sfxWord(w);
  ok(typeof pl === "string" && pl === pl.toLocaleUpperCase("pl") && /!$/.test(pl), `L: ${f} ${r} ${w}: the Polish seat shows a shout (${pl})`);
  if (isSound(w)) eq(pl, w, `L: the sound ${w} is not translated`);
  else if (SL.KEEP_EN.includes(w)) eq(pl, w, `L: ${w} stays English on purpose`);
  else {
    ok(w in SL.SFX_KEYS && pl !== w, `L: the action word ${w} has its Polish text (${pl})`);
    ok(!IMPERATIVE.test(pl), `L: ${w} -> ${pl}: the noun of the action, not the imperative`);
    ok(pl.trim().split(/\s+/).length <= 2, `L: ${pl}: few words`);
    eq(bannedIn(pl, `INSPLASH.Word.${SL.SFX_KEYS[w]}`), [], `L: ${pl}: no banned glossary variant`);
  }
}
for (const [w, k] of Object.entries(SL.SFX_KEYS)) eq(EN[`INSPLASH.Word.${k}`], w, `L: the English text of ${k} is the word itself`);
/* WORDPOOL2 (the owner: the NOUN of the action, never the imperative, «zmiażdżenie» not «zmiażdż»): every shown word of the splash, both
   languages, the grunts and the mutters too */
{
  const EN_IMP = /^(DUCK|LISTEN UP|VANISH|DEMOLISH|DIG DEEP|TRY AGAIN|LOOK OUT|WATCH OUT|HOLD|BRACE|GO|RUN|GET DOWN|TAKE THAT|COME ON)\b/;
  const PL_IMP = /(^|\s)\p{L}*(AJ|UJ|IJ|YJ|ŹDŹ|ZBURZ|ROZWAL|ŁAP|TRZYMAJ|PATRZ|SŁUCHAJ|BIERZ|SPRÓBUJ|UCIEKAJ|CHOD[ŹZ])(\s|!|$)/u;
  for (const [w, k] of Object.entries(SL.SFX_KEYS)) {
    ok(!EN_IMP.test(w), `L: ${w}: no English imperative`);
    ok(!PL_IMP.test(PL[`INSPLASH.Word.${k}`]), `L: ${w} -> ${PL[`INSPLASH.Word.${k}`]}: no Polish imperative`);
  }
}
for (const w of WD.ACTION_WORDS) ok(w in SL.SFX_KEYS || SL.KEEP_EN.includes(w), `L: the action word ${w} is decided for Polish (keyed or kept)`);
ok(!/STATYSTYKA W GRUZACH/.test(PL["INSPLASH.Say.OddsShattered"]), `L: the top caption is a Polish shout, not a calque (${PL["INSPLASH.Say.OddsShattered"]})`);
{
  const rng = () => 0.3, ev = SL.buildEvent({ n: 4, sixes: 4, pushed: false, newSixes: 0, rerolled: 0, stress: 0, action: "grapple", attack: true }, { rng, st: null, dryN: 0 });
  const sh = SL.shownEv(ev);
  ok(SL.ACTIONS.grapple.includes(ev.word) && sh.word === SL.sfxWord(ev.word) && sh.word !== ev.word, `L: the event keeps the English ${ev.word}, the seat shows ${sh.word}`);
}
SL.setLabels({ sfx: {} });

/* ---- C: what the action is */
const fam = (o) => WD.familyOf(o).action;
const kit = src("../tactics/kitdata-pure.mjs");
const powers = [...new Set([...kit.matchAll(/^\s+[PB]\("([^"]+)"(?:,\s*"([^"]+)")?/gm)].flatMap((m) => [m[1], m[2]]).filter(Boolean))];
ok(powers.length >= 80, `C: the kit table names the powers and boosts (${powers.length})`);
const EXPECT = {
  Strike: "slugfest", "Deadly Strike": "slugfest", "Sudden Strike": "slugfest", "Toxic Strike": "slugfest", Blast: "blast", "Quick Blast": "blast", "Deadly Blast": "blast",
  "Fire Control": "fire", Firestarter: "fire", "Electricity Control": "zap", Discharge: "zap", "Body Battery": "zap", "Cold Control": "cold", "Ice Armor": "cold", "Ice Slide": "cold",
  Earthquake: "quake", Shockwave: "quake", "Sound Control": "sonic", Distress: "sonic", "Mental Distress": "mind", Telepathy: "mind", "Mind Control": "mind", Illusion: "mind",
  "Mental Affliction": "mind", "Mental Stun": "mind", Teleportation: "teleport", "Dimensional Travel": "teleport", Portal: "teleport", Healing: "heal", Regeneration: "heal",
  Invisibility: "stealth", Camouflage: "stealth", Intangibility: "stealth", "Water Control": "water", "Weather Control": "wind", Cyclone: "wind", Telekinesis: "kinesis",
  "Gravity Control": "kinesis", "Magnetism Control": "kinesis", "Matter Control": "kinesis", "Technology Control": "tech", Sorcery: "magic", Summoning: "magic", "Luck Control": "magic",
  Barrier: "block", Protection: "block", "Energy Absorption": "block", Defiance: "block", Snare: "grapple", "Stretch Grapple": "grapple", "Extra Limb(s)": "grapple",
  "Plant Control": "grapple", Flight: "move", Leaping: "move", Swinging: "move", Quickness: "move", "Light Control": "blast", Stun: "blast", Affliction: "blast", "Animal Control": "presence",
  "Danger Sense": "intuition", Precognition: "intuition", "Action Plan": "reason", "First aid kit": "heal", "Medical instruments": "heal", "Smoke grenade": "blast"
};
for (const [n, want] of Object.entries(EXPECT)) eq(fam({ names: [n], attribute: "fighting" }), want, `C: ${n} -> ${want}`);
let unnamed = 0;
for (const p of powers) { const a = fam({ names: [p] }); if (a === "generic") unnamed++; ok(Object.hasOwn(WD.FAMILIES, a), `C: ${p} -> a family (${a})`); }
for (const p of powers) for (const attr of ["fighting", "agility", "strength", "reason", "intuition", "presence"]) ok(fam({ names: [p], attribute: attr }) !== "generic", `C: ${p} rolled with ${attr} is never generic`);
ok(unnamed <= powers.length / 2, `C: most powers are known by their name alone (${powers.length - unnamed} of ${powers.length})`);
/* the system's rolls */
eq(fam({ attackType: "slugfest", attribute: "fighting", names: ["Slugfest"] }), "slugfest", "C: the sheet's Slugfest");
eq(fam({ attackType: "charge", attribute: "strength", names: ["Charge"] }), "charge", "C: the sheet's Charge");
eq(fam({ sysAction: "grapple", attribute: "fighting", names: ["Grapple"] }), "grapple", "C: the sheet's Grapple");
eq(fam({ sysAction: "block", attribute: "fighting", names: ["Block"] }), "block", "C: the sheet's Block");
eq(fam({ sysAction: "dodge", attribute: "agility", names: ["Dodge"] }), "dodge", "C: the sheet's Dodge");
eq(fam({ attackType: "shooting", attribute: "agility", names: ["Pistol"], itemType: "gear" }), "shooting", "C: a gun shoots");
eq(fam({ attackType: "shooting", attribute: "agility", names: ["Laser Pistol"], itemType: "gear" }), "shooting", "C: a laser pistol is a gun first");
eq(fam({ attackType: "shooting", attribute: "agility", names: ["Eye Thing"], itemType: "power" }), "blast", "C: a shooting power with no telling name is an energy blast");
eq(fam({ attackType: "shooting", attribute: "agility", names: ["Thing"], itemType: "vehicleWeapon" }), "shooting", "C: a vehicle weapon shoots");
eq(fam({ attackType: "slugfest", attribute: "presence", names: ["Whatever"] }), "slugfest", "C: an unknown slugfest attack is a blow");
eq(fam({ attackType: "slugfest", attribute: "fighting", names: ["Płonąca pięść"] }), "fire", "C: a power renamed in Polish is read too (fire before fist)");
eq(fam({ attackType: "shooting", attribute: "agility", names: ["Firearm"] }), "shooting", "C: a FIREarm is a gun, not a fire");
for (const [attr, want] of Object.entries({ fighting: "slugfest", agility: "move", strength: "force", reason: "reason", intuition: "intuition", presence: "presence" }))
  eq(fam({ attribute: attr, names: [attr] }), want, `C: a plain ${attr} roll -> ${want}`);
eq(fam({}), "generic", "C: nothing known -> the neutral shout");
/* the tactics */
eq(WD.familyOf({ tactics: { key: "def:abc" }, attribute: "fighting" }), { action: "block", attack: false }, "C: a tactical defence with FIGHTING blocks");
eq(WD.familyOf({ tactics: { key: "def:abc" }, attribute: "agility" }), { action: "dodge", attack: false }, "C: a tactical defence with AGILITY dodges");
eq(WD.familyOf({ tactics: { key: "attack", what: { a: "slugfest", p: null, n: null } }, attribute: "fighting", names: ["Slugfest"] }), { action: "slugfest", attack: true }, "C: the tactics' slugfest");
eq(WD.familyOf({ tactics: { key: "attack", what: { a: "shooting", p: null, n: null } }, attribute: "agility", names: ["Shoot"] }), { action: "shooting", attack: true }, "C: the tactics' shot with a weapon");
eq(WD.familyOf({ tactics: { key: "attack", what: { a: "shooting", p: "Quick Blast", n: "Blast" } }, attribute: "agility", names: ["Shoot"] }), { action: "blast", attack: true }, "C: the tactics' Quick Blast (kit row first, not the card title)");
eq(WD.familyOf({ tactics: { key: "attack", what: { a: "shooting", p: "Blast", n: "Flame Breath" } }, attribute: "agility" }), { action: "blast", attack: true }, "C: the kit row's key wins over the item's own name");
eq(WD.familyOf({ tactics: { key: "attack", what: { a: "charge" } }, attribute: "strength" }), { action: "charge", attack: true }, "C: the tactics' charge");
eq(WD.familyOf({ tactics: { key: "attack", what: { a: "ram" } }, attribute: "agility" }), { action: "charge", attack: true }, "C: a vehicle's ram charges");
eq(WD.familyOf({ tactics: { key: "attack", what: { a: "grappleAttack" } }, attribute: "fighting" }), { action: "grapple", attack: true }, "C: the tactics' grapple attack");
eq(WD.familyOf({ tactics: { key: "roll", what: { a: null, p: "Healing", n: "Healing" } }, attribute: "presence" }), { action: "heal", attack: false }, "C: a tactical power use (Healing)");
eq(WD.familyOf({ tactics: { key: "roll" }, attribute: "strength", names: ["Breach"] }), { action: "force", attack: false }, "C: a tactical breach by STRENGTH");
/* the reader's classify (the system's own titles, both languages) */
eq(classify({ attackType: "slugfest", flavor: "Strike", names: ["Fighting"], attribute: "fighting", item: { name: "Strike", type: "power" } }), { action: "slugfest", attribute: "fighting", wreck: false, attack: true }, "C: the reviewer's Strike attack is a blow");
eq(classify({ flavor: "Strike", names: ["Fighting"], attribute: "fighting" }).action, "slugfest", "C: the reviewer's plain Strike roll is a blow (was generic: BOOM! ZOOM! KAPOW!)");
eq(classify({ attackType: "shooting", flavor: "Blast", names: ["Agility"], attribute: "agility", item: { name: "Blast", type: "power" } }).action, "blast", "C: a Blast attack");
eq(classify({ attackType: "shooting", flavor: "Fire Control", names: ["Agility"], attribute: "agility", item: { name: "Fire Control", type: "power" } }).action, "fire", "C: a Fire Control attack burns");

/* ---- E: the event */
const evOf = (o, seed) => { const rng = seeded(seed * 7919); return SL.buildEvent({ newSixes: 0, rerolled: 0, pushed: false, stress: 0, ...o }, { rng, st: null, dryN: 0 }); };
const RANK_ROLLS = { ordinary: { n: 4, sixes: 2 }, strong: { n: 5, sixes: 3 }, critical: { n: 4, sixes: 4 } };
for (const f of FAM) for (const r of WD.RANKS) {
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const ev = evOf({ ...RANK_ROLLS[r], action: f }, seed);
    if (seed === 1) eq(WD.wordRank(ev.power), r, `E: ${f}: ${RANK_ROLLS[r].sixes} sixes of ${RANK_ROLLS[r].n} is ${r}`);
    seen.add(ev.word);
    ok(pool(f, r).includes(ev.word) && SL.wordFits(ev, ev.word), `E: ${f} ${r} seed ${seed}: ${ev.word} is a ${r} word of ${f}`);
  }
  eq([...seen].sort(), [...pool(f, r)].sort(), `E: ${f} ${r}: every word of the pool comes up`);
}
for (let seed = 1; seed <= 60; seed++) ok(evOf({ n: 4, sixes: 4, action: "slugfest" }, seed).word !== "ZOOM!", `E: a punch's critical never ZOOM!s (seed ${seed})`);
{
  const ev = evOf({ n: 4, sixes: 4, action: "slugfest" }, 3);
  ok(!SL.wordFits(ev, "BOOM!") && !SL.wordFits(ev, "POW!") && SL.wordFits(ev, "HAYMAKER!"), "E: a flag's word must be this action's word at this rank");
  const miss = evOf({ n: 9, sixes: 0, action: "shooting" }, 3);
  ok(SL.wordFits(miss, "PTWING!") && !SL.wordFits(miss, "FIZZLE!"), "E: a gun's miss ricochets, it does not fizzle");
  const pmiss = evOf({ n: 9, sixes: 0, action: "blast" }, 3);
  ok(SL.wordFits(pmiss, "FIZZLE!") && !SL.wordFits(pmiss, "PTWING!"), "E: a blast's miss fizzles");
  for (let seed = 1; seed <= 30; seed++) { const m = evOf({ n: 9, sixes: 0, action: "reason" }, seed); ok(SL.missFor("reason").includes(m.word) && m.word !== "WHIFF!", `E: a clever idea never WHIFF!s (seed ${seed}: ${m.word})`); }
  eq(evOf({ n: 4, sixes: 2, action: "blast", attack: true }, 1).atk, true, "E: the event carries the blow flag");
  eq(evOf({ n: 4, sixes: 2, action: "slugfest" }, 1).atk, null, "E: an older reading has none (null)");
  eq(evOf({ n: 4, sixes: 2, action: "nonsense" }, 1).action, "generic", "E: an unknown action reads as the neutral family");
}

/* ---- T: where the impact lands */
const A = "AAAAAAAAAAAAAAAA";
eq(IP.rollTargets({ flagged: [A], action: "blast", atk: true }), [A], "T: a blast attack lands on its target");
eq(IP.rollTargets({ flagged: [A], action: "fire", atk: false }), [], "T: a power used without attack lands on nobody");
eq(IP.rollTargets({ flagged: [A], action: "slugfest", atk: null }), [A], "T: a roll from before WORDPOOL: by its action, as before");
eq(IP.rollTargets({ flagged: [A], action: "generic", atk: null }), [], "T: ... a generic one lands on nobody, as before");

/* ---- W: wiring */
{
  const main = src("../splash/main.mjs"), ep = src("../tactics/engine-pure.mjs"), en = src("../tactics/engine.mjs"), ad = src("../tactics/system-adapter.mjs");
  ok(main.includes("item, tactics: this.rollOptions?.tactics ?? null })"), "W: the roll dialog hands the power / gear and the tactics tag to the classifier");
  ok(/WORDS\.has\(f\.word\) && wordFits\(ev, f\.word\)/.test(main), "W: a flagged word must fit the action and the rank");
  ok(/atk: ev\.atk \?\? null/.test(main), "W: the impact's target follows the blow flag");
  eq((ep.match(/\.\.\.rollWhat\(X, I, (e|rec)\.who\)/g) ?? []).length, 2, "W: both roll requests of the tactics carry what the roll is");
  ok(/\.\.\.\(e\.what \? \{ what: e\.what \} : \{\}\)/.test(en) && /what: req\.what/.test(ad), "W: the executor and the adapter pass `what` into the roll's options");
}

done("wordpool");
const sm = summary();
console.log(`sweep wordpool: ${sm.checks} checks, ${sm.failed} failed`);
process.exit(sm.failed ? 1 : 0);
