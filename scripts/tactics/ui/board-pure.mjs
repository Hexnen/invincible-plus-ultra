/* Tactical combat, the surfaces: THE PLAY ON THE MAP (W1; ledger rows U32-U40, U42-U44). NO Foundry or browser globals (node-tested in
   check-board.mjs). What the map draws over tokens, zones and borders, as plain data built from what the dock already shows
   (model-pure.mjs) and from THIS USER'S OWN VIEW of the fight (view-pure.mjs): ui/board.mjs hands it to the map through the one zones
   adapter. Nothing here knows a rule: a number is the engine's (the per-target answer of op "preview", the priced ways of
   movement-pure.mjs), a refusal is the engine's legality in the words of the reason table.
   WHO SEES WHAT. Every function takes a view that view-pure.mjs already filtered for the user, and runs on that user's own client:
   a concealed combatant is not in the view's ledger, its actions arrive masked (no actor, no target), so it gets no mark and no
   line here. Nothing is sent from the GM's client to a player's map.
     reachMarks(panel, t)               U33 / U34: the candidates of the armed action -> [{ cid, state, label, tip, hover }]
     hitWords(hit, t)                   U34: what a plain hit would do, from the engine's answer -> { short, tip, bar } | null
     tableShow(view, facts, t)          U38 / U39: state chips and "who acts on whom" -> { marks: [{ cid, marks }], links: [{ from, to, label, color }] }
     fireMap(Z)                         the fire of the map, by zone AND level, and where it may go -> { list: [{ zone, at, intensity }], burning, spread }
     fireAt(fm, spot)                   the fire that attacks whoever starts the round on that spot (its level, D56) -> intensity | 0
     zoneHazards(fm, zones, to, c, Z, t) U32: what waits on a way: fire on ENTERING each spot of it (never the one left, D57), and what
                                        ending the turn on the last spot means
     endWarnings(fm, spot, c, Z, t)     U40: what ending the turn on `spot` (the zone and its level) means -> [{ zone, text, tip, icon }]
     actItems(acts, rows, tid, facts, t) U35: the menu at a token -> [{ id, label, icon, hint, tip, disabled }]
     doorItems(bar, door, t)            U35: the menu at a door -> [{ id, label, icon, hint, disabled, req }]
     gmItems(cid, vitals, statuses, t)  U44: the GM's quick corrections at a token -> [{ id, label, icon, stepper | toggle, req(value, from?) }];
                                        a stepper's request is a step (`delta`), a switch's the state as the rules mean it (D53, D59) */
import { labelOf, oddsFor, isFree, priceOf } from "./model-pure.mjs";
import * as Sg from "./signs-pure.mjs";
import { oddsSign } from "../../kit-signs-pure.mjs";      // U133: the chance as the kit's sign (pure core, no Foundry)
import { whyOf, whyLine } from "./feedback-pure.mjs";
import * as HZ from "../flows/hazards.mjs";
import { stateFlags } from "../movement-pure.mjs";

export const IDS = Object.freeze({ reach: "ipu.reach", table: "ipu.table", links: "ipu.x", aim: "ipu.aim", warn: "ipu.warn", area: "ipu.area" });
const LABEL = 18;
const cut = (s, n = LABEL) => { const x = String(s ?? ""); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };
/** U76: the words of an armed intention as the map can carry them: the action's name, whole when it fits the map's 18 characters, else
    cut with an ellipsis (the map cut it mid-word without one). The user's name in front of it is the map's own addition. */
export const intentLabel = (title) => cut(String(title ?? "").trim());
const fin = Number.isFinite;
const join = (parts) => parts.filter(Boolean).map((x) => String(x).replace(/\.$/, "")).join(". ");

/* ------------------------------------------------------------------ U34: what a hit would do */
/** `hit` = the engine's answer { base, toStress, taken?, most?, copies?, now?, max? }: `taken` / `most` (what the character loses:
    after Armor and after the copies of Duplication took their part [B1910], D50; `most` with Double Damage [B2434]), `copies` (how
    much the copies take) and `now` / `max` are there only when this user may know them (engine-pure.opPreview). Without `taken` the
    word is the Damage of the attack before Armor: what the attacker knows of the own weapon and nothing of the target. It is NOT a
    bound (D51: a Vulnerable target takes twice that [B2193], a stunt doubles it), so it does not say "up to". */
