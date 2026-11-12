/* node scripts/tactics/check-fxl.mjs -- fixer L after Adversary 10 (live, 2026-11-12): D122 (a LATE roll request thrown two or three
   times by the player after the watch's re-asks), D123 (the raw kind word "fixed" in the news line), U136 (the dock under a popped-out
   chat), and the proof that the merged H3-1 fight tag covers the adversary's exact cases of D121 (older chat messages with the same
   request id from earlier fights) and U137 (an old card's Push / Accept read against the fight on the table).
   Rows: dev/combat-defects.md "Adversary 10 (live)", dev/combat-usability.md U136, U137. */
import { readFileSync } from "node:fs";
import { Table, ok, eq, done } from "./testkit.mjs";
import * as RW from "./rollwatch-pure.mjs";
import * as MP from "./ui/model-pure.mjs";
import * as Lay from "./ui/layout-pure.mjs";
import { tIn } from "./lang.mjs";

const src = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

/* ---- D122 (pure): is the answer to a request in this client's chat already? */
{
  const tagOf = (m) => m?.tag ?? null, req = { combat: "c1", rid: "r44_f1" };
  const msg = (author, tag) => ({ author: { id: author }, tag });
  eq(RW.answered([], req, ["p2"], tagOf), false, "D122: an empty chat: not answered (a copy of a LOST request is still thrown)");
  eq(RW.answered([msg("p2", { combat: "c1", rid: "r44_f1" })], req, ["p2"], tagOf), true, "D122: the asked user's card with that request id is there: answered");
  eq(RW.answered([msg("p3", { combat: "c1", rid: "r44_f1" })], req, ["p2"], tagOf), false, "D122: a card of somebody not asked does not count");
  eq(RW.answered([msg("p2", { combat: "c9", rid: "r44_f1" })], req, ["p2"], tagOf), false, "D122: a card of another combat with the same id does not count");
  eq(RW.answered([msg("p2", { rid: "r44_f1" })], req, ["p2"], tagOf), true, "D122: a card whose tag names no combat counts by its request id");
  eq(RW.answered([msg("p2", { combat: "c1", rid: "r44" })], req, ["p2"], tagOf), false, "D122: the bare id of an earlier fight is another request");
  eq(RW.answered([msg("p2", { combat: "c1", rid: "r44_f1" })], { combat: "c1" }, ["p2"], tagOf), false, "D122: a request with no id is never answered");
}

/* ---- U137 (pure): the fight a roll card is read against */
{
  const live = { id: "cNow" }, get = (id) => (id === "cNow" ? live : null);
  eq([RW.cardCombat({ combat: "cNow" }, get, live), RW.cardCombat({ combat: "T7ClC4" }, get, live), RW.cardCombat({}, get, live)], [live, null, live], "U137: a card of a deleted combat is read against no fight (not the one on the table); a card with no combat in its tag reads the table's");
  /* the adversary's exact card: inst a34, key attack, rid r37, of a deleted combat; the fight on the table started BEFORE the fight tag
     (bare ids) owes its own a34 / attack / r37: before this fix the old card's buttons read "open" */
  const view = { stack: [{ id: "a34", rolls: { attack: { req: { rid: "r37" } } } }] }, tag = { inst: "a34", key: "attack", rid: "r37", combat: "T7ClC4" };
  eq(RW.cardState(view, tag, "mOld"), "open", "U137 (premise): read against the table's untagged fight, the old card looks live");
  const c = RW.cardCombat(tag, get, live);
  eq(RW.cardState(c ? view : null, tag, "mOld"), "settled", "U137: read against its own (gone) fight, it is settled");
  /* with the fight tag (every fight started since H3-1) the ids differ anyway */
  const tagged = { stack: [{ id: "a34_k3x9q2", rolls: { attack: { req: { rid: "r37_k3x9q2" } } } }] };
  eq(RW.cardState(tagged, { inst: "a34", key: "attack", rid: "r37" }, "mOld"), "settled", "U137 (H3-1): an old untagged card is settled against a tagged fight");
  ok(/RW\.cardCombat\(tag, /.test(src("./ui/main.mjs")) && !/\?\? Store\.currentCombat\(\);\s*\n\s*const off = RW\.cardState/.test(src("./ui/main.mjs")), "U137: chatButtons reads the card's fight through cardCombat (no fallback to the table's fight)");
}

/* ---- D123: the engine's own damage is named, never "fixed" */
{
  const T = new Table(); T.hero("H1", "p1").npc("N1"); T.order(["H1", "N1"]);
  const facts = { c: (id) => T.c[id] ?? null, staff: false };
  const text = (l) => MP.newsData({ news: T.state.news, round: T.state.round }, {}, facts, (k, p = {}, f) => tIn(l, k, p, f))?.text ?? "";
  eq((await T.gm({ op: "hazard", hazard: { kind: "fixed", amount: 1 }, targets: ["H1"] }))?.ok, true, "D123: a GM's fixed damage (the shape of a poison trigger)");
  eq([text("en"), text("pl")], ["Damage: done", "Obrażenia: wykonano"], "D123: the news line names it Damage / Obrażenia (was \"fixed: ...\")");
  const names = { barrier: ["Barrier", "Bariera"], fall: ["Fall", "Upadek"], vehicle: ["Vehicle", "Pojazd"], chase: ["Chase", "Pościg"] };
  for (const [id, [en, pl]] of Object.entries(names)) {
    await T.gm({ op: "hazard", hazard: { kind: "fixed", amount: 1, id }, targets: ["H1"] });
    eq([T.state.news.at(-1)?.hzCause, text("en"), text("pl")], [id, `${en}: done`, `${pl}: wykonano`], `D123: the engine's ${id} damage is named by what dealt it`);
  }
  for (const l of ["en", "pl"]) ok(!/fixed/i.test(MP.newsData({ news: [{ id: "n1", round: 1, kind: "action", actor: null, action: "hazard", hazard: "weird", result: "done", rows: [] }], round: 1 }, {}, facts, (k, p = {}, f) => tIn(l, k, p, f))?.text ?? ""), `D123: an unknown kind word is never shown raw (${l})`);
  /* every engine child of kind "fixed" carries an id the news names */
  const ids = new Set();
  for (const f of ["move", "chase", "vehicle"]) for (const m of src(`./flows/${f}.mjs`).matchAll(/kind: "fixed"[^}]*id: "(\w+)"/g)) ids.add(m[1]);
  eq([...ids].sort(), ["barrier", "chase", "fall", "vehicle"], "D123: the engine's own fixed damage comes from barrier, fall, vehicle and chase, all named");
}

