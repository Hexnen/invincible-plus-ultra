/* node scripts/tactics/check-anse.mjs -- ANSE: the user's answers of 2026-11-12 (dev/combat-answers-2026-11-12.md) built, and the powers
   review's PW030. One block per answer; each pins the decision as the user worded it. Fights run through the REAL director, engine and view
   (testkit Table; the fake map of check-kit-map for a fall and a crash); the cards through the pure models (desk-pure, ui/model-pure).
     U19-4                        «Tak, wszystkie»: a guardian who is held, snared or trapped cannot dive in to take the hit
     U17-1 + U17-R1 + FXF-7       «Wszystkie jak rekomendacja»: the side by the token (a friendly NPC with the heroes) for targets, cards and
                                  colours; the NPC rules unchanged; the extra opponent still of the target's side
     A10                          «musi byc do wyboru przez mg, domyślnie tak»: Armor against a fall and a failed crash, the GM's card
     A40                          «zgodnie z książką (wszyscy w strefie celu)»: the attacker in its own area is hit too, with its own dodge
     A6                           «Wszystkie 4 zmiany»: "unaware" ends by itself at the end of the character's first turn
     A15                          «Wszystkie 4 zmiany»: a flooded zone and a closed door stop the fire
     A17                          «Wszystkie 4 zmiany»: a zone with no terrain set may be wrecked
     PW030 (P6b-6 / K8)           Luck Control re-rolls an injury on the same card as Killer and Lucky Break: the holder picks, the GM confirms */
import { Table, ok, eq, done } from "./testkit.mjs";
import { MTable } from "./check-kit-map.mjs";
import * as D from "./desk-pure.mjs";
import * as V from "./view-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./mods-pure.mjs";
import * as S from "./state-pure.mjs";
import * as UM from "./ui/model-pure.mjs";
import * as KP from "./kit-pure.mjs";
import * as Hz from "./flows/hazards.mjs";
import { tIn } from "./lang.mjs";

const tr = (l) => (k, p = {}, f) => tIn(l, k, p, f);
const t = tr("pl");
const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const why = (env) => env?.error?.params?.reason ?? null;
const decl = (actor, action, targets, extra = {}) => ({ op: "declare", actor, decl: { action, targets, ...extra } });
const meta = (T) => ({ hidden: Object.values(T.c).filter((c) => c.hidden).map((c) => c.id), npc: Object.values(T.c).filter((c) => c.npc).map((c) => c.id) });
const facts = (T, view, me, staff = false) => ({ view, me, staff, c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc, team: T.c[id].team ?? null, kind: T.c[id].kind, img: null } : null), attrs: (id) => T.c[id]?.attrs ?? null, userName: (u) => `user-${u}`, online: () => true, preview: () => null });
const ctx = (T) => ({ c: (id) => T.c[id] ?? null, online: () => true, P1 });
const desk = (T, own = {}) => UM.deskData(D.deskModel(T.state, T.log, ctx(T)), own, facts(T, T.state, "gm", true), t);
const dock = (T, uid, owns, own = {}) => { const view = V.viewFor(T.state, { id: uid, staff: false, owns }, meta(T)); return UM.dockData(D.playerModel(view, { id: uid, owns }, ctx(T)), own, facts(T, view, uid), t); };
const passAll = async (T) => { for (const p of T.prompts("reaction")) await T.req(p.to === "gm" ? "gm" : p.to.users[0], { op: p.to === "gm" ? "answerFor" : "answer", prompt: p.id, value: "pass" }); };
const item = (id, name, type = "talent", o = {}) => ({ id, name, type, level: o.level ?? null, power: o.power ?? null, boosts: o.boosts ?? [], autos: [], fx: [], flags: { kit: null, off: false, types: [] }, wf: {} });
const kit = (T, cid, items) => { const c = T.c[cid]; c.kit = KP.build({ items, attrs: c.attrs }); c.pass = c.kit.pass; return T; };
const rid = (T, cid, k) => `r:${T.c[cid].kit.actions.find((a) => a.id.endsWith(`-${k}`)).id}`;
const cards = (T) => T.prompts("reaction").map((p) => [p.about, p.options.map((o) => (o.id.startsWith("r:") ? `r:${o.id.split("-").pop()}` : o.id)).join()]);
const st = (T, id) => M.statusesOf(T.state, id).map((s) => s.id);
const GUN = { id: "gun", bonus: 0, damage: 3, range: [0, 3] };
const NADE = { id: "nade", bonus: 0, damage: 3, range: [0, 3], blast: 2, area: true };

