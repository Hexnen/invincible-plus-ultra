/* SYNC (ADVX 5, owner: the GM and the players see the same MOMENT): ONE clock for the table, precise to about a millisecond.
   Foundry's game.time.serverTime is the server's clock as of the last ping (every 30 s), with the AVERAGE one-way trip of the last four
   pings taken off; one slow answer (a busy frame on this page while the ping came back) moves it by tens of ms, and every seat has its
   own error. A moment scheduled on it struck up to two film frames apart between seats that started it on "the same" server time.
   Here: the same "time" socket Foundry pings (the server answers with its Date.now()), measured on this page's performance.now(), and
   the offset of the FASTEST answer among the recent ones is kept (the classic NTP minimum filter: the shortest round trip has the least
   room for error, at most half of it). Bounded by: half the best round trip (local server ~1 ms) plus the server's own ms tick.
     serverNow()           the table's clock now (server ms)
     toPage(serverMs)      that instant on this page's performance.now() clock (what the lettering engine's startAt / blowAt take)
     toServer(pageMs)      the other way
     offset()              server ms minus performance.now() (null before the first answer); the engine's stepped grid takes it (L.gridClock)
     error()               the bound of this seat's error in ms (half the best round trip), null before the first answer
   PURE: estimate(samples). start() pings (a burst at once, then one every EVERY ms). Nothing here throws.
   CALLERS (engine 1.9.11+, ENGREG): the lettering engine now carries the same minimum-filter clock (L.clock, its default under
   L.gridClock and L.net.sharedNow()). Two such clocks on one page each keep their own fastest answer and can disagree by a few ms, and
   this module used to push ITS offset into the engine's grid (L.gridClock), which then also moved the map's words. Now ONE clock: as
   soon as the running engine's L.clock has an answer this module reads it (adopt), stops its own pings and leaves the grid to the
   engine; its own estimate serves only before that (the first second after ready) or under an engine without L.clock. */
export const BURST = 6;          // pings at start (spaced BURST_GAP), so the first moment already has a good clock
export const BURST_GAP = 60;
export const EVERY = 10000;      // then one ping this often
export const KEEP_MS = 120000;   // samples older than this are dropped (drift of the two clocks, a re-synced server clock)
export const PING_TIMEOUT = 3000;

/** the offset of the sample with the shortest round trip among `samples` ([{ off, rtt, at }]); null when none */
export function estimate(samples, now = Infinity, keep = KEEP_MS) {
  let best = null;
  for (const s of samples ?? []) {
    if (!s || !Number.isFinite(s.off) || !Number.isFinite(s.rtt) || s.rtt < 0) continue;
    if (Number.isFinite(now) && Number.isFinite(s.at) && now - s.at > keep) continue;
    if (!best || s.rtt < best.rtt) best = s;
  }
  return best ? { off: best.off, rtt: best.rtt, at: best.at } : null;
}
/** one sample from one ping: sent at t0, answered at t1 (both this page's clock), the server's ms in the answer */
export function sample(t0, t1, server) {
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || !Number.isFinite(server) || t1 < t0) return null;
  return { off: server + 0.5 - (t0 + t1) / 2, rtt: t1 - t0, at: t1 };   // +0.5: the server's Date.now() is floored to the ms
}

const pnow = () => globalThis.performance?.now?.() ?? Date.now();
let samples = [], est = null, started = false, timer = 0;
/* CALLERS: the running engine's clock (L.clock: { now, toPage, toServer, offset, error, ready, state }) once adopted and answered */
let eng = null;
const engOk = () => { try { return !!eng && eng.ready() === true && Number.isFinite(eng.offset()); } catch { return false; } };
/** read the table's time from the running engine's clock (L.clock) from now on; returns true when it is one */
export function adopt(clock) {
  if (!clock || typeof clock.now !== "function" || typeof clock.toPage !== "function" || typeof clock.offset !== "function" || typeof clock.ready !== "function") return false;
  eng = clock;
  return true;
}
export const adopted = () => engOk();
export const source = () => (engOk() ? "engine" : est ? "own" : "foundry");
function foundryNow() { try { const s = globalThis.game?.time?.serverTime; return Number.isFinite(s) ? s : Date.now(); } catch { return Date.now(); } }

