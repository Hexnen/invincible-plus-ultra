import "../tokenreact/impact-node-prime.mjs";      // the vendored engine's impact table for pure.mjs (on a page: the running engine's L.impact)
// node scripts/sweep-checks/reactplace.mjs  (REACTPLACE: blind review ADVS3 D4, D12). A token's reaction lettering tells the story of ITS
// token: it stands by that token (a viewer sees at once whose word it is), it does not lie on another token, and the seats draw one picture.
// Seen live on tactics-integrated-161 (The Warehouse, 1600 x 900, tokens 175 px, GM and a player): a Resolve word 568 px wide was laid out
// to the left of its token on the view every seat shares (the token in the middle); on the real view the token stood 88 px further left,
// the word was pushed back into the view, began at the tool column and laid its "-10" on its own token; a knock-down word was laid out
// 180 px down its token's side; a seat on another view drew the same word beside another hero.
//   T  the rule (tokenreact/layout.mjs): claim, tie, the ring's graze, a clean place is a tied place, a ringed token letters over itself.
//   S  seats (tokenreact/check-crowd-seat.mjs, a fake Foundry per seat, a stand-in engine): the review's board on two seats with the same
//      view, a token at the view's edge, a token among neighbours, a knock-down and the get-up after it, and (frL, frT) the moment laid
//      out on the shared centred view but drawn where the token stands off the middle.
// Fails on tactics-integrated-161 (T2-T7: no such rule; S: the review's word 0.9 token sizes further from its token and on its own ring).
// Prints "sweep reactplace: N checks, F failed".
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as P from "../tokenreact/pure.mjs";
import * as Lay from "../tokenreact/layout.mjs";

let n = 0, failed = 0;
const ck = (name, cond, more = "") => { n++; if (!cond) { failed++; console.log(`FAIL ${name}${more ? `\n   ${more}` : ""}`); } };
const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const ringOf = (t) => ({ x: t.x - t.w * P.RING, y: t.y - t.h * P.RING, w: t.w * (1 + 2 * P.RING), h: t.h * (1 + 2 * P.RING) });
const claim = (r, tok) => { const cx = tok.x + tok.w / 2, cy = tok.y + tok.h / 2; return Math.hypot(Math.max(r.x - cx, 0, cx - (r.x + r.w)), Math.max(r.y - cy, 0, cy - (r.y + r.h))) / Math.max(tok.w, tok.h); };

