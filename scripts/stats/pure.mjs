/* Plus Ultra STATISTICS, the pure core (no Foundry globals; node-tested in scripts/stats/check-stats.mjs).
   A STATISTIC IS A SUM OF FACTS. A fact is one small record of something that happened at the table, written once by the active GM's
   client (store.mjs) under a deterministic id, so the same thing seen twice (a reload, a second GM tab, a re-run of an engine step)
   writes the same key and never counts twice. Facts are taken back, never corrected: an undone tactical action drops every fact of its
   transaction, an aborted action every fact of its instance, a pushed roll replaces the roll it re-threw.
   Sources (capture.mjs):
     tactical  the engine's full event stream (spec 16, hook invincible-plus-ultra.tacticsGm) of a TACTICAL FIGHT: a fact is "t" when it came
               from the engine, whatever made the fight tactical (a world setting, or the Tactics start of a single fight);
     loose     the system's own roll cards and the module's Damage Taken cards in the chat, outside the engine: "l".
   Fact = { id, k, t, m:"t"|"l", f?:fight key, x?:tx, i?:inst, a?:actor id (who did it), ac?:combatant, o?:actor id (to whom), oc?:combatant,
            u?:user who threw, v?:1 (GM only), vu?:user who may see a GM-only fact too, ...numbers }
   Kinds: roll act rx hit dmg str stunt down crit ctr chal mv (see factsOfEvent / factOfRoll). mv (AWRD): a move the doer made itself,
   n = the zones it crossed (the engine's `move` event); the sums do not show it, the titles do (titles-pure.mjs "Mr Everywhere"). */

export const MOD = "invincible-plus-ultra";
export const V = 1;
export const SESSION_GAP = 4 * 3600 * 1000;          // STAT-6: four hours without a fact end a session
export const PAGE_MAX = 500;                         // facts per journal page
export const KINDS = Object.freeze(["roll", "act", "rx", "hit", "dmg", "str", "stunt", "down", "crit", "ctr", "chal", "mv"]);
export const MODES = Object.freeze(["t", "l"]);

const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
const int = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d);
const pos = (v) => Math.max(0, int(v));
const str = (v, n = 60) => (typeof v === "string" ? v.slice(0, n) : v === undefined || v === null ? "" : String(v).slice(0, n));
/** a flag key may hold no dot (Foundry expands it), no "-=" and nothing odd: ids are mapped to [A-Za-z0-9_] */
export const safe = (s) => String(s ?? "").replace(/[^A-Za-z0-9_]/g, "_").slice(0, 120);
export const fightKey = (combatId, fight) => safe(`${combatId ?? ""}_${fight ?? "x"}`);

/* ------------------------------------------------------------------ tactical events -> facts
   ev: a full event (spec 16) with `combat`, `fight`, `seq`, `inst`, `itx`, `actor` (the instance's combatant), `by`, `at`.
   ctx = { who(cid) -> { a: actor id, side: "h"|"n", minion?: bool } | null, pub: bool (the event is public: the table saw it), user(messageId) -> user id | null }.
   -> { facts: [...], drop?: { x } | { i } } */
