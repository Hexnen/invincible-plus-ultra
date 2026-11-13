/* Tactical combat, the surfaces: the small DOM kit both surfaces share. No Foundry globals: plain DOM only.
     h("button.ita-opt", { text, tip, fk, disabled, on: { click }, attrs, data }, ...children)   one element
     swap(host, nodes)        replace a host's children and keep the keyboard focus / caret on the element with the same `fk`
     askCard(a, handlers)     one question (model-pure.askData) as a caption card: the player's prompts and the desk's cards are the same thing
     actIcon(key)             the picture of an action, a stunt or an answer (Font Awesome solid, shipped by Foundry); speed(cost): the mark of a
                              price, the kit's (scripts/kit.mjs, ledger U93): a long bar = the full action, a short one = a quick one, a diamond = no action
     tipHtml(tip)             a tooltip of the model ({ title, cost, lines, note }) as escaped HTML; every such tooltip is also the aria-label
     props.pv                 what the element would spend ({ slot, forfeits, stress }): the dock previews it on hover and on focus (U30)
   Every surface is rebuilt from its data on a change of the fight (never per frame); `fk` (focus key) is what survives the rebuild. */

import { costMark, costMarkHtml, stressMark, stressMarkHtml, symMark, symMarkHtml, SYM_KINDS, legendHtml, markName, hasMarks, rich, plain } from "../../kit.mjs";

/* U93: THE MARKS IN A SENTENCE. A text of the model may hold a mark as a token ("[[dice:6]]", "[[stress:1]]": kit.mjs). `text` draws
   it (each mark names itself: its tooltip, role="img"); a tooltip written as a plain string and every aria-label say it in words. So
   whatever is built with h() can never show a raw token. (What a user typed is never parsed: fields and options are left as they are.) */
const RAW = new Set(["textarea", "option", "input", "select"]);
export function h(sel, props = {}, ...kids) {
  const [tag, ...cls] = String(sel).split(".");
  const el = document.createElement(tag || "div");
  if (cls.length) el.className = cls.join(" ");
  const p = props ?? {};
  if (p.text !== undefined && p.text !== null) { if (hasMarks(p.text) && !RAW.has(tag)) el.append(...rich(p.text)); else el.textContent = String(p.text); }
  /* S087: Foundry reads data-tooltip as HTML (cleaned, but markup all the same): a word tooltip is escaped, so a name with "<" or "&" reads
     as it is written; a list of lines (the older news) is one escaped line each, under the other */
  if (Array.isArray(p.tip)) { if (p.tip.length) el.dataset.tooltip = tipLines(p.tip); }
  else if (p.tip && typeof p.tip === "object") { el.dataset.tooltipHtml = tipHtml(p.tip); if (!p.attrs?.["aria-label"]) el.setAttribute("aria-label", tipText(p.tip)); }
  else if (p.tip) { el.dataset.tooltip = esc(plain(String(p.tip))); if (!p.text && !p.attrs?.["aria-label"]) el.setAttribute("aria-label", plain(String(p.tip))); }
  if (p.pv) { el.dataset.pv = "1"; if (p.pv.slot) el.dataset.pvSlot = p.pv.slot; if (p.pv.forfeits) el.dataset.pvForfeits = "1"; if (p.pv.stress) el.dataset.pvStress = String(p.pv.stress); if (p.pvFor) el.dataset.pvFor = String(p.pvFor); }
  if (p.fk) el.dataset.fk = String(p.fk);
  for (const [k, v] of Object.entries(p.attrs ?? {})) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v === true ? "" : k === "aria-label" || k === "placeholder" ? plain(String(v)) : String(v));
  for (const [k, v] of Object.entries(p.data ?? {})) if (v !== null && v !== undefined) el.dataset[k] = String(v);
  if (p.disabled) el.setAttribute("aria-disabled", "true");
  if (tag === "button") el.type = "button";
  for (const [ev, fn] of Object.entries(p.on ?? {})) {
    el.addEventListener(ev, (e) => {
      try { if (ev === "click" && el.getAttribute("aria-disabled") === "true" && !p.clickWhenDisabled) { e.preventDefault(); return; } fn(e, el); } catch (err) { console.warn("invincible-plus-ultra | tactics ui", err); }
    });
  }
  for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}
