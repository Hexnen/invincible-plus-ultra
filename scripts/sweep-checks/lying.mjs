// node scripts/sweep-checks/lying.mjs  (LYING: finding D10 again, seen live on tactics-integrated-159).
// What was wrong there: (1) the tokens of a fight are turned to face, so a lying round portrait (a quarter turn and a squash along the
// token's own axis) looked like a standing one that faces another way; (2) a reaction played on a lying token (Resolve out: the slump leans
// round its feet) slid the lying picture a quarter of a square onto its neighbour for over a second; (3) the lying dim was a faint red;
// (4) the impact frame of a blow on a lying token drew its figure standing (the pose is on the picture only for one drawing).
// Pure part (scripts/tokenanim/pure.mjs): the lying picture is the same low oval on the screen whatever way the token faces; it is dark
// and not coloured; every reaction on a lying token keeps the picture on its own square at every instant and still shows its own tint; the
// fall and the rise are not held and do not jump; two seats with the same state and clock draw the same transform.
// Runtime on a fake Foundry (scripts/tokenanim/main.mjs): the drawing uses the mesh's skew and puts it back exactly; `posed` shows the
// lying turn only for the length of one call. Fails on tactics-integrated-159 (d5c3c8e): no fy, no held, no posed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
let n = 0, f = 0;
const ck = (name, c, note = "") => { n++; if (!c) { f++; console.log("FAIL", name, note); } };
const dir = dirname(fileURLToPath(import.meta.url)), root = join(dir, "..");
const P = await import("../tokenanim/pure.mjs");
if (typeof P.held !== "function" || typeof P.matrixOf !== "function" || !(P.LIE.slack >= 0)) { ck("tokenanim has the floor squash and the hold (pure fy, held, matrixOf)", false); console.log(`sweep lying: ${n} checks, ${f} failed`); process.exit(1); }

const LYING = { side: 1, fallAt: -Infinity, upAt: Infinity };
const FACINGS = [0, 0.5, 1.1659, 1.8925, Math.PI, 4.712, 6.226, -0.7];      // radians: the live scene's tokens stand at 66.8, 108.4, 270, 356.7 degrees
/** the picture a transform draws, as the box of a round portrait (a disc of the token's width) and of a square one -> half sizes in token widths */
const drawnBox = (tr) => { const [a, b, c, d] = P.matrixOf(tr); return { rw: Math.hypot(a, c) / 2, rh: Math.hypot(b, d) / 2, sw: (Math.abs(a) + Math.abs(c)) / 2, sh: (Math.abs(b) + Math.abs(d)) / 2 }; };
const base0 = (rot, sx = 1, sy = 1) => ({ x: 0, y: 0, rotation: rot, sx, sy, tint: 0xffffff });

