/* Plus Ultra STATISTICS, THE TITLES OF A FIGHT (package AWRD), the pure core (no Foundry globals; node-tested in
   scripts/tactics/check-awrd.mjs). A title is a small award the table gets at the end of a tactical fight (MVP, Defender, Killer...),
   computed from the facts the statistics already keep (pure.mjs): nothing here collects anything of its own.
   HONEST BY CONSTRUCTION (AWRD-3): the titles are judged ONLY on what the table saw: the public facts (no `v`), and only participants who
   were not hidden when the fight ended can win one. So the GM and every player get the same titles, and no title, holder or number can
   tell a player about a hidden NPC, a GM-only roll or an unrevealed NPC's Armor (the Armor of a hero only; an NPC's is never counted).
   Undone and aborted actions have no facts any more (pure.idsToDrop), so they never count; the GM's client computes the titles again
   whenever the facts of a recently ended fight change (titles.mjs).
   A title entry (stored in rec.titles through api.stats.setTitles): { id, c: combatant, a: actor id, n: the number it was won with,
   d?: { a few numbers for its line } }. rec.tm = { v: TV, small?: 1 } says the titles were counted (small: too short a fight for any). */
import * as P from "./pure.mjs";

export const TV = 1;
export const MIN_ACTS = 4;                 // AWRD-6: a fight of fewer counted actions gets no titles
export const MAX_SHARE = 3;                // AWRD-2: a full tie shares the title, at most this many holders
const pos = (v) => Math.max(0, Math.trunc(Number(v) || 0));
const HELP = new Set(["heal", "massHeal", "stabilize", "rally", "medicRally", "restore", "cleanse"]);      // what puts somebody else back on their feet
const FIRE = new Set(["extinguish", "saveBystanders"]);
const actId = (nm) => String(nm ?? "").split("-").pop();      // a kit action is "<entry>-<k>" (kit-pure)
const NO_FOE = new Set(["challenge", "vehicle"]);      // FXQ2: a challenge or a vehicle on the NPC side is no foe to put down

/* the titles in the order the card shows them. side: "h" heroes (the party and friendly NPCs), "n" NPCs.
   val(g) -> the number it is won with; tie(g) -> the second key; min: the least number that wins it */
export const TITLES = Object.freeze([
  { id: "mvp", icon: "fa-crown", side: "h", min: 4, val: (g) => g.mvp, tie: (g) => -g.deaths * 100 + g.hits },
  { id: "killer", icon: "fa-skull", side: "h", min: 1, val: (g) => g.kills + g.minions, tie: (g) => g.dealt },
  { id: "defender", icon: "fa-shield-halved", side: "h", min: 2, val: (g) => g.armor + 2 * g.blocks, tie: (g) => g.armor },
  { id: "firefighter", icon: "fa-fire-extinguisher", side: "h", min: 1, val: (g) => g.chalSixes + 2 * g.chalWon + 2 * g.fire, tie: (g) => g.chalWon },
  { id: "medic", icon: "fa-kit-medical", side: "h", min: 1, val: (g) => g.helps + g.support, tie: (g) => g.helps },
  { id: "everywhere", icon: "fa-person-running", side: "h", min: 3, val: (g) => g.moved, tie: (g) => g.moves },
  { id: "finisher", icon: "fa-hand-fist", side: "h", min: 1, val: (g) => g.last, tie: () => 0 },
  { id: "stuntman", icon: "fa-burst", side: "h", min: 2, val: (g) => g.stunts, tie: (g) => g.dealt },
  { id: "untouchable", icon: "fa-wind", side: "h", min: 2, val: (g) => (g.avoided > g.hitMe ? g.avoided : 0), tie: (g) => -g.hitMe },
  { id: "bag", icon: "fa-person-falling-burst", side: "h", min: 4, val: (g) => g.took, tie: (g) => g.out ? 1 : 0 },
  { id: "lucky", icon: "fa-dice-six", side: "h", min: 4, val: (g) => g.sixes, tie: (g) => (g.dice ? Math.round((g.sixes / g.dice) * 1000) : 0) },
  { id: "daredevil", icon: "fa-fire", side: "h", min: 2, val: (g) => g.pushes, tie: (g) => g.stressPaid },
  { id: "unlucky", icon: "fa-cat", side: "h", min: 3, val: (g) => g.ones, tie: (g) => g.dice },
  { id: "nemesis", icon: "fa-skull-crossbones", side: "n", min: 3, val: (g) => g.dealtHeroes, tie: (g) => g.kills }
]);
export const TITLE_IDS = Object.freeze(TITLES.map((x) => x.id));
export const iconOf = (id) => TITLES.find((x) => x.id === id)?.icon ?? "fa-award";