export function hitWords(hit, t) {
  if (!hit || !fin(hit.base)) return null;
  const known = fin(hit.taken), n = known ? hit.taken : hit.base, what = t(hit.toStress ? "ITAC.ui.vital.resolve" : "ITAC.ui.vital.health"), soak = known && hit.copies > 0 ? hit.copies : 0;
  const lines = [known ? (n > 0 ? t("ITAC.map.hit.taken", { n, what }) : t(soak ? "ITAC.map.hit.copiesAll" : "ITAC.map.hit.none")) : t("ITAC.map.hit.base", { n })];
  if (soak && n > 0) lines.push(t("ITAC.map.hit.copies", { n: soak }));
  if (known && fin(hit.most) && hit.most > n) lines.push(t("ITAC.map.hit.most", { n: hit.most }));
  const life = fin(hit.now) && fin(hit.max) && hit.max > 0, now = life ? Math.max(0, hit.now) : 0;
  if (known && life && n > 0) lines.push(t("ITAC.map.hit.left", { v: Math.max(0, now - n), max: hit.max }));
  const bar = life ? { value: now, max: hit.max, ...(known ? { loss: Math.min(now, n), lossMax: Math.min(now, Math.max(n, fin(hit.most) ? hit.most : n)) } : {}) } : null;
  return { short: known ? (n > 0 ? `-${n}` : "0") : `~${n}`, tip: lines.join(" "), bar };
}
/* U100: what a hit does as the kit's damage mark with its number (the map's pill over the token, while the pointer is on it) */
const hitSigns = (hit) => { const p = Sg.joined([Sg.damageSign(hit.short, hit.tip)]); return p ? { signs: { label: p } } : {}; };
const oddsTip = (o, t) => (o ? join([`${t("ITAC.ui.chance")}: ${o.say}`, o.defended ? `${o.defended.label}: ${o.defended.say}` : null]) : null);

/* ------------------------------------------------------------------ U33: who can be chosen */
/** The targets of the declare panel that stand on this user's map. In reach: a ring and the chance as a sign in the token's corner
    (oddsShow), the effect of a hit while the pointer is on it. Out of reach: dimmed, with the engine's reason. Chosen: the heavy ring
    (an out-of-reach one that was chosen all the same stays dimmed: the panel says why and offers the way to ask). Before the engine
    answered only the chosen ring. U133: no words over the token; the chance in words is the pointer's tip ("Chance: Likely", the
    GM's "Chance: 72%"). */
export function reachMarks(p, t) {
  if (p?.kind !== "declare" || !p.targets) return [];
  const out = [];
  for (const x of p.targets) {
    if (!x.map) continue;
    if (x.reach === "out") { out.push({ cid: x.id, state: "out", tip: x.why ?? null }); continue; }
    if (x.reach !== "in" && !x.picked) continue;
    const hit = x.reach === "in" ? hitWords(x.hit, t) : null, tip = oddsTip(x.odds, t);
    out.push({ cid: x.id, state: x.picked ? "chosen" : "in", ...oddsShow(x.odds), ...(tip ? { tip } : {}),
      ...(hit ? { hover: { label: cut(hit.short), tip: join([tip, hit.tip]), ...(hit.bar ? { bar: hit.bar } : {}), ...hitSigns(hit) } } : {}) });
  }
  return out;
}
/* U133: THE CHANCE ON THE TOKEN. `odds` = model-pure.oddsFor's answer ({ level, text, say }): the band's sign (kit oddsSign: a chevron
   down, a level dash, a chevron up, two up) as the map's `badge`, a sign on a dark plate in the token's corner, named by the band's
   words (the map knows no band, moinen-maps zones-api.md section 42). The GM's per cent stays in the tip; the sign is the band's.
   No band: nothing (the plain ring). */
export function oddsShow(odds) {
  if (!odds?.say || !Number.isInteger(odds.level) || odds.level < 0 || odds.level > 3) return {};
  const name = odds.text ?? odds.say, sign = oddsSign(odds.level, { name });
  return sign ? { badge: { sign, name } } : {};
}

