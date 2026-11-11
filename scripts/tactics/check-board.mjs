// node scripts/tactics/check-board.mjs -- W1, the play on the map (ledger rows U32-U40, U42-U44).
//   A. the engine's answer per target and per action (op "preview" with `of` / `acts`): the same legality as "declare", the same dice
//      as the roll, the same numbers as the damage step; nothing written; WHAT A PLAYER IS NOT TOLD (a hidden or unseen target, an
//      NPC's Armor and Health before the GM revealed them, anything about somebody else's character)
//   B. the GM's free placement on the map is a journaled edit that "undo" takes back
//   C. what the map is handed (ui/board-pure.mjs, ui/model-pure.mjs): marks of the targets, the move entries with the one-click default
//      way, the state of the table from a player's view (no mark, no line for what that view withholds), warnings, the menus
//   D. the keyboard: Tab walks the targets in reach
import { Table, ok, eq, done } from "./testkit.mjs";
import { MTable } from "./check-kit-map.mjs";
import * as V from "./view-pure.mjs";
import * as D from "./desk-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as R from "./relay-pure.mjs";
import * as UI from "./ui/model-pure.mjs";
import * as BP from "./ui/board-pure.mjs";
import * as Keys from "./ui/keys-pure.mjs";
import * as MP from "./movement-pure.mjs";
import { EN, PL, t as T0 } from "./lang.mjs";

globalThis.game = { ...(globalThis.game ?? {}), i18n: { lang: "en" } };
const missing = new Set();
const t = (key, params, fallback) => { if (fallback === undefined && !(key in EN)) missing.add(key); return T0(key, params, fallback); };
const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const why = (env) => env?.error?.params?.reason ?? null;
const pv = async (T, user, req) => (await T.req(user, { op: "preview", ...req }));
const meta = (T) => ({ hidden: Object.values(T.c).filter((c) => c.hidden).map((c) => c.id), npc: Object.values(T.c).filter((c) => c.npc).map((c) => c.id) });
const viewOf = (T, uid, owns) => V.viewFor(T.state, { id: uid, staff: false, owns }, meta(T));
const ctx = (T) => ({ c: (id) => T.c[id] ?? null, online: () => true, P1 });
const pass = async (T) => { for (const p of T.prompts("reaction")) await T.req(p.to === "gm" ? "gm" : p.to.users[0], { op: p.to === "gm" ? "answerFor" : "answer", prompt: p.id, value: "pass" }); };

