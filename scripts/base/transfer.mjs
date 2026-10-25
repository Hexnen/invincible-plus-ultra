/* Team & Base card: EXPORT / IMPORT, DUPLICATE, SAFE DELETE and the public SUMMARY (phase B9). Foundry side of xfer-pure.mjs (the pure part is node-tested).
   All of it is staff only (GM / assistant): a file carries crate snapshots and member names, an import creates a world actor and links heroes.
   Export  -> one JSON file (xfer-pure.mjs: normalized card data, no book text, members by id / uuid / name, vehicle references).
   Import  -> a NEW base actor in "Team bases"; heroes are found by uuid, id, then a unique name and are linked only when they are in no other base;
              vehicles are kept when the actor exists, found again by a unique name, else removed from the list; the result dialog says what could not be remapped.
   Duplicate -> the same path without members (a clone starts empty and public to nobody but the GM and its future heroes' owners).
   Delete  -> a confirm that names the consequences and offers a backup file first.
   Summary -> one compact chat card, only when the GM clicks it. */
import * as S from "./store.mjs";
import * as P from "./pure.mjs";
import * as X from "./xfer-pure.mjs";
import { t, tn } from "./lang.mjs";
import { esc, guard, reportError } from "./util.mjs";

const MOD = S.MODULE_ID;
const { DialogV2 } = foundry.applications.api;
const version = () => game.modules.get(MOD)?.version ?? "";

/* ------------------------------------------------------------------ export */
/** The export document of a base (staff only). */
export function exportDoc(ref) {
  S.assertStaff();
  const e = S.resolve(ref);
  const members = S.members(e, { all: true }).map((a) => ({ id: a.id, uuid: a.uuid, name: a.name }));
  return X.buildExport({ B: S.rawData(e), name: e.name, img: S.view(e).img, members, moduleVersion: version(), now: Date.now() });
}
/** Download the export as a file. Returns the document. */
export function exportToFile(ref) {
  const doc = exportDoc(ref);
  foundry.utils.saveDataToFile(JSON.stringify(doc, null, 2), "application/json", X.fileName(doc.name));
  return doc;
}

/* ------------------------------------------------------------------ import */
function findHero(m) {
  let a = null;
  if (m.uuid) { try { a = fromUuidSync(m.uuid, { strict: false }); } catch { a = null; } }
  if (!a || a.documentName !== "Actor" || a.type !== "superhero" || a.pack) a = null;
  if (!a && m.id) { const x = game.actors.get(m.id); if (x?.type === "superhero") a = x; }
  if (!a && m.name) { const list = game.actors.filter((x) => x.type === "superhero" && x.name === m.name); if (list.length === 1) a = list[0]; }
  return a;
}
const heroFor = (m) => {
  const a = findHero(m);
  if (!a) return null;
  return S.linkOf(a) && S.cardById(S.linkOf(a)) ? "other" : { id: a.id, name: a.name };
};
function vehicleFor(v) {
  let a = null;
  if (v.uuid) { try { a = fromUuidSync(v.uuid, { strict: false }); } catch { a = null; } }
  const ok = (x) => x?.documentName === "Actor" && x.type === "vehicle" && !S.isCard(x) && !x.pack;
  if (!ok(a)) { const list = game.actors.filter((x) => ok(x) && x.name === v.name); a = list.length === 1 ? list[0] : null; }
  return a ? { uuid: a.uuid, name: a.name, img: a.img ?? "" } : null;
}

/** Create a new base from an export (text or object). opts { members:false (duplicate: no heroes), keepVehicles, name }. Staff only.
    -> { team (view), name, report }; throws BaseError("importFailed") for a bad file and removes a half-made base when the write fails. */
