/* Comic lettering font option, part of Invincible - Plus Ultra. Started from scripts/module.js by a guarded dynamic import (start() below),
   the same mechanism and recorded phases as hotpan-quiet.mjs / the splash.

   WHAT IT DOES. A client setting "Font: comic lettering" with five choices (dropdown order = MODES below):
     komikah      the default: nothing is injected, the system's Komika Hand ("Comic") plus this module's Polish-patched copies (styles/fonts.css).
     anton        BUNDLED, SIL OFL: fonts/ofl/anton/Anton-Regular.ttf (condensed, heavy; the closest free match to Absolute Batman dialogue).
     bangers      BUNDLED, SIL OFL: fonts/ofl/bangers/Bangers-Regular.ttf (classic comic shout). Both are all-caps display faces, they look best uppercase.
     actionfigure the ActionFigure BB look of Absolute Batman's dialogue lettering. THE FONT IS NOT SHIPPED AND NEVER DOWNLOADED: it is the
                  user's own licensed file, dropped in fonts/user/ (see fonts/user/README.txt). Probed as ActionFigureBB-pl / ActionFigureBB
                  with .ttf .otf .woff2 .woff (a Polish-completed copy made by tools/check-font.py --patch wins over the plain file).
     titles       a free fallback: the system's own "Titles" face (Special Gothic Condensed One, SIL OFL, has every Polish letter) for all lettering.
   A second client setting "Font: captions and flavour text" (captionFont: default / patrickhand) swaps ONLY the italic slots of `Comic`
   (italic + bold italic) to the bundled Patrick Hand (OFL): the module's flavour / subtitle / caption lines all use `font: italic ... Comic`.
   The bundled fonts are complete (all Polish letters), so the user-file coverage logic is NOT run for them; they are only load-tested with a
   FontFace (a rejection falls back to Komikah with ONE warning) and sanity-checked with document.fonts.check after injection (logged once).
   HOW IT SWITCHES. Every module/system rule says `font-family: Comic`, so no CSS is touched. For actionfigure / titles a <style id="isp-font-style">
   with @font-face rules that REDEFINE the family `Comic` is appended as the LAST child of <head> (re-appended on every apply, so it stays last).
   It relies on two CSS Fonts rules: (1) @font-face rules of one family with IDENTICAL descriptors (weight / style) merge into one set and the
   rule declared last wins (the same mechanism styles/fonts.css already uses over the system's Komikah rules), so the four rules below use exactly
   the system's descriptors (none / bold / italic / bold italic); (2) a rule outside every @layer beats layered ones. Removing the element
   (setting back to komikah) gives the default look again, no reload. A face that fails to load falls through to the earlier Komikah rules.
   BOLD / ITALIC. The user file is a single weight, so all four slots point to the SAME file. Because each slot is declared as bold / italic,
   the browser thinks it has a real bold / italic face and applies NO synthetic (smeared / skewed) style: bold and italic text simply stay
   upright regular lettering, which is how a comic letterer's face behaves. (Extension idea, not done: ActionFigureBB-Bold / -Italic files.)
   POLISH COVERAGE. After the file is found it is loaded as a FontFace and every Polish letter plus A-Z a-z 0-9 is tested on a canvas (a glyph is
   present when the width with a serif fallback equals the width with a monospace fallback). Missing code points are logged once (console.info)
   and handled with unicode-range: the user face covers everything except them, and a second set of rules for `Comic` points those code points
   at the patched Komikah files (mixed glyph styles for those letters, a documented fallback).
   ABSENT / UNREADABLE FILE. Komikah stays, one ui.notifications.warn (EN / PL) names the path relative to the module folder, the setting is
   not reset. The negative probe result is cached for the session; changing the setting counts as a retry (it clears the cache). */
const MOD = "invincible-plus-ultra";
const KEY = "comicFont";
const STYLE_ID = "isp-font-style";
const LOG = `${MOD} (comic font) |`;
const CAPKEY = "captionFont";
const MODES = ["komikah", "anton", "bangers", "titles", "actionfigure"];
const CAPS = ["default", "patrickhand"];
const BUNDLED = {   // relative to the module root; every file ships with its OFL.txt next to it
  anton: "fonts/ofl/anton/Anton-Regular.ttf",
  bangers: "fonts/ofl/bangers/Bangers-Regular.ttf",
  patrickhand: "fonts/ofl/patrickhand/PatrickHand-Regular.ttf"
};
const PL_SAMPLE = "ąćęłńóśźżĄĆĘŁŃÓŚŹŻ";

