/* Tactical combat, D125: THE TRACE of what a combatant's facts could not carry. NO Foundry globals.
   A reader of the facts (movement-pure.modesOf, moves-pure.movementOf, the kit, the system adapter) that meets data it cannot read keeps
   going, but it never drops a capability without a word [D]: it calls `note` here. Each different note is kept once (the readers run on every
   render), the last ones are listed for the API (`api.tactics.dropped()`), and the sink that main.mjs installs tells the console and the GM.
   A note: { kind, area, who, what, raw, error }
     kind   "dropped"  a capability is left out (a way of moving, a kit entry, all of an actor's facts)
            "guessed"  a value was not one the rules know and was read as the book's default (a power level read as basic [B298], [B1214])
     area   which reader: "move" | "movement" | "kit" | "facts" | "weapons" | "level"
     who    the combatant's or the actor's name; what: the item's or the way's name; raw: the value that was read; error: the error's text */
const SEEN = new Set(), LOG = [];
const MAX_SEEN = 500, MAX_LOG = 40;
let sink = null;
const str = (v, n = 80) => String(v ?? "").slice(0, n);

/** main.mjs: where a note goes on this client (the console, and a notification for the GM). null: nowhere but the list. */
export function setSink(fn) { sink = typeof fn === "function" ? fn : null; }
/** -> the note when it is new (and was handed to the sink), else null */
export function note(kind, area, who, what, raw = "", error = null) {
  const n = { kind: kind === "guessed" ? "guessed" : "dropped", area: str(area, 20), who: str(who), what: str(what), raw: str(raw, 40), error: error == null ? "" : str(error?.message ?? error, 200) };
  const key = `${n.kind}|${n.area}|${n.who}|${n.what}|${n.raw}`;
  if (SEEN.has(key)) return null;
  if (SEEN.size >= MAX_SEEN) SEEN.clear();
  SEEN.add(key);
  LOG.push(n);
  if (LOG.length > MAX_LOG) LOG.shift();
  try { sink?.(n); } catch { /* a sink that fails must not break the reader that called it; the note stays in the list */ }
  return n;
}
/** the last notes, oldest first */
export const recent = () => LOG.map((n) => ({ ...n }));
/** for the node checks */
export function reset() { SEEN.clear(); LOG.length = 0; sink = null; }
