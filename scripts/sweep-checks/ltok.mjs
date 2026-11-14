// node scripts/sweep-checks/ltok.mjs  (LTOK: token reactions to Health / Resolve changes, comic lettering at the token)
import { readFileSync } from "node:fs";
import * as P from "../tokenreact/pure.mjs";
import * as Owner from "../tokenreact/owner.mjs";
import * as FP from "../tactics/ui/feedback-pure.mjs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const rd = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* A: what happened */
const K = (stat, from, to, max = 8, cause = null) => P.classify({ stat, from, to, max, cause })?.kind ?? null;
ck("A1 a small loss is a hit", K("health", 7, 6) === "hit");
ck("A2 three at once is heavy", K("health", 8, 5) === "heavy");
ck("A3 half of a small track is heavy", K("health", 4, 2, 4) === "heavy");
ck("A4 to zero is down (broken)", K("health", 2, 0) === "down" && K("health", 5, -1) === "down");
ck("A5 up is heal, up from zero is back", K("health", 3, 5) === "heal" && K("health", 0, 2) === "back");
ck("A6 Resolve down is stress; after the own roll it is spent", K("resolve", 5, 4) === "stress" && K("resolve", 5, 4, 8, "push") === "spent");
ck("A7 Resolve to zero is out, up regain, up from zero steady", K("resolve", 1, 0) === "out" && K("resolve", 3, 5) === "regain" && K("resolve", 0, 2) === "steady");
ck("A8 no change, no track, no number: nothing", K("health", 3, 3) === null && K("mana", 1, 2) === null && K("health", null, 2) === null && K("health", "x", 2) === null);
ck("A9 the amount and its share", eq(P.classify({ stat: "health", from: 8, to: 6, max: 8 }), { stat: "health", kind: "hit", n: 2, r: 0.25 }));
ck("A10 no max: no share", P.classify({ stat: "health", from: 8, to: 6, max: 0 }).r === null);

/* B: what a seat is shown */
const c = (stat, from, to, max = 8) => P.classify({ stat, from, to, max });
const GM = { visible: true, staff: true }, OWN = { visible: true, reader: true }, OTHER = { visible: true }, HIDDEN = { visible: false, staff: true };
ck("B1 not drawn for the user: nothing, even for the GM", P.audience(HIDDEN, c("health", 5, 2)).show === false);
/* PRIV (the owner, 2026-11-14: «nie» to a player getting a lighter or other reaction than the GM; GM and players see the same moment): B2-B7
   checked the old per-seat kinds (another seat: a hand-edited blow was a plain hit, a fall to 0 a hit, another's Resolve nothing, getting
   up a heal). They now check the ruling: every seat that sees the token gets the GM's kind and amount; only the number is per seat. */
const KA = (a) => [a.show, a.kind, a.amt];
ck("B2 the GM and a reader get the kind, the amount and the exact number", eq(P.audience(GM, c("health", 5, 0)), { show: true, kind: "down", num: 5, exact: true, amt: 0.625 }) && P.audience(OWN, c("resolve", 3, 4)).num === 1);
ck("B3 another's hand-edited blow: the GM's kind and amount, no number", eq(P.audience(OTHER, c("health", 8, 2)), { show: true, kind: "heavy", num: null, amt: 0.75 }) && eq(KA(P.audience(OTHER, c("health", 8, 2))), KA(P.audience(GM, c("health", 8, 2)))));
ck("B4 another's hit the table was told: the told number, the kind from what happened (as the GM's)", eq(P.audience(OTHER, c("health", 8, 7), { taken: 1 }), { show: true, kind: "hit", num: 1, amt: 0.125 }) && P.audience(OTHER, c("health", 8, 5), { taken: 3 }).kind === "heavy"
  && P.audience(OTHER, c("health", 8, 7), { taken: 3 }).kind === P.audience(GM, c("health", 8, 7), { taken: 3 }).kind);
