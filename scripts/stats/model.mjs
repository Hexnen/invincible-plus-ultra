/* Plus Ultra STATISTICS, the window's model (pure, node-tested). From what the store holds and who is looking, it says what the window
   draws: the rail (characters, players or fights), the open entry and its numbers in three columns (tactical, loose, together).
   It never decides a permission of its own: pure.visible and pure.fightSummary do; here only "who is listed":
     GM      every character with a counted fact (heroes or NPCs, a switch), every player, every fight;
     player  the player characters (any player's: the party), every player, the fights with somebody the table saw (STAT-3, STAT-4).
   names = { attr(id), action(id), stunt(id), out(id), user(id) -> name, t(key, params), attrs(actor id) -> { fighting.. } | null (RADR) }. */
import * as P from "./pure.mjs";
import * as TP from "./titles-pure.mjs";
import { ATTRS } from "../i18n/terms.mjs";

export const TABS = Object.freeze(["chars", "players", "fights"]);
const LOOSE_NA = new Set(["acts", "rx", "stunts", "counters", "armor", "blocked", "dodged", "missedMe", "minions", "assists", "crits", "chal", "fights"]);
const CORE = new Set(["rolls", "attacks", "dealt", "taken", "kills", "deaths"]);
/* the groups and their rows: id -> how a cell reads a sum */
const GROUPS = [
  ["rolls", [["rolls", (s) => s.rolls], ["sixes", (s) => s.sixes, (s) => (s.dice ? `${s.sixes}/${s.dice}` : "0")], ["okRolls", (s) => s.okRolls, (s) => (s.rolls ? `${s.okRolls} · ${P.pct(s.okRolls, s.rolls)}%` : "0")], ["pushes", (s) => s.pushes]]],
  ["combat", [["attacks", (s) => s.attacks, (s) => (s.attacks ? `${s.hits}/${s.attacks}` : "0")], ["misses", (s) => s.misses], ["acts", (s) => s.acts], ["rx", (s) => s.rx], ["stunts", (s) => s.stunts], ["counters", (s) => s.counters]]],
  ["damage", [["dealt", (s) => s.dealt], ["taken", (s) => s.taken], ["armor", (s) => s.armor], ["blocked", (s) => s.blocked], ["dodged", (s) => s.dodged], ["missedMe", (s) => s.missedMe], ["stressIn", (s) => s.stressIn], ["stressOut", (s) => s.stressOut]]],
  ["out", [["kills", (s) => s.kills], ["minions", (s) => s.minions], ["deaths", (s) => s.deaths], ["assists", (s) => s.assists], ["crits", (s) => s.critsDealt + s.critsTaken, (s) => `${s.critsDealt}/${s.critsTaken}`], ["chal", (s) => s.chalSixes + s.chalWon, (s) => (s.chalWon ? `${s.chalSixes} (${s.chalWon})` : String(s.chalSixes))], ["fights", (s) => s.fights]]]
];

/** the numbers of one entry (a character or a player): { t, l, s } sums -> groups of rows with three cells (null = not counted there) */
export function groupsOf(t, l, names) {
  const s = P.sum(t, l), tt = names.t;
  return GROUPS.map(([gid, rows]) => ({
    id: gid, title: tt(`IPU.Stats.g.${gid}`),
    rows: rows.map(([id, val, fmt]) => {
      const cell = (x, mode) => (mode === "l" && LOOSE_NA.has(id) ? null : (fmt ? fmt(x) : String(val(x))));
      const any = val(t) > 0 || val(l) > 0;
      return { id, label: tt(`IPU.Stats.m.${id}`), tip: tt(`IPU.Stats.m.${id}.tip`), cells: [cell(t, "t"), cell(l, "l"), id === "fights" ? cell(t, "t") : cell(s, "s")], any };
    }).filter((r) => r.any || CORE.has(r.id))
  })).filter((g) => g.rows.length);
}
/** the chips "what was rolled / which actions / which stunts" of a sum */
export function chipsOf(s, names) {
  const tt = names.t;
  const attrs = P.top(s.attrs, 5).map(([k, n]) => ({ label: k.startsWith("a:") ? names.attr(k.slice(2)) : k.slice(2), n }));
  const acts = P.top(s.actions, 5).map(([k, n]) => ({ label: k.startsWith("rx:") ? tt("IPU.Stats.rx", { name: names.action(k.slice(3)) }) : names.action(k), n }));
  const stunts = P.top(s.stuntsBy, 4).map(([k, n]) => ({ label: names.stunt(k), n }));
  return [["attrs", attrs], ["actions", acts], ["stunts", stunts]].filter(([, items]) => items.length).map(([id, items]) => ({ id, title: tt(`IPU.Stats.chips.${id}`), items }));
}

