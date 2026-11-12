// node scripts/sweep-checks/c18.mjs  (S054 undo partial on dup end, S055 inflight slot before jitter, S056 start dup across GM tabs)
// gm/award need Foundry globals, so the fixes are asserted on source text plus extracted logic.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const rd = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const gm = rd("../session/gm.mjs"), aw = rd("../session/award.mjs");

// S054
const pl = aw.split("\n").find((l) => l.includes("partial:") && l.includes("end.partial"));
ck("S054 partial line found", !!pl);
const partialOf = (end, award) => eval(pl.match(/partial: (.*?), results/)[1].replace(/Store\.current\(\)\?\.award/g, "award"));
ck("S054 dup end with award still open is partial", partialOf({ ok: true, dup: true }, { rows: [] }) === true);
ck("S054 fresh partial end", partialOf({ partial: true }, {}) === true);
ck("S054 dup end with award closed is not partial", partialOf({ dup: true }, null) === false);
ck("S054 complete end not partial", partialOf({}, null) === false);

// S055: slot is taken before the jitter await and released in a finally
const iSlot = gm.indexOf("slot = sender.id"), iWait = gm.indexOf("await wait(Math.random()");
ck("S055 slot taken before jitter await", iSlot > 0 && iWait > 0 && iSlot < iWait);
ck("S055 slot taken right after the rate check (same block)", gm.indexOf("OP.MAX_INFLIGHT") < iSlot && iSlot < gm.indexOf("OP.normalizeRequest("));
ck("S055 released in finally", /finally \{ if \(slot\) inflight\.set\(slot/.test(gm));
ck("S055 no second increment after jitter", (gm.match(/\(inflight\.get\(sender\.id\) \?\? 0\) \+ 1/g) ?? []).length === 1);
// behaviour model: burst of 6 with a pre-await reservation passes only MAX
const sim = async (reserve) => {
  const inflight = { v: 0 }, MAX = 3; let pass = 0;
  const one = async () => {
    if (inflight.v >= MAX) return; if (reserve) inflight.v++;
    await new Promise((r) => setTimeout(r, 5)); if (!reserve) inflight.v++; pass++;
    await new Promise((r) => setTimeout(r, 5)); inflight.v--;
  };
  await Promise.all(Array.from({ length: 6 }, one)); return pass;
};
ck("S055 model: old order lets the whole burst through", (await sim(false)) === 6);
ck("S055 model: reserve-first caps the burst", (await sim(true)) === 3);

// S056: deterministic id from rid, exists on the same id is a dup
const idLine = gm.split("\n").find((l) => l.includes("const id = rid"));
ck("S056 id derived from rid", !!idLine);
const mkId = (rid) => eval(idLine.replace(/^\s*const id = /, "").replace(/;\s*$/, ""));
ck("S056 same rid gives same id", mkId("u1:abc") === mkId("u1:abc") && mkId("u1:abc") !== mkId("u1:abd"));
ck("S056 id is valid for the reducer", /^[A-Za-z0-9_-]{1,40}$/.test(mkId("userIdabcdefghij:req_12345678901234567890")));
ck("S056 exists + same id returns dup ok", /code === "exists" && Store\.current\(\)\?\.id === id\) return \{ ok: true, changed: false, dup: true/.test(gm));
console.log(`sweep c18: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
