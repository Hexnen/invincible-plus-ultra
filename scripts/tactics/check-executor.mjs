// node scripts/tactics/check-executor.mjs -- the Foundry half (main.mjs, engine.mjs, relay.mjs, store.mjs, the adapters) against a FAKE Foundry: wiring only.
// It proves that the pieces fit (requests over the socket, state in the Combat flag, rolls read from chat messages, document updates, events, undo).
// It proves nothing about the real Foundry or the real system: that list is in the handoff.
import { ok, eqc as eq, done } from "./testkit.mjs";

const MOD = "invincible-plus-ultra";
const setPath = (o, path, v) => { const ks = path.split("."); let cur = o; for (const k of ks.slice(0, -1)) cur = cur[k] ??= {}; const last = ks.at(-1); if (last.startsWith("-=")) delete cur[last.slice(2)]; else cur[last] = v; };
const getPath = (o, path) => path.split(".").reduce((c, k) => (c == null ? undefined : c[k]), o);
const coll = (list) => Object.assign(list, { get: (id) => list.find((x) => x.id === id) ?? null, has: (id) => list.some((x) => x.id === id), contents: list });
const hooks = {}, outbox = [], notes = [], updates = [];
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
    update: async (data, opts) => { updates.push({ id, data, opts }); for (const [k, v] of Object.entries(data)) setPath(a, k, v); },
    createEmbeddedDocuments: async (t, list) => list.map((d) => { const it = { ...d, id: `it${++nid}` }; a.items.push(it); return it; }),
    deleteEmbeddedDocuments: async (t, ids) => { for (const i of ids) { const at = a.items.findIndex((x) => x.id === i); if (at >= 0) a.items.splice(at, 1); } } };
  return a;
};
const actors = coll([mkActor("hero1", "superhero", "p1", 6), mkActor("hero2", "superhero", "p2", 6), mkActor("thug", "npc", null, 5)]);
const mkCb = (id, actor) => ({ id, name: actor.name, actor, tokenId: `tk${id}`, token: { id: `tk${id}`, uuid: `Scene.s.Token.tk${id}`, hidden: false }, hidden: false, defeated: false, initiative: null, flags: {} });
const combatants = coll([mkCb("cbH1", actors[0]), mkCb("cbN1", actors[2]), mkCb("cbH2", actors[1])]);
const combat = { id: "combat1", documentName: "Combat", combatants, turns: combatants.slice(), flags: {}, round: 0, turn: null, embedded: [],
  update: async (data, opts) => { const change = {}; for (const [k, v] of Object.entries(data)) { setPath(combat, k, v); setPath(change, k, v); } Hooks.callAll("updateCombat", combat, change, opts); },
  updateEmbeddedDocuments: async (kind, ups, opts) => { combat.embedded.push({ ups, opts }); for (const u of ups) { const c = combatants.get(u._id); for (const [k, v] of Object.entries(u)) if (k !== "_id") setPath(c, k, v); } combat.turns = combatants.slice().sort((a, b) => (a.initiative ?? 99) - (b.initiative ?? 99)); } };
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
/* as Foundry 14 (client/dice/roll.mjs toMessage): the second argument is { messageMode, create }, NOT document options; with create:false the chat data comes back */
const chatMade = [];
globalThis.Roll = class { constructor(f) { this.n = parseInt(f, 10); } async evaluate() { this.dice = [{ results: Array.from({ length: this.n }, () => ({ result: 3 })) }]; return this; } async toMessage(data = {}, { create = true } = {}) { const d = { ...data, rolls: [this] }; return create ? ChatMessage.create(d) : d; } };
globalThis.ChatMessage = { create: async (data, opts) => { chatMade.push({ data, opts: opts ?? null }); return { id: `cm${++nid}` }; }, getWhisperRecipients: () => [] };

const Main = await import("./main.mjs");
const Store = await import("./store.mjs");
const Klass = await import("./combat-class.mjs");
Store._setSettle(0);                                            // the claim of a relayed request does not wait in this check
const origWarn = console.warn; const warns = []; console.warn = (...a) => warns.push(a.map(String).join(" "));
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 15)); };

