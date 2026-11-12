/* node scripts/tactics/check-u19.mjs -- ledger row U91 of dev/combat-usability.md (rulings U19-R1 .. U19-R8).
   Guardian [B2115]: when ANOTHER character IN THE GUARDIAN'S ZONE is attacked, the guardian may dive in as a quick interrupt action, rolls
   FIGHTING against a slugfest attack or AGILITY against shooting, and takes the hit only on a success. Before U91 the card went to a
   guardian anywhere on the map and the answer moved the attack without a roll. Through the REAL director, engine, ledger and journal:
     A. same zone: offered, paid with a quick action, the roll (attribute by the attack), success moves the attack, failure does not
     B. another zone: no card (both ways: the guardian away, the attacked one away)
     C. the guardian (or the attacked one) is moved away between the card and the answer: refused with the reason, nothing paid; the GM's hand stands
     D. somebody hidden or unseen is not given away by the card
     E. both sides: an NPC guardian is asked through the GM under the same rule
     F. the data of the rule: a granted entry, the catalog's normaliser
     G. Discretion [B2108]: only with an ally in the target's own zone
     H. Warning Call [B2170] ("within hearing range"): no zone asked; nobody unseen named */
import { Table, ok, eq, done } from "./testkit.mjs";
import * as V from "./view-pure.mjs";
import * as C from "./catalog-pure.mjs";
import * as KP from "./kit-pure.mjs";
import * as Kit from "./flows/kit.mjs";
import * as Attack from "./flows/attack.mjs";

const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const why = (env) => env?.error?.params?.reason ?? null;
const decl = (actor, action, targets, extra = {}) => ({ op: "declare", actor, decl: { action, targets, ...extra } });
const GUN = { id: "gun", bonus: 0, damage: 3, range: [0, 3] };
const item = (id, name, type) => ({ id, name, type, level: null, power: null, boosts: [], autos: [], fx: [], flags: { kit: null, off: false, types: [] }, wf: {} });
const give = (T, cid, ...names) => { const c = T.c[cid]; c.kit = KP.build({ items: names.map((n, i) => item(`i${i}${cid}`, n, "talent")), attrs: c.attrs }); c.pass = c.kit.pass; return T; };
const rid = (T, cid, k) => `r:${T.c[cid].kit.actions.find((a) => a.id.endsWith(`-${k}`)).id}`;
/* two heroes and two enemies in one zone; H1 holds Guardian; the enemy N1 has the turn */
const base = (extra = () => {}, order = ["N1", "H1", "H2", "N2"]) => { const T = new Table(); T.hero("H1", "p1", { name: "Guardian" }).hero("H2", "p2", { name: "Friend" }).npc("N1", { health: 6 }).npc("N2", { health: 6 }); T.weapons.gun = GUN; give(T, "H1", "Guardian"); extra(T); T.order(order); return T; };
const cards = (T) => T.prompts("reaction").map((p) => [p.about, p.options.map((o) => o.id.startsWith("r:") ? `r:${o.id.split("-").pop()}` : o.id).join()]);
const card = (T, cid) => T.prompt("reaction", cid);
const view = (T) => ({ state: T.state, facts: T.facts(), entry: (inst) => C.entryFor(T.state, inst.actor, inst.action, T.facts()) });
const meta = (T) => ({ hidden: Object.values(T.c).filter((c) => c.hidden).map((c) => c.id), npc: Object.values(T.c).filter((c) => c.npc).map((c) => c.id) });
const viewer = (T, u) => ({ id: u, staff: false, owns: Object.values(T.c).filter((x) => x.owners.includes(u)).map((x) => x.id) });
const units = (T, cid) => JSON.stringify(T.state.ledger[cid]);
const notes = (T) => (T.top()?.data?.notes ?? []).map((n) => [n.note, n.who, n.reason ?? n.for ?? null]);

