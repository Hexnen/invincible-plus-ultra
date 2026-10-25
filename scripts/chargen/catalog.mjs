/* Character generator, phase 3b: CATALOG (Foundry side, read only).
   Runtime lookup of the selectable content in the `invincible-core` compendium packs, combined with the book-list tables of
   tables.mjs into ONE provider that satisfies the interface documented in the header of random.mjs (list(key, ctx), roll?, getArchetype).
   Nothing is stored in the module: names and ids come from the installed packs / book, small neutral name lists are the only module-owned data.

   API (game.modules.get("invincible-plus-ultra").api.chargen.catalog):
     available()                 -> { ok, missing:[pack ids] }   (is invincible-core installed and readable?)
     powers() / powerSources() / talents() / drawbacks()          -> normalised entries (cached, lazy index)
     boostsFor(powerName) / limitsFor(powerName)                  -> candidates whose pack folder name == power name
     findPower(ref) / findByName(type, name) / resolveDoc(type, ref, {level}) -> entry / full document (fromUuid)
     getArchetype(id)            -> { id, name, role, attrs, powers:[{name,packUuid,level,boosts:[{name,packUuid}],note}] } from the book page
     provider(opts)              -> the combined provider for random.mjs ({useTableRoll, excludeActorId})
     invalidate()                -> drop all caches (also automatic on changes to invincible-core items and after 60 s for table lists)
   Entry = { id, uuid, packUuid(=uuid), name, type, img, ... }:
     powers:  type = "Attack"|"Control"|"Defense"|"Modification"|"Movement"|"Sensory", maxLevel = 3, split:boolean (one doc per level:
              Protection, Strike, Size Alteration, Extra Limb(s)), levels:{basic,major,massive,monstrous -> uuid} (split only), folder
     boosts / limits: power (folder name), type "boost"|"limit"
     others:  type "powerSource"|"talent"|"drawback"
   Provider key map (everything random.mjs asks for):
     catalog (invincible-core packs):  powers, boosts{power}, limits{power}, talents, heroTalents/drawbacks WITHOUT archetype,
                                       powerSources fallback (36 pack docs) when the D66 table is unavailable
     tables.mjs provider (chargen-tables pack + two core tables): archetypes, occupations, occupationTalents, npcRelations, personality,
                                       drives, flaws, heroNames, heroTalents/drawbacks/powerSources WITH archetype, powerSources without
                                       (core D66 table), knowledgeableSubjects, teamNames, teamBases, baseUpgrades
     catalog union over the 16 archetype tables: personality / drives / flaws / heroNames WITHOUT archetype
     catalog (derived): occupations{archetype} entries get data.resources from the full occupation table
     module-owned: civilianNames (small neutral lists)      world actors: heroRelations (player-owned superheroes the user can see)
     book page: getArchetype(id)
   Works for non-GM users (index + fromUuid only; compendia are OBSERVER for players). */
import * as Tables from "./tables.mjs";
import { setPowerMaxLevels } from "./rules.mjs";

const MODULE_ID = "invincible-plus-ultra";
const CORE = "invincible-core";
const BOOK_ARCHETYPES = { journal: "Compendium.invincible-core.core-book.JournalEntry.Rbx4P6GQT5EoFNUG", pageName: "Archetypes", pageId: "0FCrBQzpjPzPkxWi" };
const LEVEL_WORDS = ["basic", "major", "massive", "monstrous"];
const TTL = 60_000;

export const norm = (s) => String(s ?? "").toLowerCase().replace(/[\s ]+/g, " ").trim();
/** "Burst Effect (Blast)" -> "burst effect" */
export const normBase = (s) => norm(String(s ?? "").replace(/\s*\([^)]*\)\s*$/, ""));

/* ------------------------------------------------------------------ cache */
let cache = new Map();
let timed = new Map(); // table-derived lists with a time stamp
export function invalidate() { cache = new Map(); timed = new Map(); }
const memo = (key, fn) => { if (!cache.has(key)) cache.set(key, fn().catch((e) => { cache.delete(key); throw e; })); return cache.get(key); };
const timedMemo = (key, fn) => {
  const hit = timed.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const p = fn().catch((e) => { timed.delete(key); throw e; });
  timed.set(key, { at: Date.now(), p });
  return p;
};

