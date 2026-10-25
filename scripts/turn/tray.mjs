/* Action tray: the DOM + placement layer of the strip above the macro bar. No Foundry documents in here: main.mjs hands over a plain model
     { show, round, rows: [{ key, name, img, isTurn }], sel (row key), who: { name, img },
       pips: [{ id, k, label, state: "open" | "used", armed, disabled, tip }], end: { enabled, tip }, lone (only the End button) }
   and receives clicks through configure({ onPip(id), onEnd(), onPick(key) }).
   Structure: div#invincible-turn-tray (fixed, pointer-events none) > div.itt (the ink panel, pointer-events auto):
     [character tabs when the user owns several] [portrait + name] [action toggles] [round chip] [End turn].
   Buttons are patched in place by key (not rebuilt), so hover / focus survive a refresh. Placement is measured, never per frame:
   centred on #hotbar, sitting 8 px above it, pushed clear of the party column (left) and the sidebar / chat notifications (right); a window
   too narrow for the full panel drops the name, then the panel's font-size shrinks. The panel slides down out of sight when hidden. */
import { t } from "./lang.mjs";

const ID = "invincible-turn-tray";
const GAP = 6;
const mk = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};
const ICON = { fast: "fa-forward", slow: "fa-play", one: "fa-play" };

let root = null, panel = null, tabs = null, who = null, acts = null, pill = null, endBtn = null, handlers = {};
let shown = false, hideTimer = 0, last = null;

export function configure(h) { handlers = h ?? {}; }

/* ---------- placement ---------- */
function visibleRect(el) {
  try {
    if (!el) return null;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return null;
    const r = el.getBoundingClientRect();
    return r.width > 8 && r.height > 8 ? r : null;
  } catch { return null; }
}
export function place() {
  if (!root) return;
  const W = window.innerWidth, H = window.innerHeight;
  const hot = visibleRect(document.getElementById("hotbar"));
  const bottom = hot && hot.top > H * 0.4 ? H - hot.top + GAP : 14 + GAP;
  const cx0 = hot ? (hot.left + hot.right) / 2 : W / 2;
  let lo = 12, hi = W - 12;
  /* only things that share the tray's horizontal band (its y range) push it sideways */
  const yBot = H - bottom, yTop = yBot - (panel.offsetHeight || 56) - 4;
  const inBand = (r) => r && r.top < yBot && r.bottom > yTop;
  /* right: the sidebar (when it is open), and the chat notifications that stack up above the chat input (the container is a tall transparent
     column: only its message children count) */
  const sb = visibleRect(document.getElementById("sidebar"));
  if (sb && sb.left > W * 0.5) hi = Math.min(hi, sb.left - 12);
  for (const m of document.querySelectorAll("#chat-notifications .chat-message")) {
    const r = visibleRect(m);
    if (inBand(r) && r.left > W * 0.3) hi = Math.min(hi, r.left - 10);
  }
  /* left: the party column (full-card extent), the player list */
  const partyEl = document.getElementById("invincible-party");
  const party = visibleRect(partyEl);
  if (party && party.right < W * 0.5) {
    const kids = [...partyEl.querySelectorAll(".ipt-item")].map(visibleRect).filter(inBand);
    if (kids.length || inBand(party)) lo = Math.max(lo, party.right + 10);
  }
  const pl = visibleRect(document.getElementById("players"));
  if (inBand(pl) && pl.right < W * 0.3) lo = Math.max(lo, pl.right + 8);
  const avail = Math.max(260, hi - lo);
  root.style.setProperty("--itt-bottom", `${Math.round(bottom)}px`);
  root.style.setProperty("--itt-maxw", `${Math.round(avail)}px`);
  root.classList.remove("itt-compact");
  root.style.setProperty("--itt-fit", "1");
  panel.style.width = "";
  let w = panel.offsetWidth;
  if (w > avail) { root.classList.add("itt-compact"); w = panel.offsetWidth; }
  if (w > avail) { root.style.setProperty("--itt-fit", String(Math.max(0.7, (avail / w) * 0.98).toFixed(3))); w = panel.offsetWidth; }
  let cx = cx0;
  if (cx + w / 2 > hi) cx = hi - w / 2;
  if (cx - w / 2 < lo) cx = lo + w / 2;
  root.style.setProperty("--itt-cx", `${Math.round(cx)}px`);
}

/* ---------- DOM ---------- */
function ensure() {
  if (root?.isConnected) return;
  root = mk("div");
  root.id = ID;
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", t("ITN.Tray.Label"));
  root.classList.add("itt-hidden");
  panel = mk("div", "itt");
  tabs = mk("div", "itt-chars");
  tabs.setAttribute("role", "group");
  tabs.setAttribute("aria-label", t("ITN.Tray.Chars"));
  who = mk("div", "itt-who");
  who.append(mk("span", "itt-name"));
  acts = mk("div", "itt-acts");
  pill = mk("button", "itt-pill");
  pill.type = "button";
  pill.addEventListener("click", () => root?.classList.toggle("itt-peek"));
  endBtn = mk("button", "itt-end");
  endBtn.type = "button";
  endBtn.append(mk("i", "fa-solid fa-forward-step"), mk("span", "itt-end-t"));
  endBtn.addEventListener("click", (ev) => { ev.preventDefault(); handlers.onEnd?.(); });
  panel.append(tabs, who, acts, endBtn);
  root.append(pill, panel);
  document.body.appendChild(root);
}

