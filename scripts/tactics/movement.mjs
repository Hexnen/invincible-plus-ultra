/* Tactical combat, package P3: MOVEMENT, the Foundry side (spec 7, 9.6). Thin: every rule is in movement-pure.mjs and flows/move.mjs,
   every call of the map goes through zones-adapter.mjs. Four jobs:
     zoneFacts(tok, byToken)   the live zone facts `Z` the pure code asks (engine.mjs puts them in the facts as `zones`)
     performMove(e, tok)       the two host effects of a move: `zmove` (one stretch along the named zones, the step listener asked)
                               and `zput` (an arrival nobody is asked about); the result carries the map's own inverse for the journal
     install(h)                per client, when tactical combat runs: the step listener, the map's rules driver, the cost
                               confirmation on a dragged token (the drag becomes a `move` request; the executor moves the token)
     pickMove / talk           the reach highlight with a zone pick for a combatant; communication range as a query
   h = { cid(tokenDoc) -> combatant id | null, c(cid) -> facts, state() -> view | null, facts() -> Facts, request(req) -> Promise<envelope> } */
import * as Zones from "./zones-adapter.mjs";
import * as MP from "./movement-pure.mjs";
import { t, errText } from "./lang.mjs";

const MOD = "invincible-plus-ultra";
const keyOf = (where) => (typeof where === "string" ? where.split(":")[0] : where?.zone ?? where);

/** the zone facts of movement-pure.mjs (header there) over the live map */
export function zoneFacts(tok, byToken = () => null) {
  const ref = (x) => (typeof x === "string" ? tok(x) ?? Zones.place(x) ?? x : x);
  return {
    place: (cid) => (tok(cid) ? Zones.placeOf(tok(cid)) : null),
    placeOf: (where) => Zones.place(where),
    plan: (cid, where, profile) => (tok(cid) ? Zones.plan(tok(cid), where, profile) : null),
    along: (cid, keys, opts) => (tok(cid) ? Zones.planAlong(tok(cid), keys, opts) : null),
    chain: (cid, o = {}) => (tok(cid) ? Zones.forcedChain(tok(cid), { distance: o.distance, ...(o.direction ? { direction: o.direction } : {}), ...(o.awayFrom ? { awayFrom: ref(o.awayFrom) } : {}), ...(o.toward ? { toward: ref(o.toward) } : {}) }) : null),
    reach: (cid, profile, max) => (tok(cid) ? Zones.reach(tok(cid), profile, { max }) : []),
    within: (where, n) => Zones.zonesWithin(where, n),
    zone: (where) => Zones.zoneOf(keyOf(where)),
    states: (where) => Zones.zoneStates(where),
    border: (key) => { const [a, b] = String(key).split("|"); return a && b ? Zones.borderBetween(a, b) : null; },
    at: (spot) => Zones.tokensInZone(spot).map(byToken).filter(Boolean),
    range: (a, b) => (tok(a) && tok(b) ? Zones.range(tok(a), tok(b)) : null),
  };
}
/* A tab that draws no frames (minimised, in the background) never finishes an animated token movement, and the map's move would wait
   for it: there the executor moves the tokens without animation. -> the `options` for the map's token updates */
