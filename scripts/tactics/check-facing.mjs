/* node scripts/tactics/check-facing.mjs -- the Foundry-facing files (store, executor, combat class, API) against a SMALL FAKE of the
   Foundry objects they touch. This proves the wiring between those files and the pure core (names, shapes, order of writes); it does NOT
   prove anything about real Foundry behaviour (document classes, sockets, hooks timing), which stays unverified until a live session. */
import { ok, eq, done } from "./testkit.mjs";

/* ---------------------------------------------------------------- the fake */
const MOD = "invincible-plus-ultra";
const hookLog = [];
const settings = { tacticsEnabled: true, tacticsInitiative: true, tacticsRedraw: "everyRound", turnPlayersEnd: true };
class Coll extends Map {
  get contents() { return [...this.values()]; }
  map(fn) { return this.contents.map(fn); }
  filter(fn) { return this.contents.filter(fn); }
  find(fn) { return this.contents.find(fn); }
  some(fn) { return this.contents.some(fn); }
  [Symbol.iterator]() { return this.values(); }
}
const users = new Coll();
const mkUser = (id, isGM) => { const u = { id, isGM, active: true, hasRole: () => false }; users.set(id, u); return u; };
const gmUser = mkUser("gm1", true), p1 = mkUser("u1", false), p2 = mkUser("u2", false);
users.activeGM = gmUser;
const setPath = (obj, path, v) => { const ks = path.split("."); let o = obj; for (const k of ks.slice(0, -1)) o = (o[k] ??= {}); o[ks.at(-1)] = v; };
const mkActor = (type, owner, extra = {}) => ({ type, ownership: { default: 0, ...(owner ? { [owner]: 3 } : {}) }, flags: {}, items: [], updates: [],
  system: { derived: { health: { value: 2, max: 8 }, resolve: { value: 3, max: 6 } }, attributes: { strength: { value: 3 } } },
  async update(data) { this.updates.push(data); for (const [k, v] of Object.entries(data)) setPath(this, k, v); }, ...extra });
