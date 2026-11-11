// node scripts/tactics/check-cam.mjs -- U94, the camera of a tactical fight (ui/camera-pure.mjs; spec section 25).
//   A. the moments: what a look at this user's view and hand gives the camera (turns, the hand's own acts, a question, somebody new),
//      what the first look gives (nothing), what aiming holds back, the order when several happen at once
//   B. the events of the fight (a walk, an action aimed at somebody, a result) asked of the user's own look
//   C. HIDDEN INFORMATION: through a whole scripted fight with a hidden NPC and an NPC unseen by one hero, no cue on a player's
//      client names, or exists because of, somebody that player's view does not hold; fed the GM's full stream on purpose, the
//      player's look still gives nothing about them; the GM gets them
//   D. the switch on the dock and its words
import { Table, ok, eq, done } from "./testkit.mjs";
import * as V from "./view-pure.mjs";
import * as CP from "./ui/camera-pure.mjs";
import * as UI from "./ui/model-pure.mjs";
import { EN, PL, t as T0 } from "./lang.mjs";

globalThis.game = { ...(globalThis.game ?? {}), i18n: { lang: "en" } };
const meta = (T) => ({ hidden: Object.values(T.c).filter((c) => c.hidden).map((c) => c.id), npc: Object.values(T.c).filter((c) => c.npc).map((c) => c.id) });
const viewOf = (T, uid, owns) => V.viewFor(T.state, { id: uid, staff: false, owns }, meta(T));
const P1 = { me: "p1", staff: false, mine: ["H1"] }, P2 = { me: "p2", staff: false, mine: ["H2"] }, GM = { me: "gm", staff: true, mine: ["N1", "N2", "N3"] };
const lookOf = (T, who, own = {}) => CP.look(who.staff ? T.state : viewOf(T, who.me, who.mine), { ...who, ...own });
const whys = (list) => list.map((c) => c.why);
const names = (c) => (c ? [c.focus, ...c.with, c.after].filter(Boolean) : []);
const mk = () => { const T = new Table(); T.hero("H1", "p1", { name: "Ada" }).hero("H2", "p2", { name: "Rex" }).npc("N1", { name: "Thug", health: 9 }).npc("N2", { name: "Ghost", health: 9, hidden: true }).npc("N3", { name: "Far", health: 9 });
  T.order(["H1", "N1", "H2", "N2", "N3"]).turn("H1"); return T; };
/* through an action to its end: every card passed (by the GM, as the table's stand-in), every roll made with two sixes */
const pass = async (T, each = null) => { for (let n = 0; n < 24 && T.state.stack.length; n++) { const p = T.prompts()[0], top = T.top();
  if (p) { await T.gm({ op: "answerFor", prompt: p.id, value: p.multi ? [] : (p.options.find((o) => o.id === "pass" || o.id === "none") ?? p.options.find((o) => !o.disabled)).id }); each?.(p.kind); continue; }
  const key = Object.keys(top?.rolls ?? {}).find((k) => top.rolls[k].sixes == null);
  if (!key) break;
  await T.roll(key, 2); each?.(`roll ${key}`); } };

