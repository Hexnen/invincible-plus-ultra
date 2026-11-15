/* CROWDKO: CLEAN PLACES for a moment's lettering (pure: no Foundry, no canvas; node-checked by scripts/sweep-checks/crowdko.mjs).
   The reviewer (ADVS2 D3, D4) saw eight knock-downs letter eight words that lay on each other and on the crowd's tokens, a crowd hit of
   fourteen put fourteen "-2" on heroes, a hidden token and a pin, and a one-blow knock-down's word stood far off over another hero. The
   side search (pure fitSlot) weighed covering against shrinking and always took SOME side, however covered; and the place it scored was not
   the place the word then stood (follow() pushes every word into the view and off the panels each frame, onto whatever is there).
   Here a place is judged where the word will really STAND (restCentre: the same pushes follow() makes, one function for both) and only a
   CLEAN one is taken: the standing ink (the group box without its motion room) touches no token's ring, no pin, no panel or zone, no other
   word or number of the moment, and stays whole in the view. Places are searched round the token (the six sides, slid along each side and
   moved further out), at sizes down to a readable floor; nearer, then bigger wins (a token size further out costs about as much as a
   third smaller), a word whose entrance would sweep over other tokens pays a
   little. What finds no clean place anywhere is reported (`clean: false`) for the caller's rules (main.mjs: a crowd member's number folds
   into its crowd's tag, see foldTags; anything else takes the least covered place, as before). */
import { slotPoint, FIT_SLOTS, ringRect, clampInto, avoidRects, onView, offPanel } from "./pure.mjs";

export const CLEAN = {
  ks: [1, 0.92, 0.84, 0.76, 0.7, 0.64, 0.58, 0.52, 0.46, 0.4, 0.35],      // sizes tried (share of the planned size); never under minCap
  minCap: 14,                                              // never a word or number under this cap height (px of the reference view)
  slides: [0, 0.3, -0.3, 0.6, -0.6, 0.95, -0.95],          // along a side, in shares of (anchor + box) / 2
  outs: [0, 0.45, 0.9, 1.4, 2, 2.8],                       // further out from a side, in token sizes
  tokTol: 0.04,                                            // a token's ring may graze the standing ink by this share of its area
  slotK: 0.04, slideK: 0.06, outK: 0.6, shrinkK: 1.6, passK: 0.35,     // preference, in shares of the group's area
  memberK: 0.25                                            // a crowd's word placed by one member rather than by the crowd's box
};
const AREA = (r) => r.w * r.h;
export const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const rectAt = (p, box) => ({ x: p.x - box.w / 2, y: p.y - box.h / 2, w: box.w, h: box.h });

/** where a group whose slot centre is c will STAND this frame: follow()'s pushes (into the standard view and this seat's safe rect by the
    entrance's reach box eb, off the floating panels; a token off the view: off-panel at the edge nearest it). One function for the layout
    and for follow(), so the place judged is the place drawn */
export function restCentre(c, tok, box, eb, std, safe, panels = []) {
  const e = eb ?? box;
  if (onView(tok, std) && onView(tok, safe)) return clampInto(avoidRects(clampInto(clampInto(c, e, std), e, safe), box, panels, safe), e, safe);
  return clampInto(avoidRects(offPanel(c, box, safe), box, panels, safe), box, safe);
}
/** the standing ink of a group whose centre is c: the group box without its motion room (pure group's `stand`), scaled by k */
export const standAt = (c, g, k = 1) => (g?.stand ? { x: c.x + g.stand.dx * k - g.stand.w * k / 2, y: c.y + g.stand.dy * k - g.stand.h * k / 2, w: g.stand.w * k, h: g.stand.h * k }
  : { x: c.x - g.w * k / 2, y: c.y - g.h * k / 2, w: g.w * k, h: g.h * k });

/** what the standing ink r covers. obs = [{ x, y, w, h, kind: "tok" | "pin" | "panel" | "word", id }]; own = its own token (or crowd box)
    -> { clean, cost } (cost: the covered area weighted as pure SLOT_K weighs it, for the least covered place when nothing is clean) */
