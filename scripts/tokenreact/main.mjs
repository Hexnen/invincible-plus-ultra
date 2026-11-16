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
import * as RG from "../impact-rungs.mjs";      // IMPCALL2: the second beat of one event (beatFrames)
import * as Lay from "./layout.mjs";      // CROWDKO: clean places for a moment's lettering
import * as Owner from "./owner.mjs";
import { t } from "./lang.mjs";
import { letters } from "../letters/index.mjs";
import { isLabel } from "../i18n/sys-labels.mjs";
import * as Gate from "../tactics/ui/dicegate.mjs";
import * as Moment from "../moment.mjs";
import * as TokAnim from "../tokenanim/main.mjs";      // TOKANIM: the token's own motion
import { standardRect, panelZones, dockZone, REF_VW, REF_VH } from "../same-picture.mjs";      // SAMEPIC: one picture for the table
import * as Clock from "../shared-clock.mjs";      // SYNC: the table's clock
import * as Dir from "../direct.mjs";      // DIRECT: the lettering goes the way of the blow

const MOD = "invincible-plus-ultra";
const LOG = `${MOD} (token reactions) |`;
const KEY = { enabled: "tokenReactEnabled", size: "tokenReactSize", layer: "tokenReactLayer", lang: "tokenReactLang" };
const LAYERS = ["overlay", "weather", "tokens", "ground", "top"];      // the engine's world layers (contract v3 `layer`); overlay = its default
/* SIZEDEAD: the steps are pure SIZE_STEP; the table's size = the step x the lettering's Size (tableSizeOf, below) */
/* the tactical fight's public stream (tactics/store.mjs HOOK and, on the executor, HOOK_GM: the same names, checked by sweep-checks/ltok.mjs) */
const TAC_HOOK = `${MOD}.tactics`, TAC_HOOK_GM = `${MOD}.tacticsGm`;
const DMG_FLAVOR_KEY = "INVINCIBLE.Chat.DamageInfo.DamageTaken";
/* ms a change waits for what joins it. ONE window for every seat (FXLT, review 15: the reader's shorter window split a fast double change
   into two reactions where another seat saw one, with another word). FXLT2 (ADVT2 5: every word came 0.61-0.69 s after its change, the
   blows did not land on the blow): only as long as the other track's update and a crowd's updates take to arrive (tens of ms); a public
   line arriving later still joins the reaction on screen (LATE_MS) */
const QUIET = { change: 160, event: 120, max: 700 };
const PUSH_MS = 9000;      // a Resolve drop this soon after a roll card whose stress the character chose (pushed, a stress cost) is that stress
const CARD_MS = 2500;      // a Damage Taken card this recent joins a Health loss that arrives after it (review 17: order of messages)
const LATE_MS = 1800;      // a Damage Taken card arriving after its reaction started still gives it its number, this long
const QUEUE_MAX = 2600;    // a lighter reaction waits at most this long for a heavier one on the same token
const SCREEN_WAIT = 650;   // a roll's splash word on screen: the token answers right after it, not on top of it
/* FXI-TOKEN (ADVI 1): the system posts the Damage Taken card AFTER it lowers Health (helpers/rolls.mjs: update, then a critical injury's
   roll and table draw when Health went below 0, then the card). A fall to 0 with no card yet waits this long for it, on every seat alike,
   so the knock-down the table is told about (the card's second paragraph) is in the reaction and its impact, not a plain blow */
const CARD_DOWN_WAIT = 350;
/* FXI-TOKEN (ADVI 8): the roll's splash tells its story first (its result word strikes, its impact plays), then the target answers. The
   splash announces its moments on SPLASH_HOOK (scratchpad letr REQUESTS FXI-TOKEN): { phase: "start" | "land" | "done", id, landAt?,
   impactMs? } (landAt on this page's performance.now clock); a splash that started and has not landed is waited for at most STORY_MAX,
   a landed one until its impact is over plus STORY_BEAT. Without that hook (a splash that does not announce) the old screen check stays */
const SPLASH_HOOK = `${MOD}.splashMoment`, REACT_HOOK = `${MOD}.tokenReact`;
const STORY_MAX = 2500, STORY_BEAT = 120, STORY_STEP = 40;
/* FIN-CALLERS (seen live: the roll's dice took ~3 s, so a start said with the card had run out before the reaction even began to wait, and
   the target's blow came 0.2-0.4 s BEFORE the roll's word, on each seat at another instant): an announced start counts until it lands, is
   done or goes stale (STORY_STALE); STORY_MAX bounds only this reaction's own wait */
const STORY_STALE = 12000;
/* FIN-CALLERS: the roll's result word is READ before the target answers: the blow lands at least STORY_READ after the word struck (seen
   live: with only the impact's length and the beat the roll's word stood 0.3 s before the target's word and impact took over) */
const STORY_READ = 900;
/* the engine's impact frames play one at a time: the roll's (or the series' last) is let finish, at most this long, before the next blow's */
const IMPACT_WAIT = 600;

let started = false, engine = null, warned = false;
/* CALLERS: the running engine (the copy rule's choice, L.build); its impact table feeds the series bounds of pure.mjs (useImpactTable) */
async function runningEngine() {
  if (engine) return engine;
  const L = await letters();
  if (L && !engine) { engine = L; try { P.useImpactTable(L.impact); } catch { /* the vendored numbers stay */ } }
  return engine ?? L;
}
const seen = new Map();      // token id -> { h, hm, r, rm }
const pending = new Map();   // `${tokenId}|${stat}` -> entry
const playing = new Map();   // token id -> { hs, sev, t0, span, nums, addNumber, done }
const lastPush = new Map();  // actor id -> ms of its last roll card whose stress was chosen (review 16)
const cards = new Map();     // actor id -> [{ t, taken, broken, key }] recent Damage Taken cards (review 17)
const heard = new Set();
const captioned = new Map();  // token id -> ms until which the map's director captions this token's damage (number included)
const streaks = new Map();    // token id -> { seed, n, t } the blows of one series (pure STREAK): the first blow's seed and the step
const inflight = new Map();   // token id -> [entry] gathered and waiting (dice, camera, the splash's story) to be lettered (FXI-TOKEN, ADVI 1)
const story = new Map();      // splash id -> { t, landAt, endAt } the roll splashes announced on SPLASH_HOOK (ADVI 8)
let storyHeard = false;
const struck = new Map();     // IMPCALL2: token id -> { step, until } a roll's impact landed on it (the splash's landing: targets + the table's step)
let timer = 0;

const get = (key, fallback) => { try { return game.settings.get(MOD, key); } catch { return fallback; } };
const enabled = () => get(KEY.enabled, true) !== false;
/* the language of the sound words: ONE for the world, chosen by the GM (FXLT2, ADVT2 2: each client lettered its own interface language,
   so the GM saw "TRRACH!" where the player saw "WHAMMM!" for one blow, and the different widths stood on different sides) */
const LANGS = ["en", "pl"];
const worldLang = () => { const v = get(KEY.lang, "en"); return LANGS.includes(v) ? v : "en"; };
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
/* CALLER5 (IMPCALL2's real fight, lane 5: a knock-down by the fight's own damage wrote TWO words 17 ms apart, KA-THOOM! then the series'
   bigger KA-THOOOM!!, and the player got THROOMF! / KA-THROOOMF!!): the fight tells a knock-down in parts (the actor's update, its "damage"
   event, its "broken" event a few hundred ms later); a part that came after the moment had been gathered opened a SECOND moment, and both
   waited for the roll's story and struck together, the later one as the next blow of a series, each seeded by its own event key, in the
   order each seat happened to gather them. A part of the SAME blow (`may`: no change yet / no damage yet / the knock-down) that arrives
   while the moment still waits to be lettered (inflight, not built yet) now joins that moment; anything else is a new blow, as before. */
function entry(tok, stat, may = null) {
  const k = `${tok.id}|${stat}`;
  let e = pending.get(k);
  if (!e && may) { const w = (inflight.get(tok.id) ?? []).find((x) => x.k === k && may(x)); if (w) return w; }
  if (!e) { e = { k, tokId: tok.id, actorId: tok.actor?.id ?? null, stat, from: null, to: null, max: null, pub: null, keys: new Set(), evKeys: [], cause: null, opened: Date.now(), due: 0, seed: "" }; pending.set(k, e); }
  return e;
}
const isPending = (e) => pending.get(e?.k) === e;
/* the server's stamp of the change: the same on every seat (the seed, review 15 / 18). FXLT2 (ADVT2 3: every unlinked token said one word
   with one tilt and one motion forever): an unlinked token's change is written to the TOKEN (its delta), and its synthetic actor keeps the
   base actor's stamp; the newest of the actor's, the token's and the delta's stamps is the change's */
const stampOf = (tok, options = null) => {
  /* FIN-CALLERS (seen live on lane 5, v14): an unlinked token's change touches neither the token's nor its delta's stamp, so every blow of a
     Mauler kept one seed and one word for good (WHAM!, WHAM!, WHAM!); the update's own server time (options.modifiedTime, the same on every
     seat) is the change's stamp when the hook carries it */
  if (Number.isFinite(Number(options?.modifiedTime)) && options.modifiedTime) return Number(options.modifiedTime);
  const all = [tok?.actor?._stats?.modifiedTime, tok?.document?._stats?.modifiedTime, tok?.document?.delta?._stats?.modifiedTime].filter((v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)));
  return all.length ? Math.max(...all.map(Number)) : "";
};
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
      const e = entry(tok, stat, (x) => x.from === null);      // CALLER5: the update of a blow whose event opened the moment joins it
      if (e.from === null) e.from = a;
      e.to = b; e.max = m;
      if (!e.evSeed) e.seed = P.seedOf(tok.id, stat, stampOf(tok, options));      // a fight's event, when one joined, keeps its own key as the seed
      /* SYNC (ADVX 5): the change's instant on the table's clock (the update's server stamp, the same on every seat; else when it reached
         this seat) and how long the table gathers after it (a fall to 0 waits for its card: decided from the change, not from whether this
         seat already holds the card) */
      shared(e, srvStamp(options),
        stat === "health" && b < a && b <= 0 && !options?.ipuTactics && !e.tactics && !e.pub?.broken ? CARD_DOWN_WAIT : QUIET.change);
      if (stat === "resolve" && b < a && Date.now() - (lastPush.get(tok.actor?.id) ?? -1e9) < PUSH_MS && !options?.ipuTactics) e.cause = "push";
      if (options?.ipuTactics) e.tactics = true;
      /* a Damage Taken card that came BEFORE this loss joins it (review 17); one card per loss (FXI-TOKEN, ADVI 1) */
      if (stat === "health" && b < a && !e.card) for (const c of cards.get(tok.actor?.id) ?? []) if (Date.now() - c.t < CARD_MS && !c.used?.has(tok.id)) { (c.used ??= new Set()).add(tok.id); join(e, c); break; }
      /* a fall to 0 outside a fight's events: its card (with the critical injury) is still to come; wait for it (CARD_DOWN_WAIT) */
      const waitCard = stat === "health" && b < a && b <= 0 && !e.card && !e.tactics && !e.pub?.broken;
      if (isPending(e)) arm(e, waitCard ? CARD_DOWN_WAIT : QUIET.change);
    }
  } catch (err) { once(err); }
}
function join(e, add) {
  if (add.key && e.keys.has(add.key)) return;
  if (add.key) e.keys.add(add.key);
  if (add.isCard) e.card = add.key;      // FXI-TOKEN (ADVI 1): this loss has its card; another card is another loss's
  e.pub ={ taken: (e.pub?.taken ?? 0) + (add.taken ?? 0), toStress: e.stat === "resolve", broken: !!(e.pub?.broken || add.broken) };
}
function told(tok, stat, add) {
  /* CALLER5: the knock-down ("broken") of a blow, or the damage event of a blow whose update opened the moment, joins the moment still
     waiting to be lettered */
  const e = entry(tok, stat, add.isCard ? null : add.broken ? () => true : (x) => !x.hasDmg);
  join(e, add);
  if (!add.isCard && Number(add.taken) > 0) e.hasDmg = true;
  /* an event of the fight is the same on every seat: its key is the seed (no values in it). A card is not (FXI-TOKEN, ADVI 1): it may meet
     its loss while gathered on one seat and later on another, so the seed stays the change's stamp, the same everywhere.
     CALLER5: a moment of several events (damage + broken) is seeded by the SMALLEST of their keys, not by whichever reached this seat first
     (the player heard "broken" first and lettered another word than the GM) */
  if (add.key && !add.isCard) { const ks = (e.evKeys ??= []); if (!ks.includes(add.key)) ks.push(add.key); e.evSeed = true; e.seed = P.seedOf(tok.id, stat, [...ks].sort()[0]); }
  if (!e.seed) e.seed = P.seedOf(tok.id, stat, stampOf(tok));
  /* WIRE1: who struck (the impact's direction, only when this seat sees him), what the blow was made of, a doubled blow */
  if (add.src) e.src = add.src;
  if (add.dtype) e.dtype = add.dtype;
  if (add.doubled) e.doubled = true;
  /* SYNC: a fight's event on the table's clock (a card does not move the blow). KOSAME: the stamp of the fight's state write that carried it
     (the same on every seat; the event's key starts with its combat's id), else this seat's arrival */
  if (!add.isCard) { const srv = add.key ? eventStamp(String(add.key).split("|")[0]) : null; shared(e, Number.isFinite(srv) ? srv : Clock.serverNow(), QUIET.event); }
  if (isPending(e)) arm(e, QUIET.event);
}
/* SYNC (ADVX 5: token-hit impact frames ran about two film frames apart either way): the blow's instant was "this seat's now + HIT_LEAD"
   once its gathering timer fired, so it moved with each seat's delivery, timer lateness and busy frames. Now it is the table's: the latest
   change's server instant + the table's gathering time + HIT_LEAD + SHARED_SLACK (room for the delivery and the timer), on the shared clock
   (shared-clock.mjs). A seat that gets there later still strikes then, if it can (land()). */
export const SHARED_SLACK = 60, MIN_PREP = 40, LATE_MAX = 250;
/* the update's server stamp (options.modifiedTime: the server's EPOCH ms; the table's clock counts from the server's start) on the table's
   clock (shared-clock epochToServer, learnt from the stamps this seat hears) when it is a sane one (within 10 s); else this seat's arrival */
function srvStamp(options) {
  const now = Clock.serverNow(), t = Number(options?.modifiedTime);
  if (Number.isFinite(t)) Clock.noteEpoch(t, now);
  const s = Number.isFinite(t) ? Clock.epochToServer(t) : null;
  return Number.isFinite(s) && Math.abs(s - now) < 10000 ? Math.min(s, now) : now;
}
function shared(e, srv, hold) {
  if (!Number.isFinite(srv)) return;
  const due = srv + Math.max(0, hold || 0);
  e.due0 = Math.max(e.due0 ?? 0, due);
}
export function sharedHit(ready, now, toPage, hitLead) {
  const dues = (ready ?? []).map((e) => e?.due0).filter(Number.isFinite);
  if (!dues.length) return null;
  return toPage(Math.max(...dues) + hitLead + SHARED_SLACK);
}
/* WIRE1: the attacker of a fight's damage: the last public attack roll of that fight (its `who`), for ATTACK_MS */
const ATTACK_MS = 30000;
const attacks = new Map();   // combat id -> { who (combatant id), t }
function attackerOf(ev) {
  const a = attacks.get(ev.combat);
  if (!a || Date.now() - a.t > ATTACK_MS || ev.source === "hazard") return null;
  try { return game.combats?.get(ev.combat)?.combatants?.get(a.who)?.token?.object?.id ?? null; } catch { return null; }
}
/* a roll whose stress the character chose: a Resolve drop of its actor now or in the next moments is "spent" (review 16) */
function markPush(actor) {
  if (!actor?.id) return;
  lastPush.set(actor.id, Date.now());
  for (const e of pending.values()) if (e.actorId === actor.id && e.stat === "resolve" && !e.tactics && e.to !== null && e.from !== null && e.to < e.from) e.cause = "push";
}

