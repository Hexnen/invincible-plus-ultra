/* node scripts/tactics/check-fxf.mjs -- fixer F after Adversary 9 (live, 2026-11-12): D113, D114, D116, U117, U118, U121.
   D113: the reactions that were only a note (Discretion [B2108], Warning Call [B2170]) charged their price and did nothing, and nobody was
   told. Through the REAL director, engine, ledger and journal:
     A. Discretion: the PRESENCE roll, a six puts the ally in the way (its own defence card), none leaves the target its own defence
     B. Discretion with two allies: one answer per ally, the answer names whom
     C. Warning Call: the warned one blocks or dodges without an action, with two more dice; after a pass it is asked again; after a
        paid defence that defence gets the dice
     D. a reaction the engine has no rule for (catalog effect "note", a power the GM granted): a card on the GM's desk, the attack waits
     E. the table is told: the news line and the journal say what the reaction came to
   D114, D116, U117, U118, U121: see their blocks. */
import { readFileSync } from "node:fs";
import { Table, ok, eq, done } from "./testkit.mjs";
import * as C from "./catalog-pure.mjs";
import * as KP from "./kit-pure.mjs";
import * as Kit from "./flows/kit.mjs";
import * as MP from "./ui/model-pure.mjs";
import * as DP from "./desk-pure.mjs";
import { t as tEn } from "./lang.mjs";
import * as S from "./state-pure.mjs";
import * as V from "./view-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as Src from "./source.mjs";

const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const decl = (actor, action, targets, extra = {}) => ({ op: "declare", actor, decl: { action, targets, ...extra } });
const item = (id, name, type) => ({ id, name, type, level: null, power: null, boosts: [], autos: [], fx: [], flags: { kit: null, off: false, types: [] }, wf: {} });
const give = (T, cid, ...names) => { const c = T.c[cid]; c.kit = KP.build({ items: names.map((n, i) => item(`i${i}${cid}`, n, "talent")), attrs: c.attrs }); c.pass = c.kit.pass; return T; };
const rid = (T, cid, k) => `r:${T.c[cid].kit.actions.find((a) => a.id.endsWith(`-${k}`)).id}`;
const units = (T, cid) => JSON.stringify(T.state.ledger[cid]);
const spent = (T, cid) => JSON.stringify([T.state.ledger[cid].grants, T.state.ledger[cid].entries.filter((e) => e.cost !== "none").length]);      // what the actions came to (a reaction at no cost is still recorded)
const card = (T, cid) => T.prompt("reaction", cid);
const ids = (p) => (p?.options ?? []).map((o) => (o.id.startsWith("r:") ? `r:${o.id.split("-").pop()}` : o.id));
/* N1 attacks; H1 and H2 heroes side by side, H3 another hero; all in z1 */
const base = (extra = () => {}, order = ["N1", "H1", "H2", "H3", "N2"]) => { const T = new Table(); T.hero("H1", "p1", { name: "Omni" }).hero("H2", "p2", { name: "Kid" }).hero("H3", "p3", { name: "Eve" }).npc("N1", { name: "Turret", health: 6 }).npc("N2", { name: "Soldier", health: 6 }); T.c.H3.zone = "z2"; extra(T); T.order(order); return T; };
const finish = async (T, sixes = 1) => { await T.roll("attack", sixes); for (const sp of T.prompts("stunts")) await T.gm({ op: "answerFor", prompt: sp.id, value: [] }); };
const lastNews = (T) => (T.state.news ?? []).filter((n) => n.kind === "action").at(-1) ?? null;
const facts = (T) => ({ c: (id) => T.c[id] ?? null, staff: false });

