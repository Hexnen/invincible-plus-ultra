// node scripts/tactics/check-fxi.mjs -- fixer I after the film take (U95): D119 (an area shot's stunt card whose every pick is refused),
// D120 (an owed roll that waits on somebody noticing it), U128 (the token HUD from the map menu acts on the token it was opened for),
// U129, U130 (the summary of an ended fight never stands over the next one), U131 (Warning Call only for one's own side), U125 (c) the
// dice of Warning Call named on the roll card, (d) the guardian's hit said to the table in words.
// What can be held without Foundry; the live look is in dev/combat-handoff.md.
import { readFileSync } from "node:fs";
import { Table, ok, eq, done } from "./testkit.mjs";
import * as KP from "./kit-pure.mjs";
import * as MP from "./ui/model-pure.mjs";
import { tIn } from "./lang.mjs";

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

/* ---- U125 (d): the old target reads in words that a guardian took the hit (the news line of the player, the journal) */
{
  const guard = () => { const T = new Table(); T.hero("H1", "p1", { name: "Kid" }).hero("H2", "p2", { name: "Omni" }).npc("N1", { name: "Soldier", health: 6 }).npc("N2", { health: 6 }); give(T, "H1", "Guardian"); T.order(["N1", "H1", "H2", "N2"]); return T; };
  const lastNews = (T) => (T.state.news ?? []).filter((n) => n.kind === "action").at(-1) ?? null;
  const facts = (T) => ({ c: (id) => T.c[id] ?? null, staff: false });
  const T = guard();
  eq(code(await T.gm(decl("N1", "slugfest", ["H2"]))), "ok", "U125d: the Soldier attacks Omni");
  await T.req("p1", { op: "answer", prompt: T.prompt("reaction", "H1").id, value: rid(T, "H1", "guardian") });
  await T.roll("sw:H1", 1);
  for (const p of T.prompts("reaction")) await T.req(p.to === "gm" ? "gm" : p.to.users[0], { op: p.to === "gm" ? "answerFor" : "answer", prompt: p.id, value: "pass" });
  await T.roll("attack", 1);
  for (const sp of T.prompts("stunts")) await T.gm({ op: "answerFor", prompt: sp.id, value: [] });
  const n = lastNews(T);
  eq((n?.reacts ?? []).map((r) => [r.who, r.result, r.about]), [["H1", "took", "H2"]], "U125d: the news says Kid took the hit meant for Omni");
  const text = MP.newsData({ news: T.state.news, round: T.state.round, knowledge: { H2: {} } }, {}, facts(T), (k, p = {}, f) => tIn("en", k, p, f))?.text ?? "";
  ok(/Kid: .*takes the hit for Omni/.test(text), `U125d: Omni's player reads it in words (${text})`);
  const pl = MP.newsData({ news: T.state.news, round: T.state.round, knowledge: { H2: {} } }, {}, facts(T), (k, p = {}, f) => tIn("pl", k, p, f))?.text ?? "";
  ok(/przyjmuje cios za: Omni/.test(pl), `U125d: ... and in Polish (${pl})`);
  ok(T.log.list.some((tx) => /ITAC\.journal\.react\.took/.test(JSON.stringify(tx.label))), "U125d: the journal line carries it too");
  const U = guard();
  await U.gm(decl("N1", "slugfest", ["H2"]));
  await U.req("p1", { op: "answer", prompt: U.prompt("reaction", "H1").id, value: rid(U, "H1", "guardian") });
  await U.roll("sw:H1", 0);
  for (const p of U.prompts("reaction")) await U.req(p.to === "gm" ? "gm" : p.to.users[0], { op: p.to === "gm" ? "answerFor" : "answer", prompt: p.id, value: "pass" });
  await U.roll("attack", 1);
  for (const sp of U.prompts("stunts")) await U.gm({ op: "answerFor", prompt: sp.id, value: [] });
  eq((lastNews(U)?.reacts ?? []).map((r) => [r.who, r.result]), [["H1", "failed"]], "U125d: a guardian without a six: the news says it failed");
}

