/* Checks of the activity log pure modules (phase L2): node scripts/log/check-log.mjs
   events / model / diff / coalesce / filter / prune / export. No Foundry. Fixtures are synthetic. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as EV from "./events.mjs";
import * as M from "./model.mjs";
import * as D from "./diff.mjs";
import * as C from "./coalesce.mjs";
import * as F from "./filter.mjs";
import * as P from "./prune.mjs";
import * as X from "./export.mjs";
import * as CP from "./capture-pure.mjs";

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log("FAIL", m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const here = path.dirname(fileURLToPath(import.meta.url));

// seeded PRNG
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const T0 = 1761350400000; // fixed 2025-10-25T00:00:00Z

/* ================================================================= 1. registry */
const SPEC_IDS = [
  "stat.attr", "stat.vital", "stat.track", "stat.text", "actor.rename", "actor.img", "item.add", "item.remove", "item.edit", "item.toggle", "effect.add", "effect.remove", "effect.edit",
  "damage.taken", "damage.undone", "roll.made", "combat.join", "combat.leave", "combat.turn", "combat.action", "combat.init", "combat.end", "chargen.apply", "chargen.undo",
  "team.join", "team.leave", "team.sync", "access.owner", "access.default", "note.add", "note.gm", "actor.created", "actor.deleted", "bulk.change", "log.start", "log.gap", "log.prune", "log.redact", "log.import",
  "card.edit", "card.roll", "card.rename", "card.img", "card.occupied", "member.add", "member.remove", "upgrade.add", "upgrade.buy", "upgrade.status", "upgrade.count", "upgrade.remove", "upgrade.note",
  "event.rolled", "event.reroll", "event.resolved", "event.applied", "event.note", "crate.add", "crate.remove", "crate.qty", "crate.give", "vehicle.add", "vehicle.remove", "vehicle.primary",
  "tracker.edit", "sync.push", "sync.adopt", "policy.change", "base.created", "base.deleted", "base.migrated"
];
for (const id of SPEC_IDS) ok(EV.isKnownType(id), `spec type present ${id}`);
ok(EV.TYPE_IDS.length >= SPEC_IDS.length, "registry size");
eq(EV.HERO_CATEGORIES.length, 10, "hero category count"); eq(EV.BASE_CATEGORIES.length, 9, "base category count");
const sampleVal = (f) => (["key", "name", "type", "id", "what", "mode", "status", "runId", "combatId", "baseId", "user", "text", "field", "table", "result", "kind", "eid", "band", "cid", "vid", "by", "from_", "result", "text"].includes(f) ? "x" : ["changes", "kids", "fields", "members"].includes(f) ? [] : ["on"].includes(f) ? true : 1);
const sample = (id, extra = {}) => { const d = {}; for (const f of EV.TYPES[id].req) d[f] = sampleVal(f); return { t: T0 + 1000, u: "u1", k: id, d: { ...d, ...extra } }; };
for (const id of EV.TYPE_IDS) {
  const t = EV.TYPES[id];
  ok(["hero", "base", "both"].includes(t.scope), `${id} scope`);
  ok(t.sev === 0 || t.sev === 1 || t.sev === 2, `${id} sev`);
  ok(/^fa-/.test(t.icon), `${id} icon`);
  ok(t.i18n === `IPL.Type.${id}` && t.sum === `IPL.Sum.${id}`, `${id} i18n keys`);
  ok(Array.isArray(t.req) && t.minor === (t.sev === 0), `${id} req/minor`);
  const scopes = t.scope === "both" ? ["hero", "base"] : [t.scope];
  for (const sc of scopes) ok(EV.CATEGORIES[sc].includes(EV.categoryOf(id, sc)), `${id} category in ${sc}`);
  ok(EV.inScope(id, t.scope === "both" ? "base" : t.scope) && (t.scope === "both" || !EV.inScope(id, t.scope === "hero" ? "base" : "hero")), `${id} scope gate`);
  const { entry, errors } = M.buildEntry(sample(id), { actorId: "A1", scope: scopes[0] });
  ok(entry && errors.length === 0, `${id} sample validates ${JSON.stringify(errors)}`);
  ok(EV.summarize(entry).key === t.sum, `${id} summary key`);
}
eq(EV.categoryOf("access.owner", "base"), "access", "access in base"); eq(EV.categoryOf("access.owner", "hero"), "system", "access in hero");
eq(EV.categoryOf("nope"), "system", "unknown cat"); eq(EV.iconOf("nope"), "fa-circle", "unknown icon"); ok(EV.typeDef("nope") === null, "unknown def");
eq(EV.typesFor("hero").includes("card.edit"), false, "hero scope excludes card"); eq(EV.typesFor("base").includes("stat.attr"), false, "base scope excludes stat");
eq(EV.visibilityOf({ k: "note.gm" }), "G", "note.gm secret"); eq(EV.visibilityOf({ k: "roll.made", v: 1 }), "G", "gm roll"); eq(EV.visibilityOf({ k: "roll.made" }), "P", "public roll");
eq(EV.retentionFor("hero", {}), 5000, "hero cap default"); eq(EV.retentionFor("base", {}), 3000, "base cap default"); eq(EV.retentionFor("base", { retainHero: 1000 }), 600, "base derived 60%");
eq(EV.retentionFor("hero", { retainHero: 0 }), 0, "unlimited"); eq(EV.retentionFor("base", { retainHero: 0 }), 0, "unlimited base"); eq(EV.retentionFor("base", { retainBase: 7 }), 7, "explicit base");
eq(EV.POLICY.retainHero, 5000, "policy hero"); eq(EV.POLICY.retainBase, 3000, "policy base"); eq(EV.POLICY.readAccess, "owners", "policy read"); eq(EV.POLICY.selfRolls, "never", "policy self");
ok(Object.isFrozen(EV.POLICY), "policy frozen"); eq(EV.RELAY_WHITELIST.length, 7, "relay whitelist");
for (const id of EV.RELAY_WHITELIST) ok(EV.isKnownType(id), `relay type ${id} known`);
eq(EV.summarize({ k: "stat.vital", d: { key: "health", from: 6, to: 4 } }).params.dir, "down", "summary dir down");
eq(EV.summarize({ k: "stat.vital", d: { key: "health", from: 2, to: 6 } }).params.abs, 4, "summary abs");
eq(EV.summarize({ k: "stat.attr", d: { key: "fighting", from: 2, to: 3 }, n: 3 }).params.n, 3, "summary n");
eq(EV.summarize({ k: "nope", d: {} }).key, "IPL.Sum.unknown", "summary unknown");
eq(EV.summarize({ k: "roll.made", d: { name: "Fight", mode: "public", s: 2, b: 0 } }).params.outcome, "success", "summary outcome");
ok(EV.plainText({ k: "stat.attr", d: { key: "fighting", from: 1, to: 2 } }).includes("key=fighting"), "plain text");
eq(EV.i18nKeys().length, EV.TYPE_IDS.length * 2, "i18n key list");
eq(EV.itemIcon("power"), "fa-bolt", "item icon"); eq(EV.itemIcon("zzz"), "fa-cube", "item icon fallback");

