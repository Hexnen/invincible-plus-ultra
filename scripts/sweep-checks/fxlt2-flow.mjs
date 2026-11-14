// node scripts/sweep-checks/fxlt2-flow.mjs  (FXLT2: the token reactions' fixes after the second blind review ADVT2; the harness is fxlt-flow's: a fake Foundry
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
    const rec = { text, o, t: Date.now(), stopped: null };
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

/* ================================================================ FXLT2: the second blind review (ADVT2). F<n> = ADVT2 finding n. */
const P = await import("../tokenreact/pure.mjs");
let p;
const reset = () => { user.isGM = true; game.i18n.lang = "pl"; delete values["invincible-plus-ultra.tokenReactLang"]; cam.x = 0; cam.y = 0; cam.z = 1; };
const drop = (...ts) => { for (const t of ts) { const i = toks.indexOf(t); if (i >= 0) toks.splice(i, 1); } };

/* F2: one language for the table: a Polish client and an English client letter one change with one word (the world's language) */
{ reset();
  const t = mk("L2", "npc", 8, 6, { x: 700, y: 400 });
  Hooks.callAll("canvasReady");
  game.i18n.lang = "en"; set(t, "health", 7, {}, 91001);
  const a = (await take(1200)).find((r) => !isNum(r))?.text;
  t.actor.system.derived.health.value = 8; Hooks.callAll("canvasReady");
  game.i18n.lang = "pl"; set(t, "health", 7, {}, 91001);
  const b = (await take(1200)).find((r) => !isNum(r))?.text;
  ck(`F2 an English and a Polish client letter one change alike (${a} / ${b})`, !!a && a === b);
  values["invincible-plus-ultra.tokenReactLang"] = "pl";
  t.actor.system.derived.health.value = 8; Hooks.callAll("canvasReady");
  game.i18n.lang = "en"; set(t, "health", 7, {}, 91001);
  const cr = (await take(1200)).find((r) => !isNum(r)), c = cr?.text;
  const { createVocab } = await import("../letters/words.mjs");
  ck(`F2 the world's setting picks the language for every client (${c})`, !!c && c === createVocab().series("punch", 1, { lang: "pl", loud: cr.o.sound.loud, seed: `${cr.o.seed}|punch` })[0].text && !/[ĄĆĘŁŃÓŚŹŻ]/.test(c));
  const settingsSrc = (await import("node:fs")).readFileSync(new URL("../tokenreact/main.mjs", import.meta.url), "utf8");
  ck("F2 the language is a world setting the GM chooses (not the client's interface language)", /KEY\.lang, \{[^}]*scope: "world", config: true/.test(settingsSrc) && !/game\.i18n\?\.lang === "pl" \? "pl"/.test(settingsSrc));
  drop(t); reset(); await sleep(1500); plays.splice(0);
}

/* F3: an unlinked token: its change is stamped on the token (its delta), its synthetic actor keeps the base actor's stamp; three hits are
   three seeds (three words, tilts and motions), not one forever */
{ const t = mk("U3", "npc", 8, 6, { x: 700, y: 400 });
  t.document._stats = { modifiedTime: 50 }; t.document.object = t;
  Hooks.callAll("canvasReady");
  const seeds = [];
  for (let i = 0; i < 3; i++) {
    t.document._stats.modifiedTime = 60000 + i * 4000;
    t.actor.system.derived.health.value -= 1;
    Hooks.callAll("updateToken", t.document, { delta: { system: { derived: { health: { value: t.actor.system.derived.health.value } } } } }, {});
    const w = (await take(4000)).find((r) => !isNum(r));
    seeds.push(w?.o.seed);
  }
  ck(`F3 an unlinked token's hits have their own seeds (${seeds.join(" , ")})`, seeds.every(Boolean) && new Set(seeds).size === 3);
  drop(t);
}

