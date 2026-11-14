// node scripts/sweep-checks/tokanim.mjs  (TOKANIM: the token itself moves with its reactions, scripts/tokenanim/).
// Pure part: every reaction kind has a default animation that moves, blows jolt on the contact instant, every animation ends at rest,
// strength follows the amount and builds across a series, reduced motion keeps no movement, the tint never jumps in on one frame, a newer
// reaction takes over. Runtime part on a fake Foundry: the pose is on the token's picture ONLY between "prerender" and "postrender" and
// every value comes back exactly; the token's document (x / y included) is never written; a hidden, unseen or deleted token, a scene change
// and a lost frame all clean up; nothing listens while nothing plays; the privacy rule (the kind and amount this seat letters) is pinned in
// the caller; many tokens at once stay cheap. Fails on tactics @ 00955a8 (no scripts/tokenanim/).
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const dir = dirname(fileURLToPath(import.meta.url)), root = join(dir, "..");
if (!existsSync(join(root, "tokenanim", "pure.mjs"))) { ck("scripts/tokenanim/ exists", false); console.log(`sweep tokanim: ${n} checks, ${f} failed`); process.exit(1); }

const P = await import("../tokenanim/pure.mjs");
const mag = (p) => Math.hypot(p.x, p.y) + Math.abs(p.rot) + Math.abs(p.sx - 1) + Math.abs(p.sy - 1);
const peak = (L) => { let m = 0; for (let t = 0; t < L.dur; t += 1000 / 60) m = Math.max(m, mag(P.mix([L], L.at + t))); return m; };

