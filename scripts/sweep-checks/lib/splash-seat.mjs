// SPLASHSAME: one seat of the table playing one roll splash in node, with the REAL engine's boxes (scripts/letters/testenv.mjs) behind a
// fake page (window, panels, canvas at this seat's zoom and pan, Dice So Nice absent). Used by sweep-checks/splashsame.mjs and by the per-seat
// plan logs (node scripts/sweep-checks/lib/splash-seat.mjs dump <out.json>). Not a suite itself (lib/ is not scanned by check-everything).
import * as SL from "../../splash/logic.mjs";
import * as Share from "../../splash/seat-share.mjs";

export const GS = 350;   // The Warehouse's grid
const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
export const ev = (rd) => SL.buildEvent({ newSixes: 0, rerolled: 0, pushed: false, stress: 0, action: "slugfest", ...rd }, { rng: seq([0.1, 0.5, 0.9, 0.3]), st: null, dryN: 0 });
/* every outcome of a roll (rank: what the ranks rule compares; full: the critical's full moment) */
export const OUTCOMES = () => ({
  routine: { e: ev({ n: 1, sixes: 0 }) },
  miss: { e: ev({ n: 12, sixes: 0 }) },
  ordinary: { e: ev({ n: 4, sixes: 1 }), rank: 1 },
  strong: { e: ev({ n: 5, sixes: 2 }), rank: 2 },
  critical: { e: ev({ n: 4, sixes: 4 }), rank: 3, full: true },
  pushed: { e: ev({ n: 5, sixes: 2, pushed: true, newSixes: 1, rerolled: 3, stress: 2 }) },
  stressed: { e: ev({ n: 6, sixes: 2, stress: 2 }) }
});

