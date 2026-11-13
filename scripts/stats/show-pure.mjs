/* Plus Ultra STATISTICS, HOW THE TITLES AND THE NUMBERS ARE SHOWN (package POLS; pure, no Foundry globals, node-checked in
   scripts/tactics/check-pols.mjs). Nothing here counts or decides a winner: the titles are titles-pure's (award, cardOf, shown), the numbers
   pure.mjs's. This file only arranges them for the end-of-fight card (ui/dom.mjs awardsBody), the statistics window (app.mjs) and the
   history in it:
     U219  one entry per title: a title shared by a tie is ONE line (or one MVP banner) with every holder, not a row per holder
     U221  the reveal's clock: when each piece of the card comes, so a redraw in the middle of it carries on instead of starting again
     U222  the fight's card stands above an open window (the Statistics window covered it)
     U226  the K/D box in words, no ratio while there is no own defeat
     U227  the fights' rail grouped by session, older sessions folded */
import * as TP from "./titles-pure.mjs";

const SESSION_GAP = 4 * 3600 * 1000;      // pure.mjs SESSION_GAP (STAT-6): the same break of four hours ends a session

/* ------------------------------------------------------------------ U219: the titles grouped */
/** a list of names for one line: "A", "A & B", "A, B & C" */
export const joinNames = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`);

/** The titles as the card and the window draw them. Same input as titles-pure.cardOf (it is called here), plus the numbers each title was
    won with (to say a shared title in one line). -> { state, mvp: group | null, list: [group], count }
    group = { id, icon, name, tip, why, who: [{ cid, n, i, mine }], names, mine, shared, say } */
export function titlesView(rec, viewer, t, names = () => null) {
  const m = TP.cardOf(rec, viewer, t, names);
  if (m.state !== "ok") return { state: m.state, mvp: null, list: [], count: 0 };
  const num = new Map(TP.shown(rec, viewer).map((x) => [`${x.id}|${x.c}`, x.n]));
  const groups = [];
  for (const x of [...m.mvp, ...m.list]) {
    let g = groups.find((y) => y.id === x.id);
    if (!g) { g = { id: x.id, icon: x.icon, name: x.name, tip: x.tip, whys: [], who: [] }; groups.push(g); }
    if (!g.who.some((w) => w.cid === x.who.cid)) { g.who.push(x.who); g.whys.push(x.why); }
  }
  const out = groups.map(({ whys, ...g }) => {
    const same = whys.every((w) => w === whys[0]);
    /* a tie has the same number for every holder (titles-pure.award): when their lines differ, the title's own line with that number */
    const n = num.get(`${g.id}|${g.who[0].cid}`);
    const why = same || !Number.isFinite(n) ? whys[0] : TP.why({ id: g.id, n }, t);
    const nm = joinNames(g.who.map((w) => w.n));
    return { ...g, why, names: nm, mine: g.who.some((w) => w.mine), shared: g.who.length > 1, say: `${g.name}: ${nm}. ${why}` };
  });
  return { state: "ok", mvp: out.find((g) => g.id === "mvp") ?? null, list: out.filter((g) => g.id !== "mvp"), count: out.length };
}

/** a line split into words and numbers, so a number can stand out: "15 damage · 1 knockout" -> [["15", true], [" damage · ", false], ...] */
export function numParts(text) {
  const s = String(text ?? ""), out = [];
  let at = 0;
  for (const m of s.matchAll(/\d+(?:[.,]\d+)?/g)) { if (m.index > at) out.push([s.slice(at, m.index), false]); out.push([m[0], true]); at = m.index + m[0].length; }
  if (at < s.length) out.push([s.slice(at), false]);
  return out;
}

/* ------------------------------------------------------------------ U221: the reveal */
/** When each piece comes, in ms from the moment the titles arrived: the MVP's burst spins in, its plate is stamped, then the name and
    its line, then one title after the other. POLS-3: about two seconds for a usual fight. */
export const REVEAL = Object.freeze({ burst: 0, stamp: 260, name: 420, why: 520, row0: 820, step: 150, row: 420 });
/** how long the whole reveal of a card with `rows` lines under the MVP lasts (ms) */
export const revealMs = (rows, mvp = true) => (rows > 0 ? (mvp ? REVEAL.row0 : 120) + (rows - 1) * REVEAL.step + REVEAL.row : mvp ? REVEAL.why + 400 : 0);
/** the reveal at `elapsed` ms: whether it still runs (the card keeps its animation and carries on from there after a redraw) */
export const revealOn = (elapsed, rows, mvp = true) => Number.isFinite(elapsed) && elapsed >= 0 && elapsed < revealMs(rows, mvp) + 200;
/** U221: how the fight ended, as the card's line under its title says it: "scene" (the GM ended the scene), "stop" (the GM stopped the
    tactical fight), "gone" (its combat was deleted) -> a string key */
export const endKey = (how) => `IPU.Awrd.end.${["scene", "stop", "gone"].includes(how) ? how : "gone"}`;

/* ------------------------------------------------------------------ U222: which comes first */
/** The fight's card is the moment of the fight's end: while it stands it is above every window open at the time it came (the Statistics
    window, a sheet), one step over the highest. A window brought forward afterwards goes over it as usual (its own choice).
    -> the z-index for the dock, or null (no lift: a round's card, or no card) */
export const cardLift = (card, topZ) => (card?.kind === "fight" && Number.isFinite(topZ) ? Math.max(0, Math.trunc(topZ)) + 1 : null);

/* ------------------------------------------------------------------ U226: the K/D box in words */
/** kd = pure.kd -> { cells: [{ id, n, label }], ratio: string | null } (no ratio until the first own defeat: K/0 is not a ratio) */
export function kdView(kd, t) {
  const k = Math.max(0, Math.trunc(kd?.k ?? 0)), d = Math.max(0, Math.trunc(kd?.d ?? 0)), a = Math.max(0, Math.trunc(kd?.a ?? 0));
  return {
    cells: [{ id: "k", n: k, label: t("IPU.Stats.m.kills") }, { id: "d", n: d, label: t("IPU.Stats.m.deaths") }, { id: "a", n: a, label: t("IPU.Stats.m.assists") }],
    ratio: d > 0 ? t("IPU.Stats.kd.ratio", { r: (Math.round((k / d) * 10) / 10).toFixed(1) }) : null
  };
}

/* ------------------------------------------------------------------ U227: the fights' rail by session */
export const RAIL_CAP = 30;      // rows of one session drawn before "show more"
/** items = the rail's fights newest first ({ id, t0, sel, ... }). A session ends at a break of SESSION_GAP between two fights.
    open = Set of session keys the viewer opened; the newest session and the one holding the selected fight are always open.
    more = Set of session keys whose every fight is shown (else the first RAIL_CAP).
    -> [{ key, t0, n, open, items: [shown items], rest: number not shown }] */
export function railSessions(items, { open = new Set(), more = new Set(), gap = SESSION_GAP, cap = RAIL_CAP } = {}) {
  const groups = [];
  let cur = null, prev = null;
  for (const x of items ?? []) {
    const t0 = Number(x?.t0) || 0;
    if (!cur || (prev !== null && prev - t0 > gap)) { cur = { key: `s${t0}`, t0, all: [] }; groups.push(cur); }
    cur.all.push(x); prev = t0;
  }
  return groups.map((g, i) => {
    const on = i === 0 || open.has(g.key) || g.all.some((x) => x.sel);
    const all = more.has(g.key) ? g.all : g.all.slice(0, cap);
    /* the selected fight is always drawn, even past the cap */
    const sel = g.all.find((x) => x.sel);
    const shown = sel && !all.includes(sel) ? [...all, sel] : all;
    return { key: g.key, t0: g.all[g.all.length - 1] ? Number(g.all[g.all.length - 1].t0) || 0 : g.t0, n: g.all.length, open: on, items: on ? shown : [], rest: on ? g.all.length - shown.length : 0 };
  });
}
