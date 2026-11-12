/* Tactical combat, package P5: flow "act": every row of the book's action tables that is neither an attack nor a move, and the escapes
   (spec 8.1, 9.7). NO Foundry globals. The rows are data (actions-pure.mjs); the numbers come from the rules library.
   Steps: check -> roll (the actor's roll, then the other side's in an opposed roll: only the active party pushes [B2241]; a tie fails
   for the active party [B2243]) -> effect -> outcome (the GM's word on a narrative action, spec 9.7) -> close.
   A row without a roll (pick up an item [B2316], an item or a power used without one) goes straight to its effect. */
import { maneuvers, hazards, crits, damage, dice } from "../../rules/index.mjs";
import * as M from "../mods-pure.mjs";
import { ATTRS, attrChoices } from "../actions-pure.mjs";
import * as K from "./kit.mjs";
import * as Lg from "../ledger-pure.mjs";

const bad = (reason, params = {}) => ({ ok: false, reason, params });
const fine = { ok: true, reason: null, params: {}, gates: [], notes: [] };
const GM = { gmMayAllow: 1 };
const RESTRAINTS = ["grappled", "snared", "immobilised"];                      // no action that needs body movement [B2496], [B1606], [B1645]
const statusOf = (v, cid, id) => M.statusesOf(v.state, cid).find((s) => s.id === id) ?? null;
const kindOf = (v, inst) => v.entry(inst)?.effect?.kind ?? "narrative";
/** whom the action is about: the named character, else the actor (rally, recover Resolve, extinguish) */
export const subjectOf = (inst) => inst.decl?.targets?.[0] ?? inst.actor;
/** the attribute rolled: fixed by the row, else the one declared out of the row's choices; null = no roll */
export function attrOf(v, inst) {
  const e = v.entry(inst), r = e?.roll;
  if (!r) return null;
  if (r.attr) return r.attr;
  const held = e?.effect?.kind === "escape" ? statusOf(v, inst.actor, e.effect.from)?.data?.attr : null;
  if (typeof held === "string" && attrChoices(e).includes(held)) return held;      // Z11 [B1944]: what holds the character names the attribute (Environment Phasing: STRENGTH)
  const list = attrChoices(e), a = inst.decl?.attr;
  if (list.includes(a)) return a;
  if (r.optional) return null;
  if (r.attrs === "any") return null;
  const c = v.facts.c(inst.actor);                                               // a short list and nothing declared: the better of them (Trap [B2438])
  return list.slice().sort((x, y) => (Number(c?.attrs?.[y]) || 0) - (Number(c?.attrs?.[x]) || 0))[0] ?? null;
}
/** who rolls against the actor, and with what: { who, attr } | null */
export function opponentOf(v, inst) {
  const o = v.entry(inst)?.oppose;
  if (!o) return null;
  if (o.who === "holder") { const by = statusOf(v, inst.actor, "grappled")?.data?.by; return by && v.facts.c(by) && v.facts.c(by).present !== false ? { who: by, attr: o.attr } : null; }
  const t = inst.decl?.targets?.[0];
  return t && t !== inst.actor ? { who: t, attr: o.attr } : null;
}
/** dice penalty of breaking out of a Snare: what the status carries, else the basic level [B1606-1609] */
export function snarePenalty(st) {
  if (Number.isFinite(st?.data?.dice)) return Math.min(0, Math.trunc(st.data.dice));
  return maneuvers.SNARE_ESCAPE_DICE[st?.data?.level] ?? maneuvers.SNARE_ESCAPE_DICE.basic;
}
/* P6: the actions a character's own powers, talents and gear give (kit-pure.mjs). The stress an entry costs is charged when it locks. */
export const stressOf = (v, inst) => { const e = v.entry(inst);      // a fixed price, 1 per extra target chosen as a number, 1 per target beyond the first
  return (inst.decl?.stressTotal ?? 0) + (e?.stress?.fixed ?? 0) + (e?.stressPick ? Math.max(0, Math.trunc(Number(inst.decl?.opt) || 0)) : 0) + (e?.stressExtra ? Math.max(0, (inst.decl?.targets?.length ?? 0) - 1) : 0); };
const markKey = (cid, fx) => (fx.scene ? M.counterKey.scene(cid, fx.id) : M.counterKey.round(cid, fx.id));
/* Z7 [B1686]: "once per action scene in the same zone" (`once: "sceneZone"`, Body Battery) counts per zone the actor stands in; with no map to
   name the zone it counts as once per scene (the GM may allow) */
