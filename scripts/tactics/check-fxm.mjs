/* node scripts/tactics/check-fxm.mjs -- fixer M after live verifier ver10 (2026-11-12): D125 (Atom Eve cannot fly: her Flight power has
   the level "" and the way of moving was dropped without a word) and the same class of fault: a level or tier read from the system's
   data that is blank or unknown, and a reader of a combatant's facts that swallows an error so that a capability silently disappears.
   Section A uses only what the code had before the fix (system-adapter movementOf, movement-pure modesOf, kit-pure levelOf), so it fails
   on the old code; section B checks the trace that now carries every drop to the console and the GM.
   Row: dev/combat-defects.md "Live verifier ver10, 2026-11-12" D125. Rulings: dev/combat-rulings.md "FXM". */
import { readFileSync } from "node:fs";
import { ok, eq, done } from "./testkit.mjs";
import * as Sys from "./system-adapter.mjs";
import * as MP from "./movement-pure.mjs";
import * as Kit from "./kit-pure.mjs";
import { movement } from "../rules/index.mjs";

const src = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const Trace = await import("./trace-pure.mjs").catch(() => null);
const FLIGHT = "Compendium.invincible-core.powers.Item.E6B4T5jbhoxFOqRC", BURROW = "Compendium.invincible-core.powers.Item.8wJ7WiatmSsAJYsJ";
const item = (id, name, o = {}) => ({ id, name, type: o.type ?? "power", _stats: { compendiumSource: o.src ?? null },
  system: { level: o.level, automations: o.autos ?? {}, boosts: o.boosts ?? [] }, flags: {} });
const auto = (name, show = true) => ({ name, type: "usePower", showAsSelection: show });
const actor = (name, items, flags = {}) => { const list = [...items]; list.get = (id) => list.find((i) => i.id === id); return { name, type: "superhero", items: list, flags }; };
const modes = (name, mv) => MP.modesOf({ name, movement: mv });
const fly = (a) => modes(a.name, Sys.movementOf(a)).find((m) => m.mode === "flight") ?? null;