/* ---------------- 1. the same low oval whatever way the token faces ---------------- */
{
  const p = P.mix([], 0, {}, P.lyingAt(LYING, 0, {}, { tk: 0.7 }));
  let worst = 0, tallest = 0, widest = 0, narrow = 9;
  for (const side of [1, -1]) for (const rot of FACINGS) for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1]]) {
    const q = P.mix([], 0, {}, P.lyingAt({ ...LYING, side }, 0, {}, { tk: 0.7 }));
    const b = drawnBox(P.apply(base0(rot, sx, sy), q, { w: 1, h: 1 }));
    worst = Math.max(worst, Math.abs(b.rh / b.rw - P.LIE.flat)); tallest = Math.max(tallest, b.rh); widest = Math.max(widest, b.rw); narrow = Math.min(narrow, b.rw);
  }
  ck(`a lying round portrait is the same oval on the screen for every facing, side and mirrored picture (height / width off by ${worst.toExponential(1)})`, worst < 1e-9);
  ck(`... a low one: ${(2 * tallest).toFixed(2)} of a square high, ${(2 * narrow).toFixed(2)} wide (a standing one is 1 x 1)`, 2 * tallest <= 0.62 && 2 * narrow >= 0.85 && Math.abs(widest - narrow) < 1e-9);
  ck("the squash is down the screen (pose.fy), not a scale along the token's own axis", p.fy <= 0.7 && Math.abs(p.sx - p.sy) < 1e-9);
  /* the transform is exactly: squash down the screen x turn x the picture's own scale */
  let err = 0;
  for (const rot of FACINGS) for (const [sx, sy] of [[0.5, 0.5], [-0.37, 0.41]]) {
    const tr = P.apply(base0(rot, sx, sy), p, { w: 1, h: 1 }), [a, b, c, d] = P.matrixOf(tr), th = rot + p.rot;
    const want = [Math.cos(th) * sx * p.sx, p.fy * Math.sin(th) * sx * p.sx, -Math.sin(th) * sy * p.sy, p.fy * Math.cos(th) * sy * p.sy];
    err = Math.max(err, ...[a, b, c, d].map((v, i) => Math.abs(v - want[i])));
    if (Math.abs(tr.rotation - th) > 1e-12) err = 1;
  }
  ck(`the drawn matrix is the squash after the turn, for any facing and a mirrored picture (error ${err.toExponential(1)})`, err < 1e-9);
  const up = P.apply(base0(0.4, 0.5, 0.5), { ...P.POSE0, rot: 0.2, sx: 0.9, sy: 1.1 }, { w: 100, h: 100 });
  ck("a pose that is not lying is drawn as before: no skew, the plain turn and scale", up.skewX === 0 && up.skewY === 0 && Math.abs(up.rotation - 0.6) < 1e-12 && Math.abs(up.sx - 0.45) < 1e-12 && Math.abs(up.sy - 0.55) < 1e-12);
  const still = P.lyingAt(LYING, 0, {}, { still: true, tk: 0.7 });
  ck("reduced motion: the dim alone, nothing squashed or turned", still.fy === 1 && still.rot === 0 && still.sx === 1 && still.tk > 0.5);
}

