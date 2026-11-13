/* node scripts/tactics/check-fxk2.mjs -- FXK2: live fight 2 (FF7) findings and FXG2's leftover (dev/combat-defects.md, combat-usability.md).
   Fights run through the REAL director, engine and round driver (testkit Table; the fake map of check-kit-map), and the answers through
   the relay's own envelope (relay-pure.wireEnv), as a player's client gets them.
     D210   a refusal code of the director or the round driver reached the player as "internal" (the relay let only listed codes through):
            the glider's "must glide" with its gmMayAllow; the class: every code a machine can answer is listed, worded in both languages
            and reads as itself after the relay (read from the sources, so a new code cannot be added without that)
     OWN    allies the GM marked (Animal Control, "summoned by") of an owner who is DEFEATED but still in the Combat act on a card of
            their own (FXG2-2 had it for an owner who left); the engine's own summoned allies still leave
     U208   a refused way of moving speaks of a move, not of an attack ("too far for this attack")
     U209   the desk's Fall that came to nothing tells the GM
     U213   the GM's outcome card does not repeat the actor's name under the header that names it
     HELD   (FF7's note on D198) a held / snared / trapped character is not offered an answer that is itself an attack it may not make
            (Quick Blast, Sudden Strike): offered before, charged 1 stress, then dropped; ruling FXK2-R1. Its block, dodge and moves
            stay refused (FXC2-R1, ANSE-R1), so with nothing left no card is right. Luck Control on one's own injury while broken: none
            [B2707] (ruling FXK2-R2), another holder still is asked. */
import { Table, ok, eq, done } from "./testkit.mjs";
import { MTable } from "./check-kit-map.mjs";
import * as O from "./ops-pure.mjs";
import * as R from "./relay-pure.mjs";
import * as E from "./engine-pure.mjs";
import * as K from "./kit-pure.mjs";
import * as Sys from "./system-adapter.mjs";
import * as UM from "./ui/model-pure.mjs";
import * as FK from "./flows/kit.mjs";
import { whyOf } from "./ui/feedback-pure.mjs";
import { EN, PL, t, tIn, errText } from "./lang.mjs";
import { REAL } from "./check-pwb-items.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const cardOf = (T, id) => !!T.state.init.slots.find((s) => s.members.includes(id));
const next = (T) => { const r = O.reduce(T.state, { type: "nextTurn" }, { user: "gm", staff: true, owns: () => true, parts: T.parts(), rng: T.rng }); if (r.ok) T.state = r.state; return r.ok; };
const real = (name, o = {}) => { const r = REAL[name]; return Sys.kitSource({ name: "x", items: [{ id: o.id ?? r.id, name, type: r.type, system: { level: r.level, power: o.power ?? null, boosts: [], automations: r.automations }, effects: [], flags: {} }] }).items[0]; };
const kitFacts = (T) => { const f0 = T.facts.bind(T); T.facts = () => { const f = f0(); return { ...f, canTalk: () => true, weapon: (cid, ref) => (ref == null || ref === "unarmed" ? { ...f.weapon(cid, ref), ...(T.c[cid]?.kit?.unarmed ?? {}) } : T.c[cid]?.kit?.weapons.find((w) => w.id === ref) ?? f.weapon(cid, ref)) }; }; return T; };
/* (read through the module so the suite runs to its end on a tree without them: each then fails as a check, not as a crash) */
const moveWhy = UM.moveWhy ?? ((tt, r, p = {}, o = {}) => whyOf(tt, r, p, { ...o, ctx: "move" })), fallNote = UM.fallNote ?? (() => null), attackerFault = FK.attackerFault ?? (() => "missing");
const give = (T, cid, items) => { const c = T.c[cid]; c.kit = K.build({ items, attrs: c.attrs }); c.pass = c.kit.pass; return T; };

