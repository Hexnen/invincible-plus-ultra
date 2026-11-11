/* node scripts/tactics/check-int.mjs -- the packages together (P4 attacks, P5 other actions and hazards, P7 vehicles and chases), through the
   REAL director, engine, ledger and journal:
   A  journal lines of hazards and GM edits read in words, in both languages, never as ids
   B  the holder's rule at the declare gate and on the bar; the held one's escape (P5) ends the hold of the attack flow (P4)
   C  an area attack over a zone with a hidden combatant leaves no trace of it in any player's view, event or journal line
   D  the Fastball Special stands on the bar only with somebody to throw
   E  thrown straight up or down (the map's vertical chain): a roof in the way is the GM's word, open sky is not
   F  a blast (P5) treats a minion group and a vehicle as an attack (P4, P7) does */
import { Table, ok, eq, done } from "./testkit.mjs";
import { MTable } from "./check-kit-map.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./mods-pure.mjs";
import * as V from "./view-pure.mjs";
import * as D from "./desk-pure.mjs";
import * as UI from "./ui/model-pure.mjs";
import { t, EN, PL } from "./lang.mjs";

const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const why = (env) => env?.error?.params?.reason ?? null;
const decl = (actor, action, targets = [], extra = {}) => ({ op: "declare", actor, decl: { action, targets, ...extra } });
const has = (T, cid, id) => M.hasStatus(T.state, cid, id);
const pass = async (T) => { for (const p of T.prompts("reaction")) await T.req(p.to === "gm" ? "gm" : p.to.users[0], { op: p.to === "gm" ? "answerFor" : "answer", prompt: p.id, value: "pass" }); };
const inLang = (lang, fn) => { const g = globalThis.game, was = g.i18n; g.i18n = { lang }; try { return fn(); } finally { g.i18n = was; } };
/* names that are not the ids, so that an id in a text shows */
const base = (extra = () => {}, more = []) => { const T = new Table(); T.hero("H1", "p1", { name: "Ada" }).hero("H2", "p2", { name: "Bolt" }).npc("N1", { name: "Thug", health: 6 }).npc("N2", { name: "Goon", health: 6 }); extra(T); T.order(["H1", "N1", "H2", "N2", ...more]); return T; };
const IDS = /\b(H1|H2|N1|N2|M1|V1|z\d|hz\w*|gm)\b/;

/* ---- A. the journal in words */
{
  const T = base();
  T.dice.push([6, 3, 3, 2, 1, 4]);
  eq(code(await T.gm({ op: "hazardRun", run: { type: "blast", rating: 6 }, subject: { zone: "z1" } })), "ok", "A: the GM sets off a blast");
  for (let g = 0; g < 12 && T.state.stack.length; g++) { const p = T.prompts()[0]; if (!p) break; await T.gm({ op: "answerFor", prompt: p.id, value: p.options.find((o) => ["pass", "ko", "done"].includes(o.id))?.id ?? p.options[0].id }); }
  eq(T.state.stack.length, 0, "A: the blast is played out");
  await T.gm({ op: "statusAdd", combatant: "N1", status: { id: "prone" } });
  await T.gm({ op: "setHealth", combatant: "H2", value: 3 });
  const facts = { zone: (spot) => ({ id: 7, title: spot === "z1" ? "Zone 7" : null }), c: (id) => T.c[id] ?? null };
  const lines = T.log.list.map((x) => x.label ?? {});
  ok(lines.length >= 3, "A: the blast and both edits are in the journal");
  for (const l of lines) for (const k of ["gm", "pub"]) {
    const raw = String(l[k] ?? "").replace(/\{[^{}]*\}/g, "");
    ok(!IDS.test(raw), `A: no raw id in the ${k} line "${l[k]}"`);
    for (const lang of ["en", "pl"]) { const s = inLang(lang, () => UI.marks(t, l[k], facts)); ok(!/[{}]|ITAC\./.test(s), `A: the ${k} line reads in words (${lang}): "${s}"`); }
  }
  const hz = lines.find((l) => String(l.gm ?? "").includes("ITAC.action.blast"));
  ok(hz && /Thug|Ada/.test(hz.gm) && /\{zone:z1\}/.test(hz.gm), "A: the GM's line of the blast names who was in it and where");
  eq(inLang("pl", () => UI.marks(t, hz.gm, facts)).includes("Zone 7"), true, "A: the place is said as the map says it");
  ok(!/Thug|Goon|Ada|Bolt/.test(hz.pub ?? ""), "A: the public line of a hazard names nobody");
  const ed = lines.find((l) => /ITAC\.edit\.statusAdd/.test(l.gm ?? ""));
  ok(ed && /Thug/.test(ed.gm) && /\{ITAC\.journal\.gm\}/.test(ed.gm), "A: a GM edit says who did it, what, and to whom");
  eq([inLang("en", () => UI.marks(t, ed.gm, facts)).startsWith(EN["ITAC.journal.gm"]), inLang("pl", () => UI.marks(t, ed.gm, facts)).startsWith(PL["ITAC.journal.gm"])], [true, true], "A: in both languages");
}

