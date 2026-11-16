// node scripts/sweep-checks/goreown.mjs  (GOREOWN, 2026-11-16. The owner ruled: blood and cracks only for the token's owner.)
// The rule for a table that has chosen nothing: when a character is hurt, its screen blood and screen cracks are shown only on the
// seats of the players who own that character (each of them, when several do), never on another player's seat. Provisional
// (question GOREOWN-1): a GM's seat shows them only for a character no player owns. The GM still chooses for the table: "the
// character's owners and the GM" and "every screen that sees the character" stay in the window.
// Pure (scripts/gore/plan.mjs):
//   RULE    seatShows over every seat kind x ownership x choice; the table's default is the owner rule; an unknown value falls to it;
//   STORED  the choice lives under a new key: what a world stored under the earlier key ("all", "owners") is read by nobody.
// Runtime on a fake Foundry (scripts/gore/main.mjs), one module copy per seat, five seats (the GM, an assistant GM, the owning player,
// a second player who co-owns one hero, a player who owns nothing) x six characters x three choices, through the real damage path
// (the actor's Health and Resolve updates):
//   OWNER   under the owner rule a seat that does not own the hurt character gets NO blood and NO cracks (the checks the brief asks
//           for: they fail on tag tactics-integrated-163, where the default showed every seat that saw the token); the owning seats
//           get both; a GM seat only for characters no player owns; a hidden character only on a GM seat;
//   MODES   the other two choices behave as their labels say;
//   OLD     a world that stored the earlier key (either value) is on the owner rule all the same, and nothing registers that key;
//   WAY     the splash's direction needs the attacker only to be SEEN (an owner hit by someone else's character keeps it);
//   WINDOW  the table window's row writes the new key, offers the three choices with the owner rule first, both languages name them.
let n = 0, f = 0;
const ck = (name, c, note = "") => { n++; if (!c) { f++; console.log("FAIL", name, note); } };
const P = await import("../gore/plan.mjs");
const MOD = "invincible-plus-ultra";

/* ---------------- RULE ---------------- */
{
  ck("the table's default is the owner rule", P.DEFAULTS.goreWho === "owner" && P.DEFAULTS[P.KEYS.seats] === "owner" && P.cleanOpts({}).seats === "owner");
  ck("the three choices, the owner rule first", JSON.stringify(P.SEATS) === JSON.stringify(["owner", "owners", "all"]));
  ck("an unknown or missing value falls to the owner rule, never to a wider one", ["x", "", null, undefined, 7, "OWNER", "everyone"].every((v) => P.cleanOpts({ goreWho: v }).seats === "owner"));
  const S = (seats, gm, owner, playerOwned) => P.seatShows(seats, { gm, owner, playerOwned });
  ck("owner rule: a player who owns it: yes; one who does not: no (whoever else owns it)", S("owner", false, true, true) && !S("owner", false, false, true) && !S("owner", false, false, false));
  ck("owner rule: the GM's seat only for a character no player owns", S("owner", true, false, false) && !S("owner", true, false, true) && !S("owner", true, true, true));
  ck("'owners and the GM': the GM always, a player only his own", S("owners", true, false, true) && S("owners", true, false, false) && S("owners", false, true, true) && !S("owners", false, false, true));
  ck("'every screen': everyone", S("all", false, false, true) && S("all", true, false, false) && S("all", false, false, false));
  ck("a value that is none of the three is treated as the owner rule by the rule itself", !S("nonsense", false, false, false) && S("nonsense", false, true, true) && !S(undefined, true, false, true));
}
/* ---------------- STORED ---------------- */
{
  ck("the choice has a new key; the earlier one is named only to say it is not read", P.KEYS.seats === "goreWho" && P.OLD_SEATS_KEY === "goreSeats" && !Object.values(P.KEYS).includes(P.OLD_SEATS_KEY));
  ck("a value stored under the earlier key changes nothing", P.cleanOpts({ goreSeats: "all" }).seats === "owner" && P.cleanOpts({ goreSeats: "owners" }).seats === "owner" && P.cleanOpts({ goreSeats: "all", goreWho: "owners" }).seats === "owners");
  ck("the other options are untouched by it", JSON.stringify(P.cleanOpts({ goreSeats: "all", goreBlood: 3, goreCracks: 1, goreHold: 1.5 })) === JSON.stringify({ blood: 3, cracks: 1, seats: "owner", hold: 1.5 }));
}

