// node scripts/sweep-checks/m005.mjs  (S005: the rank tooltip must not name heroes the viewer may not see; the rank still counts them)
import { readFileSync } from "node:fs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const MOD = "invincible-plus-ultra";
class Doc {}
globalThis.foundry = { abstract: { Document: Doc } };
globalThis.CONST = { USER_ROLES: { ASSISTANT: 3 } };
const user = { id: "u1", isGM: false, hasRole: () => false };
const hero = (id, name, rank, see) => Object.assign(new Doc(), {
  id, name, type: "superhero", documentName: "Actor", flags: { [MOD]: { base: { team: "card" }, chargen: { rank } } }, _source: { system: {} }, items: { contents: [] },
  testUserPermission: () => see,
});
const card = Object.assign(new Doc(), { id: "card", name: "Team", documentName: "Actor", flags: { [MOD]: { base: { kind: "teamBase" } } } });
const actors = [card, hero("h1", "Seen Hero", "local", true), hero("h2", "Secret Hero", "global", false)];
globalThis.game = { user, actors: Object.assign(actors, { get: (id) => actors.find((a) => a.id === id) }) };
const S = await import("../base/store.mjs");
const ri = S.rankOf("card");
ck("rank still counts the hidden hero", ri.rank === "global");
ck("visible hero keeps its name", ri.members.some((m) => m.name === "Seen Hero"));
ck("hidden hero's name is not in rankInfo", !JSON.stringify(ri).includes("Secret Hero") && !JSON.stringify(ri).includes("h2"));
const sheet = readFileSync(new URL("../base/sheet.mjs", import.meta.url), "utf8");
ck("tooltip skips hidden members", /ri\.members\.filter\(\(m\) => !m\.hidden\)/.test(sheet));
console.log(`sweep m005: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