function portrait(host, img, name) {
  host.replaceChildren();
  if (img) {
    const i = mk("img");
    i.alt = "";
    i.decoding = "async";
    i.src = img;
    host.append(i);
  } else host.append(mk("b", "", (name || "?").trim().charAt(0).toUpperCase()));
}

/* patch a keyed list of buttons in place */
function patch(host, items, make, update) {
  const have = new Map([...host.children].map((c) => [c.dataset.key, c]));
  const want = new Set(items.map((i) => i.key));
  for (const [k, el] of have) if (!want.has(k)) el.remove();
  let prev = null;
  for (const it of items) {
    let el = have.get(it.key);
    if (!el) el = make(it);
    update(el, it);
    if (el.previousElementSibling !== prev || el.parentNode !== host) host.insertBefore(el, prev ? prev.nextSibling : host.firstChild);
    prev = el;
  }
}

function makeAct(it) {
  const b = mk("button", "itt-act");
  b.type = "button";
  b.dataset.key = it.key;
  b.append(mk("i", `fa-solid ${ICON[it.k] ?? "fa-play"} itt-act-i`), mk("span", "itt-act-t"));
  b.addEventListener("click", (ev) => { ev.preventDefault(); if (b.getAttribute("aria-disabled") === "true") return; handlers.onPip?.(b.dataset.key); });
  return b;
}
function updateAct(b, it) {
  b.dataset.state = it.state;
  b.classList.toggle("itt-armed", !!it.armed);
  b.setAttribute("aria-pressed", it.state === "used" ? "true" : "false");
  b.setAttribute("aria-disabled", it.disabled ? "true" : "false");
  const state = t(`ITN.Act.${it.state}`);
  b.setAttribute("aria-label", t("ITN.Act.Line", { name: it.label, state }));
  b.dataset.tooltip = it.tip;
  b.querySelector(".itt-act-t").textContent = it.label;
}

function makeChar(it) {
  const b = mk("button", "itt-char");
  b.type = "button";
  b.dataset.key = it.key;
  b.append(mk("span", "itt-face"));
  b.addEventListener("click", (ev) => { ev.preventDefault(); handlers.onPick?.(b.dataset.key); });
  return b;
}
function updateChar(b, it) {
  b.setAttribute("aria-pressed", it.sel ? "true" : "false");
  b.classList.toggle("itt-turn", !!it.isTurn);
  b.setAttribute("aria-label", it.name);
  b.dataset.tooltip = it.name;
  const face = b.firstElementChild;
  if (face.dataset.src !== (it.img ?? "") || face.dataset.n !== it.name) { face.dataset.src = it.img ?? ""; face.dataset.n = it.name; portrait(face, it.img, it.name); }
}

/* ---------- render ---------- */
export function render(model) {
  last = model;
  if (!model?.show) return hide();
  ensure();
  const lone = !!model.lone;
  root.classList.toggle("itt-lone", lone);
  root.classList.toggle("itt-turn", !!model.isTurn);
  /* tabs: only when the user owns several characters in this combat */
  tabs.hidden = !(model.rows?.length > 1);
  patch(tabs, (model.rows ?? []).map((r) => ({ ...r, sel: r.key === model.sel })), makeChar, updateChar);
  who.hidden = !(model.rows?.length > 1);   // the name is only a tiny label when several characters share the tray
  who.querySelector(".itt-name").textContent = model.who?.name ?? "";
  root.classList.toggle("itt-rest", !model.isTurn);
  if (model.isTurn) root.classList.remove("itt-peek");
  renderPill(model);
  acts.hidden = lone || !model.pips?.length;
  patch(acts, (model.pips ?? []).map((p) => ({ ...p, key: p.id })), makeAct, updateAct);
  endBtn.querySelector(".itt-end-t").textContent = t("ITN.End");
  endBtn.setAttribute("aria-disabled", model.end?.enabled ? "false" : "true");
  endBtn.classList.toggle("itt-off", !model.end?.enabled);
  endBtn.dataset.tooltip = model.end?.tip ?? "";
  place();
  reveal();
}

/* the resting pill (not your turn): two small pips + the end glyph, icons only */
function renderPill(model) {
  const key = JSON.stringify([(model.pips ?? []).map((p) => p.state), model.end?.enabled, model.who?.name]);
  if (pill.dataset.k === key) return;
  pill.dataset.k = key;
  pill.replaceChildren();
  for (const p of model.pips ?? []) pill.append(mk("i", `fa-solid itt-pip ${ICON[p.k] ?? "fa-play"}${p.state === "used" ? " itt-pip-used" : ""}`));
  pill.append(mk("i", "fa-solid fa-forward-step itt-pill-end"));
  pill.setAttribute("aria-label", `${t("ITN.Tray.Label")}: ${model.who?.name ?? ""}`);
  pill.dataset.tooltip = t("ITN.Tray.Label");
}

function reveal() {
  clearTimeout(hideTimer);
  if (shown) return;
  shown = true;
  root.style.visibility = "";
  requestAnimationFrame(() => requestAnimationFrame(() => root?.classList.remove("itt-hidden")));
}
export function hide() {
  if (!root || !shown) return;
  shown = false;
  root.classList.add("itt-hidden");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { if (root && !shown) root.style.visibility = "hidden"; }, 320);
}

export const relayout = () => { if (root && shown) place(); };
export const el = () => root;
export const endButton = () => endBtn;
export const isShown = () => shown;
export const lastModel = () => last;
export function destroy() {
  clearTimeout(hideTimer);
  root?.remove();
  root = panel = tabs = who = acts = pill = endBtn = null;
  shown = false; last = null;
}