/* ---- A. same zone */
{
  const T = base();
  eq(code(await T.gm(decl("N1", "slugfest", ["H2"]))), "ok", "A: an enemy attacks the guardian's friend");
  eq(cards(T), [["H2", "block,pass"], ["H1", "r:guardian,pass,pass:round"]], "A: the guardian stands in the zone of the attacked one: it is asked");
  const p = card(T, "H1");
  eq([p.to, p.data.bystander, p.data.attacker, p.data.targets, p.options[0].cost, p.options[0].disabled ?? null], [{ users: ["p1"] }, 1, "N1", ["H2"], "quick", null], "A: the card says who attacks whom; the price is a quick action");
  const before = units(T, "H1");
  eq(code(await T.req("p1", { op: "answer", prompt: p.id, value: rid(T, "H1", "guardian") })), "ok", "A: the guardian dives in");
  ok(units(T, "H1") !== before, "A: the quick action is spent when the answer is given");
  eq([T.top().decl.targets, T.top().data.retargets ?? null], [["H2"], null], "A: the attack does not move before the guardian's dice [B2115]");
  const rq = T.lastRequest();
  eq([T.top().rolls["sw:H1"]?.who, T.top().rolls["sw:H1"]?.attr, rq?.users], ["H1", "fighting", ["p1"]], "A: a slugfest attack: the guardian rolls FIGHTING, with its own player's hand");
  eq(T.top().step, "reactBefore", "A: the exchange waits for that roll");
  await T.req("p2", { op: "answer", prompt: card(T, "H2").id, value: "pass" });
  eq(T.top().step, "reactBefore", "A: the target's answer alone does not let the attack go on");
  await T.roll("sw:H1", 1);
  eq([T.top().decl.targets, T.top().data.retargets], [["H1"], [{ from: "H2", to: "H1", by: T.c.H1.kit.actions.find((a) => a.id.endsWith("-guardian")).id }]], "A: with a six the guardian is the target now");
  const np = card(T, "H1");
  eq([!!np, np?.data?.bystander ?? null, np?.options.some((o) => o.id === "block")], [true, null, true], "A: the new target gets its own window (a block, if it still has an action for it)");
  await T.req("p1", { op: "answer", prompt: np.id, value: "pass" });
  const hp1 = T.c.H1.health, hp2 = T.c.H2.health;
  await T.roll("attack", 1);
  for (const sp of T.prompts("stunts")) await T.gm({ op: "answerFor", prompt: sp.id, value: [] });
  eq([T.c.H1.health < hp1, T.c.H2.health], [true, hp2], "A: the guardian takes the hit instead of the intended target");
}
{
  const T = base();
  await T.gm(decl("N1", "slugfest", ["H2"]));
  await T.req("p1", { op: "answer", prompt: card(T, "H1").id, value: rid(T, "H1", "guardian") });
  await T.roll("sw:H1", 0);
  eq([T.top().decl.targets, T.top().data.retargets ?? null, notes(T)], [["H2"], null, [["swapFailed", "H1", "H2"]]], "A: without a six the attack stays on the intended target; the action is gone all the same");
  eq(T.top().step, "reactBefore", "A: the target is still to answer");
  await T.req("p2", { op: "answer", prompt: card(T, "H2").id, value: "pass" });
  const hp1 = T.c.H1.health, hp2 = T.c.H2.health;
  await T.roll("attack", 1);
  for (const sp of T.prompts("stunts")) await T.gm({ op: "answerFor", prompt: sp.id, value: [] });
  eq([T.c.H1.health, T.c.H2.health < hp2], [hp1, true], "A: the intended target takes the hit");
}
{
  const T = base();
  eq(code(await T.gm(decl("N1", "shoot", ["H2"], { weapon: "gun" }))), "ok", "A: an enemy shoots at the guardian's friend");
  await T.req("p1", { op: "answer", prompt: card(T, "H1").id, value: rid(T, "H1", "guardian") });
  eq(T.top().rolls["sw:H1"]?.attr, "agility", "A: against shooting the guardian rolls AGILITY");
  await T.roll("sw:H1", 2);
  eq(T.top().decl.targets, ["H1"], "A: shooting: the guardian is the target after a success");
}
{
  const T = base(() => {}, ["H2", "H1", "N1", "N2"]);
  eq(code(await T.req("p2", decl("H2", "slugfest", ["N1"]))), "ok", "A: the guardian's friend attacks an enemy");
  eq(cards(T).filter((c) => c[0] === "H1"), [["H1", "r:guardian,pass,pass:round"]], "A: 'another character' is anybody else attacked in the zone, an enemy too (question U17-5 stands as it was)");
}
{
  const T = base(() => {}, ["H1", "H2", "N1", "N2"]);
  await T.req("p1", decl("H1", "slugfest", ["N1"]));
  eq(cards(T).filter((c) => c[0] === "H1"), [], "A: the attacker is never asked to take its own blow");
}

