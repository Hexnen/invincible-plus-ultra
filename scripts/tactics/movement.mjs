/* Tactical combat, package P3: MOVEMENT, the Foundry side (spec 7, 9.6). Thin: every rule is in movement-pure.mjs and flows/move.mjs,
   every call of the map goes through zones-adapter.mjs. Four jobs:
     zoneFacts(tok, byToken)   the live zone facts `Z` the pure code asks (engine.mjs puts them in the facts as `zones`)
     performMove(e, tok)       the two host effects of a move: `zmove` (one stretch along the named zones, the step listener asked)
                               and `zput` (an arrival nobody is asked about); the result carries the map's own inverse for the journal
     install(h)                per client, when tactical combat runs: the step listener, the map's rules driver, the cost
                               confirmation on a dragged token (the drag becomes a `move` request; the executor moves the token)
     pickMove / talk           the reach highlight with a zone pick for a combatant; communication range as a query
   With the designed surfaces running, the action dock shows the options itself (api.options / api.doors) and takes the drag
   confirmation over (setDragSurface); the small dialog of `ask` stays for a client without them.
   h = { cid(tokenDoc) -> combatant id | null, c(cid) -> facts, state() -> view | null, facts() -> Facts, request(req) -> Promise<envelope> } */
import * as Zones from "./zones-adapter.mjs";
import * as MP from "./movement-pure.mjs";
import * as ZP from "./zones-pure.mjs";
import { doorOptions } from "./flows/move.mjs";
import { t, errText } from "./lang.mjs";

const MOD = "invincible-plus-ultra";
const keyOf = (where) => (typeof where === "string" ? where.split(":")[0] : where?.zone ?? where);

/* [D26] the states of the zone ON THE COMBATANT'S LEVEL as zone properties (a token asks for its own level and the states that name
   none); the whole zone's `zone.states` would hand a character on the ground what is stored on "elevated" or a floor. Wrecking is of
   the zone as a whole and stays zone-wide. */
export function levelStates(token, z) {
  if (!token) return z?.states ?? {};
  return { ...ZP.propsOfStates(Zones.zoneStates(token)), ...(z?.states?.wrecked ? { wrecked: true } : {}) };
}
/** the zone facts of movement-pure.mjs (header there) over the live map */
export function zoneFacts(tok, byToken = () => null) {
  const ref = (x) => (typeof x === "string" ? tok(x) ?? Zones.place(x) ?? x : x);
  return {
    place: (cid) => (tok(cid) ? Zones.placeOf(tok(cid)) : null),
    placeOf: (where) => Zones.place(where),
    plan: (cid, where, profile) => (tok(cid) ? Zones.plan(tok(cid), where, profile) : null),
    along: (cid, keys, opts) => (tok(cid) ? Zones.planAlong(tok(cid), keys, opts) : null),
    /* direction: { dx, dy } | { angle } along the map, or "up" | "down" for the levels of the mover's own zone (zones-api.md section 14) */
    chain: (cid, o = {}) => (tok(cid) ? Zones.forcedChain(tok(cid), { distance: o.distance, ...(o.direction ? { direction: o.direction } : {}), ...(o.awayFrom ? { awayFrom: ref(o.awayFrom) } : {}), ...(o.toward ? { toward: ref(o.toward) } : {}) }) : null),
    reach: (cid, profile, max) => (tok(cid) ? Zones.reach(tok(cid), profile, { max }) : []),
    within: (where, n) => Zones.zonesWithin(where, n),
    zone: (where) => Zones.zoneOf(keyOf(where)),
    /* [D26] a spot asks about ITS level: the ground spot is the bare key, which the map reads as every level (zones-pure levelRef) */
    states: (where) => Zones.zoneStates(ZP.levelRef(where)),
    statesAll: (key) => Zones.zoneStates(keyOf(key)),                                             // every level of the zone (a fire by level: hazards fireOf)
    border: (key) => { const [a, b] = String(key).split("|"); return a && b ? Zones.borderBetween(a, b) : null; },
    borders: (where) => Zones.bordersOf(keyOf(where)),
    at: (spot) => Zones.tokensInZone(ZP.levelRef(spot)).map(byToken).filter(Boolean),             // that level only
    range: (a, b) => (tok(a) && tok(b) ? Zones.range(tok(a), tok(b)) : null),
    graph: () => Zones.graph(),                                                                  // P5: the whole map for the hazards (burning zones, where a fire may spread)
  };
}
/** Carry out `zmove` / `zput` (engine-pure.mjs effects). -> { op, result } | { ok:false, reason } */
export async function performMove(e, tok) {
  try {
    if (e.t === "placed") return { op: { t: "zones", op: { op: "move", id: null, done: null }, inverse: e.inverse }, result: { ok: true } };      // W1 (U44): the GM's free placement is on the map already; the journal keeps the map's own way back
    const token = tok(e.who), group = (e.group ?? []).map(tok).filter(Boolean);
    if (!token) return { ok: false, reason: "noToken" };
    if (e.t === "zput") {
      const r = await Zones.moveToZone(token, e.to, { group });
      return r.ok ? { op: r.journal, result: { ok: true, spot: r.place?.spot ?? null } } : { ok: false, reason: r.reason };
    }
    const plan = Zones.planAlong(token, e.zones ?? [], { ...(e.profile ? { profile: e.profile } : {}), ...(e.end ? { end: e.end } : {}), forced: !!e.forced });
    if (!plan) return { ok: false, reason: "noRoute" };
    const r = await Zones.move(token, null, { plan, ...(e.profile ? { profile: e.profile } : {}), group, forced: !!e.forced, data: { ipu: e.data ?? {} }, wait: true });
    if (!r.ok) return { ok: false, reason: r.reason };
    const at = (e.zones ?? []).lastIndexOf(r.place?.zone);
    return { op: r.journal, result: { ok: true, done: r.done ?? 0, total: r.total ?? 0, spot: r.place?.spot ?? null, left: at >= 0 ? e.zones.slice(at) : [],
      stop: r.stopped ? { reason: String(r.stopped.reason ?? "blocked"), data: r.stopped.data ?? null } : null } };
  } catch (err) { console.warn(`${MOD} | tactics: move`, err); return { ok: false, reason: "error" }; }
}
/** [Z11] can a talk to b now? -> { ok, direct, reason } | undefined (no map: the GM judges) */
export function talk(Z, a, b, link = false) {
  const pa = Z.place(a), pb = Z.place(b);
  if (!pa || !pb) return undefined;
  const r = Z.range(a, b), border = r?.borders === 1 && pa.zone && pb.zone && pa.zone !== pb.zone ? Z.border(`${pa.zone}|${pb.zone}`) : null;
  return MP.canTalk(r, pa, pb, border, link);
}

