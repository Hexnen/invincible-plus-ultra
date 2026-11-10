// node scripts/tactics/check-view.mjs -- hidden information (spec 10): what a player's view and the public event stream may contain.
import { ok, eq, done, Table, seeded } from "./testkit.mjs";
import * as V from "./view-pure.mjs";

const HID = "HIDDEN01", SECRET = "Lurker";
const mk = () => { const T = new Table(); T.hero("H1", "p1").hero("H2", "p2").npc("N1", { health: 5, armor: [{ id: "vest", armor: 1 }] }).npc(HID, { name: SECRET, hidden: true, health: 4 }); T.order(["H1", "N1", "H2", HID]).turn("H1"); return T; };
const meta = (T) => ({ hidden: Object.values(T.c).filter((c) => c.hidden).map((c) => c.id), npc: Object.values(T.c).filter((c) => c.npc).map((c) => c.id) });
const p1 = { id: "p1", staff: false, owns: ["H1"] }, p2 = { id: "p2", staff: false, owns: ["H2"] };
const leak = (x) => { const s = JSON.stringify(x ?? null); return s.includes(HID) || s.includes(SECRET); };
const slug = (actor, target, extra = {}) => ({ op: "declare", actor, decl: { action: "slugfest", targets: [target], ...extra } });

/* ---- staff see the state itself */
{ const T = mk(); eq(V.viewFor(T.state, { id: "gm", staff: true, owns: [] }, meta(T)) === T.state, true, "staff: the state itself"); eq(V.viewFor(null, p1, {}), null, "no state, no view"); }

/* ---- a hidden combatant leaks nothing, at every stage of a flow that involves it */
{
  const T = mk();
  const stages = [];
  const look = (name) => stages.push([name, V.viewFor(T.state, p1, meta(T)), V.viewFor(T.state, p2, meta(T)), T.events.map((e) => V.publicEvent(T.state, e, meta(T))).filter(Boolean)]);
  await T.gm({ op: "statusAdd", combatant: HID, status: { id: "invisible" } });
  await T.gm({ op: "tokenAdd", token: { holder: HID, dice: 2, uses: 1, source: { kind: "power", name: "x" }, expires: { at: "roundEnd" } } });
  await T.gm({ op: "tokenAdd", token: { holder: "H1", from: HID, dice: -1, uses: 1, source: { kind: "power", name: "curse" }, expires: { at: "roundEnd" } } });
  await T.gm({ op: "npcPolicy", combatant: HID, policy: { block: "always" } });
  await T.gm({ op: "knowledgeSet", observer: HID, subject: "H1", value: "seen" });
  await T.gm({ op: "effectAdd", effect: { kind: "aura", owner: HID, targets: ["H1", HID], until: { at: "sceneEnd" } } });
  await T.gm({ op: "karmaNote", note: { who: HID, kind: "killed", note: "spared" } });
  look("edits");
  T.turn(HID);
  await T.gm(slug(HID, "H1"));                                   // the hidden NPC attacks a hero
  look("declared by hidden");
  ok(T.prompt("reaction", "H1") != null, "the hero still gets the reaction prompt");
  const mine = V.viewFor(T.state, p1, meta(T));
  eq(Object.values(mine.prompts).map((p) => [p.kind, p.about, p.options.map((o) => o.id)]), [["reaction", "H1", ["block", "pass"]]], "and sees it in the view, with its options");
  eq(mine.stack.map((i) => [i.masked, i.actor ?? null, i.decl ?? null]), [[1, null, null]], "the instance of a hidden actor is a masked stub");
  await T.req("p1", { op: "answer", prompt: T.prompt("reaction", "H1").id, value: "block" });
  await T.roll("attack", 2); look("attack rolled");
  await T.roll("def:H1", 0); look("resolved");
  if (T.prompt("stunts")) await T.answer("gm", "stunts", []);
  look("closed");
  T.turn("H2");
  await T.gm(slug("H2", HID));                                   // the GM runs an attack ON the hidden one for a player
  look("hidden targeted");
  await T.answer("gm", "reaction", "pass", HID);
  await T.roll("attack", 2); if (T.prompt("stunts")) await T.answer("gm", "stunts", []);
  look("hidden damaged");
  await T.gm({ op: "hazard", hazard: { kind: "fixed", amount: 9 }, targets: [HID, "H1"] });
  if (T.prompt("npcBroken")) { look("npcBroken card"); await T.answer("gm", "npcBroken", "ko", HID); }
  look("hazard");
  for (const [name, v1, v2, evs] of stages) { ok(!leak(v1), `no trace of the hidden combatant in p1's view (${name})`); ok(!leak(v2), `no trace in p2's view (${name})`); ok(!leak(evs), `no trace in the public events (${name})`); }
  ok(stages.length >= 9, "all stages were looked at");
  ok(leak(T.state) || leak(T.log), "the control: the GM state does contain it");
  ok(leak(T.events), "the control: the GM event stream does contain it");
  ok(!leak(V.journalFor(T.log, p1)), "no trace in the player's journal rows");
  ok(leak(V.journalFor(T.log, { staff: true })), "the GM's journal names it");
  eq(Object.keys(V.journalFor(T.log, p1)[0] ?? {}).includes("ops"), false, "player journal rows carry no operations");
}

