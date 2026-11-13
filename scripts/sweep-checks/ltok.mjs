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
ck("B2 the GM and a reader get the kind and the number", eq(P.audience(GM, c("health", 5, 0)), { show: true, kind: "down", num: 5, exact: true }) && P.audience(OWN, c("resolve", 3, 4)).num === 1);
ck("B3 another's hand-edited hit: seen, not counted", eq(P.audience(OTHER, c("health", 8, 2)), { show: true, kind: "hit", num: null }));
ck("B4 another's hit the table was told: the told number, heavy from it alone", eq(P.audience(OTHER, c("health", 8, 7), { taken: 1 }), { show: true, kind: "hit", num: 1 }) && P.audience(OTHER, c("health", 8, 5), { taken: 3 }).kind === "heavy");
ck("B5 another going to 0 without a public word stays a hit (Health is not public)", P.audience(OTHER, c("health", 2, 0)).kind === "hit" && P.audience(OTHER, c("health", 2, 0), { taken: 2, broken: true }).kind === "down");
ck("B6 another's Resolve is never shown unless the fight announced the stress", P.audience(OTHER, c("resolve", 5, 4)).show === false && P.audience(OTHER, c("resolve", 5, 7)).show === false
  && eq(P.audience(OTHER, c("resolve", 5, 3), { taken: 2, toStress: true }), { show: true, kind: "stress", num: 2 }));
ck("B7 another's healing: seen, not counted; getting up reads as healing", eq(P.audience(OTHER, c("health", 2, 5)), { show: true, kind: "heal", num: null }) && P.audience(OTHER, c("health", 0, 2)).kind === "heal");
ck("B8 a challenge's time limit is the HUD's", P.audience({ visible: true, staff: true, challenge: true }, c("resolve", 3, 2)).show === false && P.audience({ visible: true, staff: true, challenge: true }, c("health", 3, 2)).show === true);
ck("B9 nothing from nothing", P.audience(GM, null).show === false && P.audience(null, c("health", 3, 2)).show === false);
ck("B10 an event with no track change (hit while broken) still answers", P.fromEvent({ taken: 2 }, "health").kind === "hit" && P.fromEvent({ taken: 0, broken: true }, "health").kind === "down" && P.fromEvent({ taken: 0 }, "health") === null && P.fromEvent({ taken: 1 }, "resolve").kind === "stress");
ck("B11 who may read: the damage card's rule", P.mayRead({ gm: true }) && P.mayRead({ type: "challenge" }) && P.mayRead({ type: "superhero", playerHero: true }) && P.mayRead({ observer: true }) && !P.mayRead({ type: "npc" }) && !P.mayRead({ type: "superhero" }) && !P.mayRead(null));