/* ---------------- T: the rule ---------------- */
{
  const tok = { x: 625, y: 325, w: 175, h: 175, id: "eve" };
  const T = Lay.TETHER;
  ck("T1 the rule is there: a limit of about one token size, and the own token must lead", !!T && T.max <= 1.25 && T.lead < 1 && T.graze <= 0.03 && typeof Lay.tie === "function" && typeof Lay.claim === "function");
  if (T && Lay.tie && Lay.claim) {
    ck("T2 claim: a rect over the token's centre is 0 away, one touching its edge half a token, one a token further 1.5", Lay.claim({ x: 600, y: 300, w: 300, h: 200 }, tok) === 0
      && Math.abs(Lay.claim({ x: 800, y: 325, w: 300, h: 175 }, tok) - 0.5) < 1e-9 && Math.abs(Lay.claim({ x: 975, y: 325, w: 300, h: 175 }, tok) - 1.5) < 1e-9);
    const beside = { x: 810, y: 350, w: 400, h: 120 }, far = { x: 1100, y: 350, w: 400, h: 120 };
    ck("T3 tie: a word beside its token is tied; the same word 300 px off is not", Lay.tie(beside, [tok]).ok && !Lay.tie(far, [tok]).ok);
    const other = { x: 1215, y: 325, w: 175, h: 175, kind: "tok", id: "kid" };
    const mid = { x: 830, y: 350, w: 380, h: 120 };
    const q = Lay.tie(mid, [tok], [other]);
    ck("T4 tie: a word that ends at another token as near as it begins at its own is nobody's: not tied, and the rival is named", !q.ok && q.by === "kid", JSON.stringify(q));
    ck("T5 tie: its own crowd's members are no rivals (a crowd's word is tied to the nearest member)", Lay.tie(mid, [tok, other], [other], T.crowdMax).ok);
    /* a 600 x 200 group may not lay a 40 x 100 px number on a token: 4 % of the GROUP's area let it (4800 px2) */
    const big = { x: 1000, y: 300, w: 600, h: 200 }, nb = { x: 1560 + 175 * P.RING, y: 400 + 175 * P.RING, w: 175, h: 175, kind: "tok", id: "nb" };
    const a = inter(big, ringOf(nb));
    ck(`T6 a token's ring may be grazed by a share of the RING, not of a big group (${Math.round(a)} px2 of a neighbour's ring covered: not clean)`, a > 3000 && a < 0.04 * 600 * 200 && !Lay.covers(big, [nb], null, null).clean);
    /* the review's board: Eve's Resolve word (a group ~614 x 230 with its number), Omni-Man above her, Kid beside him, the Soldier below */
    const g = P.group({ cap: 59, aspect: 8.55, tall: 2.35, nums: ["-10"], numCap: 48, side: 1, up: 0.4, down: 0.2 });
    const obs = [{ x: 625, y: 150, w: 175, h: 175, kind: "tok", id: "omni" }, { x: 800, y: 150, w: 175, h: 175, kind: "tok", id: "kid" }, { x: 800, y: 675, w: 175, h: 175, kind: "tok", id: "sol" }];
    const std = { l: 96, t: 54, r: 1244, b: 802 }, safe = { l: 62, t: 8, r: 1592, b: 826 };
    const s = Lay.cleanSpot({ tok, own: tok, g, eb: { w: g.w, h: g.h }, std, safe, panels: [], obs, tokPx: 175 });
    const r = Lay.standAt(s.c, g, s.k), ti = Lay.tie(r, [tok], obs);
    ck(`T7 the review's board: the long Resolve word stands clean and tied by its token (${claim(r, tok).toFixed(2)} token sizes off, slot ${s.slot}, k ${s.k})`,
      s.clean && ti.ok && claim(r, tok) <= T.max + 1e-9 && obs.every((o) => inter(r, ringOf(o)) <= T.graze * ringOf(o).w * ringOf(o).h + 1e-6) && inter(r, ringOf(tok)) <= T.graze * ringOf(tok).w * ringOf(tok).h + 1e-6, JSON.stringify({ s, ti }));
    /* a token ringed by eight others has no clean side: the word stands over ITS token, not beyond the ring by a neighbour */
    const t1 = { x: 700, y: 400, w: 100, h: 100, id: "00" };
    const ring = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => ({ x: 700 + dx * 100, y: 400 + dy * 100, w: 100, h: 100, kind: "tok", id: `${dx}${dy}` }))).filter((q2) => q2.id !== "00");
    const g2 = P.group({ cap: 40, aspect: 3.4, nums: ["-2"], numCap: 32, side: 1, up: 0.4, down: 0.2 });
    const s2 = Lay.cleanSpot({ tok: t1, own: t1, g: g2, eb: { w: g2.w, h: g2.h }, std: { l: 0, t: 0, r: 1600, b: 900 }, safe: { l: 0, t: 0, r: 1600, b: 900 }, panels: [], obs: ring, tokPx: 100 });
    const r2 = Lay.standAt(s2.c, g2, s2.k);
    ck("T8 a token ringed by eight others: reported unclean, the word over its own token, nearer to it than to any neighbour", s2.clean === false && claim(r2, t1) < 0.15 && ring.every((q2) => claim(r2, q2) > 0.3), JSON.stringify(s2));
    /* a token off the view letters at the view's edge as before: no tie can hold there */
    const offTok = { x: 2400, y: 300, w: 175, h: 175 };
    const s3 = Lay.cleanSpot({ tok: offTok, own: offTok, g: g2, eb: { w: g2.w, h: g2.h }, std, safe, panels: [], obs: [], tokPx: 175 });
    ck("T9 a token off the view: its word stands inside the view (at its edge), reported clean", s3.clean && Lay.standAt(s3.c, g2, s3.k).x + Lay.standAt(s3.c, g2, s3.k).w <= safe.r + 1, JSON.stringify(s3));
  }
}

