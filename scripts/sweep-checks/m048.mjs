// node scripts/sweep-checks/m048.mjs  (S048: the Damage Taken card shows Health numbers, bar and BROKEN stamp only to a viewer who may read that character)
import { readFileSync } from "node:fs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const src = readFileSync(new URL("../module.js", import.meta.url), "utf8");
const i = src.indexOf("function dmgMayRead(");
ck("dmgMayRead defined", i >= 0);
const fnSrc = i >= 0 ? src.slice(i, src.indexOf("\n}\n", i) + 2) : "function dmgMayRead() { return true; }";
const may = new Function("game", `${fnSrc}; return dmgMayRead;`)({ user: { isGM: false } });
const actor = (perm, type = "npc") => ({ type, testUserPermission: (_u, lvl) => ({ NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 })[perm] >= ({ LIMITED: 1, OBSERVER: 2, OWNER: 3 })[lvl] });
ck("player, monster with no rights: hidden", may(actor("NONE")) === false);
ck("player, LIMITED: hidden", may(actor("LIMITED")) === false);
ck("player, observer: shown", may(actor("OBSERVER")) === true);
ck("player, owner: shown", may(actor("OWNER")) === true);
ck("challenge is public (Challenges HUD)", may(actor("NONE", "challenge")) === true);
ck("unknown actor: hidden", may(null) === false);
ck("GM sees all", may(actor("NONE"), { isGM: true }) === true);
/* ANSG (SWEEPM-13, the user 2026-11-12): a player's hero is open to every viewer; an NPC, or a hero nobody of the players owns, is not */
ck("SWEEPM-13: a player's hero with no rights: shown", may({ ...actor("NONE", "superhero"), hasPlayerOwner: true }) === true);
ck("SWEEPM-13: a hero without a player owner: hidden", may({ ...actor("NONE", "superhero"), hasPlayerOwner: false }) === false);
ck("SWEEPM-13: an NPC a player owns stays by rights (no rights: hidden)", may({ ...actor("NONE", "npc"), hasPlayerOwner: true }) === false);
const card = src.slice(src.indexOf("function damageCard("), src.indexOf("// ---- top row"));
ck("damageCard clears the numbers for a viewer who may not read them", /if \(!dmgMayRead\(actor\)\) \{ from = null; to = null; max = null; \}/.test(card) && card.indexOf("dmgMayRead(actor)") < card.indexOf("const broken = to === 0;"));
console.log(`sweep m048: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
