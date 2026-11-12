// node scripts/tactics/check-fxh.mjs -- fixer H after the live verifier ver9: U124 (every roll key the engine can produce has a title in
// both languages), U123 (the dock's hint never lies over the GM desk), D118 (a lone character at 0 Health that is not marked defeated).
// What can be held without Foundry; the live look is in dev/combat-handoff.md.
import { readFileSync, readdirSync } from "node:fs";
import { ok, eq, done } from "./testkit.mjs";
import { EN, PL, tIn } from "./lang.mjs";

const here = new URL(".", import.meta.url);
const src = (f) => readFileSync(new URL(f, here), "utf8");

/* ---- U124: the roll keys. Every K.rollEffect(key, ...) in the engine's code is found and its key resolved to the kind before ":"
   (a literal, a template, a local `key = ...`, or a parameter of a helper whose call sites pass it). An unresolved key fails, so a
   new roll can never reach the strip without a title. */
const FILES = ["flows/" + "", ""].flatMap((d) => readdirSync(new URL(d || ".", here)).filter((f) => f.endsWith(".mjs") && !/^check|^testkit/.test(f)).map((f) => d + f));
const kindOfLit = (x) => { const m = /^\s*(["'`])([A-Za-z0-9_]+)(?=[:"'`$])/.exec(x); return m ? m[2] : null; };
const kinds = new Map(), unresolved = [];
const add = (k, where) => { if (!kinds.has(k)) kinds.set(k, []); kinds.get(k).push(where); };
for (const f of FILES) {
  const lines = src(f).split("\n");
  lines.forEach((ln, i) => {
    for (const m of ln.matchAll(/rollEffect\(\s*([^,]+),/g)) {
      if (/export const rollEffect/.test(ln)) continue;
      const arg = m[1].trim(), where = `${f}:${i + 1}`;
      const lit = kindOfLit(arg);
      if (lit) { add(lit, where); continue; }
      if (!/^[A-Za-z_$][\w$]*$/.test(arg)) { unresolved.push(`${where} ${arg}`); continue; }
      let found = null;
      for (let j = i; j >= Math.max(0, i - 40) && !found; j--) {                     // a local assignment above, inside the same block
        const a = new RegExp(`\\b${arg}\\s*=\\s*(["'\`][^;,]*)`).exec(lines[j]);
        if (a && kindOfLit(a[1])) found = [kindOfLit(a[1])];
        const fn = new RegExp(`function\\s+(\\w+)\\s*\\(([^)]*)\\)`).exec(lines[j]);
        if (!found && fn) {                                                         // a parameter of a helper: every call site's argument
          const idx = fn[2].split(",").map((p) => p.trim().split(/\s|=/)[0]).indexOf(arg);
          if (idx < 0) break;
          const all = lines.join("\n"), out = [];
          for (const c of all.matchAll(new RegExp(`\\b${fn[1]}\\(([^\\n]*)`, "g"))) {
            if (/^\s*function\b/.test(all.slice(Math.max(0, c.index - 9), c.index))) continue;
            const a2 = c[1].split(",")[idx]?.trim() ?? "";
            const k2 = kindOfLit(a2) ?? (() => { const pre = all.slice(0, c.index).split("\n").slice(-12).join("\n"), q = new RegExp(`\\b${a2}\\s*=\\s*(["'\`][^;,]*)`).exec(pre); return q ? kindOfLit(q[1]) : null; })();
            if (k2) out.push(k2); else unresolved.push(`${where} via ${fn[1]}(${a2})`);
          }
          found = out;
        }
      }
      if (found?.length) found.forEach((k) => add(k, where)); else if (!found) unresolved.push(`${where} ${arg}`);
    }
  });
}
eq(unresolved, [], "U124: every K.rollEffect key in the engine resolves to a kind");
ok(kinds.size >= 18, `U124: the extractor finds the engine's roll kinds (${kinds.size}: ${[...kinds.keys()].sort().join(", ")})`);
for (const k of ["roll", "attack", "def", "gate", "stun", "sw", "ds", "res", "ohs", "save", "prey", "pursuer", "obs", "dark", "bar", "start", "agi", "spin"])
  ok(kinds.has(k), `U124: the extractor sees the roll kind '${k}'`);
for (const [k, at] of kinds) {
  ok(typeof EN[`ITAC.roll.${k}`] === "string" && EN[`ITAC.roll.${k}`].trim(), `U124: ITAC.roll.${k} has an English text (${at[0]})`);
  ok(typeof PL[`ITAC.roll.${k}`] === "string" && PL[`ITAC.roll.${k}`].trim(), `U124: ITAC.roll.${k} has a Polish text (${at[0]})`);
  for (const lang of ["en", "pl"]) { const s = tIn(lang, `ITAC.roll.${k}`, {}, null); ok(s && !/ITAC\.|^[a-z0-9]+$/.test(s), `U124: ${lang} title of '${k}' reads as words: ${s}`); }
}
eq([tIn("en", "ITAC.roll.ds"), tIn("pl", "ITAC.roll.ds")], ["Discretion", "Rozwaga"], "U124: Discretion's roll (glossary: Discretion = Rozwaga)");
{ // the strip: rollLabel of model-pure, seen through the public model (the GM override rows name each roll)
  const m = src("ui/model-pure.mjs");
  ok(/const base = t\(`ITAC\.roll\.\$\{k\}`, \{\}, k\);/.test(m), "U124: the strip titles a roll by ITAC.roll.<kind> (the texts above are what it shows)");
}

/* ---- U123: the first-fight hint and the status line keep clear of the GM desk (and of whatever the bar stands below), as the panel
   and the questions do: narrowed to --itd-up-maxw and shifted by --itd-up-dx, which place() counts over all four */
{
  const css = readFileSync(new URL("../../styles/tactics-ui.css", here), "utf8"), dock = src("ui/dock.mjs");
  const rule = /\.itd-stack > :is\(([^)]*)\) \{ position: relative; left: calc\(var\(--itd-up-dx/.exec(css);
  eq(rule?.[1].split(",").map((x) => x.trim()).sort(), [".itd-asks", ".itd-hint1", ".itd-panel", ".itd-wait"], "U123: the shift and the narrowing hold for the panel, the hint, the status line and the questions");
  ok(/#invincible-tactics-dock \.itd-hint1 \{[^}]*max-width: min\(100%, 640px, calc\(var\(--itd-up-maxw, 100%\) \/ var\(--ita-scale, 1\)\)\)/.test(css), "U123: the hint's own (stronger) max-width carries the room above the bar too");
  const loop = /querySelectorAll\(":scope > :is\(([^)]*)\)"\)\) \{ const pw = el\.offsetWidth \* k; dx = /.exec(dock);
  eq(loop?.[1].split(",").map((x) => x.trim()).sort(), [".itd-asks", ".itd-hint1", ".itd-panel", ".itd-wait"], "U123: place() shifts by the widest of the four");
  ok(/root\.style\.setProperty\("--itd-up-dx"/.test(dock) && /function outcome\(\) \{[^}]*root\.style\.cssText/.test(dock), "U123: the shift is a root property, so outcome() (perf P2-1) already compares it");
}

/* ---- U123 (second cause, seen live): after a load the desk ended under the bar. The dock's first placement runs while it slides in
   (translated below the window); the bar's top it gave the desk was that off-screen place, and nothing placed again once it stood. */
{
  const dock = src("ui/dock.mjs"), desk = src("ui/desk.mjs");
  ok(/top = under && barEl \? Math\.round\(H - \(parseFloat\(root\.style\.getPropertyValue\("--itd-bottom"\)\) \|\| 0\) - \(root\.getBoundingClientRect\(\)\.bottom - barEl\.getBoundingClientRect\(\)\.top\)\) : null/.test(dock), "U123: the bar's top is where it stands (the root's place minus the bar's distance from its bottom), free of the slide-in");
  ok(/root\.style\.setProperty\("--itd-under-top", `\$\{top\}px`\)/.test(dock) && /root\.style\.removeProperty\("--itd-under-top"\)/.test(dock), "U123: the dock hands that top to the desk on its own root (in outcome() through root.style.cssText)");
  ok(/getPropertyValue\("--itd-under-top"\)/.test(desk) && /Number\.isFinite\(ut\) \? ut : r\.top/.test(desk), "U123: the desk ends above the bar's standing top, its live box only as the fallback");
  // the arithmetic: a root standing 80 px over the bottom of a 768 px window, slid 400 px down; the bar's top 139 px above the root's bottom
  const H = 768, bottom = 80, slide = 400, barFromBottom = 139, rootBottom = H - bottom + slide, barTop = rootBottom - barFromBottom;
  eq(Math.round(H - bottom - (rootBottom - barTop)), 549, "U123: the same top whether the dock is sliding in or standing");
}

done("check-fxh");
