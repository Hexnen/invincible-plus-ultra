/* node scripts/i18n/check-glossary.mjs -- one Polish vocabulary (dev/glossary-pl.md), kept so by a test.
   1) SYSTEM COVERAGE: every key of the Invincible system's en.json (the snapshot of 2.1.8 in system-en.snapshot.json, and the installed
      system's own file when it is found) has a Polish text in lang/pl.json: non-empty exactly where the English is, the same {placeholders},
      the same HTML tags, the same trailing space. Keys the system uses but lacks, and the literal keys, are there too.
   2) BANNED VARIANTS: no Polish string of the module (lang tables, inline `pl:` tables, hardcoded Polish literals, lang/pl.json) uses a
      variant the glossary rejected (glossary-banned.mjs).
   3) ONE SOURCE: terms.mjs equals the system labels in both languages; the lang tables agree with terms.mjs and with the system's labels
      wherever they name the same thing (attributes, resources, power levels, stunts, item types).
   4) COUPLINGS: sys-labels.mjs knows both renderings of every system label the code matches stored text against, and no script compares
      stored text with one localize() call of such a key; the keyless texts of system-texts.mjs have wording in both language files and
      still exist in the installed system's sources.
   Wired into scripts/tactics/check-all.mjs (suite "glossary"). */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { collect, flatten, ROOT } from "./collect-pl.mjs";
import { BANNED, bannedIn } from "./glossary-banned.mjs";
import { TERMS, ATTRS, ATTR_ACC_PL, TERM_KEYS } from "./terms.mjs";
import { MATCH_LABELS } from "./sys-labels.mjs";
import { KEYLESS, DOM_TEXTS, matchKeyless, translateNotice } from "./system-texts.mjs";

let checks = 0, failed = 0;
const ok = (c, m) => { checks++; if (!c) { failed++; if (failed <= 60) console.log("FAIL", m); } };
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const tags = (s) => [...String(s).matchAll(/<\/?\w+>/g)].map((m) => m[0]).sort().join("");

const plNested = json(join(ROOT, "lang", "pl.json")), enNested = json(join(ROOT, "lang", "en.json"));
const PLJ = flatten(plNested), ENJ = flatten(enNested);
const snap = json(join(ROOT, "scripts", "i18n", "system-en.snapshot.json"));

/* ---- 1) system coverage ---- */
const covers = (sysEn, label) => {
  for (const [k, en] of Object.entries(sysEn)) {
    const pl = PLJ[k];
    ok(typeof pl === "string", `${label}: system key without Polish text: ${k}`);
    if (typeof pl !== "string") continue;
    ok(!!pl.trim() === !!String(en).trim(), `${label}: ${k}: Polish must be ${String(en).trim() ? "non-empty" : "empty like the English"}`);
    ok(ph(pl) === ph(en), `${label}: ${k}: placeholders differ ({${ph(en)}} vs {${ph(pl)}})`);
    ok(tags(pl) === tags(en), `${label}: ${k}: HTML tags differ`);
    ok(/\s$/.test(pl) === /\s$/.test(en), `${label}: ${k}: trailing space differs (the system glues this label to a name)`);
  }
};
ok(Object.keys(snap.keys).length >= 323, "the snapshot holds the system's keys");
covers(snap.keys, `snapshot ${snap.version}`);
// the installed system, when this checkout can see one (the module's own folder in Data/modules, IPU_SYSTEM_DIR, or the default data folder)
const sysDirs = [process.env.IPU_SYSTEM_DIR, join(ROOT, "..", "..", "systems", "invincible"),
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "FoundryVTT", "Data", "systems", "invincible")].filter(Boolean);
const sysDir = sysDirs.find((d) => existsSync(join(d, "lang", "en.json")));
let liveNote = "installed system not found (snapshot only)";
if (sysDir) {
  const live = flatten(json(join(sysDir, "lang", "en.json")));
  let version = "?"; try { version = json(join(sysDir, "system.json")).version; } catch { /* unknown */ }
  liveNote = `installed system ${version}`;
  covers(live, `installed ${version}`);
  for (const [k, en] of Object.entries(live)) ok(snap.keys[k] === en, `installed ${version}: ${k} is new or reworded since the snapshot ${snap.version}: review its Polish text, then refresh system-en.snapshot.json`);
  // the keyless texts must still be in the system's sources, word for word
  const walk = (d, out = []) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(mjs|js|hbs)$/.test(n)) out.push(p); } return out; };
  const src = [...walk(join(sysDir, "system")), ...walk(join(sysDir, "templates"))].map((p) => readFileSync(p, "utf8")).join("\n");
  for (const [id, en] of Object.entries({ ...KEYLESS, ...DOM_TEXTS })) {
    const parts = en.split(/\{\w+\}/).filter((s) => s.trim());
    ok(parts.every((p) => src.includes(p)), `installed ${version}: the keyless text "${en}" (${id}) is no longer in the system's code: update system-texts.mjs`);
  }
  for (const lit of ["Edit", "Delete", "Apply", "Save", "Power Boost", "Select the attribute"]) ok(src.includes(`"${lit}"`), `installed ${version}: the literal "${lit}" is no longer in the system's code`);
}
// keys the system uses but its en.json lacks, and the literals it sends through localize: Polish present, English given in our override
for (const k of ["INVINCIBLE.Actor.Tabs.weapons", "INVINCIBLE.Item.Gear.FIELDS.quantity.label", "INVINCIBLE.Automation.FIELDS.rollAttack.stressCost.label",
  "YZUR.CHAT.ROLL.ATTACK.BLIGHT", "YZUR.CHAT.ROLL.ATTACK.DESPAIR"]) { ok(!!PLJ[k], `missing-key Polish: ${k}`); ok(!!ENJ[k], `missing-key English: ${k}`); }