/* ---------------- runtime: five seats ---------------- */
const USERS = [{ id: "GM", isGM: true }, { id: "AGM", isGM: true }, { id: "P1", isGM: false }, { id: "P2", isGM: false }, { id: "P3", isGM: false }];
/* the characters: who owns them (Foundry's ownership levels: 3 = owner) */
const CHARS = {
  HERO: { ownership: { default: 0, P1: 3 } },                    // one player's hero
  DUO: { ownership: { default: 0, P1: 3, P2: 3 } },              // co-owned by two players
  NPC: { ownership: { default: 0 } },                            // nobody's: the GM's
  SEEN: { ownership: { default: 2, P3: 2 } },                    // an NPC the players may look at (observer), still nobody's
  OPEN: { ownership: { default: 3 } },                           // everyone's (default owner)
  HID: { ownership: { default: 0 }, hidden: true },              // a hidden NPC
  CAR: { ownership: { default: 0, P2: 3 }, type: "vehicle" }     // a player's vehicle: cracks instead of blood
};
const realST = globalThis.setTimeout, realCT = globalThis.clearTimeout, realPerf = globalThis.performance;
async function seat(user, stored = {}) {
  const hooks = {}, values = { ...stored }, settings = new Map();
  let clock = 1000;
  globalThis.performance = { now: () => clock };
  const timers = [];
  globalThis.setTimeout = (fn, ms) => { const t = { fn, at: clock + (ms ?? 0), id: timers.length + 1 }; timers.push(t); return t.id; };
  globalThis.clearTimeout = (id) => { const t = timers.find((x) => x.id === id); if (t) t.fn = null; };
  const advance = (ms) => { const end = clock + ms; for (;;) { const t = timers.filter((x) => x.fn && x.at <= end).sort((a, b) => a.at - b.at)[0]; if (!t) break; clock = Math.max(clock, t.at); const fn = t.fn; t.fn = null; fn(); } clock = end; };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.window = { innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1, addEventListener() {} };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.ImageData = class { constructor(d, w, h) { this.data = d; this.width = w; this.height = h; } };
  const el = () => ({ style: {}, setAttribute() {}, appendChild() {}, after() {}, remove() {}, isConnected: true, getContext: () => ({ putImageData() {}, clearRect() {} }) });
  globalThis.document = { getElementById: (id) => (id === "board" ? el() : null), createElement: () => el(), body: el(), querySelectorAll: () => [] };
  globalThis.getComputedStyle = () => ({ zIndex: "0" });
  globalThis.Hooks = { on: (k, fn) => ((hooks[k] ??= []).push(fn), 1), once: (k, fn) => ((hooks[k] ??= []).push(fn), 1), callAll: (k, ...a) => { for (const fn of hooks[k] ?? []) fn(...a); } };
  const combat = { id: "C", combatants: new Map() };
  globalThis.game = { user, users: USERS, settings: { settings, register: (m, k, o) => { settings.set(`${m}.${k}`, o); if (!(`${m}.${k}` in values)) values[`${m}.${k}`] = o.default; }, get: (m, k) => { if (!settings.has(`${m}.${k}`)) throw new Error("not registered"); return values[`${m}.${k}`]; } },
    modules: new Map([[MOD, {}]]), socket: { on() {}, emit() {} }, combats: new Map([["C", combat]]) };
  settings.set(`${MOD}.tokenReactEnabled`, {}); values[`${MOD}.tokenReactEnabled`] = false;      // an effect plays after the short gathering wait
  const scene = { id: "S" };
  const toks = Object.entries(CHARS).map(([id, c], i) => {
    const sees = user.isGM || !c.hidden;      // Foundry: a player's canvas does not show a hidden token
    const actor = { id: `A${id}`, type: c.type ?? "character", ownership: c.ownership, system: { derived: { health: { value: 6, max: 6 }, resolve: { value: 6, max: 6 } } },
      testUserPermission: (u, lvl) => lvl === "OWNER" && (!!u?.isGM || (c.ownership[u?.id] ?? c.ownership.default ?? 0) >= 3), getActiveTokens: () => [tok] };
    const tok = { id, name: id, actor, scene, visible: sees, isVisible: sees, document: { hidden: !!c.hidden }, center: { x: 300 + i * 160, y: 450 }, w: 100, h: 100 };
    combat.combatants.set(`c${id}`, { token: { id } });
    return tok;
  });
  const T = Object.fromEntries(toks.map((t) => [t.id, t]));
  globalThis.canvas = { ready: true, scene, stage: { scale: { x: 1 } }, clientCoordinatesFromCanvas: (c) => ({ x: c.x, y: c.y }), tokens: { get: (id) => T[id], get placeables() { return toks; } } };
  globalThis.MoinenLetters = { engine: () => ({ impact: { busy: false } }) };
  /* the seats live in one process: each has its own module copy and its own page; a seat's page is put in place before it is used */
  const env = Object.fromEntries(["performance", "setTimeout", "clearTimeout", "requestAnimationFrame", "window", "matchMedia", "ImageData", "document", "getComputedStyle", "Hooks", "game", "canvas", "MoinenLetters"].map((k) => [k, globalThis[k]]));
  const enter = () => { for (const [k, v] of Object.entries(env)) globalThis[k] = v; };
  const M = await import(`../gore/main.mjs?goreown-${user.id}-${Object.keys(stored).length}-${Math.random()}`);
  M.start({ init: true, ready: true });
  await new Promise((r) => r());
  const api = game.modules.get(MOD).api.gore;
  let stamp = 5000;
  const reset = () => { api.clear({ quick: true }); api.log({ clear: true }); api.who({ clear: true }); for (const t of toks) { t.actor.system.derived.health.value = 6; t.actor.system.derived.resolve.value = 6; } for (const fn of hooks.canvasReady ?? []) fn(); };
  /* the real damage path: the actor's update with its lost Health and / or Resolve; -> what this seat's glass got */
  const hurt = (id, stats) => {
    enter();
    reset();
    const tok = T[id], d = {};
    for (const s of stats) { tok.actor.system.derived[s].value = 2; d[s] = { value: 2 }; }
    for (const fn of hooks.updateActor ?? []) fn(tok.actor, { system: { derived: d } }, { modifiedTime: ++stamp });
    advance(M.QUIET + 20);
    const log = api.log();
    return { live: api.state().live, blood: log.filter((q) => q.tok === id && q.kind !== "cracks").length, cracks: log.filter((q) => q.kind === "cracks").length, who: api.who() };
  };
  const set = (k, v) => { values[`${MOD}.${k}`] = v; };
  return { user, M, api, hurt, set, settings, values, T, hooks, reset, advance, enter, state: () => { enter(); return api.state(); } };
}
const got = (r) => `${r.blood}b${r.cracks}c`;

