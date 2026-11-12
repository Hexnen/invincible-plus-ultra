// node scripts/tactics/check-pwb.mjs -- fixer PWB: the powers and boosts the book lets a character use OUT OF TURN (an interrupt
// [B2292], a quick interrupt, the answer to being attacked) that the engine did not offer then. ONE way for all of them:
//   - an act (or a switch) of the kit with `interrupt: ["beforeRoll"]` is declared from the bar while somebody else's attack waits for its
//     dice (engine-pure placement, desk-pure barModel: the field PWA gave Nullification), and
//   - an answer to an attack is a `reaction` of the kit (kit-pure reactionOf) on the reaction card: an attack back (`action` with `vs`
//     and `weapon`), a move away (`moveAway`), a guided defence (`guide`), an escape that makes the attack miss (`autoMiss`).
// The powers are the COMPENDIUM's own items (check-pwb-items.mjs, read 2026-11-12) read by the system adapter's kitSource.
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import { MTable } from "./check-kit-map.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./mods-pure.mjs";
import * as K from "./kit-pure.mjs";
import * as FK from "./flows/kit.mjs";
import * as D from "./desk-pure.mjs";
import * as C from "./catalog-pure.mjs";
import * as UI from "./ui/model-pure.mjs";
import { kitSource } from "./system-adapter.mjs";
import { EN, PL, t } from "./lang.mjs";
import { EN_PWB } from "./lang-pwb.mjs";
import { REAL } from "./check-pwb-items.mjs";

const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const why = (env) => env?.error?.params?.reason ?? null;
const decl = (actor, action, extra = {}) => ({ op: "declare", actor, decl: { action, ...extra } });
/* a compendium item as the adapter reads it (kitSource); `o.fx` = its active effects ({ id, name, disabled }), `o.power` = the power of a boost */
const real = (name, o = {}) => { const r = REAL[name]; if (!r) throw new Error(`no fixture item ${name}`);
  return kitSource({ name: "x", items: [{ id: o.id ?? r.id, name, type: r.type, system: { level: o.level ?? r.level, power: o.power ?? null, boosts: o.boosts ?? [], automations: r.automations }, effects: o.fx ?? [], flags: {} }] }).items[0]; };
const own = (id, name, type, o = {}) => kitSource({ name: "x", items: [{ id, name, type, system: { level: null, power: o.power ?? null, boosts: [], automations: {} }, effects: o.fx ?? [], flags: {} }] }).items[0];
const withKit = (B) => class extends B {
  give(cid, items) { const c = this.c[cid]; c.src = items; c.kit = K.build({ items, attrs: c.attrs }); c.pass = c.kit.pass; if (c.pass.stressArmor) c.armor = [...c.armor.filter((a) => a.id !== "defiance"), { id: "defiance", armor: c.pass.stressArmor, stress: true }]; return this; }
  facts() { const f = super.facts(), T = this; return { ...f, canTalk: () => true, weapon: (cid, ref) => (ref == null || ref === "unarmed" ? { ...f.weapon(cid, ref), ...(T.c[cid]?.kit?.unarmed ?? {}) } : T.c[cid]?.kit?.weapons.find((w) => w.id === ref) ?? f.weapon(cid, ref)) }; }
  async perform(e) {
    if (e.t === "fx" || e.t === "fxSet") {                                                       // the sheet's switch, as the executor turns it
      this.performed.push(e);
      const c = Object.values(this.c).find((x) => x.actorUuid === (e.uuid ?? e.actorUuid)), fx = c?.src?.find((i) => i.id === (e.item ?? e.itemId))?.fx.find((x) => x.id === (e.fx ?? e.effectId));
      if (!fx) return {};
      const from = fx.on; fx.on = e.on; this.give(c.id, c.src);
      return e.t === "fx" ? { op: { t: "fx", actorUuid: c.actorUuid, itemId: e.item, effectId: e.fx, from, to: e.on } } : {};
    }
    return super.perform(e);
  }
};
const KT = withKit(Table), KM = withKit(MTable);
const base = (hItems = [], nItems = [], o = {}) => { const T = new KT(); T.hero("H1", "p1", o.h1 ?? {}).hero("H2", "p2", o.h2 ?? {}).npc("N1", { health: 6, ...(o.n1 ?? {}) }).npc("N2", { health: 4 });
  T.give("H1", hItems).give("H2", o.h2Items ?? []).give("N1", nItems).give("N2", []); T.order(["H1", "N1", "H2", "N2"]).turn(o.turn ?? "N1"); return T; };
