/* Tactical combat, the surfaces: the small DOM kit both surfaces share. No Foundry globals: plain DOM only.
     h("button.ita-opt", { text, tip, fk, disabled, on: { click }, attrs, data }, ...children)   one element
     swap(host, nodes)        replace a host's children and keep the keyboard focus / caret on the element with the same `fk`
     askCard(a, handlers)     one question (model-pure.askData) as a caption card: the player's prompts and the desk's cards are the same thing
   Every surface is rebuilt from its data on a change of the fight (never per frame); `fk` (focus key) is what survives the rebuild. */

export function h(sel, props = {}, ...kids) {
  const [tag, ...cls] = String(sel).split(".");
  const el = document.createElement(tag || "div");
  if (cls.length) el.className = cls.join(" ");
  const p = props ?? {};
  if (p.text !== undefined && p.text !== null) el.textContent = String(p.text);
  if (p.tip) { el.dataset.tooltip = String(p.tip); if (!p.text && !p.attrs?.["aria-label"]) el.setAttribute("aria-label", String(p.tip)); }
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
/** the glyph of a cost, the same pair the turn tray and the party pips use (full = play, quick = forward) */
export const costIcon = (cost) => (cost === "full" ? icon("fa-play") : cost === "quick" ? icon("fa-forward") : cost === "free" ? icon("fa-bolt") : null);

const seen = new Set();          // questions already shown once: only a new one plays the entrance
/** One question. handlers = { send(req), pick(promptId, optionId, max), text(promptId, value), always(promptId, on), zone(option, ask) } */
export function askCard(a, handlers = {}) {
  const fresh = !seen.has(a.id);
  seen.add(a.id);
  if (seen.size > 400) seen.clear();
  const opt = (o) => {
    const b = h("button.ita-opt", {
      fk: `opt:${a.id}:${o.id}`, disabled: !!o.disabled, tip: o.disabled ?? null,
      attrs: { "aria-pressed": a.multi ? String(!!o.picked) : null, "aria-label": [o.label, o.cost, o.note, o.disabled].filter(Boolean).join(", ") },
      data: { pass: o.pass ? "1" : null },
      on: { click: () => (a.multi ? handlers.pick?.(a.id, o.id, a.multi.max) : o.zones && o.zoneReq ? handlers.zone?.(o, a) : o.req ? handlers.send?.(o.req) : null) },
    }, h("span.ita-opt-l", { text: o.label }), o.cost ? h("span.ita-opt-c", { text: o.cost }) : null, o.note ? h("span.ita-opt-n", { text: o.note }) : null, o.disabled ? h("span.ita-opt-why", { text: o.disabled }) : null);
    return b;
  };
  return h(`article.ita-ask${fresh ? ".ita-new" : ""}`, { data: { kind: a.kind, proxy: a.proxy ? "1" : null } },
    h("header.ita-head", {}, h("h3.ita-plate", { text: a.title }), a.about ? h("span.ita-about", { text: a.about }) : null),
    a.lines.map((l) => (typeof l === "string" ? h("p.ita-line", { text: l }) : h("blockquote.ita-quote", {}, h("span", { text: l.quote }), l.by ? h("cite", { text: l.by }) : null))),
    h("div.ita-opts", { attrs: { role: "group", "aria-label": a.title } }, a.options.map(opt)),
    a.free ? h("input.ita-text", { fk: `text:${a.id}`, attrs: { type: "text", maxlength: 300, placeholder: a.free.placeholder, "aria-label": a.free.placeholder, value: a.free.text }, on: { input: (e, el) => handlers.text?.(a.id, el.value) } }) : null,
    a.always ? h("label.ita-check", {}, h("input", { fk: `always:${a.id}`, attrs: { type: "checkbox", checked: a.always.on }, on: { change: (e, el) => handlers.always?.(a.id, el.checked) } }), h("span", { text: a.always.label })) : null,
    a.submit ? h("button.ita-submit", { fk: `submit:${a.id}`, text: a.submit.label, disabled: !!a.submit.disabled, tip: a.submit.disabled, on: { click: () => a.submit.req && handlers.send?.(a.submit.req) } }) : null);
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
