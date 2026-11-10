/* Tactical combat, package P2: ATTACK FLOW (spec 9.1) as a skeleton with a trivial attack. NO Foundry globals.
   Steps (spec 9.1 numbers): check (2) -> gate (3) -> reactBefore (4) -> roll (5, 6) -> outcome -> stunts (7) -> damage (8) -> reactAfterDamage (9) -> effects (10) -> close (11).
   Step 1 (declare) is the engine's `declare` / `amend` requests. Every number comes from scripts/rules (spec 1.1 principle 3).
   IN P2: slugfest, shooting, grapple, counterattack against single targets; block and dodge; reactions given as catalog data (interrupting action, target
   swap, automatic miss); gate rolls; Double Damage, Stun / Suppressed, Trap; breaking and the injury roll. LEFT TO P4 (each ends in a GM card here, never in an
   invented rule): wrecking, charge, area and full auto, Knockback / Slam movement, Bang Heads / Trick Shot extra targets, Disarm, Deadly Hit bookkeeping beyond the
   injury bonus, minion losses from area hits [OQ-1], the dodge move. */
import { attack, stunts, damage, crits, dice, zones } from "../../rules/index.mjs";
import * as P1 from "../economy-pure.mjs";
import * as M from "../mods-pure.mjs";
import * as C from "../catalog-pure.mjs";
import * as K from "./kit.mjs";

export const STEPS = Object.freeze(["check", "gate", "reactBefore", "roll", "outcome", "stunts", "damage", "reactAfterDamage", "effects", "close"]);
const SLUG = ["slugfest", "grapple", "grappleAttack", "counterattack", "ram"];
const GM_STUNTS = { knockback: "direction", slam: "direction", special: "stunt", own: "stunt", bangHeads: "stunt", trickShot: "stunt", disarm: "stunt" };   // P2: resolved by the GM (P4 automates)
export const INVISIBLE_GATE_DICE = -3;          // [B2075]
const kindOf = (inst) => inst.data.kind ?? "slugfest";
const weaponOf = (v, inst) => v.facts.weapon(inst.actor, inst.decl.weapon ?? "unarmed");
const bad = (reason, params = {}) => ({ ok: false, reason, params });

/** Legality of the declaration (spec 9.1 step 2). Returns { ok, reason, params, gates, notes }. Costs are checked by the engine (ledger, P1). */
export function legality(v, inst) {
  const { state, facts } = v, d = inst.decl, kind = kindOf(inst);
  if (!attack.ATTACKS[kind]) return bad("unknownAttack");
  const a = facts.c(inst.actor);
  if (!a || a.present === false) return bad("gone");
  const counter = kind === "counterattack";
  if (!counter) {
    if (a.health <= 0) return bad("broken");                                                                 // [B2707]
    const ac = M.conditions(state, inst.actor);
    if (ac.held) return bad("held");                                                                         // [B2496]
    if (ac.snared) return bad("snared");                                                                     // [R21]
    if (ac.carriedAloft) return bad("carriedAloft");                                                         // [B2392]
    if (ac.trapped && SLUG.includes(kind)) return bad("trapped");                                            // [R20]
    if (M.hasStatus(state, inst.actor, "grappling") && kind !== "grappleAttack") return bad("grappling");    // [B2497]
    if (kind === "grappleAttack" && !M.hasStatus(state, inst.actor, "grappling")) return bad("notHolding");  // [B2497]
    if ((d.stressTotal ?? 0) > 0 && !damage.canTakeVoluntaryStress(a.resolve)) return bad("stressedOut");    // [B2816], [B2228]
  }
  if (!Array.isArray(d.targets) || d.targets.length < 1) return bad("noTarget");
  if (d.targets.length > 1 || d.area || d.fullAuto || d.wreck || d.special) return bad("notYet", { what: d.wreck ? "wreck" : d.special ?? "area" });   // P4; the exception path lets the GM run it by hand
  const gates = [], notes = [];
  const w = weaponOf(v, inst);
  for (const t of d.targets) {
    const tf = facts.c(t);
    if (!tf || tf.present === false || t === inst.actor) return bad(t === inst.actor ? "self" : "gone");
    const unseen = state.knowledge?.[inst.actor]?.[t] === "unseen";
    if (unseen && !d.blind) return bad("unseen");                                                            // spec 10: needs the stated intent to attack "where it should be"
    const r = facts.range(inst.actor, t);
    if (r === undefined) notes.push("noScene");                                                              // spec 7: positional steps fall back to the GM
    else if (r === null) return bad("noRange");                                                              // [Z4]
    else if (SLUG.includes(kind)) { if (r.total !== 0) return bad("outOfReach", { distance: r.total }); }    // [Z2], [B2425]; elevated targets [Z5] are the zones adapter's `range`
    else {
      if (!w || !Array.isArray(w.range)) return bad("noWeapon");                                             // [B2510]
      const sr = zones.shootingRange(r.total, w.range);                                                      // [B2511]
      if (!sr.ok) return bad(sr.reason, { distance: r.total });
    }
    if (kind === "grapple") { const g = attack.grappleCheck({ target: K.immunityFlags(tf), usesWeapon: !!d.weapon && d.weapon !== "unarmed" }); if (!g.ok) return bad(g.reason); }   // [B2496], [B2502]
    if (!counter) {
      if (M.hasStatus(state, t, "invisible")) gates.push({ kind: "invisible", target: t, attr: "intuition", dice: INVISIBLE_GATE_DICE, src: 2075 });   // [B2075]
      else if (unseen) gates.push({ kind: "unseen", target: t, gm: 1 });                                     // concealed by the GM: no cited number, so the GM sets the gate
    }
  }
  if (!counter && facts.zone(inst.actor)?.states?.lowgrav) gates.push({ kind: "lowGravity", attr: "agility", dice: 0, src: 1703 });   // [B1703]
  return { ok: true, reason: null, params: {}, gates, notes };
}

