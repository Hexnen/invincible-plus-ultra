// node scripts/sweep-checks/stunt-words.mjs  (STNT: every stunt on a roll card says what it does, in English and Polish)
// The chat cards (confirmed stunt tags, the stunt picker, the Double badge) read stunt-words.mjs; five stunts had no words before
// (Bang Heads, Trap, Deadly Hit, Suppressed, Trick Shot: the Quickstart journal, read before, does not describe them), a Polish client
// had none at all, and the journal gave older rules than the system applies for Double Damage (its "Extra Damage") and Knockback.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { STUNT_IDS, stuntKeyOf, stuntWords } from "../i18n/stunt-words.mjs";
import { STUNTS } from "../rules/stunts.mjs";
import { EN, PL } from "../tactics/lang.mjs";

let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const snap = JSON.parse(readFileSync(at("../i18n/system-en.snapshot.json"), "utf8"));
const SNAP = snap.keys ?? snap;
const PLJ = JSON.parse(readFileSync(at("../../lang/pl.json"), "utf8"));
const plOf = (key) => key.split(".").reduce((o, k) => o?.[k], PLJ);
const fmt = (s, d) => String(s).replace(/\{(\w+)\}/g, (_, k) => String(d[k] ?? ""));

// 1) the system's stunts = our table, and every one maps to a stunt of the rules library
const sysKeys = Object.keys(SNAP).map((k) => /^INVINCIBLE\.Stunts\.(\w+)\.label$/.exec(k)?.[1]).filter(Boolean);
ck(`every system stunt has an id (${sysKeys.join(",")})`, sysKeys.length === 12 && sysKeys.every((k) => STUNT_IDS[k]));
ck("every id is a stunt of rules/stunts.mjs", Object.values(STUNT_IDS).every((id) => STUNTS[id]));

// 2) words in both languages for all twelve, the five that had none included
for (const sys of sysKeys) {
  const en = stuntWords(sys, "en"), pl = stuntWords(sys, "pl");
  ck(`${sys}: English words`, !!en?.text && en.text.length >= 20 && en.name === SNAP[`INVINCIBLE.Stunts.${sys}.label`]);
  ck(`${sys}: Polish words`, !!pl?.text && pl.text.length >= 20 && pl.name === plOf(`INVINCIBLE.Stunts.${sys}.label`));
  ck(`${sys}: the Polish text is Polish, not the English fallback`, pl.text !== en.text);
  ck(`${sys}: the words are the tactical card's tip (one wording)`, en.text === EN[`ITAC.ui.stunt.tip.${STUNT_IDS[sys]}`] && pl.text === PL[`ITAC.ui.stunt.tip.${STUNT_IDS[sys]}`]);
}
for (const sys of ["BangHeads", "Trap", "DeadlyHit", "Suppressed", "TrickShot"]) ck(`${sys}: one of the five`, !!stuntWords(sys, "en") && !!stuntWords(sys, "pl"));
ck("German reads English", stuntWords("Trap", "de")?.text === stuntWords("Trap", "en")?.text);
ck("an unknown key has no words", stuntWords("Fireball", "en") === null);

// 3) a stored tag, written by an English or a Polish client, with its numbers, finds its stunt
const data = { value: 2, damage: 3 };
for (const sys of sysKeys) {
  const key = `INVINCIBLE.Stunts.${sys}.stunt`;
  ck(`${sys}: English tag "${fmt(SNAP[key], data)}"`, stuntKeyOf(fmt(SNAP[key], data)) === sys);
  ck(`${sys}: Polish tag "${fmt(plOf(key), data)}"`, stuntKeyOf(fmt(plOf(key), data)) === sys);
  ck(`${sys}: case and space do not matter`, stuntKeyOf(`  ${fmt(SNAP[key], data).toUpperCase()} `) === sys);
}
ck("a near name is not a stunt (Trapdoor)", stuntKeyOf("Trapdoor") === null);
ck("an empty tag is not a stunt", stuntKeyOf("") === null && stuntKeyOf(null) === null);

// 4) what the words claim agrees with the rules library (Deadly Hit's exclusions, the two stunts taken more than once)
ck("Bang Heads and Trick Shot say they can be taken more than once", STUNTS.bangHeads.multi && STUNTS.trickShot.multi
  && /more than once/.test(EN["ITAC.ui.stunt.tip.bangHeads"]) && /more than once/.test(EN["ITAC.ui.stunt.tip.trickShot"])
  && /kilka razy/.test(PL["ITAC.ui.stunt.tip.bangHeads"]) && /kilka razy/.test(PL["ITAC.ui.stunt.tip.trickShot"]));
ck("Deadly Hit names sharp damage and its two exclusions", /sharp/.test(EN["ITAC.ui.stunt.tip.deadlyHit"]) && /Knockback/.test(EN["ITAC.ui.stunt.tip.deadlyHit"]) && /Bang Heads/.test(EN["ITAC.ui.stunt.tip.deadlyHit"])
  && /ostrych/.test(PL["ITAC.ui.stunt.tip.deadlyHit"]) && /Odrzutem/.test(PL["ITAC.ui.stunt.tip.deadlyHit"]) && /Zderzeniem głów/.test(PL["ITAC.ui.stunt.tip.deadlyHit"]));
ck("the PL tip of Bang Heads names Deadly Hit by the system's PL label", /Zabójczym trafieniem/.test(PL["ITAC.ui.stunt.tip.bangHeads"]));

// 5) module.js: every place that shows a stunt's description goes through stuntTip; the Quickstart journal is no longer read for it
const mod = readFileSync(at("../module.js"), "utf8");
ck("module.js: no Quickstart lookup is left (basic-data, STUNT_ALIAS, stuntDocs)", !/basic-data|STUNT_ALIAS|stuntDocs/.test(mod));
ck("module.js: stuntTip answers in the reader's language from stunt-words.mjs", /async function stuntTip\([\s\S]{0,400}stuntWords\(sys, game\.i18n\.lang\)/.test(mod));
ck("module.js: the confirmed tags, the picker and the Double badge ask stuntTip", /stuntTip\(li\.textContent, \{ fromTag: true \}\)/.test(mod) && /names\.map\(\(name\) => stuntTip\(name\)\)/.test(mod) && /stuntTip\("DoubleDamage"\)/.test(mod));

// 6) our own words, never the book's: no run of 6 words of a stunt tip appears in the local rulebook dump (skipped where the dump is absent)
const dumpPath = at("../../dev/book-dump.txt");
if (existsSync(dumpPath)) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const book = norm(readFileSync(dumpPath, "utf8"));
  for (const id of Object.values(STUNT_IDS)) {
    const w = norm(EN[`ITAC.ui.stunt.tip.${id}`]).split(" ");
    const runs = []; for (let i = 0; i + 6 <= w.length; i++) runs.push(w.slice(i, i + 6).join(" "));
    ck(`${id}: no 6-word run of the book`, runs.every((r) => !book.includes(r)));
  }
}

console.log(`sweep stunt-words: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
