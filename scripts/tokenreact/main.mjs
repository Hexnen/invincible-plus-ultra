/* LTOK: TOKEN REACTIONS, the Foundry half. When a character's Health or Resolve changes, its token answers on the map in comic lettering
   (the shared engine, scripts/letters/, space "world": it sits at the token in scene units, so it reads at any zoom, and follows it).
   Started from scripts/module.js by a guarded dynamic import, like the token halo. What is said and how is pure.mjs; here:
     - every client keeps the last Health / Resolve it saw per token on the viewed scene (canvasReady, createToken) and compares on
       updateActor / updateToken (a synthetic actor's delta): so a change by a roll, by the tactical engine or by hand on the sheet is
       seen the same way, on every seat, with no message sent;
     - what the table was told in public joins the change before it plays: the tactical fight's public events (damage, broken) and the
       system's "Damage Taken" card. A seat that may not read the character gets only that (pure.audience);
     - a pushed roll's stress is "spent" (the roll's splash already shows the number), stress from an attack is "stress";
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
const KEY = { enabled: "tokenReactEnabled", size: "tokenReactSize" };
const SIZE = { small: 0.8, normal: 1, large: 1.25 };
/* the tactical fight's public stream (tactics/store.mjs HOOK and, on the executor, HOOK_GM: the same names, checked by sweep-checks/ltok.mjs) */
const TAC_HOOK = `${MOD}.tactics`, TAC_HOOK_GM = `${MOD}.tacticsGm`;
const DMG_FLAVOR_KEY = "INVINCIBLE.Chat.DamageInfo.DamageTaken";
const QUIET = { reader: 260, other: 750, event: 420, max: 1400 };      // ms a change waits for what joins it (a public line comes a moment after)
const PUSH_MS = 9000;      // a Resolve drop this soon after the character's own roll is that roll's stress
const SCREEN_WAIT = 650;   // a roll's splash word on screen: the token answers right after it, not on top of it

let started = false, engine = null, warned = false;
const seen = new Map();      // token id -> { h, hm, r, rm }
const pending = new Map();   // `${tokenId}|${stat}` -> entry
const playing = new Map();   // token id -> [handles]
const lastWord = new Map();  // kind -> the word said last on this seat
const lastRoll = new Map();  // actor id -> ms of its last roll card
const heard = new Set();
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
  if (!e) { e = { k, tokId: tok.id, stat, from: null, to: null, max: null, pub: null, cause: null, opened: Date.now(), due: 0, seed: "" }; pending.set(k, e); }
  return e;
}
function arm(e, ms) {
  e.due = Math.min(e.opened + QUIET.max, Math.max(e.due, Date.now() + ms));
  clearTimeout(timer);
  const next = Math.min(...[...pending.values()].map((x) => x.due));
  timer = setTimeout(flush, Math.max(20, next - Date.now()));
}
function changed(tok, options) {
  try {
    if (!tok?.id || !started) return;
    const was = seen.get(tok.id), now = read(tok.actor);
    if (!now) return;
    seen.set(tok.id, now);
    if (!was || !enabled()) return;
    const reader = seatOf(tok).reader;
    for (const [stat, a, b, m] of [["health", was.h, now.h, now.hm], ["resolve", was.r, now.r, now.rm]]) {
      if (a === null || b === null || a === b) continue;
      const e = entry(tok, stat);
      if (e.from === null) e.from = a;
      e.to = b; e.max = m;
      e.seed = `${tok.id}|${stat}|${e.from}|${b}|${tok.actor?._stats?.modifiedTime ?? ""}`;
      if (stat === "resolve" && b < a && Date.now() - (lastRoll.get(tok.actor?.id) ?? -1e9) < PUSH_MS && !options?.ipuTactics) e.cause = "push";
      arm(e, reader ? QUIET.reader : QUIET.other);
    }
  } catch (err) { once(err); }
}
function told(tok, stat, add) {
  const e = entry(tok, stat);
  e.pub = { taken: (e.pub?.taken ?? 0) + (add.taken ?? 0), toStress: stat === "resolve", broken: !!(e.pub?.broken || add.broken) };
  if (!e.seed) e.seed = `${tok.id}|${stat}|${add.key ?? ""}`;
  arm(e, QUIET.event);
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
      for (const tok of actor.getActiveTokens?.() ?? []) if (pending.has(`${tok.id}|health`)) told(tok, "health", { taken: line.taken, broken: line.broken, key: message.id });
      return;
    }
    if (message.rolls?.length) lastRoll.set(actor.id, Date.now());
  } catch (err) { once(err); }
}

