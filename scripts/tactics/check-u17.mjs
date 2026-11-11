/* node scripts/tactics/check-u17.mjs -- ledger row U90 of dev/combat-usability.md (ruling U17-R1).
   The "additional opponent in the same zone" of Bang Heads [B2437] and Trick Shot [B2518] is somebody of the side of the target that was
   hit, never an ally of the attacker. Through the REAL director, engine, ledger and journal (testkit Table):
     A. a hero hits an enemy: the other enemy is offered, the other hero is not (the case seen live), and naming the ally is refused
     B. an enemy hits a hero: the other hero is offered, the other enemy is not
     C. Trick Shot, both ways
     D. a figure the GM keeps hidden, and one the attacker has not seen, is not on the hero's card, cannot be named, and is not counted
     E. a challenge, a vehicle and somebody defeated are no opponents
     F. minion groups: an enemy group is an opponent; a hero's summoned allies are the heroes' side [B1808]
     G. the counterattack [B2448]: the opponents of the one who strikes back
     H. somebody who attacks their own side: the others of that side (ruling U17-R2) */
import { Table, ok, eq, done } from "./testkit.mjs";
import * as V from "./view-pure.mjs";
import * as C from "./catalog-pure.mjs";
import * as Attack from "./flows/attack.mjs";

const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const why = (env) => env?.error?.params?.reason ?? null;
const decl = (actor, action, targets, extra = {}) => ({ op: "declare", actor, decl: { action, targets, ...extra } });
const pass = async (T) => { for (const p of T.prompts("reaction")) await T.req(p.to === "gm" ? "gm" : p.to.users[0], { op: p.to === "gm" ? "answerFor" : "answer", prompt: p.id, value: "pass" }); };
const GUN = { id: "gun", bonus: 0, damage: 3, range: [0, 1] };
/* Omni-Man and Kid Omni-Man (heroes) against two enemies, everybody in one zone */
const base = (extra = () => {}, order = ["H1", "N1", "H2", "N2"]) => { const T = new Table(); T.hero("H1", "p1", { name: "Omni-Man" }).hero("H2", "p2", { name: "Kid Omni-Man" }).npc("N1", { health: 6 }).npc("N2", { health: 6 }); T.weapons.gun = GUN; extra(T); T.order(order); return T; };
/* the stunt card after `who` hit `target` with `sixes` sixes: its prompt, the ids, the extra opponents named for a stunt, those who may take a stunt as an extra */
async function card(T, user, who, action, target, sixes = 4, more = {}) {
  eq(code(await T.req(user, decl(who, action, [target], more))), "ok", `${who} -> ${target}: declared`);
  await pass(T);
  await T.roll("attack", sixes);
  const sp = T.prompt("stunts"), opts = sp?.options ?? [];
  return { sp, opts, ids: opts.map((o) => o.id), extras: (stunt) => opts.filter((o) => o.data?.stunt === stunt && o.data.extra).map((o) => o.data.extra).sort(), onExtra: [...new Set(opts.filter((o) => o.data?.onExtra).map((o) => o.data.target))].sort() };
}
const answer = (T, user, sp, value) => T.req(user, { op: user === "gm" ? "answerFor" : "answer", prompt: sp.id, value });
const view = (T) => ({ state: T.state, facts: T.facts(), entry: (inst) => C.entryFor(T.state, inst.actor, inst.action, T.facts()) });
const meta = (T) => ({ hidden: Object.values(T.c).filter((c) => c.hidden).map((c) => c.id), npc: Object.values(T.c).filter((c) => c.npc).map((c) => c.id) });

/* ---- A. the case seen live: Omni-Man hits an enemy, Kid Omni-Man stands beside */
{
  const T = base();
  const c = await card(T, "p1", "H1", "slugfest", "N1");
  eq([c.sp?.to, c.extras("bangHeads"), c.onExtra], [{ users: ["p1"] }, ["N2"], ["N2"]], "A: Bang Heads names the other enemy only; no stunt is offered on the ally");
  ok(!c.ids.some((id) => id.includes("H2")), "A: the ally is nowhere on the card");
  const hp = T.c.H2.health;
  eq(code(await answer(T, "p1", c.sp, ["bangHeads@N1|H2"])), "badInput", "A: an answer that names the ally is no answer of this card");
  eq(code(await answer(T, "p1", c.sp, ["bangHeads@N1|N2", "stun@H2"])), "badInput", "A: no stunt on the ally by the back door");
  eq(code(await answer(T, "gm", c.sp, ["bangHeads@N1|H2"])), "badInput", "A: the GM's hand on the card follows the same rule");
  eq([Attack.validate(view(T), T.top(), c.sp, ["bangHeads@N1|H2"]).reason, Attack.validate(view(T), T.top(), c.sp, ["bangHeads@N1|H2"], true).reason, Attack.validate(view(T), T.top(), c.sp, ["bangHeads@N1|N2"]).ok], ["noOtherTarget", "noOtherTarget", true], "A: the flow's own rule says why: the ally is no other opponent (for the GM too)");
  eq(code(await answer(T, "p1", c.sp, ["bangHeads@N1|N2"])), "ok", "A: the other enemy is taken");
  eq([T.c.H2.health, T.c.N2.health < 6], [hp, true], "A: the ally is unhurt, the other enemy took the blow");
}
{
  const T = base();
  const c = await card(T, "p1", "H1", "slugfest", "N1");
  let env;
  T.c.N2.zone = "z2";                                                                            // the card is open; the other enemy is moved away
  eq([code(env = await answer(T, "p1", c.sp, ["bangHeads@N1|N2"])), why(env)], ["illegal", "noOtherTarget"], "A: what the card offered is asked again when it is answered: the opponent is gone");
}
{
  const T = base((t) => { t.c.N2.zone = "z2"; });
  const c = await card(T, "p1", "H1", "slugfest", "N1");
  eq([c.extras("bangHeads"), c.opts.find((o) => o.id === "bangHeads@N1")?.disabled ?? null, c.onExtra], [[], "noOtherTarget", []], "A: with only an ally beside the target Bang Heads cannot be taken: no other opponent");
}