/* ---- the world setting off (the default): nothing but the settings and an idle API */
const BaseClass = CONFIG.Combat.documentClass;
Main.start({ init: true, ready: true }); await settle();
const api = game._mod.api.tactics;
ok(registered.has(`${MOD}.tacticsEnabled`) && registered.get(`${MOD}.tacticsEnabled`).default === false, "the setting exists and is off by default");
eq([api.running(), socketListener, Object.keys(hooks).length, CONFIG.Combat.documentClass === BaseClass, Main.blocker()], [false, null, 0, true, "off"], "setting off: no socket listener, no hook, the Combat class untouched, the API idle");
eq([(await api.start(combat)).error?.code, combat.flags[MOD] ?? null, api.state(), api.prompts(), api.journal()], ["off", null, null, [], []], "setting off: no tactical combat can be started, reads are empty");
combat.flags[MOD] = { tactics: { state: JSON.stringify({ v: 1, rev: 3, mode: "tactical", round: 2 }) } };
eq([(await import("./source.mjs")).tacticsState(combat), (await import("./source.mjs")).sourceOf(combat)], [null, null], "setting off: even a combat that still carries a state from an earlier session is not read as ours (the widgets fall back)");
combat.flags = {};
/* ---- yze-combat still enabled: the same, with one note for the GM */
settings.set(`${MOD}.tacticsEnabled`, true);
const modules = game.modules.get; game.modules.get = (id) => (id === "yze-combat" ? { active: true } : modules(id));
Main._reset(); Main.start({ init: true, ready: true }); await settle();
eq([api.running(), socketListener, Object.keys(hooks).length, CONFIG.Combat.documentClass === BaseClass, Main.blocker(), notes.length, (await api.start(combat)).error?.code], [false, null, 0, true, "yze", 1, "off"], "yze-combat active: nothing runs, nothing is replaced; the GM is told once");
game.modules.get = modules; notes.length = 0;
/* ---- on: the class, the relay, the executor */
Main._reset(); Main.start({ init: true, ready: true }); await settle();
eq([api.running(), typeof socketListener, Klass.installed(), Main.blocker()], [true, "function", true, null], "setting on: engine started, relay listening, the module's Combat class installed");
eq((await api.start(combat)).ok, true, "tactical combat started on the Combat document");
eq([typeof combat.flags[MOD].tactics.state, typeof combat.flags[MOD].tactics.log], ["string", "string"], "state and log are JSON strings in the Combat flags (spec 1.3)");
const st = () => Store.read(combat).state;
eq([st().mode, st().round, st().phase, combat.round, combat.turns.map((c) => c.id), combat.combatants.get(st().init.curMember)?.id === combat.turns[combat.turn]?.id], ["tactical", 1, "turns", 1, st().init.slots.flatMap((x) => x.members), true], "the real start: cards dealt, the core documents follow the card order");
for (let i = 0; i < 4 && st().init.curMember !== "cbH1"; i++) await api.gm.nextTurn();
eq(st().init.curMember, "cbH1", "the hero has the turn");

const gmEvents = [], pubEvents = [];
Hooks.on(`${MOD}.tacticsGm`, (e) => gmEvents.push(e)); Hooks.on(`${MOD}.tactics`, (e) => pubEvents.push(e));
const fromPlayer = async (uid, req, id) => { const before = outbox.length; socketListener({ k: "tcreq", id, n: "nonce1", proto: 1, mod: "x", combat: "combat1", req }, uid); for (let i = 0; i < 100 && !outbox.slice(before).some((o) => o.msg.k === "tcres" && o.msg.id === id); i++) await new Promise((r) => setTimeout(r, 20)); return outbox.slice(before).find((o) => o.msg.k === "tcres" && o.msg.id === id) ?? null; };
const rollMsg = (uid, tag, sixes, pushable = false) => ({ id: `m${++nid}`, author: { id: uid }, rolls: [{ options: { tactics: tag }, successCount: sixes, baneCount: 0, pushCount: 0, pushable }] });

