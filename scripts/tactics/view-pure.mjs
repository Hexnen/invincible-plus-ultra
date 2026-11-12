/* Tactical combat: HIDDEN INFORMATION (spec section 10). NO Foundry globals (node-tested in check-view.mjs).
   `viewFor(state, viewer, meta)` is what a non-staff client may render from; `publicEvent(ev, meta)` filters the public hook stream (spec 16).
   This is the ONE view the runtime uses (api.tactics.view). It stands on the base layer `state-pure.viewFor`, which owns the initiative part
   (hidden members leave their slots, the undealt cards are nobody's business) and the round driver's prompts; the action engine's records
   (stack, rolls, outcomes, knowledge, tokens) are filtered here.
     viewer = { id, staff, owns: [combatantId] }       owns = combatants whose actor the user owns (OWNER), resolved by the caller
     meta   = { hidden: [combatantId], npc: [combatantId] }   hidden = Foundry's own `hidden` flag on the token/combatant [spec 10]
   Two layers: a structured pass (what a player may know about things they can see) and a final generic scrub that removes every trace of a concealed
   combatant's id, so the guarantee "a hidden combatant leaks nothing" does not depend on the structured pass knowing every field. */

import { viewFor as baseView } from "./state-pure.mjs";

const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const SPLIT = /[:@|,\s]+/;
const mentions = (s, ids) => typeof s === "string" && (ids.has(s) || (s.length > 2 && s.split(SPLIT).some((p) => ids.has(p))));
const REF_KEYS = ["id", "about", "actor", "target", "holder", "from", "to", "who", "combatant", "owner", "subject", "observer", "by", "source"];

/** Remove every trace of the ids: keys, array elements, records that refer to one, strings that name one. */
export function scrub(value, ids) {
  if (!ids.size) return value;
  const rec = (v) => {
    if (typeof v === "string") return mentions(v, ids) ? undefined : v;
    if (Array.isArray(v)) return v.map(rec).filter((x) => x !== undefined);
    if (!isObj(v)) return v;
    for (const k of REF_KEYS) { const r = v[k]; if (mentions(r, ids) || (isObj(r) && mentions(r.id, ids))) return undefined; }
    const out = {};
    for (const [k, x] of Object.entries(v)) { if (mentions(k, ids)) continue; const y = rec(x); if (y !== undefined) out[k] = y; }
    return out;
  };
  return rec(value) ?? null;
}

/** Combatants the viewer must not learn about: Foundry-hidden ones [spec 10], and those every combatant of the viewer has as `unseen` [B2075], [B1903]. */
export function concealedFor(state, viewer, meta = {}) {
  const out = new Set(meta.hidden ?? []);
  const owns = viewer?.owns ?? [];
  if (owns.length) {
    const rows = owns.map((o) => state.knowledge?.[o] ?? {});
    for (const subject of Object.keys(rows[0])) if (!owns.includes(subject) && rows.every((r) => r[subject] === "unseen")) out.add(subject);
  }
  for (const o of owns) out.delete(o);                                             // nobody is hidden from their own player
  return out;
}

