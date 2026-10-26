/* Combat banner: the DOM + motion layer. No Foundry documents in here: main.mjs hands over plain events.
   Event: { kind: "start" | "round" | "end", id (combat id), round (start / round), back (round went down), count (start), rounds (end) }.
   One banner at a time. The state machine (all timers, nothing per frame, nothing depends on animations finishing, so a hidden tab cannot
   leave it stuck):
     idle -> in (380 ms) -> hold -> out (300 ms) -> idle
   show() while visible:
     - the same slot (a "round" event while a "round" banner of the same combat is up): the banner is UPDATED IN PLACE (new numeral, quick
       re-pop, hold restarted). A burst of "next round" clicks therefore costs one banner that keeps counting, never a pile;
     - anything else (start / end, another combat): kept in ONE pending slot (last wins) and shown right after the current banner has left;
       the current one is asked to leave as soon as it has been readable for a moment (MIN_SHOW).
   Structure: div#invincible-combat-banner (fixed, pointer-events none) > div.icb[aria-hidden] (the picture) + div.icb-sr[role=status]
   (the words, for screen readers; created once so the live region exists before its text changes). Motion: transform / opacity via
   Web Animations on the individual `translate` / `scale` properties (they compose with the banner's skew). */
import { t, tn } from "./lang.mjs";

const ID = "invincible-combat-banner";
const IN_MS = 380, OUT_MS = 300;
const HOLD = { round: 1900, start: 2700, end: 2700 };   // ms the banner rests, after the slide in
const MIN_SHOW = IN_MS + 650;                            // a banner that must make room has been on screen at least this long
const EASE_OUT = "cubic-bezier(.16, 1, .3, 1)";
const SIZES = { small: 0.8, normal: 1, large: 1.3 };

let root = null, live = null, node = null, state = "idle", cur = null, pending = null;
let holdTimer = 0, stateTimer = 0, outTimer = 0, liveTimer = 0, shownAt = 0, size = "normal";

const reduced = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const mk = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};
const anim = (el, frames, opts) => { try { return el?.animate?.(frames, opts) ?? null; } catch { return null; } };

/* ---------- placement ----------
   Horizontally: centred over the free map area = the window minus the sidebar (right), minus the scene controls (left), and, when the
   Challenges HUD is open and would be touched, minus the HUD (it stays to the right of the banner). Vertically: just below the scene
   navigation bar, which is where the banner would otherwise be hidden: the banner slides down from the top edge BEHIND the navigation
   (z-index one below the interface layer), then rests under it. Measured when a banner is shown or updated and when the window / sidebar
   changes, never per frame. */
function measureTop() {
  let bottom = 0;
  try {
    const el = document.querySelector("#scene-navigation .scene-navigation-menu") ?? document.getElementById("scene-navigation");
    const r = el?.getBoundingClientRect();
    if (r && r.height > 0 && r.bottom < 220) bottom = r.bottom;
  } catch { bottom = 0; }
  const own = Math.round(Math.min(150, Math.max(bottom, 40)) + 10);
  /* the initiative bar (bar.mjs) publishes its bottom edge as data-icbar-bottom on :root (0 / unset when it is not showing): the banner sits below it */
  let bar = 0;
  try { bar = parseFloat(document.documentElement.dataset.icbarBottom) || 0; } catch { bar = 0; }
  return bar > 0 ? Math.max(own, Math.round(bar + 10)) : own;
}
export function freeArea() {
  const W = window.innerWidth;
  let left = 0, right = 0;
  try {
    const r = document.getElementById("sidebar")?.getBoundingClientRect();
    const rr = r ? W - r.left : 0;
    if (r && r.width > 0 && rr > 0 && rr < W * 0.5) right = Math.round(rr);
  } catch { right = 0; }
  try {
    const c = document.getElementById("scene-controls")?.getBoundingClientRect();
    if (c && c.width > 0 && c.right > 0 && c.right < W * 0.25) left = Math.round(c.right);
  } catch { left = 0; }
  return { left: left + 12, right: Math.max(left + 200, W - right - 12) };
}
/* the left edge of the Challenges HUD when it is open and sits in the banner's band; Infinity when there is none */
export function hudLimit(top, height) {
  try {
    const hud = document.getElementById("invincible-challenges");
    if (!hud || hud.classList.contains("ich-bye")) return Infinity;
    /* open: the HUD root's own box (its left edge IS the dock's resting edge; the dock itself is translated while it slides in / out, so its rect lies);
       collapsed: the handle */
    const part = hud.classList.contains("ich-collapsed") ? hud.querySelector(".ich-handle") : hud;
    const r = part?.getBoundingClientRect();
    if (!r || r.width <= 0 || r.top > top + height + 4 || r.bottom < top) return Infinity;
    return r.left - 14;
  } catch { return Infinity; }
}
function place() {
  if (!root) return;
  const top = measureTop();
  const { left, right } = freeArea();
  root.style.setProperty("--icb-top", `${top}px`);
  const avail = Math.max(240, right - left);
  root.style.setProperty("--icb-maxw", `${avail}px`);
  root.style.setProperty("--icb-fit", "1");
  let w = root.offsetWidth;
  if (w > avail) {   // a narrow window: the whole banner shrinks (everything is in em) rather than running under the sidebar
    root.style.setProperty("--icb-fit", String(Math.max(0.55, (avail / w) * 0.98).toFixed(3)));
    w = root.offsetWidth;
  }
  const h = node?.offsetHeight ?? 0;
  const hi = Math.min(right, hudLimit(top, h));
  let cx = (left + right) / 2;
  if (cx + w / 2 > hi) cx = hi - w / 2;     // keep clear of the HUD / the sidebar
  if (cx - w / 2 < left) cx = left + w / 2;   // never outside the free area on the left (a very narrow window may overlap the HUD: the banner wins, it is short)
  root.style.setProperty("--icb-cx", `${Math.round(cx)}px`);
  return top;
}
export function relayout() { if (node) place(); }

