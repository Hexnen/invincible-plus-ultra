// node scripts/rules/check-pure.mjs -- the library stays pure: no Foundry globals, no imports from outside scripts/rules, every rule comment cites its basis.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as R from "./index.mjs";
import { ok, eq, done } from "./testkit.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(here).filter((f) => f.endsWith(".mjs") && !f.startsWith("check-") && f !== "testkit.mjs");
const FORBIDDEN = /\b(game|ui|canvas|foundry|Hooks|CONFIG|ChatMessage|Roll|fromUuid|fromUuidSync|window|document|globalThis)\s*[.(\[]/;
for (const f of files) {
  const src = fs.readFileSync(path.join(here, f), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ok(!FORBIDDEN.test(code), `${f}: no Foundry or browser globals`);
  const imports = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  ok(imports.every((i) => /^\.\/[a-z-]+\.mjs$/.test(i)), `${f}: imports only sibling modules (${imports.join(", ")})`);
  ok(!/Math\.random/.test(code), `${f}: no Math.random (randomness is injected)`);
  if (f !== "index.mjs") ok(/book \d+|ruling \d+/.test(src), `${f}: comments cite book lines or rulings`);
}
eq(Object.keys(R).sort(), ["attack", "challenge", "chase", "crits", "damage", "dice", "hazards", "initiative", "maneuvers", "stunts", "vehicles", "weapons", "zones"], "index exports every module");
eq(files.length, 14, "13 rule modules + index");

done("check-pure");
