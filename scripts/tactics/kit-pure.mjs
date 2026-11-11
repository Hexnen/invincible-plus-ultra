/* Tactical combat, package P6: WHAT A CHARACTER BRINGS TO A FIGHT. NO Foundry globals.
   `build(src)` reads the plain items of one actor (the system adapter makes them, system-adapter.mjs `kitSource`) against the book rows of
   kitdata-pure.mjs and returns the character's KIT:
     rows      one per item: { item, name, type, cat, key, lv, state: "auto" | "assist" | "hand" | "off", note, of?, unknown?, src }   (the GM's list)
     actions   catalog entries the character may declare (ids "k-<itemId>-<what>"); reaction entries carry `reaction`
     weapons   attack profiles: what Slugfest and Shoot can be made with ({ id: "<itemId>~<automationId>[+n]", ... }, flows/attack.mjs)
     unarmed   what the character's bare slugfest attack carries (Strike's boosts)
     pass      passive facts the flows read
     mods      dice the sheet does not carry ({ dice, action?, attack?, attr?, vsHuge?, source })
   An item is known by the GM's flag `flags.invincible-plus-ultra.tactics.kit` (a row's name), else by its English name; the flag `off`
   switches an item off for the fight (a lost item, a power source that is gone); `types` names what an Immunity or a Vulnerable is about.
   src = { items: [{ id, name, type, level, power, boosts: [id], autos: [{ id, name, type, show, attr: [..], bonus, stress, damage, min, max, bypass }],
                     fx: [{ id, name, on }], flags: { kit, off, types }, wf: { sharp, fullAuto, area } }], attrs: { fighting: n, ... } } */
import { ROWS, LEVELS } from "./kitdata-pure.mjs";
import { BUILTIN } from "./catalog-pure.mjs";

export const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const bare = (s) => norm(String(s ?? "").replace(/\([^)]*\)/g, ""));
export const CAT_OF = Object.freeze({ power: "power", boost: "boost", limit: "limit", talent: "talent", drawback: "drawback", gear: "gear", vehicleWeapon: "gear" });
export const STATES = Object.freeze(["auto", "assist", "hand"]);
const LEVEL_RX = /[\s\-–:(]*\b(basic|major|massive|monstrous)\b\)?\s*$/i;

