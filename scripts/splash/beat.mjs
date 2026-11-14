/* FXLD2 (ADVD2 8): one start for the whole table. Every seat waits for its own Dice So Nice animation, and the dice do not stop at the
   same instant everywhere (the roller's start first, the others after the message reached them; live: GM 22.1 s, player 22.3 s). So each
   seat says when its dice stopped (server time, the module's socket), and every seat starts the moment at the same server time: the
   latest stop it heard of plus a short margin, once every seat that shows the roll has reported.
   SYNC (ADVX 5: a critical struck 171 and 291 ms apart): the old rule also stopped waiting CAP ms after a seat's OWN stop. Seats whose dice
   stop more than CAP - MARGIN apart (live: 0.75-0.87 s) then did not agree: the early seat gave up and started on its own stop, the late
   one started on the latest stop it heard. A wait bounded by each seat's own instant can never agree. Now the bound is ONE instant every
   seat knows: the roll's instant on the table's clock (`ref`: the roller's flag t0, main.mjs stampOf) plus WINDOW. A stop reported after that bound counts on no seat
   (that seat's dice are late: it joins the table's instant, see main.mjs); every seat waits until all expected seats have reported or
   the bound plus SLACK (a report on its way) has passed, and all count the same reports, so all compute the same start.
   A report may carry `x` (ms the table adds after the stops: a seat whose moment is lettered on the map waits for the dice to fade there,
   and every seat waits with it, so the instant is one whatever layer each seat chose).
   PURE except start() (it reads the clock and sleeps through the hooks given). */
export const CAP = 700;      // without a shared stamp (a preview, an old message): the longest a seat waits after its own stop (the old rule)
export const MARGIN = 120;   // room for the last report to travel
export const WINDOW = 6000;  // SYNC: a stop counts when it came at most this long after the roll's stamp (DSN: ~3-3.5 s live; slow dice settings more)
export const SLACK = 300;    // SYNC: after the bound, the reports still on their way
const reports = new Map();   // message id -> Map(user id -> { at: server ms when that seat's dice stopped, x })
const waiters = new Map();   // message id -> [fn] (a report arrived)

export function note(id, user, at, x = 0, p2 = false) {
  if (!id || !user || !Number.isFinite(at)) return;
  let m = reports.get(id);
  if (!m) { m = new Map(); reports.set(id, m); if (reports.size > 200) reports.delete(reports.keys().next().value); }
  if (!m.has(user)) m.set(user, { at, x: Number.isFinite(x) && x > 0 ? Math.min(2000, x) : 0, p2: p2 === true });
  for (const fn of waiters.get(id) ?? []) fn();
}
const atOf = (v) => (typeof v === "number" ? v : v?.at);
const xOf = (v) => (typeof v === "number" ? 0 : (v?.x ?? 0));
export function heard(id) { return new Map(reports.get(id) ?? []); }
/* the shared start: the latest stop heard + MARGIN (+ the largest `x` of the counted reports); complete = every expected seat has reported.
   With `bound` (ref + WINDOW): only stops at or before it count (the same set on every seat). Without any counted stop: null. */
export function target(heardMap, expected = [], margin = MARGIN, bound = Infinity) {
  const vals = [...heardMap.values()].filter((v) => Number.isFinite(atOf(v)) && atOf(v) <= bound);
  /* a seat whose stop came after the bound does not complete the set (it counts nowhere; every seat then waits for the bound + SLACK) */
  const complete = expected.every(u => heardMap.has(u) && atOf(heardMap.get(u)) <= bound);
  const at = vals.length ? Math.max(...vals.map(atOf)) + margin + Math.max(0, ...vals.map(xOf)) : null;
  return { at, complete, counted: vals.length, base: vals.length ? Math.max(...vals.map(atOf)) + margin : null };
}
/* wait for the start. env = { now() (server ms), sleep(ms), cap, margin, ref?, window?, slack?, x? }.
   ownAt = this seat's stop (null: this seat's dice are still rolling at the bound, it only joins).
   -> { at (the shared start, server ms), base (the start without the counted x), waited (ms), complete, late (this seat's stop did not count) } */
export async function start(id, me, ownAt, expected, env) {
  const cap = env.cap ?? CAP, margin = env.margin ?? MARGIN;
  const shared = Number.isFinite(env.ref);
  const bound = shared ? env.ref + (env.window ?? WINDOW) : Infinity, slack = env.slack ?? SLACK;
  if (Number.isFinite(ownAt)) note(id, me, ownAt, env.x ?? 0);
  const t0 = env.now();
  const open = () => !target(heard(id), expected, margin, bound).complete && (shared ? env.now() < bound + slack : env.now() - ownAt < cap);
  while (open()) {
    await new Promise((res) => {
      const list = waiters.get(id) ?? [];
      const fn = () => res();
      list.push(fn); waiters.set(id, list);
      const left = shared ? bound + slack - env.now() : cap - (env.now() - ownAt);
      env.sleep(Math.max(10, Math.min(60, left))).then(res);
    });
  }
  waiters.delete(id);
  const t = target(heard(id), expected, margin, bound);
  let at = t.at, base = t.base;
  if (at == null) { at = base = shared ? bound + slack : (Number.isFinite(ownAt) ? ownAt : env.now()) + margin; }      // nobody counted
  /* not complete = some seat is late or missing: every seat waited to the same bound + SLACK, so that is the earliest start they share */
  if (shared && !t.complete) { const x = Math.max(0, at - base); base = Math.max(base, bound + slack); at = Math.max(at, base + x); }
  const late = shared && (!Number.isFinite(ownAt) || ownAt > bound);
  /* the old rule keeps its bound on the sleep; the shared one sleeps to the table's instant (never more than its own bound allows) */
  const lim = shared ? (bound + slack + margin + 2000) - env.now() : cap + margin;
  const d = Math.max(0, Math.min(lim, at - env.now()));
  if (!shared && d > 0) await env.sleep(d);
  return { at, base, waited: env.now() - t0, complete: t.complete, late, counted: t.counted };
}
export function forget(id) { reports.delete(id); waiters.delete(id); }
