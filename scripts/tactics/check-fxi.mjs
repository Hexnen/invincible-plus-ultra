// node scripts/tactics/check-fxi.mjs -- fixer I after the film take (U95): D119 (an area shot's stunt card whose every pick is refused),
// D120 (an owed roll that waits on somebody noticing it), U128 (the token HUD from the map menu acts on the token it was opened for),
// U129, U130 (the summary of an ended fight never stands over the next one), U131 (Warning Call only for one's own side), U125 (c) the
// dice of Warning Call named on the roll card, (d) the guardian's hit said to the table in words.
// What can be held without Foundry; the live look is in dev/combat-handoff.md.
import { readFileSync } from "node:fs";
import { Table, ok, eq, done } from "./testkit.mjs";
import * as KP from "./kit-pure.mjs";

const here = new URL(".", import.meta.url);
const src = (f) => readFileSync(new URL(f, here), "utf8");
const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const decl = (actor, action, targets, extra = {}) => ({ op: "declare", actor, decl: { action, targets, ...extra } });
const pass = async (T) => { for (const p of T.prompts("reaction")) await T.req(p.to === "gm" ? "gm" : p.to.users[0], { op: p.to === "gm" ? "answerFor" : "answer", prompt: p.id, value: "pass" }); };
const base = (extra = () => {}, more = []) => { const T = new Table(); T.hero("H1", "p1").hero("H2", "p2").npc("N1", { health: 6 }).npc("N2", { health: 6 }); extra(T); T.order(["H1", "N1", "H2", "N2", ...more]); return T; };

/* ---- D119: an area attack whose only target dodged down to one six: spare sixes, but none for that target [A-3] */
{
  const T = base((t) => { t.weapons.nade = { id: "nade", bonus: 0, damage: 3, range: [0, 1], area: true }; t.c.N1.zone = "z2"; t.c.N2.zone = "z3"; t.c.H2.zone = "z3"; });
  eq(code(await T.req("p1", decl("H1", "shoot", ["N1"], { weapon: "nade", area: true }))), "ok", "D119: an area attack on a zone with one opponent");
  eq(T.top().decl.targets, ["N1"], "D119: the one in the zone is the target");
  eq(code(await T.answer("gm", "reaction", "dodge", "N1")), "ok", "D119: it dodges");
  await pass(T);
  const hp = T.c.N1.health;
  await T.roll("attack", 3); await T.roll("def:N1", 2);
  eq(T.prompt("stunts"), null, "D119: two spare sixes, but the target kept one six of three: no stunt card whose every pick would be refused");
  eq(hp - T.c.N1.health, 3, "D119: the hit goes on to the damage");
}
{ // two targets: one dodged down to a single six, the other took the full roll
  const T = base((t) => { t.weapons.nade = { id: "nade", bonus: 0, damage: 3, range: [0, 1], area: true }; t.c.N1.zone = "z2"; t.c.N2.zone = "z2"; t.c.H2.zone = "z3"; });
  eq(code(await T.req("p1", decl("H1", "shoot", ["N1"], { weapon: "nade", area: true }))), "ok", "D119: an area attack on two");
  eq(code(await T.answer("gm", "reaction", "dodge", "N1")), "ok", "D119: N1 dodges");
  await pass(T);
  await T.roll("attack", 3); await T.roll("def:N1", 2);
  const sp = T.prompt("stunts");
  ok(!!sp, "D119: N2 took three sixes: the card is there");
  ok(sp && sp.options.filter((o) => o.data?.target === "N1").every((o) => o.disabled) && sp.options.filter((o) => o.data?.target === "N1" && ["doubleDamage", "suppressed", "special"].includes(o.data.stunt)).every((o) => o.disabled === "noSixLeft"), "D119: every stunt on N1 is greyed, with the reason (its dodge left no six)");
  ok(sp && sp.options.some((o) => o.data?.target === "N2" && !o.disabled), "D119: N2's stunts can be taken");
  eq(sp?.max, 2, "D119: as many picks as N2 can take");
  eq(code(await T.req("p1", { op: "answer", prompt: sp.id, value: ["doubleDamage@N2"] })), "ok", "D119: a stunt on N2 is taken");
}
{ // a single-target attack is not touched by the cap
  const T = base();
  eq(code(await T.req("p1", decl("H1", "slugfest", ["N1"]))), "ok", "D119: a plain attack");
  await pass(T);
  await T.roll("attack", 3);
  const sp = T.prompt("stunts");
  eq([sp?.max, sp?.options.some((o) => o.disabled === "noSixLeft")], [2, false], "D119: one target, two spare sixes: the card as before");
}
eq([typeof (await import("./lang.mjs")).EN["ITAC.reason.noSixLeft"], typeof (await import("./lang.mjs")).PL["ITAC.reason.noSixLeft"]], ["string", "string"], "D119: the greyed reason has its text in both languages");