/* ------------------------------------------------------------------ U38 / U39: the state of the table */
const MARK_OF = { broken: "broken", unconscious: "down", dying: "down", dead: "down", grappled: "held", snared: "held", immobilised: "held", trapped: "held", stunned: "stunned", burning: "burning", airborne: "airborne" };
const REACT_KINDS = ["reaction", "hazardDodge"];
/** From the user's view: per combatant the chips of its state (broken, held, in the air, behind a barrier, asked to react; for the
    GM also "hidden from the players"), and per action in progress an arrow from who acts to whom. A masked action (its actor is
    concealed from this user) has neither actor nor target in the view: no arrow. A target the view does not hold gets none either. */
export function tableShow(view, facts, t) {
  const ids = Object.keys(view?.ledger ?? {}), known = new Set(ids), marks = [], links = [];
  const other = (id) => (id && known.has(id) && facts.c?.(id) ? facts.c(id).name : t("ITAC.Someone"));
  for (const cid of ids) {
    const list = [], add = (icon, tip) => { const was = list.find((m) => m.icon === icon); if (was) { if (tip && !String(was.tip).includes(tip)) was.tip = `${was.tip}, ${tip}`; } else list.push({ icon, tip }); };
    for (const s of view.statuses?.[cid] ?? []) {
      const icon = MARK_OF[s.id];
      if (icon) add(icon, s.id === "grappled" && s.data?.by ? t("ITAC.ui.status.heldBy", { name: other(s.data.by) }) : t(`ITAC.status.${s.id}`, {}, String(s.id)));
    }
    if ((view.effects ?? []).some((e) => e.kind === "barrier" && e.holder === cid)) add("barrier", t("ITAC.map.mark.barrier"));
    if (Object.values(view.prompts ?? {}).some((p) => p && p.about === cid && !p.answered && REACT_KINDS.includes(p.kind))) add("reaction", t("ITAC.map.mark.reaction"));
    if (facts.staff && facts.hidden?.(cid)) add("hidden", t("ITAC.map.mark.hidden"));
    if (list.length) marks.push({ cid, marks: list.slice(0, 6) });
  }
  for (const i of view?.stack ?? []) {
    if (!i || i.masked || !i.actor || !known.has(i.actor) || i.status === "aborted") continue;
    const name = i.data?.label?.name ? String(i.data.label.name) : labelOf(t, `ITAC.action.${i.action}`, ""), attack = i.flow === "attack";
    for (const to of (i.decl?.targets ?? []).filter((x) => known.has(x) && x !== i.actor).slice(0, 12)) links.push({ from: i.actor, to, label: cut(name), color: attack ? "danger" : "target" });
  }
  return { marks, links: links.slice(0, 40) };
}

/* ------------------------------------------------------------------ U32 / U40: what waits in a zone */
/** The fire of the whole map, read once per change: every burning record as the engine keeps it (flows/hazards.burningZones: a zone,
    the LEVEL it burns on or null for all of them [A23], the intensity) and where the fire may go [B2927].
    -> { list: [{ zone, at, intensity }], burning: { zone: highest of any level }, spread: { zone: 1 } } */
export function fireMap(Z) {
  const burning = {}, spread = {}, list = [];
  try {
    for (const b of HZ.burningZones(Z)) { list.push({ zone: b.zone, at: b.at ?? null, intensity: b.intensity }); burning[b.zone] = Math.max(burning[b.zone] ?? 0, b.intensity); }
    for (const z of Object.keys(burning)) for (const n of HZ.spreadCandidates(Z, z) ?? []) { const k = typeof n === "string" ? n : n?.zone ?? n?.id; if (k && !burning[k]) spread[k] = 1; }
  } catch { /* a map that cannot be read warns of nothing */ }
  return { list, burning, spread };
}
const bareKey = (spot) => String(spot ?? "").split(":")[0];
const levelKey = (spot) => String(spot ?? "").split(":")[1] || "ground";
/** D56: the fire that attacks whoever starts the round on `spot`: the first record of that zone that burns on the spot's LEVEL or on
    every level, exactly as the round start reads it (flows/hazards.derived, occupants). A fire upstairs is no fire down here. -> intensity | 0 */