export function covers(r, obs, own = null, view = null, quick = false) {
  let cost = 0, clean = true;
  const A = Math.max(1, AREA(r));
  if (own) { const a = inter(r, ringRect(own)); if (a > CLEAN.tokTol * A) { clean = false; cost += a * 3; } }
  for (const q of obs ?? []) {
    if (quick && !clean) return { clean, cost };      // (only whether it is clean is asked)
    if (!q || !(q.w > 0) || !(q.h > 0)) continue;
    if (q.kind === "tok") { const a = inter(r, ringRect(q)); if (a > CLEAN.tokTol * A) { clean = false; cost += a * 3.5; } }
    else { const a = inter(r, q); if (a > 1) { clean = false; cost += a * (q.kind === "pin" ? 3 : q.kind === "word" ? 5 : 8); } }
  }
  if (view) { const out = AREA(r) - inter(r, { x: view.l, y: view.t, w: view.r - view.l, h: view.b - view.t }); if (out > 1) { clean = false; cost += out * 6; } }
  return { clean, cost };
}

/** The best place for one group. a = {
      tok: the anchor (its token's screen rect, or a crowd's box), own: what counts as its own (null for a crowd: its members are in obs),
      g: the group at k = 1 (pure group, with `stand`), eb: the entrance's reach box at k = 1 ({ w, h }), reach: the word's entrance rect
      relative to the group centre at k = 1 ({ dx, dy, w, h }, or null), ks: sizes to try, minK: the smallest allowed,
      std, safe: the views (std = the shared one), panels: what follow() pushes off, obs: what the standing ink must not cover,
      sweep: tokens an entrance should rather not sweep over (soft), tokPx, first: a place to judge first ({ slot, k }: the side search's),
      bias: added to every place's score (a crowd's word tried beside one member: see crowdSpot) }
    -> { slot, k, c0 (centre before follow's pushes), c (where it stands), clean, cost, score } */
export function cleanSpot(a0) {
  const g = a0.g, tp = a0.tokPx || Math.max(a0.tok.w, a0.tok.h) || 100;
  const ks = (a0.ks ?? CLEAN.ks).filter((k) => k >= (a0.minK ?? 0) - 1e-9);
  /* only what lies within reach of any place tried counts (the same answer, a few times faster on a crowded board) */
  const R = CLEAN.outs[CLEAN.outs.length - 1] * tp + Math.max(g.w, a0.eb?.w ?? 0) + Math.max(g.h, a0.eb?.h ?? 0) + (a0.reach ? Math.max(a0.reach.w, a0.reach.h) : 0);
  const zone = { x: a0.tok.x - R, y: a0.tok.y - R, w: a0.tok.w + 2 * R, h: a0.tok.h + 2 * R };
  const near = onView(a0.tok, a0.std) && onView(a0.tok, a0.safe);      // (a token off the view letters at the view's edge: everything counts)
  const a = near ? { ...a0, obs: (a0.obs ?? []).filter((q) => q && inter(q, zone) > 0), sweep: a0.sweep?.filter((q) => q && inter(q, zone) > 0) } : a0;
  let best = null, least = null;
  const judge = (slot, k, c0, pref) => {
    let score = pref + (a.bias ?? 0) + (1 - k) * CLEAN.shrinkK;
    if (best && score >= best.score - 1e-9) return null;      // cannot beat the clean place found (and the least covered is not needed)
    const box = { w: g.w * k, h: g.h * k }, eb = a.eb ? { w: a.eb.w * k, h: a.eb.h * k } : box;
    const c = restCentre(c0, a.tok, box, eb, a.std, a.safe, a.panels);
    const r = standAt(c, g, k), cv = covers(r, a.obs, a.own, a.safe, !!best);
    if (a.reach && a.sweep?.length) {
      const e = { x: c.x + a.reach.dx * k - a.reach.w * k / 2, y: c.y + a.reach.dy * k - a.reach.h * k / 2, w: a.reach.w * k, h: a.reach.h * k };
      let s = 0; for (const t of a.sweep) s += inter(e, t);
      score += CLEAN.passK * s / Math.max(1, AREA(e));
    }
    const out = { slot, k, c0, c, clean: cv.clean, cost: cv.cost, score };
    if (cv.clean && (!best || score < best.score - 1e-9)) best = out;
    if (!least || cv.cost + score * AREA(r) < least.cost + least.score * AREA(standAt(least.c, g, least.k)) - 1e-9) least = out;
    return out;
  };
  if (a.first && FIT_SLOTS.includes(a.first.slot)) {
    const k = a.first.k ?? 1, box = { w: g.w * k, h: g.h * k };
    const f = judge(a.first.slot, k, slotPoint(a.first.slot, a.tok, box), -1);      // the side search's own choice wins when it is clean
    if (f?.clean) return f;
  }
  for (const k of ks) {
    if (best && best.score <= (a.bias ?? 0) + (1 - k) * CLEAN.shrinkK) break;      // no place at this size or smaller can beat it
    const box = { w: g.w * k, h: g.h * k };
    FIT_SLOTS.forEach((slot, i) => {
      const p = slotPoint(slot, a.tok, box);
      const horiz = slot === "left" || slot === "right";
      const nx = slot === "right" ? 1 : slot === "left" ? -1 : 0, ny = slot === "below" ? 1 : horiz ? 0 : -1;
      const span = horiz ? (a.tok.h + box.h) / 2 : (a.tok.w + box.w) / 2;
      for (const o of CLEAN.outs) for (const s of CLEAN.slides) {
        const c0 = { x: p.x + nx * o * tp + (horiz ? 0 : s * span), y: p.y + ny * o * tp + (horiz ? s * span : 0) };
        judge(slot, k, c0, i * CLEAN.slotK + Math.abs(s) * CLEAN.slideK + o * CLEAN.outK);
      }
    });
    /* every size is judged: a word a little smaller beside its token beats a big one far off (it must read as that token's) */
  }
  return best ?? { ...least, clean: false };
}