/* KOSAME (seen live, two seats, a real fight: the event's instant was each seat's own arrival, a few to some tens of ms apart, and more on a
   far server): the GM's executor writes the fight's state (an update of the Combat, its server stamp the same on every seat) and only then
   publishes the events of that step, so on every seat the write is heard first (GM 0-1 ms, player 3-19 ms before the event). An event is
   anchored on the latest write of its fight heard within EVENT_STAMP_MS; else (no write heard, an old one) on its arrival, as before */
const fightStamps = new Map();   // combat id -> { srv (the write's server stamp on the table's clock), at (when this seat heard it) }
function noteFight(combat, changes, options) {
  if (!combat?.id || !changes?.flags) return;
  fightStamps.set(combat.id, { srv: srvStamp(options), at: Clock.serverNow() });
  if (fightStamps.size > 20) fightStamps.delete(fightStamps.keys().next().value);
}
function eventStamp(combatId) { return P.eventAnchor(fightStamps.get(combatId), Clock.serverNow()); }

/* the tactical fight's public events: damage (taken, toStress) and broken */
function onEvent(ev) {
  try {
    if (!started || !ev || typeof ev !== "object" || !ev.combat) return;
    if (ev.type === "roll" && ev.key === "attack" && typeof ev.who === "string") { attacks.set(ev.combat, { who: ev.who, t: Date.now() }); if (attacks.size > 50) attacks.delete(attacks.keys().next().value); return; }
    if (!["damage", "broken"].includes(ev.type)) return;
    const target = typeof ev.target === "string" ? ev.target : ev.target?.combatant;
    const key = `${ev.combat}|${ev.fight ?? ""}|${ev.seq ?? ""}|${ev.type}|${target ?? ""}`;
    if (!target || heard.has(key)) return;
    if (heard.size > 600) heard.clear();
    heard.add(key);
    const tok = game.combats?.get(ev.combat)?.combatants?.get(target)?.token?.object ?? null;
    if (!tok || !enabled()) return;
    /* DIRECT2 (seen live in a real fight: a minion group knocked out by Omni-Man's slugfest lettered its "broken" word with no way, and
       that heavier word took the damage word's place): a knock-down by an attack keeps its attacker, like the damage */
    const src = attackerOf(ev);
    if (ev.type === "broken") told(tok, "health", { broken: true, key, ...(src && src !== tok.id ? { src } : {}) });
    else if (Number.isFinite(ev.taken) && ev.taken > 0) {
      told(tok, ev.toStress ? "resolve" : "health", { taken: Math.trunc(ev.taken), key, ...(src && src !== tok.id ? { src } : {}), ...(typeof ev.dtype === "string" ? { dtype: ev.dtype } : {}), ...(ev.doubled === true ? { doubled: true } : {}) });
    }
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
      const card = { t: Date.now(), taken: line.taken, broken: line.broken, key: message.id, isCard: true };
      /* whichever comes first, the card or the loss, they meet (review 17): a pending loss takes it now; a loss still to come finds it in
         `cards`; a reaction already on screen without a number gets the told number late.
         FXI-TOKEN (ADVI 1: the second card of a series arrived while the FIRST blow's reaction stood, was handed to it and swallowed, and
         its own loss came without it: the GM saw "-4" and a plain blow's impact, the player no number; the third blow's knock-down card met
         its loss on one seat only): a card belongs to ONE loss of its token that has no card yet: the one gathered, the one waiting to be
         lettered (dice, camera, the splash's story: it is lettered with the card then), or the one on screen, in that order; a reaction
         that already had its card never takes another; with none of them the card waits for its loss (a card posted before its update) */
      const list = (cards.get(actor.id) ?? []).filter((c) => Date.now() - c.t < CARD_MS);
      list.push(card); cards.set(actor.id, list);
      const isLoss = (e) => e && e.stat === "health" && !e.card && e.from !== null && e.to !== null && e.to < e.from;
      const use = (tok) => (card.used ??= new Set()).add(tok.id);
      for (const tok of actor.getActiveTokens?.() ?? []) {
        if (card.used?.has(tok.id)) continue;
        if (isLoss(pending.get(`${tok.id}|health`))) { use(tok); told(tok, "health", card); continue; }
        const fe = (inflight.get(tok.id) ?? []).find(isLoss);
        if (fe) { use(tok); join(fe, card); continue; }
        const pe = playing.get(tok.id);
        if (pe?.addNumber && pe.loss && !pe.card && Date.now() - pe.t0 < LATE_MS && line.taken > 0) { use(tok); pe.card = card.key; pe.addNumber("health", "-", line.taken); }
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
    /* FXI-TOKEN (ADVI 1): what is lettered is decided once every wait is over (build, in land): a card arriving meanwhile still joins */
    const ents = new Map();
    for (const e of ready) { const l = ents.get(e.tokId) ?? []; l.push(e); ents.set(e.tokId, l); }
    for (const [id, l] of ents) inflight.set(id, [...(inflight.get(id) ?? []), ...l]);
    const all = [...ents.keys()];
    warmFigures(ready);
    Gate.after(() => land(all, ready));
  } catch (err) { once(err); }
}
/* CALLER5 (engine 1.9.23 `I.warm`): the figures of the moment's cut (the struck tokens, their attackers) are worked out while the moment
   waits for its dice and the roll's story, never in a frame of the cut; only tokens this seat sees (the engine never reads a hidden one) */
function warmFigures(ready) {
  runningEngine().then((L) => {
    const I = L?.impact;
    if (typeof I?.warm !== "function") return;
    const ids = new Set();
    for (const e of ready ?? []) { if (e?.tokId) ids.add(e.tokId); if (e?.src) ids.add(e.src); }
    const list = [...ids].map((id) => canvas?.tokens?.get?.(id)).filter((t) => t && !t.destroyed && seatOf(t).visible && t.document?.hidden !== true);
    if (list.length) I.warm(list);
  }).catch((err) => once(err));
}
/* the reactions of one moment from its gathered changes, as this seat may be shown them */
function build(ready) {
  try {
    const lang = worldLang();
    /* one moment: every token's changes become ONE reaction (review 4: Health and Resolve of one token in one moment) */
    const byTok = new Map();
    for (const e of ready) {
      const tok = canvas.tokens?.get(e.tokId);
      if (!tok) continue;
      /* IMPCALL2 (ADVI2 4): a challenge is never struck: its rating's fall is progress, its time at 0 its failure (pure challengeOf) */
      const isCh = tok.actor?.type === "challenge";
      const c = isCh
        ? P.challengeOf({ stat: e.stat, from: e.from, to: e.to, max: e.max, cr: num(tok.actor?.system?.derived?.health?.value) })
        : P.classify({ stat: e.stat, from: e.from, to: e.to, max: e.max, cause: e.cause }) ?? (e.pub ? P.fromEvent(e.pub, e.stat) : null);
      /* PRIV (owner «nie», 2026-11-14): the reaction (kind, amount, so the word, its size tier, the token's animation, the impact) is the
         SHARED one (pure.shared), the same on every seat that sees the token; only the number is this seat's (pure.audience) */
      const a = P.audience(seatOf(tok), c, e.pub);
      if (!a.show) continue;
      const lk = P.look(a, c, lang, e.seed);
      if (!lk) continue;
      const got = byTok.get(tok.id) ?? { tok, looks: [], seed: e.seed, pub: null };
      got.looks.push(lk);
      /* PRIV (seen live on lane 5: the GM's word stood 14-16 % smaller than the player's, because his group held a number the player's did not
         and so took a smaller fit): the group's room is planned for the numbers a reader's seat letters (`room`), on every seat, so the word
         takes the same side and size everywhere; a seat without the number leaves its place empty */
      try { const rl = P.look(P.audience({ visible: true, staff: true, challenge: tok.actor?.type === "challenge" }, c, e.pub), c, lang, e.seed); if (rl) got.room = [...(got.room ?? []), ...rl.numbers]; } catch (err) { once(err); }
      if (P.SEVERITY[lk.kind] >= Math.max(...got.looks.map((x) => P.SEVERITY[x.kind] ?? 0))) got.seed = e.seed;
      /* a number every seat shows (told in public, or a character whose track is public): the crowd's staging (pure.stage) reads only that,
         so a crowd stages alike on every seat whatever numbers this seat may read */
      if (Number.isFinite(P.audience(P.publicSeat({ type: tok.actor?.type, playerHero: tok.actor?.hasPlayerOwner === true }), c, e.pub).num) && lk.kind !== "spent") got.pubNum = true;
      /* the impact from the shared reaction too (it was from what the table was told, WIRE1 / FXIT-1: a hand-edited enemy blow was a scratch
         under the GM's heavy word; PRIV): every seat that sees the token gets the same kind and strength */
      if (P.IMPACT[a.kind] && (!got.pub || (P.SEVERITY[a.kind] ?? 0) > (P.SEVERITY[got.pub.kind] ?? 0))) got.pub = { kind: a.kind, amt: P.amountOf(a, c), known: true, src: e.src ?? null, dtype: e.dtype ?? null, doubled: !!e.doubled };
      if (e.card) got.card = true;
      if (c && (c.kind === "hit" || c.kind === "heavy" || c.kind === "down")) got.loss = true;
      byTok.set(tok.id, got);
    }
    const items = [];
    for (const { tok, looks, seed, pub, card, loss, pubNum, room } of byTok.values()) {
      const lk = P.combine(looks);
      items.push({ key: tok.id, tok, lk, seed, lang, sev: P.SEVERITY[lk.kind] ?? 0, hasNum: !!pubNum, pub, card: !!card, loss: !!loss, ...(() => { const rs = (room ?? []).slice().sort((a, b) => (a.stat === "health" ? 0 : 1) - (b.stat === "health" ? 0 : 1)); return { room: rs.map((n) => n.text), roomStats: rs.map((n) => n.stat) }; })() });
    }
    return items;
  } catch (err) { once(err); return []; }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/* FXI-TOKEN (ADVI 8): the roll's story first. A splash that announced its start and has not landed is waited for (at most STORY_MAX from
   its start); a landed one until its impact is over (STORY_BEAT after). Without announcements: the screen check of before. Then the
   impact frame playing now (the roll's, the series' last blow's) is let finish, at most IMPACT_WAIT */
async function storyWait(L) {
  let until = 0;
  if (storyHeard) {
    /* FIN-CALLERS: the blow lands at the SHARED instant the roll's story ends (its landing is on the splash's common start: the same on every
       seat), not when this seat's polling noticed it: wait for an open story to land (at most STORY_MAX), then until HIT_LEAD before that
       instant; land() puts the blow on it (ADVI 13: one instant on every seat) */
    const t1 = performance.now();
    for (;;) {
      const t = performance.now();
      let open = false;
      until = 0;
      for (const [id, s] of story) {
        if (t - Math.max(s.t, s.landAt ?? 0) > STORY_STALE) { story.delete(id); continue; }
        if (s.landAt == null) { open = true; continue; }
        until = Math.max(until, s.landAt + Math.max((s.impactMs ?? 0) + STORY_BEAT, STORY_READ));
      }
      if (!open || t - t1 >= STORY_MAX) break;
      await wait(STORY_STEP);
    }
    const ahead = until - P.HIT_LEAD - performance.now();
    if (ahead > 0) await wait(ahead);
    if (until) return until;
  } else {
    /* a roll's splash word on screen right now: the token answers just after it */
    const splashing = () => (L.count?.({ space: "screen" }) ?? 0) > 0 || !!document.querySelector("#invincible-splash-layer .ins-stage");      // the engine's screen words, or the roll splash's own layer
    for (let waited = 0; waited < SCREEN_WAIT && splashing(); waited += 60) await wait(60);
  }
  /* IMPCALL: at most the engine's longest impact (1.9.21: 1 s), not the old 600 ms */
  const impWait = Math.max(IMPACT_WAIT, P.impactAfter(L.impact, { ms: Infinity }));
  for (let waited = 0; waited < impWait && L.impact?.busy; waited += STORY_STEP) await wait(STORY_STEP);
  return 0;
}
function onSplash(data) {
  try {
    if (!data || typeof data !== "object" || data.id == null) return;
    storyHeard = true;
    const id = String(data.id);
    if (data.phase === "done") { story.delete(id); return; }
    const s = story.get(id) ?? { t: performance.now(), landAt: null, impactMs: 0 };
    if (data.phase === "start") s.t = performance.now();      // FIN-CALLERS: said again right before it plays (dice, verdict and camera took their time)
    if (data.phase === "land") { s.landAt = Number.isFinite(data.landAt) ? data.landAt : performance.now(); s.impactMs = Math.max(0, Math.min(1000, Number(data.impactMs) || 0));
      /* IMPCALL2 (item 3): the tokens this roll's impact struck, and how strong it was on the table: their damage reaction joins this event */
      if (Array.isArray(data.targets) && Number.isFinite(data.step)) for (const tid of data.targets) {
        if (typeof tid !== "string" || !tid) continue;
        const was = struck.get(tid), until = s.landAt + s.impactMs + P.STRUCK_MS;
        struck.set(tid, { step: Math.max(data.step, was && was.until > performance.now() ? was.step : -1), until: Math.max(until, was?.until ?? 0) });
      }
      if (struck.size > 60) struck.delete(struck.keys().next().value); }
    story.set(id, s);
    if (story.size > 30) story.delete(story.keys().next().value);
  } catch (err) { once(err); }
}
async function land(ids, ready) {
  let items = [];
  try {
    if (Moment.isActive()) await Moment.landing(ids, { wait: 0, cap: 1600 });
    const L = await runningEngine();
    const storyEnd = await storyWait(L);
    unflight(ready);
    items = build(ready);
    if (!items.length) return;
    /* KOSAME: the whole moment is laid out on one view (planFrame: the user's own while the action camera is away), set only while this
       runs synchronously (cleared before every await and before the words are started) */
    const fr = planFrame(items);
    view.frame = fr;
    /* CROWD (ADVX 14: a token under the open sidebar or mostly off the view got no reaction at all): every token this seat sees is lettered;
       one not on this seat's view gets its word at the view's edge nearest to it (follow, pure offPanel) */
    /* the words from the engine's vocabulary (FXLT2, ADVT2 1), a blow of a series one step of one growing sound (ADVT2 5); CROWD (ADVX 6): the
       series' strength (impact, size, the token's motion) is capped by what its blows add up to (pure seriesStep) */
    const vocab = L.vocab?.word ? L.vocab : L.word ? { word: L.word } : null;
    for (const it of items) {
      const st = streakOf(it.tok.id, it.lk.kind, it.seed, it.lk.n, it.lk.amt);
      it.lk.step = st.step; it.streakSeed = st.streakSeed; it.cum = st.cum;
      it.lk.sstep = it.pub ? P.seriesStep(it.pub, st.step, st.cum) : st.step;
      /* DIRECT: a blow with its attacker has a way on the board (documents: the same on every seat); the word grows and leans that way */
      it.dir = directionOf(it);
      const dl = Dir.lookOf(it.dir, it.lk.rotation, Dir.LEAN_REACT);      // DIRECT2: the reaction's harder lean, and the engine's own sideways motions go the blow's way
      if (dl) { it.lk.rotation = dl.rotation; it.lk.from = dl.from; if (dl.dir) it.lk.dirSign = dl.dir; }
    }
    /* CROWD (ADVX 8, 17): the moment as UNITS: a token alone, or a cluster of tokens hit together and standing close on screen (one word for
       the cluster, each member its number); heaviest first, ties by id, so every seat places them in one order */
    const byKey = new Map(items.map((it) => [it.tok.id, it]));
    const units = P.stageUnits(P.crowdUnits(items.map((it) => ({ key: it.tok.id, kind: it.lk.kind, sev: it.sev, amt: it.lk.amt,
      rect: view.ok() ? view.tokRect(it.tok) : null, pub: it.tok.document?.hidden !== true })), { vh: vh() })
      .map((u) => ({ ...u, hasNum: u.keys.some((k) => byKey.get(k)?.hasNum) })));
    const staged = [];      // what is placed and played, in order: per unit its word item (a cluster's own, or the token's), then members
    for (const u of units) {
      const members = u.keys.map((k) => byKey.get(k)).filter(Boolean);
      if (!u.cluster) {
        const it = members[0];
        it.mode = u.mode; it.scale = u.scale; it.delay = u.delay; it.unit = u;
        it.lk.word = it.mode === "full" ? P.wordFor(it.lk, vocab, { lang: it.lang, seed: it.seed, step: P.textStep(it.lk.step, it.lk.sstep), streakSeed: it.streakSeed }) : null;      // CROWD2: one tier over what the series earned
        /* CROWD2: the size is the series' first word's (the shorter word's eye rule must not shrink a lengthened sound: a series never shrinks) */
        if (it.lk.word && it.lk.step > 0) it.lk.sizeWord = P.wordFor(it.lk, vocab, { lang: it.lang, seed: it.seed, step: 0, streakSeed: it.streakSeed }) ?? null;
        if (!it.lk.word && it.mode === "full") it.mode = it.hasNum ? "number" : "none";
        if (it.mode !== "none") staged.push(it);
        continue;
      }
      /* the cluster's word: its kind and amount (pure crowdUnits), seeded by its members, sized up a little with the count */
      const lead = byKey.get(u.lead), seed = P.crowdSeed(members.map((m) => m.seed));
      const lk = P.look({ kind: u.kind, amt: u.amt, num: null }, null, lead.lang, seed);
      const step = Math.max(...members.map((m) => m.lk.step ?? 0)), sstep = Math.max(...members.map((m) => m.lk.sstep ?? 0));
      lk.step = step; lk.sstep = sstep;
      lk.word = u.mode === "full" ? P.wordFor(lk, vocab, { lang: lead.lang, seed, step: P.textStep(step, sstep) }) : null;
      const cl = { key: `crowd:${seed}`, cluster: true, members, tok: lead.tok, lk, seed, lang: lead.lang, sev: u.sev, mode: lk.word ? "full" : "none", scale: u.scale * P.crowdK(members.length),
        delay: u.delay, unit: u, room: [], hasNum: false, pub: null, ids: members.map((m) => m.tok.id) };
      if (cl.mode === "full") staged.push(cl);
      members.forEach((m, i) => { m.mode = m.mode0 = m.lk.numbers?.length || m.room?.length ? "number" : "silent"; m.inCluster = cl; m.scale = u.scale; m.delay = u.delay; m.numDelay = P.NUM_AFTER + i * 50; staged.push(m); });
    }
    /* WIRE1: ONE impact frame per moment, on its worst blow as the table knows it (a crowd is one event: the engine would refuse the rest
       as "busy" anyway); its strength grows with the blow's step in its series, capped by the series' sum (CROWD); in a cluster it lands on
       its heaviest member and the cluster's word carries it */
    let imp = null;
    for (const it of staged) {
      if (it.mode === "none" || it.cluster || !it.pub) continue;
      const spec = P.impactOf(it.pub, it.lk.step, { ...it.pub, cum: it.cum });
      if (spec && (!imp || spec.magnitude > imp.spec.magnitude)) imp = { it, spec };
    }
    /* IMPCALL2 (item 3: a critical that dealt damage played the roll's cut and ~80 ms later the damage's own cut on the same token): a token
       the roll's impact has just struck (struck: the splash's landing, shared data) takes no second cut when its reaction is not stronger
       ("fold"); a stronger one plays as the event's second beat, its own cut without a flash ("beat", impact-rungs beatFrames) */
    const now0 = performance.now();
    for (const [tid, v] of struck) if (v.until < now0) struck.delete(tid);
    const foldAt = (spec, it) => { const f = P.foldOf(spec, it.lk?.step ?? 0, struck.get(it.tok.id) ?? null); return f ?? { how: "own", step: null }; };
    const beat = (spec, it) => { try { const { rung: _r, ...isp } = spec; const pl = L.impact?.plan?.({ ...P.withSeries(isp, it.lk?.step ?? 0), seed: `${it.seed}|impact` }); if (Array.isArray(pl?.frames) && pl.frames.length) return { ...spec, frames: RG.beatFrames(pl.frames) }; } catch (err) { once(err); } return spec; };
    if (imp) {
      const f = foldAt(imp.spec, imp.it);
      imp.step = f.step;
      if (f.how === "fold") { imp.it.folded = true; if (imp.it.inCluster) imp.it.inCluster.folded = true; imp = null; }
      else if (f.how === "beat") imp.spec = beat(imp.spec, imp.it);
    }
    if (imp) {
      const host = imp.it.inCluster && imp.it.inCluster.mode === "full" ? imp.it.inCluster : imp.it;
      host.impact = imp.spec; host.impTok = imp.it.tok; host.impIt = imp.it;
      if (host !== imp.it) imp.it.impHost = host;
      /* IMPCALL (engine 1.9.20/1.9.21: the tokens take part as figures): the other tokens this moment struck join the one impact as `also`
         (their colours turned, their edges lit, following their own reactions). Chosen from SHARED data only (tokens the table's reaction
         names, nobody hides, ordered by id) so every seat makes the same call; the engine draws each only on a seat that may see it.
         IMPCALL2 (item 10: a -1 beside a -8 got the -8's full colour treatment): only the tokens whose own impact is within ALSO_GAP steps of
         the host's join it; a lighter one keeps its word, number and motion, and the heaviest of them its own lower cut after this one */
      const cand = staged.filter((it) => !it.cluster && it.pub && it.tok?.document?.hidden !== true && it !== imp.it)
        .map((it) => { const sp = P.impactOf(it.pub, it.lk.step, { ...it.pub, cum: it.cum }); return sp ? { it, sp, step: P.drawnStep(sp, it.lk.step ?? 0) } : null; }).filter(Boolean);
      const joins = cand.filter((c) => P.alsoJoins(c.step, imp.step));
      host.impAlso = P.alsoOf(joins.map((c) => c.it.tok.id), [imp.it.tok.id, imp.it.pub?.src]);
      const rest = cand.filter((c) => !host.impAlso.includes(c.it.tok.id) && c.it.tok.id !== imp.it.pub?.src && !c.it.inCluster && c.it.mode !== "none")
        .sort((a, b) => b.step - a.step || b.sp.magnitude - a.sp.magnitude || String(a.it.tok.id).localeCompare(String(b.it.tok.id)));
      if (rest.length) {
        const lo = rest[0], f2 = foldAt(lo.sp, lo.it);
        if (f2.how === "fold") lo.it.folded = true;
        else {
          lo.it.impact = f2.how === "beat" ? beat(lo.sp, lo.it) : lo.sp; lo.it.impTok = lo.it.tok; lo.it.impIt = lo.it; lo.it.impSecond = true;
          lo.it.impAlso = P.alsoOf(rest.slice(1).filter((c) => P.alsoJoins(c.step, lo.step)).map((c) => c.it.tok.id), [lo.it.tok.id, lo.it.pub?.src]);
        }
      }
    }
    /* FXI-TOKEN (ADVI 2, 13, 15): ONE instant for the moment's blow, the same on every seat (pure HIT_LEAD): the impact starts on it and every
       word is started so that it strikes on it (play). The other reactions of a crowd strike after the impact (its drawings, at most 500 ms,
       took them over: one token's knock-out frame blacked out six reactions), then one after another (their stagger) */
    /* SYNC: the table's instant (sharedHit) when there is one; this seat can only be later (it never strikes in the past, MIN_PREP) */
    /* CALLERS2 (manual 6a: a seat that reloaded a moment ago may hold a clock ~280 ms off): before the shared instant is put on this page's
       clock, wait for a good clock, at most until the instant itself is near (this seat then strikes with the others, not its error late) */
    view.frame = null;      // KOSAME: no laid-out frame across an await (another moment's words follow the live view meanwhile)
    { const dues = (ready ?? []).map((e) => e?.due0).filter(Number.isFinite);
      if (dues.length && !Clock.good()) await Clock.settle(Math.max(0, Math.max(...dues) + P.HIT_LEAD + SHARED_SLACK - Clock.serverNow() - MIN_PREP - 20)); }
    view.frame = fr;
    const T0s = sharedHit(ready, performance.now(), Clock.toPage, P.HIT_LEAD);
    const T0 = Math.max(Number.isFinite(T0s) ? T0s : performance.now() + P.HIT_LEAD, performance.now() + MIN_PREP, storyEnd || 0);
    let after = 0;
    /* IMPCALL (engine 1.9.21: the strongest impacts are a one-second cut; 1.9.20 stopped at 500 ms): the rest of the crowd strikes after the
       impact's LAST drawing as the engine plans it (the same spec as played: the series' growth too), at most the engine's longest impact */
    try { if (imp && L.impact?.plan) { const { rung: _r, ...isp } = imp.spec; const pl = L.impact.plan({ ...P.withSeries(isp, imp.it.lk?.step ?? 0), seed: `${imp.it.seed}|impact` });
      /* CALLER5: the TABLE's length (a reduced-motion seat plans its still: its crowd struck earlier than the others' did) */
      after = P.impactAfter(L.impact, { ms: RG.tableImpactMs(pl, isp.frames, L.impact) ?? pl?.ms }); } } catch (err) { once(err); }
    const host = imp ? (imp.it.impHost ?? imp.it) : null;
    for (const it of staged) if (!it.inCluster) it.tHit = it === host ? T0 : T0 + (imp ? after + it.delay : it.delay);
    for (const it of staged) if (it.inCluster) it.tHit = it.inCluster.tHit ?? (it.inCluster === host ? T0 : T0 + (imp ? after + it.delay : it.delay));      // a cluster strikes all its members at once
    /* SAMEPIC: shared obstacles (tokens nobody hides, the splash's block, the pins every player may open) vs this seat's own panels and pins
       (only a local guard: fitSame) */
    /* CROWD2 (orchestrator's after-take KA k1: Omni-Man's "-2" above his token and large on the player's seat, left of it and smaller on the
       GM's; CROWD-11): what only ONE seat has (the GM's desk and other own floating panels, a pin only the GM may open) moved that seat's word
       or number (SAMEPIC tier 3), so a number every seat shows stood elsewhere and smaller on one seat. The owner's standard: every seat sees
       the same picture. A pin only the GM may open no longer moves anything on any seat: it hides nothing (a word over a pin is read, the
       pin is under the lettering), and moving the GM's word round it would be the only trace of it. What a seat's own panel really COVERS
       still moves that seat's word or number (fitSame's slide / shrink / refit, follow's push off the panel), exactly as a smaller window
       does: a word nobody can read on that seat is no "same picture" either; a panel beside the spot moves nothing (that was the case
       already). SEAT_ONLY_PINS = true restores the GM's pins as a local guard */
    const pins = view.pins();
    const others = [...tokenRects(new Set(staged.flatMap((it) => it.ids ?? [it.tok.id]))), ...view.blocks(), ...view.zones(), ...pins.shared];
    const mine = [...view.ownPanels(), ...(SEAT_ONLY_PINS ? pins.local : [])];
    const keyOf = (it) => it.key ?? it.tok.id;
    /* CROWD: placed twice when needed: the first pass fits each unit on its own; equal blows then take the smallest of their fits (pure
       sameSize: ADVX 8, a three-target card's equal blows at 1x, 1x and 0.33x) and are placed again at that one size */
    /* CROWDKO (ADVS2 D3, D4): what the standing ink of every word and number must keep clean of. Shared (every seat has it, so every seat
       decides alike): the tokens nobody hides, the pins every player may open, the map's zone badges, the splash's block and the corner
       panels' zones. This seat's own: its floating panels; on the GM's seat, for lettering only the GM's seat shows (a hidden token's word,
       an enemy's number), also the hidden tokens and the pins only the GM may open (nobody else sees that lettering, so moving it there
       changes no other seat's picture) */
    const staff = !!game.user?.isGM, badges = view.badges();
    const fixed = view.ok() ? [...tokenRects(new Set()).map((r) => ({ ...r, kind: "tok" })), ...pins.shared.map((r) => ({ ...r, kind: "pin" })), ...badges.shared.map((r) => ({ ...r, kind: "pin" })),
      ...view.blocks().map((r) => ({ ...r, kind: "panel", map: true })), ...view.zones().map((r) => ({ ...r, kind: "panel" }))] : [];
    const gmOnly = staff && view.ok() ? [...hiddenRects(), ...pins.local.map((r) => ({ ...r, kind: "pin" })), ...badges.local.map((r) => ({ ...r, kind: "pin" }))] : [];
    const ownPanels = view.ok() ? view.ownPanels().map((r) => ({ ...r, kind: "panel" })) : [];
    /* the crowd members whose numbers fold into their crowd's tag (decided on shared data: the same on every seat) */
    let fold = new Set(), wantFold = new Set();
    const applyFold = () => {
      for (const cl of staged.filter((x) => x.cluster)) {
        const inF = cl.members.filter((m) => fold.has(m.tok.id));
        for (const m of cl.members) m.mode = fold.has(m.tok.id) ? "silent" : m.mode0 ?? m.mode;
        const room = Lay.foldTags(inF.flatMap((m) => (m.room ?? []).map((text, j) => ({ text, stat: m.roomStats?.[j] ?? "health" }))));
        const mineT = Lay.foldTags(inF.flatMap((m) => m.lk.numbers ?? []));
        cl.room = room.map((t) => t.text); cl.roomStats = room.map((t) => t.stat); cl.roomOf = room.map((t) => `${t.stat}|${t.of}`);
        /* a seat shows a tag only when it may show every number in it (a player who reads the heroes only would count "-2×3" where the crowd
           took "-2×9"): the same text as every other seat that shows it, or nothing */
        cl.lk.numbers = mineT.filter((t) => room.some((r) => r.of === t.of && r.stat === t.stat && r.n === t.n)).map((t) => {
          const nl = P.numberLook(t.stat, t.of[0] === "+" ? "+" : "-", Number(t.of.slice(1)) || 0, cl.lk.amt);
          return { ...nl, text: t.text, of: `${t.stat}|${t.of}` };
        });
      }
    };
    /* CROWD: placed twice when needed: the first pass fits each unit on its own; equal blows then take the smallest of their fits (pure
       sameSize: ADVX 8, a three-target card's equal blows at 1x, 1x and 0.33x) and are placed again at that one size */
    const place = (kOf = null, allowFold = true) => {
      const placed = [], fits = [], placedS = [], placedL = [];
      wantFold = new Set();
      for (const it of staged) {
        if (it.mode === "none") continue;
        it.plan = null;
        try { it.plan = planOf(L, it); } catch (err) { once(err); it.plan = null; }
        if (!it.plan || it.mode === "silent") continue;
        const ids = new Set(it.ids ?? [it.tok.id]);
        it.plan.blocked = [...others.filter((r) => !ids.has(r.id)), ...placed];
        it.plan.mine = mine;
        /* the next blow of a series lands where the last one stands (ADVT2 5: the third blow of three stood elsewhere), while that side still
           holds the grown word (FXI-TOKEN, ADVI 5: it kept its side and was pushed over its token); a side that is not free is taken smaller
           (pure fitSlot) */
        const pe = it.cluster ? null : playing.get(it.tok.id);
        const was = pe?.plan?.slot ?? pe?.slot;      // the side the last word really took (re-chosen on its drawn box, measure)
        it.plan.keep = it.lk.step > 0 && was && P.FIT_SLOTS.includes(was) ? was : null;
        const kf = kOf?.get(keyOf(it));
        const o = { keep: it.plan.keep, ...(Number.isFinite(kf) ? { ks: [kf] } : {}), ...(it.dir && it.plan.wordOpts ? { toward: it.dir } : {}) };      // DIRECT: the far side first
        let fit = view.ok() ? P.fitSame(it.plan.tokRect, it.plan.box, view.std(it.plan.tokRect), view.safe(), it.plan.blocked, mine, o) : { slot: "above", k: 1, same: true };
        /* CROWDKO: the side search's choice stays when it stands clean; else a clean place is searched (layout.mjs) */
        const dec = view.ok() ? cleanPlace(it, fit, o, kf, { fixed, gmOnly, ownPanels, placedS, placedL, allowFold }) : null;
        if (dec?.fold && allowFold) { wantFold.add(it.tok.id); continue; }
        if (dec?.slot) { fit = { ...fit, slot: dec.slot, k: dec.k, kShared: dec.kS, same: dec.same, moved: dec.moved }; it.plan.nudge = dec.nudge; it.plan.dirty = !dec.clean; it.plan.ck = true; it.plan.ownView = !!dec.ownView; }
        it.plan.same = fit.same; it.plan.moved = fit.moved ?? null;
        if (Array.isArray(globalThis.__samepicFit)) globalThis.__samepicFit.push({ pass: kOf ? "plan2" : "plan", name: it.cluster ? keyOf(it) : it.tok.name, tok: it.plan.tokRect, box: it.plan.box, std: view.std(it.plan.tokRect), real: view.safe(), shared: it.plan.blocked, mine, keep: it.plan.keep, fit, ck: dec ?? null });
        if (fit.k < 0.999) shrink(it.plan, fit.k);
        /* SIZEDEAD: a step under 1 ("small") is drawn, not planned: the group placed at "normal" shrinks by its token (pure stepDrawK) */
        shrink(it.plan, P.stepDrawK(get(KEY.size, "normal")));
        /* SAMEPIC (live, take W: a 1366 x 768 seat's local guard shrank a word to 0.84 on the letter-count estimate, 1059 px wide where the drawn
           word was 618, and the shrink stayed): what this seat's guard took off is given back once the drawn box is known (measure) */
        it.plan.kLoc = fit.same ? 1 : Math.min(1, fit.k / (fit.kShared || fit.k));
        it.plan.slot = fit.slot;
        const c = P.slotPoint(it.plan.slot, it.plan.tokRect, it.plan.box);
        if (dec?.slot) placed.push({ ...dec.rectS, k: P.SLOT_K.word });
        else placed.push({ x: c.x - it.plan.box.w / 2, y: c.y - it.plan.box.h / 2, w: it.plan.box.w, h: it.plan.box.h, k: P.SLOT_K.word });
        if (it.mode === "full" && it.plan.wordOpts) fits.push({ key: keyOf(it), kind: it.lk.kind, amt: it.lk.amt, k: dec?.slot ? dec.kS : fit.kShared ?? fit.k, cluster: !!it.cluster, n: it.members?.length ?? 1 });
      }
      return fits;
    };
    /* CROWDKO: a crowd member's number with no clean place by its token folds into its crowd's tag; the crowd's word then holds the tag, so the
       moment is laid out again (a few rounds at most: each round only adds members) */
    let fits = [];
    for (let round = 0; round < 4; round++) {
      applyFold();
      fits = place();
      const add = [...wantFold].filter((id) => !fold.has(id));
      if (!add.length) break;
      fold = new Set([...fold, ...add]);
    }
    if ([...wantFold].some((id) => !fold.has(id))) { fold = new Set([...fold, ...wantFold]); applyFold(); fits = place(null, false); }
    const same = P.sameSize(fits);
    if (fits.some((f) => same.get(f.key) < f.k - 0.005)) place(same, false);
    const shown = staged.filter((it) => it.plan && it.mode !== "none");
    view.frame = null;      // KOSAME: the words follow the live view
    /* the roll splash (and anything else) may make room for the blow: its instant and its tokens (scratchpad letr REQUESTS FXI-TOKEN) */
    if (shown.length) try { Hooks.callAll(REACT_HOOK, { phase: "hit", at: T0, ids: [...new Set(shown.flatMap((it) => it.ids ?? [it.tok.id]))] }); } catch (err) { once(err); }
    /* a cluster's members (their numbers, their motion) first, its word last: the word's impact keeps the numbers readable (engine `keep`) */
    for (const it of shown) if (!it.cluster) play(L, it);
    for (const it of shown) if (it.cluster) play(L, it);
  } catch (err) { once(err); unflight(ready); }
  finally { view.frame = null; }
}
/* CROWDKO (ADVS2 D3, D4): the side search (pure fitSame) weighs covering against shrinking and always takes SOME side; its choice is now
   judged where the group will really stand (layout.mjs restCentre: follow()'s pushes) against what it must keep clean of. Kept when clean
   (no picture changes where nothing was covered); else a clean place is searched on shared data (the same on every seat); a crowd member's
   number with none asks to fold into its crowd's tag ({ fold: true }); then this seat checks the shared place against its own view, its
   panels and (lettering only the GM's seat shows) what only the GM sees, and searches again here only when it is not clean here.
   -> null (keep the side search's choice) | { fold } | { slot, k, kS, nudge, same, moved, clean, rectS } */
function cleanPlace(it, fit, o, kf, ctx) {
  const plan = it.plan, g = plan?.g;
  if (!g) return null;
  const tr = plan.tokRect, std = view.std(tr), safe = view.safe(), cap = plan.cap || plan.numCap || 1;
  const own = it.cluster ? null : tr;
  /* a crowd's word keeps off every member; a token's word or number off every token but its own (its own ring is `own`) */
  const base = it.cluster ? ctx.fixed : ctx.fixed.filter((q) => !(q.kind === "tok" && q.id === it.tok.id));
  /* lettering only the GM's seat shows: a hidden token's reaction, a crowd member's number no player may read */
  const priv = ctx.gmOnly.length > 0 && !it.cluster && (it.tok.document?.hidden === true || (it.mode === "number" && !it.hasNum));
  const obsS = [...base, ...ctx.placedS];
  const obsL = [...base, ...ctx.placedL, ...ctx.ownPanels, ...(priv ? ctx.gmOnly.filter((q) => q.id !== it.tok.id) : [])];
  const panelsS = [...view.blocks(), ...view.zones()], panelsL = view.panelsCached();
  const eb = P.edgeBox(g, plan.cap || 0, plan.reach) ?? { w: g.w, h: g.h };
  const r = plan.reach, reach = r && plan.cap ? { dx: (g.word?.dx ?? 0) + plan.cap * (r.r - r.l) / 2, dy: (g.word?.dy ?? 0) + plan.cap * (r.d - r.u) / 2, w: plan.cap * (r.l + r.r), h: plan.cap * (r.u + r.d) } : null;
  const sweep = reach ? base.filter((q) => q.kind === "tok") : null;
  const minK = Math.min(1, Lay.CLEAN.minCap / cap);
  const ks = Number.isFinite(kf) ? [kf, ...Lay.CLEAN.ks.filter((k) => k < kf - 1e-6)] : Lay.CLEAN.ks;
  /* a crowd's word may stand by one of its members (layout crowdSpot); its place is then kept as an offset from the crowd's box slot */
  const member = !!it.inCluster && it.mode === "number";      // a crowd member's number stays right by its token (else it folds)
  const mem = it.cluster ? it.members.filter((m) => m.tok && !m.tok.destroyed).map((m) => ({ ...view.tokRect(m.tok), id: m.tok.id })) : [];
  /* REACTPLACE: a place is clean only when it is tied to its token (layout tie: near it, and nearer to it than to any other token); a
     token off the view letters at the view's edge (no tie can hold) */
  const tMax = it.cluster ? Lay.TETHER.crowdMax : Lay.TETHER.max;
  /* (a crowd member's number is held right by its token already: CLEAN.numOuts; between two members it is still that member's) */
  const tieOf = (t, an, sv, sf) => (!member && an.length && P.onView(t, sv) && P.onView(t, sf) ? { anchors: an, max: tMax } : null);
  const anchors = it.cluster ? mem : [{ ...tr, id: it.tok.id }];
  const at = (slot, k, sf, panels, obs, c0 = null, sv = std) => {
    const box = { w: g.w * k, h: g.h * k }, e = { w: eb.w * k, h: eb.h * k }, p0 = c0 ?? P.slotPoint(slot, tr, box);
    const c = Lay.restCentre(p0, tr, box, e, sv, sf, panels), rr = Lay.standAt(c, g, k);
    return { slot, k, c0: p0, c, r: rr, ...Lay.covers(rr, obs, own, sf, false, tieOf(tr, anchors, sv, sf)) };
  };
  const spot = (sf, panels, obs, first, sv = std, far = false) => {
    const a = { tok: tr, own, g, eb, reach, sweep, ks, minK, std: sv, safe: sf, panels, obs, tokPx: plan.tokPx, first, keepSlot: first?.slot ?? null, ...(member ? { outs: far ? Lay.CLEAN.outs : Lay.CLEAN.numOuts, untied: true } : {}) };
    const q = it.cluster ? Lay.crowdSpot(a, mem) : Lay.cleanSpot(a);
    return { ...q, r: Lay.standAt(q.c, g, q.k) };
  };
  const groupAt = (c, k) => ({ x: c.x - g.w * k / 2, y: c.y - g.h * k / 2, w: g.w * k, h: g.h * k });
  const nudgeOf = (q) => { const p = P.slotPoint(q.slot, tr, { w: g.w * q.k, h: g.h * q.k }); return Math.hypot(q.c0.x - p.x, q.c0.y - p.y) < 0.5 ? null : { x: q.c0.x - p.x, y: q.c0.y - p.y }; };
  /* REACTPLACE (seen live, lane 20, both seats: a 568 px Resolve word was laid out to the LEFT of its token on the centred frame, where the
     token stands in the middle of the view; on the live view the token stood 88 px further left, so follow() pushed the word back into the
     view: it began at the tool column and its "-10" lay on its own token; a seat on another view drew the same word by another hero). The
     moment is laid out on a view every seat shares (KOSAME); the place it gives is now also judged where THIS seat will really draw it
     (its live view: the tokens' real places, the view's real edges), while that view is the user's own (the action camera is not away:
     its shot is no user's view and is gone in a moment). Kept when it stands clean and tied there (the same picture on every seat with
     room for it); else the nearest clean, tied place on this view, on the table's side while it can (never bigger than the table's). */
  const onLive = (dec) => {
    try {
      /* (a place that is not clean on the shared view either stays: a second search here would only make the seats differ) */
      if (!view.frame || dec?.fold || (dec && !dec.clean)) return dec;
      let home = null;
      try { const mm = game.modules?.get?.("moinen-maps"); home = mm?.active ? P.cleanFrame(mm.api?.directorStage?.status?.()?.home) : null; } catch { home = null; }
      if (home) return dec;
      const cur = dec?.slot ? { slot: dec.slot, k: dec.k, nudge: dec.nudge ?? null } : { slot: fit.slot, k: fit.k, nudge: null };
      if (!P.SLOTS.includes(cur.slot)) return dec;
      const z = view.zoom();
      const V = inFrame(null, () => { const t = plan.rect ? plan.rect() : view.tokRect(it.tok), sf = view.safe(); return { tr: t, safe: sf, std: dec?.ownView ? sf : view.std(t), z: view.zoom() }; });
      if (!V.tr || Math.abs(V.z / z - 1) > 0.02) return dec;
      const d = { x: V.tr.x - tr.x, y: V.tr.y - tr.y };
      if (Math.hypot(d.x, d.y) < 1) return dec;
      /* what stands on the map moves with the view; this seat's panels and the corner zones do not */
      const mv = (q) => (q.kind === "panel" && !q.map ? q : { ...q, x: q.x + d.x, y: q.y + d.y });
      const panelsV = inFrame(null, () => view.panels());
      const obsV = obsL.map(mv), memV = mem.map(mv), ownV = own ? V.tr : null, anV = it.cluster ? memV : [{ ...V.tr, id: it.tok.id }];
      const box = { w: g.w * cur.k, h: g.h * cur.k }, e = { w: eb.w * cur.k, h: eb.h * cur.k }, p = P.slotPoint(cur.slot, V.tr, box);
      const c = Lay.restCentre(cur.nudge ? { x: p.x + cur.nudge.x, y: p.y + cur.nudge.y } : p, V.tr, box, e, V.std, V.safe, panelsV);
      const v0 = Lay.covers(Lay.standAt(c, g, cur.k), obsV, ownV, V.safe, false, tieOf(V.tr, anV, V.std, V.safe));
      if (v0.clean) return dec;
      const a = { tok: V.tr, own: ownV, g, eb, reach, sweep: sweep?.map(mv) ?? null, ks: [cur.k, ...ks.filter((k) => k < cur.k - 1e-6)], minK, std: V.std, safe: V.safe, panels: panelsV, obs: obsV,
        tokPx: plan.tokPx, first: null, keepSlot: cur.slot, ...(member ? { outs: Lay.CLEAN.numOuts, untied: true } : {}) };
      const q = it.cluster ? Lay.crowdSpot(a, memV) : Lay.cleanSpot(a);
      if (!q?.slot || (!q.clean && !(q.cost < v0.cost - 1e-6))) return dec;
      const pq = P.slotPoint(q.slot, V.tr, { w: g.w * q.k, h: g.h * q.k }), n = { x: q.c0.x - pq.x, y: q.c0.y - pq.y };
      const r = Lay.standAt(q.c, g, q.k);
      if (ctx.placedL.length) ctx.placedL[ctx.placedL.length - 1] = { ...r, x: r.x - d.x, y: r.y - d.y, kind: "word" };
      return { slot: q.slot, k: q.k, kS: S?.k ?? q.k, nudge: Math.hypot(n.x, n.y) < 0.5 ? null : n, same: false, moved: "view", clean: q.clean, rectS, ownView: !!dec?.ownView };
    } catch (err) { once(err); return dec; }
  };
  let S = null, rectS = null;
  const decide = () => {
  /* 1. shared: the side search's own shared choice (fitSame's first step), clean where it stands? */
  const a0 = P.fitSlot(tr, plan.box, std, plan.blocked, { ...o, slide: true });
  const s0 = at(a0.slot, a0.k, std, panelsS, obsS);
  /* SIZEDEAD: a choice the side search had to shrink goes to the clean search too (its fine grid of sizes: one size for every plan of the
     word where room is short); kept only at its planned size */
  const kept = s0.clean && !(a0.k < 0.999);
  S = kept ? s0 : spot(std, panelsS, obsS, null);
  if (!S.clean && ctx.allowFold && it.inCluster?.mode === "full" && it.mode === "number") return { fold: true };
  ctx.placedS.push({ ...S.r, kind: "word" });
  rectS = groupAt(S.c, S.k);
  /* 2. this seat: the place as follow() draws it here */
  const l0 = kept ? at(fit.slot, fit.k, safe, panelsL, obsL) : at(S.slot, S.k, safe, panelsL, obsL, S.c0);
  if (l0.clean) {
    ctx.placedL.push({ ...l0.r, kind: "word" });
    return kept ? null : { slot: S.slot, k: S.k, kS: S.k, nudge: nudgeOf(S), same: true, moved: null, clean: S.clean, rectS };
  }
  /* lettering only this seat shows need not stay inside the shared standard view (nobody else draws it): it may use this seat's whole view
     (plan.ownView: follow() keeps it there) */
  const q = spot(safe, panelsL, obsL, { slot: S.slot, k: S.k });
  /* (a GM-only crowd number whose shared place lands on what only the GM sees: further out on this seat before it would cover it) */
  const qo = !q.clean && priv ? spot(safe, panelsL, obsL, null, safe) : null;
  const qf = !q.clean && !qo?.clean && priv && member ? spot(safe, panelsL, obsL, null, safe, true) : null;
  if (q.clean || qo?.clean || qf?.clean) {
    const w = q.clean ? q : qo?.clean ? qo : qf;
    ctx.placedL.push({ ...w.r, kind: "word" });
    return { slot: w.slot, k: w.k, kS: S.k, nudge: nudgeOf(w), same: false, moved: "clean", clean: true, rectS, ownView: !q.clean };
  }
  ctx.placedL.push({ ...l0.r, kind: "word" });
  return kept ? null : { slot: S.slot, k: S.k, kS: S.k, nudge: nudgeOf(S), same: true, moved: null, clean: S.clean, rectS };
  };
  return onLive(decide());
}
/* the gathered changes of a moment leave the waiting list once lettered (or failed) */
function unflight(ready) {
  for (const e of ready ?? []) {
    const l = inflight.get(e.tokId);
    if (!l) continue;
    const r = l.filter((x) => x !== e);
    if (r.length) inflight.set(e.tokId, r); else inflight.delete(e.tokId);
  }
}
/* a reaction's group at a smaller scale (f < 1): the word (planned or playing), its numbers, the group box */
function shrink(plan, f, back = false) {
  if (!(f > 0) || (!back && f >= 0.999)) return;      // back: undo an earlier shrink (f > 1)
  try { if (plan.wordOpts && Number.isFinite(plan.wordOpts.scale)) plan.wordOpts.scale *= f; } catch { /* keep */ }
  try { if (plan.wordH?.opts && Number.isFinite(plan.wordH.opts.scale)) { plan.wordH.opts.scale *= f; if (Number.isFinite(plan.wordH._s0)) plan.wordH._s0 *= f; } } catch { /* keep */ }
  for (const h of plan.numH ?? []) try { if (h?.opts && Number.isFinite(h.opts.scale)) { h.opts.scale *= f; if (Number.isFinite(h._s0)) h._s0 *= f; } } catch { /* keep */ }
  for (const o of plan.numOpts ?? []) if (Number.isFinite(o.scale)) o.scale *= f;
  plan.cap *= f; plan.numCap *= f;
  if (plan.gArgs) plan.gArgs = { ...plan.gArgs, cap: plan.gArgs.cap * f, numCap: plan.gArgs.numCap * f };
  plan.box = { w: plan.box.w * f, h: plan.box.h * f };
  if (plan.g) plan.g = { w: plan.g.w * f, h: plan.g.h * f, word: { dx: plan.g.word.dx * f, dy: plan.g.word.dy * f }, nums: plan.g.nums.map((q) => ({ dx: q.dx * f, dy: q.dy * f })),
    ...(plan.g.stand ? { stand: { dx: plan.g.stand.dx * f, dy: plan.g.stand.dy * f, w: plan.g.stand.w * f, h: plan.g.stand.h * f } } : {}) };      // CROWDKO: the standing ink too
}
/* one series of blows per token (pure STREAK): a loss within STREAK.ms of the last one is the next step; anything else starts over */
/* CROWD: the series also adds up what its blows took (cum = { n, a }: points and amounts of the shared reaction, the same on every seat that
   sees the token), so its strength can be capped by its sum (pure seriesRung / seriesStep) */
function streakOf(id, kind, seed, n = 0, a = null) {
  const t = Date.now(), s = streaks.get(id);
  const add = (c) => ({ n: (c?.n ?? 0) + (Number(n) || 0), a: Number.isFinite(a) ? (c?.a ?? 0) + a : c?.a ?? null });
  if (!P.isLoss(kind)) { streaks.delete(id); return { step: 0, streakSeed: seed, cum: add(null) }; }
  if (s && t - s.t < P.STREAK.ms) { s.n = Math.min(P.STREAK.max, s.n + 1); s.t = t; s.cum = add(s.cum); return { step: s.n, streakSeed: s.seed, cum: { ...s.cum } }; }
  if (streaks.size > 300) streaks.clear();
  const cum = add(null);
  streaks.set(id, { seed, n: 0, t, cum });
  return { step: 0, streakSeed: seed, cum: { ...cum } };
}

/* ---------- the view in screen px (client px, as getBoundingClientRect): world <-> screen, the safe rect, other tokens ---------- */
/* SAMEPIC (live, lane 5, 2026-11-14): #chat-notifications and #invincible-party are transparent regions as tall as the window (the chat
   column 1236..1536 with the sidebar closed, 936..1236 with it open; the party region 0..240 or 96..336 x 488..790 by the user's peek
   state); read whole they cut the view or pushed the word on one seat only (KA-THOOM!! smaller on the player with the sidebar open). Only
   what is drawn there counts: a chat card popped up, the party's cards */
const CARD_SEL = ["#chat-notifications .chat-log > li", "#chat-notifications .chat-message"];
const BARS_SEL = ".mm-cin > div";      // the map's cinematic letterbox bars (the action camera's shot)
const COVER_SEL = ["#sidebar", "#hotbar", "#players", "#scene-controls", "#controls", "#scene-navigation", "#navigation", ...CARD_SEL, "#chat-message",
  "#ui-bottom #chat-form", "#invincible-tactics-dock", "#invincible-combat-bar", BARS_SEL];
/* floating panels that do not hug an edge (cutting the view by them would waste half of it): a side that lands on one costs like a
   token's face, so the word takes another side (seen in the FXLT recording: a fall's "BĘC!" ran under the challenge cards) */
const PANEL_SEL = ["#ich-dock", "#invincible-turn-tray", ...CARD_SEL,
  /* FXLT2 (ADVT2 6): the map's VRAM meter and pins / filter panel, the party cards, the GM's desk (the splash's own list, splash/stage.mjs) */
  ".mm-vram", "#mm-vram", "#mm-filter", ".mm-filter", "#invincible-party li", "#invincible-tactics-desk:not(.igd-collapsed) .igd",
  /* CROWDKO (live take L: a crowd's word stood on the party panel's title on the 1366 x 768 seat): the party panel's title and button */
  "#invincible-party .ipt-handle", "#invincible-party .ipb-party-btn"];
/* CROWD2: may a pin only the GM may open move a reaction on the GM's seat? No (the same picture on every seat; a pin hides nothing); a switch
   for the owner's answer to CROWD2-1 */
const SEAT_ONLY_PINS = false;
/* CROWD2 (live probe, lane 5: the KA "-2" over Omni-Man shrank to 0.52 and slid left on the GM only, the crowd's word to 0.92): the map's VRAM
   meter is the GM's own (moinen-maps client setting vramMeter, "auto" = shown to the GM), folded at its default spot under the scene controls,
   and the GM's local guard moved what it covered. Its folded default place (as on the reference window, measured live) is now a shared zone
   on every seat, as the party cards and the challenges' panel are: a word keeps off it everywhere, so the GM's guard finds nothing left to
   move. A meter dragged away or unfolded still moves the word on the GM's seat only (CROWD2-6) */
const METER_ZONE = Object.freeze({ l: 92, t: 88, r: 364, b: 148 });
/* SPLASHBLOCK (repeated real fights on two seats with equal windows on one camera shot: once the roll's block no longer squeezed the blow's
   word to 0.35 of its size, the word took the side the table chose, right of the struck token, on the player's seat, and on the GM's seat
   the GM's own guard moved it above: 4 of 6 fights): the GM's desk is the GM's own, open through a fight under the challenges' panel, and
   with the GM's sidebar folded (the lane's GM; the desk hugs the window's edge) its left end stands DESK_ZONE.w px inside the standard view
   (live: 1194..1542 x 300..491 on 1600 x 900, the standard view ending at 1244). That end, as measured, is a shared zone on every seat
   while a fight is on (body.ita-tactics), as the map meter's place is (CROWD2): a word keeps off it everywhere, so the GM's guard finds
   nothing left to move. A desk grown by a card's rows, or one beside an open sidebar, still moves the word on the GM's seat only.
   Provisional SPLASHBLOCK-5 */
export const DESK_ZONE = Object.freeze({ w: 52, gap: 19, h: 192 });
export function deskZone(dock, on) { return on && dock ? { l: dock.r - DESK_ZONE.w, t: dock.b + DESK_ZONE.gap, r: dock.r, b: dock.b + DESK_ZONE.gap + DESK_ZONE.h } : null; }
const view = {
  at: 0, cache: null,
  ok: () => !!globalThis.canvas?.stage?.toGlobal && !!canvas.app?.view?.getBoundingClientRect,
  rect() { const r = canvas.app.view.getBoundingClientRect(); return { l: Math.max(0, r.left), t: Math.max(0, r.top), r: Math.min(globalThis.innerWidth ?? r.right, r.right), b: Math.min(globalThis.innerHeight ?? r.bottom, r.bottom), ox: r.left, oy: r.top }; },
  /* the safe rect, measured at most every 100 ms (the letterbox bars slide in over ~0.4 s) */
  safe() {
    /* KOSAME: a moment planned on the user's own view (planFrame) does not count the action camera's letterbox bars (they come and go with
       the shot, on each seat at its own instant); follow() still keeps the drawn word out from under them, live */
    const t = Date.now(), home = !!this.frame;
    if (home ? this.cacheH && t - this.atH < 100 : this.cache && t - this.at < 100) return home ? this.cacheH : this.cache;
    const v = this.rect(), covers = [];
    for (const sel of COVER_SEL) for (const el of home && sel === BARS_SEL ? [] : document.querySelectorAll?.(sel) ?? []) {
      try { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && getComputedStyle?.(el)?.visibility !== "hidden") covers.push({ x: r.left, y: r.top, w: r.width, h: r.height }); } catch { /* skip */ }
    }
    const s = P.safeRect(v, covers);
    if (home) { this.atH = t; this.cacheH = s; } else { this.at = t; this.cache = s; }
    return s;
  },
  panelsCached() { const t = Date.now(); if (!this.pc || t - this.pat > 250) { this.pc = this.panels(); this.pat = t; } return this.pc; },
  panels() { return [...this.blocks(), ...this.zones(), ...this.ownPanels()]; },      // SAMEPIC: the shared zones too, so every seat's follow clamps alike
  /* FIN-CALLERS (FXIT-S2): the roll splash's moments standing now (its own blocks, asked on REACT_HOOK): a word does not go under them.
     SAMEPIC: the splash lays its block out from shared data, so its block counts as shared */
  blocks() {
    const out = [];
    /* SPLASHBLOCK: the splash tells its blocks part by part (what its letters cover, not the outline round a split block) and, where it has
       one, each block's SCENE rect as every seat shares it (`scene`, alongside `blocks`) */
    const scene = [];
    try { const blocks = []; Hooks.callAll(REACT_HOOK, { phase: "place", blocks, scene }); blocks.forEach((b, i) => { if (b && b.r > b.l && b.b > b.t) { const sc = scene[i]; out.push({ x: b.l, y: b.t, w: b.r - b.l, h: b.b - b.t, k: P.SLOT_K.panel, ...(sc && sc.r > sc.l && sc.b > sc.t ? { sc } : {}) }); } }); } catch { /* no splash */ }
    /* KOSAME (seen live: the GM's block and the player's stood ~200-500 px apart on the same moment): a map moment's block is its scene block
       projected on this seat's LIVE view (the action camera's). A moment laid out on another view (planFrame) takes it through the scene
       into that view, as its token is */
    if (this.frame && out.length) {
      const v = this.rect(), was = this.frame;
      return out.map(({ sc, ...q }) => {
        /* SPLASHBLOCK (seen live: the two seats' screen blocks, a few to some hundred px apart on their screens, gave the reaction another
           side and size per seat): a block with a shared scene rect is planned round THAT, the same on every seat; this seat's own block
           (shifted into its view, moved off its panel) still pushes the drawn word live (follow) */
        const a = sc ? { x: sc.l, y: sc.t } : canvas.stage.toLocal({ x: q.x - v.ox, y: q.y - v.oy }), c = sc ? { x: sc.r, y: sc.b } : canvas.stage.toLocal({ x: q.x + q.w - v.ox, y: q.y + q.h - v.oy });
        const A = P.frameScreen(a, was, canvas.stage.position), C = P.frameScreen(c, was, canvas.stage.position);
        return { ...q, x: v.ox + A.x, y: v.oy + A.y, w: C.x - A.x, h: C.y - A.y };
      });
    }
    return out.map(({ sc, ...q }) => q);
  },
  /* SAMEPIC: the corner panels' shared zones (same-picture.mjs PANEL_ZONES: the party cards, as on the reference window), the same on
     every seat with this view */
  zones() {
    try {
      const W = globalThis.innerWidth ?? 1600, H = globalThis.innerHeight ?? 900, zs = panelZones(W, H);
      /* the challenges' panel moves with the sidebar (live: a word over Mauler B took 0.7 of its size on the seat whose sidebar was open) */
      const el = document.querySelector?.("#ich-dock"), d = el ? dockZone(W, H, el.getBoundingClientRect()) : null;
      if (d) zs.push(d);
      const dk = deskZone(d, !!document.body?.classList?.contains?.("ita-tactics"));
      if (dk) zs.push(dk);
      const ox = W / 2 - REF_VW / 2, oy = H / 2 - REF_VH / 2;
      zs.push({ l: ox + METER_ZONE.l, t: oy + METER_ZONE.t, r: ox + METER_ZONE.r, b: oy + METER_ZONE.b });
      return zs.map((z) => ({ x: z.l, y: z.t, w: z.r - z.l, h: z.b - z.t, k: P.SLOT_K.panel, push: true }));      // CROWD2: follow() pushes off it on every seat
    } catch { return []; }
  },
  /* this seat's own floating panels (the GM's desk, the party cards, the map's meters): a word is never hidden under them, but they move it
     on this seat only (SAMEPIC tier 3) */
  ownPanels() {
    const out = [];
    for (const sel of PANEL_SEL) for (const el of document.querySelectorAll?.(sel) ?? []) {
      try { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && getComputedStyle?.(el)?.visibility !== "hidden") out.push({ x: r.left, y: r.top, w: r.width, h: r.height, k: P.SLOT_K.panel }); } catch { /* skip */ }
    }
    return out;
  },
  /* CROWD (ADVX 12: "-9" and a Resolve word on a map note pin): the scene's note pins (the map's pins are notes too). A pin every player may
     open is a shared obstacle (pure pinPublic: its data is on every seat, drawn there or not); a pin only the GM may open moves the word on
     a seat that draws it (local) */
  pins() {
    const shared = [], local = [];
    if (!this.ok()) return { shared, local };
    try {
      for (const n of canvas.notes?.placeables ?? []) {
        const d = n.document; if (!d) continue;
        const b = n.bounds, z = this.zoom();
        let r;
        if (b && b.width > 0 && b.height > 0) { const a = this.toScreen({ x: b.x, y: b.y }); r = { x: a.x, y: a.y, w: b.width * z, h: b.height * z }; }
        else { const s = (Number(d.iconSize) || 40) * z, a = this.toScreen({ x: d.x, y: d.y }); r = { x: a.x - s / 2, y: a.y - s / 2, w: s, h: s }; }
        const acc = d.page ?? d.entry;
        const pub = P.pinPublic({ ownership: acc?.ownership ?? null, hasEntry: !!acc, authorGM: d._source?.author == null ? false : d.author?.isGM ?? true });
        const q = { ...r, k: P.PIN_K, id: `note:${d.id}` };
        if (pub) shared.push(q); else if (n.visible !== false && n.renderable !== false) local.push(q);
      }
    } catch (err) { once(err); }
    return { shared, local };
  },
  /* CROWDKO (ADVS2 D4: an enemy's "-2" stood on a zone's numbered badge): the map's zone badges (moinen-maps), read from its public zones
     API: a badge stands on its zone's label point at a fixed size on screen (display.mjs: radius min(19, max(8, 0.8 r zoom)) CSS px, a
     shaped badge up to ~1.2 of that). Shown to every seat -> shared; shown to the GM only -> the GM seat's own. Badges shown only under the
     pointer are not read (no fixed place) */
  badges() {
    const shared = [], local = [];
    if (!this.ok()) return { shared, local };
    try {
      const api = game.modules.get("moinen-maps")?.active ? game.modules.get("moinen-maps").api?.zones : null;
      const Z = api?.zones?.(), lk = api?.look?.();
      if (!Z?.zones?.length || !lk || lk.numbers !== "always" || (lk.who !== "all" && lk.who !== "gm")) return { shared, local };
      /* SPLASHCLEAR: a badge in the zone's corner (the comic looks' default, the live Warehouse) where moinen-maps places it (display.mjs:
         geometry.cornerPoint(zone, min(0.9 label r, 0.55 grid)), on the public API) */
      const corner = lk.place === "corner", cp = api?.geometry?.cornerPoint, g = canvas.dimensions?.size ?? canvas.grid?.size ?? 100;
      if (corner && typeof cp !== "function") return { shared, local };
      const z = this.zoom();
      for (const q of Z.zones) {
        const l = q?.label; if (!l || !Number.isFinite(l.x) || !Number.isFinite(l.y)) continue;
        let p = l;
        if (corner) { try { p = cp(q, Math.min((Number(l.r) || 40) * 0.9, g * 0.55)); } catch (e2) { p = null; } }
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        const r = Math.min(19, Math.max(8, (Number(l.r) || 40) * 0.8 * z)) * 1.2, a = this.toScreen(p);
        (lk.who === "all" ? shared : local).push({ x: a.x - r, y: a.y - r, w: 2 * r, h: 2 * r, id: `zone:${q.id}` });
      }
    } catch (err) { once(err); }
    return { shared, local };
  },
  /* SAMEPIC: the standard view: the canvas view minus Foundry's bars as the same fixed band on every seat (same-picture.mjs RESERVE) */
  std(tr = null) { const r = canvas.app.view.getBoundingClientRect(), p = tr ? { x: tr.x + tr.w / 2 - r.left, y: tr.y + tr.h / 2 - r.top } : null, s = standardRect(r.width || globalThis.innerWidth || 1600, r.height || globalThis.innerHeight || 900, p); return { l: s.l + r.left, t: s.t + r.top, r: s.r + r.left, b: s.b + r.top }; },
  /* KOSAME: the view a moment is PLANNED on (null = the live one). See planFrame */
  frame: null,
  zoom: () => view.frame?.scale ?? (canvas.stage.scale?.x || 1),
  toScreen(p) { const v = this.rect(); if (this.frame) { const q = P.frameScreen(p, this.frame, canvas.stage.position); return { x: v.ox + q.x, y: v.oy + q.y }; } const g = canvas.stage.toGlobal(p); return { x: v.ox + g.x, y: v.oy + g.y }; },
  toWorld(p) { const v = this.rect(); if (this.frame) return P.frameWorld({ x: p.x - v.ox, y: p.y - v.oy }, this.frame, canvas.stage.position); return canvas.stage.toLocal({ x: p.x - v.ox, y: p.y - v.oy }); },
  tokRect(tok) { const a = this.toScreen({ x: tok.x, y: tok.y }), z = this.zoom(); return { x: a.x, y: a.y, w: (tok.w ?? 100) * z, h: (tok.h ?? 100) * z }; }
};
/* KOSAME (pure frameScreen): the view a moment is laid out on. While the map's action camera is away from the user's view (moinen-maps
   directorStage.status().home: where it goes back to) that view, not the camera's view of this instant (seats had the same view and still got
   another size and side: the camera went to the blow on one seat and not on the other, or was halfway). Else the live view. */