/* ================================================================== U19-4: a guardian held, snared or trapped does not dive in [B2496], [B1606], [B2438] */
{
  const guard = (status) => { const T = new Table(); T.hero("H1", "p1", { name: "Guardian" }).hero("H2", "p2", { name: "Friend" }).npc("N1", { health: 6 }).npc("N2", { health: 6 }); T.weapons.gun = GUN; kit(T, "H1", [item("g", "Guardian")]); T.order(["N1", "H1", "H2", "N2"]); if (status) T.state.statuses = { H1: [status] }; return T; };
  const free = guard(null);
  await free.gm(decl("N1", "slugfest", ["H2"]));
  eq(cards(free).find((c) => c[0] === "H1")?.[1] ?? null, "r:guardian,pass,pass:round", "U19-4: (a free guardian in the zone is asked)");
  for (const [s, label] of [[{ id: "grappled", data: { by: "N2" } }, "held"], [{ id: "snared", data: { dice: -2 } }, "snared"], [{ id: "trapped" }, "trapped"]]) {
    const T = guard(s);
    await T.gm(decl("N1", "slugfest", ["H2"]));
    eq(cards(T).filter((c) => c[0] === "H1").length, 0, `U19-4: a ${label} guardian gets no card to dive in`);
  }
  const R = guard({ id: "snared", data: { moveOnly: 1 } });
  await R.gm(decl("N1", "slugfest", ["H2"]));
  eq(cards(R).find((c) => c[0] === "H1")?.[1] ?? null, "r:guardian,pass,pass:round", "U19-4 (ANSE-R1): Immobilize Only leaves the body free: the guardian may still dive in [B1611]");
  /* the guardian answered, then was grabbed before the answer was acted on: the answer is refused, nothing paid */
  const G = guard(null);
  await G.gm(decl("N1", "slugfest", ["H2"]));
  G.state.statuses = { H1: [{ id: "grappled", data: { by: "N2" } }] };
  const before = JSON.stringify(G.state.ledger.H1);
  const r = await G.req("p1", { op: "answer", prompt: G.prompt("reaction", "H1").id, value: rid(G, "H1", "guardian") });
  eq([code(r), why(r), JSON.stringify(G.state.ledger.H1) === before, !!G.top().rolls?.["sw:H1"]], ["illegal", "held", true, false], "U19-4: held by the time it answers: the dive is refused (held), nothing is spent, no roll");
}

