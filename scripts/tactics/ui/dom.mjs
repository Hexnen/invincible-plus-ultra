/* Tactical combat, the surfaces: the small DOM kit both surfaces share. No Foundry globals: plain DOM only.
     h("button.ita-opt", { text, tip, fk, disabled, on: { click }, attrs, data }, ...children)   one element
     swap(host, nodes)        replace a host's children and keep the keyboard focus / caret on the element with the same `fk`
     askCard(a, handlers)     one question (model-pure.askData) as a caption card: the player's prompts and the desk's cards are the same thing
     actIcon(key)             the picture of an action, a stunt or an answer (Font Awesome solid, shipped by Foundry); speed(cost): THE MARK OF
                              SPEED, the shape of the slot the thing takes: a long bar = the full action, a short bar = a quick one, nothing = no action
     tipHtml(tip)             a tooltip of the model ({ title, cost, lines, note }) as escaped HTML; every such tooltip is also the aria-label
     props.pv                 what the element would spend ({ slot, forfeits, stress }): the dock previews it on hover and on focus (U30)
   Every surface is rebuilt from its data on a change of the fight (never per frame); `fk` (focus key) is what survives the rebuild. */

import { costVersion, costMark, costMarkHtml, stressMark, stressMarkHtml, symMark } from "../../kit.mjs";

export function h(sel, props = {}, ...kids) {
  const [tag, ...cls] = String(sel).split(".");
  const el = document.createElement(tag || "div");
  if (cls.length) el.className = cls.join(" ");
  const p = props ?? {};
  if (p.text !== undefined && p.text !== null) el.textContent = String(p.text);
  if (p.tip && typeof p.tip === "object" && p.tip.html) { el.dataset.tooltipHtml = p.tip.html; if (!p.attrs?.["aria-label"] && p.tip.say) el.setAttribute("aria-label", String(p.tip.say)); }      // U86-SCAFFOLD: a tooltip built by the surface out of marks
  else if (p.tip && typeof p.tip === "object") { el.dataset.tooltipHtml = tipHtml(p.tip); if (!p.attrs?.["aria-label"]) el.setAttribute("aria-label", tipText(p.tip)); }
  else if (p.tip) { el.dataset.tooltip = String(p.tip); if (!p.text && !p.attrs?.["aria-label"]) el.setAttribute("aria-label", String(p.tip)); }
  if (p.pv) { el.dataset.pv = "1"; if (p.pv.slot) el.dataset.pvSlot = p.pv.slot; if (p.pv.forfeits) el.dataset.pvForfeits = "1"; if (p.pv.stress) el.dataset.pvStress = String(p.pv.stress); if (p.pvFor) el.dataset.pvFor = String(p.pvFor); }
  if (p.fk) el.dataset.fk = String(p.fk);
  for (const [k, v] of Object.entries(p.attrs ?? {})) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v === true ? "" : String(v));
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
  pickUp: "fa-hand-holding", scan: "fa-binoculars", banter: "fa-comment", useItem: "fa-toolbox", usePower: "fa-bolt", breakLift: "fa-dumbbell", technology: "fa-microchip",
  stabilize: "fa-kit-medical", rally: "fa-flag", recoverResolve: "fa-battery-half", persuade: "fa-handshake", saveBystanders: "fa-people-group", shakeOff: "fa-rotate",
  breakFree: "fa-link-slash", escapeTrap: "fa-dungeon", escapeSnare: "fa-scissors", escapeImmobilised: "fa-unlock", extinguish: "fa-fire-extinguisher",
  "@more": "fa-ellipsis", "@kit": "fa-star", "@other": "fa-pen", "@hold": "fa-hourglass-half", "@end": "fa-forward-step",
  "kit:power": "fa-bolt", "kit:boost": "fa-angles-up", "kit:limit": "fa-triangle-exclamation", "kit:talent": "fa-medal", "kit:drawback": "fa-heart-crack", "kit:gear": "fa-toolbox",
  "stunt:doubleDamage": "fa-burst", "stunt:knockback": "fa-arrow-right-from-bracket", "stunt:stun": "fa-face-dizzy", "stunt:bangHeads": "fa-people-arrows", "stunt:trap": "fa-dungeon", "stunt:disarm": "fa-hand-holding",
  "stunt:deadlyHit": "fa-skull", "stunt:slam": "fa-angles-right", "stunt:suppressed": "fa-arrows-down-to-line", "stunt:trickShot": "fa-bullseye", "stunt:special": "fa-star", "stunt:own": "fa-pen",
  "fate:ko": "fa-bed", "fate:kill": "fa-skull",
  "react:block": "fa-shield-halved", "react:dodge": "fa-wind", "react:pass": "fa-xmark", "react:r": "fa-bolt",
};
export const actIcon = (key) => icon(ICONS[key] ?? "fa-circle-dot");
/** the same picture as a Font Awesome class, for a menu the map draws at a token or a door (W1) */
export const faOf = (key) => `fa-solid ${ICONS[key] ?? "fa-circle-dot"}`;
/** the mark of speed: the shape of the slot the thing takes (long = full action, short = quick action); what takes NO action carries a
    mark of its own, an open ring (U50: with no mark at all it read as a mark gone missing); a price the GM decides carries none */
