// node scripts/tactics/check-pwe.mjs -- fixer PWE of the powers review (defence, body, movement and sense powers: PW061-PW120 of the
// review's list): each fix pinned through the REAL director, engine, ledger and kit build with a scripted table (no Foundry). Book lines
// are named as [Bnnnn]; the rulings are under "PWE" in dev/combat-rulings.md, the provisional choices under "PWE" in combat-questions.md.
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./mods-pure.mjs";
import * as K from "./kit-pure.mjs";
import * as FK from "./flows/kit.mjs";
import * as Mv from "./movement-pure.mjs";
import * as D from "./director-pure.mjs";
import { EN, PL } from "./lang.mjs";
import { MTable } from "./check-kit-map.mjs";

const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const why = (env) => env?.error?.params?.reason ?? null;
const decl = (actor, action, extra = {}) => ({ op: "declare", actor, decl: { action, ...extra } });
const st = (T, cid) => M.statusesOf(T.state, cid).map((s) => s.id);
const auto = (id, name, type, o = {}) => ({ id, name, type, show: o.show !== false, attr: o.attr ?? [], bonus: o.bonus ?? 0, stress: o.stress ?? 0, damage: o.damage ?? 0, min: o.min ?? 0, max: o.max ?? 0, bypass: false });
const item = (id, name, type, o = {}) => ({ id, name, type, level: o.level ?? null, power: o.power ?? null, boosts: o.boosts ?? [], autos: o.autos ?? [], fx: o.fx ?? [], flags: { kit: null, off: false, types: [], ...(o.flags ?? {}) }, wf: o.wf ?? {} });
const withB = (pid, name, boosts = [], o = {}) => [item(pid, name, "power", { ...o, boosts: boosts.map((b) => b[0]) }), ...boosts.map(([id, bn, type = "boost"]) => item(id, bn, type, { power: pid }))];

/* the table of the review (a kit built by K.build, its pass, armor and immunities on the combatant; an fx switch rebuilds the kit) */
class Tbl extends Table {
  give(cid, items, bonus = {}) { const c = this.c[cid]; c.src = items; c.kit = K.build({ items, attrs: c.attrs }); c.pass = c.kit.pass; c.bonus = bonus;
    c.armor = (c.armor ?? []).filter((a) => a.id !== "defiance"); if (c.pass.stressArmor) c.armor = [...c.armor, { id: "defiance", armor: c.pass.stressArmor, stress: true }];
    c.immunities = [...(c.immunitiesBase ??= c.immunities ?? []), ...(c.pass.immune ?? [])]; c.impervious = c.pass.impervious === true; c.regeneration = c.pass.regeneration === true; return this; }
  facts() { const f = super.facts(), T = this; return { ...f, canTalk: () => true, ...(T.Z ? { zones: T.Z } : {}), weapon: (cid, ref) => (ref == null || ref === "unarmed" ? { ...f.weapon(cid, ref), ...(T.c[cid]?.kit?.unarmed ?? {}) } : T.c[cid]?.kit?.weapons.find((w) => w.id === ref) ?? f.weapon(cid, ref)) }; }
  async perform(e) {
    if (e.t === "fx" || e.t === "fxSet") {
      this.performed.push(e);
      const c = Object.values(this.c).find((x) => x.actorUuid === (e.uuid ?? e.actorUuid)), fx = c?.src?.find((i) => i.id === (e.item ?? e.itemId))?.fx.find((x) => x.id === (e.fx ?? e.effectId));
      if (!fx) return {};
      const from = fx.on; fx.on = e.on; this.give(c.id, c.src, c.bonus);
      return e.t === "fx" ? { op: { t: "fx", actorUuid: c.actorUuid, itemId: e.item, effectId: e.fx, from, to: e.on } } : {};
    }
    return super.perform(e);
  }
}
const base = (hItems = [], nItems = [], o = {}) => { const T = new Tbl(); T.hero("H1", "p1", o.h1 ?? {}).hero("H2", "p2", o.h2 ?? {}).npc("N1", { health: 6, ...(o.n1 ?? {}) }).npc("N2", { health: 4, huge: true }); T.give("H1", hItems, o.bonus ?? {}).give("N1", nItems).give("H2", o.h2Items ?? []); T.order(["H1", "N1", "H2", "N2"]).turn("H1"); return T; };
const act = (T, cid, k) => T.c[cid].kit.actions.find((a) => a.id.endsWith(`-${k}`));
const pass = async (T, who = "gm") => { const p = T.prompt("reaction"); if (p) await T.req(who, { op: "answerFor", prompt: p.id, value: "pass" }); };
const noStunts = async (T) => { const p = T.prompt("stunts"); if (p) await T.gm({ op: "answerFor", prompt: p.id, value: [] }); };
const both = (k) => typeof EN[k] === "string" && typeof PL[k] === "string";
const barriers = (T) => (T.state.effects ?? []).filter((e) => e.kind === "barrier");

