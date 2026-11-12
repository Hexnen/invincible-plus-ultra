/* node scripts/tactics/check-ansb.mjs -- ANSB: the user's answers of 2026-11-12 (dev/combat-answers-2026-11-12.md) built. One block per answer;
   each pins the decision as the user worded it. Fights run through the REAL director, engine and view (testkit Table); the cards through
   the pure models (desk-pure, ui/model-pure); the system adapter's talent reader with plain objects shaped as Foundry items.
     A1 + P4-4 + INT-4 + INT-R4  «Grupa jako jedna postać»: an area attack, full auto, a blast, a hazard counts a minion group ONCE; as many
                                 fall as the damage after Armor, the number stands on the GM's card and the GM corrects it; the fate is the GM's
     A20                         «Płatność i stres jak dziś, obrona wraca»: a block / dodge that never reached its roll because the target changed
                                 goes back to its owner; the price paid at declaration and stress stay
     C8 (K5)                     «Po identyfikatorze z kompendium»: Combat Veteran / Fast Reflexes by compendium id, then the flag, then the name
     U17-2 (K6)                  «MG może wskazać każdego»: on the stunt card the GM may name ANY character as the extra opponent; a player keeps the list
     P6b-6 (K8)                  «Gracz wybiera kość, MG zatwierdza»: the two injury dice of Killer / Lucky Break: the holder picks, the GM confirms */
import { Table, ok, eq, done } from "./testkit.mjs";
import * as D from "./desk-pure.mjs";
import * as V from "./view-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./ui/model-pure.mjs";
import * as KP from "./kit-pure.mjs";
import * as Attack from "./flows/attack.mjs";
import * as Sys from "./system-adapter.mjs";
import { tIn } from "./lang.mjs";

const tr = (l) => (k, p = {}, f) => tIn(l, k, p, f);
const t = tr("pl");
const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const why = (env) => env?.error?.params?.reason ?? null;
const decl = (actor, action, targets, extra = {}) => ({ op: "declare", actor, decl: { action, targets, ...extra } });
const meta = (T) => ({ hidden: Object.values(T.c).filter((c) => c.hidden).map((c) => c.id), npc: Object.values(T.c).filter((c) => c.npc).map((c) => c.id) });
const facts = (T, view, me, staff = false) => ({ view, me, staff, c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc, kind: T.c[id].kind, img: null } : null), attrs: (id) => T.c[id]?.attrs ?? null, userName: (u) => `user-${u}`, online: () => true, preview: () => null });
const ctx = (T) => ({ c: (id) => T.c[id] ?? null, online: () => true, P1 });
const desk = (T, own = {}) => M.deskData(D.deskModel(T.state, T.log, ctx(T)), own, facts(T, T.state, "gm", true), t);
const dock = (T, uid, owns, own = {}) => { const view = V.viewFor(T.state, { id: uid, staff: false, owns }, meta(T)); return M.dockData(D.playerModel(view, { id: uid, owns }, ctx(T)), own, facts(T, view, uid), t); };
const view = (T) => ({ state: T.state, facts: T.facts(), entry: () => null });
const passAll = async (T) => { for (const p of T.prompts("reaction")) await T.req(p.to === "gm" ? "gm" : p.to.users[0], { op: p.to === "gm" ? "answerFor" : "answer", prompt: p.id, value: "pass" }); };
const item = (id, name) => ({ id, name, type: "talent", level: null, power: null, boosts: [], autos: [], fx: [], flags: { kit: null, off: false, types: [] }, wf: {} });
const give = (T, cid, ...names) => { const c = T.c[cid]; c.kit = KP.build({ items: names.map((n, i) => item(`i${i}${cid}`, n)), attrs: c.attrs }); c.pass = c.kit.pass; return T; };
const NADE = { id: "nade", bonus: 0, damage: 3, range: [0, 3], blast: 2, area: true };

