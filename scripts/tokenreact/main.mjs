/* LTOK: TOKEN REACTIONS, the Foundry half. When a character's Health or Resolve changes, its token answers on the map in comic lettering
   (the shared engine, scripts/letters/, space "world": it sits at the token in scene units, so it reads at any zoom, and follows it).
   Started from scripts/module.js by a guarded dynamic import, like the token halo. What is said and how is pure.mjs; here:
     - every client keeps the last Health / Resolve it saw per token on the viewed scene (canvasReady, createToken) and compares on
       updateActor / updateToken (a synthetic actor's delta): so a change by a roll, by the tactical engine or by hand on the sheet is
       seen the same way, on every seat, with no message sent;
     - what the table was told in public joins the change before it plays: the tactical fight's public events (damage, broken) and the
       system's "Damage Taken" card. A seat that may not read the character gets only that (pure.audience);
     - a pushed roll's stress is "spent" (the roll's splash already shows the number), stress from an attack is "stress"; only a roll
       whose stress the character chose counts (pushed, a stress cost; the push's deleted card is its first sign);
     - FXLT: one reaction per token per moment (Health and Resolve together), sized by how bad it is, placed on the free side of its
       token and kept inside the view (the interface and the director's letterbox cut it), numbers in one fixed legible hand beside the
       word, after it has landed, following the token; the seed is the server's stamp of the change, never the values;
     - one moment: changes are gathered for a short while (an area attack, fire at a round start come as one crowd, pure.stage), then
       wait for the 3D dice of a roll in flight (tactics/ui/dicegate.mjs) and the action camera's blow (moment.mjs), as the numbers over
       tokens always did; in a tactical fight these reactions take the numbers' place (owner.mjs).
   Never over a token this user does not see (hidden, out of sight, another scene). Every hook body is guarded: nothing here may throw. */
import * as P from "./pure.mjs";
import * as Owner from "./owner.mjs";
import { t } from "./lang.mjs";
import { letters } from "../letters/index.mjs";
import { isLabel } from "../i18n/sys-labels.mjs";
import * as Gate from "../tactics/ui/dicegate.mjs";
import * as Moment from "../moment.mjs";

const MOD = "invincible-plus-ultra";
const LOG = `${MOD} (token reactions) |`;
const KEY = { enabled: "tokenReactEnabled", size: "tokenReactSize", layer: "tokenReactLayer" };
const LAYERS = ["overlay", "weather", "tokens", "ground", "top"];      // the engine's world layers (contract v3 `layer`); overlay = its default
const SIZE = { small: 0.8, normal: 1, large: 1.25 };
/* the tactical fight's public stream (tactics/store.mjs HOOK and, on the executor, HOOK_GM: the same names, checked by sweep-checks/ltok.mjs) */
const TAC_HOOK = `${MOD}.tactics`, TAC_HOOK_GM = `${MOD}.tacticsGm`;
const DMG_FLAVOR_KEY = "INVINCIBLE.Chat.DamageInfo.DamageTaken";
/* ms a change waits for what joins it (a public line comes a moment after). ONE window for every seat (FXLT, review 15: the reader's
   shorter window split a fast double change into two reactions where another seat saw one, with another word) */
const QUIET = { change: 600, event: 420, max: 1400 };
const PUSH_MS = 9000;      // a Resolve drop this soon after a roll card whose stress the character chose (pushed, a stress cost) is that stress
const CARD_MS = 2500;      // a Damage Taken card this recent joins a Health loss that arrives after it (review 17: order of messages)
const LATE_MS = 1800;      // a Damage Taken card arriving after its reaction started still gives it its number, this long
const QUEUE_MAX = 2600;    // a lighter reaction waits at most this long for a heavier one on the same token
const SCREEN_WAIT = 650;   // a roll's splash word on screen: the token answers right after it, not on top of it

let started = false, engine = null, warned = false;
const seen = new Map();      // token id -> { h, hm, r, rm }
const pending = new Map();   // `${tokenId}|${stat}` -> entry
const playing = new Map();   // token id -> { hs, sev, t0, span, nums, addNumber, done }
const lastPush = new Map();  // actor id -> ms of its last roll card whose stress was chosen (review 16)
const cards = new Map();     // actor id -> [{ t, taken, broken, key }] recent Damage Taken cards (review 17)
const heard = new Set();
const captioned = new Map();  // token id -> ms until which the map's director captions this token's damage (number included)
let timer = 0;