/* everything is resolved from this file's own URL: no folder name is written anywhere */
const ROOT = new URL("../", import.meta.url);
const USER_DIR = new URL("fonts/user/", ROOT);
const ROOT_PATH = decodeURIComponent(ROOT.pathname).replace(/^\/+/, "");           // "modules/<folder>/"
const BASES = ["ActionFigureBB-pl", "ActionFigureBB"];
const EXTS = [["ttf", "truetype"], ["otf", "opentype"], ["woff2", "woff2"], ["woff", "woff"]];
const KOMIKAH = { regular: "KOMIKAH_Regular-pl.ttf", bold: "KOMIKAH_Bold-pl.ttf", italic: "KOMIKAH_RegularItalic-pl.ttf", boldItalic: "KOMIKAH_BoldItalic-pl.ttf" };
const TITLES_FILE = "SpecialGothicCondensedOne-Regular.ttf";                          // in the system's fonts/ folder
const POLISH = [..."ĄąĆćĘęŁłŃńÓóŚśŹźŻż"].map((c) => c.codePointAt(0));
const LATIN = [...("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")].map((c) => c.codePointAt(0));

const STR = {
  en: {
    name: "Font: comic lettering",
    hint: "Typeface of the comic lettering (sheets, chat cards, splash). Anton and Bangers are bundled all-caps display faces: they look best in uppercase, which most of the module's lettering already is. The ActionFigure option needs YOUR OWN licensed copy of ActionFigure BB (Blambot) placed in the module's fonts/user folder as ActionFigureBB.ttf (.otf / .woff2 / .woff also work); see fonts/user/README.txt. The font is never bundled or downloaded. Without the file the default stays in use. Applies at once, this client only.",
    komikah: "Komikah (default, Invincible)",
    anton: "Anton: condensed and heavy (closest to Absolute Batman dialogue)",
    bangers: "Bangers: classic comic shout",
    actionfigure: "ActionFigure (Absolute Batman style) - needs your own file",
    titles: "Condensed sans (Titles)",
    capName: "Font: captions and flavour text",
    capHint: "Typeface of the italic lines: roll flavour, chat labels, emotes, challenge subtitles and the combat banner caption. \"Default\" keeps whatever the comic lettering font gives. Patrick Hand is a bundled handwriting face. Applies at once, this client only.",
    capDefault: "Default (same as comic lettering)",
    patrickhand: "Patrick Hand (handwritten)",
    loadFail: "The bundled font {file} could not be loaded. Komikah stays in use.",
    capFail: "The bundled caption font {file} could not be loaded. Captions keep the comic lettering font.",
    missing: "Font \"ActionFigure\" is selected, but no font file was found. Put your own licensed copy of ActionFigure BB at {path} (.otf, .woff2 and .woff also work). Komikah stays in use until then.",
    unreadable: "Font \"ActionFigure\" is selected, but the file {file} could not be read as a font. Komikah stays in use. Check that it is your own valid copy of ActionFigure BB.",
    fallback: "{n} character(s) are missing in the ActionFigure file and are taken from Komikah: {list}"
  },
  pl: {
    name: "Font: pismo komiksowe",
    hint: "Krój pisma komiksowych napisów (karty postaci, czat, splash). Anton i Bangers są dołączone i to kroje wersalikowe: najlepiej wyglądają wielkimi literami, a większość napisów modułu już taka jest. Opcja ActionFigure wymaga TWOJEJ WŁASNEJ, licencjonowanej kopii ActionFigure BB (Blambot) w folderze fonts/user modułu, pod nazwą ActionFigureBB.ttf (działa też .otf / .woff2 / .woff); zob. fonts/user/README.txt. Fontu nie dołączamy ani nie pobieramy. Bez pliku zostaje domyślny. Działa od razu, tylko na tym kliencie.",
    komikah: "Komikah (domyślny, Invincible)",
    anton: "Anton: wąski i ciężki (najbliższy dialogom z Absolute Batman)",
    bangers: "Bangers: klasyczny komiksowy krzyk",
    actionfigure: "ActionFigure (styl Absolute Batman) - wymaga własnego pliku",
    titles: "Wąski bezszeryfowy (Titles)",
    capName: "Font: podpisy i opisy",
    capHint: "Krój kursywnych linii: opisy rzutów, etykiety na czacie, emotki, podtytuły wyzwań i podpis banera walki. \"Domyślny\" zostawia krój pisma komiksowego. Patrick Hand to dołączone pismo odręczne. Działa od razu, tylko na tym kliencie.",
    capDefault: "Domyślny (jak pismo komiksowe)",
    patrickhand: "Patrick Hand (odręczny)",
    loadFail: "Nie udało się wczytać dołączonego fontu {file}. Zostaje Komikah.",
    capFail: "Nie udało się wczytać dołączonego fontu podpisów {file}. Podpisy zostają w kroju pisma komiksowego.",
    missing: "Wybrano font \"ActionFigure\", ale nie znaleziono pliku fontu. Umieść własną, licencjonowaną kopię ActionFigure BB w {path} (działa też .otf, .woff2 i .woff). Do tego czasu zostaje Komikah.",
    unreadable: "Wybrano font \"ActionFigure\", ale plik {file} nie daje się wczytać jako font. Zostaje Komikah. Sprawdź, czy to Twoja poprawna kopia ActionFigure BB.",
    fallback: "Brakujące w pliku ActionFigure znaki ({n}) są brane z Komikah: {list}"
  }
};
const lang = () => (globalThis.game?.i18n?.lang === "pl" ? "pl" : "en");
const tr = (k, vars = {}) => STR[lang()][k].replace(/\{(\w+)\}/g, (_, v) => String(vars[v] ?? ""));