/* ================================================================== A1 + P4-4 + INT-4 + INT-R4: a minion group counted once */
{
  /* an area shot into the group's zone: the group is ONE of the targets, ONE card, the number starts at the damage after Armor (3 - 1) */
  const T = new Table(); T.hero("H1", "p1").npc("N1", { health: 6 }); T.add("M1", { npc: true, name: "Soldiers", kind: "minions", members: 6, health: 6, armor: [{ id: "vest", armor: 1 }] });
  T.weapons.nade = NADE; T.order(["H1", "N1", "M1"]);
  eq(code(await T.req("p1", decl("H1", "shoot", ["N1"], { weapon: "nade", area: true }))), "ok", "A1: (an area shot into the zone of a thug and a group)");
  eq(T.top().decl.targets.filter((x) => x === "M1").length, 1, "A1: the group stands once among the targets of the area");
  await passAll(T); await T.roll("attack", 1);
  const cards = T.prompts().filter((p) => p.about === "M1" && ["minionsQuick", "minionLoss"].includes(p.kind));
  eq([cards.length, cards[0]?.kind, cards[0]?.data?.suggested], [1, "minionsQuick", 2], "A1: one card for the group, the number written in from the damage after Armor (3 - 1 = 2)");
  const a = desk(T).cards.find((c) => c.kind === "minionsQuick");
  eq(a?.count?.value, 2, "A1: the GM's card shows the number already written in");
  eq(code(await T.answer("gm", "minionsQuick", "ko:1", "M1")), "ok", "A1: the GM corrects it (1, knocked out)");
  eq([T.c.M1.health, (T.state.statuses?.M1 ?? []).map((s) => s.id).includes("dead")], [5, false], "A1: one of the group is out, the GM's number counts; knocked out, the GM's choice");
}
{
  /* full auto at two thugs and the group: the group counted once */
  const T = new Table(); T.hero("H1", "p1").npc("N1", { health: 6 }); T.add("M1", { npc: true, name: "Soldiers", kind: "minions", members: 5, health: 5 });
  T.weapons.smg = { id: "smg", bonus: 0, damage: 2, range: [0, 2], fullAuto: true }; T.order(["H1", "N1", "M1"]);
  eq(code(await T.req("p1", decl("H1", "shoot", ["N1", "M1", "M1"], { weapon: "smg", fullAuto: true }))), "ok", "A1: (full auto at a thug and the group, the group named twice)");
  eq(T.top().decl.targets, ["N1", "M1"], "A1: full auto counts the group once: it is one character");
  await passAll(T); await T.roll("attack", 1);
  const q = T.prompts().filter((p) => p.about === "M1" && p.kind === "minionsQuick");
  eq([q.length, q[0]?.data?.suggested], [1, 2], "A1: full auto: one card for the group, written in from the damage (2)");
}
{
  /* a blast (INT-4): the group once, the damage written in */
  const T = new Table(); T.hero("H1", "p1"); T.add("M1", { npc: true, name: "Soldiers", kind: "minions", members: 6, health: 6 }); T.order(["H1", "M1"]);
  T.dice.push([6, 1, 1, 1, 1, 1]);
  eq(code(await T.gm({ op: "hazardRun", run: { type: "blast", rating: 6, targets: ["M1", "M1"] } })), "ok", "INT-4: (a blast on the group, named twice by mistake)");
  for (let g = 0; g < 4 && T.prompt("hazardDodge"); g++) await T.answer("gm", "hazardDodge", "pass");
  const q = T.prompts().filter((p) => p.about === "M1" && p.kind === "minionsQuick");
  eq([T.top()?.decl.targets, q.length, q[0]?.data?.suggested], [["M1"], 1, 3], "INT-4: the blast counts the group once: one card, written in from its damage (3)");
}
{
  /* fire (INT-R4: a hazard): today's automatic one-per-point becomes the same card */
  const T = new Table(); T.hero("H1", "p1"); T.add("M1", { npc: true, name: "Soldiers", kind: "minions", members: 6, health: 6 }); T.order(["H1", "M1"]);
  T.dice.push([6, 1, 1, 1, 1, 1]);
  eq(code(await T.gm({ op: "hazard", hazard: { kind: "fire", intensity: 6 }, targets: ["M1"] })), "ok", "INT-R4: (a fire attack on the group)");
  const q = T.prompt("minionsQuick", "M1");
  eq([q?.to, q?.data?.suggested, T.c.M1.health], ["gm", 2, 6], "INT-R4: fire asks the GM's card too, the number written in (one six = 2 damage [B2925]); nothing is taken before the GM's word");
  eq(code(await T.answer("gm", "minionsQuick", "kill:2", "M1")), "ok", "INT-R4: the GM corrects it to 2, killed");
  eq([T.c.M1.health, T.prompt("minionsFate")], [4, null], "INT-R4: two of the group are gone, the fate said on the same card");
  /* a fall is no hazard of the book: one member per point, automatic as before [B2828] */
  const F = new Table(); F.hero("H1", "p1"); F.add("M1", { npc: true, name: "Soldiers", kind: "minions", members: 6, health: 6 }); F.order(["H1", "M1"]);
  await F.gm({ op: "npcPolicy", combatant: "M1", policy: { onBroken: "ko" } });
  await F.gm({ op: "hazard", hazard: { kind: "fixed", amount: 2, cause: "fall" }, targets: ["M1"] });
  eq([F.prompt("minionsQuick"), F.prompt("minionLoss"), F.c.M1.health], [null, null, 4], "A1: a fall takes one member per point without a card (no hazard of the book)");
  /* a fixed damage of a hazard (the chase's obstacle, a vehicle's passengers) asks */
  const H = new Table(); H.hero("H1", "p1"); H.add("M1", { npc: true, name: "Soldiers", kind: "minions", members: 6, health: 6 }); H.order(["H1", "M1"]);
  await H.gm({ op: "hazard", hazard: { kind: "fixed", amount: 2, cause: "hazard" }, targets: ["M1"] });
  eq([H.prompt("minionsQuick", "M1")?.data?.suggested, H.c.M1.health], [2, 6], "INT-R4: a fixed damage of a hazard asks the same card (2 written in)");
}