const zoneOnce = (v, cid) => { const z = v?.facts?.zone?.(cid); const k = z?.key ?? z?.spot; return typeof k === "string" && k ? `@${k.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24)}` : ""; };
export const onceKey = (inst, e, v = null) => (e?.once === "round" ? M.counterKey.round(inst.actor, e.id) : e?.once === "sceneZone" ? M.counterKey.scene(inst.actor, `${e.id}${zoneOnce(v, inst.actor)}`) : e?.once ? M.counterKey.scene(inst.actor, e.id) : null);
const sid = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
const srcOf = (I, e) => ({ kind: ["power", "talent", "drawback", "gear"].includes(e?.kit?.cat) ? e.kit.cat : "power", owner: I.actor, name: e?.name ?? "" });
const teamOf = (v, cid) => { const a = v.facts.c(cid); return Object.keys(v.state.ledger ?? {}).filter((id) => { const c = v.facts.c(id); return id !== cid && c && c.present !== false && !!c.npc === !!a?.npc && c.kind !== "challenge" && c.kind !== "vehicle"; }); };
const PLAN_ROLLS = { attack: ["attack"], defend: ["block", "dodge"], misdirect: ["other"] };
const token = (R, t) => { const tk = M.makeToken(t); if (tk) R.effects.push({ t: "state", path: ["tokens", `#${tk.id}`], to: tk }); };
/** what an action of the kit does once its roll is in (returns nothing; pushes effects and notes on I.data) */
function kitEffect(v, I, R, e, { kind, subject, sf, success, sixes }) {
  const a = v.facts.c(I.actor), fx = e.effect ?? {}, src = srcOf(I, e), opt = I.decl.opt;
  const status = (who, id, on) => R.events.push({ type: "status", target: who, status: { id, on } });
  switch (kind) {
    case "shake": if (success && M.hasStatus(v.state, I.actor, "afflicted")) { R.effects.push({ t: "status-", who: I.actor, id: "afflicted" }); status(I.actor, "afflicted", false); } break;      // [B1574]
    case "status": if (success) {
      const who = fx.on === "self" ? I.actor : subject, has = M.hasStatus(v.state, who, fx.id);
      if (has && fx.toggle) { R.effects.push({ t: "status-", who, id: fx.id }); status(who, fx.id, false); }
      else if (!has) { R.effects.push({ t: "status+", who, status: { id: fx.id, source: src, ...(fx.data ? { data: fx.data } : {}) } }); status(who, fx.id, true); }
    } break;
    case "plan": if (success) for (const id of teamOf(v, I.actor)) token(R, { id: sid(`p${I.id}${id}`), holder: id, dice: sixes, scope: { rolls: PLAN_ROLLS[opt] ?? PLAN_ROLLS.attack }, uses: "all", source: src, from: I.actor, expires: { at: "nextTurnOf", who: I.actor } }); break;   // [B1634]
    case "barrier": {                                                                        // [B1859-1862]: Armor by level, as many at once as the level allows, gone when breached
      const mine = (v.state.effects ?? []).filter((x) => x.kind === "barrier" && x.data?.by === I.actor), max = fx.max > 0 && fx.armor > 3 ? fx.armor : fx.max ?? 3;
      for (const old of mine.slice(0, Math.max(0, mine.length - max + 1))) for (const w of M.effectEndWrites(v.state, old.id)) R.effects.push({ t: "state", path: w.path, to: w.to });
      const ef = M.makeEffect({ id: sid(`b${I.id}`), kind: "barrier", holder: subject, source: src, data: { armor: fx.armor ?? 3, by: I.actor }, ends: { at: "breached" } });
      if (ef) R.effects.push({ t: "state", path: ["effects", `#${ef.id}`], to: ef });
      I.data.gain = fx.armor ?? 3; break;
    }
    case "heal": if (success) for (const who of fx.mass && I.decl.targets?.length ? [...new Set(I.decl.targets)] : [subject]) {      // [B1932]; Mass Healing [B1934]: one roll for all of them
      const hf = v.facts.c(who); if (!hf) continue;
      const to = Math.min(hf.maxHealth, hf.health + (fx.per ?? 3) * sixes); if (to > hf.health) R.effects.push({ t: "actor", who, path: "health", to }); I.data.gain = (I.data.gain ?? 0) + to - hf.health;
      if (to > 0 && hf.health <= 0 && M.hasStatus(v.state, who, "broken")) { R.effects.push({ t: "status-", who, id: "broken" }); status(who, "broken", false); } } break;
    case "cleanse": if (success && M.hasStatus(v.state, subject, "sick")) { R.effects.push({ t: "status-", who: subject, id: "sick" }); status(subject, "sick", false); } break;      // [B1935]
    case "leech": if (success && sf && a) {                                                    // [B1937]: what the healer gains the target loses; Armor does not help
      const n = Math.max(0, Math.min((fx.per ?? 3) * sixes, a.maxHealth - a.health, sf.health));
      if (n > 0) { R.effects.push({ t: "actor", who: I.actor, path: "health", to: a.health + n }); R.effects.push({ t: "actor", who: subject, path: "health", to: sf.health - n }); R.events.push({ type: "damage", target: subject, base: n, armor: 0, taken: n, dtype: "leech", source: "power" });
        if (sf.health - n <= 0 && !M.hasStatus(v.state, subject, "broken")) { R.effects.push({ t: "status+", who: subject, status: { id: "broken", source: src } }); status(subject, "broken", true); } }
      I.data.gain = n;
    } break;
    case "convert": if (a) {                                                                   // Resilience [B2160]: damage just taken becomes stress, point for point
      const n = Math.max(0, Math.min(Math.trunc(Number(opt) || 1), a.maxHealth - a.health, a.resolve));
      if (n > 0) { R.effects.push({ t: "stress", who: I.actor, n, cost: 1 }); R.effects.push({ t: "actor", who: I.actor, path: "health", to: a.health + n });
        if (a.health <= 0 && M.hasStatus(v.state, I.actor, "broken")) { R.effects.push({ t: "status-", who: I.actor, id: "broken" }); status(I.actor, "broken", false); } }
      I.data.gain = n;
    } break;
    case "mark": R.effects.push({ t: "state", ...M.counterBump(v.state, markKey(I.actor, fx)) }); break;      // a thing that is on for the turn or the scene (a wind-up, an activation)
    case "resist": {                                                                           // the one it is about rolls (no action, never pushed); each six takes 1 stress off
      const key = `res:${subject}`;
      if (!K.rollOf(I, key)) { const bp = K.buildPool(v, I, key, subject, fx.attr, [], { rollKind: "other" }); R.effects.push(K.rollEffect(key, subject, fx.attr, bp.pool, { passive: true, label: e?.label })); return "wait"; }
      if (!K.rollFinal(I, key)) return "wait";
      const six = K.sixesOf(I, key), n = Math.max(0, (fx.stress ?? 0) - six);
      I.data.result = six > 0 ? "success" : "fail"; I.data.net = six; I.data.stress = n;
      if (K.flag(I, "resisted")) break;
      K.setFlag(I, "resisted");
      if (n > 0) { R.effects.push({ t: "stress", who: subject, n }); R.events.push({ type: "stress", target: subject, n, source: "power" }); }
      if (six < 1 && fx.loseTurn) { R.effects.push({ t: "state", path: ["ledger", subject], to: Lg.loseNextTurn(P1L(v, subject), src) }); R.effects.push({ t: "status+", who: subject, status: { id: "stunned", source: src } }); status(subject, "stunned", true); }
      if (six < 1 && fx.forfeit) for (const cost of ["full", "quick"]) R.effects.push({ t: "pay", who: subject, cost, force: 1, key: `ff:${cost}`, action: I.action });      // this very turn is lost
      break;
    }
    case "gainResolve": if (success && sf) { const raw = sf.resolve + (fx.per ?? 1) * sixes, to = fx.over ? raw : Math.min(sf.maxResolve, raw); if (to > sf.resolve) R.effects.push({ t: "actor", who: subject, path: "resolve", to }); I.data.gain = Math.max(0, to - sf.resolve); } break;   // [B1686], [B2064]
    case "sap": if (success && sixes > 0) { R.effects.push({ t: "stress", who: subject, n: sixes * (fx.per ?? 1) }); R.events.push({ type: "stress", target: subject, n: sixes * (fx.per ?? 1), source: "power" }); I.data.stress = sixes; } break;   // [B2064]
    case "luck": token(R, { id: sid(`l${I.id}`), holder: subject, dice: (opt === "bad" ? -1 : 1) * (fx.lv ?? 1), scope: { next: 1 }, uses: 1, source: src, from: I.actor, forced: 1, expires: { at: "roundEnd" } }); break;       // [B1727-1730]
    case "aim": token(R, { id: sid(`m${I.id}`), holder: I.actor, dice: fx.dice ?? 2, scope: { rolls: fx.rolls, attrs: fx.attrs }, uses: 1, source: src, expires: fx.until === "roundEnd" ? { at: "roundEnd" } : { at: "turnEndOf", who: I.actor } }); break;   // [B2163], [B2116]
    case "inspire": if (sf) {                                                                // [B2119]: stress taken = Resolve given back
      const n = Math.max(0, Math.min(Number(opt) || 1, sf.maxResolve - sf.resolve, a?.resolve ?? 0));
      if (n > 0) { R.effects.push({ t: "stress", who: I.actor, n, cost: 1 }); R.effects.push({ t: "actor", who: subject, path: "resolve", to: sf.resolve + n }); }
      I.data.gain = n;
    } break;
    case "resolveAll": if (success) for (const id of teamOf(v, I.actor)) { const c = v.facts.c(id); if (c.resolve < c.maxResolve) R.effects.push({ t: "actor", who: id, path: "resolve", to: Math.min(c.maxResolve, c.resolve + sixes) }); } break;   // [B2147]
    case "support": token(R, { id: sid(`s${I.id}`), holder: subject, dice: (fx.per ?? 2) * Math.max(1, Number(opt) || 1), scope: { next: 1 }, uses: 1, source: src, from: I.actor, expires: { at: "sceneEnd" } }); break;   // [B2168]
    case "grant": {                                                                          // [B1953], [B2105], [B1909]: an extra unit of the ledger
      const g = Lg.grantTemplate(fx.template, { unit: fx.unit, expires: fx.expires }), r = g ? Lg.addGrant(P1L(v, I.actor), { ...g, source: src }, I.actor) : null;
      if (r?.ok) R.effects.push({ t: "state", path: ["ledger", I.actor], to: r.ledger }); else I.data.result = "fail";
      break;
    }
    case "copies": {                                                                         // [B1907-1913]: the copy bonus of the level; never more than it
      const old = (v.state.effects ?? []).find((x) => x.kind === "copies" && x.holder === I.actor);
      const ef = M.makeEffect({ id: old?.id ?? sid(`c${I.id}`), kind: "copies", holder: I.actor, source: src, data: { n: fx.lv ?? 3, max: fx.lv ?? 3 }, ends: { at: "sceneEnd" } });
      if (ef) R.effects.push({ t: "state", path: ["effects", `#${ef.id}`], to: ef });
      I.data.gain = fx.lv ?? 3; break;
    }
    case "reabsorb": {                                                                       // [B1910], [B1914]
      const old = (v.state.effects ?? []).find((x) => x.kind === "copies" && x.holder === I.actor), n = K.copiesOf(v.state, I.actor);
      if (fx.heal && a && n > 0) { const to = Math.min(a.maxHealth, a.health + n); if (to > a.health) R.effects.push({ t: "actor", who: I.actor, path: "health", to }); I.data.gain = to - a.health; }
      if (old) for (const w of M.effectEndWrites(v.state, old.id)) R.effects.push({ t: "state", path: w.path, to: w.to });
      break;
    }
    case "summon": {                                                                         // [B1808-1815]: three allies as one group of minions, two more per "more"; a power for them costs 1 stress
      const f = String(opt ?? "").split("+").filter(Boolean), n = (id) => f.filter((x) => x === id).length;
      if (n("powered") > 0) R.effects.push({ t: "stress", who: I.actor, n: n("powered"), cost: 1 });
      R.effects.push({ t: "summon", who: I.actor, members: 3 + 2 * n("more"), item: e.kit?.item ?? null, delayed: a?.pass?.summonDelay ? 1 : 0 });
      if (n("versatile") + n("powered") > 0) R.effects.push({ t: "message", gmOnly: 1, key: "ITAC.msg.summonFinish", params: { name: a?.name ?? "", versatile: n("versatile"), powered: n("powered"), text: String(I.decl.text ?? "").slice(0, 200) || "-" } });
      I.data.gain = 3 + 2 * n("more"); break;
    }
    case "dismiss": R.effects.push({ t: "summonLeave", combatants: K.summonsOf(v, I.actor) }); break;      // [B1812]
    case "regen": if (a && a.health < a.maxHealth) { R.effects.push({ t: "actor", who: I.actor, path: "health", to: a.health + 1 }); I.data.gain = 1; } break;      // [B1893]
    case "toggle": R.effects.push({ t: "fx", who: I.actor, item: fx.item, fx: fx.fx, on: !e.fxOn }); I.data.on = e.fxOn ? 0 : 1; break;      // a form, a size, a stance: the sheet's own active effect
    default: break;
  }
}
const P1L = (v, cid) => v.state.ledger?.[cid];
/* Z15 [B1937] Life Leech: an unwilling target has to be touched first, with a FIGHTING roll made in the same action as the PRESENCE roll.
   [FXT-4] Who is unwilling: a character of the other side (hero against NPC); the book gives the touch no defence, so the roll needs one six. */