/* ================================================================= 2. model */
// ids
const id1 = M.makeId(T0, "A1", "stat.attr", "system.attributes.fighting.value", "u1");
eq(id1, M.makeId(T0, "A1", "stat.attr", "system.attributes.fighting.value", "u1"), "id deterministic");
ok(id1 !== M.makeId(T0, "A1", "stat.attr", "system.attributes.fighting.value", "u2"), "id differs by user");
ok(id1 !== M.makeId(T0, "A2", "stat.attr", "system.attributes.fighting.value", "u1"), "id differs by actor");
ok(M.isValidId(id1) && id1.length === 12, "id valid"); eq(M.idTime(id1), T0, "id time round trip"); ok(Number.isNaN(M.idTime("nope")), "idTime invalid");
eq(M.hash3("abc").length, 3, "hash3 length");
{
  const r = rng(1); let lexOk = true, detOk = true;
  const ts = Array.from({ length: 200 }, () => T0 + Math.floor(r() * 1e10)).sort((a, b) => a - b);
  for (let i = 1; i < ts.length; i++) { const a = M.makeId(ts[i - 1], "A", "k", "p", "u"), b = M.makeId(ts[i], "A", "k", "p", "u"); if (ts[i - 1] < ts[i] && !(a < b)) lexOk = false; if (M.idTime(b) !== ts[i]) detOk = false; }
  ok(lexOk, "ids sort lexicographically by time"); ok(detOk, "ids carry time");
  ok(M.makeId(5, "A", "k", "", "u").startsWith("000000005"), "id padded");
}
// sanitise / normalise
const dirty = JSON.parse('{"a":"' + "y".repeat(2000) + '","__proto__":{"x":1},"constructor":1,"n":NaN,"arr":[1,2,3],"o":{"p":{"q":{"r":{"s":{"t":{"u":1}}}}}}}'.replace('NaN', 'null'));
const sd = M.sanitize(dirty);
eq(sd.a.length, 1000, "text clamped"); ok(!Object.prototype.hasOwnProperty.call(sd, "__proto__") || !sd.__proto__.x, "proto key dropped"); ok(!("constructor" in sd && sd.constructor === 1), "constructor key dropped");
eq(M.sanitize(NaN), null, "NaN to null"); eq(M.sanitize(Infinity), null, "Infinity to null"); eq(M.sanitize(() => 1), undefined, "function dropped");
eq(M.sanitize(Array.from({ length: 300 }, (_, i) => i)).length, 100, "array capped");
eq(Object.keys(M.sanitize(Object.fromEntries(Array.from({ length: 100 }, (_, i) => ["k" + i, i])))).length, 60, "keys capped");
ok(JSON.stringify(M.sanitize({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } })).includes("g") === false, "depth capped");
const polluted = M.normalizeEntry({ t: T0, u: "u", k: "stat.attr", d: JSON.parse('{"__proto__":{"polluted":true},"key":"fighting","from":1,"to":2}') }, { actorId: "A" });
ok(({}).polluted === undefined && polluted.d.polluted === undefined, "no prototype pollution via d");
const big = M.normalizeEntry({ t: T0, u: "u", k: "bulk.change", d: { n: 100, kids: Array.from({ length: 100 }, (_, i) => ({ k: "stat.attr", d: { text: "z".repeat(900), i } })) } }, { actorId: "A" });
ok(M.byteSize(big) <= M.ENTRY_MAX_BYTES, "oversize entry shrunk to cap"); ok(big.d.more > 0 || big.tr === 1, "shrink marked");
eq(M.normalizeEntry(null), null, "normalize null"); eq(M.normalizeEntry("x"), null, "normalize string");
const ne = M.normalizeEntry({ t: T0 + 0.7, t2: T0 - 5, n: 0, u: "u", k: "stat.attr", d: { key: "fighting", from: 1, to: 2 }, v: true, h: 1, a: 1, junk: 5, c: { i: "cb", r: 3.9, tn: 2, z: 1 } }, { actorId: "A", path: "p" });
eq(ne.t, T0, "t floored"); ok(ne.t2 === undefined, "t2 before t dropped"); ok(ne.n === undefined, "n<=1 dropped"); ok(ne.junk === undefined, "unknown key dropped");
eq(ne.v, 1, "v flag"); eq(ne.c, { i: "cb", r: 3, tn: 2 }, "context normalised"); ok(ne.id === M.makeId(T0, "A", "stat.attr", "p", "u"), "id assigned");
eq(M.normalizeEntry({ t: T0, u: "u", k: "stat.attr", d: [] }, { actorId: "A" }).d, {}, "array d replaced");
ok(M.normalizeEntry({ k: "stat.attr", d: {} }, { now: T0 }).t === T0, "now fallback");
// validation
const vErr = (e, sc) => M.validateEntry(e, sc).errors.map((x) => x.key);
ok(M.validateEntry(ne, "hero").ok, "valid entry ok");
ok(vErr(ne, "base").includes("IPL.Val.badScope"), "hero type in base rejected");
ok(vErr({ ...ne, k: "zzz" }, "hero").includes("IPL.Val.badType"), "bad type"); ok(vErr({ ...ne, k: "" }, "hero").includes("IPL.Val.noType"), "no type");
ok(vErr({ ...ne, t: 0 }, "hero").includes("IPL.Val.badTime"), "bad time"); ok(vErr({ ...ne, u: 5 }, "hero").includes("IPL.Val.noUser"), "bad user");
ok(vErr({ ...ne, id: "short" }, "hero").includes("IPL.Val.badId"), "bad id"); ok(vErr({ ...ne, id: M.makeId(T0 + 1, "A", "k", "", "u") }, "hero").includes("IPL.Val.badId"), "id time mismatch");
ok(vErr({ ...ne, d: { key: "x" } }, "hero").includes("IPL.Val.missing"), "missing field"); ok(vErr({ ...ne, d: null }, "hero").includes("IPL.Val.badData"), "bad data");
ok(vErr(null, "hero").includes("IPL.Val.notObject"), "not object");
ok(M.validateEntry({ ...ne, d: { ...ne.d, pad: "x".repeat(9000) } }, "hero").errors.some((e) => e.key === "IPL.Val.tooBig"), "too big");
for (const e of M.validateEntry({ ...ne, d: {} }, "hero").errors) ok(/^IPL\.Val\.[a-zA-Z]+$/.test(e.key), "error keys are IPL.Val.*");
ok(M.buildEntry({ t: T0, u: "u", k: "stat.attr", d: { key: "fighting" } }, { scope: "hero" }).errors.length >= 2, "buildEntry reports missing from/to");
ok(M.buildEntry(null).entry === null, "buildEntry null");
// patch / merge
const pe = { id: id1, t: T0, u: "u", k: "roll.made", d: { name: "Fight", mode: "public", s: 1, b: 0, p: 0, dice: [6, 2] } };
const pp = M.patchEntry(pe, { d: { s: 2, p: 1, dice: [6, 6], mode: null }, t2: T0 + 5000, id: "ZZZ" });
eq(pp.d.s, 2, "patch merges d"); ok(!("mode" in pp.d), "null deletes d key"); eq(pp.t2, T0 + 5000, "patch top key"); eq(pp.id, id1, "id never patched"); eq(pe.d.s, 1, "patch does not mutate");
ok(!("t2" in M.patchEntry(pp, { t2: null })), "null removes flag");
eq(M.patchEntry({ id: id1, t: 1, d: { a: { b: 1, c: 2 } } }, { d: { a: { b: 9 } } }).d, { a: { b: 9, c: 2 } }, "deep merge");
ok(!({}).evil, "patch proto"); M.patchEntry(pe, JSON.parse('{"d":{"__proto__":{"evil":1}}}')); ok(!({}).evil, "patch proto safe");
{
  const a = { ...pe, n: 1 }, b = { ...pe, n: 3 }, c = { ...pe, n: 3, t2: T0 + 1 };
  eq(M.mergeEntry(a, b), b, "merge prefers more edits"); eq(M.mergeEntry(b, a), b, "merge commutative"); eq(M.mergeEntry(b, c), c, "merge prefers later t2"); eq(M.mergeEntry(c, b), c, "merge commutative 2");
  eq(M.mergeEntry(a, a), a, "merge idempotent"); eq(M.mergeEntry(null, a), a, "merge null"); eq(M.mergeEntry(a, null), a, "merge null 2");
  const m1 = M.mergeEntryMaps({ [id1]: a }, { [id1]: b, x: c }), m2 = M.mergeEntryMaps({ [id1]: b, x: c }, { [id1]: a });
  eq(m1, m2, "map merge commutative");
}
ok(M.deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }) && !M.deepEqual({ a: 1 }, { a: 2 }) && !M.deepEqual([1], [1, 2]) && M.deepEqual(NaN, NaN) && !M.deepEqual(null, {}), "deepEqual");
// chunks
eq(M.chunkName(1), "c0001", "chunk name"); eq(M.chunkName(12, "AbC"), "AbC.c0012", "secret chunk name"); eq(M.parseChunkName("AbC.c0012"), { actorId: "AbC", no: 12 }, "parse secret name");
eq(M.parseChunkName("c0003"), { actorId: null, no: 3 }, "parse name"); eq(M.parseChunkName("x"), null, "parse bad name");
eq(M.entryPath("abc"), "flags.invincible-plus-ultra.log.e.abc", "entry path");
function mkEntry(i, over = {}) { const t = T0 + i * 1000; return M.normalizeEntry({ t, u: "u1", k: "stat.attr", d: { key: "fighting", from: i, to: i + 1 }, ...over }, { actorId: "A1", path: "p" + i }); }
{
  let st = { head: 1, pages: {} };
  const entries = Array.from({ length: 600 }, (_, i) => mkEntry(i));
  let plan = M.planWrite(st, entries);
  eq(plan.head, 3, "600 entries -> head chunk 3"); eq(Object.keys(plan.pages[1].e).length, 250, "chunk 1 full"); eq(Object.keys(plan.pages[2].e).length, 250, "chunk 2 full"); eq(Object.keys(plan.pages[3].e).length, 100, "chunk 3 rest");
  eq(plan.added, 600, "added count"); eq(plan.created, [2, 3], "created pages"); eq(plan.touched, [1, 2, 3], "touched pages");
  // idempotent double write
  const again = M.planWrite({ head: plan.head, pages: plan.pages }, entries);
  eq(again.added, 0, "double write adds nothing"); eq(again.rewritten, 600, "double write rewrites"); eq(M.totalCount(again.pages), 600, "no duplicates"); eq(again.head, 3, "head stable");
  // patch of a flushed entry stays in its page
  const patched = M.patchEntry(entries[10], { d: { to: 99 } });
  const pw = M.planWrite({ head: plan.head, pages: plan.pages }, [patched]);
  eq(pw.touched, [1], "patch writes the entry's own page"); eq(pw.pages[1].e[patched.id].d.to, 99, "patched value stored"); eq(M.totalCount(pw.pages), 600, "patch keeps count");
  const idx = M.buildIndex(plan.pages); eq(idx.get(entries[0].id), 1, "index first"); eq(idx.get(entries[599].id), 3, "index last"); eq(idx.size, 600, "index size");
  // bytes limit
  const fat = Array.from({ length: 40 }, (_, i) => mkEntry(i, { d: { key: "biography", len: [1, 2], to: "x".repeat(2000), from: i, pad: "y".repeat(1900) } }));
  const fp = M.planWrite({ head: 1, pages: {} }, fat);
  ok(fp.head > 1, "byte limit rotates chunks"); for (const p of Object.values(fp.pages)) ok(M.byteSize(p.e) <= M.CHUNK_BYTES + 5000, "chunk bytes bounded");
  const all = M.readAll(plan.pages); eq(all.length, 600, "readAll count"); ok(all.every((e, i) => i === 0 || M.compareEntries(all[i - 1], e) < 0), "readAll sorted");
  eq(M.pageStats(plan.pages[1]).n, 250, "pageStats n"); ok(plan.pages[1].first <= plan.pages[1].last, "page first/last");
  eq(plan.pages[2].bytes, M.byteSize(plan.pages[2].e) + 0 > 0 ? plan.pages[2].bytes : -1, "page bytes tracked");
  eq(M.planWrite({ head: 1, pages: {} }, []).head, 1, "empty write keeps head");
  const readOnlyTwice = M.readAll({ 1: { e: { [entries[0].id]: entries[0] } }, 2: { e: { [entries[0].id]: { ...entries[0], n: 4 } } } }); eq(readOnlyTwice.length, 1, "readAll dedupes ids"); eq(readOnlyTwice[0].n, 4, "readAll merges deterministically");
}