/* F4: zooming in while a word stands never blows it up on screen; zooming out it shrinks with the map */
{ cam.z = 0.5;
  const t = mk("Z4", "npc", 8, 6, { x: 700 / 0.5, y: 400 / 0.5 });
  Hooks.callAll("canvasReady");
  set(t, "health", 4);
  await sleep(500);
  const w = plays.find((r) => r.o.token?.id === "Z4" && !isNum(r));
  try { w?.o.at?.(); } catch { /* fails below */ }
  const before = w ? pxOf(w.o) : 0;
  cam.z = 1; try { w?.o.at?.(); } catch { /* fails below */ }
  const zin = w ? pxOf(w.o) : 0;
  cam.z = 0.25; try { w?.o.at?.(); } catch { /* fails below */ }
  const zout = w ? pxOf(w.o) : 0;
  ck(`F4 zoom 0.5 -> 1 while the word stands: ${Math.round(before)} -> ${Math.round(zin)} px on screen (never bigger)`, before > 0 && zin <= before * 1.05);
  ck(`F4 zoom 0.5 -> 0.25: it shrinks with the map (${Math.round(zout)} px)`, zout > 0 && zout < before);
  await take(2500); drop(t); cam.z = 1;
}

/* F5: tempo. The word comes on the blow (not 0.6 s after it); three blows 0.9 s apart are one growing sound in one place; a heal after a
   hit does not wait for the hit's whole hold */
{ const t = mk("T5", "superhero", 8, 6, { player: true, x: 700, y: 400 });
  Hooks.callAll("canvasReady");
  const t0 = Date.now(); set(t, "health", 7);
  await sleep(1000);
  const w1 = plays.find((r) => r.o.token?.id === "T5" && !isNum(r));
  ck(`F5 the word starts on the blow (${w1 ? w1.t - t0 : "none"} ms after the change, at most 300)`, !!w1 && w1.t - t0 <= 300);
  set(t, "health", 6);
  await sleep(900); set(t, "health", 5);
  await sleep(700);
  const ws = plays.filter((r) => r.o.token?.id === "T5" && !isNum(r));
  const [a, b, c] = ws, ba = a && boxOf(a), bc = c && boxOf(c);
  ck(`F5 three blows are one series: ${ws.map((r) => r.text).join(" > ")}`, ws.length === 3 && a.text !== b.text && b.text !== c.text && pxOf(c.o) > pxOf(a.o) * 1.1);
  ck("F5 the next blow takes the last one's place at once (no drawing over its shards)", !!a?.stopped && a.stopped.quick === true && !!b?.stopped && b.stopped.quick === true);
  ck("F5 the series stands in one place (the same side of its token: centres within a third of the word, a longer word grows about it)", !!ba && !!bc && Math.abs(ba.cx - bc.cx) < bc.w / 3 && Math.abs(ba.cy - bc.cy) < bc.h / 2);
  await take(2600);
  set(t, "health", 4); await sleep(1200);
  const th = Date.now(); set(t, "health", 7);
  await sleep(1300);
  const heal = plays.find((r) => r.o.token?.id === "T5" && !isNum(r) && r.o.mood === "heal");
  ck(`F5 a heal 1.2 s after a hit plays at once (${heal ? heal.t - th : "none"} ms, at most 400)`, !!heal && heal.t - th <= 400);
  await take(2600); drop(t);
}

/* F6: the map's VRAM meter over the side above a token: the word and its number keep off it */
{ const t = mk("V6", "npc", 8, 6, { x: 700, y: 300 });
  UI[".mm-vram"] = [el(560, 60, 420, 240)];
  Hooks.callAll("canvasReady");
  set(t, "health", 4);
  p = await take(1200);
  const bs = p.filter((r) => r.o.token?.id === "V6").map(boxOf), hit = (b, q) => b.x < q.x + q.w && q.x < b.x + b.w && b.y < q.y + q.h && q.y < b.y + b.h;
  ck("F6 the VRAM meter over the side above: the word and number keep off it", bs.length === 2 && bs.every((b) => !hit(b, { x: 560, y: 60, w: 420, h: 240 })));
  delete UI[".mm-vram"]; drop(t); await sleep(1500); plays.splice(0);
}

