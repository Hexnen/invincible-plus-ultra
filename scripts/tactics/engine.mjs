/* Tactical combat: THE EXECUTOR (spec 1.1, 1.2, 12.1), the Foundry side of director-pure.mjs. Runs on the active GM's client only.
   Every request, a local click on this client or a relayed one, ends in exec(user, combat, req, meta):
   - nothing in a payload is believed: identity = the User object the caller resolved from the server's sender id (relay.mjs) or this
     very client's user, staff = that user's REAL role, ownership = the REAL ownership table of the combatant's actor; the request is
     whitelisted (relay-pure.normalize) and every field is checked again by the pure machines against the state as it is when applied;
   - one request at a time on this client (Store.queue: staff before players), ONE state write per request; a request that reached
     several tabs of the GM runs on one (Store.claim) and is deduplicated by its request id (`state.seen`);
   - the pure director gets a live host: facts read from documents and the zones adapter, effects carried out on documents (actor
     fields, injuries, dice, roll requests, the map), the participants of the round, the card shuffle's random source;
   - the result of an engine roll is read from its chat message (author = the server's word) and fed back as a `roll` input;
   - events (spec 16): every one, unfiltered, on "invincible-plus-ultra.tacticsGm" here; filtered by the public view on
     "invincible-plus-ultra.tactics" here and, through the relay's `tcev`, on every other client.
   Everything is in try / catch: a failure answers `internal` and never breaks the table. NOT VERIFIED LIVE (see the handoff). */
import * as D from "./director-pure.mjs";
import * as S from "./state-pure.mjs";
import * as V from "./view-pure.mjs";
import * as R from "./relay-pure.mjs";
import * as Store from "./store.mjs";
import * as Sys from "./system-adapter.mjs";
import * as Zones from "./zones-adapter.mjs";
import * as Mv from "./movement.mjs";
import * as Summons from "./summons.mjs";
import * as RW from "./rollwatch-pure.mjs";
import { t, rollTitle } from "./lang.mjs";

const MOD = Store.MOD;
const CHANNEL = `module.${MOD}`;
export const HOOK_PUBLIC = Store.HOOK, HOOK_GM = Store.HOOK_GM;
let started = false, ctr = 0;
const doneRolls = new Set();
const bad = R.bad;

/* the cards are shuffled with Foundry's own random source */
const rng = () => { try { return CONFIG.Dice.randomUniform(); } catch { return Math.random(); } };
/** the options a new fight starts with, read from the world settings (spec 17) */
export function startOpts() {
  return {
    redraw: Store.setting("tacticsRedraw", "everyRound") === "firstRoundOnly" ? "firstRoundOnly" : "everyRound",                    // [I2] [B2277]
    pushOrder: Store.setting("tacticsPushOrder", "afterDefence") === "beforeDefence" ? "beforeDefence" : "afterDefence",
    playersEnd: Store.setting("turnPlayersEnd", true) !== false
  };
}
/** the mode a new fight starts in: the rules are enforced (the GM switches a fight to "free" with setMode, spec 1.4) */
export const startMode = () => "tactical";

/* ------------------------------------------------------------------ live facts (engine-pure.mjs "Facts") */
const tokenOf = (cb) => cb?.token ?? null;
/* a hero's summoned allies are run by the hero's player: they stand on the heroes' side [B1808]. D114: the side is not the actor type
   alone (a book villain is a superhero actor too): S.heroSide reads the player owner and the token's disposition */
