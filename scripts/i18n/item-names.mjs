/* THE DISPLAY LAYER FOR ITEM NAMES. The data stays English; a Polish client SEES the Polish name.
   Why not rename the items: the tactics kit, the balancer and the character creator recognise powers and talents by the English name in
   the data, the book is English, and a world can be opened by an English client. So nothing here ever writes a name.

   WHICH ITEM GETS A POLISH NAME (entryOf): one that comes from an entry of the dictionary, known by an IDENTIFIER, never by its text:
     1. its compendium source (item._stats.compendiumSource, set by Foundry when an entry is dragged or imported);
     2. its own identifier, when it IS a compendium entry or an item of a pregenerated character (item-ids.mjs: imported actors keep the
        identifiers of their items);
     3. the character creator's mark (flags.<module>.chargenRun): the wizard builds its items from the compendium by English name, so for
        those the entry is found by type + English name.
   AND ONLY WHILE THE NAME IS STILL THE ORIGINAL (shownName): the stored name equals the entry's English name, or is that name with a
   parameter after it ("Immunity (Cold)", "Durable x3": the parameter is kept, translated when PARAMS_PL knows it). A renamed item shows
   the name its user gave it; an item made from scratch has no source and shows what its author typed.

   WHERE THE NAME IS APPLIED
     - our own interface asks displayName(item) / shownText(text, item) (tactics: system-adapter.mjs localises the kit it builds);
     - the system's sheets, the item sheet, the sidebar lists (world items, item compendia) and chat cards are rendered by templates we do
       not own: their text is swapped once per render of that application or message (hooks below), by the item the element belongs to.
       No observer, no scan of the page: a render that shows no item costs one hook call.
     - the item sheet's name field shows the Polish name while it is not being edited and the stored name while it has the focus; a
       submit that carries the displayed Polish name back is dropped in preUpdateItem (the name is not a change the user made).
   What it does not reach is listed in dev/glossary-pl.md (section on names). Everything fails soft: on any error the English text stays.
   Only for the Polish language (other languages see the data as it is). The pure part (everything above `/* ---- Foundry`) runs in node. */
import { NAMES_PL, PARAMS_PL } from "./item-names-pl.mjs";
import { PACK_IDS, EMBEDDED_IDS } from "./item-ids.mjs";

const MOD = "invincible-plus-ultra", SYSTEM = "invincible";
export const NAME_TYPES = Object.freeze(Object.keys(NAMES_PL));
const ID_LEN = 16;

/* ------------------------------------------------------------------ the dictionary (pure) */
const BY_ID = new Map();       // identifier -> { type, en, pl }
const OWN = new Map();         // the id of an item that sits on a pregenerated character -> its entries (such ids repeat from sheet to sheet, so the stored name picks one)
const ENTRIES = new Map();     // "type|en" -> the same entry
const entry = (type, en) => {
  const k = `${type}|${en}`;
  if (!ENTRIES.has(k)) { const pl = NAMES_PL[type]?.[en] ?? NAMES_PL[type]?.[String(en).replace(/\s+/g, " ").trim()]; ENTRIES.set(k, typeof pl === "string" && pl ? Object.freeze({ type, en, pl }) : null); }
  return ENTRIES.get(k);
};
for (const [table, own] of [[PACK_IDS, false], [EMBEDDED_IDS, true]]) for (const [type, names] of Object.entries(table)) for (const [en, ids] of Object.entries(names)) {
  const e = entry(type, en);
  if (e) for (let i = 0; i + ID_LEN <= ids.length; i += ID_LEN) { const id = ids.slice(i, i + ID_LEN); if (!own) { if (!BY_ID.has(id) || en.length < BY_ID.get(id).en.length) BY_ID.set(id, e); } if (!OWN.has(id)) OWN.set(id, []); if (!OWN.get(id).includes(e)) OWN.get(id).push(e); }
}
/** Every entry an identifier may stand for (for the checks). */
export const entriesById = (id) => OWN.get(String(id ?? "").split(".").pop()) ?? [];
/** The entry an identifier (a compendium id, or a whole "Compendium....<id>" source) stands for, or null. */
export const entryById = (id) => BY_ID.get(String(id ?? "").split(".").pop()) ?? null;
const SUFFIX = /^(.*?)(\s*\(([^()]*)\)|\s*[x×]\s*\d+)$/i;
/** The entry of a type + English name ("Immunity (Cold)" finds Immunity). For provenance that is known otherwise (the wizard's mark, our catalogs). */
export function entryByName(type, name) {
  const n = String(name ?? "").trim();
  return entry(type, n) ?? (SUFFIX.test(n) ? entry(type, SUFFIX.exec(n)[1].trim()) : null);
}
const lowerFirst = (s) => s.charAt(0).toLocaleLowerCase("pl") + s.slice(1);
const param = (p) => { const k = p.trim().toLowerCase(); return PARAMS_PL[k] ?? p.trim(); };
/** What a Polish reader sees for the stored `name` of an item of entry `e`: the Polish name while the stored one is still the original
    (with its parameter kept), else the stored name untouched. Pure. */