export function ping() {
  return new Promise((resolve) => {
    let done = false;
    const end = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const sock = globalThis.game?.socket;
      if (!sock?.emit) return end(null);
      const t0 = pnow();
      sock.emit("time", (time) => {
        const s = sample(t0, pnow(), Number(time?.serverTime));
        if (s) { samples.push(s); samples = samples.filter((x) => s.at - x.at <= KEEP_MS).slice(-40); est = estimate(samples, s.at); }
        end(s);
      });
      setTimeout(() => end(null), PING_TIMEOUT);
    } catch { end(null); }
  });
}
export function start() {
  if (started || typeof globalThis.game?.socket?.emit !== "function") return;
  started = true;
  /* CALLERS: the running engine's clock (called at ready, after init: the copy rule has chosen the engine by then) */
  try { const M = globalThis.MoinenLetters; if (M?.engine) Promise.resolve(M.engine()).then((L) => { if (L?.clock) adopt(L.clock); }).catch(() => {}); } catch { /* own clock */ }
  (async () => {
    for (let i = 0; i < BURST; i++) { if (engOk()) return; await ping(); await new Promise((r) => setTimeout(r, BURST_GAP)); }
    timer = setInterval(() => { if (engOk()) { clearInterval(timer); timer = 0; return; } ping(); }, EVERY);
    timer?.unref?.();
  })();
}
export const ready = () => engOk() || !!est;
export const offset = () => (engOk() ? eng.offset() : est ? est.off : null);
export const error = () => { if (engOk()) { try { const e = eng.error(); if (Number.isFinite(e)) return e; } catch { /* own */ } } return est ? est.rtt / 2 + 0.5 : null; };
export function serverNow() { return engOk() ? eng.now() : est ? pnow() + est.off : foundryNow(); }
export function toPage(serverMs) { return engOk() ? eng.toPage(serverMs) : est ? serverMs - est.off : pnow() + (serverMs - foundryNow()); }
export function toServer(pageMs) { return engOk() ? eng.toServer(pageMs) : est ? pageMs + est.off : foundryNow() + (pageMs - pnow()); }
/** sleep until a server instant (resolves at once when it is past) */
export function sleepUntil(serverMs) { const d = toPage(serverMs) - pnow(); return new Promise((r) => setTimeout(r, Math.max(0, d))); }
/** the lettering engine's stepped grid on this clock (its public hook L.gridClock; the engine's own default is Foundry's serverTime) */
export function driveGrid(L) {
  /* CALLERS: an engine with its own table clock (L.clock, 1.9.11+) keeps its grid on it; this module reads that clock instead (adopt) */
  if (L?.clock && adopt(L.clock)) return;
  try { if (L && typeof L.gridClock === "function") L.gridClock(() => (est ? est.off : foundryNow() - pnow())); } catch { /* the engine keeps its own */ }
}
/* The server's two clocks: the "time" socket answers with its own serverTime (not the epoch: v14 counts it from the server's start, live
   ~5e7 ms), while documents carry the server's Date.now() (`_stats.modifiedTime`, `options.modifiedTime`, epoch ms). Their difference K is
   one constant of the server. A document stamped at epoch E reaches this seat at server time S >= E - K (the delivery takes >= 0), so
   E - S <= K and the LARGEST E - S among the recent stamps is the least delayed one: K to within the fastest delivery (the minimum filter
   again). Fed by every stamped document this seat hears (noteEpoch). */
let epochK = [];   // [{ k, at }]
export function noteEpoch(epochMs, now = serverNow()) {
  const e = Number(epochMs);
  if (!ready() || !Number.isFinite(e) || e < 1e12 || !Number.isFinite(now)) return;      // only on the table's clock (own or the engine's) (an unsynced one would stay as the max)
  epochK.push({ k: e - now, at: now });
  epochK = epochK.filter((x) => now - x.at <= KEEP_MS).slice(-200);
}
/** K = server epoch minus server clock (null before a stamp was heard) */
export function epochOffset(now = serverNow()) {
  let best = null;
  for (const x of epochK) if (now - x.at <= KEEP_MS && (best === null || x.k > best)) best = x.k;
  return best;
}
/** a server epoch stamp on the table's clock (null when unknown) */
export function epochToServer(epochMs) { const k = epochOffset(); return k == null || !Number.isFinite(Number(epochMs)) ? null : Number(epochMs) - k; }
/* for the checks and the live log */
export const state = () => ({ source: source(), samples: samples.length, off: est?.off ?? null, rtt: est?.rtt ?? null, engineOff: engOk() ? eng.offset() : null, foundryOff: foundryNow() - pnow(), epochK: epochOffset(), epochN: epochK.length });
export function _reset() { samples = []; est = null; started = false; clearInterval(timer); epochK = []; eng = null; }