/* ---------------------------------------------------------------- the page: panels as elements (mapseat.mjs's) */
function fakeDom(W, H, ui = {}) {
  const cls = (self) => ({ add: (...c) => { const s = new Set(self.className.split(" ").filter(Boolean)); c.forEach((x) => s.add(x)); self.className = [...s].join(" "); }, remove: (...c) => { self.className = self.className.split(" ").filter((x) => x && !c.includes(x)).join(" "); }, contains: (c) => self.className.split(" ").includes(c) });
  const all = [];
  const mk = (tag) => {
    const e = { tag, children: [], parent: null, dataset: {}, attrs: {}, className: "", textContent: "", anims: [],
      style: { _p: {}, setProperty(k, v) { this._p[k] = v; }, getPropertyValue(k) { return this._p[k] ?? ""; }, removeProperty(k) { delete this._p[k]; } },
      get classList() { return cls(this); },
      setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { if (c.parent) c.remove(); c.parent = this; this.children.push(c); return c; }, append(...cs) { cs.forEach((c) => this.appendChild(c)); },
      insertBefore(c) { return this.appendChild(c); }, prepend(c) { return this.appendChild(c); },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; },
      get isConnected() { let p = this; while (p.parent) p = p.parent; return p === doc.body; },
      animate(k, o) { this.anims.push(o); return { onfinish: null, cancel() {}, finished: Promise.resolve() }; }, getAnimations: () => [], querySelectorAll() { return []; }, querySelector() { return null; },
      get clientWidth() { return parseFloat(this.style.width) || 0; },
      getBoundingClientRect() {
        if (this.className.includes("ins-badge")) return { left: 0, top: 0, width: 150, height: 60, right: 150, bottom: 60 };
        const w = parseFloat(this.style.width) || 0, h = w * 0.6, cx = parseFloat(this.style.left) || W / 2, cy = parseFloat(this.style.top) || H / 2;
        return { left: cx - w / 2, top: cy - h / 2, width: w, height: h, right: cx + w / 2, bottom: cy + h / 2 };
      } };
    all.push(e);   // SPLASHCLEAR: every element the stage made (its gauges are gone from the page once the moment ended)
    return e;
  };
  const R = (l, t, w, h) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h });
  const side = ui.side ?? 300;
  /* measured live (lane 5, 1600 x 900): the GM's map meter, his scene list, the challenges' panel, the party cards, his desk, a chat card */
  const rects = {
    "#sidebar": R(W - side, 0, side, H),
    "#hotbar": R(W * 0.3, H - 66, 560, 58),
    "#scene-controls": R(16, 16, 72, H - 260),
    /* (SPLASHSEAT: ui.ghosts = rows of the scene list that are in the page but not drawn, as the GM's folded list has them live) */
    ...(ui.nav ? { "#scene-navigation li": ui.ghosts ? [R(104, 16, 170, ui.nav), ...Array.from({ length: ui.ghosts }, (_, i) => ({ ...R(104, 144 + i * 40, 170, 32), hidden: true }))] : R(104, 16, 170, ui.nav) } : {}),
    ...(ui.vram ? { ".mm-vram": R(96, 92, 264, 52) } : {}),
    ...(ui.dock ? { "#ich-dock": R(W - side - 312, 48, 310, 233) } : {}),
    ...(ui.party ? { "#invincible-party li": [R(96, H - 400, 230, 70), R(96, H - 325, 230, 70)] } : {}),
    ...(ui.card ? { "#chat-notifications .chat-log > li": R(W - side - 310, H * 0.35, 300, 260) } : {}),
    /* SPLASHSEAT: the column the chat cards pop up in (measured live, lane 8, 1600 x 900, the sidebar folded: 1236..1536 x 16..886) and the
       GM's director bar (418..862 x 784..816) */
    ...(ui.col ? { "#chat-notifications": R(W - side - 316, 16, 300, H - 30) } : {}),
    ...(ui.pill ? { "#mm-dir-bar": R(W * 0.26, H - 116, 444, 32) } : {}),
    ...(ui.desk ? { "#invincible-tactics-desk:not(.igd-collapsed) .igd": R(...ui.desk) } : {})
  };
  const els = {};
  /* SPLASHCLEAR: a panel remembers whether it ever stepped back (ins-yield) during the moment (the stage takes the class off at its end) */
  const el = (sel, r, i) => (els[sel + i] ??= { sel, className: "", yielded: false, getBoundingClientRect: () => r, checkVisibility: () => !r.hidden,
    get classList() { const c = cls(this), self = this; return { ...c, add: (...x) => { if (x.includes("ins-yield")) self.yielded = true; c.add(...x); } }; } });
  const doc = { all, body: mk("body"), createElement: mk, createTextNode: (t) => ({ textContent: t }), createElementNS: (_, t) => mk(t), els, rects,
    getElementById: (id) => (id === "sidebar" ? { getBoundingClientRect: () => rects["#sidebar"], offsetWidth: side } : null),
    querySelector: () => null, querySelectorAll: (s) => { const r = rects[s]; return r ? (Array.isArray(r) ? r : [r]).map((q, i) => el(s, q, i)) : []; } };
  globalThis.getComputedStyle = (e) => ({ zIndex: e.style?.zIndex ?? "auto", display: "block", visibility: "visible", opacity: "1" });
  /* SPLASHSEAT: this seat's open windows (ui.wins: [[l, t, w, h, class?]]), as Foundry's registry of applications has them */
  const wins = (ui.wins ?? []).map(([l, t, w, h, c]) => ({ rendered: true, minimized: false, hasFrame: true, options: { window: { frame: true } },
    element: { classList: { contains: (x) => x === (c ?? "sheet") }, getBoundingClientRect: () => R(l, t, w, h) } }));
  globalThis.foundry = { applications: { instances: new Map(wins.map((a, i) => [i, a])) } };
  return doc;
}

