/* node scripts/sweep-checks/words4.mjs -- WORDS4 (2026-11-15): every word the dice splash letters obeys the owner's word rulings, in English
   and in Polish, in EVERY pool (the families' ranks and misses, the neutral misses, the routine-miss mutters, the push grunts, the pushed
   misses, the wreck):
     S  a SOUND word is a spelled sound: no Polish letter, no dictionary word or near-word by the engine's own refusal, and no plain word
        that the engine's ICONIC / VOICE lists let through (BANG ZAP BEEP SHH ...: those are kept provisionally for the engine's banks); only
        the owner's own words pass (POW WHAM BAM THUD, the water words, BOOM in a fire blast) and the two kept on a question (BLAM, GRR);
     N  an ACTION word / caption is a noun or noun phrase in both languages: it must be on the reviewed list below (a new caption is a
        conscious choice), and never an exclamation, an adverb, an order or a sentence (the forms D9 found, and their kin);
     B  BOOM / BUM only in a fire blast; the thunder's word (KRAKOOM) only for lightning, never a wreck;
     V  every pool keeps its variety and its ladder: as many words as before WORDS4, a better rank still brings new words. */
import { ok, eq, done, summary } from "../tactics/testkit.mjs";
import * as SL from "../splash/logic.mjs";
import * as WD from "../splash/words.mjs";
import * as LW from "../letters/words.mjs";
import { EN, PL } from "../splash/lang.mjs";

const FAM = Object.keys(WD.FAMILIES);
const POOLS = {
  ...Object.fromEntries(FAM.flatMap((f) => [...WD.RANKS.map((r) => [`${f}.${r}`, WD.FAMILIES[f].ranks[r]]), [`${f}.miss`, WD.FAMILIES[f].miss]])),
  missAny: WD.MISS_ANY, soft: SL.SOFTFAIL, pushpre: SL.PUSHPRE, pushfail: SL.PUSHFAIL, wreck: SL.WRECK
};
const ALL = [...new Set(Object.values(POOLS).flat())];
const isCaption = (w) => WD.ACTION_WORDS.has(w) || Object.hasOwn(SL.SFX_KEYS, w) || SL.KEEP_EN.includes(w) || w === "STRAIN!";

/* ---- S: sound words */
const flat1 = (x) => LW.clean(x).replace(/(\p{L})\1+/gu, "$1");
const OWNER = new Set(["POW", "WHAM", "BAM", "THUD", "BOOM", "KROOM", "PLOP", "PLUNK", "SPLOOSH", "GLUB"].map(flat1));   // the owner's rulings (2026-11-13)
const KEPT = new Set(["BLAM", "GRR"].map(flat1));                                                                       // provisional, combat-questions WORDS4-2
/* the English plain words (a Polish reading of an English sound is the engine's crossRefusal / CROSS matter) */
const dict = new Set(LW.DICT.en.map(flat1));
const sylls = (w) => LW.clean(w).replace(/[!?….]/g, "").split(/[-\s]+/).filter(Boolean);
const sounds = ALL.filter((w) => !isCaption(w));
ok(sounds.length >= 100, `S: many sound words (${sounds.length})`);
for (const w of sounds) {
  const t = w.replace(/[!…]+$/, "");
  ok(!/[ĄĆĘŁŃÓŚŹŻ]/u.test(w), `S: ${w}: no Polish letter`);
  eq(LW.refusal(t, "en", { group: "voice" }), null, `S: ${w}: no English dictionary word or near-word (engine refusal)`);
  eq(LW.sayable(t, "en"), null, `S: ${w}: sayable`);
  for (const s of sylls(t)) {
    const one = s.replace(/(\p{L})\1+/gu, "$1");
    if (OWNER.has(one) || KEPT.has(one)) continue;
    ok(!dict.has(one) && ![...Object.keys(LW.ICONIC.en), ...Object.keys(LW.ICONIC.pl), ...Object.keys(LW.VOICE.en)].map(flat1).includes(one),
      `S: ${w}: the part ${s} is no plain word the engine only lets through on its provisional lists`);
  }
}
for (const w of ["BANG!", "ZAP!", "BEEP!", "SHH!", "CLICK!", "ROAR!", "WHIFF!", "FIZZLE!", "OUCH!", "HMM…", "AHEM!", "OOPS!", "YIKES!", "NOPE!"])
  ok(!ALL.includes(w), `S: ${w} (D9 / WORDS4: a plain word) is in no pool`);

