/* FXLD2 (ADVD2 8): one start for the whole table. Every seat waits for its own Dice So Nice animation, and the dice do not stop at the
   same instant everywhere (the roller's start first, the others after the message reached them; live: GM 22.1 s, player 22.3 s). So each
   seat says when its dice stopped (server time, the module's socket), and every seat starts the moment at the same server time: the
   latest stop it heard of plus a short margin, once every seat that shows the roll has reported or at most CAP ms after its own stop.
   PURE except start() (it reads the clock and sleeps through the hooks given). */
export const CAP = 700;      // the longest a seat waits for the others after its own dice stopped
export const MARGIN = 120;   // room for the last report to travel
const reports = new Map();   // message id -> Map(user id -> server ms when that seat's dice stopped)
const waiters = new Map();   // message id -> [fn] (a report arrived)

export function note(id, user, at) {
  if (!id || !user || !Number.isFinite(at)) return;
  let m = reports.get(id);
  if (!m) { m = new Map(); reports.set(id, m); if (reports.size > 200) reports.delete(reports.keys().next().value); }
  if (!m.has(user)) m.set(user, at);
  for (const fn of waiters.get(id) ?? []) fn();
}
export function heard(id) { return new Map(reports.get(id) ?? []); }
/* the shared start: the latest stop heard + MARGIN; complete = every expected seat has reported */
export function target(heardMap, expected = [], margin = MARGIN) {
  const ats = [...heardMap.values()];
  const complete = expected.every(u => heardMap.has(u));
  return { at: ats.length ? Math.max(...ats) + margin : null, complete };
}
/* wait for the start: resolves with the ms this seat still waited. env = { now() (server ms), sleep(ms), cap, margin } */
export async function start(id, me, ownAt, expected, env) {
  const cap = env.cap ?? CAP, margin = env.margin ?? MARGIN;
  note(id, me, ownAt);
  const t0 = env.now();
  while (!target(heard(id), expected, margin).complete && env.now() - ownAt < cap) {
    await new Promise((res) => {
      const list = waiters.get(id) ?? [];
      const fn = () => res();
      list.push(fn); waiters.set(id, list);
      env.sleep(Math.max(10, Math.min(60, cap - (env.now() - ownAt)))).then(res);
    });
  }
  waiters.delete(id);
  const { at } = target(heard(id), expected, margin);
  const d = Math.max(0, Math.min(cap + margin, (at ?? ownAt) - env.now()));
  if (d > 0) await env.sleep(d);
  return env.now() - t0;
}
export function forget(id) { reports.delete(id); waiters.delete(id); }