const isNpc = (cb) => ![cb, cb?.parent?.combatants.get(cb.flags?.[MOD]?.tactics?.summonOf)].some((x) => { const a = Sys.actorOf(x); return !!a && S.heroSide({ type: a.type, owned: Sys.ownersOf(a).length > 0, disposition: tokenOf(x)?.disposition ?? a.prototypeToken?.disposition }); });
function combatantFacts(cb) {
  const actor = Sys.actorOf(cb), f = Sys.actorFacts(actor);
  if (!f) return null;
  const summonOf = cb.flags?.[MOD]?.tactics?.summonOf;
  return { id: cb.id, name: cb.name ?? actor.name, actorUuid: actor.uuid, tokenUuid: tokenOf(cb)?.uuid ?? null, owners: Sys.ownersOf(actor), player: Sys.playerOf(actor), hidden: cb.hidden === true || tokenOf(cb)?.hidden === true,
    present: !(cb.isDefeated ?? cb.defeated) && !!tokenOf(cb), defeated: !!(cb.isDefeated ?? cb.defeated), summonOf: S.isId(summonOf) ? summonOf : null, summon: cb.flags?.[MOD]?.tactics?.summon ?? null, ...f, npc: isNpc(cb) };
}
function makeFacts(combat) {
  const memo = new Map(); let names = null;
  /* U19: namesakes are numbered, the hidden ones last (view-pure.distinctNames). These are the GM's numbers: they go into the GM's texts only;
     `bare` is the name without a number, for a public journal line about somebody who has left the fight (D33) */
  const c = (cid) => { if (!memo.has(cid)) { const cb = combat.combatants.get(cid); let f = null; try { f = cb ? combatantFacts(cb) : null; if (f) f.bare = f.name; if (f) f.name = (names ??= V.distinctNames(combat.combatants.map((x) => ({ id: x.id, name: x.name ?? Sys.actorOf(x)?.name ?? "", hidden: x.hidden === true || tokenOf(x)?.hidden === true }))))[cb.id] ?? f.name; } catch (err) { Sys.trace("dropped", "facts", combat.combatants.get(cid)?.name ?? cid, "", "", err); } memo.set(cid, f); } return memo.get(cid); };
  const tok = (cid) => tokenOf(combat.combatants.get(cid));
  const byToken = (token) => combat.combatants.find((x) => x.tokenId === (token?.id ?? token?.document?.id))?.id ?? null;
  return {
    c,
    weapon: (cid, ref) => (ref == null || ref === "unarmed" ? { id: "unarmed", name: "unarmed", bonus: 0, damage: null, range: null, sharp: false, ...(c(cid)?.kit?.unarmed ?? {}) } : Sys.weaponFacts(Sys.actorOf(combat.combatants.get(cid)), ref, c(cid)?.kit ?? null)),
    range: (a, b) => { const ta = tok(a), tb = tok(b); return ta && tb ? Zones.range(ta, tb) : undefined; },
    /* the combatant's 3-D zone: its spot string, and the zone's states and emptiness as the map reports them */
    zone: (cid) => { const p = tok(cid) ? Zones.placeOf(tok(cid)) : null; const z = p?.zone ? Zones.zoneOf(p.zone) : null; return p ? { spot: p.spot ?? null, key: p.zone ?? null, level: p.level ?? null, area: p.area ?? null, airborne: p.airborne === true, states: Mv.levelStates(tok(cid), z), empty: z?.empty === true, terrain: typeof z?.terrain === "string" ? z.terrain : "", rooftop: z?.rooftop === true } : null; },   // terrain and rooftop: what wrecking the zone reads [P4]
    inZone: (cid) => (tok(cid) ? Zones.tokensInZone(tok(cid)).map(byToken).filter((x) => x && x !== cid) : []),      // same spot: the book's "same zone"
    inZoneKey: (where) => Zones.tokensInZone(where).map(byToken).filter(Boolean),                                     // a key: every level; a spot: that level; the ground alone: "z3:ground" (the ground spot is the bare key) [D26]
    user: (uid) => { const u = game.users.get(uid); return u ? { id: u.id, staff: Store.isStaff(u), active: u.active === true } : null; },
    zones: Zones.usable() ? Mv.zoneFacts(tok, byToken) : null,                                                     // P3: the live zone facts of movement-pure.mjs
    canTalk: (a, b) => (Zones.usable() ? Mv.talk(Mv.zoneFacts(tok, byToken), a, b)?.ok : undefined),              // [Z11]
    actorValue: (uuid, field) => { const a = fromUuidSync(uuid); return a ? Sys.actorValue(a, field) : null; },
  };
}
const metaOf = (combat) => ({ hidden: combat.combatants.filter((cb) => cb.hidden === true || cb.token?.hidden === true).map((cb) => cb.id), npc: combat.combatants.filter(isNpc).map((cb) => cb.id) });

