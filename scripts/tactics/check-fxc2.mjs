/* node scripts/tactics/check-fxc2.mjs -- FXC2: the six defects of bug hunt 5 (dev/combat-defects.md, D197-D202) and its five suspicions.
   Fights run through the REAL director, engine and view (testkit Table; the fake map of check-kit-map for moves, carries and gliders).
     D197  a chase that ends "escaped" takes the fleeing NPCs out as the roster's own leave (removeOne, D46): what hung on them ends; undo restores
     D198  Untouchable Speed / Quick Teleport are a move: not taken while held, snared (also Immobilize Only) or trapped (PWB-R4, ANSE-R1)
     D199  Life Leech [B1937]: Mass Healing goes; Cleansing Healing and Miraculous Recovery stay on the user alone (PWE-R7)
     D200  a lost turn also ENDS (U4-R2, P8-R2): surprise's "unaware" (A6), an Energy Absorption die (PWE-R4), the turn-end triggers
     D201  a glider who cannot move at all may end the turn (PW094 [B2004] only while a move is possible)
     D202  Animal Control [B1637]: never a hero; a known animal is taken at once (P6b-R6), anybody else waits for the GM's card
   Suspicions: S1 drops of a power's boosts, both links and a renamed power, and the part instance of a moveAway answer; S2 Immobilize Only and
   Save Bystanders; S3 Mind Control's inserted turn with a lost turn, surprise and the end of the turn; S4 the "stranger" gate (P8f-1). */
import { Table, ok, eq, done } from "./testkit.mjs";
import { MTable } from "./check-kit-map.mjs";
import * as M from "./mods-pure.mjs";
import * as O from "./ops-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as K from "./kit-pure.mjs";
import * as Sys from "./system-adapter.mjs";
import * as UM from "./ui/model-pure.mjs";
import { tIn } from "./lang.mjs";
import { REAL } from "./check-pwb-items.mjs";

const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const why = (env) => env?.error?.params?.reason ?? null;
const decl = (actor, action, extra = {}) => ({ op: "declare", actor, decl: { action, ...extra } });
const st = (T, id) => M.statusesOf(T.state, id).map((s) => s.id);
const item = (id, name, type, o = {}) => ({ id, name, type, level: o.level ?? null, power: o.power ?? null, boosts: o.boosts ?? [], autos: [], fx: [], flags: { kit: null, off: false, types: [] }, wf: {} });
const withB = (pid, name, boosts = []) => [item(pid, name, "power", { boosts: boosts.map((b) => b[0]) }), ...boosts.map(([id, bn, type = "boost"]) => item(id, bn, type, { power: pid }))];
const kitFacts = (T) => { const f0 = T.facts.bind(T); T.facts = () => { const f = f0(); return { ...f, canTalk: () => true, weapon: (cid, ref) => (ref == null || ref === "unarmed" ? { ...f.weapon(cid, ref), ...(T.c[cid]?.kit?.unarmed ?? {}) } : T.c[cid]?.kit?.weapons.find((w) => w.id === ref) ?? f.weapon(cid, ref)) }; }; return T; };
const give = (T, cid, items) => { const c = T.c[cid]; c.kit = K.build({ items, attrs: c.attrs }); c.pass = c.kit.pass; return T; };
const act = (T, cid, k) => T.c[cid].kit.actions.find((a) => a.id.endsWith(`-${k}`));
const next = (T) => { const r = O.reduce(T.state, { type: "nextTurn" }, { user: "gm", staff: true, owns: () => true, parts: T.parts(), rng: T.rng }); if (r.ok) T.state = r.state; return r.ok; };
const answerAll = async (T) => { for (let i = 0; i < 8; i++) { const p = Object.values(T.state.prompts).find((x) => !x.answered); if (!p) break; await T.gm({ op: "answerFor", prompt: p.id, value: p.kind === "stunts" ? [] : p.options?.find((o) => o.id === "pass")?.id ?? p.options?.[0]?.id ?? "ok" }); } };

