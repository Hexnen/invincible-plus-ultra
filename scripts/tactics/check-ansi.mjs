// node scripts/tactics/check-ansi.mjs -- ANSI: four pieces of earlier packages made to read well on screen.
//   ANSI-1 (ANSG FXT-10) the GM's surprise card: one short line, one thin tick row per defender (name, the roll as marks)
//   ANSI-2 (ANSG FXT-9)  Tactical Support on the stunt card: one row per ally under its own caption (not one row per six per ally)
//   ANSI-3 (ANSH X6)     the initiative bar's peek stays inside the window and puts the name tooltip away while it shows
//   ANSI-4 (FXA2 U198)   a mark in the news line takes the line's own letters and baseline
// The rule itself is the engine's and unchanged [B2168], [B2279]: these checks pin how the cards are built and drawn.
import { readFileSync } from "node:fs";
import { ok, eqc as eq, done, Table, seeded } from "./testkit.mjs";
import * as K from "./kit-pure.mjs";
import * as O from "./ops-pure.mjs";
import { EN, PL, t as say } from "./lang.mjs";
import * as UI from "./ui/model-pure.mjs";
import * as Desk from "./desk-pure.mjs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const decl = (actor, action, extra = {}) => ({ op: "declare", actor, decl: { action, ...extra } });
const item = (id, name, type) => ({ id, name, type, level: null, power: null, boosts: [], autos: [], fx: [], flags: { kit: null, off: false, types: [], alt: false }, wf: {} });
const t = (k, prm, fb) => say(k, prm, fb);
class FT extends Table {
  give(cid, items) { const c = this.c[cid]; c.src = items; c.kit = K.build({ items, attrs: c.attrs }); c.pass = c.kit.pass; c.bonus = {}; return this; }
  facts() {
    const f = super.facts(), T = this;
    return { ...f, canTalk: () => true, weapon: (cid, ref) => (ref == null || ref === "unarmed" ? { ...f.weapon(cid, ref), ...(T.c[cid]?.kit?.unarmed ?? {}) } : T.c[cid]?.kit?.weapons.find((w) => w.id === ref) ?? f.weapon(cid, ref)) };
  }
}
async function passAll(T) { for (let i = 0; i < 6; i++) { const p = T.prompts("reaction").find((x) => !x.answered); if (!p) return; await T.gm({ op: "answerFor", prompt: p.id, value: "pass" }); } }
const names = { H1: "Omni-Man", H2: "Mauler A", H3: "Rex", N1: "Thug", N2: "Rat" };
const facts = { c: (id) => (names[id] ? { name: names[id] } : null) };
const card = (p) => ({ ...p, answerReq: (value) => ({ op: "answerFor", prompt: p.id, value }) });

