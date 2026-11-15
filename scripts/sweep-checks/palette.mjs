/* node scripts/sweep-checks/palette.mjs -- PALETTE (2026-11-15): the colours of the module's lettering (dice-roll splash, token reactions).
   The owner's ruling: the letterings the table sees most often must not be pink (a strong fist-fight word was). Every colour below is read
   from the REAL engine's plan of each lettering (scripts/letters/testenv.mjs: the engine with its fonts in node, the invincible look the
   table letters in, the engine's own palette filter for the table's palette), never from our tables: what the table would see.
   The colour measures are this file's own (OKLCH, WCAG contrast, Machado 2009 colour-vision simulation), independent of letter-colors.mjs.
     N  how often each result happens: the module's rarity code over a pool mix, the frequent set (>= 1 % of rolls, and every reaction of a
        fight), stated;
     P  pink / magenta (OKLCH hue 290..360 or 0..15, chroma >= 0.04, lightness >= 0.3): none in the frequent set, none anywhere, in each of
        the table's three palettes (the painted face, the duplicate block, the keyline, the rim; a hollow face's rim colour; a number's
        gradient stops);
     R  ranks read in order: heat index H = heat of the face (yellow / white / cold 0 -> orange 1 -> red 2 by OKLCH hue 90 -> 55 -> 27) +1
        when the block is lighter than the face (the critical's gold block); per family max H(ordinary) <= min H(strong) < min H(critical);
     G  readable on dark, mid, bright and fire-lit ground: max(contrast(face, ground), contrast(keyline, ground)) >= 3 and the face apart from
        its own keyline (>= 3); on high contrast every face >= 7:1 on the black keyline;
     V  told apart where colour does the job (the word and its sixes, strong and critical, Health and Resolve, the tracks' numbers, a miss
        and a blow): OKLab distance >= 0.08 for normal vision in every palette and, on the colour-blind palette, also for protan, deutan and
        tritan viewers;
     X  standing rulings: sixes gold, stress blood red (mood palette), a critical's own colours on every seat (no seat state enters);
     S  colour only: the moment's items with their colours taken out are equal in all three palettes; the hand a climb carries holds a
        pal and nothing else of its own;
     W  wiring: the table's palette hook switches the colours; the token reaction passes its pinned block; the token tint follows. */
import fs from "node:fs";
import { ok, eq, done, summary } from "../tactics/testkit.mjs";

globalThis.__letrRealST = (f) => setImmediate(f);
/* W needs the table's hook: a fake Hooks BEFORE the colour table is imported (it registers on import) */
const hooks = {};
globalThis.Hooks = { on: (n, f) => (hooks[n] ??= []).push(f), once: () => {} };
let LC = null;
try { LC = await import("../letter-colors.mjs"); } catch { LC = null; }
delete globalThis.Hooks;
const SL = await import("../splash/logic.mjs");
const LP = await import("../splash/letter-plan.mjs");
const TP = await import("../tokenreact/pure.mjs");
const TA = await import("../tokenanim/pure.mjs");
const Prefs = await import("../letters/prefs.mjs");
const Dz = await import("../letters/design.mjs");
const { setup } = await import("../letters/testenv.mjs");
const savedT = { st: globalThis.setTimeout, ct: globalThis.clearTimeout, perf: globalThis.performance };
const L = (await setup()).engine;
L.lookStyle("invincible");
const src = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

