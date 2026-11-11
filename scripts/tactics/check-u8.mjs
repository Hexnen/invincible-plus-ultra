/* node scripts/tactics/check-u8.mjs -- ledger rows U59 (since when the table waits, the GM's nudge), U60 (one combatant at a glance on the
   desk) and U61 (a minion group settled quickly), through the REAL director, engine, view and models. */
import { Table, ok, eq, done } from "./testkit.mjs";
import * as D from "./desk-pure.mjs";
import * as V from "./view-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as Mods from "./mods-pure.mjs";
import * as M from "./ui/model-pure.mjs";
import * as BP from "./ui/board-pure.mjs";
import { EN, PL, t as T0 } from "./lang.mjs";

globalThis.game = { i18n: { lang: "en" } };
const t = (key, params, fallback) => { if (fallback === undefined && !(key in EN)) ok(false, `missing key ${key}`); return T0(key, params, fallback); };
const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const decl = (actor, action, targets, extra = {}) => ({ op: "declare", actor, decl: { action, targets, ...extra } });
const kinds = (T) => T.prompts().map((p) => p.kind);
const pass = async (T) => { for (const p of T.prompts("reaction")) await T.req(p.to === "gm" ? "gm" : p.to.users[0], { op: p.to === "gm" ? "answerFor" : "answer", prompt: p.id, value: "pass" }); };
const ctx = (T, online = () => true) => ({ c: (id) => T.c[id] ?? null, online, P1 });
const meta = (T) => ({ hidden: Object.values(T.c).filter((c) => c.hidden).map((c) => c.id), npc: Object.values(T.c).filter((c) => c.npc).map((c) => c.id) });
const viewOf = (T, uid, owns) => V.viewFor(T.state, { id: uid, staff: false, owns }, meta(T));
const facts = (T, view, me, staff = false, more = {}) => ({ view, me, staff, c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc, kind: T.c[id].kind, img: null } : null), attrs: (id) => T.c[id]?.attrs ?? null, userName: (u) => `user-${u}`,
  online: (u) => T.users[u]?.active === true, vitals: (id) => (T.c[id] ? { health: T.c[id].health, maxHealth: T.c[id].maxHealth, resolve: T.c[id].resolve, maxResolve: T.c[id].maxResolve } : null), where: (id) => T.c[id]?.zone ?? null, hidden: (id) => !!T.c[id]?.hidden,
  sheet: (id) => (staff ? T.c[id] ?? null : null), budget: (id) => { try { return staff && view?.ledger?.[id] ? P1.budget(view, id) : null; } catch { return null; } }, preview: (cid, d) => T.preview(me, cid, d), ...more });
const desk = (T, own = {}) => M.deskData(D.deskModel(T.state, T.log, ctx(T)), own, facts(T, T.state, "gm", true), t);
const dock = (T, uid, owns, own = {}) => { const view = viewOf(T, uid, owns); return M.dockData(D.playerModel(view, { id: uid, owns }, ctx(T)), own, facts(T, view, uid), t); };