const packOf = (name) => game.packs.get(`${CORE}.${name}`) ?? null;
export function available() {
  const need = ["powers", "power-sources", "boosts", "limits", "talents", "drawbacks"];
  const missing = need.filter((n) => !packOf(n)).map((n) => `${CORE}.${n}`);
  return { ok: !missing.length, missing };
}

async function indexOf(name, fields = []) {
  const pack = packOf(name);
  if (!pack) return { pack: null, index: [] };
  const index = await pack.getIndex({ fields });
  return { pack, index: [...index] };
}
const folderName = (pack, id) => (id ? pack.folders.get(id)?.name ?? null : null);
const entryBase = (i, type) => ({ id: i._id, uuid: i.uuid, packUuid: i.uuid, name: i.name, type, img: i.img });

/* ------------------------------------------------------------------ powers */
export function powers() {
  return memo("powers", async () => {
    const { pack, index } = await indexOf("powers", ["system.level", "folder", "system.description"]);
    if (!pack) return [];
    // B2 (phase 9): the book labels every level it defines as a paragraph "Major:" / "Massive:" / "Monstrous:" in the power text; "Many powers only have a basic power level"
    const hasLabel = (html, word) => new RegExp(`(?:^|[>\\s.])${word}\\s*:`).test(String(html ?? "").replace(/<[^>]*>/g, " "));
    const bookMax = (html) => (hasLabel(html, "Monstrous") ? 3 : hasLabel(html, "Massive") ? 2 : hasLabel(html, "Major") ? 1 : 0);
    const typeOf = (folderId) => {
      let f = pack.folders.get(folderId);
      while (f?.folder && f.folder.id !== f.id) f = f.folder; // climb to the root: "Attack Powers"
      return f ? f.name.replace(/\s*Powers$/i, "") : "Other";
    };
    const byName = new Map();
    for (const i of index) {
      const lv = i.system?.level ?? "";
      let e = byName.get(i.name);
      if (!e) {
        e = { ...entryBase(i, "Other"), type: typeOf(i.folder), folder: folderName(pack, i.folder), maxLevel: 0, split: false, levels: {} };
        byName.set(i.name, e);
      }
      if (LEVEL_WORDS.includes(lv)) e.levels[lv] = i.uuid;
      e.maxLevel = Math.max(e.maxLevel, bookMax(i.system?.description));
    }
    for (const e of byName.values()) {
      const have = Object.keys(e.levels);
      e.split = have.length > 1;
      if (e.split) { const base = e.levels.basic ?? Object.values(e.levels)[0]; e.uuid = e.packUuid = base; e.id = base.split(".").pop(); e.maxLevel = Math.max(...have.map((w) => LEVEL_WORDS.indexOf(w))); } else e.levels = {};
    }
    const out = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    setPowerMaxLevels(out.map((e) => [e.name, e.maxLevel]));
    return out;
  });
}
export async function findPower(ref) {
  const all = await powers();
  const name = typeof ref === "string" ? ref : ref?.name;
  const uuid = typeof ref === "string" ? null : ref?.packUuid;
  if (uuid) { const hit = all.find((p) => p.packUuid === uuid || Object.values(p.levels).includes(uuid)); if (hit) return hit; }
  return all.find((p) => norm(p.name) === norm(name)) ?? null;
}

/* ------------------------------------------------------------------ simple item packs */
/** B4 (phase 9): what a drawback asks you to choose when you take it, read from its own text: "source" = one of your power sources, "defined" = something defined when you
    select it (a phobia, an obsession ...); false = nothing to choose */
