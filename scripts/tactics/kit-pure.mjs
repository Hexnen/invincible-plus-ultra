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
                     fx: [{ id, name, on }], flags: { kit, off, types, alt }, wf: { sharp, fullAuto, area } }], attrs: { fighting: n, ... } } */
import { ROWS, LEVELS } from "./kitdata-pure.mjs";
import { powerLevel } from "./levels-pure.mjs";
import { note } from "./trace-pure.mjs";
import { BUILTIN } from "./catalog-pure.mjs";
import { weapons as bookWeapons } from "../rules/index.mjs";

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
  const find = (name) => best(INDEX.exact.get(norm(name))) ?? best(INDEX.exact.get(bare(name))) ?? best(INDEX.prefix.filter((r) => norm(name).startsWith(r.key)));
  return find(item?.name) ?? find(String(item?.name ?? "").replace(/[\s(]*[x×]\s*\d+\)?\s*$/i, "")) ?? null;     // "Durable x3": a talent taken several times on one item
}
const lvWord = (s) => { const m = LEVEL_RX.exec(String(s ?? "")); return m ? LEVELS.indexOf(m[1].toLowerCase()) : -1; };
const baseName = (s) => String(s ?? "").replace(LEVEL_RX, "").trim();
const useName = (it, a) => { const b = baseName(a.name), n = String(it.name ?? ""); return b.toLowerCase().startsWith(n.toLowerCase()) ? b.slice(n.length).replace(/^[\s\-–:]+/, "").trim() : b; };   // "Strike - Reduce Armor" on Strike -> "Reduce Armor"
/** The level of a power: its own field, else the highest level its visible automations name, else basic (the system's reading,
    levels-pure.powerLevel: D125). -> 0..3 */
export const levelOf = (item) => powerLevel(item?.level, item?.autos).lv;
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
/** the row of the book's weapon table behind a gear row of the kit (null for powers and for gear that is no weapon) */
const bookRow = (row) => (row?.cat === "gear" && row.weapon ? bookWeapons.WEAPONS[row.name] ?? null : null);
function patchProfile(p, patch = {}, attrs = {}, lv = 0) {
  const o = { ...p };
  if (patch.attrs) o.attr = patch.attrs.slice().sort((x, y) => (Number(attrs[y]) || 0) - (Number(attrs[x]) || 0))[0];
  for (const k of ["ignoreArmor", "sharp", "noDamage", "sweep", "immuneHuge"]) if (patch[k]) o[k] = true;
  if (patch.sweep) o.onHit = { throw: 0, zones: 1, sweep: 1 };                       // PWD (PW056) [B1832]: the target goes into an adjacent zone of the attacker's choice, no damage
  if (patch.area === 1) o.area = true;
  else if (patch.area === 0) { o.area = false; if (o.always?.includes("area")) { const al = o.always.filter((x) => x !== "area"); if (al.length) o.always = al; else delete o.always; } }      // PWA (PW016) [B1675]: Shockwave aims at one target: the area the power always has is gone too
  if (patch.rangeLv) o.range = at(patch.rangeLv, lv).slice();                         // PWA: a range that grows with the power's level (Shockwave [B1675]; the same [[min, max] per level] as a hint's rangeLv, PWC)
  if (patch.stress) o.stress = (o.stress ?? 0) + patch.stress;
  if (patch.range) o.range = patch.range.slice();
  if (patch.fam) { o.fam = patch.fam; if (patch.fam === "slug") { o.range = null; if (!patch.attrs) o.attr = null; } }
  if (patch.damagePlus && o.damage != null) o.damage += patch.damagePlus;
  if (patch.onHit) o.onHit = { ...patch.onHit };
  if (patch.onHitData && o.onHit) o.onHit = { ...o.onHit, data: { ...(o.onHit.data ?? {}), ...patch.onHitData } };
  if (patch.onHitStatus && o.onHit) o.onHit = { ...o.onHit, status: patch.onHitStatus, data: undefined };
  if (patch.resist && o.onHit?.stun) o.onHit = { ...o.onHit, resist: (o.onHit.resist ?? 0) + patch.resist };
  if (patch.several) o.several = patch.several;                                     // PWC (PW006) [B1610]
  if (patch.quake === 0) delete o.quake;                                            // PWC: Shockwave wrecks no zone [B1675]
  if (patch.zoneFire) o.zoneFire = patch.zoneFire;                                  // PWC (PW024) [B1692]
  if (patch.stressOn) o.stressOn = patch.stressOn;                                  // PWC (PW009)
  return o;
}
/* PWC (PW007, PW011) [B1575], [B1596], [B1626]: "you CAN roll for any mental attribute instead of AGILITY": the player's choice. The
   power's attack rolls the best mental attribute; when the attack's own attribute (AGILITY for a shot, FIGHTING for a blow made by touch)
   rolls more dice, a variant with it is offered as well (the boost's "armor has no effect" stays on both: the book says "also"). */
