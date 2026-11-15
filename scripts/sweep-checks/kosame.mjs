import "../tokenreact/impact-node-prime.mjs";      // the vendored engine's impact table for pure.mjs (on a page: the running engine's L.impact)
// node scripts/sweep-checks/kosame.mjs  (KOSAME, 2026-11-15: the token reactions of a real tactical fight, the GM and a player side by side).
//   Seen live on lane 5 (10 real fights, Omni-Man's slugfest, both seats on the same view): the word, its seed, the impact and the instant
//   were the same on both seats, but the word's SIZE (up to 32 %) and PLACE (up to ~390 scene px) differed in 8 of 10. The map's action
//   camera (moinen-maps director stage) moves each seat's view on its own (it frames the blow, pushes in on a kill, draws letterbox bars),
//   and the reaction was laid out on THIS seat's live view at plan time. Now it is laid out on the user's own view (the stage's `home`,
//   status().home, while the camera is away), the same on every seat that looked at the same place; the words still follow the live view.
//   F  the frame maths: frameScreen / frameWorld are the stage's own transform (screen = position + (p - pivot) * scale) and its inverse.
//   V  two seats, each in its own process: one at home, one with the camera away (another place, another zoom) and `home` told: the same
//      word, seed, size and place once the camera is home again. The camera away and NO home told: the size or place differs (the check sees).
//   E  a fight event's instant: anchored on the fight's state write (its server stamp, heard on every seat just before the event), not on
//      each seat's arrival. eventAnchor's cases, and two seats in their own processes, the player's delivery 150 ms late: the same instant.
// V and E fail on tactics-integrated-152 (V: size/place differ; E: the instants ~150 ms apart).
import * as P from "../tokenreact/pure.mjs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHILD = process.argv[2] === "seat";

/* ================================================================== F: the frame maths */
if (!CHILD) {
  const fr = { x: 1850, y: 1340, scale: 0.6 }, c = { x: 800, y: 450 };
  const stage = (f0) => ({ toGlobal: (p) => ({ x: c.x + (p.x - f0.x) * f0.scale, y: c.y + (p.y - f0.y) * f0.scale }) });
  let ok = true, rt = true;
  for (const p of [{ x: 0, y: 0 }, { x: 1850, y: 1340 }, { x: 3150, y: 1050 }, { x: -200, y: 4000 }]) {
    const a = P.frameScreen(p, fr, c), b = stage(fr).toGlobal(p);
    if (Math.hypot(a.x - b.x, a.y - b.y) > 1e-9) ok = false;
    const w = P.frameWorld(a, fr, c);
    if (Math.hypot(w.x - p.x, w.y - p.y) > 1e-9) rt = false;
  }
  ck("F frameScreen is the stage's transform (position + (p - pivot) * scale)", ok);
  ck("F frameWorld is its inverse", rt);
  ck("F frameScreen centres the frame's pivot on the stage's position", (() => { const q = P.frameScreen({ x: fr.x, y: fr.y }, fr, c); return q.x === c.x && q.y === c.y; })());
  ck("F cleanFrame keeps a sane frame", JSON.stringify(P.cleanFrame({ x: 1, y: 2, scale: 0.5, extra: 1 })) === JSON.stringify({ x: 1, y: 2, scale: 0.5 }));
  ck("F cleanFrame drops no frame / a broken one / zero scale", [null, undefined, 7, {}, { x: 1, y: 2 }, { x: "a", y: 2, scale: 1 }, { x: 1, y: 2, scale: 0 }, { x: 1, y: 2, scale: -1 }].every((v) => P.cleanFrame(v) === null));
  /* the event's anchor */
  ck("E eventAnchor: a write heard 20 ms ago -> its stamp", P.eventAnchor({ srv: 9990, at: 9990 }, 10010) === 9990);
  ck("E eventAnchor: no write heard -> null (the arrival)", P.eventAnchor(undefined, 10000) === null && P.eventAnchor(null, 10000) === null);
  ck(`E eventAnchor: a write older than ${P.EVENT_STAMP_MS} ms -> null`, P.eventAnchor({ srv: 5000, at: 5000 }, 5000 + P.EVENT_STAMP_MS + 1) === null);
  ck("E eventAnchor: a stamp in the future (a broken clock) -> null", P.eventAnchor({ srv: 10500, at: 9990 }, 10010) === null);
  ck("E eventAnchor: broken numbers -> null", P.eventAnchor({ srv: NaN, at: 1 }, 2) === null && P.eventAnchor({ srv: 1, at: 1 }, NaN) === null);
}

