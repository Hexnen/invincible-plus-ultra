/* perf4 (U140's cost): the aim mark on the roots of the panels that step back while this user aims (the logic: ui/aim-pure.mjs).
   Written synchronously wherever the classes it follows change: the dock's pick (ui/pick.mjs), the surfaces' class (ui/main.mjs), the
   map's pick (its hook "moinenMapsPicking", called right after its class changes, before its first look at the screen); a watcher on
   <body> (its class, its children: a panel's root drawn anew) catches anything else at the end of the same task, before a frame. */
import * as P from "./aim-pure.mjs";
import * as Zones from "../zones-adapter.mjs";

export function sync() {
  try {
    const cl = document.body?.classList;
    if (!cl) return;
    const on = P.aimOn((c) => cl.contains(c));
    for (const [id, v] of P.changes(on, (id) => { const el = document.getElementById(id); return el ? el.hasAttribute(P.ATTR) : null; })) document.getElementById(id)?.toggleAttribute(P.ATTR, v);
  } catch { /* no page */ }
}
let watching = null;
export function watch() {
  try {
    if (watching || typeof MutationObserver !== "function" || !document.body) return;
    watching = new MutationObserver(sync);
    watching.observe(document.body, { attributes: true, attributeFilter: ["class"], childList: true });
    Zones.onPicking(sync);
    sync();
  } catch { /* the old way is gone: the mark simply follows the next change */ }
}