/** per participant, what the table saw it do in this fight. rec = the fight record, facts = every fact (any fight) */
export function gather(rec, facts) {
  const pc = rec?.pc ?? {}, side = (cid) => pc[cid]?.s ?? null;
  const foes = (a, b) => !!side(a) && !!side(b) && side(a) !== side(b);
  const mine = (facts ?? []).filter((x) => x && x.f === rec?.f && x.m === "t" && !x.v);
  const g = new Map(), row = (cid) => {
    if (!cid || !pc[cid]) return null;
    if (!g.has(cid)) g.set(cid, { cid, dealt: 0, dealtHeroes: 0, kills: 0, minions: 0, assists: 0, hits: 0, attacks: 0, armor: 0, blocks: 0, avoided: 0, hitMe: 0,
      took: 0, chalSixes: 0, chalWon: 0, fire: 0, helps: 0, support: 0, moved: 0, moves: 0, stunts: 0, sixes: 0, dice: 0, ones: 0, pushes: 0, stressPaid: 0, deaths: 0, last: 0, acts: 0, out: pc[cid].out ?? null });
    return g.get(cid);
  };
  /* an action counts as help / firefighting when it was not refused by its own roll: no roll in its instance, or a roll with a six */
  const okInst = new Map();
  for (const x of mine) if (x.k === "roll" && x.i) okInst.set(x.i, (okInst.get(x.i) ?? false) || pos(x.s) > 0);
  const worked = (x) => !x.i || !okInst.has(x.i) || okInst.get(x.i) === true;
  let acts = 0;
  for (const x of mine) {
    const a = row(x.ac), o = row(x.oc);
    switch (x.k) {
      case "act": { acts++; if (!a) break; a.acts++; a.stressPaid += pos(x.st); const k = actId(x.nm); if (HELP.has(k) && worked(x) && !x.sf) a.helps++; if (FIRE.has(k) && worked(x)) a.fire++; break; }
      case "rx": if (a) a.stressPaid += pos(x.st); break;
      case "roll": if (a) { a.dice += pos(x.n); a.sixes += pos(x.s); a.ones += pos(x.b); a.pushes += pos(x.p); } break;
      case "hit": {
        if (a && o && foes(x.ac, x.oc)) { a.attacks++; if (x.h) a.hits++; }
        if (o && a && foes(x.ac, x.oc)) { if (x.h) o.hitMe++; else if (x.df === "block") o.blocks++; else o.avoided++; }
        break;
      }
      case "dmg": {
        if (a && o && foes(x.ac, x.oc)) { a.dealt += pos(x.tk); if (side(x.oc) === "h") a.dealtHeroes += pos(x.tk); }
        if (o && side(x.oc) === "h") { o.armor += pos(x.ar); if (!a || foes(x.ac, x.oc)) o.took += pos(x.tk); }      // an NPC's Armor is never told (view-pure publicEvent)
        break;
      }
      case "str": if (o && !x.own && a && foes(x.ac, x.oc)) o.took += pos(x.n); break;
      case "stunt": if (a) { a.stunts++; if (x.nm === "support") a.support++; } break;
      case "chal": if (a) { a.chalSixes += pos(x.s); if (x.win) a.chalWon++; } break;
      case "mv": if (a) { a.moved += pos(x.n); a.moves++; } break;
      default: break;
    }
  }
  /* defeats: one per target per fight (pure.defeatsOf); a kill only against the other side; assists like the statistics (STAT-9) */
  const hurt = new Map();      // target -> Map(combatant -> its first blow): FXQ2 (ADVS-D3) an assist is a blow before the defeat
  for (const x of mine) if (x.k === "dmg" && x.ac && x.oc && foes(x.ac, x.oc) && pos(x.tk) > 0) { if (!hurt.has(x.oc)) hurt.set(x.oc, new Map()); const m = hurt.get(x.oc); if (!m.has(x.ac) || x.t < m.get(x.ac)) m.set(x.ac, x.t); }
  let lastAt = -1, lastBy = null, foeDowns = 0;
  const downed = new Set();
  for (const x of P.defeatsOf(mine)) {
    if (x.oc && (!x.mn || x.lf === 0)) downed.add(x.oc);
    const o = row(x.oc); if (o && !x.mn) o.deaths++;
    const a = row(x.ac);
    if (!a || !foes(x.ac, x.oc)) continue;
    if (x.mn) a.minions += Math.max(1, pos(x.n)); else a.kills++;
    if (side(x.ac) === "h") { foeDowns++; if (x.t >= lastAt) { lastAt = x.t; lastBy = x.ac; } }
    for (const [h, at] of hurt.get(x.oc) ?? []) if (h !== x.ac && at <= x.t) { const r = row(h); if (r) r.assists++; }
  }
  /* the last blow is a title only when there was more than one foe to put down, and (FXQ2, ADVS-D8) when no foe the table saw is still
     standing at the end (a fight stopped early): a hidden one does not count, so the title tells nobody about it (AWRD-3) */
  const standing = Object.entries(pc).some(([cid, p]) => p?.s === "n" && !p.hid && !p.nh && !NO_FOE.has(p.ty) && !p.out && !downed.has(cid));
  if (lastBy && foeDowns >= 2 && !standing) row(lastBy).last = 1;
  for (const r of g.values()) r.mvp = r.dealt + 3 * r.kills + r.minions + r.assists + 2 * r.helps + r.support + r.chalSixes + 3 * r.chalWon + 2 * r.fire + r.blocks + Math.floor(r.armor / 2);
  return { rows: g, acts };
}

