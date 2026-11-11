/* Tactical combat, the surfaces: THE KEYBOARD (U41). NO Foundry or browser globals (node-tested in check-ui.mjs).
   The keys act on what the dock already shows: every key is a click on a control of the render data (its focus key `fk`, dom.mjs) or
   a patch of the dock's own state; nothing here builds a request, so the keyboard can do nothing the pointer could not.
     1 .. 9, 0   the n-th thing of THE TOP LAYER:  the answers of the first question card  >  the rows of an open list (More actions,
                 Abilities)  >  the action buttons of the bar (the lists keep the last digits: Abilities 0). On a card a digit only CHOOSES the answer (Enter sends it): a key meant
                 for the bar a moment before the card came up must not spend a reaction. A stunt card (several answers) ticks with it.
                 While Foundry's macro bar is shown (the dock's keyboard button) the digits are its own again.
     Tab         the next target of the armed action (Shift: the one before); on a card the next answer
     Enter       confirms: the chosen answer (a ticked stunt card: its Confirm), Declare, the one way of a chosen move, "Sure?" of End
                 turn, Accept (or Roll) of a roll this user owes
     Space       End turn (the first press arms "Sure?" where the pointer would)
     Escape      puts away the chosen answer, else the armed action or the open list
   main.mjs calls plan() from one keydown listener and never while the user types (a text field, the chat box, another window).
     number(d, own)  -> d with `key` on what a digit reaches (the surfaces show it as a small mark and say it in the tooltip)
     layer(d)        -> { id: "card" | "list" | "bar" | null, ask?, multi?, keys: [{ key, id, fk }] }
     plan(d, own, ev) -> null | { click: fk } | { set: patch } | { target: combatantId }
       ev = { key, shift, walking }      walking: the focus is being walked through the surface's buttons by Tab (Tab, Enter and Space stay the browser's) */
export const DIGITS = Object.freeze(["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]);
export const KEYS = Object.freeze([...DIGITS, "Tab", "Enter", " ", "Escape"]);
const numbered = (list, fk) => list.slice(0, DIGITS.length).map((x, i) => ({ key: DIGITS[i], id: x.id, fk: fk(x) }));
const actFk = (a) => (a.more ? `more:${a.mode ?? "menu"}` : `act:${a.id}`);

export function layer(d) {
  const none = { id: null, keys: [] };
  if (!d) return none;
  const card = d.prompts?.[0];
  if (card) return { id: "card", ask: card.id, multi: !!card.multi, keys: numbered((card.options ?? []).filter((o) => !o.disabled && !o.again), (o) => `opt:${card.id}:${o.id}`) };
  if (!d.show) return none;
  if (d.panel?.kind === "menu") return { id: "list", keys: numbered(d.panel.rows ?? [], (r) => `menu:${r.id}`) };
  if (d.rest) return none;
  /* the two lists keep the LAST digits whatever else stands on the bar (Abilities is 0, More actions the digit before it), so a bar
     that grew a door or a rescue never pushes them off the keyboard; the plain actions count from 1 */
  const all = (d.groups ?? []).flatMap((g) => g.items), lists = all.filter((a) => a.more), plain = all.filter((a) => !a.more).slice(0, DIGITS.length - lists.length);
  const at = (a) => (a.more ? DIGITS.length - lists.length + lists.indexOf(a) : plain.indexOf(a));
  return { id: "bar", keys: all.filter((a) => at(a) >= 0).map((a) => ({ key: DIGITS[at(a)], id: a.id, fk: actFk(a) })) };
}
/** the render data with the key written on what it reaches (a copy of the touched lists; `d` itself is not changed) */
export function number(d, own = {}) {
  const L = layer(d);
  if (!L.id || own.hotbar) return d;
  const keyOf = (fk) => L.keys.find((k) => k.fk === fk)?.key ?? null, put = (x, fk) => { const key = keyOf(fk); return key ? { ...x, key, ...(x.tip && typeof x.tip === "object" ? { tip: { ...x.tip, key } } : {}) } : x; };
  if (L.id === "card") return { ...d, prompts: d.prompts.map((a, i) => (i ? a : { ...a, options: a.options.map((o) => put(o, `opt:${a.id}:${o.id}`)) })) };
  if (L.id === "list") { const row = (r) => put(r, `menu:${r.id}`); return { ...d, panel: { ...d.panel, rows: d.panel.rows.map(row), groups: d.panel.groups.map((g) => ({ ...g, rows: g.rows.map(row), ...(g.entries ? { entries: g.entries.map((e) => ({ ...e, rows: e.rows.map(row) })) } : {}) })) } }; }
  return { ...d, groups: d.groups.map((g) => ({ ...g, items: g.items.map((a) => put(a, actFk(a))) })) };
}

const around = (list, cur, back) => { if (!list.length) return null; const i = list.indexOf(cur); return list[i < 0 ? (back ? list.length - 1 : 0) : (i + (back ? list.length - 1 : 1)) % list.length]; };
export function plan(d, own = {}, ev = {}) {
  const key = ev.key;
  if (!d || !KEYS.includes(key)) return null;
  const L = layer(d), card = L.id === "card" ? d.prompts[0] : null, p = d.show ? d.panel : null;
  const chosen = card && L.id === "card" && L.keys.some((k) => k.fk === own.kopt) ? own.kopt : null;
  if (DIGITS.includes(key)) {
    const hit = own.hotbar ? null : L.keys.find((k) => k.key === key);
    if (!hit) return null;
    return L.id === "card" && !L.multi ? { set: { kopt: hit.fk } } : { click: hit.fk };
  }
  if (key === "Escape") return chosen ? { set: { kopt: null } } : d.show && (own.armed || own.mode) ? { set: { armed: null, mode: null, amend: null } } : null;
  if (ev.walking) return null;
  if (key === "Tab") {
    if (L.id === "card") { const fk = around(L.keys.map((k) => k.fk), chosen, !!ev.shift); return fk ? { set: { kopt: fk } } : null; }
    if (card) return null;
    if (p?.kind === "declare" && p.targets?.length) { const id = around(p.targets.map((x) => x.id), p.targets.filter((x) => x.picked).map((x) => x.id).pop() ?? null, !!ev.shift); return id ? { target: id } : null; }
    return null;
  }
  if (key === "Enter") {
    if (card) return L.multi ? (card.submit?.req ? { click: `submit:${card.id}` } : null) : chosen ? { click: chosen } : null;
    if (p?.kind === "declare") return p.submit?.req ? { click: "go" } : p.refused?.submit?.req ? { click: "go.itd-go-ask" } : null;
    if (p?.kind === "other" || p?.kind === "blocked") return p.submit?.req ? { click: "go.itd-go-ask" } : null;
    if (p?.kind === "move" && p.dest) { const can = p.dest.rows.filter((r) => !r.disabled && r.req); return can.length === 1 ? { click: `way:${can[0].id}` } : null; }
    if (d.show && !d.rest && d.end?.armed && d.end.req) return { click: "end" };
    for (const r of d.show ? [...(p?.kind === "mine" ? p.rolls ?? [] : []), ...(d.rolls ?? [])] : []) {      /* U52: the roll of the own action stands in its panel, any other in the line over the bar */ const b = (r.buttons ?? []).find((x) => x.id === "accept" || x.id === "acceptFor") ?? (r.buttons ?? []).find((x) => x.id === "roll"); if (b) return { click: `rb:${r.id}:${b.id}` }; }
    return null;
  }
  /* Space */
  return d.show && !d.rest && d.end?.req && !d.end.disabled ? { click: "end" } : null;
}
