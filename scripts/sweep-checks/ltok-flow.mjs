// node scripts/sweep-checks/ltok-flow.mjs  (LTOK: token reactions, the Foundry half driven through a fake Foundry: hooks in, engine calls out)
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- a fake Foundry: just what main.mjs reads ---------- */
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
globalThis.document = { querySelector: () => null };
const scene = { id: "S" };
const toks = [];
globalThis.canvas = { ready: true, scene, grid: { size: 100 }, performance: { mode: 2 }, tokens: { placeables: toks, get: (id) => toks.find((t) => t.id === id) } };
function mk(id, type, h, r, o = {}) {
  const actor = { id: `A${id}`, type, hasPlayerOwner: !!o.player, system: { derived: { health: { value: h, max: o.hm ?? 8 }, resolve: { value: r, max: 8 } } },
    testUserPermission: () => !!o.observer, _stats: { modifiedTime: 1 } };
  const tok = { id, scene, isVisible: o.visible !== false, document: { id, hidden: !!o.hidden }, actor, x: 0, y: 0, w: 100, h: 100, destroyed: false };
  actor.getActiveTokens = () => [tok];
  toks.push(tok);
  return tok;
}
const set = (tok, stat, v, options = {}) => { tok.actor.system.derived[stat].value = v; Hooks.callAll("updateActor", tok.actor, { system: { derived: { [stat]: { value: v } } } }, options); };

/* the engine: a recording stand-in with the contract's surface (the real renderer needs a browser; its own checks are LETR's) */
const { sizeFor } = await import("../letters/size.mjs");
const sizeK = (o) => 0.62 + 0.7 * (o?.sound?.loud ?? 0.6);      // the engine's plan.sizeK from the loudness it is handed
const ctxOf = (o) => ({ space: "world", magnitude: o.magnitude, scale: o.scale ?? 1, tokenSpan: 100, grid: 100, zoom: 1, vw: 1600, vh: 900, sizeK: sizeK(o), aspect: 3 });
/* the cap height (screen px) the engine's size model gives a play (contract v4), at zoom 1 on a 1x1 token */
const pxOf = (o) => sizeFor(ctxOf(o)).px;
const fake = { version: "test", limits: { screen: 16, world: 48 }, ready: async () => true, count: () => 0,
  sizeOf: (text, o) => { const r = sizeFor(ctxOf(o)); return { ...r, sizeK: sizeK(o) }; },
  play: (text, o) => ({ id: `h${Math.random()}`, hand: "x", alive: true, ready: Promise.resolve(), finished: new Promise((r) => setTimeout(() => r("done"), (o.hold ?? 800) + 400)), stop() {}, moveTo() {} }) };
/* FXLT2: the words come from the engine's vocabulary (the real one, scripts/letters/words.mjs) */
{ const { createVocab } = await import("../letters/words.mjs"); fake.vocab = createVocab(); fake.word = fake.vocab.word; }
globalThis.MoinenLetters = { copies: [], _engine: fake, async engine() { return this._engine; } };
const M = await import("../tokenreact/main.mjs");
const Owner = await import("../tokenreact/owner.mjs");
const { letters } = await import("../letters/index.mjs");
const L = await letters();
const plays = [];
const real = L.play;
L.play = (text, o) => { plays.push({ text, o }); return real(text, o); };
const hero = mk("H", "superhero", 8, 6, { player: true }), npc = mk("N", "npc", 8, 6), hid = mk("X", "npc", 8, 6, { hidden: true }), boss = mk("B", "npc", 8, 6);
M.start({ init: true, ready: true });
Hooks.callAll("canvasReady");
await sleep(50);
ck("A0 started: the settings are registered and the engine claims the numbers", settings.has("invincible-plus-ultra.tokenReactEnabled") && settings.get("invincible-plus-ultra.tokenReactEnabled").scope === "client" && Owner.isOn());

const take = async (ms = 1700) => { await sleep(ms); const out = plays.splice(0); return out; };
/* GM seat */
set(hero, "health", 7);
let p = await take();
ck("A1 a hand edit on the sheet: a word at the token and the number", p.length === 2 && p[0].o.space === "world" && p[0].o.token === hero.document && typeof p[0].o.at === "function" && p[1].o.space === "world" && p[1].text === "-1");
const firstHitPx = pxOf(p[0].o);
/* A2 changed by FXLT2 (ADVT2 1, 2; owner's rulings: words from the engine's vocabulary, one language for the table): the client is Polish,
   the world's sound language is the default (English), the word is the vocabulary's punch at the reaction's loudness and seed */