/* ============================================================ PW061 / PW106, PW062: Barrier [B1859-1862] */
{
  const T = base(withB("ba", "Barrier"));
  T.c.H2.zone = "z9";
  eq([code(await T.req("p1", decl("H1", act(T, "H1", "barrier").id, { targets: ["H2"] }))), why(T.last)], ["illegal", "notSameZone"], "PW061 [B1859]: a barrier only for someone in your zone");
  T.c.H2.zone = T.c.H1.zone;
  eq(code(await T.req("p1", decl("H1", act(T, "H1", "barrier").id, { targets: ["H2"] }))), "ok", "PW061: same zone is fine");
  eq(barriers(T).map((b) => b.ends?.at), ["sceneEnd"], "PW062 [B1859]: the barrier lasts the scene (a few minutes), unless breached");
  ok(both("ITAC.kit.act.dropBarrier") && both("ITAC.reason.noBarrier") && both("ITAC.why.noBarrier") && both("ITAC.fix.noBarrier"), "PW062: the drop action and its refusal in both languages");
  eq([code(await T.req("p1", decl("H1", act(T, "H1", "dropBarrier").id, { targets: ["N1"] }))), why(T.last)], ["illegal", "noBarrier"], "PW062: nothing to drop where you keep no barrier");
  eq(code(await T.req("p1", decl("H1", act(T, "H1", "dropBarrier").id, { targets: ["H2"] }))), "ok", "PW062 [B1859]: you dismiss your barrier at will");
  eq(barriers(T).length, 0, "PW062: and it is gone");
  eq(act(T, "H1", "dropBarrier").cost, "none", "PW062: dismissing costs no action (provisional PWE-3)");
  const U = base(withB("ba", "Barrier"));
  await U.req("p1", decl("H1", act(U, "H1", "barrier").id, {}));
  await U.gm({ op: "endScene", force: true });
  eq(barriers(U).length, 0, "PW062: the scene's end ends it");
}

/* ============================================================ PW063 / PW103, PW064: Defiance [B1865-1869] */
{
  const T = base([item("mc", "Mind Control", "power")], [item("df", "Defiance", "power", { level: "major" })]);
  eq(code(await T.req("p1", decl("H1", act(T, "H1", "control").id, { targets: ["N1"] }))), "ok", "PW063: Mind Control declared");
  await T.roll("roll", 2);
  const q = T.lastRequest();
  eq([q?.attr, q?.dice], ["presence", T.c.N1.attrs.presence + 4], "PW063 [B1865]: Defiance Major adds 4 dice to resist Mind Control");
  ok((q?.pool ?? q?.mods ?? []).length !== 0 || q?.dice > T.c.N1.attrs.presence, "PW063: the extra dice are in the request");
  const U = base(withB("il", "Illusion", [["ti", "Terrifying Illusions"]]), [item("df", "Defiance", "power", { level: "massive" })]);
  eq(code(await U.req("p1", decl("H1", act(U, "H1", "terrify").id, { targets: ["N1"] }))), "ok", "PW063: Terrifying Illusions declared");
  const r = U.lastRequest();
  eq([r?.attr, r?.dice], ["intuition", U.c.N1.attrs.intuition + 5], "PW063 [B1865]: Defiance Massive adds 5 dice to resist the terror");
  const V = base([item("mc", "Mind Control", "power")], []);
  await V.req("p1", decl("H1", act(V, "H1", "control").id, { targets: ["N1"] })); await V.roll("roll", 2);
  eq(V.lastRequest()?.dice, V.c.N1.attrs.presence, "PW063: no Defiance, no extra dice");
  ok(both("ITAC.mod.defiance"), "PW063: the dice are named in both languages");
}
{
  const off = () => withB("df", "Defiance", [["ra", "Requires Activation (Defiance)", "limit"]], { level: "basic" });
  const stun = item("st", "Stun", "power", { autos: [auto("a", "Stun", "rollAttack", { attr: ["agility"], damage: 3, max: 3 })] });
  const T = base([stun], off());
  await T.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: T.c.H1.kit.weapons[0].id })); await pass(T); await T.roll("attack", 1);
  eq(T.lastRequest()?.dice, T.c.N1.attrs.presence, "PW064 [B1869]: Defiance not yet activated gives no dice to resist Stun");
  const U = base([stun], off());
  U.turn("N1"); eq(code(await U.gm(decl("N1", act(U, "N1", "activate").id))), "ok", "PW064: Defiance activated");
  U.turn("H1");
  await U.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: U.c.H1.kit.weapons[0].id })); await pass(U); await U.roll("attack", 1);
  eq(U.lastRequest()?.dice, U.c.N1.attrs.presence + 3, "PW064: once activated, its 3 dice count");
}

