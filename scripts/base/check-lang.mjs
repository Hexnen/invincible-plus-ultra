/* Key parity check for the team & base card: node scripts/base/check-lang.mjs
   1) EN and PL define exactly the same keys, with the same {placeholders}. 2) Every IPB.* key written as a literal anywhere in scripts/base is
   defined in both languages. 3) Derived keys (BaseError codes, collection "Full" errors, settings) exist. 4) Every validation key pure.validate()
   can return has a string. */
import { EN, PL } from "./lang.mjs";
import * as P from "./pure.mjs";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const dir = dirname(fileURLToPath(import.meta.url));
let bad = 0;
const fail = (m) => { bad++; console.log("FAIL", m); };
// plural families: EN needs .one + .other, PL needs .one + .few + .many (tn() in lang.mjs picks the form); every other key must exist in both
const PLURAL = /\.(one|few|many|other)$/;
const base = (k) => k.replace(PLURAL, "");
const forms = (T) => { const m = new Map(); for (const k of Object.keys(T)) if (PLURAL.test(k)) { if (!m.has(base(k))) m.set(base(k), new Set()); m.get(base(k)).add(k.match(PLURAL)[1]); } return m; };
const fEN = forms(EN), fPL = forms(PL);
for (const [b, s] of fEN) if (!(s.has("one") && s.has("other"))) fail(`EN plural ${b} needs .one and .other`);
for (const [b, s] of fPL) if (!(s.has("one") && s.has("few") && s.has("many"))) fail(`PL plural ${b} needs .one, .few and .many`);
for (const b of fEN.keys()) if (!fPL.has(b)) fail(`plural ${b} missing in PL`);
for (const b of fPL.keys()) if (!fEN.has(b)) fail(`plural ${b} missing in EN`);
const plain = (T) => Object.keys(T).filter((k) => !PLURAL.test(k));
for (const k of plain(EN)) if (!(k in PL)) fail(`in EN, missing in PL: ${k}`);
for (const k of plain(PL)) if (!(k in EN)) fail(`in PL, missing in EN: ${k}`);
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
for (const k of plain(EN)) if (k in PL && ph(EN[k]) !== ph(PL[k])) fail(`placeholders differ: ${k} (${ph(EN[k])} vs ${ph(PL[k])})`);
for (const b of fEN.keys()) { const a = ph(EN[`${b}.one`]); for (const T of [EN, PL]) for (const k of Object.keys(T)) if (base(k) === b && PLURAL.test(k) && ph(T[k]) !== a) fail(`plural placeholders differ: ${k}`); }
const used = new Set();
const files = [...readdirSync(dir).filter((x) => x.endsWith(".mjs") && !["lang.mjs", "check-lang.mjs", "check-base.mjs"].includes(x)),
  ...(existsSync(join(dir, "tabs")) ? readdirSync(join(dir, "tabs")).filter((x) => x.endsWith(".mjs")).map((x) => `tabs/${x}`) : [])];
