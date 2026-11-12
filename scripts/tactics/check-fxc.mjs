// node scripts/tactics/check-fxc.mjs -- the interface and text defects of "Adversary 8 (live)" (dev/combat-defects.md D107-D109) and the
// usability rows U99, U101-U103, U105-U109 (dev/combat-usability.md): what can be held without Foundry. The live look is the orchestrator's.
import { readFileSync } from "node:fs";
import { ok, eqc as eq, done } from "./testkit.mjs";
import * as Src from "./source.mjs";
import * as O from "./ops-pure.mjs";
import * as S from "./state-pure.mjs";
import * as D from "./desk-pure.mjs";
import * as V from "./view-pure.mjs";
import * as M from "./ui/model-pure.mjs";
import * as BP from "./ui/board-pure.mjs";
import * as Keys from "./ui/keys-pure.mjs";
import * as Lay from "./ui/layout-pure.mjs";
import * as MP from "./movement-pure.mjs";
import { placeTip } from "./ui/tip-pure.mjs";
import { EN, PL, t as T0, tIn } from "./lang.mjs";
import { dice } from "../rules/index.mjs";

const src = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const missing = new Set();
const t = (key, params, fallback) => { if (fallback === undefined && !(key in EN)) missing.add(key); return T0(key, params, fallback); };
const lang = (l) => { globalThis.game = { i18n: { lang: l } }; };

/* ---- D107: the bar's plate says why nobody has the turn (it said "drawing" for a whole chase) */
{
  const part = (id, o = {}) => ({ id, hero: false, owners: [], defeated: false, challenge: false, summonOf: null, veteran: false, reflexes: false, resolve: 3, ...o });
  const ctx = { user: "gm", staff: true, owns: () => true, parts: [part("ca", { hero: true, owners: ["u1"] }), part("cb")], rng: dice.seededRng(4) };
  const doc = (state) => ({ id: "combat1", flags: { [S.MOD_ID]: { tactics: { state: S.serialize(state) } } }, combatants: [{ id: "ca", tokenId: "ta" }, { id: "cb", tokenId: "tb" }] });
  const st = O.reduce(null, { type: "start", mode: "tactical" }, ctx).state;
  eq(Src.waitKind(doc(st)), null, "D107: somebody has the turn: no plate");
  for (const ph of ["draw", "roundStart", "roundEnd", "sceneEnd"]) eq(Src.waitKind(doc({ ...st, phase: ph })), ph, `D107: the plate of the ${ph} phase`);
  eq(Src.waitKind(doc({ ...st, kind: "chase", phase: "roundEnd", init: { ...st.init, slots: [], cur: null, curMember: null } })), "chase", "D107: a chase reads as a chase, not as drawing cards");
  eq(Src.waitKind(doc({ ...st, init: { ...st.init, curMember: null, cur: null } })), "nobody", "D107: turns but no member: waiting, no draw named");
  eq(Src.waitKind(null), null, "D107: not ours: nothing");
  const bar = src("../combat/bar.mjs"), cl = src("../combat/lang.mjs");
  ok(/setText\(waitEl, waitShort\(model\.waitKind\)\)/.test(bar) && !/setText\(waitEl, t\("ICB\.Bar\.WaitingShort"\)\)/.test(bar), "D107: the plate's words follow the kind of waiting");
  for (const k of ["chase", "roundStart", "roundEnd", "sceneEnd", "other"]) ok((cl.match(new RegExp(`"ICB\\.Bar\\.Wait\\.${k}"`, "g")) ?? []).length === 2 && (cl.match(new RegExp(`"ICB\\.Bar\\.Wait\\.${k}\\.Say"`, "g")) ?? []).length === 2, `D107: ICB.Bar.Wait.${k} in both languages`);
  ok(/"ICB\.Bar\.Wait\.chase": "Pościg"/.test(cl), "D107: Polish 'Pościg' (glossary 92)");
}

