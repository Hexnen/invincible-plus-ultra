/* Tactical combat, the surfaces: MODEL -> RENDER DATA. NO Foundry or browser globals (node-tested in check-ui.mjs).
   The two surfaces (dock.mjs: the player's action dock, also the GM driving an NPC; desk.mjs: the GM desk) draw ONLY what these functions
   return, and send ONLY the requests found in it (api.tactics.request). Nothing here decides a rule: the models of desk-pure.mjs carry the
   options, their reasons and the ready requests; this file gives them words, an order and a layout-free shape.
     dockData(model, own, facts, t) -> what the dock shows      model = playerModel(view, viewer, ctx)  |  { bars: [barModel], ... } for staff
     deskData(model, own, facts, t) -> what the desk shows      model = deskModel(state, log, ctx)
     askData(p, o)                 -> one question (a prompt of the player, a card of the desk): the same shape for both surfaces
   facts = { view, c(id) -> { name, npc, img? } | null, attrs(id) -> { fighting, ... } | null, userName(userId), me: userId, staff: bool,
             move(cid) -> { options: [movement-pure.moveOptions], why: reason | null } | null (no map),   doors(cid) -> [flows/move.doorOptions],
             zone(spot) -> { id, level, floor, area, roof } | null }      the last three are asked only for the combatant the dock drives
   own    = the surface's own state (which action is armed, the picked targets, drafts of text, open panels); never part of the fight.
   HIDDEN INFORMATION (spec 10): a player's data is built from the player's view only. `attrsFor` refuses an NPC's numbers unless the view
   says its stats are revealed, whatever `facts.attrs` would answer; the roster of possible targets is the view's ledger (a concealed
   combatant is not in it). The chance shown to a player is a BAND from the player's own pool [D]; the desk shows the GM percentages. */
import { dice } from "../../rules/index.mjs";
import { sceneData } from "./scene-pure.mjs";
import { allRows, CAT_OF } from "../kit-pure.mjs";
import * as Lg from "../ledger-pure.mjs";
import { outOf } from "../desk-pure.mjs";
import * as Keys from "./keys-pure.mjs";
import { BANDS, bandOf } from "../flows/kit.mjs";      // the bands of a chance: one definition for the dock and for the engine's reaction cards (U11)
export { BANDS, bandOf };


const isKey = (s) => typeof s === "string" && s.startsWith("ITAC.");
const has = (t, key) => t(key, {}, null) !== null;
const cap = (s) => { const x = String(s ?? ""); return x.charAt(0).toUpperCase() + x.slice(1); };
/** the journal's `{ITAC.key}` marks (the engine has no language) in the reader's language; an unknown key reads as its last part */
/* ... and `{zone:key}` is a place, named as the map names it (zoneText below) */
export const marks = (t, text, facts = null) => String(text ?? "").replace(/\{(ITAC\.[\w.]+)\}/g, (m, key) => t(key, {}, key.split(".").pop())).replace(/\{zone:([^{}]+)\}/g, (m, spot) => zoneText(facts ?? {}, t, spot));
/** a label of the models: an ITAC key, or text as it is */
export const labelOf = (t, label, fallback = "") => (isKey(label) ? t(label, {}, label.split(".").pop()) : String(label ?? fallback));
export const reasonText = (t, reason, params = {}) => (reason ? t(`ITAC.reason.${reason}`, params, String(reason)) : null);
export const costText = (t, cost) => (cost ? t(`ITAC.ui.cost.${cost}`, {}, String(cost)) : null);
export const attrText = (t, attr) => (attr ? t(`ITAC.ui.attr.${attr}`, {}, cap(attr)) : "");
const nameOf = (facts, id, t) => (id ? facts.c?.(id)?.name ?? t("ITAC.Someone") : "");
const pct = (p) => `${Math.round(p * 100)}%`;
/** a place in words: "Zone 4", "Zone 4, on the roof", "Sky high" (the map's zone number; never a raw key when the map answers) */
export function zoneText(facts, t, spot) {
  if (!spot) return "";
  const z = facts.zone?.(spot) ?? null, s = String(spot);
  if (z?.title) return String(z.title);                                              // the map's own words for the place (number in the scene's numerals, level, off-map area)
  const area = z?.area ?? (s.startsWith("@") ? s.slice(1) : null);
  if (area) return t(`ITAC.ui.area.${area}`, {}, cap(area));
  const base = t("ITAC.ui.zone", { n: z?.id ?? s.split(":")[0] });
  if (z?.level === "floor" && z.floor != null) return t("ITAC.ui.zone.floor", { zone: base, n: z.floor });
  if (z?.level === "elevated" || /:elevated$/.test(s)) return t(z?.roof ? "ITAC.ui.zone.roof" : "ITAC.ui.zone.air", { zone: base });
  return base;
}
const bare = (spot) => String(spot ?? "").split(":")[0];

/* ------------------------------------------------------------------ chance (spec 10: bands for players, [D] thresholds) */
/** the numbers of `id` that `facts` may use: an NPC's only for staff or when the view says its stats are revealed */
export function attrsFor(facts, id) {
  const c = facts.c?.(id);
  if (!c) return null;
  if (c.npc && !facts.staff && !facts.view?.revealed?.[id]?.stats) return null;
  return facts.attrs?.(id) ?? null;
}
/** { p, band, level } for a pool against nobody, plus `defended` when the defender's pool is known */
export function chanceOf(pool, defPool = null) {
  const one = (p) => ({ p, level: bandOf(p), band: BANDS[bandOf(p)].id });
  const out = one(dice.pSuccess(Math.max(1, pool)));
  if (Number.isFinite(defPool) && defPool > 0) out.defended = one(dice.pHit(Math.max(1, pool), defPool));
  return out;
}
const DEF_ATTR = { block: "fighting", dodge: "agility" };
/** The chance of a roll of `n` dice of action `a` (its `opposeAttr` / `defense`) against `tgt`, in the words this user gets [D9]: a
    band for a player, the number for the GM (`say`); `defended` only when the defender's pool is this user's to know (attrsFor). */
export function oddsFor(a, n, tgt, facts, t) {
  if (!Number.isFinite(n)) return null;
  const dAttr = a?.opposeAttr ?? DEF_ATTR[a?.defense], dp = tgt && dAttr ? Number(attrsFor(facts, tgt)?.[dAttr]) : NaN, c = chanceOf(n, Number.isFinite(dp) ? dp : null), say = (x) => (facts.staff ? pct(x.p) : t(`ITAC.ui.band.${x.band}`));
  return { level: c.level, text: t(`ITAC.ui.band.${c.band}`), say: say(c), defended: c.defended ? { level: c.defended.level, text: t(`ITAC.ui.band.${c.defended.band}`), say: say(c.defended), label: a.opposeAttr ? t("ITAC.ui.ifResists", { attr: attrText(t, a.opposeAttr) }) : t("ITAC.ui.ifDefends", { how: t(`ITAC.action.${a.defense}`) }) } : null };
}

/* ------------------------------------------------------------------ the roster a target is picked from */
/** everybody of the view except `cid`: { id, name, npc, unseen, side } ; `side` = "own" for the actor's own kind (hero / NPC) */
export function rosterOf(facts, cid) {
  const view = facts.view, me = facts.c?.(cid);
  return Object.keys(view?.ledger ?? {}).filter((id) => id !== cid && facts.c?.(id)).map((id) => {
    const c = facts.c(id);
    return { id, name: c.name, npc: !!c.npc, img: c.img ?? null, side: !!c.npc === !!me?.npc ? "own" : "other", unseen: view.knowledge?.[cid]?.[id] === "unseen" };
  });
}
/** candidates in the order the action most likely wants them (an attack: the other side first; orders: the own side first) */
export function targetsFor(action, facts, cid) {
  if (action.targetWho === "challenge" || action.targetWho === "vehicle") return specialOf(facts, action.targetWho);
  const first = action.targetWho === "ally" ? "own" : "other";
  const list = rosterOf(facts, cid), ride = (facts.view?.statuses?.[cid] ?? []).find((s) => s.id === "inVehicle")?.data?.vehicle ?? null;
  return [...[...list.filter((r) => r.side === first), ...list.filter((r) => r.side !== first)].map((r) => ({ ...r, likely: r.side === first })), ...(action.flow === "attack" ? specialOf(facts, "vehicle", false).filter((x) => x.id !== ride) : [])];
}
/* P7: what stands in the fight without a card (a challenge, a vehicle); a concealed one is not in facts.special() */
const specialOf = (facts, kind, likely = true) => (facts.special?.() ?? []).filter((x) => x.kind === kind).map((x) => ({ id: x.id, name: x.name, npc: true, img: x.img ?? null, side: "other", unseen: false, likely }));
const ATTR_IDS = ["fighting", "agility", "strength", "reason", "intuition", "presence"];
/* P7 [B2839]: how the hero goes about a challenge: one of its listed ways (attribute, a minimum, a power), or an idea of the player's own
   (an attribute and a few words; the GM accepts it on a card) */
function approachOf(facts, ch, own, bar, t) {
  const cfg = ch ? facts.view?.challenges?.[ch] : null, mine = attrsFor(facts, bar.combatant) ?? {};
  const groups = (cfg?.objectives ?? []).map((o) => ({ id: o.id, label: t(`ITAC.ui.objective.${o.id}`, {}, String(o.id)), rows: (o.options ?? []).map((x, i) => {
    const id = `${o.id}.${i}`, low = x.minAttr && Number(mine[x.attr]) < x.minAttr;
    return { id, attr: x.attr, label: [[attrText(t, x.attr), x.minAttr ? t("ITAC.ui.approach.min", { n: x.minAttr }) : null].filter(Boolean).join(" "), x.power ? String(x.power) : null].filter(Boolean).join(" \u00b7 "),
      tip: low ? reasonText(t, "attrTooLow") : x.power ? t("ITAC.ui.approach.power", { power: String(x.power) }) : null, dim: !!low, picked: own.opt === id };
  }) }));
  const rows = groups.flatMap((g) => g.rows), sel = rows.find((r) => r.picked) ?? null, ownOn = !sel && (own.opt === "own" || !rows.length), attr = ATTR_IDS.includes(own.attr) ? own.attr : null, text = (own.text ?? "").trim();
  const why = sel ? null : !ownOn ? t("ITAC.ui.need.approach") : !attr ? t("ITAC.ui.need.attr") : rows.length && !text ? t("ITAC.ui.need.text") : null;
  return { label: t("ITAC.ui.approach"), groups, attr: sel?.attr ?? (ownOn ? attr : null), why, decl: sel ? { mode: sel.id } : ownOn && attr ? { attr, text } : {},
    own: { label: t("ITAC.ui.approach.own"), picked: ownOn, lone: !rows.length, tip: t("ITAC.ui.approach.own.tip"), attrLabel: t("ITAC.ui.approach.attr"), attrs: ownOn ? ATTR_IDS.map((k) => ({ id: k, label: attrText(t, k), picked: attr === k })) : null } };
}

