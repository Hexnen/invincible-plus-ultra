/**
 * Wizard state: the ONE serialisable object shared by UI, random generator and apply (pure module).
 * Everything here is immutable: every helper returns a NEW state, never mutates its input.
 *
 * STATE SHAPE (v1)
 * {
 *   v: 1, seed: string, mode: "manual"|"random",
 *   rank: "teen"|"street"|"global"|"cosmic",
 *   archetype: string|null,            // archetype id, null = from scratch
 *   role: string|null,
 *   identity: "secret"|"public"|null,
 *   sources: [{ key, name, packUuid|null }],
 *   powers:  [{ key, name, packUuid|null, level: 0..3, sourceKey, boosts:[{name,packUuid}],
 *               limits:[{name,packUuid, grants:"level"|"boost"}] }],
 *   heroTalent: {name,packUuid}|null,  extraTalents: [{name,packUuid}],
 *   occupation: string|null, occTalent: {name,packUuid}|null, resources: number,
 *   npcRel: { type, name },
 *   drawbacks: [{name,packUuid,note}],
 *   attrs: { fighting, agility, strength, reason, intuition, presence },   // sum must equal rules.budget(state)
 *   personality: [w1,w2], drive: {name,text}|null, flaw: {name,text}|null,
 *   heroName, civilianName, appearance: string,
 *   team: { name, base (kind of base), where (location), upgrades:[string "Name" | "Power Effect (Flight)"],
 *           mode: "text"|"join"|"create"|"member" (phase 5f: how the hero is tied to a team base actor), baseId: base actor id|null (join) },
 *   heroRel: { name, actorUuid|null },
 *   locks:   { <fieldName>: true },    // random mode: field excluded from re-rolls
 *   touched: { <stepId>: true },       // user edited the step by hand (global re-roll keeps it)
 *   rerolls: { <stepId|"plan">: n },   // substream counter: seed + counter => reproducible
 *   rollOpts: null|{ spice, drawbacks, extraTalents, extraSource, limits, variance, heroRel, within, joinBase }   // phase 6 (reroll.mjs): options of the roll board
 * }
 * Lock / reroll granularity = the field names in STEP_FIELDS.
 */
import { DEFAULT_RANK, ATTRS, RANKS } from "./rules.mjs";

export const STATE_VERSION = 1;

/** fields owned by each step (re-roll of a step touches only these) */
export const STEP_FIELDS = {
  rank: ["rank"],
  concept: ["archetype", "role"],
  powers: ["powers", "sources"],
  talents: ["heroTalent", "extraTalents", "drawbacks"],
  attributes: ["attrs"],
  life: ["occupation", "occTalent", "resources", "npcRel"],
  persona: ["personality", "drive", "flaw", "heroName", "civilianName"],
  team: ["team", "heroRel"]
};
export const FIELD_STEP = Object.fromEntries(Object.entries(STEP_FIELDS).flatMap(([s, fs]) => fs.map((f) => [f, s])));

export function createState({ seed = "000000", rank = DEFAULT_RANK, mode = "manual" } = {}) {
  return {
    v: STATE_VERSION, seed: String(seed), mode, rank,
    archetype: null, role: null, identity: null,
    sources: [], powers: [],
    heroTalent: null, extraTalents: [],
    occupation: null, occTalent: null, resources: 0, npcRel: { type: "", name: "" },
    drawbacks: [],
    attrs: Object.fromEntries(ATTRS.map((k) => [k, 2])),
    personality: [], drive: null, flaw: null,
    heroName: "", civilianName: "", appearance: "",
    team: { name: "", base: "", where: "", upgrades: [], mode: "text", baseId: null }, heroRel: { name: "", actorUuid: null },
    locks: {}, touched: {}, rerolls: {}, rollOpts: null
  };
}

// ---------- generic immutable updates ----------
/** new state with `patch` merged at top level */
export function patch(state, p) { return { ...state, ...p }; }

/** immutable set by path ("attrs.fighting" or ["attrs","fighting"]) */
export function setIn(obj, path, value) {
  const parts = Array.isArray(path) ? path : String(path).split(".");
  if (!parts.length) return value;
  const [h, ...rest] = parts;
  const base = Array.isArray(obj) ? obj.slice() : { ...(obj ?? {}) };
  base[h] = rest.length ? setIn(base[h], rest, value) : value;
  return base;
}
export function deepClone(x) { return x === undefined ? x : JSON.parse(JSON.stringify(x)); }

/** next free key like p1, p2 ... */
export function nextKey(list, prefix) {
  let n = list.length + 1;
  const used = new Set(list.map((x) => x.key));
  while (used.has(prefix + n)) n++;
  return prefix + n;
}

// ---------- domain helpers ----------
export const setRank = (s, rank) => patch(s, { rank });
export const setAttr = (s, attr, value) => setIn(s, ["attrs", attr], value);
export const setAttrs = (s, attrs) => patch(s, { attrs: { ...s.attrs, ...attrs } });