/* ---- B. another zone */
{
  const T = base((t) => { t.c.H1.zone = "z2"; });
  await T.gm(decl("N1", "slugfest", ["H2"]));
  eq(cards(T), [["H2", "block,pass"]], "B: the guardian stands in another zone: no card (the defect of U91)");
}
{
  const T = base((t) => { t.c.H2.zone = "z2"; t.c.N1.zone = "z2"; });
  await T.gm(decl("N1", "slugfest", ["H2"]));
  eq(cards(T), [["H2", "block,pass"]], "B: the attacked one and the attacker stand elsewhere: no card");
}
{
  const T = base((t) => { t.c.H2.zone = "z2"; });
  await T.gm(decl("N1", "shoot", ["H2"], { weapon: "gun" }));
  eq(cards(T).filter((c) => c[0] === "H1"), [], "B: a shot from the guardian's zone at somebody in another zone: the guardian is beside the shooter, not the target: no card");
}
{
  const T = base((t) => { t.c.N1.zone = "z2"; });
  await T.gm(decl("N1", "shoot", ["H2"], { weapon: "gun" }));
  eq(cards(T).filter((c) => c[0] === "H1"), [["H1", "r:guardian,pass,pass:round"]], "B: where the attacker stands does not matter: a shot from afar at somebody beside the guardian is asked");
}

/* ---- C. moved away between the card and the answer */
{
  const T = base();
  await T.gm(decl("N1", "slugfest", ["H2"]));
  const p = card(T, "H1"), before = units(T, "H1");
  T.c.H1.zone = "z2";                                                                            // the card is open; the guardian is moved away
  let env;
  eq([code(env = await T.req("p1", { op: "answer", prompt: p.id, value: rid(T, "H1", "guardian") })), why(env)], ["illegal", "notInYourZone"], "C: what the card offered is asked again when it is answered: the guardian stands elsewhere now");
  eq([units(T, "H1") === before, T.top().decl.targets, Object.keys(T.top().rolls ?? {}), T.requests.length], [true, ["H2"], [], 0], "C: nothing is paid, nothing rolled, the attack stays where it was");
  eq([Attack.validate(view(T), T.top(), p, rid(T, "H1", "guardian")).reason, Attack.validate(view(T), T.top(), p, "pass").ok, Attack.validate(view(T), T.top(), p, rid(T, "H1", "guardian"), true).ok], ["notInYourZone", true, true], "C: the flow's own rule says why; 'no reaction' is always an answer; the GM's hand is not held (spec 14)");
  eq(code(await T.req("p1", { op: "answer", prompt: p.id, value: "pass" })), "ok", "C: the guardian can still say no");
}
{
  const T = base();
  await T.gm(decl("N1", "shoot", ["H2"], { weapon: "gun" }));
  const p = card(T, "H1");
  T.c.H2.zone = "z2";                                                                            // the attacked one is moved away instead
  let env;
  eq([code(env = await T.req("p1", { op: "answer", prompt: p.id, value: rid(T, "H1", "guardian") })), why(env)], ["illegal", "notInYourZone"], "C: the same when the attacked one is no longer beside the guardian");
  T.c.H2.zone = "z1";
  eq(code(await T.req("p1", { op: "answer", prompt: p.id, value: rid(T, "H1", "guardian") })), "ok", "C: back in one zone the same card is good again");
}
{
  const T = base();
  await T.gm(decl("N1", "slugfest", ["H2"]));
  const p = card(T, "H1");
  T.c.H1.zone = "z2";
  eq(code(await T.gm({ op: "answerFor", prompt: p.id, value: rid(T, "H1", "guardian") })), "ok", "C: the GM answers for the guardian against the rule");
  eq([T.top().rolls["sw:H1"]?.attr, notes(T)], ["fighting", []], "C: the GM's word stands: the guardian rolls");
  await T.roll("sw:H1", 1);
  eq(T.top().decl.targets, ["H1"], "C: and takes the attack on a success");
}
{
  /* the rule itself, where nobody can say where somebody stands (no map of zones, no token): not refused, the GM settles it */
  const T = base();
  await T.gm(decl("N1", "slugfest", ["H2"]));
  const v = view(T), e = T.c.H1.kit.actions.find((a) => a.id.endsWith("-guardian")), blind = { ...v, facts: { ...v.facts, zone: () => null } };
  eq([Kit.sameSpot(v, "H1", "H2"), Kit.sameSpot(blind, "H1", "H2"), Kit.reactionFit(blind, T.top(), "H1", e).ok], [true, null, true], "C: without a known place the reaction is not refused (ruling U19-R3)");
}

