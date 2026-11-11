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
globalThis.Roll = class { constructor(f) { this.n = parseInt(f, 10); } async evaluate() { this.dice = [{ results: Array.from({ length: this.n }, () => ({ result: 3 })) }]; return this; } async toMessage() { return { id: `dm${++nid}` }; } };
globalThis.ChatMessage = { create: async () => ({ id: `cm${++nid}` }), getWhisperRecipients: () => [] };

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
console.warn = origWarn;
eq(warns.filter((w) => !/roll dialog|stunts dialog|injuries table|system compatibility/.test(w)).length, 0, "no unexpected warnings");
done("check-executor");
setTimeout(() => process.exit(process.exitCode ?? 0), 50);
