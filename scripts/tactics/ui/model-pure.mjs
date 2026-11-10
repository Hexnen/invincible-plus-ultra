/* Tactical combat, the surfaces: MODEL -> RENDER DATA. NO Foundry or browser globals (node-tested in check-ui.mjs).
   The two surfaces (dock.mjs: the player's action dock, also the GM driving an NPC; desk.mjs: the GM desk) draw ONLY what these functions
   return, and send ONLY the requests found in it (api.tactics.request). Nothing here decides a rule: the models of desk-pure.mjs carry the
   options, their reasons and the ready requests; this file gives them words, an order and a layout-free shape.
     dockData(model, own, facts, t) -> what the dock shows      model = playerModel(view, viewer, ctx)  |  { bars: [barModel], ... } for staff
     deskData(model, own, facts, t) -> what the desk shows      model = deskModel(state, log, ctx)
     askData(p, o)                 -> one question (a prompt of the player, a card of the desk): the same shape for both surfaces
   facts = { view, c(id) -> { name, npc, img? } | null, attrs(id) -> { fighting, ... } | null, userName(userId), me: userId, staff: bool }
   own    = the surface's own state (which action is armed, the picked targets, drafts of text, open panels); never part of the fight.
   HIDDEN INFORMATION (spec 10): a player's data is built from the player's view only. `attrsFor` refuses an NPC's numbers unless the view
   says its stats are revealed, whatever `facts.attrs` would answer; the roster of possible targets is the view's ledger (a concealed
   combatant is not in it). The chance shown to a player is a BAND from the player's own pool [D]; the desk shows the GM percentages. */
import { dice } from "../../rules/index.mjs";

const isKey = (s) => typeof s === "string" && s.startsWith("ITAC.");
const has = (t, key) => t(key, {}, null) !== null;
const cap = (s) => { const x = String(s ?? ""); return x.charAt(0).toUpperCase() + x.slice(1); };
/** a label of the models: an ITAC key, or text as it is */
export const labelOf = (t, label, fallback = "") => (isKey(label) ? t(label, {}, label.split(".").pop()) : String(label ?? fallback));
export const reasonText = (t, reason, params = {}) => (reason ? t(`ITAC.reason.${reason}`, params, String(reason)) : null);
export const costText = (t, cost) => (cost ? t(`ITAC.ui.cost.${cost}`, {}, String(cost)) : null);
export const attrText = (t, attr) => (attr ? t(`ITAC.ui.attr.${attr}`, {}, cap(attr)) : "");
const nameOf = (facts, id, t) => (id ? facts.c?.(id)?.name ?? t("ITAC.Someone") : "");
const pct = (p) => `${Math.round(p * 100)}%`;

