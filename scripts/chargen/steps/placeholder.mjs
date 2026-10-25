/* PLACEHOLDER step body (phase 4): a readable summary of the current values plus a note that the controls come later.
   Phases 5a-5f replace the file of their step with a real module (see the interface in steps/index.mjs); nothing else changes. */
import { t } from "../lang.mjs";
import { summaryRows } from "./summary.mjs";
import { dl, esc } from "./util.mjs";

export function placeholder(id, icon) {
  return {
    id,
    icon,
    render(ctx) {
      return `<p class="ipc-note-box">${esc(t("IPC.Placeholder.Note"))}</p>${dl(summaryRows(id, ctx.state))}`;
    }
  };
}