/* ============================================================ PW066: Impervious [B1888] */
{
  const prot = () => withB("pr", "Protection", [["iv", "Impervious"]]);
  const hit = async (items, dice, h1 = {}) => { const Z = base(items, [], { h1: { health: 1, maxHealth: 6, ...h1 } }); Z.turn("N1"); Z.dice = [dice];
    await Z.gm(decl("N1", "slugfest", { targets: ["H1"] })); await pass(Z); await Z.roll("attack", 1); await noStunts(Z); return Z; };
  const A = await hit([], [2, 5]);
  eq(A.c.H1.crits.length, 1, "PW066: without Impervious the injury is written");
  const B = await hit(prot(), [2, 5]);
  eq([B.c.H1.crits, B.evs("crit").length, st(B, "H1").includes("broken")], [[], 0, true], "PW066 [B1888]: Impervious: broken, but an injury that does not kill has no effect (none written, no event)");
  const prior = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const C = base(prot(), [], { h1: { health: 1, maxHealth: 6, crits: prior.slice() } }); C.turn("N1"); C.dice = [[2, 5]];
  await C.gm(decl("N1", "slugfest", { targets: ["H1"] })); await pass(C); await C.roll("attack", 1); await noStunts(C);
  const hd = C.prompt("heroDead"); if (hd) await C.gm({ op: "answerFor", prompt: hd.id, value: "dead" });
  eq([C.c.H1.crits.length, C.c.H1.crits.at(-1) >= 12], [11, true], "PW066 [B1888]: an instantly fatal injury (12+) still counts for an Impervious hero");
  ok(FK.IMPERVIOUS_FATAL === 12, "PW066 [B1888]: 12+ on the table still counts");
}

/* ============================================================ PW067, PW068: Energy Absorption [B1887] */
{
  const ea = () => withB("pr", "Protection", [["ea", "Energy Absorption"]], { level: "major" });
  const T = base(ea(), [], { h1: { health: 30, maxHealth: 30, armor: [{ id: "prot", armor: 3 }] }, n1: { slugfest: { damage: 6 } } });
  T.order(["N1", "H1", "H2", "N2"]).turn("N1");
  await T.gm(decl("N1", "slugfest", { targets: ["H1"] })); await pass(T); await T.roll("attack", 1); await noStunts(T);
  const mine = () => T.state.tokens.filter((t) => t.holder === "H1" && t.source?.name === "Energy Absorption");
  eq([T.evs("damage")[0]?.base, mine().length, mine().every((t) => t.dice === 1 && t.uses === 1)], [2, 2, true], "PW068 [B1887]: 2 points absorbed = 2 dice, each spent on its own");
  eq(mine()[0]?.expires, { at: "nextTurnEndOf", who: "H1" }, "PW067: they wait for the holder's next turn");
  T.turn("H1");
  eq(mine()[0]?.expires, { at: "turnEndOf", who: "H1" }, "PW067: on that next turn they last to its end");
  await T.req("p1", decl("H1", "slugfest", { targets: ["N1"], tokens: [mine()[0].id] })); await pass(T);
  const rq = T.lastRequest();
  await T.roll("attack", 0); await noStunts(T);
  eq([rq?.key, mine().length], ["attack", 1], "PW068: one die spent, one left");
  T.turn("H2"); eq(mine().length, 0, "PW067 [B1887]: dice not used on that turn are lost");
}
{
  const ea = () => withB("pr", "Protection", [["ea", "Energy Absorption"]], { level: "major" });
  const T = base(ea(), [], { h1: { health: 30, maxHealth: 30, armor: [{ id: "prot", armor: 3 }] } });
  T.dice.push([6, 6, 6, 6, 6, 6]);
  await T.gm({ op: "hazardRun", run: { type: "blast", rating: 6 }, subject: { zone: T.c.H1.zone } });
  for (let i = 0; i < 8; i++) { const p = T.prompts()[0]; if (!p) break; await T.gm({ op: "answerFor", prompt: p.id, value: p.options?.find((o) => o.id === "pass")?.id ?? p.options?.[0]?.id ?? "pass" }); if (T.lastRequest()?.key?.startsWith("def")) await T.roll(T.lastRequest().key, 0); }
  const mine = () => T.state.tokens.filter((t) => t.holder === "H1" && t.source?.name === "Energy Absorption");
  ok(mine().length > 0, "PW067 [B1887]: damage a hazard's blast puts into the Protection gives dice too");
  T.turn("N1"); ok(mine().length > 0, "PW067: hit on the own turn, the dice are still there after it");
}

