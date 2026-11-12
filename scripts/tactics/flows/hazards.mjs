/* Tactical combat, package P5: the HAZARDS beyond the fire attack and the fixed damage of flows/simple.mjs (spec 9.8), and the triggers
   the state of the map and of the characters makes due by itself (spec 6.1). NO Foundry globals. A hazard is an initiator without a
   character: nobody pushes, nobody picks stunts [plan 5.2]. The numbers are the rules library's (rules/hazards.mjs).
     blast       a placed explosive [B2905-2923] or any attack a hazard makes on everybody in a zone with a fixed pool and Damage
                 (the Magical Ward of [B2876]: `{ pool, damage }`). Steps: check -> dodge -> roll -> damage -> effects -> close
     fireSpread  the D6 of a burning zone at the start of a round [B2927]: out, stays, or spreads (the GM confirms where, [OQ-15])
     vacuum      the STRENGTH roll of a character without protection, on its turn [B2929]; the turn after a failure the GM says whether
                 the character was brought to pressure in time
     disease     exposure and the later rolls of a disease or a poison [B2899-2902]
   `specOf(run, subject, v)` turns a trigger's `run` (or the GM's order, op `hazardRun`) into the instance to push; `derived(state, facts,
   point)` lists what is due at a scheduler point without anybody having registered it: the fire attacks and spread rolls of burning zones,
   the fire attack of a burning character elsewhere, the vacuum roll. They join the GM's trigger queue of that point (ops-pure.mjs). */
import { hazards, damage, dice, zones as RZ } from "../../rules/index.mjs";
import * as P1 from "../economy-pure.mjs";
import * as M from "../mods-pure.mjs";
import * as ZP from "../zones-pure.mjs";
import * as K from "./kit.mjs";
import * as Veh from "./vehicle.mjs";                                                          // P7: a blast that hits a vehicle

const bad = (reason, params = {}) => ({ ok: false, reason, params });
const fine = { ok: true, reason: null, params: {}, gates: [], notes: [] };
const blank = { helpers: [], exploits: [], stressTotal: 0 };
const int = (x, lo, hi, d = lo) => (Number.isFinite(Number(x)) ? Math.max(lo, Math.min(hi, Math.trunc(Number(x)))) : d);
const alive = (v, t) => { const c = v.facts.c(t); return !!c && c.present !== false; };
const sixesIn = (faces) => (Array.isArray(faces) ? faces.filter((d) => d === 6).length : 0);
export const TYPES = Object.freeze(["blast", "area", "fireSpread", "vacuum", "disease"]);
/** [OQ-16] the book gives no Intensity for a character who burns outside a burning zone: the fire that lit it, else the low end of "typical" [B2925] */
export const BURNING_DEFAULT = 6;
const hzOf = (inst) => inst.data.hz ?? {};
const lockTargets = (v, inst) => { const I = K.draft(inst), R = K.result(I); I.locked = true; I.decl.targets = (I.decl.targets ?? []).filter((t) => alive(v, t)); return [I, R]; };
const common = { revalidate() { return { ok: true, reasons: [] }; } };
const targetsNeeded = (inst) => (Array.isArray(inst.decl?.targets) && inst.decl.targets.length ? fine : bad("noTarget"));
const immuneTo = (tf, source) => (tf?.immunities ?? []).includes(source) || (source !== "kinetic" && (tf?.immunities ?? []).includes("nonKinetic"));     // [B1877-1880]