ck("A2 the word is the vocabulary's punch in the world's language, not the client's", !!p[0] && p[0].text === fake.vocab.series("punch", 1, { lang: "en", loud: p[0].o.sound.loud, seed: `${p[0].o.seed}|punch` })[0].text && !/[ĄĆĘŁŃÓŚŹŻ]/.test(p[0].text));
set(hero, "health", 3);
p = await take();
ck("A3 four at once: heavy (crash), bigger", p[0]?.o.mood === "crash" && p[1]?.text === "-4");
set(hero, "health", 0);
p = await take();
ck("A4 to zero: down (falls: drops in, falls or droops out; FXLT: a crash, not a sigh)", p[0]?.o.in === "drop" && ["fall", "droop"].includes(p[0]?.o.out) && p[1]?.text === "-3");
set(hero, "health", 8);
p = await take();
ck("A5 up from zero: back (rises)", p[0]?.o.mood === "powerup" && p[1]?.text === "+8");
set(hero, "resolve", 5);
p = await take();
ck("A6 Resolve down: stress in Resolve's colours", p[0]?.o.mood === "pain" && p[1]?.text === "-1" && p[0].o.colors[1] !== "#ffb02e");
Hooks.callAll("createChatMessage", { speakerActor: hero.actor, rolls: [{ pushCount: 1 }], flavor: "" });      // FXLT (review 16): a PUSHED roll; any roll card used to do
set(hero, "resolve", 4);
p = await take();
ck("A7 Resolve down right after the own pushed roll: spent, quiet, no number", p.length === 1 && p[0].o.mood === "tick");
set(hero, "resolve", 6);
await take();

/* the same change twice (updateActor and the token's delta): said once */
set(npc, "health", 6);
Hooks.callAll("updateToken", npc.document, { delta: { system: {} } }, {});
p = await take();
ck("B1 one change heard twice is said once", p.length === 2);

/* hidden token: the GM sees it, a player never */
set(hid, "health", 5);
p = await take();
ck("B2 the GM sees a hidden token's reaction", p.length === 2);
user.isGM = false;
set(hid, "health", 4);
p = await take();
ck("B3 a player: nothing over a hidden token", p.length === 0);
hid.isVisible = false; hid.document.hidden = false;
set(hid, "health", 3);
p = await take();
ck("B4 a player: nothing over a token out of sight", p.length === 0);

/* a word ends when its token is hidden from the player or deleted (the engine follows a token without asking) */
{
  const stops = [];
  const realPlay = L.play;
  L.play = (text, o) => { const h = realPlay(text, o); const s0 = h.stop; h.stop = (x) => { stops.push([o.at?.id ?? o.token?.id, x?.quick]); return s0.call(h, x); }; return h; };
  hid.isVisible = true; hid.document.hidden = false;
  set(hid, "health", 7); await sleep(1000);
  hid.document.hidden = true; Hooks.callAll("updateToken", hid.document, { hidden: true }, {}); await sleep(20);
  ck("B5 hidden while its word stands: the word goes at once", stops.some(([id, q]) => id === "X" && q === true));
  stops.length = 0; hid.document.hidden = false;
  set(hid, "health", 2); await sleep(1000);
  Hooks.callAll("deleteToken", hid.document); await sleep(20);
  ck("B6 deleted while its word stands: the word goes at once", stops.some(([id, q]) => id === "X" && q === true));
  L.play = realPlay; await take(1500); hid.isVisible = false;
}