/* ---- D. hidden and unseen figures */
{
  const T = base((t) => { t.c.N2.hidden = true; });
  eq(code(await T.gm(decl("N1", "slugfest", ["N2"]))), "ok", "D: an enemy strikes a figure the GM keeps hidden, beside the guardian");
  eq(cards(T).filter((c) => c[0] === "H1"), [], "D: the hero's player gets no card: it would name the hidden figure");
  ok(!JSON.stringify(V.viewFor(T.state, viewer(T, "p1"), meta(T)).prompts ?? {}).includes("N2"), "D: nothing addressed to that player names the hidden figure");
}
{
  const T = base();
  await T.gm({ op: "knowledgeSet", observer: "H1", subject: "H2", value: "unseen" });
  await T.gm(decl("N1", "slugfest", ["H2"]));
  eq(cards(T), [["H2", "block,pass"]], "D: the guardian has not seen the attacked one (invisible): it is not asked about them");
}
{
  const T = base((t) => { t.c.N1.hidden = true; });
  await T.gm(decl("N1", "slugfest", ["H2"]));
  const mine = Object.values(V.viewFor(T.state, viewer(T, "p1"), meta(T)).prompts ?? {}).find((p) => p.about === "H1");
  eq([mine?.data?.unseen, mine?.data?.targets, JSON.stringify(mine).includes("N1")], [1, ["H2"], false], "D: a hidden attacker is 'somebody unseen' on the guardian's card, as before (U11)");
}
{
  /* an attack on several: the bystander's card names only those its answer can be about */
  const T = base((t) => { t.hero("H3", "p3", { zone: "z2" }); t.npc("N3", { hidden: true }); }, ["N1", "H1", "H2", "N2", "H3", "N3"]);
  const e = T.c.H1.kit.actions.find((a) => a.id.endsWith("-guardian")), I = { actor: "N1", action: "shoot", decl: { targets: ["H3", "N3", "H2", "H1"] }, data: {} };
  eq([Kit.reactionFor(view(T), I, "H1", e), Kit.reactionFit(view(T), I, "H1", e).ok], [["H2"], true], "D: of four attacked, only the one in the guardian's zone that it knows of (not itself, not the hidden one, not the one elsewhere)");
  const ps = Kit.windowPrompts(view(T), { ...I, decl: { targets: ["H3", "N3", "H2"] } }, "beforeRoll", { skip: ["H3", "N3", "H2"], reactions: C.reactionsFor });
  eq(ps.map((p) => [p.about, p.data.targets]), [["H1", ["H2"]]], "D: and the card lists that one alone");
  eq(Kit.reactionFit(view(T), { ...I, decl: { targets: ["H3", "N3"] } }, "H1", e), { ok: false, reason: "notInYourZone" }, "D: the reason never tells of the hidden one: it speaks of the one the guardian knows");
  eq(Kit.reactionFit(view(T), { ...I, decl: { targets: ["N3"] } }, "H1", e), { ok: false, reason: "unseen" }, "D: nobody known is attacked: 'you cannot see the target'");
}