/* U86-SCAFFOLD (stage 1 of ledger U86: three versions of the marks of cost are compared): while this browser has a version switched on
   (kit.mjs costVersion), the mark is the shared kit's (kit.mjs costMark; `o.out`: taken out of turn) and the price in stress is the
   kit's stress mark. With no version (the default) everything below draws exactly what it drew before. Stage 2: speed() and
   stressChip() call the kit unconditionally and `.ita-spd` / `.ita-rs` go. */
export const speed = (cost, o = {}) => {
  const v = costVersion();
  if (v) return cost === "gm" && !o.gm ? null : costMark(cost, { v, out: !!o.out });
  return cost === "full" || cost === "quick" ? h("span.ita-spd", { data: { unit: cost }, attrs: { "aria-hidden": "true" } })
    : cost === "none" || cost === "free" ? h("span.ita-spd", { data: { unit: "free" }, attrs: { "aria-hidden": "true" } }) : null;
};
/** the price in stress beside a mark of speed (`hide`: the old chip was hidden from a screen reader on the bar, not on a card) */
export const stressChip = (n, hide = true) => { const v = costVersion(); return !n ? null : v ? stressMark(n, { v }) : h("b.ita-rs", { text: `-${n}`, attrs: hide ? { "aria-hidden": "true" } : {} }); };
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
/** a tooltip of the model as HTML (Foundry cleans it again); names of items and characters are escaped here */
/* U51: a tooltip without a title belongs to something that shows its own name (a row of a list, an answer on a card): it starts with what is not on screen */
/* U54 / U68: the reason of a greyed thing and what to do about it stand apart from the price, under a dashed line (the look of
   "unavailable" everywhere), each with its own picture (styles/tactics-ui.css): a price is a label, a reason is a sentence.
   U55: a tooltip with `rows` is a small sum: where the dice come from, one line each, the total under a line. */
const whyHtml = (w) => (w ? `<div class="ita-tt-why">${w.text ? `<p class="ita-tt-no">${esc(w.text)}</p>` : ""}${w.fix ? `<p class="ita-tt-fix">${esc(w.fix)}</p>` : ""}</div>` : "");
const rowHtml = (r, cls = "") => `<span class="ita-tt-row${cls}"><span>${esc(r.label)}</span><b>${esc(r.value)}</b></span>`;
const sumHtml = (tip) => (tip.rows ? `<div class="ita-tt-sum">${tip.rows.map((r) => rowHtml(r)).join("")}${tip.total ? rowHtml(tip.total, " ita-tt-total") : ""}${tip.wait ? `<small>${esc(tip.wait.label)}</small>${tip.wait.rows.map((r) => rowHtml(r, " ita-tt-wait")).join("")}` : ""}</div>` : "");
/* U86-SCAFFOLD: the price line of a tooltip with the marks before their names (`tip.price` = { unit, stress, out, outName }, put on by
   the surface only while a version is switched on). The words are the model's own price line, cut at its commas: the first part names
   the mark of speed, the part after it the stress. Stage 2: the model hands the parts over itself and this cutting goes. */
