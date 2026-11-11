/* node scripts/i18n/check-names.mjs -- the Polish names of the compendium's powers, boosts, limits, talents, drawbacks, gear, power sources
   and critical injuries (item-names-pl.mjs + item-ids.mjs), the effect lines of the abilities list (tactics/lang-fx.mjs) and the
   agreement of the attribute grades (terms.mjs gradePl). It fails when:
     - a compendium entry (or a pregenerated character's item) of a covered type has no Polish name;
     - two different entries of one type share one Polish name;
     - a name uses a variant the glossary bans;
     - a power, boost, limit or talent the abilities list knows has no effect line (either language);
     - a masculine grade stands beside a feminine attribute (or the other way round) in any Polish text of the module;
     - item-ids.mjs is behind the packs (only when the packs and Foundry's LevelDB reader are on this machine).
   Run by the tactics suite (scripts/tactics/check-names.mjs is its stub). */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NAMES_PL, PARAMS_PL } from "./item-names-pl.mjs";
import { PACK_IDS, EMBEDDED_IDS } from "./item-ids.mjs";
import * as N from "./item-names.mjs";
import { bannedIn } from "./glossary-banned.mjs";
import { collect, flatten, ROOT } from "./collect-pl.mjs";
import { ATTRS, TERMS, GRADES_PL, ATTR_GENDER_PL, gradePl } from "./terms.mjs";
import { allRows } from "../tactics/kit-pure.mjs";
import { EN_FX, PL_FX } from "../tactics/lang-fx.mjs";

