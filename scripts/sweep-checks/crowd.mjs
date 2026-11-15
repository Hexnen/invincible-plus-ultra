// CROWD: crowds and rapid series of token reactions (ADVX 8, 6 caller half, 12, 14, 17). Pure rules (tokenreact/pure.mjs crowdUnits,
// sameSize, seriesRung, seriesStep, slotPoint ring clearance, pinPublic) and the whole Foundry half run per seat in its own node process
// (tokenreact/check-crowd-seat.mjs: a fake Foundry with a real view, a stand-in engine that answers L.planFor and records impact frames).
// Seats: the GM (sidebar collapsed) and a player (sidebar open); the same view. Prints "sweep crowd: N checks, F failed".
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as P from "../tokenreact/pure.mjs";
import { STEP_AT } from "../letters/impact/plan.mjs";

let n = 0, failed = 0;
const ck = (name, cond, more = "") => { n++; if (!cond) { failed++; console.log(`FAIL ${name}${more ? `\n   ${more}` : ""}`); } };
const seatFile = fileURLToPath(new URL("../tokenreact/check-crowd-seat.mjs", import.meta.url));
const seat = (cfg) => new Promise((res) => {
  const p = spawn(process.execPath, [seatFile, JSON.stringify(cfg)]);
  let out = "", err = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
  p.on("close", () => { const line = out.trim().split(/\r?\n/).filter((l) => l.startsWith("{")).pop(); try { res(JSON.parse(line)); } catch { console.log(`seat ${cfg.name} failed: ${err.slice(0, 400)}`); res(null); } });
});
const GM = { name: "gm", gm: true, side: 40 }, P1 = { name: "p1", side: 300 };
const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const words = (s) => s.plays.filter((p) => !p.num && p.box);
const nums = (s) => s.plays.filter((p) => p.num && p.box);
const sig = (ps) => ps.map((p) => `${p.text}@${p.box.x},${p.box.y},${p.box.w}x${p.box.h}`).sort().join(" ");
const near = (a, b, tol = 2) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.w - b.w) <= tol && Math.abs(a.h - b.h) <= tol;
const hitAll = (ids, to = 6, dt = 5) => ids.map((id, i) => ({ t: i * dt, id, to }));

