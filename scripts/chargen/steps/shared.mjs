/* Pieces shared by the list-heavy steps (powers 5b, talents 5c): the lazy RUNTIME description loader, the description block of a catalogue
   row, the "More / Read in the book" links, removable chips and a name slug. Extracted from powers.mjs without changing its behaviour.
   The per-step cache lives in the step's ctx.data: d.desc (Map uuid -> {short, full, fx}), d.inflight (Map), d.open (Set of expanded uuids).
   Book text is read from the pack documents on demand (fromUuid), shown, cached per window, never stored in the module. */
import { t } from "../lang.mjs";
import { normName } from "../rules.mjs";
import { bonusOfDoc, primeFx } from "../bonuses.mjs";
import { esc, icon } from "./util.mjs";

export const slug = (s) => normName(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** first sentence + full plain text of an item description (HTML in, text out) */
export function plain(html) {
  const src = String(html ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@\w+\[[^\]]*\](\{[^}]*\})?/g, "");
  const doc = new DOMParser().parseFromString(src, "text/html");
  const paras = [...doc.body.querySelectorAll("p, li")].filter((e) => !(e.tagName === "LI" && e.querySelector("p"))).map((e) => e.textContent.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!paras.length) { const x = doc.body.textContent.replace(/\s+/g, " ").trim(); if (x) paras.push(x); }
  const first = paras[0] ?? "";
  const m = /^.{30,}?[.!?](\s|$)/.exec(first);
  let short = (m ? m[0] : first).trim();
  if (short.length > 190) short = `${short.slice(0, 187).trim()}...`;
  return { short, full: paras.join("\n").slice(0, 1500) };
}
export const paras = (full) => String(full || "").split("\n").map((p) => `<p>${esc(p)}</p>`).join("");

/** load one description (and the effect bonuses of the same document); safe to call many times */
export function need(d, uuid) {
  if (d.desc.has(uuid)) return Promise.resolve();
  if (d.inflight.has(uuid)) return d.inflight.get(uuid);
  const p = (async () => {
    try {
      const doc = await fromUuid(uuid);
      const fx = bonusOfDoc(doc);
      primeFx(uuid, fx);
      d.desc.set(uuid, { ...plain(doc?.system?.description), fx });
    } catch { d.desc.set(uuid, { short: "", full: "", fx: {} }); } finally { d.inflight.delete(uuid); }
  })();
  d.inflight.set(uuid, p);
  return p;
}

/** write a loaded description into every node waiting for it; `d.fxPaint(fx) -> html` (optional) fills [data-fxfor] nodes */
export function paintDesc(root, d, uuid) {
  const v = d.desc.get(uuid) ?? { short: "", full: "", fx: {} };
  const q = CSS.escape(uuid);
  root.querySelectorAll(`[data-desc="${q}"]`).forEach((n) => { n.textContent = v.short || t("IPC.Powers.NoText"); n.classList.remove("is-loading"); });
  root.querySelectorAll(`[data-full="${q}"]`).forEach((n) => { n.innerHTML = paras(v.full || v.short) || esc(t("IPC.Powers.NoText")); n.classList.remove("is-loading"); });
  if (d.fxPaint) root.querySelectorAll(`[data-fxfor="${q}"]`).forEach((n) => { n.innerHTML = d.fxPaint(v.fx); });
}

/** read the descriptions of the rows currently in the DOM, four at a time */
export async function enrich(root, d) {
  const uuids = [...new Set([...root.querySelectorAll("[data-desc], [data-full]")].map((n) => n.dataset.desc || n.dataset.full))].filter((u) => u && !d.desc.has(u));
  let i = 0;
  const worker = async () => { while (i < uuids.length) { const u = uuids[i++]; await need(d, u); if (!root.isConnected) return; paintDesc(root, d, u); } };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

/** markup of a description block: the short text, or the full text when the row is expanded */
export function descBlock(d, uuid) {
  if (!uuid) return "";
  const v = d.desc.get(uuid), open = d.open.has(uuid);
  if (open) return `<div class="ipc-pw-full${v ? "" : " is-loading"}" data-full="${esc(uuid)}">${v ? paras(v.full || v.short) || esc(t("IPC.Powers.NoText")) : esc(t("IPC.Powers.Loading"))}</div>`;
  return `<p class="ipc-pw-desc${v ? "" : " is-loading"}" data-desc="${esc(uuid)}">${v ? esc(v.short || t("IPC.Powers.NoText")) : esc(t("IPC.Powers.Loading"))}</p>`;
}
export function rowLinks(d, uuid, name) {
  if (!uuid) return "";
  const open = d.open.has(uuid);
  return `<span class="ipc-pw-links"><button type="button" class="ipc-link" data-act="more" data-uuid="${esc(uuid)}" data-fk="more-${esc(slug(name))}-${esc(uuid.slice(-6))}" aria-expanded="${open}">${esc(t(open ? "IPC.Powers.Less" : "IPC.Powers.More"))}</button><button type="button" class="ipc-link" data-act="book" data-uuid="${esc(uuid)}">${icon("fa-solid fa-book-open")} ${esc(t("IPC.Powers.Book"))}</button></span>`;
}

/** removable chip (label is ready HTML) */
export function chip(label, aria, act, attrs, extraCls = "") {
  return `<li class="ipc-chip${extraCls}"><span>${label}</span><button type="button" class="ipc-chip-x" data-act="${act}" ${attrs} aria-label="${esc(aria)}" data-tooltip="${esc(aria)}">${icon("fa-solid fa-xmark")}</button></li>`;
}

/** open the pack item's own sheet (read-only reading of the book entry) */
export async function openBook(uuid) {
  try { const doc = await fromUuid(uuid); doc?.sheet?.render({ force: true }); } catch (err) { console.warn("invincible-plus-ultra | chargen: cannot open", uuid, err); }
}
