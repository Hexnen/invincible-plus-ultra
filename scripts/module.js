/* Invincible - Plus Ultra
 * Visual layer for the Invincible actor sheet. It depends on the system's DOM (system 2.1.x): selectors below
 * are deliberately narrow and every lookup is guarded, so a changed system degrades to "no effect", not to errors.
 */

const T0 = performance.now(); // shared clock: looping animations keep their phase when the system re-renders the whole sheet
const LAST = new Map();       // `${uuid}:${kind}` -> last fill (0-100), so bars animate between values

const isSheet = (el) => !!el?.classList?.contains("invincible") && el.classList.contains("actor");
const isCharacter = (el) => !el.classList.contains("challenge") && !el.classList.contains("vehicle");
/* ---------- settings: blood, cracks, the wound flash and the bloody logo are experimental and off by default ---------- */
const MODULE_ID = "invincible-plus-ultra";
const LEGACY_ID = "invincible-sheet-plus";   // the id this module had before it became Plus Ultra: only read from (chat message flags), never written
const EXPERIMENTAL = "experimental";

/* Message flags: reads check this module's own namespace first, then the legacy one (messages saved while the module was called
   Invincible - Sheet Plus are never rewritten). Writes always go to the new namespace (see ledger writes below). */
const msgFlag = (message, key) => message?.flags?.[MODULE_ID]?.[key] ?? message?.flags?.[LEGACY_ID]?.[key];

function registerSettings() {
  if (game.settings.settings.has(`${MODULE_ID}.${EXPERIMENTAL}`)) return;
  game.settings.register(MODULE_ID, EXPERIMENTAL, {
    name: "Eksperymentalne: krew i pęknięcia",
    hint: "Zakrwawienie kart przy niskim Health, pęknięcia przy niskim Resolve, błysk rany i krwawe logo. Domyślnie wyłączone.",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => foundry.applications.instances.forEach((app) => { if (isSheet(app.element)) app.render(); })
  });
}
try { if (game?.settings) registerSettings(); else Hooks.once("init", registerSettings); } catch { Hooks.once("init", registerSettings); }
Hooks.once("init", registerSettings);

/* hidden bookkeeping for the one-time copy of the settings from the old id (see scripts/migrate-id.mjs) */
function registerLegacyFlags() {
  for (const [key, scope] of [["migratedFromSheetPlus", "client"], ["migratedFromSheetPlusWorld", "world"]]) {
    if (game.settings.settings.has(`${MODULE_ID}.${key}`)) continue;
    game.settings.register(MODULE_ID, key, { scope, config: false, type: Boolean, default: false });
  }
}
Hooks.once("init", registerLegacyFlags);

const experimental = () => {
  try { return !!game.settings.get(MODULE_ID, EXPERIMENTAL); } catch { return false; }
};

const reduced = (el) => !!el.ownerDocument.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- bars, blood stages, cracks, wound flash ---------- */
const FILL = /(?:#ffe72a|rgb\(\s*255,\s*231,\s*42\s*\))\s+([\d.]+)%/i; // the system paints the fill as an inline gradient
const WOUND_SPOTS = [
  { pos: "right 30px top 70px", origin: "80% 22%" },
  { pos: "left 40px top 120px", origin: "14% 28%" },
  { pos: "right 90px bottom 110px", origin: "76% 72%" },
  { pos: "left 120px bottom 70px", origin: "26% 80%" }
];

function barKind(bar, index) {
  const name = bar.closest(".bar")?.querySelector("input[name]")?.name ?? "";
  if (name.endsWith("derived.health.value")) return "health";
  if (name.endsWith("derived.resolve.value")) return "resolve";
  return index === 0 ? "health" : index === 1 ? "resolve" : null;
}

function updateBars(app, element) {
  const id = app.document?.uuid ?? app.id;
  const pct = {};
  let hurt = false;
  element.querySelectorAll(".bar .inner-bar").forEach((bar, i) => {
    const kind = barKind(bar, i);
    if (!kind) return;
    const m = FILL.exec(bar.getAttribute("style") ?? "");
    if (m) bar.dataset.ispPct = m[1];
    const key = `${id}:${kind}`;
    const known = LAST.has(key);
    // If the system changes its markup the fill can no longer be read: keep the last known value, never assume 0.
    const now = Math.max(0, Math.min(100, parseFloat(bar.dataset.ispPct ?? LAST.get(key) ?? "100")));
    const prev = LAST.get(key) ?? 0;
    LAST.set(key, now);
    pct[kind] = now;
    bar.style.setProperty("--isp-from", prev / 100);
    bar.style.setProperty("--isp-to", now / 100);
    bar.classList.toggle("isp-low", now <= 34);
    bar.classList.toggle("isp-empty", now === 0);
    bar.classList.toggle("isp-gain", known && now > prev);
    bar.classList.toggle("isp-loss", known && now < prev);
    if (kind === "health" && known && now < prev) hurt = true;
    if (kind === "resolve") bar.closest(".bar")?.classList.toggle("isp-cracked-bar", now <= 50 && experimental());
  });

  const stages = isCharacter(element) && experimental();
  const h = stages ? pct.health : undefined;
  const r = stages ? pct.resolve : undefined;
  element.classList.toggle("isp-wounded", h !== undefined && h <= 50);
  element.classList.toggle("isp-bloody", h !== undefined && h <= 34);
  element.classList.toggle("isp-bloody-heavy", h !== undefined && h === 0);
  element.classList.toggle("isp-cracked", r !== undefined && r <= 50);
  element.classList.toggle("isp-cracked-heavy", r !== undefined && r <= 34);
  element.classList.toggle("isp-shattered", r !== undefined && r === 0);
  element.classList.toggle("isp-staged", (h !== undefined && h <= 50) || (r !== undefined && r <= 50));
  element.querySelector(".isp-logo")?.classList.toggle("isp-blood", experimental() && !!element.querySelector(".bar .inner-bar.isp-low"));

  // taking damage: a fresh splat slaps onto the window, fades, and the window shudders
  if (hurt && stages && !reduced(element)) {
    const spot = WOUND_SPOTS[Math.floor(Math.random() * WOUND_SPOTS.length)];
    element.style.setProperty("--isp-wound-pos", spot.pos);
    element.style.setProperty("--isp-wound-origin", spot.origin);
    for (const cls of ["isp-wound", "isp-hit"]) {
      element.classList.remove(cls);
      void element.offsetWidth; // restart
      element.classList.add(cls);
    }
    clearTimeout(element._ispWound);
    element._ispWound = setTimeout(() => element.classList.remove("isp-wound", "isp-hit"), 2500);
  }
}

/* ---------- portrait parallax: the picture lags a little behind the window while you drag the sheet ---------- */
const PX_MAX = 14;        // px, must stay below the scale margin in the CSS
const PX_LAG = 0.5;       // how much of the window's movement the picture "resists"
const PX_DECAY = 7;       // return-to-centre speed (1/s)
const PX = new WeakMap(); // sheet element -> { x, y, last, raf, t }

function pxStep(el, state, now) {
  const dt = Math.min(0.05, (now - state.t) / 1000);
  state.t = now;
  const k = Math.exp(-PX_DECAY * dt);
  state.x *= k;
  state.y *= k;
  if (Math.abs(state.x) < 0.05 && Math.abs(state.y) < 0.05) {
    state.x = state.y = 0;
    state.raf = 0;
  } else {
    state.raf = el.ownerDocument.defaultView.requestAnimationFrame((t) => pxStep(el, state, t));
  }
  el.style.setProperty("--isp-px-x", `${state.x.toFixed(2)}px`);
  el.style.setProperty("--isp-px-y", `${state.y.toFixed(2)}px`);
}

function pxWatch(app, el) {
  if (PX.has(el)) return;
  const here = () => ({ left: Number(app.position?.left), top: Number(app.position?.top) });
  const state = { x: 0, y: 0, last: here(), raf: 0, t: performance.now() };
  PX.set(el, state);
  new MutationObserver(() => {
    const now = here();
    if (!Number.isFinite(now.left) || !Number.isFinite(now.top)) return;
    const dx = now.left - state.last.left;
    const dy = now.top - state.last.top;
    state.last = now;
    if ((!dx && !dy) || reduced(el) || !Number.isFinite(dx + dy)) return;
    state.x = Math.max(-PX_MAX, Math.min(PX_MAX, state.x - dx * PX_LAG));
    state.y = Math.max(-PX_MAX, Math.min(PX_MAX, state.y - dy * PX_LAG));
    if (!state.raf) {
      state.t = performance.now();
      state.raf = el.ownerDocument.defaultView.requestAnimationFrame((t) => pxStep(el, state, t));
    }
  }).observe(el, { attributes: true, attributeFilter: ["style"] });
}

/* ---------- cards landing on the sheet: drag & drop, rolls, macros, anything that creates an Item / Effect ---------- */
const TAB_OF = {
  power: "powers", powerSource: "powers", boost: "powers", limit: "powers",
  talent: "talents", drawback: "talents", gear: "gear", criticalInjury: "injuries"
};
const LANDED = new Map();      // doc id -> { tab, type }, until a sheet has shown it (expires after 4 s)
const WAITING = new WeakMap(); // sheet element -> Map(tab -> Map(id -> type)): created while another tab was open
const PLAYED = new WeakMap();  // sheet element -> Set(id): landing already played here
const MAX_LANDINGS = 8;        // bulk creates (imports, duplicates) must not turn the sheet into confetti

const actorSheets = (actor) => [...foundry.applications.instances.values()].filter((a) => a.document === actor && isSheet(a.element));
const tabIsActive = (el, tab) => !!el.querySelector(`nav.sheet-tabs a[data-tab="${tab}"].active`);
const cardFor = (el, id) => el.querySelector(`[data-item-id="${id}"], [data-effect-id="${id}"]`);

function playLanding(card, type) {
  card.classList.add("isp-landed", `isp-landed-${type}`);
  setTimeout(() => card.classList.remove("isp-landed", `isp-landed-${type}`), 1600);
}

function pingTab(el, tab) {
  const link = el.querySelector(`nav.sheet-tabs a[data-tab="${tab}"]`);
  if (!link) return;
  link.classList.remove("isp-ping");
  void link.offsetWidth;
  link.classList.add("isp-ping", "isp-new");
  setTimeout(() => link.classList.remove("isp-ping"), 900);
}

function landCards(el) {
  const played = PLAYED.get(el) ?? new Set();
  PLAYED.set(el, played);
  let budget = MAX_LANDINGS;
  for (const [id, info] of LANDED) {
    if (played.has(id)) continue;
    const card = cardFor(el, id);
    if (!card) continue;
    played.add(id);
    if (tabIsActive(el, info.tab)) {
      if (budget-- > 0) playLanding(card, info.type);
    } else {
      const byTab = WAITING.get(el) ?? new Map();
      WAITING.set(el, byTab);
      const ids = byTab.get(info.tab) ?? new Map();
      ids.set(id, info.type);
      byTab.set(info.tab, ids);
      pingTab(el, info.tab);
    }
  }
  // a re-render replaces the tab bar, so the markers have to be put back
  WAITING.get(el)?.forEach((_ids, tab) => el.querySelector(`nav.sheet-tabs a[data-tab="${tab}"]`)?.classList.add("isp-new"));
}

function queue(doc, tab, type) {
  const actor = doc.parent;
  if (!actor || actor.documentName !== "Actor" || !tab) return;
  LANDED.set(doc.id, { tab, type });
  setTimeout(() => LANDED.delete(doc.id), 4000);
  setTimeout(() => actorSheets(actor).forEach((s) => landCards(s.element)), 300); // the sheet may already have rendered
}

Hooks.on("createItem", (item) => queue(item, TAB_OF[item.type], item.type));
Hooks.on("createActiveEffect", (effect) => queue(effect, "effects", "effect"));

/* ---------- drop zone: one set of document listeners for all sheets ---------- */
const DEPTH = new WeakMap();
const clearDrops = () => document.querySelectorAll(".invincible.sheet.actor.isp-dropping").forEach((el) => {
  DEPTH.set(el, 0);
  el.classList.remove("isp-dropping");
});
document.addEventListener("dragend", clearDrops);
document.addEventListener("drop", clearDrops, true);

/* ---------- one render hook for everything that touches the sheet's DOM ---------- */
const SEEN = new WeakSet();

Hooks.on("renderApplicationV2", (app, element) => {
  if (!isSheet(element)) return;
  const first = !SEEN.has(element);
  SEEN.add(element);
  element.style.setProperty("--isp-t", ((performance.now() - T0) / 1000).toFixed(2));

  // logo: wrap once per render (the header part is replaced by the system) so the shine can be masked to the letters
  const logo = element.querySelector("header.sheet-header > img.sheet-logo");
  if (logo && !logo.parentElement.classList.contains("isp-logo")) {
    const wrap = document.createElement("span");
    wrap.className = "isp-logo";
    wrap.style.setProperty("--isp-logo", `url("${logo.src}")`);
    const shine = document.createElement("i");
    shine.className = "isp-shine";
    shine.append(document.createElement("i"));
    logo.replaceWith(wrap);
    wrap.append(logo, shine);
  }

  updateBars(app, element); // after the logo wrapper exists: it toggles the blood class on it

  // portrait frame (parallax), focusable controls
  const img = element.querySelector("section.portrait > img.profile-img");
  if (img && !img.parentElement.classList.contains("isp-px-frame")) {
    const frame = document.createElement("div");
    frame.className = "isp-px-frame";
    img.replaceWith(frame);
    frame.append(img);
  }
  pxWatch(app, element);
  element.querySelectorAll("label.rollable, .isp-px-frame, nav.sheet-tabs a[data-action], a.effect-control, img.profile-img[data-action]").forEach((el) => {
    el.tabIndex = 0;
    el.setAttribute("role", "button");
  });
  for (const pic of element.querySelectorAll(".isp-px-frame > img, img.profile-img[data-action]")) {
    if (!pic.alt) pic.alt = app.document?.name ?? "";
  }

  // opening the window / switching tabs fades the tab in; a plain re-render must not
  if (first) {
    element.classList.add("isp-open");
    setTimeout(() => element.classList.remove("isp-open"), 400);
    intro(element.querySelector("section.tab.active"));
  }
  landCards(element);

  if (element.dataset.ispBound) return;
  element.dataset.ispBound = "1";

  element.addEventListener("click", (ev) => {
    const link = ev.target.closest?.("nav.sheet-tabs a[data-tab]");
    if (!link) return;
    const tab = link.dataset.tab;
    link.classList.remove("isp-new");
    setTimeout(() => intro(element.querySelector(`section.tab[data-tab="${tab}"]`)), 0);
    const waiting = WAITING.get(element)?.get(tab);
    if (!waiting) return;
    WAITING.get(element).delete(tab);
    setTimeout(() => waiting.forEach((type, id) => { const card = cardFor(element, id); if (card) playLanding(card, type); }), 120);
  });

  element.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    const t = ev.target;
    if (!t.matches?.("label.rollable, .isp-px-frame, nav.sheet-tabs a[data-action], a.effect-control, img.profile-img[data-action]")) return; // only when the control itself has focus, never while typing
    ev.preventDefault();
    (t.matches(".isp-px-frame") ? t.querySelector("img") : t)?.click();
  });

  const isDoc = (ev) => ev.dataTransfer?.types?.includes("text/plain");
  element.addEventListener("dragenter", (ev) => {
    if (!isDoc(ev)) return;
    DEPTH.set(element, (DEPTH.get(element) ?? 0) + 1);
    element.classList.add("isp-dropping");
  });
  element.addEventListener("dragleave", () => {
    const d = Math.max(0, (DEPTH.get(element) ?? 0) - 1);
    DEPTH.set(element, d);
    if (!d) element.classList.remove("isp-dropping");
  });
  element.addEventListener("drop", () => {
    element.classList.add("isp-thump");
    setTimeout(() => element.classList.remove("isp-thump"), 400);
  });
});

