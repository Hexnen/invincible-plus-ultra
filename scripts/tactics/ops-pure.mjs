/* Tactical combat (package P1): the REDUCER of the P1 operations and the round / turn driver (spec sections 3, 4.4, 6.1, 6.8, 12.2, 14.2).
   Pure ES module: NO Foundry globals; randomness only through ctx.rng. Node-tested by check-ops.mjs.
   reduce(state, action, ctx) -> { ok, changed, state, events, effects } | { ok:false, changed:false, error:{ key, code, params } }
     ctx = { user, staff, owns(combatantId), parts:[Participant], rng, playersEnd?, sceneFacts?, hold? }
       hold: the caller runs due triggers as action instances (director-pure.mjs): after a blocking trigger queue (round start, round end)
             the round waits in `sched.hold` until the caller sends `resume`; without it (the reducer alone) the round goes straight on
     Participant = { id, hero, owners:[userId], defeated, challenge, summonOf, veteran, reflexes, resolve }   (read live by the executor)
     events  = what happened, for the hooks of spec 16 (the executor adds combat, seq, at)
     effects = requests to the executor: { type:"stress", combatant, n, source } | { type:"recover", lines } | { type:"trigger", trigger }
               | { type:"roundEnd", round } | { type:"abortInstances", actor }
   The executor is the only caller that writes (spec 1.1); a player's request arrives here re-validated from scratch.
   The operations of the action engine (declare, amend, cancel, help, move, askException, other and the overrides of spec 14.1) are not
   known here and answer `unknown`: director-pure.mjs sends each request to this reducer or to engine-pure.mjs.
   Citation marks as in dev/combat-spec.md 0.1. */
import * as S from "./state-pure.mjs";
import * as Lg from "./ledger-pure.mjs";
import * as I from "./initiative-pure.mjs";
import * as Sch from "./scheduler-pure.mjs";

export const PROTO = 1;
/* what a player may send in P1 (spec 12.2 rows endTurn, holdOff, answer) plus `mark`, the manual action mark that replaces the old tray
   toggle until the action engine declares actions [D] */
export const PLAYER_OPS = new Set(["endTurn", "holdOff", "answer", "mark"]);
/* prompt kinds answered by this package; any other kind belongs to the action engine (P2) */
export const P1_PROMPTS = new Set(["veteran", "reflexes", "triggerQueue", "grantConsent", "challengeFail"]);
export const RATE = [90, 60000], MAX_INFLIGHT = 3, MAX_BYTES = 4096, TEXT_MAX = 300;            // spec 12.1 limits for non-staff

const err = S.err;
const NO_RNG = () => { throw new Error("ctx.rng is missing"); };      // this file never rolls by itself
const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);

/* ------------------------------------------------------------------ small reads (also used by the API) */
/* the combatants that have the turn: the member whose turn it is and everything that acts on its turn [I14] [B1808], [B1637] */
export function onTurnIds(state) {
  const m = state?.phase === "turns" ? state.init.curMember : null;
  if (!m) return [];
  const out = [m];
  for (const su of state.summons ?? []) if (su?.owner === m && Array.isArray(su.combatants)) out.push(...su.combatants.filter((x) => typeof x === "string"));
  return out;
}
export const isOnTurn = (state, id) => onTurnIds(state).includes(id);
/* nobody has the turn yet: the round's cards are still being dealt (or a blocking queue is open) */
export const isWaiting = (state) => !!state && (state.phase === "draw" || state.phase === "roundStart" || state.phase === "roundEnd");
export const isFreeFor = (state, id) => state.mode !== "tactical" || !!state.free[id];
export const openPromptsAbout = (state, id) => Object.values(state.prompts).filter((p) => !p.answered && p.about === id);
export function orderOf(state) {
  return (state?.init.slots ?? []).map((s) => ({ slot: s.id, card: s.card, members: s.members.slice(), state: s.state, done: s.done.slice(), heldOff: !!s.heldOff, extra: s.extra ?? null, current: state.init.cur === s.id }));
}
export function budgetOf(state, id) {
  const L = state?.ledger?.[id];
  if (!L) return null;
  const b = Lg.budget(L);
  return { ...b, onTurn: isOnTurn(state, id), free: isFreeFor(state, id) };
}
/* What a combatant can do in P1 terms, each with its legality and reason (spec 18 `options`; the catalog entries come with P2 / P6). */
export function optionsOf(state, id, { resolve } = {}) {
  const L = state?.ledger?.[id];
  if (!state || !L) return [];
  const onTurn = isOnTurn(state, id), mine = state.init.curMember === id, turnOf = state.init.curMember;
  const tell = (r) => (r.ok ? { ok: true } : { ok: false, reason: r.reason, gmMayAllow: !!r.gmMayAllow });
  const out = [
    { id: "full", cost: "full", ...tell(Lg.canPay(L, { cost: "full", onTurn, turnOf, resolve })) },
    { id: "quick", cost: "quick", ...tell(Lg.canPay(L, { cost: "quick", onTurn, interrupt: !onTurn, turnOf, resolve })) },
    { id: "endTurn", cost: "none", ...(mine ? (state.mode === "tactical" && !state.free[id] && openPromptsAbout(state, id).length ? { ok: false, reason: "busy" } : { ok: true }) : { ok: false, reason: "notYourTurn" }) }
  ];
  const targets = mine ? I.holdOffTargets(state.init, state.init.cur) : [];
  out.push({ id: "holdOff", cost: "none", ok: targets.length > 0, ...(targets.length ? { targets } : { reason: mine ? "noTarget" : "notYourTurn" }) });
  return out;
}