const ownAttrOf = (p) => (p.fam === "shoot" ? "agility" : "fighting");
function profileOf(item, row, a, lv, attrs, many = false) {
  const key = norm(baseName(a.name)), byKey = Object.keys(row?.atk?.by ?? {}).find((k) => norm(k) === key), h = { ...(row?.atk ?? {}), ...(byKey ? row.atk.by[byKey] : {}) };
  if (h.skip) return null;
  /* a weapon of the book's table [B2557-2675] keeps the whole of its row, not only what the item's automation can say: a range of "0/0" is
     a ranged weapon used inside the zone (the system stores it as "no range": Taser, Pepper Spray [B2513], [B2538]), and the features
     STUN effect, Single Use and No Movement have no field on the item at all. The item's own range wins when it carries one. */
  const book = bookRow(row), min = pos(a.min), max = pos(a.max), own = max > 0 || min > 0;
  if (book && !own && !book.range && book.miles) return null;                        // a range in miles is not a range in zones [A26]: nothing the engine can aim
  /* PWD (PW054, PW057): a number of the compendium that the book contradicts is put right only while the item still carries exactly that number */
  const fix = Array.isArray(h.errata) ? h.errata[Math.max(0, Math.min(h.errata.length - 1, lv))] : null, wrong = !!fix && lvWord(a.name) === lv && (fix.from.damage == null || pos(a.damage) === fix.from.damage) && (!fix.from.range || (min === fix.from.range[0] && max === fix.from.range[1]));
  const range = h.rangeLv ? at(h.rangeLv, lv).slice() : h.range ? h.range.slice() : wrong && fix.to.range ? fix.to.range.slice() : own ? [min, max] : book?.range ? book.range.slice() : null, fam = h.fam ?? (range && (range[1] > 0 || h.range || (!own && book?.range)) ? "shoot" : "slug");
  const dflt = fam === "shoot" ? "agility" : "fighting", set = (a.attr ?? []).filter(Boolean);
  const p = { id: `${item.id}~${a.id}`, item: item.id, name: String(many && useName(item, a) ? `${item.name}: ${useName(item, a)}` : item.name).slice(0, 60), of: String(item.name ?? "").slice(0, 60), fam,
    attr: !set.length || set.includes(dflt) ? null : set.slice().sort((x, y) => (Number(attrs[y]) || 0) - (Number(attrs[x]) || 0))[0],
    ...(h.reactOnly === 1 ? { reactOnly: true } : {}),      // PWB: an attack made only as an answer (Redirecting Blast [B1889]): never picked for a plain Shoot
    bonus: Math.trunc(Number(a.bonus) || 0), damage: (wrong && fix.to.damage) || pos(a.damage) || null, range: fam === "shoot" ? range ?? [0, 1] : null, stress: pos(a.stress),
    sharp: item.wf?.sharp === true, fullAuto: item.wf?.fullAuto === true, area: item.wf?.area === true || h.area === 1, source: h.source ?? undefined,
    /* PWA (PW101, PW102): the system's "bypass armor" switch is set on items whose book text says the opposite (Distress [B1591], Stun
       [B1625]: they have to get through Armor); where the book has a row, the row says whether Armor counts. Only an item without a row
       keeps the switch. */
    toStress: h.toStress === 1, ignoreArmor: h.ignoreArmor === 1 || (!row?.atk && a.bypass === true), halveArmor: h.halveArmor === 1, noDamage: h.noDamage === 1, pierce: h.pierce === 1,
    stunts: h.stunts ?? undefined, immuneHuge: h.immuneHuge === 1, always: h.always ?? undefined, state: row && row.cat !== "gear" ? row.state : "auto" };
  if (h.nonLiving) p.nonLiving = true;                                               // PWE (PW093) [B1984-1985]: only against the non-living, the GM has the last word
  if (h.onHit) p.onHit = h.onHit.status ? { status: h.onHit.status, data: h.onHit.lv ? { dice: at(h.onHit.lv, lv) } : h.onHit.data } : { ...h.onHit };
  if (h.onHit?.burn && p.damage > 0) p.onHit = { ...p.onHit, data: { intensity: p.damage } };      // PWC (PW022) [B1690-1694]: the fire's Intensity is the attack's base Damage
  if (h.throws) p.onHit = { throw: at(h.throws, lv), ...(h.zones ? { zones: at(h.zones, lv) } : {}) };      // Z11 [B1822], [B1826-1828]: damage at each impact, and how far
  if (h.pull) p.onHit = { pull: 1 };                                                  // PWA (PW088) [B2029]: the target is pulled into the attacker's zone
  if (h.grip) p.grip = h.grip;                                                       // PWA (PW048) [B1779]: a grapple made with this attack leaves the target in this status, no hold kept
  if (h.vsConductive) p.vsConductive = h.vsConductive;                              // PWC (PW019) [B1680]
  if (h.quake) p.quake = at(h.quake, lv);                                           // PWC (PW017, PW018) [B1671-1674]: how many adjacent zones the quake covers
  if (fam === "slug" && range && range[1] > 0) p.reach = range[1];
  if (fam === "slug" && h.reach) p.reach = Math.max(p.reach ?? 0, at(h.reach, lv));      // PWD (PW049) [B1778-1784]: Plant Control reaches the zones its plants cover
  if (h.noCounter === 1) p.noCounter = true;                                          // PWD (PW047) [B1779]: blocked, but no counterattack against the user
  if (h.wreckWeight && fam === "shoot") p.wreckWeight = at(h.wreckWeight, lv);        // PWD (PW044) [B1745]: Matter Control wrecks the zone the matter comes from
  if (wrong) p.errata = 1;
  if (book?.stunEffect) p.stunEffect = true;                                         // [B2576], [B2583]; a mark, the book gives it no mechanics [A25]
  if (book?.singleUse) p.singleUse = true;                                           // [B2541]
  if (book?.noMovement) p.noMove = true;                                             // [B2545]
  return p;
}