/* ---- A. U59: a prompt keeps when it was asked; the desk's strip says since when and offers the nudge; the nudge reaches only the asked */
{
  const T = new Table(); T.hero("H1", "p1").hero("H2", "p2").npc("N1", { health: 6 }); T.order(["N1", "H1", "H2"]);
  await T.gm(decl("N1", "slugfest", ["H1"]));
  const p = T.prompt("reaction");
  ok(Number.isFinite(p?.at) && p.at > 1000, "A: the prompt keeps the moment it was asked (the executor's clock)");
  eq(V.viewFor(T.state, { id: "p1", staff: false, owns: ["H1"] }, meta(T)).prompts[p.id]?.at, p.at, "A: the asked player's view keeps it");
  let d = desk(T);
  const row = d.waiting.find((w) => !w.gm);
  eq([row?.since, !!row?.nudge, row?.nudge?.req?.op, row?.nudge?.req?.prompt], [p.at, true, "nudge", p.id], "A: the desk's row of the player carries since and the nudge");
  eq(dock(T, "p2", ["H2"]).waiting.map((w) => [w.since ?? null, w.nudge ?? null]).flat().filter((x) => x != null), [], "A: a player's strip has no clock and no nudge");
  eq(code(await T.req("p2", row.nudge.req)), "noPermission", "A: only the GM nudges");
  const before = JSON.stringify([T.state.stack, T.state.prompts, T.log]);
  eq(code(await T.gm(row.nudge.req)), "ok", "A: the GM nudges");
  eq(JSON.stringify([T.state.stack, T.state.prompts, T.log]), before, "A: the nudge changes nothing of the fight and is not journaled");
  const n1 = dock(T, "p1", ["H1"]).news, n2 = dock(T, "p2", ["H2"]).news;
  eq([n1?.kind, n1?.tone, n1?.text], ["nudge", "nudge", EN["ITAC.ui.news.nudge"]], "A: the asked player reads the nudge on the dock");
  ok(n2?.kind !== "nudge", "A: another player does not see the nudge");
  await T.gm(row.nudge.req);
  eq(T.state.news.filter((n) => n.kind === "nudge").length, 1, "A: a second nudge of the same person replaces the first");
  T.users.p1.active = false;
  eq(code(await T.gm(row.nudge.req)), "gone", "A: nobody at the table to nudge");
  eq(desk(T).waiting.find((w) => !w.gm)?.nudge ?? null, null, "A: no bell for somebody who is not at the table");
  T.users.p1.active = true;
  await T.req("p1", { op: "answer", prompt: p.id, value: "pass" });
  eq(code(await T.gm(row.nudge.req)), "gone", "A: an answered prompt cannot be nudged");
  /* a roll waited for */
  d = desk(T);
  const roll = d.waiting.find((w) => w.nudge) ?? null, gmRow = d.waiting.find((w) => w.gm) ?? null;
  ok(!gmRow || gmRow.nudge == null, "A: the GM's own row has no nudge");
  ok(roll == null || roll.nudge.req.op === "nudge", "A: a roll waited for from a player nudges the same way");
  eq(PL["ITAC.ui.news.nudge"].length > 0 && PL["ITAC.ui.nudge"].includes("{name}"), true, "A: Polish lines exist");
}
{
  const T = new Table(); T.hero("H1", "p1").npc("N1", { health: 6 }); T.order(["H1", "N1"]);
  await T.req("p1", decl("H1", "slugfest", ["N1"])); await pass(T);
  const inst = T.top(), w = desk(T).waiting.find((x) => x.nudge);
  eq([w?.nudge.req.inst, w?.nudge.req.roll], [inst.id, "attack"], "A: the attack roll the table waits for can be nudged");
  eq(code(await T.gm(w.nudge.req)), "ok", "A: nudging a roll");
  eq(dock(T, "p1", ["H1"]).news?.text, EN["ITAC.ui.news.nudge.roll"], "A: the player reads that the GM waits for the roll");
}

/* ---- B. U61: a minion group settled quickly: no defence, no pushed roll, one card with a number and two answers */
{
  const mk = (quick, o = {}) => { const T = new Table(); T.hero("H1", "p1", { damage: 2 }).add("M1", { npc: true, kind: "minions", members: 6, health: 6, name: "Thugs" }); T.order(["H1", "M1"]); return T; };
  const T = mk();
  eq(code(await T.req("p1", D.policyReq(T.state, "M1", { quick: true }))), "noPermission", "B: the switch is the GM's");
  eq(code(await T.gm(D.policyReq(T.state, "M1", { quick: true }))), "ok", "B: the GM turns quick resolution on");
  eq(T.state.npc.M1.quick, true, "B: the policy keeps it");
  eq(code(await T.gm({ op: "npcPolicy", combatant: "M1", policy: { ...T.state.npc.M1, quick: "yes" } })) !== "ok" || T.state.npc.M1.quick !== "yes", true, "B: only true is kept");
  await T.gm(D.policyReq(T.state, "M1", { quick: true }));
  await T.req("p1", decl("H1", "slugfest", ["M1"]));
  eq(kinds(T).includes("reaction"), false, "B: the group does not defend: no reaction card");
  await T.roll("attack", 1);
  const sp = T.prompt("stunts"); if (sp) await T.req("p1", { op: "answer", prompt: sp.id, value: [] });
  const q = T.prompt("minionsQuick");
  eq([kinds(T), q?.to, q?.data?.suggested, q?.data?.members], [["minionsQuick"], "gm", 2, 6], "B: ONE card for the GM, the damage is the number offered");
  const card = desk(T).cards.find((c) => c.kind === "minionsQuick");
  eq([card?.count?.value, card?.count?.min, card?.count?.max, card?.options.map((o) => o.id)], [2, 0, 6, ["ko:2", "kill:2"]], "B: the card shows the number and the two answers");
  const c3 = desk(T, { vals: { [card.count.id]: 3 } }).cards.find((c) => c.kind === "minionsQuick");
  eq([c3.count.value, c3.options.map((o) => o.id), c3.options.map((o) => o.label)], [3, ["ko:3", "kill:3"], ["Knocked out: 3", "Killed: 3"]], "B: the number steps, the answers follow");
  const c0 = desk(T, { vals: { [card.count.id]: 0 } }).cards.find((c) => c.kind === "minionsQuick");
  eq(c0.options.map((o) => o.id), ["none"], "B: at zero the one answer is that nobody falls");
  eq(desk(T, { vals: { [card.count.id]: 99 } }).cards.find((c) => c.kind === "minionsQuick").count.value, 6, "B: never more than stand");
  eq(code(await T.gm(c3.options[1].req)), "ok", "B: the GM answers once");
  eq([T.c.M1.health, kinds(T), T.state.stack.length], [3, [], 0], "B: three fall, no second card, the action is over");
  /* the whole group in one answer */
  await T.gm({ type: "nextTurn" }).catch(() => null);
  const U = mk(); await U.gm(D.policyReq(U.state, "M1", { quick: true }));
  await U.req("p1", decl("H1", "slugfest", ["M1"])); await U.roll("attack", 1);
  const us = U.prompt("stunts"); if (us) await U.req("p1", { op: "answer", prompt: us.id, value: [] });
  eq(code(await U.answer("gm", "minionsQuick", "ko:6", "M1")), "ok", "B: all six knocked out in one answer");
  eq([U.c.M1.health, Mods.hasStatus(U.state, "M1", "broken"), Mods.hasStatus(U.state, "M1", "unconscious"), kinds(U)], [0, true, true, []], "B: the group is out, knocked out, nothing more is asked");
  /* off: the old two cards stay */
  const O = mk(); await O.req("p1", decl("H1", "slugfest", ["M1"]));
  eq(kinds(O), ["reaction"], "B: without the switch the group is asked to defend as before");
  /* the switch on the desk and at the token */
  const dd = desk(T, { tab: "table" }), np = dd.npcs?.find((n) => n.id === "M1")?.policy.find((p) => p.id === "quick");
  eq([!!np, np?.choices.map((c) => c.on), np?.choices[0].req.policy.quick ?? null], [true, [false, true], null], "B: the desk's table tab carries the switch for the group");
  const Tn = new Table(); Tn.hero("H1", "p1").npc("N1"); Tn.order(["H1", "N1"]);
  eq(desk(Tn, { tab: "table" }).npcs?.find((n) => n.id === "N1")?.policy.some((p) => p.id === "quick"), false, "B: a single NPC has no such switch");
  const items = BP.gmItems("M1", { health: 3, maxHealth: 10 }, [], t, { quick: true, req: (on) => D.policyReq(T.state, "M1", { quick: on }) });
  const it = items.find((i) => i.id === "quick");
  eq([it?.toggle, it?.on, it?.req(false).policy.quick ?? null, BP.gmItems("N1", {}, [], t).some((i) => i.id === "quick")], [true, true, null, false], "B: the map menu at the group's token carries the same switch");
}