const get = (key, fallback) => { try { return game.settings.get(MOD, key); } catch { return fallback; } };
const enabled = () => get(KEY.enabled, true) !== false;
const once = (e) => { if (!warned) { warned = true; console.warn(LOG, "a failure here never affects the canvas:", e); } };
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.round(Number(v)) : null);

function read(actor) {
  const d = actor?.system?.derived;
  if (!d) return null;
  return { h: num(d.health?.value), hm: num(d.health?.max), r: num(d.resolve?.value), rm: num(d.resolve?.max) };
}
function remember(tok) { try { const v = read(tok?.actor); if (v && tok?.id) seen.set(tok.id, v); } catch (e) { once(e); } }
function rememberAll() { seen.clear(); try { for (const tok of canvas?.tokens?.placeables ?? []) remember(tok); } catch (e) { once(e); } }

/* ---------- what a seat may be shown ---------- */
function seatOf(tok) {
  const user = game.user, doc = tok?.document, actor = tok?.actor;
  const staff = !!user?.isGM;
  let visible = false;
  try { visible = !!tok && tok.scene?.id === canvas.scene?.id && (tok.isVisible ?? tok.visible) !== false && (staff || doc?.hidden !== true); } catch { visible = false; }
  let observer = false, playerHero = false;
  try { observer = !!actor?.testUserPermission?.(user, "OBSERVER"); playerHero = actor?.hasPlayerOwner === true; } catch { /* stays false */ }
  return { visible, staff, challenge: actor?.type === "challenge", reader: P.mayRead({ gm: staff, type: actor?.type, playerHero, observer }) };
}

/* ---------- gathering ---------- */
function entry(tok, stat) {
  const k = `${tok.id}|${stat}`;
  let e = pending.get(k);
  if (!e) { e = { k, tokId: tok.id, actorId: tok.actor?.id ?? null, stat, from: null, to: null, max: null, pub: null, keys: new Set(), cause: null, opened: Date.now(), due: 0, seed: "" }; pending.set(k, e); }
  return e;
}
/* the server's stamp of the change: the same on every seat (the seed, review 15 / 18) */
const stampOf = (tok) => tok?.actor?._stats?.modifiedTime ?? tok?.document?._stats?.modifiedTime ?? "";
function arm(e, ms) {
  e.due = Math.min(e.opened + QUIET.max, Math.max(e.due, Date.now() + ms));
  clearTimeout(timer);
  /* ONE MOMENT: everything pending plays together once the last change has had its quiet time (a crowd of updates arrives over a few
     dozen ms), but never later than QUIET.max after the first one */
  const list = [...pending.values()];
  const next = Math.min(Math.min(...list.map((x) => x.opened)) + QUIET.max, Math.max(...list.map((x) => x.due)));
  timer = setTimeout(flush, Math.max(20, next - Date.now()));
}
function changed(tok, options) {
  try {
    if (!tok?.id || !started) return;
    const was = seen.get(tok.id), now = read(tok.actor);
    if (!now) return;
    seen.set(tok.id, now);
    if (!was || !enabled()) return;
    for (const [stat, a, b, m] of [["health", was.h, now.h, now.hm], ["resolve", was.r, now.r, now.rm]]) {
      if (a === null || b === null || a === b) continue;
      const e = entry(tok, stat);
      if (e.from === null) e.from = a;
      e.to = b; e.max = m;
      if (!e.evSeed) e.seed = P.seedOf(tok.id, stat, stampOf(tok));      // a fight's event, when one joined, keeps its own key as the seed
      if (stat === "resolve" && b < a && Date.now() - (lastPush.get(tok.actor?.id) ?? -1e9) < PUSH_MS && !options?.ipuTactics) e.cause = "push";
      if (options?.ipuTactics) e.tactics = true;
      /* a Damage Taken card that came BEFORE this loss joins it (review 17) */
      if (stat === "health" && b < a) for (const c of cards.get(tok.actor?.id) ?? []) if (Date.now() - c.t < CARD_MS && !c.used?.has(tok.id)) { (c.used ??= new Set()).add(tok.id); join(e, c); }
      arm(e, QUIET.change);
    }
  } catch (err) { once(err); }
}
function join(e, add) {
  if (add.key && e.keys.has(add.key)) return;
  if (add.key) e.keys.add(add.key);
  e.pub = { taken: (e.pub?.taken ?? 0) + (add.taken ?? 0), toStress: e.stat === "resolve", broken: !!(e.pub?.broken || add.broken) };
}
function told(tok, stat, add) {
  const e = entry(tok, stat);
  join(e, add);
  /* an event of the fight is the same on every seat: its key is the seed (no values in it) */
  if (!e.evSeed && add.key) { e.evSeed = true; e.seed = P.seedOf(tok.id, stat, add.key); }
  if (!e.seed) e.seed = P.seedOf(tok.id, stat, stampOf(tok));
  arm(e, QUIET.event);
}
/* a roll whose stress the character chose: a Resolve drop of its actor now or in the next moments is "spent" (review 16) */
function markPush(actor) {
  if (!actor?.id) return;
  lastPush.set(actor.id, Date.now());
  for (const e of pending.values()) if (e.actorId === actor.id && e.stat === "resolve" && !e.tactics && e.to !== null && e.from !== null && e.to < e.from) e.cause = "push";
}