/* ---- N: captions are nouns */
/* the reviewed nouns (English -> its Polish noun, or null = the same word / stays English); a new caption joins only after a reading */
const NOUNS = {
  "HAYMAKER!": "SIERPOWY!", "SMASH!": "ROZWALENIE!", "CRUSH!": "ZMIAŻDŻENIE!", "RUSH!": "PĘD!", "CHARGE!": "SZARŻA!", "RAM!": "TARAN!", "STAMPEDE!": "STAMPEDA!",
  "GRAB!": "CHWYT!", "CLINCH!": "KLINCZ!", "SQUEEZE!": "ŚCISK!", "LOCK!": "DŹWIGNIA!", "VISE!": "IMADŁO!", "GUARD!": "GARDA!", "BLOCK!": "BLOK!",
  "PARRY!": "PARADA!", "STONEWALL!": "MUR!", "SHIELD!": "TARCZA!", "DASH!": "ZRYW!", "FLIP!": "SALTO!", "DODGE!": "UNIK!", "BLUR!": "SMUGA!",
  "HEAVE!": "DŹWIGNIĘCIE!", "WRENCH!": "SZARPNIĘCIE!", "MIRACLE!": "CUD!", "VANISHING!": "ZNIKNIĘCIE!", "FULL ACCESS!": "PEŁNY DOSTĘP!",
  "IDEA!": "POMYSŁ!", "DISCOVERY!": "ODKRYCIE!", "SOLUTION!": "ROZWIĄZANIE!", "GENIUS!": "GENIUSZ!", "SENSE!": "ZMYSŁ!", "HUNCH!": "PRZECZUCIE!",
  "TINGLE!": "MROWIENIE!", "SIXTH SENSE!": "SZÓSTY ZMYSŁ!", "SILENCE!": "CISZA!", "AURA!": null, "COMMAND!": "ROZKAZ!", "ATTENTION!": "UWAGA!",
  "SUCCESS!": "SUKCES!", "FEAT!": "WYCZYN!", "BULLSEYE!": "W DZIESIĄTKĘ!", "TRIUMPH!": "TRIUMF!", "LEGEND!": "LEGENDA!",
  "MISHAP!": "WPADKA!", "FIASCO!": "FIASKO!", "BLUNDER!": "GAFA!",
  "PATIENCE": "CIERPLIWOŚĆ", "MISS": "PUDŁO", "NEXT ROUND!": "NASTĘPNA RUNDA!", "ANOTHER TRY": "KOLEJNA PRÓBA", "CALM": "SPOKÓJ",
  "STRAIN!": null, "EFFORT!": "WYSIŁEK!", "GAMBLE!": "RYZYKO!", "FULL STRENGTH!": "Z CAŁYCH SIŁ!", "RETRY!": "POWTÓRKA!", "COMEBACK!": "POWRÓT!",
  "FAILURE!": "PORAŻKA!", "BUST!": "KLAPA!", "DEAD END!": "ŚLEPY ZAUŁEK!", "BREAKDOWN!": "ZAŁAMANIE!", "NO LUCK!": "PECH!",
  "WRECK!": "DEMOLKA!", "RUIN!": "RUINA!", "DEMOLITION!": "ZBURZENIE!"
};
const captions = ALL.filter(isCaption);
for (const w of captions) {
  ok(Object.hasOwn(NOUNS, w), `N: the caption ${w} is a reviewed noun`);
  const pl = Object.hasOwn(SL.SFX_KEYS, w) ? PL[`INSPLASH.Word.${SL.SFX_KEYS[w]}`] : null;
  if (Object.hasOwn(NOUNS, w)) eq(pl, NOUNS[w], `N: ${w} -> its reviewed Polish noun (${pl})`);
}
for (const w of Object.keys(NOUNS)) ok(captions.includes(w), `N: the reviewed ${w} is still shown (else drop it from the list)`);
/* the forms that are not nouns: exclamations, adverbs, orders, sentences (D9 and kin), both languages */
const EN_NOT = /^(YES|YEAH|NOPE|NO|OOPS|YIKES|AHA|EUREKA|OUCH|WOW|HMM|AHEM|GOTCHA|GOT IT|GOT YOU|NOT YET|NOT TODAY|ALMOST|AGAIN|ONE MORE|SO CLOSE|STEADY|NEXT|ALL IN|DONE|ACCESS GRANTED|PUSH|LEGENDARY|HUSH|DUCK|LISTEN UP|TRY AGAIN)!?$/;
const PL_NOT = /^(TAK|NIE|UPS|O RANY|AŁA|MAM CIĘ|MAM TO|JESZCZE NIE|JESZCZE RAZ|PRAWIE|ZNOWU|DALEJ|SPOKOJNIE|TAK BLISKO|NIE DZIŚ|VABANK|GOTOWE|DOSTĘP PRZYZNANY)!?$/u;
for (const w of captions) {
  ok(!EN_NOT.test(w), `N: ${w}: no exclamation, adverb, order or sentence`);
  const pl = Object.hasOwn(SL.SFX_KEYS, w) ? PL[`INSPLASH.Word.${SL.SFX_KEYS[w]}`] : null;
  if (pl) ok(!PL_NOT.test(pl), `N: ${w} -> ${pl}: no exclamation, adverb, order or sentence`);
}
for (const [k, v] of Object.entries(PL)) if (k.startsWith("INSPLASH.Word.")) ok(!PL_NOT.test(v), `N: ${k} = ${v} is a noun`);
for (const [k, v] of Object.entries(EN)) if (k.startsWith("INSPLASH.Word.")) ok(!EN_NOT.test(v), `N: ${k} = ${v} is a noun`);