let checks = 0, failed = 0;
const ok = (c, m) => { checks++; if (!c) { failed++; if (failed <= 60) console.log("FAIL", m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/* ---- every entry has a name */
/* not content: the pregenerated sheets carry a GM switch as an item */
const NOT_CONTENT = new Set(["Toggle Dead Civillians"]);
const TYPES = Object.keys(NAMES_PL);
let entries = 0;
for (const [label, table] of [["compendium", PACK_IDS], ["pregenerated", EMBEDDED_IDS]]) for (const [type, rows] of Object.entries(table)) {
  ok(TYPES.includes(type), `${label}: type ${type} is covered by the name table`);
  for (const [en, ids] of Object.entries(rows)) {
    if (NOT_CONTENT.has(en)) continue;
    entries++;
    const pl = NAMES_PL[type]?.[en] ?? NAMES_PL[type]?.[en.replace(/\s+/g, " ").trim()];
    ok(typeof pl === "string" && pl.trim().length > 1, `${label} ${type} "${en}" has a Polish name`);
    ok(typeof ids === "string" && ids.length >= 16 && ids.length % 16 === 0, `${label} ${type} "${en}" carries whole identifiers`);
    if (typeof pl !== "string") continue;
    const hits = bannedIn(pl, `names.${type}`);
    ok(!hits.length, `${type} "${en}" -> "${pl}": banned variant ${hits.map((h) => `"${h.hit}" [${h.id}: ${h.use}]`).join(", ")}`);
    ok(!/[—–]/.test(pl) && pl === pl.trim() && !/\s{2}/.test(pl), `${type} "${en}" -> "${pl}": plain text (no long dash, no stray space)`);
    for (let i = 0; i < ids.length; i += 16) ok(N.entriesById(ids.slice(i, i + 16)).some((e) => e.pl === pl && e.type === type), `${type} "${en}": identifier ${ids.slice(i, i + 16)} leads to "${pl}"`);
  }
}
ok(entries > 350, `the identifier index is not empty (${entries} names)`);

/* ---- no two entries of one type share a name. A leveled or bracketed variant of the SAME entry may ("Major Protection" and
   "Protection", "Knowledgeable (Technology)" and "Knowledgeable"): they are one thing to the reader. */
const base = (en) => String(en).toLowerCase().replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+x\d+$/, "").replace(/^(basic|major|massive|monstrous)\s+/, "").replace(/[^a-z0-9]/g, "");
for (const type of TYPES) {
  const by = new Map();
  for (const [en, pl] of Object.entries(NAMES_PL[type])) { const k = pl.toLowerCase(); if (!by.has(k)) by.set(k, new Set()); by.get(k).add(base(en)); }
  for (const [pl, set] of by) ok(set.size === 1, `${type}: the Polish name "${pl}" stands for one entry only (it names ${[...set].join(", ")})`);
}
for (const [k, v] of Object.entries(PARAMS_PL)) { ok(k === k.toLowerCase() && typeof v === "string" && v, `parameter "${k}" is keyed in lower case and has a word`); ok(!bannedIn(v, "names.param").length, `parameter "${k}" -> "${v}" uses no banned variant`); }

/* ---- what a reader sees (the rules of the display, pure) */
N.setLang("pl");
const blast = N.entryByName("power", "Blast"), know = N.entryByName("talent", "Knowledgeable");
ok(blast && know, "the table knows Blast and Knowledgeable");
eq([N.shownName("Blast", blast), N.shownName("blast", blast), N.shownName("My Blast", blast), N.shownName("Promień śmierci", blast), N.shownName("Blast", null)], [blast.pl, blast.pl.charAt(0).toLowerCase() + blast.pl.slice(1), "My Blast", "Promień śmierci", "Blast"],
  "an item shows the Polish name only while it still carries the original one; a renamed item and an item with no entry keep what is stored");
eq(N.shownName("Knowledgeable (Technology)", know), `${know.pl} (${PARAMS_PL.technology ?? "Technology"})`, "a parameter in brackets stays, translated when the table knows it");
eq([N.displayName({ type: "power", name: "Blast", _stats: { compendiumSource: `Compendium.invincible-core.core-powers.Item.${PACK_IDS.power.Blast.slice(0, 16)}` } }), N.displayName({ type: "power", name: "Blast" }), N.displayName({ type: "power", name: "Blast", _stats: { compendiumSource: "Compendium.other.pack.Item.aaaaaaaaaaaaaaaa" } }),
  N.displayName({ type: "power", name: "Death Ray", _stats: { compendiumSource: `Compendium.invincible-core.core-powers.Item.${PACK_IDS.power.Blast.slice(0, 16)}` } }), N.displayName(null), N.displayName({ type: "weird", name: "X" })],
  [blast.pl, "Blast", "Blast", "Death Ray", "", "X"], "the name comes from the source identifier: an item made from scratch, one from another world's pack and a renamed one keep their stored names; a missing item is harmless");
eq(N.displayName({ type: "power", name: "Blast", flags: { "invincible-plus-ultra": { chargenRun: "x" } } }), blast.pl, "an item the character creator wrote (it drops the source) is recognised by its mark");
N.setLang("en");
eq([N.displayName({ type: "power", name: "Blast", _stats: { compendiumSource: `Compendium.invincible-core.core-powers.Item.${PACK_IDS.power.Blast.slice(0, 16)}` } }), N.catalogName("power", "Blast"), N.matchesName("wiąz", "power", "Blast")], ["Blast", "Blast", false], "an English client sees the stored names and nothing else");
N.setLang("pl");
eq([N.matchesName("wiąz", "power", "Blast"), N.matchesName("bla", "power", "Blast"), N.matchesName("zzz", "power", "Blast")], [true, true, false], "a search finds an entry by either name");
N.setLang(undefined);

/* ---- effect lines */
const listed = allRows().filter((r) => ["power", "boost", "limit", "talent"].includes(r.cat));
ok(listed.length > 200, `the abilities list knows its rows (${listed.length})`);
for (const r of listed) for (const [lang, table] of [["en", EN_FX], ["pl", PL_FX]]) { const s = table[`ITAC.kit.fx.${r.key}`]; ok(typeof s === "string" && s.length >= 12 && /[.!?)]$/.test(s), `${r.cat} "${r.name}"${r.of ? ` (${r.of})` : ""} has an effect line (${lang})`); }
const rowKeys = new Set(listed.map((r) => `ITAC.kit.fx.${r.key}`));
for (const k of Object.keys(PL_FX)) ok(rowKeys.has(k), `effect line ${k} belongs to a row of the list`);
const JARGON = /\bengine\b|by hand|GM confirms|silnik|ręczn|MG potwierdza|potwierdza MG|automat/i;
for (const [k, v] of [...Object.entries(EN_FX), ...Object.entries(PL_FX)]) ok(!JARGON.test(v), `${k}: an effect line says what the ability does, never how it is run ("${v.slice(0, 60)}")`);

/* ---- grades agree with the attribute */
const plj = flatten(JSON.parse(readFileSync(join(ROOT, "lang", "pl.json"), "utf8")));
eq(GRADES_PL.m.map((_, i) => plj[`INVINCIBLE.Actor.base.FIELDS.attributes.graduation.${i}`]), [...GRADES_PL.m], "the neutral (masculine) grades are the ones lang/pl.json carries under the system's keys");
eq([GRADES_PL.m.length, GRADES_PL.f.length, ATTRS.every((a) => ["m", "f"].includes(ATTR_GENDER_PL[a]))], [13, 13, true], "13 grades in both genders, a gender for every attribute");
eq([gradePl(8, "fighting"), gradePl(9, "strength"), gradePl(3, "reason"), gradePl(6, "agility"), gradePl(3), gradePl(99, "reason")], ["Oszałamiająca", "Fenomenalna", "Dobry", "Niesamowita", "Dobry", null], "the grade takes the gender of the attribute beside it; with no attribute it is the neutral form");
for (let i = 1; i < 13; i++) ok(GRADES_PL.f[i] !== GRADES_PL.m[i] && /a$/.test(GRADES_PL.f[i]), `grade ${i}: the feminine form differs ("${GRADES_PL.f[i]}")`);
/* the stems of the attribute names in any case ("Walki", "Siłę", "Rozumu") */
const STEM = { fighting: "Walk", agility: "Zwinnoś", strength: "Sił", reason: "Rozum", intuition: "Intuicj", presence: "Prezencj" };
for (const a of ATTRS) ok(TERMS.pl[a].startsWith(STEM[a]), `the stem of ${a} matches its name`);
const stems = (g) => ATTRS.filter((a) => ATTR_GENDER_PL[a] === g).map((a) => STEM[a]).join("|");
const WRONG = [new RegExp(`(?<![\\p{L}])(${GRADES_PL.m.slice(1).join("|")})\\s+(${stems("f")})`, "iu"), new RegExp(`(?<![\\p{L}])(${GRADES_PL.f.slice(1).join("|")})\\s+(${stems("m")})`, "iu")];
export const gradeClash = (text) => { for (const re of WRONG) { const m = re.exec(String(text ?? "")); if (m) return m[0]; } return null; };
for (const bad of ["Oszałamiający Walka", "Fenomenalny Siła", "ma Dobry Zwinność", "Dobra Rozum", "niesamowity Prezencja"]) ok(gradeClash(bad), `the agreement check catches "${bad}"`);
for (const good of ["Oszałamiająca Walka", "Fenomenalna Siła", "Dobry Rozum", "Niesamowita Zwinność", "Dobry rzut na Walkę", "Boski", "Słaby punkt"]) ok(!gradeClash(good), `"${good}" is clean`);
const rows = await collect(ROOT);
for (const r of rows) { const hit = gradeClash(r.pl); ok(!hit, `${r.file} ${r.key}: the grade does not agree with the attribute ("${hit}")`); }
for (const [k, v] of Object.entries(plj)) if (typeof v === "string") { const hit = gradeClash(v); ok(!hit, `lang/pl.json ${k}: the grade does not agree with the attribute ("${hit}")`); }
for (const [type, t] of Object.entries(NAMES_PL)) for (const [en, pl] of Object.entries(t)) ok(!gradeClash(pl), `${type} "${en}" -> "${pl}": the grade agrees`);

/* ---- the identifier index is what the packs say (only where the packs can be read) */
try {
  const tool = join(ROOT, "tools", "build-item-ids.mjs");
  if (existsSync(tool)) {
    const { scan, render, OUT } = await import(`file:///${tool.replace(/\\/g, "/")}`);
    const s = await scan().catch(() => null);
    if (s) { const lf = (x) => String(x).replace(/\r\n/g, "\n"); ok(lf(render(s)) === lf(readFileSync(OUT, "utf8")), "scripts/i18n/item-ids.mjs is what the packs say now (run: node tools/build-item-ids.mjs)"); }
    else console.log("  (packs not readable here: the freshness of item-ids.mjs was not checked)");
  }
} catch (err) { console.log(`  (packs not readable here: ${String(err?.message ?? err).slice(0, 80)})`); }

console.log(failed ? `FAIL check-names: ${failed} of ${checks} checks failed` : `OK ${checks} checks (check-names)`);
process.exit(failed ? 1 : 0);