/* ------------------------------------------------------------------ transport helpers (pure parts of the relay, spec 12.1) */
export const ownsFrom = (ownership, userId, level = 3) => !!ownership && typeof ownership === "object" && Number(ownership[userId] ?? ownership.default ?? 0) >= level;
/** sliding-window counter: false when `key` already made `max` hits within `windowMs` */
export function rateHit(map, key, now, max = RATE[0], windowMs = RATE[1]) {
  const list = (map.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) { map.set(key, list); return false; }
  list.push(now); map.set(key, list);
  return true;
}
export const makeRid = (senderId, id) => `${String(senderId).slice(0, 40)}:${String(id).slice(0, 40)}`;

const idList = (v, max = 60) => (Array.isArray(v) ? [...new Set(v.filter(S.isId))].slice(0, max) : undefined);
const text = (v) => (typeof v === "string" ? v.slice(0, TEXT_MAX) : undefined);
/** Whitelist a request: only known operations, only their fields, ids by pattern, text clamped. -> { ok, action } | error envelope */
export function normalize(req, { staff = false } = {}) {
  if (!isObj(req) || typeof req.op !== "string") return err("badInput");
  const op = req.op;
  if (!OPS[op]) return err("unknown", { op: op.slice(0, 40) });
  if (!staff && !PLAYER_OPS.has(op)) return err("notOwner");
  const a = { type: op };
  const need = (k, v) => { if (v === undefined || v === null) throw new Error(k); a[k] = v; };
  const id = (v) => (S.isId(v) ? v : undefined);
  try {
    switch (op) {
      case "endTurn": need("actor", id(req.actor)); if (Number.isFinite(Number(req.round))) a.round = Math.trunc(Number(req.round)); if (id(req.slot)) a.slot = req.slot; if (staff && req.force) a.force = true; break;
      case "holdOff": need("actor", id(req.actor)); need("with", id(req.with)); if (staff && req.force === true) a.force = true; break;
      case "mark": need("actor", id(req.actor)); need("unit", ["full", "quick"].includes(req.unit) ? req.unit : undefined); a.on = req.on !== false; break;
      case "answer": {
        need("prompt", id(req.prompt));
        const v = req.value;
        if (typeof v === "string" || typeof v === "number") a.value = typeof v === "string" ? v.slice(0, TEXT_MAX) : v;
        else if (isObj(v)) a.value = { order: idList(v.order, 400) ?? [], skip: idList(v.skip, 400) ?? [] };
        else throw new Error("value");
        break;
      }
      case "start": a.mode = S.MODES.includes(req.mode) ? req.mode : undefined; a.kind = S.KINDS.includes(req.kind) ? req.kind : undefined; a.surprised = idList(req.surprised, 400) ?? [];
        a.groups = Array.isArray(req.groups) ? req.groups.slice(0, 100).map((g) => idList(g) ?? []).filter((g) => g.length > 1) : []; a.opts = isObj(req.opts) ? S.plain(req.opts) : {}; a.restart = req.restart === true; break;
      case "stop": case "roster": case "resume": break;
      case "nextTurn": case "nextRound": case "prevTurn": if (staff && req.force === true) a.force = true; break;
      case "setCard": need("slot", id(req.slot)); need("card", Number.isInteger(req.card) ? req.card : undefined); a.swap = req.swap === true; break;
      case "swapCards": need("a", id(req.a)); need("b", id(req.b)); break;
      case "group": need("members", idList(req.members)); break;
      case "ungroup": need("member", id(req.member)); break;
      case "reorderGroup": need("slot", id(req.slot)); need("members", idList(req.members)); break;
      case "insertTurn": need("combatant", id(req.combatant)); a.kind = req.kind === "mindControl" ? "mindControl" : "gm"; if (id(req.by)) a.by = req.by; break;
      case "ledgerEdit": need("combatant", id(req.combatant)); need("edit", ["grant", "revoke", "void", "entry", "loseTurn", "clearLostTurn", "noFull", "clearNoFull", "consent"].includes(req.edit) ? req.edit : undefined);
        if (isObj(req.grant)) a.grant = S.plain(req.grant); else if (id(req.grant)) a.grant = req.grant;
        if (id(req.entry)) a.entry = req.entry;
        if (["full", "quick"].includes(req.cost)) a.cost = req.cost;
        if (text(req.action)) a.action = req.action.slice(0, 60);
        if (Array.isArray(req.tags)) a.tags = req.tags.filter((x) => typeof x === "string").map((x) => x.slice(0, 40)).slice(0, 24);
        if (req.yes !== undefined) a.yes = req.yes === true;
        if (req.source !== undefined) a.source = S.plain(req.source);
        break;
      case "triggerAdd": need("trigger", isObj(req.trigger) ? S.plain(req.trigger) : undefined); break;
      case "triggerRemove": need("id", id(req.id)); break;
      case "setMode": need("mode", S.MODES.includes(req.mode) ? req.mode : undefined); break;
      case "setFree": if (id(req.combatant)) a.combatant = req.combatant; a.on = req.on !== false; break;
      case "endScene": if (req.force === true) a.force = true; a.skip = idList(req.skip, 400) ?? []; a.order = idList(req.order, 400) ?? []; a.skipTriggers = idList(req.skipTriggers, 400) ?? []; break;
      case "challengeFail": need("challenge", id(req.challenge)); break;
      default: {
        const n = EXTRA_NORMALIZE[op];
        if (!n) return err("unknown", { op: op.slice(0, 40) });
        const r = n(req, { staff });
        if (!r || r.ok === false) return r ?? err("badInput");
        return { ok: true, action: { ...r.action, type: op } };
      }
    }
  } catch { return err("badInput"); }
  return { ok: true, action: a };
}