/* ------------------------------------------------------------------ one question (player prompt / desk card) */
const P1_KINDS = ["veteran", "reflexes", "triggerQueue", "grantConsent", "challengeFail"];
const rollLabel = (t, key, facts) => {
  const [k, who] = String(key).split(":");
  const base = t(`ITAC.roll.${k}`, {}, k);
  return who && facts.c?.(who) ? `${base}: ${facts.c(who).name}` : base;
};
function titleOf(p, t, facts, round) {
  if (p.kind === "triggerQueue") { const at = ["roundStart", "roundEnd", "turnStart", "turnEnd"].includes(p.data?.at) ? p.data.at : "roundStart"; return t(`ITAC.Prompt.triggerQueue.Title.${at}`, { round: round ?? "", name: p.aboutName ?? "" }); }
  if (P1_KINDS.includes(p.kind)) return t(`ITAC.Prompt.${p.kind}.Title`);
  const k = p.kind === "proxy" && p.of ? p.of : p.kind;
  if (k === "direction" && Array.isArray(p.data?.zones)) return t("ITAC.ui.card.forced");
  return t(`ITAC.${p.to === "desk" ? "card" : "prompt"}.${k}`, {}, null) ?? t(`ITAC.card.${k}`, {}, null) ?? t(`ITAC.Prompt.${k}.Title`, {}, cap(k));
}
/* a choice of several features at once ("more+more+powered"): each named once, with how many times */
function comboLabel(t, id) {
  const parts = String(id).split("+"), uniq = [...new Set(parts)];
  return uniq.map((p) => { const n = parts.filter((x) => x === p).length, s = t(`ITAC.kit.pick.${p}`, {}, p); return n > 1 ? `${s} x${n}` : s; }).join(" + ");
}
function optLabel(p, o, t, facts, desk = false, oneTarget = false) {
  const kind = p.of ?? p.kind;
  if (kind === "reaction" && o.id === "pass") return t("ITAC.ui.noReaction");      // U11: one word for it on both seats
  if (kind === "triggerQueue" && o.data?.type) { const own = dueLabel(o, t, facts); if (own) return own; }
  if (kind === "fireSpread" && o.data?.zone) return o.data.rolled ? t("ITAC.ui.spread.rolled", { zone: zoneText(facts, t, o.data.zone) }) : zoneText(facts, t, o.data.zone);
  if (o.name) return String(o.name);
  if (isKey(o.label)) {
    const d = o.data ?? {};
    const base = d.zone || Number.isFinite(d.n) ? t(o.label, { zone: d.zone ? zoneText(facts, t, d.zone) : "", n: d.n ?? "" }, o.label.split(".").pop()) : labelOf(t, o.label);
    if (d.stunt && d.extra) return t("ITAC.ui.stunt.into", { stunt: base, name: nameOf(facts, d.extra, t) });       // Bang Heads, Trick Shot: the extra opponent is always named
    return d.stunt && d.target && (!oneTarget || d.onExtra) ? `${base}: ${nameOf(facts, d.target, t)}` : base;
  }
  if (kind === "reflexes") return t("ITAC.Prompt.reflexes.card", { card: o.id });
  const own = t(`ITAC.Prompt.${kind}.${o.id}`, { card: p.data?.card ?? o.data?.card ?? "" }, null) ?? t(`ITAC.ui.opt.${o.id}`, {}, null);
  return own ?? String(o.label ?? o.id);
}
/* P5: one line of a round-point queue that a hazard put there, in words (who burns, where, how hard) */
function dueLabel(o, t, facts) {
  const d = o.data, names = (d.targets ?? []).map((id) => nameOf(facts, id, t)).join(", "), who = d.combatant ? nameOf(facts, d.combatant, t) : names;
  switch (d.type) {
    case "fireAttack": return d.zone ? t("ITAC.ui.due.fireZone", { zone: zoneText(facts, t, d.zone), n: d.intensity ?? "?", names }) : t("ITAC.ui.due.fireOn", { name: who, n: d.intensity ?? "?" });
    case "fireSpread": return t("ITAC.ui.due.spread", { zone: zoneText(facts, t, d.zone) });
    case "vacuum": return t("ITAC.ui.due.vacuum", { name: who });
    case "disease": return t("ITAC.ui.due.disease", { name: who });
    case "blast": case "area": return d.zone ? t("ITAC.ui.due.blastZone", { zone: zoneText(facts, t, d.zone), names }) : t("ITAC.ui.due.blastOn", { names: who });
    default: return null;
  }
}
/* the sentence(s) under the title: what is being asked, in words */
function linesOf(p, t, facts, x) {
  const d = p.data ?? {}, kind = p.of ?? p.kind, n = (id) => nameOf(facts, id, t), about = p.aboutName ?? n(p.about);
  const out = [];
  switch (kind) {
    case "reaction": {      // U11: who attacks whom with what; a bystander's card names the target; an attacker the viewer cannot see is "somebody"
      const action = x.inst?.label?.name ? String(x.inst.label.name) : t(`ITAC.action.${x.inst?.action ?? d.action ?? d.attack}`, {}, t("ITAC.ui.anAttack"));
      const targets = (d.targets ?? []).filter((id) => id !== p.about).map(n).join(", ") || t("ITAC.Someone");
      if (d.bystander) out.push(t(d.attacker ? "ITAC.ui.line.attackBy" : "ITAC.ui.line.attackUnseenBy", { attacker: n(d.attacker), targets, action, name: about }));
      else if (d.attacker) out.push(t("ITAC.ui.line.attack", { attacker: n(d.attacker), target: about, action }));
      else out.push(t(d.unseen ? "ITAC.ui.line.attackUnseen" : "ITAC.ui.line.window", { name: about }));
      break;
    }
    case "counter": out.push(t("ITAC.ui.line.counter", { name: about })); break;
    case "dodgeMove": out.push(t("ITAC.ui.line.dodgeMove", { name: about })); break;
    case "moveStop": if (d.slab) { out.push(t("ITAC.ui.line.slabStop", { name: about, slab: t(`ITAC.ui.slab.${d.slab}`, {}, String(d.slab)), zone: zoneText(facts, t, d.spot) })); break; }
      out.push(t("ITAC.ui.line.moveStop", { name: about, zone: zoneText(facts, t, d.spot), why: (d.why ?? []).map((w) => t(`ITAC.ui.why.${w}`, {}, String(w))).join(", ") })); break;
    case "moveApprove": out.push(t("ITAC.ui.line.moveApprove", { name: about, from: zoneText(facts, t, d.from), to: zoneText(facts, t, d.to) })); if (d.cost && d.cost !== "none") out.push(t("ITAC.ui.line.moveCost", { cost: costText(t, d.cost) })); break;
    case "stunts": out.push(t("ITAC.ui.line.stunts", { n: p.max ?? 0 })); break;
    case "exception": {      // U3: the player's words, the rule that said no, and what a grant will do
      if (d.text) out.push({ quote: String(d.text), by: about });
      if (d.reason) out.push(t("ITAC.ui.line.why", { reason: reasonText(t, d.reason) }));
      const act = d.decl?.action ? t(`ITAC.action.${d.decl.action}`, {}, String(d.decl.action)) : null, to = (d.decl?.targets ?? []).map(n).join(", ");
      if (x.desk) out.push(p.inst ? t("ITAC.ui.line.grantGoes") : act && !d.other ? t("ITAC.ui.line.grantRuns", { name: about, action: to ? `${act} (${to})` : act }) : t("ITAC.ui.line.grantHand"));
      break;
    }
    case "other": if (d.text) out.push({ quote: String(d.text), by: about }); break;
    case "direction": if (d.vertical) {                                                           // thrown straight up or down: levels of one zone, and what is in the way
        const who = n(d.who ?? p.about), up = d.vertical === "up";
        if (d.levels > 0) out.push(t(`ITAC.ui.line.forced${up ? "Up" : "Down"}${d.by ? "By" : ""}`, { name: who, by: n(d.by), n: d.levels }));
        else out.push(t("ITAC.ui.line.forcedNoRoom", { name: who }));
        if (d.slabs?.length) out.push(t("ITAC.ui.line.slabs", { list: d.slabs.map((s) => t(`ITAC.ui.slab.${s}`, {}, String(s))).join(", ") }));
        break;
      }
      if (Array.isArray(d.zones)) {                                                              // a forced move (P3): where the map says the character flies
        /* the distance is the one of the rule (Knockback: half the STRENGTH [B2435]), the same number the attacker's own card names; the
           chain is what the map has room for, and when that is shorter the card says so beside it (D28: it used to call the length of the
           chain the distance: "3 zones" on the player's card, "1 zone" on the GM's) */
        const chain = d.zones.map((z) => zoneText(facts, t, z)), who = n(d.who ?? p.about), room = chain.length - 1, dist = Number.isFinite(d.distance) && d.distance > 0 ? Math.trunc(d.distance) : room;
        if (chain.length > 1) { out.push(t(d.by ? "ITAC.ui.line.forcedBy" : "ITAC.ui.line.forced", { name: who, by: n(d.by), n: dist, chain: chain.join(" \u2192 ") })); if (room < dist) out.push(t("ITAC.ui.line.forcedShort", { n: room, of: dist })); }
        else out.push(t("ITAC.ui.line.forcedNowhere", { name: who }));
        for (const w of d.walls ?? []) out.push(t("ITAC.ui.line.forcedWall", { armor: w.armor ?? 0 }));
        if (d.edge) out.push(t("ITAC.ui.line.forcedEdge"));
        break;
      }
    // falls through: the direction of a stunt
    case "stunt": out.push(t("ITAC.ui.line.stunt", { by: n(d.by), stunt: t(`ITAC.stunt.${d.stunt}`, {}, String(d.stunt ?? "")), target: n(d.target) }));
      if (d.stunt === "disarm") out.push(t(d.how === "keep" ? "ITAC.ui.line.disarmKeep" : "ITAC.ui.line.disarmDrop", { by: n(d.by) }));        // the GM names the item in the note
      break;
    case "helpOverride": out.push(t("ITAC.ui.line.help", { helper: about, name: n(d.for), reason: reasonText(t, d.reason) })); break;
    case "revalidate": out.push(t("ITAC.ui.line.revalidate", { name: about, reasons: (d.reasons ?? []).map((r) => reasonText(t, r)).join(", ") })); break;
    case "npcBroken": out.push(t("ITAC.ui.line.npcBroken", { name: about })); break;
    case "minionLoss": out.push(t("ITAC.ui.line.minionLoss", { name: about, by: n(d.by), n: d.suggested ?? 0, members: d.members ?? 0 })); break;
    case "minionsQuick": out.push(t("ITAC.ui.line.minionsQuick", { name: about, by: d.by ? n(d.by) : t("ITAC.ui.who.gm"), n: d.suggested ?? 0, members: d.members ?? 0 })); break;
    case "minionsFate": out.push(t("ITAC.ui.line.minionsFate", { name: about, n: d.removed ?? 0, left: d.left ?? 0 })); break;
    case "knockDir": out.push(t("ITAC.ui.line.knockDir", { target: n(d.target), n: d.distance ?? 0 })); break;
    case "disarm": out.push(t("ITAC.ui.line.disarm", { target: n(d.target) })); break;
    case "gate": out.push(t("ITAC.ui.line.gate", { name: about, gate: t(`ITAC.gate.${d.gate}`, {}, String(d.gate ?? "")) })); break;
    case "tokenConfirm": for (const k of d.tokens ?? []) out.push(t("ITAC.ui.line.token", { dice: k.dice, source: t(`ITAC.mod.${k.source}`, {}, String(k.source || "")), name: about })); break;
    case "veteran": out.push(t("ITAC.Prompt.veteran.Body", { name: about, card: d.card ?? "?" })); break;
    case "reflexes": out.push(t("ITAC.Prompt.reflexes.Body", { name: about })); break;
    case "grantConsent": out.push(t("ITAC.Prompt.grantConsent.Body", { name: about, from: d.from ? n(d.from) : t("ITAC.Someone") })); break;
    case "challengeFail": out.push(t("ITAC.Prompt.challengeFail.Body", { name: about })); if ((d.effects ?? []).length) out.push(t("ITAC.ui.line.failEffects", { list: d.effects.map((k) => t(`ITAC.ui.effect.${k}`, {}, String(k))).join(", ") })); break;
    /* P7 */
    case "objective": out.push(t(d.why === "power" ? "ITAC.ui.line.objectivePower" : "ITAC.ui.line.objective", { name: about, challenge: n(d.challenge), attr: attrText(t, d.attr), power: String(d.power ?? "") })); if (d.text) out.push({ quote: String(d.text), by: about }); break;
    case "chaseCatch": out.push(t(d.ram ? "ITAC.ui.line.chaseRam" : "ITAC.ui.line.chaseCharge", { name: about, target: n(d.target) })); break;
    case "chaseOption": out.push(t("ITAC.ui.line.chaseOption", { name: about, obstacle: t(`ITAC.ui.chase.obstacle.${d.obstacle}`, {}, String(d.obstacle ?? "")), attr: attrText(t, d.attr) })); break;
    case "triggerQueue": out.push(t("ITAC.Prompt.triggerQueue.Body")); break;
    /* P5: the GM's word on a narrative action, and the cards of the hazards */
    case "outcome": {
      const act = d.name ? String(d.name) : t(`ITAC.action.${d.action}`, {}, String(d.action ?? ""));
      out.push(d.rolled ? t(d.suggests === "fail" ? "ITAC.ui.line.outcomeFail" : "ITAC.ui.line.outcomeOk", { name: about, action: act, attr: attrText(t, d.attr), n: d.sixes ?? 0 }) : t("ITAC.ui.line.outcomeNoRoll", { name: about, action: act }));
      if (d.rolled && d.suggests !== "fail" && Number(d.net) > 1) out.push(t("ITAC.ui.line.outcomeSurplus", { n: Number(d.net) - 1 }));
      if (d.text) out.push({ quote: String(d.text), by: about });
      break;
    }
    case "hazardDodge": out.push(t(d.hazard === "area" ? "ITAC.ui.line.dodgeArea" : "ITAC.ui.line.dodgeBlast", { name: about, dice: d.dice ?? "?" })); break;
    case "hazardStunts": out.push(t("ITAC.ui.line.hazardStunts", { n: d.surplus ?? 0, names: (d.targets ?? []).map(n).join(", ") })); break;
    case "fireSpread": out.push(t("ITAC.ui.line.fireSpread", { zone: zoneText(facts, t, d.from), n: d.intensity ?? "?" })); break;
    case "vacuumDeath": out.push(t("ITAC.ui.line.vacuumDeath", { name: about })); break;
    default: break;
  }
  if (p.kind === "proxy") out.unshift(t("ITAC.ui.line.proxy", { users: (p.absent ?? []).map((u) => facts.userName?.(u) ?? u).join(", ") }));
  return out;
}
/** One question as both surfaces draw it.
    o = { t, facts, own, desk: bool, info: [instance lines] (to name the action a reaction answers), round }
    -> { id, kind, title, about, lines, options: [{ id, label, cost, note, disabled, picked, req, zones }], multi: { min, max, n } | null,
         free: { text, placeholder } | null, always: { on } | null, submit: { label, req, disabled } | null } */
export function askData(p, o) {
  const { t, facts, own = {}, desk = false } = o;
  const pb = desk ? null : (o.bars ?? []).find((b) => b.combatant === p.about) ?? null;      // U30: the asked character's own bar, when this user drives it (the cost of an answer is previewed on its slots)
  const kind = p.of ?? p.kind, inst = (o.info ?? []).find((i) => i.inst === p.inst) ?? null;
  const text = (own.texts?.[p.id] ?? "").trim(), always = !!own.always?.[p.id];
  const allIds = (p.options ?? []).filter((x) => !x.disabled).map((x) => x.id);
  const picks = own.picks?.[p.id] ?? (kind === "triggerQueue" ? allIds : []);
  const queue = kind === "triggerQueue";
  /* what the GM sees on a reaction card: the attacker's dice and, per answer, the chance that the attack still lands. The pools are the
     ENGINE's (flows/attack.mjs oddsFacts: the same builder as the roll), never an attribute read here: the sheet's dice, a weapon, bonus
     dice, a penalty are all in them, so the card, the roll that follows and "in progress" say the same number (D28). */
  const gmOdds = desk && kind === "reaction" && p.data?.attacker ? p.data.gm ?? null : null;
  const attPool = Number.isFinite(gmOdds?.att?.dice) ? Math.max(1, gmOdds.att.dice) : null;
  /* U11: the defender's own card says how likely the attack is to land with each answer, in the dock's bands (the engine's word:
     flows/attack.mjs oddsBands; absent for an attacker the viewer cannot see) */
  const bands = !desk && kind === "reaction" && p.data?.odds ? p.data.odds : null;
  const odds = (optId) => {
    if (bands) { const how = String(optId).split(":")[0], lv = DEF_ATTR[how] ? bands[how] : optId === "pass" ? bands.open : null; return Number.isInteger(lv) && BANDS[lv] ? t("ITAC.ui.odds.band", { band: t(`ITAC.ui.band.${BANDS[lv].id}`).toLowerCase() }) : null; }
    if (attPool == null) return null;
    const how = String(optId).split(":")[0], dPool = DEF_ATTR[how] ? gmOdds.def?.[how] : null;
    if (Number.isFinite(dPool)) return t("ITAC.ui.odds.defended", { dice: Math.max(1, dPool), p: pct(dice.pHit(attPool, Math.max(1, dPool))) });
    return optId === "pass" ? t("ITAC.ui.odds.open", { p: pct(dice.pSuccess(attPool)) }) : null;
  };
  /* stunts against one target only: the name goes into the sentence once instead of onto every button */
  const stuntTargets = [...new Set((p.options ?? []).map((x) => x.data?.stunt && !x.data?.onExtra && x.data?.target).filter(Boolean))], oneTarget = stuntTargets.length === 1;
  const places = (p.options ?? []).filter((x) => typeof x.data?.to === "string" && !x.disabled);       // P3 (the move a dodge earns): one option per place and way of moving
  const chosen = places.length ? own.zone?.[p.id] ?? null : null, here = places.filter((x) => bare(x.data.zone ?? x.data.to) === chosen);
  const wayLabel = (x) => [t(`ITAC.mode.${x.data.mode}`, {}, cap(x.data.mode ?? "")), x.data.elevated === "roof" ? t("ITAC.ui.way.roof") : x.data.elevated === "air" ? t("ITAC.ui.way.air") : null].filter(Boolean).join(", ");
  const placeOpts = !places.length ? [] : here.length
    ? [...here.map((x) => ({ id: x.id, label: wayLabel(x), cost: zoneText(facts, t, x.data.to), note: null, disabled: null, picked: false, pass: false, zones: null, req: x.req, zoneReq: null })),
      { id: "@again", label: t("ITAC.ui.move.again"), cost: null, note: null, disabled: null, picked: false, pass: true, zones: null, req: null, zoneReq: null, again: true }]
    : [{ id: "@zone", label: t("ITAC.ui.pick.zone"), cost: null, note: null, disabled: null, picked: false, pass: false, pickZone: true,
      zones: [...new Set(places.map((x) => bare(x.data.zone ?? x.data.to)))].map((z) => ({ zone: z, tip: [...new Set(places.filter((x) => bare(x.data.zone ?? x.data.to) === z).map(wayLabel))].join(" / ") })),
      /* the zone clicked on the map: one way to get there answers at once, several are shown as buttons (main.mjs keeps the zone) */
      zoneReq: (zone) => { const hit = places.filter((x) => bare(x.data.zone ?? x.data.to) === bare(zone)); return hit.length === 1 ? hit[0].req : null; }, req: null }];
  /* the bonus dice an answer may take along (a block or a dodge, spec 6.2): chips on the card, sent with the answer as { id, tokens } */
  const spare = new Map(); for (const x of p.options ?? []) for (const k of Array.isArray(x.data?.tokens) ? x.data.tokens : []) if (!spare.has(k.id)) spare.set(k.id, k);
  const tkPicked = (own.picks?.[`tk:${p.id}`] ?? []).filter((id) => spare.has(id));
  const tokens = [...spare.values()].map((k) => ({ id: k.id, label: t("ITAC.ui.bonusDice", { n: k.dice }), source: t(`ITAC.mod.${k.source}`, {}, String(k.source ?? "")), needsGm: !!k.needsGm, picked: tkPicked.includes(k.id) }));
  const options = [...placeOpts, ...(p.options ?? []).filter((x) => !places.includes(x)).map((x) => {
    const mine = tkPicked.filter((id) => (x.data?.tokens ?? []).some((k) => k.id === id));
    const value = text && p.free ? { id: x.id, text } : always ? { id: x.id, always: true } : mine.length ? { id: x.id, tokens: mine } : null;
    const zones = Array.isArray(x.data?.zones) ? x.data.zones : null;
    /* U23: a stunt says what it does (tooltip), and the card sorts them: on the target, another opponent brought in, on that opponent */
    const st = x.data?.stunt ?? null, stTip = st && has(t, `ITAC.ui.stunt.tip.${st}`) ? t(`ITAC.ui.stunt.tip.${st}`) : null;
    const group = !st ? null : x.data.onExtra ? { id: `on:${x.data.target}`, label: t("ITAC.ui.stunt.g.on", { name: nameOf(facts, x.data.target, t) }) } : x.data.extra ? { id: "more", label: t("ITAC.ui.stunt.g.more") } : { id: "main", label: null };
    const costWords = [costText(t, x.cost), x.stress ? t("ITAC.ui.stress", { n: x.stress }) : null].filter(Boolean).join(", ") || null;
    return { id: x.id, label: st && x.data.onExtra ? labelOf(t, x.label) : optLabel(p, x, t, facts, desk, oneTarget), cost: costWords,
      unit: x.cost === "full" || x.cost === "quick" ? x.cost : null, stress: Number(x.stress) || 0, icon: st ? `stunt:${st}` : kind === "reaction" ? `react:${String(x.id).split(":")[0]}` : null, group,
      tip: stTip ? tipOf(null, null, null, [stTip]) : null /* U51: the answer shows its name; the tooltip says what it does */, pv: pb && !x.disabled ? pvCost(pb, x.cost, x.stress) : null,
      note: odds(x.id), disabled: x.disabled ? reasonText(t, x.disabled) : null, picked: picks.includes(x.id), pass: x.id === "pass", zones,
      req: x.disabled || p.multi ? null : value && x.req ? p.answerReq(value) : x.req,
      zoneReq: zones && !x.disabled ? (zone) => p.answerReq({ id: x.id, zone: String(zone) }) : null,      // an option that carries zones: the place picked on the map rides along [D]
      ...(places.length && kind === "dodgeMove" && x.id === "move" ? { label: t("ITAC.ui.move.byHand") } : {}) };
  })];
  const lines = linesOf(p, t, facts, { inst, desk });
  /* U61: the one card of a quickly settled minion group: how many fall is a number on the card (it starts at what the damage says), and
     the two answers (knocked out, killed) send that number with them; at zero the one answer is "nobody falls" */
  if (kind === "minionsQuick") {
    const top = Math.max(0, ...(p.options ?? []).map((x) => Number(x.data?.n) || 0)), raw = own.vals?.[`mq:${p.id}`], v = Math.max(0, Math.min(top, Math.trunc(Number(raw ?? p.data?.suggested) || 0)));
    const pickOpt = (id) => options.find((x) => x.id === id) ?? null, mk = (x, label, icon) => (x ? { ...x, label, icon, group: null } : null);
    const shown = v > 0 ? [mk(pickOpt(`ko:${v}`), t("ITAC.opt.ko.n", { n: v }), "fate:ko"), mk(pickOpt(`kill:${v}`), t("ITAC.opt.kill.n", { n: v }), "fate:kill")] : [mk(pickOpt("none"), t("ITAC.opt.minionsNone"), "react:pass")];
    return { map: null, id: p.id, kind, proxy: false, pvFor: null, aboutId: p.about ?? null, aboutHead: true, check: false, title: titleOf({ ...p, to: "desk" }, t, facts, o.round), about: p.aboutName ?? nameOf(facts, p.about, t), lines, options: shown.filter(Boolean), multi: null, tokens: [], free: null, always: null, submit: null,
      count: { id: `mq:${p.id}`, value: v, min: 0, max: top, label: t("ITAC.ui.minions.fall"), of: t("ITAC.ui.minions.of", { n: p.data?.members ?? top }) } };
  }
  if (oneTarget) lines.push(t("ITAC.ui.line.against", { name: nameOf(facts, stuntTargets[0], t) }));
  if (attPool != null) lines.push(t("ITAC.ui.line.attPool", { dice: attPool, attr: attrText(t, gmOdds.att.attr ?? inst?.attr) }));
  const max = p.max ?? options.length, min = p.min ?? 0;
  const multi = p.multi ? { min, max, n: picks.length } : null;
  const canSubmit = !multi || queue || (picks.length >= min && picks.length <= max);
  return {
    map: desk && kind === "direction" && Array.isArray(p.data?.zones) && p.data.zones.length > 1 ? { zones: p.data.zones.map((z, i) => ({ zone: bare(z), label: i ? String(i) : "" })), borders: (p.data.walls ?? []).map((w) => w.border).filter(Boolean) } : null,
    id: p.id, kind, proxy: p.kind === "proxy", pvFor: pb ? p.about : null, aboutId: p.about ?? null, aboutHead: true, check: queue, title: titleOf({ ...p, to: desk ? "desk" : "player" }, t, facts, o.round), about: p.aboutName ?? nameOf(facts, p.about, t), lines, options, multi, tokens,
    free: p.free ? { text: own.texts?.[p.id] ?? "", placeholder: t(desk ? "ITAC.ui.note.gm" : "ITAC.ui.note.player") } : null,
    always: desk && Array.isArray(p.always) && p.always.length ? { on: always, label: t("ITAC.ui.always", { name: p.aboutName ?? "" }), tip: t("ITAC.ui.always.tip", { name: p.aboutName ?? "" }) } : null,
    submit: multi ? { label: queue ? t("ITAC.Prompt.triggerQueue.Go") : t("ITAC.ui.confirm", { n: picks.length, max }), disabled: canSubmit ? null : t("ITAC.ui.pickMore"),
      req: canSubmit ? p.answerReq(queue ? { order: [], skip: allIds.filter((id) => !picks.includes(id)) } : picks.slice()) : null } : null,
  };
}

