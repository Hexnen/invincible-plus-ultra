/* Tactical combat, package P2: MODIFIER TOKENS, USE COUNTERS, STATUSES, DAMAGE TAGS, EFFECT SOURCES (spec 6.2-6.7). NO Foundry globals.
   Data helpers only. Each returns plain values or `{ path, to }` writes for the engine to journal (engine-pure.mjs turns a write into a
   reversible state op); nothing here mutates its input. Rule decisions carry the spec's citation marks. */
import { isId } from "./state-pure.mjs";

/* ------------------------------------------------------------------ switches for open questions (cheap to flip, spec 0.1) */
export const OQ2_IMMOBILISED_AS_SNARED = true;     // [OQ-2] provisional: Cold / Magnetism / Plant Control immobilisation counts like Snare
export const TOKEN_NONSTACK_BEST_ONLY = true;      // [D] reading of ModToken.stacks=false: of several tokens of one source only the largest is offered (reported as a spec hole)

/* ------------------------------------------------------------------ effect sources (spec 6.1 `EffectSource`) */
export const SOURCE_KINDS = Object.freeze(["power", "talent", "drawback", "gear", "hazard", "challenge", "stunt", "crit", "gm"]);
export function source(src = {}) {
  const out = { kind: SOURCE_KINDS.includes(src.kind) ? src.kind : "gm", name: String(src.name ?? "").slice(0, 80) };
  for (const k of ["owner", "itemUuid", "level", "powerSource"]) if (src[k] != null) out[k] = src[k];
  return out;
}

/* ------------------------------------------------------------------ modifier tokens (spec 6.2) */
export const ROLL_KINDS = Object.freeze(["attack", "block", "dodge", "other"]);
export const TOKEN_EXPIRES = Object.freeze(["roundEnd", "turnEndOf", "nextTurnOf", "sceneEnd", "used", "nextTurnEndOf"]);      // PWE: nextTurnEndOf = the end of the NEXT turn of `who` that starts (ops-pure turnMoment turns it into turnEndOf)
export function makeToken(t) {
  const dice = Math.trunc(Number(t.dice) || 0);
  if (!isId(t.id) || !isId(t.holder) || !dice) return null;
  const scope = {};
  if (Array.isArray(t.scope?.rolls)) scope.rolls = t.scope.rolls.filter((r) => ROLL_KINDS.includes(r));
  if (Array.isArray(t.scope?.attrs)) scope.attrs = t.scope.attrs.filter((a) => typeof a === "string").slice(0, 6);
  if (t.scope?.purpose) scope.purpose = String(t.scope.purpose).slice(0, 300);
  if (t.scope?.next) scope.next = 1;
  const out = { id: t.id, holder: t.holder, dice, scope, uses: t.uses === "all" ? "all" : Math.max(1, Math.trunc(Number(t.uses) || 1)), stacks: t.stacks === true,
    source: source(t.source), expires: { at: TOKEN_EXPIRES.includes(t.expires?.at) ? t.expires.at : "roundEnd" } };
  if (isId(t.expires?.who)) out.expires.who = t.expires.who;
  if (isId(t.from)) out.from = t.from;
  if (t.needsGm || scope.purpose) out.needsGm = 1;
  if (t.forced) out.forced = 1;                          // P6: put on the holder's roll by somebody else (Luck Control [B1727]); counted without being chosen       // spec 6.2: a token with `purpose` or `needsGm` shows the GM a one-click confirmation
  return out;
}
/** A token that counts on every roll of its scope without being chosen: put there by somebody else (`forced`, Luck Control [B1727]), or
    standing for all rolls of its scope (`uses: "all"`, Action Plan: "+1 die to ALL attribute rolls covered by the plan" [B1634]) and not
    waiting for the GM's word. Everything else is a die the holder chooses to spend. */
export const standing = (t) => !!t && (t.forced === 1 || t.forced === true || (t.uses === "all" && !t.needsGm));
/** Tokens `holder` may add to a roll. roll = { kind: one of ROLL_KINDS, attr }. */
export function tokensFor(state, holder, roll) {
  const list = (state.tokens ?? []).filter((t) => t.holder === holder
    && (!t.scope?.rolls?.length || t.scope.rolls.includes(roll.kind))
    && (!t.scope?.attrs?.length || t.scope.attrs.includes(roll.attr)));
  if (!TOKEN_NONSTACK_BEST_ONLY) return list;
  const best = new Map();
  const out = [];
  for (const t of list) {
    if (t.stacks) { out.push(t); continue; }
    const k = `${t.source?.kind}|${t.source?.name}|${Math.sign(t.dice)}`, b = best.get(k);
    if (!b || Math.abs(t.dice) > Math.abs(b.dice)) best.set(k, t);
  }
  return [...out, ...best.values()];
}
/** Dice modifiers `[{ source, dice }]` (dice.buildPool format) of the chosen tokens, and the writes that spend them. Unknown or foreign ids are ignored. */
export function spendTokens(state, holder, roll, ids = []) {
  const ok = tokensFor(state, holder, roll).filter((t) => ids.includes(t.id));
  const mods = ok.map((t) => ({ source: `token:${t.id}`, dice: t.dice, label: t.source?.name ?? "" }));
  const writes = ok.filter((t) => t.uses !== "all").map((t) => ({ path: ["tokens", `#${t.id}`], to: t.uses > 1 ? { ...t, uses: t.uses - 1 } : null }));
  return { mods, writes, used: ok.map((t) => t.id), needGm: ok.filter((t) => t.needsGm).map((t) => t.id) };
}
/** Ids of the tokens that end at a scheduler point. point = { at: "roundEnd"|"turnEndOf"|"nextTurnOf"|"sceneEnd", who? }. */
export function expiredTokens(state, point) {
  return (state.tokens ?? []).filter((t) => t.expires?.at === point.at && (t.expires.who == null || t.expires.who === point.who)).map((t) => t.id);
}