/* a player's declaration arrives over the socket */
eq(await fromPlayer(null, { op: "declare", actor: "cbH1", decl: { action: "slugfest", targets: ["cbN1"] } }, "u0"), null, "a request without a server-supplied sender gets no answer and does nothing");
let res = await fromPlayer("p2", { op: "declare", actor: "cbH1", decl: { action: "slugfest", targets: ["cbN1"] } }, "u1");
eq([res.to, res.msg.env.error.code, res.msg.n], [["p2"], "notOwner", "nonce1"], "a foreign actor: refused, answered to the sender only, with the nonce");
res = await fromPlayer("p1", { op: "declare", actor: "cbH1", decl: { action: "slugfest", targets: ["cbN1"] } }, "u2");
eq([res.msg.env.ok, Object.keys(res.msg.env).includes("state"), st().stack.length, st().seen.includes("p1:u2")], [true, false, 1, true], "accepted: the envelope carries no state; the instance is in the flag; the request id is remembered");
const dup = outbox.length; socketListener({ k: "tcreq", id: "u2", n: "nonce1", proto: 1, combat: "combat1", req: { op: "declare", actor: "cbH1", decl: { action: "slugfest", targets: ["cbN1"] } } }, "p1"); await settle();
eq([outbox.length - dup, st().stack.length], [0, 1], "the same envelope again: ignored");
eq(api.desk().cards.map((c) => [c.kind, c.about]), [["reaction", "cbN1"]], "the GM desk model shows the NPC's reaction card");
ok(gmEvents.some((e) => e.type === "actionDeclared" && e.combat === "combat1") && pubEvents.some((e) => e.type === "actionDeclared"), "events on both hooks");
ok(outbox.some((o) => o.msg.k === "tcev" && o.msg.ev.type === "actionDeclared" && o.to === null), "the public event is broadcast to everyone");