/* ---- U136: the dock beside a popped-out chat (1366x768, interface 140 %: the free stretch 306..1074 widened to 1388 by the popout; the
   popout at x 534-832, as tall as the window) */
{
  eq(Lay.besideFloating(306, 1306, { left: 534, right: 832 }), { lo: 842, hi: 1306 }, "U136: the dock keeps to the wider side of the popped-out chat (right)");
  eq(Lay.besideFloating(100, 1306, { left: 834, right: 1132 }), { lo: 100, hi: 824 }, "U136: ... or the left, when that is wider");
  eq(Lay.besideFloating(306, 1074, { left: 1100, right: 1300 }), { lo: 306, hi: 1074 }, "U136: a popout outside the stretch changes nothing");
  eq(Lay.besideFloating(300, 900, { left: 450, right: 750 }), { lo: 300, hi: 900 }, "U136: neither side has room for a dock: it stays (under it) rather than shrinking to nothing");
  const dock = src("./ui/dock.mjs");
  ok(/const FLOATING = "#chat-popout"/.test(dock) && /rec\.q\(FLOATING\)[^\n]*Lay\.besideFloating/.test(dock), "U136: the dock's placement keeps clear of Foundry's chat popout (#chat-popout)");
  ok(/"renderChatLog", "closeChatLog"/.test(src("./ui/main.mjs")), "U136: the dock is placed again when the chat pops out or back in");
}