function priceHtml(tip) {
  const v = costVersion(), p = tip.price;
  if (!v || !p || !tip.cost) return null;
  const unit = p.unit === "free" ? "none" : p.unit, part = (mark, text) => `<span class="ita-tt-pp">${mark}<span>${esc(text)}</span></span>`;
  if (!(unit === "full" || unit === "quick" || unit === "gm" || unit === "none")) return `${part(costMarkHtml(unit ?? "none", { v }), tip.cost)}${p.stress ? stressMarkHtml(p.stress, { v }) : ""}`;
  const parts = String(tip.cost).split(", "), cut = parts[0].indexOf(": "), lead = cut > 0 ? parts[0].slice(0, cut + 2) : "", name = cut > 0 ? parts[0].slice(cut + 2) : parts[0];
  const out = [(lead ? `<span>${esc(lead)}</span>` : "") + part(costMarkHtml(unit, { v }), name)];
  if (p.out && p.outName && unit !== "none") out.push(part(costMarkHtml("out", { v }), p.outName));
  let rest = parts.slice(1);
  if (p.stress && rest.length) { out.push(part(stressMarkHtml(p.stress, { v }), rest[0].replace(/\d+/, "").replace(/^[\s:]+|[\s:]+$/g, ""))); rest = rest.slice(1); }
  for (const x of rest) out.push(`<span>${esc(x)}</span>`);
  return out.join("");
}
export const tipHtml = (tip) => `<div class="ita-tt">${tip.title ? `<b>${esc(tip.title)}${tip.key ? ` <kbd>${esc(tip.key)}</kbd>` : ""}</b>` : ""}${tip.cost || (tip.key && !tip.title) ? `<small${priceHtml(tip) ? ' class="ita-tt-price"' : ""}>${priceHtml(tip) ?? esc(tip.cost ?? "")}${tip.key && !tip.title ? ` <kbd>${esc(tip.key)}</kbd>` : ""}</small>` : ""}${(tip.lines ?? []).map((l) => `<p>${esc(l)}</p>`).join("")}${tip.note ? `<em>${esc(tip.note)}</em>` : ""}${sumHtml(tip)}${whyHtml(tip.why)}</div>`;
export const tipText = (tip) => [tip.title, tip.cost, ...(tip.lines ?? []), tip.note, tip.say, tip.why?.text, tip.why?.fix].filter(Boolean).join(", ");

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
export function askCard(a, handlers = {}) {
  const fresh = !seen.has(a.id);
  seen.add(a.id);
  if (seen.size > 400) seen.clear();
  /* an answer: its picture (a reaction, a stunt), its name, the mark of its speed and its Resolve price, then the chance; what the
     marks stand for is said in words in the aria-label and, for a stunt, in its tooltip */

  /* U86-SCAFFOLD: an answer to something done by somebody else (a block, a dodge) is taken out of turn: the mark says so, and the
     answer's tooltip names the marks (it had none: the price stood only in the aria-label) */
  const V = costVersion(), outOf = V && a.kind === "reaction";
  /* (an answer that takes no action is handed over with its price in words only: with a version on, the words are matched against
     the name of "no action" so that it too is written with marks; stage 2: the model hands over the unit) */
  const unitOf = (o) => o.unit ?? (V && o.cost && handlers.noneName && String(o.cost).startsWith(handlers.noneName) ? "none" : null);
  const opt = (o) => optOf(o, unitOf(o));
  const optOf = (o, unit) => h("button.ita-opt", {
    fk: `opt:${a.id}:${o.id}`, disabled: !!o.disabled, tip: o.tip ?? null, pv: o.pv, pvFor: a.pvFor,      // U83: a greyed answer is as large as the others; the reason and the remedy are its tooltip and aria-label
    attrs: { "aria-pressed": a.multi ? String(!!o.picked) : null, "aria-label": [o.label, o.cost, o.note, o.tip?.lines?.[0], o.disabled, o.tip?.why?.fix].filter(Boolean).join(", ") },
    data: { pass: o.pass ? "1" : null, ic: o.icon || a.check ? "1" : null, key: o.key ?? null, check: a.check ? "1" : null },
    on: { click: () => (a.multi ? handlers.pick?.(a.id, o.id, a.multi.max) : o.zones && o.zoneReq ? handlers.zone?.(o, a) : o.again ? handlers.again?.(a) : o.req ? handlers.send?.(o.req) : null) },
  }, a.check ? icon(o.picked ? "fa-square-check" : "fa-square") : o.icon ? actIcon(o.icon) : null,      // U18: a line of a round-point queue is a tick box: ticked = it happens
  h("span.ita-opt-b", {}, h("span.ita-opt-l", {}, h("span", { text: o.label }), speed(unit, { out: outOf }), stressChip(o.stress, false), o.disabled ? h("i.fa-solid.fa-ban.ita-opt-no", { attrs: { "aria-hidden": "true" } }) : null),
    !unit && o.cost ? h("span.ita-opt-c", { text: o.cost }) : null, o.note ? h("span.ita-opt-n", { text: o.note }) : null));

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
    /* U61: a number the answers carry (how many of a minion group fall): minus, the number, plus; the answers under it say it back */
    a.count ? h("div.ita-count", { attrs: { role: "group", "aria-label": a.count.label } }, h("span.ita-count-l", { text: a.count.label }),
      h("span.ita-step", {}, h("button", { fk: `cm:${a.id}`, disabled: a.count.value <= a.count.min, attrs: { "aria-label": "-1" }, on: { click: () => handlers.count?.(a.count.id, a.count.value - 1) } }, icon("fa-minus")),
        h("b", { text: String(a.count.value), attrs: { "aria-live": "polite" } }),
        h("button", { fk: `cp:${a.id}`, disabled: a.count.value >= a.count.max, attrs: { "aria-label": "+1" }, on: { click: () => handlers.count?.(a.count.id, a.count.value + 1) } }, icon("fa-plus"))),
      h("span.ita-count-of", { text: a.count.of })) : null,
    groups.length > 1 ? groups.map((g) => h("div.ita-optg", { attrs: { role: "group", "aria-label": g.label ?? a.title } }, g.label ? h("span.ita-optk", { text: g.label }) : null, h("div.ita-opts", {}, g.items.map(opt))))
      : h("div.ita-opts", { attrs: { role: "group", "aria-label": a.title } }, a.options.map(opt)),
    a.free ? h("input.ita-text", { fk: `text:${a.id}`, attrs: { type: "text", maxlength: 300, placeholder: a.free.placeholder, "aria-label": a.free.placeholder, value: a.free.text }, on: { input: (e, el) => handlers.text?.(a.id, el.value) } }) : null,
    a.always ? h("label.ita-check", { tip: a.always.tip }, h("input", { fk: `always:${a.id}`, attrs: { type: "checkbox", checked: a.always.on }, on: { change: (e, el) => handlers.always?.(a.id, el.checked) } }), h("span", { text: a.always.label })) : null,
    a.submit ? h("button.ita-submit", { fk: `submit:${a.id}`, text: a.submit.label, disabled: !!a.submit.disabled, tip: a.submit.disabled, data: { key: a.keyEnter ?? null }, on: { click: () => a.submit.req && handlers.send?.(a.submit.req) } }) : null);
}

