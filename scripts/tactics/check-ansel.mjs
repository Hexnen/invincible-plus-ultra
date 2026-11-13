/* node scripts/tactics/check-ansel.mjs -- ANSEL: package ANSE driven live on lane 5 (GM and player seats), then what read badly fixed.
     A40     the attacker's own dodge card said "Doc Seismic atakuje: Doc Seismic": it now says it stands in its own area attack, dodge only
     A10     "Pancerz?" asked its question twice (title and line) and named the character twice: the line now gives the cause and the numbers
     PW030   "Przerzucić ranę?" repeated the price the button already shows, and its no-answer read "Pas": now "Bez przerzutu"
     PW030   two dice that give the same injury (seen live: 13 on both) asked the holder to pick between equal answers: no card now
     A17     the wreck switch promised bonus dice; a zone with no terrain set gives none: the tip says the terrain may add dice */
import { Table, ok, eq, done } from "./testkit.mjs";
import { MTable } from "./check-kit-map.mjs";
import * as D from "./desk-pure.mjs";
import * as V from "./view-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as UM from "./ui/model-pure.mjs";
import * as KP from "./kit-pure.mjs";
import { tIn } from "./lang.mjs";

const tr = (l) => (k, p = {}, f) => tIn(l, k, p, f);
const t = tr("pl"), en = tr("en");
const decl = (actor, action, targets, extra = {}) => ({ op: "declare", actor, decl: { action, targets, ...extra } });
const meta = (T) => ({ hidden: Object.values(T.c).filter((c) => c.hidden).map((c) => c.id), npc: Object.values(T.c).filter((c) => c.npc).map((c) => c.id) });
const facts = (T, view, me, staff = false) => ({ view, me, staff, c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc, team: T.c[id].team ?? null, kind: T.c[id].kind, img: null } : null), attrs: (id) => T.c[id]?.attrs ?? null, userName: (u) => `user-${u}`, online: () => true, preview: () => null });
const ctx = (T) => ({ c: (id) => T.c[id] ?? null, online: () => true, P1 });
const desk = (T) => UM.deskData(D.deskModel(T.state, T.log, ctx(T)), {}, facts(T, T.state, "gm", true), t);
const dock = (T, uid, owns) => { const view = V.viewFor(T.state, { id: uid, staff: false, owns }, meta(T)); return UM.dockData(D.playerModel(view, { id: uid, owns }, ctx(T)), {}, facts(T, view, uid), t); };
const passAll = async (T) => { for (const p of T.prompts("reaction")) await T.req(p.to === "gm" ? "gm" : p.to.users[0], { op: p.to === "gm" ? "answerFor" : "answer", prompt: p.id, value: "pass" }); };
const item = (id, name, type = "talent", o = {}) => ({ id, name, type, level: o.level ?? null, power: o.power ?? null, boosts: o.boosts ?? [], autos: [], fx: [], flags: { kit: null, off: false, types: [] }, wf: {} });
const kit = (T, cid, items) => { const c = T.c[cid]; c.kit = KP.build({ items, attrs: c.attrs }); c.pass = c.kit.pass; return T; };
const NADE = { id: "nade", bonus: 0, damage: 3, range: [0, 3], blast: 2, area: true };
const text = (c) => (c?.lines ?? []).map((l) => (typeof l === "string" ? l : l?.quote ?? "")).join(" ");

/* A40: the attacker's own card */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Eve" }).npc("N1", { name: "Doc", health: 6 }); T.weapons.nade = NADE; T.order(["N1", "H1"]);
  await T.gm(decl("N1", "shoot", ["H1"], { weapon: "nade", area: true }));
  const own = desk(T).cards.find((c) => c.kind === "reaction" && c.aboutId === "N1");
  eq([own?.lines?.[0], own?.options.map((o) => o.id)], ["Doc w strefie własnego ataku (Strzał): tylko unik.", ["dodge", "pass"]], "A40: the attacker's own card says why it may only dodge (was: \"Doc atakuje: Doc\")");
  const eve = dock(T, "p1", ["H1"]).prompts?.find((p) => p.kind === "reaction");
  ok(/Doc atakuje: Eve/.test(text(eve)), "A40: the others' cards are unchanged");
  ok(en("ITAC.ui.line.ownArea", { name: "Doc", action: "Shoot" }) === "Doc is inside its own area attack (Shoot): dodge only.", "A40: the line in English");
}