export function fireAt(fm, spot) {
  const z = bareKey(spot), lv = levelKey(spot);
  if (Array.isArray(fm?.list)) return fm.list.find((b) => b.zone === z && (!b.at || b.at === lv))?.intensity ?? 0;
  return fm?.burning?.[z] ?? 0;
}
/* FXV (W1-9, U40): the two warnings the engine had no forecast for. Provisional readings (questions FXV-2, FXV-3):
     "the zone will collapse": a challenge in the fight whose time runs out at the end of THIS round and whose failure wrecks zones or
       blasts (the book's presets: Extreme Weather, Doomsday Device) stands in this zone, or next to it when its area is the zone and
       the adjacent ones. Only where this user knows the time left (the numbers of a challenge are the GM's unless shown).
     "in reach of someone holding": an opponent who held off its turn this round [B2281-2283] and has still to act stands in this zone:
       it may act before the character's next turn, in reach of a slugfest.
   -> { collapse: [{ name, what }], held: [name] } for the spot `spot` (where `cid` would end the turn) */
const COLLAPSE_KINDS = ["wreckZones", "blast"];
export function forecast(view, facts, cid, spot, Z) {
  const out = { collapse: [], held: [] }, z = bareKey(spot);
  if (!view || !z || z.startsWith("@")) return out;
  const zoneOf = (id) => { try { return bareKey(facts?.where?.(id) ?? Z?.place?.(id)?.spot ?? ""); } catch { return ""; } };
  try {
    for (const x of facts?.special?.() ?? []) {
      const cfg = view.challenges?.[x.id], kinds = (cfg?.effects ?? []).filter((e) => e.when === "onFail" && COLLAPSE_KINDS.includes(e.kind)).map((e) => e.kind);
      if (x.kind !== "challenge" || !kinds.length || cfg.done || !(Number(x.resolve) === 1) || !(Number(x.health) > 0) || (x.timeUnit ?? "rounds") !== "rounds") continue;
      const at = zoneOf(x.id); if (!at) continue;
      let near = at === z;
      if (!near && cfg.area === "zoneAndAdjacent") { try { near = (Z?.within?.(at, 1) ?? []).some((r) => r?.zone === z); } catch { near = false; } }
      if (near) out.collapse.push({ name: String(x.name ?? ""), what: kinds[0] });
    }
  } catch { /* nothing is forecast rather than a wrong thing */ }
  try {
    const me = facts?.c?.(cid), mine = !!me?.npc;
    for (const s of view.init?.slots ?? []) {
      if (!s?.heldOff || s.state !== "waiting") continue;
      for (const m of s.members ?? []) { const o = facts?.c?.(m); if (m !== cid && o && !!o.npc !== mine && zoneOf(m) === z) out.held.push(String(o.name ?? "")); }
    }
  } catch { /* idem */ }
  return out;
}
/** what ending the turn on `zone` (a spot: the zone and the level) means: the fire attack of the next round [B2925], a fire next
    door [B2927], no air [B2929]; FXV (W1-9): `fc` = forecast(...): a challenge's end that hits the zone, an opponent who holds its turn here */