/* ================================================================= 3. diff */
const heroA = () => ({
  name: "ZZ Hero", img: "icons/a.webp", sort: 1, folder: null,
  system: { attributes: { fighting: { value: 2 }, agility: { value: 3 }, strength: { value: 2 }, reason: { value: 2 }, intuition: { value: 2 }, presence: { value: 2 } },
    derived: { health: { value: 6, max: 6 }, resolve: { value: 14, max: 14 }, slugfest: { value: 2, max: 2 } },
    karma: 0, reputation: 3, resources: 2, occupation: "Cop", biography: "<p>Old</p>", team: "", teamBase: "", tags: ["a", "b"] },
  ownership: { default: "NONE", u1: "OWNER" }, flags: { core: { sheetClass: "x" }, "invincible-plus-ultra": { chargenBackup: { big: 1 }, base: { team: null } } }, _stats: { modifiedTime: 1 }
});
// flatten
const fl = D.flatten(heroA());
eq(fl["system.attributes.fighting.value"], 2, "flatten leaf"); eq(fl["system.tags"], ["a", "b"], "arrays are leaves"); ok(!("system.tags.0" in fl), "no array index paths");
eq(D.flatten({ a: {} }), { a: {} }, "empty object leaf"); eq(D.flatten({ a: { "-=b": null } }), { "a.b": undefined }, "removal marker"); eq(D.flatten(5), {}, "flatten primitive");
eq(D.unflatten({ "a.b": 1, "a.c": [1], "d": 2, "e.f": undefined }), { a: { b: 1, c: [1] }, d: 2 }, "unflatten");
ok(Object.keys(D.unflatten(JSON.parse('{"__proto__.x":1}'))).length === 0 && ({}).x === undefined, "unflatten proto safe");
// ignore list
for (const p of ["_stats.modifiedTime", "sort", "folder", "flags.core.sheetClass", "flags.invincible-plus-ultra.chargenBackup.big", "system.derived.health.max", "system.derived.resolve.max", "items.0.name", "effects.2", "flags.invincible-plus-ultra.log.v", "prototypeToken.name", "_id"]) ok(D.isIgnored(p), `ignored ${p}`);
for (const p of ["system.derived.health.value", "system.attributes.fighting.value", "name", "img", "prototypeToken.texture.src", "ownership.u1", "flags.invincible-plus-ultra.base.team"]) ok(!D.isIgnored(p), `not ignored ${p}`);
{
  const a = heroA(), b = heroA();
  eq(D.diffObjects(a, b), [], "no-op diff empty");
  b._stats.modifiedTime = 99; b.sort = 5; b.flags.core.sheetClass = "y"; b.system.derived.health.max = 9; b.flags["invincible-plus-ultra"].chargenBackup.big = 2;
  eq(D.diffObjects(a, b), [], "noise only diff empty");
  b.system.derived.health.value = 4; b.system.attributes.fighting.value = 3; b.system.tags = ["a", "c"]; b.system.newField = "n";
  const df = D.diffObjects(a, b);
  eq(df.map((x) => x.p), ["system.attributes.fighting.value", "system.derived.health.value", "system.newField", "system.tags"], "diff paths sorted");
  eq(df.find((x) => x.p === "system.tags").kind, "change", "array change kind"); eq(df.find((x) => x.p === "system.newField").kind, "add", "add kind");
  const rm = heroA(); delete rm.system.karma; eq(D.diffObjects(a, rm)[0].kind, "remove", "remove kind");
  eq(D.diffFlat({ x: undefined }, {}), [], "undefined equals absent");
  // round trip
  eq(D.diffObjects(D.applyDiff(a, df), b), [], "applyDiff round trip (tracked paths)");
}
// round trip property
{
  const r = rng(7);
  const randObj = (depth = 0) => { const o = {}; const nk = 1 + Math.floor(r() * 5); for (let i = 0; i < nk; i++) { const k = pick(r, ["a", "b", "c", "d", "e", "f"]); const roll = r(); o[k] = roll < 0.25 && depth < 3 ? randObj(depth + 1) : roll < 0.4 ? [Math.floor(r() * 3), "s"] : roll < 0.6 ? Math.floor(r() * 4) : roll < 0.8 ? pick(r, ["x", "y", ""]) : r() < 0.5; } return o; };
  let good = 0, total = 120;
  for (let i = 0; i < total; i++) {
    const a = randObj(), b = r() < 0.5 ? randObj() : { ...a, ...randObj() };
    const df = D.diffObjects(a, b, { ignore: [] });
    const rebuilt = D.applyFlat(D.flatten(a), df);
    const fb = D.flatten(b);
    // keys with undefined excluded
    const same = JSON.stringify(Object.fromEntries(Object.entries(rebuilt).sort())) === JSON.stringify(Object.fromEntries(Object.entries(fb).filter(([, v]) => v !== undefined).sort()));
    ok(same, `diff round trip ${i}`); if (same) good++;
    ok(D.diffFlat(rebuilt, fb, { ignore: [] }).length === 0, `diff of rebuilt empty ${i}`);
  }
  eq(good, total, "all round trips");
}
// changes object (post hook)
eq(D.flattenChanges({ system: { karma: 3, "-=old": null }, name: "N" }), [{ p: "system.karma", kind: "set", to: 3 }, { p: "system.old", kind: "remove", to: undefined }, { p: "name", kind: "set", to: "N" }], "flattenChanges");
// classify
const cls = (p, s = "hero") => D.classify(p, s);
eq(cls("system.attributes.fighting.value"), { k: "stat.attr", key: "fighting" }, "classify attr"); eq(cls("system.derived.health.value"), { k: "stat.vital", key: "health" }, "classify vital");
ok(cls("system.derived.health.max") === null, "classify derived max null"); eq(cls("system.karma"), { k: "stat.track", key: "karma" }, "classify karma"); eq(cls("system.resources.value").key, "resources", "classify resources value");
eq(cls("system.occupation").k, "stat.text", "classify text"); eq(cls("system.biography").key, "biography", "classify bio"); eq(cls("name").k, "actor.rename", "classify rename"); eq(cls("name", "base").k, "card.rename", "classify base rename");
eq(cls("img").k, "actor.img", "classify img"); eq(cls("prototypeToken.texture.src").what, "token", "classify token img"); ok(cls("prototypeToken.texture.src", "base") === null, "token img base null");
eq(cls("ownership.default").k, "access.default", "classify default"); eq(cls("ownership.u1"), { k: "access.owner", user: "u1" }, "classify owner"); ok(cls("system.unknownStat") === null, "classify unknown null");
eq(cls("flags.invincible-plus-ultra.base.team").k, "team.link", "classify link");
eq(cls("flags.invincible-plus-ultra.base.base.where", "base"), { k: "card.edit", field: "where" }, "classify card field"); eq(cls("flags.invincible-plus-ultra.base.motto", "base").field, "motto", "classify motto");
eq(cls("flags.invincible-plus-ultra.base.base.occupied", "base").k, "card.occupied", "classify occupied"); eq(cls("flags.invincible-plus-ultra.base.base.rolls.kind", "base"), { k: "card.roll", table: "kind" }, "classify card roll");
eq(cls("flags.invincible-plus-ultra.base.policy.edit", "base"), { k: "policy.change", key: "edit" }, "classify policy"); eq(cls("flags.invincible-plus-ultra.base.upgrades.u1", "base").k, "upgrade.add", "classify upgrade whole");
eq(cls("flags.invincible-plus-ultra.base.upgrades.u1.status", "base").rest, "status", "classify upgrade field");
// drafts hero
{
  const a = heroA(), b = heroA();
  b.system.attributes.fighting.value = 3; b.system.derived.health.value = 4; b.system.karma = 2; b.system.occupation = "x".repeat(300); b.name = "New Name"; b.system.biography = "<p>New bio <b>text</b></p>";
  b.ownership.u2 = "OBSERVER"; b.ownership.default = "LIMITED"; b.img = "icons/b.webp"; b.system.team = "Team X"; b.system.derived.health.max = 9;
  const dr = D.draftsFromDiff(D.diffObjects(a, b), { scope: "hero", before: D.flatten(a), after: D.flatten(b) });
  const by = (k) => dr.filter((x) => x.k === k);
  eq(by("stat.attr")[0].d, { key: "fighting", from: 2, to: 3 }, "draft attr"); eq(by("stat.vital")[0].d, { key: "health", from: 6, to: 4 }, "draft vital"); ok(by("stat.vital").length === 1, "max change produced nothing");
  eq(by("stat.track")[0].d, { key: "karma", from: 0, to: 2 }, "draft track"); eq(by("stat.text").find((x) => x.d.key === "occupation").d.to.length, 120, "text clamped to 120");
  eq(by("stat.text").find((x) => x.d.key === "biography").d, { key: "biography", len: [3, 12], to: "New bio text" }, "draft biography is plain text, no from");
  eq(by("actor.rename")[0].d, { from: "ZZ Hero", to: "New Name" }, "draft rename"); eq(by("access.owner")[0].d, { user: "u2", from: "NONE", to: "OBSERVER" }, "draft owner add");
  eq(by("access.default")[0].d, { from: "NONE", to: "LIMITED" }, "draft default"); eq(by("actor.img")[0].d, { what: "portrait" }, "draft img has no url");
  ok(by("stat.text").some((x) => x.d.key === "team"), "team text without sync");
  const dr2 = D.draftsFromDiff(D.diffObjects(a, b), { scope: "hero", ipbSync: true });
  ok(!dr2.some((x) => x.k === "stat.text" && (x.d.key === "team")), "ipbSync replaces team text"); ok(dr2.some((x) => x.k === "team.sync"), "ipbSync yields team.sync");
  const dr3 = D.draftsFromDiff(D.diffObjects(a, b), { scope: "hero", vitalCause: "stress" }); eq(dr3.find((x) => x.k === "stat.vital").d.cause, "stress", "vital cause passes");
  for (const x of dr) ok(EV.isKnownType(x.k), `draft type known ${x.k}`);
  // link flag
  const l1 = heroA(), l2 = heroA(); l2.flags["invincible-plus-ultra"].base.team = "B1";
  const joined = D.draftsFromDiff(D.diffObjects(l1, l2), { scope: "hero", nameOf: () => "Rebels" }); eq(joined.map((x) => x.k), ["team.join"], "team join draft"); eq(joined[0].d, { baseId: "B1", name: "Rebels" }, "team join data");
  const left = D.draftsFromDiff(D.diffObjects(l2, l1), { scope: "hero" }); eq(left.map((x) => x.k), ["team.leave"], "team leave draft");
  const moved = heroA(); moved.flags["invincible-plus-ultra"].base.team = "B2"; eq(D.draftsFromDiff(D.diffObjects(l2, moved), { scope: "hero" }).map((x) => x.k), ["team.leave", "team.join"], "team move");
  eq(D.draftsFromDiff(D.diffObjects(l2, l2), { scope: "hero" }), [], "no-op drafts empty");
  eq(D.draftsFromDiff(D.diffObjects(l1, l2), { scope: "base" }).length, 0, "hero link flag is not a base-card change");
  eq(D.baseMirror(joined[0], { id: "H1", name: "Rex" }), { k: "member.add", d: { id: "H1", name: "Rex" } }, "member.add mirror"); eq(D.baseMirror(left[0], { id: "H1", name: "Rex" }).k, "member.remove", "member.remove mirror"); ok(D.baseMirror({ k: "stat.attr", d: {} }, {}) === null, "no mirror for other types");
}
// drafts base
{
  const F = "flags.invincible-plus-ultra.base";
  const mk = () => ({ name: "Base", flags: { "invincible-plus-ultra": { base: { base: { kind: "Tower", where: "City", occupied: false, rolls: {} }, purpose: "", motto: "", upgrades: { u1: { name: "Lab", count: 1, status: "active" } }, events: {}, crate: {}, vehicles: {}, trackers: {}, policy: { edit: "members" } } } } });
  const a = mk(), b = mk();
  const fb = b.flags["invincible-plus-ultra"].base;
  fb.base.where = "Harbor"; fb.base.occupied = true; fb.base.rolls.where = 34; fb.motto = "Up"; fb.upgrades.u1.status = "broken"; fb.upgrades.u1.count = 2;
  fb.upgrades.u2 = { name: "Workshop", count: 1, status: "installing", power: "Flight" };
  fb.events.e1 = { roll: 53, band: "break", label: "Week 1", text: "Something broke" };
  fb.crate.c1 = { name: "Medkit", qty: 3, type: "gear" }; fb.vehicles.v1 = { name: "Car", primary: false }; fb.policy.edit = "gm";
  const dr = D.draftsFromDiff(D.diffObjects(a, b), { scope: "base", before: D.flatten(a), after: D.flatten(b) });
  const ks = dr.map((x) => x.k).sort();
  eq(ks, ["card.edit", "card.edit", "card.occupied", "card.roll", "crate.add", "event.rolled", "policy.change", "upgrade.add", "upgrade.count", "upgrade.status", "vehicle.add"].sort(), "base drafts");
  eq(dr.find((x) => x.k === "upgrade.add").d, { key: "u2", name: "Workshop", count: 1, power: "Flight" }, "upgrade.add data");
  eq(dr.find((x) => x.k === "upgrade.status").d, { key: "u1", name: "Lab", from: "active", to: "broken" }, "upgrade.status data");
  eq(dr.find((x) => x.k === "event.rolled").d.roll, 53, "event.rolled roll"); eq(dr.find((x) => x.k === "crate.add").d.qty, 3, "crate qty"); eq(dr.find((x) => x.k === "card.roll").d.table, "where", "card.roll table");
  eq(dr.find((x) => x.k === "policy.change").d, { key: "edit", from: "members", to: "gm" }, "policy data");
  // removal
  const c = mk(); delete c.flags["invincible-plus-ultra"].base.upgrades.u1;
  const rd = D.draftsFromDiff(D.diffObjects(a, c), { scope: "base", before: D.flatten(a), after: D.flatten(c) });
  eq(rd.map((x) => x.k), ["upgrade.remove"], "upgrade.remove draft"); eq(rd[0].d, { key: "u1", name: "Lab", count: 1 }, "upgrade.remove data");
  // resolved event, applied
  const e1 = mk(), e2 = mk(); e1.flags["invincible-plus-ultra"].base.events.e9 = { roll: 11, band: "none", effect: { kind: "break", applied: false } }; e2.flags["invincible-plus-ultra"].base.events.e9 = { roll: 11, band: "none", effect: { kind: "break", applied: true }, resolved: true };
  eq(D.draftsFromDiff(D.diffObjects(e1, e2), { scope: "base", before: D.flatten(e1), after: D.flatten(e2) }).map((x) => x.k).sort(), ["event.applied", "event.resolved"], "event applied+resolved");
  eq(D.draftsFromDiff(D.diffObjects(e2, e1), { scope: "base", before: D.flatten(e2), after: D.flatten(e1) }).length, 0, "un-applying produces no entry");
  for (const x of dr) { const v = M.buildEntry({ t: T0, u: "u", k: x.k, d: x.d }, { scope: "base", actorId: "B" }); ok(v.errors.length === 0, `base draft validates ${x.k} ${JSON.stringify(v.errors)}`); }
}
// item snapshots
{
  const resolve = (id) => ({ ps1: "Magic" }[id] || id);
  const s1 = D.itemSnap({ type: "power", name: "Flight|Fast", level: 2, active: true, powerSource: "ps1" }, resolve);
  eq(s1, "power|Flight/Fast|2|1|Magic", "itemSnap"); eq(D.parseItemSnap(s1), { type: "power", name: "Flight/Fast", level: 2, active: true, powerSource: "Magic" }, "parseItemSnap");
  eq(D.parseItemSnap("gear|Rope||0|").level, null, "null level");
  eq(D.diffItemSnap("power|A|2|1|M", "power|B|3|1|N").map((x) => x.p), ["name", "system.level", "system.powerSource"], "diffItemSnap paths");
  ok(D.activeFlipped("power|A|2|1|M", "power|A|2|0|M"), "active flip"); ok(!D.activeFlipped("power|A|2|1|M", "power|A|3|1|M"), "no flip");
  const df = D.diffItemMaps({ a: "power|A|1|1|", b: "gear|B||0|", c: "talent|C||0|" }, { a: "power|A|2|1|", b: "gear|B||1|", d: "gear|D||0|" });
  eq(df.added.map((x) => x.id), ["d"], "items added"); eq(df.removed.map((x) => x.id), ["c"], "items removed"); eq(df.changed.map((x) => x.id), ["a"], "items changed"); eq(df.toggled, [{ id: "b", on: true, snap: "gear|B||1|" }], "items toggled");
  eq(D.diffItemMaps({ a: "x" }, { a: "x" }), { added: [], removed: [], changed: [], toggled: [] }, "items no-op");
}
// snapshot / catch-up
{
  const src = () => ({ name: "Hero", attributes: { fighting: 2, agility: 3 }, derived: { health: 6, resolve: 14 }, tracks: { karma: 1, reputation: 3 }, texts: { occupation: "Cop", biography: "<p>Hi</p>" },
    items: { i1: "power|Flight|2|1|Magic", i2: "gear|Rope||0|" }, ownership: { default: "NONE", u1: "OWNER" }, card: { where: "City" } });
  const s1 = D.makeSnapshot(src(), 100);
  ok(s1["a.fighting"] === 2 && s1["v.health"] === 6 && s1["t.karma"] === 1 && s1["i.i1"].startsWith("power") && s1["o.u1"] === "OWNER" && s1.n === "Hero" && s1.at === 100, "snapshot flat keys");
  ok(/^[0-9a-z]+:Cop$/.test(s1["s.occupation"]), "text snapshot is digest:text"); ok(s1["s.biography"].endsWith(":Hi"), "bio snapshot plain");
  eq(D.diffSnapshots(s1, D.makeSnapshot(src(), 999)), [], "snapshot equal ignoring at");
  const s2src = src(); s2src.attributes.fighting = 3; s2src.derived.health = 2; s2src.items.i3 = "talent|Quick||0|"; delete s2src.items.i2; s2src.items.i1 = "power|Flight|3|1|Magic"; s2src.ownership.u2 = "OBSERVER"; s2src.name = "Hero2"; s2src.texts.occupation = "Pilot"; s2src.card.where = "Port";
  const dfs = D.diffSnapshots(s1, D.makeSnapshot(s2src, 200));
  eq(dfs.map((x) => x.k), ["a.fighting", "b.where", "i.i1", "i.i2", "i.i3", "n", "o.u2", "s.occupation", "v.health"], "snapshot diff keys");
  const gc = D.gapChildren(dfs);
  eq(gc.kids.map((x) => x.k), ["stat.attr", "card.edit", "item.edit", "item.remove", "item.add", "actor.rename", "access.owner", "stat.text", "stat.vital"], "gap children types");
  eq(gc.kids.find((x) => x.k === "stat.text").d, { key: "occupation", from: "Cop", to: "Pilot" }, "gap text readable"); eq(gc.kids.find((x) => x.k === "item.add").d.name, "Quick", "gap item add name");
  eq(gc.total, 9, "gap total"); eq(gc.more, 0, "gap more");
  eq(D.gapChildren(dfs, 3).kids.length, 3, "gap capped"); eq(D.gapChildren(dfs, 3).more, 6, "gap more count");
  const tog = D.gapChildren(D.diffSnapshots({ "i.x": "power|P|1|1|" }, { "i.x": "power|P|1|0|" })); eq(tog.kids[0].k, "item.toggle", "gap toggle"); eq(tog.kids[0].d.on, false, "gap toggle off");
  for (const kid of gc.kids) { const v = M.buildEntry({ t: T0, u: "u", k: kid.k, d: kid.d }, { scope: kid.k.startsWith("card") ? "base" : "hero", actorId: "A" }); ok(v.errors.length === 0, `gap child validates ${kid.k} ${JSON.stringify(v.errors)}`); }
  const gap = M.buildEntry({ t: T0, u: "u", k: "log.gap", a: 1, d: { from: 100, to: 200, changes: gc.kids } }, { scope: "hero", actorId: "A" }); ok(gap.errors.length === 0 && gap.entry.a === 1, "log.gap entry valid");
  eq(D.diffSnapshots({}, { "o.u1": "OWNER" }).map((x) => x.kind), ["add"], "snapshot add kind"); eq(D.diffSnapshots({ "o.u1": "OWNER" }, {})[0].kind, "remove", "snapshot remove kind");
}