ck("B5 another going to 0 without a card: knocked down like the GM sees it, no number; the card's number joins", eq(P.audience(OTHER, c("health", 2, 0)), { show: true, kind: "down", num: null, amt: 0.25 }) && eq(P.audience(OTHER, c("health", 2, 0), { taken: 2, broken: true }), { show: true, kind: "down", num: 2, amt: 0.25 })
  && P.audience(OTHER, c("health", 5, 3), { taken: 2, broken: true }).kind === "down" && P.audience(GM, c("health", 5, 3), { taken: 2, broken: true }).kind === "down");
ck("B6 another's Resolve: the GM's reaction, the number only when the fight announced the stress", eq(P.audience(OTHER, c("resolve", 5, 4)), { show: true, kind: "stress", num: null, amt: 0.125 }) && P.audience(OTHER, c("resolve", 5, 7)).kind === "regain" && P.audience(OTHER, c("resolve", 5, 7)).num === null
  && eq(P.audience(OTHER, c("resolve", 5, 3), { taken: 2, toStress: true }), { show: true, kind: "stress", num: 2, amt: 0.25 }) && P.audience(OTHER, c("resolve", 5, 3), { taken: 2 }).num === null);
ck("B7 another's healing and getting up: the GM's kinds, not counted", eq(P.audience(OTHER, c("health", 2, 5)), { show: true, kind: "heal", num: null, amt: 0.375 }) && P.audience(OTHER, c("health", 0, 2)).kind === "back" && P.audience(OTHER, c("health", 0, 2), { taken: 4 }).num === null);
{ /* B7b: the whole table of changes x what was told: every seat that sees the token letters the same reaction (word, size, motion, impact),
     a seat without the right to read gets a number only when it was told, never the exact one; a seat that does not see gets nothing */
  let same = true, secret = true, hidden = true, looks = true;
  const tells = [null, { taken: 2 }, { taken: 5, broken: true }, { taken: 1, toStress: true }, { taken: 3 }];
  for (const stat of ["health", "resolve"]) for (const [a, b, m] of [[8, 7, 8], [8, 5, 8], [8, 2, 8], [2, 0, 8], [5, -1, 8], [3, 5, 8], [0, 2, 8], [22, 7, 22], [4, 2, 4], [1, 0, 6]]) for (const pub of tells) {
    const ch = c(stat, a, b, m), g = P.audience(GM, ch, pub), o = P.audience(OTHER, ch, pub), r = P.audience(OWN, ch, pub);
    if (!eq(KA(g), KA(o)) || !eq(KA(g), KA(r))) same = false;
    if (o.num !== null && o.num !== P.toldNum(ch, pub)) secret = false;
    if (!pub && o.num !== null) secret = false;
    if (P.audience({ visible: false }, ch, pub).show || P.audience(HIDDEN, ch, pub).show) hidden = false;
    const lg = P.look(g, ch, "en", "s1"), lo = P.look(o, ch, "en", "s1");
    if (!lg || !lo || lg.kind !== lo.kind || lg.loud !== lo.loud || lg.amt !== lo.amt || lg.magnitude !== lo.magnitude || lg.rotation !== lo.rotation || JSON.stringify(lg.motion) !== JSON.stringify(lo.motion) || lg.hold !== lo.hold) looks = false;
    if (!eq(P.impactOf({ kind: g.kind, amt: P.amountOf(g, ch), known: true }, 0), P.impactOf({ kind: o.kind, amt: P.amountOf(o, ch), known: true }, 0))) looks = false;
  }
  ck("B7b every seat that sees the token: the same kind and amount (GM, a reader, another seat), over 100 changes x what was told", same);
  ck("B7c another seat's number is only ever the told one", secret);
  ck("B7d a seat that does not see the token gets nothing, GM included", hidden);
  ck("B7e the same look (loudness, size amount, magnitude, tilt, motion, hold) and the same impact on every seat that sees it", looks);
}
ck("B8 a challenge's time limit is the HUD's", P.audience({ visible: true, staff: true, challenge: true }, c("resolve", 3, 2)).show === false && P.audience({ visible: true, staff: true, challenge: true }, c("health", 3, 2)).show === true);
ck("B9 nothing from nothing", P.audience(GM, null).show === false && P.audience(null, c("health", 3, 2)).show === false);
ck("B10 an event with no track change (hit while broken) still answers", P.fromEvent({ taken: 2 }, "health").kind === "hit" && P.fromEvent({ taken: 0, broken: true }, "health").kind === "down" && P.fromEvent({ taken: 0 }, "health") === null && P.fromEvent({ taken: 1 }, "resolve").kind === "stress");
ck("B11 who may read: the damage card's rule", P.mayRead({ gm: true }) && P.mayRead({ type: "challenge" }) && P.mayRead({ type: "superhero", playerHero: true }) && P.mayRead({ observer: true }) && !P.mayRead({ type: "npc" }) && !P.mayRead({ type: "superhero" }) && !P.mayRead(null));