export async function drawOptions() {
  if (typeof requestAnimationFrame !== "function") return undefined;
  const alive = await Promise.race([new Promise((r) => requestAnimationFrame(() => r(true))), new Promise((r) => setTimeout(() => r(false), 250))]);
  return alive ? undefined : { animate: false };
}
/** Carry out `zmove` / `zput` (engine-pure.mjs effects). -> { op, result } | { ok:false, reason } */
export async function performMove(e, tok) {
  try {
    const token = tok(e.who), group = (e.group ?? []).map(tok).filter(Boolean);
    if (!token) return { ok: false, reason: "noToken" };
    const options = await drawOptions();
    if (e.t === "zput") {
      const r = await Zones.moveToZone(token, e.to, { group, ...(options ? { options } : {}) });
      return r.ok ? { op: r.journal, result: { ok: true, spot: r.place?.spot ?? null } } : { ok: false, reason: r.reason };
    }
    const plan = Zones.planAlong(token, e.zones ?? [], { ...(e.profile ? { profile: e.profile } : {}), ...(e.end ? { end: e.end } : {}), forced: !!e.forced });
    if (!plan) return { ok: false, reason: "noRoute" };
    const r = await Zones.move(token, null, { plan, ...(e.profile ? { profile: e.profile } : {}), group, forced: !!e.forced, data: { ipu: e.data ?? {} }, wait: true, ...(options ? { options } : {}) });
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
let offStep = null, on = false, H = null;
const costText = (o) => `${t(`ITAC.cost.${o.cost ?? "none"}`)}${o.stress ? ` + ${t("ITAC.move.stress", { n: o.stress })}` : ""}${o.barriers?.length ? ` + ${t("ITAC.move.force", { n: o.barriers.length })}` : ""}`;
const modeText = (id) => t(`ITAC.mode.${id}`, {}, id);
/** the options of one combatant for one destination, or all of them */
export function optionsFor(h, cid, to = null) {
  const st = h.state(), Z = h.facts().zones, c = h.c(cid);
  if (!st || !Z || !c) return [];
  return MP.moveOptions(Z, st, cid, c).filter((o) => !to || o.to === to || (o.zone === keyOf(to) && !o.elevated && !to.includes(":")));
}
async function ask(h, cid, opts, title) {
  const usable = opts.filter((o) => !o.disabled);
  if (!usable.length) { ui.notifications?.warn(t("ITAC.move.cannot", { reason: t(`ITAC.reason.${opts[0]?.disabled ?? "noRoute"}`, {}, String(opts[0]?.disabled ?? "")) })); return null; }
  const buttons = usable.slice(0, 8).map((o, i) => ({ action: `o${i}`, label: `${modeText(o.mode)}: ${costText(o)}`, default: i === 0 }));
  const pick = await foundry.applications.api.DialogV2.wait({ window: { title }, content: `<p>${t("ITAC.move.confirm")}</p>`, buttons: [...buttons, { action: "no", label: t("ITAC.opt.cancel") }], rejectClose: false });
  const o = typeof pick === "string" && pick.startsWith("o") ? usable[Number(pick.slice(1))] : null;
  if (!o) return null;
  const env = await h.request({ op: "move", actor: cid, to: o.to, mode: o.mode, ...(o.stress ? { stress: 1 } : {}), ...(o.force ? { force: true } : {}) });
  if (env && env.ok === false) ui.notifications?.warn(errText(env.error));
  return env;
}
/** A token was dragged into another zone during tactical play: the cost is confirmed and the move goes to the executor as a request. */
function onDrag(h, ctx) {
  try {
    const cid = h.cid(ctx.token?.document ?? ctx.token), to = ctx.to?.spot ?? null;
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
    H = h;
    if (on || !Zones.available()) return on;
    offStep = Zones.beforeStep((ctx) => MP.stepVerdict(ctx));                                    // only the engine's own moves carry `data.ipu`; every other move passes
    Zones.rulesDriver({ id: MOD, title: "Invincible Plus Ultra", fireRound: async () => { ui.notifications?.info(t("ITAC.move.fireByTactics")); }, wreck: () => "" });   // the map stops rolling fire and showing wrecking numbers [G-Z9]
    Zones.tactical({ gm: true, when: (td) => !!h.cid(td) && h.state()?.mode === "tactical" && !h.state()?.free?.[h.cid(td)],
      profile: (td) => { const m = MP.modesOf(h.c(h.cid(td)) ?? {}); const best = m.reduce((a, b) => ((b.profile.stressZones ?? b.profile.zones) > (a.profile.stressZones ?? a.profile.zones) ? b : a), m[0]); return best ? MP.apiProfile(best.profile, { stress: true, force: true }) : { way: "walk", speed: 1 }; },
      confirm: (ctx) => onDrag(h, ctx) });
    on = true;
  } catch (err) { console.warn(`${MOD} | tactics: movement`, err); }
  return on;
}
export function uninstall() { try { offStep?.(); offStep = null; Zones.tactical(false); Zones.rulesDriver(false, MOD); on = false; } catch (err) { console.warn(`${MOD} | tactics: movement`, err); } }
/** api.tactics.movement: the same calls for the widgets (the action bar, the GM desk) */
export const api = {
  installed: () => on,
  options: (cid, to = null) => (H ? optionsFor(H, cid, to) : []),
  pick: (cid) => (H ? pickMove(H, cid) : Promise.resolve(null)),
  move: (cid, to, o = {}) => (H ? H.request({ op: "move", actor: cid, to, ...o }) : Promise.resolve(null)),
  canTalk: (a, b, link = false) => { const Z = H?.facts().zones; return Z ? talk(Z, a, b, link) : undefined; },
};