/* ------------------------------------------------------------------ blast / area attack of a hazard */
export const blast = {
  ...common,
  STEPS: Object.freeze(["check", "dodge", "roll", "damage", "effects", "close"]),
  legality(v, inst) { const h = hzOf(inst); return !["blast", "area"].includes(h.kind) || !(h.kind === "blast" ? h.rating > 0 : h.pool > 0) ? bad("unknownHazard") : targetsNeeded(inst); },
  /* a dodge that was offered is asked again when it is taken [B2525] */
  validate(v, inst, prompt, value, staff = false) {
    if (prompt.kind !== "hazardDodge" || staff || (typeof value === "string" ? value : value?.id) !== "dodge") return { ok: true };
    const d = dodgeOf(v, prompt.about);
    return d.ok ? { ok: true } : { ok: false, reason: d.reason };
  },
  steps: {
    check(v, inst) { const [I, R] = lockTargets(v, inst); R.goto = "dodge"; return R; },
    /* [B2922]: a blast can be dodged normally: AGILITY, a quick action as an interrupt [B2524-2525], by whoever could dodge a shot: not when
       held, snared, stunned, unaware, carried aloft, holding somebody or out of action (flows/kit.defenceOf: one reading with the attack flow).
       An NPC answers by its standing policy (spec 13.3). */
    dodge(v, inst) {
      const I = K.draft(inst), R = K.result(I);
      I.data.def ??= {};
      let waiting = false;
      for (const t of I.decl.targets) {
        const key = `dodge:${t}`, tf = v.facts.c(t);
        if (I.data.def[t] !== undefined) continue;
        if (!I.data.pk?.[key]) {
          if (!dodgeOf(v, t).ok) { I.data.def[t] = null; continue; }                              // cannot dodge, or nothing to pay with: not asked (plan 5.2 step 4)
          const pol = v.state.npc?.[t]?.dodge, p = { key, kind: "hazardDodge", to: K.addressee(v, t), about: t, options: [{ id: "dodge", label: "ITAC.action.dodge", cost: "quick" }, { id: K.PASS, label: "ITAC.opt.pass" }], data: { hazard: hzOf(I).kind, dice: poolOf(hzOf(I)) } };
          if (tf.npc && pol === "always") p.auto = { option: "dodge", reason: "npcDefault" }; else if (tf.npc && (pol === "never" || K.quickGroup(v, t))) p.auto = { option: K.PASS, reason: K.quickGroup(v, t) ? "quick" : "npcDefault" };      // U61
          R.prompts.push(p); waiting = true; continue;
        }
        if (!K.isAnswered(v, I, key)) { waiting = true; continue; }
        const id = K.answerId(v, I, key) === "dodge" && (K.answeredByStaff(v, I, key) || dodgeOf(v, t).ok) ? "dodge" : null;      // the action may be gone since the card opened [B2525]
        I.data.def[t] = id === "dodge" ? "dodge" : null;
        if (id === "dodge") R.effects.push({ t: "pay", who: t, cost: "quick", action: "dodge", interrupt: 1, defense: 1, key: `def:${t}` });
      }
      if (waiting) { R.wait = true; return R; }
      R.goto = "roll"; return R;
    },
    roll(v, inst) {
      const I = K.draft(inst), R = K.result(I), h = hzOf(I);
      if (I.data.res?.blast == null) { if (!K.flag(I, "blast")) { K.setFlag(I, "blast"); R.effects.push({ t: "dice", key: "blast", n: poolOf(h) }); } R.wait = true; return R; }      // [B2921]; never pushed [B2922]
      let waiting = false;
      for (const t of I.decl.targets) {
        if (I.data.def?.[t] !== "dodge") continue;
        const key = `def:${t}`;
        if (!K.rollOf(I, key)) { const bp = K.buildPool(v, I, key, t, "agility", [], { rollKind: "dodge" }); for (const wr of bp.writes) R.effects.push({ t: "state", path: wr.path, to: wr.to }); R.effects.push(K.rollEffect(key, t, "agility", bp.pool, { defender: true, label: "ITAC.action.dodge" })); waiting = true; }
        else if (!K.rollFinal(I, key)) waiting = true;
      }
      if (waiting) { R.wait = true; return R; }
      R.goto = "damage"; return R;
    },
    damage(v, inst) {
      const I = K.draft(inst), R = K.result(I), h = hzOf(I), faces = I.data.res.blast, sixes = Number.isFinite(I.data.forced?.sixes) ? I.data.forced.sixes : sixesIn(faces);
      const src = typeof h.source === "string" ? h.source : "kinetic", tags = M.damageTags({ source: src, cause: "hazard" });
      /* S067: a Barrier is an Armor of the character like any other [B1859], [B2682], [R13]: the best one counts, and one that damage gets
         through is gone (as after a hit of the attack flow). The GM's own Armor number leaves the Barrier out of it. */
      const rows = I.decl.targets.map((t) => { const tf = v.facts.c(t), forcedArmor = I.data.forced?.damage?.[t]?.armor, ar = forcedArmor == null ? damage.selectArmor([...(tf.armor ?? []), ...K.barriersOf(v.state, t)], { source: src }) : null; return { id: t, dodgeSixes: I.data.def?.[t] === "dodge" ? K.sixesOf(I, `def:${t}`) : 0, armor: forcedArmor ?? ar.armor, barrier: ar?.source?.barrier ? ar.source : null,
        vulnerable: (tf.vulnerabilities ?? []).includes(src), immune: immuneTo(tf, src) }; });                 // [B2193], [B1877-1880]: one reading with damage.hitDamage
      let out;
      if (h.kind === "blast") out = hazards.blastOutcome({ rating: h.rating, sixes, targets: rows }, dice.seededRng(faces.reduce((a, f) => a * 7 + f, 1 + v.state.round)));       // [B2921-2923]: the dice themselves decide who gets the extra sixes
      else out = { exploded: sixes > 0, base: h.damage, targets: rows.map((r) => { const hit = dice.opposed(sixes, r.dodgeSixes).win; const hd = damage.hitDamage({ base: hit ? h.damage : 0, armor: r.armor, source: src, immunities: r.immune ? [src] : [], vulnerabilities: r.vulnerable ? [src] : [] }); return { id: r.id, hit, doubled: false, raw: hd.raw, taken: hd.taken }; }) };   // [B2876]: a fixed Damage, the surplus is the GM's
      I.data.sixes = sixes; I.data.exploded = out.exploded; I.data.dmg = I.data.dmg ?? {}; I.data.out = I.data.out ?? {};
      let waiting = false;
      for (const o of out.targets) {
        if (I.data.dmg[o.id]) continue;                                                           // the step comes back after a card of the GM
        const tf = v.facts.c(o.id), forced = I.data.forced?.damage?.[o.id], row = rows.find((r) => r.id === o.id);
        let taken = Number.isFinite(forced?.amount) ? forced.amount : o.taken;
        if (damage.barrierBreached(row.barrier, taken) && !row.vulnerable && !K.flag(I, `breach:${o.id}`)) { K.setFlag(I, `breach:${o.id}`); for (const x of M.effectEndWrites(v.state, row.barrier.id)) R.effects.push({ t: "state", path: x.path, to: x.to }); }      // S067 [B1859], [R13]: a breached Barrier is gone
        if (tf.kind === "minions" && !Number.isFinite(forced?.amount) && taken > 0) {             // [OQ-1]: a blast takes several at once, as an area attack does: the GM's number
          const ml = K.minionLoss(v, I, R, o.id, taken);
          if (ml.wait) { waiting = true; continue; }
          taken = ml.taken;
        }
        const ab = K.copiesAbsorb(v, R, o.id, taken);                                             // [B1910]: any damage goes to the copy bonus first
        taken = ab.taken;
        const ad = damage.applyDamage({ health: tf.health, taken });                              // [B2707]
        I.data.out[o.id] = { hit: o.hit, net: sixes - row.dodgeSixes };
        I.data.dmg[o.id] = { base: out.base, raw: o.raw, armor: row.vulnerable ? 0 : row.armor, ...(row.vulnerable ? { vulnerable: true } : {}), taken, ...(ab.copies ? { copies: ab.copies } : {}), doubled: o.doubled, healthBefore: tf.health, healthAfter: ad.health, tags, ...(tf.kind === "minions" ? { minions: { removed: tf.health - ad.health, left: ad.health } } : {}) };   // [B2828]
        if (taken > 0 && ad.health !== tf.health) R.effects.push({ t: "actor", who: o.id, path: "health", to: ad.health });
        R.events.push({ type: "damage", target: o.id, base: out.base, armor: row.armor, taken, dtype: src, source: "hazard", ...(o.doubled ? { doubled: true } : {}) });
      }
      if (waiting) { R.wait = true; return R; }
      R.goto = "effects"; return R;
    },
    effects(v, inst) {
      const I = K.draft(inst), R = K.result(I), h = hzOf(I);
      for (const t of I.decl.targets) {                                                         // the same aftermath as a hit of the attack flow
        const dm = I.data.dmg[t];
        if (dm && Veh.afterHit(v, I, R, t, dm)) return R;                                         // [B3221-3248]: component damage, the wreck, the people aboard
        if (dm && K.minionsFate(v, I, R, t, dm, {})) return R;                                    // [B2828]
        if (dm && !Veh.isMachine(v, t) && K.brokenAndCrit(v, I, R, t, dm, {})) return R;
      }
      const surplus = h.kind === "area" && I.data.exploded ? I.data.sixes - 1 : 0;              // [B2876]: resolved as an area attack, the GM distributes the stunts
      if (surplus > 0) {
        if (!I.data.pk?.stunts) { R.prompts.push({ key: "stunts", kind: "hazardStunts", to: "gm", free: 1, options: [{ id: "done", label: "ITAC.opt.done" }], data: { surplus, targets: I.decl.targets.filter((t) => I.data.out[t]?.hit) } }); R.wait = true; return R; }
        if (!K.isAnswered(v, I, "stunts")) { R.wait = true; return R; }
      }
      R.goto = "close"; return R;
    },
    close(v, inst) { const I = K.draft(inst), R = K.result(I); I.data.result = I.data.exploded ? "hit" : "dud"; R.done = true; return R; },
  },
};
const dodgeOf = (v, t) => (Veh.isMachine(v, t) ? { ok: false, reason: "notAllowed" } : K.defenceOf(v, t, "shooting").paid.dodge);
const poolOf = (h) => (h.kind === "blast" ? hazards.blastPool(h.rating) : Math.max(1, int(h.pool, 1, 40, 1)));