/* ------------------------------------------------------------------ A. the moments */
{
  const T = mk();
  const a0 = lookOf(T, P1), b0 = lookOf(T, P2), g0 = lookOf(T, GM);
  eq([a0.cur, a0.known.includes("N2"), g0.known.includes("N2")], ["H1", false, true], "A: a player's look does not hold the hidden one, the GM's does");
  eq([CP.cues(null, a0), CP.cue(null, a0)], [[], null], "A: the first look (joined, reloaded, the fight began) moves nothing");
  eq(CP.cues(a0, lookOf(T, P1)), [], "A: nothing changed: no cue");
  T.turn("N1");
  const a1 = lookOf(T, P1), g1 = lookOf(T, GM);
  eq([CP.cue(a0, a1)?.why, CP.cue(a0, a1)?.focus, CP.cue(a0, a1)?.level, CP.cue(a0, a1)?.hand], ["turn", "N1", "turn", false], "A: somebody else's turn starts: a cue for the default setting");
  eq([CP.cue(g0, g1)?.why, CP.cue(g0, g1)?.focus], ["ownTurn", "N1"], "A: the GM drives the NPC: its turn is the GM's own");
  T.turn("H2");
  const a2 = lookOf(T, P1), b2 = lookOf(T, P2);
  eq([CP.cue(a1, a2)?.why, CP.cue(b0, b2)?.why, CP.cue(b0, b2)?.focus], ["turn", "ownTurn", "H2"], "A: a hero's turn: own for its player, a turn for the other");
  /* the turn of the hidden NPC: a player's camera does nothing at all, the GM's goes there */
  T.turn("N2");
  const a3 = lookOf(T, P1), g3 = lookOf(T, GM);
  eq([a3.cur, CP.cues(a2, a3)], [null, []], "A: the hidden NPC's turn: no cue for a player");
  eq([CP.cue(g1, g3)?.why, CP.cue(g1, g3)?.focus], ["ownTurn", "N2"], "A: ... and the GM's camera goes to it");
  T.turn("N3");
  eq(CP.cue(a3, lookOf(T, P1))?.focus, "N3", "A: the next visible turn is framed again");
  /* a new round with the same combatant on turn is a turn */
  const r1 = { ...a0, round: 1 }, r2 = { ...a0, round: 2 };
  eq(CP.cue(r1, r2)?.why, "ownTurn", "A: a new round that starts with the same unit is a turn start");
  /* the user's own hand */
  const base = lookOf(mk(), P1, { who: "H1" });
  const sel = { ...base, sel: "H2" };
  eq([CP.cue(base, sel)?.why, CP.cue(base, sel)?.hand, CP.cue(base, sel)?.level], ["select", true, "turn"], "A: another unit chosen on the dock: the hand's own cue");
  const armed = { ...base, armed: "slugfest" }, aim = { ...armed, targets: ["N1"] }, aim2 = { ...armed, targets: ["N3"] };
  eq(CP.cues(base, armed), [], "A: arming an attack moves nothing");
  eq([CP.cue(armed, aim)?.why, CP.cue(armed, aim)?.focus, CP.cue(armed, aim)?.with, CP.cue(armed, aim)?.hand], ["aim", "N1", ["H1"], true], "A: a target walked to: the target first, the user's unit with it");
  eq([CP.cue(aim, aim2)?.focus, CP.cues(aim, aim)], ["N3", []], "A: the next target; the same target again is nothing");
  const mv = { ...base, armed: "move" };
  eq([CP.cue(base, mv)?.why, CP.cue(base, mv)?.focus, CP.cues(mv, mv)], ["arm", "H1", []], "A: Move armed: the unit out from under the bars, once");
  /* a concealed id handed in by the dock is not looked at */
  eq(lookOf(mk(), P1, { who: "H1", sel: "N2", armed: "slugfest", targets: ["N2", "N1"] }).targets, ["N1"], "A: a target the view does not hold never enters the look");
  eq(lookOf(mk(), P1, { sel: "N2" }).sel, null, "A: ... nor a unit");
  /* a question put to this user */
  const Q = mk(); T.turn; Q.turn("N1");
  const q0 = lookOf(Q, P1), q0b = lookOf(Q, P2), q0g = lookOf(Q, GM);
  await Q.gm({ op: "declare", actor: "N1", decl: { action: "slugfest", targets: ["H1"] } });
  const react = Q.prompt("reaction", "H1");
  ok(!!react, "A: (the attack asks H1 for a reaction)");
  const q1 = lookOf(Q, P1), c = CP.cues(q0, q1);
  eq([c[0]?.why, c[0]?.focus, c[0]?.with, c[0]?.level], ["asked", "H1", ["N1"], "turn"], "A: asked to react: the user's unit first, the attacker with it");
  eq(CP.cues(q0b, lookOf(Q, P2)), [], "A: the other player is not asked: no cue from the question");
  eq(whys(CP.cues(q0g, lookOf(Q, GM))), [], "A: nor the GM (the card is the player's)");
  eq(CP.cues(q1, lookOf(Q, P1)), [], "A: the question still standing is not a new cue");
  /* a question to the GM about an NPC */
  await pass(Q);
  const H = mk();
  const h0 = lookOf(H, GM);
  await H.req("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1"] } });
  const gp = H.prompts().find((p) => p.to === "gm" && p.about === "N1");
  if (gp) eq([CP.cue(h0, lookOf(H, GM))?.why, CP.cue(h0, lookOf(H, GM))?.focus], ["asked", "N1"], "A: a card on the GM's desk about an NPC: the GM's cue");
  else ok(true, "A: (no GM card in this flow)");
  /* somebody new in the view */
  const R = mk(), n0 = lookOf(R, P1);
  R.c.N2.hidden = false;
  const n1 = lookOf(R, P1), rc = CP.cue(n0, n1);
  eq([rc?.why, rc?.focus, rc?.level], ["reveal", "N2", "all"], "A: the hidden one revealed: a cue for 'all' only");
  eq(CP.cues({ ...n0, known: [] }, n1), [], "A: a look that knew nobody (before the deal) reveals nobody");
  /* aiming: the map is under the user's hand */
  eq(whys(CP.cues({ ...a0, armed: "shoot" }, { ...a1, armed: "shoot" })), [], "A: while an action is armed a turn start does not move the view");
  /* several at once: the most pressing first */
  const many = CP.cues({ ...q0, sel: null }, { ...q1, sel: "H1", cur: "H2" });
  eq(whys(many), ["asked", "turn"], "A: the order: a question before a turn (a unit chosen at a turn change is the turn's)");
  for (const w of CP.ORDER) ok(CP.LEVEL[w] === "turn" || CP.LEVEL[w] === "all", `A: ${w} has a level`);
  ok(CP.HAND.every((w) => CP.LEVEL[w] === "turn"), "A: the hand's own cues play at the default setting");
}

