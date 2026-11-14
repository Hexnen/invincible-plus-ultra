/* node scripts/sweep-checks/rolltarget.mjs -- ROLLTARGET (2026-11-14): WHERE a roll's impact frame lands. The owner, asked (the result word,
   the roller, or the attack's target?), answered «cel»: the TARGET. Checked here:
     R  where the target comes from: a tactical attack -> the tokens the exchange hit (sorted, the same on every seat); another tactical roll
        (a defence) -> none; outside the tactics -> the roller's Foundry targets of a blow (flagged at the roll, GM-hidden ones left out);
     L  the impact lands ON the target token (its subject, the blow coming from the roller), on the word's contact like before, on the screen
        layers and on a map layer (there with the map's drawings and the word kept readable);
     V  privacy (ADVI 10): a target THIS seat cannot see (vision, hidden) is never handed in: the seat marks the result word instead, at the same
        instant; the GM and the players strike on the same tick of the same word;
     Q  the provisional rules (combat-questions ROLLTARGET-1..3): no target -> the word; several -> the first; off this view -> the word.
   The page, the canvas and the engine are fakes (as fxi-splash.mjs); the impact's plan is the real one (scripts/letters/impact/plan.mjs). */
import fs from "node:fs";
import { ok, eq, done, summary } from "../tactics/testkit.mjs";
import * as SL from "../splash/logic.mjs";
import * as IP from "../splash/impact-plan.mjs";
import { planImpact } from "../letters/impact/plan.mjs";
import { impBlow } from "./align-imp.mjs";
import * as Moment from "../moment.mjs";

const src = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const ev = (rd, rng = seq([0.1, 0.5, 0.9, 0.3])) => SL.buildEvent({ newSixes: 0, rerolled: 0, pushed: false, stress: 0, action: "slugfest", ...rd }, { rng, st: null, dryN: 0 });

function fakeDom(W, H) {
  const mk = (tag) => {
    const e = { tag, children: [], parent: null, dataset: {}, attrs: {}, className: "", textContent: "", anims: [],
      style: { _p: {}, setProperty(k, v) { this._p[k] = v; }, getPropertyValue(k) { return this._p[k] ?? ""; } },
      get classList() { const self = this; return { add: (...c) => { const s = new Set(self.className.split(" ").filter(Boolean)); c.forEach((x) => s.add(x)); self.className = [...s].join(" "); }, contains: (c) => self.className.split(" ").includes(c) }; },
      setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { if (c.parent) c.remove(); c.parent = this; this.children.push(c); return c; }, append(...cs) { cs.forEach((c) => this.appendChild(c)); },
      insertBefore(c) { return this.appendChild(c); }, prepend(c) { return this.appendChild(c); },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; },
      get isConnected() { let p = this; while (p.parent) p = p.parent; return p === doc.body; },
      animate(k, o) { this.anims.push(o); return { onfinish: null, cancel() {} }; }, getAnimations: () => [], querySelectorAll() { return []; }, querySelector() { return null; },
      get clientWidth() { return parseFloat(this.style.width) || 0; },
      getBoundingClientRect() {
        if (this.className.includes("ins-badge")) return { left: 0, top: 0, width: 150, height: 60, right: 150, bottom: 60 };
        const w = parseFloat(this.style.width) || 0, h = w * 0.6;
        const cx = parseFloat(this.style.left) || W / 2, cy = parseFloat(this.style.top) || H / 2;
        return { left: cx - w / 2, top: cy - h / 2, width: w, height: h, right: cx + w / 2, bottom: cy + h / 2 };
      } };
    return e;
  };
  const R = (l, t, w, h) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h });
  const rects = { "#sidebar": R(W - 300, 0, 300, H), "#hotbar": R(W * 0.3, H - 64, 520, 56), "#scene-controls": R(0, 40, 80, H - 200) };
  const el = (r) => ({ getBoundingClientRect: () => r });
  const doc = { body: mk("body"), createElement: mk, createTextNode: (t) => ({ textContent: t }), createElementNS: (_, t) => mk(t),
    getElementById: (id) => (id === "sidebar" ? el(rects["#sidebar"]) : null),
    querySelector: () => null, querySelectorAll: (s) => { const r = rects[s]; return r ? [el(r)] : []; } };
  globalThis.getComputedStyle = (e) => ({ zIndex: e.style.zIndex ?? "auto", display: e.style.display ?? "block", visibility: "visible", opacity: e.style.opacity ?? "1" });
  return doc;
}
const SLAM = () => ({ ent: [
  { ticks: 2, g: { s: 0.82, sx: 1.18, sy: 0.78 }, fx: [] }, { ticks: 1, g: { s: 1.12 }, fx: [], impact: true },
  { ticks: 1, g: { s: 1.6, sx: 1.08 }, fx: [{ k: "speed" }], smear: { zoom: 0.35, n: 3 } }, { ticks: 2, g: { s: 0.86, sx: 1.14, sy: 0.84 }, fx: [{ k: "burst" }] },
  { ticks: 2, g: { s: 1.05, sx: 0.95, sy: 1.07 }, fx: [] }, { ticks: 4, g: {}, fx: [] }], hold: [{ ticks: 3 }], exit: [{ ticks: 2 }] });
