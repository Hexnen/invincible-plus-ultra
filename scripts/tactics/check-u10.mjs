// node scripts/tactics/check-u10.mjs -- feedback to the player (ledger rows U53 - U58, U68; ui/feedback-pure.mjs and what the model does with it).
//   A. U54 / U68  every reason a thing is greyed for is a whole sentence in both languages, never the words of a price, with what to do
//   B. U55        where the dice of a pool come from (the sum adds up; dice that wait for the GM are apart)
//   C. U56        what stands over a token (one word per defence, the loss by kind, nothing for an event without a target)
//   D. U57        the summary: summed from the news of ONE user's view, nobody that view does not hold, undone actions out
//   E. U58        the two sounds: only for what is new, never at the first look
//   F. U53        the hints: one at a time, in order, gone once used
import { ok, eq, done } from "./testkit.mjs";
import * as FP from "./ui/feedback-pure.mjs";
import * as UI from "./ui/model-pure.mjs";
import { EN, PL, t as T0 } from "./lang.mjs";

globalThis.game = { ...(globalThis.game ?? {}), i18n: { lang: "en" } };
const lang = (l) => { globalThis.game.i18n.lang = l; };
const t = (key, params, fallback) => T0(key, params, fallback);

/* ---------- A ---------- */
const REASONS = Object.keys(EN).filter((k) => k.startsWith("ITAC.why.") && k !== "ITAC.why.other").map((k) => k.slice(9));
ok(REASONS.length >= 30, `A0 the reasons with a sentence of their own (${REASONS.length})`);
const BAR = ["busy", "notYourTurn", "grappling", "held", "snared", "trapped", "restrained", "noAction", "noFullAction", "noQuickAction", "noStress", "turnUsed"];
for (const r of BAR) ok(REASONS.includes(r), `A1 the bar's reason ${r} has a sentence`);
const NOFIX = new Set(["dead", "resolveFull", "notHeld"]);
for (const l of ["en", "pl"]) {
  lang(l);
  const costs = Object.keys(EN).filter((k) => k.startsWith("ITAC.cost.")).map((k) => String(t(k)).toLowerCase());
  for (const r of REASONS) {
    const plain = r.startsWith("holdOff.") ? FP.whyOf(t, r.slice(8), {}, { ctx: "holdOff" }) : FP.whyOf(t, r, { name: "Rex", n: 2 });
    ok(plain && typeof plain.text === "string" && /[.!?]$/.test(plain.text.trim()) && plain.text.trim().split(/\s+/).length >= 2, `A2 ${l} ${r}: a whole sentence ("${plain?.text}")`);
    ok(!costs.includes(plain.text.trim().toLowerCase().replace(/[.!?]$/, "")), `A3 ${l} ${r}: not the words of a price`);
    ok(!/\{\w+/.test(plain.text) && !/\{\w+/.test(plain.fix ?? ""), `A4 ${l} ${r}: no unfilled place ("${plain.text}" / "${plain.fix}")`);
    if (!r.startsWith("holdOff.")) ok(NOFIX.has(r) ? plain.fix === null : typeof plain.fix === "string" && /[.!?]$/.test(plain.fix.trim()), `A5 ${l} ${r}: ${NOFIX.has(r) ? "no remedy" : "what to do"} ("${plain.fix}")`);
    ok(!/engine|silnik|automat/i.test(`${plain.text} ${plain.fix ?? ""}`), `A6 ${l} ${r}: no word about the engine (U67)`);
  }
  const unknown = FP.whyOf(t, "somethingNew");
  ok(unknown.text.includes("somethingNew") && unknown.fix === t("ITAC.fix.ask"), `A7 ${l} an unknown reason still gets a sentence and the way to ask`);
  eq(FP.whyOf(t, "somethingNew", {}, { staff: true }).fix, t("ITAC.fix.gm"), `A8 ${l} the GM gets the GM's own way`);
  eq(FP.whyOf(t, "somethingNew", {}, { ask: false }).fix, null, `A9 ${l} no way to ask on a card's answer`);
  eq(FP.whyOf(t, null), null, `A10 ${l} no reason, no sentence`);
  const ho = FP.whyOf(t, "noTarget", {}, { ctx: "holdOff" }), pl = FP.whyOf(t, "noTarget");
  ok(ho.text !== pl.text, `A11 ${l} the same word means another thing at Hold off`);
  const w = FP.whyOf(t, "noAction");
  eq(FP.whyLine(w), `${w.text} ${w.fix}`, `A12 ${l} the two sentences as one line`);
  eq(FP.whyLine(null), null, `A13 ${l} nothing as one line`);
  ok(t("ITAC.ui.tip.cost", { cost: t("ITAC.cost.full") }).includes(t("ITAC.cost.full")) && t("ITAC.ui.tip.cost", { cost: "x" }) !== "x", `A14 ${l} the price is named a price`);
}
lang("en");
ok(typeof UI.tipHtml !== "function", "A15 the model draws nothing");

/* ---------- B ---------- */
{
  const p = FP.poolTip({ total: 7, parts: [{ label: "Fighting", dice: 4 }, { label: "Knife", dice: 2 }, { label: "Help", dice: 2 }, { label: "Injuries", dice: -1 }, { label: "GM's call", dice: 1, pending: true }] }, t);
  eq(p.rows.map((r) => r.value), ["4", "+2", "+2", "-1"], "B1 the first source bare, the rest signed");
  eq(p.rows.reduce((n, r) => n + Number(r.value), 0), 7, "B2 the sure rows add up to the total");
  eq(p.total.value, "7", "B3 the total");
  eq(p.wait.rows, [{ label: "GM's call", value: "+1" }], "B4 dice that wait are apart");
  ok(p.say.includes("Fighting 4") && p.say.includes("7"), "B5 the same in one spoken line");
  eq(FP.poolTip({ total: 3, parts: [] }, t), null, "B6 no sources, no tooltip");
  eq(FP.poolTip(null, t), null, "B7 no pool, no tooltip");
  ok(!("wait" in FP.poolTip({ total: 2, parts: [{ label: "Agility", dice: 2 }] }, t)), "B8 nothing waits, no such part");
  const rp = FP.rollPool({ pool: { base: 3, mods: [{ source: "help:x", dice: 1, label: "Help" }, { source: "zero", dice: 0 }], total: 4 } }, t, "Agility");
  eq(rp.total, 4, "B9 a roll's own pool: the total");
  eq(rp.parts.map((x) => x.dice), [3, 1], "B10 a roll's own pool: no empty source");
  eq(rp.parts[0].label, "Agility", "B11 the attribute leads");
  eq(FP.rollPool({ pool: null }, t), null, "B12 a roll whose numbers this user is not told has none");
  eq(FP.rollPool({}, t), null, "B13 no pool at all");
}

/* ---------- C ---------- */
{
  const ev = [{ type: "outcome", target: "a", hit: true }, { type: "damage", target: "a", taken: 3 }, { type: "outcome", target: "b", hit: false, dodged: true }, { type: "outcome", target: "c", hit: false, blocked: true },
    { type: "outcome", target: "d", hit: false }, { type: "outcome", target: "e", hit: true }, { type: "damage", target: "f", taken: 2, toStress: true }, { type: "damage", target: "g", taken: 0 }, { type: "broken", target: "f" },
    { type: "outcome", hit: true }, { type: "damage", target: null, taken: 9 }, null, { type: "turn", target: "a" }];
  const f = FP.floats(ev, t);
  eq(f.map((x) => `${x.target}:${x.tone}:${x.text}`), ["a:health:-3 Health", "b:miss:Dodged", "c:miss:Blocked", "d:miss:Miss", "e:none:Hit", "f:resolve:-2 Resolve", "g:none:0", "f:state:Broken"], "C1 one word per thing that happened");
  ok(!f.some((x) => !x.target), "C2 nothing for an event without a target (a concealed one is not in the public stream)");
  eq(FP.floats([{ type: "damage", target: { combatant: "z" }, taken: 1 }], t)[0].target, "z", "C3 a target given as an object");
  eq(FP.floats(null, t), [], "C4 nothing from nothing");
  lang("pl"); ok(FP.floats([{ type: "damage", target: "a", taken: 3 }], t)[0].text.includes("Zdrowi"), "C5 in Polish"); lang("en");
  ok(FP.eventKey({ combat: "c", seq: 4, type: "damage", target: "a" }) === FP.eventKey({ combat: "c", seq: 4, type: "damage", target: { combatant: "a" } }), "C6 the same event heard twice has one key");
  ok(FP.eventKey({ combat: "c", seq: 4, type: "damage", target: "a" }) !== FP.eventKey({ combat: "c", seq: 5, type: "damage", target: "a" }), "C7 another event, another key");
  eq(FP.floats(Array.from({ length: 80 }, (_, i) => ({ type: "broken", target: `x${i}` })), t).length, 40, "C8 a flood is cut");
}

/* ---------- D ---------- */
{
  const news1 = [{ id: "n1", kind: "action", round: 1, actor: "pc", rows: [{ target: "npc", hit: true, taken: 3 }] }, { id: "n2", kind: "turn", round: 1 },
    { id: "n3", kind: "action", round: 1, actor: "npc", rows: [{ target: "pc", hit: true, taken: 2, stress: true }, { target: "ghost", hit: false }] },
    { id: "n4", kind: "action", round: 1, actor: "pc", rows: [] }];
  const t1 = FP.tallyAdd(null, "C1", news1);
  eq(Object.keys(t1.entries), ["1", "3"], "D1 only actions that came to something are kept");
  ok(FP.tallyAdd(t1, "C1", news1) === t1, "D2 the same news again changes nothing");
  const t2 = FP.tallyAdd(t1, "C1", [{ id: "n5", kind: "action", round: 2, actor: "pc", rows: [{ target: "npc", hit: false }] }, { id: "n6", kind: "action", round: 2, actor: "pc", rows: [{ target: "npc", hit: true, taken: 4 }] }]);
  ok(t2 !== t1 && Object.keys(t1.entries).length === 2, "D3 more news gives a new tally, the old one untouched");
  eq(FP.roundsOf(t2), [1, 2], "D4 the rounds it holds");
  const r1 = Object.fromEntries(FP.totals(t2, 1).map((r) => [r.id, r]));
  eq([r1.pc.dealt, r1.pc.attacks, r1.pc.hits, r1.pc.stress, r1.pc.taken], [3, 1, 1, 2, 0], "D5 round 1, the character");
  eq([r1.npc.dealt, r1.npc.attacks, r1.npc.hits, r1.npc.taken], [2, 2, 1, 3], "D6 round 1, the other side");
  const all = Object.fromEntries(FP.totals(t2).map((r) => [r.id, r]));
  eq([all.pc.dealt, all.pc.attacks, all.pc.hits], [7, 3, 2], "D7 the whole fight");
  const who = (id) => ({ pc: { name: "Rex", img: "r.png", mine: true }, npc: { name: "Thug", img: null, mine: false } })[id] ?? null;
  const c1 = FP.roundCard(t2, 1, who, { npc: [{ id: "broken" }] }, t);
  eq(c1.rows.map((r) => r.id), ["pc", "npc"], "D8 the user's own first; somebody the view does not hold is left out");
  ok(!JSON.stringify(c1).includes("ghost"), "D9 the card names nobody the view does not hold");
  eq(c1.rows[0].chips.map((k) => `${k.id}=${k.n}`), ["dealt=3", "hits=1/1", "stress=2"], "D10 the counts of the user's row");
  eq(c1.rows[1].out?.id, "broken", "D11 who lies broken");
  ok(c1.kind === "round" && c1.title.includes("1") && c1.quiet === null && c1.more === null, "D12 the head of a round's card");
  ok(c1.rows.every((r) => r.chips.every((k) => typeof k.tip === "string" && k.tip.length > 3) && r.say.startsWith(r.name)), "D13 every count has its words");
  const cf = FP.fightCard(t2, who, {}, t, 2);
  ok(cf.kind === "fight" && cf.sub.includes("2") && cf.rows[0].chips.find((k) => k.id === "dealt").n === "7", "D14 the fight's card");
  const t3 = FP.tallyAdd(t2, "C1", [{ id: "n6", kind: "action", round: 2, actor: "pc", undone: true, rows: [{ target: "npc", hit: true, taken: 4 }] }]);
  eq(Object.fromEntries(FP.totals(t3).map((r) => [r.id, r])).pc.dealt, 3, "D15 an undone action is out of the sums");
  eq(FP.roundCard(t3, 9, who, {}, t), null, "D16 a round in which nothing happened has no card");
  eq(FP.roundCard(t3, 1, () => null, {}, t), null, "D17 a view that holds nobody has no card");
  eq(FP.tallyAdd(t3, "C2", []).entries, {}, "D18 another fight starts empty");
  const miss = FP.roundCard(FP.tallyAdd(null, "C3", [{ id: "n1", kind: "action", round: 1, actor: "pc", rows: [{ target: "npc", hit: false }] }]), 1, who, {}, t);
  ok(typeof miss.quiet === "string" && miss.quiet.length > 3, "D19 a round of misses says so");
  const many = FP.tallyAdd(null, "C4", Array.from({ length: 12 }, (_, i) => ({ id: `n${i + 1}`, kind: "action", round: 1, actor: `a${i}`, rows: [{ target: `b${i}`, hit: true, taken: 1 }] })));
  const big = FP.roundCard(many, 1, (id) => ({ name: id, img: null, mine: false }), {}, t);
  ok(big.rows.length === FP.SUM_ROWS && typeof big.more === "string", "D20 a long list is cut and says how many more");
  let flood = null; for (let i = 1; i <= FP.TALLY_MAX + 30; i++) flood = FP.tallyAdd(flood, "C5", [{ id: `n${i}`, kind: "action", round: 1, actor: "pc", rows: [{ target: "npc", hit: true, taken: 1 }] }]);
  ok(Object.keys(flood.entries).length === FP.TALLY_MAX && !flood.entries[1] && flood.entries[FP.TALLY_MAX + 30], "D21 the tally is bounded, the oldest go");
  lang("pl"); const cp = FP.roundCard(t2, 1, who, {}, t); ok(cp.title !== c1.title && cp.close !== c1.close, "D22 in Polish"); lang("en");
}

/* ---------- E ---------- */
{
  eq(FP.cues(null, { turn: ["a"], asks: ["p:1"] }).cue, null, "E1 never at the first look");
  const p0 = FP.cues(null, { turn: [], asks: [] }).next;
  eq(FP.cues(p0, { turn: ["a"], asks: [] }).cue, "turn", "E2 a turn that begins");
  eq(FP.cues(p0, { turn: [], asks: ["p:1"] }).cue, "wait", "E3 the table waits");
  eq(FP.cues(p0, { turn: ["a"], asks: ["p:1"] }).cue, "turn", "E4 both at once: the turn");
  const p1 = FP.cues(p0, { turn: ["a"], asks: ["p:1"] }).next;
  eq(FP.cues(p1, { turn: ["a"], asks: ["p:1"] }).cue, null, "E5 nothing new, no sound");
  eq(FP.cues(p1, { turn: [], asks: [] }).cue, null, "E6 something gone, no sound");
  eq(FP.cues(p1, { turn: ["a"], asks: ["p:1", "p:2"] }).cue, "wait", "E7 one more question");
  const model = { bars: [{ combatant: "a" }], prompts: [{ id: "q1" }], rolls: [{ inst: "i1", key: "k", state: "owed", users: ["u1"], actor: "a", who: "a" }, { inst: "i2", key: "k", state: "owed", users: ["u1"], actor: "z", who: "a" },
    { inst: "i3", key: "k", state: "done", users: ["u1"], actor: "z", who: "a" }, { inst: "i4", key: "k", state: "owed", users: ["u2"], actor: "z", who: "b" }] };
  eq(FP.asksOf(model, "u1", false), ["p:q1", "r:i2:k"], "E8 a player: the questions and the dice somebody else's action asks for");
  eq(FP.asksOf(model, "gm", true, [{ id: "c1" }, { id: "c2" }]), ["c:c1", "c:c2"], "E9 the GM: the cards of the desk");
  eq(FP.asksOf(null, "u1", false), [], "E10 no model, nothing");
  ok(Object.values(FP.SOUNDS).every((s) => /^sounds\/[\w/-]+\.(ogg|wav)$/.test(s)), "E11 both sounds ship with Foundry itself");
}

/* ---------- F ---------- */
{
  const base = { show: true, onTurn: true, slots: [{ state: "free" }, { state: "free" }], groups: [{ id: "attack" }], rolls: [] };
  eq(FP.hintOf(base, [], t)?.id, "slots", "F1 first the slots");
  eq(FP.hintOf(base, ["slots"], t)?.id, "speed", "F2 then the speed mark");
  eq(FP.hintOf(base, ["slots", "speed"], t), null, "F3 then nothing");
  eq(FP.hintOf({ ...base, onTurn: false }, [], t), null, "F4 not on somebody else's turn");
  eq(FP.hintOf({ ...base, show: false }, [], t), null, "F5 not without a dock");
  const push = { ...base, rolls: [{ state: "push", buttons: [{ id: "push" }, { id: "keep" }] }] };
  eq(FP.hintOf(push, [], t)?.id, "push", "F6 a roll that may be pushed comes first");
  eq(FP.hintOf({ ...push, onTurn: false }, ["slots", "speed"], t)?.id, "push", "F7 also out of turn");
  eq(FP.hintOf({ show: true, panel: { kind: "mine", rolls: push.rolls } }, [], t)?.id, "push", "F8 also from the open panel");
  eq(FP.hintOf({ ...base, rolls: [{ state: "push", buttons: [] }] }, ["slots", "speed"], t), null, "F9 not for a roll that cannot be pushed");
  const h = FP.hintOf(base, [], t);
  ok(h.text.length > 20 && h.close.length > 1 && h.at === "slots" && FP.hintOf(base, ["slots"], t).at === "acts", "F10 the line, its button, the thing it points at");
  eq(FP.hintsUsed("slots", base), [], "F11 not used yet");
  eq(FP.hintsUsed("slots", { ...base, slots: [{ state: "used" }, { state: "free" }] }), ["slots"], "F12 a slot spent");
  eq(FP.hintsUsed("speed", base, { armed: "attack" }), ["speed"], "F13 an action armed");
  eq(FP.hintsUsed("speed", base, {}), [], "F14 nothing armed");
  eq(FP.hintsUsed("push", push), [], "F15 the roll still waits");
  eq(FP.hintsUsed("push", base), ["push"], "F16 the roll is settled");
  eq(FP.hintsUsed(null, base), [], "F17 nothing shown, nothing used");
  for (const l of ["en", "pl"]) { lang(l); for (const id of FP.HINTS) ok(String(t(`ITAC.hint.${id}`)).length > 20 && !/engine|silnik/i.test(t(`ITAC.hint.${id}`)), `F18 ${l} ${id}: a line`); }
  lang("en");
  ok(PL["ITAC.hint.push"] !== EN["ITAC.hint.push"], "F19 the Polish line is Polish");
}

done("check-u10");