/* ---- pure rules ---- */
{
  const R = (x, y) => ({ x, y, w: 100, h: 100 });
  const it = (key, x, y, kind = "hit", o = {}) => ({ key, kind, sev: P.SEVERITY[kind], amt: 0.25, rect: R(x, y), pub: true, ...o });
  const six = [it("a", 0, 0), it("b", 100, 0), it("c", 200, 0), it("d", 0, 220), it("e", 100, 220), it("f", 200, 220)];
  const u = P.crowdUnits(six);
  ck("P1 adjacent tokens hit at once form clusters: two rows, two clusters, one word each", u.length === 2 && u.every((x) => x.cluster && x.keys.length === 3), JSON.stringify(u));
  ck("P2 a knock-down is never folded into a crowd: its own word", P.crowdUnits([...six, it("g", 300, 0, "down")]).some((x) => !x.cluster && x.lead === "g"));
  ck("P3 a token the GM hid never joins a crowd", P.crowdUnits([it("a", 0, 0), it("h", 100, 0, "hit", { pub: false })]).every((x) => !x.cluster));
  ck("P4 Health blows and stress do not share a word", P.crowdUnits([it("a", 0, 0), it("s", 100, 0, "stress")]).every((x) => !x.cluster));
  ck("P5 tokens far apart keep their own words", P.crowdUnits([it("a", 0, 0), it("b", 600, 0), it("c", 1200, 0)]).every((x) => !x.cluster));
  const order = P.crowdUnits(six.slice().reverse()).map((x) => x.lead).join(), order2 = P.crowdUnits(six).map((x) => x.lead).join();
  ck("P6 the units come in one order whatever order the updates arrived in", order === order2, `${order} vs ${order2}`);
  ck("P7 far out (tokens 20 px) a whole crowd is one cluster", P.crowdUnits(six.map((x) => ({ ...x, rect: { x: x.rect.x * 0.14, y: x.rect.y * 0.14, w: 14, h: 14 } }))).length === 1);
  const st = P.stageUnits(Array.from({ length: 6 }, (_, i) => ({ lead: `t${i}`, sev: 3, hasNum: true })));
  ck("P8 six units in one moment: every one keeps its word, one scale for all", st.every((x) => x.mode === "full") && new Set(st.map((x) => x.scale)).size === 1);
  const sz = P.sameSize([{ key: "a", kind: "hit", amt: 0.25, k: 1 }, { key: "b", kind: "hit", amt: 0.25, k: 0.52 }, { key: "c", kind: "heavy", amt: 0.5, k: 0.86 }]);
  ck("P9 equal blows take one size (the smallest fit); another blow keeps its own", sz.get("a") === 0.52 && sz.get("b") === 0.52 && sz.get("c") === 0.86);
  ck("P10 the number always stands after its word", Array.from({ length: 20 }, (_, i) => P.look({ kind: "hit", num: 2 }, null, "en", `s${i}`).side).every((s) => s === 1));
  /* the ring: a word at rest above, beside or below its token clears the token's ring (the group's motion room may pass over it) */
  const tok = { x: 500, y: 400, w: 100, h: 100 }, ring = P.ringRect(tok);
  const cases = [{ cap: 40, aspect: 3.4, nums: ["-2"], up: 0.4, down: 0.2 }, { cap: 60, aspect: 5, nums: ["-12"], up: 1.2, down: 0.3 }, { cap: 30, aspect: 2.5, nums: [], up: 0.6, down: 0.2 }];
  /* the word's own rect at rest inside its group (pure group: the group box holds the motion room above and below the word) */
  const rests = (slot) => cases.map((a) => { const g = P.group({ ...a, numCap: a.cap * 0.8, side: 1 }), c = P.slotPoint(slot, tok, { w: g.w, h: g.h }); const ww = a.cap * a.aspect * 1.12, wh = a.cap * 1.3; return { x: c.x + g.word.dx - ww / 2, y: c.y + g.word.dy - wh / 2, w: ww, h: wh }; });
  const rest = (slot) => rests(slot).reduce((m, r) => (inter(r, ring) > inter(m, ring) ? r : m));
  ck("P11 a word at rest above, beside or below its token stands clear of its ring", P.FIT_SLOTS.every((s) => inter(rest(s), ring) < 1), P.FIT_SLOTS.map((s) => `${s} ${Math.round(inter(rest(s), ring))}`).join(", "));
  /* series in proportion */
  const ser = (blows) => { let cum = { n: 0, a: 0 }; return blows.map(([kind, k], s) => { cum = { n: cum.n + k, a: cum.a + k / 8 }; return P.impactOf({ kind, amt: k / 8, known: true }, s, { cum }); }); };
  const five = ser([["hit", 1], ["hit", 1], ["hit", 1], ["hit", 1], ["hit", 1]]);
  ck(`P12 five -1 blows build but never reach the critical: ${five.map((x) => `${x.kind} ${x.magnitude}`).join(", ")}`, five.every((x) => x.kind !== "crit") && five.every((x, i) => !i || x.magnitude >= five[i - 1].magnitude) && five[4].magnitude > five[0].magnitude);
  const one5 = P.impactOf({ kind: "heavy", amt: 5 / 8, known: true }, 0);
  ck("P13 a series never draws more than its sum would in one blow plus one rung, and at the top no more than the sum itself", five[4].rung <= one5.rung + 1 && five[4].magnitude <= Math.max(one5.magnitude, P.RUNGS[3].magnitude));
  const paced = ser([["hit", 2], ["heavy", 3], ["heavy", 4]]);
  ck(`P14 a paced series of real blows still builds to the crushing rung: ${paced.map((x) => `${x.kind} ${x.magnitude}`).join(", ")}`, paced[0].rung < paced[1].rung && paced[1].rung < paced[2].rung && paced[2].rung === P.RUNGS.length - 1);
  ck("P15 the earned step: five -1 earn at most 3 steps of growth", P.seriesStep({ kind: "hit", amt: 1 / 8, known: true }, 4, { n: 5, a: 5 / 8 }) <= 3);
  /* CROWD2 (orchestrator's after-take, KA k3): five -1 still drew the full black-and-white slam on the 2nd and 3rd blow. A blow is drawn at
     its own damage's rung; the series lifts it only once the blows before it took half the track; the rhythm builds inside the rung. The
     drawn strength is what the engine draws (withSeries + the engine's series boost: effectiveMagnitude); 0.6 is the bound where a hit's
     drawings turn the scene black and white (impact/plan.mjs STEP_AT) */
  const drawn = (blows, max = 8) => { let cum = { n: 0, a: 0 }; return blows.map(([kind, k], s) => { const amt = Math.max(k / max, k / 8); cum = { n: cum.n + k, a: cum.a + amt }; const im = P.impactOf({ kind, amt, known: true }, s, { cum }); return { ...im, eff: P.effectiveMagnitude(P.withSeries(im, s)) }; }); };
  for (const max of [6, 8, 12, 20]) {
    const f = drawn([["hit", 1], ["hit", 1], ["hit", 1], ["hit", 1], ["hit", 1]], max);
    ck(`P18 five -1 on a ${max}-point track: blows 2-3 stay scratches (drawn ${f.map((x) => x.eff)}), the rhythm still builds inside the rung`, f.slice(0, 3).every((x) => x.rung === 0 && x.eff < STEP_AT[1]) && f[2].eff > f[0].eff && f.every((x, i) => !i || x.eff >= f[i - 1].eff - 1e-9));
    ck(`P19 five -1 on a ${max}-point track: never more than one rung over a scratch (rungs ${f.map((x) => x.rung)})`, f.every((x) => x.rung <= 1));
  }
  const toDown = (() => { let cum = { n: 0, a: 0 }; const out = [-2, -2, -2].map((d, s) => { const amt = 2 / 8; cum = { n: cum.n + 2, a: cum.a + amt }; return P.impactOf({ kind: "hit", amt, known: true }, s, { cum }); }); out.push(P.impactOf({ kind: "down", amt: 1 / 8 }, 3, { cum: { n: 7, a: 7 / 8 } })); return out; })();
  ck(`P20 a paced series -2 -2 -2 then the fall builds to a real peak (${toDown.map((x) => `${x.kind} ${x.magnitude}`)})`, toDown[2].rung > toDown[0].rung && toDown[3].kind === "ko" && toDown[3].magnitude > P.IMPACT_TOP);
  ck("P21 the sound of a series is one tier over what it earned: five -1 never reach the lead-in (step 2) before earning a rung",
    typeof P.textStep === "function" && [0, 1, 2, 3, 4].map((s) => P.textStep(s, 0)).every((x) => x <= 1) && P.textStep(4, 1) === 2 && P.textStep(0, 0) === 0);
  ck("P16 going down is the knock-out whatever came before", P.impactOf({ kind: "down", amt: 0.3 }, 4, { cum: { n: 1, a: 0.1 } }).kind === "ko");
  ck("P17 a pin every player may open is shared; a GM's pin is not; a pin with no entry a player placed is shared",
    P.pinPublic({ ownership: { default: 2 }, hasEntry: true }) && !P.pinPublic({ ownership: { default: 0 }, hasEntry: true }) && P.pinPublic({ hasEntry: false, authorGM: false }) && !P.pinPublic({ hasEntry: false, authorGM: true }));
}

