import { readFileSync } from "node:fs";
import { stateFromActor } from "../chargen/import.mjs";
import { normBase } from "../chargen/catalog.mjs";
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.error("FAIL", m); } };
const rd = (f) => readFileSync(new URL(`../chargen/${f}`, import.meta.url), "utf8");

// S016: stateFromActor splits "Name (note)" of a power (foundry global stubbed)
globalThis.foundry = { utils: { getProperty: (o, p) => p.split(".").reduce((a, k) => a?.[k], o) } };
const item = (id, type, name, system = {}) => ({ id, type, name, system });
const actor = { _source: {}, items: [item("a", "powerSource", "Alien"), item("b", "power", "Strike (fists)", { level: "major", powerSource: "a" }), item("c", "power", "Flight", { powerSource: "a" })] };
const st = stateFromActor(actor);
ok(st.powers[0].name === "Strike" && st.powers[0].note === "fists", "power note split");
ok(st.powers[1].name === "Flight" && !("note" in st.powers[1]), "plain power unchanged");
ok(normBase("Strike (fists)") === "strike", "normBase strips note");
ok(/normBase\(p\.name\) === normBase\(name\)/.test(rd("catalog.mjs")), "findPower has normBase fallback");

// S017: fresh key must not collide with keys held by locked powers
const src = rd("random.mjs");
ok(/keys\.includes\(`s\$\{k\}`\)/.test(src), "random.mjs skips taken keys (source text)");
function keysFor(keys, nSrc) { const sources = []; for (let i = 0; i < nSrc; i++) { let key = keys[i]; if (!key) { let k = sources.length + 1; while (keys.includes(`s${k}`) || sources.some((x) => x.key === `s${k}`)) k++; key = `s${k}`; } sources.push({ key }); } return sources.map((s) => s.key); }
const ks = keysFor(["s2"], 2);
ok(new Set(ks).size === 2, "no duplicate source keys: " + ks);

// S018: snapOf prefers the newer snapshot (source text + model)
const ap = rd("apply.mjs");
ok(/Number\(flag\.at\) \|\| 0\) > \(Number\(mem\.at\) \|\| 0\)/.test(ap), "snapOf compares at (source text)");
const pick = (mem, flag) => (mem && flag && (Number(flag.at) || 0) > (Number(mem.at) || 0) ? flag : mem ?? flag);
ok(pick({ at: 1 }, { at: 2 }).at === 2, "newer flag wins");
ok(pick({ at: 3 }, { at: 2 }).at === 3 && pick(null, { at: 2 }).at === 2 && pick({ at: 1 }, null).at === 1, "memory/only-one cases");
console.log(`sweep c5: ${n} checks, ${bad} failed`);
process.exit(bad ? 1 : 0);
