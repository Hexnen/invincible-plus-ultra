/* node scripts/tactics/check-uxb.mjs -- UX wave, package UXB (U127): WHAT THE TABLE IS TOLD. The news line (U141: what stands and for
   how long, the results it missed: an area shot's fallen minions, a hidden attacker's hit, a hazard's damage, the counterattack's), the
   defence beside the attacker's own roll (U146), the dice that land before the cards and the line move on (D128), the splash sentences in
   the table's language (D129) and the splash word that waits for the verdict (U151), the waiting line in the third person (U159), the
   first-turn hint in words (U147) and one sign and word for the odds on every seat (U156).
   Rows: dev/combat-usability.md U141 U146 U147 U151 U156 U159 U161, dev/combat-defects.md D128 D129. */
import { readFileSync } from "node:fs";
import { Table, ok, eq, done } from "./testkit.mjs";
import * as V from "./view-pure.mjs";
import * as D from "./desk-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./ui/model-pure.mjs";
import * as N from "./ui/news-pure.mjs";
import { EN, PL, tIn } from "./lang.mjs";
import * as Kit from "../kit.mjs";
import * as SL from "../splash/logic.mjs";
import * as SLang from "../splash/lang.mjs";
import * as Moment from "../moment.mjs";

const src = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const tr = (l) => (k, p = {}, f) => tIn(l, k, p, f);
const meta = (T) => ({ hidden: Object.keys(T.c).filter((id) => T.c[id].hidden), npc: Object.keys(T.c).filter((id) => T.c[id].npc) });
const pv = (T, u, owns) => V.viewFor(T.state, { id: u, staff: false, owns }, meta(T));
const pf = (T, u, view) => ({ view, staff: false, me: u, c: (id) => (T.c[id] ? { name: T.c[id].name ?? id, npc: T.c[id].npc } : null), attrs: (id) => T.c[id]?.attrs ?? null, userName: (x) => `user-${x}` });
const line = (T, u, owns, l = "en", own = {}) => { const v = pv(T, u, owns); return M.newsData(v, own, pf(T, u, v), tr(l)); };
const ctx = (T) => ({ c: (id) => T.c[id] ?? null, online: () => true, P1 });
const dock = (T, u, owns, l = "en") => { const v = pv(T, u, owns); return M.dockData(D.playerModel(v, { id: u, owns }, ctx(T)), {}, pf(T, u, v), tr(l)); };
const desk = (T, l = "en") => M.deskData(D.deskModel(T.state, T.log, ctx(T)), {}, { view: T.state, staff: true, me: "gm", c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc } : null), attrs: (id) => T.c[id]?.attrs ?? null, userName: (x) => x }, tr(l));
const base = () => { const T = new Table(); T.hero("H1", "p1", { name: "Omni" }).hero("H2", "p2", { name: "Kid" }).npc("N1", { name: "Mauler", health: 11 }).npc("N2", { name: "Turret", health: 4, hidden: true }); T.order(["H1", "N1", "H2", "N2"]).turn("N1"); return T; };

/* ---- U141 / D128: the counterattack is told with the attack it answered, and its damage is said */
{
  const T = base();
  await T.gm({ op: "declare", actor: "N1", decl: { action: "slugfest", targets: ["H1"] } });
  await T.answer("p1", "reaction", "block", "H1");
  await T.roll("attack", 1); await T.roll("def:H1", 3);
  await T.answer("p1", "counter", "counter", "H1");
  if (T.prompt("stunts")) await T.answer("p1", "stunts", []);
  const n = line(T, "p1", ["H1"]), pl = line(T, "p1", ["H1"], "pl");
  ok(/^Mauler: Slugfest > Omni: miss \(block\) · Omni: Counterattack > Mauler: hit, \[\[damage:\d+\]\]/.test(n?.text ?? ""), `U141 / D128: the attack and the counter that answered it are one line, the counter's damage said (${n?.text})`);
  ok(/Omni: Kontratak > Mauler: trafienie, \[\[damage:\d+\]\]/i.test(pl?.text ?? "") || /Kontratak/.test(pl?.text ?? ""), `U141: the same in Polish (${pl?.text})`);
  eq(n?.tone, "good", "U141: the counter that hit reads as good news for the player who made it");
}