const POP = () => ({ ent: [{ ticks: 2, g: { s: 0.38 } }, { ticks: 1, g: { s: 1.2 }, fx: [{ k: "burst" }] }, { ticks: 2, g: { s: 0.95 } }, { ticks: 2, g: { s: 1.02 } }], hold: [{ ticks: 3 }], exit: [] });
function fakeEngine(log) {
  const calls = []; let n = 0;
  const box = (text) => { const lines = String(text).split("\n"); return { w: 0.6 * Math.max(...lines.map((l) => l.length)) + 0.3, h: 1.2 * lines.length + 0.1 }; };
  const tl = (op) => (op.in === "slam" ? SLAM() : POP());
  const L = { calls, prefs: { enabled: true, scale: 1 },
    planFor: (text, op) => ({ plan: { _holdBox: box(text), sizeK: 0.62 + 0.7 * (op.sound?.loud ?? 0.5), hand: { id: `hand-${op.seed}` }, timeline: tl(op) }, opts: op }),
    design: (text, op) => ({ sizeK: 0.62 + 0.7 * (op.sound?.loud ?? 0.5) }),
    play(text, op) {
      const h = { id: "h" + ++n, hand: `hand-${op.seed ?? n}`, alive: true, off: false, stop() { h.alive = false; }, moveTo() {},
        ready: Promise.resolve(true), finished: new Promise(() => {}), plan: { timeline: tl(op) } };
      calls.push({ text, o: op, h }); log.push({ what: "word", seed: op.seed }); return h;
    } };
  L.impact = { plan: (spec) => planImpact(spec), play(spec) { log.push({ what: "impact", spec }); return { alive: true, plan: planImpact(spec), finished: Promise.resolve("done"), ready: Promise.resolve(true), stop() {} }; } };
  return L;
}
const ID = (s) => (s + "0000000000000000").slice(0, 16);      // Foundry-shaped ids (16 alphanumerics)
const tok = (id, x, y, o = {}) => ({ id, visible: o.visible ?? true, document: { id, x, y, width: 1, height: 1, hidden: !!o.hidden, texture: { scaleX: 1, scaleY: 1 } },
  x, y, w: 100, h: 100, center: { x: x + 50, y: y + 50 } });
