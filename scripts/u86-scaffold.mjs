/* U86-SCAFFOLD: stage 1 of ledger U86. THIS WHOLE FILE IS SCAFFOLDING for the comparison of three versions of the marks of cost and of
   things (scripts/kit.mjs costMark / stressMark / symMark, styles/kit.css). Stage 2 deletes this file, its import in scripts/module.js,
   styles/u86-scaffold.css and every line marked U86-SCAFFOLD.

   THE SWITCH (per browser, off by default; with it off the interface is exactly what it was):
     ipuU86.set("a" | "b" | "c")   show that version on the comparison surfaces (kept in localStorage "ipu.u86"; redraws at once)
     ipuU86.set(null)              back to today's interface
     ipuU86.get()                  the version now on, or null
     ipuU86.legend(true | false)   the legend card: every mark of the three versions side by side with its name (needs no version on)
   Only the initiative bar's tooltips need a reload after the switch (its pips are built once per turn). */
import { costVersion, costMarkHtml, stressMarkHtml, symMarkHtml, COST_VERSIONS } from "./kit.mjs";

const MOD = "invincible-plus-ultra", KEY = "ipu.u86", ID = "ipu-u86-legend";
const pl = () => String(globalThis.game?.i18n?.lang ?? "en").startsWith("pl");
const loc = (key, en, plText) => { try { const s = game.i18n.localize(key); if (s && s !== key) return s; } catch { /* not ready */ } return pl() ? plText : en; };
const own = (en, plText) => (pl() ? plText : en);

function apply() {
  const v = costVersion();
  try { if (v) document.body.dataset.u86 = v; else delete document.body.dataset.u86; } catch { /* no body yet */ }
  try { game.modules.get(MOD)?.api?.tactics?.ui?.refresh?.(); } catch { /* the fight's surfaces are not up */ }
}
function set(v) {
  try { if (COST_VERSIONS.includes(v)) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* private window */ }
  apply();
  return costVersion();
}

/* the legend: [name, (v) => html] */
const ROWS = () => [
  [loc("ITAC.ui.cost.full", "Full action", "Pełna akcja"), (v) => costMarkHtml("full", { v })],
  [loc("ITAC.ui.cost.quick", "Quick action", "Szybka akcja"), (v) => costMarkHtml("quick", { v })],
  [own("Full turn", "Pełna tura"), (v) => costMarkHtml("turn", { v })],
  [own("Longer than a turn", "Dłużej niż tura"), (v) => costMarkHtml("long", { v })],
  [loc("ITAC.ui.cost.none", "No action", "Bez akcji"), (v) => costMarkHtml("none", { v })],
  [loc("ITAC.ui.cost.gm", "The GM decides", "Decyduje MG"), (v) => costMarkHtml("gm", { v })],
  [own("Interrupt (out of turn)", "Akcja przerywająca (poza turą)"), (v) => costMarkHtml("out", { v })],
  [own("Interrupt: quick action", "Przerywająca: szybka akcja"), (v) => costMarkHtml("quick", { v, out: true })],
  [own("Interrupt: full action", "Przerywająca: pełna akcja"), (v) => costMarkHtml("full", { v, out: true })],
  [own("Stress: 1", "Stres: 1"), (v) => stressMarkHtml(1, { v })],
  [own("Stress (how much is not known yet)", "Stres (jeszcze nie wiadomo ile)"), (v) => stressMarkHtml(null, { v })],
  null,
  [loc("ITAC.ui.vital.health", "Health", "Zdrowie"), (v) => symMarkHtml("health", { v, n: 9 })],
  [own("Damage (base)", "Obrażenia (podstawowe)"), (v) => symMarkHtml("damage", { v, n: 3 })],
  [own("Extra damage", "Dodatkowe obrażenia"), (v) => symMarkHtml("damage", { v, n: "+2" })],
  [own("Armor", "Pancerz"), (v) => symMarkHtml("armor", { v, n: 2 })],
  [own("Ignores Armor", "Pomija Pancerz"), (v) => symMarkHtml("pierce", { v })],
  [own("Range: nearest", "Zasięg minimalny"), (v) => symMarkHtml("rmin", { v, n: 1 })],
  [own("Range: farthest", "Zasięg maksymalny"), (v) => symMarkHtml("rmax", { v, n: 3 })],
  [own("Dice (the pool)", "Kości (pula)"), (v) => symMarkHtml("dice", { v, n: 6 })],
  [own("Successes (sixes)", "Sukcesy (szóstki)"), (v) => symMarkHtml("six", { v, n: 2 })],
  [own("Pushing a roll", "Forsowanie rzutu"), (v) => symMarkHtml("push", { v })],
  [own("Critical injury", "Rana krytyczna"), (v) => symMarkHtml("crit", { v })],
  [own("Condition (here: stunned, held)", "Stan (tu: ogłuszony, przytrzymany)"), (v) => symMarkHtml("cond", { v, glyph: "fa-face-dizzy" }) + " " + symMarkHtml("cond", { v, glyph: "fa-hands-holding" })],
];
const HEAD = () => ["", own("A: bars", "A: paski"), own("B: dials", "B: tarcze"), own("C: shapes", "C: kształty")];
function legend(on = true) {
  document.getElementById(ID)?.remove();
  if (!on) return false;
  const rows = ROWS(), cut = rows.indexOf(null);
  const table = (list) => `<table><tr>${HEAD().map((x) => `<th>${x}</th>`).join("")}</tr>${list.map(([name, draw]) => `<tr><td class="u86-n">${name}</td>${COST_VERSIONS.map((v) => `<td class="u86-m">${draw(v)}</td>`).join("")}</tr>`).join("")}</table>`;
  const el = document.createElement("section");
  el.id = ID;
  el.innerHTML = `<h3>${own("U86: the marks, three versions", "U86: znaki, trzy wersje")}</h3><div class="u86-cols">${table(rows.slice(0, cut))}${table(rows.slice(cut + 1))}</div>`;
  document.body.appendChild(el);
  return true;
}

export function start() {
  globalThis.ipuU86 = { set, get: costVersion, legend };
  const go = () => apply();
  if (globalThis.game?.ready) go(); else Hooks.once("ready", go);
}