/* ------------------------------------------------------------------ the work context of one reduction */
const mkId = (W) => (prefix) => S.nextId(W.s, prefix);
const ev = (W, type, data = {}) => { W.events.push({ type, ...data }); };
const partOf = (W, id) => (W.ctx.parts ?? []).find((p) => p.id === id) ?? null;
const ledgerOf = (W, id) => (W.s.ledger[id] ??= Lg.newLedger(W.s.round));
const summonsOf = (W, owner) => (W.s.summons ?? []).filter((su) => su?.owner === owner).flatMap((su) => (Array.isArray(su.combatants) ? su.combatants : [])).filter(S.isId);
/* a prompt goes to the owners of the combatant it is about; an NPC's (nobody but staff owns it) goes to the GM desk */
const addressees = (W, combatantId) => { const o = partOf(W, combatantId)?.owners ?? []; return o.length ? { users: o.slice(0, 40) } : "gm"; };
function addPrompt(W, p) {
  const id = S.nextId(W.s, "p");
  W.s.prompts[id] = { id, inst: null, step: p.step ?? "", kind: p.kind, to: p.to ?? "gm", options: p.options ?? [], ...(p.about ? { about: p.about } : {}), ...(p.multi ? { multi: 1 } : {}), ...(p.data ? { data: p.data } : {}) };
  return id;
}
const publicOrder = (s) => s.init.slots.map((x) => ({ slot: x.id, card: x.card, members: x.members.slice() }));

/* Collect the triggers due at a scheduler point once per round and key, as a queue card for the GM (spec 6.1, 13.1 `triggerQueue`).
   -> true when nothing blocks (no blocking queue of this key is open). */
function queueOnce(W, point, key, blocks) {
  const s = W.s, k = `${s.round}:${key}`;
  if (!s.sched.done.includes(k)) {
    s.sched.done.push(k);
    let extra = [];                                               // what the map and the statuses make due by themselves (P5: burning zones and characters, vacuum; flows/hazards.mjs `derived`)
    try { extra = (W.ctx.derived?.(point, s) ?? []).filter((t) => t && S.isId(t.id) && t.at === point.at && typeof t.run?.type === "string"); } catch { extra = []; }
    const list = Sch.due([...s.triggers, ...extra], point);
    const info = (t) => ({ type: t.run.type, ...(t.subject?.zone ? { zone: t.subject.zone } : {}), ...(t.subject?.combatant ? { combatant: t.subject.combatant } : {}), ...(Number.isFinite(t.run.intensity) ? { intensity: t.run.intensity } : {}),
      ...(Array.isArray(t.run.targets) ? { targets: t.run.targets.slice(0, 24) } : {}), ...(t.derived ? { trigger: S.clone(t) } : {}) });
    if (list.length) addPrompt(W, { kind: "triggerQueue", step: point.at, to: "gm", about: point.combatant, multi: 1, options: list.map((t) => ({ id: t.id, label: String(t.source?.name || t.run.type).slice(0, 120), data: info(t) })), data: { at: point.at, key: k, blocks: blocks ? 1 : 0 } });
  }
  return !blocks || !Object.values(s.prompts).some((p) => p.kind === "triggerQueue" && !p.answered && p.data?.key === k);
}

/* round start, fixed part (spec 6.1): every ledger is new [L5] [B2293], then the draw [I1] [B2266] */
function startRound(W, round) {
  const s = W.s, parts = W.ctx.parts ?? [];
  s.round = round; s.phase = "draw"; s.sched = { done: [] };
  const live = new Set(parts.filter((p) => !p.challenge).map((p) => p.id));
  for (const id of Object.keys(s.ledger)) if (!live.has(id)) delete s.ledger[id];
  for (const id of live) s.ledger[id] = Lg.newLedger(round, s.ledger[id]);
  for (const k of Object.keys(s.counters ?? {})) if (k.startsWith("round:")) delete s.counters[k];                 // spec 6.4: per-round use counters
  for (const [pid, p] of Object.entries(s.prompts)) if (p.kind === "veteran" || p.kind === "reflexes") delete s.prompts[pid];
  const r = I.startDraw(s.init, round, parts, { redraw: s.opts.redraw, surprised: W.surprised ?? [], groups: W.groups ?? [], mkId: mkId(W) });
  s.init = r.init;
  if (r.ask.length) {
    const vet = [];
    for (const q of r.ask) vet.push(addPrompt(W, { kind: "veteran", step: "draw", to: addressees(W, q.member), about: q.member, data: { slot: q.slot, card: q.card },
      options: [{ id: "keep", label: "keep", stress: 1, data: { card: q.card } }, { id: "draw", label: "draw" }] }));     // [I7] [B2100]
    s.init.pendingDraw = { veteran: vet, reflexes: [] };
  }
}

