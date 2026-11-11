// node scripts/tactics/check-ui.mjs -- the surfaces' render data (ui/model-pure.mjs): model -> what the dock and the desk draw, the
// requests they send (a whole attack driven ONLY through requests found in the render data), the reasons of greyed things, what a
// player's data never contains, and that every string resolves in both languages.
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import * as D from "./desk-pure.mjs";
import * as V from "./view-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./ui/model-pure.mjs";
import { EN, PL, t as T0 } from "./lang.mjs";

const missing = new Set();
/* the real t(), but a key asked without a fallback must exist */
const t = (key, params, fallback) => { if (fallback === undefined && !(key in EN)) missing.add(key); return T0(key, params, fallback); };
const lang = (l) => { globalThis.game = { i18n: { lang: l } }; };
const mk = () => { const T = new Table(); T.hero("H1", "p1", { name: "Atom Eve" }).hero("H2", "p2", { name: "Rex" }).npc("N1", { name: "Mauler", health: 5, attrs: { fighting: 9, agility: 8 } }); T.order(["H1", "N1", "H2"]).turn("H1"); return T; };
const ctx = (T, online = () => true) => ({ c: (id) => T.c[id] ?? null, online, P1 });
const meta = (T) => ({ hidden: Object.values(T.c).filter((c) => c.hidden).map((c) => c.id), npc: Object.values(T.c).filter((c) => c.npc).map((c) => c.id) });
const viewOf = (T, uid, owns) => V.viewFor(T.state, { id: uid, staff: false, owns }, meta(T));
/* facts that would LEAK if the model asked: every combatant and every attribute is answered, as a careless caller might */
const facts = (T, view, me, staff = false) => ({ view, me, staff, c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc, img: null } : null), attrs: (id) => T.c[id]?.attrs ?? null, userName: (u) => `user-${u}` });
const dock = (T, uid, owns, own = {}) => { const view = viewOf(T, uid, owns); return M.dockData(D.playerModel(view, { id: uid, owns }, ctx(T)), own, facts(T, view, uid), t); };
const desk = (T, own = {}, online) => M.deskData(D.deskModel(T.state, T.log, ctx(T, online)), own, facts(T, T.state, "gm", true), t);
const staffDock = (T, cid, own = {}) => { const d = D.deskModel(T.state, T.log, ctx(T)); return M.dockData({ bars: [D.barModel(T.state, cid, ctx(T))], prompts: [], mine: [], stack: d.info, waiting: d.waiting, turn: d.turn }, own, facts(T, T.state, "gm", true), t); };
const act = (d, id) => d.groups.flatMap((g) => g.items).find((a) => a.id === id);
const noKeys = (v, where) => { const s = JSON.stringify(v, (k, x) => (typeof x === "function" ? undefined : x)); const m = s.match(/"ITAC\.[\w.]+"/); ok(!m, `${where}: no raw key is shown (${m?.[0]})`); return s; };

