/* Tactical combat: STORAGE, the one store. The state of a fight is ONE JSON string on its Combat document,
   flags["invincible-plus-ultra"].tactics.state (spec 1.3): a write always replaces the whole value. The journal of the fight is a second
   JSON string next to it, tactics.log (spec 15), written only when it changed. Foundry delivers the document change to every client, so
   live sync and reconnect come free; every client reads through source.mjs tacticsState() (re-sanitised).
   WRITER: only the executor (the active GM client, spec 1.1) writes, from engine.mjs: one job at a time on this client (queue), one
   write per request. A request that reached several tabs of the executor runs on one of them (claim) and is deduplicated a second
   time by its request id in `state.seen`. There is no blind retry of a lost write: the action engine carries out its effects on
   documents while it runs, so running a request twice would apply them twice.
   Besides the flags, a write keeps the core documents in line (spec 3.3) so the core tracker and every module that reads combat.turns /
   combat.combatant stay right: Combatant.initiative = the card, flags.<module>.pos = the place inside a shared card, Combat.round, and
   Combat.turn = the index of the member whose turn it is (null while nobody has it).
   Every document update made here carries the option { ipuTactics: true }. */
import * as S from "./state-pure.mjs";
import * as I from "./initiative-pure.mjs";
import * as J from "./journal-pure.mjs";
import { tacticsState } from "./source.mjs";

export const MOD = S.MOD_ID;
export const SETTLE_MS = 150;
export const HOOK = `${MOD}.tactics`;          // every client: one public event of a fight (spec 16), already filtered by the public view
export const HOOK_GM = `${MOD}.tacticsGm`;     // executor only: every event, unfiltered (spec 16)
export const UPDATE_OPT = { ipuTactics: true };

