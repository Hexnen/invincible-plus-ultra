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
/* UXB (U151): A SPLASH THAT WAITS FOR THE VERDICT. The success word of an attack roll ("WHAM!") promised a hit before the defence was
   rolled. The tactics side tells here what an exchange came to (told: one exchange `inst`, one target, hit or not); the splash asks
   (verdict) and plays the word only when the attack landed (a defence's word: only when it held). No rule here either: ids and booleans.
     listen()                                     the tactics side feeds verdicts on this client (only then does the splash wait for one)
     told(inst, target, hit)                      what the exchange came to for that target
     verdict(inst, { target, cap }) -> Promise<true | false | null>   any target hit (or that target's), null = no verdict within cap ms */
const verdicts = new Map(), askers = new Set();
let hears = false;
export function listen() { hears = true; }
export const listens = () => hears;
export function told(inst, target, hit) {
  if (!inst || typeof hit !== "boolean") return;
  const k = String(inst), v = verdicts.get(k) ?? { at: now(), rows: {} };
  v.rows[target ? String(target) : "*"] = hit; v.last = now(); verdicts.set(k, v);
  if (verdicts.size > 200) for (const key of [...verdicts.keys()].slice(0, 100)) verdicts.delete(key);
  /* the outcomes of one exchange come in one burst (one per target): the askers hear them all together */
  setTimeout(() => { for (const a of [...askers]) a(); }, 0);
}
/* sweep S049: on a player's client each target's outcome is its own socket message, so a burst can arrive split over several tasks. Without a
   target a hit answers at once; "nobody was hit" only after QUIET_MS without another outcome of that exchange (a later hit still counts). */
export const QUIET_MS = 250;
const read = (inst, target) => { const v = verdicts.get(String(inst)); if (!v) return null; const rows = v.rows;
  if (target) return typeof rows[String(target)] === "boolean" ? rows[String(target)] : null;
  if (Object.values(rows).some((h) => h === true)) return true;
  return now() - (v.last ?? 0) >= QUIET_MS ? false : null; };
export function verdict(inst, { target = null, cap = 20000 } = {}) {
  const got = read(inst, target);
  if (got !== null || !inst) return Promise.resolve(got);
  return new Promise((resolve) => {
    const done = (v) => { askers.delete(ask); clearTimeout(tc); resolve(v); };
    let tq = 0;
    const ask = () => {
      const v = read(inst, target);
      if (v !== null) { clearTimeout(tq); return done(v); }
      const last = verdicts.get(String(inst))?.last;   // misses so far: look again when the exchange has been quiet long enough
      if (!target && last != null) { clearTimeout(tq); tq = setTimeout(ask, Math.max(0, QUIET_MS - (now() - last)) + 1); }
    };
    const tc = setTimeout(() => { clearTimeout(tq); done(null); }, Math.max(0, cap));
    askers.add(ask);
    ask();
  });
}
/* the checks: what is pending now */
export const state = () => ({ on, pending: [...pending].map((p) => ({ tokens: [...p.tokens], age: Math.round(now() - p.at) })) });