/** Does the instance still hold after an interrupt finished on top of it (spec 5.1)? Returns { ok, reasons }. The engine never decides: a failure opens the
    GM card `revalidate` [OQ-3]. */
export function revalidate(v, inst) {
  const reasons = [];
  const blocked = K.actorBlocked(v, inst);
  if (blocked) reasons.push(blocked);
  if (inst.entry && v.state.ledger[inst.actor]?.entries.find((e) => e.id === inst.entry)?.void) reasons.push("costVoid");
  if (!blocked) { const l = legality(v, inst); if (!l.ok) reasons.push(l.reason); }
  return { ok: reasons.length === 0, reasons };
}

/* ------------------------------------------------------------------ helpers */
function defencePrompt(v, I, t) {
  const kind = kindOf(I), tf = v.facts.c(t), conds = M.conditions(v.state, t);
  const hasQuick = P1.canPay(v.state, t, "quick", { interrupt: true, defense: true }).ok;      // a grant may pay the defence (spec 4.2)
  const opts = attack.defenceOptions({ attack: kind, defender: { ...conds, hasQuick } });        // [B2446], [B2524], [R6], [R20], [R21], [R10]
  const options = [];
  for (const id of ["block", "dodge"]) {
    if (opts[id].reason === "notAllowed") continue;                                              // this attack cannot be answered that way at all
    const o = { id, label: `ITAC.action.${id}`, cost: "quick" };
    if (!opts[id].ok) o.disabled = opts[id].reason;
    options.push(o);
  }
  for (const e of C.reactionsFor(v.state, t, "beforeRoll").filter((e) => e.reaction.effect !== "swapTarget")) options.push(K.reactionOption(v, t, e));
  const live = options.filter((o) => !o.disabled);
  const p = { key: `rb:${t}`, kind: "reaction", to: K.addressee(v, t), about: t, options: [...options, { id: K.PASS, label: "ITAC.opt.pass" }], data: { when: "beforeRoll", attacker: I.actor, attack: kind } };
  if (!live.length) p.auto = { option: K.PASS, reason: conds.unaware ? "unaware" : "noOption" };                 // plan 5.2 step 4
  else if (tf?.npc) {                                                                                             // spec 13.3 NpcPolicy
    const pol = v.state.npc?.[t] ?? {}, def = live.find((o) => o.id === "block" || o.id === "dodge");
    if (def && pol[def.id] === "always") p.auto = { option: def.id, reason: "npcDefault" };
    else if (live.every((o) => pol[o.id] === "never")) p.auto = { option: K.PASS, reason: "npcDefault" };
  }
  return p;
}
/** Apply one answered reaction of a window. Returns true when it pushed an interrupting action (the step must wait for it). */
function applyReaction(v, I, R, cid, key, value, when) {
  const id = typeof value === "string" ? value : value?.id;
  (I.data.done ??= {})[key] = 1;
  if (!id || id === K.PASS) return false;
  if (id === "block" || id === "dodge") {
    R.effects.push({ t: "pay", who: cid, cost: "quick", action: id, interrupt: 1, defense: 1, key: `def:${cid}`, target: [I.actor] });     // [B2447], [B2525]
    (I.data.def ??= {})[cid] = { defence: id, tokens: Array.isArray(value?.tokens) ? value.tokens.slice(0, 12) : [] };
    R.events.push({ type: "reaction", who: cid, kind: id, cost: "quick", stress: 0 });
    return false;
  }
  const e = C.reactionsFor(v.state, cid, when).find((x) => `r:${x.id}` === id);
  if (!e) return false;
  R.effects.push({ t: "pay", who: cid, cost: e.cost, action: e.id, interrupt: 1, key: `re:${when}:${cid}`, target: [I.actor] });
  if (e.stress?.fixed) R.effects.push({ t: "stress", who: cid, n: e.stress.fixed });
  R.events.push({ type: "reaction", who: cid, kind: e.id, cost: e.cost, stress: e.stress?.fixed ?? 0, for: I.decl.targets[0] });
  if (e.reaction.effect === "action") {            // an interrupt that is itself an action: pushed on top, runs to its end, then this one is revalidated (spec 5.1)
    R.push = { action: e.id, actor: cid, decl: { action: e.id, targets: [I.actor], helpers: [], exploits: [], stressTotal: 0 }, cause: "interrupt", prepaid: 1 };
    return true;
  }
  if (e.reaction.effect === "swapTarget") {        // retargeting (spec 9.1 step 4 "target swap"): the reactor becomes the target; its own window opens next
    const from = I.decl.targets.includes(value?.for) ? value.for : I.decl.targets[0];
    I.decl.targets = I.decl.targets.map((t) => (t === from ? cid : t));
    (I.data.retargets ??= []).push({ from, to: cid, by: e.id });
    if (I.data.def) delete I.data.def[from];
    return false;
  }
  if (e.reaction.effect === "autoMiss") { ((I.data.forced ??= {}).autoMiss ??= {})[cid] = e.id; return false; }
  (I.data.notes ??= []).push({ who: cid, entry: e.id, when });
  return false;
}
/** Drive a set of window prompts (keys). Returns "wait" or "done". */
function runWindow(v, I, R, keys, when) {
  for (const key of keys) {
    if (I.data.done?.[key]) continue;
    if (!K.isAnswered(v, I, key)) continue;
    const cid = K.promptOf(v, I, key).about;
    if (applyReaction(v, I, R, cid, key, K.answerOf(v, I, key), when)) return "wait";
  }
  return keys.every((k) => I.data.done?.[k]) ? "done" : "wait";
}
const windowKeys = (I, prefix) => Object.keys(I.data.pk ?? {}).filter((k) => k.startsWith(prefix));