/* C: the lettering */
const kinds = [...P.HEALTH, ...P.RESOLVE];
for (const kd of kinds) {
  const lk = P.look({ kind: kd, num: 2, exact: true }, { r: 0.25 }, "pl", "s1");
  ck(`C1 ${kd}: a word, a mood, a palette, a number`, !!lk && typeof lk.word === "string" && lk.word.length > 0 && !!lk.mood && lk.colors.length === 3 && /^[+-]2$/.test(lk.number.text));
  ck(`C2 ${kd}: words in both languages`, P.WORDS.en[kd]?.length >= 2 && P.WORDS.pl[kd]?.length >= 2);
}
ck("C3 the sign says the direction", P.look({ kind: "hit", num: 3 }, null, "en", "a").number.text === "-3" && P.look({ kind: "heal", num: 3 }, null, "en", "a").number.text === "+3" && P.look({ kind: "regain", num: 1 }, null, "en", "a").number.text === "+1" && P.look({ kind: "stress", num: 1 }, null, "en", "a").number.text === "-1");
ck("C4 no number: none drawn", P.look({ kind: "hit", num: null }, null, "en", "a").number === null);
ck("C5 the same seed, the same lettering on every seat", eq(P.look({ kind: "heavy", num: 4 }, { r: 0.5 }, "pl", "tok|health|8|4|123"), P.look({ kind: "heavy", num: 4 }, { r: 0.5 }, "pl", "tok|health|8|4|123")));
{ const words = new Set(); for (let i = 0; i < 40; i++) words.add(P.look({ kind: "hit", num: 1 }, null, "en", `x${i}`).word); ck("C6 different from one time to the next (several words in use)", words.size >= 4); }
{ const a = P.look({ kind: "hit", num: 1 }, null, "en", "same"); const b = P.look({ kind: "hit", num: 1 }, null, "en", "same", a.word); ck("C7 never the same word twice in a row on a seat", a.word !== b.word); }
ck("C8 how much shows: a bigger blow is louder and bigger", (() => { const s = P.look({ kind: "hit", num: 1, exact: true }, { r: 0.1 }, "en", "q"), b = P.look({ kind: "hit", num: 2, exact: true }, { r: 0.5 }, "en", "q"); return b.sound.loud > s.sound.loud && b.size > s.size && b.number.size > s.number.size; })());
ck("C9 a heavy hit is bigger than a hit, spent is the quietest", P.look({ kind: "heavy", num: 3 }, null, "en", "q").size > P.look({ kind: "hit", num: 3 }, null, "en", "q").size && P.look({ kind: "spent", num: 1 }, null, "en", "q").size < P.look({ kind: "stress", num: 1 }, null, "en", "q").size);
ck("C10 a seat that may not read gets no share of the track in the size", eq(P.look({ kind: "hit", num: 2 }, { r: 1 }, "en", "q"), P.look({ kind: "hit", num: 2 }, { r: 0.01 }, "en", "q")));
ck("C11 rising kinds use rising moods, falls falling ones (contract: heal / powerup rise, fail / crash fall)", ["heal", "back", "regain", "steady"].every((k) => ["heal", "powerup"].includes(P.look({ kind: k, num: 1 }, null, "en", "q").mood)) && ["down", "out", "heavy"].every((k) => ["fail", "crash"].includes(P.look({ kind: k, num: 1 }, null, "en", "q").mood)));
ck("C12 Health and Resolve in different colours", P.look({ kind: "hit", num: 1 }, null, "en", "q").colors[1] !== P.look({ kind: "stress", num: 1 }, null, "en", "q").colors[1]);
ck("C13 an unknown kind: nothing", P.look({ kind: "zzz", num: 1 }, null, "en", "q") === null);
ck("C14 every word uses only letters the engine draws (Polish letters, ! ? - . and spaces)", Object.values(P.WORDS).every((t) => Object.values(t).flat().every((w) => /^[A-ZĄĆĘŁŃÓŚŹŻ!?\-. ]+$/.test(w))));

/* D: many at once */
const crowd = (k) => P.stage(Array.from({ length: k }, (_, i) => ({ key: `t${i}`, sev: i % 4 === 0 ? 9 : 3, hasNum: true })));
ck("D1 one: full, no delay, full size", eq(crowd(1).map((x) => [x.mode, x.delay, x.scale]), [["full", 0, 1]]));
ck("D2 three: all full, staggered", crowd(3).every((x) => x.mode === "full") && crowd(3)[2].delay > crowd(3)[1].delay);
ck("D3 eight: the heaviest first, two in full, the rest numbers", (() => { const s = crowd(8); return s[0].sev === 9 && s.filter((x) => x.mode === "full").length === 2 && s.filter((x) => x.mode === "number").length === 6; })());
ck("D4 thirty: at most ten on the map, smaller", (() => { const s = crowd(30); return s.filter((x) => x.mode !== "none").length === P.CROWD.shown && s[0].scale < 1; })());
ck("D5 a crowd's entrances are tight (the last within a second)", Math.max(...crowd(30).map((x) => x.delay)) < 1000);
ck("D6 no number to show: a crowd leaves it out", P.stage([{ sev: 9, hasNum: true }, { sev: 8, hasNum: true }, { sev: 7, hasNum: true }, { sev: 1, hasNum: false }])[3].mode === "none");

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
ck("G3 world space at the token, through the shared engine only", main.includes('space: "world", at: tok.document') && main.includes('from "../letters/index.mjs"') && !/PIXI\.Text|createScrollingText/.test(main));
ck("G4 a player never gets a hidden token", main.includes("staff || doc?.hidden !== true"));
ck("G5 waits for the dice and the camera's blow", main.includes("Gate.after(") && main.includes("Moment.landing("));
ck("G6 reduced motion is passed on", main.includes("reduced: red") && main.includes("prefers-reduced-motion"));
ck("G7 client settings, on by default", /scope: "client", config: true, type: Boolean, default: true/.test(main));
ck("G8 the engine's folder is not imported anywhere but its entry", !/letters\/(engine|font|rng)\.mjs/.test(main));
ck("G9 nothing is written to any document", !/\.update\(|\.setFlag\(|\.create\(|ChatMessage\.create/.test(main));

console.log(`sweep ltok: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
