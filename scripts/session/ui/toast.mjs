/* End-of-session panel, phase S6: the PLAYER NOTICE ("the GM started the review" / "a review is in progress"), moved out of main.mjs's inline px styling. It lives on
   document.body (outside the window), so styles/session.css gives it literal values. One notice at a time (id ipl-session-toast, role=status), a yellow "Open" plate and a
   real close button (S4-22: mouse users could not dismiss it), Escape also closes it, the timer pauses while the pointer or focus is on it, and it removes itself after
   `ms`. Motion: a short rise (reduced motion: a plain fade). */
import { t } from "../lang.mjs";

const ID = "ipl-session-toast";
const reduced = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const ic = (cls) => { const i = mk("i", cls); i.setAttribute("aria-hidden", "true"); return i; };

export function removeNotice() { try { document.getElementById(ID)?.remove(); } catch { /* no DOM */ } }

export function showNotice(text, onOpen, ms = 25000) {
  try {
    removeNotice();
    const box = mk("div", "ips-notice");
    box.id = ID; box.setAttribute("role", "status");
    const open = mk("button", "ips-notice-open"); open.type = "button";
    open.append(ic("fa-solid fa-arrow-up-right-from-square"), mk("span", "", t("IPL.Session.Toast.Open")));
    const x = mk("button", "ips-notice-x"); x.type = "button";
    x.setAttribute("aria-label", t("IPL.Session.Toast.Close")); x.title = t("IPL.Session.Toast.Close");
    x.append(ic("fa-solid fa-xmark"));
    box.append(ic("fa-solid fa-flag-checkered ips-notice-ic"), mk("span", "ips-notice-t", text), open, x);

    let timer = 0, left = ms, started = 0;
    const arm = () => { clearTimeout(timer); started = Date.now(); timer = setTimeout(gone, left); };
    const hold = () => { if (!started) return; clearTimeout(timer); left = Math.max(4000, left - (Date.now() - started)); started = 0; };
    const onKey = (ev) => { if (ev.key === "Escape" && !ev.defaultPrevented && document.getElementById(ID) === box) gone(); };
    function gone() { clearTimeout(timer); document.removeEventListener("keydown", onKey, true); box.remove(); }
    open.addEventListener("click", () => { gone(); onOpen?.(); });
    x.addEventListener("click", gone);
    box.addEventListener("pointerenter", hold); box.addEventListener("pointerleave", arm);
    box.addEventListener("focusin", hold); box.addEventListener("focusout", (ev) => { if (!box.contains(ev.relatedTarget)) arm(); });
    document.body.append(box);
    document.addEventListener("keydown", onKey, true);
    arm();
    box.animate?.(reduced() ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }],
      { duration: reduced() ? 120 : 200, easing: "cubic-bezier(.16, 1, .3, 1)" });
    return box;
  } catch { return null; /* no DOM */ }
}