/** A crowd's word: beside the crowd's box (a.tok), or, when the crowd fills the view round its box, beside one of its members (a crowd
    of eight round four heroes has no clean side as a whole, but its outer members do). Nearer the crowd's box wins: a member's places pay
    CLEAN.memberK, and a little more the later the member (members in the seats' common order: the same choice on every seat).
    a = cleanSpot's, members = the members' token rects */
export function crowdSpot(a, members = []) {
  const whole = cleanSpot(a);
  if (whole.clean) return { ...whole, anchor: -1 };
  let best = null, least = { ...whole, anchor: -1 };
  members.forEach((m, i) => {
    const q = cleanSpot({ ...a, tok: m, tokPx: a.tokPx, first: null, bias: CLEAN.memberK + i * 0.01 });
    if (q.clean && (!best || q.k > best.k + 1e-9 || (Math.abs(q.k - best.k) < 1e-9 && q.score < best.score - 1e-9))) best = { ...q, anchor: i };
    else if (!q.clean && q.cost < least.cost - 1e-9) least = { ...q, anchor: i };
  });
  return best ?? least;
}

/** CROWDKO rule (provisional, combat-questions CROWDKO-2): the numbers of a crowd's members that find no clean place by their own token are
    folded into ONE tag per value beside the crowd's word: "-2" for one, "-2×9" for nine (a letterer's count), the most common first, at most
    `max` tags (a crowd struck with more than three different amounts at once is rare: the rarest are left out of the tag).
    nums = [{ text, stat }] -> [{ text, stat, n, of }] */
export const FOLD = { max: 3, mark: "×" };
export function foldTags(nums, max = FOLD.max) {
  const by = new Map();
  for (const x of nums ?? []) { if (!x?.text) continue; const k = `${x.stat ?? "health"}|${x.text}`; const e = by.get(k) ?? { text: x.text, stat: x.stat ?? "health", n: 0 }; e.n++; by.set(k, e); }
  const list = [...by.values()].sort((a, b) => (b.n - a.n) || (a.stat === b.stat ? 0 : a.stat === "health" ? -1 : 1) || a.text.localeCompare(b.text, "en", { numeric: true }));
  return list.slice(0, max).map((e) => ({ text: e.n > 1 ? `${e.text}${FOLD.mark}${e.n}` : e.text, stat: e.stat, n: e.n, of: e.text }));
}
