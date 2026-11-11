// node scripts/tactics/check-ui.mjs -- the surfaces' render data (ui/model-pure.mjs): model -> what the dock and the desk draw, the
// requests they send (a whole attack driven ONLY through requests found in the render data), the reasons of greyed things, what a
// player's data never contains, and that every string resolves in both languages.
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import * as D from "./desk-pure.mjs";
import * as V from "./view-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./ui/model-pure.mjs";
import * as Keys from "./ui/keys-pure.mjs";
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
const facts = (T, view, me, staff = false) => ({ view, me, staff, c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc, img: null } : null), attrs: (id) => T.c[id]?.attrs ?? null, userName: (u) => `user-${u}`, preview: (cid, decl) => T.preview(me, cid, decl) });
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
  eq(d.slots.map((p) => [p.key, p.kind, p.state, p.extra]), [["a", "full", "open", false], ["b", "quick", "open", false]], "U31: two slots a turn (the big one, the quick one), both open");
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
  eq([d.panel.kind, d.panel.title, d.panel.targets.map((x) => x.name), d.panel.commands.map((c) => c.id), act(d, "slugfest").disabled != null], ["mine", "Slugfest", ["Mauler"], ["amend", "cancel"], true], "dock: my open action with amend / cancel; the bar is busy with a reason");
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
  eq([d.rest, d.panel.kind, d.panel.submit.req, /turn/i.test(d.panel.refused.reason), d.panel.refused.submit.req, typeof d.panel.refused.submit.disabled], [false, "declare", null, true, null, "string"], "a greyed action keeps its panel with the reason and 'ask the GM': needs a target and words first (U3)");
  d = dock(T, "p2", ["H2"], { armed: "slugfest", why: " I was ready for this ", targets: ["N1"] });
  eq([d.panel.refused.submit.req.reason, d.panel.refused.submit.req.decl.action, d.panel.refused.submit.req.decl.targets, d.panel.submit.req], ["notYourTurn", "slugfest", ["N1"], null], "U3: the request names the rule that refused and carries the declaration it is about");
  eq((await T.req("p2", d.panel.refused.submit.req)).ok, true, "the exception request is accepted");
  let g = desk(T);
  eq(g.cards.map((c) => [c.kind, c.about, c.lines.some((l) => l.quote === "Slugfest (Mauler): I was ready for this"), c.options.length > 1, c.lines.some((l) => typeof l === "string" && /not your turn/i.test(l)), c.lines.some((l) => typeof l === "string" && /Slugfest \(Mauler\)/.test(l) && /no cost/i.test(l))]), [["exception", "Rex", true, true, true, true]], "desk: the exception card quotes the player, names the rule that refused and says what a grant will do (U3)");
  eq((await T.gm(g.cards[0].options.find((x) => x.id === "deny").req)).ok, true, "GM answers the exception");
  eq([T.state.stack.length, dock(T, "p2", ["H2"]).news?.tone, /refused/i.test(dock(T, "p2", ["H2"]).news?.text ?? ""), dock(T, "p1", ["H1"]).news ?? null, viewOf(T, "p1", ["H1"]).news.length], [0, "bad", true, null, 0], "U3: a refusal is told to the one who asked, in the dock, and to nobody else");
  { // U3: granted: the very declaration runs, at no cost, and both sides see it
    const G = mk();
    const dd = dock(G, "p2", ["H2"], { armed: "slugfest", why: "let me", targets: ["N1"] });
    await G.req("p2", dd.panel.refused.submit.req);
    const before = JSON.stringify(P1.budget(G.state, "H2"));
    eq((await G.gm(desk(G).cards[0].options.find((x) => x.id === "grant").req)).ok, true, "U3: the GM grants");
    const top = G.top(), dn = dock(G, "p2", ["H2"]);
    eq([top?.actor, top?.action, top?.decl.targets, top?.decl.exception?.state, JSON.stringify(P1.budget(G.state, "H2")) === before, desk(G).cards.some((c) => c.kind === "exception")], ["H2", "slugfest", ["N1"], "granted", true, false], "U3: the granted declaration is in progress for the asker, its cost waived, with no second exception card");
    eq([dn.news?.tone, /agreed/i.test(dn.news?.text ?? ""), /Slugfest/.test(dn.news?.text ?? ""), dn.panel?.kind], ["good", true, true, "mine"], "U3: the asker's dock says the GM agreed and shows the action in progress");
    eq(dock(G, "p2", ["H2"], { newsSeen: dn.news.seen }).news, null, "U10: a line that was put away stays away");
  }
  if (T.top()) await T.gm({ op: "abort", inst: T.top().id });
  T.turn("N1");
  let s = staffDock(T, "N1", { armed: "slugfest", targets: ["H2"] });
  eq([s.who.name, s.onTurn, s.panel.pool.total, s.panel.chance.defended != null], ["Mauler", true, 9, true], "staff dock: the NPC's bar from the full state, with its numbers");
  eq((await T.gm(s.panel.submit.req)).ok, true, "the GM declares for the NPC through the same panel");
  d = dock(T, "p2", ["H2"]);
  eq([d.rest, d.prompts.map((p) => [p.kind, p.about, p.options.map((x) => x.id)])], [true, [["reaction", "Rex", ["block", "dodge", "pass"].filter((x) => d.prompts[0].options.some((q) => q.id === x))]]], "out of turn: the reaction question shows above a resting bar");
  ok(d.prompts[0].options.every((x) => x.note == null || !/\d|%/.test(x.note)) && !JSON.stringify(d.prompts[0].lines).includes("9"), "a player's reaction question carries no attacker numbers");
  eq([d.prompts[0].options.find((x) => x.id === "pass").label, /attack lands: /.test(d.prompts[0].options.find((x) => x.id === "pass").note ?? ""), d.prompts[0].lines.some((l) => /Mauler attacks Rex/.test(String(l)))], ["No reaction", true, true], "U11: the card names the attacker, says in words how likely the attack is to land, and calls a pass what the GM's card calls it");
  eq([d.waiting.length, d.prompts[0].aboutHead, d.turn], [0, false, ""], "U51 / U52: the card above the bar is the question: the line does not say 'waiting for: you' again, the card's head does not repeat the name on the bar, and nothing says whose turn it is");
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
  ok(d.slots.some((p) => p.state === "used"), "the cost shows on the slots");
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
  const fam = { "cost": ["full", "quick", "free", "none"], "band": M.BANDS.map((b) => b.id), "group": M.GROUPS, "pip": ["full", "quick"], "pip.tip": ["open", "used", "lost"], "slot.a": ["open", "openQuick", "used", "usedQuick", "lost"], "slot.b": ["open", "used", "lost"], "vital": ["health", "resolve", "of"],
    "stunt.tip": ["doubleDamage", "knockback", "stun", "bangHeads", "trap", "disarm", "deadlyHit", "slam", "suppressed", "trickShot", "special", "own"], "policy": ["block", "dodge", "onBroken", "ask", "always", "never", "ko", "kill", "crit"], "reveal": ["stats", "powers", "health"], "drift": ["restore", "difference", "leave"], "mode": ["tactical", "free"], "tab": ["now", "journal", "table"], "attr": ["fighting", "agility", "strength", "reason", "intuition", "presence"] };
  for (const [f, ids] of Object.entries(fam)) for (const id of ids) ok(`ITAC.ui.${f}.${id}` in EN && `ITAC.ui.${f}.${id}` in PL, `key built by template exists in both languages: ITAC.ui.${f}.${id}`);
}
for (const l of ["en", "pl"]) { // P5: the other actions (the list behind "More actions", the attribute a player names, a target that may be left out), the hazard tool, the karma notes, the new cards
  lang(l);
  const T = mk();
  let d = dock(T, "p1", ["H1"]);
  const more = act(d, "@more");
  eq([!!more, more?.more, act(d, "scan") ?? null, act(d, "breakFree") ?? null, act(d, "extinguish") ?? null, d.groups.find((g) => g.items.some((a) => a.id === "usePower"))?.id], [true, true, null, null, null, "power"], `${l} dock: the other rows wait behind one button; an escape is not offered to a free character; a power is in the powers group`);
  d = dock(T, "p1", ["H1"], { mode: "menu" });
  eq([d.panel.kind, ["pickUp", "scan", "banter", "useItem", "breakLift", "technology", "recoverResolve", "persuade", "saveBystanders"].every((id) => d.panel.rows.some((r) => r.id === id)), d.panel.rows.every((r) => r.label && r.notes.length && r.disabled === null), act(d, "@more").armed], ["menu", true, true, true], `${l} menu: every row with its cost; nothing greyed on the own turn`);
  noKeys(d, `${l} menu`);
  d = dock(T, "p1", ["H1"], { armed: "saveBystanders" });
  eq([d.panel.attrs.items.length, d.panel.attrs.items.some((x) => x.picked), d.panel.submit.req, typeof d.panel.submit.disabled, d.panel.pool, act(d, "@more").armed], [6, false, null, "string", null, true], `${l} an attribute of the player's choice must be named first`);
  d = dock(T, "p1", ["H1"], { armed: "saveBystanders", attr: "agility" });
  eq([d.panel.submit.req.decl.attr, d.panel.pool.parts.length, d.panel.attrs.items.find((x) => x.picked).id, d.panel.attrs.hint], ["agility", 1, "agility", null], `${l} the named attribute rides in the declaration and makes the pool`);
  d = dock(T, "p1", ["H1"], { armed: "useItem", text: " the fire hose " });
  eq([d.panel.submit.disabled, d.panel.submit.req.decl.attr ?? null, d.panel.submit.req.decl.text, typeof d.panel.attrs.hint, d.panel.text != null], [null, null, "the fire hose", "string", true], `${l} an item used without a roll: no attribute needed, the words ride along`);
  d = dock(T, "p1", ["H1"], { armed: "recoverResolve" });
  eq([typeof d.panel.self, d.panel.picking, d.panel.submit.disabled, d.panel.submit.req.decl.targets], ["string", false, null, []], `${l} a target that may be left out: the action is then about the actor`);
  d = dock(T, "p1", ["H1"], { armed: "banter", targets: ["N1"] });
  eq([d.panel.submit.req.decl.targets, d.panel.chance.defended ?? null], [["N1"], null], `${l} banter: the target rides along; the opponent's dice stay unknown to a player`);
  noKeys(d, `${l} banter`);
  eq(staffDock(T, "H1", { armed: "banter", targets: ["N1"] }).panel.chance.defended != null, true, `${l} staff see the chance against the resisting attribute`);
  /* a held character: the escape stands on the bar, marked */
  await T.gm({ op: "statusAdd", combatant: "H1", status: { id: "grappled", data: { by: "N1" } } });
  d = dock(T, "p1", ["H1"]);
  eq([act(d, "breakFree")?.urgent, act(d, "breakFree")?.disabled ?? null, d.groups.find((g) => g.id === "act").items[0].id], [true, null, "breakFree"], `${l} held: Break free is on the bar, first of its group`);
  await T.gm({ op: "statusRemove", combatant: "H1", id: "grappled" });
  /* a narrative action ends on a GM card that says what the dice say */
  eq((await T.req("p1", dock(T, "p1", ["H1"], { armed: "scan" }).panel.submit.req)).ok, true, `${l} scan declared through the panel's request`);
  await T.roll("roll", 2);
  let g = desk(T);
  const oc = g.cards.find((c) => c.kind === "outcome");
  eq([!!oc, oc?.options.map((o) => o.id), oc?.lines.length >= 2, oc?.free != null], [true, ["success", "fail"], true, true], `${l} desk: the outcome card with what the dice say and the sixes to spare`);
  noKeys(g, `${l} desk outcome`);
  eq((await T.gm(oc.options[0].req)).ok, true, `${l} answered through the card`);
  /* the hazard tool */
  const places = () => [{ zone: "z1", ids: ["H1", "N1"] }];
  const deskP = (own) => M.deskData(D.deskModel(T.state, T.log, ctx(T)), own, { ...facts(T, T.state, "gm", true), places }, t);
  g = deskP({ tab: "table" });
  eq([g.hazard.kind.value, g.hazard.kind.choices.length, g.hazard.run.req, typeof g.hazard.run.disabled, g.hazard.where.choices.map((x) => x.id), g.hazard.nums.map((n) => [n.id, n.value])], ["blast", 5, null, "string", ["z:z1", "c:H1", "c:H2", "c:N1"], [["rating", 4]]], `${l} hazard tool: an explosion by default, nothing runs before a place is chosen`);
  noKeys(g, `${l} desk table`);
  g = deskP({ hazard: { kind: "blast", where: "z:z1", rating: 6 } });
  eq(g.hazard.run.req, { op: "hazardRun", run: { type: "blast", rating: 6, zone: "z1", targets: ["H1", "N1"] }, subject: { zone: "z1" } }, `${l} hazard tool: an explosion on a zone names everybody there`);
  eq(deskP({ hazard: { kind: "fire", where: "c:H2", intensity: 99 } }).hazard.run.req, { op: "hazard", hazard: { kind: "fire", intensity: 12, inZone: false }, targets: ["H2"] }, `${l} hazard tool: fire on one character, the number kept in range`);
  eq([deskP({ hazard: { kind: "vacuum", where: "z:z1" } }).hazard.run.req, deskP({ hazard: { kind: "vacuum" } }).hazard.where.choices.length, deskP({ hazard: { kind: "disease", where: "c:H2", virulence: 2 } }).hazard.run.req], [null, 3, { op: "hazardRun", run: { type: "disease", virulence: 2, targets: ["H2"] }, subject: { combatant: "H2" } }], `${l} hazard tool: vacuum and disease are about one character`);
  eq((await T.gm(g.hazard.run.req)).ok, true, `${l} the explosion runs from the tool's request`);
  d = dock(T, "p1", ["H1"]);
  eq([d.prompts.some((p) => p.kind === "hazardDodge" && p.lines.length === 1 && p.options.length === 2)], [true], `${l} the hero is asked whether to dodge, in words`);
  noKeys(d, `${l} dock dodge`); noKeys(deskP({}), `${l} desk blast`);
  /* karma */
  g = deskP({ karma: { kind: "wreckedZone", who: "H1", note: " the bridge " } });
  eq([deskP({}).karma.add.req, g.karma.add.req], [null, { op: "karmaNote", note: { who: "H1", kind: "wreckedZone", note: "the bridge" } }], `${l} karma: a note needs a name; the request carries the kind and the words`);
  const before = deskP({}).karma.rows.length;
  eq((await T.gm(g.karma.add.req)).ok, true, `${l} karma note taken`);
  g = deskP({});
  eq([g.karma.rows.length - before, g.karma.rows.at(-1).who, g.karma.rows.at(-1).note], [1, "Atom Eve", "the bridge"], `${l} karma: the note is listed with who and what`);
  noKeys(g, `${l} desk karma`);
}
{ // P5: a round-point queue names what burns and who is hit; the spread card names zones
  lang("en");
  const f = { view: { ledger: {} }, c: (id) => ({ name: `name-${id}` }), zone: () => null };
  const q = M.askData({ id: "p1", kind: "triggerQueue", multi: true, data: { at: "roundStart" }, answerReq: (v) => ({ v }),
    options: [{ id: "a", label: "hazard", data: { type: "fireAttack", zone: "z2", intensity: 7, targets: ["H1"] } }, { id: "b", label: "hazard", data: { type: "fireAttack", combatant: "H2", intensity: 6, targets: ["H2"] } }, { id: "c", label: "hazard", data: { type: "fireSpread", zone: "z2" } }, { id: "d", label: "My own trigger", data: { type: "hazard" } }] }, { t, facts: f, desk: true, round: 2 });
  eq([/z2/.test(q.options[0].label) && /7/.test(q.options[0].label) && /name-H1/.test(q.options[0].label), /name-H2/.test(q.options[1].label), /z2/.test(q.options[2].label), q.options[3].label], [true, true, true, "My own trigger"], "queue: the lines of the hazards are written out; a registered trigger keeps its own name");
  const s = M.askData({ id: "p2", kind: "fireSpread", data: { from: "z1", pick: "z2", intensity: 6 }, answerReq: (v) => ({ v }), options: [{ id: "z:z2", label: "z2", data: { zone: "z2", rolled: 1 }, req: { r: 1 } }, { id: "z:z3", label: "z3", data: { zone: "z3" }, req: { r: 2 } }, { id: "none", label: "ITAC.opt.noSpread", req: { r: 3 } }] }, { t, facts: f, desk: true });
  eq([s.options.map((o) => !!o.req && !o.zones), s.options[0].label !== s.options[1].label.replace("z3", "z2"), s.lines.length], [[true, true, true], true, 1], "spread card: plain answers, the zone the die picked is marked");
  eq([...missing], [], "P5: every key the model asks for without a fallback exists");
}
{ // U1 layout pass: the words kept in the model, the quiet turn line, the veto that asks twice, the zone beside the name
  lang("en");
  eq(["ITAC.ui.turn.notYours", "ITAC.ui.sure.veto", "ITAC.ui.here", "ITAC.ui.here.of", "ITAC.ui.legend"].every((k) => typeof EN[k] === "string" && typeof PL[k] === "string"), true, "U1 words: the layout's own words are in the language file, in both languages (the wrapper is gone)");
  const T = new Table();
  T.hero("H1", "p1", { name: "Atom Eve" }).npc("N1", { name: "Mauler", attrs: { fighting: 9, agility: 8 } }).npc("N2", { name: "Zzyxq", hidden: true, attrs: { fighting: 11 } });
  T.order(["H1", "N1", "N2"]).turn("N2");
  const tw = t; lang("pl");
  const view = viewOf(T, "p1", ["H1"]);
  const hid = M.dockData(D.playerModel(view, { id: "p1", owns: ["H1"] }, ctx(T)), {}, { ...facts(T, view, "p1"), where: (id) => (id === "H1" ? "z5" : null) }, tw);
  eq([hid.turn, /Zzyxq/.test(JSON.stringify(hid))], ["Nie twoja tura", false], "U15: a concealed combatant's turn still says it is not the player's, and names nobody");
  eq([/5/.test(hid.who?.zone?.label ?? ""), hid.who?.zone?.tip === PL["ITAC.ui.legend"], hid.who?.zone?.say === `Jesteś w: ${hid.who?.zone?.label}`], [true, true, true], "U8 / U51: the own zone stands beside the name; its tip is the legend alone (the chip already names the zone), the whole sentence is for a screen reader");
  lang("en");
  eq(dock(T, "p1", ["H1"]).who?.zone ?? null, null, "U8: no zone fact, no chip");
  T.turn("H1");
  eq((await T.req("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1"] } })).ok, true, "U20: an action is declared");
  const i0 = desk(T).stack[0], cmd = (g) => g.stack[0].commands.find((c) => c.id === "veto");
  eq([cmd(desk(T)).confirm, cmd(desk(T)).armed, cmd(desk(T, { sure: `${T.top().id}:veto` })).armed, cmd(desk(T, { sure: `${T.top().id}:veto` })).label === cmd(desk(T)).label, !!i0], [true, false, true, false, true], "U20: veto asks twice: the armed command reads as a question");
}
for (const l of ["en", "pl"]) { // U28 - U31, U23, U4: the compact dock: slots, pictures, tooltips, the cost preview, the grouped lists, the override's end buttons
  lang(l);
  const T = mk();
  const VIT = { H1: { health: 4, maxHealth: 6, resolve: 3, maxResolve: 5 } };
  const fx = (view, me, staff = false) => ({ ...facts(T, view, me, staff), vitals: (id) => VIT[id] ?? null });
  const dk = (uid, owns, own = {}) => { const view = viewOf(T, uid, owns); return M.dockData(D.playerModel(view, { id: uid, owns }, ctx(T)), own, fx(view, uid), t); };
  let d = dk("p1", ["H1"]);
  eq([d.vitals.map((v) => [v.id, v.v, v.max]), d.vitals.every((v) => v.label && v.say.includes(String(v.max)))], [[["health", 4, 6], ["resolve", 3, 5]], true], `${l} U29: Health and Resolve of the driven character, with their words`);
  eq(dock(T, "p1", ["H1"]).vitals, [], `${l} U29: no fact, no bars`);
  eq(dk("p2", ["H2"]).vitals, [], `${l} U30: a character whose numbers the caller does not give shows none`);
  const items = d.groups.flatMap((g) => g.items);
  ok(items.every((a) => a.icon && a.tip && typeof a.tip.title === "string" && a.tip.title.length), `${l} U29: every button of the bar has a picture and a tooltip with its name`);
  ok(items.filter((a) => !a.more).every((a) => (a.cost === "full" || a.cost === "quick" ? !!a.tip.cost : true)), `${l} U29: the tooltip says the price in words`);
  eq([act(d, "slugfest").pv, act(d, "move").pv, act(d, "@more").pv ?? null], [{ slot: "a", forfeits: false, stress: 0 }, { slot: "b", forfeits: false, stress: 0 }, null], `${l} U30: a full action previews the big slot, a quick one the quick slot, a list nothing`);
  eq([d.hotbar.open, dk("p1", ["H1"], { hotbar: true }).hotbar.open, d.hotbar.label !== dk("p1", ["H1"], { hotbar: true }).hotbar.label], [false, true, true], `${l} U28: the macro bar is folded by default; the button says what it will do`);
  eq([d.other.tip.title.length > 0, d.holdOff.tip.title.length > 0], [true, true], `${l} U29: the tail buttons carry tooltips`);
  /* the slots follow the ledger */
  eq((await T.req("p1", { op: "mark", actor: "H1", unit: "quick", on: true })).ok, true, `${l} a quick action marked`);
  d = dk("p1", ["H1"]);
  eq([d.slots.map((p) => [p.key, p.state]), act(d, "move").pv, act(d, "move").tip.lines.length], [[["a", "open"], ["b", "used"]], { slot: "a", forfeits: true, stress: 0 }, 1], `${l} U31 / U30: the quick slot is spent; a second quick action would take the big slot, and says so`);
  eq((await T.req("p1", { op: "mark", actor: "H1", unit: "quick", on: true })).ok, true, `${l} a second quick action marked`);
  d = dk("p1", ["H1"]);
  eq([d.slots.map((p) => [p.key, p.state, p.as]), d.slots[0].req, act(d, "slugfest").pv, typeof act(d, "slugfest").tip.note], [[["a", "used", "quick"], ["b", "used", "quick"]], { op: "mark", actor: "H1", unit: "quick", on: false }, null, "string"], `${l} U31: two quick actions fill both slots (never a third mark); a greyed action previews nothing and says why`);
  eq((await T.req("p1", d.slots[0].req)).ok, true, `${l} the hand-made mark on the big slot is taken back through its own request`);
  eq((await T.req("p1", dk("p1", ["H1"]).slots[1].req)).ok, true, `${l} and the one on the quick slot`);
  eq(dk("p1", ["H1"]).slots.map((p) => p.state), ["open", "open"], `${l} both slots are free again`);
  /* U23: the list behind More actions: rows with a picture, the unit and a tooltip */
  d = dk("p1", ["H1"], { mode: "menu" });
  eq([d.panel.list, d.panel.groups.length, d.panel.groups[0].rows.length === d.panel.rows.length, d.panel.rows.every((r) => r.icon && !r.tip.title && r.tip.cost && !r.tip.cost.includes(r.label) && (r.cost === "full" || r.cost === "quick") && r.pv)], ["menu", 1, true, true], `${l} U23 / U51: More actions is one list of rows, each with its picture, its unit and its preview; the tooltip says the price in words and does not repeat the name the row shows`);
  /* U23: the stunt card */
  eq((await T.req("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1"] } })).ok, true, `${l} an attack is declared`);
  const g = desk(T, { override: T.top().id });
  const ovr = g.stack[0].override, end = ovr.filter((c) => c.group === "end");
  eq([end.map((c) => [c.id, c.confirm, c.armed, !!c.icon]), ovr.filter((c) => c.type !== "button").some((c) => c.confirm), ovr.filter((c) => c.type === "button").every((c) => c.confirm && c.icon)], [[["abortRefund", true, false, true], ["abortSpent", true, false, true], ["manual", true, false, true]], false, true], `${l} U4: the buttons of the override (skip, the three ways to end the action) are pictures that ask twice; the numbers and choices do not`);
  eq(desk(T, { override: T.top().id, sure: `${T.top().id}:abortSpent` }).stack[0].override.filter((c) => c.armed).map((c) => c.id), ["abortSpent"], `${l} U4: only the one clicked is armed`);
  noKeys(dk("p1", ["H1"], { mode: "kit" }), `${l} compact dock`);
  { // U9: the bar of one who is out says why, and End turn does not ask twice
    const W = mk(); W.state.statuses = { ...(W.state.statuses ?? {}), H1: [{ id: "unconscious" }] };
    const o = dock(W, "p1", ["H1"]);
    eq([o.out?.reason, typeof o.out?.text, o.groups.flatMap((g) => g.items).filter((a) => !a.more).length, o.end.confirm, dock(W, "p1", ["H1"], { endArmed: true }).end.armed, dock(mk(), "p1", ["H1"]).out], ["unconscious", "string", 0, false, false, null], `${l} U9: out of action: the reason stands where the actions were, End turn is one click`);
  }
  eq((await T.gm(end[0].req)).ok, true, `${l} aborted with a refund through the override's request`);
}
{ // U23: the stunts of a card stand in groups and say what they do (askData on a stunts prompt)
  lang("en");
  const mkP = (options) => ({ id: "p", kind: "stunts", about: "H1", to: { combatant: "H1" }, n: 2, max: 2, options });
  const o = (id, data, more = {}) => ({ id, label: `ITAC.stunt.${data.stunt}`, data, ...more });
  const T = mk(), view = viewOf(T, "p1", ["H1"]);
  const a = M.askData(mkP([o("s1", { stunt: "doubleDamage" }), o("s2", { stunt: "bangHeads", extra: "H2" }), o("s3", { stunt: "stun", onExtra: true, target: "H2" })]), { t, facts: facts(T, view, "p1"), own: {} });
  eq(a.options.map((x) => [x.icon, x.group?.id, typeof x.tip?.lines?.[0], x.tip?.title ?? null]), [["stunt:doubleDamage", "main", "string", null], ["stunt:bangHeads", "more", "string", null], ["stunt:stun", "on:H2", "string", null]], "U23 / U51: a stunt has its picture, its group (the target, another opponent, on that opponent) and what it does; the tooltip does not repeat its name");
  eq([a.options[1].group.label.length > 0, /Rex/.test(a.options[2].group.label), a.pvFor], [true, true, null], "U23: the groups are captioned; no preview without the asked character's own bar");
}
/* ------------------------------------------------------------------ U5: the keyboard, and the rows closed with it */
for (const l of ["en", "pl"]) {
  lang(l);
  { // U41: digits reach the bar, then the open list, then the first card; every key is a click on a control of the render data
    const T = mk();
    let d = dock(T, "p1", ["H1"]);
    const flat = d.groups.flatMap((g) => g.items);
    const plainK = flat.filter((a) => !a.more).map((a) => a.key ?? null), listK = flat.filter((a) => a.more).map((a) => a.key);
    eq([plainK.slice(0, 10 - listK.length), plainK.slice(10 - listK.length).some(Boolean), listK, flat[0].tip.key, d.keys.on], [Keys.DIGITS.slice(0, Math.min(10 - listK.length, plainK.length)), false, Keys.DIGITS.slice(10 - listK.length), "1", true], `${l} U41: the actions of the bar are numbered from 1 in the order they stand, the lists keep the last digits; the tooltip says the key`);
    { const big = { show: true, groups: [{ items: [...Array.from({ length: 12 }, (_, i) => ({ id: `a${i}` })), { id: "@more", more: true }, { id: "@kit", more: true, mode: "kit" }] }] }, L = Keys.layer(big);
      eq([L.keys.length, L.keys.find((k) => k.fk === "more:kit").key, L.keys.find((k) => k.fk === "more:menu").key, L.keys.find((k) => k.fk === "act:a7").key, L.keys.some((k) => k.fk === "act:a8")], [10, "0", "9", "8", false], `${l} U41: a long bar: eight actions, then More actions on 9 and Abilities on 0`); }
    eq([Keys.plan(d, {}, { key: "1" }), Keys.plan(d, {}, { key: " " }), Keys.plan(d, {}, { key: "Enter" }), Keys.plan(d, {}, { key: "Tab" }), Keys.plan(d, {}, { key: "Escape" }), Keys.plan(d, {}, { key: "a" })],
      [{ click: `act:${flat[0].id}` }, { click: "end" }, null, null, null, null], `${l} U41: a digit clicks that action, Space clicks End turn; Enter, Tab and Escape have nothing to act on yet`);
    eq([Keys.plan(d, { hotbar: true }, { key: "1" }), dock(T, "p1", ["H1"], { hotbar: true }).groups[0].items[0].key ?? null, Keys.plan(d, { hotbar: true }, { key: " " })], [null, null, { click: "end" }], `${l} U41: while the macro bar shows the digits are its own; Space still ends the turn`);
    eq(Keys.plan(dock(T, "p1", ["H1"], { endArmed: true }), { endArmed: true }, { key: "Enter" }), { click: "end" }, `${l} U41: Enter confirms the armed End turn`);
    eq([Keys.plan(d, {}, { key: " ", walking: true }), Keys.plan(d, {}, { key: "1", walking: true })], [null, { click: `act:${flat[0].id}` }], `${l} U41: a focus walked by Tab keeps Space for the focused button; digits still act`);
    const own = { armed: "slugfest" };
    d = dock(T, "p1", ["H1"], own);
    eq([Keys.plan(d, own, { key: "Tab" }), Keys.plan(d, own, { key: "Tab", shift: true }), Keys.plan(d, own, { key: "Enter" }), Keys.plan(d, own, { key: "Escape" })], [{ target: "N1" }, { target: "H2" }, null, { set: { armed: null, mode: null, amend: null } }], `${l} U41: Tab walks the targets in the order of the panel (Shift: backwards); Enter waits for a target; Escape puts the action away`);
    const own2 = { armed: "slugfest", targets: ["N1"] };
    d = dock(T, "p1", ["H1"], own2);
    eq([Keys.plan(d, own2, { key: "Tab" }), Keys.plan(d, own2, { key: "Enter" }), d.panel.submit.req != null], [{ target: "H2" }, { click: "go" }, true], `${l} U41: Tab goes on from the picked target; Enter is Declare`);
    const ownM = { mode: "menu" };
    d = dock(T, "p1", ["H1"], ownM);
    eq([d.panel.rows[0].key, d.panel.groups[0].rows[0].key, d.groups.flatMap((g) => g.items).some((a) => a.key), Keys.plan(d, ownM, { key: "1" })], ["1", "1", false, { click: `menu:${d.panel.rows[0].id}` }], `${l} U41: with a list open the digits are its rows, not the bar's buttons`);
    eq(Keys.plan(dock(T, "p2", ["H2"]), {}, { key: " " }), null, `${l} U41: Space does nothing for somebody whose turn it is not`);
    /* a card: a digit only chooses, Enter sends; a stunt card ticks and Enter is its Confirm */
    await T.req("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["H2"] } });
    d = dock(T, "p2", ["H2"]);
    const card = d.prompts[0], first = card.options.filter((o) => !o.disabled)[0], fk = `opt:${card.id}:${first.id}`;
    eq([card.kind, first.key, Keys.plan(d, {}, { key: "1" }), Keys.plan(d, {}, { key: "Enter" }), Keys.plan(d, {}, { key: "Tab" })], ["reaction", "1", { set: { kopt: fk } }, null, { set: { kopt: fk } }], `${l} U41: on a reaction card a digit (or Tab) only chooses the answer; Enter alone sends nothing`);
    const dk2 = dock(T, "p2", ["H2"], { kopt: fk });
    eq([Keys.plan(dk2, { kopt: fk }, { key: "Enter" }), dk2.keys.chosen, Keys.plan(dk2, { kopt: fk }, { key: "Escape" }), Keys.plan(dk2, { kopt: "opt:gone:x" }, { key: "Enter" })], [{ click: fk }, fk, { set: { kopt: null } }, null], `${l} U41: Enter sends the chosen answer, Escape puts the choice away, a choice of a card that is gone sends nothing`);
    await T.answer("p2", "reaction", "pass"); await T.roll("attack", 3); await T.roll("def:H2", 0);
    d = dock(T, "p1", ["H1"]);
    if (d.prompts[0]?.kind === "stunts") {
      const c2 = d.prompts[0], o1 = c2.options.filter((o) => !o.disabled)[0];
      eq([Keys.plan(d, {}, { key: "1" }), Keys.plan(d, {}, { key: "Enter" })], [{ click: `opt:${c2.id}:${o1.id}` }, { click: `submit:${c2.id}` }], `${l} U41: on a stunt card a digit ticks, Enter is its Confirm`);
      /* U46: the panel of the own action does not say "waiting for the others" to the one the table waits for */
      eq([d.panel.kind, d.panel.status === t("ITAC.ui.mine.declared"), d.panel.status === t("ITAC.ui.mine.open"), d.waiting.some((w) => w.mine), c2.aboutHead, dock(T, "p2", ["H2"]).panel ?? null], ["mine", true, false, false, false, null], `${l} U46 / U51: with a question of their own open (the card above), the panel says only that the action is declared, and the line does not list the question again`);
    } else ok(false, `${l} U41 / U46: the stunt card did not come up (${d.prompts[0]?.kind})`);
    noKeys(d, `${l} keys`);
  }
  { // U45: Health 0 with no mark yet is out of action on the bar, as it is for the engine
    const W = mk(); W.c.H1.health = 0;
    const o = dock(W, "p1", ["H1"]), ids = o.groups.flatMap((g) => g.items).filter((a) => !a.more).map((a) => a.id);
    eq([o.out?.reason, typeof o.out?.text, ids, o.end.confirm], ["broken", "string", ["rally"], false], `${l} U45: at 0 Health without the status the bar says broken and offers only getting up`);
    const N = mk().turn("N1"); N.c.N1.health = 0;
    const s = staffDock(N, "N1");
    eq([s.out?.reason, s.groups.flatMap((g) => g.items).filter((a) => !a.more).map((a) => a.id)], ["broken", ["rally"]], `${l} U45: the same for an NPC in the GM's hands`);
    eq(D.outOf({ statuses: {} }, "V1", { kind: "vehicle", health: 0 }), null, `${l} U45: a machine has no such state`);
    W.c.H1.crits = [9];
    eq(D.outOf(W.state, "H1", W.c.H1)?.canRally, false, `${l} U45: an injury of 9 or worse leaves nothing to do`);
  }
  { // U22: the held one: Move is greyed with the engine's word, the status says who holds
    const T = mk();
    await T.gm({ op: "statusAdd", combatant: "H1", status: { id: "grappled", data: { by: "N1" } } });
    let d = dock(T, "p1", ["H1"]);
    const held = d.extras.find((x) => x.kind === "status");
    eq([act(d, "move").disabled === M.reasonText(t, "held"), act(d, "slugfest").disabled === M.reasonText(t, "held"), act(d, "breakFree").disabled ?? null, /Mauler/.test(held?.tip ?? ""), act(d, "breakFree").tip.lines.includes(t("ITAC.ui.urgent")), act(d, "move").tip.lines.includes(t("ITAC.ui.urgent"))],
      [true, true, null, true, true, false], `${l} U22: held: Move and the attacks are greyed with the reason, Break free is not; the status names the holder; the red mark is explained in its tooltip`);
    T.c.N1.hidden = true;
    d = dock(T, "p1", ["H1"]);
    eq([/Mauler/.test(JSON.stringify(d.extras)), d.extras.find((x) => x.kind === "status")?.tip.includes(t("ITAC.Someone"))], [false, true], `${l} U22: a holder the player is not shown is "somebody"`);
  }
  { // U18 / U19: the queue is a list of tick boxes; the standing answer says when to tick it
    const T = mk(), view = viewOf(T, "p1", ["H1"]);
    const q = M.askData({ id: "q", kind: "triggerQueue", about: null, data: { at: "roundStart" }, multi: true, options: [{ id: "a", label: "x" }, { id: "b", label: "y" }], answerReq: (v) => ({ op: "answer", prompt: "q", value: v }) }, { t, facts: facts(T, T.state, "gm", true), own: { picks: { q: ["a"] } }, desk: true });
    eq([q.check, q.options.map((o) => o.picked)], [true, [true, false]], `${l} U18: a round-point queue is marked as a list of tick boxes`);
    const r = M.askData({ id: "r", kind: "reaction", about: "N1", aboutName: "Mauler #2", always: ["block"], data: {}, options: [{ id: "pass", label: "ITAC.opt.pass", req: {} }], answerReq: (v) => ({ op: "answer", prompt: "r", value: v }) }, { t, facts: facts(T, T.state, "gm", true), own: {}, desk: true });
    eq([r.check, r.aboutId, /Mauler #2/.test(r.always.label), /Mauler #2/.test(r.always.tip), r.always.tip !== r.always.label], [false, "N1", true, true, true], `${l} U19: the card knows whom it is about (the map shows it) and the standing answer says it is ticked before answering`);
    void view;
  }
}
/* ------------------------------------------------------------------ U6: each fact once (U49 - U52) */
for (const l of ["en", "pl"]) {
  lang(l);
  { // U52: nobody is told whose turn it is in words (the initiative bar says it); the roll of the own action lives in its panel
    const T = mk();
    eq([dock(T, "p1", ["H1"]).turn, dock(T, "p2", ["H2"]).turn, staffDock(T, "H1").turn, desk(T).turn], ["", "", "", ""], `${l} U52: no surface says whose turn it is in words: not the player on turn, not the one waiting, not the GM's dock, not the desk`);
    await T.req("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1"] } });
    for (const p of Object.values(T.state.prompts ?? {})) if (p.kind === "reaction") await T.gm({ op: "answer", prompt: p.id, value: "pass" });
    let d = dock(T, "p1", ["H1"]);
    const r0 = d.panel?.rolls?.[0];
    eq([d.panel?.kind, d.panel?.rolls?.length, r0?.state, r0?.buttons.map((b) => b.id), d.rolls.length, d.panel?.status, d.waiting.some((w) => w.mine)], ["mine", 1, "owed", ["roll"], 0, null, false],
      `${l} U52: the roll the own action owes stands in its panel with its button; no chip for it in the line, no sentence about it, no 'waiting for: you'`);
    eq([d.panel.targets.map((x) => [x.id, x.name, "img" in x]), Keys.plan(d, {}, { key: "Enter" })], [[["N1", "Mauler", true]], { click: `rb:${r0.id}:roll` }], `${l} U52: the target stands with its picture slot; Enter still throws the roll`);
    /* a result that may be pushed: Accept and Push in the panel, Enter accepts */
    const view = viewOf(T, "p1", ["H1"]), pm = D.playerModel(view, { id: "p1", owns: ["H1"] }, ctx(T));
    const pushed = { ...pm, rolls: pm.rolls.map((r) => ({ ...r, state: "push", sixes: 2, messageId: "m1" })), waiting: pm.waiting.map((w) => ({ ...w, what: "push" })) };
    d = M.dockData(pushed, {}, facts(T, view, "p1"), t);
    eq([d.panel.rolls.map((r) => [r.state, r.buttons.map((b) => b.id), /2/.test(r.text)]), d.rolls, d.panel.status, d.waiting.some((w) => w.mine), Keys.plan(d, {}, { key: "Enter" })], [[["push", ["accept", "push"], true]], [], null, false, { click: `rb:${d.panel.rolls[0].id}:accept` }],
      `${l} U52: a result that may be pushed: the sixes with Accept and Push in the panel, said once; Enter accepts`);
    /* with another action armed the panel is that action's: the roll then keeps its chip in the line (its only place) */
    d = M.dockData(pushed, { mode: "other" }, facts(T, view, "p1"), t);
    eq([d.panel.kind, d.rolls.length], ["other", 1], `${l} U52: while another panel is open the roll keeps its chip in the line`);
    /* a defence rolled inside somebody else's action has no panel of its own: its chip stays */
    const other = { ...pushed, mine: [] };
    eq([M.dockData(other, {}, facts(T, view, "p1"), t).rolls.length, M.dockData(other, {}, facts(T, view, "p1"), t).panel ?? null], [1, null], `${l} U52: a roll in somebody else's action keeps its chip`);
    /* the picture of a target: only of somebody the viewer's view holds */
    const withImg = { ...facts(T, view, "p1"), c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc, img: `${id}.png` } : null) };
    eq(M.dockData(pm, {}, withImg, t).panel.targets[0].img, "N1.png", `${l} U52: the target's picture is the one of the roster`);
    const blind = { ...withImg, view: { ...view, ledger: Object.fromEntries(Object.entries(view.ledger).filter(([id]) => id !== "N1")) } };
    eq(M.dockData(pm, {}, blind, t).panel.targets[0].img, null, `${l} U52: a target the viewer's view does not hold gets no picture`);
    await T.gm({ op: "abort", inst: T.top().id });
  }
  { // U49 / U50 / U51: the abilities list: one entry per power, a mark and a plain sentence for what takes no action, tooltips without the name
    const T = mk(), view = viewOf(T, "p1", ["H1"]), pm = D.playerModel(view, { id: "p1", owns: ["H1"] }, ctx(T));
    const base = pm.bars[0].actions.find((a) => a.id === "slugfest");
    const k = (id, item, name, label, cost, stress, cat = "power", state = "auto") => ({ ...base, id, flow: "act", tags: ["kit"], kind: "kit", needsTarget: false, optTarget: false, attr: null, attrs: null, cost, stress, name, label: `ITAC.kit.act.${label}`, kit: { item, cat, state } });
    const acts = [k("k1", "dup", "Duplication", "zzMake", "full", 1), k("k2", "sum", "Summoning", "zzCall", "full", 0), k("k3", "dup", "Duplication: Absorb the copies", "use", "quick", 0, "power", "assist"), k("k4", "life", "Life Support", "use", "none", 1, "power", "assist"),
      k("k5", "dup", "Duplication", "zzActs", "none", 0), k("k6", "hh", "Hard Hitter", "zzWind", "quick", 0, "talent")];
    const bar = { ...pm.bars[0], actions: [...pm.bars[0].actions, ...acts], kitRows: [{ item: "dup", name: "Duplication", key: "duplication", state: "auto" }, { item: "rd", name: "Restorative Duplication", of: "Duplication", key: "restorativeduplication", state: "auto" }, { item: "sum", name: "Summoning", key: "summoning", state: "auto" }, { item: "life", name: "Life Support", key: "lifesupport", state: "assist" }, { item: "hh", name: "Hard Hitter", key: "hardhitter", state: "auto" }, { item: "an", name: "Analysis", key: "analysis", state: "hand" }] };
    const d = M.dockData({ ...pm, bars: [bar] }, { mode: "kit" }, facts(T, view, "p1"), t), g = d.panel.groups.find((x) => x.id === "power"), dup = g.entries.find((e) => e.name === "Duplication");
    eq([g.entries.map((e) => [e.name, e.head, e.rows.map((r) => r.id)]).slice(0, 3), g.rows.map((r) => r.id).slice(0, 5), g.entries.slice(3).every((e) => !e.head && e.rows.length === 1)], [[["Duplication", true, ["k1", "k3", "k5"]], ["Summoning", false, ["k2"]], ["Life Support", false, ["k4"]]], ["k1", "k3", "k5", "k2", "k4"], true],
      `${l} U49: the uses of one power stand together under one entry (in the order the powers first appear); a power with one use has no head`);
    eq([dup.rows.map((r) => [r.of, r.use]), dup.rows.every((r) => !r.use.includes("Duplication")), g.entries[2].rows[0].use, d.panel.groups.find((x) => x.id === "talent").entries[0].rows[0].use != null], [[["Duplication", "zzMake"], ["Duplication", "Absorb the copies"], ["Duplication", "zzActs"]], true, null, true],
      `${l} U49: a row under a power carries only the use, never the power's name again; a plain use of an item is the item alone`);
    eq([d.panel.rows.map((r) => r.id).filter((id) => id.length === 2 && id[0] === "k"), d.panel.rows.map((r) => r.key), dup.rows.map((r) => r.key), Keys.plan(d, { mode: "kit" }, { key: "2" }), d.panel.groups.flatMap((x) => x.entries.flatMap((e) => e.rows.map((r) => r.id))).join() === d.panel.rows.map((r) => r.id).join()], [["k1", "k3", "k5", "k2", "k4", "k6"], Keys.DIGITS.slice(0, d.panel.rows.length), ["1", "2", "3"], { click: "menu:k3" }, true],
      `${l} U49 / U41: the digits run down the list as it is drawn, entry by entry, and the rows of an entry carry them`);
    eq([M.kitCols([{ rows: [1, 2, 3] }, { rows: [1] }, { rows: [1] }, { rows: [1, 2] }, { rows: [1] }]), M.kitCols([{ rows: Array(9).fill(1) }, { rows: [1] }]), M.kitCols([])], [[[0, 1, 2], [3, 4]], [[0], [1]], []], `${l} U49: the columns never cut an entry in two (${M.KIT_LINES} lines a column; a longer entry stands alone)`);
    const free1 = d.panel.rows.find((r) => r.id === "k4"), free0 = d.panel.rows.find((r) => r.id === "k5"), paid = d.panel.rows.find((r) => r.id === "k1");
    eq([free1.tip.cost === t("ITAC.ui.free.costs", { n: 1 }), free0.tip.cost === t("ITAC.ui.free.only"), /1/.test(free1.tip.cost), free1.tip.cost !== free0.tip.cost, paid.tip.cost.includes(M.costText(t, "full"))], [true, true, true, true, true],
      `${l} U50: what takes no action says so in a sentence, with what it still costs; a full action is named with its price`);
    eq([d.panel.rows.every((r) => !r.tip.title), free1.tip.lines, paid.tip.lines], [true, [t("ITAC.kit.fx.lifesupport")], [t("ITAC.kit.fx.duplication"), `Restorative Duplication: ${t("ITAC.kit.fx.restorativeduplication")}`]], `${l} U51 / U67: a row's tooltip does not repeat its name; it says what the entry does, then what its boosts and limits change`);
    const states = ["auto", "assist", "hand", "off"].map((x) => t(`ITAC.kit.state.${x}`)), jargon = /engine|by hand|GM confirms|silnik|ręczn|MG potwierdza|potwierdza MG|automat/i, said = (x) => JSON.stringify([x.panel.rows.map((r) => [r.label, r.notes, r.tip]), x.panel.foot]);
    eq([d.panel.rows.every((r) => r.state === undefined && r.stateText === undefined), states.some((x) => said(d).includes(x)), jargon.test(said(d)), d.panel.foot.length === 1 && d.panel.foot[0].includes("Analysis")], [true, false, false, true],
      `${l} U67: a player's abilities list carries no mark and no word of how an entry is run (the engine, the GM confirms, by hand); what has no button is only named`);
    const ds = M.dockData({ ...pm, bars: [bar] }, { mode: "kit" }, { ...facts(T, view, "p1"), staff: true }, t);
    eq([ds.panel.rows.find((r) => r.id === "k4").state, ds.panel.rows.find((r) => r.id === "k4").notes.includes(t("ITAC.kit.state.assist")), ds.panel.rows.find((r) => r.id === "k4").tip.lines], ["assist", true, [t("ITAC.kit.fx.lifesupport")]], `${l} U67: the GM's own dock keeps the small mark of how an entry is run (and its word for a screen reader); the tooltip is the same`);
    eq([M.priceWords(t, "none", 0), M.priceWords(t, "free", 2) === t("ITAC.ui.free.costs", { n: 2 }), M.priceWords(t, "quick", 0)], [t("ITAC.ui.free.only"), true, M.costText(t, "quick")], `${l} U50: the words of a price`);
    const bd = M.dockData({ ...pm, bars: [{ ...bar, actions: [...pm.bars[0].actions, { ...base, id: "zf", flow: "act", situational: true, needsTarget: false, cost: "none", stress: 0, label: "ITAC.action.shakeOff" }] }] }, {}, facts(T, view, "p1"), t);
    eq(act(bd, "zf")?.tip.cost, t("ITAC.ui.free.only"), `${l} U50: a button of the bar that takes no action says the same sentence`);
  }
}
{ // U19: namesakes are numbered, the hidden ones last, so a player's numbers are the GM's and show no gap
  const all = [{ id: "a", name: "Soldier", hidden: true }, { id: "b", name: "Soldier" }, { id: "c", name: "Rex" }, { id: "d", name: "Soldier" }];
  eq(V.distinctNames(all), { b: "Soldier #1", d: "Soldier #2", a: "Soldier #3", c: "Rex" }, "U19: two of a name get a number; the hidden one counts last; a single name stays as it is");
  eq(V.distinctNames(all.filter((x) => !x.hidden)), { b: "Soldier #1", d: "Soldier #2", c: "Rex" }, "U19: the visible ones read the same without the hidden one");
  eq(V.distinctNames([]), {}, "U19: nobody, nothing");
}
done("check-ui");
