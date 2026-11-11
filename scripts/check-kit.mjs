// node scripts/check-kit.mjs -- the shared kit (ledger U65): tokens are defined once, loaded first, and the tooltip class goes where it should.
import { readFileSync, readdirSync } from "node:fs";
import { SURFACES, tipClassFor } from "./kit.mjs";

let n = 0, bad = 0;
const ok = (cond, msg) => { n++; if (!cond) { bad++; console.log("FAIL", msg); } };
const dir = new URL("../styles/", import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), "utf8");

// 1. kit.css is the first @import of the one registered sheet that imports the rest
const imports = [...read("sheet-plus.css").matchAll(/@import url\("([^"]+)"\)/g)].map((m) => m[1]);
ok(imports[0] === "kit.css", "kit.css must be the first @import of sheet-plus.css");

// 2. every --ipu-* token a stylesheet reads is defined in kit.css (a typo would silently drop the declaration)
const kit = read("kit.css");
const defined = new Set([...kit.matchAll(/(--ipu-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
ok(defined.size >= 20, "kit.css defines the shared tokens");
for (const f of readdirSync(dir).filter((x) => x.endsWith(".css"))) {
  for (const m of read(f).matchAll(/var\((--ipu-[a-z0-9-]+)/g)) ok(defined.has(m[1]), `${f}: ${m[1]} is not defined in kit.css`);
}

// 3. the contract's values (the dock is the reference: styles/tactics-ui.css)
const tok = (name) => kit.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
const dock = read("tactics-ui.css");
ok(tok("--ipu-press") === "var(--ipu-blue)", "the hard shadow of a pressable thing is the blue");
for (const [k, d] of [["--ipu-ink", "--ita-ink"], ["--ipu-yellow", "--ita-yellow"], ["--ipu-blue", "--ita-blue"], ["--ipu-red", "--ita-red"], ["--ipu-label", "--ita-label"], ["--ipu-text", "--ita-text"], ["--ipu-frame", "--ita-frame"], ["--ipu-line", "--ita-line"], ["--ipu-cyan-lt", "--ita-cyan"], ["--ipu-red-lt", "--ita-red-lt"]]) {
  const dv = dock.match(new RegExp(`${d}:\\s*([^;]+);`))?.[1].trim();
  ok(!!dv && tok(k) === dv, `${k} (${tok(k)}) must equal the dock's ${d} (${dv})`);
}
ok(tok("--ipu-ring-w") === "3px" && tok("--ipu-ring-gap") === "2px" && tok("--ipu-ring-ink") === "#fff", "the focus ring is 3px wide, 2px away, white on ink");
ok(tok("--ipu-sink") === "2px 2px" && tok("--ipu-lift") === "-1px -1px", "hover lifts 1px, press sinks 2px");
ok(/#tooltip:is\(\.ipu-tip, \.isp-tip/.test(kit), "one tooltip panel for .ipu-tip and the chat's .isp-tip");
ok(!/#tooltip/.test(read("chat.css")), "chat.css no longer styles the tooltip itself");

// 4. unavailable is never opacity alone on a button of the surfaces brought in line
for (const [f, sel] of [["combat.css", ".icbar-nav:disabled"], ["challenges.css", ".ich-sb:disabled"], ["items.css", 'input[type="checkbox"]:disabled']]) {
  const rule = read(f).split("\n").find((l) => l.includes(sel) && l.includes("{")) ?? "";
  ok(rule.includes("dashed") && !/opacity:\s*\.\d/.test(rule), `${f}: ${sel} is dashed, not faded`);
}

// 5. the tooltip class: only tooltip owners inside a surface, never where a class is already named
const el = ({ tip = true, inSurface = true, named = false } = {}) => ({
  matches: (s) => tip && s.includes("[data-tooltip]"),
  closest: (s) => (s === "[data-tooltip-class]" ? (named ? {} : null) : s === SURFACES ? (inSurface ? {} : null) : null)
});
ok(tipClassFor(el()) === "ipu-tip", "a tooltip owner inside a surface gets ipu-tip");
ok(tipClassFor(el({ tip: false })) === null, "an element without a tooltip is left alone");
ok(tipClassFor(el({ inSurface: false })) === null, "Foundry's own interface keeps its tooltip");
ok(tipClassFor(el({ named: true })) === null, "the dock (ita-tip) and chat tags (isp-tip) keep their own class");
ok(tipClassFor(null) === null && tipClassFor({}) === null, "no element, no class");
for (const s of [".invincible.sheet", ".invincible-plus-ultra", "li.chat-message", "#invincible-party", "#invincible-challenges", "#invincible-combat-bar", "#invincible-turn-tray"]) ok(SURFACES.includes(s), `SURFACES lists ${s}`);
ok(!SURFACES.includes("tactics"), "the dock and the desk name their own tooltip class");

if (bad) { console.log(`FAIL ${bad} of ${n}`); process.exit(1); }
console.log(`OK ${n} checks (check-kit)`);
