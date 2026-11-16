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
  numOuts: [0, 0.25, 0.5],                                 // a crowd member's number: right by its token or folded (live take L: numbers
                                                           // 1.5 tokens off read as nobody's)
  tokTol: 0.04,                                            // a token's ring may graze the standing ink by this share of its area
  panelPad: 8,                                             // px kept from a panel (a seat's own copy of a shared panel stands a few px off)
  slotK: 0.04, slideK: 0.06, outK: 0.6, shrinkK: 1.6, passK: 0.35,     // preference, in shares of the group's area
  grid: 0.98, gridBack: 2,                                 // SIZEDEAD: the fine grid of absolute sizes (each rung 0.98 of the last), and how many rungs
                                                           // under the biggest clean one a word stands
  memberK: 0.25                                            // a crowd's word placed by one member rather than by the crowd's box
};
/* REACTPLACE (blind review ADVS3 D4, D12: a Resolve word 650 px long began at the left tool column and put its "-10" on a token; on the
   player's seat the same word stood by ANOTHER hero; a knock-down word stood ~450 px off in the margin; a get-up word lay over the next
   token's edge for its whole hold). Three causes, all in what "clean" meant:
   1. a clean place only had to cover nothing: where it stood was not asked, so the search went up to 2.8 token sizes out and slid a word
      along a side until it lay beside a neighbour (cheaper than a third smaller): a word nobody could attribute;
   2. a token's ring could be covered by 4 % of the GROUP's area: a 600 x 200 group may lay a 50 x 100 px number on a token;
   3. a seat whose own panel covered the shared place searched the whole neighbourhood again and took any clean place there.
   The rule now (the owner: lettering tells the story of ITS token, a viewer must see at once whose word it is):
   - TETHER: the standing ink is at most TETHER.max token sizes from its token's CENTRE (max 1 = half a token from its edge), and its own
     token is clearly the nearest one: its nearness (below) is at most TETHER.lead of that of any other token nobody hides (a word under
     one hero that begins at another reads as the other's). A crowd's word is tied to its nearest member the same way (crowdMax).
   - a ring may be grazed by at most TETHER.graze of the RING's own area (a corner of a round picture), whatever the group's size;
   - nothing clean by the token even at the smallest size: the least covered tied place, where another token weighs four times the
     word's own (the sound sits over the one it belongs to rather than on a neighbour: slot "on" is tried then);
   - a token off the view letters at the view's edge as before (no tie can hold there). */
export const TETHER = { max: 1, lead: 0.9, crowdMax: 1.6, graze: 0.02, farK: 1, rivalK: 1, otherTok: 12,
  outs: [0, 0.2, 0.45], crowdOuts: [0, 0.45, 0.9, 1.4], keepK: 0.12 };
const AREA = (r) => r.w * r.h;
/** how far the rect r stands from a token: from the token's centre to the nearest point of r, in token sizes (0 = over the centre) */
export function claim(r, tok) {
  const cx = tok.x + tok.w / 2, cy = tok.y + tok.h / 2;
  const dx = Math.max(r.x - cx, 0, cx - (r.x + r.w)), dy = Math.max(r.y - cy, 0, cy - (r.y + r.h));
  return Math.hypot(dx, dy) / Math.max(1, tok.w, tok.h);
}
/** whose is the rect r? how near a token is to it: the mean of how far its nearest ink is (claim) and how far its middle is, in token sizes.
    (The nearest ink alone called a wide word centred under its token as near to that token's side neighbours as to itself; the middle
    alone forgets that a long word may touch its token with one end) */
export function nearness(r, tok) {
  const cx = tok.x + tok.w / 2, cy = tok.y + tok.h / 2;
  return (claim(r, tok) + Math.hypot(r.x + r.w / 2 - cx, r.y + r.h / 2 - cy) / Math.max(1, tok.w, tok.h)) / 2;
}
/** is the standing ink r tied to its token(s)? anchors = [its token] or a crowd's members; obs as covers(); max = TETHER.max | crowdMax
    -> { ok, d (token sizes from the nearest anchor), far (over the limit), rival (how much another token is too near), by (its id) } */