/* ============================================================ PW070: Immunity to a disease or a poison [B1879], [B1880] */
{
  const imm = (types, ...b) => [item("im", "Immunity", "power", { flags: { types }, boosts: b.map((x) => x.id) }), ...b.map((x) => ({ ...x, power: "im" }))];
  const run = async (items, name) => { const T = base(items); await T.gm({ op: "hazardRun", run: { type: "disease", virulence: 0, ...(name ? { name } : {}) }, subject: { combatant: "H1" } }); return T; };
  const A = await run(imm(["disease"]));
  eq([A.requests.some((r) => r.key === "roll"), A.c.H1.health, st(A, "H1").includes("sick")], [false, A.c.H1.maxHealth, false], "PW070 [B1879]: immune to disease: no roll, no damage, not sick");
  const B = await run(imm(["fire"]));
  ok(B.requests.some((r) => r.key === "roll"), "PW070: an Immunity to something else rolls as before");
  const C = await run(imm(["poison"]), "Snake venom");
  ok(!C.requests.some((r) => r.key === "roll"), "PW070: a poison named so, against an Immunity to poison");
  const E = await run(imm(["poison"]));
  ok(E.requests.some((r) => r.key === "roll"), "PW070: an Immunity to poison does not cover a disease");
  const F = await run(imm([], item("fi", "Full Immunity", "boost")));
  ok(!F.requests.some((r) => r.key === "roll"), "PW070 [B1880]: Full Immunity covers diseases");
  const ts = [item("st", "Strike", "power", { boosts: ["ts"] }), item("ts", "Toxic Strike", "boost", { power: "st" })];
  const G = base(ts, imm(["toxins"]), { n1: { health: 6 } });
  await G.req("p1", decl("H1", "slugfest", { targets: ["N1"] })); await pass(G); await G.roll("attack", 1); await noStunts(G);
  eq(st(G, "N1").includes("sick"), false, "PW070 [B1879]: a Toxic Strike does not poison one immune to toxins");
  const H = base(ts, [], { n1: { health: 6 } });
  await H.req("p1", decl("H1", "slugfest", { targets: ["N1"] })); await pass(H); await H.roll("attack", 1); await noStunts(H);
  eq(st(H, "N1").includes("sick"), true, "PW070: without the Immunity it does");
  ok(both("ITAC.result.immune"), "PW070: the result is named in both languages");
}

/* ============================================================ PW073: holding on [B1925-1928], [B1921] */
{
  const held = async (items) => { const U = base(items);
    await U.req("p1", decl("H1", "grapple", { targets: ["N1"] })); await pass(U); await U.roll("attack", 3); await noStunts(U);
    U.turn("N1"); await U.gm(decl("N1", "breakFree")); await U.roll("roll", 1); return U; };
  const A = await held([]), qa = A.requests.filter((r) => r.key?.startsWith("def")).at(-1);
  const B = await held([item("xl", "Extra Limb(s)", "power", { level: "massive" })]), qb = B.requests.filter((r) => r.key?.startsWith("def")).at(-1);
  ok(!!qa && !!qb, "PW073: the holder rolls to keep the hold");
  eq(qb?.dice - qa?.dice, 4, "PW073 [B1927]: Extra Limb(s) Massive: +4 dice to resist the target breaking free");
  const C = await held(withB("el", "Elongation", [["sg", "Stretch Grapple"]])), qc = C.requests.filter((r) => r.key?.startsWith("def")).at(-1);
  eq(qc?.dice - qa?.dice, 3, "PW073 [B1921]: Stretch Grapple: +3 dice");
  ok(both("ITAC.mod.hold"), "PW073: named in both languages");
}

/* ============================================================ PW074 / PW104, PW075 / PW105, PW080 / PW120: Healing [B1932-1937] */
{
  const T = base(withB("he", "Healing", [["dh", "Distant Healing"]]), [], { h2: { health: 2 } });
  T.c.H2.zone = "z7";
  T.setRange("H1", "H2", 1);
  eq(code(await T.req("p1", decl("H1", act(T, "H1", "heal").id, { targets: ["H2"] }))), "ok", "PW074 [B1933]: Distant Healing reaches the next zone");
  const U = base(withB("he", "Healing", [["dh", "Distant Healing"]]), [], { h2: { health: 2 } });
  U.c.H2.zone = "z7"; U.setRange("H1", "H2", 2);
  eq([code(await U.req("p1", decl("H1", act(U, "H1", "heal").id, { targets: ["H2"] }))), why(U.last)], ["illegal", "tooFar"], "PW074 / PW104 [B1933]: but no further (the GM may allow)");
  ok(U.last?.error?.params?.gmMayAllow, "PW074: the GM may allow it");
  const L = base(withB("he", "Healing", [["ll", "Life Leech", "limit"]]));
  eq([!!act(L, "H1", "heal"), !!act(L, "H1", "leech")], [false, true], "PW075 / PW105 [B1937]: with Life Leech the power heals only through the leech");
  eq(!!act(base(withB("he", "Healing")), "H1", "heal"), true, "PW075: without the limit healing others stays");
  const MH = base(withB("he", "Healing", [["mh", "Mass Healing"]]));
  eq(act(MH, "H1", "massHeal").target.n, [1, 12], "PW080 / PW120 [B1934]: no cap of four; 1 stress per extra target limits it");
  for (let i = 3; i <= 6; i++) MH.hero(`H${i}`, "p2", { health: 2 });
  eq(code(await MH.req("p1", decl("H1", act(MH, "H1", "massHeal").id, { targets: ["H2", "H3", "H4", "H5", "H6"] }))), "ok", "PW080: five allies at once");
}