export function shownName(name, e) {
  const n = String(name ?? "");
  if (!e || !n) return n;
  const t = n.trim(), same = (a, b) => a.toLowerCase() === b.toLowerCase();
  const cased = (pl) => (t.charAt(0) !== t.charAt(0).toUpperCase() ? lowerFirst(pl) : pl);
  if (same(t, e.en)) return cased(e.pl);
  const whole = NAMES_PL[e.type]?.[t];                                     // a name with a bracket that has a row of its own ("Burst Effect (Blast)")
  if (typeof whole === "string" && whole) return whole;
  const m = SUFFIX.exec(t);
  if (m && same(m[1].trim(), e.en)) return `${cased(e.pl)}${m[3] !== undefined ? ` (${param(m[3])})` : m[2].replace(/\s+/g, " ").replace(/^(?! )/, " ")}`;
  return n;
}
/** The four level words of the system in an automation's or a pregenerated item's English name -> the level id. */
export const LEVEL_WORDS = Object.freeze({ basic: "basic", major: "major", massive: "massive", monstrous: "monstrous" });
/* what the compendium's automations are called beside the item's own name (the few that recur; the rest stays as written) */
const AUTO_PL = Object.freeze({
  "normal": "zwykłe użycie", "attack": "atak", "reduce armor": "obniżenie Pancerza", "grapple": "chwyt", "area effect": "efekt obszarowy", "break free": "wyrwanie się",
  "wreck zone": "demolka strefy", "requires touch": "wymaga dotyku", "reduced range": "zmniejszony zasięg", "pull": "przyciągnięcie", "charge bonus": "premia do szarży",
});
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** One " - " segment of an automation name or a chat flavor, for an item of entry `e` whose name is shown as `shown`.
    "Major Flight" -> "Lot (Większy)", "4 zones" -> "strefy: 4", "Major" -> "Większy", "Reduce Armor" -> "obniżenie Pancerza".
    `level(id)` gives the Polish word of a level. Pure. */
