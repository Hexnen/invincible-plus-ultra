/* Tactical combat, package P5: the catalog rows of the book's two action tables that are neither an attack nor a move, and the escapes the
   text adds (spec 8.1, 9.7). NO Foundry globals, no imports: plain data, spread into catalog-pure.mjs BUILTIN.
   `src` holds book-dump line numbers only (the text is private). Every row runs through flow "act" (flows/acts.mjs). Fields beside the
   common ones of catalog-pure.mjs:
     roll     { attr }                 the attribute is fixed
              { attrs: [...] | "any" } the player names it (`decl.attr`); with `optional` no attribute means no roll at all ("varies")
     oppose   { attr, who }            an opposed roll: `who` = "target" (banter [B2785], a resisted persuasion [B2241]) or "holder" (the
                                       character named by the actor's `grappled` status [B2496]); `optional`: only when a target is named
     target   { who, n: [min, max] }   n[0] = 0: the action may name another character and is about the actor otherwise
     effect   { kind }                 what a success does (flows/acts.mjs `EFFECTS`)
     tags     "physical"               needs body movement: refused while grappled, snared or immobilised [B2496], [B1606], [B1645]
     when     a status the ACTOR must carry / someone must carry for the action to be offered at all (the dock hides it otherwise)
   Not here, by design: the vehicle rows [B2325-2331] and `objective`, `ram` (P7); `grapple`, `grappleAttack`, `release`, `charge` (P4);
   `flySkyOrbit` [B2377] is a way of the move flow (P3); `help`, `holdOff`, `endTurn` are operations of the round driver. */
const row = (id, cost, src, more) => Object.freeze({ id, label: `ITAC.action.${id}`, src, kind: "builtin", cost, flow: "act", tags: [], ...more });

export const ACTIONS = Object.freeze({
  /* ---- quick actions [B2305-2334] */
  pickUp: row("pickUp", "quick", [2316], { effect: { kind: "pickUp" }, tags: ["physical"] }),
  scan: row("scan", "quick", [2319], { roll: { attr: "intuition" }, effect: { kind: "narrative" } }),
  banter: row("banter", "quick", [2322, 2784, 2785], { roll: { attr: "presence" }, oppose: { attr: "presence", who: "target" }, target: { who: "enemy", n: [1, 1] }, effect: { kind: "banter" }, tags: ["banter"] }),
  useItem: row("useItem", "quick", [2334], { roll: { attrs: "any", optional: true }, effect: { kind: "narrative" }, text: 1, tags: ["physical"] }),
  /* ---- full actions [B2337-2377] */
  usePower: row("usePower", "full", [2350, 1216], { roll: { attrs: "any", optional: true }, effect: { kind: "narrative" }, text: 1, tags: ["power"] }),
  breakLift: row("breakLift", "full", [2353, 284], { roll: { attr: "strength" }, effect: { kind: "narrative" }, tags: ["physical"] }),
  technology: row("technology", "full", [2356], { roll: { attr: "reason" }, effect: { kind: "narrative" }, tags: ["physical"] }),
  stabilize: row("stabilize", "full", [2359, 2777, 3309], { roll: { attr: "reason" }, target: { who: "ally", n: [1, 1] }, effect: { kind: "stabilize" }, tags: ["physical"], when: { anyone: "dying" } }),
  rally: row("rally", "full", [2365, 2773, 2774, 2775], { roll: { attr: "presence" }, target: { who: "ally", n: [0, 1] }, effect: { kind: "rally" }, when: { anyone: "broken" } }),
  recoverResolve: row("recoverResolve", "full", [2368, 2818], { roll: { attr: "presence" }, target: { who: "ally", n: [0, 1] }, effect: { kind: "resolve" } }),
  persuade: row("persuade", "full", [2371, 2241], { roll: { attr: "presence" }, oppose: { attr: "intuition", who: "target", optional: true }, target: { who: "enemy", n: [0, 1] }, effect: { kind: "narrative" } }),
  saveBystanders: row("saveBystanders", "full", [2374], { roll: { attrs: "any" }, effect: { kind: "bystanders" } }),
  /* ---- the escapes the text adds */
  breakFree: row("breakFree", "quick", [2496], { roll: { attr: "strength" }, oppose: { attr: "strength", who: "holder" }, effect: { kind: "escape", from: "grappled", escape: "grapple" }, when: { self: "grappled" }, tags: ["escape"] }),
  escapeTrap: row("escapeTrap", "quick", [2438], { roll: { attrs: ["agility", "strength"] }, effect: { kind: "escape", from: "trapped", escape: "trap" }, when: { self: "trapped" }, tags: ["escape"] }),
  escapeSnare: row("escapeSnare", "full", [1606, 1607, 1608, 1609], { roll: { attr: "strength" }, effect: { kind: "escape", from: "snared", escape: "snare" }, when: { self: "snared" }, tags: ["escape"] }),
  escapeImmobilised: row("escapeImmobilised", "full", [1645, 1736, 1779], { roll: { attr: "strength" }, effect: { kind: "escape", from: "immobilised", escape: "snare" }, when: { self: "immobilised" }, tags: ["escape"] }),
  shakeOff: row("shakeOff", "none", [1574], { roll: { attr: "presence" }, effect: { kind: "shake" }, when: { self: "afflicted" }, once: "round", tags: ["escape"] }),      // P6: no action, one attempt a round
  extinguish: row("extinguish", "full", [2926], { roll: { attr: "agility" }, target: { who: "ally", n: [0, 1] }, effect: { kind: "extinguish" }, tags: ["physical"], when: { anyone: "burning" } }),
});
export const ATTRS = Object.freeze(["fighting", "agility", "strength", "reason", "intuition", "presence"]);
/** the attributes an entry lets the player choose from ([] = fixed or none) */
export const attrChoices = (e) => (e?.roll?.attrs === "any" ? ATTRS.slice() : Array.isArray(e?.roll?.attrs) ? e.roll.attrs.slice() : []);
/** Is the action worth showing for `cid` now (spec 13: the dock offers what applies)? `statuses` = state.statuses; broken = ids at 0 Health */
export function applies(e, cid, statuses = {}, broken = []) {
  const w = e?.when;
  if (!w) return true;
  const has = (id, st) => (st === "broken" && broken.includes(id)) || (statuses[id] ?? []).some((s) => s.id === st);
  if (w.self) return has(cid, w.self);
  if (w.anyone) return [...new Set([...Object.keys(statuses), ...broken, cid])].some((id) => has(id, w.anyone));
  return true;
}
