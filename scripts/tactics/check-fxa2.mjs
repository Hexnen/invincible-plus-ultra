/* node scripts/tactics/check-fxa2.mjs -- fixer FXA2 (2026-11-12): the VER13 rows (dev/combat-defects.md, dev/combat-usability.md), each
   pinned through the REAL engine, director, view and render data (testkit Table), the stylesheet and the sources:
     D193  the spent-NPC line on the GM seat (overtaken by ANSA: pinned here on the GM seat)
     D194  Mass Healing takes its 1-4 targets in the dock, with the stress of each beyond the first [B1934]
     D195  a bar tile's tooltip escapes the name (S087 on the initiative bar)
     D196  the dock's "Change" of an own open action (an exception request waiting) is not blocked as "another action"
     U197  the GM desk keeps room for a whole card: the band gives way everywhere; the strip that repeats the Now cards is left out
     U198  the news says "dead" after an injury that kills; the news line sets its commas without the comic face's kerning
     U199  the undo bar of a removed row holds to the top of the scrolled tab body */
import { readFileSync } from "node:fs";
import { Table, ok, eq, done } from "./testkit.mjs";
import * as V from "./view-pure.mjs";
import * as D from "./desk-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./ui/model-pure.mjs";
import * as SP from "./ui/slots-pure.mjs";
import * as K from "./kit-pure.mjs";
import { tIn, EN, PL } from "./lang.mjs";

const here = new URL(".", import.meta.url);
const src = (p) => readFileSync(new URL(p, here), "utf8");
const tr = (l) => (k, p = {}, f) => tIn(l, k, p, f);
const t = tr("pl");
const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const decl = (actor, action, targets, extra = {}) => ({ op: "declare", actor, decl: { action, targets, ...extra } });
const meta = (T) => ({ hidden: Object.keys(T.c).filter((id) => T.c[id].hidden), npc: Object.keys(T.c).filter((id) => T.c[id].npc) });
const pv = (T, u, owns) => V.viewFor(T.state, { id: u, staff: false, owns }, meta(T));
const facts = (T, view, me, staff = false) => ({ view, me, staff, c: (id) => (T.c[id] ? { name: T.c[id].name ?? id, npc: T.c[id].npc, img: null } : null), attrs: (id) => T.c[id]?.attrs ?? null, userName: (u) => `user-${u}`, preview: () => null });
const ctx = (T) => ({ c: (id) => T.c[id] ?? null, online: () => true, P1, kit: (id) => T.c[id]?.kit ?? null });
const dock = (T, u, owns, own = {}, more = {}) => { const v = pv(T, u, owns); return M.dockData(D.playerModel(v, { id: u, owns }, ctx(T)), own, { ...facts(T, v, u), ...more }, t); };
const gmDock = (T, cid, own = {}, more = {}) => { const d = D.deskModel(T.state, T.log, ctx(T)); const bar = D.barModel(T.state, cid, { ...ctx(T), staff: true }); return M.dockData({ bars: [bar], prompts: [], mine: [], stack: d.info, waiting: d.waiting, turn: d.turn }, own, { ...facts(T, T.state, "gm", true), ...more }, t); };
const desk = (T, own = {}) => M.deskData(D.deskModel(T.state, T.log, ctx(T)), own, facts(T, T.state, "gm", true), t);