/* ------------------------------------------------------------------ steps */
const withOut = (inst) => { const I = K.draft(inst); I.data.out ??= {}; return I; };      // a skipped step (spec 14.1 skipStep) must not break the later ones
export const steps = {
  /* step 2: legality was checked when the declaration came in; here the gates it found are fixed on the instance */
  check(v, inst) {
    const I = K.draft(inst), R = K.result(I), l = legality(v, I);
    if (!l.ok && !I.data.exception) { R.goto = "close"; I.data.result = "illegal"; I.data.reason = l.reason; return R; }
    I.data.gates = l.gates ?? []; I.data.notes = [...(I.data.notes ?? []), ...(l.notes ?? []).map((n) => ({ note: n }))];
    R.goto = "gate";
    return R;
  },

  /* step 3: gate rolls forced on the attacker; a failure spends the action [B2075], [B1903], [B1703] */
  gate(v, inst) {
    const I = K.draft(inst), R = K.result(I);
    const gates = I.data.gates ?? [];
    for (let i = 0; i < gates.length; i++) {
      const g = gates[i], key = `gate:${i}`;
      if (g.gm && !g.attr) {                                        // no cited number: the GM waives the gate, sets the roll, or rules the action forfeit
        if (!I.data.pk?.[`gateGm:${i}`]) { R.prompts.push({ key: `gateGm:${i}`, kind: "gate", to: "gm", about: I.actor, gmOnlyData: 1, options: [{ id: "waive", label: "ITAC.opt.waive" }, { id: "roll", label: "ITAC.opt.gateRoll", data: { attr: "intuition" } }, { id: "forfeit", label: "ITAC.opt.forfeit" }], data: { gate: g.kind, target: g.target } }); R.wait = true; return R; }
        if (!K.isAnswered(v, I, `gateGm:${i}`)) { R.wait = true; return R; }
        const a = K.answerOf(v, I, `gateGm:${i}`), id = typeof a === "string" ? a : a?.id;
        if (id === "waive") { g.waived = 1; continue; }
        if (id === "forfeit") { I.data.result = "gateFailed"; R.events.push({ type: "gate", gate: g.kind, passed: false }); R.goto = "close"; return R; }
        g.attr = "intuition"; g.dice = Math.max(-9, Math.min(9, Math.trunc(Number(a?.dice) || 0)));
      }
      if (g.waived) continue;
      if (!K.rollOf(I, key)) {
        const { pool } = K.buildPool(v, I, key, I.actor, g.attr, g.dice ? [{ source: `gate:${g.kind}`, dice: g.dice }] : []);
        R.effects.push(K.rollEffect(key, I.actor, g.attr, pool, { passive: true, label: `ITAC.gate.${g.kind}` }));      // [B2227]: passive, no push
        R.wait = true; return R;
      }
      if (!K.rollFinal(I, key)) { R.wait = true; return R; }
      if (!K.flag(I, key)) { K.setFlag(I, key); R.events.push({ type: "gate", gate: g.kind, roll: key, passed: K.sixesOf(I, key) > 0 }); }
      if (K.sixesOf(I, key) < 1) { I.data.result = "gateFailed"; R.goto = "close"; return R; }
    }
    R.goto = "reactBefore";
    return R;
  },

  /* step 4: reaction window before the roll, open to everyone entitled; a party with no option is passed automatically */
  reactBefore(v, inst) {
    const I = K.draft(inst), R = K.result(I), kind = kindOf(I);
    I.data.window = "beforeRoll";
    if (kind !== "counterattack") {                                                             // [R4]: nothing answers a counterattack
      for (const t of I.decl.targets) if (!I.data.pk?.[`rb:${t}`] && !R.prompts.some((p) => p.key === `rb:${t}`)) R.prompts.push(defencePrompt(v, I, t));
      if (!K.flag(I, "rbOthers")) {
        K.setFlag(I, "rbOthers");
        R.prompts.push(...K.windowPrompts(v, I, "beforeRoll", { skip: I.decl.targets, reactions: C.reactionsFor }));
        R.events.push({ type: "reactionWindow", when: "beforeRoll", waiting: [...I.decl.targets] });
      }
    }
    if (R.prompts.length) { R.wait = true; return R; }
    const keys = [...windowKeys(I, "rb:").filter((k) => I.decl.targets.includes(k.slice(3))), ...windowKeys(I, "w:beforeRoll:")];
    const before = I.decl.targets.join();
    const st = runWindow(v, I, R, keys, "beforeRoll");
    if (R.push) return R;
    if (I.decl.targets.join() !== before) { R.goto = "reactBefore"; return R; }      // retargeted: the new target's own window opens
    if (st === "wait") { R.wait = true; return R; }
    I.data.window = null;
    R.goto = "roll";
    return R;
  },

  /* steps 5 and 6: the declaration locks at the first die; attacker, then each defender; push timing by the world switch [R3]; defenders never push [B2241] */
  roll(v, inst) {
    const I = K.draft(inst), R = K.result(I), kind = kindOf(I), A = attack.ATTACKS[kind], d = I.decl;
    const order = dice.OPPOSED_PUSH_ORDERS.includes(v.state.opts?.pushOrder) ? v.state.opts.pushOrder : "afterDefence";      // [R3], [OQ-9]
    if (!I.locked) {
      I.locked = true;                                                                          // spec 5.5
      R.events.push({ type: "actionLocked" });
      if ((d.stressTotal ?? 0) > 0) R.effects.push({ t: "stress", who: I.actor, n: d.stressTotal, cost: 1 });   // spec 4.3: charged when the declaration locks
    }
    if (kind === "counterattack") {                                                             // [B2448], [R4]: hits automatically with the surplus sixes, no dice
      if (!K.rollOf(I, "attack")) I.rolls.attack = { key: "attack", who: I.actor, attr: null, pool: { base: 0, mods: [], total: 0 }, sixes: I.data.counterSixes ?? 1, ones: 0, pushed: 0, pushable: false, auto: 1 };
      R.goto = "outcome"; return R;
    }
    if (!K.rollOf(I, "attack")) {
      const tg = K.tokenGate(v, I, R, I.actor, { kind: "attack", attr: A.attr }, d.tokens ?? [], "attack");
      if (tg.wait) { R.wait = true; return R; }
      const t0 = d.targets[0], a = v.facts.c(I.actor), w = weaponOf(v, I), r = v.facts.range(I.actor, t0);
      const mods = attack.attackModifiers({ attack: kind, target: M.conditions(v.state, t0), weaponBonus: w?.bonus ?? 0, distance: r?.total ?? null, range: w?.range ?? null,
        helpers: dice.helpDice((d.helpers ?? []).filter((h) => h.consent === "yes").length) });        // [B2536], [B2430], [R6], [B2511], [B2238]
      if (a?.kind === "minions" && a.members > 1) mods.push({ source: "minions", dice: dice.helpDice(a.members - 1, { minions: true }) });    // [B2827], [R24]
      const bp = K.buildPool(v, I, "attack", I.actor, A.attr, mods, { rollKind: "attack", tokens: tg.tokens });
      for (const wr of bp.writes) R.effects.push({ t: "state", path: wr.path, to: wr.to });
      R.effects.push(K.rollEffect("attack", I.actor, A.attr, bp.pool, { label: `ITAC.action.${I.action}` }));
      R.wait = true; return R;
    }
    if (!K.rollRolled(I, "attack")) { R.wait = true; return R; }
    if (order === "beforeDefence" && !K.rollFinal(I, "attack")) { R.wait = true; return R; }   // [R3]: the attacker finishes pushing before any defender die
    let waiting = false;
    for (const t of d.targets) {
      const df = I.data.def?.[t];
      if (!df?.defence) continue;
      const key = `def:${t}`;
      if (!K.rollOf(I, key)) {
        const bp = K.buildPool(v, I, key, t, attack.DEFENCES[df.defence].attr, [], { rollKind: df.defence, tokens: df.tokens ?? [] });
        for (const wr of bp.writes) R.effects.push({ t: "state", path: wr.path, to: wr.to });
        R.effects.push(K.rollEffect(key, t, attack.DEFENCES[df.defence].attr, bp.pool, { defender: true, label: `ITAC.action.${df.defence}` }));
        waiting = true;
      } else if (!K.rollFinal(I, key)) waiting = true;
    }
    if (waiting) { R.wait = true; return R; }
    if (!K.flag(I, "afterRoll")) {                                                              // step 6: window after the roll (catalog data: Indomitable, double pushes ... P6)
      K.setFlag(I, "afterRoll"); I.data.window = "afterRoll";
      R.prompts.push(...K.windowPrompts(v, I, "afterRoll", { reactions: C.reactionsFor }));
      R.events.push({ type: "reactionWindow", when: "afterRoll", waiting: [I.actor] });
      if (R.prompts.length) { R.wait = true; return R; }
    }
    if (runWindow(v, I, R, windowKeys(I, "w:afterRoll:"), "afterRoll") === "wait" || R.push) { R.wait = !R.push; return R; }
    if (!K.rollFinal(I, "attack")) { R.wait = true; return R; }                                 // the push itself: the system's own buttons (spec 11)
    I.data.window = null;
    R.goto = "outcome";
    return R;
  },

  /* hit and defence arithmetic [B2207], [B2446], [B2524], [B2243]; GM overrides (spec 14.1 setOutcome) win */
  outcome(v, inst) {
    const I = K.draft(inst), R = K.result(I), kind = kindOf(I);
    const atk = K.rollOf(I, "attack");
    R.events.push({ type: "roll", key: "attack", who: I.actor, attr: atk?.attr, dice: atk?.pool?.total, sixes: K.sixesOf(I, "attack"), ones: atk?.ones ?? 0, pushed: atk?.pushed ?? 0, messageId: atk?.messageId });
    I.data.out = {};
    for (const t of I.decl.targets) {
      const df = I.data.def?.[t]?.defence ?? null, forced = I.data.forced?.outcome?.[t], autoMiss = I.data.forced?.autoMiss?.[t];
      let o = attack.resolveAttack({ attack: kind, attackSixes: K.sixesOf(I, "attack"), defence: df, defenceSixes: df ? K.sixesOf(I, `def:${t}`) : 0 });
      if (autoMiss) o = { hit: false, net: 0, stunts: 0, counterattack: null, dodgeMove: 0, autoMiss };
      if (forced === true && !o.hit) o = { ...o, hit: true, net: 1, stunts: 0, counterattack: null, dodgeMove: 0, forced: 1 };
      if (forced === false && o.hit) o = { ...o, hit: false, net: 0, stunts: 0, forced: 1 };
      I.data.out[t] = o;
      if (df) { const dr = K.rollOf(I, `def:${t}`); R.events.push({ type: "roll", key: `def:${t}`, who: t, attr: dr?.attr, dice: dr?.pool?.total, sixes: K.sixesOf(I, `def:${t}`), ones: dr?.ones ?? 0, pushed: 0, opposed: "attack", messageId: dr?.messageId }); }
      R.events.push({ type: "outcome", target: t, hit: o.hit, net: o.net, blocked: df === "block" && !o.hit, dodged: df === "dodge" && !o.hit, autoMiss: o.autoMiss });
    }
    R.goto = "stunts";
    return R;
  },

  /* step 7: one stunt per six beyond the first, each once per target [B2433], [B2515]; the GM has the last word [B2218] */
  stunts(v, inst) {
    const I = withOut(inst), R = K.result(I);
    const hit = I.decl.targets.filter((t) => I.data.out[t]?.hit), budget = Math.max(0, ...hit.map((t) => I.data.out[t].stunts));
    if (!hit.length || budget < 1 || !options(v, I, hit).some((o) => !o.disabled)) { I.data.stunts = I.data.stunts ?? []; R.goto = "damage"; return R; }
    if (!I.data.pk?.stunts) { R.prompts.push({ key: "stunts", kind: "stunts", to: K.addressee(v, I.actor), about: I.actor, multi: 1, min: 0, max: budget, options: options(v, I, hit) }); R.wait = true; return R; }
    if (!K.isAnswered(v, I, "stunts")) { R.wait = true; return R; }
    const picks = picksOf(K.answerOf(v, I, "stunts"));
    let waiting = false;
    const approved = [];
    picks.forEach((p, i) => {
      const card = GM_STUNTS[p.stunt];
      if (!card) { approved.push(p); return; }
      const key = `gs:${i}`;                                                                    // Knockback direction [R7], own and special stunts [B2442]: GM card
      if (!I.data.pk?.[key]) { R.prompts.push({ key, kind: card, to: "gm", about: p.target, options: [{ id: "approve", label: "ITAC.opt.approve" }, { id: "refuse", label: "ITAC.opt.refuse" }], free: 1, data: { stunt: p.stunt, target: p.target, by: I.actor } }); waiting = true; }
      else if (!K.isAnswered(v, I, key)) waiting = true;
      else if (K.answerId(v, I, key) === "approve") approved.push({ ...p, gm: 1 });
    });
    if (waiting) { R.wait = true; return R; }
    I.data.stunts = approved;
    for (const p of approved) R.events.push({ type: "stunt", target: p.target, stunt: p.stunt });
    R.goto = "damage";
    return R;
  },

  /* step 8 and spec 9.5 steps 1-6: pulled punch, Double Damage before Armor, the single best Armor, then Health (or Resolve) */
  damage(v, inst) {
    const I = withOut(inst), R = K.result(I), kind = kindOf(I), entry = v.entry(I), w = weaponOf(v, I), a = v.facts.c(I.actor);
    I.data.dmg = I.data.dmg ?? {};
    for (const t of I.decl.targets) {
      if (!I.data.out[t]?.hit || I.data.dmg[t] || kind === "grapple" || entry?.damage?.none) continue;          // [R5]: the grapple that takes hold does no damage
      const tf = v.facts.c(t);
      if (!tf) continue;
      const tags = M.damageTags({ source: entry?.damage?.source ?? w?.source, sharp: entry?.damage?.sharp ?? w?.sharp, toStress: entry?.damage?.toStress, ignoreArmor: entry?.damage?.ignoreArmor, cause: kind === "counterattack" ? "counter" : "attack" });
      const base = entry?.damage?.base ?? (w && w.damage != null ? w.damage : a?.slugfest?.damage ?? 0);         // [B2426], [B2428], [B2512]
      const doubled = (I.data.stunts ?? []).some((p) => p.stunt === "doubleDamage" && p.target === t);          // [B2434]
      const forced = I.data.forced?.damage?.[t];
      const ar = damage.selectArmor(tags.toStress ? [] : tf.armor ?? []);                                      // [B2682], [R13]; stress armor is [G-L4]
      const hd = damage.hitDamage({ base, pulled: I.decl.pulled ?? null, doubled, armor: forced?.armor ?? ar.armor, ignoreArmor: tags.ignoreArmor, source: tags.source, immunities: tf.immunities ?? [], vulnerabilities: tf.vulnerabilities ?? [] });   // [B2427], [B2434], [B2193], [B1879]
      const taken = Number.isFinite(forced?.amount) ? Math.max(0, forced.amount) : hd.taken;
      const rec = { base, raw: hd.raw, doubled, armor: hd.armor, armorSource: ar.source?.id ?? null, taken, tags, forced: forced ? 1 : undefined };
      if (tags.toStress) {
        const s = damage.applyStress({ resolve: tf.resolve, stress: taken });                                   // [B1591], [B2816]
        rec.resolveBefore = tf.resolve; rec.resolveAfter = s.resolve;
        if (s.lost) R.effects.push({ t: "actor", who: t, path: "resolve", to: s.resolve });
      } else {
        const ad = damage.applyDamage({ health: tf.health, taken });                                            // [B2707], [B2708]
        Object.assign(rec, { healthBefore: tf.health, healthAfter: ad.health, broken: ad.broken, newlyBroken: ad.newlyBroken });
        if (taken > 0 && ad.health !== tf.health) R.effects.push({ t: "actor", who: t, path: "health", to: ad.health });
        if (damage.barrierBreached(ar.source, taken)) rec.barrierBreached = ar.source.id;                       // [B1859], [R13]: ending the Barrier effect is its power model's (P6)
      }
      I.data.dmg[t] = rec;
      R.events.push({ type: "damage", target: t, base, doubled, armor: hd.armor, taken, toStress: tags.toStress, dtype: tags.source, source: tags.cause });
    }
    R.goto = "reactAfterDamage";
    return R;
  },

  /* step 9: window after damage (Redirecting Blast, injury re-rolls ...: catalog data, P6) */
  reactAfterDamage(v, inst) {
    const I = K.draft(inst), R = K.result(I);
    if (!K.flag(I, "afterDamage")) {
      K.setFlag(I, "afterDamage"); I.data.window = "afterDamage";
      R.prompts.push(...K.windowPrompts(v, I, "afterDamage", { reactions: C.reactionsFor }));
      if (R.prompts.length) { R.events.push({ type: "reactionWindow", when: "afterDamage", waiting: R.prompts.map((p) => p.about) }); R.wait = true; return R; }
    }
    if (runWindow(v, I, R, windowKeys(I, "w:afterDamage:"), "afterDamage") === "wait" || R.push) { R.wait = !R.push; return R; }
    I.data.window = null;
    R.goto = "effects";
    return R;
  },

  /* step 10: immediate rolls, broken and injuries, statuses, counterattack or dodge move on a miss */
  effects(v, inst) {
    const I = withOut(inst), R = K.result(I), kind = kindOf(I);
    const picked = (t, s) => (I.data.stunts ?? []).some((p) => p.target === t && p.stunt === s);
    const once = (k) => { if (K.flag(I, k)) return false; K.setFlag(I, k); return true; };
    for (const t of I.decl.targets) {
      const o = I.data.out[t], dm = I.data.dmg?.[t], tf = v.facts.c(t);
      if (!o || !tf) continue;
      if (o.hit) {
        if (kind === "grapple" && once(`grap:${t}`)) {                                          // [B2496], [R5]
          R.effects.push({ t: "status+", who: t, status: { id: "grappled", source: { kind: "stunt", owner: I.actor, name: "grapple" }, data: { by: I.actor } } });
          R.effects.push({ t: "status+", who: I.actor, status: { id: "grappling", source: { kind: "stunt", owner: I.actor, name: "grapple" }, data: { held: t } } });
          R.events.push({ type: "status", target: t, status: { id: "grappled", on: true } });
        }
        if (picked(t, "trap") && once(`trap:${t}`)) {                                           // [B2438], [R20]
          R.effects.push({ t: "status+", who: t, status: { id: "trapped", source: { kind: "stunt", owner: I.actor, name: "trap" } } });
          R.events.push({ type: "status", target: t, status: { id: "trapped", on: true } });
        }
        const stun = picked(t, "stun") ? "stun" : picked(t, "suppressed") ? "suppressed" : null;
        if (stun && dm && stunts.stunOutcome({ taken: dm.taken }).rollNeeded) {                 // [B2436], [B2517]
          const key = `stun:${t}`;
          if (!K.rollOf(I, key)) { const { pool } = K.buildPool(v, I, key, t, "presence"); R.effects.push(K.rollEffect(key, t, "presence", pool, { passive: true, label: `ITAC.stunt.${stun}` })); R.wait = true; return R; }   // [A-2]: "no action" reaction rolls are passive
          if (!K.rollFinal(I, key)) { R.wait = true; return R; }
          if (once(key) && stunts.stunOutcome({ taken: dm.taken, presenceSixes: K.sixesOf(I, key) }).losesTurn) {   // [R10]
            R.effects.push({ t: "state", path: ["ledger", t], to: P1.loseNextTurn(P1.ledgerOf(v.state, t), { kind: "stunt", owner: I.actor, name: stun }) });
            R.effects.push({ t: "status+", who: t, status: { id: "stunned", source: { kind: "stunt", owner: I.actor, name: stun } } });
            R.events.push({ type: "status", target: t, status: { id: "stunned", on: true } });
          }
        }
        if (dm && K.brokenAndCrit(v, I, R, t, dm, { deadlyHit: picked(t, "deadlyHit"), by: I.actor })) return R;       // spec 9.5 steps 7-9
      } else if (o.counterattack && I.data.def?.[t]?.defence === "block") {                    // [B2448], [R4]
        const key = `counter:${t}`;
        if (!I.data.pk?.[key]) {
          const r = v.facts.range(t, I.actor), opt = { id: "counter", label: "ITAC.opt.counter", data: { sixes: o.counterattack.sixes } };
          if (r && r.total !== 0) opt.disabled = "outOfReach";                                  // [OQ-10] provisional: only within the blocker's slugfest reach unless the GM allows
          const p = { key, kind: "counter", to: K.addressee(v, t), about: t, options: [opt, { id: K.PASS, label: "ITAC.opt.pass" }] };
          if (opt.disabled) p.auto = { option: K.PASS, reason: "noOption" };
          R.prompts.push(p); R.wait = true; return R;
        }
        if (!K.isAnswered(v, I, key)) { R.wait = true; return R; }
        if (once(key) && K.answerId(v, I, key) === "counter") {
          R.events.push({ type: "counter", by: t, against: I.actor, sixes: o.counterattack.sixes });
          R.push = { action: "slugfest", actor: t, decl: { action: "slugfest", weapon: "unarmed", targets: [I.actor], helpers: [], exploits: [], stressTotal: 0 }, cause: "counter", data: { kind: "counterattack", counterSixes: o.counterattack.sixes }, prepaid: 1 };
          return R;
        }
      } else if (o.dodgeMove > 0 && I.data.def?.[t]?.defence === "dodge") {                    // [B2526]: the move itself is P3; the GM card records it
        const key = `dodgeMove:${t}`;
        if (!I.data.pk?.[key]) { R.prompts.push({ key, kind: "dodgeMove", to: K.addressee(v, t), about: t, options: [{ id: "move", label: "ITAC.opt.dodgeMove", data: { zones: o.dodgeMove } }, { id: K.PASS, label: "ITAC.opt.pass" }] }); R.wait = true; return R; }
        if (!K.isAnswered(v, I, key)) { R.wait = true; return R; }
        if (once(key) && K.answerId(v, I, key) === "move") (I.data.notes ??= []).push({ note: "dodgeMoveByHand", target: t, zones: o.dodgeMove });
      }
    }
    R.goto = "close";
    return R;
  },

  /* step 11 */
  close(v, inst) {
    const I = withOut(inst), R = K.result(I);
    if (!I.data.result) I.data.result = I.decl.targets.some((t) => I.data.out?.[t]?.hit) ? "hit" : "miss";
    R.effects.push({ t: "fact", who: I.actor, facts: { attacked: 1, acted: 1, tags: v.entry(I)?.tags ?? [] } });     // spec 4.2 history
    R.done = true;
    return R;
  },
};

