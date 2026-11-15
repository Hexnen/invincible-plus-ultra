/* Collects every Polish interface string of the module for the glossary check (node only, no Foundry).
   1) the lang tables: every scripts/<area>/lang*.mjs and *-lang.mjs module, pairing each exported PL table with its EN twin by name
      (EN/PL, UI_EN/UI_PL, EN_X/PL_X); 2) inline tables in code: the text of every `pl: ...` value (object, array or string) in the other
      scripts, plus every other string literal there that has Polish letters; 3) lang/pl.json (the system translation) when present. Returns rows { file, key, en, pl }. */
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
/** The source with its comments blanked (line numbers kept): an apostrophe in an English comment ("a gun's TA-TA-TA") is not a quote. */
const noComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|\s)\/\/[^\n]*/g, "$1");
export function inlinePl(raw) {
  // comments blanked first (found 2026-11-14: the lettering engine's BANK `pl:` block ran on through its doc comments and read prose between
  // two apostrophes as one "Polish" string, which then tripped the banned variant "push")
  const src = noComments(raw), out = [];
  for (const m of src.matchAll(/(?<![\w.$])(?:pl|PL)\s*:\s*(?=[{["'`])/g)) {
    const block = valueAt(src, m.index + m[0].length);
    const line = src.slice(0, m.index).split("\n").length;
    for (const s of block.matchAll(STR)) { const t = s[1] ?? s[2] ?? s[3]; if (t) out.push({ line, text: t.replace(/\\(["'`])/g, "$1") }); }
  }
  return out;
}

/** String literals with Polish letters or common Polish words anywhere in a script (a hardcoded Polish text outside a `pl:` table), comments left out. */
const PL_LETTER = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]|(?<![\w.\/-])(jest|przy|oraz|albo|lub|rzutu|rzut|karcie|karty|postaci|tylko|bez|dla|wybierane|po)(?![\w.\/-]) \p{L}/u;
export function polishLiterals(src) {
  const code = noComments(src);
  const out = [];
  for (const s of code.matchAll(STR)) {
    const t = s[1] ?? s[2] ?? s[3];
    if (t && PL_LETTER.test(t)) out.push({ line: code.slice(0, s.index).split("\n").length, text: t.replace(/\\(["'`])/g, "$1") });
  }
  return out;
}

/* `pl:` tables that hold NO player-facing Polish text, by file and by the name of the const that holds them. Found 2026-11-15 (LETR
   1.9.14): the lettering engine's CROSS (words.mjs) keys its reviewers' notes by the word's language, `pl: { TLING: "the bell's tl-ing,
   ..." }`; the notes are English, read only by the engine's own checks, and one tripped the banned "TL". Narrow on purpose: only the
   strings of a `pl:` key that sits INSIDE that const are left out, and only those without a Polish letter (a Polish text put there is
   still checked); check-glossary fails when the const is gone or no longer holds a `pl:` table (a stale exemption protects nothing). */
export const NOT_UI = Object.freeze([
  { file: "scripts/letters/words.mjs", table: "CROSS", why: "reviewers' English notes on cross-language readings of sound words (engine checks only)" },
]);
const HAS_PL = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
/** The 1-based line span [from, to] of `export const <name> = {...}` / `[...]` in src (comments blanked), or null. */
export function constSpan(raw, name) {
  const src = noComments(raw);
  const m = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?const\\s+${name}\\s*=\\s*(?=[{[])`).exec(src);
  if (!m) return null;
  const at = m.index + m[0].length, block = valueAt(src, at);
  if (!block) return null;
  const from = src.slice(0, at).split("\n").length;
  return [from, from + block.split("\n").length - 1];
}
/** Rows of inlinePl(src) for `file` minus the NOT_UI strings; `left` gets what was left out (for the check). */
export function uiInlinePl(file, src, left = []) {
  const rows = inlinePl(src);
  const spans = NOT_UI.filter((n) => n.file === file).map((n) => constSpan(src, n.table)).filter(Boolean);
  if (!spans.length) return rows;
  return rows.filter((r) => {
    const out = !HAS_PL.test(r.text) && spans.some(([a, b]) => r.line >= a && r.line <= b);
    if (out) left.push({ file, ...r });
    return !out;
  });
}

export async function collect(root = ROOT, left = []) {
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
    const src = readFileSync(p, "utf8"), seen = new Set();
    for (const { line, text } of [...uiInlinePl(r, src, left), ...polishLiterals(src)]) { if (seen.has(text)) continue; seen.add(text); rows.push({ file: r, key: `inline:${line}`, en: "", pl: text }); }
  }
  const sys = join(root, "lang", "pl.json");
  if (existsSync(sys)) for (const [k, v] of Object.entries(flat(JSON.parse(readFileSync(sys, "utf8"))))) rows.push({ file: "lang/pl.json", key: k, en: "", pl: v });
  return rows;
}