function planFrame(items = []) {
  let base = null;
  try {
    const mm = game.modules?.get?.("moinen-maps");
    base = mm?.active ? P.cleanFrame(mm.api?.directorStage?.status?.()?.home) : null;
  } catch (err) { once(err); }
  base ??= liveFrame();
  /* KOSAME (seen live on lane 5, both seats panned alike before the attack: the director then moved the GM's own view to keep the acting
     token in sight, ~190 screen px, and the word took another side there): the users' own views may differ by the map's design (each seat's
     follow mode). A moment whose tokens stand well inside this seat's view is laid out with them in the middle of the view (pure
     centredFrame, at this seat's zoom), the same on every such seat; follow() still keeps the drawn word inside this seat's live view and
     off its panels. A moment near this seat's edge keeps this seat's view (its word goes inward). */
  try {
    const pts = [];
    for (const it of items) for (const t of it.cluster ? (it.members ?? []).map((m) => m.tok) : [it.tok]) { const c = t && !t.destroyed ? t.center : null; if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) pts.push(c); }
    if (base && pts.length) {
      const c = { x: pts.reduce((s, q) => s + q.x, 0) / pts.length, y: pts.reduce((s, q) => s + q.y, 0) / pts.length };
      const v = view.rect();
      return P.centredFrame(base, c, canvas.stage.position, v.r - v.l, v.b - v.t);
    }
  } catch (err) { once(err); }
  return base;
}
/* the live view as a frame (a plan remembers what it was laid out on: measure() fits the drawn word in the same view) */
const liveFrame = () => { try { const s = canvas.stage; return s?.pivot && s?.scale ? P.cleanFrame({ x: s.pivot.x, y: s.pivot.y, scale: s.scale.x }) : null; } catch { return null; } };
/* run fn laid out on the view f (null: the live view); never left set across an await */
function inFrame(f, fn) {
  const was = view.frame;
  view.frame = f ?? null;
  try { return fn(); } finally { view.frame = was; }
}
/* CROWDKO: the tokens hidden from the players (GM seat: kept clean of by lettering only the GM's seat shows) */
function hiddenRects() {
  const out = [];
  if (!view.ok()) return out;
  try { for (const t of canvas.tokens?.placeables ?? []) if (t.document?.hidden === true) out.push({ ...view.tokRect(t), id: t.id, kind: "tok" }); } catch (err) { once(err); }
  return out;
}
/* the tokens this seat sees near the moment (their faces count against a side) */
function tokenRects(skip) {
  if (!view.ok()) return [];
  const out = [];
  /* PRIV (seen live on lane 5: beside a token the GM had hidden, the GM's word took another side and a smaller fit than the player's): a
     token hidden from the players is not an obstacle on any seat, so the word stands alike on the GM's seat and a player's */
  /* SAMEPIC (ADVX 9): every token nobody hides, whether THIS seat's vision shows it or not (the GM sees through every wall, a player does not:
     the same blow took another side per seat). As in the map splash's shared frame: a token hidden from the players never counts */
  try { for (const t of canvas.tokens?.placeables ?? []) if (!skip.has(t.id) && t.document?.hidden !== true) out.push({ ...view.tokRect(t), id: t.id, k: P.SLOT_K.token }); } catch (err) { once(err); }
  /* CROWD (seen in the crowd check: a token the GM hid, hit with a crowd, pushed the crowd's word aside on the GM's seat only): a hidden token
     lettered in this moment is no obstacle either (its own word still keeps off the others) */
  for (const id of skip) { const t = canvas.tokens?.get(id); if (t && view.ok() && t.document?.hidden !== true) out.push({ ...view.tokRect(t), id, k: P.SLOT_K.token }); }
  return out;
}