const addressed = (p, viewer) => (isObj(p.to) && Array.isArray(p.to.users) && p.to.users.includes(viewer.id)) || (p.about && viewer.owns.includes(p.about) && p.to !== "gm");
function promptView(p, viewer, concealed = new Set()) {
  if (p.gmOnlyData) return null;
  if (!addressed(p, viewer)) return { id: p.id, inst: p.inst, step: p.step, kind: p.kind, to: p.to === "gm" ? "gm" : { users: p.to?.users ?? [] }, about: p.about, answered: p.answered ? 1 : undefined, ...(p.kind === "triggerQueue" && typeof p.data?.at === "string" ? { data: { at: p.data.at } } : {}) };   // "waiting for X": nothing else (D108: but the moment of a queue, start of the round or of a turn)
  const q = { ...p, options: (p.options ?? []).filter((o) => !o.gmOnly).map((o) => { const { gm, ...rest } = o; return rest; }) };
  if (isObj(q.data)) {
    const { gm, ...rest } = q.data; q.data = rest;
    /* U11 / CU10: an attacker the viewer cannot see is "somebody": no name (scrub takes the id out below), and no chance either, which
       would tell how strong the unseen one is */
    if (typeof rest.attacker === "string" && concealed.has(rest.attacker)) { const { odds, ...kept } = rest; q.data = { ...kept, unseen: 1 }; }
  }
  if (q.auto) { delete q.auto; }                                                   // why an option was passed automatically is the GM's knowledge (NPC policy)
  return q;
}
const numbersHidden = (state, cid, meta, part) => (meta.npc ?? []).includes(cid) && !state.revealed?.[cid]?.[part];
function rollView(state, r, viewer, meta) {
  if (r.secret) return null;                                                        // spec 10: secret rolls are absent
  const out = { key: r.key, who: r.who, sixes: r.sixes, ones: r.ones, pushed: r.pushed, pushable: r.pushable, messageId: r.messageId };
  if (r.forced != null) out.forced = { sixes: r.forced.sixes };
  if (!numbersHidden(state, r.who, meta, "stats")) { out.attr = r.attr; out.pool = r.pool; }      // spec 10: unrevealed NPC numbers leave the roll record
  if (r.req) out.req = r.req.users?.includes(viewer.id) ? { rid: r.req.rid, users: r.req.users, dice: out.pool ? r.req.dice : undefined, maxPush: r.req.maxPush, label: r.req.label, mode: r.req.mode } : { users: r.req.users };
  return out;
}
const OUT_KEEP = ["hit", "net", "stunts", "autoMiss", "defence", "picked"];
/* Spec 10: what an NPC can do stays the GM's until that opponent is revealed (`revealed[cid].powers`). Of the declaration of such an NPC a
   player sees what the table was told when it was declared (the public `actionDeclared` event, engine-pure.publicDecl) and who helps. */
const DECL_PUBLIC = ["action", "weapon", "targets", "zone", "special", "wreck", "area", "fullAuto", "to", "mode", "attr", "helpers"];
const powersHidden = (state, cid, meta) => typeof cid === "string" && (meta.npc ?? []).includes(cid) && !state.revealed?.[cid]?.powers;
function instView(state, inst, viewer, meta, concealed) {
  if (inst.actor && concealed.has(inst.actor)) return { id: inst.id, parent: inst.parent, status: inst.status, masked: 1 };
  const mine = inst.actor && viewer.owns.includes(inst.actor);
  let decl = clone(inst.decl ?? {});
  if (!mine) { delete decl.exception; delete decl.tokens; if (decl.text && inst.status === "manual" && !inst.actor) delete decl.text; }
  if (!mine && powersHidden(state, inst.actor, meta)) decl = Object.fromEntries(DECL_PUBLIC.filter((k) => decl[k] !== undefined).map((k) => [k, decl[k]]));
  const out = { id: inst.id, action: inst.action, flow: inst.flow, actor: inst.actor, initiator: inst.initiator, parent: inst.parent, cause: inst.cause, step: inst.step, status: inst.status,
    locked: inst.locked, part: inst.part, decl, rolls: {}, data: {} };
  for (const [k, r] of Object.entries(inst.rolls ?? {})) { const v = rollView(state, r, viewer, meta); if (v) out.rolls[k] = v; }
  const d = inst.data ?? {};
  /* U77: `window` = which moment of the action stands open ("beforeRoll": declared, its dice not thrown yet). The table knows that much of
     every action it was told about; a player's bar needs it to offer what may still answer the action (the Quickness interrupt, D40). */
  for (const k of ["kind", "retargets", "hold", "result", "label", "window"]) if (d[k] !== undefined) out.data[k] = clone(d[k]);
  if (isObj(d.def)) out.data.def = Object.fromEntries(Object.entries(d.def).map(([t, x]) => [t, { defence: x?.defence }]));
  if (isObj(d.out)) out.data.out = Object.fromEntries(Object.entries(d.out).map(([t, o]) => [t, numbersHidden(state, t, meta, "health") ? Object.fromEntries(OUT_KEEP.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]])) : clone(o)]));
  out.waits = (inst.waits ?? []).slice();
  return out;
}