for (const k of ["Name", "Yes", "No", "Duplicate", "Edit", "Delete", "Apply", "Save", "Power Boost", "Select the attribute"]) ok(typeof plNested[k] === "string" && plNested[k] && plNested[k] !== k, `literal key without Polish: ${k}`);
// the English override only corrects: every key it shares with the system differs from the system's text by a fixed typo
for (const [k, v] of Object.entries(ENJ)) if (k in snap.keys) ok(v !== snap.keys[k] && !/Civilan|Suppies|an weapon/.test(v), `lang/en.json repeats the system's text for ${k}`);
ok(!/Civilan|Suppies|an weapon/.test(JSON.stringify(enNested)), "the English override has no typo");
// module.json declares both files
const manifest = json(join(ROOT, "module.json"));
for (const lang of ["pl", "en"]) {
  const e = (manifest.languages ?? []).find((l) => l.lang === lang);
  ok(!!e && existsSync(join(ROOT, e.path)), `module.json declares languages[${lang}] and the file exists`);
}

/* ---- 2) banned variants ---- */
const rows = await collect(ROOT);
ok(rows.length > 4000, `the collector found the Polish strings (${rows.length})`);
const seen = new Set();
for (const r of rows) {
  const id = `${r.file}|${r.key}|${r.pl}`;
  if (seen.has(id)) continue; seen.add(id);
  const hits = bannedIn(r.pl, r.key);
  ok(!hits.length, `${r.file} ${r.key}: banned variant ${hits.map((h) => `"${h.hit}" [${h.id}: ${h.use}]`).join(", ")} in "${String(r.pl).slice(0, 90)}"`);
}
// the rules themselves work (a rule that never fires protects nothing)
for (const [bad, id] of [["Resolve 3", "A1"], ["niskie Health", "A2"], ["rzut na Charyzmę", "A3"], ["Wybierz stunty", "A6"], ["po pushu", "A7"], ["obrażenie krytyczne", "A9"],
  ["Powaleni sługusi", "A11"], ["pokaż token", "A12"], ["Rzuć D66", "A23"], ["-3 kostki", "A24"], ["CR −1", "A26"], ["Ważny NPC", "B7"], ["jest Twój", "A32"], ["Bazowe obrażenia", "110"]]) {
  ok(bannedIn(bad).some((h) => h.id === id), `rule ${id} catches "${bad}"`);
}
for (const good of ["Determinacja 3", "rzut na Prezencję", "Wybierz wyczyny", "po forsowaniu", "rana krytyczna", "Powalone sługusy", "pokaż żeton", "Losuj (K66)", "-3 kości", "Twój ruch.", "Kluczowy NPC", "moc Flight"]) {
  ok(!bannedIn(good).length, `"${good}" is clean`);
}
ok(bannedIn("Charyzma", "INVINCIBLE.Ability.Cha.long").length === 0 && BANNED.length >= 40, "allow-lists apply");