/* RADR: the attribute radar ("spider") of a character: its six attributes as they are NOW on the sheet (names.attrs(aid) reads the live
   actor; the store keeps no attribute history). Only for a character this viewer already has on the rail (the same boundary as every
   other number here), never for a challenge or a vehicle (their attributes are not a profile). One scale for the whole rail, so two
   radars compare by eye: 0 at the centre, the top ring = the highest value on the rail, at least RADAR_MIN (RADR-2). */
export const RADAR_MIN = 6;
const NO_RADAR = new Set(["challenge", "vehicle"]);
/** six finite numbers >= 0 in ATTRS order, or null */
export function attrValues(o) {
  if (!o || typeof o !== "object") return null;
  const v = ATTRS.map((k) => Number(o[k]));
  return v.every((x) => Number.isFinite(x)) ? v.map((x) => Math.max(0, Math.round(x))) : null;
}
/** the scale's top for a list of value rows: the largest value, at least RADAR_MIN, rounded up to even (rings every 2) */
export const radarTop = (rows) => { const m = Math.max(RADAR_MIN, ...rows.flat().filter(Number.isFinite)); return m + (m % 2); };
/** what the window draws: { top, axes: [{ id, label, v }] } or null */
export function radarOf(values, top, names) {
  if (!values) return null;
  return { top, axes: ATTRS.map((id, i) => ({ id, label: names.attr(id), v: values[i] })) };
}
/** the geometry (pure, for the SVG and the checks): axis i at angle -90deg + i*60deg, clockwise from the top, value v at v/top of r */
export function radarPoint(i, v, top, r, cx = 0, cy = 0) {
  const a = (-90 + (360 / ATTRS.length) * i) * Math.PI / 180, k = top > 0 ? Math.min(1, Math.max(0, v / top)) : 0;
  return [Math.round((cx + Math.cos(a) * r * k) * 100) / 100, Math.round((cy + Math.sin(a) * r * k) * 100) / 100];
}

/** a player character in the registry? (h:1, or any non-GM owner) */
const isHero = (rec) => !!rec && (rec.h === 1 || (Array.isArray(rec.own) && rec.own.length > 0));