function openTurn(W, nx) {
  const s = W.s;
  s.init = I.openMember(s.init, nx.slot, nx.member);
  const slot = I.slotById(s.init, nx.slot);
  const r = Lg.turnStart(ledgerOf(W, nx.member), { extra: slot?.extra ? slot.id : null });
  s.ledger[nx.member] = r.ledger;
  if (r.lost) {                                                                                                  // [L7] [B2436], [B2517], [R10]
    ev(W, "turnLost", { slot: nx.slot, combatant: nx.member });
    s.init = I.memberDone(s.init, nx.member, { lost: true });
    return;
  }
  for (const m of summonsOf(W, nx.member)) s.ledger[m] = Lg.turnStart(ledgerOf(W, m)).ledger;                    // [I14]
  /* Not for a turn that had already begun and was handed on by holding off, and not for an extra turn (hole, reported: the book does
     not say whether turn-start effects and "until your next turn" apply to a commanded turn [B1761]). */
  if (!r.resumed && !r.extra) {
    const moment = { at: "nextTurnOf", who: nx.member };                                                         // "until your next turn" ends here [B1634], [B1772]
    s.triggers = Sch.expire(s.triggers, moment).keep;
    s.tokens = Sch.expire(s.tokens, moment).keep;
    endEffects(W, moment);
    queueOnce(W, { at: "turnStart", combatant: nx.member }, `ts:${nx.member}`, false);
  }
  ev(W, "turnStart", { slot: nx.slot, combatant: nx.member, ...(r.resumed ? { resumed: true } : {}) });
}

function closeTurn(W, member) {
  const s = W.s, slotId = s.init.cur;
  s.ledger[member] = Lg.turnEnd(ledgerOf(W, member));
  for (const m of summonsOf(W, member)) s.ledger[m] = Lg.turnEnd(ledgerOf(W, m));
  for (const id of Object.keys(s.ledger)) s.ledger[id] = Lg.expireTurnOf(s.ledger[id], member);                  // [B1708]
  s.tokens = (s.tokens ?? []).filter((t) => !(t?.expires?.at === "turnEndOf" && t.expires.who === member));     // spec 6.2 expiry "turnEndOf"
  endEffects(W, { at: "turnEndOf", who: member });
  queueOnce(W, { at: "turnEnd", combatant: member }, `te:${member}:${slotId}`, false);
  ev(W, "turnEnd", { slot: slotId, combatant: member });
  s.init = I.memberDone(s.init, member);
}

/* Ongoing effects that end at a scheduler point (spec 6.5) take along what they registered: their tokens, triggers and statuses. */
function endEffects(W, point) {
  const r = Sch.endEffects(W.s, point);
  if (!r.ended.length) return;
  Object.assign(W.s, r.state);
  for (const e of r.ended) ev(W, "effectEnd", { effect: { id: e.id, kind: e.kind, source: e.source, holder: e.holder, zones: e.zones } });
}

/* run the automatic part of the round until a human is needed (spec 4.4) */
function run(W) {
  const s = W.s, parts = W.ctx.parts ?? [];
  if (s.sched.hold) return;                                       // the engine is running the triggers of a blocking queue (ctx.hold)
  let rounds = 0;
  for (let guard = 0; guard < 2000; guard++) {
    if (s.phase === "draw") {
      if (s.init.draw) {
        const r = I.continueDraw(s.init, parts, W.ctx.rng);
        s.init = r.init;
        for (const d of r.dealt) ev(W, "draw", d);
        if (!r.done) {
          if (r.ask.length) {
            const q = r.ask[0];
            const pid = addPrompt(W, { kind: "reflexes", step: "draw", to: addressees(W, q.member), about: q.member, data: { slot: q.slot }, options: q.cards.map((c) => ({ id: String(c), label: String(c) })) });   // [I6] [B2112]
            s.init.draw.wait.prompt = pid;
            s.init.pendingDraw = { veteran: [], reflexes: [pid] };
          }
          return;
        }
      }
      delete s.init.pendingDraw;
      ev(W, "roundStart", { order: publicOrder(s) });
      s.phase = "roundStart";
    } else if (s.phase === "roundStart") {
      if (!queueOnce(W, { at: "roundStart" }, "rs", true)) return;
      s.phase = "turns";
    } else if (s.phase === "turns") {
      if (s.init.curMember) return;
      if (!s.init.slots.length) return;                           // nobody to act: the round waits for combatants
      const nx = I.nextUp(s.init);
      if (!nx) { s.phase = "roundEnd"; continue; }
      openTurn(W, nx);
    } else if (s.phase === "roundEnd") {
      if (!queueOnce(W, { at: "roundEnd" }, "re", true)) return;
      s.triggers = Sch.expire(s.triggers, { at: "roundEnd" }).keep;
      s.tokens = Sch.expire(s.tokens, { at: "roundEnd" }).keep;
      endEffects(W, { at: "roundEnd" });
      ev(W, "roundEnd", { order: publicOrder(s) });
      W.effects.push({ type: "roundEnd", round: s.round });      // the challenge clock runs down here [R22] (executor)
      if (++rounds > 2) { s.phase = "turns"; return; }           // a round in which nobody could act, twice in a row: stop instead of spinning
      W.surprised = []; W.groups = [];
      startRound(W, s.round + 1);
    } else return;
  }
}

/* after a GM edit of the order: the member who had the turn and lost the pointer keeps the turn it began (it resumes like after holding off) */
function afterEdit(W, before) {
  const s = W.s;
  if (before && s.init.curMember !== before && s.ledger[before]?.open) s.ledger[before] = Lg.turnSuspend(s.ledger[before]);
  run(W);
}
/* the cards cannot be edited while they are being dealt */
const dealing = (W) => W.s.phase === "draw";

const reasonCode = (reason) => (reason === "notYourTurn" || reason === "fullOnTurn" ? "notYourTurn" : "noAction");