/* ---------------- S: seats ---------------- */
const seatFile = fileURLToPath(new URL("../tokenreact/check-crowd-seat.mjs", import.meta.url));
const seat = (cfg) => new Promise((res) => {
  const p = spawn(process.execPath, [seatFile, JSON.stringify(cfg)]);
  let out = "", err = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
  p.on("close", () => { const line = out.trim().split(/\r?\n/).filter((l) => l.startsWith("{")).pop(); try { res(JSON.parse(line)); } catch { console.log(`seat ${cfg.name} failed: ${err.slice(0, 400)}`); res(null); } });
});
/* the review's board at a seventh of its size (tokens 100 scene px, 175 px on screen at 1.75): Omni-Man, Kid beside him, Eve under
   Omni-Man, the Soldier and a Mauler below; the view's middle between them (Eve 88 px left of it) */
const WH = [{ id: "OM", x: 600, y: 100, hero: true }, { id: "KD", x: 700, y: 100, hero: true, h: 9, hm: 9 }, { id: "EV", x: 600, y: 200, hero: true }, { id: "SO", x: 700, y: 400, h: 6, hm: 6 }, { id: "MB", x: 900, y: 400, h: 11, hm: 11 }];
const wh = { zoom: 1.75, center: { x: 700, y: 271.43 }, toks: WH };
const SCEN = {
  res0: { ...wh, hits: [{ t: 0, id: "EV", stat: "resolve", to: 0 }], wait: 1300 },
  res7: { ...wh, hits: [{ t: 0, id: "OM", stat: "resolve", to: 2 }], wait: 1300 },
  ko: { ...wh, hits: [{ t: 0, id: "KD", to: 0 }], wait: 1300 },
  up: { ...wh, hits: [{ t: 0, id: "KD", to: 0 }, { t: 2600, id: "KD", to: 9 }], wait: 4000 },
  /* the same board seen from where Eve stands at the view's left edge, and the Soldier, who stands across the standard view's bottom edge */
  edgeL: { ...wh, center: { x: 1050, y: 271.43 }, hits: [{ t: 0, id: "EV", stat: "resolve", to: 0 }], wait: 1300 },
  edgeB: { ...wh, hits: [{ t: 0, id: "SO", to: 3 }], wait: 1300 },
  /* the moment laid out on the view every seat shares (the token in its middle: main planFrame) and drawn on this one, where the token
     stands 250 px left of the middle (no room on the side the shared view chose), and where it stands near the top (none above) */
  frL: { ...wh, frames: true, center: { x: 793, y: 271.43 }, hits: [{ t: 0, id: "EV", stat: "resolve", to: 0 }], wait: 1300 },
  frT: { ...wh, frames: true, hits: [{ t: 0, id: "KD", to: 0 }], wait: 1300 },
  /* a token with neighbours on three sides */
  crowd: { zoom: 1.75, center: { x: 700, y: 300 }, toks: [{ id: "EV", x: 600, y: 250, hero: true }, { id: "A", x: 500, y: 250, h: 6, hm: 6 }, { id: "B", x: 700, y: 250, h: 6, hm: 6 }, { id: "C", x: 600, y: 350, h: 6, hm: 6 }, { id: "D", x: 700, y: 350, h: 6, hm: 6 }],
    hits: [{ t: 0, id: "EV", stat: "resolve", to: 0 }], wait: 1300 }
};
const SEATS = [{ name: "gm", gm: true, W: 1600, H: 900, side: 40 }, { name: "p1", W: 1600, H: 900, side: 40 }];
const runs = await Promise.all(Object.entries(SCEN).flatMap(([k, s]) => SEATS.map((st) => seat({ ...s, ...st, name: `${k}/${st.name}` }).then((r) => [k, st, r]))));
const R = {};
for (const [k, st, r] of runs) (R[k] ??= {})[st.name] = r;
const TOL = Lay.TETHER?.max ?? 1;
for (const k of Object.keys(SCEN)) {
  const per = {};
  for (const st of SEATS) {
    const r = R[k][st.name];
    if (!r) { ck(`${k}/${st.name}: the seat ran`, false); continue; }
    const tk = (id) => r.toks.find((t) => t.id === id);
    const ps = r.plays.filter((p) => p.box && tk(p.tok));
    ck(`${k}/${st.name}: lettered`, ps.length >= 1, JSON.stringify(r.plays));
    /* every play (the word, each number) by the group it stands in: the group's ink is what a viewer attributes */
    const last = k === "up" ? ps.filter((p) => p.t >= 2600) : ps;
    ck(`${k}/${st.name}: the get-up is lettered after the knock-down`, k !== "up" || last.length >= 1, JSON.stringify(ps));
    const of = last.length ? last : ps;
    const box = { x: Math.min(...of.map((p) => p.box.x)), y: Math.min(...of.map((p) => p.box.y)) }; box.w = Math.max(...of.map((p) => p.box.x + p.box.w)) - box.x; box.h = Math.max(...of.map((p) => p.box.y + p.box.h)) - box.y;
    const own = tk(of[0]?.tok);
    if (!own) continue;
    const d = claim(box, own);
    ck(`${k}/${st.name}: the lettering stands by its token (${d.toFixed(2)} token sizes from its centre, at most ${TOL})`, d <= TOL + 0.02, JSON.stringify(of.map((p) => [p.text, p.box])));
    const near = (t) => (claim(box, t) + Math.hypot(box.x + box.w / 2 - t.x - t.w / 2, box.y + box.h / 2 - t.y - t.h / 2) / Math.max(t.w, t.h)) / 2;      // layout nearness: its nearest ink and its middle
    const rivals = r.toks.filter((t) => t.id !== own.id).map((t) => [t.id, +near(t).toFixed(2)]).filter(([, x]) => near(own) > 0.9 * x + 0.02);
    ck(`${k}/${st.name}: its own token is clearly the nearest to it (${near(own).toFixed(2)})`, !rivals.length, JSON.stringify(rivals));
    const on = []; for (const p of of) for (const t of r.toks) { const a = inter(p.box, ringOf(t)), lim = 0.03 * ringOf(t).w * ringOf(t).h; if (a > lim) on.push(`${p.text} on ${t.id} ${Math.round(a)} px2`); }
    ck(`${k}/${st.name}: no word or number lies on a token (a graze of its ring at most)`, !on.length, on.join("; "));
    ck(`${k}/${st.name}: inside the standard view (the tool column and the sidebar's band stay free; 6 px for a knock's travel)`, box.x >= 96 - 6 && box.x + box.w <= 1244 + 6 && box.y >= 54 - 6 && box.y + box.h <= 802 + 6, JSON.stringify(box));
    per[st.name] = of.map((p) => [p.text, Math.round(p.box.x), Math.round(p.box.y), Math.round(p.box.w)]);
  }
  ck(`${k}: the GM and the player (the same view) draw the same picture (what the player's seat letters stands where the GM's does)`, !!per.gm && !!per.p1?.length && per.p1.every((e) => per.gm.some((q) => JSON.stringify(q) === JSON.stringify(e))), `${JSON.stringify(per.gm)} | ${JSON.stringify(per.p1)}`);
}
console.log(`sweep reactplace: ${n} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