/* ------------------------------------------------------------------ who the table waits for */
/** -> [{ who, mine, gm, what: [text] }] grouped by addressee; `mine` = this client is asked.
    U59, staff only: `since` = when the oldest thing asked of that addressee was asked (ms of the executor's clock; null when not kept),
    `nudge` = { label, tip, req } for others who are at the table (the engine sends them one line; no limit of time comes with it). */
export function waitingData(waiting, facts, t) {
  const rows = new Map();
  for (const w of waiting ?? []) {
    const list = Array.isArray(w.to) ? w.to : [], gm = w.to === "gm" || (list.length > 0 && list.every((u) => u === "gm")), users = gm ? [] : list;      // a roll of an NPC waits for "gm" as a user
    const mine = gm ? !!facts.staff : users.includes(facts.me);
    const who = mine ? t("ITAC.ui.who.you") : gm ? t("ITAC.ui.who.gm") : users.map((u) => facts.userName?.(u) ?? t("ITAC.Someone")).join(", ") || t("ITAC.Someone");
    const what = w.what === "roll" || w.what === "push" ? t(w.what === "push" ? "ITAC.ui.wait.push" : "ITAC.ui.wait.roll", { roll: rollLabel(t, w.key, { c: () => null }) }) : titleOf({ ...w, to: "player", aboutName: w.aboutName }, t, facts);
    const text = w.aboutName ? t("ITAC.ui.wait.about", { what, name: w.aboutName }) : what;
    const key = gm ? "gm" : users.join(",");
    if (!rows.has(key)) rows.set(key, { who, mine, gm, what: [], since: null, nudge: null });
    const row = rows.get(key);
    row.what.push(text);
    if (facts.staff && Number.isFinite(w.at) && (row.since === null || w.at <= row.since)) {
      row.since = w.at;
      row.nudge = !gm && !mine && w.nudgeReq && users.some((u) => facts.online?.(u)) ? { label: t("ITAC.ui.nudge", { name: who }), tip: t("ITAC.ui.nudge.tip"), req: w.nudgeReq } : null;
    }
  }
  return [...rows.values()].sort((a, b) => Number(b.mine) - Number(a.mine));
}

/* ------------------------------------------------------------------ U1 / U2: the rolls this client owes, and the news of the table (U10 / U3)
   Both are DATA for whatever draws them (the dock's waiting line today): no markup, no placement here. */
const usersText = (r, facts, t) => (r.users ?? []).map((u) => (u === "gm" ? t("ITAC.ui.who.gm") : facts.userName?.(u) ?? t("ITAC.Someone"))).join(", ") || t("ITAC.ui.who.gm");
/** May this client throw / accept / push that roll itself? A player: asked of it. Staff: the GM's own rolls ("gm": NPCs, absent players). */
export const rollMine = (r, facts) => (r.users ?? []).includes(facts.me) || (!!facts.staff && (r.users ?? []).includes("gm"));
/** The buttons of one roll row (desk-pure.rollRow). `act` is done on THIS client (main.mjs rollAct: the system's own roll, accept, push);
    `req` goes to the executor (the GM settling somebody else's roll). -> [{ id, label, tip, act? | req? }] */
export function rollButtons(r, facts, t) {
  const mine = rollMine(r, facts), ref = { inst: r.inst, key: r.key, rid: r.rid, messageId: r.messageId };
  if (r.state === "owed") return mine ? (facts.rollBusy?.(r.rid) ? [] : [{ id: "roll", label: t("ITAC.ui.rollbar.roll"), tip: null, act: { do: "roll", ...ref } }])
    : r.askReq ? [{ id: "ask", label: t("ITAC.ui.rollbar.ask"), tip: t("ITAC.ui.rollbar.ask.tip"), req: r.askReq }] : [];
  if (r.state !== "push") return [];
  if (mine && r.messageId) return [{ id: "accept", label: t("ITAC.ui.rollbar.accept"), tip: t("ITAC.ui.rollbar.accept.tip"), act: { do: "accept", ...ref } }, { id: "push", label: t("ITAC.ui.rollbar.push"), tip: t("ITAC.ui.rollbar.push.tip"), act: { do: "push", ...ref } }];
  return r.acceptReq ? [{ id: "acceptFor", label: t(mine ? "ITAC.ui.rollbar.accept" : "ITAC.ui.rollbar.acceptFor"), tip: t("ITAC.ui.rollbar.accept.tip"), req: r.acceptReq }] : [];
}
/** -> [{ id, state, text, buttons }] : the rolls this client has to do something about */
export function rollsData(rows, facts, t) {
  return (rows ?? []).filter((r) => r.state !== "done" && rollMine(r, facts)).map((r) => {
    const roll = rollLabel(t, r.key, facts), busy = r.state === "owed" && !!facts.rollBusy?.(r.rid);
    return { id: `${r.inst}:${r.key}`, inst: r.inst, state: busy ? "rolling" : r.state, text: r.state === "push" ? t("ITAC.ui.rollbar.sixes", { roll, sixes: r.sixes ?? 0 }) : t(busy ? "ITAC.ui.rollbar.rolling" : "ITAC.ui.rollbar.owed", { roll, dice: r.dice ?? "?" }), buttons: rollButtons(r, facts, t) };
  });
}
const newsNo = (n) => Number(String(n?.id ?? "").replace(/\D/g, "")) || 0;
function newsText(n, facts, t) {
  const who = n.actor ? nameOf(facts, n.actor, t) : "";
  const act = n.name ? String(n.name) : n.hazard ? t(`ITAC.ui.hz.kind.${n.hazard}`, {}, String(n.hazard)) : n.action ? t(`ITAC.action.${n.action}`, {}, String(n.action)) : "";
  const head = [who, act].filter(Boolean).join(": ");
  if (n.kind === "nudge") return t(n.roll ? "ITAC.ui.news.nudge.roll" : "ITAC.ui.news.nudge");      // U59: the GM asks for the answer the table waits for
  if (n.kind === "undo") return head ? t("ITAC.ui.news.undo", { what: head }) : t("ITAC.ui.news.undoAny");
  if (n.kind === "exception") {
    const note = n.note ? ` ("${String(n.note)}")` : "";
    if (!n.granted) return t("ITAC.ui.news.denied", { action: act || t("ITAC.card.exception") }) + note;
    return (n.ran === 1 ? t(n.held ? "ITAC.ui.news.granted.goes" : "ITAC.ui.news.granted.ran", { action: act }) : n.ran === 2 ? t("ITAC.ui.news.granted.hand") : t("ITAC.ui.news.granted.wait", { reason: reasonText(t, n.why ?? "busy") })) + note;
  }
  const rows = (n.rows ?? []).filter((r) => typeof r.hit === "boolean").map((r) => {
    const bits = [t(r.hit ? "ITAC.result.hit" : "ITAC.result.miss"), Number.isFinite(r.taken) ? t(r.stress ? "ITAC.ui.news.stress" : "ITAC.ui.news.taken", { n: r.taken }) : null, ...(r.stunts ?? []).map((s) => t(`ITAC.stunt.${s}`, {}, String(s)))].filter(Boolean);
    return `${nameOf(facts, r.target, t)}: ${bits.join(", ")}`;
  });
  const res = rows.length ? rows.join("; ") : n.result ? t(`ITAC.result.${n.result}`, {}, String(n.result)) : "";
  return [head, res].filter(Boolean).join(rows.length ? " > " : ": ") + (n.forced ? ` (${t("ITAC.ui.news.forced")})` : "") + (n.undone ? ` (${t("ITAC.ui.news.undone")})` : "");
}
/** What the table was told lately, for a player (view.news; nothing for staff: the journal is theirs). own.newsSeen = the number of the
    last line this user put away. A plain move is on the map already and is left out. -> null | { id, text, tone, older: [text], seen } */
export function newsData(view, own, facts, t) {
  if (facts.staff) return null;
  const round = view?.round ?? 0, seen = Number(own?.newsSeen) || 0;
  const list = (view?.news ?? []).filter((n) => newsNo(n) > seen && (n.round == null || n.round >= round - 1) && !(n.kind === "action" && ["move", "forced", "fall", "release", "seat"].includes(n.flow) && !(n.rows ?? []).some((r) => typeof r.hit === "boolean")));
  if (!list.length) return null;
  const last = list[list.length - 1], mine = (id) => !!id && Object.keys(view?.knowledge ?? {}).includes(id);
  const tone = last.kind === "nudge" ? "nudge" : last.kind === "exception" ? (last.granted ? "good" : "bad") : last.kind === "undo" || last.undone ? "warn" : (last.rows ?? []).some((r) => r.hit && mine(r.target)) ? "bad" : mine(last.actor) && (last.rows ?? []).some((r) => r.hit) ? "good" : "info";
  return { id: last.id, kind: last.kind, text: newsText(last, facts, t), tone, older: list.slice(-4, -1).reverse().map((n) => newsText(n, facts, t)), seen: newsNo(last), label: t("ITAC.ui.news.dismiss") };
}

/* ------------------------------------------------------------------ the player's dock */
/* P6: an action of the character's own sheet reads as "Sniper: Aim"; a plain use as the item's name; a switch says what it is now */
export const kitLabel = (t, a) => { const act = labelOf(t, a.label), k = String(a.label ?? "").split(".").pop(); return !a.name ? act : k === "toggle" ? t(a.fxOn ? "ITAC.ui.kit.on" : "ITAC.ui.kit.offNow", { name: a.name }) : k === "use" || act.toLowerCase() === String(a.name).toLowerCase() ? a.name : t("ITAC.ui.kit.name", { name: a.name, act }); };
const actLabel = (t, a) => (a.kit ? kitLabel(t, a) : labelOf(t, a.label));
/* U49: an ability of the sheet as its two halves: the thing it belongs to (the power, the talent: said ONCE per entry of the list) and
   the use itself. `of` = the item's own name (the bar's kitRows); a use that is just the item reads as the item alone. -> { name, use | null } */
export function kitParts(t, a, of = null) {
  const full = kitLabel(t, a), item = String(of ?? "").trim(), low = full.toLowerCase(), il = item.toLowerCase();
  if (!item || low === il) return { name: full, use: null };
  for (const sep of [": ", " - ", " \u2013 "]) if (low.startsWith(il + sep)) return { name: item, use: full.slice(item.length + sep.length).trim() || null };
  return { name: item, use: full };
}
/* U50: what a thing costs, in words. What takes no action says so in a whole sentence, with what it still costs (the user asked: "what
   does 'No action' mean, is it free?"); a full or a quick action is named with its price beside it. */
export const isFree = (cost) => cost === "none" || cost === "free";
export function priceWords(t, cost, stress = 0) {
  const n = Number(stress) || 0;
  if (isFree(cost)) return n > 0 ? t("ITAC.ui.free.costs", { n }) : t("ITAC.ui.free.only");
  return [costText(t, cost), n > 0 ? t("ITAC.ui.stress", { n }) : null].filter(Boolean).join(", ");
}
const instTitle = (t, i) => (i.label?.name ? kitLabel(t, i.label) : labelOf(t, `ITAC.action.${i.action}`));     // P6: a running action of the sheet is called by its own name
const CAT_ORDER = ["power", "boost", "limit", "talent", "drawback", "gear"];
/* U49: the columns of the abilities list. An entry (a power with its uses) is never cut in two; a column holds KIT_LINES lines (a row
   is one line, the name over several uses one more), an entry longer than that stands alone. -> [[entry index]] */
export const KIT_LINES = 6;
export function kitCols(entries) {
  const cols = []; let room = 0;
  entries.forEach((e, i) => { const n = e.rows.length + (e.rows.length > 1 ? 1 : 0); if (!cols.length || n > room) { cols.push([]); room = KIT_LINES; } cols[cols.length - 1].push(i); room -= n; });
  return cols;
}
export const GROUPS = Object.freeze(["attack", "move", "act", "power", "free"]);
export const groupOf = (a) => (a.kind === "custom" || a.tags?.includes("power") ? "power" : a.flow === "attack" || a.tags?.includes("attack") ? "attack" : a.flow === "move" || a.flow === "barrier" || a.tags?.includes("move") ? "move" : a.cost === "free" ? "free" : "act");