export function endWarnings(fm, zone, c, Z, t, fc = null) {
  const z = bareKey(zone), out = [], n = fireAt(fm, zone);
  if (!z || z.startsWith("@")) return out;
  for (const x of fc?.collapse ?? []) out.push({ zone: z, text: t("ITAC.map.warn.collapse"), tip: t("ITAC.map.warn.collapse.tip", { name: x.name, what: t(`ITAC.ui.effect.${x.what}`, {}, x.what) }), icon: "warn" });
  if (fc?.held?.length) out.push({ zone: z, text: t("ITAC.map.warn.held"), tip: t("ITAC.map.warn.held.tip", { names: fc.held.join(", ") }), icon: "warn" });
  if (n) out.push({ zone: z, text: t("ITAC.map.warn.fire", { n }), tip: t("ITAC.map.warn.fire.tip", { n }), icon: "burning" });
  else if (fm?.spread?.[z]) out.push({ zone: z, text: t("ITAC.map.warn.spread"), tip: t("ITAC.map.warn.spread.tip"), icon: "warn" });
  let vac = false;
  try { vac = !c?.vacuumSafe && !!(Z?.zone?.(z)?.tags ?? []).includes("vacuum"); } catch { vac = false; }
  if (vac) out.push({ zone: z, text: t("ITAC.map.warn.vacuum"), tip: t("ITAC.map.warn.vacuum.tip"), icon: "warn" });
  return out;
}
/** The hazards of a way of moving beyond the walls it breaks (those are the option's own `barriers`). `zones` = the spots the way
    ENTERS, in order (movement-pure `enters`), or its route of zone keys, which begins with the zone the mover stands in.
    D57 [B2925]: a fire attacks whoever ENTERS its zone, at once, and whoever starts a round there. So every spot entered, the last
    one too, says "fire on entering" with the intensity the move will meet (the states of that spot's level, the mover's own
    exemptions: the same reading as flows/move.enterGate); the zone the mover LEAVES says nothing, nothing attacks on the way out.
    The destination also carries what ending the turn there means (the standing warning of U40). */
export function zoneHazards(fm, zones, to, c, Z, t, fc = null) {
  const end = String(to ?? ""), out = [], cid = c?.id ?? null;
  let here = null;
  try { here = cid != null ? Z?.place?.(cid)?.spot ?? null : null; } catch { here = null; }
  const list = (zones ?? []).map(String), route = here != null && list.length && bareKey(list[0]) === bareKey(here) ? list.slice(1) : list;
  const fireOn = (spot) => { try { const st = Z?.states?.(spot); return Array.isArray(st) ? stateFlags(st, cid).fire : fireAt(fm, spot); } catch { return fireAt(fm, spot); } };
  for (const s of [...new Set([...route.filter((x) => bareKey(x) !== bareKey(end)), end])]) {
    if (!s || s.startsWith("@") || s === here) continue;
    const n = fireOn(s);
    if (n > 0) out.push({ zone: bareKey(s), text: t("ITAC.map.haz.fire", { n }), tip: t("ITAC.map.haz.fire.tip", { n }), color: "danger", icon: "burning" });
  }
  for (const w of endWarnings(fm, end, c, Z, t, fc)) out.push({ zone: w.zone, text: w.text, tip: w.tip, color: "danger", icon: w.icon });
  return out;
}

/* ------------------------------------------------------------------ U35: the menu at a thing */
const priceShort = (t, a) => [isFree(a.cost) ? null : t(`ITAC.ui.costShort.${a.cost}`, {}, String(a.cost ?? "")), a.stress ? t("ITAC.ui.stress", { n: a.stress }) : null].filter(Boolean);
/* U100: the same hint as the dock's marks for the map's menu (moinen-maps zones-api.md section 40); the words above stay its text */
const priceMarks = (t, a) => Sg.priceSigns(priceOf(t, a.cost, a.stress));
const hintSigns = (groups) => { const p = Sg.joined(groups); return p ? { signs: { hint: p } } : {}; };
/** `acts` = model-pure.targetActs, `rows` = the engine's answer per action id ({ ok, reason, params, dice, hit }) or null while none came.
    An action the bar refuses (not your turn, nothing to pay with) or the engine refuses against this target is listed greyed with the reason. */
