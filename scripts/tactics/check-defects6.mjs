// node scripts/tactics/check-defects6.mjs -- the defects D50-D60 of dev/combat-defects.md (adversary 6: the fight played on the map:
// previews against the resolution, the per-target answer, the GM's corrections from the map, the armed intention, the warnings), D79
// (adversary 7, the consumer side of the area preview) and the items of the "unproven" list that were proved, each turned into a
// check that fails on the tree the adversary reviewed and passes on the fix. Scripted table, no Foundry.
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import { MTable } from "./check-kit-map.mjs";
import * as R from "./relay-pure.mjs";
import * as V from "./view-pure.mjs";
import * as K from "./kit-pure.mjs";
import * as M from "./mods-pure.mjs";
import * as Lg from "./ledger-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as D from "./desk-pure.mjs";
import * as MP from "./movement-pure.mjs";
import * as Hz from "./flows/hazards.mjs";
import * as UI from "./ui/model-pure.mjs";
import * as BP from "./ui/board-pure.mjs";
import * as Keys from "./ui/keys-pure.mjs";
import { dice } from "../rules/index.mjs";
import { EN, PL, t as T0 } from "./lang.mjs";

globalThis.game = { ...(globalThis.game ?? {}), i18n: { lang: "en" } };
const code = (env) => env?.error?.code ?? (env?.ok ? (env.changed === false ? "ok(unchanged)" : "ok") : "?");
const why = (env) => env?.error?.params?.reason ?? null;
const decl = (actor, action, extra = {}) => ({ op: "declare", actor, decl: { action, ...extra } });
const tt = (k, p, fb) => fb ?? k;
const ids = (T, cid) => (T.state.statuses?.[cid] ?? []).map((s) => s.id).sort();
/* the table of check-defects5: a PLAYER's request goes through the relay's admission; characters carry items */
class T6 extends Table {
  constructor(o) { super(o); this.gate = new R.Gate(); this.seenRelay = new Map(); this.mid = 0; }
  async preq(userId, req) {
    const a = R.admit({ k: R.KIND.req, id: `m${++this.mid}`, n: "x", proto: R.PROTO, combat: "c", req }, { senderId: userId, user: (id) => (this.users[id] ? { id, staff: !!this.users[id].staff } : null), combatId: "c", gate: this.gate, now: this.now(), seen: this.seenRelay });
    if (!a.ok) return a.env;
    try { return R.wireEnv(await this.handle({ t: "req", user: a.user, rid: a.rid, req: a.req })); } finally { this.gate.release(userId, false, R.isRead(a.req)); }
  }
  meta() { return { hidden: Object.values(this.c).filter((x) => x.hidden).map((x) => x.id), npc: Object.values(this.c).filter((x) => x.npc).map((x) => x.id) }; }
  viewer(userId) { return { id: userId, staff: !!this.users[userId]?.staff, owns: Object.values(this.c).filter((x) => x.owners.includes(userId)).map((x) => x.id) }; }
  view(userId) { return V.viewFor(this.state, this.viewer(userId), this.meta()); }
  give(cid, items, bonus = {}) { const c = this.c[cid]; c.src = items; c.kit = K.build({ items, attrs: c.attrs }); c.pass = c.kit.pass; c.bonus = bonus; return this; }
  kit() { for (const k of Object.keys(this.c)) if (!this.c[k].kit) this.give(k, []); return this; }
  facts() { const f = super.facts(), T = this; return { ...f, canTalk: () => true, weapon: (cid, ref) => (ref == null || ref === "unarmed" ? { ...f.weapon(cid, ref), ...(T.c[cid]?.kit?.unarmed ?? {}) } : T.c[cid]?.kit?.weapons.find((w) => w.id === ref) ?? f.weapon(cid, ref)) }; }
}
const pv = (T, user, actor, d, extra = {}) => (user === "gm" ? T.gm({ op: "preview", actor, decl: d, ...extra }) : T.preq(user, { op: "preview", actor, decl: d, ...extra }));
const settle = async (T) => { for (let n = 0; n < 20 && T.prompts().length; n++) { const p = T.prompts()[0]; await T.gm({ op: "answerFor", prompt: p.id, value: p.multi ? [] : (p.options.find((o) => o.id === "pass" || o.id === "none") ?? p.options.find((o) => !o.disabled)).id }); } };
const ctxOf = (T) => ({ c: (id) => T.c[id] ?? null, online: () => true, P1 });