function intro(section) {
  if (!section) return;
  section.classList.add("isp-intro");
  setTimeout(() => section.classList.remove("isp-intro"), 300);
}

/* ---------- item sheets: keyboard access for the tab strip and the action links ---------- */
Hooks.on("renderApplicationV2", (app, element) => {
  if (!element.classList?.contains("invincible") || !element.classList.contains("item")) return;
  element.querySelectorAll("nav.sheet-tabs a[data-action], a[data-action], img.profile-img[data-action]").forEach((el) => {
    if (el.hasAttribute("href")) return;
    el.tabIndex = 0;
    el.setAttribute("role", "button");
  });
  const portrait = element.querySelector("img.profile-img[data-action]");
  if (portrait && !portrait.alt) portrait.alt = app.document?.name ?? "";
  if (element.dataset.ispKbd) return;
  element.dataset.ispKbd = "1";
  element.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    const t = ev.target;
    if (!t.matches?.('[role="button"][data-action]')) return;
    ev.preventDefault();
    t.click();
  });
});

/* ---------- chat cards: keyboard access for expanding a roll and for deleting / dismissing a message ---------- */
const CHAT_CONTROLS = '.chat-message .dice-roll[data-action="expandRoll"], .chat-message a.message-delete, .chat-message a.message-dismiss';

/* The bubble of a Year Zero roll says "Successes : 3" (a library string). Say it like a person would. The module has no lang files because
   Foundry reads a module's language list only when the server starts, so the two languages live here. */
function successWord(n) {
  if (game.i18n.lang === "pl") {
    if (n === 1) return "sukces";
    const few = n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14);
    return few ? "sukcesy" : "sukcesów";
  }
  return n === 1 ? "success" : "successes";
}
const noSuccess = () => (game.i18n.lang === "pl" ? "Brak sukcesów" : "No successes");

/* Stunt descriptions on hover. The system only knows the stunts' names; the rules text is in the Quickstart journal that ships with the
   system (pages "Slugfest" and "Shooting"). It is read from there at run time, never copied into this module. */
let STUNT_DOCS = null;
const STUNT_ALIAS = { "double damage": "extra damage" };   // the system's name -> the book's name
const stuntNorm = (s) => s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
const stuntEsc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function stuntDocs() {
  STUNT_DOCS ??= (async () => {
    const map = new Map();
    try {
      const advs = (await game.packs.get("invincible.basic-data")?.getDocuments()) ?? [];
      for (const adv of advs) for (const journal of adv.journal) for (const page of journal.pages) {
        const html = page.text?.content ?? "";
        if (!/stunt/i.test(html)) continue;
        const doc = new DOMParser().parseFromString(html, "text/html");
        for (const el of doc.querySelectorAll("p, li")) {
          const text = el.textContent.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\s+/g, " ").trim();
          const m = /^([A-Z][A-Za-z' ]{2,28}?)\s*:\s+(.{20,})$/.exec(text);
          if (m && !map.has(stuntNorm(m[1]))) map.set(stuntNorm(m[1]), { name: m[1].trim(), text: m[2] });
        }
      }
    } catch (e) { console.warn("invincible-plus-ultra | stunt descriptions unavailable", e); }
    return map;
  })();
  return STUNT_DOCS;
}

function stuntTooltips(root) {
  const items = [...root.querySelectorAll("ul.stunts li")].filter((li) => !li.dataset.tooltipHtml);
  if (!items.length) return;
  stuntDocs().then((map) => {
    for (const li of items) {
      const base = stuntNorm(li.textContent.split(/[:(]/)[0]);
      const entry = map.get(STUNT_ALIAS[base] ?? base);
      if (!entry) continue;
      li.dataset.tooltipHtml = `<strong>${stuntEsc(entry.name)}</strong><p>${stuntEsc(entry.text)}</p>`;
      li.dataset.tooltipDirection = "LEFT";
      makeTagFocusable(li);
    }
  });
}

/* Stunt / effect tags are info, but their rules live in a tooltip: give them a tab stop and the module's tooltip class, and show the
   tooltip on keyboard focus too (Esc hides it). Pointer behaviour is Foundry's own. */
const TAG_SELECTOR = ".chat-message :is(ul.stunts, ul.effects) > li[data-tooltip-html]";
function makeTagFocusable(li) {
  if (li.querySelector(":scope > p")) return;   // power-card effects print their text, nothing to hover for
  li.tabIndex = 0;
  li.dataset.tooltipClass = "isp-tip";
}
document.addEventListener("focusin", (ev) => {
  const li = ev.target?.closest?.(TAG_SELECTOR);
  if (!li || !game.tooltip?.activate) return;
  game.tooltip.activate(li, { html: li.dataset.tooltipHtml, direction: li.dataset.tooltipDirection || undefined, cssClass: "isp-tip" });
});
document.addEventListener("focusout", (ev) => { if (ev.target?.closest?.(TAG_SELECTOR)) game.tooltip?.deactivate?.(); });
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && ev.target?.closest?.(TAG_SELECTOR)) game.tooltip?.deactivate?.(); });

/* Effect tags: "[Boost] Fists of Fury" -> typed label + name, so CSS can colour the type (boost = blue, drawback = red, anything else
   neutral). The type word is kept as the label text; only the English / Polish stems below get a colour. */
const EFFECT_TYPES = [[/^(boost|wzmocn)/i, "boost"], [/^(drawback|limit|wad|ogranicz)/i, "drawback"]];
function effectTags(root) {
  root.querySelectorAll("ul.effects > li").forEach((li) => {
    const strong = li.querySelector(":scope > strong, :scope > p:first-child > strong");
    if (strong && !strong.children.length) {
      const m = /^\s*\[([^\]]{1,24})\]\s*(\S[\s\S]*)$/.exec(strong.textContent);
      if (m) {
        const type = m[1].trim();
        li.dataset.ispType = EFFECT_TYPES.find(([re]) => re.test(type))?.[1] ?? "other";
        const label = document.createElement("span"), name = document.createElement("span");
        label.className = "isp-etype"; label.textContent = type;
        name.className = "isp-ename"; name.textContent = m[2].trim();
        strong.replaceChildren(label, name);
      }
    }
    if (li.dataset.tooltipHtml) makeTagFocusable(li);
  });
}

/* Short stat labels ("Attack Damage:" -> "Damage") so the stat chips can sit in one row. Matched against the library's own localized
   labels; a label that is not recognised keeps its full text. */
const STAT_SHORT = {
  en: { damage: "Damage", range: "Range", crit: "Crit", stress: "Stress", stunts: "Stunts", armor: "Armor", despair: "Despair", blight: "Blight" },
  pl: { damage: "Obrażenia", range: "Zasięg", crit: "Krytyk", stress: "Stres", stunts: "Stunty", armor: "Pancerz", despair: "Rozpacz", blight: "Plaga" }
};
const STAT_KEYS = { damage: "YZUR.CHAT.ROLL.ATTACK.DAMAGE", range: "YZUR.CHAT.ROLL.ATTACK.RANGE", stunts: "YZUR.CHAT.ROLL.ATTACK.STUNTS", armor: "YZUR.CHAT.ROLL.ATTACK.ARMOR" };
const normLabel = (t) => t.replace(/[:\s]+$/, "").trim().toLowerCase();

/* What each stat on an attack card means, on hover. The wording follows the Quickstart rules (base damage, range 0 = same zone,
   push 1s = stress); the crit line only says what the card itself shows: the attack's damage reached the weapon's threshold. */
const STAT_TIPS = {
  en: {
    damage: ["Damage", "The base damage this attack inflicts if it hits. Armor can reduce it, and Extra Damage stunts add to it."],
    range: ["Range", "Minimum and maximum range in zones. 0 is the same zone. Attacks closer than the minimum get -3 dice; the weapon cannot be used beyond its maximum."],
    stress: ["Stress", "Stress this roll costs: 1 for each 1 rolled after a push. It lowers Resolve."],
    crit: ["Crit threshold", "This attack's damage reached the critical threshold of the weapon or power."]
  },
  pl: {
    damage: ["Obrażenia", "Bazowe obrażenia tego ataku, jeśli trafi. Pancerz może je zmniejszyć, a stunty Extra Damage je zwiększają."],
    range: ["Zasięg", "Minimalny i maksymalny zasięg w strefach. 0 to ta sama strefa. Atak z bliższej odległości niż minimum dostaje -3 kostki; poza maksimum broni nie da się użyć."],
    stress: ["Stres", "Stres, jaki kosztuje ten rzut: 1 za każdą jedynkę wyrzuconą po pushu. Zmniejsza Resolve."],
    crit: ["Próg krytyka", "Obrażenia tego ataku osiągnęły próg krytyczny broni lub mocy."]
  }
};

function statKey(label) {
  const chip = label.parentElement;
  if (chip.classList.contains("roll-critical")) return "crit";
  if (chip.classList.contains("roll-trauma")) return "stress";
  if (chip.classList.contains("roll-despair")) return "despair";
  if (chip.classList.contains("roll-blight")) return "blight";
  const text = normLabel(label.textContent);
  return Object.keys(STAT_KEYS).find((k) => normLabel(game.i18n.localize(STAT_KEYS[k])) === text) ?? null;
}

/* Dice pool breakdown ("3 Fighting / 2 Wreck Zone"): the sign gets its own column (li[data-op="-"] for a negative source, which prints its
   absolute value; CSS draws "+" / minus). No total row: the dice count above already says it. No words. */
function poolBreakdown(ul) {
  if (ul.dataset.ispPool) return;
  const rows = [...ul.children].filter((li) => li.matches("li"));
  const cells = rows.map((li) => li.querySelector(":scope > strong.breakdown-value"));
  if (!rows.length || cells.some((c) => !c)) return;
  const nums = cells.map((c) => parseInt(c.textContent.replace(/−/g, "-"), 10));
  if (nums.some((n) => !Number.isFinite(n))) return;
  ul.dataset.ispPool = "1";
  nums.forEach((n, i) => { if (n < 0) { rows[i].dataset.op = "-"; cells[i].textContent = String(-n); } });
}

/* A one-line summary of the dice for the collapsed toggle: a small square per die (six = yellow star, one = red cross, others blue).
   For a pushed roll it shows the final state: the pushed row, with the kept dice taken from the first row. */