export function shownSegment(seg, e, shown, level = (id) => id) {
  let s = String(seg ?? "").trim(), lv = null, hit = false;
  if (!s) return s;
  const z = /^(\d+)\s+zones?$/i.exec(s);
  if (z) return `strefy: ${Number(z[1])}`;
  if (LEVEL_WORDS[s.toLowerCase()]) return level(LEVEL_WORDS[s.toLowerCase()]);
  if (AUTO_PL[s.toLowerCase()]) return AUTO_PL[s.toLowerCase()];
  if (!e) return s;
  const rx = new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(e.en)}(?![\\p{L}\\p{N}])`, "iu");
  if (rx.test(s)) { hit = true; s = s.replace(rx, "$1").trim(); }
  const lm = /^(basic|major|massive|monstrous)\b\s*/i.exec(s);
  if (hit && lm) { lv = LEVEL_WORDS[lm[1].toLowerCase()]; s = s.slice(lm[0].length).trim(); }
  if (!hit) return String(seg).trim();
  const rest = s.replace(/^[\s\-–:]+|[\s\-–:]+$/g, "");
  const known = AUTO_PL[rest.toLowerCase()];      // U78: "Blast attack" -> "Wystrzał: atak" (the automation's own word after the item's name)
  return `${shown}${lv ? ` (${level(lv)})` : ""}${rest ? (known ? `: ${known}` : ` ${rest}`) : ""}`;
}
/** A whole automation name or flavor ("Blast - Major", "Major Flight - 4 zones", "Strike - Reduce Armor"). Pure. */
export const shownAuto = (text, e, shown, level) => String(text ?? "").split(/\s+[-–]\s+/).map((seg) => shownSegment(seg, e, shown, level)).join(" - ");

/* U78: some windows of the system name an automation WITHOUT carrying its item: the dialog that offers a power's uses ("Flight":
   "basic Flight - 2 zones" / "basic Flight - 4 zones"), the title of a confirmation ("Invincible: Concussion Turret - Blast attack").
   There the item is found by its English name standing in the text as a whole word (the longest such name wins). Pure. */
export function entryIn(text, types = NAME_TYPES) {
  const s = String(text ?? "");
  let best = null;
  if (!s.trim()) return null;
  for (const type of types) for (const en of Object.keys(NAMES_PL[type] ?? {})) {
    if (best && en.length <= best.en.length) continue;
    if (!new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(en)}(?![\\p{L}\\p{N}])`, "iu").test(s)) continue;
    const e = entry(type, en); if (e) best = e;
  }
  return best;
}
/** An automation's name (or a title ending with one) whose item is not at hand -> the shown text; untouched when no item is named in it. */
export function shownLoose(text, level = (id) => id, types = ["power"]) {
  const s = String(text ?? ""), e = entryIn(s, types);
  return e ? shownAuto(s, e, shownName(e.en, e), level) : s;
}