export const icon = (name) => h(`i.fa-solid.${name}`, { attrs: { "aria-hidden": "true" } });

/* ---------- U29: pictures, the mark of speed, tooltips ---------- */
const ICONS = {
  slugfest: "fa-hand-fist", shoot: "fa-crosshairs", grapple: "fa-people-pulling", charge: "fa-meteor", grappleAttack: "fa-hand-back-fist", release: "fa-hand", ram: "fa-car-burst",
  move: "fa-person-running", openDoor: "fa-door-open", breachDoor: "fa-hammer", unseal: "fa-unlock-keyhole", fastball: "fa-baseball",
  orders: "fa-bullhorn", objective: "fa-puzzle-piece", vehicleEnter: "fa-car-side", vehicleExit: "fa-person-walking-arrow-right", vehicleStart: "fa-key", vehicleHandle: "fa-road",
  pickUp: "fa-hand-holding", scan: "fa-binoculars", banter: "fa-comment", useItem: "fa-toolbox", usePower: "fa-hand-sparkles", breakLift: "fa-dumbbell", technology: "fa-microchip",
  stabilize: "fa-kit-medical", rally: "fa-flag", recoverResolve: "fa-battery-half", persuade: "fa-handshake", saveBystanders: "fa-people-group", shakeOff: "fa-rotate",
  breakFree: "fa-link-slash", escapeTrap: "fa-dungeon", escapeSnare: "fa-scissors", escapeImmobilised: "fa-unlock", extinguish: "fa-fire-extinguisher",
  "@more": "fa-ellipsis", "@kit": "fa-star", "@other": "fa-pen", "@hold": "fa-hourglass-half", "@end": "fa-forward-step",
  "kit:power": "fa-hand-sparkles", "kit:boost": "fa-angles-up", "kit:limit": "fa-triangle-exclamation", "kit:talent": "fa-medal", "kit:drawback": "fa-heart-crack", "kit:gear": "fa-toolbox",
  "stunt:doubleDamage": "fa-burst", "stunt:knockback": "fa-arrow-right-from-bracket", "stunt:stun": "fa-face-dizzy", "stunt:bangHeads": "fa-people-arrows", "stunt:trap": "fa-dungeon", "stunt:disarm": "fa-hand-holding",
  "stunt:deadlyHit": "fa-skull", "stunt:slam": "fa-angles-right", "stunt:suppressed": "fa-arrows-down-to-line", "stunt:trickShot": "fa-bullseye", "stunt:support": "fa-handshake-angle", "stunt:special": "fa-star", "stunt:own": "fa-pen",
  "fate:ko": "fa-bed", "fate:kill": "fa-skull",
  "die:1": "fa-dice-one", "die:2": "fa-dice-two", "die:3": "fa-dice-three", "die:4": "fa-dice-four", "die:5": "fa-dice-five", "die:6": "fa-dice-six",      // P6b-6: the injury die a talent lets pick
  "react:block": "fa-shield-halved", "react:dodge": "fa-wind", "react:pass": "fa-xmark", "react:r": "fa-reply",
};
export const actIcon = (key) => icon(ICONS[key] ?? "fa-circle-dot");
/** the same picture as a Font Awesome class, for a menu the map draws at a token or a door (W1) */
export const faOf = (key) => `fa-solid ${ICONS[key] ?? "fa-circle-dot"}`;
/** THE MARK OF SPEED (U93: the shared kit's, kit.mjs costMark): a long bar = the full action, a short bar = a quick one, an open
    diamond = no action (U50), a question mark = the GM names the price; `o.out`: taken out of turn, the hooked arrow before the bar.
    Silent: whatever carries it says the name in its tooltip and its aria-label. */
export const speed = (cost, o = {}) => costMark(cost, { out: !!o.out });
/** the price in stress beside a mark of speed: the bolt with its number (kit.mjs stressMark) */
export const stressChip = (n) => (n ? stressMark(n) : null);
/** a mark of the model ({ mark, n, glyph, out, name }) that stands by itself and names itself (its tooltip, a screen reader);
    `silent`: what carries it says the name */
