import "../tokenreact/impact-node-prime.mjs";      // the vendored engine's impact table for pure.mjs (on a page: the running engine's L.impact)
// node scripts/sweep-checks/crowdko.mjs  (CROWDKO: ADVS2 D3, D4, D8, D10). Many tokens hit or falling at once make ONE clear comic moment on
// every seat: nothing piled, nothing on a token, a pin or another word, numbers by their token or folded into the crowd's tag, the same words
// on every seat; an event no seat sees flashes nothing there; a fallen token lies inside its own square.
// Pure part: tokenreact/layout.mjs (clean places, crowd tags), pure crowdUnits (knock-downs together = one unit), tokenanim/pure lyingAt.
// Seats: tokenreact/check-crowd-seat.mjs (a fake Foundry per seat, a stand-in engine), GM 1600 x 900 (sidebar collapsed) and a player
// 1366 x 768 (sidebar open), on a crowded board: eight enemies round four heroes, a hidden enemy, a public pin and a GM-only pin.
// Fails on tactics-integrated-139 (3e68cb8): eight words piled on the crowd, numbers on heroes, the off-view knock-down flashes, the lying
// picture leaves its square. Prints "sweep crowdko: N checks, F failed".
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import * as P from "../tokenreact/pure.mjs";
import * as A from "../tokenanim/pure.mjs";

let n = 0, failed = 0;
const ck = (name, cond, more = "") => { n++; if (!cond) { failed++; console.log(`FAIL ${name}${more ? `\n   ${more}` : ""}`); } };
const done = () => { console.log(`sweep crowdko: ${n} checks, ${failed} failed`); process.exit(failed ? 1 : 0); };
const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const layoutUrl = new URL("../tokenreact/layout.mjs", import.meta.url);
const Lay = existsSync(fileURLToPath(layoutUrl)) ? await import(layoutUrl) : null;

