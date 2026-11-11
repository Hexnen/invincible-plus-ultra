/* Tactical combat, package P2: MODELS FOR THE TWO SURFACES (spec 12.2, 13), data only. NO Foundry globals (node-tested in check-desk.mjs).
   The look of the player action bar and of the GM desk is another task. This file gives that task everything as plain data:
     deskModel(state, log, ctx)        -> { cards, info, manual, journal, waiting }     for staff (from the full state)
     playerModel(view, viewer, ctx)    -> { prompts, mine, bars, waiting, journal }      for a player (from viewFor(...) ONLY, so it cannot leak)
   Every choice comes with the ready request (`req`) to hand to api.tactics.request(...). Labels are i18n keys (ITAC.*), never text.
     ctx = { c: (cid) -> { name, npc, owners } | null, online: (userId) -> bool, P1: the ledger interface (budget, canPay, isOnTurn) } */
import * as C from "./catalog-pure.mjs";
import { REVALIDATE_OPTIONS, FLOWS } from "./engine-pure.mjs";
import * as Init from "./initiative-pure.mjs";
import * as Lg from "./ledger-pure.mjs";
import { standing, conditions as condsOf } from "./mods-pure.mjs";
import { crits } from "../rules/index.mjs";
import { applies, attrChoices } from "./actions-pure.mjs";
import { pubLine } from "./view-pure.mjs";
/* ADDED FOR THE SURFACES (scripts/tactics/ui/; all additive, checked in check-ui.mjs):
     instance lines carry `steps` (the flow's step ids, for "back to step"), `attr` / `defense` of the catalog entry `outcomes`, and `defs` (the defences declared, with their dice in the GM's model);
     deskModel: `npcs` (standing reactions + what is revealed, with ready requests), `mode` + `modeReq`, `turn`;
     barModel: `holdOff` (the slots the turn can be swapped with), `markReq`, and per action `attr`, `defense`, `targetWho`, `kind`, `tags`
               (and `needsTarget` is also true for a non-attack entry that names a target, e.g. orders);
     playerModel: `turn`. */

const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
const nameOf = (ctx, cid) => (cid ? ctx.c?.(cid)?.name ?? cid : null);
const usersOf = (p) => (isObj(p.to) && Array.isArray(p.to.users) ? p.to.users : []);
const optReq = (p, o, op) => ({ op, prompt: p.id, value: o.data && isObj(o.data) && o.needs ? { id: o.id } : o.id });

/** GM desk card kinds this engine raises (spec 13.1 + the ones the spec has no row for; reported as holes): */
export const CARD_KINDS = Object.freeze(["reaction", "exception", "other", "direction", "stunt", "helpOverride", "revalidate", "npcBroken", "proxy",
  "gate", "tokenConfirm", "counter", "dodgeMove", "stunts", "moveStop", "moveApprove", "minionLoss", "minionsFate", "knockDir", "disarm",
  "outcome", "hazardDodge", "hazardStunts", "fireSpread", "vacuumDeath", "objective", "chaseCatch", "chaseOption", "minionsQuick"]);                    // P5: the GM's word on a narrative action, a dodge against a blast, the hazards' cards