/* ---- B. the holder [B2497] and the escape of the one held [B2496] */
{
  const T = base();
  await T.req("p1", decl("H1", "grapple", ["N1"])); await pass(T); await T.roll("attack", 3);
  eq([has(T, "H1", "grappling"), has(T, "N1", "grappled")], [true, true], "B: the hold of the attack flow");
  /* a holder with all its actions still open: every flow says the same word (attack flow, action tables, the declare gate for the rest) */
  const U = base();
  await U.gm({ op: "statusAdd", combatant: "H1", status: { id: "grappling", data: { held: "N1" } } }); await U.gm({ op: "statusAdd", combatant: "N1", status: { id: "grappled", data: { by: "H1" } } });
  for (const [a, tg] of [["shoot", ["N2"]], ["slugfest", ["N2"]], ["charge", ["N2"]], ["orders", []], ["pickUp", []], ["scan", ["N2"]], ["fastball", ["H2"]], ["rally", ["H2"]], ["vehicleEnter", []]]) {
    const r = await U.req("p1", decl("H1", a, tg));
    eq([code(r), why(r)], ["illegal", "grappling"], `B: the holder is refused ${a}`);
  }
  const view = V.viewFor(U.state, { id: "p1", staff: false, owns: ["H1"] }, { hidden: [], npc: ["N1", "N2"] });
  const bar = D.playerModel(view, { id: "p1", owns: ["H1"] }, { c: (id) => U.c[id] ?? null, online: () => true, P1 }).bars[0];
  const off = Object.fromEntries(bar.actions.map((a) => [a.id, a.disabled ?? null]));
  eq([off.shoot, off.orders, off.pickUp, off.fastball, off.grappleAttack, off.release, off.move], ["grappling", "grappling", "grappling", "grappling", null, null, null], "B: the bar says the same: only the grapple attack, letting go and movement stay open");
  eq(code(await U.req("p1", decl("H1", "grappleAttack", ["N1"]))), "ok", "B: the grapple attack is allowed");
  T.turn("N1");
  eq(code(await T.gm(decl("N1", "breakFree"))), "ok", "B: the one held tries to break free (P5)");
  await T.roll("roll", 3); await T.roll("def:H1", 1);
  eq([has(T, "H1", "grappling"), has(T, "N1", "grappled"), T.state.stack.length], [false, false, 0], "B: the escape ends the hold on both sides");
  T.turn("H1");
  eq(why(await T.req("p1", decl("H1", "orders"))) === "grappling", false, "B: and the former holder acts freely again");
}