/* ============================================================ PW076: Camouflage [B1903], [B1904] */
{
  const T = base([item("cm", "Camouflage", "power")]);
  eq([T.c.H1.kit.actions.length, T.c.H1.kit.uses?.length ?? 0], [0, 0], "PW076 [B1903]: always on, no action to spend");
  T.turn("N1");
  await T.gm(decl("N1", "slugfest", { targets: ["H1"] }));
  const g = T.requests.at(-1);
  eq([g?.key, g?.attr, g?.pool?.mods], ["gate:0", "intuition", [{ source: "gate:camouflage", dice: -3 }]], "PW076 [B1903]: an enemy first spots the still target at -3 INTUITION");
  ok(both("ITAC.gate.camouflage"), "PW076: the gate named in both languages");
  const U = base([item("cm", "Camouflage", "power")]);
  await U.req("p1", decl("H1", "slugfest", { targets: ["N1"] })); await pass(U); await U.roll("attack", 0); await noStunts(U);
  U.turn("N1"); await U.gm(decl("N1", "slugfest", { targets: ["H1"] }));
  ok(!U.requests.some((r) => r.key?.startsWith("gate")), "PW076: not after attacking on the last turn");
  const S = base(withB("cm", "Camouflage", [["sc", "Shared Camouflage"]]));
  S.hero("H3", "p2", {}); const r0 = S.c.H1.resolve;
  eq(code(await S.req("p1", decl("H1", act(S, "H1", "share").id, { targets: ["H2", "H3"] }))), "ok", "PW076 [B1904]: shared with two allies in the zone");
  eq([r0 - S.c.H1.resolve, (S.state.effects ?? []).filter((e) => e.kind === "camouflage").map((e) => e.holder).sort()], [2, ["H2", "H3"]], "PW076 [B1904]: 1 stress per ally, each camouflaged");
  S.turn("N1"); await S.gm(decl("N1", "slugfest", { targets: ["H2"] }));
  ok(S.requests.some((r) => r.key?.startsWith("gate") && r.label === "ITAC.gate.camouflage"), "PW076: an enemy must spot the ally too");
  eq(act(S, "H1", "share").target.n, [1, 3], "PW076 [B1904]: up to three allies");
}

/* ============================================================ PW077: the copies' extra action [B1909] */
{
  const T = base([item("du", "Duplication", "power")]);
  const r0 = T.c.H1.resolve;
  eq([code(await T.req("p1", decl("H1", act(T, "H1", "copyAct").id))), why(T.last), T.c.H1.resolve], ["illegal", "noCopies", r0], "PW077 [B1909]: no copies, no extra action, no stress");
  eq(code(await T.req("p1", decl("H1", act(T, "H1", "copies").id))), "ok", "PW077: copies made");
  T.turn("N1");
  eq([code(await T.req("p1", decl("H1", act(T, "H1", "copyAct").id))), why(T.last)], ["illegal", "notYourTurn"], "PW077 [B1909]: only on your own turn");
  await T.gm({ op: "nextRound" }); T.turn("H1");
  eq(code(await T.req("p1", decl("H1", act(T, "H1", "copyAct").id))), "ok", "PW077: on the own turn with copies out");
  const g = T.state.ledger.H1.grants.find((x) => x.unit === "full" && !x.usedBy);
  eq(g?.window, "ownTurn", "PW077: the extra full action is spent on that turn");
}

/* ============================================================ PW079: Elongation picks up an item in the next zone [B1919] */
{
  const mk = (items) => { const T = base(items); T.c.H1.zone = "z1"; T.Z = { within: (where, n) => (where === "z1" && n >= 1 ? [{ zone: "z1", d: 0 }, { zone: "z2", d: 1 }] : []) }; return T; };
  const T = mk([item("el", "Elongation", "power")]);
  await T.gm({ op: "itemState", item: { id: "next", name: "pipe", owner: "N1", state: "ground", zone: "z2" } });
  await T.gm({ op: "itemState", item: { id: "far", name: "bat", owner: "N1", state: "ground", zone: "z4" } });
  eq([code(await T.req("p1", decl("H1", "pickUp", { item: "next" }))), T.state.items.find((i) => i.id === "next").holder], ["ok", "H1"], "PW079 [B1919]: Elongation reaches an item in the adjacent zone");
  eq([code(await T.req("p1", decl("H1", "pickUp", { item: "far" }))), why(T.last)], ["illegal", "noItem"], "PW079: not two zones away");
  const U = mk([]);
  await U.gm({ op: "itemState", item: { id: "next", name: "pipe", owner: "N1", state: "ground", zone: "z2" } });
  eq([code(await U.req("p1", decl("H1", "pickUp", { item: "next" }))), why(U.last)], ["illegal", "noItem"], "PW079: without Elongation only where it lies");
}

/* ============================================================ PW082: Blocking Item [B1969] */
{
  const blast = item("bl", "Blast", "power", { autos: [auto("a", "Blast", "rollAttack", { attr: ["agility"], damage: 3, max: 3 })] });
  const shot = async (items) => { const T = base(items, [blast]); T.turn("N1"); await T.gm(decl("N1", "shoot", { targets: ["H1"], weapon: T.c.N1.kit.weapons[0].id })); return T.prompt("reaction")?.options.map((o) => o.id) ?? []; };
  ok(!(await shot([])).includes("block"), "PW082: without it no block against a shot");
  ok((await shot(withB("si", "Signature Item", [["bi", "Blocking Item"]]))).includes("block"), "PW082 [B1969]: the Blocking Item blocks shots too");
}

