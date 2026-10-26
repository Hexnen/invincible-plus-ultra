/* End-of-session panel, phase S3: the DIALOGS. Rules of the module (base-spec 16): the SAFE button owns the default / initial focus and Enter; the confirm button keeps
   the yellow plate through .ips-primary; every confirm names the object and the consequence; the callbacks return EXPLICIT result objects ({ go: true }), never a
   truthy string, because DialogV2.wait() resolves the action NAME when a callback returns nothing (handoff lead TODO: the "Keep" == truthy bug). Only
   `res.go === true` counts as yes; a closed window, Escape and every other value are a no. */
import { t } from "../lang.mjs";
import { esc, iso } from "./dom.mjs";

const D = () => foundry.applications.api.DialogV2;
const CLASSES = ["ips-dialog", "ips-dialog-safe"];

async function ask({ title, icon, content, buttons, width = 460 }) {
  try {
    const res = await D().wait({
      window: { title, icon: icon ?? "fa-solid fa-flag-checkered" }, classes: CLASSES, position: { width }, content: `<div class="ips-dlg">${content}</div>`,
      buttons, rejectClose: false, modal: false
    });
    return res && typeof res === "object" ? res : null;
  } catch (e) { console.warn("invincible-plus-ultra | session dialog failed", e); return null; }
}
const safe = (action, label, extra = {}) => ({ action, label, default: true, callback: () => ({ go: false, ...extra }) });
const confirmBtn = (action, label, cb) => ({ action, label, class: "ips-primary", callback: cb ?? (() => ({ go: true })) });

/** Plain yes / no. `body` is already-escaped HTML. Resolves true only on the confirm button. */
export async function confirm({ title, body, html = null, go, keep, icon, danger = false }) {
  const res = await ask({ title, icon, content: html ?? `<p class="ips-dlg-lede">${body}</p>`, buttons: [safe("keep", keep), { ...confirmBtn("go", go), class: danger ? "ips-primary ips-danger" : "ips-primary" }] });
  return res?.go === true;
}

/** Award confirm: lists the LIVE before -> after of every hero. Resolves { go, chat } (go false on anything but the confirm button). */
export async function confirmAward({ rows, skipped = [], chat = false }) {
  const list = rows.map((r) => `<li>${esc(t("IPL.Session.UI.Award.row", { name: iso(r.name), before: r.before, after: r.after }))}</li>`).join("");
  const skip = skipped.length ? `<p class="ips-dlg-warn">${esc(t("IPL.Session.UI.Award.skipped", { names: skipped.map(iso).join(", ") }))}</p>` : "";
  const res = await ask({
    title: t("IPL.Session.UI.Award.title"), icon: "fa-solid fa-trophy",
    content: `<p class="ips-dlg-lede">${esc(t("IPL.Session.UI.Award.body", { n: rows.length }))}</p><ul class="ips-dlg-list">${list}</ul>${skip}`
      + `<label class="ips-dlg-check"><input type="checkbox" name="chat"${chat ? " checked" : ""}> <span>${esc(t("IPL.Session.UI.Award.chat"))}</span></label>`,
    buttons: [
      safe("cancel", t("IPL.Session.UI.Award.cancel")),
      confirmBtn("go", t("IPL.Session.UI.Award.go"), (_ev, button) => ({ go: true, chat: button.form?.elements?.chat?.checked === true }))
    ]
  });
  return res?.go === true ? { go: true, chat: res.chat === true } : { go: false, chat: false };
}

export const confirmUndo = (rows) => confirm({
  title: t("IPL.Session.UI.Undo.title"), icon: "fa-solid fa-rotate-left", go: t("IPL.Session.UI.Undo.go"), keep: t("IPL.Session.UI.Undo.keep"), danger: true,
  html: `<p class="ips-dlg-lede">${esc(t("IPL.Session.UI.Undo.body"))}</p><ul class="ips-dlg-list">${rows.map((r) => `<li>${esc(t("IPL.Session.UI.Award.row", { name: iso(r.name), before: r.after, after: r.before }))}</li>`).join("")}</ul>`
});

/** Drifted heroes after a strict undo. Resolves "relative" or "leave". */
export async function confirmDrift(rows) {
  const list = rows.map((r) => `<li>${esc(t("IPL.Session.UI.Undo.drift.row", { name: iso(r.name), current: r.current ?? "?", expected: r.expected }))}</li>`).join("");
  const res = await ask({
    title: t("IPL.Session.UI.Undo.drift.title"), icon: "fa-solid fa-triangle-exclamation",
    content: `<p class="ips-dlg-lede">${esc(t("IPL.Session.UI.Undo.drift.body"))}</p><ul class="ips-dlg-list">${list}</ul>`,
    buttons: [safe("leave", t("IPL.Session.UI.Undo.drift.leave"), { mode: "leave" }), confirmBtn("relative", t("IPL.Session.UI.Undo.drift.relative"), () => ({ go: true, mode: "relative" }))]
  });
  return res?.go === true && res.mode === "relative" ? "relative" : "leave";
}

export const confirmLean = (n) => confirm({
  title: t("IPL.Session.UI.Lean.title"), icon: "fa-solid fa-thumbs-up", go: t("IPL.Session.UI.Lean.go"), keep: t("IPL.Session.UI.Award.cancel"), body: esc(t("IPL.Session.UI.Lean.body", { n }))
});
export const confirmDiscard = () => confirm({
  title: t("IPL.Session.UI.Discard.title"), icon: "fa-solid fa-trash", go: t("IPL.Session.UI.Discard.go"), keep: t("IPL.Session.UI.Discard.keep"), danger: true, body: esc(t("IPL.Session.UI.Discard.body"))
});

/** Choose one of options [{ id, name }]. Resolves the id or null. `none` is shown (with only an OK) when the list is empty. */
export async function pickHero({ title, icon, options, go, body = "", none = "" }) {
  if (!options.length) {
    await ask({ title, icon, content: `<p class="ips-dlg-lede">${esc(none)}</p>`, buttons: [safe("ok", t("IPL.Session.UI.Close"))] });
    return null;
  }
  const opts = options.map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join("");
  const res = await ask({
    title, icon,
    content: (body ? `<p class="ips-dlg-lede">${esc(body)}</p>` : "") + `<label class="ips-dlg-field"><span>${esc(t("IPL.Session.UI.AddHero.select"))}</span><select name="hero">${opts}</select></label>`,
    buttons: [safe("cancel", t("IPL.Session.UI.Award.cancel")), confirmBtn("go", go, (_ev, button) => ({ go: true, id: button.form?.elements?.hero?.value ?? null }))]
  });
  return res?.go === true && typeof res.id === "string" && options.some((o) => o.id === res.id) ? res.id : null;
}