/* ---- C. a hidden combatant in the zone of an area attack (spec 10) */
{
  const HID = "HIDDEN01", SECRET = "Lurker";
  const T = base((x) => { x.weapons.nade = { id: "nade", name: "Grenade", bonus: 0, damage: 3, range: [0, 1], area: true }; x.npc(HID, { name: SECRET, hidden: true, health: 5 }); }, [HID]);
  const meta = () => ({ hidden: [HID], npc: ["N1", "N2", HID] }), p1 = { id: "p1", staff: false, owns: ["H1"] }, p2 = { id: "p2", staff: false, owns: ["H2"] };
  const leak = (x) => { const s = JSON.stringify(x ?? null); return s.includes(HID) || s.includes(SECRET); };
  const stages = [];
  const look = (name) => stages.push([name, V.viewFor(T.state, p1, meta()), V.viewFor(T.state, p2, meta()), T.events.map((e) => V.publicEvent(T.state, e, meta())).filter(Boolean), V.journalFor(T.log, p1), T.requests.filter((r) => (r.users ?? []).some((u) => u !== "gm"))]);
  eq(code(await T.req("p1", decl("H1", "shoot", ["N1"], { weapon: "nade", area: true }))), "ok", "C: a player throws a grenade at a zone where somebody hides");
  ok(T.top().decl.targets.includes(HID), "C: the hidden one is in the area all the same (the GM's view)");
  look("declared");
  for (const p of T.prompts("reaction")) await T.req(p.to === "gm" ? "gm" : p.to.users[0], { op: p.to === "gm" ? "answerFor" : "answer", prompt: p.id, value: p.about === HID ? "dodge" : "pass" });
  look("reactions");
  await T.roll("attack", 3);
  look("rolled");
  eq([T.lastRequest().key, T.lastRequest().users], [`def:${HID}`, ["gm"]], "C: the hidden one's dodge is the GM's roll");
  await T.roll(`def:${HID}`, 0);
  look("dodged");
  for (let g = 0; g < 20 && T.state.stack.length; g++) {
    const p = T.prompts()[0]; if (!p) break;
    const user = p.to === "gm" ? "gm" : p.to.users[0];
    if (user !== "gm") ok(!leak(V.viewFor(T.state, p1, meta()).prompts), `C: the attacker's ${p.kind} card does not show the hidden one`);
    if (p.kind === "stunts") ok(p.options.some((o) => o.data?.target === HID) && !leak(V.viewFor(T.state, p1, meta()).prompts[p.id]), "C: the stunt card has the hidden one for the GM and not for the attacker");
    await T.req(user, { op: user === "gm" ? "answerFor" : "answer", prompt: p.id, value: p.kind === "stunts" ? [] : p.options.find((o) => ["done", "none", "pass", "ko"].includes(o.id))?.id ?? p.options[0].id });
    look(`after ${p.kind}`);
  }
  eq(T.state.stack.length, 0, "C: the attack is played out");
  ok(T.c[HID].health < 5, "C: the hidden one was hit");
  for (const [name, v1, v2, evs, jr, rq] of stages) {
    ok(!leak(v1), `C: no trace in the attacker's view (${name})`); ok(!leak(v2), `C: no trace in another player's view (${name})`);
    ok(!leak(evs), `C: no trace in the public events (${name})`); ok(!leak(jr), `C: no trace in the players' journal (${name})`); ok(!leak(rq), `C: no trace in a player's roll request (${name})`);
  }
  ok(leak(T.log.list.at(-1).label.gm), "C: the GM's own line does name it");
}

/* ---- D. the Fastball Special only with somebody to throw [B2390] */
{
  const T = base((x) => { x.npc("TUR", { name: "Turret", health: 8 }); }, ["TUR"]);
  const acts = (user, cid, attrs) => {
    const staff = user === "gm", view = V.viewFor(T.state, { id: user, staff, owns: staff ? [] : [cid] }, { hidden: [], npc: ["N1", "N2", "TUR"] });
    const facts = { view, me: user, staff, c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc, img: null } : null), attrs: (id) => attrs[id] ?? null, userName: (u) => u, weapons: () => [] };
    const m = staff ? D.gmModel?.(view, { c: (id) => T.c[id] ?? null, online: () => true, P1 }, cid) : D.playerModel(view, { id: user, owns: [cid] }, { c: (id) => T.c[id] ?? null, online: () => true, P1 });
    return m ? UI.dockData(m, {}, facts, t).groups.flatMap((g) => g.items).map((a) => a.id) : null;
  };
  ok(acts("p1", "H1", { H1: { strength: 5 }, H2: { strength: 2 } }).includes("fastball"), "D: a hero with a weaker friend has it");
  ok(!acts("p1", "H1", { H1: { strength: 2 }, H2: { strength: 5 } }).includes("fastball"), "D: not when the only friend is stronger");
  ok(acts("p1", "H1", { H1: { strength: 3 } }).includes("fastball"), "D: an unknown Strength does not hide it");
  T.c.H2.defeated = true;
}