/* ================================================================== a seat (one per process: the module keeps a fight's event keys) */
async function seat(role, scen, W) {
  const hooks = {};
  globalThis.Hooks = { on: (k, fn) => ((hooks[k] ??= []).push(fn), 1), once: (k, fn) => ((hooks[k] ??= []).push(fn), 1), callAll: (k, ...a) => { for (const fn of hooks[k] ?? []) fn(...a); } };
  const settings = new Map(), values = { "invincible-plus-ultra.tokenReactEnabled": true, "invincible-plus-ultra.tokenReactSize": "normal" };
  const user = { isGM: role === "gm", id: role === "gm" ? "UG" : "UP" };
  const combat = { id: "C1", combatants: new Map() };
  /* the map's action camera: status().home is the user's own view while the camera is away (null at home) */
  const cam = { home: null };
  const maps = { active: true, api: { directorStage: { status: () => ({ on: true, combat: true, home: cam.home }) } } };
  globalThis.game = {
    user, i18n: { lang: "en", has: () => false, localize: (k) => k },
    settings: { settings, register: (m, k, o) => settings.set(`${m}.${k}`, o), get: (m, k) => values[`${m}.${k}`] },
    modules: new Map([["invincible-plus-ultra", { api: {} }], ["moinen-maps", maps]]), combats: new Map([["C1", combat]]), messages: { contents: [] }
  };
  globalThis.foundry = { utils: { getProperty: (o, p) => p.split(".").reduce((a, k) => a?.[k], o), expandObject: (o) => o } };
  globalThis.CONST = { CANVAS_PERFORMANCE_MODES: { LOW: 0 } };
  const VW = 1600, VH = 900;
  globalThis.innerWidth = VW; globalThis.innerHeight = VH;
  globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
  globalThis.getComputedStyle = () => ({ visibility: "visible" });
  globalThis.matchMedia = () => ({ matches: false });
  /* Foundry's stage: screen = position + (p - pivot) * scale */
  const st = { pivot: { x: 0, y: 0 }, position: { x: VW / 2, y: VH / 2 }, scale: { x: 1, y: 1 } };
  st.toGlobal = (p) => ({ x: st.position.x + (p.x - st.pivot.x) * st.scale.x, y: st.position.y + (p.y - st.pivot.y) * st.scale.x });
  st.toLocal = (q) => ({ x: st.pivot.x + (q.x - st.position.x) / st.scale.x, y: st.pivot.y + (q.y - st.position.y) / st.scale.x });
  const look = (x, y, z) => { st.pivot.x = x; st.pivot.y = y; st.scale.x = st.scale.y = z; };
  const scene = { id: "S" };
  const toks = [];
  globalThis.canvas = { ready: true, scene, grid: { size: 100 }, performance: { mode: 2 }, stage: st, app: { view: { getBoundingClientRect: () => ({ left: 0, top: 0, right: VW, bottom: VH, width: VW, height: VH }) } },
    tokens: { placeables: toks, get: (id) => toks.find((t) => t.id === id) } };
  function mk(id, type, h, r, o = {}) {
    const actor = { id: `A${id}`, type, hasPlayerOwner: false, system: { derived: { health: { value: h, max: o.hm ?? 8 }, resolve: { value: r, max: 8 } } },
      testUserPermission: () => false, _stats: { modifiedTime: 0 } };
    const tok = { id, scene, isVisible: true, document: { id, hidden: false }, actor, x: o.x ?? 0, y: o.y ?? 0, w: 100, h: 100, destroyed: false };
    Object.defineProperty(tok, "center", { get: () => ({ x: tok.x + 50, y: tok.y + 50 }) });
    actor.getActiveTokens = () => [tok]; actor.name = id; tok.document.object = tok;
    combat.combatants.set(`c${id}`, { token: { object: tok } });
    toks.push(tok);
    return tok;
  }
  /* the table's clock: the server's time is the wall clock (the same in both processes); this page's clock is its own performance.now() */
  const off = () => Date.now() - performance.now();
  const clock = { now: () => Date.now(), toPage: (s) => s - off(), toServer: (p) => p + off(), offset: () => off(), ready: () => true, error: () => 1 };
  const { sizeFor } = await import("../letters/size.mjs");
  const { planImpact, LIMITS } = await import("../letters/impact/plan.mjs");
  const sizeK = (o) => 0.62 + 0.7 * (o?.sound?.loud ?? 0.6);
  const ctxOf = (o) => ({ space: "world", magnitude: o.magnitude, scale: o.scale ?? 1, tokenSpan: 100, grid: 100, zoom: 1, vw: VW - 300, vh: VH, sizeK: sizeK(o), aspect: 3 });
  const plays = [], impacts = [];
  const fake = { version: "test", limits: { screen: 16, world: 48 }, ready: async () => true, count: () => 0, clock,
    sizeOf: (text, o) => ({ ...sizeFor(ctxOf(o)), sizeK: sizeK(o) }),
    play: (text, o) => {
      const h = { id: `h${plays.length}`, hand: "x", alive: true, opts: o, plan: { timeline: { ent: [{ ticks: 2 }, { ticks: 1, fx: [{ k: "burst" }] }, { ticks: 2 }] } }, ready: sleep(30).then(() => true),
        finished: sleep((o.hold ?? 800) + 900).then(() => { h.alive = false; return "done"; }), stop() { h.alive = false; }, moveTo() {} };
      plays.push({ text, o, h }); return h;
    },
    impact: { busy: false, limits: LIMITS, plan: (spec) => planImpact(spec), warm: () => 0,
      play(spec) { impacts.push({ spec }); return { id: `i${impacts.length}`, alive: true, plan: planImpact(spec), finished: Promise.resolve("done"), ready: Promise.resolve(true), stop() {} }; } } };
  { const { createVocab } = await import("../letters/words.mjs"); fake.vocab = createVocab(); fake.word = fake.vocab.word; }
  globalThis.MoinenLetters = { copies: [], _engine: fake, async engine() { return this._engine; } };
  const Clock = await import("../shared-clock.mjs");
  Clock.driveGrid(fake);      // the table's clock is the engine's (as on a page with LETR 1.9.11+)
  const M = await import("../tokenreact/main.mjs");
  M.start({ init: true, ready: true });
  const isNum = (t) => /^[+-]\d/.test(String(t));
  const t = mk("MB", "npc", 8, 6, { x: 3100, y: 1000 });
  Hooks.callAll("canvasReady");
  /* a stamp heard at once teaches the clock the server's epoch (on a page: the many documents a seat hears) */
  Hooks.callAll("updateUser", {}, {}, { modifiedTime: Date.now() });
  const hit = (stamp, opts = {}) => { t.actor._stats.modifiedTime = stamp; t.actor.system.derived.health.value = 5; Hooks.callAll("updateActor", t.actor, { system: { derived: { health: { value: 5 } } } }, { ipuTactics: true, modifiedTime: stamp, ...opts }); };
  const write = (stamp) => Hooks.callAll("updateCombat", combat, { flags: { "invincible-plus-ultra": { tactics: 1 } } }, { modifiedTime: stamp });
  const ev = () => Hooks.callAll("invincible-plus-ultra.tactics", { combat: "C1", fight: "F7", type: "damage", target: "cMB", taken: 3, seq: 41 });
  const at = (srv) => sleep(Math.max(0, srv - Date.now()));
  if (scen === "view") {
    /* the user's own view: the struck token in the middle at 0.6. GM: at home. Player: the camera framed elsewhere, closer (0.45 / 0.8) */
    const home = { x: 3150, y: 990, scale: 0.6 };
    if (role === "gm") look(home.x, home.y, home.scale);
    else { look(2700, 1300, role === "away-out" ? 0.45 : 0.8); cam.home = role === "nohome" ? null : { ...home }; }
    await at(W);
    hit(W); ev();
    await sleep(1400);
    /* the camera comes home: the word follows the live view; now both seats look at the same place */
    look(home.x, home.y, home.scale); cam.home = null;
    await sleep(60);
    const w = plays.filter((p) => !isNum(p.text));
    return { words: w.map((p) => { const a = p.o.at?.(); return { text: p.text, seed: p.o.seed, scale: p.o.scale, at: a ? [a.x, a.y] : null }; }) };
  }
  if (scen === "instant") {
    /* the fight's step: the actor update (stamp W - 30), the fight's state write (stamp W), then its event. GM: heard at once (the event
       1 ms after the write). Player: the delivery 150 ms late, the event 19 ms after the write (seen live: 3-19 ms) */
    const late = role === "gm" ? 0 : 150, gap = role === "gm" ? 1 : 19;
    look(3150, 990, 0.6);
    await at(W - 30 + late); hit(W - 30);
    await at(W + late); write(W);
    await at(W + late + gap); ev();
    await sleep(1500);
    const o = off();
    return { words: plays.filter((p) => !isNum(p.text)).map((p) => ({ text: p.text, seed: p.o.seed })), im: impacts.map((x) => ({ kind: x.spec.kind, seed: x.spec.seed, blow: Math.round(x.spec.blowAt + o) })) };
  }
  return null;
}
if (CHILD) {
  const r = await seat(process.argv[3], process.argv[4], Number(process.argv[5]));
  console.log(JSON.stringify(r));
  process.exit(0);
}
{
  const { spawn } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const one = (role, scen, W) => new Promise((res) => {
    const q = spawn(process.execPath, [fileURLToPath(import.meta.url), "seat", role, scen, String(W)]);
    let out = "", err = "";
    q.stdout.on("data", (d) => (out += d)); q.stderr.on("data", (d) => (err += d));
    q.on("close", () => { const line = out.trim().split(/\r?\n/).reverse().find((l) => l.startsWith("{")); try { res(JSON.parse(line)); } catch { res({ words: [], im: [], err: err.slice(0, 400) }); } });
  });
  /* V: the seats run at the same time (the same wall clock); W leaves the processes time to load */
  const W = Date.now() + 1500;
  const [gm, away, out, noh] = await Promise.all([one("gm", "view", W), one("away", "view", W), one("away-out", "view", W), one("nohome", "view", W)]);
  const same = (a, b) => a.words.length === 1 && b.words.length === 1 && a.words[0].text === b.words[0].text && a.words[0].seed === b.words[0].seed
    && Math.abs(a.words[0].scale / b.words[0].scale - 1) < 0.005 && a.words[0].at && b.words[0].at && Math.hypot(a.words[0].at[0] - b.words[0].at[0], a.words[0].at[1] - b.words[0].at[1]) < 1;
  const fmt = (x) => x.words.map((w) => `${w.text} k${w.scale?.toFixed?.(3)} @${w.at?.map(Math.round)}`).join(" + ") || x.err || "none";
  ck(`V a word on each seat (GM ${fmt(gm)} / camera away ${fmt(away)})`, gm.words.length === 1 && away.words.length === 1);
  ck(`V the camera away (closer) and home told: the same word, seed, size and place as the seat at home (${fmt(gm)} / ${fmt(away)})`, same(gm, away));
  ck(`V the camera away (further out) and home told: the same (${fmt(gm)} / ${fmt(out)})`, same(gm, out));
  ck(`V the camera away and NO home told: the size or the place differs (the check sees the case: ${fmt(gm)} / ${fmt(noh)})`, noh.words.length === 1 && !same(gm, noh));
  /* E: the event's instant */
  const W2 = Date.now() + 1500;
  const [g2, p2] = await Promise.all([one("gm", "instant", W2), one("player", "instant", W2)]);
  const b = (x) => x.im?.[0]?.blow;
  ck(`E one word and one impact on each seat (${g2.words?.map((w) => w.text)} / ${p2.words?.map((w) => w.text)}${g2.err ?? ""}${p2.err ?? ""})`, g2.words?.length === 1 && p2.words?.length === 1 && g2.im?.length === 1 && p2.im?.length === 1);
  ck("E the same word, seed and impact on both seats", g2.words?.[0]?.text === p2.words?.[0]?.text && g2.words?.[0]?.seed === p2.words?.[0]?.seed && g2.im?.[0]?.seed === p2.im?.[0]?.seed && g2.im?.[0]?.kind === p2.im?.[0]?.kind);
  ck(`E the player's delivery 150 ms late: the blow's instant the same on both seats (within 20 ms: ${b(g2) - W2} / ${b(p2) - W2} ms after the write)`, Number.isFinite(b(g2)) && Number.isFinite(b(p2)) && Math.abs(b(g2) - b(p2)) <= 20);
}
console.log(`sweep kosame: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