/* ---- A. D125 and its class, on what existed before the fix */
{
  /* the world's Atom Eve: level "", one visible automation "Basic Flight - 2 zones" (raw read of the world's actors, 2026-11-12) */
  const eve = actor("Atom Eve", [item("f1", "Flight", { src: FLIGHT, level: "", autos: { a: auto("Basic Flight - 2 zones"), b: auto("Basic Flight - 4 zones (1 stress)") } })]);
  eq(Sys.movementOf(eve).map((m) => [m.mode, m.tier]), [["flight", "basic"]], "D125: a blank level is read from the visible automations (basic)");
  const f = fly(eve);
  ok(!!f, "D125: Atom Eve keeps her flight (it was dropped: moveProfile threw on the tier \"\")");
  eq(f && [f.tier, f.profile.zones, f.profile.stressZones, f.profile.way], ["basic", 2, 4, "air"], "D125: basic flight, 2 zones, 4 with stress [B1999]");
  ok(modes("Atom Eve", Sys.movementOf(eve)).some((m) => m.mode === "walk"), "D125: walking stays");
  /* The Immortal: blank level, "Major Flight - 4 zones" visible: the system reads major (its power data model), so do we */
  const imm = actor("The Immortal", [item("f2", "Flight", { src: FLIGHT, level: "", autos: { a: auto("Major Flight - 4 zones") } })]);
  eq(fly(imm) && [fly(imm).tier, fly(imm).profile.zones], ["major", 4], "D125: a blank level with a visible Major automation is major [B2000]");
  /* nothing names a level: the book's default */
  eq(fly(actor("X", [item("f3", "Flight", { src: FLIGHT, level: "" })]))?.tier, "basic", "D125: a blank level and no automation: basic [B298], [B1214]");
  eq(fly(actor("X", [item("f3", "Flight", { src: FLIGHT, level: null })]))?.tier, "basic", "D125: a missing level: basic");
  eq(fly(actor("X", [item("f3", "Flight", { src: FLIGHT, level: "", autos: { a: auto("Monstrous Flight", false) } })]))?.tier, "basic", "D125: an automation hidden from selection names no level (the system skips it)");
  eq(fly(actor("X", [item("f3", "Flight", { src: FLIGHT, level: "massive", autos: { a: auto("Monstrous Flight", false) } })]))?.tier, "massive", "the own field wins (Conquest, Omni-Man)");
  eq(fly(actor("X", [item("f3", "Flight", { src: FLIGHT, level: " Major " })]))?.tier, "major", "a level with stray spaces or capitals is still that level");
  eq(fly(actor("X", [item("f3", "Flight", { src: FLIGHT, level: "dynamic" })]))?.tier, "basic", "a level word the system does not have: basic, not lost");
  ok(!!fly(actor("X", [item("f3", "Flight", { level: "" })])), "an item without a compendium id is known by its English name, with a blank level");
  /* a level the way of moving does not have (most have only basic [B298]) */
  const bur = modes("X", Sys.movementOf(actor("X", [item("b1", "Burrowing", { src: BURROW, level: "major" })])));
  eq(bur.find((m) => m.mode === "burrowing")?.tier, "basic", "a Major Burrowing keeps burrowing at its one tier (it was dropped)");
  eq(modes("X", [{ mode: "swimming", tier: "massive" }]).find((m) => m.mode === "swimming")?.tier, "basic", "swimming with a level word: basic (fast comes from the boost [B2022])");
  eq(modes("X", [{ mode: "swinging", tier: "fast" }]).find((m) => m.mode === "swinging")?.tier, "fast", "Fast Swinging stays fast [B2030]");
  /* the GM's own list (flags.<module>.tactics.movement) */
  eq(modes("X", Sys.movementOf(actor("X", [], { "invincible-plus-ultra": { tactics: { movement: [{ mode: "leaping", tier: "" }] } } }))).find((m) => m.mode === "leaping")?.tier, "basic", "the GM's flag with a blank tier: basic leaping (it was dropped)");
  /* every way of moving the rules know, with every value a sheet or a flag may hold: never lost */
  const VALUES = ["", " ", null, undefined, "basic", "major", "massive", "monstrous", "fast", "MAJOR", "dynamic", 3];
  const lost = [];
  for (const mode of Object.keys(movement.MOVE_MODES)) for (const v of VALUES) if (!modes("X", [{ mode, tier: v }]).some((m) => m.mode === mode)) lost.push(`${mode}:${JSON.stringify(v)}`);
  eq(lost, [], "no way of moving is lost for any level value");
  for (const mode of ["flight", "leaping", "superSpeed", "teleportation"]) eq(["basic", "major", "massive", "monstrous"].map((tier) => modes("X", [{ mode, tier }]).find((m) => m.mode === mode)?.tier), ["basic", "major", "massive", "monstrous"], `${mode}: the four levels unchanged`);
  /* one item that cannot be read costs that item only */
  const bad = item("z", "Broken"); Object.defineProperty(bad, "system", { get() { throw new Error("unreadable"); } });
  eq(Sys.movementOf(actor("X", [bad, item("f4", "Flight", { src: FLIGHT, level: "" })])).map((m) => m.mode), ["flight"], "an unreadable item does not take the others' flight with it");
  /* the kit reads the level the same way (its rows' numbers per level) */
  eq(Kit.levelOf({ level: "", autos: [{ name: "Major Flight - 4 zones", show: true }] }), 1, "kit: a level word at the start of an automation's name counts (the system's reading)");
  eq(Kit.levelOf({ level: "Major " }), 1, "kit: the own level with a stray space");
  eq(Kit.levelOf({ level: "", autos: [{ name: "Blast (Massive)", show: true }] }), 2, "kit: a level word at the end still counts");
  eq(Kit.levelOf({ level: "", autos: [] }), 0, "kit: nothing names a level: basic");
}