/* ------------------------------------------------------------------ stunt options and validation */
function ctxFor(v, I, t) {
  const tf = v.facts.c(t), w = weaponOf(v, I), kind = kindOf(I);
  const others = (v.facts.inZone(t) ?? []).filter((c) => c !== I.actor && c !== t).length;
  return { attack: kind === "ram" ? "slugfest" : kind, target: K.immunityFlags(tf), sharp: !!(v.entry(I)?.damage?.sharp ?? w?.sharp), zoneEmpty: !!v.facts.zone(t)?.empty, movementLeft: 0, otherOpponents: others };   // [G-L7]: `huge` only for real huge creatures
}
function options(v, I, hit) {
  const out = [];
  for (const t of hit) for (const o of stunts.stuntOptions(ctxFor(v, I, t))) {
    const opt = { id: `${o.id}@${t}`, label: `ITAC.stunt.${o.id}`, data: { stunt: o.id, target: t, gm: o.gm || !!GM_STUNTS[o.id] } };
    if (!o.ok) opt.disabled = o.reason;
    out.push(opt);
  }
  return out;
}
const picksOf = (value) => (Array.isArray(value) ? value : []).map((id) => String(id).split("@")).filter((p) => p.length === 2).map(([stunt, target]) => ({ stunt, target }));
/** Is a multi answer legal as a whole? (budget, once per target, exclusions: stunts.validateStunts; the per-target cap of area attacks [A-3] is checked here, [G-L9]) */
export function validate(v, inst, prompt, value) {
  if (prompt.kind !== "stunts") return { ok: true };
  const picks = picksOf(value), out = inst.data.out ?? {};
  const sixes = Math.max(0, ...inst.decl.targets.filter((t) => out[t]?.hit).map((t) => out[t].net));
  const r = stunts.validateStunts({ picks, sixes, ctxFor: (t) => ctxFor(v, inst, t) });
  if (!r.ok) return { ok: false, reason: r.errors[0].reason };
  for (const t of new Set(picks.map((p) => p.target))) if (picks.filter((p) => p.target === t).length > (out[t]?.stunts ?? 0)) return { ok: false, reason: "budget" };
  return { ok: true };
}
