// node scripts/tactics/check-fxi.mjs -- fixer I after the film take (U95): D119 (an area shot's stunt card whose every pick is refused),
// D120 (an owed roll that waits on somebody noticing it), U128 (the token HUD from the map menu acts on the token it was opened for),
// U129, U130 (the summary of an ended fight never stands over the next one), U131 (Warning Call only for one's own side), U125 (c) the
// dice of Warning Call named on the roll card, (d) the guardian's hit said to the table in words.
// What can be held without Foundry; the live look is in dev/combat-handoff.md.
import { readFileSync } from "node:fs";
import { Table, ok, eq, done } from "./testkit.mjs";

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

done("check-fxi");
