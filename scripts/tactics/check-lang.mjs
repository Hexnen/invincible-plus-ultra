/* node scripts/tactics/check-lang.mjs -- the ONE string table of tactical combat (the checks of both packages it was merged from):
   1) EN and PL define exactly the same keys with the same {placeholders}; no empty strings; namespace ITAC; no long dashes.
   2) Every ITAC.* key written as a literal in scripts/tactics (root, flows, ui) is defined in both.
   3) Derived keys exist: every error code either machine or the transport can answer, every reason a flow, the engine or an adapter
      can give, the settings, the prompt kinds of the round driver and the card kinds of the desk, actions, stunts, statuses, roll and
      modifier labels.
   4) No rule text: no string is long enough to be a quoted rule, and none carries a book reference. */
import { EN, PL, t, errText, errorText } from "./lang.mjs";
import { ok, eq, done } from "./testkit.mjs";
import * as O from "./ops-pure.mjs";
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
for (const T of [EN, PL]) for (const [k, v] of Object.entries(T)) {
  ok(typeof v === "string" && v.trim().length > 0, `non-empty: ${k}`);
  ok(k.startsWith("ITAC."), `namespace: ${k}`);
  ok(!/[—–]/.test(v), `no long dashes: ${k}`);
  ok(v.length <= 420, `not too long for our own wording: ${k}`);
  ok(!/\[B\d+\]|\bp\.\s?\d+/.test(v), `no book reference in a string: ${k}`);
}
for (const k of Object.keys(EN)) if (EN[k].length > 40) ok(EN[k] !== PL[k], `PL differs from EN (translated): ${k}`);
for (const k of Object.keys(EN)) if (/^ITAC\.(err|warn|Settings)\./.test(k) && EN[k].length > 30) ok(EN[k] !== PL[k], `PL differs from EN (translated): ${k}`);

