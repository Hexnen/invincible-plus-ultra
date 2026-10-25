/* Effect bonuses of the chosen talents / drawbacks for the wizard's live preview (phase 5c).
   NUMBERS ARE READ AT RUNTIME from the pack items' effects (fromUuid), never typed in here: a transfer effect that is NOT disabled and
   changes Health / Resolve / Slugfest bonus, Resources or Reputation by "add" counts (Durable +2 Health, Determined +2 Resolve,
   Windfall +2 Resources, Renowned +3 Reputation, Hard Times -1 Resources ...). Conditional effects ship DISABLED in the pack (Hard Hitter,
   Bigger They Are, Martial Arts ...): the sheet does not apply them, so neither do we.
   Sync part (bonusSum / fxOf) works from a cache; the async part (warmBonuses, primeFx) fills it. wizard.mjs exposes `app.bonuses` as
   bonusSum(state) and repaints the preview when warmBonuses learned something new. No Foundry writes. */
import { normName } from "./rules.mjs";

/** effect change key -> bonuses field (the fields rules.derive() understands) */
export const FX_KEYS = {
  "system.derived.health.bonus": "health",
  "system.derived.resolve.bonus": "resolve",
  "system.derived.slugfest.bonus": "slugfest",
  "system.resources": "resources",
  "system.reputation": "reputation"
};
export const FX_FIELDS = ["health", "resolve", "slugfest", "reputation", "resources"];

const cache = new Map();       // "<uuid>" or "<type>:<name>" -> fx object
const inflight = new Map();    // same keys -> promise

const nameKey = (type, ref) => `${type}:${normName(ref?.name)}`;

/** sum of the active "add" changes of a document's transfer effects, only the fields the preview shows */
export function bonusOfDoc(doc) {
  const fx = {};
  for (const e of doc?.effects ?? []) {
    if (e.disabled || e.transfer === false) continue;
    const changes = e.system?.changes ?? e.changes ?? [];
    for (const c of changes) {
      const field = FX_KEYS[c?.key];
      if (!field) continue;
      const kind = c.type ?? (c.mode === 2 ? "add" : "");
      if (kind !== "add") continue;
      const v = Number(c.value);
      if (Number.isFinite(v) && v !== 0) fx[field] = (fx[field] ?? 0) + v;
    }
  }
  return fx;
}

/** remember what a document gave (used by the description loader of the step, which already fetches the document) */
export function primeFx(uuid, fx, type = null, name = null) {
  if (uuid) cache.set(uuid, fx);
  if (type && name) cache.set(nameKey(type, { name }), fx);
}

/** cached fx of one state reference, or null while unknown */
export function fxOf(type, ref) {
  if (!ref) return null;
  return (ref.packUuid && cache.get(ref.packUuid)) || cache.get(nameKey(type, ref)) || null;
}

/** all talent / drawback references of a state: [{type, ref}] */
export function itemRefs(state) {
  const out = [];
  if (state?.heroTalent?.name) out.push({ type: "talent", ref: state.heroTalent });
  if (state?.occTalent?.name) out.push({ type: "talent", ref: state.occTalent });
  for (const x of state?.extraTalents ?? []) out.push({ type: "talent", ref: x });
  for (const x of state?.drawbacks ?? []) out.push({ type: "drawback", ref: x });
  return out;
}

/** {health, resolve, slugfest, resources, reputation} summed over everything the state holds (known items only) */
export function bonusSum(state) {
  const sum = {};
  for (const { type, ref } of itemRefs(state)) {
    const fx = fxOf(type, ref);
    if (fx) for (const [k, v] of Object.entries(fx)) sum[k] = (sum[k] ?? 0) + v;
  }
  return sum;
}

/** read the effects of every referenced item that is not cached yet; resolves true when the cache grew */
export async function warmBonuses(state, catalog) {
  const todo = itemRefs(state).filter(({ type, ref }) => !fxOf(type, ref));
  if (!todo.length) return false;
  await Promise.all(todo.map(async ({ type, ref }) => {
    const key = ref.packUuid || nameKey(type, ref);
    if (!inflight.has(key)) {
      inflight.set(key, (async () => {
        try {
          let uuid = ref.packUuid;
          if (!uuid && catalog?.findByName) uuid = (await catalog.findByName(type, ref.name))?.packUuid ?? null;
          const doc = uuid ? await fromUuid(uuid) : null;
          primeFx(uuid, bonusOfDoc(doc), type, ref.name);
        } catch (err) {
          primeFx(null, {}, type, ref.name);   // unknown item: no effects, and do not retry on every change
          console.warn("invincible-plus-ultra | chargen: cannot read the effects of", ref.name, err);
        } finally { inflight.delete(key); }
      })());
    }
    await inflight.get(key);
  }));
  return true;
}