/* the size of one word on screen (FXLT, review 5): the kind's target, handed to the engine's own model as a scale */
/* SAMEPIC (ADVX 9: one hit 1.8x bigger on the player's seat): the engine's "legible" size model clamps every world word by THIS seat's window
   height, its usable width (the sidebar) and the number of world words alive here (the GM's seat has the numbers a player may not see, and
   more words alive shrink the ceiling): the words are now sized "screen" (cap height in CSS px, from the shared target alone), the engine's own
   Scale (a client setting) divided out, and the zoom handled here (follow) */
const engineK = (L) => { const k = Number(L?.prefs?.scale); return k > 0 ? k : 1; };
/* SIZEDEAD: ... and put back as part of the TABLE's size, where the layout counts it (the word's box, its ceilings, its place): the
   lettering's Size is the table's since engine 1.9.16 (one value on every seat), so it no longer breaks the one picture. An older engine
   (its Size each screen's own) keeps the old rule: divided out, not counted */
const tableScaleOf = (L) => { try { const k = Number(L?.table?.scale); return typeof L?.setTable === "function" && k > 0 ? k : 1; } catch { return 1; } };
const tableSizeOf = (L) => P.tableSize(get(KEY.size, "normal"), tableScaleOf(L));
/* SIZEDEAD (seen live, lane 5: with the table's size counted, a knock-down drew 61 px at "small", 43 at "normal", 37 at "large"): the
   scale's lower stop (0.2 of the engine's own size: the legible floor, ~80 px for a loud word on the reference view) held every loud
   word at ONE drawn size whatever the table chose, and only where it was drawn: its box, its ceilings and its place were those of the
   smaller size asked for, so the word stood up to a quarter bigger than the box the layout judged, and a bigger choice of the table
   (a bigger box, the same word) was shrunk harder by the layout. The floor is now part of a WORD's planned size (planOf: it moves with
   the table's size and stays under the ceilings), so a word is drawn at the size it was planned, judged and placed at; a number keeps
   the stop where it is drawn (held = true), moved with the table's size */