/** The state a user may see. Staff see everything. The result is a fresh object; the input is never modified. */
export function viewFor(state, viewer, meta = {}) {
  if (!state) return null;
  if (viewer?.staff) return state;
  const V = { id: viewer?.id ?? null, staff: false, owns: Array.isArray(viewer?.owns) ? viewer.owns : [] };
  const concealed = concealedFor(state, V, meta);
  const keepKey = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => !concealed.has(k)));
  const mineRec = (r) => V.owns.includes(r?.subject?.combatant) || V.owns.includes(r?.source?.owner);          // Trigger of spec 6.1: its subject or the owner of its source
  const secret = (cid) => powersHidden(state, cid, meta) && !V.owns.includes(cid);
  const base = baseView(state, { gm: false, userId: V.id, hidden: [...concealed] });
  const prompts = {};
  for (const p of Object.values(state.prompts ?? {})) { if (p.about && concealed.has(p.about)) continue; const q = promptView(p, V, concealed); if (q) prompts[p.id] = q; }
  const ledger = {};
  /* spent actions are table knowledge (spec 4: everyone sees who has acted). P8e-2: not the SLOT they were spent in when that slot is a
     concealed combatant's: a block on a hidden NPC's turn carried the id of the slot the view otherwise does not hold (next to D30 / D31) */
  const slotsSeen = new Set((base.init?.slots ?? []).map((x) => x.id));
  for (const [cid, l] of Object.entries(keepKey(state.ledger))) ledger[cid] = (l.entries ?? []).some((e) => e.slot && !slotsSeen.has(e.slot)) ? { ...l, entries: l.entries.map((e) => { if (!e.slot || slotsSeen.has(e.slot)) return e; const { slot, ...rest } = e; return rest; }) } : l;
  const out = {
    v: state.v, rev: state.rev, ...(typeof state.fight === "string" && state.fight ? { fight: state.fight } : {}), mode: state.mode, kind: state.kind, round: state.round, phase: state.phase,      // FXN: the fight's tag (H3-1; it is in every id already): a fight started again on the same Combat is a new one on every seat
    init: base.init, sched: base.sched, ledger: clone(ledger), statuses: clone(keepKey(state.statuses)), free: clone(keepKey(state.free)),
    stack: (state.stack ?? []).map((i) => instView(state, i, V, meta, concealed)),
    prompts,
    triggers: clone((state.triggers ?? []).filter(mineRec)),                          // other people's armed reactions are not public
    /* bonus dice, running effects and use counters are part of what a character can do: those of an NPC that is not revealed stay with
       the GM; what sits on a hero (a die somebody put on the hero's roll, an effect the hero is under) is that hero's to know */
    tokens: clone((state.tokens ?? []).filter((t) => !t.gmOnly && !secret(t.holder))),
    counters: clone(Object.fromEntries(Object.entries(state.counters ?? {}).filter(([k]) => { const m = /^(?:round|scene):([^:]+):/.exec(k); return !m || !secret(m[1]); }))),
    effects: clone((state.effects ?? []).filter((e) => !e.gmOnly && !(e.holder ? secret(e.holder) : secret(e.source?.owner)))),
    items: clone(state.items ?? []), summons: clone(state.summons ?? []),
    knowledge: Object.fromEntries(V.owns.map((o) => [o, clone(state.knowledge?.[o] ?? {})])),
    revealed: clone(keepKey(state.revealed)), opts: clone(state.opts ?? {}),
  };
  /* P7: who sits in which vehicle, the chase and its distance, and the approaches of a challenge are table knowledge [B2839]; the side
     effects of a challenge and the numbers of its ward are the GM's until they happen */
  /* U10 / U3: what the table was told happened. An action's result is table knowledge like its chat card (a concealed actor or target
     leaves with scrub; a secret action is absent); the GM's word on an exception is for the one who asked. */
  /* U120: a line written while its actor or a target was hidden (`hid`) stays the GM's and the actor's own players' after a reveal (the
     target's player was told "somebody unseen"; who it was is not handed over afterwards) */
  const ownLine = (n) => V.owns.includes(n.actor);
  /* UXB (U141): a line of a doer hidden from this player that hit one of the player's own characters is handed over as "somebody unseen"
     did it (no doer, no action, no power, no reactions; only the targets this player may see): the attack's own card said as much */
  const unseen = (n) => (n.hid && n.hidA && !n.secret && !ownLine(n) && (n.rows ?? []).some((r) => V.owns.includes(r?.target) && !concealed.has(r.target))
    ? { id: n.id, round: n.round, at: n.at, kind: n.kind, flow: n.flow, unseen: 1, status: n.status, rows: (n.rows ?? []).filter((r) => isObj(r) && !concealed.has(r.target)), ...(n.undone ? { undone: 1 } : {}) } : null);
  out.news = clone((state.news ?? []).map((n) => (isObj(n) && n.hid && !ownLine(n) ? unseen(n) ?? n : n)).filter((n) => isObj(n) && !n.secret && (!n.hid || ownLine(n) || n.unseen) && (n.kind !== "exception" || V.owns.includes(n.actor)) && (n.kind !== "nudge" || (Array.isArray(n.to) && n.to.includes(V.id)))))      /* U59: a nudge is read by the ones nudged */.map(({ tx, hidA, hidT, ...n }) => n);
  if (isObj(state.vehicles)) out.vehicles = clone(keepKey(state.vehicles));
  if (isObj(state.chase)) { const { back, ...pub } = state.chase; out.chase = clone(pub); }
  if (isObj(state.challenges)) out.challenges = Object.fromEntries(Object.entries(keepKey(state.challenges)).map(([cid, c]) => [cid, clone({ preset: c.preset ?? null, name: c.name, objectives: c.objectives ?? [], dice: c.dice ?? 0, started: c.started ?? {}, done: c.done })]));
  // statuses carry GM-only notes on NPCs that are not revealed
  for (const [cid, list] of Object.entries(out.statuses)) if (Array.isArray(list)) out.statuses[cid] = list.map((s) => { const { gmNote, ...rest } = s; return rest; });
  return scrub(out, concealed);
}

