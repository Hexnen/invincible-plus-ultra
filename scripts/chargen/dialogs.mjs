/* Character generator: the ONE confirm dialog every chargen window uses (close with a draft, undo the last generation, replace the archetype defaults).
   Rules (phase 7): classes ["ipc-dialog"] (the module's comic skin; the default button is styled by `:is([autofocus], .default, [data-default])` because
   DialogV2 marks its default button with the autofocus ATTRIBUTE, not with a class); the SAFE answer is always the default (focused and yellow), so Enter
   keeps the work; Escape and the window X resolve to "no"; focus goes back to the control that opened the dialog; non-modal like the other module dialogs
   (the wizard behind stays reachable, the dialog is a small floating window). Returns true only when the user pressed the "yes" button. */
import { esc } from "./steps/util.mjs";

export async function confirmDialog({ title, icon = "fa-solid fa-triangle-exclamation", body, yes, no, danger = false }) {
  const { DialogV2 } = foundry.applications.api;
  const opener = document.activeElement;
  let answer = false;
  try {
    answer = await DialogV2.confirm({
      window: { title, icon },
      classes: ["ipc-dialog", ...(danger ? ["ipc-dialog-danger"] : [])],
      content: `<p>${esc(body)}</p>`,
      yes: { label: yes },
      no: { label: no, default: true },
      rejectClose: false, modal: false
    });
  } finally {
    requestAnimationFrame(() => { try { if (opener?.isConnected && typeof opener.focus === "function") opener.focus({ preventScroll: true }); } catch { /* the control is gone */ } });
  }
  return answer === true;
}
