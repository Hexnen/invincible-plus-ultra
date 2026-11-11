/* Collects every Polish interface string of the module for the glossary check (node only, no Foundry).
   1) the lang tables: every scripts/<area>/lang*.mjs and *-lang.mjs module, pairing each exported PL table with its EN twin by name
      (EN/PL, UI_EN/UI_PL, EN_X/PL_X); 2) inline tables in code: the text of every `pl: ...` value (object, array or string) in the other
      scripts; 3) lang/pl.json (the system translation) when present. Returns rows { file, key, en, pl }. */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative, sep } from "node:path";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const walk = (d, out = []) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); } return out; };
const rel = (root, p) => relative(root, p).split(sep).join("/");
export const isLangFile = (p) => /(^|\/)(lang[\w-]*|[\w-]+-lang)\.mjs$/.test(p) && !/check/.test(p);

const flat = (o, p = "", out = {}) => { for (const [k, v] of Object.entries(o ?? {})) { const kk = p ? `${p}.${k}` : k; if (v && typeof v === "object") flat(v, kk, out); else out[kk] = v; } return out; };
export const flatten = flat;

/** The value that follows `pl:` at index i (after the colon): a balanced {...}/[...] block or a string literal. */
function valueAt(src, i) {
  while (/\s/.test(src[i])) i++;
  const open = src[i];
  if (open === "{" || open === "[") {
    let depth = 0, q = null;
    for (let j = i; j < src.length; j++) {
      const c = src[j];
      if (q) { if (c === "\\") j++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === "`") { q = c; continue; }
      if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") { depth--; if (!depth) return src.slice(i, j + 1); }
    }
    return src.slice(i);
  }
  if (open === '"' || open === "'" || open === "`") {
    for (let j = i + 1; j < src.length; j++) { if (src[j] === "\\") j++; else if (src[j] === open) return src.slice(i, j + 1); }
  }
  return "";
}
const STR = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
export function inlinePl(src) {
  const out = [];
  for (const m of src.matchAll(/(?<![\w.$])(?:pl|PL)\s*:\s*(?=[{["'`])/g)) {
    const block = valueAt(src, m.index + m[0].length);
    const line = src.slice(0, m.index).split("\n").length;
    for (const s of block.matchAll(STR)) { const t = s[1] ?? s[2] ?? s[3]; if (t) out.push({ line, text: t.replace(/\\(["'`])/g, "$1") }); }
  }
  return out;
}

export async function collect(root = ROOT) {
  const rows = [];
  const files = walk(join(root, "scripts")).filter((p) => /\.(mjs|js)$/.test(p));
  for (const p of files) {
    const r = rel(root, p);
    if (/(^|\/)check[\w-]*\.mjs$/.test(r) || /(^|\/)i18n\//.test(r)) continue;
    if (isLangFile(r)) {
      const mod = await import(pathToFileURL(p).href);
      for (const [name, table] of Object.entries(mod)) {
        if (!/^(UI_)?PL(_\w+)?$/.test(name) || !table || typeof table !== "object") continue;
        const en = mod[name.replace("PL", "EN")] ?? {};
        for (const [k, v] of Object.entries(table)) if (typeof v === "string") rows.push({ file: r, key: k, en: en[k] ?? "", pl: v });
      }
      continue;
    }
    for (const { line, text } of inlinePl(readFileSync(p, "utf8"))) rows.push({ file: r, key: `inline:${line}`, en: "", pl: text });
  }
  const sys = join(root, "lang", "pl.json");
  if (existsSync(sys)) for (const [k, v] of Object.entries(flat(JSON.parse(readFileSync(sys, "utf8"))))) rows.push({ file: "lang/pl.json", key: k, en: "", pl: v });
  return rows;
}