/* vision: the set of token ids THIS seat's sight reaches (null = a scene without token vision) */
function scene({ zoom = 1, pan = { x: 0, y: 0 }, tokens = [], sees = null }) {
  const toClient = (q) => ({ x: q.x * zoom + pan.x, y: q.y * zoom + pan.y });
  const vision = sees ? { tokenVision: true, testVisibility: (pts, o) => sees.includes(o?.object?.id) } : null;
  return { ready: true, grid: { size: 100 }, dimensions: { size: 100, sceneRect: { x: 0, y: 0, width: 4000, height: 3000 } },
    stage: { scale: { x: zoom }, toLocal: (q) => ({ x: (q.x - pan.x) / zoom, y: (q.y - pan.y) / zoom }), toGlobal: toClient },
    app: { view: { getBoundingClientRect: () => ({ left: 0, top: 0 }) }, screen: { width: 4000, height: 4000 } },
    tokens: { placeables: tokens, get: (id) => tokens.find((t) => t.id === id) }, notes: { placeables: [] }, visibility: vision, _toClient: toClient };
}
let runN = 0;
async function seat({ W = 1600, H = 900, layer = "screen", e, name = "x", hero = null, tokens = [], targets = [], gm = true, zoom = 1, pan = { x: 0, y: 0 }, sees = null, full = false }) {
  globalThis.document = fakeDom(W, H);
  globalThis.window = { innerWidth: W, innerHeight: H, matchMedia: () => ({ matches: false }) };
  const timers = [];
  globalThis.setTimeout = (f, ms) => { timers.push({ f, ms }); return timers.length; };
  globalThis.clearTimeout = () => {};
  const Stage = await import(`../splash/stage.mjs?rt-${++runN}`);
  const S = await import("../splash/splash.mjs");
  const flush = () => { let t; while ((t = timers.filter((x) => !x.done).sort((a, b) => a.ms - b.ms)[0])) { t.done = true; t.f(); } };
  globalThis.canvas = scene({ zoom, pan, tokens: [...(hero ? [hero] : []), ...tokens], sees });
  globalThis.game = { user: { isGM: gm, id: gm ? "GM" : "P1" } };
  const log = [], L = fakeEngine(log);
  Stage.setLetters(L); Stage.setLayer(layer); S.setReduced(false);
  const ctl = Stage.play(e, { token: hero, from: hero, targets, scale: 1, hold: 1, fx: 1, fullFrom: full ? 0.7 : null, seed: "RT-" + name, resolve: () => ({ now: 5, max: 8 }), backdrop: false });
  flush();
  const out = { log, calls: L.calls, ctl, impacts: log.filter((x) => x.what === "impact").map((x) => x.spec), logRows: Stage.impactLog() };
  Stage.clearAll(); Stage.setLayer("screen"); delete globalThis.canvas;
  return out;
}
const wordCall = (s) => s.calls.find((c) => /:word$/.test(c.o.seed ?? ""));
const blowOf = (s) => impBlow(s.impacts[0]) - wordCall(s).o.startAt;      // the impact's strongest drawing, ms after its word starts
const contactOf = (s) => IP.contactMs({ timeline: wordCall(s).h.plan.timeline });
const R = { crit: ev({ n: 4, sixes: 4 }), strong: ev({ n: 5, sixes: 3 }) };
ok(R.crit.power >= IP.CRIT_P && R.strong.power >= IP.STRONG_P && R.strong.power < IP.CRIT_P, `(the events: a critical ${R.crit.power.toFixed(2)}, a strong one ${R.strong.power.toFixed(2)})`);

