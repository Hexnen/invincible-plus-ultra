/* node scripts/sweep-checks/splashpl.mjs -- SPLASHPL (2026-11-14): the dice-roll splash's action words on a Polish seat.
   The owner's ruling: «przetłumacz, ale gdyby dobrze brzmiało»: an action word is shown in Polish when a Polish word sounds good shouted,
   else the English one stays; English seats unchanged. The event keeps the English word (the key every seat shares: message flag, mood,
   seed); only the shown text changes. Checked here:
     K  the table: every translated word is a real splash word; the English text of each key is the word itself; every Polish text is
        Polish (differs from the English), passes the glossary's banned variants, letters with the engine's characters, at most 3 words;
     S  showing: without labels nothing changes; with the Polish labels the translated words change and the pure sounds stay English;
        the moment's plan letters the Polish text with the English word's mood, and carries the English key (`en`);
        shownEv changes only the three shown words, never the event;
     E  an English seat (the EN table) letters every moment exactly as before;
     C  one moment for the table: in the invincible look the contact instant of the Polish word equals the English one for every
        translated word (smooth and stepped), and the stage aligns the shown word's contact to the English key's for the other looks;
     W  wiring: applyLabels fills LBL.sfx, the announcement, the lettered plan and the classic splash show the seat's word. */
import fs from "node:fs";
import { ok, eq, done, summary } from "../tactics/testkit.mjs";
import * as SL from "../splash/logic.mjs";
import * as LP from "../splash/letter-plan.mjs";
import * as IP from "../splash/impact-plan.mjs";
import { EN, PL } from "../splash/lang.mjs";
import { bannedIn } from "../i18n/glossary-banned.mjs";

const src = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const ALL = [...Object.values(SL.ACTIONS).flat(), ...SL.FAIL, ...SL.SOFTFAIL, ...SL.PUSHFAIL, ...SL.PUSHPRE, ...SL.WRECK];
const KEYS = Object.entries(SL.SFX_KEYS);
const plLabels = () => Object.fromEntries(KEYS.map(([, k]) => [k, PL[`INSPLASH.Word.${k}`]]));
const enLabels = () => Object.fromEntries(KEYS.map(([, k]) => [k, EN[`INSPLASH.Word.${k}`]]));
const allowed = new RegExp("^[\\p{L}\\p{N}!?\\-+\\x27. \\n]+$", "u");   // \x27, not a quote: the glossary's literal scanner reads a quote in a regex as a string

/* ---- K: the table */
ok(KEYS.length >= 30, `most action words have a Polish word (${KEYS.length})`);
for (const [w, k] of KEYS) {
  ok(ALL.includes(w), `K: ${w} is a splash word`);
  eq(EN[`INSPLASH.Word.${k}`], w, `K: the English text of ${k} is the word itself`);
  const p = PL[`INSPLASH.Word.${k}`];
  ok(typeof p === "string" && p.trim() && p !== w, `K: ${w} has a Polish text (${p})`);
  eq(bannedIn(p ?? "", `INSPLASH.Word.${k}`), [], `K: ${w} -> ${p}: no banned glossary variant`);
  ok(allowed.test(LP.letterable(p)) && LP.letterable(p) === p, `K: ${p} letters as written`);
  ok(String(p).trim().split(/\s+/).length <= 3, `K: ${p}: few words`);
  ok(p === p.toLocaleUpperCase("pl"), `K: ${p} is upper case like its English`);
  ok(/[!…]$/.test(w) === /[!…]$/.test(p), `K: ${w} / ${p}: a shout keeps its "!", a mutter has none`);
}
eq(new Set(KEYS.map(([, k]) => k)).size, KEYS.length, "K: one key per word");
ok(Object.keys(PL).filter((k) => k.startsWith("INSPLASH.Word.")).length === KEYS.length && Object.keys(EN).filter((k) => k.startsWith("INSPLASH.Word.")).length === KEYS.length, "K: both tables hold exactly the translated words");
ok(KEYS.some(([, k]) => /[ĄĆĘŁŃÓŚŹŻ]/.test(PL[`INSPLASH.Word.${k}`])), "K: Polish letters reach the action words");
/* SPLASHPL2 (the owner: «może zamiast zmiażdż - zmiażdżenie. i zburzenie zamiast zburz», «itd»): an imperative becomes the noun of the
   action where the noun sounds good shouted; HOLD! and TRY AGAIN stay imperatives (TRZYMANIE / PONOWNA PRÓBA sound flat) */
