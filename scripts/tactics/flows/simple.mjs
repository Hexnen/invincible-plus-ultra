/* Tactical combat, package P2: the small flows. NO Foundry globals.
   roll       one attribute roll with an optional data-driven effect (spec 9.7 skeleton; the rows of the action table are P5). In P2: orders -> a modifier
              token [B2297], and the GM-requested roll of spec 9.12 [B2208] (any attribute, modifier, no-push, public or secret).
   other      "something else" and every manually resolved action (spec 9.12, 5.3): the GM closes it with the `manual` operation.
   hazard     an initiator without a character (spec 9.8): nobody pushes, nobody picks stunts. In P2: fire [B2925-2926] and a fixed damage amount
              (what a barrier impact or a fall hands over once P3 / P4 compute it).
   composite  an action made of several actions run in order inside ONE transaction (charge = move + attack, a Fastball Special with the thrown
              character's charge, a multi-roll power): each part is a child instance on the stack. */
import { maneuvers, hazards, damage } from "../../rules/index.mjs";
import * as M from "../mods-pure.mjs";
import * as C from "../catalog-pure.mjs";
import * as K from "./kit.mjs";
import * as Veh from "./vehicle.mjs";                                                          // P7: a hazard that hits a vehicle

const bad = (reason, params = {}) => ({ ok: false, reason, params });
const fine = { ok: true, reason: null, params: {}, gates: [], notes: [] };