export function tie(r, anchors, obs = [], max = TETHER.max) {
  const list = (anchors ?? []).filter((t) => t && t.w > 0 && t.h > 0);
  if (!list.length) return { ok: true, d: 0, far: 0, rival: 0, by: null };
  const ids = new Set(list.map((t) => t.id).filter((x) => x != null));
  const d = Math.min(...list.map((t) => claim(r, t))), m = Math.min(...list.map((t) => nearness(r, t)));
  let rival = 0, by = null;
  for (const q of obs ?? []) {
    if (!q || q.kind !== "tok" || !(q.w > 0) || !(q.h > 0) || ids.has(q.id)) continue;
    const over = m - TETHER.lead * nearness(r, q);
    if (over > rival + 1e-9) { rival = over; by = q.id ?? null; }
  }
  const far = Math.max(0, d - max);
  return { ok: far <= 1e-9 && rival <= 1e-9, d, far, rival, by };
}
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
export function covers(r, obs, own = null, view = null, quick = false, t = null) {
  let cost = 0, clean = true;
  const A = Math.max(1, AREA(r));
  /* REACTPLACE: a ring may be grazed by a share of ITS area, never by a share of a big group's */
  const graze = (q) => Math.min(CLEAN.tokTol * A, TETHER.graze * AREA(ringRect(q)));
  if (own) { const a = inter(r, ringRect(own)); if (a > graze(own)) { clean = false; cost += a * 3; } }
  /* REACTPLACE: tied to its token (t = { anchors, max } | null: a token off the view, a caller that asks only what is covered) */
  if (t?.anchors?.length) { const q = tie(r, t.anchors, obs, t.max ?? TETHER.max); if (!q.ok) { clean = false; cost += A * (q.far * TETHER.farK + q.rival * TETHER.rivalK); } }
  for (const q of obs ?? []) {
    if (quick && !clean) return { clean, cost };      // (only whether it is clean is asked)
    if (!q || !(q.w > 0) || !(q.h > 0)) continue;
    if (q.kind === "tok") { const a = inter(r, ringRect(q)); if (a > graze(q)) { clean = false; cost += a * TETHER.otherTok; } }
    else { const d = q.kind === "panel" ? CLEAN.panelPad : 0, a = inter(r, d ? { x: q.x - d, y: q.y - d, w: q.w + 2 * d, h: q.h + 2 * d } : q); if (a > 1) { clean = false; cost += a * (q.kind === "pin" ? 3 : q.kind === "word" ? 5 : 8); } }
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
      bias: added to every place's score (a crowd's word tried beside one member: see crowdSpot), outs: how far out (CLEAN.outs) }
    -> { slot, k, c0 (centre before follow's pushes), c (where it stands), clean, cost, score } */
export function cleanSpot(a0) {
  const q = ladderSpot(a0);
  /* SIZEDEAD (seen live, lane 5: a knock-down with no room for its planned size stood 61 px at the table's "small", 43 at "normal", 37 at
     "large"): the sizes tried are a ladder of shares of the PLANNED size, so two plans of one word land on different rungs (and, the
     places tried being shares of the box, on different places): the bigger plan could end the smaller word. A clean place under the
     planned size is now looked for again on a fine grid of ABSOLUTE sizes (CLEAN.grid: the same px sizes whatever the plan, so two plans
     of one word try the very same boxes at the very same places), from the biggest size allowed down; the word stands CLEAN.gridBack
     rungs under the biggest clean one (the place is judged on the planned box; the drawn word differs from it by a few percent, and a
     word right at the edge of "its own token is the nearest" read as a neighbour's: reactplace edgeL). So where room is short every
     choice of the table draws one size, the room's, and where there is room each its own. Never over the sizes given (a size the table
     fixed, the table's size on a seat's own search), never under minK */
  if (a0.noRefine || !q?.clean) return q;
  const ks = a0.ks ?? CLEAN.ks, kMax = Math.max(...ks), unit = a0.g?.w;
  if (!(q.k < kMax - 1e-9) || !(unit > 0)) return q;
  const step = Math.log(1 / CLEAN.grid), kMin = Math.max(a0.minK ?? 0, Math.min(...ks) * 0.9);
  const kAt = (i) => Math.exp(i * step) / unit;
  let i = Math.ceil(Math.log(unit * kMax) / step - 1e-9) - 1, top = null;
  for (; kAt(i) >= Math.max(kMin, q.k * CLEAN.grid ** 6); i--) {
    const r = ladderSpot({ ...a0, ks: [kAt(i)], minK: 0, first: null });
    if (r?.clean) { top = i; break; }
  }
  if (top == null) return q;
  for (let b = CLEAN.gridBack; b <= CLEAN.gridBack + 3; b++) {
    const k = kAt(top - b);
    if (k < kMin) break;
    const r = ladderSpot({ ...a0, ks: [k], minK: 0, first: null });
    if (r?.clean) return r;
  }
  return q;
}
function ladderSpot(a0) {
  const g = a0.g, tp = a0.tokPx || Math.max(a0.tok.w, a0.tok.h) || 100;
  const ks = (a0.ks ?? CLEAN.ks).filter((k) => k >= (a0.minK ?? 0) - 1e-9);
  /* REACTPLACE: a place is tied to the word's own token (a0.own), or for a crowd's word to its nearest member (a0.members); how far out
     is tried follows from that (a place further out could never be tied) */
  const anchors = a0.own ? [a0.own] : a0.members?.length ? a0.members : null;
  const outs = a0.outs ?? (a0.own ? TETHER.outs : anchors ? TETHER.crowdOuts : CLEAN.outs);
  /* only what lies within reach of any place tried counts (the same answer, a few times faster on a crowded board) */
  const R = Math.max(...outs) * tp + Math.max(g.w, a0.eb?.w ?? 0) + Math.max(g.h, a0.eb?.h ?? 0) + (a0.reach ? Math.max(a0.reach.w, a0.reach.h) : 0);
  const zone = { x: a0.tok.x - R, y: a0.tok.y - R, w: a0.tok.w + 2 * R, h: a0.tok.h + 2 * R };
  const near = onView(a0.tok, a0.std) && onView(a0.tok, a0.safe);      // (a token off the view letters at the view's edge: everything counts)
  const a = near ? { ...a0, obs: (a0.obs ?? []).filter((q) => q && inter(q, zone) > 0), sweep: a0.sweep?.filter((q) => q && inter(q, zone) > 0) } : a0;
  const tied = near && anchors && !a0.untied ? { anchors, max: a0.own ? TETHER.max : TETHER.crowdMax } : null;
  const keepK = (slot) => (a0.keepSlot && slot === a0.keepSlot ? TETHER.keepK : 0);      // a seat keeps the table's side while it can
  let best = null, least = null;
  const judge = (slot, k, c0, pref) => {
    let score = pref + (a.bias ?? 0) + (1 - k) * CLEAN.shrinkK - keepK(slot);
    if (best && score >= best.score - 1e-9) return null;      // cannot beat the clean place found (and the least covered is not needed)
    const box = { w: g.w * k, h: g.h * k }, eb = a.eb ? { w: a.eb.w * k, h: a.eb.h * k } : box;
    const c = restCentre(c0, a.tok, box, eb, a.std, a.safe, a.panels);
    const r = standAt(c, g, k), cv = covers(r, a.obs, a.own, a.safe, !!best, tied);
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
    if (best && best.score <= (a.bias ?? 0) + (1 - k) * CLEAN.shrinkK - (a0.keepSlot ? TETHER.keepK : 0)) break;      // no place at this size or smaller can beat it
    const box = { w: g.w * k, h: g.h * k };
    FIT_SLOTS.forEach((slot, i) => {
      const p = slotPoint(slot, a.tok, box);
      const horiz = slot === "left" || slot === "right";
      const nx = slot === "right" ? 1 : slot === "left" ? -1 : 0, ny = slot === "below" ? 1 : horiz ? 0 : -1;
      const span = horiz ? (a.tok.h + box.h) / 2 : (a.tok.w + box.w) / 2;
      for (const o of outs) for (const s of CLEAN.slides) {
        const c0 = { x: p.x + nx * o * tp + (horiz ? 0 : s * span), y: p.y + ny * o * tp + (horiz ? s * span : 0) };
        judge(slot, k, c0, i * CLEAN.slotK + Math.abs(s) * CLEAN.slideK + o * CLEAN.outK);
      }
    });
    /* every size is judged: a word a little smaller beside its token beats a big one far off (it must read as that token's) */
    /* REACTPLACE: and over its own token, for when no side is clean at any size (a token ringed by others): never clean, so only the
       least covered choice can take it */
    if (a0.own && near && !a0.untied) judge("on", k, slotPoint("on", a.tok, box), FIT_SLOTS.length * CLEAN.slotK + CLEAN.outK);
  }
  return best ?? { ...least, clean: false };
}

/** A crowd's word: beside the crowd's box (a.tok), or, when the crowd fills the view round its box, beside one of its members (a crowd
    of eight round four heroes has no clean side as a whole, but its outer members do). Nearer the crowd's box wins: a member's places pay
    CLEAN.memberK, and a little more the later the member (members in the seats' common order: the same choice on every seat).
    a = cleanSpot's, members = the members' token rects */
export function crowdSpot(a, members = []) {
  const whole = cleanSpot({ ...a, members: a.members ?? members });
  if (whole.clean) return { ...whole, anchor: -1 };
  let best = null, least = { ...whole, anchor: -1 };
  members.forEach((m, i) => {
    const q = cleanSpot({ ...a, tok: m, tokPx: a.tokPx, first: null, bias: CLEAN.memberK + i * 0.01, members: a.members ?? members });
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