/* U31 [B2289] [B2291]: the two slots of a turn (ledger-pure.slots: the big one is the full action or a second quick one, the small one the
   quick action), and a further unit only when the character has one (Quickness, a defence grant, the GM's word).
   -> [{ key: "a" | "b" | "g:<id>", kind: "full" | "quick", unit, state, as, extra, label, tip, req }] */
export function slotsOf(bar, t) {
  const b = bar?.budget;
  if (!b) return [];
  const word = (u) => t(`ITAC.ui.pip.${u}`, {}, String(u ?? ""));
  const base = Lg.slots(b).map((s) => {
    const big = s.id === "A", kind = big ? "full" : "quick";
    const tipKey = s.state === "used" ? (big && s.as === "quick" ? "usedQuick" : "used") : s.state === "open" ? (s.only ? "openQuick" : "open") : "lost";
    return { key: big ? "a" : "b", kind, unit: s.unit, state: s.state, as: s.as ?? null, extra: false, label: word(s.only ?? kind), tip: t(`ITAC.ui.slot.${big ? "a" : "b"}.${tipKey}`),
      req: s.state === "lost" ? null : bar.markReq?.(s.unit, s.state === "open") ?? null };
  });
  const more = (b.grants ?? []).filter((g) => (g.state === "open" || g.state === "pending") && (g.unit === "full" || g.unit === "quick")).map((g) => ({ key: `g:${g.id}`, kind: g.unit, unit: g.unit, state: g.state, as: null, extra: true,
    label: t("ITAC.ui.grant", { unit: word(g.unit) }), tip: [t("ITAC.ui.grant", { unit: word(g.unit) }), g.stress ? t("ITAC.ui.stress", { n: g.stress }) : null, g.state === "pending" ? t("ITAC.ui.slot.pending") : null].filter(Boolean).join(". "), req: null }));
  return [...base, ...more];
}
/* U30: WHAT AN ACTION WOULD SPEND, shown on hover where the resource lives (the slot, the Resolve bar). Built only from the bar of a
   combatant this user drives (never from another's ledger). -> { slot: "a" | "b" | "g:<id>" | null, forfeits, stress } | null */
const slotKey = (grant) => (grant === Lg.BASE_A ? "a" : grant === Lg.BASE_B ? "b" : grant ? `g:${grant}` : null);
/** an action of the bar: the unit the ledger itself named for it (desk-pure.barModel `pay`) */
export function pvOf(a) {
  if (!a || a.disabled) return null;
  const slot = slotKey(a.pay?.grant), stress = (Number(a.stress) || 0) + (Number(a.pay?.stress) || 0);
  return slot || stress ? { slot, forfeits: !!a.pay?.forfeitsFull, stress } : null;
}
/** a thing with a cost of its own (a way of moving, an answer on a card): the order the ledger pays in [L1] [L3]: the quick unit, then the big one, then a grant */
export function pvCost(bar, cost, stress = 0) {
  const sl = bar?.budget ? Lg.slots(bar.budget) : [], open = (i) => sl[i]?.state === "open";
  const grant = (u) => (bar?.budget?.grants ?? []).find((g) => g.state === "open" && g.unit === u) ?? null;
  let slot = null, forfeits = false, extra = 0;
  const viaGrant = (u) => { const g = grant(u); if (g) { slot = `g:${g.id}`; extra = Number(g.stress) || 0; } };
  if (cost === "full") { if (open(0) && !sl[0].only) slot = "a"; else viaGrant("full"); }
  else if (cost === "quick") { if (open(1)) slot = "b"; else if (open(0)) { slot = "a"; forfeits = !sl[0].only; } else viaGrant("quick"); }
  const n = (Number(stress) || 0) + extra;
  return slot || n ? { slot, forfeits, stress: n } : null;
}
/* Health and Resolve of the driven character (facts.vitals answers only for a sheet this user may read) */
function vitalsOf(facts, cid, t) {
  const v = facts.vitals?.(cid) ?? null;
  if (!v) return [];
  return [["health", v.health, v.maxHealth], ["resolve", v.resolve, v.maxResolve]].filter(([, n, max]) => Number.isFinite(n) && Number.isFinite(max) && max > 0)
    .map(([id, n, max]) => ({ id, v: Math.max(0, n), max, label: t(`ITAC.ui.vital.${id}`), say: t("ITAC.ui.vital.of", { label: t(`ITAC.ui.vital.${id}`), v: Math.max(0, n), max }) }));
}
/* the picture of an action: its own id, or for something of the sheet its category (dom.mjs has the glyphs) */
const iconOf = (a) => (a.kit ? `kit:${a.kit.cat}` : a.id);
/* everything a tooltip says about an action: its name, what it costs, and when it cannot be done why */
const tipOf = (title, cost, note = null, lines = []) => ({ title, cost: cost || null, lines: lines.filter(Boolean), note: note || null });
function extrasOf(bar, t, facts = {}) {
  const out = [];
  for (const g of bar.budget?.grants ?? []) if (g.state !== "used" && g.state !== "refused" && g.unit !== "full" && g.unit !== "quick") out.push({ kind: "grant", label: t("ITAC.ui.grant", { unit: t(`ITAC.ui.pip.${g.unit}`, {}, String(g.unit ?? "")) }), tip: g.stress ? t("ITAC.ui.stress", { n: g.stress }) : "" });      // a full or quick unit is a slot (slotsOf)
  for (const k of bar.tokens ?? []) out.push({ kind: "token", label: t("ITAC.ui.bonusDice", { n: k.dice }), tip: t(`ITAC.mod.${k.source?.name}`, {}, String(k.source?.name ?? "")) + (k.needsGm ? ` (${t("ITAC.ui.needsGm")})` : "") });
  /* U22: a status that somebody else keeps up says who (held: the holder; holding: the one held); a name the viewer is not shown reads "somebody" */
  const st = facts.view?.statuses?.[bar.combatant] ?? [], other = (id) => (id && facts.view?.ledger?.[id] && facts.c?.(id) ? facts.c(id).name : t("ITAC.Someone"));
  for (const s of bar.statuses ?? []) { const d = st.find((x) => x.id === s)?.data ?? {};
    out.push({ kind: "status", label: t(`ITAC.status.${s}`, {}, cap(s)), tip: s === "grappled" ? t("ITAC.ui.status.heldBy", { name: other(d.by) }) : s === "grappling" && d.held ? t("ITAC.ui.status.holds", { name: other(d.held) }) : s === "carried" && d.by ? t("ITAC.ui.status.carriedBy", { name: other(d.by) }) : "" }); }
  return out;
}
/* what an attack is made with and how [P4]: the weapon (slugfest: bare hands or a melee weapon; shooting: a weapon with a range), and the options of
   the declaration the rules give it: wrecking the zone (a slugfest blow), an area or full auto (a weapon or an entry that has it). The executor
   judges every one of them again; this only keeps impossible choices off the panel.
   -> { weapons: { label, empty, items } | null, opts: [{ id, label, tip, on }], maxTargets, decl, dice: [{ label, dice }], why, notes: [text] } */
const FULL_AUTO_MAX = 12;
function armsOf(bar, a, own, facts, t) {
  const none = { weapons: null, opts: [], maxTargets: 1, decl: {}, dice: [], why: null, notes: [] };
  if (a.flow !== "attack") return none;
  const shooting = a.attack === "shooting", melee = a.attack === "slugfest";
  const list = a.unarmed ? [] : shooting || melee ? (facts.weapons?.(bar.combatant) ?? []).filter((w) => w.state !== "off" && (shooting ? Array.isArray(w.range) : !Array.isArray(w.range))) : [];
  const ids = [...(melee ? ["unarmed"] : []), ...list.map((w) => w.id)];
  const wname = (x) => (x.opt ? `${x.name} (${t(`ITAC.kit.opt.${x.opt}`, {}, x.opt)})` : x.tag ? `${x.name} + ${x.tag}` : x.name);      // P6: a power's attack and its variants
  const sel = ids.includes(own.weapon) ? own.weapon : ids[0] ?? null, w = list.find((x) => x.id === sel) ?? null;
  const rangeText = (x) => (Array.isArray(x.range) ? t(x.range[0] === x.range[1] ? "ITAC.ui.weapon.rangeOne" : "ITAC.ui.weapon.range", { min: x.range[0], max: x.range[1] }) : null);
  const tipOf = (x) => [x.bonus ? t("ITAC.ui.weapon.bonus", { n: x.bonus }) : null, x.damage != null ? t("ITAC.ui.weapon.damage", { n: x.damage }) : null, rangeText(x), x.sharp ? t("ITAC.ui.weapon.sharp") : null, x.stunEffect ? t("ITAC.ui.weapon.stunEffect") : null, x.singleUse ? t("ITAC.ui.weapon.singleUse") : null, x.noMove ? t("ITAC.ui.weapon.noMove") : null,
    x.noDamage ? t("ITAC.ui.weapon.noDamage") : null, x.toStress ? t("ITAC.ui.weapon.toStress") : null, x.onHit?.status ? t("ITAC.ui.weapon.gives", { status: t(`ITAC.status.${x.onHit.status}`, {}, x.onHit.status) }) : x.onHit?.stun ? t("ITAC.ui.weapon.stun") : null,
    x.attr ? attrText(t, x.attr) : null, x.stress ? t("ITAC.ui.stress", { n: x.stress }) : null].filter(Boolean).join(", ");
  const weapons = ids.length > 1 || shooting ? { label: t("ITAC.ui.weapon"), empty: ids.length ? null : t("ITAC.ui.weapon.none"),
    items: ids.map((id) => { const x = list.find((y) => y.id === id); return { id, name: x ? wname(x) : t("ITAC.ui.weapon.unarmed"), tip: x ? tipOf(x) : null, picked: id === sel }; }) } : null;
  const can = { wreck: a.id === "slugfest" && !w?.always, area: a.area || !!w?.area, fullAuto: shooting && (a.fullAuto || !!w?.fullAuto) };
  const on = { wreck: can.wreck && !!own.opts?.wreck, area: can.area && !!own.opts?.area, fullAuto: can.fullAuto && !!own.opts?.fullAuto && !own.opts?.area };
  const opts = ["wreck", "area", "fullAuto"].filter((k) => can[k]).map((k) => ({ id: k, label: t(`ITAC.ui.arm.${k}`), tip: t(`ITAC.ui.arm.${k}.tip`), on: on[k] }));
  return { weapons, opts, maxTargets: on.fullAuto ? FULL_AUTO_MAX : 1,
    decl: { ...(w ? { weapon: w.id } : {}), ...(on.wreck ? { wreck: true } : {}), ...(on.area ? { area: true } : {}), ...(on.fullAuto ? { fullAuto: true } : {}) },
    attr: w?.attr ?? null, dice: w?.bonus ? [{ label: w.name, dice: w.bonus }] : [], why: shooting && !w ? t("ITAC.ui.weapon.none") : null,
    notes: [on.wreck ? t("ITAC.ui.arm.wreck.note") : null, on.area ? t("ITAC.ui.arm.area.note") : null, on.fullAuto ? t("ITAC.ui.arm.fullAuto.note") : null].filter(Boolean) };
}
/* the panel above the bar: what the selected action needs before it can be declared (or why it cannot be, and the way to ask) */
function declarePanel(bar, a, own, facts, t) {
  const title = actLabel(t, a), cost = [costText(t, a.cost), a.stress ? t("ITAC.ui.stress", { n: a.stress }) : null].filter(Boolean).join(", ");
  if (a.disabled && (facts.staff || a.flow === "move" || a.flow === "barrier")) {      // (a move names its place on the map, a door on its row: their panels cannot be drawn for an action the bar refuses)
    /* the bar's reasons (not your turn, busy, nothing left to pay with) are refused by "declare" outright, so the way round them is the
       free-standing request to the GM; the action and the targets meant ride in its words */
    const names = (own.targets ?? []).map((id) => facts.view?.ledger?.[id] && facts.c?.(id)?.name).filter(Boolean).join(", ");
    return { kind: "blocked", action: a.id, title, cost, reason: t("ITAC.ui.blocked", { reason: reasonText(t, a.disabled) }), text: own.text ?? "", placeholder: t("ITAC.ui.exception.placeholder"),
      submit: { label: t("ITAC.ui.exception.ask"), disabled: (own.text ?? "").trim() ? null : t("ITAC.ui.exception.needText"), req: (own.text ?? "").trim() ? bar.exception.req(`${title}${names ? ` (${names})` : ""}: ${own.text.trim()}`.slice(0, 400), null, { reason: a.disabled }) : null } };
  }
  const arm = armsOf(bar, a, own, facts, t);
  /* P5 (flow "act"): the attribute the player names, a target that may be left out (the action is then about the actor), a few words for the GM */
  const list = a.attrs ?? [], chooser = list.length > 1, mineA = attrsFor(facts, bar.combatant) ?? {};
  const best = list.length === 2 ? list.slice().sort((x, y) => (Number(mineA[y]) || 0) - (Number(mineA[x]) || 0))[0] : null;
  const attr = chooser ? (list.includes(own.attr) ? own.attr : a.attrOptional ? null : best) : a.attr;
  const attrs = chooser ? { label: t("ITAC.ui.attrPick"), hint: attr ? null : t(a.attrOptional ? "ITAC.ui.attr.noRoll" : "ITAC.ui.need.attr"),
    items: list.map((id) => ({ id, label: attrText(t, id), dice: Number.isFinite(Number(mineA[id])) ? Number(mineA[id]) : null, picked: id === attr })) } : null;
  const wantsTarget = a.needsTarget || a.optTarget, carries = (id) => !a.about || (facts.view?.statuses?.[id] ?? []).some((s) => s.id === a.about);
  const pool0 = wantsTarget ? targetsFor(a, facts, bar.combatant) : [], fit = pool0.filter((r) => carries(r.id)), all = wantsTarget ? (fit.length ? fit : pool0) : null;
  const lone = all && ["challenge", "vehicle"].includes(a.targetWho) && all.length === 1 ? [all[0].id] : null;      // P7: one challenge, one vehicle: nothing to pick
  const picked = lone ?? (own.targets ?? []).filter((id) => all?.some((x) => x.id === id)).slice(-arm.maxTargets);
  const targets = all ? all.map((r) => ({ id: r.id, name: r.name, img: r.img, likely: r.likely, picked: picked.includes(r.id), note: r.unseen ? t("ITAC.reason.unseen") : null })) : null;
  const ap = a.flow === "challenge" ? approachOf(facts, picked[0], own, bar, t) : null;
  /* P6: only the dice that can go on THIS roll are offered (a +2 for a FIGHTING attack is not a choice on a shot, nor on an action without a roll) */
  const rAttr = ap?.attr ?? arm.attr ?? attr ?? null, rKind = a.flow === "attack" ? "attack" : "other", rolls = a.flow === "attack" || a.flow === "challenge" || !!rAttr || chooser;
  const fits = (k) => rolls && !k.forced && !k.standing && (!k.scope?.rolls?.length || k.scope.rolls.includes(rKind)) && (!k.scope?.attrs?.length || !rAttr || k.scope.attrs.includes(rAttr));
  const tokens = (bar.tokens ?? []).filter(fits).map((k) => ({ id: k.id, label: t("ITAC.ui.bonusDice", { n: k.dice }), source: t(`ITAC.mod.${k.source?.name}`, {}, String(k.source?.name ?? "")), needsGm: !!k.needsGm, picked: (own.tokens ?? []).includes(k.id) }));
  /* P6: the choice an ability asks for (a plan, good or bad luck, how much) */
  const pickId = a.pick?.includes(own.choice) ? own.choice : a.pick?.length === 1 ? a.pick[0] : null;
  const choice = a.pick?.length ? { label: t("ITAC.ui.kit.choice"), hint: a.kit?.state === "assist" ? t("ITAC.ui.kit.gmWord") : null, items: a.pick.map((id) => ({ id, label: comboLabel(t, id), picked: id === pickId })) } : null;
  const text = (own.text ?? "").trim();
  const needsZone = a.flow === "fastball" || a.flow === "drive";      // drive (P7): where the vehicle goes
  const decl = { ...(wantsTarget ? { targets: picked.slice() } : {}), ...arm.decl, ...(chooser && attr ? { attr } : {}), ...(a.wantsText && text ? { text } : {}), ...(needsZone && own.to ? { to: own.to } : {}), ...((own.tokens ?? []).length ? { tokens: own.tokens.slice() } : {}), ...(a.needsText ? { text } : {}), ...(ap?.decl ?? {}), ...(pickId ? { opt: pickId } : {}) };
  /* THE POOL: the engine's own answer for this very declaration (op "preview": the builder the roll uses, the flows' preview), so the
     panel, the reaction card, "in progress" and the dice thrown say one number. facts.preview is asked by main.mjs through the relay
     and remembered; until it answers, and where nobody can know yet (no target), no number is shown rather than a guess. */
  const pv = facts.preview?.(bar.combatant, { ...decl, action: a.id }) ?? null;
  /* W1 (U33 / U34 / U13): THE TARGETS ARE CHOSEN ON THE MAP. facts.reach asks the engine (op "preview" with `of`) about every candidate
     of this very declaration: the answer of the legality the declaration will meet, the dice of the roll, what a hit would do. One
     question per change of the declaration or of the fight (never per mouse move; the words typed for the GM are not part of it).
     A target that stands on this user's map (`map`) is marked there and has no chip in the panel; a chosen one the engine refuses
     shows the reason at once, with the way to ask, before anything is declared. Nothing is marked until the engine answered. */
  const { targets: tg0, text: tx0, ...core } = decl;
  const reach = facts.board && all?.length && !lone ? facts.reach?.(bar.combatant, { ...core, action: a.id }, all.map((r) => r.id)) ?? null : null;
  const oddsOf = (n, tgt) => oddsFor(a, n, tgt, facts, t);
  if (targets) for (const x of targets) {
    const r = reach?.[x.id] ?? null;
    x.map = !!facts.board && !!facts.onMap?.(x.id);
    x.reach = r ? (r.ok ? "in" : "out") : reach && x.note ? "out" : null;
    x.why = r && !r.ok ? reasonText(t, r.reason, r.params) : x.reach === "out" ? x.note : null;
    x.odds = r?.ok ? oddsOf(r.dice, x.id) : null;
    x.hit = r?.ok ? r.hit ?? null : null;
  }
  const early = (targets ?? []).find((x) => x.picked && x.reach === "out") ?? null, onMap = (targets ?? []).some((x) => x.map);
  const pool = pv && Number.isFinite(pv.dice) ? { total: pv.dice, parts: [{ id: pv.attr ?? "base", dice: pv.base ?? 0 }, ...(pv.mods ?? []).map((m) => ({ label: t(`ITAC.mod.${String(m.source).split(":")[0]}`, {}, String(m.source)), dice: m.dice }))] } : null;
  const chance = pool && !onMap ? oddsOf(pool.total, picked[0]) : null;      // W1: with the targets on the map the chance stands over each token, not in the panel
  const why = arm.why ?? (choice && !pickId ? t("ITAC.ui.need.choice") : a.needsTarget && !picked.length ? t("ITAC.ui.need.target") : chooser && !attr && !a.attrOptional ? t("ITAC.ui.need.attr") : needsZone && !own.to ? t("ITAC.ui.need.zone") : a.needsText && !text ? t("ITAC.ui.need.text") : ap?.why ?? null);
  /* the executor refused this very declaration as against the rules (out of reach, no line of sight...): the reason stays in the panel
     with the way round it, a declaration that carries a request for an exception (a card on the GM desk; the GM's own goes there too) */
  const ref = own.refused && own.refused.action === a.id && own.refused.key === picked.join(",") ? own.refused : early ? { early: 1 } : null;
  const refused = ref ? { reason: t("ITAC.ui.blocked", { reason: ref.early ? early.why : reasonText(t, ref.reason, ref.params) }), text: facts.staff ? null : own.why ?? "", placeholder: t("ITAC.ui.exception.placeholder"),
    submit: { label: facts.staff ? t("ITAC.ui.exception.anyway") : t("ITAC.ui.exception.ask"), disabled: why ?? (facts.staff || (own.why ?? "").trim() ? null : t("ITAC.ui.exception.needText")),
      req: !why && (facts.staff || (own.why ?? "").trim()) ? a.exceptionReq(decl, facts.staff ? t("ITAC.ui.who.gm") : own.why.trim()) : null } }
    /* U3: the bar itself says no (not your turn, no action left, the table is busy): the panel stays whole, so the request to the GM
       carries the very declaration it is about, and a grant can run it */
    : a.disabled ? { reason: t("ITAC.ui.blocked", { reason: reasonText(t, a.disabled) }), text: own.why ?? "", placeholder: t("ITAC.ui.exception.placeholder"),
      submit: { label: t("ITAC.ui.exception.ask"), disabled: why ?? ((own.why ?? "").trim() ? null : t("ITAC.ui.exception.needText")),
        req: !why && (own.why ?? "").trim() ? bar.exception.req(`${title}${picked.length ? ` (${picked.map((id) => nameOf(facts, id, t)).join(", ")})` : ""}: ${own.why.trim()}`.slice(0, 400), null, { reason: a.disabled, decl: { ...decl, action: a.id } }) : null } } : null;
  return { kind: "declare", action: a.id, title, cost, unit: a.cost, pv: pvOf(a), choice, targets, picking: !!a.needsTarget && !picked.length, tokens, refused, onMap, reached: !!reach, area: !!arm.decl.area,
    aim: onMap ? picked.map((id) => (targets ?? []).find((x) => x.id === id)).filter(Boolean).map((x) => ({ id: x.id, name: x.name, img: x.img })) : null, attrs, approach: ap, maxTargets: arm.maxTargets, weapons: arm.weapons, opts: arm.opts, notes: arm.notes,
    self: a.optTarget && !picked.length ? t("ITAC.ui.target.self", { name: bar.name ?? "" }) : null,
    dest: needsZone ? { label: t("ITAC.ui.dest"), value: own.to ? zoneText(facts, t, own.to) : null, pick: t(own.to ? "ITAC.ui.move.again" : "ITAC.ui.pick.zone") } : null,
    pool: pool ? { total: pool.total, parts: pool.parts.map((x) => (x.label ? { label: x.label, dice: x.dice } : x.id === "token" ? { label: t(`ITAC.mod.${x.source}`, {}, String(x.source || t("ITAC.ui.bonus"))), dice: x.dice } : x.id === "sheet" ? { label: t("ITAC.mod.sheet"), dice: x.dice } : { label: attrText(t, x.id), dice: x.dice })) } : null, chance,
    text: a.needsText || a.wantsText || ap?.own.picked ? { value: own.text ?? "", placeholder: t(ap ? "ITAC.ui.approach.placeholder" : a.needsText ? "ITAC.ui.text.placeholder" : "ITAC.ui.text.optional") } : null,
    submit: { label: own.amend ? t("ITAC.ui.amend") : t("ITAC.ui.declare"), disabled: a.disabled ? reasonText(t, a.disabled) : why ?? early?.why ?? null, quiet: !why && !a.disabled && !!early, req: why || a.disabled || early ? null : own.amend ? { op: "amend", inst: own.amend, decl: { ...decl, action: a.id } } : a.req(decl) } };
}
/* W1 (U35): WHAT THE DRIVEN CHARACTER COULD DO TO `tid` (the menu at a token on the map): the actions of its bar that take a target
   and count `tid` among their candidates, each with the declaration it would start from (the first weapon, no options). The engine
   answers for every one of them whether it is legal and what it rolls (op "preview" with `acts`); this only names them.
   -> [{ id, label, icon, cost, stress, disabled, decl, opposeAttr, defense }] */