/* ------------------------------------------------------------------ roll */
const attrOf = (v, inst) => v.entry(inst)?.roll?.attr ?? inst.decl.attr ?? null;
/* The pool of the roll: ONE builder for the roll and for what the dock shows before the declaration (preview). */
function rollPool(v, I, tokens) {
  const d = I.decl, attr = attrOf(v, I), mods = [];
  if (I.action === "gmRoll" && Number.isFinite(d.mod) && d.mod) mods.push({ source: "gm", dice: Math.trunc(d.mod) });
  const hd = K.helpDiceOf(v, d);
  if (hd) mods.push({ source: "help", dice: hd });                                         // [B2238], [B2167]: a Supportive helper gives two (S070)
  return { attr, ...K.buildPool(v, I, "roll", I.actor, attr, mods, { rollKind: "other", tokens }) };
}
export const roll = {
  preview(v, inst) { const I = K.draft(inst); return attrOf(v, I) ? rollPool(v, I, I.decl.tokens ?? []) : null; },
  STEPS: Object.freeze(["check", "roll", "effect", "close"]),
  legality(v, inst) {
    const a = v.facts.c(inst.actor), e = v.entry(inst);
    if (!a || a.present === false) return bad("gone");
    if (a.health <= 0) return bad("broken");                                                    // [B2707]
    if (!["fighting", "agility", "strength", "reason", "intuition", "presence"].includes(attrOf(v, inst))) return bad("noAttribute");
    if (e?.target?.n?.[0] > 0) {
      const t = inst.decl.targets?.[0], tf = t ? v.facts.c(t) : null;
      if (!tf || tf.present === false) return bad("noTarget");
      if (e.effect?.token === "orders" && v.facts.canTalk?.(inst.actor, t) === false) return bad("cannotHear");   // [B2297], [Z11]; undefined = the map cannot tell, the GM judges
    }
    return fine;
  },
  revalidate(v, inst) { const b = K.actorBlocked(v, inst); return { ok: !b, reasons: b ? [b] : [] }; },
  steps: {
    check(v, inst) { const I = K.draft(inst), R = K.result(I); R.goto = "roll"; return R; },
    roll(v, inst) {
      const I = K.draft(inst), R = K.result(I), d = I.decl, e = v.entry(I), attr = attrOf(v, I);
      if (!K.rollOf(I, "roll")) {
        const tg = K.tokenGate(v, I, R, I.actor, { kind: "other", attr }, d.tokens ?? [], "roll");
        if (tg.wait) { R.wait = true; return R; }
        I.locked = true; R.events.push({ type: "actionLocked" });                               // spec 5.5: locks at the first die
        if ((d.stressTotal ?? 0) > 0) R.effects.push({ t: "stress", who: I.actor, n: d.stressTotal, cost: 1 });
        const bp = rollPool(v, I, tg.tokens);
        for (const wr of bp.writes) R.effects.push({ t: "state", path: wr.path, to: wr.to });
        R.effects.push(K.rollEffect("roll", I.actor, attr, bp.pool, { passive: e?.roll?.passive === true || (d.noPush === true || d.noPush === 1), secret: d.secret === true || d.secret === 1, label: e?.label, noPush: !K.mayPush(v, I.actor) }));      // S068 [B2186], [B2231]   // [B2227]
        R.wait = true; return R;
      }
      if (!K.rollFinal(I, "roll")) { R.wait = true; return R; }
      const r = K.rollOf(I, "roll");
      R.events.push({ type: "roll", key: "roll", who: I.actor, attr, dice: r.pool?.total, sixes: K.sixesOf(I, "roll"), ones: r.ones ?? 0, pushed: r.pushed ?? 0, messageId: r.messageId, secret: r.secret });
      R.goto = "effect"; return R;
    },
    effect(v, inst) {
      const I = K.draft(inst), R = K.result(I), e = v.entry(I), sixes = K.sixesOf(I, "roll");
      I.data.result = sixes > 0 ? "success" : "fail";
      if (e?.effect?.token === "orders" && sixes > 0) {                                         // [B2297]: +1 die per six on ONE roll of the target later in the same round, only for the order
        const t = I.decl.targets[0];
        const tok = M.makeToken({ id: `tk${I.id}`, holder: t, dice: maneuvers.ordersBonus(sixes), scope: { purpose: String(I.decl.text ?? "orders") }, uses: 1, stacks: false,
          source: { kind: "gm", owner: I.actor, name: "orders" }, from: I.actor, expires: { at: "roundEnd" }, needsGm: 1 });
        if (tok) R.effects.push({ t: "state", path: ["tokens", `#${tok.id}`], to: tok });
      }
      R.goto = "close"; return R;
    },
    close(v, inst) { const I = K.draft(inst), R = K.result(I); R.effects.push({ t: "fact", who: I.actor, facts: { acted: 1, tags: v.entry(I)?.tags ?? [] } }); R.done = true; return R; },
  },
};

/* ------------------------------------------------------------------ other / manual */
export const other = {
  STEPS: Object.freeze(["manual", "close"]),
  legality(v, inst) { return inst.actor && !v.facts.c(inst.actor) ? bad("gone") : fine; },
  revalidate() { return { ok: true, reasons: [] }; },
  steps: {
    manual(v, inst) { const I = K.draft(inst), R = K.result(I); I.status = "manual"; R.wait = true; return R; },       // the GM's form closes it (spec 5.3)
    close(v, inst) { const I = K.draft(inst), R = K.result(I); R.done = true; return R; },
  },
};