/* ---- 3) one source ---- */
for (const [id, key] of Object.entries(TERM_KEYS)) {
  ok(TERMS.pl[id] === PLJ[key], `terms.mjs pl.${id} "${TERMS.pl[id]}" = lang/pl.json ${key} "${PLJ[key]}"`);
  ok(TERMS.en[id] === snap.keys[key], `terms.mjs en.${id} = the system's English`);
}
for (const a of ATTRS) {
  ok(PLJ[`INVINCIBLE.Effects.system.attributes.${a}.value`] === `Atrybut: ${TERMS.pl[a]}`, `effect label of ${a} uses the term`);
  ok(PLJ[`INVINCIBLE.Effects.bonus.${a}`].endsWith(` na ${ATTR_ACC_PL[a]}`), `"rzuty na ..." of ${a} uses the accusative`);
}
const table = new Map();   // key -> pl (lang tables only)
for (const r of rows) if (!r.key.startsWith("inline:") && r.file !== "lang/pl.json") table.set(r.key, r.pl);
const en = new Map(); for (const r of rows) if (r.en) en.set(r.key, r.en);
const same = (key, want, why) => { if (table.has(key)) ok(table.get(key) === want, `${key} "${table.get(key)}" must be "${want}" (${why})`); else ok(false, `${key} is gone: update check-glossary.mjs (${why})`); };
for (const a of ATTRS) for (const k of [`IPC.Attr.${a}`, `IPL.Key.${a}`, `ITAC.ui.attr.${a}`]) same(k, TERMS.pl[a], "attribute name");
for (const k of ["IPL.Key.health", "ICB.Bar.Health", "IPT.Health", "IPC.Preview.Health"]) same(k, TERMS.pl.health, "Health");
for (const k of ["IPL.Key.resolve", "ICB.Bar.Resolve", "IPT.Resolve", "IPC.Preview.Resolve"]) same(k, TERMS.pl.resolve, "Resolve");
same("IPL.Key.slugfest", TERMS.pl.slugfest, "Slugfest"); same("IPC.Preview.Slugfest", TERMS.pl.slugfest, "Slugfest");
for (const lv of ["basic", "major", "massive", "monstrous"]) same(`IPC.Level.${lv}`, PLJ[`INVINCIBLE.Item.Power.FIELDS.level.${lv}.label`].trim(), "power level = the system's label");
const STUNTS = { doubleDamage: "DoubleDamage", knockback: "Knockback", stun: "Stun", bangHeads: "BangHeads", suppressed: "Suppressed", trickShot: "TrickShot", trap: "Trap", disarm: "Disarm",
  deadlyHit: "DeadlyHit", special: "SpecialStunt", own: "YourOwn", slam: "Slam" };
for (const [ours, sys] of Object.entries(STUNTS)) same(`ITAC.stunt.${ours}`, PLJ[`INVINCIBLE.Stunts.${sys}.label`], "stunt name = the system's label");
for (const ty of ["power", "talent", "gear", "criticalInjury", "powerSource", "boost", "limit", "drawback"]) same(`IPL.ItemType.${ty}`, PLJ[`TYPES.Item.${ty}`].toLocaleLowerCase("pl"), "item type = the system's label");
for (const rank of ["teen", "street", "global", "cosmic"]) ok(table.get(`IPC.Rank.${rank}`) === table.get(`IPB.Rank.${rank}`), `rank ${rank}: the creator and the team card agree`);
// every exact English term of the lang tables is rendered ONE way (label-sized strings only)
const EXACT = { Presence: "Prezencja", Resolve: "Determinacja", Health: "Zdrowie", Slugfest: "Bijatyka", Stunts: "Wyczyny", Stunt: "Wyczyn", Flaw: "Słabość", Personality: "Osobowość", "Critical injury": "Rana krytyczna",
  "Critical Injury": "Rana krytyczna", Gear: "Sprzęt", Speed: "Prędkość", Push: "Forsuj", Accept: "Przyjmij", "Full action": "Pełna akcja", "Quick action": "Szybka akcja", Declare: "Zadeklaruj", Unaware: "Nieświadomy",
  "Cosmic Champion": "Kosmiczny czempion", Major: "Większy", Massive: "Potężny", Monstrous: "Monstrualny" };
