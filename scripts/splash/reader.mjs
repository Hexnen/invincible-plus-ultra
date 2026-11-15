/* Czytnik rzutu: ChatMessage z YearZeroRoll (system invincible) -> płaski opis rzutu "rd".
   Nie zakłada niczego poza strukturą wyników kości (results[].indexPush / indexResult / active / discarded). */

import { isLabel, hasLabelWord } from '../i18n/sys-labels.mjs';
import { heroActor } from '../tactics/source.mjs';
import { familyOf } from './words.mjs';

/* H3-4: strona mówiącego według jednej reguły modułu (state-pure.heroSide przez tactics/source.heroActor, D114): bohater gracza albo
   postać z przyjaznym żetonem; złoczyńca z podręcznika (aktor superhero bez gracza) jest przeciwnikiem. */
export function speakerToken(message) {
  try { const sp = message?.speaker ?? {}; return (sp.scene && sp.token ? globalThis.game?.scenes?.get?.(sp.scene)?.tokens?.get?.(sp.token) : null) ?? null; } catch { return null; }
}
/* przywołani sojusznicy bohatera stoją po stronie bohaterów [B1808]: jak w silniku (engine.isNpc), strona przywołującego z flagi uczestnika walki */
function summoner(message) {
  try {
    const tid = message?.speaker?.token;
    if (!tid) return null;
    for (const c of globalThis.game?.combats ?? []) {
      const of = c.combatants?.find?.((x) => x.tokenId === tid)?.flags?.['invincible-plus-ultra']?.tactics?.summonOf, s = of ? c.combatants.get(of) : null;
      if (s) return { actor: s.actor ?? null, token: s.token ?? null };
    }
  } catch { /* brak walki */ }
  return null;
}
export function heroSpeaker(message) {
  const users = globalThis.game?.users ?? [], sm = summoner(message);
  return heroActor(message?.speakerActor ?? null, speakerToken(message), users) || (!!sm && heroActor(sm.actor, sm.token, users));
}
/** Resolve, który splash może upublicznić (flaga wiadomości, wskaźnik): tylko strony bohaterów; Resolve przeciwników nie jest ujawniany */
export const publicResolve = (message) => (heroSpeaker(message) ? message.speakerActor?.system?.derived?.resolve ?? null : null);

const ATTRS = ['fighting', 'agility', 'strength', 'reason', 'intuition', 'presence'];
/* Nazwy w rzucie (flavor, breakdown) to tekst zapisany w języku klienta, który rzucał: dopasowanie w każdym znanym języku. */
const attrKey = a => `INVINCIBLE.Actor.base.FIELDS.attributes.${a}.label`;

/* Czy to rzut kośćmi bazowymi Year Zero z systemu invincible? */
export function getYZRoll(message) {
  const roll = message?.rolls?.[0];
  const term = roll?.terms?.[0];
  if (!roll || !term || !Array.isArray(term.results) || !term.results.length) return null;
  const isInv = roll.options?.game === 'inv' || term.constructor?.TYPE === 'base';
  return isInv ? roll : null;
}

/* Klasyfikacja akcji z danych dostępnych w dialogu rzutu albo (zapasowo) z gotowej wiadomości. WORDPOOL (ADVX 16): co to za akcja mówi
   rodzina słów (words.mjs familyOf): obrona taktyczna, własny rzut systemu (Blok / Unik / Szarża / Chwyt po nazwie), nazwa mocy lub
   sprzętu (dane angielskie, wiersz zestawu taktyki), typ ataku z systemu, atrybut. attack = rzut jest ciosem (jego klatka uderzenia
   spada na cel). Wejście: attackType (slugfest/charge/shooting, tylko ataki), flavor (tytuł rzutu), names (breakdown), attribute,
   item ({ name, type, source }: moc / sprzęt za rzutem), tactics (rollOptions.tactics: { key, what }). */