/* ------------------------------------------------------------------ hazard */
export const hazard = {
  STEPS: Object.freeze(["check", "roll", "damage", "effects", "close"]),
  legality(v, inst) {
    const h = inst.data.hazard;
    if (!h || !["fire", "fixed"].includes(h.kind)) return bad("unknownHazard");
    if (!Array.isArray(inst.decl.targets) || !inst.decl.targets.length) return bad("noTarget");
    return fine;
  },
  revalidate() { return { ok: true, reasons: [] }; },
  steps: {
    check(v, inst) { const I = K.draft(inst), R = K.result(I); I.locked = true; I.decl.targets = I.decl.targets.filter((t) => v.facts.c(t)?.present !== false && v.facts.c(t)); R.goto = "roll"; return R; },
    /* fire: Intensity dice per character, rolled by the executor; hazards never push (plan 5.2). No dodge is offered against fire [OQ-5]. */
    roll(v, inst) {
      const I = K.draft(inst), R = K.result(I), h = I.data.hazard;
      if (h.kind !== "fire") { R.goto = "damage"; return R; }
      let waiting = false;
      for (const t of I.decl.targets) {
        const key = `fire:${t}`;
        if (I.data.res?.[key] != null) continue;
        if (!K.flag(I, key)) { K.setFlag(I, key); R.effects.push({ t: "dice", key, n: hazards.firePool(h.intensity) }); }        // [B2925]
        waiting = true;
      }
      if (waiting) { R.wait = true; return R; }
      R.goto = "damage"; return R;
    },
    damage(v, inst) {
      const I = K.draft(inst), R = K.result(I), h = I.data.hazard;
      I.data.dmg = I.data.dmg ?? {};
      for (const t of I.decl.targets) {
        if (I.data.dmg[t]) continue;
        const tf = v.facts.c(t), forced = I.data.forced?.damage?.[t];
        const tags = M.damageTags({ source: h.kind === "fire" ? "fire" : h.source, cause: h.cause ?? "hazard" });
        const phased = !tags.toStress && K.phased(v.state, t);                                                                                      // Z2 [B1941]: Prolonged Phasing, immune to physical damage
        const immune = phased || (tf.immunities ?? []).includes(tags.source) || (tags.source !== "kinetic" && (tf.immunities ?? []).includes("nonKinetic"));     // [B1877-1880]
        const vulnerable = !phased && (tf.vulnerabilities ?? []).includes(tags.source);                                                             // [B2193]: doubled, no Armor
        let rec;
        if (h.kind === "fire") {
          const sixes = I.data.res[`fire:${t}`].filter((d) => d === 6).length, ar = damage.selectArmor(tf.armor ?? [], { source: tags.source });         // [B2925]: Armor applies, the one that works against fire
          const fo = hazards.fireOutcome({ sixes, armor: forced?.armor ?? ar.armor, inBurningZone: h.inZone !== false, wasBurning: M.hasStatus(v.state, t, "burning"), immune, vulnerable });   // [B2925-2926], [B2193]
          rec = { base: hazards.fireDamage(sixes), raw: fo.raw, armor: vulnerable ? 0 : forced?.armor ?? ar.armor, ...(vulnerable ? { vulnerable: true } : {}), taken: Number.isFinite(forced?.amount) ? forced.amount : fo.taken, burning: fo.burning, sixes, tags };
        } else {
          const armor = h.armor === true ? (forced?.armor ?? damage.selectArmor(tf.armor ?? [], { source: tags.source }).armor) : 0;                 // [OQ-11]: the Armor line is the GM's tick
          const hd = damage.hitDamage({ base: h.amount ?? 0, armor, source: tags.source, immunities: immune ? [tags.source] : [], vulnerabilities: vulnerable ? [tags.source] : [] });
          rec = { base: h.amount ?? 0, raw: hd.raw, armor: hd.armor, taken: Number.isFinite(forced?.amount) ? forced.amount : hd.taken, tags };
        }
        const ab = K.copiesAbsorb(v, R, t, rec.taken);                                                                                               // [B1910]: fire, a fall, a barrier, a slam, a wreck: any damage goes to the copy bonus first
        if (ab.copies) { rec.taken = ab.taken; rec.copies = ab.copies; }
        const ad = damage.applyDamage({ health: tf.health, taken: rec.taken });                                                                     // [B2707]
        Object.assign(rec, { healthBefore: tf.health, healthAfter: ad.health });
        if (tf.kind === "minions") rec.minions = { removed: tf.health - ad.health, left: ad.health };                                                // [B2828]: one member per point
        if (rec.taken > 0 && ad.health !== tf.health) R.effects.push({ t: "actor", who: t, path: "health", to: ad.health });
        I.data.dmg[t] = rec;
        R.events.push({ type: "damage", target: t, base: rec.base, armor: rec.armor, taken: rec.taken, dtype: tags.source, source: tags.cause });
      }
      R.goto = "effects"; return R;
    },
    effects(v, inst) {
      const I = K.draft(inst), R = K.result(I), h = I.data.hazard;
      for (const t of I.decl.targets) {
        const dm = I.data.dmg[t];
        if (h.kind === "fire" && !K.flag(I, `burn:${t}`)) {                                     // [B2926]: damage sets the character on fire; an attack outside a burning zone without damage ends it
          K.setFlag(I, `burn:${t}`);
          const was = M.hasStatus(v.state, t, "burning");
          if (dm.burning && !was) { R.effects.push({ t: "status+", who: t, status: { id: "burning", source: { kind: "hazard", name: "fire" }, data: { intensity: h.intensity } } }); R.events.push({ type: "status", target: t, status: { id: "burning", on: true } }); }
          if (!dm.burning && was) { R.effects.push({ t: "status-", who: t, id: "burning" }); R.events.push({ type: "status", target: t, status: { id: "burning", on: false } }); }
        }
        if (dm && Veh.afterHit(v, I, R, t, dm)) return R;                                       // [B3221-3248]: a fall, a wall or a fire hurts a vehicle the way a hit does
        if (dm && K.minionsFate(v, I, R, t, dm, {})) return R;                                  // [B2828]
        if (!Veh.isMachine(v, t) && K.brokenAndCrit(v, I, R, t, dm, {})) return R;
      }
      R.goto = "close"; return R;
    },
    close(v, inst) { const I = K.draft(inst), R = K.result(I); I.data.result = "done"; R.done = true; return R; },
  },
};

