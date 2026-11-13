// node scripts/sweep-checks/fxt2.mjs  (FXT2: the character generator defects GENR-1..GENR-10 found by the live tester GENR, and the gaps built against
// the spec: GENR-1 the hero code reproduces the hero on screen or says it does not, GENR-2 preview counts errors and warnings, GENR-3 the legal power
// trade is info, GENR-4 personality word case, GENR-5 "Name (kind)", GENR-6 hero relations told apart / never the own name, GENR-8 repeatable talents
// in random heroes, GENR-9 "Read in the book" on the rank step, GENR-10 window size by viewport)
import { readFileSync } from "node:fs";
import * as R from "../chargen/rules.mjs";
import * as S from "../chargen/state.mjs";
import * as RR from "../chargen/reroll.mjs";
import { rollStep } from "../chargen/random.mjs";
import { summaryRows } from "../chargen/steps/summary.mjs";
import { heroTwins } from "../chargen/catalog.mjs";

let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const rd = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const J = (x) => JSON.stringify(x);

/* ---------------------------------------------------------------- a small provider shaped like the real one */
const L = (p, k) => Array.from({ length: k }, (_, i) => `${p}${i + 1}`);
const E = (names) => names.map((name) => ({ name, packUuid: `fx.${name.replace(/\W+/g, "")}` }));
const ARCH = ["Nova", "Beacon", "Monster", "Psychic"];
const ARCHDATA = {
  Nova: { attrs: [6, 9, 3, 3, 3, 4], powers: [[0, 0], [0, 0], [0, 0], [1, 1]] },
  Beacon: { attrs: [6, 5, 6, 4, 4, 9], powers: [[0, 0], [0, 0], [0, 0]] },
  Monster: { attrs: [8, 5, 9, 2, 5, 3], powers: [[0, 0], [0, 0], [0, 0], [0, 0]] },
  Psychic: { attrs: [3, 4, 2, 4, 8, 9], powers: [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]] }
};
const TALENTS = [...L("Tal", 8), "Durable", "Determined", "Windfall"];
function provider({ heroes = ["Ally", "Hero1", "Hero2"] } = {}) {
  return {
    getArchetype: async (id) => (ARCHDATA[id] ? { id, role: R.ROLES[ARCH.indexOf(id)], attrs: Object.fromEntries(R.ATTRS.map((k, i) => [k, ARCHDATA[id].attrs[i]])), powers: ARCHDATA[id].powers.map(([level, nb], i) => ({ name: `${id}Pow${i}`, level, boosts: L(`${id}B`, nb).map((name) => ({ name })) })) } : null),
    list: async (key, ctx = {}) => {
      switch (key) {
        case "archetypes": return ARCH.map((name) => ({ name }));
        case "powers": return L("Pow", 20).map((name, i) => ({ name, packUuid: `fx.${name}`, type: `T${i % 6}`, maxLevel: 3 }));
        case "boosts": return ctx.power ? E([`${ctx.power}-B1`, `${ctx.power}-B2`]) : [];
        case "limits": return ctx.power ? E([`${ctx.power}-L1`]) : [];
        case "powerSources": return E(L("Src", ctx.archetype ? 3 : 12));
        case "heroTalents": return E(ctx.archetype ? L("Tal", 6) : TALENTS);
        case "talents": return E(TALENTS);
        case "drawbacks": return E(L("Dwb", 6));
        case "knowledgeableSubjects": return E(L("Know", 6));
        case "occupations": return L("Occ", 6).map((name, i) => ({ name, data: { resources: 2 + (i % 4) } }));
        case "occupationTalents": return E(L("OccTal", 3));
        case "npcRelations": return E(L("Rel", 3));
        case "personality": return E(L("Per", 12));
        case "drives": case "flaws": return E(L(key, 6)).map((e) => ({ ...e, text: "Text." }));
        case "heroNames": return E(["Hero1", "Hero2", "Hero3"]);
        case "civilianNames": return E(L("Civ", 9));
        case "teamNames": return E(L("Team", 10));
        case "teamBases": return E(L("Base", 4));
        case "baseUpgrades": return E(L("Upg", 6));
        case "heroRelations": return heroes.map((name, i) => ({ name, packUuid: `Actor.h${i}`, data: { actorUuid: `Actor.h${i}` } }));
        case "cityLocations": return E(L("City", 12));
        default: return [];
      }
    }
  };
}
const P = provider();
const ro = (spice, within = false) => RR.withToggle(RR.withSpice(S.createState({ seed: "x" }), spice), "within", within).rollOpts;
/** what pasting a code on the board does: withCode + reseed onto some other hero */
async function viaCode(code, other) { const c = RR.parseHeroCode(code); return (await RR.reseed(RR.withCode(other, c), c.seed, P)).state; }