/* ---- the Foundry half: the real main.mjs / engine.mjs / relay.mjs against the fake Foundry of check-hunt3.mjs */
const MOD = "invincible-plus-ultra";
const setPath = (o, path, v) => { const ks = path.split("."); let cur = o; for (const k of ks.slice(0, -1)) cur = cur[k] ??= {}; const last = ks.at(-1); if (last.startsWith("-=")) delete cur[last.slice(2)]; else cur[last] = v; };
const getPath = (o, path) => path.split(".").reduce((c, k) => (c == null ? undefined : c[k]), o);
const coll = (list) => Object.assign(list, { get: (id) => list.find((x) => x.id === id) ?? null, has: (id) => list.some((x) => x.id === id), contents: list });
const hooks = {}, outbox = [], notes = [];
let socketListener = null, nid = 0;
globalThis.CONST = { USER_ROLES: { ASSISTANT: 3 }, DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
globalThis.Hooks = { on: (n, f) => (hooks[n] ??= []).push(f), once: (n, f) => (hooks[n] ??= []).push(f), callAll: (n, ...a) => { for (const f of hooks[n] ?? []) f(...a); return true; } };
globalThis.foundry = { utils: { getProperty: getPath, getRoute: (p) => `/${p}`, escapeHTML: (s) => s } };
globalThis.ui = { notifications: { warn: (m) => notes.push(m) } };
const mkUser = (id, isGM = false) => ({ id, isGM, active: true, name: id, hasRole: () => false });
const users = coll([mkUser("gmuser", true), mkUser("p1"), mkUser("p2")]);
users.activeGM = users[0]; users.filter = Array.prototype.filter.bind(users);
const mkActor = (id, type, owner, health) => {
  const a = { id, uuid: `Actor.${id}`, name: id, type, ownership: owner ? { default: 0, [owner]: 3 } : { default: 0 }, flags: {}, items: coll([]), effects: coll([]),
    system: { attributes: Object.fromEntries(["fighting", "agility", "strength", "reason", "intuition", "presence"].map((k) => [k, { value: 4 }])), derived: { health: { value: health, max: health }, resolve: { value: 5, max: 5 }, slugfest: { damage: 2 } }, bonuses: {} },
    update: async (data) => { for (const [k, v] of Object.entries(data)) setPath(a, k, v); },
    createEmbeddedDocuments: async (t, list) => list.map((d) => { const it = { ...d, id: `it${++nid}` }; a.items.push(it); return it; }),
    deleteEmbeddedDocuments: async () => {} };
  return a;
};
const actors = coll([mkActor("hero1", "superhero", "p1", 6), mkActor("hero2", "superhero", "p2", 6), mkActor("thug", "npc", null, 50)]);
const mkCb = (id, actor) => ({ id, name: actor.name, actor, tokenId: `tk${id}`, token: { id: `tk${id}`, uuid: `Scene.s.Token.tk${id}`, hidden: false }, hidden: false, defeated: false, initiative: null, flags: {} });
const combatants = coll([mkCb("cbH1", actors[0]), mkCb("cbN1", actors[2]), mkCb("cbH2", actors[1])]);
const combat = { id: "combat1", documentName: "Combat", combatants, turns: combatants.slice(), flags: {}, round: 0, turn: null,
  update: async (data, opts) => { const change = {}; for (const [k, v] of Object.entries(data)) { setPath(combat, k, v); setPath(change, k, v); } Hooks.callAll("updateCombat", combat, change, opts); },
  updateEmbeddedDocuments: async (kind, ups) => { for (const u of ups) { const c = combatants.get(u._id); for (const [k, v] of Object.entries(u)) if (k !== "_id") setPath(c, k, v); } combat.turns = combatants.slice().sort((a, b) => (a.initiative ?? 99) - (b.initiative ?? 99)); } };
combatants.map = (fn) => Array.prototype.map.call(combatants, fn);
const combats = coll([combat]); combats.active = combat;
globalThis.CONFIG = { Dice: { randomUniform: () => Math.random() }, Combat: { documentClass: class BaseCombat {} }, ActiveEffect: {} };
const settings = new Map(), registered = new Map();
globalThis.game = { user: users[0], users, actors, combat, combats, messages: coll([]), i18n: { lang: "en", localize: (k) => k }, system: { id: "invincible", version: "2.1.8" }, packs: { get: () => null },
  modules: { get: (id) => (id === MOD ? (game._mod ??= { version: "0.0.0-test", active: true }) : null) },
  settings: { settings: registered, register: (m, k, d) => { registered.set(`${m}.${k}`, d); settings.set(`${m}.${k}`, d.default); }, get: (m, k) => settings.get(`${m}.${k}`), set: (m, k, v) => settings.set(`${m}.${k}`, v) },
  socket: { on: (ch, fn) => { socketListener = fn; }, emit: (ch, msg, opts) => { outbox.push({ msg, to: opts?.recipients ?? null }); } } };
globalThis.fromUuid = async (u) => actors.find((a) => a.uuid === u) ?? null;
globalThis.fromUuidSync = (u) => actors.find((a) => a.uuid === u) ?? null;
globalThis.Roll = class { constructor(f) { this.n = parseInt(f, 10); } async evaluate() { this.dice = [{ results: Array.from({ length: this.n }, () => ({ result: 3 })) }]; return this; } async toMessage(data = {}, { create = true } = {}) { const d = { ...data, rolls: [this] }; return create ? ChatMessage.create(d) : d; } };
globalThis.ChatMessage = { create: async () => ({ id: `cm${++nid}` }), getWhisperRecipients: () => [] };

const Main = await import("./main.mjs");
const Store = await import("./store.mjs");
const Engine = await import("./engine.mjs");
Store._setSettle(0);
const origWarn = console.warn; console.warn = () => {};
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 15)); };
Main.start({ init: true, ready: true }); await settle();
settings.set(`${MOD}.tacticsEnabled`, true); Main._reset(); Main.start({ init: true, ready: true }); await settle();
const api = game._mod.api.tactics;
const st = () => Store.read(combat).state;
const rollMsg = (uid, tag, sixes) => ({ id: `m${++nid}`, author: { id: uid }, rolls: [{ options: { tactics: tag }, successCount: sixes, baneCount: 0, pushCount: 0, pushable: false }] });
async function attack() {
  for (let i = 0; i < 6 && st().init.curMember !== "cbH1"; i++) await api.gm.nextTurn();
  await api.request({ op: "declare", actor: "cbH1", decl: { action: "slugfest", targets: ["cbN1"] } }); await settle();
  const before = outbox.length;
  await api.request(api.desk().cards.find((c) => c.kind === "reaction").options.find((o) => o.id === "pass").req); await settle();
  return outbox.slice(before).find((o) => o.msg.k === "tcroll")?.msg.req ?? null;
}