export function targetActs(bar, tid, facts, t) {
  const holding = (bar?.statuses ?? []).includes("grappling");
  return (bar?.actions ?? []).filter((a) => a.id !== "other" && (a.needsTarget || a.optTarget) && !["move", "barrier", "challenge", "drive"].includes(a.flow) && !["challenge", "vehicle"].includes(a.targetWho)
    && (holding || (a.id !== "release" && a.id !== "grappleAttack")) && (!a.about || (facts.view?.statuses?.[tid] ?? []).some((s) => s.id === a.about)) && targetsFor(a, facts, bar.combatant).some((r) => r.id === tid))
    .slice(0, 12).map((a) => { const arm = armsOf(bar, a, {}, facts, t);
      return { id: a.id, label: actLabel(t, a), icon: iconOf(a), cost: a.cost, stress: Number(a.stress) || 0, disabled: a.disabled ? reasonText(t, a.disabled) : arm.why, decl: { action: a.id, ...arm.decl }, opposeAttr: a.opposeAttr ?? null, defense: a.defense ?? null }; });
}
/* ---- movement (P3): the map answers "where" (a zone picked on it, or a token dragged), the panel answers "how" and what it costs ---- */
const COST_RANK = { none: 0, free: 0, quick: 1, full: 2, gm: 3 };
const shortCost = (t, o) => [t(`ITAC.ui.costShort.${o.cost ?? "none"}`, {}, String(o.cost ?? "")), o.stress ? t("ITAC.ui.stress", { n: o.stress }) : null].filter(Boolean).join(", ");
/** the way round a refusal: the GM's own client declares anyway; a player writes why and asks. `unpaid`: only the action economy says
    no, which a declaration cannot carry past the executor, so the question goes to the GM as a free request. */
function askBox(a, bar, decl, o, reason, own, facts, t, what) {
  const text = (own.why ?? "").trim();
  if (facts.staff) return { reason, text: null, placeholder: "", submit: { label: t(o.unpaid ? "ITAC.ui.move.gmFree" : "ITAC.ui.exception.anyway"), disabled: null,
    req: o.unpaid ? { ...a.req(decl), gm: true } : a.exceptionReq(decl, t("ITAC.ui.who.gm")) } };
  return { reason, text: own.why ?? "", placeholder: t("ITAC.ui.exception.placeholder"), submit: { label: t("ITAC.ui.exception.ask"), disabled: text ? null : t("ITAC.ui.exception.needText"),
    req: !text ? null : o.unpaid ? bar.exception.req(`${what}: ${text}`.slice(0, 400), null, { reason: typeof o.disabled === "string" ? o.disabled : undefined, decl: { ...decl, action: a.id } }) : a.exceptionReq(decl, text) } };
}
function movePanel(bar, a, own, facts, t) {
  const title = labelOf(t, a.label), m = facts.move?.(bar.combatant) ?? null, opts = m?.options ?? [];
  const base = { kind: "move", action: a.id, title, cost: null, dest: null, near: [], nearLabel: t("ITAC.ui.move.near"), zones: [], picking: false, hint: null, ask: null, empty: null };
  if (!m) return { ...base, empty: t("ITAC.ui.move.noMap") };
  if (!opts.length) {
    const reason = t("ITAC.move.cannot", { reason: reasonText(t, m.why ?? "noRoute") });
    return { ...base, empty: reason, ask: askBox(a, bar, {}, { unpaid: 1 }, null, own, facts, t, title) };
  }
  const ref = own.refused?.action === a.id ? own.refused : null;
  const row = (o) => {
    const mine = ref && ref.key === o.id, disabled = mine ? reasonText(t, ref.reason, ref.params) : o.disabled ? reasonText(t, o.disabled) : null;
    const where = o.area ? zoneText(facts, t, `@${o.area}`) : o.elevated === "roof" ? t("ITAC.ui.way.roof") : o.elevated === "air" ? t("ITAC.ui.way.air") : o.here ? t("ITAC.ui.way.down") : null;
    const decl = { to: o.to, mode: o.mode, ...(o.stress ? { stress: 1 } : {}), ...(o.force ? { force: true } : {}) };
    return { id: o.id, label: [t(`ITAC.mode.${o.mode}`, {}, cap(o.mode)), where].filter(Boolean).join(", "), cost: o.cost ?? null,
      notes: [o.cost ? costText(t, o.cost) : null, o.stress ? t("ITAC.ui.stress", { n: o.stress }) : null, o.barriers?.length ? t("ITAC.move.force", { n: o.barriers.length }) : null, o.gm ? t("ITAC.ui.needsGm") : null].filter(Boolean),
      warn: !!(o.stress || o.barriers?.length), disabled, asking: own.ask === o.id, req: disabled ? null : a.req(decl), o, decl, pv: disabled ? null : pvCost(bar, o.cost, o.stress) };
  };
  const board = !!facts.board;
  const hazardsOf = (o) => [...(o.barriers ?? []).map((b) => ({ border: b.border, text: t(b.element === "door" ? "ITAC.map.haz.door" : "ITAC.map.haz.wall", { n: b.armor ?? 0 }), color: "danger" })), ...(facts.hazards?.(bar.combatant, o.route ?? [o.zone], o.to) ?? [])];
  const far = opts.filter((o) => !o.here && !o.area && o.zone), byZone = new Map();
  for (const o of far) { if (!byZone.has(o.zone)) byZone.set(o.zone, []); byZone.get(o.zone).push(o); }
  /* what the map offers: every zone one action reaches, in the colour of its cheapest way (blocked ones are shown too, so the reason can be read and the GM asked) */
  const zones = [...byZone].map(([zone, list]) => {
    const can = list.filter((o) => !o.disabled).sort((x, y) => (COST_RANK[x.cost] ?? 9) - (COST_RANK[y.cost] ?? 9) || (x.stress ?? 0) - (y.stress ?? 0) || (x.barriers?.length ?? 0) - (y.barriers?.length ?? 0));
    const best = can[0] ?? list[0], mode = t(`ITAC.mode.${best.mode}`, {}, cap(best.mode));
    const e = can.length ? { zone, label: shortCost(t, best), tip: `${mode}: ${shortCost(t, best)}`, color: best.barriers?.length ? "danger" : best.stress ? "stress" : "move" }
      : { zone, label: "", tip: `${mode}: ${reasonText(t, best.disabled)}`, color: "blocked", style: "dashed" };
    /* W1 (U32 / U14): the same zone as an entry of the map's move preview: the default way (the cheapest that can be paid) goes with
       one click, its price in words, the zones it enters, what waits on it; `more`: there is another way (a right click lists them) */
    return board ? { ...e, cost: can.length ? `${mode}: ${priceWords(t, best.cost, best.stress)}` : `${mode}: ${reasonText(t, best.disabled)}`, ...(best.route?.length ? { route: best.route } : {}), hazards: can.length ? hazardsOf(best) : [], more: list.length > 1, way: can.length ? best.id : null, ask: can.length ? null : best.id } : e;
  });
  if (board) {
    const all = opts.map(row), asked = all.find((r) => r.asking && r.disabled) ?? null, here = opts.filter((o) => o.here || o.area), spot = facts.where?.(bar.combatant) ?? null;
    const item = (r) => ({ id: r.id, label: r.label, cost: r.cost, hint: r.notes.join(" · "), disabled: r.disabled, req: r.req, pv: r.pv });
    const ways = {}; for (const [zone, list] of byZone) ways[zone] = list.map((o) => item(all.find((r) => r.id === o.id)));
    /* up, down and off the map have no zone of their own to click: they hang on the zone the character stands in */
    if (here.length && spot) { const z = bare(spot), rows = here.map((o) => item(all.find((r) => r.id === o.id))), can = rows.filter((r) => !r.disabled);
      ways[z] = rows; zones.push({ zone: z, label: t("ITAC.map.move.here"), tip: t("ITAC.ui.move.near"), cost: t("ITAC.ui.move.near"), color: can.length ? "move" : "blocked", ...(can.length ? {} : { style: "dashed" }), hazards: [], more: rows.length > 1, way: rows.length === 1 && can.length ? rows[0].id : null, ask: null, menu: rows.length > 1 || !can.length }); }
    return { ...base, zones, ways, picking: zones.length > 0, bare: !asked, hint: zones.length ? t("ITAC.map.move.hint") : null,
      ask: asked ? askBox(a, bar, asked.decl, asked.o, t("ITAC.ui.blocked", { reason: asked.disabled }), own, facts, t, `${title}, ${zoneText(facts, t, asked.o.to)} (${asked.label})`) : null,
      empty: !zones.length ? t("ITAC.move.cannot", { reason: reasonText(t, "noRoute") }) : null };
  }
  const to = own.to && byZone.has(bare(own.to)) ? bare(own.to) : null;
  const rows = to ? byZone.get(to).map(row) : [], near = opts.filter((o) => o.here || o.area).map(row);
  const asked = [...rows, ...near].find((r) => r.asking && r.disabled) ?? null;
  const strip = (r) => ({ id: r.id, label: r.label, cost: r.cost, notes: r.notes, warn: r.warn, disabled: r.disabled, asking: !!asked && asked.id === r.id, req: r.req, pv: r.pv });
  return { ...base, zones, picking: !to && zones.length > 0, hint: !to && zones.length ? t("ITAC.move.pickHint") : null,
    dest: to ? { zone: to, label: zoneText(facts, t, to), rows: rows.map(strip), again: t("ITAC.ui.move.again") } : null, near: to ? [] : near.map(strip),   // a zone is chosen: only its ways; "another zone" brings the rest back
    ask: asked ? askBox(a, bar, asked.decl, asked.o, t("ITAC.ui.blocked", { reason: asked.disabled }), own, facts, t, `${title}, ${zoneText(facts, t, asked.o.to)} (${asked.label})`) : null,
    empty: !zones.length && !near.length ? t("ITAC.move.cannot", { reason: reasonText(t, "noRoute") }) : null };
}
/* a door as an action (open, break a locked one, work the lock): the doors of the mover's own zone, each with its state */
function doorPanel(bar, a, own, facts, t) {
  const title = labelOf(t, a.label), ref = own.refused?.action === a.id ? own.refused : null;
  const rows = (facts.doors?.(bar.combatant) ?? []).map((d) => {
    const state = t(`ITAC.ui.door.${d.state}`, {}, String(d.state)), why = ref?.key === d.to ? ref.reason : d.actions?.[a.id] ?? null;
    const disabled = !why ? null : why === "doorState" ? t("ITAC.ui.door.is", { state }) : reasonText(t, why, ref?.key === d.to ? ref.params : {});
    return { id: d.to, label: t("ITAC.ui.door.to", { zone: zoneText(facts, t, d.zone) }), notes: [state, t("ITAC.ui.armor", { n: d.armor ?? 0 })], cost: a.cost, warn: false, disabled, asking: own.ask === d.to && !!disabled, req: disabled ? null : a.req({ to: d.to }), d, pv: disabled ? null : pvOf(a) };
  });
  const asked = rows.find((r) => r.asking) ?? null;
  return { kind: "door", action: a.id, title, cost: costText(t, a.cost), rows: rows.map(({ d, ...r }) => r), borders: rows.map((r) => ({ border: r.id, label: r.notes[0], color: r.disabled ? "blocked" : "target" })),
    empty: rows.length ? null : t("ITAC.ui.door.none"),
    ask: asked ? askBox(a, bar, { to: asked.id }, {}, t("ITAC.ui.blocked", { reason: asked.disabled }), own, facts, t, `${title}, ${asked.label}`) : null };
}
/* U46: `asked` = the table waits for this very user (a card above, a roll of its own): the panel must not tell them to wait for the others */
/* U52: THE ROLL LIVES HERE. `rolls` = the rows of rollsData that belong to this action (the dice or the sixes, with Roll / Accept /
   Push): while there is one the panel says nothing else about the roll and the status line carries no chip for it. The targets come
   with their pictures, for those the viewer's own view holds (the same rule as the target chips of the declare panel: a concealed
   combatant is not in the view's ledger and gets no picture). A question of the user's own stands as a card right above: the panel
   then says only that the action is declared. */