/* ---- B. the other way round: an enemy hits a hero */
{
  const T = base(() => {}, ["N1", "H1", "H2", "N2"]);
  const c = await card(T, "gm", "N1", "slugfest", "H1");
  eq([c.sp?.to, c.extras("bangHeads"), c.onExtra], ["gm", ["H2"], ["H2"]], "B: an enemy's Bang Heads names the other hero, never the enemy's own ally");
  eq([code(await answer(T, "gm", c.sp, ["bangHeads@H1|N2"])), Attack.validate(view(T), T.top(), c.sp, ["bangHeads@H1|N2"], true).reason], ["badInput", "noOtherTarget"], "B: the enemy's ally cannot be named");
  const hp = T.c.N2.health;
  eq(code(await answer(T, "gm", c.sp, ["bangHeads@H1|H2"])), "ok", "B: the other hero is taken");
  eq(T.c.N2.health, hp, "B: the enemy's ally is unhurt");
}

/* ---- C. Trick Shot [B2518] */
{
  const T = base();
  const c = await card(T, "p1", "H1", "shoot", "N1", 3, { weapon: "gun" });
  eq([c.extras("trickShot"), c.onExtra], [["N2"], ["N2"]], "C: a hero's Trick Shot goes on to the other enemy only");
  eq([code(await answer(T, "p1", c.sp, ["trickShot@N1|H2"])), Attack.validate(view(T), T.top(), c.sp, ["trickShot@N1|H2"]).reason], ["badInput", "noOtherTarget"], "C: not into the ally");
  eq(code(await answer(T, "p1", c.sp, ["trickShot@N1|N2"])), "ok", "C: into the other enemy");
}
{
  const T = base(() => {}, ["N1", "H1", "H2", "N2"]);
  const c = await card(T, "gm", "N1", "shoot", "H1", 3, { weapon: "gun" });
  eq([c.extras("trickShot"), c.onExtra], [["H2"], ["H2"]], "C: an enemy's Trick Shot goes on to the other hero only");
}

/* ---- D. nobody the attacker's player may not know of */
{
  const T = base((t) => { t.npc("NX9", { name: "Lurker", hidden: true }); }, ["H1", "N1", "H2", "N2", "NX9"]);
  const c = await card(T, "p1", "H1", "slugfest", "N1");
  eq([c.extras("bangHeads"), c.onExtra], [["N2"], ["N2"]], "D: an enemy the GM keeps hidden is not offered to a hero");
  eq([code(await answer(T, "p1", c.sp, ["bangHeads@N1|NX9"])), Attack.validate(view(T), T.top(), c.sp, ["bangHeads@N1|NX9"]).reason], ["badInput", "noOtherTarget"], "D: and cannot be named");
  ok(!JSON.stringify(V.viewFor(T.state, { id: "p1", staff: false, owns: ["H1"] }, meta(T))).includes("NX9"), "D: the player's view holds no trace of the hidden one");
}
{
  const T = base((t) => { t.c.N2.hidden = true; });
  const c = await card(T, "p1", "H1", "slugfest", "N1");
  eq([c.extras("bangHeads"), c.opts.find((o) => o.id === "bangHeads@N1")?.disabled ?? null], [[], "noOtherTarget"], "D: a hidden enemy is not counted either: the card says there is no other opponent, exactly as in an empty zone");
}
{
  const T = base();
  await T.gm({ op: "knowledgeSet", observer: "H1", subject: "N2", value: "unseen" });
  const c = await card(T, "p1", "H1", "slugfest", "N1");
  eq([c.extras("bangHeads"), c.onExtra], [[], []], "D: an enemy the attacker has not seen is not offered");
  eq([code(await answer(T, "p1", c.sp, ["bangHeads@N1|N2"])), Attack.validate(view(T), T.top(), c.sp, ["bangHeads@N1|N2"]).reason], ["badInput", "noOtherTarget"], "D: and cannot be named");
}
{
  const T = base((t) => { t.c.H2.hidden = true; }, ["N1", "H1", "H2", "N2"]);
  const c = await card(T, "gm", "N1", "slugfest", "H1");
  eq(c.extras("bangHeads"), ["H2"], "D: the GM's own card (an NPC attacks) names a hidden figure of the other side: the GM knows it");
}
{
  const T = base(() => {}, ["N1", "H1", "H2", "N2"]);
  await T.gm({ op: "knowledgeSet", observer: "N1", subject: "H2", value: "unseen" });
  const c = await card(T, "gm", "N1", "slugfest", "H1");
  eq(c.extras("bangHeads"), [], "D: an NPC that has not seen the other hero cannot slam its target into that hero");
}

