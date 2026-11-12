// node scripts/sweep-checks/fxy.mjs  (FXY: U178 the held End press on the GM seat, FXW-3 the intention's 28 characters, FXW-4 a failed
// stepper request puts the number back with the map's menuSet, T030/T034 residue (a scribe write between deleteLog's page delete and
// the journal delete), the stale header of news-pure.mjs)
import { readFileSync } from "node:fs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const rd = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

/* ================================================================== U178: the End press is timed by its own run of dice */
const NewsP = await import("../tactics/ui/news-pure.mjs");
{
  const { diceRun, endAfterDice, diceHold, HOLD_MS } = NewsP;
  ck("U178 diceRun: nothing rolls = no run", diceRun({ ids: ["m1"], since: 5 }, [], 100) === null && diceRun(null, null, 100) === null);
  const a = diceRun(null, ["m1"], 1000);
  ck("U178 diceRun: a first run starts its clock when seen", a?.since === 1000 && a.ids.join() === "m1");
  const b = diceRun(a, ["m1", "m2"], 4000);
  ck("U178 diceRun: a message joining the dice in the air keeps the run's clock", b?.since === 1000);
  const c = diceRun(b, ["m3"], 60000);
  ck("U178 diceRun: a run sharing no message with the last one is new (its own clock)", c?.since === 60000);
  /* the defect: the last draw saw roll 1 in the air (since T0) and no draw ran after it landed (nothing was held); roll 2 a minute
     later: diceHold keeps T0 while busy, so the press read a clock past HOLD_MS and the turn passed at once */
  const T0 = 1000, held1 = diceHold(null, { prompts: [], cards: [], news: null, at: T0 }, true);
  const held2 = diceHold({ ...held1 }, { prompts: [], cards: [], news: null, at: T0 + 60000 }, true);
  const req = { op: "endTurn", actor: "H1", round: 2, slot: "s1" };
  ck("U178 (the cause, kept as evidence): the draw's clock is stale on roll 2", held2.since === T0 && !endAfterDice(req, { busy: true, since: held2.since, at: T0 + 60500 }));
  const r1 = diceRun(null, ["roll1"], T0), r2 = diceRun(r1, ["roll2"], T0 + 60000);
  ck("U178: with the run's own clock the press on roll 2 is held for its dice", endAfterDice(req, { busy: true, since: r2.since, at: T0 + 60500 }));
  ck("U178: a stuck flag still never keeps the turn (HOLD_MS from the first sight)", !endAfterDice(req, { busy: true, since: diceRun(r2, ["roll2"], T0 + 70000).since, at: T0 + 60000 + HOLD_MS + 1 }));
  const main = rd("../tactics/ui/main.mjs"), dock = rd("../tactics/ui/dock.mjs");
  ck("U178: send() times the End press with diceSince(), not the last draw's diceWas.since", /if \(NewsP\.endAfterDice\(req, \{ busy: diceBusy\(\), since: diceSince\(\), at: Date\.now\(\) \}\)\) await diceLanded\(\);/.test(main) && !/endAfterDice\(req, \{[^}]*diceWas/.test(main));
  ck("U178: diceSince follows the messages whose dice are in the air (news-pure diceRun)", /const diceSince = \(\) => \{[^\n]*NewsP\.diceRun\(diceRunWas, \(game\.messages\?\.contents \?\? \[\]\)\.slice\(-12\)\.filter\(\(m\) => m\?\._dice3danimating\)\.map\(\(m\) => m\.id\)/.test(main));
  ck("U178: each draw notes the run (the clock starts at the first sight; FXB2: the draw reads it, diceClock)", /const diceNow = Wait\.diceHolds\(diceBusy\(\), diceSince\(\), Date\.now\(\)\)\.on;/.test(main) && /NewsP\.diceHold\(NewsP\.diceClock\(diceWas, diceSince\(\)\), /.test(main));
  ck("U178: a press while the last End press is out is the same press (not sent again)", /function endPress\(req\) \{\s*if \(endOut\) return endOut;/.test(dock) && /endOut = Promise\.resolve\(send\(req, \{ endArmed: false \}\)\)\.finally\(\(\) => \{ endOut = null;/.test(dock));
}

/* ================================================================== FXW-3: the intention carries 28 characters */
const BP = await import("../tactics/ui/board-pure.mjs");
{
  ck("FXW-3: the map's limit (28) is the combat side's", BP.INTENT_LABEL === 28);
  ck("FXW-3: the longest Polish action name stands whole", BP.intentLabel("Otrząśnij się z dolegliwości") === "Otrząśnij się z dolegliwości");
  ck("FXW-3: 'Odzyskaj Determinację' is no longer cut", BP.intentLabel("Odzyskaj Determinację") === "Odzyskaj Determinację");
  ck("FXW-3: past 28 it ends in an ellipsis inside 28", BP.intentLabel("a".repeat(29)) === `${"a".repeat(27)}…`);
  ck("FXW-3: a token's pill and a link keep the marks' 18", /const LABEL = 18;/.test(rd("../tactics/ui/board-pure.mjs")));
}

/* ================================================================== FXW-4: a failed step puts the number back, the menu left open */
{
  ck("FXW-4 stepBack: the open menu of the same token: put back", BP.stepBack("N1", "N1", true) === "set");
  ck("FXW-4 stepBack: another token's menu, another kind of menu, or none: nothing", BP.stepBack("N2", "N1", true) === "none" && BP.stepBack(null, "N1", true) === "none" && BP.stepBack("N1", "N1", false) === "none");
  const calls = [];
  const mk = (withSet) => ({ modules: { get: () => ({ active: true, api: { zones: { menuOpen: () => true, ...(withSet ? { menuSet: (id, p) => { calls.push([id, p]); return id === "health"; } } : {}) } } }) } });
  globalThis.game = mk(true);
  const Z = await import("../tactics/zones-adapter.mjs");
  ck("FXW-4 adapter: menuSet passes the entry and the value to the map", Z.menuSet("health", { value: 4 }) === true && JSON.stringify(calls[0]) === JSON.stringify(["health", { value: 4 }]));
  ck("FXW-4 adapter: an entry the map does not know: false", Z.menuSet("nope", { value: 1 }) === false);
  globalThis.game = mk(false);
  ck("FXW-4 adapter: a map without menuSet: null (the caller opens the menu again)", Z.menuSet("health", { value: 4 }) === null);
  delete globalThis.game;
  const board = rd("../tactics/ui/board.mjs");
  ck("FXW-4: a failed step goes through stepUndo with the number it was counted from", /if \(BP\.stepFailed\(env\)\) \{ from = was; stepUndo\(cid, it\.id, was\); \}/.test(board));
  ck("FXW-4: stepUndo puts it back with menuSet, opens the menu again only on a map without it", /function stepUndo\(cid, id, was\) \{\s*const how = BP\.stepBack\(menuFor, cid, Zones\.menuOpen\(\)\);\s*if \(how === "set" && Zones\.menuSet\(id, \{ value: was \}\) === null\) again\(cid\);\s*\}/.test(board));
  ck("FXW-4: the token menu notes whose it is; the border and the ways menus clear it", /function tokenMenu\(cid, acts\) \{\s*menuFor = cid;/.test(board) && /function borderMenu\(br, bar\) \{\s*menuFor = null;/.test(board) && /menuBusy = true; menuFor = null;\s*Zones\.menu\(\{ zone/.test(board));
}

/* ================================================================== T030 / T034 residue: nothing written while the log is deleted */
{
  const gets = [];
  globalThis.Hooks = { on() {}, callAll() {} };
  globalThis.game = { actors: { get: (id) => { gets.push(id); return null; } }, users: { get: () => null }, settings: { get: () => undefined }, journal: { get: () => null, contents: [] }, user: { id: "gm1" } };
  const Sc = await import("../log/scribe.mjs");
  const S = Sc.state;
  S.on = true; S.states.clear(); for (const a of ["A", "B"]) S.states.set(a, { actorId: a, scope: "hero", prev: {} });
  const now = Date.now();
  const draft = (actorId, i) => ({ actorId, k: "stat.vital", path: "health", u: "", t: now - 60000 + i, d: { key: "health", from: 5 + i, to: 4 + i } });
  Sc.holdLog("A");
  ck("T030: holdLog forgets the actor (its state goes)", !S.states.has("A") && S.held.has("A"));
  /* a capture that came in the window: a fresh state (updateActor re-creates it) and a batch made from it AFTER the hold */
  S.states.set("A", { actorId: "A", scope: "hero", prev: {} });
  const warn0 = console.warn; console.warn = () => {};
  S.co.add(draft("A", 1)); S.co.add(draft("B", 2));
  Sc.tick(true); await S.chain.catch(() => {});
  console.warn = warn0;
  ck("T030 residue: a batch made during the deletion is not written (the store is never reached for it)", !gets.includes("A"));
  ck("T030 residue: (another actor's batch is written)", gets.includes("B"));
  S.held.set("A", Date.now() - Sc.HELD_MS - 1); gets.length = 0;
  S.co.add(draft("A", 3)); Sc.tick(true); await S.chain.catch(() => {});
  ck("T030 residue: the hold lets go by itself after HELD_MS (a deletion that died half way)", gets.includes("A") && !S.held.has("A"));
  S.held.set("A", Date.now()); await Sc.rebaseline("A");
  ck("T030 residue: the fresh log (rebaseline) lets the hold go", !S.held.has("A"));
  S.on = false;
  delete globalThis.game;
  const sc = rd("../log/scribe.mjs"), store = rd("../log/store.mjs"), maint = rd("../log/maint.mjs");
  ck("T030 residue: deleteLog marks the journal `deleting` before any page goes", /if \(j\) \{ stats\.journalUpdates\+\+; await j\.update\(\{ \[`flags\.\$\{MOD\}\.log\.deleting`\]: Date\.now\(\) \}, O\(\)\); \}\s*if \(gm\) \{\s*const ids = /.test(store) && store.indexOf("log.deleting`]") < store.indexOf('gm.deleteEmbeddedDocuments("JournalEntryPage", ids'));
  ck("T030 residue: the scribe holds the log when another GM's mark arrives", /Hooks\.on\("updateJournalEntry", onFlagLogJournal\)/.test(sc) && /const onFlagLogJournal = guard\("updateJournal", \(j, changes, options, userId\) => \{[\s\S]{0,260}changes\?\.flags\?\.\[MOD\]\?\.log\?\.deleting[\s\S]{0,120}holdLog\(lg\.actorId\);/.test(sc));
  ck("T030 residue: the journal's delete lets the hold go and starts the fresh log (not twice for our own remove)", /const held = S\.held\.delete\(lg\.actorId\);\s*\/\/[^\n]*\n\s*if \(userId && userId === game\.user\?\.id\) return;[^\n]*\n\s*if \(!held && !S\.states\.has\(lg\.actorId\)\) return;/.test(sc));
  ck("T030 residue: our own remove() holds the log too (a capture made during its deletion is dropped)", /await Scribe\.drain\(\); Scribe\.holdLog\(l\.actorId\);/.test(maint));
  ck("T030 residue: write and the snapshot skip a held actor", /if \(heldOff\(actorId\)\) return;/.test(sc) && /async function persistSnapshot\(actor, scope\) \{\s*if \(heldOff\(actor\.id\)\) return;/.test(sc));
  ck("T030 residue: a mark left by a deletion that died is cleared by the next baseline", /if \(had\?\.flags\?\.\[MOD\]\?\.log\?\.deleting\) \{ try \{ await Store\.flagJournal\(actor\.id, \{ "-=deleting": null \}\);/.test(sc));
}

/* ================================================================== news-pure.mjs header: a concealed turn counts (FXN-7) */
{
  const head = rd("../tactics/ui/news-pure.mjs").split("\n").slice(0, 9).join("\n");
  ck("FXN-7 header: no longer says a concealed turn is no new turn", !/that is no new turn/.test(head) && /concealed from the user counts as a turn too, FXN-7/.test(head));
}

console.log(`sweep fxy: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