/* ------------------------------------------------------------------ items (pure: a plain object of the same shape works) */
const srcOf = (item) => item?._stats?.compendiumSource ?? item?._source?._stats?.compendiumSource ?? item?.flags?.core?.sourceId ?? null;
const rawName = (item) => item?._source?.name ?? item?.name ?? "";
/** The dictionary entry behind an item, or null (no source, a deleted or foreign source, another type than the entry's). */
/* the item's own id: a compendium entry opened from its pack, or an item of a pregenerated character (the entry whose name the item carries) */
function own(item) {
  const list = (OWN.get(item.id ?? item._id) ?? []).filter((e) => e.type === item.type), n = rawName(item);
  return list.find((e) => shownName(n, e) !== n) ?? list[0] ?? null;
}
export function entryOf(item) {
  try {
    if (!item || !NAMES_PL[item.type]) return null;
    const ok = (e) => (e && e.type === item.type ? e : null);
    return ok(entryById(srcOf(item))) ?? own(item) ?? (item.flags?.[MOD]?.chargenRun ? entryByName(item.type, rawName(item)) : null);
  } catch { return null; }
}
let forced = null;
/** Is the display layer on for this client? (`setLang` is for the checks.) */
export const active = () => (forced ?? globalThis.game?.i18n?.lang) === "pl";
export const setLang = (lang) => { forced = lang; };
/** The name this client shows for an item (the stored name in every language but Polish). */
export function displayName(item) {
  const n = rawName(item);
  if (!active()) return n;
  try { return shownName(n, entryOf(item)); } catch { return n; }
}
/** `text` that begins with (or is) the item's stored name, with the name swapped for the shown one ("Strike - Reduce Armor" -> "Cios - obniżenie Pancerza"). */
export function shownText(text, item) {
  const s = String(text ?? ""), en = rawName(item), shown = displayName(item);
  if (!s || !en || shown === en) return s;
  if (s === en) return shown;
  const e = entryOf(item);
  for (const sep of [": ", " - ", " – "]) if (s.startsWith(en + sep)) return `${shown}${sep}${shownAuto(s.slice(en.length + sep.length), e, shown, levelWord)}`;
  return shownAuto(s, e, shown, levelWord);
}
/** The Polish word of a power level, as the system's own label gives it ("Większy"). */
export function levelWord(id) {
  try { const k = `INVINCIBLE.Item.Power.FIELDS.level.${id}.label`, i18n = globalThis.game?.i18n; const w = i18n?.has?.(k) ? i18n.localize(k).trim() : ""; if (w && w.toLowerCase() !== String(id).toLowerCase()) return w; } catch { /* the table below */ }      // the system's English word (lang/pl.json not loaded yet: the server reads the language list at start) gives way to the table
  return ({ basic: "Podstawowy", major: "Większy", massive: "Potężny", monstrous: "Monstrualny" })[id] ?? String(id);
}
/** A power's label: the system glues "<level> <name>" (in Polish the level word does not agree with the name: "Większy Wiązka"), we write "<name> (<level>)". */
export const powerLabel = (name, level) => { const l = String(level ?? "").trim(); return l ? `${name} (${l})` : name; };
/** A name for one of OUR lists that knows the type and the English name of a compendium entry (the creator's catalog, the kit's rows). */
export function catalogName(type, name, id = null) {
  if (!active()) return String(name ?? "");
  return shownName(name, entryById(id) ?? entryByName(type, name));
}
/** Does `query` (lower case) find the entry by either of its names? For the search boxes of our own lists. */
export const matchesName = (query, type, name, id = null) => { const q = String(query ?? "").trim().toLowerCase(); return !q || String(name ?? "").toLowerCase().includes(q) || catalogName(type, name, id).toLowerCase().includes(q); };
/** For the checks: every (type, en, pl, ids) of the dictionary. */
export function allEntries() {
  const out = new Map();
  for (const [id, e] of BY_ID) { const k = `${e.type}|${e.en}`; if (!out.has(k)) out.set(k, { ...e, ids: [] }); out.get(k).ids.push(id); }
  return [...out.values()];
}

/* ------------------------------------------------------------------ Foundry: the templates we do not own */
const rootOf = (html) => (html instanceof HTMLElement ? html : html?.[0] ?? null);
/** Replace `from` by `to` in the text nodes that are direct children of `el` (never in a description below it). -> swapped? */
function swapIn(el, from, to) {
  if (!el || !from || from === to) return false;
  let done = false;
  for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.includes(from)) { n.nodeValue = n.nodeValue.replace(from, to); done = true; }
  return done;
}
const pairOf = (item) => { const en = rawName(item), shown = displayName(item); return shown !== en ? { en, shown } : null; };