/* ---- B: blasts and thunder */
for (const [p, ws] of Object.entries(POOLS)) for (const w of ws) {
  const flat = w.replace(/-/g, "");
  if (!p.startsWith("fire.")) ok(!/BO{2,}M|BU+M/.test(flat), `B: ${p} ${w}: no BOOM / BUM outside a fire blast`);
  if (!p.startsWith("zap.")) ok(!/KRAKOOM|GRRAWOOM|KRRAWOOM/.test(flat), `B: ${p} ${w}: the thunder's word only for lightning`);
}
ok(SL.WRECK.includes("BTHOOM!"), "B: a wreck caves in (the owner's cave-in BTHOOM!)");

/* ---- V: variety and ladders (the sizes before WORDS4) */
const SIZE = { soft: 6, pushpre: 8, pushfail: 8, wreck: 4, missAny: 3 };
for (const [p, n] of Object.entries(SIZE)) eq(POOLS[p].length, n, `V: ${p} keeps its ${n} words`);
for (const p of Object.keys(SIZE)) eq(new Set(POOLS[p]).size, POOLS[p].length, `V: ${p}: no repeats`);
for (const f of FAM) for (const r of WD.RANKS) ok(WD.FAMILIES[f].ranks[r].length >= 2, `V: ${f} ${r}: two or more words`);
eq(["tech.ordinary", "tech.strong", "tech.critical"].map((p) => POOLS[p][0]), ["BIP!", "BIP-BIP!", "BIP-BIP-BIP!"], "V: the beep still climbs one, two, three");

done("words4");
const sm = summary();
console.log(`sweep words4: ${sm.checks} checks, ${sm.failed} failed`);
process.exit(sm.failed ? 1 : 0);