/* ---------- content ---------- */
function build(ev) {
  const el = mk("div", "icb");
  el.dataset.kind = ev.kind;
  el.setAttribute("aria-hidden", "true");
  if (ev.kind === "round") {
    const fig = mk("div", "icb-fig");
    fig.append(mk("span", "icb-lab"), mk("b", "icb-num"));
    const tell = mk("span", "icb-back");
    tell.append(mk("i", "icb-back-i"), mk("span", "icb-back-t"));
    el.append(fig, tell);
  } else if (ev.kind === "start") {
    el.append(mk("div", "icb-plate"));
    const fig = mk("div", "icb-fig");
    fig.append(mk("span", "icb-lab"), mk("b", "icb-num"));
    el.append(fig, mk("p", "icb-cap"));
  } else {
    el.append(mk("div", "icb-plate"), mk("p", "icb-cap"));
  }
  return el;
}

/* the words of an event: title (plate), label, number, caption, and the one sentence for screen readers */
function words(ev) {
  const roundWord = t("ICB.Round");
  if (ev.kind === "start") {
    const cap = ev.count > 0 ? tn("ICB.Ctx.Combatants", ev.count) : "";
    return { title: t("ICB.Start.Title"), label: roundWord, num: ev.round, cap, sr: [t("ICB.Start.Title"), `${roundWord} ${ev.round}`, cap].filter(Boolean).join(". ") + "." };
  }
  if (ev.kind === "end") {
    const cap = ev.rounds > 0 ? tn("ICB.End.After", ev.rounds) : "";
    return { title: t("ICB.End.Title"), cap, n: ev.rounds, sr: [t("ICB.End.Title"), cap].filter(Boolean).join(", ") + "." };
  }
  const back = ev.back ? t("ICB.Back") : "";
  return { label: roundWord, num: ev.round, back, sr: [`${roundWord} ${ev.round}`, back].filter(Boolean).join(", ") + "." };
}

function fill(el, ev) {
  const w = words(ev);
  const set = (sel, text) => { const n = el.querySelector(sel); if (n && n.textContent !== String(text)) n.textContent = String(text); };
  if (ev.kind === "end") {
    set(".icb-plate", w.title);
    const cap = el.querySelector(".icb-cap");
    if (cap) {
      cap.replaceChildren();
      cap.hidden = !w.cap;
      if (w.cap) {   // the count is the one number in the caption: it gets the numeral treatment
        const parts = w.cap.split(String(w.n));
        cap.append(document.createTextNode(parts[0] ?? ""), mk("b", "icb-n", String(w.n)), document.createTextNode(parts.slice(1).join(String(w.n))));
      }
    }
  } else {
    if (ev.kind === "start") {
      set(".icb-plate", w.title);
      const cap = el.querySelector(".icb-cap");
      if (cap) { cap.textContent = w.cap; cap.hidden = !w.cap; }
    }
    set(".icb-lab", w.label);
    set(".icb-num", w.num);
    if (ev.kind === "round") {
      el.classList.toggle("icb-is-back", !!ev.back);
      const tell = el.querySelector(".icb-back");
      if (tell) { tell.hidden = !ev.back; set(".icb-back-t", w.back); }
    }
  }
  return w;
}

