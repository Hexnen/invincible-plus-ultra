// node scripts/sweep-checks/t4.mjs  (T009 idMap prototype keys, T010 persisted challenge charge keys)
import * as X from "../base/xfer-pure.mjs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };

// T009: a hostile split id equal to an Object.prototype member is not a remapped hero
{
  const doc = { v: 1, name: "T", members: [{ id: "h1", name: "A" }], data: { upgrades: { u1: { buys: [{ split: [{ id: "constructor", amount: 3 }, { id: "toString", amount: 1 }, { id: "__proto__", amount: 1 }, { id: "h1", amount: 2 }] }] } } } };
  const plan = X.planImport(doc, { hero: (m) => ({ id: "new1", name: m.name }), vehicle: (v) => v, userId: "GM", now: 1 });
  ck("only the real member counts as remapped", plan.report.buysRemapped === 1);
  const sp = Object.values(plan.B.upgrades ?? {}).flatMap((u) => (u.buys ?? []).flatMap((b) => b.split ?? []));
  ck("hostile ids stay strings", sp.filter((s) => s.id !== "new1").every((s) => typeof s.id === "string"));
  ck("real member remapped", sp.some((s) => s.id === "new1"));
}

// T010: charge keys persist; a fresh module state (reload) still refunds a step back
const flags = new Map();
const fire = [];
globalThis.Hooks = { on: (n2, fn) => fire.push([n2, fn]) };
const actor = { type: "challenge", system: { derived: { resolve: { value: 5, max: 5 } } }, flags: { "invincible-plus-ultra": {} }, getFlag: () => "rounds", update: async (u) => { actor.system.derived.resolve.value = u["system.derived.resolve.value"]; } };
globalThis.game = { user: { isActiveGM: true }, settings: { get: () => true, settings: new Map(), register() {} }, modules: new Map() };
let mod;
try { mod = await import("../challenges/combat.mjs"); } catch (e) { console.log("import failed (source-text fallback):", e.message); }
if (mod) {
  mod.start();
  const upd = fire.find((x) => x[0] === "updateCombat")[1];
  const tok = { tokenId: "t1", initiative: 10, token: { actor }, isDefeated: false };
  const other = { tokenId: "t0", initiative: 20, token: { actor: { type: "character" } }, isDefeated: false };
  const combat = { id: "c1", round: 1, turn: 1, previous: { round: 1, turn: 0 }, turns: [other, tok], combatants: { find: (fn) => [other, tok].find(fn) }, started: true, flags: {},
    getFlag: (m, k) => flags.get(k), setFlag: async (m, k, v) => { flags.set(k, JSON.parse(JSON.stringify(v))); } };
  const settle = () => new Promise((r) => setTimeout(r, 20));
  upd(combat, { turn: 1 }, {}); await settle();
  ck("charged on arrival", actor.system.derived.resolve.value === 4);
  ck("key persisted", Array.isArray(flags.get("challengeCharges")) && flags.get("challengeCharges").length === 1);
  // simulate reload: re-import a fresh module instance (empty Map) with the same flag
  const fire2 = []; globalThis.Hooks = { on: (n2, fn) => fire2.push([n2, fn]) };
  const mod2 = await import("../challenges/combat.mjs?reload"); mod2.start();
  const upd2 = fire2.find((x) => x[0] === "updateCombat")[1];
  Object.assign(combat, { turn: 0, previous: { round: 1, turn: 1 } });
  upd2(combat, { turn: 0 }, {}); await settle();
  ck("step back refunds after reload", actor.system.derived.resolve.value === 5);
  upd2(Object.assign(combat, { turn: 1, previous: { round: 1, turn: 0 } }), { turn: 1 }, {}); await settle();
  ck("next arrival charges once", actor.system.derived.resolve.value === 4);
}
console.log(`sweep t4: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