const markHtml = (m, name) => (m.mark === "stress" ? stressMarkHtml(m.n ?? null, { name }) : SYM_KINDS.includes(m.mark) ? symMarkHtml(m.mark, { n: m.n ?? null, glyph: m.glyph ?? null, name }) : costMarkHtml(m.mark, { out: !!m.out, name }));
export function markOf(m, silent = false) {
  if (!m) return null;
  const t = document.createElement("template"); t.innerHTML = markHtml(m, silent ? null : m.name ?? true);
  return t.content.firstElementChild;
}
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
/** S087: words for a data-tooltip (read as HTML by Foundry): each line escaped, one under the other */
export const tipLines = (lines) => lines.map((l) => esc(plain(String(l ?? "")))).join("<br>");
/** a tooltip of the model as HTML (Foundry cleans it again); names of items and characters are escaped here */
/* U51: a tooltip without a title belongs to something that shows its own name (a row of a list, an answer on a card): it starts with what is not on screen */
/* U54 / U68: the reason of a greyed thing and what to do about it stand apart from the price, under a dashed line (the look of
   "unavailable" everywhere), each with its own picture (styles/tactics-ui.css): a price is a label, a reason is a sentence.
   U55: a tooltip with `rows` is a small sum: where the dice come from, one line each, the total under a line. */
const whyHtml = (w) => (w ? `<div class="ita-tt-why">${w.text ? `<p class="ita-tt-no">${esc(w.text)}</p>` : ""}${w.fix ? `<p class="ita-tt-fix">${esc(w.fix)}</p>` : ""}</div>` : "");
const rowHtml = (r, cls = "") => `<span class="ita-tt-row${cls}"><span>${esc(r.label)}</span><b>${esc(r.value)}</b></span>`;
const sumHtml = (tip) => (tip.rows ? `<div class="ita-tt-sum">${tip.rows.map((r) => rowHtml(r)).join("")}${tip.total ? rowHtml(tip.total, " ita-tt-total") : ""}${tip.wait ? `<small>${esc(tip.wait.label)}</small>${tip.wait.rows.map((r) => rowHtml(r, " ita-tt-wait")).join("")}` : ""}</div>` : "");
/* U93: A TOOLTIP IS WHERE A MARK GETS ITS NAME. The price line (`tip.price` = model-pure.priceOf: { lead, parts }) and a line of facts
   (`tip.facts`: what a weapon brings) are pairs: the mark, then its name. Every other sentence of a tooltip is words: a token in it
   is said by its name (a mark inside a tooltip could not be asked what it is). `tip.cost` stays the price in words: it is what a
   screen reader is told (tipText), and what shows when the model handed over no parts. */
const pairHtml = (m) => `<span class="ita-tt-pp">${markHtml(m, null)}<span>${esc(m.name ?? "")}</span></span>`;
const priceHtml = (tip) => (tip.price?.parts?.length ? `${tip.price.lead ? `<span>${esc(tip.price.lead)}</span>` : ""}${tip.price.parts.map(pairHtml).join("")}${tip.price.tail ? `<span>${say(tip.price.tail)}</span>` : ""}` : null);
const say = (x) => esc(plain(x));
export const tipHtml = (tip) => `<div class="ita-tt">${tip.title ? `<b>${say(tip.title)}${tip.key ? ` <kbd>${esc(tip.key)}</kbd>` : ""}</b>` : ""}${tip.cost || tip.price || (tip.key && !tip.title) ? `<small${priceHtml(tip) ? ' class="ita-tt-price"' : ""}>${priceHtml(tip) ?? say(tip.cost ?? "")}${tip.key && !tip.title ? ` <kbd>${esc(tip.key)}</kbd>` : ""}</small>` : ""}${tip.price?.later ? `<p>${say(tip.price.later)}</p>` : ""}${tip.facts?.length ? `<div class="ita-tt-marks">${tip.facts.map(pairHtml).join("")}</div>` : ""}${(tip.lines ?? []).map((l) => `<p>${say(l)}</p>`).join("")}${tip.note ? `<em>${say(tip.note)}</em>` : ""}${sumHtml(tip)}${whyHtml(tip.why)}</div>`;
export const tipText = (tip) => plain([tip.title, tip.cost, ...(tip.facts ?? []).map((m) => m.say ?? m.name), ...(tip.lines ?? []), tip.note, tip.say, tip.why?.text, tip.why?.fix].filter(Boolean).join(", "));