function miniDice(dr) {
  const formula = dr.querySelector(".dice-formula");
  if (!formula || formula.querySelector(".isp-mini")) return;
  const rows = [...dr.querySelectorAll(".dice-tooltip div.dice-rolls")];
  const flat = rows.length ? null : dr.querySelector(".dice-tooltip ol.dice-rolls");
  const live = (t) => t && !t.classList.contains("discarded") && !t.classList.contains("rerolled") && (t.querySelector("img") || t.textContent.trim());
  let tiles;
  if (rows.length >= 2) {
    const [first, last] = [rows[0], rows[rows.length - 1]];
    const a = [...first.querySelectorAll(".roll")], b = [...last.querySelectorAll(".roll")];
    tiles = b.map((t, i) => (t.textContent.trim() || t.querySelector("img") ? t : a[i])).filter(Boolean);
  } else {
    tiles = [...(rows[0] ?? flat)?.querySelectorAll(".roll") ?? []];
  }
  tiles = tiles.filter((t) => rows.length >= 2 || live(t));
  if (!tiles.length) return;
  const mini = document.createElement("span");
  mini.className = "isp-mini";
  mini.setAttribute("aria-hidden", "true");
  for (const t of tiles) {
    const d = document.createElement("i");
    d.className = "isp-die " + (t.matches(".success, .max") ? "six" : t.matches(".failure, .min") ? "one" : "n");
    mini.append(d);
  }
  formula.prepend(mini);
}

Hooks.on("renderChatMessageHTML", (message, html) => {
  // Only a GM can apply damage (the system refuses anyone else with "You are not a GM!"), so players do not get the button at all
  if (!game.user.isGM) html.querySelectorAll(".dice-buttons.apply-damage").forEach((el) => el.remove());
  const short = STAT_SHORT[game.i18n.lang] ?? STAT_SHORT.en;
  html.querySelectorAll(":is(.roll-damage, .roll-critical, .roll-despair, .roll-blight, .roll-trauma) > .label").forEach((label) => {
    const key = statKey(label);
    if (key && short[key]) label.dataset.short = short[key];
    if (key) label.parentElement.dataset.stat = key;   /* CSS picks the row glyph from it (damage / range / armor / stunts share .roll-damage) */
    const res = label.parentElement.querySelector(":scope > .result")?.textContent.trim() ?? "";
    if (res.length > 6 || /[^\d\s.,+\-]/.test(res)) label.parentElement.dataset.long = "1";   /* text results ("1 - Movement", "Self"): CSS sets them as words, not as a big numeral */
    const tip = (STAT_TIPS[game.i18n.lang] ?? STAT_TIPS.en)[key];
    if (tip) {
      const chip = label.parentElement;
      chip.dataset.tooltipHtml = `<strong>${tip[0]}</strong><p>${tip[1]}</p>`;
      chip.dataset.tooltipClass = "isp-tip";
      chip.dataset.tooltipDirection = "UP";
    }
  });
  html.querySelectorAll(".dice-roll:has(.dice-total:is(.success, .failure))").forEach(miniDice);
  html.querySelectorAll(".dice-tooltip .wrapper > ul").forEach(poolBreakdown);
  // the stunts count and the stunts to choose from are one thing: put them in one frame
  html.querySelectorAll(".roll-damage + ul.stunts").forEach((ul) => {
    const chip = ul.previousElementSibling;
    if (chip.parentElement.classList.contains("isp-stunts")) return;
    const group = document.createElement("div");
    group.className = "isp-stunts";
    chip.before(group);
    group.append(chip, ul);
  });
  html.querySelectorAll(".dice-roll .dice-total:is(.success, .failure)").forEach((el) => {
    const n = parseInt(el.textContent.match(/\d+/)?.[0] ?? "", 10);
    if (!Number.isFinite(n)) return;
    if (n === 0) { el.textContent = noSuccess(); return; }
    el.textContent = "";
    const num = document.createElement("b"), word = document.createElement("span");
    num.className = "isp-n"; num.textContent = String(n);
    word.className = "isp-w"; word.textContent = successWord(n);
    el.append(num, word);
  });
  stuntTooltips(html);
  effectTags(html);
  html.querySelectorAll(CHAT_CONTROLS.replaceAll(".chat-message ", "")).forEach((el) => {
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    if (el.matches(".dice-roll")) el.setAttribute("aria-expanded", el.classList.contains("expanded") ? "true" : "false");
  });
});

document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter" && ev.key !== " ") return;
  const t = ev.target;
  if (!t?.matches?.(CHAT_CONTROLS)) return; // only when the control itself has focus
  ev.preventDefault();
  t.click();
});

document.addEventListener("click", (ev) => {
  const roll = ev.target?.closest?.('.chat-message .dice-roll[data-action="expandRoll"]');
  if (!roll) return;
  // Foundry toggles .expanded in its own handler; read it after that has run
  setTimeout(() => roll.setAttribute("aria-expanded", roll.classList.contains("expanded") ? "true" : "false"), 0);
});

/* ---------- "Damage taken" card ----------
   The system (helpers/rolls.mjs, applyTargetDamage) updates the target's Health and THEN posts this card as plain prose: flavor
   "Damage Taken" and one or two bare <p> ("<strong>Name</strong> took <strong>3</strong> damage." and, when Health went below 0,
   "They also took <strong>Broken Arm</strong> critical injury."). The message carries no attacker and no previous Health, so two small
   captures (all in memory, all guarded) fill the gap on the client that applies the damage (the GM's):
     1. preUpdateActor: when system.derived.health.value changes, remember { from, to, max, t } per actor,
     2. a capture-phase click on the attacker's "Apply damage" button: remember who rolled (the roll card's speaker),
     3. preCreateChatMessage: for the "Damage Taken" flavor, match both (recent enough) and store them in the message's own flags
        (flags.invincible-plus-ultra.dmg = { from, to, max, attacker: { name, img, id } }), so every client and every reload shows
        the same card.
   Rendering (renderChatMessageHTML -> damageCard) builds the card from the flags. Missing pieces (old messages, macros, another
   client) simply leave their part out; nothing here may throw. The system's own sentence stays in the DOM, visually hidden, with a
   one-sentence summary after it: that is what a screen reader reads (the visible parts are aria-hidden).
   Armor: the system posts only the final damage, so no "reduced by armor" is shown (it would be invented). */
const DMG_HEALTH_AT = 8000;    // ms: a Health change counts for a card created within this time
const DMG_CLICK_AT = 20000;    // ms: an Apply damage click counts for cards created within this time (the injury table may be slow to load)
const DMG_FRESH = 15000;       // ms: a card without captured data may show the actor's current Health as "after" while it is this young
const HEALTH_SEEN = new Map(); // actor uuid / `id:${actor.id}` -> { from, to, max, t } (latest only)
let APPLY_SEEN = null;         // { name, img, id, t } of the last Apply damage click

const DMG_TXT = {
  en: {
    damage: "Damage", attacker: "Attacker", health: "Health", broken: "Broken",
    hp: (from, to, max) => `Health ${from === null ? "now" : `from ${from} to`} ${to}${max ? ` of ${max}` : ""}.`,
    brokenSr: "Broken.", by: (name) => `Attacker: ${name}.`
  },
  pl: {
    damage: "Obrażenia", attacker: "Atakujący", health: "Zdrowie", broken: "Złamany",
    hp: (from, to, max) => `Zdrowie: ${from === null ? "teraz" : `z ${from} do`} ${to}${max ? ` z ${max}` : ""}.`,
    brokenSr: "Złamany.", by: (name) => `Atakujący: ${name}.`
  }
};
const dmgNum = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);

Hooks.on("preUpdateActor", (actor, changes) => {
  try {
    const key = "system.derived.health.value";
    const raw = changes?.[key] ?? foundry.utils.getProperty(changes ?? {}, key);
    const to = dmgNum(raw), from = dmgNum(actor?.system?.derived?.health?.value);
    if (to === null || from === null || to === from) return;
    const max = dmgNum(changes?.["system.derived.health.max"] ?? foundry.utils.getProperty(changes ?? {}, "system.derived.health.max") ?? actor.system.derived.health.max);
    const rec = { from, to, max, t: Date.now() };
    HEALTH_SEEN.set(actor.uuid, rec);
    HEALTH_SEEN.set(`id:${actor.id}`, rec);
  } catch (err) { console.warn(`${MODULE_ID} | damage capture (health)`, err); }
});

document.addEventListener("click", (ev) => {
  try {
    const btn = ev.target?.closest?.(".chat-message .dice-buttons.apply-damage button");
    if (!btn) return;
    const id = btn.closest("[data-message-id]")?.dataset?.messageId;
    const roll = id ? game.messages.get(id) : null;
    const actor = roll?.speakerActor ?? null;
    APPLY_SEEN = { name: String(roll?.alias || actor?.name || "").trim(), img: actor?.img || "", id: actor?.uuid || roll?.speaker?.actor || "", t: Date.now() };
  } catch (err) { console.warn(`${MODULE_ID} | damage capture (attacker)`, err); }
}, true);   // capture phase: runs before the system's own button handler

Hooks.on("preCreateChatMessage", (message) => {
  try {
    if (!message?.flavor || message.flavor.trim() !== game.i18n.localize("INVINCIBLE.Chat.DamageInfo.DamageTaken")) return;
    const now = Date.now();
    const dmg = {};
    const actor = message.speakerActor;
    const seen = actor ? (HEALTH_SEEN.get(actor.uuid) ?? HEALTH_SEEN.get(`id:${actor.id}`)) : null;
    if (seen && now - seen.t <= DMG_HEALTH_AT) {
      dmg.from = seen.from; dmg.to = seen.to;
      if (seen.max !== null) dmg.max = seen.max;
      HEALTH_SEEN.delete(actor.uuid); HEALTH_SEEN.delete(`id:${actor.id}`);   // one change explains one card
    }
    // the click must be older than the Health change it caused, or it belongs to another attack
    if (APPLY_SEEN && now - APPLY_SEEN.t <= DMG_CLICK_AT && (!seen || seen.t >= APPLY_SEEN.t - 50) && APPLY_SEEN.name) {
      dmg.attacker = { name: APPLY_SEEN.name, img: APPLY_SEEN.img, id: APPLY_SEEN.id };   // kept for the next target when several are selected
    }
    if (Object.keys(dmg).length) message.updateSource({ flags: { [MODULE_ID]: { dmg } } });
  } catch (err) { console.warn(`${MODULE_ID} | damage capture (message)`, err); }
});

/* First display of a fresh card only (per client, keyed by message id): the Health panel is "armed" (bar shows the BEFORE state, readout shows
   the BEFORE number), and when the panel is on screen it plays: the yellow cover slides off the lost part (CSS, transform only), the readout
   counts down (rAF, tabular numerals), the BROKEN stamp lands last. Afterwards every class is removed: the final state is static markup.
   Old messages, reduced motion, re-renders and scrolling never replay. The animated numbers are aria-hidden (the .isp-dmg-hp panel). */
const DMG_SESSION = Date.now();
const DMG_PLAYED = new Set();
const DMG_STOP = new Map();   // message id -> finish() of a first-display animation that is running (Undo stops it before its own animation)
function dmgPlay(message, hp, toEl, from, to) {
  try {
    const id = message?.id;
    if (!id || DMG_PLAYED.has(id) || from === null || from <= to) return;
    const ts = Number(message.timestamp) || 0;
    if (!(Date.now() - ts < DMG_FRESH || ts >= DMG_SESSION)) return;
    if (reduced(hp)) return;
    const win = hp.ownerDocument.defaultView;
    const DELAY = 200, DUR = 750, END = 1550;   // ms: matches isp-dmg-bleed (.8s after .2s) and the BROKEN stamp (1.05s + .3s) in chat.css
    let started = false, raf = 0, timer = 0, obs = null;
    toEl.textContent = String(from);
    hp.classList.add("isp-dmg-arm");
    const finish = () => {
      cancelAnimationFrame(raf); clearTimeout(timer); obs?.disconnect();
      DMG_STOP.delete(id);
      toEl.textContent = String(to);
      hp.classList.remove("isp-dmg-arm", "isp-dmg-play");
    };
    DMG_STOP.set(id, finish);
    const start = () => {
      if (started) return;
      if (!hp.isConnected) return;
      started = true;
      obs?.disconnect();
      DMG_PLAYED.add(id);
      hp.classList.add("isp-dmg-play");
      const t0 = performance.now() + DELAY;
      const tick = (now) => {
        if (!hp.isConnected) return finish();
        const p = Math.min(1, Math.max(0, (now - t0) / DUR));
        toEl.textContent = String(Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      timer = setTimeout(finish, END);
    };
    if (win?.IntersectionObserver) {
      obs = new win.IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) start(); }, { threshold: 0.6 });
      obs.observe(hp);
    } else start();
  } catch (err) { console.warn(`${MODULE_ID} | damage card animation`, err); }
}