/* ---- U141: a hidden attacker's hit reaches the hit character's player as "someone unseen"; nobody else hears of it */
{
  const T = base(); T.turn("N2"); T.weapons.gun = { id: "gun", bonus: 1, damage: 2, range: [0, 2] };
  await T.gm({ op: "declare", actor: "N2", decl: { action: "shoot", weapon: "gun", targets: ["H2"] } });
  if (T.prompt("reaction", "H2")) await T.answer("p2", "reaction", "pass", "H2");
  await T.roll("attack", 1);
  if (T.prompt("stunts")) await T.answer("gm", "stunts", []);
  const n = line(T, "p2", ["H2"]), raw = JSON.stringify(pv(T, "p2", ["H2"]).news);
  ok(/^Someone unseen > Kid: hit, \[\[damage:2\]\]$/.test(n?.text ?? ""), `U141: the hit character's player is told (${n?.text})`);
  ok(!/N2|Turret|shoot|gun|hidA|hidT/.test(raw), "U141: the line names no attacker, no action, no weapon (hidden things never leak)");
  eq(line(T, "p1", ["H1"]), null, "U141: another player is told nothing");
  eq(line(T, "p2", ["H2"], "pl")?.text.startsWith("Ktoś niewidoczny > Kid"), true, "U141: Polish: Ktoś niewidoczny");
}

/* ---- U141: a hazard says what it dealt (one fire on several characters is one line) */
{
  const T = base(); T.turn("H1"); T.dice.push([6, 1, 1, 1, 1, 1]);
  await T.gm({ op: "hazard", hazard: { kind: "fire", intensity: 6, inZone: false }, targets: ["H2"] });
  eq(line(T, "p2", ["H2"])?.text, "Fire > Kid: [[damage:2]]", "U141: the fire's damage is on the line (was 'Fire: done')");
  const g = N.groups([{ id: "n1", kind: "action", flow: "hazard", hazard: "fire", round: 2, rows: [{ target: "a", taken: 0 }] }, { id: "n2", kind: "action", flow: "hazard", hazard: "fire", round: 2, rows: [{ target: "b", taken: 4 }] }]).map(N.merged);
  eq([g.length, g[0].length, g[0][0].rows.length, g[0][0].id], [1, 1, 2, "n2"], "U141: one fire at round start on two characters is one line with both rows");
  const t = M.newsData({ news: g[0], round: 2 }, {}, { staff: false, me: "p", c: (id) => ({ name: id.toUpperCase() }) }, tr("en"))?.text;
  eq(t, "Fire > A: no damage; B: [[damage:4]]", "U141: a hazard that dealt nothing says so");
  const z = M.newsData({ news: [{ id: "n7", kind: "action", flow: "hazard", hazard: "fire", round: 2, rows: [{ target: "a", taken: 0 }, { target: "b", taken: 0 }] }], round: 2 }, {}, { staff: false, me: "p", c: (id) => ({ name: id.toUpperCase() }) }, tr("en"))?.text;
  eq(z, "Fire > no damage: A, B", "U141: a hazard that hurt nobody says it once");
  const chain = N.groups([{ id: "n64", kind: "action", inst: "a62", parent: "a60", flow: "hazard", hazard: "fire", round: 2, rows: [{ target: "k", taken: 2 }] }, { id: "n65", kind: "action", inst: "a60", parent: "a58", flow: "hazard", hazard: "fire", round: 2, rows: [{ target: "s", taken: 0 }] }, { id: "n66", kind: "action", inst: "a58", parent: "a56", flow: "fireSpread", rows: [] }]).map(N.merged);
  eq([chain.length, chain[0].length, chain[0][0].rows.length, chain[0][0].id], [1, 1, 2, "n66"], "U141 (live): a spread that set off two fires is one fire line with both rows, never lost under its head");
}

/* ---- U141: an area shot says how many minions fell */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Kid" }).npc("N1", { name: "Boss", health: 6 }); T.weapons.nade = { id: "nade", bonus: 0, damage: 3, range: [0, 1], area: true };
  T.add("M1", { npc: true, kind: "minions", members: 5, health: 5, name: "Soldier", zone: "z2" }); T.c.N1.zone = "z2"; T.order(["H1", "N1", "M1"]).turn("H1");
  await T.req("p1", { op: "declare", actor: "H1", decl: { action: "shoot", targets: ["M1"], weapon: "nade", area: true } });
  for (const p of T.prompts("reaction")) await T.req("gm", { op: "answerFor", prompt: p.id, value: "pass" });
  await T.roll("attack", 1);
  await T.answer("gm", "minionLoss", "n:3", "M1"); await T.answer("gm", "minionsFate", "ko", "M1");
  if (T.prompt("stunts")) await T.answer("p1", "stunts", []);
  const n = line(T, "p1", ["H1"]);
  ok(/Soldier: hit, \[\[damage:3\]\], 3 down/.test(n?.text ?? ""), `U141: the fallen minions are counted on the line (${n?.text})`);
  ok(/padło: 3/.test(line(T, "p1", ["H1"], "pl")?.text ?? ""), "U141: Polish: padło: 3");
}

