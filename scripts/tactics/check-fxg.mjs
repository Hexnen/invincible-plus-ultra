// node scripts/tactics/check-fxg.mjs -- fixer G after adversary 9 (live): D115 (a drive gives the watchers a move beat), U112 (the way-to-roll
// window of a power's use in the client's language), U113 (the token's and the combatant's "hidden" are one switch in a fight), U120 (a
// news line written while its actor was hidden stays hidden after a reveal). What can be held without Foundry; the live look is in
// dev/combat-handoff.md.
import { readFileSync } from "node:fs";
import { ok, eq, done } from "./testkit.mjs";
import * as CP from "./ui/camera-pure.mjs";
import * as V from "./view-pure.mjs";
import * as N from "../i18n/item-names.mjs";

const src = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

/* ---- D115: a drive (vehicleHandle to another zone) is a walk for the watching seats */
{
  const look = (o = {}) => CP.look({ ledger: { eve: {}, omni: {}, kid: {}, veh: {} }, prompts: {}, init: { curMember: "eve" }, round: 2 }, { me: "u", mine: o.mine ?? ["kid"], armed: o.armed ?? null });
  const drive = { type: "actionDeclared", inst: "i9", actor: "eve", decl: { action: "vehicleHandle", targets: [], to: "z5" }, targets: [] };
  eq(CP.walkTo(drive.decl), "z5", "D115: a drive's public declaration names where it goes");
  eq([CP.walkTo({ action: "move", to: "z2" }), CP.walkTo({ action: "x", mode: "fly", to: "z2" }), CP.walkTo({ action: "shoot", to: "z2" }), CP.walkTo({ action: "vehicleHandle" })], ["z2", "z2", null, null], "D115: a move or a mode walks; a shot or a drive without a place does not");
  const s = CP.eventShot(drive, look());
  eq(s && { beat: s.beat, focus: s.focus, zone: s.zone, key: s.key }, { beat: "move", focus: "eve", zone: "z5", key: "i9" }, "D115: a watcher (Kid's player) gets the move beat of Eve's drive");
  eq(CP.eventShot(drive, look({ mine: ["omni"] }))?.beat, "move", "D115: a passenger's player gets it too (Omni rides, Eve drives)");
  eq(CP.eventShot(drive, look({ mine: ["eve"] })), null, "D115: the driver's own seat gets no shot of its own drive");
  eq(CP.eventCue(drive, look({ mine: ["eve"] }))?.why, "ownMove", "D115: ...but the quiet cue of its own unit walking");
  const c = CP.eventCue(drive, look());
  eq(c && { why: c.why, focus: c.focus, zone: c.zone, after: c.after }, { why: "move", focus: "eve", zone: "z5", after: "eve" }, "D115: the quiet cue of a watcher whose camera is turned down");
  eq(CP.eventShot(drive, look({ armed: "shoot" })), null, "D115: while the user aims, still no shot");
  const hidden = CP.look({ ledger: { kid: {} }, prompts: {}, init: {}, round: 2 }, { me: "u", mine: ["kid"] });
  eq([CP.eventShot(drive, hidden), CP.eventCue(drive, hidden)], [null, null], "D115: a drive by somebody this view does not hold gives nothing");
}

/* ---- U112: the way-to-roll window of a power's use ("Invincilble: Strike - Normal", sic) */
{
  N.setLang("pl");
  eq(N.looseHead("Invincilble: Strike - Normal"), "Invincilble: Cios - zwykłe użycie", "U112: the power's name before the last ' - ' and its use");
  eq(N.looseHead("Invincible: Omni-Man - Strike - Normal"), "Invincible: Omni-Man - Cios - zwykłe użycie", "U112: an actor's name in front stays");
  eq(N.looseHead("Invincilble: Soldier - Bijatyka"), "Invincilble: Soldier - Bijatyka", "U112: a text that names no power stays as written");
  eq(N.looseHead("Invincilble: Strike"), "Invincilble: Strike", "U112: no ' - ' after the prefix: left to the existing paths");
  eq(N.looseHead("Strike - Normal"), "Strike - Normal", "U112: no prefix: left to the existing paths");
  const s = src("../i18n/item-names.mjs");
  ok(/const next = looseHead\(text\);/.test(s) && /continue; \}\s*\n\s*const next = looseHead/.test(s), "U112: looseTitle tries the whole title only when the tail named no power");
  N.setLang(null);
}

