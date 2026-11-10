/* Tactical combat, package P2: THE EXECUTOR (Foundry side of engine-pure.mjs). Runs on the active GM client only.
   - exec(user, req, meta): one request through the pure engine with a live host (facts from documents, effects on documents), then one state write.
   - a queue: requests run strictly one after another on this client; a request that reached several tabs of the GM runs on one (Store.claim).
   - chat hooks: the result of an engine roll is read from its chat message (author = the server's word) and fed back as a `roll` input.
   - events: unfiltered on `invincible-plus-ultra.tacticsGm` here; filtered by the public view on `invincible-plus-ultra.tactics` on every client (tcev).
   Everything is in try/catch: a failure answers `internal` and never breaks the table. NOT VERIFIED LIVE (see the handoff). */
import * as E from "./engine-pure.mjs";
import * as V from "./view-pure.mjs";
import * as R from "./relay-pure.mjs";
import * as Store from "./p1-standin-store.mjs";
import * as Sys from "./system-adapter.mjs";
import * as Zones from "./zones-adapter.mjs";
import { t } from "./lang.mjs";

const MOD = Store.MOD;
const CHANNEL = `module.${MOD}`;
export const HOOK_PUBLIC = `${MOD}.tactics`, HOOK_GM = `${MOD}.tacticsGm`;
let queue = Promise.resolve(), started = false;
const doneRolls = new Set();
const bad = R.bad;

/* ------------------------------------------------------------------ live facts (engine-pure.mjs "Facts") */
const tokenOf = (cb) => cb?.token ?? null;
function combatantFacts(cb) {
  const actor = cb.actor, f = Sys.actorFacts(actor);
  if (!f) return null;
  return { id: cb.id, name: cb.name ?? actor.name, actorUuid: actor.uuid, tokenUuid: tokenOf(cb)?.uuid ?? null, owners: Store.ownersOf(actor), hidden: cb.hidden === true || tokenOf(cb)?.hidden === true,
    present: !cb.defeated && !!tokenOf(cb), ...f };
}
function makeFacts(combat) {
  const memo = new Map();
  const c = (cid) => { if (!memo.has(cid)) { const cb = combat.combatants.get(cid); let f = null; try { f = cb ? combatantFacts(cb) : null; } catch (err) { console.warn(`${MOD} | tactics facts`, err); } memo.set(cid, f); } return memo.get(cid); };
  const tok = (cid) => tokenOf(combat.combatants.get(cid));
  const byToken = (token) => combat.combatants.find((x) => x.tokenId === (token?.id ?? token?.document?.id))?.id ?? null;
  return {
    c,
    weapon: (cid, ref) => (ref == null || ref === "unarmed" ? { id: "unarmed", name: "unarmed", bonus: 0, damage: null, range: null, sharp: false } : Sys.weaponFacts(combat.combatants.get(cid)?.actor, ref)),
    range: (a, b) => { const ta = tok(a), tb = tok(b); return ta && tb ? Zones.range(ta, tb) : undefined; },
    zone: (cid) => { const p = tok(cid) ? Zones.placeOf(tok(cid)) : null; const z = p ? Zones.zoneOf(p.spot ?? p) : null; return p ? { spot: p.spot ?? null, states: z?.states ?? {}, empty: z?.empty === true } : null; },
    inZone: (cid) => (tok(cid) ? Zones.tokensInZone(tok(cid)).map(byToken).filter((x) => x && x !== cid) : []),
    user: (uid) => { const u = game.users.get(uid); return u ? { id: u.id, staff: Store.isStaff(u), active: u.active === true } : null; },
    actorValue: (uuid, field) => { const a = fromUuidSync(uuid); return a ? Sys.actorValue(a, field) : null; },
  };
}
const metaOf = (combat) => ({ hidden: combat.combatants.filter((cb) => cb.hidden === true || cb.token?.hidden === true).map((cb) => cb.id), npc: combat.combatants.filter((cb) => cb.actor?.type !== "superhero").map((cb) => cb.id) });

