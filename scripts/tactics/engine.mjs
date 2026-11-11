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
import { t } from "./lang.mjs";

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
function combatantFacts(cb) {
  const actor = Sys.actorOf(cb), f = Sys.actorFacts(actor);
  if (!f) return null;
  const summonOf = cb.flags?.[MOD]?.tactics?.summonOf;
  return { id: cb.id, name: cb.name ?? actor.name, actorUuid: actor.uuid, tokenUuid: tokenOf(cb)?.uuid ?? null, owners: Sys.ownersOf(actor), hidden: cb.hidden === true || tokenOf(cb)?.hidden === true,
    present: !(cb.isDefeated ?? cb.defeated) && !!tokenOf(cb), defeated: !!(cb.isDefeated ?? cb.defeated), summonOf: S.isId(summonOf) ? summonOf : null, ...f };
}
function makeFacts(combat) {
  const memo = new Map();
  const c = (cid) => { if (!memo.has(cid)) { const cb = combat.combatants.get(cid); let f = null; try { f = cb ? combatantFacts(cb) : null; } catch (err) { console.warn(`${MOD} | tactics facts`, err); } memo.set(cid, f); } return memo.get(cid); };
  const tok = (cid) => tokenOf(combat.combatants.get(cid));
  const byToken = (token) => combat.combatants.find((x) => x.tokenId === (token?.id ?? token?.document?.id))?.id ?? null;
  return {
    c,
    weapon: (cid, ref) => (ref == null || ref === "unarmed" ? { id: "unarmed", name: "unarmed", bonus: 0, damage: null, range: null, sharp: false, ...(c(cid)?.kit?.unarmed ?? {}) } : Sys.weaponFacts(Sys.actorOf(combat.combatants.get(cid)), ref, c(cid)?.kit ?? null)),
    range: (a, b) => { const ta = tok(a), tb = tok(b); return ta && tb ? Zones.range(ta, tb) : undefined; },
    /* the combatant's 3-D zone: its spot string, and the zone's states and emptiness as the map reports them */
    zone: (cid) => { const p = tok(cid) ? Zones.placeOf(tok(cid)) : null; const z = p?.zone ? Zones.zoneOf(p.zone) : null; return p ? { spot: p.spot ?? null, key: p.zone ?? null, level: p.level ?? null, area: p.area ?? null, airborne: p.airborne === true, states: z?.states ?? {}, empty: z?.empty === true, terrain: typeof z?.terrain === "string" ? z.terrain : "", rooftop: z?.rooftop === true } : null; },   // terrain and rooftop: what wrecking the zone reads [P4]
    inZone: (cid) => (tok(cid) ? Zones.tokensInZone(tok(cid)).map(byToken).filter((x) => x && x !== cid) : []),      // same spot: the book's "same zone"
    inZoneKey: (where) => Zones.tokensInZone(where).map(byToken).filter(Boolean),                                     // a key: every level; a spot: that level
    user: (uid) => { const u = game.users.get(uid); return u ? { id: u.id, staff: Store.isStaff(u), active: u.active === true } : null; },
    zones: Zones.available() ? Mv.zoneFacts(tok, byToken) : null,                                                     // P3: the live zone facts of movement-pure.mjs
    canTalk: (a, b) => (Zones.available() ? Mv.talk(Mv.zoneFacts(tok, byToken), a, b)?.ok : undefined),              // [Z11]
    actorValue: (uuid, field) => { const a = fromUuidSync(uuid); return a ? Sys.actorValue(a, field) : null; },
  };
}
const metaOf = (combat) => ({ hidden: combat.combatants.filter((cb) => cb.hidden === true || cb.token?.hidden === true).map((cb) => cb.id), npc: combat.combatants.filter((cb) => Sys.actorOf(cb)?.type !== "superhero").map((cb) => cb.id) });