/* the kit table of check-fxt.mjs: characters carry kits, a small map of four zones */
const item = (id, name, type, o = {}) => ({ id, name, type, level: o.level ?? null, power: o.power ?? null, boosts: o.boosts ?? [], autos: o.autos ?? [], fx: o.fx ?? [], flags: { kit: null, off: false, types: [], ...(o.flags ?? {}) }, wf: o.wf ?? {} });
class FT extends Table {
  constructor(o) { super(o); this.map = { zones: { z1: {}, z2: {}, z3: {}, z4: {} }, borders: [{ id: "z1|z2", a: "z1", b: "z2", wall: null, door: null }], registry: {} }; }
  give(cid, items) { const c = this.c[cid]; c.src = items; c.kit = K.build({ items, attrs: c.attrs }); c.pass = c.kit.pass; c.bonus = {}; return this; }
  facts() {
    const f = super.facts(), T = this;
    const place = (cid) => (T.c[cid] ? { zone: T.c[cid].zone, level: "ground", spot: T.c[cid].zone, area: null } : null);
    return { ...f, canTalk: () => true, weapon: (cid, ref) => (ref == null || ref === "unarmed" ? { ...f.weapon(cid, ref), ...(T.c[cid]?.kit?.unarmed ?? {}) } : T.c[cid]?.kit?.weapons.find((w) => w.id === ref) ?? f.weapon(cid, ref)),
      zones: { place, reach: () => [], zone: (key) => (T.map.zones[key] ? { key, tags: [] } : null), states: () => [], graph: () => ({ zones: Object.keys(T.map.zones).map((id) => ({ id, flammable: false, tags: [] })), borders: T.map.borders }) } };
  }
}
const kact = (T, cid, k) => T.c[cid].kit.actions.find((a) => a.id.endsWith(`-${k}`));

/* ================================================================== D193 (overtaken by ANSA 6709460): the GM's spent NPC */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Kid" }).hero("H2", "p2", { name: "Omni" }).npc("N1", { name: "Doc", health: 12 }); T.order(["H1", "H2", "N1"]);
  for (const [h, u] of [["H1", "p1"], ["H2", "p2"]]) {
    T.turn(h); await T.req(u, decl(h, "slugfest", ["N1"]));
    const p = T.prompt("reaction", "N1"); await T.gm({ op: "answerFor", prompt: p.id, value: "block" });
    await T.roll("attack", 0); if (T.top()?.rolls?.["def:N1"]) await T.roll("def:N1", 0);
  }
  T.turn("N1");
  const b = P1.budget(T.state, "N1");
  eq([b.full, b.quick], ["lost", ["used", "used"]], "D193: two blocks took the NPC's round before its turn (the VER13 scene)");
  const off = gmDock(T, "N1"), on = gmDock(T, "N1", {}, { autoSkip: true });
  eq([off.out?.reason, off.out?.text, off.end.auto, off.end.confirm], ["spent", PL["ITAC.ui.out.spentAsk"], false, true], "D193: GM seat, tick off: the line says 'end the turn' (the turn waits for End turn), not 'passes by itself'");
  eq([on.out?.text, on.end.auto], [PL["ITAC.ui.out.spent"], true], "D193: GM seat, tick on: 'passes by itself' only where it really does");
  ok(!/sama|by itself/.test(PL["ITAC.ui.out.spentAsk"] + EN["ITAC.ui.out.spentAsk"]), "D193: the waiting line never promises that the turn passes by itself");
}

