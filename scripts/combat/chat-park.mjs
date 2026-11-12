/* FXX (U185): the popped-out chat parks in the right column while a fight is shown (chat-park-pure.mjs says why and where). Started by
   combat/main.mjs. Every move of the chat window (ours, Foundry's, the user's drag) is told once it settles as the window event
   "ipu:chat-moved", so the surfaces that keep clear of it (the initiative bar, the dock, the challenges, the GM desk) are placed again. */
import * as P from "./chat-park-pure.mjs";

export const MOVED = "ipu:chat-moved";
let fightOn = () => false, last = null, mo = null, watched = null, timer = 0, started = false;

const popout = () => { try { const a = ui?.chat?.popout; return a?.rendered && a.element?.isConnected ? a : null; } catch { return null; } };
const rectOf = (el) => { try { const r = el?.getBoundingClientRect(); return r && r.width > 0 && r.height > 0 && getComputedStyle(el).display !== "none" ? r : null; } catch { return null; } };
const side = () => P.sideLeft(rectOf(document.getElementById("sidebar")), window.innerWidth);

/** the right column's left edge (window px) as every fight surface should see it: the sidebar, or a parked chat left of it */
export function rightWall() {
  try { return P.rightEdge(side(), rectOf(document.getElementById("chat-popout")), window.innerWidth); } catch { return window.innerWidth; }
}

/** the parked chat's left edge (window px), Infinity when no popped-out chat stands in the right column */
export function parkedLeft() {
  try { const r = rectOf(document.getElementById("chat-popout")); return P.isParked(r, side(), window.innerWidth) ? Math.round(r.left) : Infinity; } catch { return Infinity; }
}

function tell() {
  clearTimeout(timer);
  timer = setTimeout(() => { timer = 0; try { window.dispatchEvent(new Event(MOVED)); } catch { /* nobody listens */ } }, 90);
}
function watch(el) {
  if (el === watched) return;
  mo?.disconnect();
  watched = el ?? null;
  if (!watched || !window.MutationObserver) return;
  mo ??= new MutationObserver(tell);   // ApplicationV2 writes its position into the element's inline style
  mo.observe(watched, { attributes: true, attributeFilter: ["style", "class"] });
}

/** park the chat if it should be (chat-park-pure.parkNow) */
export function check() {
  const app = popout();
  if (!app) { watch(null); last = null; return; }
  watch(app.element);
  const r = rectOf(app.element);
  const spot = P.parkNow({ fight: !!fightOn(), rect: r, W: window.innerWidth, side: side(), last });
  if (!spot) return;
  try {
    app.setPosition({ left: spot.left });
    const p = app.position ?? {};
    last = { left: Number(p.left) || spot.left, top: Number(p.top) || r.top };
    tell();
  } catch (e) { console.warn("invincible-plus-ultra | chat park", e); }
}

export function start(opts = {}) {
  if (typeof opts.fight === "function") fightOn = opts.fight;
  if (started) return;
  started = true;
  const later = () => { check(); setTimeout(check, 320); };
  Hooks.on("renderChatLog", (app) => { if (app?.isPopout) later(); });
  Hooks.on("closeChatLog", (app) => { if (app?.isPopout) { last = null; watch(null); tell(); } });
  Hooks.on("collapseSidebar", later);
  window.addEventListener("resize", later);
  window.addEventListener("ipu:fight-ui", later);   // combat/bar.mjs: the initiative bar came up
}