/* ================================================================== GENR-1: the hero code */
{
  const other = (await RR.rollNewHero(P, { rank: "global", seed: "other" })).state;
  let bad = { fresh: 0, all: 0, allRepro: 0, det: 0, row: 0, lock: 0, keptAll: 0, rank: 0, rankRepro: 0, spice: 0, edit: 0, ser: 0 };
  let rowsChanged = 0;
  for (const rank of R.RANK_ORDER) for (let i = 0; i < 25; i++) {
    const spice = RR.SPICES[i % 3];
    const s0 = (await RR.rollNewHero(P, { rank, seed: `g1-${rank}-${i}`, rollOpts: ro(spice, i % 4 === 0) })).state;
    if (!RR.codeMatches(s0)) bad.fresh++;
    // "Reroll all unlocked" with nothing kept: a new (derived) seed, the code rolls exactly this hero, and the step is deterministic
    const s1 = (await RR.rerollUnlocked(s0, P)).state;
    if (!RR.codeMatches(s1) || RR.heroCode(s1) === RR.heroCode(s0)) bad.all++;
    if (J(await viaCode(RR.heroCode(s1), other)) !== J(s1)) bad.allRepro++;
    const fresh = (await RR.rollNewHero(P, { rank, seed: s1.seed, rollOpts: s1.rollOpts })).state;
    if (J(fresh) !== J(s1)) bad.allRepro++;
    if (J((await RR.rerollUnlocked(s0, P)).state) !== J(s1)) bad.det++;
    // a row reroll changes the hero but not the code: the code no longer matches
    const s2 = await RR.rerollRow(s0, "persona", P);
    if (s2 !== s0) { rowsChanged++; if (RR.codeMatches(s2)) bad.row++; }
    // locking a row changes nothing the code rolls; a reroll around the kept row does
    const locked = RR.toggleRowLock(s0, "powers");
    if (!RR.codeMatches(locked)) bad.lock++;
    const s3 = (await RR.rerollUnlocked(locked, P)).state;
    if (J(s3.powers) !== J(s0.powers)) bad.keptAll++;
    // whenever the board claims the code matches, a fresh roll of that code must give every rolled value on screen
    if (RR.codeMatches(s3) && RR.heroPrint((await RR.rollNewHero(P, { rank, seed: s3.seed, rollOpts: s3.rollOpts })).state) !== RR.heroPrint(s3)) bad.keptAll++;
    // a rank change with nothing kept: the same seed at the new rank, reproducible
    const to = R.RANK_ORDER[(R.RANK_ORDER.indexOf(rank) + 1) % 4];
    const s4 = (await RR.changeRank(s0, to, P)).state;
    if (!RR.codeMatches(s4) || s4.seed !== s0.seed || s4.rank !== to) bad.rank++;
    if (J((await RR.rollNewHero(P, { rank: to, seed: s0.seed, rollOpts: s0.rollOpts })).state) !== J(s4)) bad.rankRepro++;
    // a new setting without a roll: the code says so
    if (RR.codeMatches(RR.withSpice(s0, RR.SPICES[(i + 1) % 3]))) bad.spice++;
    // a hand edit that changes a value -> stale; putting it back -> matches again
    const e1 = S.markTouched(S.patch(s0, { heroName: `${s0.heroName}X` }), "persona");
    if (RR.codeMatches(e1) || !RR.codeMatches(S.patch(e1, { heroName: s0.heroName }))) bad.edit++;
    // drafts keep the stamp
    if (RR.codeMatches(S.deserialize(S.serialize(s0))) !== true || RR.codeMatches(S.deserialize(S.serialize(s2))) !== RR.codeMatches(s2)) bad.ser++;
  }
  ck(`GENR-1 a fresh roll matches its code (${bad.fresh} bad)`, bad.fresh === 0);
  ck(`GENR-1 'Reroll all unlocked' with nothing kept gets a new code that matches (${bad.all} bad)`, bad.all === 0);
  ck(`GENR-1 that code, pasted or rolled fresh, gives exactly the hero on screen (${bad.allRepro} bad)`, bad.allRepro === 0);
  ck(`GENR-1 'Reroll all' is deterministic for the same state (${bad.det} bad)`, bad.det === 0);
  ck(`GENR-1 a row reroll makes the code stale (${bad.row} bad of ${rowsChanged})`, bad.row === 0 && rowsChanged > 50);
  ck(`GENR-1 a lock alone keeps the code; a reroll around a kept row keeps it and never claims a code it cannot back (${bad.lock + bad.keptAll} bad)`, bad.lock === 0 && bad.keptAll === 0);
  ck(`GENR-1 a rank change with nothing kept rolls the same seed at the new rank (${bad.rank} / ${bad.rankRepro} bad)`, bad.rank === 0 && bad.rankRepro === 0);
  ck(`GENR-1 a changed roll setting makes the code stale (${bad.spice} bad)`, bad.spice === 0);
  ck(`GENR-1 a hand edit makes it stale, undoing the edit matches again (${bad.edit} bad)`, bad.edit === 0);
  ck(`GENR-1 the stamp survives a draft (${bad.ser} bad)`, bad.ser === 0);
  // the tester's repro: roll, "Reroll all unlocked", take the code, roll it -> the hero on screen, 6 of 6 (before: the pre-reroll hero 6 of 6)
  let same = 0;
  for (let i = 0; i < 6; i++) {
    const a = (await RR.rollNewHero(P, { rank: "global", seed: `gc${i}`, rollOpts: ro("standard") })).state;
    const b = (await RR.rerollUnlocked(a, P)).state;
    const c = (await RR.rollNewHero(P, { rank: "global", seed: RR.parseHeroCode(RR.heroCode(b)).seed, rollOpts: b.rollOpts })).state;
    if (J(c) === J(b)) same++;
  }
  ck(`GENR-1 tester repro: the code after 'Reroll all' rolls the rerolled hero (${same}/6)`, same === 6);
  ck("GENR-1 deserialize refuses a malformed stamp", S.deserialize(J({ ...S.createState(), rolledAs: { code: 5 } })).rolledAs === null);
  const board = rd("../chargen/steps/board.mjs"), review = rd("../chargen/steps/review.mjs");
  ck("GENR-1 the board shows the stale note when the code no longer matches", /!RR\.codeMatches\(ctx\.state\)/.test(board) && /IPC\.Board\.Seed\.Stale/.test(board));
  ck("GENR-1 the result view only says 'roll this hero again' when the code matches", /const fresh = codeMatches\(s\)/.test(review) && /fresh \? "IPC\.Result\.CodeHint" : "IPC\.Result\.CodeStale"/.test(review) && !/CodeEdited/.test(review));
}

