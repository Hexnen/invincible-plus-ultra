/* Character-creation roll tables builder (phase 3c of the character generator, dev/chargen-handoff.md).
   The Invincible core book (module invincible-core, compendium core-book, chapter "2: Your Superhero") lists many "choose or roll"
   options (archetypes, roles, occupations, per-archetype power sources / talents / drawbacks / ..., per-occupation talents and
   key relationships, team names ...) that are NOT RollTables in the compendium. build() reads those lists from the installed book
   AT RUNTIME and turns them into real RollTables stored in OUR compendium pack "invincible-plus-ultra.chargen-tables" (module.json packs entry, gitignored,
   filled at runtime on the user's disk; subfolders By archetype / By occupation / Team base by rank). No book text is stored in
   this module: everything below is structure (page names, labels, how to split a list), the text comes from the book on the
   user's machine.

   API (also at game.modules.get("invincible-plus-ultra").api.chargen.tables):
     build({force})   create / update the tables. Idempotent: every table carries flags["invincible-plus-ultra"].chargen =
                      { v, key, source, hash }. Re-running updates in place (never duplicates). A table whose content no longer
                      matches the stored hash was EDITED by the user: it is skipped (reported) unless force:true.
     status()         what exists / is outdated / edited / missing, and whether the book can be parsed. Creates nothing.
     remove({force})  delete the module's tables and its (empty) folders; edited tables are kept unless force:true.
     getTable(key)    the compendium RollTable for a stable key (async), or null.   roll(key)  table.roll() -> { name, description, flags, table }
     importToWorld(keys?)  optional: copy tables into the world.
     keys()           all stable keys the current book yields.
   Stable keys: "archetypes", "roles", "occupations", "team-names", "base-upgrades", "team-base.<teen|street|global|cosmic>",
   "archetype.<slug>.<source|talent|drawback|occupation|personality|drive|flaw|heroname>", "occupation.<slug>.<talent|relationship>".
   Dice: the formula is 1d<N> for N entries (the book's D3 / D6; 1d16 archetypes, 1d22 occupations). Personality: the book rolls 2D6
   as TWO separate D6 picks of two different words, so the table is 1d6 and you roll it twice.
   Rolls use table.roll() only (never draw(): no chat message). Needs the Game Master (it unlocks the pack for the write and locks it again). */
import { t } from "./tables-lang.mjs";

const MODULE_ID = "invincible-plus-ultra";
const BOOK_PACK = "invincible-core.core-book";
const TABLE_PACK = "invincible-plus-ultra.chargen-tables"; // declared in module.json (packs), filled at runtime by build(), gitignored
const BOOK_JOURNAL_ID = "Rbx4P6GQT5EoFNUG"; // "2: Your Superhero"; pages are looked up by NAME first, by id as a fallback
const PAGES = {
  archetypes: { name: "Archetypes", id: "0FCrBQzpjPzPkxWi" },
  roles: { name: "Archetype", id: "frBt1sEIFzmSNYLk" },
  occupations: { name: "Occupation", id: "0YDxkdD5Fw55l8ig" },
  team: { name: "Team", id: "SPsGAK5G5YYdG0Xy" }
};
const DATA_VERSION = 1;

/* per-archetype lists: [key, label the book prints, table title, expected entries] */
const ARCH_LISTS = [
  ["source", "Power Source", "Power source", 3],
  ["talent", "Hero Talent", "Hero talent", 6],
  ["drawback", "Drawbacks", "Drawback", 6],
  ["occupation", "Occupation", "Occupation", 3],
  ["personality", "Personality", "Personality word", 6],
  ["heroname", "Hero Name", "Hero name", 3]
];
const ARCH_OL = [["drive", "Drive", "Drive", 3], ["flaw", "Flaw", "Flaw", 3]];
const RANK_KEYS = [["teen", /^teen/i], ["street", /^street/i], ["global", /^global/i], ["cosmic", /^cosmic/i]];
const EXPECT = { archetypes: 16, roles: 8, occupations: 22, "occupation talent": 3, "occupation relationship": 3 };

/* ------------------------------------------------------------------ small helpers */
class StructureError extends Error {
  constructor(issues) { super(issues.join(" | ")); this.name = "StructureError"; this.issues = issues; }
}
const clean = (s) => String(s ?? "").replace(/[ ­]/g, " ").replace(/\s+/g, " ").trim();
const slug = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const UUID_RE = /@UUID\[([^\]]+)\]\{([^}]+)\}/;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function normUuid(u) { // legacy "Compendium.scope.pack.<16 id>" -> "Compendium.scope.pack.Item.<id>"
  const m = /^Compendium\.([^.]+)\.([^.]+)\.([A-Za-z0-9]{16})$/.exec(u);
  return m ? `Compendium.${m[1]}.${m[2]}.Item.${m[3]}` : u;
}

