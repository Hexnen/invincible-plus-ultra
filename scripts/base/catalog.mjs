/* Team & Base card, phase B3: CATALOG. Runtime reads of the installed core book (module invincible-core): the sample upgrades (parsed from the
   "Base Upgrades" page: H2 name, "Prerequisite:" paragraph, effect paragraph, stacking sentence), the Base Events and City Locations RollTables
   and our own chargen-tables pack (team-base.<rank>, team-names). Nothing of the book is stored in the repository; results are cached in memory
   only. Tables are rolled with RollTable#roll() - NEVER draw() - so nothing is posted to chat and nothing is marked drawn.
   Everything fails soft: without the book upgrades() resolves [] and the table functions resolve null / throw BaseError("noBook"). */
import * as P from "./pure.mjs";
import { BaseError, MODULE_ID } from "./store.mjs";

const BOOK_PACK = "invincible-core.core-book";
const BOOK_JOURNAL = "SAbQgNV0jxDcZaC7";        // ch.7 "Campaign Play"
const PAGE = { id: "8R3zLyelwLKUuHeM", name: "Base Upgrades" };
const TABLE_PACK = "invincible-core.rollable-tables";
const TABLES = {
  events: { id: "EJXpbjjr8sbwj8hy", name: "Base Events" },
  city: { id: "73WJRAMoHQDyb0qZ", name: "City Locations" }
};

let upgradesCache = null;          // Promise<Entry[]>
const tableCache = new Map();      // key -> Promise<RollTable|null>

export function invalidate() { upgradesCache = null; promptsCache = null; tableCache.clear(); }

/* ------------------------------------------------------------------ text helpers */
export function plain(html) {
  const s = String(html ?? "")
    .replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@UUID\[[^\]]*\]/g, "")
    .replace(/\[\[\/?(?:r|roll)?\s*([^\]]*?)\]\](?:\{([^}]*)\})?/gi, (_m, a, b) => b || a);
  const doc = new DOMParser().parseFromString(`<div>${s}</div>`, "text/html");
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}
const firstSentence = (s) => (/^(.*?[.!?])(\s|$)/.exec(s) ?? [0, s])[1];

/* ------------------------------------------------------------------ upgrades */
async function loadPage() {
  const pack = game.packs.get(BOOK_PACK);
  if (!pack) return null;
  let journal = null;
  try { journal = await pack.getDocument(BOOK_JOURNAL); } catch { /* fall through */ }
  const page = journal?.pages.find((p) => p.name === PAGE.name) ?? journal?.pages.get(PAGE.id);
  return page ?? null;
}

/** Pure HTML -> sections (exported for the checks). */
export function parseSections(html) {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, "text/html");
  const root = doc.getElementById("root");
  const host = root.querySelector("#invbook") ?? root;
  const sections = [];
  let cur = null;
  for (const el of host.children) {
    if (el.tagName === "H2") { cur = { name: el.textContent.trim(), ps: [] }; sections.push(cur); continue; }
    if (cur && el.tagName === "P") cur.ps.push(el.textContent.replace(/\s+/g, " ").trim());
  }
  return sections;
}

export function buildEntries(sections) {
  const withPre = sections.filter((s) => s.ps.some((p) => /^prerequisites?\b/i.test(p)));
  const names = withPre.map((s) => s.name);
  return withPre.map((s) => {
    const i = s.ps.findIndex((p) => /^prerequisites?\b/i.test(p));
    const raw = s.ps[i];
    const rest = s.ps.filter((_p, k) => k !== i);
    const stack = P.parseStack(rest.join(" "));
    return {
      key: P.slug(s.name), name: s.name,
      prereqRaw: raw.replace(/^prerequisites?\s*:?\s*/i, ""), prereq: P.parsePrerequisite(raw, names),
      max: stack.max, perPower: stack.perPower, gm: stack.gm,
      effect: firstSentence(rest[0] ?? "")
    };
  });
}

/** The sample upgrades of the book (Entry = { key, name, prereqRaw, prereq, max, perPower, gm, effect }); [] without the book. */
export function upgrades() {
  upgradesCache ??= (async () => {
    try {
      const page = await loadPage();
      return page ? buildEntries(parseSections(page.text?.content ?? "")) : [];
    } catch (e) { console.warn(`${MODULE_ID} | base: could not parse the upgrades page`, e); return []; }
  })();
  return upgradesCache;
}
export async function upgrade(keyOrName) {
  const k = P.slug(String(keyOrName ?? ""));
  return (await upgrades()).find((u) => u.key === k) ?? null;
}
/** Printable audit of the parsed catalog (name, prerequisite structure, stack). */
export async function audit() {
  return (await upgrades()).map((u) => ({
    name: u.name, key: u.key, raw: u.prereqRaw, ok: u.prereq.ok, none: u.prereq.none, resources: u.prereq.resources,
    occupations: u.prereq.occupations, upgrades: u.prereq.upgrades, unparsed: u.prereq.unparsed, max: u.max, perPower: u.perPower
  }));
}
export async function available() { return !!game.packs.get(BOOK_PACK) && (await upgrades()).length > 0; }

