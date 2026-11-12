/* Tactical combat, package P7: CHALLENGES INSIDE A FIGHT (spec 9.9; rules: scripts/rules/challenge.mjs). NO Foundry globals.
   A challenge is a combatant without a card and without a ledger [R22] [I12]. Its Challenge rating is the engine field `health`, its
   time limit the field `resolve` (system adapter), so both are journaled like any other number and the challenges HUD follows by itself.
   objective   the roll on an objective [R15] [B2837-2841]: a full action; every six takes one point off the rating, each hero's roll on
               its own; at 0 the challenge is overcome. The approach is one of the options the GM set up (state.challenges[cid], a book
               preset or none), or the player's own idea: then the GM's card decides [B2839], as it does when the option names a power the
               engine cannot find on the hero. Help [B2238] and the ward's penalty [B2876] are dice of the roll.
   effect      one side effect that asks a roll of a character: the toxin [B2889] (STRENGTH at the start of the hero's turn, no action;
               a failure takes the full action of the round [L8]). Side effects the engine has no flow for are GM-run instances.
   The clock [R22] and the "time is up" consequence live in `clock` and `failRun` below; engine-pure.mjs performs what they return.
   state.challenges[cid] = { preset, name, objectives: [{ id, options: [{ attr, minAttr?, power? }] }], effects: [...], ward?, dice, resets, started: { [objective]: 1 }, done? } */
import { challenge, dice } from "../../rules/index.mjs";
import * as P1 from "../economy-pure.mjs";
import * as K from "./kit.mjs";

const bad = (reason, params = {}) => ({ ok: false, reason, params });
const fine = { ok: true, reason: null, params: {}, gates: [], notes: [] };
const blank = { helpers: [], exploits: [], stressTotal: 0 };
const ATTRS = ["fighting", "agility", "strength", "reason", "intuition", "presence"];
const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
export const PRESETS = Object.freeze(Object.keys(challenge.BOOK_CHALLENGES));
export const cfgOf = (state, cid) => (isObj(state?.challenges?.[cid]) ? state.challenges[cid] : null);

/** D102: the numbers a book preset puts on the challenge's sheet: its rating, and its time limit when that is counted in rounds (a limit in
    days or hours is no clock of a fight; the sheet's time stays). -> { rating: n|null, time: n|null } */
export function presetNumbers(id) {
  const p = challenge.BOOK_CHALLENGES[id];
  if (!p) return { rating: null, time: null };
  const n = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Math.trunc(Number(x)) : null);
  return { rating: n(p.rating), time: (p.unit ?? "rounds") === "rounds" ? n(p.timeLimit) : null };
}
/** The set-up record of a book preset (numbers and structure only), or of a challenge without one. */
export function presetConfig(id) {
  const p = challenge.BOOK_CHALLENGES[id];
  if (!p) return { preset: null, objectives: [], effects: [], dice: 0, resets: 0, started: {} };
  return { preset: id, objectives: (p.objectives ?? []).map((o) => ({ id: o.id, options: o.options.map((x) => ({ ...x })) })), effects: (p.effects ?? []).map((e) => ({ ...e })), ...(p.ward ? { ward: { ...p.ward } } : {}),
    ...(p.rating != null ? { rating: p.rating } : {}), ...(p.timeLimit != null ? { timeLimit: p.timeLimit } : {}), dice: 0, resets: 0, started: {} };
}
/** The option a declaration names (`decl.mode` = "<objective>.<index>"), or null: the player's own approach. */
export function optionOf(cfg, mode) {
  const [oid, n] = String(mode ?? "").split("."), o = (cfg?.objectives ?? []).find((x) => x.id === oid);
  const opt = o?.options?.[Number(n)];
  return o && opt ? { objective: o.id, option: opt } : null;
}
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const hasPower = (c, name) => (c?.powers ?? []).some((p) => norm(p) === norm(name));

/* ------------------------------------------------------------------ the objective roll */
const attrOf = (v, inst) => optionOf(cfgOf(v.state, inst.decl.targets?.[0]), inst.decl.mode)?.option.attr ?? inst.decl.attr ?? null;
/* The pool of an attempt: ONE builder for the roll and for what the dock shows before the declaration (preview). */
function objectivePool(v, I, tokens) {
  const d = I.decl, attr = attrOf(v, I), cfg = cfgOf(v.state, d.targets?.[0]);
  const mods = [], hd = (d.helpers ?? []).filter((h) => h.consent === "yes").length;
  if (hd) mods.push({ source: "help", dice: dice.helpDice(hd) });                          // [B2238]
  if (cfg?.dice) mods.push({ source: "ward", dice: Math.trunc(cfg.dice) });                // [B2876]: the ward's cumulative penalty after a reset
  return { attr, ...K.buildPool(v, I, "roll", I.actor, attr, mods, { rollKind: "other", tokens }) };
}
/* D47 [B2841]: a challenge counted in rounds whose time limit has run out is failed: nothing takes points off its rating any more (it was
   still overcome by a roll after the "time is up" card). A ward that resets has its clock again [B2876]. */