function damageCard(message, html) {
  const flavor = game.i18n.localize("INVINCIBLE.Chat.DamageInfo.DamageTaken");
  if (!message?.flavor || message.flavor.trim() !== flavor) return;
  const li = html.matches?.(".chat-message") ? html : html.querySelector?.(".chat-message");
  const content = html.querySelector?.(".message-content");
  if (!li || !content || content.querySelector(".isp-dmg")) return;
  const paras = [...content.querySelectorAll(":scope > p")];
  const sentence = paras[0];
  const damage = parseInt(sentence?.querySelector("strong:last-of-type")?.textContent ?? "", 10);
  if (!sentence || !Number.isFinite(damage)) return;

  const make = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const hide = (el) => { el.setAttribute("aria-hidden", "true"); return el; };
  const t = DMG_TXT[game.i18n.lang === "pl" ? "pl" : "en"];

  // ---- the data: captured flags first; a young card without them may show the actor's Health right now as its "after" ----
  const flag = msgFlag(message, "dmg") ?? {};
  const actor = message.speakerActor;
  let from = dmgNum(flag.from), to = dmgNum(flag.to), max = dmgNum(flag.max);
  if (to === null && Date.now() - (message.timestamp ?? 0) < DMG_FRESH) { from = null; to = dmgNum(actor?.system?.derived?.health?.value); }
  if (to !== null && (max === null || max <= 0)) max = dmgNum(actor?.system?.derived?.health?.max);
  if (max !== null && max <= 0) max = null;
  const attName = typeof flag.attacker?.name === "string" ? flag.attacker.name.trim() : "";
  const broken = to === 0;
  const healthKey = "INVINCIBLE.Actor.base.FIELDS.derived.health.value.label";
  const sys = game.i18n.has?.(healthKey) ? game.i18n.localize(healthKey) : "";
  const healthWord = sys && sys !== "Health" && sys !== healthKey ? sys : t.health;

  // ---- top row: the hit (damage hero) and, when known, who dealt it; the fist tile on the seam is the impact ----
  const root = make("div", "isp-dmg");
  const top = make("div", "isp-dmg-top");
  const hit = hide(make("div", "isp-dmg-hit"));
  const numText = `-${damage}`;
  hit.dataset.len = String(numText.length);
  hit.append(make("span", "isp-dmg-cap", t.damage), make("b", "isp-dmg-n", numText));
  top.append(hit);
  if (attName) {
    const seam = hide(make("i", "isp-dmg-seam"));
    const by = hide(make("div", "isp-dmg-from"));
    const attId = typeof flag.attacker?.id === "string" ? flag.attacker.id : "";
    const initial = () => openablePortrait(make("span", "isp-dmg-av isp-dmg-ini", [...attName][0]?.toUpperCase() ?? "?"), attId, attName);
    let av;
    if (typeof flag.attacker?.img === "string" && flag.attacker.img) {
      av = make("img", "isp-dmg-av");
      av.alt = "";
      av.loading = "lazy";
      av.src = flag.attacker.img;
      openablePortrait(av, attId, attName);
      av.addEventListener("error", () => av.replaceWith(initial()), { once: true });
    } else av = initial();
    by.append(make("span", "isp-dmg-fl", t.attacker), av, make("span", "isp-dmg-fname", attName));
    top.append(seam, by);
  }
  root.append(top);

  // ---- Health: before -> after / max, and a continuous bar (kept part solid, lost part hatched red) ----
  let hpAnim = null;
  if (to !== null) {
    const hp = hide(make("div", "isp-dmg-hp"));
    const head = make("div", "isp-dmg-hh");
    head.append(make("span", "isp-dmg-hl", healthWord));
    if (broken) {   // a sticker: the zero-size slot sits in the gap of the row, the stamp inside it is absolutely positioned (never takes room)
      const slot = make("span", "isp-dmg-bslot");
      slot.append(make("span", "isp-dmg-broken", t.broken));
      head.append(slot);
    }
    const read = make("span", "isp-dmg-read");
    if (from !== null) read.append(make("span", "isp-hp-from", String(from)), make("i", "isp-hp-arrow"));
    const toEl = make("b", "isp-hp-to", String(to));
    if (from !== null) { toEl.style.display = "inline-block"; toEl.style.textAlign = "right"; toEl.style.minWidth = `${Math.max(String(from).length, String(to).length)}ch`; }   // fixed width: the count-down never shifts its neighbours
    read.append(toEl);
    hpAnim = { hp, toEl };
    if (max) read.append(make("span", "isp-hp-max", `/ ${max}`));
    head.append(read);
    hp.append(head);
    if (max) {
      const pct = (v) => Math.max(0, Math.min(100, (v / max) * 100));
      const bar = make("div", "isp-dmg-bar");
      bar.style.setProperty("--to", pct(to).toFixed(2));
      if (pct(to) <= 34) hp.classList.add("isp-dmg-low");   // same threshold as the sheet's low Health: heart tile + number go red-ink (CSS)
      if (from !== null && from > to) bar.style.setProperty("--from", pct(from).toFixed(2));
      const step = max <= 20 ? 1 : max <= 40 ? 5 : max <= 100 ? 10 : 0;   // hairline ticks: every point on a small bar, fewer on a large one
      if (step) {
        bar.dataset.ticks = "1";
        if (max / step > 12) bar.dataset.dense = "1";   // 13-20 segments: CSS draws the slanted dividers a little thinner
        bar.style.setProperty("--tick", `${((step / max) * 100).toFixed(3)}%`);
      }
      if (to > 0) bar.append(make("i", "isp-dmg-keep"));
      if (from !== null && from > to) bar.append(make("i", "isp-dmg-lost"));
      hp.append(bar);
    }
    root.append(hp);
  }

  // ---- screen readers: the system's own sentence + one summary sentence; everything above is decoration for the eye ----
  const sr = make("div", "isp-dmg-sr");
  sr.append(sentence);
  const summary = [to !== null ? t.hp(from, to, max) : "", broken ? t.brokenSr : "", attName ? t.by(attName) : ""].filter(Boolean).join(" ");
  if (summary) sr.append(make("p", "", summary));
  root.append(sr);
  content.prepend(root);
  li.classList.add("isp-dmgcard");
  if (broken) li.classList.add("isp-dmg-brk");
  if (hpAnim) dmgPlay(message, hpAnim.hp, hpAnim.toEl, from, to);

  const ciName = paras[1]?.querySelector("strong")?.textContent?.trim();
  if (!ciName) return;
  li.classList.add("isp-dmg-injury");
  const typeKey = "TYPES.Item.criticalInjury";
  const tag = make("div", "isp-dmg-ci");
  const label = make("span", "isp-dmg-cit", game.i18n.has?.(typeKey) ? game.i18n.localize(typeKey) : "Critical Injury");
  const holder = make("span", "isp-dmg-ciname");
  const plain = make("b", "isp-dmg-cin", ciName);
  holder.append(plain);
  tag.append(label, holder);
  paras[1].replaceWith(tag);

  const link = () => {
    const item = message.speakerActor?.items?.find((i) => i.type === "criticalInjury" && i.name === ciName);
    if (!item || !holder.isConnected) return false;
    const a = make("a", "content-link isp-dmg-link");
    a.tabIndex = 0;
    a.setAttribute("role", "link");
    a.dataset.uuid = item.uuid;
    a.dataset.tooltip = item.name;
    const icon = make("i", "fa-solid fa-bandage");
    icon.setAttribute("inert", "");
    a.append(icon, document.createTextNode(ciName));
    const open = (ev) => { ev.preventDefault(); ev.stopPropagation(); item.sheet?.render(true); };
    a.addEventListener("click", open);
    a.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") open(ev); });
    holder.replaceChildren(a);
    return true;
  };
  if (!link()) setTimeout(link, 800);
}
Hooks.on("renderChatMessageHTML", (message, html) => {
  try { damageCard(message, html); } catch (err) { console.warn(`${MODULE_ID} | damage card`, err); }
});

/* ---------- GM: double-click a portrait on a chat card to open that character's sheet ----------
   Targets: the speaker portrait in every card header (message.speakerActor: the token's actor for an unlinked token) and, on the Damage
   taken card, the attacker's portrait (actor uuid / id kept in flags.dmg.attacker.id; no id = not openable, nothing is marked).
   One delegated dblclick listener per document (the main one, plus a popout window's document as soon as it renders an application).
   Marked elements carry data-isp-open (CSS: no text selection); the optional data-isp-actor holds the actor reference. */
const PORTRAIT_TXT = { en: "Double-click to open the character sheet", pl: "Dwuklik otwiera kartę postaci" };
const PORTRAIT_DOCS = new WeakSet();

function openablePortrait(el, actorRef, name) {
  if (!el || !game.user?.isGM) return el;
  if (actorRef !== null && actorRef !== undefined && !actorRef) return el;   // an attacker without an id: nothing to open
  const hint = PORTRAIT_TXT[game.i18n.lang === "pl" ? "pl" : "en"];
  el.dataset.ispOpen = "1";
  if (actorRef) el.dataset.ispActor = actorRef;
  el.dataset.tooltip = hint;
  el.dataset.tooltipDirection = "UP";
  el.setAttribute("aria-label", name ? `${name}. ${hint}` : hint);
  return el;
}

function portraitActor(el) {
  const ref = el.closest("[data-isp-actor]")?.dataset.ispActor;
  if (ref) {
    try {
      const doc = ref.includes(".") ? fromUuidSync(ref) : game.actors.get(ref);
      const actor = doc?.documentName === "Token" ? doc.actor : doc;
      return actor?.documentName === "Actor" ? actor : null;
    } catch { return null; }
  }
  const id = el.closest("li.chat-message")?.dataset?.messageId;
  return (id ? game.messages.get(id)?.speakerActor : null) ?? null;
}

function bindPortraits(doc) {
  if (!doc || PORTRAIT_DOCS.has(doc)) return;
  PORTRAIT_DOCS.add(doc);
  doc.addEventListener("dblclick", (ev) => {
    try {
      if (!game.user.isGM) return;
      const el = ev.target?.closest?.(".chat-message [data-isp-open]");
      if (!el) return;
      const sheet = portraitActor(el)?.sheet;
      if (!sheet) return;
      ev.preventDefault();
      ev.stopPropagation();   // only our double-click: single clicks on the portrait keep Foundry's own behaviour
      Promise.resolve(sheet.render({ force: true })).then(() => sheet.bringToFront?.()).catch((err) => console.warn(`${MODULE_ID} | open sheet`, err));
    } catch (err) { console.warn(`${MODULE_ID} | portrait double-click`, err); }
  });
}
bindPortraits(document);
Hooks.on("renderApplicationV2", (_app, element) => { try { bindPortraits(element?.ownerDocument); } catch { /* a popout without a document */ } });
Hooks.on("renderChatMessageHTML", (message, html) => {
  try {
    if (!game.user.isGM) return;
    bindPortraits(html.ownerDocument);
    const actor = message.speakerActor;
    if (!actor) return;
    for (const img of html.querySelectorAll(".message-header img.avatar")) openablePortrait(img, null, actor.name);
  } catch (err) { console.warn(`${MODULE_ID} | portrait hint`, err); }
});

/* =====================================================================================================================
   UNDO FOR "APPLY DAMAGE" (self-contained section)
   The system's Apply damage records nothing about itself, so the GM client keeps a LEDGER on the attack card (the message whose button
   was clicked): flags.invincible-plus-ultra.applied = [ { uid, actorUuid, tokenUuid, name, healthFrom, healthTo, conditionItemId,
   injuryItemId, damageMsgId, t } ], one entry per target actor that was hit. Undo reads it; nothing here edits the system.
   Capture WINDOW: opened by the capture-phase click on the card's Apply damage button, with the tokens selected at that moment as its
   targets (the system uses the same selection). It lasts until every target has its "Damage Taken" message (+ a short grace for the
   critical-injury item) or APPLY_WINDOW_MS, whichever comes first. Inside a window only these hooks write to it:
     - preUpdateActor: a Health DROP on a target, and only when it equals what the system would compute (attack damage minus the
       highest armor protection unless bypassed, floored at 0). Anything else is not attributed.
     - createItem on a target: a criticalInjury (only for a slot whose Health went to 0) or the roll's condition item
       (matched by compendium source or name).
     - createChatMessage: the "Damage Taken" message created by this client for a target whose Health was captured.
   Several windows (double click, two cards) are served first-in-first-out per target slot, so each Health change is claimed once.
   Writes to one message are serialised, an entry is merged by uid (later flushes add the item / message ids) and an undone uid can
   never come back. If something cannot be attributed with confidence it is simply not recorded: the entry only holds what is certain. */
const APPLY_WINDOW_MS = 12000;   // a window closes after this long at the latest (compendium loads can be slow)
const APPLY_GRACE_MS = 2500;     // after the last target's message: the injury item may still be on its way
const APPLY_FLUSH_MS = 500;      // events are written to the card in one update after this quiet time
const APPLY_OPEN = [];           // open windows, oldest first
const APPLY_QUEUE = new Map();   // attack message id -> promise (serialised ledger writes)
const UNDO_BUSY = new Set();     // ledger entry uids being undone
const UNDONE = new Set();        // uids already undone in this session