/* ------------------------------------------------------------------ use counters (spec 6.4) */
export const counterKey = {
  round: (cid, what) => `round:${cid}:${what}`,
  scene: (cid, what) => `scene:${cid}:${what}`,
  zone: (zoneKey, what) => `zone:${zoneKey}:${what}`,
  session: (actorId, what) => `session:${actorId}:${what}`,        // persisted on the actor flag by the system adapter, mirrored here during the fight
};
export const counterGet = (state, key) => Number(state.counters?.[key]) || 0;
export const counterLeft = (state, key, max) => Math.max(0, max - counterGet(state, key));
export const counterBump = (state, key, by = 1) => ({ path: ["counters", key], to: counterGet(state, key) + by });
/** Writes that clear every counter of a scope ("round" at round start [L5], "scene" and "zone" at scene end, spec 6.8). */
export const counterReset = (state, scope) => Object.keys(state.counters ?? {}).filter((k) => k.startsWith(`${scope}:`)).map((k) => ({ path: ["counters", k], to: null }));

/* ------------------------------------------------------------------ statuses (spec 6.3) */
export const STATUS_IDS = Object.freeze(["broken", "unconscious", "dying", "dead", "stressedOut", "grappled", "grappling", "snared", "immobilised", "trapped", "unaware",
  "stunned", "burning", "airborne", "carrying", "carried", "afflicted", "invisible", "huge", "noLegs", "sick", "itemLost", "inVehicle", "suffocating", "intangible",
  "conductive"]);      // PWC (PW019) [B1680]: made of a conductive material (metal), the GM's mark
/* ANSE (U17-1, the user 2026-11-12: «Wszystkie jak rekomendacja»): the SIDE a character fights on, for choosing targets, the cards (who is an
   ally, an extra opponent of the target's side U17-R1) and the colours: the facts' `team` ("heroes" | "gm": an ordinary NPC whose token is
   friendly stands with the heroes, engine.mjs), else by `npc`. The rules of an NPC (its wounds [B2771], who pushes, secret numbers) still read `npc`. */
export const teamOf = (f) => (f?.team === "heroes" || f?.team === "gm" ? f.team : f?.npc ? "gm" : "heroes");
export const sameTeam = (a, b) => teamOf(a) === teamOf(b);
export const statusesOf = (state, cid) => state.statuses?.[cid] ?? [];
export const hasStatus = (state, cid, id) => statusesOf(state, cid).some((s) => s.id === id);
export function statusAdd(state, cid, st) {
  const cur = statusesOf(state, cid);
  const rec = { id: String(st.id).slice(0, 40), source: source(st.source), since: { round: state.round } };
  if (st.data && typeof st.data === "object") rec.data = st.data;
  if (st.mirror) rec.mirror = st.mirror;
  if (st.ends) rec.ends = st.ends;
  return { path: ["statuses", cid], to: [...cur.filter((s) => s.id !== rec.id), rec] };
}
export function statusRemove(state, cid, id) {
  const next = statusesOf(state, cid).filter((s) => s.id !== id);
  return { path: ["statuses", cid], to: next.length ? next : null };
}
/** The target conditions the rules library asks for (attack.defenceOptions / attackModifiers), from statuses and the ledger.
    grappled -> held [R6]; snared [R21]; immobilised -> snared under [OQ-2]; trapped [R20]; unaware [B2430]; stunned or a lost turn -> noInterrupts [R10];
    a carried pair that stayed in the air -> carriedAloft [B2392]. */
/** PWC (PW005) [B1611]: a Snare whose limit is Immobilize Only: the snared character performs actions normally and only cannot move until
    it breaks free (the break-free is SNARE's own, with the status' level penalty) */