function card(p, ctx, proxy = false) {
  return {
    id: p.id, kind: proxy ? "proxy" : p.kind, of: proxy ? p.kind : undefined, inst: p.inst, step: p.step, about: p.about ?? null, aboutName: nameOf(ctx, p.about),
    title: `ITAC.card.${proxy ? "proxy" : p.kind}`, multi: !!p.multi, min: p.min, max: p.max, free: !!p.free, data: p.data ?? {},
    absent: proxy ? usersOf(p) : undefined,
    options: (p.options ?? []).map((o) => ({ id: o.id, label: o.label ?? `ITAC.opt.${o.id}`, disabled: o.disabled ?? null, cost: o.cost, stress: o.stress, data: o.data, req: o.disabled ? null : optReq(p, o, "answerFor") })),
    always: p.kind === "reaction" && ctx.c?.(p.about)?.npc ? (p.options ?? []).filter((o) => !o.disabled).map((o) => ({ id: o.id, req: { op: "answerFor", prompt: p.id, value: { id: o.id, always: true } } })) : undefined,   // spec 13.1
    answerReq: (value) => ({ op: "answerFor", prompt: p.id, value }),
  };
}
const turnOf = (state, ctx) => ({ round: state.round ?? null, phase: state.phase ?? null, combatant: state.init?.curMember ?? null, name: nameOf(ctx, state.init?.curMember ?? null) });
const entryOf = (state, i) => { try { return state ? C.entryFor(state, i.actor, i.action) : null; } catch { return null; } };
const kitFacts = (ctx) => (typeof ctx.kit === "function" ? { c: (id) => ({ kit: ctx.kit(id) }) } : null);      // P6: the entries of a character's own sheet (only where this user may read it)
const instLine = (i, ctx, state = null) => ({ steps: (FLOWS[i.flow]?.STEPS ?? []).slice(), attr: entryOf(state, i)?.roll?.attr ?? null, defense: entryOf(state, i)?.defense ?? null,
  outcomes: Object.entries(i.data?.out ?? {}).map(([t, o]) => ({ target: t, name: nameOf(ctx, t), hit: o?.hit === true, net: o?.net ?? null })),
  defs: Object.entries(isObj(i.data?.def) ? i.data.def : {}).filter(([, x]) => isObj(x) && x.defence).map(([t, x]) => ({ target: t, defence: x.defence, dice: Number.isFinite(x.dice) ? x.dice : null })),      // the defences declared so far; `dice` only in the full state (a player's view carries the kind alone)
  failed: isObj(i.data?.failed) ? { step: String(i.data.failed.step ?? "").slice(0, 40) } : null, byHand: (i.data?.notes ?? []).some((n) => n?.note === "seatByHand") ? "seat" : null,      // D90 / D91: why it lies in the GM's hand (only in the full state: a player's view carries no such data)
  inst: i.id, action: i.action, label: i.data?.label ?? null, flow: i.flow, actor: i.actor, actorName: nameOf(ctx, i.actor), targets: (i.decl?.targets ?? []).map((t) => ({ id: t, name: nameOf(ctx, t) })), cause: i.cause, step: i.step, status: i.status, locked: !!i.locked, parent: i.parent, text: i.decl?.text });

/* U1 / U2: one roll of an action as a surface needs it to offer "roll", "accept" and "push" itself. `state`: "owed" (no dice yet),
   "push" (rolled, may still be pushed: the exchange waits for the roller's word), "done". The request id, the dice and the chat
   message are only in the row of somebody the roll was asked of (view-pure.rollView) and in the GM's. */
export const rollState = (r) => (r.forced != null ? "done" : r.sixes == null ? "owed" : r.pushable ? "push" : "done");
const rollRow = (i, r, ctx) => ({ inst: i.id, key: r.key, who: r.who, whoName: nameOf(ctx, r.who), attr: r.attr ?? null, dice: r.req?.dice ?? null, sixes: r.forced?.sixes ?? r.sixes ?? null, pushed: r.pushed ?? 0,
  state: rollState(r), waiting: r.sixes == null && r.forced == null, users: r.req?.users ?? [], rid: r.req?.rid ?? null, maxPush: r.req?.maxPush ?? null, label: r.req?.label ?? null, mode: r.req?.mode ?? null,
  messageId: r.messageId ?? null, action: i.action, actionLabel: i.data?.label ?? null, actor: i.actor ?? null });