export function addSource(s, { name, packUuid = null }) {
  return patch(s, { sources: [...s.sources, { key: nextKey(s.sources, "s"), name, packUuid }] });
}
export function removeSource(s, key) {
  const fallback = s.sources.find((x) => x.key !== key)?.key;
  return patch(s, {
    sources: s.sources.filter((x) => x.key !== key),
    powers: s.powers.map((p) => (p.sourceKey === key ? { ...p, sourceKey: fallback ?? null } : p))
  });
}
export function addPower(s, { name, packUuid = null, level = 0, sourceKey } = {}) {
  const power = { key: nextKey(s.powers, "p"), name, packUuid, level, sourceKey: sourceKey ?? s.sources[0]?.key ?? null, boosts: [], limits: [] };
  return patch(s, { powers: [...s.powers, power] });
}
export const removePower = (s, key) => patch(s, { powers: s.powers.filter((p) => p.key !== key) });
const mapPower = (s, key, fn) => patch(s, { powers: s.powers.map((p) => (p.key === key ? fn(p) : p)) });
export const setPowerLevel = (s, key, level) => mapPower(s, key, (p) => ({ ...p, level }));
export const setPowerSource = (s, key, sourceKey) => mapPower(s, key, (p) => ({ ...p, sourceKey }));
export const addBoost = (s, key, boost) => mapPower(s, key, (p) => ({ ...p, boosts: [...p.boosts, { name: boost.name, packUuid: boost.packUuid ?? null }] }));
export const removeBoost = (s, key, i) => mapPower(s, key, (p) => ({ ...p, boosts: p.boosts.filter((_, j) => j !== i) }));
export const addLimit = (s, key, limit) => mapPower(s, key, (p) => ({ ...p, limits: [...p.limits, { name: limit.name, packUuid: limit.packUuid ?? null, grants: limit.grants ?? null }] }));
export const removeLimit = (s, key, i) => mapPower(s, key, (p) => ({ ...p, limits: p.limits.filter((_, j) => j !== i) }));

export const setHeroTalent = (s, t) => patch(s, { heroTalent: t ? { name: t.name, packUuid: t.packUuid ?? null } : null });
export const addExtraTalent = (s, t) => patch(s, { extraTalents: [...s.extraTalents, { name: t.name, packUuid: t.packUuid ?? null }] });
export const removeExtraTalent = (s, i) => patch(s, { extraTalents: s.extraTalents.filter((_, j) => j !== i) });
export const addDrawback = (s, d) => patch(s, { drawbacks: [...s.drawbacks, { name: d.name, packUuid: d.packUuid ?? null, note: d.note ?? "", ...(d.needs ? { needs: d.needs } : {}) }] });
export const removeDrawback = (s, i) => patch(s, { drawbacks: s.drawbacks.filter((_, j) => j !== i) });

export const toggleLock = (s, field) => {
  const locks = { ...s.locks };
  if (locks[field]) delete locks[field]; else locks[field] = true;
  return patch(s, { locks });
};
export const markTouched = (s, stepId) => patch(s, { touched: { ...s.touched, [stepId]: true } });
export const isLocked = (s, field) => !!s.locks?.[field];