/* ---- U141: a line stands through its own turn and the next, never longer (news-pure newsWindow) */
{
  let w = N.newsWindow(null, { combat: "c", member: "A", newest: 4 });
  eq([w.from, w.mark], [3, 3], "U141: a first look (a reload) keeps only the newest line, as a line of this turn");
  w = N.newsWindow(w, { combat: "c", member: "A", newest: 6 });
  eq(w.from, 3, "U141: the same turn: the lines of it stand");
  w = N.newsWindow(w, { combat: "c", member: null, newest: 6 });
  eq(w.from, 3, "U141: between turns (or a turn hidden from this user) nothing changes");
  w = N.newsWindow(w, { combat: "c", member: "B", newest: 7 });
  eq([w.from, w.mark], [3, 7], "U141: the next turn: the lines of A's turn stand on, the ones before go");
  w = N.newsWindow(w, { combat: "c", member: "C", newest: 7 });
  eq(w.from, 7, "U141: the turn after: A's result has gone (it no longer looks like the latest)");
  eq(N.newsWindow(w, { combat: "d", member: "C", newest: 2 }).from, 1, "U141: another fight starts its own window");
  ok(/newsWindow\(newsWin, /.test(src("./ui/main.mjs")) && /st\.dock\.newsFrom = newsWin\.from/.test(src("./ui/main.mjs")), "U141: the surfaces keep the window per client");
  eq(M.newsData({ news: [{ id: "n3", kind: "action", actor: "x", action: "shoot", round: 1, rows: [{ target: "y", hit: true }] }], round: 1 }, { newsFrom: 3 }, { staff: false, c: () => ({ name: "Z" }) }, tr("en")), null, "U141: a line below the window is not shown");
  ok(/\.its-slot\[data-slot="line"\] \.itd-news \{[^}]*max-width: 100%/.test(readFileSync(new URL("../../styles/tactics-slots.css", import.meta.url), "utf8")), "U141: the news takes the free end of the row (no 560 px cut)");
}

/* ---- D128: what a roll came to waits for its dice (news-pure diceHold) */
{
  const a = N.diceHold(null, { prompts: ["p1"], cards: [], news: { id: "n1" }, at: 0 }, false);
  eq([a.held, a.prompts, a.news.id], [false, ["p1"], "n1"], "D128: no dice rolling: everything shows");
  const b = N.diceHold(a, { prompts: ["p1", "counter"], cards: ["c9"], news: { id: "n2" }, at: 100 }, true);
  eq([b.held, b.prompts, b.cards, b.news.id], [true, ["p1"], [], "n1"], "D128: dice rolling: the counter card and the new line wait, what stood stays");
  const c = N.diceHold(b, { prompts: ["p1", "counter"], cards: ["c9"], news: { id: "n2" }, at: 100 + N.HOLD_MS + 1 }, true);
  eq([c.held, c.prompts], [false, ["p1", "counter"]], "D128: never longer than HOLD_MS (a stuck flag keeps no card from the table)");
  const d = N.diceHold(b, { prompts: ["p1", "counter"], cards: ["c9"], news: { id: "n2" }, at: 3000 }, false);
  eq([d.held, d.prompts.length, d.cards.length, d.news.id], [false, 2, 1, "n2"], "D128: the dice landed: the card and the line come");
  const m = src("./ui/main.mjs");
  ok(/NewsP\.diceHold\(diceWas, /.test(m) && /diceThen\(\)/.test(m) && /waitFor3DAnimationByMessageID/.test(m), "D128: the surfaces hold cards and the line while Dice So Nice rolls, then redraw");
}

/* ---- U146: the attacker's own roll shows the defence that answered it */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Omni" }).npc("N1", { name: "Mauler", health: 30 }); T.order(["H1", "N1"]).turn("H1");
  await T.req("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1"] } });
  await T.answer("gm", "reaction", "block", "N1");
  await T.roll("attack", 4); await T.roll("def:N1", 1);      // a hit with sixes to spare: the exchange waits for the stunts
  const d = dock(T, "p1", ["H1"]), opp = d.panel?.kind === "mine" ? d.panel.opp : null;
  eq(opp?.map((o) => o.text), ["Mauler, Block: [[six:1]] · hit"], "U146: the attacker sees the defence roll and the verdict beside the own roll");
  ok(!JSON.stringify(opp).match(/"dice"|pool/), "U146: the defender's pool is not told, only its sixes (as the defender's chat card shows them)");
}