/** Everything the GM desk shows. `log` is the journal flag. */
export function deskModel(state, log, ctx = {}) {
  if (!state) return { cards: [], info: [], manual: [], journal: [], waiting: [], npcs: [], mode: null, turn: null, karma: [], statuses: {} };
  const open = Object.values(state.prompts ?? {}).filter((p) => !p.answered);
  const cards = [];
  for (const p of open) {
    if (p.to === "gm") cards.push(card(p, ctx));
    else if (usersOf(p).length && ctx.online && !usersOf(p).some((u) => ctx.online(u))) cards.push(card(p, ctx, true));       // spec 13.1 `proxy` [D]
  }
  const info = [], manual = [];
  for (const i of state.stack ?? []) {
    const line = instLine(i, ctx, state);
    const cmds = [];
    if (i.status === "manual") { manual.push({ ...line, commands: [{ id: "resolve", label: "ITAC.cmd.resolve", needs: "result", req: (result) => ({ op: "manual", inst: i.id, result }) }, { id: "abort", label: "ITAC.cmd.abort", req: { op: "abort", inst: i.id, refund: true } }] }); continue; }
    if (!i.locked) cmds.push({ id: "veto", label: "ITAC.cmd.veto", req: { op: "abort", inst: i.id, refund: true } }, { id: "amend", label: "ITAC.cmd.amend", needs: "decl", req: (decl) => ({ op: "amend", inst: i.id, decl }) });   // spec 13.2
    cmds.push({ id: "override", label: "ITAC.cmd.override", ops: ["setPool", "setSixes", "setOutcome", "setDamage", "skipStep", "goToStep", "retarget", "abort", "manual"], req: (op, payload) => ({ op, inst: i.id, ...payload }) });
    cmds[cmds.length - 1].ops.push("askRoll");
    /* U1 / U4: per roll, what the GM can do about it from the desk: ask for the dice again, or take the result as it stands */
    info.push({ ...line, rolls: Object.values(i.rolls ?? {}).map((r) => { const row = rollRow(i, r, ctx);
      return { ...row, askReq: row.state === "owed" && r.req ? { op: "askRoll", inst: i.id, roll: r.key } : null, acceptReq: row.state === "push" ? { op: "setSixes", inst: i.id, roll: r.key, sixes: r.sixes, accept: true, pushed: r.pushed ?? 0 } : null      /* D48: tied to the result the button shows */ }; }), commands: cmds });
  }
  const list = log?.list ?? [];
  const journal = list.map((t, at) => ({ id: t.id, inst: t.inst, round: t.round, at: t.at, state: t.state, who: Object.keys(isObj(t.label?.who) ? t.label.who : {}), text: t.label?.gm ?? "", pub: pubLine(t.label, (cid) => ctx.c?.(cid)?.name),
    undo: t.state === "closed" && Array.isArray(t.ops) ? { req: { op: "undo", tx: t.id }, alsoUndoes: list.slice(at + 1).filter((x) => x.state === "closed").length,       // spec 15: LIFO
      force: { req: (drift) => ({ op: "undo", tx: t.id, force: true, ...(drift ? { drift } : {}) }), modes: ["restore", "difference", "leave"] } } : null })).reverse();
  /* spec 13.3 (standing reactions of an NPC) and spec 10 (what of an opponent the players have been shown) */
  const npcs = Object.keys(state.ledger ?? {}).filter((cid) => ctx.c?.(cid)?.npc).map((cid) => ({ id: cid, name: nameOf(ctx, cid), group: ctx.c?.(cid)?.kind === "minions",      // U61: a minion group can be settled quickly (policy.quick)
    policy: { block: "ask", dodge: "ask", onBroken: "ask", push: "rules", major: "no", ...(state.npc?.[cid] ?? {}) }, revealed: { stats: !!state.revealed?.[cid]?.stats, powers: !!state.revealed?.[cid]?.powers, health: !!state.revealed?.[cid]?.health },
    policyReq: (patch) => policyReq(state, cid, patch),
    revealReq: (patch) => ({ op: "reveal", combatant: cid, ...Object.fromEntries(Object.entries({ ...(state.revealed?.[cid] ?? {}), ...patch }).filter(([, v]) => v).map(([k]) => [k, true])) }) }));
  /* P5: the karma notes of the fight (spec 9.11) and the two requests of the hazard tool */
  const karma = (state.karma ?? []).map((k) => ({ id: k.id, who: k.who, whoName: nameOf(ctx, k.who), kind: k.kind, round: k.round ?? null, zone: k.zone ?? null, note: k.note ?? "", target: k.target ? nameOf(ctx, k.target) : null }));
  return { cards, info, manual, journal, waiting: waitingOn(state, { ...ctx, nudge: true }), npcs, mode: state.mode ?? null, modeReq: (mode) => ({ op: "setMode", mode }), kitReq: (combatant, item, key, value) => ({ op: "kitFlag", combatant, item, key, value }), summonReq: (combatant, owner) => ({ op: "summonSet", combatant, owner: owner || null }), turn: turnOf(state, ctx), karma,
    karmaReq: (note) => ({ op: "karmaNote", note }), hazardReq: (run, subject) => ({ op: "hazardRun", run, subject }), fireReq: (intensity, targets, inZone = true) => ({ op: "hazard", hazard: { kind: "fire", intensity, inZone }, targets }),
    statuses: state.statuses ?? {} };
}

