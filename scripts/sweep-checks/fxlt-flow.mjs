// node scripts/sweep-checks/fxlt-flow.mjs  (FXLT: the token reactions' fixes after the blind review ADVT, driven through a fake Foundry
// with a real view: a stage that pans and zooms, the interface around the canvas, the director's letterbox bars). Every check names the
// review finding it guards (R<n> = ADVT finding n). It only watches what main.mjs hands the engine (L.play / stop), so it runs on the
// code before the fix too (where these checks fail).
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- a fake Foundry with a view ---------- */
const hooks = {};
globalThis.Hooks = { on: (k, fn) => ((hooks[k] ??= []).push(fn), 1), once: (k, fn) => ((hooks[k] ??= []).push(fn), 1), callAll: (k, ...a) => { for (const fn of hooks[k] ?? []) fn(...a); } };
const settings = new Map(), values = { "invincible-plus-ultra.tokenReactEnabled": true, "invincible-plus-ultra.tokenReactSize": "normal" };
const user = { isGM: true, id: "U" };
globalThis.game = {
  user, i18n: { lang: "pl", has: () => false, localize: (k) => k },
  settings: { settings, register: (m, k, o) => settings.set(`${m}.${k}`, o), get: (m, k) => values[`${m}.${k}`] },
  modules: new Map([["invincible-plus-ultra", { api: {} }]]), combats: new Map(), messages: { contents: [] }
};
globalThis.foundry = { utils: { getProperty: (o, p) => p.split(".").reduce((a, k) => a?.[k], o), expandObject: (o) => o } };
globalThis.CONST = { CANVAS_PERFORMANCE_MODES: { LOW: 0 } };
const VW = 1600, VH = 900;
globalThis.innerWidth = VW; globalThis.innerHeight = VH;
/* the interface: the sidebar on the right (from 1300), the hotbar at the bottom middle, and the director's bars when `bars` is on */
let bars = false;
const el = (x, y, w, h) => ({ getBoundingClientRect: () => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h }) });
const UI = { "#sidebar": [el(1300, 0, 300, VH)], "#hotbar": [el(500, 830, 600, 60)] };
globalThis.document = { querySelector: () => null, querySelectorAll: (sel) => (sel === ".mm-cin > div" ? (bars ? [el(0, 0, VW, 110), el(0, VH - 110, VW, 110)] : []) : UI[sel] ?? []) };
globalThis.getComputedStyle = () => ({ visibility: "visible" });
const cam = { x: 0, y: 0, z: 1 };      // the world point at the view's top-left, and the zoom
const stage = { scale: { get x() { return cam.z; } }, toGlobal: (p) => ({ x: (p.x - cam.x) * cam.z, y: (p.y - cam.y) * cam.z }), toLocal: (q) => ({ x: q.x / cam.z + cam.x, y: q.y / cam.z + cam.y }) };
const scene = { id: "S" };
const toks = [];
globalThis.canvas = { ready: true, scene, grid: { size: 100 }, performance: { mode: 2 }, stage, app: { view: { getBoundingClientRect: () => ({ left: 0, top: 0, right: VW, bottom: VH, width: VW, height: VH }) } },
  tokens: { placeables: toks, get: (id) => toks.find((t) => t.id === id) } };
let stamp = 1000;
function mk(id, type, h, r, o = {}) {
  const actor = { id: `A${id}`, type, hasPlayerOwner: !!o.player, system: { derived: { health: { value: h, max: o.hm ?? 8 }, resolve: { value: r, max: 8 } } },
    testUserPermission: () => !!o.observer, _stats: { modifiedTime: stamp } };
  const tok = { id, scene, isVisible: true, document: { id, hidden: false }, actor, x: o.x ?? 0, y: o.y ?? 0, w: 100, h: 100, destroyed: false };
  Object.defineProperty(tok, "center", { get: () => ({ x: tok.x + 50, y: tok.y + 50 }) });
  actor.getActiveTokens = () => [tok];
  toks.push(tok);
  return tok;
}
/* one update as the server sends it: the new value and a new stamp */
const set = (tok, stat, v, options = {}, st = ++stamp) => { tok.actor._stats.modifiedTime = st; tok.actor.system.derived[stat].value = v; Hooks.callAll("updateActor", tok.actor, { system: { derived: { [stat]: { value: v } } } }, options); };