/* ---- U156: one sign and one word for the odds on every seat; the GM adds the per cent */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Omni" }).npc("N1", { name: "Mauler", health: 30 }); T.order(["H1", "N1"]).turn("H1");
  const v = pv(T, "p1", ["H1"]), armed = M.dockData(D.playerModel(v, { id: "p1", owns: ["H1"] }, ctx(T)), { armed: "slugfest", targets: ["N1"] }, { ...pf(T, "p1", v), preview: (cid, decl) => T.preview("p1", cid, decl) }, tr("en"));
  const ch = armed.panel?.chance;
  await T.req("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1"] } });
  const note = desk(T).cards.find((c) => c.kind === "reaction")?.options.find((o) => o.id === "pass")?.note ?? "";
  const gm = /\[\[odds:(\d)\]\] ([^,]+), (\d+%)/.exec(note);
  ok(!!gm && !!ch, `U156: the GM's card carries the sign, the word and the per cent (${note}); the player's panel its chance (${ch?.text})`);
  eq([Number(gm?.[1]) - 1, gm?.[2]], [ch?.level, String(ch?.text).toLowerCase()], "U156: the GM's undefended chance and the player's chance of the same attack: the same sign level and the same word");
  T.turn("N1"); const T2 = base(); await T2.gm({ op: "declare", actor: "N1", decl: { action: "slugfest", targets: ["H2"] } });
  const ask = dock(T2, "p2", ["H2"]).prompts[0], pn = ask?.options.find((o) => o.id === "pass")?.note ?? "";
  ok(/^attack lands: \[\[odds:\d\]\] [a-z ]+$/.test(pn), `U156: the player's reaction card: the same sign and word, no per cent (${pn})`);
  eq(Kit.plain("attack lands: [[odds:3]] likely", "en"), "attack lands: likely", "U156: in words the sign is silent (its word follows)");
  ok(/ipu-k-odds-3/.test(Kit.richHtml("[[odds:3]] likely")), "U156: drawn, it is the token's own sign (odds-3)");
  for (const l of ["en", "pl"]) eq(Kit.plain(tIn(l, "ITAC.ui.odds.band", { lv: 2, band: "x" }), l).includes("[["), false, `U156: no token is left in words (${l})`);
}

/* ---- U159: the waiting line speaks ABOUT whoever is waited for; the user's own pending answer is listed too */
{
  const w = [{ to: ["p1"], kind: "reaction", aboutName: "Omni" }, { to: ["p2"], kind: "reaction", aboutName: "Kid" }];
  const rows = M.waitingData(w, { me: "p1", staff: false, userName: (u) => `User ${u}` }, tr("en"));
  eq(rows.map((r) => [r.who, r.what.join(", "), r.mine]), [["you", "reaction (Omni)", true], ["User p2", "reaction (Kid)", false]], "U159: 'you: reaction (Omni)', then the other player in the third person");
  const pl = M.waitingData(w, { me: "p1", staff: false, userName: (u) => `User ${u}` }, tr("pl"));
  eq(pl.map((r) => r.who + ": " + r.what.join(", ")), ["ciebie: reakcja (Omni)", "User p2: reakcja (Kid)"], "U159: Polish ('Czekamy na' ciebie / gracza)");
  ok(!/\?/.test(JSON.stringify(rows)), "U159: no question addressed to somebody else ('Will you react?') on the line");
  ok(/waitAll\.some\(\(w\) => !w\.mine\)/.test(src("./ui/model-pure.mjs")), "U159: the own row stays when others are waited for too");
}

/* ---- U147: the first-turn hint names the two marks */
{
  for (const [l, words] of [["en", ["full action [[full]]", "quick action [[quick]]"]], ["pl", ["pełną akcję [[full]]", "szybką akcję [[quick]]"]]]) {
    const s = tIn(l, "ITAC.hint.slots");
    ok(words.every((w) => s.includes(w)), `U147: the hint says what each mark is (${l})`);
  }
}

/* ---- U161: a name in the round summary is never cut short */
{
  const css = readFileSync(new URL("../../styles/tactics-ui.css", import.meta.url), "utf8");
  ok(/\.ita-sum-n \{[^}]*-webkit-line-clamp: 2/.test(css) && !/\.ita-sum-n \{[^}]*text-overflow: ellipsis/.test(css), "U161: a long name takes a second line instead of an ellipsis");
}