const INDEX = (() => {
  const exact = new Map(), prefix = [];
  const put = (k, r) => { if (!exact.has(k)) exact.set(k, []); exact.get(k).push(r); };
  for (const r0 of ROWS) {
    const r = { ...r0, key: norm(r0.name) };
    for (const n of new Set([r.name, ...(r.names ?? [])].flatMap((x) => [norm(x), bare(x)]))) put(n, r);
    if (r.prefix) prefix.push(r);
  }
  return { exact, prefix, all: [...new Set([...exact.values()].flat())] };
})();
export const rowByKey = (key) => INDEX.all.find((r) => r.key === norm(key)) ?? null;
/** The book row of an item: the GM's flag, the exact name, the name without its bracket, a row that is a prefix of the name. */
export function rowFor(item, parentName = "") {
  const cat = CAT_OF[item?.type] ?? null;
  const best = (list) => { if (!list?.length) return null; const same = list.filter((r) => r.cat === cat); const pool = same.length ? same : cat ? [] : list; return pool.find((r) => r.of && norm(r.of) === norm(parentName)) ?? pool[0] ?? null; };
  if (item?.flags?.kit) { const r = rowByKey(item.flags.kit); if (r) return r; }
  return best(INDEX.exact.get(norm(item?.name))) ?? best(INDEX.exact.get(bare(item?.name))) ?? best(INDEX.prefix.filter((r) => norm(item?.name).startsWith(r.key))) ?? null;
}
const lvWord = (s) => { const m = LEVEL_RX.exec(String(s ?? "")); return m ? LEVELS.indexOf(m[1].toLowerCase()) : -1; };
const baseName = (s) => String(s ?? "").replace(LEVEL_RX, "").trim();
/** The level of a power: its own field, else the highest level its visible automations name. -> 0..3 */
export function levelOf(item) {
  const own = LEVELS.indexOf(String(item?.level ?? "").toLowerCase());
  if (own >= 0) return own;
  return Math.max(0, ...(item?.autos ?? []).filter((a) => a.show !== false).map((a) => lvWord(a.name)));
}
/** The automations that count at the item's level: of several that differ only by a level word, the one of that level (else the highest below it). */
export function autosAt(item, lv) {
  const groups = new Map();
  for (const a of item?.autos ?? []) { const k = `${a.type}|${norm(baseName(a.name))}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(a); }
  const out = [];
  for (const list of groups.values()) {
    const lvd = list.filter((a) => lvWord(a.name) >= 0);
    if (lvd.length < 2) { out.push(...list); continue; }
    const at = lvd.filter((a) => lvWord(a.name) <= lv).sort((x, y) => lvWord(y.name) - lvWord(x.name))[0] ?? lvd.sort((x, y) => lvWord(x.name) - lvWord(y.name))[0];
    out.push(at, ...list.filter((a) => lvWord(a.name) < 0));
  }
  return out;
}
const at = (v, lv) => (Array.isArray(v) ? v[Math.max(0, Math.min(v.length - 1, lv))] : v);
const kid = (item, k) => `k-${String(item.id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 16)}-${String(k).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 12)}`;
const pos = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.trunc(Number(n)) : 0);

/* ------------------------------------------------------------------ attack profiles */
function patchProfile(p, patch = {}, attrs = {}) {
  const o = { ...p };
  if (patch.attrs) o.attr = patch.attrs.slice().sort((x, y) => (Number(attrs[y]) || 0) - (Number(attrs[x]) || 0))[0];
  for (const k of ["ignoreArmor", "sharp", "noDamage", "sweep"]) if (patch[k]) o[k] = true;
  if (patch.area === 1) o.area = true; else if (patch.area === 0) o.area = false;
  if (patch.stress) o.stress = (o.stress ?? 0) + patch.stress;
  if (patch.range) o.range = patch.range.slice();
  if (patch.fam) { o.fam = patch.fam; if (patch.fam === "slug") { o.range = null; if (!patch.attrs) o.attr = null; } }
  if (patch.damagePlus && o.damage != null) o.damage += patch.damagePlus;
  if (patch.onHit) o.onHit = { ...patch.onHit };
  if (patch.onHitData && o.onHit) o.onHit = { ...o.onHit, data: { ...(o.onHit.data ?? {}), ...patch.onHitData } };
  if (patch.onHitStatus && o.onHit) o.onHit = { ...o.onHit, status: patch.onHitStatus, data: undefined };
  if (patch.resist && o.onHit?.stun) o.onHit = { ...o.onHit, resist: (o.onHit.resist ?? 0) + patch.resist };
  return o;
}
function profileOf(item, row, a, lv, attrs) {
  const key = norm(baseName(a.name)), byKey = Object.keys(row?.atk?.by ?? {}).find((k) => norm(k) === key), h = { ...(row?.atk ?? {}), ...(byKey ? row.atk.by[byKey] : {}) };
  if (h.skip) return null;
  const min = pos(a.min), max = pos(a.max), range = h.range ? h.range.slice() : max > 0 || min > 0 ? [min, max] : null, fam = h.fam ?? (range && (range[1] > 0 || h.range) ? "shoot" : "slug");
  const dflt = fam === "shoot" ? "agility" : "fighting", set = (a.attr ?? []).filter(Boolean);
  const p = { id: `${item.id}~${a.id}`, item: item.id, name: String(set.length || row ? baseName(a.name) || item.name : item.name).slice(0, 60), of: String(item.name ?? "").slice(0, 60), fam,
    attr: !set.length || set.includes(dflt) ? null : set.slice().sort((x, y) => (Number(attrs[y]) || 0) - (Number(attrs[x]) || 0))[0],
    bonus: Math.trunc(Number(a.bonus) || 0), damage: pos(a.damage) || null, range: fam === "shoot" ? range ?? [0, 1] : null, stress: pos(a.stress),
    sharp: item.wf?.sharp === true, fullAuto: item.wf?.fullAuto === true, area: item.wf?.area === true || h.area === 1, source: h.source ?? undefined,
    toStress: h.toStress === 1, ignoreArmor: h.ignoreArmor === 1 || a.bypass === true, halveArmor: h.halveArmor === 1, noDamage: h.noDamage === 1, pierce: h.pierce === 1,
    stunts: h.stunts ?? undefined, immuneHuge: h.immuneHuge === 1, always: h.always ?? undefined, state: row && row.cat !== "gear" ? row.state : "auto" };
  if (h.onHit) p.onHit = h.onHit.status ? { status: h.onHit.status, data: h.onHit.lv ? { dice: at(h.onHit.lv, lv) } : h.onHit.data } : { ...h.onHit };
  if (h.throws) p.onHit = { throw: at(h.throws, lv) };
  if (fam === "slug" && range && range[1] > 0) p.reach = range[1];
  return p;
}

/* ------------------------------------------------------------------ actions */
const AS = { orders: "orders", slugfest: "slugfest", shoot: "shoot", rally: "rally", persuade: "persuade" };
function actionOf(item, row, a, lv, extra = {}) {
  const id = kid(item, a.k), meta = { item: item.id, key: row?.key ?? null, k: a.k };
  let e;
  if (a.as && BUILTIN[AS[a.as]]) {                                                  // a builtin action the row changes (cost, attribute, dice)
    const b = BUILTIN[AS[a.as]];
    e = { ...b, id, tags: [...(b.tags ?? []), "kit"], cost: a.cost ?? b.cost };
    if (a.attr || a.dice) e.roll = { ...(b.roll ?? {}), ...(a.attr ? { attr: a.attr } : {}), ...(a.dice ? { mods: [{ source: `kit:${row.key}`, dice: a.dice }] } : {}) };
    if (a.other) e.target = { ...(b.target ?? { who: "ally" }), n: [1, 1] };
    if (a.self) delete e.target;
    if (a.unarmed) e.unarmed = 1;
    delete e.when;
  } else {
    e = { id, src: row?.src ?? [], kind: "kit", cost: a.cost ?? "full", flow: "act", tags: ["kit"], effect: { ...(a.effect ?? { kind: "narrative" }) } };
    for (const k of ["roll", "oppose", "target", "when", "pick"]) if (a[k]) e[k] = JSON.parse(JSON.stringify(a[k]));
    for (const k of ["text", "sameZone", "touch", "gm", "anytime", "immuneHuge"]) if (a[k]) e[k] = 1;
    if (a.once) e.once = a.once;
    for (const k of ["lv", "armor"]) if (Array.isArray(e.effect[k])) e.effect[k] = at(e.effect[k], lv);
    if (a.reaction) {
      const who = ["autoMiss", "note"].includes(a.reaction) && a.k !== "warn" ? "target" : "any";
      Object.assign(e, { flow: "plain", reaction: { when: ["beforeRoll"], who, effect: a.reaction }, interrupt: { on: ["beforeRoll"] }, reactionOnly: 1 });
    }
  }
  if (a.stress) e.stress = { fixed: a.stress };
  return { ...e, label: `ITAC.kit.act.${a.label ?? a.k}`, name: String(a.name ?? item.name ?? "").slice(0, 80), kit: { ...meta, state: extra.state ?? row?.state ?? "assist", cat: row?.cat ?? CAT_OF[item.type] ?? "gear", lv }, ...(extra.entry ?? {}) };
}

/** The kit of one actor. Never throws on odd data: an item it cannot read is listed "by hand". */
export function build(src = {}) {
  const items = Array.isArray(src.items) ? src.items : [], attrs = src.attrs ?? {}, byId = new Map(items.map((i) => [i.id, i]));
  const kit = { rows: [], actions: [], weapons: [], unarmed: {}, pass: { immune: [], vulnerable: [] }, mods: [] };
  const parentOf = (it) => byId.get(it.power) ?? items.find((p) => p.type === "power" && (p.boosts ?? []).includes(it.id)) ?? null;
  const known = items.map((it) => { let row = null; try { row = rowFor(it, parentOf(it)?.name); } catch { row = null; } return { it, row, lv: 0 }; });
  for (const x of known) { const p = ["boost", "limit"].includes(x.it.type) ? parentOf(x.it) : x.it; x.lv = levelOf(p ?? x.it); x.parent = p !== x.it ? p : null; }
  const live = (x) => x.it.flags?.off !== true && !(x.parent && x.parent.flags?.off === true);
  const optsOf = (power) => known.filter((x) => x.parent === power && live(x) && x.row?.opt);

  for (const x of known) {
    const { it, row, lv } = x, cat = row?.cat ?? CAT_OF[it.type] ?? null;
    if (!cat) continue;                                                              // power sources, injuries: not what this list is about
    const rec = { item: it.id, name: String(it.name ?? "").slice(0, 80), type: it.type, cat, key: row?.key ?? null, lv, src: row?.src ?? [], state: row?.state ?? "hand", note: row?.note ?? "unknown" };
    if (x.parent) rec.of = String(x.parent.name ?? "").slice(0, 60);
    if (!row) rec.unknown = 1;
    kit.rows.push(rec);
    if (!live(x)) { rec.state = "off"; rec.note = "off"; continue; }
    try {
      const autos = autosAt(it, lv), attacks = autos.filter((a) => a.type === "rollAttack"), uses = autos.filter((a) => ["usePower", "rollAttribute", "useGear"].includes(a.type));
      /* attack profiles: the item's own attack automations, each with the boosts of the power */
      if (!row?.mounted) for (const a of attacks) {
        let p = profileOf(it, row, a, lv, attrs);
        if (!p) continue;
        for (const o of optsOf(it).filter((o) => !o.row.opt.optional && !o.row.opt.on && o.row.opt.patch)) p = patchProfile(p, { ...o.row.opt.patch, stress: o.row.opt.stress }, attrs);
        kit.weapons.push(p);
        let n = 0;
        for (const o of optsOf(it).filter((o) => o.row.opt.optional && !o.row.opt.on)) kit.weapons.push({ ...patchProfile(p, { ...o.row.opt.patch, stress: o.row.opt.stress }, attrs), id: `${p.id}+${n++}`, tag: String(o.it.name).slice(0, 40) });
        for (const o of row?.opts ?? []) kit.weapons.push({ ...patchProfile(p, { ...o.patch, stress: o.stress }, attrs), id: `${p.id}+${n++}`, opt: o.k });
      }
      if (!row && attacks.length) { rec.state = "auto"; rec.note = "weapon"; }
      if (row?.mounted && !attacks.length) { /* a vehicle's weapon: fired through the vehicle's own actions (P7) */ }
      /* a boost of the bare slugfest attack (Strike) */
      if (row?.opt?.on === "slug" && x.parent) {
        if (row.opt.optional) kit.weapons.push({ id: `unarmed~${it.id}`, item: it.id, name: rec.name, of: rec.of, fam: "slug", attr: null, bonus: 0, damage: null, range: null, stress: row.opt.stress ?? 0, state: row.state, ...Object.fromEntries(Object.entries(row.opt.patch).map(([k, v]) => [k, v === 1 ? true : v])) });
        else Object.assign(kit.unarmed, Object.fromEntries(Object.entries(row.opt.patch).map(([k, v]) => [k, v === 1 ? true : v])));
      }
      /* the row's own actions; else what the sheet's use / roll buttons say, as an action whose effect the GM confirms */
      const luck = row?.key === "luckcontrol" ? optsOf(it).map((o) => o.row.opt.luck).filter(Boolean) : [];
      for (const a of row?.acts ?? []) {
        const b = luck.length && a.pick ? { ...a, pick: a.pick.filter((p) => luck.includes(p)) } : a;
        kit.actions.push(actionOf(it, row, b, lv));
      }
      if (row && !row.acts && row.state !== "hand" && !row.mv || !row) {
        uses.slice(0, 6).forEach((a, i) => {
          const set = (a.attr ?? []).filter(Boolean), byKey = Object.keys(row?.by ?? {}).find((k) => norm(k) === norm(baseName(a.name)));
          const roll = set.length === 1 ? { attr: set[0] } : set.length > 1 ? { attrs: set } : a.type === "rollAttribute" ? { attrs: "any" } : null;
          if (roll && a.bonus) roll.mods = [{ source: `kit:${row?.key ?? "item"}`, dice: Math.trunc(a.bonus) }];
          kit.actions.push(actionOf(it, row, { k: `u${i}`, label: "use", name: baseName(a.name) && norm(baseName(a.name)) !== norm(it.name) ? `${it.name}: ${baseName(a.name)}` : it.name, cost: row?.by?.[byKey]?.cost ?? row?.cost ?? (cat === "gear" ? "quick" : "full"),
            stress: pos(a.stress) || undefined, roll, effect: { kind: "narrative" }, text: 1 }, lv, { state: "assist" }));
        });
        if (row && !row.acts && !uses.length && !attacks.length && !row.fx && !row.pass && !row.mods && !row.opt && ["zone", "outcome", "gmCard", "roll"].includes(row.note) && row.state === "assist")
          kit.actions.push(actionOf(it, row, { k: "u0", label: "use", cost: row.cost ?? "full", effect: { kind: "narrative" }, text: 1, roll: { attrs: "any", optional: true } }, lv));
        if (!row && uses.length) { rec.state = "assist"; rec.note = "unknown"; }
      }
      /* switching the item's active effects from the dock */
      if (row?.fx) {
        const host = row.fx.ofParent ? x.parent : it, list = (host?.fx ?? []).filter((f) => !row.fx.only || norm(f.name).includes(norm(row.fx.only)));
        list.slice(0, 4).forEach((f, i) => kit.actions.push(actionOf(it, row, { k: `fx${i}`, label: "toggle", name: String(f.name ?? host.name), cost: row.fx.cost ?? "quick", stress: row.fx.stress, gm: row.fx.gm,
          effect: { kind: "toggle", item: host.id, fx: f.id } }, lv, { entry: { fxOn: f.on === true } })));
        if (!list.length && !row.mv && !row.pass) { rec.state = "hand"; rec.note = "toggle"; }
      }
      /* passive facts and dice */
      for (const [k, v] of Object.entries(row?.pass ?? {})) {
        if (k === "immune" || k === "vulnerable") kit.pass[k].push(...(v === "flag" ? (it.flags?.types ?? []) : v).map((s) => String(s).slice(0, 24)));
        else if (Array.isArray(v) && typeof v[0] === "number") kit.pass[k] = Math.max(kit.pass[k] ?? 0, at(v, lv));
        else kit.pass[k] = Array.isArray(v) ? v.slice() : v === 1 ? true : v;
      }
      if (["immune", "vulnerable"].some((k) => row?.pass?.[k] === "flag") && !(it.flags?.types ?? []).length) rec.needs = "types";
      for (const m of row?.mods ?? []) kit.mods.push({ dice: at(m.lv ?? m.dice, lv), ...(m.action ? { action: m.action.slice() } : {}), ...(m.attack ? { attack: m.attack.slice() } : {}), ...(m.attr ? { attr: m.attr } : {}), ...(m.vsHuge ? { vsHuge: 1 } : {}), ...(m.gm ? { gm: m.gm } : {}), source: `kit:${row.key}`, name: rec.name });
    } catch { rec.state = "hand"; rec.note = "unknown"; }
  }
  kit.pass.immune = [...new Set(kit.pass.immune)].slice(0, 24); kit.pass.vulnerable = [...new Set(kit.pass.vulnerable)].slice(0, 24);
  kit.actions = kit.actions.slice(0, 60); kit.weapons = kit.weapons.slice(0, 40);
  return kit;
}
export const EMPTY = Object.freeze({ rows: [], actions: [], weapons: [], unarmed: {}, pass: { immune: [], vulnerable: [] }, mods: [] });
/** Dice of the kit for a roll: { action, attack, attr, target } -> [{ source, dice }] (a rule that needs the GM's word is left to the GM) */
export function modsFor(kit, { action = null, attack = null, attr = null, target = null } = {}) {
  return (kit?.mods ?? []).filter((m) => !m.gm && (!m.action || m.action.includes(action)) && (!m.attack || m.attack.includes(attack)) && (!m.attr || m.attr === attr) && (m.action || m.attack) && (!m.vsHuge || target?.huge === true))
    .map((m) => ({ source: m.source, dice: m.dice }));
}
/** How the book's entries stand: counts per category and state, for the report and the checks. */
export function coverage() {
  const out = {};
  for (const r of INDEX.all) { const c = (out[r.cat] ??= { auto: 0, assist: 0, hand: 0, total: 0 }); c[r.state]++; c.total++; }
  return out;
}
export const allRows = () => INDEX.all.slice();