/* ------------------------------------------------------------------ effects on documents (engine-pure.mjs "Host effects") */
function sendRoll(e) {
  const mine = e.users.includes("gm") || e.users.includes(game.user.id) || !e.users.some((u) => game.users.get(u)?.active);
  const labelOf = (s) => t(`ITAC.mod.${String(s).split(":")[0]}`, {}, String(s));
  const req = { inst: e.inst, key: e.key, rid: e.rid, actorUuid: e.actorUuid, attr: e.attr, pool: e.pool, dice: e.dice, maxPush: e.maxPush, label: t(`ITAC.roll.${String(e.key).split(":")[0]}`, {}, e.label ?? e.key) };
  if (mine) Sys.openRoll(req, labelOf).catch((err) => { console.warn(`${MOD} | tactics: roll dialog`, err); ui.notifications?.warn(t("ITAC.warn.rollDialog")); });
  else game.socket.emit(CHANNEL, { k: R.KIND.roll, to: e.users, req }, { recipients: e.users });
}
async function perform(e) {
  switch (e.t) {
    case "actor": {
      const actor = await fromUuid(e.uuid);
      if (!actor) return {};
      const op = await Sys.setActorField(actor, e.path, e.to, e.tx);
      return e.undo ? {} : { op };
    }
    case "critAdd": { const actor = await fromUuid(e.uuid); const op = actor ? await Sys.addInjury(actor, e.n, e.tx) : null; if (!op) ui.notifications?.warn(t("ITAC.warn.noInjury", { n: e.n })); return op ? { op } : {}; }
    case "dice": {
      const roll = await new Roll(`${Math.max(1, Math.trunc(e.n))}d6`).evaluate();
      const faces = roll.dice[0]?.results?.map((r) => r.result) ?? [];
      let op = null;
      try { const m = await roll.toMessage({ flavor: t(`ITAC.dice.${String(e.why ?? "").split(":")[0]}`, {}, t("ITAC.dice.engine")), flags: { [MOD]: { tactics: { dice: e.why ?? "" } } } }, { ipuTactics: true }); if (m?.id) op = { t: "message", id: m.id }; } catch { /* the faces count; the card is a courtesy */ }
      return { result: faces, op };
    }
    case "rollRequest": sendRoll(e); return {};
    case "zones": { const r = await Zones.perform(e); if (!r.ok) ui.notifications?.warn(t("ITAC.warn.zones", { reason: t(`ITAC.reason.${r.reason}`, {}, String(r.reason)) })); return r.op ? { op: r.op } : {}; }
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
const hostFor = (combat) => ({ facts: () => makeFacts(combat), perform, now: () => Date.now(), setting: (key) => { try { return game.settings.get(MOD, key); } catch { return undefined; } } });

/* ------------------------------------------------------------------ events */
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

/* ------------------------------------------------------------------ one input through the engine */
async function run(input, claimKey) {
  if (!Store.iAmExecutor()) return bad("noGM");
  const combat = Store.combat();
  if (!combat) return bad("off");
  if (claimKey && !(await Store.claim(combat, claimKey))) return { ok: true, changed: false, dup: true };
  const { state, log } = Store.read(combat);
  if (!state) return bad("off");
  const out = await E.handle({ state, log }, input, hostFor(combat));
  if (out.changed || out.state !== state) await Store.write(combat, out.state, out.log !== log ? out.log : null);
  publish(combat, out.state, out.events);
  return out.env ?? { ok: true, changed: !!out.changed };
}
const enqueue = (fn) => { const p = queue.then(fn, fn).catch((err) => { console.error(`${MOD} | tactics executor`, err); return bad("internal"); }); queue = p.then(() => {}, () => {}); return p; };

/** Run a request as `user` (a Foundry User). meta = { rid, via: "local" | "relay" }. Resolves to an envelope, never rejects. */
export function exec(user, req, meta = {}) {
  if (!user) return Promise.resolve(bad("untrusted"));
  const rid = meta.rid ?? R.makeRid(user.id, `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
  const n = meta.via === "relay" ? { ok: true, req } : R.normalize(req, { staff: Store.isStaff(user) });      // relay requests were normalised by admit()
  if (!n.ok) return Promise.resolve(bad(n.code));
  return enqueue(() => run({ t: "req", user: { id: user.id, staff: Store.isStaff(user) }, rid, req: n.req }, meta.via === "relay" ? `q:${rid}` : null));
}
function onRollMessage(message) {
  try {
    if (!Store.iAmExecutor()) return;
    const r = Sys.readRollMessage(message);
    if (!r || !r.author) return;
    const key = `r:${r.messageId}:${r.pushed}:${r.pushable ? 1 : 0}:${r.sixes}`;
    if (doneRolls.has(key)) return;
    doneRolls.add(key); if (doneRolls.size > 400) doneRolls.delete(doneRolls.values().next().value);
    enqueue(() => run({ t: "roll", ...r }, key));
  } catch (err) { console.warn(`${MOD} | tactics: roll message`, err); }
}

/* ------------------------------------------------------------------ reads for any client (always through the view) */
export function viewer(user = game.user) {
  const combat = Store.combat();
  const owns = combat && !Store.isStaff(user) ? combat.combatants.filter((cb) => cb.actor && Store.owns(cb.actor, user)).map((cb) => cb.id) : [];
  return { id: user.id, staff: Store.isStaff(user), owns };
}
export function view(user = game.user) {
  const combat = Store.combat();
  if (!combat) return null;
  const { state } = Store.read(combat);
  return V.viewFor(state, viewer(user), metaOf(combat));
}
export function journal(user = game.user) { const combat = Store.combat(); return combat ? V.journalFor(Store.read(combat).log, viewer(user)) : []; }
export const context = () => { const combat = Store.combat(); return { c: (cid) => { const cb = combat?.combatants.get(cid); return cb ? { name: cb.name, npc: cb.actor?.type !== "superhero", owners: Store.ownersOf(cb.actor) } : null; }, online: (uid) => game.users.get(uid)?.active === true }; };

export function start() {
  if (started) return;
  started = true;
  Hooks.on("createChatMessage", (m) => onRollMessage(m));
  Hooks.on("updateChatMessage", (m) => onRollMessage(m));                                  // a push re-writes the message's roll
  Sys.warmUp().catch(() => {});
}