export function needsChoice(html) {
  const text = String(html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  if (/power sources?\s*\(choose one/i.test(text) || /choose one of your power/i.test(text)) return "source";
  if (/defined (?:with the help of the GM )?when you select/i.test(text)) return "defined";
  return false;
}
const simple = (name, type, extra = () => ({}), fields = []) => () => memo(name, async () => {
  const { pack, index } = await indexOf(name, ["folder", ...fields]);
  return index.map((i) => ({ ...entryBase(i, type), ...extra(pack, i) })).sort((a, b) => a.name.localeCompare(b.name));
});
export const powerSources = simple("power-sources", "powerSource");
export const talents = simple("talents", "talent");
export const drawbacks = simple("drawbacks", "drawback", (pack, i) => ({ needs: needsChoice(i.system?.description) }), ["system.description"]);
const allBoosts = simple("boosts", "boost", (pack, i) => ({ power: folderName(pack, i.folder) }));
const allLimits = simple("limits", "limit", (pack, i) => ({ power: folderName(pack, i.folder) }));
export async function boostsFor(power) { const n = norm(power); return (await allBoosts()).filter((b) => norm(b.power) === n); }
export async function limitsFor(power) { const n = norm(power); return (await allLimits()).filter((b) => norm(b.power) === n); }

const LISTERS = { power: powers, powerSource: powerSources, talent: talents, drawback: drawbacks, boost: allBoosts, limit: allLimits };
/** find a catalogue entry by type + name (exact, then without a trailing "(...)"), optionally restricted to a power (boost/limit) */
export async function findByName(type, name, { power = null } = {}) {
  let list = await LISTERS[type]();
  if (power && (type === "boost" || type === "limit")) { const sub = list.filter((e) => norm(e.power) === norm(power)); if (sub.length) list = sub; }
  const n = norm(name);
  return list.find((e) => norm(e.name) === n) ?? list.find((e) => normBase(e.name) === normBase(name)) ?? null;
}

/** full document for a state reference ({name, packUuid}); `level` picks the per-level doc of split powers. null if unresolvable. */
export async function resolveDoc(type, ref, { level = null, power = null } = {}) {
  let uuid = ref?.packUuid ?? null;
  let entry = null;
  if (type === "power") {
    entry = await findPower(ref);
    if (entry) uuid = entry.split ? (entry.levels[LEVEL_WORDS[level ?? 0]] ?? entry.levels.basic ?? entry.packUuid) : entry.packUuid;
  } else if (!uuid) {
    entry = await findByName(type, ref?.name, { power });
    uuid = entry?.packUuid ?? null;
  }
  if (!uuid) return null;
  let doc = null;
  try { doc = await fromUuid(uuid); } catch { doc = null; }
  if (doc && doc.type === type) return doc;
  if (!entry) entry = await findByName(type, ref?.name, { power });
  if (entry && entry.packUuid !== uuid) { try { doc = await fromUuid(entry.packUuid); } catch { doc = null; } if (doc?.type === type) return doc; }
  return null;
}

/* ------------------------------------------------------------------ archetype data from the book page */
const clean = (s) => String(s ?? "").replace(/[ ­]/g, " ").replace(/\s+/g, " ").trim();
async function bookArchetypePage() {
  const j = await fromUuid(BOOK_ARCHETYPES.journal);
  if (!j) return null;
  const page = j.pages.find((p) => p.name === BOOK_ARCHETYPES.pageName) ?? j.pages.get(BOOK_ARCHETYPES.pageId);
  return page?.text?.content ?? null;
}
function splitTop(s) { // split on commas outside parentheses
  const out = []; let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++; else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
async function parseArchetypes() {
  const html = await bookArchetypePage();
  if (!html) return new Map();
  const el = document.createElement("div");
  el.innerHTML = html;
  const out = new Map();
  const pw = await powers();
  const bAll = await allBoosts();
  for (const h2 of el.querySelectorAll("h2")) {
    const box = h2.nextElementSibling?.nextElementSibling;
    if (!box?.classList.contains("box")) continue;
    const ps = [...box.querySelectorAll("p")];
    const find = (label) => ps.find((q) => q.textContent.trim().startsWith(label));
    const attrs = {};
    for (const m of (find("Suggested Attributes")?.textContent ?? "").matchAll(/(FIGHTING|AGILITY|STRENGTH|REASON|INTUITION|PRESENCE)\s+(\d+)/gi)) attrs[m[1].toLowerCase()] = +m[2];
    const role = clean((find("Role")?.textContent ?? "").replace(/^Role:\s*/, ""));
    const text = (find("Suggested Powers")?.textContent ?? "").replace(/^\s*Suggested Powers:\s*/, "");
    const powersOut = [];
    for (const tok of splitTop(text)) {
      // B1 (phase 9): the book links some powers as Compendium.invincible-core.powers.<id> WITHOUT ".Item." (Vigilante, Warrior, Wisecracker): accept both forms
      const link = /@UUID\[(Compendium\.invincible-core\.powers\.(?:Item\.)?[^\]]+)\]\{([^}]+)\}/.exec(tok);
      if (!link) continue;
      const canon = (u) => String(u).replace(/\.Item\./, ".");
      const hit = pw.find((p) => canon(p.packUuid) === canon(link[1]) || Object.values(p.levels).some((l) => canon(l) === canon(link[1]))) ?? pw.find((p) => norm(p.name) === norm(clean(link[2]).replace(/^(major|massive)\s+/i, "")));
      if (!hit) continue;
      const level = /\bmassive\b/i.test(link[2] + " " + tok.slice(0, link.index)) ? 2 : /\bmajor\b/i.test(link[2] + " " + tok.slice(0, link.index)) ? 1 : 0;
      const boosts = [];
      for (const b of tok.matchAll(/@UUID\[(Compendium\.invincible-core\.boosts\.(?:Item\.)?[^\]]+)\]\{([^}]+)\}/g)) {
        const be = bAll.find((x) => canon(x.packUuid) === canon(b[1]));
        boosts.push({ name: be?.name ?? clean(b[2]), packUuid: be?.packUuid ?? b[1] });
      }
      const note = /\}\s*\(([^)]*)\)/.exec(tok)?.[1];
      powersOut.push({ name: hit.name, packUuid: hit.packUuid, level, boosts, ...(note && !/boost/i.test(note) ? { note: clean(note) } : {}) });
    }
    const name = clean(h2.textContent).replace(/^The\s+/i, "");
    if (name) {
      // parse oracle (phase 9): attribute sum must equal 32 + 2 * (4 - power slots) for Global Champion; a mismatch means the parser dropped something
      const sum = Object.values(attrs).reduce((a, b) => a + b, 0), slotsUsed = powersOut.reduce((a, p) => a + p.level + 1 + p.boosts.length, 0);
      if (sum && sum !== 32 + 2 * (4 - slotsUsed)) console.warn(`${MODULE_ID} | chargen: archetype "${name}" parse check failed (attribute sum ${sum}, slots ${slotsUsed})`);
      out.set(norm(name), { id: name, name, role, attrs, powers: powersOut });
    }
  }
  return out;
}
export async function getArchetype(id) {
  if (!id) return null;
  const map = await memo("archetypes-book", parseArchetypes);
  return map.get(norm(String(id).replace(/-/g, " "))) ?? null;
}