/* ================================================================== D194 [B1934]: Mass Healing in the dock */
{
  const T = new FT(); T.hero("H1", "p1", { zone: "z1" }).hero("H2", "p2", { zone: "z1", health: 2, maxHealth: 6 }).hero("H3", "p3", { zone: "z1", health: 1, maxHealth: 6 }).npc("N1", { health: 6, zone: "z2" });
  T.give("H1", [item("he", "Healing", "power", { boosts: ["mh"] }), item("mh", "Mass Healing", "boost", { power: "he" })]).give("H2", []).give("H3", []).give("N1", []);
  T.order(["H1", "N1", "H2", "H3"]).turn("H1");
  await T.gm({ op: "roster" });
  const a = kact(T, "H1", "massHeal");
  ok(!!a, "D194: the kit has the Mass Healing action");
  const bar = dock(T, "p1", ["H1"]);
  ok(!!bar.show, "D194: the dock stands for Kid's player");
  const one = dock(T, "p1", ["H1"], { armed: a.id, targets: ["H2"] }).panel;
  eq([one.kind, one.maxTargets, one.targets.filter((x) => x.picked).map((x) => x.id), one.stress], ["declare", 12, ["H2"], 0], "D194: the panel takes as many allies as the entry allows (1-12 since PWE, PW080); one picked costs no stress");      // merge with PWE: the entry's bound went from 4 to 12
  const two = dock(T, "p1", ["H1"], { armed: a.id, targets: ["H2", "H3"] }).panel;
  eq([two.targets.filter((x) => x.picked).map((x) => x.id), two.stress, two.submit.req?.decl?.targets], [["H2", "H3"], 1, ["H2", "H3"]], "D194: a second ally is ADDED, not swapped; the price shows 1 stress for it; Declare sends both");
  ok(/1/.test(two.cost) && two.cost !== one.cost, `D194: the price in words names the stress of the further target (${two.cost})`);
  const five = dock(T, "p1", ["H1"], { armed: a.id, targets: ["H2", "H3", "N1"] }).panel;
  ok(five.targets.filter((x) => x.picked).length <= 4, "D194: never more than the entry allows");
  const sl = dock(T, "p1", ["H1"], { armed: "slugfest", targets: ["H2", "H3"] }).panel;
  eq(sl.maxTargets, 1, "D194: a one-target action keeps one (a second pick replaces the first)");
  eq(code(await T.req("p1", two.submit.req)), "ok", "D194: the declaration the dock builds is accepted");
  await T.roll("roll", 1);
  eq([T.c.H2.health, T.c.H3.health, T.c.H1.resolve < 5], [5, 4, true], "D194: one roll heals both; the second target's stress is paid");
  const ds = src("./ui/dock.mjs"), ms = src("./ui/main.mjs");
  ok(/toggle\("targets", x\.id, p\.maxTargets \?\? 1\)/.test(ds) && /data\.panel\.maxTargets \?\? 1/.test(ms), "D194: the chips and the map pick both obey the panel's maxTargets");
}

