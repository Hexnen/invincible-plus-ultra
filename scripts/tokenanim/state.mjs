/* KODOWN: is this token's character DOWN (Health 0)? The one place the token animations read character data, and only as a yes / no.
   Why that is no leak: a fall to 0 Health is already shown to every seat that sees the token, as the same "down" reaction (tokenreact
   PRIV: one reaction kind for every seat); the lying picture says nothing more, never a number (owner 2026-11-14, «Tak»: a knocked-down
   token stays down while it has 0 Health). A seat that does not see the token is never shown it (main.mjs draws only seen tokens).
   Who can lie (provisional, KODOWN-2 in combat-questions.md): every actor with a Health track (max > 0) except a challenge, whose
   "Health" is its rating counting down to being overcome: a challenge does not fall. A token without an actor never lies. */

/** a body that can fall over: an actor that is not a challenge */
export function faller(tok) {
  try { const a = tok?.actor; return !!a && a.type !== "challenge"; } catch { return false; }
}
/** the token's character is at 0 Health (the system's own "broken by damage" test: max > 0 and value 0) */
export function downOf(tok) {
  try {
    if (!faller(tok)) return false;
    const h = tok.actor.system?.derived?.health;
    if (!h || h.value === null || h.value === undefined || h.value === "") return false;
    const v = Number(h.value), m = Number(h.max);
    return Number.isFinite(v) && Number.isFinite(m) && m > 0 && v <= 0;
  } catch { return false; }
}
/** an actor update that may change Health (its value or its max) */
export function healthTouched(changes) {
  try {
    const d = changes?.system?.derived ?? globalThis.foundry?.utils?.getProperty?.(globalThis.foundry.utils.expandObject(changes ?? {}), "system.derived");
    return !!d && typeof d === "object" && "health" in d;
  } catch { return false; }
}
/** the actor's tokens on the viewed scene */
export function tokensOf(actor) {
  try { return actor?.getActiveTokens?.() ?? []; } catch { return []; }
}