/* the GM answers locally; the roll request goes to the player's client */
eq((await api.request(api.desk().cards[0].options.find((o) => o.id === "block").req)).ok, true, "GM answers through the local path");
const rr = outbox.find((o) => o.msg.k === "tcroll");
eq([rr?.to, rr?.msg.req.key, rr?.msg.req.dice, rr?.msg.req.maxPush ?? null], [["p1"], "attack", 4, null], "the roll request is sent to the owner's client only");
const tag = { inst: rr.msg.req.inst, key: "attack", rid: rr.msg.req.rid };
Hooks.callAll("createChatMessage", rollMsg("p2", tag, 5)); await settle();
eq(st().stack[0].rolls.attack.sixes ?? null, null, "a roll message with the tag but from another user is ignored (identity = message author)");
Hooks.callAll("createChatMessage", rollMsg("p1", { ...tag, rid: "guess" }, 5)); await settle();
eq(st().stack[0].rolls.attack.sixes ?? null, null, "a wrong request id is ignored");
Hooks.callAll("createChatMessage", rollMsg("p1", tag, 3)); await settle();
eq(st().stack[0].rolls.attack.sixes, 3, "the owner's roll is read from the chat message");
const def = st().stack[0].rolls["def:cbN1"];
eq([def.req.users, def.req.maxPush], [["gm"], 0], "the NPC's defence roll is asked of the GM, never pushable");
ok(notes.length > 0, "the GM's roll dialog could not open in node: a warning, not a crash (the GM can set the result by hand)");
Hooks.callAll("createChatMessage", rollMsg("gmuser", { inst: tag.inst, key: "def:cbN1", rid: def.req.rid }, 1)); await settle();
eq(st().stack[0].step, "stunts", "both rolls in: the flow reached the stunts");
const pm = (await import("./desk-pure.mjs")).playerModel((await import("./engine.mjs")).view(users[1]), (await import("./engine.mjs")).viewer(users[1]), {});
eq([pm.prompts.map((p) => p.kind), (await import("./engine.mjs")).view(users[1]).txOpen ?? null, (await import("./engine.mjs")).viewer(users[1]).owns], [["stunts"], null, ["cbH1"]], "the player's view: own stunt prompt, no GM bookkeeping");
res = await fromPlayer("p1", pm.prompts[0].answerReq(["doubleDamage@cbN1"]), "u3");
eq([res.msg.env.ok, st().stack.length, actors[2].system.derived.health.value], [true, 0, 1], "stunt answered over the socket: closed, Health 5 -> 1 on the actor document");
const hu = updates.find((u) => u.id === "thug");
eq([Object.keys(hu.data), typeof hu.opts.ipuTactics], [["system.derived.health.value"], "string"], "the document update goes through the adapter's path and carries { ipuTactics: <transaction id> }");
eq(api.journal().length, 1, "journal row");
eq((await fromPlayer("p1", { op: "undo", tx: api.desk().journal[0].id }, "u4")).msg.env.error.code, "noPermission", "a player cannot undo");
eq([(await api.gm.undo({ tx: api.desk().journal[0].id })).ok, actors[2].system.derived.health.value, Store.read(combat).log.list[0].state], [true, 5, "undone"], "GM undo restores the actor");
/* D120: a roll lost on the wire never waits for somebody to notice it (engine.mjs watchRolls, rollwatch-pure) */
{
  const Engine = await import("./engine.mjs");
  for (let i = 0; i < 4 && st().init.curMember !== "cbH1"; i++) await api.gm.nextTurn();
  const dz = await api.request({ op: "declare", actor: "cbH1", decl: { action: "slugfest", targets: ["cbN1"] } }); await settle();
  eq([dz?.ok, dz?.error?.code], [true, undefined], "D120: a new attack (p1's hero)");
  const before = outbox.length;
  await api.request(api.desk().cards.find((c) => c.kind === "reaction").options.find((o) => o.id === "pass").req); await settle();
  const sent = outbox.slice(before).filter((o) => o.msg.k === "tcroll");
  eq(sent.length, 1, "D120: the roll is asked for once");
  const rq = sent[0].msg.req, at = st().stack[0].rolls.attack.req.at;
  /* the request never arrived (nothing comes back): the watch asks again with the same id */
  eq(Engine.watchRolls(at + 3000).length, 0, "D120: a few seconds: nothing yet");
  const b2 = outbox.length;
  eq(Engine.watchRolls(at + 8000).map((a) => a.do), ["resend"], "D120: no answer after 8 s: the request goes again");
  const again = outbox.slice(b2).find((o) => o.msg.k === "tcroll");
  eq([again?.to, again?.msg.req.rid, again?.msg.req.key, again?.msg.again], [["p1"], rq.rid, "attack", 1], "D120: the same request id, to the same player, marked `again`");
  /* the answer was made but its createChatMessage never reached the executor: it is in the chat, so the watch feeds it in */
  const lost = rollMsg("p1", { inst: rq.inst, key: "attack", rid: rq.rid }, 2);
  game.messages.push(lost);
  Engine.watchRolls(at + 9000); await settle();
  eq(st().stack[0]?.rolls.attack.sixes, 2, "D120: the roll whose message the executor never heard is taken from the chat");
  game.messages.length = 0;
  for (const p of Object.values(st().prompts ?? {}).filter((p) => !p.answered)) await api.request({ op: "answerFor", prompt: p.id, value: p.kind === "stunts" ? [] : "pass" });
  await settle();
  eq(st().stack.length, 0, "D120: the attack ran to its end");
}
eq((await api._runAs("p2", { op: "declare", actor: "cbH1", decl: { action: "slugfest", targets: ["cbN1"] } })).error.code, "notOwner", "_runAs runs a request exactly as that user");
eq((await api.other("cbH1", "x")).ok, true, "api.other as the GM (owner of everything)");
eq((await api.stop(combat)).ok, true, "stop removes the state");
eq([combat.flags[MOD].tactics.state, combat.flags[MOD].tactics.log, api.state()], ["", "", null], "no tactical state left");
eq((await fromPlayer("p1", { op: "endTurn", actor: "cbH1", round: 1, slot: 0 }, "u5")).msg.env.error.code, "off", "requests after the stop: off");
/* the copy tokens of a duplicator [B1907] stand where their owner stands: on its level of the map and in its zone */
{
  const Summons = await import("./summons.mjs"), made = [], applied = [];
  const scene = { id: "s", grid: { size: 100 }, tokens: coll([]), createEmbeddedDocuments: async (k, list) => { made.push(...list); for (const d of list) scene.tokens.push(mkTok({ ...d, id: `cp${made.length}${scene.tokens.length}` })); return list; }, deleteEmbeddedDocuments: async (k, ids) => { for (const id of ids) scene.tokens.splice(scene.tokens.findIndex((x) => x.id === id), 1); } };
  const mkTok = (d) => { const td = { width: 1, height: 1, elevation: 0, flags: {}, ...d, parent: scene, toObject: () => { const { parent, toObject, update, ...rest } = td; return JSON.parse(JSON.stringify(rest)); }, update: async (data) => { for (const [k, v] of Object.entries(data)) setPath(td, k, v); } }; return td; };
  const ot = mkTok({ id: "tkcbH1", name: "hero1", x: 300, y: 100, elevation: 20, flags: { "moinen-maps": { alt: "elevated", air: true }, other: { secret: 1 } } });
  scene.tokens.push(ot); const tok0 = combatants.get("cbH1").token; combatants.get("cbH1").token = ot;
  /* a map: x < 400 is zone z1, the rest z2; the owner stands in the last column of z1 */
  const zapi = { zoneOfToken: (t) => ({ zone: (t.x ?? t.document?.x) < 400 ? "z1" : "z2" }), range: () => null, placeAt: (x) => ({ zone: x < 400 ? "z1" : "z2" }), canWrite: () => true, apply: async (op) => { applied.push(op); for (const r of op.rows) { const td = scene.tokens.get(r.id); td.flags["moinen-maps"] = Object.fromEntries(Object.entries({ alt: r.alt, floor: r.floor, air: r.air }).filter(([, v]) => v != null)); } return { ok: true, changed: true, inverse: null }; } };
  const get0 = game.modules.get; game.modules.get = (id) => (id === "moinen-maps" ? { active: true, api: { zones: zapi } } : get0(id));
  await Summons.syncCopies(combat, { effects: [{ kind: "copies", holder: "cbH1", data: { n: 7 } }] });
  eq([made.length, made.map((d) => JSON.stringify(d.flags["moinen-maps"])), made.every((d) => !d.flags.other && d.flags[MOD].tactics.copyOf.owner === "cbH1")], [3, Array(3).fill(JSON.stringify({ alt: "elevated", air: true })), true], "copies: three tokens on the owner's level of the map (the map's level flags, nothing else of the owner's flags)");
  eq(made.map((d) => d.x < 400), [true, true, true], "copies: each stands in the owner's zone, not over the border beside it");
  ot.flags["moinen-maps"] = {}; made.length = 0;
  await Summons.syncCopies(combat, { effects: [{ kind: "copies", holder: "cbH1", data: { n: 7 } }] });
  eq([made.length, applied.length, applied.every((op) => op.op === "tokens" && op.rows[0].alt === null && op.rows[0].air === null), scene.tokens.filter((td) => td.id !== ot.id).every((td) => !td.flags["moinen-maps"].alt)], [0, 3, true, true], "copies: the owner came down: its copies follow through the map's own write path");
  await Summons.syncCopies(combat, { effects: [] });
  eq(scene.tokens.length, 1, "copies: gone with the bonus");
  game.modules.get = get0; combatants.get("cbH1").token = tok0;
}
/* ---- P8g: D95, D97, D98, D100, D96 (the Foundry half) */
{
  const { readFileSync } = await import("node:fs");
  const src = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
  /* D95: every chat message the executor makes carries the engine's mark as a DOCUMENT option */
  const E = await import("./engine.mjs"), n0 = chatMade.length;
  ok(/ChatMessage\.create\(await roll\.toMessage\([^\n]*\{ create: false \}\), \{ ipuTactics: true \}\)/.test(src("./engine.mjs")), "D95: the engine's dice card is created by ChatMessage.create with the ipuTactics option (Roll#toMessage passes no document options)");
  void E; void n0;
  /* D97: own startCombat tells of a start only when the fight did start, and hands the combat to the effect registry */
  const Own = Klass.makeClass(class { async startCombat() { return this; } }), heard = [], refreshed = [];
  Hooks.on("combatStart", (c, d) => heard.push([c.id, d]));
  CONFIG.ActiveEffect.documentClass = { registry: { refresh: async (ev, ctx) => { refreshed.push([ev, ctx?.combat?.id ?? null]); } } };
  const mk = (id) => Object.assign(new Own(), { id, _playCombatSound: (s) => heard.push(["sound", s]) });
  await mk("nope").startCombat();
  eq([heard.length, refreshed.length], [0, 0], "D97: a start that was refused (no such combat) plays no sound, calls no combatStart hook, refreshes no effect");
  await mk(combat.id).startCombat();
  eq([heard.map((h) => h[0]), heard[1]?.[1], refreshed], [["sound", combat.id], { round: 1, turn: 0 }, [["combatStart", combat.id]]], "D97: a start that went through: sound, the hook with core's payload, the registry refreshed WITH the combat");
  ok(!!api.state(), "D97: the fight is on after the class's startCombat");
  delete CONFIG.ActiveEffect.documentClass;
  await api._runAs("gmuser", { op: "hazard", hazard: { kind: "fire", intensity: 2 }, targets: ["cbN1"] });
  ok(chatMade.length > 0 && chatMade.every((m) => m.opts?.ipuTactics === true && m.data.rolls?.length === 1 && m.data.flags[MOD].tactics.dice), `D95: the dice card of a hazard was created with the option and the roll (${chatMade.length})`);
  /* suspicion (bug hunt 1): an edit of an old roll card, its action long over, costs the executor no write at all */
  { const up0 = combat.update; let writes = 0; combat.update = async (...a) => { writes++; return up0(...a); };
    Hooks.callAll("updateChatMessage", rollMsg("p1", { inst: "a999", key: "attack", rid: "r1" }, 2)); await settle();
    eq(writes, 0, "an old roll card that is edited (its instance is not on the stack) costs no claim write");
    combat.update = up0; }
  /* D98: the copy tokens of a deleted fight leave the scene; other fights' copies and real tokens stay */
  const Summons = await import("./summons.mjs");
  const mkScene = (id, toks) => { const s = { id, tokens: coll(toks), deleteEmbeddedDocuments: async (k, ids) => { for (const i of ids) { const at = s.tokens.findIndex((x) => x.id === i); if (at >= 0) s.tokens.splice(at, 1); } } }; s.tokens.filter = Array.prototype.filter.bind(s.tokens); return s; };
  const cp = (id, c) => ({ id, flags: { [MOD]: { tactics: { copyOf: { combat: c, owner: "cbH1" } } } } });
  const s1 = mkScene("s1", [cp("a", combat.id), cp("b", "other"), { id: "real", flags: {} }]), s2 = mkScene("s2", [cp("c", combat.id)]);
  game.scenes = [s1, s2];
  Hooks.callAll("deleteCombat", combat); await Summons.clearCopies(null);
  eq([s1.tokens.map((x) => x.id), s2.tokens.length], [["b", "real"], 0], "D98: deleting the Combat removes its copy tokens from every scene, and nothing else");
  delete game.scenes;
  /* D100: an injuries table that could not be read is not kept: the next caller reads it again */
  const Sys = await import("./system-adapter.mjs"), from0 = globalThis.fromUuid, hero = actors[0], items0 = hero.items.length;
  eq(await Sys.addInjury(hero, 3, "tx"), null, "D100: no table yet: no injury (the GM is told)");
  globalThis.fromUuid = async (u) => (/RollTable/.test(u) ? { results: [{ range: [3, 4], documentUuid: "Compendium.x.Item.i3", name: "Cracked ribs" }] } : u === "Compendium.x.Item.i3" ? { toObject: () => ({ _id: "i3", name: "Cracked ribs", type: "criticalInjury" }) } : from0(u));
  const op = await Sys.addInjury(hero, 4, "tx");
  eq([op?.t, op?.data?.crit, hero.items.length - items0], ["item+", 4, 1], "D100: the table became readable: the next injury resolves (an early empty read is not cached for the session)");
  globalThis.fromUuid = async () => { throw new Error("pack gone"); };
  eq((await Sys.addInjury(hero, 3, "tx"))?.t ?? null, null, "D100: a table that was read is kept: a later failing read of the item only loses that item");
  globalThis.fromUuid = async (u) => (u === "Compendium.x.Item.i3" ? { toObject: () => ({ name: "Cracked ribs", type: "criticalInjury" }) } : null);
  eq((await Sys.addInjury(hero, 3, "tx"))?.t, "item+", "D100: ... and the kept table still answers when the table itself can no longer be read");
  globalThis.fromUuid = from0; hero.items.length = items0;
  /* D96: the legacy heuristics of scripts/module.js skip the executor's writes (spec 1.3) */
  const mod = src("../module.js");
  eq([(mod.match(/Hooks\.on\("preUpdateActor", \(actor, changes, options\) => \{\s*try \{\s*if \([^\n]*options\?\.ipuTactics !== undefined\) return;/g) ?? []).length, /Hooks\.on\("createItem", \(item, options\) => \{\s*try \{\s*if \([^\n]*options\?\.ipuTactics !== undefined\) return;/.test(mod), /Hooks\.on\("preUpdateActor", \(actor, changes\)/.test(mod)], [2, true, false], "D96: both preUpdateActor heuristics and the createItem one return early on an ipuTactics write");
}
/* FXR T040: the desk context carries Resolve of a sheet this user may read (the bar greys a stress-paid answer at 0 Resolve) */
{ const E = await import("./engine.mjs"); eq(E.context(combat).c("cbH1")?.resolve ?? null, 5, "T040: Engine.context().c gives the readable sheet's Resolve"); }
console.warn = origWarn;
eq(warns.filter((w) => !/roll dialog|stunts dialog|injuries table|system compatibility/.test(w)).length, 0, "no unexpected warnings");
done("check-executor");
setTimeout(() => process.exit(process.exitCode ?? 0), 50);