/* ------------------------------------------------------------------ fire spread [B2927] */
const graphOf = (Z) => { try { const g = Z?.graph?.(); if (!g?.zones) return null; return RZ.makeGraph(g.zones.some((z) => z.id == null) ? RZ.graphFromZonesApi(g) : g); } catch { return null; } };
const fireOf = (Z, key) => (Z?.statesAll?.(key) ?? Z?.states?.(key) ?? []).filter((s) => s?.kind === "fire" && (s.level ?? 1) >= 1);
/** every burning zone of the map: [{ zone, at: level | null, intensity, refs: [{ source, id }] }] (a state without a level burns on all of them [A23]) */
export function burningZones(Z) {
  const out = [];
  let keys = [];
  try { keys = (Z?.graph?.()?.zones ?? []).map((z) => z.id ?? z.key).filter((k) => typeof k === "string"); } catch { keys = []; }
  for (const key of keys) {
    const by = new Map();
    for (const s of fireOf(Z, key)) { const at = s.at ?? null, k = at ?? ""; if (!by.has(k)) by.set(k, { zone: key, at, intensity: 0, refs: [] }); const r = by.get(k); r.intensity = Math.max(r.intensity, int(s.level, 1, 12, 1)); r.refs.push({ source: s.source ?? "registry", id: String(s.id ?? "") }); }
    out.push(...by.values());
  }
  return out;
}
const levelOf = (p) => (!p ? null : p.level === "floor" ? `f${p.floor}` : p.level ?? "ground");
/** the combatants of the fight standing in a burning zone record */
export const occupants = (state, Z, b) => Object.keys(state.ledger ?? {}).filter((cid) => { const p = Z.place?.(cid); return !!p && p.zone === b.zone && (!b.at || levelOf(p) === b.at); });
/** [B2927] where the fire of `zone` may go: neighbours behind a border that is not blocked, marked flammable, not burning yet ([A15]: a door that can be walked through lets fire pass) */
export function spreadCandidates(Z, zone) {
  const g = graphOf(Z);
  if (!g || !g.zones.has(zone)) return [];
  try { return hazards.fireSpreadTargets(g, zone, burningZones(Z).map((b) => b.zone), { doors: "pass", needFlammable: true }); } catch { return []; }
}
export const fireSpread = {
  ...common,
  STEPS: Object.freeze(["check", "roll", "effect", "close"]),
  legality(v, inst) { const h = hzOf(inst); return h.kind === "fireSpread" && ZP.isPlaceKey(h.zone) ? fine : bad("unknownHazard"); },
  steps: {
    check(v, inst) { const I = K.draft(inst), R = K.result(I); I.locked = true; R.goto = "roll"; return R; },
    roll(v, inst) {
      const I = K.draft(inst), R = K.result(I);
      if (hzOf(I).automatic) { I.data.spread = ["out", "stays", "spreads"].includes(I.data.forced?.spread) ? I.data.forced.spread : "spreads"; R.goto = "effect"; return R; }      // [B2845]: it spreads, no die
      if (I.data.res?.spread == null) { if (!K.flag(I, "spread")) { K.setFlag(I, "spread"); R.effects.push({ t: "dice", key: "spread", n: 1 }); } R.wait = true; return R; }
      I.data.spread = ["out", "stays", "spreads"].includes(I.data.forced?.spread) ? I.data.forced.spread : hazards.fireSpreadRoll(I.data.res.spread[0] ?? 3);
      R.goto = "effect"; return R;
    },
    effect(v, inst) {
      const I = K.draft(inst), R = K.result(I), h = hzOf(I), Z = v.facts.zones;
      const change = (zone, fire) => R.events.push({ type: "zoneChange", zone, patch: { fire }, cause: "fireSpread" });
      if (I.data.spread === "out" && !K.flag(I, "out")) {                                       // the fire goes out: every record that made it burn
        K.setFlag(I, "out");
        const refs = Array.isArray(h.refs) && h.refs.length ? h.refs : [{ source: "mark" }];
        if (refs.some((r) => r.source !== "registry")) R.effects.push({ t: "zones", op: ZP.zoneOp(h.zone, { fire: null }) });
        for (const r of refs) if (r.source === "registry" && r.id) R.effects.push({ t: "zones", op: { op: "zoneState.remove", id: r.id } });
        change(h.zone, null);
      }
      if (I.data.spread === "spreads") {
        /* a fire that spreads by itself goes on from wherever it burns by now, not only from where it started */
        const list = I.data.candidates ?? (I.data.candidates = h.automatic ? [...new Set([h.zone, ...burningZones(Z).map((b) => b.zone)].flatMap((z) => spreadCandidates(Z, z)))] : spreadCandidates(Z, h.zone));
        if (!list.length) { I.data.spread = "nowhere"; R.goto = "close"; return R; }
        if (I.data.res?.pick == null) { if (!K.flag(I, "pick")) { K.setFlag(I, "pick"); R.effects.push({ t: "dice", key: "pick", n: 1, sides: list.length }); } R.wait = true; return R; }      // a random adjacent zone
        const pick = list[Math.max(0, Math.min(list.length - 1, (I.data.res.pick[0] ?? 1) - 1))];
        if (!I.data.pk?.to) {                                                                   // [OQ-15]: what "not blocked" and "can burn" mean is the GM's to confirm
          R.prompts.push({ key: "to", kind: "fireSpread", to: "gm", options: [...list.map((z) => ({ id: `z:${z}`, label: z, data: { zone: z, ...(z === pick ? { rolled: 1 } : {}) } })), { id: "none", label: "ITAC.opt.noSpread" }], data: { from: h.zone, pick, intensity: h.intensity } });
          R.wait = true; return R;
        }
        if (!K.isAnswered(v, I, "to")) { R.wait = true; return R; }
        const id = K.answerId(v, I, "to"), to = typeof id === "string" && id.startsWith("z:") ? id.slice(2) : null;
        if (to && !K.flag(I, "lit")) { K.setFlag(I, "lit"); I.data.to = to; R.effects.push({ t: "zones", op: ZP.zoneOp(to, { fire: int(h.intensity, 1, 12, BURNING_DEFAULT) }) }); change(to, int(h.intensity, 1, 12, BURNING_DEFAULT)); }   // the same Intensity; its attacks start with the next round [A4]
        if (!to) I.data.spread = "held";
      }
      R.goto = "close"; return R;
    },
    close(v, inst) { const I = K.draft(inst), R = K.result(I); I.data.result = I.data.spread; R.done = true; return R; },
  },
};