/* ---------- playing ---------- */
function reduced() {
  try { if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return true; } catch { /* no media query */ }
  try { return canvas?.performance?.mode === CONST.CANVAS_PERFORMANCE_MODES.LOW; } catch { return false; }
}
function flush() {
  try {
    const now = Date.now(), ready = [...pending.values()].filter((e) => e.due <= now + 5);
    for (const e of ready) pending.delete(e.k);
    if (pending.size) arm([...pending.values()][0], 0);
    if (!ready.length || !enabled() || !canvas?.ready) return;
    const lang = game.i18n?.lang === "pl" ? "pl" : "en";
    const items = [];
    for (const e of ready) {
      const tok = canvas.tokens?.get(e.tokId);
      if (!tok) continue;
      const c = P.classify({ stat: e.stat, from: e.from, to: e.to, max: e.max, cause: e.cause }) ?? (e.pub ? P.fromEvent(e.pub, e.stat) : null);
      const a = P.audience(seatOf(tok), c, e.pub);
      if (!a.show) continue;
      const lk = P.look(a, c, lang, e.seed, lastWord.get(a.kind));
      if (!lk) continue;
      lastWord.set(a.kind, lk.word);
      items.push({ key: e.k, tok, lk, seed: e.seed, sev: P.SEVERITY[a.kind] ?? 0, hasNum: !!lk.number });
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
    for (const it of P.stage(items)) if (it.mode !== "none") setTimeout(() => play(L, it), it.delay);
  } catch (err) { once(err); }
}
function play(L, it) {
  try {
    const tok = it.tok;
    if (!tok?.scene || tok.scene.id !== canvas.scene?.id || tok.destroyed) return;
    const base = (canvas.grid?.size ?? 100) * 0.6 * (SIZE[get(KEY.size, "normal")] ?? 1) * it.scale, lk = it.lk, red = reduced();
    for (const h of playing.get(tok.id) ?? []) try { h.stop({ quick: false }); } catch { /* gone */ }      // one reaction per token: the new one takes over
    const hs = [];
    if (it.mode === "full") hs.push(L.play(lk.word, { mood: lk.mood, sound: lk.sound, space: "world", at: tok.document, size: base * lk.size, maxWidth: Math.max(tok.w * 2.4, base * 4), seed: it.seed, hold: lk.hold, rotation: lk.rotation, colors: lk.colors, reduced: red }));
    if (lk.number) {
      /* the number on a shoulder of the token, just under the word; alone (a crowd) it stands where the word would */
      const at = it.mode === "full" ? { x: tok.x + tok.w * (lk.side > 0 ? 0.92 : 0.08), y: tok.y + tok.h * 0.08 } : tok.document;
      const go = () => hs.push(L.play(lk.number.text, { mood: lk.number.mood, sound: lk.number.sound, space: "world", at, anchor: it.mode === "full" ? "center" : undefined, size: base * lk.number.size, seed: `${it.seed}#n`, hold: lk.hold, rotation: -Math.sign(lk.rotation || 1) * 4, colors: lk.number.colors, avoid: hs.map((h) => h.hand), reduced: red }));
      if (it.mode === "full" && !red) setTimeout(go, 110); else go();
    }
    playing.set(tok.id, hs);
    Promise.allSettled(hs.map((h) => h.finished)).then(() => { if (playing.get(tok.id) === hs) playing.delete(tok.id); });
  } catch (err) { once(err); }
}

/* ---------- settings, hooks, start ---------- */
function registerSettings() {
  const has = (key) => game.settings.settings.has(`${MOD}.${key}`);
  if (!has(KEY.enabled)) game.settings.register(MOD, KEY.enabled, { name: t("ITR.Settings.Enabled.Name"), hint: t("ITR.Settings.Enabled.Hint"), scope: "client", config: true, type: Boolean, default: true, onChange: (v) => syncOwner(v) });
  if (!has(KEY.size)) game.settings.register(MOD, KEY.size, { name: t("ITR.Settings.Size.Name"), hint: t("ITR.Settings.Size.Hint"), scope: "client", config: true, type: String, default: "normal",
    choices: { small: t("ITR.Settings.Size.small"), normal: t("ITR.Settings.Size.normal"), large: t("ITR.Settings.Size.large") } });
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
  Hooks.on("updateToken", (doc, changes, options) => { try { if (changes?.delta || changes?.actorData) changed(doc.object, options); } catch (err) { once(err); } });
  Hooks.on("createChatMessage", onMessage);
  Hooks.on("updateChatMessage", (message) => { try { if (message?.rolls?.length && message.speakerActor) lastRoll.set(message.speakerActor.id, Date.now()); } catch (err) { once(err); } });
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
