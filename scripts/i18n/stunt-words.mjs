/* What a stunt does, in the reader's language, for the roll cards in the chat (the confirmed stunt tags and the stunt picker).
   ONE wording for the whole module: the tips of the tactical stunt cards (scripts/tactics/lang.mjs, ITAC.ui.stunt.tip.*), our own short
   words, for all twelve stunts and both languages (module.js stuntTip). The system's Quickstart journal, read before, described only seven
   stunts, in English only, and two of them by older rules than the system applies.
   The stored tag text is in the language of the client that rolled, so it is matched with isLabel (both languages), never one localize().
   Pure: no Foundry global at import time. */
import { isLabel, MATCH_LABELS } from "./sys-labels.mjs";
import { tIn } from "../tactics/lang.mjs";

/** the system's stunt key -> our stunt id (scripts/rules/stunts.mjs, ITAC.ui.stunt.tip.<id>) */
export const STUNT_IDS = Object.freeze({
  DoubleDamage: "doubleDamage", Knockback: "knockback", Stun: "stun", BangHeads: "bangHeads", Trap: "trap", Disarm: "disarm",
  DeadlyHit: "deadlyHit", Slam: "slam", Suppressed: "suppressed", TrickShot: "trickShot", SpecialStunt: "special", YourOwn: "own"
});
const labelKey = (sys) => `INVINCIBLE.Stunts.${sys}.label`;
const isPl = (lang) => String(lang ?? "").toLowerCase().startsWith("pl");

/** The system key of a stunt tag's text ("Knockback: 2 zone(s)", "Zderzenie głów (2): obrażenia 3", "TrickShot"), or null. */
export function stuntKeyOf(text) {
  const head = String(text ?? "").split(/[:(]/)[0];
  for (const sys of Object.keys(STUNT_IDS)) if (isLabel(head, labelKey(sys))) return sys;
  return null;
}

/** { name, text } of a system stunt key in `lang` ("en" | "pl" ...; anything not Polish reads English), or null for an unknown key. */
export function stuntWords(sys, lang) {
  const id = STUNT_IDS[sys];
  if (!id) return null;
  const key = `ITAC.ui.stunt.tip.${id}`, text = tIn(lang, key, {}, "");
  const names = MATCH_LABELS[labelKey(sys)];
  if (!text || text === key || !names) return null;
  return { name: names[isPl(lang) ? 1 : 0], text };
}