const act = (T, cid, k) => T.c[cid].kit.actions.find((a) => a.id.endsWith(`-${k}`));
const wOf = (T, cid, pred) => T.c[cid].kit.weapons.find(pred);
const bar = (T, cid) => D.barModel(T.state, cid, { P1, kit: (id) => T.c[id]?.kit, c: (id) => T.c[id] });
const onBar = (T, cid, id) => bar(T, cid).actions.find((a) => a.id === id) ?? null;
const opts = (p) => (p?.options ?? []).map((o) => o.id);
const quickUsed = (T, cid) => P1.budget(T.state, cid).quick.includes("used");
const pass = async (T, about = null) => { for (const p of T.prompts("reaction").filter((x) => !about || x.about === about)) await T.gm({ op: "answerFor", prompt: p.id, value: "pass" }); };
const noStunts = async (T) => { for (const p of T.prompts("stunts")) await T.gm({ op: "answerFor", prompt: p.id, value: [] }); };

/* ================================================================== the one mechanism: what the rows give */
{
  const T = base([real("Barrier")]);
  const ba = act(T, "H1", "barrier");
  eq([ba.cost, ba.interrupt?.on, !!ba.reactionOnly], ["quick", ["beforeRoll"], false], "PWB: an act the book allows as an interrupt carries the window it may answer (the field of PWA's Nullification)");
  for (const [k, eff, who] of [["quickBlast", "action", "target"], ["suddenStrike", "action", "target"], ["travelAway", "autoMiss", "target"], ["guideDefence", "guide", "any"], ["redirect", "action", "target"], ["dash", "moveAway", "target"], ["blink", "moveAway", "target"]]) {
    ok(C.REACTION_EFFECTS.includes(eff), `PWB: the reaction effect ${eff} is known to the catalog (${k})`);
    ok(!!EN_PWB[`ITAC.kit.act.${k}`] && !!PL[`ITAC.kit.act.${k}`] && PL[`ITAC.kit.act.${k}`] !== EN[`ITAC.kit.act.${k}`], `PWB: the answer ${k} has its words in both languages`);
    void who;
  }
  for (const k of Object.keys(EN_PWB)) ok(!!PL[k], `PWB: ${k} has a Polish text`);
}

/* ================================================================== PW060 [B1859], [B2292]: Barrier as an interrupt action (a quick action,
   out of turn, declared before the dice of somebody else's action). Nothing open: nothing to interrupt (notYourTurn, as P8e-R1). */
{
  const T = base([real("Barrier")]);
  const ba = act(T, "H1", "barrier");
  eq(code(await T.req("p1", decl("H1", ba.id, { targets: ["H2"] }))), "notYourTurn", "PW060: on N1's turn with nothing to interrupt the barrier waits (an interrupt answers a declared action [B2292])");
  eq(onBar(T, "H1", ba.id)?.disabled, "notYourTurn", "PW060: the bar says so");
  eq(code(await T.gm(decl("N1", "slugfest", { targets: ["H2"] }))), "ok", "PW060: N1 attacks H2");
  eq(onBar(T, "H1", ba.id)?.disabled ?? null, null, "PW060: while the attack waits for its dice the bar offers the barrier");
  eq(code(await T.req("p1", decl("H1", ba.id, { targets: ["H2"] }))), "ok", "PW060 [B1859]: raised as an interrupt");
  ok(quickUsed(T, "H1"), "PW060: it costs H1 its quick action [B2292]");
  eq(FK.barriersOf(T.state, "H2").map((b) => b.armor), [3], "PW060: H2 stands behind a barrier of Armor 3 before N1 rolls");
  eq(T.top()?.actor, "N1", "PW060: then N1's attack goes on");
  await pass(T); await T.roll("attack", 1); await noStunts(T);
  eq(T.c.H2.health, 6, "PW060: N1's blow (damage 2) stops on the barrier");
  const U = base([real("Barrier")]);
  await U.gm(decl("N1", "slugfest", { targets: ["H2"] })); await U.answer("p2", "reaction", "block", "H2"); await U.roll("attack", 1);
  eq([U.state.stack.length, U.top()?.locked], [1, true], "PW060: N1's attack stands on its dice (H2's block not rolled yet)");
  eq(code(await U.req("p1", decl("H1", act(U, "H1", "barrier").id, { targets: ["H2"] }))), "busy", "PW060 [B2292]: after the first die it is too late");
}