/* ================================================================== A20: the defence that never reached its roll goes back */
{
  const T = new Table();
  T.hero("H1", "p1", { name: "Guardian" }).hero("H2", "p2", { name: "Friend" }).npc("N1", { health: 6 }).npc("N2", { health: 6 });
  give(T, "H1", "Guardian"); T.order(["N1", "H1", "H2", "N2"]);
  await T.gm(decl("N1", "slugfest", ["H2"]));
  const live = (cid, a = "block") => (T.state.ledger[cid]?.entries ?? []).filter((e) => !e.void && e.action === a).length, b0 = JSON.stringify(P1.budget(T.state, "H2"));
  await T.req("p2", { op: "answer", prompt: T.prompt("reaction", "H2").id, value: "block" });
  eq(live("H2"), 1, "A20: (the target's block is paid at the declaration, as today)");
  ok(JSON.stringify(P1.budget(T.state, "H2")) !== b0, "A20: (its quick action is spent for now)");
  const g = T.c.H1.kit.actions.find((a) => a.id.endsWith("-guardian")).id;
  await T.req("p1", { op: "answer", prompt: T.prompt("reaction", "H1").id, value: `r:${g}` });
  await T.roll("sw:H1", 1);
  eq([T.top()?.decl.targets, live("H2"), JSON.stringify(P1.budget(T.state, "H2")) === b0], [["H1"], 0, true], "A20: the guardian took the hit: the block that never reached its roll goes back to its owner");
  eq((T.top()?.data.notes ?? []).some((n) => n.note === "defenceBack" && n.who === "H2"), true, "A20: the instance keeps a note of the defence given back");
  ok((T.state.ledger.H1?.entries ?? []).some((e) => !e.void && e.action === g), "A20: the guardian's own action stays paid");
  const tx = T.log.list[T.log.list.length - 1]?.id;
  if (tx) { await T.gm({ op: "undo", tx }); ok(live("H2") <= 1, "A20: undo is consistent (no double entry)"); }
}
{
  /* no six: the target stays, its block stays spent and is rolled */
  const T = new Table();
  T.hero("H1", "p1", { name: "Guardian" }).hero("H2", "p2", { name: "Friend" }).npc("N1", { health: 6 }).npc("N2", { health: 6 });
  give(T, "H1", "Guardian"); T.order(["N1", "H1", "H2", "N2"]);
  await T.gm(decl("N1", "slugfest", ["H2"]));
  await T.req("p2", { op: "answer", prompt: T.prompt("reaction", "H2").id, value: "block" });
  const g = T.c.H1.kit.actions.find((a) => a.id.endsWith("-guardian")).id;
  await T.req("p1", { op: "answer", prompt: T.prompt("reaction", "H1").id, value: `r:${g}` });
  await T.roll("sw:H1", 0);
  eq([T.top()?.decl.targets, (T.state.ledger.H2?.entries ?? []).filter((e) => !e.void && e.action === "block").length, T.top()?.data.def?.H2?.defence], [["H2"], 1, "block"], "A20: the guardian failed: the target keeps its block, paid, and rolls it");
}
{
  /* the stress of a Defensive answer (no action) stays: «stres zostaje» */
  const T = new Table();
  T.hero("H1", "p1", { name: "Guardian" }).hero("H2", "p2", { name: "Friend", resolve: 5 }).npc("N1", { health: 6 }).npc("N2", { health: 6 });
  give(T, "H1", "Guardian"); give(T, "H2", "Defensive"); T.order(["N1", "H1", "H2", "N2"]);
  await T.gm(decl("N1", "slugfest", ["H2"]));
  const rp = T.prompt("reaction", "H2"), free = rp?.options.find((o) => o.id === "block:free" && !o.disabled);
  ok(!!free, "A20: (Defensive offers the block without an action, for 1 stress)");
  await T.req("p2", { op: "answer", prompt: rp.id, value: "block:free" });
  const r0 = T.c.H2.resolve;
  const g = T.c.H1.kit.actions.find((a) => a.id.endsWith("-guardian")).id;
  await T.req("p1", { op: "answer", prompt: T.prompt("reaction", "H1").id, value: `r:${g}` });
  await T.roll("sw:H1", 1);
  eq([T.top()?.decl.targets, T.c.H2.resolve, r0], [["H1"], r0, 4], "A20: the stress of the free block stays paid when the guardian takes the hit");
}

