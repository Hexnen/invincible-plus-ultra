/* SPLASHSEAT (the owner: the GM and every player see the same picture at the same moment; lettering never hides important things, the roll
   card, a panel's text, a token, and is never hidden by them. ADVS3 D1, tag 161, live on two seats with ONE window size and ONE view: the
   same roll's block stood right of the heroes, against the roll card, on the GM's seat and far left on the player's; D13: the critical's
   caption ended on the roll card's edge and on the challenges' panel).
   The cause (stage.mjs compose, SPLASHCLEAR-1): each seat kept the block off ITS OWN panels (the GM's scene list and map meter, a player's
   open window), so the canonical block of the view (SPLASHBLOCK) was refused on one seat for a panel the other seat does not have, and
   each seat then searched by itself. What a seat has open is not shared data, so no rule on one seat alone can give one picture AND keep
   it off every seat's panels.
   Now the seats TELL each other: when a roll arrives every seat that will show it says what stands on its screen (its panels, its open
   windows, the column its chat cards pop up in), as boxes measured from the middle of its window (the standard view is the reference
   window centred in each seat's window, same-picture.mjs: the same convention). Every seat places the block off the UNION of all the
   seats' boxes, so two seats with one window and one view get one list and one block; a seat with another window gets the same boxes
   round its own middle. A report is taken once per roll and seat (the first counts: the layout made while the dice roll is the one
   played, ROLLSTALL) and travels on the module's socket BEFORE that seat's dice report, so a seat that has every dice report (beat.mjs)
   has every list.
   PURE: no Foundry, no DOM (stage.mjs seatReport measures, main.mjs sends). */
export const VERSION = 1;
export const MAX_RECTS = 40;      // boxes one seat may tell (the rest are dropped: the biggest first)
export const MAX_IDS = 120;       // rolls remembered
export const MIN_SIDE = 8;        // a box thinner than this is nothing a word can hide
export const SNAP_PX = 2;         // boxes are told on a 2 px grid (two seats' panels a sub-pixel apart are one box)
const store = new Map();          // roll id -> Map(user id -> report)
const waiters = new Map();        // roll id -> [fn]

const num = (v) => Number.isFinite(v);
/* a report as it may be kept: { v, w, h, o: [[l, t, r, b]] } (client px of a w x h window) or { v, none: true } (a seat that shows
   nothing: its splash off, its tab hidden). Anything else: null. Never trusts the sender: sizes bounded, boxes inside its window, counted */
export function clean(r) {
  if (!r || typeof r !== 'object' || r.v !== VERSION) return null;
  if (r.none === true) return { v: VERSION, none: true };
  const w = Number(r.w), h = Number(r.h);
  if (!num(w) || !num(h) || w < 200 || h < 200 || w > 16000 || h > 16000 || !Array.isArray(r.o)) return null;
  const o = [];
  for (const q of r.o) {
    if (!Array.isArray(q) || q.length < 4 || !q.slice(0, 4).every(num)) continue;
    const l = Math.max(0, Math.min(w, q[0])), t = Math.max(0, Math.min(h, q[1])), rr = Math.max(0, Math.min(w, q[2])), b = Math.max(0, Math.min(h, q[3]));
    if (rr - l < MIN_SIDE || b - t < MIN_SIDE) continue;
    const g = (v) => Math.round(v / SNAP_PX) * SNAP_PX;
    o.push([g(l), g(t), g(rr), g(b)]);
  }
  o.sort((a, c) => (c[2] - c[0]) * (c[3] - c[1]) - (a[2] - a[0]) * (a[3] - a[1]) || a[0] - c[0] || a[1] - c[1] || a[2] - c[2] || a[3] - c[3]);
  return { v: VERSION, w: Math.round(w), h: Math.round(h), o: tidy(o.slice(0, MAX_RECTS)) };
}
/* boxes without the ones another box holds whole, in one order whatever order they came in */
export function tidy(list) {
  const out = [];
  for (const q of list) {
    if (out.some((p) => p[0] <= q[0] && p[1] <= q[1] && p[2] >= q[2] && p[3] >= q[3])) continue;
    for (let i = out.length - 1; i >= 0; i--) { const p = out[i]; if (q[0] <= p[0] && q[1] <= p[1] && q[2] >= p[2] && q[3] >= p[3]) out.splice(i, 1); }
    out.push(q);
  }
  return out.sort((a, c) => a[0] - c[0] || a[1] - c[1] || a[2] - c[2] || a[3] - c[3]);
}
/* a seat's report for a roll: the first one counts (a second is ignored: what was laid out ahead stays what is played). -> kept or not */
export function note(id, user, report) {
  if (typeof id !== 'string' || !id || typeof user !== 'string' || !user) return false;
  const r = clean(report);
  if (!r) return false;
  let m = store.get(id);
  if (!m) { m = new Map(); store.set(id, m); if (store.size > MAX_IDS) store.delete(store.keys().next().value); }
  if (m.has(user)) return false;
  m.set(user, r);
  for (const fn of waiters.get(id) ?? []) fn();
  return true;
}
export function has(id, user) { return !!store.get(id)?.has(user); }
export function heard(id) { return new Map(store.get(id) ?? []); }
export function forget(id) { store.delete(id); waiters.delete(id); }
export function complete(id, expected = []) { const m = store.get(id); return expected.every((u) => m?.has(u)); }
/* wait until every expected seat has told its list, at most ms. env: { sleep(ms), now() }. -> complete or not */
export async function wait(id, expected, ms, env) {
  const t0 = env.now();
  while (!complete(id, expected) && env.now() - t0 < ms) {
    await new Promise((res) => {
      const list = waiters.get(id) ?? [];
      list.push(res); waiters.set(id, list);
      env.sleep(Math.max(5, Math.min(40, ms - (env.now() - t0)))).then(res);
    });
  }
  waiters.delete(id);
  return complete(id, expected);
}
/* the table's list for a W x H window: every seat's boxes, each measured from the middle of its sender's window and set round the middle
   of this one (a window of the sender's size: the box as told), cut to this window, tidied, in one order.
   -> { rects: [{ l, t, r, b }], seats: how many lists it holds, users: their ids in order } or null (no seat has told anything for the roll) */
export function unionFor(id, W, H) {
  const m = store.get(id);
  if (!m || !m.size) return null;
  const users = [...m.keys()].sort(), all = [];
  let seats = 0;
  for (const u of users) {
    const r = m.get(u);
    if (r.none) continue;
    seats++;
    const dx = Math.round((W - r.w) / 2), dy = Math.round((H - r.h) / 2);
    for (const q of r.o) {
      const l = Math.max(0, q[0] + dx), t = Math.max(0, q[1] + dy), rr = Math.min(W, q[2] + dx), b = Math.min(H, q[3] + dy);
      if (rr - l >= MIN_SIDE && b - t >= MIN_SIDE) all.push([l, t, rr, b]);
    }
  }
  all.sort((a, c) => (c[2] - c[0]) * (c[3] - c[1]) - (a[2] - a[0]) * (a[3] - a[1]) || a[0] - c[0] || a[1] - c[1] || a[2] - c[2] || a[3] - c[3]);
  return { rects: tidy(all).map(([l, t, r, b]) => ({ l, t, r, b })), seats, users };
}