/* ---------------- pure: the rules ---------------- */
{
  const R = (x, y) => ({ x, y, w: 100, h: 100 });
  const it = (key, x, y, kind = "down") => ({ key, kind, sev: P.SEVERITY[kind], amt: 1, rect: R(x, y), pub: true });
  const eight = Array.from({ length: 8 }, (_, i) => it(`e${i}`, (i % 4) * 100, Math.floor(i / 4) * 300));
  const u = P.crowdUnits(eight);
  ck("K1 eight knock-downs close together are lettered as crowds (one KO word each), not eight words", u.length <= 2 && u.every((x) => x.cluster), JSON.stringify(u.map((x) => x.keys.length)));
  ck("K2 a knock-down among plain hits keeps its own word (the crowd of hits does not swallow it)", P.crowdUnits([it("a", 0, 0, "hit"), it("b", 100, 0, "hit"), it("g", 200, 0, "down")]).some((x) => !x.cluster && x.lead === "g"));
  ck("K3 knock-downs far apart keep their own words", P.crowdUnits([it("a", 0, 0), it("b", 900, 0)]).every((x) => !x.cluster));
}
if (!Lay) { ck("tokenreact/layout.mjs exists (clean places)", false); }
else {
  const g = P.group({ cap: 40, aspect: 3.4, nums: ["-2"], numCap: 32, side: 1, up: 0.4, down: 0.2 });
  ck("L1 a group's standing ink is its box without the motion room (same width, shorter)", g.stand && g.stand.w === g.w && g.stand.h < g.h);
  const tok = { x: 700, y: 400, w: 100, h: 100 }, std = { l: 0, t: 0, r: 1600, b: 900 };
  const free = Lay.cleanSpot({ tok, own: tok, g, eb: { w: g.w, h: g.h }, std, safe: std, panels: [], obs: [], tokPx: 100 });
  ck("L2 a token alone: its word stands at full size right beside it, clean", free.clean && free.k === 1 && Math.hypot(free.c.x - 750, free.c.y - 450) < 160, JSON.stringify(free));
  const ring = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => ({ x: 700 + dx * 100, y: 400 + dy * 100, w: 100, h: 100, kind: "tok", id: `${dx}${dy}` }))).filter((r) => r.id !== "00");
  const s = Lay.cleanSpot({ tok, own: tok, g, eb: { w: g.w, h: g.h }, std, safe: std, panels: [], obs: ring, tokPx: 100 });
  const r = Lay.standAt(s.c, g, s.k);
  /* REACTPLACE (restated; before: "a clean place outside the ring, never on a neighbour"): the place outside the ring stood a token and
     more from its own token, beside a neighbour: a word nobody could attribute (blind review ADVS3 D4, D12). A ringed token has no clean
     place that is still ITS place; its word now stands over its own token, reported unclean, and still never on a neighbour */
  ck("L3 a token ringed by eight others: no clean place by it; the word stands over its own token, never on a neighbour", !s.clean && s.slot === "on" && Lay.claim(r, tok) < 0.15
    && ring.every((q) => inter(r, P.ringRect(q)) <= Lay.TETHER.graze * P.ringRect(q).w * P.ringRect(q).h), JSON.stringify(s));
  const boxed = Lay.cleanSpot({ tok, own: tok, g, eb: { w: g.w, h: g.h }, std: { l: 690, t: 390, r: 810, b: 510 }, safe: { l: 690, t: 390, r: 810, b: 510 }, panels: [], obs: [], tokPx: 100 });
  ck("L4 no room anywhere: reported unclean (the caller's rule decides), never a crash", boxed.clean === false && Number.isFinite(boxed.k));
  const pin = { x: 690, y: 330, w: 60, h: 60, kind: "pin" };
  const sp = Lay.cleanSpot({ tok, own: tok, g, eb: { w: g.w, h: g.h }, std, safe: std, panels: [], obs: [pin], tokPx: 100, first: { slot: "above", k: 1 } });
  ck("L5 the side search's choice over a pin is left for a clean one", sp.clean && inter(Lay.standAt(sp.c, g, sp.k), pin) <= 1);
  const t9 = Lay.foldTags([...Array(9)].map(() => ({ text: "-2", stat: "health" })));
  ck("L6 nine equal numbers fold into one tag \"-2×9\"", t9.length === 1 && t9[0].text === "-2×9" && t9[0].n === 9);
  const mixd = Lay.foldTags([{ text: "-2" }, { text: "-2" }, { text: "-3" }, { text: "-1" }, { text: "-4" }, { text: "-1" }, { text: "-1" }]);
  ck("L7 several values: one tag per value, the most common first, at most three", mixd.length === 3 && mixd[0].text === "-1×3" && mixd[1].text === "-2×2", JSON.stringify(mixd));
  ck("L8 one number stays plain (no ×1)", Lay.foldTags([{ text: "-5" }])[0].text === "-5");
}
/* ---------------- pure: the lying picture (D10) ---------------- */
{
  /* LYING: the squash is now down the screen after the turn (pose.fy, drawn by apply), no longer along the token's own axis, so the box
     measured here is the box that is drawn: the turned picture's height times fy (the same rule: inside its own square at every instant) */
  const inside = (S, t) => { const p = A.lyingAt(S, t); if (!(p.rot || p.sx !== 1)) return 0; const c = A.centred(p), cs = Math.abs(Math.cos(p.rot)), sn = Math.abs(Math.sin(p.rot)); const hx = (p.sx * cs + p.sy * sn) / 2, hy = (p.fy ?? 1) * (p.sx * sn + p.sy * cs) / 2; return Math.max(Math.abs(c.x) + hx, Math.abs(c.y) + hy); };
  for (const side of [1, -1]) {
    const S = { side, fallAt: 1000, upAt: 1000 + A.LIE.fallMs + 3000 };
    let worst = 0; for (let t = 1000; t <= S.upAt + A.LIE.upMs; t += 10) worst = Math.max(worst, inside(S, t));
    ck(`D10a side ${side}: the falling, lying and rising picture stays inside its own square at every instant (reach ${worst.toFixed(3)} of 0.5)`, worst <= 0.5 + 1e-6);
  }
  const p = A.lyingAt({ side: 1, fallAt: -Infinity, upAt: Infinity }, 0);
  /* LYING: the squash that is drawn is pose.fy (down the screen); the bound is tighter than the old 0.85 along the token's own axis */
  ck(`D10b a round portrait reads as fallen: the lying picture is squashed flat (${p.fy.toFixed(2)} of its height on screen), not only turned`, p.fy <= 0.7 && Math.abs(p.sx - p.sy) < 1e-9);
  ck("D10c lying turns about its own centre (the centre stays on its square's centre line, a small drop at most)", (() => { const c = A.centred(p); return Math.abs(c.x) < 0.02 && c.y >= 0 && c.y <= 0.1; })());
}