/* ---- E. both sides: an NPC guardian */
{
  const T = base((t) => { give(t, "N2", "Guardian"); t.c.H1.kit = null; }, ["H2", "H1", "N1", "N2"]);
  await T.req("p2", decl("H2", "slugfest", ["N1"]));
  const p = card(T, "N2");
  eq([p?.to, p?.data?.targets, p?.options.map((o) => o.id.startsWith("r:") ? "r" : o.id)], ["gm", ["N1"], ["r", "pass"]], "E: an enemy guardian beside the attacked enemy is asked through the GM");
  eq(code(await T.gm({ op: "answerFor", prompt: p.id, value: rid(T, "N2", "guardian") })), "ok", "E: the GM lets it dive in");
  eq(T.top().rolls["sw:N2"]?.attr, "fighting", "E: it rolls as a hero would");
  await T.roll("sw:N2", 1);
  eq(T.top().decl.targets, ["N2"], "E: and takes the hero's blow");
}
{
  const T = base((t) => { give(t, "N2", "Guardian"); t.c.H1.kit = null; t.c.N2.zone = "z2"; }, ["H2", "H1", "N1", "N2"]);
  await T.req("p2", decl("H2", "slugfest", ["N1"]));
  eq(card(T, "N2"), null, "E: an enemy guardian in another zone is not asked either");
}
{
  const T = base((t) => { give(t, "N2", "Guardian"); t.c.H1.kit = null; t.c.N1.hidden = true; }, ["H2", "H1", "N1", "N2"]);
  /* a figure hidden from the players is no secret to the GM, who answers for the enemy guardian */
  const env = await T.gm(decl("H2", "slugfest", ["N1"]));
  eq([code(env), card(T, "N2")?.data?.targets ?? null], ["ok", ["N1"]], ["N1"], "E: the GM's card for an enemy guardian names a hidden enemy (the GM knows it)");
}

/* ---- F. the data of the rule */
{
  const g = C.sanitizeEntry({ id: "g", flow: "plain", cost: "quick", reaction: { when: ["beforeRoll"], who: "any", effect: "swapTarget", place: "targetZone", roll: "attack" } });
  eq([g.reaction.place, g.reaction.roll, C.sanitizeEntry({ id: "g", flow: "plain", cost: "quick", reaction: { when: ["beforeRoll"], who: "any", effect: "swapTarget", place: "moon", roll: "x" } }).reaction], ["targetZone", "attack", { when: ["beforeRoll"], who: "any", effect: "swapTarget" }], "F: the catalog keeps a known place and roll, drops an unknown one");
  const ge = T0().c.H1.kit.actions.find((a) => a.id.endsWith("-guardian")), de = give(T0(), "H2", "Discretion").c.H2.kit.actions.find((a) => a.id.endsWith("-discretion")), we = give(T0(), "H2", "Warning Call").c.H2.kit.actions.find((a) => a.id.endsWith("-warn"));
  eq([ge.reaction, ge.cost, ge.kit?.key != null], [{ when: ["beforeRoll"], who: "any", effect: "swapTarget", place: "targetZone", roll: "attack" }, "quick", true], "F: Guardian [B2115]: anybody's attack, in the guardian's zone, a quick action, a roll by the attack");
  eq([de.reaction, we.reaction], [{ when: ["beforeRoll"], who: "target", effect: "note", place: "allyZone" }, { when: ["beforeRoll"], who: "any", effect: "note" }], "F: Discretion [B2108] asks for an ally in the zone; Warning Call [B2170] asks for no zone");
  ok(C.REACTION_PLACES.includes("targetZone") && C.REACTION_PLACES.includes("allyZone"), "F: the places a reaction can ask for are a closed list");
}
function T0() { return base(); }
{
  /* an entry the GM grants (spec 6.5) follows the same rule when it carries the place */
  const GR = { id: "guardian", flow: "plain", cost: "quick", src: [2115], reaction: { when: ["beforeRoll"], who: "any", effect: "swapTarget", place: "targetZone" } };
  const mk = async (zone) => { const T = base((t) => { t.c.H1.kit = null; t.c.H1.zone = zone; }); await T.gm({ op: "powerGrant", combatant: "H1", entry: GR }); await T.gm(decl("N1", "slugfest", ["H2"])); return T; };
  const near = await mk("z1"), far = await mk("z2");
  eq([cards(near).filter((c) => c[0] === "H1").length, cards(far).filter((c) => c[0] === "H1").length], [1, 0], "F: a granted Guardian is asked in the zone, not from another one");
  await near.req("p1", { op: "answer", prompt: card(near, "H1").id, value: "r:guardian" });
  eq([near.top().decl.targets, Object.keys(near.top().rolls ?? {})], [["H1"], []], "F: an entry without the roll moves the attack at once (the GM's own grant decides)");
}

