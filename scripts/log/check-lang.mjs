/* Key parity check for the activity log: node scripts/log/check-lang.mjs
   1) EN and PL define the same keys with the same {placeholders}; plural families are complete (EN one+other, PL one+few+many).
   2) Every event type of the registry has IPL.Type.<id> and IPL.Sum.<id> (+ every declared variant). 3) Dynamic families exist (categories, stat keys, item
   types, paths, levels, statuses, causes, sources, modes, actions). 4) Every IPL.* key written as a literal in scripts/log (ui included) is defined in both
   languages. 5) A sample entry of EVERY type renders a sentence with no leftover {token} in both languages. */
import * as L from "./lang.mjs";
import * as E from "./events.mjs";
import { sentenceText, variantOf } from "./ui/rows.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const dir = dirname(fileURLToPath(import.meta.url));
const { EN, PL } = L;
let bad = 0, checks = 0;
const fail = (m) => { bad++; console.log("FAIL", m); };
const ok = (c, m) => { checks++; if (!c) fail(m); };

const PLURAL = /\.(one|few|many|other)$/;
const base = (k) => k.replace(PLURAL, "");
const forms = (T) => { const m = new Map(); for (const k of Object.keys(T)) if (PLURAL.test(k)) { if (!m.has(base(k))) m.set(base(k), new Set()); m.get(base(k)).add(k.match(PLURAL)[1]); } return m; };
const fEN = forms(EN), fPL = forms(PL);
for (const [b, s] of fEN) ok(s.has("one") && s.has("other"), `EN plural ${b} needs .one and .other`);
for (const [b, s] of fPL) ok(s.has("one") && s.has("few") && s.has("many"), `PL plural ${b} needs .one, .few and .many`);
for (const b of fEN.keys()) ok(fPL.has(b), `plural ${b} missing in PL`);
for (const b of fPL.keys()) ok(fEN.has(b), `plural ${b} missing in EN`);
const plain = (T) => Object.keys(T).filter((k) => !PLURAL.test(k) || !(fEN.has(base(k)) || fPL.has(base(k))));
for (const k of plain(EN)) ok(k in PL, `in EN, missing in PL: ${k}`);
for (const k of plain(PL)) ok(k in EN, `in PL, missing in EN: ${k}`);
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
for (const k of plain(EN)) if (k in PL) ok(ph(EN[k]) === ph(PL[k]), `placeholders differ: ${k} (${ph(EN[k])} vs ${ph(PL[k])})`);
for (const b of fEN.keys()) { const a = ph(EN[`${b}.one`]); for (const T of [EN, PL]) for (const k of Object.keys(T)) if (base(k) === b && PLURAL.test(k)) ok(ph(T[k]) === a || (b === "IPL.Plural.Shown" && ph(T[k]) === "n,total"), `plural placeholders differ: ${k}`); }
for (const [k, v] of Object.entries(EN)) ok(typeof v === "string" && v.length > 0, `empty EN ${k}`);
for (const [k, v] of Object.entries(PL)) ok(typeof v === "string" && v.length > 0, `empty PL ${k}`);

// 2) the registry
for (const id of E.TYPE_IDS) {
  for (const T of [EN, PL]) { ok(`IPL.Type.${id}` in T, `missing IPL.Type.${id}`); ok(`IPL.Sum.${id}` in T, `missing IPL.Sum.${id}`); }
}
ok("IPL.Sum.unknown" in EN && "IPL.Sum.unknown" in PL, "missing IPL.Sum.unknown");
for (const [id, vs] of Object.entries(L.VARIANTS)) for (const v of vs) for (const T of [EN, PL]) ok(`IPL.Sum.${id}.${v}` in T, `missing variant IPL.Sum.${id}.${v}`);
// every Sum.* in the table belongs to a registry type or one of its declared variants
for (const k of Object.keys(EN)) if (k.startsWith("IPL.Sum.") && !/^IPL\.Sum\.(Build|BuildRank|Unit\.|Level$|Chars$|Empty$|Characters$|unknown$)/.test(k)) {
  const rest = k.slice(8);
  const id = E.isKnownType(rest) ? rest : rest.slice(0, rest.lastIndexOf("."));
  ok(E.isKnownType(id) && (id === rest || (L.VARIANTS[id] || []).includes(rest.slice(id.length + 1))), `stray sentence key ${k}`);
}

// 3) dynamic families
const fam = (prefix, names) => { for (const n of names) for (const T of [EN, PL]) ok(`${prefix}.${n}` in T, `missing ${prefix}.${n}`); };
fam("IPL.Cat", [...E.HERO_CATEGORIES, ...E.BASE_CATEGORIES]);
fam("IPL.Key", [...L.ATTRS, ...L.VITALS, ...L.TRACKS, ...L.TEXTS, ...L.CARD_FIELDS]);
fam("IPL.ItemType", L.ITEM_TYPES); fam("IPL.Path", L.PATHS); fam("IPL.Level", L.LEVELS); fam("IPL.Status", L.STATUSES);
fam("IPL.Cause", L.CAUSES); fam("IPL.Src", L.SOURCES); fam("IPL.Mode", L.MODES); fam("IPL.Action", [...L.ACTIONS, "n"]);
for (const ty of Object.keys(E.ITEM_ICONS)) ok(`IPL.ItemType.${ty}` in EN, `item type icon without a name: ${ty}`);
for (const a of ["logEnabled", "logReadAccess", "logRetainEntries", "logPlayerNotes", "logCombat", "logRevealJournals"]) for (const p of ["Name", "Hint"]) fam("IPL.Settings." + a, [p]);
fam("IPL.Settings.logReadAccess", ["gm", "owners", "observers"]);
for (const c of ["noGM", "noPermission", "badInput", "disabled", "notFound"]) fam("IPL.UI.Err", [c]);
// the privacy note must be in the two settings that govern visibility, in both languages
for (const T of [EN, PL]) { for (const a of ["logEnabled", "logReadAccess"]) ok(/console|konsol/i.test(T[`IPL.Settings.${a}.Hint`]), `privacy note missing in ${a} hint`); }

