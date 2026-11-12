/* node scripts/tactics/check-hunt3.mjs -- BUG HUNT 3 (2026-11-12): the proofs of the defects H3-1 ... found by reading the code merged
   since bug hunt 2 (fxe .. fxj, perf, p21, lab, seam) and its seams. NOT in check-all.mjs: every block below FAILS until its fix lands.
   Nothing of the module's behaviour is changed here. Rows: dev/combat-defects.md, section "Bug hunt 3, 2026-11-12".
     H3-1  request ids (`r<seq>`) start again at r1 in every fight (S.newState seq 0, also a new start on the same Combat): the roll watch
           feeds the old fight's chat message into the new fight's owed roll (dice of an earlier fight are taken, the player never rolls),
           and a player's client drops a fresh request whose id it threw in an earlier fight (relay `opened`)
     H3-2  Discretion [B2108] offers a WIPED minion group of the hero's side as the ally and moves the attack onto it (D116 / FXF-8 rule)
     H3-3  the roll watch never looks at a roll that is in but still pushable: a lost push / accept update hangs the attack for good
     H3-4  the splash publishes a book villain's Resolve (any `superhero` actor) to every client: the D114 side rule is not used there
     H3-5  the roll watch's memo is per client session: after a GM reload (or another GM taking over) an old owed roll is asked for again
           on three consecutive looks (2 s apart), not on the 8 / 20 / 40 s schedule */
import { readFileSync } from "node:fs";
import { Table, ok, eq, done } from "./testkit.mjs";
import * as KP from "./kit-pure.mjs";
import * as S from "./state-pure.mjs";
import * as RW from "./rollwatch-pure.mjs";

const src = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const item = (id, name, type) => ({ id, name, type, level: null, power: null, boosts: [], autos: [], fx: [], flags: { kit: null, off: false, types: [] }, wf: {} });
const give = (T, cid, ...names) => { const c = T.c[cid]; c.kit = KP.build({ items: names.map((n, i) => item(`i${i}${cid}`, n, "talent")), attrs: c.attrs }); c.pass = c.kit.pass; return T; };

/* ---- H3-2: Discretion and a wiped minion group of the hero's side (a summoned group at 0 Health, no member left) */
{
  const T = new Table();
  T.hero("H2", "p2", { name: "Kid" }).npc("N1", { name: "Turret" }).add("G", { name: "Kid's allies", owners: ["p2"], kind: "minions", members: 0, health: 0, maxHealth: 10 });
  give(T, "H2", "Discretion");
  T.order(["N1", "H2", "G"]);
  await T.gm({ op: "declare", actor: "N1", decl: { action: "slugfest", targets: ["H2"] } });
  const card = T.prompt("reaction", "H2"), disc = (card?.options ?? []).find((o) => String(o.id).startsWith("r:"));
  ok(!!card, "H3-2: Kid is asked for a reaction");
  ok(!disc || !!disc.disabled, `H3-2: Discretion offers no emptied minion group as the ally to put in the way (offered: ${JSON.stringify(disc?.data ?? null)})`);
  if (disc && !disc.disabled) {
    await T.req("p2", { op: "answer", prompt: card.id, value: disc.id });
    await T.roll("ds:H2", 1);
    eq(T.top()?.decl.targets, ["H2"], "H3-2: ... and the attack is never moved onto a group with nobody in it");
  }
}