export function factsOfEvent(ev, ctx) {
  if (!isObj(ev) || typeof ev.type !== "string") return { facts: [] };
  const f = fightKey(ev.combat, ev.fight), base = { m: "t", f, t: int(ev.at, 0), ...(ev.itx ? { x: safe(ev.itx) } : {}), ...(ev.inst ? { i: safe(ev.inst) } : {}), ...(ctx?.pub ? {} : { v: 1 }) };
  const who = (cid) => (typeof cid === "string" && cid ? ctx?.who?.(cid) ?? null : null);
  const me = who(ev.actor), id = (...p) => safe([f, ev.inst ?? `s${ev.seq}`, ...p].join("_"));
  const doer = (cid) => { const w = who(cid); return w ? { a: w.a, ac: cid } : {}; };
  const onto = (cid) => { const w = who(cid); return w ? { o: w.a, oc: cid } : {}; };
  const out = [];
  switch (ev.type) {
    case "undo": return { facts: [], drop: { x: safe(ev.tx) } };
    case "actionClosed": return ev.summary?.status === "aborted" && ev.inst ? { facts: [], drop: { i: safe(ev.inst) } } : { facts: [] };
    case "actionDeclared": {
      if (!me || ev.amended) break;
      const act = str(ev.decl?.action ?? ev.action, 40);
      if (!act || act === "other" && !ev.decl) break;
      out.push({ ...base, id: id("act"), k: "act", ...doer(ev.actor), nm: act, ...(pos(ev.stress) ? { st: pos(ev.stress) } : {}), ...(ev.cost && ev.cost !== "none" ? { c: str(ev.cost, 8) } : {}) });
      break;
    }
    case "reaction": {
      const w = who(ev.who); if (!w) break;
      out.push({ ...base, id: id("rx", ev.who, ev.kind), k: "rx", a: w.a, ac: ev.who, nm: str(ev.kind, 40), ...(pos(ev.stress) ? { st: pos(ev.stress) } : {}) });
      break;
    }
    case "roll": {
      const w = who(ev.who); if (!w) break;
      const u = ev.messageId ? ctx?.user?.(ev.messageId) ?? null : null;
      out.push({ ...base, id: id("r", ev.key), k: "roll", a: w.a, ac: ev.who, n: pos(ev.dice), s: pos(ev.sixes), b: pos(ev.ones), p: pos(ev.pushed),
        ...(ev.attr ? { at: str(ev.attr, 24) } : {}), ...(ev.key === "attack" ? { atk: 1 } : {}), ...(String(ev.key ?? "").startsWith("def:") ? { def: 1 } : {}), ...(u ? { u } : {}), ...(ev.secret ? { v: 1 } : {}) });
      break;
    }
    case "outcome": {
      if (typeof ev.target !== "string" || typeof ev.hit !== "boolean") break;                   // an act's outcome (a result word) is not an attack
      out.push({ ...base, id: id("o", ev.target), k: "hit", ...doer(ev.actor), ...onto(ev.target), h: ev.hit ? 1 : 0, ...(ev.blocked ? { df: "block" } : ev.dodged ? { df: "dodge" } : {}) });
      break;
    }
    case "damage": {
      if (typeof ev.target !== "string") break;
      const taken = pos(ev.taken), raw = pos(ev.base) * (ev.doubled ? 2 : 1), armor = Math.max(0, Math.min(pos(ev.armor), raw - taken));
      out.push({ ...base, id: id("d", ev.target, ev.source ?? ev.dtype ?? ""), k: "dmg", ...doer(ev.actor), ...onto(ev.target), tk: taken, ...(armor ? { ar: armor } : {}), ...(ev.toStress ? { ts: 1 } : {}), ...(ev.source ? { src: str(ev.source, 16) } : {}) });
      break;
    }
    case "fall": {
      if (typeof ev.combatant !== "string" || !(pos(ev.damage) > 0)) break;
      out.push({ ...base, id: id("d", ev.combatant, "fall"), k: "dmg", ...onto(ev.combatant), tk: pos(ev.damage), src: "fall" });
      break;
    }
    case "stress": {
      if (typeof ev.target !== "string" || !(pos(ev.n) > 0)) break;
      out.push({ ...base, id: id("s", ev.target, ev.source ?? ""), k: "str", ...(ev.target === ev.actor ? {} : doer(ev.actor)), ...onto(ev.target), n: pos(ev.n), ...(ev.target === ev.actor ? { own: 1 } : {}) });
      break;
    }
    case "stunt": {
      if (!me) break;
      out.push({ ...base, id: id("st", ev.stunt, ev.target ?? ""), k: "stunt", ...doer(ev.actor), ...onto(ev.target), nm: str(ev.stunt, 40) });
      break;
    }
    case "broken": {
      if (typeof ev.target !== "string") break;
      out.push({ ...base, id: id("x", ev.target), k: "down", ...doer(ev.actor), ...onto(ev.target), fate: "broken", n: 1 });
      break;
    }
    case "status": {
      const sid = ev.status?.id;
      if (typeof ev.target !== "string" || ev.status?.on !== true || !["dead", "unconscious"].includes(sid)) break;
      const t = who(ev.target);
      if (t?.minion) break;                                                                       // a group's members are counted by "minions"
      out.push({ ...base, id: id("x", ev.target), k: "down", ...doer(ev.actor), ...onto(ev.target), fate: sid, n: 1 });      // same id as "broken": one defeat per action and target
      break;
    }
    case "minions": {
      if (typeof ev.target !== "string" || !(pos(ev.n) > 0)) break;
      out.push({ ...base, id: id("x", ev.target), k: "down", ...doer(ev.actor), ...onto(ev.target), fate: str(ev.fate, 12) || "unconscious", n: pos(ev.n), mn: 1 });
      break;
    }
    case "crit": {
      if (typeof ev.target !== "string") break;
      out.push({ ...base, id: id("c", ev.target), k: "crit", ...doer(ev.actor), ...onto(ev.target), ...(ev.crit?.id ? { nm: str(ev.crit.id, 40) } : {}) });
      break;
    }
    case "counter": {      // AWRD (found live): the engine's emit() overwrites `by` with the user id; the counterattacker is `who` (flows/attack.mjs)
      const by = who(ev.who) ? ev.who : ev.by, w = who(by); if (!w) break;
      out.push({ ...base, id: id("ctr", by), k: "ctr", a: w.a, ac: by, ...onto(ev.against), s: pos(ev.sixes) });
      break;
    }
    case "move": {
      const w = who(ev.combatant); if (!w || !(pos(ev.zones) > 0)) break;
      out.push({ ...base, id: id("mv", ev.combatant), k: "mv", a: w.a, ac: ev.combatant, n: pos(ev.zones) });
      break;
    }
    case "challenge": {      // AWRD (found live): `by` is overwritten with the user id by emit(); the doer is `who` (flows/challenge.mjs), else the instance's actor
      const by = who(ev.who) ? ev.who : who(ev.by) ? ev.by : ev.actor, w = who(by); if (!w || !(pos(ev.sixes) > 0 || ev.state === "overcome")) break;
      out.push({ ...base, id: id("ch", ev.challenge), k: "chal", a: w.a, ac: by, ...onto(ev.challenge), s: pos(ev.sixes), ...(ev.state === "overcome" ? { win: 1 } : {}) });
      break;
    }
    default: break;
  }
  return { facts: out.filter((x) => x.a || x.o) };
}