/* ============================================================ PW096: Leaping's +2 only on a charge by leaping [B2007] */
{
  for (const lv of ["basic", "monstrous"]) {
    const T = base([item("lp", "Leaping", "power", { level: lv })]), v = { state: T.state, facts: T.facts() };
    const dice = (mode, kind = "charge") => FK.kitDice(v, { flow: "attack", actor: "H1", decl: {}, data: { kind, charge: { mode } } }, "H1", "fighting", "attack").filter((m) => m.source === "kit:leaping").reduce((s, m) => s + m.dice, 0);
    eq([dice("leaping"), dice("walk"), dice("leaping", "slugfest")], [2, 0, 0], `PW096 [B2007]: ${lv}: +2 on a leaping charge, nothing on a run or another attack`);
    ok(T.c.H1.kit.sheetSkip.includes("Leaping"), "PW096: the sheet's own +2 to every charge is not counted");
  }
}

/* ============================================================ PW085: Controlled Phasing; PW086: phasing through walls [B1939-1942] */
{
  const T = base(withB("in", "Intangibility", [["pp", "Prolonged Phasing"], ["cp", "Controlled Phasing"]]));
  const r0 = T.c.H1.resolve;
  eq([code(await T.req("p1", decl("H1", act(T, "H1", "solid").id))), why(T.last), T.c.H1.resolve], ["illegal", "needsStatus", r0], "PW085 [B1942]: 'solid' only while intangible, no stress spent");
  ok(both("ITAC.reason.needsStatus") && both("ITAC.why.needsStatus") && both("ITAC.fix.needsStatus"), "PW085: the refusal in both languages");
  eq(code(await T.req("p1", decl("H1", act(T, "H1", "phased").id))), "ok", "PW085: phased");
  eq(code(await T.req("p1", decl("H1", act(T, "H1", "solid").id))), "ok", "PW085: now it may turn solid");
  const seen = [], Z = { place: () => ({ spot: "z1" }), placeOf: (k) => ({ spot: k }), states: () => ({}), plan: (cid, to, p) => { seen.push(p); return { total: 1, steps: [], zones: ["z1", "z2"] }; } };
  const U = base([item("in", "Intangibility", "power")]), plain = base([]);
  Mv.priceMove(Z, U.state, "H1", U.c.H1, { to: "z2" }); Mv.priceMove(Z, plain.state, "H1", plain.c.H1, { to: "z2" });
  eq(seen.map((p) => p.way), ["phase", "walk"], "PW086 [B1939]: an intangible character walks the map's 'phase' way through walls; others walk");
  ok(Mv.phaseFor(plain.state, "H1", plain.c.H1) === false && Mv.phaseFor(U.state, "H1", U.c.H1) === true, "PW086: who phases");
  eq(Mv.apiProfile({ way: "air", mode: "flight", zones: 2 }, { phase: true }).way, "flight", "PW086: a flier flies as before");
}

/* ============================================================ PW087: Life Support [B1947] */
{
  const T = base([item("ls", "Life Support", "power")]), r0 = T.c.H1.resolve;
  eq(T.c.H1.kit.pass.vacuumSafe ?? null, null, "PW087: no longer free");
  await T.gm({ op: "hazardRun", run: { type: "vacuum" }, subject: { combatant: "H1" } });
  eq([T.requests.some((r) => r.key === "roll"), r0 - T.c.H1.resolve, st(T, "H1").includes("broken")], [false, 1, false], "PW087 [B1947]: 1 stress and no roll in the vacuum");
  await T.gm({ op: "hazardRun", run: { type: "vacuum" }, subject: { combatant: "H1" } });
  eq([T.requests.some((r) => r.key === "roll"), r0 - T.c.H1.resolve], [false, 1], "PW087: paid once for the scene");
  const U = base([]);
  await U.gm({ op: "hazardRun", run: { type: "vacuum" }, subject: { combatant: "H1" } });
  ok(U.requests.some((r) => r.key === "roll"), "PW087: without it the vacuum roll as before");
}

