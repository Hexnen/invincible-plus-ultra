/* Team & Base card, L3b: the ONE gate to the activity log's explicit record call (api.log.record) used by ops.mjs / sync.mjs.
   Logging is optional and must never change what an operation does: the call is guarded (module or log api absent / disabled -> no-op), wrapped in try / catch,
   NOT awaited (record is async and never throws; a rejected promise is swallowed), so no operation waits for, or fails because of, the log. */
const MOD = "invincible-plus-ultra";
export function logRecord(target, spec) {
  try {
    const m = globalThis.game?.modules?.get?.(MOD);
    const api = m?.active ? m.api?.log : null;
    if (!api || typeof api.record !== "function") return;
    const p = api.record(target, spec);
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (_) { /* logging must never break an operation */ }
}