/* ================================================================== C8 (K5): talents by the compendium identifier */
{
  const A = (items, flags) => ({ items, flags: flags ? { "invincible-plus-ultra": { tactics: { talents: flags } } } : {} });
  const src = (id) => ({ compendiumSource: `Compendium.invincible-core.talents.Item.${id}` });
  eq([[...Sys.TALENT_IDS.combatVeteran], [...Sys.TALENT_IDS.fastReflexes]], [["3KMayirhMvPmp6Pn"], ["cfWewxWMSjM385XP"]], "C8: the identifiers come from the generated table of the compendia");
  ok(Sys.hasTalent(A([{ type: "talent", name: "Weteran walki", _stats: src("3KMayirhMvPmp6Pn") }]), "combatVeteran"), "C8: a renamed (Polish) Combat Veteran dragged from the compendium still counts");
  ok(Sys.hasTalent(A([{ type: "talent", name: "Refleks", id: "cfWewxWMSjM385XP" }]), "fastReflexes"), "C8: an imported pregenerated character keeps the compendium id as its own: still counts");
  ok(Sys.hasTalent(A([{ type: "talent", name: "Mój talent", _stats: src("3KMayirhMvPmp6Pn") }], { combatVeteran: false }), "combatVeteran"), "C8: the identifier comes first; the flag is only the fallback");
  ok(Sys.hasTalent(A([{ type: "talent", name: "Mój talent" }], { fastReflexes: true }), "fastReflexes"), "C8: no identifier: the flag");
  ok(!Sys.hasTalent(A([{ type: "talent", name: "Fast Reflexes" }], { fastReflexes: false }), "fastReflexes"), "C8: no identifier: the flag still wins over the name");
  ok(Sys.hasTalent(A([{ type: "talent", name: " fast  reflexes" }]), "fastReflexes"), "C8: neither: the English name (last fallback)");
  ok(!Sys.hasTalent(A([{ type: "power", name: "x", _stats: src("cfWewxWMSjM385XP") }, { type: "talent", name: "Szybki refleks", _stats: src("8974UEofMJ7GMQDH") }]), "fastReflexes"), "C8: another talent's id, or a non-talent with that id, does not count");
}