/** Replace the children of `host`; whoever had the focus (by `fk`) keeps it, with the caret where it was. */
export function swap(host, nodes) {
  const act = document.activeElement, fk = act && host.contains(act) ? act.dataset?.fk : null;
  let caret = null;
  try { if (fk && typeof act.selectionStart === "number") caret = [act.selectionStart, act.selectionEnd]; } catch { caret = null; }
  const scroll = new Map([...host.querySelectorAll("[data-keep-scroll]")].map((e) => [e.dataset.keepScroll, e.scrollTop]));
  host.replaceChildren(...[nodes].flat(Infinity).filter(Boolean));
  for (const e of host.querySelectorAll("[data-keep-scroll]")) if (scroll.has(e.dataset.keepScroll)) e.scrollTop = scroll.get(e.dataset.keepScroll);
  if (!fk) return;
  const next = [...host.querySelectorAll("[data-fk]")].find((e) => e.dataset.fk === fk);
  if (!next) return;
  try { next.focus({ preventScroll: true }); if (caret && typeof next.setSelectionRange === "function") next.setSelectionRange(caret[0], caret[1]); } catch { /* not focusable any more */ }
}

export function face(img, name, cls = "ita-face") {
  const box = h(`span.${cls}`);
  if (img) { const i = h("img", { attrs: { alt: "", decoding: "async", src: img } }); box.append(i); } else box.append(h("b", { text: String(name || "?").trim().charAt(0).toUpperCase() }));
  return box;
}

const seen = new Set();          // questions already shown once: only a new one plays the entrance
/** One question. handlers = { send(req), pick(promptId, optionId, max), text(promptId, value), always(promptId, on), zone(option, ask),
    again(ask): forget the zone picked on the map for this question } */