/* ---- C. U60: one combatant at a glance */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Atom Eve" }).npc("N1", { name: "Mauler", health: 6, zone: "z1" }).add("M1", { npc: true, kind: "minions", members: 4, health: 4, name: "Thugs" }); T.order(["H1", "N1", "M1"]);
  await T.req("p1", decl("H1", "slugfest", ["N1"])); await pass(T); await T.roll("attack", 2);
  const sp = T.prompt("stunts"); if (sp) await T.req("p1", { op: "answer", prompt: sp.id, value: [] });
  for (let g = 0; g < 6 && T.prompts().length; g++) { const p = T.prompts()[0]; await T.req("gm", { op: "answerFor", prompt: p.id, value: p.options?.[0]?.id ?? "pass" }); }
  const model = D.deskModel(T.state, T.log, ctx(T)), F = facts(T, T.state, "gm", true);
  const u = M.unitData("N1", model, F, t);
  eq([u.id, u.name, u.vitals.map((v) => v.id), u.group, u.last.length >= 1, u.last.length <= M.UNIT_LAST], ["N1", "Mauler", ["health", "resolve"], null, true, true], "C: the NPC: name, both bars, its last actions from the journal");
  ok(u.last.every((j) => typeof j.text === "string" && j.text.length > 0), "C: every last action is a line of text");
  eq(M.unitData("M1", model, F, t).last.length, 0, "C: somebody nothing happened to has no last actions");
  const g = M.unitData("M1", model, F, t);
  eq([g.group?.n, g.vitals.some((v) => v.id === "health"), g.statesNone], [4, false, EN["ITAC.ui.unit.fine"]], "C: a minion group says how many stand instead of a Health bar");
  eq(M.unitData("nobody", model, F, t), null, "C: no such combatant, no card");
  await T.gm({ op: "statusAdd", combatant: "N1", status: { id: "stunned" } });
  eq(M.unitData("N1", D.deskModel(T.state, T.log, ctx(T)), facts(T, T.state, "gm", true), t).states.map((s) => s.id).includes("stunned"), true, "C: its states are listed");
  const dk = desk(T, { tab: "kit", kit: { who: "N1" } });
  eq([dk.kit?.unit?.id, desk(T, { tab: "now" }).kit ?? null], ["N1", null], "C: the card is the head of the desk's character tab, built only when that tab is open");
  eq(dock(T, "p1", ["H1"]).kit?.unit ?? null, null, "C: a player's dock has no such card");
}
done("check-u8");
