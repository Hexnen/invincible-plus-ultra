/* Tactical combat, package P2: MODELS FOR THE TWO SURFACES (spec 12.2, 13), data only. NO Foundry globals (node-tested in check-desk.mjs).
   The look of the player action bar and of the GM desk is another task. This file gives that task everything as plain data:
     deskModel(state, log, ctx)        -> { cards, info, manual, journal, waiting }     for staff (from the full state)
     playerModel(view, viewer, ctx)    -> { prompts, mine, bars, waiting, journal }      for a player (from viewFor(...) ONLY, so it cannot leak)
   Every choice comes with the ready request (`req`) to hand to api.tactics.request(...). Labels are i18n keys (ITAC.*), never text.
     ctx = { c: (cid) -> { name, npc, owners } | null, online: (userId) -> bool, P1: the ledger interface (budget, canPay, isOnTurn) } */
import * as C from "./catalog-pure.mjs";
import { REVALIDATE_OPTIONS, FLOWS } from "./engine-pure.mjs";
import * as Init from "./initiative-pure.mjs";
/* ADDED FOR THE SURFACES (scripts/tactics/ui/; all additive, checked in check-ui.mjs):
     instance lines carry `steps` (the flow's step ids, for "back to step"), `attr` / `defense` of the catalog entry and `outcomes`;
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
  "gate", "tokenConfirm", "counter", "dodgeMove", "stunts"]);

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
const instLine = (i, ctx, state = null) => ({ steps: (FLOWS[i.flow]?.STEPS ?? []).slice(), attr: entryOf(state, i)?.roll?.attr ?? null, defense: entryOf(state, i)?.defense ?? null,
  outcomes: Object.entries(i.data?.out ?? {}).map(([t, o]) => ({ target: t, name: nameOf(ctx, t), hit: o?.hit === true, net: o?.net ?? null })), inst: i.id, action: i.action, flow: i.flow, actor: i.actor, actorName: nameOf(ctx, i.actor), targets: (i.decl?.targets ?? []).map((t) => ({ id: t, name: nameOf(ctx, t) })), cause: i.cause, step: i.step, status: i.status, locked: !!i.locked, parent: i.parent, text: i.decl?.text });

/** Everything the GM desk shows. `log` is the journal flag. */
export function deskModel(state, log, ctx = {}) {
  if (!state) return { cards: [], info: [], manual: [], journal: [], waiting: [], npcs: [], mode: null, turn: null };
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
    info.push({ ...line, rolls: Object.values(i.rolls ?? {}).map((r) => ({ key: r.key, who: r.who, whoName: nameOf(ctx, r.who), attr: r.attr, dice: r.req?.dice, sixes: r.forced?.sixes ?? r.sixes ?? null, waiting: r.sixes == null && r.forced == null, users: r.req?.users ?? [] })), commands: cmds });
  }
  const list = log?.list ?? [];
  const journal = list.map((t, at) => ({ id: t.id, inst: t.inst, round: t.round, at: t.at, state: t.state, text: t.label?.gm ?? "", pub: t.label?.pub ?? "",
    undo: t.state === "closed" && Array.isArray(t.ops) ? { req: { op: "undo", tx: t.id }, alsoUndoes: list.slice(at + 1).filter((x) => x.state === "closed").length,       // spec 15: LIFO
      force: { req: (drift) => ({ op: "undo", tx: t.id, force: true, ...(drift ? { drift } : {}) }), modes: ["restore", "difference", "leave"] } } : null })).reverse();
  /* spec 13.3 (standing reactions of an NPC) and spec 10 (what of an opponent the players have been shown) */
  const npcs = Object.keys(state.ledger ?? {}).filter((cid) => ctx.c?.(cid)?.npc).map((cid) => ({ id: cid, name: nameOf(ctx, cid),
    policy: { block: "ask", dodge: "ask", onBroken: "ask", ...(state.npc?.[cid] ?? {}) }, revealed: { stats: !!state.revealed?.[cid]?.stats, powers: !!state.revealed?.[cid]?.powers, health: !!state.revealed?.[cid]?.health },
    policyReq: (patch) => ({ op: "npcPolicy", combatant: cid, policy: { ...(state.npc?.[cid] ?? {}), ...patch } }),
    revealReq: (patch) => ({ op: "reveal", combatant: cid, ...Object.fromEntries(Object.entries({ ...(state.revealed?.[cid] ?? {}), ...patch }).filter(([, v]) => v).map(([k]) => [k, true])) }) }));
  return { cards, info, manual, journal, waiting: waitingOn(state, ctx), npcs, mode: state.mode ?? null, modeReq: (mode) => ({ op: "setMode", mode }), turn: turnOf(state, ctx) };
}