/* ================================================================== D50: the effect preview is the damage step to its end: the copies
   of Duplication take the damage first [B1910] */
{
  const mk = () => { const T = new T6(); T.hero("H1", "p1").hero("H2", "p2", { health: 6 }).npc("N1", { health: 6 }); T.kit(); T.order(["H1", "H2", "N1"]); return T; };
  const T = mk();
  await T.gm({ op: "effectAdd", effect: { kind: "copies", holder: "H2", data: { n: 3 }, source: { kind: "gm", name: "Duplication" }, ends: { at: "sceneEnd" } } });
  const hit = (await pv(T, "p1", "H1", { action: "slugfest" }, { of: ["H2"] })).preview.per.H2.hit, w = BP.hitWords(hit, T0);
  await T.preq("p1", decl("H1", "slugfest", { targets: ["H2"] })); await settle(T); if (T.top()) await T.roll("attack", 1); await settle(T);
  const ev = T.evs("damage").pop();
  eq([hit.taken, hit.copies], [ev.taken, 3 - (T.state.effects.find((e) => e.kind === "copies")?.data?.n ?? 0)], "D50: the preview's Health loss and the copies' part are what the hit then took");
  eq([w.short, w.bar.loss, /copies/i.test(w.tip), /Health -/.test(w.tip)], ["0", 0, true, false], "D50: with copies standing the bar loses nothing and the tip says who takes it");
  const w2 = BP.hitWords({ base: 6, toStress: false, taken: 3, most: 9, copies: 3, now: 6, max: 6 }, T0);
  eq([w2.short, w2.bar.loss, /copies take 3/i.test(w2.tip)], ["-3", 3, true], "D50: damage beyond the copies goes on to Health, both said");
  const U = mk();
  await U.gm({ op: "effectAdd", effect: { kind: "copies", holder: "N1", data: { n: 3 }, source: { kind: "gm", name: "Duplication" }, ends: { at: "sceneEnd" } } });
  const hn = (await pv(U, "p1", "H1", { action: "slugfest" }, { of: ["N1"] })).preview.per.N1.hit;
  eq([Object.keys(hn).sort(), JSON.stringify(hn).includes("copies")], [["base", "toStress"], false], "D50: of an NPC that is not revealed a player learns nothing of its copies");
  eq((await pv(U, "gm", "H1", { action: "slugfest" }, { of: ["N1"] })).preview.per.N1.hit.copies, 2, "D50: the GM does");
}
/* ================================================================== D51: the line for an NPC that is not revealed claims no bound */
{
  const T = new T6(); T.hero("H1", "p1").npc("N1", { vulnerabilities: ["kinetic"], armor: [{ id: "a", armor: 1 }], health: 9 }); T.kit(); T.order(["H1", "N1"]);
  const hit = (await pv(T, "p1", "H1", { action: "slugfest" }, { of: ["N1"] })).preview.per.N1.hit, w = BP.hitWords(hit, T0);
  await T.preq("p1", decl("H1", "slugfest", { targets: ["N1"] })); await settle(T); if (T.top()) await T.roll("attack", 1); await settle(T);
  ok(T.evs("damage").pop().taken > hit.base, "D51: (a Vulnerable target takes more than the Damage of the attack)");
  ok(!/up to|≤/i.test(`${w.short} ${w.tip}`) && w.tip.includes(String(hit.base)), "D51: the line names the Damage of the attack and no upper bound");
  for (const [L, lang] of [[EN, "en"], [PL, "pl"]]) ok(!("ITAC.map.hit.upTo" in L) && !/up to| do \{n\}/i.test(L["ITAC.map.hit.base"]), `D51: ${lang}: no 'up to' in the text`);
}
/* ================================================================== D52: full auto on the map: the dice over each token are the dice
   of the one roll [B2543]; a candidate in another zone than the chosen ones is refused before "Declare" */
{
  const smg = { id: "smg", name: "SMG", bonus: 1, damage: 2, range: [0, 2], fullAuto: true };
  const mk = (z3) => { const T = new T6(); T.hero("H1", "p1").npc("N1").npc("N2").npc("N3", { zone: z3 }).npc("N4", { hidden: true }); T.weapons.smg = smg; T.order(["H1", "N1", "N2", "N3", "N4"]); return T; };
  const fa = { action: "shoot", weapon: "smg", fullAuto: true };
  const panel = async (T, user, staff, targets) => {
    const asked = [], view = staff ? T.state : T.view(user), answers = {};
    const facts = { view, me: user, staff, c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc, img: null } : null), attrs: (id) => (staff || !T.c[id]?.npc ? T.c[id].attrs : null), userName: (u) => u, weapons: () => [smg],
      preview: (cid, d) => T.preview(user, cid, d), board: true, onMap: () => true, reach: (cid, d, of) => { asked.push(d); return answers[JSON.stringify(d)] ?? null; } };
    const model = () => (staff ? { bars: [D.barModel(T.state, "H1", ctxOf(T))], prompts: [], mine: [], stack: [], waiting: [], turn: "" } : D.playerModel(view, { id: user, owns: ["H1"] }, ctxOf(T)));
    const own = { armed: "shoot", targets, weapon: "smg", opts: { fullAuto: true } };
    UI.dockData(model(), own, facts, T0);                                                    // the first build asks; the answer is the engine's for that very question
    const q = asked.at(-1);
    answers[JSON.stringify(q)] = (await pv(T, staff ? "gm" : user, "H1", q, { of: ["N1", "N2", "N3"] })).preview.per;
    return { p: UI.dockData(model(), own, facts, T0).panel, q };
  };
  {
    const T = mk("z1"), { p, q } = await panel(T, "gm", true, ["N1", "N2", "N3"]);
    eq((q.targets ?? []).slice().sort(), ["N1", "N2", "N3"], "D52: the question about who is in reach names the targets already chosen");
    const marks = BP.reachMarks(p, T0);
    await T.gm(p.submit.req); await settle(T);
    const rolled = T.lastRequest()?.dice, pct = `${Math.round(dice.pSuccess(rolled) * 100)}%`;
    eq([p.pool.total, marks.map((m) => m.tip?.match(/\d+%/)?.[0]), new Set(marks.map((m) => m.meter?.n)).size], [rolled, [pct, pct, pct], 1], "D52: the chance at each chosen token is the chance of the roll that is made (U133: the per cent in the tip, the same quarters on each)");
    const one = (await pv(mk("z1"), "gm", "H1", fa, { of: ["N1"] })).preview.per.N1.dice, two = (await pv(mk("z1"), "gm", "H1", { ...fa, targets: ["N2"] }, { of: ["N1", "N2"] })).preview.per;
    eq([one, two.N1.dice, two.N2.dice], [4, 3, 4], "D52: one target: the full pool; a second one would cost a die (said over the candidate that would be the second)");
    eq((await pv(mk("z1"), "gm", "H1", { action: "shoot", weapon: "smg", targets: ["N2"] }, { of: ["N1"] })).preview.per.N1.dice, 4, "D52: a declaration of one target is asked about each candidate alone");
  }
  {
    const T = mk("z2"), { p } = await panel(T, "p1", false, ["N1"]);
    const by = Object.fromEntries(p.targets.map((x) => [x.id, x]));
    eq([by.N1.reach, by.N2.reach, by.N3.reach, /zone/i.test(by.N3.why ?? "")], ["in", "in", "out", true], "D52: with one target chosen, a candidate in another zone is out of reach with the reason");
    const both = (await panel(T, "p1", false, ["N1", "N3"])).p;
    eq([!!both.submit.req, !!both.refused, code(await T.preq("p1", decl("H1", "shoot", { weapon: "smg", fullAuto: true, targets: ["N1", "N3"] })))], [false, true, "illegal"], "D52: chosen all the same: refused in the panel at once, Declare is not offered (the engine would refuse it)");
    const a = (await pv(T, "p1", "H1", fa, { of: ["N1", "N2"] })).preview.per, b = (await pv(T, "p1", "H1", { ...fa, targets: ["N4", "nobody"] }, { of: ["N1", "N2"] })).preview.per;
    eq(b, a, "D52: naming somebody hidden among the chosen ones changes no answer (no die less, no refusal)");
  }
}
/* ================================================================== D53: the GM's switch "Stunned" is the state: the mark and the lost
   next turn together [B2436], [R10] */
{
  const sw = (cid, on) => BP.gmItems(cid, null, [], tt).find((x) => x.id === "st:stunned").req(on);
  const mk = () => { const T = new T6(); T.hero("H1", "p1").hero("H2", "p2").npc("N1"); T.kit(); T.order(["N1", "H1", "H2"]); return T; };
  {
    const T = mk();
    T.state = { ...T.state, ledger: { ...T.state.ledger, H1: Lg.loseNextTurn(T.state.ledger.H1, { kind: "stunt", name: "stun" }) } };
    await T.gm({ op: "statusAdd", combatant: "H1", status: { id: "stunned" } });
    eq(code(await T.gm(sw("H1", false))), "ok", "D53: the switch off is accepted");
    eq([ids(T, "H1"), !!T.state.ledger.H1.lostTurn, !!M.conditions(T.state, "H1").noInterrupts], [[], false, false], "D53: off: the mark, the lost turn and the ban on defences go together");
    await T.gm({ op: "nextTurn" });
    eq(T.state.init.curMember, "H1", "D53: the turn is not taken away any more");
  }
  {
    const T = mk();
    eq(code(await T.gm(sw("H1", true))), "ok", "D53: the switch on is accepted");
    eq([ids(T, "H1"), !!T.state.ledger.H1.lostTurn, !!M.conditions(T.state, "H1").noInterrupts], [["stunned"], true, true], "D53: on: the mark and the lost next turn");
    const tx = T.log.list.at(-1).id;
    await T.gm({ op: "nextTurn" });
    eq([T.state.init.curMember, ids(T, "H1")], ["H2", []], "D53: the stunned one loses its turn, and the mark ends with it");
    const U = mk(); await U.gm(sw("H1", true));
    eq([code(await U.gm({ op: "undo", tx: U.log.list.at(-1).id })), ids(U, "H1"), !!U.state.ledger.H1.lostTurn], ["ok", [], false], "D53: one undo takes both back");
    ok(typeof tx === "string", "D53: (one journal entry)");
  }
}
/* ================================================================== D54: no answer tells a player a number of an NPC that is not revealed */
{
  const mk = () => { const T = new T6(); T.hero("H1", "p1").hero("H2", "p2", { resolve: 5, maxResolve: 5 }).npc("N1", { resolve: 5, maxResolve: 5 }).npc("N2", { resolve: 5, maxResolve: 5 }); T.kit(); T.order(["H1", "N1", "N2", "H2"]); return T; };
  const T = mk();
  const ask = async (user = "p1") => Object.fromEntries(Object.entries((await pv(T, user, "H1", { action: "recoverResolve" }, { of: ["N1", "N2", "H2"] })).preview.per).map(([k, r]) => [k, r.ok ? "ok" : r.reason]));
  const before = await ask();
  T.c.N2.resolve = 4;
  const after = await ask();
  eq([before.N1, before.N2, after], ["notAlly", "notAlly", before], "D54: the per-target answer about an unrevealed NPC is the same whatever its Resolve");
  eq((await pv(T, "p1", "H1", { action: "slugfest" }, { at: "N2", acts: [{ action: "recoverResolve" }] })).preview.acts.recoverResolve.reason, "notAlly", "D54: so is the answer of the menu at its token");
  eq([before.H2, (await ask("gm")).N2, (await ask("gm")).N1], ["resolveFull", "ok", "resolveFull"], "D54: about a hero, and for the GM, the rule's own answer stands");
  eq([code(await T.preq("p1", decl("H1", "recoverResolve", { targets: ["N2"] }))), why(T.last), code(await T.preq("p1", decl("H1", "recoverResolve", { targets: ["N1"] }))), why(T.last)], ["illegal", "notAlly", "illegal", "notAlly"], "D54: a refused declaration tells nothing either: one reason for both");
  const cards = async (target) => { const X = mk(); X.c.N2.resolve = 4; const e = await X.preq("p1", decl("H1", "recoverResolve", { targets: [target], exception: { text: "please" } })); return [code(e), X.prompts("exception").length, X.top()?.status]; };
  eq(await cards("N2"), await cards("N1"), "D54: declared with a request for an exception both go to the GM's card, whatever the number");
  eq((await cards("N2"))[1], 1, "D54: (a card on the desk)");
  await T.gm({ op: "reveal", combatant: "N2", stats: true });
  eq((await ask()).N2, "ok", "D54: once the GM revealed its statistics the rule's own answer is the player's");
  eq(code(await T.gm(decl("H1", "recoverResolve", { targets: ["N1"] }))) === "illegal" && why(T.last), "resolveFull", "D54: the GM's own hand meets the rule, not the gate");
}
/* ================================================================== D55: a free placement that separates a pair ends the grapple */
{
  const T = new T6(); T.hero("H1", "p1").npc("N1").npc("N2", { zone: "z3" }); T.kit(); T.order(["H1", "N1", "N2"]);
  await T.preq("p1", decl("H1", "grapple", { targets: ["N1"] })); await settle(T); if (T.top()) await T.roll("attack", 2); await settle(T);
  eq([ids(T, "H1"), ids(T, "N1")], [["grappling"], ["grappled"]], "D55: (H1 holds N1)");
  const place = (zone, range) => { T.c.N1.zone = zone; T.setRange("H1", "N1", range); return T.gm({ op: "placed", combatant: "N1", inverse: { op: "tokens", rows: [{ id: "N1", x: 0, y: 0, alt: null, floor: null, air: null }] }, zone }); };
  eq([code(await place("z1", 0)), ids(T, "H1"), ids(T, "N1")], ["ok", ["grappling"], ["grappled"]], "D55: put down in the holder's own zone the pair stays");
  eq([code(await place("z3", 3)), ids(T, "H1"), ids(T, "N1")], ["ok", [], []], "D55: put down somewhere else the grapple is over for both");
  T.c.N1.zone = "z1"; T.setRange("H1", "N1", 0);
  eq([code(await T.gm({ op: "undo", tx: T.log.list.at(-1).id })), ids(T, "H1"), ids(T, "N1")], ["ok", ["grappling"], ["grappled"]], "D55: undo of the placement restores both");
}
/* ================================================================== D56: the warnings read the LEVEL of the spot, as the engine does */
{
  class HT extends Table {
    constructor() { super(); this.map = { zones: { z1: {}, z2: {} }, borders: [{ id: "z1|z2", a: "z1", b: "z2", wall: null, door: null }], registry: {} }; }
    facts() {
      const f = super.facts(), T = this, lv = (cid) => T.c[cid].level ?? "ground";
      const place = (cid) => (T.c[cid] ? { zone: T.c[cid].zone, level: lv(cid), spot: lv(cid) === "ground" ? T.c[cid].zone : `${T.c[cid].zone}:${lv(cid)}`, area: null } : null);
      const all = (key) => T.map.registry[String(key).split(":")[0]] ?? [];
      return { ...f, zones: { place, zone: (key) => (T.map.zones[key] ? { key, tags: [] } : null), statesAll: all, states: (spot) => { const [k, l = "ground"] = String(spot).split(":"); return all(k).filter((s) => !s.at || s.at === l); },
        graph: () => ({ zones: Object.keys(T.map.zones).map((id) => ({ id, flammable: false, tags: [] })), borders: T.map.borders }) } };
    }
  }
  const T = new HT(); T.hero("H1", "p1", { zone: "z1" }).hero("H2", "p2", { zone: "z2" }).npc("N1", { zone: "z2" }); T.c.N1.level = "elevated";
  T.order(["H1", "H2", "N1"]);
  T.map.registry.z1 = [{ id: "s1", kind: "fire", level: 8, at: "elevated" }];
  T.map.registry.z2 = [{ id: "s2", kind: "fire", level: 2, at: "ground" }, { id: "s3", kind: "fire", level: 8, at: "elevated" }];
  const Z = T.facts().zones, fm = BP.fireMap(Z), due = Hz.derived(T.state, T.facts(), { at: "roundStart" }).filter((g) => g.run.type === "fireAttack");
  const dueFor = (cid) => due.find((g) => g.run.targets.includes(cid))?.run.intensity ?? 0;
  for (const cid of ["H1", "H2", "N1"]) eq(BP.fireAt(fm, Z.place(cid).spot), dueFor(cid), `D56: the fire named under ${cid} is the fire that attacks ${cid} at the round start`);
  eq([BP.endWarnings(fm, Z.place("H1").spot, T.c.H1, Z, T0).length, BP.endWarnings(fm, Z.place("H2").spot, T.c.H2, Z, T0).map((w) => w.text), BP.endWarnings(fm, "z2:elevated", T.c.N1, Z, T0).map((w) => w.text)],
    [0, [T0("ITAC.map.warn.fire", { n: 2 })], [T0("ITAC.map.warn.fire", { n: 8 })]], "D56: no warning under a fire upstairs; the ground's own intensity on the ground; the upper one upstairs");
  eq([BP.zoneHazards(fm, ["z1"], "z1", T.c.H2, Z, T0).length, BP.zoneHazards(fm, ["z1:elevated"], "z1:elevated", T.c.H2, Z, T0).some((h) => h.text === T0("ITAC.map.haz.fire", { n: 8 }))], [0, true], "D56: a walk on the ground under the fire names none; a way up into it does");
}
/* ================================================================== D57: fire attacks on ENTERING; nothing attacks on the way out */
{
  const run = async (from, to, burning, fly = false) => {
    const T = new MTable(); T.hero("H1", "p1").npc("N1"); if (fly) T.c.H1.movement = [{ mode: "flight", tier: "basic" }];
    T.put("H1", from).put("N1", "z4"); T.order(["H1", "N1"]).turn("H1");
    T.map._.states[burning] = [{ kind: "fire", level: 6, id: "f1" }];
    const Z0 = T.facts().zones, Z = { ...Z0, graph: () => { const g = Z0.graph(); return { ...g, zones: g.zones.map((z) => ({ ...z, id: z.key })) }; } };
    const fm = BP.fireMap(Z), o = MP.moveOptions(Z0, T.state, "H1", T.c.H1).find((x) => x.zone === to);
    const said = (zones) => BP.zoneHazards(fm, zones, o.to, T.c.H1, Z, T0).map((h) => [h.zone, h.text]);
    const byRoute = said(o.route ?? [o.zone]), byEnters = said(o.enters);
    await T.req("p1", { op: "declare", actor: "H1", decl: { action: "move", to: o.to, mode: o.mode } });
    return { o, byRoute, byEnters, fire: T.performed.filter((e) => e.t === "dice" && String(e.why).startsWith("fire")).map((e) => e.n) };
  };
  const a = await run("z1", "z2", "z2"), enter = T0("ITAC.map.haz.fire", { n: 6 });
  eq([a.fire, a.byEnters.filter((x) => x[1] === enter).map((x) => x[0]), a.byEnters.some((x) => x[1] === T0("ITAC.map.warn.fire", { n: 6 }))], [[6], ["z2"], true], "D57: into a burning zone: the preview says the fire attacks on entering (as it does), besides the round-start warning");
  eq(a.byRoute, a.byEnters, "D57: the same from the route of zone keys");
  ok(Array.isArray(a.o.enters) && !a.o.enters.includes("z1") && a.o.enters.at(-1) === a.o.to, "D57: a way of moving carries the spots it enters (never the one it leaves)");
  const b = await run("z1", "z2", "z1");
  eq([b.fire, b.byRoute.filter((x) => x[0] === "z1"), b.byEnters.filter((x) => x[0] === "z1")], [[], [], []], "D57: out of a burning zone: nothing attacks and nothing is named for the zone left");
  const c = await run("z1", "z3", "z2", true);
  eq([c.fire, c.byEnters.filter((x) => x[1] === enter).map((x) => x[0])], [[6], ["z2"]], "D57: fire in a zone passed on the way is named there");
  for (const L of [EN, PL]) ok(L["ITAC.map.haz.fire"].replace("{n}", "12").length <= 28 && !!L["ITAC.map.haz.fire.tip"], "D57: the chip is short and has its tip in both languages");
}
/* ================================================================== D59: the Health stepper corrects the state with the number [B2707] */
{
  const T = new T6(); T.hero("H1", "p1", { damage: 9 }).npc("N1", { health: 3 }).npc("N2"); T.kit(); T.order(["H1", "N1", "N2"]);
  await T.preq("p1", decl("H1", "slugfest", { targets: ["N1"] }));
  for (let n = 0; n < 30; n++) { const p = T.prompts()[0]; if (p) await T.gm({ op: "answerFor", prompt: p.id, value: (p.options.find((o) => ["pass", "none", "ko"].includes(o.id)) ?? p.options[0]).id }); else if (T.top()?.rolls?.attack && T.top().rolls.attack.sixes == null) await T.roll("attack", 1); else break; }
  eq([T.c.N1.health, ids(T, "N1")], [0, ["broken", "unconscious"]], "D59: (N1 is broken and knocked out)");
  const items = BP.gmItems("N1", { health: 0, maxHealth: 3, resolve: 5, maxResolve: 5 }, T.state.statuses.N1, tt), up = items.find((x) => x.id === "health").req(3);
  eq([up, code(await T.gm(up)), T.c.N1.health, ids(T, "N1"), BP.tableShow(T.state, { c: (id) => T.c[id], staff: true, hidden: () => false }, tt).marks.filter((m) => m.cid === "N1")], [{ op: "setHealth", combatant: "N1", delta: 3 }, "ok", 3, [], []], "D59: stepped up from 0: no longer broken or knocked out, no mark left");
  await T.gm({ op: "nextTurn" });
  eq(T.state.init.curMember, "N1", "D59: and it takes its turn");
  eq([code(await T.gm({ op: "undo", tx: T.log.list.find((x) => /setHealth|Health/.test(JSON.stringify(x.label ?? "")))?.id ?? T.log.list.at(-1).id })) !== "?", true], [true, true], "D59: (the correction is an entry of the journal)");
  const U = new T6(); U.hero("H1", "p1").npc("N1", { health: 3 }).npc("N2"); U.kit(); U.order(["H1", "N1", "N2"]);
  await U.preq("p1", decl("H1", "grapple", { targets: ["N1"] })); await settle(U); if (U.top()) await U.roll("attack", 2); await settle(U);
  const down = BP.gmItems("N1", { health: 3, maxHealth: 3, resolve: 5, maxResolve: 5 }, [], tt).find((x) => x.id === "health").req(0);
  eq([code(await U.gm(down)), U.c.N1.health, ids(U, "N1"), ids(U, "H1"), U.prompts().length], ["ok", 0, ["broken"], [], 0], "D59: stepped down to 0: broken, let go of, nobody asked (the GM's word)");
  eq([code(await U.gm({ op: "undo", tx: U.log.list.at(-1).id })), U.c.N1.health, ids(U, "N1"), ids(U, "H1")], ["ok", 3, ["grappled"], ["grappling"]], "D59: one undo takes the number and the state back");
  /* the steppers send steps: what happened since the menu opened is kept */
  const W = new T6(); W.hero("H1", "p1").npc("N1", { health: 6 }); W.kit(); W.order(["H1", "N1"]);
  const st = BP.gmItems("N1", { health: 6, maxHealth: 6, resolve: 5, maxResolve: 5 }, [], tt).find((x) => x.id === "health");
  W.c.N1.health = 2;                                                                          // a hit lands while the menu stands open
  eq([code(await W.gm(st.req(5))), W.c.N1.health, code(await W.gm(st.req(6, 5))), W.c.N1.health], ["ok", 1, "ok", 2], "P8f: a step down is a step from what the character has now (not 'the number on the stale menu')");
  eq([code(await W.gm({ op: "setHealth", combatant: "N1", delta: 99 })), W.c.N1.health, code(await W.gm({ op: "setHealth", combatant: "N1", delta: -99 })), W.c.N1.health, code(await W.gm({ op: "setHealth", combatant: "N1", value: 4 })), W.c.N1.health], ["ok", 6, "ok", 0, "ok", 4], "P8f: a step stays inside 0 .. maximum; an absolute value is still taken");
  eq(code(await W.preq("p1", { op: "setHealth", combatant: "N1", delta: 1 })) === "ok", false, "P8f: (never from a player)");
}
/* ================================================================== D60: the chance "if they defend" is counted from the engine's defence pool */
{
  const T = new T6(); T.hero("H1", "p1").npc("N1"); T.give("H1", []).give("N1", [], { fighting: 3 }); T.order(["H1", "N1"]);
  const panel = (per, staff, user, extra = {}) => {
    const view = staff ? T.state : T.view(user);
    const facts = { view, me: user, staff, c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc, img: null } : null), attrs: (id) => (staff || !T.c[id]?.npc || view.revealed?.[id]?.stats ? T.c[id].attrs : null), userName: (u) => u, weapons: () => [], preview: (cid, d) => T.preview(user, cid, d), board: true, onMap: () => true, reach: () => per, ...extra };
    return UI.dockData(staff ? { bars: [D.barModel(T.state, "H1", ctxOf(T))], prompts: [], mine: [], stack: [], waiting: [], turn: "" } : D.playerModel(view, { id: user, owns: ["H1"] }, ctxOf(T)), { armed: "slugfest", targets: ["N1"] }, facts, T0).panel;
  };
  const per = (await pv(T, "gm", "H1", { action: "slugfest" }, { of: ["N1"] })).preview.per, mark = BP.reachMarks(panel(per, true, "gm"), T0)[0];
  const pp = (await pv(T, "p1", "H1", { action: "slugfest" }, { of: ["N1"] })).preview.per;
  const U = new T6(); U.hero("H1", "p1").npc("N1"); U.give("H1", []).give("N1", [], { fighting: 3 }); U.order(["H1", "N1"]);
  await U.gm(decl("H1", "slugfest", { targets: ["N1"] }));
  const g = U.prompts("reaction")[0].data.gm, real = `${Math.round(dice.pHit(g.att.dice, g.def.block) * 100)}%`;
  eq([per.N1.def.block, per.N1.dice], [g.def.block, g.att.dice], "D60: the answer per target carries the defence pool of the roll (the reaction card's number)");
  ok(mark.tip.includes(real) && !mark.tip.includes(`${Math.round(dice.pHit(g.att.dice, T.c.N1.attrs.fighting) * 100)}%`), `D60: the tooltip's defended chance is the engine's (${real}), not the bare attribute's`);
  eq(["def" in pp.N1, BP.reachMarks(panel(pp, false, "p1"), T0)[0].tip?.includes(T0("ITAC.ui.ifDefends", { how: T0("ITAC.action.block") })) ?? false], [false, false], "D60: a player gets no defence dice of an NPC that is not revealed, and no defended chance");
  await T.gm({ op: "reveal", combatant: "N1", stats: true });
  eq((await pv(T, "p1", "H1", { action: "slugfest" }, { of: ["N1"] })).preview.per.N1.def?.block, g.def.block, "D60: once revealed, the same number for the player");
  eq((await pv(T, "gm", "H1", { action: "slugfest", targets: ["N1"] })).preview.def?.block, g.def.block, "D60: the pool of a declaration with its one target carries it too (the panel's chance off the map)");
  const off = panel(null, true, "gm", { board: false, reach: () => null });
  ok(off.chance?.defended?.say === real, "D60: off the map the panel's defended chance is the same number");
}
/* ================================================================== the "unproven" list */
{ /* questions that change nothing do not use up the budget of the requests that act (relay-pure.Gate) */
  const T = new T6(); T.hero("H1", "p1").npc("N1"); T.kit(); T.order(["H1", "N1"]);
  let refused = 0;
  for (let i = 0; i < 120; i++) if (!(await T.preq("p1", { op: "preview", actor: "H1", decl: { action: "slugfest" }, of: ["N1"] })).ok) refused++;
  eq([refused, code(await T.preq("p1", decl("H1", "slugfest", { targets: ["N1"] })))], [0, "ok"], "P8f: 120 preview questions in a minute, and the declaration is still admitted");
  const g = new R.Gate(); let ok1 = 0, rate = 0;
  for (let i = 0; i < 200; i++) { const r = g.admit("p1", 1000 + i, false, true); if (r === "rate") rate++; else if (!r) ok1++; }
  eq([ok1, rate, g.admit("p1", 2000), g.flying.get("p1")], [R.LIMITS.readsPerMin, 200 - R.LIMITS.readsPerMin, null, 1], "P8f: a flood of questions is still stopped; questions are not counted as in flight");
  ok(R.isRead({ op: "preview" }) && !R.isRead({ op: "declare" }) && !R.isRead({ op: "answer" }), "P8f: only the preview is a question");
}
{ /* Tab and Shift+Tab walk what the engine said yes to */
  const p = { show: true, panel: { kind: "declare", reached: true, targets: [{ id: "A", reach: "in", picked: true }, { id: "B", reach: null }, { id: "C", reach: "out" }, { id: "E", reach: "in" }] } };
  eq([Keys.plan(p, {}, { key: "Tab" })?.target, Keys.plan(p, {}, { key: "Tab", shift: true })?.target], ["E", "E"], "P8f: neither Tab nor Shift+Tab lands on a target the engine gave no answer about");
  const q = { show: true, panel: { kind: "declare", reached: false, targets: [{ id: "A", reach: null, picked: true }, { id: "B", reach: null }] } };
  eq(Keys.plan(q, {}, { key: "Tab" })?.target, "B", "P8f: before any answer (no board) every candidate is walked, as before");
}
{ /* Alt-drop of a token whose move waits on the stack: the move ends where the GM put the token */
  const T = new MTable(); T.hero("H1", "p1", { attrs: { strength: 5 } }).npc("N1"); T.c.H1.movement = [{ mode: "flight", tier: "basic" }];
  T.put("H1", "z1").put("N1", "z4"); T.order(["H1", "N1"]).turn("H1");
  T.map._.states.z2 = [{ kind: "weather", data: { type: "storm" }, id: "s" }];
  await T.req("p1", { op: "move", actor: "H1", to: "z3", mode: "flight" });
  eq([T.prompt("moveStop")?.data.spot, T.spot("H1")], ["z2", "z2"], "P8f: (a move waits for the GM's word on the way)");
  T.put("H1", "z5");
  eq(code(await T.gm({ op: "placed", combatant: "H1", inverse: { op: "tokens", rows: [{ id: "H1", x: 0, y: 0 }] }, zone: "z5" })), "ok", "P8f: the GM puts the mover somewhere else by hand");
  await T.answer("gm", "moveStop", "continue");
  eq([T.spot("H1"), T.state.stack.length, !!T.evs("move").pop()?.stopped], ["z5", 0, true], "P8f: the old route is not walked from the new place: the move ends there, stopped");
}
/* ================================================================== D58, D79 and the area's own filter: ui/board.mjs over a recording map */
{
  const T = new MTable(); T.hero("H1", "p1", { name: "Ada" }).hero("H2", "p2", { name: "Rex" }).npc("N1", { name: "Thug", health: 9 }).npc("N2", { name: "Ghost", health: 9, hidden: true }).npc("N3", { name: "Up", health: 9 });
  T.put("H1", "z1").put("H2", "z2").put("N1", "z2").put("N2", "z2").put("N3", "z2:elevated"); T.order(["H1", "N1", "H2", "N2", "N3"]).turn("H1");
  T.weapons.blast = { id: "blast", name: "Blast", bonus: 0, damage: 2, range: [0, 2], area: true };
  const calls = [], rec = (name, ret) => (...a) => { calls.push([name, ...a]); return typeof ret === "function" ? ret(...a) : ret; };
  Object.assign(T.map, { markTokens: rec("markTokens", "id"), clearTokenMarks: rec("clearTokenMarks", 1), link: rec("link", "id"), clearLinks: rec("clearLinks", 1), areaPreview: rec("areaPreview", {}), clearArea: rec("clearArea", 1),
    warn: rec("warn", "id"), clearHighlights: rec("clearHighlights", 1), present: rec("present", {}), camera: rec("camera", { follow: "turn" }), intent: rec("intent", true), cancelPick: rec("cancelPick", true),
    pickMove: rec("pickMove", () => new Promise(() => {})), pickArea: rec("pickArea", () => new Promise(() => {})), menu: rec("menu", () => new Promise(() => {})), onContext: () => () => {} });
  /* the board's clock: timers of a second and more are kept here and run by hand; the short ones stay real */
  const realST = globalThis.setTimeout, realCT = globalThis.clearTimeout, clock = new Map(); let tn = 0;
  globalThis.setTimeout = (fn, ms, ...a) => { if (ms >= 1000) { const id = { fake: ++tn, unref() {} }; clock.set(id, { fn, ms }); return id; } return realST(fn, ms, ...a); };
  globalThis.clearTimeout = (id) => (id && typeof id === "object" && id.fake ? clock.delete(id) : realCT(id));
  const tick = () => { const due = [...clock]; for (const [id, x] of due) { clock.delete(id); x.fn(); } return due.map(([, x]) => x.ms); };
  const Board = await import("./ui/board.mjs"), Mv = await import("./movement.mjs");
  const tokens = Object.fromEntries(Object.keys(T.c).map((id) => [id, { id, object: { visible: id !== "N2" } }]));
  const combat = { id: "c", combatants: { get: (id) => (tokens[id] ? { id, token: tokens[id], tokenId: id } : null), find: (fn) => Object.keys(tokens).map((id) => ({ id, tokenId: id })).find(fn) } };
  const view = V.viewFor(T.state, { id: "p1", staff: false, owns: ["H1"] }, { hidden: ["N2"], npc: ["N1", "N2", "N3"] });
  Mv.install({ cid: (td) => td?.id ?? null, c: (cid) => T.c[cid] ?? null, state: () => view, facts: () => T.facts(), request: async () => ({ ok: true }) });
  Board.start({ t: T0, set: () => {}, send: async () => ({ ok: true }), press: () => {}, notify: () => {}, refresh: () => {}, showToken: () => {}, dock: () => ({}), request: async (req) => T.req("p1", req), bar: () => null });
  const answers = {}, asked = [];
  const learn = async (own) => { data(own); const q = asked.at(-1); answers[JSON.stringify(q)] = (await T.req("p1", { op: "preview", actor: "H1", decl: q, of: ["N1", "H2", "N3"] })).preview.per; };
  const facts = { view, me: "p1", staff: false, c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc, img: null } : null), attrs: (id) => (T.c[id]?.npc ? null : T.c[id].attrs), userName: (u) => u, weapons: () => [T.weapons.blast], preview: () => null, board: true,
    onMap: (id) => !!tokens[id]?.object.visible, reach: (cid, d) => { asked.push(d); return answers[JSON.stringify(d)] ?? null; }, where: (id) => T.spot(id), doors: () => [] };
  const data = (own) => UI.dockData(D.playerModel(view, { id: "p1", owns: ["H1"] }, ctxOf(T)), own, facts, T0);
  const cx = (rev) => ({ combat, facts, view, staff: false, rev });
  const said = () => calls.filter((c) => c[0] === "intent").map((c) => c[1]);
  /* D58 */
  await learn({ armed: "slugfest", targets: ["N1"] });
  Board.sync(data({ armed: "slugfest", targets: ["N1"] }), cx(1));
  eq([said().length, said()[0]?.ttl, [...clock.values()].map((x) => x.ms)], [1, Board.INTENT_TTL, [Board.INTENT_AGAIN]], "D58: an armed intention is said once and the board's own clock is set, shorter than the map's ttl");
  ok(Board.INTENT_AGAIN < Board.INTENT_TTL, "D58: (said again before the GMs' maps drop it)");
  const n0 = calls.length;
  eq([tick(), said().length, said()[1], calls.length - n0], [[Board.INTENT_AGAIN], 2, said()[0], 1], "D58: with nothing changing the clock says the same intention again: one call to the map");
  eq([tick().length, said().length, clock.size], [1, 3, 1], "D58: and again, for as long as the action stays armed");
  Board.sync(data({ armed: "slugfest", targets: ["N1"] }), cx(2));
  eq(said().length, 3, "D58: a sync that changes nothing says nothing more");
  Board.sync(data({}), cx(3));
  eq([said().at(-1), clock.size, tick().length, said().length], [null, 0, 0, 4], "D58: the panel closes: taken back, and the clock stops");
  /* D79 and the area */
  const own = { armed: "shoot", weapon: "blast", opts: { area: true }, targets: ["N1"] };
  await learn(own);
  ok(Board.areaMode(data(own).panel), "D79: (an area attack is put on the map)");
  Board.sync(data(own), cx(4));
  const ap = calls.filter((c) => c[0] === "areaPreview" && c[1]?.id === BP.IDS.area).at(-1)?.[1];
  eq([ap?.at, ap?.level, T.map.place(ap?.level)?.spot], ["z2", T.spot("N1"), T.spot("N1")], "D79: the standing area preview names the level as the chosen target's SPOT (a form the map reads), not a token id");
  const up = { ...own, targets: ["N3"] };
  await learn(up);
  Board.sync(data(up), cx(5));
  eq(calls.filter((c) => c[0] === "areaPreview" && c[1]?.id === BP.IDS.area).at(-1)?.[1]?.level, "z2:elevated", "D79: a target upstairs: the upper level");
  const pa = calls.filter((c) => c[0] === "pickArea").at(-1)?.[1];
  ok(typeof pa?.tokens === "function", "U36: (the area pick asks the board about every token)");
  eq([pa.tokens(tokens.H1), pa.tokens(tokens.N2), pa.tokens({ id: "N2", object: { visible: true } }), pa.tokens({ id: "x", hidden: true, object: { visible: true } }), pa.tokens({ id: "x", object: { visible: false } }), pa.tokens({ id: "bystander", object: { visible: true } }) !== false, pa.tokens(tokens.N1) !== false, pa.tokens(tokens.H2) !== false],
    [false, false, false, false, false, true, true, true], "U36: a player's area never counts the actor, a combatant the view does not hold, or a token hidden or not drawn for that player, whatever the map hands over; friends are counted");
  Board.sync(null, null);
  globalThis.setTimeout = realST; globalThis.clearTimeout = realCT;
  Mv.uninstall();
}
/* the new texts exist in both languages */
for (const k of ["ITAC.map.hit.base", "ITAC.map.hit.copies", "ITAC.map.hit.copiesAll", "ITAC.map.haz.fire.tip", "ITAC.reason.notAlly"]) ok(k in EN && k in PL, `both languages have ${k}`);
done("check-defects6");