const seenImg = (facts, id) => (facts.view?.ledger?.[id] ? facts.c?.(id)?.img ?? null : (facts.special?.() ?? []).find((x) => x.id === id)?.img ?? null);
function minePanel(i, facts, t, rolls = [], asked = false) {
  const roll = i.rolls?.[0];
  return { kind: "mine", inst: i.inst, title: instTitle(t, i), targets: (i.targets ?? []).map((x) => ({ id: x.id, name: x.name ?? nameOf(facts, x.id, t), img: seenImg(facts, x.id) })), text: i.text ?? null, rolls,
    status: rolls.length ? null : roll ? t("ITAC.ui.mine.roll", { dice: roll.dice ?? "?", roll: rollLabel(t, roll.key, facts) }) : i.status === "manual" ? t("ITAC.ui.mine.manual") : t(asked ? "ITAC.ui.mine.declared" : "ITAC.ui.mine.open"),      // `asked`: the card above or the line below already says who the table waits for
    rolling: !!roll || rolls.length > 0, commands: (i.commands ?? []).map((c) => ({ id: c.id, label: labelOf(t, c.label), req: c.needs ? null : c.req, amend: c.id === "amend" })) };
}
/* W1 (U42): the camera is the player's. The map moves the view at the start of a turn only when the active character is off this
   user's screen ("turn", what this module asks for); the switch goes round turn -> off -> all. Null where the map has no such stage. */
export const CAMERA = Object.freeze(["turn", "off", "all"]);
export function cameraOf(facts, t) {
  const c = facts.camera?.() ?? null, now = CAMERA.includes(c?.follow) ? c.follow : null;
  if (!now) return null;
  const next = CAMERA[(CAMERA.indexOf(now) + 1) % CAMERA.length];
  return { follow: now, next, label: t(`ITAC.map.cam.${now}`), tip: `${t(`ITAC.map.cam.${now}`)}. ${t("ITAC.map.cam.next", { next: t(`ITAC.map.cam.${next}`) })}` };
}
/** Everything the dock draws. -> { show: false } | { show, rest, chars, who, slots, vitals, extras, groups, other, holdOff, hotbar, end, panel, prompts, waiting, turn } */
export function dockData(model, own, facts, t) {
  const bars = model?.bars ?? [];
  const info = model?.stack ?? [];
  const prompts = (model?.prompts ?? []).map((p) => askData(p, { t, facts, own, info, round: model?.turn?.round, bars }));
  if (!bars.length) return Keys.number({ show: false, prompts, waiting: waitingData(model?.waiting, facts, t), rolls: [], news: null, keys: { on: !own.hotbar, enter: t("ITAC.ui.key.enter"), chosen: own.kopt ?? null } }, own);
  const asked = new Set((model?.prompts ?? []).map((p) => p.about));
  const bar = bars.find((b) => b.combatant === own.sel) ?? bars.find((b) => b.onTurn) ?? bars.find((b) => asked.has(b.combatant)) ?? bars[0];
  /* U51: a card about the very character the bar below it shows does not name it again in its head (the name stands on the bar);
     a card about another of the user's characters keeps the name */
  for (const a of prompts) if (a.aboutId && a.aboutId === bar.combatant) a.aboutHead = false;
  const c = facts.c?.(bar.combatant);
  /* a door action is a button only where a door stands that it could be tried on (no door at the zone: no button; a locked door: only breaking it) */
  const doors = bar.actions.some((a) => a.flow === "barrier") ? facts.doors?.(bar.combatant) ?? [] : [];
  const doorFits = (a) => doors.some((d) => d.actions?.[a.id] !== "doorState");
  const holding = (bar.statuses ?? []).includes("grappling");                                   // the holder's two actions show only while it holds someone [P4]
  /* the Fastball Special stands on the bar only for somebody who has a friend to throw: one of the own side, weaker where both Strengths are known [B2390] */
  const myStr = Number(attrsFor(facts, bar.combatant)?.strength);
  const canThrow = (a) => targetsFor(a, facts, bar.combatant).some((r) => { const s = Number(attrsFor(facts, r.id)?.strength); return r.side === "own" && (!Number.isFinite(myStr) || !Number.isFinite(s) || s < myStr); });
  const acts = bar.actions.filter((a) => a.id !== "other" && (a.flow !== "barrier" || doorFits(a) || own.armed === a.id) && (holding || (a.id !== "release" && a.id !== "grappleAttack")) && (a.flow !== "fastball" || canThrow(a) || own.armed === a.id));
  /* P5: the bar keeps what is asked for most; the other rows of the action tables wait behind one "More actions" button, except the ones
     the situation calls for (break free, put out the fire, stabilize, rally), which stand on the bar while they apply */
  const inMenu = (a) => !a.kit && a.flow === "act" && !a.situational && groupOf(a) === "act", menu = acts.filter(inMenu);
  /* P6: what the character's own sheet brings stands behind ONE button (the bar stays as short as it was); its list says for every entry
     whether the engine applies it, the GM confirms it, or it is run by hand */
  const kitActs = acts.filter((a) => a.kit).sort((x, y) => CAT_ORDER.indexOf(x.kit.cat) - CAT_ORDER.indexOf(y.kit.cat)), kitRows = bar.kitRows ?? [], hasKit = kitActs.length > 0 || kitRows.some((r) => r.state === "hand");
  const loose = hasKit ? acts.filter((a) => !a.kit && groupOf(a) === "power") : [];        // "Use a power" and the like: with a kit they go to the end of its list, so the bar is no longer than before
  const stateText = (s) => t(`ITAC.kit.state.${s}`, {}, String(s));
  /* U29: a button of the bar is a picture with the mark of its speed; its name, its price and (greyed) the reason are its tooltip and its aria-label */
  const item = (a) => { const label = actLabel(t, a), why = a.disabled ? reasonText(t, a.disabled) : null;
    return { id: a.id, label, cost: a.cost, costText: costText(t, a.cost), stress: Number(a.stress) || 0, disabled: why, armed: own.armed === a.id, urgent: !!a.situational, icon: iconOf(a), pv: pvOf(a),
      tip: tipOf(label, priceWords(t, a.cost, a.stress), why, [a.pay?.forfeitsFull ? t("ITAC.ui.pv.forfeits") : null, a.situational ? t("ITAC.ui.urgent") : null]) }; };
  /* the rows of a list behind one button (More actions, Abilities): the same facts, with the name written out */
  /* U51: the row shows its name; its tooltip says only what is not on it: the price in words (the marks of the row spelled out), the
     attribute, how it is run, and the reason of a greyed one. `notes` (all of it, for a screen reader) go to the aria-label. */
  const row = (a, notes, more = {}) => { const label = a.kit ? kitLabel(t, a) : labelOf(t, a.label), why = a.disabled ? reasonText(t, a.disabled) : null;
    const attr = a.attr ? attrText(t, a.attr) : a.attrs?.length && !a.kit ? t(a.attrOptional ? "ITAC.ui.attr.maybe" : "ITAC.ui.attr.yours") : null;
    return { id: a.id, label, cost: a.cost, stress: Number(a.stress) || 0, icon: iconOf(a), notes, disabled: why, pv: pvOf(a), tip: tipOf(null, isFree(a.cost) ? [attr, priceWords(t, a.cost, a.stress)].filter(Boolean).join(". ") : [priceWords(t, a.cost, a.stress), attr].filter(Boolean).join(", "), why, [more.explain ?? null]), ...more }; };
  const groups = GROUPS.map((g) => ({ id: g, label: t(`ITAC.ui.group.${g}`), items: [...acts.filter((a) => !a.kit && groupOf(a) === g && !inMenu(a) && !loose.includes(a)).sort((x, y) => Number(!!y.situational) - Number(!!x.situational)).map(item),
    ...(g === "act" && menu.length ? [{ id: "@more", more: true, icon: "@more", label: t("ITAC.ui.more"), tip: tipOf(t("ITAC.ui.more"), null, null, [t("ITAC.ui.more.tip")]), armed: own.mode === "menu" || menu.some((a) => a.id === own.armed) }] : []),
    ...(g === "power" && hasKit ? [{ id: "@kit", more: true, mode: "kit", icon: "@kit", label: t("ITAC.ui.kit"), tip: tipOf(t("ITAC.ui.kit"), null, null, [t("ITAC.ui.kit.tip")]), armed: own.mode === "kit" || kitActs.some((a) => a.id === own.armed) || loose.some((a) => a.id === own.armed) }] : [])] })).filter((g) => g.items.length);
  const mine = (model?.mine ?? []).filter((i) => i.actor === bar.combatant);
  const armed = own.armed ? bar.actions.find((a) => a.id === own.armed) : null;
  let panel = null;
  if (own.mode === "other") panel = { kind: "other", title: t("ITAC.action.other"), text: own.text ?? "", placeholder: t("ITAC.ui.other.placeholder"), hint: t("ITAC.ui.other.hint"),
    submit: { label: t("ITAC.ui.other.send"), disabled: (own.text ?? "").trim() ? null : t("ITAC.ui.need.text"), req: (own.text ?? "").trim() ? bar.other.req(own.text.trim()) : null } };
  else if (own.mode === "menu") { const rows = menu.map((a) => row(a, [costText(t, a.cost), a.attr ? attrText(t, a.attr) : a.attrs?.length ? t(a.attrOptional ? "ITAC.ui.attr.maybe" : "ITAC.ui.attr.yours") : null].filter(Boolean)));
    panel = { kind: "menu", list: "menu", title: t("ITAC.ui.more"), rows, groups: [{ id: "all", label: null, rows }] }; }
  else if (own.mode === "kit") { const hand = kitRows.filter((r) => r.state === "hand").map((r) => r.name);
    /* U23: the abilities are sorted by what they are (powers with their boosts and limits, talents, drawbacks, gear); each row says its
       price by the mark of its speed and how it is run (the engine, the GM confirms) by a mark with its words in the tooltip */
    const stateOf = (st) => ({ state: st, stateText: stateText(st), explain: t(`ITAC.ui.kit.how.${st}`, {}, stateText(st)) });
    /* U49: ONE ENTRY PER POWER. The uses of one item stand together under its name, said once; a row then carries only the use
       ("Create a copy"), an item with a single use is one row (its name, the use after it). The rows are ordered entry by entry (so
       the digits of the keyboard run down the list as it is drawn) and laid out in columns that never split an entry (KIT_LINES). */
    const itemName = (a) => kitRows.find((r) => r.item === a.kit.item)?.name ?? null, catOf = (a) => (["boost", "limit"].includes(a.kit.cat) ? "power" : a.kit.cat);
    const made = kitActs.map((a) => { const p = kitParts(t, a, itemName(a));
      return row(a, [costText(t, a.cost), a.stress ? t("ITAC.ui.stress", { n: a.stress }) : null, a.attr ? attrText(t, a.attr) : null, stateText(a.kit.state)].filter(Boolean), { cat: catOf(a), entry: `${catOf(a)}|${a.kit.item ?? p.name}`, of: p.name, use: p.use, ...stateOf(a.kit.state) }); })
      .concat(loose.map((a) => row(a, [costText(t, a.cost), stateText("assist")], { cat: "power", entry: `power|@${a.id}`, of: labelOf(t, a.label), use: null, ...stateOf("assist") })));
    const cats = CAT_ORDER.filter((c) => c !== "boost" && c !== "limit"), entriesOf = (c) => { const out = []; for (const r of made.filter((x) => x.cat === c)) { let e = out.find((x) => x.id === r.entry); if (!e) out.push((e = { id: r.entry, name: r.of, rows: [] })); e.rows.push(r); } return out; };
    const groups = cats.map((c) => { const entries = entriesOf(c).map((e) => ({ ...e, head: e.rows.length > 1 })); return { id: c, label: t(`ITAC.kit.cat.${c}`), entries, rows: entries.flatMap((e) => e.rows), cols: kitCols(entries) }; }).filter((g) => g.rows.length);
    const kRows = groups.flatMap((g) => g.rows);
    panel = { kind: "menu", list: "kit", title: t("ITAC.ui.kit"), rows: kRows, groups,
      foot: [kitActs.length ? null : t("ITAC.ui.kit.none"), hand.length ? t("ITAC.ui.kit.hand", { list: hand.join(", ") }) : null].filter(Boolean) }; }
  else if (own.mode === "holdOff") panel = { kind: "holdOff", title: t("ITAC.ui.holdOff"), hint: t("ITAC.ui.holdOff.hint"), targets: (bar.holdOff?.targets ?? []).map((x) => ({ slot: x.slot, card: x.card, names: x.names.join(", "), req: bar.holdOff.req(x.slot) })) };
  else if (armed && (!armed.disabled || facts.staff) && armed.flow === "move") panel = movePanel(bar, armed, own, facts, t);
  else if (armed && !armed.disabled && armed.flow === "barrier") panel = doorPanel(bar, armed, own, facts, t);
  else if (armed) panel = declarePanel(bar, armed, own, facts, t);
  const allRolls = rollsData(model?.rolls, facts, t), waitAll = waitingData(model?.waiting, facts, t);
  if (!panel && mine.length && !facts.staff) { const i = mine[mine.length - 1]; panel = minePanel(i, facts, t, allRolls.filter((r) => r.inst === i.inst), prompts.length > 0 || waitAll.length > 0); }      // U51: the line over the bar names who the table waits for: the panel does not say "waiting for the others" beside it
  /* U51 / U52: ONE HOME PER FACT on the line over the bar. A roll that the panel of the own action carries has no chip there; and what
     the table waits for FROM THIS USER is not listed again when every piece of it is already in front of them (a card above, a roll
     with its buttons): the line then names only the others. */
  const rolls = panel?.kind === "mine" ? allRolls.filter((r) => !panel.rolls.includes(r)) : allRolls;
  const waiting = waitAll.filter((w) => !w.mine || w.what.length > prompts.length + allRolls.length);
  const slots = slotsOf(bar, t), unused = slots.filter((p) => p.state === "open").map((p) => p.label);
  const end = bar.endTurn ? { label: own.endArmed ? t("ITAC.ui.end.sure") : t("ITAC.ui.end"), key: t("ITAC.ui.key.space"), tip: bar.endTurn.disabled ? reasonText(t, bar.endTurn.disabled) : `${unused.length ? t("ITAC.ui.end.unused", { list: unused.join(", ") }) : t("ITAC.ui.end.tip")} [${t("ITAC.ui.key.space")}]`,
    disabled: bar.endTurn.disabled ? reasonText(t, bar.endTurn.disabled) : null, req: bar.endTurn.req, confirm: unused.length > 0 && !bar.endTurn.noConfirm, armed: !!own.endArmed && !bar.endTurn.noConfirm }
    : { label: t("ITAC.ui.end"), tip: reasonText(t, "notYourTurn"), disabled: reasonText(t, "notYourTurn"), req: null, confirm: false, armed: false };
  const canRest = !bar.onTurn || !!own.quiet;        // own.quiet: the GM's dock while a connected player's hero has the turn
  const chase = facts.view?.chase ? t("ITAC.ui.chase.line", { n: facts.view.chase.distance }) : null;
  /* U52: whose turn it is stands on the initiative bar, so the line does not say it again. It keeps what that bar cannot say: the
     distance of a chase (P7: a chase has no turns), and during the turn of somebody this user is not shown (a hidden NPC acts; the
     bar shows no card for it) that the turn is not theirs (U15) */
  const turn = chase ?? (!model?.turn?.combatant && model?.turn?.phase === "turns" && !facts.staff ? t("ITAC.ui.turn.notYours") : "");
  /* U8: where the driven character stands, in the words the cards use ("Zone 5"), with the legend of the map's badges behind it */
  const spot = facts.where?.(bar.combatant) ?? null, zoneNow = spot ? zoneText(facts, t, spot) : "";
  return Keys.number({
    show: true, canRest, rest: canRest && !panel && !own.peek, onTurn: !!bar.onTurn, round: model?.turn?.round ?? null,
    chars: bars.length > 1 ? bars.map((b) => ({ id: b.combatant, name: b.name, img: facts.c?.(b.combatant)?.img ?? null, onTurn: !!b.onTurn, sel: b.combatant === bar.combatant, asked: asked.has(b.combatant) })) : [],
    who: { id: bar.combatant, name: bar.name ?? c?.name ?? "", img: c?.img ?? null, onTurn: !!bar.onTurn, free: !!bar.free, freeLabel: t("ITAC.ui.freeMode"),
      zone: zoneNow ? { label: zoneNow, say: facts.staff ? t("ITAC.ui.here.of", { name: bar.name ?? c?.name ?? "", zone: zoneNow }) : t("ITAC.ui.here", { zone: zoneNow }), tip: t("ITAC.ui.legend") } : null },      // U51: the chip says the zone; its tooltip only what the chip does not (the legend of the map's badges); `say` is for a screen reader
    slots, vitals: vitalsOf(facts, bar.combatant, t), extras: extrasOf(bar, t, facts), groups,
    out: bar.out ? { reason: bar.out.reason, text: t(bar.out.label) } : null,      // U9: why nothing (or only getting up) is offered: said where the actions were
    camera: cameraOf(facts, t),      // W1 (U42): how much the map's camera follows the fight, this user's own switch
    hotbar: { open: !!own.hotbar, label: t(own.hotbar ? "ITAC.ui.hotbar.hide" : "ITAC.ui.hotbar.show"), tip: `${t(own.hotbar ? "ITAC.ui.hotbar.hide" : "ITAC.ui.hotbar.show")}. ${t(own.hotbar ? "ITAC.ui.keys.macros" : "ITAC.ui.keys")}` },      // U28: Foundry's macro bar is folded away while the dock is up; this brings it back
    other: { label: t("ITAC.action.other"), armed: own.mode === "other", tip: tipOf(t("ITAC.action.other"), null, null, [t("ITAC.ui.other.hint")]) },
    holdOff: { label: t("ITAC.ui.holdOff"), armed: own.mode === "holdOff", disabled: bar.holdOff?.disabled ? reasonText(t, bar.holdOff.disabled) : null,
      tip: tipOf(t("ITAC.ui.holdOff"), null, bar.holdOff?.disabled ? reasonText(t, bar.holdOff.disabled) : null, [t("ITAC.ui.holdOff.hint")]) },
    end, panel, prompts, waiting, turn,
    rolls, news: newsData(facts.view, own, facts, t),      // U1 / U2 / U10 / U3
    keys: { on: !own.hotbar, enter: t("ITAC.ui.key.enter"), chosen: own.kopt ?? null },      // U41 (keys-pure.mjs): what a digit reaches carries `key`
  }, own);
}