const ledgerOf = (message) => {
  const list = msgFlag(message, "applied");
  return Array.isArray(list) ? list.filter((e) => e && typeof e === "object" && typeof e.uid === "string") : [];
};

function ledgerWrite(msgId, fn) {
  const next = (APPLY_QUEUE.get(msgId) ?? Promise.resolve()).catch(() => {}).then(fn);
  APPLY_QUEUE.set(msgId, next);
  next.catch(() => {}).then(() => { if (APPLY_QUEUE.get(msgId) === next) APPLY_QUEUE.delete(msgId); });
  return next;
}

/* what the system would do to this target: attack damage minus the best armor (unless bypassed), floored at 0, then Health - damage */
function expectedHealth(snap, actor, from) {
  if (!snap.actual || !Number.isFinite(snap.dmg)) return null;
  let protection = 0;
  const armor = actor?.system?.bonuses?.armorProtection;
  if (armor && !snap.bypass) {
    const values = Object.values(armor).map(Number).filter(Number.isFinite);
    if (values.length) protection = Math.max(...values);
  }
  return Math.max(0, from - Math.max(0, snap.dmg - protection));
}

function openApplyWindow(msgId, synth = null) {
  try {
    if (!game.user.isGM) return null;
    const message = game.messages.get(msgId);
    const roll = message?.rolls?.[0];
    if (!message || (!roll && !synth)) return null;
    const snap = synth ?? { dmg: Number(roll.attackDamage), bypass: !!roll.options?.bypassArmor, actual: !!roll.options?.actualDamage, cond: roll.options?.conditionToApply ?? null };
    const pairs = synth?.actors
      ? synth.actors.map((actor) => ({ actor, token: actor.token ?? null }))
      : (canvas?.tokens?.controlled ?? []).map((t) => ({ actor: t.actor, token: t.document }));
    const slots = pairs.filter((p) => p.actor).map((p) => ({
      uid: foundry.utils.randomID(), actorUuid: p.actor.uuid, tokenUuid: p.token?.uuid ?? null, name: String(p.actor.name ?? ""),
      healthFrom: null, healthTo: null, conditionItemId: null, injuryItemId: null, damageMsgId: null, t: null
    }));
    if (!slots.length) return null;
    const w = { msgId, t0: Date.now(), snap, slots, closed: false, timer: 0, flushT: 0, lastKey: "" };
    w.timer = setTimeout(() => closeApplyWindow(w), APPLY_WINDOW_MS);
    APPLY_OPEN.push(w);
    return w;
  } catch (err) { console.warn(`${MODULE_ID} | undo ledger (window)`, err); return null; }
}

function closeApplyWindow(w) {
  if (w.closed) return;
  w.closed = true;
  clearTimeout(w.timer);
  flushApplyWindow(w);
  const i = APPLY_OPEN.indexOf(w);
  if (i >= 0) APPLY_OPEN.splice(i, 1);
}

/* first open window (oldest first) with a target slot of this actor that satisfies the test */
function applySlot(actorUuid, test) {
  for (const w of APPLY_OPEN) {
    if (w.closed) continue;
    const s = w.slots.find((slot) => slot.actorUuid === actorUuid && test(w, slot));
    if (s) return { w, s };
  }
  return null;
}

function flushApplyWindow(w) {
  clearTimeout(w.flushT);
  const entries = w.slots
    .filter((s) => s.healthTo !== null || s.conditionItemId)
    .map((s) => ({ uid: s.uid, actorUuid: s.actorUuid, tokenUuid: s.tokenUuid, name: s.name, healthFrom: s.healthFrom, healthTo: s.healthTo,
      conditionItemId: s.conditionItemId, injuryItemId: s.injuryItemId, damageMsgId: s.damageMsgId, t: s.t ?? w.t0 }));
  const key = JSON.stringify(entries);
  if (!entries.length || key === w.lastKey) return Promise.resolve();
  w.lastKey = key;
  return ledgerWrite(w.msgId, async () => {
    const message = game.messages.get(w.msgId);
    if (!message) return;
    const byUid = new Map(ledgerOf(message).map((e) => [e.uid, e]));
    for (const e of entries) if (!UNDONE.has(e.uid)) byUid.set(e.uid, e);
    if (!byUid.size) return;
    await message.update({ flags: { [MODULE_ID]: { applied: [...byUid.values()] } } });
  }).catch((err) => console.warn(`${MODULE_ID} | undo ledger (write)`, err));
}

function touchApply(w) {
  clearTimeout(w.flushT);
  w.flushT = setTimeout(() => flushApplyWindow(w), APPLY_FLUSH_MS);
}

document.addEventListener("click", (ev) => {
  try {
    const btn = ev.target?.closest?.('.chat-message .dice-buttons.apply-damage button[data-action="applyTargetDamage"]');
    const id = btn?.closest("[data-message-id]")?.dataset?.messageId;
    if (id) openApplyWindow(id);
  } catch (err) { console.warn(`${MODULE_ID} | undo ledger (click)`, err); }
}, true);   // capture phase: the selection is read before the system's handler runs

Hooks.on("preUpdateActor", (actor, changes) => {
  try {
    if (!APPLY_OPEN.length) return;
    const key = "system.derived.health.value";
    const to = dmgNum(changes?.[key] ?? foundry.utils.getProperty(changes ?? {}, key));
    const from = dmgNum(actor?.system?.derived?.health?.value);
    if (to === null || from === null || to >= from) return;
    const hit = applySlot(actor.uuid, (w, s) => {
      if (s.healthTo !== null) return false;
      const expected = expectedHealth(w.snap, actor, from);
      return expected !== null && expected === to;
    });
    if (!hit) return;
    Object.assign(hit.s, { healthFrom: from, healthTo: to, t: Date.now() });
    touchApply(hit.w);
  } catch (err) { console.warn(`${MODULE_ID} | undo ledger (health)`, err); }
});

const conditionMatches = (item, uuid) => {
  if (!uuid) return false;
  const src = item._stats?.compendiumSource ?? item.flags?.core?.sourceId ?? null;
  if (src && src === uuid) return true;
  let name = null;
  try { name = fromUuidSync(uuid)?.name ?? null; } catch { name = null; }
  return !!name && item.name === name;
};

Hooks.on("createItem", (item) => {
  try {
    if (!APPLY_OPEN.length) return;
    const actor = item.parent;
    if (!actor || actor.documentName !== "Actor") return;
    const injury = item.type === "criticalInjury";
    const hit = applySlot(actor.uuid, (w, s) => (injury ? s.healthTo === 0 && !s.injuryItemId : !s.conditionItemId && conditionMatches(item, w.snap.cond)));
    if (!hit) return;
    if (injury) hit.s.injuryItemId = item.id; else hit.s.conditionItemId = item.id;
    touchApply(hit.w);
  } catch (err) { console.warn(`${MODULE_ID} | undo ledger (item)`, err); }
});

Hooks.on("createChatMessage", (message) => {
  try {
    if (!APPLY_OPEN.length || message?.author?.id !== game.user.id) return;
    if (!message.flavor || message.flavor.trim() !== game.i18n.localize("INVINCIBLE.Chat.DamageInfo.DamageTaken")) return;
    const actor = message.speakerActor;
    if (!actor) return;
    const hit = applySlot(actor.uuid, (w, s) => s.healthTo !== null && !s.damageMsgId);
    if (!hit) return;
    hit.s.damageMsgId = message.id;
    touchApply(hit.w);
    // every target answered: close soon (a target with 0 damage never answers; then the time limit closes the window)
    if (hit.w.slots.every((s) => s.damageMsgId)) { clearTimeout(hit.w.timer); hit.w.timer = setTimeout(() => closeApplyWindow(hit.w), APPLY_GRACE_MS); }
  } catch (err) { console.warn(`${MODULE_ID} | undo ledger (message)`, err); }
});

/* ---------- Undo: a button on the "Damage taken" card ----------
   The card finds its ledger entry by itself (ledgerFor: the attack message whose ledger names this card as damageMsgId), so nothing is
   written to the Damage Taken message and it never re-renders because of the ledger (that would cut the first-display animation short).
   The ledger write re-renders the ATTACK card; the updateChatMessage hook below then adds the button to cards that are already on screen.
   Undo order: Health + items (the confirm dialog may stop everything here, then nothing plays), the short reverse animation of the Health
   bar, the card leaves, the Damage Taken message is deleted, the ledger entry is removed. */
const UNDO_TXT = {
  en: {
    label: "Undo", busy: "Undoing...",
    aria: (name) => `Undo damage to ${name}`, tipTitle: (name) => `Undo damage to ${name}`,
    tipHp: (a, b) => `Restores Health ${a} -> ${b}.`,
    tipInjury: (n) => (n ? `Removes the critical injury ${n}.` : "Removes the critical injury."),
    tipCond: (n) => (n ? `Removes the condition ${n}.` : "Removes the condition."),
    tipPlain: "Removes this card.",
    title: "Health changed", yes: "Restore", no: "Keep",
    ask: (name, now, to) => `Health of ${name} changed since the damage was applied (now ${now}). Restore it to ${to} anyway?`,
    kept: (name, now) => `Health of ${name} stays at ${now}.`,
    done: (name) => `Damage undone: ${name}`, doneHp: (name, a, b) => `Damage undone: ${name} health ${a} -> ${b}`,
    fail: "Could not undo the damage. Details are in the console."
  },
  pl: {
    label: "Cofnij", busy: "Cofam...",
    aria: (name) => `Cofnij obrażenia: ${name}`, tipTitle: (name) => `Cofnij obrażenia: ${name}`,
    tipHp: (a, b) => `Przywraca Zdrowie ${a} -> ${b}.`,
    tipInjury: (n) => (n ? `Usuwa ranę krytyczną ${n}.` : "Usuwa ranę krytyczną."),
    tipCond: (n) => (n ? `Usuwa stan ${n}.` : "Usuwa stan."),
    tipPlain: "Usuwa tę kartę.",
    title: "Zdrowie się zmieniło", yes: "Przywróć", no: "Zostaw",
    ask: (name, now, to) => `Zdrowie ${name} zmieniło się od zadania obrażeń (teraz ${now}). Przywrócić mimo to do ${to}?`,
    kept: (name, now) => `Zdrowie ${name} zostaje na ${now}.`,
    done: (name) => `Cofnięto obrażenia: ${name}`, doneHp: (name, a, b) => `Cofnięto obrażenia: ${name}, zdrowie ${a} -> ${b}`,
    fail: "Nie udało się cofnąć obrażeń. Szczegóły w konsoli."
  }
};
const undoText = () => UNDO_TXT[game.i18n.lang === "pl" ? "pl" : "en"];

/* the attack message + ledger entry that produced this Damage Taken card (null for old cards, macros, another table) */
function ledgerFor(damageMsgId) {
  if (!damageMsgId) return null;
  for (const m of game.messages) {
    if (!Array.isArray(msgFlag(m, "applied"))) continue;
    const entry = ledgerOf(m).find((e) => e.damageMsgId === damageMsgId);
    if (entry) return { attack: m, entry };
  }
  return null;
}

async function ledgerActor(entry) {
  for (const uuid of [entry.actorUuid, entry.tokenUuid]) {
    if (!uuid) continue;
    try {
      const doc = await fromUuid(uuid);
      const actor = doc?.documentName === "Token" ? doc.actor : doc;
      if (actor?.documentName === "Actor") return actor;
    } catch { /* try the next one */ }
  }
  return null;
}

/* Reverts one entry's DATA in this order: Health (asks first when it changed since), items. Returns { name, restore, now } when it is
   settled, or null when the GM chose to keep the current Health (nothing was touched). The card and the ledger are the caller's job. */
async function undoEntry(entry, T) {
  const actor = await ledgerActor(entry);
  const name = actor?.name || entry.name || "?";
  let restore = null;
  let now = null;
  if (actor && entry.healthFrom !== null && entry.healthFrom !== undefined && entry.healthTo !== null && entry.healthTo !== undefined) {
    now = dmgNum(actor.system?.derived?.health?.value);
    if (now === entry.healthTo) restore = entry.healthFrom;
    else if (now !== null && now !== entry.healthFrom) {
      const yes = await foundry.applications.api.DialogV2.confirm({
        window: { title: T.title }, modal: true, rejectClose: false,
        content: `<p>${stuntEsc(T.ask(name, now, entry.healthFrom))}</p>`,
        yes: { label: T.yes }, no: { label: T.no }
      });
      if (!yes) { ui.notifications.info(T.kept(name, now)); return null; }
      restore = entry.healthFrom;
    }
  }
  if (actor && restore !== null) {
    const max = dmgNum(actor.system?.derived?.health?.max);
    await actor.update({ "system.derived.health.value": max && max > 0 ? Math.min(restore, max) : restore });
    HEALTH_SEEN.delete(actor.uuid); HEALTH_SEEN.delete(`id:${actor.id}`);   // this rise is not a hit: it must never explain a later Damage Taken card
  }
  if (actor) {
    const ids = [];
    if (entry.conditionItemId && actor.items.has(entry.conditionItemId)) ids.push(entry.conditionItemId);
    if (entry.injuryItemId && actor.items.get(entry.injuryItemId)?.type === "criticalInjury") ids.push(entry.injuryItemId);
    if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
  }
  return { name, restore, now };
}