/* the tactical fight's public events: damage (taken, toStress) and broken */
function onEvent(ev) {
  try {
    if (!started || !ev || typeof ev !== "object" || !["damage", "broken"].includes(ev.type) || !ev.combat) return;
    const target = typeof ev.target === "string" ? ev.target : ev.target?.combatant;
    const key = `${ev.combat}|${ev.fight ?? ""}|${ev.seq ?? ""}|${ev.type}|${target ?? ""}`;
    if (!target || heard.has(key)) return;
    if (heard.size > 600) heard.clear();
    heard.add(key);
    const tok = game.combats?.get(ev.combat)?.combatants?.get(target)?.token?.object ?? null;
    if (!tok || !enabled()) return;
    if (ev.type === "broken") told(tok, "health", { broken: true, key });
    else if (Number.isFinite(ev.taken) && ev.taken > 0) told(tok, ev.toStress ? "resolve" : "health", { taken: Math.trunc(ev.taken), key });
  } catch (err) { once(err); }
}
/* the system's "Damage Taken" card (the public line of a hit outside a tactical fight); any other roll card marks the speaker's roll */
function onMessage(message) {
  try {
    if (!started) return;
    const actor = message?.speakerActor;
    if (!actor) return;
    if (message.flavor && isLabel(message.flavor, DMG_FLAVOR_KEY)) {
      const line = P.damageLine(message.content);
      if (!line || !enabled()) return;
      const card = { t: Date.now(), taken: line.taken, broken: line.broken, key: message.id };
      /* whichever comes first, the card or the loss, they meet (review 17): a pending loss takes it now; a loss still to come finds it in
         `cards`; a reaction already on screen without a number gets the told number late */
      const list = (cards.get(actor.id) ?? []).filter((c) => Date.now() - c.t < CARD_MS);
      list.push(card); cards.set(actor.id, list);
      for (const tok of actor.getActiveTokens?.() ?? []) {
        if (pending.has(`${tok.id}|health`)) { (card.used ??= new Set()).add(tok.id); told(tok, "health", card); continue; }
        const pe = playing.get(tok.id);
        if (pe?.addNumber && Date.now() - pe.t0 < LATE_MS && line.taken > 0) { (card.used ??= new Set()).add(tok.id); pe.addNumber("health", "-", line.taken); }
      }
      return;
    }
    if (message.rolls?.some?.((r) => P.choseStress(r))) markPush(actor);
  } catch (err) { once(err); }
}
/* the push button deletes the pushable card, lowers Resolve, then posts the pushed one: the deletion is the first sign (review 16) */
function onDeleteMessage(message) {
  try { if (started && message?.speakerActor && message.rolls?.some?.((r) => r?.pushable === true)) markPush(message.speakerActor); } catch (err) { once(err); }
}

/* the map's director (moinen-maps, hook "moinenMapsDirector") turns the Damage Taken card into a shot with its own caption ("-4 Health")
   on the clients that play it: there the token's word stays and its Health number goes (one change is said once). A shot that starts
   AFTER the word also takes the number down (review 7) */
const DIRECTOR_MS = 5000, DIRECTOR_TAIL = 1200;
function onDirector(kind, data) {
  try {
    if (data?.shot?.kind !== "damage") return;
    const ids = (data.shot.tokens ?? []).map(String);
    if (kind === "shot") for (const id of ids) { captioned.set(id, Date.now() + DIRECTOR_MS); playing.get(id)?.dropNumbers?.("health"); }
    else if (kind === "end") for (const id of ids) captioned.set(id, Date.now() + DIRECTOR_TAIL);
  } catch (err) { once(err); }
}
const isCaptioned = (id) => Date.now() < (captioned.get(id) ?? 0);

