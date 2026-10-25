/* "Start from this hero": read an existing superhero into a wizard state, and describe what the hero already has.
   Heuristics (documented, nothing here writes to the actor):
   - items are matched by NAME later by apply/catalog (packUuid stays null); levels come from system.level (basic/major/massive/monstrous);
   - the sheet does not say which talent is the hero talent and which one comes from the occupation: with an occupation text the 1st talent
     is the hero talent, the 2nd the occupation talent, the rest extra talents; without one: 1st hero talent, rest extra. The Talents step
     (phase 5c) is where the player fixes that;
   - a limit's `grants` is not stored on the sheet: "level" when the power has a level above basic, else "boost" (validation tells if wrong);
   - drawback names written by apply carry their note: "Phobic (spiders)" is split back into name + note;
   - values come from actor._source (no effect bonuses: Renowned, Windfall ... are transfer effects and stay out). */
import { createState } from "./state.mjs";
import { ATTRS, isRank, DEFAULT_RANK } from "./rules.mjs";

const MODULE_ID = "invincible-plus-ultra";
const LEVELS = ["basic", "major", "massive", "monstrous"];
const WIPE_TYPES = ["powerSource", "power", "boost", "limit", "talent", "drawback"];
const TEXTS = ["occupation", "personality", "drive", "flaw", "relationships", "team", "teamBase", "role", "civilianName", "appearance"];

const get = (o, p) => foundry.utils.getProperty(o, p);

/** what the actor already holds (for the Start step banner and the blank / data decision) */
export function describeActor(actor) {
  const src = actor?._source ?? {};
  const counts = Object.fromEntries(WIPE_TYPES.map((t) => [t, 0]));
  for (const it of actor?.items ?? []) if (it.type in counts) counts[it.type]++;
  const attrsChanged = ATTRS.some((k) => Number(get(src, `system.attributes.${k}.value`) ?? 2) !== 2);
  const hasText = TEXTS.some((k) => String(get(src, `system.${k}`) ?? "").trim() !== "");
  const items = Object.values(counts).reduce((a, b) => a + b, 0);
  return { blank: !attrsChanged && !hasText && items === 0, counts, items, attrsChanged, hasText, rank: get(src, `flags.${MODULE_ID}.chargen.rank`) ?? null };
}

export function stateFromActor(actor, { seed = "000000", rank } = {}) {
  const src = actor._source, sys = src.system ?? {};
  const flagRank = get(src, `flags.${MODULE_ID}.chargen.rank`);
  const useRank = isRank(flagRank) ? flagRank : (isRank(rank) ? rank : DEFAULT_RANK);
  const s = createState({ seed, rank: useRank, mode: "manual" });
  for (const k of ATTRS) { const v = Number(get(sys, `attributes.${k}.value`)); if (Number.isFinite(v)) s.attrs[k] = v; }
  const txt = (k) => String(sys[k] ?? "").trim();
  s.heroName = actor.name ?? "";
  s.civilianName = txt("civilianName");
  s.role = txt("role") || null;
  s.appearance = txt("appearance");
  s.occupation = txt("occupation") || null;
  s.resources = Number(sys.resources) || 0;
  s.personality = txt("personality").split(/[,;\n]+/).map((w) => w.trim()).filter(Boolean);
  s.drive = txt("drive") ? { name: txt("drive"), text: "" } : null;
  s.flaw = txt("flaw") ? { name: txt("flaw"), text: "" } : null;
  for (const line of txt("relationships").split(/\n+/)) {
    const m = line.match(/^(NPC|Hero):\s*(.*)$/i);
    if (!m) continue;
    if (m[1].toLowerCase() === "hero") s.heroRel = { name: m[2].trim(), actorUuid: null };
    else { const n = m[2].match(/^(.*?)\s*(?:\(([^)]*)\))?$/); s.npcRel = { name: (n?.[1] ?? m[2]).trim(), type: (n?.[2] ?? "").trim() }; }
  }
  s.team = { name: txt("team"), base: "", where: "", upgrades: [], mode: "text", baseId: null };
  const [base, ups] = txt("teamBase").split(/;\s*upgrades:\s*/i);
  const head = (base ?? "").trim(), comma = head.indexOf(",");              // "kind, where" (the base card's own mirror format)
  s.team.base = (comma < 0 ? head : head.slice(0, comma)).trim();
  s.team.where = comma < 0 ? "" : head.slice(comma + 1).trim();
  s.team.upgrades = (ups ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  try {                                                                     // phase 5f: a hero that already belongs to a team base: the card owns the two texts
    const card = globalThis.game?.modules?.get(MODULE_ID)?.api?.base?.find?.(actor);
    if (card) { s.team.mode = "member"; s.team.baseId = card.id; }
  } catch { /* the base feature is optional */ }

  const items = [...actor.items];
  const ofType = (type) => items.filter((i) => i.type === type);
  const sourceKey = new Map();
  ofType("powerSource").forEach((it, n) => { const key = `s${n + 1}`; sourceKey.set(it.id, key); s.sources.push({ key, name: it.name, packUuid: null }); });
  const powerKey = new Map();
  ofType("power").forEach((it, n) => {
    const key = `p${n + 1}`;
    powerKey.set(it.id, key);
    s.powers.push({ key, name: it.name, packUuid: null, level: Math.max(0, LEVELS.indexOf(it.system?.level)), sourceKey: sourceKey.get(it.system?.powerSource) ?? s.sources[0]?.key ?? null, boosts: [], limits: [] });
  });
  const powerOf = (it) => s.powers.find((p) => p.key === powerKey.get(it.system?.power));
  for (const it of ofType("boost")) powerOf(it)?.boosts.push({ name: it.name, packUuid: null });
  for (const it of ofType("limit")) { const p = powerOf(it); if (p) p.limits.push({ name: it.name, packUuid: null, grants: p.level > 0 ? "level" : "boost" }); }
  const talents = ofType("talent").map((it) => ({ name: it.name, packUuid: null }));
  s.heroTalent = talents[0] ?? null;
  if (s.occupation) { s.occTalent = talents[1] ?? null; s.extraTalents = talents.slice(2); } else s.extraTalents = talents.slice(1);
  s.drawbacks = ofType("drawback").map((it) => {
    const m = it.name.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    return m ? { name: m[1], packUuid: null, note: m[2] } : { name: it.name, packUuid: null, note: "" };
  });
  return s;
}