/* ------------------------------------------------------------------ per client */
/* U107 / D112: `hand` follows this client's hand (a press on the map held, moved, released; a key): MP.handTracker tells a script's token update from a drag */
let offStep = null, on = false, H = null, surface = null, inputOn = false; const hand = MP.handTracker(), onBoard = (e) => { try { const v = e.target; return !!v && (v.id === "board" || v === globalThis.canvas?.app?.view); } catch { return false; } };
/** The action dock takes over the confirmation of a dragged token: fn(cid, spot) -> true when it showed the options itself. */
export function setDragSurface(fn) { surface = typeof fn === "function" ? fn : null; }
const costText = (o) => `${t(`ITAC.cost.${o.cost ?? "none"}`)}${o.stress ? ` + ${t("ITAC.move.stress", { n: o.stress })}` : ""}${o.barriers?.length ? ` + ${t("ITAC.move.force", { n: o.barriers.length })}` : ""}${o.wreck ? ` + ${t("ITAC.move.wreck")}` : ""}`;
const modeText = (id) => t(`ITAC.mode.${id}`, {}, id);
/** the options of one combatant for one destination, or all of them */
export function optionsFor(h, cid, to = null) {
  const st = h.state(), Z = h.facts().zones, c = h.c(cid);
  if (!st || !Z || !c) return [];
  return MP.moveOptions(Z, st, cid, c).filter((o) => !to || o.to === to || (o.zone === keyOf(to) && !o.elevated && !o.floor && !to.includes(":")));      // FXL2 (U212): a drag onto a zone is its ground, not a storey
}
async function ask(h, cid, opts, title) {
  const usable = opts.filter((o) => !o.disabled);
  if (!usable.length) { ui.notifications?.warn(t("ITAC.move.cannot", { reason: t(`ITAC.reason.${opts[0]?.disabled ?? "noRoute"}`, {}, String(opts[0]?.disabled ?? "")) })); return null; }
  const buttons = usable.slice(0, 8).map((o, i) => ({ action: `o${i}`, label: `${modeText(o.mode)}: ${costText(o)}`, default: i === 0 }));
  const pick = await foundry.applications.api.DialogV2.wait({ window: { title }, content: `<p>${t("ITAC.move.confirm")}</p>`, buttons: [...buttons, { action: "no", label: t("ITAC.opt.cancel") }], rejectClose: false });
  const o = typeof pick === "string" && pick.startsWith("o") ? usable[Number(pick.slice(1))] : null;
  if (!o) return null;
  const env = await h.request({ op: "move", actor: cid, to: o.to, mode: o.mode, ...(o.stress ? { stress: 1 } : {}), ...(o.force ? { force: true } : {}), ...(o.wreck ? { wreck: true } : {}) });
  if (env && env.ok === false) ui.notifications?.warn(errText(env.error));
  return env;
}
/** [D21] A level change asked for outside a move (the map's token HUD altitude button, held by tactical({ levels: true })): changing
    altitude is movement with a price [B2386-2388], so it is confirmed and sent to the executor exactly like a drag. The dock shows
    the price when its Move panel lists that level; a level it does not list (a floor, underground, down on foot) is priced here. */