const need = new Set(), codes = new Set();
const sub = (d) => readdirSync(join(dir, d)).filter((f) => f.endsWith(".mjs")).map((f) => `${d}/${f}`);
const files = [...readdirSync(dir).filter((f) => f.endsWith(".mjs") && !f.startsWith("check-") && f !== "lang.mjs" && f !== "lang-attacks.mjs" && f !== "lang-int.mjs" && f !== "testkit.mjs"), ...sub("flows"), ...sub("ui")];
for (const f of files) {
  const src = readFileSync(join(dir, f), "utf8");
  for (const m of src.matchAll(/["'`](ITAC\.[A-Za-z][\w.]*[A-Za-z0-9])["'`]/g)) need.add(m[1]);
  for (const m of src.matchAll(/\bbad\("([A-Za-z]+)"/g)) need.add(f.startsWith("flows/") ? `ITAC.reason.${m[1]}` : `ITAC.err.${m[1]}`);
  for (const m of src.matchAll(/\breason: "([A-Za-z]+)"/g)) need.add(`ITAC.reason.${m[1]}`);
  for (const m of src.matchAll(/\bdisabled: "([A-Za-z]+)"/g)) need.add(`ITAC.reason.${m[1]}`);
  for (const m of src.matchAll(/\berr\("([A-Za-z]+)"/g)) codes.add(m[1]);
  for (const m of src.matchAll(/\? "([A-Za-z]+)" : "([A-Za-z]+)"\)/g)) if (/err\(/.test(src.slice(Math.max(0, m.index - 80), m.index))) { codes.add(m[1]); codes.add(m[2]); }
}
for (const c of ["noGM", "untrusted", "stale", "rate", "badInput", "off", "notOwner", "notYourTurn", "noAction", "locked", "illegal", "unknown", "gone", "busy", "playersOff", "internal"]) codes.add(c);   // spec 12.1
for (const c of [...E.ERROR_CODES, ...R.RELAY_CODES]) codes.add(c);
for (const c of codes) need.add(`ITAC.err.${c}`);
for (const o of E.REVALIDATE_OPTIONS) need.add(`ITAC.opt.${o}`);
/* the journal: every GM edit and every word a flow may close with reads as a string of the reader's language, never as an id */
for (const op of E.GM_EDIT_OPS) need.add(`ITAC.edit.${op}`);
for (const k of ["gm", "clock", "wardReset", "stress", "sceneEnd", "fireSpread"]) need.add(`ITAC.journal.${k}`);
for (const f of files) for (const m of readFileSync(join(dir, f), "utf8").matchAll(/data\.result = ([^;\n]*)/g)) for (const w of m[1].matchAll(/"([A-Za-z]+)"/g)) need.add(`ITAC.result.${w[1]}`);
for (const k of ["out", "stays", "spreads", "nowhere", "held", "healthy", "sick", "cured", "dead", "manual"]) need.add(`ITAC.result.${k}`);      // the words that come from the rules library (fire spread, disease) and from a resolution by hand
for (const k of ["fire", "blast", "area", "vacuum", "disease"]) need.add(`ITAC.ui.hz.kind.${k}`);
for (const k of ["forcedMove", "fall", "hazard", "challengeEffect", "chaseRound", "other"]) need.add(`ITAC.action.${k}`);
for (const id of Object.keys(C.BUILTIN)) need.add(`ITAC.action.${id}`);
for (const id of Object.keys(stunts.STUNTS)) need.add(`ITAC.stunt.${id}`);
for (const k of D.CARD_KINDS) { need.add(`ITAC.card.${k}`); need.add(`ITAC.prompt.${k}`); }
for (const s of M.STATUS_IDS) need.add(`ITAC.status.${s}`);
for (const g of ["invisible", "lowGravity", "unseen"]) need.add(`ITAC.gate.${g}`);
for (const k of ["attack", "def", "gate", "stun", "roll"]) need.add(`ITAC.roll.${k}`);
for (const k of ["base", "floor", "crit", "help", "minions", "restrained", "unaware", "cantSee", "gm", "gate"]) need.add(`ITAC.mod.${k}`);
for (const k of ["tacticsEnabled", "tacticsInitiative", "tacticsRedraw", "tacticsPushOrder"]) for (const p of ["Name", "Hint"]) need.add(`ITAC.Settings.${k}.${p}`);
for (const k of ["everyRound", "firstRoundOnly"]) need.add(`ITAC.Redraw.${k}`);
for (const k of ["afterDefence", "beforeDefence"]) need.add(`ITAC.PushOrder.${k}`);
for (const k of ["hit", "miss", "done", "stopped", "barrier", "illegal", "gateFailed", "chargeStopped", "noFall", "none", "refused", "released", "success", "fail", "aborted", "rollFailed"]) need.add(`ITAC.result.${k}`);   // the journal's result marks (engine-pure label)
for (const k of ["wreck", "area", "fullAuto"]) for (const x of ["", ".tip", ".note"]) need.add(`ITAC.ui.arm.${k}${x}`);
for (const k of ["weapon", "wreck", "fullAuto", "minRange"]) need.add(`ITAC.mod.${k}`);
for (const k of O.P1_PROMPTS) if (k !== "triggerQueue") need.add(`ITAC.Prompt.${k}.Title`).add(`ITAC.Prompt.${k}.Body`);
for (const k of ["roundStart", "roundEnd", "turnStart", "turnEnd"]) need.add(`ITAC.Prompt.triggerQueue.Title.${k}`);
for (const r of ["noZonesApi", "badOp", "notGM", "notActiveGM", "noZones", "error", "requirement", "immune", "openAction", "rules"]) need.add(`ITAC.reason.${r}`);      // the zones API's refusals, the director's, the predicates'
for (const k of need) ok(k in EN && k in PL, `used by the code but not defined in both languages: ${k}`);
ok(need.size > 200, `keys collected from the code (${need.size})`);

/* t() and errText() */
eq(t("ITAC.err.stale"), EN["ITAC.err.stale"], "t() falls back to English outside Foundry");
eq(t("ITAC.err.illegal", { reason: "x" }), "Not possible: x.", "placeholders are filled");
eq(t("ITAC.nope"), "ITAC.nope", "an unknown key falls back to the key");
eq(t("ITAC.mod.someToken", {}, "Lucky charm"), "Lucky charm", "or to the given fallback");
eq(errText({ key: "ITAC.err.zzz", code: "zzz", params: {} }), t("ITAC.err.internal", { msg: "zzz" }), "errText of an unknown code is the internal error");
ok(errText({ key: "ITAC.err.internal", code: "internal", params: { msg: "boom" } }).includes("boom"), "errText fills parameters");
eq(errorText({ key: "ITAC.err.illegal", code: "illegal", params: { reason: "outOfReach" } }), "Not possible: out of reach.", "an illegal reason is itself translated");
eq(errText({ key: "ITAC.err.illegal", code: "illegal", params: { reason: "requirement", why: "targetNotHeld" } }), "Not possible: a requirement of this action is not met (targetNotHeld).", "a reason takes the error's own parameters");
eq(errText({ key: "ITAC.err.illegal", code: "illegal", params: {} }), "Not possible: the rules do not allow it.", "an illegal answer without a reason still reads as a sentence");
eq(errorText(R.bad("noGM").error), EN["ITAC.err.noGM"], "error envelope to text");
ok(errorText === errText, "one function under both names (the widgets call errText, the desk models errorText)");
done("check-lang");
