/* Invincible Splash, merged into Invincible - Plus Ultra. Started from scripts/module.js by a guarded dynamic import (start() below).
   Two identifiers on purpose:
   - MOD  = this module's id: settings live here (keys prefixed "splash", e.g. splashEnabled) and so does the module api.
   - FLAG = the OLD standalone module's id, kept ONLY as the flag namespace of message flags (flags['invincible-splash'].ev) and actor flags
            (flags['invincible-splash'].state), so rolls and heroes saved by the standalone module keep working. Do not rename it. */
import { buildEvent, sanitizeState, hashString, mulberry32, hueOf, inkAccent, fmtOdds, oddsText, oddsLabel, LBL, setLabels, ACTIONS, FAIL, SOFTFAIL, PUSHFAIL, PUSHPRE, WRECK, SHAPE_RANGE } from './logic.mjs';
import { readRoll, classify } from './reader.mjs';
import * as S from './splash.mjs';
import * as Stage from './stage.mjs';
import { EN, PL } from './lang.mjs';
import { registerMigrationSettings, migrateSettings } from './migrate.mjs';

const MOD = 'invincible-plus-ultra';
const FLAG = 'invincible-splash';
const STANDALONE = 'invincible-splash';
const SYSTEM = 'invincible';
const LOG = `${MOD} (splash) |`;
const shown = new Set();           // id wiadomości, dla których splash już poszedł (ten klient)
const stressShown = new Set();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const remember = (set, id) => { set.add(id); if (set.size > 500) set.delete(set.values().next().value); };
const WORDS = new Set([...Object.values(ACTIONS).flat(), ...FAIL, ...SOFTFAIL, ...PUSHFAIL, ...PUSHPRE, ...WRECK]);
const TAGS = new Set(['FIRST SUCCESS!', 'PUSH PAYS OFF!', 'FIRST DOUBLE!', 'NEW PERSONAL BEST!']);
const NARR = new Set(['k0', 'dry', 'push', 'fail']);

/* hooki są rejestrowane dopiero w start() (po sprawdzeniu, że samodzielny moduł nie działa) */
const HOOKS = [];
const hook = (name, fn) => HOOKS.push([name, fn]);
function registerHooks() { for (const [name, fn] of HOOKS) Hooks.on(name, fn); }

/* ustawienia: klucz roboczy ('enabled') -> klucz w module ('splashEnabled') */
const sk = key => 'splash' + key.charAt(0).toUpperCase() + key.slice(1);
const cs = key => game.settings.get(MOD, sk(key));
/* tryb diagnostyczny (ustawienie klienta "debug"): wypisuje w konsoli przebieg i powód pominięcia splasha */
const dbg = (...a) => { try { if (game.settings.get(MOD, sk('debug'))) console.log(LOG, ...a); } catch (e) { /* ustawienia niegotowe */ } };

/* ------------------------------------------------------------------ teksty (INSPLASH.*) */
/* Lista języków z module.json jest czytana tylko przy starcie serwera, więc teksty są w lang.mjs i trafiają do
   game.i18n.translations w czasie działania: najpierw EN (komplet kluczy), na wierzch aktywny język. Idempotentne. */
function mergeLang() {
  try {
    if (!game.i18n?.translations) return;
    const flat = { ...EN, ...(game.i18n.lang === 'pl' ? PL : {}) };
    foundry.utils.mergeObject(game.i18n.translations, foundry.utils.expandObject(flat), { inplace: true, insertKeys: true, overwrite: true });
  } catch (e) { console.warn(LOG, 'cannot merge strings', e); }
}