/* ------------------------------------------------------------------ vacuum [B2929], [B2260] */
const exposure = (state, cid) => M.counterGet(state, M.counterKey.scene(cid, "vacuum"));
export const vacuum = {
  ...common,
  STEPS: Object.freeze(["check", "roll", "effect", "close"]),
  legality(v, inst) { return hzOf(inst).kind === "vacuum" ? targetsNeeded(inst) : bad("unknownHazard"); },
  steps: {
    check(v, inst) { const [I, R] = lockTargets(v, inst); R.goto = I.decl.targets.length ? "roll" : "close"; return R; },
    roll(v, inst) {
      const I = K.draft(inst), R = K.result(I), t = I.decl.targets[0];
      if (M.hasStatus(v.state, t, "suffocating")) { R.goto = "effect"; return R; }               // failed last turn: no more roll, the GM's word
      if (!K.rollOf(I, "roll")) {
        const n = exposure(v.state, t) + 1, pen = hazards.vacuumDice(n);                        // unmodified in the first round, one die less each further round
        I.data.exposure = n;
        const bp = K.buildPool(v, I, "roll", t, "strength", pen ? [{ source: "vacuum", dice: pen }] : [], { rollKind: "other" });
        for (const wr of bp.writes) R.effects.push({ t: "state", path: wr.path, to: wr.to });
        R.effects.push(K.rollEffect("roll", t, "strength", bp.pool, { passive: true, label: "ITAC.roll.vacuum" }));       // no action, so passive: not pushed [A-2], [B2227]
        R.wait = true; return R;
      }
      if (!K.rollFinal(I, "roll")) { R.wait = true; return R; }
      R.goto = "effect"; return R;
    },
    effect(v, inst) {
      const I = K.draft(inst), R = K.result(I), t = I.decl.targets[0], tf = v.facts.c(t);
      const st = (id, on) => { R.effects.push(on ? { t: "status+", who: t, status: { id, source: { kind: "hazard", name: "vacuum" } } } : { t: "status-", who: t, id }); R.events.push({ type: "status", target: t, status: { id, on } }); };
      if (M.hasStatus(v.state, t, "suffocating")) {                                              // dead on the turn after the failure unless brought to pressure before
        if (!I.data.pk?.fate) { R.prompts.push({ key: "fate", kind: "vacuumDeath", to: "gm", about: t, options: [{ id: "saved", label: "ITAC.opt.saved" }, { id: "dead", label: "ITAC.opt.dead" }] }); R.wait = true; return R; }
        if (!K.isAnswered(v, I, "fate")) { R.wait = true; return R; }
        if (!K.flag(I, "fate")) { K.setFlag(I, "fate"); const dead = K.answerId(v, I, "fate") === "dead"; st("suffocating", false); if (dead) st("dead", true); I.data.result = dead ? "dead" : "saved"; }
        R.goto = "close"; return R;
      }
      if (!K.flag(I, "done")) {
        K.setFlag(I, "done");
        R.effects.push({ t: "state", ...M.counterBump(v.state, M.counterKey.scene(t, "vacuum")) });
        const o = hazards.vacuumOutcome(K.sixesOf(I, "roll"));
        I.data.result = o.ok ? "held" : "broken";
        if (!o.ok) {                                                                             // straight to 0 Health: broken, no critical injury
          if (tf.health !== 0) R.effects.push({ t: "actor", who: t, path: "health", to: 0 });
          if (!M.hasStatus(v.state, t, "broken")) { st("broken", true); R.events.push({ type: "broken", target: t }); }
          st("suffocating", true);
        }
      }
      R.goto = "close"; return R;
    },
    close(v, inst) { const I = K.draft(inst), R = K.result(I); R.done = true; return R; },
  },
};
/** needs the vacuum roll now? in orbit or in a zone marked `vacuum`, without protection ([B2929]: a suit, a hull, Adaptation, Life Support: the facts say `vacuumSafe`) */
export function inVacuum(facts, cid) {
  const c = facts.c(cid), Z = facts.zones, p = Z?.place?.(cid);
  if (!c || !p || c.vacuumSafe) return false;
  if (p.area) return p.area === "orbit";                                                        // [B2260]
  return !!(Z.zone?.(p.zone)?.tags ?? []).includes("vacuum");
}