/* ---- D121 (live case, after the H3-1 merge): older chat messages with the same COUNT of request id, from earlier fights in other
   (deleted) combats and from before the combat tag, never stop the watch from asking again */
{
  eq((await api.start(combat)).ok, true, "D121: a fight");
  const r = await attack(), at = st().stack[0].rolls.attack.req.at, bare = r.rid.replace(/_.*/, ""), inst = r.inst.replace(/_.*/, "");
  for (const tag of [{ inst, key: "attack", rid: bare, combat: "T7ClC4" }, { inst, key: "attack", rid: bare, combat: "9Sq7pO" }, { inst, key: "attack", rid: bare }, { inst: r.inst, key: "attack", rid: r.rid, combat: "zo1fHz" }]) {
    const m = rollMsg("p1", tag, 2); game.messages.push(m); Hooks.callAll("createChatMessage", m);
  }
  await settle();
  eq(st().stack[0]?.rolls.attack.sixes ?? null, null, "D121: none of the older messages is taken as this fight's roll");
  const n0 = outbox.length, acts = Engine.watchRolls(at + RW.RESEND_AT[0]); await settle();
  eq(acts.map((a) => a.do), ["resend"], `D121: the watch asks p1 again at 8 s (${r.rid}; old messages ${bare} of combats T7ClC4, 9Sq7pO, untagged, and ${r.rid} of zo1fHz)`);
  eq(outbox.slice(n0).filter((o) => o.msg.k === "tcroll").map((o) => [o.msg.req.rid, o.msg.again]), [[r.rid, 1]], "D121: ... with the same request id, marked again");
  await api.stop(combat);
}

/* ---- D122: the player's client and the watch's copies of a request that came late */
{
  const thrown = () => notes.length;      // in node the system's dialog cannot open: each throw attempt leaves one warning (ITAC.warn.rollDialog)
  const req = { combat: combat.id, inst: "a7_f1", key: "def:cbH2", rid: "r44_f1", actorUuid: "Actor.hero2", attr: "agility", pool: { base: 4, mods: [], total: 4 }, dice: 4, label: "x" };
  game.user = users[2];
  const n0 = thrown();
  socketListener({ k: "tcroll", to: ["p2"], req }, "gmuser"); await settle();
  const n1 = thrown();
  /* p2's throw made its card (the executor takes it); then the watch's copies arrive, as late as the request was */
  game.messages.push(rollMsg("p2", { inst: req.inst, key: req.key, rid: req.rid, combat: combat.id }, 1));
  socketListener({ k: "tcroll", to: ["p2"], req: { ...req }, again: 1 }, "gmuser"); await settle();
  socketListener({ k: "tcroll", to: ["p2"], req: { ...req }, again: 2 }, "gmuser"); await settle();
  const n2 = thrown();
  /* a request that was really lost: no card of it in the chat, the copy is thrown */
  socketListener({ k: "tcroll", to: ["p2"], req: { ...req, rid: "r45_f1", key: "attack" }, again: 1 }, "gmuser"); await settle();
  const n3 = thrown();
  /* a card of the same id in ANOTHER combat (or by somebody not asked) does not stop the copy */
  game.messages.push(rollMsg("p2", { inst: req.inst, key: req.key, rid: "r46_f1", combat: "otherCombat" }, 1), rollMsg("p1", { inst: req.inst, key: req.key, rid: "r46_f1", combat: combat.id }, 1));
  socketListener({ k: "tcroll", to: ["p2"], req: { ...req, rid: "r46_f1" }, again: 1 }, "gmuser"); await settle();
  const n4 = thrown();
  game.user = users[0];
  eq(n1 - n0, 1, "D122 (premise): p2 throws the request when it comes");
  eq(n2 - n1, 0, "D122: the watch's two copies that come after p2's card is in the chat throw nothing (was: two more throws, three cards)");
  eq(n3 - n2, 1, "D122: a copy of a request whose answer is not in the chat is thrown (D120 still holds)");
  eq(n4 - n3, 1, "D122: a card of another combat or of a user not asked does not count as the answer");
}
console.warn = origWarn;
done("check-fxl");
setTimeout(() => process.exit(process.exitCode ?? 0), 50);