export const touchNeeded = (v, inst) => { const e = v.entry(inst), t = subjectOf(inst); if (e?.effect?.kind !== "leech" || !t || t === inst.actor) return false; const a = v.facts.c(inst.actor), f = v.facts.c(t); return !!a && !!f && !!a.npc !== !!f.npc; };
export const KIT_KINDS = Object.freeze(["shake", "status", "plan", "barrier", "heal", "gainResolve", "sap", "luck", "aim", "inspire", "resolveAll", "support", "grant", "copies", "reabsorb", "regen", "toggle", "summon", "dismiss", "cleanse", "leech", "convert", "mark", "resist"]);
const sameZone = (v, a, b) => { const r = v.facts.range?.(a, b); return r === undefined ? undefined : !!r && r.total === 0; };   // undefined: no map, the GM judges

function legality(v, inst) {
  const a = v.facts.c(inst.actor), e = v.entry(inst), kind = kindOf(v, inst), d = inst.decl ?? {};
  if (!a || a.present === false) return bad("gone");
  const subject = subjectOf(inst), sf = v.facts.c(subject), other = subject !== inst.actor;
  if (other && (!sf || sf.present === false)) return bad("noTarget");
  if ((e?.target?.n?.[0] ?? 0) > 0 && !other) return bad("noTarget");
  if (a.health <= 0 && !(kind === "rally" && !other) && kind !== "convert") return bad("broken");                                  // [B2707]: a broken character may only try to rally [B2773]
  if (M.hasStatus(v.state, inst.actor, "grappling")) return bad("grappling", GM);                              // [B2497]: the holder moves or makes a grapple attack, nothing else
  if (e?.tags?.includes("physical")) { const r = RESTRAINTS.find((s) => M.hasStatus(v.state, inst.actor, s)); if (r) return bad("restrained", { ...GM, status: r }); }
  if (e?.roll && !e.roll.optional && !attrOf(v, inst)) return bad("noAttribute");
  if (d.attr && e?.roll && !e.roll.attr && !attrChoices(e).includes(d.attr)) return bad("noAttribute");
  /* P6: what an entry of the kit asks for */
  if (stressOf(v, inst) > 0 && !damage.canTakeVoluntaryStress(a.resolve)) return bad("stressedOut");            // [B2816]
  if (e?.once && M.counterGet(v.state, onceKey(inst, e, v)) > 0) return bad("usedAlready", GM);
  if (Array.isArray(e?.pick) && e.pick.length && !e.pick.includes(d.opt)) return bad("noChoice");
  if (other && (e?.sameZone || (e?.touch && !a.pass?.healReach)) && sameZone(v, inst.actor, subject) === false) return bad("notSameZone", GM);
  if (other && e?.immuneHuge && sf?.huge) return bad("hugeTarget");
  if (e?.effect?.mass && Array.isArray(d.targets)) {                                                           // Mass Healing [B1934]: every chosen ally must pass, not only the first, and no more than the entry's upper bound
    const ts = [...new Set(d.targets)], mx = e.target?.n?.[1];
    if (Number.isFinite(mx) && ts.length > mx) return bad("noTarget");
    for (const t of ts.slice(1)) { const tf = v.facts.c(t); if (!tf || tf.present === false) return bad("noTarget"); if (e.sameZone && sameZone(v, inst.actor, t) === false) return bad("notSameZone", GM); }
  }
  if (kind === "reabsorb" && !(K.copiesOf(v.state, inst.actor) > 0)) return bad("noCopies");
  if (kind === "summon" && K.summonsOf(v, inst.actor).length) return bad("summonsOut", GM);                       // [B1812]: not while the earlier allies are still there
  if (kind === "summon" && String(d.opt ?? "").includes("powered") && !damage.canTakeVoluntaryStress(a.resolve)) return bad("stressedOut");
  if (kind === "dismiss" && !K.summonsOf(v, inst.actor).length) return bad("noSummons");
  if (other && e?.near && (v.facts.range?.(inst.actor, subject)?.total ?? 0) > 1) return bad("tooFar", GM);          // [B1637]: this zone or the next
  if (kind === "regen" && !(a.health < a.maxHealth)) return bad("healthFull");
  if (kind === "convert" && !(a.health < a.maxHealth)) return bad("healthFull");
  if (kind === "convert" && !(a.resolve > 0)) return bad("stressedOut");
  if (kind === "mark" && M.counterGet(v.state, markKey(inst.actor, e.effect)) > 0) return bad("usedAlready");
  if (kind === "inspire" && !(sf.resolve < sf.maxResolve)) return bad("resolveFull");
  if (kind === "inspire" && other && v.facts.canTalk?.(inst.actor, subject) === false) return bad("cannotHear", GM);
  switch (kind) {
    case "banter": {                                                                                         // [B2785], [R17]
      const r = maneuvers.banterCheck({ sameZone: sameZone(v, inst.actor, subject) !== false, target: K.immunityFlags(sf), targetBanteredThisRound: M.counterGet(v.state, M.counterKey.round(subject, "bantered")) > 0 });
      return r.ok ? fine : bad(r.reason === "zone" ? "notSameZone" : r.reason === "oncePerRound" ? "banteredAlready" : r.reason === "huge" ? "hugeTarget" : "immune", r.gmMayAllow ? GM : {});
    }
    case "rally": {                                                                                          // [B2773-2775]
      const r = crits.canRally({ broken: sf.health <= 0, crits: sf.crits ?? [], primaryCopy: sf.pass?.noRally === true });      // P6 [B1915] Sequestered Original: the primary copy was killed
      if (!r.ok) return bad(r.reason === "crit" ? "rallyCrit" : r.reason === "copy" ? "rallyCopy" : "notBroken", r.reason === "copy" ? GM : {});      // the GM may allow (broken by something that was not damage)
      return other && v.facts.canTalk?.(inst.actor, subject) === false ? bad("cannotHear", GM) : fine;       // [Z11]; undefined = the map cannot tell, the GM judges
    }
    case "resolve":                                                                                          // [B2818]
      if (!(sf.resolve < sf.maxResolve)) return bad("resolveFull");
      return other && v.facts.canTalk?.(inst.actor, subject) === false ? bad("cannotHear", GM) : fine;
    case "stabilize": {                                                                                      // [B2777]: advanced medical gear (the GM's word), one attempt
      const r = crits.canStabilize({ crits: sf.crits ?? [], attempted: M.counterGet(v.state, M.counterKey.scene(subject, "stabilize")) > 0, hasGear: (d.confirmed ?? []).includes("medicalGear") || a.pass?.medicalGear === true });      // P6: the gear on the sheet counts
      return r.ok ? fine : bad(r.reason === "gear" ? "needsGear" : r.reason === "alreadyTried" ? "stabilizeTried" : "notDying", r.reason === "notDying" ? {} : GM);
    }
    case "extinguish":                                                                                       // [B2926]: the burning character, or an ally in the same zone
      if (!M.hasStatus(v.state, subject, "burning")) return bad("notBurning");
      return other && sameZone(v, inst.actor, subject) === false ? bad("notSameZone") : fine;
    case "escape": return M.hasStatus(v.state, inst.actor, e.effect.from) ? fine : bad("notHeld");
    case "pickUp": { const it = d.item ? (v.state.items ?? []).find((x) => x.id === d.item) : null;
      if (d.item && (!it || it.state !== "ground")) return bad("noItem");
      const at = it?.zone ? v.facts.zone?.(inst.actor)?.spot ?? null : null;                   // S066 [B2316]: an item is picked up where it lies (no map, or an item with no place: the GM judges)
      return at && at !== it.zone ? bad("noItem", GM) : fine; }      // "nothing to pick up here"
    default: return fine;
  }
}