/* ================================================================== U17-1 + U17-R1 + FXF-7: the side by the token's disposition */
{
  eq([S.allySide({ type: "npc", disposition: 1 }), S.allySide({ type: "minions", disposition: 1 }), S.allySide({ type: "npc", disposition: 0 }), S.allySide({ type: "npc", disposition: -1 }), S.allySide({ type: "vehicle", disposition: 1 }), S.allySide({ type: "superhero", owned: true })],
    [true, true, false, false, false, true], "U17-1: a friendly ordinary NPC or minion group fights with the heroes; neutral or hostile does not; a thing has no side; a player's hero still does");
  eq([S.heroSide({ type: "npc", disposition: 1 }), S.heroSide({ type: "superhero", disposition: -1 })], [false, false], "FXF-7: the NPC rules' side (heroSide) is unchanged: a friendly NPC is still an NPC, a hostile book villain still the GM's");
  eq([M.teamOf({ npc: true, team: "heroes" }), M.teamOf({ npc: true }), M.teamOf({ npc: false }), M.sameTeam({ npc: true, team: "heroes" }, { npc: false })], ["heroes", "gm", "heroes", true], "U17-1: teamOf reads `team`, else `npc`");
  /* a friendly cop (N3) stands with the heroes: an enemy's Bang Heads on H1 lists the cop as an extra opponent of H1's side (U17-R1), not the enemy's ally */
  const T = new Table(); T.hero("H1", "p1", { name: "Eve" }).npc("N1", { name: "Doc", health: 6 }).npc("N2", { name: "Thug", health: 6 }).npc("N3", { name: "Cop", health: 6 }); T.c.N3.team = "heroes";
  T.order(["N1", "H1", "N2", "N3"]);
  eq(code(await T.gm(decl("N1", "slugfest", ["H1"]))), "ok", "U17-1: (Doc hits Eve; a thug and a friendly cop in the zone)");
  await passAll(T); await T.roll("attack", 2);
  const sp = T.prompt("stunts");
  eq((sp?.options ?? []).filter((o) => o.data?.stunt === "bangHeads" && o.data.extra).map((o) => o.data.extra), ["N3"], "U17-1 / U17-R1: the extra opponent is of the hit target's side: the friendly cop, not Doc's thug");
  /* the hero's target list puts the cop on its own side */
  const ro = UM.rosterOf(facts(T, T.state, "p1"), "H1");
  eq(ro.map((r) => [r.id, r.side]), [["N1", "other"], ["N2", "other"], ["N3", "own"]], "U17-1: choosing targets: the friendly cop is on the hero's side");
  ok(UM.targetsFor({ targetWho: "enemy", flow: "attack" }, facts(T, T.state, "p1"), "H1").filter((r) => r.likely).every((r) => r.id !== "N3"), "U17-1: an attack offers the enemies first, not the cop");
  /* Guardian: the cop dives in for the hero (warning / guardian / guide are for one's own side) */
  const G = new Table(); G.hero("H1", "p1", { name: "Eve" }).npc("N1", { name: "Doc", health: 6 }).npc("N3", { name: "Cop", health: 6 }); G.c.N3.team = "heroes"; G.weapons.gun = GUN; kit(G, "N3", [item("g", "Guardian")]); G.order(["N1", "H1", "N3"]);
  await G.gm(decl("N1", "slugfest", ["H1"]));
  eq(cards(G).filter((c) => c[0] === "N3").length, 1, "U17-1: cards: a friendly NPC guardian is asked to take the hit for a hero");
  const G2 = new Table(); G2.hero("H1", "p1", { name: "Eve" }).npc("N1", { name: "Doc", health: 6 }).npc("N3", { name: "Thug", health: 6 }); G2.weapons.gun = GUN; kit(G2, "N3", [item("g", "Guardian")]); G2.order(["N1", "H1", "N3"]);
  await G2.gm(decl("N1", "slugfest", ["H1"]));
  eq(cards(G2).filter((c) => c[0] === "N3").length, 0, "U17-1: (a hostile one is not)");
  /* the NPC rules stay: the friendly cop broken by a blow is the GM's card (knocked out / killed / injury), as any ordinary NPC [B2771] */
  const B = new Table(); B.hero("H1", "p1").npc("N3", { name: "Cop", health: 1 }); B.c.N3.team = "heroes"; B.order(["H1", "N3"]);
  await B.req("p1", decl("H1", "slugfest", ["N3"])); await passAll(B); await B.roll("attack", 1);
  for (let g = 0; g < 4; g++) { const p = B.prompt("stunts"); if (!p) break; await B.req("p1", { op: "answer", prompt: p.id, value: [] }); }
  eq(B.prompt("npcBroken")?.to ?? null, "gm", "U17-1: the NPC rules are unchanged: a broken friendly NPC is the GM's card [B2771]");
}