/* ================================================================== R: where the target comes from (pure) */
{
  const A = ID("aaa"), B = ID("bbb"), C = ID("ccc");
  eq(IP.rollTargets({ tag: { inst: "i1", key: "attack" }, hits: [C, A], flagged: [B], action: "slugfest" }), [A, C], "R: a tactical attack: the tokens the exchange hit, sorted (every seat the same order), not the Foundry targets");
  eq(IP.rollTargets({ tag: { inst: "i1", key: "attack" }, hits: [], flagged: [B], action: "slugfest" }), [], "R: ... it hit nobody: no target");
  eq(IP.rollTargets({ tag: { inst: "i1", key: "attack" }, hits: null, flagged: [B], action: "slugfest" }), [B], "R: ... the fight tells this client nothing (no tactics camera): the roller's Foundry targets");
  eq(IP.rollTargets({ tag: { inst: "i1", key: "def:cb1" }, hits: [A], flagged: [B], action: "dodge" }), [], "R: a defence roll lands on nobody (ROLLTARGET-4)");
  for (const a of IP.BLOW_ACTIONS) eq(IP.rollTargets({ flagged: [B, A], action: a }), [B, A], `R: outside the tactics, a ${a}: the roller's targets in the order targeted`);
  for (const a of ["dodge", "block", "reason", "presence", "generic", null]) eq(IP.rollTargets({ flagged: [B], action: a }), [], `R: ... a ${a} roll with a target left selected: none (not a blow)`);
  eq(IP.cleanTargets([A, A, "x", 5, null, "../../etc", ID("d"), ID("e"), ID("f"), ID("g"), ID("h"), ID("i"), ID("j"), ID("k")]).length, IP.TARGET_MAX, "R: a flag's list is cleaned: Foundry ids only, no repeats, at most 8");
  eq(IP.cleanTargets("AAAA"), [], "R: ... not a list: none");
  /* moment.mjs: the hit rows of one exchange */
  eq(Moment.hits("rt-x"), null, "R: Moment.hits: nothing told -> null");
  Moment.told("rt-1", "cbB", true); Moment.told("rt-1", "cbA", false); Moment.told("rt-1", "cbC", true); Moment.told("rt-1", null, true);
  eq(Moment.hits("rt-1"), ["cbB", "cbC"], "R: Moment.hits: the targets hit (not the misses, not the target-less row), sorted");
  /* targetChoice: the provisional rules */
  const look = (m) => (id) => m[id] ?? "gone";
  eq(IP.targetChoice([], look({})), { id: null, why: "none" }, "Q: no target: none (the result word)");
  eq(IP.targetChoice([A], look({ [A]: "ok" })), { id: A, why: "target" }, "L: one target this seat sees in view: it");
  eq(IP.targetChoice([A, B], look({ [A]: "ok", [B]: "ok" })), { id: A, why: "first" }, "Q: several targets: the first (one impact per event)");
  eq(IP.targetChoice([A, B], look({ [A]: "unseen", [B]: "ok" })), { id: null, why: "unseen" }, "V+Q: the first target unseen here: the word (not the second: every seat that can mark it marks the same one)");
  eq(IP.targetChoice([A], look({ [A]: "off" })), { id: null, why: "off" }, "Q: the target off this view: the word");
  eq(IP.targetChoice([A], () => { throw new Error("x"); }), { id: null, why: "gone" }, "V: a look that fails: the word (fails closed)");
}

