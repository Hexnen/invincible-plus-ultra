import * as Names from "./item-names.mjs";
/* ITEM NAMES: the kit is built from the stored (English) names, which is what recognises a power or a talent; what it SHOWS (the rows of
   the abilities list, the uses, the attack profiles, the sources of dice) takes the name this client displays (i18n/item-names.mjs).
   Only texts change: ids, keys and `sheetSkip` (matched against the sheet's own effect names) stay as built. */
export function showKit(kit, actor) {
  try {
    if (!Names.active()) return kit;
    const item = (id) => actor?.items?.get?.(id) ?? null, nm = (id, text) => { const it = item(id); return it && typeof text === "string" ? Names.shownText(text, it).slice(0, 120) : text; };
    const parent = (id) => { const it = item(id); if (!it) return null; const p = it.system?.power; return (typeof p === "string" && item(p)) || actor.items.find((x) => x.type === "power" && (x.system?.boosts ?? []).includes?.(it.id)) || null; };
    const of = (id, text) => { const p = parent(id); return p && typeof text === "string" ? Names.shownText(text, p) : text; };
    const seen = new Map(kit.rows.map((r) => [r.name, nm(r.item, r.name)])), byRow = (text) => seen.get(text) ?? [...seen].find(([en]) => en.startsWith(text))?.[1] ?? text;
    return { ...kit,
      rows: kit.rows.map((r) => ({ ...r, name: nm(r.item, r.name), ...(r.of ? { of: of(r.item, r.of) } : {}), ...(r.lacks ? { lacks: Names.catalogName("talent", r.lacks) } : {}) })),
      actions: kit.actions.map((a) => (a.name && a.kit?.item ? { ...a, name: nm(a.kit.item, a.name) } : a)),
      weapons: kit.weapons.map((w) => ({ ...w, ...(w.name ? { name: nm(w.item, w.name) } : {}), ...(w.of ? { of: of(w.item, w.of) } : {}), ...(w.tag ? { tag: byRow(w.tag) } : {}) })),
      mods: kit.mods.map((m) => (m.name ? { ...m, name: byRow(m.name) } : m)) };
  } catch (err) { console.warn(`invincible-plus-ultra | tactics: kit names`, err); return kit; }
}