/* ------------------------------------------------------------------ module-owned small name lists (civilian / NPC names) */
const FIRST = ["Alex", "Jordan", "Sam", "Morgan", "Riley", "Casey", "Taylor", "Jamie", "Avery", "Quinn", "Robin", "Dana", "Eli", "Maya", "Noah", "Zoe", "Luca", "Nina", "Owen", "Ivy",
  "Marcus", "Priya", "Tomas", "Hana", "Diego", "Amara", "Felix", "Leila", "Jonas", "Mei", "Kofi", "Sofia", "Andre", "Yara", "Victor", "Anika", "Rafael", "Greta", "Omar", "Tessa"];
const LAST = ["Alvarez", "Brooks", "Chen", "Dalton", "Evans", "Fischer", "Garcia", "Hayes", "Ibrahim", "Jensen", "Kowalski", "Lopez", "Morales", "Nakamura", "Okafor", "Patel", "Quinn", "Reyes", "Silva", "Tanaka",
  "Underhill", "Vasquez", "Walker", "Xu", "Young", "Zielinski", "Abbott", "Bennett", "Carter", "Dubois", "Ellis", "Foster", "Grant", "Holm", "Ito", "Jovanovic", "Kane", "Lindqvist", "Moreau", "Novak"];
export const NAME_LISTS = { first: FIRST, last: LAST };