/* ---- B. the trace: nothing is dropped in silence */
ok(!!Trace, "trace-pure.mjs exists");
if (Trace) {
  Trace.reset();
  const seen = []; Trace.setSink((n) => seen.push(n));
  const out = MP.modesOf({ name: "Rex", movement: [{ mode: "hoverboard", name: "Hoverboard" }] });
  ok(!out.some((m) => m.mode === "hoverboard"), "a way the rules do not know is not offered");
  eq(seen.map((n) => [n.kind, n.area, n.who, n.what]), [["dropped", "move", "Rex", "Hoverboard"]], "... and the sink hears of it once, with who and what");
  ok(/hoverboard/.test(seen[0]?.error ?? ""), "... with the error's text");
  MP.modesOf({ name: "Rex", movement: [{ mode: "hoverboard", name: "Hoverboard" }] });
  eq(seen.length, 1, "the same note is not repeated on every render");
  MP.modesOf({ name: "Eve", movement: [{ mode: "flight", tier: "", name: "Flight" }] });
  eq(seen.length, 1, "a blank level is the system's own (dynamic) value: no note");
  MP.modesOf({ name: "Kim", movement: [{ mode: "flight", tier: "fast", name: "Flight" }] });
  eq(seen.slice(1).map((n) => [n.kind, n.area, n.who, n.raw]), [["guessed", "level", "Kim", "fast"]], "an unknown level is kept as basic with a 'guessed' note");
  Sys.movementOf(actor("Odd", [item("f5", "Flight", { src: FLIGHT, level: "dynamic" })]));
  eq(seen.at(-1) && [seen.at(-1).kind, seen.at(-1).who, seen.at(-1).raw], ["guessed", "Odd", "dynamic"], "the adapter notes an odd level field");
  const bad = item("z", "Broken"); Object.defineProperty(bad, "system", { get() { throw new Error("unreadable"); } });
  Sys.movementOf(actor("Brk", [bad]));
  eq(seen.at(-1) && [seen.at(-1).kind, seen.at(-1).area, seen.at(-1).who, seen.at(-1).what], ["dropped", "movement", "Brk", "Broken"], "an unreadable item is noted");
  const broken = { name: "Gone", get items() { throw new Error("no items"); }, flags: {} };
  eq(Sys.movementOf(broken), [], "an actor the adapter cannot read moves on foot ...");
  eq(seen.at(-1) && [seen.at(-1).kind, seen.at(-1).area, seen.at(-1).who], ["dropped", "movement", "Gone"], "... and that is noted");
  Trace.setSink(() => { throw new Error("sink down"); });
  ok(MP.modesOf({ name: "Zed", movement: [{ mode: "nope" }] }).some((m) => m.mode === "walk"), "a failing sink breaks nothing");
  ok(Trace.recent().some((n) => n.who === "Zed"), "... and the note stays in the list");
  Trace.reset();
  /* the wiring: the Foundry side hands every note to the console and the GM, the readers call the trace */
  const main = src("./main.mjs"), eng = src("./engine.mjs"), sys = src("./system-adapter.mjs"), mp = src("./movement-pure.mjs"), api = src("./api.mjs"), kit = src("./kit-pure.mjs");
  ok(/Trace\.setSink\(/.test(main) && /isStaff\(game\.user\)\)\s*ui\.notifications\?\.warn\(t\(`ITAC\.warn\.\$\{n\.kind\}`/.test(main) && /console\.warn\(/.test(main), "main.mjs: the sink warns in the console and notifies the GM");
  ok(/Sys\.trace\("dropped", "facts"/.test(eng) && !/tactics facts`, err/.test(eng), "engine.mjs: a combatant whose facts cannot be read is noted");
  for (const fn of ["movementOf", "kitSource", "sceneFacts"]) {
    const body = sys.slice(sys.indexOf(`export function ${fn}(`)); const end = body.indexOf("\n}\n");
    ok(/trace\("dropped"/.test(body.slice(0, end)) && !/catch \{/.test(body.slice(0, end)), `system-adapter.mjs ${fn}: no silent catch`);
  }
  ok(/weaponList = [^\n]*trace\("dropped", "weapons"/.test(sys) && /kitOf[\s\S]{0,700}trace\("dropped", "kit"/.test(sys), "system-adapter.mjs: weaponList and kitOf note what they drop");
  ok(/note\("dropped", "move"/.test(mp) && !/catch \{ \/\* a way the rules library/.test(mp), "movement-pure.mjs modesOf: no silent catch");
  ok((kit.match(/note\("dropped", "kit"/g) ?? []).length === 2, "kit-pure.mjs: an item read by hand because of an error is noted");
  ok(/dropped: \(\) => Trace\.recent\(\)/.test(api), "api.tactics.dropped() lists the notes of this client");
  const { EN, PL } = await import("./lang.mjs");
  for (const k of ["ITAC.warn.dropped", "ITAC.warn.guessed"]) ok(/\{who\}/.test(EN[k] ?? "") && /\{what\}/.test(EN[k] ?? "") && /\{who\}/.test(PL[k] ?? "") && /\{what\}/.test(PL[k] ?? ""), `${k}: English and Polish, with who and what`);
  ok(/\{raw\}/.test(EN["ITAC.warn.guessed"]) && /\{raw\}/.test(PL["ITAC.warn.guessed"]), "the guessed note names the value that was read");
}
done("check-fxm");