/* ---------------- 2. dark, not coloured ---------------- */
{
  const ch = (v) => [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  for (const [name, tk] of [["the table's default (the guard on)", 0.7], ["no guard factor", 1]]) {
    const p = P.mix([], 0, {}, P.lyingAt(LYING, 0, {}, { tk }));
    const t = ch(P.apply(base0(0), p, { w: 1, h: 1 }).tint), hi = Math.max(...t), lo = Math.min(...t);
    ck(`${name}: a lying token is clearly darker (brightest channel ${(hi / 255).toFixed(2)}) and not coloured (channels within ${((hi - lo) / hi).toFixed(2)})`, hi / 255 <= 0.75 && lo / 255 >= 0.35 && (hi - lo) / hi <= 0.12);
  }
  const red = ch(P.TINTS.down), lie = ch(P.TINTS.lie);
  ck("the lying dim is its own cool dark, not the red of a fresh knock-down", P.TINTS.lie !== P.TINTS.down && lie[2] >= lie[0] && red[0] > 2 * red[2]);
}

/* ---------------- 3. every reaction on a lying token keeps it on its own square ---------------- */
{
  const DIRS = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }, { x: 0.7, y: 0.7 }, null];
  const lim = 0.5 + P.LIE.slack + 1e-9;
  let worst = 0, worstWhat = "", count = 0, tintSeen = 0, backRest = true, flat = true;
  const rest = P.mix([], 0, {}, P.lyingAt(LYING, 0, {}, { tk: 0.7 }));
  for (const kind of P.EVENTS) for (const anim of P.ANIM_IDS) {
    if (anim === "none") continue;
    for (const [amt, step, strength] of [[0.2, 0, 1], [1, 4, 2], [0.6, 2, 1]]) for (const dir of DIRS) for (const side of [1, -1]) {
      const S = { ...LYING, side };
      const L = P.plan(kind, { anim, amt, step, strength, seed: `${kind}|${anim}`, at: 1000, dir, lie: false });
      if (!L) continue;
      count++;
      for (let t = 1000; t <= 1000 + L.dur + 40; t += 1000 / 120) {
        const base = P.lyingAt(S, t, {}, { tk: 0.7 }), m = P.mix([L], t, {}, base), b = P.boxOf(m.sx, m.sy, m.rot, m.fy);
        const reach = Math.max(Math.abs(m.x) + b.hw, Math.abs(m.y) + b.hh);
        if (reach > worst) { worst = reach; worstWhat = `${kind} / ${anim} amt ${amt} step ${step} str ${strength} at +${Math.round(t - 1000)} ms`; }
        if (m.fy > P.LIE.flat + 1e-9) flat = false;
        if (t - 1000 > 45 && t - 1000 < 80 && m.tk > 0.05 && m.tint !== P.TINTS.lie && m.dk > 0.3 && m.dim === P.TINTS.lie) tintSeen++;
      }
      const end = P.mix([L], 1000 + L.dur + 1, {}, P.lyingAt(S, 1000 + L.dur + 1, {}, { tk: 0.7 }));
      if (side === 1 && !(Math.abs(end.x - rest.x) < 1e-9 && Math.abs(end.y - rest.y) < 1e-9 && Math.abs(end.rot - rest.rot) < 1e-9 && end.tk === rest.tk && end.tint === P.TINTS.lie && !(end.dk > 0))) backRest = false;
    }
  }
  ck(`a lying token under any reaction (${count} plans: every kind x every animation, strengths up to the largest, any direction) stays on its own square: reach ${worst.toFixed(3)} of ${(0.5 + P.LIE.slack).toFixed(2)}`, count > 500 && worst <= lim, worstWhat);
  ck("... and stays flat on the floor through it", flat);
  ck("a reaction's own tint still shows on a lying token, over the lying dim", tintSeen > count);
  ck("after the reaction it is the lying pose again, exactly", backRest);
  /* the case seen live: Resolve out (the slump) on a lying token slid it 0.13 / 0.23 of a square for over a second */
  const L = P.plan("out", { amt: 0.9, step: 0, seed: "x|resolve|1", at: 0, dir: null });
  let far = 0; for (let t = 0; t < L.dur; t += 10) { const m = P.mix([L], t, {}, P.lyingAt(LYING, t, {})); far = Math.max(far, Math.hypot(m.x - rest.x, m.y - rest.y)); }
  ck(`Resolve out on a lying token: the slump moves the picture ${far.toFixed(3)} of a square at most (0.26 on tag 159)`, far < 0.16 && far > 0.01);
  /* held: the rule itself */
  let ok = true, prev = -1;
  for (let v = 0; v <= 2; v += 0.01) { const h = P.held(v, 0.2); if (h > 0.2 + 1e-12 || h < prev - 1e-12 || Math.abs(P.held(-v, 0.2) + h) > 1e-12) ok = false; if (v <= 0.12 - 1e-9 && Math.abs(h - v) > 1e-12) ok = false; prev = h; }
  ck("held: unchanged for small moves, eased, never past the room, never backwards, the same both ways; no room = no move", ok && P.held(0.3, 0) === 0);
  /* a standing token is not held at all */
  const hit = P.plan("heavy", { amt: 1, step: 4, strength: 2, seed: "s", at: 0, dir: { x: 1, y: 0 } });
  let same = true; for (let t = 0; t < hit.dur; t += 16) { const a = P.mix([hit], t), b = {}; P.poseAt(hit, t, b); const c = P.centred(b); if (Math.abs(a.x - c.x) > 1e-12 || Math.abs(a.y - c.y) > 1e-12 || a.fy !== 1 || a.dk !== 0) same = false; }
  ck("a standing token's reactions are untouched (not held, not squashed, no dim)", same);
}