/* ---- E. things and the defeated are no opponents */
{
  const T = base((t) => { t.npc("C1", { kind: "challenge", name: "Fire" }).npc("V1", { kind: "vehicle", name: "Van" }).npc("N3", { name: "Down" }); t.c.N3.present = false; t.c.N3.defeated = true; });
  const c = await card(T, "p1", "H1", "slugfest", "N1");
  eq([c.extras("bangHeads"), c.onExtra], [["N2"], ["N2"]], "E: a challenge, a vehicle and a defeated enemy are not offered");
  for (const x of ["C1", "V1", "N3"]) eq([code(await answer(T, "p1", c.sp, [`bangHeads@N1|${x}`])), Attack.validate(view(T), T.top(), c.sp, [`bangHeads@N1|${x}`]).reason], ["badInput", "noOtherTarget"], `E: ${x} cannot be named`);
}

/* ---- F. minion groups [B2825-2831], summoned allies [B1808] */
{
  const T = base((t) => { t.npc("M1", { kind: "minions", health: 5, maxHealth: 5, members: 5, name: "Thugs" }); t.add("S1", { kind: "minions", owners: ["p1"], npc: false, summonOf: "H1", health: 3, maxHealth: 3, members: 3, name: "Omni-Man: allies" }); }, ["H1", "N1", "H2", "N2", "M1"]);
  const c = await card(T, "p1", "H1", "slugfest", "N1");
  eq(c.extras("bangHeads"), ["M1", "N2"], "F: an enemy minion group is an opponent; the hero's summoned allies are not");
  eq(code(await answer(T, "p1", c.sp, ["bangHeads@N1|M1"])), "ok", "F: the group is taken");
  eq([T.prompt("minionLoss")?.to, T.prompt("minionLoss")?.about], ["gm", "M1"], "F: how many of the group fall is the GM's number [OQ-1]");
}
{
  const T = base((t) => { t.npc("M1", { kind: "minions", health: 5, maxHealth: 5, members: 5 }); t.add("S1", { kind: "minions", owners: ["p1"], npc: false, summonOf: "H1", health: 3, maxHealth: 3, members: 3 }); }, ["M1", "H1", "N1", "H2", "N2"]);
  const c = await card(T, "gm", "M1", "slugfest", "H1");
  eq(c.extras("bangHeads"), ["H2", "S1"], "F: an enemy group's Bang Heads names the heroes' side, the summoned allies among them, and no enemy");
}
{
  const T = base((t) => { t.add("S1", { kind: "minions", owners: ["p1"], npc: false, summonOf: "H1", health: 3, maxHealth: 3, members: 3 }); }, ["H2", "N1", "H1", "N2"]);
  const c = await card(T, "p2", "H2", "slugfest", "N1");
  eq(c.extras("bangHeads"), ["N2"], "F: another hero's summoned allies are allies too");
}

/* ---- G. the counterattack [B2448] */
{
  const T = base(() => {}, ["N1", "H1", "H2", "N2"]);
  eq(code(await T.req("gm", decl("N1", "slugfest", ["H1"]))), "ok", "G: an enemy attacks the hero");
  const rp = T.prompt("reaction", "H1");
  eq(code(await T.req("p1", { op: "answer", prompt: rp.id, value: "block" })), "ok", "G: the hero blocks");
  await pass(T);
  await T.roll("attack", 1); await T.roll("def:H1", 4);
  eq(code(await T.answer("p1", "counter", "counter", "H1")), "ok", "G: with sixes to spare the hero strikes back");
  const sp = T.prompt("stunts"), ex = (sp?.options ?? []).filter((o) => o.data?.stunt === "bangHeads" && o.data.extra).map((o) => o.data.extra);
  eq([sp?.about, sp?.to, ex], ["H1", { users: ["p1"] }, ["N2"]], "G: the hero who strikes back may slam the attacker into the other enemy, not into the ally");
}

/* ---- H. somebody who attacks their own side (ruling U17-R2) */
{
  const T = base((t) => { t.hero("H3", "p3"); }, ["H1", "N1", "H2", "N2", "H3"]);
  const c = await card(T, "p1", "H1", "slugfest", "H2");
  eq(c.extras("bangHeads"), ["H3"], "H: a hero who strikes a hero has that side for opponents: the third hero, no enemy");
}
{
  const T = base((t) => { t.npc("N3"); }, ["N1", "H1", "H2", "N2", "N3"]);
  const c = await card(T, "gm", "N1", "slugfest", "N2");
  eq(c.extras("bangHeads"), ["N3"], "H: an NPC that strikes an NPC has the NPCs for opponents, no hero");
}
done("check-u17");