const naturalPx = (L, text, opts) => {
  try {
    const s = L.sizeOf?.(text, { ...opts, scale: 1, fit: "screen" });
    return s && Number.isFinite(s.natural) && Number.isFinite(s.sizeK) ? s.natural * s.sizeK : 0;
  } catch { return 0; }
};
function scaleFor(L, text, opts, targetPx, u = 1, held = true) {
  const px0 = naturalPx(L, text, opts);
  return px0 > 0 ? P.wordScale(targetPx / px0, u, held) / engineK(L) : 1;
}
/* SAMEPIC: the reference window (same-picture.mjs), not this one: two windows show the word at one size against its token */
const vh = () => P.REF_VH;
const vw = () => P.REF_VW;
const ZOOM_FLOOR_PX = 15;      // a standing word shrinks with a zoom-out no further than this cap height (the engine's legible floor's minimum)
/* what one reaction draws and where: the cap heights, the scales, the group box (word + numbers + room for the motion) */
/* the screen box a reaction stands by, now: its token's, or a cluster's (CROWD: the box round all its members) */
function rectOf(it) {
  if (!view.ok()) return { x: 0, y: 0, w: 100, h: 100 };
  if (!it.cluster) return view.tokRect(it.tok);
  const rs = it.members.filter((m) => m.tok && !m.tok.destroyed).map((m) => view.tokRect(m.tok));
  if (!rs.length) return view.tokRect(it.tok);
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)), x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, tokPx: Math.max(...rs.map((r) => Math.max(r.w, r.h))) };
}
function planOf(L, it) {
  const tok = it.tok, lk = it.lk;
  /* SIZEDEAD: the table's size (the reactions' step x the lettering's Size): the word's wanted size, its floor and its ceilings */
  const user = tableSizeOf(L);
  const tokRect = rectOf(it);
  const tokPx = tokRect.tokPx ?? Math.max(tokRect.w, tokRect.h);
  const word = it.mode === "full" || it.mode === "mark";
  /* PRIV: a "mark" (a crowd's small word for a reaction whose number not every seat may show) keeps this seat's own number beside it: the
     word is the same on every seat, the number is the seat's (before, a reader's seat had the number alone where another seat had the word) */
  /* CROWDKO-2: a crowd's word holds up to FOLD.max tags of its members' folded numbers */
  const nMax = it.cluster && it.roomOf?.length ? Lay.FOLD.max : 2;
  const nums = it.mode === "silent" ? [] : (isCaptioned(tok.id) ? lk.numbers.filter((n) => n.stat !== "health") : lk.numbers).slice(0, nMax);
  /* a blow of a series stands a little bigger each step it has EARNED (CROWD: pure seriesStep, capped by the series' sum) */
  /* CROWD2: half of the growth for the rhythm (every blow of a series a little bigger), half for the rungs the damage earned (pure seriesGrow) */
  const grow = P.seriesGrow(lk.step ?? 0, lk.sstep ?? lk.step ?? 0);
  /* CROWD2: the growth applies to the size the series' first word stood at (after the legible floor, which swallowed a small growth: a -1's
     word stands at the floor), never over the cap */
  const ceilH = P.sizeCeil(tokPx, vh(), vw(), user).capH;
  let cap = word ? Math.min(ceilH, P.targetPx(lk.kind, lk.amt, lk.sizeWord ?? lk.word, tokPx, vh(), vw(), it.scale, user) * grow) : 0;
  /* CROWD (ADVX 17): a cluster's word is never under the crowd floor (far out the crowd reads as one event, not a heap of specks) */
  if (word && it.cluster) cap = Math.min(ceilH, Math.max(cap, P.crowdFloor(vh()) * user));
  const z0 = view.ok() ? view.zoom() : 1;
  const base = { space: "world", token: tok.document, anchor: "center", reduced: reduced(), fit: "screen", ...layer() };
  const wordOpts = word ? { ...base, mood: lk.mood, sound: lk.sound, magnitude: lk.magnitude, seed: it.seed, hold: lk.hold, rotation: lk.rotation, colors: lk.colors, ...(lk.hand ? { hand: lk.hand } : {}), ...lk.motion, ...(Number.isFinite(lk.from) ? { from: lk.from } : {}), ...(Number.isFinite(lk.dirSign) ? { dir: lk.dirSign } : {}) } : null;   // PALETTE: lk.hand = a pinned block (colour only); DIRECT: grows away from the attacker
  /* SIZEDEAD: the legible floor of a word (pure stopPx: a share of the engine's own size, times the table's size), under its ceiling */
  if (wordOpts) cap = Math.min(ceilH, Math.max(cap, P.stopPx(naturalPx(L, lk.word, wordOpts), user)));
  const numOpts = nums.map((n, i) => ({ ...base, mood: n.mood, sound: n.sound, hand: n.hand, colors: n.colors, magnitude: Math.max(0.3, lk.magnitude * 0.8), seed: `${it.seed}#n${i}`, rotation: word ? -lk.side * 3 : 0, in: n.in, holdKind: "boil", out: n.out }));
  let numCap = (word ? cap * P.SIZE_RULE.numK : P.basePx(tokPx, vh()) * P.SIZE_RULE.crowdNumK * 1.1 * user * it.scale);
  /* SIZEDEAD: a word's numbers hold their own floor in the plan too, never over their word (held where it was drawn, and moved with the
     table's size, a "-9" stood 141 px beside a 125 px word at the biggest choice). A number without a word keeps the stop where it is drawn */
  if (word && numOpts.length) numCap = Math.min(Math.max(cap, numCap), Math.max(numCap, P.stopPx(Math.max(...nums.map((n, i) => naturalPx(L, n.text, numOpts[i]))), user)));
  const aspect = word ? P.SIZE_RULE.aspect * ([...lk.word].length + 0.5) : 0;      // refined from the drawn word once it is up (follow)
  /* room for the motion: a rise leaves upward, and a power-up's letters may climb like stairs (seen in ADVT c4: "RAAA!" climbed out
     of the view by a whole cap) */
  const rising = ["rise", "grow"].includes(lk.motion.in) || lk.motion.out === "rise";
  /* PRIV: room for the numbers a reader's seat letters (it.room), so the word stands alike on every seat; this seat's own numbers fill it */
  /* (the room stays when the map's director captions this token's damage on this seat: whether it does differs per seat, seen live on lane 5,
     where the player's knock-down word stood bigger and elsewhere than the GM's) */
  /* CROWD2 (CROWD-11: a player's own number stood elsewhere than the GM's copy): the room is ALWAYS the reader's (not this seat's numbers
     when it has as many: a told number may have other digits), and each number takes the place of ITS track in that room (numIdx), so a seat
     that shows only the Resolve number puts it where every other seat has the Resolve number, not in the Health number's place */
  const room = word && (it.room?.length ?? 0) ? it.room.slice(0, nMax) : nums.map((n) => n.text);
  const gArgs = word ? { cap, aspect, nums: room, numCap, side: lk.side, up: (rising ? 0.6 : 0.4) + (lk.mood === "powerup" ? 0.6 : 0), down: lk.motion.in === "drop" ? 0.3 : 0.2 } : null;
  /* a number alone (a cluster's member, a crowd over the cap) holds the room of the numbers a reader's seat letters, as a word does (PRIV):
     the box every seat places is the same whatever numbers this seat may show (CROWD: a later unit's side must not depend on it) */
  const numRoom = !word && (it.room?.length ?? 0) ? it.room.slice(0, 2) : nums.map((n) => n.text);
  const numIdx = nums.map((n, i) => { const j = n.of && it.roomOf ? it.roomOf.slice(0, nMax).indexOf(n.of) : (it.roomStats ?? []).slice(0, 2).indexOf(n.stat); return j >= 0 ? j : Math.min(i, Math.max(0, (word ? room : numRoom).length - 1)); });
  let g = word ? P.group(gArgs)
    : P.group({ cap: numCap, aspect: 0, nums: numRoom, numCap, side: 0, up: 0.25, down: 0.15 });
  /* ALIGN (engine 1.9.1 recipe, owner: one accent): the word that gets the moment's impact does not flash on its own; the impact IS its
     accent and lands on its contact. Every seat passes the same (the event decides, not the seat), so the word's contact is one rule */
  if (wordOpts && (it.impact || it.folded)) wordOpts.flash = false;      // IMPCALL2: a folded blow's flash was the roll's
  if (wordOpts) wordOpts.scale = scaleFor(L, lk.word, wordOpts, cap, user, false);
  numOpts.forEach((o, i) => { o.scale = scaleFor(L, nums[i].text, o, numCap, user, !word); });
  const plan = { tokRect, tokPx, box: { w: g.w, h: g.h }, g, gArgs, z0, cap, numCap, user, nums, numIdx, wordOpts, numOpts, text: word ? lk.word : null, slot: "above", rect: () => rectOf(it),
    frame: view.frame ?? liveFrame() };      // KOSAME: the view it was laid out on (measure fits the drawn word in it)
  /* CROWD (ADVX 8: "THWUP!UP!": two words placed on letter-count estimates, then each re-fitted alone on its drawn box against the others'
     stale estimates): the word's drawn box is asked of the engine BEFORE it is placed (L.planFor: the same plan the word will play, with the
     table's options, reduced motion off, so every seat plans one box), so the whole moment is laid out once on real boxes and stays put */
  /* CALLERS (engine 1.9.11 L.measure): the same plan, plus the word's real entrance reach; the footprint (life + rim) pads the word's box */
  if (word && (L.measure || L.planFor)) {
    try {
      /* CALLERS2 (engine 1.9.18): measured at one device pixel per CSS px on every seat (view.dpr 1: the rim's pixel floor is the table's,
         not this screen's density); the size itself stays this seat's (a view without vw / vh / zoom keeps them) */
      const ro = { ...wordOpts, reduced: false, view: { dpr: 1 } };
      const m = L.measure ? L.measure(lk.word, ro) : null;
      const pl = m?.plan ?? L.planFor(lk.word, ro)?.plan;
      const hb = pl?._holdBox;
      if (hb && hb.w > 0 && hb.h > 0) {
        plan.gArgs = { ...gArgs, aspect: hb.w, tall: hb.h, pad: P.footPad(m, hb) };      // CALLERS2: the engine's standing footprint (m.stand)
        if (m?.reach && m.unit > 0) plan.reach = { l: m.reach.l / m.unit, r: m.reach.r / m.unit, u: m.reach.u / m.unit, d: m.reach.d / m.unit };
        g = P.group(plan.gArgs); plan.g = g; plan.box = { w: g.w, h: g.h };
        const f = P.fitDrawn({ cap, hbW: hb.w, hbH: hb.h, tokenPx: tokPx, vh: vh(), vw: vw(), u: user });
        if (f < 0.98) shrink(plan, f);
        plan.measured = true; plan.pre = true;
      }
    } catch (err) { once(err); }
  }
  return plan;
}
/* the world point of one member of a reaction's group, every frame: from its token's place now, on the side chosen at the start,
   pushed into the safe rect while the token is on screen (reviews 1, 7, 14) */