/* ---- A. Discretion [B2108]: "make a PRESENCE roll (no action) to make the ally be targeted instead; 1 stress" */
{
  const T = base((t) => give(t, "H2", "Discretion"));
  eq(code(await T.gm(decl("N1", "slugfest", ["H2"]))), "ok", "A: the turret attacks Kid, Omni stands beside");
  eq(ids(card(T, "H2")), ["block", "r:discretion", "pass"], "A: Discretion is on Kid's own card");
  const u2 = spent(T, "H2"), r2 = T.c.H2.resolve;
  eq(code(await T.req("p2", { op: "answer", prompt: card(T, "H2").id, value: rid(T, "H2", "discretion") })), "ok", "A: Kid takes it");
  eq([T.c.H2.resolve, spent(T, "H2") === u2], [r2 - 1, true], "A: one stress, no action [B2108]");
  eq([T.top().rolls["ds:H2"]?.who, T.top().rolls["ds:H2"]?.attr, T.lastRequest()?.users], ["H2", "presence", ["p2"]], "A: Kid rolls PRESENCE with its own player's hand");
  eq([T.top().decl.targets, T.top().step], [["H2"], "reactBefore"], "A: the attack waits for that roll");
  await T.roll("ds:H2", 1);
  eq(T.top().decl.targets, ["H1"], "D113: with a six the ally is attacked instead");
  eq([ids(card(T, "H1")).includes("block"), card(T, "H2")], [true, null], "A: Omni gets its own defence card; Kid none");
  await T.req("p1", { op: "answer", prompt: card(T, "H1").id, value: "pass" });
  const h1 = T.c.H1.health, h2 = T.c.H2.health;
  await finish(T);
  eq([T.c.H1.health < h1, T.c.H2.health], [true, h2], "A: Omni takes the hit, Kid is untouched");
  const n = lastNews(T);
  eq(n?.reacts, [{ who: "H2", effect: "allySwap", result: "moved", about: "H1", name: "Discretion", label: "ITAC.kit.act.discretion" }], "D113: the news of the attack says what Discretion came to");
  const said = MP.newsData({ news: T.state.news, round: T.state.round }, {}, facts(T), tEn)?.text ?? "";
  ok(/Kid: Discretion, Omni is attacked instead/.test(said), `D113: the player's news line says it (${said})`);
  const jl = T.log.list.at(-1)?.label ?? {};
  ok(/\[Kid: Discretion \(\{ITAC\.journal\.react\.moved\}\)\]/.test(jl.gm ?? "") && /\[\{c:H2\}: Discretion/.test(jl.pub ?? ""), `D113: the journal line names it for the GM and the table (${jl.gm} | ${jl.pub})`);
}
{
  const T = base((t) => give(t, "H2", "Discretion"));
  await T.gm(decl("N1", "slugfest", ["H2"]));
  await T.req("p2", { op: "answer", prompt: card(T, "H2").id, value: rid(T, "H2", "discretion") });
  await T.roll("ds:H2", 0);
  eq(T.top().decl.targets, ["H2"], "A: without a six the attack stays on Kid");
  const again = card(T, "H2");
  eq(ids(again), ["block", "pass"], "D113: Kid is asked again and may still block (Discretion took no action); Discretion is not offered twice");
  const u2 = units(T, "H2");
  eq(code(await T.req("p2", { op: "answer", prompt: again.id, value: "block" })), "ok", "A: Kid blocks");
  ok(units(T, "H2") !== u2, "A: the block is paid as always");
  await T.roll("attack", 1); await T.roll("def:H2", 1);
  for (const sp of T.prompts("stunts")) await T.gm({ op: "answerFor", prompt: sp.id, value: [] });
  eq(lastNews(T)?.reacts?.map((r) => r.result), ["failed"], "D113: the news says it failed");
}
{
  /* the ally walks away before Kid's dice: no swap */
  const T = base((t) => give(t, "H2", "Discretion"));
  await T.gm(decl("N1", "slugfest", ["H2"]));
  await T.req("p2", { op: "answer", prompt: card(T, "H2").id, value: rid(T, "H2", "discretion") });
  T.c.H1.zone = "z2";
  await T.roll("ds:H2", 2);
  eq([T.top().decl.targets, ids(card(T, "H2"))], [["H2"], ["block", "pass"]], "A: the ally left before the roll: nobody is put in the way, Kid defends");
}

/* ---- B. two allies: one answer per ally */
{
  const T = base((t) => { give(t, "H2", "Discretion"); t.c.H3.zone = "z1"; });
  await T.gm(decl("N1", "slugfest", ["H2"]));
  const p = card(T, "H2"), rs = p.options.filter((o) => o.id.startsWith("r:"));
  eq([rs.length, rs.map((o) => o.data.about)], [2, ["H1", "H3"]], "D113: Discretion with two allies: one answer per ally");
  const ask = MP.askData({ ...p, answerReq: () => null }, { t: tEn, facts: facts(T), own: {}, desk: false });
  eq(ask.options.filter((o) => String(o.id).startsWith("r:")).map((o) => o.label), ["Discretion: Omni", "Discretion: Eve"], "D113: each answer names the ally beside the name of the talent");
  await T.req("p2", { op: "answer", prompt: p.id, value: rs[1].id });
  await T.roll("ds:H2", 1);
  eq(T.top().decl.targets, ["H3"], "B: the ally named in the answer is attacked instead");
}

/* ---- C. Warning Call [B2170]: "block or dodge without using their own action, and +2 dice" */
{
  const T = base((t) => give(t, "H1", "Warning Call"));
  await T.gm(decl("N1", "slugfest", ["H2"]));
  eq(ids(card(T, "H1")), ["r:warn", "pass", "pass:round"], "C: Omni may shout a warning for Kid");
  const old = card(T, "H2"), u1 = units(T, "H1");
  eq(code(await T.req("p1", { op: "answer", prompt: card(T, "H1").id, value: rid(T, "H1", "warn") })), "ok", "C: Omni shouts");
  ok(units(T, "H1") !== u1, "C: Omni's quick action is spent");
  const now = card(T, "H2");
  eq([now?.id !== old.id, ids(now), now?.data?.warned, now?.options.find((o) => o.id === "block:warned")?.cost], [true, ["block:warned", "pass"], "H1", "none"], "D113: Kid's card is made again: block with no action (the paid one is not offered)");
  eq(code(await T.req("p2", { op: "answer", prompt: old.id, value: "block" })), "gone", "C: the old card cannot be answered any more");
  const ask = MP.askData({ ...now, answerReq: () => null }, { t: tEn, facts: facts(T), own: {}, desk: false });
  ok(ask.lines.some((l) => l === "Omni warned you: block or dodge with no action and two more dice."), "C: the card says who warned and what it gives");
  const u2 = spent(T, "H2"), r2 = T.c.H2.resolve;
  eq(code(await T.req("p2", { op: "answer", prompt: now.id, value: "block:warned" })), "ok", "C: Kid blocks");
  eq([spent(T, "H2") === u2, T.c.H2.resolve], [true, r2], "D113: no action and no stress of Kid's own");
  await T.roll("attack", 1);
  const d = T.top().rolls["def:H2"];
  eq([d?.pool?.mods?.find((m) => m.source === "warned")?.dice, d?.pool?.total], [2, T.c.H2.attrs.fighting + 2], "D113: the block rolls two more dice");
}
{
  /* Kid passed before the warning came: asked again */
  const T = base((t) => give(t, "H1", "Warning Call"));
  await T.gm(decl("N1", "slugfest", ["H2"]));
  await T.req("p2", { op: "answer", prompt: card(T, "H2").id, value: "pass" });
  await T.req("p1", { op: "answer", prompt: card(T, "H1").id, value: rid(T, "H1", "warn") });
  eq(ids(card(T, "H2")), ["block:warned", "pass"], "C: after a pass the warned one is asked again");
  await T.req("p2", { op: "answer", prompt: card(T, "H2").id, value: "pass" });
  eq(T.top().step, "roll", "C: a second pass lets the attack go on");
  await finish(T);
  eq(lastNews(T)?.reacts, [{ who: "H1", effect: "warn", result: "card", about: "H2", name: "Warning Call", label: "ITAC.kit.act.warn" }], "D113: the news says Omni warned Kid");
}
{
  /* Kid paid for a block before the warning came: that block gets the dice */
  const T = base((t) => give(t, "H1", "Warning Call"));
  await T.gm(decl("N1", "slugfest", ["H2"]));
  await T.req("p2", { op: "answer", prompt: card(T, "H2").id, value: "block" });
  await T.req("p1", { op: "answer", prompt: card(T, "H1").id, value: rid(T, "H1", "warn") });
  eq([card(T, "H2"), T.top().data.def.H2.defence], [null, "block"], "C: the block stands, no new card");
  await T.roll("attack", 1);
  eq(T.top().rolls["def:H2"]?.pool?.mods?.find((m) => m.source === "warned")?.dice, 2, "D113: the block already paid gets the two dice");
  await T.roll("def:H2", 0);
  for (const sp of T.prompts("stunts")) await T.gm({ op: "answerFor", prompt: sp.id, value: [] });
  eq(lastNews(T)?.reacts?.map((r) => r.result), ["dice"], "C: the news says so");
}
{
  /* an area attack: one warning answer per attacked one */
  const T = base((t) => { give(t, "H1", "Warning Call"); t.c.H3.zone = "z1"; t.c.H1.zone = "z2"; t.c.N2.zone = "z3"; });
  T.weapons.bomb = { id: "bomb", bonus: 0, damage: 3, range: [0, 3], area: true };
  await T.gm(decl("N1", "shoot", ["H2", "H3"], { weapon: "bomb", area: true }));
  const w = card(T, "H1")?.options.filter((o) => o.id.startsWith("r:")) ?? [];
  eq(w.map((o) => o.data.about), ["H2", "H3"], "C: several attacked: Omni chooses whom to warn");
  await T.req("p1", { op: "answer", prompt: card(T, "H1").id, value: w[1].id });
  eq([ids(card(T, "H3")).includes("block:warned") || ids(card(T, "H3")).includes("dodge:warned"), ids(card(T, "H2")).some((x) => x.endsWith(":warned"))], [true, false], "C: only the one named is warned");
}

/* ---- D. an entry with no rule of the engine ("note"): the GM's card, the attack waits */
{
  const NOTE = { id: "ward", flow: "plain", cost: "quick", src: [1], name: "Ward", reaction: { when: ["beforeRoll"], who: "any", effect: "note" } };
  const T = base();
  await T.gm({ op: "powerGrant", combatant: "H1", entry: NOTE });
  await T.gm(decl("N1", "slugfest", ["H2"]));
  await T.req("p2", { op: "answer", prompt: card(T, "H2").id, value: "pass" });
  await T.req("p1", { op: "answer", prompt: card(T, "H1").id, value: "r:ward" });
  const g = T.prompt("reactionByHand");
  eq([g?.to, g?.about, g?.data?.name, g?.data?.targets, T.top().step], ["gm", "H1", "Ward", ["H2"], "reactBefore"], "D113: the GM gets a card naming who used what on whom; the attack waits");
  const desk = DP.deskModel(T.state, T.log, { c: (id) => T.c[id] });
  ok(desk.cards.some((c) => c.kind === "reactionByHand"), "D113: the card is on the desk");
  const ask = MP.askData({ ...g, answerReq: () => null }, { t: tEn, facts: { ...facts(T), staff: true }, own: {}, desk: true });
  ok(ask.lines.some((l) => l === "Omni used Ward against the attack of Turret on Kid. Do what it does yourself, then press Done."), `D113: the card says what to do (${JSON.stringify(ask.lines)})`);
  await T.gm({ op: "answerFor", prompt: g.id, value: { id: "done", text: "Kid ducks behind the ward" } });
  eq(T.top().step, "roll", "D: the GM's word lets the attack go on");
  await finish(T);
  eq(lastNews(T)?.reacts, [{ who: "H1", effect: "note", result: "byHand", name: "Ward", note: "Kid ducks behind the ward" }], "D113: the news says the GM settled it");
}
{
  /* nothing in the catalog of the kit is a bare note any more */
  const all = ["Discretion", "Warning Call", "Guardian", "Intangibility"].map((n) => KP.build({ items: [item("x", n, n === "Intangibility" ? "power" : "talent")], attrs: {} }).actions).flat().filter((a) => a.reaction);
  eq(all.filter((a) => a.reaction.effect === "note").map((a) => a.id), [], "D113: no talent or power of the kit is left as a note");
  ok(C.REACTION_EFFECTS.includes("allySwap") && C.REACTION_EFFECTS.includes("warn"), "D113: the catalog knows the two effects");
  eq(Kit.reactionId("r:k-x-discretion@H1"), { id: "r:k-x-discretion", about: "H1" }, "D113: an answer about one character");
}

/* ---- D114: a book villain is a superhero actor too: the side is not the type alone */
{
  eq([S.heroSide({ type: "superhero", owned: true, disposition: -1 }), S.heroSide({ type: "superhero", owned: false, disposition: 1 }), S.heroSide({ type: "superhero", owned: false, disposition: -1 }), S.heroSide({ type: "superhero", owned: false, disposition: 0 }), S.heroSide({ type: "npc", owned: true, disposition: 1 }), S.heroSide(null)],
    [true, true, false, false, false, false], "D114: a superhero a player owns or the GM put down as friendly is a hero; one with no owner and a hostile or neutral token (Doc Seismic from the book) is the GM's");
  const eng = readFileSync(new URL("./engine.mjs", import.meta.url), "utf8"), sys = readFileSync(new URL("./system-adapter.mjs", import.meta.url), "utf8");
  const isNpc = eng.split(String.fromCharCode(10)).find((l) => l.startsWith("const isNpc = ")) ?? "";
  ok(isNpc.includes("S.heroSide(") && !/type !== "superhero"/.test(isNpc) && isNpc.includes("summonOf"), "D114: the live facts read the side through heroSide (the summoner's side too) [B1808]");
  ok(/hero: S\.heroSide\(/.test(sys), "D114: the initiative's heroes are the same heroes [B2112]");
  /* the engine sees the villain as an NPC: an opponent beside the hit one is offered as Bang Heads' extra opponent */
  const T = new Table(); T.hero("H1", "p1", { name: "Omni" }).npc("N1", { health: 6 }).npc("V1", { name: "Doc Seismic", health: 6 }); T.order(["H1", "N1", "V1"]);
  await T.req("p1", decl("H1", "slugfest", ["N1"])); for (const p of T.prompts("reaction")) await T.gm({ op: "answerFor", prompt: p.id, value: "pass" });
  await T.roll("attack", 4);
  ok((T.prompt("stunts")?.options ?? []).some((o) => o.id === "bangHeads@N1|V1"), "D114: an enemy of the NPC side beside the target is an extra opponent");
}

/* ---- D116: a wiped minion group is nobody to bang heads with */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Eve" }).npc("N1", { health: 6 }).npc("G1", { name: "Soldier", kind: "minions", health: 0, members: 0, maxHealth: 6 }); T.order(["H1", "N1", "G1"]);
  await T.req("p1", decl("H1", "slugfest", ["N1"])); for (const p of T.prompts("reaction")) await T.gm({ op: "answerFor", prompt: p.id, value: "pass" });
  await T.roll("attack", 4);
  const sp = T.prompt("stunts");
  eq([sp?.options.some((o) => String(o.id).includes("G1")), sp?.options.find((o) => o.id === "bangHeads@N1")?.disabled ?? null], [false, "noOtherTarget"], "D116: the group with no member left is not offered; Bang Heads says why");
  eq(code(await T.req("p1", { op: "answer", prompt: sp.id, value: ["bangHeads@N1|G1"] })), "badInput", "D116: naming it is refused (no such answer on the card)");
  eq(T.prompt("minionLoss"), null, "D116: the GM is not asked how many of nobody fall");
  const T2 = new Table(); T2.hero("H1", "p1").npc("N1", { health: 6 }).npc("G1", { kind: "minions", health: 3, members: 3, maxHealth: 6 }); T2.order(["H1", "N1", "G1"]);
  await T2.req("p1", decl("H1", "slugfest", ["N1"])); for (const p of T2.prompts("reaction")) await T2.gm({ op: "answerFor", prompt: p.id, value: "pass" });
  await T2.roll("attack", 4);
  ok(T2.prompt("stunts")?.options.some((o) => o.id === "bangHeads@N1|G1"), "D116: a group with members left still is");
}

/* ---- U121: an open stunt card is made again when somebody comes into reach */
{
  const T = new Table(); T.hero("H1", "p1").npc("N1", { health: 6 }); T.order(["H1", "N1"]);
  await T.req("p1", decl("H1", "slugfest", ["N1"])); for (const p of T.prompts("reaction")) await T.gm({ op: "answerFor", prompt: p.id, value: "pass" });
  await T.roll("attack", 4);
  const before = T.prompt("stunts");
  eq(before?.options.find((o) => o.id === "bangHeads@N1")?.disabled, "noOtherTarget", "U121: nobody beside the target: Bang Heads cannot be taken");
  T.npc("N9", { name: "Scientists", health: 6 });                                           // the GM drops a group next to the target
  eq(code(await T.gm({ op: "roster" })), "ok", "U121: the roster takes the newcomer");
  const after = T.prompt("stunts");
  eq([after?.id !== before.id, after?.options.some((o) => o.id === "bangHeads@N1|N9")], [true, true], "U121: the card is made again and offers the newcomer");
  eq(code(await T.req("p1", { op: "answer", prompt: before.id, value: [] })), "gone", "U121: the old card is withdrawn");
  const r2 = await T.gm({ op: "roster" });
  eq([code(r2), T.prompt("stunts")?.id], ["ok", after.id], "U121: nothing changed: the card stays as it is");
}

/* ---- U117: "Start the vehicle" is not offered for an engine that runs */
{
  const T = new Table(); T.hero("H1", "p1").npc("N1", { health: 6 }); T.add("V1", { kind: "vehicle", npc: true, health: 8, name: "Van", vehicle: { type: "ground", speed: 3, maneuver: 1, passengers: 3, weapons: 0 } });
  T.order(["H1", "N1"]).turn("H1");
  await T.req("p1", { op: "declare", actor: "H1", decl: { action: "vehicleEnter", targets: ["V1"] } });
  const ctx = { c: (id) => T.c[id], P1, special: () => [{ id: "V1", kind: "vehicle" }] };
  const bar = () => DP.barModel(V.viewFor(T.state, { id: "p1", staff: false, owns: ["H1"] }, { hidden: [], npc: ["N1", "V1"] }), "H1", ctx).actions.find((a) => a.id === "vehicleStart");
  eq(bar()?.disabled, null, "U117: a cold engine can be started");
  await T.req("p1", { op: "declare", actor: "H1", decl: { action: "vehicleStart" } });
  eq(bar()?.disabled, "alreadyStarted", "U117: a running engine is not offered again (greyed with the flow's own reason)");
  ok(/already running/.test(tEn("ITAC.reason.alreadyStarted")) && tEn("ITAC.reason.engineDisabled") !== "ITAC.reason.engineDisabled", "U117: both reasons have words");
}

/* ---- U118: the initiative bar shows a vehicle's side by who sits in it, not by the token's default disposition */
{
  const D = { SECRET: -2, HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1 };
  eq([Src.vehicleDisp([1], false, D), Src.vehicleDisp([-1, 1], false, D), Src.vehicleDisp([], true, D), Src.vehicleDisp([], false, D), Src.vehicleDisp([undefined, 1], false, D)], [1, -1, 1, 0, 1], "U118: the driver's side, else a player's vehicle is friendly, else neutral (a thing)");
  const T = new Table(); T.hero("H1", "p1").npc("N1"); T.add("V1", { kind: "vehicle", npc: true, health: 8, vehicle: { type: "ground", speed: 3, maneuver: 1, passengers: 3, weapons: 0 } }); T.order(["H1", "N1"]).turn("H1");
  await T.req("p1", { op: "declare", actor: "H1", decl: { action: "vehicleEnter", targets: ["V1"] } });
  const combat = { flags: { [S.MOD_ID]: { tactics: { state: S.serialize(T.state) } } } };
  eq(Src.aboard(combat, "V1"), ["H1"], "U118: who sits in it, read from the fight's state");
  const bar = readFileSync(new URL("../combat/bar.mjs", import.meta.url), "utf8");
  ok(/actor\?\.type === "vehicle" \? dispOf\(Tac\.vehicleDisp\(Tac\.aboardSeen\(c\.parent, c\.id, gm\)/.test(bar), "U118: the bar reads a vehicle's side that way (bug hunt 3: only of those aboard the user may know of)");
}

done("check-fxf");