/* C: the lettering. FXLT2 (ADVT2 1): the words are the engine's vocabulary now (the token's own list had dictionary words, non-sounds and
   Polish diacritics); C1, C2, C5-C7 and C14 test the vocabulary's words the reactions get, not a list of their own */
const { createVocab } = await import("../letters/words.mjs");
const V = createVocab();
const kinds = [...P.HEALTH, ...P.RESOLVE];
const vocabIds = new Set(V.list().map((x) => x.id));
for (const kd of kinds) {
  const lk = P.look({ kind: kd, num: 2, exact: true }, { r: 0.25 }, "pl", "s1", V);
  ck(`C1 ${kd}: a word, a mood, a palette, a number (spent: none, the roll's splash shows it)`, !!lk && typeof lk.word === "string" && lk.word.length > 0 && !!lk.mood && lk.colors.length === 3 && (kd === "spent" ? lk.number === null : /^[+-]2$/.test(lk.number.text)));
  ck(`C2 ${kd}: its sound is a kind of the engine's vocabulary`, vocabIds.has(P.vocabKind(kd, (k) => vocabIds.has(k))));
}
ck("C3 the sign says the direction", P.look({ kind: "hit", num: 3 }, null, "en", "a").number.text === "-3" && P.look({ kind: "heal", num: 3 }, null, "en", "a").number.text === "+3" && P.look({ kind: "regain", num: 1 }, null, "en", "a").number.text === "+1" && P.look({ kind: "stress", num: 1 }, null, "en", "a").number.text === "-1");
ck("C4 no number: none drawn", P.look({ kind: "hit", num: null }, null, "en", "a").number === null);
ck("C5 the same seed, the same lettering on every seat", eq(P.look({ kind: "heavy", num: 4 }, { r: 0.5 }, "pl", "tok|health|123", V), P.look({ kind: "heavy", num: 4 }, { r: 0.5 }, "pl", "tok|health|123", createVocab())));
{ const words = new Set(); for (let i = 0; i < 40; i++) words.add(P.look({ kind: "hit", num: 1 }, null, "en", `x${i}`, V).word); ck("C6 different from one time to the next (several words in use)", words.size >= 3); }
/* C7 changed by FXLT (review 15): the word comes from the seed alone (identical everywhere) and successive changes vary it. FXLT2: the
   vocabulary has 2-3 words per loudness tier (pl punch, small: TWAP|TWOP; the owner: words may repeat when natural, no forced
   uniqueness), so two successive stamps differ about half the time; a quarter at least */
{ const a = P.look({ kind: "hit", num: 1 }, null, "en", "same", V), b = P.look({ kind: "hit", num: 1 }, null, "en", "same", createVocab());
  let differ = 0; for (let i = 0; i < 40; i++) differ += P.look({ kind: "hit", num: 1 }, null, "pl", P.seedOf("t", "health", 1000 + i), V).word !== P.look({ kind: "hit", num: 1 }, null, "pl", P.seedOf("t", "health", 1001 + i), V).word ? 1 : 0;
  ck("C7 the word is the seed's alone (no seat memory), and successive changes mostly say another word", a.word === b.word && differ >= 10); }