/* cyrb53 string hash: used only to detect "edited by the user"; stores no text */
function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/* "head" = the leading bold span of a paragraph, "rest" = everything else */
function lead(p) {
  const c = p.cloneNode(true);
  const sp = c.firstElementChild;
  const first = [...c.childNodes].find((n) => clean(n.textContent));
  if (sp && sp === first && sp.tagName === "SPAN") {
    const head = clean(sp.textContent);
    sp.remove();
    return { head, rest: clean(c.textContent) };
  }
  return { head: "", rest: clean(c.textContent) };
}

/* "1. A, 2. B, 3. C" -> [{ name, uuid? }]; markers must run 1,2,3... in order */
function splitNumbered(raw) {
  const s = clean(raw).replace(/\(?\[\[[^\]]*\]\]\)?/g, " ");
  const marks = [];
  let from = 0;
  for (let n = 1; ; n++) {
    const m = new RegExp(`(?:^|[\\s,;(])${n}\\.\\s`).exec(s.slice(from));
    if (!m) break;
    const start = from + m.index;
    marks.push({ start, end: start + m[0].length });
    from = start + m[0].length;
  }
  const out = [];
  marks.forEach((mk, i) => {
    const chunk = s.slice(mk.end, i + 1 < marks.length ? marks[i + 1].start : s.length).replace(/[,;\s]+$/g, "");
    const link = UUID_RE.exec(chunk);
    if (link) out.push({ name: clean(link[2]), uuid: normUuid(link[1]) });
    else out.push({ name: clean(chunk.replace(/Check Knowledgeable Subjects/i, "")) });
  });
  return out.filter((x) => x.name);
}

/* nearest following sibling box (div.box) before the next heading of the same level */
function boxAfter(h) {
  for (let el = h.nextElementSibling; el && el.tagName !== h.tagName; el = el.nextElementSibling) {
    if (el.matches?.("div.box") || el.querySelector?.("div.box")) return el.matches("div.box") ? el : el.querySelector("div.box");
  }
  return null;
}
function paraStarting(box, label) {
  const l = label.toLowerCase();
  return [...box.querySelectorAll("p")].find((p) => clean(p.textContent).toLowerCase().startsWith(l)) ?? null;
}
function entryResult(it) {
  return { name: it.name, description: it.uuid ? `<p>@UUID[${it.uuid}]{${esc(it.name)}}</p>` : "", flags: it.uuid ? { uuid: it.uuid } : {} };
}
function liResult(li) { // <li><p><span bold>Headline.</span> sentence</p></li>
  const { head, rest } = lead(li.querySelector("p") ?? li);
  const name = clean(head.replace(/[.:]+$/, ""));
  return { name, description: rest ? `<p>${esc(rest)}</p>` : "", flags: {} };
}
function olAfter(p) {
  const ol = p?.nextElementSibling;
  return ol && ol.tagName === "OL" ? [...ol.querySelectorAll(":scope > li")].map(liResult).filter((r) => r.name) : [];
}
function listAfterHeading(doc, title) {
  const h = [...doc.querySelectorAll("h2")].find((x) => clean(x.textContent).toLowerCase() === title.toLowerCase());
  if (!h) return null;
  for (let el = h.nextElementSibling; el && el.tagName !== "H2"; el = el.nextElementSibling) {
    const ul = el.tagName === "UL" ? el : el.querySelector?.("ul");
    if (ul) return [...ul.querySelectorAll(":scope > li")].map((li) => clean(li.textContent)).filter(Boolean);
  }
  return null;
}

/* ------------------------------------------------------------------ book access */
function bookPack() { return game.packs.get(BOOK_PACK) ?? null; }