/* The pool of the action's own roll: ONE builder for the roll and for what the dock shows before the declaration (preview). */
function actPool(v, I, tokens) {
  const d = I.decl, e = v.entry(I), attr = I.data.attr, mods = [];
  if (e?.effect?.escape === "snare" && e.effect.from === "snared") mods.push({ source: "snare", dice: snarePenalty(statusOf(v, I.actor, "snared")) });      // [B1606-1609]
  else if (e?.effect?.kind === "escape") { const n = statusOf(v, I.actor, e.effect.from)?.data?.dice; if (Number.isFinite(n) && n < 0) mods.push({ source: "envPhase", dice: Math.trunc(n) }); }      // Z11 [B1944]: the penalty the status carries (Environment Phasing -2)
  const hd = K.helpDiceOf(v, d);
  if (hd) mods.push({ source: "help", dice: hd });                         // [B2238]
  return { attr, ...K.buildPool(v, I, "roll", I.actor, attr, mods, { rollKind: "other", tokens }) };
}
export const act = {
  preview(v, inst) { const I = K.draft(inst); I.data.attr = attrOf(v, I); return I.data.attr ? actPool(v, I, I.decl.tokens ?? []) : null; },
  STEPS: Object.freeze(["check", "roll", "effect", "outcome", "close"]),
  legality,
  /* [B2773] a broken character may try to get up on its own turn; Resilience turns the damage that broke it into stress [B2160] */
  whenBroken(v, inst) { const kind = kindOf(v, inst); return (kind === "rally" && subjectOf(inst) === inst.actor) || kind === "convert"; },
  revalidate(v, inst) { const a = v.facts.c(inst.actor); const b = !a || a.present === false ? "gone" : null; return { ok: !b, reasons: b ? [b] : [] }; },
  steps: {
    check(v, inst) { const I = K.draft(inst), R = K.result(I); I.data.attr = attrOf(v, I); R.goto = I.data.attr ? "roll" : "effect"; return R; },
    roll(v, inst) {
      const I = K.draft(inst), R = K.result(I), d = I.decl, e = v.entry(I), attr = I.data.attr, opp = opponentOf(v, I);
      const order = dice.OPPOSED_PUSH_ORDERS.includes(v.state.opts?.pushOrder) ? v.state.opts.pushOrder : "afterDefence";      // [R3]
      if (!K.rollOf(I, "roll")) {
        const tg = K.tokenGate(v, I, R, I.actor, { kind: "other", attr }, d.tokens ?? [], "roll");
        if (tg.wait) { R.wait = true; return R; }
        I.locked = true; R.events.push({ type: "actionLocked" });                               // spec 5.5: locks at the first die
        if (stressOf(v, I) > 0) { K.setFlag(I, "stress"); R.effects.push({ t: "stress", who: I.actor, n: stressOf(v, I), cost: 1 }); }
        const bp = actPool(v, I, tg.tokens);
        for (const wr of bp.writes) R.effects.push({ t: "state", path: wr.path, to: wr.to });
        R.effects.push(K.rollEffect("roll", I.actor, attr, bp.pool, { passive: d.noPush === true || d.noPush === 1, noPush: !K.mayPush(v, I.actor), label: e?.label }));
        R.wait = true; return R;
      }
      if (!K.rollRolled(I, "roll")) { R.wait = true; return R; }
      if (opp) {
        if (order === "beforeDefence" && !K.rollFinal(I, "roll")) { R.wait = true; return R; }
        const key = `def:${opp.who}`;
        if (!K.rollOf(I, key)) {
          const bp = K.buildPool(v, I, key, opp.who, opp.attr, [], { rollKind: "other" });
          R.effects.push(K.rollEffect(key, opp.who, opp.attr, bp.pool, { defender: true, label: e?.label }));      // [B2241]: the passive party never pushes
          R.wait = true; return R;
        }
        if (!K.rollFinal(I, key)) { R.wait = true; return R; }
      }
      if (!K.rollFinal(I, "roll")) { R.wait = true; return R; }
      if (touchNeeded(v, I)) {                                                                  // Z15 [B1937]: the FIGHTING roll that touches an unwilling target, in the same action
        if (!K.rollOf(I, "touch")) { const bp = K.buildPool(v, I, "touch", I.actor, "fighting", [], { rollKind: "other" }); for (const wr of bp.writes) R.effects.push({ t: "state", path: wr.path, to: wr.to }); R.effects.push(K.rollEffect("touch", I.actor, "fighting", bp.pool, { noPush: !K.mayPush(v, I.actor), label: "ITAC.roll.touch" })); R.wait = true; return R; }
        if (!K.rollFinal(I, "touch")) { R.wait = true; return R; }
      }
      const r = K.rollOf(I, "roll");
      R.events.push({ type: "roll", key: "roll", who: I.actor, attr, dice: r.pool?.total, sixes: K.sixesOf(I, "roll"), ones: r.ones ?? 0, pushed: r.pushed ?? 0, messageId: r.messageId });
      R.goto = "effect"; return R;
    },
    effect(v, inst) {
      const I = K.draft(inst), R = K.result(I), e = v.entry(I), kind = kindOf(v, I), subject = subjectOf(I), sf = v.facts.c(subject);
      const rolled = !!I.data.attr, sixes = rolled ? K.sixesOf(I, "roll") : 0, opp = opponentOf(v, I), against = opp ? K.sixesOf(I, `def:${opp.who}`) : 0;
      const net = opp ? dice.opposed(sixes, against) : { win: sixes > 0, net: sixes };          // [B2243]: a tie fails for the active party
      const touched = !touchNeeded(v, I) || K.sixesOf(I, "touch") > 0;                         // Z15 [B1937]: no touch, nothing drained
      const success = (rolled ? net.win : true) && touched;
      I.data.result = success ? "success" : "fail"; I.data.net = rolled ? (opp ? net.net : sixes) : null;
      if (!touched) I.data.untouched = 1;
      const status = (who, id, on) => R.events.push({ type: "status", target: who, status: { id, on } });
      if (!rolled && !K.flag(I, "stress")) {                                                   // P6: an action without a roll locks here, with the stress it costs
        K.setFlag(I, "stress"); if (!I.locked) { I.locked = true; R.events.push({ type: "actionLocked" }); }
        if (stressOf(v, I) > 0) R.effects.push({ t: "stress", who: I.actor, n: stressOf(v, I), cost: 1 });
      }
      if (e?.once && !K.flag(I, "once")) { K.setFlag(I, "once"); R.effects.push({ t: "state", ...M.counterBump(v.state, onceKey(I, e, v)) }); }
      if (KIT_KINDS.includes(kind) && kitEffect(v, I, R, e, { kind, subject, sf, success, sixes }) === "wait") { R.wait = true; return R; }
      switch (kind) {
        case "banter": {                                                                         // [B2785]: 1 stress per six more than the target rolled; once per round per target
          R.effects.push({ t: "state", ...M.counterBump(v.state, M.counterKey.round(subject, "bantered")) });
          const n = maneuvers.banterStress(sixes, against);
          if (n > 0) { R.effects.push({ t: "stress", who: subject, n }); R.events.push({ type: "stress", target: subject, n, source: "banter" }); }
          I.data.stress = n; break;
        }
        case "rally": if (success && sf) {                                                       // [B2775]: 1 Health per six, the injury stays
          const ro = crits.rallyOutcome({ sixes, maxHealth: sf.maxHealth });
          if (ro.rallied) { R.effects.push({ t: "actor", who: subject, path: "health", to: ro.health }); if (M.hasStatus(v.state, subject, "broken")) { R.effects.push({ t: "status-", who: subject, id: "broken" }); status(subject, "broken", false); } I.data.gain = ro.health; }
        } break;
        case "resolve": if (success && sf) {                                                     // [B2818]
          const rr = damage.recoverResolve({ resolve: sf.resolve, max: sf.maxResolve, sixes });
          if (rr.gain > 0) R.effects.push({ t: "actor", who: subject, path: "resolve", to: rr.resolve });
          I.data.gain = rr.gain;
        } break;
        case "stabilize":                                                                        // [B2777]: one attempt, whatever it gives
          R.effects.push({ t: "state", ...M.counterBump(v.state, M.counterKey.scene(subject, "stabilize")) });
          if (crits.stabilizeOutcome(sixes).stabilized && M.hasStatus(v.state, subject, "dying")) { R.effects.push({ t: "status-", who: subject, id: "dying" }); status(subject, "dying", false); }
          break;
        case "extinguish": if (!hazards.extinguishOutcome(sixes).burning) { R.effects.push({ t: "status-", who: subject, id: "burning" }); status(subject, "burning", false); } break;   // [B2926]
        case "escape": if (maneuvers.escapeOutcome({ kind: e.effect.escape, sixes, holderSixes: against }).free) {       // [B2496], [B2438], [B1606]
          const by = statusOf(v, I.actor, e.effect.from)?.data?.by;
          R.effects.push({ t: "status-", who: I.actor, id: e.effect.from }); status(I.actor, e.effect.from, false);
          if (e.effect.from === "grappled" && by && statusOf(v, by, "grappling") && (statusOf(v, by, "grappling").data?.held ?? I.actor) === I.actor) { R.effects.push({ t: "status-", who: by, id: "grappling" }); status(by, "grappling", false); }
          I.data.result = "success";
        } else I.data.result = "fail"; break;
        case "pickUp": { const it = I.decl.item ? (v.state.items ?? []).find((x) => x.id === I.decl.item) : null;        // [B2316]
          if (it) R.effects.push({ t: "state", path: ["items", `#${it.id}`], to: { ...it, state: "held", holder: I.actor } }); break; }
        default: break;
      }
      R.goto = "outcome"; return R;
    },
    /* spec 9.7: a narrative action ends with the GM's word on a desk card (what was found, what gave way, who listens); saving bystanders
       also leaves a karma note [B2374], spec 9.11. Surplus sixes are shown: stunts of such rolls are the GM's last word [B2210-2218]. */
    outcome(v, inst) {
      const I = K.draft(inst), R = K.result(I), kind = kindOf(v, I);
      if (!["narrative", "bystanders"].includes(kind)) { R.goto = "close"; return R; }
      if (!I.data.pk?.outcome) {
        R.prompts.push({ key: "outcome", kind: "outcome", to: "gm", about: I.actor, free: 1, options: [{ id: "success", label: "ITAC.opt.success" }, { id: "fail", label: "ITAC.opt.fail" }],
          data: { action: I.action, rolled: I.data.attr ? 1 : 0, sixes: I.data.attr ? K.sixesOf(I, "roll") : null, net: I.data.net, suggests: I.data.result, text: I.decl.text ?? "", attr: I.data.attr ?? null, ...(v.entry(I)?.name ? { name: v.entry(I).name } : {}), ...(I.decl.opt ? { opt: I.decl.opt } : {}) } });
        R.wait = true; return R;
      }
      if (!K.isAnswered(v, I, "outcome")) { R.wait = true; return R; }
      const a = K.answerOf(v, I, "outcome"), id = K.answerId(v, I, "outcome") ?? I.data.result;
      I.data.result = id === "fail" ? "fail" : "success";
      if (a && typeof a === "object" && a.text) I.data.said = String(a.text).slice(0, 300);
      if (v.entry(I)?.effect?.then === "control" && I.data.result === "success" && !K.flag(I, "control")) { K.setFlag(I, "control"); R.effects.push({ t: "summonFlag", who: subjectOf(I), owner: I.actor }); }      // [B1637]: the animal acts on its controller's turn from now on
      if (kind === "bystanders" && !K.flag(I, "karma")) { K.setFlag(I, "karma"); R.effects.push({ t: "karma", note: { who: I.actor, kind: I.data.result === "success" ? "savedBystanders" : "failedBystanders", zone: v.facts.zone?.(I.actor)?.spot ?? undefined, note: I.data.said } }); }
      R.events.push({ type: "outcome", result: I.data.result, text: I.data.said ?? "" });
      R.goto = "close"; return R;
    },
    close(v, inst) { const I = K.draft(inst), R = K.result(I); R.effects.push({ t: "fact", who: I.actor, facts: { acted: 1, tags: v.entry(I)?.tags ?? [] } }); R.done = true; return R; },
  },
};
export { ATTRS };