/* ---------------- OWNER: the rule in force for a table that chose nothing ---------------- */
/* who is shown what under the owner rule: seat -> the characters whose effects it gets */
const OWNER_RULE = { GM: ["NPC", "SEEN", "HID"], AGM: ["NPC", "SEEN", "HID"], P1: ["HERO", "DUO", "OPEN"], P2: ["DUO", "OPEN", "CAR"], P3: ["OPEN"] };
const seats = {};
for (const u of USERS) seats[u.id] = await seat(u);
for (const u of USERS) {
  const s = seats[u.id];
  ck(`${u.id}: the table that chose nothing is on the owner rule`, s.state().opts.seats === "owner" && s.settings.get(`${MOD}.goreWho`)?.default === "owner" && s.settings.get(`${MOD}.goreWho`)?.scope === "world" && s.settings.get(`${MOD}.goreWho`)?.config === false);
  for (const id of Object.keys(CHARS)) {
    const mine = OWNER_RULE[u.id].includes(id), car = CHARS[id].type === "vehicle";
    const h = s.hurt(id, ["health"]), r = s.hurt(id, ["resolve"]), both = s.hurt(id, ["health", "resolve"]);
    if (mine) {
      ck(`OWNER ${u.id} / ${id}: shown its ${car ? "cracks" : "blood"} on a Health loss`, car ? got(h) === "0b1c" : got(h) === "1b0c", got(h));
      ck(`OWNER ${u.id} / ${id}: shown its cracks on a Resolve loss`, got(r) === "0b1c", got(r));
      ck(`OWNER ${u.id} / ${id}: both together`, car ? got(both) === "0b1c" : got(both) === "1b1c", got(both));
    } else {
      ck(`OWNER ${u.id} / ${id}: NOT this seat's character: no blood on a Health loss`, h.live === 0 && h.blood === 0 && h.cracks === 0, got(h));
      ck(`OWNER ${u.id} / ${id}: ... no cracks on a Resolve loss`, r.live === 0 && r.blood === 0 && r.cracks === 0, got(r));
      ck(`OWNER ${u.id} / ${id}: ... nothing when it loses both`, both.live === 0 && both.blood === 0 && both.cracks === 0, got(both));
    }
    /* a character this seat's canvas does not show is not judged at all (no token here); otherwise the seat's log says what it decided */
    const here = u.isGM || !CHARS[id].hidden;
    ck(`OWNER ${u.id} / ${id}: the seat's log says so`, here ? both.who.length === 1 && both.who[0].shown === mine && both.who[0].seats === "owner" : true, JSON.stringify(both.who));
  }
}
/* the headline, counted over the table: every player-owned character's effects land on its owners' seats and on no other seat */
for (const id of ["HERO", "DUO", "OPEN", "CAR"]) {
  const shownOn = USERS.filter((u) => seats[u.id].hurt(id, ["health", "resolve"]).live > 0).map((u) => u.id);
  const owners = USERS.filter((u) => !u.isGM && (CHARS[id].ownership[u.id] ?? CHARS[id].ownership.default) >= 3).map((u) => u.id);
  ck(`OWNER ${id}: shown on exactly its owning players' seats (${owners.join(", ")})`, JSON.stringify(shownOn) === JSON.stringify(owners), shownOn.join(", "));
}
for (const id of ["NPC", "SEEN"]) {
  const shownOn = USERS.filter((u) => seats[u.id].hurt(id, ["health", "resolve"]).live > 0).map((u) => u.id);
  ck(`OWNER ${id} (no player owns it; SEEN: players may only look at it): shown on the GM seats only, on no player's`, JSON.stringify(shownOn) === JSON.stringify(["GM", "AGM"]), shownOn.join(", "));
}