/* ---------------------------------------------------------------- the engine: the real one's plans, sizes and footprints */
let REAL = null;
export async function realEngine() {
  if (REAL) return REAL;
  const { setup } = await import("../../letters/testenv.mjs");
  REAL = (await setup()).engine;
  REAL.lookStyle?.("invincible");   // the style the table letters in (game.system.id "invincible")
  return REAL;
}
const planCache = new Map(), measCache = new Map();
const clean = (op) => ({ ...op, space: "screen", at: undefined, token: undefined, parent: undefined, layer: undefined, avoid: [], startAt: undefined, keepInView: undefined });
const keyOf = (text, op) => JSON.stringify([text, op.mood, op.kind, op.sound, op.seed, op.hand, op.look, op.rotation, op.from, op.in, op.holdKind, op.out, op.magnitude, op.colors, op.reduced, op.flash, op.fit, op.size, op.view]);
function planOf(text, op) {
  const k = keyOf(text, op);
  if (!planCache.has(k)) { const q = REAL._plan(text, clean(op)); REAL._settle?.(q); planCache.set(k, q); }
  return planCache.get(k);
}
/* CAPSTAR: cut = an engine with the impact's cut-in (1.9.23 limits, stepOf): the stage then keeps its blocks off the star's cut-in (no `play`:
   nothing else of the impact runs here) */
const STEP_AT = [0.35, 0.6, 0.85, 1.35, 1.7];
/* SAKUGATOKEN: cut = "fig" = an engine that draws its figures at their tokens' own size and says so (1.9.27 LIMITS.figScale = 1) */
const cutImpact = (cut) => ({ limits: { cutMax: 0.44, maxTicks: 24, ...(cut === "fig" ? { figScale: 1 } : {}) }, stepOf: (m) => STEP_AT.filter((b) => m >= b).length });
function fakeEngine(k = 1, cut = false) {
  const calls = []; let i = 0;
  return { calls, prefs: { enabled: true, scale: k }, ...(cut ? { impact: cutImpact(cut) } : {}),
    planFor: (text, op) => ({ plan: planOf(text, op), opts: op }),
    measure: (text, op) => { const key = keyOf(text, op) + (op.space ?? ""); if (!measCache.has(key)) measCache.set(key, REAL.measure(text, clean(op))); return measCache.get(key); },
    design: (text, op) => ({ sizeK: planOf(text, op).sizeK }),
    play(text, op) { const h = { id: "h" + ++i, hand: `hand-${op.seed ?? i}`, alive: true, stop() { h.alive = false; }, moveTo() {}, ready: Promise.resolve(true), finished: new Promise(() => {}) }; calls.push({ text, o: op, h }); return h; } };
}

/* ---------------------------------------------------------------- the boards (scene px; one square = GS) */
const tok = (id, x, y, o = {}) => ({ id, name: id, visible: !o.hidden, document: { id, x, y, width: 1, height: 1, hidden: !!o.hidden, texture: { scaleX: 1, scaleY: 1 } },
  x, y, w: GS, h: GS, center: { x: x + GS / 2, y: y + GS / 2 } });
const note = (id, x, y) => ({ id, visible: true, document: { id, x, y, iconSize: 40 } });
/* empty: the roller and his target alone; warehouse: The Warehouse as it stands on lane 5 (2026-11-15, squares from Omni-Man at 2100,350);
   crowd: neighbours and a pin pressed round the two (mapseat.mjs's) */
export const BOARDS = {
  empty: { at: [2800, 1700], nb: [], pin: null, tgt: [1.3, 0.2] },
  warehouse: { at: [2100, 350], nb: [[0, 1], [1, 3], [3, 3], [5, 5], [3, 2], [7, 5], [7, 6], [-4, 2], [1, 0]], pin: null, tgt: [0, 3] },
  crowd: { at: [2800, 1700], nb: [[-1.2, -1.1], [0.3, 1.4], [1.1, 1.3], [-1.3, 0.4]], pin: [1.1, -1.2], tgt: [1.3, 0.2] },
  /* SPLASHCLEAR: The Warehouse as the world stands (prep WORLD-STATE: the Concussion Turret at 3150,1050 HIDDEN) with the map's zone badges
     shown to every seat at their label points (read off the live view, ADVS2 A-crit) */
  live: { at: [2100, 350], nb: [[0, 1], [1, 3], [3, 3], [5, 5], [3, 2, "hidden"], [7, 5], [7, 6], [-4, 2], [1, 0]], pin: null, tgt: [0, 3],
    badges: [[2055, 195], [3400, 195], [2035, 1565], [2995, 1245]] }
};
export function board(kind) {
  const B = BOARDS[kind], [hx, hy] = B.at, tg = B.tgt;
  const hero = tok("HEROaaaaaaaaaaaa", hx, hy), target = tok("TARGETaaaaaaaaaa", hx + tg[0] * GS, hy + tg[1] * GS);
  return { hero, target, tokens: [hero, target, ...B.nb.map(([dx, dy, h], i) => tok((h ? "HID" : "NB") + i, hx + dx * GS, hy + dy * GS, { hidden: h === "hidden" }))], notes: B.pin ? [note("PIN", hx + B.pin[0] * GS, hy + B.pin[1] * GS)] : [],
    badges: (B.badges ?? []).map(([x, y], i) => ({ id: "z" + (i + 1), label: { x, y, r: 60 } })) };
}

