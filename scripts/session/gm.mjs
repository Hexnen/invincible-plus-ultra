/* End-of-session panel, phase S2: the GM-SIDE EXECUTOR. Every request (a local click on a GM client or a relayed one) ends up in exec(sender, req, meta):
   meta = { trusted, via: "local" | "relay", proto?, mod? }. `trusted` = the sender id is the server's word (second socket listener argument) or this very client.
   Nothing in a payload is believed: identity = `sender`, staff = the sender's REAL role, ownership = the REAL actor ownership table, the request is re-normalised
   to whitelisted fields (ops-pure.normalizeRequest), players can only send `setAnswer`, non-staff are rate limited, and the reducer re-checks everything again.
   Returns an envelope { ok, changed?, session?, error?: { key, code, params }, ... } and never throws. */
import * as P from "./pure.mjs";
import * as OP from "./ops-pure.mjs";
import * as Store from "./store.mjs";
import * as Award from "./award.mjs";

const MOD = Store.MOD;
const hits = new Map(), changes = new Map(), inflight = new Map();
const bad = (code, params = {}) => ({ ok: false, changed: false, error: { key: `IPL.Session.err.${code}`, code, params } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ctr = 0;

const heroView = (a) => ({ id: a.id, name: a.name, img: typeof a.img === "string" ? a.img : "" });
const isCard = (a) => !!a?.flags?.[MOD]?.base?.kind;
const rosterFacts = (a, users) => ({ id: a.id, name: a.name, img: a.img, type: a.type, card: isCard(a), playerOwned: OP.playerOwned(a.ownership, users.map((u) => ({ id: u.id, isGM: u.isGM })), Store.ownerLevel()) });

/** The default roster: player-owned superheroes (spec Q2). */
export function defaultHeroes({ includeGm = false } = {}) {
  return OP.defaultRoster(game.actors.map((a) => rosterFacts(a, game.users)), { includeGm });
}

async function cmdStart(sender, a, ctx, rid) {
  let heroes;
  if (Array.isArray(a.heroes)) heroes = a.heroes.map((id) => game.actors.get(id)).filter((x) => x && x.type === "superhero" && !isCard(x)).map(heroView);
  else heroes = defaultHeroes({ includeGm: a.includeGm === true });
  const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const r = await Store.commit({ type: "start", id, heroes, askBad: a.askBad === true, rid }, ctx);
  if (r.ok && r.changed) Award.logStart(r.session);
  return r;
}
async function cmdAddHero(sender, a, ctx, rid) {
  const actor = game.actors.get(a.hero);
  if (!actor || actor.type !== "superhero" || isCard(actor)) return bad("unknownHero");
  return Store.commit({ type: "addHero", hero: heroView(actor), rid }, ctx);
}

/** Run one request on this (GM) client. */
export async function exec(sender, req, meta = {}) {
  try {
    if (Number(meta.proto) > OP.PROTO) return bad("stale", { theirs: Number(meta.proto), mine: OP.PROTO });
    if (!sender || meta.trusted !== true) return bad("untrusted");
    const staff = Store.isStaff(sender);
    if (!staff) {
      if (meta.via !== "relay" && meta.via !== "local") return bad("untrusted");
      if (!OP.rateHit(hits, sender.id, Date.now())) return bad("rate");
      if (Store.setting(Store.SETTING_ALLOW, true) === false) return bad("playersOff");
      // S4-09: a player can neither queue a pile of work for the GM client nor change more than a few answers per minute (excess is dropped before it costs anything)
      if ((inflight.get(sender.id) ?? 0) >= OP.MAX_INFLIGHT || OP.rateCount(changes, sender.id, Date.now(), OP.CHANGE_RATE[1]) >= OP.CHANGE_RATE[0]) return bad("rate");
    }
    const n = OP.normalizeRequest(req, { staff });
    if (!n.ok) return n;
    const rid = OP.makeRid(sender.id, req.id ?? `l${++ctr}${Math.random().toString(36).slice(2, 6)}`);
    if (meta.via === "relay" && !meta.noJitter) await wait(Math.random() * 120);        // two GM tabs of one user both receive a request: the loser finds the rid already applied
    const ctx = { user: { id: sender.id, staff }, owns: (heroId) => Store.owns(game.actors.get(heroId), sender) };
    if (n.kind === "act") {
      const act = { ...n.act, rid };
      if (staff) return await Store.commit(act, ctx);
      inflight.set(sender.id, (inflight.get(sender.id) ?? 0) + 1);
      try {
        const r = await Store.commit(act, ctx);
        if (r.ok && r.changed) OP.rateHit(changes, sender.id, Date.now(), OP.CHANGE_RATE[0] + 1, OP.CHANGE_RATE[1]);
        return r;
      } finally { inflight.set(sender.id, Math.max(0, (inflight.get(sender.id) ?? 1) - 1)); }
    }
    switch (n.cmd) {
      case "start": return await cmdStart(sender, n.args, ctx, rid);
      case "addHero": return await cmdAddHero(sender, n.args, ctx, rid);
      case "award": return await Award.award(sender, { chat: n.args.chat, _failAt: meta.via === "local" ? req.args?._failAt : null });
      case "undo": return await Award.undo(sender, n.args);
      case "discard": return await Store.commit({ type: "discard", rid }, ctx);
      case "dismiss": return await Award.dismiss();
      case "postSummary": return await Award.postSummary();
      default: return bad("badInput");
    }
  } catch (e) {
    console.warn(`${MOD} | session request failed`, e);
    return bad("internal", { msg: String(e?.message ?? e).slice(0, 80) });
  }
}
/** Test helper: forget the rate counters. */
export const _resetLimits = () => { hits.clear(); changes.clear(); inflight.clear(); };