/* ------------------------------------------------------------------ describing prompts (Base tab "Need ideas?") */
const PROMPTS_PAGE = { id: "4XsHaJDaJPBLSqIe", name: "The Team Base" };
let promptsCache = null;          // Promise<string[]>
/** The questions of the "Describing the Base" box on the book's Team Base page, read at runtime (never stored); [] without the book. */
export function describingPrompts() {
  promptsCache ??= (async () => {
    try {
      const pack = game.packs.get(BOOK_PACK);
      const journal = pack ? await pack.getDocument(BOOK_JOURNAL) : null;
      const page = journal?.pages.get(PROMPTS_PAGE.id) ?? journal?.pages.find((p) => p.name === PROMPTS_PAGE.name);
      if (!page) return [];
      const doc = new DOMParser().parseFromString(`<div id="root">${page.text?.content ?? ""}</div>`, "text/html");
      const box = [...doc.querySelectorAll(".box")].find((b) => b.querySelector("h3") && b.querySelector("li"));
      return [...(box?.querySelectorAll("li") ?? [])].map((li) => li.textContent.replace(/\s+/g, " ").trim()).filter(Boolean);
    } catch (e) { console.warn(`${MODULE_ID} | base: could not read the describing prompts`, e); return []; }
  })();
  return promptsCache;
}

/* ------------------------------------------------------------------ book tables */
function table(key) {
  if (!tableCache.has(key)) {
    tableCache.set(key, (async () => {
      const def = TABLES[key];
      const pack = game.packs.get(TABLE_PACK);
      if (!pack) return null;
      let doc = null;
      try { doc = await pack.getDocument(def.id); } catch { /* by name below */ }
      if (!doc || doc.name !== def.name) {
        const hit = (await pack.getIndex()).find((x) => x.name === def.name);
        doc = hit ? await pack.getDocument(hit._id) : null;
      }
      return doc ?? null;
    })());
  }
  return tableCache.get(key);
}
export const eventsTable = () => table("events");
export const cityTable = () => table("city");

/** Compare the real Base Events ranges with the expected bands: { ok, bands, reason }. */
export async function bands() {
  const tb = await eventsTable();
  if (!tb) return { ok: false, bands: [], reason: "noTable" };
  return P.resolveBands(tb.results.map((r) => [...r.range]));
}

async function rollWith(tb, total) {
  const opts = {};
  if (Number.isInteger(total)) opts.roll = await new Roll(String(total)).evaluate();   // forced total (tests / GM re-roll by hand)
  const { roll, results } = await tb.roll(opts);                                        // roll(): no chat card, nothing marked drawn
  const r = results[0];
  return { total: roll.total, result: r ?? null, resultId: r?.id ?? "", range: r ? [...r.range] : null, text: r ? plain(r.description || r.name) : "" };
}

/** Roll the Base Events table. Returns { roll, band, bandsOk, resultId, text, range, tableId }. Writes and posts nothing. */
export async function rollEvent({ total } = {}) {
  const tb = await eventsTable();
  if (!tb) throw new BaseError("noBook");
  const r = await rollWith(tb, total);
  const b = await bands();
  const band = b.ok ? P.bandForRoll(r.total, b.bands) : (r.range ? P.bandId(r.range[0], r.range[1]) : null);
  return { roll: r.total, band: band ?? "", bandsOk: b.ok, resultId: r.resultId, text: r.text, range: r.range, tableId: tb.id, tableName: tb.name };
}
/** The CURRENT text of a Base Events result (read from the book at runtime; null without the book or when the result id is unknown). Nothing is stored. */
export async function eventText(resultId) {
  try {
    const tb = await eventsTable();
    const r = tb?.results.get(resultId);
    return r ? plain(r.description || r.name) : null;
  } catch { return null; }
}
/** Roll the City Locations table. Returns { roll, name, resultId, range, tableId }. */
export async function rollCity({ total } = {}) {
  const tb = await cityTable();
  if (!tb) throw new BaseError("noBook");
  const r = await rollWith(tb, total);
  return { roll: r.total, name: r.text, resultId: r.resultId, range: r.range, tableId: tb.id, tableName: tb.name };
}

/* ------------------------------------------------------------------ our chargen-tables pack */
const tablesApi = () => game.modules.get(MODULE_ID)?.api?.chargen?.tables ?? null;

/** Base location examples for a rank (team-base.<rank>), [] when the pack is not built. */
export async function teamBaseExamples(rank) {
  try {
    const list = await tablesApi()?.provider?.().list("teamBases", { rank });
    return (list ?? []).map((e) => e.name);
  } catch { return []; }
}
/** Roll team-base.<rank> with table.roll() (via the chargen tables api). Returns { name } or null. */
export async function rollTeamBase(rank) {
  try {
    const r = await tablesApi()?.roll?.(`team-base.${rank}`);
    return r ? { name: String(r.name || plain(r.description)) } : null;
  } catch { return null; }
}
/** Names of the upgrades the book recommends for a starting base (our pack table base-upgrades), read at runtime; [] when the pack is not built. */
export async function recommendedUpgrades() {
  try {
    const list = await tablesApi()?.provider?.().list("baseUpgrades", {});
    return (list ?? []).map((e) => e.name);
  } catch { return []; }
}
export async function teamNames() {
  try {
    const list = await tablesApi()?.provider?.().list("teamNames", {});
    return (list ?? []).map((e) => e.name);
  } catch { return []; }
}

export function start() {
  Hooks.on("updateJournalEntryPage", (page) => { if (page.parent?.pack === BOOK_PACK) invalidate(); });
  Hooks.on("updateRollTable", (tb) => { if (tb.pack === TABLE_PACK) tableCache.clear(); });
}