const USES = ["usePower", "rollAttribute", "useGear"];
const hintOf = (row, a) => { const k = Object.keys(row?.atk?.by ?? {}).find((x) => norm(x) === norm(baseName(a.name))); return k ? row.atk.by[k] : null; };

/* ------------------------------------------------------------------ actions */
const AS = { orders: "orders", slugfest: "slugfest", shoot: "shoot", rally: "rally", persuade: "persuade" };
const multisets = (list, n, from = 0) => (n <= 0 ? [[]] : list.slice(from).flatMap((x, i) => multisets(list, n - 1, from + i).map((r) => [x, ...r])));
/* PWB: the window an act of the kit answers in (catalog-pure `reaction`), ONE reading for every power the book lets a character use out of
   turn as the answer to an attack. `window` = "afterDamage" for an answer to damage taken (Redirecting Blast [B1889]), else before the
   dice [B2292]; `vs` = the family of attack it answers ("shooting": Quick Blast [B1585], "slugfest": Sudden Strike [B1619], "absorbed":
   damage the character's Armor stopped [B1889]); `mode` = the way of moving of an interrupt move (Untouchable Speed [B2018], Quick
   Teleport [B2039]). Who may give the answer: the attacked one, except a warning, a guide and a guardian, given for somebody else. */
const FOR_OTHERS = ["warn", "guide", "swapTarget"];
function reactionOf(a) {
  const w = a.window ?? "beforeRoll", who = FOR_OTHERS.includes(a.reaction) ? "any" : "target";      // D113: Discretion moves the attack off its own holder; a warning is shouted for somebody else
  return { reaction: { when: [w], who, effect: a.reaction, ...(a.place ? { place: a.place } : {}), ...(a.check ? { roll: a.check } : {}), ...(a.vs ? { vs: a.vs } : {}), ...(a.mode ? { mode: a.mode } : {}) }, interrupt: { on: [w] } };
}
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
    if (a.reaction) Object.assign(e, reactionOf(a), { reactionOnly: 1 });             // PWB: an attack made as the answer to one (Quick Blast [B1585], Sudden Strike [B1619], Redirecting Blast [B1889])
  } else {
    e = { id, src: row?.src ?? [], kind: "kit", cost: a.cost ?? "full", flow: "act", tags: ["kit"], effect: { ...(a.effect ?? { kind: "narrative" }) } };
    for (const k of ["roll", "oppose", "target", "when", "pick"]) if (a[k]) e[k] = JSON.parse(JSON.stringify(a[k]));
    for (const k of ["text", "sameZone", "touch", "gm", "anytime", "immuneHuge", "near", "stressPick", "stressExtra", "talk", "oneZone", "stressPer", "ownTurn", "needsCopies", "mind"]) if (a[k]) e[k] = 1;      // PWE: stressPer (1 per target), ownTurn, needsCopies, mind (Defiance resists it)
    if (typeof a.needsStatus === "string") e.needsStatus = a.needsStatus;           // PWE (PW085): a status the actor must have (Controlled Phasing: intangible)
    if (a.combo && Array.isArray(a.pick)) e.pick = multisets(a.pick, Math.max(1, at(a.combo, lv))).map((c) => c.join("+"));          // Summoning [B1813-1815]: as many features as the level, repeats allowed
    if (a.once) e.once = a.once;
    if (a.interrupt) e.interrupt = { on: a.interrupt.slice() };                      // PWA (PW039): an action the book allows as an interrupt (Nullification [B1772])
    for (const k of ["lv", "armor", "dice"]) if (Array.isArray(e.effect[k])) e.effect[k] = at(e.effect[k], lv);      // PWD (PW036): dice by the power's level
    if (a.reaction) Object.assign(e, { flow: "plain" }, reactionOf(a), { reactionOnly: 1 });
  }
  if (a.stress) e.stress = { fixed: a.stress };
  return { ...e, label: `ITAC.kit.act.${a.label ?? a.k}`, name: String(a.name ?? item.name ?? "").slice(0, 80), kit: { ...meta, state: extra.state ?? row?.state ?? "assist", cat: row?.cat ?? CAT_OF[item.type] ?? "gear", lv }, ...(extra.entry ?? {}) };
}