/* ================================================================== U17-2 (K6): the GM names anybody as the extra opponent */
const stuntCard = async (T, who, actor, action, target, sixes = 2) => {
  eq(code(await T.req(who, decl(actor, action, [target]))), "ok", `(${actor} attacks ${target})`);
  await passAll(T); await T.roll("attack", sixes);
  return T.prompt("stunts");
};
{
  /* an NPC hits a hero: the GM's own card; the NPC's ally N2 and the hero H3 in another zone are not on the list */
  const T = new Table(); T.hero("H1", "p1", { name: "Eve" }).hero("H2", "p2", { name: "Rex" }).hero("H3", "p3", { name: "Kid", zone: "z2" }).npc("N1", { name: "Doc", health: 6 }).npc("N2", { name: "Thug", health: 6 });
  T.add("C1", { npc: true, kind: "challenge", name: "Bomb" }); T.add("V1", { npc: true, kind: "vehicle", name: "Van", health: 8, vehicle: { type: "ground", speed: 3, maneuver: 1, passengers: 3, weapons: 0 } });
  T.order(["N1", "H1", "H2", "N2", "H3"]);
  const sp = await stuntCard(T, "gm", "N1", "slugfest", "H1");
  eq((sp?.options ?? []).filter((o) => o.data?.stunt === "bangHeads" && o.data.extra).map((o) => o.data.extra), ["H2"], "U17-2: (the list names the other hero only)");
  const card = desk(T).cards.find((c) => c.kind === "stunts");
  const rows = card?.gmExtra?.rows ?? [];
  eq([rows.length, rows[0]?.choices.map((x) => x.id).sort()], [1, ["bangHeads@H1|H3", "bangHeads@H1|N2"]], "U17-2: the GM's card has a pick of anybody else: not the attacker, the target, one listed, a challenge or a vehicle");
  ok(/ktokolwiek \(MG\)/.test(rows[0]?.label ?? ""), "U17-2: the pick says what it is (Polish)");
  const own = { vals: { [`gx:${card.id}`]: ["bangHeads@H1|N2"] }, picks: { [card.id]: ["bangHeads@H1|N2"] } };
  const c2 = desk(T, own).cards.find((c) => c.kind === "stunts"), added = c2.options.find((o) => o.id === "bangHeads@H1|N2");
  eq([!!added, added?.picked, added?.group?.id, c2.gmExtra.rows[0].choices.map((x) => x.id)], [true, true, "more", ["bangHeads@H1|H3"]], "U17-2: a name chosen becomes one more answer of the card, ticked, under 'another opponent'");
  eq(code(await T.gm({ op: "answerFor", prompt: sp.id, value: ["bangHeads@H1|V1"] })), "illegal", "U17-2: never a vehicle (a thing, U17-R4)");
  eq(code(await T.gm({ op: "answerFor", prompt: sp.id, value: ["bangHeads@H1|N1"] })), "illegal", "U17-2: never the attacker");
  eq(code(await T.gm({ op: "answerFor", prompt: sp.id, value: ["bangHeads@H1|C1"] })), "illegal", "U17-2: never a challenge");
  const hp = T.c.N2.health;
  eq(code(await T.gm({ op: "answerFor", prompt: sp.id, value: ["bangHeads@H1|N2"] })), "ok", "U17-2: the GM names the NPC's own ally, who is not on the list");
  for (let g = 0; g < 8 && T.prompts().length; g++) { const p = T.prompts()[0]; await T.req(p.to === "gm" ? "gm" : p.to.users[0], { op: p.to === "gm" ? "answerFor" : "answer", prompt: p.id, value: p.options.find((o) => /pass|ko|none|approve/.test(o.id))?.id ?? p.options[0].id }); }
  eq(T.c.N2.health, hp - 2, "U17-2: and that one is hit: half of the attacker's STRENGTH (4 / 2 = 2) [B2437]");
}
{
  /* a hero hits an NPC: the player's card keeps the list; the GM's free pick shows only on the desk */
  const T = new Table(); T.hero("H1", "p1", { name: "Eve" }).hero("H2", "p2", { name: "Rex" }).npc("N1", { name: "Doc", health: 6 }).npc("N2", { name: "Thug", health: 6 });
  T.order(["H1", "N1", "H2", "N2"]);
  const sp = await stuntCard(T, "p1", "H1", "slugfest", "N1");
  eq(code(await T.req("p1", { op: "answer", prompt: sp.id, value: ["bangHeads@N1|H2"] })), "badInput", "U17-2: a player cannot name somebody off the list (his ally)");
  const pc = dock(T, "p1", ["H1"]).prompts?.find((p) => p.kind === "stunts") ?? null;
  eq(pc?.gmExtra ?? null, null, "U17-2: the player's card has no free pick");
  eq(code(await T.gm({ op: "answerFor", prompt: sp.id, value: ["bangHeads@N1|H2"] })), "ok", "U17-2: the GM may answer the same card with the ally");
}
{
  /* nobody else in the zone: Bang Heads is greyed on the list; the GM names somebody from another zone */
  const T = new Table(); T.hero("H1", "p1", { name: "Eve" }).npc("N1", { name: "Doc", health: 6 }).npc("N2", { name: "Thug", health: 6, zone: "z2" });
  T.order(["N1", "H1", "N2"]);
  const sp = await stuntCard(T, "gm", "N1", "slugfest", "H1");
  eq(sp?.options.find((o) => o.id === "bangHeads@H1")?.disabled ?? null, "noOtherTarget", "U17-2: (nobody on the list: the stunt is greyed)");
  const rows = desk(T).cards.find((c) => c.kind === "stunts")?.gmExtra?.rows ?? [];
  eq(rows[0]?.choices.map((x) => x.id), ["bangHeads@H1|N2"], "U17-2: the GM's pick still offers the one in the other zone");
  eq([Attack.validate(view(T), T.top(), sp, ["bangHeads@H1|N2"], true).ok, Attack.validate(view(T), T.top(), sp, ["bangHeads@H1|N2"]).reason], [true, "noOtherTarget"], "U17-2: legal for the GM, not without the GM's hand");
  ok(code(await T.gm({ op: "answerFor", prompt: sp.id, value: ["bangHeads@H1|N2", "bangHeads@H1|N2"] })) !== "ok", "U17-2: one extra opponent is named once");
}

