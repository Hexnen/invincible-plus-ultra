/* Tactical combat, the surfaces: THE FIXED PLACES, the frame both surfaces read (U132; slots-pure.mjs has the geometry). The dock works
   the frame out when it places itself (dock.mjs, through ui/settle.mjs) and keeps it here; the GM desk reads its part (desk.mjs). */
let cur = null;
export const frameNow = () => cur;
export function setFrame(f) { try { cur = f && typeof f === "object" ? f : null; } catch { cur = null; } }
