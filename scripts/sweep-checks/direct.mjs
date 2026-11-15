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
  ok(/\.\.\.\(Number\.isFinite\(lk\.from\) \? \{ from: lk\.from \} : \{\}\)/.test(tr) && /if \(dl\) \{ it\.lk\.rotation = dl\.rotation; it\.lk\.from = dl\.from; if \(dl\.dir\) it\.lk\.dirSign = dl\.dir; \}/.test(tr) && /\.\.\.\(Number\.isFinite\(lk\.dirSign\) \? \{ dir: lk\.dirSign \} : \{\}\)/.test(tr), "N: a token reaction without a way keeps its options (no from, no dir, its own tilt)");
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
  ok(/const w = Dir\.wallTravel\(c, \{ x: q\.x \* px, y: q\.y \* px \}, eb\.w \/ 2, eb\.h \/ 2, tr, plan\.dir\);\s*\n\s*const d = Dir\.clampTravel\(c, w, eb\.w \/ 2, eb\.h \/ 2, safe\);/.test(tr), "V: the token reaction's knock is cut at its struck token, then clamped by the word's whole entrance reach into this seat's safe view");
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
  /* DIRECT2: the whole group is knocked (its numbers ride with the word: a knock of a cap and more would run the word into its own "-2") */
  ok(/\n\s*if \(plan\.trav\) \{\s*\n\s*const q = Dir\.knockAt\(plan\.dir, performance\.now\(\) - plan\.trav\.t0, plan\.trav\)/.test(tr), "C: the reaction group (word and numbers) is knocked along the blow on the word's clock");
  ok(/plan\.trav = \{ t0: word\.opts\.startAt, contact, holdEnd: entMs \+ lk\.hold, k: Dir\.knockK\(lk\.magnitude\), reduced: !!\(red \|\| word\.reducedMotion\) \}/.test(tr), "C: the token word travels on its own start (the table's instant) and contact, weighted by the blow, and not on a reduced seat");
  ok(/if \(it\.role === 'word' && it\.dir && !o\.reduced\)/.test(splash), "C: the splash's result word travels, never on a reduced seat");
  ok(/if \(it\.go\) it\.go\(p\); else it\.h\.moveTo\(p\);/.test(splash), "C: the block's moves (follow, shake) keep a travelling word's travel");
  ok(/toward: it\.dir/.test(tr) && /if \(toward\) s \+= slotBias\(slot, toward, b\.w \* b\.h\)/.test(src("../tokenreact/pure.mjs")), "C: the reaction's side search prefers the far side");
}

