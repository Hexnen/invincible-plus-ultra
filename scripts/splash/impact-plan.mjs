/* WIRE1: which dice-roll results get an impact frame (the lettering engine's L.impact, scripts/letters/impact/) and how strong. PURE.
   The owner (2026-11-13/14): impact frames may go all out and must be spectacular, but they are a brief accent at the instant the result
   lands, never a lasting cover; one per event, never in a loop; the strongest moment gets the strongest frame; every seat sees the same
   moment. So the choice depends on the event alone (its rarity, the action, a wreck), never on a seat's own settings (the full-screen
   threshold `fullFrom` is a client setting: the critical here is a fixed rarity, the default of that setting), and the strength rises with
   the rarity: a strong result gets a short local accent (no full-field frame), the critical the full set, the rarer the more.
     impactFor(ev, { fx }) -> null | { kind, magnitude (0..2, the engine's), tone?, hitstop? } */
export const CRIT_P = 0.7;      // the critical: about 1 in 60 or rarer (powerOf; the default `fullFrom` of the full-screen moment)
export const STRONG_P = 0.46;   // a strong result: about 1 in 18 or rarer ("UNLIKELY HERO!" and up); below it no impact frame
export const STRONG_MAX = 0.84; // a strong result stays under the engine's full-field strengths (its tier 1: the scene hard black and white for a tick)
/* the kind of a strong result by what the roll does: a blow lands (hit), a charge or a hold crushes (heavy), a shot zaps (shock); what is
   not a blow (a dodge, a block, a clever idea, a presence) only gets the accent behind its word */
export const ACTION_KIND = { slugfest: "hit", generic: "hit", charge: "heavy", grapple: "heavy", shooting: "shock" };
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;

export function impactFor(ev, o = {}) {
  if (!ev || ev.fail || !Number.isFinite(ev.power) || ev.power < STRONG_P) return null;
  const fx = Number.isFinite(o.fx) ? o.fx : 1;
  if (!(fx > 0)) return null;      // the splash's Effects setting "off": no effects at all
  const P = ev.power;
  let kind, magnitude;
  if (P >= CRIT_P) {
    /* 1.1 (the engine's tier 2: silhouette frame, the negative slam, the colour split) at the threshold, the whole set (tier 3, 1.35+)
       from about 1 in 120, 2 at the rarest */
    kind = "crit";
    magnitude = 1.1 + 0.9 * clamp((P - CRIT_P) / 0.25) + (ev.wreck ? 0.15 : 0);
  } else {
    kind = ACTION_KIND[ev.action] ?? "word";
    if (ev.wreck && kind === "hit") kind = "heavy";      // the blow wrecks the surroundings too (cracks)
    magnitude = Math.min(STRONG_MAX, 0.45 + 0.35 * clamp((P - STRONG_P) / (CRIT_P - STRONG_P)) + (ev.wreck ? 0.15 : 0));
  }
  const out = { kind, magnitude: r2(clamp(magnitude, 0, 2)) };
  if (ev.npc) out.tone = "void";      // a villain's roll: violet and cyan, not the hero's yellow and blue
  if (fx < 1) { out.magnitude = r2(Math.max(0.2, out.magnitude - 0.5)); out.hitstop = false; }      // Effects "reduced": one strength lower, no hold of the scene
  return out;
}
/* the seed of a roll's impact: the message id every seat shares (the words' seed is the same id + their role) */
export const impactSeed = (seed) => `${seed ?? "x"}:impact`;