eq([PL["INSPLASH.Word.Crush"], PL["INSPLASH.Word.Demolish"]], ["ZMIAŻDŻENIE!", "ZBURZENIE!"], "K: the owner's two nouns (CRUSH!, DEMOLISH!)");
for (const k of ["Smash", "Crush", "Grab", "Push", "Demolish"]) ok(!/^(MIAŻDŻ|ZBURZ|ROZWAL|ŁAP|FORSUJ)!$/.test(PL[`INSPLASH.Word.${k}`]), `K: ${k}: the noun, not the imperative (${PL[`INSPLASH.Word.${k}`]})`);
/* the pure sounds stay English (nothing to translate: a Polish spelling would be an invented word) */
for (const w of ["WHAM!", "BAM!", "THWACK!", "WHOOSH!", "ZIP!", "SWISH!", "BLAM!", "ZAP!", "PEW!", "BANG!", "KRAK!", "POW!", "BOOM!", "KAPOW!", "ZOOM!", "CLUNK!", "GRRR!", "HNNNG!", "CRACK!", "SNAP!", "KRAKOOM!", "HMM…"])
  ok(!(w in SL.SFX_KEYS), `K: the sound ${w} stays English`);

/* ---- S: showing */
SL.setLabels({ sfx: {} });
for (const w of ALL) eq(SL.sfxWord(w), w, `S: without labels ${w} is shown as is`);
SL.setLabels({ sfx: plLabels() });
for (const w of ALL) ok(w in SL.SFX_KEYS ? SL.sfxWord(w) === PL[`INSPLASH.Word.${SL.SFX_KEYS[w]}`] : SL.sfxWord(w) === w, `S: a Polish seat shows ${w} as ${SL.sfxWord(w)}`);
eq([SL.sfxWord(null), SL.sfxWord(""), SL.sfxWord("UNKNOWN!")], [null, "", "UNKNOWN!"], "S: no word / an unknown word passes through");
const rng = ((s) => () => { s = (s * 16807) % 2147483647; return s / 2147483647; })(7);
const evOf = (rd) => SL.buildEvent({ newSixes: 0, rerolled: 0, pushed: false, stress: 0, action: "slugfest", ...rd }, { rng, st: null, dryN: 0 });
const cases = [];
for (const action of Object.keys(SL.ACTIONS)) for (const w of SL.ACTIONS[action]) cases.push({ ...evOf({ n: 6, sixes: 3, action }), word: w });
for (const w of SL.FAIL) cases.push({ ...evOf({ n: 9, sixes: 0 }), word: w });
for (const w of SL.SOFTFAIL) cases.push({ ...evOf({ n: 2, sixes: 0 }), word: w });
for (const w of SL.PUSHFAIL) cases.push({ ...evOf({ n: 6, sixes: 0, pushed: true, rerolled: 4 }), word: w, prefix: "PUSH!" });
for (const w of SL.PUSHPRE) cases.push({ ...evOf({ n: 6, sixes: 2, pushed: true, newSixes: 1, rerolled: 4 }), prefix: w });
for (const w of SL.WRECK) cases.push({ ...evOf({ n: 6, sixes: 4, wreck: true }), wreckWord: w });
for (const e of cases) {
  const frozen = JSON.stringify(e);
  const items = LP.planMoment(e, { dF: 0.8 }).items, by = (r) => items.find((i) => i.role === r);
  const w = by("word"), pre = by("pre"), wr = by("wreck");
  ok(w && w.text === SL.sfxWord(e.word) && w.en === e.word, `S: the word ${e.word} letters as ${w?.text} with its English key`);
  if (e.fail) ok(w.mood === (e.softFail ? "tick" : e.pushed && LP.WORD_MOOD[e.word] ? LP.moodOf(e.word) : "fail"), `S: ${e.word}: the miss keeps its mood (${w.mood})`);
  else eq(w.mood, LP.moodOf(e.word, e.action), `S: ${e.word} -> ${w.text}: the English word's mood`);
  if (e.pushed && e.prefix) ok(pre?.text === SL.sfxWord(e.prefix) && pre.mood === LP.moodOf(e.prefix), `S: the grunt ${e.prefix} letters as ${pre?.text}, its mood ${pre?.mood}`);
  if (e.wreckWord && !e.fail) ok(wr?.text === SL.sfxWord(e.wreckWord) && wr.mood === LP.moodOf(e.wreckWord), `S: the wreck ${e.wreckWord} letters as ${wr?.text}`);
  eq(JSON.stringify(e), frozen, `S: planning never changes the event (${e.word})`);
  const sh = SL.shownEv(e);
  ok(sh !== e && sh.word === SL.sfxWord(e.word) && sh.prefix === (e.prefix ? SL.sfxWord(e.prefix) : e.prefix) && sh.wreckWord === (e.wreckWord ? SL.sfxWord(e.wreckWord) : e.wreckWord), `S: shownEv shows ${e.word}`);
  ok(Object.keys(e).every((k) => ["word", "prefix", "wreckWord"].includes(k) || JSON.stringify(sh[k]) === JSON.stringify(e[k])), `S: shownEv keeps the rest of the event (${e.word})`);
}