/* the engine: a recording stand-in (contract surface); an entrance of 500 ms (12 ticks), ready after 30 ms */
const { sizeFor } = await import("../letters/size.mjs");
const sizeK = (o) => 0.62 + 0.7 * (o?.sound?.loud ?? 0.6);
const ctxOf = (o) => ({ space: "world", magnitude: o.magnitude, scale: o.scale ?? 1, tokenSpan: 100, grid: 100, zoom: cam.z, vw: VW - 300, vh: VH, sizeK: sizeK(o), aspect: 3 });
const pxOf = (o) => sizeFor(ctxOf(o)).px;      // the cap height on screen the engine's model gives a play
const plays = [], stops = [];
const TALL = {};      // words the stand-in draws with a given hold box (w, h in caps), as the engine measures it
const fake = { version: "test", limits: { screen: 16, world: 48 }, ready: async () => true, count: () => 0,
  sizeOf: (text, o) => ({ ...sizeFor(ctxOf(o)), sizeK: sizeK(o) }),
  play: (text, o) => {
    const rec = { text, o, t: Date.now(), tp: performance.now(), stopped: null };
    const h = { id: `h${Math.random()}`, hand: o.hand?.id ?? "x", alive: true, opts: o, plan: { timeline: { ent: [{ ticks: 6 }, { ticks: 6 }] }, ...((TALL[text] ?? (/^[+-]?\d/.test(text) ? null : TALL["*"])) ? { _holdBox: TALL[text] ?? TALL["*"] } : {}) }, ready: sleep(30).then(() => true),
      finished: sleep((o.hold ?? 800) + 900).then(() => { h.alive = false; return "done"; }), stop(q) { rec.stopped = q ?? {}; stops.push(rec); h.alive = false; }, moveTo() {} };
    rec.h = h; plays.push(rec); return h;
  } };
/* FXLT2: the words come from the engine's vocabulary (the real one, scripts/letters/words.mjs) */
{ const { createVocab } = await import("../letters/words.mjs"); fake.vocab = createVocab(); fake.word = fake.vocab.word; }
globalThis.MoinenLetters = { copies: [], _engine: fake, async engine() { return this._engine; } };
const M = await import("../tokenreact/main.mjs");
M.start({ init: true, ready: true });
const take = async (ms = 1900) => { await sleep(ms); return plays.splice(0); };
const isNum = (r) => /^[+-]\d+$/.test(String(r.text));

/* where a play stands now, in screen px: its centre and its box (cap from the size model, width from the letters) */
function boxOf(r) {
  const o = r.o, cap = pxOf(o), w = cap * (0.66 * [...String(r.text)].length + 0.1), hgt = cap * 1.25;
  let c;
  const a = typeof o.at === "function" ? o.at() : o.at;
  if (a && a.id && !Number.isFinite(a.x)) {      // a token document: the engine's own rule (above the token, bottom anchor)
    const t = toks.find((x) => x.id === a.id), g = stage.toGlobal({ x: t.center.x, y: t.y - 8 });
    c = { x: g.x, y: g.y - hgt / 2 };
  } else c = stage.toGlobal(a);
  return { cx: c.x, cy: c.y, x: c.x - w / 2, y: c.y - hgt / 2, w, h: hgt, cap };
}
const tokScreen = (t) => { const g = stage.toGlobal({ x: t.x, y: t.y }); return { x: g.x, y: g.y, w: t.w * cam.z, h: t.h * cam.z }; };
const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const hue = (hex) => { const v = parseInt(hex.slice(1), 16), r = (v >> 16) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };

const hero = mk("H", "superhero", 8, 6, { player: true, x: 700, y: 400 });
Hooks.callAll("canvasReady");
await sleep(30);

/* R4: Health and Resolve of one token in one moment: one reaction, the heavier word, both numbers, nothing stopped */
set(hero, "health", 4); set(hero, "resolve", 5);
let p = await take();
{ const words = p.filter((r) => !isNum(r)), nums = p.filter(isNum);
  ck("R4 two tracks in one moment: one word, both numbers, the first word is not cut off", words.length === 1 && nums.map((r) => r.text).sort().join(",") === "-1,-4" && !words[0].stopped && words[0].o.mood === "crash"); }

/* R3: numbers in one legible hand: the same face and look for every number, no tilt of their own, not tiny next to the word */
{ const nums = p.filter(isNum), word = p.find((r) => !isNum(r));
  /* FXLT2 (ADVT2 13): the number hand's face is Bungee now (Titan One's 1 and 7 were mistaken for each other) */
  ck("R3 every number in the one number hand (Bungee, flat, no rough tilt), the same per track, at least 0.55 of the word's cap",
    nums.length === 2 && nums.every((r) => r.o.hand?.font === "bungee" && r.o.hand?.env === "flat" && Math.abs(r.o.rotation ?? 0) <= 4 && (r.o.sound?.rough ?? 1) <= 0.1)
    && nums[0].o.hand.id !== nums[1].o.hand.id && !!word && nums.every((r) => pxOf(r.o) >= 0.55 * pxOf(word.o))); }

/* R12: the number stands beside the word, not on the token's face; R13: it comes after the word has landed */
{ const word = p.find((r) => !isNum(r)), num = p.find((r) => r.text === "-4"), b = num && boxOf(num), ts = tokScreen(hero);
  ck("R12 the number does not cover the token (its centre off the token, at most a quarter of it over the token)", !!b && !(b.cx > ts.x && b.cx < ts.x + ts.w && b.cy > ts.y && b.cy < ts.y + ts.h) && inter(b, ts) <= 0.25 * b.w * b.h);
    /* FXI-TOKEN: words and numbers are timed on the shared clock (startAt) now, not by the moment of the call: compare when each starts */
  const eff = (r) => r.t + (Number.isFinite(r.o.startAt) ? r.o.startAt - r.tp : 0);
  ck("R13 the number comes once the word has landed (at least half of its 500 ms entrance after it)", !!num && !!word && eff(num) - eff(word) >= 250); }

/* R14: the number follows a moving token */
set(hero, "health", 2);
await sleep(1500);
{ const num = plays.find(isNum), b0 = num && boxOf(num);
  hero.x += 300; Hooks.callAll("updateToken", hero.document, { x: hero.x }, {});
  const b1 = num && boxOf(num);
  ck("R14 the number follows its token when it moves", !!b0 && !!b1 && Math.abs(b1.cx - b0.cx - 300) < 20); }
await take(900); hero.x -= 300;

/* R5: the worse it is, the bigger the word, at any zoom (a fall to 0 is the biggest, review: BĘC! was a third of a -1 hit's BACH!) */
for (const z of [0.25, 0.6, 1.2]) {
  cam.z = z; cam.x = 0; cam.y = 0;
  const a = mk(`z1${z}`, "npc", 8, 6, { x: 500 / z - 50, y: 450 / z - 50 }), b = mk(`z2${z}`, "npc", 8, 6, { x: 900 / z - 50, y: 450 / z - 50 });
  Hooks.callAll("canvasReady");
  set(a, "health", 7); await sleep(50); set(b, "health", 0);      // the hit first, then the fall, in one moment
  const q = await take();
  const wa = q.find((r) => r.o.token?.id === a.id && !isNum(r)), wb = q.find((r) => r.o.token?.id === b.id && !isNum(r));
  const area = (r) => { const x = boxOf(r); return x.w * x.h; };
  ck(`R5 zoom ${z}: the fall's word is at least 1.4x the hit's cap and has more area`, !!wa && !!wb && pxOf(wb.o) >= 1.4 * pxOf(wa.o) && area(wb) > area(wa));
  toks.splice(toks.indexOf(a), 1); toks.splice(toks.indexOf(b), 1);
}
cam.z = 1;

