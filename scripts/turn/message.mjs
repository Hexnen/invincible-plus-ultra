/* YOUR TURN message: the DOM + motion layer for the centre-screen announcement. No Foundry documents in here: main.mjs hands over a plain event
   { name, img, entry (a short "Turn 2 of 3" or ""), title }. One message at a time; a new one replaces the one on screen (restarts the hold).
   Structure: div#invincible-turn-message (fixed, pointer-events none) > div.itm[aria-hidden] (the picture) + div.itm-sr[role=status] (the words,
   created once so the live region exists before its text changes). Timers only (a hidden tab cannot leave it stuck); motion is transform /
   opacity via Web Animations on the individual `scale` / `translate` properties (they compose with the panel's skew); reduced motion = fade.
   Placement is measured when a message is shown and when the window / sidebar changes: horizontally the centre of the free map area
   (window minus sidebar minus scene controls, banner.mjs freeArea()), vertically a little above the middle of the screen. */
import { freeArea } from "../combat/banner.mjs";

const ID = "invincible-turn-message";
const IN_MS = 300, HOLD_MS = 1400, OUT_MS = 300;
const EASE_OUT = "cubic-bezier(.16, 1, .3, 1)";

let root = null, live = null, node = null, state = "idle";
let holdTimer = 0, outTimer = 0, liveTimer = 0;

const reduced = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const mk = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};
const anim = (el, frames, opts) => { try { return el?.animate?.(frames, opts) ?? null; } catch { return null; } };

function place() {
  if (!root) return;
  const { left, right } = freeArea();
  const avail = Math.max(260, right - left);
  root.style.setProperty("--itm-cx", `${Math.round((left + right) / 2)}px`);
  root.style.setProperty("--itm-cy", `${Math.round(window.innerHeight * 0.36)}px`);
  root.style.setProperty("--itm-maxw", `${avail}px`);
  root.style.setProperty("--itm-fit", "1");
  const w = node?.offsetWidth ?? 0;
  if (w > avail) root.style.setProperty("--itm-fit", String(Math.max(0.5, (avail / w) * 0.97).toFixed(3)));   // a narrow window: everything is in em, the whole panel shrinks
}
export function relayout() { if (node) place(); }

function ensureRoot() {
  if (root?.isConnected) return;
  root = mk("div");
  root.id = ID;
  live = mk("div", "itm-sr");
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");
  root.append(live);
  document.body.appendChild(root);
}

function build(ev) {
  const el = mk("div", "itm");
  el.setAttribute("aria-hidden", "true");
  const face = mk("div", "itm-face");
  if (ev.img) {
    const img = mk("img", "itm-img");
    img.alt = "";
    img.decoding = "async";
    img.src = ev.img;
    face.append(img);
  } else face.append(mk("span", "itm-ph", (ev.name || "?").trim().charAt(0).toUpperCase()));
  const body = mk("div", "itm-body");
  body.append(mk("div", "itm-plate", ev.title), mk("div", "itm-name", ev.name || ""));
  if (ev.entry) body.append(mk("div", "itm-entry", ev.entry));
  el.append(face, body);
  return el;
}

function announce(text) {
  if (!live || !text) return;
  live.textContent = "";
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { if (live) live.textContent = text; }, 60);
}

function clearTimers() { clearTimeout(holdTimer); clearTimeout(outTimer); }

export function show(ev) {
  ensureRoot();
  clearTimers();
  node?.remove();
  node = build(ev);
  root.append(node);
  state = "in";
  place();
  const rm = reduced();
  if (rm) anim(node, [{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "ease-out" });
  else {
    anim(node, [
      { scale: 0.55, translate: "0 18px", opacity: 0 },
      { scale: 1.08, translate: "0 -4px", opacity: 1, offset: 0.62 },
      { scale: 1, translate: "0 0", opacity: 1 }
    ], { duration: IN_MS, easing: EASE_OUT });
  }
  announce([ev.title, ev.name, ev.entry].filter(Boolean).join(". ") + ".");
  holdTimer = setTimeout(exit, (rm ? 160 : IN_MS) + (rm ? Math.round(HOLD_MS * 0.7) : HOLD_MS));
}

function exit() {
  if (state !== "in" || !node) return;
  state = "out";
  const el = node;
  anim(el, reduced() ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, scale: 1 }, { opacity: 0, scale: 0.94 }], { duration: reduced() ? 160 : OUT_MS, easing: "ease-in", fill: "forwards" });
  outTimer = setTimeout(finish, (reduced() ? 160 : OUT_MS) + 40);
}

function finish() {
  clearTimers();
  node?.remove();
  node = null;
  state = "idle";
}

/* leave at once (turn changed, setting turned off, scene change) */
export function clear() { if (state !== "idle") finish(); }
export function destroy() {
  clearTimers(); clearTimeout(liveTimer);
  node = null; state = "idle";
  root?.remove();
  root = live = null;
}
export const isShowing = () => state !== "idle";
