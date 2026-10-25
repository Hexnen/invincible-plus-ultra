/* Activity log - event type registry (phase L2). PURE: no Foundry globals, runs in Node and in the browser.
   Spec: dev/log-spec.md section 2. Entries store a type id + raw data; prose is built at display time from the i18n keys below. */

export const MOD_ID = "invincible-plus-ultra";

/** Hero categories (filter chips) and base categories. */
export const HERO_CATEGORIES = Object.freeze(["stats", "items", "effects", "damage", "rolls", "combat", "creation", "team", "notes", "system"]);
export const BASE_CATEGORIES = Object.freeze(["card", "members", "upgrades", "events", "gear", "sync", "access", "notes", "system"]);
export const CATEGORIES = Object.freeze({ hero: HERO_CATEGORIES, base: BASE_CATEGORIES });

/** Severity: 2 major, 1 normal, 0 minor (hidden unless "Show minor"). */
export const SEV = Object.freeze({ MINOR: 0, NORMAL: 1, MAJOR: 2 });

/** Default policy constants (spec section 11 defaults). Settings override them in L3; keep them here so they change in one place. */
export const POLICY = Object.freeze({
  readAccess: "owners",        // gm | owners | observers
  secretRolls: "gm-only",       // private (gm) and blind rolls go to the GM journal
  selfRolls: "never",           // roll mode "self" is not recorded
  retainHero: 5000,            // entries per hero (0 = unlimited)
  retainBase: 3000,            // entries per base (spec: 60 percent of the hero cap)
  minorRecorded: true,         // recorded but hidden by default
  showMinorDefault: false,
  playerNotes: true,           // owners may add notes to their own log
  gmAnnotate: true,            // GM may annotate / redact (marker stays)
  tableLog: true,              // GM-wide Table log window (L6)
  actorTypes: Object.freeze(["superhero"])
});

/** Resolve the retention cap for a scope from a (partial) settings object. */
export function retentionFor(scope, settings = {}) {
  const hero = Number.isFinite(settings.retainHero) ? Math.max(0, Math.floor(settings.retainHero)) : POLICY.retainHero;
  if (scope === "base") {
    if (Number.isFinite(settings.retainBase)) return Math.max(0, Math.floor(settings.retainBase));
    return hero === 0 ? 0 : Math.round(hero * 0.6);
  }
  return hero;
}

/* ------------------------------------------------------------------ registry */
const REG = {};
/** def: id, scope hero|base|both, cat (string | {hero, base}), sev, icon, req (required d fields), vis P|G|PG (PG = public unless entry.v) */
function def(id, scope, cat, sev, icon, req = [], extra = {}) {
  REG[id] = Object.freeze({
    id, scope, cat, sev, icon, req: Object.freeze(req), minor: sev === 0, vis: extra.vis || "P",
    i18n: `IPL.Type.${id}`, sum: `IPL.Sum.${id}`, absorbable: extra.absorbable !== false, collapsible: extra.collapsible !== false
  });
}
const NC = { collapsible: false };

// ---- superhero
def("stat.attr", "hero", "stats", 1, "fa-dumbbell", ["key", "from", "to"]);
def("stat.vital", "hero", "stats", 1, "fa-heart-pulse", ["key", "from", "to"]);
def("stat.track", "hero", "stats", 1, "fa-coins", ["key", "from", "to"]);
def("stat.text", "hero", "stats", 1, "fa-pen", ["key"]);
def("actor.rename", "hero", "stats", 1, "fa-signature", ["from", "to"]);
def("actor.img", "hero", "stats", 0, "fa-image", ["what"]);
def("item.add", "hero", "items", 1, "fa-bolt", ["id", "name", "type"]);
def("item.remove", "hero", "items", 1, "fa-xmark", ["id", "name", "type"]);
def("item.edit", "hero", "items", 1, "fa-pen-to-square", ["id", "name", "type", "changes"]);
def("item.toggle", "hero", "items", 1, "fa-toggle-on", ["id", "name", "type", "on"]);
def("effect.add", "hero", "effects", 1, "fa-atom", ["id", "name"]);
def("effect.remove", "hero", "effects", 1, "fa-atom", ["id", "name"]);
def("effect.edit", "hero", "effects", 0, "fa-atom", ["id", "name", "changes"]);
def("damage.taken", "hero", "damage", 2, "fa-burst", ["amount", "from", "to"], { vis: "PG", ...NC });
def("damage.undone", "hero", "damage", 1, "fa-rotate-left", ["from", "to"], { vis: "PG", ...NC });
def("roll.made", "hero", "rolls", 1, "fa-dice-d6", ["name", "mode", "s", "b"], { vis: "PG", ...NC });
def("combat.join", "hero", "combat", 1, "fa-swords", ["combatId"]);
def("combat.leave", "hero", "combat", 1, "fa-person-walking-arrow-right", ["combatId"]);
def("combat.turn", "hero", "combat", 0, "fa-hourglass-half", ["round", "turn"]);
def("combat.action", "hero", "combat", 0, "fa-bolt-lightning", ["status", "on"]);
def("combat.init", "hero", "combat", 0, "fa-flag-checkered", ["from", "to"]);
def("combat.end", "hero", "combat", 1, "fa-flag", ["combatId", "rounds"]);
def("chargen.apply", "hero", "creation", 2, "fa-wand-magic-sparkles", ["runId", "mode"], NC);
def("chargen.undo", "hero", "creation", 1, "fa-rotate-left", ["runId"], NC);
def("team.join", "hero", "team", 1, "fa-people-group", ["baseId", "name"]);
def("team.leave", "hero", "team", 1, "fa-people-group", ["baseId", "name"]);
def("team.sync", "hero", "team", 0, "fa-arrows-rotate", ["fields"]);
def("actor.created", "hero", "creation", 1, "fa-star", [], NC);
def("actor.deleted", "hero", "creation", 2, "fa-trash", ["name"], NC);