async function loadPages() {
  const pack = bookPack();
  if (!pack) { const e = new Error(t("IPCT.Err.NoBook")); e.code = "nobook"; throw e; }
  let journal = null;
  try { journal = await pack.getDocument(BOOK_JOURNAL_ID); } catch (_) { /* fall through */ }
  if (!journal) { // fallback: a journal that has the pages we need, found by its page names
    const idx = await pack.getIndex();
    for (const entry of idx) { // the book has few journals (9)
      const j = await pack.getDocument(entry._id);
      if (j.pages.some((p) => p.name === PAGES.archetypes.name) && j.pages.some((p) => p.name === PAGES.occupations.name)) { journal = j; break; }
    }
  }
  if (!journal) { const e = new Error(t("IPCT.Err.NoBook")); e.code = "nobook"; throw e; }
  const docs = {}, sources = {}, issues = [];
  for (const [k, def] of Object.entries(PAGES)) {
    const page = journal.pages.find((p) => p.name === def.name) ?? journal.pages.get(def.id);
    const html = page?.text?.content;
    if (!html) { issues.push(`page "${def.name}" missing or empty`); continue; }
    docs[k] = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html").body.firstElementChild;
    sources[k] = `Compendium.${BOOK_PACK}.JournalEntry.${journal.id}.JournalEntryPage.${page.id}`;
  }
  if (issues.length) throw new StructureError(issues);
  return { docs, sources };
}