// 4) literal keys used by the UI code
const used = new Set();
const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { if (f.isDirectory()) { walk(join(d, f.name)); continue; } if (!f.name.endsWith(".mjs") || ["lang.mjs", "check-lang.mjs", "check-log.mjs", "events.mjs"].includes(f.name)) continue; const src = readFileSync(join(d, f.name), "utf8"); for (const m of src.matchAll(/["'`](IPL\.[A-Za-z][\w.]*)["'`]/g)) used.add(m[1]); } };
walk(dir);
for (const k of used) if (!(k in EN || fEN.has(k)) && !/\.$/.test(k)) {
  // dynamic prefixes such as "IPL.Cat." never end a literal key, so only complete keys are checked
  fail(`used but not defined: ${k}`);
}
ok(used.size > 40, "the scan found the UI keys");

// 5) a sample of every type renders a full sentence
const sample = (id) => {
  const def = E.typeDef(id), d = {};
  const val = { key: "fighting", from: 1, to: 3, name: "Sample", type: "power", id: "abc", on: true, text: "Hello", amount: 2, msgId: "m1", mode: "public", s: 2, b: 1, p: 1, dice: [6, 1, 3], round: 2, turn: 0, rounds: 3, status: "fastAction", combatId: "c", runId: "r", baseId: "b", fields: ["x"], user: "u1", n: 4, kids: [{ k: "stat.attr", d: { key: "agility", from: 1, to: 2 } }], by: "u1", removed: 5, first: 1, last: 2, changes: [{ p: "name", from: "a", to: "b" }], baseline: true, eid: "e1", roll: 35, band: "x", label: "Week 1", table: "kind", result: "Lab", field: "motto", cost: 3, kind: "normal", qty: 2, cid: "c1", vid: "v1", members: ["A"], cause: "damage", count: 1, to2: 1 };
  for (const r of def.req) d[r] = r in val ? val[r] : "x";
  if (id === "access.owner" || id === "access.default") { d.from = "NONE"; d.to = "OWNER"; }
  if (id === "upgrade.status") { d.from = "active"; d.to = "broken"; }
  if (id === "crate.give") d.to = { id: "h", name: "Rex" };
  if (id === "sync.adopt") d.from = { id: "h", name: "Rex" };
  if (id === "chargen.apply") { d.add = [{ t: "power", n: "Flight" }]; d.del = []; d.more = { add: 0, del: 0 }; d.rank = "Rank 2"; }
  return { id: "000000000abc", t: 1700000000000, u: "u1", k: id, d };
};
const ctx = { scope: "hero", userName: (u) => (u === "u1" ? "Ann" : u), actor: () => null, notesOn: new Map(), isGM: true };
const oldGame = globalThis.game;
for (const lang of ["en", "pl"]) {
  globalThis.game = { i18n: { lang } };
  for (const id of E.TYPE_IDS) {
    for (const variant of [null, ...(L.VARIANTS[id] || [])]) {
      const e = sample(id);
      if (variant === "up") { e.d.from = 1; e.d.to = 3; } if (variant === "down") { e.d.from = 3; e.d.to = 1; }
      if (variant === "bio") e.d = { key: "biography", len: [1, 5], to: "x" };
      if (variant === "token") e.d.what = "token"; if (variant === "portrait") e.d.what = "portrait";
      if (variant === "on") e.d.on = true; if (variant === "off") e.d.on = false;
      if (variant === "att") e.d.attacker = { name: "Brute" };
      if (variant === "dup") e.d.dupOf = { id: "z", name: "Orig" };
      if (variant === "named") e.d.name = e.d.name || "Raid on the docks";
      const text = sentenceText(e, ctx);
      ok(!/\{\w+\}/.test(text), `[${lang}] leftover token in ${id}${variant ? "." + variant : ""}: ${text}`);
      ok(text.length > 3, `[${lang}] empty sentence for ${id}`);
      if (variant) ok(variantOf(e) === variant || variant === "portrait" || variant === "off" || variant === "on", `variantOf ${id} gave ${variantOf(e)} not ${variant}`);
    }
  }
}
globalThis.game = oldGame;
// tn: plural forms
globalThis.game = { i18n: { lang: "pl" } };
ok(L.tn("IPL.Plural.Entries", 1) === "1 wpis" && L.tn("IPL.Plural.Entries", 3) === "3 wpisy" && L.tn("IPL.Plural.Entries", 5) === "5 wpisów" && L.tn("IPL.Plural.Entries", 12) === "12 wpisów" && L.tn("IPL.Plural.Entries", 22) === "22 wpisy" && L.tn("IPL.Plural.Entries", 0) === "0 wpisów", "PL plural rules");
globalThis.game = { i18n: { lang: "en" } };
ok(L.tn("IPL.Plural.Entries", 1) === "1 entry" && L.tn("IPL.Plural.Entries", 0) === "0 entries" && L.tn("IPL.Plural.Entries", 2) === "2 entries", "EN plural rules");
globalThis.game = oldGame;

console.log(bad ? `check-lang: ${bad} FAILED of ${checks}` : `check-lang OK: ${checks} checks, ${Object.keys(EN).length} EN keys, ${Object.keys(PL).length} PL keys`);
process.exit(bad ? 1 : 0);