/* ---------------- 4. the fall and the rise ---------------- */
{
  const run = (L, S, from, to) => { let jump = 0, prev = null; const out = []; for (let t = from; t <= to; t += 1000 / 60) { const m = P.mix(L ? [L] : [], t, {}, P.lyingAt(S, t, {}, { tk: 0.7 })), tr = P.apply(base0(1.1659, 0.5, 0.5), m, { w: 1, h: 1 }), mt = P.matrixOf(tr); const row = [...mt.map((v) => v * 2), ...(t > (L?.at ?? -1) + 20 ? [m.x, m.y] : [])];      /* the picture's shape always; its place from the frame after the contact (the blow throws it at once, on purpose) */
    if (prev) jump = Math.max(jump, ...row.map((v, i) => (i < prev.length ? Math.abs(v - prev[i]) : 0))); prev = row; out.push(m); } return { jump, out }; };
  const D = P.plan("down", { amt: 0.8, step: 2, seed: "K|health|1", at: 1000, lie: true, lieSide: 1, dir: { x: 1, y: 0 } });
  const S = { side: 1, fallAt: P.lieFallAt(D), upAt: Infinity };
  const fall = run(D, S, 990, 3000);
  ck(`the fall: the blow still throws it on the contact frame, no jump in the drawn picture on the way down (largest step ${fall.jump.toFixed(3)})`, Math.hypot(fall.out[1].x, fall.out[1].y) > 0.08 && fall.jump < 0.2);
  const landed = fall.out.at(-1);
  ck("the fall ends in the lying pose (flat, dim, on its square)", Math.abs(landed.fy - P.LIE.flat) < 1e-9 && landed.lie === 1 && Math.abs(landed.x) < 1e-9 && landed.y > 0 && landed.y <= 0.1 && landed.tint === P.TINTS.lie);
  const B = P.plan("back", { amt: 0.5, seed: "K|health|2", at: 20000 });
  const S2 = { ...S, upAt: 20000 };
  const rise = run(B, S2, 19990, 20000 + Math.max(B.dur, P.LIE.upMs) + 40);
  ck(`getting up: no jump in the drawn picture (largest step ${rise.jump.toFixed(3)}), the spring still leaves the floor, upright and clean at the end`, rise.jump < 0.2 && Math.min(...rise.out.map((m) => m.y)) < -0.08 && P.isRest(rise.out.at(-1)));
  const alone = run(null, { side: -1, fallAt: 1000, upAt: 3000 }, 990, 3600);
  ck(`with no reaction at all (the state alone): falls and rises without a jump (largest step ${alone.jump.toFixed(3)})`, alone.jump < 0.2 && P.isRest(alone.out.at(-1)));
}

/* ---------------- 5. seats: the same state and clock give the same drawing ---------------- */
{
  const L = () => P.plan("stress", { amt: 0.4, step: 0, seed: "tok|resolve|77", at: 5000, dir: null });
  let same = true;
  for (let t = 4990; t < 6200; t += 7) {
    const a = P.apply(base0(1.1659, 0.5, 0.5), P.mix([L()], t, {}, P.lyingAt({ side: P.lieSide("tok"), fallAt: -Infinity, upAt: Infinity }, t, {}, { tk: 0.7 })), { w: 350, h: 350 });
    const b = P.apply(base0(1.1659, 0.5, 0.5), P.mix([L()], t, {}, P.lyingAt({ side: P.lieSide("tok"), fallAt: 1200, upAt: Infinity }, t, {}, { tk: 0.7 })), { w: 350, h: 350 });      // a seat that saw the fall, a seat that loaded later
    if (JSON.stringify(a) !== JSON.stringify(b)) same = false;
  }
  ck("a seat that saw the fall and a seat that joined later draw a lying token and its reaction alike", same);
}