/** U113: Foundry keeps two switches of "hidden" (the token's and the combatant's) and the fight conceals a combatant while EITHER is on,
    so the token HUD alone could show a token on the players' maps that the fight still hid (no tile, no reveal shot). In a running
    fight the GM's change of one is carried to the other (tactics/main.mjs): either switch hides or reveals the whole combatant.
    -> does the other switch (now `other`) have to follow the one set to `now`? */
export const hideFollows = (now, other) => typeof now === "boolean" && (other === true) !== now;

/** Event types that only the GM stream carries (spec 16). */
export const GM_ONLY_EVENTS = Object.freeze(["override", "gm", "trigger"]);
/** The event as the public stream (every client) may carry it, or null. The public stream has no viewer: anything concealed from anybody is left out. */
export function publicEvent(state, ev, meta = {}) {
  if (!isObj(ev) || GM_ONLY_EVENTS.includes(ev.type) || ev.gmOnly || ev.secret) return null;
  const concealed = new Set(meta.hidden ?? []);
  for (const row of Object.values(state?.knowledge ?? {})) for (const [subject, k] of Object.entries(row ?? {})) if (k === "unseen") concealed.add(subject);
  if (concealed.size && scrub({ e: [ev] }, concealed).e.length === 0) return null;
  /* D31: an initiative record ({ slot, card, members }: a `draw`, a line of `roundStart.order`) whose members are all concealed is not
     there, as in the state view (state-pure.viewFor: a slot left empty disappears); a slot shared with somebody visible keeps its card */
  let src = ev;
  if (concealed.size) {
    const gone = (r) => isObj(r) && Array.isArray(r.members) && r.members.length > 0 && r.members.every((m) => concealed.has(m));
    if (gone(ev) || Object.entries(ev).some(([k, v]) => k !== "type" && typeof v === "string" && mentions(v, concealed))) return null;      // and an event that names a concealed one in a field of its own (`challenge`, `vehicle`) is not public
    src = { ...ev };
    for (const [k, v] of Object.entries(ev)) if (Array.isArray(v) && v.some(gone)) src[k] = v.filter((r) => !gone(r));
  }
  let e = scrub(clone(src), concealed);
  if (!e) return null;
  if (e.type === "roll" && numbersHidden(state, e.who, meta, "stats")) { const { attr, dice, ...rest } = e; e = rest; }
  if (e.type === "damage" && numbersHidden(state, e.target, meta, "health")) { const { armor, base, ...rest } = e; e = rest; }
  if (e.type === "actionDeclared" && isObj(e.decl)) { const { exception, tokens, ...rest } = e.decl; e = { ...e, decl: rest }; }
  return e;
}