/* ---------- playing ---------- */
function reduced() {
  try { if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return true; } catch { /* no media query */ }
  try { return canvas?.performance?.mode === CONST.CANVAS_PERFORMANCE_MODES.LOW; } catch { return false; }
}
function flush() {
  try {
    const ready = [...pending.values()];
    pending.clear();
    if (!ready.length || !enabled() || !canvas?.ready) return;
    const lang = game.i18n?.lang === "pl" ? "pl" : "en";
    /* one moment: every token's changes become ONE reaction (review 4: Health and Resolve of one token in one moment) */
    const byTok = new Map();
    for (const e of ready) {
      const tok = canvas.tokens?.get(e.tokId);
      if (!tok) continue;
      const c = P.classify({ stat: e.stat, from: e.from, to: e.to, max: e.max, cause: e.cause }) ?? (e.pub ? P.fromEvent(e.pub, e.stat) : null);
      const a = P.audience(seatOf(tok), c, e.pub);
      if (!a.show) continue;
      const lk = P.look(a, c, lang, e.seed);
      if (!lk) continue;
      const got = byTok.get(tok.id) ?? { tok, looks: [], seed: e.seed };
      got.looks.push(lk);
      if (P.SEVERITY[lk.kind] >= Math.max(...got.looks.map((x) => P.SEVERITY[x.kind] ?? 0))) got.seed = e.seed;
      byTok.set(tok.id, got);
    }
    const items = [];
    for (const { tok, looks, seed } of byTok.values()) {
      const lk = P.combine(looks);
      items.push({ key: tok.id, tok, lk, seed, sev: P.SEVERITY[lk.kind] ?? 0, hasNum: lk.numbers.length > 0 });
    }
    if (!items.length) return;
    Gate.after(() => land(items));
  } catch (err) { once(err); }
}
async function land(items) {
  try {
    if (Moment.isActive()) await Moment.landing(items.map((i) => i.tok.id), { wait: 0, cap: 1600 });
    const L = engine ?? (engine = await letters());
    /* a roll's splash word on screen right now: the token answers just after it */
    const splashing = () => (L.count?.({ space: "screen" }) ?? 0) > 0 || !!document.querySelector("#invincible-splash-layer .ins-stage");      // the engine's screen words, or the roll splash's own layer
    for (let waited = 0; waited < SCREEN_WAIT && splashing(); waited += 60) await new Promise((r) => setTimeout(r, 60));
    /* the whole moment is placed together, heaviest first: each reaction takes the free side of its token (other tokens, the words
       already placed, the view's edges and the interface count against a side) */
    /* a token mostly outside the safe rect now (off the view, under the interface) is not lettered: its word would hang at the
       edge or over the chat input with nothing under it (seen live in a crowd and in ADVT 6) */
    const onView = (it) => !view.ok() || P.onView(view.tokRect(it.tok), view.safe());
    const staged = P.stage(items.filter(onView)).filter((it) => it.mode !== "none");
    const placed = [];
    const others = [...tokenRects(new Set(staged.map((it) => it.tok.id))), ...view.panels()];
    for (const it of staged) {
      try { it.plan = planOf(L, it); } catch (err) { once(err); it.plan = null; }
      if (!it.plan) continue;
      it.plan.slot = view.ok() ? P.chooseSlot(it.plan.tokRect, it.plan.box, view.safe(), [...others.filter((r) => r.id !== it.tok.id), ...placed]) : "above";
      const c = P.slotPoint(it.plan.slot, it.plan.tokRect, it.plan.box);
      placed.push({ x: c.x - it.plan.box.w / 2, y: c.y - it.plan.box.h / 2, w: it.plan.box.w, h: it.plan.box.h, k: P.SLOT_K.word });
    }
    for (const it of staged) if (it.plan) setTimeout(() => play(L, it), it.delay);
  } catch (err) { once(err); }
}

/* ---------- the view in screen px (client px, as getBoundingClientRect): world <-> screen, the safe rect, other tokens ---------- */
const COVER_SEL = ["#sidebar", "#hotbar", "#players", "#scene-controls", "#controls", "#scene-navigation", "#navigation", "#chat-notifications", "#chat-message",
  "#ui-bottom #chat-form", "#invincible-tactics-dock", "#invincible-combat-bar", ".mm-cin > div"];
/* floating panels that do not hug an edge (cutting the view by them would waste half of it): a side that lands on one costs like a
   token's face, so the word takes another side (seen in the FXLT recording: a fall's "BĘC!" ran under the challenge cards) */