/* ------------------------------------------------------------------ chance (spec 10: bands for players, [D] thresholds) */
export const BANDS = Object.freeze([{ id: "unlikely", below: 0.35 }, { id: "even", below: 0.6 }, { id: "likely", below: 0.8 }, { id: "nearCertain", below: 2 }]);
export const bandOf = (p) => BANDS.findIndex((b) => p < b.below);
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
/** the dice an action would roll, as far as this client knows: the attribute, plus the bonus dice the player chose to spend */
export function poolPreview(action, bar, facts, tokens = []) {
  const base = Number(attrsFor(facts, bar.combatant)?.[action.attr]);
  if (!action.attr || !Number.isFinite(base)) return null;
  const parts = [{ id: action.attr, dice: base }];
  for (const tk of bar.tokens ?? []) if (tokens.includes(tk.id)) parts.push({ id: "token", token: tk.id, source: tk.source?.name ?? "", dice: tk.dice });
  return { total: Math.max(1, parts.reduce((n, p) => n + p.dice, 0)), parts };
}
const DEF_ATTR = { block: "fighting", dodge: "agility" };

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
  const first = action.targetWho === "ally" ? "own" : "other";
  const list = rosterOf(facts, cid);
  return [...list.filter((r) => r.side === first), ...list.filter((r) => r.side !== first)].map((r) => ({ ...r, likely: r.side === first }));
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
  return t(`ITAC.${p.to === "desk" ? "card" : "prompt"}.${k}`, {}, null) ?? t(`ITAC.card.${k}`, {}, null) ?? t(`ITAC.Prompt.${k}.Title`, {}, cap(k));
}
function optLabel(p, o, t, facts, desk = false, oneTarget = false) {
  const kind = p.of ?? p.kind;
  if (desk && kind === "reaction" && o.id === "pass") return t("ITAC.ui.noReaction");
  if (o.name) return String(o.name);
  if (isKey(o.label)) {
    const base = labelOf(t, o.label);
    return o.data?.stunt && o.data?.target && !oneTarget ? `${base}: ${nameOf(facts, o.data.target, t)}` : base;
  }
  if (kind === "reflexes") return t("ITAC.Prompt.reflexes.card", { card: o.id });
  const own = t(`ITAC.Prompt.${kind}.${o.id}`, { card: p.data?.card ?? o.data?.card ?? "" }, null) ?? t(`ITAC.ui.opt.${o.id}`, {}, null);
  return own ?? String(o.label ?? o.id);
}
/* the sentence(s) under the title: what is being asked, in words */
function linesOf(p, t, facts, x) {
  const d = p.data ?? {}, kind = p.of ?? p.kind, n = (id) => nameOf(facts, id, t), about = p.aboutName ?? n(p.about);
  const out = [];
  switch (kind) {
    case "reaction": if (d.attacker) out.push(t("ITAC.ui.line.attack", { attacker: n(d.attacker), target: about, action: t(`ITAC.action.${x.inst?.action ?? d.attack}`, {}, t("ITAC.ui.anAttack")) })); else out.push(t("ITAC.ui.line.window", { name: about })); break;
    case "counter": out.push(t("ITAC.ui.line.counter", { name: about })); break;
    case "dodgeMove": out.push(t("ITAC.ui.line.dodgeMove", { name: about })); break;
    case "stunts": out.push(t("ITAC.ui.line.stunts", { n: p.max ?? 0 })); break;
    case "exception": if (d.text) out.push({ quote: String(d.text), by: about }); if (d.reason) out.push(t("ITAC.ui.line.why", { reason: reasonText(t, d.reason) })); break;
    case "other": if (d.text) out.push({ quote: String(d.text), by: about }); break;
    case "direction": case "stunt": out.push(t("ITAC.ui.line.stunt", { by: n(d.by), stunt: t(`ITAC.stunt.${d.stunt}`, {}, String(d.stunt ?? "")), target: n(d.target) })); break;
    case "helpOverride": out.push(t("ITAC.ui.line.help", { helper: about, name: n(d.for), reason: reasonText(t, d.reason) })); break;
    case "revalidate": out.push(t("ITAC.ui.line.revalidate", { name: about, reasons: (d.reasons ?? []).map((r) => reasonText(t, r)).join(", ") })); break;
    case "npcBroken": out.push(t("ITAC.ui.line.npcBroken", { name: about })); break;
    case "gate": out.push(t("ITAC.ui.line.gate", { name: about, gate: t(`ITAC.gate.${d.gate}`, {}, String(d.gate ?? "")) })); break;
    case "tokenConfirm": for (const k of d.tokens ?? []) out.push(t("ITAC.ui.line.token", { dice: k.dice, source: t(`ITAC.mod.${k.source}`, {}, String(k.source || "")), name: about })); break;
    case "veteran": out.push(t("ITAC.Prompt.veteran.Body", { name: about, card: d.card ?? "?" })); break;
    case "reflexes": out.push(t("ITAC.Prompt.reflexes.Body", { name: about })); break;
    case "grantConsent": out.push(t("ITAC.Prompt.grantConsent.Body", { name: about, from: d.from ? n(d.from) : t("ITAC.Someone") })); break;
    case "challengeFail": out.push(t("ITAC.Prompt.challengeFail.Body", { name: about })); break;
    case "triggerQueue": out.push(t("ITAC.Prompt.triggerQueue.Body")); break;
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
  const kind = p.of ?? p.kind, inst = (o.info ?? []).find((i) => i.inst === p.inst) ?? null;
  const text = (own.texts?.[p.id] ?? "").trim(), always = !!own.always?.[p.id];
  const allIds = (p.options ?? []).filter((x) => !x.disabled).map((x) => x.id);
  const picks = own.picks?.[p.id] ?? (kind === "triggerQueue" ? allIds : []);
  const queue = kind === "triggerQueue";
  /* what the GM sees on a reaction card: the attacker's dice and, per answer, the chance that the attack still lands */
  let attPool = null;
  if (desk && kind === "reaction" && p.data?.attacker && inst?.attr) { const a = Number(attrsFor(facts, p.data.attacker)?.[inst.attr]); if (Number.isFinite(a)) attPool = Math.max(1, a); }
  const odds = (optId) => {
    if (attPool == null) return null;
    const dAttr = DEF_ATTR[optId], dPool = dAttr ? Number(attrsFor(facts, p.about)?.[dAttr]) : null;
    if (dAttr && Number.isFinite(dPool)) return t("ITAC.ui.odds.defended", { dice: dPool, p: pct(dice.pHit(attPool, Math.max(1, dPool))) });
    return optId === "pass" ? t("ITAC.ui.odds.open", { p: pct(dice.pSuccess(attPool)) }) : null;
  };
  /* stunts against one target only: the name goes into the sentence once instead of onto every button */
  const stuntTargets = [...new Set((p.options ?? []).map((x) => x.data?.stunt && x.data?.target).filter(Boolean))], oneTarget = stuntTargets.length === 1;
  const options = (p.options ?? []).map((x) => {
    const value = text && p.free ? { id: x.id, text } : always ? { id: x.id, always: true } : null;
    const zones = Array.isArray(x.data?.zones) ? x.data.zones : null;
    return { id: x.id, label: optLabel(p, x, t, facts, desk, oneTarget), cost: [costText(t, x.cost), x.stress ? t("ITAC.ui.stress", { n: x.stress }) : null].filter(Boolean).join(", ") || null,
      note: odds(x.id), disabled: x.disabled ? reasonText(t, x.disabled) : null, picked: picks.includes(x.id), pass: x.id === "pass", zones,
      req: x.disabled || p.multi ? null : value && x.req ? p.answerReq(value) : x.req,
      zoneReq: zones && !x.disabled ? (zone) => p.answerReq({ id: x.id, zone: String(zone) }) : null };      // an option that carries zones: the place picked on the map rides along [D]
  });
  const lines = linesOf(p, t, facts, { inst });
  if (oneTarget) lines.push(t("ITAC.ui.line.against", { name: nameOf(facts, stuntTargets[0], t) }));
  if (attPool != null) lines.push(t("ITAC.ui.line.attPool", { dice: attPool, attr: attrText(t, inst.attr) }));
  const max = p.max ?? options.length, min = p.min ?? 0;
  const multi = p.multi ? { min, max, n: picks.length } : null;
  const canSubmit = !multi || queue || (picks.length >= min && picks.length <= max);
  return {
    id: p.id, kind, proxy: p.kind === "proxy", title: titleOf({ ...p, to: desk ? "desk" : "player" }, t, facts, o.round), about: p.aboutName ?? nameOf(facts, p.about, t), lines, options, multi,
    free: p.free ? { text: own.texts?.[p.id] ?? "", placeholder: t(desk ? "ITAC.ui.note.gm" : "ITAC.ui.note.player") } : null,
    always: desk && Array.isArray(p.always) && p.always.length ? { on: always, label: t("ITAC.ui.always", { name: p.aboutName ?? "" }) } : null,
    submit: multi ? { label: queue ? t("ITAC.Prompt.triggerQueue.Go") : t("ITAC.ui.confirm", { n: picks.length, max }), disabled: canSubmit ? null : t("ITAC.ui.pickMore"),
      req: canSubmit ? p.answerReq(queue ? { order: [], skip: allIds.filter((id) => !picks.includes(id)) } : picks.slice()) : null } : null,
  };
}

/* ------------------------------------------------------------------ who the table waits for */
/** -> [{ who, mine, gm, what: [text] }] grouped by addressee; `mine` = this client is asked */
export function waitingData(waiting, facts, t) {
  const rows = new Map();
  for (const w of waiting ?? []) {
    const list = Array.isArray(w.to) ? w.to : [], gm = w.to === "gm" || (list.length > 0 && list.every((u) => u === "gm")), users = gm ? [] : list;      // a roll of an NPC waits for "gm" as a user
    const mine = gm ? !!facts.staff : users.includes(facts.me);
    const who = mine ? t("ITAC.ui.who.you") : gm ? t("ITAC.ui.who.gm") : users.map((u) => facts.userName?.(u) ?? t("ITAC.Someone")).join(", ") || t("ITAC.Someone");
    const what = w.what === "roll" ? t("ITAC.ui.wait.roll", { roll: rollLabel(t, w.key, { c: () => null }) }) : titleOf({ ...w, to: "player", aboutName: w.aboutName }, t, facts);
    const text = w.aboutName ? t("ITAC.ui.wait.about", { what, name: w.aboutName }) : what;
    const key = gm ? "gm" : users.join(",");
    if (!rows.has(key)) rows.set(key, { who, mine, gm, what: [] });
    rows.get(key).what.push(text);
  }
  return [...rows.values()].sort((a, b) => Number(b.mine) - Number(a.mine));
}

/* ------------------------------------------------------------------ the player's dock */
export const GROUPS = Object.freeze(["attack", "move", "act", "power", "free"]);
export const groupOf = (a) => (a.kind === "custom" ? "power" : a.flow === "attack" || a.tags?.includes("attack") ? "attack" : a.flow === "move" || a.tags?.includes("move") ? "move" : a.cost === "free" ? "free" : "act");
const PIP_ICON = { full: "full", quick: "quick" };

function pipsOf(bar, t) {
  const b = bar.budget;
  if (!b) return [];
  const one = (key, unit, state) => ({ key, unit, kind: PIP_ICON[unit], state, label: t(`ITAC.ui.pip.${unit}`), tip: t(`ITAC.ui.pip.tip.${state}`, { unit: t(`ITAC.ui.pip.${unit}`) }), req: state === "lost" ? null : bar.markReq?.(unit, state === "open") ?? null });
  return [one("full", "full", b.full), one("q1", "quick", b.quick?.[0] ?? "lost"), one("q2", "quick", b.quick?.[1] ?? "lost")];
}
function extrasOf(bar, t) {
  const out = [];
  for (const g of bar.budget?.grants ?? []) if (g.state !== "used" && g.state !== "refused") out.push({ kind: "grant", label: t("ITAC.ui.grant", { unit: t(`ITAC.ui.pip.${g.unit}`, {}, String(g.unit ?? "")) }), tip: g.stress ? t("ITAC.ui.stress", { n: g.stress }) : "" });
  for (const k of bar.tokens ?? []) out.push({ kind: "token", label: t("ITAC.ui.bonusDice", { n: k.dice }), tip: t(`ITAC.mod.${k.source?.name}`, {}, String(k.source?.name ?? "")) + (k.needsGm ? ` (${t("ITAC.ui.needsGm")})` : "") });
  for (const s of bar.statuses ?? []) out.push({ kind: "status", label: t(`ITAC.status.${s}`, {}, cap(s)), tip: "" });
  return out;
}
/* the panel above the bar: what the selected action needs before it can be declared (or why it cannot be, and the way to ask) */
function declarePanel(bar, a, own, facts, t) {
  const title = labelOf(t, a.label), cost = costText(t, a.cost);
  if (a.disabled) {
    /* the bar's reasons (not your turn, busy, nothing left to pay with) are refused by "declare" outright, so the way round them is the
       free-standing request to the GM; the action and the targets meant ride in its words */
    const names = (own.targets ?? []).map((id) => facts.view?.ledger?.[id] && facts.c?.(id)?.name).filter(Boolean).join(", ");
    return { kind: "blocked", action: a.id, title, cost, reason: t("ITAC.ui.blocked", { reason: reasonText(t, a.disabled) }), text: own.text ?? "", placeholder: t("ITAC.ui.exception.placeholder"),
      submit: { label: t("ITAC.ui.exception.ask"), disabled: (own.text ?? "").trim() ? null : t("ITAC.ui.exception.needText"), req: (own.text ?? "").trim() ? bar.exception.req(`${title}${names ? ` (${names})` : ""}: ${own.text.trim()}`.slice(0, 400)) : null } };
  }
  const targets = a.needsTarget ? targetsFor(a, facts, bar.combatant).map((r) => ({ id: r.id, name: r.name, img: r.img, likely: r.likely, picked: (own.targets ?? []).includes(r.id), note: r.unseen ? t("ITAC.reason.unseen") : null })) : null;
  const picked = (own.targets ?? []).filter((id) => targets?.some((x) => x.id === id));
  const tokens = (bar.tokens ?? []).map((k) => ({ id: k.id, label: t("ITAC.ui.bonusDice", { n: k.dice }), source: t(`ITAC.mod.${k.source?.name}`, {}, String(k.source?.name ?? "")), needsGm: !!k.needsGm, picked: (own.tokens ?? []).includes(k.id) }));
  const pool = poolPreview(a, bar, facts, own.tokens ?? []);
  let chance = null;
  if (pool) {
    const tgt = picked[0], dAttr = DEF_ATTR[a.defense];
    const defPool = tgt && dAttr ? Number(attrsFor(facts, tgt)?.[dAttr]) : NaN;
    const c = chanceOf(pool.total, Number.isFinite(defPool) ? defPool : null);
    chance = { level: c.level, text: t(`ITAC.ui.band.${c.band}`), defended: c.defended ? { level: c.defended.level, text: t(`ITAC.ui.band.${c.defended.band}`), label: t("ITAC.ui.ifDefends", { how: t(`ITAC.action.${a.defense}`) }) } : null };
  }
  const text = (own.text ?? "").trim();
  const why = a.needsTarget && !picked.length ? t("ITAC.ui.need.target") : a.needsText && !text ? t("ITAC.ui.need.text") : null;
  const decl = { ...(a.needsTarget ? { targets: picked.slice() } : {}), ...((own.tokens ?? []).length ? { tokens: own.tokens.slice() } : {}), ...(a.needsText ? { text } : {}) };
  /* the executor refused this very declaration as against the rules (out of reach, no line of sight...): the reason stays in the panel
     with the way round it, a declaration that carries a request for an exception (a card on the GM desk; the GM's own goes there too) */
  const ref = own.refused && own.refused.action === a.id && own.refused.key === picked.join(",") ? own.refused : null;
  const refused = ref ? { reason: t("ITAC.ui.blocked", { reason: reasonText(t, ref.reason, ref.params) }), text: facts.staff ? null : own.why ?? "", placeholder: t("ITAC.ui.exception.placeholder"),
    submit: { label: facts.staff ? t("ITAC.ui.exception.anyway") : t("ITAC.ui.exception.ask"), disabled: why ?? (facts.staff || (own.why ?? "").trim() ? null : t("ITAC.ui.exception.needText")),
      req: !why && (facts.staff || (own.why ?? "").trim()) ? a.exceptionReq(decl, facts.staff ? t("ITAC.ui.who.gm") : own.why.trim()) : null } } : null;
  return { kind: "declare", action: a.id, title, cost, targets, picking: !!a.needsTarget && !picked.length, tokens, refused,
    pool: pool ? { total: pool.total, parts: pool.parts.map((x) => (x.id === "token" ? { label: t(`ITAC.mod.${x.source}`, {}, String(x.source || t("ITAC.ui.bonus"))), dice: x.dice } : { label: attrText(t, x.id), dice: x.dice })) } : null, chance,
    text: a.needsText ? { value: own.text ?? "", placeholder: t("ITAC.ui.text.placeholder") } : null,
    submit: { label: own.amend ? t("ITAC.ui.amend") : t("ITAC.ui.declare"), disabled: why, req: why ? null : own.amend ? { op: "amend", inst: own.amend, decl: { ...decl, action: a.id } } : a.req(decl) } };
}
function minePanel(i, facts, t) {
  const roll = i.rolls?.[0];
  return { kind: "mine", inst: i.inst, title: labelOf(t, `ITAC.action.${i.action}`), targets: (i.targets ?? []).map((x) => x.name ?? nameOf(facts, x.id, t)), text: i.text ?? null,
    status: roll ? t("ITAC.ui.mine.roll", { dice: roll.dice ?? "?", roll: rollLabel(t, roll.key, facts) }) : i.status === "manual" ? t("ITAC.ui.mine.manual") : t("ITAC.ui.mine.open"),
    rolling: !!roll, commands: (i.commands ?? []).map((c) => ({ id: c.id, label: labelOf(t, c.label), req: c.needs ? null : c.req, amend: c.id === "amend" })) };
}
/** Everything the dock draws. -> { show: false } | { show, rest, chars, who, pips, extras, groups, other, holdOff, end, panel, prompts, waiting, turn } */
export function dockData(model, own, facts, t) {
  const bars = model?.bars ?? [];
  const info = model?.stack ?? [];
  const prompts = (model?.prompts ?? []).map((p) => askData(p, { t, facts, own, info, round: model?.turn?.round }));
  if (!bars.length) return { show: false, prompts, waiting: waitingData(model?.waiting, facts, t) };
  const asked = new Set((model?.prompts ?? []).map((p) => p.about));
  const bar = bars.find((b) => b.combatant === own.sel) ?? bars.find((b) => b.onTurn) ?? bars.find((b) => asked.has(b.combatant)) ?? bars[0];
  const c = facts.c?.(bar.combatant);
  const acts = bar.actions.filter((a) => a.id !== "other");
  const groups = GROUPS.map((g) => ({ id: g, label: t(`ITAC.ui.group.${g}`), items: acts.filter((a) => groupOf(a) === g).map((a) => ({ id: a.id, label: labelOf(t, a.label), cost: a.cost, costText: costText(t, a.cost),
    disabled: a.disabled ? reasonText(t, a.disabled) : null, armed: own.armed === a.id })) })).filter((g) => g.items.length);
  const mine = (model?.mine ?? []).filter((i) => i.actor === bar.combatant);
  const armed = own.armed ? bar.actions.find((a) => a.id === own.armed) : null;
  let panel = null;
  if (own.mode === "other") panel = { kind: "other", title: t("ITAC.action.other"), text: own.text ?? "", placeholder: t("ITAC.ui.other.placeholder"), hint: t("ITAC.ui.other.hint"),
    submit: { label: t("ITAC.ui.other.send"), disabled: (own.text ?? "").trim() ? null : t("ITAC.ui.need.text"), req: (own.text ?? "").trim() ? bar.other.req(own.text.trim()) : null } };
  else if (own.mode === "holdOff") panel = { kind: "holdOff", title: t("ITAC.ui.holdOff"), hint: t("ITAC.ui.holdOff.hint"), targets: (bar.holdOff?.targets ?? []).map((x) => ({ slot: x.slot, card: x.card, names: x.names.join(", "), req: bar.holdOff.req(x.slot) })) };
  else if (armed) panel = declarePanel(bar, armed, own, facts, t);
  else if (mine.length && !facts.staff) panel = minePanel(mine[mine.length - 1], facts, t);
  const unused = pipsOf(bar, t).filter((p) => p.state === "open").map((p) => p.label);
  const end = bar.endTurn ? { label: own.endArmed ? t("ITAC.ui.end.sure") : t("ITAC.ui.end"), tip: bar.endTurn.disabled ? reasonText(t, bar.endTurn.disabled) : unused.length ? t("ITAC.ui.end.unused", { list: unused.join(", ") }) : t("ITAC.ui.end.tip"),
    disabled: bar.endTurn.disabled ? reasonText(t, bar.endTurn.disabled) : null, req: bar.endTurn.req, confirm: unused.length > 0, armed: !!own.endArmed }
    : { label: t("ITAC.ui.end"), tip: reasonText(t, "notYourTurn"), disabled: reasonText(t, "notYourTurn"), req: null, confirm: false, armed: false };
  const canRest = !bar.onTurn || !!own.quiet;        // own.quiet: the GM's dock while a connected player's hero has the turn
  const turn = model?.turn?.combatant ? (bar.onTurn && !facts.staff ? t("ITAC.ui.turn.yours", { name: bar.name ?? "" }) : t("ITAC.ui.turn.of", { name: model.turn.name ?? t("ITAC.Someone") })) : "";
  return {
    show: true, canRest, rest: canRest && !panel && !own.peek, onTurn: !!bar.onTurn, round: model?.turn?.round ?? null,
    chars: bars.length > 1 ? bars.map((b) => ({ id: b.combatant, name: b.name, img: facts.c?.(b.combatant)?.img ?? null, onTurn: !!b.onTurn, sel: b.combatant === bar.combatant, asked: asked.has(b.combatant) })) : [],
    who: { id: bar.combatant, name: bar.name ?? c?.name ?? "", img: c?.img ?? null, onTurn: !!bar.onTurn, free: !!bar.free, freeLabel: t("ITAC.ui.freeMode") },
    pips: pipsOf(bar, t), extras: extrasOf(bar, t), groups,
    other: { label: t("ITAC.action.other"), armed: own.mode === "other", tip: t("ITAC.ui.other.hint") },
    holdOff: { label: t("ITAC.ui.holdOff"), armed: own.mode === "holdOff", disabled: bar.holdOff?.disabled ? reasonText(t, bar.holdOff.disabled) : null, tip: t("ITAC.ui.holdOff.hint") },
    end, panel, prompts, waiting: waitingData(model?.waiting, facts, t), turn,
  };
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
  if (at >= 0 && at < i.steps.length - 1) out.push({ id: "skip", type: "button", group: "step", label: t("ITAC.ui.ovr.skip"), req: R("skipStep") });
  if (at > 0) out.push({ id: "goto", type: "select", group: "step", label: t("ITAC.ui.ovr.goto"), choices: i.steps.slice(0, at).map((s) => ({ id: s, label: stepText(t, s), req: R("goToStep", { step: s }) })) });
  out.push({ id: "abortRefund", type: "button", group: "end", label: t("ITAC.ui.ovr.abortRefund"), req: R("abort", { refund: true }) },
    { id: "abortSpent", type: "button", group: "end", danger: true, label: t("ITAC.ui.ovr.abortSpent"), req: R("abort", { refund: false }) },
    { id: "manual", type: "button", group: "end", label: t("ITAC.cmd.resolve"), req: R("manual", { result: {} }) });
  return out;
}
function instData(i, model, own, facts, t) {
  const open = own.override === i.inst;
  const amend = i.commands?.find((c) => c.id === "amend"), veto = i.commands?.find((c) => c.id === "veto"), ovr = i.commands?.find((c) => c.id === "override");
  const att = (i.rolls ?? []).find((r) => r.key === "attack" || r.key === "roll");
  const rolls = (i.rolls ?? []).map((r) => ({ key: r.key, label: rollLabel(t, r.key, facts), dice: r.dice ?? null, sixes: r.sixes, waiting: !!r.waiting,
    text: r.waiting ? t("ITAC.ui.roll.waiting", { dice: r.dice ?? "?", users: (r.users ?? []).map((u) => (u === "gm" ? t("ITAC.ui.who.gm") : facts.userName?.(u) ?? t("ITAC.Someone"))).join(", ") || t("ITAC.ui.who.gm") }) : t("ITAC.ui.roll.done", { dice: r.dice ?? "?", sixes: r.sixes ?? 0 }),
    chance: r.waiting && Number.isFinite(r.dice) && r === att ? pct(dice.pSuccess(Math.max(1, r.dice))) : null }));
  const others = rosterOf({ ...facts, view: facts.view }, i.actor).filter((r) => !(i.targets ?? []).some((x) => x.id === r.id));
  const from = i.targets?.[0]?.id;
  return {
    id: i.inst, actor: i.actorName ?? t("ITAC.ui.who.gm"), action: labelOf(t, `ITAC.action.${i.action}`), targets: (i.targets ?? []).map((x) => x.name), text: i.text ?? null,
    step: stepText(t, i.step), cause: i.cause && i.cause !== "turn" ? t(`ITAC.ui.cause.${i.cause}`, {}, String(i.cause)) : null, locked: !!i.locked, child: !!i.parent,
    rolls, outcomes: (i.outcomes ?? []).map((o) => ({ name: o.name, text: o.hit ? t("ITAC.ui.ovr.hit") : t("ITAC.ui.ovr.miss"), hit: o.hit })),
    commands: [veto ? { id: "veto", label: labelOf(t, veto.label), req: veto.req, danger: true } : null, ovr ? { id: "override", label: labelOf(t, ovr.label), toggle: true, on: open } : null].filter(Boolean),
    override: open ? overrideControls(i, facts, t) : null,
    retarget: open && from && others.length ? { label: t("ITAC.ui.ovr.retarget"), choices: others.map((r) => ({ id: r.id, label: r.name, req: amend ? amend.req({ action: i.action, targets: [r.id] }) : ovr.req("retarget", { from, to: r.id }) })) } : null,
  };
}
function manualData(m, own, facts, t) {
  const f = own.manual?.[m.inst] ?? {}, resolve = m.commands.find((c) => c.id === "resolve"), abort = m.commands.find((c) => c.id === "abort");
  const cost = ["none", "quick", "full"].includes(f.cost) ? f.cost : "none";
  const damage = (m.targets ?? []).map((x) => ({ target: x.id, name: x.name, amount: Math.max(0, Math.trunc(Number(f.damage?.[x.id]) || 0)) }));
  const result = { cost, note: String(f.note ?? "").slice(0, 300), damage: damage.filter((d) => d.amount > 0).map((d) => ({ target: d.target, amount: d.amount })) };
  return { id: m.inst, actor: m.actorName ?? t("ITAC.ui.who.gm"), title: labelOf(t, `ITAC.action.${m.action}`), text: m.text ?? null, cause: m.cause && m.cause !== "turn" ? t(`ITAC.ui.cause.${m.cause}`, {}, String(m.cause)) : null,
    costs: ["none", "quick", "full"].map((id) => ({ id, label: costText(t, id), on: id === cost })), note: { value: f.note ?? "", placeholder: t("ITAC.ui.manual.note") }, damage,
    resolve: { label: t("ITAC.ui.manual.resolve"), req: resolve.req(result) }, abort: { label: labelOf(t, abort.label), req: abort.req } };
}
/** Everything the desk draws. -> { show, count, tab, waiting, turn, stack, manual, cards, journal, npcs, mode } */
export function deskData(model, own, facts, t) {
  if (!model) return { show: false };
  const cards = model.cards.map((c) => askData(c, { t, facts, own, desk: true, info: [...model.info, ...model.manual], round: model.turn?.round }));
  const rounds = [];
  for (const j of model.journal) {
    let r = rounds[rounds.length - 1];
    if (!r || r.round !== j.round) rounds.push((r = { round: j.round, label: t("ITAC.ui.round", { n: j.round ?? "?" }), rows: [] }));
    r.rows.push({ id: j.id, text: j.text || j.pub || t("ITAC.ui.journal.noText"), state: j.state,
      undo: j.undo ? { label: t("ITAC.ui.undo"), also: j.undo.alsoUndoes ? t("ITAC.ui.undo.also", { n: j.undo.alsoUndoes }) : null, req: j.undo.req, armed: own.undo === j.id,
        force: j.undo.alsoUndoes ? { label: t("ITAC.ui.undo.only"), req: j.undo.force.req() } : null,
        drift: own.drift === j.id ? j.undo.force.modes.map((m) => ({ id: m, label: t(`ITAC.ui.drift.${m}`), req: j.undo.force.req(m) })) : null } : null });
  }
  const POL = { block: ["ask", "always", "never"], dodge: ["ask", "always", "never"], onBroken: ["ask", "ko", "kill", "crit"] };
  const npcs = (model.npcs ?? []).map((n) => ({ id: n.id, name: n.name,
    policy: Object.entries(POL).map(([k, vals]) => ({ id: k, label: t(`ITAC.ui.policy.${k}`), choices: vals.map((v) => ({ id: v, label: t(`ITAC.ui.policy.${v}`), on: n.policy[k] === v, req: n.policyReq({ [k]: v }) })) })),
    reveal: ["stats", "powers", "health"].map((k) => ({ id: k, label: t(`ITAC.ui.reveal.${k}`), on: !!n.revealed[k], req: n.revealReq({ [k]: !n.revealed[k] }) })) }));
  const waiting = waitingData(model.waiting, facts, t);
  const count = cards.length + model.manual.length;
  return {
    show: true, count, tab: ["now", "journal", "table"].includes(own.tab) ? own.tab : "now", collapsed: !!own.collapsed,
    tabs: [{ id: "now", label: t("ITAC.ui.tab.now"), n: count }, { id: "journal", label: t("ITAC.ui.tab.journal"), n: 0 }, { id: "table", label: t("ITAC.ui.tab.table"), n: 0 }],
    title: t("ITAC.ui.desk"), waiting, waitingLabel: t("ITAC.ui.waitingFor"), nobody: model.turn?.combatant ? t("ITAC.ui.wait.nobody", { name: model.turn.name ?? "" }) : t("ITAC.ui.wait.idle"),
    turn: model.turn?.combatant ? t("ITAC.ui.turn.round", { n: model.turn.round ?? "?", name: model.turn.name ?? "" }) : "",
    stack: model.info.map((i) => instData(i, model, own, facts, t)).reverse(), manual: model.manual.map((m) => manualData(m, own, facts, t)),
    cards, empty: t("ITAC.ui.desk.empty"), journal: rounds, journalEmpty: t("ITAC.ui.journal.empty"), npcs, npcsEmpty: t("ITAC.ui.table.empty"), npcsTitle: t("ITAC.ui.table.npcs"),
    mode: { label: t("ITAC.ui.mode"), choices: ["tactical", "free"].map((m) => ({ id: m, label: t(`ITAC.ui.mode.${m}`), on: model.mode === m, req: model.modeReq(m) })) },
    labels: { override: t("ITAC.cmd.override"), set: t("ITAC.ui.set"), step: t("ITAC.ui.stepLabel"), queue: t("ITAC.ui.queue"), action: t("ITAC.ui.inProgress"), manual: t("ITAC.ui.manual"), collapse: t("ITAC.ui.desk.collapse"), expand: t("ITAC.ui.desk.expand", { n: count }),
      reveal: t("ITAC.ui.reveal"), groups: { dice: t("ITAC.ui.ovr.g.dice"), result: t("ITAC.ui.ovr.g.result"), step: t("ITAC.ui.ovr.g.step"), end: t("ITAC.ui.ovr.g.end") }, cost: t("ITAC.ui.manual.cost"), damage: t("ITAC.ui.manual.damage") },
  };
}