/* ---------- pure helpers (no Foundry / DOM; unit-testable) ---------- */

/* sorted unique code points -> `U+0-103,U+105-10FFFF` style list of everything EXCEPT them (CSS has no "minus" for unicode-range) */
export function complementRanges(missing) {
  const cps = [...new Set(missing)].sort((a, b) => a - b);
  const out = [];
  let from = 0;
  for (const cp of cps) {
    if (cp > from) out.push([from, cp - 1]);
    from = cp + 1;
  }
  if (from <= 0x10FFFF) out.push([from, 0x10FFFF]);
  return out.map(([a, b]) => (a === b ? `U+${a.toString(16).toUpperCase()}` : `U+${a.toString(16).toUpperCase()}-${b.toString(16).toUpperCase()}`)).join(",");
}
export const listRanges = (cps) => [...new Set(cps)].sort((a, b) => a - b).map((c) => `U+${c.toString(16).toUpperCase()}`).join(",");

/* the four slots of `Comic` with exactly the system's descriptors, each pointing at one file (optionally restricted by unicode-range) */
export function slotRules({ file, format, files = null, range = "", only = null }) {
  const all = [["regular", ""], ["bold", "font-weight:bold;"], ["italic", "font-style:italic;"], ["boldItalic", "font-weight:bold;font-style:italic;"]];
  const slots = only ? all.filter(([slot]) => only.includes(slot)) : all;
  const fmt = format ? ` format("${format}")` : "";
  const ur = range ? `unicode-range:${range};` : "";
  return slots.map(([slot, desc]) => `@font-face{font-family:Comic;src:url("${files?.[slot] ?? file}")${files ? "" : fmt};${desc}${ur}font-display:swap}`).join("\n");
}

/* ---------- state ---------- */
let started = false, seq = 0;
let probeCache = null;          // Promise<{url, format, file} | null>
const coverageCache = new Map(); // url -> Promise<{missing: number[]} | null>
let fallbackLogged = false, warnedStartup = false;
const loadCache = new Map();    // bundled url -> Promise<boolean> (does the file load as a font?)
const warned = new Set();       // one warning per kind per session
let polishLogged = false;

const mode = () => { try { const v = game.settings.get(MOD, KEY); return MODES.includes(v) ? v : "komikah"; } catch { return "komikah"; } };
const capMode = () => { try { const v = game.settings.get(MOD, CAPKEY); return CAPS.includes(v) ? v : "default"; } catch { return "default"; } };
const bundledUrl = (id) => new URL(BUNDLED[id], ROOT).href;
const route = (p) => { try { return foundry.utils.getRoute(p); } catch { return `/${p}`; } };