/* ================================================================== L + V: on the target, on the contact, private */
{
  const hero = tok(ID("hero"), 500, 380), T = tok(ID("tgt"), 900, 420), T2 = tok(ID("two"), 700, 600);
  for (const [name, e, full] of [["strong", R.strong, false], ["crit", R.crit, true]]) {
    const s = await seat({ e, name, hero, tokens: [T], targets: [T.id], full });
    const im = s.impacts[0], w = wordCall(s);
    ok(im && w, `L ${name}: one impact, one word`);
    if (!im || !w) continue;
    ok(im.subject === T, `L ${name}: the impact lands on the target token itself (its picture is the silhouette), not on the word or the roller`);
    ok(im.subject !== hero && im.from === hero, `L ${name}: the blow comes from the roller (from), it is not on the roller (ADVI 7)`);
    ok(Math.abs(blowOf(s) - contactOf(s)) < 1, `L ${name}: its strongest drawing on the word's contact, as before (${Math.round(blowOf(s))} / ${Math.round(contactOf(s))} ms)`);
    ok(w.o.flash === false && im.kind === IP.impactFor(e, { fx: 1 }).kind, `L ${name}: the same recipe: the word does not flash, the kind from the event`);
    eq(s.logRows.at(-1)?.where, "target", `L ${name}: the seat's impact log says where it landed`);
    /* the same roll without a target: the same instant, on the word */
    const n = await seat({ e, name, hero, tokens: [T], targets: [], full });
    ok(n.impacts[0] && !n.impacts[0].subject?.document && Number.isFinite(n.impacts[0].subject?.w) && !("from" in n.impacts[0]), `Q ${name}: no target: the impact marks the result word's box (radial), as before`);
    ok(Math.abs(blowOf(n) - blowOf(s)) < 1 && Math.abs(wordCall(n).o.startAt - wordCall(s).o.startAt) < 50, `L ${name}: with or without a target the blow falls on the same tick of the word`);
  }
  /* several targets: the first */
  const sv = await seat({ e: R.crit, name: "sev", hero, tokens: [T, T2], targets: [T2.id, T.id], full: true });
  ok(sv.impacts.length === 1 && sv.impacts[0].subject === T2, "Q: several targets: ONE impact, on the first");

  /* V: the target out of a player's sight (vision): that player marks the word; the GM, who sees it, the target; the same tick */
  const gmS = await seat({ e: R.crit, name: "vis", hero, tokens: [T], targets: [T.id], gm: true, sees: [hero.id], full: true });
  const plS = await seat({ W: 1366, H: 768, e: R.crit, name: "vis", hero, tokens: [T], targets: [T.id], gm: false, sees: [hero.id], full: false });
  ok(gmS.impacts[0]?.subject === T, "V: the GM sees every token: the impact on the target");
  const pi = plS.impacts[0];
  ok(pi && pi.subject !== T && !pi.subject?.document && Number.isFinite(pi.subject?.w) && !("from" in pi) && !JSON.stringify(pi.subject).includes(T.id),
    `V: a player who cannot see the target: the impact marks the word, names no token, no direction (${JSON.stringify(pi?.subject)})`);
  eq(plS.logRows.at(-1)?.why, "unseen", "V: ... logged as unseen on that seat");
  ok(Math.abs(blowOf(gmS) - blowOf(plS)) < 1 && gmS.impacts[0].seed === pi.seed && gmS.impacts[0].kind === pi.kind, `V: GM and player: the same impact on the same tick of the same word (${Math.round(blowOf(gmS))} / ${Math.round(blowOf(plS))} ms)`);
  /* a player who sees it: on the target too */
  const plSee = await seat({ e: R.crit, name: "vis2", hero, tokens: [T], targets: [T.id], gm: false, sees: [hero.id, T.id] });
  ok(plSee.impacts[0]?.subject === T, "V: a player who sees the target: on the target");
  /* the roller unseen by the player, the target seen: on the target, but no direction from the unseen roller */
  const plNoHero = await seat({ e: R.crit, name: "vis3", hero, tokens: [T], targets: [T.id], gm: false, sees: [T.id] });
  ok(plNoHero.impacts[0]?.subject === T && !("from" in plNoHero.impacts[0]), "V: the roller out of this player's sight: on the target, radial (the roller's place is not told)");
  /* a GM-hidden target: the word on EVERY seat (the GM too: one place for the table) */
  const H = tok(ID("hid"), 900, 420, { hidden: true });
  for (const gm of [true, false]) {
    const h = await seat({ e: R.crit, name: "hid" + gm, hero, tokens: [H], targets: [H.id], gm });
    ok(h.impacts[0] && h.impacts[0].subject !== H && !h.impacts[0].subject?.document, `V: a GM-hidden target (${gm ? "GM" : "player"}): the impact marks the word`);
  }
  /* the target off this seat's view: the word */
  const far = tok(ID("far"), 3600, 2800);
  const of = await seat({ e: R.crit, name: "off", hero, tokens: [far], targets: [far.id] });
  ok(of.impacts[0] && of.impacts[0].subject !== far && Number.isFinite(of.impacts[0].subject?.w), "Q: the target off this view: the impact marks the word (a frame at the edge would mark nothing)");
  eq(of.logRows.at(-1)?.why, "off", "Q: ... logged as off");
  /* under the open sidebar counts as off the view */
  const side = tok(ID("side"), 1400, 400);
  const sd = await seat({ e: R.crit, name: "side", hero, tokens: [side], targets: [side.id] });
  ok(sd.impacts[0] && sd.impacts[0].subject !== side, "Q: a target under the open sidebar: the word");
  /* a target not on this scene */
  const gone = await seat({ e: R.crit, name: "gone", hero, tokens: [], targets: [ID("nope")] });
  ok(gone.impacts[0] && Number.isFinite(gone.impacts[0].subject?.w), "Q: a target not on this board: the word");
}