/* ---------------- MODES: the GM's other choices ---------------- */
const VISIBLE_TO_PLAYERS = Object.keys(CHARS).filter((id) => !CHARS[id].hidden);
for (const u of USERS) {
  const s = seats[u.id];
  s.set("goreWho", "owners");
  for (const id of Object.keys(CHARS)) {
    const want = u.isGM || OWNER_RULE[u.id].includes(id);
    ck(`MODES owners + GM, ${u.id} / ${id}: ${want ? "shown" : "not shown"}`, (s.hurt(id, ["health", "resolve"]).live > 0) === want);
  }
  s.set("goreWho", "all");
  for (const id of Object.keys(CHARS)) {
    const want = u.isGM || VISIBLE_TO_PLAYERS.includes(id);
    ck(`MODES every screen, ${u.id} / ${id}: ${want ? "shown" : "not shown (a hidden token is never told to a player)"}`, (s.hurt(id, ["health", "resolve"]).live > 0) === want);
  }
  s.set("goreWho", "owner");
  ck(`MODES ${u.id}: back on the owner rule at once (live, no reload)`, (s.hurt("HERO", ["health"]).live > 0) === (u.id === "P1"));
}

/* ---------------- OLD: a world with a stored earlier choice ---------------- */
for (const old of ["all", "owners"]) for (const uid of ["GM", "P1", "P3"]) {
  const u = USERS.find((x) => x.id === uid);
  const s = await seat(u, { [`${MOD}.goreSeats`]: old, [`${MOD}.goreBlood`]: 3, [`${MOD}.goreHold`]: 1.5 });
  ck(`OLD a world that stored "${old}" under the earlier key, ${uid}: on the owner rule`, s.state().opts.seats === "owner" && (s.hurt("HERO", ["health", "resolve"]).live > 0) === (uid === "P1") && (s.hurt("NPC", ["health"]).live > 0) === (uid === "GM"));
  ck(`OLD ... ${uid}: nothing registers or writes the earlier key; its stored value is left as it was`, !s.settings.has(`${MOD}.goreSeats`) && s.values[`${MOD}.goreSeats`] === old);
  ck(`OLD ... ${uid}: the table's other stored choices are kept (blood 3, hold 1.5, cracks at its default)`, s.state().opts.blood === 3 && s.state().opts.hold === 1.5 && s.state().opts.cracks === 2);
}