/* ------------------------------------------------------------------ operations */
const OPS = {
  start(W, a) {
    if (W.s && W.s.round > 0 && W.s.phase !== "sceneEnd" && !a.restart) return err("busy");
    W.s = S.newState({ mode: a.mode ?? "free", kind: a.kind ?? "combat", opts: { ...(a.opts ?? {}) } });
    W.surprised = a.surprised ?? []; W.groups = a.groups ?? [];
    ev(W, "combatStart", { mode: W.s.mode, kind: W.s.kind });
    startRound(W, 1);
    run(W);
  },
  stop(W) { ev(W, "combatEnd", { mode: W.s.mode, kind: W.s.kind }); W.s = null; },

  endTurn(W, a) {
    const s = W.s;
    if (s.phase !== "turns" || !a.actor || s.init.curMember !== a.actor) return err("notYourTurn");
    if (!W.ctx.staff) {
      if (!W.ctx.owns?.(a.actor)) return err("notOwner");
      if (W.ctx.playersEnd === false) return err("playersOff");
    }
    if ((a.round !== undefined && a.round !== s.round) || (a.slot && a.slot !== s.init.cur)) return err("stale");
    if (s.mode === "tactical" && !s.free[a.actor] && !a.force && openPromptsAbout(s, a.actor).length) return err("busy");   // spec 4.4, 12.2
    closeTurn(W, a.actor);
    run(W);
  },
  nextTurn(W) {
    const s = W.s;
    if (s.phase !== "turns") return err("busy");
    if (s.init.curMember) closeTurn(W, s.init.curMember);
    run(W);
  },
  nextRound(W) {
    const s = W.s;
    if (s.phase !== "turns") return err("busy");
    if (s.init.curMember) closeTurn(W, s.init.curMember);
    s.init = I.closeRound(s.init);
    run(W);
  },
  prevTurn(W) {
    const s = W.s;
    if (s.phase !== "turns") return err("busy");
    const r = I.stepBack(s.init);
    if (!r.ok) return err("noPrev");
    if (r.suspended) s.ledger[r.suspended] = Lg.turnSuspend(ledgerOf(W, r.suspended));
    s.init = r.init;
    s.ledger[r.member] = Lg.turnReopen(ledgerOf(W, r.member));
    ev(W, "turnStart", { slot: s.init.cur, combatant: r.member, back: true });
  },
  /* [I8] [I9] [B2281-2283] */
  holdOff(W, a) {
    const s = W.s;
    if (s.phase !== "turns" || s.init.curMember !== a.actor) return err("notYourTurn");
    if (!W.ctx.staff && !W.ctx.owns?.(a.actor)) return err("notOwner");
    const from = s.init.cur;
    const r = I.holdOff(s.init, from, a.with);
    if (!r.ok) return err("illegal", { reason: "holdOff" });
    s.ledger[a.actor] = Lg.turnSuspend(ledgerOf(W, a.actor));                       // the turn did not happen yet [B2282]; spent interrupts stay spent [B2283]
    for (const m of summonsOf(W, a.actor)) s.ledger[m] = Lg.turnSuspend(ledgerOf(W, m));
    s.init = r.init;
    for (const sid of [from, a.with]) { const sl = I.slotById(s.init, sid); ev(W, "draw", { slot: sid, card: sl.card, members: sl.members.slice(), reason: "swap" }); }
    run(W);
  },
  /* the manual action mark [D]: the player (or the GM) ticks a full or a quick action as used, or frees it again. In tactical mode a
     player's mark obeys L1-L7; in free mode and for staff only "is a unit left" is checked (spec 1.4, 14.5). */
  mark(W, a) {
    const s = W.s, L = s.ledger[a.actor];
    if (!L) return err("gone");
    if (!W.ctx.staff && !W.ctx.owns?.(a.actor)) return err("notOwner");
    if (s.phase !== "turns") return err("busy");
    const onTurn = isOnTurn(s, a.actor), force = W.ctx.staff || isFreeFor(s, a.actor);
    if (a.on !== false) {
      const r = Lg.pay(L, { cost: a.unit, onTurn, interrupt: !onTurn, turnOf: s.init.curMember ?? undefined, force, resolve: partOf(W, a.actor)?.resolve }, { action: "manual", tags: ["manual"], slot: s.init.cur ?? undefined });
      if (!r.ok) return err(reasonCode(r.reason), { reason: r.reason });
      s.ledger[a.actor] = r.ledger;
      ev(W, "ledger", { combatant: a.actor, unit: a.unit, on: true, entry: r.entry.id });
    } else {
      const e = [...L.entries].reverse().find((x) => !x.void && x.cost === a.unit && (x.action === "manual" || W.ctx.staff));
      if (!e) return err("noAction", { reason: "nothingToUnmark" });
      s.ledger[a.actor] = Lg.voidEntry(L, e.id).ledger;
      ev(W, "ledger", { combatant: a.actor, unit: a.unit, on: false, entry: e.id });
    }
  },

  answer(W, a) {
    const s = W.s, p = s.prompts[a.prompt];
    if (!p || p.answered) return err("gone");
    if (!P1_PROMPTS.has(p.kind)) { const h = EXTRA_ANSWER[p.kind]; return h ? h(W, a, p) : err("unknown", { kind: p.kind }); }
    const mine = p.to !== "gm" && (p.to.users.includes(W.ctx.user) || (!!p.about && !!W.ctx.owns?.(p.about)));
    if (!W.ctx.staff && !mine) return err("notOwner");
    const drop = () => { delete s.prompts[p.id]; };
    switch (p.kind) {
      case "veteran": {
        if (a.value !== "keep" && a.value !== "draw") return err("badInput");
        const r = I.answerVeteran(s.init, p.data?.slot, a.value === "keep");
        if (!r.ok) { drop(); return err("gone"); }
        s.init = r.init;
        if (r.kept) W.effects.push({ type: "stress", combatant: r.member, n: 1, source: "combatVeteran" });      // [I7] [B2100]
        if (s.init.pendingDraw) s.init.pendingDraw.veteran = s.init.pendingDraw.veteran.filter((x) => x !== p.id);
        drop(); break;
      }
      case "reflexes": {
        const r = I.answerReflexes(s.init, p.data?.slot, Number(a.value), W.ctx.rng);
        if (!r.ok) return err(r.reason === "badInput" ? "badInput" : "gone");
        s.init = r.init;
        for (const d of r.dealt) ev(W, "draw", d);
        drop(); break;
      }
      case "triggerQueue": {
        const ids = p.options.map((o) => o.id), v = isObj(a.value) ? a.value : {};
        const skip = new Set(v.skip ?? []);
        const order = [...(v.order ?? []).filter((x) => ids.includes(x)), ...ids.filter((x) => !(v.order ?? []).includes(x))];
        let ran = 0;
        for (const id of order) {
          const t = s.triggers.find((x) => x.id === id) ?? p.options.find((o) => o.id === id)?.data?.trigger ?? null;       // a derived trigger rides in its option
          if (!t || skip.has(id)) continue;
          ev(W, "trigger", { at: t.at, subject: t.subject, run: t.run, source: t.source });
          W.effects.push({ type: "trigger", trigger: S.clone(t) });
          s.triggers = Sch.ran(s.triggers, id);
          ran++;
        }
        if (W.ctx.hold && ran && p.data?.blocks) s.sched.hold = String(p.data.key ?? p.id);      // the round goes on when the caller sends `resume`
        drop(); break;
      }
      case "grantConsent": {
        if (a.value !== "yes" && a.value !== "no") return err("badInput");
        const who = p.data?.combatant, L = s.ledger[who];
        const r = L ? Lg.setConsent(L, p.data?.grant, a.value === "yes") : { ok: false };
        if (r.ok) s.ledger[who] = r.ledger;
        drop(); break;
      }
      case "challengeFail": ev(W, "challenge", { challenge: p.about, state: "failed", choice: String(a.value ?? "") }); drop(); break;
      default: return err("unknown");
    }
    run(W);
  },

  setCard(W, a) {
    if (dealing(W)) return err("busy");
    const before = W.s.init.curMember, r = I.setCard(W.s.init, a.slot, a.card, { swap: a.swap });
    if (!r.ok) return err(r.reason === "cardTaken" ? "illegal" : r.reason, { reason: r.reason });
    W.s.init = r.init;
    const sl = I.slotById(r.init, a.slot); ev(W, "draw", { slot: a.slot, card: sl.card, members: sl.members.slice(), reason: "gm" });
    afterEdit(W, before);
  },
  swapCards(W, a) {
    if (dealing(W)) return err("busy");
    const before = W.s.init.curMember, r = I.swapCards(W.s.init, a.a, a.b);
    if (!r.ok) return err("gone");
    W.s.init = r.init;
    for (const sid of [a.a, a.b]) { const sl = I.slotById(r.init, sid); ev(W, "draw", { slot: sid, card: sl.card, members: sl.members.slice(), reason: "gm" }); }
    afterEdit(W, before);
  },
  group(W, a) { if (dealing(W)) return err("busy"); const before = W.s.init.curMember, r = I.group(W.s.init, a.members); if (!r.ok) return err(r.reason); W.s.init = r.init; afterEdit(W, before); },
  ungroup(W, a) { if (dealing(W)) return err("busy"); const before = W.s.init.curMember, r = I.ungroup(W.s.init, a.member, mkId(W)); if (!r.ok) return err(r.reason); W.s.init = r.init; afterEdit(W, before); },
  reorderGroup(W, a) { const r = I.reorderGroup(W.s.init, a.slot, a.members); if (!r.ok) return err(r.reason); W.s.init = r.init; },
  /* an extra turn with its own fresh budget (spec 3.2, 4.4; Mind Control [B1761] or the GM) */
  insertTurn(W, a) {
    const s = W.s;
    if (!partOf(W, a.combatant)) return err("gone");
    if (s.phase !== "turns") return err("busy");
    const r = I.insertTurn(s.init, a, mkId(W));
    s.init = r.init;
    s.ledger[a.combatant] = Lg.addTurnPair(ledgerOf(W, a.combatant), r.slot, a.kind ?? "gm", a.by ?? null);
    run(W);
  },
  /* joining and leaving (spec 3.3): bring the state in line with the combatants that exist now */
  roster(W) {
    const s = W.s, parts = W.ctx.parts ?? [];
    const before = JSON.stringify([s.init, Object.keys(s.ledger)]);
    const ids = new Set(parts.map((p) => p.id));
    const known = new Set([...Object.keys(s.ledger), ...s.init.slots.flatMap((x) => x.members)]);
    for (const id of known) if (!ids.has(id)) removeOne(W, id);
    if (s.round >= 1 && s.phase !== "idle" && s.phase !== "sceneEnd") {
      for (const p of parts) {
        if (p.challenge) continue;
        if (!s.ledger[p.id]) s.ledger[p.id] = Lg.newLedger(s.round);
        if (!I.eligible(p) || I.slotOf(s.init, p.id)) continue;
        const r = I.addCombatant(s.init, p.id, mkId(W));                              // [A-1]
        s.init = r.init;
        if (r.changed && r.card !== null) ev(W, "draw", { slot: r.slot, card: r.card, members: [p.id], reason: "join" });
      }
    }
    if (before === JSON.stringify([s.init, Object.keys(s.ledger)])) return { changed: false };
    run(W);
  },
  ledgerEdit(W, a) {
    const r = ledgerEditOf(W.s, a);
    if (!r.ok) return err(r.code, r.params);
    W.s.ledger[a.combatant] = r.ledger;
    if (r.consent) addPrompt(W, { kind: "grantConsent", step: "grant", to: addressees(W, a.combatant), about: a.combatant, data: { combatant: a.combatant, grant: r.consent.id, kind: r.consent.kind, from: r.consent.from ?? null },
      options: [{ id: "yes", label: "yes" }, { id: "no", label: "no" }] });       // [plan 5.3], [B1708]
  },
  triggerAdd(W, a) {
    const t = S.sanitizeTrigger({ ...a.trigger, id: S.nextId(W.s, "t"), runs: 0 });
    if (!t) return err("badInput");
    W.s.triggers.push(t);
  },
  triggerRemove(W, a) {
    const n = W.s.triggers.length;
    W.s.triggers = W.s.triggers.filter((t) => t.id !== a.id);
    if (W.s.triggers.length === n) return err("gone");
    for (const p of Object.values(W.s.prompts)) if (p.kind === "triggerQueue") p.options = p.options.filter((o) => o.id !== a.id);
  },
  /* spec 1.4, 14.5: switching never discards state */
  setMode(W, a) { if (W.s.mode === a.mode) return { changed: false }; W.s.mode = a.mode; ev(W, "mode", { mode: a.mode }); },
  setFree(W, a) {
    const s = W.s, ids = a.combatant ? [a.combatant] : s.init.slots.flatMap((x) => x.members);
    for (const id of ids) { if (a.on) s.free[id] = 1; else delete s.free[id]; }
  },
  /* the engine finished the trigger instances of a blocking queue (ctx.hold): the round goes on */
  resume(W) { if (!W.s.sched.hold) return { changed: false }; delete W.s.sched.hold; run(W); },
  /* the end-of-scene procedure (spec 6.8), run by the GM as one confirmed queue */
  endScene(W, a) {
    const s = W.s;
    const skip = new Set(a.skip ?? []);
    const lines = Sch.sceneEndPlan(W.ctx.sceneFacts ?? []).filter((l) => !skip.has(l.id));
    const dueList = Sch.due(s.triggers, { at: "sceneEnd" });
    const ids = dueList.map((t) => t.id), skipT = new Set(a.skipTriggers ?? []);
    for (const id of [...(a.order ?? []).filter((x) => ids.includes(x)), ...ids.filter((x) => !(a.order ?? []).includes(x))]) {
      const t = dueList.find((x) => x.id === id);
      if (!t || skipT.has(id)) continue;
      ev(W, "trigger", { at: t.at, subject: t.subject, run: t.run, source: t.source });
      W.effects.push({ type: "trigger", trigger: S.clone(t) });
    }
    const c = Sch.sceneEndCleanup(s);
    s.triggers = c.triggers; s.tokens = c.tokens; s.effects = c.effects; s.counters = c.counters; s.statuses = c.statuses;
    delete s.sched.hold;
    for (const e of c.ended) ev(W, "effectEnd", { effect: { id: e.id, kind: e.kind, source: e.source, holder: e.holder, zones: e.zones } });
    if (s.init.curMember) s.ledger[s.init.curMember] = Lg.turnEnd(ledgerOf(W, s.init.curMember));
    for (const sl of s.init.slots) if (sl.state === "active") sl.state = "done";
    s.init.cur = null; s.init.curMember = null; delete s.init.draw; delete s.init.pendingDraw;
    for (const [pid, p] of Object.entries(s.prompts)) if (P1_PROMPTS.has(p.kind)) delete s.prompts[pid];
    s.phase = "sceneEnd";
    if (lines.length) W.effects.push({ type: "recover", lines });
    ev(W, "sceneEnd", { mode: s.mode, kind: s.kind, recovered: lines.map((l) => l.id), karma: S.clone(s.karma ?? []) });
  },
  /* a time limit ran out: the GM's card (spec 13.1 `challengeFail`, [B2841]); the consequence is the challenge's own text, run by the GM */
  challengeFail(W, a) {
    const s = W.s;
    if (Object.values(s.prompts).some((p) => p.kind === "challengeFail" && p.about === a.challenge && !p.answered)) return { changed: false };
    addPrompt(W, { kind: "challengeFail", step: "roundEnd", to: "gm", about: a.challenge, options: [{ id: "run", label: "run" }, { id: "other", label: "other" }] });
    ev(W, "challenge", { challenge: a.challenge, state: "failed" });
  }
};