/* ================================================================== PW015 [B1646], [B1650]: the ice barrier and Ice Armor as interrupt actions */
{
  const cc = real("Cold Control"), items = () => [cc, real("Ice Armor", { power: cc.id, fx: [{ id: "iafx", name: "Ice Armor", disabled: true }] })];
  const T = base(items());
  const bar1 = act(T, "H1", "barrier"), ia = act(T, "H1", "fx0");
  eq([bar1.interrupt?.on, ia.interrupt?.on, ia.cost], [["beforeRoll"], ["beforeRoll"], "quick"], "PW015: both may be used as interrupts");
  await T.gm(decl("N1", "slugfest", { targets: ["H1"] }));
  eq(code(await T.req("p1", decl("H1", ia.id))), "ok", "PW015 [B1650]: Ice Armor switched on as an interrupt of the attack on H1");
  eq([T.c.H1.src[1].fx[0].on, quickUsed(T, "H1")], [true, true], "PW015: the effect is on, the quick action spent");
  const U = base(items());
  await U.gm(decl("N1", "slugfest", { targets: ["H2"] }));
  eq(code(await U.req("p1", decl("H1", act(U, "H1", "barrier").id, { targets: ["H2"] }))), "ok", "PW015 [B1646]: the ice barrier raised on H2 as an interrupt");
  eq(FK.barriersOf(U.state, "H2").map((b) => b.armor), [3], "PW015: Armor 3");
}

/* ================================================================== PW003 [B1601]: Emanation switched on "even as an interrupt" */
{
  const T = base([real("Emanation", { fx: [{ id: "emfx", name: "Emanation", disabled: true }] })]);
  const em = act(T, "H1", "fx0");
  await T.gm(decl("N1", "slugfest", { targets: ["H1"] }));
  eq(onBar(T, "H1", em.id)?.disabled ?? null, null, "PW003: the bar offers the aura while N1's blow waits for its dice");
  eq(code(await T.req("p1", decl("H1", em.id))), "ok", "PW003 [B1601]: switched on as an interrupt");
  eq(T.c.H1.src[0].fx[0].on, true, "PW003: the aura is on");
}

/* ================================================================== PW065 [B1869], [B1890]: Requires Activation (Defiance, Protection):
   activated as a quick action on the own turn OR as an interrupt */
{
  const df = real("Defiance");
  const T = base([df, own("radf", "Requires Activation (Defiance)", "limit", { power: df.id })]);
  const ac = act(T, "H1", "activate");
  await T.gm(decl("N1", "slugfest", { targets: ["H1"] }));
  eq(code(await T.req("p1", decl("H1", ac.id))), "ok", "PW065 [B1869]: Defiance activated as an interrupt");
  ok(FK.marked(T.state, "H1", "defiance", true), "PW065: Defiance counts from now on");
  const pr = real("Protection", { fx: [{ id: "prfx", name: "Protection", disabled: true }] });
  const U = base([pr, own("rapr", "Requires Activation (Protection)", "limit", { power: pr.id })]);
  const tg = act(U, "H1", "fx0");
  eq(tg?.interrupt?.on, ["beforeRoll"], "PW065: the Protection switch may be an interrupt");
  await U.gm(decl("N1", "slugfest", { targets: ["H1"] }));
  eq(code(await U.req("p1", decl("H1", tg.id))), "ok", "PW065 [B1890]: Protection activated as an interrupt");
  eq(U.c.H1.src[0].fx[0].on, true, "PW065: its effect is on");
}

