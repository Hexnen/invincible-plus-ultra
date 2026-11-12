// node scripts/check-marks.mjs -- THE MARKS (ledger U86 / U93): one language of cost and of things on every surface.
//   A. the kit: every kind has a drawing and a name in both languages, a mark is silent unless it is named, tokens in a sentence
//   B. the price the model hands over is marks, never a sentence
//   C. the words do not come back: what a surface shows as a mark is not written out beside it
//   D. nothing of the comparison (stage 1: three versions and their switch) is left anywhere
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import * as Kit from "./kit.mjs";
import { MARK_SVG } from "./kit-marks.mjs";
import { MARK_EN, MARK_PL } from "./kit-lang.mjs";
import { EN, PL, t } from "./tactics/lang.mjs";
import { EN_U10, PL_U10 } from "./tactics/lang-u10.mjs";
import { EN_MAP, PL_MAP } from "./tactics/lang-map.mjs";
import * as CombatLang from "./combat/lang.mjs";
import { priceOf, PRICE_UNITS } from "./tactics/ui/model-pure.mjs";

let n = 0, bad = 0;
const ok = (cond, msg) => { n++; if (!cond) { bad++; console.log("FAIL", msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(root, f), "utf8");

/* ---------- A. the kit ---------- */
{
  eq(Object.keys(MARK_EN).sort(), Object.keys(MARK_PL).sort(), "A1 the names of the marks: the same keys in both languages");
  for (const k of [...Kit.COST_KINDS, ...Kit.SYM_KINDS, "outQuick", "outFull", "spent", "extra", "range"]) ok(MARK_EN[k] && MARK_PL[k], `A2 ${k} has a name in English and in Polish`);
  ok(Object.values(MARK_PL).every((v) => typeof v === "string" && v.trim() && !/\s{2}/.test(v)), "A3 no empty Polish name");
  const css = read("styles/kit.css");
  const masks = ["full", "quick", "turn", "long", "none", "out", "gm", "stress", "rmin", "rmax", "range", "armor"];
  for (const k of masks) ok(new RegExp(`--ipu-m-${k}: url\\(`).test(css) && new RegExp(`\\.ipu-k-${k} \\{[^}]*mask-image: var\\(--ipu-m-${k}\\)`).test(css), `A4 ${k}: one drawing in kit.css (the property and the class that paints it)`);
  for (const k of ["full", "quick"]) ok(new RegExp(`\\.ipu-k-${k}\\.ipu-off \\{`).test(css), `A5 ${k}: a spent slot is the same shape hollow, not a colour`);
  const gen = read("tools/build-cost-marks.mjs");
  ok((gen.match(/const MARKS = \{/g) ?? []).length === 1 && !/const (SETS|VERSIONS|MARKS_[ABC])\b/.test(gen), "A6 the generator holds one set of drawings");
  /* silent unless named */
  ok(/aria-hidden="true"/.test(Kit.costMarkHtml("full")) && !/role=/.test(Kit.costMarkHtml("full")), "A7 a mark beside its carrier's name is silent");
  ok(/role="img" aria-label="Full action" data-tooltip="Full action"/.test(Kit.costMarkHtml("full", { name: true })), "A8 a mark that stands alone names itself: tooltip and screen reader");
  ok(/ipu-k-out/.test(Kit.costMarkHtml("quick", { out: true })) && /ipu-k-quick/.test(Kit.costMarkHtml("quick", { out: true })), "A9 out of turn: the hook, then the bar it is paid with");
  ok(/ipu-off/.test(Kit.costMarkHtml("full", { off: true })), "A10 a spent action");
  eq(Kit.costMarkHtml("nonsense"), "", "A11 an unknown kind draws nothing");
  ok(/ipu-stress/.test(Kit.stressMarkHtml(2)) && />2<\/b>/.test(Kit.stressMarkHtml(2)), "A12 stress with its number");
  ok(/ipu-s-pierce/.test(Kit.symMarkHtml("pierce")) && /ipu-cut/.test(Kit.symMarkHtml("pierce")) && /ipu-k-armor/.test(Kit.symMarkHtml("pierce")), "A13 'ignores Armor' is Armor cut through");
  ok(!/[A-Za-z]/.test(Kit.symMarkHtml("dice", { n: 6 }).replace(/<[^>]*>/g, "")), "A14 no letter of any language inside a mark");
  /* tokens */
  eq(Kit.plain("Roll [[dice:6]] and pay [[stress:1]], [[full]].", "en"), "Roll Dice: 6 and pay Stress: 1, Full action.", "A15 plain(): every token says its name");
  eq(Kit.plain("[[damage:+2]] [[health:0]]", "pl"), "Dodatkowe obrażenia: +2 Zdrowie: 0", "A16 plain() in Polish; a damage that starts with + is extra damage");
  eq(Kit.plain("[[nonsense:1]] [[x]]"), "[[nonsense:1]] [[x]]", "A17 an unknown token is left as written");
  const html = Kit.richHtml("<b> [[six:2]]");
  ok(html.startsWith("&lt;b&gt; ") && /ipu-s-six/.test(html) && /role="img"/.test(html), "A18 richHtml(): text is escaped, a mark in a sentence names itself");
  ok(Kit.hasMarks("a [[dice:1]]") && !Kit.hasMarks("a") && !Kit.hasMarks(null), "A19 hasMarks");
  /* the legend holds every kind */
  const ids = Kit.LEGEND.flatMap((g) => g.rows.map(([id]) => id));
  for (const k of [...Kit.COST_KINDS, ...Kit.SYM_KINDS]) ok(ids.includes(k), `A20 the legend shows ${k}`);
  for (const lang of ["en", "pl"]) { const L = Kit.legendHtml(lang); ok(ids.every((id) => L.includes(`<dd>${Kit.markName(id, lang).replace(/&/g, "&amp;")}</dd>`)), `A21 ${lang}: the legend pairs every mark with its name`); }
}

/* ---------- B. the price is marks ---------- */
{
  const T = (k, p) => t(k, p);
  eq(priceOf(T, "full", 0).parts.map((p) => p.mark), ["full"], "B1 a full action");
  eq(priceOf(T, "quick", 2).parts.map((p) => [p.mark, p.n ?? null]), [["quick", null], ["stress", 2]], "B2 a quick action and stress");
  eq([priceOf(T, "free", 1).unit, priceOf(T, "free", 1).parts.map((p) => p.mark)], ["none", ["none", "stress"]], "B3 no action, but stress");
  ok(priceOf(T, "quick", 0, { out: true }).out === true && priceOf(T, "none", 0, { out: true }).out === false, "B4 out of turn marks only a slot of the turn");
  eq(priceOf(T, null, 0), null, "B5 nothing known: nothing drawn");
  ok(PRICE_UNITS.every((u) => Kit.costMarkHtml(u)), "B6 every unit of a price has a drawing");
  ok(priceOf(T, "full", 1).parts.every((p) => typeof p.name === "string" && p.name && !Kit.hasMarks(p.name)), "B7 every part has a name in words (the tooltip, the screen reader)");
}

/* ---------- C. the words do not come back ---------- */
{
  const TAB = { en: { ...EN, ...EN_U10, ...EN_MAP }, pl: { ...PL, ...PL_U10, ...PL_MAP } };
  /* what a surface shows as a mark: these strings carry the token, and the thing is not written out beside it */
  const MARKED = {
    "ITAC.ui.rollbar.owed": ["dice"], "ITAC.ui.rollbar.rolling": ["dice"], "ITAC.ui.rollbar.sixes": ["six"], "ITAC.ui.roll.waiting": ["dice"], "ITAC.ui.roll.done": ["dice", "six"], "ITAC.ui.roll.pushable": ["dice", "six"],
    "ITAC.ui.mine.roll": ["dice"], "ITAC.ui.line.attPool": ["dice"], "ITAC.ui.line.token": ["dice"], "ITAC.ui.line.npcBroken": ["health"], "ITAC.ui.line.forcedWall": ["armor"], "ITAC.ui.line.outcomeOk": ["six"],
    "ITAC.ui.line.outcomeFail": ["six"], "ITAC.ui.line.outcomeSurplus": ["six"], "ITAC.ui.line.dodgeBlast": ["dice"], "ITAC.ui.line.dodgeArea": ["dice"], "ITAC.ui.line.hazardStunts": ["six"], "ITAC.ui.odds.defended": ["dice"],
    "ITAC.ui.bonusDice": ["dice"], "ITAC.ui.news.taken": ["damage"], "ITAC.ui.news.stress": ["stress"], "ITAC.Prompt.veteran.Body": ["stress"], "ITAC.Prompt.veteran.keep": ["stress"],
    "ITAC.ui.ovr.pool": ["dice"], "ITAC.ui.ovr.sixes": ["six"], "ITAC.ui.ovr.damage": ["damage"], "ITAC.ui.manual.damage": ["damage"], "ITAC.ui.force.damage": ["damage"], "ITAC.ui.hz.pool": ["dice"], "ITAC.ui.hz.damage": ["damage"],
    "ITAC.ui.challenge.penalty": ["dice"], "ITAC.ui.chase.rolls": ["six"], "ITAC.ui.policy.onBroken": ["health"], "ITAC.hint.slots": ["full", "quick"], "ITAC.hint.speed": ["full", "quick", "none"], "ITAC.hint.push": ["stress"],
  };
  const WORD = {      // the word a mark replaced, per language (a whole word, any case)
    en: { dice: /\b(dice|die)\b/i, six: /\bsix(es)?\b/i, stress: /\b(stress|resolve)\b/i, damage: /\bdamage\b/i, health: /\bhealth\b/i, armor: /\barmor\b/i, full: /\bfull action\b/i, quick: /\bquick action\b/i, none: /\b(free|no action)\b/i },
    pl: { dice: /koś[cć]/i, six: /szóst/i, stress: /stres|determinacj/i, damage: /obrażeni/i, health: /zdrowi/i, armor: /pancerz/i, full: /pełn\S* akcj/i, quick: /szybk\S* akcj/i, none: /darmow|bez akcji/i },
  };
  for (const lang of ["en", "pl"]) for (const [key, kinds] of Object.entries(MARKED)) {
    const s = TAB[lang][key];
    ok(typeof s === "string", `C1 ${lang} ${key} exists`);
    if (typeof s !== "string") continue;
    for (const k of kinds) {
      ok(s.includes(`[[${k}`), `C2 ${lang} ${key}: ${k} is its mark`);
      if (key === "ITAC.hint.push" && k === "stress") continue;
      if (key === "ITAC.hint.slots") continue;      // UXB (U147): the first-turn hint teaches the two marks, so it names each beside its mark

      ok(!WORD[lang][k].test(s.replace(/\[\[[^\]]*\]\]/g, "")), `C3 ${lang} ${key}: the word for ${k} is not written beside its mark ("${s}")`);
    }
  }
  /* every token of every string is a mark the kit knows (plain() leaves none behind), in both languages alike */
  for (const lang of ["en", "pl"]) for (const [key, s] of Object.entries(TAB[lang])) if (typeof s === "string" && s.includes("[[")) {
    ok(!Kit.plain(s, lang).includes("[["), `C4 ${lang} ${key}: every token is a mark of the kit`);
    const kinds = (x) => [...String(x ?? "").matchAll(/\[\[([a-z]+)/g)].map((m) => m[1]).sort();
    eq(kinds(TAB.en[key]), kinds(TAB.pl[key]), `C5 ${key}: the same marks in both languages`);
  }
  /* what cannot draw a mark never gets a token: the map module's texts (it escapes them), the numbers over tokens, a mark's own name */
  for (const lang of ["en", "pl"]) for (const [key, s] of Object.entries(TAB[lang])) if (/^ITAC\.(map\.|move\.|float\.|ui\.costShort\.|ui\.cost\.|ui\.fact\.|reason\.|why\.|fix\.|status\.|action\.|stunt\.)/.test(key) || key === "ITAC.ui.stress" || key === "ITAC.ui.armor")
    ok(!String(s).includes("[["), `C6 ${lang} ${key}: a name, a reason or a text of the map is words`);
  /* the words that stood beside the pips of the initiative bar are gone, and no surface draws a price of its own */
  ok(!Object.keys(CombatLang.EN).some((k) => k.startsWith("ICB.Bar.ActL.")) && !Object.keys(CombatLang.PL).some((k) => k.startsWith("ICB.Bar.ActL.")), "C7 the initiative bar has no word beside a pip");
  const src = (f) => read(f);
  ok(/costClasses\(PIP_MARK/.test(src("scripts/combat/bar.mjs")) && !/icbar-pl\b/.test(src("scripts/combat/bar.mjs") + src("styles/combat.css")), "C8 the initiative bar: a pip is the kit's mark");
  ok(/costClasses\(/.test(src("scripts/turn/tray.mjs")) && !/itt-act-t\b/.test(src("scripts/turn/tray.mjs") + src("styles/turn.css")), "C9 the turn tray: an action is the kit's mark, no word on the button");
  ok(/costClasses\(PIP_MARK/.test(src("scripts/party/panel.mjs")) && !/ipt-pip-(fast|slow|one)/.test(src("scripts/party/panel.mjs") + src("styles/party.css")), "C10 the party panel: a pip is the kit's mark (no bolt that would read as stress)");
  const rd = src("styles/rolldialog.css");
  ok(["rmin", "rmax", "range", "armor", "stress"].every((k) => rd.includes(`var(--ipu-m-${k})`)) && !/content: "\\f547"|content: "\\f3ed"|content: "\\f0e7"/.test(rd), "C11 the roll window's strip paints the kit's drawings, none of its own");
  const ui = src("styles/tactics-ui.css");
  ok(!/\.ita-spd\b|\.ita-rs\b/.test(ui) && !/ita-spd|ita-rs\b/.test(src("scripts/tactics/ui/dom.mjs") + src("scripts/tactics/ui/dock.mjs") + src("scripts/tactics/ui/desk.mjs")), "C12 the dock and the desk have no mark of their own");
  ok(!/mask-image:\s*url\(/.test(ui + rd + src("styles/combat.css") + src("styles/party.css") + src("styles/turn.css")), "C13 no surface sheet holds a drawing: they are the kit's");
  ok(!/fa-bolt/.test(src("scripts/tactics/ui/dom.mjs")), "C16 on the dock and the desk the bolt is stress alone: no picture of an action or of a kind is a bolt");
  /* the surfaces that cannot draw say the names */
  ok(/ui\.notifications\[kind\]\(plain\(text\)/.test(src("scripts/tactics/ui/main.mjs")), "C14 a notification says a mark by its name");
  ok(/const t = \(\.\.\.a\) => plain\(tr\(\.\.\.a\)\)/.test(src("scripts/tactics/ui/prompts.mjs")), "C15 a plain dialog says a mark by its name");
}

/* ---------- D. nothing of the comparison is left ---------- */
{
  ok(!existsSync(join(root, "scripts/u86-scaffold.mjs")) && !existsSync(join(root, "styles/u86-scaffold.css")), "D1 the scaffold files are gone");
  const BANNED = /U86-SCAFFOLD|costVersion|COST_VERSIONS|ipu-cost-[abc]\b|ipu-sym-[abc]\b|data-u86|dataset\.u86|ipuU86|u86-scaffold|u86unit|u86armor|\bmarksOf\b|ipu-u86|--ipu-sym-ink/;
  const walk = (d) => readdirSync(join(root, d)).flatMap((f) => { const p = `${d}/${f}`; return statSync(join(root, p)).isDirectory() ? walk(p) : [p]; });
  const files = [...walk("scripts"), ...walk("styles"), ...walk("tools"), "module.json"].filter((f) => /\.(mjs|js|css|json|hbs|html)$/.test(f) && f !== "scripts/check-marks.mjs");
  ok(files.length > 100, "D2 the tree was read");
  for (const f of files) { const m = BANNED.exec(read(f)); ok(!m, `D3 ${f}: "${m?.[0]}" belongs to the comparison of stage 1`); }
  ok(!/u86/i.test(read("scripts/module.js")) && !/u86/i.test(read("styles/sheet-plus.css")), "D4 nothing loads a scaffold");
  ok(!/\bv\s*=\s*costVersion|\{ v\b|, v\b[,} ]/.test([read("scripts/kit.mjs").split("/* ---- a mark inside a sentence")[0].split('import * as P from "./kit-signs-pure.mjs"')[1] ?? "x = { v }", read("scripts/kit-signs-pure.mjs").split("import { MARK_EN")[1] ?? "x = { v }"].join(" ")), "D5 the kit takes no version (kit.mjs and its pure core)");
}

/* ---------- E. U100: the marks where the map draws (signs, moinen-maps zones-api.md section 40) ---------- */
{
  /* the map's own renderer of a sign's drawing (signs-core.mjs nodeHtml / signHtml with `el`), copied: what the map puts in the page */
  const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const node = (o, at = "") => `<${o.tag}${o.cls ? ` class="${o.cls}"` : ""}${at}>${(o.kids ?? []).map((k) => node(k)).join("")}${o.text ? esc(o.text) : ""}</${o.tag}>`;
  const draw = (s) => node(s.el, s.name ? ` role="img" aria-label="${esc(s.name)}" data-tooltip="${esc(s.name)}"` : ` aria-hidden="true"`);
  const one = (sg) => (sg.length === 1 ? draw(sg[0]) : null);
  for (const k of ["full", "quick", "turn", "long", "none", "gm", "out"]) for (const name of [null, true, "A price"]) eq(one(Kit.markSigns(k, { name })), Kit.costMarkHtml(k, { name }), `E1 ${k} (name ${name}): the map draws the kit's very mark`);
  for (const k of ["full", "quick"]) eq(one(Kit.markSigns(k, { off: true, name: true })), Kit.costMarkHtml(k, { off: true, name: true }), `E2 ${k} spent`);
  for (const nn of [null, 1, 3]) for (const name of [null, true]) eq(one(Kit.markSigns("stress", { n: nn, name })), Kit.stressMarkHtml(nn, { name }), `E3 stress ${nn} (name ${name})`);
  for (const k of Kit.SYM_KINDS) for (const nn of [null, 2, "+2"]) eq(one(Kit.markSigns(k, { n: nn, name: true, glyph: "fa-face-dizzy" })), Kit.symMarkHtml(k, { n: nn, name: true, glyph: "fa-face-dizzy" }), `E4 ${k} ${nn}`);
  const o = Kit.markSigns("quick", { out: true, name: true });
  ok(o.length === 2 && /ipu-k-out/.test(o[0].el.cls) && /ipu-k-quick/.test(o[1].el.cls) && o[0].name === Kit.markName("outQuick") && o[1].name === null, "E5 out of turn: two signs, the hook first, the pair named once");
  /* the canvas: the same picture as kit.css, its colour the kit's */
  const css = read("styles/kit.css");
  for (const [k, g] of Object.entries(MARK_SVG)) ok(css.includes(`--ipu-m-${k}: url("${g.uri}")`), `E6 ${k}: the map's picture is kit.css's drawing (run tools/build-cost-marks.mjs)`);
  const all = [...["full", "quick", "turn", "long", "none", "gm"].flatMap((k) => Kit.markSigns(k)), ...Kit.markSigns("stress", { n: 1 }), ...Kit.SYM_KINDS.flatMap((k) => Kit.markSigns(k, { n: 1, glyph: "fa-face-dizzy" }))];
  ok(all.every((s) => s.img || s.icon), "E7 every sign has a picture for the canvas (a mask, or the Font Awesome glyph of the kit)");
  const tokv = (name) => css.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1].toLowerCase();
  ok(Kit.markSigns("full")[0].color === parseInt(tokv("--ipu-yellow").slice(1), 16) && Kit.markSigns("stress", { n: 1 })[0].color === parseInt(tokv("--ipu-cyan-lt").slice(1), 16), "E8 on the canvas: the bars in --ipu-yellow, the bolt in --ipu-cyan-lt");
}

console.log(bad ? `FAIL check-marks: ${bad} of ${n} checks failed` : `OK ${n} checks (check-marks)`);
process.exit(bad ? 1 : 0);