/* ---------------- pure ---------------- */
for (const k of P.EVENTS) {
  const d = P.DEFAULTS[k];
  ck(`default for ${k} exists and is not "none"`, d && d.anim !== "none" && !!P.ANIMS[d.anim]);
  ck(`default for ${k} fits it (listed first among its fits)`, P.FITS[k]?.[0] === d.anim);
  const L = P.plan(k, { amt: 0.3, seed: "x", at: 1000 });
  ck(`${k}: the default plays (a layer)`, !!L && L.dur > 300);
  ck(`${k}: the default visibly moves the token (peak pose > 0.05)`, L && peak(L) > 0.05);
  ck(`${k}: rest before the contact instant`, L && P.isRest(P.mix([L], 999)));
  ck(`${k}: rest after its end (nothing stays changed)`, L && P.isRest(P.mix([L], 1000 + L.dur + 1)));
}
for (const id of P.ANIM_IDS) {
  if (id === "none") { ck("none plays nothing", P.plan("hit", { anim: "none" }) === null); continue; }
  for (const A of [0.3, 1, 2.4]) {
    const L = { ...P.plan("hit", { anim: id, amt: 1, step: 4, seed: "s", at: 0 }), A };
    let finite = true, sane = true;
    for (let t = -50; t < L.dur + 100; t += 7) {
      const p = P.mix([L], t);
      if (![p.x, p.y, p.rot, p.sx, p.sy, p.tk].every(Number.isFinite)) finite = false;
      if (p.sx < 0.5 || p.sy < 0.5 || p.sx > 1.6 || p.sy > 1.6 || Math.hypot(p.x, p.y) > 1.2) sane = false;
    }
    ck(`${id} at A ${A}: every pose finite`, finite);
    ck(`${id} at A ${A}: the picture stays near its token (move < 1.2 token, size 0.5..1.6)`, sane);
    ck(`${id} at A ${A}: ends at rest`, P.isRest(P.mix([L], L.dur + 1)));
  }
}
/* the token reacts ON the contact instant: a blow is already thrown on the contact frame (the drawing where the word strikes) */
for (const k of ["hit", "heavy", "down"]) { const L = P.plan(k, { amt: 0.5, seed: "c", at: 500 }); ck(`${k}: thrown on the contact frame itself`, Math.hypot(P.mix([L], 500).x, P.mix([L], 500).y) > 0.08); }
/* strength follows the amount and builds across a series (the lettering's STREAK) */
{
  const a = (o) => P.plan("hit", { seed: "s", ...o }).A;
  ck("more damage, a stronger animation", a({ amt: 0 }) < a({ amt: 0.5 }) && a({ amt: 0.5 }) < a({ amt: 1 }));
  ck("the next blow of a series is stronger", a({ amt: 0.3, step: 0 }) < a({ amt: 0.3, step: 1 }) && a({ amt: 0.3, step: 1 }) < a({ amt: 0.3, step: 2 }));
  const s0 = peak(P.plan("hit", { amt: 0.25, step: 0, seed: "q", at: 0 })), s1 = peak(P.plan("hit", { amt: 0.25, step: 1, seed: "q", at: 0 }));
  const s2 = peak(P.plan("heavy", { amt: 0.5, step: 2, seed: "q", at: 0 })), s3 = peak(P.plan("down", { amt: 0.8, step: 3, seed: "q", at: 0 }));
  ck(`a series hit, hit, heavy, down builds (${s0.toFixed(2)} < ${s1.toFixed(2)} < ${s2.toFixed(2)} < ${s3.toFixed(2)})`, s0 < s1 && s1 < s2 && s2 < s3);
  ck("the GM's intensity scales it", a({ amt: 0.3, strength: 0.5 }) < a({ amt: 0.3, strength: 1 }) && a({ amt: 0.3, strength: 1 }) < a({ amt: 0.3, strength: 2 }));
  ck("intensity 0 plays nothing", P.plan("hit", { strength: 0 }) === null);
  ck("a series is capped (no runaway)", a({ amt: 1, step: 99, strength: 2 }) <= P.SCALE.aMax);
}
/* reduced motion, gentle, off; the tint */
{
  ck("off: nothing", P.plan("down", { mode: "off" }) === null);
  const st = P.plan("down", { amt: 1, mode: "still", seed: "r", at: 0 });
  let moved = false, tinted = false;
  for (let t = 0; t < st.dur; t += 10) { const p = P.mix([st], t); if (Math.hypot(p.x, p.y) > 1e-9 || Math.abs(p.rot) > 1e-9 || Math.abs(p.sx - 1) > 1e-9 || Math.abs(p.sy - 1) > 1e-9) moved = true; if (p.tk > 0.05) tinted = true; }
  ck("reduced motion: the token does not move at all", !moved);
  ck("reduced motion: a short tint still says it", tinted);
  ck("gentle: half the moves", Math.abs(P.plan("hit", { mode: "gentle", seed: "g" }).A - P.plan("hit", { seed: "g" }).A * P.SCALE.gentle) < 1e-3);
  ck("OS reduced motion -> still", P.modeOf({ osReduced: true }) === "still" && P.modeOf({ letr: "reduced" }) === "still" && P.modeOf({ low: true }) === "still");
  ck("the lettering's Motion 'full' overrules the OS switch only when set", P.modeOf({ letr: "full", osReduced: true }) === "full" && P.modeOf({ letr: "auto", osReduced: true }) === "still");
  ck("each user's own switch wins", P.modeOf({ mine: "off", letr: "full" }) === "off" && P.modeOf({ mine: "gentle" }) === "gentle");
  for (const k of P.EVENTS) { const L = P.plan(k, { amt: 1, seed: "t", at: 0 }); ck(`${k}: the tint comes in over >= 40 ms (no one-frame jump)`, P.mix([L], 0).tk < 1e-9 && P.mix([L], 1000 / 60).tk <= (1000 / 60) / 40 + 1e-6); }
  ck("photosensitivity guard and flashes off soften the tint", P.tintK({ photosafe: true }) < 1 && P.tintK({ flashes: false }) < P.tintK({ photosafe: true }));
  ck("tint multiplies onto the picture's own", P.tintOf(0xffffff, 0xff0000, 1) === 0xff0000 && P.tintOf(0x808080, 0xffffff, 1) === 0x808080 && P.tintOf(0xffffff, 0x000000, 0) === 0xffffff);
}
/* the same on every seat; a takeover; a stored table made safe */
{
  const a = P.plan("heavy", { amt: 0.4, step: 1, seed: "T|health|123", at: 10 }), b = P.plan("heavy", { amt: 0.4, step: 1, seed: "T|health|123", at: 10 });
  ck("same seed, same plan (every seat)", JSON.stringify(a) === JSON.stringify(b));
  const sides = new Set(Array.from({ length: 40 }, (_, i) => P.plan("hit", { seed: `s${i}` }).c.side));
  ck("with no seen attacker the side comes from the seed (both sides occur)", sides.size === 2);
  const away = P.plan("hit", { seed: "s", dir: { x: -3, y: 0 }, at: 0 });
  ck("a seen attacker on the right throws the token to the left", P.mix([away], 0).x < -0.05);
  const L1 = P.plan("down", { amt: 1, seed: "o", at: 0 }), L2 = P.plan("heal", { amt: 0.5, seed: "n", at: 700 });
  const before = Math.abs(P.mix([L1], 700 + P.TAKEOVER + 10).rot), after = Math.abs(P.mix([L1, L2], 700 + P.TAKEOVER + 10).rot);
  ck("a newer reaction takes over: the older one is gone TAKEOVER ms after the newer one's contact", before > 0.3 && after < 1e-6);
  const spun = P.plan("hit", { anim: "spin", amt: 1, step: 4, strength: 2, seed: "sp", at: 0 }), nx = P.plan("hit", { seed: "n", at: 900 });
  let jump = 0, prev = null;
  for (let t = 880; t < 900 + P.TAKEOVER; t += 1000 / 60) { const r = P.mix([spun, nx], t).rot; if (prev !== null) { const d = Math.abs(r - prev) % (2 * Math.PI); jump = Math.max(jump, Math.min(d, 2 * Math.PI - d)); } prev = r; }
  ck("a spun token handed over turns back the short way (no whirl in the takeover)", jump < 1.2);
  const c = P.cleanEvents({ hit: { anim: "bogus", str: 9 }, heavy: { anim: "spin", str: "0.5" }, nope: {} });
  ck("stored table: unknown animation -> default, intensity clamped, numbers read, every kind present", c.hit.anim === "recoil" && c.hit.str === 2 && c.heavy.anim === "spin" && c.heavy.str === 0.5 && Object.keys(c).length === P.EVENTS.length && !("nope" in c));
  const base = { x: 10, y: 20, rotation: 0.3, sx: -1, sy: 1, tint: 0xffffff }, copy = JSON.stringify(base);
  const out = P.apply(base, { x: 0.1, y: 0, rot: 0.2, sx: 0.9, sy: 1.1, tint: 0xff0000, tk: 0.5 }, { w: 100, h: 100 });
  ck("apply: on top of the base (a mirrored picture stays mirrored), the base itself untouched", out.x === 20 && Math.abs(out.rotation - 0.5) < 1e-9 && out.sx === -0.9 && JSON.stringify(base) === copy);
}