/* ================================================================== PW002, PW112 [B1585]: Quick Blast: when targeted by a SHOOTING attack,
   1 stress, a shooting attack as a quick interrupt before the attack is resolved; it counts toward the actions of the round */
{
  const bl = real("Blast"), qb = real("Quick Blast", { power: bl.id }), nb = real("Blast", { id: "npcBlast0000001" });
  const T = base([bl, qb], [nb]);
  const q = T.c.H1.kit.actions.find((a) => a.id.endsWith("-quickBlast"));
  ok(!!q && q.reactionOnly === 1 && q.flow === "attack" && q.attack === "shooting", "PW002: Quick Blast is an answer that is a shooting attack");
  eq(q.reaction.weapon, wOf(T, "H1", (w) => w.of === "Blast" && !w.tag && !w.opt).id, "PW002: made with the Blast's own profile");
  ok(!bar(T, "H1").actions.some((a) => a.id === q.id), "PW002: never on the bar (an answer only)");
  await T.gm(decl("N1", "shoot", { targets: ["H1"], weapon: wOf(T, "N1", (w) => w.of === "Blast").id }));
  const rp = T.prompt("reaction", "H1");
  ok(opts(rp).includes(`r:${q.id}`), "PW002: H1's card offers Quick Blast against the shot");
  eq(code(await T.req("p1", { op: "answer", prompt: rp.id, value: `r:${q.id}` })), "ok", "PW002: answered");
  eq(T.state.stack.map((i) => [i.actor, i.cause]), [["N1", "turn"], ["H1", "interrupt"]], "PW002: H1's shot goes on top, before N1's is resolved");
  eq([quickUsed(T, "H1"), T.c.H1.resolve], [true, 4], "PW002: a quick action and 1 stress");
  eq(T.top().decl.weapon, q.reaction.weapon, "PW002: with the Blast");
  await pass(T, "N1"); await T.roll("attack", 1); await noStunts(T);
  eq(T.c.N1.health, 3, "PW002: the Blast (damage 3) lands on N1 first");
  eq(T.top()?.actor, "N1", "PW002: then N1's shot goes on");
  const U = base([bl, qb], [nb]);
  await U.gm(decl("N1", "slugfest", { targets: ["H1"] }));
  ok(!opts(U.prompt("reaction", "H1")).some((o) => o.includes("quickBlast")), "PW002 [B1585]: not against a blow in slugfest");
}

/* ================================================================== PW112 [B1619]: Sudden Strike: when attacked in slugfest, 1 stress, a
   slugfest attack as a quick interrupt before the attack is resolved */
{
  const sk = real("Strike"), ss = real("Sudden Strike", { power: sk.id }), nb = real("Blast", { id: "npcBlast0000001" });
  const T = base([sk, ss], [nb]);
  const s = T.c.H1.kit.actions.find((a) => a.id.endsWith("-suddenStrike"));
  eq([s?.flow, s?.attack, s?.reaction?.weapon, s?.reaction?.vs], ["attack", "slugfest", "unarmed", "slugfest"], "PW112: Sudden Strike answers a blow with the bare (Strike) blow");
  await T.gm(decl("N1", "slugfest", { targets: ["H1"] }));
  const rp = T.prompt("reaction", "H1");
  eq(code(await T.req("p1", { op: "answer", prompt: rp.id, value: `r:${s.id}` })), "ok", "PW112: answered with Sudden Strike");
  eq([T.top()?.actor, T.top()?.cause, T.top()?.decl.targets, T.c.H1.resolve, quickUsed(T, "H1")], ["H1", "interrupt", ["N1"], 4, true], "PW112: H1 strikes N1 first, for a quick action and 1 stress");
  await pass(T, "N1"); await T.roll("attack", 1); await noStunts(T);
  eq(T.c.N1.health, 4, "PW112: the bare blow lands first");
  const again = T.prompt("reaction", "H1");
  eq([T.top()?.actor, opts(again).includes("block"), opts(again).some((o) => o.includes("suddenStrike"))], ["N1", true, false], "PWB: back in N1's attack H1 may still block with its other quick action [B2292], not strike first twice");
  const U = base([sk, ss], [nb]);
  await U.gm(decl("N1", "shoot", { targets: ["H1"], weapon: wOf(U, "N1", (w) => w.of === "Blast").id }));
  ok(!opts(U.prompt("reaction", "H1")).some((o) => o.includes("suddenStrike")), "PW112 [B1619]: not against a shot");
}