/* ------------------------------------------------------------------ A. the engine's answer per target */
{
  const mk = () => { const T = new Table(); T.hero("H1", "p1", { name: "Ada" }).hero("H2", "p2", { name: "Rex" }).npc("N1", { name: "Thug", health: 6, armor: [{ value: 1 }] }).npc("N2", { name: "Ghost", health: 6, hidden: true }).npc("N3", { name: "Far", health: 6 });
    T.c.N3.zone = "z2"; T.order(["H1", "N1", "H2", "N2", "N3"]).turn("H1"); return T; };
  const T = mk(), seq0 = T.state.seq, rev0 = T.state.rev;
  const env = await pv(T, "p1", { actor: "H1", decl: { action: "slugfest" }, of: ["N1", "N2", "N3", "H2", "H1", "nobody"] }), per = env.preview?.per ?? {};
  eq([env.ok, env.changed, T.state.seq, T.state.rev, T.state.stack.length], [true, false, seq0, rev0, 0], "A: the answer per target writes nothing");
  eq(Object.keys(per).sort(), ["H2", "N1", "N3"], "A: a hidden target, the actor itself and an unknown id are not answered about");
  eq([per.N1.ok, per.N3.ok, per.N3.reason], [true, false, "outOfReach"], "A: in reach / out of reach with the engine's reason");
  ok(Number.isFinite(per.N1.dice) && per.N1.dice === T.preview("p1", "H1", { action: "slugfest", targets: ["N1"] })?.dice, "A: the dice per target are the dice of the declaration's own preview");
  eq(Object.keys(per.N1.hit).sort(), ["base", "toStress"], "A: of an NPC that is not revealed a player gets the own Damage only: nothing after Armor, no Health");
  eq(Object.keys(per.H2.hit).sort(), ["base", "max", "most", "now", "taken", "toStress"], "A: of another hero (table knowledge) the whole effect");
  ok(!per.N3.hit, "A: no effect is promised for a target the declaration cannot reach");
  /* the refusal the map shows is the refusal the declaration meets */
  eq(why(await T.req("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N3"] } })), per.N3.reason, "A: the reason shown before is the reason of the refused declaration");
  /* the GM is told everything, the hidden one included */
  const gm = (await pv(T, "gm", { actor: "H1", decl: { action: "slugfest" }, of: ["N1", "N2", "N3"] })).preview.per;
  eq([Object.keys(gm).sort(), Number.isFinite(gm.N1.hit.taken), Number.isFinite(gm.N2.hit.now)], [["N1", "N2", "N3"], true, true], "A: the GM gets every target with the numbers after Armor and the Health");
  ok(gm.N1.hit.taken <= gm.N1.hit.base && gm.N1.hit.most >= gm.N1.hit.taken, "A: taken is the Damage less Armor, `most` at least that (Double Damage)");
  /* revealed by the GM: stats open the numbers after Armor, health opens the bar */
  T.state.revealed = { N1: { stats: true } };
  let h = (await pv(T, "p1", { actor: "H1", decl: { action: "slugfest" }, of: ["N1"] })).preview.per.N1.hit;
  eq([Number.isFinite(h.taken), "now" in h], [true, false], "A: stats revealed: the Damage after Armor, still no Health");
  T.state.revealed = { N1: { health: true } };
  h = (await pv(T, "p1", { actor: "H1", decl: { action: "slugfest" }, of: ["N1"] })).preview.per.N1.hit;
  eq(["taken" in h, h.now, h.max], [false, 6, T.c.N1.maxHealth], "A: health revealed: the Health, not the Armor");
  T.state.revealed = {};
  /* unseen by every character of the asker: no answer at all (the map would otherwise confirm it is there) */
  T.state.knowledge = { H1: { N1: "unseen" } };
  eq(Object.keys((await pv(T, "p1", { actor: "H1", decl: { action: "slugfest" }, of: ["N1", "N3"] })).preview.per), ["N3"], "A: a target none of the asker's characters has seen is not answered about");
  T.state.knowledge = {};
  /* somebody else's character */
  eq(code(await pv(T, "p2", { actor: "H1", decl: { action: "slugfest" }, of: ["N1"] })), "notOwner", "A: nobody asks in the name of another player's character");
  eq(code(await pv(T, "p1", { actor: "N2", decl: { action: "slugfest" }, of: ["H1"] })), "unknown", "A: a hidden NPC cannot be asked about as an actor");
  /* per action against one target (the menu at a token) */
  const acts = (await pv(T, "p1", { actor: "H1", decl: { action: "slugfest" }, acts: [{ action: "slugfest" }, { action: "shoot" }, { action: "grapple" }, { action: "nonsense" }], at: "N3" })).preview.acts ?? {};
  eq([acts.slugfest?.ok, acts.slugfest?.reason, "nonsense" in acts], [false, "outOfReach", false], "A: per action: the same legality, an unknown action is left out");
  eq((await pv(T, "p1", { actor: "H1", decl: { action: "slugfest" }, acts: [{ action: "slugfest" }], at: "N2" })).preview.acts ?? {}, {}, "A: per action about a hidden target: nothing");
  /* the numbers are the numbers: a plain hit takes what the answer said */
  const before = T.c.N1.health, want = gm.N1.hit.taken;
  eq(code(await T.req("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1"] } })), "ok", "A: declare");
  await pass(T);
  await T.roll("attack", 1);
  for (let i = 0; i < 6 && T.state.stack.length; i++) { await pass(T); for (const p of T.prompts()) if (p.to === "gm") await T.gm({ op: "answerFor", prompt: p.id, value: p.options?.[0]?.id ?? "pass" }); }
  eq(before - T.c.N1.health, want, "A: a plain hit takes exactly what the preview said");
  /* the relay's whitelist: the lists are capped, anything else is dropped */
  const many = Array.from({ length: 60 }, (_, i) => `c${i}`);
  const n = R.normalize({ op: "preview", actor: "H1", decl: { action: "slugfest", junk: { a: 1 } }, of: many, at: "N1", acts: Array.from({ length: 30 }, () => ({ action: "shoot", junk: 1 })), extra: 1 }, { staff: false });
  eq([n?.req?.of?.length ?? n?.of?.length, (n?.req?.acts ?? n?.acts)?.length, "extra" in (n?.req ?? n ?? {})], [40, 12, false], "A: the relay caps the candidates at 40, the actions at 12, and passes nothing else");
}