function onLevel(h, ctx) {
  try {
    const cid = h.cid(ctx.token?.document ?? ctx.token), to = ctx.to?.spot ?? null;
    /* U107 (zones-api.md 41): a level a script wrote (setLevel from a macro) opens no window of ways either; only the map's word counts here */
    if (!cid || !to) return false; if (ctx.byHand === false) { ui.notifications?.warn(t("ITAC.move.script", { name: h.c(cid)?.name ?? "" }), { console: false }); return false; }
    const st = h.state(), Z = h.facts().zones, c = h.c(cid);
    const listed = st && Z && c ? MP.moveOptions(Z, st, cid, c).filter((o) => o.to === to) : [];
    if (listed.length && surface) { let took = false; try { took = surface(cid, to) === true; } catch { took = false; } if (took) return false; }
    const opts = listed.length ? listed : st && Z && c ? MP.optionsTo(Z, st, cid, c, to) : [];
    ask(h, cid, opts, `${c?.name ?? ""}: ${t("ITAC.action.move")}`).catch((err) => console.warn(`${MOD} | tactics: level`, err));
  } catch (err) { console.warn(`${MOD} | tactics: level`, err); }
  return false;                                                                                 // the token stays on its level; the executor changes it
}
/** A token was dragged into another zone during tactical play: the cost is confirmed and the move goes to the executor as a request. */
function onDrag(h, ctx) {
  if (ctx?.level === true) return onLevel(h, ctx);
  try {
    const cid = h.cid(ctx.token?.document ?? ctx.token), to = ctx.to?.spot ?? null;
    /* U74 (the map's D71): a drop out of every zone, or into a zone from outside them, is held by the map and has no route, so nothing
       can be priced: the one who dragged is told why the token stayed (before: silence). The GM's own such drop is a placement and never
       comes here. */
    /* U107: the map says whether a hand moved it (ctx.byHand, zones-api.md 41); the hand tracker (D112) only guesses for an older map */
    if (cid && MP.scriptMove(ctx, () => inputOn && hand.byScript(Date.now()))) { ui.notifications?.warn(t("ITAC.move.script", { name: h.c(cid)?.name ?? "" }), { console: false }); return false; }
    const off = MP.offZones(ctx);
    if (cid && off) { ui.notifications?.warn(t(`ITAC.move.${off}`), { console: false }); return false; }
    if (cid && to && surface) { let took = false; try { took = surface(cid, to) === true; } catch { took = false; } if (took) return false; }      // the dock shows the price (ui/main.mjs)
    if (cid && to) ask(h, cid, optionsFor(h, cid, to), `${h.c(cid)?.name ?? ""}: ${t("ITAC.action.move")}`).catch((err) => console.warn(`${MOD} | tactics: drag`, err));
  } catch (err) { console.warn(`${MOD} | tactics: drag`, err); }
  return false;                                                                                 // the token stays; the executor moves it step by step
}
/** Show where `cid` can go and let this client's user pick a zone; the pick is confirmed like a drag. -> envelope | null */
export async function pickMove(h, cid) {
  const opts = optionsFor(h, cid), byTo = new Map();
  for (const o of opts) if (!o.disabled && !byTo.has(o.to)) byTo.set(o.to, o);
  if (!byTo.size) { ui.notifications?.warn(t("ITAC.move.cannot", { reason: t(`ITAC.reason.${opts[0]?.disabled ?? "noRoute"}`, {}, "") })); return null; }
  const r = await Zones.pick({ zones: [...byTo.values()].filter((o) => !o.area).map((o) => ({ zone: o.to, label: o.d ? String(o.d) : "", tip: `${modeText(o.mode)}: ${costText(o)}`, color: o.barriers?.length ? "danger" : o.stress ? "stress" : "move" })),
    title: `${h.c(cid)?.name ?? ""}: ${t("ITAC.action.move")}`, hint: t("ITAC.move.pickHint"), color: "move" });
  return r?.ok ? ask(h, cid, opts.filter((o) => o.to === r.spot), `${h.c(cid)?.name ?? ""}: ${t("ITAC.action.move")}`) : null;
}
export function install(h) {
  try {
    H = h; if (!inputOn && typeof globalThis.window?.addEventListener === "function") inputOn = hand.listen(window, onBoard, Date.now);      // D112: on the window, capture phase
    if (on || !Zones.available()) return on;
    offStep = Zones.beforeStep((ctx) => MP.stepVerdict(ctx));                                    // only the engine's own moves carry `data.ipu`; every other move passes
    Zones.rulesDriver({ id: MOD, title: "Invincible Plus Ultra", fireRound: async () => { ui.notifications?.info(t("ITAC.move.fireByTactics")); }, wreck: () => "" });   // the map stops rolling fire and showing wrecking numbers [G-Z9]
    /* `levels`: the map also holds a level change made with its token HUD (zones-api.md section 14); a map that does not know the option ignores it */
    Zones.tactical({ gm: true, levels: true, when: (td) => !!h.cid(td) && h.state()?.mode === "tactical" && !h.state()?.free?.[h.cid(td)],
      profile: (td) => { const m = MP.modesOf(h.c(h.cid(td)) ?? {}); const best = m.reduce((a, b) => ((b.profile.stressZones ?? b.profile.zones) > (a.profile.stressZones ?? a.profile.zones) ? b : a), m[0]); return best ? MP.apiProfile(best.profile, { stress: true, force: true, big: MP.bigFor(h.c(h.cid(td))) }) : { way: "walk", speed: 1 }; },
      confirm: (ctx) => onDrag(h, ctx), place: (ctx) => { const cid = h.cid(ctx?.token?.document ?? ctx?.token); if (cid && ctx?.inverse) h.request({ op: "placed", combatant: cid, inverse: ctx.inverse, zone: ctx.to?.zone ?? null }); } });      // W1 (U44): the GM's Alt-drop is journaled, so "undo" takes it back
    on = true;
  } catch (err) { console.warn(`${MOD} | tactics: movement`, err); }
  return on;
}
export function uninstall() { try { offStep?.(); offStep = null; Zones.tactical(false); Zones.rulesDriver(false, MOD); on = false; } catch (err) { console.warn(`${MOD} | tactics: movement`, err); } }
/** api.tactics.movement: the same calls for the widgets (the action bar, the GM desk) */
export const api = {
  installed: () => on, zoneFacts: () => { try { return H?.facts().zones ?? null; } catch { return null; } }, c: (cid) => { try { return H?.c(cid) ?? null; } catch { return null; } },      // W1: the board's warnings read the same zone facts
  options: (cid, to = null) => (H ? optionsFor(H, cid, to) : []),
  pick: (cid) => (H ? pickMove(H, cid) : Promise.resolve(null)),
  move: (cid, to, o = {}) => (H ? H.request({ op: "move", actor: cid, to, ...o }) : Promise.resolve(null)),
  /** why `cid` has no option at all: no zones here, held / snared / trapped / broken, in no zone | null */
  why: (cid) => { try { const Z = H?.facts().zones, c = H?.c(cid), st = H?.state(); return !Z ? "noZones" : !c || !st ? "gone" : MP.cannotMove(st, cid, c) ?? (Z.place(cid) ? null : "noPlace"); } catch { return null; } },
  doors: (cid) => { try { const Z = H?.facts().zones; return Z ? doorOptions(Z, H.c(cid), cid) : []; } catch { return []; } },
  canTalk: (a, b, link = false) => { const Z = H?.facts().zones; return Z ? talk(Z, a, b, link) : undefined; },
};