/* ------------------------------------------------------------------ ustawienia */
function registerSettings() {
  if (game.system.id !== SYSTEM) return;
  const reg = scope => (key, data) => {
    if (game.settings.settings.has(`${MOD}.${sk(key)}`)) return;
    game.settings.register(MOD, sk(key), { scope, config: true, ...data });
  };
  const client = reg('client'), world = reg('world');
  const L = k => `INSPLASH.Settings.${k}`;

  client('enabled', { name: L('Enabled.Name'), hint: L('Enabled.Hint'), type: Boolean, default: true });
  client('others', { name: L('Others.Name'), hint: L('Others.Hint'), type: Boolean, default: true });
  client('placement', { name: L('Placement.Name'), hint: L('Placement.Hint'), type: String, default: 'token',
    choices: { token: L('Placement.token'), screen: L('Placement.screen') } });
  client('scale', { name: L('Scale.Name'), hint: L('Scale.Hint'), type: Number, default: 1, range: { min: 0.5, max: 1.6, step: 0.1 } });
  client('hold', { name: L('Hold.Name'), hint: L('Hold.Hint'), type: Number, default: 1, range: { min: 0.5, max: 2, step: 0.1 } });
  client('effects', { name: L('Effects.Name'), hint: L('Effects.Hint'), type: String, default: 'full',
    choices: { full: L('Effects.full'), reduced: L('Effects.reduced'), off: L('Effects.off') } });
  client('motion', { name: L('Motion.Name'), hint: L('Motion.Hint'), type: String, default: 'auto', onChange: () => applyMotion(),
    choices: { auto: L('Motion.auto'), full: L('Motion.full'), reduced: L('Motion.reduced') } });
  client('fullscreen', { name: L('Fullscreen.Name'), hint: L('Fullscreen.Hint'), type: Boolean, default: true });
  client('fullFrom', { name: L('FullFrom.Name'), hint: L('FullFrom.Hint'), type: Number, default: 0.7, range: { min: 0.4, max: 1, step: 0.05 } });
  client('debug', { name: L('Debug.Name'), hint: L('Debug.Hint'), type: Boolean, default: false });
  client('chat', { name: L('Chat.Name'), hint: L('Chat.Hint'), type: Boolean, default: true });

  world('dry', { name: L('Dry.Name'), hint: L('Dry.Hint'), type: Number, default: 8, range: { min: 0, max: 30, step: 1 } });
  world('k0', { name: L('K0.Name'), hint: L('K0.Hint'), type: Number, default: 0, range: { min: -2, max: 2, step: 1 } });
  world('state', { name: L('State.Name'), hint: L('State.Hint'), type: Boolean, default: true });
  registerMigrationSettings(MOD);
}

/* Etykiety informacyjne plakietek (szansa, stres, Resolve) z INSPLASH.Badge.*; brak klucza = angielski domyślnik z logic.mjs.
   Słowa-SFX (HAYMAKER!, UNLIKELY HERO!, SHAKEN...) i napis SIXES zostają angielskie (decyzja projektu). */
function applyLabels() {
  try {
    const has = k => game.i18n.has(k), F = (k, d) => game.i18n.format(k, d), o = {};
    if (has('INSPLASH.Badge.OneIn')) o.oneIn = n => F('INSPLASH.Badge.OneIn', { n });
    if (has('INSPLASH.Badge.Miss')) o.miss = n => F('INSPLASH.Badge.Miss', { n });
    if (has('INSPLASH.Badge.Push')) o.push = game.i18n.localize('INSPLASH.Badge.Push');
    if (has('INSPLASH.Badge.Stress')) o.stress = n => F('INSPLASH.Badge.Stress', { n });
    if (has('INSPLASH.Badge.Resolve')) o.resolve = (now, max) => F('INSPLASH.Badge.Resolve', { now, max });
    setLabels(o);
  } catch (e) { /* zostają domyślne angielskie etykiety */ }
}

function onReady() {
  if (game.system.id !== SYSTEM) return;
  mergeLang();
  document.fonts?.load?.('100px Comic').catch(() => {});
  applyLabels();
  applyMotion();
  const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  mq?.addEventListener?.('change', applyMotion);
  /* obszar roboczy (okno bez czatu) zmienia się z oknem i paskiem bocznym; pasek animuje szerokość, więc mierzymy dwa razy */
  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => Stage.refreshArea(), 120); });
  Hooks.on('collapseSidebar', () => { setTimeout(() => Stage.refreshArea(), 60); setTimeout(() => Stage.refreshArea(), 500); });
  const api = { preview, resetState, clear: Stage.clearAll };
  const mod = game.modules.get(MOD);
  if (mod) mod.api = { ...(mod.api ?? {}), splash: api };   // dopisek do api modułu (module.js też składa je przez rozwinięcie, więc żadna kolejność nie gubi splash)
  globalThis.invincibleSplash = api;
  console.log(`${LOG} ready`);
}

