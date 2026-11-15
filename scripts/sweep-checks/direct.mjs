/* node scripts/sweep-checks/direct.mjs -- DIRECT (2026-11-15, the owner: «fajnie jakby napisy szły w kierunku akcji»): the lettering of an
   action with a direction on the board goes that way, the same way on every seat; an action without one is lettered as before.
     W  the way: from the source's document to the target's (scene centres), none for a hidden side, the same token, a too short way
     L  the look: the engine's `from` is the opposite way (the word grows away from the source), the lean follows the way within TILT,
        a mostly vertical blow keeps its own tilt
     T  the travel: in from the source side, home on the contact, a short overshoot, a drift, out the same way; bounded by travelReach;
        none under reduced motion; a function of the word's age only
     S  seats agree: two seats with other windows, zooms, page clocks, vision and visibility of the attacker get the same way, look and pose
     N  no direction = nothing changes: fitSlot without `toward` is the old fitSlot, the splash keeps its own `from` and tilt
     V  nothing leaves the view: the travel is clamped so a word inside the view stays inside, and a word past an edge is never moved further
     F  the far side: with the view free the word stands on the struck token's side away from the attacker, never between the two
     C  the callers use it (source pins: documents only, reduced motion respected, travel on the word only). */
import fs from "node:fs";
import { ok, eq, done, summary, seeded } from "../tactics/testkit.mjs";
import * as D from "../direct.mjs";
import * as P from "../tokenreact/pure.mjs";

const src = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const doc = (id, x, y, o = {}) => ({ id, x, y, width: 1, height: 1, hidden: false, ...o });
const GS = 100;

/* ---- W: the way */
{
  const a = doc("A", 0, 0), b = doc("B", 400, 0), c = doc("C", 0, 300);
  const ab = D.between(a, b, GS);
  ok(ab && ab.ux === 1 && ab.uy === 0 && ab.ang === 0, "W: a blow to the right is 0 deg, ux 1");
  const ac = D.between(a, c, GS);
  ok(ac && ac.ux === 0 && ac.uy === 1 && ac.ang === 90, "W: a blow downward is 90 deg (screen sense)");
  const ba = D.between(b, a, GS);
  ok(ba && ba.ux === -1 && Math.abs(Math.abs(ba.ang) - 180) < 1e-9, "W: the other way round is the opposite way");
  eq(D.between(a, { document: b }, GS), ab, "W: a token or its document give the same way");
  ok(D.between(a, doc("B", 400, 0, { hidden: true }), GS) === null, "W: a target the GM hid gives no way");
  ok(D.between(doc("A", 0, 0, { hidden: true }), b, GS) === null, "W: an attacker the GM hid gives no way (DIRECT-1)");
  ok(D.between(a, a, GS) === null && D.between(a, doc("A", 50, 0), GS) === null, "W: the same token gives no way");
  ok(D.between(a, doc("X", 10, 10), GS) === null, "W: a way under a quarter square is none");
  ok(D.between(null, b, GS) === null && D.between(a, undefined, GS) === null && D.between(a, { x: NaN, y: 0 }, GS) === null, "W: missing or broken documents give none");
  const big = D.between(doc("G", 0, 0, { width: 3, height: 3 }), doc("t", 400, 100), GS);
  ok(big && Math.abs(big.ux - 1) < 1e-9 && big.uy === 0, "W: a big token's centre is its document's middle (3x3 at 0,0 -> 150,150)");
}