/* ------------------------------------------------------------------ B. the events of the fight */
{
  const T = mk(), a = lookOf(T, P1), b = lookOf(T, P2), g = lookOf(T, GM);
  const ev = (o) => ({ combat: "c", seq: 1, ...o });
  const atk = ev({ type: "actionDeclared", actor: "N1", targets: ["H1"], decl: { action: "slugfest" } });
  eq([CP.eventCue(atk, a)?.why, CP.eventCue(atk, a)?.focus, CP.eventCue(atk, a)?.with, CP.eventCue(atk, a)?.level], ["attacked", "H1", ["N1"], "turn"], "B: the user's unit is aimed at: a cue at the default setting");
  eq([CP.eventCue(atk, b)?.why, CP.eventCue(atk, b)?.focus, CP.eventCue(atk, b)?.level], ["attack", "H1", "all"], "B: for a watcher the same action is a beat for 'all'");
  eq(CP.eventCue(atk, g), null, "B: the GM's own NPC acts: the GM aimed it");
  const own = ev({ type: "actionDeclared", actor: "H1", targets: ["N1"], decl: { action: "slugfest" } });
  eq([CP.eventCue(own, a), CP.eventCue(own, g)?.why, CP.eventCue(own, g)?.focus], [null, "attacked", "N1"], "B: the user's own action gives no cue; the GM's NPC is aimed at");
  const walk = ev({ type: "actionDeclared", actor: "H1", targets: [], decl: { action: "move", mode: "walk", to: "z3" } });
  eq([CP.eventCue(walk, a)?.why, CP.eventCue(walk, a)?.hand, CP.eventCue(walk, a)?.after, CP.eventCue(walk, a)?.zone], ["ownMove", true, "H1", "z3"], "B: the user's own walk: the unit once it has walked");
  eq([CP.eventCue(walk, b)?.why, CP.eventCue(walk, b)?.level, CP.eventCue(walk, b)?.zone], ["move", "all", "z3"], "B: somebody else's walk: a beat for 'all'");
  for (const type of ["outcome", "damage", "broken", "forcedMove"]) {
    const r = ev({ type, actor: "N1", target: "H1", hit: true, taken: 2 });
    eq([CP.eventCue(r, a)?.why, CP.eventCue(r, a)?.level, CP.eventCue(r, b)?.why, CP.eventCue(r, b)?.level], ["hurt", "turn", "result", "all"], `B: ${type}: the user's own unit at the default, somebody else's for 'all'`);
  }
  eq(CP.eventCue(ev({ type: "outcome", actor: "H1", target: "N1", hit: true }), a), null, "B: the result of the user's own action is no cue");
  eq(CP.eventCue(ev({ type: "damage", target: { combatant: "H1" }, taken: 1 }), a)?.focus, "H1", "B: a target given as a record");
  for (const type of ["roundStart", "turnStart", "roll", "draw", "undo", "zzz"]) eq(CP.eventCue(ev({ type, actor: "N1", target: "H1" }), a), null, `B: ${type} is no cue`);
  eq([CP.eventCue(null, a), CP.eventCue(atk, null), CP.eventCue("x", a)], [null, null, null], "B: nothing to read: null");
  eq(CP.eventCue(atk, { ...a, armed: "shoot" }), null, "B: while the user aims an event of somebody else moves nothing");
  eq(CP.eventCue(walk, { ...a, armed: "move" })?.why, "ownMove", "B: ... the user's own walk still does");
}