/* ================================================================== A10: Armor against a fall and a failed crash, the GM's word, Armor by default */
{
  const map = () => { const T = new MTable(); T.hero("H1", "p1", { attrs: { strength: 5 } }).npc("N1", { health: 6 }); T.put("H1", "z3").put("N1", "z2"); T.order(["H1", "N1"]); return T; };
  /* a fall of an armored NPC: the card, Armor taken off by the first answer */
  const F = map(); F.c.N1.armor = [{ id: "vest", armor: 1 }]; F.put("N1", "z2:elevated"); F.dice.push([5]);
  await F.gm({ op: "fall", combatant: "N1" }); await F.roll("agi", 0);
  const p = F.prompt("hazardArmor");
  eq([p?.to, p?.about, p?.options.map((o) => [o.id, o.data.n]), p?.data], ["gm", "N1", [["armor", 4], ["noArmor", 5]], { cause: "fall", amount: 5, armor: 1 }], "A10: a fall: the GM's card \"Pancerz?\": with Armor (first) or without, each with its number");
  const dc = desk(F).cards.find((c) => c.kind === "hazardArmor");
  eq([dc?.title?.includes?.("Pancerz") ?? String(dc?.title).includes("Pancerz"), dc?.options.map((o) => o.label), /spada: 5 obrażeń\. Odjąć Pancerz 1\?/.test(dc?.lines.join(" ") ?? "")], [true, ["Z Pancerzem: 4", "Bez Pancerza: 5"], true], "A10: the desk card in Polish: what happens and both numbers");
  ok(D.CARD_KINDS.includes("hazardArmor") && tr("en")("ITAC.card.hazardArmor") === "Armor?" && t("ITAC.card.hazardArmor") === "Pancerz?", "A10: a desk card kind with words in both languages");
  eq(F.c.N1.health, 6, "A10: nothing is written while the GM decides");
  await F.answer("gm", "hazardArmor", "armor");
  eq(F.c.N1.health, 2, "A10: Armor (by default the first answer): 5 - 1 = 4 damage");
  const G = map(); G.c.N1.armor = [{ id: "vest", armor: 1 }]; G.put("N1", "z2:elevated"); G.dice.push([5]);
  await G.gm({ op: "fall", combatant: "N1" }); await G.roll("agi", 0); await G.answer("gm", "hazardArmor", "noArmor");
  eq(G.c.N1.health, 1, "A10: the GM may leave Armor out: the full 5");
  const N = map(); N.put("N1", "z2:elevated"); N.dice.push([5]);
  await N.gm({ op: "fall", combatant: "N1" }); await N.roll("agi", 0);
  eq([N.prompt("hazardArmor"), N.c.N1.health], [null, 1], "A10: no Armor, nothing to choose: no card");
  /* a failed crash through the wall (Armor 2) of an armored hero */
  const C = map(); C.c.H1.armor = [{ id: "suit", armor: 1 }];
  await C.req("p1", { op: "move", actor: "H1", to: "z4", force: { "z3|z4": "wall" } }); await C.roll("bar:z3|z4", 0);
  const q = C.prompt("hazardArmor");
  eq([q?.data?.cause, q?.options.map((o) => o.data.n)], ["barrier", [1, 2]], "A10: a failed crash through a wall: the same card (2 damage, 1 with Armor)");
  await C.answer("gm", "hazardArmor", "armor");
  eq(C.c.H1.health, C.c.H1.maxHealth - 1, "A10: the crash with Armor: 1 damage");
}

/* ================================================================== A40: the attacker in its own area is hit too, dodging on its own [B2542] */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Eve" }).npc("N1", { health: 6 }).npc("N2", { health: 6 }); T.weapons.nade = NADE; T.order(["H1", "N1", "N2"]);
  eq(code(await T.req("p1", decl("H1", "shoot", ["N1"], { weapon: "nade", area: true }))), "ok", "A40: (Eve throws a grenade into her own zone)");
  eq(T.top().decl.targets, ["N1", "N2", "H1"], "A40: everyone in the target zone, the attacker too (listed last)");
  const own = T.prompts("reaction").find((p) => p.about === "H1");
  eq([own?.to, own?.options.filter((o) => !o.disabled).map((o) => o.id)], [{ users: ["p1"] }, ["dodge", "pass"]], "A40: the attacker gets its own card: a dodge, never a block (each target dodges individually)");
  await passAll(T); await T.roll("attack", 1);
  for (let g = 0; g < 6; g++) { const p = T.prompts().find((x) => x.kind === "stunts"); if (!p) break; await T.req(p.to === "gm" ? "gm" : p.to.users[0], { op: p.to === "gm" ? "answerFor" : "answer", prompt: p.id, value: [] }); }
  eq([T.c.H1.health < T.c.H1.maxHealth, T.c.N1.health < 6, T.c.N2.health < 6], [true, true, true], "A40: on a hit the attacker is hurt with the others");
  const U = new Table(); U.hero("H1", "p1").npc("N1", { health: 6, zone: "z2" }).npc("N2", { health: 6, zone: "z2" }); U.weapons.nade = NADE; U.order(["H1", "N1", "N2"]);
  await U.req("p1", decl("H1", "shoot", ["N1"], { weapon: "nade", area: true }));
  eq(U.top().decl.targets, ["N1", "N2"], "A40: a grenade into another zone does not touch the thrower");
  const W = new Table(); W.hero("H1", "p1").npc("N1", { health: 6 }); W.weapons.gun = GUN; W.order(["H1", "N1"]);
  eq(why(await W.req("p1", decl("H1", "shoot", ["H1"], { weapon: "gun" }))), "self", "A40: an ordinary attack on oneself is still refused");
}