/** the request that changes the GM's standing answers for one NPC (spec 13.3); U61: `quick` is on only while it is said */
export const policyReq = (state, cid, patch) => { const { quick, ...pol } = { ...(state?.npc?.[cid] ?? {}), ...patch }; return { op: "npcPolicy", combatant: cid, policy: { ...pol, ...(quick === true ? { quick: true } : {}) } }; };
/** Who the table is waiting for right now (both surfaces show it). U59: `at` = since when (the executor's clock, ms; absent in a
    state written before it was kept), `nudgeReq` = the GM's nudge of the ones waited for (only in the desk's model; the engine refuses it when none is at the table). */
export function waitingOn(state, ctx = {}) {
  const out = [];
  for (const p of Object.values(state?.prompts ?? {})) if (!p.answered) out.push({ what: "prompt", kind: p.kind, prompt: p.id, to: p.to === "gm" ? "gm" : usersOf(p), about: p.about ?? null, aboutName: nameOf(ctx, p.about), at: Number.isFinite(p.at) ? p.at : null, nudgeReq: ctx.nudge && p.to !== "gm" ? { op: "nudge", prompt: p.id } : null });
  /* U1: a roll that may still be pushed holds the exchange exactly like dice that were never thrown: the table waits for the roller */
  for (const i of state?.stack ?? []) for (const r of Object.values(i.rolls ?? {})) { const s = rollState(r); if (s !== "done" && r.req) out.push({ what: s === "push" ? "push" : "roll", key: r.key, inst: i.id, to: r.req.users ?? [], about: r.who, aboutName: nameOf(ctx, r.who), at: Number.isFinite(r.req.at) ? r.req.at : null, nudgeReq: ctx.nudge ? { op: "nudge", inst: i.id, roll: r.key } : null }); }
  return out;
}

/** A prompt as the addressee's panel needs it. */
function promptModel(p, ctx) {
  return { id: p.id, kind: p.kind, inst: p.inst, about: p.about ?? null, aboutName: nameOf(ctx, p.about), title: `ITAC.prompt.${p.kind}`, multi: !!p.multi, min: p.min, max: p.max, free: !!p.free, data: p.data ?? {},
    options: (p.options ?? []).map((o) => ({ id: o.id, label: o.label ?? `ITAC.opt.${o.id}`, disabled: o.disabled ?? null, cost: o.cost, stress: o.stress, data: o.data, req: o.disabled ? null : optReq(p, o, "answer") })),
    answerReq: (value) => ({ op: "answer", prompt: p.id, value }) };
}
/** U9: is the combatant out of action [B2707]? The statuses of the view say it (the engine marks broken, unconscious, dying and dead), and
    so does Health 0 of the combatant's own facts `c` (U45: the engine and the round driver read Health, mods-pure.outOfAction, so a
    character brought to 0 with no mark yet, by hand or while the GM's card about a broken NPC still waits, is out all the same).
    -> null | { reason: "dead" | "unconscious" | "broken", canRally, label }. canRally: broken, and nothing says it cannot get up
    ([B2773]: an injury of 9 or worse leaves the character unconscious, dying or dead). The engine's own answer stays the legality of a declaration. */
