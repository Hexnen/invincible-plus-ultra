/* node scripts/tactics/check-tacb.mjs -- TACB (the user 2026-11-13: a yellow "Tactics" button in the combat tab above Begin Combat; it starts
   a tactical fight, Begin Combat below it an ordinary one). The GM chooses per fight at its start:
     A. the combat class: a bare startCombat() (core's Begin Combat, every macro) is the wrapped class's start; startCombat(TACTICAL) is the
        tactical one, and only while the own initiative is in charge; an ordinary fight rolls, turns and ends like core;
     B. the tracker field (startField): the Tactics button above Begin Combat for staff before the fight, the surprise toggles at its sides,
        once per render; nothing for a player, in a started fight, or without the own initiative; a click is startCombat(TACTICAL);
     C. the map's rules (movement.mjs drive): handed to this module only while a tactical fight is on the table;
     D. the words in both languages; the setting's hint says what the button does.
   A small fake of Foundry, as check-facing; what a real tracker and a real map do stays for the live check. */
import { ok, eq, done, Table } from "./testkit.mjs";
import * as S from "./state-pure.mjs";

const MOD = "invincible-plus-ultra";
const settings = { tacticsEnabled: true, tacticsInitiative: true };
const users = [];
const gm = { id: "gm", isGM: true, hasRole: () => false }, player = { id: "p1", isGM: false, hasRole: () => false };
globalThis.CONST = { USER_ROLES: { ASSISTANT: 3 } };
globalThis.CONFIG = { Combat: { documentClass: null }, ActiveEffect: {} };
globalThis.Hooks = { callAll() { return true; }, on() {}, once() {} };
globalThis.ui = { notifications: { warn() {}, info() {} } };
globalThis.foundry = { utils: { getProperty: (o, p) => p.split(".").reduce((c, k) => (c == null ? undefined : c[k]), o) } };
const maps = { active: false, api: { zones: null } };
globalThis.game = { user: gm, users: Object.assign(users, { activeGM: gm, get: () => null }), combats: [], combat: null, i18n: { lang: "en" },
  settings: { get: (m, k) => { if (m !== MOD || !(k in settings)) throw new Error("no setting"); return settings[k]; } },
  modules: new Map([[MOD, { active: true }], ["moinen-maps", maps]]), socket: { on() {}, emit() {} } };

class Base {
  constructor(id) { this.id = id; this.documentName = "Combat"; this.flags = {}; this.round = 0; this.calls = []; }
  getFlag(m, k) { return this.flags?.[m]?.[k]; }
  async setFlag(m, k, v) { (this.flags[m] ??= {})[k] = v; }
  async unsetFlag(m, k) { delete this.flags?.[m]?.[k]; }
  _sortCombatants() { return 0; }
  async startCombat(...a) { this.calls.push(["startCombat", a.length]); this.round = 1; return this; }
  async nextTurn() { this.calls.push(["nextTurn"]); return this; }
  async rollInitiative() { this.calls.push(["rollInitiative"]); return this; }
  async endCombat() { this.calls.push(["endCombat"]); return this; }
}
CONFIG.Combat.documentClass = Base;
const Klass = await import("./combat-class.mjs");
ok(Klass.install() && Klass.installed(), "the class is installed");
const Own = CONFIG.Combat.documentClass;
const tactical = () => { const T = new Table().hero("h1", "u1").npc("n1"); try { T.order(["h1", "n1"]); } catch { T.order(["n1", "h1"]); } return S.serialize(T.state); };

/* ---------------- A. the class */
{
  const c = new Own("c1");
  await c.startCombat();
  eq(c.calls[0], ["startCombat", 0], "A1: Begin Combat (a bare startCombat()) is the wrapped class's start: an ordinary fight");
  ok(!c.flags[MOD]?.tactics, "A2: an ordinary fight carries no tactical state");
  await c.rollInitiative(["x"]); await c.nextTurn(); await c.endCombat();
  eq(c.calls.slice(1).map((x) => x[0]), ["rollInitiative", "nextTurn", "endCombat"], "A3: an ordinary fight rolls initiative, turns and ends as core does");
  const d = new Own("c2");
  await d.rollInitiative(["x"]);
  eq(d.calls.map((x) => x[0]), ["rollInitiative"], "A4: before the start the GM may roll: nobody knows yet which kind the fight will be");
  const e = new Own("c3"); e.flags[MOD] = { tactics: { state: tactical() } };
  await e.rollInitiative(["x"]);
  ok(!e.calls.some((x) => x[0] === "rollInitiative"), "A5: in a tactical fight rolling initiative does nothing (the cards are dealt)");
  settings.tacticsInitiative = false;
  const f = new Own("c4");
  await f.startCombat(Klass.TACTICAL);
  eq(f.calls[0], ["startCombat", 0], "A6: without the own initiative even the tactical start is the wrapped class's");
  settings.tacticsInitiative = true;
  ok(Object.isFrozen(Klass.TACTICAL) && Klass.TACTICAL.tactics === true, "A7: TACTICAL is the one option of the tactical start");
}