/** The public text of a journal line with its `{c:<id>}` marks (engine-pure.cMark) put into names: name(id) is the reader's own name for
    that combatant; one that has left the fight keeps the plain name the line was written with. */
export function pubLine(label, name = null) {
  const pub = typeof label?.pub === "string" ? label.pub : "";
  if (!pub.includes("{c:")) return pub;
  const nm = (id) => (typeof name === "function" ? name(id) : null) ?? label.who?.[id] ?? null;
  /* BH4-6: a bracket about somebody besides the doer and the targets (a reactor, the extra opponent of Bang Heads knocked out: engine-pure
     rxText / hurtText) whom THIS reader does not know is left out of that reader's line ("[: unconscious]" told of somebody unseen) */
  return pub.replace(/ \[\{c:([^{}]{1,64})\}: [^\[\]]*\]/g, (all, id) => (nm(id) ? all : "")).replace(/\{c:([^{}]{1,64})\}/g, (_, id) => String(nm(id) ?? "")).replace(/^: /, "");
}
/** Journal rows for a viewer: the public text only (spec 10: two texts), no operations.
    ctx = { concealed: ids the viewer must not learn about (concealedFor), name: (id) -> the viewer's name for a combatant }
    D32 / D33: a player gets no line about somebody concealed from that player (the doer or a target, `label.who`), the names are the
    player's own (namesakes numbered without the hidden ones), and the GM's word on an exception is for the one who asked (`label.own`). */
export function journalFor(log, viewer, ctx = {}) {
  const list = log?.list ?? [];
  if (viewer?.staff) return list.map((t) => ({ id: t.id, inst: t.inst, round: t.round, at: t.at, state: t.state, text: t.label?.gm ?? "", pub: pubLine(t.label, ctx.name), undoable: t.state === "closed" && Array.isArray(t.ops), ops: t.ops?.length ?? 0 }));
  const concealed = ctx.concealed instanceof Set ? ctx.concealed : new Set(ctx.concealed ?? []), owns = Array.isArray(viewer?.owns) ? viewer.owns : [];
  return list.filter((t) => t.label?.pub && !Object.keys(t.label.who ?? {}).some((id) => concealed.has(id)) && (!t.label.own || owns.includes(t.label.own)))
    .map((t) => ({ id: t.id, round: t.round, at: t.at, state: t.state, text: pubLine(t.label, ctx.name) }));
}
/** U19: two combatants with one name are told apart in every text of the fight: "Soldier #1", "Soldier #2". The order is the one of the
    list (the fight's own, the same on every client) with the hidden ones LAST. Ruling U5-7: the GM's list holds everybody; a player's
    list is given WITHOUT those concealed from that player, so one visible "Soldier" beside a hidden one has no number for the player
    (the number would give the hidden one away), and a player's number may change when somebody is revealed. Every text a player reads
    is numbered from the player's own list (the surfaces' context, the journal); the engine's facts hold the GM's numbers and go into
    the GM's texts only. list = [{ id, name, hidden }] -> { id: name } */
export function distinctNames(list) {
  const by = new Map(), out = {};
  for (const x of list ?? []) { const k = String(x.name ?? ""); if (!by.has(k)) by.set(k, []); by.get(k).push(x); }
  for (const [name, same] of by) {
    if (same.length < 2) { out[same[0].id] = name; continue; }
    [...same.filter((x) => !x.hidden), ...same.filter((x) => x.hidden)].forEach((x, i) => { out[x.id] = `${name} #${i + 1}`; });
  }
  return out;
}
/** The names one reader gets, and who is concealed from that reader. The GM reads everybody; a player's numbers never count somebody
    concealed from that player (U5-7). list = [{ id, name, hidden }] of the whole fight -> { concealed: Set, names: { id: name } } */
export function readerNames(state, viewer, meta = {}, list = []) {
  const concealed = viewer?.staff ? new Set() : state ? concealedFor(state, { id: viewer?.id ?? null, owns: Array.isArray(viewer?.owns) ? viewer.owns : [] }, meta) : new Set(meta.hidden ?? []);
  return { concealed, names: distinctNames((list ?? []).filter((x) => !concealed.has(x.id))) };
}