const PANEL_SEL = ["#ich-dock", "#invincible-party", "#invincible-turn-tray", "#chat-notifications"];
const view = {
  at: 0, cache: null,
  ok: () => !!globalThis.canvas?.stage?.toGlobal && !!canvas.app?.view?.getBoundingClientRect,
  rect() { const r = canvas.app.view.getBoundingClientRect(); return { l: Math.max(0, r.left), t: Math.max(0, r.top), r: Math.min(globalThis.innerWidth ?? r.right, r.right), b: Math.min(globalThis.innerHeight ?? r.bottom, r.bottom), ox: r.left, oy: r.top }; },
  /* the safe rect, measured at most every 100 ms (the letterbox bars slide in over ~0.4 s) */
  safe() {
    const t = Date.now();
    if (this.cache && t - this.at < 100) return this.cache;
    const v = this.rect(), covers = [];
    for (const sel of COVER_SEL) for (const el of document.querySelectorAll?.(sel) ?? []) {
      try { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && getComputedStyle?.(el)?.visibility !== "hidden") covers.push({ x: r.left, y: r.top, w: r.width, h: r.height }); } catch { /* skip */ }
    }
    this.at = t; this.cache = P.safeRect(v, covers);
    return this.cache;
  },
  panels() {
    const out = [];
    for (const sel of PANEL_SEL) for (const el of document.querySelectorAll?.(sel) ?? []) {
      try { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && getComputedStyle?.(el)?.visibility !== "hidden") out.push({ x: r.left, y: r.top, w: r.width, h: r.height, k: P.SLOT_K.token }); } catch { /* skip */ }
    }
    return out;
  },
  zoom: () => canvas.stage.scale?.x || 1,
  toScreen(p) { const v = this.rect(), g = canvas.stage.toGlobal(p); return { x: v.ox + g.x, y: v.oy + g.y }; },
  toWorld(p) { const v = this.rect(); return canvas.stage.toLocal({ x: p.x - v.ox, y: p.y - v.oy }); },
  tokRect(tok) { const a = this.toScreen({ x: tok.x, y: tok.y }), z = this.zoom(); return { x: a.x, y: a.y, w: (tok.w ?? 100) * z, h: (tok.h ?? 100) * z }; }
};
/* the tokens this seat sees near the moment (their faces count against a side) */
function tokenRects(skip) {
  if (!view.ok()) return [];
  const out = [];
  try { for (const t of canvas.tokens?.placeables ?? []) if (!skip.has(t.id) && seatOf(t).visible) out.push({ ...view.tokRect(t), id: t.id, k: P.SLOT_K.token }); } catch (err) { once(err); }
  for (const id of skip) { const t = canvas.tokens?.get(id); if (t && view.ok()) out.push({ ...view.tokRect(t), id, k: P.SLOT_K.token }); }
  return out;
}

/* the size of one word on screen (FXLT, review 5): the kind's target, handed to the engine's own model as a scale */
function scaleFor(L, text, opts, targetPx) {
  try {
    const s = L.sizeOf?.(text, { ...opts, scale: 1 });
    const z = view.ok() ? view.zoom() : 1, px0 = s && Number.isFinite(s.natural) && Number.isFinite(s.sizeK) ? s.natural * s.sizeK * z : 0;
    return px0 > 0 ? Math.max(0.2, Math.min(8, targetPx / px0)) : 1;
  } catch { return 1; }
}
const vh = () => globalThis.innerHeight || 900;
/* what one reaction draws and where: the cap heights, the scales, the group box (word + numbers + room for the motion) */
function planOf(L, it) {
  const tok = it.tok, lk = it.lk;
  const user = SIZE[get(KEY.size, "normal")] ?? 1;
  const tokRect = view.ok() ? view.tokRect(tok) : { x: 0, y: 0, w: 100, h: 100 };
  const tokPx = Math.max(tokRect.w, tokRect.h);
  const word = it.mode === "full" || it.mode === "mark";
  const nums = it.mode === "mark" ? [] : (isCaptioned(tok.id) ? lk.numbers.filter((n) => n.stat !== "health") : lk.numbers).slice(0, 2);
  const cap = word ? P.targetPx(lk.kind, lk.amt, lk.word, tokPx, vh(), globalThis.innerWidth || 1600, user * it.scale) : 0;
  const numCap = (word ? cap * P.SIZE_RULE.numK : P.basePx(tokPx, vh()) * P.SIZE_RULE.crowdNumK * 1.1 * user * it.scale);
  const aspect = word ? P.SIZE_RULE.aspect * ([...lk.word].length + 0.5) : 0;      // refined from the drawn word once it is up (follow)
  /* room for the motion: a rise leaves upward, and a power-up's letters may climb like stairs (seen in ADVT c4: "RAAA!" climbed out
     of the view by a whole cap) */
  const rising = ["rise", "grow"].includes(lk.motion.in) || lk.motion.out === "rise";
  const gArgs = word ? { cap, aspect, nums: nums.map((n) => n.text), numCap, side: lk.side, up: (rising ? 0.6 : 0.4) + (lk.mood === "powerup" ? 0.6 : 0), down: lk.motion.in === "drop" ? 0.3 : 0.2 } : null;
  const g = word ? P.group(gArgs)
    : P.group({ cap: numCap, aspect: 0, nums: nums.map((n) => n.text), numCap, side: 0, up: 0.25, down: 0.15 });
  const z0 = view.ok() ? view.zoom() : 1;
  const base = { space: "world", token: tok.document, anchor: "center", reduced: reduced(), ...layer() };
  const wordOpts = word ? { ...base, mood: lk.mood, sound: lk.sound, magnitude: lk.magnitude, seed: it.seed, hold: lk.hold, rotation: lk.rotation, colors: lk.colors, ...lk.motion } : null;
  if (wordOpts) wordOpts.scale = scaleFor(L, lk.word, wordOpts, cap);
  const numOpts = nums.map((n, i) => {
    const o = { ...base, mood: n.mood, sound: n.sound, hand: n.hand, colors: n.colors, magnitude: Math.max(0.3, lk.magnitude * 0.8), seed: `${it.seed}#n${i}`, rotation: word ? -lk.side * 3 : 0, in: n.in, holdKind: "boil", out: n.out };
    o.scale = scaleFor(L, n.text, o, numCap);
    return o;
  });
  return { tokRect, tokPx, box: { w: g.w, h: g.h }, g, gArgs, z0, cap, numCap, nums, wordOpts, numOpts, slot: "above" };
}
/* the world point of one member of a reaction's group, every frame: from its token's place now, on the side chosen at the start,
   pushed into the safe rect while the token is on screen (reviews 1, 7, 14) */
