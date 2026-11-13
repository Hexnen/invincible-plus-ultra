/* node scripts/tactics/check-radr.mjs -- package RADR: the attribute radar ("spider") of a character in the statistics window.
   A. the model: every listed character gets its six current values, one scale for the rail (at least 6, even); B. honesty: the model asks
   the sheet only for characters this viewer already has on the rail (a player never reads an NPC's or a hidden one's attributes), never for
   a challenge or a vehicle, and no radar in the players and fights tabs; C. bad values (no actor, no attributes, NaN) draw nothing;
   D. the geometry (clockwise from the top, clamped); E. strings; F. source pins (the window draws it in the characters tab only, the hooks
   are released on close, no HTML strings). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ok, eq, done } from "./testkit.mjs";
import * as P from "../stats/pure.mjs";
import * as M from "../stats/model.mjs";
import * as L from "../stats/lang.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, "..", "..", f), "utf8");
const SHEETS = {
  A_H1: { fighting: 4, agility: 3, strength: 5, reason: 2, intuition: 3, presence: 2 },
  A_H2: { fighting: 2, agility: 7, strength: 1, reason: 4, intuition: 2, presence: 3 },
  A_N1: { fighting: 11, agility: 2, strength: 9, reason: 1, intuition: 1, presence: 1 },
  A_CH: { fighting: 2, agility: 2, strength: 2, reason: 2, intuition: 2, presence: 2 },
  A_BAD: { fighting: "x", agility: 2, strength: 2, reason: 2, intuition: 2, presence: 2 }
};
const asked = [];
const names = {
  t: L.t, attr: (x) => `[${x}]`, action: (x) => x, stunt: (x) => x, out: (x) => x, user: () => null, when: () => "t",
  players: () => [{ id: "p1", name: "Gracz 1" }, { id: "p2", name: "Gracz 2" }],
  attrs: (id) => { asked.push(id); return SHEETS[id] ?? null; }
};
const roll = (id, a, t = 10, x = {}) => ({ id, k: "roll", m: "l", t, a, n: 3, s: 1, ...x });
const data = {
  actors: { A_H1: { n: "Anna", h: 1, own: ["p1"], ty: "superhero" }, A_H2: { n: "Bolek", h: 1, own: ["p2"], ty: "superhero" }, A_N1: { n: "Thug", h: 0, own: [], ty: "npc" },
    A_CH: { n: "Reactor", h: 0, own: [], ty: "challenge" }, A_GONE: { n: "Gone", h: 1, own: ["p1"], ty: "superhero" }, A_BAD: { n: "Bad", h: 0, own: [], ty: "npc" } },
  facts: [roll("r1", "A_H1"), roll("r2", "A_H1", 11), roll("r3", "A_H2"), roll("r4", "A_N1"), roll("r5", "A_CH"), roll("r6", "A_GONE"), roll("r7", "A_BAD"), roll("r8", "A_N1", 12, { v: 1 })],
  fights: {}
};
const view = (vw, ui) => { asked.length = 0; return M.view(data, vw, { period: "all", ...ui }, names); };

/* ---- A. the model */
{
  const v = view({ gm: false, id: "p2" }, { tab: "chars", sel: "A_H1" });
  eq(v.detail.radar.axes.map((a) => [a.id, a.v]), [["fighting", 4], ["agility", 3], ["strength", 5], ["reason", 2], ["intuition", 3], ["presence", 2]], "A: the six attributes in the system's order with their current values");
  eq(v.detail.radar.axes[0].label, "[fighting]", "A: the axis names come from the attribute names");
  eq(v.detail.radar.top, 8, "A: one scale for the rail: the highest listed value (Bolek's 7) rounded up to even");
  const w = view({ gm: false, id: "p2" }, { tab: "chars", sel: "A_H2" });
  eq(w.detail.radar.top, 8, "A: the same scale on the other character");
  eq(M.radarTop([[1, 2, 3, 2, 1, 1]]), 6, "A: the scale is at least 6");
  eq(M.radarTop([]), 6, "A: an empty rail still has a scale");
  eq(M.radarTop([[12, 1, 1, 1, 1, 1]]), 12, "A: the system's top attribute 12 fits");
  const g = view({ gm: true, id: "gm" }, { tab: "chars", side: "n", sel: "A_N1" });
  eq([g.detail.radar.axes[0].v, g.detail.radar.top], [11, 12], "A: the GM's NPC switch: the NPC's spider on the NPCs' own scale");
}