/* ================================================================== P6b-6 (K8): the holder picks the injury die, the GM confirms */
const toCrit = async (T, attacker, who, target) => {
  await T.req(who, decl(attacker, "slugfest", [target])); await passAll(T); await T.roll("attack", 1);
  for (let g = 0; g < 6; g++) { const p = T.prompts().find((x) => x.kind === "stunts" || x.kind === "npcBroken"); if (!p) break; await T.req(p.to === "gm" ? "gm" : p.to.users[0], { op: p.to === "gm" ? "answerFor" : "answer", prompt: p.id, value: p.kind === "stunts" ? [] : "crit" }); }
};
{
  /* Lucky Break on a hero hit by an NPC: the player picks, the GM approves */
  const T = new Table(); T.hero("H1", "p1", { name: "Eve", health: 1, maxHealth: 6 }).npc("N1", { name: "Doc", health: 6 }); T.c.H1.pass = { luckyBreak: true }; T.order(["N1", "H1"]);
  T.dice.push([2, 5]);
  await toCrit(T, "N1", "gm", "H1");
  const cp = T.prompt("critPick");
  eq([cp?.to, cp?.about, cp?.options.map((o) => [o.id, o.data.d6])], [{ users: ["p1"] }, "H1", [["d:0", 2], ["d:1", 5]]], "P6b-6: Lucky Break: the injured hero's player gets the two dice to pick from");
  ok(cp?.options.every((o) => Number.isInteger(o.data.n) && typeof o.data.id === "string" && o.data.id), "P6b-6: each die says the injury it gives");
  eq([T.c.H1.crits, T.evs("crit").length], [[], 0], "P6b-6: nothing is written while the player picks");
  const pc = dock(T, "p1", ["H1"]).prompts?.find((p) => p.kind === "critPick");
  eq([pc?.options.map((o) => o.icon), pc?.options[0]?.label], [["die:2", "die:5"], t("ITAC.opt.critDie", { d6: 2, n: cp.options[0].data.n, crit: t(`ITAC.crit.${cp.options[0].data.id}`) })], "P6b-6: the player's card: each answer is its die (the face as the picture) and the injury, in Polish");
  ok(/Łut szczęścia/.test((pc?.lines ?? []).join(" ")), "P6b-6: the card names the talent with the sheet's Polish name");
  eq(code(await T.answer("p1", "critPick", "d:0")), "ok", "P6b-6: the player picks the 2");
  const ck = T.prompt("critConfirm");
  eq([ck?.to, ck?.options.map((o) => o.id), ck?.data?.pick?.d6, ck?.data?.other?.d6], ["gm", ["approve", "other"], 2, 5], "P6b-6: the GM's card: approve the pick or take the other die");
  const dc = desk(T).cards.find((c) => c.kind === "critConfirm");
  eq([dc?.options.map((o) => o.icon), /Zatwierdzić\?/.test(dc?.lines.join(" ") ?? "")], [["die:2", "die:5"], true], "P6b-6: the desk card names both dice");
  ok(D.CARD_KINDS.includes("critPick") && D.CARD_KINDS.includes("critConfirm") && tr("en")("ITAC.card.critPick") === "Injury die" && t("ITAC.card.critPick") === "Kość rany", "P6b-6: desk card kinds with words in both languages");
  eq(code(await T.answer("gm", "critConfirm", "approve")), "ok", "P6b-6: the GM approves");
  eq(T.evs("crit").map((e) => e.crit.roll), [3], "P6b-6: the picked die is written (2 + 1 for the hit)");
}
{
  /* the GM takes the other die */
  const T = new Table(); T.hero("H1", "p1", { name: "Eve", health: 1, maxHealth: 6 }).npc("N1", { name: "Doc", health: 6 }); T.c.H1.pass = { luckyBreak: true }; T.order(["N1", "H1"]);
  T.dice.push([2, 5]);
  await toCrit(T, "N1", "gm", "H1");
  await T.answer("p1", "critPick", "d:0"); await T.answer("gm", "critConfirm", "other");
  eq(T.evs("crit").map((e) => e.crit.roll), [6], "P6b-6: the GM's 'the other' keeps the 5 (5 + 1)");
}
{
  /* Killer of a hero against an NPC that is rolled like a hero: the attacker's player picks */
  const T = new Table(); T.hero("H1", "p1", { name: "Eve" }).npc("N1", { name: "Doc", health: 1, maxHealth: 6 }); T.c.H1.pass = { killer: 1 }; T.order(["H1", "N1"]);
  T.dice.push([4, 1]);
  await toCrit(T, "H1", "p1", "N1");
  const cp = T.prompt("critPick");
  eq([cp?.to, cp?.about, cp?.data?.talent, cp?.data?.target], [{ users: ["p1"] }, "H1", "killer", "N1"], "P6b-6: Killer: the attacker's player picks the injury of the one he broke");
  await T.answer("p1", "critPick", "d:1"); await T.answer("gm", "critConfirm", "approve");
  eq(T.evs("crit").map((e) => e.crit.roll), [2], "P6b-6: Killer may keep the LOWER die: the choice is the player's (1 + 1)");
}
{
  /* the GM picks for the player (or an NPC's Killer): no second card */
  const T = new Table(); T.hero("H1", "p1", { name: "Eve", health: 1, maxHealth: 6 }).npc("N1", { name: "Doc", health: 6 }); T.c.N1.pass = { killer: 1 }; T.order(["N1", "H1"]);
  T.dice.push([3, 6]);
  await toCrit(T, "N1", "gm", "H1");
  const cp = T.prompt("critPick");
  eq(cp?.to, "gm", "P6b-6: an NPC's Killer: the GM's own card");
  await T.answer("gm", "critPick", "d:0");
  eq([T.prompt("critConfirm"), T.evs("crit").map((e) => e.crit.roll)], [null, [4]], "P6b-6: picked by the GM: no confirmation, written at once");
}
{
  /* equal dice: nothing to choose; Killer against Lucky Break: one die, as before */
  const T = new Table(); T.hero("H1", "p1", { name: "Eve", health: 1, maxHealth: 6 }).npc("N1", { name: "Doc", health: 6 }); T.c.H1.pass = { luckyBreak: true }; T.order(["N1", "H1"]);
  T.dice.push([4, 4]);
  await toCrit(T, "N1", "gm", "H1");
  eq([T.prompt("critPick"), T.evs("crit").map((e) => e.crit.roll)], [null, [5]], "P6b-6: two equal dice ask nothing");
  const U = new Table(); U.hero("H1", "p1", { name: "Eve", health: 1, maxHealth: 6 }).npc("N1", { name: "Doc", health: 6 }); U.c.H1.pass = { luckyBreak: true }; U.c.N1.pass = { killer: 1 }; U.order(["N1", "H1"]);
  U.dice.push([2]);
  await toCrit(U, "N1", "gm", "H1");
  eq([U.prompt("critPick"), U.performed.filter((e) => e.t === "dice" && String(e.why).startsWith("crit")).map((e) => e.n)], [null, [1]], "P6b-6: Killer against Lucky Break cancel out: one die, no card");
}

done("check-ansb");