/* ---------------- runtime on a fake Foundry ---------------- */
let T = 100000;
Object.defineProperty(globalThis, "performance", { value: { now: () => T, timeOrigin: 0 }, configurable: true, writable: true });
const hooks = {};
globalThis.Hooks = { on: (k, fn) => ((hooks[k] ??= []).push(fn), hooks[k].length), once: (k, fn) => ((hooks[k] ??= []).push(fn), 1), off: () => {}, callAll: (k, ...a) => { for (const fn of hooks[k] ?? []) fn(...a); } };
const values = {}, settings = new Map();
globalThis.game = { user: { isGM: false, id: "P1" }, i18n: { lang: "en" }, settings: { settings, register: (m, k, o) => { settings.set(`${m}.${k}`, o); if (!(`${m}.${k}` in values)) values[`${m}.${k}`] = o.default; }, get: (m, k) => values[`${m}.${k}`] }, modules: new Map() };
globalThis.CONST = { CANVAS_PERFORMANCE_MODES: { LOW: 0 } };
let reduce = false;
globalThis.matchMedia = () => ({ matches: reduce });
globalThis.foundry = { utils: { expandObject: (o) => o, getProperty: (o, p) => p.split(".").reduce((c, k) => c?.[k], o) } };
class Emitter { constructor() { this.l = {}; } on(k, fn) { (this.l[k] ??= []).push(fn); } off(k, fn) { this.l[k] = (this.l[k] ?? []).filter((x) => x !== fn); } emit(k) { for (const fn of [...(this.l[k] ?? [])]) fn(); } }
const renderer = new Emitter(), tickers = new Set();
const scene = { id: "S" }, toks = [];
globalThis.canvas = { ready: true, scene, grid: { size: 100 }, performance: { mode: 2 }, app: { renderer, ticker: { add: (fn) => tickers.add(fn), remove: (fn) => tickers.delete(fn) } }, tokens: { get: (id) => toks.find((t) => t.id === id), get placeables() { return toks; } } };
const point = (x, y) => ({ x, y, set(a, b) { this.x = a; this.y = b ?? a; } });
function mkTok(id, hp, o = {}) {
  const actor = { id: `a${id}`, type: "npc", system: { derived: { health: { value: hp, max: 8 }, resolve: { value: 4, max: 8 } } }, getActiveTokens: () => toks.filter((t) => t.actor === actor) };
  const mesh = { position: point((o.x ?? 0) + 50, 50), scale: point(o.sx ?? 0.5, 0.5), rotation: o.rot ?? 0, tint: 0xffffff, visible: true, destroyed: false };
  if (o.skew !== false) mesh.skew = point(0, 0);
  const tok = { id, document: { x: o.x ?? 0, y: 0, hidden: false, width: 1 }, mesh, actor, scene, visible: true, destroyed: false, w: 100, get center() { return { x: mesh.position.x, y: mesh.position.y }; } };
  toks.push(tok);
  return tok;
}
const M = await import("../tokenanim/main.mjs");
M.start({ init: true });
M._test.setStarted(true);
const snap = (m) => JSON.stringify({ x: m.position.x, y: m.position.y, r: m.rotation, sx: m.scale.x, sy: m.scale.y, kx: m.skew?.x, ky: m.skew?.y, t: m.tint });
const frame = (fn) => { for (const g of [...tickers]) g(); renderer.emit("prerender"); const r = fn?.(); renderer.emit("postrender"); return r; };
const drawn = (tok) => frame(() => ({ rotation: tok.mesh.rotation, sx: tok.mesh.scale.x, sy: tok.mesh.scale.y, skewX: tok.mesh.skew?.x ?? 0, skewY: tok.mesh.skew?.y ?? 0, x: tok.mesh.position.x, y: tok.mesh.position.y, tint: tok.mesh.tint }));
const Faced = mkTok("Faced", 0, { x: 0, rot: 1.1659 }), Mirror = mkTok("Mirror", 0, { x: 200, rot: 4.712, sx: -0.5 }), Stand = mkTok("Stand", 5, { x: 400, rot: 0.3 }), Plain = mkTok("Plain", 0, { x: 600, rot: 0.8, skew: false }), Unturned = mkTok("Unturned", 0, { x: 800, rot: 0 });
Hooks.callAll("canvasTearDown"); for (const t of toks) Hooks.callAll("drawToken", t); Hooks.callAll("canvasReady");
{
  /* Unturned: the usual token (rotation 0). Its quarter turn makes the skew come out exactly 0, and the squash is all in the scale: the
     first live take drew it as a full circle because the drawing took the squash only together with a skew */
  for (const tok of [Faced, Mirror, Unturned]) {
    const before = snap(tok.mesh), d = drawn(tok), b = drawnBox({ ...d, sx: d.sx / 0.5, sy: d.sy / 0.5 });
    ck(`${tok.id}: a token (unturned, turned to face, mirrored) is drawn as the low oval (${(2 * b.rw).toFixed(2)} x ${(2 * b.rh).toFixed(2)} of its square), a little down, dark`, Math.abs(b.rh / b.rw - P.LIE.flat) < 1e-9 && d.y > 50 && d.y <= 60 && Math.abs(2 * b.rh - P.LIE.flat * (1 - P.LIE.size)) < 1e-9 && d.tint !== 0xffffff && (tok === Unturned || d.skewX !== 0 || d.skewY !== 0));
    ck(`${tok.id}: ... only for one drawing: the picture, its skew included, is back exactly after it`, snap(tok.mesh) === before);
  }
  const before = snap(Stand.mesh);
  ck("a standing token is not touched", JSON.stringify(drawn(Stand)) === JSON.stringify({ rotation: 0.3, sx: 0.5, sy: 0.5, skewX: 0, skewY: 0, x: 450, y: 50, tint: 0xffffff }) && snap(Stand.mesh) === before);
  const pb = snap(Plain.mesh), pd = drawn(Plain);
  ck("a picture without a skew of its own still lies (turned, smaller, dark) and nothing throws", Math.abs(Math.abs(pd.rotation - 0.8) - P.LIE.rot) < 1e-9 && Math.abs(pd.sx) < 0.5 && pd.tint !== 0xffffff && snap(Plain.mesh) === pb);
}
/* a reaction on the lying token, drawn: on its square at every frame, everything back after every frame */
{
  const L = M.react(Faced, { kind: "out", amt: 0.9, step: 0, seed: "Faced|resolve|1", at: T + 100 });
  let worst = 0, clean = true; const before = snap(Faced.mesh);
  for (let i = 0; i < 140; i++) { T += 1000 / 60; const d = drawn(Faced), b = drawnBox({ ...d, sx: d.sx / 0.5, sy: d.sy / 0.5 }); worst = Math.max(worst, Math.abs(d.x - 50) / 100 + b.rw, Math.abs(d.y - 50) / 100 + b.rh); if (snap(Faced.mesh) !== before) clean = false; }
  ck(`Resolve out on the lying token, as drawn: on its own square at every frame (reach ${worst.toFixed(3)} of ${(0.5 + P.LIE.slack).toFixed(2)})`, !!L && worst <= 0.5 + P.LIE.slack + 1e-9);
  ck("... and the picture is back exactly after every drawing", clean);
}
/* posed: whoever reads the pictures in one call (the impact frame's figures) sees a lying token lying */
{
  const b = [Faced, Stand, Mirror].map((t) => snap(t.mesh));
  let inside = null;
  const r = M.posed([Faced, Stand, null, Mirror], () => { inside = [Faced, Stand, Mirror].map((t) => ({ r: t.mesh.rotation, sx: t.mesh.scale.x, sy: t.mesh.scale.y })); return 42; });
  ck("posed: inside the call a lying token's picture is in its lying turn and size", r === 42 && Math.abs(Math.abs(inside[0].r - 1.1659) - P.LIE.rot) < 1e-9 && Math.abs(inside[0].sx) < 0.5 && Math.abs(Math.abs(inside[2].r - 4.712) - P.LIE.rot) < 1e-9 && inside[2].sx < 0 && inside[2].sx > -0.5);
  ck("posed: a standing token is as it is", inside[1].r === 0.3 && inside[1].sx === 0.5);
  ck("posed: every picture is back exactly after the call", [Faced, Stand, Mirror].every((t, i) => snap(t.mesh) === b[i]));
  let threw = false; try { M.posed([Faced], () => { throw new Error("x"); }); } catch { threw = true; }
  ck("posed: a call that throws still leaves the pictures back", threw && snap(Faced.mesh) === b[0]);
  reduce = true;
  M.posed([Faced], () => { inside = Faced.mesh.rotation; });
  ck("posed: a seat with reduced motion (it draws no tipping) poses nothing", inside === 1.1659);
  reduce = false;
  values["invincible-plus-ultra.tokenAnimOn"] = false;
  M.posed([Faced], () => { inside = Faced.mesh.rotation; });
  ck("posed: the table's switch off poses nothing", inside === 1.1659);
  values["invincible-plus-ultra.tokenAnimOn"] = true;
  const react = readFileSync(join(root, "tokenreact", "main.mjs"), "utf8");
  ck("the token reaction's impact frame is asked inside posed (the struck token, its attacker, the rest of the crowd)", /TokAnim\.posed\(\[tok, spec\.from, \.\.\.\(spec\.also \?\? \[\]\)\], \(\) => I\.play\(spec\)\)/.test(react) && (react.match(/I\.play\(/g) ?? []).length === 1);
}
console.log(`sweep lying: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