/* ---- B. honesty */
{
  view({ gm: false, id: "p1" }, { tab: "chars" });
  ok(asked.length > 0 && asked.every((id) => ["A_H1", "A_H2", "A_GONE"].includes(id)), "B: a player's window reads only the party's sheets, never an NPC's");
  const h = view({ gm: true, id: "gm" }, { tab: "chars", side: "h" });
  ok(!asked.includes("A_N1") && !asked.includes("A_CH"), "B: the GM's heroes view does not read the NPCs (their values do not set the heroes' scale)");
  eq(h.detail.radar.top, 8, "B: the heroes' scale is the heroes' own");
  const c = view({ gm: true, id: "gm" }, { tab: "chars", side: "n", sel: "A_CH" });
  eq([c.detail.id, c.detail.radar], ["A_CH", null], "B: no spider for a challenge");
  ok(!asked.includes("A_CH"), "B: a challenge's sheet is not even read");
  const pl = view({ gm: false, id: "p1" }, { tab: "players" });
  ok(!("radar" in pl.detail) && asked.length === 0, "B: the players tab draws no spider and reads no sheet (RADR-3)");
  const f = view({ gm: false, id: "p1" }, { tab: "fights" });
  ok(asked.length === 0 && !f.detail?.radar, "B: the fights tab reads no sheet");
  const hidden = { ...data, facts: [roll("r1", "A_H1"), roll("rN", "A_N1", 10, { v: 1 })] };
  asked.length = 0; M.view(hidden, { gm: false, id: "p1" }, { tab: "chars", period: "all" }, names);
  ok(!asked.includes("A_N1"), "B: an NPC known only from a GM-only fact is never read for a player");
}

/* ---- C. bad values */
{
  const gone = view({ gm: false, id: "p1" }, { tab: "chars", sel: "A_GONE" });
  eq([gone.detail.id, gone.detail.radar], ["A_GONE", null], "C: a character whose actor is gone has no spider (the rest of its entry stays)");
  const bad = view({ gm: true, id: "gm" }, { tab: "chars", side: "n", sel: "A_BAD" });
  eq(bad.detail.radar, null, "C: a sheet with a non-number draws nothing");
  eq(M.attrValues({ fighting: -2, agility: 2.6, strength: "3", reason: 0, intuition: 1, presence: 12 }), [0, 3, 3, 0, 1, 12], "C: values are whole numbers, never below 0");
  eq([M.attrValues(null), M.attrValues({ fighting: 1 })], [null, null], "C: missing attributes are no values");
  const noFn = M.view(data, { gm: false, id: "p1" }, { tab: "chars", period: "all" }, { ...names, attrs: undefined });
  eq(noFn.detail.radar, null, "C: without a sheet reader (an older caller) the entry still draws");
}

/* ---- D. the geometry */
{
  eq(M.radarPoint(0, 6, 6, 64, 130, 107), [130, 43], "D: the first axis points up");
  const [x1, y1] = M.radarPoint(1, 6, 6, 64, 130, 107);
  ok(x1 > 130 && y1 < 107, "D: the second axis goes clockwise, up and right");
  eq(M.radarPoint(3, 6, 6, 64, 0, 0), [0, 64], "D: the fourth axis points down");
  eq(M.radarPoint(2, 0, 6, 64, 5, 5), [5, 5], "D: 0 is the centre");
  eq(M.radarPoint(0, 20, 6, 64), M.radarPoint(0, 6, 6, 64), "D: a value over the scale stays on the outer ring");
  eq(M.radarPoint(0, 3, 0, 64), [0, 0], "D: a zero scale does not divide by zero");
}

/* ---- E. strings */
{
  for (const k of ["IPU.Stats.radar", "IPU.Stats.radar.tip"]) {
    const en = L.tIn("en", k, { top: 8 }), pl = L.tIn("pl", k, { top: 8 });
    ok(en !== k && pl !== k && en !== pl, `E: ${k} in both languages`);
  }
  eq(L.tIn("pl", "IPU.Stats.radar"), "Atrybuty", "E: the Polish name is the system's word");
  ok(/8/.test(L.tIn("pl", "IPU.Stats.radar.tip", { top: 8 })), "E: the tooltip names the scale's top");
}

/* ---- F. source pins */
{
  const app = read("scripts/stats/app.mjs"), ui = read("scripts/stats/radar-ui.mjs"), css = read("styles/stats.css");
  ok(/vm\.tab === "chars" \? radarFigure\(d\.radar, t\)/.test(app), "F: the window draws the spider in the characters tab only");
  ok(/Hooks\.off\(ev, id\)/.test(app) && /_onClose[^\n]*#hooks/.test(app), "F: the sheet hooks are released when the window closes");
  ok(/#attrV\}\|/.test(app), "F: a sheet change is part of the repaint key");
  ok(!/innerHTML|insertAdjacentHTML/.test(ui), "F: the spider is built from nodes, no HTML strings (names are user text)");
  ok(/role", "img"/.test(ui) && /aria-label/.test(ui), "F: the figure says its values to a screen reader");
  ok(/\.ipu-st-radar \{/.test(css) && /\.ipu-st-top \{[^}]*flex-wrap: wrap/.test(css), "F: the head wraps the spider under the name when narrow");
}
done("check-radr");