export const timeUp = (c) => !!c && c.kind === "challenge" && (c.timeUnit ?? "rounds") === "rounds" && c.maxResolve > 0 && !(c.resolve > 0);
export const objective = {
  preview(v, inst) { const I = K.draft(inst); return attrOf(v, I) ? objectivePool(v, I, I.decl.tokens ?? []) : null; },
  STEPS: Object.freeze(["check", "approve", "roll", "effect", "close"]),
  legality(v, inst) {
    const a = v.facts.c(inst.actor), t = inst.decl.targets?.[0], ch = t ? v.facts.c(t) : null;
    if (!a || a.present === false) return bad("gone");
    if (a.health <= 0) return bad("broken");                                                     // [B2707]
    if (!ch || ch.kind !== "challenge" || ch.present === false) return bad("noChallenge");
    if (!(ch.health > 0) || cfgOf(v.state, t)?.done || timeUp(ch)) return bad("challengeOver");  // [B2841]
    if (!ATTRS.includes(attrOf(v, inst))) return bad("noAttribute");
    const pick = optionOf(cfgOf(v.state, t), inst.decl.mode);
    if (pick?.option.minAttr && !challenge.objectiveAvailable({ attr: pick.option.attr, minAttr: pick.option.minAttr }, a).ok) return bad("attrTooLow", { attr: pick.option.attr, min: pick.option.minAttr, gmMayAllow: 1 });   // [B2857], [B2878]
    if (!pick && !String(inst.decl.text ?? "").trim() && cfgOf(v.state, t)?.objectives?.length) return bad("noApproach");
    return fine;
  },
  revalidate(v, inst) { const b = K.actorBlocked(v, inst); return { ok: !b, reasons: b ? [b] : [] }; },
  steps: {
    check(v, inst) { const I = K.draft(inst), R = K.result(I); R.goto = "approve"; return R; },
    /* [B2839]: an approach of the player's own is the GM's to accept; so is an option whose power the engine does not find on the hero */
    approve(v, inst) {
      const I = K.draft(inst), R = K.result(I), t = I.decl.targets[0], pick = optionOf(cfgOf(v.state, t), I.decl.mode), a = v.facts.c(I.actor);
      const why = !pick ? "ownApproach" : pick.option.power && !hasPower(a, pick.option.power) ? "power" : null;
      I.data.objective = pick?.objective ?? null;
      if (!why || v.facts.user(I.by)?.staff || I.decl.exception?.state === "granted") { R.goto = "roll"; return R; }
      if (!I.data.pk?.approve) { R.prompts.push({ key: "approve", kind: "objective", to: "gm", about: I.actor, free: 1, options: [{ id: "approve", label: "ITAC.opt.approve" }, { id: "refuse", label: "ITAC.opt.refuse" }],
        data: { challenge: t, attr: attrOf(v, I), why, power: pick?.option.power ?? null, text: String(I.decl.text ?? "").slice(0, 300) } }); R.wait = true; return R; }
      if (!K.isAnswered(v, I, "approve")) { R.wait = true; return R; }
      if (K.answerId(v, I, "approve") !== "approve") { I.data.result = "refused"; I.data.refund = 1; R.goto = "close"; return R; }
      R.goto = "roll"; return R;
    },
    roll(v, inst) {
      const I = K.draft(inst), R = K.result(I), d = I.decl, attr = attrOf(v, I), cfg = cfgOf(v.state, d.targets[0]);
      if (!K.rollOf(I, "roll")) {
        const tg = K.tokenGate(v, I, R, I.actor, { kind: "other", attr }, d.tokens ?? [], "roll");
        if (tg.wait) { R.wait = true; return R; }
        I.locked = true; R.events.push({ type: "actionLocked" });                                // spec 5.5
        const bp = objectivePool(v, I, tg.tokens);
        for (const wr of bp.writes) R.effects.push({ t: "state", path: wr.path, to: wr.to });
        R.effects.push(K.rollEffect("roll", I.actor, attr, bp.pool, { label: "ITAC.action.objective" }));
        R.wait = true; return R;
      }
      if (!K.rollFinal(I, "roll")) { R.wait = true; return R; }
      const r = K.rollOf(I, "roll");
      R.events.push({ type: "roll", key: "roll", who: I.actor, attr, dice: r.pool?.total, sixes: K.sixesOf(I, "roll"), ones: r.ones ?? 0, pushed: r.pushed ?? 0, messageId: r.messageId });
      R.goto = "effect"; return R;
    },
    /* [B2841]: every six takes a point off the rating; at 0 the challenge is overcome and its waiting side effects go */
    effect(v, inst) {
      const I = K.draft(inst), R = K.result(I), t = I.decl.targets[0], ch = v.facts.c(t), sixes = K.sixesOf(I, "roll");
      if (ch && !K.flag(I, "applied")) {
        K.setFlag(I, "applied");
        const next = challenge.applyObjectiveRoll({ rating: ch.health, status: ch.health > 0 ? "active" : "overcome" }, sixes);
        if (next.rating !== ch.health) R.effects.push({ t: "actor", who: t, path: "health", to: next.rating });
        if (I.data.objective && cfgOf(v.state, t)) R.effects.push({ t: "state", path: ["challenges", t, "started", I.data.objective], to: 1 });
        if (next.status === "overcome") {
          if (cfgOf(v.state, t)) R.effects.push({ t: "state", path: ["challenges", t, "done"], to: "overcome" });
          for (const g of (v.state.triggers ?? []).filter((x) => x.run?.challenge === t)) R.effects.push({ t: "state", path: ["triggers", `#${g.id}`], to: null });
        }
        I.data.result = sixes > 0 ? (next.status === "overcome" ? "overcome" : "progress") : "fail";
        I.data.rating = { from: ch.health, to: next.rating };
        R.events.push({ type: "challenge", challenge: t, rating: next.rating, timeLeft: ch.resolve, by: I.actor, sixes, state: next.status === "overcome" ? "overcome" : "active" });
      }
      R.goto = "close"; return R;
    },
    close(v, inst) {
      const I = K.draft(inst), R = K.result(I);
      if (I.data.refund && I.entry && !K.flag(I, "refunded")) { K.setFlag(I, "refunded"); R.effects.push({ t: "state", path: ["ledger", I.actor], to: P1.voidEntry(P1.ledgerOf(v.state, I.actor), I.entry) }); }   // refused before any die: the action is not spent
      R.effects.push({ t: "fact", who: I.actor, facts: { acted: 1, tags: v.entry(I)?.tags ?? [] } });
      R.done = true; return R;
    },
  },
};