/* ---- L: the look */
{
  const R = seeded(11);
  let bad = 0, n = 0;
  for (let i = 0; i < 400; i++) {
    const ang = R() * 360 - 180, rad = ang * Math.PI / 180;
    const d = { ang, ux: Math.cos(rad), uy: Math.sin(rad) };
    const f = D.fromOf(d), back = Math.cos((f - ang) * Math.PI / 180);
    const own = Math.round(R() * 12 - 6), t = D.tiltOf(d, own);
    n++;
    if (back > -0.9999 || f <= -180 || f > 180) bad++;
    if (Math.abs(t) > D.TILT) bad++;
    if (Math.abs(d.ux) < D.VERT && t !== own) bad++;
    /* the lean goes with the way: down-right and up-left fall clockwise, down-left and up-right climb */
    if (Math.abs(d.ux) >= D.VERT && Math.abs(d.uy) > 0.35 && Math.sign(t) !== Math.sign(d.ux * d.uy)) bad++;
  }
  eq(bad, 0, `L: from is the opposite way, the lean within ${D.TILT} deg and with the way, a vertical blow keeps its tilt (${n} ways)`);
  ok(D.tiltOf({ ang: 0, ux: 1, uy: 0 }) < 0 && D.tiltOf({ ang: 180, ux: -1, uy: 0 }) > 0, "L: a flat blow's word climbs toward where it goes");
  eq(D.lookOf(null, 5), null, "L: no way, no look");
  eq(D.lookOf({ ang: 30, ux: Math.cos(Math.PI / 6), uy: 0.5 }, 0), { from: -150, rotation: 11 }, "L: a blow 30 deg down-right: from -150 (the source up-left), turned 11 deg clockwise");
}

/* ---- T: the travel */
{
  const R = seeded(23);
  let bad = 0;
  for (let i = 0; i < 200; i++) {
    const rad = R() * Math.PI * 2, d = { ang: 0, ux: Math.cos(rad), uy: Math.sin(rad) };
    const contact = 40 + R() * 260, holdEnd = contact + 300 + R() * 2000, reach = D.travelReach(d);
    const at = (t) => D.travelAt(d, t, { contact, holdEnd });
    const p0 = at(0), pc = at(contact), pend = at(holdEnd + D.TRAVEL.outMs + 50);
    const along = (p) => p.x * d.ux + p.y * d.uy;
    if (!(along(p0) < -1)) bad++;                                      // starts on the source side, about a cap back
    if (Math.abs(along(pc)) > 1e-6) bad++;                             // home on the contact
    if (!(along(pend) > 0.5)) bad++;                                   // leaves the same way
    for (let t = 0; t < holdEnd + 600; t += 17) {
      const p = at(t);
      if (p.x < -reach.l - 1e-3 || p.x > reach.r + 1e-3 || p.y < -reach.u - 1e-3 || p.y > reach.d + 1e-3) { bad++; break; }
      if (Math.abs(p.x * d.uy - p.y * d.ux) > 1e-2) { bad++; break; }    // only along the way, never sideways
    }
    let last = -Infinity, back = 0;
    for (let t = contact + D.TRAVEL.settle; t < holdEnd + 600; t += 17) { const s = along(at(t)); if (s < last - 1e-3) back++; last = s; }
    if (back) bad++;                                                   // after the strike it only goes on, never back
  }
  eq(bad, 0, "T: in from the source side, home on the contact, on and out the same way, within travelReach, never sideways or back (200 ways)");
  eq(D.travelAt({ ux: 1, uy: 0 }, 30, { contact: 62, holdEnd: 900, reduced: true }), { x: 0, y: 0 }, "T: reduced motion: no travel");
  eq(D.travelAt(null, 30, {}), { x: 0, y: 0 }, "T: no way: no travel");
}