/* the few numbers a title's line names */
const DETAIL = {
  mvp: (g) => ({ dealt: g.dealt, kills: g.kills + g.minions, assists: g.assists, helps: g.helps + g.support, chal: g.chalSixes + g.chalWon + g.fire }),
  defender: (g) => ({ armor: g.armor, blocks: g.blocks }),
  firefighter: (g) => ({ chal: g.chalSixes, won: g.chalWon, fire: g.fire }),
  lucky: (g) => ({ dice: g.dice }),
  bag: (g) => ({ out: g.out ? 1 : 0 })
};

/** The titles of one fight. -> { titles: [{ id, c, a, n, d? }], meta: { v, small? } } */
export function award(rec, facts) {
  if (!rec?.f) return { titles: [], meta: { v: TV, small: 1 } };
  const { rows, acts } = gather(rec, facts);
  if (acts < MIN_ACTS) return { titles: [], meta: { v: TV, small: 1 } };
  const pc = rec.pc ?? {}, out = [];
  for (const T of TITLES) {
    const cands = [...rows.values()].filter((g) => pc[g.cid] && !pc[g.cid].hid && pc[g.cid].s === T.side && T.val(g) >= T.min);
    if (!cands.length) continue;
    cands.sort((a, b) => T.val(b) - T.val(a) || T.tie(b) - T.tie(a));
    const top = cands[0], win = cands.filter((g) => T.val(g) === T.val(top) && T.tie(g) === T.tie(top));
    if (win.length > MAX_SHARE) continue;      // AWRD-2: a title everybody shares is no title
    for (const g of win.sort((a, b) => String(pc[a.cid].n).localeCompare(String(pc[b.cid].n)))) {
      const d = DETAIL[T.id]?.(g);
      out.push({ id: T.id, c: g.cid, a: pc[g.cid].a, n: T.val(g), ...(d ? { d } : {}) });
    }
  }
  return { titles: out, meta: { v: TV } };
}
/** did the stored titles say the same? (the writer writes only a change) */
export const sameTitles = (rec, got) => JSON.stringify(rec?.titles ?? []) === JSON.stringify(got.titles) && JSON.stringify(rec?.tm ?? null) === JSON.stringify(got.meta);

/** the titles a viewer may see: never a GM-only one (v) nor one of somebody hidden (the statistics' own rule, model.mjs) */
export function shown(rec, viewer) {
  const gm = viewer?.gm === true, pc = rec?.pc ?? {};
  return (Array.isArray(rec?.titles) ? rec.titles : []).filter((x) => x && TITLE_IDS.includes(x.id) && (gm || (!x.v && (!x.c || (pc[x.c] && !pc[x.c].hid)))));
}