/* SEAM: a card's counter and the answers it changes, as one band (only when the card has a counter) */
const countBand = (a, count, opts) => (count ? h("div.ita-band", {}, count, opts) : opts);
export function askCard(a, handlers = {}) {
  const fresh = !seen.has(a.id);
  seen.add(a.id);
  if (seen.size > 400) seen.clear();
  /* an answer: its picture (a reaction, a stunt), its name, the mark of its speed and its Resolve price, then the chance; what the
     marks stand for is said in words in the aria-label and, for a stunt, in its tooltip */
  /* U93: the price of an answer is its marks (the model's `o.unit`, `o.out`: an answer to something done by somebody else is taken out
     of turn, `o.stress`); their names are the price line of the answer's tooltip and the words of its aria-label (`o.cost`). */
  /* ANSI-2: a stepped answer (Tactical Support: one row per ally) gives one more on a click, takes all back on a click when full */
  const stepClick = (o) => { if (o.step.add) handlers.pick?.(a.id, o.step.add, a.multi?.max ?? 24); else for (const id of o.step.clear ?? []) handlers.pick?.(a.id, id, a.multi?.max ?? 24); };
  const opt = (o) => h("button.ita-opt", {
    /* U83: a greyed answer is as large as the others: the dashed frame and the no-entry mark after its name say "not now", the reason
       and what to do about it are its tooltip (pointer and keyboard focus) and its aria-label; it stays in the Tab order */
    fk: `opt:${a.id}:${o.id}`, disabled: !!o.disabled, tip: o.tip ?? null, pv: o.pv, pvFor: a.pvFor,
    attrs: { "aria-pressed": a.multi ? String(!!o.picked) : null, "aria-label": [o.label, o.cost, o.note, o.tip?.lines?.[0], o.disabled, o.tip?.why?.fix].filter(Boolean).join(", ") },
    data: { pass: o.pass ? "1" : null, ic: o.icon || a.check ? "1" : null, key: o.key ?? null, check: a.check ? "1" : null, step: o.step ? "1" : null },
    on: { click: () => (o.step ? stepClick(o) : a.multi ? handlers.pick?.(a.id, o.id, a.multi.max) : o.zones && o.zoneReq ? handlers.zone?.(o, a) : o.again ? handlers.again?.(a) : o.req ? handlers.send?.(o.req) : null) },
  }, a.check ? icon(o.picked ? "fa-square-check" : "fa-square") : o.icon ? actIcon(o.icon) : null,      // U18: a line of a round-point queue is a tick box: ticked = it happens
  h("span.ita-opt-b", {}, h("span.ita-opt-l", {}, h("span", { text: o.label }), speed(o.unit, { out: !!o.out }), stressChip(o.stress), o.disabled ? h("i.fa-solid.fa-ban.ita-opt-no", { attrs: { "aria-hidden": "true" } }) : null),
    !o.unit && o.cost ? h("span.ita-opt-c", { text: o.cost }) : null, o.note ? h("span.ita-opt-n", { text: o.note }) : null),
  o.marks?.length ? h("span.ita-opt-m", {}, o.marks.map((m) => markOf(m, true))) : null);      // ANSI-1 / ANSI-2: what the row carries (a roll, the dice given) as marks; the words are its aria-label and tooltip
  /* ANSI-2: the minus of a stepped answer stands BESIDE it (a button in a button is no button), only while there is something to take back */
  const optRow = (o) => (!o.step ? opt(o) : h("span.ita-stepper", {}, opt(o),
    o.step.sub ? h("button.ita-less", { fk: `less:${a.id}:${o.id}`, tip: o.step.less, attrs: { "aria-label": o.step.less }, on: { click: () => handlers.pick?.(a.id, o.step.sub, a.multi?.max ?? 24) } }, icon("fa-minus")) : null));

  /* U23: the stunts stand in their groups (on the target; another opponent; on that opponent), each group after its caption */
  const groups = [];
  for (const o of a.options) { const id = o.group?.id ?? ""; let g = groups.find((x) => x.id === id); if (!g) groups.push((g = { id, label: o.group?.label ?? null, items: [] })); g.items.push(o); }
  /* U19: the pointer on a card shows on the map whom it is about (this client only; two namesakes are told apart by where they stand) */
  const locate = a.aboutId && handlers.locate ? { pointerenter: () => handlers.locate(a.aboutId, true), pointerleave: () => handlers.locate(a.aboutId, false) } : {};
  return h(`article.ita-ask${fresh ? ".ita-new" : ""}`, { on: locate, data: { kind: a.kind, proxy: a.proxy ? "1" : null, wide: a.options.length > 4 ? "1" : null, always: a.always?.on ? "1" : null } },
    /* U51: the head names whom the card is about unless the bar right under it already does (aboutHead: model-pure.dockData); how many
       stunts are ticked stands on the Confirm button alone */
    h("header.ita-head", {}, h("h3.ita-plate", { text: a.title }), a.about && a.aboutHead !== false ? h("span.ita-about", { text: a.about }) : null),
    a.lines.map((l) => (typeof l === "string" ? h("p.ita-line", { text: l }) : h("blockquote.ita-quote", {}, h("span", { text: l.quote }), l.by ? h("cite", { text: l.by }) : null))),
    a.tokens?.length ? h("div.itd-chips", {}, a.tokens.map((k) => h("button.itd-chip.itd-chip-token", { fk: `tk:${a.id}:${k.id}`, tip: k.source, attrs: { "aria-pressed": String(k.picked) }, on: { click: () => handlers.pick?.(`tk:${a.id}`, k.id, 12) } }, h("span", { text: `${k.label} ${k.source}` })))) : null,
    /* U61: a number the answers carry (how many of a minion group fall): minus, the number, plus; the answers under it say it back.
       SEAM (uxc U145 x uxa U154): the number and its answers are ONE band (`.ita-band`, display: contents elsewhere), so on the desk the
       counter holds to the bottom edge with the answers it changes (U145 made this card the GM's usual one) */
    countBand(a, a.count ? h("div.ita-count", { attrs: { role: "group", "aria-label": a.count.label } }, h("span.ita-count-l", { text: a.count.label }),
      h("span.ita-step", {}, h("button", { fk: `cm:${a.id}`, disabled: a.count.value <= a.count.min, attrs: { "aria-label": "-1" }, on: { click: () => handlers.count?.(a.count.id, a.count.value - 1) } }, icon("fa-minus")),
        h("b", { text: String(a.count.value), attrs: { "aria-live": "polite" } }),
        h("button", { fk: `cp:${a.id}`, disabled: a.count.value >= a.count.max, attrs: { "aria-label": "+1" }, on: { click: () => handlers.count?.(a.count.id, a.count.value + 1) } }, icon("fa-plus"))),
      h("span.ita-count-of", { text: a.count.of })) : null,
    groups.length > 1 ? groups.map((g) => h("div.ita-optg", { attrs: { role: "group", "aria-label": g.label ?? a.title } }, g.label ? h("span.ita-optk", { text: g.label }) : null, h("div.ita-opts", {}, g.items.map(optRow))))
      : h("div.ita-opts", { attrs: { role: "group", "aria-label": a.title } }, a.options.map(optRow))),
    /* U17-2: the GM's own pick of an extra opponent (stunt card on the desk): a select per stunt and target, its first line says what it is */
    a.gmExtra ? h("div.ita-gmx", { tip: a.gmExtra.tip }, a.gmExtra.rows.map((r) => h("select", { fk: r.id, attrs: { "aria-label": r.label }, on: { change: (e, el) => { if (el.value) handlers.gmExtra?.(a.id, el.value, a.multi?.max ?? 24); } } },
      h("option", { text: `${r.label}…`, attrs: { value: "", selected: true } }), r.choices.map((x) => h("option", { text: x.label, attrs: { value: x.id } }))))) : null,
    a.free ? h("input.ita-text", { fk: `text:${a.id}`, attrs: { type: "text", maxlength: 300, placeholder: a.free.placeholder, "aria-label": a.free.placeholder, value: a.free.text }, on: { input: (e, el) => handlers.text?.(a.id, el.value) } }) : null,
    a.always ? h("label.ita-check", { tip: a.always.tip }, h("input", { fk: `always:${a.id}`, attrs: { type: "checkbox", checked: a.always.on }, on: { change: (e, el) => handlers.always?.(a.id, el.checked) } }), h("span", { text: a.always.label })) : null,
    a.submit ? h("button.ita-submit", { fk: `submit:${a.id}`, text: a.submit.label, disabled: !!a.submit.disabled, tip: a.submit.disabled, data: { key: a.keyEnter ?? null }, on: { click: () => a.submit.req && handlers.send?.(a.submit.req) } }) : null);
}