/* once the word is drawn its real shape replaces the letter-count estimate (the engine's plan of the word, contract h.plan; its hold box
   in cap heights): the numbers then stand right at its end, not over it (seen live: "-1" sat on the M of a wide WHAM!) */
function measure(plan, tok = null) {
  if (plan.measured || !plan.gArgs) return;
  const hb = plan.wordH?.plan?._holdBox;
  if (!hb || !(hb.w > 0) || !(hb.h > 0)) return;
  plan.measured = true;
  if (plan.kLoc < 0.999) { shrink(plan, 1 / plan.kLoc, true); plan.kLoc = 1; }      // SAMEPIC: the guard is fitted again below on the drawn box
  /* the drawn box over the limits: the word (live, its handle's scale is read every frame) and the numbers not yet started shrink with it */
  const f = P.fitDrawn({ cap: plan.cap, hbW: hb.w, hbH: hb.h, tokenPx: plan.tokPx ?? 100, vh: vh(), vw: vw(), u: plan.user ?? 1 });
  if (f < 0.98) shrink(plan, f);      // the numbers already started (they wait for the blow's instant) shrink too
  if (!plan.gArgs.pad && engine?.measure && plan.text) {      // CALLERS2: the footprint, measured by the engine when it was not before the play
    try { const m = engine.measure(plan.text, { ...plan.wordOpts, reduced: false, view: { dpr: 1 } }); const mh = m?.plan?._holdBox; if (mh) plan.gArgs = { ...plan.gArgs, pad: P.footPad(m, mh) }; } catch (err) { once(err); }
  }
  const regroup = () => { const g = P.group({ ...plan.gArgs, aspect: hb.w, tall: hb.h }); plan.g = g; plan.box = { w: g.w, h: g.h }; };
  regroup();
  /* FXLT2 (ADVT2 6, 10): the side was chosen on the letter-count estimate; with the drawn box known (the first frame) it is chosen again,
     so a wider or taller word than estimated does not land on a neighbour, a panel or another word */
  try {
    /* FXI-TOKEN (ADVI 5): fitted again, smaller when no side is free at this size; a series keeps its side only while it still fits */
    /* KOSAME: fitted again on the view the moment was laid out on (plan.frame), not on this instant's (the action camera may be on its way
       on one seat and not on another); a plan without one (no stage to read) keeps the old rule: only while the zoom is the planned one */
    if (plan.blocked && tok && view.ok() && !plan.ck && (plan.frame || Math.abs(view.zoom() / plan.z0 - 1) < 0.02)) inFrame(plan.frame, () => {      // CROWDKO: a place the layout chose stays
      const tr0 = view.tokRect(tok), fit = P.fitSame(tr0, plan.box, view.std(tr0), view.safe(), plan.blocked, plan.mine ?? [], { keep: plan.keep ?? null });
      if (fit.k < 0.999) { shrink(plan, fit.k); regroup(); }
      plan.slot = fit.slot; plan.same = fit.same; plan.moved = fit.moved ?? null;
      /* SAMEPIC: a live probe may collect the inputs of each fit (set globalThis.__samepicFit = [] in a console); nothing is kept otherwise */
      if (Array.isArray(globalThis.__samepicFit)) globalThis.__samepicFit.push({ pass: "drawn", name: tok.name, tok: tr0, box: plan.box, std: view.std(tr0), real: view.safe(), shared: plan.blocked, mine: plan.mine ?? [], keep: plan.keep ?? null, fit });
    });
  } catch (err) { once(err); }
}
function follow(tok, plan, member) {
  let last = null;
  return () => {
    try {
      if (!tok || tok.destroyed || !view.ok()) return last;
      measure(plan, tok);
      /* FXLT2 (ADVT2 4: zooming in while a word stood blew it up to ~750 px over its token, the interface and a neighbour): zooming in
         never makes a standing word bigger on screen than it landed (its scale follows start zoom / zoom); zooming out it shrinks with
         the map like its token */
      /* SAMEPIC: sized "screen" (CSS px whatever the zoom): zooming out shrinks the group with the map, never under the legible floor;
         zooming in never grows it (before, the engine's "legible" model drew it, clamped by this seat's window) */
      const z = view.zoom(), k = Math.max(Math.min(1, z / plan.z0), Math.min(1, ZOOM_FLOOR_PX / Math.max(1, plan.cap || plan.numCap || 1)));
      const h = member < 0 ? plan.wordH : plan.numH?.[member];
      if (h?.opts && Number.isFinite(h._s0)) h.opts.scale = h._s0 * k;
      const tr = plan.rect ? plan.rect() : view.tokRect(tok), box = { w: plan.box.w * k, h: plan.box.h * k };
      let c = P.slotPoint(plan.slot, tr, box);
      const safe = view.safe(), std = plan.ownView ? safe : view.std(tr);
      /* FXLT2 (seen live on lane 5: a word pushed into the view's corner landed on the map's VRAM meter, one beside the challenge cards
         slid under them): inside the safe rect, then out of the floating panels, on the side that moves it least and stays in view.
         SAMEPIC (ADVX 13: "BAM! -2" cut by the top on the GM's seat, whole on the player's): first into the STANDARD view (the same band
         on every seat), then this seat's own limits, which leave it alone unless this seat really has less room */
      /* CALLERS: the view's edges keep the word's whole entrance reach (L.measure), so the engine's own keep-in-view (which moves a word by
         its reach on THIS seat) has nothing left to move; panels and neighbours keep the standing word's box */
      const eb0 = P.edgeBox(plan.g, plan.cap || 0, plan.reach), eb = eb0 ? { w: eb0.w * k, h: eb0.h * k } : box;
      /* CROWDKO: the clean place the layout found, as a shift from the side's own point (it scales with the map like the token) */
      if (plan.nudge) { const zr = z / (plan.z0 || z); c = { x: c.x + plan.nudge.x * zr, y: c.y + plan.nudge.y * zr }; }
      /* CROWD (ADVX 14): a token not on THIS seat's view (off screen, under the open sidebar): off-panel, at the view's edge nearest to it.
         CROWDKO: one function with the layout (layout.mjs restCentre: the same pushes), so the place the layout judged is the place drawn */
      c = Lay.restCentre(c, tr, box, eb, std, safe, view.panelsCached());
      /* DIRECT2: the whole group (the word and its numbers) is knocked along the blow (Dir.knockAt, on the word's own clock), never forward
         into its struck token (wallTravel) and kept inside this seat's view */
      if (plan.trav) {
        const q = Dir.knockAt(plan.dir, performance.now() - plan.trav.t0, plan.trav), px = (plan.cap || 0) * k;
        const w = Dir.wallTravel(c, { x: q.x * px, y: q.y * px }, eb.w / 2, eb.h / 2, tr, plan.dir);
        const d = Dir.clampTravel(c, w, eb.w / 2, eb.h / 2, safe);
        c = { x: c.x + d.x, y: c.y + d.y };
      }
      plan.at = { c, k };      // GORECLEAR: where the group stands on this seat now (inkNow)
      const off = member < 0 ? plan.g.word : plan.g.nums[member];
      last = view.toWorld({ x: c.x + off.dx * k, y: c.y + off.dy * k });
      return last;
    } catch (err) { once(err); return last; }
  };
}

