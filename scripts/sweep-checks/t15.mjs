// node scripts/sweep-checks/t15.mjs  (T031-T034: log module; source-text checks, the code needs Foundry globals)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const rd = (p) => readFileSync(fileURLToPath(new URL("../log/" + p, import.meta.url)), "utf8");
const md = rd("ui/maint-dialogs.mjs"), rl = rd("relay.mjs"), sc = rd("scribe.mjs");
// T031
ck("safeEnter defined, captures Enter and presses cancel", /const safeEnter[\s\S]*?"Enter"[\s\S]*?data-action="cancel"[\s\S]*?\.click\(\)/.test(md));
ck("trim dialog wires safeEnter", /safeEnter\(dialog\);\s*\n\s*input\.addEventListener/.test(md));
ck("delete dialog wires safeEnter", /render: \(_ev, dialog\) => safeEnter\(dialog\)/.test(md));
// T032: behaviour model of the retry decision
ck("rate is retryable", /RETRY_CODES = new Set\(\[[^\]]*"rate"/.test(rl));
const decide = (code, prevTries) => { const tries = code === "rate" ? prevTries : prevTries + 1; return tries < 6; };
ck("rate never exhausts tries", decide("rate", 5));
ck("other codes still do", !decide("relay", 5));
ck("source counts rate separately", /e\?\.code === "rate" \? \(item\.tries \|\| 0\)/.test(rl));
// T033
ck("gap stamped with now, not actor stats", !/modifiedTime/.test(sc.slice(sc.indexOf("async function baselineActor"), sc.indexOf("export async function catchUp"))));
ck("gap has t: Date.now()", /normalizeEntry\(\{ t: Date\.now\(\), u: "", k: "log\.gap"/.test(sc));
// T034
ck("deleteJournalEntry hook registered", /Hooks\.on\("deleteJournalEntry", onDeleteLogJournal\)/.test(sc));
ck("hook forgets and rebaselines only for a still-tracked actor log", /onDeleteLogJournal[\s\S]*?S\.states\.has\(lg\.actorId\)[\s\S]*?forget\(lg\.actorId\)[\s\S]*?rebaseline\(lg\.actorId\)/.test(sc));
console.log(`sweep t15: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