/* ---- D108: the waiting line names the moment of the queue; a challenge's side effect in the reader's words */
lang("pl");
{
  const state = { prompts: { p1: { id: "p1", kind: "triggerQueue", step: "turnStart", to: "gm", about: "E1", options: [{ id: "x", label: "Challenge B: toxin", data: { type: "challengeRoll", effect: "toxin", challenge: "C2", combatant: "E1" } }], data: { at: "turnStart", key: "1:t" } } }, stack: [] };
  const w = D.waitingOn(state, { c: (id) => ({ name: id === "E1" ? "Atom Eve" : "Challenge B" }) });
  eq(w[0].data, { at: "turnStart" }, "D108: the waiting entry of a queue carries its moment");
  const f = { staff: true, me: "gm", c: (id) => ({ name: id === "E1" ? "Atom Eve" : id === "C2" ? "Challenge B" : id }) };
  const line = M.waitingData(w, f, t)[0].what[0];
  eq(line, PL["ITAC.Prompt.triggerQueue.Title.turnStart"].replace("{name}", "Atom Eve"), "D108: 'Początek tury: Atom Eve' (was 'Początek rundy (Atom Eve)')");
  const q = M.askData({ id: "p1", kind: "triggerQueue", multi: true, data: { at: "turnStart" }, aboutName: "Atom Eve", answerReq: (x) => ({ x }), options: [{ id: "x", label: "Challenge B: toxin", data: { type: "challengeRoll", effect: "toxin", challenge: "C2" } }, { id: "y", label: "Challenge: blast", data: { type: "challenge", effect: "blast", challenge: "C2" } }, { id: "z", label: "Old: toxin", data: { type: "challengeRoll" } }] }, { t, facts: f, desk: true, round: 2 });
  eq(q.options.map((o) => o.label), ["Challenge B: toksyna", "Challenge B: wybuch", "Old: toxin"], "D108: the effect in the reader's words; a queue written before keeps its old words");
  lang("en");
  const q2 = M.askData({ id: "p1", kind: "triggerQueue", multi: true, data: { at: "roundStart" }, answerReq: (x) => ({ x }), options: [{ id: "x", label: "Challenge B: toxin", data: { type: "challengeRoll", effect: "toxin", challenge: "C2" } }] }, { t, facts: f, desk: true, round: 2 });
  eq(q2.options[0].label, "Challenge B: the toxin", "D108: the same in English");
  lang("pl");
  const ops = src("./ops-pure.mjs");
  ok(/typeof t\.run\.kind === "string" \? \{ effect: t\.run\.kind/.test(ops), "D108: a queue line keeps the kind of the challenge's effect");
  const desk = src("./desk-pure.mjs");
  ok(/text: i\.decl\?\.text, effect: effectOf\(i\)/.test(desk), "D108: a by-hand item of a challenge carries its effect (the desk says it in words)");
}
{ /* the stripped prompt of a player keeps the moment of a queue and nothing else of it */
  const st = { prompts: { p1: { id: "p1", inst: null, step: "turnStart", kind: "triggerQueue", to: "gm", about: "E1", options: [{ id: "x", label: "secret", data: { type: "challengeRoll" } }], data: { at: "turnStart", key: "k" } } } };
  const src2 = src("./view-pure.mjs");
  ok(/p\.kind === "triggerQueue" && typeof p\.data\?\.at === "string" \? \{ data: \{ at: p\.data\.at \} \}/.test(src2), "D108: a player's view of a GM queue keeps its moment (start of the round or of a turn), not its lines");
  ok(st.prompts.p1.options.length === 1, "fixture");
}

/* ---- D109: the words of an intention are the GMs' language */
{
  eq([tIn("pl", "ITAC.action.slugfest"), tIn("en", "ITAC.action.slugfest")], [PL["ITAC.action.slugfest"], EN["ITAC.action.slugfest"]], "D109: tIn says a key in a given language");
  lang("en"); eq(T0("ITAC.action.slugfest"), EN["ITAC.action.slugfest"], "D109: t() still follows this client");
  const board = src("./ui/board.mjs"), main = src("./main.mjs");
  ok(/const gmLang = [^\n]*u\.isGM && u\.active[^\n]*getFlag\?\.\(MOD_ID, "lang"\)[^\n]*l\.length === 1 \? l\[0\] : null/.test(board), "D109: one language for all GMs at the table, else none");
  ok(/tIn\(l, a\.label, \{\}, p\.title\)/.test(board), "D109: the action's name in that language (a sheet's own ability keeps its name)");
  ok(/u\?\.isGM && lang && typeof u\.setFlag === "function" && u\.getFlag\(MOD, "lang"\) !== lang\) u\.setFlag\(MOD, "lang", lang\)/.test(main), "D109: a GM's client writes its language on its own user (only when it changed)");
}

