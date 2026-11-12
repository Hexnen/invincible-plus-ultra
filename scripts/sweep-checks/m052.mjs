// node scripts/sweep-checks/m052.mjs  (S052: a party card titled from the linked token also reads that token's actor, not an earlier unlinked copy's)
import { readFileSync } from "node:fs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const src = readFileSync(new URL("../party/main.mjs", import.meta.url), "utf8");
const i = src.indexOf("function collect()");
const fnSrc = src.slice(i, src.indexOf("\n}\n", i) + 2);
const world = { id: "h1", name: "Hero", type: "superhero", hasPlayerOwner: true, tag: "world" };
const copy = { ...world, tag: "copy" };
const tokens = [{ id: "t1", actor: copy, actorLink: false }, { id: "t2", actor: world, actorLink: true }];
const collect = new Function("canvas", "game", `${fnSrc}; return collect;`)({ scene: { tokens } }, { user: { isGM: true }, i18n: { lang: "en" } });
const [e] = collect();
ck("linked token first", e.tds[0].id === "t2");
ck("entry reads the linked token's actor", e.actor.tag === "world");
const [e2] = new Function("canvas", "game", `${fnSrc}; return collect;`)({ scene: { tokens: [tokens[0]] } }, { user: { isGM: true }, i18n: { lang: "en" } })();
ck("only an unlinked token: its actor as before", e2.actor.tag === "copy");
console.log(`sweep m052: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