/* once the word is drawn its real shape replaces the letter-count estimate (the engine's plan of the word, contract h.plan; its hold box
   in cap heights): the numbers then stand right at its end, not over it (seen live: "-1" sat on the M of a wide WHAM!) */
function measure(plan) {
  if (plan.measured || !plan.gArgs) return;
  const hb = plan.wordH?.plan?._holdBox;
  if (!hb || !(hb.w > 0) || !(hb.h > 0)) return;
  plan.measured = true;
  /* the drawn box over the limits: the word (live, its handle's scale is read every frame) and the numbers not yet started shrink with it */
  const f = P.fitDrawn({ cap: plan.cap, hbW: hb.w, hbH: hb.h, tokenPx: plan.tokPx ?? 100, vh: vh(), vw: globalThis.innerWidth || 1600 });
  if (f < 0.98) {
    try { if (plan.wordH?.opts && Number.isFinite(plan.wordH.opts.scale)) plan.wordH.opts.scale *= f; } catch { /* keep */ }
    plan.cap *= f; plan.numCap *= f; plan.gArgs = { ...plan.gArgs, cap: plan.gArgs.cap * f, numCap: plan.gArgs.numCap * f };
    for (const o of plan.numOpts ?? []) if (Number.isFinite(o.scale)) o.scale *= f;
  }
  const g = P.group({ ...plan.gArgs, aspect: hb.w, tall: hb.h });
  plan.g = g; plan.box = { w: g.w, h: g.h };
}
function follow(tok, plan, member) {
  let last = null;
  return () => {
    try {
      if (!tok || tok.destroyed || !view.ok()) return last;
      measure(plan);
      const k = view.zoom() / plan.z0;
      const tr = view.tokRect(tok), box = { w: plan.box.w * k, h: plan.box.h * k };
      let c = P.slotPoint(plan.slot, tr, box);
      const safe = view.safe();
      if (P.onView(tr, safe)) c = P.clampInto(c, box, safe);
      const off = member < 0 ? plan.g.word : plan.g.nums[member];
      last = view.toWorld({ x: c.x + off.dx * k, y: c.y + off.dy * k });
      return last;
    } catch (err) { once(err); return last; }
  };
}