/* ------------------------------------------------------------------ parsing -> table specs */
export function parseBook(docs, sources) {
  const issues = [], warnings = [], specs = [], folders = new Map();
  const folder = (key, name, parent) => { if (!folders.has(key)) folders.set(key, { key, name, parent: parent ?? null }); return key; };
  folder("archetype", t("IPCT.Folder.Archetype"), null);
  folder("occupation", t("IPCT.Folder.Occupation"), null);
  folder("teambase", t("IPCT.Folder.TeamBase"), null);

  const add = (spec, expected) => {
    if (spec.results.length < 2) { issues.push(`${spec.name}: only ${spec.results.length} entries found`); return; }
    if (expected && spec.results.length !== expected) warnings.push(t("IPCT.Warn.Count", { list: spec.name, expected, found: spec.results.length }));
    spec.formula = `1d${spec.results.length}`;
    specs.push(spec);
  };

  /* archetypes + their lists */
  const archs = [];
  for (const h of docs.archetypes.querySelectorAll("h2")) {
    const name = clean(h.textContent).replace(/^The\s+/i, "");
    const box = boxAfter(h);
    if (!name || !box) { issues.push(`archetype "${name || "?"}": no stat box`); continue; }
    const rolePara = paraStarting(box, "Role");
    archs.push({ name, slug: slug(name), box, role: rolePara ? lead(rolePara).rest : "" });
  }
  if (!archs.length) issues.push("no archetypes found on the Archetypes page");
  add({ key: "archetypes", name: "Archetype", folder: null, source: sources.archetypes,
    results: archs.map((a) => ({ name: a.name, description: "", flags: { role: a.role } })) }, EXPECT.archetypes);
  for (const a of archs) {
    const fk = folder(`archetype.${a.slug}`, a.name, "archetype");
    for (const [key, label, title, exp] of ARCH_LISTS) {
      const p = paraStarting(a.box, label);
      const items = p ? splitNumbered(lead(p).rest) : [];
      if (!p) issues.push(`archetype ${a.name}: list "${label}" not found`);
      add({ key: `archetype.${a.slug}.${key}`, name: `${a.name} - ${title}`, folder: fk, source: sources.archetypes, results: items.map(entryResult) }, exp);
    }
    for (const [key, label, title, exp] of ARCH_OL) {
      const p = [...a.box.querySelectorAll("p")].find((q) => clean(q.textContent).toLowerCase().startsWith(label.toLowerCase()) && q.nextElementSibling?.tagName === "OL");
      if (!p) issues.push(`archetype ${a.name}: list "${label}" not found`);
      add({ key: `archetype.${a.slug}.${key}`, name: `${a.name} - ${title}`, folder: fk, source: sources.archetypes, results: olAfter(p) }, exp);
    }
  }

  /* roles (page "Archetype", heading Role, a bullet list) */
  const roleH = [...docs.roles.querySelectorAll("h2")].find((x) => clean(x.textContent).toLowerCase() === "role");
  const roleUl = roleH && (() => { for (let el = roleH.nextElementSibling; el && el.tagName !== "H2"; el = el.nextElementSibling) if (el.tagName === "UL") return el; return null; })();
  if (!roleUl) issues.push("roles list not found on the Archetype page");
  add({ key: "roles", name: "Role", folder: null, source: sources.roles, results: roleUl ? [...roleUl.querySelectorAll(":scope > li")].map(liResult).filter((r) => r.name) : [] }, EXPECT.roles);

  /* occupations + their talents and key relationships */
  const occs = [];
  for (const h of docs.occupations.querySelectorAll("h2")) {
    const name = clean(h.textContent);
    const box = boxAfter(h);
    if (!name || !box) { issues.push(`occupation "${name || "?"}": no stat box`); continue; }
    const resP = paraStarting(box, "Resources");
    const res = resP ? parseInt(lead(resP).rest, 10) : NaN;
    occs.push({ name, slug: slug(name), box, resources: Number.isFinite(res) ? res : null });
  }
  if (!occs.length) issues.push("no occupations found on the Occupation page");
  add({ key: "occupations", name: "Occupation", folder: null, source: sources.occupations,
    results: occs.map((o) => ({ name: o.name, description: "", flags: { resources: o.resources } })) }, EXPECT.occupations);
  for (const o of occs) {
    const fk = folder(`occupation.${o.slug}`, o.name, "occupation");
    const tp = paraStarting(o.box, "Occupation Talent");
    const tItems = tp?.nextElementSibling ? splitNumbered(tp.nextElementSibling.textContent) : [];
    if (!tp) issues.push(`occupation ${o.name}: talent list not found`);
    add({ key: `occupation.${o.slug}.talent`, name: `${o.name} - Occupation talent`, folder: fk, source: sources.occupations, results: tItems.map(entryResult) }, EXPECT["occupation talent"]);
    const rp = paraStarting(o.box, "Key Relationship");
    if (!rp) issues.push(`occupation ${o.name}: key relationship list not found`);
    add({ key: `occupation.${o.slug}.relationship`, name: `${o.name} - Key relationship`, folder: fk, source: sources.occupations, results: olAfter(rp) }, EXPECT["occupation relationship"]);
  }

  /* team page: team names, starting-upgrade suggestions, base locations by rank */
  const names = listAfterHeading(docs.team, "Team Name");
  if (!names) issues.push("team name list not found on the Team page");
  add({ key: "team-names", name: "Team name", folder: null, source: sources.team, results: (names ?? []).map((n) => ({ name: n, description: "", flags: {} })) });
  const ups = listAfterHeading(docs.team, "Base Upgrades");
  if (!ups) issues.push("base upgrade list not found on the Team page");
  add({ key: "base-upgrades", name: "Team base upgrade (suggested)", folder: null, source: sources.team, results: (ups ?? []).map((n) => ({ name: n, description: "", flags: {} })) });
  const rows = [...docs.team.querySelectorAll("table tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => clean(td.textContent)));
  const rankRows = rows.filter((r) => r.length >= 2 && RANK_KEYS.some(([, re]) => re.test(r[0])));
  if (rankRows.length !== 4) issues.push(`team base table: expected 4 rank rows, found ${rankRows.length}`);
  for (const r of rankRows) {
    const rk = RANK_KEYS.find(([, re]) => re.test(r[0]))[0];
    const locs = r[1].split(/\s*,\s*/).map(clean).filter(Boolean);
    add({ key: `team-base.${rk}`, name: `Team base location - ${r[0]}`, folder: "teambase", source: sources.team, results: locs.map((n) => ({ name: n, description: "", flags: {} })) });
  }

  if (issues.length) throw new StructureError(issues);
  /* ranges, hash */
  for (const s of specs) {
    s.results.forEach((r, i) => { r.range = [i + 1, i + 1]; });
    s.hash = hash(canon(s.name, s.formula, s.results.map((r) => [r.range[0], r.range[1], r.name, r.description, 1, "text", ""])));
  }
  return { specs, folders: [...folders.values()], warnings };
}

/* canonical form of a table's user-visible content (name, formula, results) */
function canon(name, formula, rows) { return JSON.stringify([name, formula, rows]); }
function tableHash(table) {
  const rows = table.results.contents
    .map((r) => [r.range[0], r.range[1], r.name, r.description, r.weight, r.type, r.documentUuid ?? ""])
    .sort((a, b) => a[0] - b[0]);
  return hash(canon(table.name, table.formula, rows));
}

/* ------------------------------------------------------------------ pack side */
const metaOf = (doc) => doc?.flags?.[MODULE_ID]?.chargen ?? null;
function requireGM() { if (!game.user?.isGM) { const e = new Error(t("IPCT.Err.NotGM")); e.code = "notgm"; throw e; } }
function getPack() {
  const pack = game.packs.get(TABLE_PACK);
  if (!pack) { const e = new Error(t("IPCT.Err.NoPack")); e.code = "nopack"; throw e; }
  return pack;
}
/* run fn(pack) with the pack unlocked, then lock it again if it was locked */
async function withUnlocked(fn) {
  const pack = getPack();
  const wasLocked = pack.locked;
  if (wasLocked) await pack.configure({ locked: false });
  try { return await fn(pack); }
  finally { if (wasLocked) await pack.configure({ locked: true }).catch((err) => console.warn(`${MODULE_ID} | could not re-lock ${TABLE_PACK}`, err)); }
}
const packTables = async (pack) => (await pack.getDocuments()).filter((x) => metaOf(x)?.key);
const packFolders = (pack) => pack.folders.contents.filter((f) => f.flags?.[MODULE_ID]?.chargenFolder);

async function ensureFolders(pack, defs) {
  const byKey = new Map(packFolders(pack).map((f) => [f.flags[MODULE_ID].chargenFolder, f]));
  const order = [];
  const visit = (d) => { if (order.includes(d)) return; if (d.parent) visit(defs.find((x) => x.key === d.parent)); order.push(d); };
  defs.forEach(visit);
  for (const d of order) {
    if (byKey.has(d.key)) continue;
    const parent = d.parent ? byKey.get(d.parent) : null;
    const f = await Folder.implementation.create({ name: d.name, type: "RollTable", folder: parent?.id ?? null, flags: { [MODULE_ID]: { chargenFolder: d.key } } }, { pack: pack.collection });
    byKey.set(d.key, f);
  }
  return byKey;
}

const resultData = (r) => ({ type: "text", name: r.name, description: r.description ?? "", range: r.range, weight: 1, drawn: false, flags: { [MODULE_ID]: r.flags ?? {} } });
const metaFor = (s) => ({ v: DATA_VERSION, key: s.key, source: s.source, hash: s.hash });

async function parseNow() {
  try {
    const { docs, sources } = await loadPages();
    return parseBook(docs, sources);
  } catch (err) {
    if (err instanceof StructureError) {
      const e = new Error(t("IPCT.Err.Structure", { details: err.issues.join("; ") }));
      e.code = "structure"; e.issues = err.issues;
      throw e;
    }
    throw err;
  }
}

/* ------------------------------------------------------------------ public API */
export async function build({ force = false } = {}) {
  requireGM();
  getPack(); // fail early (clear message) when the pack is not registered yet (needs a Foundry restart after the module update)
  const { specs, folders, warnings } = await parseNow();
  return withUnlocked(async (pack) => {
    const fmap = await ensureFolders(pack, folders);
    const existing = new Map((await packTables(pack)).map((x) => [metaOf(x).key, x]));
    const rep = { created: [], updated: [], unchanged: [], skipped: [], orphans: [], warnings, total: specs.length };
    const toCreate = [];
    for (const s of specs) {
      const cur = existing.get(s.key);
      if (!cur) {
        toCreate.push({ name: s.name, formula: s.formula, replacement: true, displayRoll: true, folder: s.folder ? fmap.get(s.folder)?.id ?? null : null,
          results: s.results.map(resultData), flags: { [MODULE_ID]: { chargen: metaFor(s) } } });
        rep.created.push(s.key);
        continue;
      }
      const m = metaOf(cur);
      const edited = tableHash(cur) !== m.hash;
      if (edited && !force) { rep.skipped.push(s.key); continue; }
      if (!edited && m.hash === s.hash && m.v === DATA_VERSION) { rep.unchanged.push(s.key); continue; }
      await cur.update({ name: s.name, formula: s.formula, replacement: true, displayRoll: true, [`flags.${MODULE_ID}.chargen`]: metaFor(s) });
      await cur.deleteEmbeddedDocuments("TableResult", cur.results.map((r) => r.id));
      await cur.createEmbeddedDocuments("TableResult", s.results.map(resultData));
      rep.updated.push(s.key);
    }
    for (let i = 0; i < toCreate.length; i += 25) await RollTable.implementation.createDocuments(toCreate.slice(i, i + 25), { pack: pack.collection });
    const keys = new Set(specs.map((s) => s.key));
    rep.orphans = [...existing.keys()].filter((k) => !keys.has(k));
    rep.message = t("IPCT.Done.Build", { created: rep.created.length, updated: rep.updated.length, unchanged: rep.unchanged.length, skipped: rep.skipped.length });
    return rep;
  });
}

export async function status() {
  const pack = game.packs.get(TABLE_PACK) ?? null;
  const out = { pack: pack ? { id: pack.collection, locked: pack.locked } : null, bookInstalled: !!bookPack(), bookOk: false, error: null, issues: [], expected: 0, built: 0, missing: [], outdated: [], edited: [], orphans: [], folders: pack ? packFolders(pack).length : 0 };
  if (!pack) { out.error = t("IPCT.Err.NoPack"); return out; }
  const have = new Map((await packTables(pack)).map((x) => [metaOf(x).key, x]));
  out.built = have.size;
  try {
    const { specs } = await parseNow();
    out.bookOk = true; out.expected = specs.length;
    for (const s of specs) {
      const cur = have.get(s.key);
      if (!cur) { out.missing.push(s.key); continue; }
      const m = metaOf(cur);
      if (tableHash(cur) !== m.hash) out.edited.push(s.key);
      else if (m.hash !== s.hash || m.v !== DATA_VERSION) out.outdated.push(s.key);
    }
    const keys = new Set(specs.map((s) => s.key));
    out.orphans = [...have.keys()].filter((k) => !keys.has(k));
  } catch (err) {
    out.error = err.message; out.issues = err.issues ?? [];
  }
  return out;
}

export async function remove({ force = false } = {}) {
  requireGM();
  getPack();
  return withUnlocked(async (pack) => {
    const del = [], kept = [];
    for (const x of await packTables(pack)) (!force && tableHash(x) !== metaOf(x).hash ? kept : del).push(x);
    if (del.length) await RollTable.implementation.deleteDocuments(del.map((x) => x.id), { pack: pack.collection });
    /* folders: deepest first, only when nothing else lives in them */
    const remaining = await pack.getIndex({ fields: ["folder"] });
    const used = new Set(remaining.map((e) => e.folder).filter(Boolean));
    let removedFolders = 0;
    const depth = (f) => { let d = 0; for (let p = f.folder; p; p = p.folder) d++; return d; };
    for (const f of packFolders(pack).sort((a, b) => depth(b) - depth(a))) {
      const hasChild = pack.folders.contents.some((g) => g.folder?.id === f.id);
      if (!used.has(f.id) && !hasChild) { await f.delete({ pack: pack.collection }); removedFolders++; }
    }
    return { removed: del.length, kept: kept.map((x) => metaOf(x).key), foldersRemoved: removedFolders, message: t("IPCT.Done.Remove", { removed: del.length, kept: kept.length }) };
  });
}

/* the RollTable (a compendium document, readable by players) for a stable key, or null. Index lookup first: no full pack load. */
export async function getTable(key) {
  const pack = game.packs.get(TABLE_PACK);
  if (!pack) return null;
  const idx = await pack.getIndex({ fields: [`flags.${MODULE_ID}.chargen.key`] });
  const e = idx.find((x) => x.flags?.[MODULE_ID]?.chargen?.key === key);
  return e ? pack.getDocument(e._id) : null;
}

export async function roll(key) {
  const table = await getTable(key);
  if (!table) return null;
  const { results } = await table.roll(); // roll(), never draw(): nothing is posted to chat
  const r = results[0];
  return r ? { name: r.name, description: r.description, flags: r.flags?.[MODULE_ID] ?? {}, table } : null;
}

/* optional convenience: copy tables (all, or the given keys) into the world; nothing in this module needs it */
export async function importToWorld(keys = null) {
  requireGM();
  const pack = getPack();
  const docs = (await packTables(pack)).filter((x) => !keys || keys.includes(metaOf(x).key));
  return RollTable.implementation.createDocuments(docs.map((d) => d.toObject()).map((o) => { delete o._id; delete o.folder; return o; }));
}

export async function keys() { return (await parseNow()).specs.map((s) => s.key); }

/* dry run: what build() would write (no document is touched) */
export async function preview() {
  const { specs, warnings } = await parseNow();
  return { warnings, tables: specs.map((s) => ({ key: s.key, name: s.name, formula: s.formula, count: s.results.length, results: s.results.map((r) => r.name) })) };
}

export const tables = { build, status, remove, getTable, roll, keys, preview, importToWorld, PACK: TABLE_PACK };

/* attach to the module api (module.js replaces api at "ready" while keeping unknown keys, see its api handle) */
export function start() {
  const attach = () => {
    const mod = game.modules.get(MODULE_ID);
    if (!mod) return;
    const api = (mod.api ??= {});
    api.chargen = { ...(api.chargen ?? {}), tables };
  };
  if (globalThis.game?.ready) attach();
  else {
    Hooks.once("init", attach);
    Hooks.once("ready", attach);
  }
}