export async function importDoc(input, opts = {}, { user = game.user } = {}) {
  S.assertStaff(user);
  const parsed = X.parseImport(input);
  if (!parsed.ok) {
    const first = parsed.problems.find((p) => p.level === "error") ?? parsed.problems[0];
    throw new S.BaseError("importFailed", { reason: first ? t(first.key, first.params) : "" });
  }
  const plan = X.planImport(parsed.doc, {
    hero: opts.members === false ? () => "skip" : heroFor, vehicle: opts.keepVehicles ? (v) => v : vehicleFor,
    userId: user.id, now: Date.now(), name: opts.name
  });
  const report = { ...plan.report, warnings: parsed.problems.filter((p) => p.level === "warn"), imgMissing: false, linkFailed: [] };
  const team = await S.createLocal({ name: plan.name, rank: plan.B.rank }, user);
  try {
    const B = plan.B;
    const patch = { motto: B.motto, purpose: B.purpose, background: B.background, base: B.base, policy: B.policy };
    for (const c of P.COLLECTIONS) patch[c] = B[c];
    if (plan.img) { let ok = false; try { ok = await foundry.utils.srcExists(plan.img); } catch { ok = false; } if (ok) patch.img = plan.img; else report.imgMissing = true; }
    await S.update(team.id, patch, { user });
  } catch (err) {
    try { await S.remove(team.id); } catch (_) { /* nothing more to do */ }
    throw err;
  }
  for (const id of plan.link) {
    try { await S.link(id, team.id, { user }); } catch (err) { report.linkFailed.push(game.actors.get(id)?.name ?? id); console.warn(`${MOD} | base import: cannot link ${id}`, err); }
  }
  report.linked = report.linked.filter((n) => !report.linkFailed.includes(n));
  return { team: S.get(team.id), name: plan.name, report };
}