/* ============================================================ PW091: one size at a time [B1974] */
{
  const size = (grow, shrink) => [item("sz", "Size Alteration", "power", { level: "major", fx: [{ id: "g", name: "Grow", on: grow }, { id: "s", name: "Shrink", on: shrink }] })];
  const T = base(size(false, true));
  eq(code(await T.req("p1", decl("H1", T.c.H1.kit.actions.find((a) => a.name === "Grow").id))), "ok", "PW091: Grow while shrunk");
  eq(T.c.H1.src[0].fx.map((f) => [f.id, f.on]), [["g", true], ["s", false]], "PW091 [B1974]: growing ends the shrinking");
  const U = base(size(true, false));
  await U.req("p1", decl("H1", U.c.H1.kit.actions.find((a) => a.name === "Shrink").id));
  eq(U.c.H1.src[0].fx.map((f) => [f.id, f.on]), [["g", false], ["s", true]], "PW091: and the other way round");
  const V = base(size(true, false));
  await V.req("p1", decl("H1", V.c.H1.kit.actions.find((a) => a.name === "Grow").id));
  eq(V.c.H1.src[0].fx.map((f) => [f.id, f.on]), [["g", false], ["s", false]], "PW091: switching Grow off leaves Shrink off");
}
/* ============================================================ PW092, PW093: Transformation [B1984-1988] */
{
  const tr = (lv) => [item("tr", "Transformation", "power", { level: lv, autos: [auto("a", "Transformation", "rollAttack", { attr: ["reason"], damage: 3, max: 0 })] })];
  const T = base(tr("major")), m = act(T, "H1", "matter");
  eq([m.pick, m.stressPick], [["0", "1", "2"], 1], "PW092 [B1986]: up to two weight steps more, 1 stress each");
  const r0 = T.c.H1.resolve;
  eq(code(await T.req("p1", decl("H1", m.id, { opt: "2" }))), "ok", "PW092: two steps");
  eq(r0 - T.c.H1.resolve, 2, "PW092: two stress");
  const U = base(tr("basic"), [], { n1: { kind: "npc" } });
  const w = U.c.H1.kit.weapons[0];
  eq([code(await U.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: w.id }))), why(U.last), U.last?.error?.params?.gmMayAllow], ["illegal", "livingTarget", 1], "PW093 [B1984]: not against a living target (the GM may allow)");
  U.c.N1.nonLiving = true;
  eq(code(await U.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: w.id }))), "ok", "PW093: a robot is fine");
  ok(both("ITAC.reason.livingTarget") && both("ITAC.why.livingTarget") && both("ITAC.fix.livingTarget"), "PW093: the refusal in both languages");
}

/* ============================================================ PW094: a glider keeps moving until it lands [B2004] */
{
  const mk = (airborne, limits = ["gliding"]) => { const T = base([]); T.c.H1.movement = [{ mode: "flight", tier: "basic", limits }]; T.Z = { place: () => ({ spot: "z1", airborne }) }; return T; };
  const T = mk(true);
  eq([code(await T.req("p1", { op: "endTurn", actor: "H1" })), !!(T.last?.error?.params?.gmMayAllow ?? T.last?.error?.gmMayAllow)], ["mustGlide", true], "PW094 [B2004]: a glider in the air may not end the turn without moving");
  ok(both("ITAC.err.mustGlide"), "PW094: said in both languages");
  eq(code(await T.gm({ op: "endTurn", actor: "H1", force: true })), "ok", "PW094: the GM may end it");
  const U = mk(false);
  eq(code(await U.req("p1", { op: "endTurn", actor: "H1" })), "ok", "PW094: on the ground the turn ends as always");
  const V = mk(true, []);
  eq(code(await V.req("p1", { op: "endTurn", actor: "H1" })), "ok", "PW094: a true flier may hover");
  const W = mk(true);
  W.state.ledger.H1.history.thisTurn = { moved: 1, tags: ["move"] };
  eq(code(await W.req("p1", { op: "endTurn", actor: "H1" })), "ok", "PW094: a glider who moved this turn may end it");
}

/* ============================================================ PW095: a burrower may wreck the zones it passes under [B1995] */
{
  const mk = () => { const T = new MTable(); T.hero("H1", "p1", { movement: [{ mode: "burrowing", tier: "basic" }] }).npc("N1", { health: 5 }); T.put("H1", "z1").put("N1", "z4"); T.order(["H1", "N1"]); return T; };
  const T = mk(), opts = Mv.moveOptions(T.facts().zones, T.state, "H1", T.c.H1).filter((o) => o.mode === "burrowing" && o.to === "z3");
  eq(opts.map((o) => !!o.wreck), [false, true], "PW095 [B1995]: a burrow is offered plain and wrecking");
  ok(both("ITAC.move.wreck"), "PW095: the wrecking way said in both languages");
  eq(code(await T.req("p1", { op: "move", actor: "H1", to: "z3", mode: "burrowing", wreck: true })), "ok", "PW095: the wrecking burrow");
  const wrecked = T.performed.filter((e) => e.t === "zones" && e.op?.patch?.wrecked).map((e) => e.op.zone);
  eq([T.spot("H1"), wrecked.sort()], ["z3", ["z2", "z3"]], "PW095: every zone passed under is wrecked, not the start");
  const U = mk();
  await U.req("p1", { op: "move", actor: "H1", to: "z3", mode: "burrowing" });
  eq(U.performed.filter((e) => e.t === "zones" && e.op?.patch?.wrecked).length, 0, "PW095: a plain burrow wrecks nothing");
}