/* ------------------------------------------------------------------ disease and poison [B2899-2902] */
export const disease = {
  ...common,
  STEPS: Object.freeze(["check", "roll", "effect", "close"]),
  legality(v, inst) { return hzOf(inst).kind === "disease" ? targetsNeeded(inst) : bad("unknownHazard"); },
  steps: {
    check(v, inst) { const [I, R] = lockTargets(v, inst); R.goto = I.decl.targets.length ? "roll" : "close"; return R; },
    roll(v, inst) {
      const I = K.draft(inst), R = K.result(I), h = hzOf(I), t = I.decl.targets[0];
      if (!K.rollOf(I, "roll")) {
        const carer = P1.isId(h.carer) && alive(v, h.carer) && h.carer !== t ? h.carer : null, pen = hazards.diseaseDice(int(h.virulence, 0, 12, 0));
        const who = carer ?? t, attr = carer ? hazards.DISEASE.carerAttr : hazards.DISEASE.attr;       // a carer rolls REASON in the patient's place
        const bp = K.buildPool(v, I, "roll", who, attr, pen ? [{ source: "virulence", dice: pen }] : [], { rollKind: "other" });
        for (const wr of bp.writes) R.effects.push({ t: "state", path: wr.path, to: wr.to });
        R.effects.push(K.rollEffect("roll", who, attr, bp.pool, { passive: true, secret: h.secret === true, label: "ITAC.roll.disease" }));      // passive, never pushed; the GM may keep it secret [B2899]
        R.wait = true; return R;
      }
      if (!K.rollFinal(I, "roll")) { R.wait = true; return R; }
      R.goto = "effect"; return R;
    },
    effect(v, inst) {
      const I = K.draft(inst), R = K.result(I), t = I.decl.targets[0], tf = v.facts.c(t), h = hzOf(I);
      if (!K.flag(I, "done")) {
        K.setFlag(I, "done");
        const sick = M.hasStatus(v.state, t, "sick"), toxic = M.statusesOf(v.state, t).some((x) => x.id === "sick" && x.data?.toxic);
        const o0 = hazards.diseaseStep({ state: sick ? "sick" : "exposed", sixes: K.sixesOf(I, "roll"), broken: tf.health <= 0 });       // [B2901]
        const o = toxic && (o0.state === "dead" || (o0.damage > 0 && tf.health - o0.damage <= 0)) ? { ...o0, state: "cured" } : o0;       // P6 [B1621]: the poison of a strike ends when its victim is broken, it never kills
        const st = (id, on) => { R.effects.push(on ? { t: "status+", who: t, status: { id, source: { kind: "hazard", name: String(h.name ?? "disease").slice(0, 40) }, ...(id === "sick" ? { data: { virulence: int(h.virulence, 0, 12, 0) } } : {}) } } : { t: "status-", who: t, id }); R.events.push({ type: "status", target: t, status: { id, on } }); };
        if (o.damage > 0) {                                                                      // Armor does not help; being broken by it gives no critical injury
          const ad = damage.applyDamage({ health: tf.health, taken: o.damage });
          if (ad.health !== tf.health) R.effects.push({ t: "actor", who: t, path: "health", to: ad.health });
          R.events.push({ type: "damage", target: t, base: o.damage, armor: 0, taken: o.damage, dtype: "disease", source: "hazard" });
          if (ad.health <= 0 && tf.health > 0 && !M.hasStatus(v.state, t, "broken")) { st("broken", true); R.events.push({ type: "broken", target: t }); }
        }
        if (o.state === "sick" && !sick) st("sick", true);
        if ((o.state === "cured" || o.state === "dead") && sick) st("sick", false);
        if (o.state === "dead") st("dead", true);
        I.data.result = o.state;
      }
      R.goto = "close"; return R;
    },
    close(v, inst) { const I = K.draft(inst), R = K.result(I); R.done = true; return R; },
  },
};

