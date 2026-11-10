// node scripts/tactics/check-lang.mjs -- key parity of the tactics strings: EN and PL define the same keys and placeholders; every key the code can ask for exists.
import { EN, PL, t, errorText } from "./lang.mjs";
import { ok, eq, done } from "./testkit.mjs";
import * as E from "./engine-pure.mjs";
import * as R from "./relay-pure.mjs";
import * as M from "./mods-pure.mjs";
import * as C from "./catalog-pure.mjs";
import * as D from "./desk-pure.mjs";
import { stunts } from "../rules/index.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
for (const k of Object.keys(EN)) { ok(k in PL, `in EN, missing in PL: ${k}`); if (k in PL) eq(ph(PL[k]), ph(EN[k]), `placeholders of ${k}`); }
for (const k of Object.keys(PL)) ok(k in EN, `in PL, missing in EN: ${k}`);
for (const T of [EN, PL]) for (const [k, v] of Object.entries(T)) { ok(typeof v === "string" && v.trim().length > 0, `non-empty: ${k}`); ok(k.startsWith("ITAC."), `namespace: ${k}`); ok(!/[—–]/.test(v), `no long dashes: ${k}`); }
for (const k of Object.keys(EN)) if (/^ITAC\.(err|warn|Settings)\./.test(k) && EN[k].length > 30) ok(EN[k] !== PL[k], `PL differs from EN (translated): ${k}`);

const need = new Set();
const files = [...readdirSync(dir).filter((f) => f.endsWith(".mjs") && !f.startsWith("check-") && f !== "lang.mjs" && f !== "testkit.mjs"), ...readdirSync(join(dir, "flows")).map((f) => `flows/${f}`)];
for (const f of files) {
  const src = readFileSync(join(dir, f), "utf8");
  for (const m of src.matchAll(/["'`](ITAC\.[A-Za-z][\w.]*[A-Za-z])["'`]/g)) need.add(m[1]);
  for (const m of src.matchAll(/\bbad\("([A-Za-z]+)"/g)) need.add(f.startsWith("flows/") ? `ITAC.reason.${m[1]}` : `ITAC.err.${m[1]}`);
  for (const m of src.matchAll(/\breason: "([A-Za-z]+)"/g)) need.add(`ITAC.reason.${m[1]}`);
  for (const m of src.matchAll(/\bdisabled: "([A-Za-z]+)"/g)) need.add(`ITAC.reason.${m[1]}`);
}
for (const c of [...E.ERROR_CODES, ...R.RELAY_CODES]) need.add(`ITAC.err.${c}`);
for (const o of E.REVALIDATE_OPTIONS) need.add(`ITAC.opt.${o}`);
for (const id of Object.keys(C.BUILTIN)) need.add(`ITAC.action.${id}`);
for (const id of Object.keys(stunts.STUNTS)) need.add(`ITAC.stunt.${id}`);
for (const k of D.CARD_KINDS) { need.add(`ITAC.card.${k}`); need.add(`ITAC.prompt.${k}`); }
for (const s of M.STATUS_IDS) need.add(`ITAC.status.${s}`);
for (const g of ["invisible", "lowGravity", "unseen"]) need.add(`ITAC.gate.${g}`);
for (const k of ["attack", "def", "gate", "stun", "roll"]) need.add(`ITAC.roll.${k}`);
for (const k of ["base", "floor", "crit", "help", "minions", "restrained", "unaware", "cantSee", "gm", "gate"]) need.add(`ITAC.mod.${k}`);
for (const k of need) ok(k in EN && k in PL, `used by the code but not defined in both languages: ${k}`);
ok(need.size > 150, `keys collected from the code (${need.size})`);

eq(t("ITAC.err.illegal", { reason: "x" }), "Not possible: x.", "placeholders are filled");
eq(t("ITAC.nope"), "ITAC.nope", "an unknown key falls back to the key");
eq(t("ITAC.mod.someToken", {}, "Lucky charm"), "Lucky charm", "or to the given fallback");
eq(errorText({ key: "ITAC.err.illegal", code: "illegal", params: { reason: "outOfReach" } }), "Not possible: out of reach.", "an illegal reason is itself translated");
eq(errorText(R.bad("noGM").error), EN["ITAC.err.noGM"], "error envelope to text");
done("check-lang");