/* ------------------------------------------------------------------ effects on documents (engine-pure.mjs "Host effects") */
const labelOf = (s) => t(`ITAC.mod.${String(s).split(":")[0]}`, {}, String(s));
function sendRoll(combat, e, again = 0) {
  const mine = e.users.includes("gm") || e.users.includes(game.user.id) || !e.users.some((u) => game.users.get(u)?.active);
  const req = { combat: combat.id, inst: e.inst, key: e.key, rid: e.rid, actorUuid: e.actorUuid, attr: e.attr, pool: e.pool, dice: e.dice, maxPush: e.maxPush, label: rollTitle(e.key, e.label), ...(typeof e.label === "string" ? { labelSrc: e.label.slice(0, 80) } : {}), ...(e.mode ? { mode: e.mode } : {}) };
  if (mine) Sys.rollNow(req, labelOf, { force: again > 0 }).catch((err) => { console.warn(`${MOD} | tactics: roll dialog`, err); ui.notifications?.warn(t("ITAC.warn.rollDialog")); });
  else game.socket.emit(CHANNEL, { k: R.KIND.roll, to: e.users, req, ...(again > 0 ? { again } : {}) }, { recipients: e.users });      // D120: `again` = the same request once more (rollwatch-pure)
}
async function perform(combat, e) {
  switch (e.t) {
    case "actor": {
      const actor = await fromUuid(e.uuid);
      if (!actor) return e.undo ? { ok: false, reason: "gone" } : {};                          // D99: an undo that finds the sheet gone says so (the answer's `failed`); a new write to nobody is nothing
      const op = await Sys.setActorField(actor, e.path, e.to, e.tx);
      return e.undo ? {} : { op };
    }
    case "critAdd": { const actor = await fromUuid(e.uuid); const op = actor ? await Sys.addInjury(actor, e.n, e.tx) : null; if (!op) ui.notifications?.warn(t("ITAC.warn.noInjury", { n: e.n })); return op ? { op } : {}; }
    case "dice": {
      const roll = await new Roll(`${Math.max(1, Math.trunc(e.n))}d${e.sides > 0 ? Math.trunc(e.sides) : 6}`).evaluate();        // P5: `sides` for a random pick among N (where a fire spreads)
      const faces = roll.dice[0]?.results?.map((r) => r.result) ?? [];
      let op = null;
      try { const m = await ChatMessage.create(await roll.toMessage({ flavor: t(`ITAC.dice.${String(e.why ?? "").split(":")[0]}`, {}, t("ITAC.dice.engine")), flags: { [MOD]: { tactics: { dice: e.why ?? "" } } } }, { create: false }), { ipuTactics: true }); if (m?.id) op = { t: "message", id: m.id }; } catch { /* the faces count; the card is a courtesy */ }   // D95: Roll#toMessage hands no document options on: the card is created here, with the engine's mark
      return { result: faces, op };
    }
    case "rollRequest": sendRoll(combat, e); return {};
    case "defeated": { const cb = combat.combatants.get(e.combatant); if (!cb) return e.undo ? { ok: false, reason: "gone" } : {}; const from = cb.defeated === true; if (from !== (e.on === true)) await cb.update({ defeated: e.on === true }, { ipuTactics: true }); return e.undo || from === (e.on === true) ? {} : { op: { t: "defeated", combatant: cb.id, from, to: e.on === true } }; }      // FXP (D163)
    case "zones": {                                                                        // one write of the map; the journal keeps the inverse it returned
      const r = await Zones.perform(e);
      if (!r.ok) { ui.notifications?.warn(t("ITAC.warn.zones", { reason: t(`ITAC.reason.${r.reason}`, {}, String(r.reason)) })); return { ok: false, reason: r.reason }; }
      return r.op ? { op: r.op, result: r.result } : { result: r.result };
    }
    case "zmove": case "zput": case "placed": return Mv.performMove(e, (cid) => tokenOf(combat.combatants.get(cid)));        // P3: one stretch of a move / an arrival; the map's inverse is journaled
    case "fx": { const actor = await fromUuid(e.uuid); const op = actor ? await Sys.setItemEffect(actor, e.item, e.fx, e.on) : null; if (!op) ui.notifications?.warn(t("ITAC.warn.noEffect")); return op ? { op } : {}; }      // P6: a form, a size, a stance switched from the dock
    case "kitFlag": { const op = await Sys.setKitFlag(e.uuid, e.item, e.key, e.value); return op && !e.undo ? { op } : {}; }      // journaled: the undo writes back what stood there
    case "summonFlag": case "summonCreate": case "summonRemove": case "summonRestore": case "tokenDelete": case "tokenCreate": return Summons.perform(combat, e, scheduleRoster);      // P6: tokens and combatants that come and go (summons.mjs)
    case "fxSet": { const actor = await fromUuid(e.actorUuid); if (actor) await Sys.setItemEffect(actor, e.itemId, e.effectId, e.on); return {}; }
    case "itemDelete": { const a = await fromUuid(e.actorUuid); if (a?.items.get(e.itemId)) await a.deleteEmbeddedDocuments("Item", [e.itemId], { ipuTactics: true }); return {}; }
    case "itemCreate": { const a = await fromUuid(e.actorUuid); if (!a) return { ok: false, reason: "gone" }; if (e.data) await a.createEmbeddedDocuments("Item", [e.data], { keepId: !!e.keepId, ipuTactics: true }); return {}; }
    case "effectDelete": { const a = await fromUuid(e.actorUuid); if (a?.effects.get(e.effectId)) await a.deleteEmbeddedDocuments("ActiveEffect", [e.effectId], { ipuTactics: true }); return {}; }
    case "effectCreate": { const a = await fromUuid(e.actorUuid); if (!a) return { ok: false, reason: "gone" }; if (e.data) await a.createEmbeddedDocuments("ActiveEffect", [e.data], { keepId: !!e.keepId, ipuTactics: true }); return {}; }
    case "tokenMove": { const d = game.scenes.get(e.sceneId)?.tokens.get(e.tokenId); if (!d) return { ok: false, reason: "gone" }; if (e.to) await d.update({ x: e.to.x, y: e.to.y, ...(e.to.elevation !== undefined ? { elevation: e.to.elevation } : {}) }, { ipuTactics: true, animate: false }); return {}; }
    case "messageStrike": await Sys.strikeMessage(e.id); return {};
    case "message": { try { const m = await ChatMessage.create({ content: foundry.utils.escapeHTML?.(e.key ? t(e.key, e.params ?? {}) : String(e.text ?? "")) ?? "", whisper: e.gmOnly ? ChatMessage.getWhisperRecipients("GM").map((u) => u.id) : [], flags: { [MOD]: { tactics: { note: 1 } } } }, { ipuTactics: true }); return m?.id ? { op: { t: "message", id: m.id } } : {}; } catch { return {}; } }
    default: return {};
  }
}
/** the host of director-pure.mjs for one combat */
const hostFor = (combat) => ({
  facts: () => makeFacts(combat), perform: (e) => perform(combat, e), now: () => Date.now(),
  setting: (key) => { try { return game.settings.get(MOD, key); } catch { return undefined; } },
  /* `warn` (D90): a failure the engine contained (a step that threw, an inverse the documents refused): the fight goes on, the console keeps the trace */
  parts: () => Sys.participants(combat), rng, sceneFacts: () => Sys.sceneFacts(combat), warn: (what, err, more) => { try { console.warn(`${MOD} | tactics: ${what} failed`, more ?? {}, err); } catch { /* no console */ } },
});