/* A40: nobody is asked to warn the attacker of its own blast (seen live: "Kid Omni-Man atakuje: Kid Omni-Man. Omni-Man może się wtrącić") */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Kid" }).hero("H2", "p2", { name: "Omni" }).npc("N1", { name: "Mauler", health: 6 }); T.weapons.nade = NADE; kit(T, "H2", [item("w", "Warning Call")]); T.order(["H1", "H2", "N1"]);
  await T.req("p1", decl("H1", "shoot", ["N1"], { weapon: "nade", area: true }));
  eq(T.top().decl.targets, ["N1", "H2", "H1"], "A40: (Kid's blast takes Omni and Kid himself too)");
  const W = new Table(); W.hero("H1", "p1", { name: "Kid" }).hero("H2", "p2", { name: "Omni", zone: "z2" }).npc("N1", { name: "Mauler", health: 6 }); W.weapons.nade = NADE; kit(W, "H2", [item("w", "Warning Call")]); W.order(["H1", "H2", "N1"]);
  await W.req("p1", decl("H1", "shoot", ["N1"], { weapon: "nade", area: true }));
  eq([W.top().decl.targets, W.prompts("reaction").filter((p) => p.about === "H2").length], [["N1", "H1"], 0], "A40: Omni in reach is not asked to warn Kid of Kid's own blast");
}

/* A10: "Pancerz?" */
{
  const T = new MTable(); T.hero("H1", "p1").npc("N1", { name: "Cop", health: 6 }); T.put("H1", "z3").put("N1", "z2:elevated"); T.order(["H1", "N1"]);
  T.c.N1.armor = [{ id: "vest", armor: 1 }]; T.dice.push([5]);
  await T.gm({ op: "fall", combatant: "N1" }); await T.roll("agi", 0);
  const c = desk(T).cards.find((x) => x.kind === "hazardArmor");
  eq([c?.title, c?.about, text(c), c?.options.map((o) => o.label)], ["Pancerz?", "Cop", "Upadek: obrażenia 5, Pancerz 1.", ["Z Pancerzem: 4", "Bez Pancerza: 5"]], "A10: the card asks once (title), names the character once (head), the line gives cause and numbers");
  eq([t("ITAC.ui.line.hazardArmor.barrier", { n: 2, armor: 1 }), en("ITAC.ui.line.hazardArmor.fall", { n: 5, armor: 1 })], ["Nieudane przebicie: obrażenia 2, Pancerz 1.", "Fall: damage 5, Armor 1."], "A10: the crash line and the English line");
}

/* PW030: "Przerzucić ranę?" and the pick */
const luck = [item("lu", "Luck Control", "power", { level: "major" })];
const toCrit = async (T) => { await T.gm(decl("N1", "slugfest", ["H1"])); await passAll(T); await T.roll("attack", 1); for (let g = 0; g < 6; g++) { const p = T.prompts().find((x) => x.kind === "stunts"); if (!p) break; await T.gm({ op: "answerFor", prompt: p.id, value: [] }); } };
const table = (crits = []) => { const T = new Table(); T.hero("H1", "p1", { name: "Eve", health: 1, maxHealth: 6 }).hero("H2", "p2", { name: "Fate" }).npc("N1", { name: "Doc", health: 6 }); T.c.H1.crits = crits; kit(T, "H2", luck); T.order(["N1", "H1", "H2"]); return T; };
{
  const T = table(); T.dice.push([2]);
  await toCrit(T);
  const c = dock(T, "p2", ["H2"]).prompts?.find((p) => p.kind === "luckReroll");
  const line = text(c);
  ok(/^Eve: rana \d+ \(.+\), kość 2\. Kontrola szczęścia: przerzuć i zostaw kość, którą wolisz\.$/.test(line), `PW030: the card says the injury and what the power does, once (${line})`);
  ok(!/stres|szybka/.test(line), "PW030: the price is the button's marks, not repeated in the line");
  eq(c?.options.map((o) => [o.id, o.label]), [["reroll", "Przerzuć"], ["pass", "Bez przerzutu"]], "PW030: the answers say what they do (was \"Pas\")");
}
{
  /* both dice at the top of the table: the same injury, nothing to pick */
  const T = table([12, 12, 12]); T.dice.push([6]);
  await toCrit(T);
  const before = T.prompt("luckReroll")?.data?.n;
  T.dice.push([5]); await T.answer("p2", "luckReroll", "reroll");
  eq([before, T.prompt("critPick"), T.prompt("critConfirm")], [13, null, null], "PW030: two dice that give the same injury ask for no pick");
  eq(T.prompt("heroDead")?.about ?? null, "H1", "PW030: the fight goes straight on (here to the GM's card on a killing injury)");
}

/* A17: the wreck switch's tip */
ok(!/dostajesz kości/.test(t("ITAC.ui.arm.wreck.tip")) && /teren może dać kości/.test(t("ITAC.ui.arm.wreck.tip")) && /terrain may add dice/.test(en("ITAC.ui.arm.wreck.tip")), "A17: the wreck switch no longer promises dice (a zone with no terrain set gives none)");

done("ansel");