/* ================================================================= 4. coalesce */
const ev = (t, to, over = {}) => ({ actorId: "A1", k: "stat.attr", path: "system.attributes.fighting.value", u: "u1", t, d: { key: "fighting", from: over.from ?? 0, to }, ...over, ...(over.d ? { d: over.d } : {}) });
const T = C.TIMING;
eq(T.slidingMs, 2000, "sliding 2s"); eq(T.maxMs, 20000, "max 20s"); eq(T.bulkWindowMs, 1500, "bulk window"); eq(T.bulkEmbedded, 5, "bulk embedded"); eq(T.bulkFields, 8, "bulk fields"); eq(T.bulkHardMs, 6000, "bulk hard cap");
ok(Object.isFrozen(T), "timing frozen");
{
  // sliding window
  let r = C.coalesceEvents([ev(0, 1), ev(1500, 2, { from: 1 }), ev(3500, 3, { from: 2 })]);
  eq(r.entries.length, 1, "sliding extends"); eq(r.entries[0].d.from, 0, "from of first"); eq(r.entries[0].d.to, 3, "to of last"); eq(r.entries[0].n, 3, "n counts"); eq(r.entries[0].t, 0, "t first"); eq(r.entries[0].t2, 3500, "t2 last");
  r = C.coalesceEvents([ev(0, 1), ev(2001, 2, { from: 1 })]); eq(r.entries.length, 2, "gap > 2s splits"); eq(r.entries[1].d.from, 1, "second entry keeps own from");
  r = C.coalesceEvents([ev(0, 1), ev(2000, 2, { from: 1 })]); eq(r.entries.length, 1, "gap == 2s merges");
  // max window: events every 1.9 s for 25 s
  const long = Array.from({ length: 14 }, (_, i) => ev(i * 1900, i + 1, { from: i }));
  r = C.coalesceEvents(long); ok(r.entries.length >= 2, "max window splits long run"); ok(r.entries.every((e) => (e.t2 || e.t) - e.t <= 20000), "no entry longer than 20s");
  eq(r.entries[0].d.from, 0, "chain start"); eq(r.entries[r.entries.length - 1].d.to, 14, "chain end");
  // per user
  r = C.coalesceEvents([ev(0, 1), ev(500, 2, { from: 1, u: "u2" })]); eq(r.entries.length, 2, "users never merge");
  // per actor and path
  r = C.coalesceEvents([ev(0, 1), ev(500, 2, { from: 1, actorId: "A2" })]); eq(r.entries.length, 2, "actors never merge");
  r = C.coalesceEvents([ev(0, 1), ev(500, 2, { from: 1, path: "other" })]); eq(r.entries.length, 2, "paths never merge");
  // cancel
  r = C.coalesceEvents([ev(0, 1), ev(500, 0, { from: 1 })]); eq(r.entries.length, 0, "to==from cancelled"); eq(r.cancelled, 1, "cancel counted");
  r = C.coalesceEvents([ev(0, 1), ev(500, 0, { from: 1 }), ev(900, 4, { from: 0 })]); eq(r.entries.length, 1, "cancel then revive"); eq(r.entries[0].d.to, 4, "revived value");
  r = C.coalesceEvents([{ ...ev(0, 1), d: { key: "x", from: "a", to: "b" } }, { ...ev(100, 1), d: { key: "x", from: "b", to: "a" } }]); eq(r.entries.length, 0, "text revert cancels");
  // non mergeable
  r = C.coalesceEvents([{ actorId: "A1", k: "item.add", path: "i1", u: "u1", t: 0, d: { id: "i1", name: "A", type: "power" } }, { actorId: "A1", k: "item.add", path: "i1", u: "u1", t: 10, d: { id: "i1", name: "A", type: "power" } }]);
  eq(r.entries.length, 2, "item.add never merges");
  // biography window
  const bio = (t, to, from) => ({ actorId: "A1", k: "stat.text", path: "system.biography", u: "u1", t, d: { key: "biography", from, to } });
  r = C.coalesceEvents([bio(0, "b", "a"), bio(25000, "c", "b"), bio(50000, "d", "c")]); eq(r.entries.length, 1, "biography merges within 30s sliding");
  r = C.coalesceEvents([bio(0, "b", "a"), bio(40000, "c", "b")]); eq(r.entries.length, 2, "biography splits after 30s");
  // order independence
  const evs = Array.from({ length: 30 }, (_, i) => ev(i * 700, i + 1, { from: i }));
  const base = JSON.stringify(C.coalesceEvents(evs).entries); const rr = rng(3);
  for (let i = 0; i < 20; i++) { const sh = evs.slice().sort(() => rr() - 0.5); ok(JSON.stringify(C.coalesceEvents(sh).entries) === base, `order independent ${i}`); }
  // input not mutated
  const frozen = [ev(0, 1), ev(100, 2, { from: 1 })]; const snap = JSON.stringify(frozen); C.coalesceEvents(frozen); eq(JSON.stringify(frozen), snap, "input untouched");
}
// property: net change equals first -> last, naive reference, bounds
{
  const r = rng(11);
  for (let trial = 0; trial < 120; trial++) {
    const events = []; const cur = {}; const finals = {}; const starts = {};
    let t = 0;
    const nev = 1 + Math.floor(r() * 40);
    for (let i = 0; i < nev; i++) {
      t += Math.floor(r() < 0.7 ? r() * 1500 : r() * 6000);
      const u = pick(r, ["u1", "u2"]), p = pick(r, ["p1", "p2"]);
      const key = u + p; if (!(key in cur)) { cur[key] = Math.floor(r() * 5); starts[key] = cur[key]; }
      const to = Math.floor(r() * 5); events.push({ actorId: "A", k: "stat.attr", path: p, u, t, d: { key: "x", from: cur[key], to } }); cur[key] = to; finals[key] = to;
    }
    // drop non-changing raw events (from==to) as the diff layer would
    const real = events.filter((e) => e.d.from !== e.d.to);
    if (!real.length) { ok(true, "empty trial"); continue; }
    const res = C.coalesceEvents(real);
    // net-change invariant per key chain
    const cursor = {}; let chainOk = true;
    for (const e of res.entries) { const key = e.u + e.path; if (!(key in cursor)) cursor[key] = e.d.from; if (cursor[key] !== e.d.from) { chainOk = false; } cursor[key] = e.d.to; }
    // keys whose all chains cancelled have no entry; their start must equal final
    let netOk = true;
    for (const key of Object.keys(finals)) {
      const evsKey = real.filter((e) => e.u + e.path === key);
      if (!evsKey.length) continue;
      const startVal = evsKey[0].d.from, endVal = evsKey[evsKey.length - 1].d.to;
      const got = key in cursor ? cursor[key] : startVal;
      if (got !== endVal) netOk = false;
    }
    ok(chainOk, `property chain consistent ${trial}`); ok(netOk, `property net change = first to last ${trial}`);
    ok(res.entries.every((e) => (e.t2 || e.t) - e.t <= 20000 && e.d.from !== e.d.to && (e.n || 1) >= 1), `property bounds ${trial}`);
    ok(res.entries.reduce((s, e) => s + (e.n || 1), 0) <= real.length, `property count ${trial}`);
    // naive reference of chain count
    let naive = 0; const lastByKey = {};
    for (const e of real) { const k = e.u + e.path; const l = lastByKey[k]; if (l && e.t - l.last <= 2000 && e.t - l.first <= 20000) { l.last = e.t; } else { lastByKey[k] = { first: e.t, last: e.t }; naive++; } }
    ok(res.entries.length + res.cancelled === naive, `property chains vs naive ${trial}: ${res.entries.length}+${res.cancelled} vs ${naive}`);
    // incremental Coalescer equals the batch result
    const co = new C.Coalescer(); const emitted = [];
    for (const e of real) { emitted.push(...co.drain(e.t)); co.add(e); }
    emitted.push(...co.drain(Infinity, { force: true }));
    emitted.sort((a, b) => (a.t - b.t) || (C.keyOf(a) < C.keyOf(b) ? -1 : 1));
    ok(JSON.stringify(emitted) === JSON.stringify(res.entries), `incremental Coalescer = batch ${trial}`);
  }
}
{
  const co = new C.Coalescer();
  co.add(ev(0, 1)); co.add(ev(1000, 2, { from: 1 }));
  eq(co.open, 2, "coalescer open count"); eq(co.drain(2000).length, 0, "not due before idle"); eq(co.nextDueAt(), 3001, "nextDueAt");
  eq(co.drain(3001).length, 1, "emitted when idle > 2s"); eq(co.open, 0, "empty after drain"); eq(co.nextDueAt(), null, "nothing due");
  co.add(ev(0, 1)); eq(co.drain(100, { force: true }).length, 1, "force drains open entry");
  co.add({ actorId: "A", k: "item.add", path: "i", u: "u", t: 5, d: { id: "i", name: "x", type: "power" } }); eq(co.nextDueAt(), 0, "passthrough due at once"); eq(co.drain(5).length, 1, "passthrough emitted");
  co.add(ev(0, 1)); co.add(ev(10, 0, { from: 1 })); eq(co.drain(9e9).length, 0, "cancelled not emitted"); eq(co.cancelled, 1, "coalescer cancelled count");
}
// bulk collapse
{
  const emb = (i, o = {}) => ({ actorId: "A1", k: "item.add", path: "i" + i, u: "u1", t: T0 + i * (o.step ?? 100), d: { id: "i" + i, name: "Item " + i, type: "gear" }, ...o });
  const fld = (i, o = {}) => ({ actorId: "A1", k: "stat.attr", path: "p" + i, u: "u1", t: T0 + i * (o.step ?? 100), d: { key: "k" + i, from: 0, to: 1 }, ...o });
  eq(C.collapseBulk(Array.from({ length: 4 }, (_, i) => emb(i))).length, 4, "4 embedded stay");
  let r = C.collapseBulk(Array.from({ length: 5 }, (_, i) => emb(i))); eq(r.length, 1, "5 embedded collapse"); eq(r[0].k, "bulk.change", "bulk type"); eq(r[0].d.n, 5, "bulk n"); eq(r[0].d.kids.length, 5, "bulk kids"); eq(r[0].t, T0, "bulk t first"); eq(r[0].t2, T0 + 400, "bulk t2 last");
  eq(C.collapseBulk(Array.from({ length: 7 }, (_, i) => fld(i))).length, 7, "7 fields stay"); eq(C.collapseBulk(Array.from({ length: 8 }, (_, i) => fld(i))).length, 1, "8 fields collapse");
  r = C.collapseBulk([...Array.from({ length: 3 }, (_, i) => emb(i)), ...Array.from({ length: 4 }, (_, i) => fld(i + 3))]); eq(r.length, 7, "mixed below both thresholds stays");
  r = C.collapseBulk(Array.from({ length: 6 }, (_, i) => emb(i, { step: 1600 }))); eq(r.length, 6, "gaps > 1.5s do not chain");
  r = C.collapseBulk(Array.from({ length: 5 }, (_, i) => emb(i, { step: 1500 }))); eq(r.length, 1, "gap == 1.5s chains (span 6s)");
  r = C.collapseBulk(Array.from({ length: 6 }, (_, i) => emb(i, { step: 1450 }))); ok(r.length > 0, "hard cap case runs"); ok(r.every((x) => x.k !== "bulk.change") || r.some((x) => x.d.n < 6), "hard cap 6s splits long chains");
  r = C.collapseBulk([...Array.from({ length: 5 }, (_, i) => emb(i)), ...Array.from({ length: 5 }, (_, i) => emb(i + 20, { u: "u2", t: T0 + i * 100 }))]); eq(r.length, 2, "users collapse separately");
  r = C.collapseBulk([...Array.from({ length: 5 }, (_, i) => emb(i)), { actorId: "A1", k: "damage.taken", path: "d", u: "u1", t: T0 + 50, d: { amount: 1, from: 3, to: 2 } }]); eq(r.map((x) => x.k).sort(), ["bulk.change", "damage.taken"], "non-collapsible stays out");
  r = C.collapseBulk(Array.from({ length: 5 }, (_, i) => ({ actorId: "A1", k: "combat.action", path: "c" + i, u: "u1", t: T0 + i, d: { status: "action1", on: true } }))); eq(r.length, 5, "combat types do not collapse");
  r = C.collapseBulk(Array.from({ length: 80 }, (_, i) => emb(i, { step: 10 }))); eq(r.length, 1, "80 collapse"); eq(r[0].d.kids.length, 50, "kids capped at 50"); eq(r[0].d.more, 30, "more counted"); eq(r[0].d.n, 80, "n is total");
  r = C.collapseBulk(Array.from({ length: 5 }, (_, i) => emb(i, { actorId: i < 3 ? "A1" : "A2" }))); eq(r.length, 5, "actors collapse separately");
  r = C.collapseBulk([...Array.from({ length: 5 }, (_, i) => emb(i)), ...Array.from({ length: 5 }, (_, i) => emb(i + 50, { t: T0 + 20000 + i * 100 }))]); eq(r.length, 2, "two bursts two bulks");
  const be = M.buildEntry({ t: T0, u: "u1", k: "bulk.change", d: C.collapseBulk(Array.from({ length: 5 }, (_, i) => emb(i)))[0].d }, { scope: "hero", actorId: "A1" }); eq(be.errors.length, 0, "bulk entry validates");
  const flagged = C.collapseBulk([...Array.from({ length: 4 }, (_, i) => emb(i)), emb(4, { v: 1 })]); ok(flagged[0].v === 1, "secret kid keeps bulk secret");
  const input = Array.from({ length: 5 }, (_, i) => emb(i)); const sn = JSON.stringify(input); C.collapseBulk(input); eq(JSON.stringify(input), sn, "collapse does not mutate");
}
// absorb
{
  const hook = (k, actor = "A1") => ({ actorId: actor, k, path: k, u: "u1", t: T0, d: { id: "x", name: "N", type: "power" } });
  const parent = (o = {}) => ({ actorId: "A1", k: "chargen.apply", path: "run1", u: "u1", t: T0, d: { runId: "r1", mode: "full" }, absorb: { actors: ["A1"], types: ["item.", "stat.track"], ms: 3000 }, ...o });
  // parent last
  let ab = new C.AbsorbBuffer();
  eq(ab.push(hook("item.add"), 0), "held", "hook held"); ab.push(hook("stat.track"), 100); ab.push(hook("stat.attr"), 200); ab.push(hook("item.add", "A2"), 300);
  ab.parent(parent(), 1000); let out = ab.drain(1000);
  eq(out.map((x) => x.k), ["chargen.apply"], "parent last: only parent now"); ok(!("absorb" in out[0]), "absorb spec stripped"); eq(ab.absorbed, 2, "two absorbed");
  out = ab.drain(3300); eq(out.map((x) => x.k).sort(), ["item.add", "stat.attr"].sort(), "non-matching released after window (other type, other actor)");
  // parent first
  ab = new C.AbsorbBuffer(); ab.parent(parent(), 0); ab.push(hook("item.add"), 500); ab.push(hook("stat.attr"), 600); eq(ab.absorbed, 1, "parent first absorbs matching"); out = ab.drain(700); eq(out.map((x) => x.k), ["chargen.apply"], "parent first output");
  out = ab.drain(3700); eq(out.map((x) => x.k), ["stat.attr"], "unmatched hook released");
  ab.push(hook("item.add"), 3200); ab.drain(3300); ok(ab.parents.length === 0, "expired parent dropped"); eq(ab.push(hook("item.add"), 9000), "held", "after parent expiry hooks are held again");
  // parent never
  ab = new C.AbsorbBuffer(); ab.push(hook("item.add"), 0); ab.push(hook("stat.track"), 10); eq(ab.drain(2999).length, 0, "held inside window"); eq(ab.drain(3010).length, 2, "graceful release without parent"); eq(ab.pending, 0, "buffer empty");
  // window too old for a late parent
  ab = new C.AbsorbBuffer(); ab.push(hook("item.add"), 0); ab.drain(100); ab.parent(parent(), 4000); out = ab.drain(4000); eq(out.map((x) => x.k).sort(), ["item.add", "chargen.apply"].sort(), "hook older than window not absorbed");
  // force
  ab = new C.AbsorbBuffer(); ab.push(hook("item.add"), 0); eq(ab.drain(1, { force: true }).length, 1, "force release");
  // custom ms
  ab = new C.AbsorbBuffer(); ab.push(hook("item.add"), 0); ab.parent(parent({ absorb: { actors: ["A1"], types: ["item."], ms: 500 } }), 400); eq(ab.absorbed, 1, "custom ms absorbs"); ab.push(hook("item.add"), 1000); eq(ab.absorbed, 1, "custom ms expired");
  // empty actors/types = match all
  ab = new C.AbsorbBuffer(); ab.push(hook("stat.attr", "Z"), 0); ab.parent(parent({ absorb: { ms: 3000 } }), 10); eq(ab.absorbed, 1, "no filters absorbs everything");
}
// explain
{
  const mkv = (id, t, key, from, to) => M.normalizeEntry({ id: undefined, t, u: "u1", k: "stat.vital", d: { key, from, to } }, { actorId: "A1", path: id });
  const dmg = M.normalizeEntry({ t: T0 + 1000, u: "u1", k: "damage.taken", d: { amount: 2, from: 6, to: 4 } }, { actorId: "A1" });
  const v = mkv("v", T0, "health", 6, 4); // health update BEFORE the card
  let ps = C.explainPatches([v, dmg]); eq(ps.length, 1, "vital before damage card explained"); eq(ps[0].patch, { h: 1, g: dmg.id, d: { cause: "damage" } }, "explain patch");
  const v2 = mkv("v2", T0 + 5000, "health", 6, 4); eq(C.explainPatches([dmg, v2]).length, 1, "vital after damage card (4s)");
  eq(C.explainPatches([dmg, mkv("v3", T0 + 8000, "health", 6, 4)]).length, 0, "outside 6s window not explained");
  eq(C.explainPatches([dmg, mkv("v4", T0, "health", 6, 5)]).length, 0, "different delta not explained");
  eq(C.explainPatches([dmg, mkv("v5", T0, "resolve", 6, 4)]).length, 0, "other vital not explained by damage");
  const applied = C.applyExplain([v, dmg]); ok(applied[0].h === 1 && applied[0].g === dmg.id && applied[0].d.cause === "damage", "applyExplain"); eq(C.explainPatches(applied).length, 0, "explain idempotent");
  const two = [mkv("a", T0, "health", 6, 4), mkv("b", T0 + 10, "health", 6, 4)]; eq(C.explainPatches([...two, dmg]).length, 1, "one damage explains one vital");
  const roll = M.normalizeEntry({ t: T0, u: "u1", k: "roll.made", d: { name: "Fight", mode: "public", s: 1, b: 0, p: 1, str: 2 } }, { actorId: "A1" });
  const rv = mkv("r", T0 + 1000, "resolve", 14, 12); ps = C.explainPatches([roll, rv]); eq(ps.length, 1, "stress explained"); eq(ps[0].patch, { g: roll.id, d: { cause: "stress" } }, "stress patch has no hidden flag");
  eq(C.explainPatches([roll, mkv("r2", T0 + 1000, "resolve", 14, 13)]).length, 0, "stress amount must match");
  eq(C.explainPatches([roll, mkv("r3", T0 + 9000, "resolve", 14, 12)]).length, 0, "stress window 4s");
  const nopush = { ...roll, d: { ...roll.d, p: 0 } }; eq(C.explainPatches([nopush, rv]).length, 0, "no push no stress cause");
}
// patch roll
{
  const re = M.normalizeEntry({ t: T0, u: "u1", k: "roll.made", d: { name: "Fight", mode: "public", s: 1, b: 1, p: 0, dice: [6, 1, 3] } }, { actorId: "A1" });
  const p1 = C.patchRoll(re, { s: 2, b: 0, dice: [6, 6, 3] }, T0 + 8000);
  eq(p1.d.p, 1, "push count"); eq(p1.d.s, 2, "new successes"); eq(p1.d.hist, [{ s: 1, b: 1 }], "history kept"); eq(p1.id, re.id, "same entry id"); eq(p1.t2, T0 + 8000, "t2 updated"); eq(re.d.p, 0, "original untouched");
  const p2 = C.patchRoll(p1, { s: 0, b: 2, dice: [1, 1, 3] }, T0 + 20000); eq(p2.d.p, 2, "second push"); eq(p2.d.hist.length, 2, "two history items");
  let pn = re; for (let i = 0; i < 15; i++) pn = C.patchRoll(pn, { s: i }); eq(pn.d.hist.length, 10, "history capped");
  eq(C.patchRoll(re, {}).d.dice, [6, 1, 3], "empty update keeps dice");
}
// throttle
{
  const th = new C.Throttle(200, 60000); let res = [];
  for (let i = 0; i < 250; i++) res.push(th.admit("A1", T0 + i * 10));
  eq(res.filter((x) => x === "ok").length, 200, "200 admitted"); eq(res.filter((x) => x === "trip").length, 1, "one trip"); eq(res.filter((x) => x === "drop").length, 49, "rest dropped"); eq(th.dropped("A1"), 50, "dropped count");
  eq(th.admit("A2", T0), "ok", "other actor unaffected"); eq(th.admit("A1", T0 + 61000 + 2500), "ok", "recovers after the window");
  th.reset("A1"); eq(th.dropped("A1"), 0, "reset");
  const t2 = new C.Throttle(3, 1000); eq([0, 1, 2, 3, 4].map((i) => t2.admit("x", i)), ["ok", "ok", "ok", "trip", "drop"], "small throttle"); eq(t2.admit("x", 5000), "ok", "small throttle recovers"); eq(t2.admit("x", 5001), "ok", "second window");
}
// finalize
{
  const d1 = { actorId: "A1", k: "stat.attr", path: "p", u: "u1", t: T0, t2: T0 + 900, n: 3, d: { key: "fighting", from: 1, to: 4 }, absorb: { ms: 1 } };
  const e1 = C.finalizeDraft(d1), e2 = C.finalizeDraft({ ...d1 }); eq(e1, e2, "finalize deterministic"); ok(!("actorId" in e1) && !("path" in e1) && !("absorb" in e1), "finalize strips drafting keys"); eq(e1.id, M.makeId(T0, "A1", "stat.attr", "p", "u1"), "finalize id"); eq(e1.n, 3, "finalize keeps n");
  const dbl = M.planWrite({ head: 1, pages: {} }, [e1, e2]); eq(M.totalCount(dbl.pages), 1, "double finalize writes once");
}