/* ================================================================== D195: the bar tile's tooltip */
{
  const bs = src("../combat/bar.mjs");
  ok(/tile\.dataset\.tooltip = esc\(it\.name\)/.test(bs) && !/tile\.dataset\.tooltip = it\.name;/.test(bs), "D195 (S087): the tile's tooltip is the ESCAPED name (Foundry reads data-tooltip as HTML)");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  eq(esc("Doc <b>X</b> & Co"), "Doc &lt;b&gt;X&lt;/b&gt; &amp; Co", "D195: a name with markup reads as written");
  ok(/const esc = \(s\) => String\(s \?\? ""\)\.replace\(\/\[&<>"'\]\/g/.test(bs), "D195: bar.mjs has the escape it calls");
}

/* ================================================================== D196: amend from the dock while the exception request waits */
{
  const T = new FT(); T.hero("H1", "p1", { zone: "z1" }).npc("N1", { health: 9, zone: "z1", name: "Omni" }).npc("N2", { health: 9, zone: "z4", name: "Doc" });
  T.give("H1", []).give("N1", []).give("N2", []); T.order(["H1", "N1", "N2"]).turn("H1");
  await T.gm({ op: "roster" });
  eq(code(await T.req("p1", decl("H1", "slugfest", ["N2"]))), "illegal", "D196: Slugfest on Doc in another zone is refused (the VER13 scene)");
  eq(code(await T.req("p1", decl("H1", "slugfest", ["N2"], { exception: { text: "please" } }))), "ok", "D196: declared with a request for an exception");
  const inst = T.top()?.id;
  ok(!!inst && T.prompts().some((p) => p.kind === "exception"), "D196: the request waits on the GM's card");
  const base = dock(T, "p1", ["H1"]);
  ok(base.panel?.kind === "mine" && base.panel.commands.some((c) => c.id === "amend"), "D196: the own action offers Change");
  const busy = dock(T, "p1", ["H1"], { armed: "slugfest", targets: ["N1"] }).panel;
  ok(!!busy.refused || !!busy.submit?.disabled, "D196 (control): a NEW Slugfest is still refused while one is open");
  const am = dock(T, "p1", ["H1"], { armed: "slugfest", amend: inst, targets: ["N1"] }).panel;
  eq([am.kind, am.refused, am.submit.disabled, am.submit.label, am.submit.req?.op, am.submit.req?.inst, am.submit.req?.decl?.targets], ["declare", null, null, PL["ITAC.ui.amend"], "amend", inst, ["N1"]], "D196: Change -> Omni in the same zone: the panel sends the amend, nothing about 'another action'");
  const other = dock(T, "p1", ["H1"], { armed: "grapple", amend: inst, targets: ["N1"] }).panel;
  ok(!!other.refused || !!other.submit?.disabled, "D196: only the amended action itself is lifted, not any other the bar refuses");
  eq(code(await T.req("p1", am.submit.req)), "ok", "D196: the engine accepts it");
  ok(!T.prompts().some((p) => p.kind === "exception") && (T.top()?.decl?.targets ?? []).includes("N1"), "D196: the GM's exception card is gone (T042), the action is at Omni");
}

/* ================================================================== U197: the GM desk keeps room for a card */
{
  const fr = (W, H, chatTop, listEnd = null) => SP.frame({ W, H, k: 1, staff: true, hints: false, top0: 90, topCx: W / 2, topL: 12, side: W - 48, chatTop, listEnd, hud: { present: true, x0: W - 400 }, desk: { open: true, x0: W - 404 }, bar: { lo: 400, hi: W - 420, top: H - 104, bottom: H - 10 } });
  for (const [W, H, chat, list] of [[1366, 768, 700, null], [1600, 900, 828, 740], [1920, 1080, 1010, null]]) {
    const f = fr(W, H, chat, list), room = f.desk.floor - f.desk.top;
    ok(room >= SP.SIZE.desk - 1 && f.band.y1 >= 11 + SP.BAND.min, `U197 ${W}x${H}${list ? " (toast list high)" : ""}: the desk keeps ${room} px >= ${SP.SIZE.desk}; the band ends at ${f.band.y1}`);
    const fold = SP.frame({ ...{ W, H, k: 1, staff: true, hints: false, top0: 90, topCx: W / 2, topL: 12, side: W - 48, chatTop: chat, listEnd: list, hud: { present: true, x0: W - 400 }, desk: { open: false, x0: W - 404 }, bar: { lo: 400, hi: W - 420, top: H - 104, bottom: H - 10 } } });
    eq([fold.desk.top, fold.band.y1], [f.desk.top, f.band.y1], `U197 ${W}x${H}: folding the desk moves nothing`);
  }
  eq(SP.SIZE.desk, 300, "U197: the desk's least room is a whole card (head, tabs, a card with three answers)");
  /* the Now tab: the strip that only repeats the GM's own cards is left out */
  const T = new Table(); T.hero("H1", "p1", { name: "Kid" }).npc("N1", { name: "Doc", health: 9 }); T.order(["H1", "N1"]).turn("H1");
  await T.req("p1", decl("H1", "slugfest", ["N1"]));
  const now = desk(T), jr = desk(T, { tab: "journal" });
  ok(now.cards.length > 0 && now.waiting.length > 0 && now.waiting.every((w) => w.mine), "U197: the table waits for the GM alone (the reaction card)");
  eq([now.waitHide, jr.waitHide], [true, false], "U197: Now: the strip is left out (its card stands under the tabs); Journal: the strip stays");
  await T.gm({ op: "answerFor", prompt: T.prompt("reaction", "N1").id, value: "pass" });
  const owed = desk(T);
  ok(owed.waiting.some((w) => !w.mine) && owed.waitHide === false, "U197: a player waited for (the attack roll): the strip stays on Now too");
  const dk = src("./ui/desk.mjs"), css = src("../../styles/tactics-ui.css");
  ok(/d\.waitHide \? null : h\("div\.igd-wait"/.test(dk), "U197: the desk draws the strip only when the model keeps it");
  ok(/\.igd-body > \.igd-sec:first-child > \.igd-h \{ margin-top: 6px !important; \}/.test(css), "U197: the first heading sits close under the tabs");
  const sp = src("./ui/slots-pure.mjs");
  ok(/if \(hudOn\) bandEnd = Math\.max\(11 \+ BAND\.min, Math\.min\(bandEnd, floorFor - SIZE\.desk \* k - GAP\)\)/.test(sp), "U197: the band gives way for the desk wherever it would be short, not only over the bar");
}

/* ================================================================== U198: the news line */
{
  const fx = { view: {}, c: (id) => ({ name: { E: "Atom Eve", V: "Vehicle" }[id] ?? id }), zone: () => ({ title: "Strefa 11" }) };
  const view = (rows) => ({ news: [{ id: "n1_f", kind: "action", actor: "M", action: "slugfest", rows, round: 1 }], round: 1, knowledge: {} });
  const say = (rows) => M.newsData(view(rows), {}, { ...fx, view: view(rows), staff: false }, t)?.text ?? "";
  const dead = say([{ target: "E", hit: true, taken: 4, down: 1, crit: { n: 13, id: "tornApart" }, fate: "dead" }]);
  ok(dead.includes(`${PL["ITAC.crit.tornApart"]}, ${PL["ITAC.ui.news.fate.dead"]}`), `U198: an injury that kills says "nie żyje" (${dead})`);
  ok(!/ ,/.test(dead), "U198: no space before a comma");
  const thrown = say([{ target: "E", hit: true, taken: 4, land: "z11", seat: "V" }]);
  ok(/ląduje: Strefa 11, wypada z pojazdu \(Vehicle\)/.test(thrown), `U198: the comma before "wypada z pojazdu" is in the text (${thrown})`);
  for (const k of ["dead", "dying", "unconscious"]) ok(!!EN[`ITAC.ui.news.fate.${k}`] && !!PL[`ITAC.ui.news.fate.${k}`], `U198: the fate word ${k} is in English and Polish`);
  const css = src("../../styles/tactics-ui.css");
  ok(/\.itd-news-t \{[^}]*font-kerning: none;/.test(css), "U198: the news line is set without the face's kerning (it tucked the comma under '1' and '7')");
  ok(/#invincible-tactics-dock \.itd-news \.itd-news-t \.ipu-sym \{ margin-inline-end: 0; \}/.test(css) && css.indexOf("itd-news .itd-news-t .ipu-sym") > css.indexOf(".itd-news-t, .igd-rollmarks, .ita-opt-n, .itd-hint1) .ipu-sym { margin-inline: 1px; }"), "U198: a mark in the news ends flush with the comma after it (rule placed after the shared one)");
  /* the engine writes the fate */
  const ks = src("./flows/kit.mjs"), es = src("./engine-pure.mjs");
  ok(/dm\.fate = cs\.dead \? "dead"/.test(ks) && /dm\.fate = id === "kill" \? "dead" : "unconscious"/.test(ks) && /\{ fate: dm\.fate \}/.test(es), "U198: the injury's state and the GM's kill / knock-out reach the news row");
}
/* the fate through the real engine: an NPC the GM kills */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Kid" }).npc("N1", { name: "Doc", health: 2 }); T.order(["H1", "N1"]).turn("H1");
  await T.req("p1", decl("H1", "slugfest", ["N1"]));
  await T.gm({ op: "answerFor", prompt: T.prompt("reaction", "N1").id, value: "pass" });
  await T.roll("attack", 1);
  const nb = T.prompt("npcBroken");
  if (nb) await T.answer("gm", "npcBroken", "kill", "N1");
  const row = (T.state.news ?? []).flatMap((n) => n.rows ?? []).find((r) => r.target === "N1");
  eq([!!nb, row?.fate], [true, "dead"], "U198: the GM's 'kill' on a broken NPC reads 'nie żyje' in the news row");
}

/* ================================================================== U199: the undo bar in view */
{
  const css = src("../../styles/base.css");
  /* ANSH: the pin follows the live fix: with top: 0 the scrolled rows peeked above the bar (the panel's top padding); it now holds to the panel's very edge */
  ok(/\.ipb-panel \.ipb-up-undo \{ position: sticky; top: calc\(-1 \* var\(--ipb-pt, 14px\)\); z-index: 3;/.test(css) && /--ipb-pt: 14px; padding: var\(--ipb-pt\)/.test(css), "U199: the undo bar holds to the top edge of the scrolled tab body (gear and upgrades)");
  ok(/\.ipb-panel \{[^}]*overflow: auto;/.test(css), "U199: .ipb-panel is the tab body that scrolls");
}

done("fxa2");