/* a player and an NPC: no secret numbers */
set(npc, "health", 5);
p = await take();
ck("C1 a player: an NPC's hand-edited hit is a word without a number", p.length === 1 && p[0].o.token === npc.document);
set(npc, "resolve", 4);
p = await take();
ck("C2 a player: an NPC's Resolve is not shown", p.length === 0);
set(npc, "health", 3);
setTimeout(() => Hooks.callAll("createChatMessage", { speakerActor: npc.actor, flavor: "Otrzymane obrażenia", content: "<p><strong>Zbir</strong> otrzymał <strong>2</strong> obrażeń.</p>" }), 150);
p = await take();
ck("C3 a player: the number the Damage Taken card told", p.length === 2 && p[1].text === "-2");
set(npc, "health", 2);
setTimeout(() => Hooks.callAll("createChatMessage", { speakerActor: npc.actor, flavor: "Otrzymane obrażenia", content: "<p><strong>Zbir</strong> otrzymał <strong>1</strong> obrażeń.</p>" }), 100);
setTimeout(() => Hooks.callAll("moinenMapsDirector", "shot", { shot: { kind: "damage", tokens: ["N"] }, form: "take" }), 200);
p = await take();
ck("C3b the map's director shows the number in its caption: the word stays, the number goes", p.length === 1 && !/^[+-]\d/.test(p[0].text));
set(hero, "health", 6);
p = await take();
ck("C4 a player: the own hero's numbers (a reader)", p.length === 2 && p[1].text === "-2");

/* tactical fight: the public event joins the change; options.ipuTactics */
game.combats.set("C", { combatants: new Map([["cN", { token: { object: boss } }]]) });
set(boss, "health", 5, { ipuTactics: true });
Hooks.callAll("invincible-plus-ultra.tactics", { type: "damage", combat: "C", fight: "f", seq: 1, target: "cN", taken: 3, inst: "i1" });
Hooks.callAll("invincible-plus-ultra.tacticsGm", { type: "damage", combat: "C", fight: "f", seq: 1, target: "cN", taken: 3, inst: "i1" });
p = await take();
ck("D1 a player: the fight's public damage gives the number; heard twice, said once", p.length === 2 && p[1].text === "-3" && p[0].o.mood === "crash");
Hooks.callAll("invincible-plus-ultra.tactics", { type: "damage", combat: "C", fight: "f", seq: 2, target: "cN", taken: 2, toStress: true });
p = await take();
ck("D2 a player: stress the fight announced (no track change seen) is shown with its number", p.length === 2 && p[1].text === "-2" && p[0].o.mood === "pain");
set(boss, "health", 0, { ipuTactics: true });
Hooks.callAll("invincible-plus-ultra.tactics", { type: "damage", combat: "C", fight: "f", seq: 3, target: "cN", taken: 5 });
Hooks.callAll("invincible-plus-ultra.tactics", { type: "broken", combat: "C", fight: "f", seq: 4, target: "cN" });
p = await take();
ck("D3 a player: Broken announced: down", p[0]?.o.in === "drop" && p[0]?.o.mood === "crash" && p[1]?.text === "-5");

/* many at once */
user.isGM = true;
const crowd = Array.from({ length: 9 }, (_, i) => mk(`c${i}`, "npc", 6, 6));
Hooks.callAll("canvasReady");
for (const [i, t] of crowd.entries()) { set(t, "health", i === 0 ? 0 : 5); await sleep(40); }      // found live: the updates of an area hit arrive one by one, tens of ms apart
p = await take(2600);
const words = p.filter((x) => x.o.token?.id && !String(x.text).match(/^[+-]\d/));
/* FXI-TOKEN (ADVI 15): three full words in a big crowd (was two) */
ck("E1 nine at once: three full words (the heaviest among them), the rest numbers, nothing doubled", words.length === 3 && p.length === 12 && words.some((x) => x.o.token.id === "c0"));
ck("E2 the crowd is smaller than a single hit", words.filter((x) => x.o.token.id !== "c0").length === 2 && words.filter((x) => x.o.token.id !== "c0").every((x) => pxOf(x.o) < firstHitPx)      /* c0 fell to 0: a fall is bigger than a hit (FXLT review 5), so the crowd's own hit is compared */
  && words.every((x) => !("size" in x.o)));      // contract v4: no fixed size, the engine's model with a smaller scale (FXLT: compared as the drawn size; the scale now carries the severity target)

/* switched off */
values["invincible-plus-ultra.tokenReactEnabled"] = false;
settings.get("invincible-plus-ultra.tokenReactEnabled").onChange(false);
set(hero, "health", 2);
p = await take();
ck("F1 off: nothing plays and the fight's numbers come back", p.length === 0 && !Owner.isOn());

console.log(`sweep ltok-flow: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
