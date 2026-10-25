/* Activity log UI: tiny DOM helpers (no jQuery, no templates). Import-safe in Node: nothing touches `document` at load time. */

const isNode = (v) => typeof Node !== "undefined" && v instanceof Node;
/** h("button.ipl-btn", {type: "button", "aria-pressed": "false", onclick: fn, dataset: {id: 1}}, child, "text", [more]) -> HTMLElement. Falsy children are skipped. */
export function h(spec, attrs, ...children) {
  const m = String(spec).match(/^([a-z][a-z0-9]*)?((?:[.#][\w-]+)*)$/i) || [];
  const el = document.createElement(m[1] || "div");
  for (const part of (m[2] || "").match(/[.#][\w-]+/g) || []) { if (part[0] === ".") el.classList.add(part.slice(1)); else el.id = part.slice(1); }
  if (attrs && typeof attrs === "object" && !(attrs instanceof Node) && !Array.isArray(attrs)) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v == null) continue;
      if (k === "dataset") for (const [dk, dv] of Object.entries(v)) { if (dv != null) el.dataset[dk] = String(dv); }
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "class") el.classList.add(...String(v).split(/\s+/).filter(Boolean));
      else if (k === "text") el.textContent = v;
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, String(v));
    }
  } else if (attrs !== undefined && attrs !== null) children.unshift(attrs);
  append(el, children);
  return el;
}
export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === false || c == null || c === "") continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
/** Font Awesome icon, hidden from assistive tech. `cls` may carry "fa-xxx" or "fa-solid fa-xxx". */
export function icon(cls, extra = "") {
  const c = String(cls).includes("fa-solid") || String(cls).includes("fa-regular") ? cls : `fa-solid ${cls}`;
  return h("i", { class: `${c} ${extra}`.trim(), "aria-hidden": "true", inert: true });
}
/** Visually hidden text for screen readers. */
export const sr = (text) => h("span.ipl-sr", text);

let uidN = 0;
export const uid = (p = "ipl") => `${p}-${++uidN}`;

/** Replace {name} tokens: Node values are inserted as nodes, everything else as text. opts.kid drops {who} and the punctuation after it. */
export function buildNodes(tpl, params, opts = {}) {
  const frag = document.createDocumentFragment();
  let skipLead = false;
  for (const tok of String(tpl).split(/(\{\w+\})/)) {
    if (!tok) continue;
    const m = tok.match(/^\{(\w+)\}$/);
    if (!m) { frag.append(document.createTextNode(skipLead ? tok.replace(/^[\s:,.-]+/, "") : tok)); skipLead = false; continue; }
    if (opts.kid && m[1] === "who") { skipLead = true; continue; }
    skipLead = false;
    const v = params[m[1]];
    if (v == null) frag.append(document.createTextNode(`{${m[1]}}`));
    else if (isNode(v)) frag.append(v);
    else frag.append(document.createTextNode(String(v)));
  }
  return frag;
}
/** Plain text version of the same template (search, exports, aria). */
export function buildText(tpl, params, opts = {}) {
  let out = "", skipLead = false;
  for (const tok of String(tpl).split(/(\{\w+\})/)) {
    if (!tok) continue;
    const m = tok.match(/^\{(\w+)\}$/);
    if (!m) { out += skipLead ? tok.replace(/^[\s:,.-]+/, "") : tok; skipLead = false; continue; }
    if (opts.kid && m[1] === "who") { skipLead = true; continue; }
    skipLead = false;
    const v = params[m[1]];
    out += v == null ? `{${m[1]}}` : isNode(v) ? v.textContent : String(v);
  }
  return out;
}
