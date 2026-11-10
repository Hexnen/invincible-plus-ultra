/* Tactical combat (package P1): the EXECUTOR (spec 1.1, 12.1). Every request, a local click on the active GM's client or a relayed one,
   ends in exec(sender, combatId, req, meta): meta = { trusted, via: "local" | "relay", proto?, bytes? }. `trusted` = the sender id is the
   server's word (second argument of the socket listener) or this very client.
   Nothing in a payload is believed: identity = `sender`, staff = the sender's REAL role, ownership = the REAL ownership table of the
   combatant's actor, the request is re-normalised to whitelisted fields (ops-pure.normalize), non-staff are limited in size, rate and
   requests in flight, and the reducer checks everything again against the state as it is when the request is applied.
   After a commit the executor carries out the reducer's effects (stress, recovery) and announces events and effects on the hook
   "invincible-plus-ultra.tacticsGm" for the action engine and the journal (P2). Returns an envelope and never throws. */
import * as S from "./state-pure.mjs";
import * as O from "./ops-pure.mjs";
import * as Store from "./store.mjs";
import * as Sys from "./system-adapter.mjs";

const MOD = Store.MOD;
const hits = new Map(), inflight = new Map();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ctr = 0;

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
export const startMode = () => (Store.setting("tacticsEnabled", false) === true ? "tactical" : "free");                             // spec 1.4

function mkCtx(sender, staff) {
  return (combat) => ({
    user: sender.id, staff,
    owns: (id) => Sys.owns(combat.combatants.get(id), sender),
    parts: Sys.participants(combat),
    rng,
    playersEnd: Store.setting("turnPlayersEnd", true) !== false,
    sceneFacts: Sys.sceneFacts(combat)
  });
}

async function after(combat, r, action) {
  if (!r?.ok || !r.changed) return;
  const done = { stress: [], recovered: [] };
  for (const fx of r.effects ?? []) {
    try {
      if (fx.type === "stress") { if (await Sys.applyStress(combat, fx.combatant, fx.n)) done.stress.push(fx.combatant); }
      else if (fx.type === "recover") done.recovered = await Sys.applyRecovery(combat, fx.lines);
    } catch (e) { console.warn(`${MOD} | tactics effect failed`, fx?.type, e); }
  }
  try { Hooks.callAll(Store.HOOK_GM, { combat, action: action.type, rid: action.rid, events: r.events ?? [], effects: r.effects ?? [], applied: done, state: r.state }); } catch { /* a listener threw */ }
}

/** Run one request on this (executor) client. */
export async function exec(sender, combatId, req, meta = {}) {
  try {
    if (Number(meta.proto) > O.PROTO) return S.err("stale", { theirs: Number(meta.proto), mine: O.PROTO });
    if (!sender || meta.trusted !== true) return S.err("untrusted");
    if (!Store.iAmExecutor()) return S.err("noGM");
    const staff = Store.isStaff(sender);
    if (!staff) {
      if (meta.via !== "relay" && meta.via !== "local") return S.err("untrusted");
      let bytes = Number(meta.bytes);
      if (!Number.isFinite(bytes)) { try { bytes = JSON.stringify(req ?? null).length; } catch { bytes = Infinity; } }
      if (bytes > O.MAX_BYTES) return S.err("badInput", { reason: "tooBig" });
      if (!O.rateHit(hits, sender.id, Date.now())) return S.err("rate");
      if ((inflight.get(sender.id) ?? 0) >= O.MAX_INFLIGHT) return S.err("rate");
    }
    const n = O.normalize(req, { staff });
    if (!n.ok) return n;
    const combat = Store.combatOf(combatId);
    if (!combat) return S.err("gone");
    const action = { ...n.action, rid: O.makeRid(sender.id, req.id ?? `l${++ctr}${Math.random().toString(36).slice(2, 6)}`) };
    if (action.type === "start") {
      action.mode ??= startMode();
      action.opts = { ...startOpts(), ...(action.opts ?? {}) };
    }
    if (meta.via === "relay" && !meta.noJitter) await wait(Math.random() * 120);     // two GM tabs of one user both receive a request: the loser finds the rid already applied
    inflight.set(sender.id, (inflight.get(sender.id) ?? 0) + 1);
    try {
      const r = await Store.commit(combat.id, action, mkCtx(sender, staff), { low: !staff });
      await after(Store.combatOf(combat.id) ?? combat, r, action);
      return r.ok ? { ok: true, changed: !!r.changed, rev: r.state?.rev ?? null, ...(r.dup ? { dup: true } : {}) } : r;      // the requester reads the state from the document
    } finally { inflight.set(sender.id, Math.max(0, (inflight.get(sender.id) ?? 1) - 1)); }
  } catch (e) {
    console.warn(`${MOD} | tactics request failed`, e);
    return S.err("internal", { msg: String(e?.message ?? e).slice(0, 80) });
  }
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
      if (Store.iAmExecutor() && Store.stateOf(Store.combatOf(combat.id))) exec(game.user, combat.id, { op: "roster" }, { trusted: true, via: "local", noJitter: true });
    }, 60));
  } catch (e) { console.warn(`${MOD} | tactics roster`, e); }
}
/** Test helper: forget the rate counters. */
export const _resetLimits = () => { hits.clear(); inflight.clear(); };
