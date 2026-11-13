// node scripts/tactics/check-fxu3.mjs -- FXU3: three faults a full live fight (FF6) found in the interface.
//   U202 the GM's surprise card: every row says its state (surprised / ready) by a mark and a word, never struck through; its tooltip is
//        headed by the same state; the button names what it confirms ("nobody surprised" is an answer)
//   U203 the GM desk: rows hidden under a card's held button (the round's queue) are counted on a chip beside the button
//   U207 a player's reload in mid-fight: the own unit's first frame stays due until it reaches the map; a first-use hint counts as seen
//        once shown (a reload does not bring it back)
import { readFileSync } from "node:fs";
import { ok, eqc as eq, done, seeded } from "./testkit.mjs";
import * as O from "./ops-pure.mjs";
import { EN, PL, t as say } from "./lang.mjs";
import * as UI from "./ui/model-pure.mjs";
import * as Desk from "./desk-pure.mjs";
import * as CP from "./ui/camera-pure.mjs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const t = (k, prm, fb) => say(k, prm, fb);
const names = { H1: "Omni-Man", N1: "Thug", N2: "Rat", N3: "Bat" };
const facts = { c: (id) => (names[id] ? { name: names[id] } : null) };

/* ================================================================== U202: the surprise card */
{
  const GM = { user: "gm", staff: true, owns: () => true, hold: true };
  const parts = [{ id: "H1", hero: true, owners: ["p1"], intuition: 3 }, { id: "N1", hero: false, owners: [], intuition: 6 }, { id: "N2", hero: false, owners: [], intuition: 2 }, { id: "N3", hero: false, owners: [], intuition: 4 }];
  const r = O.reduce(null, O.normalize({ op: "start", mode: "tactical", restart: true, surprise: "npcs" }, { staff: true }).action, { ...GM, parts, rng: seeded(3) });
  const dc = Desk.deskModel(r.state, null, facts).cards.find((c) => c.kind === "surprise");
  const ids = dc.options.map((o) => o.id);
  eq(ids.length, 3, "U202: three defenders on the card");
  const ad = (picks) => UI.askData(dc, { t, facts, own: { picks: { [dc.id]: picks } }, desk: true });
  const mixed = ad([ids[0]]);
  eq(mixed.options.map((o) => [o.picked, o.state?.id, o.state?.icon]), [[true, "surprised", "fa-eye-slash"], [false, "ready", "fa-eye"], [false, "ready", "fa-eye"]], "U202: a row says its state by its mark: an eye shut (surprised), an eye open (ready)");
  eq(mixed.options.map((o) => o.state.label), [EN["ITAC.ui.surprise.st.surprised"], EN["ITAC.ui.surprise.st.ready"], EN["ITAC.ui.surprise.st.ready"]], "U202: and by its word at the row's end");
  const [a, b] = mixed.options;
  eq([a.tip.title, b.tip.title], [say("ITAC.ui.surprise.is.surprised", { name: a.label }), say("ITAC.ui.surprise.is.ready", { name: b.label })], "U202: the tooltip is headed by the row's own state (no 'Surprised' over a ready row)");
  eq([a.tip.lines[1], b.tip.lines[1], b.tip.lines[2]], [say("ITAC.ui.surprise.what"), say("ITAC.ui.surprise.ready"), say("ITAC.ui.surprise.flip")], "U202: what the state does, then that a click turns it");
  const raw = dc.options;
  ok(mixed.options.every((o, i) => o.tip.lines[0] === say("ITAC.ui.opt.surprised", { name: o.label, n: raw[i].data.sixes, dice: raw[i].data.dice })), "U202: the roll in words stays the tooltip's first line (its aria-label)");
  eq([ad([]).submit.label, mixed.submit.label, ad(ids).submit.label], [say("ITAC.ui.surprise.confirm0"), say("ITAC.ui.surprise.confirm", { n: 1, max: 3 }), say("ITAC.ui.surprise.confirmAll")], "U202: the button names what it confirms: nobody, n of max, all");
  eq(ad([]).submit.req?.value, { order: [], skip: ids }, "U202: nobody surprised is an answer the button sends");
  ok(/nikt/.test(PL["ITAC.ui.surprise.confirm0"]) && !/\b0\b/.test(PL["ITAC.ui.surprise.confirm0"]), "U202: Polish: nobody surprised in words, not a zero count");
  ok(PL["ITAC.Prompt.surprise.Body"].length <= 60 && !/Zaznaczeni/.test(PL["ITAC.Prompt.surprise.Body"]), "U202: the card's line speaks of the state, not of ticks");
  const dom = read("./ui/dom.mjs"), css = read("../../styles/tactics-ui.css");
  ok(/o\.state \? h\("span\.ita-opt-st", \{ text: o\.state\.label \}\)/.test(dom) && /st: o\.state\?\.id \?\? null/.test(dom) && /icon\(o\.state\?\.icon \?\?/.test(dom), "U202: the row draws its state's mark, word and data-st");
  ok(/\.ita-opt\[data-check\]\[data-st\] \.ita-opt-l \{ text-decoration: none; \}/.test(css), "U202: a row with a state is never struck through");
  ok(/\.ita-opt\[data-check\]\[data-st="ready"\] \{ color: var\(--ita-text\); background: var\(--ita-tile-hi\); border: 1\.5px solid/.test(css), "U202: a ready row: full-strength name on a solid frame (not dashed, not dimmed)");
  /* other tick cards keep the struck-through look of an unticked line (U18: the round's queue: struck = will not happen) */
  ok(/\.ita-opt\[data-check\]\[aria-pressed="false"\] \.ita-opt-l \{ text-decoration: line-through;/.test(css), "U202: the round's queue keeps U18's struck-through 'will not happen'");
  for (const k of Object.keys(EN).filter((k) => k.startsWith("ITAC.ui.surprise.st.") || k.startsWith("ITAC.ui.surprise.is.") || k.startsWith("ITAC.ui.surprise.confirm") || k === "ITAC.ui.below")) ok(typeof PL[k] === "string" && PL[k] !== EN[k], `U202/U203: ${k} in Polish`);
}
/* ================================================================== U203: rows under the held button */
{
  const desk = read("./ui/desk.mjs"), css = read("../../styles/tactics-ui.css"), mp = read("./ui/model-pure.mjs");
  ok(/body\.addEventListener\("scroll", \(\) => below\(body\)/.test(desk), "U203: counted on every draw and every scroll of the desk's body");
  ok(/export const relayout = \(\) => \{ if \(root\) \{ place\(\); const body = [^\n]*below\(body\)/.test(desk), "U203: and on every relayout (a resize)");
  ok(/getBoundingClientRect\(\)\.bottom > edge \+ 1/.test(desk) && /sub\.after\(chip\)/.test(desk), "U203: a row whose bottom lies under the button's top is hidden; the chip stands beside the button");
  ok(/body\.scrollBy\(\{ top: Math\.ceil\(last - edge \+ 6\)/.test(desk), "U203: a click scrolls the last hidden row into view");
  ok(/if \(!hid\.length\) \{ had\?\.remove\(\); delete card\.dataset\.below; continue; \}/.test(desk), "U203: the chip goes once nothing is hidden");
  ok(/#invincible-tactics-desk \.ita-ask\[data-below\]::after \{ box-shadow: 0 -2px 0 var\(--ita-cyan\); \}/.test(css) && /#invincible-tactics-desk \.ita-ask > \.ita-below \{ position: sticky; bottom: -6px;/.test(css), "U203: the band's cyan edge and the chip held to the band");
  ok(/below: t\("ITAC\.ui\.below", \{ n: "\{n\}" \}\)/.test(mp), "U203: the chip's words come with the desk's labels");
  ok(/\{n\}/.test(EN["ITAC.ui.below"]) && /\{n\}/.test(PL["ITAC.ui.below"]), "U203: the count stands in the words");
}
/* ================================================================== U207: a reload in mid-fight */
{
  const look = (o = {}) => ({ round: 1, cur: "H1", known: ["H1", "N1"], asks: {}, mine: ["H1"], staff: false, who: "H1", sel: null, armed: null, targets: [], ...o });
  const n0 = look();
  eq(CP.cues(null, n0).map((c) => c.why), ["join"], "U207: the first look of a player frames the own unit");
  eq([CP.joinHold(null, n0), CP.joinHold(n0, look())], [true, true], "U207: the join stays due while nothing changed between looks");
  eq(CP.joinHold(null, look({ who: null, mine: [] })), true, "U207: the dock's unit not known yet: still due (tried again once it is)");
  eq(CP.joinHold(n0, look({ sel: "H1" })), false, "U207: the user's hand (a unit chosen) ends it");
  eq(CP.joinHold(n0, look({ armed: "move" })), false, "U207: an action armed ends it");
  eq(CP.joinHold(n0, look({ asks: { q1: { about: "H1", attacker: "N1" } } })), false, "U207: a question put to the user ends it");
  eq(CP.joinHold(n0, look({ cur: "N1" })), false, "U207: the turn moved on (its own cue frames the view): ends it");
  eq(CP.joinHold(null, look({ staff: true, mine: [] })), false, "U207: never on a GM seat (the GM's view stays, U152)");
  const cam = read("./ui/camera.mjs");
  ok(/if \(!before\) \{ joinStop\(\); if \(!staff\) \{ join = \{ until: Date\.now\(\) \+ JOIN_MS/.test(cam) && /else if \(join && !CP\.joinHold\(before, now\)\) joinStop\(\);/.test(cam), "U207: the camera keeps the join due from the first look, while joinHold says so");
  ok(/if \(join && c\.why === "join"\) \{ if \(spec\) joinStop\(\); else joinLater\(\); \}/.test(cam) && /const JOIN_MS = 30000;/.test(cam), "U207: a join that found no token on the map is tried again (once a second, at most 30 s)");
  const fb = read("./ui/feedback.mjs");
  ok(/if \(hint\) markSeen\(\[hint\.id\]\);/.test(fb), "U207: a hint on screen is written as seen at once (a reload does not bring it back)");
  ok(/const seenHere = \(\) => \[\.\.\.new Set\(\[\.\.\.\(boot \?\?= seenNow\(\)\), \.\.\.done\]\)\];/.test(fb) && /const seen = seenHere\(\);\n\s*hint = FP\.hintOf\(data, seen, t, !!staff\);/.test(fb), "U207: this page still shows it until it is used or put away (seen = as loaded + used here)");
  ok(/hintsSwitched\(on\) \{ try \{ if \(on\) \{ boot = \[\]; done\.clear\(\);/.test(fb), "U207: the switch turned on again brings every hint once more");
}
done("check-fxu3");
