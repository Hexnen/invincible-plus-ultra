/* Tactical combat, the surfaces: FEEDBACK TO THE PLAYER, the Foundry side (ledger rows U53, U56, U57, U58; the words and the sums are
   ui/feedback-pure.mjs). Everything here happens ON THIS CLIENT, from what this client already holds:
     U56  numbers over tokens    the public events of a fight (spec 16: already without anybody concealed; the executor also hears the
                                 full stream) become Foundry's own scrolling text over the token, only for a token this user's canvas shows
     U57  the summary card       summed from the news of this user's own view as it comes; shown by the dock (a card above the bar) when
                                 the round number moves on and when the fight is deleted; goes away by itself
     U58  two sounds             "your turn" and "the table waits for you", files that ship with Foundry itself, played on this client
                                 alone at this client's own volume (the setting tacticsSoundVolume; 0 = off)
     U53  first-fight hints      one line over the bar, each once per user and device (the setting tacticsHintsSeen), gone once the
                                 thing was used or the line was put away; the switch is the setting tacticsHints
   Nothing is written to the fight, nothing is sent to anybody. Everything is in try / catch: feedback must never break the dock. */
import * as Store from "../store.mjs";
import { tacticsApi as Api } from "../api.mjs";
import * as FP from "./feedback-pure.mjs";

const MOD = Store.MOD, LOG = `${MOD} (tactics feedback) |`;
const SUM_KEY = `${MOD}.tactics.sum`, DONE_KEY = `${MOD}.tactics.sumDone`;
const ROUND_MS = 20000, FIGHT_MS = 45000, HOLD_MS = 4000, FLOAT_GAP = 420, CUE_GAP = 1200, HIT_AFTER = 8000;
let H = null;                       // main.mjs: { t, refresh() }
let started = false;
let tally = null, snap = {}, statusesWere = {}, roundWas = null, combatWas = null;
let sum = null, sumTimer = 0;       // the card on screen: { card, until }
let cueWas = null, cueAt = 0;
let hintShown = null;
const heard = new Set(), pending = {}, lossAt = {};      // U56: events already taken; the batch of one combat that waits for its last event

const t = (...a) => H.t(...a);
const setting = (key, fallback) => Store.setting(key, fallback);

/* ---------- U57: the summary ---------- */
function loadTally(combatId) {
  try { const raw = JSON.parse(globalThis.localStorage?.getItem(SUM_KEY) ?? "null"); return raw && raw.combat === combatId && raw.entries && typeof raw.entries === "object" ? { combat: raw.combat, entries: raw.entries } : null; } catch { return null; }
}
/* D131: the fights whose summary this device already showed (feedback-pure.fightOver) */
let doneMem = null;      // read once per page, written through
function loadDone() { if (doneMem) return doneMem; try { doneMem = FP.doneOf(JSON.parse(globalThis.localStorage?.getItem(DONE_KEY) ?? "[]")); } catch { doneMem = []; } return doneMem; }
function saveDone(list) { doneMem = FP.doneOf(list); try { globalThis.localStorage?.setItem(DONE_KEY, JSON.stringify(doneMem)); } catch { /* private window */ } }
function saveTally() { try { if (tally) globalThis.localStorage?.setItem(SUM_KEY, JSON.stringify(tally)); else globalThis.localStorage?.removeItem(SUM_KEY); } catch { /* private window */ } }
function showCard(card, ms) {
  clearTimeout(sumTimer);
  if (!card) { sum = null; return; }
  sum = { card };
  /* it goes away by itself, but never from under the pointer or the keyboard focus of somebody reading it */
  const away = () => { try { if (document.querySelector(".ita-sum:hover, .ita-sum:focus-within")) { sumTimer = setTimeout(away, HOLD_MS); return; } } catch { /* no page */ } sum = null; H.refresh(); };
  sumTimer = setTimeout(away, ms);
}
export function closeSum() { clearTimeout(sumTimer); sum = null; H?.refresh(); }
const who = (id) => snap[id] ?? null;

/* ---------- U58: the two sounds ---------- */
function play(cue) {
  try {
    const volume = Math.max(0, Math.min(1, Number(setting("tacticsSoundVolume", 0.5)) || 0)), now = Date.now();
    if (!cue || !(volume > 0) || now - cueAt < CUE_GAP) return;
    cueAt = now;
    foundry.audio.AudioHelper.play({ src: FP.SOUNDS[cue], volume, autoplay: true, loop: false }, false);      // false: this client only
  } catch (e) { console.warn(LOG, "sound failed", e); }
}