/* F6 (seen live on lane 5): a token in the view's top-left corner beside the VRAM meter, and a token UNDER the challenge cards: the words
   are pushed into the view and then off the panels, not onto them */
{ const t = mk("V6b", "npc", 8, 6, { x: 10, y: 20 }), u = mk("C6b", "npc", 8, 6, { x: 1150, y: 40 });
  UI[".mm-vram"] = [el(60, 0, 300, 70)]; UI["#ich-dock"] = [el(1080, 0, 220, 300)];
  Hooks.callAll("canvasReady");
  set(t, "health", 4); set(u, "health", 4);
  p = await take(1200);
  const hit = (b, q) => b.x < q.x + q.w && q.x < b.x + b.w && b.y < q.y + q.h && q.y < b.y + b.h;
  const bv = p.filter((r) => r.o.token?.id === "V6b").map(boxOf), bc = p.filter((r) => r.o.token?.id === "C6b").map(boxOf);
  ck("F6 a corner token beside the VRAM meter: its word and number keep off the meter", bv.length === 2 && bv.every((b) => !hit(b, { x: 60, y: 0, w: 300, h: 70 })));
  ck("F6 a token under the challenge cards: its word and number stand beside the cards, not under them", bc.length === 2 && bc.every((b) => !hit(b, { x: 1080, y: 0, w: 220, h: 300 })));
  delete UI[".mm-vram"]; delete UI["#ich-dock"]; drop(t, u); await sleep(1500); plays.splice(0);
}

/* F5 (seen live: the second blow of a series stood on another side): the series keeps the side the last word really took after its drawn
   box was measured (a neighbour to the right makes the drawn, wider word change side once) */
{ const t = mk("S5b", "npc", 8, 6, { x: 700, y: 400 }), nb = mk("N5b", "npc", 8, 6, { x: 700, y: 240 });
  TALL["*"] = { w: 6, h: 1.4 };
  Hooks.callAll("canvasReady");
  set(t, "health", 7); await sleep(900); set(t, "health", 6); await sleep(900); set(t, "health", 5);
  await sleep(700);
  const ws = plays.filter((r) => r.o.token?.id === "S5b" && !isNum(r)), bs = ws.map(boxOf);
  ck(`F5 a series stays on the side its first word took (${bs.map((b) => `${Math.round(b.cx)},${Math.round(b.cy)}`).join(" ")})`, bs.length === 3 && bs.every((b) => Math.abs(b.cx - bs[0].cx) < b.w / 3 && Math.abs(b.cy - bs[0].cy) < b.h / 2));
  await take(2600); delete TALL["*"]; drop(t, nb); plays.splice(0);
}

/* F7: the amount is felt: a reader's -1 and -6 stress are different words, the -6 bigger */
{ const t = mk("S7", "superhero", 8, 8, { player: true, x: 700, y: 400 });
  Hooks.callAll("canvasReady");
  set(t, "resolve", 7);
  const s1 = (await take(1500)).find((r) => !isNum(r));
  await sleep(3000);
  t.actor.system.derived.resolve.value = 8; Hooks.callAll("canvasReady");
  set(t, "resolve", 2);
  const s6 = (await take(1500)).find((r) => !isNum(r));
  ck(`F7 stress -1 and -6 are different sounds (${s1?.text} / ${s6?.text}), the -6 bigger`, !!s1 && !!s6 && s1.text !== s6.text && pxOf(s6.o) > pxOf(s1.o) * 1.2);
  drop(t); await sleep(2500); plays.splice(0);
}

/* F11: a visible token at the view's edge (a quarter of it inside) is lettered, inside the view */
{ const t = mk("E11", "npc", 8, 6, { x: -75, y: 400 });
  Hooks.callAll("canvasReady");
  set(t, "health", 6);
  p = await take(1200);
  const bs = p.filter((r) => r.o.token?.id === "E11").map(boxOf);
  ck("F11 a token a quarter inside the view's edge gets its word, inside the view", bs.length >= 1 && bs.every((b) => b.x >= -1));
  drop(t); await sleep(1500); plays.splice(0);
}