/* ---------- motion ---------- */
function pulse(ev, delay) {
  const num = node?.querySelector(".icb-num, .icb-n");
  if (!num || reduced()) return;
  const soft = !!ev.back;
  anim(num, soft
    ? [{ scale: 1 }, { scale: 1.1, offset: 0.4 }, { scale: 1 }]
    : [{ scale: 0.7, opacity: 0.25 }, { scale: 1.28, opacity: 1, offset: 0.45 }, { scale: 0.96, offset: 0.75 }, { scale: 1 }],
  { duration: soft ? 300 : 460, delay, easing: "ease-out", fill: "backwards" });
}

function announce(text) {
  if (!live || !text) return;
  live.textContent = "";                    // clear first so the same sentence (a repeated round) is read again
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { if (live) live.textContent = text; }, 60);
}

function ensureRoot() {
  if (root?.isConnected) return;
  root = mk("div");
  root.id = ID;
  root.style.setProperty("--icb-scale", String(SIZES[size] ?? 1));
  live = mk("div", "icb-sr");
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");
  root.append(live);
  document.body.appendChild(root);
}

function holdFor(ev) {
  const base = HOLD[ev.kind] ?? 2000;
  return reduced() ? Math.round(base * 0.7) : base;
}
function scheduleHold(ms) {
  clearTimeout(holdTimer);
  holdTimer = setTimeout(exit, ms);
}

function present(ev) {
  ensureRoot();
  cur = ev;
  state = "in";
  shownAt = performance.now();
  node = build(ev);
  const w = fill(node, ev);
  root.append(node);
  const top = place() ?? 56;
  const rm = reduced();
  const h = node.offsetHeight;
  if (rm) anim(node, [{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "ease-out" });
  else {
    const from = -(top + h + 30);   // fully above the top edge of the window
    anim(node, [{ translate: `0 ${from}px` }, { translate: "0 7px", offset: 0.72, easing: "ease-out" }, { translate: "0 0" }], { duration: IN_MS, easing: EASE_OUT });
  }
  pulse(ev, rm ? 0 : IN_MS - 140);
  announce(w.sr);
  clearTimeout(stateTimer);
  stateTimer = setTimeout(() => { if (state === "in") state = "hold"; }, rm ? 160 : IN_MS);
  scheduleHold((rm ? 160 : IN_MS) + (pending ? Math.max(0, MIN_SHOW - IN_MS) : holdFor(ev)));
}

function update(ev) {
  cur = ev;
  const w = fill(node, ev);
  place();
  pulse(ev, 0);
  announce(w.sr);
  // restart the rest: the full hold again (a burst keeps the banner up while it counts)
  const intoSlide = state === "in" ? Math.max(0, IN_MS - (performance.now() - shownAt)) : 0;
  scheduleHold(intoSlide + holdFor(ev));
}

function exit() {
  if (state === "out" || state === "idle" || !node) return;
  state = "out";
  clearTimeout(holdTimer);
  clearTimeout(stateTimer);
  const el = node;
  if (reduced()) anim(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" });
  else {
    const top = parseFloat(root?.style.getPropertyValue("--icb-top")) || 56;
    anim(el, [{ translate: "0 0" }, { translate: `0 ${-(top + el.offsetHeight + 30)}px` }], { duration: OUT_MS, easing: "cubic-bezier(.5, 0, .9, .4)", fill: "forwards" });
  }
  clearTimeout(outTimer);
  outTimer = setTimeout(finish, (reduced() ? 160 : OUT_MS) + 60);
}

function finish() {
  clearTimeout(outTimer);
  node?.remove();
  node = null;
  cur = null;
  state = "idle";
  if (pending) { const next = pending; pending = null; present(next); }
}

/* ---------- public ---------- */
const sameSlot = (a, b) => !!a && !!b && a.kind === "round" && b.kind === "round" && a.id === b.id;

export function show(ev) {
  if (state === "idle") return present(ev);
  if (state !== "out" && sameSlot(cur, ev)) return update(ev);
  pending = ev;   // one slot, last wins
  if (state === "in" || state === "hold") {   // ask the current banner to leave once it has been readable for a moment
    const left = Math.max(0, MIN_SHOW - (performance.now() - shownAt));
    scheduleHold(left);
  }
}

export function setSize(s) {
  size = SIZES[s] ? s : "normal";
  root?.style.setProperty("--icb-scale", String(SIZES[size]));
  relayout();
}

/* the banner leaves now and nothing is queued (setting turned off, scene change) */
export function clear(quick = false) {
  pending = null;
  if (state === "idle") return;
  if (quick || !node) { clearTimeout(holdTimer); clearTimeout(stateTimer); clearTimeout(outTimer); finish(); return; }
  exit();
}

export function destroy() {
  clearTimeout(holdTimer); clearTimeout(stateTimer); clearTimeout(outTimer); clearTimeout(liveTimer);
  pending = null; cur = null; node = null; state = "idle";
  root?.remove();
  root = live = null;
}

export const isShowing = () => state !== "idle";
