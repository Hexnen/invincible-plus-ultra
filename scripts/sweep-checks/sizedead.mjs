import "../tokenreact/impact-node-prime.mjs";      // the vendored engine's impact table for pure.mjs (on a page: the running engine's L.impact)
// node scripts/sweep-checks/sizedead.mjs  (SIZEDEAD: blind review ADVS3 D3). A size the table's window offers does what it says, on every
// seat, for every kind of word. Seen live on tactics-integrated-161 and again on 164 (The Warehouse, GM and a player): the reactions'
// size "large" and the lettering's Size 2.0 reached both seats' settings and a knock-down word drew the same px as at the defaults; the
// roll splash's Size did nothing on a map layer.
//   A  the rule (tokenreact/pure.mjs): the table's size = the reactions' step x the lettering's Size; it moves the wanted size, the floor
//      and the ceilings, for every kind of reaction word, short or long, beside a small or a big token; two ceilings no choice lifts.
//   B  seats (tokenreact/check-crowd-seat.mjs: a fake Foundry per seat, the real tokenreact, a stand-in engine that multiplies by its own
//      Size as the engine does): an open board and a crowd, GM and a player on one view: each step is drawn bigger than the one before
//      where there is room, the same on both seats; in a crowd a bigger step is never smaller, and every size keeps REACTPLACE's rules
//      (by its token, on no other token, inside the standard view); an older engine's per-screen Size is not counted.
//   C  the roll splash (lib/splash-seat.mjs: the real stage, the real engine's boxes): its Size on the screen layer AND on the map layer,
//      the lettering's Size through it (main.mjs scaleK), same block on two seats.
//   D  the window: every row named size / scale is listed here with the area that reads it (a new one must be added with its proof).
// Fails on tactics-integrated-164 (A2-A6, B open board "large", B lettering Size, C map layer, C lettering Size).
// Prints "sweep sizedead: N checks, F failed".
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as P from "../tokenreact/pure.mjs";
import * as Lay from "../tokenreact/layout.mjs";
import * as D from "../table/defs.mjs";

let n = 0, failed = 0;
const ck = (name, cond, more = "") => { n++; if (!cond) { failed++; console.log(`FAIL ${name}${more ? `\n   ${more}` : ""}`); } };
const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const VH = P.REF_VH, VW = P.REF_VW;

