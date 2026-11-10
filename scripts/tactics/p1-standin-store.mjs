/* STAND-IN FOR P1's STORE (drop at the merge: P1 owns the Combat-flag store of spec 1.3). Kept thin on purpose.
   What P2's executor needs from the real store, and nothing more:
     MOD, isStaff(user), iAmExecutor(), owns(actor, user)
     combat()                         -> the tactical Combat document or null
     read(combat)                     -> { state, log }            parsed from the two JSON-string flags (spec 1.3)
     write(combat, state, log?)       -> Promise                    whole-value replace; state.rev incremented
     claim(combat, key)               -> Promise<boolean>           single execution when several tabs of the executor receive the same request
     begin(combat, opts) / end(combat)                              create / remove the state (P1's start / stop of a tactical combat)
     onChange(fn) -> off                                            state or log flag changed (every client)
   [D] claim protocol: the flag `tactics.claim` holds "<key>|<tabId>". A tab writes its claim only when no claim for that key is visible, waits
   SETTLE_MS and proceeds only if the claim it reads back is its own. Two tabs that write at the same moment both read the same final value; a tab
   that comes later sees the earlier claim and yields. The engine's own `state.seen` dedupe (spec 1.3) stays as the second line. */
import * as P1 from "./p1-standin.mjs";
import * as J from "./journal-pure.mjs";

export const MOD = "invincible-plus-ultra";
export const SETTLE_MS = 150;
const TAB = Math.random().toString(36).slice(2, 10);
const subs = new Set();
let hooked = false, cache = { raw: null, state: null }, logCache = { raw: null, log: null };

export const isStaff = (u) => !!u && (u.isGM === true || u.hasRole?.(CONST.USER_ROLES.ASSISTANT) === true);
export const iAmExecutor = () => !!game.user?.isGM && game.users.activeGM?.id === game.user.id;
const OWNER = () => CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
/** Real ownership table only (spec 12.2): explicit OWNER entry for the user, or the default level. A claimed role never counts. */
export const owns = (actor, user) => !!actor && !!user && (Number(actor.ownership?.[user.id] ?? actor.ownership?.default ?? 0) >= OWNER());
export const ownersOf = (actor) => (actor ? game.users.filter((u) => !u.isGM && owns(actor, u)).map((u) => u.id) : []);

const flags = (combat) => combat?.flags?.[MOD]?.tactics ?? null;
export function combat() {
  const c = game.combat ?? null;
  return c && typeof flags(c)?.state === "string" && flags(c).state ? c : null;
}
export function read(c) {
  const f = flags(c);
  if (!f || typeof f.state !== "string" || !f.state) return { state: null, log: J.emptyLog() };
  if (cache.raw !== f.state) cache = { raw: f.state, state: P1.parse(f.state) };
  const lr = typeof f.log === "string" ? f.log : "";
  if (logCache.raw !== lr) logCache = { raw: lr, log: J.parseLog(lr) };
  return { state: cache.state, log: logCache.log };
}
export async function write(c, state, log = null) {
  const data = { [`flags.${MOD}.tactics.state`]: P1.serialize({ ...state, rev: (state.rev ?? 0) + 1 }) };
  if (log) data[`flags.${MOD}.tactics.log`] = J.serializeLog(log);
  await c.update(data, { ipuTactics: true });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export async function claim(c, key) {
  try {
    const seen = String(flags(c)?.claim ?? "");
    if (seen.startsWith(`${key}|`)) return seen === `${key}|${TAB}`;
    await wait(Math.floor(Math.random() * 40));
    const again = String(flags(c)?.claim ?? "");
    if (again.startsWith(`${key}|`)) return again === `${key}|${TAB}`;
    await c.update({ [`flags.${MOD}.tactics.claim`]: `${key}|${TAB}` }, { ipuTactics: true });
    await wait(SETTLE_MS);
    return String(flags(c)?.claim ?? "") === `${key}|${TAB}`;
  } catch (err) { console.warn(`${MOD} | tactics: claim failed`, err); return false; }
}
export async function begin(c, opts = {}) {
  if (!c || flags(c)?.state) return false;
  let state = P1.emptyState(opts);
  state = P1.setOrder(state, c.turns.map((t) => ({ members: [t.id] })));                 // STAND-IN: Foundry's own order, one slot each (P1 draws cards)
  if (c.turns[0]) state = P1.startTurn(state, c.turns[0].id);
  await c.update({ [`flags.${MOD}.tactics`]: { state: P1.serialize(state), log: J.serializeLog(J.emptyLog()), claim: "" } }, { ipuTactics: true });
  return true;
}
export async function end(c) { if (c && flags(c)) await c.update({ [`flags.${MOD}.-=tactics`]: null }, { ipuTactics: true }); }

export function onChange(fn) {
  if (!hooked) {
    hooked = true;
    Hooks.on("updateCombat", (doc, change) => { if (change?.flags?.[MOD]?.tactics === undefined && !change?.flags?.[MOD]?.["-=tactics"]) return; if (change.flags[MOD].tactics && Object.keys(change.flags[MOD].tactics).every((k) => k === "claim")) return; for (const f of subs) { try { f(doc); } catch (err) { console.warn(`${MOD} | tactics subscriber`, err); } } });
    Hooks.on("deleteCombat", (doc) => { for (const f of subs) { try { f(doc); } catch { /* ignore */ } } });
  }
  subs.add(fn);
  return () => subs.delete(fn);
}