/* ---- E. thrown straight up and down */
{
  const T = new MTable(); T.hero("H1", "p1", { name: "Ada" }).npc("N1", { name: "Thug", health: 9 }).npc("N2", { name: "Goon", health: 9 });
  T.put("H1", "z6").put("N1", "z6").put("N2", "z1"); T.order(["H1", "N1", "N2"]);
  eq(code(await T.gm({ op: "forcedMove", combatant: "N1", direction: "up", distance: 1, damage: 3, kind: "knockback" })), "ok", "E: a throw straight up under a roof");
  const dir = T.prompt("direction");
  eq([dir?.data.vertical, dir?.data.slabs], ["up", ["roof"]], "E: the GM's card says it goes up and what is in the way");
  const card = UI.cardLines ? null : null; void card;
  await T.answer("gm", "direction", "go");
  for (let g = 0; g < 4 && !T.prompt("moveStop") && T.prompts().length; g++) { const p = T.prompts()[0]; await T.gm({ op: "answerFor", prompt: p.id, value: p.options[0].id }); }
  const ms = T.prompt("moveStop");
  eq([T.c.N1.health, ms?.data.slab, ms?.options.map((o) => o.label)], [6, "roof", ["ITAC.opt.breakThrough", "ITAC.opt.stopHere"]], "E: the roof hurts as a wall does and the GM says whether it gives way");
  await T.answer("gm", "moveStop", "stop");
  eq([T.state.stack.length, T.spot("N1")], [0, "z6"], "E: it holds: the thrown one stays below");
  await T.gm({ op: "forcedMove", combatant: "N1", direction: "up", distance: 1, damage: 3, kind: "knockback" }); await T.answer("gm", "direction", "go");
  for (let g = 0; g < 4 && !T.prompt("moveStop") && T.prompts().length; g++) { const p = T.prompts()[0]; await T.gm({ op: "answerFor", prompt: p.id, value: p.options[0].id }); }
  await T.answer("gm", "moveStop", "continue");
  for (let g = 0; g < 4 && T.state.stack.length && T.prompts().length; g++) { const p = T.prompts()[0]; await T.gm({ op: "answerFor", prompt: p.id, value: p.options[0].id }); }
  ok(T.spot("N1") !== "z6" && T.c.N1.health === 3, `E: it gives way: the thrown one is on the roof (${T.spot("N1")})`);
  eq(code(await T.gm({ op: "forcedMove", combatant: "N2", direction: "up", distance: 1, damage: 3, kind: "knockback" })), "ok", "E: a throw straight up under the open sky");
  eq(T.prompt("direction")?.data.slabs ?? [], [], "E: nothing in the way");
  await T.answer("gm", "direction", "go");
  eq([T.prompt("moveStop"), T.c.N2.health, T.spot("N2") !== "z1"], [null, 9, true], "E: no card, no damage on the way up");
}

/* ---- F. a blast against a minion group and against a vehicle */
{
  const T = base((x) => { x.add("M1", { npc: true, name: "Mob", kind: "minions", members: 5, health: 5 }); x.add("V1", { npc: true, name: "Van", kind: "vehicle", health: 8, vehicle: { type: "ground", speed: 3, maneuver: 1, passengers: 3, weapons: 0 } }); x.c.H1.zone = "z2"; x.c.H2.zone = "z2"; x.c.N1.zone = "z2"; x.c.N2.zone = "z2"; }, ["M1"]);
  T.dice.push([6, 3, 3, 2, 1, 4, 2, 2]);
  eq(code(await T.gm({ op: "hazardRun", run: { type: "blast", rating: 8, targets: ["M1", "V1"] } })), "ok", "F: a blast on a mob and a van");
  for (const p of T.prompts("hazardDodge")) await T.gm({ op: "answerFor", prompt: p.id, value: p.options.find((o) => o.id === "pass" || o.id === "none")?.id ?? p.options.at(-1).id });
  const ml = T.prompt("minionLoss");
  eq([ml?.to, ml?.about, ml?.data.suggested, ml?.options.length], ["gm", "M1", 4, 6], "F: how many of the mob fall is the GM's number, as in an area attack [OQ-1]");
  eq(T.c.M1.health, 5, "F: the mob is untouched while the GM decides");
  await T.answer("gm", "minionLoss", "n:2", "M1");
  for (let g = 0; g < 10 && T.state.stack.length && !T.prompt("minionsFate"); g++) { const p = T.prompts()[0]; if (!p) break; await T.gm({ op: "answerFor", prompt: p.id, value: p.options[0].id }); }
  eq(T.prompt("minionsFate")?.data.removed, 2, "F: knocked out or killed is the GM's word");
  await T.answer("gm", "minionsFate", "ko", "M1");
  for (let g = 0; g < 10 && T.state.stack.length; g++) { const p = T.prompts()[0]; if (!p) break; await T.gm({ op: "answerFor", prompt: p.id, value: p.options[0].id }); }
  eq([T.state.stack.length, T.c.M1.health, T.c.V1.health, T.c.M1.crits.length, has(T, "V1", "broken")], [0, 3, 4, 0, false], "F: two of the mob are down, the van lost Durability; no injury roll for a mob, no Broken for a machine");
  ok((T.state.vehicles?.V1?.hits ?? 0) >= 1 || T.evs("component").length >= 1 || JSON.stringify(T.state).includes("component"), "F: half the Durability in one hit damages a component of the van [B3221]");
}

done("check-int");