/* The reverse of the card's first display (DOM only, transform / opacity only, ~0.7 s): the cover slides back over the hatched lost part
   (the fill edge travels from "after" to "before"), the readout counts up, the bar pulses once, then the card leaves. Resolves when the
   card is gone from view; resolves at once when there is no visible card (chat tab closed, other window) or under reduced motion. */
const UNDO_FILL_MS = 460, UNDO_PULSE_MS = 160, UNDO_OUT_MS = 240;
function undoCards(msgId) { return [...document.querySelectorAll(`li.chat-message[data-message-id="${msgId}"]`)]; }

function undoPlay(msgId, back) {
  try {
    DMG_STOP.get(msgId)?.();   // a first-display animation still running must not fight this one
    const cards = undoCards(msgId).filter((li) => li.isConnected && !reduced(li) && (typeof li.checkVisibility !== "function" || li.checkVisibility()));
    if (!cards.length) return Promise.resolve();
    return Promise.all(cards.map((li) => new Promise((resolve) => {
      const win = li.ownerDocument.defaultView;
      const hp = li.querySelector(".isp-dmg-hp");
      const toEl = hp?.querySelector(".isp-hp-to");
      const timers = [];
      let raf = 0, over = false;
      const end = () => { if (over) return; over = true; win.cancelAnimationFrame(raf); timers.forEach(clearTimeout); resolve(); };
      const leave = () => {
        if (!li.isConnected) return end();
        if (toEl && back !== null) toEl.textContent = String(back);
        li.classList.add("isp-dmg-out");
        timers.push(setTimeout(end, UNDO_OUT_MS));
      };
      timers.push(setTimeout(end, 1800));   // never hold the delete hostage
      const after = toEl ? dmgNum(toEl.textContent) : null;
      if (!hp || !hp.isConnected) return leave();
      toEl.dataset.ispWas = toEl.textContent;
      li.classList.remove("isp-dmg-brk");
      hp.classList.remove("isp-dmg-arm", "isp-dmg-play");
      hp.classList.add("isp-dmg-undoing");
      if (toEl && after !== null && back !== null && back > after) {
        const t0 = performance.now();
        const tick = (now) => {
          const p = Math.min(1, (now - t0) / UNDO_FILL_MS);
          toEl.textContent = String(Math.round(after + (back - after) * (1 - Math.pow(1 - p, 3))));
          if (p < 1 && li.isConnected) raf = win.requestAnimationFrame(tick);
        };
        raf = win.requestAnimationFrame(tick);
      }
      timers.push(setTimeout(leave, UNDO_FILL_MS + UNDO_PULSE_MS + 40));
    })));
  } catch (err) { console.warn(`${MODULE_ID} | undo animation`, err); return Promise.resolve(); }
}

/* undo failed after the animation started (the message could not be deleted): put the card back as it was */
function undoReset(msgId) {
  for (const li of undoCards(msgId)) {
    li.classList.remove("isp-dmg-out");
    const hp = li.querySelector(".isp-dmg-hp");
    hp?.classList.remove("isp-dmg-undoing");
    const toEl = hp?.querySelector(".isp-hp-to");
    if (toEl?.dataset.ispWas !== undefined) { toEl.textContent = toEl.dataset.ispWas; delete toEl.dataset.ispWas; }
  }
}