/** the whole model. data = store.all(); ui = { tab, period, side, sel } */
export function view(data, viewer, ui, names) {
  const tt = names.t, gm = viewer?.gm === true;
  const tab = TABS.includes(ui?.tab) ? ui.tab : "chars", period = ui?.period === "all" ? "all" : "session", side = gm && ui?.side === "n" ? "n" : "h";
  const actors = data?.actors ?? {}, factsAll = data?.facts ?? [];
  const base = { tab, period, side, gm, tabs: TABS.map((id) => ({ id, label: tt(`IPU.Stats.tab.${id}`), on: id === tab })), empty: null, rail: [], detail: null };
  if (!factsAll.length && tab !== "fights") return { ...base, empty: tt("IPU.Stats.none") };
  if (tab === "fights") return fightsView(base, data, viewer, ui, names);
  const facts = P.inPeriod(factsAll, period);
  const sides = (aid) => (actors[aid] ? (isHero(actors[aid]) ? "h" : "n") : null);
  const sums = P.tally(facts, { viewer, sides });
  /* AWRD: the titles each character collected in the fights this viewer may list, in the same period */
  const won = TP.collected(P.fightsFor(data?.fights ?? {}, factsAll, viewer), viewer, period === "session" ? P.sessionStart(factsAll) : 0);
  const titlesOf = (ids) => { const m = {}; for (const a of ids) for (const [k, n] of Object.entries(won.get(a) ?? {})) m[k] = (m[k] ?? 0) + n; return TP.chipsOf(m).map((x) => ({ ...x, label: tt(`IPU.Awrd.t.${x.id}`), tip: tt(`IPU.Awrd.tip.${x.id}`) })); };
  if (tab === "chars") {
    const ids = [...sums.keys()].filter((aid) => actors[aid] && (gm ? (side === "h" ? isHero(actors[aid]) : !isHero(actors[aid])) : isHero(actors[aid])));
    const rail = ids.map((aid) => { const r = sums.get(aid), s = P.sum(r.t, r.l); return { id: aid, name: actors[aid].n, img: actors[aid].i || null, kd: P.kd(s), weight: s.rolls + s.attacks + s.dealt + s.taken }; })
      .filter((x) => x.weight > 0 || x.kd.k + x.kd.d > 0)
      .sort((a, b) => b.weight - a.weight || String(a.name).localeCompare(String(b.name)));
    if (!rail.length) return { ...base, empty: tt("IPU.Stats.noneHere") };
    const sel = rail.find((x) => x.id === ui?.sel) ?? rail[0];
    for (const x of rail) x.sel = x.id === sel.id;
    const r = sums.get(sel.id), s = P.sum(r.t, r.l), rec = actors[sel.id];
    const who = (rec.own ?? []).map((u) => names.user(u)).filter(Boolean);
    /* RADR: read only the rail's characters (what this viewer may list); the scale spans them all */
    const vals = new Map(rail.filter((x) => !NO_RADAR.has(actors[x.id]?.ty)).map((x) => [x.id, attrValues(names.attrs?.(x.id))]).filter(([, v]) => v));
    const radar = radarOf(vals.get(sel.id) ?? null, radarTop([...vals.values()]), names);
    return { ...base, rail, detail: { id: sel.id, name: rec.n, img: rec.i || null, sub: who.join(", "), kd: P.kd(s), titles: titlesOf([sel.id]), radar, groups: groupsOf(r.t, r.l, names), chips: chipsOf(s, names) } };
  }
  /* players: the sum of the characters each one owns (STAT-5) */
  const players = names.players();      // [{ id, name, avatar }]
  const rail = [];
  for (const u of players) {
    const chars = Object.entries(actors).filter(([, rec]) => (rec.own ?? []).includes(u.id)).map(([aid]) => aid);
    let t = P.blank(), l = P.blank();
    for (const aid of chars) { const r = sums.get(aid); if (r) { t = P.sum(t, r.t); l = P.sum(l, r.l); } }
    t.fights = new Set(facts.filter((x) => x.m === "t" && x.f && (chars.includes(x.a) || chars.includes(x.o)) && P.visible(x, viewer)).map((x) => x.f)).size;
    const s = P.sum(t, l);
    rail.push({ id: u.id, name: u.name, img: u.avatar ?? null, kd: P.kd(s), weight: s.rolls + s.attacks + s.dealt + s.taken, chars, t, l });
  }
  const shown = rail.filter((x) => x.chars.length).sort((a, b) => b.weight - a.weight || String(a.name).localeCompare(String(b.name)));
  if (!shown.length) return { ...base, empty: tt("IPU.Stats.players.none") };
  const sel = shown.find((x) => x.id === ui?.sel) ?? shown[0];
  for (const x of shown) x.sel = x.id === sel.id;
  const s = P.sum(sel.t, sel.l);
  return { ...base, rail: shown.map(({ chars, t, l, ...x }) => x), detail: { id: sel.id, name: sel.name, img: sel.img, sub: tt("IPU.Stats.players.chars", { list: sel.chars.map((a) => actors[a]?.n).filter(Boolean).join(", ") }), kd: P.kd(s), titles: titlesOf(sel.chars), groups: groupsOf(sel.t, sel.l, names), chips: chipsOf(s, names) } };
}

function fightsView(base, data, viewer, ui, names) {
  const tt = names.t, list = P.fightsFor(data?.fights ?? {}, data?.facts ?? [], viewer);
  if (!list.length) return { ...base, empty: tt("IPU.Stats.fight.none") };
  const rail = list.map((r) => ({ id: r.f, t0: r.t0 ?? 0, name: r.sc || "—", when: names.when(r.t0), sub: [r.t1 ? tt("IPU.Stats.fight.rounds", { n: Math.max(1, r.r ?? 0) }) : tt("IPU.Stats.fight.open"), r.chase ? tt("IPU.Stats.fight.chase") : null].filter(Boolean).join(" · "), open: !r.t1 }));      // POLS (U227): t0 groups the rail by session
  const sel = rail.find((x) => x.id === ui?.sel) ?? rail[0];
  for (const x of rail) x.sel = x.id === sel.id;
  const rec = list.find((r) => r.f === sel.id);
  const rows = P.fightSummary(rec, data?.facts ?? [], viewer).map((r) => ({ ...r, outLabel: r.out ? names.out(r.out) : null }));
  /* TITLES: what the next package writes into rec.titles, filtered here like everything else: a GM-only title (v:1) and a title of somebody a
     player may not see never reach a player's model */
  const seenIds = new Set(Object.entries(rec.pc ?? {}).filter(([, p]) => viewer?.gm || !p.hid).map(([cid]) => cid));
  const titles = (Array.isArray(rec.titles) ? rec.titles : []).filter((x) => x && (viewer?.gm || (!x.v && (!x.c || seenIds.has(x.c)))));
  return { ...base, rail, detail: { id: rec.f, name: rec.sc || "—", when: sel.when, sub: sel.sub, open: !rec.t1, rows, titles, rec: viewer?.gm ? rec : { ...rec, pc: Object.fromEntries(Object.entries(rec.pc ?? {}).filter(([, p]) => !p.hid)), titles } } };
}