/* ------------------------------------------------------------------ a side effect that asks a roll (the toxin [B2889]) */
export const effectChild = (who, fx, trigger = null) => ({ action: "challengeEffect", flow: "challengeEffect", actor: null, decl: { ...blank, action: "challengeEffect", targets: [who] }, data: { fx: { ...fx }, ...(trigger ? { trigger } : {}) }, initiator: { type: "hazard", id: String(fx.kind ?? "challenge").slice(0, 40) }, cause: "trigger" });
export const effect = {
  STEPS: Object.freeze(["check", "roll", "effect", "close"]),
  legality(v, inst) {
    const fx = inst.data.fx, t = inst.decl.targets?.[0];
    if (!isObj(fx) || !ATTRS.includes(fx.attr)) return bad("unknownHazard");
    if (!t || !v.facts.c(t) || v.facts.c(t).present === false) return bad("noTarget");
    return fine;
  },
  revalidate() { return { ok: true, reasons: [] }; },
  steps: {
    check(v, inst) { const I = K.draft(inst), R = K.result(I); I.locked = true; R.goto = "roll"; return R; },
    roll(v, inst) {
      const I = K.draft(inst), R = K.result(I), t = I.decl.targets[0], fx = I.data.fx;
      if (!K.rollOf(I, "save")) { R.effects.push(K.rollEffect("save", t, fx.attr, K.buildPool(v, I, "save", t, fx.attr, [], {}).pool, { passive: true, label: `ITAC.roll.${fx.kind === "toxin" ? "toxin" : "save"}` })); R.wait = true; return R; }   // [A-2]: no action, no push
      if (!K.rollFinal(I, "save")) { R.wait = true; return R; }
      R.goto = "effect"; return R;
    },
    effect(v, inst) {
      const I = K.draft(inst), R = K.result(I), t = I.decl.targets[0], fx = I.data.fx, sixes = K.sixesOf(I, "save");
      R.events.push({ type: "roll", key: "save", who: t, attr: fx.attr, dice: K.rollOf(I, "save")?.pool?.total, sixes, ones: 0, pushed: 0, messageId: K.rollOf(I, "save")?.messageId });
      if (fx.onFail === "loseFullAction" && challenge.toxinOutcome(sixes).losesFullAction && v.state.ledger?.[t]) {       // [B2889], [L8]
        R.effects.push({ t: "state", path: ["ledger", t], to: P1.loseFull(P1.ledgerOf(v.state, t), { kind: "challenge", name: String(fx.kind ?? "") }) });
        I.data.result = "fail";
      } else I.data.result = sixes > 0 ? "success" : "fail";
      R.goto = "close"; return R;
    },
    close(v, inst) { const I = K.draft(inst), R = K.result(I); R.done = true; return R; },
  },
};