for (const f of files) {
  const src = readFileSync(join(dir, f), "utf8");
  for (const m of src.matchAll(/["'`](IPB\.[A-Za-z][\w.]*)["'`]/g)) used.add(m[1]);
}
for (const k of used) if (!((k in EN && k in PL) || (fEN.has(k) && fPL.has(k)))) fail(`used but not defined in both languages: ${k}`);
const need = [];
for (const c of ["noBook", "noPermission", "tooBig", "noGM", "notFound", "invalid", "prerequisite", "stackMax", "full", "badInput", "blocked", "karma", "badType", "relay"]) need.push(`IPB.Err.${c}`);
for (const c of P.COLLECTIONS) need.push(`IPB.Err.${c}Full`);
for (const n of ["HeaderButton", "PlayersCreate"]) for (const p of ["Name", "Hint"]) need.push(`IPB.Settings.${n}.${p}`);
for (const s of ["same", "push", "conflict", "kept"]) need.push(`IPB.Bt.State.${s}`);                  // Base tab: dynamic key IPB.Bt.State.<state>
for (const f of ["Description", "Purpose", "Background"]) for (const s of ["", "Hint", "Ph"]) need.push(`IPB.Bt.${f}${s}`);   // Base tab: IPB.Bt.<Field>[Hint|Ph]
for (const r of P.RANKS) need.push(`IPB.Rank.${r}`);
// phase B6 (Upgrades tab): dynamic keys IPB.Status.<status|lost>, IPB.Up.Src.<source>, IPB.Up.State.<state>, IPB.Karma.Kind.<kind>, plurals
for (const s of [...P.STATUSES, "lost"]) need.push(`IPB.Status.${s}`);
for (const s of P.SOURCES) need.push(`IPB.Up.Src.${s}`);
for (const s of ["met", "tooPricey", "blocked", "unknown", "maxed"]) need.push(`IPB.Up.State.${s}`);
for (const s of ["normal", "tooPricey", "unknown"]) need.push(`IPB.Karma.Kind.${s}`);
for (const b of ["IPB.Up.AllowLead", "IPB.Up.AdoptLead", "IPB.Up.AdoptYes", "IPB.Up.AdoptDone"]) if (!fEN.has(b) || !fPL.has(b)) fail(`B6 plural family missing: ${b}`);
// phase B7 (Events tab): dynamic keys IPB.Ev.Band.<low>, IPB.Ev.State.<state>, IPB.Ev.Mode*.<mode>, IPB.Ev.LabelPh.<mode>, IPB.Ev.Prop.<low|text>, IPB.Ev.Diff.<...>
for (const b of Object.keys(P.BAND_CONFIG.bands)) { need.push(`IPB.Ev.Band.${parseInt(b, 10)}`); if (["note", "disable", "break", "raid", "aiControl", "occupy"].includes(P.BAND_CONFIG.bands[b].effect)) need.push(`IPB.Ev.Prop.${parseInt(b, 10)}`); }
for (const s of ["none", "pending", "applied", "dismissed", "rerolled"]) need.push(`IPB.Ev.State.${s}`);
for (const m of ["week", "any"]) need.push(`IPB.Ev.Mode.${m}`, `IPB.Ev.ModeHint.${m}`, `IPB.Ev.LabelPh.${m}`);
for (const k of ["disable", "break", "lost", "lostNone", "occupy", "already", "nothing", "skip.gone", "skip.notActive", "skip.alreadyBroken"]) need.push(`IPB.Ev.Diff.${k}`);
need.push("IPB.Ev.Prop.text", "IPB.Ev.Hint.46");
if (!fEN.has("IPB.Ev.More") || !fPL.has("IPB.Ev.More")) fail("B7 plural family missing: IPB.Ev.More");
for (const k of need) if (!(k in EN) || !(k in PL)) fail(`required key missing: ${k}`);
// every validation message key pure.mjs can emit
const probes = [null, { v: 99, rank: "x", policy: { edit: "x" }, upgrades: { a: 5, b: { status: "x", count: 0, source: "x" } }, events: { e: { roll: 12, band: "99-99" } }, vehicles: { a: { primary: true }, b: { primary: true } }, trackers: { t: { value: 5, max: 1 } } }];
for (const c of P.COLLECTIONS) probes.push({ rank: "global", [c]: Object.fromEntries(Array.from({ length: P.LIMITS[c] + 1 }, (_x, i) => [`i${i}`, {}])) });
probes.push({ rank: "global", upgrades: Object.fromEntries(Array.from({ length: 5 }, (_x, i) => [`s${i}`, { source: "start", count: 1 }])) });
probes.push({ rank: "global", crate: { a: { name: "x".repeat(P.LIMITS.bytes) } } });
for (const p of probes) for (const i of P.validate(p)) { if (!(i.key in EN) || !(i.key in PL)) fail(`validate key without string: ${i.key}`); }
// evalPrerequisite / planKarma messages
const pre = P.parsePrerequisite("Resources 5 or Technician, Laboratory", ["Laboratory"]);
for (const ctx of [{ members: [{ name: "A", resources: 9, occupation: "Technician" }], owned: [{ key: "laboratory", status: "disabled" }] }, { members: [], owned: [] }, { members: [], owned: [{ key: "laboratory", status: "active" }] }]) for (const r of P.evalPrerequisite(pre, ctx).reasons) if (!(r.key in EN) || !(r.key in PL)) fail(`eval key without string: ${r.key}`);
for (const r of P.evalPrerequisite(P.parsePrerequisite("???;", []), {}).reasons) if (!(r.key in EN)) fail(`eval key without string: ${r.key}`);
for (const r of P.validateSplit([{ actorId: "z", amount: -1 }, { actorId: "a", amount: 99 }], [{ id: "a", karma: 1 }], 5).errors) if (!(r.key in EN) || !(r.key in PL)) fail(`karma key without string: ${r.key}`);
if (P.checkStack({ max: 1 }, [{ count: 1 }]).reason && !(P.checkStack({ max: 1 }, [{ count: 1 }]).reason.key in EN)) fail("stack key");
console.log(bad ? `${bad} problem(s)` : `OK: ${Object.keys(EN).length} keys, ${used.size} used as literals, EN = PL`);
process.exit(bad ? 1 : 0);
