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
import * as TokAnim from "../tokenanim/main.mjs";      // TOKANIM: the token's own motion

const MOD = "invincible-plus-ultra";
const LOG = `${MOD} (token reactions) |`;
const KEY = { enabled: "tokenReactEnabled", size: "tokenReactSize", layer: "tokenReactLayer", lang: "tokenReactLang" };
const LAYERS = ["overlay", "weather", "tokens", "ground", "top"];      // the engine's world layers (contract v3 `layer`); overlay = its default
const SIZE = { small: 0.8, normal: 1, large: 1.25 };
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
function entry(tok, stat) {
  const k = `${tok.id}|${stat}`;
  let e = pending.get(k);
  if (!e) { e = { k, tokId: tok.id, actorId: tok.actor?.id ?? null, stat, from: null, to: null, max: null, pub: null, keys: new Set(), cause: null, opened: Date.now(), due: 0, seed: "" }; pending.set(k, e); }
  return e;
}
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
      const e = entry(tok, stat);
      if (e.from === null) e.from = a;
      e.to = b; e.max = m;
      if (!e.evSeed) e.seed = P.seedOf(tok.id, stat, stampOf(tok, options));      // a fight's event, when one joined, keeps its own key as the seed
      if (stat === "resolve" && b < a && Date.now() - (lastPush.get(tok.actor?.id) ?? -1e9) < PUSH_MS && !options?.ipuTactics) e.cause = "push";
      if (options?.ipuTactics) e.tactics = true;
      /* a Damage Taken card that came BEFORE this loss joins it (review 17); one card per loss (FXI-TOKEN, ADVI 1) */
      if (stat === "health" && b < a && !e.card) for (const c of cards.get(tok.actor?.id) ?? []) if (Date.now() - c.t < CARD_MS && !c.used?.has(tok.id)) { (c.used ??= new Set()).add(tok.id); join(e, c); break; }
      /* a fall to 0 outside a fight's events: its card (with the critical injury) is still to come; wait for it (CARD_DOWN_WAIT) */
      const waitCard = stat === "health" && b < a && b <= 0 && !e.card && !e.tactics && !e.pub?.broken;
      arm(e, waitCard ? CARD_DOWN_WAIT : QUIET.change);
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
  const e = entry(tok, stat);
  join(e, add);
  /* an event of the fight is the same on every seat: its key is the seed (no values in it). A card is not (FXI-TOKEN, ADVI 1): it may meet
     its loss while gathered on one seat and later on another, so the seed stays the change's stamp, the same everywhere */
  if (!e.evSeed && add.key && !add.isCard) { e.evSeed = true; e.seed = P.seedOf(tok.id, stat, add.key); }
  if (!e.seed) e.seed = P.seedOf(tok.id, stat, stampOf(tok));
  /* WIRE1: who struck (the impact's direction, only when this seat sees him), what the blow was made of, a doubled blow */
  if (add.src) e.src = add.src;
  if (add.dtype) e.dtype = add.dtype;
  if (add.doubled) e.doubled = true;
  arm(e, QUIET.event);
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
    if (ev.type === "broken") told(tok, "health", { broken: true, key });
    else if (Number.isFinite(ev.taken) && ev.taken > 0) {
      const src = attackerOf(ev);
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
    Gate.after(() => land(all, ready));
  } catch (err) { once(err); }
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
      const c = P.classify({ stat: e.stat, from: e.from, to: e.to, max: e.max, cause: e.cause }) ?? (e.pub ? P.fromEvent(e.pub, e.stat) : null);
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
      items.push({ key: tok.id, tok, lk, seed, lang, sev: P.SEVERITY[lk.kind] ?? 0, hasNum: !!pubNum, pub, card: !!card, loss: !!loss, room: (room ?? []).slice().sort((a, b) => (a.stat === "health" ? 0 : 1) - (b.stat === "health" ? 0 : 1)).map((n) => n.text) });
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
  for (let waited = 0; waited < IMPACT_WAIT && L.impact?.busy; waited += STORY_STEP) await wait(STORY_STEP);
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
    if (data.phase === "land") { s.landAt = Number.isFinite(data.landAt) ? data.landAt : performance.now(); s.impactMs = Math.max(0, Math.min(1000, Number(data.impactMs) || 0)); }
    story.set(id, s);
    if (story.size > 30) story.delete(story.keys().next().value);
  } catch (err) { once(err); }
}
async function land(ids, ready) {
  let items = [];
  try {
    if (Moment.isActive()) await Moment.landing(ids, { wait: 0, cap: 1600 });
    const L = engine ?? (engine = await letters());
    const storyEnd = await storyWait(L);
    unflight(ready);
    items = build(ready);
    if (!items.length) return;
    /* the whole moment is placed together, heaviest first: each reaction takes the free side of its token (other tokens, the words
       already placed, the view's edges and the interface count against a side) */
    /* a token mostly outside the safe rect now (off the view, under the interface) is not lettered: its word would hang at the
       edge or over the chat input with nothing under it (seen live in a crowd and in ADVT 6) */
    const onView = (it) => !view.ok() || P.onView(view.tokRect(it.tok), view.safe());
    const staged = P.stage(items.filter(onView)).filter((it) => it.mode !== "none");
    /* the words from the engine's vocabulary (FXLT2, ADVT2 1), a blow of a series one step of one growing sound (ADVT2 5) */
    const vocab = L.vocab?.word ? L.vocab : L.word ? { word: L.word } : null;
    for (const it of staged) {
      const st = streakOf(it.tok.id, it.lk.kind, it.seed);
      it.lk.step = st.step; it.streakSeed = st.streakSeed;
      it.lk.word = it.mode === "number" ? null : P.wordFor(it.lk, vocab, { lang: it.lang, seed: it.seed, step: st.step, streakSeed: st.streakSeed });
      if (!it.lk.word && it.mode !== "number") it.mode = it.hasNum ? "number" : "none";
    }
    /* WIRE1: ONE impact frame per moment, on its worst blow as the table knows it (a crowd is one event: the engine would refuse the rest
       as "busy" anyway); its strength grows with the blow's step in its series */
    let imp = null;
    for (const it of staged) {
      if (it.mode === "none" || !it.pub) continue;
      const spec = P.impactOf(it.pub, it.lk.step, it.pub);
      if (spec && (!imp || spec.magnitude > imp.spec.magnitude)) imp = { it, spec };
    }
    if (imp) imp.it.impact = imp.spec;
    /* FXI-TOKEN (ADVI 2, 13, 15): ONE instant for the moment's blow, the same on every seat (pure HIT_LEAD): the impact starts on it and every
       word is started so that it strikes on it (play). The other reactions of a crowd strike after the impact (its drawings, at most 500 ms,
       took them over: one token's knock-out frame blacked out six reactions), then one after another (their stagger) */
    const T0 = Math.max(performance.now() + P.HIT_LEAD, storyEnd || 0);
    let after = 0;
    try { if (imp && L.impact?.plan) after = Math.min(500, Math.max(0, Number(L.impact.plan({ ...imp.spec, seed: `${imp.it.seed}|impact` })?.ms) || 0)); } catch (err) { once(err); }
    for (const it of staged) it.tHit = it === imp?.it ? T0 : T0 + (imp ? after + it.delay : it.delay);
    const placed = [];
    const others = [...tokenRects(new Set(staged.map((it) => it.tok.id))), ...view.panels()];
    for (const it of staged) {
      if (it.mode === "none") continue;
      try { it.plan = planOf(L, it); } catch (err) { once(err); it.plan = null; }
      if (!it.plan) continue;
      it.plan.blocked = [...others.filter((r) => r.id !== it.tok.id), ...placed];
      /* the next blow of a series lands where the last one stands (ADVT2 5: the third blow of three stood elsewhere), while that side still
         holds the grown word (FXI-TOKEN, ADVI 5: it kept its side and was pushed over its token); a side that is not free is taken smaller
         (pure fitSlot) */
      const pe = playing.get(it.tok.id);
      const was = pe?.plan?.slot ?? pe?.slot;      // the side the last word really took (re-chosen on its drawn box, measure)
      it.plan.keep = it.lk.step > 0 && was && P.FIT_SLOTS.includes(was) ? was : null;
      const fit = view.ok() ? P.fitSlot(it.plan.tokRect, it.plan.box, view.safe(), it.plan.blocked, { keep: it.plan.keep }) : { slot: "above", k: 1 };
      if (fit.k < 0.999) shrink(it.plan, fit.k);
      it.plan.slot = fit.slot;
      const c = P.slotPoint(it.plan.slot, it.plan.tokRect, it.plan.box);
      placed.push({ x: c.x - it.plan.box.w / 2, y: c.y - it.plan.box.h / 2, w: it.plan.box.w, h: it.plan.box.h, k: P.SLOT_K.word });
    }
    const shown = staged.filter((it) => it.plan && it.mode !== "none");
    /* the roll splash (and anything else) may make room for the blow: its instant and its tokens (scratchpad letr REQUESTS FXI-TOKEN) */
    if (shown.length) try { Hooks.callAll(REACT_HOOK, { phase: "hit", at: T0, ids: shown.map((it) => it.tok.id) }); } catch (err) { once(err); }
    for (const it of shown) play(L, it);
  } catch (err) { once(err); unflight(ready); }
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
function shrink(plan, f) {
  if (!(f > 0) || f >= 0.999) return;
  try { if (plan.wordOpts && Number.isFinite(plan.wordOpts.scale)) plan.wordOpts.scale *= f; } catch { /* keep */ }
  try { if (plan.wordH?.opts && Number.isFinite(plan.wordH.opts.scale)) { plan.wordH.opts.scale *= f; if (Number.isFinite(plan.wordH._s0)) plan.wordH._s0 *= f; } } catch { /* keep */ }
  for (const h of plan.numH ?? []) try { if (h?.opts && Number.isFinite(h.opts.scale)) { h.opts.scale *= f; if (Number.isFinite(h._s0)) h._s0 *= f; } } catch { /* keep */ }
  for (const o of plan.numOpts ?? []) if (Number.isFinite(o.scale)) o.scale *= f;
  plan.cap *= f; plan.numCap *= f;
  if (plan.gArgs) plan.gArgs = { ...plan.gArgs, cap: plan.gArgs.cap * f, numCap: plan.gArgs.numCap * f };
  plan.box = { w: plan.box.w * f, h: plan.box.h * f };
  if (plan.g) plan.g = { w: plan.g.w * f, h: plan.g.h * f, word: { dx: plan.g.word.dx * f, dy: plan.g.word.dy * f }, nums: plan.g.nums.map((q) => ({ dx: q.dx * f, dy: q.dy * f })) };
}
/* one series of blows per token (pure STREAK): a loss within STREAK.ms of the last one is the next step; anything else starts over */
function streakOf(id, kind, seed) {
  const t = Date.now(), s = streaks.get(id);
  if (!P.isLoss(kind)) { streaks.delete(id); return { step: 0, streakSeed: seed }; }
  if (s && t - s.t < P.STREAK.ms) { s.n = Math.min(P.STREAK.max, s.n + 1); s.t = t; return { step: s.n, streakSeed: s.seed }; }
  if (streaks.size > 300) streaks.clear();
  streaks.set(id, { seed, n: 0, t });
  return { step: 0, streakSeed: seed };
}

/* ---------- the view in screen px (client px, as getBoundingClientRect): world <-> screen, the safe rect, other tokens ---------- */
const COVER_SEL = ["#sidebar", "#hotbar", "#players", "#scene-controls", "#controls", "#scene-navigation", "#navigation", "#chat-notifications", "#chat-message",
  "#ui-bottom #chat-form", "#invincible-tactics-dock", "#invincible-combat-bar", ".mm-cin > div"];
/* floating panels that do not hug an edge (cutting the view by them would waste half of it): a side that lands on one costs like a
   token's face, so the word takes another side (seen in the FXLT recording: a fall's "BĘC!" ran under the challenge cards) */
const PANEL_SEL = ["#ich-dock", "#invincible-party", "#invincible-turn-tray", "#chat-notifications",
  /* FXLT2 (ADVT2 6): the map's VRAM meter and pins / filter panel, the party cards, the GM's desk (the splash's own list, splash/stage.mjs) */
  ".mm-vram", "#mm-vram", "#mm-filter", ".mm-filter", "#invincible-party li", "#invincible-tactics-desk:not(.igd-collapsed) .igd"];
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
  panelsCached() { const t = Date.now(); if (!this.pc || t - this.pat > 250) { this.pc = this.panels(); this.pat = t; } return this.pc; },
  panels() {
    const out = [];
    /* FIN-CALLERS (FXIT-S2): the roll splash's moments standing now (its own blocks, asked on REACT_HOOK): a word does not go under them */
    try { const blocks = []; Hooks.callAll(REACT_HOOK, { phase: "place", blocks }); for (const b of blocks) if (b && b.r > b.l && b.b > b.t) out.push({ x: b.l, y: b.t, w: b.r - b.l, h: b.b - b.t, k: P.SLOT_K.panel }); } catch { /* no splash */ }
    for (const sel of PANEL_SEL) for (const el of document.querySelectorAll?.(sel) ?? []) {
      try { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && getComputedStyle?.(el)?.visibility !== "hidden") out.push({ x: r.left, y: r.top, w: r.width, h: r.height, k: P.SLOT_K.panel }); } catch { /* skip */ }
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
  /* PRIV (seen live on lane 5: beside a token the GM had hidden, the GM's word took another side and a smaller fit than the player's): a
     token hidden from the players is not an obstacle on any seat, so the word stands alike on the GM's seat and a player's */
  try { for (const t of canvas.tokens?.placeables ?? []) if (!skip.has(t.id) && t.document?.hidden !== true && seatOf(t).visible) out.push({ ...view.tokRect(t), id: t.id, k: P.SLOT_K.token }); } catch (err) { once(err); }
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
  /* PRIV: a "mark" (a crowd's small word for a reaction whose number not every seat may show) keeps this seat's own number beside it: the
     word is the same on every seat, the number is the seat's (before, a reader's seat had the number alone where another seat had the word) */
  const nums = (isCaptioned(tok.id) ? lk.numbers.filter((n) => n.stat !== "health") : lk.numbers).slice(0, 2);
  const grow = 1 + P.STREAK.grow * Math.min(P.STREAK.max, lk.step ?? 0);      // a blow of a series stands a little bigger each step
  const cap = word ? P.targetPx(lk.kind, lk.amt, lk.word, tokPx, vh(), globalThis.innerWidth || 1600, user * it.scale * grow) : 0;
  const numCap = (word ? cap * P.SIZE_RULE.numK : P.basePx(tokPx, vh()) * P.SIZE_RULE.crowdNumK * 1.1 * user * it.scale);
  const aspect = word ? P.SIZE_RULE.aspect * ([...lk.word].length + 0.5) : 0;      // refined from the drawn word once it is up (follow)
  /* room for the motion: a rise leaves upward, and a power-up's letters may climb like stairs (seen in ADVT c4: "RAAA!" climbed out
     of the view by a whole cap) */
  const rising = ["rise", "grow"].includes(lk.motion.in) || lk.motion.out === "rise";
  /* PRIV: room for the numbers a reader's seat letters (it.room), so the word stands alike on every seat; this seat's own numbers fill it */
  /* (the room stays when the map's director captions this token's damage on this seat: whether it does differs per seat, seen live on lane 5,
     where the player's knock-down word stood bigger and elsewhere than the GM's) */
  const room = word && (it.room?.length ?? 0) > nums.length ? it.room.slice(0, 2) : nums.map((n) => n.text);
  const gArgs = word ? { cap, aspect, nums: room, numCap, side: lk.side, up: (rising ? 0.6 : 0.4) + (lk.mood === "powerup" ? 0.6 : 0), down: lk.motion.in === "drop" ? 0.3 : 0.2 } : null;
  const g = word ? P.group(gArgs)
    : P.group({ cap: numCap, aspect: 0, nums: nums.map((n) => n.text), numCap, side: 0, up: 0.25, down: 0.15 });
  const z0 = view.ok() ? view.zoom() : 1;
  const base = { space: "world", token: tok.document, anchor: "center", reduced: reduced(), ...layer() };
  const wordOpts = word ? { ...base, mood: lk.mood, sound: lk.sound, magnitude: lk.magnitude, seed: it.seed, hold: lk.hold, rotation: lk.rotation, colors: lk.colors, ...lk.motion } : null;
  /* ALIGN (engine 1.9.1 recipe, owner: one accent): the word that gets the moment's impact does not flash on its own; the impact IS its
     accent and lands on its contact. Every seat passes the same (the event decides, not the seat), so the word's contact is one rule */
  if (wordOpts && it.impact) wordOpts.flash = false;
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
function measure(plan, tok = null) {
  if (plan.measured || !plan.gArgs) return;
  const hb = plan.wordH?.plan?._holdBox;
  if (!hb || !(hb.w > 0) || !(hb.h > 0)) return;
  plan.measured = true;
  /* the drawn box over the limits: the word (live, its handle's scale is read every frame) and the numbers not yet started shrink with it */
  const f = P.fitDrawn({ cap: plan.cap, hbW: hb.w, hbH: hb.h, tokenPx: plan.tokPx ?? 100, vh: vh(), vw: globalThis.innerWidth || 1600 });
  if (f < 0.98) shrink(plan, f);      // the numbers already started (they wait for the blow's instant) shrink too
  const regroup = () => { const g = P.group({ ...plan.gArgs, aspect: hb.w, tall: hb.h }); plan.g = g; plan.box = { w: g.w, h: g.h }; };
  regroup();
  /* FXLT2 (ADVT2 6, 10): the side was chosen on the letter-count estimate; with the drawn box known (the first frame) it is chosen again,
     so a wider or taller word than estimated does not land on a neighbour, a panel or another word */
  try {
    /* FXI-TOKEN (ADVI 5): fitted again, smaller when no side is free at this size; a series keeps its side only while it still fits */
    if (plan.blocked && tok && view.ok() && Math.abs(view.zoom() / plan.z0 - 1) < 0.02) {
      const fit = P.fitSlot(view.tokRect(tok), plan.box, view.safe(), plan.blocked, { keep: plan.keep ?? null });
      if (fit.k < 0.999) { shrink(plan, fit.k); regroup(); }
      plan.slot = fit.slot;
    }
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
      const z = view.zoom(), k = Math.min(1, z / plan.z0);
      const h = member < 0 ? plan.wordH : plan.numH?.[member];
      if (h?.opts && Number.isFinite(h._s0)) h.opts.scale = h._s0 * Math.min(1, plan.z0 / z);
      const tr = view.tokRect(tok), box = { w: plan.box.w * k, h: plan.box.h * k };
      let c = P.slotPoint(plan.slot, tr, box);
      const safe = view.safe();
      /* FXLT2 (seen live on lane 5: a word pushed into the view's corner landed on the map's VRAM meter, one beside the challenge cards
         slid under them): inside the safe rect, then out of the floating panels, on the side that moves it least and stays in view */
      if (P.onView(tr, safe)) c = P.clampInto(P.avoidRects(P.clampInto(c, box, safe), box, view.panelsCached(), safe), box, safe);
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
      const age = Date.now() - pe.t0, how = P.overlap(pe.sev, age, pe.span, it.sev);
      if (how === "queue" && !queued) { Promise.race([pe.done, new Promise((r) => setTimeout(r, Math.min(QUEUE_MAX, P.queueWait(age, pe.span))))]).then(() => play(L, it, true)); return; }
      /* the next blow of a series takes the last one's place at once (ADVT2 5: the second blow was drawn over the first one's shards) */
      const quick = (it.lk.step ?? 0) > 0;
      /* FXI-TOKEN: ... when the new word comes up (it starts before the blow's instant by its own entrance), not before: no empty token */
      const gone = () => { for (const h of pe.hs) try { h.stop({ quick }); } catch { /* gone */ } };
      const at = Number.isFinite(it.tHit) ? it.tHit - P.HIT_LEAD * 0.5 - performance.now() : 0;
      if (at > 15) setTimeout(gone, at); else gone();
    }
    /* a reaction that waited (queued) or comes late gets a new instant: never one in the past */
    if (!Number.isFinite(it.tHit) || it.tHit < performance.now() + 30) it.tHit = performance.now() + P.HIT_LEAD;
    const tHit = it.tHit;
    const lk = it.lk, hs = [], red = plan.wordOpts?.reduced ?? reduced();
    const entry = { hs, sev: it.sev, t0: Date.now(), span: lk.hold + 600, loss: !!it.loss, card: it.card ? true : null, nums: [], done: null, addNumber: null, dropNumbers: null, slot: plan.slot, plan };
    plan.numH = [];
    let word = null;
    playing.set(tok.id, entry);
    /* FXI-TOKEN (ADVI 2, 13): the word strikes ON the blow's instant: it is started earlier by its own entrance's contact (pure contactMs; the
       engine plans the word on the call and reads its start time in the next frame, so the start is set from the plan right here) */
    let contact = 0;
    if (plan.wordOpts) {
      word = L.play(lk.word, { ...plan.wordOpts, at: follow(tok, plan, -1), startAt: tHit });
      word._s0 = plan.wordOpts.scale; hs.push(word); plan.wordH = word;
      try {
        if (word.plan?.timeline && word.opts) { contact = P.contactMs(word.plan, red || !!word.reducedMotion); word.opts.startAt = Math.max(performance.now() + 1, tHit - contact); contact = tHit - word.opts.startAt; }
      } catch (err) { once(err); }
    }
    const entMs = (() => { try { return (word?.plan?.timeline?.ent ?? []).reduce((a, p) => a + (p.ticks ?? 0) * (1000 / 24), 0); } catch { return 300; } })();
    const numAt = (i) => follow(tok, plan, Math.min(i, plan.g.nums.length - 1));
    const playNum = (n, o, i, late = false) => {
      if (playing.get(tok.id) !== entry) return;
      if (n.stat === "health" && isCaptioned(tok.id)) return;      // the director's caption says it now (review 7)
      /* beside a word it leaves with the word; alone (a crowd) it stands as long as a word would (seen live: crowd numbers were gone
         in a second) */
      const h = L.play(n.text, { ...o, hold: word ? Math.max(700, lk.hold + entMs - contact - P.NUM_AFTER - 250) : lk.hold + 300, at: numAt(i), ...(late ? {} : { startAt: tHit + (word ? P.NUM_AFTER : 0) }) });
      h.stat = n.stat; h._s0 = o.scale; plan.numH[Math.min(i, plan.g.nums.length - 1)] = h; hs.push(h); entry.nums.push(h); settle();
    };
    /* the numbers come once the word has struck (review 13), on the shared clock: NUM_AFTER the blow's instant */
    plan.nums.forEach((n, i) => playNum(n, plan.numOpts[i], i));
    /* ALIGN: the impact after the word and its numbers, so it can keep them readable (engine 1.9.1 `keep`) and land on the word's contact
       as the engine reads it (`blowAt: L.contactAt(word)`) */
    if (it.impact) { const ih = impactOf(L, it, tok, tHit, red, word, [word, ...entry.nums]); if (ih) hs.push(ih); }
    /* a Damage Taken card arriving late still gives a numberless reaction its told number (review 17) */
    entry.addNumber = (stat, sign, n) => {
      if (entry.nums.length || !plan.g.nums || isCaptioned(tok.id)) return;
      const nl = P.numberLook(stat, sign, n, lk.amt);
      const o = { space: "world", token: tok.document, anchor: "center", reduced: red, ...layer(), mood: nl.mood, sound: nl.sound, hand: nl.hand, colors: nl.colors, magnitude: Math.max(0.3, lk.magnitude * 0.8), seed: `${it.seed}#late`, rotation: -lk.side * 3, in: nl.in, holdKind: "boil", out: nl.out };
      o.scale = scaleFor(L, nl.text, o, plan.numCap || plan.cap * P.SIZE_RULE.numK);
      if (!plan.g.nums.length && plan.gArgs) { plan.gArgs = { ...plan.gArgs, nums: [nl.text] }; plan.measured = false; const g = P.group(plan.gArgs); plan.g = g; plan.box = { w: g.w, h: g.h }; measure(plan); }
      playNum(nl, o, 0, true);
    };
    entry.dropNumbers = (stat) => { for (const h of entry.nums) if (!stat || h.stat === stat) try { h.stop({ quick: false }); } catch { /* gone */ } };
    settle();
    tokenMoves(L, it, tok, word, tHit);
    /* the token's entry goes when every word of this reaction (the numbers too) has ended */
    function settle() {
      const n = hs.length;
      const p = Promise.allSettled(hs.map((h) => h.finished)).then(() => { if (hs.length === n && playing.get(tok.id) === entry) playing.delete(tok.id); });
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
    const { rung, ...imp } = it.impact;
    /* ALIGN (engine 1.9.1 recipe): `blowAt` = the instant the word strikes as the ENGINE reads it (L.contactAt: the word's contact pose,
       on the 24 Hz grid in stepped motion; = tHit by construction in smooth motion), and the engine starts the impact plan.peakMs before it,
       so its strongest drawing lands WITH the word (one accent). The peak comes from the full plan on every seat (a reduced seat's still
       drawing stands at the same instant: contract 1.8.2), so seats keep one instant. Replaces FIN-CALLERS' own measure of the leading
       "lines" (pure leadMs), which missed the other lead-ins the engine counts (REQUESTS FINC-E4). No word on this seat: the shared tHit. */
    let blowAt = Number.isFinite(tHit) ? tHit : performance.now();
    try { const c = word && L.contactAt ? L.contactAt(word) : null; if (Number.isFinite(c)) blowAt = c; } catch (err) { once(err); }
    /* ALIGN: a blow of a series is the engine's series too (pure withSeries: grown inside its rung) */
    const spec = { ...P.withSeries(imp, it.lk?.step ?? 0), subject: tok, seed: `${it.seed}|impact`, blowAt };
    /* ALIGN (engine 1.9.1 `keep`): the word and its numbers are world words IN the scene under the impact's overlay: they stay readable
       through every drawing (a hole cut round them, followed while they move); only handles that are up and alive are passed */
    const kept = keep.filter((h) => h && h.alive !== false && !h.off);
    if (kept.length) spec.keep = kept;
    const src = it.pub?.src ? canvas.tokens?.get(it.pub.src) : null;
    if (src && src.id !== tok.id && seatOf(src).visible) spec.from = src;
    if (red) spec.reduced = true;
    return I.play(spec);
  } catch (err) { once(err); return null; }
}

/* TOKANIM: the token itself moves with its reaction (scripts/tokenanim/): the kind and amount of the shared reaction (PRIV: the same on
   every seat that sees the token), the series' step, on the word's contact instant as the engine reads it (L.contactAt; every seat the same from the same start),
   else the shared blow instant; the attacker only as a token (tokenanim gives a direction only when this seat sees him) */
function tokenMoves(L, it, tok, word, tHit) {
  try {
    let at = Number.isFinite(tHit) ? tHit : performance.now();
    try { const c = word && L?.contactAt ? L.contactAt(word) : null; if (Number.isFinite(c)) at = c; } catch { /* the shared instant */ }
    TokAnim.react(tok, { kind: it.lk.kind, amt: it.lk.amt, step: it.lk.step ?? 0, seed: it.seed, at, from: it.pub?.src ? canvas.tokens?.get(it.pub.src) ?? null : null });
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
  if (!has(KEY.lang)) game.settings.register(MOD, KEY.lang, { name: t("ITR.Settings.Lang.Name"), hint: t("ITR.Settings.Lang.Hint"), scope: "world", config: true, type: String, default: "en",
    choices: { en: t("ITR.Settings.Lang.en"), pl: t("ITR.Settings.Lang.pl") } });
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
  Hooks.on("canvasReady", () => { rememberAll(); pending.clear(); playing.clear(); streaks.clear(); inflight.clear(); });
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
  Hooks.on(SPLASH_HOOK, onSplash);
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