/* the table's seats: the GM with his usual panels (sidebar closed, long scene list, map meter, challenges, party cards, a chat card, engine
   Scale 1.3), Test Gracz 1 (1366 x 768, sidebar open, closer zoom), a 1000 x 620 seat (under Foundry's minimum), a big reduced-motion seat */
export const SEATS = {
  gm: { name: "gm", gm: true, k: 1.3, W: 1600, H: 900, zoom: 0.5, ui: { side: 48, nav: 160, vram: true, dock: true, party: true, card: true } },
  p1: { name: "p1", W: 1366, H: 768, zoom: 0.8, ui: { side: 300, nav: 32, party: true } },
  p1r: { name: "p1r", W: 1366, H: 768, zoom: 0.8, reduced: true, ui: { side: 300, nav: 32, party: true } },
  gmr: { name: "gmr", gm: true, k: 1.3, W: 1600, H: 900, zoom: 0.5, reduced: true, ui: { side: 48, nav: 160, vram: true, dock: true, party: true, card: true } },
  small: { name: "small", W: 1000, H: 620, zoom: 0.6, ui: { side: 300, party: true } },
  big: { name: "big", W: 1920, H: 1080, zoom: 0.4, reduced: true, ui: { side: 300, party: true } },
  far: { name: "far", W: 1600, H: 900, zoom: 0.25, ui: { side: 300, party: true } }
};

let runN = 0;
/* one seat playing one roll: every lettering it drew, in this seat's client px (box, cap px), and where the roller stands on its screen.
   o: { seat, layer, outcome, bd, off (view centre from the roller, squares), seedTag,
        parked (SPLASHBLOCK: the action camera's shot { x, y, scale } as moinen-maps' director reports it while it is away from home),
        probe (SPLASHBLOCK: called with { Stage, ctl, toClient, board } once the moment has landed (the timers up to probeAt ms, 1500 by
        default, have run) and before it ends; its value -> res.probe) } */