/* ------------------------------------------------------------------ events (spec 16) */
function publish(combat, state, events) {
  if (!events?.length) return;
  const meta = metaOf(combat);
  for (const ev of events) {
    const full = { ...ev, combat: combat.id, ...(state?.fight ? { fight: state.fight } : {}) };      // H3-1: an event's seq counts from 1 in every fight: the fight's tag tells them apart
    try { Hooks.callAll(HOOK_GM, full); } catch (err) { console.warn(`${MOD} | tacticsGm listener`, err); }
    let pub = null;
    try { pub = V.publicEvent(state, full, meta); } catch { pub = null; }
    if (!pub) continue;
    try { Hooks.callAll(HOOK_PUBLIC, pub); } catch (err) { console.warn(`${MOD} | tactics listener`, err); }
    try { game.socket.emit(CHANNEL, { k: R.KIND.ev, combat: combat.id, seq: pub.seq, ev: pub }); } catch { /* the stream is best effort */ }
  }
}

/* ------------------------------------------------------------------ one input through the director */
function run(combatRef, input, { claimKey = null, low = false } = {}) {
  return Store.queue(async () => {
    try {
      if (!Store.iAmExecutor()) return bad("noGM");
      const combat = Store.combatOf(combatRef);
      if (!combat) return bad("gone");
      if (claimKey && !(await Store.claim(combat, claimKey))) return { ok: true, changed: false, dup: true };
      const { state, log } = Store.read(combat);
      const out = await D.handle({ state, log }, input, hostFor(combat));
      /* D90: the effects are on the documents by now. A state write that is rejected must not read as "nothing happened": the answer says `partial` */
      if (out.changed) { try { await Store.write(combat, out.state, out.log !== log ? out.log : undefined); } catch (err) { console.warn(`${MOD} | tactics: the state could not be written`, err); return { ...bad("internal", { msg: String(err?.message ?? err).slice(0, 80) }), partial: true }; } Summons.syncCopies(combat, out.state); }
      publish(combat, out.state ?? state, out.events);
      return out.env ?? { ok: true, changed: !!out.changed };
    } catch (err) {
      console.warn(`${MOD} | tactics request failed`, err);
      return bad("internal", { msg: String(err?.message ?? err).slice(0, 80) });
    }
  }, { low });
}