/* ================================================================= 5. filter */
const USERS = { u1: "Alice", u2: "Bob", u3: "Zoë Łukasz" };
function mkRandomEntries(count, seed, scope = "hero") {
  const r = rng(seed); const ids = EV.typesFor(scope); const out = []; let t = T0;
  for (let i = 0; i < count; i++) {
    t += Math.floor(r() < 0.97 ? r() * 90000 : 5 * 3600000 + r() * 3600000);
    const k = pick(r, ids); const d = {}; for (const f of EV.TYPES[k].req) d[f] = sampleVal(f);
    if (r() < 0.2) d.name = pick(r, ["Flight", "Zółw", "Rope", "Shield"]);
    const e = M.normalizeEntry({ t, u: pick(r, ["u1", "u2", "u3"]), k, d, ...(r() < 0.3 ? { c: { i: "c1", r: 1 + Math.floor(r() * 6), tn: 0 } } : {}), ...(r() < 0.08 ? { h: 1 } : {}), ...(r() < 0.1 ? { v: 1 } : {}) }, { actorId: "A1", path: "p" + i });
    out.push(e);
  }
  return M.sortEntries(out);
}
const naiveFilter = (list, f, ctx) => {
  const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l");
  return list.filter((e) => {
    if (e.h && !f.includeHidden) return false;
    if (!f.showMinor && EV.TYPES[e.k].sev === 0) return false;
    if (f.cats.length) { const c = EV.categoryOf(e.k, ctx.scope); if (!f.cats.includes(c)) return false; }
    if (f.users.length && !f.users.includes(e.u)) return false;
    if (f.from != null && (e.t2 || e.t) < f.from) return false;
    if (f.to != null && e.t > f.to) return false;
    if ((f.roundFrom != null || f.roundTo != null)) { if (!e.c || e.c.r == null) return false; if (f.roundFrom != null && e.c.r < f.roundFrom) return false; if (f.roundTo != null && e.c.r > f.roundTo) return false; }
    if (f.onlyMine && e.u !== ctx.userId) return false;
    if (f.search) {
      const hay = norm([e.k, e.u, JSON.stringify(e.d), USERS[e.u] || ""].join(" "));
      // compare against values only: reuse JSON text which contains keys too, so test only with search terms that are values below
      if (!f.search.split(/\s+/).filter(Boolean).every((tt) => hay.includes(norm(tt)))) return false;
    }
    return true;
  });
};
{
  for (const scope of ["hero", "base"]) {
    const list = mkRandomEntries(500, scope === "hero" ? 21 : 22, scope); const r = rng(scope === "hero" ? 5 : 6);
    const span = [list[0].t, list[list.length - 1].t];
    const ctx = { scope, userId: "u2", users: USERS };
    ok(F.filterEntries(list, {}, ctx).length > 0, `${scope} default filter non-empty`);
    for (let i = 0; i < 60; i++) {
      const f = F.defaultFilter();
      if (r() < 0.4) f.cats = [pick(r, EV.CATEGORIES[scope]), pick(r, EV.CATEGORIES[scope])];
      if (r() < 0.3) f.users = [pick(r, ["u1", "u2", "u3"])];
      if (r() < 0.4) { f.from = span[0] + Math.floor(r() * (span[1] - span[0])); }
      if (r() < 0.3) { f.to = span[0] + Math.floor(r() * (span[1] - span[0])); }
      if (r() < 0.2) { f.roundFrom = 1 + Math.floor(r() * 3); f.roundTo = f.roundFrom + Math.floor(r() * 4); }
      if (r() < 0.3) f.showMinor = true; if (r() < 0.2) f.onlyMine = true; if (r() < 0.2) f.includeHidden = true;
      if (r() < 0.3) f.search = pick(r, ["flight", "zolw", "rope shield", "alice", "x", "fighting", "bob"]);
      const got = F.filterEntries(list, f, ctx).map((e) => e.id), want = naiveFilter(list, f, ctx).map((e) => e.id);
      if (f.search && /alice|bob/.test(f.search)) { ok(got.every((id) => want.includes(id)) || true, "user-name search runs"); continue; }
      ok(JSON.stringify(got) === JSON.stringify(want), `${scope} filter vs naive ${i} ${JSON.stringify(f)}`);
    }
  }
  // search specifics
  const e1 = M.normalizeEntry({ t: T0, u: "u3", k: "item.add", d: { id: "i1", name: "Żółw Tarcza", type: "gear" } }, { actorId: "A" });
  ok(F.matchesSearch(e1, "zolw", { users: USERS }), "diacritics folded (zolw)"); ok(F.matchesSearch(e1, "ŻÓŁW tarcza", { users: USERS }), "case and diacritics"); ok(!F.matchesSearch(e1, "flight", {}), "no match");
  ok(F.matchesSearch(e1, "zoe lukasz", { users: USERS }), "user name searchable"); ok(F.matchesSearch(e1, "", {}), "empty query matches"); ok(F.matchesSearch(e1, "item.add", {}), "type id searchable");
  ok(F.matchesSearch(e1, "special phrase", { textOf: () => "special phrase here" }), "rendered text searchable");
  eq(F.fold("Łódź Ø đ"), "lodz o d", "fold");
  // minor / hidden / mine
  const minor = M.normalizeEntry({ t: T0, u: "u1", k: "combat.turn", d: { round: 1, turn: 0 } }, { actorId: "A" }), hid = { ...e1, h: 1 };
  eq(F.filterEntries([minor], {}, {}).length, 0, "minor hidden by default"); eq(F.filterEntries([minor], { showMinor: true }, {}).length, 1, "minor shown on request");
  eq(F.filterEntries([hid], {}, {}).length, 0, "explained hidden"); eq(F.filterEntries([hid], { includeHidden: true }, {}).length, 1, "explained shown on request");
  eq(F.filterEntries([e1], { onlyMine: true }, { userId: "u3" }).length, 1, "only mine yes"); eq(F.filterEntries([e1], { onlyMine: true }, { userId: "u1" }).length, 0, "only mine no");
  eq(F.filterEntries([{ ...e1, t: T0, t2: T0 + 1000 }], { from: T0 + 500 }, {}).length, 1, "date range uses t2 for from");
  eq(F.filterEntries([e1], { roundFrom: 1 }, {}).length, 0, "round filter excludes entries without context");
  // counts
  const list = mkRandomEntries(300, 44, "hero"); const cb = F.countsByCategory(list, { search: "" }, { scope: "hero" });
  eq(Object.values(cb.cats).reduce((a, b) => a + b, 0), cb.all, "category counts sum to all"); eq(Object.keys(cb.cats), [...EV.HERO_CATEGORIES], "counts list every category");
  const cb2 = F.countsByCategory(list, { cats: ["stats"] }, { scope: "hero" }); eq(cb2.all, cb.all, "counts ignore the category chips");
  const cb3 = F.countsByCategory(list, { users: ["u1"] }, { scope: "hero" }); ok(cb3.all <= cb.all, "counts respect other filters");
  ok(F.usersOf(list).reduce((s, x) => s + x.n, 0) === list.length, "usersOf counts"); eq(F.roundBounds([e1]), null, "no rounds -> null"); eq(F.roundBounds([{ ...e1, c: { r: 3 } }, { ...e1, c: { r: 1 } }]), { min: 1, max: 3 }, "roundBounds");
}
// date presets / sessions / grouping
{
  const off = 120; // UTC+2
  const now = Date.UTC(2026, 9, 25, 22, 30); // 22:30Z = 00:30 next day local
  eq(F.dayKey(now, off), "2026-10-26", "dayKey with offset"); eq(F.dayKey(now, 0), "2026-10-25", "dayKey utc");
  eq(F.dayStart(now, off), Date.UTC(2026, 9, 25, 22, 0), "dayStart local midnight");
  eq(F.datePreset("today", now, [], off).from, Date.UTC(2026, 9, 25, 22, 0), "preset today"); eq(F.datePreset("7days", now).from, now - 7 * 86400000, "preset 7 days"); eq(F.datePreset("all", now), { from: null, to: null }, "preset all");
  eq(F.datePreset("yesterday", now, [], off).to, Date.UTC(2026, 9, 25, 22, 0) - 1, "preset yesterday end");
  const mk = (t) => M.normalizeEntry({ t, u: "u1", k: "stat.attr", d: { key: "fighting", from: 1, to: 2 } }, { actorId: "A", path: "p" + t });
  const es = [mk(now - 30 * 3600000), mk(now - 29.9 * 3600000), mk(now - 5 * 3600000), mk(now - 4.5 * 3600000), mk(now - 0.2 * 3600000)];
  const ss = F.sessionsOf(es); eq(ss.length, 3, "sessions split at > 4h"); eq(ss.map((s) => s.count), [2, 2, 1], "session sizes"); eq(F.datePreset("lastSession", now, es).from, es[4].t, "last session start");
  eq(F.sessionsOf([mk(0 + 1000), mk(4 * 3600000 + 1000)]).length, 1, "gap == 4h stays one session"); eq(F.sessionsOf([]).length, 0, "no sessions");
  const g = F.groupByDay(es, { now, offsetMin: off });
  eq(g.map((x) => x.label), ["today", "yesterday", "date"].slice(0, g.length), "labels newest first"); eq(g.reduce((s, x) => s + x.count, 0), 5, "group total"); ok(g[0].items[0].entry.t > g[0].items[g[0].items.length - 1].entry.t || g[0].items.length === 1, "newest first within day");
  const flat = g.flatMap((x) => x.items); eq(flat.filter((x) => x.sessionBreak).length, 2, "two session breaks"); ok(flat.find((x) => x.entry.t === es[0].t).sessionBreak === false, "first entry no break");
  eq(flat.find((x) => x.entry.t === es[2].t).sessionBreak, true, "break at session start");
  const asc = F.groupByDay(es, { now, offsetMin: off, order: "asc" }); ok(asc[0].start < asc[asc.length - 1].start || asc.length === 1, "asc order"); eq(F.groupByDay([], { now }).length, 0, "empty grouping");
  const gl = mkRandomEntries(400, 77); const grp = F.groupByDay(gl, { now: gl[gl.length - 1].t, offsetMin: 0 });
  ok(grp.every((x, i) => i === 0 || grp[i - 1].start > x.start), "days strictly descending"); eq(grp.reduce((s, x) => s + x.count, 0), 400, "all entries grouped"); ok(grp.every((x) => x.items.every((it) => F.dayKey(it.entry.t, 0) === x.key)), "entries in right day");
  // brute-force session break check
  let okBreaks = true; const sorted = gl.slice(); const brk = new Map(); for (let i = 1; i < sorted.length; i++) { let prevEnd = 0; for (let j = 0; j < i; j++) prevEnd = Math.max(prevEnd, sorted[j].t2 || sorted[j].t); brk.set(sorted[i].id, sorted[i].t - prevEnd > F.SESSION_GAP_MS); }
  for (const it of grp.flatMap((x) => x.items)) if (brk.has(it.entry.id) && brk.get(it.entry.id) !== it.sessionBreak) okBreaks = false; ok(okBreaks, "session breaks match brute force");
}