/* ================================================================== PW112 [B1889]: Redirecting Blast: when the Protection absorbs damage, a
   quick interrupt fires a shot back with Damage equal to what was absorbed, Range 0/3; never an ordinary attack */
{
  const pr = real("Protection"), rb = real("Redirecting Blast", { power: pr.id });
  const T = base([pr, rb], [], { h1: { armor: [{ id: "prot", armor: 3 }] }, n1: { damage: 5 }, turn: "H1" });
  const w = wOf(T, "H1", (x) => x.item === rb.id), r = act(T, "H1", "redirect");
  eq([w?.reactOnly, w?.range, r?.reaction?.when, r?.reaction?.weapon], [true, [0, 3], ["afterDamage"], w?.id], "PW112: its own profile, Range 0/3, used after the damage");
  const own0 = await T.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: w.id }));
  eq([code(own0), why(own0)], ["illegal", "answerOnly"], "PW112: not a shot of its own on the own turn (the finding: a plain attack)");
  T.turn("N1");
  await T.gm(decl("N1", "slugfest", { targets: ["H1"] })); await pass(T); await T.roll("attack", 1); await noStunts(T);
  eq(T.c.H1.health, 4, "PW112: N1's blow of 5 against Armor 3: 2 through");
  const rp = T.prompt("reaction", "H1");
  ok(opts(rp).includes(`r:${r.id}`), "PW112: after the damage H1's card offers Redirecting Blast");
  await T.req("p1", { op: "answer", prompt: rp.id, value: `r:${r.id}` });
  eq([T.top()?.actor, T.top()?.data?.fixedDamage, quickUsed(T, "H1")], ["H1", 3, true], "PW112: the shot back carries the 3 points absorbed, for a quick action");
  await pass(T, "N1"); await T.roll("attack", 1); await noStunts(T);
  eq(T.c.N1.health, 3, "PW112 [B1889]: Damage equal to the damage absorbed (3), not the slugfest damage");
  const U = base([pr, rb], [], { n1: { damage: 5 } });
  await U.gm(decl("N1", "slugfest", { targets: ["H1"] })); await pass(U); await U.roll("attack", 1); await noStunts(U);
  ok(!opts(U.prompt("reaction", "H1")).some((o) => o.includes("redirect")), "PW112: no Armor, nothing absorbed: nothing to fire back");
}

/* ================================================================== PW026, PW111 [B1663-1664]: Quick Travel: 1 stress, travel as a quick
   interrupt action; in answer to an attack the attack misses */
{
  const dt = real("Dimensional Travel"), qt = real("Quick Travel", { power: dt.id });
  const T = base([dt, qt], [], { turn: "H1" });
  const tr = act(T, "H1", "travel"), aw = act(T, "H1", "travelAway");
  eq([tr?.cost, tr?.stress?.fixed, tr?.interrupt?.on], ["quick", 1, ["beforeRoll"]], "PW111: a quick action for 1 stress, also as an interrupt (was a full action)");
  eq(code(await T.req("p1", decl("H1", tr.id))), "ok", "PW026: on the own turn");
  eq([P1.budget(T.state, "H1").full, quickUsed(T, "H1"), T.c.H1.resolve], ["open", true, 4], "PW026: the quick action, not the full one; 1 stress");
  const U = base([dt, qt]);
  await U.gm(decl("N1", "slugfest", { targets: ["H1"] }));
  const rp = U.prompt("reaction", "H1");
  ok(opts(rp).includes(`r:${aw.id}`), "PW026: H1's card offers the escape to another dimension");
  await U.req("p1", { op: "answer", prompt: rp.id, value: `r:${aw.id}` });
  await U.roll("attack", 3); await noStunts(U);
  eq([U.c.H1.health, U.c.H1.resolve, quickUsed(U, "H1")], [6, 4, true], "PW026 [B1664]: the attack misses automatically; 1 stress and the quick action spent");
  const V = base([dt, qt]);
  await V.gm(decl("N1", "slugfest", { targets: ["H2"] }));
  eq(code(await V.req("p1", decl("H1", act(V, "H1", "travel").id))), "ok", "PW026: breaking the turn order: an interrupt of somebody else's action");
}