/* ---------- U53: the hints ---------- */
const seenNow = () => { try { const x = JSON.parse(setting("tacticsHintsSeen", "[]")); return Array.isArray(x) ? x.filter((s) => typeof s === "string") : []; } catch { return []; } };
function markSeen(ids) {
  try {
    const cur = seenNow(), next = [...new Set([...cur, ...ids])];
    if (next.length !== cur.length) game.settings.set(MOD, "tacticsHintsSeen", JSON.stringify(next));
    return next;
  } catch { return seenNow(); }
}
let seenLocal = null;               // what this session already marked (the setting is written async)
export function closeHint(id) { seenLocal = [...new Set([...(seenLocal ?? seenNow()), id])]; markSeen([id]); hintShown = null; H?.refresh(); }
/** the switch was turned (main.mjs registers the setting): on again = every hint once more */
export function hintsSwitched(on) { try { if (on) { seenLocal = []; game.settings.set(MOD, "tacticsHintsSeen", "[]"); } H?.refresh(); } catch { /* not started */ } }

/* ---------- U56: numbers over tokens ---------- */
/* U93: what was lost is the mark of the language (the heart of Health, the bolt of stress), drawn by the picture font Foundry already
   loaded: the canvas takes it as a fallback family of the same text. No such font in this browser: null, the words stand. */