export function outOf(view, cid, c = null) {
  const has = (id) => (view?.statuses?.[cid] ?? []).some((s) => s.id === id);
  const zero = !!c && c.kind !== "vehicle" && c.kind !== "challenge" && Number.isFinite(c.health) && !(c.health > 0);
  const reason = has("dead") ? "dead" : has("unconscious") ? "unconscious" : has("broken") || zero ? "broken" : null;
  const rally = reason === "broken" && !has("dying") && (!c || crits.canRally({ broken: true, crits: c.crits ?? [], primaryCopy: c.pass?.noRally === true }).ok);
  return reason ? { reason, canRally: rally, label: `ITAC.ui.out.${reason}` } : null;
}
/** The action bar of one combatant: budget, and each catalog action with whether its cost is payable now (legality against a target is the executor's). */
export function barModel(view, cid, ctx = {}) {
  const P1 = ctx.P1;
  const onTurn = P1 ? P1.isOnTurn(view, cid) : false, busy = (view.stack ?? []).length > 0 || Object.values(view.prompts ?? {}).some((p) => p.kind === "triggerQueue" && !p.answered);      // an open action, or the triggers of the turn waiting for the GM (spec 4.4)
  /* P7: an entry with a `when` word (P5 rows carry an object there: see `applies`) is offered only in its situation (a challenge in the fight, a vehicle to get into, aboard, at the wheel).
     ctx.special() -> [{ id, name, kind: "challenge" | "vehicle" }] the combatants without a card the viewer may see. */
  const ride = (view.statuses?.[cid] ?? []).find((s) => s.id === "inVehicle")?.data ?? null, special = typeof ctx.special === "function" ? ctx.special() : [];
  const fits = (e) => typeof e.when !== "string" || (e.when === "challenge" ? special.some((x) => x.kind === "challenge") : e.when === "onFoot" ? !ride && special.some((x) => x.kind === "vehicle") : e.when === "aboard" ? !!ride : e.when === "driver" ? ride?.role === "driver" : true);
  /* U77 (D40 [R1] [B1953], [B2292]): the one thing that may be declared while an action stands open: with the unused extra unit of
     Quickness a quick or full action answers an action SOMEBODY ELSE declared, before its dice (engine-pure.placement, the same test).
     `answer` = that unit's id, or null (nothing open, the dice are thrown, the own action, the triggers' queue waits, no unit). */
  const topI = (view.stack ?? []).at(-1) ?? null, queued = Object.values(view.prompts ?? {}).some((p) => p.kind === "triggerQueue" && !p.answered);
  const answer = P1?.extraUnit && topI && !queued && !topI.locked && topI.data?.window === "beforeRoll" && topI.actor !== cid ? P1.extraUnit(view, cid) : null;
  const holding = (view.statuses?.[cid] ?? []).some((s) => s.id === "grappling");
  const heldNow = (view.statuses?.[cid] ?? []).some((s) => s.id === "grappled");            // [B2496]: the one held makes no attack until it breaks free (the attack flow refuses it with the same word)
  const out = outOf(view, cid, ctx.c?.(cid) ?? null);
  const broken = [...new Set([...Object.keys(view.statuses ?? {}).filter((id) => (view.statuses[id] ?? []).some((s) => s.id === "broken")), ...(out?.reason === "broken" ? [cid] : [])])];
  /* U22 [B2496] [R20] [R21]: one who is held, snared or trapped does not move, nor does anything that needs the body: the bar greys it with
     the engine's own word (movement-pure.cannotMove, flows/acts.mjs) instead of offering it and refusing the declaration */
  const cond = condsOf(view, cid), stuck = cond.held ? "held" : cond.snared ? "snared" : cond.trapped ? "trapped" : null;
  const tied = ["grappled", "snared", "immobilised"].some((st) => (view.statuses?.[cid] ?? []).some((s) => s.id === st));
  const left = (e) => !out || (out.reason === "broken" && (e.effect?.kind === "convert" || (out.canRally && e.effect?.kind === "rally" && (e.target?.n?.[0] ?? 0) === 0)));      // U9 [B2707], [B2773]
  const actions = C.entriesFor(view, cid, kitFacts(ctx)).filter((e) => e.reaction?.effect !== "defence" && e.id !== "gmRoll" && fits(e) && left(e) && applies(e, cid, view.statuses ?? {}, broken) && (!e.gm || ctx.staff)).map((e) => {       // P5: an escape, a rally ... only when there is something to escape from or somebody to rally
    const answers = !!answer && (e.cost === "full" || e.cost === "quick");                      // U77: this action can answer the open one, paid with the Quickness unit and nothing else
    const pay = P1 ? P1.canPay(view, cid, e.cost ?? "full", { ranged: P1.isRanged?.(e), ...(answers ? { interrupt: true, grant: answer, resolve: ctx.c?.(cid)?.resolve } : {}) }) : { ok: false, reason: "noLedger" };
    const unit = pay.ok && pay.pay ? (view.ledger?.[cid]?.grants ?? []).find((g) => g.id === pay.pay) : null, granted = !onTurn && !!unit && unit.kind !== "base";      // a unit usable out of turn pays it (the crew's attack in a chase [B3438], a GM grant)
    const anytime = !!e.kit && e.cost === "none";                                               // P6: what costs no action is used when it applies (the flow checks the rest)
    const reason = busy && !answers ? "busy" : !onTurn && e.cost !== "free" && !granted && !anytime ? "notYourTurn" : holding && C.holderBlocks(e) ? "grappling" : heldNow && e.flow === "attack" && !e.reaction ? "held" : stuck && e.flow === "move" ? stuck : tied && e.tags?.includes("physical") ? "restrained" : pay.ok ? null : pay.reason ?? "noAction";      // [B2497]: the holder moves, attacks the one held or lets go
    return { id: e.id, label: e.label ?? `ITAC.action.${e.id}`, flow: e.flow, cost: e.cost ?? "full", needsTarget: e.flow === "attack" || !!e.targets || (e.target?.n?.[0] ?? 0) > 0,
      attr: e.roll?.attr ?? null, defense: e.defense ?? null, attack: e.attack ?? null, area: e.area === true, fullAuto: e.fullAuto === true, targetWho: e.target?.who ?? null, kind: e.kind ?? "builtin", tags: (e.tags ?? []).slice(), needsText: e.id === "other" || e.id === "orders" || e.effect?.token === "orders",
      name: e.name || null, kit: e.kit ?? null, pick: Array.isArray(e.pick) ? e.pick.slice() : null, stress: e.stress?.fixed ?? 0, fxOn: e.fxOn === true, unarmed: e.unarmed === 1,      // P6
      when: typeof e.when === "string" ? e.when : null, disabled: reason,
      pay: pay.ok && !reason ? { grant: pay.pay ?? null, stress: pay.stress ?? 0, forfeitsFull: !!pay.forfeitsFull } : null,      // U30: the unit the ledger would take for it now (the surfaces preview the cost on that slot)
      attrs: attrChoices(e), attrOptional: e.roll?.optional === true, optTarget: (e.target?.n?.[0] ?? 0) === 0 && (e.target?.n?.[1] ?? 0) > 0, wantsText: e.text === 1, opposeAttr: e.oppose?.who === "target" ? e.oppose.attr : null, about: e.when?.anyone ?? null, situational: !!e.when && typeof e.when === "object",   // P5 (flow "act")
      req: (decl = {}) => ({ op: "declare", actor: cid, decl: { ...decl, action: e.id } }), exceptionReq: (decl, text) => ({ op: "declare", actor: cid, decl: { ...decl, action: e.id, exception: { text } } }) };
  });
  return { combatant: cid, name: nameOf(ctx, cid), onTurn, free: !!view.free?.[cid], budget: P1 ? P1.budget(view, cid) : null, statuses: (view.statuses?.[cid] ?? []).map((s) => s.id),
    tokens: (view.tokens ?? []).filter((t) => t.holder === cid).map((t) => ({ id: t.id, dice: t.dice, source: t.source, needsGm: !!t.needsGm, scope: t.scope ?? null, forced: !!t.forced, standing: standing(t) })), actions,
    kitRows: (typeof ctx.kit === "function" ? ctx.kit(cid)?.rows : null) ?? [],                    // P6: every item of the sheet with its state (automated, confirmed by the GM, by hand)
    move: typeof ctx.move === "function" ? ctx.move(cid) : undefined,                             // P3: the reachable zones with their cost (movement-pure.moveOptions), each with a ready request
    out,                                                                                          // U9: null, or why nothing (or only getting up) is offered
    /* U9 / P9-5: `noConfirm` = ending this turn leaves nothing behind that needs a second look: the combatant is out of action, or it is
       an NPC in the GM's own hands (the surface asks "sure?" only where a player would lose actions by a slip) */
    endTurn: onTurn ? { disabled: busy ? "busy" : null, noConfirm: !!out || (!!ctx.staff && ctx.c?.(cid)?.npc === true), req: { op: "endTurn", actor: cid, round: view.round, slot: view.init?.cur } } : null,
    holdOff: out ? { disabled: out.reason, targets: [], req: (slotId) => ({ op: "holdOff", actor: cid, with: slotId }) } : holdOffOf(view, cid, onTurn, busy, ctx), markReq: (unit, on = true) => ({ op: "mark", actor: cid, unit, on }),
    other: { req: (text) => ({ op: "other", actor: cid, text }) }, exception: { req: (text, inst, more = {}) => ({ op: "exception", actor: cid, text, ...(inst ? { inst } : {}), ...(more.reason ? { reason: more.reason } : {}), ...(more.decl ? { decl: more.decl } : {}) }) } };
}
/* spec 3.1 hold off: the slots the combatant's card can be swapped with now (none unless it is this combatant's own turn) */
function holdOffOf(view, cid, onTurn, busy, ctx) {
  let targets = [];
  const used = Lg.turnUsed(view.ledger?.[cid]);                                              // [B2281-2282]
  try { if (onTurn && !used && view.init?.curMember === cid) targets = Init.holdOffTargets(view.init, view.init.cur); } catch { targets = []; }
  const slot = (id) => (view.init?.slots ?? []).find((s) => s.id === id);
  return { disabled: !onTurn ? "notYourTurn" : busy ? "busy" : used ? "turnUsed" : targets.length ? null : "noTarget",
    targets: targets.map((id) => ({ slot: id, card: slot(id)?.card ?? null, names: (slot(id)?.members ?? []).map((m) => nameOf(ctx, m)) })), req: (slotId) => ({ op: "holdOff", actor: cid, with: slotId }) };
}
/** Everything a player's surface shows. `view` MUST be viewFor(state, viewer, meta). */
export function playerModel(view, viewer, ctx = {}) {
  if (!view) return { prompts: [], mine: [], bars: [], waiting: [], stack: [], helpable: [], turn: null };
  const owns = viewer?.owns ?? [];
  const prompts = Object.values(view.prompts ?? {}).filter((p) => !p.answered && Array.isArray(p.options) && (usersOf(p).includes(viewer.id) || owns.includes(p.about))).map((p) => promptModel(p, ctx));
  const stack = (view.stack ?? []).map((i) => (i.masked ? { inst: i.id, masked: true, status: i.status } : instLine(i, ctx, view)));
  const mine = (view.stack ?? []).filter((i) => !i.masked && owns.includes(i.actor)).map((i) => ({ ...instLine(i, ctx, view),
    rolls: Object.values(i.rolls ?? {}).filter((r) => r.req?.users?.includes(viewer.id) && r.sixes == null && !r.forced).map((r) => ({ key: r.key, rid: r.req.rid, dice: r.req.dice, attr: r.attr, maxPush: r.req.maxPush })),
    commands: [...(i.locked ? [] : [{ id: "amend", label: "ITAC.cmd.amend", needs: "decl", req: (decl) => ({ op: "amend", inst: i.id, decl }) }]), { id: "cancel", label: i.locked ? "ITAC.cmd.cancelAsk" : "ITAC.cmd.cancel", req: { op: "cancel", inst: i.id } }] }));
  const helpable = (view.stack ?? []).filter((i) => !i.masked && !i.locked && i.actor && !owns.includes(i.actor)).flatMap((i) => owns.map((h) => ({ inst: i.id, helper: h, req: { op: "help", inst: i.id, helper: h } })));
  /* U1 / U2: every roll this user owes or may still push, in anybody's action (a defence is rolled inside the attacker's) */
  const rolls = (view.stack ?? []).filter((i) => !i.masked).flatMap((i) => Object.values(i.rolls ?? {}).filter((r) => r.req?.users?.includes(viewer.id) && rollState(r) !== "done").map((r) => rollRow(i, r, ctx)));
  return { prompts, mine, rolls, stack, helpable, bars: owns.map((cid) => barModel(view, cid, ctx)), waiting: waitingOn(view, ctx), turn: turnOf(view, ctx) };
}
export { REVALIDATE_OPTIONS };