function play(L, it, queued = false) {
  try {
    const tok = it.tok, plan = it.plan;
    if (!tok?.scene || tok.scene.id !== canvas.scene?.id || tok.destroyed || !seatOf(tok).visible) return;      // seen again now: the dice or the camera may have held it for seconds
    /* one reaction per token at a time (review 4): a lighter one waits for a heavier one still on screen; an equal or worse one takes over */
    const pe = playing.get(tok.id);
    if (pe) {
      const how = P.overlap(pe.sev, Date.now() - pe.t0, pe.span, it.sev);
      if (how === "queue" && !queued) { Promise.race([pe.done, new Promise((r) => setTimeout(r, QUEUE_MAX))]).then(() => play(L, it, true)); return; }
      for (const h of pe.hs) try { h.stop({ quick: false }); } catch { /* gone */ }
    }
    const lk = it.lk, hs = [], red = plan.wordOpts?.reduced ?? reduced();
    const entry = { hs, sev: it.sev, t0: Date.now(), span: lk.hold + 600, nums: [], done: null, addNumber: null, dropNumbers: null };
    let word = null;
    playing.set(tok.id, entry);
    if (plan.wordOpts) { word = L.play(lk.word, { ...plan.wordOpts, at: follow(tok, plan, -1) }); hs.push(word); plan.wordH = word; }
    /* the numbers come once the word has landed (review 13: a slow entrance let the number arrive first) */
    const entMs = (() => { try { return (word?.plan?.timeline?.ent ?? []).reduce((a, p) => a + (p.ticks ?? 0) * (1000 / 24), 0); } catch { return 300; } })();
    const numAt = (i) => follow(tok, plan, Math.min(i, plan.g.nums.length - 1));
    const playNum = (n, o, i) => {
      if (playing.get(tok.id) !== entry) return;
      if (n.stat === "health" && isCaptioned(tok.id)) return;      // the director's caption says it now (review 7)
      /* beside a word it leaves with the word; alone (a crowd) it stands as long as a word would (seen live: crowd numbers were gone
         in a second) */
      const h = L.play(n.text, { ...o, hold: word ? Math.max(700, lk.hold - entMs * 0.7 + 150) : lk.hold + 300, at: numAt(i) });
      h.stat = n.stat; hs.push(h); entry.nums.push(h); settle();
    };
    const startNums = () => plan.nums.forEach((n, i) => playNum(n, plan.numOpts[i], i));
    if (word && !red && plan.nums.length) {
      const wait = Promise.race([word.ready ?? Promise.resolve(true), new Promise((r) => setTimeout(r, 600))]);
      wait.then(() => setTimeout(startNums, Math.min(700, entMs * 0.7)));
    } else startNums();
    /* a Damage Taken card arriving late still gives a numberless reaction its told number (review 17) */
    entry.addNumber = (stat, sign, n) => {
      if (entry.nums.length || !plan.g.nums || isCaptioned(tok.id)) return;
      const nl = P.numberLook(stat, sign, n, lk.amt);
      const o = { space: "world", token: tok.document, anchor: "center", reduced: red, ...layer(), mood: nl.mood, sound: nl.sound, hand: nl.hand, colors: nl.colors, magnitude: Math.max(0.3, lk.magnitude * 0.8), seed: `${it.seed}#late`, rotation: -lk.side * 3, in: nl.in, holdKind: "boil", out: nl.out };
      o.scale = scaleFor(L, nl.text, o, plan.numCap || plan.cap * P.SIZE_RULE.numK);
      if (!plan.g.nums.length && plan.gArgs) { plan.gArgs = { ...plan.gArgs, nums: [nl.text] }; plan.measured = false; const g = P.group(plan.gArgs); plan.g = g; plan.box = { w: g.w, h: g.h }; measure(plan); }
      playNum(nl, o, 0);
    };
    entry.dropNumbers = (stat) => { for (const h of entry.nums) if (!stat || h.stat === stat) try { h.stop({ quick: false }); } catch { /* gone */ } };
    settle();
    /* the token's entry goes when every word of this reaction (the numbers too) has ended */
    function settle() {
      const n = hs.length;
      const p = Promise.allSettled(hs.map((h) => h.finished)).then(() => { if (hs.length === n && playing.get(tok.id) === entry) playing.delete(tok.id); });
      entry.done = p;
    }
  } catch (err) { once(err); }
}

/* the user's display layer, handed to the engine (contract: the world layer option) */
const layer = () => { const v = get(KEY.layer, "overlay"); return { layer: LAYERS.includes(v) ? v : "overlay" }; };

/* a word must never outlive what this seat may see: the token deleted, hidden from a player or out of his sight ends its words at once
   (the engine follows a token without asking whether this user sees it) */
function cut(id) { for (const h of playing.get(id)?.hs ?? []) try { h.stop({ quick: true }); } catch { /* gone */ } playing.delete(id); }
function recheck() {
  try { for (const id of [...playing.keys()]) { const tok = canvas.tokens?.get(id); if (!tok || !seatOf(tok).visible) cut(id); } } catch (err) { once(err); }
}