let sorter = null;
class FakeCombat {
  constructor(id) { this.id = id; this.documentName = "Combat"; this.flags = {}; this.round = 0; this.turn = null; this.combatants = new Coll(); this.turns = []; this.writes = []; this.baseCalls = []; }
  add(id, actor, o = {}) { const c = { id, tokenId: `t${id}`, name: id, initiative: null, flags: {}, isDefeated: false, hidden: false, actor, parent: this, ...o }; this.combatants.set(id, c); this.setupTurns(); return c; }
  setupTurns() { this.turns = this.combatants.contents.sort(sorter ?? this._sortCombatants); return this.turns; }
  _sortCombatants(a, b) { return (b.initiative ?? -Infinity) - (a.initiative ?? -Infinity); }
  get combatant() { return this.turn === null ? undefined : this.turns[this.turn]; }
  async update(data, opts) { this.writes.push({ data, opts }); for (const [k, v] of Object.entries(data)) setPath(this, k, v); return this; }
  async updateEmbeddedDocuments(_n, ups, opts) { this.writes.push({ embedded: ups, opts }); for (const u of ups) { const c = this.combatants.get(u._id); for (const [k, v] of Object.entries(u)) if (k !== "_id") setPath(c, k, v); } this.setupTurns(); }
  async startCombat() { this.baseCalls.push("startCombat"); return this; }
  async nextTurn() { this.baseCalls.push("nextTurn"); return this; }
  async nextRound() { this.baseCalls.push("nextRound"); return this; }
  async previousTurn() { this.baseCalls.push("previousTurn"); return this; }
  async previousRound() { this.baseCalls.push("previousRound"); return this; }
  async rollInitiative() { this.baseCalls.push("rollInitiative"); return this; }
  async resetAll() { this.baseCalls.push("resetAll"); return this; }
  async endCombat() { this.baseCalls.push("endCombat"); return this; }
}
const combats = new Coll();
const notes = [];
globalThis.CONST = { USER_ROLES: { ASSISTANT: 3 }, DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
globalThis.CONFIG = { Dice: { randomUniform: () => Math.random() }, Combat: { documentClass: FakeCombat }, ActiveEffect: {} };
globalThis.Hooks = { callAll: (name, info) => { hookLog.push({ name, info }); return true; }, on() {}, once() {} };
globalThis.ui = { notifications: { warn: (m) => notes.push(["warn", m]), info: (m) => notes.push(["info", m]) } };
globalThis.game = { user: gmUser, users, combats, combat: null, i18n: { lang: "en" },
  settings: { get: (m, k) => { if (m !== MOD || !(k in settings)) throw new Error("no setting"); return settings[k]; } },
  modules: new Map([[MOD, { active: true }]]), socket: { on() {}, emit() {} } };

const Store = await import("./store.mjs");
const GM = await import("./gm.mjs");
const Relay = await import("./relay.mjs");
const Klass = await import("./combat-class.mjs");
const { tacticsApi: Api, attach } = await import("./api.mjs");
const Src = await import("./source.mjs");

/* ---------------------------------------------------------------- the class */
ok(Klass.install() && Klass.installed() && CONFIG.Combat.documentClass !== FakeCombat, "the class wraps the configured one");
const Own = CONFIG.Combat.documentClass;
sorter = Own.prototype._sortCombatants;                       // core calls it unbound
const combat = new Own("c1"); combats.set("c1", combat); game.combat = combat; combats.active = combat;
const hero = mkActor("superhero", "u1"), hero2 = mkActor("superhero", "u2"), npc = mkActor("npc"), chal = mkActor("challenge");
combat.add("h1", hero); combat.add("h2", hero2); combat.add("n1", npc); combat.add("ch", chal);
attach();
ok(game.modules.get(MOD).api.tactics === Api, "api.tactics is attached");
eq([Api.active(), Api.state(), Api.order(), Api.prompts()], [false, null, [], []], "no state yet: the reads are empty");
eq((await Api.endTurn("h1")).error.code, "off", "a request before the start answers `off`");

/* ---------------------------------------------------------------- start through the class */
await combat.startCombat();
ok(!combat.baseCalls.includes("startCombat"), "startCombat does not fall through to rolled initiative");
const st = Store.stateOf(combat);
ok(st && st.round === 1 && st.phase === "turns" && st.mode === "tactical" && st.opts.redraw === "everyRound", "the state is on the Combat document, mode and options from the settings");
eq(combat.round, 1, "Combat.round follows");
eq(combat.turns.map((c) => c.id).slice(0, 3), st.init.slots.flatMap((s) => s.members), "combat.turns is the card order [I1]");
eq(combat.turns.at(-1).id, "ch", "a combatant without a card sorts last [I12]");
ok(combat.combatants.get("ch").initiative === null && combat.turns.slice(0, 3).every((c) => Number.isInteger(c.initiative)), "Combatant.initiative is the card");
eq(combat.combatant?.id, st.init.curMember, "Combat.turn points at the member whose turn it is");
ok(combat.writes.every((w) => w.opts?.ipuTactics === true), "every document update carries ipuTactics");
ok(combat.writes.some((w) => w.embedded && w.opts.diff === false && w.opts.turnEvents === false), "the first write re-sorts every client (no diff, no turn events)");
ok(hookLog.some((h) => h.name === Store.HOOK_GM && h.info.events.some((e) => e.type === "combatStart")), "the executor announces events on tacticsGm");
eq(Api.state().seen, st.seen, "the GM's view is the whole state");

/* ---------------------------------------------------------------- a player's requests, as the executor sees them */
const cur = () => Store.stateOf(combat).init.curMember;
while (cur() !== "h1") await combat.nextTurn();
ok(!combat.baseCalls.includes("nextTurn"), "nextTurn goes to the executor");
eq((await Relay._runAs("u2", "c1", { op: "endTurn", actor: "h1" })).error.code, "notOwner", "forged: another player's hero (ownership is read from the actor)");
eq((await Relay._runAs("u1", "c1", { op: "nextRound" })).error.code, "notOwner", "a GM operation from a player");
eq((await Relay._runAs("u1", "c1", { op: "endTurn", actor: "h1", junk: "x".repeat(5000) })).error.code, "badInput", "a request over 4 KB");
eq((await GM.exec(p1, "c1", { op: "endTurn", actor: "h1" }, { trusted: false, via: "relay" })).error.code, "untrusted", "a request without the server's sender id");
eq((await GM.exec(p1, "c1", { op: "endTurn", actor: "h1" }, { trusted: true, via: "relay", proto: 99, noJitter: true })).error.code, "stale", "a newer protocol");
eq((await Relay._runAs("u1", "zz", { op: "endTurn", actor: "h1" })).error.code, "gone", "an unknown combat");
eq((await Relay._runAs("zz", "c1", { op: "endTurn", actor: "h1" })).error.code, "untrusted", "an unknown user");
settings.turnPlayersEnd = false;
eq((await Relay._runAs("u1", "c1", { op: "endTurn", actor: "h1" })).error.code, "playersOff", "the table's setting is read live");
settings.turnPlayersEnd = true;
const m = await Relay._runAs("u1", "c1", { op: "mark", actor: "h1", unit: "full" });
ok(m.ok && m.changed && Api.budget("h1").full === "used" && Src.groupsFor(["th1"], combat)[0].pips[0].state === "used", "a player's mark lands in the ledger and in the widgets' read side");
eq((await Relay._runAs("u2", "c1", { op: "mark", actor: "h2", unit: "full" })).error.code, "notYourTurn", "[L2] refused in tactical mode");
const before = Store.stateOf(combat).rev;
const e = await Relay._runAs("u1", "c1", { op: "endTurn", actor: "h1", id: "r1" });
ok(e.ok && e.changed && cur() !== "h1" && combat.combatant?.id === cur(), "the owner ends the turn; the core pointer follows");
const dup = await Relay._runAs("u1", "c1", { op: "endTurn", actor: cur(), id: "r1" });
ok(dup.ok && dup.changed === false && Store.stateOf(combat).rev === before + 1, "the same request id twice changes nothing");
GM._resetLimits();
let refused = 0;
for (let i = 0; i < 95; i++) { const r = await GM.exec(p2, "c1", { op: "holdOff", actor: "zz", with: "zz" }, { trusted: true, via: "relay", noJitter: true }); if (r.error?.code === "rate") refused++; }
eq(refused, 5, "the 91st request of a player within a minute is refused");
GM._resetLimits();

/* ---------------------------------------------------------------- the view of a player, joining, the round, stopping */
game.user = p1;
ok(Api.state().seen.length === 0 && !("draw" in Api.state().init), "a player's view holds back request ids and the deck");
eq((await Api.gm.nextRound()).error.code, "noGM", "a player's client does not execute (and the fake has no socket answer)") ;
game.user = gmUser;
combat.add("late", mkActor("npc"));
GM.scheduleRoster(combat);
await new Promise((r) => setTimeout(r, 400));
ok(Store.stateOf(combat).ledger.late && combat.combatants.get("late").initiative === Math.max(...combat.turns.map((c) => c.initiative ?? 0)), "[A-1] a late joiner gets the next free card through the roster hook path");
await combat.nextRound();
eq([combat.round, Store.stateOf(combat).round], [2, 2], "the next round: Combat.round follows");
await combat.previousRound(); await combat.rollInitiative(["h1"]); await combat.resetAll();
ok(!combat.baseCalls.length && notes.filter((n) => n[0] === "info").length >= 3, "previousRound and rolling initiative only say why they do nothing");
/* Combat Veteran through the executor: the stress is applied to the actor */
hero.flags[MOD] = { tactics: { talents: { combatVeteran: true } } };
await combat.nextRound();
const vp = Api.prompts().find((p) => p.kind === "veteran");
ok(!vp && Object.values(Store.stateOf(combat).prompts).some((p) => p.kind === "veteran" && p.to.users[0] === "u1"), "[I7] the veteran's prompt goes to the owner, not to the GM desk, while the owner is connected");
p1.active = false;
const vp2 = Api.prompts().find((p) => p.kind === "veteran");
ok(vp2 && combat.turn === null, "a prompt of a player who is away falls to the executor; nobody has the turn during the draw");
await Api.answer(vp2.id, "keep");
eq(hero.system.derived.resolve.value, 2, "[I7] keeping the card costs 1 stress on the actor");
p1.active = true;
/* end of scene through the class */
let asked = 0;
Klass.setEndSceneAsk(async (c) => { asked++; await Api.endScene({}, c); return "done"; });
await combat.endCombat();
ok(asked === 1 && combat.baseCalls.includes("endCombat") && Store.stateOf(combat).phase === "sceneEnd", "endCombat offers the end-of-scene procedure, then the core ends the combat");
eq(hero.system.derived.health.value, 5, "[B2779] recovery is written to the actor");
Klass.setEndSceneAsk(async () => "cancel");
const c2 = new Own("c2"); combats.set("c2", c2); c2.add("a", mkActor("npc"));
await Relay.request("c2", { op: "start" });
await c2.endCombat();
ok(!c2.baseCalls.includes("endCombat"), "cancelling the end-of-scene dialog keeps the combat");
await Api.stop(c2);
ok(Store.stateOf(c2) === null && c2.flags[MOD].tactics.state === "" && c2.writes.at(-1).opts.diff === false, "stop removes the state and re-sorts");
await c2.nextTurn();
ok(c2.baseCalls.includes("nextTurn"), "a combat without the state behaves like the wrapped class");
settings.tacticsInitiative = false;
await c2.startCombat();
ok(c2.baseCalls.includes("startCombat") && !Klass.ownInitiative(), "with the setting off, starting a combat is the wrapped class's business");

done("check-facing");