/** One GM edit of a ledger (spec 14.2 `ledgerEdit`), without writing: used by the reducer's operation above and by the engine's journaled
    edit (engine-pure.mjs gmEdit). a = { combatant, edit, grant?, entry?, cost?, action?, tags?, yes?, source? }
    -> { ok, ledger, consent?: Grant (a grant that now waits for its receiver's consent) } | { ok:false, code, params } */
export function ledgerEditOf(state, a) {
  const L = state?.ledger?.[a?.combatant];
  if (!L) return { ok: false, code: "gone", params: {} };
  let r = null;
  switch (a.edit) {
    case "grant": {
      const g = isObj(a.grant) ? (a.grant.template ? { ...Lg.grantTemplate(a.grant.template, a.grant), ...(a.grant.source ? { source: a.grant.source } : {}) } : a.grant) : null;
      if (!g || !g.unit) return { ok: false, code: "badInput", params: {} };
      r = Lg.addGrant(L, g, a.combatant);
      if (!r.ok) return { ok: false, code: "illegal", params: { reason: r.reason } };
      return { ok: true, ledger: r.ledger, ...(r.grant.needsConsent && r.grant.consent === "pending" ? { consent: r.grant } : {}) };
    }
    case "revoke": r = Lg.removeGrant(L, a.grant); break;
    case "consent": r = Lg.setConsent(L, a.grant, a.yes === true); break;
    case "void": r = Lg.voidEntry(L, a.entry); break;
    case "entry": r = Lg.pay(L, { cost: a.cost ?? "quick", onTurn: isOnTurn(state, a.combatant), force: true, grant: typeof a.grant === "string" ? a.grant : undefined }, { action: a.action ?? "gm", tags: a.tags ?? [], slot: state.init.cur ?? undefined }); break;
    case "loseTurn": r = { ok: true, ledger: Lg.loseNextTurn(L, a.source ?? null) }; break;      // [L7]
    case "clearLostTurn": r = { ok: true, ledger: Lg.clearLostTurn(L) }; break;
    case "noFull": r = { ok: true, ledger: Lg.loseFull(L, a.source ?? null) }; break;            // [L8]
    case "clearNoFull": r = { ok: true, ledger: Lg.clearNoFull(L) }; break;
    default: return { ok: false, code: "badInput", params: {} };
  }
  return r?.ok ? { ok: true, ledger: r.ledger } : { ok: false, code: "illegal", params: { reason: r?.reason ?? "ledger" } };
}