/* ------------------------------------------------------------------ C. hidden information */
{
  const concealed = (T, who) => [...V.concealedFor(T.state, { id: who.me, owns: who.mine }, meta(T))];
  const T = mk();
  T.state.knowledge = { ...(T.state.knowledge ?? {}), H1: { ...(T.state.knowledge?.H1 ?? {}), N3: "unseen" } };      // H1 has not seen N3; H2 has
  eq([concealed(T, P1).sort(), concealed(T, P2).sort()], [["N2", "N3"], ["N2"]], "C: who is concealed from whom");
  let before = { p1: lookOf(T, P1), p2: lookOf(T, P2), gm: lookOf(T, GM) }, seen = 0, gmSaw = new Set(), evAt = 0;
  const all = [];
  const step = (label) => {
    for (const who of [P1, P2]) {
      const hide = concealed(T, who), now = lookOf(T, who), key = who.me;
      ok(!hide.some((id) => JSON.stringify(now).includes(`"${id}"`)), `C: ${label}: the look of ${key} holds nobody concealed from ${key}`);
      const list = CP.cues(before[key], now);
      /* the events since the last step: the public stream as a player's client hears it, AND the GM's full stream on purpose */
      const evs = T.events.slice(evAt);
      for (const full of evs) {
        const pub = V.publicEvent(T.state, full, meta(T));
        if (pub) { const c = CP.eventCue(pub, now); if (c) list.push(c); }
        const leak = CP.eventCue(full, now);
        if (leak) list.push(leak);
      }
      for (const c of list) { seen++; all.push(`${key}:${c.why}:${c.focus}`); ok(!names(c).some((id) => hide.includes(id)), `C: ${label}: a cue of ${key} (${c.why}) names nobody concealed`); }
      before[key] = now;
    }
    const g = lookOf(T, GM), gl = CP.cues(before.gm, g);
    for (const full of T.events.slice(evAt)) { const c = CP.eventCue(full, g); if (c) gl.push(c); }
    for (const c of gl) for (const id of names(c)) gmSaw.add(id);
    before.gm = g; evAt = T.events.length;
  };
  /* H1 hits the Thug */
  await T.req("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1"] } }); step("H1 attacks N1");
  await pass(T, (k) => step(`answered ${k}`)); ok(!T.state.stack.length, "C: (the action closed)");
  T.turn("N1"); step("turn N1");
  await T.gm({ op: "declare", actor: "N1", decl: { action: "slugfest", targets: ["H2"] } }); step("N1 attacks H2");
  await pass(T, (k) => step(`answered ${k}`)); ok(!T.state.stack.length, "C: (the action closed)");
  /* the hidden Ghost attacks H1 */
  T.turn("N2"); step("turn of the hidden N2");
  const stackWas = T.state.stack.length;
  await T.gm({ op: "declare", actor: "N2", decl: { action: "slugfest", targets: ["H1"] } }); step("the hidden N2 attacks H1");
  ok(T.state.stack.length > stackWas || T.prompts().length > 0 || T.events.some((e) => e.actor === "N2"), "C: (the hidden attack really happened)");
  await pass(T, (k) => step(`answered ${k}`)); ok(!T.state.stack.length, "C: (the action closed)");
  /* the unseen Far (seen by H2, not by H1) attacks H1, then H2 */
  T.turn("N3"); step("turn of N3 (unseen by H1)");
  await T.gm({ op: "declare", actor: "N3", decl: { action: "slugfest", targets: ["H1"] } }); step("N3 attacks H1");
  await pass(T, (k) => step(`answered ${k}`)); ok(!T.state.stack.length, "C: (the action closed)");
  T.turn("H2"); step("turn H2");
  await T.req("p2", { op: "declare", actor: "H2", decl: { action: "slugfest", targets: ["N3"] } }); step("H2 attacks N3");
  await pass(T, (k) => step(`answered ${k}`)); ok(!T.state.stack.length, "C: (the action closed)");
  /* the Ghost is revealed */
  T.c.N2.hidden = false; step("N2 revealed");
  ok(seen >= 6, `C: the run produced cues for the players (${seen})`);
  ok(all.includes("p1:asked:H1") || all.some((x) => x.startsWith("p1:attacked:H1") || x.startsWith("p1:hurt:H1")), "C: the player whose hero was attacked out of the dark still gets the hero framed (the question is in the view)");
  ok(all.includes("p1:reveal:N2") && all.includes("p2:reveal:N2"), "C: once revealed the Ghost is a cue");
  ok(gmSaw.has("N2") && gmSaw.has("N3"), "C: the GM's camera does go to the hidden and the unseen one");
  /* the turn of somebody concealed and the turn of nobody look the same to a player's camera */
  const X = mk(); X.turn("H2"); const x0 = lookOf(X, P1); X.turn("N2"); const x1 = lookOf(X, P1);
  eq([x1.cur, CP.cues(x0, x1), CP.cues(x0, { ...x0, cur: null })], [null, [], []], "C: a concealed turn = no turn, for the camera");
}

/* ------------------------------------------------------------------ D. the switch */
{
  const t = (key, params, fallback) => T0(key, params, fallback);
  eq(UI.CAMERA, CP.SWITCH, "D: the dock's switch goes round turn -> off -> all");
  for (const lang of [EN, PL]) for (const k of ["turn", "off", "all", "next"]) ok(typeof lang[`ITAC.map.cam.${k}`] === "string" && lang[`ITAC.map.cam.${k}`].length > 3, `D: ITAC.map.cam.${k} is said`);
  const c = UI.cameraOf({ camera: () => ({ follow: "turn" }) }, t);
  eq([c.follow, c.next], ["turn", "off"], "D: the button says the state and what a click gives");
  eq(UI.cameraOf({ camera: () => null }, t), null, "D: no map camera: no button");
}
done("check-cam");