/* ================================================================== A6: "unaware" ends by itself at the end of the character's first turn */
{
  const T = new Table(); T.hero("H1", "p1").npc("N1").npc("N2");
  await T.gm({ op: "start", mode: "tactical", surprised: ["N1"] });
  eq(st(T, "N1"), ["unaware"], "A6: (surprised: unaware from the start)");
  const rec = M.statusesOf(T.state, "N1")[0];
  eq(rec.ends, { at: "turnEndOf", who: "N1" }, "A6: the status carries its end: the end of N1's own turn");
  let seen = false, after = null, guard = 0;
  while (guard++ < 12) {
    const cur = T.state.init?.curMember;
    if (!cur) { await T.gm({ op: "nextTurn" }); continue; }
    if (cur === "N1") seen = true;
    if (cur !== "N1" && !seen) eq(st(T, "N1"), ["unaware"], `A6: still unaware during ${cur}'s turn before its own`);
    await T.gm({ op: "endTurn", actor: cur, force: true });
    if (cur === "N1") { after = st(T, "N1"); break; }
    if (T.state.init?.curMember === cur) await T.gm({ op: "nextTurn" });
  }
  eq([seen, after], [true, []], "A6: at the end of N1's first turn the status is gone by itself");
  ok(T.events.some((e) => e.type === "status" && e.target === "N1" && e.status?.id === "unaware" && e.status.on === false), "A6: its end is announced");
}

/* ================================================================== A15: a flooded zone, water and a closed door stop the fire [B2927] */
{
  const Z = (zones, borders) => ({ graph: () => ({ zones, borders }), statesAll: () => [] });
  const fl = { tags: ["flammable"], terrain: "" };
  const wall = (door) => ({ wall: { armor: 2, state: "intact" }, ...(door ? { doorway: { armor: 1, state: door } } : {}) });
  const zs = [{ key: "a", states: { fire: 6 }, ...fl }, { key: "b", states: {}, ...fl }, { key: "c", states: {}, ...fl }, { key: "d", states: {}, ...fl }, { key: "e", states: {}, ...fl }, { key: "f", states: { flooded: true }, ...fl }, { key: "g", states: {}, tags: ["flammable", "water"], terrain: "" }, { key: "h", states: {}, ...fl }];
  const bs = [{ key: "a|b", zones: ["a", "b"], kind: "open" }, { key: "a|c", zones: ["a", "c"], ...wall("open") }, { key: "a|d", zones: ["a", "d"], ...wall("breached") }, { key: "a|e", zones: ["a", "e"], ...wall("closed") },
    { key: "a|f", zones: ["a", "f"], kind: "open" }, { key: "a|g", zones: ["a", "g"], kind: "open" }, { key: "a|h", zones: ["a", "h"], ...wall("locked") }];
  const Zf = Z(zs, bs);
  Zf.statesAll = (k) => (k === "a" ? [{ kind: "fire", level: 6 }] : []);
  eq(Hz.spreadCandidates(Zf, "a").sort(), ["b", "c", "d"], "A15: an open border, an open door and a breached one let the fire through; a closed or locked door, a flooded zone and water do not");
  const Zr = Z(zs.map((z) => (z.key === "e" ? { ...z } : z)), bs); Zr.statesAll = (k) => (k === "a" ? [{ kind: "fire", level: 6 }] : k === "b" ? [{ kind: "flooded" }] : []);
  ok(!Hz.spreadCandidates(Zr, "a").includes("b"), "A15: a zone flooded on one level (the map's state record) does not catch fire either");
}

