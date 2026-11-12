/* Tactical combat, the surfaces: THE MARKS WHERE THE MAP DRAWS (U100). NO Foundry or browser globals (node-tested in check-u21.mjs).
   The map module draws some of the fight's texts itself (a menu row's hint, a menu's title and sub line, the price in the move pick's
   tooltip, a zone's label, a token's pill, a hazard's chip on a route). It takes plain text, and since moinen-maps zones-api.md
   section 40 also PIECES beside it: words and signs in order (`signs: { <field>: pieces }`). The words stay the field's text (a map
   without section 40, a screen reader's plain place); the pieces are the same price drawn with the kit's marks (scripts/kit.mjs
   markSigns: the dock's very drawing, named in a tooltip and to a screen reader).
     priceSigns(price, { free })        a price of model-pure.priceOf -> pieces (the marks, named as the dock names them); `free`: draw
                                        the mark of "no action" too (a menu row leaves it out, as its words did)
     armorSign(n, name)                 Armor with its number -> one sign
     damageSign(n, say)                 what a hit does (the burst with its number), named by the sentence that says it -> one sign
     joined(groups, sep)                groups of pieces with words between them (" · ") -> pieces | null when no group holds a sign */
import { markSigns } from "../../kit-signs-pure.mjs";      // the pure core of the kit (no Foundry): the names are always given here

export function priceSigns(price, { free = false } = {}) {
  if (!price?.parts?.length) return [];
  return price.parts.filter((p) => free || p.mark !== "none").flatMap((p) => (p.mark === "stress" ? markSigns("stress", { n: p.n, name: `${p.name}: ${p.n}` }) : markSigns(p.mark, { out: !!p.out, name: p.name })));
}
export const armorSign = (n, name) => markSigns("armor", { n: Number(n) || 0, name: `${name}: ${Number(n) || 0}` })[0];
export const damageSign = (n, say) => markSigns("damage", { n: String(n), name: say || true })[0];
/** groups (each a string or a list of pieces; empty ones are left out) joined by `sep`; null when no sign is among them */
export function joined(groups, sep = " · ") {
  const out = [];
  for (const g of groups) {
    const list = typeof g === "string" ? (g ? [g] : []) : Array.isArray(g) ? g.filter((x) => x != null && x !== "") : g ? [g] : [];
    if (!list.length) continue;
    if (out.length) out.push(sep);
    out.push(...list);
  }
  return out.some((p) => typeof p === "object") ? out : null;
}