/* ---- the whole Foundry half, per seat ---- */
const SIX = [{ id: "OM", x: 500, y: 250 }, { id: "EV", x: 600, y: 250 }, { id: "KD", x: 700, y: 250 }, { id: "SO", x: 500, y: 470 }, { id: "MB", x: 600, y: 470 }, { id: "MA", x: 700, y: 470 }];
const scen = {
  six: { toks: SIX, hits: hitAll(SIX.map((t) => t.id)) },
  apart: { toks: [{ id: "A", x: 300, y: 300 }, { id: "B", x: 750, y: 300 }, { id: "C", x: 1150, y: 600 }], hits: hitAll(["A", "B", "C"]) },
  side: { toks: [{ id: "A", x: 700, y: 400 }, { id: "S", x: 1400, y: 400 }], hits: [{ t: 0, id: "S", to: 5 }] },
  pin: { toks: [{ id: "A", x: 700, y: 400 }], notes: [{ id: "N1", x: 750, y: 330, size: 60, pub: true }], hits: [{ t: 0, id: "A", to: 6 }] },
  rapid: { toks: [{ id: "MB", x: 700, y: 400 }], hits: [7, 6, 5, 4, 3].map((to, i) => ({ t: i * 450, id: "MB", to, snap: 380 })), wait: 1200 },
  paced: { toks: [{ id: "MB", x: 700, y: 400 }], hits: [6, 3, 0].map((to, i) => ({ t: i * 1500, id: "MB", to, snap: 600 })), wait: 1200 },
  far: { zoom: 0.14, center: { x: 600, y: 400 }, toks: SIX, hits: hitAll(SIX.map((t) => t.id)) },
  hidden: { toks: [...SIX.slice(0, 3), { id: "HD", x: 800, y: 250, hidden: true }], hits: hitAll(["OM", "EV", "KD", "HD"]) },
  /* CROWD2 (KA k1): three heroes (every seat reads their numbers) hit with three enemies; a pin only the GM may open just above the first
     hero and the GM's own desk panel beside it (seat-only things) */
  heroes: { toks: SIX.map((t, i) => ({ ...t, hero: i < 3 })), notes: [{ id: "NG", x: 550, y: 205, size: 40, pub: false }], hits: hitAll(SIX.map((t) => t.id)),
    gmPanels: [{ sel: "#invincible-tactics-desk:not(.igd-collapsed) .igd", x: 300, y: 120, w: 190, h: 120 }] }
};
const runs = await Promise.all(Object.entries(scen).flatMap(([k, s]) => [GM, P1].map((st) => seat({ ...s, ...st, panels: st.gm ? s.gmPanels : s.panels, name: `${k}/${st.name}` }).then((r) => [k, st.name, r]))));
const S = {};
for (const [k, who, r] of runs) (S[k] ??= {})[who] = r;
for (const [k, v] of Object.entries(S)) ck(`R0 ${k}: both seats ran`, !!v.gm && !!v.p1);
const ok = (k) => S[k]?.gm && S[k]?.p1;
const ringOf = (t) => P.ringRect(t);
const onRings = (s, ps, skip = () => false) => ps.flatMap((p) => s.toks.filter((t) => !skip(p, t) && inter(p.box, ringOf(t)) > 0.04 * p.box.w * p.box.h).map((t) => `${p.text}/${t.id}`));
const overlaps = (ps) => { const o = []; for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if (inter(ps[i].box, ps[j].box) > 1) o.push(`${ps[i].text}x${ps[j].text}`); return o; };