ck("C8 how much shows: a bigger blow is louder and bigger", (() => { const s = P.look({ kind: "hit", num: 1, exact: true }, { r: 0.1 }, "en", "q"), b = P.look({ kind: "hit", num: 2, exact: true }, { r: 0.5 }, "en", "q");
  return b.sound.loud > s.sound.loud && P.targetPx(b.kind, b.amt, "BAM!", 100, 900) > P.targetPx(s.kind, s.amt, "BAM!", 100, 900) && b.magnitude > s.magnitude && b.number.sound.loud > s.number.sound.loud; })());      // FXLT: the size is the planned cap height (targetPx), the number's size follows the word's
ck("C9b magnitudes: heavy and down bigger, a hit small, spent small, all within the engine's 0..2", (() => { const m = (k) => P.look({ kind: k, num: 2 }, null, "en", "q").magnitude; return m("heavy") >= 0.6 && m("down") > m("heavy") && m("hit") > 0.05 && m("hit") < 0.4 && m("spent") < 0.2 && m("heavy") > m("hit") && [...P.HEALTH, ...P.RESOLVE].every((k) => m(k) >= 0 && m(k) <= 2); })());      // FXLT review 5: down was 0.25 under heavy; now the worst blow is the biggest
ck("C9 a heavy hit is bigger than a hit, spent is the quietest", P.targetPx("heavy", 0.6, "BLAMM!", 100, 900) > P.targetPx("hit", 0.6, "BLAMM!", 100, 900) && P.targetPx("spent", 0.2, "HUFF!", 100, 900) < P.targetPx("stress", 0.2, "HUFF!", 100, 900));
ck("C10 a seat that may not read gets no share of the track in the size", eq(P.look({ kind: "hit", num: 2 }, { r: 1 }, "en", "q"), P.look({ kind: "hit", num: 2 }, { r: 0.01 }, "en", "q")));
ck("C11 rising kinds use rising moods, falls falling ones (contract: heal / powerup rise, fail / crash fall)", ["heal", "back", "regain", "steady"].every((k) => ["heal", "powerup"].includes(P.look({ kind: k, num: 1 }, null, "en", "q").mood)) && ["down", "out", "heavy"].every((k) => ["fail", "crash"].includes(P.look({ kind: k, num: 1 }, null, "en", "q").mood)));
ck("C12 Health and Resolve in different colours", P.look({ kind: "hit", num: 1 }, null, "en", "q").colors[1] !== P.look({ kind: "stress", num: 1 }, null, "en", "q").colors[1]);
ck("C13 an unknown kind: nothing", P.look({ kind: "zzz", num: 1 }, null, "en", "q") === null);
/* C14 changed by FXLT2 (owner's rulings: no Polish diacritics in sound words, "!" 0..2, only sounds): every word a reaction can get, in both
   languages, at every loudness and series step, from many seeds */
{ let bad = [], n = 0;
  const OLD = new Set(["DOBRA!", "JUŻ!", "TAK!", "YES!", "OKAY!", "UP!", "RIGHT!", "TRZASK!", "PLASK!", "BACH!", "BUCH!", "BUM!", "PAC!", "PAF!", "SMACK!", "THWACK!", "THUD!", "KLUNK!", "KRUNCH!"]);
  for (const kd of kinds) for (const lang of ["en", "pl"]) for (const num of [null, 1, 3, 8, 15]) for (let i = 0; i < 12; i++) for (const step of [0, 1, 2, 3]) {
    const lk = P.look({ kind: kd, num, exact: num !== null }, { r: num ? Math.min(1, num / 8) : null }, lang, `w${i}`);
    const w = P.wordFor(lk, V, { lang, seed: `w${i}`, step, streakSeed: `s${i}` }); n++;
    if (!w || /[ĄĆĘŁŃÓŚŹŻ]/.test(w) || (w.match(/!/g) ?? []).length > 2 || !/^[A-Z!?\-.… ]+$/.test(w) || OLD.has(w)) bad.push(`${kd}/${lang}/${w}`);
  }
  ck(`C14 every reaction word is drawn from the vocabulary: no diacritics, at most two "!", none of the review's non-sounds (${n} words; bad: ${bad.slice(0, 5).join(" ")})`, bad.length === 0 && n > 3000 && !("WORDS" in P)); }