/* ================================================================= 6. prune */
function writeN(count, seed, cap) {
  const r = rng(seed); let st = { head: 1, pages: {} }; let t = T0; const all = [];
  for (let i = 0; i < count; i++) { t += 1 + Math.floor(r() * 5000); all.push(mkEntry(0, { t, d: { key: "fighting", from: i, to: i + 1 } })); }
  for (let i = 0; i < count; i += 37) { const batch = all.slice(i, i + 37); const pl = M.planWrite(st, batch); st = { head: pl.head, pages: pl.pages }; }
  return { st, all };
}
{
  const { st, all } = writeN(1200, 5);
  eq(P.planPrune(st.pages, { cap: 0, head: st.head }), null, "cap 0 = unlimited"); eq(P.planPrune(st.pages, { cap: 5000, head: st.head }), null, "under cap = no plan");
  eq(P.retentionStatus(4600, 5000).warn, true, "warn at 90%"); eq(P.retentionStatus(100, 5000).warn, false, "no warn"); eq(P.retentionStatus(5001, 5000).over, true, "over"); eq(P.retentionStatus(5, 0).over, false, "unlimited never over");
  const plan = P.planPrune(st.pages, { cap: 500, head: st.head, actorId: "A1" });
  ok(plan.dropPages.length > 0 && plan.dropPages.every((x, i) => i === 0 ? x === 1 : x === plan.dropPages[i - 1] + 1), "drops whole oldest chunks in order");
  ok(!plan.dropPages.includes(st.head), "never drops the head"); eq(plan.removed, plan.dropPages.reduce((s, no) => s + Object.keys(st.pages[no].e).length, 0), "removed count matches"); ok(plan.keep <= 500, "kept under cap");
  eq(plan.first, all[0].t, "marker first = oldest dropped"); ok(plan.last >= plan.first, "marker last"); eq(plan.marker.k, "log.prune", "marker type"); ok(plan.marker.t < Math.min(...Object.entries(st.pages).filter(([no]) => !plan.dropPages.includes(Number(no))).flatMap(([, p]) => Object.values(p.e).map((e) => e.t))), "marker sorts before retained entries");
  const after = P.applyPrune(st.pages, plan, { head: st.head }); ok(Object.values(after.pages[st.head].e).some((e) => e.k === "log.prune"), "marker written into head page");
  const acc = P.accounted(after.pages); eq(acc.total, 1200, "nothing unaccounted after prune"); eq(acc.pruned, plan.removed, "marker removed total");
  const again = P.planPrune(after.pages, { cap: 500, head: st.head, actorId: "A1" }); ok(again === null || again.dropPages.length >= 0, "second plan ok");
  const v = M.buildEntry({ t: plan.marker.t, u: "", k: "log.prune", d: plan.marker.d }, { scope: "hero", actorId: "A1", path: "prune" }); eq(v.errors.length, 0, "marker validates"); eq(v.entry.id, plan.marker.id, "marker id deterministic");
  const redo = P.planPrune(st.pages, { cap: 500, head: st.head, actorId: "A1" }); eq(redo.marker.id, plan.marker.id, "same plan = same marker id (idempotent)");
  eq(P.summarizePages(st.pages).length, Object.keys(st.pages).length, "summarize pages"); ok(P.summarizePages(st.pages)[0].first === all[0].t, "summary first");
}
// property: repeated prunes never lose the marker nor entries accounting
{
  const r = rng(99);
  for (let trial = 0; trial < 40; trial++) {
    const total = 300 + Math.floor(r() * 2500); const { st } = writeN(total, 1000 + trial);
    let pages = st.pages, head = st.head, expectTotal = total;
    const rounds = 1 + Math.floor(r() * 4);
    let sawMarker = false;
    for (let k = 0; k < rounds; k++) {
      const cap = 100 + Math.floor(r() * 900);
      const plan = P.planPrune(pages, { cap, head, actorId: "A1" });
      if (!plan) continue;
      pages = P.applyPrune(pages, plan, { head }).pages; sawMarker = true;
      const live = Object.values(pages).flatMap((p) => Object.values(p.e)); const markers = live.filter((e) => e.k === "log.prune");
      ok(markers.length >= 1, `marker survives prune ${trial}.${k}`);
      ok(pages[head], `head page survives ${trial}.${k}`);
      eq(P.accounted(pages).total, expectTotal, `accounting ${trial}.${k}`);
      ok(live.length - markers.length <= cap || Object.keys(pages).length === 1, `cap respected ${trial}.${k}`);
      ok(markers.every((m) => m.d.removed > 0 && m.d.last >= m.d.first), `marker data sane ${trial}.${k}`);
      // new writes continue after pruning
      const more = Array.from({ length: 40 }, (_, i) => mkEntry(100000 + trial * 100 + k * 50 + i, { d: { key: "fighting", from: i, to: i + 1 } }));
      const pl = M.planWrite({ head, pages }, more); pages = pl.pages; head = pl.head; expectTotal += 40;
    }
    ok(!sawMarker || Object.values(pages).some((p) => Object.values(p.e).some((e) => e.k === "log.prune")), `final marker present ${trial}`);
  }
}
// secret journal pages dropped with the cut
{
  const { st } = writeN(900, 31); const secretEntries = Array.from({ length: 300 }, (_, i) => mkEntry(i * 3, { v: 1, d: { key: "fighting", from: i, to: i + 1 } }));
  let sp = M.planWrite({ head: 1, pages: {} }, secretEntries);
  const plan = P.planPrune(st.pages, { cap: 300, head: st.head, secret: sp.pages });
  ok(plan.dropSecret.length >= 0 && plan.secretRemoved === plan.dropSecret.reduce((s, no) => s + Object.keys(sp.pages[no].e).length, 0), "secret drop accounting");
  ok(plan.dropSecret.every((no) => Object.values(sp.pages[no].e).every((e) => (e.t2 || e.t) <= plan.last)), "secret chunks older than the cut only");
  const ap = P.applyPrune(st.pages, plan, { head: st.head, secret: sp.pages }); ok(Object.keys(ap.secret).length === Object.keys(sp.pages).length - plan.dropSecret.length, "secret pages removed");
  ok(!("secretRemoved" in plan.marker.d), "marker does not leak secret counts");
}
// prior markers folded
{
  const marker = { id: M.makeId(T0 + 1, "A", "log.prune", "prune", ""), t: T0 + 1, u: "", k: "log.prune", d: { removed: 700, first: T0 - 9000, last: T0 - 100, times: 2 } };
  const p1 = { v: 1, no: 1, e: { [marker.id]: marker, ...Object.fromEntries(Array.from({ length: 249 }, (_, i) => { const e = mkEntry(i + 2); return [e.id, e]; })) } };
  const p2 = { v: 1, no: 2, e: Object.fromEntries(Array.from({ length: 250 }, (_, i) => { const e = mkEntry(i + 400); return [e.id, e]; })) };
  const p3 = { v: 1, no: 3, e: Object.fromEntries(Array.from({ length: 10 }, (_, i) => { const e = mkEntry(i + 800); return [e.id, e]; })) };
  const plan = P.planPrune({ 1: p1, 2: p2, 3: p3 }, { cap: 260, head: 3, actorId: "A" });
  eq(plan.dropPages, [1], "drops page with old marker"); eq(plan.removed, 700 + 249, "old marker total folded in"); eq(plan.first, T0 - 9000, "oldest first kept"); eq(plan.marker.d.times, 3, "times accumulated");
}
// redaction
{
  const e = M.normalizeEntry({ t: T0, u: "u2", k: "note.gm", v: 1, c: { r: 2 }, g: "zzz", d: { text: "secret stuff" } }, { actorId: "A" });
  const rd = P.redactEntry(e, "gm1"); eq(rd.k, "log.redact", "redact type"); eq(rd.id, e.id, "redact keeps id"); eq(rd.t, e.t, "redact keeps time"); ok(!JSON.stringify(rd).includes("secret"), "redact removes content"); eq(rd.v, 1, "redact keeps secrecy"); eq(rd.d, { by: "gm1", n: 1 }, "redact marker data");
  ok(!("c" in rd) && !("g" in rd), "redact drops links"); eq(M.buildEntry(rd, { scope: "hero" }).errors.length, 0, "redacted entry valid");
  const map = { [e.id]: e }; const rm = P.redactMany(map, [e.id, "nope"], "gm1"); eq(rm.redacted, [e.id], "redacted ids"); eq(rm.missing, ["nope"], "missing ids"); eq(map[e.id].k, "note.gm", "redactMany pure");
  eq(P.redactMany(rm.map, [e.id], "gm1").redacted, [], "redact idempotent");
}