export function classify({ attackType, flavor, names = [], attribute = null, item = null, tactics = null }) {
  attribute = attribute ?? ATTRS.find(a => isLabel(names[0], attrKey(a))) ?? null;
  const wreck = names.some(n => isLabel(n, 'INVINCIBLE.Actor.base.FIELDS.derived.slugfest.wreckZoneBonus'));
  /* cały wyraz (nie podciąg): "Roadblock" nie jest "Block", "Charged Beam" nie jest "Charge" */
  const has = key => hasLabelWord(flavor, key);
  let sysAction = null;
  if (has('INVINCIBLE.Actor.base.FIELDS.derived.slugfest.charge')) sysAction = 'charge';
  else if (has('INVINCIBLE.Actor.base.FIELDS.derived.slugfest.grapple')) sysAction = 'grapple';
  else if (has('INVINCIBLE.Actor.base.FIELDS.block.label')) sysAction = 'block';
  else if (has('INVINCIBLE.Actor.base.FIELDS.dodge.label')) sysAction = 'dodge';
  /* the power's name: its English data name (a compendium copy keeps it; a renamed one is what its user typed), then the roll's title */
  const itemName = item && typeof item === 'object' ? String(item.name ?? '') : '';
  const tac = tactics && typeof tactics === 'object' ? { key: tactics.key, what: tactics.what } : null;
  const { action, attack } = familyOf({ attackType: attackType === 'charge' || attackType === 'shooting' || attackType === 'slugfest' ? attackType : undefined,
    attribute, sysAction: attackType === 'shooting' || attackType === 'slugfest' ? null : sysAction, names: [itemName, flavor], itemType: item?.type ?? null, tactics: tac });
  return { action, attribute, wreck, attack };
}

/* Akcja i atrybut: najpierw znacznik z opakowanego dialogu, potem dopasowanie zlokalizowanych nazw. */
export function inferAction(roll, flavor) {
  const tag = roll.options?.splash;
  if (tag?.action) return { action: tag.action, attribute: tag.attribute ?? null, wreck: !!tag.wreck, attack: typeof tag.attack === 'boolean' ? tag.attack : null };   // a tag from before WORDPOOL: unknown
  const names = (roll.options?.breakdown ?? []).map(b => b?.name);
  return classify({ attackType: roll.options?.attackType, flavor, names, tactics: roll.options?.tactics ?? null });
}

export function readRoll(message) {
  const roll = getYZRoll(message);
  if (!roll) return null;
  const results = roll.terms[0].results;
  const idxPush = r => r.indexPush ?? 0;
  const initial = results.filter(r => idxPush(r) === 0).sort((a, b) => (a.indexResult ?? 0) - (b.indexResult ?? 0));
  const n = initial.length;
  if (n < 1) return null;

  const first = initial.map(r => r.result);
  const final = results.filter(r => r.active).sort((a, b) => (a.indexResult ?? 0) - (b.indexResult ?? 0)).map(r => r.result);
  const pushCount = roll.pushCount ?? results.reduce((m, r) => Math.max(m, idxPush(r)), 0);
  const pushed = pushCount > 0;
  const lastPush = results.filter(r => idxPush(r) === pushCount && pushed);
  const sixes = final.filter(v => v === 6).length;
  const newSixes = pushed ? lastPush.filter(r => r.result === 6).length : 0;
  const rerolled = pushed ? lastPush.length : 0;
  const pushable = !!roll.pushable;

  /* stres: system sam nalicza go dopiero gdy rzut nie jest już pushowalny (opcje.stressCost zawiera wtedy jedynki z pusha) */
  let stress = 0;
  if (!pushable) {
    stress = Math.max(roll.options?.stressCost ?? 0, pushed ? (roll.attributeTrauma ?? 0) : 0);
  }

  const actor = message.speakerActor ?? null;
  const { action, attribute, wreck, attack } = inferAction(roll, message.flavor);
  return {
    n, first, final, sixes, newSixes, rerolled, pushed, pushCount, pushable,
    stress, stressPending: pushable,
    action, attribute, wreck, attack: typeof attack === 'boolean' ? attack : null,
    actorId: actor?.id ?? null, actorType: actor?.type ?? null,
    npc: !heroSpeaker(message),          // H3-4: przeciwnik według reguły stron, nie typu aktora
    flavor: message.flavor ?? ''
  };
}