/* ------------------------------------------------------------------ setting a challenge up (GM op `challengeSetup`)
   -> { config, triggers: [Trigger without id], zone: { key, patch } | null, manual: [effect kinds the GM runs by hand] }
   Side effects become triggers of the scheduler (spec 6.1) so the GM sees them in the queue at their moment [R22]:
     roundStart   one trigger for the challenge            heroTurnStart   one per hero in the fight now (a later arrival needs the set-up again)
     enterZone    one for the challenge's zone, when the map names it; the move flow asks the GM as for any waiting trigger [B2876]
   endOfRound and onFail are read by `clock` and `failRun`; onStart fire marks the zone when the map names it [B2925]. */
export function setup(id, { challenge: cid, name = "", zone = null, heroes = [] } = {}) {
  const cfg = presetConfig(id), triggers = [], manual = [];
  let zonePatch = null;
  const src = (kind) => ({ kind: "challenge", owner: cid, name: `${name || id || "challenge"}: ${kind}`.slice(0, 80) });
  const fire = cfg.effects.find((e) => e.when === "onStart" && e.kind === "fire");
  for (const e of cfg.effects) {
    const run = { type: e.kind === "toxin" ? "challengeRoll" : e.kind === "fireSpread" ? "fireSpread" : "challenge", kind: e.kind, challenge: cid, ...(e.attr ? { attr: e.attr } : {}), ...(e.onFail ? { onFail: e.onFail } : {}),
      /* [B2845]: this fire is no typical one: it spreads by itself, to one adjacent zone a round, and never goes out by a die. With the zone named the hazard flow does it. */
      ...(e.kind === "fireSpread" && e.automatic ? { automatic: 1, ...(zone ? { zone } : {}), ...(fire?.intensity ? { intensity: fire.intensity } : {}) } : {}) };
    if (e.when === "roundStart") triggers.push({ at: "roundStart", subject: {}, run, source: src(e.kind) });
    else if (e.when === "heroTurnStart") for (const h of heroes) triggers.push({ at: "turnStart", subject: { combatant: h }, run, source: src(e.kind) });
    else if (e.when === "enterZone") { if (zone) triggers.push({ at: "zoneEnter", subject: { zone }, run, source: src(e.kind) }); else manual.push(e.kind); }
    else if (e.when === "onStart") { if (e.kind === "fire" && zone) zonePatch = { fire: Math.max(1, Math.min(12, e.intensity ?? 1)) }; else manual.push(e.kind); }
    else if (e.when === "attackWithoutSurprise") manual.push(e.kind);
  }
  return { config: cfg, triggers, zone: zonePatch ? { key: zone, patch: zonePatch } : null, manual };
}

/* ------------------------------------------------------------------ the clock [R22] [I12] [B2841], [B2871]
   One challenge at the end of a round. c = its facts (resolve = time left, maxResolve = the limit, health = rating; timeUnit).
   -> null (no clock, over, or not counted in rounds) | { to, failed, effects: [end-of-round side effects due now] } */
export function clock(c, cfg) {
  if (!c || c.kind !== "challenge" || c.present === false || cfg?.done) return null;
  const due = (cfg?.effects ?? []).filter((e) => e.when === "endOfRound" && (!e.ifObjectiveStarted || cfg.started?.[e.ifObjectiveStarted]) && c.health > 0).map((e) => e.kind);
  if ((c.timeUnit ?? "rounds") !== "rounds" || !(c.maxResolve > 0) || !(c.resolve > 0) || !(c.health > 0)) return due.length ? { to: null, failed: false, effects: due } : null;
  const r = challenge.endOfRound({ status: "active", roundsLeft: c.resolve });
  return { to: r.challenge.roundsLeft, failed: r.failed, effects: due };
}
/** "Run the consequence" on the time-is-up card. -> { ward: { rating, time, dice, resets } | null, manual: [effect kinds for the GM] } */
export const failKinds = (cfg) => (cfg?.effects ?? []).filter((e) => e.when === "onFail").map((e) => e.kind);
export function failRun(c, cfg) {
  const kinds = (cfg?.effects ?? []).filter((e) => e.when === "onFail").map((e) => e.kind);
  if (kinds.includes("wardReset") && c) {                                                        // [B2876]: back to 8, the clock starts again, a cumulative penalty
    const w = challenge.wardReset({ rating: c.health, timeLimit: c.maxResolve, roundsLeft: 0, status: "failed", resets: cfg.resets ?? 0, dice: cfg.dice ?? 0, ward: cfg.ward });
    return { ward: { rating: w.rating, time: w.roundsLeft, dice: w.dice, resets: w.resets }, manual: kinds.filter((k) => k !== "wardReset") };
  }
  return { ward: null, manual: kinds };
}