/* U57: THE SUMMARY of a round or of a fight (feedback-pure.roundCard / fightCard): a caption card like a question, without answers.
   One line per combatant: face, name, then what it dealt and what it lost as small counts, each with its picture; the words of a
   count are its tooltip and the line's aria-label. It goes away by itself; the x puts it away at once. */
const SUM_COLS = ["dealt", "hits", "taken", "stress"];
const stressGlyph = () => stressMark()?.firstElementChild ?? null;      // U86-SCAFFOLD: the bare mark of stress (the column itself is the number)
const SUM_ICON = { dealt: "fa-burst", hits: "fa-crosshairs", taken: "fa-heart-crack", stress: "fa-bolt", broken: "fa-heart-crack", unconscious: "fa-bed", dead: "fa-skull" };
export const sumCard = (c, handlers = {}) => h("article.ita-ask.ita-sum", { data: { kind: c.kind }, attrs: { role: "status" } },
  h("header.ita-head", {}, h("h3.ita-plate", { text: c.title }), c.sub ? h("span.ita-about", { text: c.sub }) : null,
    h("button.ita-sum-x", { fk: "sum:x", tip: c.close, attrs: { "aria-label": c.close }, on: { click: () => handlers.sumClose?.() } }, icon("fa-xmark"))),
  c.quiet ? h("p.ita-line", { text: c.quiet }) : null,
  h("ul.ita-sum-rows", {}, c.rows.map((r) => h("li.ita-sum-row", { data: { mine: r.mine ? "1" : null }, attrs: { "aria-label": r.say } }, face(r.img, r.name), h("span.ita-sum-n", { text: r.name }),
    /* the counts stand in fixed columns (dealt, hits, Health lost, Resolve lost), so a column reads down the card; an empty place stays empty */
    h("span.ita-sum-chips", {}, SUM_COLS.map((id) => { const k = r.chips.find((x) => x.id === id); return k ? h("span.ita-sum-chip", { tip: k.tip, data: { id: k.id } }, costVersion() && k.id === "stress" ? stressGlyph() : costVersion() && k.id === "dealt" ? symMark("damage") : icon(SUM_ICON[k.id]), h("b", { text: k.n })) : h("span.ita-sum-chip", { data: { id, empty: "1" } }); }),
      r.out ? h("span.ita-sum-chip", { tip: r.out.tip, data: { id: "out" } }, icon(SUM_ICON[r.out.id])) : null)))),
  c.more ? h("p.ita-sum-more", { text: c.more }) : null);