/* Undoes ONE target: attackId = the attack message that holds the ledger, uid = the entry (one Damage Taken card). */
async function runUndo(attackId, uid, btn) {
  if (!game.user.isGM || !attackId || !uid || UNDO_BUSY.has(uid) || UNDONE.has(uid)) return;
  const entry = ledgerOf(game.messages.get(attackId)).find((e) => e.uid === uid);
  if (!entry) return;
  UNDO_BUSY.add(uid);
  const T = undoText();
  const label = btn?.querySelector?.(".isp-undo-t");
  const busy = (on) => {
    if (!btn?.isConnected) return;
    btn.disabled = on;
    if (on) btn.setAttribute("aria-busy", "true"); else btn.removeAttribute("aria-busy");
    if (label) label.textContent = on ? T.busy : T.label;
  };
  busy(true);
  let done = false;
  try {
    const res = await undoEntry(entry, T);
    if (res) {
      const back = dmgNum(entry.healthFrom);
      if (entry.damageMsgId) {
        await undoPlay(entry.damageMsgId, back);
        const taken = game.messages.get(entry.damageMsgId);
        // the card is deleted, not greyed out: an undone hit leaves nothing in the log to misread
        if (taken && taken.flavor?.trim() === game.i18n.localize("INVINCIBLE.Chat.DamageInfo.DamageTaken")) await taken.delete();
      }
      UNDONE.add(uid);   // from here the entry can never be re-added by a late flush
      done = true;
      await ledgerWrite(attackId, async () => {
        const message = game.messages.get(attackId);
        if (!message) return;
        const left = ledgerOf(message).filter((e) => e.uid !== uid);
        if (left.length) await message.update({ flags: { [MODULE_ID]: { applied: left } } });
        else {
          /* nothing left: clear the ledger, also a legacy one (otherwise the fallback would bring the old entries back) */
          const clear = { [`flags.${MODULE_ID}.-=applied`]: null };
          if (message.flags?.[LEGACY_ID]?.applied !== undefined) clear[`flags.${LEGACY_ID}.-=applied`] = null;
          await message.update(clear);
        }
      });
      ui.notifications.info(res.restore !== null && res.now !== null ? T.doneHp(res.name, res.now, res.restore) : T.done(res.name));
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | undo`, err);
    ui.notifications.error(T.fail);
    if (entry.damageMsgId) undoReset(entry.damageMsgId);
  } finally {
    UNDO_BUSY.delete(uid);
    if (!done) busy(false);
  }
}

/* the button, appended after the card's panels (GM only, only for a card that has a ledger entry) */
function undoOnCard(message, li) {
  if (!game.user.isGM || !message?.id || !li?.querySelector) return;
  if (!message.flavor || message.flavor.trim() !== game.i18n.localize("INVINCIBLE.Chat.DamageInfo.DamageTaken")) return;
  const content = li.querySelector(".message-content");
  if (!content) return;
  const old = content.querySelector(":scope > .isp-dmg-act");
  if (old?.querySelector("[aria-busy]")) return;
  const found = ledgerFor(message.id);
  if (!found || UNDONE.has(found.entry.uid)) { old?.remove(); return; }
  const { attack, entry } = found;
  const sig = [entry.uid, entry.healthFrom, entry.healthTo, entry.injuryItemId, entry.conditionItemId].join("|");
  if (old?.dataset.sig === sig) return;
  old?.remove();

  const T = undoText();
  const actor = message.speakerActor;
  const name = String(entry.name || actor?.name || message.alias || "?");
  const itemName = (id) => (id ? String(actor?.items?.get(id)?.name ?? "") : "");
  const a = dmgNum(entry.healthTo), b = dmgNum(entry.healthFrom);
  const parts = [];
  if (a !== null && b !== null) parts.push(T.tipHp(a, b));
  if (entry.injuryItemId) parts.push(T.tipInjury(itemName(entry.injuryItemId)));
  if (entry.conditionItemId) parts.push(T.tipCond(itemName(entry.conditionItemId)));
  if (!parts.length) parts.push(T.tipPlain);

  const box = document.createElement("div");
  box.className = "isp-dmg-act";
  box.dataset.sig = sig;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "isp-undo";
  btn.setAttribute("aria-label", T.aria(name));
  const sr = document.createElement("span");
  sr.className = "isp-undo-sr";
  sr.id = `isp-undo-${message.id}`;
  sr.textContent = parts.join(" ");
  btn.setAttribute("aria-describedby", sr.id);
  const text = document.createElement("span");
  text.className = "isp-undo-t";
  text.textContent = T.label;
  btn.append(text);
  btn.dataset.tooltipHtml = `<strong>${stuntEsc(T.tipTitle(name))}</strong>${parts.map((p) => `<p>${stuntEsc(p)}</p>`).join("")}`;
  btn.dataset.tooltipClass = "isp-tip";
  btn.dataset.tooltipDirection = "UP";
  btn.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); runUndo(attack.id, entry.uid, btn); });
  box.append(btn, sr);
  content.append(box);
}

Hooks.on("renderChatMessageHTML", (message, html) => {
  try { undoOnCard(message, html.matches?.(".chat-message") ? html : html.querySelector?.(".chat-message")); } catch (err) { console.warn(`${MODULE_ID} | undo button`, err); }
});
/* the ledger is written ~0.5 s after the card appears: put the button on cards that are already on screen (every GM client) */
Hooks.on("updateChatMessage", (message) => {
  try {
    if (!game.user.isGM || !Array.isArray(msgFlag(message, "applied"))) return;
    for (const e of ledgerOf(message)) {
      if (!e.damageMsgId) continue;
      const taken = game.messages.get(e.damageMsgId);
      if (taken) for (const li of undoCards(e.damageMsgId)) undoOnCard(taken, li);
    }
  } catch (err) { console.warn(`${MODULE_ID} | undo button (refresh)`, err); }
});

/* the tooltip also on keyboard focus (Esc hides it) */
const UNDO_TIP = ".chat-message .isp-undo[data-tooltip-html]";
document.addEventListener("focusin", (ev) => {
  const b = ev.target?.closest?.(UNDO_TIP);
  if (b && game.tooltip?.activate) game.tooltip.activate(b, { html: b.dataset.tooltipHtml, direction: "UP", cssClass: "isp-tip" });
});
document.addEventListener("focusout", (ev) => { if (ev.target?.closest?.(UNDO_TIP)) game.tooltip?.deactivate?.(); });
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && ev.target?.closest?.(UNDO_TIP)) game.tooltip?.deactivate?.(); });

/* handle for tests from the console: game.modules.get("invincible-plus-ultra").api */
Hooks.once("ready", () => {
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = { ...(mod.api ?? {}), openApplyWindow, closeApplyWindow, flushApplyWindow, runUndo, ledgerOf, ledgerFor, windows: APPLY_OPEN };
});

/* =====================================================================================================================
   STUNTS ON THE CARD (self-contained section; client setting "inlineStunts", default on)
   How the system does it: after a non-pushable attack roll with successes beyond the first (roll.stunts = successCount - 1), the
   system opens InvincibleStuntsDialog (system/applications/dialog/stunts.mjs). The dialog builds its options from the system's own
   STUNTS config, lets the player spend ALL the budget (Apply stays disabled until it is spent), and on Apply runs every chosen
   stunt's own action() on a copy of the roll and writes message.update({ rolls: [roll] }). The chosen stunts end up in
   roll.options.stuntsList (the strings the card prints as ul.stunts); Double Damage doubles roll.options.damage; Deadly Hit also draws
   the critical-injury table to chat. The roll's "Apply damage" button needs successCount == 1 or a non-empty stuntsList.
   What this section does, WITHOUT re-implementing any rule or editing the system:
     1. imports the system's own dialog class (same URL, so the same module instance the system uses) and reads its options
        (new InvincibleStuntsDialog(message, 0).stuntOptions: names, max, exclusion, requiresActor already applied),
     2. paints a picker into the card's .isp-stunts frame (only for the roll's author or a GM, only while nothing is applied yet),
     3. on Confirm sets the same values on a fresh dialog object and calls its own _updateMessage(): the very code path the dialog's
        Apply button runs, without ever rendering the dialog,
     4. while the setting is on, the dialog's wait() resolves at once, so the pop-up does not open (setting off = system untouched).
   Everything is guarded: if the import or the picker fails, the dialog is not suppressed (import) or an "Open dialog" button appears. */
const INLINE_STUNTS = "inlineStunts";
const STUNT_DIALOG_PATH = "systems/invincible/system/applications/dialog/stunts.mjs";
let STUNT_DLG = null;          // the system's dialog class, once imported
let STUNT_DLG_LOAD = null;     // the import promise (resolves to the class or null)
const STUNT_DRAFT = new Map(); // message id -> { stuntName: count } (a re-render of the card keeps what was picked)
const STUNT_BUSY = new Set();  // message ids being applied right now (a double click must not apply twice: Double Damage would double twice)
let STUNT_UID = 0;

function registerInlineStunts() {
  if (game.settings.settings.has(`${MODULE_ID}.${INLINE_STUNTS}`)) return;
  game.settings.register(MODULE_ID, INLINE_STUNTS, {
    name: "Stunty wybierane na karcie rzutu",
    hint: "Zamiast okna dialogowego po ataku wybierasz stunty bezpośrednio na karcie (przyciski, licznik, Zatwierdź). Wyłączone = system działa po staremu, z oknem.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
}
try { if (game?.settings) registerInlineStunts(); else Hooks.once("init", registerInlineStunts); } catch { Hooks.once("init", registerInlineStunts); }
Hooks.once("init", registerInlineStunts);

/* Who may pick stunts on a card: a GM, or the owner of the character that rolled. Foundry only lets the message's author or a GM update a chat
   message, so the owner must also be able to modify it (a co-owner who is not the author cannot, and then sees the muted line). */
const canPickStunts = (message) => {
  try {
    if (!message?.canUserModify?.(game.user, "update")) return false;
    if (game.user.isGM) return true;
    return message.speakerActor?.testUserPermission?.(game.user, "OWNER") === true;
  } catch { return false; }
};
const inlineStuntsOn = () => { try { return game.settings.get(MODULE_ID, INLINE_STUNTS) === true; } catch { return false; } };

function loadStuntDialog() {
  STUNT_DLG_LOAD ??= (async () => {
    try {
      const url = foundry.utils.getRoute?.(STUNT_DIALOG_PATH) ?? `/${STUNT_DIALOG_PATH}`;
      const Cls = (await import(url))?.default;
      if (typeof Cls !== "function" || typeof Cls.prototype?._updateMessage !== "function" || typeof Cls.prototype?.wait !== "function") throw new Error("unexpected stunts dialog class");
      if (!Cls.prototype.wait.ispPatched) {
        const original = Cls.prototype.wait;
        const wrapped = function (...args) {
          // inline mode: do not open the pop-up (the card has the picker). Not for a dialog opened on purpose (_ispForce).
          if (inlineStuntsOn() && !this._ispForce && canPickStunts(this.message)) return Promise.resolve(undefined);
          return original.apply(this, args);
        };
        wrapped.ispPatched = true;
        Cls.prototype.wait = wrapped;
      }
      STUNT_DLG = Cls;
      return Cls;
    } catch (err) {
      console.warn(`${MODULE_ID} | stunts on the card unavailable (the system dialog is used)`, err);
      return null;
    }
  })();
  return STUNT_DLG_LOAD;
}
Hooks.once("setup", () => { loadStuntDialog(); });

/* Same code path as the dialog's Apply: set the values on a fresh dialog object and let its own _updateMessage() do the work. */
async function applyStuntPicks(message, picks) {
  const Cls = STUNT_DLG ?? await loadStuntDialog();
  if (!Cls) throw new Error("stunts dialog not available");
  const fresh = game.messages.get(message.id) ?? message;
  const roll = fresh.rolls?.[0];
  if (!roll) throw new Error("no roll");
  if (roll.options?.stuntsList?.length) throw new Error("stunts already applied");   // Double Damage would double the damage again
  const dlg = new Cls(fresh, 0);
  for (const [name, count] of Object.entries(picks)) {
    if (!dlg.stuntOptions[name]) throw new Error(`unknown stunt ${name}`);
    dlg.stuntOptions[name].value = count;
  }
  if (dlg.stuntsAvailable !== 0) throw new Error("the stunt budget is not spent");
  await dlg._updateMessage(null, null, null);
}

async function openStuntDialog(message) {
  const Cls = STUNT_DLG ?? await loadStuntDialog();
  if (!Cls) return;
  const dlg = new Cls(message, 0);
  dlg._ispForce = true;
  return dlg.wait();
}

const stuntPl = (n) => (n === 1 ? "stunt" : n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14) ? "stunty" : "stuntów");
const STUNT_TXT = {
  en: {
    pick: "Pick stunts", choose: (n) => `Choose ${n} ${n === 1 ? "stunt" : "stunts"}`,
    progress: (k, n) => `${k} of ${n} chosen, ${n - k} to go`, ready: (n) => `All ${n} chosen. Confirm to apply.`,
    confirm: "Confirm stunts", applying: "Applying...", clear: "Clear", clearAria: "Clear the chosen stunts",
    more: (s) => `More: ${s}`, fewer: (s) => `Fewer: ${s}`, count: (n) => `Chosen: ${n}.`,
    clash: (s) => `Cannot be combined with ${s}.`, none: "No stunts left to spend.", need: (n) => `Choose ${n} more to confirm.`,
    done: "Stunts applied.", fail: "Could not apply the stunts. Try again or use the dialog.", dialog: "Open dialog",
    idlePush: (n) => `${n} ${n === 1 ? "stunt" : "stunts"} to choose once you accept the roll`, idleOther: (n) => `${n} ${n === 1 ? "stunt" : "stunts"} to choose, picked by the character's owner or the GM`,
    idleDialog: (n) => `${n} ${n === 1 ? "stunt" : "stunts"} to choose in the pop-up`, idleNone: "No stunts to choose for this attack"
  },
  pl: {
    pick: "Wybierz stunty", choose: (n) => `Wybierz ${n} ${stuntPl(n)}`,
    progress: (k, n) => `Wybrano ${k} z ${n}, jeszcze ${n - k}`, ready: (n) => `Wybrano wszystkie (${n}). Zatwierdź, aby zastosować.`,
    confirm: "Zatwierdź stunty", applying: "Zapisuję...", clear: "Wyczyść", clearAria: "Wyczyść wybrane stunty",
    more: (s) => `Więcej: ${s}`, fewer: (s) => `Mniej: ${s}`, count: (n) => `Wybrano: ${n}.`,
    clash: (s) => `Nie łączy się z: ${s}.`, none: "Nie ma już wolnych stuntów.", need: (n) => `Wybierz jeszcze ${n}, aby zatwierdzić.`,
    done: "Stunty zastosowane.", fail: "Nie udało się zastosować stuntów. Spróbuj ponownie albo użyj okna.", dialog: "Otwórz okno",
    idlePush: (n) => `${n} ${stuntPl(n)} do wyboru po zaakceptowaniu rzutu`, idleOther: (n) => `${n} ${stuntPl(n)} do wyboru, wybiera właściciel postaci lub MG`,
    idleDialog: (n) => `${n} ${stuntPl(n)} do wyboru w oknie`, idleNone: "Ten atak nie ma stuntów do wyboru"
  }
};

function stuntPicker(message, html) {
  const roll = message.rolls?.[0];
  const budget = Number(roll?.stunts);
  if (!Number.isFinite(budget) || budget <= 0) return;
  const frame = html.querySelector?.(".isp-stunts");
  if (!frame || frame.dataset.ispPick) return;
  if (roll.options?.stuntsList?.length) { frame.classList.add("isp-done"); frame.dataset.ispPick = "done"; return; }   // applied: locked, the system's own list is the result
  if (roll.pushable) return stuntIdle(frame, budget, "idlePush");   // stunts are offered only once the roll is accepted (the budget chip is already on the card)
  if (!inlineStuntsOn()) return stuntIdle(frame, budget, "idleDialog");
  if (!canPickStunts(message)) return stuntIdle(frame, budget, "idleOther");
  frame.dataset.ispPick = "1";
  if (STUNT_DLG) buildStuntPicker(STUNT_DLG, message, frame, budget);
  else loadStuntDialog().then((Cls) => { if (Cls && frame.dataset.ispPick === "1") buildStuntPicker(Cls, message, frame, budget); });
}

/* Nothing to pick on this card right now: the frame turns into one muted line (CSS .isp-idle hides the budget tile and the empty list), so it
   no longer looks like a menu. Presentation only: the system's chip and list stay in the DOM. */
function stuntIdle(frame, budget, key) {
  if (frame.querySelector(":scope > .isp-st-note")) return;
  const T = STUNT_TXT[game.i18n.lang === "pl" ? "pl" : "en"];
  const p = document.createElement("p");
  p.className = "isp-st-note";
  p.textContent = typeof T[key] === "function" ? T[key](budget) : T[key];
  frame.classList.add("isp-idle");
  frame.append(p);
}

function buildStuntPicker(Cls, message, frame, budget) {
  const T = STUNT_TXT[game.i18n.lang === "pl" ? "pl" : "en"];
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  let opts, names;
  try {
    opts = new Cls(message, 0).stuntOptions;   // the system's own filtering: attack type list, requiresActor, defaults
    names = Object.keys(opts ?? {});
    if (!names.length) { frame.dataset.ispPick = "none"; return stuntIdle(frame, budget, "idleNone"); }
  } catch (err) {
    console.warn(`${MODULE_ID} | stunt picker`, err);
    return stuntFallback(frame, message, T);
  }

  const labelOf = (k) => game.i18n.localize(`INVINCIBLE.Stunts.${k}.label`);
  const maxOf = (k) => Math.max(1, Number(opts[k]?.max) || 1);
  const picks = {};
  for (const [k, v] of Object.entries(STUNT_DRAFT.get(message.id) ?? {})) {     // restore a draft, but only what is still valid
    const n = Math.floor(Number(v));
    if (opts[k] && n > 0 && n <= maxOf(k) && Object.values(picks).reduce((a, b) => a + b, 0) + n <= budget) picks[k] = n;
  }
  const sum = () => names.reduce((a, k) => a + (picks[k] || 0), 0);
  const left = () => budget - sum();
  const clash = (k) => names.find((o) => o !== k && (picks[o] || 0) > 0 && (opts[k].exclusion?.includes(o) || opts[o].exclusion?.includes(k)));
  const canAdd = (k) => left() > 0 && (picks[k] || 0) < maxOf(k) && !clash(k);
  const why = (k) => (clash(k) ? T.clash(labelOf(clash(k))) : left() <= 0 ? T.none : "");   // why a stunt cannot be added now
  const save = () => { if (sum()) STUNT_DRAFT.set(message.id, { ...picks }); else STUNT_DRAFT.delete(message.id); };

  const tile = frame.querySelector(":scope > .roll-damage .result");
  const status = mk("p", "isp-st-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const list = mk("ul", "isp-picks");
  list.setAttribute("aria-label", T.pick);
  const actions = mk("div", "isp-st-actions");
  const go = mk("button", "isp-st-go");
  go.type = "button";
  go.append(mk("span", "", T.confirm));
  const clearBtn = mk("button", "isp-st-clear");
  clearBtn.type = "button";
  clearBtn.setAttribute("aria-label", T.clearAria);
  clearBtn.append(mk("span", "", T.clear));
  actions.append(go, clearBtn);
  const uid = ++STUNT_UID;
  let busy = false, failed = false;
  const rules = {};   // stunt name -> rules text (read from the Quickstart journal, async)

  const say = (text) => { if (status.textContent !== text) status.textContent = text; };
  const items = new Map();   // name -> { li, btn, sr, step, dec, inc, val, multi }

  for (const k of names) {
    const multi = budget > 1 && maxOf(k) > 1;   // a quantity stepper only makes sense when more than one stunt can be spent; budget 1 = plain toggle (picks stay 0/1)
    const li = mk("li", "isp-pk");
    li.dataset.stunt = k;
    const sr = mk("span", "isp-sr");
    sr.id = `isp-sr-${uid}-${k}`;
    const btn = mk("button", "isp-pk-btn");
    btn.type = "button";
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("aria-describedby", sr.id);
    const ck = mk("i", "isp-ck");
    ck.setAttribute("aria-hidden", "true");
    btn.append(ck, mk("span", "isp-pk-name", labelOf(k)));
    li.append(btn);
    const rec = { li, btn, sr, multi };
    if (multi) {
      const step = mk("span", "isp-step");
      const dec = mk("button", "isp-dec"), inc = mk("button", "isp-inc");
      dec.type = inc.type = "button";
      dec.setAttribute("aria-label", T.fewer(labelOf(k)));
      inc.setAttribute("aria-label", T.more(labelOf(k)));
      const val = mk("output", "isp-val");
      val.setAttribute("aria-hidden", "true");
      step.append(dec, val, inc);
      li.append(step);
      Object.assign(rec, { step, dec, inc, val });
      dec.addEventListener("click", () => {
        if (busy) return;
        const n = (picks[k] || 0) - 1;
        if (n > 0) picks[k] = n; else { delete picks[k]; btn.focus(); }
        save(); paint();
      });
      inc.addEventListener("click", () => {
        if (busy) return;
        if (!canAdd(k)) { const r = why(k); if (r) say(r); return; }
        picks[k] = (picks[k] || 0) + 1;
        save(); paint();
      });
    }
    li.append(sr);
    btn.addEventListener("click", () => {
      if (busy) return;
      if (picks[k]) delete picks[k];
      else if (canAdd(k)) picks[k] = 1;
      else { const r = why(k); if (r) say(r); return; }
      save(); paint();
    });
    items.set(k, rec);
    list.append(li);
  }

  function paint() {
    const k = sum(), l = left();
    if (tile) {
      tile.setAttribute("aria-hidden", "true");
      tile.classList.toggle("isp-spent", l === 0);
      tile.textContent = l === 0 ? "" : String(l);
    }
    frame.classList.toggle("isp-ready", l === 0);
    for (const name of names) {
      const { li, btn, sr, multi, step, inc, val } = items.get(name);
      const n = picks[name] || 0, on = n > 0;
      const other = !on ? clash(name) : null;
      const off = !on && (l <= 0 || !!other);
      li.dataset.on = on ? "1" : "0";
      li.dataset.off = off ? "1" : "0";
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      if (off) btn.setAttribute("aria-disabled", "true"); else btn.removeAttribute("aria-disabled");
      if (multi) {
        val.textContent = `×${n}`;
        if (!canAdd(name)) inc.setAttribute("aria-disabled", "true"); else inc.removeAttribute("aria-disabled");
      }
      const reason = off ? (other ? T.clash(labelOf(other)) : T.none) : "";
      const text = [reason, multi && on ? T.count(n) : "", rules[name] ?? ""].filter(Boolean).join(" ");
      if (sr.textContent !== text) sr.textContent = text;
    }
    if (busy) say(T.applying);
    else if (!failed) say(k === 0 ? T.choose(budget) : l > 0 ? T.progress(k, budget) : T.ready(budget));
    go.setAttribute("aria-disabled", l !== 0 || busy ? "true" : "false");
    go.setAttribute("aria-busy", busy ? "true" : "false");
    go.firstChild.textContent = busy ? T.applying : T.confirm;
    clearBtn.hidden = k === 0 || busy;   // CSS: [hidden] wins
  }

  go.addEventListener("click", async () => {
    if (busy || STUNT_BUSY.has(message.id)) return;
    if (left() !== 0) { say(T.need(left())); return; }
    busy = true; failed = false; STUNT_BUSY.add(message.id); paint();
    try {
      await applyStuntPicks(message, { ...picks });
      STUNT_DRAFT.delete(message.id);
      say(T.done);           // the message update re-renders the card; this is only for the moment before it does
    } catch (err) {
      if ((game.messages.get(message.id) ?? message).rolls?.[0]?.options?.stuntsList?.length) { STUNT_DRAFT.delete(message.id); return; }   // the update went through; only the dialog's tidy-up failed
      console.warn(`${MODULE_ID} | applying stunts`, err);
      busy = false; failed = true;
      say(T.fail);
      status.setAttribute("role", "alert");
      stuntFallback(frame, message, T);
      paint();
    } finally {
      STUNT_BUSY.delete(message.id);
    }
  });
  clearBtn.addEventListener("click", () => {
    if (busy) return;
    for (const k of Object.keys(picks)) delete picks[k];
    failed = false;
    save(); paint();
    list.querySelector(".isp-pk-btn")?.focus();
  });

  frame.classList.add("isp-picking");
  frame.append(status, list, actions);
  paint();

  // rules text on hover / focus (same source and wording as the tooltips on the confirmed stunts)
  stuntDocs().then((map) => {
    for (const name of names) {
      const base = stuntNorm(labelOf(name));
      const entry = map.get(STUNT_ALIAS[base] ?? base);
      if (!entry) continue;
      const { btn } = items.get(name);
      btn.dataset.tooltipHtml = `<strong>${stuntEsc(entry.name)}</strong><p>${stuntEsc(entry.text)}</p>`;
      btn.dataset.tooltipClass = "isp-tip";
      rules[name] = entry.text;
    }
    paint();
  });
}

function stuntFallback(frame, message, T) {
  if (frame.querySelector(".isp-st-dialog")) return;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "isp-st-dialog isp-st-clear";
  b.textContent = T.dialog;
  b.addEventListener("click", () => { openStuntDialog(message).catch((err) => console.warn(`${MODULE_ID} | stunts dialog`, err)); });
  frame.append(b);
}

/* tooltips for the pickers also on keyboard focus (the confirmed stunts have their own handler above) */
const PICK_TIP = ".chat-message .isp-pk-btn[data-tooltip-html]";
document.addEventListener("focusin", (ev) => {
  const b = ev.target?.closest?.(PICK_TIP);
  if (b && game.tooltip?.activate) game.tooltip.activate(b, { html: b.dataset.tooltipHtml, cssClass: "isp-tip" });
});
document.addEventListener("focusout", (ev) => { if (ev.target?.closest?.(PICK_TIP)) game.tooltip?.deactivate?.(); });
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && ev.target?.closest?.(PICK_TIP)) game.tooltip?.deactivate?.(); });