/* ================================================================== A17: wrecking a zone with no terrain set is allowed by default [B2451-2457] */
{
  const T = new Table(); T.hero("H1", "p1", { attrs: { strength: 2 } }).npc("N1", { health: 6, zone: "z2" }); T.order(["H1", "N1"]);
  eq([code(await T.req("p1", decl("H1", "slugfest", ["N1"], { wreck: true }))), why(T.last)], ["ok", null], "A17: no terrain set: the wreck is allowed without the GM (no minimum STRENGTH)");
  await passAll(T);
  const rq = T.lastRequest();
  eq([rq.key, rq.pool.mods.find((m) => m.source === "wreck")?.dice ?? 0], ["attack", 0], "A17 (ANSE-3): the book's table gives no bonus dice for it");
  eq([T.zoneMarks.z1?.wrecked, T.state.counters["zone:z1:wrecked"], T.state.karma.at(-1)?.kind], [true, 1, "wreckedZone"], "A17: the zone is wrecked: mark, once per scene, karma note");
  const U = new Table(); U.terrain = { z1: "none" }; U.hero("H1", "p1").npc("N1", { health: 6, zone: "z2" }); U.order(["H1", "N1"]);
  eq(why(await U.req("p1", decl("H1", "slugfest", ["N1"], { wreck: true }))), "wreckTerrain", "A17: terrain set to one that cannot be wrecked is still refused");
}