const list = (items) => `<ul class="ipb-xf-list">${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
/** The "what happened" dialog after an import. Resolves true when the user asks to open the new card. */
export async function showReport({ team, report }, { title = "IPB.Xfer.ReportTitle" } = {}) {
  const parts = [`<p>${esc(t("IPB.Xfer.Done", { team: team.name }))}</p>`];
  const bit = (key, names) => { if (names.length) parts.push(`<p class="ipb-xf-h">${esc(t(key))}</p>${list(names)}`); };
  if (report.linked.length) parts.push(`<p>${esc(t("IPB.Xfer.Linked", { names: report.linked.join(", ") }))}</p>`);
  bit("IPB.Xfer.Other", report.other);
  bit("IPB.Xfer.Missing", report.missing);
  bit("IPB.Xfer.LinkFailed", report.linkFailed);
  bit("IPB.Xfer.VehiclesDropped", report.vehiclesDropped);
  bit("IPB.Xfer.VehiclesDuplicate", report.vehiclesDuplicate);
  if (report.vehiclesRemapped) parts.push(`<p>${esc(tn("IPB.Xfer.VehiclesRemapped", report.vehiclesRemapped))}</p>`);
  if (report.imgMissing) parts.push(`<p>${esc(t("IPB.Xfer.ImgMissing"))}</p>`);
  for (const w of report.warnings ?? []) parts.push(`<p>${esc(t(w.key, w.params))}</p>`);
  if (parts.length === 1) parts.push(`<p class="ipb-muted">${esc(t("IPB.Xfer.AllMapped"))}</p>`);
  const answer = await DialogV2.wait({
    window: { title: t(title), icon: "fa-solid fa-file-import" }, classes: ["ipb-dialog"], position: { width: 460 },
    content: `<div class="ipb-xf">${parts.join("")}</div>`,
    buttons: [
      { action: "open", label: t("IPB.Xfer.OpenCard"), icon: "fa-solid fa-arrow-up-right-from-square", default: true, callback: () => true },
      { action: "close", label: t("IPB.Xfer.Close"), callback: () => false }
    ],
    rejectClose: false, modal: false
  });
  return answer === true;
}

/** Ask for a file, import it, show the report and open the card when asked. Must be called from a click handler (the file chooser needs the user gesture). */
export function importFromFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      if (file.size > X.MAX_FILE_BYTES) { reportError(new S.BaseError("importFailed", { reason: t("IPB.Xfer.Err.tooBig", { mb: Math.round(X.MAX_FILE_BYTES / 1048576) }) })); return resolve(null); }
      const res = await guard(file.text().then((text) => importDoc(text)));
      if (!res) return resolve(null);
      resolve(res);
      if (await showReport(res)) { const { open } = await import("./entry.mjs"); open(res.team.id); }
    }, { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

/* ------------------------------------------------------------------ duplicate */
/** A copy of the base without members (and so without any hero-based ownership). Staff only. */
export async function duplicate(ref) {
  S.assertStaff();
  const doc = exportDoc(ref);
  const res = await importDoc(doc, { members: false, keepVehicles: true, name: t("IPB.Xfer.CopyName", { name: doc.name }) });
  ui.notifications?.info(t("IPB.Xfer.Duplicated", { team: res.team.name }), { console: false });
  return res;
}

/* ------------------------------------------------------------------ safe delete */
/** Confirm (naming the consequences, offering a backup file), then delete. Resolves true when the base was deleted. Staff only. */
export async function confirmDelete(ref) {
  S.assertStaff();
  const e = S.resolve(ref);
  const team = S.view(e);
  const heroes = S.members(e, { all: true });
  const im = X.deleteImpact(P.normalize(S.rawData(e)), heroes.map((h) => h.name));
  const lines = [];
  if (im.heroes) lines.push(tn("IPB.Del.Heroes", im.heroes, { names: heroes.map((h) => h.name).join(", ") }));
  const own = [im.upgrades && tn("IPB.Del.Upgrades", im.upgrades), im.events && tn("IPB.Del.Events", im.events), im.crate && tn("IPB.Del.Crate", im.crate), im.trackers && tn("IPB.Del.Trackers", im.trackers)].filter(Boolean);
  lines.push(own.length ? t("IPB.Del.Goes", { what: own.join(", ") }) : t("IPB.Del.Empty"));
  if (im.vehicles) lines.push(tn("IPB.Del.Vehicles", im.vehicles));
  const out = await DialogV2.wait({
    window: { title: t("IPB.Del.Title", { team: team.name }), icon: "fa-solid fa-trash" }, classes: ["ipb-dialog"], position: { width: 480 },
    content: `<p>${esc(t("IPB.Del.Lede", { team: team.name }))}</p>${list(lines)}`
      + `<label class="ipb-radio"><input type="checkbox" name="backup" checked> <span>${esc(t("IPB.Del.Backup"))}</span></label>`,
    buttons: [
      { action: "delete", label: t("IPB.Pick.DeleteYes", { team: team.name }), icon: "fa-solid fa-trash", callback: (_ev, button) => ({ del: true, backup: !!button.form?.elements?.backup?.checked }) },
      { action: "keep", label: t("IPB.Pick.DeleteNo"), default: true, callback: () => ({ del: false }) }
    ],
    rejectClose: false, modal: false
  });
  if (out?.del !== true) return false;                    // DialogV2 answers the action NAME ("keep") for a null callback result, and null for the window's X: only an explicit delete counts
  if (out.backup) { try { exportToFile(e); } catch (err) { reportError(err); return false; } }          // no backup, no delete: the user asked for both
  const ok = await guard(S.remove(e));
  return ok === true;
}

/* ------------------------------------------------------------------ summary to chat */
/** One compact public chat card of the team (members, base, upgrades, vehicles). No book text. Staff only; posts only when called. */
export async function postSummary(ref, { user = game.user } = {}) {
  S.assertStaff(user);
  const e = S.resolve(ref);
  const B = S.data(e);
  const heroes = S.members(e, { all: true });
  const lost = B.base.occupied;
  const ups = P.sortedList(B.upgrades).map((u) => {
    const st = lost ? "lost" : u.status;
    return P.formatUpgrade(u) + (st === "active" ? "" : ` (${t(`IPB.Status.${st}`)})`);
  });
  const veh = P.sortedList(B.vehicles).map((v) => v.name + (v.primary ? ` (${t("IPB.Sum.Primary")})` : ""));
  const where = [B.base.kind, B.base.where].map((s) => String(s ?? "").trim()).filter(Boolean).join(", ");
  const sec = (key, items) => `<p class="ipb-chat-h"><strong>${esc(t(key))}</strong></p>${items.length ? `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p>${esc(t("IPB.Sum.None"))}</p>`}`;
  const content = `<div class="ipb-chat ipb-chat-sum" data-team="${esc(e.id)}"><h3>${esc(t("IPB.Sum.Title", { team: B.name }))}</h3>`
    + `<p>${esc(t("IPB.Sum.Rank", { rank: t(`IPB.Rank.${B.rank}`) }))}${where ? ` - ${esc(where)}` : ""}</p>`
    + (B.motto ? `<p><em>${esc(B.motto)}</em></p>` : "")
    + (lost ? `<p><strong>${esc(t("IPB.Sum.Occupied"))}</strong></p>` : "")
    + sec("IPB.Sum.Members", heroes.map((h) => h.name)) + sec("IPB.Sum.Upgrades", ups) + (veh.length ? sec("IPB.Sum.Vehicles", veh) : "")
    + `<button type="button" data-action="ipb-open-team" data-team="${esc(e.id)}">${esc(t("IPB.Chat.Open"))}</button></div>`;
  const msg = await ChatMessage.create({ content, speaker: ChatMessage.getSpeaker({ user }), author: user.id, flags: { [MOD]: { baseSummary: { team: e.id } } } });
  ui.notifications?.info(t("IPB.Sum.Posted", { team: B.name }), { console: false });
  return msg;
}