{ /* C15: the techniques are names the engine knows (its moods' entrances, holds and exits) and vary with the seed */
  const D = await import("../letters/design.mjs");
  const known = { in: new Set(), hold: new Set(), out: new Set() };
  for (const m of Object.values(D.MOODS)) { for (const k of Object.keys(m.in ?? {})) known.in.add(k); for (const k of Object.keys(m.hold ?? {})) known.hold.add(k); for (const k of Object.keys(m.out ?? {})) known.out.add(k); }
  ck("C15 every technique is one the engine draws", Object.values(P.MOTION).every((m) => m.in.every((x) => known.in.has(x)) && m.hold.every((x) => known.hold.has(x)) && m.out.every((x) => known.out.has(x))));
  const seen = new Set(); for (let i = 0; i < 30; i++) { const m = P.look({ kind: "hit", num: 1 }, null, "en", `m${i}`).motion; seen.add(`${m.in}/${m.holdKind}/${m.out}`); }
  ck("C16 two hits do not always move alike", seen.size >= 3);
  ck("C17 a fall falls and healing rises (screen-down / screen-up)", ["fall", "droop"].includes(P.look({ kind: "down", num: 1 }, null, "en", "q").motion.out) && P.look({ kind: "heal", num: 1 }, null, "en", "q").motion.in !== "drop" && ["rise", "dissolve"].includes(P.look({ kind: "heal", num: 1 }, null, "en", "q").motion.out));
}

/* D: many at once */
const crowd = (k) => P.stage(Array.from({ length: k }, (_, i) => ({ key: `t${i}`, sev: i % 4 === 0 ? 9 : 3, hasNum: true })));
ck("D1 one: full, no delay, full size", eq(crowd(1).map((x) => [x.mode, x.delay, x.scale]), [["full", 0, 1]]));
ck("D2 three: all full, staggered", crowd(3).every((x) => x.mode === "full") && crowd(3)[2].delay > crowd(3)[1].delay);
/* FXI-TOKEN (ADVI 15: of seven tokens hit at once only two had a word): three in full in a big crowd too (they shrink to a free side) */
ck("D3 eight: the heaviest first, three in full, the rest numbers", (() => { const s = crowd(8); return s[0].sev === 9 && s.filter((x) => x.mode === "full").length === 3 && s.filter((x) => x.mode === "number").length === 5; })());
ck("D4 thirty: at most ten on the map, smaller", (() => { const s = crowd(30); return s.filter((x) => x.mode !== "none").length === P.CROWD.shown && s[0].scale < 1; })());
ck("D5 a crowd's entrances are tight (the last within a second)", Math.max(...crowd(30).map((x) => x.delay)) < 1000);
/* D6 changed by FXLT (review 6): a visibly hit enemy whose number a player may not see used to get nothing in a crowd (the single
   reaction gives it a word); now it gets a small word ("mark"); over the cap the rest are still left out */
ck("D6 no number to show: a crowd marks it with a small word; over the cap nothing", (() => { const s = P.stage([{ sev: 9, hasNum: true }, { sev: 8, hasNum: true }, { sev: 7, hasNum: true }, { sev: 1, hasNum: false }]); return s[3].mode === "mark" && s[3].scale < s[0].scale && P.stage(Array.from({ length: 14 }, () => ({ sev: 3, hasNum: false }))).filter((x) => x.mode === "none").length === 4; })());