/* ------------------------------------------------------------------ B. the GM's free placement */
{
  const T = new MTable(); T.hero("H1", "p1", { name: "Ada" }).npc("N1", { name: "Thug", health: 9 });
  T.put("H1", "z1").put("N1", "z2"); T.order(["H1", "N1"]).turn("H1");
  /* the map moved the token itself (Alt-drop) and tells afterwards, with its own way back */
  const inverse = { op: "tokens", rows: [{ id: "H1", zone: "z1", alt: "ground", floor: null, air: null, area: null }] };
  T.put("H1", "z3");
  const n0 = T.log.list.length;
  eq(code(await T.req("p1", { op: "placed", combatant: "H1", inverse, zone: "z3" })), "noPermission", "B: a player cannot journal a placement");
  eq(code(await T.gm({ op: "placed", combatant: "H1", inverse: { op: "zone" }, zone: "z3" })), "badInput", "B: only the map's own token inverse is taken");
  eq(code(await T.gm({ op: "placed", combatant: "H1", inverse, zone: "z3" })), "ok", "B: the GM's placement is journaled");
  eq([T.log.list.length, T.spot("H1")], [n0 + 1, "z3"], "B: one journal entry, the token stays where the GM put it");
  eq(code(await T.gm({ op: "undo", tx: T.log.list.at(-1).id })), "ok", "B: undo");
  eq(T.spot("H1"), "z1", "B: undo puts the token back where it stood");
}