// ---- shared (hero + base)
def("access.owner", "both", { hero: "system", base: "access" }, 1, "fa-user-lock", ["user", "from", "to"]);
def("access.default", "both", { hero: "system", base: "access" }, 1, "fa-lock", ["from", "to"]);
def("note.add", "both", "notes", 1, "fa-comment", ["text"], NC);
def("note.gm", "both", "notes", 1, "fa-user-secret", ["text"], { vis: "G", ...NC });
def("bulk.change", "both", "system", 1, "fa-layer-group", ["n", "kids"], NC);
def("log.start", "both", "system", 0, "fa-flag", [], NC);
def("log.gap", "both", "system", 1, "fa-triangle-exclamation", ["from", "to", "changes"], NC);
def("log.prune", "both", "system", 0, "fa-scissors", ["removed", "first", "last"], NC);
def("log.redact", "both", "system", 1, "fa-eraser", ["by", "n"], NC);
def("log.import", "both", "system", 1, "fa-file-import", ["n", "from"], NC);
def("log.throttle", "both", "system", 1, "fa-gauge-high", ["n"], NC);

// ---- team base
def("card.edit", "base", "card", 1, "fa-pen", ["field", "from", "to"]);
def("card.roll", "base", "card", 1, "fa-dice", ["table", "roll", "result"]);
def("card.rename", "base", "card", 1, "fa-signature", ["from", "to"]);
def("card.img", "base", "card", 0, "fa-image", []);
def("card.occupied", "base", "card", 2, "fa-lock", ["on"]);
def("member.add", "base", "members", 1, "fa-user-plus", ["id", "name"]);
def("member.remove", "base", "members", 1, "fa-user-minus", ["id", "name"]);
def("upgrade.add", "base", "upgrades", 1, "fa-hammer", ["key", "name", "count"]);
def("upgrade.buy", "base", "upgrades", 2, "fa-cart-shopping", ["key", "name", "cost", "kind"], NC);
def("upgrade.status", "base", "upgrades", 1, "fa-wrench", ["key", "name", "from", "to"]);
def("upgrade.count", "base", "upgrades", 1, "fa-hashtag", ["key", "name", "from", "to"]);
def("upgrade.remove", "base", "upgrades", 1, "fa-trash", ["key", "name", "count"]);
def("upgrade.note", "base", "upgrades", 0, "fa-note-sticky", ["key", "name"]);
def("event.rolled", "base", "events", 2, "fa-dice-d6", ["eid", "roll", "band"]);
def("event.reroll", "base", "events", 1, "fa-rotate", ["eid"]);
def("event.resolved", "base", "events", 1, "fa-circle-check", ["eid"]);
def("event.applied", "base", "events", 2, "fa-circle-check", ["eid"]);
def("event.note", "base", "events", 0, "fa-note-sticky", ["eid"]);
def("event.dismissed", "base", "events", 1, "fa-ban", ["eid"]);
def("event.undone", "base", "events", 1, "fa-rotate-left", ["eid"]);
def("crate.add", "base", "gear", 1, "fa-box", ["cid", "name", "qty"]);
def("crate.remove", "base", "gear", 1, "fa-box-open", ["cid", "name", "qty"]);
def("crate.qty", "base", "gear", 0, "fa-boxes-stacked", ["cid", "name", "qty"]);
def("crate.give", "base", "gear", 1, "fa-hand-holding", ["name", "qty", "to"], NC);
def("vehicle.add", "base", "gear", 1, "fa-car", ["vid", "name"]);
def("vehicle.remove", "base", "gear", 1, "fa-car-burst", ["vid", "name"]);
def("vehicle.primary", "base", "gear", 0, "fa-star", ["vid", "name"]);
def("tracker.edit", "base", "gear", 0, "fa-gauge", ["name", "from", "to"]);
def("tracker.remove", "base", "gear", 1, "fa-trash", ["name"]);
def("sync.push", "base", "sync", 1, "fa-arrows-rotate", ["members", "fields"], NC);
def("sync.adopt", "base", "sync", 1, "fa-download", ["from", "kind"], NC);
def("policy.change", "base", "system", 2, "fa-sliders", ["key", "from", "to"]);
def("base.created", "base", "system", 1, "fa-star", ["name"], NC);
def("base.deleted", "base", "system", 2, "fa-trash", ["name"], NC);
def("base.migrated", "base", "system", 1, "fa-box-archive", ["name"], NC);

