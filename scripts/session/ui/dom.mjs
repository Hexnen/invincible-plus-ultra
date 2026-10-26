/* End-of-session panel, phase S3: tiny DOM helpers. The window is plain DOM (like the chargen and base shells): nodes are created once and PATCHED afterwards, so a
   repaint caused by someone else's click never replaces the element you are focused on. The setters write only when the value really changed. */
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
export function el(tag, cls = "", attrs = null, ...kids) {
  const n = document.createElement(tag);
  if (attrs instanceof Node || typeof attrs === "string" || Array.isArray(attrs)) { kids.unshift(attrs); attrs = null; }   // el(tag, cls, child, ...): attributes are optional
  if (cls) n.className = cls;
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? "" : String(v));
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k);
  return n;
}
export const icon = (classes) => el("i", classes, { "aria-hidden": "true" });
export const setText = (n, s) => { s = String(s ?? ""); if (n && n.textContent !== s) n.textContent = s; };
export function setAttr(n, k, v) {
  if (!n) return;
  if (v === null || v === undefined || v === false) { if (n.hasAttribute(k)) n.removeAttribute(k); return; }
  const s = v === true ? "" : String(v);
  if (n.getAttribute(k) !== s) n.setAttribute(k, s);
}
export const setHidden = (n, hidden) => { if (n && n.hidden !== !!hidden) n.hidden = !!hidden; };

/** A portrait: <img>, or a muted looping <video> for webm / mp4 art, or the halftone placeholder when there is none. Returns the node; updatePortrait() swaps it in place. */
const isVideo = (src) => /\.(webm|mp4|m4v)(\?|#|$)/i.test(String(src ?? ""));
export function portrait(src, alt = "") {
  const box = el("span", "ips-portrait", { "aria-hidden": "true" });
  updatePortrait(box, src, alt);
  return box;
}
export function updatePortrait(box, src, alt = "") {
  const want = String(src ?? "");
  if (box.dataset.src === want) return;
  box.dataset.src = want;
  box.replaceChildren();
  if (!want) { box.classList.add("is-empty"); box.append(icon("fa-solid fa-user")); return; }
  box.classList.remove("is-empty");
  if (isVideo(want)) {
    const v = el("video", "", { muted: true, loop: true, autoplay: true, playsinline: true, preload: "metadata", tabindex: "-1" });
    v.muted = true; v.src = want;
    v.addEventListener("error", () => { box.classList.add("is-empty"); box.replaceChildren(icon("fa-solid fa-user")); }, { once: true });
    box.append(v);
  } else {
    const i = el("img", "", { alt: "", loading: "lazy", decoding: "async", draggable: "false" });
    i.src = want;
    i.addEventListener("error", () => { box.classList.add("is-empty"); box.replaceChildren(icon("fa-solid fa-user")); }, { once: true });
    box.append(i);
  }
}

/** Reconcile a keyed list: `items` = [{ key }], make(item) builds a node once, patch(node, item) updates it. Existing nodes keep their identity (and focus). */
export function reconcile(parent, items, make, patch, nodes) {
  const want = new Set(items.map((i) => i.key));
  for (const [k, n] of [...nodes]) if (!want.has(k)) { n.remove(); nodes.delete(k); }
  let prev = null;
  for (const item of items) {
    let n = nodes.get(item.key);
    if (!n) { n = make(item); nodes.set(item.key, n); }
    patch(n, item);
    const at = prev ? prev.nextSibling : parent.firstChild;
    if (at !== n) parent.insertBefore(n, at);
    prev = n;
  }
}

/** Run fn and put focus back on the element with the same data-fk (or name) if the repaint replaced the focused one. */
export function keepFocus(root, fn) {
  const ae = document.activeElement;
  const key = root && ae && root.contains(ae) ? ae.dataset?.fk || ae.getAttribute?.("name") : null;
  fn();
  if (key && (!document.activeElement || document.activeElement === document.body || !root.contains(document.activeElement))) {
    root.querySelector(`[data-fk="${CSS.escape(key)}"], [name="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  }
}
export const reducedMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