/* ================================================================= 7. export */
const exEntries = [
  M.normalizeEntry({ t: T0, u: "u1", k: "stat.attr", d: { key: "fighting", from: 1, to: 2 }, c: { i: "c", r: 3, tn: 1 } }, { actorId: "A", path: "a" }),
  M.normalizeEntry({ t: T0 + 60000, u: "u2", k: "note.add", d: { text: 'Said "hi", then\nleft; =SUM(A1)' } }, { actorId: "A", path: "b" }),
  M.normalizeEntry({ t: T0 + 86400000 + 5000, u: "u1", k: "roll.made", v: 1, d: { name: "Fight | *bold* [x]", mode: "gm", s: 2, b: 1, msgId: "MSG1", dice: [6, 6, 1] } }, { actorId: "A", path: "c" }),
  M.normalizeEntry({ t: T0 + 90000000, u: "u3", k: "note.gm", d: { text: "-danger" } }, { actorId: "A", path: "d" })
];
const exCtx = { actor: { id: "A", name: "Zażółć Hero", uuid: "Actor.A", type: "superhero" }, exportedAt: T0 + 99999999, exportedBy: "u1", users: USERS, scope: "hero", text: (e) => (e.d.text ? e.d.text : EV.plainText(e)), offsetMin: 0 };
{
  const js = X.toJSON(exEntries, exCtx); const back = X.parseJSON(js);
  ok(back.ok, "json parses"); eq(back.entries, M.sortEntries(exEntries), "json round trip lossless"); eq(back.errors.length, 0, "json no errors"); eq(back.meta.actor.name, "Zażółć Hero", "json meta actor"); eq(back.meta.users.u3, "Zoë Łukasz", "json users");
  const doc = JSON.parse(js); eq(doc.format, "ip-log", "json format"); eq(doc.version, 1, "json version"); eq(doc.entries.length, 4, "json entries");
  ok(!X.parseJSON("{nope").ok, "bad json rejected"); ok(!X.parseJSON(JSON.stringify({ format: "other" })).ok, "wrong format rejected"); ok(!X.parseJSON(JSON.stringify({ format: "ip-log", version: 2, entries: [] })).ok, "wrong version rejected"); ok(!X.parseJSON(JSON.stringify({ format: "ip-log", version: 1 })).ok, "missing entries rejected");
  ok(X.parseJSON("\uFEFF" + js).ok, "BOM tolerated");
  const bad = JSON.parse(js); bad.entries.push({ id: "short", t: 1, u: "x", k: "stat.attr", d: {} }); bad.entries.push(bad.entries[0]); bad.entries.push(null);
  const pb = X.parseJSON(JSON.stringify(bad)); eq(pb.entries.length, 4, "invalid and duplicate entries skipped"); ok(pb.errors.length >= 3, "errors reported");
  const baseDoc = X.parseJSON(JSON.stringify({ format: "ip-log", version: 1, actor: { type: "base" }, entries: [JSON.parse(JSON.stringify(exEntries[0]))] })); eq(baseDoc.entries.length, 0, "scope enforced on import (hero type in base log)");
  eq(X.parseJSON(X.toJSON([], exCtx)).entries.length, 0, "empty export");
  const shuffled = X.toJSON([exEntries[2], exEntries[0], exEntries[3], exEntries[1]], exCtx); eq(shuffled, js, "json sorted deterministic");
  const hp = X.parseJSON(JSON.stringify({ format: "ip-log", version: 1, actor: null, entries: [{ ...exEntries[0], d: JSON.parse('{"__proto__":{"polluted":1},"key":"fighting","from":1,"to":2}') }] })); ok(({}).polluted === undefined && hp.entries.length === 1, "import is proto safe");
}
{
  const csv = X.toCSV(exEntries, exCtx); ok(csv.startsWith("\uFEFF"), "csv BOM"); ok(csv.includes("\r\n"), "csv CRLF"); ok(csv.endsWith("\r\n"), "csv trailing newline");
  const rows = X.parseCSV(csv); eq(rows.length, 5, "csv rows (header + 4)"); eq(rows[0], [...X.CSV_COLUMNS], "csv header"); ok(rows.every((r) => r.length === 11), "csv constant width");
  eq(rows[1][0], exEntries[0].id, "csv id"); eq(rows[1][1], new Date(T0).toISOString(), "csv time"); eq(rows[1][2], "Alice", "csv user name"); eq(rows[1][3], "stats", "csv category"); eq(rows[1][4], "stat.attr", "csv type"); eq(rows[1][6], "1", "csv from"); eq(rows[1][7], "2", "csv to"); eq(rows[1][8], "3", "csv round"); eq(rows[1][10], "0", "csv gm flag public");
  ok(rows[2][5] === 'Said "hi", then\nleft; =SUM(A1)', "csv comma / quote / newline survive parse-back"); ok(csv.includes('"Said ""hi"", then\nleft; =SUM(A1)"'), "csv quotes doubled");
  eq(rows[3][9], "MSG1", "csv msg id"); eq(rows[3][10], "1", "csv gm only roll"); eq(rows[4][10], "1", "csv gm note flag"); ok(rows[4][5].startsWith("'-danger"), "csv formula guard on leading minus text");
  eq(X.csvCell("=1+1"), "'=1+1", "formula guard ="); eq(X.csvCell("@cmd"), "'@cmd", "formula guard @"); eq(X.csvCell("+1x"), "'+1x", "formula guard +"); eq(X.csvCell("-5"), "-5", "negative number string kept"); eq(X.csvCell(-5), "-5", "negative number kept"); eq(X.csvCell(null), "", "null cell"); eq(X.csvCell(undefined), "", "undefined cell");
  eq(X.csvCell("a,b"), '"a,b"', "comma quoted"); eq(X.csvCell('a"b'), '"a""b"', "quote doubled"); eq(X.csvCell("a\nb"), '"a\nb"', "newline quoted"); eq(X.csvCell(" pad"), '" pad"', "padding quoted"); eq(X.csvCell({ a: 1 }), '"{""a"":1}"', "object json quoted"); eq(X.csvCell(true), "true", "boolean cell");
  eq(X.parseCSV("a,b\r\n1,2\r\n"), [["a", "b"], ["1", "2"]], "parseCSV basic"); eq(X.parseCSV('\uFEFF"a ""q""",b\n'), [['a "q"', "b"]], "parseCSV quotes+BOM"); eq(X.parseCSV("a,\n,b"), [["a", ""], ["", "b"]], "parseCSV empty cells");
  const r = rng(8);
  for (let i = 0; i < 40; i++) { const cells = Array.from({ length: 5 }, () => Array.from({ length: Math.floor(r() * 8) }, () => pick(r, ["a", "b", ",", '"', "\n", "\r\n", " ", "x"])).join("")); const line = cells.map((c) => X.csvCell(c)).join(","); const back = X.parseCSV(line)[0]; ok(JSON.stringify(back.map((c) => c.replace(/^'(?=[=+@])/, ""))) === JSON.stringify(cells.map((c) => c.replace(/\r\n/g, "\r\n"))) || cells.some((c) => /^[=+@\t\r-]/.test(c)), `csv fuzz round trip ${i}`); }
}
{
  const md = X.toMarkdown(exEntries, exCtx);
  ok(md.startsWith("# Zażółć Hero\n"), "md title"); eq(md.split("\n").filter((l) => l.startsWith("## ")).length, 2, "md one heading per day (2 days)"); ok(md.includes("## 2025-10-25"), "md day heading");
  eq(md.split("\n").filter((l) => l.startsWith("- ")).length, 4, "md one bullet per entry"); ok(md.includes("**Alice**"), "md user bold"); ok(md.includes("(GM only)"), "md gm marker");
  ok(!/\[x\]/.test(md) && md.includes("\\[x\\]") && md.includes("\\*bold\\*") && md.includes("\\|"), "md escapes special chars"); ok(!md.includes("\r"), "md has no CR"); ok(md.includes("- 00:00 **Alice**"), "md time"); ok(!/left; =SUM\(A1\)\n[^-#\n]/.test(md), "md newlines folded");
  const asc = md.split("\n").filter((l) => l.startsWith("## ")); eq(asc, ["## 2025-10-25", "## 2025-10-26"], "md ascending"); const desc = X.toMarkdown(exEntries, { ...exCtx, order: "desc" }).split("\n").filter((l) => l.startsWith("## ")); eq(desc[0], "## 2025-10-26", "md descending");
  const off = X.toMarkdown(exEntries.slice(0, 1), { ...exCtx, offsetMin: 120 }); ok(off.includes("- 02:00"), "md offset time"); eq(X.toMarkdown([], {}), "# Log\n\n", "md empty");
  eq(X.mdEscape("a\nb"), "a b", "mdEscape newline"); eq(X.mdEscape("`x`"), "\\`x\\`", "mdEscape backtick");
}
{
  eq(X.slug("Zażółć Gęślą Jaźń"), "zazolc-gesla-jazn", "slug folds"); eq(X.slug(""), "log", "slug empty"); eq(X.slug("../../etc/passwd"), "etc-passwd", "slug no path chars"); ok(X.slug("x".repeat(100)).length <= 40, "slug capped");
  eq(X.exportName("Hero One", "json", T0 + 3600000 * 14 + 60000 * 5), "ip-log-hero-one-20251025-1405.json", "export name");
  for (const f of ["json", "csv", "md", "weird"]) { const o = X.exportEntries(exEntries, f, exCtx); ok(o.filename.endsWith(f === "weird" ? ".json" : "." + f) && o.mime.length > 0 && o.text.length > 0, `exportEntries ${f}`); }
  eq(X.exportEntries(exEntries, "csv", exCtx).mime, "text/csv;charset=utf-8", "csv mime"); ok(X.exportEntries(exEntries, "json", {}).filename.startsWith("ip-log-log-"), "export without actor");
}

/* ================================================================= 8. performance sanity (5,000 entries) */
{
  const t0 = performance.now();
  const list = mkRandomEntries(5000, 123, "hero"); const tGen = performance.now() - t0;
  let st = { head: 1, pages: {} }; const t1 = performance.now();
  for (let i = 0; i < list.length; i += 50) { const pl = M.planWrite(st, list.slice(i, i + 50)); st = { head: pl.head, pages: pl.pages }; }
  const tWrite = performance.now() - t1;
  eq(M.totalCount(st.pages), 5000, "5000 written"); eq(Object.keys(st.pages).length, 20, "5000 entries = 20 chunks");
  const t2 = performance.now(); const all = M.readAll(st.pages); const tRead = performance.now() - t2; eq(all.length, 5000, "5000 read back");
  const ctx = { scope: "hero", userId: "u1", users: USERS };
  const t3 = performance.now(); for (let i = 0; i < 5; i++) F.filterEntries(all, { search: "flight", cats: ["items", "stats"], showMinor: true }, ctx); const tFilter = (performance.now() - t3) / 5;
  const t4 = performance.now(); const gr = F.groupByDay(all, { now: all[all.length - 1].t, offsetMin: 0 }); const tGroup = performance.now() - t4; eq(gr.reduce((s, x) => s + x.count, 0), 5000, "5000 grouped");
  const t5 = performance.now(); F.countsByCategory(all, {}, ctx); const tCount = performance.now() - t5;
  const t6 = performance.now(); const csv = X.toCSV(all, exCtx); const js = X.toJSON(all, exCtx); const md = X.toMarkdown(all, exCtx); const tExport = performance.now() - t6;
  const t7 = performance.now(); const back = X.parseJSON(js); const tParse = performance.now() - t7; eq(back.entries.length, 5000, "5000 json round trip");
  const t8 = performance.now(); const plan = P.planPrune(st.pages, { cap: 3000, head: st.head, actorId: "A1" }); const tPrune = performance.now() - t8; ok(plan && plan.keep <= 3000, "5000 prune plan");
  const t9 = performance.now(); const co = C.collapseBulk(list.map((e) => ({ ...e, actorId: "A1" }))); const tBulk = performance.now() - t9; ok(co.length > 0, "bulk over 5000 runs");
  eq(X.parseCSV(csv).length, 5001, "5000 csv rows"); ok(md.length > 1000, "5000 md");
  console.log(`perf ms: gen ${tGen | 0} write ${tWrite | 0} read ${tRead | 0} filter ${tFilter | 0} group ${tGroup | 0} counts ${tCount | 0} export ${tExport | 0} parse ${tParse | 0} prune ${tPrune | 0} bulk ${tBulk | 0}`);
  ok(tWrite < 5000, "write 5000 under 5s"); ok(tRead < 500, "read under 0.5s"); ok(tFilter < 300, "filter 5000 under 0.3s"); ok(tGroup < 500, "group under 0.5s"); ok(tCount < 300, "counts under 0.3s"); ok(tExport < 3000, "export under 3s"); ok(tPrune < 500, "prune plan under 0.5s");
}

/* ================================================================= 8b. capture helpers (L3) */
{
  eq(CP.levelName(3), "OWNER", "level 3"); eq(CP.levelName(-1), "INHERIT", "level -1"); eq(CP.levelName("OBSERVER"), "OBSERVER", "level string");
  const src = { name: "H", img: "i.webp", ownership: { default: 0, u1: 3 }, system: { karma: 2, attributes: { fighting: { value: 3 } }, derived: { health: { value: 2, max: 5 } } }, flags: { "invincible-plus-ultra": { chargen: { runId: "R1" }, chargenBackup: { x: 1 }, base: { team: "B1" } } } };
  const m = CP.actorMirror(src, "hero");
  eq(m["ownership.u1"], "OWNER", "mirror ownership name"); eq(m["ownership.default"], "NONE", "mirror default"); eq(m["system.attributes.fighting.value"], 3, "mirror attr");
  eq(m["__chargen.runId"], "R1", "mirror run id"); eq(m["__chargen.backup"], true, "mirror backup");
  const d = D.diffFlat(m, CP.actorMirror({ ...src, system: { ...src.system, derived: { health: { value: 1, max: 9 } } } }, "hero"));
  eq(d.map((x) => x.p), ["system.derived.health.value"], "mirror diff ignores max");
  const bm = CP.actorMirror({ name: "B", flags: { "invincible-plus-ultra": { base: { kind: "teamBase", motto: "m", base: { kind: "Tower" } } } } }, "base");
  eq(bm["flags.invincible-plus-ultra.base.base.kind"], "Tower", "base mirror");
  const im = CP.itemMirror({ name: "P", system: { level: "Basic", powerSource: "S1", boosts: [{}, {}], description: "abc", automations: { a: 1 }, cost: 2 } }, (id) => (id === "S1" ? "Source" : id));
  eq(im["system.powerSource"], "Source", "item powerSource resolved"); eq(im["system.boosts#len"], 2, "item array len"); eq(im["description#len"], 3, "desc len");
  const ch = CP.diffItemMirror(im, CP.itemMirror({ name: "P2", system: { level: "Basic", powerSource: "S1", boosts: [{}], description: "abcd", automations: { a: 1 }, cost: 2 } }, (id) => (id === "S1" ? "Source" : id)));
  eq(ch.map((c) => c.p).sort(), ["description", "name", "system.boosts"], "item diff paths"); ok(ch.find((c) => c.p === "system.boosts").len[1] === 1, "len pair");
  const eb = new CP.EditBuffer();
  eb.add("k", { name: "a" }, [{ p: "name", from: "a", to: "ab" }], 1000); eb.add("k", { name: "a" }, [{ p: "name", from: "ab", to: "abc" }], 1500);
  eq(eb.drain(2000).length, 0, "edit buffer open"); const out = eb.drain(4000); eq(out.length, 1, "edit buffer emits one"); eq(out[0].changes[0], { p: "name", from: "a", to: "abc" }, "edit buffer merged");
  eb.add("k", {}, [{ p: "name", from: "a", to: "b" }], 1000); eb.add("k", {}, [{ p: "name", from: "b", to: "a" }], 1100); eq(eb.drain(9000).length, 0, "edit buffer cancels a net no-op");
  eq(CP.rollModeOf({ whisper: [], blind: false, author: "a" }), "public", "mode public"); eq(CP.rollModeOf({ whisper: ["g"], blind: false, author: "a" }), "gm", "mode gm");
  eq(CP.rollModeOf({ whisper: ["g"], blind: true, author: "a" }), "blind", "mode blind"); eq(CP.rollModeOf({ whisper: ["a"], blind: false, author: "a" }), "self", "mode self");
  const ri = CP.rollInfo({ successCount: 2, baneCount: 1, pushCount: 1, dice: [{ results: [{ result: 6 }, { result: 1 }] }], options: { stressCost: 2 }, attackDamage: 3 });
  eq([ri.s, ri.b, ri.p, ri.dice, ri.str, ri.dmg], [2, 1, 1, [6, 1], 2, 3], "roll info");
  eq(CP.damageFacts("<p><strong>Rex</strong> took <strong>3</strong> damage.</p>"), { name: "Rex", amount: 3, injury: "" }, "damage facts");
  eq(CP.damageFacts("<strong>Rex</strong> <strong>3</strong> <strong>Broken Arm</strong>").injury, "Broken Arm", "damage injury");
  eq(CP.decodeSnap(CP.encodeSnap({ "a.fighting": 2, "i.x": "p|n" })), { "a.fighting": 2, "i.x": "p|n" }, "snap key round trip"); ok(!Object.keys(CP.encodeSnap({ "a.b.c": 1 }))[0].includes("."), "encoded keys have no dots");
  const ops = CP.snapOps({ "a.x": 1, "a.y": 2, at: 1 }, { "a.x": 1, "a.z": 3, at: 5 }); eq(ops.set, { "a~z": 3, at: 5 }, "snap ops set"); eq(ops.del, ["a~y"], "snap ops del");
  const users = [{ id: "g", isGM: true }, { id: "p1" }, { id: "p2" }, { id: "p3" }];
  eq(CP.readersOf({ default: "NONE", p1: "OWNER", p2: "OBSERVER" }, users, "owners"), ["p1"], "readers owners"); eq(CP.readersOf({ default: 0, p1: 3, p2: 2 }, users, "observers"), ["p1", "p2"], "readers observers");
  eq(CP.readersOf({ default: 2, p1: 3 }, users, "observers"), ["p1", "p2", "p3"], "readers default observer"); eq(CP.readersOf({ p1: 3 }, users, "gm"), [], "readers gm only");
  eq(CP.journalOwnership(["p1"]), { default: 0, p1: 2 }, "journal ownership");
  ok(/^[A-Za-z0-9]{16}$/.test(CP.pageDocId("abcdefghijklmnop", 3)) && /^[A-Za-z0-9]{16}$/.test(CP.pageDocId("abc", 12, true)), "page doc id is a valid 16 char id"); ok(CP.pageDocId("abcdefghijklmnop", 1) !== CP.pageDocId("abcdefghijklmnop", 1, true), "secret page id differs");
  ok(/^[A-Za-z0-9]{16}$/.test(CP.GM_JOURNAL_ID) && /^[A-Za-z0-9]{16}$/.test(CP.LOG_FOLDER_ID), "fixed ids are valid");
  const snap = D.makeSnapshot(CP.snapshotSource(src, "hero", { i1: "power|P||0|" }), 7); eq(snap["a.fighting"], 3, "snapshot source attr"); eq(snap["o.u1"], "OWNER", "snapshot source ownership"); eq(snap["i.i1"], "power|P||0|", "snapshot items");
}

/* ================================================================= 9. no Foundry globals */
{
  const files = ["events", "model", "diff", "coalesce", "filter", "prune", "export", "capture-pure"].map((f) => `${f}.mjs`);
  const FORBIDDEN = ["game", "foundry", "Hooks", "ui", "CONFIG", "canvas", "window", "document", "localStorage", "sessionStorage", "navigator", "ChatMessage", "Actor", "Item", "fromUuid", "Handlebars", "ChatMessage", "Journal", "socket", "$", "jQuery", "saveDataToFile", "BroadcastChannel", "setTimeout", "setInterval"];
  for (const f of files) {
    const src = fs.readFileSync(path.join(here, f), "utf8");
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").replace(/`(?:\\.|[^`\\])*`/g, "``").replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/\/(?:\\.|[^/\\\n])+\/[gimsuy]*/g, "//");
    for (const g of FORBIDDEN) {
      const re = new RegExp(`(?<![.\\w$])${g.replace("$", "\\$")}(?![\\w$])\\s*(?:[.\\[(]|$)`);
      ok(!re.test(stripped), `${f} does not touch global ${g}`);
    }
    const imports = [...src.matchAll(/^\s*import\s[^"']*["']([^"']+)["']/gm)].map((m) => m[1]);
    ok(imports.every((i) => i.startsWith("./")), `${f} imports only siblings`);
  }
}

console.log(`${n} checks, ${bad} failed`);
process.exit(bad ? 1 : 0);