/* ------------------------------------------------------------------ effects on documents (engine-pure.mjs "Host effects") */
const labelOf = (s) => t(`ITAC.mod.${String(s).split(":")[0]}`, {}, String(s));
function sendRoll(combat, e) {
  const mine = e.users.includes("gm") || e.users.includes(game.user.id) || !e.users.some((u) => game.users.get(u)?.active);
  const req = { combat: combat.id, inst: e.inst, key: e.key, rid: e.rid, actorUuid: e.actorUuid, attr: e.attr, pool: e.pool, dice: e.dice, maxPush: e.maxPush, label: t(`ITAC.roll.${String(e.key).split(":")[0]}`, {}, e.label ?? e.key) };
  if (mine) Sys.openRoll(req, labelOf).catch((err) => { console.warn(`${MOD} | tactics: roll dialog`, err); ui.notifications?.warn(t("ITAC.warn.rollDialog")); });
  else game.socket.emit(CHANNEL, { k: R.KIND.roll, to: e.users, req }, { recipients: e.users });
}
async function perform(combat, e) {
  switch (e.t) {
    case "actor": {
      const actor = await fromUuid(e.uuid);
      if (!actor) return {};
      const op = await Sys.setActorField(actor, e.path, e.to, e.tx);
      return e.undo ? {} : { op };
    }
    case "critAdd": { const actor = await fromUuid(e.uuid); const op = actor ? await Sys.addInjury(actor, e.n, e.tx) : null; if (!op) ui.notifications?.warn(t("ITAC.warn.noInjury", { n: e.n })); return op ? { op } : {}; }
    case "dice": {
      const roll = await new Roll(`${Math.max(1, Math.trunc(e.n))}d${e.sides > 0 ? Math.trunc(e.sides) : 6}`).evaluate();        // P5: `sides` for a random pick among N (where a fire spreads)
      const faces = roll.dice[0]?.results?.map((r) => r.result) ?? [];
      let op = null;
      try { const m = await roll.toMessage({ flavor: t(`ITAC.dice.${String(e.why ?? "").split(":")[0]}`, {}, t("ITAC.dice.engine")), flags: { [MOD]: { tactics: { dice: e.why ?? "" } } } }, { ipuTactics: true }); if (m?.id) op = { t: "message", id: m.id }; } catch { /* the faces count; the card is a courtesy */ }
      return { result: faces, op };
    }
    case "rollRequest": sendRoll(combat, e); return {};
    case "zones": {                                                                        // one write of the map; the journal keeps the inverse it returned
      const r = await Zones.perform(e);
      if (!r.ok) { ui.notifications?.warn(t("ITAC.warn.zones", { reason: t(`ITAC.reason.${r.reason}`, {}, String(r.reason)) })); return { ok: false, reason: r.reason }; }
      return r.op ? { op: r.op, result: r.result } : { result: r.result };
    }
    case "zmove": case "zput": return Mv.performMove(e, (cid) => tokenOf(combat.combatants.get(cid)));        // P3: one stretch of a move / an arrival; the map's inverse is journaled
    case "fx": { const actor = await fromUuid(e.uuid); const op = actor ? await Sys.setItemEffect(actor, e.item, e.fx, e.on) : null; if (!op) ui.notifications?.warn(t("ITAC.warn.noEffect")); return op ? { op } : {}; }      // P6: a form, a size, a stance switched from the dock
    case "kitFlag": await Sys.setKitFlag(e.uuid, e.item, e.key, e.value); return {};
    case "summonFlag": { const cb = combat.combatants.get(e.combatant); if (cb) { await cb.update({ [`flags.${MOD}.tactics.summonOf`]: e.owner ?? null }, { ipuTactics: true }); scheduleRoster(combat); } return {}; }
    case "fxSet": { const actor = await fromUuid(e.actorUuid); if (actor) await Sys.setItemEffect(actor, e.itemId, e.effectId, e.on); return {}; }
    case "itemDelete": { const a = await fromUuid(e.actorUuid); if (a?.items.get(e.itemId)) await a.deleteEmbeddedDocuments("Item", [e.itemId], { ipuTactics: true }); return {}; }
    case "itemCreate": { const a = await fromUuid(e.actorUuid); if (a && e.data) await a.createEmbeddedDocuments("Item", [e.data], { keepId: !!e.keepId, ipuTactics: true }); return {}; }
    case "effectDelete": { const a = await fromUuid(e.actorUuid); if (a?.effects.get(e.effectId)) await a.deleteEmbeddedDocuments("ActiveEffect", [e.effectId], { ipuTactics: true }); return {}; }
    case "effectCreate": { const a = await fromUuid(e.actorUuid); if (a && e.data) await a.createEmbeddedDocuments("ActiveEffect", [e.data], { keepId: !!e.keepId, ipuTactics: true }); return {}; }
    case "tokenDelete": { const s = game.scenes.get(e.sceneId); if (s?.tokens.get(e.tokenId)) await s.deleteEmbeddedDocuments("Token", [e.tokenId], { ipuTactics: true }); return {}; }
    case "tokenCreate": { const s = game.scenes.get(e.sceneId); if (s && e.data) await s.createEmbeddedDocuments("Token", [e.data], { keepId: !!e.keepId, ipuTactics: true }); return {}; }
    case "tokenMove": { const d = game.scenes.get(e.sceneId)?.tokens.get(e.tokenId); if (d && e.to) await d.update({ x: e.to.x, y: e.to.y, ...(e.to.elevation !== undefined ? { elevation: e.to.elevation } : {}) }, { ipuTactics: true, animate: false }); return {}; }
    case "messageStrike": await Sys.strikeMessage(e.id); return {};
    case "message": { try { const m = await ChatMessage.create({ content: foundry.utils.escapeHTML?.(String(e.text ?? "")) ?? "", whisper: e.gmOnly ? ChatMessage.getWhisperRecipients("GM").map((u) => u.id) : [], flags: { [MOD]: { tactics: { note: 1 } } } }, { ipuTactics: true }); return m?.id ? { op: { t: "message", id: m.id } } : {}; } catch { return {}; } }
    default: return {};
  }
}
/** the host of director-pure.mjs for one combat */
const hostFor = (combat) => ({
  facts: () => makeFacts(combat), perform: (e) => perform(combat, e), now: () => Date.now(),
  setting: (key) => { try { return game.settings.get(MOD, key); } catch { return undefined; } },
  parts: () => Sys.participants(combat), rng, sceneFacts: () => Sys.sceneFacts(combat),
});