/* ------------------------------------------------------------------ loose rolls -> facts
   msg = { id, actorId, userId, time, mode: "public"|"gm"|"blind", flavor, roll: { successCount, baneCount, pushCount, dice:[n], attackDamage, stunts, attr } } */
export function factOfRoll(msg) {
  if (!isObj(msg) || !msg.id || !msg.actorId || !isObj(msg.roll)) return null;
  const r = msg.roll, n = Array.isArray(r.dice) ? r.dice.length : pos(r.n);
  return { id: safe(`m_${msg.id}`), k: "roll", m: "l", t: int(msg.time, 0), a: msg.actorId, ...(msg.userId ? { u: msg.userId } : {}), n, s: pos(r.successCount), b: pos(r.baneCount), p: pos(r.pushCount),
    ...(r.attr ? { at: str(r.attr, 24) } : msg.flavor ? { lb: str(msg.flavor, 40) } : {}), ...(pos(r.attackDamage) > 0 ? { atk: 1 } : {}), ...(pos(r.stressCost) > 0 ? { sc: pos(r.stressCost) } : {}),
    ...(msg.mode === "blind" ? { v: 1 } : msg.mode === "gm" ? { v: 1, ...(msg.userId ? { vu: msg.userId } : {}) } : {}) };
}
/** Damage Taken card -> facts (the damage, and a defeat when it broke the target). card = { id, actorId (target), attackerId?, amount, from?, to?, time, mode, broken? } */
export function factsOfDamageCard(card) {
  if (!isObj(card) || !card.id || !card.actorId) return [];
  const vis = card.mode === "public" || !card.mode ? {} : { v: 1 }, a = card.attackerId && card.attackerId !== card.actorId ? { a: card.attackerId } : {};
  const out = [{ id: safe(`dc_${card.id}`), k: "dmg", m: "l", t: int(card.time, 0), ...a, o: card.actorId, tk: pos(card.amount), ...vis }];
  const broke = card.broken === true || (Number.isFinite(card.to) && card.to <= 0 && Number.isFinite(card.from) && card.from > 0);
  if (broke) out.push({ id: safe(`dx_${card.id}`), k: "down", m: "l", t: int(card.time, 0), ...a, o: card.actorId, fate: "broken", n: 1, ...vis });
  return out;
}

/* ------------------------------------------------------------------ who may see what
   viewer = { gm: bool, id: user id, own: Set of actor ids this user owns }. STAT-3: the GM sees every fact; a player sees the facts the
   table saw (v:0) and a GM-only roll of their own (vu). */
export const visible = (fact, viewer) => !!fact && (viewer?.gm === true || !fact.v || (!!fact.vu && fact.vu === viewer?.id));