/* ---- DIRECT2 (the owner on the DIRECT film: «Kierunek mocniejszy»): the token reaction's knock, harder lean, the engine's sign ---- */
{
  const K = D.KNOCK, R = seeded(77);
  /* K1 the knock's shape: back on the contact, past its place within fly, home after the settle, then only on, out the same way */
  let bad = 0;
  for (let i = 0; i < 300; i++) {
    const rad = R() * Math.PI * 2, d = { ux: Math.cos(rad), uy: Math.sin(rad) }, k = D.knockK(R() * 1.2);
    const contact = 40 + R() * 200, holdEnd = contact + 500 + R() * 1800, o = { contact, holdEnd, k }, reach = D.knockReach(d, k);
    const along = (t) => { const p = D.knockAt(d, t, o); return p.x * d.ux + p.y * d.uy; };
    if (Math.abs(along(contact) + K.back * k) > 0.01) bad++;
    let peak = -Infinity; for (let t = contact; t <= contact + K.fly; t += 5) peak = Math.max(peak, along(t));
    if (Math.abs(peak - K.over * k) > 0.02) bad++;
    let last = -Infinity, backs = 0;
    for (let t = contact + K.fly + K.settle; t < holdEnd + K.outMs + 100; t += 16) { const s = along(t); if (s < last - 1e-3) backs++; last = s; }
    if (backs) bad++;
    if (!(along(holdEnd + K.outMs + 50) >= (K.drift + K.outD) * k - 0.01)) bad++;
    for (let t = 0; t < holdEnd + 600; t += 16) {
      const p = D.knockAt(d, t, o);
      if (p.x < -reach.l - 2e-3 || p.x > reach.r + 2e-3 || p.y < -reach.u - 2e-3 || p.y > reach.d + 2e-3) { bad++; break; }
      if (Math.abs(p.x * d.uy - p.y * d.ux) > 1e-2) { bad++; break; }
    }
  }
  eq(bad, 0, "K1: the knock lands back toward the source on the contact, flies past its place by `over`, then only on and out the same way, within knockReach, never sideways (300 ways)");
  eq(D.knockAt({ ux: 1, uy: 0 }, 300, { contact: 62, holdEnd: 900, reduced: true }), { x: 0, y: 0 }, "K1: reduced motion: no knock");
  eq(D.knockAt(null, 300, { contact: 62, holdEnd: 900 }), { x: 0, y: 0 }, "K1: no way: no knock");
  /* K2 stronger than DIRECT, measured: what the eye can follow AFTER the contact (the arrival inside a slam's 62 ms contact is ~4 frames) */
  const d = { ux: 1, uy: 0 }, c = 62, he = 1400, path = (f) => { let L = 0, p = f(c); for (let t = c + 16; t <= he + 400; t += 16) { const q = f(t); L += Math.abs(q - p); p = q; } return L; };
  const oldS = (t) => D.travelAt(d, t, { contact: c, holdEnd: he }).x, newS = (t) => D.knockS(t, { contact: c, holdEnd: he, k: D.knockK(0.5) });
  const fast = (f) => f(c + 250) - f(c);
  ok(fast(newS) >= 1.1 && fast(newS) >= 4 * fast(oldS), `K2: in the 250 ms after the contact the word moves ${fast(newS).toFixed(2)} caps (DIRECT ${fast(oldS).toFixed(2)})`);
  ok(path(newS) >= 2 * path(oldS), `K2: its path after the contact is ${path(newS).toFixed(2)} caps (DIRECT ${path(oldS).toFixed(2)})`);
  ok(newS(he) >= 1.4 * oldS(he), `K2: the slide while it stands reaches ${newS(he).toFixed(2)} caps (DIRECT ${oldS(he).toFixed(2)})`);
  /* K3 the blow's weight */
  let mono = true; for (let m = 0; m < 1.2; m += 0.05) if (D.knockK(m + 0.05) < D.knockK(m)) mono = false;
  ok(mono && D.knockK(0) === 0.85 && D.knockK(1.2) <= 1.25 && D.knockK(NaN) === D.knockK(0.5), "K3: a heavier blow knocks farther (0.85..1.25), a missing magnitude counts as an ordinary blow");
  /* K4 never forward into the struck token; back toward the source untouched */
  let into = 0, cutBack = 0, n = 0;
  for (let i = 0; i < 4000; i++) {
    const tok = { x: 300 + R() * 900, y: 200 + R() * 500, w: 40 + R() * 200, h: 40 + R() * 200 };
    const hw = 20 + R() * 200, hh = 10 + R() * 80, c0 = { x: tok.x + tok.w / 2 + (R() - 0.5) * 900, y: tok.y + tok.h / 2 + (R() - 0.5) * 600 };
    const rad = R() * Math.PI * 2, u = { ux: Math.cos(rad), uy: Math.sin(rad) }, s = (R() - 0.3) * 300;
    const off = { x: s * u.ux, y: s * u.uy }, w = D.wallTravel(c0, off, hw, hh, tok, u);
    const ov = (p) => Math.max(0, Math.min(p.x + hw, tok.x + tok.w) - Math.max(p.x - hw, tok.x)) * Math.max(0, Math.min(p.y + hh, tok.y + tok.h) - Math.max(p.y - hh, tok.y));
    n++;
    if (s > 0 && ov({ x: c0.x + w.x, y: c0.y + w.y }) > ov(c0) + 0.5) into++;
    if (s <= 0 && (w.x !== off.x || w.y !== off.y)) cutBack++;
  }
  eq(into, 0, `K4: a forward knock never covers more of its struck token than the word at its place (${n} cases)`);
  eq(cutBack, 0, "K4: the knock back toward the source (bursting out of the token) is not cut");
  eq(D.wallTravel({ x: 0, y: 0 }, { x: 50, y: 0 }, 10, 10, null, { ux: 1, uy: 0 }), { x: 50, y: 0 }, "K4: no token rect: the knock is not cut");
  /* L2 the reaction's harder lean: within LEAN_REACT.tilt, with the way, stronger than DIRECT's on a slanted blow; the splash keeps DIRECT's */
  let lb = 0, stronger = 0, slanted = 0;
  for (let a = -180; a < 180; a += 3) {
    const r = a * Math.PI / 180, dd = { ang: a, ux: Math.cos(r), uy: Math.sin(r) }, t = D.tiltOf(dd, 2, D.LEAN_REACT), t0 = D.tiltOf(dd, 2);
    if (Math.abs(t) > D.LEAN_REACT.tilt) lb++;
    if (Math.abs(dd.ux) < D.VERT && t !== 2) lb++;
    if (Math.abs(dd.ux) >= D.VERT && Math.abs(dd.uy) > 0.35 && Math.sign(t) !== Math.sign(dd.ux * dd.uy)) lb++;
    if (Math.abs(dd.ux) >= D.VERT && Math.abs(dd.uy) > 0.2) { slanted++; if (Math.abs(t) > Math.abs(t0)) stronger++; }
  }
  eq(lb, 0, `L2: the reaction's lean stays within ${D.LEAN_REACT.tilt} deg, goes with the way, a vertical blow keeps its own tilt`);
  eq(stronger, slanted, `L2: on every slanted blow (${slanted}) the reaction leans harder than DIRECT did`);
  ok(Math.abs(D.tiltOf({ ux: 1, uy: 0 }, 0, D.LEAN_REACT)) > Math.abs(D.tiltOf({ ux: 1, uy: 0 }, 0)), "L2: a flat blow's word climbs more than under DIRECT");
  const splash = src("../splash/stage.mjs"), tr = src("../tokenreact/main.mjs");
  ok(/word\.rot0 = Dir\.tiltOf\(ctl\.dir, word\.rot0 \?\? 0\);/.test(splash), "L2: the splash keeps DIRECT's lean (its block is laid out with it)");
  ok(/Dir\.lookOf\(it\.dir, it\.lk\.rotation, Dir\.LEAN_REACT\)/.test(tr), "L2: the token reaction asks for its harder lean");
  /* E1 the engine's own sideways motions go the blow's way (REQUESTS DIRECT-E1: the sign was the seed's) */
  ok(D.signOf({ ux: 0.8, uy: 0.6 }) === 1 && D.signOf({ ux: -0.8, uy: 0.6 }) === -1 && D.signOf({ ux: 0.1, uy: 0.99 }) === null && D.signOf(null) === null, "E1: the sign is the blow's side, none for a vertical blow");
  eq(D.lookOf({ ang: 180, ux: -1, uy: 0 }, 0, D.LEAN_REACT).dir, -1, "E1: a blow to the left hands the engine dir -1");
  ok(!("dir" in D.lookOf({ ang: 180, ux: -1, uy: 0 }, 0)), "E1: without a lean profile (the splash) the look has no dir: the splash is unchanged");
  ok(/if \(dl\.dir\) it\.lk\.dirSign = dl\.dir;/.test(tr) && /\.\.\.\(Number\.isFinite\(lk\.dirSign\) \? \{ dir: lk\.dirSign \} : \{\}\)/.test(tr), "E1: the reaction word's play options carry the sign");
  const M = await import("../letters/motion.mjs");
  const rec = (dir) => { const m = M.motionOf({ kind: "punch", mood: "impact", sound: { loud: 0.8, sharp: 0.8 }, dir, pin: { holdKind: "recoil" } }); let s = 0; for (let t = 0; t < 400; t += 10) s += M.holdPose(m, t, 400).x; return s; };
  ok(rec(-1) < 0 && rec(1) > 0, "E1: the engine reads it (motion.mjs: a recoil goes left with dir -1, right with dir 1)");
  /* S2 seats agree on the knock: one pose per age whatever the page clock (the knock is in caps; px = caps x this seat's cap) */
  const pose = (origin) => [0, 62, 120, 300, 800, 1500, 1700].map((age) => D.knockAt({ ux: 0.6, uy: 0.8 }, (origin + age) - origin, { contact: 62, holdEnd: 1400, k: D.knockK(0.7) }));
  eq(JSON.stringify(pose(1234.5)), JSON.stringify(pose(98765.25)), "S2: GM and player get one knock pose per age");
}

done("direct");
const sm = summary();
console.log(`sweep direct: ${sm.checks} checks, ${sm.failed} failed`);
process.exit(sm.failed ? 1 : 0);