/* ------------------------------------------------------------------ from a trigger's `run` (or the GM's order) to an instance */
/** -> { action, flow, decl, data, initiator } | null. `subject` = { zone?, combatant? }; targets default to the subject combatant, else to
    everybody in the subject zone (facts.inZoneKey). */
export function specOf(run, subject, v) {
  if (!run || !TYPES.includes(run.type)) return null;
  const sub = subject ?? {}, zone = typeof (run.zone ?? sub.zone) === "string" ? String(run.zone ?? sub.zone).slice(0, 40) : undefined;
  const targets = (Array.isArray(run.targets) ? run.targets : P1.isId(sub.combatant) ? [sub.combatant] : zone ? (v.facts.inZoneKey?.(zone) ?? []).filter((id) => { const f = v.facts.c(id); return !!f && f.kind !== "challenge" && f.present !== false && !(f.kind === "minions" && !(Number(f.health) > 0)); }) : []).filter((id, i, all) => P1.isId(id) && all.indexOf(id) === i).slice(0, 40);      // D92: each target once
  const mk = (flow, hz, tg = targets) => ({ action: run.type, flow, actor: null, decl: { ...blank, action: run.type, targets: tg, ...(zone ? { zone } : {}) }, data: { hz: { ...hz, ...(zone ? { zone } : {}), ...(typeof run.name === "string" ? { name: run.name.slice(0, 80) } : {}) } }, initiator: { type: "hazard", id: run.type } });
  switch (run.type) {
    case "blast": return mk("blast", { kind: "blast", rating: int(run.rating, 1, 20, 4), ...(typeof run.source === "string" ? { source: run.source.slice(0, 24) } : {}) });
    case "area": return mk("blast", { kind: "area", pool: int(run.pool, 1, 40, 8), damage: int(run.damage, 0, 40, 5), ...(typeof run.source === "string" ? { source: run.source.slice(0, 24) } : {}) });
    case "fireSpread": return mk("fireSpread", { kind: "fireSpread", intensity: int(run.intensity, 1, 12, BURNING_DEFAULT), ...(typeof run.at === "string" ? { at: run.at.slice(0, 24) } : {}), ...(run.automatic ? { automatic: 1 } : {}),
      refs: (Array.isArray(run.refs) ? run.refs : []).slice(0, 12).map((r) => ({ source: ["registry", "mark", "map"].includes(r?.source) ? r.source : "mark", id: String(r?.id ?? "").slice(0, 40) })) }, []);
    case "vacuum": return mk("vacuum", { kind: "vacuum" }, targets.slice(0, 1));
    case "disease": return mk("disease", { kind: "disease", virulence: int(run.virulence, 0, 12, 0), ...(P1.isId(run.carer) ? { carer: run.carer } : {}), ...(run.secret === true ? { secret: true } : {}) }, targets.slice(0, 1));
    default: return null;
  }
}