/* ================================================================== L: map layer */
{
  const hero = tok(ID("hero"), 1100, 700), T = tok(ID("tgt"), 800, 450);
  const s = await seat({ layer: "overlay", e: R.crit, name: "map", hero, tokens: [T], targets: [T.id] });
  const im = s.impacts[0], w = wordCall(s);
  ok(im && im.subject === T && im.space === "world" && Array.isArray(im.frames) && im.keep === w?.h, `L map: on the target, with the map's drawings, the result word kept readable (${s.logRows.at(-1)?.where} ${s.logRows.at(-1)?.why})`);
  const covers = planImpact(im).frames.filter((f) => IP.COVERS_WORD.includes(f.type));
  eq(covers.length, 0, "L map: still only drawings that leave a spot clear");
  /* the word off this seat's view but the target in it: the target still gets its impact */
  const onlyT = await seat({ layer: "overlay", e: R.crit, name: "map2", hero: tok(ID("hero2"), 200, 200), tokens: [tok(ID("t2"), 2900, 2300)], targets: [ID("t2")], pan: { x: -2600, y: -2000 } });
  ok(onlyT.impacts[0]?.subject?.id === ID("t2"), `L map: the target in this view gets its impact wherever the block stands (${onlyT.logRows.at(-1)?.where})`);
  /* nothing in view (word and target both off it): no impact, but the word waits the SAME lead-in as on the other seats */
  const offAll = await seat({ layer: "overlay", e: R.crit, name: "map", hero, tokens: [T], targets: [T.id], pan: { x: -3000, y: -2500 } });
  eq(offAll.impacts.length, 0, "Q map: the word and the target off this view: no impact (nothing to mark)");
  const a = wordCall(s), b = wordCall(offAll);
  ok(a && b && Math.abs((a.o.startAt - b.o.startAt)) < 50 && offAll.logRows.at(-1)?.where === "none", "V map: ... and the word still starts on the shared instant (before, such a seat started its word earlier than the others)");
}

/* ================================================================== source pins: the roll's flag and the hand-over */
{
  const m = src("../splash/main.mjs");
  ok(/function targetsAtRoll\(message\)[\s\S]{0,600}!t\.document\.hidden/.test(m), "R: the roll's flag keeps the roller's targets without GM-hidden ones (the flag is public)");
  ok(/hook\('preCreateChatMessage'[\s\S]{0,1400}targetsAtRoll\(message\)/.test(m), "R: the targets are taken on the author's client as the roll is made");
  ok(/function eventFor[\s\S]{0,1400}ev\.tg = IP\.cleanTargets\(f\.tg\)/.test(m), "R: a seat reads the flag's targets only through cleanTargets");
  ok(/Moment\.hits\(tag\.inst\)/.test(m) && /\.filter\(td => td && !td\.hidden\)/.test(m), "R: a tactical attack's targets are the hit tokens, GM-hidden ones dropped");
  ok(/targets: rollTargetsOf\(message, ev\), from: boardToken\(message\)/.test(m), "L: the splash hands the targets and the roller (only one this seat sees: boardToken) to the stage");
  ok(!/logic\.mjs[\s\S]*ROLLTARGET/.test(src("../splash/logic.mjs")), "(logic.mjs untouched by ROLLTARGET)");
}
done("rolltarget");
const sm = summary();
console.log(`sweep rolltarget: ${sm.checks} checks, ${sm.failed} failed`);
process.exit(sm.failed ? 1 : 0);