/* the level beside a power on the sheet: the system prints its own label (English while lang/pl.json is not loaded, and for a power whose level is derived) */
const levelShown = (item, text) => { const id = LEVEL_WORDS[String(item.system?.level ?? "").toLowerCase()] ?? LEVEL_WORDS[String(text ?? "").trim().toLowerCase()]; return id ? levelWord(id) : String(text ?? "").trim(); };
/* an actor sheet of the system: every element that names an item carries data-item-id (templates/actor/*.hbs) */
function actorSheet(actor, el) {
  for (const host of el.querySelectorAll("[data-item-id]")) {
    const item = actor.items.get(host.dataset.itemId);
    if (!item) continue;
    const label = host.matches("label") ? host : host.querySelector(":scope > label, :scope > .item-name, :scope > div > label");
    if (item.type === "power") {
      const lvl = String(item.system?.powerLevel ?? ""), shown = displayName(item);
      if (label && lvl.trim()) swapIn(label, `${lvl}${rawName(item)}`, powerLabel(shown, levelShown(item, lvl))) || swapIn(label, rawName(item), shown);
      else if (label) swapIn(label, rawName(item), shown);
      /* its boosts and limits stand under it without an identifier: they are this actor's items of that power */
      for (const strong of host.querySelectorAll(":scope .boostLimit > strong")) {
        const text = strong.textContent.trim(), kids = actor.items.filter((i) => (i.type === "boost" || i.type === "limit") && rawName(i) === text);
        const kid = kids.find((i) => i.system?.power === item.id) ?? kids[0], p = kid ? pairOf(kid) : null;
        if (p) strong.textContent = p.shown;
      }
      continue;
    }
    const p = pairOf(item);
    if (p && label) swapIn(label, p.en, p.shown);
  }
}
/* the item's own sheet: the name field, the picture's tooltip, the window title, the boosts and limits of a power */
function itemSheet(app, item, el) {
  const p = pairOf(item);
  for (const d of el.querySelectorAll("details > summary")) {                // templates/item/attribute-parts/boosts.hbs, limits.hbs
    const uuid = d.parentElement.querySelector("[data-uuid]")?.dataset.uuid; let kid = null;
    try { kid = uuid ? fromUuidSync(uuid) : null; } catch { kid = null; }
    const kp = kid ? pairOf(kid) : null;
    if (kp) swapIn(d, kp.en, kp.shown);
  }
  if (!p) return;
  const input = el.querySelector('input[name="name"]');
  if (input && !input.dataset.ipuName) {
    input.dataset.ipuName = "1";
    const show = () => { if (document.activeElement !== input && input.value === rawName(item)) input.value = displayName(item); };
    input.addEventListener("focus", () => { if (input.value === displayName(item)) input.value = rawName(item); });      // editing starts from what is stored
    input.addEventListener("blur", () => setTimeout(show, 0));
    show();
  } else if (input && document.activeElement !== input && input.value === p.en) input.value = p.shown;
  if (input?.dataset.tooltipText === p.en) input.dataset.tooltipText = p.shown;
  for (const t of el.querySelectorAll(`[data-tooltip="${CSS.escape(p.en)}"]`)) t.dataset.tooltip = p.shown;
  const title = (app?.window?.title ?? el.querySelector(".window-header .window-title"));
  if (title && title.textContent.includes(p.en)) title.textContent = title.textContent.replace(p.en, p.shown);
}
/* the system's roll dialog of an item (it carries `item`): its heading and its window title name the item and the automation ("Blast - Basic") */
function rollDialog(app, el) {
  const item = app.item;
  looseTitle(el);
  if (!pairOf(item)) return;
  for (const node of el.querySelectorAll("label.title, .window-header .window-title")) for (const n of node.childNodes) {
    if (n.nodeType !== 3 || !n.nodeValue.includes(rawName(item))) continue;
    const text = n.nodeValue.trim(), at = text.indexOf(rawName(item));
    n.nodeValue = n.nodeValue.replace(text, text.slice(0, at) + shownText(text.slice(at), item));
  }
}
/* U78: a window of the system that names an automation but carries no item. Its title ends with the automation's name after the
   last " - " ("Invincible: Concussion Turret - Blast attack"); the dialog of a power's uses has the power's name as its title and
   one button per use. The roll window's pool shows an effect nobody named under Foundry's default name: said in the client's language. */
const textNodes = (node) => [...node.childNodes].filter((n) => n.nodeType === 3 && n.nodeValue.trim());
function looseTitle(el) {
  for (const node of el.querySelectorAll(".window-header .window-title, label.title")) for (const n of textNodes(node)) {
    const text = n.nodeValue.trim(), at = text.lastIndexOf(" - ");
    if (at < 0) { const whole = node.matches("label.title") ? shownLoose(text, levelWord) : text; if (whole !== text) n.nodeValue = n.nodeValue.replace(text, whole); continue; }
    const tail = text.slice(at + 3), shown = shownLoose(tail, levelWord);
    if (shown !== tail) { n.nodeValue = n.nodeValue.replace(text, text.slice(0, at + 3) + shown); continue; }
    const next = looseHead(text);      // U112
    if (next !== text) n.nodeValue = n.nodeValue.replace(text, next);
  }
}
/* U112: the window that asks the way to roll a power's use is titled "Invincilble: <flavor>" (sic, the system's chat-message.mjs), and
   the flavor is "<power> - <its use>" ("Strike - Normal"): the power's name stands before the last " - ", so the tail alone names
   no power. Then the whole text after the prefix ("Invincible: ", any word before the first ": ") is read as one automation's name.
   Pure: "Invincilble: Strike - Normal" -> "Invincilble: Cios - zwykłe użycie"; a text that names no power stays as written. */