/* ================================================================== GENR-2: the preview counts errors AND warnings */
{
  const wiz = rd("../chargen/wizard.mjs");
  ck("GENR-2 the preview heading counts errors and warnings (IPC.Preview.Counts e / w)", /IPC\.Preview\.Counts", \{ e: errs\.length, w: warns\.length \}/.test(wiz) && !/IPC\.Preview\.Problems/.test(wiz));
  ck("GENR-2 the preview list shows warnings too, never an empty list under a count", /\.\.\.warns\.map\(\(i\) => \["ipc-iss-warn"/.test(wiz) && /const issues = shown\.length/.test(wiz));
  const lang = rd("../chargen/lang.mjs");
  ck("GENR-2 EN / PL words match Review's (Errors / Warnings, Błędy / Ostrzeżenia)", /"IPC\.Preview\.Counts": "Errors: \{e\}\. Warnings: \{w\}\."/.test(lang) && /"IPC\.Preview\.Counts": "Błędy: \{e\}\. Ostrzeżenia: \{w\}\."/.test(lang));
}

/* ================================================================== GENR-3: the archetype's power trade is not a warning */
{
  let traded = 0, warned = 0, info = 0;
  for (const rank of R.RANK_ORDER) for (let i = 0; i < 40; i++) {
    const s = (await RR.rollNewHero(P, { rank, seed: `g3-${rank}-${i}`, rollOpts: ro("simple", true) })).state;
    if (R.slots(s) <= R.RANKS[rank].powers) continue;
    traded++;
    const v = R.validate(s);
    if (v.warnings.some((w) => w.code === "slots.over")) warned++;
    if (v.issues.some((x) => x.code === "slots.over" && x.severity === "info")) info++;
  }
  ck(`GENR-3 within-archetype heroes that trade powers for points carry no slots warning (${warned} of ${traded})`, traded > 20 && warned === 0 && info === traded);
  const css = rd("../../styles/chargen.css");
  ck("GENR-3 traded slots are not painted red (preview, meter, cells)", !/ipc-pv-slots\.ipc-over/.test(css) && !/ipc-pw-meter\.is-over[^{]*\{[^}]*ipc-red/.test(css) && !/ipc-pw-cell\.is-extra[^{]*\{[^}]*ipc-red/.test(css));
}

/* ================================================================== GENR-4: one case for personality words */
{
  ck("GENR-4 wordCase", R.wordCase("clinical") === "Clinical" && R.wordCase("Stubborn") === "Stubborn" && R.wordCase(" hot-headed ") === "Hot-headed" && R.wordCase("") === "" && R.wordCase(null) === "");
  const cat = rd("../chargen/catalog.mjs");
  ck("GENR-4 the provider lists AND rolls personality words through wordCase", /case "personality": \{[^]*?wordCase\(e\.name\)/.test(cat) && /key === "personality"\) return \{ \.\.\.e, name: wordCase\(e\.name\) \}/.test(cat));
}

/* ================================================================== GENR-5: "Name (kind)" on the roll board */
{
  const s = S.patch(S.createState(), { occupation: "Doctor", resources: 4, npcRel: { name: "Noah Garcia", type: "Engaging therapist" } });
  const row = summaryRows("life", s).at(-1);
  ck(`GENR-5 the key NPC reads "Noah Garcia (Engaging therapist)" (got "${row.value}")`, row.value === "Noah Garcia (Engaging therapist)");
  const only = summaryRows("life", S.patch(s, { npcRel: { name: "", type: "Rival" } })).at(-1);
  ck("GENR-5 a kind without a name has no stray separator", only.value === "(Rival)");
}

/* ================================================================== GENR-6: hero relations */
{
  const tw = heroTwins([{ name: "Denizen", data: { owners: ["A"] } }, { name: "denizen", data: { owners: ["B"] } }, { name: "Solo", data: { owners: ["A"] } }, { name: "Denizen", data: { owners: ["A"] } }]);
  ck("GENR-6 same-name heroes are marked, a number only where name AND players repeat", tw[0].data.dup && tw[0].data.twin === 1 && tw[1].data.dup && !tw[1].data.twin && !tw[2].data.dup && tw[3].data.twin === 2);
  // never the hero's own name as the second key relationship (world heroes named like the rolled hero)
  const PX = provider({ heroes: ["Hero1", "Hero2", "Hero3", "Other"] });
  let clash = 0, rels = 0;
  for (let i = 0; i < 120; i++) {
    const s = (await RR.rollNewHero(PX, { rank: "global", seed: `g6-${i}`, rollOpts: ro("standard") })).state;
    if (s.heroRel.name) rels++;
    if (s.heroRel.name && R.normName(s.heroRel.name) === R.normName(s.heroName)) clash++;
    const t = await rollStep(s, "team", PX, { heroRel: true });
    if (t.heroRel.name && R.normName(t.heroRel.name) === R.normName(t.heroName)) clash++;
    const p = await rollStep(s, "persona", PX, {});
    if (p.heroRel.name && R.normName(p.heroRel.name) === R.normName(p.heroName)) clash++;
  }
  ck(`GENR-6 a rolled hero is never its own key relationship (${clash} clashes, ${rels} relations)`, clash === 0 && rels > 100);
  const team = rd("../chargen/steps/team.mjs");
  ck("GENR-6 the Team step shows who plays each listed hero and its dice skip the own name", /IPC\.Team\.Rel\.PlayedBy/.test(team) && /nm\(x\.name\) !== nm\(s\.heroName\)/.test(team));
}

/* ================================================================== GENR-8: Durable / Determined / Windfall may repeat in random heroes */
{
  let repeats = 0, over = 0, invalid = 0;
  for (let i = 0; i < 600; i++) {
    const s = (await RR.rollNewHero(P, { rank: R.RANK_ORDER[i % 4], seed: `g8-${i}`, rollOpts: ro("wild") })).state;
    const tal = [s.heroTalent?.name, s.occTalent?.name, ...s.extraTalents.map((x) => x.name)].filter(Boolean);
    const keys = tal.map(R.talentKey);
    if (keys.some((k, j) => keys.indexOf(k) !== j)) repeats++;
    if (tal.some((t) => keys.filter((k) => k === R.talentKey(t)).length > R.talentLimit(t))) over++;
    if (!R.validate(s).ok) invalid++;
  }
  ck(`GENR-8 random heroes may take a repeatable talent again (${repeats} of 600), never over its limit (${over}), all valid (${invalid} invalid)`, repeats > 0 && over === 0 && invalid === 0);
}

/* ================================================================== GENR-9 / GENR-10: rank book link, window size */
{
  const rank = rd("../chargen/steps/rank.mjs"), shared = rd("../chargen/steps/shared.mjs");
  ck("GENR-9 the rank step links the book's Hero Rank page (spec 9.2 step 1)", /const BOOK_PAGE = "Hero Rank"/.test(rank) && /data-act="book"/.test(rank) && /openBookPage\(BOOK, BOOK_PAGE\)/.test(rank) && /pageId: page\.id/.test(shared));
  const wiz = rd("../chargen/wizard.mjs");
  const m = wiz.match(/const w = (Math\.max\(560[^;]*);\s*const h = (Math\.max\(440[^;]*);/);
  ck("GENR-10 the window size formula is present", !!m);
  if (m) {
    const size = (vw, vh) => [Function("vw", `return ${m[1]};`)(vw), Function("vh", `return ${m[2]};`)(vh)];
    const [w1, h1] = size(1920, 1080), [w2, h2] = size(1366, 768), [w3, h3] = size(800, 500);
    ck(`GENR-10 1920x1080 opens larger than 940x660 (${w1}x${h1})`, w1 >= 1150 && h1 >= 900 && w1 <= 1896 && h1 <= 1056);
    ck(`GENR-10 1366x768 keeps the old default (${w2}x${h2})`, w2 === 940 && h2 === 660);
    ck(`GENR-10 a small screen still fits (${w3}x${h3})`, w3 === 776 && h3 === 476);
  }
}

console.log(`sweep fxt2: ${n} checks, ${f} failed`);
if (f) process.exitCode = 1;