/* ---- G. Discretion [B2108]: "an ally in the same zone" */
{
  const T = base((t) => { t.c.H1.kit = null; give(t, "H2", "Discretion"); });
  await T.gm(decl("N1", "slugfest", ["H2"]));
  eq(cards(T), [["H2", "block,r:discretion,pass"]], "G: attacked with an ally beside: Discretion is on the target's card");
  const p = card(T, "H2");
  T.c.H1.zone = "z2";
  let env;
  eq([code(env = await T.req("p2", { op: "answer", prompt: p.id, value: rid(T, "H2", "discretion") })), why(env), T.c.H2.resolve], ["illegal", "noAllyNear", 5], "G: the ally left before the answer: refused, no stress taken");
  T.c.H1.zone = "z1";
  eq(code(await T.req("p2", { op: "answer", prompt: p.id, value: rid(T, "H2", "discretion") })), "ok", "G: with the ally back it is taken");
}
{
  const T = base((t) => { t.c.H1.kit = null; t.c.H1.zone = "z2"; give(t, "H2", "Discretion"); });
  await T.gm(decl("N1", "slugfest", ["H2"]));
  eq(cards(T), [["H2", "block,pass"]], "G: no ally in the zone (only enemies): Discretion is not offered");
  eq(Kit.alliesNear(view(T), T.top(), "H2"), [], "G: the attacker's side is no ally of the target");
}
{
  const T = base((t) => { t.c.H1.kit = null; give(t, "N2", "Discretion"); }, ["H1", "H2", "N1", "N2"]);
  await T.req("p1", decl("H1", "slugfest", ["N2"]));
  eq([card(T, "N2")?.options.some((o) => o.id.startsWith("r:")), Kit.alliesNear(view(T), T.top(), "N2")], [true, ["N1"]], "G: both sides: an enemy's ally is another enemy");
}

/* ---- H. Warning Call [B2170]: "within hearing range" is no zone */
{
  const T = base((t) => { t.c.H1.zone = "z2"; give(t, "H1", "Warning Call"); });
  await T.gm(decl("N1", "slugfest", ["H2"]));
  eq(cards(T).filter((c) => c[0] === "H1"), [["H1", "r:warn,pass,pass:round"]], "H: a warning is shouted from another zone too (the book names hearing range, not the zone)");
}
{
  const T = base((t) => { give(t, "H1", "Warning Call"); });
  await T.gm({ op: "knowledgeSet", observer: "H1", subject: "H2", value: "unseen" });
  await T.gm(decl("N1", "slugfest", ["H2"]));
  eq(cards(T).filter((c) => c[0] === "H1"), [], "H: nobody is asked to warn somebody they have not seen");
}