/* ================================================================== PW090 [B2018], [B2039]: Untouchable Speed, Quick Teleport: 1 stress, a
   move as a quick interrupt; out of range of the attack, it misses automatically */
{
  const setup = (boost, mode, power, n1Items = []) => {
    const pw = real(power), b = real(boost, { power: pw.id });
    const T = new KM(); T.hero("H1", "p1", { movement: [{ mode, tier: "basic" }] }).npc("N1", { health: 6 });
    T.put("H1", "z1").put("N1", "z1"); T.give("H1", [pw, b]).give("N1", n1Items); T.order(["H1", "N1"]).turn("N1"); return T;
  };
  for (const [boost, mode, power, k] of [["Untouchable Speed", "superSpeed", "Super-Speed", "dash"], ["Quick Teleport", "teleportation", "Teleportation", "blink"]]) {
    const T = setup(boost, mode, power), a = act(T, "H1", k);
    eq([a?.reaction?.effect, a?.reaction?.mode, a?.stress?.fixed, a?.cost], ["moveAway", mode, 1, "quick"], `PW090: ${boost} answers an attack with a move (${mode}) for 1 stress`);
    await T.gm(decl("N1", "slugfest", { targets: ["H1"] }));
    const rp = T.prompt("reaction", "H1");
    ok(opts(rp).includes(`r:${a.id}`), `PW090: ${boost} is on H1's card`);
    await T.req("p1", { op: "answer", prompt: rp.id, value: `r:${a.id}` });
    eq([quickUsed(T, "H1"), T.c.H1.resolve], [true, 4], `PW090: ${boost}: a quick action and 1 stress`);
    const mp = T.prompt("dodgeMove", "H1");
    ok(!!mp?.data?.away && opts(mp).includes(`${mode}|z2`), `PW090: ${boost}: H1 is asked where to, by ${mode}`);
    const card = UI.askData(mp, { t, facts: { c: (id) => T.c[id] }, own: {} });
    eq([card.title, card.lines?.[0]], [EN["ITAC.prompt.awayMove"], "H1 gets clear: pick where to."], `PW090: ${boost}: the card asks where to (not "after the dodge")`);
    await T.req("p1", { op: "answer", prompt: mp.id, value: `${mode}|z2` });
    eq(T.spot("H1"), "z2", `PW090: ${boost}: H1 is in the next zone before N1 rolls`);
    await T.roll("attack", 3); await noStunts(T);
    eq(T.c.H1.health, 6, `PW090 [${boost === "Quick Teleport" ? "B2039" : "B2018"}]: out of reach, the blow misses automatically`);
    ok(T.state.news.some((n) => (n.reacts ?? []).some((r) => r.who === "H1" && r.result === "away")), `PW090: ${boost}: the news says why it missed`);
  }
  const nb = real("Blast", { id: "npcBlast0000001" }), T = setup("Untouchable Speed", "superSpeed", "Super-Speed", [nb]), a = act(T, "H1", "dash");
  await T.gm(decl("N1", "shoot", { targets: ["H1"], weapon: wOf(T, "N1", (w) => w.of === "Blast").id }));
  await T.req("p1", { op: "answer", prompt: T.prompt("reaction", "H1").id, value: `r:${a.id}` });
  await T.req("p1", { op: "answer", prompt: T.prompt("dodgeMove", "H1").id, value: "superSpeed|z2" });
  ok(opts(T.prompt("reaction", "H1")).includes("dodge"), "PW090: still in reach, H1 may still dodge with its other quick action");
  await pass(T, "H1"); await T.roll("attack", 1); await noStunts(T);
  eq(T.c.H1.health, 3, "PW090: still within the Blast's range (0/3): the shot goes on and hits");
}

/* ================================================================== PW034, PW121 [B1709]: Guidance: a quick interrupt PRESENCE roll lets another
   hero block or dodge an attack without spending an action of their own */
{
  const T = base([real("Guidance")]);
  const g = act(T, "H1", "guideDefence");
  eq([g?.cost, g?.reaction?.effect, g?.reaction?.who, g?.roll?.attr], ["quick", "guide", "any", "presence"], "PW034: the second use of Guidance is an answer for somebody else");
  await T.gm(decl("N1", "slugfest", { targets: ["H2"] }));
  const card = T.prompts("reaction").find((p) => p.about === "H1");
  ok(opts(card).includes(`r:${g.id}`), "PW034: H1 (a bystander) is offered to guide H2");
  await T.req("p1", { op: "answer", prompt: card.id, value: `r:${g.id}` });
  ok(quickUsed(T, "H1"), "PW034: the guide's quick action is spent");
  await T.roll(`gd:H1`, 1);
  const h2 = T.prompt("reaction", "H2");
  ok(opts(h2).includes("block:warned"), "PW034: on a success H2 may block without an action");
  eq(EN[h2.options.find((o) => o.id === "block:warned")?.label], "Block, no action (guided)", "PW034: said as a guided block (no Warning Call dice)");
  await T.req("p2", { op: "answer", prompt: h2.id, value: "block:warned" });
  eq(quickUsed(T, "H2"), false, "PW121 [B1709]: H2 spent no action of its own");
  const def = T.top()?.data?.def?.H2;
  eq(def?.free, "warned", "PW121: the block is the free one");
  ok(!(T.top()?.data?.warned?.H2?.dice), "PW121: and it brings no extra dice");
  const U = base([real("Guidance")]);
  await U.gm(decl("N1", "slugfest", { targets: ["H2"] }));
  await U.req("p1", { op: "answer", prompt: U.prompts("reaction").find((p) => p.about === "H1").id, value: `r:${g.id}` });
  await U.roll(`gd:H1`, 0);
  ok(!opts(U.prompt("reaction", "H2")).includes("block:warned"), "PW034: without a six H2 defends as usual");
}

done("check-pwb");
