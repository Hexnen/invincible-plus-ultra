/* Tactical combat, the surfaces: FIXED PLACES, the state both surfaces read (U132 trial; slots-pure.mjs has the geometry). The dock works
   the frame out when it places itself (dock.mjs, through ui/settle.mjs) and keeps it here; the GM desk reads its part (desk.mjs). */
import { modeOf } from "./slots-pure.mjs";

let mode = "off", cur = null;
export const getMode = () => mode;
export function setMode(m) { const v = modeOf(m); const changed = v !== mode; mode = v; if (changed) cur = null; return changed; }
export const frameNow = () => (mode === "off" ? null : cur);
export function setFrame(f) { try { cur = f && typeof f === "object" ? f : null; } catch { cur = null; } }