/* ---- U99: a minion group is its count, not "97/10" */
lang("pl");
{
  const f = { staff: true, me: "gm", c: (id) => ({ name: id, kind: id === "G" ? "minions" : "npc" }), vitals: () => ({ health: 97, maxHealth: 10, resolve: 0, maxResolve: 0 }) };
  const items = BP.gmItems("G", f.vitals(), [], t, { quick: false, req: () => null });
  eq(items.find((x) => x.id === "health").stepper, { value: 97, min: 0, max: 97 }, "U99: the GM's stepper of a group is not capped under its count");
  eq(BP.gmItems("N", { health: 4, maxHealth: 10 }, [], t).find((x) => x.id === "health").stepper.max, 10, "U99: anybody else keeps the sheet's top");
  const bar = src("../combat/bar.mjs");
  ok(/if \(it\.group && key === "hp"\) \{[\s\S]{0,300}max: ""/.test(bar) && /group: actor\?\.type === "minions"/.test(bar), "U99: the initiative bar says a group's count alone (no '/10')");
  ok(/key === "hp" && card\.item\.group \? Math\.max\(1, spec\.count\)/.test(bar), "U99: one segment of the bar a member standing");
  const model = src("./ui/model-pure.mjs");
  ok(/!\(group && id === "health"\)/.test(model) && /group: membersOf\(facts, bar\.combatant, t\)/.test(model), "U99: the dock drives a group with its count, not a Health bar");
  eq([EN["ITAC.status.prone"], PL["ITAC.status.prone"]], ["Prone", "Leżący"], "U99: 'Prone' has its Polish name");
}

/* ---- U101: hiding or revealing a token redraws the surfaces */
ok(/Hooks\.on\("updateToken", \(td, ch\) => \{[^\n]*"hidden" in ch[^\n]*moved\(\)/.test(src("./ui/main.mjs")), "U101: a token's hidden flag redraws every surface");

/* ---- U102: no "wreck the zone" for a wrecked zone; asking the GM says the words are needed */
{
  const model = src("./ui/model-pure.mjs");
  ok(/wreck: a\.id === "slugfest" && !w\?\.always && !facts\.wrecked\?\.\(bar\.combatant\)/.test(model), "U102: the switch is not offered where the zone is wrecked already");
  ok(/wrecked: \(id\) => \{[\s\S]{0,500}levelStates\(td, Zones\.zoneOf\(p\.zone\)\)\?\.wrecked[\s\S]{0,120}zone:\$\{key\}:wrecked/.test(src("./ui/main.mjs")), "U102: wrecked = the mark of the zone or the scene's counter (what the attack flow reads)");
  ok(/\(required\)$/.test(EN["ITAC.ui.exception.placeholder"]) && /\(wymagane\)$/.test(PL["ITAC.ui.exception.placeholder"]), "U102: the box of the question says its words are required");
}

/* ---- U103: a bar button's tooltip opens over the news line, not on it */
{
  const win = { w: 1600, h: 900 }, bar = { left: 450, top: 795, right: 1010, bottom: 895 }, wait = { left: 530, top: 762, right: 920, bottom: 788 }, owner = { left: 610, top: 800, right: 650, bottom: 840 };
  const p = placeTip({ owner, block: bar, size: { w: 120, h: 40 }, win, avoid: [wait], order: ["up", "side"] });
  ok(p.top + p.h <= wait.top && p.free, "U103: the tooltip stands over the line, not on it");
  ok(/\$\{DOCK\} \.itd-wait, \$\{DOCK\} \.itd-hint1/.test(src("./ui/tip.mjs")), "U103: the line and the hint are kept off");
}

/* ---- U105: the panel takes a share of the window at most; its foot stays in sight; a sign while more lies below */
{
  const dock = src("./ui/dock.mjs"), css = readFileSync(new URL("../../styles/tactics-ui.css", import.meta.url), "utf8");
  const sp = src("./ui/slots-pure.mjs");
  ok(/export const PANEL_SHARE = 0\.\d+;/.test(sp) && /out\.panelMax = r\(Math\.max\(110, Math\.min\(out\.panelMax, bar\.top/.test(sp) && /setProperty\("--itd-panel-maxh", `\$\{fr\.panelMax\}px`\)/.test(dock), "U105 (U132): the panel's height is capped by a share of the window (the frame's panelMax)");
  ok(/function markMore\(el\)/.test(dock) && /addEventListener\("scroll", [^\n]*markMore/.test(dock), "U105: the panel says when more of it lies below");
  ok(/\.itd-panel:not\(\[data-picking\]\) > \.itd-pfoot \{ position: sticky; bottom: -9px;/.test(css), "U105: the foot (Declare, Ask the GM) stays in sight");
  ok(/\.itd-panel\[data-more\] > \.itd-pfoot::after \{ content: "\\f078"/.test(css) && /\.itd-panel\[data-more\] > \.itd-pfoot::before \{ opacity: 1; \}/.test(css), "U105: a fade and a chevron while there is more");
}

/* ---- U106: the GM's "move anyway" from the map's menu goes at once */
{
  ok(/r\.id === "@ask"\) return last\.staff && blocked\[0\]\.gm \? H\.send\(blocked\[0\]\.gm, DONE\)/.test(src("./ui/board.mjs")), "U106: the GM's choice sends the move to the dragged zone");
  ok(/facts\.staff && r\.disabled \? \{ gm: askBox\(a, bar, r\.decl, r\.o, null, own, facts, t, ""\)\.submit\.req \}/.test(src("./ui/model-pure.mjs")), "U106: a refused way carries the GM's request on the GM's client only");
}

/* ---- U107: a script's token update is no drag */
{
  eq([MP.madeByScript(10000, 0), MP.madeByScript(10000, 9000), MP.madeByScript(10000, 8400), MP.madeByScript(10000, NaN)], [true, false, true, true], "U107: no hand within 1.5 s -> a script");
  ok(/cid && MP\.scriptMove\(ctx, \(\) => inputOn && hand\.byScript\(Date\.now\(\)\)\)\) \{ ui\.notifications\?\.warn\(t\("ITAC\.move\.script"/.test(src("./movement.mjs")), "U107: the update is held and the client told, no menu opened (the map's word; D112: the hand tracker only for an older map)");
  /* U107, the proper fix (moinen-maps zones-api.md 41): the map says how the token moved; its word beats the guess both ways */
  const yes = () => true, no = () => false;
  eq([MP.scriptMove({ method: "dragging", byHand: true }, yes), MP.scriptMove({ method: "keyboard", byHand: true }, yes), MP.scriptMove({ method: "api", byHand: false }, no), MP.scriptMove({ method: "undo", byHand: false }, no)], [false, false, true, true], "U107: the map's byHand decides: a slow drag (the tracker would say script) is a drag, a script's update right after a click is a script");
  eq([MP.scriptMove({}, yes), MP.scriptMove({}, no), MP.scriptMove(null, yes), MP.scriptMove({ byHand: "yes" }, no)], [true, false, true, false], "U107: a map that does not say it: the hand tracker's guess, as before");
  ok(/if \(ctx\.byHand === false\) \{ ui\.notifications\?\.warn\(t\("ITAC\.move\.script"/.test(src("./movement.mjs")), "U107: a level a script wrote opens no window of ways either (only on the map's word)");
  ok(EN["ITAC.move.script"] && /żeton/.test(PL["ITAC.move.script"]), "U107: said in both languages");
}

/* ---- U108: the dock and the bar stand over Dice So Nice while it shows dice */
{
  eq([Lay.diceRaise(null), Lay.diceRaise({ display: "none", opacity: "", zIndex: "1000" }), Lay.diceRaise({ display: "", opacity: "0", zIndex: "1000" }), Lay.diceRaise({ display: "", opacity: "", zIndex: "1000" }), Lay.diceRaise({ display: "block", opacity: "1", zIndex: "0" }), Lay.diceRaise({ display: "", opacity: "", zIndex: "auto" })],
    [null, null, null, 1001, null, null], "U108: one step over a canvas that shows dice over the interface; nothing otherwise");
  const css = readFileSync(new URL("../../styles/tactics-ui.css", import.meta.url), "utf8"), ccss = readFileSync(new URL("../../styles/combat.css", import.meta.url), "utf8");
  ok(/body\.ita-dice-up #invincible-tactics-dock \{ z-index: var\(--ita-dice-z\); \}/.test(css) && /body\.ita-dice-up #invincible-combat-bar \{ z-index: var\(--ita-dice-z\); \}/.test(ccss), "U108: both bars follow the raise");
  ok(/Hooks\.on\("diceSoNiceRollStart"/.test(src("./ui/main.mjs")), "U108: raised only while a roll is shown");
}

/* ---- U109: Esc with the legend open closes it and goes no further */
{
  const d = { show: true, prompts: [], groups: [], panel: null };
  eq(Keys.plan(d, { legend: true }, { key: "Escape" }), { set: { legend: false } }, "U109: Esc closes the legend (the event is then stopped)");
  eq(Keys.plan(d, {}, { key: "Escape" }), null, "U109: with nothing open Esc is Foundry's");
  eq(Keys.plan(d, { legend: true, armed: "slugfest" }, { key: "Escape" }), { set: { armed: null, mode: null, amend: null } }, "U109: the armed action goes first");
}

eq([...missing], [], "every key the model asks for without a fallback exists");
done("check-fxc");