/* ---- S: seats agree */
{
  const atk = doc("A", 300, 900), tgt = doc("T", 1100, 500);
  /* two seats: other windows, zooms, page clocks; the player cannot see the attacker (vision) - the way is read from documents only */
  const seat = (pageOrigin, sees) => {
    const way = D.between({ ...atk, _seen: sees }, tgt, GS);
    const look = D.lookOf(way, 3);
    const startAt = pageOrigin + 5000;                                // the table's instant on this page's clock
    const poses = [0, 40, 62, 150, 700, 1600].map((age) => D.travelAt(way, (startAt + age) - startAt, { contact: 62, holdEnd: 1400 }));
    return JSON.stringify({ way, look, poses });
  };
  eq(seat(1234.5, true), seat(98765.25, false), "S: GM and a player (other page clock, attacker out of his sight) get one way, one look, one pose per age");
  const splash = src("../splash/stage.mjs"), tr = src("../tokenreact/main.mjs"), main = src("../splash/main.mjs");
  ok(/function rollerIdOf\(message\)[\s\S]{0,400}sp\.token \?\? message\.speakerActor/.test(main) && !/function rollerIdOf\(message\)[\s\S]{0,400}seesToken/.test(main), "S: the splash's roller for the way is the speaker's token on every seat (no seat's vision)");
  ok(/function splashDir[\s\S]{0,900}\.document[\s\S]{0,300}Dir\.between/.test(splash) && !/function splashDir[\s\S]{0,900}seesToken/.test(splash), "S: the splash's way from documents only");
  ok(/function directionOf\(it\)[\s\S]{0,400}Dir\.between\(src\.document, it\.tok\.document/.test(tr) && !/function directionOf\(it\)[\s\S]{0,400}(seatOf|visible|seesToken)/.test(tr), "S: the token reaction's way from documents only");
}

/* ---- N: no direction = nothing changes */
{
  const R = seeded(5);
  let diff = 0, n = 0;
  for (let i = 0; i < 300; i++) {
    const tok = { x: 200 + R() * 1200, y: 100 + R() * 700, w: 60 + R() * 200, h: 60 + R() * 200 };
    const box = { w: 80 + R() * 400, h: 40 + R() * 160 };
    const safe = { l: 60, t: 40, r: 1550, b: 860 };
    const blocked = Array.from({ length: Math.floor(R() * 4) }, () => ({ x: R() * 1500, y: R() * 800, w: 100, h: 100, k: 3.5 }));
    const keep = R() < 0.3 ? P.FIT_SLOTS[Math.floor(R() * P.FIT_SLOTS.length)] : null;
    const a = P.fitSlot(tok, box, safe, blocked, { keep }), b = P.fitSlot(tok, box, safe, blocked, { keep, toward: null });
    n++; if (JSON.stringify(a) !== JSON.stringify(b)) diff++;
  }
  eq(diff, 0, `N: fitSlot with no way is the old fitSlot (${n} random scenes)`);
  const splash = src("../splash/stage.mjs"), tr = src("../tokenreact/main.mjs");
  ok(/\n\s*if \(Number\.isFinite\(base\.from\) && it\.from != null\) o\.from = base\.from;\s*\n\s*else if \(Number\.isFinite\(it\.from\)\) o\.from = it\.from;/.test(splash) && !/function engineOpts[\s\S]{0,900}dirFrom/.test(splash), "N: a splash word is measured and laid out with its own `from` (by its block side), with or without a way");
  ok(/\n\s*if \(Number\.isFinite\(it\.dirFrom\)\) o\.from = it\.dirFrom;/.test(splash.slice(splash.indexOf("function letterOpts"))), "N: only the played word of an attack with a way grows along it (letterOpts)");
  ok(/ctl\.dir = word && !ev\.fail \? splashDir/.test(splash) && /if \(ctl\.dir\) \{ word\.dir = ctl\.dir;/.test(splash), "N: only an attack that landed and has a way changes the splash word (a miss falls as before: DIRECT-2)");
  ok(/\.\.\.\(Number\.isFinite\(lk\.from\) \? \{ from: lk\.from \} : \{\}\)/.test(tr) && /if \(dl\) \{ it\.lk\.rotation = dl\.rotation; it\.lk\.from = dl\.from; \}/.test(tr), "N: a token reaction without a way keeps its options (no from, its own tilt)");
  ok(/if \(it\.cluster \|\| !it\.pub\?\.src/.test(tr), "N: a crowd's shared word and a blow without an attacker have no way (DIRECT-4)");
}

/* ---- V: nothing leaves the view */
{
  const R = seeded(31);
  let out = 0, further = 0, n = 0;
  for (let i = 0; i < 3000; i++) {
    const safe = { l: R() * 100, t: R() * 80, r: 1200 + R() * 400, b: 700 + R() * 200 };
    const hw = 20 + R() * 300, hh = 10 + R() * 120;
    const c = { x: safe.l + R() * (safe.r - safe.l), y: safe.t + R() * (safe.b - safe.t) };
    const rad = R() * Math.PI * 2, cap = 20 + R() * 140, t = R() * 2500;
    const q = D.travelAt({ ux: Math.cos(rad), uy: Math.sin(rad) }, t, { contact: 62, holdEnd: 1500 });
    const d = D.clampTravel(c, { x: q.x * cap, y: q.y * cap }, hw, hh, safe);
    const inside = (p) => p.x - hw >= safe.l - 1e-6 && p.x + hw <= safe.r + 1e-6 && p.y - hh >= safe.t - 1e-6 && p.y + hh <= safe.b + 1e-6;
    const dist = (p) => Math.max(0, safe.l - (p.x - hw), (p.x + hw) - safe.r) + Math.max(0, safe.t - (p.y - hh), (p.y + hh) - safe.b);
    const p = { x: c.x + d.x, y: c.y + d.y };
    n++;
    if (inside(c) && !inside(p)) out++;
    if (dist(p) > dist(c) + 1e-6) further++;
  }
  eq(out, 0, `V: a word inside the view stays inside through its whole travel (${n} cases)`);
  eq(further, 0, "V: a word past an edge is never moved further out by its travel");
  const splash = src("../splash/stage.mjs"), tr = src("../tokenreact/main.mjs");
  ok(/Dir\.clampTravel\(c, \{ x: q\.x \* px, y: q\.y \* px \}, eb\.w \/ 2, eb\.h \/ 2, safe\)/.test(tr), "V: the token reaction's travel is clamped by the word's whole entrance reach into this seat's safe view");
  ok((splash.match(/Dir\.clampTravel\(/g) ?? []).length >= 2, "V: the splash's travel is clamped into the window (screen and map words)");
}

/* ---- F: the far side */
{
  const tok = { x: 700, y: 400, w: 100, h: 100 }, box = { w: 180, h: 70 }, safe = { l: 0, t: 0, r: 1600, b: 900 };
  const side = (ux, uy) => P.fitSlot(tok, box, safe, [], { toward: { ux, uy } }).slot;
  ok(["aboveR", "right"].includes(side(1, 0)), `F: a blow from the left: the word stands right of the token (${side(1, 0)})`);
  ok(["aboveL", "left"].includes(side(-1, 0)), `F: a blow from the right: the word stands left of the token (${side(-1, 0)})`);
  ok(!["above", "aboveL", "aboveR"].includes(side(0, 1)), `F: a blow from above: the word does not stand above the token (${side(0, 1)}; "below" costs the token's ring, an older rule)`);
  eq(side(0, -1), "above", "F: a blow from below: the word stands above the token");
  const near = { left: [-1, 0], right: [1, 0], above: [0, -1], below: [0, 1], aboveL: [-0.7, -0.7], aboveR: [0.7, -0.7] };
  let between = 0;
  for (let a = 0; a < 360; a += 15) {
    const ux = Math.cos(a * Math.PI / 180), uy = Math.sin(a * Math.PI / 180), s = side(ux, uy), v = near[s];
    if (v && v[0] * ux + v[1] * uy < -0.2) between++;
  }
  eq(between, 0, "F: in an open view the word never stands on the attacker's side of its token (24 ways)");
  const blocked = [{ x: 800, y: 300, w: 400, h: 300, k: 3.5 }];      // a neighbour right of the token
  ok(P.fitSlot(tok, box, safe, blocked, { toward: { ux: 1, uy: 0 } }).slot !== "right", "F: covering a neighbour still costs more than the far side is worth");
}

/* ---- C: the callers */
{
  const tr = src("../tokenreact/main.mjs"), splash = src("../splash/stage.mjs");
  ok(/if \(member < 0 && plan\.trav\)/.test(tr), "C: only the word travels; its numbers stand still");
  ok(/plan\.trav = \{ t0: word\.opts\.startAt, contact, holdEnd: entMs \+ lk\.hold, reduced: !!\(red \|\| word\.reducedMotion\) \}/.test(tr), "C: the token word travels on its own start (the table's instant) and contact, and not on a reduced seat");
  ok(/if \(it\.role === 'word' && it\.dir && !o\.reduced\)/.test(splash), "C: the splash's result word travels, never on a reduced seat");
  ok(/if \(it\.go\) it\.go\(p\); else it\.h\.moveTo\(p\);/.test(splash), "C: the block's moves (follow, shake) keep a travelling word's travel");
  ok(/toward: it\.dir/.test(tr) && /if \(toward\) s \+= slotBias\(slot, toward, b\.w \* b\.h\)/.test(src("../tokenreact/pure.mjs")), "C: the reaction's side search prefers the far side");
}

done("direct");
const sm = summary();
console.log(`sweep direct: ${sm.checks} checks, ${sm.failed} failed`);
process.exit(sm.failed ? 1 : 0);