/* ---- E: an English seat */
const plainTexts = () => cases.map((e) => LP.planMoment(e, { dF: 0.8 }).items.map((i) => i.text).join("|")).join("\n");
SL.setLabels({ sfx: {} }); const before = plainTexts();
SL.setLabels({ sfx: enLabels() }); const enSeat = plainTexts();
eq(enSeat, before, "E: an English seat letters every moment exactly as before");
SL.setLabels({ sfx: plLabels() }); const plSeat = plainTexts();
ok(plSeat !== before, "E: ... and a Polish seat does not");
SL.setLabels({ sfx: {} });

/* ---- C: one moment for the table */
{
  const { setup } = await import("../letters/testenv.mjs");
  const TL = await import("../letters/tools.mjs");
  const E = await setup({ gm: true }), L = E.engine;
  L.lookStyle("invincible");
  for (const mode of ["smooth", "stepped"]) {
    L.motionMode?.(mode);
    let n = 0, same = 0;
    for (const e of cases) {
      for (const P of [0.1, 0.5, 0.9]) {
        const ev = e.fail ? e : { ...e, power: P };
        const it = LP.planMoment(ev, { dF: 0.8 }).items.find((i) => i.role === "word");
        if (!(e.word in SL.SFX_KEYS)) continue;
        const o = { mood: it.mood, sound: it.sound, hold: it.hold, magnitude: it.magnitude, seed: "m1:word", anchor: "center", from: 90 };
        for (const k of ["in", "out", "holdKind"]) if (it[k]) o[k] = it[k];
        const c = (t) => IP.contactMs(TL.planFor(L, LP.letterable(t), o).plan);
        n++;
        if (c(e.word) === c(SL.SFX_KEYS[e.word] && PL[`INSPLASH.Word.${SL.SFX_KEYS[e.word]}`])) same++;
      }
    }
    ok(n > 60 && same === n, `C: ${mode}: the Polish word hits on the English word's instant (${same} of ${n})`);
  }
  L.motionMode?.("smooth");
  const st = src("../splash/stage.mjs");
  ok(/it\.en && it\.en !== it\.text\) try \{ const r = LE\.planFor \? LE\.planFor\(LP\.letterable\(it\.en\), o\)/.test(st) && /shot = impactShot\(ctl, it, contact \+ lead\);\s*o\.startAt \+= lead;/.test(st),
    "C: the stage strikes the shown word on the English key's contact (the impact, the token reactions: one instant on every seat)");
}

/* ---- W: wiring */
{
  const main = src("../splash/main.mjs"), st = src("../splash/stage.mjs"), lp = src("../splash/letter-plan.mjs");
  ok(/o\.sfx = Object\.fromEntries\(Object\.values\(SFX_KEYS\)\.filter\(k => has\('INSPLASH\.Word\.' \+ k\)\)/.test(main), "W: applyLabels fills LBL.sfx from INSPLASH.Word.*");
  ok(/parts\.push\(cap\(sfxWord\(ev\.word\)\)\)/.test(main), "W: the screen reader hears the word this seat shows");
  ok(/if \(WORDS\.has\(f\.word\)\) ev\.word = f\.word;/.test(main), "W: the message flag still carries the English word (validated against the English lists)");
  ok(/function playClassic\(ev, o\) \{\s*ev = shownEv\(ev\);/.test(st), "W: the classic splash shows the seat's words");
  eq((lp.match(/text: sfxWord\(ev\.(word|prefix|wreckWord)\)/g) ?? []).length, 4, "W: the lettered plan shows the seat's word, grunt and wreck");
  ok(!/text: ev\.(word|prefix|wreckWord)\b/.test(lp), "W: no lettering of the raw English key is left");
}

done("splashpl");
const sm = summary();
console.log(`sweep splashpl: ${sm.checks} checks, ${sm.failed} failed`);
process.exit(sm.failed ? 1 : 0);
