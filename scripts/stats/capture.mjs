/* Plus Ultra STATISTICS, capture. Runs on the WRITER only (the active GM's client, store.isWriter); every other client only reads.
   TACTICAL: the engine's full stream (spec 16) on the hook invincible-plus-ultra.tacticsGm, paired with the public stream of the same event
   (invincible-plus-ultra.tactics, called right after it on the executor): an event the public stream did not carry, or carried without
   somebody it names, is a GM-only fact (the view's own rule, view-pure.publicEvent). An undo takes back every fact of its transaction, an
   aborted action every fact of its instance. A fight is "tactical" because the engine ran it: nothing here reads the world setting.
   FIGHTS: the first event of a fight opens its record (pure.newFight); its participants are written as the events name them; the record
   is closed (t1, who ended dead / unconscious / broken, who stayed hidden) when the scene ends, the GM stops the fight or the Combat is
   deleted. The record outlives the Combat.
   LOOSE: the system's roll cards and the module's Damage Taken cards (chat), outside the engine. A push replaces the roll it re-threw (the
   system deletes the old card and posts a new one), the undo of a Damage Taken card (module.js runUndo: Health back, card deleted) takes
   its damage back, a chat flush (deleteAll) takes nothing back. Messages written while no GM was connected are caught up from the chat
   (store hw = the newest message already taken). A "self" roll never reaches the GM and is never counted. */
import * as P from "./pure.mjs";
import * as Store from "./store.mjs";
import { isLabel } from "../i18n/sys-labels.mjs";
import { damageFacts, rollModeOf } from "../log/capture-pure.mjs";

const MOD = P.MOD;
const HOOK = `${MOD}.tactics`, HOOK_GM = `${MOD}.tacticsGm`;
const LOG = `${MOD} | stats`;
const DMG_KEY = "INVINCIBLE.Chat.DamageInfo.DamageTaken";
const pend = [], pub = new Set(), deleted = [], actorsSeen = new Map();
let tick = 0;

const evKey = (e) => `${e?.combat ?? ""}|${e?.fight ?? ""}|${e?.seq ?? ""}`;
const worldActorId = (ref) => { const m = /(?:^|\.)Actor\.([A-Za-z0-9]{16})$/.exec(String(ref ?? "")); return m ? m[1] : /^[A-Za-z0-9]{16}$/.test(String(ref ?? "")) ? String(ref) : null; };
const owners = (actor) => Object.entries(actor?.ownership ?? {}).filter(([u, l]) => u !== "default" && l >= 3 && game.users.get(u) && !game.users.get(u).isGM).map(([u]) => u).sort();

/** the registry line of an actor (name, picture, player character?, its players): written when it first shows or changes */
function seeActor(id) {
  if (!id) return;
  const a = game.actors.get(id); if (!a) return;
  const rec = { n: String(a.name ?? "").slice(0, 80), i: String(a.img ?? "").slice(0, 300), h: a.hasPlayerOwner ? 1 : 0, ty: String(a.type ?? "").slice(0, 20), own: owners(a) };
  const was = actorsSeen.get(id) ?? Store.actorRec(id), same = was && JSON.stringify(was) === JSON.stringify(rec);
  actorsSeen.set(id, rec);
  if (!same) Store.actor(id, rec);
}
const sideOf = (cb) => { const a = cb?.actor; if (a?.hasPlayerOwner) return "h"; return cb?.token?.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY ? "h" : "n"; };
const hiddenNow = (combat, cb, state) => cb.hidden === true || cb.token?.hidden === true || Object.values(state?.knowledge ?? {}).some((row) => row?.[cb.id] === "unseen")
  || (Array.isArray(combat?.flags?.[MOD]?.hidLeft) && combat.flags[MOD].hidLeft.includes(cb.id));
const OUTS = ["dead", "unconscious", "broken"];

/* ------------------------------------------------------------------ tactical */
function onGm(ev) { try { if (!Store.isWriter() || !ev?.fight) return; pend.push(ev); if (!tick) tick = setTimeout(processEvents, 0); } catch (e) { console.warn(LOG, e); } }
function onPub(ev) { try { if (Store.isWriter() && ev?.fight) pub.add(evKey(ev)); } catch { /* nothing */ } }

