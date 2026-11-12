/* ONE MOMENT (ledger U125 e): the comic splash of a roll and the action camera's result beat of the same blow land together.
   The tactics camera holds a result beat until the 3D dice of the roll settle (as the splash always did) and then tells, here, when
   its blow lands on screen (the map's `shot` answers `lands`, moinen-maps zones-api.md section 39). The splash asks here before it
   pops: when a result beat for one of its tokens is on its way it waits for that landing (never longer than `cap`), so the "POW!"
   and the flash and shake are one moment. Nothing here knows a rule of the game or the map: tokens in, a time out.
     active(on)                         the tactics camera runs a fight on this client (only then does the splash wait at all)
     expect(tokens) -> { land(ms), drop() }  a result beat for these token ids is on its way; land(ms): it lands in ms; drop(): it will not play
     landing(tokens, { wait, cap }) -> Promise<number>   resolves when a beat expected for any of the tokens lands (ms waited);
                                                          with none expected it looks `wait` ms for one to be announced, then goes */
const pending = new Set();
let on = false;
const waiters = new Set();
const now = () => (globalThis.performance?.now?.() ?? Date.now());

export function active(v) { on = !!v; if (!on) { for (const p of [...pending]) settle(p); } }
export const isActive = () => on;

function settle(p) {
  if (!pending.has(p)) return;
  pending.delete(p);
  for (const r of p.ready) r();
  p.ready.length = 0;
}
export function expect(tokens) {
  const p = { tokens: new Set((Array.isArray(tokens) ? tokens : [tokens]).filter(Boolean).map(String)), ready: [], at: now(), t: 0 };
  if (!p.tokens.size) return { land() {}, drop() {} };
  pending.add(p);
  /* never more than 15 s: dice that never settle, a beat that never answers */
  p.t = setTimeout(() => settle(p), 15000);
  for (const w of [...waiters]) w();
  return {
    land(ms) { clearTimeout(p.t); const d = Math.max(0, Number(ms) || 0); if (d) p.t = setTimeout(() => settle(p), d); else settle(p); },
    drop() { clearTimeout(p.t); settle(p); },
  };
}
const find = (ids) => [...pending].find((p) => ids.some((id) => p.tokens.has(id))) ?? null;
export function landing(tokens, { wait = 0, cap = 1600 } = {}) {
  const ids = (Array.isArray(tokens) ? tokens : [tokens]).filter(Boolean).map(String), t0 = now();
  if (!ids.length) return Promise.resolve(0);
  return new Promise((resolve) => {
    let done = false, tWait = 0;
    const tCap = setTimeout(() => finish(), Math.max(0, cap));
    const finish = () => { if (done) return; done = true; clearTimeout(tCap); clearTimeout(tWait); waiters.delete(look); resolve(Math.round(now() - t0)); };
    const look = () => { const p = find(ids); if (!p) return false; waiters.delete(look); clearTimeout(tWait); p.ready.push(finish); return true; };
    if (look()) return;
    if (!on || wait <= 0) return finish();
    waiters.add(look);
    tWait = setTimeout(finish, wait);
  });
}
/* the checks: what is pending now */
export const state = () => ({ on, pending: [...pending].map((p) => ({ tokens: [...p.tokens], age: Math.round(now() - p.at) })) });