/* ------------------------------------------------------------------ periods (STAT-6) */
/** the start of the newest session: the time after the last gap of SESSION_GAP before the newest fact (0 when there is none) */
export function sessionStart(facts, gap = SESSION_GAP) {
  const ts = facts.map((x) => x.t).filter((t) => t > 0).sort((a, b) => a - b);
  if (!ts.length) return 0;
  let start = ts[ts.length - 1];
  for (let j = ts.length - 1; j > 0; j--) { if (ts[j] - ts[j - 1] > gap) break; start = ts[j - 1]; }
  return start;
}
/** the facts of a period: "all" | "session" | { fight: key } */
export function inPeriod(facts, period) {
  if (isObj(period) && period.fight) return facts.filter((x) => x.f === period.fight);
  if (period === "session") { const s = sessionStart(facts); return facts.filter((x) => x.t >= s); }
  return facts;
}

/* ------------------------------------------------------------------ the sums */
export const blank = () => ({ rolls: 0, dice: 0, sixes: 0, okRolls: 0, pushes: 0, ones: 0, attacks: 0, hits: 0, misses: 0,
  acts: 0, rx: 0, stunts: 0, counters: 0, dealt: 0, taken: 0, armor: 0, blocked: 0, dodged: 0, missedMe: 0, hitMe: 0, stressIn: 0, stressOut: 0,
  kills: 0, minions: 0, deaths: 0, assists: 0, critsDealt: 0, critsTaken: 0, chalSixes: 0, chalWon: 0, fights: 0, attrs: {}, actions: {}, stuntsBy: {} });
const bump = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };
/** One defeat counts once per action and target; on top of that, one target is counted ONCE per fight (the first defeat of it in that fight
    that is not undone) so "broken" and then "killed" by the same blow or a later one is one defeat. Loose defeats count each time. */