/* ================================================================== PW030 (P6b-6 / K8): Luck Control re-rolls an injury, the holder picks, the GM confirms [B1727] */
const luck = (limit) => [item("lu", "Luck Control", "power", { level: "major", boosts: limit ? ["lm"] : [] }), ...(limit ? [item("lm", limit, "limit", { power: "lu" })] : [])];
const toCrit = async (T) => { await T.gm(decl("N1", "slugfest", ["H1"])); await passAll(T); await T.roll("attack", 1); for (let g = 0; g < 6; g++) { const p = T.prompts().find((x) => x.kind === "stunts"); if (!p) break; await T.gm({ op: "answerFor", prompt: p.id, value: [] }); } };
const table = (limit, o = {}) => { const T = new Table(); T.hero("H1", "p1", { name: "Eve", health: 1, maxHealth: 6 }).hero("H2", "p2", { name: "Fate", zone: o.zone ?? "z1" }).npc("N1", { name: "Doc", health: 6 }); kit(T, "H2", luck(limit)); T.order(["N1", "H1", "H2"]); return T; };
{
  const T = table(null); T.dice.push([2]);
  await toCrit(T);
  const lc = T.prompt("luckReroll");
  eq([lc?.to, lc?.about, lc?.data?.target, lc?.data?.d6, lc?.options.map((o) => [o.id, o.cost ?? null, o.stress ?? null])], [{ users: ["p2"] }, "H2", "H1", 2, [["reroll", "quick", 1], ["pass", null, null]]], "PW030 [B1727]: the Luck Control holder in reach is asked: re-roll for a quick action and 1 stress, or not");
  eq([T.c.H1.crits ?? [], T.evs("crit").length], [[], 0], "PW030: nothing is written while the holder decides");
  const lp = dock(T, "p2", ["H2"]).prompts?.find((p) => p.kind === "luckReroll");
  ok(/Kontrola szczęścia/.test((lp?.lines ?? []).join(" ")) && lp?.title === t("ITAC.card.luckReroll"), "PW030: the player's card names the power with the sheet's Polish name");
  const res0 = T.c.H2.resolve, led0 = JSON.stringify(T.state.ledger.H2);
  T.dice.push([5]);
  eq(code(await T.answer("p2", "luckReroll", "reroll")), "ok", "PW030: the player re-rolls");
  eq([T.c.H2.resolve, JSON.stringify(T.state.ledger.H2) !== led0], [res0 - 1, true], "PW030: 1 stress and the quick action are paid");
  const cp = T.prompt("critPick");
  eq([cp?.to, cp?.about, cp?.data?.talent, cp?.data?.target, cp?.options.map((o) => o.data.d6)], [{ users: ["p2"] }, "H2", "luck", "H1", [2, 5]], "PW030 (K8): the same card as Killer and Lucky Break: the holder picks one of the two dice");
  const pc = dock(T, "p2", ["H2"]).prompts?.find((p) => p.kind === "critPick");
  ok(/Kontrola szczęścia/.test((pc?.lines ?? []).join(" ")), "PW030: the pick card names Luck Control");
  await T.answer("p2", "critPick", "d:1");
  const ck = T.prompt("critConfirm");
  eq([ck?.to, ck?.data?.talent, ck?.data?.pick?.d6, ck?.data?.other?.d6], ["gm", "luck", 5, 2], "PW030 (K8): the GM confirms the player's pick or takes the other die");
  ok(/Kontrola szczęścia/.test(desk(T).cards.find((c) => c.kind === "critConfirm")?.lines.join(" ") ?? ""), "PW030: the GM's card names Luck Control");
  await T.answer("gm", "critConfirm", "approve");
  eq(T.evs("crit").map((e) => e.crit.roll), [6], "PW030: the picked die is written (5 + 1 for the hit)");
}
{
  /* declined: the injury stands as rolled */
  const T = table(null); T.dice.push([3]);
  await toCrit(T); await T.answer("p2", "luckReroll", "pass");
  eq([T.prompt("critPick"), T.evs("crit").map((e) => e.crit.roll)], [null, [4]], "PW030: no re-roll: the injury is written as rolled");
}
{
  /* Good Luck Only keeps the lower die, Bad Luck Only the higher: no pick card [B1731], [B1732] */
  const G = table("Good Luck Only"); G.dice.push([2]); await toCrit(G);
  eq(G.prompt("luckReroll")?.data?.must ?? null, "lower", "PW030 [B1731]: the card says the lower die is kept");
  G.dice.push([5]); await G.answer("p2", "luckReroll", "reroll");
  eq([G.prompt("critPick"), G.evs("crit").map((e) => e.crit.roll)], [null, [3]], "PW030 [B1731]: Good Luck Only: the lower of 2 and 5 is kept, no card");
  const B = table("Bad Luck Only"); B.dice.push([2]); await toCrit(B);
  B.dice.push([5]); await B.answer("p2", "luckReroll", "reroll");
  eq([B.prompt("critPick"), B.evs("crit").map((e) => e.crit.roll)], [null, [6]], "PW030 [B1732]: Bad Luck Only: the higher is kept");
}
{
  /* out of reach (two zones away), without Resolve, or without the power: nobody is asked */
  const F = table(null, { zone: "z3" }); F.setRange("H2", "H1", 2); F.dice.push([2]); await toCrit(F);
  eq([F.prompt("luckReroll"), F.evs("crit").map((e) => e.crit.roll)], [null, [3]], "PW030 [B1727]: two zones away: not asked");
  const A = table(null, { zone: "z2" }); A.dice.push([2]); await toCrit(A);
  ok(!!A.prompt("luckReroll"), "PW030 [B1727]: an adjacent zone is in reach");
  const R = table(null); R.c.H2.resolve = 0; R.dice.push([2]); await toCrit(R);
  eq(R.prompt("luckReroll"), null, "PW030 [B2816]: no Resolve left, no stress to take: not asked");
  /* an NPC's Luck Control: the GM's own card; the GM's pick needs no confirmation */
  const N = new Table(); N.hero("H1", "p1", { name: "Eve", health: 1, maxHealth: 6 }).npc("N1", { name: "Doc", health: 6 }).npc("N2", { name: "Jinx", health: 6 }); kit(N, "N2", luck(null)); N.order(["N1", "H1", "N2"]);
  N.dice.push([2]); await toCrit(N);
  eq(N.prompt("luckReroll")?.to ?? null, "gm", "PW030: an NPC's Luck Control: the GM's card");
  N.dice.push([6]); await N.answer("gm", "luckReroll", "reroll"); await N.answer("gm", "critPick", "d:1");
  eq([N.prompt("critConfirm"), N.evs("crit").map((e) => e.crit.roll)], [null, [7]], "PW030: picked by the GM: written at once");
  ok(D.CARD_KINDS.includes("luckReroll") && tr("en")("ITAC.card.luckReroll") === "Re-roll the injury?" && t("ITAC.card.luckReroll") === "Przerzucić ranę?", "PW030: a card kind with words in both languages");
}

done("check-anse");