/* ------------------------------------------------------------------ start (wywoływany z module.js)
   phases = { i18nInit, init, setup, ready }: które fazy startu Foundry już minęły, gdy dynamiczny import się skończył (module.js
   zapisuje je od pierwszej linii). Faza, która już minęła, jest wykonywana od razu; pozostałe czekają na swój hook. */
let started = false;
export function start(phases = {}) {
  if (started) return;
  started = true;
  const run = (name, fn) => { if (phases[name]) fn(); else Hooks.once(name, fn); };
  run('init', () => {
    if (game.system.id !== SYSTEM) return;
    if (game.modules.get(STANDALONE)?.active) {
      console.info(`${LOG} the standalone "${STANDALONE}" module is active, so the splash built into Plus Ultra stays disabled to avoid duplicate splashes. Disable the standalone module to use this one.`);
      return;
    }
    Hooks.on('i18nInit', mergeLang);   // tłumaczenia budowane od nowa: scal ponownie
    mergeLang();
    registerSettings();
    registerHooks();
    run('setup', wrapRollDialog);
    /* one-time copy of the standalone module's settings; client values land synchronously, before onReady reads them */
    run('ready', () => {
      /* old Sheet Plus values first (they win), then the standalone module's; onReady does not wait for either */
      import('../migrate-id.mjs').then(m => m.migrateFromSheetPlus()).catch(() => {}).then(() => migrateSettings(MOD, sk, LOG)).catch(() => {});
      onReady();
    });
  });
}