function play(L, it, queued = false) {
  try {
    const tok = it.tok, plan = it.plan;
    const seen = (t) => t?.scene && t.scene.id === canvas.scene?.id && !t.destroyed && seatOf(t).visible;
    /* seen again now: the dice or the camera may have held it for seconds (a cluster's word: while this seat sees one of its members) */
    if (it.cluster ? !it.members.some((m) => seen(m.tok)) : !seen(tok)) return;
    const pkey = it.cluster ? it.key : tok.id;      // CROWD: a cluster's word is its own entry, beside its members' (their numbers, their motion)
    /* one reaction per token at a time (review 4): a lighter one waits for a heavier one still on screen; an equal or worse one takes over */
    const pe = playing.get(pkey);
    if (pe) {
      const age = Date.now() - pe.t0, how = P.overlap(pe.sev, age, pe.span, it.sev);
      if (how === "queue" && !queued) { Promise.race([pe.done, new Promise((r) => setTimeout(r, Math.min(QUEUE_MAX, P.queueWait(age, pe.span))))]).then(() => play(L, it, true)); return; }
      /* the next blow of a series takes the last one's place at once (ADVT2 5: the second blow was drawn over the first one's shards) */
      const quick = (it.lk.step ?? 0) > 0;
      /* FXI-TOKEN: ... when the new word comes up (it starts before the blow's instant by its own entrance), not before: no empty token */
      const gone = () => { for (const h of pe.hs) try { h.stop({ quick }); } catch { /* gone */ } };
      const at = Number.isFinite(it.tHit) ? it.tHit - P.HIT_LEAD * 0.5 - performance.now() : 0;
      if (at > 15) setTimeout(gone, at); else gone();
    }
    /* a reaction that waited (queued) or comes late gets a new instant: never one in the past.
       SYNC: "late" is now LATE_MAX past the table's instant; a word a little behind joins it (its entrance starts in the past) */
    if (!Number.isFinite(it.tHit) || queued || it.tHit < performance.now() - LATE_MAX) it.tHit = performance.now() + P.HIT_LEAD;
    const tHit = it.tHit;
    const lk = it.lk, hs = [], red = plan.wordOpts?.reduced ?? reduced();
    const entry = { hs, sev: it.sev, t0: Date.now(), span: lk.hold + 600, loss: !!it.loss, card: it.card ? true : null, nums: [], done: null, addNumber: null, dropNumbers: null, slot: plan.slot, plan };
    entry.ids = it.ids ?? [tok.id];      // CROWD: the tokens this entry letters (a cluster's word: all its members; recheck)
    plan.numH = [];
    let word = null;
    playing.set(pkey, entry);
    /* FXI-TOKEN (ADVI 2, 13): the word strikes ON the blow's instant: it is started earlier by its own entrance's contact (pure contactMs; the
       engine plans the word on the call and reads its start time in the next frame, so the start is set from the plan right here) */
    let contact = 0;
    if (plan.wordOpts) {
      word = L.play(lk.word, { ...plan.wordOpts, at: follow(tok, plan, -1), startAt: tHit });
      word._s0 = plan.wordOpts.scale; hs.push(word); plan.wordH = word;
      try {
        if (word.plan?.timeline && word.opts) { contact = P.contactMs(word.plan, red || !!word.reducedMotion); word.opts.startAt = Math.max(performance.now() - LATE_MAX, tHit - contact); contact = tHit - word.opts.startAt; }      // SYNC: may start in the past (it then strikes on the table's instant)
      } catch (err) { once(err); }
    }
    const entMs = (() => { try { return (word?.plan?.timeline?.ent ?? []).reduce((a, p) => a + (p.ticks ?? 0) * (1000 / 24), 0); } catch { return 300; } })();
    /* DIRECT2: the word lands back toward the attacker on its contact, is knocked past its place, slides on and is thrown out the same way
       (follow, on the word's own clock; its numbers ride with it); a heavier blow knocks farther */
    plan.dir = it.dir ?? null;
    if (plan.dir && word?.opts && Number.isFinite(word.opts.startAt)) plan.trav = { t0: word.opts.startAt, contact, holdEnd: entMs + lk.hold, k: Dir.knockK(lk.magnitude), reduced: !!(red || word.reducedMotion) };
    const numAt = (i) => follow(tok, plan, Math.min(i, plan.g.nums.length - 1));
    const playNum = (n, o, i, late = false) => {
      if (playing.get(pkey) !== entry) return;
      if (n.stat === "health" && isCaptioned(tok.id)) return;      // the director's caption says it now (review 7)
      /* beside a word it leaves with the word; alone (a crowd) it stands as long as a word would (seen live: crowd numbers were gone
         in a second) */
      const h = L.play(n.text, { ...o, hold: word ? Math.max(700, lk.hold + entMs - contact - P.NUM_AFTER - 250) : lk.hold + 300, at: numAt(i), ...(late ? {} : { startAt: tHit + (word ? P.NUM_AFTER : it.numDelay ?? 0) }) });      // CROWD: a cluster member's tag pops after the cluster's word struck
      h.stat = n.stat; h._s0 = o.scale; plan.numH[Math.min(i, plan.g.nums.length - 1)] = h; hs.push(h); entry.nums.push(h); settle();
    };
    /* the numbers come once the word has struck (review 13), on the shared clock: NUM_AFTER the blow's instant */
    plan.nums.forEach((n, i) => playNum(n, plan.numOpts[i], plan.numIdx?.[i] ?? i));      // CROWD2: each number in its track's place
    /* ALIGN: the impact after the word and its numbers, so it can keep them readable (engine 1.9.1 `keep`) and land on the word's contact
       as the engine reads it (`blowAt: L.contactAt(word)`) */
    if (it.impact) { const mem = it.cluster ? it.members.flatMap((m) => playing.get(m.tok.id)?.nums ?? []) : []; const ih = impactOf(L, it, it.impTok ?? tok, tHit, red, word, [word, ...entry.nums, ...mem]); if (ih) hs.push(ih); }
    /* a Damage Taken card arriving late still gives a numberless reaction its told number (review 17) */
    entry.addNumber = (stat, sign, n) => {
      if (entry.nums.length || !plan.g.nums || isCaptioned(tok.id)) return;
      const nl = P.numberLook(stat, sign, n, lk.amt);
      const o = { space: "world", token: tok.document, anchor: "center", reduced: red, ...layer(), mood: nl.mood, sound: nl.sound, hand: nl.hand, colors: nl.colors, magnitude: Math.max(0.3, lk.magnitude * 0.8), seed: `${it.seed}#late`, rotation: -lk.side * 3, in: nl.in, holdKind: "boil", out: nl.out };
      o.scale = scaleFor(L, nl.text, o, plan.numCap || plan.cap * P.SIZE_RULE.numK, plan.user ?? 1, !plan.text);
      if (!plan.g.nums.length && plan.gArgs) { plan.gArgs = { ...plan.gArgs, nums: [nl.text] }; plan.measured = false; const g = P.group(plan.gArgs); plan.g = g; plan.box = { w: g.w, h: g.h }; measure(plan); }
      playNum(nl, o, 0, true);
    };
    entry.dropNumbers = (stat) => { for (const h of entry.nums) if (!stat || h.stat === stat) try { h.stop({ quick: false }); } catch { /* gone */ } };
    settle();
    tokenMoves(L, it, tok, word, tHit);
    /* the token's entry goes when every word of this reaction (the numbers too) has ended */
    function settle() {
      const n = hs.length;
      const p = Promise.allSettled(hs.map((h) => h.finished)).then(() => { if (hs.length === n && playing.get(pkey) === entry) playing.delete(pkey); });
      entry.done = p;
    }
  } catch (err) { once(err); }
}