export async function seatPlay(o) {
  await realEngine();
  const s = typeof o.seat === "string" ? SEATS[o.seat] : o.seat;
  const { W, H, ui = {}, zoom, gm = false, k = 1, reduced = false } = s;
  const out = OUTCOMES()[o.outcome];
  globalThis.document = fakeDom(W, H, ui);
  globalThis.window = { innerWidth: W, innerHeight: H, matchMedia: () => ({ matches: reduced }) };
  const timers = [], st = globalThis.setTimeout, ct = globalThis.clearTimeout;
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  globalThis.clearTimeout = () => {};
  try {
    const Stage = await import(`../../splash/stage.mjs?splashsame-${++runN}`);
    const S = await import("../../splash/splash.mjs");
    S.setReduced(reduced);
    const b = board(o.bd ?? "empty"), off = o.off ?? { x: 0.4, y: 0.2 };
    const center = { x: b.hero.center.x + off.x * GS, y: b.hero.center.y + off.y * GS };
    const pan = { x: W / 2 - center.x * zoom, y: H / 2 - center.y * zoom };
    const toClient = (q) => ({ x: q.x * zoom + pan.x, y: q.y * zoom + pan.y });
    globalThis.canvas = { ready: true, grid: { size: GS }, dimensions: { size: GS, sceneRect: { x: 0, y: 0, width: 7000, height: 4200 } },
      stage: { scale: { x: zoom }, pivot: { x: center.x, y: center.y }, position: { x: W / 2, y: H / 2 }, toLocal: (q) => ({ x: (q.x - pan.x) / zoom, y: (q.y - pan.y) / zoom }), toGlobal: toClient },
      app: { view: { getBoundingClientRect: () => ({ left: 0, top: 0 }) }, screen: { width: W, height: H } },
      tokens: { placeables: b.tokens, get: (id) => b.tokens.find((t) => t.id === id) }, notes: { placeables: b.notes } };
    /* o.badgePlace "corner": the comic looks' default (the live Warehouse), the point from the public geometry (here: up-left of the label) */
    const corner = (q) => ({ x: q.label.x - 0.4 * GS, y: q.label.y - 0.3 * GS });
    const zapi = { zones: () => ({ zones: b.badges }), look: () => ({ numbers: "always", place: o.badgePlace ?? "center", who: o.badgeWho ?? "all" }), geometry: { cornerPoint: corner } };
    globalThis.game = { user: { isGM: gm }, modules: { get: (id) => (id === "moinen-maps" && (b.badges.length || o.parked) ? { active: true, api: { ...(b.badges.length ? { zones: zapi } : {}), ...(o.parked ? { directorStage: { status: () => ({ home: { x: center.x, y: center.y, scale: zoom }, parked: o.parked }) } } : {}) } } : null) } };
    const L = fakeEngine(k, o.cut === "fig" ? "fig" : !!o.cut); Stage.setLetters(L); Stage.setLayer(o.layer ?? "screen");
    const tag = o.seedTag ?? `${o.bd ?? "empty"}-${o.outcome}`;
    /* SPLASHSEAT: o.told = { user id: report } (seatTell): the table's lists for this roll, as main.mjs would have heard them */
    const shareId = o.told ? "SH-" + runN : null;
    if (shareId) for (const [u, r] of Object.entries(o.told)) Share.note(shareId, u, r);
    const po = { token: b.hero, scale: o.scale ?? 1, hold: 1, fx: 1, fullFrom: out.full ? 0.7 : null, seed: "SS-" + tag, resolve: () => ({ now: 5, max: 8 }), targets: [b.target.id], from: b.hero, at: 0, ...(o.probe ? { momentId: "SB-" + runN } : {}), ...(shareId ? { shareId } : {}) };
    /* CRITFREEZE: o.before({ Stage, e, opts, board }) runs before the play (a layout ahead, as main.mjs prepareAhead makes it) */
    if (o.before) o.before({ Stage, e: out.e, opts: po, board: b });
    const ctl = Stage.play(out.e, po);
    let t, probed;
    if (o.probe) { while ((t = timers.filter((x) => !x.done && x.ms <= (o.probeAt ?? 1500)).sort((a, b2) => a.ms - b2.ms)[0])) { t.done = true; t.fn(); } probed = o.probe({ Stage, ctl, toClient, board: b }); }
    while ((t = timers.filter((x) => !x.done).sort((a, b2) => a.ms - b2.ms)[0])) { t.done = true; t.fn(); }
    const box = (tk) => { const a = toClient({ x: tk.document.x, y: tk.document.y }); return { l: a.x, t: a.y, r: a.x + GS * zoom, b: a.y + GS * zoom }; };
    const drawn = L.calls.filter((c) => c.o.seed?.startsWith("SS-")).map((c) => {
      const lp = planOf(c.text, { ...c.o, reduced: false }), world = c.o.space === "world", px = world ? zoom : 1;
      const Sz = c.o.size * lp.sizeK * k, at = world ? toClient(c.o.at) : c.o.at;
      const w = lp._holdBox.w * Sz * px, h = lp._holdBox.h * Sz * px;
      return { role: c.o.seed.split(":").pop(), text: c.text, world, layer: c.o.layer ?? (world ? "world" : "screen"), S: Math.round(Sz * px * 10) / 10, x: at.x, y: at.y, w, h,
        l: at.x - w / 2, t: at.y - h / 2, r: at.x + w / 2, b: at.y + h / 2, size: c.o.size, at: c.o.at, startAt: c.o.startAt, reduced: !!c.o.reduced };
    });
    const res = { star: ctl?.star ? { id: ctl.star.tok.id, step: ctl.star.step, fig: ctl.star.fig ?? null } : null, seat: s.name, W, H, zoom, layer: o.layer ?? "screen", outcome: o.outcome, bd: o.bd ?? "empty", drawn, rule: ctl?.seatRule ?? null, same: Stage.sameLog().at(-1) ?? null,
      hero: box(b.hero), target: box(b.target), others: b.tokens.filter((x) => !/^(HERO|TARGET|HID)/.test(x.id)).map(box), hidden: b.tokens.filter((x) => /^HID/.test(x.id)).map(box),
      /* SPLASHCLEAR: the zone badges as moinen-maps draws them (radius min(19, max(8, 0.8 r zoom)) CSS px, a shaped badge up to 1.2 of that) */
      badges: b.badges.map((q) => { const c = toClient(o.badgePlace === "corner" ? corner(q) : q.label), rr = Math.min(19, Math.max(8, 0.8 * q.label.r * zoom)) * 1.2; return { l: c.x - rr, t: c.y - rr, r: c.x + rr, b: c.y + rr }; }),
      gauges: gaugesOf(document.all), pins: b.notes.map((n) => { const q = toClient({ x: n.document.x, y: n.document.y }); return { x: q.x, y: q.y }; }),
      stats: { ...Stage.layoutStats }, steps: Stage.stepStats ? { ...Stage.stepStats } : null,
      ui: Object.fromEntries(Object.entries(document.rects).map(([kk, v]) => [kk, v])), yielded: [...new Set(Object.values(document.els).filter((e) => e.yielded).map((e) => e.sel))] };
    if (o.probe) res.probe = probed;
    Stage.clearAll(); Stage.setLayer("screen"); S.setReduced(false);
    if (shareId) Share.forget(shareId);
    return res;
  } finally { globalThis.setTimeout = st; globalThis.clearTimeout = ct; delete globalThis.canvas; delete globalThis.game; delete globalThis.foundry; }
}