/* ================================================================== D200: a lost turn also ends */
{
  const T = new Table(); T.hero("H1", "p1").npc("N1").npc("N2");
  T.order(["H1", "N2", "N1"], { surprised: ["N1"] });
  eq(st(T, "N1"), ["unaware"], "D200: N1 is surprised");
  await T.gm({ op: "statusAdd", combatant: "N1", status: { id: "stunned" } });
  for (let i = 0; i < 6 && T.state.round === 1; i++) next(T);
  eq([T.state.round, st(T, "N1")], [2, []], "D200 (A6, P8-R2): the lost first turn is that turn; 'unaware' ends with it, not with the next real turn");
}
{
  const T = new Table(); T.hero("H1", "p1").npc("N1").npc("N2"); T.order(["H1", "N1", "N2"]);
  const tk = M.makeToken({ id: "eaX", holder: "N1", dice: 1, scope: { attrs: ["fighting"] }, uses: 1, stacks: true, source: { kind: "power", owner: "N1", name: "Energy Absorption" }, expires: { at: "nextTurnEndOf", who: "N1" } });
  T.state = { ...T.state, tokens: [...(T.state.tokens ?? []), tk] };
  await T.gm({ op: "statusAdd", combatant: "N1", status: { id: "stunned" } });
  await T.gm({ op: "statusAdd", combatant: "H1", status: { id: "afflicted", ends: { at: "turnEndOf", who: "N1" } } });
  await T.gm({ op: "triggerAdd", trigger: { at: "turnEnd", subject: { combatant: "N1" }, run: { type: "fire", intensity: 2 }, source: { kind: "gm", name: "burning" } } });
  next(T);
  eq([T.state.init.curMember, (T.state.tokens ?? []).some((t) => t.id === "eaX"), st(T, "H1"), T.state.init.slots.find((s) => s.members.includes("N1"))?.state], ["N2", false, [], "lost"], "D200 (PWE-R4, U4-R2): the Energy Absorption die and what lasts to the end of N1's turn end with the lost turn; its card still shows 'lost'");
  ok(Object.values(T.state.prompts).some((p) => p.kind === "triggerQueue" && !p.answered && JSON.stringify(p.data ?? {}).includes("N1")), "D200 (U4-R2): what is due at the end of the lost turn goes to the GM as for a passed turn");
}
/* ================================================================== D197: "escaped" is a real leave */
{
  const run = async (mode) => {
    const T = new Table(); T.hero("H1", "p1", { name: "Kid" }).npc("N1", { name: "Doc" }).npc("N4", { name: "Runner" }); T.order(["H1", "N1", "N4"]).turn("H1");
    await T.gm({ op: "statusAdd", combatant: "H1", status: { id: "snared", ends: { at: "nextTurnOf", who: "N4" } } });
    await T.gm({ op: "tokenAdd", token: { holder: "N4", dice: 1, uses: 1, source: { kind: "gm", name: "plan" }, expires: { at: "nextTurnOf", who: "N4" } } });
    await T.gm({ op: "triggerAdd", trigger: { at: "turnStart", subject: { combatant: "N4" }, run: { type: "fire", intensity: 3 }, source: { kind: "gm", name: "burning" } } });
    if (mode === "escaped") { await T.gm({ op: "chaseStart", prey: ["N4"], pursuer: ["H1"], distance: 4 }); eq(code(await T.gm({ op: "chaseEnd", outcome: "escaped" })), "ok", "D197: the chase ends 'escaped'"); }
    else delete T.c.N4;
    await T.gm({ op: "roster" });
    const snap = { N4: !!T.c.N4, H1: st(T, "H1"), tokens: (T.state.tokens ?? []).filter((t) => t.holder === "N4").length, triggers: (T.state.triggers ?? []).filter((t) => t.subject?.combatant === "N4").length, ledger: !!T.state.ledger.N4 };
    return { T, snap };
  };
  const gone = (await run("deleted")).snap, { T, snap } = await run("escaped");
  eq(snap, gone, "D197 (ANSD-R3, D46): the escaped NPC leaves as a deleted one does: the hero it snared until its next turn is free, its token and triggers are gone");
  eq(gone, { N4: false, H1: [], tokens: 0, triggers: 0, ledger: false }, "D197: what a leave ends");
  ok(!M.conditions(T.state, "H1").snared, "D197: the hero can move again");
  const endTx = T.log.list.filter((t) => !t.undoneAt && /chaseEnd/.test(String(t.label?.gm ?? ""))).at(-1)?.id;
  eq(code(await T.gm({ op: "undo", tx: endTx })), "ok", "D197: the end is undone");
  eq([!!T.c.N4, st(T, "H1"), (T.state.tokens ?? []).filter((t) => t.holder === "N4").length, (T.state.triggers ?? []).filter((t) => t.subject?.combatant === "N4").length, !!T.state.ledger.N4, T.state.kind],
    [true, ["snared"], 1, 1, true, "chase"], "D197 (ANSD-R3): the undo brings the runner back with everything that hung on it, in the chase again");
}
/* ================================================================== D198: Untouchable Speed / Quick Teleport are a move */
{
  const real = (name, o = {}) => { const r = REAL[name]; return Sys.kitSource({ name: "x", items: [{ id: o.id ?? r.id, name, type: r.type, system: { level: r.level, power: o.power ?? null, boosts: [], automations: r.automations }, effects: [], flags: {} }] }).items[0]; };
  for (const [boost, mode, power, k] of [["Untouchable Speed", "superSpeed", "Super-Speed", "dash"], ["Quick Teleport", "teleportation", "Teleportation", "blink"]]) for (const status of [null, "grappled", "snared", "moveOnly", "trapped"]) {
    const pw = real(power), b = real(boost, { power: pw.id });
    const T = kitFacts(new MTable()); T.hero("H1", "p1", { movement: [{ mode, tier: "basic" }] }).npc("N1", { health: 6 }); T.put("H1", "z1").put("N1", "z1");
    give(T, "H1", [pw, b]); give(T, "N1", []); T.order(["H1", "N1"]).turn("N1");
    if (status) await T.gm({ op: "statusAdd", combatant: "H1", status: status === "moveOnly" ? { id: "snared", data: { moveOnly: 1 } } : { id: status } });
    const a = act(T, "H1", k);
    await T.gm(decl("N1", "slugfest", { targets: ["H1"] }));
    const o = T.prompt("reaction", "H1")?.options.find((x) => x.id === `r:${a.id}`);
    if (!status) eq([!!o, o?.disabled ?? null], [true, null], `D198: ${boost} free to move: offered`);
    else eq([!!o && !o.disabled, T.c.H1.resolve], [false, 5], `D198 (PWB-R4, [B2496], [B1606], [B1611], [B2438]): ${boost} while ${status}: not offered, nothing charged`);
  }
  /* held after the card was made: the answer itself is refused (asked again when it is answered) */
  const pw = real("Teleportation"), b = real("Quick Teleport", { power: pw.id });
  const T = kitFacts(new MTable()); T.hero("H1", "p1", { movement: [{ mode: "teleportation", tier: "basic" }] }).npc("N1", { health: 6 }); T.put("H1", "z1").put("N1", "z1");
  give(T, "H1", [pw, b]); give(T, "N1", []); T.order(["H1", "N1"]).turn("N1");
  await T.gm(decl("N1", "slugfest", { targets: ["H1"] }));
  const rp = T.prompt("reaction", "H1"), a = act(T, "H1", "blink");
  await T.gm({ op: "statusAdd", combatant: "H1", status: { id: "grappled" } });
  const r = await T.req("p1", { op: "answer", prompt: rp.id, value: `r:${a.id}` });
  eq([r.ok, T.c.H1.resolve, !!T.prompt("dodgeMove", "H1")], [false, 5, false], "D198: grabbed after the card came: the answer is refused, nothing charged");
}
/* ================================================================== D199: Life Leech heals its user alone */
{
  const LL = [["ll", "Life Leech", "limit"], ["mh", "Mass Healing"], ["ch", "Cleansing Healing"], ["mr", "Miraculous Recovery"]];
  const ids = (items) => K.build({ items, attrs: {} }).actions.map((a) => a.id.split("-").pop()).sort();
  eq(ids(withB("he", "Healing", LL)), ["cleanse", "leech", "recover"], "D199 (PWE-R7, [B1937]): with Life Leech: no heal, no Mass Healing");
  eq(ids(withB("he", "Healing", LL.slice(1))), ["cleanse", "heal", "massHeal", "recover"], "D199: without the limit all of them stay");
  const kit = K.build({ items: withB("he", "Healing", LL), attrs: {} });
  eq(kit.actions.filter((a) => ["cleanse", "recover"].includes(a.id.split("-").pop())).map((a) => [a.target ?? null, a.selfOnly]), [[null, 1], [null, 1]], "D199: Cleansing and Miraculous Recovery on the user alone (no target to pick)");
  /* S1: the links of a boost to its power: by the boost's `power` only, by the power's `boosts` list only */
  const byPower = [item("he", "Healing", "power"), ...LL.map(([id, n, t = "boost"]) => item(id, n, t, { power: "he" }))];
  const byList = [item("he", "Healing", "power", { boosts: LL.map((b) => b[0]) }), ...LL.map(([id, n, t = "boost"]) => item(id, n, t))];
  eq([ids(byPower), ids(byList)], [["cleanse", "leech", "recover"], ["cleanse", "leech", "recover"]], "S1: the drops apply whichever way the boosts are tied to the power");
  /* in a fight */
  const T = kitFacts(new Table()); T.hero("H1", "p1", { health: 3, maxHealth: 6 }).hero("H2", "p2", { health: 2, maxHealth: 6 }).npc("N1", { health: 6 });
  give(T, "H1", withB("he", "Healing", LL)); give(T, "H2", []); give(T, "N1", []); T.order(["H1", "N1", "H2"]).turn("H1");
  eq([code(await T.req("p1", decl("H1", act(T, "H1", "cleanse").id, { targets: ["H2"] }))), why(T.last)], ["illegal", "noTarget"], "D199: Cleansing Healing on an ally is refused");
  eq([code(await T.req("p1", decl("H1", act(T, "H1", "recover").id, { targets: ["H2"] }))), why(T.last)], ["illegal", "noTarget"], "D199: Miraculous Recovery on an ally is refused");
  eq(code(await T.req("p1", decl("H1", act(T, "H1", "cleanse").id, { targets: [] }))), "ok", "D199: Cleansing Healing on oneself stays");
}
/* ================================================================== D201: a glider who cannot move may end the turn */
{
  const glider = (spot = "z1:elevated") => { const T = kitFacts(new MTable()); T.hero("H1", "p1", { movement: [{ mode: "flight", tier: "basic", limits: ["gliding"] }] }).npc("N1", { health: 6, movement: [{ mode: "flight", tier: "basic" }] }); T.put("H1", spot).put("N1", spot); T.map._.tokens.H1.airborne = true; T.map._.tokens.N1.airborne = true; give(T, "H1", []); give(T, "N1", []); T.order(["H1", "N1"]).turn("H1"); return T; };
  eq(code(await glider().req("p1", { op: "endTurn", actor: "H1" })), "mustGlide", "D201 (PW094 [B2004]): a glider in the air who can move must (as before)");
  for (const s of [{ id: "grappled" }, { id: "snared" }, { id: "snared", data: { moveOnly: 1 } }, { id: "trapped" }]) {
    const T = glider(); await T.gm({ op: "statusAdd", combatant: "H1", status: s });
    eq(code(await T.req("p1", { op: "endTurn", actor: "H1" })), "ok", `D201: a glider who cannot move (${s.id}${s.data ? " / Immobilize Only" : ""}) ends the turn`);
  }
  /* the full action spent on a blow: the quick unit and the landing in place are still there, so the glider is still asked to move */
  const T = glider();
  eq(code(await T.req("p1", decl("H1", "slugfest", { targets: ["N1"] }))), "ok", "D201: a blow in the air");
  await answerAll(T); if (T.top()?.rolls?.attack && !T.top().rolls.attack.final) await T.roll("attack", 1); await answerAll(T);
  eq([T.state.stack.length, P1.budget(T.state, "H1").full], [0, "used"], "D201: the full action is spent");
  eq(code(await T.req("p1", { op: "endTurn", actor: "H1" })), "mustGlide", "D201: a move is still possible, so the glide is still asked");
  eq(code(await T.req("p1", { op: "move", actor: "H1", to: "z1", mode: "flight" })), "ok", "D201: it lands in place (an in-zone move)");
  eq(code(await T.req("p1", { op: "endTurn", actor: "H1" })), "ok", "D201: and ends the turn");
}
/* ================================================================== D202: Animal Control takes animals */
{
  const mk = () => { const T = kitFacts(new Table()); T.hero("H1", "p1").hero("H2", "p2").npc("N1", { name: "Villain" }).npc("A1", { name: "Wolf", animal: true }); for (const c of ["H2", "N1", "A1"]) give(T, c, []); give(T, "H1", [item("ac", "Animal Control", "power")]); T.order(["H1", "N1", "H2", "A1"]).turn("H1"); return T; };
  let T = mk();
  eq([code(await T.req("p1", decl("H1", act(T, "H1", "control").id, { targets: ["H2"] }))), why(T.last), T.c.H2.summonOf], ["illegal", "notAnimal", null], "D202 [B1637]: another player's hero is no animal: refused");
  eq(code(await T.req("p1", decl("H1", act(T, "H1", "control").id, { targets: ["A1"] }))), "ok", "D202: a known animal");
  eq([T.prompt("outcome"), T.c.A1.summonOf, T.requests.length], [null, "H1", 0], "D202 (P6b-R6): a known animal is taken at once, no roll, no card");
  T = mk();
  eq(code(await T.req("p1", decl("H1", act(T, "H1", "control").id, { targets: ["N1"] }))), "ok", "D202: somebody not known to be an animal");
  const p = T.prompt("outcome");
  eq([!!p, p?.to, p?.data?.animals, T.c.N1.summonOf, P1.budget(T.state, "H1").full], [true, "gm", ["N1"], null, "used"], "D202: nobody is taken; the GM's card asks, the full action is spent");
  const lines = !p ? [] : UM.askData(p, { t: (k, q, f) => tIn("en", k, q, f), facts: { c: (id) => T.c[id] }, own: {} }).lines ?? [];
  ok(lines.some((l) => typeof l === "string" && l.includes("animal") && l.includes("Villain")), "D202: the card names whom it asks about");
  if (p) await T.gm({ op: "answerFor", prompt: p.id, value: "fail" });
  eq([T.c.N1.summonOf, T.state.stack.length], [null, 0], "D202: the GM says no: nothing is taken");
  T = mk();
  await T.req("p1", decl("H1", act(T, "H1", "control").id, { targets: ["N1"] }));
  if (T.prompt("outcome")) await T.gm({ op: "answerFor", prompt: T.prompt("outcome").id, value: "success" });
  eq(T.c.N1.summonOf, "H1", "D202: the GM says it is an animal: taken");
  eq([tIn("en", "ITAC.reason.notAnimal"), tIn("pl", "ITAC.reason.notAnimal"), tIn("pl", "ITAC.ui.line.outcomeAnimal", { names: "Wilk" })], ["not an animal", "to nie zwierzę", "Czy to zwierzę: Wilk?"], "D202: the words in both languages");
  /* the adapter: the book's creatures and the GM's flag */
  const actor = (src, flag) => ({ _stats: { compendiumSource: src }, flags: flag == null ? {} : { "invincible-plus-ultra": { tactics: { animal: flag } } } });
  eq([Sys.animalOf(actor("Compendium.invincible-core.npcs-creatures.Actor.olhd3V8IWgOopwZY")), Sys.animalOf(actor("Compendium.invincible-core.npcs-creatures.Actor.69juAD7uerWPf0Ug")), Sys.animalOf(actor(null, true)), Sys.animalOf(actor("Compendium.invincible-core.npcs-creatures.Actor.olhd3V8IWgOopwZY", false)), Sys.animalOf(null)],
    [true, false, true, false, false], "D202: a creature of the book's table is an animal (Wolf), a Thug is not; the GM's flag says it either way");
}
/* ================================================================== S1: the part instance of a moveAway answer while carrying */
{
  const real = (name, o = {}) => { const r = REAL[name]; return Sys.kitSource({ name: "x", items: [{ id: o.id ?? r.id, name, type: r.type, system: { level: r.level, power: o.power ?? null, boosts: [], automations: r.automations }, effects: [], flags: {} }] }).items[0]; };
  const pw = real("Teleportation"), b = real("Quick Teleport", { power: pw.id });
  const T = kitFacts(new MTable()); T.hero("H1", "p1", { movement: [{ mode: "flight", tier: "basic" }, { mode: "teleportation", tier: "basic" }] }).hero("H2", "p2").npc("N1", { health: 6, movement: [{ mode: "flight", tier: "basic" }] });
  T.put("H1", "z1:elevated").put("H2", "z1:elevated").put("N1", "z1:elevated"); give(T, "H1", [pw, b]); give(T, "H2", []); give(T, "N1", []); T.order(["H1", "H2", "N1"]).turn("N1");
  T.state.statuses = { H1: [{ id: "carrying", data: { held: "H2" } }, { id: "airborne" }], H2: [{ id: "carried", data: { by: "H1" } }, { id: "airborne" }] };
  await T.gm(decl("N1", "slugfest", { targets: ["H1"] }));
  await T.req("p1", { op: "answer", prompt: T.prompt("reaction", "H1").id, value: `r:${act(T, "H1", "blink").id}` });
  const mp = T.prompt("dodgeMove", "H1");
  eq([mp?.options.map((o) => o.id), st(T, "H2")], [["move", "pass"], ["carried", "airborne"]], "S1 ([B2038]): teleporting away while carrying offers no zone (Teleport Allies is not there), so no part move leaves the carried one");
}
/* ================================================================== S2: Immobilize Only and Save Bystanders */
{
  const T = new Table(); T.hero("H1", "p1").hero("H2", "p2").npc("N1"); T.order(["H1", "H2", "N1"]).turn("H1");
  await T.gm({ op: "statusAdd", combatant: "H1", status: { id: "snared", data: { moveOnly: 1 } } });
  await T.gm({ op: "statusAdd", combatant: "H2", status: { id: "snared" } });
  eq(code(await T.req("p1", decl("H1", "saveBystanders", { attr: "strength" }))), "ok", "S2 ([B1611]: 'can perform actions normally'): Immobilize Only does not bar Save Bystanders (ANSF-R9 names grapple, snare and the immobilised state)");
  const U = new Table(); U.hero("H1", "p1").hero("H2", "p2").npc("N1"); U.order(["H1", "H2", "N1"]).turn("H2");
  await U.gm({ op: "statusAdd", combatant: "H2", status: { id: "snared" } });
  eq([code(await U.req("p2", decl("H2", "saveBystanders", { attr: "strength" }))), why(U.last)], ["illegal", "restrained"], "S2 (ANSF-R9): a plain snare bars it");
}
/* ================================================================== S3: Mind Control's inserted turn, surprise, a lost turn and the turn's end */
{
  const mc = [item("mc", "Mind Control", "power")];
  const T = kitFacts(new Table()); T.hero("H1", "p1").npc("N1").npc("N2"); give(T, "H1", mc); give(T, "N1", []); give(T, "N2", []);
  T.order(["H1", "N2", "N1"], { surprised: ["N1"] }); T.turn("H1");
  const tk = M.makeToken({ id: "eaY", holder: "N1", dice: 1, scope: { attrs: ["fighting"] }, uses: 1, stacks: true, source: { kind: "power", owner: "N1", name: "Energy Absorption" }, expires: { at: "nextTurnEndOf", who: "N1" } });
  T.state = { ...T.state, tokens: [...(T.state.tokens ?? []), tk] };
  await T.req("p1", decl("H1", act(T, "H1", "control").id, { targets: ["N1"] })); await T.roll("roll", 2); await T.roll("def:N1", 0);
  await T.gm({ op: "answerFor", prompt: T.prompt("outcome").id, value: "success" });
  await T.req("p1", { op: "endTurn", actor: "H1" });
  eq([T.state.init.curMember, !!T.state.ledger.N1.lostTurn], ["N1", true], "S3 (PW043 [B1761]): the commanded turn comes at once, the own turn is taken away");
  eq((T.state.tokens ?? []).some((t) => t.id === "eaY" && t.expires.at === "nextTurnEndOf"), true, "S3: a commanded turn is not the own turn: 'until the end of your next turn' still waits (as the turn-start side, ops-pure openTurn)");
  await T.gm({ op: "endTurn", actor: "N1" });
  for (let i = 0; i < 6 && T.state.round === 1; i++) next(T);
  eq([T.state.round, st(T, "N1"), (T.state.tokens ?? []).some((t) => t.id === "eaY"), !!T.state.ledger.N1.lostTurn], [2, [], false, false], "S3 (A6, PWE-R4, U4-R2): by the end of round 1 the lost own turn has ended 'unaware' and the die; nothing is lost twice");
}
/* ================================================================== S4: the "stranger" gate (P8f-1) is about the player and the subject */
{
  const mk = (actor) => { const T = new Table(); T.hero("H1", "p1").npc("N1", { resolve: 5, maxResolve: 5 }).npc("N3", { owners: ["p1"], resolve: 5, maxResolve: 5 }); T.order(["H1", "N1", "N3"]).turn(actor); return T; };
  const go = async (actor, tgt) => { const T = mk(actor); const r = await T.req("p1", decl(actor, "recoverResolve", { targets: [tgt] })); return [code(r), why(r), T.prompts("exception").map((p) => p.data?.reason)]; };
  eq(await go("H1", "N1"), ["ok", null, ["strangerAlly"]], "S4 (P8f-1): a hero at an unrevealed NPC: the GM's card, as before");
  eq(await go("H1", "N3"), ["illegal", "resolveFull", []], "S4: the player's own NPC is no stranger: the rule's own answer (they read its sheet)");
  eq(await go("N3", "N1"), ["ok", null, ["strangerAlly"]], "S4: acting with an NPC they own, a player learns no number of an unrevealed NPC either (was: 'resolveFull')");
  const T = mk("N1");
  eq(code(await T.gm(decl("N1", "recoverResolve", { targets: ["N3"] }))), "illegal", "S4: the GM's own hand is never gated");
}
done("check-fxc2");