/* ------------------------------------------------------------------ what is due without having been registered (spec 6.1) */
const trig = (id, at, subject, run) => ({ id, at, subject, run, source: { kind: "hazard", name: run.type }, derived: 1 });
const slug = (s) => String(s).replace(/[^A-Za-z0-9_@-]/g, "");
/** point = { at, combatant? }. -> [Trigger] (each `derived`: it lives in the queue card only, nothing is stored) */
export function derived(state, facts, point) {
  const out = [], Z = facts.zones ?? null;
  /* D110 (spec, minions: a group with no members is out): a fire burns somebody who is there, never an emptied group */
  const there = (cid) => { const c = facts.c(cid); return !!c && c.present !== false && !(c.kind === "minions" && !(Number(c.health) > 0)); };
  try {
    if (point.at === "roundStart") {
      const burn = Z ? burningZones(Z) : [], hit = new Set();
      for (const b of burn) {                                                                    // [B2925]: everybody who starts the round in a burning zone
        const who = occupants(state, Z, b).filter((cid) => there(cid) && !hit.has(cid));
        who.forEach((cid) => hit.add(cid));
        if (who.length) out.push(trig(`dfa.${slug(b.zone)}.${slug(b.at ?? "")}`, "roundStart", { zone: b.zone }, { type: "fireAttack", intensity: b.intensity, targets: who, zone: b.zone }));
      }
      for (const cid of Object.keys(state.ledger ?? {})) {                                       // [B2926]: and everybody who is on fire, wherever they are (one attack per character and round)
        const s = M.statusesOf(state, cid).find((x) => x.id === "burning");
        if (s && !hit.has(cid) && there(cid)) out.push(trig(`dfb.${cid}`, "roundStart", { combatant: cid }, { type: "fireAttack", intensity: int(s.data?.intensity, 1, 12, BURNING_DEFAULT), inZone: false, targets: [cid] }));
      }
      /* [B2927] is the rule of a TYPICAL fire. While a challenge whose fire spreads by itself is on (Burning Building [B2845]: one adjacent
         zone a round, burning until the challenge is overcome) no zone rolls the D6 that could put it out or spread it a second time. */
      const own = Object.values(state.challenges ?? {}).some((c) => c && !c.done && (c.effects ?? []).some((e) => e.kind === "fireSpread" && e.automatic));
      if (!own) for (const b of burn) out.push(trig(`dfs.${slug(b.zone)}.${slug(b.at ?? "")}`, "roundStart", { zone: b.zone }, { type: "fireSpread", zone: b.zone, intensity: b.intensity, refs: b.refs, ...(b.at ? { at: b.at } : {}) }));     // [B2927]
    } else if (point.at === "turnStart" && point.combatant) {
      const cid = point.combatant;
      if (M.hasStatus(state, cid, "suffocating") || inVacuum(facts, cid)) out.push(trig(`dvac.${cid}`, "turnStart", { combatant: cid }, { type: "vacuum" }));       // [B2929]
      if (M.statusesOf(state, cid).some((x) => x.id === "sick" && x.data?.toxic) && facts.c(cid)?.health > 0) out.push(trig(`dtox.${cid}`, "turnStart", { combatant: cid }, { type: "disease", virulence: 0, name: "Toxic Strike" }));      // P6 [B1621]: STRENGTH each turn or 1 damage
    }
  } catch { /* a map that cannot be read makes nothing due: the GM runs the hazard by hand */ }
  /* what somebody registered by hand for the same thing is not doubled */
  return out.filter((t) => !(state.triggers ?? []).some((x) => x.at === t.at && x.run?.type === t.run.type && (x.subject?.zone ?? null) === (t.subject.zone ?? null) && (x.subject?.combatant ?? null) === (t.subject.combatant ?? null)));
}