/* ---- what a player sees of visible things */
{
  const T = mk();
  await T.req("p1", slug("H1", "N1"));
  const m = meta(T);
  let v1 = V.viewFor(T.state, p1, m), v2 = V.viewFor(T.state, p2, m);
  for (const v of [v1, v2]) { eq(["txOpen", "seen", "npc", "karma", "seq"].filter((k) => k in v), [], "GM bookkeeping is not in a player view"); eq(v.stack[0].hist ?? v.stack[0].overrides ?? v.stack[0].tx ?? null, null, "no history snapshots, overrides or transaction ids"); }
  eq(Object.values(v1.prompts).map((p) => [p.kind, p.to, p.options ?? null]), [["reaction", "gm", null]], "a card on the GM desk is a 'waiting for the GM' stub without options");
  await T.answer("gm", "reaction", "block", "N1");
  await T.roll("attack", 3); await T.roll("def:N1", 1);
  v1 = V.viewFor(T.state, p1, m); v2 = V.viewFor(T.state, p2, m);
  eq([v1.stack[0].rolls.attack.pool != null, v1.stack[0].rolls["def:N1"].pool ?? null, v1.stack[0].rolls["def:N1"].attr ?? null, v1.stack[0].rolls["def:N1"].sixes], [true, null, null, 1], "own pool visible; the unrevealed NPC's pool and attribute are not, its sixes (rolled openly) are");
  eq([v1.stack[0].rolls.attack.req.rid != null, v2.stack[0].rolls.attack.req.rid ?? null], [true, null], "the roll request id only for the user who must roll");
  eq([Object.values(v1.prompts).find((p) => p.kind === "stunts")?.options.length > 0, Object.values(v2.prompts).find((p) => p.kind === "stunts")?.options ?? null], [true, null], "the stunt prompt with options for its addressee, a stub for the others");
  await T.gm({ op: "reveal", combatant: "N1", stats: true });
  eq(V.viewFor(T.state, p1, m).stack[0].rolls["def:N1"].pool != null, true, "after the GM reveals the opponent's statistics the pool shows");
  const evs = T.events.map((e) => V.publicEvent(T.state, e, m)).filter(Boolean);
  eq(evs.filter((e) => ["override", "gm", "trigger"].includes(e.type)).length, 0, "GM-only event types never reach the public stream");
  eq(T.events.filter((e) => e.type === "override").length > 0, true, "the control: there were override events");
  const U = mk();
  await U.req("p1", slug("H1", "N1")); await U.answer("gm", "reaction", "pass", "N1"); await U.roll("attack", 1);
  const d = U.events.find((e) => e.type === "damage"), pd = V.publicEvent(U.state, d, meta(U));
  eq([d.armor, pd.armor ?? null, pd.base ?? null, pd.taken], [1, null, null, 1], "damage to an unrevealed NPC: the public event keeps what was taken, not its Armor");
  // a subject the viewer's combatant has not seen
  const G = mk();
  await G.gm({ op: "knowledgeSet", observer: "H1", subject: "N1", value: "unseen" });
  await G.req("p1", slug("H1", "N1", { blind: true }));
  ok(G.prompt("gate") != null, "gate card exists");
  const gv = V.viewFor(G.state, p1, meta(G));
  eq([Object.keys(gv.prompts).length, JSON.stringify(gv).includes("N1")], [0, false], "a subject unseen by the viewer's only combatant is concealed like a hidden one (own attack on it shows no target)");
  eq(JSON.stringify(V.viewFor(G.state, p2, meta(G))).includes("N1"), true, "another player who does see it is not affected");
  eq(V.viewFor(G.state, p2, meta(G)).knowledge.H1 ?? null, null, "knowledge rows of other observers are not shown");
  // triggers and exception text
  const X = mk();
  await X.gm({ op: "triggerAdd", trigger: { at: "enterZone", owner: "H2", run: { type: "note" } } });
  eq([V.viewFor(X.state, p1, meta(X)).triggers.length, V.viewFor(X.state, p2, meta(X)).triggers.length], [0, 1], "an armed trigger is shown to its owner only");
  X.setRange("H1", "N1", 2);
  await X.req("p1", slug("H1", "N1", { exception: { text: "secret plan" } }));
  eq([JSON.stringify(V.viewFor(X.state, p2, meta(X))).includes("secret plan"), V.viewFor(X.state, p1, meta(X)).stack[0].decl.exception.text], [false, "secret plan"], "an exception request is between its author and the GM");
}

/* ---- scrub property: random trees */
{
  const rnd = seeded(7), ids = new Set([HID]);
  const gen = (d) => { const r = rnd(); if (d > 4 || r < 0.2) return [1, "x", HID, `def:${HID}`, "H1", null, true][Math.floor(rnd() * 7)];
    if (r < 0.5) return Array.from({ length: Math.floor(rnd() * 4) }, () => gen(d + 1));
    return Object.fromEntries(Array.from({ length: Math.floor(rnd() * 5) }, (_, i) => [[`k${i}`, HID, "about", "target", `stun:${HID}`, "who"][Math.floor(rnd() * 6)], gen(d + 1)])); };
  let bad = 0; for (let i = 0; i < 400; i++) if (leak(V.scrub(gen(0), ids))) bad++;
  eq(bad, 0, "scrub: 400 random trees, no trace left");
  eq(V.scrub({ a: 1, b: ["H1"] }, ids), { a: 1, b: ["H1"] }, "scrub leaves the rest alone");
}
done("check-view");