/** Run one request as `user` (a Foundry User) on this (executor) client. meta = { via: "local" | "relay", rid? }: a relayed request was
    admitted and whitelisted by relay-pure.admit and carries its request id. Resolves to an envelope, never rejects. */
export async function exec(user, combatRef, req, meta = {}) {
  try {
    if (!user) return bad("untrusted");
    if (!Store.iAmExecutor()) return bad("noGM");
    const staff = Store.isStaff(user);
    let r = req;
    if (meta.via !== "relay") { const n = R.normalize(req, { staff }); if (!n.ok) return bad(n.code); r = n.req; }
    const combat = Store.combatOf(combatRef);
    if (!combat) return bad("gone");
    if (r.op === "start") r = { ...r, mode: S.MODES.includes(r.mode) ? r.mode : startMode(), opts: { ...startOpts(), ...(r.opts && typeof r.opts === "object" ? r.opts : {}) }, fight: S.makeFight(Date.now(), Math.random()), ...(Store.crewKept(combat) ? { crew: Store.crewKept(combat) } : {}) };      /* FXP (D161): the seats kept by a stop */      // H3-1: the fight's tag is the executor's, never the asker's
    const rid = meta.rid ?? R.makeRid(user.id, `l${++ctr}${Math.random().toString(36).slice(2, 6)}`);
    return await run(combat.id, { t: "req", user: { id: user.id, staff }, rid, req: r }, { claimKey: meta.via === "relay" && r.op !== "preview" ? `q:${rid}` : null, low: !staff });      // a preview only reads: no claim, no write of the combat per question
  } catch (err) {
    console.warn(`${MOD} | tactics request failed`, err);
    return bad("internal", { msg: String(err?.message ?? err).slice(0, 80) });
  }
}
/* the combat an engine roll belongs to: named in the roll's tag, else the fight on the table */
const combatOfRoll = (r) => { const c = r.combat ? Store.combatOf(r.combat) : Store.currentCombat(); return c && Store.stateOf(c) ? c : null; };
function onRollMessage(message, { again = false, late = false } = {}) {
  try {
    if (!Store.iAmExecutor()) return;
    const r = Sys.readRollMessage(message);
    if (!r || !r.author) return;
    const combat = combatOfRoll(r);
    if (!combat) return;
    if (!(Store.stateOf(combat)?.stack ?? []).some((i) => i.id === r.inst)) {
      /* D120: the roller can be faster than this client's own write of the state that asked for the roll (the request leaves during the
         run, the state is written at its end): the action is not in the stored state YET. Looked at once more when the queue is through. */
      if (!late) Store.queue(async () => null).then(() => onRollMessage(message, { again, late: true })).catch(() => {});
      return;                                                                                   // (an edit of an old roll card, its action long over, costs no claim write)
    }
    const key = `r:${r.messageId}:${r.pushed}:${r.pushable ? 1 : 0}:${r.sixes}`;
    if (doneRolls.has(key) && !again) return;
    doneRolls.add(key); if (doneRolls.size > 400) doneRolls.delete(doneRolls.values().next().value);
    run(combat.id, { t: "roll", ...r }, { claimKey: key });
  } catch (err) { console.warn(`${MOD} | tactics: roll message`, err); }
}
/* D120: THE ROLL WATCH (rollwatch-pure.mjs): a roll still owed whose answer is in the chat is fed in again; one with no answer is asked
   for again with the same request id. Nobody has to notice "Waiting for ..." for a roll lost on the wire. Executor only. */