export const TYPES = Object.freeze(REG);
export const TYPE_IDS = Object.freeze(Object.keys(REG));

/** Event types a relayed (player) record may carry (spec 4). */
export const RELAY_WHITELIST = Object.freeze(["chargen.apply", "chargen.undo", "note.add", "upgrade.buy", "sync.push", "sync.adopt", "crate.give"]);

/** Types that live only in the hero or only in the base scope. */
export function typesFor(scope) {
  return TYPE_IDS.filter((id) => REG[id].scope === "both" || REG[id].scope === scope);
}
export function isKnownType(id) { return Object.prototype.hasOwnProperty.call(REG, id); }
export function typeDef(id) { return isKnownType(id) ? REG[id] : null; }
export function inScope(id, scope) { const d = typeDef(id); return !!d && (d.scope === "both" || d.scope === scope); }

/** Category (filter chip) of a type for a scope; unknown types fall into "system". */
export function categoryOf(id, scope = "hero") {
  const d = typeDef(id);
  if (!d) return "system";
  if (typeof d.cat === "string") return d.cat;
  return d.cat[scope] || d.cat.hero;
}
export function severityOf(id) { const d = typeDef(id); return d ? d.sev : 1; }
export function isMinorType(id) { return severityOf(id) === 0; }
export function iconOf(id) { const d = typeDef(id); return d ? d.icon : "fa-circle"; }
/** Default visibility class of a type: "P" public, "G" GM only, "PG" public unless the entry carries v:1. */
export function visibilityOf(entry) {
  const d = typeDef(entry && entry.k);
  if (!d) return entry && entry.v ? "G" : "P";
  if (d.vis === "G") return "G";
  return entry && entry.v ? "G" : "P";
}

/** Item type -> icon (item.add / remove rows). */
export const ITEM_ICONS = Object.freeze({
  power: "fa-bolt", talent: "fa-brush", gear: "fa-toolbox", criticalInjury: "fa-skull-crossbones", powerSource: "fa-link"
});
export function itemIcon(type) { return ITEM_ICONS[type] || "fa-cube"; }

/** i18n keys of every type in the registry (checked by check-lang in L4). */
export function i18nKeys() {
  const out = [];
  for (const id of TYPE_IDS) out.push(REG[id].i18n, REG[id].sum);
  return out;
}

/** Display summary descriptor {key, params}: the UI feeds it to t(key, params); word order is the translator's. */
export function summarize(entry) {
  const k = entry && entry.k;
  const d = (entry && entry.d) || {};
  const params = { type: k };
  for (const [key, v] of Object.entries(d)) {
    if (v == null) continue;
    if (typeof v === "string") params[key] = v.length > 200 ? v.slice(0, 200) : v;
    else if (typeof v === "number" || typeof v === "boolean") params[key] = v;
    else if (Array.isArray(v)) params[key + "Count"] = v.length;
    else if (typeof v === "object" && typeof v.name === "string") params[key] = v.name;
  }
  if (typeof d.from === "number" && typeof d.to === "number") {
    const delta = d.to - d.from;
    params.delta = delta; params.abs = Math.abs(delta); params.dir = delta > 0 ? "up" : delta < 0 ? "down" : "same";
  }
  if (entry && entry.n > 1) params.n = entry.n;
  if (k === "roll.made" && d.s != null) params.outcome = d.s > 0 ? "success" : "fail";
  return { key: typeDef(k) ? REG[k].sum : "IPL.Sum.unknown", params };
}

/** Plain English text for exports / console when no translator is available. */
export function plainText(entry) {
  const d = (entry && entry.d) || {};
  const bits = [];
  for (const [key, v] of Object.entries(d)) {
    if (v == null) continue;
    if (typeof v === "object") continue;
    bits.push(`${key}=${v}`);
  }
  return `${entry.k}${bits.length ? " " + bits.join(" ") : ""}`;
}
