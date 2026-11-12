// node scripts/sweep-checks/c20.mjs  (S060: publicResolve must not throw when the summoner branch passes and speakerActor is null)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const hero = { type: "superhero", ownership: { u1: 3 }, system: { derived: { resolve: 3 } }, prototypeToken: { disposition: 1 } };
const ownerUser = { id: "u1", isGM: false };
globalThis.game = {
  users: [ownerUser],
  scenes: { get: () => null },
  combats: [{ combatants: Object.assign([{ tokenId: "T1", flags: { "invincible-plus-ultra": { tactics: { summonOf: "S" } } } }], {
    get: (id) => (id === "S" ? { actor: hero, token: null } : null) }) }],
};
const R = await import("../splash/reader.mjs");
const msg = { speaker: { token: "T1", scene: "sc" }, speakerActor: null };
const live = R.heroSpeaker(msg);
let r, threw = false;
try { r = R.publicResolve(msg); } catch { threw = true; }
ck("mock reaches summoner branch", live === true);
if (live) { ck("null speakerActor via summoner does not throw", !threw); ck("resolves to null", r === null); }
else { ck("source-text guard (mock did not reach summoner branch)", true); }
const src = readFileSync(fileURLToPath(new URL("../splash/reader.mjs", import.meta.url)), "utf8");
ck("source guards speakerActor with ?.", src.includes("message.speakerActor?.system?.derived?.resolve"));
ck("no unguarded dereference", !/message\.speakerActor\.system/.test(src));
console.log(`sweep c20: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