/** One line of a title in words. t(key, params) = the statistics' strings (lang.mjs IPU.Awrd.*) */
export function why(x, t) {
  const n = pos(x?.n), d = x?.d ?? {};
  switch (x?.id) {
    case "mvp": {
      const parts = [d.dealt ? t("IPU.Awrd.part.dealt", { n: d.dealt }) : null, d.kills ? t("IPU.Awrd.part.kills", { n: d.kills }) : null, d.assists ? t("IPU.Awrd.part.assists", { n: d.assists }) : null,
        d.helps ? t("IPU.Awrd.part.helps", { n: d.helps }) : null, d.chal ? t("IPU.Awrd.part.chal", { n: d.chal }) : null].filter(Boolean).slice(0, 3);
      return parts.length ? parts.join(" · ") : t("IPU.Awrd.why.mvp", { n });
    }
    case "defender": return [d.armor ? t("IPU.Awrd.part.armor", { n: d.armor }) : null, d.blocks ? t("IPU.Awrd.part.blocks", { n: d.blocks }) : null].filter(Boolean).join(" · ") || t("IPU.Awrd.why.defender", { n });
    case "firefighter": return [d.chal ? t("IPU.Awrd.part.chalSixes", { n: d.chal }) : null, d.won ? t("IPU.Awrd.part.chalWon", { n: d.won }) : null, d.fire ? t("IPU.Awrd.part.fire", { n: d.fire }) : null].filter(Boolean).join(" · ") || t("IPU.Awrd.why.firefighter", { n });
    case "bag": return t(d.out ? "IPU.Awrd.why.bagDown" : "IPU.Awrd.why.bag", { n });
    default: return t(`IPU.Awrd.why.${x?.id}`, { n });
  }
}

/** The titles as a surface draws them (the end-of-fight card, the history). names(cid) -> { n, i, mine } (the viewer's own name and picture
    of a participant; the record's when the viewer has none). -> { state: "wait" | "small" | "none" | "ok", mvp: [items], list: [items] }
    item = { id, icon, name, why, who: { cid, n, i, mine } } */
export function cardOf(rec, viewer, t, names = () => null) {
  if (!rec) return { state: "wait", mvp: [], list: [] };
  if (!rec.tm) return { state: "wait", mvp: [], list: [] };
  if (rec.tm.small) return { state: "small", mvp: [], list: [] };
  const items = shown(rec, viewer).map((x) => {
    const p = rec.pc?.[x.c] ?? {}, nm = names(x.c) ?? {};
    return { id: x.id, icon: iconOf(x.id), name: t(`IPU.Awrd.t.${x.id}`), tip: t(`IPU.Awrd.tip.${x.id}`), why: why(x, t), who: { cid: x.c, n: nm.n ?? p.n ?? t("IPU.Stats.someone"), i: nm.i ?? p.i ?? null, mine: !!nm.mine } };
  });
  if (!items.length) return { state: "none", mvp: [], list: [] };
  return { state: "ok", mvp: items.filter((x) => x.id === "mvp"), list: items.filter((x) => x.id !== "mvp") };
}

/** The titles collected over many fights, per actor: recs = the fight records a viewer may list (pure.fightsFor), since = the oldest fight
    start to count (0: all). -> Map(actor id -> { <title id>: count }) */
export function collected(recs, viewer, since = 0) {
  const by = new Map();
  for (const rec of recs ?? []) {
    if (!rec || (rec.t0 ?? 0) < since) continue;
    for (const x of shown(rec, viewer)) {
      const a = x.a ?? rec.pc?.[x.c]?.a; if (!a) continue;
      if (!by.has(a)) by.set(a, {});
      const m = by.get(a); m[x.id] = (m[x.id] ?? 0) + 1;
    }
  }
  return by;
}
/** a count map of titles -> [{ id, icon, n }] in the titles' own order */
export const chipsOf = (m) => TITLES.filter((T) => (m?.[T.id] ?? 0) > 0).map((T) => ({ id: T.id, icon: T.icon, n: m[T.id] }));