/* ---------------- measures (own) */
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => lin(v / 255)); };
const lab = ([r, g, b]) => { const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]; };
const lch = (hex) => { const [Lq, a, b] = lab(rgb(hex)); return { L: Lq, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 }; };
const HEX = /^#[0-9a-f]{6}$/i;
const PINK = { from: 290, to: 15, minC: 0.04, minL: 0.3 };
const pink = (hex) => { if (!HEX.test(hex ?? "")) return false; const o = lch(hex); return o.C >= PINK.minC && o.L >= PINK.minL && (o.h >= PINK.from || o.h < PINK.to); };
const lum = (hex) => { const [r, g, b] = rgb(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const M = { protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]] };
const seen = (hex, v) => { const c = rgb(hex); return M[v] ? M[v].map((r) => Math.min(1, Math.max(0, r[0] * c[0] + r[1] * c[1] + r[2] * c[2]))) : c; };
const dE = (a, b, v = "normal") => { const p = lab(seen(a, v)), q = lab(seen(b, v)); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
const heat = (hex) => { const o = lch(hex); if (o.C < 0.1 || o.h > 100) return 0; return Math.max(0, Math.min(2, o.h >= 55 ? (90 - o.h) / 35 : 1 + (55 - o.h) / 28)); };
const GROUND = { dark: "#16171d", mid: "#7a7a7a", bright: "#ece8dc", fire: "#e2701f" };

/* ---------------- the letterings, through the engine */
function painted(text, o, palette) {
  const plan = L._plan(LP.letterable(text), o);
  Prefs.filterPlan(plan, o, { prefs: { palette, flashes: true, motion: "auto" }, colors: Dz.COLORS });
  const H = plan.hand;
  const grad = !["flat", "hollow"].includes(H.fill);
  const face = H.fill === "hollow" ? H.pal.fill[1] : H.pal.fill[1];   // the flat face, a hollow word's rim, a gradient's middle
  const all = [H.fill === "hollow" ? (H.hollowPaper ?? "#fffdf2") : null, ...(grad ? H.pal.fill : [H.pal.fill[1]]), (H.depth ?? 0) > 0 ? H.pal.ext : null, H.ink, H.outline === "sticker" ? H.pal.out2 : null].filter(Boolean);
  return { face, paper: H.fill === "hollow" ? (H.hollowPaper ?? "#fffdf2") : null, ext: (H.depth ?? 0) > 0 ? H.pal.ext : null, ink: H.ink, all, fill: H.fill };
}
const engineOpts = (it, seed) => {   // stage.mjs engineOpts: the colour fields as the stage passes them
  const o = { mood: it.mood, sound: it.sound, hold: it.hold, rotation: it.rotation || 0, reduced: false, magnitude: it.magnitude, seed: LP.seedOf(seed, it.role), avoid: [], anchor: "center" };
  if (Number.isFinite(it.from)) o.from = it.from;
  if (it.colors) o.colors = it.colors.slice();
  if (it.hand) o.hand = { ...it.hand };
  for (const k of ["in", "out", "holdKind"]) if (it[k]) o[k] = it[k];
  if (it.kind) o.kind = it.kind;
  return o;
};
const evOf = (rd, w) => { const ev = SL.buildEvent({ newSixes: 0, rerolled: 0, pushed: false, stress: 0, ...rd }, { rng: () => 0.3, st: null, dryN: 0 }); if (w) ev.word = w; return ev; };
const GRID = [[5, 1], [5, 2], [6, 3], [5, 3], [8, 4], [4, 3], [5, 4]];   // P 0, 0.19, 0.43, 0.55, 0.58, 0.71, 1
const vocab = { word: (k, o) => L.word(k, o), series: L.series ? (k, n, o) => L.series(k, n, o) : undefined };
const cls = (P) => (P >= 0.7 ? "critical" : P >= 0.4 ? "strong" : "ordinary");
function collect(palette) {
  LC?.usePalette?.(palette);
  const rows = [];
  const moment = (ev, o, tag) => {
    const m = LP.planMoment(ev, o);
    for (const it of m.items) rows.push({ tag, role: it.role, text: it.text, P: ev.power, family: ev.action, npc: !!ev.npc, ...painted(it.text, engineOpts(it, `pal:${tag}:${ev.word}`), palette) });
    return m;
  };
  for (const fam of Object.keys(SL.FAMILIES)) {
    for (const [n, k] of GRID) {
      const ev0 = evOf({ n, sixes: k, action: fam });
      for (const w of SL.poolFor(fam, ev0.power)) for (const npc of [false, true])
        moment({ ...ev0, word: w, npc, wreckWord: ["slugfest", "charge", "force"].includes(fam) && k >= 3 ? "WRECK!" : null }, { token: true, full: ev0.power >= 0.7, npc }, "success");
    }
    for (const w of SL.missFor(fam)) { moment(evOf({ n: 4, sixes: 0, action: fam }, w), { token: true }, "miss"); moment(evOf({ n: 10, sixes: 0, action: fam }, w), { token: true }, "miss"); }
  }
  for (const w of SL.SOFTFAIL) moment(evOf({ n: 2, sixes: 0, action: "generic" }, w), { token: true }, "soft");
  for (const w of SL.PUSHFAIL) moment({ ...evOf({ n: 4, sixes: 0, pushed: true, rerolled: 3, action: "slugfest" }, w), prefix: "PUSH!" }, { token: true }, "push");
  for (const w of SL.PUSHPRE) moment({ ...evOf({ n: 5, sixes: 2, pushed: true, newSixes: 1, rerolled: 3, action: "slugfest" }), prefix: w }, { token: true }, "push");
  for (const s of [1, 3]) { const it = LP.planStress(s, {}); rows.push({ tag: "stress", role: "stress", text: it.text, ...painted(it.text, engineOpts(it, "pal:stress"), palette) }); }
  for (const kind of Object.keys(TP.MOTION)) for (const amt of [0.2, 0.8]) {
    const lk = TP.look({ kind, num: 3, exact: true, amt }, { n: 3 }, "en", `pal:${kind}:${amt}`, vocab);
    if (!lk) continue;
    if (lk.word) rows.push({ tag: `token:${kind}`, role: "word", text: lk.word, ...painted(lk.word, { space: "world", anchor: "center", fit: "screen", mood: lk.mood, sound: lk.sound, magnitude: lk.magnitude, seed: `pal:${kind}`, hold: lk.hold, rotation: lk.rotation, colors: lk.colors, ...(lk.hand ? { hand: lk.hand } : {}), ...lk.motion }, palette) });
    for (const n of lk.numbers ?? []) rows.push({ tag: `token:${kind}`, role: `number${n.sign}${n.stat}`, text: n.text, ...painted(n.text, { space: "world", anchor: "center", fit: "screen", mood: n.mood, sound: n.sound, hand: n.hand, colors: n.colors, seed: `pal:${kind}#n`, in: n.in, holdKind: "boil", out: n.out }, palette) });
  }
  return rows;
}
const ROWS = {};
for (const p of ["mood", "contrast", "cvd"]) ROWS[p] = collect(p);
LC?.usePalette?.("mood");

/* ---------------- N: how often (the module's own rarity code; pool mix assumed from the character ranks' attribute budgets) */
const MIX = { 2: 0.05, 3: 0.10, 4: 0.18, 5: 0.22, 6: 0.18, 7: 0.12, 8: 0.08, 9: 0.04, 10: 0.03 };
const share = {};
for (const [nS, w] of Object.entries(MIX)) for (let k = 0; k <= +nS; k++) {
  const ev = evOf({ n: +nS, sixes: k, action: "slugfest" });
  const c = ev.fail ? (ev.softFail ? "soft" : "miss") : ev.power >= 0.7 ? "critical" : ev.power >= 0.4 ? "climb" : ev.power >= 0.1 ? "strongMood" : "ordinary";
  share[c] = (share[c] ?? 0) + SL.pk(+nS, k, 1 / 6) * w;
}
const pct = Object.fromEntries(Object.entries(share).map(([k, v]) => [k, Math.round(v * 1000) / 10]));
console.log(`palette N: first rolls by class (%): ${JSON.stringify(pct)}`);
ok(Math.abs(Object.values(share).reduce((a, b) => a + b, 0) - 1) < 1e-9, "N: the classes cover every first roll");
ok(share.ordinary + share.strongMood + share.miss + share.soft > 0.95, `N: ordinary results and misses are the frequent ones (${(100 * (share.ordinary + share.strongMood + share.miss + share.soft)).toFixed(1)} % of first rolls)`);
ok(share.climb > 0.01 && share.critical < 0.01, `N: a climbing roll is about 1 in 40 (${pct.climb} %), a critical under 1 in 100 (${pct.critical} %)`);
const FREQ = new Set(Object.entries(share).filter(([, v]) => v >= 0.01).map(([k]) => k));
const classOf = (r) => (r.tag === "success" ? (r.P >= 0.7 ? "critical" : r.P >= 0.4 ? "climb" : r.P >= 0.1 ? "strongMood" : "ordinary") : r.tag === "miss" ? "miss" : r.tag === "soft" ? "soft" : r.tag);
const FIGHT = new Set(["token:hit", "token:heavy", "token:stress", "token:spent", "token:heal", "token:down", "stress", "push"]);   // every fight has them
const frequent = (r) => FREQ.has(classOf(r)) || FIGHT.has(r.tag);

/* ---------------- P: no pink */
for (const [p, rows] of Object.entries(ROWS)) {
  const fr = rows.filter(frequent), badF = fr.filter((r) => r.all.some(pink)), bad = rows.filter((r) => r.all.some(pink));
  ok(fr.length > 500, `P ${p}: the frequent set is measured (${fr.length} letterings)`);
  ok(badF.length === 0, `P ${p}: no pink or magenta in the frequent set (OKLCH hue ${PINK.from}..360 / 0..${PINK.to}, C >= ${PINK.minC}, L >= ${PINK.minL})${badF.length ? `: ${badF.slice(0, 4).map((r) => `${r.tag}/${r.role} ${r.text} ${r.all.filter(pink)}`).join("; ")}` : ""}`);
  ok(bad.length === 0, `P ${p}: none in any lettering either, rare ones included${bad.length ? `: ${[...new Set(bad.map((r) => `${r.tag}/${r.role}`))].slice(0, 6).join(", ")}` : ""}`);
}
ok(pink("#d1a3ff") && pink("#ff4fae") && pink("#ffa3ad") && !pink("#ec2a2b") && !pink("#ff3b52") && !pink("#8a7bff") && !pink("#2b0c5a"), "P: the range catches the old lilac, hot pink and rose, not red, blood red, indigo or a near-black block");
ok(Object.values(TA.TINTS).every((c) => !pink("#" + c.toString(16).padStart(6, "0"))), "P: the token picture's tints carry no pink either");

/* ---------------- R: ranks in order (hero successes, per family, every palette) */
for (const [p, rows] of Object.entries(ROWS)) {
  const H = (r) => heat(r.face) + (r.ext && lum(r.ext) > lum(r.face) ? 1 : 0);
  let bad = [];
  for (const fam of Object.keys(SL.FAMILIES)) {
    const w = rows.filter((r) => r.tag === "success" && r.role === "word" && !r.npc && r.family === fam);
    const by = (c) => w.filter((r) => cls(r.P) === c).map(H);
    const o = Math.max(...by("ordinary")), s = Math.min(...by("strong")), sx = Math.max(...by("strong")), c = Math.min(...by("critical"));
    if (!(o <= s + 1e-9 && sx < c)) bad.push(`${fam} ord ${o.toFixed(2)} strong ${s.toFixed(2)}..${sx.toFixed(2)} crit ${c.toFixed(2)}`);
  }
  ok(bad.length === 0, `R ${p}: per family max heat(ordinary) <= min heat(strong) < min heat(critical)${bad.length ? ": " + bad.slice(0, 4).join("; ") : ""}`);
  /* the heroes' climb is one ladder: from P 0.4 the heat never falls with P */
  const clim = rows.filter((r) => r.tag === "success" && r.role === "word" && !r.npc && r.P >= 0.4 && r.family === "slugfest").sort((a, b) => a.P - b.P);
  ok(clim.length > 4 && clim.every((r, i) => i === 0 || H(r) >= H(clim[i - 1]) - 1e-9), `R ${p}: a fist fight's word heats up with the roll (${clim.map((r) => H(r).toFixed(1)).join(" ")})`);
}

/* ---------------- G: grounds */
for (const [p, rows] of Object.entries(ROWS)) {
  const bad = [];
  for (const r of rows) {
    const face = r.paper ?? r.face;
    if (p === "contrast") { if (cr(face, "#000000") < 7) bad.push(`${r.tag}/${r.role} ${face} ${cr(face, "#000000").toFixed(1)}:1 on black`); continue; }
    for (const [g, gc] of Object.entries(GROUND)) if (Math.max(cr(face, gc), cr(r.ink, gc)) < 3) bad.push(`${r.tag}/${r.role} ${face} on ${g}`);
    if (cr(face, r.ink) < 3) bad.push(`${r.tag}/${r.role} ${face} on its keyline ${r.ink} ${cr(face, r.ink).toFixed(1)}:1`);
  }
  ok(bad.length === 0, `G ${p}: every face reads on dark, mid, bright and fire-lit ground (itself or its keyline >= 3:1) and apart from its keyline${p === "contrast" ? " (high contrast: >= 7:1 on the black keyline)" : ""}${bad.length ? ": " + [...new Set(bad)].slice(0, 5).join("; ") : ""}`);
}

/* ---------------- V: told apart */
const one = (rows, f) => rows.find(f)?.face;
for (const [p, rows] of Object.entries(ROWS)) {
  const W = (fam, P0, P1) => one(rows, (r) => r.tag === "success" && r.role === "word" && !r.npc && r.family === fam && r.P >= P0 && r.P < P1 && r.fill !== "hollow");
  const T = (k, role = "word") => one(rows, (r) => r.tag === `token:${k}` && r.role === role);
  const pairs = [
    ["strong word", W("slugfest", 0.4, 0.7), "critical word", W("slugfest", 0.7, 2)],
    ["strong word", W("slugfest", 0.4, 0.7), "sixes", one(rows, (r) => r.role === "six")],
    ["critical word", W("slugfest", 0.7, 2), "sixes", one(rows, (r) => r.role === "six")],
    ["ordinary blow", W("slugfest", 0, 0.4), "miss", one(rows, (r) => r.tag === "miss" && r.role === "word")],
    ["sixes", one(rows, (r) => r.role === "six"), "stress", one(rows, (r) => r.role === "stress")],
    ["hit", T("hit"), "Resolve loss", T("stress")], ["hit", T("hit"), "heal", T("heal")], ["heal", T("heal"), "Resolve loss", T("stress")],
    ["knock-down", T("down"), "Resolve loss", T("stress")], ["knock-down", T("down"), "hit", T("hit")], ["broken", T("out"), "Resolve loss", T("stress")],
    ["heal", T("heal"), "steady", T("steady")], ["hit", T("hit"), "steady", T("steady")],
    ["-Health", T("hit", "number-health"), "-Resolve", T("stress", "number-resolve")], ["+Health", T("heal", "number+health"), "+Resolve", T("steady", "number+resolve")],
    ["-Health", T("hit", "number-health"), "+Health", T("heal", "number+health")], ["-Resolve", T("stress", "number-resolve"), "+Resolve", T("steady", "number+resolve")]
  ];
  for (const v of p === "cvd" ? ["normal", "protan", "deutan", "tritan"] : ["normal"]) {
    const bad = pairs.filter(([, a, , b]) => !(a && b) || dE(a, b, v) < 0.08).map(([na, a, nb, b]) => `${na} ${a} / ${nb} ${b}: ${a && b ? dE(a, b, v).toFixed(3) : "missing"}`);
    ok(bad.length === 0, `V ${p} ${v}: the colours that tell things apart stay apart (OKLab >= 0.08)${bad.length ? ": " + bad.slice(0, 4).join("; ") : ""}`);
  }
}

/* ---------------- X: standing rulings */
{
  const rows = ROWS.mood;
  ok(rows.filter((r) => r.role === "six").every((r) => r.face === "#ffd23f"), "X: sixes always gold");
  ok(rows.filter((r) => r.role === "stress").every((r) => r.face === "#ff3b52"), "X: the stress number blood red");
  ok(rows.filter((r) => r.tag === "token:stress" && r.role === "word").every((r) => { const o = lch(r.face); return o.h >= 15 && o.h < 35 && o.C > 0.15; }), "X: a Resolve loss on a token is lettered in that blood red too");
}

/* ---------------- S: colour only */
{
  const strip = (m) => m.items.map(({ colors, hand, ...it }) => ({ ...it, hand: hand ? Object.keys(hand).filter((k) => k !== "pal").sort().map((k) => [k, hand[k]]) : null }));
  let same = 0, n = 0;
  for (const [nn, k] of GRID) for (const fam of ["slugfest", "zap", "force", "heal"]) {
    const ev = evOf({ n: nn, sixes: k, action: fam });
    const plans = ["mood", "contrast", "cvd"].map((p) => { LC?.usePalette?.(p); return JSON.stringify(strip(LP.planMoment(ev, { token: true, full: ev.power >= 0.7 }))); });
    n++; if (plans.every((x) => x === plans[0])) same++;
  }
  LC?.usePalette?.("mood");
  ok(n > 20 && same === n, `S: the table's palette changes colours only: words, sizes, instants, motion equal (${same} of ${n})`);
  const crit = LP.planMoment(evOf({ n: 4, sixes: 3, action: "slugfest" }), { token: true, full: true }).items.find((it) => it.role === "word");
  ok(crit.hand && Object.keys(crit.hand).every((k) => k === "pal" || k === "number") && HEX.test(crit.hand.pal?.ext ?? ""), "S: the climb's hand carries its block (pal) and nothing else of its own");
}

/* ---------------- W: wiring */
ok(!!LC, "W: the colour table loads");
if (LC) {
  ok((hooks.moinenLettersTable ?? []).length === 1, "W: it follows the engine's table hook");
  const ev = evOf({ n: 4, sixes: 3, action: "slugfest" });
  const face = () => LP.planMoment(ev, { token: true, full: true }).items.find((it) => it.role === "word").colors[1];
  const a = face(); hooks.moinenLettersTable[0]({ palette: "cvd" }, {}); const b = face(); hooks.moinenLettersTable[0]({ palette: "mood" }, {}); const c = face();
  ok(a !== b && a === c, `W: the table switching to colour-blind safe re-colours the next moment (${a} -> ${b} -> ${c})`);
  ok(LC.paletteNow() === "mood", "W: back on the table's own palette");
  ok(Object.entries(LC.TINT).every(([k, v]) => TA.TINTS[k] === v), "W: the token tint uses the words' families");
}
ok(/colors: lk\.colors, \.\.\.\(lk\.hand \? \{ hand: lk\.hand \} : \{\}\)/.test(src("../tokenreact/main.mjs")), "W: the token reaction passes the word's pinned block to the engine");
ok(/if \(it\.hand\) o\.hand = \{ \.\.\.it\.hand \}/.test(src("../splash/stage.mjs")), "W: the stage passes the item's hand (the climb's block) to the engine");

globalThis.setTimeout = savedT.st; globalThis.clearTimeout = savedT.ct; globalThis.performance = savedT.perf;
done("palette");
const sm = summary();
console.log(`sweep palette: ${sm.checks} checks, ${sm.failed} failed`);
process.exit(sm.failed ? 1 : 0);