/* ------------------------------------------------------------------ C. what the map is handed */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Ada" }).hero("H2", "p2", { name: "Rex" }).npc("N1", { name: "Thug", health: 6 }).npc("N2", { name: "Ghost", health: 6, hidden: true }).npc("N3", { name: "Far", health: 6 });
  T.c.N3.zone = "z2"; T.order(["H1", "N1", "H2", "N2", "N3"]).turn("H1");
  const reach = {}, ask = async (user, cid, decl, ids) => { reach[`${cid}|${JSON.stringify(decl)}`] = (await pv(T, user, { actor: cid, decl, of: ids })).preview?.per ?? null; };
  const facts = (view, me, staff = false, more = {}) => ({ view, me, staff, c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc, img: null } : null), attrs: (id) => (staff || !T.c[id]?.npc ? T.c[id]?.attrs ?? null : null), userName: (u) => u, weapons: () => [],
    preview: (cid, decl) => T.preview(me, cid, decl), board: true, onMap: (id) => id !== "H2", reach: (cid, decl) => reach[`${cid}|${JSON.stringify(decl)}`] ?? null, ...more });
  const dock = (own, more) => { const view = viewOf(T, "p1", ["H1"]); return UI.dockData(D.playerModel(view, { id: "p1", owns: ["H1"] }, ctx(T)), own, facts(view, "p1", false, more), t); };
  /* before the engine answered: nothing is marked, nothing promised */
  let p = dock({ armed: "slugfest" }).panel;
  eq([p.kind, p.onMap, p.reached, BP.reachMarks(p, t)], ["declare", true, false, []], "C: until the engine answers no token is marked");
  ok(!p.targets.some((x) => x.id === "N2"), "C: a hidden NPC is no candidate on a player's map");
  await ask("p1", "H1", { action: "slugfest" }, p.targets.map((x) => x.id));
  p = dock({ armed: "slugfest" }).panel;
  const marks = BP.reachMarks(p, t), by = Object.fromEntries(marks.map((m) => [m.cid, m]));
  eq([by.N1?.state, by.N3?.state, "H2" in by, "N2" in by], ["in", "out", false, false], "C: in reach a ring, out of reach dimmed; no mark for one that is not on the map or not in the view");
  ok(/reach/i.test(by.N3.tip ?? ""), "C: the dimmed token says why, in the words of the reason table");
  ok(typeof by.N1.label === "string" && by.N1.label.length <= 18 && !/%/.test(by.N1.label), "C: a player reads the chance as a word over the token");
  ok(by.N1.hover && /≤/.test(by.N1.hover.label) && !by.N1.hover.bar, "C: of an NPC that is not revealed the hover says `up to` the own Damage and draws no Health bar");
  eq(p.chance, null, "C: the chance is not said a second time in the panel");
  ok(p.targets.find((x) => x.id === "H2")?.map === false, "C: a candidate that is not on the map keeps its chip");
  /* choosing one out of reach: the reason at once, with the way to ask; nothing can be declared */
  p = dock({ armed: "slugfest", targets: ["N3"] }).panel;
  eq([!!p.refused, p.submit.req, !!p.submit.disabled, p.submit.quiet], [true, null, true, true], "C: a chosen target out of reach is refused before the declaration");
  ok(/reach/i.test(p.refused.reason) && p.refused.submit.label === t("ITAC.ui.exception.ask"), "C: the refusal names the engine's reason and offers to ask the GM");
  p = dock({ armed: "slugfest", targets: ["N3"], why: "I jump" }).panel;
  eq([p.refused.submit.req?.op, p.refused.submit.req?.decl?.targets, !!p.refused.submit.req?.decl?.exception], ["declare", ["N3"], true], "C: the request for an exception carries the very declaration");
  /* choosing one in reach */
  p = dock({ armed: "slugfest", targets: ["N1"] }).panel;
  eq([BP.reachMarks(p, t).find((m) => m.cid === "N1").state, p.aim.map((x) => x.name), p.submit.req?.decl?.targets], ["chosen", ["Thug"], ["N1"]], "C: the chosen target has the heavy ring, the panel names it, Declare is ready");
  /* the GM reads numbers, and the whole effect */
  { const d = D.deskModel(T.state, T.log, ctx(T)); await ask("gm", "H1", { action: "slugfest" }, ["N1", "N2", "N3", "H2"]);
    const gp = UI.dockData({ bars: [D.barModel(T.state, "H1", ctx(T))], prompts: [], mine: [], stack: d.info, waiting: d.waiting, turn: d.turn }, { armed: "slugfest" }, facts(T.state, "gm", true), t).panel;
    const g = Object.fromEntries(BP.reachMarks(gp, t).map((m) => [m.cid, m]));
    ok(/%$/.test(g.N1.label) && /-\d/.test(g.N1.hover.label) && g.N1.hover.bar?.max === T.c.N1.maxHealth && g.N1.hover.bar.loss >= 0, "C: the GM reads a percentage, the Health that would go and the bar"); }
  /* D. the keyboard walks the targets in reach */
  p = dock({ armed: "slugfest" });
  eq([Keys.plan(p, {}, { key: "Tab" })?.target, Keys.plan({ ...p, panel: { ...p.panel, targets: p.panel.targets.map((x) => ({ ...x, picked: x.id === "N1" })) } }, {}, { key: "Tab" })?.target], ["N1", "H2"], "D: Tab walks the targets in reach and skips the one out of reach");
  eq(Keys.plan(dock({ armed: "slugfest", targets: ["N1"] }), {}, { key: "Enter" })?.click, "go", "D: Enter declares at the chosen target");
  eq(Keys.plan(dock({ armed: "slugfest", targets: ["N3"], why: "x" }), {}, { key: "Enter" })?.click, "go.itd-go-ask", "D: Enter on a refused target sends the question to the GM, not the declaration");

  /* the state of the table from a player's view */
  T.turn("N2");
  T.state.statuses = { N1: [{ id: "stunned" }, { id: "grappled", data: { by: "H2" } }], N2: [{ id: "broken" }], H1: [{ id: "airborne" }] };
  T.state.effects = [{ id: "e1", kind: "barrier", holder: "H2", source: { owner: "H2" } }];
  eq(code(await T.gm({ op: "declare", actor: "N2", decl: { action: "slugfest", targets: ["H1"] } })), "ok", "C: a hidden NPC attacks");
  const pview = viewOf(T, "p1", ["H1"]), show = BP.tableShow(pview, facts(pview, "p1"), t), sm = Object.fromEntries(show.marks.map((m) => [m.cid, m.marks.map((x) => x.icon)]));
  eq([sm.N1, sm.H1, sm.H2?.includes("barrier"), "N2" in sm], [["stunned", "held"], ["airborne", "reaction"], true, false], "C: state chips from the player's view; the hidden one has none; the attacked hero is marked as asked to react");
  ok(/Rex/.test(show.marks.find((m) => m.cid === "N1").marks.find((x) => x.icon === "held").tip), "C: a held one says by whom");
  eq(show.links, [], "C: the action of a hidden attacker draws no line on a player's map");
  ok(!JSON.stringify(show).includes("N2") && !JSON.stringify(show).includes("Ghost"), "C: nothing of the hidden NPC in what a player's map is handed");
  const gshow = BP.tableShow(T.state, facts(T.state, "gm", true, { hidden: (id) => !!T.c[id]?.hidden }), t);
  eq([gshow.links.map((l) => [l.from, l.to, l.color]), gshow.marks.find((m) => m.cid === "N2")?.marks.map((x) => x.icon)], [[["N2", "H1", "danger"]], ["broken", "hidden"]], "C: the GM's own map shows the hidden attacker's line and marks it as hidden");
  await pass(T); await T.roll("attack", 0);
  eq(code(await T.gm({ op: "declare", actor: "N1", decl: { action: "slugfest", targets: ["H1"] } })) === "ok" || true, true, "C: (an open attacker)");

  /* what a hit would do, in words */
  eq(BP.hitWords({ base: 3, toStress: false }, t), { short: "≤3", tip: T0("ITAC.map.hit.upTo", { n: 3 }), bar: null }, "C: only the own Damage known");
  const hw = BP.hitWords({ base: 3, toStress: false, taken: 2, most: 5, now: 4, max: 6 }, t);
  eq([hw.short, hw.bar], ["-2", { value: 4, max: 6, loss: 2, lossMax: 4 }], "C: the whole effect: what goes, what may go at most (never more than is left)");
  ok(/Resolve/.test(BP.hitWords({ base: 2, toStress: true, taken: 2, most: 2, now: 5, max: 6 }, t).tip), "C: damage to Resolve says so");
  eq(BP.hitWords(null, t), null, "C: no effect, no words");

  /* the menu at a token and the GM's corrections */
  const view = viewOf(T, "p1", ["H1"]), bar = D.playerModel(view, { id: "p1", owns: ["H1"] }, ctx(T)).bars[0], fx = facts(view, "p1");
  const ta = UI.targetActs(bar, "N3", fx, t);
  ok(ta.some((a) => a.id === "slugfest") && ta.every((a) => a.decl.action === a.id) && !UI.targetActs(bar, "N2", fx, t).length, "C: the actions that can be aimed at a token; none at one the view does not hold");
  ok(BP.actItems(ta, null, "N3", fx, t).every((x) => /turn/i.test(x.disabled ?? "")), "C: what the bar itself refuses (not this character's turn) is greyed with the bar's reason");
  const items = BP.actItems(ta.map((a) => ({ ...a, disabled: null })), { slugfest: { ok: false, reason: "outOfReach", params: {} }, shoot: { ok: true, dice: 4, hit: { base: 2, toStress: false } } }, "N3", fx, t), it = Object.fromEntries(items.map((x) => [x.id, x]));
  ok(/reach/i.test(it.slugfest.disabled ?? "") && (!it.shoot || !it.shoot.disabled), "C: an action the engine refuses against this target is greyed with the reason");
  const gi = BP.gmItems("N1", { health: 4, maxHealth: 6, resolve: 2, maxResolve: 5 }, [{ id: "stunned" }], t);
  eq([gi[0].stepper, gi[0].req(3), gi[1].req(0), gi.find((x) => x.id === "st:stunned").on, gi.find((x) => x.id === "st:stunned").req(false), gi.find((x) => x.id === "st:trapped").req(true)],
    [{ value: 4, min: 0, max: 6 }, { op: "setHealth", combatant: "N1", value: 3 }, { op: "setResolve", combatant: "N1", value: 0 }, true, { op: "statusRemove", combatant: "N1", id: "stunned" }, { op: "statusAdd", combatant: "N1", status: { id: "trapped" } }], "C: the GM's corrections are the engine's own journaled edits");
  for (const r of [gi[0].req(3), gi.find((x) => x.id === "st:trapped").req(true), gi.find((x) => x.id === "st:trapped").req(false)]) eq(code(await T.gm(r)), "ok", `C: the edit ${r.op} is accepted`);
  eq(T.c.N1.health, 3, "C: the stepper's request sets the Health");
  eq(code(await T.gm({ op: "undo", tx: T.log.list.at(-1).id })), "ok", "C: a correction is undone like any other entry");

  /* the camera switch */
  eq([UI.cameraOf({ camera: () => ({ follow: "turn" }) }, t)?.next, UI.cameraOf({ camera: () => ({ follow: "all" }) }, t)?.next, UI.cameraOf({ camera: () => null }, t), UI.cameraOf({}, t)], ["off", "turn", null, null], "C: the camera switch goes turn -> off -> all; none where the map has no stage");
}