/* R5d: a tall hand (seen on lane 20: "FLUMP!" drew 2.1 caps tall and covered three tokens at zoom 0.42; the stand-in draws 3.5 caps so the small test token goes over): once the drawn box is known the
   word shrinks so the box stays under 12 % x 1.25 of the view height */
{ cam.z = 0.42; cam.x = 0; cam.y = 0;
  const d = mk("D", "npc", 8, 6, { x: 700 / 0.42, y: 500 / 0.42 });
  Hooks.callAll("canvasReady");
  TALL["*"] = { w: 5, h: 3.5 };
  set(d, "health", 0);
  await sleep(900);
  const w = plays.find((r) => r.o.token?.id === "D" && !isNum(r));
  const before = w ? pxOf(w.o) : 0; try { w?.o.at?.(); } catch { /* the check below fails */ }
  const after = w ? pxOf(w.o) : 0;
  /* FXLT2 (ADVT2 7): the cap is the rule's capVh (14 % now, was 12 %) */
  const capVh = (await import("../tokenreact/pure.mjs")).SIZE_RULE.capVh;
  ck(`R5d a tall word is shrunk to fit: drawn ${Math.round(before * 3.5)} -> ${Math.round(after * 3.5)} px, limit ${Math.round(VH * capVh * 1.25)}`, !!w && capVh <= 0.15 && after * 3.5 <= VH * capVh * 1.25 + 1 && after < before);
  await take(1800); for (const k of Object.keys(TALL)) delete TALL[k];
  toks.splice(toks.indexOf(d), 1); cam.z = 1; }

/* R11: stress in the colours of strain, not ice (hue of the mid fill outside the blues) */
set(hero, "resolve", 3);
p = await take();
{ const w = p.find((r) => !isNum(r)); const hh = w ? hue(w.o.colors[1]) : 200;
  ck("R11 stress is not lettered in cold blue (mid fill hue outside 170-250)", !!w && w.o.mood === "pain" && !(hh >= 170 && hh <= 250)); }

/* R16: a Resolve drop after an ordinary roll card is stress, not a pushed roll's "spent"; the push's deleted card makes it spent */
Hooks.callAll("createChatMessage", { id: "m1", speakerActor: hero.actor, rolls: [{ pushCount: 0, options: { stressCost: 0 } }], flavor: "" });
await sleep(200);
set(hero, "resolve", 2);
p = await take();
ck("R16a a Resolve drop after an ordinary roll is stress", p[0]?.o.mood === "pain");
Hooks.callAll("deleteChatMessage", { id: "m2", speakerActor: hero.actor, rolls: [{ pushable: true, pushCount: 0 }] });
set(hero, "resolve", 1);
Hooks.callAll("createChatMessage", { id: "m3", speakerActor: hero.actor, rolls: [{ pushCount: 1 }], flavor: "" });
p = await take();
ck("R16b a push (its card deleted, Resolve lowered, the pushed card posted) is spent", p.length === 1 && p[0].o.mood === "tick");
set(hero, "resolve", 6); await take();

/* R18: the seed holds no values (a player must not be able to work hidden Health out of the look): the same stamp, other values, the same seed */
const npc = mk("N", "npc", 8, 6, { x: 300, y: 400 });
Hooks.callAll("canvasReady");
set(npc, "health", 5, {}, 5555);
const s1 = (await take()).find((r) => !isNum(r))?.o.seed;
npc.actor.system.derived.health.value = 7; Hooks.callAll("canvasReady");
set(npc, "health", 3, {}, 5555);
const s2 = (await take()).find((r) => !isNum(r))?.o.seed;
ck("R18 the word's seed carries no Health values", !!s1 && s1 === s2 && !/\|[0-9]+\|[0-9]+\|/.test(s1));

