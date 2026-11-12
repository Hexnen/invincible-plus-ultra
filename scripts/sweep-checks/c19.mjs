// node scripts/sweep-checks/c19.mjs  (S058 double confirm dialog guard, S059 stale portrait error handler; source-text checks, DOM/Foundry code)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const rd = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const panel = rd("../session/ui/panel.mjs"), dom = rd("../session/ui/dom.mjs");
const body = (name) => { const i = panel.indexOf(`async ${name}() {`); return panel.slice(i, panel.indexOf("\n  async ", i + 10)); };
const aw = body("#award"), un = body("#undo");
ck("award guards on #asking", /if \(this\.#busy \|\| this\.#asking\) return;/.test(aw));
ck("award sets #asking before the dialog", aw.indexOf("this.#asking = true") > -1 && aw.indexOf("this.#asking = true") < aw.indexOf("D.confirmAward"));
ck("award clears #asking in finally", /finally \{ this\.#asking = false; \}/.test(aw));
ck("undo guards on #asking", /if \(this\.#busy \|\| this\.#asking\) return;/.test(un));
ck("undo sets #asking before the dialog", un.indexOf("this.#asking = true") > -1 && un.indexOf("this.#asking = true") < un.indexOf("D.confirmUndo"));
ck("undo clears #asking in finally", /finally \{ this\.#asking = false; \}/.test(un));
ck("#asking declared", panel.includes("#asking = false;"));
const errs = dom.split("\n").filter((l) => l.includes('addEventListener("error"'));
ck("two error handlers", errs.length === 2);
ck("both error handlers check the box still wants this src", errs.every((l) => l.includes("if (box.dataset.src !== want) return;")));
// logic model: stale handler must not clear a newer portrait
const mk = () => ({ dataset: {}, cleared: false });
const box = mk(); const want = "A";
box.dataset.src = "A"; const h = (w) => () => { if (box.dataset.src !== w) return; box.cleared = true; };
const hA = h(want); box.dataset.src = "B"; hA();
ck("stale handler is a no-op", box.cleared === false);
console.log(`sweep c19: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