function processEvents() {
  tick = 0;
  const list = pend.splice(0), seen = new Set(pub); pub.clear();
  const touched = new Map();
  for (const ev of list) {
    try {
      const combat = game.combats.get(ev.combat) ?? null, f = P.fightKey(ev.combat, ev.fight);
      let rec = touched.get(f) ?? Store.fightRec(f);
      if (!rec) rec = P.newFight(f, ev.combat, ev.at ?? Date.now(), combat?.scene?.name ?? "");
      rec = { ...rec, pc: { ...rec.pc }, r: Math.max(rec.r ?? 0, Number(ev.round) || 0), ...(ev.type === "chase" ? { chase: 1 } : {}) };
      const state = combat ? Store_state(combat) : null;
      const who = (cid) => {
        const cb = combat?.combatants.get(cid);
        if (cb) {
          const a = cb.actorId ?? null;
          if (a && !rec.pc[cid]) rec.pc[cid] = { a, n: String(cb.name ?? "").slice(0, 80), i: String(cb.img ?? cb.token?.texture?.src ?? "").slice(0, 300), s: sideOf(cb), ...(hiddenNow(combat, cb, state) ? { hid: 1 } : {}) };
          if (a) seeActor(a);
          return a ? { a, side: sideOf(cb), minion: cb.actor?.type === "minions" } : null;
        }
        const p = rec.pc[cid];
        return p ? { a: p.a, side: p.s, minion: false } : null;
      };
      const out = P.factsOfEvent(ev, { who, pub: seen.has(evKey(ev)), user: (mid) => game.messages.get(mid)?.author?.id ?? null });
      if (out.drop) Store.dropWhere(out.drop);
      if (out.facts.length) Store.put(out.facts);
      if (state?.phase === "sceneEnd") rec = closeRec(rec, combat, state);
      touched.set(f, rec);
    } catch (e) { console.warn(LOG, "event not counted", ev?.type, e); }
  }
  for (const [f, rec] of touched) Store.fight(f, rec);
}
let Store_state = () => null;      // set by start(): the tactics store's reader (tactics/store.mjs stateOf), loaded only when tactics is there

/** the fight is over: when, and how each participant came out of it (as far as the table knows: hidden ones keep hid) */
function closeRec(rec, combat, state) {
  const pc = { ...rec.pc };
  for (const [cid, p] of Object.entries(pc)) {
    const cb = combat?.combatants.get(cid);
    const st = state?.statuses?.[cid] ?? [];
    const out = OUTS.find((s) => st.some((x) => x?.id === s)) ?? (cb?.defeated ? "dead" : null);
    pc[cid] = { ...p, ...(out ? { out } : {}), ...(cb ? (hiddenNow(combat, cb, state) ? { hid: 1 } : { hid: 0 }) : {}) };
    if (!pc[cid].hid) delete pc[cid].hid;
    if (!out) delete pc[cid].out;
  }
  return { ...rec, pc, t1: Date.now() };
}
function openFightsOf(combatId) { return Object.values(Store.fightsAll()).filter((r) => r?.c === combatId && !r.t1).map((r) => r.f); }
function endFights(combat, state) {
  if (!Store.isWriter() || !combat) return;
  for (const f of openFightsOf(combat.id)) { const rec = Store.fightRec(f); if (rec && !rec.t1) Store.fight(f, closeRec(rec, combat, state)); }
}
function onUpdateCombat(combat, changes) {
  try {
    if (!Store.isWriter()) return;
    const raw = changes?.flags?.[MOD]?.tactics?.state;
    if (raw === "") endFights(combat, null);       // the GM stopped the fight (tactics/store.mjs write(null))
  } catch (e) { console.warn(LOG, e); }
}
function onPreDeleteCombat(combat) { try { endFights(combat, Store_state(combat)); } catch (e) { console.warn(LOG, e); } }