export function looseHead(text, level = levelWord) {
  const s = String(text ?? ""), at = s.indexOf(": ");
  if (at < 0 || s.indexOf(" - ") < at) return s;
  const body = s.slice(at + 2), shown = shownLoose(body, level);
  return shown === body ? s : s.slice(0, at + 2) + shown;
}
function looseDialog(el) {
  looseTitle(el);
  const title = el.querySelector(".window-header .window-title"), name = title?.textContent.trim() ?? "";
  const e = name ? entryByName("power", name) : null;
  if (!e) return;
  const shown = shownName(name, e), buttons = [...el.querySelectorAll("button:not(.header-control)")];
  if (shown === name || !buttons.length) return;
  for (const b of buttons) for (const n of [b, ...b.querySelectorAll("span, label")].flatMap(textNodes)) {
    const text = n.nodeValue.trim(), next = shownAuto(text, e, shown, levelWord);
    if (next !== text) n.nodeValue = n.nodeValue.replace(text, next);
  }
  for (const n of textNodes(title)) n.nodeValue = n.nodeValue.replace(name, shown);
}
function unnamedEffects(el) {
  const now = game.i18n.localize("DOCUMENT.ActiveEffect");
  if (!now || now === "DOCUMENT.ActiveEffect") return;
  for (const l of el.querySelectorAll("label")) for (const n of textNodes(l)) if (/^active effect$/i.test(n.nodeValue.trim()) && n.nodeValue.trim() !== now) n.nodeValue = n.nodeValue.replace(n.nodeValue.trim(), now);
}
/* the sidebar's item lists: the world's items and the item compendia (templates/sidebar/*-entry-partial.hbs glue the level before a power's name) */
function directory(app, el) {
  const col = app.collection, index = col?.index ?? null;
  for (const li of el.querySelectorAll("li.directory-item.entry[data-entry-id], li.directory-item.document[data-entry-id]")) {
    const id = li.dataset.entryId, doc = index ? index.get(id) : col.get(id);
    if (!doc || !NAMES_PL[doc.type]) continue;
    const shown = index ? shownName(doc.name, entryById(id)) : displayName(doc), a = li.querySelector(".entry-name");
    if (!a || a.dataset.ipuName === shown) continue;
    const lv = doc.type === "power" && doc.system?.level ? levelWord(doc.system.level) : "";
    a.textContent = lv ? powerLabel(shown, lv) : shown;
    a.dataset.ipuName = shown;
    const img = li.querySelector("img.thumbnail"); if (img) img.alt = shown;
  }
}
/* a chat card: the flavor names the item (and its automation), the roll card lists the boosts and limits that took part. The names
   are stored text, so they are matched against the speaking actor's OWN items (never against the whole dictionary). */