const subs = new Set();
const TAB = Math.random().toString(36).slice(2, 10);
let settleMs = SETTLE_MS;
/** Test helper: how long a claim waits before it reads itself back. */
export const _setSettle = (ms) => { settleMs = Math.max(0, Number(ms) || 0); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ settings, identity */
export const setting = (key, fallback) => { try { return game.settings.get(MOD, key); } catch { return fallback; } };
export const isStaff = (u) => !!u && (u.isGM === true || u.hasRole?.(CONST.USER_ROLES.ASSISTANT) === true);
export const iAmExecutor = () => !!game.user?.isGM && game.users.activeGM?.id === game.user.id;
export const ownerLevel = () => CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;

/* ------------------------------------------------------------------ reads */
export const stateOf = (combat) => tacticsState(combat);
const flagsOf = (combat) => combat?.flags?.[MOD]?.tactics ?? null;
const logCache = new WeakMap();
/** the journal of a fight (parsed, cached by the raw flag string; never mutate it) */
export function logOf(combat) {
  if (!combat || typeof combat !== "object") return J.emptyLog();
  const raw = typeof flagsOf(combat)?.log === "string" ? flagsOf(combat).log : "";
  const hit = logCache.get(combat);
  if (hit && hit.raw === raw) return hit.log;
  const log = J.parseLog(raw);
  logCache.set(combat, { raw, log });
  return log;
}
/** { state | null, log } of a combat as the documents hold them now */
export const read = (combat) => ({ state: stateOf(combat), log: logOf(combat) });
export const combatOf = (ref) => (typeof ref === "string" ? game.combats?.get(ref) ?? null : ref ?? null);
/** the combat the table is looking at: the active one of the viewed scene, else the one the tracker shows */
export function currentCombat() {
  try { const a = game.combats?.active; if (a) return a; } catch { /* none */ }
  try { return game.combat ?? null; } catch { return null; }
}

/* ------------------------------------------------------------------ subscriptions: "the state (or the journal) of a combat changed", for the
   widgets of this client. fn({ kind: "state" | "deleted", combat, state }). The EVENTS of a fight are on the two hooks above. */
export function subscribe(fn) { if (typeof fn !== "function") return () => {}; subs.add(fn); return () => subs.delete(fn); }
export function notify(info) {
  for (const fn of [...subs]) { try { fn(info); } catch (e) { console.warn(`${MOD} | tactics subscriber failed`, e); } }
}

/* ------------------------------------------------------------------ the queue (one job at a time on this client; staff before players) */
const lanes = { hi: [], lo: [] };
let pumping = false;
async function pump() {
  if (pumping) return;
  pumping = true;
  try { for (;;) { const job = lanes.hi.shift() ?? lanes.lo.shift(); if (!job) break; try { job.res(await job.fn()); } catch (e) { job.rej(e); } } } finally { pumping = false; }
}
export const queue = (fn, { low = false } = {}) => new Promise((res, rej) => { (low ? lanes.lo : lanes.hi).push({ fn, res, rej }); pump(); });

/* ------------------------------------------------------------------ writes (executor only) */
/** Bring the core documents in line with `state` and store it, with the journal when one is given (it is written only when it changed).
    state = null removes the module's state and journal (the cards stay as initiative values). */
export async function write(combat, state, log = undefined) {
  /* The sort of the turns (combat-class.mjs) uses the card order only for a combat that has the state, and a client re-sorts only when
     combatants change: so when the state appears or disappears, every combatant is written once without diff. */
  const all = () => combat.combatants.map((c) => ({ _id: c.id, initiative: c.initiative ?? null, [`flags.${MOD}.pos`]: Number(c.flags?.[MOD]?.pos ?? 0) }));
  if (!state) {
    if (!stateOf(combat)) return;
    await combat.update({ [`flags.${MOD}.tactics.state`]: "", [`flags.${MOD}.tactics.log`]: "", [`flags.${MOD}.tactics.claim`]: "" }, { ...UPDATE_OPT });
    if (combat.combatants.size) await combat.updateEmbeddedDocuments("Combatant", all(), { ...UPDATE_OPT, turnEvents: false, diff: false });
    return;
  }
  const want = I.docSync(state.init);
  const raw = S.serialize(state);
  const hadState = !!stateOf(combat);
  if (!hadState) await combat.update({ [`flags.${MOD}.tactics.state`]: raw }, { ...UPDATE_OPT });
  const ups = [];
  for (const c of combat.combatants) {
    const w = want[c.id] ?? { initiative: null, pos: 0 };
    const pos = Number(c.flags?.[MOD]?.pos ?? 0);
    if (!hadState || (c.initiative ?? null) !== w.initiative || pos !== w.pos) ups.push({ _id: c.id, initiative: w.initiative, [`flags.${MOD}.pos`]: w.pos });
  }
  if (ups.length) await combat.updateEmbeddedDocuments("Combatant", ups, { ...UPDATE_OPT, turnEvents: false, ...(hadState ? {} : { diff: false }) });
  const cur = state.init.curMember;
  const idx = cur ? combat.turns.findIndex((c) => c.id === cur) : -1;
  const data = { [`flags.${MOD}.tactics.state`]: raw };
  if (log) data[`flags.${MOD}.tactics.log`] = J.serializeLog(log);
  else if (!hadState) data[`flags.${MOD}.tactics.log`] = J.serializeLog(J.emptyLog());        // a new fight starts with an empty journal
  const round = Math.max(0, state.round), turn = idx >= 0 ? idx : null;
  if (combat.round !== round) data.round = round;
  if ((combat.turn ?? null) !== turn) data.turn = turn;
  await combat.update(data, { ...UPDATE_OPT, direction: 1 });
}

/** Single execution when several tabs of the executor receive the same request or see the same roll message: the flag `tactics.claim`
    holds "<key>|<tabId>". A tab writes its claim only when no claim for that key is visible, waits SETTLE_MS and goes on only if the
    claim it reads back is its own. A tab that comes later sees the earlier claim and yields. -> true: this tab runs it */
export async function claim(combat, key) {
  try {
    const seen = () => String(flagsOf(combat)?.claim ?? "");
    if (seen().startsWith(`${key}|`)) return seen() === `${key}|${TAB}`;
    await wait(Math.floor(Math.random() * Math.min(40, settleMs)));
    if (seen().startsWith(`${key}|`)) return seen() === `${key}|${TAB}`;
    await combat.update({ [`flags.${MOD}.tactics.claim`]: `${key}|${TAB}` }, { ...UPDATE_OPT });
    await wait(settleMs);
    return seen() === `${key}|${TAB}`;
  } catch (e) { console.warn(`${MOD} | tactics claim failed`, e); return false; }
}