/* ------------------------------------------------------------------ loose */
const isDamageCard = (m) => !!m?.flavor && isLabel(m.flavor, DMG_KEY);
function looseOf(message) {
  if (!message || message.flags?.[MOD]?.tactics) return null;                                  // the engine's own cards
  const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id), author = message.author?.id ?? message.author ?? null;
  const mode = rollModeOf({ whisper: message.whisper, blind: message.blind, author }, gmIds);
  if (mode === "self") return null;
  const time = Number(message.timestamp) || Date.now();
  if (isDamageCard(message)) {
    const target = worldActorId(message.speaker?.actor), d = damageFacts(message.content), dmg = message.flags?.[MOD]?.dmg ?? {};
    if (!target) return null;
    const attackerId = worldActorId(dmg.attacker?.id);
    seeActor(target); if (attackerId) seeActor(attackerId);
    return { facts: P.factsOfDamageCard({ id: message.id, actorId: target, attackerId, amount: d.amount, from: dmg.from, to: dmg.to, broken: !!d.injury, time, mode }) };
  }
  const roll = message.rolls?.[0];
  if (!roll || roll.options?.tactics || roll.successCount === undefined) return null;          // a tactical roll is the engine's; a roll that is no Year Zero pool is not a check
  const actorId = worldActorId(message.speaker?.actor);
  if (!actorId) return null;
  seeActor(actorId);
  const dice = []; try { for (const die of roll.dice ?? []) for (const r of die.results ?? []) if (Number.isFinite(r.result)) dice.push(r.result); } catch { /* none */ }
  const fact = P.factOfRoll({ id: message.id, actorId, userId: author, time, mode, flavor: message.flavor ?? "",
    roll: { successCount: roll.successCount, baneCount: roll.baneCount, pushCount: roll.pushCount, dice, attackDamage: roll.attackDamage, stressCost: roll.options?.stressCost } });
  return fact ? { facts: [fact], roll: fact } : null;
}
function takeMessage(message) {
  const got = looseOf(message);
  Store.highWater(Number(message?.timestamp) || 0);
  if (!got) return;
  if (got.roll && got.roll.p > 0) {
    const now = Date.now(), recent = deleted.filter((d) => now - d.at < 60000).map((d) => d.id);
    const parent = P.pushParent([...Store.all().facts, ...pendingRolls], got.roll, recent);
    if (parent) Store.drop([parent]);
  }
  for (const x of got.facts) if (x.k === "roll" && x.m === "l") { pendingRolls.push(x); if (pendingRolls.length > 30) pendingRolls.shift(); }
  Store.put(got.facts);
}
const pendingRolls = [];
function onCreateMessage(message) { try { if (Store.isWriter()) takeMessage(message); } catch (e) { console.warn(LOG, "roll not counted", e); } }
function onDeleteMessage(message, options) {
  try {
    if (!Store.isWriter() || options?.deleteAll) return;                                       // clearing the chat takes no statistic back
    if (message.rolls?.length) { deleted.push({ id: P.safe(`m_${message.id}`), at: Date.now() }); while (deleted.length > 30) deleted.shift(); }
    if (!isDamageCard(message)) return;
    const dmg = message.flags?.[MOD]?.dmg ?? {}, actor = game.actors.get(worldActorId(message.speaker?.actor) ?? "");
    const hp = Number(actor?.system?.derived?.health?.value);
    /* the undo of the card puts Health back first and deletes the card after: Health at the "from" of the card = the hit was taken back.
       A card the GM deletes by hand (Health still lowered) stays a statistic */
    if (!Number.isFinite(dmg.from) || hp === dmg.from) Store.drop([P.safe(`dc_${message.id}`), P.safe(`dx_${message.id}`)]);
  } catch (e) { console.warn(LOG, e); }
}
/** the chat written while no GM was connected (or before this module counted) */
export function catchUp() {
  if (!Store.isWriter()) return 0;
  const hw = Store.all().hw;
  const list = [...game.messages].filter((m) => (Number(m.timestamp) || 0) > hw).sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  let n = 0;
  for (const m of list) { try { takeMessage(m); n++; } catch { /* one card */ } }
  return n;
}

export function start({ stateOf = null } = {}) {
  if (typeof stateOf === "function") Store_state = stateOf;
  Hooks.on(HOOK_GM, onGm);
  Hooks.on(HOOK, onPub);
  Hooks.on("updateCombat", onUpdateCombat);
  Hooks.on("preDeleteCombat", onPreDeleteCombat);
  Hooks.on("createChatMessage", onCreateMessage);
  Hooks.on("deleteChatMessage", onDeleteMessage);
}
export const _test = { processEvents, takeMessage, looseOf, closeRec };