/* ------------------------------------------------------------------ the GM desk */
const stepText = (t, s) => t(`ITAC.ui.step.${s}`, {}, cap(s));
/** The override controls of one instance in progress (spec 14.1): each control carries the request it sends.
    -> [{ id, type: "number" | "choice" | "button" | "select", group, label, value?, min?, max?, choices?, req }] */
export function overrideControls(i, facts, t) {
  const ovr = i.commands?.find((c) => c.id === "override");
  if (!ovr) return [];
  const out = [], R = (op, payload = {}) => ovr.req(op, payload);
  const keys = new Map((i.rolls ?? []).map((r) => [r.key, r]));
  const main = i.flow === "attack" ? "attack" : i.steps?.includes("roll") ? "roll" : null;
  if (main && !keys.has(main)) keys.set(main, { key: main, dice: null, sixes: null, waiting: true });
  for (const r of keys.values()) {
    const label = rollLabel(t, r.key, facts);
    if (r.sixes == null) out.push({ id: `pool:${r.key}`, type: "number", group: "dice", label: t("ITAC.ui.ovr.pool", { roll: label }), value: r.dice ?? 1, min: 1, max: 40, req: (v) => R("setPool", { roll: r.key, total: v }) });
    out.push({ id: `sixes:${r.key}`, type: "number", group: "dice", label: t("ITAC.ui.ovr.sixes", { roll: label }), value: r.sixes ?? 0, min: 0, max: 40, req: (v) => R("setSixes", { roll: r.key, sixes: v }) });
  }
  for (const x of i.targets ?? []) {
    const o = (i.outcomes ?? []).find((q) => q.target === x.id);
    if (i.steps?.includes("outcome")) out.push({ id: `hit:${x.id}`, type: "choice", group: "result", label: t("ITAC.ui.ovr.outcome", { name: x.name }), value: o ? (o.hit ? "hit" : "miss") : null,
      choices: [{ id: "hit", label: t("ITAC.ui.ovr.hit"), req: R("setOutcome", { target: x.id, hit: true }) }, { id: "miss", label: t("ITAC.ui.ovr.miss"), req: R("setOutcome", { target: x.id, hit: false }) }] });
    if (i.steps?.includes("damage")) out.push({ id: `dmg:${x.id}`, type: "number", group: "result", label: t("ITAC.ui.ovr.damage", { name: x.name }), value: 0, min: 0, max: 99, req: (v) => R("setDamage", { target: x.id, amount: v }) });
  }
  const at = (i.steps ?? []).indexOf(i.step);
  if (at >= 0 && at < i.steps.length - 1) out.push({ id: "skip", type: "button", group: "step", icon: "skip", label: t("ITAC.ui.ovr.skip"), req: R("skipStep") });
  if (at > 0) out.push({ id: "goto", type: "select", group: "step", label: t("ITAC.ui.ovr.goto"), choices: i.steps.slice(0, at).map((s) => ({ id: s, label: stepText(t, s), req: R("goToStep", { step: s }) })) });
  out.push({ id: "abortRefund", type: "button", group: "end", icon: "refund", label: t("ITAC.ui.ovr.abortRefund"), req: R("abort", { refund: true }) },
    { id: "abortSpent", type: "button", group: "end", icon: "spent", danger: true, label: t("ITAC.ui.ovr.abortSpent"), req: R("abort", { refund: false }) },
    { id: "manual", type: "button", group: "end", icon: "hand", label: t("ITAC.cmd.resolve"), req: R("manual", { result: {} }) });
  return out;
}
/* the chance that the attack about to be rolled lands: against the defence its target has declared (the pool the engine noted with the
   answer), else against nobody. Several targets with a defence among them have no one number: none is shown (D28: the line showed the
   undefended chance after a block or a dodge had been chosen on a card that named a lower one). */
function attChance(i, pool) {
  const defs = (i.defs ?? []).filter((x) => (i.targets ?? []).some((q) => q.id === x.target));
  if (!defs.length) return pct(dice.pSuccess(Math.max(1, pool)));
  if ((i.targets ?? []).length !== 1 || !Number.isFinite(defs[0].dice)) return null;
  return pct(dice.pHit(Math.max(1, pool), Math.max(1, defs[0].dice)));
}
function instData(i, model, own, facts, t) {
  const open = own.override === i.inst;
  const amend = i.commands?.find((c) => c.id === "amend"), veto = i.commands?.find((c) => c.id === "veto"), ovr = i.commands?.find((c) => c.id === "override");
  const att = (i.rolls ?? []).find((r) => r.key === "attack" || r.key === "roll");
  const rolls = (i.rolls ?? []).map((r) => ({ key: r.key, label: rollLabel(t, r.key, facts), dice: r.dice ?? null, sixes: r.sixes, waiting: !!r.waiting,
    text: r.waiting ? t("ITAC.ui.roll.waiting", { dice: r.dice ?? "?", users: usersText(r, facts, t) }) : t(r.state === "push" && !rollMine(r, facts) ? "ITAC.ui.roll.pushable" : "ITAC.ui.roll.done", { dice: r.dice ?? "?", sixes: r.sixes ?? 0, users: usersText(r, facts, t) }),
    state: r.state ?? (r.waiting ? "owed" : "done"), buttons: r.state ? rollButtons(r, facts, t) : [],
    chance: r.waiting && Number.isFinite(r.dice) && r === att ? attChance(i, r.dice) : null }));
  const others = rosterOf({ ...facts, view: facts.view }, i.actor).filter((r) => !(i.targets ?? []).some((x) => x.id === r.id));
  const from = i.targets?.[0]?.id;
  return {
    id: i.inst, actor: i.actorName ?? t("ITAC.ui.who.gm"), action: instTitle(t, i), targets: (i.targets ?? []).map((x) => x.name), text: i.text ?? null,
    step: stepText(t, i.step), cause: i.cause && i.cause !== "turn" ? t(`ITAC.ui.cause.${i.cause}`, {}, String(i.cause)) : null, locked: !!i.locked, child: !!i.parent,
    rolls, outcomes: (i.outcomes ?? []).map((o) => ({ name: o.name, text: o.hit ? t("ITAC.ui.ovr.hit") : t("ITAC.ui.ovr.miss"), hit: o.hit })),
    commands: [veto ? { id: "veto", label: own.sure === `${i.inst}:veto` ? t("ITAC.ui.sure.veto") : labelOf(t, veto.label), req: veto.req, danger: true, confirm: true, armed: own.sure === `${i.inst}:veto` } : null, ovr ? { id: "override", label: labelOf(t, ovr.label), toggle: true, on: open } : null].filter(Boolean),
    /* U4: the three ways to end the action by hand are small buttons that ask a second click (the first one spells the button out) */
    override: open ? overrideControls(i, facts, t).map((c) => (c.type === "button" ? { ...c, confirm: true, armed: own.sure === `${i.inst}:${c.id}` } : c)) : null,
    retarget: open && from && others.length ? { label: t("ITAC.ui.ovr.retarget"), choices: others.map((r) => ({ id: r.id, label: r.name, req: amend ? amend.req({ action: i.action, targets: [r.id] }) : ovr.req("retarget", { from, to: r.id }) })) } : null,
  };
}
function manualData(m, own, facts, t) {
  const f = own.manual?.[m.inst] ?? {}, resolve = m.commands.find((c) => c.id === "resolve"), abort = m.commands.find((c) => c.id === "abort");
  const cost = ["none", "quick", "full"].includes(f.cost) ? f.cost : "none";
  const damage = (m.targets ?? []).map((x) => ({ target: x.id, name: x.name, amount: Math.max(0, Math.trunc(Number(f.damage?.[x.id]) || 0)) }));
  const result = { cost, note: String(f.note ?? "").slice(0, 300), damage: damage.filter((d) => d.amount > 0).map((d) => ({ target: d.target, amount: d.amount })) };
  return { id: m.inst, actor: m.actorName ?? t("ITAC.ui.who.gm"), title: instTitle(t, m), text: m.text ?? null, cause: m.cause && m.cause !== "turn" ? t(`ITAC.ui.cause.${m.cause}`, {}, String(m.cause)) : null,
    costs: ["none", "quick", "full"].map((id) => ({ id, label: costText(t, id), on: id === cost })), note: { value: f.note ?? "", placeholder: t("ITAC.ui.manual.note") }, damage,
    resolve: { label: t("ITAC.ui.manual.resolve"), req: resolve.req(result) }, abort: { label: labelOf(t, abort.label), req: abort.req } };
}
/* U60: ONE COMBATANT AT A GLANCE, for the GM (the head of the desk's character tab; the token clicked on the map is the one shown):
   where it stands, Health and Resolve, the slots of its turn, its states, and the last things done by it or to it (the journal's own
   lines). Staff only: the desk is never built for a player. Nothing here is new knowledge: the sheet, the map and the journal hold it.
   -> { id, name, img, zone, group, hidden, vitals, slots, states: [{ id, icon, label, tip }], last: [{ id, round, text, undone }], lastLabel, lastNone } */
const STATE_ICON = { broken: "fa-heart-crack", unconscious: "fa-bed", dying: "fa-skull-crossbones", dead: "fa-skull", stressedOut: "fa-battery-empty", grappled: "fa-hands-holding", grappling: "fa-hand-back-fist", snared: "fa-link", immobilised: "fa-lock", trapped: "fa-dungeon",
  unaware: "fa-eye-slash", stunned: "fa-face-dizzy", burning: "fa-fire", airborne: "fa-dove", carrying: "fa-people-carry-box", carried: "fa-people-carry-box", invisible: "fa-ghost", huge: "fa-up-right-and-down-left-from-center", suffocating: "fa-lungs", inVehicle: "fa-car-side", intangible: "fa-ghost" };