const watchMemo = { fed: new Map(), sent: new Map(), ahead: new Map() };
export function watchRolls(now = Date.now()) {
  try {
    if (!Store.iAmExecutor()) return [];
    const byRid = new Map();                                                                   // H3-1: "<combat>|<rid>" (a tag with no combat: the fight on the table)
    for (const m of (game.messages?.contents ?? []).slice(-120)) { const tg = Sys.tacticsOf(m); if (tg) byRid.set(`${tg.combat ?? Store.currentCombat()?.id ?? ""}|${tg.rid}`, m); }
    const done = [];
    for (const combat of game.combats ?? []) {
      const state = Store.stateOf(combat), msgOf = (rid) => byRid.get(`${combat.id}|${rid}`) ?? null;
      if (!state?.stack?.length) continue;
      for (const a of RW.plan(state, now, { messageFor: (rid) => msgOf(rid)?.id ?? null, readFor: (rid) => (msgOf(rid) ? Sys.readRollMessage(msgOf(rid)) : null), memo: watchMemo })) {
        if (a.do === "feed") onRollMessage(msgOf(a.rid), { again: true });
        else {
          const inst = state.stack.find((i) => i.id === a.inst), rec = inst?.rolls?.[a.key];
          if (!rec?.req) continue;
          const who = rec.who && rec.who !== "hazard" ? makeFacts(combat).c(rec.who) : null;
          sendRoll(combat, { inst: a.inst, key: a.key, rid: rec.req.rid, users: rec.req.users ?? ["gm"], actorUuid: who?.actorUuid ?? null, attr: rec.attr, pool: rec.pool, dice: rec.req.dice, maxPush: rec.req.maxPush, label: rec.req.label, ...(rec.req.mode ? { mode: rec.req.mode } : {}) }, a.n);
        }
        done.push(a);
      }
    }
    return done;
  } catch (err) { console.warn(`${MOD} | tactics: roll watch`, err); return []; }
}
let watchTimer = 0;

/* ------------------------------------------------------------------ joining and leaving (spec 3.3) */
const rosterTimers = new Map();
/** A combatant was created, deleted, defeated or revived: bring the state in line, once per burst of changes. Executor only. */
export function scheduleRoster(combat) {
  try {
    if (!combat || !Store.iAmExecutor() || !Store.stateOf(combat)) return;
    clearTimeout(rosterTimers.get(combat.id));
    rosterTimers.set(combat.id, setTimeout(() => {
      rosterTimers.delete(combat.id);
      if (Store.iAmExecutor() && Store.stateOf(Store.combatOf(combat.id))) exec(game.user, combat.id, { op: "roster" }, { via: "local" });
    }, 60));
  } catch (e) { console.warn(`${MOD} | tactics roster`, e); }
}