/* ---------------- B. the tracker field */
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.parentElement = null; this.dataset = {}; this.attrs = {}; this.className = ""; this.listeners = {}; this.innerHTML = ""; }
  get classList() { const el = this; return { add: (k) => { if (!el.className.split(" ").includes(k)) el.className = `${el.className} ${k}`.trim(); }, contains: (k) => el.className.split(" ").includes(k) }; }
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k] ?? null; } removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(ev, fn) { this.listeners[ev] = fn; }
  append(...ks) { for (const k of ks) { k.parentElement = this; this.children.push(k); } }
  _at(k, off) { const p = this.parentElement, i = p.children.indexOf(this); k.parentElement = p; p.children.splice(i + off, 0, k); }
  before(k) { this._at(k, 0); } after(k) { this._at(k, 1); }
  _all() { return this.children.flatMap((k) => [k, ...k._all()]); }
  _match(sel) { if (sel === '[data-action="startCombat"]') return this.dataset.action === "startCombat"; if (sel.startsWith(".")) return this.className.split(" ").includes(sel.slice(1)); return false; }
  querySelector(sel) { return this._all().find((k) => k._match(sel)) ?? null; }
}
globalThis.HTMLElement = El;
globalThis.document = { createElement: (tag) => new El(tag) };
const tracker = () => { const root = new El("section"), nav = new El("nav"), begin = new El("button"); nav.className = "combat-controls"; begin.dataset.action = "startCombat"; root.append(nav); nav.append(begin); return { root, nav, begin }; };
{
  const c = new Own("c5");
  const { root, nav, begin } = tracker();
  Klass.startField({ viewed: c }, root);
  const row = nav.children[0], kids = row?.children ?? [];
  eq([nav.children.length, row?.className, nav.children[1] === begin], [2, "itac-start", true], "B1: a row of its own above Begin Combat");
  eq(kids.map((k) => k.className.split(" ").find((x) => x.startsWith("itac-"))), ["itac-surprise", "itac-tactics", "itac-surprise"], "B2: the Tactics button with the surprise toggles at its sides");
  const go = kids[1];
  ok(go.className.includes("ipu-btn") && go.dataset.kind === "main" && go.dataset.tooltipClass === "ipu-tip", "B3: the kit's yellow main button with the kit's tooltip");
  ok(/<span>Tactics<\/span>/.test(go.innerHTML) && go.attrs["aria-label"] && /<strong>Tactics<\/strong>/.test(go.dataset.tooltip), "B4: labelled Tactics, named for a screen reader, explained in the tooltip");
  ok(nav.className.includes("itac-has-start"), "B5: the controls row is marked so the two starts stack");
  Klass.startField({ viewed: c }, root);
  eq(nav.children.length, 2, "B6: drawn once per render");
  let asked = null; c.startCombat = async (o) => { asked = o; return c; };
  await go.listeners.click({ preventDefault() {}, stopPropagation() {} });
  eq([asked, go.attrs["aria-disabled"]], [Klass.TACTICAL, undefined], "B7: a click is the tactical start, and the button is usable again after it");
  delete c.startCombat;
  for (const [why, set, undo] of [["a player", () => { game.user = player; }, () => { game.user = gm; }], ["a started fight", () => { c.round = 1; }, () => { c.round = 0; }], ["no own initiative", () => { settings.tacticsInitiative = false; }, () => { settings.tacticsInitiative = true; }]]) {
    set(); const t = tracker(); Klass.startField({ viewed: c }, t.root); undo();
    eq(t.nav.children.length, 1, `B8: nothing is drawn for ${why}`);
  }
}

/* ---------------- C. the map's rules follow the fight on the table */
{
  const Z = { driver: null, cfg: {} };
  maps.active = true;
  maps.api.zones = { zoneOfToken: () => null, range: () => null, beforeStep: () => () => {}, tactical: (cfg) => { Z.cfg.tactical = cfg === false ? null : cfg; return true; }, rulesDriver: (cfg, only) => { if (cfg === false) { if (only == null || Z.driver?.id === only) Z.driver = null; } else Z.driver = cfg; return true; } };
  const Mv = await import("./movement.mjs");
  let st = null;
  const h = { cid: () => null, c: () => null, state: () => st, facts: () => ({}), request: async () => ({ ok: true }) };
  ok(Mv.install(h) && Z.driver === null, "C1: with no fight on the table the map keeps its own fire round and wrecking numbers");
  st = { mode: "tactical" }; eq([Mv.drive(), Z.driver?.id], [true, MOD], "C2: a tactical fight on the table: this module runs the map's rules");
  st = { mode: "off" }; eq([Mv.drive(), Z.driver], [false, null], "C3: the engine switched off: the map's own again");
  st = { mode: "free" }; Mv.drive(); st = null; eq([Mv.drive(), Z.driver], [false, null], "C4: an ordinary fight (no state) or the fight's end: the map's own");
  Z.driver = { id: "other" }; Mv.drive(); eq(Z.driver?.id, "other", "C5: another driver in charge is not stepped down by this module");
  Mv.uninstall();
}

/* ---------------- D. the words */
{
  const { EN, PL } = await import("./lang.mjs");
  for (const k of ["ITAC.ui.start.tactics", "ITAC.ui.start.aria", "ITAC.ui.start.tip"]) ok(typeof EN[k] === "string" && typeof PL[k] === "string" && EN[k] && PL[k], `D1: ${k} in both languages`);
  eq([EN["ITAC.ui.start.tactics"], PL["ITAC.ui.start.tactics"]], ["Tactics", "Tactics"], "D2: the label is Tactics, as the user wrote it");
  ok(/Tactics/.test(EN["ITAC.Settings.tacticsEnabled.Hint"]) && /Tactics/.test(PL["ITAC.Settings.tacticsEnabled.Hint"]), "D3: the setting's hint names the button");
  ok(/Tactics/.test(EN["ITAC.ui.surprise.off"]) && /Tactics/.test(PL["ITAC.ui.surprise.off"]), "D4: the surprise toggles point at the Tactics start");
}
done("check-tacb");