export const UNIT_LAST = 3;
export function unitData(cid, model, facts, t) {
  const c = facts.c?.(cid);
  if (!c) return null;
  const st = facts.view?.statuses?.[cid] ?? [], other = (id) => (id && facts.c?.(id) ? facts.c(id).name : t("ITAC.Someone")), spot = facts.where?.(cid) ?? null, v = facts.vitals?.(cid) ?? null, group = c.kind === "minions";
  const states = st.map((s) => ({ id: s.id, icon: STATE_ICON[s.id] ?? "fa-circle-dot", label: t(`ITAC.status.${s.id}`, {}, cap(s.id)),
    tip: s.id === "grappled" && s.data?.by ? t("ITAC.ui.status.heldBy", { name: other(s.data.by) }) : s.id === "grappling" && s.data?.held ? t("ITAC.ui.status.holds", { name: other(s.data.held) }) : s.id === "carried" && s.data?.by ? t("ITAC.ui.status.carriedBy", { name: other(s.data.by) }) : null }));
  const out = outOf(facts.view, cid, facts.sheet?.(cid) ?? null);
  if (out && !states.some((s) => s.id === out.reason)) states.unshift({ id: out.reason, icon: STATE_ICON[out.reason], label: t(`ITAC.status.${out.reason}`, {}, cap(out.reason)), tip: null });      // Health 0 with no mark yet (U45)
  const budget = facts.budget?.(cid) ?? null;
  const last = (model?.journal ?? []).filter((j) => (j.who ?? []).includes(cid) && j.state !== "open").slice(0, UNIT_LAST).map((j) => ({ id: j.id, round: j.round ?? null, roundTip: j.round != null ? t("ITAC.ui.round", { n: j.round }) : null, text: marks(t, j.text || j.pub, facts) || t("ITAC.ui.journal.noText"), undone: j.state === "undone" }));
  return { id: cid, name: c.name ?? "", img: c.img ?? null, zone: spot ? zoneText(facts, t, spot) : null, hidden: facts.hidden?.(cid) ? t("ITAC.map.mark.hidden") : null,
    /* a minion group: its Health is how many stand [B2827] (the system keeps a fixed top of ten for it, which is no fact of the group) */
    group: group && v && Number.isFinite(v.health) ? { n: Math.max(0, v.health), label: t("ITAC.ui.unit.members", { n: Math.max(0, v.health) }) } : null,
    vitals: vitalsOf(facts, cid, t).filter((x) => !(group && x.id === "health")), slots: budget ? slotsOf({ budget }, t).map(({ req, ...s }) => s) : [], states,
    last, lastLabel: t("ITAC.ui.unit.last"), lastNone: t("ITAC.ui.unit.last.none"), statesNone: t("ITAC.ui.unit.fine") };
}
/** Everything the desk draws. -> { show, count, tab, waiting, turn, stack, manual, cards, journal, npcs, mode } */
const kitNames = (type) => allRows().filter((r) => r.cat === (CAT_OF[type] ?? type)).map((r) => ({ id: r.name, label: r.of ? `${r.name} (${r.of})` : r.name })).sort((x, y) => x.label.localeCompare(y.label));
export function deskData(model, own, facts, t) {
  if (!model) return { show: false };
  const cards = model.cards.map((c) => askData(c, { t, facts, own, desk: true, info: [...model.info, ...model.manual], round: model.turn?.round }));
  const rounds = [];
  for (const j of model.journal) {
    let r = rounds[rounds.length - 1];
    if (!r || r.round !== j.round) rounds.push((r = { round: j.round, label: t("ITAC.ui.round", { n: j.round ?? "?" }), rows: [] }));
    r.rows.push({ id: j.id, text: marks(t, j.text || j.pub, facts) || t("ITAC.ui.journal.noText"), state: j.state,
      undo: j.undo ? { label: t("ITAC.ui.undo"), also: j.undo.alsoUndoes ? t("ITAC.ui.undo.also", { n: j.undo.alsoUndoes }) : null, req: j.undo.req, armed: own.undo === j.id,
        force: j.undo.alsoUndoes ? { label: t("ITAC.ui.undo.only"), req: j.undo.force.req() } : null,
        drift: own.drift === j.id ? j.undo.force.modes.map((m) => ({ id: m, label: t(`ITAC.ui.drift.${m}`), req: j.undo.force.req(m) })) : null } : null });
  }
  const POL = { block: ["ask", "always", "never"], dodge: ["ask", "always", "never"], onBroken: ["ask", "ko", "kill", "crit"], push: ["rules", "ask", "never"], major: ["no", "yes"] };      // push "rules": major NPCs and minion groups push, others do not; major: injuries rolled like a hero's
  /* an NPC out of Resolve often gives up or runs: a hint for the GM, nothing happens by itself */
  const spent = (id) => (facts.staff && facts.resolve?.(id) === 0 ? t("ITAC.ui.npc.spent") : null);
  const npcs = (model.npcs ?? []).map((n) => ({ id: n.id, name: n.name, note: spent(n.id),
    policy: [...Object.entries(POL).map(([k, vals]) => ({ id: k, label: t(`ITAC.ui.policy.${k}`), choices: vals.map((v) => ({ id: v, label: t(`ITAC.ui.policy.${v}`), on: n.policy[k] === v, req: n.policyReq({ [k]: v }) })) })),
      /* U61: a minion group can be settled quickly: one card per hit (how many fall, knocked out or killed), no defence, no pushed roll */
      ...(n.group ? [{ id: "quick", label: t("ITAC.ui.policy.quick"), tip: t("ITAC.ui.policy.quick.tip"), choices: [false, true].map((v) => ({ id: v ? "yes" : "no", label: t(`ITAC.ui.policy.${v ? "yes" : "no"}`), on: (n.policy.quick === true) === v, req: n.policyReq({ quick: v }) })) }] : [])],
    reveal: ["stats", "powers", "health"].map((k) => ({ id: k, label: t(`ITAC.ui.reveal.${k}`), on: !!n.revealed[k], req: n.revealReq({ [k]: !n.revealed[k] }) })) }));
  const waiting = waitingData(model.waiting, facts, t);
  const count = cards.length + model.manual.length;
  /* [A36]: until a charge is the engine's, the GM orders a forced move (who, away from whom, how far, how hard) or a fall by hand */
  const everyone = Object.keys(facts.view?.ledger ?? {}).filter((id) => facts.c?.(id)).map((id) => ({ id, label: facts.c(id).name }));
  const fo = own.force ?? {}, fWho = everyone.some((x) => x.id === fo.who) ? fo.who : null, ways = [{ id: "@up", label: t("ITAC.ui.force.up"), dir: "up" }, { id: "@down", label: t("ITAC.ui.force.down"), dir: "down" }], fWay = ways.find((x) => x.id === fo.from) ?? null, fFrom = fWay ? fWay.id : fo.from !== fWho && everyone.some((x) => x.id === fo.from) ? fo.from : null;
  const fDist = Math.max(1, Math.min(12, Math.trunc(Number(fo.distance) || 1))), fDmg = Math.max(0, Math.min(99, Math.trunc(Number(fo.damage) || 0)));
  const force = { title: t("ITAC.ui.force"), who: { label: t("ITAC.ui.force.who"), value: fWho, choices: everyone }, from: { label: t("ITAC.ui.force.from"), value: fFrom, choices: [...everyone.filter((x) => x.id !== fWho), ...ways.map(({ id, label }) => ({ id, label }))] },
    distance: { label: t("ITAC.ui.force.distance"), value: fDist, min: 1, max: 12 }, damage: { label: t("ITAC.ui.force.damage"), value: fDmg, min: 0, max: 99 },
    push: { label: t("ITAC.ui.force.push"), disabled: !fWho ? t("ITAC.ui.force.needWho") : !fFrom ? t("ITAC.ui.force.needFrom") : null, req: fWho && fFrom ? (fWay ? { op: "forcedMove", combatant: fWho, direction: fWay.dir, distance: fDist, damage: fDmg, kind: "knockback" } : { op: "forcedMove", combatant: fWho, awayFrom: fFrom, by: fFrom, distance: fDist, damage: fDmg, kind: "knockback" }) : null },
    fall: { label: t("ITAC.ui.force.fall"), disabled: fWho ? null : t("ITAC.ui.force.needWho"), req: fWho ? { op: "fall", combatant: fWho } : null } };
  /* P5: a hazard the GM lets loose by hand (an explosion, an area attack, fire, vacuum, a disease), on a zone with people in it or on one character */
  const HZ = { blast: [["rating", 1, 20, 4]], area: [["pool", 1, 40, 8], ["damage", 0, 40, 5]], fire: [["intensity", 1, 12, 6]], vacuum: [], disease: [["virulence", 0, 12, 0]] };
  const ho = own.hazard ?? {}, hKind = HZ[ho.kind] ? ho.kind : "blast", zonal = ["blast", "area", "fire"].includes(hKind), spots = zonal ? facts.places?.() ?? [] : [];
  const hWhere = [...spots.map((p) => ({ id: `z:${p.zone}`, label: t("ITAC.ui.hz.zoneOf", { zone: zoneText(facts, t, p.zone), names: p.ids.map((id) => nameOf(facts, id, t)).join(", ") }) })), ...everyone.map((x) => ({ id: `c:${x.id}`, label: x.label }))];
  const hAt = hWhere.some((x) => x.id === ho.where) ? ho.where : null, hNums = HZ[hKind].map(([id, min, max, dflt]) => ({ id, label: t(`ITAC.ui.hz.${id}`), min, max, value: Math.max(min, Math.min(max, Math.trunc(Number(ho[id] ?? dflt)) || 0)) }));
  const hN = Object.fromEntries(hNums.map((x) => [x.id, x.value])), hZone = hAt?.startsWith("z:") ? hAt.slice(2) : null, hWho = hAt?.startsWith("c:") ? hAt.slice(2) : null;
  const hTargets = hZone ? spots.find((p) => p.zone === hZone)?.ids ?? [] : hWho ? [hWho] : [], hSub = hZone ? { zone: hZone } : { combatant: hWho };
  const hReq = !hAt ? null : hKind === "fire" ? model.fireReq(hN.intensity, hTargets, !!hZone) : model.hazardReq({ type: hKind, ...hN, ...(hZone ? { zone: hZone } : {}), targets: hTargets }, hSub);
  const hazard = { title: t("ITAC.ui.hz"), kind: { label: t("ITAC.ui.hz.kind"), value: hKind, choices: Object.keys(HZ).map((id) => ({ id, label: t(`ITAC.ui.hz.kind.${id}`) })) }, hint: t(`ITAC.ui.hz.hint.${hKind}`),
    where: { label: t(zonal ? "ITAC.ui.hz.where" : "ITAC.ui.force.who"), value: hAt, choices: hWhere }, nums: hNums, run: { label: t("ITAC.ui.hz.run"), disabled: hAt ? null : t(zonal ? "ITAC.ui.hz.needWhere" : "ITAC.ui.force.needWho"), req: hReq } };
  /* P5: the karma notes of the fight (spec 9.11): what the engine wrote down by itself and what the GM adds */
  const KK = ["wreckedZone", "savedBystanders", "failedBystanders", "killed"], ko = own.karma ?? {}, kKind = KK.includes(ko.kind) ? ko.kind : "savedBystanders", kWho = everyone.some((x) => x.id === ko.who) ? ko.who : null, kNote = String(ko.note ?? "").slice(0, 200);
  const karma = { title: t("ITAC.ui.karma"), empty: t("ITAC.ui.karma.empty"), rows: (model.karma ?? []).map((k) => ({ id: k.id, kind: t(`ITAC.ui.karma.${k.kind}`, {}, String(k.kind)), who: k.whoName ?? "", round: k.round != null ? t("ITAC.ui.round", { n: k.round }) : "", note: k.note ?? "" })),
    kind: { label: t("ITAC.ui.karma.kind"), value: kKind, choices: KK.map((id) => ({ id, label: t(`ITAC.ui.karma.${id}`) })) }, who: { label: t("ITAC.ui.force.who"), value: kWho, choices: everyone },
    note: { value: ko.note ?? "", placeholder: t("ITAC.ui.karma.note") }, add: { label: t("ITAC.ui.karma.add"), disabled: kWho ? null : t("ITAC.ui.force.needWho"), req: kWho ? model.karmaReq({ who: kWho, kind: kKind, ...(kNote.trim() ? { note: kNote.trim() } : {}) }) : null } };
  /* P6: every item of a sheet with its state, and the GM's settings for it (out of the fight, which book entry, what it is about, who summoned whom) */
  const kq = own.kit ?? {}, kitWho = everyone.some((x) => x.id === kq.who) ? kq.who : model.turn?.combatant && everyone.some((x) => x.id === model.turn.combatant) ? model.turn.combatant : everyone[0]?.id ?? null;
  const kk = own.tab === "kit" && kitWho ? facts.kit?.(kitWho) ?? null : null, kRows = kk?.rows ?? [], cnt = (s) => kRows.filter((r) => r.state === s).length;
  const kit = own.tab !== "kit" ? null : { unit: kitWho ? unitData(kitWho, model, facts, t) : null, who: { label: t("ITAC.ui.kit.who"), value: kitWho, choices: everyone }, empty: kRows.length ? null : t("ITAC.ui.kit.empty"),
    counts: kRows.length ? t("ITAC.ui.kit.counts", { auto: cnt("auto"), assist: cnt("assist"), hand: cnt("hand") }) : null,
    summon: kitWho ? { label: t("ITAC.ui.kit.summonOf"), value: facts.c?.(kitWho)?.summonOf ?? null, none: t("ITAC.ui.kit.nobody"), choices: everyone.filter((x) => x.id !== kitWho), req: (owner) => model.summonReq(kitWho, owner) } : null,
    groups: CAT_ORDER.filter((c) => c !== "boost" && c !== "limit").map((c) => ({ id: c, label: t(`ITAC.kit.cat.${c}`), rows: kRows.filter((r) => (["boost", "limit"].includes(r.cat) ? "power" : r.cat) === c)
      .sort((x, y) => String(x.of ?? x.name).localeCompare(String(y.of ?? y.name)) || Number(!!x.of) - Number(!!y.of)).map((r) => ({ id: r.item, name: r.name, sub: r.of ? t("ITAC.ui.kit.of", { name: r.of }) : r.unknown ? t("ITAC.ui.kit.unknown") : null, cat: ["boost", "limit"].includes(r.cat) ? t(`ITAC.kit.cat.${r.cat}`) : null,
        state: r.state, stateText: t(`ITAC.kit.state.${r.state}`), note: r.state === "hand" && r.why ? t(`ITAC.kit.why.${r.why}`, {}, "") : r.barred ? t("ITAC.kit.note.barred") : t(`ITAC.kit.note.${r.note}`, {}, ""), open: kq.open === r.item || (kq.open === undefined && !!r.needs),
        off: { label: t("ITAC.ui.kit.off"), choices: [{ id: "has", label: t("ITAC.ui.kit.has"), on: r.state !== "off", req: model.kitReq(kitWho, r.item, "off", false) }, { id: "lost", label: t("ITAC.ui.kit.lost"), on: r.state === "off", req: model.kitReq(kitWho, r.item, "off", true) }] },
        map: r.unknown ? { label: t("ITAC.ui.kit.map"), choices: kitNames(r.type), req: (name) => model.kitReq(kitWho, r.item, "kit", name || null) } : null,
        alt: r.alt ? { label: t(`ITAC.kit.alt.${r.alt}`), choices: [{ id: "no", label: t("ITAC.ui.no"), on: !r.altOn, req: model.kitReq(kitWho, r.item, "alt", false) }, { id: "yes", label: t("ITAC.ui.yes"), on: !!r.altOn, req: model.kitReq(kitWho, r.item, "alt", true) }] } : null,
        types: r.note === "flag" ? { label: t("ITAC.ui.kit.types"), value: (kk.pass?.[r.key === "vulnerable" ? "vulnerable" : "immune"] ?? []).join(", "), req: (text) => model.kitReq(kitWho, r.item, "types", String(text ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) } : null })) })).filter((g) => g.rows.length) };
  return {
    show: true, count, tab: ["now", "journal", "scene", "table", "kit"].includes(own.tab) ? own.tab : "now", collapsed: !!own.collapsed, kit,
    tabs: [{ id: "now", label: t("ITAC.ui.tab.now"), n: count }, { id: "journal", label: t("ITAC.ui.tab.journal"), n: 0 }, { id: "scene", label: t("ITAC.ui.tab.scene"), n: 0 }, { id: "table", label: t("ITAC.ui.tab.table"), n: 0 }, { id: "kit", label: t("ITAC.ui.tab.kit"), n: 0 }],
    scene: own.tab === "scene" ? sceneData(facts.view, own.scene ?? {}, facts, t) : null,      // P7: the chase, the vehicles, the challenges (scene-pure.mjs)
    title: t("ITAC.ui.desk"), waiting, waitingLabel: t("ITAC.ui.waitingFor"), nobody: model.turn?.combatant ? t("ITAC.ui.wait.nobody", { name: model.turn.name ?? "" }) : t("ITAC.ui.wait.idle"),
    turn: "",      // U52: the round and whose turn it is stand on the initiative bar (and the name, numbered, on the bar of the dock)
    turnNote: model.turn?.combatant && facts.c?.(model.turn.combatant)?.npc ? spent(model.turn.combatant) : null,
    stack: model.info.map((i) => instData(i, model, own, facts, t)).reverse(), manual: model.manual.map((m) => manualData(m, own, facts, t)),
    cards, force, hazard, karma, empty: t("ITAC.ui.desk.empty"), journal: rounds, journalEmpty: t("ITAC.ui.journal.empty"), npcs, npcsEmpty: t("ITAC.ui.table.empty"), npcsTitle: t("ITAC.ui.table.npcs"),
    mode: { label: t("ITAC.ui.mode"), choices: ["tactical", "free"].map((m) => ({ id: m, label: t(`ITAC.ui.mode.${m}`), on: model.mode === m, req: model.modeReq(m) })) },
    labels: { override: t("ITAC.cmd.override"), set: t("ITAC.ui.set"), step: t("ITAC.ui.stepLabel"), queue: t("ITAC.ui.queue"), action: t("ITAC.ui.inProgress"), manual: t("ITAC.ui.manual"), collapse: t("ITAC.ui.desk.collapse"), expand: t("ITAC.ui.desk.expand", { n: count }),
      reveal: t("ITAC.ui.reveal"), since: t("ITAC.ui.wait.since"), groups: { dice: t("ITAC.ui.ovr.g.dice"), result: t("ITAC.ui.ovr.g.result"), step: t("ITAC.ui.ovr.g.step"), end: t("ITAC.ui.ovr.g.end") }, cost: t("ITAC.ui.manual.cost"), damage: t("ITAC.ui.manual.damage") },
  };
}