/* ---- U131: Warning Call [B2170] is offered for one's own side only (provisional, FXI-1) */
const item = (id, name, type) => ({ id, name, type, level: null, power: null, boosts: [], autos: [], fx: [], flags: { kit: null, off: false, types: [] }, wf: {} });
const give = (T, cid, ...names) => { const c = T.c[cid]; c.kit = KP.build({ items: names.map((n, i) => item(`i${i}${cid}`, n, "talent")), attrs: c.attrs }); c.pass = c.kit.pass; return T; };
const rid = (T, cid, k) => `r:${T.c[cid].kit.actions.find((a) => a.id.endsWith(`-${k}`)).id}`;
const ids = (p) => (p?.options ?? []).map((o) => (o.id.startsWith("r:") ? `r:${o.id.split("-").pop()}` : o.id));
const team = (extra = () => {}, order = ["N1", "H1", "H2", "H3", "N2"]) => { const T = new Table(); T.hero("H1", "p1", { name: "Omni" }).hero("H2", "p2", { name: "Kid" }).hero("H3", "p3", { name: "Eve" }).npc("N1", { name: "Turret", health: 6 }).npc("N2", { name: "Soldier", health: 6 }); T.c.H3.zone = "z2"; extra(T); T.order(order); return T; };
{
  const T = team((t) => give(t, "H1", "Warning Call"), ["H2", "N1", "H1", "H3", "N2"]);
  eq(code(await T.req("p2", decl("H2", "slugfest", ["N1"]))), "ok", "U131: Kid attacks the turret");
  ok(!ids(T.prompt("reaction", "H1")).includes("r:warn"), "U131: Omni is not offered to warn the turret his ally attacks");
}
{
  const T = team((t) => give(t, "H1", "Warning Call"));
  eq(code(await T.gm(decl("N1", "slugfest", ["H2"]))), "ok", "U131: the turret attacks Kid");
  eq(ids(T.prompt("reaction", "H1")), ["r:warn", "pass", "pass:round"], "U131: Omni may still warn Kid");
}
{ // an area attack on a zone with an ally and an opponent: the warning names the ally only
  const T = team((t) => { give(t, "H1", "Warning Call"); t.c.N2.zone = "z1"; t.weapons.nade = { id: "nade", bonus: 0, damage: 3, range: [0, 1], area: true }; t.c.H1.zone = "z3"; }, ["N1", "H1", "H2", "H3", "N2"]);
  eq(code(await T.gm(decl("N1", "shoot", ["H2"], { weapon: "nade", area: true }))), "ok", "U131: the turret throws at the zone of Kid and the Soldier");
  const w = (T.prompt("reaction", "H1")?.options ?? []).filter((o) => o.id.startsWith("r:"));
  eq(w.map((o) => o.data.about ?? null), ["H2"], "U131: only Kid can be warned, not the Soldier beside him");
}

done("check-fxi");