/* ------------------------------------------------------------------ reads for any client (always through the view, spec 10) */
const pick = (combat) => Store.combatOf(combat) ?? Store.currentCombat();
export function viewer(user = game.user, combat = undefined) {
  const c = pick(combat);
  const owns = c && !Store.isStaff(user) ? c.combatants.filter((cb) => Sys.owns(cb, user)).map((cb) => cb.id) : [];
  return { id: user.id, staff: Store.isStaff(user), owns };
}
/** the state as `user` may see it (staff: the whole state), or null */
export function view(user = game.user, combat = undefined) {
  const c = pick(combat), state = c ? Store.stateOf(c) : null;
  return state ? V.viewFor(state, viewer(user, c), metaOf(c)) : null;
}
/* U19 / U5-7: the names `user` reads (view-pure.readerNames): a player's namesake numbers never count somebody concealed from that player */
const namesFor = (c, user) => V.readerNames(Store.stateOf(c), viewer(user, c), metaOf(c), c.combatants.map((x) => ({ id: x.id, name: x.name ?? Sys.actorOf(x)?.name ?? "", hidden: x.hidden === true || tokenOf(x)?.hidden === true })));
/** the journal as `user` may read it: the GM's lines for staff; for a player the public lines, none about somebody concealed from that player, with the player's own names (D32, D33) */
export function journal(user = game.user, combat = undefined) { const c = pick(combat); if (!c || !Store.stateOf(c)) return []; const n = namesFor(c, user); return V.journalFor(Store.logOf(c), viewer(user, c), { concealed: n.concealed, name: (id) => n.names[id] ?? null }); }
/** names and presence for the desk and player models (desk-pure.mjs) */
export const context = (combat = undefined) => { const c = pick(combat); let names = null; return { staff: Store.isStaff(game.user),
  bonus: (cid) => { try { const a = Sys.actorOf(c?.combatants.get(cid)); return a && (Store.isStaff(game.user) || a.isOwner) ? Sys.sheetBonuses(a) : null; } catch { return null; } },   // P6: the dice the sheet's effects add, for the preview
  kit: (cid) => { try { const a = Sys.actorOf(c?.combatants.get(cid)); return a && (Store.isStaff(game.user) || a.isOwner) ? Sys.kitOf(a) : null; } catch { return null; } },      // P6: only of a sheet this user may read
  c: (cid) => { const cb = c?.combatants.get(cid); if (!cb) return null;      /* U19: numbered namesakes; a player's numbers never count somebody hidden from them */ names ??= namesFor(c, game.user).names; const a = Sys.actorOf(cb), f = a && (Store.isStaff(game.user) || a.isOwner) ? Sys.actorFacts(a) : null;      /* U45: Health and injuries of a sheet this user may read: the bar of somebody at 0 */ return { name: names[cb.id] ?? cb.name, npc: isNpc(cb), owners: Sys.ownersOf(a), ...(f ? { kind: f.kind, health: f.health, crits: f.crits, pass: f.pass } : {}) }; }, online: (uid) => game.users.get(uid)?.active === true,
  special: () => (c?.combatants?.contents ?? []).filter((cb) => ["challenge", "vehicle"].includes(Sys.actorOf(cb)?.type) && (Store.isStaff(game.user) || !V.concealed(cb, tokenOf(cb)))).map((cb) => ({ id: cb.id, name: cb.name, kind: Sys.actorOf(cb).type })) }; };      // P7

/** what movement.mjs needs of this client (the cost confirmation on a drag, the reach pick) */
export const moveHost = () => ({ cid: (td) => pick()?.combatants.find((x) => x.tokenId === td?.id)?.id ?? null, c: (cid) => (pick() ? makeFacts(pick()).c(cid) : null), state: () => view(), facts: () => (pick() ? makeFacts(pick()) : {}) });
export function start() {
  if (started) return;
  started = true;
  Hooks.on("createChatMessage", (m) => onRollMessage(m));
  Hooks.on("updateChatMessage", (m) => onRollMessage(m));                                  // a push re-writes the message's roll
  clearInterval(watchTimer); watchTimer = setInterval(() => watchRolls(), 2000); watchTimer?.unref?.();           // D120 (unref: a node check ends)
  Sys.warmUp().catch(() => {});
}
export const isStarted = () => started;