/* ================================================================== ANSI-2: Tactical Support, one row per ally */
{
  const T = new FT();
  T.hero("H1", "p1", { zone: "z1" }).hero("H2", "p2", { zone: "z1" }).hero("H3", "p3", { zone: "z1" }).npc("N1", { health: 6, zone: "z1" }).npc("N2", { health: 6, zone: "z2" });
  T.give("H1", [item("ts", "Tactical Support", "talent")]).give("H2", []).give("H3", []).give("N1", []).give("N2", []);
  T.order(["H1", "N1", "H2", "H3", "N2"]).turn("H1");
  await T.req("p1", decl("H1", "slugfest", { targets: ["N1"] })); await passAll(T); await T.roll("attack", 9);
  const p = T.prompt("stunts");
  const engine = (p?.options ?? []).filter((o) => o.data?.stunt === "support");
  eq([engine.length, [...new Set(engine.map((o) => o.data.target))].sort()], [16, ["H2", "H3"]], "ANSI-2: the engine still offers every surplus six to each ally (8 sixes, two allies) [B2168]");
  const ad = (picks) => UI.askData(card(p), { t, facts, own: picks ? { picks: { [p.id]: picks } } : {}, desk: false });
  const a0 = ad(null), rows = a0.options.filter((o) => o.icon === "stunt:support");
  eq(rows.map((o) => [o.id, o.label, o.group?.id, o.group?.label]), [["support@H2", "Mauler A", "support", EN["ITAC.ui.stunt.g.support"]], ["support@H3", "Rex", "support", EN["ITAC.ui.stunt.g.support"]]], "ANSI-2: one row per ally, named by the ally, under the caption Support (not under 'Your own')");
  eq(a0.options.filter((o) => /\|/.test(o.id)).length, 0, "ANSI-2: no row per six");
  const last = a0.options.map((o) => o.group?.id ?? ""), firstSup = last.indexOf("support");
  ok(firstSup > 0 && last.slice(firstSup).every((g) => g === "support"), "ANSI-2: the support rows stand last, after the stunts on the target");
  eq([rows[0].step.add, rows[0].step.sub, rows[0].marks, rows[0].picked, rows[0].disabled], ["support@H2|1", null, [], false, null], "ANSI-2: nothing given yet: a click gives the first six, no minus");
  const a2 = ad(["support@H2|1", "support@H2|2"]), r2 = a2.options.find((o) => o.id === "support@H2");
  eq([r2.step.add, r2.step.sub, r2.marks, r2.picked, r2.tip.lines[0]], ["support@H2|3", "support@H2|2", [{ mark: "dice", n: "+4" }], true, say("ITAC.ui.support.now", { n: 2, dice: 4, name: "Mauler A" })], "ANSI-2: two sixes given: +4 dice at the row's end, the next click gives the third, the minus takes the second back");
  eq(a2.submit.req.value, ["support@H2|1", "support@H2|2"], "ANSI-2: what is sent is the engine's own ids (the k-th six of that ally)");
  eq(a2.submit.label, say("ITAC.ui.confirm", { n: 2, max: p.max }), "ANSI-2: Confirm counts the sixes spent");
  const all8 = Array.from({ length: 8 }, (_, i) => `support@H2|${i + 1}`), a8 = ad(all8), r8 = a8.options.find((o) => o.id === "support@H2"), r8b = a8.options.find((o) => o.id === "support@H3");
  eq([r8.step.add, r8.step.clear.length, r8.disabled], [null, 8, null], "ANSI-2: every six given: a click on the row takes them all back");
  eq([r8b.step.add, !!r8b.disabled, r8b.disabled], [null, true, say("ITAC.ui.support.none")], "ANSI-2: the other ally, with no six left, is greyed with the reason");
  const ok8 = await T.gm({ op: "answerFor", prompt: p.id, value: ["support@H2|1", "support@H2|2", "support@H3|1"] });
  eq(ok8?.ok, true, "ANSI-2: the engine takes the picks the rows send (two allies)");
  for (const k of ["ITAC.ui.stunt.g.support", "ITAC.ui.support.none", "ITAC.ui.support.now", "ITAC.ui.support.add", "ITAC.ui.support.clear", "ITAC.ui.support.less"]) ok(typeof EN[k] === "string" && typeof PL[k] === "string", `ANSI-2: ${k} in both languages`);
  eq(PL["ITAC.ui.stunt.g.support"], "Wsparcie", "ANSI-2: the caption is the stunt's own word");
}
/* ================================================================== ANSI-1: the surprise card */
{
  const GM = { user: "gm", staff: true, owns: () => true, hold: true };
  const parts = [{ id: "H1", hero: true, owners: ["p1"], intuition: 3 }, { id: "N1", hero: false, owners: [], intuition: 6 }, { id: "N2", hero: false, owners: [], intuition: 2 }];
  const r = O.reduce(null, O.normalize({ op: "start", mode: "tactical", restart: true, surprise: "npcs" }, { staff: true }).action, { ...GM, parts, rng: seeded(3) });
  const dc = Desk.deskModel(r.state, null, facts).cards.find((c) => c.kind === "surprise");
  const ad = UI.askData(dc, { t, facts, own: {}, desk: true });
  eq([ad.check, ad.lines.length], [true, 1], "ANSI-1: a tick list under ONE line");
  ok(ad.lines[0].length <= 60 && PL["ITAC.Prompt.surprise.Body"].length <= 60, `ANSI-1: the line is short (${ad.lines[0].length} / ${PL["ITAC.Prompt.surprise.Body"].length} characters)`);
  const raw = dc.options;
  eq(ad.options.map((o) => [o.label, o.marks.map((m) => [m.mark, m.n])]), raw.map((o) => [names[o.id], [["six", o.data.sixes], ["dice", o.data.dice]]]), "ANSI-1: each row is the name, then the roll as marks (sixes, dice)");
  ok(ad.options.every((o, i) => o.tip?.lines?.[1] === say("ITAC.ui.surprise.what") && o.tip.lines[0] === say("ITAC.ui.opt.surprised", { name: o.label, n: raw[i].data.sixes, dice: raw[i].data.dice })), "ANSI-1: the roll in words (the tooltip's first line, so the aria-label too) and what surprise does");
  const css = read("../../styles/tactics-ui.css");
  ok(/\.ita-ask\[data-kind="surprise"\] \.ita-opts \{ flex-direction: column;/.test(css) && /\.ita-ask\[data-kind="surprise"\] \.ita-opt\[data-check\] \{ width: 100%; min-height: 24px;/.test(css), "ANSI-1: the rows are thin and stand in one column");
  const dom = read("./ui/dom.mjs");
  ok(/o\.marks\?\.length \? h\("span\.ita-opt-m"/.test(dom), "ANSI-1: the row draws its marks");
  ok(/o\.step\.sub \? h\("button\.ita-less"/.test(dom) && /const optRow = \(o\) => \(!o\.step \? opt\(o\) : h\("span\.ita-stepper"/.test(dom), "ANSI-2: the minus stands beside the row, not inside it");
}
/* ================================================================== ANSI-3: the peek */
{
  const bar = read("../combat/bar.mjs");
  ok(/const r = g\.getBoundingClientRect\(\), k = r\.height \/ \(h \|\| 1\) \|\| 1, edge = 6;/.test(bar) && /r\.top < edge \? edge - r\.top : r\.bottom > window\.innerHeight - edge/.test(bar), "ANSI-3: the peek is pushed back inside the window");
  ok(/if \(game\.tooltip\?\.element === tile\) game\.tooltip\.deactivate\(\); else game\.tooltip\?\.clearPending\?\.\(\);/.test(bar), "ANSI-3: the tile's name tooltip is put away while the peek (which says the name) shows");
}
/* ================================================================== ANSI-4: the news line */
{
  const css = read("../../styles/tactics-ui.css");
  ok(/#invincible-tactics-dock \.itd-news \.itd-news-t \.ipu-sym > b \{ font: inherit; letter-spacing: inherit; \}/.test(css) && /#invincible-tactics-dock \.itd-news \.itd-news-t \.ipu-sym \{ display: inline; vertical-align: baseline; \}/.test(css), "ANSI-4: the number of a mark in the news is set in the line's own letters, on its baseline");
  ok(css.indexOf("ANSI-4") > css.indexOf("FXA2 (U198): flush with the comma"), "ANSI-4: placed after the shared mark rules");
}
done("check-ansi");