// ---------- history (pure, per window) ----------
export function createHistory(state, cap = 50) { return { past: [], present: state, future: [], cap }; }
export function pushHistory(h, state) {
  if (state === h.present) return h;
  const past = [...h.past, h.present].slice(-h.cap);
  return { ...h, past, present: state, future: [] };
}
export function undo(h) { return h.past.length ? { ...h, past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h; }
export function redo(h) { return h.future.length ? { ...h, past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h; }

// ---------- serialisation ----------
export function serialize(state) { return JSON.stringify(state); }

/* phase 9 (C1 / C2): a draft or an imported object is UNTRUSTED. deserialize builds the state from a whitelist of keys with checked shapes and throws on anything
   it cannot make sense of (the caller shows "draft unusable, discard?"). No prototype key can become a rank, a lock or a counter. */
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const str = (x, d = "") => (typeof x === "string" ? x : d);
const list = (x, fn) => { if (x == null) return []; if (!Array.isArray(x)) throw new Error("chargen: bad list"); return x.map(fn); };
const ref = (x) => { if (x == null) return null; if (!isObj(x) || typeof x.name !== "string") throw new Error("chargen: bad reference"); return { name: x.name, packUuid: typeof x.packUuid === "string" ? x.packUuid : null }; };
const refReq = (x) => { const r = ref(x); if (!r) throw new Error("chargen: bad reference"); return r; };
const flagMap = (x, valid) => { const out = {}; if (x == null) return out; if (!isObj(x)) throw new Error("chargen: bad map"); for (const k of Object.keys(x)) if (valid(k, x[k])) out[k] = x[k]; return out; };
const textPair = (x) => { if (x == null) return null; if (!isObj(x)) throw new Error("chargen: bad text"); return { name: str(x.name), text: str(x.text) }; };

export function deserialize(text) {
  const raw = typeof text === "string" ? JSON.parse(text) : text;
  if (!isObj(raw) || raw.v !== STATE_VERSION) throw new Error("chargen: unsupported state version");
  if (!own(RANKS, raw.rank)) throw new Error("chargen: unknown rank");
  const base = createState({ seed: typeof raw.seed === "string" || typeof raw.seed === "number" ? raw.seed : "000000", rank: raw.rank, mode: raw.mode === "random" ? "random" : "manual" });
  const stepOk = (k) => own(STEP_FIELDS, k) || k === "board" || k === "plan" || /^[A-Za-z:]{1,24}$/.test(k);
  const attrs = { ...base.attrs };
  if (raw.attrs != null) { if (!isObj(raw.attrs)) throw new Error("chargen: bad attrs"); for (const k of ATTRS) if (own(raw.attrs, k) && Number.isFinite(Number(raw.attrs[k]))) attrs[k] = Number(raw.attrs[k]); }
  let team = base.team;
  if (raw.team != null) {
    if (!isObj(raw.team)) throw new Error("chargen: bad team");
    const tm = raw.team;
    team = { ...base.team, name: str(tm.name), base: str(tm.base), where: str(tm.where), upgrades: list(tm.upgrades, (u) => String(u ?? "")), mode: ["text", "join", "create", "member"].includes(tm.mode) ? tm.mode : "text", baseId: typeof tm.baseId === "string" ? tm.baseId : null };
  }
  const note = (n) => (typeof n === "string" ? n : "");
  return {
    ...base,
    archetype: typeof raw.archetype === "string" ? raw.archetype : null,
    role: typeof raw.role === "string" ? raw.role : null,
    identity: raw.identity === "secret" || raw.identity === "public" ? raw.identity : null,
    sources: list(raw.sources, (x) => ({ key: str(refReq(x) && x.key, "s"), ...refReq(x) })),
    powers: list(raw.powers, (x) => {
      const r = refReq(x);
      return { key: str(x.key, "p"), ...r, level: Number.isInteger(x.level) ? x.level : 0, sourceKey: typeof x.sourceKey === "string" ? x.sourceKey : null,
        boosts: list(x.boosts, refReq), limits: list(x.limits, (l) => ({ ...refReq(l), grants: l.grants === "level" || l.grants === "boost" ? l.grants : null })), ...(note(x.note) ? { note: x.note } : {}) };
    }),
    heroTalent: ref(raw.heroTalent), extraTalents: list(raw.extraTalents, refReq),
    occupation: typeof raw.occupation === "string" ? raw.occupation : null, occTalent: ref(raw.occTalent), resources: Number.isFinite(Number(raw.resources)) ? Number(raw.resources) : 0,
    npcRel: isObj(raw.npcRel) ? { type: str(raw.npcRel.type), name: str(raw.npcRel.name) } : base.npcRel,
    drawbacks: list(raw.drawbacks, (x) => ({ ...refReq(x), note: note(x.note), ...(x.needs === "source" || x.needs === "defined" ? { needs: x.needs } : {}) })),
    attrs,
    personality: list(raw.personality, (w) => String(w ?? "")), drive: textPair(raw.drive), flaw: textPair(raw.flaw),
    heroName: str(raw.heroName), civilianName: str(raw.civilianName), appearance: str(raw.appearance),
    team, heroRel: isObj(raw.heroRel) ? { name: str(raw.heroRel.name), actorUuid: typeof raw.heroRel.actorUuid === "string" ? raw.heroRel.actorUuid : null } : base.heroRel,
    locks: flagMap(raw.locks, (k, v) => v === true && own(FIELD_STEP, k)),
    touched: flagMap(raw.touched, (k, v) => v === true && own(STEP_FIELDS, k)),
    rerolls: flagMap(raw.rerolls, (k, v) => Number.isInteger(v) && v >= 0 && stepOk(k)),
    rollOpts: isObj(raw.rollOpts) ? JSON.parse(JSON.stringify(raw.rollOpts)) : null
  };
}

/** phase 9 (C5): an async roll computed `next` from `base`; the user may have changed the state meanwhile (`current`). Apply only what the roll changed on top of the
    CURRENT state: keys whose value differs between base and next are taken from next, the counters / maps (rerolls, locks, touched) merge per key. */
export function rebase(current, base, next) {
  if (current === base) return next;
  const out = { ...current };
  for (const k of Object.keys(next)) {
    if (next[k] === base[k]) continue;
    if ((k === "rerolls" || k === "touched" || k === "locks") && isObj(next[k]) && isObj(base[k])) {
      const m = { ...(current[k] ?? {}) };
      for (const kk of Object.keys(next[k])) if (next[k][kk] !== base[k][kk]) m[kk] = next[k][kk];
      for (const kk of Object.keys(base[k])) if (!(kk in next[k])) delete m[kk];
      out[k] = m;
    } else out[k] = next[k];
  }
  return out;
}