/* ------------------------------------------------------------------ the combined provider */
const dedupe = (entries) => { const seen = new Set(); return entries.filter((e) => { const k = norm(e.name); if (!k || seen.has(k)) return false; seen.add(k); return true; }); };
const withUuid = async (type, entries) => {
  const list = await LISTERS[type]();
  const need = (e) => (type === "drawback" && !e.needs ? (list.find((x) => norm(x.name) === norm(e.name))?.needs || undefined) : e.needs);
  return entries.map((e) => (e.packUuid ? e : { ...e, packUuid: list.find((x) => norm(x.name) === norm(e.name))?.packUuid ?? undefined })).map((e) => (e.packUuid ? e : (({ packUuid, ...r }) => r)(e)))
    .map((e) => { const n = need(e); return n ? { ...e, needs: n } : e; });
};
const asEntry = (e) => ({ name: e.name, packUuid: e.packUuid, ...(e.type ? { type: e.type } : {}), ...(e.maxLevel != null ? { maxLevel: e.maxLevel } : {}), ...(e.needs ? { needs: e.needs } : {}) });

/**
 * @param {object} [opts]
 * @param {boolean} [opts.useTableRoll]   real RollTable.roll() for table-backed keys (not seedable, never draw())
 * @param {string}  [opts.excludeActorId] actor to leave out of heroRelations (the hero being built)
 */
export function provider(opts = {}) {
  const T = Tables.provider({ useTableRoll: !!opts.useTableRoll });
  const archetypeNames = () => timedMemo("archetype-names", async () => (await T.list("archetypes", {})).map((e) => e.name));
  const union = (key) => timedMemo(`union:${key}`, async () => {
    const out = [];
    for (const a of await archetypeNames()) out.push(...(await T.list(key, { archetype: a })));
    return dedupe(out);
  });
  const occupationData = () => timedMemo("occupation-data", async () => new Map((await T.list("occupations", {})).map((e) => [norm(e.name), e.data])));

  async function list(key, ctx = {}) {
    switch (key) {
      case "powers": return (await powers()).map(asEntry);
      case "boosts": return (await boostsFor(ctx.power)).map(asEntry);
      case "limits": return (await limitsFor(ctx.power)).map(asEntry);
      case "talents": return (await talents()).map(asEntry);
      case "heroTalents": {
        if (!ctx.archetype) return (await talents()).map(asEntry);
        const l = await T.list(key, ctx);
        return l.length ? withUuid("talent", l) : (await talents()).map(asEntry);
      }
      case "drawbacks": {
        if (!ctx.archetype) return (await drawbacks()).map(asEntry);
        const l = await T.list(key, ctx);
        return l.length ? withUuid("drawback", l) : (await drawbacks()).map(asEntry);
      }
      case "powerSources": {
        const l = await T.list(key, ctx);
        if (l.length) return ctx.archetype ? l : withUuid("powerSource", l);
        return ctx.archetype ? [] : (await powerSources()).map(asEntry); // fallback: the 36 pack docs
      }
      case "knowledgeableSubjects": return withUuid("talent", await T.list(key, ctx));
      case "occupations": {
        const l = await T.list(key, ctx);
        if (!ctx.archetype) return l;
        const data = await occupationData();
        return l.map((e) => (e.data?.resources != null ? e : { ...e, data: { ...(e.data ?? {}), ...(data.get(norm(e.name)) ?? {}) } }));
      }
      case "personality": case "drives": case "flaws": case "heroNames": {
        if (ctx.archetype) return T.list(key, ctx);
        return union(key);
      }
      case "civilianNames": return FIRST.flatMap((f) => LAST.map((l) => ({ name: `${f} ${l}` })));
      case "heroRelations": return heroRelations(opts.excludeActorId);
      case "cityLocations": return (await cityRows()).map(({ name, lo, hi }) => ({ name, data: { range: [lo, hi] } }));
      case "existingBases": return existingBases();
      default: return T.list(key, ctx);
    }
  }
  const P = {
    list,
    getArchetype,
    /** Phase 6: roll() is a SEEDED equivalent of RollTable.roll() for every table-backed key (same dice formula, same uneven rows: the D66 power sources and
        City Locations); with useTableRoll the real table.roll() is used instead (not seedable). Keys without a table (powers, talents ...) return null and
        random.mjs makes a uniform seeded pick. */
    async roll(key, rng, ctx = {}) {
      if (key === "civilianNames") return { name: `${rng.pick(FIRST)} ${rng.pick(LAST)}` };
      if (key === "cityLocations") {
        const rows = await cityRows();
        if (!rows.length) return null;
        const total = rng.d66(), r = rows.find((x) => total >= x.lo && total <= x.hi);
        return r ? { name: r.name, data: { range: [r.lo, r.hi], roll: total } } : null;
      }
      // table-backed keys: only where the key's list is exactly the table (no catalog fallback / union)
      const tableOnly = ["archetypes", "occupationTalents", "npcRelations", "teamNames", "teamBases", "baseUpgrades", "knowledgeableSubjects"].includes(key)
        || (ctx.archetype && ["personality", "drives", "flaws", "heroNames", "heroTalents", "drawbacks", "powerSources", "occupations"].includes(key))
        || (key === "powerSources" && !ctx.archetype);
      if (!tableOnly || typeof T.roll !== "function") return null; // random.mjs falls back to a seeded pick from list()
      const e = await T.roll(key, rng, ctx);
      if (!e || e.packUuid) return e;
      const type = { heroTalents: "talent", knowledgeableSubjects: "talent", drawbacks: "drawback", powerSources: "powerSource" }[key];
      return type ? ((await withUuid(type, [e]))[0] ?? e) : e;     // table rows without a link get the pack document found by name
    }
  };
  return P;
}

