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
  /* U132: only the panel stands over the bar now; the hint and the line have their own places at the top */
  ok(/\.itd-stack > \.itd-panel \{ position: relative; left: calc\(var\(--itd-up-dx, 0px\) \/ var\(--ita-scale, 1\)\); max-width: min\(100%, calc\(var\(--itd-up-maxw, 100%\)/.test(css) && !/\.itd-stack > :is\(/.test(css), "U123 (U132): the shift and the narrowing hold for the panel, the one thing over the bar");
  ok(/if \(pe\) \{ const pw = pe\.offsetWidth \* k; dx = /.test(dock), "U123 (U132): place() shifts by the panel's width");
  ok(/root\.style\.setProperty\("--itd-up-dx"/.test(dock) && /function outcome\(\) \{[^}]*root\.style\.cssText/.test(dock), "U123: the shift is a root property, so outcome() (perf P2-1) already compares it");
}

/* ---- U123 (second cause, seen live): after a load the desk ended under the bar. The dock's first placement runs while it slides in
   (translated below the window). U132: the frame takes the bar's top from where the bar STANDS (its bottom from the room, its height
   from its layout box), never from its box on screen, and the desk ends above that top through the frame. */
{
  const dock = src("ui/dock.mjs"), desk = src("ui/desk.mjs"), sp = src("ui/slots-pure.mjs");
  ok(/const barH = \(barEl\?\.offsetHeight \?\? 60\) \* k, barTop = H - bottom - barH;/.test(dock) && !/barEl\.getBoundingClientRect|rec\.rect\(barEl\)/.test(dock), "U123 (U132): the bar's top is where it stands, free of the slide-in");
  ok(/if \(under\) floor = Math\.min\(floor, bar\.bottom - Math\.max\(bar\.bottom - bar\.top, SIZE\.bar2 \* k\) - 10\);/.test(sp) && /fr\.desk\.floor - fr\.desk\.top/.test(desk), "U123 (U132): the desk ends above the bar's standing top (the frame's floor)");
}

done("check-fxh");