/* ---- D129: the splash's sentences in the table's language; the sound words stay */
{
  const keys = Object.values(SL.SAYS).map((k) => `INSPLASH.Say.${k}`);
  ok(keys.every((k) => k in SLang.EN && k in SLang.PL), "D129: every ribbon / stress sentence has an EN and a PL word");
  for (const [en, k] of Object.entries(SL.SAYS)) eq(SLang.EN[`INSPLASH.Say.${k}`], en, `D129: EN keeps the original (${en})`);
  ok(Object.values(SL.SAYS).every((k) => SLang.PL[`INSPLASH.Say.${k}`] !== SLang.EN[`INSPLASH.Say.${k}`]), "D129: PL says each in Polish");
  eq(SL.say("SHRUGS IT OFF"), "SHRUGS IT OFF", "D129: without labels the word is English (no Foundry)");
  SL.setLabels({ words: Object.fromEntries(Object.values(SL.SAYS).map((k) => [k, SLang.PL[`INSPLASH.Say.${k}`]])) });
  eq([SL.say("SHRUGS IT OFF"), SL.say("UNLUCKY!"), SL.oddsText(0.75), SL.say("WHAM!")], ["OTRZĄSA SIĘ", "PECH!", "NIEMOŻLIWE!", "WHAM!"], "D129: on a PL seat the sentences are Polish, a sound word is not touched");
  SL.setLabels({ words: {} });
  const sp = src("../splash/splash.mjs"), st = src("../splash/stage.mjs");
  ok(!/return '(BREAKING POINT!|ON THE EDGE!|FEELING THE STRAIN|SHAKEN|SHRUGS IT OFF)'/.test(sp) && !/: 'FEELING THE STRAIN';/.test(sp) && /say\(dF > 0\.6/.test(st), "D129: every sentence goes through say()");
  for (const w of [...Object.values(SL.ACTIONS).flat(), ...SL.FAIL, ...SL.PUSHPRE]) ok(!(w in SL.SAYS), `D129: the sound word ${w} stays English`);
}

/* ---- U151: the attack's success word waits for the verdict; a defence's word plays only when it held */
{
  eq(SL.holdFor({ inst: "a1", key: "attack" }, { fail: false }), { inst: "a1", target: null, want: true }, "U151: an attack roll with sixes waits for the hit");
  eq(SL.holdFor({ inst: "a1", key: "def:N1" }, { fail: false }), { inst: "a1", target: "N1", want: false }, "U151: a defence roll waits for the miss it made");
  eq([SL.holdFor({ inst: "a1", key: "attack" }, { fail: true }), SL.holdFor(null, { fail: false }), SL.holdFor({ inst: "a1", key: "roll" }, { fail: false })], [null, null, null], "U151: a failed roll, an untagged roll, another roll: as always");
  eq([SL.playsAfter({ want: true }, true), SL.playsAfter({ want: true }, false), SL.playsAfter({ want: true }, null), SL.playsAfter({ want: false }, false), SL.playsAfter(null, null)], [true, false, false, true, true], "U151: WHAM! only on a hit; nothing when no verdict came");
  const pending = Moment.verdict("x1", { cap: 500 });
  Moment.told("x1", "N1", false); Moment.told("x1", "N2", true);
  eq(await pending, true, "U151: an area attack that hit anybody plays");
  eq([await Moment.verdict("x1", { target: "N1" }), await Moment.verdict("x1", { target: "N2" }), await Moment.verdict("zz", { cap: 10 })], [false, true, null], "U151: per target; none within the cap -> null");
  const m = src("../splash/main.mjs"), cam = src("./ui/camera.mjs");
  ok(/holdFor\(message\.rolls\?\.\[0\]\?\.options\?\.tactics, ev\)/.test(m) && /Moment\.verdict\(hold\.inst/.test(m), "U151: the splash asks the verdict of its exchange");
  ok(/Moment\.told\(ev\.inst, /.test(cam) && /Moment\.listen\(\)/.test(cam), "U151: the tactics side tells the verdict on every client");
}

/* ---- every new word in both languages */
{
  const mine = Object.keys((await import("./lang-uxb.mjs")).EN_UXB);
  ok(mine.every((k) => k in EN && k in PL && PL[k]), "UXB: every key of lang-uxb in EN and PL");
}
done("check-uxb");