/* ---------- finding the user's file ---------- */
async function headOk(url) {
  try {
    const r = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (!r.ok) return false;
    const type = r.headers.get("content-type") ?? "";
    return !/text\/html/i.test(type);   // a SPA / error page answering 200 is not a font
  } catch { return false; }
}
function probeUserFont() {
  probeCache ??= (async () => {
    for (const base of BASES) {
      for (const [ext, format] of EXTS) {
        const url = new URL(`${base}.${ext}`, USER_DIR).href;
        if (await headOk(url)) return { url, format, file: `${base}.${ext}` };
      }
    }
    return null;
  })();
  return probeCache;
}

/* ---------- glyph coverage (canvas measurement against two different fallbacks) ---------- */
function measureCoverage(found) {
  if (!coverageCache.has(found.url)) coverageCache.set(found.url, (async () => {
    const family = `ISP-Probe-${Math.random().toString(36).slice(2, 8)}`;
    const face = new FontFace(family, `url("${found.url}") format("${found.format}")`);
    try {
      await face.load();
      document.fonts.add(face);
      const ctx = (typeof OffscreenCanvas === "function" ? new OffscreenCanvas(64, 64) : document.createElement("canvas")).getContext("2d");
      const width = (ch, fam) => { ctx.font = `64px ${fam}`; return ctx.measureText(ch).width; };
      const missing = [];
      for (const cp of [...POLISH, ...LATIN]) {
        const ch = String.fromCodePoint(cp);
        if (width(ch, `"${family}", serif`) !== width(ch, `"${family}", monospace`)) missing.push(cp);   // fell through to different fallbacks => no glyph
      }
      return { missing };
    } catch (err) {
      console.warn(`${LOG} could not read ${found.file}`, err);
      return null;
    } finally {
      try { document.fonts.delete(face); } catch { /* nothing to delete */ }
    }
  })());
  return coverageCache.get(found.url);
}

/* ---------- the injected <style> ---------- */
function removeStyle() { document.getElementById(STYLE_ID)?.remove(); }
function setStyle(css) {
  let el = document.getElementById(STYLE_ID);
  if (!el) { el = document.createElement("style"); el.id = STYLE_ID; }
  if (el.textContent !== css) el.textContent = css;
  document.head.append(el);   // append (or move) => always the last child of <head>
}

function actionFigureCss(found, missing) {
  const fallback = missing.length;
  const user = slotRules({ file: found.url, format: found.format, range: fallback ? complementRanges(missing) : "" });
  if (!fallback) return `/* ${MOD}: user font ${found.file} (full coverage) */\n${user}`;
  const k = Object.fromEntries(Object.entries(KOMIKAH).map(([slot, f]) => [slot, new URL(`fonts/${f}`, ROOT).href]));
  return `/* ${MOD}: user font ${found.file}; ${fallback} missing code point(s) come from the patched Komikah */\n${user}\n${slotRules({ files: k, range: listRanges(missing) })}`;
}
function titlesCss() {
  const url = route(`systems/${game.system.id}/fonts/${TITLES_FILE}`);
  return `/* ${MOD}: all comic lettering in the system's Titles face (Special Gothic Condensed One, OFL) */\n${slotRules({ file: url, format: "truetype" })}`;
}

/* bundled fonts need no probing; a FontFace load only proves the file is readable (a rejection => fall back, warn once) */
function bundledLoads(id) {
  const url = bundledUrl(id);
  if (!loadCache.has(url)) loadCache.set(url, (async () => {
    try { await new FontFace(`ISP-Check-${id}`, `url("${url}") format("truetype")`).load(); return true; }
    catch (err) { console.warn(`${LOG} bundled font ${BUNDLED[id]} failed to load`, err); loadCache.delete(url); return false; }   // not cached: changing the setting retries
  })());
  return loadCache.get(url);
}
const bundledCss = (id) => `/* ${MOD}: bundled font ${BUNDLED[id]} (SIL OFL) for all comic lettering */\n${slotRules({ file: bundledUrl(id), format: "truetype" })}`;
/* captions: only the two italic slots of `Comic`, declared after the main rules so they win for identical descriptors */
const captionCss = () => `/* ${MOD}: captions and flavour text (italic slots) in bundled ${BUNDLED.patrickhand} (SIL OFL) */\n${slotRules({ file: bundledUrl("patrickhand"), format: "truetype", only: ["italic", "boldItalic"] })}`;
function warnOnce(key, vars) { if (warned.has(key)) return; warned.add(key); warn(key, vars); }
/* cheap sanity check after injection (never blocks): do the Polish letters resolve in `Comic`? */
async function polishCheck() {
  try {
    if (!document.fonts?.load) return;
    await document.fonts.load("16px Comic", PL_SAMPLE);
    if (document.fonts.check && !document.fonts.check("16px Comic", PL_SAMPLE) && !polishLogged) { polishLogged = true; console.info(`${LOG} Polish letters did not resolve in the active Comic face`); }
  } catch (err) { if (!polishLogged) { polishLogged = true; console.info(`${LOG} Polish sanity check failed`, err); } }
}