/* WIRE1: the impact frame of a reaction, at the instant its word strikes (FXI-TOKEN: the blow's instant tHit, the same on every seat; the
   word is started so that its contact falls on it).
   The token itself is the subject (the engine draws nothing for a token this user does not see, and its picture becomes the silhouette);
   the attacker gives the blow's direction only when this seat sees him (a direction would point at a hidden one). Reduced motion is handed
   in only as true (a false would override the OS switch); nothing here touches the photosensitivity guard. */
function impactOf(L, it, tok, tHit, red, word = null, keep = []) {
  try {
    const I = L?.impact;
    if (!I?.play || !seatOf(tok).visible) return null;
    /* CROWDKO (ADVS2 D8: a knock-down outside both seats' views still flashed the whole view): the impact is the accent of a blow THIS seat
       sees happen; a token outside this seat's view gets none here (its word still letters at the view's edge). Off the view is the token's
       ring not touching the view at all (pure onView), so a seat that sees the token at its edge still gets the frame */
    /* IMPCALL2 (ADVI2 6: a seat whose view lacked the struck token got nothing for the damage while the table saw a cut): the impact then
       lands, GENTLE (the engine's local panel: no full frame, no hit-stop, no inverted scene), on the off-panel word at this view's edge that
       letters the blow (or its number), so the seat still sees that something struck there; never a flash of a whole view for an off-view
       blow (CROWDKO-6 stays) */
    const offView = view.ok() && !P.onView(view.tokRect(tok), view.safe());
    const edge = offView ? keep.find((h) => h && h.alive !== false && !h.off) ?? null : null;
    if (offView && !edge) return null;
    const { rung, ...imp } = it.impact;
    /* ALIGN (engine 1.9.1 recipe): `blowAt` = the instant the word strikes as the ENGINE reads it (L.contactAt: the word's contact pose,
       on the 24 Hz grid in stepped motion; = tHit by construction in smooth motion), and the engine starts the impact plan.peakMs before it,
       so its strongest drawing lands WITH the word (one accent). The peak comes from the full plan on every seat (a reduced seat's still
       drawing stands at the same instant: contract 1.8.2), so seats keep one instant. Replaces FIN-CALLERS' own measure of the leading
       "lines" (pure leadMs), which missed the other lead-ins the engine counts (REQUESTS FINC-E4). No word on this seat: the shared tHit. */
    let blowAt = Number.isFinite(tHit) ? tHit : performance.now();
    try { const c = word && L.contactAt ? L.contactAt(word) : null; if (Number.isFinite(c)) blowAt = c; } catch (err) { once(err); }
    /* ALIGN: a blow of a series is the engine's series too (pure withSeries: grown inside its rung) */
    /* CROWD: the step the series EARNED (pure seriesStep: capped by its sum); a cluster's impact is its heaviest member's blow */
    const by = it.impIt ?? it;
    /* CROWD2: the series' rhythm (its raw step) builds INSIDE the rung its damage earned (withSeries caps it under the next strength bound) */
    const spec = { ...P.withSeries(imp, by.lk?.step ?? 0), subject: edge ?? tok, seed: `${by.seed}|impact`, blowAt };
    if (edge) spec.gentle = true;
    /* ALIGN (engine 1.9.1 `keep`): the word and its numbers are world words IN the scene under the impact's overlay: they stay readable
       through every drawing (a hole cut round them, followed while they move); only handles that are up and alive are passed */
    const kept = keep.filter((h) => h && h.alive !== false && !h.off);
    if (kept.length) spec.keep = kept;
    const src = by.pub?.src ? canvas.tokens?.get(by.pub.src) : null;
    if (!edge && src && src.id !== tok.id && seatOf(src).visible) spec.from = src;
    /* IMPCALL: the rest of the struck crowd takes part as figures (the same id list on every seat; a token that is not on this scene is left
       out, one this seat may not see the engine draws nothing of) */
    const also = (it.impAlso ?? by.impAlso ?? []).map((id) => canvas.tokens?.get(id)).filter((t) => t && t.id !== tok.id && t !== spec.from);
    if (also.length && !edge) spec.also = also;
    if (red) spec.reduced = true;
    /* LYING: a token that lies takes part lying (tokenanim posed: its picture is read at this call) */
    return TokAnim.posed([tok, spec.from, ...(spec.also ?? [])], () => I.play(spec));
  } catch (err) { once(err); return null; }
}

/* TOKANIM: the token itself moves with its reaction (scripts/tokenanim/): the kind and amount of the shared reaction (PRIV: the same on
   every seat that sees the token), the series' step, on the word's contact instant as the engine reads it (L.contactAt; every seat the same from the same start),
   else the shared blow instant; the attacker only as a token (tokenanim gives a direction only when this seat sees him) */
function tokenMoves(L, it, tok, word, tHit) {
  try {
    if (it.cluster) return;      // CROWD: each member moves with its own reaction (its number), the cluster's word moves no token
    let at = Number.isFinite(tHit) ? tHit : performance.now();
    try { const c = word && L?.contactAt ? L.contactAt(word) : null; if (Number.isFinite(c)) at = c; } catch { /* the shared instant */ }
    /* IMPCALL2: a challenge's moments move its token as its nearest kinds (progress lifts, overcome rises, failure droops) */
    TokAnim.react(tok, { kind: it.lk.kind in P.ANIM_KIND ? P.ANIM_KIND[it.lk.kind] : it.lk.kind, amt: it.lk.amt, step: it.lk.sstep ?? it.lk.step ?? 0,      /* CROWD: the earned step */ seed: it.seed, at, from: it.pub?.src ? canvas.tokens?.get(it.pub.src) ?? null : null });
  } catch (err) { once(err); }
}

/* DIRECT: the way of a reaction's blow on the board: from its attacker (the fight's last public attack, pub.src) to the struck token, read
   from both documents (the same on every seat); none for a crowd's shared word, a blow without an attacker or one the GM hid (direct.mjs) */
function directionOf(it) {
  try {
    if (it.cluster || !it.pub?.src || !it.tok?.document) return null;
    const src = canvas.tokens?.get(it.pub.src);
    return src ? Dir.between(src.document, it.tok.document, canvas.dimensions?.size ?? canvas.grid?.size ?? 100) : null;
  } catch (err) { once(err); return null; }
}

/* GORECLEAR (the blood on the glass lay over the word of its own blow): the standing ink of every reaction on this seat now, as boxes in
   client px (the word and its numbers as they stand: layout.mjs standAt, at the place follow() last drew them; a reaction laid out but
   not drawn yet answers with its planned place). Asked on REACT_HOOK with { phase: "ink", rects: [] }; whoever draws over the map
   (scripts/gore) keeps clear of them */
function inkNow(rects) {
  try {
    if (!Array.isArray(rects) || !view.ok()) return;
    for (const e of playing.values()) {
      const p = e?.plan;
      if (!p?.g || !p.box) continue;
      let c = p.at?.c ?? null;
      const k = p.at?.k ?? 1;
      if (!c) {
        const tr = p.rect ? p.rect() : p.tokRect;
        if (!tr) continue;
        c = P.slotPoint(p.slot, tr, p.box);
        if (p.nudge) c = { x: c.x + p.nudge.x, y: c.y + p.nudge.y };
      }
      const r = Lay.standAt(c, p.g, k);
      if (r && r.w > 0 && r.h > 0 && Number.isFinite(r.x) && Number.isFinite(r.y)) rects.push({ x: r.x, y: r.y, w: r.w, h: r.h });
    }
  } catch (err) { once(err); }
}

/* the user's display layer, handed to the engine (contract: the world layer option) */
const layer = () => { const v = get(KEY.layer, "overlay"); return { layer: LAYERS.includes(v) ? v : "overlay" }; };

/* a word must never outlive what this seat may see: the token deleted, hidden from a player or out of his sight ends its words at once
   (the engine follows a token without asking whether this user sees it) */
function cut(id) { for (const h of playing.get(id)?.hs ?? []) try { h.stop({ quick: true }); } catch { /* gone */ } playing.delete(id); }
function recheck() {
  /* CROWD: a cluster's word stays while this seat sees one of its members */
  try { for (const [id, e] of [...playing.entries()]) { if (!(e?.ids ?? [id]).some((t) => { const tok = canvas.tokens?.get(t); return tok && seatOf(tok).visible; })) cut(id); } } catch (err) { once(err); }
}

/* ---------- settings, hooks, start ---------- */
function registerSettings() {
  const has = (key) => game.settings.settings.has(`${MOD}.${key}`);
  /* GMALL (the owner, 2026-11-15: «wszystko mg wybiera dla stołu. wszystko»): on/off is the table's too (it was this client's own); all four
     are shown in the module's table settings window (scripts/table/), not in Foundry's list */
  if (!has(KEY.enabled)) game.settings.register(MOD, KEY.enabled, { name: t("ITR.Settings.Enabled.Name"), hint: t("ITR.Settings.Enabled.Hint"), scope: "world", config: false, type: Boolean, default: true, onChange: (v) => syncOwner(v) });
  /* SAMEPIC (owner 2026-11-14: the token reactions' options are the GM's, for the table, «dla stołu»; ADVX 9): size and layer are the table's */
  if (!has(KEY.size)) game.settings.register(MOD, KEY.size, { name: t("ITR.Settings.Size.Name"), hint: t("ITR.Settings.Size.Hint"), scope: "world", config: false, type: String, default: "normal",
    choices: { small: t("ITR.Settings.Size.small"), normal: t("ITR.Settings.Size.normal"), large: t("ITR.Settings.Size.large") } });
  if (!has(KEY.lang)) game.settings.register(MOD, KEY.lang, { name: t("ITR.Settings.Lang.Name"), hint: t("ITR.Settings.Lang.Hint"), scope: "world", config: false, type: String, default: "en",
    choices: { en: t("ITR.Settings.Lang.en"), pl: t("ITR.Settings.Lang.pl") } });
  if (!has(KEY.layer)) game.settings.register(MOD, KEY.layer, { name: t("ITR.Settings.Layer.Name"), hint: t("ITR.Settings.Layer.Hint"), scope: "world", config: false, type: String, default: "overlay",
    choices: Object.fromEntries(LAYERS.map((id) => [id, t(`ITR.Settings.Layer.${id}`)])) });
}
async function syncOwner(v = enabled()) {
  try {
    if (!v) { Owner.setOn(false); return; }
    await runningEngine();
    Owner.setOn(!!engine && enabled());
  } catch (err) { Owner.setOn(false); once(err); }
}
function registerHooks() {
  Hooks.on("canvasReady", () => { rememberAll(); pending.clear(); playing.clear(); streaks.clear(); inflight.clear(); });
  Hooks.on("drawToken", (tok) => { if (!seen.has(tok.id)) remember(tok); });
  /* SYNC: every stamped change this seat hears teaches the table's clock the server's epoch (shared-clock noteEpoch) */
  for (const k of ["updateActor", "updateToken", "updateCombat", "updateScene", "updateUser"]) Hooks.on(k, (_d, _c, options) => { try { Clock.noteEpoch(options?.modifiedTime); } catch { /* a courtesy */ } });
  Hooks.on("createChatMessage", (m) => { try { Clock.noteEpoch(m?._stats?.createdTime); } catch { /* a courtesy */ } });
  Hooks.on("updateCombat", (c, changes, options) => { try { noteFight(c, changes, options); } catch (err) { once(err); } });      // KOSAME
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
  Hooks.on(SPLASH_HOOK, onSplash);
  Hooks.on(REACT_HOOK, (d) => { if (d?.phase === "ink") inkNow(d.rects); });
}
export function start(phases = {}) {
  try {
    if (started) return true;
    started = true;
    const run = (name, fn) => { if (phases[name]) fn(); else Hooks.once(name, fn); };
    run("init", () => { try { registerSettings(); registerHooks(); } catch (err) { once(err); } });
    run("ready", () => { syncOwner(); if (canvas?.ready) rememberAll(); Clock.start(); });
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