/** Who the table is waiting for right now (both surfaces show it). */
export function waitingOn(state, ctx = {}) {
  const out = [];
  for (const p of Object.values(state?.prompts ?? {})) if (!p.answered) out.push({ what: "prompt", kind: p.kind, prompt: p.id, to: p.to === "gm" ? "gm" : usersOf(p), about: p.about ?? null, aboutName: nameOf(ctx, p.about) });
  for (const i of state?.stack ?? []) for (const r of Object.values(i.rolls ?? {})) if (r.sixes == null && r.forced == null && r.req) out.push({ what: "roll", key: r.key, inst: i.id, to: r.req.users ?? [], about: r.who, aboutName: nameOf(ctx, r.who) });
  return out;
}

/** A prompt as the addressee's panel needs it. */
function promptModel(p, ctx) {
  return { id: p.id, kind: p.kind, inst: p.inst, about: p.about ?? null, aboutName: nameOf(ctx, p.about), title: `ITAC.prompt.${p.kind}`, multi: !!p.multi, min: p.min, max: p.max, free: !!p.free, data: p.data ?? {},
    options: (p.options ?? []).map((o) => ({ id: o.id, label: o.label ?? `ITAC.opt.${o.id}`, disabled: o.disabled ?? null, cost: o.cost, stress: o.stress, data: o.data, req: o.disabled ? null : optReq(p, o, "answer") })),
    answerReq: (value) => ({ op: "answer", prompt: p.id, value }) };
}
/** The action bar of one combatant: budget, and each catalog action with whether its cost is payable now (legality against a target is the executor's). */
export function barModel(view, cid, ctx = {}) {
  const P1 = ctx.P1;
  const onTurn = P1 ? P1.isOnTurn(view, cid) : false, busy = (view.stack ?? []).length > 0;
  const actions = C.entriesFor(view, cid).filter((e) => e.reaction?.effect !== "defence" && e.id !== "gmRoll").map((e) => {
    const pay = P1 ? P1.canPay(view, cid, e.cost ?? "full", {}) : { ok: false, reason: "noLedger" };
    const reason = busy ? "busy" : !onTurn && e.cost !== "free" ? "notYourTurn" : pay.ok ? null : pay.reason ?? "noAction";
    return { id: e.id, label: e.label ?? `ITAC.action.${e.id}`, flow: e.flow, cost: e.cost ?? "full", needsTarget: e.flow === "attack" || !!e.targets || (e.target?.n?.[0] ?? 0) > 0,
      attr: e.roll?.attr ?? null, defense: e.defense ?? null, targetWho: e.target?.who ?? null, kind: e.kind ?? "builtin", tags: (e.tags ?? []).slice(), needsText: e.id === "other" || e.id === "orders", disabled: reason,
      req: (decl = {}) => ({ op: "declare", actor: cid, decl: { ...decl, action: e.id } }), exceptionReq: (decl, text) => ({ op: "declare", actor: cid, decl: { ...decl, action: e.id, exception: { text } } }) };
  });
  return { combatant: cid, name: nameOf(ctx, cid), onTurn, free: !!view.free?.[cid], budget: P1 ? P1.budget(view, cid) : null, statuses: (view.statuses?.[cid] ?? []).map((s) => s.id),
    tokens: (view.tokens ?? []).filter((t) => t.holder === cid).map((t) => ({ id: t.id, dice: t.dice, source: t.source, needsGm: !!t.needsGm })), actions,
    endTurn: onTurn ? { disabled: busy ? "busy" : null, req: { op: "endTurn", actor: cid, round: view.round, slot: view.init?.cur } } : null,
    holdOff: holdOffOf(view, cid, onTurn, busy, ctx), markReq: (unit, on = true) => ({ op: "mark", actor: cid, unit, on }),
    other: { req: (text) => ({ op: "other", actor: cid, text }) }, exception: { req: (text, inst) => ({ op: "exception", actor: cid, text, ...(inst ? { inst } : {}) }) } };
}
/* spec 3.1 hold off: the slots the combatant's card can be swapped with now (none unless it is this combatant's own turn) */
function holdOffOf(view, cid, onTurn, busy, ctx) {
  let targets = [];
  try { if (onTurn && view.init?.curMember === cid) targets = Init.holdOffTargets(view.init, view.init.cur); } catch { targets = []; }
  const slot = (id) => (view.init?.slots ?? []).find((s) => s.id === id);
  return { disabled: !onTurn ? "notYourTurn" : busy ? "busy" : targets.length ? null : "noTarget",
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
  return { prompts, mine, stack, helpable, bars: owns.map((cid) => barModel(view, cid, ctx)), waiting: waitingOn(view, ctx), turn: turnOf(view, ctx) };
}
export { REVALIDATE_OPTIONS };