export function actItems(acts, rows, tid, facts, t) {
  return (acts ?? []).map((a) => {
    const r = rows?.[a.id] ?? null, odds = r?.ok ? oddsFor(a, r.dice, tid, facts, t, r.def) : null, hit = r?.ok ? hitWords(r.hit, t) : null;
    const why = a.disabled ?? (r && !r.ok ? whyLine(whyOf(t, r.reason, r.params, { staff: facts?.staff })) : null);      // U54: a whole sentence and what to do about it
    return { id: a.id, label: a.label, icon: a.icon, hint: [...priceShort(t, a), odds?.say ?? null, hit?.short ?? null].filter(Boolean).join(" · "), tip: join([oddsTip(odds, t), hit?.tip]) || null, disabled: why || null,
      ...hintSigns([priceMarks(t, a), odds?.say ?? null, hit ? [Sg.damageSign(hit.short, hit.tip)] : null]) };
  });
}
/** `door` = a row of flows/move.doorOptions for the border clicked; the door actions of the bar that fit its state */
export function doorItems(bar, door, t) {
  return (bar?.actions ?? []).filter((a) => a.flow === "barrier" && door?.actions && a.id in door.actions && door.actions[a.id] !== "doorState").map((a) => {
    const why = whyLine(whyOf(t, a.disabled || door.actions[a.id] || null));
    return { id: a.id, label: labelOf(t, a.label), icon: a.id, hint: priceShort(t, a).join(" · "), disabled: why, req: why ? null : a.req({ to: door.to }), ...hintSigns([priceMarks(t, a)]) };
  });
}
/** U100: the title (a wall) or the sub line (a door) of the menu at a border with Armor as its mark; the words stay the text */
export function borderSigns(door, br, t) {
  const armor = (n) => Sg.armorSign(n ?? 0, t("ITAC.ui.fact.armor"));
  return door ? { sub: [`${t(`ITAC.ui.door.${door.state}`, {}, String(door.state))}, `, armor(door.armor)] } : { title: [`${t("ITAC.map.haz.wall.do")} `, armor(br?.armor)] };
}
/* ------------------------------------------------------------------ U44: the GM's quick corrections */
export const GM_STATES = Object.freeze(["stunned", "unaware", "snared", "immobilised", "trapped"]);
/** Health, Resolve and the common states of one combatant as steppers and switches; each change is a GM edit of the engine
    (setHealth, setResolve, statusAdd, statusRemove: journaled, undoable like any other). `vitals` = { health, maxHealth, resolve, maxResolve } | null.
    A stepper's request is a STEP (`delta` = the number chosen minus `from`, the number it was counted from; by default the one the
    menu opened with): the executor adds it to what the character has at that moment, so damage that landed while the menu stood
    open is not taken back. The engine keeps the state with the number: Health 0 is broken, Health above 0 is not (D59); "Stunned"
    is the lost next turn and its mark together (D53). */
/** U80: did a correction sent from the map menu fail (refused by the executor, or never answered)? Then the menu shows a number nobody has. */
export const stepFailed = (env) => !env || env.ok === false;
export function gmItems(cid, vitals, statuses, t, group = null) {
  const out = [], v = vitals ?? {};
  /* U99: a group's Health is its count; the system's top of ten is no fact of it, so a larger group is never stepped down to it */
  if (fin(v.health) && fin(v.maxHealth) && v.maxHealth > 0) out.push({ id: "health", label: t("ITAC.ui.vital.health"), icon: "fa-solid fa-heart", stepper: { value: Math.max(0, v.health), min: 0, max: group ? Math.max(v.maxHealth, v.health) : v.maxHealth }, req: (n, from = Math.max(0, v.health)) => ({ op: "setHealth", combatant: cid, delta: n - from }) });
  if (fin(v.resolve) && fin(v.maxResolve) && v.maxResolve > 0) out.push({ id: "resolve", label: t("ITAC.ui.vital.resolve"), icon: "fa-solid fa-bolt", stepper: { value: Math.max(0, v.resolve), min: 0, max: v.maxResolve }, req: (n, from = Math.max(0, v.resolve)) => ({ op: "setResolve", combatant: cid, delta: n - from }) });
  /* U61: a minion group: settle it quickly (one card per hit), the GM's switch. `group` = { quick, req(on) } | null */
  const quick = group ? { id: "quick", label: t("ITAC.ui.policy.quick"), tip: t("ITAC.ui.policy.quick.tip"), icon: "fa-solid fa-forward-fast", toggle: true, on: !!group.quick, req: (on) => group.req(on) } : null;
  const has = new Set((statuses ?? []).map((s) => s.id));
  if (quick) out.push(quick);
  for (const id of GM_STATES) out.push({ id: `st:${id}`, label: t(`ITAC.status.${id}`, {}, id), icon: "fa-solid fa-circle-dot", toggle: true, on: has.has(id), req: (on) => (on ? { op: "statusAdd", combatant: cid, status: { id } } : { op: "statusRemove", combatant: cid, id }) });
  return out;
}