/* ---------------- seats ---------------- */
const seatFile = fileURLToPath(new URL("../tokenreact/check-crowd-seat.mjs", import.meta.url));
const seat = (cfg) => new Promise((res) => {
  const p = spawn(process.execPath, [seatFile, JSON.stringify(cfg)]);
  let out = "", err = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
  p.on("close", () => { const line = out.trim().split(/\r?\n/).filter((l) => l.startsWith("{")).pop(); try { res(JSON.parse(line)); } catch { console.log(`seat ${cfg.name} failed: ${err.slice(0, 400)}`); res(null); } });
});
const H = [["OM", 400, 200], ["EV", 500, 200], ["KD", 400, 300], ["IM", 500, 300]].map(([id, x, y]) => ({ id, x, y, hero: true }));
const spots = [[300, 100], [400, 100], [500, 100], [600, 100], [300, 200], [600, 200], [300, 300], [600, 300], [300, 400], [400, 400], [500, 400], [600, 400], [700, 200], [700, 300]];
const E = spots.map(([x, y], i) => ({ id: `E${i + 1}`, x, y, h: 6, hm: 6 }));
const HID = { id: "HX", x: 700, y: 400, hidden: true, h: 6, hm: 6 };
const board = { zoom: 1.75, center: { x: 500, y: 300 }, toks: [...H, ...E, HID], notes: [{ id: "PIN", x: 850, y: 250, size: 60, pub: true }, { id: "GPIN", x: 250, y: 470, size: 60, pub: false }] };
const SCEN = {
  ko8: { ...board, hits: E.slice(0, 8).map((t, i) => ({ t: i * 4, id: t.id, to: 0 })), wait: 1400 },
  hit14: { ...board, hits: [...E.map((t, i) => ({ t: i * 3, id: t.id, to: 4 })), { t: 45, id: "HX", to: 4 }], wait: 1400 },
  one: { zoom: 1.75, center: { x: 500, y: 300 }, toks: [...H, { id: "MA", x: 600, y: 300, h: 11, hm: 11 }, { id: "SO", x: 300, y: 300, h: 6, hm: 6 }], notes: [{ id: "PIN", x: 650, y: 230, size: 60, pub: true }], hits: [{ t: 0, id: "MA", to: 0 }], wait: 1400 },
  off: { zoom: 1.75, center: { x: 500, y: 300 }, toks: [...H, { id: "FAR", x: 2400, y: 300, h: 6, hm: 6 }], hits: [{ t: 0, id: "FAR", to: 0 }], wait: 1400 }
};
const SEATS = [{ name: "gm", gm: true, W: 1600, H: 900, side: 40 }, { name: "p1", W: 1366, H: 768, side: 300 }];
const runs = await Promise.all(Object.entries(SCEN).flatMap(([k, s]) => SEATS.map((st) => seat({ ...s, ...st, name: `${k}/${st.name}` }).then((r) => [k, st, s, r]))));
const R = {};
for (const [k, st, s, r] of runs) (R[k] ??= {})[st.name] = { st, s, r };
const ring = (t) => ({ x: t.x - t.w * P.RING, y: t.y - t.h * P.RING, w: t.w * (1 + 2 * P.RING), h: t.h * (1 + 2 * P.RING) });
function clean(k, name) {
  const { st, s, r } = R[k][name];
  if (!r) { ck(`${k}/${name}: the seat ran`, false); return; }
  const ps = r.plays.filter((p) => p.box);
  const toks = r.toks.filter((t) => st.gm || !s.toks.find((q) => q.id === t.id)?.hidden);
  const ov = []; for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if (inter(ps[i].box, ps[j].box) > 1) ov.push(`${ps[i].text}x${ps[j].text}`);
  ck(`${k}/${name}: no word or number lies on another`, !ov.length, ov.join(" "));
  const onT = ps.flatMap((p) => toks.filter((t) => inter(p.box, ring(t)) > (Lay?.CLEAN.tokTol ?? 0.04) * p.box.w * p.box.h).map((t) => `${p.text}(${p.tok}) on ${t.id}`));
  ck(`${k}/${name}: no word or number stands on a token (its own included)`, !onT.length, onT.join("; "));
  const pins = r.pins.filter((q) => st.gm || s.notes?.find((x) => x.id === q.id)?.pub);
  const onP = ps.flatMap((p) => pins.filter((q) => inter(p.box, q) > 1).map((q) => `${p.text} on ${q.id}`));
  ck(`${k}/${name}: none on a pin this seat shows`, !onP.length, onP.join("; "));
  const vw = { x: 0, y: 0, w: st.W - st.side, h: st.H };
  const out = ps.filter((p) => inter(p.box, vw) < p.box.w * p.box.h - 1).map((p) => p.text);
  ck(`${k}/${name}: all of it whole in the view`, !out.length, out.join(" "));
}
for (const k of Object.keys(SCEN)) for (const st of SEATS) clean(k, st.name);
const W = (k, nm) => (R[k][nm].r?.plays ?? []).filter((p) => p.box && !p.num && !/×\d+$/.test(p.text)).map((p) => p.text);      // (a crowd's tag "-2×9" is a number)
const Nn = (k, nm) => (R[k][nm].r?.plays ?? []).filter((p) => p.box && p.num);
ck("D3a eight knock-downs together: ONE KO word on every seat, the same word", W("ko8", "gm").length === 1 && W("ko8", "p1").length === 1 && W("ko8", "gm")[0] === W("ko8", "p1")[0], `${W("ko8", "gm")} | ${W("ko8", "p1")}`);
ck("D3b ... and one impact frame per seat", R.ko8.gm.r?.impacts.length === 1 && R.ko8.p1.r?.impacts.length === 1);
const tags = (R.hit14.gm.r?.plays ?? []).filter((p) => /×\d+$/.test(p.text));
ck("D3c a crowd hit of fourteen: the numbers without a clean place by their token fold into the crowd's tag on the GM's seat", tags.length >= 1 && tags.length <= 3, (R.hit14.gm.r?.plays ?? []).map((p) => p.text).join(" "));
ck("D3d ... the GM's seat letters far fewer than fourteen separate numbers", Nn("hit14", "gm").length + tags.length <= 13, `${Nn("hit14", "gm").length} numbers`);
ck("D3e ... the crowd's word is the same on both seats", W("hit14", "gm").filter((w) => !/×/.test(w)).includes(W("hit14", "p1")[0]), `${W("hit14", "gm")} | ${W("hit14", "p1")}`);
ck("D4 a one-blow knock-down next to other heroes and a pin: one word on both seats (clean: above)", W("one", "gm").length === 1 && W("one", "p1").length === 1 && W("one", "gm")[0] === W("one", "p1")[0]);
ck("D4b ... and its impact frame on both seats (the token is in both views)", R.one.gm.r?.impacts.length === 1 && R.one.p1.r?.impacts.length === 1);
/* IMPCALL2 (ADVI2 6: the seat without the target in view got nothing while the table saw a cut): the off-view knock-down gets the engine's
   GENTLE variant (its local panel: no full frame, no hit-stop, no inverted scene) on the word lettered at the view's edge, never on the token
   and never a whole view's flash. Was: no impact at all */
const offImp = (s) => R.off[s].r?.impacts ?? [];
ck("D8 a knock-down outside both seats' views flashes neither view: only a gentle moment on its edge word (the word still letters at the edge)",
  ["gm", "p1"].every((s) => offImp(s).length <= 1 && offImp(s).every((x) => x.gentle === true && x.subject !== "FAR" && /^h\d+$/.test(x.subject ?? ""))) && W("off", "gm").length === 1 && W("off", "p1").length === 1,      // its subject: a word handle (this stand-in names them h0, h1 ...), never the token
  `impacts ${JSON.stringify(offImp("gm"))}/${JSON.stringify(offImp("p1"))}`);
done();