export function defeatsOf(facts) {
  const seen = new Set(), out = [];
  for (const x of [...facts].filter((y) => y.k === "down").sort((a, b) => a.t - b.t || String(a.id).localeCompare(String(b.id)))) {
    if (x.m === "t" && !x.mn) { const key = `${x.f}|${x.oc ?? x.o}`; if (seen.has(key)) continue; seen.add(key); }
    out.push(x);
  }
  return out;
}
/** sides(actorId) -> "h" | "n" | null: a defeat counts as a kill only against the other side (STAT-9) */
export function tally(factsIn, { viewer = { gm: true }, sides = () => null } = {}) {
  const facts = factsIn.filter((x) => visible(x, viewer));
  const by = new Map();
  const row = (a) => { if (!by.has(a)) by.set(a, { t: blank(), l: blank(), fightSet: new Set() }); return by.get(a); };
  const M = (a, m) => row(a)[m === "l" ? "l" : "t"];
  for (const x of facts) {
    if (x.m === "t" && x.f) { if (x.a) row(x.a).fightSet.add(x.f); if (x.o) row(x.o).fightSet.add(x.f); }
    switch (x.k) {
      case "roll": {
        if (!x.a) break; const s = M(x.a, x.m);
        s.rolls++; s.dice += pos(x.n); s.sixes += pos(x.s); s.ones += pos(x.b); s.pushes += pos(x.p); if (pos(x.s) > 0) s.okRolls++;
        const lb = x.at ? `a:${x.at}` : x.lb ? `l:${x.lb}` : null; if (lb) bump(s.attrs, lb);
        if (x.m === "l" && x.atk) { s.attacks++; if (pos(x.s) > 0) s.hits++; else s.misses++; }          // STAT-8: a loose attack lands when it rolled a six
        if (x.sc) s.stressOut += pos(x.sc);
        break;
      }
      case "hit": {
        if (x.a) { const s = M(x.a, x.m); s.attacks++; if (x.h) s.hits++; else s.misses++; }
        if (x.o) { const s = M(x.o, x.m); if (x.h) s.hitMe++; else if (x.df === "block") s.blocked++; else if (x.df === "dodge") s.dodged++; else s.missedMe++; }
        break;
      }
      case "dmg": {
        if (x.a && x.a !== x.o) M(x.a, x.m).dealt += pos(x.tk);
        if (x.o) { const s = M(x.o, x.m); if (x.ts) s.stressIn += pos(x.tk); else s.taken += pos(x.tk); s.armor += pos(x.ar); }
        break;
      }
      case "str": { if (x.o) { const s = M(x.o, x.m); if (x.own) s.stressOut += pos(x.n); else s.stressIn += pos(x.n); } break; }
      case "act": { if (!x.a) break; const s = M(x.a, x.m); s.acts++; bump(s.actions, x.nm); s.stressOut += pos(x.st); break; }
      case "rx": { if (!x.a) break; const s = M(x.a, x.m); s.rx++; bump(s.actions, `rx:${x.nm}`); s.stressOut += pos(x.st); break; }
      case "stunt": { if (!x.a) break; const s = M(x.a, x.m); s.stunts++; bump(s.stuntsBy, x.nm); break; }
      case "crit": { if (x.a && x.a !== x.o) M(x.a, x.m).critsDealt++; if (x.o) M(x.o, x.m).critsTaken++; break; }
      case "ctr": { if (x.a) M(x.a, x.m).counters++; break; }
      case "chal": { if (!x.a) break; const s = M(x.a, x.m); s.chalSixes += pos(x.s); if (x.win) s.chalWon++; break; }
      default: break;
    }
  }
  /* K / D / A (STAT-9) */
  const dmgBy = new Map();      // fight|target -> Set of actors who hurt it (assists)
  for (const x of facts) if (x.k === "dmg" && x.m === "t" && x.a && x.o && x.a !== x.o && pos(x.tk) > 0) { const k = `${x.f}|${x.oc ?? x.o}`; if (!dmgBy.has(k)) dmgBy.set(k, new Set()); dmgBy.get(k).add(x.a); }
  for (const x of defeatsOf(facts)) {
    const n = Math.max(1, pos(x.n));
    if (x.o && !x.mn) M(x.o, x.m).deaths++;                                                    // a minion group is never "dead" as one
    const foe = x.a && x.o && x.a !== x.o && (sides(x.a) === null || sides(x.o) === null || sides(x.a) !== sides(x.o));
    if (foe) { const s = M(x.a, x.m); if (x.mn) s.minions += n; else s.kills++; }
    if (x.m === "t") for (const helper of dmgBy.get(`${x.f}|${x.oc ?? x.o}`) ?? []) if (helper !== x.a && (sides(helper) === null || sides(helper) !== sides(x.o))) M(helper, "t").assists++;
  }
  for (const [, r] of by) { r.t.fights = r.fightSet.size; delete r.fightSet; }
  return by;
}
/** the two modes added up (the "together" column) */
export function sum(a, b) {
  const o = blank();
  for (const k of Object.keys(o)) {
    if (isObj(o[k])) { for (const src of [a?.[k], b?.[k]]) for (const [n, v] of Object.entries(src ?? {})) bump(o[k], n, v); }
    else o[k] = (a?.[k] ?? 0) + (b?.[k] ?? 0);
  }
  return o;
}
/** K/D as the table reads it: kills (characters and minions put out) against own defeats; with no defeat the ratio is the kills */
export const kd = (s) => { const k = (s?.kills ?? 0) + (s?.minions ?? 0), d = s?.deaths ?? 0; return { k, d, a: s?.assists ?? 0, ratio: d > 0 ? Math.round((k / d) * 100) / 100 : k }; };
export const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);
/** the biggest entries of a count map -> [[name, n]] */
export const top = (map, n = 4) => Object.entries(map ?? {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);

/* ------------------------------------------------------------------ fights: the lasting record of a finished fight
   rec = { f, c (combat id), sc (scene name), t0, t1?, r (rounds), chase?:1, pc: { <combatant>: { a, n, i, s:"h"|"n", hid?:1, out?: "dead"|"unconscious"|"broken" } },
           titles: [] }
   TITLES (the next package): `rec.titles` is the place for the awards of that fight, written by the GM's client into the same record:
     [{ id: "mvp" | "defender" | ..., c: <combatant id>, n?: number, v?: 1 (GM only) }]
   The history view hands every record to the renderers registered with api.stats.fightSections (ui/app.mjs) under the summary. */
export function newFight(f, combatId, now, sceneName = "") { return { f, c: str(combatId, 40), sc: str(sceneName, 80), t0: int(now, 0), r: 0, pc: {}, titles: [] }; }
/** the summary of one fight for a viewer, as the table's own fight card counts it (ui/feedback-pure totals): per combatant dealt, taken,
    stress, hits of attacks, defeats; plus what the character came to at the end. The GM sees every row; a player no row of somebody
    hidden at the end of the fight and no fact the table did not see. -> [{ cid, a, n, i, s, out, dealt, taken, stress, hits, attacks, kills, minions, deaths, blocked, dodged }] */
export function fightSummary(rec, facts, viewer = { gm: true }) {
  if (!isObj(rec)) return [];
  const mine = facts.filter((x) => x.f === rec.f && visible(x, viewer));
  const rows = new Map(), row = (cid) => {
    const p = rec.pc?.[cid]; if (!p || (!viewer?.gm && p.hid)) return null;
    if (!rows.has(cid)) rows.set(cid, { cid, a: p.a, n: p.n, i: p.i ?? null, s: p.s ?? "n", out: p.out ?? null, dealt: 0, taken: 0, stress: 0, hits: 0, attacks: 0, kills: 0, minions: 0, deaths: 0, blocked: 0, dodged: 0, stunts: 0 });
    return rows.get(cid);
  };
  for (const x of mine) {
    if (x.k === "hit") { const a = row(x.ac); if (a) { a.attacks++; if (x.h) a.hits++; } const o = row(x.oc); if (o && !x.h && x.df === "block") o.blocked++; if (o && !x.h && x.df === "dodge") o.dodged++; }
    if (x.k === "dmg") { const a = x.ac !== x.oc ? row(x.ac) : null; if (a) a.dealt += pos(x.tk); const o = row(x.oc); if (o) { if (x.ts) o.stress += pos(x.tk); else o.taken += pos(x.tk); } }
    if (x.k === "str" && !x.own) { const o = row(x.oc); if (o) o.stress += pos(x.n); }
    if (x.k === "stunt") { const a = row(x.ac); if (a) a.stunts++; }
  }
  for (const x of defeatsOf(mine)) {
    const o = row(x.oc); if (o && !x.mn) o.deaths++;
    const a = x.ac && x.ac !== x.oc ? row(x.ac) : null, foe = a && (!rec.pc?.[x.oc] || rec.pc[x.oc].s !== rec.pc[x.ac]?.s);
    if (a && foe) { if (x.mn) a.minions += Math.max(1, pos(x.n)); else a.kills++; }
  }
  for (const [cid, p] of Object.entries(rec.pc ?? {})) if (p.out && !(!viewer?.gm && p.hid)) row(cid);
  return [...rows.values()].sort((a, b) => (a.s === "h" ? 0 : 1) - (b.s === "h" ? 0 : 1) || b.dealt - a.dealt || b.kills + b.minions - (a.kills + a.minions) || String(a.n).localeCompare(String(b.n)));
}
/** the fights a viewer may list: every record for the GM; for a player those with at least one row (somebody the table saw) */
export function fightsFor(recs, facts, viewer) {
  const list = Object.values(recs ?? {}).filter(isObj).sort((a, b) => (b.t0 ?? 0) - (a.t0 ?? 0));
  return viewer?.gm ? list : list.filter((r) => Object.values(r.pc ?? {}).some((p) => !p.hid));
}

/* ------------------------------------------------------------------ the store's page shape */
/** clean one stored fact (a page is world data any GM may have edited): -> fact | null */
export function cleanFact(id, x) {
  if (!isObj(x) || !KINDS.includes(x.k) || !MODES.includes(x.m)) return null;
  return { ...x, id: String(id), t: int(x.t, 0) };
}
/** facts of all pages -> [fact] */
export function factsOfPages(pages) {
  const out = [];
  for (const p of pages ?? []) for (const [id, x] of Object.entries(p?.f ?? {})) { const c = cleanFact(id, x); if (c) out.push(c); }
  return out;
}
/** the ids to drop for an undo / an abort, from an index of facts: drop = { x } | { i } | { f } -> [ids] */
export function idsToDrop(facts, drop) {
  if (!isObj(drop)) return [];
  if (drop.x) return facts.filter((x) => x.x === drop.x).map((x) => x.id);
  if (drop.i) return facts.filter((x) => x.i === drop.i).map((x) => x.id);
  if (drop.f) return facts.filter((x) => x.f === drop.f).map((x) => x.id);
  return [];
}
/** which loose roll a pushed roll replaces: the newest loose roll of the same actor and user with one push fewer, within ten minutes,
    preferring the message that was just deleted (the system deletes the card it pushes). -> fact id | null */
export function pushParent(facts, roll, deleted = []) {
  if (!roll || !(pos(roll.p) > 0)) return null;
  const cands = facts.filter((x) => x.k === "roll" && x.m === "l" && x.a === roll.a && (x.u ?? null) === (roll.u ?? null) && pos(x.p) === pos(roll.p) - 1 && roll.t - x.t >= 0 && roll.t - x.t < 600000 && x.id !== roll.id);
  const del = cands.filter((x) => deleted.includes(x.id));
  const pick = (del.length ? del : cands).sort((a, b) => b.t - a.t)[0];
  return pick?.id ?? null;
}