/* ---- I. Adversary 8 (live, 2026-11-12): D103, D104, D105. The turret shot at Omni-Man (H2), Kid Omni-Man (H1) and the Soldier group
   (N2) both held Guardian in that zone: Omni-Man's card stayed answerable after the swap, and the Soldier's card, still naming Omni-Man,
   moved the attack on from Kid. */
const three = (extra = () => {}, order) => base((t) => { give(t, "N2", "Guardian"); extra(t); }, order);
{
  const T = three();
  await T.gm(decl("N1", "shoot", ["H2"], { weapon: "gun" }));
  eq(cards(T).map((c) => c[0]), ["H2", "H1", "N2"], "I: the target and both guardians are asked");
  const old = card(T, "H2"), oldN2 = card(T, "N2"), u2 = units(T, "H2");
  eq(oldN2.data.targets, ["H2"], "I: the second guardian's card is about the intended target");
  await T.req("p1", { op: "answer", prompt: card(T, "H1").id, value: rid(T, "H1", "guardian") });
  await T.roll("sw:H1", 1);
  eq(T.top().decl.targets, ["H1"], "I: the first guardian took the hit");
  /* D103 */
  eq(T.prompts("reaction").some((p) => p.id === old.id), false, "D103: the card of the one who is no target any more is withdrawn");
  eq(card(T, "H2"), null, "D103: and no other card asks it about this attack");
  let env;
  eq([code(env = await T.req("p2", { op: "answer", prompt: old.id, value: "dodge" })), units(T, "H2")], ["gone", u2], "D103: an answer to the old card is refused, nothing paid");
  eq(card(T, "H1")?.options.some((o) => o.id === "block" || o.id === "dodge"), true, "D103: the new target has its own defence card");
  /* D104 */
  eq(T.prompts("reaction").some((p) => p.id === oldN2.id), false, "D104: the second guardian's card that named the intended target is withdrawn");
  eq(card(T, "N2"), null, "D104: nobody dives in for the one who took the hit (ruling A8-R1: 'instead of the intended target')");
  eq(code(env = await T.gm({ op: "answerFor", prompt: oldN2.id, value: rid(T, "N2", "guardian") })), "gone", "D104: the old 'yes' cannot move the attack any more");
  eq(T.top().decl.targets, ["H1"], "D104: the attack stays on the first guardian");
  const e2 = T.c.N2.kit.actions.find((a) => a.id.endsWith("-guardian"));
  eq([Kit.reactionFor(view(T), T.top(), "N2", e2), Kit.reactionFit(view(T), T.top(), "N2", e2)], [[], { ok: false, reason: "hitTaken" }], "D104: the rule says why: somebody already took the hit");
  await T.req("p1", { op: "answer", prompt: card(T, "H1").id, value: "pass" });
  await T.roll("attack", 1);
  for (const sp of T.prompts("stunts")) await T.gm({ op: "answerFor", prompt: sp.id, value: [] });
  eq([T.top() ?? null, T.c.H2.health], [null, 6], "I: the attack ends on the first guardian; the intended target is untouched");
}
{
  /* a card already answered stays answered: the second guardian said yes before the first one's dice: its roll goes on, the faster one wins (U91) */
  const T = three();
  await T.gm(decl("N1", "shoot", ["H2"], { weapon: "gun" }));
  await T.req("p1", { op: "answer", prompt: card(T, "H1").id, value: rid(T, "H1", "guardian") });
  await T.gm({ op: "answerFor", prompt: card(T, "N2").id, value: rid(T, "N2", "guardian") });
  await T.roll("sw:H1", 1);
  await T.roll("sw:N2", 2);
  eq([T.top().decl.targets, notes(T).filter((n) => n[0] === "swapFailed")], [["H1"], [["swapFailed", "N2", "H2"]]], "D104: a second 'yes' given before the swap does not carry the attack on from the first guardian");
}
{
  /* the cards of the others are made again for the attack as it is now: a warning names who is attacked now */
  const T = three((t) => { t.c.N2.kit = null; t.hero("H3", "p3", { name: "Shouter" }); give(t, "H3", "Warning Call"); }, ["N1", "H1", "H2", "N2", "H3"]);
  await T.gm(decl("N1", "shoot", ["H2"], { weapon: "gun" }));
  const w0 = card(T, "H3");
  eq(w0?.data?.targets, ["H2"], "D104: the warning card names the intended target");
  await T.req("p1", { op: "answer", prompt: card(T, "H1").id, value: rid(T, "H1", "guardian") });
  await T.roll("sw:H1", 1);
  const w1 = card(T, "H3");
  eq([w1 && w1.id !== w0.id, w1?.data?.targets, T.prompts("reaction").some((p) => p.id === w0.id)], [true, ["H1"], false], "D104: after the swap the warning card is made again and names the one attacked now");
}
{
  /* the GM's hand: a target the GM set (retarget) is the GM's intent, a guardian may still cover it */
  const T = three();
  await T.gm(decl("N1", "shoot", ["H2"], { weapon: "gun" }));
  const e2 = T.c.N2.kit.actions.find((a) => a.id.endsWith("-guardian")), I = T.top();
  eq(Kit.reactionFor(view(T), { ...I, decl: { ...I.decl, targets: ["H1"] }, data: { ...I.data, retargets: [{ from: "H2", to: "H1", by: "gm" }] } }, "N2", e2), ["H1"], "A8-R1: a target set by the GM can be covered");
  eq(Kit.reactionFor(view(T), { ...I, decl: { ...I.decl, targets: ["H1"] }, data: { ...I.data, retargets: [{ from: "H2", to: "H1", by: "x-guardian" }] } }, "N2", e2), [], "A8-R1: one who took the hit by a reaction cannot");
}
{
  /* D105: the guardian's roll is named, never a raw key or a code */
  const L = await import("./lang.mjs");
  eq([L.t("ITAC.roll.sw"), L.rollTitle("sw:H1", "ITAC.kit.act.guardian"), L.rollTitle("zz:H1", "ITAC.kit.act.guardian"), L.rollTitle("attack", "Slugfest")], ["Guardian", "Guardian", "Take the hit", "Attack"], "D105: the Guardian's roll has a title; a kit label is read as a key");
  const T = base();
  await T.gm(decl("N1", "slugfest", ["H2"]));
  await T.req("p1", { op: "answer", prompt: card(T, "H1").id, value: rid(T, "H1", "guardian") });
  const rq = T.lastRequest();
  eq([rq?.key, /ITAC\./.test(L.rollTitle(rq?.key, rq?.label))], ["sw:H1", false], "D105: the roll request the engine sends gets a readable title");
}
{
  /* U104 (not a defect): the target's defence card and the bystander's card of one attack both carry their keys; the small marks are
     drawn only for a user who has used the keyboard on the dock (U41), remembered PER USER (layout `keys`), so two seats may differ */
  const Keys = await import("./ui/keys-pure.mjs"), Lay = await import("./ui/layout-pure.mjs");
  const def = { id: "p28", options: [{ id: "dodge", note: "chance" }, { id: "dodge:free", note: "chance" }, { id: "pass", note: "chance" }] }, by = { id: "p29", options: [{ id: "r:x" }, { id: "pass" }, { id: "pass:round" }] };
  eq([Keys.number({ prompts: [def] }).prompts[0].options.map((o) => o.key), Keys.number({ prompts: [by] }).prompts[0].options.map((o) => o.key)], [["1", "2", "3"], ["1", "2", "3"]], "U104: both cards of the attack are numbered alike");
  eq([Lay.clean({ keys: true }).keys, Lay.clean(null).keys, Lay.clean(null, { keys: true }).keys], [true, false, true], "U104: the marks follow the user's own remembered keyboard use");
}

done("check-u19");
