/* Tactical combat (package P1): STORAGE. The state of a fight is ONE JSON string on its Combat document,
   flags["invincible-plus-ultra"].tactics.state (spec 1.3): a write always replaces the whole value. Foundry delivers the document change to
   every client, so live sync and reconnect come free; every client reads through source.mjs tacticsState() (re-sanitised).
   WRITER: only the executor (the active GM client, spec 1.1) writes, through commit(): a queue on this client, the pure reducer, then a
   compare-and-swap by verification (`rev` + the request id in `seen`), as scripts/session/store.mjs does.
   Besides the flag, a write keeps the core documents in line (spec 3.3) so the core tracker and every module that reads combat.turns /
   combat.combatant stay right: Combatant.initiative = the card, flags.<module>.pos = the place inside a shared card, Combat.round, and
   Combat.turn = the index of the member whose turn it is (null while nobody has it).
   Every document update made here carries the option { ipuTactics: true }. */
import * as S from "./state-pure.mjs";
import * as O from "./ops-pure.mjs";
import * as I from "./initiative-pure.mjs";
import { tacticsState } from "./source.mjs";

export const MOD = S.MOD_ID;
export const SETTLE_MS = 150;
export const CAS_TRIES = 6;
export const HOOK = `${MOD}.tactics`;          // every client: the state of a combat changed
export const HOOK_GM = `${MOD}.tacticsGm`;     // executor only: events and effects of a commit (for the action engine and the journal, P2)
export const UPDATE_OPT = { ipuTactics: true };

const subs = new Set();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ settings, identity */
export const setting = (key, fallback) => { try { return game.settings.get(MOD, key); } catch { return fallback; } };
export const isStaff = (u) => !!u && (u.isGM === true || u.hasRole?.(CONST.USER_ROLES.ASSISTANT) === true);
export const iAmExecutor = () => !!game.user?.isGM && game.users.activeGM?.id === game.user.id;
export const ownerLevel = () => CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;

/* ------------------------------------------------------------------ reads */
export const stateOf = (combat) => tacticsState(combat);
export const combatOf = (ref) => (typeof ref === "string" ? game.combats?.get(ref) ?? null : ref ?? null);
/** the combat the table is looking at: the active one of the viewed scene, else the one the tracker shows */
export function currentCombat() {
  try { const a = game.combats?.active; if (a) return a; } catch { /* none */ }
  try { return game.combat ?? null; } catch { return null; }
}

/* ------------------------------------------------------------------ subscriptions */
export function subscribe(fn) { if (typeof fn !== "function") return () => {}; subs.add(fn); return () => subs.delete(fn); }
export function notify(info) {
  for (const fn of [...subs]) { try { fn(info); } catch (e) { console.warn(`${MOD} | tactics subscriber failed`, e); } }
  try { Hooks.callAll(HOOK, info); } catch { /* a hook listener threw */ }
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
/** Bring the core documents in line with `state` and store it. state = null removes the module's state (the cards stay as initiative values). */
export async function write(combat, state) {
  /* The sort of the turns (combat-class.mjs) uses the card order only for a combat that has the state, and a client re-sorts only when
     combatants change: so when the state appears or disappears, every combatant is written once without diff. */
  const all = () => combat.combatants.map((c) => ({ _id: c.id, initiative: c.initiative ?? null, [`flags.${MOD}.pos`]: Number(c.flags?.[MOD]?.pos ?? 0) }));
  if (!state) {
    if (!stateOf(combat)) return;
    await combat.update({ [`flags.${MOD}.tactics.state`]: "" }, { ...UPDATE_OPT });
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
  const round = Math.max(0, state.round), turn = idx >= 0 ? idx : null;
  if (combat.round !== round) data.round = round;
  if ((combat.turn ?? null) !== turn) data.turn = turn;
  await combat.update(data, { ...UPDATE_OPT, direction: 1 });
}

/** Apply ONE reducer action to a combat. Resolves to the reducer result plus { attempts }; never throws.
    mkCtx() is called for every attempt so the participants are read from the documents as they are then. */
export function commit(combatRef, action, mkCtx, { low = false } = {}) {
  return queue(async () => {
    let r = null;
    try {
      for (let attempt = 1; attempt <= CAS_TRIES; attempt++) {
        const combat = combatOf(combatRef);
        if (!combat) return S.err("gone");
        const cur = stateOf(combat);
        r = O.reduce(cur, action, mkCtx(combat));
        r.attempts = attempt;
        if (!r.ok || !r.changed) return r;
        await write(combat, r.state);
        await wait(SETTLE_MS);
        const now = stateOf(combatOf(combatRef));
        const applied = r.state === null ? !now : (action.rid ? S.hasSeen(now, action.rid) : (now?.rev ?? -1) >= r.state.rev);
        if (applied) return r;
        await wait(Math.random() * SETTLE_MS * attempt);       // lost a race with another GM tab: back off, read again, apply again (the rid makes a double application a no-op)
      }
      return S.err("busy");
    } catch (e) {
      console.warn(`${MOD} | tactics commit failed`, e);
      return S.err("internal", { msg: String(e?.message ?? e).slice(0, 80) });
    }
  }, { low });
}