/* ---------------- WAY: the attacker only has to be seen ---------------- */
{
  const src = (await import("node:fs")).readFileSync(new URL("../gore/main.mjs", import.meta.url), "utf8");
  ck("the splash's direction asks whether this seat SEES the attacker, not whether it would be shown the attacker's blood", /!seatMay\(src, "all"\)/.test(src) && !/!seatMay\(src\)\)/.test(src));
  ck("a hurt character is asked through the table's choice", /const may = seatMay\(tok\);/.test(src) && /if \(!may\) return;/.test(src));
  /* the owning player's hero is hit by an NPC he does not own: the blood still lands (and is laid out) on his seat */
  const s = seats.P1;
  s.enter();
  for (const fn of s.hooks[`${MOD}.tactics`] ?? []) { fn({ combat: "C", type: "roll", key: "attack", who: "cNPC" }); fn({ combat: "C", type: "damage", target: "cHERO" }); }
  ck("an owner hit by somebody else's character: his blood plays on his seat", got(s.hurt("HERO", ["health"])) === "1b0c");
}

/* ---------------- WINDOW ---------------- */
{
  const D = await import("../table/defs.mjs"), { EN, PL } = await import("../table/lang.mjs");
  const row = D.rowById("gore.seats");
  ck("the window's row writes the new key", row?.key === "goreWho" && row.src === "mod" && !D.ROWS.some((r) => r.key === "goreSeats"));
  const reg = seats.GM.settings.get(`${MOD}.goreWho`);
  ck("the registered choices are the three, the owner rule first (the window lists them in this order)", JSON.stringify(Object.keys(reg.choices)) === JSON.stringify(["owner", "owners", "all"]));
  for (const [name, L] of [["EN", EN], ["PL", PL]]) {
    const labels = P.SEATS.map((c) => L[`IPT.Row.gore.seats.${c}`]);
    ck(`${name}: each choice has its own label`, labels.every((x) => typeof x === "string" && x.length > 5) && new Set(labels).size === 3, labels.join(" | "));
    ck(`${name}: the hint says what the GM's screen gets under the owner rule`, L["IPT.Row.gore.seats.Hint"].includes(L["IPT.Row.gore.seats.owner"]) && /GM|MG/.test(L["IPT.Row.gore.seats.Hint"]));
  }
  ck("this change needs no migration step of the table (its number is the one GMGOVERN left)", D.MIGRATION === 3);
}

globalThis.setTimeout = realST; globalThis.clearTimeout = realCT; globalThis.performance = realPerf;
console.log(`sweep goreown: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
