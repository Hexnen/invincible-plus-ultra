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

// 6. the system's roll dialog (ledger U69): drawn from the kit's tokens, one main way to roll, nothing of the system rewired
{
  const { mainWay, areWays, WIDTH } = await import("./rolldialog.mjs");
  const rd = read("rolldialog.css");
  ok(imports.includes("rolldialog.css"), "rolldialog.css is imported by sheet-plus.css");
  const rules = rd.replace(/\/\*[\s\S]*?\*\//g, "");
  ok(!/#(?:0c1a2e|ffe72a|3465a3|a9bcdc|d5dff0|7d93b9|6b82a6)\b/i.test(rules), "rolldialog.css takes the kit's colours from the tokens, not as literals");
  ok(rules.split("\n").filter((l) => /^\s*\./.test(l)).every((l) => /.roll-application.(dialog|choices-dialog)/.test(l)), "every rule of rolldialog.css stays inside the roll dialog");
  ok(/button:is\(:disabled[^{]*\{[^}]*dashed/.test(rules) && !/button:is\(:disabled[^{]*\{[^}]*opacity:\s*\.\d/.test(rules), "an unavailable way to roll is dashed, not faded");
  ok(WIDTH >= 380 && WIDTH <= 480, "the dialog opens at the width of a caption card");
  ok(mainWay(["public", "gm", "blind", "self"], "gm") === "gm", "the main way to roll is the chat's current way");
  ok(mainWay(["public", "gm", "blind", "self"], "blindroll") === "blind", "a legacy roll mode name is understood");
  ok(mainWay(["public", "gm", "blind", "self"], null) === "public" && mainWay(["public", "gm"], "ic") === "public", "no known way: the first button is the main one");
  ok(mainWay(["confirm"], "gm") === "confirm", "a single button (the stunts window) is the main one");
  ok(mainWay(["publicroll", "gmroll", "blindroll", "selfroll"], "gm") === "gmroll", "the small window's legacy action names meet the chat's way");
  ok(areWays(["public", "gm"]) && areWays(["publicroll", "selfroll"]) && !areWays(["yes", "no"]) && !areWays(["public"]) && !areWays(["0", "1"]), "only the ways to roll become icon buttons");
  ok(mainWay(["yes", "no"], "gm", "no") === "no" && mainWay(["yes", "no"], "gm") === "yes", "in a question the default answer is the main one, else the first");
  ok(mainWay([], "gm") === null && mainWay(undefined, undefined) === null, "no buttons, no main way");
  // U82: the parts of the pool are a ledger, the attack's facts one strip; neither can wrap
  const { factKind, FACTS } = await import("./rolldialog.mjs");
  const pl = { damage: "Obrażenia podstawowe", min: "Zasięg minimalny", max: "Zasięg maksymalny", armor: "Pancerz", stress: "Koszt stresu" };
  ok(Object.keys(FACTS).join() === "damage,min,max,armor,stress", "the five facts the system's roll window can show are known");
  ok(factKind(" Zasięg maksymalny ", pl) === "max" && factKind("Obrażenia podstawowe", pl) === "damage" && factKind("Pancerz", pl) === "armor", "a fact is known by the client's own word for it");
  ok(factKind("Something new", pl) === null && factKind("", pl) === null && factKind(null, pl) === null && factKind("Pancerz", null) === null, "an unknown fact keeps its word");
  ok(/flex-wrap:\s*nowrap/.test(rules.match(/div\.breakdown\[data-ird-facts\] \{[^}]*\}/)?.[0] ?? ""), "the strip of the attack's facts never wraps");
  const ledger = rules.match(/div\.dices \+ div\.breakdown:not\(:has\(\.attribute-control\)\) \{[^}]*\}/)?.[0] ?? "";
  ok(/display:\s*grid/.test(ledger) && /grid-template-columns:\s*minmax\(0, 1fr\)/.test(ledger), "the parts of the pool stand one per line");
  ok(/div\.dices \+ div\.breakdown[^{]*label\.attribute-label \{[^}]*white-space:\s*nowrap[^}]*text-overflow:\s*ellipsis/.test(rules), "a part's name stays on its one line");
  ok(/data-ird-fact\] > label\.attribute-label \{[^}]*clip-path/.test(rules) && !/data-ird-fact[^{]*label[^{]*\{[^}]*display:\s*none/.test(rules), "a fact's name stays in the window for a screen reader");
  ok(!/content:\s*"\+"/.test(rules), "no plus signs between chips any more");
  // U87: a range whose least and greatest are the same number is that number once
  const { oneRange, bothNames } = await import("./rolldialog.mjs");
  ok(oneRange("0", "0") && oneRange(0, 0) && oneRange(" 0 ", "0"), "Slugfest's range 0 and 0 is one number");
  ok(oneRange("3", "3") && oneRange("3", "3.0") && oneRange("-1", "-1"), "any equal pair is one number, not only zeros");
  ok(!oneRange("0", "1") && !oneRange("1", "3") && !oneRange("3", "1"), "a real span keeps both numbers");
  ok(!oneRange("", "") && !oneRange("", "0") && !oneRange(null, undefined) && !oneRange("x", "x") && !oneRange("0", "0 m"), "a missing or unreadable range keeps the pair as the system wrote it");
  ok(bothNames(pl.min, pl.max).includes(pl.min) && bothNames(pl.min, pl.max).includes(pl.max), "the one number's tooltip names the least and the greatest");
  const same = rules.match(/\[data-ird-fact="max"\]\[data-ird-same\] \{[^}]*\}/)?.[0] ?? "";
  ok(/clip-path/.test(same) && /position:\s*absolute/.test(same) && !/display:\s*none|visibility:\s*hidden/.test(same), "the second number of an equal range is out of sight but stays in the window for a screen reader");
  ok(!/\[data-ird-same\][^{]*\{[^}]*(display:\s*none|visibility:\s*hidden)/.test(rules), "nothing of an equal range is removed from the window");
  const src = readFileSync(new URL("./rolldialog.mjs", import.meta.url), "utf8");
  ok(!/\.remove\(\)|appendChild|insertBefore|\.prototype\.|addEventListener/.test(src), "rolldialog.mjs adds, removes, moves and rewires nothing");
}

if (bad) { console.log(`FAIL ${bad} of ${n}`); process.exit(1); }
console.log(`OK ${n} checks (check-kit)`);
