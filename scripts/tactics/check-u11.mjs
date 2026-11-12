/* node scripts/tactics/check-u11.mjs -- ledger rows U62-U64 (interface scale, states told by shape, the remembered layout) and the
   leftovers U70-U80 of dev/combat-usability.md, each through the real pure modules (director, engine, view, models) or, where the
   behaviour is a stylesheet's, through the stylesheet's own text. */
import { readFileSync } from "node:fs";
import { Table, ok, eq, done } from "./testkit.mjs";
import * as D from "./desk-pure.mjs";
import * as V from "./view-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as Lg from "./ledger-pure.mjs";
import * as ZP from "./zones-pure.mjs";
import * as MP from "./movement-pure.mjs";
import * as Sys from "./system-adapter.mjs";
import * as M from "./ui/model-pure.mjs";
import * as BP from "./ui/board-pure.mjs";
import * as Lay from "./ui/layout-pure.mjs";
import { EN, PL, t as T0 } from "./lang.mjs";

globalThis.game = { i18n: { lang: "en" } };
const t = (key, params, fallback) => { if (fallback === undefined && !(key in EN)) ok(false, `missing key ${key}`); return T0(key, params, fallback); };
const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const decl = (actor, action, targets, extra = {}) => ({ op: "declare", actor, decl: { action, targets, ...extra } });
const ctx = (T) => ({ c: (id) => T.c[id] ?? null, online: () => true, P1 });
const meta = (T) => ({ hidden: Object.values(T.c).filter((c) => c.hidden).map((c) => c.id), npc: Object.values(T.c).filter((c) => c.npc).map((c) => c.id) });
const viewOf = (T, uid, owns) => V.viewFor(T.state, { id: uid, staff: false, owns }, meta(T));
const facts = (T, view, me, staff = false, more = {}) => ({ view, me, staff, c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc, kind: T.c[id].kind, img: null } : null), attrs: (id) => T.c[id]?.attrs ?? null, userName: (u) => `user-${u}`,
  online: (u) => T.users[u]?.active === true, vitals: (id) => (T.c[id] ? { health: T.c[id].health, maxHealth: T.c[id].maxHealth, resolve: T.c[id].resolve, maxResolve: T.c[id].maxResolve } : null), where: (id) => T.c[id]?.zone ?? null, hidden: (id) => !!T.c[id]?.hidden,
  sheet: (id) => (staff ? T.c[id] ?? null : null), preview: (cid, d) => T.preview(me, cid, d), ...more });
const both = (key) => { ok(typeof EN[key] === "string" && EN[key] && typeof PL[key] === "string" && PL[key], `${key} is said in both languages`); };

/* ---- A. U72: undo of a painted fire that went out repaints it */
{
  const out = { op: "zone", zone: "z3", patch: { fire: null } }, none = { op: "zone", zone: "z3", patch: { fire: null } };
  eq(ZP.paintedFire([{ kind: "fire", level: 7, source: "map" }, { kind: "fire", level: 9, source: "registry" }, { kind: "dark", source: "map" }]), 7, "U72: the fire the map's layer shows is read by its source");
  eq(ZP.paintedFire([{ kind: "fire", level: 5, source: "mark" }]), 0, "U72: the GM's own mark is not a painted fire");
  eq(ZP.paintedFire(undefined), 0, "U72: no states, no fire");
  eq(ZP.repaintInverse(out, none, 7), { op: "zone", zone: "z3", patch: { fire: 7 } }, "U72: the inverse of putting out a fire that was only painted lights it again at its Intensity");
  eq(ZP.repaintInverse(out, { op: "zone", zone: "z3", patch: { fire: 5 } }, 7), { op: "zone", zone: "z3", patch: { fire: 5 } }, "U72: an inverse that already restores the GM's mark is left as the map gave it");
  eq(ZP.repaintInverse(out, none, 0), none, "U72: no painted fire before the write: nothing is invented");
  eq(ZP.repaintInverse({ op: "zone", zone: "z3", patch: { fire: 6 } }, none, 7), none, "U72: lighting a fire is not touched");
  eq(ZP.repaintInverse({ op: "zone", zone: "z3", patch: { dark: true } }, { op: "zone", zone: "z3", patch: { dark: null } }, 7), { op: "zone", zone: "z3", patch: { dark: null } }, "U72: a write that is not about fire is not touched");
  eq(ZP.repaintInverse(out, none, 40).patch.fire, 12, "U72: never above the book's highest Intensity");
  eq(ZP.repaintInverse({ op: "border", border: "z1|z2" }, { op: "border", border: "z1|z2", play: null }, 7), { op: "border", border: "z1|z2", play: null }, "U72: other ops pass");
  ok(ZP.validOp(ZP.repaintInverse(out, none, 7)), "U72: the repaired inverse is an op the map takes");
  const src = readFileSync(new URL("./zones-adapter.mjs", import.meta.url), "utf8");
  ok(/paintedFire\(zoneStates\(op\.zone\)\)/.test(src) && /repaintInverse\(op, r\.inverse \?\? null, painted\)/.test(src), "U72: the adapter reads the layer BEFORE the write and journals the repaired inverse");
}