/** U1 / U2: the buttons of one roll (model-pure.rollButtons): `act` is done on this client (handlers.roll), `req` is sent. One element, re-skinnable. */
/* U86-SCAFFOLD: with a version on, Push carries the mark of pushing and the mark of stress (what a push may cost) */
export const rollButtons = (id, buttons, handlers = {}) => (buttons ?? []).map((b) => { const V = costVersion() && b.id === "push";
  return h("button.ita-rollbtn", { fk: `rb:${id}:${b.id}`, text: V ? null : b.label, tip: b.tip, data: { id: b.id }, attrs: V ? { "aria-label": b.label } : {}, on: { click: () => (b.act ? handlers.roll?.(b.act) : b.req ? handlers.send?.(b.req) : null) } }, V ? [symMark("push"), h("span", { text: b.label }), stressMark()] : null); });
/** U1 / U2: a roll this client owes or may push, as one chip: what it is, and its buttons (model-pure.rollsData) */
/* U86-SCAFFOLD: with a version on, the words "N dice" / "sixes N" of the chip are the mark of dice or of a success with the number
   (cut out of the model's sentence here; stage 2: the model hands over the roll's name and the number) */
function rollText(r) {
  const m = costVersion() && r.state !== "rolling" ? /^([^:]+):.*?(\d+)\D*$/.exec(String(r.text ?? "")) : null;
  const tip = r.tip ?? null, base = { tip, data: { sum: tip ? "1" : null }, attrs: { ...(tip ? { tabindex: "0" } : {}), ...(m ? { "aria-label": r.text } : {}) } };
  return m ? h("span.ita-roll-t", base, h("span", { text: m[1] }), symMark(r.state === "push" ? "six" : "dice", { n: m[2] })) : h("span.ita-roll-t", { ...base, text: r.text });
}
export const rollChip = (r, handlers = {}) => h("span.ita-roll", { data: { state: r.state } }, costVersion() && r.state !== "rolling" ? null : icon(r.state === "rolling" ? "fa-spinner" : "fa-dice"), rollText(r), rollButtons(r.id, r.buttons, handlers));
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