function warn(key, vars) { try { ui.notifications.warn(tr(key, vars)); } catch { console.warn(`${LOG} ${tr(key, vars)}`); } }

/* ---------- apply the setting (idempotent; the sequence number drops stale async results) ---------- */
async function apply({ quiet = false } = {}) {
  const mine = ++seq;
  try {
    const m = mode();
    let css = "";                       // main rules (empty => the default Komikah shows)
    if (m === "titles") css = titlesCss();
    else if (m === "anton" || m === "bangers") {
      const ok = await bundledLoads(m);
      if (mine !== seq) return;
      if (ok) css = bundledCss(m); else if (!quiet) warnOnce("loadFail", { file: BUNDLED[m] }); else warned.add("loadFail");
    } else if (m === "actionfigure") {
      const found = await probeUserFont();
      if (mine !== seq) return;
      if (!found) { if (!quiet) warn("missing", { path: `${ROOT_PATH}fonts/user/ActionFigureBB.ttf` }); }
      else {
        const cov = await measureCoverage(found);
        if (mine !== seq) return;
        if (!cov) { if (!quiet) warn("unreadable", { file: `${ROOT_PATH}fonts/user/${found.file}` }); }
        else {
          if (cov.missing.length && !fallbackLogged) {
            fallbackLogged = true;
            const list = cov.missing.map((c) => String.fromCodePoint(c)).join(" ");
            console.info(`${LOG} ${tr("fallback", { n: cov.missing.length, list })} (${listRanges(cov.missing)})`);
          }
          css = actionFigureCss(found, cov.missing);
        }
      }
    }
    let cap = "";                       // caption rules, appended AFTER the main ones
    if (capMode() === "patrickhand") {
      const ok = await bundledLoads("patrickhand");
      if (mine !== seq) return;
      if (ok) cap = captionCss(); else warnOnce("capFail", { file: BUNDLED.patrickhand });
    }
    const all = [css, cap].filter(Boolean).join("\n");
    if (!all) { removeStyle(); return; }
    setStyle(all);
    if (m === "anton" || m === "bangers") polishCheck();
  } catch (err) {
    console.warn(`${LOG} could not apply the font option (the default font stays)`, err);
    try { removeStyle(); } catch { /* no document */ }
  }
}

function registerSettings() {
  try {
    if (game.settings.settings.has(`${MOD}.${KEY}`)) return;   // (both settings are registered together)
    game.settings.register(MOD, KEY, {
      name: tr("name"), hint: tr("hint"), scope: "client", config: true, type: String, default: "komikah",
      choices: Object.fromEntries(MODES.map((m) => [m, tr(m)])),
      onChange: () => { probeCache = null; apply(); }   // choosing it again is the retry after the user dropped the file in
    });
    game.settings.register(MOD, CAPKEY, {
      name: tr("capName"), hint: tr("capHint"), scope: "client", config: true, type: String, default: "default",
      choices: { default: tr("capDefault"), patrickhand: tr("patrickhand") },
      onChange: () => apply()
    });
  } catch (err) { console.warn(`${LOG} setting not registered`, err); }
}

export function start(phases = {}) {
  if (started) return;
  started = true;
  const run = (name, fn) => { if (phases[name]) fn(); else Hooks.once(name, fn); };
  run("init", registerSettings);
  run("ready", () => { if (!warnedStartup) { warnedStartup = true; apply(); } });
}