function chatCard(message, el) {
  const actor = message.speakerActor ?? null, items = actor?.items ? [...actor.items].filter((i) => NAMES_PL[i.type]) : [];
  if (!items.length) return;
  const pairs = items.map((i) => ({ item: i, p: pairOf(i) })).filter((x) => x.p).sort((a, b) => b.p.en.length - a.p.en.length);
  if (!pairs.length) return;
  const has = (text, en) => new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(en)}(?![\\p{L}\\p{N}])`, "iu").test(text);
  for (const node of el.querySelectorAll(".flavor-text, .ipu-card-title, .roll-name")) for (const n of node.childNodes) {
    if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
    const text = n.nodeValue.trim(), hit = pairs.find((x) => has(text, x.p.en));
    if (!hit) continue;
    const typed = /^\[[^\]]+\]\s*/.exec(text), body = typed ? text.slice(typed[0].length) : text;
    const out = body.split(/\s+[-–]\s+/).map((seg) => shownSegment(seg, entryOf(hit.item), hit.p.shown, levelWord));
    n.nodeValue = n.nodeValue.replace(text, (typed ? typed[0] : "") + out.filter((s, i) => i === 0 || s !== out[0]).join(" - "));
  }
  for (const strong of el.querySelectorAll("ul.effects > li strong")) {       // "[Wzmocnienie] Deadly Blast"
    const m = /^(\[[^\]]+\]\s*)(.+)$/.exec(strong.textContent.trim()), hit = m ? pairs.find((x) => x.p.en === m[2].trim()) : null;
    if (hit) strong.textContent = `${m[1]}${hit.p.shown}`;
  }
}
/* searching a sidebar list by the Polish name: the core matches the stored names, we add the entries whose SHOWN name matches */
function wrapSearch() {
  const P = foundry?.applications?.sidebar?.DocumentDirectory?.prototype;
  if (!P || P.__ipuNames || typeof P._matchSearchEntries !== "function") return;
  const orig = P._matchSearchEntries, clean = (s) => foundry.applications.ux.SearchFilter.cleanQuery(s);
  P._matchSearchEntries = function (query, entryIds, folderIds, autoExpandIds, options) {
    const r = orig.call(this, query, entryIds, folderIds, autoExpandIds, options);
    try {
      const col = this.collection;
      if (active() && col?.documentName === "Item") for (const e of col.index ?? col.contents) {
        if (entryIds.has(e._id) || !NAMES_PL[e.type]) continue;
        const shown = col.index ? shownName(e.name, entryById(e._id)) : displayName(e);
        if (shown === e.name || !query.test(clean(shown))) continue;
        entryIds.add(e._id);
        for (let f = typeof e.folder === "string" ? col.folders?.get(e.folder) : e.folder, n = 0; f && n < 12; f = f.folder, n++) { folderIds.add(f._id); autoExpandIds.add(f._id); }
      }
    } catch { /* the core's own matches stand */ }
    return r;
  };
  P.__ipuNames = true;
}

let started = false;
function start() {
  if (started || game.system?.id !== SYSTEM) return;
  started = true;
  Hooks.on("renderApplicationV2", (app, element) => {
    try {
      if (!active()) return;
      const el = rootOf(element) ?? app?.element, doc = app?.document;
      if (!el?.querySelector) return;
      if (doc?.documentName === "Actor" && el.classList.contains(SYSTEM)) actorSheet(doc, el);
      else if (doc?.documentName === "Item") itemSheet(app, doc, el);
      else if (app?.collection?.documentName === "Item") directory(app, el);
      else if (app?.item?.documentName === "Item" && NAMES_PL[app.item.type]) rollDialog(app, el);
      else if (el.classList.contains("dialog") || app?.constructor?.name === "DialogV2") looseDialog(el);      // U78
      if (el.classList.contains("roll-application") || /RollDialog/.test(app?.constructor?.name ?? "")) unnamedEffects(el);      // U78
    } catch { /* cosmetic: the stored names stay */ }
  });
  Hooks.on("renderChatMessageHTML", (message, html) => { try { if (active()) chatCard(message, rootOf(html)); } catch { /* cosmetic */ } });
  /* the name field of an item sheet shows the Polish name: a submit that sends it back is not a rename */
  Hooks.on("preUpdateItem", (item, changes) => {
    try { if (active() && typeof changes?.name === "string" && changes.name !== rawName(item) && changes.name === displayName(item)) delete changes.name; } catch { /* the update goes through as sent */ }
  });
  const late = () => { try { wrapSearch(); } catch { /* the core's search stays */ } };
  if (game.ready) late(); else Hooks.once("ready", late);
}
/** Called when the module's script loads (see system-texts.mjs init: before or after the init hook). */
export function init() {
  if (globalThis.game?.system?.id) start(); else Hooks.once("init", start);
}