Hooks.on("renderChatMessageHTML", (message, html) => {
  try { stuntPicker(message, html); } catch (err) { console.warn(`${MODULE_ID} | stunt picker`, err); }
});

/* ---------- DOUBLE badge on the Damage tile ----------
   Double Damage (system STUNTS.list.DoubleDamage, max 1) doubles roll.options.damage and pushes getStuntText("DoubleDamage") =
   localize("INVINCIBLE.Stunts.DoubleDamage.stunt") into roll.options.stuntsList. The badge is derived from that message data (never from
   the DOM text, never from the click), so it shows on reload and appears when the confirmed stunts re-render the card. Info only: a
   sticker on the top-right corner of the Damage hero tile. Registered after the stat-chip hook, which sets data-stat. */
const X2_KEY = "INVINCIBLE.Stunts.DoubleDamage.stunt";
const X2_TXT = {
  en: { word: "Double", sr: "Damage doubled.", title: "Double Damage", tip: "The Double Damage stunt doubled this attack's base damage. The number on the tile is already the doubled value." },
  pl: { word: "Podwójne", sr: "Obrażenia podwojone.", title: "Podwójne obrażenia", tip: "Stunt Double Damage podwoił bazowe obrażenia tego ataku. Liczba na kafelku to już wartość po podwojeniu." }
};

function doubleBadge(message, html) {
  const list = message.rolls?.[0]?.options?.stuntsList;
  if (!Array.isArray(list) || !list.length) return;
  const own = game.i18n.has?.(X2_KEY) ? game.i18n.localize(X2_KEY) : "";
  const n = list.filter((s) => typeof s === "string" && (s.trim() === "Double Damage" || (own && s.trim() === own))).length;
  if (!n) return;
  const hero = html.querySelector?.('.dice-infos > [data-stat="damage"]:first-child');
  if (!hero || hero.querySelector(":scope > .isp-x2")) return;
  const T = X2_TXT[game.i18n.lang === "pl" ? "pl" : "en"];
  const mk = (tag, cls, text) => { const e = document.createElement(tag); e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const tag = mk("span", "isp-x2");
  tag.setAttribute("aria-hidden", "true");   // the screen-reader sentence below says it once
  tag.append(mk("b", "isp-x2-n", `×${2 ** n}`), mk("span", "isp-x2-w", T.word));
  const tip = `<strong>${stuntEsc(T.title)}</strong><p>${stuntEsc(T.tip)}</p>`;
  tag.dataset.tooltipHtml = tip;
  tag.dataset.tooltipClass = "isp-tip";
  tag.dataset.tooltipDirection = "UP";
  hero.append(tag, mk("span", "isp-x2-sr", T.sr));
  stuntDocs().then((map) => {   // the book's rules text, same source as the stunt tooltips
    const entry = map.get(STUNT_ALIAS["double damage"]);
    if (entry && tag.isConnected) tag.dataset.tooltipHtml = `${tip}<p>${stuntEsc(entry.text)}</p>`;
  });
}
Hooks.on("renderChatMessageHTML", (message, html) => {
  try { doubleBadge(message, html); } catch (err) { console.warn(`${MODULE_ID} | double badge`, err); }
});

/* =====================================================================================================================
   SPLASH (self-contained feature, code in scripts/splash/, CSS in styles/splash.css, strings in scripts/splash/lang.mjs)
   The former standalone module "Invincible: Comic Splash": comic splash words, rarity ribbon, sixes / stress badges after every Year Zero
   roll, and the rarity badge on roll cards. Loaded with a dynamic import from this already registered script (a file added to
   module.json's esmodules would need a server restart), inside try / catch: if the splash fails to load, the sheets and chat cards above
   are not affected. The phases that Foundry's start-up already passed are recorded from this line on, because the import may finish after
   them; start() runs a passed phase at once and waits for the others. start() does nothing when the standalone module is active. */
const SPLASH_PHASES = { init: false, setup: false, ready: false };
for (const phase of Object.keys(SPLASH_PHASES)) Hooks.once(phase, () => { SPLASH_PHASES[phase] = true; });
import("./splash/main.mjs")
  .then((splash) => splash.start({ ...SPLASH_PHASES }))
  .catch((err) => console.warn(`${MODULE_ID} | splash feature not loaded (sheets and chat cards are unaffected)`, err));

/* CHALLENGES HUD (scripts/challenges/, styles/challenges.css): the same mechanism and the same recorded phases as the splash above. */
/* One-time copy of the settings stored under the old module id (scripts/migrate-id.mjs); the splash awaits the same promise before its own copy. */
Hooks.once("ready", () => { import("./migrate-id.mjs").then((m) => m.migrateFromSheetPlus()).catch((err) => console.warn(`${MODULE_ID} | settings migration`, err)); });

import("./challenges/main.mjs")
  .then((challenges) => challenges.start({ ...SPLASH_PHASES }))
  .catch((err) => console.warn(`${MODULE_ID} | challenges HUD not loaded (sheets, chat cards and the splash are unaffected)`, err));

/* HOT PAN QUIET NOTICES (scripts/hotpan-quiet.mjs): hides Hot Pan & Zoom!'s "control taken / released" toasts; same mechanism and phases. */
import("./hotpan-quiet.mjs")
  .then((quiet) => quiet.start({ ...SPLASH_PHASES }))
  .catch((err) => console.warn(`${MODULE_ID} | hot-pan quiet notices not loaded (everything else is unaffected)`, err));

/* COMBAT BANNERS (scripts/combat/, styles/combat.css): banners that slide in from the top when a combat starts, a round begins and a combat ends;
   same mechanism and the same recorded phases as the blocks above. */
import("./combat/main.mjs")
  .then((combat) => combat.start({ ...SPLASH_PHASES }))
  .catch((err) => console.warn(`${MODULE_ID} | combat banners not loaded (everything else is unaffected)`, err));

/* COMIC FONT OPTION (scripts/fontoption.mjs, fonts/user/): client setting "Font: comic lettering" (Komikah / ActionFigure BB from the user's own
   file / condensed sans); injects a <style id="isp-font-style"> redefining the family Comic. Same mechanism and recorded phases as above. */
import("./fontoption.mjs")
  .then((fontoption) => fontoption.start({ ...SPLASH_PHASES }))
  .catch((err) => console.warn(`${MODULE_ID} | comic font option not loaded (everything else is unaffected)`, err));

/* TOKEN HALO (scripts/tokenhalo/): an irregular ring of comic halftone dots under a token on hover, selection and the active combat turn
   (client settings "Token halo: ..."). Same mechanism and recorded phases as above; it draws in canvas.primary, no stylesheet needed. */
import("./tokenhalo/main.mjs")
  .then((halo) => halo.start({ ...SPLASH_PHASES }))
  .catch((err) => console.warn(`${MODULE_ID} | token halo not loaded (everything else is unaffected)`, err));

/* PARTY CARDS (scripts/party/, styles/party.css): slide-out cards of the player characters on the viewed scene at the bottom left (client
   setting "Party: display" Hidden / Peek / Full). Same mechanism and recorded phases as the blocks above. */
import("./party/main.mjs")
  .then((party) => party.start({ ...SPLASH_PHASES }))
  .catch((err) => console.warn(`${MODULE_ID} | party cards not loaded (everything else is unaffected)`, err));

/* PLAYER TURN UX (scripts/turn/, styles/turn.css): a "your turn" message in the middle of the screen, an action tray above the macro bar
   (mark actions used, End turn) and the end-turn confirmation dialogs. Same mechanism and recorded phases as the blocks above. */
import("./turn/main.mjs")
  .then((turn) => turn.start({ ...SPLASH_PHASES }))
  .catch((err) => console.warn(`${MODULE_ID} | player turn UX not loaded (everything else is unaffected)`, err));

/* DICE EFFECTS (scripts/diceeffects/, styles/diceeffects.css): a golden halftone burst under a rolled 6 and a cracked scorch under a rolled 1 on the
   Dice So Nice dice, drawn on a layer just under the dice canvas. Same mechanism and recorded phases as the blocks above; does nothing without Dice So Nice. */
import("./diceeffects/main.mjs")
  .then((diceeffects) => diceeffects.start({ ...SPLASH_PHASES }))
  .catch((err) => console.warn(`${MODULE_ID} | dice effects not loaded (everything else is unaffected)`, err));

/* COMIC SLASH TRANSITION (scripts/slash/): registers "Comic slash" scene transitions (from the top / bottom / right / random) in
   CONFIG.Canvas.sceneTransitions, so they show up in Scene configuration > Transition. Same mechanism and recorded phases as the blocks above. */
import("./slash/main.mjs")
  .then((slash) => slash.start({ ...SPLASH_PHASES }))
  .catch((err) => console.warn(`${MODULE_ID} | comic slash transition not loaded (everything else is unaffected)`, err));

/* CHARACTER GENERATOR, TABLES BUILDER (scripts/chargen/tables.mjs): builds the book's creation lists (archetypes, occupations, ...) into the module
   compendium "chargen-tables" at runtime from the installed core book; exposed as api.chargen.tables. Does nothing until called. */
import("./chargen/tables.mjs")
  .then((tables) => tables.start())
  .catch((err) => console.warn(`${MODULE_ID} | chargen tables builder not loaded (everything else is unaffected)`, err));