const FLOAT_GLYPH = { health: "\uf004", stress: "\uf0e7" };
function floatGlyph(mark) {
  try {
    const fams = [getComputedStyle(document.documentElement).getPropertyValue("--font-awesome").trim().replace(/^["']|["']$/g, ""), "Font Awesome 7 Pro", "Font Awesome 7 Free", "Font Awesome 6 Pro", "Font Awesome 6 Free"].filter(Boolean);
    const font = fams.find((f) => document.fonts.check(`900 16px "${f}"`, FLOAT_GLYPH[mark]));
    return font && FLOAT_GLYPH[mark] ? { ch: FLOAT_GLYPH[mark], font } : null;
  } catch { return null; }
}
const TONE = { health: 0xff8178, resolve: 0x3bb8e8, miss: 0xffffff, none: 0xd5dff0, state: 0xffe72a };
function flush(combatId) {
  try {
    const list = pending[combatId] ?? []; pending[combatId] = null;
    const combat = game.combats?.get(combatId), scene = globalThis.canvas?.scene;
    if (!combat || !scene || !canvas.ready || (combat.scene && combat.scene.id !== scene.id)) return;
    const staff = Store.isStaff(game.user), n = new Map();
    /* the text lives on the map (Foundry draws it at font size x the scene s interface scale x the zoom), so a map seen from far
       away would shrink it to nothing: sized by what the SCREEN shows (about 30 px) */
    const zoom = Math.max(0.05, Math.min(3, Number(canvas.stage?.scale?.x) || 1)), ui = Math.max(0.25, Number(canvas.dimensions?.uiScale) || 1);
    const px = (v) => Math.round(v / (zoom * ui)), far = (v) => Math.round(v / zoom);
    for (const f of FP.floats(list, t)) {
      const doc = combat.combatants.get(f.target)?.token ?? null, tok = doc?.object ?? null;
      /* only over a token this user's canvas draws: a token Foundry hides from a player, or one out of that player's sight, gets no number */
      if (!tok || tok.visible === false || (!staff && doc.hidden === true)) continue;
      const at = Date.now();
      if (f.loss) lossAt[f.target] = at;
      if (f.hit && at - (lossAt[f.target] ?? 0) < HIT_AFTER) continue;      // the number of this blow already stood there
      const k = n.get(f.target) ?? 0; n.set(f.target, k + 1);
      setTimeout(() => {
        try {
          const glyph = f.mark ? floatGlyph(f.mark) : null;      // U93: "-3" and the heart / the bolt; the words when the picture font is not there
          canvas.interface.createScrollingText(tok.center, glyph ? `${f.num} ${glyph.ch}` : f.text, { anchor: CONST.TEXT_ANCHOR_POINTS.CENTER, direction: CONST.TEXT_ANCHOR_POINTS.TOP, distance: Math.max(far(64), (tok.h ?? 100) * 0.9), duration: 2600, jitter: 0.1,
            fontSize: px(30), fontFamily: glyph ? `Titles, Comic, "${glyph.font}", Signika, sans-serif` : "Titles, Comic, Signika, sans-serif", fill: TONE[f.tone] ?? 0xffffff, stroke: 0x0c1a2e, strokeThickness: Math.max(4, px(5)) });
        } catch (e) { console.warn(LOG, "float failed", e); }
      }, k * FLOAT_GAP);
    }
  } catch (e) { console.warn(LOG, "floats failed", e); }
}
function onEvent(ev) {
  try {
    if (!ev || typeof ev !== "object" || !["outcome", "damage", "broken", "crit"].includes(ev.type) || !ev.combat) return;
    const key = FP.eventKey(ev);
    if (heard.has(key)) return;
    if (heard.size > 600) heard.clear();
    heard.add(key);
    if (!pending[ev.combat]) { pending[ev.combat] = []; setTimeout(() => flush(ev.combat), 120); }
    pending[ev.combat].push(ev);
  } catch (e) { console.warn(LOG, "event failed", e); }
}

/* ---------- main.mjs calls ---------- */
/** Once per redraw of the surfaces. ctx = { combat, facts, model, data, cards, staff, own } -> { sum, hint } for the dock */
export function sync(ctx) {
  try {
    if (!started) return { sum: null, hint: null };
    const { combat, facts, model, data, staff, own } = ctx, view = facts.view;
    /* who this user's view holds, kept for the card that is shown when the fight (and the view with it) is gone */
    if (combatWas !== combat.id) {
      combatWas = combat.id; tally = loadTally(combat.id); snap = {}; roundWas = null; cueWas = null;
      if (sum && FP.cardFight(sum.card) !== combat.id) { clearTimeout(sumTimer); sum = null; }      // U130: a new fight: the summary of the one before does not stand over it
    }
    const mine = new Set((model?.bars ?? []).map((b) => b.combatant));
    for (const id of Object.keys(view?.ledger ?? {})) { const c = facts.c?.(id); if (c) snap[id] = { name: c.name, img: c.img ?? null, mine: staff ? !c.npc : mine.has(id) }; }
    statusesWere = view?.statuses ?? {};
    let done = loadDone(); { const live = FP.doneLive(done, combat.id, view); if (live.length !== done.length) { done = live; saveDone(live); } }
    const next = FP.tallyFor(tally, combat.id, view?.news, done);      // D131: a fight already summed up keeps no tally
    if (next !== tally) { tally = next; saveTally(); }
    if (FP.viewOver(view) && endFight(combat)) return { sum: sum?.card ?? null, hint: null };      // D131: the scene ended: the fight's card now, once
    const round = Number.isFinite(view?.round) ? view.round : null;
    if (round !== null && roundWas !== null && round > roundWas && roundWas >= 1 && setting("tacticsSummary", true) !== false) showCard(FP.roundCard(tally, roundWas, who, statusesWere, t), ROUND_MS);
    if (round !== null) roundWas = round;
    /* U58 */
    const now = { turn: staff ? [] : (model?.bars ?? []).filter((b) => b.onTurn).map((b) => b.combatant), asks: [...FP.asksOf(model, game.user.id, staff, ctx.cards), ...(data?.news?.kind === "nudge" ? [`n:${data.news.id}`] : [])] };
    const c = FP.cues(cueWas, now); cueWas = c.next; play(c.cue);
    /* U53 */
    let hint = null;
    if (setting("tacticsHints", true) !== false) {
      let seen = seenLocal ?? seenNow();
      const used = FP.hintsUsed(hintShown, data, own);
      if (used.length) { seenLocal = seen = [...new Set([...seen, ...used])]; markSeen(used); }
      hint = FP.hintOf(data, seen, t);
    }
    hintShown = hint?.id ?? null;
    return { sum: sum?.card ?? null, hint };
  } catch (e) { console.warn(LOG, "sync failed", e); return { sum: null, hint: null }; }
}
/** no fight on this scene: the card of the fight that just ended may still stand */
export function idle() {
  cueWas = null; hintShown = null;
  /* U130: a fight the GM stopped (its tactical state is gone, the combat still stands) is over NOW: its summary is shown now and its
     tally let go, so deleting that combat later (as the GM does before starting the next fight) brings no old card back */
  try { const c = combatWas ? game.combats?.get(combatWas) : null; if (c && tally?.combat === c.id && !Store.stateOf(c)) endFight(c); } catch (e) { console.warn(LOG, "fight stop failed", e); }
  return { sum: sum?.card ?? null, hint: null };
}

function endFight(combat) {
  if (!combat?.id) return false;
  const over = FP.fightOver(tally, combat.id, loadDone());
  if (!over.card) { if (tally?.combat === combat.id) { tally = null; saveTally(); } return false; }
  saveDone(over.done);
  const card = setting("tacticsSummary", true) !== false ? FP.fightCard(tally, who, statusesWere, t) : null;
  tally = null; saveTally(); roundWas = null;
  showCard(card, FIGHT_MS);
  return true;
}
function onDelete(combat) {
  try { if (endFight(combat)) H.refresh(); } catch (e) { console.warn(LOG, "fight end failed", e); }
}

export function start(h) {
  try {
    if (started) return true;
    H = h; started = true;
    Hooks.on(Store.HOOK, onEvent);
    Hooks.on(Store.HOOK_GM, onEvent);
    Hooks.on("deleteCombat", onDelete);
    Api.feedback = { state: () => ({ tally, sum, roundWas, hintShown, cueWas }), play, floats: (combatId, events) => { pending[combatId] = events; flush(combatId); } };      // for a look from the console
    return true;
  } catch (e) { console.warn(LOG, "start failed", e); return false; }
}
