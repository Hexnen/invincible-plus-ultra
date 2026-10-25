/* Activity log UI: the three DialogV2 prompts of the maintenance window (trim, delete a log, import a file). Rules (spec 16): the SAFE button owns the default
   focus and Enter; every button callback returns an explicit RESULT OBJECT ({action: "..."}), never a bare string, so the action NAME that DialogV2 returns for a
   null callback result, and null for the window's X, can never be mistaken for a confirmation: only `result?.go === true` counts. The destructive prompts name the
   object and the consequence on the button, and offer a JSON download BEFORE anything is removed. */
import { t, tn } from "../lang.mjs";
import * as Maint from "../maint.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const dayOf = (ms) => { try { return new Date(ms).toLocaleDateString(game.i18n.lang === "pl" ? "pl-PL" : "en-GB"); } catch { return ""; } };
const DV2 = () => foundry.applications.api.DialogV2;

async function ask(cfg) {
  try { return await DV2().wait({ rejectClose: false, modal: true, classes: ["ipl-dialog"], position: { width: 500 }, ...cfg }); } catch { return null; }
}
const cancelBtn = () => ({ action: "cancel", label: t("IPL.Dlg.Cancel"), icon: "fa-solid fa-xmark", default: true, callback: () => ({ go: false }) });

/** Trim prompt. Resolves {go: true, keep, backup} or null. */
export async function trimDialog(row, saveFile) {
  const start = Math.max(1, row.cap > 0 ? row.cap : Math.floor(row.count / 2) || 1);
  const prev = (keep) => Maint.trimPreview(row.actorId, { keep });
  const content = `<p>${esc(t("IPL.Trim.Lede"))}</p>
    <p class="ipl-dlg-now">${esc(t("IPL.Trim.Holds", { entries: tn("IPL.Plural.Entries", row.count), chunks: tn("IPL.Plural.Chunks", row.chunks) }))}</p>
    <div class="ipl-dlg-field"><label for="ipl-trim-keep">${esc(t("IPL.Trim.Keep"))}</label><input id="ipl-trim-keep" name="keep" type="number" min="1" max="50000" step="1" inputmode="numeric" value="${start}"></div>
    <p class="ipl-dlg-will" role="status" aria-live="polite"></p>
    <label class="ipl-dlg-check"><input type="checkbox" name="backup" checked> <span>${esc(t("IPL.Trim.Export"))}</span></label>`;
  let goBtn = null;
  const out = await ask({
    window: { title: t("IPL.Trim.Title", { name: row.name }), icon: "fa-solid fa-scissors" }, content,
    buttons: [
      { action: "trim", label: t("IPL.Trim.Go", { entries: "…" }), icon: "fa-solid fa-scissors", callback: (_ev, button) => {
        const f = button.form.elements, keep = Math.floor(Number(f.keep.value));
        return Number.isFinite(keep) && keep > 0 ? { go: true, keep, backup: !!f.backup.checked } : { go: false };
      } },
      cancelBtn()
    ],
    render: (_ev, dialog) => {
      const el = dialog.element, input = el.querySelector("[name=keep]"), will = el.querySelector(".ipl-dlg-will");
      goBtn = el.querySelector('[data-action="trim"]');
      const upd = () => {
        const keep = Math.floor(Number(input.value));
        if (!(keep > 0)) { will.textContent = t("IPL.Trim.Bad"); goBtn.setAttribute("aria-disabled", "true"); goBtn.disabled = true; return; }
        const p = prev(keep);
        if (p.noop) { will.textContent = t("IPL.Trim.Nothing"); goBtn.disabled = true; goBtn.setAttribute("aria-disabled", "true"); goBtn.lastChild.textContent = t("IPL.Trim.Go", { entries: tn("IPL.Plural.Entries", 0) }); return; }
        will.textContent = t("IPL.Trim.Will", { entries: tn("IPL.Plural.Entries", p.entries), pages: tn("IPL.Plural.Chunks", p.pages), first: dayOf(p.first), last: dayOf(p.last), remain: tn("IPL.Plural.Entries", p.remain) })
          + (p.secretEntries ? ` ${t("IPL.Trim.Secret", { entries: tn("IPL.Plural.Entries", p.secretEntries) })}` : "");
        goBtn.disabled = false; goBtn.removeAttribute("aria-disabled");
        goBtn.lastChild.textContent = t("IPL.Trim.Go", { entries: tn("IPL.Plural.Entries", p.entries) });
      };
      input.addEventListener("input", upd); upd();
    }
  });
  if (out?.go !== true) return null;
  if (out.backup) { try { saveFile(Maint.exportLog(row.actorId, "json")); } catch (e) { console.warn("invincible-plus-ultra | log backup failed, trim cancelled", e); ui.notifications?.error(t("IPL.UI.ExportFailed")); return null; } }
  return out;
}

