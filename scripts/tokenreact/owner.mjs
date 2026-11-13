/* LTOK: who letters a change over a token on THIS client. While token reactions run here (the client setting is on and the lettering
   engine answered), the tactical fight's plain numbers over tokens (tactics/ui/feedback.mjs, U56) leave the Health / Resolve losses and
   "Broken" to them, so one change is said once. Plain state, no Foundry. */
let on = false;
export function setOn(v) { on = !!v; }
export const isOn = () => on;
/** a float of tactics/ui/feedback-pure.mjs floats() that token reactions say instead */
export const claims = (f) => on && !!f && ((!!f.loss && !!f.num) || f.state === "broken");