/* U57: THE SUMMARY of a round or of a fight (feedback-pure.roundCard / fightCard): a caption card like a question, without answers.
   One line per combatant: face, name, then what it dealt and what it lost as small counts, each with its picture; the words of a
   count are its tooltip and the line's aria-label. It goes away by itself; the x puts it away at once. */
const SUM_COLS = ["dealt", "hits", "taken", "stress"];
/* U93: a count is headed by the kit's mark of what it counts (damage dealt, Health lost, stress); attacks that hit keep their own picture */
const SUM_MARK = { dealt: () => symMark("damage"), taken: () => symMark("health"), stress: () => costMark("stress") };
const SUM_ICON = { hits: "fa-crosshairs", broken: "fa-heart-crack", unconscious: "fa-bed", dead: "fa-skull" };
export const sumCard = (c, handlers = {}) => h("article.ita-ask.ita-sum", { data: { kind: c.kind }, attrs: { role: "status" } },
  h("header.ita-head", {}, h("h3.ita-plate", { text: c.title }), c.sub ? h("span.ita-about", { text: c.sub }) : null,
    h("button.ita-sum-x", { fk: "sum:x", tip: c.close, attrs: { "aria-label": c.close }, on: { click: () => handlers.sumClose?.() } }, icon("fa-xmark"))),
  c.quiet ? h("p.ita-line", { text: c.quiet }) : null,
  h("ul.ita-sum-rows", {}, c.rows.map((r) => h("li.ita-sum-row", { data: { mine: r.mine ? "1" : null }, attrs: { "aria-label": r.say } }, face(r.img, r.name), h("span.ita-sum-n", { text: r.name }),
    /* the counts stand in fixed columns (dealt, hits, Health lost, Resolve lost), so a column reads down the card; an empty place stays empty */
    h("span.ita-sum-chips", {}, SUM_COLS.map((id) => { const k = r.chips.find((x) => x.id === id); return k ? h("span.ita-sum-chip", { tip: k.tip, data: { id: k.id } }, SUM_MARK[k.id]?.() ?? icon(SUM_ICON[k.id]), h("b", { text: k.n })) : h("span.ita-sum-chip", { data: { id, empty: "1" } }); }),
      r.out ? h("span.ita-sum-chip", { tip: r.out.tip, data: { id: "out" } }, icon(SUM_ICON[r.out.id])) : null)))),
  c.more ? h("p.ita-sum-more", { text: c.more }) : null);