/* ---- B. U73: a compendium the server did not open is not "the system changed" */
{
  const declared = ["critical-injuries", "rolltables", "macros"];
  ok(Sys.closedPack("invincible.critical-injuries", declared, () => false), "U73: declared by the system and missing from the world = the server did not open it");
  ok(!Sys.closedPack("invincible.critical-injuries", declared, () => true), "U73: an open pack is not closed");
  ok(!Sys.closedPack("invincible.critical-injuries", ["macros"], () => false), "U73: a pack the system no longer declares IS a changed system");
  ok(!Sys.closedPack("other.critical-injuries", declared, () => false), "U73: only the system's own packs");
  const list = [{ name: "roll dialog class", ok: true }, { name: "injuries pack", ok: false, closed: "invincible.critical-injuries" }, { name: "injuries table", ok: false, closed: "invincible.rolltables" }, { name: "armor", ok: false }];
  eq(Sys.compatNotes(list), { changed: ["armor"], closed: ["invincible.critical-injuries", "invincible.rolltables"] }, "U73: two sentences: what changed in the system, what the server did not open");
  eq(Sys.compatNotes([{ name: "x", ok: true }]), { changed: [], closed: [] }, "U73: all well: nothing is said");
  both("ITAC.warn.packsClosed");
  ok(!/system changed|system gry się zmienił/.test(EN["ITAC.warn.packsClosed"] + PL["ITAC.warn.packsClosed"]), "U73: the sentence about a closed compendium does not blame the system");
}