/* ---------- settings, hooks, start ---------- */
function registerSettings() {
  const has = (key) => game.settings.settings.has(`${MOD}.${key}`);
  if (!has(KEY.enabled)) game.settings.register(MOD, KEY.enabled, { name: t("ITR.Settings.Enabled.Name"), hint: t("ITR.Settings.Enabled.Hint"), scope: "client", config: true, type: Boolean, default: true, onChange: (v) => syncOwner(v) });
  if (!has(KEY.size)) game.settings.register(MOD, KEY.size, { name: t("ITR.Settings.Size.Name"), hint: t("ITR.Settings.Size.Hint"), scope: "client", config: true, type: String, default: "normal",
    choices: { small: t("ITR.Settings.Size.small"), normal: t("ITR.Settings.Size.normal"), large: t("ITR.Settings.Size.large") } });
  if (!has(KEY.layer)) game.settings.register(MOD, KEY.layer, { name: t("ITR.Settings.Layer.Name"), hint: t("ITR.Settings.Layer.Hint"), scope: "client", config: true, type: String, default: "overlay",
    choices: Object.fromEntries(LAYERS.map((id) => [id, t(`ITR.Settings.Layer.${id}`)])) });
}
async function syncOwner(v = enabled()) {
  try {
    if (!v) { Owner.setOn(false); return; }
    engine = engine ?? await letters();
    Owner.setOn(!!engine && enabled());
  } catch (err) { Owner.setOn(false); once(err); }
}
function registerHooks() {
  Hooks.on("canvasReady", () => { rememberAll(); pending.clear(); playing.clear(); });
  Hooks.on("drawToken", (tok) => { if (!seen.has(tok.id)) remember(tok); });
  Hooks.on("updateActor", (actor, changes, options) => {
    try {
      const d = changes?.system?.derived ?? foundry.utils.getProperty(foundry.utils.expandObject(changes ?? {}), "system.derived");
      if (!d || (!("health" in d) && !("resolve" in d))) return;
      for (const tok of actor.getActiveTokens?.() ?? []) changed(tok, options);
    } catch (err) { once(err); }
  });
  Hooks.on("updateToken", (doc, changes, options) => { try { if (changes?.delta || changes?.actorData) changed(doc.object, options); if ("hidden" in (changes ?? {}) || "x" in (changes ?? {}) || "y" in (changes ?? {})) setTimeout(recheck, 0); } catch (err) { once(err); } });
  Hooks.on("deleteToken", (doc) => { try { cut(doc.id); seen.delete(doc.id); } catch (err) { once(err); } });
  Hooks.on("sightRefresh", () => { if (playing.size) recheck(); });
  Hooks.on("createChatMessage", onMessage);
  Hooks.on("updateChatMessage", (message) => { try { if (message?.speakerActor && message.rolls?.some?.((r) => P.choseStress(r))) markPush(message.speakerActor); } catch (err) { once(err); } });
  Hooks.on("deleteChatMessage", onDeleteMessage);
  Hooks.on("moinenMapsDirector", onDirector);
  Hooks.on(TAC_HOOK, onEvent);
  Hooks.on(TAC_HOOK_GM, onEvent);
}
export function start(phases = {}) {
  try {
    if (started) return true;
    started = true;
    const run = (name, fn) => { if (phases[name]) fn(); else Hooks.once(name, fn); };
    run("init", () => { try { registerSettings(); registerHooks(); } catch (err) { once(err); } });
    run("ready", () => { syncOwner(); if (canvas?.ready) rememberAll(); });
    /* for a look from the console: api.tokenReact.test(token, { stat, from, to }) plays a change on this client alone */
    Hooks.once("ready", () => setTimeout(() => {
      try {
        const mod = game.modules.get(MOD);
        if (mod) mod.api = Object.assign(mod.api ?? {}, { tokenReact: { state: () => ({ on: Owner.isOn(), pending: pending.size, seen: seen.size, playing: playing.size }),
          test: (tok, ch = {}) => { const o = tok?.object ?? tok; const e = entry(o, ch.stat ?? "health"); Object.assign(e, { from: ch.from, to: ch.to, max: ch.max ?? null, pub: ch.pub ?? null, cause: ch.cause ?? null, seed: ch.seed ?? `${o.id}|${Math.random()}` }); arm(e, 0); } } });
      } catch (err) { once(err); }
    }, 0));
    return true;
  } catch (err) { console.warn(LOG, "start failed", err); return false; }
}