/* E: the public line of the system's Damage Taken card */
ck("E1 the number is the last strong of the first paragraph", eq(P.damageLine("<p><strong>Kid 7</strong> took <strong>3</strong> damage.</p>"), { taken: 3, broken: false }));
ck("E2 a second paragraph (a critical injury) means down", P.damageLine("<p><strong>Rex</strong> took <strong>4</strong> damage.</p><p>They also took <strong>Broken Arm</strong> critical injury.</p>").broken === true);
ck("E3 no number: null", P.damageLine("<p>nothing</p>") === null && P.damageLine(null) === null);

/* F: one change is said once (the tactical numbers over tokens) */
const fl = FP.floats([{ type: "damage", target: "a", taken: 3 }, { type: "damage", target: "b", taken: 0 }, { type: "broken", target: "a" }, { type: "outcome", target: "c", hit: false }, { type: "crit", target: "a", crit: { total: 7, id: "x" } }], (k, d) => k);
Owner.setOn(false);
ck("F1 off: the numbers stay the fight's", !fl.some((x) => Owner.claims(x)));
Owner.setOn(true);
ck("F2 on: the loss and Broken are the token's, the miss, the no-damage and the injury stay", eq(fl.map((x) => Owner.claims(x)), [true, false, true, false, false]));
Owner.setOn(false);
const fb = rd("../tactics/ui/feedback.mjs");
ck("F3 the surface asks after it marked the blow's loss (a later Hit of that blow still stays away)", fb.indexOf("Owner.claims(f)") > fb.indexOf("if (f.loss) lossAt[f.target]"));

/* G: wiring */
const main = rd("../tokenreact/main.mjs"), store = rd("../tactics/store.mjs"), mod = rd("../module.js");
ck("G1 the tactics hook names are the store's", store.includes("export const HOOK = `${MOD}.tactics`;") && store.includes("export const HOOK_GM = `${MOD}.tacticsGm`;") && main.includes("TAC_HOOK = `${MOD}.tactics`, TAC_HOOK_GM = `${MOD}.tacticsGm`"));
ck("G2 module.js starts it with the recorded phases, guarded", /import\("\.\/tokenreact\/main\.mjs"\)\s*\.then\(\(react\) => react\.start\(\{ \.\.\.SPLASH_PHASES \}\)\)\s*\.catch/.test(mod));
ck("G3 world space at the token, through the shared engine only", main.includes('space: "world", token: tok.document') && main.includes("at: follow(tok, plan, -1)") && main.includes('from "../letters/index.mjs"') && !/PIXI\.Text|createScrollingText/.test(main));
ck("G4 a player never gets a hidden token", main.includes("staff || doc?.hidden !== true"));
ck("G5 waits for the dice and the camera's blow", main.includes("Gate.after(") && main.includes("Moment.landing("));
ck("G6 reduced motion is passed on", main.includes("reduced: red") && main.includes("prefers-reduced-motion"));
ck("G7 client settings, on by default", /scope: "client", config: true, type: Boolean, default: true/.test(main));
ck("G8 the engine's folder is not imported anywhere but its entry", !/letters\/(engine|font|rng)\.mjs/.test(main));
ck("G9 nothing is written to any document", !/\.update\(|\.setFlag\(|\.create\(|ChatMessage\.create/.test(main));

ck("G10 the display layer is the user's client setting", /KEY\.layer, \{[^}]*scope: "client", config: true/.test(main) && main.includes("...layer()"));
{ const E = rd("../letters/engine.mjs"); const ids = ["overlay", "weather", "tokens", "ground", "top"];
  const worldLine = (id) => E.split(/\r?\n/).some((l) => l.trim().startsWith(`${id}:`) && l.includes('space: "world"'));
  ck("G11 every layer offered is a world layer of the engine", ids.every(worldLine) && main.includes(`const LAYERS = ${JSON.stringify(ids).replace(/,/g, ", ")}`)); }
console.log(`sweep ltok: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