/** U1 / U2: the buttons of one roll (model-pure.rollButtons): `act` is done on this client (handlers.roll), `req` is sent. One element, re-skinnable. */
/* U93: Push is named by its word (a button says what it does) and carries the mark of pushing before it and the bolt of stress after
   it: what a push may cost (the model's `b.marks`) */
export const rollButtons = (id, buttons, handlers = {}) => (buttons ?? []).map((b) => h("button.ita-rollbtn", { fk: `rb:${id}:${b.id}`, text: b.marks ? null : b.label, tip: b.tip, data: { id: b.id }, attrs: b.marks ? { "aria-label": b.label } : {}, on: { click: () => (b.act ? handlers.roll?.(b.act) : b.req ? handlers.send?.(b.req) : null) } },
  b.marks ? [markOf(b.marks[0], true), h("span", { text: b.label }), b.marks.slice(1).map((m) => markOf(m, true))] : null));
/** U1 / U2: a roll this client owes or may push, as one chip: what it is, and its buttons (model-pure.rollsData) */
/* U93: the chip is the roll's name and the mark of what stands now: the die with the number of dice (owed), the six with the number of
   sixes (thrown, may be pushed). The model's text carries the mark; a throw on its way keeps the spinner. */
function rollText(r) {
  const tip = r.tip ?? null;
  return h("span.ita-roll-t", { text: r.text, tip, data: { sum: tip ? "1" : null }, attrs: { ...(tip ? { tabindex: "0" } : {}), "aria-label": tip ? null : r.text } });
}
export const rollChip = (r, handlers = {}) => h("span.ita-roll", { data: { state: r.state } }, r.state === "rolling" ? icon("fa-spinner") : hasMarks(r.text) ? null : icon("fa-dice"), rollText(r), rollButtons(r.id, r.buttons, handlers));

/* U93: THE LEGEND. Every mark with its name, as a caption card of the dock (opened from the bar's own button): where a player looks
   a mark up. Drawn by the kit (kit.mjs legendHtml), so it can never show a mark the surfaces do not use. */
export function legendCard(handlers = {}) {
  const body = h("div.ita-legend-b"); body.innerHTML = legendHtml();
  return h("article.ita-ask.ita-legend", { attrs: { role: "region", "aria-label": markName("legend") } },
    h("header.ita-head", {}, h("h3.ita-plate", { text: markName("legend") }), h("button.ita-sum-x", { fk: "legend:x", tip: markName("legend.close"), attrs: { "aria-label": markName("legend.close") }, on: { click: () => handlers.legendClose?.() } }, icon("fa-xmark"))), body);
}
/** the "who are we waiting for" chips (model-pure.waitingData) */
export const waitChips = (rows) => rows.map((w) => h(`span.ita-wait${w.mine ? ".ita-wait-me" : ""}`, {}, h("b", { text: w.who }), h("span", { text: w.what.join(", ") })));

export function visibleRect(el) {
  try {
    if (!el) return null;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return null;
    const r = el.getBoundingClientRect();
    return r.width > 8 && r.height > 8 ? r : null;
  } catch { return null; }
}