/* SPLASHSEAT: what one seat tells the table when a roll arrives (stage.mjs seatReport), from its page alone */
export async function seatTell(seat) {
  const s = typeof seat === "string" ? SEATS[seat] : seat;
  globalThis.document = fakeDom(s.W, s.H, s.ui ?? {});
  globalThis.window = { innerWidth: s.W, innerHeight: s.H, matchMedia: () => ({ matches: !!s.reduced }) };
  const Stage = await import(`../../splash/stage.mjs?splashsame-${++runN}`);
  return Stage.seatReport();
}
/* SPLASHCLEAR: the Resolve gauges the stage put on the page (fake box 150 x 60 at its left / top, scaled), client px */
function gaugesOf(all = []) {
  const out = [];
  for (const c of all) if (String(c.className).includes("ins-badge") && c.style?.left) { const k = parseFloat(c.style.scale) || 1, l = parseFloat(c.style.left), t = parseFloat(c.style.top); out.push({ l, t, r: l + 150 * k, b: t + 60 * k }); }
  return out;
}
/* the per-seat plan log: every L.play a seat makes for fixed seeds (text, size, place, layer), over seats x layers x boards x outcomes */
export async function planLog(seats = Object.keys(SEATS), layers = ["screen", "overlay"], boards = Object.keys(BOARDS), outcomes = Object.keys(OUTCOMES())) {
  const rows = [];
  for (const layer of layers) for (const bd of boards) for (const outcome of outcomes) for (const seat of seats) {
    const r = await seatPlay({ seat, layer, bd, outcome });
    for (const d of r.drawn) rows.push([seat, layer, bd, outcome, d.role, d.text, d.layer, Math.round(d.size * 100) / 100, Array.isArray(d.at) ? d.at : [Math.round(d.at.x), Math.round(d.at.y)], d.S].join(" "));
    if (!r.drawn.length) rows.push([seat, layer, bd, outcome, "(none)"].join(" "));
  }
  return rows;
}

if (process.argv[2] === "dump") {
  const fs = await import("node:fs");
  const rows = await planLog();
  fs.writeFileSync(process.argv[3], rows.join("\n") + "\n");
  console.log(`dumped ${rows.length} rows to ${process.argv[3]}`);
  process.exit(0);
}