/* R15: two seats, one change: the same word, whatever each seat saw before (one seat missed an earlier update) */
{ let same = 0;
  for (let i = 0; i < 6; i++) {
    npc.actor.system.derived.health.value = 8; Hooks.callAll("canvasReady");
    set(npc, "health", 7, {}, 7000 + i);
    const a = (await take()).find((r) => !isNum(r))?.text;
    npc.actor.system.derived.health.value = 6; Hooks.callAll("canvasReady");      // this seat had seen 6, not 8
    set(npc, "health", 7 - 2, {}, 7000 + i);       // ... and the same server change lands at 5 (a hit for both)
    npc.actor.system.derived.health.value = 8;
    const b = (await take()).find((r) => !isNum(r))?.text;
    if (a && a === b) same++;
  }
  ck("R15 one change, one word on every seat (no seat memory, no seat's own `from` in the seed)", same === 6); }

/* R17: a player; the Damage Taken card arrives BEFORE the loss: the told number is still shown; a card after the word started too */
user.isGM = false;
npc.actor.system.derived.health.value = 8; Hooks.callAll("canvasReady");
const card = (taken, id) => Hooks.callAll("createChatMessage", { id, speakerActor: npc.actor, flavor: "Otrzymane obrażenia", content: `<p><strong>Zbir</strong> otrzymał <strong>${taken}</strong> obrażeń.</p>` });
card(2, "c1"); await sleep(80); set(npc, "health", 6);
p = await take();
ck("R17a the card first, then the loss: the told number", p.some((r) => r.text === "-2"));
set(npc, "health", 5);
setTimeout(() => card(1, "c2"), 1100);      // after the quiet window: the word is already up
p = await take(2200);
ck("R17b the card after the word started: its number joins late", p.some((r) => !isNum(r)) && p.some((r) => r.text === "-1"));

/* R6: a player, an area hit on visible enemies without public numbers: every one answers; nobody's word on another's token */
{ const row = [], front = [];
  for (let i = 0; i < 3; i++) front.push(mk(`f${i}`, "npc", 8, 6, { x: 400 + i * 100, y: 300 }));      // not hit: the row in front
  for (let i = 0; i < 6; i++) row.push(mk(`r${i}`, "npc", 8, 6, { x: 400 + (i % 3) * 100, y: 400 + Math.floor(i / 3) * 100 }));
  Hooks.callAll("canvasReady");
  for (const t of row) { set(t, "health", 7); await sleep(30); }
  p = await take(2600);
  const words = p.filter((r) => !isNum(r));
  ck("R6a every visibly hit enemy answers (a crowd without numbers is not left silent)", new Set(words.map((r) => r.o.token?.id)).size === 6);
  let worst = 0;
  for (const r of words) { const b = boxOf(r); for (const t of [...front, ...row]) if (t.id !== r.o.token?.id) worst = Math.max(worst, inter(b, tokScreen(t)) / (100 * 100)); }
  ck(`R6b no word covers more than 20 % of another token (worst ${(worst * 100).toFixed(0)} %)`, worst <= 0.2);
  for (const t of [...front, ...row]) toks.splice(toks.indexOf(t), 1);
}
user.isGM = true;