/* ------------------------------------------------------------------ composite */
const partsOf = (v, inst) => (Array.isArray(inst.decl.parts) && inst.decl.parts.length ? inst.decl.parts : v.entry(inst)?.parts ?? []);
export const composite = {
  STEPS: Object.freeze(["check", "parts", "close"]),
  legality(v, inst) {
    const parts = partsOf(v, inst);
    if (!parts.length) return bad("noParts");
    for (const p of parts) if (!C.entryFor(v.state, inst.actor, p.action, v.facts)) return bad("unknownPart", { part: p.action });
    const a = v.facts.c(inst.actor);
    if (!a || a.present === false) return bad("gone");
    if (a.health <= 0) return bad("broken");                                                    // [B2707]
    return fine;
  },
  revalidate(v, inst) { const b = K.actorBlocked(v, inst); return { ok: !b, reasons: b ? [b] : [] }; },
  steps: {
    check(v, inst) { const I = K.draft(inst), R = K.result(I); I.data.i = 0; I.data.results = []; R.goto = "parts"; return R; },
    parts(v, inst) {
      const I = K.draft(inst), R = K.result(I), parts = partsOf(v, I);
      const done = I.data.results.length;
      if (done > I.data.i) {                                                                    // a part came back
        const last = I.data.results[done - 1];
        I.data.i = done;
        if (last.status === "aborted" || (last.result && ["illegal", "gateFailed"].includes(last.result))) { I.data.result = "stopped"; R.goto = "close"; return R; }
      }
      if (I.data.i >= parts.length) { I.data.result = "done"; R.goto = "close"; return R; }
      const p = parts[I.data.i];
      I.locked = true;
      R.push = { action: p.action, actor: p.actor ?? I.actor, decl: { helpers: [], exploits: [], stressTotal: 0, ...(p.decl ?? {}), action: p.action, targets: p.decl?.targets ?? I.decl.targets ?? [] }, cause: I.cause, part: 1, data: { prepaid: true } };
      return R;
    },
    close(v, inst) { const I = K.draft(inst), R = K.result(I); R.done = true; return R; },
  },
};