/* ---------------- runtime on a fake Foundry ---------------- */
const hooks = {};
globalThis.Hooks = { on: (k, fn) => ((hooks[k] ??= []).push(fn), (hooks[k].length)), once: (k, fn) => ((hooks[k] ??= []).push(fn), 1), off: () => {}, callAll: (k, ...a) => { for (const fn of hooks[k] ?? []) fn(...a); } };
const values = {}, settings = new Map();
globalThis.game = { user: { isGM: false, id: "P1" }, i18n: { lang: "en" }, settings: { settings, register: (m, k, o) => { settings.set(`${m}.${k}`, o); if (!(`${m}.${k}` in values)) values[`${m}.${k}`] = o.default; }, get: (m, k) => values[`${m}.${k}`] }, modules: new Map() };
globalThis.CONST = { CANVAS_PERFORMANCE_MODES: { LOW: 0 } };
let reduce = false;
globalThis.matchMedia = () => ({ matches: reduce });
class Emitter { constructor() { this.l = {}; } on(k, fn) { (this.l[k] ??= []).push(fn); } off(k, fn) { this.l[k] = (this.l[k] ?? []).filter((x) => x !== fn); } emit(k) { for (const fn of [...(this.l[k] ?? [])]) fn(); } count() { return Object.values(this.l).reduce((a, v) => a + v.length, 0); } }
const renderer = new Emitter(), tickers = new Set();
const scene = { id: "S" };
const toks = [];
globalThis.canvas = { ready: true, scene, grid: { size: 100 }, performance: { mode: 2 }, app: { renderer, ticker: { add: (fn) => tickers.add(fn), remove: (fn) => tickers.delete(fn) } }, tokens: { get: (id) => toks.find((t) => t.id === id), placeables: toks } };
const docWrites = [];
function point(x, y) { return { x, y, set(a, b) { this.x = a; this.y = b ?? a; } }; }
function mkTok(id, x, y, o = {}) {
  const src = { x, y, hidden: !!o.hidden, width: 1 };
  const document = new Proxy(src, { set: (t, k, v) => { docWrites.push(k); t[k] = v; return true }, get: (t, k) => (k === "update" ? (...a) => { docWrites.push(["update", a]); } : t[k]) });
  const mesh = { position: point(x + 50, y + 50), scale: point(0.5, 0.5), rotation: 0, tint: 0xffffff, visible: true, destroyed: false };
  const tok = { id, document, mesh, scene, visible: true, destroyed: false, w: 100, get center() { return { x: mesh.position.x, y: mesh.position.y }; } };
  toks.push(tok);
  return tok;
}
const M = await import("../tokenanim/main.mjs");
M.start({ init: true });
M._test.setStarted(true);
const snap = (m) => JSON.stringify({ x: m.position.x, y: m.position.y, r: m.rotation, sx: m.scale.x, sy: m.scale.y, t: m.tint });
const frame = (fn) => { for (const g of [...tickers]) g(); renderer.emit("prerender"); const r = fn?.(); renderer.emit("postrender"); return r; };
const now = () => performance.now();
ck("settings registered: world on, world events, client own screen", values["invincible-plus-ultra.tokenAnimOn"] === true && settings.get("invincible-plus-ultra.tokenAnimEvents")?.scope === "world" && settings.get("invincible-plus-ultra.tokenAnimMine")?.scope === "client");
{
  const A = mkTok("A", 0, 0), B = mkTok("B", 300, 0);
  ck("nothing listens while nothing plays", renderer.count() === 0 && tickers.size === 0);
  const before = snap(A.mesh);
  const L = M.react(A, { kind: "hit", amt: 0.5, step: 0, seed: "A|health|1", at: now() - 5, from: B });
  ck("a reaction of a seen token plays", !!L);
  ck("listening while it plays", renderer.count() === 2 && tickers.size === 1);
  let during = null;
  frame(() => { during = snap(A.mesh); });
  const dp = JSON.parse(during);
  ck("during the drawing the picture is moved (away from the attacker on its right: to the left)", dp.x < 50 - 3);
  ck("after the drawing every value is back exactly", snap(A.mesh) === before);
  ck("the token's document is never written (x / y included)", docWrites.length === 0 && A.document.x === 0 && A.document.y === 0);
  /* Foundry moves the token meanwhile (its own movement animation): our pose rides on top and gives Foundry's value back */
  A.mesh.position.set(80, 60);
  const moved = snap(A.mesh);
  frame(() => { during = JSON.parse(snap(A.mesh)); });
  ck("a token moving while it reacts: the pose is on top of Foundry's new place", Math.abs(during.x - 80) > 1 && Math.abs(during.x - 80) < 60);
  ck("... and Foundry's new place is given back exactly", snap(A.mesh) === moved);
  /* a lost frame: prerender without postrender is healed at the next tick */
  renderer.emit("prerender");
  ck("a drawing that never finished leaves the picture moved...", snap(A.mesh) !== moved);
  for (const g of [...tickers]) g();
  ck("... until the next tick puts it back", snap(A.mesh) === moved && M._test.saved.length === 0);
  renderer.emit("postrender");
  /* a newer reaction interrupts: at most a few layers, the newest wins */
  for (let i = 0; i < 6; i++) M.react(A, { kind: "hit", amt: 0.3, step: i, seed: `i${i}`, at: now() + i });
  ck("a new reaction interrupting an old one: layers are bounded", M._test.active.get("A").layers.length <= 3);
  /* the token hidden from this player mid-reaction: it stops at once and its picture is untouched */
  A.document.hidden = true; docWrites.length = 0;
  const hid = snap(A.mesh);
  frame(() => { during = snap(A.mesh); });
  ck("hidden from a player mid-reaction: stopped, the picture never moved", during === hid && !M._test.active.has("A"));
  ck("a hidden token never starts for a player", M.react(A, { kind: "down", amt: 1, at: now() }) === null);
  A.document.hidden = false;
  /* out of this user's sight (Foundry's own visibility) */
  A.visible = false;
  ck("an unseen token (out of sight) never starts", M.react(A, { kind: "hit", amt: 1, at: now() }) === null);
  A.visible = true;
  ck("an attacker this seat does not see gives no direction (seeded side instead)", (() => { B.visible = false; const L2 = M.react(A, { kind: "hit", amt: 0.5, seed: "A|health|1", from: B, at: now() }); B.visible = true; const L3 = P.plan("hit", { amt: 0.5, seed: "A|health|1", at: 0 }); return L2 && L2.c.dir.x === L3.c.dir.x && L2.c.dir.y === L3.c.dir.y; })());
  /* deleted */
  Hooks.callAll("deleteToken", { id: "A" });
  ck("a deleted token is dropped", !M._test.active.has("A"));
  /* every frame ends; nothing left listening */
  M.react(B, { kind: "hit", amt: 0.1, at: now() - 10000 });
  frame();
  ck("when everything has ended nothing listens any more", renderer.count() === 0 && tickers.size === 0);
  /* scene change */
  M.react(B, { kind: "down", amt: 1, at: now() });
  Hooks.callAll("canvasTearDown");
  ck("a scene change drops everything and stops listening", M._test.active.size === 0 && renderer.count() === 0);
  /* the token's document is replaced on the canvas (a redraw): the old placeable is not driven */
  M.react(B, { kind: "hit", amt: 0.5, at: now() - 5 });
  const B2 = mkTok("B", 300, 0); toks.splice(toks.indexOf(B), 1);
  const bsnap = snap(B.mesh);
  frame();
  ck("a redrawn token (a new placeable) is not driven through the old one", snap(B.mesh) === bsnap && !M._test.active.has("B"));
  void B2;
}
/* reduced motion and each user's own switch, live */
{
  const C = mkTok("C", 0, 400);
  reduce = true;
  const before = snap(C.mesh);
  M.react(C, { kind: "down", amt: 1, at: now() - 200 });
  let during = null;
  frame(() => { during = JSON.parse(snap(C.mesh)); });
  const b = JSON.parse(before);
  ck("OS reduced motion: the picture does not move (a tint only)", during.x === b.x && during.y === b.y && during.r === b.r && during.sx === b.sx && during.t !== b.t);
  reduce = false; M.stopAll(); frame();
  values["invincible-plus-ultra.tokenAnimMine"] = "off";
  ck("own screen off: nothing", M.react(C, { kind: "hit", amt: 1, at: now() }) === null);
  values["invincible-plus-ultra.tokenAnimMine"] = "full";
  values["invincible-plus-ultra.tokenAnimOn"] = false;
  ck("the GM switched it off for the table: nothing (a preview still plays)", M.react(C, { kind: "hit", amt: 1, at: now() }) === null && !!M.preview(C, "hit"));
  values["invincible-plus-ultra.tokenAnimOn"] = true;
  values["invincible-plus-ultra.tokenAnimEvents"] = { ...P.cleanEvents(null), hit: { anim: "none", str: 1 } };
  ck("the GM's 'none' for an event: nothing", M.react(C, { kind: "hit", amt: 1, at: now() }) === null);
  values["invincible-plus-ultra.tokenAnimEvents"] = P.cleanEvents(null);
  M.stopAll(); frame();
  /* the map's death look owns the body */
  C._mmDead = true;
  const s0 = JSON.parse(snap(C.mesh));
  M.react(C, { kind: "down", amt: 1, at: now() - 300 });
  frame(() => { during = JSON.parse(snap(C.mesh)); });
  ck("while the map module shows the token dead its body is not moved", during.x === s0.x && during.r === s0.r && during.sy === s0.sy);
  C._mmDead = false; M.stopAll(); frame();
}
/* many tokens at once stay cheap: 60 reacting tokens, 300 drawings */
{
  const many = Array.from({ length: 60 }, (_, i) => mkTok(`m${i}`, (i % 10) * 100, Math.floor(i / 10) * 100 + 1000));
  for (const [i, tk] of many.entries()) M.react(tk, { kind: P.EVENTS[i % P.EVENTS.length], amt: 0.6, step: i % 3, seed: `m${i}`, at: now() + (i % 7) * 20 });
  const snaps = many.map((tk) => snap(tk.mesh));
  const t0 = now();
  for (let i = 0; i < 300; i++) frame();
  const per = (now() - t0) / 300;
  ck(`60 tokens reacting at once: ${per.toFixed(3)} ms per drawing (< 0.6 ms in node)`, per < 0.6);
  ck("... and every picture is back exactly after every drawing", many.every((tk, i) => snap(tk.mesh) === snaps[i]));
  M.stopAll(); frame();
}
/* the caller: the kind and amount THIS SEAT letters, on the word's contact (source pins on scripts/tokenreact/main.mjs) */
{
  const src = readFileSync(join(root, "tokenreact", "main.mjs"), "utf8");
  ck("tokenreact imports the token's motion", /import \* as TokAnim from "\.\.\/tokenanim\/main\.mjs"/.test(src));
  const fn = src.slice(src.indexOf("function tokenMoves"), src.indexOf("function tokenMoves") + 900);
  ck("privacy: the motion takes the kind and amount this seat letters (it.lk), never the raw change", /kind: it\.lk\.kind/.test(fn) && /amt: it\.lk\.amt/.test(fn) && !/classify|\bc\.kind|e\.from|e\.to\b/.test(fn));
  ck("one moment: the motion starts on the word's contact as the engine reads it (L.contactAt), else the shared blow instant", /L\.contactAt\(word\)/.test(fn) && /tHit/.test(fn));
  ck("the motion is started inside play() (after the visibility check of the seat)", /settle\(\);\s*\n\s*tokenMoves\(L, it, tok, word, tHit\);/.test(src));
  const anim = readFileSync(join(root, "tokenanim", "main.mjs"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  ck("the token's motion reads no character data (it cannot leak hidden Health)", !/\.actor\b|system\.|derived/.test(anim));
  ck("the token's motion never writes a document (no update, no setFlag)", !/\.update\(|updateEmbedded|setFlag|\.document\.\w+\s*=[^=]/.test(anim));
}
console.log(`sweep tokanim: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