/* ---- H3-1 (the fix, pure): the fight's tag on every id, kept through the store's read and the player's view; two fights never share one */
{
  const f1 = S.makeFight(1762905600000, 0.5), f2 = S.makeFight(1762905600001, 0.5), f3 = S.makeFight(1762905600000, 0.51);
  ok(S.isFight(f1) && f1 !== f2 && f1 !== f3, `H3-1: fight tags differ by the time and by chance (${f1} ${f2} ${f3})`);
  const s = S.newState({ fight: f1 });
  eq([S.nextId(s, "a"), S.nextId(s, "p"), S.nextId(S.newState({}), "a")], [`a1_${f1}`, `p2_${f1}`, "a1"], "H3-1: every id carries the fight's tag (a state with none keeps the bare ids)");
  ok(S.isId(`r123_${f1}`), "H3-1: a tagged id is still an id");
  eq([S.sanitize(s)?.fight, S.newState({ fight: "Bad.Tag" }).fight], [f1, undefined], "H3-1: the tag survives the store's read; a malformed one is none");
  const FP = await import("./ui/feedback-pure.mjs");
  ok(FP.eventKey({ combat: "c", fight: f1, seq: 3, type: "outcome" }) !== FP.eventKey({ combat: "c", fight: f2, seq: 3, type: "outcome" }), "H3-1: the floaters' event key tells the 3rd event of two fights apart");
  ok(/\$\{ev\.combat\}\|\$\{ev\.fight \?\? ""\}\|\$\{ev\.seq/.test(src("./ui/camera.mjs")), "H3-1: the camera's heard key has the combat and the fight");
}

/* ---- H3-5: the roll watch after the executor's memo is gone (a GM reload, another GM becoming the executor) */
{
  const st = { stack: [{ id: "a1", rolls: { attack: { key: "attack", who: "H1", req: { rid: "r1", at: 0, users: ["p1"] } } } }] };
  const memo = { fed: new Map(), sent: new Map() }, none = () => null;
  const at = (ms) => RW.plan(st, ms, { messageFor: none, memo }).map((a) => a.n);
  eq([at(60000), at(62000), at(64000)], [[1], [], []], "H3-5: a roll owed for a minute when the memo was lost is asked again once, not three times in 4 s");
  eq([at(71999), at(72000), at(91999), at(92000), at(500000)], [[], [2], [], [3], []], "H3-5: ... then on the schedule's own gaps after that send (12 s, 20 s), then the GM's \"Ask again\"");
}

/* ---- H3-3 (the fix, pure): a pushable roll whose card in the chat is ahead of the state (accepted / pushed) is fed after FEED_AFTER, at most twice */
{
  const rec = { who: "H1", sixes: 1, pushed: 0, pushable: true, messageId: "m1", req: { rid: "r1", at: 0, users: ["p1"] } };
  const st = { stack: [{ id: "a1", rolls: { attack: rec } }] }, memo = { fed: new Map(), sent: new Map() };
  let card = { messageId: "m1", sixes: 1, pushed: 0, pushable: true };
  const at = (ms) => RW.plan(st, ms, { messageFor: () => "m1", readFor: () => card, memo }).map((a) => a.do);
  eq([at(10000), at(20000)], [[], []], "H3-3: a pushable roll whose card says the same waits for the roller (nothing fed, nothing asked)");
  card = { ...card, pushable: false };
  eq([at(21000), at(23000), at(23500), at(30000), at(40000)], [[], [], ["feed"], ["feed"], []], "H3-3: the card accepted, the state not: fed once the hook had its time (2.5 s), at most twice");
  card = { messageId: "m2", sixes: 2, pushed: 1, pushable: false };
  eq([at(41000), at(44000)], [[], ["feed"]], "H3-3: the card pushed (the system's new card), the state not: fed too");
  eq(RW.openRolls({ stack: [{ id: "a1", rolls: { x: { ...rec, pushable: false }, y: { ...rec, forced: 1 }, z: rec } }] }).map((o) => o.key), ["z"], "H3-3: only a roll that is in, pushable and not set by the GM is watched this way");
}

/* ---- H3-4: the splash and a book villain's Resolve */
{
  const sp = src("../splash/main.mjs");
  eq(S.heroSide({ type: "superhero", owned: false, disposition: -1 }), false, "H3-4 (premise): D114: an unowned hostile superhero actor (a book villain) is on the GM's side");
  ok(!/const res = actor\?\.type === 'superhero' \? actor\.system\?\.derived\?\.resolve : null;/.test(sp), "H3-4: preCreateChatMessage does not write the Resolve value / max of EVERY superhero actor (a villain's too) into the public message flag");
  ok(!/if \(!actor \|\| actor\.type !== 'superhero'\) return null;\s*\/\/ pojemność Resolve przeciwników/.test(sp), "H3-4: resolveReader does not show the Resolve gauge of EVERY superhero actor (a villain's too) on every client");
}

/* ---- the Foundry half (H3-1, H3-3): the real main.mjs / engine.mjs / relay.mjs against the fake Foundry of check-executor.mjs */
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
/* a roll message as the system writes it (the tag the engine put on the roll; the author as the server delivered it) */
const rollMsg = (uid, tag, sixes, pushable = false, pushed = 0) => ({ id: `m${++nid}`, author: { id: uid }, rolls: [{ options: { tactics: tag }, successCount: sixes, baneCount: 0, pushCount: pushed, pushable }] });
/* the hero attacks the thug, the GM passes the thug's reaction: the hero's attack roll is asked of p1 -> the request */
async function attack() {
  for (let i = 0; i < 6 && st().init.curMember !== "cbH1"; i++) await api.gm.nextTurn();
  await api.request({ op: "declare", actor: "cbH1", decl: { action: "slugfest", targets: ["cbN1"] } }); await settle();
  const before = outbox.length;
  await api.request(api.desk().cards.find((c) => c.kind === "reaction").options.find((o) => o.id === "pass").req); await settle();
  return outbox.slice(before).find((o) => o.msg.k === "tcroll")?.msg.req ?? null;
}
async function closeAll() {
  for (let g = 0; g < 8 && st()?.stack.length; g++) {
    const top = st().stack[0];
    for (const k of Object.keys(top.rolls ?? {})) if (top.rolls[k].sixes == null && top.rolls[k].forced == null) await api.request({ op: "setSixes", inst: top.id, key: k, sixes: 0 });
    for (const p of Object.values(st().prompts ?? {}).filter((p) => !p.answered)) await api.request({ op: "answerFor", prompt: p.id, value: p.kind === "stunts" ? [] : "pass" });
    await settle();
  }
}

/* ---- H3-1: request ids repeat in every fight */
{
  eq((await api.start(combat)).ok, true, "H3-1: fight 1 started");
  const r1 = await attack();
  const m1 = rollMsg("p1", { inst: r1.inst, key: "attack", rid: r1.rid, combat: combat.id }, 3);
  game.messages.push(m1); Hooks.callAll("createChatMessage", m1); await settle();
  eq(st().stack[0]?.rolls.attack.sixes, 3, "H3-1: fight 1: p1's attack roll (3 sixes) is taken");
  await closeAll();
  eq((await api.stop(combat)).ok, true, "H3-1: fight 1 stopped (its roll card stays in the chat)");
  eq((await api.start(combat)).ok, true, "H3-1: fight 2 on the same Combat");
  const r2 = await attack(), at = st().stack[0].rolls.attack.req.at;
  /* (was the premise "fight 2 asks with fight 1's ids again"; since the fix every id carries the fight's tag, state-pure.idOf) */
  eq([r2.rid === r1.rid, r2.inst === r1.inst, r2.rid.replace(/_.*/, "") === r1.rid.replace(/_.*/, "")], [false, false, true], `H3-1: fight 2's first roll has the same count as fight 1's but not its request id or action id (${r1.inst}/${r1.rid} vs ${r2.inst}/${r2.rid})`);
  /* p1's client never got the request (or its throw was lost): the watch should ask again; it finds fight 1's message instead */
  const acts = Engine.watchRolls(at + RW.RESEND_AT[0]); await settle();
  eq(acts.map((a) => a.do), ["resend"], "H3-1: the roll of fight 2 nobody answered is asked for again (not fed from fight 1's chat card)");
  eq(st().stack[0]?.rolls.attack.sixes ?? null, null, "H3-1: fight 1's dice are never taken as fight 2's roll (p1 has not rolled in this fight)");
  await closeAll();
  await api.stop(combat);
}
/* the roller's side: a player's client keeps the request ids it threw (relay.mjs `opened`, system-adapter `thrown`) for the session */
{
  const thrown = () => notes.length;      // in node the system's dialog cannot open: each throw attempt leaves one warning (ITAC.warn.rollDialog)
  const req = { combat: combat.id, inst: "a4", key: "attack", rid: "r99", actorUuid: "Actor.hero1", attr: "fighting", pool: { base: 4, mods: [], total: 4 }, dice: 4, label: "x" };
  game.user = users[1];
  const n0 = thrown();
  socketListener({ k: "tcroll", to: ["p1"], req }, "gmuser"); await settle();
  const n1 = thrown();
  socketListener({ k: "tcroll", to: ["p1"], req: { ...req } }, "gmuser"); await settle();      // the next fight's roll: the same id again
  const n2 = thrown();
  game.user = users[0];
  eq(n1 - n0, 1, "H3-1 (premise): p1's client throws a request it gets");
  eq(n2 - n1, 1, "H3-1: p1's client throws the NEXT fight's request that carries an id it threw in an earlier fight (dropped as a resend today)");
}

/* ---- H3-3: an attack roll that is in but still pushable; the push (or the accept) is lost on the way to the executor */
{
  eq((await api.start(combat)).ok, true, "H3-3: a fight");
  const r = await attack(), at = st().stack[0].rolls.attack.req.at;
  const m = rollMsg("p1", { inst: r.inst, key: "attack", rid: r.rid, combat: combat.id }, 1, true, 0);
  game.messages.push(m); Hooks.callAll("createChatMessage", m); await settle();
  eq([st().stack[0]?.rolls.attack.sixes, st().stack[0]?.rolls.attack.pushable], [1, true], "H3-3: the roll is in and may be pushed: the attack waits for p1's word");
  /* p1 pushes: the system re-writes the message's roll (updateChatMessage), and that update never reaches the executor */
  m.rolls[0].successCount = 2; m.rolls[0].pushCount = 1; m.rolls[0].pushable = false;
  for (const s of [8000, 20000, 40000, 60000]) Engine.watchRolls(at + s);
  await settle();
  eq([st().stack[0]?.rolls.attack.sixes, st().stack[0]?.rolls.attack.pushed, st().stack[0]?.rolls.attack.pushable], [2, 1, false], "H3-3: the watch takes the pushed roll that is in the chat; the attack goes on");
  await closeAll();
}
/* ---- H3-4 (the fix, run): every reader of "which side / may a player see this" agrees with S.heroSide on the same actors: the engine's
   facts (npc), its meta for the view (hidden numbers), the participants (heroes draw first), the adapter's own actorFacts, the splash
   (opponent look, the Resolve in the public flag, the gauge) and the shared reader tactics/source.heroActor */
{
  const Sys = await import("./system-adapter.mjs"), Src = await import("./source.mjs"), Rd = await import("../splash/reader.mjs");
  const tokens = coll([]);
  game.scenes = coll([{ id: "s", tokens }]);
  const cases = [
    ["vil", mkActor("vil", "superhero", null, 8), -1, false, "a book villain (unowned superhero, hostile token)"],
    ["vil0", mkActor("vil0", "superhero", null, 8), 0, false, "an unowned superhero with a neutral token"],
    ["ally", mkActor("ally", "superhero", null, 8), 1, true, "a hero the GM runs (unowned superhero, friendly token)"],
    ["mine", mkActor("mine", "superhero", "p2", 8), -1, true, "a player's hero whose token is hostile"],
    ["goon", mkActor("goon", "npc", "p1", 8), 1, false, "an npc actor, even owned and friendly"],
  ];
  for (const [id, a, disp] of cases) {
    actors.push(a);
    const cb = mkCb(`cb_${id}`, a); cb.token.disposition = disp; a.prototypeToken = { disposition: disp === 1 ? -1 : 1 };      // the prototype says the opposite: the token on the map wins
    combatants.push(cb); combat.turns = combatants.slice(); tokens.push(cb.token);
  }
  const ctx = Engine.context(combat), parts = Sys.participants(combat);
  for (const [id, a, disp, hero, what] of cases) {
    const cid = `cb_${id}`, msg = { speakerActor: a, speaker: { scene: "s", token: `tk${cid}`, actor: a.id } };
    const got = { engine: !ctx.c(cid).npc, parts: parts.find((p) => p.id === cid)?.hero === true, source: Src.heroActor(a, combatants.get(cid).token, game.users), splash: Rd.heroSpeaker(msg), resolve: Rd.publicResolve(msg) != null };
    eq(got, { engine: hero, parts: hero, source: hero, splash: hero, resolve: hero }, `H3-4: ${what}: every reader says ${hero ? "heroes' side (its Resolve may show)" : "GM's side (its Resolve stays hidden)"}`);
  }
  /* a hero's summoned group (a minions actor): the engine puts it on the summoner's side [B1808]; the splash too */
  { const g = mkActor("gang", "minions", null, 4); actors.push(g); const cb = mkCb("cb_gang", g); cb.token.disposition = -1; cb.flags = { [MOD]: { tactics: { summonOf: "cbH1" } } }; cb.parent = combat; combatants.push(cb); tokens.push(cb.token);
    const msg = { speakerActor: g, speaker: { scene: "s", token: "tkcb_gang" } };
    eq([!Engine.context(combat).c("cb_gang").npc, Rd.heroSpeaker(msg)], [true, true], "H3-4: a hero's summoned group: the engine and the splash both say heroes' side");
    combatants.splice(combatants.indexOf(cb), 1); }
  actors.get("vil").prototypeToken = { disposition: -1 };
  const vilMsg = { speakerActor: actors.get("vil"), speaker: { scene: "s", token: "tkcb_vil" }, rolls: [] };
  eq(Rd.publicResolve(vilMsg), null, "H3-4: the splash puts no Resolve of a book villain into the public message flag");
  eq(Sys.actorFacts(actors.get("vil")).npc, true, "H3-4: the adapter's own facts of a villain actor say npc (prototype hostile)");
  eq(Sys.actorFacts(actors.get("hero1")).npc, false, "H3-4: ... and of a player's hero, not");
  eq(Rd.heroSpeaker({ speakerActor: actors.get("vil"), speaker: {} }), false, "H3-4: a villain's roll with no token on a scene: its prototype token decides (hostile)");
}
console.warn = origWarn;
done("check-hunt3");
setTimeout(() => process.exit(process.exitCode ?? 0), 50);