if (ok("six")) {
  const { gm, p1 } = S.six;
  ck(`C1 six hit at once: every one struck gets its number on the GM's seat (${nums(gm).length})`, new Set(nums(gm).map((p) => p.tok)).size === 6);
  ck(`C2 six hit at once in two groups: one word per group, no bare token left without a word over its group (${words(gm).map((p) => p.text)})`, words(gm).length === 2);
  ck(`C3 nothing collides: no two words or numbers overlap (GM ${overlaps(gm.plays.filter((p) => p.box))}; P1 ${overlaps(p1.plays.filter((p) => p.box))})`, !overlaps(gm.plays.filter((p) => p.box)).length && !overlaps(p1.plays.filter((p) => p.box)).length);
  ck(`C4 no word or number rests on a token or its ring (${onRings(gm, gm.plays.filter((p) => p.box))})`, !onRings(gm, gm.plays.filter((p) => p.box)).length);
  ck(`C5 the player's seat letters the same crowd words at the same place and size\n   GM ${sig(words(gm))}\n   P1 ${sig(words(p1))}`, sig(words(gm)) === sig(words(p1)));
}
if (ok("apart")) {
  /* one size = one weight: a shorter word stands a little taller by the eye's rule (pure targetPx: letters^-shortPow), nothing else */
  const w = words(S.apart.gm), wt = w.map((p) => p.cap * Math.max(2, [...p.text].filter((c) => /[A-Z0-9]/i.test(c)).length) ** P.SIZE_RULE.shortPow);
  ck(`C6 three equal blows far apart: three words at one weight (${w.map((p) => `${p.text} ${p.cap}`)})`, w.length === 3 && Math.max(...wt) / Math.min(...wt) < 1.03);
  const pairs = w.map((p) => [p, nums(S.apart.gm).find((q) => q.tok === p.tok)]).filter(([, q]) => q);
  ck("C7 every number stands after its word (reading order)", pairs.length === 3 && pairs.every(([p, q]) => q.box.x > p.box.x + p.box.w * 0.5));
  ck(`C8 the same three words on the player's seat`, sig(w) === sig(words(S.apart.p1)));
}
if (ok("side")) {
  const g = words(S.side.gm).find((p) => p.tok === "S"), q = words(S.side.p1).find((p) => p.tok === "S");
  ck("C9 a token under the player's open sidebar still gets its reaction on the player's seat", !!q && !!g);
  ck(`C10 there it stands off-panel: whole inside the player's view, at the edge nearest the token (${q && JSON.stringify(q.box)})`, !!q && q.box.x + q.box.w <= S.side.p1.W - S.side.p1.side && q.box.x + q.box.w >= S.side.p1.W - S.side.p1.side - 90);
  ck("C11 the GM's seat, whose view shows the token, keeps the word by the token", !!g && Math.abs(g.box.x + g.box.w / 2 - (S.side.gm.toks.find((t) => t.id === "S").x + 50)) < 260);
}
if (ok("pin")) {
  const pin = S.pin.gm.pins[0], all = S.pin.gm.plays.filter((p) => p.box);
  ck(`C12 a word and its number never rest on a map pin every player may open (${all.map((p) => `${p.text} ${Math.round(inter(p.box, pin))}`)})`, all.every((p) => inter(p.box, pin) < 1));
  ck("C13 the pin moves the word alike on both seats", sig(words(S.pin.gm)) === sig(words(S.pin.p1)));
}
if (ok("rapid")) {
  const im = S.rapid.gm.impacts, w = words(S.rapid.gm), caps = w.map((p) => p.cap);
  ck(`C14 five 1-point blows: the series builds and never draws the critical (${im.map((x) => `${x.kind} ${x.magnitude}+${x.series}`)})`, im.length === 5 && im.every((x) => x.kind !== "crit") && im.at(-1).magnitude + 0.15 * im.at(-1).series >= im[0].magnitude);
  ck(`C15 its word grows at most what the series earned (caps ${caps})`, caps.length === 5 && caps.at(-1) / caps[0] <= 1 + P.STREAK.grow * 3 + 0.02 && caps.every((c, i) => !i || c >= caps[i - 1] - 0.1));
  const dx = S.rapid.gm.frames.map((f) => { const ws = f.plays.filter((p) => !p.num), ns = f.plays.filter((p) => p.num); const a = ws.at(-1), b = ns.at(-1); return a && b && a.box && b.box ? Math.sign(b.box.x - a.box.x) : 0; });
  ck(`C16 the number keeps its side blow after blow (${dx})`, dx.length === 5 && dx.every((s) => s === 1));
  const ringHits = S.rapid.gm.frames.flatMap((f) => onRings(S.rapid.gm, [f.plays.filter((p) => !p.num && p.box).at(-1)].filter(Boolean)));
  ck(`C17 no step of the series rests on the token's ring (${ringHits})`, !ringHits.length);
  /* CROWD2 (KA k3): the drawn strength (magnitude + the engine's series boost) of blows 2 and 3 stays under the black-and-white bound; the
     sound gets no lead-in before the series has earned a rung */
  const eff = im.map((x) => Math.round((x.magnitude + 0.15 * x.series) * 100) / 100);
  ck(`C24 five 1-point blows: the 2nd and 3rd draw no black-and-white scene (drawn ${eff})`, eff.length === 5 && eff[1] < STEP_AT[1] && eff[2] < STEP_AT[1]);
  ck(`C25 five 1-point blows: the words say a scratch, no lead-in before half the track is gone (${w.map((p) => p.text)})`, w.length === 5 && w.slice(0, 4).every((p) => !p.text.includes("-")));
}
if (ok("paced")) {
  const im = S.paced.gm.impacts;
  ck(`C18 a paced series still builds to its knock-down (${im.map((x) => `${x.kind} ${x.magnitude}`)})`, im.length === 3 && im[0].magnitude < im[1].magnitude && im[2].kind === "ko");
}
if (ok("far")) {
  const w = words(S.far.gm);
  ck(`C19 far out (zoom 0.14) the six read as one event: one word (${w.map((p) => p.text)})`, w.length === 1);
  ck(`C20 that word is no speck: at least the crowd floor (${w[0]?.cap} px)`, (w[0]?.cap ?? 0) >= P.crowdFloor(900) * 0.98);
  ck("C21 far out the same word at the same place on the player's seat", sig(w) === sig(words(S.far.p1)));
}
if (ok("hidden")) {
  const { gm, p1 } = S.hidden;
  ck("C22 a token the GM hid is lettered on no player's seat", !p1.plays.some((p) => p.tok === "HD"));
  ck("C23 it never joins the crowd's word: the crowd's word is the same on both seats", (() => { const c = (s) => words(s).filter((p) => p.tok !== "HD"); return sig(c(gm)) === sig(c(p1)) && c(gm).length === 1; })(), `GM ${sig(words(gm))}\n   P1 ${sig(words(p1))}`);
}
if (ok("heroes")) {
  /* CROWD2: a number every seat shows (a hero's) stands at the same place and size on every seat; nothing only one seat has (a GM-only pin,
     the GM's desk) moves it, nor the word of its group */
  const { gm, p1 } = S.heroes, shown = (s) => nums(s).filter((p) => ["OM", "EV", "KD"].includes(p.tok));
  ck(`C26 the heroes' numbers stand alike on both seats\n   GM ${sig(shown(gm))}\n   P1 ${sig(shown(p1))}`, shown(gm).length === 3 && sig(shown(gm)) === sig(shown(p1)));
  ck(`C27 the crowd words stand alike on both seats\n   GM ${sig(words(gm))}\n   P1 ${sig(words(p1))}`, sig(words(gm)) === sig(words(p1)));
}
console.log(`sweep crowd: ${n} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
