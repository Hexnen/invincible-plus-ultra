// node scripts/tactics/check-rlabel.mjs -- U135: in the initiative bar the round / phase label ("R1 Początek rundy") sits above the left
// turn button. What can be held without Foundry (the DOM order and the CSS of the bar); the live look is in dev/combat-handoff.md.
import { readFileSync } from "node:fs";
import { ok, done } from "./testkit.mjs";

const here = new URL(".", import.meta.url);
const bar = readFileSync(new URL("../combat/bar.mjs", here), "utf8");
const css = readFileSync(new URL("../../styles/combat.css", here), "utf8");
const rule = (sel) => { const i = css.indexOf(`${sel} {`); return i < 0 ? "" : css.slice(i, css.indexOf("}", i)); };

ok(/head\.append\(roundEl, waitEl\)/.test(bar), "r1 the round chip and the phase plate are one label (.icbar-head)");
ok(/lead\.append\(head, prevB\)/.test(bar), "r2 the label comes first in the left column, the previous-turn button under it");
ok(/shell\.append\(lead, scroller, nextB\)/.test(bar) && !/shell\.append\(prevB/.test(bar), "r3 the band is: the left column, the strip, the next-turn button");
const lead = rule("#invincible-combat-bar .icbar-shell > .icbar-lead");
ok(/flex-direction: column/.test(lead) && /align-self: stretch/.test(lead) && /justify-content: center/.test(lead), "r4 the column stacks the label over the button, centred on the strip's height");
ok(/transform: none/.test(lead), "r5 the column leans with the band (the chip, the plate and the button keep their own transforms)");
ok(/white-space: nowrap/.test(rule("#invincible-combat-bar .icbar-head")), "r6 the label never wraps (the longest phase stays on one line)");
ok(!/\.icbar-shell > \.icbar-nav/.test(css) && /#invincible-combat-bar \.icbar-shell \.icbar-nav \{/.test(css), "r7 the turn buttons keep their look inside the column");
ok(/for \(const el of \[prevB, roundEl, waitEl, nextB\]\)/.test(bar), "r8 the chip, the plate and the buttons still glide with the strip (morph's chrome FLIP)");
{ const nav = rule("#invincible-combat-bar .icbar-lead > .icbar-nav");
  ok(/align-self: flex-end/.test(nav) && !/margin-left/.test(nav), "r9 the previous-turn button hugs the strip (the column's right edge), not the label's left end"); }
done("check-rlabel");
