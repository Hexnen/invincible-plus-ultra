/* Tactical combat (package P1): the SYSTEM ADAPTER, the only tactics file that knows where the Invincible system keeps its data
   (system `invincible` 2.1.x, read-only for us except the two actor updates at the bottom). Only what P1 needs lives here; the action
   engine (P2) has its own readers for pools, gear and powers.
   Data paths (verified in the system's template and in this module's other features): actor.type superhero | npc | minions | challenge |
   vehicle; system.derived.health / resolve = { value, max }; system.attributes.<key>.value; talents are Items of type "talent".
   FRAGILE, reported: the system gives talents no key, only a name. Combat Veteran and Fast Reflexes are recognised by item name (the
   English names below, case-insensitive) or by an explicit actor flag, flags.<module>.tactics.talents = { combatVeteran, fastReflexes },
   which wins when present. A renamed or translated talent item needs the flag. */
import * as S from "./state-pure.mjs";
import * as O from "./ops-pure.mjs";

const MOD = S.MOD_ID;
export const TALENT_NAMES = { combatVeteran: ["combat veteran"], fastReflexes: ["fast reflexes"] };
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export const actorOf = (c) => c?.token?.actor ?? c?.actor ?? null;
export function hasTalent(actor, key) {
  try {
    const flag = actor?.flags?.[MOD]?.tactics?.talents?.[key];
    if (typeof flag === "boolean") return flag;
    const names = TALENT_NAMES[key] ?? [];
    return !!actor?.items?.some?.((i) => i.type === "talent" && names.includes(norm(i.name)));
  } catch { return false; }
}
/** the non-GM users who own the combatant's actor (the ones a prompt about it is addressed to) */
export function ownersOf(actor) {
  try { return game.users.filter((u) => !u.isGM && O.ownsFrom(actor?.ownership, u.id, CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3)).map((u) => u.id); } catch { return []; }
}
/** does this user own the combatant (its actor's REAL ownership table; a claimed role never counts)? */
export function owns(combatant, user) {
  const a = actorOf(combatant);
  return !!a && !!user && O.ownsFrom(a.ownership, user.id, CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3);
}
/** One Participant of ops-pure for a Combatant document. */
export function participant(c) {
  const a = actorOf(c);
  const summonOf = c?.flags?.[MOD]?.tactics?.summonOf;
  return {
    id: c.id,
    hero: a?.type === "superhero",                                   // heroes draw before NPCs [B2112] [OQ-13]
    owners: ownersOf(a),
    defeated: !!c.isDefeated,
    challenge: a?.type === "challenge",                              // no card [I12] [R22]
    summonOf: S.isId(summonOf) ? summonOf : null,                    // acts on its owner's turn [I14]; set by the action engine or the GM
    veteran: hasTalent(a, "combatVeteran"),                          // [I7]
    reflexes: hasTalent(a, "fastReflexes"),                          // [I6]
    resolve: num(a?.system?.derived?.resolve?.value, 0)
  };
}
export const participants = (combat) => { try { return combat.combatants.map(participant); } catch { return []; } };
/** combatants Foundry hides from a non-GM user (spec 10) */
export const hiddenIds = (combat) => { try { return combat.combatants.filter((c) => c.hidden).map((c) => c.id); } catch { return []; } };

/** the facts of the end-of-scene plan (spec 6.8) for every combatant with an actor */
export function sceneFacts(combat) {
  const out = [];
  try {
    for (const c of combat.combatants) {
      const a = actorOf(c);
      if (!a) continue;
      const d = a.system?.derived ?? {};
      out.push({ id: c.id, name: c.name, type: a.type, health: num(d.health?.value), maxHealth: num(d.health?.max), resolve: num(d.resolve?.value), maxResolve: num(d.resolve?.max),
        strength: num(a.system?.attributes?.strength?.value), regeneration: a.flags?.[MOD]?.tactics?.regeneration === true });   // Regeneration [B1893]: no key in the system, the flag is set by the GM or P6
    }
  } catch { /* no facts */ }
  return out;
}

/* ------------------------------------------------------------------ the two writes of P1 (executor only) */
/** voluntary stress: Resolve goes down by n, not below 0 [I7] [B2100] */
export async function applyStress(combat, combatantId, n) {
  const a = actorOf(combat?.combatants?.get(combatantId));
  const cur = num(a?.system?.derived?.resolve?.value, NaN);
  if (!a || !Number.isFinite(cur) || !(n > 0)) return false;
  await a.update({ "system.derived.resolve.value": Math.max(0, cur - n) }, { ipuTactics: true });
  return true;
}
/** the recovery lines of the end of a scene (scheduler-pure sceneEndPlan); a value that changed in the meantime is not overwritten */
export async function applyRecovery(combat, lines) {
  const done = [];
  for (const l of lines ?? []) {
    try {
      const a = actorOf(combat?.combatants?.get(l.id));
      if (!a) continue;
      const data = {};
      if (l.health.to !== l.health.from && num(a.system?.derived?.health?.value, NaN) === l.health.from) data["system.derived.health.value"] = l.health.to;
      if (l.resolve.to !== l.resolve.from && num(a.system?.derived?.resolve?.value, NaN) === l.resolve.from) data["system.derived.resolve.value"] = l.resolve.to;
      if (Object.keys(data).length) { await a.update(data, { ipuTactics: true }); done.push(l.id); }
    } catch (e) { console.warn(`${MOD} | tactics recovery failed for ${l.id}`, e); }
  }
  return done;
}