export const snaredMoveOnly = (state, cid) => statusesOf(state, cid).some((s) => s.id === "snared" && s.data?.moveOnly === 1);
export function conditions(state, cid) {
  const has = (id) => hasStatus(state, cid, id);
  const l = state.ledger?.[cid];
  const moveOnly = snaredMoveOnly(state, cid);
  return {
    held: has("grappled"),
    snared: (has("snared") && !moveOnly) || (OQ2_IMMOBILISED_AS_SNARED && has("immobilised")),
    rooted: moveOnly,                                                              // PWC (PW005): moves nowhere, does everything else
    trapped: has("trapped"),
    unaware: has("unaware"),
    noInterrupts: has("stunned") || !!l?.noInterrupts || !!l?.lostTurn,
    carriedAloft: (has("carrying") || has("carried")) && has("airborne"),
  };
}

/** Why a combatant is out of action, or null [B2707]: broken (Health 0: no movement, no attribute roll, no power), or marked unconscious or
    dead (a knock-out or a kill the GM stated [B2771], a fatal injury [B2749-2765]). A machine and a challenge have no such state. */
export function outOfAction(state, cid, c) {
  if (!c || c.kind === "vehicle" || c.kind === "challenge") return null;
  if (hasStatus(state, cid, "dead")) return "dead";
  if (!(c.health > 0)) return "broken";
  return hasStatus(state, cid, "unconscious") ? "unconscious" : null;
}

/* ------------------------------------------------------------------ damage tags (spec 9.5 steps 1-6, events table "damage") */
export const DAMAGE_CAUSES = Object.freeze(["attack", "barrier", "hazard", "fall", "stunt", "counter", "gm"]);
/** Normalised tags of one damage event. source = the nature of the damage for immunities and vulnerabilities [B1877-1880], [B2193];
    sharp enables Deadly Hit [B2440]; toStress sends it to Resolve [B1591]; ignoreArmor for attacks that say so [B1618]. */
export function damageTags(t = {}) {
  return { source: typeof t.source === "string" && t.source ? t.source.slice(0, 24) : "kinetic", sharp: t.sharp === true, toStress: t.toStress === true,
    ignoreArmor: t.ignoreArmor === true, cause: DAMAGE_CAUSES.includes(t.cause) ? t.cause : "attack" };
}

/* ------------------------------------------------------------------ ongoing effects, ground items, summons (spec 6.5-6.7): records only */
export function makeEffect(e) {
  if (!isId(e.id) || typeof e.kind !== "string") return null;
  const out = { id: e.id, kind: e.kind.slice(0, 40), source: source(e.source), data: e.data && typeof e.data === "object" ? e.data : {}, ends: { at: String(e.ends?.at ?? "sceneEnd").slice(0, 24) } };
  if (isId(e.holder)) out.holder = e.holder;
  if (isId(e.ends?.who)) out.ends.who = e.ends.who;
  for (const k of ["zones", "statusIds", "triggerIds", "tokenIds", "zoneStateIds"]) if (Array.isArray(e[k])) out[k] = e[k].filter((x) => typeof x === "string").slice(0, 40);
  return out;
}
/** Everything a lasting effect registered, as the writes that end it (Nullification [B1772], "when you are broken" [B1654], a lost Signature Item [B1965]). */
export function effectEndWrites(state, effectId) {
  const e = (state.effects ?? []).find((x) => x.id === effectId);
  if (!e) return [];
  const w = [{ path: ["effects", `#${e.id}`], to: null }];
  for (const id of e.tokenIds ?? []) w.push({ path: ["tokens", `#${id}`], to: null });
  for (const id of e.triggerIds ?? []) w.push({ path: ["triggers", `#${id}`], to: null });
  if (e.holder && (e.statusIds ?? []).length) {
    const next = statusesOf(state, e.holder).filter((s) => !e.statusIds.includes(s.id));
    w.push({ path: ["statuses", e.holder], to: next.length ? next : null });
  }
  return w;
}
/** Effects that end at a point: { at: "sceneEnd"|"ownerBroken"|"nextTurnOf"|"dismissed"|"breached", who? }. */
export const effectsEndingAt = (state, point) => (state.effects ?? []).filter((e) => e.ends?.at === point.at && (e.ends.who == null || e.ends.who === point.who)).map((e) => e.id);
/** Catalog entries a combatant holds through `borrowedPower` effects (spec 6.5; GM op powerGrant). */
export const grantedEntries = (state, cid) => (state.effects ?? []).filter((e) => e.kind === "borrowedPower" && e.holder === cid && e.data?.entry).map((e) => e.data.entry);

export const GROUND_STATES = Object.freeze(["held", "ground", "taken"]);
export function makeGroundItem(i) {
  if (!isId(i.id)) return null;
  const out = { id: i.id, itemUuid: typeof i.itemUuid === "string" ? i.itemUuid : null, name: String(i.name ?? "").slice(0, 80), owner: String(i.owner ?? ""), state: GROUND_STATES.includes(i.state) ? i.state : "ground" };
  if (isId(i.holder)) out.holder = i.holder;
  if (typeof i.zone === "string") out.zone = i.zone.slice(0, 40);        // a spot string, never a zone id (spec 2)
  return out;
}