/** The kit of one actor. Never throws on odd data: an item it cannot read is listed "by hand". */
export function build(src = {}) {
  const items = Array.isArray(src.items) ? src.items : [], attrs = src.attrs ?? {}, byId = new Map(items.map((i) => [i.id, i]));
  const kit = { rows: [], actions: [], weapons: [], unarmed: {}, pass: { immune: [], vulnerable: [] }, mods: [], sheetSkip: [] };
  const parentOf = (it) => byId.get(it.power) ?? items.find((p) => p.type === "power" && (p.boosts ?? []).includes(it.id)) ?? null;
  const known = items.map((it) => { let row = null; try { row = rowFor(it, parentOf(it)?.name); } catch (err) { row = null; note("dropped", "kit", src.who, it?.name, "", err); } return { it, row, lv: 0 }; });
  for (const x of known) { const p = ["boost", "limit"].includes(x.it.type) ? parentOf(x.it) : x.it; x.lv = levelOf(p ?? x.it); x.parent = p !== x.it ? p : null; }
  const live = (x) => x.it.flags?.off !== true && !(x.parent && x.parent.flags?.off === true);
  const optsOf = (power) => known.filter((x) => x.parent === power && live(x) && x.row?.opt);
  const arms = [];

  for (const x of known) {
    const { it, row, lv } = x, cat = row?.cat ?? CAT_OF[it.type] ?? null;
    if (!cat) continue;                                                              // power sources, injuries: not what this list is about
    const rec = { item: it.id, name: String(it.name ?? "").slice(0, 80), type: it.type, cat, key: row?.key ?? null, lv, src: row?.src ?? [], state: row?.state ?? "hand", note: row?.note ?? "unknown" };
    if (x.parent) rec.of = String(x.parent.name ?? "").slice(0, 60);
    if (!row) rec.unknown = 1;
    kit.rows.push(rec);
    if (row?.own) kit.sheetSkip.push(String(it.name ?? ""));                             // its sheet toggle is not counted: the engine applies the entry itself
    if (!live(x)) { rec.state = "off"; rec.note = "off"; continue; }
    /* a row that asks for something else on the sheet (`needs`: the name of a row, [B3309] "Requires the Medic talent") gives nothing
       without it: no fact, no dice, no action. The GM still decides at the table (the stabilize card has the gear as a tick). */
    if (row?.needs && !known.some((k) => k !== x && live(k) && k.row?.key === norm(row.needs))) { rec.state = "hand"; rec.note = "lacks"; rec.lacks = String(row.needs).slice(0, 60); continue; }
    try {
      /* PWA (PW053, PW113): an attack of the book that the compendium item carries as a plain roll (Telekinesis "Throw Target" is a
         rollAttribute [B1823]): the row's hint `attack: 1` makes it an attack profile, and it is not offered a second time as a use */
      const asAttack = (a) => a.type === "rollAttack" || (USES.includes(a.type) && hintOf(row, a)?.attack === 1);
      const autos = autosAt(it, lv), attacks = autos.filter(asAttack), uses = autos.filter((a) => USES.includes(a.type) && !asAttack(a));
      const bars = (p) => !!p && known.some((k) => k.parent === p && live(k) && k.row?.bars);
      const barred = bars(it) || bars(x.parent);             // a limit that keeps the power out of a fight (Hypnosis, Ritual Casting); PWD (PW116) [B1764]: its boosts with it
      /* attack profiles: the item's own attack automations, each with the boosts of the power */
      if (!row?.mounted) for (const a of attacks) {
        let p = profileOf(it, row, a, lv, attrs, attacks.length > 1);
        if (!p) continue;
        if (p.onHit?.pull && known.some((k) => k.parent === it && live(k) && k.row?.noPull)) continue;      // PWA (PW114) Brachiation [B2031]: no pulling targets
        /* PWC (PW011): the way of attacking first (Requires Touch: a blow), then the attribute (Mental Stun): the same items give the same
           attack whatever their order on the sheet */
        const fixed = optsOf(it).filter((o) => !o.row.opt.optional && !o.row.opt.on && o.row.opt.patch).sort((a, b) => (b.row.opt.patch.fam ? 1 : 0) - (a.row.opt.patch.fam ? 1 : 0));
        for (const o of fixed) p = patchProfile(p, { ...o.row.opt.patch, stress: o.row.opt.stress ?? o.row.opt.patch.stress }, attrs, lv);      // S074: a limit that names its price in the patch (Exhausting Blast [B1587]) keeps it
        kit.weapons.push(p);
        const made = [p];
        let n = 0;
        for (const o of optsOf(it).filter((o) => o.row.opt.optional && !o.row.opt.on)) { const q = { ...patchProfile(p, { ...o.row.opt.patch, stress: o.row.opt.stress ?? o.row.opt.patch?.stress }, attrs, lv), id: `${p.id}+${n++}`, tag: String(o.it.name).slice(0, 40) }; kit.weapons.push(q); made.push(q); }
        for (const o of row?.opts ?? []) { const q = { ...patchProfile(p, { ...o.patch, stress: o.stress }, attrs, lv), id: `${p.id}+${n++}`, opt: o.k }; kit.weapons.push(q); made.push(q); }
        const own = ownAttrOf(p);                                                                    // PWC (PW007): the attack's own attribute, when it rolls more dice
        if (fixed.some((o) => o.row.opt.patch.attrs) && p.attr && (Number(attrs[own]) || 0) > (Number(attrs[p.attr]) || 0))
          for (const q of made) kit.weapons.push({ ...q, attr: null, id: `${p.id}+${n++}`, alt: own });
      }
      if (!row && attacks.length) { rec.state = "auto"; rec.note = "weapon"; }
      if (attacks.length && bookRow(row)?.miles && !kit.weapons.some((w) => w.item === it.id)) { rec.state = "hand"; rec.note = "story"; rec.why = "gmJudges"; }      // [A26]: a missile that flies for miles is the GM's own entry
      if (row?.atk && !row.mounted && !attacks.length) { rec.state = "assist"; rec.note = "noAttack"; }      // an attack of the book on an item that carries no numbers (a hand-made item mapped to an entry)
      if (row?.mounted && !attacks.length) { /* a vehicle's weapon: fired through the vehicle's own actions (P7) */ }
      /* a boost of the bare slugfest attack (Strike) */
      if (row?.opt?.on === "slug" && x.parent && !barred) {
        const strike = known.find((k) => k.it === x.parent)?.row?.key === "strike";                // Z14 [B1622]: a boost of STRIKE, gone without the wind-up
        if (row.opt.optional) kit.weapons.push({ id: `unarmed~${it.id}`, item: it.id, name: rec.name, of: rec.of, fam: "slug", attr: null, bonus: 0, damage: null, range: null, stress: row.opt.stress ?? 0, state: row.state, ...(strike ? { strike: true } : {}), ...Object.fromEntries(Object.entries(row.opt.patch).map(([k, v]) => [k, v === 1 ? true : v])) });
        else Object.assign(kit.unarmed, Object.fromEntries(Object.entries(row.opt.patch).map(([k, v]) => [k, v === 1 ? true : v])));
      }
      /* the row's own actions; else what the sheet's use / roll buttons say, as an action whose effect the GM confirms */
      const luck = row?.key === "luckcontrol" ? optsOf(it).map((o) => o.row.opt.luck).filter(Boolean) : [];
      if (barred) rec.barred = 1;
      if (row?.throwOf && x.parent && Number(attrs.strength) > 0) { const n = Math.ceil(Number(attrs.strength) / 2);      // [B1970]: thrown, damage and range from half the STRENGTH
        kit.weapons.push({ id: `${it.id}~throw`, item: it.id, name: rec.name, of: rec.of, fam: "shoot", attr: null, bonus: 0, damage: n, range: [0, n], stress: 0, sharp: x.parent.wf?.sharp === true, state: row.state }); }
      const kin = (key) => known.some((k) => k !== x && live(k) && k.row?.key === key && (k.parent === it || (x.parent && (k.parent === x.parent || k.it === x.parent))));
      for (const a of barred ? [] : row?.acts ?? []) {
        let b = luck.length && a.pick ? { ...a, pick: a.pick.filter((p) => luck.includes(p)) } : a;
        for (const [key, { mind, ...more }] of Object.entries(a.with ?? {})) if (kin(key)) b = { ...b, ...(mind ? { mind } : {}), effect: { ...b.effect, ...more } };      // PWD (PW035) [B1717]: Terrifying Illusions on the illusion's own roll; PWE-M: its `mind` mark goes on the action (Defiance resists the terror [B1865])
        const e = actionOf(it, row, b, lv);
        kit.actions.push(e);
        if (a.weapon === "parent" || a.weapon === "own") arms.push({ e, from: a.weapon === "own" ? it.id : x.parent?.id ?? null });      // PWB: the attack of an answer is made with the power's own profile
        else if (a.weapon) e.reaction.weapon = a.weapon;
      }
      if (barred) { /* nothing is offered in a fight */ }
      else if (row && (!row.acts || row.keep) && row.state !== "hand" && !row.mv && !(row.pass && row.state === "auto") || !row) {      // PWD: `keep`, the sheet's uses beside the row's own actions; PWE (PW115): a passive fact the engine applies by itself offers no use button
        uses.filter((a) => { const k = Object.keys(row?.by ?? {}).find((q) => norm(q) === norm(baseName(a.name))); return !(k && row.by[k].skip); }).slice(0, 6).forEach((a, i) => {      // PWE (PW117): a use the row leaves out of a fight
          const set = (a.attr ?? []).filter(Boolean), byKey = Object.keys(row?.by ?? {}).find((k) => norm(k) === norm(baseName(a.name))), by = byKey ? row.by[byKey] : {};
          const roll = set.length === 1 ? { attr: set[0] } : set.length > 1 ? { attrs: set } : a.type === "rollAttribute" ? { attrs: "any" } : null;
          if (roll && a.bonus) roll.mods = [{ source: `kit:${row?.key ?? "item"}`, dice: Math.trunc(a.bonus) }];
          const more = Object.fromEntries(["target", "oppose", "pick", "stressPick"].filter((k) => by[k] != null).map((k) => [k, by[k]]));      // PWD (PW055, PW118): what the book adds to a use of the sheet
          kit.actions.push(actionOf(it, row, { k: `u${i}`, label: by.label ?? "use", name: useName(it, a) ? `${it.name}: ${useName(it, a)}` : it.name, cost: by.cost ?? row?.cost ?? (cat === "gear" ? "quick" : "full"),
            stress: pos(a.stress) || undefined, roll, effect: { kind: "narrative" }, text: 1, ...more }, lv, { state: "assist" }));
        });
        if (row && !row.acts && !uses.length && !attacks.length && !row.fx && !row.pass && !row.mods && !row.opt && ["zone", "outcome", "gmCard", "roll"].includes(row.note) && row.state === "assist")
          kit.actions.push(actionOf(it, row, { k: "u0", label: "use", cost: row.cost ?? "full", effect: { kind: "narrative" }, text: 1, roll: { attrs: "any", optional: true } }, lv));
        if (!row && uses.length) { rec.state = "assist"; rec.note = "unknown"; }
      }
      /* a known entry whose item carries a use of its own at a price (a hero's "Strike - Reduce Armor"): offered, the GM says what it does */
      else if (row && row.acts && !row.acts.length && row.state !== "hand") uses.filter((a) => pos(a.stress) > 0 && useName(it, a)).slice(0, 3).forEach((a, i) =>
        kit.actions.push(actionOf(it, row, { k: `u${i}`, label: "use", name: `${it.name}: ${useName(it, a)}`, cost: "none", stress: pos(a.stress), effect: { kind: "narrative" }, text: 1 }, lv, { state: "assist" })));
      /* switching the item's active effects from the dock */
      if (row?.why && rec.state === "hand") rec.why = row.why;
      if (row?.alt) { rec.alt = row.alt; rec.altOn = it.flags?.alt === true; }                                 // a setting of the GM's: the entry's other reading
      if (row?.size) {                                                                                          // Size Alteration [B1974-1981]
        const kids = known.filter((k) => k.parent === it && live(k) && k.row?.sizeOnly), always = kids.find((k) => k.it.flags?.alt === true)?.row.sizeOnly ?? null;
        const on = (n) => always === n || (!always && (it.fx ?? []).some((f) => f.on === true && norm(f.name).includes(n)));
        if (always === "grow") kit.pass.huge = true; else if (on("grow")) kit.pass.grown = true;
        if (on("shrink")) kit.pass.shrunkDice = at(row.size, lv);
      }
      if (row?.fx) {
        const only = row.size ? known.filter((k) => k.parent === it && live(k) && k.row?.sizeOnly) : [], fixed = only.some((k) => k.it.flags?.alt === true);
        const lock = known.some((k) => k.parent === it && live(k) && k.row?.lockFx);         // Continual Emanation [B1603]: it can be switched on, never off
        const host = row.fx.ofParent ? x.parent : it, list = fixed ? [] : (host?.fx ?? []).filter((f) => !(lock && f.on === true) && (!row.fx.only || norm(f.name).includes(norm(row.fx.only))) && only.every((k) => norm(f.name).includes(k.row.sizeOnly)));
        /* PWE (PW091) [B1974]: one size at a time: switching Grow on switches a Shrink that is on off, and the other way round */
        const sizeOf = (f) => (row.size ? ["grow", "shrink"].find((n) => norm(f.name).includes(n)) ?? null : null);
        const offOf = (f) => (sizeOf(f) ? (host?.fx ?? []).filter((g) => g.on === true && g.id !== f.id && sizeOf(g) && sizeOf(g) !== sizeOf(f)).map((g) => g.id) : []);
        list.slice(0, 4).forEach((f, i) => kit.actions.push(actionOf(it, row, { k: `fx${i}`, label: "toggle", name: String(f.name ?? host.name), cost: row.fx.cost ?? "quick", stress: row.fx.stress, gm: row.fx.gm, interrupt: row.fx.interrupt,      // PWB: switched on as an interrupt too (Emanation [B1601], Ice Armor [B1650], Protection [B1890])
          effect: { kind: "toggle", item: host.id, fx: f.id, ...(f.on !== true && offOf(f).length ? { off: offOf(f) } : {}) } }, lv, { entry: { fxOn: f.on === true } })));
        if (!list.length && !row.mv && !row.pass && !fixed && !lock) { rec.state = "hand"; rec.note = "toggle"; rec.why = "noEffect"; }
      }
      /* passive facts and dice */
      /* PWC (PW004) [B1601-1603]: what an aura does counts while it is on (the power's or the boost's own effect switched on, or a limit
         that keeps it always on) */
      const auraOn = () => { const p = x.parent ?? it; return [p, it].some((i) => (i?.fx ?? []).some((f) => f.on === true)) || known.some((k) => k.parent === p && live(k) && k.row?.lockFx); };
      for (const [k, v] of row?.passOn === "fx" && !auraOn() ? [] : Object.entries(row?.pass ?? {})) {
        if (k === "immune" || k === "vulnerable") kit.pass[k].push(...(v === "flag" ? (it.flags?.types ?? []) : v).map((s) => String(s).slice(0, 24)));
        else if (Array.isArray(v) && typeof v[0] === "number") kit.pass[k] = Math.max(kit.pass[k] ?? 0, at(v, lv));
        else kit.pass[k] = Array.isArray(v) ? v.slice() : v === 1 ? true : v;
      }
      if (["immune", "vulnerable"].some((k) => row?.pass?.[k] === "flag") && !(it.flags?.types ?? []).length) rec.needs = "types";
      for (const m of row?.mods ?? []) kit.mods.push({ dice: at(m.lv ?? m.dice, lv), ...(m.action ? { action: m.action.slice() } : {}), ...(m.attack ? { attack: m.attack.slice() } : {}), ...(m.attr ? { attr: m.attr } : {}), ...(m.vsHuge ? { vsHuge: 1 } : {}), ...(m.gm ? { gm: m.gm } : {}), source: `kit:${row.key}`, name: rec.name });
    } catch (err) { rec.state = "hand"; rec.note = "unknown"; note("dropped", "kit", src.who, rec.name, "", err); }      // D125: listed by hand, and the trace says why
  }
  /* PWB: an answer that is an attack (Quick Blast with Blast's profile [B1585], Redirecting Blast with its own [B1889]) needs that profile;
     without one (an item that carries no numbers) it is not offered and the row stays the GM's */
  for (const { e, from } of arms) {
    const w = kit.weapons.find((p) => p.item === from && !p.tag && !p.opt && !String(p.id).includes("+"));
    if (w) e.reaction.weapon = w.id;
    else { kit.actions = kit.actions.filter((x) => x !== e); const rec = kit.rows.find((r) => r.item === e.kit.item); if (rec) { rec.note = "noAttack"; rec.state = "assist"; } }
  }
  /* PWC (PW008) [B1618-1621]: the boosts of STRIKE are independent: a blow made with one of the bare attack's variants (Piercing Strike)
     still carries what the bare attack does (Deadly Strike's sharp, Toxic Strike's poison); the variant's own words win */
  kit.weapons = kit.weapons.map((w) => (String(w.id).startsWith("unarmed~") ? { ...kit.unarmed, ...w } : w));
  /* PWE (PW075) [B1937] a limit that takes an action of its power away (Life Leech: the power heals only its user, through the leech) */
  for (const x of known) if (x.parent && x.row?.drops && live(x)) kit.actions = kit.actions.filter((e) => !(e.kit?.item === x.parent.id && x.row.drops.includes(e.kit?.k)));
  kit.pass.immune = [...new Set(kit.pass.immune)].slice(0, 24); kit.pass.vulnerable = [...new Set(kit.pass.vulnerable)].slice(0, 24);
  kit.actions = kit.actions.slice(0, 60); kit.weapons = kit.weapons.slice(0, 40);
  return kit;
}
export const EMPTY = Object.freeze({ rows: [], actions: [], weapons: [], unarmed: {}, pass: { immune: [], vulnerable: [] }, mods: [], sheetSkip: [] });
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