/* ---------------- A: the rule ---------------- */
{
  ck("A1 the steps and the limits are there", P.SIZE_STEP?.small < 1 && P.SIZE_STEP?.normal === 1 && P.SIZE_STEP?.large > 1 && typeof P.tableSize === "function" && typeof P.sizeCeil === "function"
    && P.SIZE_TABLE?.lo <= 0.5 && P.SIZE_TABLE?.hi >= 2.5 * 1.25);
  if (typeof P.tableSize === "function" && typeof P.sizeCeil === "function") {
    ck("A0 a step under 1 is drawn, not planned: small plans as normal and draws at 0.8; large plans at 1.25 and draws whole", P.stepPlanK("small") === 1 && P.stepDrawK("small") === 0.8 && P.stepPlanK("large") === 1.25 && P.stepDrawK("large") === 1
      && P.stepPlanK("normal") === 1 && P.stepDrawK("normal") === 1 && P.stepDrawK("nonsense") === 1 && P.tableSize("small", 1) === P.tableSize("normal", 1)
      && /shrink\(it\.plan, P\.stepDrawK\(get\(KEY\.size, "normal"\)\)\)/.test(src("../tokenreact/main.mjs")));
    ck("A1 the table's size = the step x the lettering's Size, held to its limits", P.tableSize("normal", 1) === 1 && Math.abs(P.tableSize("large", 2) - 2.5) < 1e-9 && Math.abs(P.tableSize("small", 0.5) - P.SIZE_TABLE.lo) < 1e-9
      && P.tableSize("large", 2.5) <= P.SIZE_TABLE.hi && P.tableSize("nonsense", "x") === 1);
    /* the review's word: a knock-down by a 100 px and a 160 px token (it stood AT the width cap at "normal": "large" drew the same) */
    for (const tp of [100, 160, 175]) {
      const [s, m, l] = ["small", "normal", "large"].map((st) => P.stepDrawK(st) * P.targetPx("down", 1, "KA-THOOM!!", tp, VH, VW, 1, P.tableSize(st, 1)));      // "small" is drawn, not planned (stepDrawK)
      ck(`A2 the review's knock-down word by a ${tp} px token: small ${s.toFixed(1)} < normal ${m.toFixed(1)} < large ${l.toFixed(1)} px, a real step each`, l >= m * 1.2 && s <= m * 0.84);
    }
    /* every kind of reaction word, short and long, small and big tokens, light and heavy amounts */
    const kinds = [...P.HEALTH, ...P.RESOLVE, ...P.CHALLENGE_KINDS], words = ["AH", "BAM!", "KRAKK!", "KA-THOOM!!", "KRA-KA-GRRAWOOM!!"];
    let flat = [], uneven = [], floorBad = [];
    for (const kind of kinds) for (const w of words) for (const tp of [20, 40, 70, 100, 175, 350, 560]) for (const amt of [0, 0.3, 1]) for (const k of [1, 0.6]) {
      const at = (u) => P.targetPx(kind, amt, w, tp, VH, VW, k, u);
      const s = P.stepDrawK("small") * at(P.tableSize("small", 1)), m = at(1), l = at(P.tableSize("large", 1));
      /* (a word whose ceiling at the normal size is already past the hard one, a 17-letter roar beside a 350 px token, grows only up to
         that ceiling: no view has room for more) */
      const c1w = P.sizeCeil(tp, VH, VW, 1).width / (P.SIZE_RULE.aspect * (Math.max(2, [...w].filter((ch) => /[\p{L}\p{N}]/u.test(ch)).length) + 0.5));
      const hard = Math.max(P.SIZE_RULE.widthTok * tp, P.SIZE_RULE.widthVw * VW) >= P.SIZE_TABLE.widthVw * VW && l >= c1w - 1e-6;
      if (!((l >= m * 1.2 || (hard && l >= m - 1e-9)) && s <= m * 0.84)) flat.push([kind, w, tp, amt, k, s.toFixed(1), m.toFixed(1), l.toFixed(1)]);
      /* the lettering's Size alone, over its whole range: never smaller for a bigger choice, and bigger until a hard ceiling holds it */
      let prev = 0;
      for (const e of [0.5, 0.75, 1, 1.5, 2, 2.5]) {
        const u = P.tableSize("normal", e), v = at(u), c = P.sizeCeil(tp, VH, VW, u);
        const held = v >= c.capH - 1e-6 || v >= c.width / (P.SIZE_RULE.aspect * (Math.max(2, [...w].filter((ch) => /[\p{L}\p{N}]/u.test(ch)).length) + 0.5)) - 1e-6;
        if (v < prev - 1e-9 || (v < prev * 1.15 && !held)) uneven.push([kind, w, tp, amt, k, e, prev.toFixed(1), v.toFixed(1)]);
        if (v > VH * P.SIZE_TABLE.capVh + 1e-6) floorBad.push([kind, w, tp, e, v.toFixed(1)]);
        prev = v;
      }
    }
    ck(`A3 every kind x word x token x amount: small, normal and large are three sizes (${flat.length} of ${kinds.length * words.length * 7 * 3 * 2} flat)`, !flat.length, JSON.stringify(flat.slice(0, 6)));
    ck(`A4 the lettering's Size 0.5 .. 2.5 grows every reaction word until a hard ceiling holds it (${uneven.length} uneven)`, !uneven.length, JSON.stringify(uneven.slice(0, 6)));
    ck("A4 no choice lifts a word over the hard ceiling (cap height)", !floorBad.length, JSON.stringify(floorBad.slice(0, 6)));
    /* the ceilings move with the choice, and stop at the hard ones */
    const c1 = P.sizeCeil(100, VH, VW, 1), cL = P.sizeCeil(100, VH, VW, 1.25), cX = P.sizeCeil(100, VH, VW, 3.2), cS = P.sizeCeil(100, VH, VW, 0.8);
    ck("A5 the ceilings at the default are the old ones (14 % of the view's height, 30 % of its width or three tokens)", Math.abs(c1.capH - VH * P.SIZE_RULE.capVh) < 1e-9 && Math.abs(c1.width - Math.max(300, P.SIZE_RULE.widthVw * VW)) < 1e-9);
    ck("A5 they move with the choice, both ways, and never past the hard ceilings", Math.abs(cL.capH / c1.capH - 1.25) < 1e-9 && Math.abs(cL.width / c1.width - 1.25) < 1e-9 && Math.abs(cS.capH / c1.capH - 0.8) < 1e-9
      && cX.capH <= VH * P.SIZE_TABLE.capVh + 1e-9 && cX.width <= P.SIZE_TABLE.widthVw * VW + 1e-9);
    /* the drawn box's limit moves alike: a word 2.1 caps tall drawn at its ceiling is not shrunk back to the old limit at "large" */
    const capL = P.sizeCeil(100, VH, VW, 1.25).capH;
    ck("A6 the drawn box's limit moves with the choice (a word at the large ceiling, 1.2 caps tall, is not shrunk back)", P.fitDrawn({ cap: capL, hbW: 3, hbH: 1.2, tokenPx: 100, vh: VH, vw: VW, u: 1.25 }) === 1
      && P.fitDrawn({ cap: capL, hbW: 3, hbH: 1.2, tokenPx: 100, vh: VH, vw: VW }) < 0.85);
    ck("A7 the defaults draw what they drew (u = 1: the old numbers)", Math.abs(P.targetPx("down", 1, "KA-THOOM!!", 100, VH, VW) - 480 / (0.85 * 7.5)) < 1e-6 && Math.abs(P.targetPx("hit", 0.3, "BAM!", 100, VH, VW) - 30 * 1.01 * (5 / 3) ** 0.35) < 1e-6);
  }
  const M = src("../tokenreact/main.mjs");
  ck("A8 the reactions read the table's size from the step and the lettering's table Size (no step table of their own, no ceiling beside sizeCeil)", /P\.tableSize\(get\(KEY\.size, "normal"\), tableScaleOf\(L\)\)/.test(M) && /L\?\.table\?\.scale/.test(M)
    && !/vh\(\) \* P\.SIZE_RULE\.capVh/.test(M) && /P\.sizeCeil\(tokPx, vh\(\), vw\(\), user\)/.test(M) && /u: user/.test(M) && /u: plan\.user/.test(M));
  /* A9: the legible floor (the scale's lower stop). Live (lane 5) a knock-down wanted 52 / 65 / 81 px at small / normal / large and the
     stop (0.2 of the engine's own ~400 px) drew all three at 80 px, in boxes planned for the three smaller sizes: "small" ended the
     biggest word, and every one stood bigger than the box the layout had judged */
  if (typeof P.stopPx === "function" && typeof P.wordScale === "function") {
    const nat = 401;
    const [fs, fm, fl] = ["small", "normal", "large"].map((st) => P.stepDrawK(st) * P.stopPx(nat, P.tableSize(st, 1)));
    ck(`A9 a word's legible floor is the table's size too: small ${fs.toFixed(1)} < normal ${fm.toFixed(1)} < large ${fl.toFixed(1)} px (0.8 / 1 / 1.25), the old 0.2 of the engine's size at the default`,
      Math.abs(fm - 0.2 * nat) < 1e-9 && Math.abs(fs / fm - 0.8) < 1e-9 && Math.abs(fl / fm - 1.25) < 1e-9 && P.stopPx(0, 1) === 0);
    ck("A9 a word is drawn at its planned size (not held over it where it is drawn); a number keeps the stop, moved with the table's size", P.wordScale(0.05, 1, false) === 0.05 && P.wordScale(0.05, 2, false) === 0.05
      && P.wordScale(0.05) === 0.2 && Math.abs(P.wordScale(0.05, 0.8) - 0.16) < 1e-9 && Math.abs(P.wordScale(0.05, 2) - 0.4) < 1e-9 && P.wordScale(20) === 8 && P.wordScale(0.37, 1.25) === 0.37);
  } else ck("A9 the legible floor moves with the table's size (pure stopPx, wordScale)", false);
  ck("A9 the reactions plan a word at its floor (under its ceiling) and scale it to the plan; numbers through the moved stop", /cap = Math\.min\(ceilH, Math\.max\(cap, P\.stopPx\(naturalPx\(L, lk\.word, wordOpts\), user\)\)\)/.test(M)
    && /scaleFor\(L, lk\.word, wordOpts, cap, user, false\)/.test(M) && /scaleFor\(L, nums\[i\]\.text, o, numCap, user, !word\)/.test(M) && /scaleFor\(L, nl\.text, o, [^;]*plan\.user \?\? 1, !plan\.text\)/.test(M) && !/Math\.max\(0\.2, Math\.min\(8/.test(M));
  /* A10: where room is short the bigger choice is never the smaller word. The live board: a 175 px token in the middle of the standard
     view (291 px over it), a zone's badge at its left, a token one square to its right, panels in the corners */
  {
    const std = { l: 96, t: 54, r: 1244, b: 802 }, tok = { x: 713, y: 363, w: 175, h: 175, id: "T" };
    const obs = [{ x: 1063, y: 363, w: 175, h: 175, kind: "tok", id: "N" }, { x: 363, y: 13, w: 175, h: 175, kind: "tok", id: "M" }, { x: 660, y: 374, w: 46, h: 46, kind: "pin", id: "z5" }, { x: 584, y: 635, w: 46, h: 46, kind: "pin", id: "z7" },
      { x: 0, y: 486, w: 340, h: 306, kind: "panel" }, { x: 936, y: 48, w: 310, h: 233, kind: "panel" }];
    const run = (cap, o = {}) => {
      const g = P.group({ cap, aspect: 5.2, tall: 1.6, nums: ["-7"], numCap: cap * P.SIZE_RULE.numK, side: 1, up: 0.4, down: 0.3 });
      const q = Lay.cleanSpot({ tok, own: tok, g, eb: { w: g.w * 1.05, h: g.h * 1.37 }, reach: null, sweep: null, ks: Lay.CLEAN.ks, minK: Math.min(1, Lay.CLEAN.minCap / cap), std, safe: std, panels: [], obs, tokPx: 175, first: null, ...o });
      return { px: cap * q.k, k: q.k, clean: q.clean, slot: q.slot };
    };
    const US = [0.5, 0.8, 1, 1.25, 1.6, 2, 2.5], tight = US.map((u) => run(65 * u)), ladder = US.map((u) => run(65 * u, { noRefine: true }));
    const line = (rs) => rs.map((r) => r.px.toFixed(1)).join(" / ");
    ck(`A10 no room for the planned size: every choice finds a clean place (${tight.map((r) => r.k.toFixed(2)).join(" / ")} of its plan)`, tight.every((r) => r.clean));
    const drops = tight.map((r, i) => (i ? r.px / tight[i - 1].px : 1)), dropsL = ladder.map((r, i) => (i ? r.px / ladder[i - 1].px : 1));
    ck(`A10 the bigger choice is never the smaller word (sizes 0.5 .. 2.5: ${line(tight)} px; on the bare ladder: ${line(ladder)})`, drops.every((d) => d >= 0.97), JSON.stringify(drops.map((d) => +d.toFixed(3))));
    const lim = tight.filter((r) => r.k < 0.999);
    ck(`A10 the choices well short of room all stand at one size, the room's (within 1 %)`, lim.length >= 3 && Math.max(...lim.slice(1).map((r) => r.px)) / Math.min(...lim.slice(1).map((r) => r.px)) <= 1.01, line(lim));
    ck("A10 never over the plan, and within 6 % of the old ladder's rung", tight.every((r, i) => r.k <= 1 + 1e-9 && r.px >= ladder[i].px * 0.94));
    /* a taller word (the knock-down's): on the bare ladder the biggest choice fell to 65 px where the others stood at 79-83 */
    const tall = (cap, o = {}) => { const g = P.group({ cap, aspect: 5.2, tall: 1.84, nums: ["-7"], numCap: cap * P.SIZE_RULE.numK, side: 1, up: 0.4, down: 0.3 });
      const q = Lay.cleanSpot({ tok, own: tok, g, eb: { w: g.w * 1.05, h: g.h * 1.6 }, reach: null, sweep: null, ks: Lay.CLEAN.ks, minK: Math.min(1, Lay.CLEAN.minCap / cap), std, safe: std, panels: [], obs, tokPx: 175, first: null, ...o }); return { px: cap * q.k, k: q.k, clean: q.clean }; };
    const tT = US.map((u) => tall(65 * u)), tL = US.map((u) => tall(65 * u, { noRefine: true }));
    ck(`A10 a taller word: ${line(tT)} px, the bigger choice never the smaller word (the bare ladder: ${line(tL)})`, tT.every((r, i) => r.clean && (!i || r.px >= tT[i - 1].px * 0.97)));
    ck("A10 (the bare ladder did drop a bigger choice under a smaller one there: the check has teeth)", tL.some((r, i) => i && r.px < tL[i - 1].px * 0.97), line(tL));
    /* room for all: a small word by the same token keeps its steps */
    const roomy = [0.8, 1, 1.25].map((u) => run(22 * u));
    ck(`A10 with room the steps are whole (${line(roomy)} px)`, roomy.every((r) => r.clean && r.k > 0.999) && roomy[2].px / roomy[1].px > 1.24 && roomy[0].px / roomy[1].px < 0.81);
    /* a size the table fixed is not passed (the equal blows' second pass, a seat's own search under the table's size) */
    const fixed = Lay.cleanSpot({ tok, own: tok, g: P.group({ cap: 130, aspect: 5.2, tall: 1.6, nums: ["-7"], numCap: 130 * P.SIZE_RULE.numK, side: 1, up: 0.4, down: 0.3 }), eb: null, reach: null, sweep: null, ks: [0.3, 0.2], minK: 0, std, safe: std, panels: [], obs, tokPx: 175, first: null });
    ck("A10 never over the sizes given (a size the table fixed)", fixed.k <= 0.3 + 1e-9, String(fixed.k));
  }
}

/* ---------------- B: seats ---------------- */
const seatFile = fileURLToPath(new URL("../tokenreact/check-crowd-seat.mjs", import.meta.url));
const seat = (cfg) => new Promise((res) => {
  const p = spawn(process.execPath, [seatFile, JSON.stringify(cfg)]);
  let out = "", err = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
  p.on("close", () => { const line = out.trim().split(/\r?\n/).filter((l) => l.startsWith("{")).pop(); try { res(JSON.parse(line)); } catch { console.log(`seat ${cfg.name} failed: ${err.slice(0, 400)}`); res(null); } });
});
const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const ringOf = (t) => ({ x: t.x - t.w * P.RING, y: t.y - t.h * P.RING, w: t.w * (1 + 2 * P.RING), h: t.h * (1 + 2 * P.RING) });
/* an open board: one hero in the middle of the view, nobody near (tokens 100 scene px at zoom 1.2 = 120 px) */
const OPEN = { zoom: 1.2, center: { x: 800, y: 450 }, toks: [{ id: "KD", x: 690, y: 420, hero: true, h: 9, hm: 9 }, { id: "FAR", x: 1150, y: 700, h: 6, hm: 6 }] };
/* a crowd: the hero with neighbours on three sides and one below-right (the review's Warehouse corner, closer) */
const CROWD = { zoom: 1.75, center: { x: 700, y: 300 }, toks: [{ id: "KD", x: 600, y: 250, hero: true, h: 9, hm: 9 }, { id: "A", x: 500, y: 250, h: 6, hm: 6 }, { id: "B", x: 700, y: 250, h: 6, hm: 6 }, { id: "C", x: 600, y: 350, h: 6, hm: 6 }, { id: "E", x: 700, y: 350, h: 6, hm: 6 }] };
/* every track's kinds: knock-down, get-up, a hit, a heavy hit, healing, stress, Resolve out, Resolve back */
const EVENTS = {
  down: [{ t: 0, id: "KD", to: 0 }],
  up: [{ t: 0, id: "KD", to: 0 }, { t: 2600, id: "KD", to: 9 }],
  hit: [{ t: 0, id: "KD", to: 8 }],
  heavy: [{ t: 0, id: "KD", to: 4 }],
  heal: [{ t: 0, id: "KD", to: 4 }, { t: 2600, id: "KD", to: 8 }],
  stress: [{ t: 0, id: "KD", stat: "resolve", to: 4 }],
  out: [{ t: 0, id: "KD", stat: "resolve", to: 0 }],
  steady: [{ t: 0, id: "KD", stat: "resolve", to: 0 }, { t: 2600, id: "KD", stat: "resolve", to: 6 }]
};
const SEATS = [{ name: "gm", gm: true, W: 1600, H: 900, side: 40 }, { name: "p1", W: 1600, H: 900, side: 40 }];
const CHOICES = { small: { size: "small" }, normal: {}, large: { size: "large" }, half: { letterScale: 0.5 }, twice: { letterScale: 2 }, most: { size: "large", letterScale: 2.5 }, old: { letterScale: 2, oldEngine: true } };
const jobs = [];
/* (the same two boards with a louder stand-in engine: the legible floor then holds the knock-down and Resolve-out words, as on a live
   1600 x 900 seat, where the review's word stood) */
for (const [bk, bd] of [["open", OPEN], ["crowd", CROWD], ["openLoud", { ...OPEN, loudK: 5 }], ["crowdLoud", { ...CROWD, loudK: 5 }]]) for (const [ek, hits] of Object.entries(EVENTS)) for (const [ck2, ch] of Object.entries(CHOICES)) for (const st of SEATS) {
  if (bk === "crowd" && !["down", "hit", "out"].includes(ek)) continue;
  if (bk.endsWith("Loud") && (!["down", "out"].includes(ek) || ck2 === "old")) continue;
  if (ck2 === "old" && ek !== "down") continue;
  const late = hits.length > 1;
  jobs.push(seat({ ...bd, ...st, ...ch, hits, wait: late ? 4000 : 1300, name: `${bk}/${ek}/${ck2}/${st.name}` }).then((r) => [bk, ek, ck2, st.name, r, late]));
}
const R = {};
for (const [bk, ek, c, sn, r, late] of await Promise.all(jobs)) {
  const key = `${bk}/${ek}`;
  if (!r) { ck(`${key}/${c}/${sn}: the seat ran`, false); continue; }
  const ps = r.plays.filter((p) => p.box && (!late || p.t >= 2600)), word = ps.find((p) => !p.num), num = ps.find((p) => p.num);
  ((R[key] ??= {})[c] ??= {})[sn] = { r, ps, word, num };
}
for (const [key, by] of Object.entries(R)) {
  const open = key.startsWith("open/");
  const cap = (c, sn = "gm") => by[c]?.[sn]?.word?.cap ?? 0, ncap = (c, sn = "gm") => by[c]?.[sn]?.num?.cap ?? 0;
  for (const c of Object.keys(by)) {
    const g = by[c].gm, p = by[c].p1;
    ck(`${key}/${c}: both seats letter the word`, !!g?.word && !!p?.word, JSON.stringify([g?.ps, p?.ps]));
    if (!g?.word || !p?.word) continue;
    ck(`${key}/${c}: the GM and the player draw the word at one size and place (${g.word.cap} px)`, g.word.cap === p.word.cap && JSON.stringify(g.word.box) === JSON.stringify(p.word.box), `${JSON.stringify(g.word)} | ${JSON.stringify(p.word)}`);
    /* REACTPLACE at every size: by its token, on no other token, inside the standard view */
    for (const [sn, s] of [["gm", g], ["p1", p]]) {
      const tk = (id) => s.r.toks.find((t) => t.id === id), own = tk(s.word.tok);
      const box = { x: Math.min(...s.ps.map((q) => q.box.x)), y: Math.min(...s.ps.map((q) => q.box.y)) }; box.w = Math.max(...s.ps.map((q) => q.box.x + q.box.w)) - box.x; box.h = Math.max(...s.ps.map((q) => q.box.y + q.box.h)) - box.y;
      ck(`${key}/${c}/${sn}: the lettering stands by its token (${Lay.claim(box, own).toFixed(2)} token sizes from its centre)`, Lay.claim(box, own) <= Lay.TETHER.max + 0.02, JSON.stringify(s.ps.map((q) => [q.text, q.box])));
      const on = []; for (const q of s.ps) for (const t of s.r.toks) { if (t.id === own.id && !open) continue; const a = inter(q.box, ringOf(t)), lim = 0.03 * ringOf(t).w * ringOf(t).h; if (a > lim) on.push(`${q.text} on ${t.id} ${Math.round(a)} px2`); }
      /* (a hero ringed on every side letters over ITS OWN token: REACTPLACE-2; never on a neighbour) */
      ck(`${key}/${c}/${sn}: no word or number lies on ${open ? "a" : "another"} token`, !on.length, on.join("; "));
      const tol = Math.max(6, 0.1 * s.word.cap);      // a knock's travel and the stand-in engine's rounding, in shares of the cap height (6 px at the default size)
      ck(`${key}/${c}/${sn}: inside the standard view`, box.x >= 96 - tol && box.x + box.w <= 1244 + tol && box.y >= 54 - tol && box.y + box.h <= 802 + tol, JSON.stringify(box));
      ck(`${key}/${c}/${sn}: never over the hard ceiling (${s.word.cap} px cap height)`, s.word.cap <= VH * (P.SIZE_TABLE?.capVh ?? 0.3) + 0.5);
    }
  }
  if (open) {
    /* where there is room, a step is a step: the word AND its number */
    ck(`${key}: on an open board small ${cap("small")} < normal ${cap("normal")} < large ${cap("large")} px (each step at least 18 %)`, cap("large") >= cap("normal") * 1.18 && cap("small") <= cap("normal") * 0.85, "");
    if (ncap("normal")) ck(`${key}: its number steps with it (${ncap("small")} < ${ncap("normal")} < ${ncap("large")} px)`, ncap("large") >= ncap("normal") * 1.18 && ncap("small") <= ncap("normal") * 0.85);
    ck(`${key}: the lettering's Size 0.5 / 1 / 2 draws ${cap("half")} < ${cap("normal")} < ${cap("twice")} px (halved, and at least 1.5x where the view holds it)`, cap("half") <= cap("normal") * 0.6 && cap("twice") >= cap("normal") * 1.5);
    ck(`${key}: the biggest choice (large x 2.5) is the biggest drawn (${cap("most")} px) and still whole in the view`, cap("most") >= cap("twice") * 0.9);      // (both stand at the hard ceilings; the place search steps in shares of the planned size)
    if (by.old) ck(`${key}: an older engine's own Size (each screen's) is not counted: the word as at the default (${cap("old")} px)`, Math.abs(cap("old") - cap("normal")) < 0.6);
  } else {
    /* in a crowd the room decides: a bigger choice is never drawn smaller, the smallest is smaller than the biggest */
    ck(`${key}: in a crowd "small" is drawn at 0.8 of "normal" in the same spot (${cap("small")} / ${cap("normal")} px): never dead where room is short`, Math.abs(cap("small") / cap("normal") - P.stepDrawK("small")) < 0.02);
    ck(`${key}: in a crowd small ${cap("small")} <= normal ${cap("normal")} <= large ${cap("large")} px, and small < large`, cap("small") <= cap("normal") + 0.5 && cap("normal") <= cap("large") + 0.5 && cap("small") < cap("large") - 2);
    ck(`${key}: in a crowd the lettering's Size 0.5 <= 1 <= 2 (${cap("half")} / ${cap("normal")} / ${cap("twice")} px), and half < twice`, cap("half") <= cap("normal") + 0.5 && cap("normal") <= cap("twice") + 0.5 && cap("half") < cap("twice") - 2);
  }
}

/* ---------------- C: the roll splash ---------------- */
{
  const SS = await import("./lib/splash-seat.mjs");
  const word = (r) => r.drawn.find((d) => d.role === "word") ?? r.drawn[0];
  const sig = (r) => r.drawn.map((d) => `${d.role}:${d.text}@${Math.round(d.x)},${Math.round(d.y)}/${d.S}`).join(" | ");
  for (const layer of ["screen", "overlay"]) for (const outcome of ["ordinary", "strong", "miss", "critical"]) {
    const S = {};
    for (const sc of [0.6, 1, 1.5]) S[sc] = await SS.seatPlay({ seat: "far" === layer ? "far" : { name: "ref", W: 1600, H: 900, zoom: 0.5, ui: { side: 300 } }, layer, bd: "empty", outcome, scale: sc, seedTag: `SZ-${layer}-${outcome}` });
    const [a, b, c] = [0.6, 1, 1.5].map((k) => word(S[k])?.S ?? 0);
    const onLayer = layer === "screen" ? S[1].drawn.every((d) => !d.world) : S[1].drawn.every((d) => d.world);
    ck(`C1 ${layer} ${outcome}: the moment is on its layer at the default`, S[1].drawn.length > 0 && onLayer, sig(S[1]));
    /* a critical fills its room at the default already: bigger only where the window holds it, never smaller */
    const need = outcome === "critical" ? 1 : 1.25;
    ck(`C2 ${layer} ${outcome}: the splash's Size 0.6 / 1 / 1.5 draws its word ${a} < ${b} ${need > 1 ? "<" : "<="} ${c} px`, a <= b * 0.75 && c >= b * need - 0.05, `${sig(S[0.6])}\n   ${sig(S[1])}\n   ${sig(S[1.5])}`);
    const info = (r) => r.drawn.filter((d) => d.role !== "word").map((d) => d.S), i06 = info(S[0.6]), i1 = info(S[1]);
    ck(`C3 ${layer} ${outcome}: the other lines of the block step with it (none bigger at 0.6 than at 1)`, i06.length === i1.length && i06.every((v, i) => v <= i1[i] + 0.05), JSON.stringify([i06, i1]));
  }
  /* two seats, one view: the same block at a chosen size, on the map layer and on the screen layer */
  for (const layer of ["screen", "overlay"]) {
    const g = await SS.seatPlay({ seat: { name: "g", gm: true, W: 1600, H: 900, zoom: 0.5, ui: { side: 300 } }, layer, bd: "warehouse", outcome: "strong", scale: 1.4, seedTag: `SZ2-${layer}` });
    const p = await SS.seatPlay({ seat: { name: "p", W: 1600, H: 900, zoom: 0.5, ui: { side: 300 } }, layer, bd: "warehouse", outcome: "strong", scale: 1.4, seedTag: `SZ2-${layer}` });
    ck(`C4 ${layer}: at Size 1.4 the GM and the player (one view) draw the same block`, sig(g) === sig(p) && g.drawn.length > 0, `${sig(g)}\n   ${sig(p)}`);
  }
  /* the lettering's Size reaches the splash through main.mjs scaleK (Stage.lettersScale: the TABLE's, never an older engine's per-screen one) */
  const Stage = await import("../splash/stage.mjs?sizedead");
  Stage.setLetters({ prefs: { scale: 2 }, table: { scale: 2 }, setTable: async () => true });
  const t2 = Stage.lettersScale?.();
  Stage.setLetters({ prefs: { scale: 2 } });
  const o2 = Stage.lettersScale?.();
  Stage.setLetters(null);
  ck("C5 the stage tells the lettering's table Size (2), an older engine's own Size counts as 1, no engine as 1", t2 === 2 && o2 === 1 && Stage.lettersScale?.() === 1);
  const Mn = src("../splash/main.mjs");
  ck("C6 the lettered moment's size is the splash's Size x the lettering's Size", /cs\('tableScale'\) \* Stage\.lettersScale\(\)/.test(Mn));
  const St = src("../splash/stage.mjs");
  ck("C7 the map layer's frame and stage take the table's Size (no fixed 1 there)", !/userScale: shared \? 1/.test(St) && !/\{ \.\.\.sf, scale: 1,/.test(St));
}

/* ---------------- D: the window's size rows ---------------- */
{
  /* every row of the table's window whose key names a size or a scale, and the code that reads it: a new row must be added here with
     its own proof that it changes the picture (this list is the audit of 2026-11-16, measured live on both seats) */
  const PROVEN = {
    "letters.scale": ["../tokenreact/main.mjs", /L\?\.table\?\.scale/],
    "splash.tableScale": ["../splash/main.mjs", /cs\('tableScale'\)/],
    "splash.scale": ["../splash/main.mjs", /cs\('scale'\)/],
    "reactions.size": ["../tokenreact/main.mjs", /get\(KEY\.size, "normal"\)/],
    "halo.size": ["../tokenhalo/main.mjs", /tokenHaloSize/],
    "combat.bannerSize": ["../combat/main.mjs", /combatBannerSize/],
    "combat.barSize": ["../combat/bar.mjs", /combatBarSize/],
    "combat.uiScale": ["../tactics/ui/main.mjs", /tacticsUiScale/],
    "panels.challengesScale": ["../challenges/main.mjs", /challengesScale/],
    "panels.partySize": ["../party/main.mjs", /partySize/]
  };
  const rows = D.ROWS.filter((r) => /size|scale/i.test(`${r.id} ${r.key}`)).map((r) => r.id);
  ck(`D1 every size / scale row of the window is on the proven list (${rows.length} rows)`, rows.every((id) => id in PROVEN) && Object.keys(PROVEN).every((id) => rows.includes(id)), JSON.stringify([rows.filter((id) => !(id in PROVEN)), Object.keys(PROVEN).filter((id) => !rows.includes(id))]));
  for (const [id, [file, re]] of Object.entries(PROVEN)) { let ok = false; try { ok = re.test(src(file)); } catch { ok = false; } ck(`D2 ${id}: its area reads it (${file.replace("../", "")})`, ok); }
}
console.log(`sweep sizedead: ${n} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