/* R1: kept inside the view: a token at the top edge (half of it above the view), at the right edge (the sidebar), with the director's letterbox bars */
const inside = (b, s) => b.x >= s.l - 1 && b.y >= s.t - 1 && b.x + b.w <= s.r + 1 && b.y + b.h <= s.b + 1;
{ const top = mk("T", "npc", 8, 6, { x: 700, y: -40 }), right = mk("R", "npc", 8, 6, { x: 1190, y: 400 });
  Hooks.callAll("canvasReady");
  set(top, "health", 4); set(right, "health", 4);
  p = await take(1200);
  const bt = p.filter((r) => r.o.token?.id === "T").map(boxOf), br = p.filter((r) => r.o.token?.id === "R").map(boxOf);
  ck("R1a a token at the top edge: its word and number stay in the view", bt.length === 2 && bt.every((b) => inside(b, { l: 0, t: 0, r: 1300, b: VH })));
  ck("R1b a token by the sidebar: its word and number stay left of it", br.length === 2 && br.every((b) => inside(b, { l: 0, t: 0, r: 1300, b: VH })));
  await sleep(1500);
  bars = true;
  const mid = mk("Q", "npc", 8, 6, { x: 600, y: 140 });
  Hooks.callAll("canvasReady");
  set(mid, "health", 3);
  p = await take(1200);
  const bq = p.filter((r) => r.o.token?.id === "Q").map(boxOf);
  ck("R1c the director's letterbox bars: the word and number stay between them", bq.length === 2 && bq.every((b) => inside(b, { l: 0, t: 110, r: 1300, b: VH - 110 })));
  bars = false;
  for (const t of [top, right, mid]) toks.splice(toks.indexOf(t), 1);
  await sleep(1500);
}

/* R1d: a floating panel (the challenge cards) over the free side above a token: the word takes another side (seen in the FXLT recording:
   "BĘC!" ran under the challenge cards) */
{ const pan = mk("C", "npc", 8, 6, { x: 700, y: 400 });
  UI["#ich-dock"] = [el(560, 120, 420, 270)];
  Hooks.callAll("canvasReady");
  set(pan, "health", 4);
  p = await take(1200);
  const bc = p.filter((r) => r.o.token?.id === "C").map(boxOf), hit = (b, q) => b.x < q.x + q.w && q.x < b.x + b.w && b.y < q.y + q.h && q.y < b.y + b.h;
  ck("R1d a panel over the side above: the word and number keep off it", bc.length === 2 && bc.every((b) => !hit(b, { x: 560, y: 120, w: 420, h: 270 })));
  delete UI["#ich-dock"]; toks.splice(toks.indexOf(pan), 1);
  await sleep(1500);
}

/* R6c: a token off the view (its centre under the hotbar line or below the screen) is not lettered: no word hanging over the chat input */
{ const off = mk("O", "npc", 8, 6, { x: 1100, y: 850 });
  Hooks.callAll("canvasReady");
  set(off, "health", 6);
  p = await take(1200);
  ck("R6c a token mostly off the safe view gets no lettering", !p.some((r) => r.o.token?.id === "O"));
  toks.splice(toks.indexOf(off), 1); }

/* R7: a director shot that starts after the reaction takes its Health number down (its caption says it) */
hero.actor.system.derived.health.value = 8; Hooks.callAll("canvasReady");
set(hero, "health", 5);
await sleep(1350);
Hooks.callAll("moinenMapsDirector", "shot", { shot: { kind: "damage", tokens: ["H"] }, form: "take" });
await sleep(50);
p = await take(800);
{ const num = p.find((r) => r.text === "-3"), word = p.find((r) => !isNum(r));
  ck("R7 a director shot starting after the word: the number goes, the word stays", !!num && !!num.stopped && !!word && !word.stopped); }

/* R5n: a number beside a word stands clear of it and is not a footnote (seen live: "BLAMM!-3" touched; -3 looked under half the word) */
{ const P = await import("../tokenreact/pure.mjs");
  const cap = 60, aspect = 5, numCap = cap * P.SIZE_RULE.numK, g = P.group({ cap, aspect, tall: 1.4, nums: ["-3"], numCap, side: 1 });
  const ww = cap * aspect * 1.04, nw = numCap * (0.25 + 0.68 + 0.55);
  ck("R5n the number box starts at least a quarter cap after the word box", (g.nums[0].dx - nw * 0.51) - (g.word.dx + ww / 2) >= cap * 0.25 - 1e-6);
  ck("R5n a number beside a word is at least 0.75 of its cap", P.SIZE_RULE.numK >= 0.75); }

console.log(`sweep fxlt-flow: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