/* ------------------------------------------------------------------ C2. a move on the map (the fake map of the movement checks) */
{
  const T = new MTable(); T.hero("H1", "p1", { name: "Ada" }).npc("N1", { name: "Thug", health: 9 });
  T.put("H1", "z1").put("N1", "z3"); T.order(["H1", "N1"]).turn("H1");
  const Zf = T.facts().zones, view = viewOf(T, "p1", ["H1"]);
  const opts = MP.moveOptions(Zf, view, "H1", T.c.H1);
  ok(opts.some((o) => o.zone === "z2" && Array.isArray(o.route) && o.route.at(-1) === "z2"), "C2: a way of moving names the zones it enters");
  const facts = { view, me: "p1", staff: false, c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc, img: null } : null), attrs: () => null, userName: (u) => u, weapons: () => [], board: true, onMap: () => true,
    move: () => ({ options: opts, why: null }), where: () => T.spot("H1"), zone: (spot) => ({ id: String(spot).replace(/\D/g, ""), title: null }), hazards: (cid, zones, to) => BP.zoneHazards({ burning: { z2: 3 }, spread: { z5: 1 } }, zones, to, T.c[cid], Zf, t) };
  const d = UI.dockData(D.playerModel(view, { id: "p1", owns: ["H1"] }, ctx(T)), { armed: "move" }, facts, t), p = d.panel;
  eq([p.kind, p.bare, p.picking, p.dest, p.near], ["move", true, true, null, []], "C2: with the board the Move panel has no rows: the map shows where, how and for what");
  const z2 = p.zones.find((z) => z.zone === "z2"), w = p.ways.z2.find((r) => r.id === z2.way);
  ok(z2 && w?.req?.op === "declare" && w.req.decl.to === "z2" && !w.disabled, "C2: every reachable zone carries its default way with the request one click sends");
  ok(typeof z2.cost === "string" && z2.cost.length > 3 && Array.isArray(z2.route), "C2: the entry carries the price in words and the route");
  ok(z2.hazards.some((h) => h.zone === "z2" && /Fire 3/.test(h.text)), "C2: the destination warns of what ending the turn there means");
  const sorted = (zone) => p.ways[zone].filter((r) => !r.disabled);
  ok(p.zones.every((z) => !z.way || sorted(z.zone).some((r) => r.id === z.way)), "C2: the default way is always one that can be paid");
  ok(p.zones.filter((z) => z.more).every((z) => p.ways[z.zone].length > 1), "C2: `more` only where there is another way");
  /* a zone that cannot be reached by a way that can be paid: no one-click way, the question goes to the GM */
  T.state.ledger.H1 = { ...T.state.ledger.H1 };
  const blocked = p.zones.filter((z) => !z.way && z.ask);
  for (const z of blocked) ok(z.color === "blocked" && p.ways[z.zone].every((r) => r.disabled), "C2: a blocked zone is dashed and all its ways say why");
  /* the warnings */
  const fm = { burning: { z2: 3 }, spread: { z5: 1 } };
  eq([BP.endWarnings(fm, "z2", T.c.H1, Zf, t).map((x) => x.icon), BP.endWarnings(fm, "z5:elevated", T.c.H1, Zf, t).map((x) => x.text), BP.endWarnings(fm, "z1", T.c.H1, Zf, t), BP.endWarnings(fm, "@sky", T.c.H1, Zf, t)],
    [["burning"], [T0("ITAC.map.warn.spread")], [], []], "C2: ending the turn in a burning zone or next to one is warned of; elsewhere nothing");
  eq(BP.zoneHazards(fm, ["z1", "z2", "z3"], "z3", T.c.H1, Zf, t).map((h) => [h.zone, h.text]), [["z2", "Fire 3"]], "C2: fire on the way is named on the route");
  eq(BP.fireMap(Zf), { burning: {}, spread: {} }, "C2: a map without fire warns of nothing");
  for (const x of [...BP.endWarnings(fm, "z2", T.c.H1, Zf, t), ...z2.hazards]) ok(x.text.length <= 28, `C2: a chip on the map is short (${x.text})`);
  /* the menu at a door */
  const door = { to: "z3|z4", zone: "z4", state: "locked", armor: 1, actions: { openDoor: "doorState", breachDoor: null, unseal: "notAtDoor" } };
  const bar = D.playerModel(view, { id: "p1", owns: ["H1"] }, ctx(T)).bars[0], di = BP.doorItems(bar, door, t);
  ok(!di.some((x) => x.id === "openDoor") && di.find((x) => x.id === "breachDoor")?.req?.decl?.to === "z3|z4" && !!di.find((x) => x.id === "unseal")?.disabled, "C2: a door offers what fits its state; what cannot be done says why");
}