/* pure rules */
ck("F7 a -15 heavy blow stands at least 1.25x a -4 one", P.targetPx("heavy", 1, "WRAMM!", 100, 900) >= 1.25 * P.targetPx("heavy", 0.5, "WRAMM!", 100, 900));
ck("F7 a plain hit beside a big token (560 px) is at least 6 % of the view tall", P.targetPx("hit", 0.3, "THWUP!", 560, 900) >= 0.06 * 900);
ck("F7 the amount: a reader's -15 is the most, -1 the least, a told number counts, nothing told is middling", P.amountOf({ num: 15, exact: true }, { r: 0.6 }) === 1 && P.amountOf({ num: 1, exact: true }, { r: 0.05 }) < 0.2 && P.amountOf({ num: 4 }, null) === 0.5 && P.amountOf({ num: null }, null) === 0.3);
ck("F10 covering another word costs more than covering a token, a panel the most", P.SLOT_K.word > P.SLOT_K.token && P.SLOT_K.panel > P.SLOT_K.word);
{ const tok = { x: 500, y: 400, w: 100, h: 100 }, box = { w: 160, h: 80 }, safe = { l: 0, t: 0, r: 1600, b: 900 };
  const above = P.slotPoint("above", tok, box), wordThere = { x: above.x - 80, y: above.y - 40, w: 160, h: 80, k: P.SLOT_K.word };
  ck("F10 a word of the moment above: the next takes another side", P.chooseSlot(tok, box, safe, [wordThere]) !== "above"); }
ck("F11 on the view: the centre inside, or 15 % inside", P.onView({ x: -75, y: 400, w: 100, h: 100 }, { l: 0, t: 0, r: 1600, b: 900 }) && !P.onView({ x: -95, y: 400, w: 100, h: 100 }, { l: 0, t: 0, r: 1600, b: 900 }));
ck("F13 numbers in Bungee (its 1 has a foot, its 7 none)", P.numHand("health", "-").font === "bungee" && P.numHand("resolve", "+").font === "bungee");
{ const { createVocab } = await import("../letters/words.mjs"); const V = createVocab();
  const lk = P.look({ kind: "hit", num: 2, exact: true }, { r: 0.25 }, "en", "s");
  const s = [0, 1, 2, 3].map((step) => P.wordFor(lk, V, { lang: "en", seed: "a", step, streakSeed: "first" }));
  const len = (w) => w.replace(/[^A-Z]/g, "").length;
  ck(`F5 a series grows: ${s.join(" > ")}`, s.every(Boolean) && s[1] !== s[2] && len(s[3]) >= len(s[1]) && (s[3].match(/!/g) ?? []).length <= 2);
  ck("F5 the series is the first blow's (one stamp), so every seat that saw the blows letters it alike", P.wordFor(lk, V, { lang: "en", seed: "x", step: 2, streakSeed: "first" }) === P.wordFor(lk, createVocab(), { lang: "en", seed: "y", step: 2, streakSeed: "first" }));
  ck("F12 a player's hits of different moments get different words (the stamp is the seed)", new Set(Array.from({ length: 12 }, (_, i) => P.look({ kind: "hit", num: null }, null, "en", `t|health|${i}`, V).word)).size >= 2); }
ck("F5 a lighter reaction waits only until the heavier one has been read", P.overlap(5, 100, 2000, 2) === "queue" && P.overlap(5, P.READ_MS + 10, 2000, 2) === "replace" && P.queueWait(100, 2000) === P.READ_MS - 100);

{ const src = (await import("node:fs")).readFileSync(new URL("../tokenreact/main.mjs", import.meta.url), "utf8");
  /* the live bug (lane 5, take a1): the playing entry kept the side chosen BEFORE measure() re-chose it on the drawn box; the series must
     read the side from the live plan */
  ck("F5 a series reads the side its last word really took (the live plan, not the side at its start)", src.includes("pe?.plan?.slot") && /slot: plan\.slot, plan \}/.test(src)); }
console.log(`sweep fxlt2-flow: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
