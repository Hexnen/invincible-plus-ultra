/* Tactical combat: THE AUTO-SKIP TICK (ANSA; answers UXC-1 / K1, FXP-6, FXN-1 of 2026-11-12).
   «pytanie czy koniec ale w pasku inicjatywy na górze dodaj tick że auto skip jeśli brak akcji dostepnych»: ending a turn always asks;
   a tick on the initiative bar at the top lets a turn with nothing left pass by itself (1.5 s; 3.5 s with the hourglass line for a turn
   that started spent), on a player's seat and on the GM's alike.
   WHOSE: each user's own, off until they tick it. It is kept in the user's layout flag (layout-pure `autoSkip`, ui/main.mjs remember),
   so it follows the user to another machine, and the GM's tick governs the NPC turns the GM drives.
   This module is only the shared switch: the initiative bar (scripts/combat/bar.mjs) draws and flips it, the dock's model reads it
   (facts.autoSkip), ui/main.mjs loads it from the layout and writes it back. Pure: no Foundry here. */
let on = false;
const subs = new Set();
/** is the tick on for this user? */
export const get = () => on;
/** set it; `quiet` = loading what was stored (nobody is told, nothing is written back). Returns the new value. */
export function set(v, { quiet = false } = {}) {
  const next = v === true;
  if (next === on) return on;
  on = next;
  if (!quiet) for (const f of [...subs]) { try { f(on); } catch { /* a listener's failure is its own */ } }
  return on;
}
/** flip it (the tick's click) */
export const toggle = () => set(!on);
/** be told of a change; returns the unsubscribe */
export function listen(f) { subs.add(f); return () => subs.delete(f); }