for (const [k, e] of en) if (e in EXACT && table.has(k)) ok(table.get(k).toLocaleLowerCase("pl") === EXACT[e].toLocaleLowerCase("pl"), `${k}: "${e}" must read "${EXACT[e]}", not "${table.get(k)}"`);

/* ---- 4) couplings ---- */
for (const [key, [e, p]] of Object.entries(MATCH_LABELS)) {
  ok(snap.keys[key] === e, `sys-labels.mjs ${key}: English "${e}" = the system's "${snap.keys[key]}"`);
  ok(PLJ[key] === p, `sys-labels.mjs ${key}: Polish "${p}" = lang/pl.json "${PLJ[key]}"`);
}
// no script compares stored text with ONE localize() call of a key that the system writes into data
const walkJs = (d, out = []) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walkJs(p, out); else if (/\.(mjs|js)$/.test(n) && !/^check-/.test(n)) out.push(p); } return out; };
for (const p of walkJs(join(ROOT, "scripts"))) {
  if (/[\\/]i18n[\\/]/.test(p)) continue;
  const src = readFileSync(p, "utf8");
  ok(!/===\s*game\.i18n\.localize\(\s*["'`]INVINCIBLE\.(Chat|Stunts)\./.test(src) && !/game\.i18n\.localize\(\s*["'`]INVINCIBLE\.(Chat|Stunts)\.[\w.]+["'`]\s*\)\s*[!=]==/.test(src),
    `${p.slice(ROOT.length + 1)}: compares stored text with one localize() call; use isLabel() of scripts/i18n/sys-labels.mjs`);
  ok(!/\.trim\(\)\s*[!=]==\s*["'](Damage Taken|Double Damage|Minions)["']/.test(src) && !/new Set\(\[\s*["']Minions["']/.test(src), `${p.slice(ROOT.length + 1)}: matches an English system label literally; use sys-labels.mjs`);
}
// keyless texts: wording in both files, English identical to what the code matches, Polish different and glossary-clean; the matcher works
for (const [id, e] of Object.entries({ ...KEYLESS, ...DOM_TEXTS })) {
  ok(ENJ[`IPU.Sys.${id}`] === e, `IPU.Sys.${id}: lang/en.json holds the system's English`);
  ok(!!PLJ[`IPU.Sys.${id}`] && PLJ[`IPU.Sys.${id}`] !== e, `IPU.Sys.${id}: lang/pl.json holds a Polish text`);
  ok(ph(PLJ[`IPU.Sys.${id}`] ?? "") === ph(e), `IPU.Sys.${id}: placeholders`);
}
for (const k of Object.keys(PLJ)) if (k.startsWith("IPU.Sys.")) ok(k.slice(8) in KEYLESS || k.slice(8) in DOM_TEXTS, `stray ${k}`);
{
  const i18n = { has: (k) => k in PLJ, localize: (k) => PLJ[k] ?? k, format: (k, d) => (PLJ[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => d[n] ?? "") };
  ok(translateNotice("You are not a GM!", i18n) === PLJ["IPU.Sys.notGM"], "a keyless notice is translated");
  ok(translateNotice("Could not find item Laser. You may need to delete and recreate this macro.", i18n) === PLJ["IPU.Sys.macroItemGone"].replace("{name}", "Laser"), "a keyless notice with a name is translated");
  ok(translateNotice("INVINCIBLE.Automation.FIELDS.macro.notFound", i18n) === PLJ["INVINCIBLE.Automation.FIELDS.macro.notFound"], "a raw key passed to the notifier is localized");
  ok(translateNotice("Something else entirely", i18n) === "Something else entirely" && matchKeyless("You are not a GM") === null, "other notices pass through untouched");
  ok(translateNotice(42, i18n) === 42 && translateNotice("x", null) === "x", "non-strings and a missing i18n are safe");
}

console.log(failed ? `FAIL check-glossary: ${failed} of ${checks} checks failed` : `OK ${checks} checks (check-glossary; ${liveNote})`);
process.exit(failed ? 1 : 0);
