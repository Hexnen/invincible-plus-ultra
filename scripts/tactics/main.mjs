/* Tactical combat, package P2: entry point of the ACTION ENGINE. start() is called from a guarded dynamic import at the tail of scripts/module.js.
   Thin on purpose: P1 (initiative, ledger, scheduler) owns the same file name; at the merge its start() calls startEngine() / stopEngine() below.
   Registers the settings it needs (only if nobody did), starts the relay and the executor hooks at ready, attaches api.tactics.
   With the world setting `tacticsEnabled` off (the default until P8) nothing but the settings and the API object exists: no socket listener, no hook. */
import * as Store from "./p1-standin-store.mjs";
import * as Engine from "./engine.mjs";
import * as Relay from "./relay.mjs";
import * as Desk from "./desk-pure.mjs";
import * as Sys from "./system-adapter.mjs";
import * as Zones from "./zones-adapter.mjs";
import * as E from "./engine-pure.mjs";
import * as P1 from "./p1-standin.mjs";
import { t, errorText } from "./lang.mjs";

const MOD = Store.MOD;
export const SETTING_ENABLED = "tacticsEnabled";
export const SETTING_PLAYERS_END = "turnPlayersEnd";
let started = false, running = false;

function registerSettings() {
  const reg = (key, data) => { if (!game.settings.settings.has(`${MOD}.${key}`)) game.settings.register(MOD, key, data); };
  reg(SETTING_ENABLED, { name: t("ITAC.Settings.enabled.Name"), hint: t("ITAC.Settings.enabled.Hint"), scope: "world", config: true, type: Boolean, default: false, requiresReload: true });
  reg(SETTING_PLAYERS_END, { name: t("ITAC.Settings.playersEnd.Name"), hint: t("ITAC.Settings.playersEnd.Hint"), scope: "world", config: true, type: Boolean, default: true });
}
const enabled = () => { try { return game.settings.get(MOD, SETTING_ENABLED) === true; } catch { return false; } };

/** api.tactics (spec 18), the engine's part. Reads go through the per-observer view; acts go to the executor (locally or through the relay). */
function makeApi() {
  const req = (r) => Relay.request(r);
  const act = (op, shape) => (...args) => req({ op, ...shape(...args) });
  const gm = Object.fromEntries(E.GM_OPS.map((op) => [op, (payload = {}) => req({ ...payload, op })]));
  return {
    enabled, running: () => running,
    // read
    state: () => Engine.view(), combat: () => Store.combat(), viewer: () => Engine.viewer(), journal: () => Engine.journal(),
    isOnTurn: (cid) => { const v = Engine.view(); return v ? P1.isOnTurn(v, cid) : false; },
    budget: (cid) => { const v = Engine.view(); return v ? P1.budget(v, cid) : null; },
    prompts: () => Desk.playerModel(Engine.view(), Engine.viewer(), { ...Engine.context(), P1 }).prompts,
    player: () => Desk.playerModel(Engine.view(), Engine.viewer(), { ...Engine.context(), P1 }),                    // everything the player surface draws
    desk: () => { if (!Store.isStaff(game.user)) return null; const c = Store.combat(); const r = c ? Store.read(c) : { state: null, log: null }; return Desk.deskModel(r.state, r.log, Engine.context()); },   // everything the GM desk draws
    subscribe: (fn) => Store.onChange(fn),
    text: t, errorText,
    // act
    request: req,
    declare: act("declare", (actor, decl) => ({ actor, decl })), amend: act("amend", (inst, decl) => ({ inst, decl })), cancel: act("cancel", (inst) => ({ inst })),
    answer: act("answer", (prompt, value) => ({ prompt, value })), help: act("help", (inst, helper) => ({ inst, helper })),
    endTurn: (actor) => { const v = Engine.view(); return req({ op: "endTurn", actor, round: v?.round, slot: v?.init?.cur }); },
    askException: act("exception", (actor, text, inst) => ({ actor, text, inst })), other: act("other", (actor, text) => ({ actor, text })),
    // GM
    gm,
    start: async (combat = game.combat, opts = {}) => (Store.iAmExecutor() && enabled() ? Store.begin(combat, opts) : false),      // STAND-IN: P1's start draws initiative
    stop: async (combat = game.combat) => (Store.iAmExecutor() ? Store.end(combat) : false),
    compat: () => Sys.compat(), zonesAvailable: () => Zones.available(),
    _runAs: (userId, r) => Relay._runAs(userId, r),
  };
}

/** For P1's main.mjs at the merge: start / stop of the engine half. */
export function startEngine() {
  if (running) return;
  running = true;
  Relay.start(); Engine.start();
  if (Store.iAmExecutor()) Sys.compat().then((list) => { const badNames = list.filter((x) => !x.ok).map((x) => x.name); if (badNames.length) { console.warn(`${MOD} | tactics: system compatibility`, list); ui.notifications?.warn(t("ITAC.warn.compat", { names: badNames.join(", ") })); } }).catch(() => {});
}
export function stopEngine() { running = false; }      // listeners stay registered but every entry point checks the executor and the combat's state; a reload removes them

export function start(phases = {}) {
  if (started) return;
  started = true;
  const run = (name, fn) => { const safe = () => { try { fn(); } catch (err) { console.warn(`${MOD} | tactics ${name}`, err); } }; if (phases[name]) safe(); else Hooks.once(name, safe); };
  run("init", () => { registerSettings(); });
  run("ready", () => {
    const mod = game.modules.get(MOD);
    if (mod) { mod.api ??= {}; mod.api.tactics = { ...(mod.api.tactics ?? {}), ...makeApi() }; }
    if (enabled()) startEngine();
  });
}
export function stop() { stopEngine(); }
