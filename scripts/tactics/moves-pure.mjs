/* Tactical combat, P3 (moved here from the system adapter for D125): THE WAYS OF MOVING AN ACTOR'S ITEMS GIVE. NO Foundry globals.
   The system adapter hands plain items: [{ id, name, type, src: the compendium source uuid | null, level, autos: the automations, boosts: [item id] }]
   and the GM's own list (flags.<module>.tactics.movement = [{ mode, tier }]). Speeds and rules: scripts/rules/movement.mjs; the tier each
   way really gets is movement-pure.modesOf's (levels-pure.tierFor).
   A power, boost or limit is known by the id of its compendium entry (the same in every language); an item made by hand or by a
   pregenerated actor carries no compendium id: then its English name decides (as for the talents).
   [D] D125: one item that cannot be read costs that item only, and the trace says so; a power's level is read as the system reads it
   (levels-pure.powerLevel: a blank level comes from the automations, else basic [B298], [B1214]). */
import { powerLevel } from "./levels-pure.mjs";
import { note } from "./trace-pure.mjs";

export const MOVE_POWERS = Object.freeze({ adhesion: "adhesion", "8wJ7WiatmSsAJYsJ": "burrowing", E6B4T5jbhoxFOqRC: "flight", XH6BNrsuvt6H7BvT: "leaping", QeM9FgUR0U3iCd5m: "superSpeed", "6IWySeMnq5uwhZ3u": "swimming", "60xT0tfR9306RCtA": "swinging", JeaiOHbh5MSrPakm: "teleportation",
  muyhi7UPoPdDlrpI: "earthDrift", AQramXS4Ilmqe01y: "elongatedStride", jyqBPo53xFKMdXnT: "iceSlide" });
export const MOVE_EXTRAS = Object.freeze({ nG8DLZMigiBg256a: "tunneling", iLlwnWwRa82gbpT3: "untouchableSpeed", dntiWPrtTegqNRAi: "teleportAllies", sPl5SC16bIT3AFxB: "quickTeleport", ZIKmnZgnR7qz4eSw: "portal", qXCQsdc6tlqalEcX: "gliding", g1FnuD4L5jDMvqC7: "brachiation" });
const MOVE_NAMES = { adhesion: "adhesion", burrowing: "burrowing", flight: "flight", leaping: "leaping", superspeed: "superSpeed", swimming: "swimming", swinging: "swinging", teleportation: "teleportation", earthdrift: "earthDrift", elongatedstride: "elongatedStride", iceslide: "iceSlide",
  tunneling: "tunneling", untouchablespeed: "untouchableSpeed", teleportallies: "teleportAllies", quickteleport: "quickTeleport", portal: "portal", gliding: "gliding", brachiation: "brachiation" };
export const NAME_TYPES = Object.freeze(["power", "boost", "limit"]);
const ALL = { ...MOVE_POWERS, ...MOVE_EXTRAS };
/** the way of moving each boost or limit belongs to: [B1996] Tunneling, [B2004] Gliding, [B2018] Untouchable Speed, [B2031] Brachiation, [B2038-2040] Teleport Allies, Quick Teleport, Portal */
export const EXTRA_OF = Object.freeze({ tunneling: "burrowing", gliding: "flight", untouchableSpeed: "superSpeed", brachiation: "swinging", teleportAllies: "teleportation", quickTeleport: "teleportation", portal: "teleportation" });
const LIMIT_IDS = ["gliding", "brachiation"];

/** the id a movement item is known by: its compendium entry's, else (a power, boost or limit) the entry its English name names */
export function srcId(it) {
  const id = String(it?.src ?? "").split(".").pop();
  if (ALL[id] || !it || !NAME_TYPES.includes(it.type)) return id;
  const n = MOVE_NAMES[String(it.name ?? "").toLowerCase().replace(/[^a-z]/g, "")];
  return n ? Object.keys(ALL).find((k) => ALL[k] === n) ?? id : id;
}
/** -> [{ mode, tier, name?, boosts: [extra], limits: [extra] }]; `who`: the actor's name for the trace */
export function movementOf(items, flagMoves = [], who = "") {
  const list = Array.isArray(items) ? items : [], byId = new Map(list.filter((i) => i && i.id != null).map((i) => [i.id, i]));
  const out = [], extras = new Set();
  for (const it of list) {
    try {
      const ids = [srcId(it), ...(Array.isArray(it.boosts) ? it.boosts.map((b) => srcId(byId.get(b)) || String(b)) : [])];
      for (const id of ids) {
        if (MOVE_EXTRAS[id]) extras.add(MOVE_EXTRAS[id]);
        const mode = MOVE_POWERS[id];
        if (!mode || out.some((m) => m.mode === mode)) continue;
        const lv = powerLevel(it.level, it.autos);
        if (lv.odd) note("guessed", "level", who, it.name, it.level);
        out.push({ mode, tier: lv.word, name: it.name });
      }
    } catch (err) { note("dropped", "movement", who, it?.name, "", err); }
  }
  for (const m of Array.isArray(flagMoves) ? flagMoves : []) if (typeof m?.mode === "string" && !out.some((x) => x.mode === m.mode)) out.push({ mode: m.mode, tier: m.tier ?? "basic" });
  /* S078: each boost and limit belongs to ONE way of moving in the book, and changes that one only (Gliding: "only glide with your
     FLIGHT" [B2004]; Brachiation: SWINGING [B2031]); a hero who also leaps is not held to the glider's ceiling. */
  const own = (m, x) => EXTRA_OF[x] === m.mode;
  return out.map((m) => ({ ...m, boosts: [...extras].filter((x) => own(m, x) && !LIMIT_IDS.includes(x)), limits: [...extras].filter((x) => own(m, x) && LIMIT_IDS.includes(x)) }));
}