/* ---- C. U74: a drop where there is no route is answered */
{
  const z = (id) => ({ zone: `z${id}`, spot: `z${id}`, id }), off = { zone: null, spot: null, id: -1 };
  eq(MP.offZones({ from: z(1), to: off, plan: null, cost: null, reachable: false }), "offMap", "U74: a drop out of every zone");
  eq(MP.offZones({ from: off, to: z(2), plan: null, cost: null, reachable: false }), "fromOff", "U74: a drop into a zone from outside them");
  eq(MP.offZones({ from: z(1), to: z(2), plan: null, cost: null, reachable: false }), null, "U74: a zone nobody can reach is an ordinary refusal (it has its own words)");
  eq(MP.offZones({ from: z(1), to: z(2), plan: { total: 1 }, cost: {}, reachable: true }), null, "U74: an ordinary drag");
  eq(MP.offZones({ from: z(1), to: off, level: true, plan: null, reachable: false }), null, "U74: a level change is not a drop");
  eq(MP.offZones(null), null, "U74: nothing to read");
  both("ITAC.move.offMap"); both("ITAC.move.fromOff");
  const src = readFileSync(new URL("./movement.mjs", import.meta.url), "utf8");
  ok(/const off = MP\.offZones\(ctx\);\s*if \(cid && off\) \{ ui\.notifications\?\.warn/.test(src), "U74: the drag handler says it to the one who dragged, before anything is priced");
}

/* ---- D. U75: the menu at a token lists what the action is meant for */
{
  const T = new Table(); T.hero("H1", "p1").hero("H2", "p2").npc("N1", { health: 6 }); T.order(["H1", "N1", "H2"]);
  const view = viewOf(T, "p1", ["H1"]), f = facts(T, view, "p1"), bar = D.playerModel(view, { id: "p1", owns: ["H1"] }, ctx(T)).bars[0];
  const at = (tid) => M.targetActs(bar, tid, f, t).map((a) => a.id);
  ok(at("N1").includes("slugfest") && at("N1").includes("banter"), "U75: at an enemy: the attacks and what is done to an enemy");
  ok(!at("N1").includes("recoverResolve") && !at("N1").includes("rally") && !at("N1").includes("stabilize") && !at("N1").includes("extinguish"), "U75: at an enemy: nothing that helps a friend (Recover Resolve at an enemy)");
  ok(at("H2").includes("recoverResolve"), "U75: at a friend: what helps a friend");
  ok(!at("H2").includes("slugfest") && !at("H2").includes("banter"), "U75: at a friend: no attack and no banter in the menu");
  ok(M.targetsFor(bar.actions.find((a) => a.id === "slugfest"), f, "H1").some((r) => r.id === "H2"), "U75: the dock still takes any target (a friend can be attacked from there)");
}

/* ---- E. U76: the words of an intention fit what the map carries */
{
  eq(BP.intentLabel("Slugfest"), "Slugfest", "U76: a short name whole");
  eq(BP.intentLabel("Odzyskaj Determinację"), "Odzyskaj Determin…", "U76: a long one is cut with an ellipsis, not mid-word without a sign");
  ok(BP.intentLabel("Odzyskaj Determinację").length === 18 && BP.intentLabel("x".repeat(18)).length === 18 && !BP.intentLabel("x".repeat(18)).endsWith("…"), "U76: never more than the map's 18 characters; exactly 18 fit whole");
  eq(BP.intentLabel(null), "", "U76: no title, no words");
  const src = readFileSync(new URL("./ui/board.mjs", import.meta.url), "utf8");
  eq((src.match(/label: intentWords\(/g) ?? []).length, 3, "U76: the three places an intention is said (declare, move, area) use it (D109: through intentWords, in the GMs' language)");
  ok(/const intentWords = [\s\S]{0,600}?BP\.intentLabel\(/.test(src), "U76 / D109: intentWords cuts its words with intentLabel");
}

/* ---- F. U77: the bar offers the Quickness interrupt the engine accepts (D40) */
{
  const mk = (unit) => { const T = new Table(); T.hero("H1", "p1").hero("H2", "p2").npc("N1", { health: 6 }); T.order(["H1", "N1", "H2"]);
    if (unit) T.state.ledger.H2 = Lg.addGrant(P1.ledgerOf(T.state, "H2"), Lg.grantTemplate("quickness"), "H2").ledger;
    return T; };
  const barOf = (T, uid, cid) => D.barModel(viewOf(T, uid, [cid]), cid, ctx(T)), act = (b, id) => b.actions.find((a) => a.id === id);
  { const T = mk(true);
    eq(act(barOf(T, "p2", "H2"), "slugfest").disabled, "notYourTurn", "U77: with the unit, another's turn and nothing declared: not your turn (nothing to answer)");
    eq(code(await T.req("p1", decl("H1", "slugfest", ["N1"]))), "ok", "U77: the one whose turn it is declares");
    eq([T.top().data.window, !!T.top().locked], ["beforeRoll", false], "U77: (its attack stands before its dice)");
    const view = viewOf(T, "p2", ["H2"]);
    eq(view.stack.at(-1)?.data?.window, "beforeRoll", "U77: a player's view says the declared action stands before its dice");
    const b = barOf(T, "p2", "H2"), unit = P1.extraUnit(T.state, "H2");
    eq([act(b, "slugfest").disabled, act(b, "slugfest").pay?.grant, act(b, "slugfest").pay?.stress], [null, unit, 1], "U77: a full action is offered, paid with the Quickness unit and 1 stress");
    eq(act(b, "banter").disabled, null, "U77: a quick action too");
    eq(act(barOf(T, "p1", "H1"), "slugfest").disabled, "busy", "U77: the one whose action stands open stays busy");
    eq(code(await T.req("p2", decl("H2", "slugfest", ["N1"]))), "ok", "U77: and the engine takes exactly what the bar offered");
    eq(act(barOf(T, "p2", "H2"), "slugfest").disabled, "busy", "U77: once (the unit is used, the own action is on top)"); }
  { const T = mk(false);
    await T.req("p1", decl("H1", "slugfest", ["N1"]));
    eq(act(barOf(T, "p2", "H2"), "slugfest").disabled, "busy", "U77: without the unit the table is busy, as before");
    eq(code(await T.req("p2", decl("H2", "slugfest", ["N1"]))), "busy", "U77: (and the engine agrees)"); }
  { const T = mk(true); T.npc("N2", { hidden: true });
    const masked = V.viewFor({ ...T.state, stack: [{ id: "i1", actor: "N2", action: "slugfest", status: "open", data: { window: "beforeRoll" }, decl: {} }] }, { id: "p2", staff: false, owns: ["H2"] }, { hidden: ["N2"], npc: ["N1", "N2"] });
    eq(masked.stack[0].data, undefined, "U77: the action of somebody the player may not see still tells nothing, its moment included"); }
}

/* ---- G. U80: a refused correction from the map menu does not leave its number standing */
{
  ok(BP.stepFailed({ ok: false, error: { code: "busy" } }) && BP.stepFailed(null) && !BP.stepFailed({ ok: true }), "U80: refused or unanswered = failed");
  const src = readFileSync(new URL("./ui/board.mjs", import.meta.url), "utf8");
  ok(/if \(BP\.stepFailed\(env\)\) \{ from = was; again\(cid\); \}/.test(src), "U80: the stepper counts from the old number again and the menu is opened anew");
  ok(/function again\(cid\)[\s\S]{0,400}Zones\.menuOpen\(\)[\s\S]{0,500}Zones\.menu\(\{ token: doc\.id, \.\.\.spec \}\)/.test(src), "U80: only a menu that still stands is opened again, at the same token, with the numbers as they are");
}

/* ---- H. U79: the kit's checks run with the suite */
{
  const src = readFileSync(new URL("./check-all.mjs", import.meta.url), "utf8");
  ok(/"\.\.\/check-kit"/.test(src) && /"u11"/.test(src), "U79: check-all runs scripts/check-kit.mjs and this suite");
}

/* ---- I. U62: the size */
{
  eq([Lay.scaleOf(100), Lay.scaleOf(79), Lay.scaleOf(500), Lay.scaleOf(117), Lay.scaleOf("125"), Lay.scaleOf("x"), Lay.scaleOf(0)], [100, 80, 140, 115, 125, 100, 100], "U62: the size is clamped to 80..140 on steps of 5; anything unreadable is 100");
  eq([Lay.factorOf(130), Lay.factorOf(null)], ["1.3", "1"], "U62: the factor the stylesheet multiplies by");
  const body = (v) => ({ style: { getPropertyValue: () => v } });
  eq([Lay.factor(body("1.3")), Lay.factor(body("")), Lay.factor(null), Lay.factor(body("-2"))], [1.3, 1, 1, 1], "U62: the factor in force is read back from the body (absent = 1)");
  const css = readFileSync(new URL("../../styles/tactics-ui.css", import.meta.url), "utf8");
  const slotsCss = readFileSync(new URL("../../styles/tactics-slots.css", import.meta.url), "utf8");
  ok(/\.itd-stack \{[^}]*zoom: var\(--ita-scale, 1\)/.test(css) && /\.its-in \{[^}]*zoom: var\(--ita-scale, 1\)[^}]*max-width: calc\(var\(--its-w, 100vw\) \/ var\(--ita-scale, 1\)\); max-height: calc\(var\(--its-h, 100vh\) \/ var\(--ita-scale, 1\)\)/.test(slotsCss), "U62 (U132): the bar's stack and every place of the top are zoomed, their boxes divided back");
  ok(/width: 348px; zoom: var\(--ita-scale, 1\)/.test(css) && /\.igd-handle \{\s*zoom: var\(--ita-scale, 1\)/.test(css), "U62: the desk and its handle are zoomed");
  ok(/calc\(\(var\(--igd-maxh, 80vh\) - 4px\) \/ var\(--ita-scale, 1\)\)/.test(css) && /calc\(var\(--itd-panel-maxh, 60vh\) \/ var\(--ita-scale, 1\)\)/.test(css), "U62: every window length handed into a zoomed box is divided by the size");
  const dock = readFileSync(new URL("./ui/dock.mjs", import.meta.url), "utf8");
  ok(/k = Lay\.factor\(document\.body\)/.test(dock) && /natural = natU \* k/.test(dock) && /pe\.offsetWidth \* kb/.test(dock) && /barEl\.offsetHeight \* kb/.test(dock) && /pe\.offsetHeight \* kb - GAP \* k/.test(dock), "U62 (U163: at the bar's own size kb): the placement multiplies the stack's own lengths by the size before they meet the window");
  const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  ok(/reg\("tacticsUiScale", \{[^}]*scope: "client"[^}]*range: \{ min: 80, max: 140, step: 5 \}[^}]*default: 100/.test(main), "U62: a client setting with a slider, separate from Foundry's scale");
  ok(EN["ITAC.Settings.tacticsUiScale.Name"] && PL["ITAC.Settings.tacticsUiScale.Name"] && PL["ITAC.Settings.tacticsUiScale.Hint"], "U62: named in both languages");
}

/* ---- J. U64: the layout a user left */
{
  eq(Lay.clean(null), { hotbar: false, keys: false, desk: null, folds: {}, autoSkip: false }, "U64: nothing stored = the default layout (ANSA UXC-1: the auto-skip tick, off)");
  eq(Lay.clean(null, { hotbar: true, keys: true }), { hotbar: true, keys: true, desk: null, folds: {}, autoSkip: false }, "U64: what the browser remembered before seeds a user without a layout");
  eq(Lay.clean({ hotbar: false }, { hotbar: true }).hotbar, false, "U64: (a stored choice wins over the seed)");
  eq(Lay.clean({ hotbar: "yes", desk: "left", folds: { force: false, bogus: true, npcs: "x", karma: true }, extra: 1 }), { hotbar: false, keys: false, desk: null, folds: { force: false }, autoSkip: false }, "U64: an unknown key, a wrong type and a default value are dropped");
  eq([Lay.folded(Lay.clean(null), "force"), Lay.folded(Lay.clean(null), "npcs"), Lay.folded(Lay.clean({ folds: { npcs: true } }), "npcs"), Lay.folded(Lay.clean(null), "nope")], [true, false, true, false], "U64 / U80: the three tools start folded, the NPC answers open");
  const a = Lay.clean(null), b = Lay.merge(a, { folds: { force: false } }), c = Lay.merge(b, { desk: "folded" });
  ok(b !== a && Lay.merge(b, { folds: { force: false } }) === b && Lay.merge(a, {}) === a, "U64: a change gives a new layout, no change gives the same object (nothing is written)");
  eq(c, { hotbar: false, keys: false, desk: "folded", folds: { force: false }, autoSkip: false }, "U64: changes add up");
  eq([Lay.stored(a), Lay.stored(c), Lay.stored(Lay.merge(c, { folds: { force: true } }))], [{}, { desk: "folded", folds: { force: false } }, { desk: "folded" }], "U64: only what differs from the default is stored");
  eq([Lay.deskStart(a), Lay.deskStart(c), Lay.deskStart(Lay.merge(c, { desk: "open" }))], [null, { collapsed: true, touched: true }, { collapsed: false, touched: true }], "U64: the desk starts as it was left, or by the room when never chosen");
  const store = readFileSync(new URL("./store.mjs", import.meta.url), "utf8"), ui = readFileSync(new URL("./ui/main.mjs", import.meta.url), "utf8"), desk = readFileSync(new URL("./ui/desk.mjs", import.meta.url), "utf8");
  ok(/export async function saveUserPref\(key, value\) \{ try \{ await game\.user\?\.update\(/.test(store), "U64: the layout is written to the user's own document (store.mjs)");
  ok(/Store\.saveUserPref\(LAYOUT_FLAG, Lay\.stored\(layout\)\)/.test(ui) && /layoutStart\(\);/.test(ui), "U64: read when the surfaces start, written after a change");
  for (const id of Object.keys(Lay.FOLDS)) ok(new RegExp(`foldSec\\("${id}"`).test(desk), `U80: the "${id}" part of the Table tab folds`);
  ok(/"aria-expanded": String\(!shut\)/.test(desk), "U63 / U80: a folded part says so to a screen reader, and by its chevron");
}

/* ---- K. U63: a state is never told by colour alone */
{
  const css = readFileSync(new URL("../../styles/tactics-ui.css", import.meta.url), "utf8"), dock = readFileSync(new URL("./ui/dock.mjs", import.meta.url), "utf8");
  eq(new Set(Object.values(M.NEWS_ICON)).size, Object.keys(M.NEWS_ICON).length, "U63: every tone of the news line has its own picture");
  eq(Object.keys(M.NEWS_ICON).sort(), ["bad", "good", "info", "nudge", "warn"], "U63: (all five tones)");
  ok(/icon\(d\.news\.icon \?\? "fa-comment-dots"\)/.test(dock), "U63: the dock draws the tone's picture");
  ok(/\.itd-char-asked::after \{[^}]*border-radius: 0; rotate: 45deg/.test(css), "U63: asked = a diamond, on turn = a disc");
  ok(/\.itd-slot\[data-state="lost"\] > i \{ background: var\(--ita-x\)/.test(css) && /\.igd-uslot\[data-state="lost"\] \{ background: var\(--ita-x\)/.test(css), "U63: a lost slot is crossed out (a pending one is an empty dashed frame)");
  ok(/\[data-extra\]\):not\(\[data-state="used"\], \[data-state="lost"\]\)::after \{ content: "\+"/.test(css), "U63: a granted slot carries a plus");
  ok(/\.itd-ic\[data-urgent\]:not\(\[aria-disabled="true"\]\)::after \{ content: "!"/.test(css), "U63: 'only now' is a mark on the button");
  ok(/r\.disabled \? icon\("fa-ban"\) : r\.warn \? icon\("fa-triangle-exclamation"\)/.test(dock), "U63: a way with something waiting on it carries the warning sign");
}

/* ---- L. U70, U71: what stands over the dock */
{
  const css = readFileSync(new URL("../../styles/tactics-ui.css", import.meta.url), "utf8"), dock = readFileSync(new URL("./ui/dock.mjs", import.meta.url), "utf8"), ui = readFileSync(new URL("./ui/main.mjs", import.meta.url), "utf8");
  /* U116 (moinen-maps zones-api.md 41): the map places the chip itself - above the declared dock (its whole stack is inside the dock's
     element) and clear of the boxes we name; no rule of ours pins it any more (it pinned it onto the session notice and the targets' pills) */
  ok(!/\.mm-dst-chip\s*\{/.test(css) && !/--itd-over/.test(dock) && /Zones\.uiInset\(`\$\{MOD\}\.bars`, \{ bottom: "#invincible-tactics-dock:not\(\.itd-hidden\) \.its-bar"/.test(ui) && /Zones\.uiAvoid\(`\$\{MOD\}\.panels`, \(\) => \{[^]*?"#invincible-tactics-dock \.its-bar"[^]*?"#invincible-tactics-desk"/.test(ui), "U70 / U116 (U132): the map's 'My view' chip stands above the bar's stack, placed by the map (declared bar + boxes to keep clear of: the bar, the places of the top, the desk), not pinned by our CSS");
  const sess = readFileSync(new URL("../session/main.mjs", import.meta.url), "utf8"), zad = readFileSync(new URL("./zones-adapter.mjs", import.meta.url), "utf8");
  ok(/zones\?\.uiAvoid\?\.\(`\$\{MOD\}\.sessionNotice`, "\.ips-notice"\)/.test(sess) && /export const uiAvoid = \(id, what\) => \{ const off = call\("uiAvoid", id, what\); return typeof off === "function" \? off : \(\) => \{\}; \};/.test(zad), "U116: the session notice at the bottom centre is a box the map's chip keeps clear of; the adapter's uiAvoid is guarded (no map: nothing)");
  ok(/Hooks\.on\("renderChatMessageHTML",[^\n]*Sys\.tacticsOf\(message\)[^\n]*classList\.add\("ita-troll"\)/.test(ui) && /body\.ita-tactics #chat-notifications \.chat-message\.ita-troll \{ display: none; \}/.test(css), "U71: the toast of a tactical roll's card is not shown while the dock is up");
}

/* ---- M. U78: the names the system writes without the item */
{
  const N = await import("../i18n/item-names.mjs");
  const lv = (id) => ({ basic: "Podstawowy", major: "Większy" })[id] ?? id;
  eq(N.shownLoose("basic Flight - 2 zones", lv), "Lot (Podstawowy) - strefy: 2", "U78: a power's use offered in the choice dialog");
  eq(N.shownLoose("Blast attack", lv), `${N.entryByName("power", "Blast").pl}: atak`, "U78: an automation named after its power");
  eq([N.shownLoose("Concussion Turret", lv), N.shownLoose("Bijatyka", lv), N.shownLoose("", lv)], ["Concussion Turret", "Bijatyka", ""], "U78: a text that names no power stays as written");
  eq([N.entryIn("Major Fire Control attack")?.en, N.entryIn("Blasting cap")], ["Fire Control", null], "U78: a name is found as whole words only");
  const src = readFileSync(new URL("../i18n/item-names.mjs", import.meta.url), "utf8");
  ok(/looseDialog\(el\)/.test(src) && /unnamedEffects\(el\)/.test(src) && /localize\("DOCUMENT\.ActiveEffect"\)/.test(src), "U78: the choice dialog, the confirmation's title and an unnamed effect in the pool are said in the client's language");
}


done("check-u11");