lang("en");
{ // chance: bands for players
  eq([M.bandOf(0.1), M.bandOf(0.35), M.bandOf(0.59), M.bandOf(0.6), M.bandOf(0.8), M.bandOf(1)], [0, 1, 1, 2, 3, 3], "bands: thresholds .35 / .6 / .8");
  const c = M.chanceOf(4), d = M.chanceOf(4, 3);
  eq([c.band, c.defended ?? null, d.defended.p < d.p, M.chanceOf(0).p > 0], ["even", null, true, true], "chance: the pool alone, lower when a defender's pool is known, never a zero pool");
}
{ // the dock on the player's turn: groups, pips, a declare driven by render data only
  const T = mk();
  let d = dock(T, "p1", ["H1"]);
  eq([d.show, d.onTurn, d.rest, d.canRest, d.who.name, d.chars.length], [true, true, false, false, "Atom Eve", 0], "dock: shown on the turn, cannot rest, one character");
  eq(d.pips.map((p) => [p.unit, p.state]), [["full", "open"], ["quick", "open"], ["quick", "open"]], "dock: three pips, all open");
  eq([d.groups[0].id, !!act(d, "slugfest"), act(d, "slugfest").disabled, act(d, "slugfest").costText, act(d, "other") ?? null, act(d, "block") ?? null], ["attack", true, null, "Full action", null, null], "dock: attacks first; 'something else' and defences are not buttons of the groups");
  ok(d.groups.every((g) => g.label && g.items.length), "dock: no empty group is drawn");
  eq([d.end.disabled, d.end.confirm, d.end.label, d.panel], [null, true, "End turn", null], "dock: end turn asks once more while actions are unused");
  eq(dock(T, "p1", ["H1"], { endArmed: true }).end.label === d.end.label, false, "dock: the armed End turn reads differently");
  d = dock(T, "p1", ["H1"], { armed: "slugfest" });
  eq([d.panel.kind, d.panel.picking, d.panel.submit.req, d.panel.submit.disabled != null, d.panel.targets.map((x) => [x.id, x.likely])], ["declare", true, null, true, [["N1", true], ["H2", false]]], "declare panel: needs a target first; the other side leads the list");
  eq([d.panel.pool.total, d.panel.pool.parts.map((p) => [p.label, p.dice]), d.panel.chance.text, d.panel.chance.defended], [4, [["Fighting", 4]], "Even odds", null], "declare panel: own pool and a band; nothing about the defender");
  { // a declaration the executor refused as against the rules: the reason stays, with the request for an exception
    const R = { action: "slugfest", key: "N1", reason: "outOfReach", params: { distance: 1 } };
    let r = dock(T, "p1", ["H1"], { armed: "slugfest", targets: ["N1"], refused: R }).panel.refused;
    eq([/reach/i.test(r.reason), r.submit.req, typeof r.submit.disabled, r.text], [true, null, "string", ""], "refused declaration: the reason in words; asking needs words");
    r = dock(T, "p1", ["H1"], { armed: "slugfest", targets: ["N1"], refused: R, why: " I throw a car " }).panel.refused;
    eq(r.submit.req, { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1"], exception: { text: "I throw a car" } } }, "refused declaration: the same declaration with the exception request");
    eq([dock(T, "p1", ["H1"], { armed: "slugfest", targets: ["H2"], refused: R }).panel.refused, dock(T, "p1", ["H1"], { armed: "slugfest", targets: ["N1"] }).panel.refused], [null, null], "the reason belongs to that declaration only");
    T.setRange("H1", "N1", 3);
    eq(((await T.req("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1"] } })).error ?? {}).code, "illegal", "the engine refuses the out-of-reach attack");
    eq((await T.req("p1", r.submit.req)).ok, true, "and takes it with the exception request");
    const g = desk(T);
    eq([g.cards[0].kind, g.cards[0].lines.some((l) => l.quote === "I throw a car"), g.cards[0].options.map((o) => o.id)], ["exception", true, ["grant", "deny"]], "desk: the exception card of that declaration");
    eq((await T.gm(g.cards[0].options[1].req)).ok, true, "denied through the card");
    T.setRange("H1", "N1", 0);
    const s = staffDock(T, "H1", { armed: "slugfest", targets: ["N1"], refused: R }).panel.refused;
    eq([s.text, s.submit.disabled, s.submit.req.decl.exception != null], [null, null, true], "staff: 'declare anyway' needs no words");
  }
  d = dock(T, "p1", ["H1"], { armed: "slugfest", targets: ["N1", "ghost"] });
  eq([d.panel.picking, d.panel.submit.disabled, d.panel.submit.req], [false, null, { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1"] } }], "declare panel: the request carries only targets of the list");
  eq((await T.req("p1", d.panel.submit.req)).ok, true, "declared through the panel's request");
  d = dock(T, "p1", ["H1"]);
  eq([d.panel.kind, d.panel.title, d.panel.targets, d.panel.commands.map((c) => c.id), act(d, "slugfest").disabled != null], ["mine", "Slugfest", ["Mauler"], ["amend", "cancel"], true], "dock: my open action with amend / cancel; the bar is busy with a reason");
  eq(d.waiting.map((w) => [w.gm, w.mine]), [[true, false]], "dock: the table waits for the GM");
  // the GM desk sees it
  let g = desk(T);
  eq([g.show, g.count, g.tab, g.cards.map((c) => [c.kind, c.about, c.options.map((o) => o.label)])], [true, 1, "now", [["reaction", "Mauler", ["Block", "No reaction"]]]], "desk: the NPC's reaction card; pass reads 'No reaction'");
  ok(g.cards[0].options.every((o) => /%/.test(o.note ?? "")) && g.cards[0].lines.some((l) => /4/.test(String(l))), "desk: the card shows the attacker's dice and a percentage per answer");
  eq([g.cards[0].always.on, g.stack.map((i) => [i.actor, i.action, i.targets, i.locked, i.commands.map((c) => c.id)])], [false, [["Atom Eve", "Slugfest", ["Mauler"], false, ["veto", "override"]]]], "desk: the declared action, who / what / at whom, veto and override");
  eq(desk(T, { always: { [g.cards[0].id]: true } }).cards[0].options[0].req.value ?? desk(T, { always: { [g.cards[0].id]: true } }).cards[0].options[0].req, { id: "block", always: true }, "desk: 'always' rides on the answer");
  const o = desk(T, { override: g.stack[0].id }).stack[0];
  eq([o.override.some((c) => c.id === "abortRefund"), o.override.find((c) => c.id === "pool:attack").req(7).op != null, o.retarget.choices.map((c) => c.id)], [true, true, ["H2"]], "desk: opened override lists controls with requests; a new target can be given");
  eq((await T.gm(g.cards[0].options[0].req)).ok, true, "GM answers through the card");
  g = desk(T, { override: g.stack[0].id });
  eq([g.count, g.stack[0].locked, g.stack[0].rolls.map((r) => [r.key, r.waiting, /user-p1/.test(r.text), /%/.test(r.chance ?? "")])], [0, true, [["attack", true, true, true]]], "desk: after the lock the pending roll names who rolls, with a percentage");
  const c = (id) => g.stack[0].override.find((x) => x.id === id);
  eq([c("pool:attack").type, c("sixes:attack").min, c("hit:N1").choices.map((x) => x.id), c("dmg:N1").type, !!c("skip")], ["number", 0, ["hit", "miss"], "number", true], "override: pool, sixes, hit / miss, damage, skip");
  eq((await T.gm(c("sixes:attack").req(2))).ok, true, "override: sixes set through the control's request");
  await T.roll("def:N1", 0);
  d = dock(T, "p1", ["H1"]);
  eq(d.prompts.map((p) => [p.kind, !!p.multi, p.submit.req != null]), [["stunts", true, true]], "dock: the stunt question, several may be picked, none is allowed");
  eq([d.prompts[0].options.some((x) => /Mauler/.test(x.label)), d.prompts[0].lines.some((l) => /Mauler/.test(String(l)))], [false, true], "stunts against one target: the name is said once, not on every button");
  const sid = d.prompts[0].options.find((x) => !x.disabled).id, off = d.prompts[0].options.find((x) => x.disabled);
  eq([typeof off.disabled, off.req], ["string", null], "a greyed option has words for the reason and no request");
  d = dock(T, "p1", ["H1"], { picks: { [d.prompts[0].id]: [sid] } });
  eq([d.prompts[0].multi.n, d.prompts[0].options.find((x) => x.id === sid).picked], [1, true], "dock: the pick shows");
  eq((await T.req("p1", d.prompts[0].submit.req)).ok, true, "stunts answered through the submit request");
  g = desk(T);
  eq([g.stack.length, g.journal.length, g.journal[0].rows.length, g.journal[0].rows[0].undo != null, g.journal[0].label], [0, 1, 1, true, "Round 1"], "desk: closed, in the journal by round, with Undo");
  eq((await T.gm(g.journal[0].rows[0].undo.req)).ok, true, "undo through the journal row");
  eq([T.c.N1.health, desk(T).journal[0].rows[0].undo], [5, null], "undone");
}
{ // off turn: reasons, the exception request, a reaction asked out of turn, something else, hold off
  const T = mk();
  let d = dock(T, "p2", ["H2"]);
  eq([d.onTurn, d.canRest, d.rest, d.end.disabled != null, act(d, "slugfest").disabled], [false, true, true, true, T0("ITAC.reason.notYourTurn")], "off turn: the dock rests; actions greyed with the reason in words");
  d = dock(T, "p2", ["H2"], { armed: "slugfest" });
  eq([d.rest, d.panel.kind, d.panel.submit.req, /turn/i.test(d.panel.reason)], [false, "blocked", null, true], "a greyed action opens 'ask the GM': needs words first");
  d = dock(T, "p2", ["H2"], { armed: "slugfest", text: " I was ready for this ", targets: ["N1"] });
  eq((await T.req("p2", d.panel.submit.req)).ok, true, "the exception request is accepted");
  let g = desk(T);
  eq(g.cards.map((c) => [c.kind, c.about, c.lines.some((l) => l.quote === "Slugfest (Mauler): I was ready for this"), c.options.length > 1]), [["exception", "Rex", true, true]], "desk: the exception card quotes the player, with the action and the target meant");
  eq((await T.gm(g.cards[0].options.find((x) => x.id === "deny").req)).ok, true, "GM answers the exception");
  if (T.top()) await T.gm({ op: "abort", inst: T.top().id });
  T.turn("N1");
  let s = staffDock(T, "N1", { armed: "slugfest", targets: ["H2"] });
  eq([s.who.name, s.onTurn, s.panel.pool.total, s.panel.chance.defended != null], ["Mauler", true, 9, true], "staff dock: the NPC's bar from the full state, with its numbers");
  eq((await T.gm(s.panel.submit.req)).ok, true, "the GM declares for the NPC through the same panel");
  d = dock(T, "p2", ["H2"]);
  eq([d.rest, d.prompts.map((p) => [p.kind, p.about, p.options.map((x) => x.id)])], [true, [["reaction", "Rex", ["block", "dodge", "pass"].filter((x) => d.prompts[0].options.some((q) => q.id === x))]]], "out of turn: the reaction question shows above a resting bar");
  ok(d.prompts[0].options.every((x) => x.note == null) && !JSON.stringify(d.prompts[0].lines).includes("9"), "a player's reaction question carries no attacker numbers");
  eq(d.waiting[0].mine, true, "the wait line says it is me");
  eq(desk(T).cards.length, 0, "online addressee: no desk card");
  g = desk(T, {}, (u) => u !== "p2");
  eq([g.cards[0].proxy, /user-p2/.test(String(g.cards[0].lines[0]))], [true, true], "offline addressee: a proxy card naming the absent user");
  eq((await T.req("p2", d.prompts[0].options.find((x) => x.pass).req)).ok, true, "reaction answered through the option's request");
  await T.gm({ op: "abort", inst: T.top().id });
  T.turn("H1");
  d = dock(T, "p1", ["H1"], { mode: "other" });
  eq([d.panel.kind, d.panel.submit.req, d.other.armed], ["other", null, true], "something else: needs words");
  d = dock(T, "p1", ["H1"], { mode: "other", text: "swing from the crane" });
  eq((await T.req("p1", d.panel.submit.req)).ok, true, "something else sent");
  g = desk(T, { manual: { [T.top().id]: { cost: "quick", note: "fine" } } });
  eq(g.manual.map((m) => [m.actor, m.text, m.costs.find((c) => c.on).id]), [["Atom Eve", "swing from the crane", "quick"]], "desk: the free-form action with its form");
  eq((await T.gm(g.manual[0].resolve.req)).ok, true, "resolved by hand through the form's request");
  d = dock(T, "p1", ["H1"]);
  ok(d.pips.some((p) => p.state === "used"), "the cost shows on the pips");
  eq([d.holdOff.label.length > 0, typeof d.holdOff.disabled === "string" || d.holdOff.disabled === null], [true, true], "hold off is offered or greyed with words");
  const h = dock(T, "p1", ["H1"], { mode: "holdOff" });
  eq([h.panel.kind, h.panel.targets.every((x) => x.req?.op === "holdOff")], ["holdOff", true], "hold off: each later card carries its request");
  eq((await T.req("p1", d.end.req)).ok, true, "end turn through the dock's request");
}
{ // the table tab: default reactions and reveal; hidden information
  const T = new Table();
  T.hero("H1", "p1", { name: "Atom Eve" }).npc("N1", { name: "Mauler", attrs: { fighting: 9, agility: 8 } }).npc("N2", { name: "Zzyxq", hidden: true, attrs: { fighting: 11 } });
  T.order(["H1", "N1", "N2"]).turn("H1");
  let g = desk(T, { tab: "table" });
  eq([g.tab, g.npcs.map((n) => n.name).sort(), g.npcs[0].policy.map((p) => p.id), g.npcs[0].reveal.map((r) => [r.id, r.on])], ["table", ["Mauler", "Zzyxq"], ["block", "dodge", "onBroken", "push", "major"], [["stats", false], ["powers", false], ["health", false]]], "desk: every NPC with reaction defaults and reveal switches");
  eq(g.mode.choices.map((m) => [m.id, m.on]), [["tactical", true], ["free", false]], "desk: the rules mode");
  let d = dock(T, "p1", ["H1"], { armed: "slugfest", targets: ["N1"] });
  let s = noKeys(d, "player dock");
  eq([d.panel.targets.map((x) => x.id), d.panel.chance.defended, /Zzyxq|"N2"|\b11\b|\b9\b/.test(s)], [["N1"], null, false], "hidden: a concealed combatant is no target; an unrevealed NPC's numbers never reach the data");
  eq(M.attrsFor(facts(T, viewOf(T, "p1", ["H1"]), "p1"), "N1"), null, "attrsFor refuses an unrevealed NPC even when the caller would answer");
  const n1 = g.npcs.find((n) => n.id === "N1");
  eq((await T.gm(n1.reveal[0].req)).ok, true, "reveal stats through the desk's request");
  d = dock(T, "p1", ["H1"], { armed: "slugfest", targets: ["N1"] });
  eq([d.panel.chance.defended != null, /Zzyxq|"N2"|\b11\b/.test(noKeys(d, "player dock, revealed"))], [true, false], "revealed stats: the defended band appears; the concealed one stays out");
  eq(desk(T, { tab: "table" }).npcs.find((n) => n.id === "N1").reveal[0].on, true, "desk: the switch shows on");
  eq((await T.gm(n1.policy[0].choices.find((c) => c.id === "always").req)).ok, true, "default reaction through the desk's request");
  eq(desk(T).npcs.find((n) => n.id === "N1").policy[0].choices.find((c) => c.on).id, "always", "desk: the default shows");
  await T.req("p1", d.panel.submit.req);
  eq(desk(T).cards.length, 0, "an NPC that always blocks asks nothing");
  noKeys(desk(T, { override: T.top()?.id }), "desk");
  eq(M.dockData(D.playerModel(viewOf(T, "px", []), { id: "px", owns: [] }, ctx(T)), {}, facts(T, viewOf(T, "px", []), "px"), t).show, false, "a user without a character has no bar");
  eq(M.deskData(null, {}, {}, t).show, false, "no model, no desk");
  if (T.top()) await T.gm({ op: "abort", inst: T.top().id });
  T.turn("N2");
  const hid = dock(T, "p1", ["H1"]);
  eq([hid.show, /Zzyxq|"N2"/.test(noKeys(hid, "player dock, hidden turn")), hid.turn.includes("Zzyxq")], [true, false, false], "hidden: the turn of a concealed combatant names nobody on a player's dock");
}
{ // both languages render every state; no key asked without a fallback is missing
  for (const l of ["en", "pl"]) {
    lang(l);
    const T = mk();
    noKeys(dock(T, "p1", ["H1"], { armed: "slugfest", targets: ["N1"] }), `${l} dock declare`);
    noKeys(dock(T, "p2", ["H2"], { armed: "slugfest" }), `${l} dock blocked`);
    noKeys(dock(T, "p1", ["H1"], { mode: "other" }), `${l} dock other`);
    await T.req("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1"] } });
    noKeys(desk(T, { override: T.top().id }), `${l} desk reaction`);
    noKeys(dock(T, "p1", ["H1"]), `${l} dock mine`);
    await T.answer("gm", "reaction", "pass"); await T.roll("attack", 2);
    noKeys(dock(T, "p1", ["H1"]), `${l} dock stunts`);
    noKeys(desk(T, { override: T.top()?.id, tab: "journal" }), `${l} desk late`);
    noKeys(staffDock(T, "N1"), `${l} staff dock`);
  }
  lang("en");
  eq([...missing], [], "every key the model asks for without a fallback exists");
  const fam = { "cost": ["full", "quick", "free", "none"], "band": M.BANDS.map((b) => b.id), "group": M.GROUPS, "pip": ["full", "quick"], "pip.tip": ["open", "used", "lost"], "policy": ["block", "dodge", "onBroken", "ask", "always", "never", "ko", "kill", "crit"], "reveal": ["stats", "powers", "health"], "drift": ["restore", "difference", "leave"], "mode": ["tactical", "free"], "tab": ["now", "journal", "table"], "attr": ["fighting", "agility", "strength", "reason", "intuition", "presence"] };
  for (const [f, ids] of Object.entries(fam)) for (const id of ids) ok(`ITAC.ui.${f}.${id}` in EN && `ITAC.ui.${f}.${id}` in PL, `key built by template exists in both languages: ITAC.ui.${f}.${id}`);
}
done("check-ui");