function removeOne(W, id) {
  const s = W.s;
  const r = I.removeCombatant(s.init, id);
  s.init = r.init;
  delete s.ledger[id]; delete s.free[id];
  for (const k of ["statuses", "npc", "revealed", "knowledge"]) if (s[k] && typeof s[k] === "object") delete s[k][id];
  for (const [pid, p] of Object.entries(s.prompts)) if (p.about === id) delete s.prompts[pid];
  if (s.init.pendingDraw) {
    const live = (x) => !!s.prompts[x];
    s.init.pendingDraw = { veteran: s.init.pendingDraw.veteran.filter(live), reflexes: s.init.pendingDraw.reflexes.filter(live) };
  }
  s.triggers = Sch.dropSubject(s.triggers, id);
  s.summons = (s.summons ?? []).filter((su) => su?.owner !== id).map((su) => (Array.isArray(su?.combatants) ? { ...su, combatants: su.combatants.filter((x) => x !== id) } : su));
  W.effects.push({ type: "abortInstances", actor: id });          // spec 3.3: its open action instances end through the engine's abort path (P2)
  ev(W, "combatantRemoved", { combatant: id });
}

/* ------------------------------------------------------------------ extension points for the action engine (P2) */
const EXTRA_NORMALIZE = {}, EXTRA_ANSWER = {};
/** registerOp("declare", { handler(W, action), normalize(req, { staff }) -> { ok, action }, player: true }) adds an operation;
    handler works on W = { s (a private copy of the state), ctx, events, effects } like the ones above and may return an error envelope
    or { changed:false }. helpers = { run, addPrompt, ev, ledgerOf, partOf, queueOnce, closeTurn, openTurn }. */