function applyMotion() {
  const m = cs('motion');
  S.setReduced(m === 'reduced' || (m === 'auto' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
}
function fullFrom() { return cs('fullscreen') ? cs('fullFrom') : null; }
function fxLevel() { const e = cs('effects'); return e === 'full' ? 1 : (e === 'reduced' ? 0.5 : 0); }

/* ------------------------------------------------------------------ znacznik akcji z dialogu rzutu */
async function wrapRollDialog() {
  try {
    const mod = await import(foundry.utils.getRoute('systems/invincible/system/applications/dialog/roll-dialog.mjs'));
    const D = mod.default;
    const orig = D?.prototype?._roll;
    if (!orig || orig.__insplash) return;
    D.prototype._roll = function (...args) {
      try {
        const attackType = this.attackInfo ? (this.attackInfo.attackType ?? (this.attribute === 'agility' ? 'shooting' : 'slugfest')) : undefined;
        const c = classify({ attackType, flavor: this.rollName, names: Object.keys(this.breakdown ?? {}), attribute: this.attribute ?? null });
        this.rollOptions ??= {};
        this.rollOptions.splash = c;
      } catch (e) { console.warn(`${LOG} classify failed`, e); }
      return orig.apply(this, args);
    };
    D.prototype._roll.__insplash = true;
  } catch (e) {
    console.warn(`${LOG} cannot wrap roll dialog, falling back to flavor matching`, e);
  }
}

/* ------------------------------------------------------------------ decyzja (klient autora rzutu) */
hook('preCreateChatMessage', (message) => {
  try {
    if (game.system.id !== SYSTEM) return;
    const rd = readRoll(message);
    if (!rd) return;
    const actor = message.speakerActor ?? null;
    let st = null;
    const track = cs('state') && actor && actor.type === 'superhero' && actor.isOwner;
    if (track) st = sanitizeState(actor.flags?.[FLAG]?.state);
    const res = actor?.type === 'superhero' ? actor.system?.derived?.resolve : null;   // Resolve przeciwników nie trafia do publicznej flagi
    const ev = buildEvent(rd, { rng: Math.random, st, dryN: cs('dry'), k0Offset: cs('k0') });
    ev.rb = res?.value ?? null;           // Resolve w chwili rzutu (do odczytania, czy stres już odjęty)
    ev.rmax = res?.max ?? null;
    message.updateSource({ flags: { [FLAG]: { ev } } });
    if (track) actor.update({ [`flags.${FLAG}.state`]: st }).catch(e => console.warn(`${LOG} state save failed`, e));
  } catch (e) { console.warn(`${LOG} preCreate failed`, e); }
});

/* Zdarzenie: wszystkie liczby (moc, rzadkość, stres) zawsze z danych rzutu; z flagi autora bierzemy tylko
   zwalidowane elementy kosmetyczne i decyzję narratora. Flaga od złośliwego klienta nie może niczego rozdmuchać. */
function eventFor(message, rd) {
  const rng = mulberry32(hashString(message.id ?? 'x'));
  const ev = buildEvent(rd, { rng, st: null, dryN: 0, k0Offset: cs('k0') });
  const f = message.flags?.[FLAG]?.ev;
  if (f && typeof f === 'object' && f.v === 1) {
    if (WORDS.has(f.word)) ev.word = f.word;
    if (ev.prefix && WORDS.has(f.prefix)) ev.prefix = f.prefix;
    if (ev.wreckWord && WORDS.has(f.wreckWord)) ev.wreckWord = f.wreckWord;
    if (!ev.fail && typeof f.shape === 'string' && Object.hasOwn(SHAPE_RANGE, f.shape)) ev.shape = f.shape;
    ev.tag = TAGS.has(f.tag) ? f.tag : null;
    ev.narr = NARR.has(f.narr) ? f.narr : null;
    ev.rb = Number.isFinite(f.rb) ? f.rb : null;
    ev.rmax = Number.isFinite(f.rmax) ? f.rmax : null;
    ev.hadFlag = true;
  }
  return ev;
}

/* ------------------------------------------------------------------ pokaz */
function resolveToken(message) {
  if (cs('placement') !== 'token') return null;
  try {
    if (!canvas?.ready) return null;
    const sp = message.speaker ?? {};
    if (sp.scene && sp.scene !== canvas.scene?.id) return null;
    const tok = (sp.token && canvas.tokens.get(sp.token)) || message.speakerActor?.getActiveTokens?.()[0];
    /* bez Token#isVisible: getter zeruje detectionFilter, a my wołamy go poza cyklem odświeżania */
    if (!tok || !tok.visible || (tok.document.hidden && !game.user.isGM)) return null;
    const g = canvas.stage.toGlobal(tok.center);
    const r = canvas.app.screen;
    if (g.x < 0 || g.y < 0 || g.x > r.width || g.y > r.height) return null;
    /* token ukryty pod otwartym czatem: scena na ekranie (obszar roboczy), nie pod paskiem bocznym */
    const left = canvas.app.view.getBoundingClientRect().left;
    if (left + g.x > Stage.measureArea().w - 24) return null;
    return tok;
  } catch (e) { return null; }
}

function resolveReader(message, ev) {
  const actor = message.speakerActor;
  if (!actor || actor.type !== 'superhero') return null;   // pojemność Resolve przeciwników nie jest ujawniana
  return () => {
    const res = actor.system?.derived?.resolve;
    if (!res) return null;
    let now = res.value;
    /* jeśli system jeszcze nie odjął kosztu tego rzutu (wartość taka jak w chwili rzutu), odejmij go wirtualnie */
    if (!ev.pushed && ev.rb != null && now === ev.rb) now = Math.max(0, now - ev.stress);
    return { now, max: res.max ?? ev.rmax ?? Math.max(now, 1) };
  };
}

async function waitDice(message) {
  await sleep(0);   // DSN ustawia flagę animacji we własnym hooku createChatMessage
  const wait = game.dice3d?.waitFor3DAnimationByMessageID?.(message.id);
  if (wait) await Promise.race([wait, sleep(12000)]);
}

function visibleToMe(message) { return message.isContentVisible !== false; }

/* Komunikat dla czytnika ekranu (aria-live): kto, słowo, liczba szóstek, rzadkość, stres. Liczby z danych rzutu (ev).
   Słowa SFX zostają angielskie (decyzja projektu); reszta zdania jest tłumaczona i odmieniona (pl: 1/2-4/5+). */
const cap = t => { const x = String(t ?? '').toLowerCase(); return x.charAt(0).toUpperCase() + x.slice(1); };
function sixesText(n) {
  const cat = new Intl.PluralRules(game.i18n.lang || 'en').select(n);
  let key = `INSPLASH.Live.Six.${cat}`;
  if (!game.i18n.has(key)) key = 'INSPLASH.Live.Six.other';
  return game.i18n.format(key, { n });
}
function announce(ev, message, resolve) {
  try {
    const L = k => game.i18n.localize(k), F = (k, d) => game.i18n.format(k, d);
    const name = message?.speaker?.alias || message?.speakerActor?.name || '';
    const parts = [];
    if (name) parts.push(name + ':');
    if (!ev.stressOnly) {   // stressOnly: ogłoszenie samego stresu po Accept
      if (ev.pushed) parts.push(L('INSPLASH.Live.Pushed') + '.');
      parts.push(cap(ev.word));
      if (ev.fail) parts.push(L('INSPLASH.Live.NoSixes') + '.');
      else {
        parts.push(sixesText(ev.sixes) + '.');
        const label = ev.tag || oddsText(ev.power);
        if (label) parts.push(cap(label));
        if (ev.p) parts.push(F('INSPLASH.Live.Odds', { n: fmtOdds(Math.round(1 / ev.p)) }) + '.');
      }
    }
    if (ev.stress && !ev.stressPending) {
      parts.push(F('INSPLASH.Live.Stress', { n: ev.stress }) + '.');
      const r = resolve?.();
      if (r) parts.push(F('INSPLASH.Live.Resolve', { now: r.now, max: r.max }) + '.');
    }
    Stage.announce(parts.join(' '));
  } catch (e) { /* dostępność nie może przerwać splasha */ }
}

hook('createChatMessage', async (message, options, userId) => {
  try {
    if (game.system.id !== SYSTEM) return;
    if (!cs('enabled')) return dbg('skip: wyłączone w ustawieniach klienta');
    const rd0 = readRoll(message);
    if (!rd0) return;   // nie rzut Year Zero
    dbg('rzut', message.id, 'n=' + rd0.n, 'sixes=' + rd0.sixes, 'pushable=' + rd0.pushable, 'flaga ev:', !!message.flags?.[FLAG]?.ev);
    if (!visibleToMe(message)) return dbg('skip: treść niewidoczna dla tego użytkownika (blind/whisper)');
    if (userId !== game.user.id && !cs('others')) return dbg('skip: cudzy rzut, a "others" wyłączone');
    /* bez filtra wieku: createChatMessage odpala tylko dla nowych wiadomości (historia po odświeżeniu go nie wywołuje) */
    const rd = readRoll(message);
    if (!rd) return;
    const sceneId = message.speaker?.scene;
    if (sceneId && canvas?.scene && sceneId !== canvas.scene.id) return dbg('skip: rzut z innej sceny', sceneId, '!=', canvas.scene.id);
    const id = message.id;
    if (shown.has(id)) return dbg('skip: już pokazany');
    remember(shown, id);

    const tw = performance.now();
    await waitDice(message);
    dbg('po czekaniu na DSN:', Math.round(performance.now() - tw) + ' ms', 'dice3d:', !!game.dice3d);
    if (!game.messages.has(id)) return dbg('skip: wiadomość usunięta w trakcie czekania');
    if (!visibleToMe(message)) return dbg('skip: wiadomość stała się niewidoczna');
    if (document.visibilityState === 'hidden') return dbg('skip: karta przeglądarki ukryta');

    const ev = eventFor(message, readRoll(message) ?? rd);
    await sleep(ev.stress && !ev.pushed ? 350 : 0);   // dajmy systemowi odjąć Resolve przed odczytem
    const token = resolveToken(message);
    dbg('odtwarzam:', ev.word, 'P=' + (ev.power ?? 'fail'), 'miejsce:', token ? 'token ' + token.name : 'ekran');
    const resolve = ev.stress ? resolveReader(message, ev) : null;
    announce(ev, message, resolve);
    Stage.play(ev, {
      rnd: mulberry32(hashString(id)), token, scale: cs('scale'), hold: cs('hold'), fx: fxLevel(), fullFrom: fullFrom(),
      resolve
    });
  } catch (e) { console.warn(`${LOG} createChatMessage failed`, e); }
});

/* Accept na pushowalnym rzucie: stres staje się znany dopiero teraz */
hook('updateChatMessage', async (message, changes, options, userId) => {
  try {
    if (game.system.id !== SYSTEM || !cs('enabled') || !changes.rolls) return;
    if (userId !== game.user.id && !cs('others')) return;
    /* tylko rzuty, które ten klient widział na żywo (spóźniony gracz nie odtwarza starego stresu przy kolejnym update) */
    if (!visibleToMe(message) || !shown.has(message.id) || stressShown.has(message.id) || document.visibilityState === 'hidden') return;
    const rd = readRoll(message);
    const f = message.flags?.[FLAG]?.ev;
    if (!rd || rd.pushable || !rd.stress || !f?.stressPending) return;
    remember(stressShown, message.id);
    /* z flagi tylko zwalidowane liczby (rb/rmax); stres z danych rzutu. Flaga od obcego klienta nie trafia dalej w całości. */
    const ev = { stress: rd.stress, stressPending: false, pushed: true, rb: Number.isFinite(f.rb) ? f.rb : null, rmax: Number.isFinite(f.rmax) ? f.rmax : null };
    const resolve = resolveReader(message, ev);
    announce({ ...ev, stressOnly: true }, message, resolve);
    Stage.playStress(ev, { token: resolveToken(message), scale: cs('scale'), hold: cs('hold'), resolve });
  } catch (e) { console.warn(`${LOG} updateChatMessage failed`, e); }
});

hook('canvasPan', () => Stage.onCanvasPan());
hook('canvasTearDown', () => Stage.clearAll());

/* ------------------------------------------------------------------ znacznik na karcie czatu */
hook('renderChatMessageHTML', (message, html) => {
  try {
    if (game.system.id !== SYSTEM || !cs('chat')) return;
    if (!visibleToMe(message) || html.querySelector('.ins-chat')) return;
    const rd = readRoll(message);
    if (!rd) return;
    const ev = eventFor(message, rd);
    let word, odds, tag = ev.tag, P;
    if (ev.fail) {
      if (ev.softFail || ev.pushed || ev.failP == null || ev.failP > 0.2) return;
      word = 'WHAT A FLOP!'; odds = LBL.miss(fmtOdds(Math.round(1 / ev.failP))); P = 0;
    } else {
      P = ev.power;
      const label = oddsText(P);
      if (!label && !tag) return;
      word = tag || label; odds = oddsLabel(ev.p) + (ev.pushed ? ' · ' + LBL.push : '');
    }
    const el = document.createElement('div');
    el.className = 'ins-chat' + (ev.fail ? ' dim' : '');
    el.style.setProperty('--ins-c', ev.fail ? '#b4b2c2' : inkAccent(hueOf(P)));   // czarny napis na tle: kontrast >= 4.6:1
    const w = document.createElement('span'); w.className = 'w'; w.textContent = word;
    const o = document.createElement('span'); o.className = 'o'; o.textContent = odds;
    el.append(w, o);
    const host = html.querySelector('.message-content') ?? html;
    host.prepend(el);
  } catch (e) { /* nie psujemy renderu czatu */ }
});

/* ------------------------------------------------------------------ API: podgląd bez rzutu */
/* game.modules.get('invincible-plus-ultra').api.splash.preview({ n:4, sixes:3, action:'slugfest', pushed:false, stress:0 }) */
function preview(opts = {}) {
  const rd = {
    n: opts.n ?? 4, sixes: opts.sixes ?? 2, newSixes: opts.pushed ? (opts.newSixes ?? opts.sixes ?? 1) : 0,
    rerolled: opts.pushed ? (opts.rerolled ?? Math.max(1, (opts.n ?? 4) - 1)) : 0,
    pushed: !!opts.pushed, stress: opts.stress ?? 0, stressPending: false,
    action: opts.action ?? 'slugfest', attribute: opts.attribute ?? null, wreck: !!opts.wreck, npc: !!opts.npc
  };
  const ev = buildEvent(rd, { rng: Math.random, st: null, dryN: 0, k0Offset: cs('k0') });
  const token = opts.token === false ? null : (canvas?.tokens?.controlled?.[0] ?? null);
  const resolve = ev.stress ? () => ({ now: opts.resolveNow ?? 6, max: opts.resolveMax ?? 8 }) : null;
  announce(ev, null, resolve);
  return Stage.play(ev, {
    rnd: Math.random, token: opts.screen ? null : token, scale: cs('scale'), hold: cs('hold'), fx: fxLevel(), fullFrom: opts.fullFrom ?? fullFrom(),
    resolve
  });
}

async function resetState(actor) {
  actor ??= canvas?.tokens?.controlled?.[0]?.actor;
  if (!actor) return ui.notifications.warn('Select a token or pass an actor.');
  await actor.update({ [`flags.${FLAG}.-=state`]: null });
  ui.notifications.info(`${LOG} state reset for ${actor.name}`);
}
