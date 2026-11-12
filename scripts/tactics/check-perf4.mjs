// node scripts/tactics/check-perf4.mjs -- perf4 (2026-11-12): what an arm, a pick and a cancel cost the page.
//   U140's click-through rule keyed on a class of <body> with a `*` at its end made the browser restyle every element of the page
//   (~6000 with a long chat log; 85-140 ms measured live on a player's page) whenever the pick classes came or went. The same answer
//   now stands on the three panels' own roots (data-ita-aim, ui/aim-pure.mjs), written in the same task as the classes (ui/aim.mjs).
//   Guarded here: (A) the answer equals the old selector's condition for every set of classes; (B) the rule reads the roots' mark, takes
//   the same elements, and no rule of the module's tactics sheets puts a `*` behind a class of <body> again; (C) every place that changes
//   one of the classes writes the mark in the same task; the map's hook is listened to.
import { readFileSync } from "node:fs";
import { ok, eq, done } from "./testkit.mjs";
import * as P from "./ui/aim-pure.mjs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const slotsCss = read("../../styles/tactics-slots.css"), uiCss = read("../../styles/tactics-ui.css"), combatCss = read("../../styles/combat.css");
const pick = read("./ui/pick.mjs"), main = read("./ui/main.mjs"), aim = read("./ui/aim.mjs");

/* ---- A. the answer: the old selector `body.ita-tactics:is(.mm-z-picking, .itd-picking)` for every set of the four classes */
{
  const ALL = ["ita-tactics", "mm-z-picking", "itd-picking", "other"];
  for (let m = 0; m < 16; m++) {
    const cls = new Set(ALL.filter((_, i) => m & (1 << i)));
    const old = cls.has("ita-tactics") && (cls.has("mm-z-picking") || cls.has("itd-picking"));
    eq(P.aimOn((c) => cls.has(c)), old, `A: aimOn = the old selector for {${[...cls].join(", ")}}`);
  }
  eq(P.ROOTS, ["invincible-challenges", "invincible-tactics-desk", "invincible-tactics-dock"], "A: the three roots of the panels that step back");
  eq(P.changes(true, (id) => ({ "invincible-challenges": false, "invincible-tactics-desk": null, "invincible-tactics-dock": true })[id]), [["invincible-challenges", true]], "A: only a root that is there and differs is written");
  eq(P.changes(false, () => false), [], "A: nothing to write when all agree");
}

/* ---- B. the rule */
{
  const rule = /:is\(#invincible-challenges\[data-ita-aim\], #invincible-tactics-desk\[data-ita-aim\]:not\(\.igd-busy\) \.igd, #invincible-tactics-dock\[data-ita-aim\] \.its-slot\[data-slot="line"\] \.its-in\),\n:is\(#invincible-challenges\[data-ita-aim\], #invincible-tactics-desk\[data-ita-aim\]:not\(\.igd-busy\) \.igd, #invincible-tactics-dock\[data-ita-aim\] \.its-slot\[data-slot="line"\] \.its-in\) \* \{ pointer-events: none !important; \}/;
  ok(rule.test(slotsCss), "B: while aiming the challenges, a desk with nothing waiting and the line (and all inside them) take no pointer, read from the roots' mark");
  ok(/body\.ita-tactics:is\(\.mm-z-picking, \.itd-picking\) #invincible-tactics-dock \.its-slot\[data-slot="line"\] \.its-in \{ opacity: \.26; transition: opacity \.18s ease-out; \}/.test(slotsCss), "B: the dimming is untouched (same selector, same value, same transition)");
  ok(!/data-ita-aim[^{]*data-slot="cards"/.test(slotsCss), "B: the questions put to this user are never made click-through");
  /* no selector of these sheets ends in a universal part behind a class of <body> (the whole page restyled on that class) */
  const split = (list) => { const out = []; let depth = 0, cur = ""; for (const ch of list) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && !depth) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out; };
  const sels = (css) => [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g)].flatMap((m) => split(m[1]).map((s) => s.trim().replace(/\s+/g, " "))).filter((s) => s && !s.startsWith("@"));
  const behindBody = (s) => /^(html\S*\s+)?body[.:].*\s\*$/.test(s);
  const bad = [slotsCss, uiCss, combatCss].flatMap(sels).filter(behindBody);
  eq(bad, [], "B: no rule puts `*` behind a class of <body>");
  eq(sels("body.ita-tactics:is(.mm-z-picking, .itd-picking) :is(#a, #b .c) * { x: y; }").filter(behindBody).length, 1, "B: (the guard catches the old rule's shape)");
}

/* ---- C. the mark is written with the classes, in the same task */
{
  ok(/document\.body\.classList\.add\("itd-picking"\); Aim\.sync\(\);/.test(pick) && /document\.body\.classList\.remove\("itd-picking"\); Aim\.sync\(\);/.test(pick), "C: the dock's pick writes the mark with its class (on and off)");
  ok(/document\.body\.classList\.toggle\("ita-tactics", !!combat\); Aim\.sync\(\);/.test(main), "C: the surfaces' class writes it too");
  ok(/Aim\.watch\(\);/.test(main) && /Zones\.onPicking\(sync\)/.test(aim) && /Hooks\.on\("moinenMapsPicking", fn\)/.test(read("./zones-adapter.mjs")) && /observe\(document\.body, \{ attributes: true, attributeFilter: \["class"\], childList: true \}\)/.test(aim),
    "C: the map's hook (said right after its class, before its first look) and a watcher on <body> (its class, a root drawn anew)");
  ok(/toggleAttribute\(P\.ATTR, v\)/.test(aim) && P.ATTR === "data-ita-aim", "C: the mark is the attribute the rule reads");
}

done("check-perf4");
