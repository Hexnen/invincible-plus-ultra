/* Character generator: the ONE confirm dialog every chargen window uses (close with a draft, undo the last generation, replace the archetype defaults).
   Rules (phase 7): classes ["ipc-dialog"] (the module's comic skin; the default button is styled by `:is([autofocus], .default, [data-default])` because
   DialogV2 marks its default button with the autofocus ATTRIBUTE, not with a class); the SAFE answer is always the default (focused and yellow), so Enter
   keeps the work; Escape and the window X resolve to "no"; focus goes back to the control that opened the dialog; non-modal like the other module dialogs
   (the wizard behind stays reachable, the dialog is a small floating window). Returns true only when the user pressed the "yes" button.
   Phase 9: `html` = a ready-made, already escaped HTML string appended under the body text (the undo drift list); confirmUndo() is the one place that
   asks about undoing a generation (3-dot menu and result view) and runs api.apply.undo with the drift confirmation the apply layer demands. */
import { t } from "./lang.mjs";
import { esc, attrLabel } from "./steps/util.mjs";

export async function confirmDialog({ title, icon = "fa-solid fa-triangle-exclamation", body, html = "", yes, no, danger = false }) {
  const { DialogV2 } = foundry.applications.api;
  const opener = document.activeElement;
  let answer = false;
  try {
    answer = await DialogV2.confirm({
      window: { title, icon },
      classes: ["ipc-dialog", ...(danger ? ["ipc-dialog-danger"] : [])],
      content: `<p>${esc(body)}</p>${html}`,
      yes: { label: yes },
      no: { label: no, default: true },
      rejectClose: false, modal: false
    });
  } finally {
    requestAnimationFrame(() => { try { if (opener?.isConnected && typeof opener.focus === "function") opener.focus({ preventScroll: true }); } catch { /* the control is gone */ } });
  }
  return answer === true;
}

const FIELD_LABEL = { name: "name" };
function fieldLabel(path) {
  const m = path.match(/^system\.attributes\.(\w+)\.value$/);
  if (m) return attrLabel(m[1]);
  if (path === "system.derived.health.value") return t("IPC.Preview.Health");
  if (path === "system.derived.resolve.value") return t("IPC.Preview.Resolve");
  const k = FIELD_LABEL[path] ?? path.replace(/^system\./, "");
  const key = `IPC.Field.${k}`;
  const label = t(key);
  return label === key ? k : label;
}
const show = (v) => (v === "" || v === null || v === undefined ? "-" : String(v));
const when = (ms) => { try { return new Date(ms).toLocaleString(globalThis.game?.i18n?.lang ?? undefined, { dateStyle: "medium", timeStyle: "short" }); } catch { return String(ms); } };

/** the dialog body for an undo: age + exactly what changed since the generation (apply.undoStatus) */
export function undoDialogParts(actor, st) {
  const lines = [`<p class="ipc-undo-when">${esc(t("IPC.Undo.When", { when: when(st.at) }))}</p>`];
  const d = st.drift ?? {};
  if (st.clean) lines.push(`<p>${esc(t("IPC.Undo.Clean"))}</p>`);
  else if (st.unknown) lines.push(`<p class="ipc-undo-warn">${esc(t("IPC.Undo.Unknown"))}</p>`);
  else {
    lines.push(`<p class="ipc-undo-warn"><b>${esc(t("IPC.Undo.Drift"))}</b></p>`);
    if (d.fields?.length) {
      // the value that undo will write back is the pre-generation one, shown as "now -> before" would need the backup; "now" is what is lost
      lines.push(`<p class="ipc-undo-h">${esc(t("IPC.Undo.Fields"))}</p><ul class="ipc-undo-list">${d.fields.map((f) => `<li><b>${esc(fieldLabel(f.path))}</b>: ${esc(show(f.now))}</li>`).join("")}</ul>`);
    }
    for (const [k, key] of [["itemsEdited", "IPC.Undo.Edited"], ["itemsMissing", "IPC.Undo.Missing"], ["itemsAdded", "IPC.Undo.Added"]]) {
      if (d[k]?.length) lines.push(`<p>${esc(t(key, { list: d[k].join(", ") }))}</p>`);
    }
  }
  return { title: t("IPC.Undo.Title"), body: t("IPC.Header.UndoBody", { actor: actor.name }), html: `<div class="ipc-undo">${lines.join("")}</div>`, yes: st.clean ? t("IPC.Header.UndoYes") : (st.unknown ? t("IPC.Header.UndoYes") : t("IPC.Undo.YesDrift")), no: t("IPC.Header.UndoNo") };
}

/** ask, then undo. Returns { asked:false } when there is nothing to undo, { asked:true, ok:false } when the user said no, else the undo result. */
export async function confirmUndo(actor) {
  const api = game.modules.get("invincible-plus-ultra")?.api?.chargen?.apply;
  const st = api?.undoStatus?.(actor);
  if (!st?.available) return { asked: false, ok: false, expired: !!st?.expired, message: st?.expired ? t("IPC.Undo.Expired") : t("IPC.Header.NoUndo") };
  const parts = undoDialogParts(actor, st);
  const ok = await confirmDialog({ ...parts, icon: "fa-solid fa-rotate-left", danger: true });
  if (!ok) return { asked: true, ok: false, declined: true };
  const res = await api.undo(actor, { confirmDrift: !st.clean });
  return { asked: true, ...res };
}