/* ============================================================ PW099, PW100: Empathy [B2064], Mass Empathy [B2065] */
{
  const T = base([item("em", "Empathy", "power")]);
  const lie = act(T, "H1", "lie");
  ok(!!lie && both("ITAC.kit.act.lie"), "PW099 [B2064]: the lie check is offered, named in both languages");
  eq(code(await T.req("p1", decl("H1", lie.id, { targets: ["N1"] }))), "ok", "PW099: declared");
  const q = T.lastRequest();
  eq([q?.attr, q?.dice], ["intuition", T.c.H1.attrs.intuition + 3], "PW099 [B2064]: INTUITION with +3 dice");
}
{
  const T = base(withB("em", "Empathy", [["me", "Mass Empathy"]]), [], { h2: { resolve: 1 }, n1: { resolve: 5 } });
  T.c.N2.zone = "zFar";
  const r0 = T.c.H1.resolve;
  eq(code(await T.req("p1", decl("H1", act(T, "H1", "mass").id))), "ok", "PW100: Mass Empathy declared");
  await T.roll(T.lastRequest().key, 2);
  for (let i = 0; i < 3; i++) { const p = T.prompts()[0]; if (!p) break; await T.gm({ op: "answerFor", prompt: p.id, value: p.options?.[0]?.id ?? "pass" }); }
  eq([r0 - T.c.H1.resolve, T.c.N1.resolve, T.c.H2.resolve, T.c.N2.resolve], [1, 3, Math.min(T.c.H2.maxResolve, 1 + 6), T.c.N2.maxResolve ?? T.c.N2.resolve], "PW100 [B2065]: 1 stress; an enemy in the zone loses 1 per six, an ally gets 3 per six back; nobody outside the zone");
}

/* ============================================================ PW108: Invisibility ends when broken [B2075] */
{
  const T = base([item("iv", "Invisibility", "power")], [], { h1: { health: 1, maxHealth: 6 }, n1: { slugfest: { damage: 4 } } });
  await T.req("p1", decl("H1", act(T, "H1", "vanish").id));
  ok(st(T, "H1").includes("invisible"), "PW108: invisible");
  T.turn("N1"); T.dice = [[1, 1]];
  await T.gm(decl("N1", "slugfest", { targets: ["H1"] })); await T.roll("gate:0", 3); await pass(T);
  await T.roll("attack", 2); await noStunts(T);
  const hd = T.prompt("heroDead"); if (hd) await T.gm({ op: "answerFor", prompt: hd.id, value: "cap9" });
  eq([st(T, "H1").includes("broken"), st(T, "H1").includes("invisible")], [true, false], "PW108 [B2075]: broken, no longer invisible");
  await T.gm({ op: "endScene", force: true });
  const U = base([item("iv", "Invisibility", "power")]);
  await U.req("p1", decl("H1", act(U, "H1", "vanish").id)); await U.gm({ op: "endScene", force: true });
  eq(st(U, "H1").includes("invisible"), false, "PW108: the scene's end ends it (a few minutes)");
}

/* ============================================================ PW115, PW117: no use buttons for what the engine does itself or what is no combat action */
{
  let n = 0; const use = (name, o = {}) => auto(`u${n++}`, name, "usePower", o);
  const uses = (items) => K.build({ items, attrs: {} }).actions.filter((a) => /-u[0-9]+$/.test(a.id)).map((a) => a.name);
  eq(uses([item("rg", "Regeneration", "power", { autos: [use("Regeneration")] })]), [], "PW115 [B1893]: Regeneration heals by itself, no button");
  eq(uses([item("pr", "Protection", "power", { boosts: ["iv", "ea"] }), item("iv", "Impervious", "boost", { power: "pr", autos: [use("Impervious")] }), item("ea", "Energy Absorption", "boost", { power: "pr", autos: [use("Energy Absorption")] })]), [], "PW115 [B1887-1888]: nor Impervious, nor Energy Absorption");
  eq(uses([item("du", "Duplication", "power", { boosts: ["td"] }), item("td", "Traumatic Duplication", "limit", { power: "du", autos: [use("Traumatic Duplication", { stress: 1 })] })]), [], "PW115 [B1916]: nor Traumatic Duplication");
  const pc = uses([item("pc", "Precognition", "power", { autos: [use("Visions of the Future", { stress: 3 }), use("Short Question", { stress: 1 })] })]);
  eq([pc.some((n) => /visions/i.test(n)), pc.length], [false, 1], "PW117 [B2082]: the minutes-long visions are not offered as a combat action; the rest stays");
}

/* ============================================================ PW098: the dock texts say what the book says */
{
  const fx = (k) => [EN[`ITAC.kit.fx.${k}`] ?? "", PL[`ITAC.kit.fx.${k}`] ?? ""];
  ok(fx("barrier")[0].includes("scene") && fx("barrier")[1].includes("scenę"), "PW098 [B1859]: Barrier: lasts the scene, may be dropped");
  ok(fx("sizealteration")[0].includes("each level") && fx("sizealteration")[1].includes("każdy poziom"), "PW098 [B1974-1979]: Size Alteration: the level steps, one size at a time");
  ok(fx("transformation")[0].includes("weight 4") && fx("transformation")[1].includes("wagi 4"), "PW098 [B1986-1988]: Transformation: the weight limits, the stress steps and the damage by level");
  ok(fx("brachiation")[0].includes("not next to them") && fx("brachiation")[1].includes("nie obok nich"), "PW098 [B2031]: Brachiation: only into high zones");
}

done("check-pwe");