/** Delete-a-log prompt. Resolves {go: true, backup} or null. */
export async function deleteDialog(row, saveFile) {
  const secret = row.secretCount ? t("IPL.Del.SecretPart", { entries: tn("IPL.Plural.Entries", row.secretCount) }) : "";
  const content = `<p>${esc(t("IPL.Del.Lede", { entries: tn("IPL.Plural.Entries", row.count), secret }))}</p>
    <p class="ipl-dlg-warn">${esc(t(row.orphan ? "IPL.Del.Orphan" : "IPL.Del.Live", { name: row.name }))}</p>
    <label class="ipl-dlg-check"><input type="checkbox" name="backup" checked> <span>${esc(t("IPL.Del.Backup"))}</span></label>`;
  const out = await ask({
    window: { title: t("IPL.Del.Title", { name: row.name }), icon: "fa-solid fa-trash" }, content,
    buttons: [
      { action: "delete", label: t("IPL.Del.Go", { name: row.name }), icon: "fa-solid fa-trash", class: "ipl-danger", callback: (_ev, button) => ({ go: true, backup: !!button.form.elements.backup.checked }) },
      cancelBtn()
    ]
  });
  if (out?.go !== true) return null;
  if (out.backup) { try { saveFile(Maint.exportLog(row.actorId, "json")); } catch (e) { console.warn("invincible-plus-ultra | log backup failed, delete cancelled", e); ui.notifications?.error(t("IPL.UI.ExportFailed")); return null; } }
  return out;
}

/** Import prompt: choose a file, see exactly what would happen, confirm. `target` = log id of the row it was started from, or null. Resolves {go: true, text, fileName} or null. */
export async function importDialog(target, name) {
  const content = `<p>${esc(t("IPL.Imp.Lede"))}</p>
    <div class="ipl-dlg-field"><label for="ipl-imp-file">${esc(t("IPL.Imp.File"))}</label><input id="ipl-imp-file" name="file" type="file" accept=".json,application/json"></div>
    <div class="ipl-dlg-will" role="status" aria-live="polite"></div>
    <p class="ipl-dlg-now">${esc(t("IPL.Imp.Note"))}</p>`;
  let picked = null;
  const out = await ask({
    window: { title: name ? t("IPL.Imp.TitleInto", { name }) : t("IPL.Imp.Title"), icon: "fa-solid fa-file-import" }, content, position: { width: 560 },
    buttons: [
      { action: "import", label: t("IPL.Imp.Go", { entries: "…" }), icon: "fa-solid fa-file-import", callback: () => (picked ? { go: true, text: picked.text, fileName: picked.fileName } : { go: false }) },
      cancelBtn()
    ],
    render: (_ev, dialog) => {
      const el = dialog.element, input = el.querySelector("[name=file]"), will = el.querySelector(".ipl-dlg-will"), go = el.querySelector('[data-action="import"]');
      const lock = (label) => { go.disabled = true; go.setAttribute("aria-disabled", "true"); go.lastChild.textContent = label; };
      lock(t("IPL.Imp.Go", { entries: tn("IPL.Plural.Entries", 0) }));
      input.addEventListener("change", async () => {
        picked = null; will.replaceChildren(); lock(t("IPL.Imp.Go", { entries: tn("IPL.Plural.Entries", 0) }));
        const file = input.files?.[0]; if (!file) return;
        will.textContent = t("IPL.Imp.Reading");
        if (file.size > 8 * 1024 * 1024) { will.textContent = `${t("IPL.Imp.Refused")}: ${t("IPL.Val.tooBigFile")}`; return; }     // refuse before reading it into memory
        let text; try { text = await file.text(); } catch { will.textContent = t("IPL.Imp.Refused"); return; }
        let pv; try { pv = Maint.previewImport(text, { target, fileName: file.name }); } catch (e) { will.textContent = `${t("IPL.Imp.Refused")}`; return; }
        will.replaceChildren();
        const add = (cls, txt) => { const p = document.createElement("p"); if (cls) p.className = cls; p.textContent = txt; will.append(p); };
        if (!pv.ok) { add("ipl-dlg-warn", `${t("IPL.Imp.Refused")}: ${pv.errors.map((e) => t(e.key)).join(" ")}`); return; }
        let total = 0;
        for (const it of pv.items) {
          add("", t("IPL.Imp.Line", { name: it.name, fresh: it.plan.fresh, present: it.plan.present, invalid: it.plan.invalid }));
          if (it.plan.foreign) add("ipl-dlg-now", t("IPL.Imp.Foreign", { from: it.fileActor?.name || "?", name: it.name }));
          total += it.plan.fresh;
        }
        for (const s of pv.skipped) add("ipl-dlg-warn", t(s.why === "noTarget" ? "IPL.Imp.SkipNoTarget" : s.why === "noMember" ? "IPL.Imp.SkipNoMember" : "IPL.Imp.SkipScope", { name: s.name }));
        if (!total) { add("ipl-dlg-now", t("IPL.Imp.Nothing")); return; }
        picked = { text, fileName: file.name };
        go.disabled = false; go.removeAttribute("aria-disabled"); go.lastChild.textContent = t("IPL.Imp.Go", { entries: tn("IPL.Plural.Entries", total) });
      });
    }
  });
  return out?.go === true ? out : null;
}