/* ------------------------------------------------------------------ events (spec 16) */
function publish(combat, state, events) {
  if (!events?.length) return;
  const meta = metaOf(combat);
  for (const ev of events) {
    const full = { ...ev, combat: combat.id };
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
      if (out.changed) await Store.write(combat, out.state, out.log !== log ? out.log : undefined);
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
    if (r.op === "start") r = { ...r, mode: S.MODES.includes(r.mode) ? r.mode : startMode(), opts: { ...startOpts(), ...(r.opts && typeof r.opts === "object" ? r.opts : {}) } };
    const rid = meta.rid ?? R.makeRid(user.id, `l${++ctr}${Math.random().toString(36).slice(2, 6)}`);
    return await run(combat.id, { t: "req", user: { id: user.id, staff }, rid, req: r }, { claimKey: meta.via === "relay" ? `q:${rid}` : null, low: !staff });
  } catch (err) {
    console.warn(`${MOD} | tactics request failed`, err);
    return bad("internal", { msg: String(err?.message ?? err).slice(0, 80) });
  }
}
/* the combat an engine roll belongs to: named in the roll's tag, else the fight on the table */
const combatOfRoll = (r) => { const c = r.combat ? Store.combatOf(r.combat) : Store.currentCombat(); return c && Store.stateOf(c) ? c : null; };
function onRollMessage(message) {
  try {
    if (!Store.iAmExecutor()) return;
    const r = Sys.readRollMessage(message);
    if (!r || !r.author) return;
    const combat = combatOfRoll(r);
    if (!combat) return;
    const key = `r:${r.messageId}:${r.pushed}:${r.pushable ? 1 : 0}:${r.sixes}`;
    if (doneRolls.has(key)) return;
    doneRolls.add(key); if (doneRolls.size > 400) doneRolls.delete(doneRolls.values().next().value);
    run(combat.id, { t: "roll", ...r }, { claimKey: key });
  } catch (err) { console.warn(`${MOD} | tactics: roll message`, err); }
}

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
export function journal(user = game.user, combat = undefined) { const c = pick(combat); return c && Store.stateOf(c) ? V.journalFor(Store.logOf(c), viewer(user, c)) : []; }
/** names and presence for the desk and player models (desk-pure.mjs) */
export const context = (combat = undefined) => { const c = pick(combat); return { staff: Store.isStaff(game.user),
  kit: (cid) => { try { const a = Sys.actorOf(c?.combatants.get(cid)); return a && (Store.isStaff(game.user) || a.isOwner) ? Sys.kitOf(a) : null; } catch { return null; } },      // P6: only of a sheet this user may read
  c: (cid) => { const cb = c?.combatants.get(cid); return cb ? { name: cb.name, npc: Sys.actorOf(cb)?.type !== "superhero", owners: Sys.ownersOf(Sys.actorOf(cb)) } : null; }, online: (uid) => game.users.get(uid)?.active === true,
  special: () => (c?.combatants?.contents ?? []).filter((cb) => ["challenge", "vehicle"].includes(Sys.actorOf(cb)?.type) && (Store.isStaff(game.user) || !cb.hidden)).map((cb) => ({ id: cb.id, name: cb.name, kind: Sys.actorOf(cb).type })) }; };      // P7

/** what movement.mjs needs of this client (the cost confirmation on a drag, the reach pick) */
export const moveHost = () => ({ cid: (td) => pick()?.combatants.find((x) => x.tokenId === td?.id)?.id ?? null, c: (cid) => (pick() ? makeFacts(pick()).c(cid) : null), state: () => view(), facts: () => (pick() ? makeFacts(pick()) : {}) });
export function start() {
  if (started) return;
  started = true;
  Hooks.on("createChatMessage", (m) => onRollMessage(m));
  Hooks.on("updateChatMessage", (m) => onRollMessage(m));                                  // a push re-writes the message's roll
  Sys.warmUp().catch(() => {});
}
export const isStarted = () => started;