/* ---- U125 (c): the +2 of Warning Call is named on the roll's chat card (its title) */
{
  const { cardTitle } = await import("./lang.mjs");
  const T = team((t) => give(t, "H1", "Warning Call"));
  await T.gm(decl("N1", "slugfest", ["H2"]));
  await T.req("p1", { op: "answer", prompt: T.prompt("reaction", "H1").id, value: rid(T, "H1", "warn") });
  await T.req("p2", { op: "answer", prompt: T.prompt("reaction", "H2").id, value: "block:warned" });
  await T.roll("attack", 1);
  const rq = T.requests.find((x) => x.key === "def:H2");
  const lab = (lang) => (s) => tIn(lang, `ITAC.mod.${String(s).split(":")[0]}`, {}, String(s));
  eq([cardTitle(tIn("en", "ITAC.roll.def"), rq?.pool, lab("en")), cardTitle(tIn("pl", "ITAC.roll.def"), rq?.pool, lab("pl"))], ["Defence: Warning Call +2", "Obrona: Okrzyk ostrzegawczy +2"], "U125c: the warned block's card says where its two dice came from");
  eq(cardTitle("Defence", { mods: [{ source: "aim", dice: 1 }] }, lab("en")), "Defence", "U125c: any other modifier leaves the title as it was");
  ok(/new Dlg\(cardTitle\(/.test(src("system-adapter.mjs")), "U125c: the roll dialog (whose title is the card's) is titled through cardTitle");
}

/* ---- U128: "Token HUD" from the GM's map menu: Foundry's HUD toggles act on canvas.tokens.controlled (placeable-hud #onToggleVisibility),
   so the token the menu was opened for is taken in hand (alone) before the HUD is bound to it */
{
  const line = src("ui/board.mjs").split("\n").find((l) => l.includes('id: "@hud"')) ?? "";
  const c = line.indexOf(".control({ releaseOthers: true })"), b = line.indexOf(".bind(tok)");
  ok(c > 0 && b > c, "U128: the menu's HUD entry controls its token (releasing the others) before it binds the HUD");
}

/* ---- D120: the roll watch (rollwatch-pure). An owed roll whose answer is in the chat but was not taken is fed in again; one with no
   answer is asked for again with the same request id, three times; a result in, or set by the GM, is not owed */
{
  const RW = await import("./rollwatch-pure.mjs");
  const st = { stack: [{ id: "a1", rolls: { attack: { who: "H1", req: { rid: "r1", at: 1000, users: ["p1"] } }, "def:N1": { who: "N1", sixes: 2, req: { rid: "r2", at: 1000 } }, "sw:H2": { who: "H2", forced: 1, req: { rid: "r3", at: 1000 } } } }, { id: "a2", rolls: { roll: { who: "H2", req: { rid: "r4", at: 5000, users: ["p2"] } } } }] };
  eq(RW.owedRolls(st).map((o) => o.rid), ["r1", "r4"], "D120: the owed rolls (no result, not set by the GM)");
  const memo = { fed: new Map(), sent: new Map() }, none = () => null;
  eq(RW.plan(st, 1000 + RW.FEED_AFTER - 1, { messageFor: none, memo }), [], "D120: right after the request nothing is done");
  eq(RW.plan(st, 1000 + RW.RESEND_AT[0], { messageFor: none, memo }), [{ do: "resend", inst: "a1", key: "attack", rid: "r1", n: 1 }], "D120: no answer after the first wait: the same request again");
  eq(RW.plan(st, 1000 + RW.RESEND_AT[0] + 500, { messageFor: none, memo }), [], "D120: ... once, not on every look");
  eq(RW.plan(st, 1000 + RW.RESEND_AT[1], { messageFor: none, memo }).map((a) => [a.rid, a.n]), [["r1", 2], ["r4", 1]], "D120: the second time later, and the other roll's first");
  RW.plan(st, 1000 + RW.RESEND_AT[2], { messageFor: none, memo });
  eq(RW.plan(st, 1000 + 999999, { messageFor: none, memo }).filter((a) => a.rid === "r1"), [], "D120: after the third time the GM's \"Ask again\" remains");
  const m2 = { fed: new Map(), sent: new Map() }, msg = (rid) => (rid === "r1" ? "m9" : null);
  eq(RW.plan(st, 1000 + RW.FEED_AFTER, { messageFor: msg, memo: m2 }), [{ do: "feed", messageId: "m9", rid: "r1" }], "D120: the answer is in the chat but not taken: fed in again");
  RW.plan(st, 1000 + RW.FEED_AFTER + 2000, { messageFor: msg, memo: m2 });
  eq(RW.plan(st, 1000 + RW.FEED_AFTER + 4000, { messageFor: msg, memo: m2 }).filter((a) => a.rid === "r1"), [], "D120: a message the engine keeps refusing is not fed for ever (twice)");
  const e = src("engine.mjs"), rl = src("relay.mjs");
  ok(/setInterval\(\(\) => watchRolls\(\)/.test(e) && /RW\.plan\(/.test(e), "D120: the executor runs the watch every few seconds");
  ok(/again > 0 \? \{ again \}/.test(e) && /force: again > 0/.test(e), "D120: a request sent again carries `again`; the GM's own roll is thrown again (force)");
  ok(/opened\.has\(msg\.req\.rid\) && !again/.test(rl) && /\{ force: again \}/.test(rl), "D120: the roller's client throws again for `again` (not within ROLL_RETRY_MS of its last throw)");
  ok(/if \(!late\) Store\.queue\(/.test(e), "D120: a roll message that comes before the executor's own state write is looked at again when the queue is through");
  ok(/busyRedraw\(left\)/.test(src("ui/main.mjs")), "D120: the chip that says the dice are flying is drawn again when that time is up");
}

/* ---- U130: the summary card of a stopped fight. Stopping is the end of the fight: its card is shown then and its tally let go, so
   deleting that combat later (before the next fight) brings no card back; and a new fight never has the old fight's card over it.
   ui/feedback.mjs against a few stand-ins of Foundry (nothing else of the module runs). */
{
  const hooks = {}, coll = (list) => Object.assign(list, { get: (id) => list.find((x) => x.id === id) ?? null });
  globalThis.Hooks ??= { on: (n, f) => (hooks[n] ??= []).push(f), once: () => {}, callAll: (n, ...a) => { for (const f of hooks[n] ?? []) f(...a); } };
  const c1 = { id: "c1", flags: {} }, c2 = { id: "c2", flags: {} };
  globalThis.game ??= { user: { id: "gm", isGM: true }, users: coll([]), combats: coll([c1, c2]), settings: { get: () => undefined, set: () => {} }, modules: { get: () => null } };
  const FB = await import("./ui/feedback.mjs");
  let redraws = 0;
  ok(FB.start({ t: (k) => k, refresh: () => { redraws++; } }), "U130: feedback starts against the stand-ins");
  const news = [{ id: "n1", kind: "action", round: 1, actor: "A", rows: [{ target: "B", hit: true, taken: 2 }] }];
  const ctx = (combat) => ({ combat, facts: { view: { round: 1, ledger: { A: {}, B: {} }, news }, c: (id) => ({ name: id, npc: id === "B" }) }, model: { bars: [] }, data: {}, cards: null, staff: true, own: {} });
  eq(FB.sync(ctx(c1)).sum, null, "U130: a fight runs: no card");
  const stopped = FB.idle().sum;                                  // the GM stopped the fight: the state is gone, the combat stands (here: no state at all)
  eq(stopped?.id ?? null, "f:c1", "U130: stopping the fight shows its summary at once");
  FB.closeSum();
  (hooks.deleteCombat ?? []).forEach((f) => f(c1));               // the GM deletes the old combat before the next fight
  eq(FB.idle().sum, null, "U130: deleting the stopped fight's combat later brings no card back");
  /* the card of the fight before still standing when the next one starts */
  FB.sync(ctx(c1)); (hooks.deleteCombat ?? []).forEach((f) => f(c1));
  eq(FB.idle().sum?.id ?? null, "f:c1", "U130: a fight deleted while it runs shows its card");
  eq(FB.sync(ctx(c2)).sum, null, "U130: the next fight starts: the old fight's card goes");
  eq([(await import("./ui/feedback-pure.mjs")).cardFight({ id: "r:abc:3" }), (await import("./ui/feedback-pure.mjs")).cardFight({ id: "f:abc" })], ["abc", "abc"], "U130: a card knows its fight");
}

done("check-fxi");