export function registerOp(name, { handler, normalize: n, player = false } = {}) {
  if (typeof name !== "string" || typeof handler !== "function" || OPS[name]) return false;
  OPS[name] = handler;
  if (typeof n === "function") EXTRA_NORMALIZE[name] = n;
  if (player) PLAYER_OPS.add(name);
  return true;
}
/** registerAnswer("reaction", (W, action, prompt) => ...) lets the engine answer its own prompt kinds through the same `answer` operation. */
export function registerAnswer(kind, fn) { if (typeof kind !== "string" || typeof fn !== "function" || P1_PROMPTS.has(kind) || EXTRA_ANSWER[kind]) return false; EXTRA_ANSWER[kind] = fn; return true; }
export const helpers = { run, addPrompt, ev, ledgerOf, partOf, queueOnce, closeTurn, openTurn, addressees, removeOne };

/* ------------------------------------------------------------------ reduce */
export function reduce(state0, action, ctx = {}) {
  try {
    if (!isObj(action) || typeof action.type !== "string") return err("badInput");
    if (state0 && S.hasSeen(state0, action.rid)) return { ok: true, changed: false, dup: true, state: state0 };
    const h = OPS[action.type];
    if (!h) return err("unknown", { op: action.type.slice(0, 40) });
    if (!ctx.staff && !PLAYER_OPS.has(action.type)) return err("notOwner");
    if (!state0 && action.type !== "start") return err("off");
    if (state0 && state0.mode === "off" && !["setMode", "stop", "start", "roster"].includes(action.type)) return err("off");       // spec 1.4: the engine is idle
    const W = { s: state0 ? S.clone(state0) : null, ctx: { rng: NO_RNG, ...ctx, parts: Array.isArray(ctx.parts) ? ctx.parts : [] }, events: [], effects: [] };
    const r = h(W, action);
    if (r && r.ok === false) return r;
    if (r && r.changed === false) return { ok: true, changed: false, state: state0 };
    if (!W.s) return { ok: true, changed: true, state: null, events: W.events, effects: W.effects };
    S.stamp(W.s, action.rid);
    const state = S.sanitize(W.s);
    return { ok: true, changed: true, state, events: W.events.map((e) => ({ ...e, round: state.round })), effects: W.effects };
  } catch (e) {
    return err("internal", { msg: String(e?.message ?? e).slice(0, 80) });
  }
}