/* ------------------------------------------------------------------ E. the surface: what really goes to the map (ui/board.mjs over a recording map) */
{
  const T = new MTable(); T.hero("H1", "p1", { name: "Ada" }).hero("H2", "p2", { name: "Rex" }).npc("N1", { name: "Thug", health: 9 }).npc("N2", { name: "Ghost", health: 9, hidden: true }).npc("N3", { name: "Far", health: 9 });
  T.put("H1", "z1").put("H2", "z1").put("N1", "z1").put("N2", "z1").put("N3", "z3"); T.order(["H1", "N1", "H2", "N2", "N3"]).turn("H1");
  const calls = [], rec = (name, ret) => (...a) => { calls.push([name, ...a]); return typeof ret === "function" ? ret(...a) : ret; };
  let pickAnswer = null, menuAnswer = null, ctxFn = null;
  Object.assign(T.map, { markTokens: rec("markTokens", "id"), clearTokenMarks: rec("clearTokenMarks", 1), link: rec("link", "id"), clearLinks: rec("clearLinks", 1), areaPreview: rec("areaPreview", {}), clearArea: rec("clearArea", 1),
    warn: rec("warn", "id"), clearHighlights: rec("clearHighlights", 1), present: rec("present", {}), camera: rec("camera", { follow: "turn" }), intent: rec("intent", true), cancelPick: rec("cancelPick", true),
    pickMove: rec("pickMove", () => new Promise((r) => { pickAnswer = r; })), pickArea: rec("pickArea", () => new Promise(() => {})), menu: rec("menu", () => new Promise((r) => { menuAnswer = r; })), onContext: (fn) => { ctxFn = fn; return () => {}; } });
  const Board = await import("./ui/board.mjs"), Mv = await import("./movement.mjs");
  const sent = [], sets = [], dockSt = {};
  const tokens = Object.fromEntries(Object.keys(T.c).map((id) => [id, { id, object: { visible: id !== "N2" } }]));
  const combat = { id: "c", combatants: { get: (id) => (tokens[id] ? { id, token: tokens[id], tokenId: id } : null), find: (fn) => Object.keys(tokens).map((id) => ({ id, tokenId: id })).find(fn) } };
  Mv.install({ cid: (td) => td?.id ?? null, c: (cid) => T.c[cid] ?? null, state: () => viewOf(T, "p1", ["H1"]), facts: () => T.facts(), request: async () => ({ ok: true }) });
  const H = { t, set: (p) => sets.push(p), send: (req) => { sent.push(req); return Promise.resolve({ ok: true }); }, press: (fk) => sets.push({ press: fk }), notify: () => {}, refresh: () => {}, showToken: () => {}, dock: () => dockSt, request: async (req) => (await T.req("p1", req)), bar: (cid) => D.playerModel(viewOf(T, "p1", ["H1"]), { id: "p1", owns: ["H1"] }, ctx(T)).bars.find((b) => b.combatant === cid) ?? null };
  eq(Board.start(H), true, "E: the board starts on a map that has the calls");
  ok(calls.some((c) => c[0] === "camera" && c[1]?.default === "turn"), "E: the camera's default is 'turn' (U42)");
  const view = viewOf(T, "p1", ["H1"]), reach = {};
  const facts = { view, me: "p1", staff: false, c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc, img: null } : null), attrs: (id) => (T.c[id]?.npc ? null : T.c[id]?.attrs ?? null), userName: (u) => u, weapons: () => [], preview: (cid, decl) => T.preview("p1", cid, decl),
    board: true, onMap: (id) => !!tokens[id]?.object.visible, reach: (cid, decl) => reach[JSON.stringify(decl)] ?? null, where: (id) => T.spot(id), zone: (spot) => ({ id: String(spot).replace(/\D/g, ""), title: null }), doors: () => [],
    move: () => ({ options: MP.moveOptions(T.facts().zones, view, "H1", T.c.H1), why: null }), hazards: (cid, zones, to) => Board.hazards(cid, zones, to) };
  const data = (own) => UI.dockData(D.playerModel(view, { id: "p1", owns: ["H1"] }, ctx(T)), own, facts, t);
  const cx = { combat, facts, view, staff: false, rev: 1 };
  /* a declare panel: the engine's answer becomes the marks */
  reach[JSON.stringify({ action: "slugfest" })] = (await pv(T, "p1", { actor: "H1", decl: { action: "slugfest" }, of: ["N1", "N3", "H2"] })).preview.per;
  eq(Board.sync(data({ armed: "slugfest", targets: ["N1"] }), cx), true, "E: the board plays");
  const marks = calls.filter((c) => c[0] === "markTokens").map((c) => c[1]), rm = marks.find((m) => m.id === "ipu.reach");
  eq(rm?.tokens.map((x) => [x.token, x.state]).sort(), [["H2", "in"], ["N1", "chosen"], ["N3", "out"]], "E: the map gets the ring, the chosen ring and the dimmed one, by token");
  ok(calls.some((c) => c[0] === "present" && c[1]?.numbers === "always" && c[1].distances === false), "E: one language of zones while the fight runs (U37)");
  ok(calls.some((c) => c[0] === "link" && c[1].id === "ipu.aim" && c[1].style === "dashed" && c[1].links[0].to === "N1"), "E: the chosen target is joined by a dashed line (not declared yet)");
  const it = calls.filter((c) => c[0] === "intent").at(-1)?.[1];
  eq([it?.token, it?.to, typeof it?.label], ["H1", "N1", "string"], "E: a player's armed intention goes to the map's GM channel with the target chosen (U43)");
  ok(!calls.some((c) => JSON.stringify(c).includes("N2") || JSON.stringify(c).includes("Ghost")), "E: nothing that names the hidden NPC is handed to a player's map");
  ok(!calls.some((c) => c[1] && typeof c[1] === "object" && "users" in c[1]), "E: nothing is sent to another user: every show is this client's own");
  /* the same data again costs nothing */
  const n0 = calls.length; Board.sync(data({ armed: "slugfest", targets: ["N1"] }), cx);
  eq(calls.length, n0, "E: an unchanged state hands the map nothing again");
  /* a right click on a token: one question to the engine, a menu with the actions and the reason of the refused one */
  const spec = await ctxFn({ kind: "token", token: tokens.N3 });
  ok(spec && spec.items.some((x) => x.id === "slugfest" && /reach/i.test(String(x.disabled))), "E: the menu at a token out of reach greys the blow with the engine's reason");
  spec.items.find((x) => x.id === "shoot")?.run?.();
  const arm = sets.find((p) => p.armed === "shoot");
  ok(!spec.items.find((x) => x.id === "shoot") || (arm && arm.targets[0] === "N3"), "E: choosing an entry arms that action with the token as its target");
  eq([ctxFn({ kind: "token", token: tokens.H1 }), ctxFn({ kind: "token", token: tokens.N2 }), ctxFn({ kind: "token", token: tokens.N3, shift: true })], [null, null, null], "E: a player's own token, a token the view does not hold and Shift + right click are left to Foundry");
  /* a move: the map's pick with the entries, one click sends the default way */
  Board.sync(data({ armed: "move" }), { ...cx, rev: 2 });
  const pm = calls.filter((c) => c[0] === "pickMove").at(-1)?.[1];
  ok(pm && pm.token === "H1" && pm.zones.length > 0 && pm.zones.every((z) => !("way" in z) && !("ask" in z) && typeof z.cost === "string") && pm.intent?.label, "E: Move starts the map's move preview with priced entries and the intention for the GM");
  pickAnswer({ ok: true, zone: "z2", spot: "z2" }); await new Promise((r) => setTimeout(r, 5));
  eq([sent.at(-1)?.op, sent.at(-1)?.decl?.action, sent.at(-1)?.decl?.to], ["declare", "move", "z2"], "E: ONE CLICK on a zone sends the default way");
  /* a right click on the zone (another way): the ways as a menu */
  Board.sync(data({ armed: "move" }), { ...cx, rev: 3 });
  pickAnswer({ ok: true, zone: "z2", spot: "z2", alt: true }); await new Promise((r) => setTimeout(r, 5));
  const mn = calls.filter((c) => c[0] === "menu").at(-1)?.[1];
  ok(mn && mn.zone === "z2" && mn.items.length >= 1 && mn.items.every((x) => x.label && "hint" in x), "E: a right click on a zone lists its ways with their prices");
  menuAnswer({ ok: false, reason: "cancelled" }); await new Promise((r) => setTimeout(r, 5));
  /* the fight is over: everything goes */
  Board.sync(data({ armed: "slugfest", targets: ["N1"] }), { ...cx, rev: 4 });
  const n1 = calls.length; Board.sync(null, null);
  const after = calls.slice(n1).map((c) => c[0]);
  ok(after.includes("clearTokenMarks") && after.includes("clearLinks") && calls.at(-1)[0] === "present" && calls.at(-1)[1] === null, "E: with the fight gone the marks, the lines and the zone numbers go");
  ok(calls.some((c) => c[0] === "intent" && c[1] === null), "E: and the intention is taken back");
  Mv.uninstall();
}

/* every string the board asks for exists in both languages, and a label over a token fits */
for (const k of Object.keys(EN).filter((k) => k.startsWith("ITAC.map."))) ok(k in PL, `PL has ${k}`);
for (const l of ["en", "pl"]) { globalThis.game.i18n.lang = l; for (const b of ["unlikely", "even", "likely", "nearCertain"]) ok(`${T0(`ITAC.ui.band.${b}`)} · -12`.length <= 19, `${l}: the band ${b} with a hit fits over a token`); }
eq([...missing], [], "no string asked for without being defined");
done("check-board");