/* ---- U113: one switch of "hidden" in a fight */
{
  eq([V.hideFollows(false, true), V.hideFollows(true, false), V.hideFollows(true, undefined), V.hideFollows(false, false), V.hideFollows(true, true), V.hideFollows(undefined, true)], [true, true, true, false, false, false], "U113: the other switch follows only when it differs");
  const m = src("./main.mjs");
  ok(/Hooks\.on\("updateToken", \(td, ch, _o, userId\)/.test(m) && /Hooks\.on\("updateCombatant", \(cb, ch, _o, userId\)/.test(m), "U113: both switches are listened to");
  ok((m.match(/userId !== game\.user\.id \|\| !Store\.isStaff\(game\.user\)/g) ?? []).length === 2, "U113: carried only on the client of the GM who flipped it");
  ok(/cb\.update\(\{ hidden: ch\.hidden \}\)/.test(m) && /td\.update\(\{ hidden: ch\.hidden \}\)/.test(m), "U113: the token carries to the combatant and back");
}

/* ---- U120: a news line of a hidden actor stays hidden after the reveal */
{
  const news = [{ id: "n1", kind: "action", actor: "tur", action: "shoot", rows: [{ target: "kid", hit: false }], hid: 1 }, { id: "n2", kind: "action", actor: "tur", action: "shoot", rows: [{ target: "kid", hit: true }] }];
  const state = { v: 1, rev: 1, round: 1, ledger: { tur: {}, kid: {} }, news, init: {} };
  const ids = (viewer) => (V.viewFor(state, viewer, { hidden: [] }).news ?? []).map((n) => n.id);
  eq(ids({ id: "p2", owns: ["kid"] }), ["n2"], "U120: the target's player does not get the line of the attack made unseen");
  eq(ids({ id: "p1", owns: ["omni"] }), ["n2"], "U120: nor does anybody else at the table");
  eq(ids({ id: "px", owns: ["tur"] }), ["n1", "n2"], "U120: the actor's own player keeps it");
  eq(V.viewFor(state, { staff: true }, {}).news.length, 2, "U120: the GM keeps it");
  const e = src("./engine-pure.mjs");
  ok(/pushNews\(X, \{ \.\.\.newsOf\(I\), \.\.\.\(hiddenNow\(X, I\) \? \{ hid: 1 \} : \{\}\) \}\)/.test(e), "U120: the engine marks the line when it is written");
}

/* ---- D117: Foundry keeps no movement trail of a token in a fight that has the module's state */
{
  const S = await import("./state-pure.mjs"), O = await import("./ops-pure.mjs"), { dice } = await import("../rules/index.mjs");
  const { recordsTrail } = await import("./combat-class.mjs");
  const part = (id, o = {}) => ({ id, hero: false, owners: [], defeated: false, challenge: false, summonOf: null, veteran: false, reflexes: false, resolve: 3, ...o });
  const ctx = { user: "gm", staff: true, owns: () => true, parts: [part("ca", { hero: true, owners: ["u1"] }), part("cb")], ...(dice?.seededRng ? { rng: dice.seededRng(4) } : {}) };
  const st = O.reduce(null, { type: "start", mode: "tactical" }, ctx).state;
  const ours = { id: "c1", flags: { [S.MOD_ID]: { tactics: { state: S.serialize(st) } } } }, plain = { id: "c2", flags: {} };
  eq([recordsTrail(true, ours), recordsTrail(true, plain), recordsTrail(false, plain), recordsTrail(true, null)], [false, true, false, true], "D117: no trail in our fight; any other combat (or none) keeps core's answer");
  const cc = src("./combat-class.mjs");
  ok(/P\._shouldRecordMovementHistory = function \(\) \{ const base = orig\.call\(this\);/.test(cc) && /install\(\{ late = false \} = \{\}\) \{\s*try \{\s*patchTrail\(\);/.test(cc), "D117: core's method is wrapped once, at install, and still asked");
}

done("check-fxg");