/* ================================================================== D210: the glider's refusal reaches the player */
{
  const glider = () => { const T = kitFacts(new MTable()); T.hero("H1", "p1", { movement: [{ mode: "flight", tier: "basic", limits: ["gliding"] }] }).npc("N1", { health: 6 }); T.put("H1", "z1:elevated").put("N1", "z1"); T.map._.tokens.H1.airborne = true; give(T, "H1", []); give(T, "N1", []); T.order(["H1", "N1"]).turn("H1"); return T; };
  const T = glider();
  const w = R.wireEnv(await T.req("p1", { op: "endTurn", actor: "H1" }));
  eq([w.ok, w.error?.code, w.error?.params?.gmMayAllow], [false, "mustGlide", 1], "D210 (PW094 [B2004]): after the relay the glider's end of turn is refused as 'must glide', the GM's way kept");
  eq([errText(w.error), tIn("pl", w.error.key)], [EN["ITAC.err.mustGlide"], PL["ITAC.err.mustGlide"]], "D210: it reads as its own sentence, not 'something went wrong (internal)'");
  ok(/land/.test(EN["ITAC.err.mustGlide"]) && /wyląduj/.test(PL["ITAC.err.mustGlide"]) && /[.]$/.test(EN["ITAC.err.mustGlide"]) && /[.]$/.test(PL["ITAC.err.mustGlide"]), "D210: the sentence says the way out (move or land), in both languages");
  eq(code(await T.gm({ op: "endTurn", actor: "H1", force: true })), "ok", "D210: the GM still ends it");
}
/* the round driver's own "nobody can act" (a GM note, combat-class tell) after the relay */
{
  const T = new Table(); T.hero("H1", "p1").npc("N1"); T.order(["H1", "N1"]).turn("H1");
  for (const id of ["H1", "N1"]) T.c[id].defeated = true;
  await T.gm({ op: "roster" });
  let last = null; for (let i = 0; i < 4; i++) { last = await T.gm({ op: "nextTurn" }); if (code(last) !== "ok") break; }
  const w = R.wireEnv(last);
  eq(w.error?.code, "nobodyActs", "D210 class: the round driver's 'nobody can act' after the relay is itself (combat-class tells it as a note)");
}
/* the class: every top-level refusal of the sources is let through and worded */
{
  const files = [...readdirSync(dir).filter((f) => f.endsWith(".mjs") && !f.startsWith("check-") && !f.startsWith("lang") && f !== "testkit.mjs"), ...readdirSync(join(dir, "ui")).filter((f) => f.endsWith(".mjs")).map((f) => `ui/${f}`)];
  const codes = new Map(), add = (c, f) => { if (!codes.has(c)) codes.set(c, new Set()); codes.get(c).add(f); };
  for (const f of files) {
    const src = readFileSync(join(dir, f), "utf8");
    /* the error envelope of the director, the engine, the round driver, the transport: bad("x"), err("x"), S.err("x"), R.bad("x"),
       { code: "x" }, err = "x" (the engine's GM edits), and a code set beside an `illegal` / reasonCode choice */
    for (const re of [/\b(?:bad|err|S\.err|R\.bad|Rp\.bad)\("([A-Za-z]+)"/g, /\bcode: "([A-Za-z]+)"/g, /\berr = "([A-Za-z]+)"/g]) for (const m of src.matchAll(re)) add(m[1], f);
  }
  /* the round driver hands the cards' own refusals on as the code (ops-pure setCard / group / ungroup / reorderGroup: err(r.reason));
     "cardTaken" is turned into "illegal" there (pinned below) */
  for (const m of readFileSync(join(dir, "initiative-pure.mjs"), "utf8").matchAll(/\bfail\("([A-Za-z]+)"/g)) if (m[1] !== "cardTaken") add(m[1], "initiative-pure.mjs");
  ok(/err\(r\.reason === "cardTaken" \? "illegal" : r\.reason/.test(readFileSync(join(dir, "ops-pure.mjs"), "utf8")), "D210 class: (a taken card is answered 'illegal')");
  ok(codes.size >= 20 && codes.has("mustGlide") && codes.has("nobodyActs") && codes.has("noPrev"), `D210 class: the refusals are read from the sources (${codes.size})`);
  const internal = errText(R.bad("internal").error);
  for (const [c, fs] of codes) {
    const where = [...fs].join(", ");
    ok(R.RELAY_CODES.includes(c), `D210 class: the code '${c}' (${where}) is let through by the relay (relay-pure RELAY_CODES)`);
    ok(`ITAC.err.${c}` in EN && `ITAC.err.${c}` in PL, `D210 class: the code '${c}' (${where}) has its sentence in both languages`);
    const w = R.wireEnv({ ok: false, error: { code: c, key: `ITAC.err.${c}`, params: { x: 1 } } });
    ok(w.error.code === c && w.error.params.x === 1 && (c === "internal" || errText(w.error) !== internal), `D210 class: '${c}' reads as itself after the relay, its parameters kept`);
  }
  for (const c of R.RELAY_CODES) ok(`ITAC.err.${c}` in EN && `ITAC.err.${c}` in PL, `D210 class: every listed code is worded: ${c}`);
  eq(R.wireEnv({ ok: false, error: { code: "made-up", key: "<img>" } }).error.code, "internal", "D210 class: an unknown code still never reaches a client as a key");
}

/* ================================================================== OWN: allies of a defeated owner */
{
  const T = new Table();
  T.hero("H1", "p1").npc("N1", { name: "Boss" }).npc("N2"); T.order(["H1", "N1", "N2"]).turn("H1");
  T.npc("S1", { name: "Hounds", kind: "minions", summonOf: "N1" }); await T.gm({ op: "roster" });
  eq([cardOf(T, "S1"), (T.state.summons ?? []).map((s) => [s.owner, s.combatants])], [false, [["N1", ["S1"]]]], "OWN: (the hounds act on the boss's turn, no card)");
  T.c.N1.defeated = true; await T.gm({ op: "roster" });
  eq([cardOf(T, "S1"), T.state.summons ?? []], [true, []], "OWN (FXK2-1): the boss defeated but in the Combat, the hounds hold a card of their own");
  const turns = new Set();
  for (let i = 0; i < 10; i++) { if (!next(T)) break; if (T.state.init.curMember) turns.add(T.state.init.curMember); }
  ok(turns.has("S1") && T.state.round >= 3, `OWN: the hounds get turns in the rounds after (${[...turns].join(",")})`);
  for (let i = 0; i < 6 && T.state.init.curMember === "S1"; i++) next(T);      // (a card that is being played stays to its turn's end)
  T.c.N1.defeated = false; await T.gm({ op: "roster" });
  eq([cardOf(T, "S1"), (T.state.summons ?? []).map((s) => [s.owner, s.combatants])], [false, [["N1", ["S1"]]]], "OWN: the boss up again, the hounds act on its turn again (their card goes)");
}
{
  const T = new Table();
  T.hero("H1", "p1").npc("N1").npc("N2"); T.order(["H1", "N1", "N2"]).turn("H1");
  T.npc("S1", { kind: "minions", summonOf: "N1" }); T.c.S1.summon = { kind: "summon", auto: 1 }; await T.gm({ op: "roster" });
  T.c.N1.defeated = true; T.c.N1.present = false; await T.gm({ op: "roster" });      // (engine.mjs: a defeated combatant is not present)
  await T.gm({ op: "nextTurn" });      // (the leave is the director's sweep after a change; a roster that changes nothing has none)
  eq([!!T.c.S1, T.evs("draw").some((e) => e.members?.includes("S1"))], [false, false], "OWN: the engine's own summoned allies of a defeated owner leave [B1812], never dealt a card");
}

/* ================================================================== U208: a way of moving refused for its length */
for (const l of ["en", "pl"]) {
  const L = l === "en" ? EN : PL, tt = (k, p, f) => tIn(l, k, p, f);
  const w = moveWhy(tt, "tooFar", { total: 3 });
  eq([w.text, w.fix], [L["ITAC.why.move.tooFar"], L["ITAC.fix.move.tooFar"]], `U208 ${l}: a way of moving too far says so in a move's words`);
  ok(w.text !== L["ITAC.why.tooFar"] && !/atak|attack/i.test(w.text + w.fix), `U208 ${l}: not the attack's "too far for this attack"`);
  eq(moveWhy(tt, "held").text, L["ITAC.why.held"], `U208 ${l}: a reason with no move words of its own keeps its sentence`);
}
{
  const src = readFileSync(join(dir, "ui/model-pure.mjs"), "utf8"), body = src.slice(src.indexOf("function movePanel("), src.indexOf("function doorPanel("));
  const calls = [...body.matchAll(/\b(whyText|whyOf|wayWhy|moveWhy)\(([^()]|\([^()]*\))*\)/g)].map((m) => m[0]);
  ok(calls.length >= 5 && calls.every((c) => /^(wayWhy|moveWhy)\(/.test(c) || /MOVE\)$/.test(c)), `U208: every refusal of the move panel is worded as a move (${calls.filter((c) => !(/^(wayWhy|moveWhy)\(/.test(c) || /MOVE\)$/.test(c))).join(" ; ")})`);
}

/* ================================================================== U209: a fall that came to nothing tells the GM */
{
  const T = new MTable(); T.hero("H1", "p1", { name: "Eve" }).npc("N1"); T.put("H1", "z6:elevated").put("N1", "z1"); T.order(["H1", "N1"]).turn("H1");
  const env = await T.gm({ op: "fall", combatant: "H1" });
  eq([env.ok, T.c.H1.health === T.c.H1.maxHealth || T.c.H1.health > 0], [true, true], "U209: (a fall from a standing roof: no fall, no damage, ANSF)");
  eq(fallNote(T.state, env.inst, (k, p) => tIn("pl", k, p), "Eve"), "Eve stoi na dachu: bez upadku.", "U209: the GM is told in words what came of it");
  const T2 = new MTable(); T2.hero("H1", "p1").npc("N1"); T2.put("H1", "z1").put("N1", "z1"); T2.order(["H1", "N1"]).turn("H1");
  const e2 = await T2.gm({ op: "fall", combatant: "H1" });
  eq(fallNote(T2.state, e2.inst, t, "Kid"), "Kid: nothing to fall from.", "U209: one on the ground: nothing to fall from");
  eq(fallNote(T.state, "nope", t, "x"), null, "U209: another answer says nothing");
  ok(/req\.op === "fall"\) \{ const s = Model\.fallNote\(Api\.state\(combat\), env\.inst/.test(readFileSync(join(dir, "ui/main.mjs"), "utf8")), "U209: the desk's Fall shows the note");
}

/* ================================================================== U213: the outcome card names the actor once */
for (const l of ["en", "pl"]) {
  const tt = (k, p, f) => tIn(l, k, p, f);
  const facts = { staff: true, me: "gm", c: (id) => ({ H1: { name: "Omni-Man" }, N1: { name: "Soldier" } })[id] ?? null, view: null };
  for (const d of [{ rolled: false, name: "Animal Control", animals: ["N1"] }, { rolled: true, name: "Animal Control", attr: "presence", sixes: 2, suggests: "ok" }]) {
    const card = UM.askData({ id: "p1", kind: "outcome", to: "gm", about: "H1", options: [{ id: "ok", label: "ITAC.opt.ok" }], data: d }, { t: tt, facts, desk: true });
    const text = card.lines.map((x) => (typeof x === "string" ? x : x.quote ?? "")).join(" ");
    eq([card.about, (text.match(/Omni-Man/g) ?? []).length, /Animal Control/.test(text)], ["Omni-Man", 0, true], `U213 ${l}: the header names the actor, the lines do not again (${text})`);
  }
}

/* ================================================================== HELD: answers that are attacks */
{
  const cases = [["Blast", "Quick Blast", "shoot"], ["Strike", "Sudden Strike", "slugfest"]];
  for (const [pwN, bN, atk] of cases) for (const status of [null, "grappled", "snared", "moveOnly", "trapped"]) {
    const pw = real(pwN), b = real(bN, { power: pw.id });
    const T = kitFacts(new MTable()); T.hero("H1", "p1").npc("N1", { health: 6 }); T.put("H1", "z1").put("N1", "z1");
    give(T, "H1", [pw, b]); give(T, "N1", [real("Blast")]); T.order(["H1", "N1"]).turn("N1");
    if (status) await T.gm({ op: "statusAdd", combatant: "H1", status: status === "moveOnly" ? { id: "snared", data: { moveOnly: 1 } } : { id: status } });
    eq(code(await T.gm({ op: "declare", actor: "N1", decl: atk === "shoot" ? { action: "shoot", targets: ["H1"], weapon: T.c.N1.kit.weapons[0]?.id } : { action: atk, targets: ["H1"] } })), "ok", `HELD ${bN}/${status}: (attacked)`);
    const p = T.prompt("reaction", "H1"), o = p?.options.find((x) => x.id.startsWith("r:") && !x.disabled);
    /* the book: held [B2496] and snared [B1606] make no slugfest or shooting attack; trapped [B2438] no slugfest; Immobilize Only acts */
    const may = status === null || status === "moveOnly" || (status === "trapped" && atk === "shoot");
    eq(!!o, may, `HELD (FXK2-R1) ${bN} while ${status ?? "free"}: ${may ? "offered" : "not offered"}`);
    if (o) {
      await T.req("p1", { op: "answer", prompt: p.id, value: o.id });
      ok(!JSON.stringify(T.state.stack.map((i) => i.data?.notes ?? [])).includes("pushRefused"), `HELD ${bN} while ${status ?? "free"}: the answer, once taken, is made (never refused after being paid)`);
    } else eq(T.c.H1.resolve, 5, `HELD ${bN} while ${status}: nothing charged`);
  }
  /* the fit and the attack's own legality say the same for every body state (one list of reasons, two places) */
  for (const status of ["grappled", "snared", "moveOnly", "trapped", "grappling"]) for (const kind of ["slugfest", "shooting", "charge", "grapple"]) {
    const T = new Table(); T.hero("H1", "p1").npc("N1"); T.order(["H1", "N1"]).turn("H1");
    await T.gm({ op: "statusAdd", combatant: "H1", status: status === "moveOnly" ? { id: "snared", data: { moveOnly: 1 } } : status === "grappling" ? { id: "grappling", data: { held: "N1" } } : { id: status } });
    const f = T.facts(), v = { state: T.state, facts: f };
    const why = attackerFault(v, "H1", kind);
    const action = kind === "shooting" ? "shoot" : kind === "charge" ? "charge" : kind === "grapple" ? "grapple" : "slugfest";
    const r = await T.req("p1", { op: "declare", actor: "H1", decl: { action, targets: ["N1"] } });
    const body = ["held", "snared", "trapped", "carriedAloft", "grappling"];
    eq(why, body.includes(r.error?.params?.reason) ? r.error.params.reason : null, `HELD: ${status} / ${kind}: the answer's test and the declaration agree (${why} / ${r.error?.params?.reason ?? code(r)})`);
  }
}
/* Luck Control on one's own injury while broken: none [B2707]; another holder in reach is asked */
{
  const src = readFileSync(join(dir, "flows/kit.mjs"), "utf8");
  ok(/if \(id === t && !\(Number\(dm\.healthBefore\) - Number\(dm\.taken\) > 0\)\) return false;/.test(src), "FXK2-R2 [B2707]: a broken character uses no power, Luck Control on its own injury neither (kept)");
}
void E;
done("check-fxk2");