const bapi = () => globalThis.game?.modules?.get(MODULE_ID)?.api?.base ?? null;
const plainText = (html) => String(html ?? "").replace(/<[^>]*>/g, " ").replace(/@UUID\[[^\]]*\]\{([^}]+)\}/g, "$1").replace(/\s+/g, " ").trim();
/** City Locations (core book table, read at runtime through the base feature): [{name, lo, hi}] sorted by range; [] without the book */
async function cityRows() {
  try {
    const tb = await bapi()?.catalog?.cityTable?.();
    if (!tb) return [];
    return [...tb.results].map((r) => ({ name: plainText(r.description || r.name) || String(r.name ?? ""), lo: r.range?.[0] ?? 0, hi: r.range?.[1] ?? 0 })).filter((r) => r.name).sort((a, b) => a.lo - b.lo);
  } catch { return []; }
}
/** team base cards the user may see (the ones the Team step lists as "join") */
function existingBases() {
  const b = bapi();
  if (!b) return [];
  try {
    return b.list().filter((v) => game.actors.get(v.id)?.testUserPermission(game.user, "LIMITED"))
      .sort((x, y) => x.name.localeCompare(y.name)).map((v) => ({ name: v.name, data: { baseId: v.id } }));
  } catch { return []; }
}

function heroRelations(excludeId) {
  const out = [];
  for (const a of game.actors ?? []) {
    if (a.type !== "superhero" || a.id === excludeId) continue;
    if (!a.hasPlayerOwner || !a.testUserPermission(game.user, "OBSERVER")) continue;
    out.push({ name: a.name, packUuid: a.uuid, data: { actorUuid: a.uuid } });
  }
  return out;
}

/* ------------------------------------------------------------------ module api */
export const catalog = { available, powers, powerSources, talents, drawbacks, boostsFor, limitsFor, findPower, findByName, resolveDoc, getArchetype, provider, invalidate, norm, NAME_LISTS };

export function start() {
  const attach = () => {
    const mod = game.modules.get(MODULE_ID);
    if (!mod) return;
    (mod.api ??= {});
    mod.api.chargen = { ...(mod.api.chargen ?? {}), catalog, provider: provider };
  };
  if (globalThis.game?.ready) attach(); else { Hooks.once("init", attach); Hooks.once("ready", attach); }
  const inCore = (doc) => String(doc?.pack ?? "").startsWith(`${CORE}.`);
  for (const h of ["createItem", "updateItem", "deleteItem"]) Hooks.on(h, (doc) => { if (inCore(doc)) invalidate(); });
}
