/* Team & Base card, phase B8: the REAL "Gear & vehicles" tab (replaces the placeholder). Interface: ./index.mjs (this tab also implements onDrop).
   VEHICLES: world vehicle actors by reference (drop one on the tab, or "Add vehicle" for the keyboard): portrait, name, type, the star = THE team vehicle,
   Passengers / Maneuverability / Speed / Durability / Armour / Cost read LIVE from the vehicle actor, the effective values with the bonuses of the vehicle
   upgrades (Vehicle Defense / Mobility / Room, computed by api.vehicles.stats, primary vehicle only, only ACTIVE upgrades) with an origin chip per upgrade;
   while the base is OCCUPIED the bonuses are suspended (greyed, reason printed). Open sheet, note, remove (undo bar). A compendium vehicle is imported once
   by the GM on drop (never twice: the world copy is found again by its compendium source).
   CRATE: item SNAPSHOTS (api.crate): drop an Item (Items directory, compendium, a hero sheet) or "Add item"; qty stepper, note, filter by text and kind,
   Give to hero / Give to vehicle (DialogV2 that names the consequence, GM or the owner of the target), a drag handle that drags the snapshot out onto a hero
   sheet (a COPY, the crate row stays), remove (undo bar).
   TRACKERS: free named counters with +/- and an optional limit ("team resources", spec Q1): editors add / rename / change / remove.
   Rules of this file: writes only through api.base (crate / vehicles) or ctx.update (notes, trackers); a refused action prints WHY; read-only users get the
   lists, the stats and the notes without any control. Drops arrive through sheet.mjs (_onDropItem / _onDropActor -> onDrop(event, data, ctx)).
   Module-level state (filter, drafts, open boxes, undo) survives the sheet's repaints; listeners are delegated once per panel element. */
import * as P from "../pure.mjs";

const MOD = "invincible-plus-ultra";
const CTX = new WeakMap();                 // panel element -> latest ctx
const BOUND = new WeakSet();               // panel elements with listeners
const ROOTS = new Map();                   // team id -> panel element (for the undo timer)
const filters = new Map();                 // team id -> { q, type }
const drafts = new Map();                  // team id -> { name, max } of the new tracker
const openBoxes = new Set();               // "<team>:<box>" of <details> the user opened
const undoRec = new Map();                 // team id -> { text, patch, timer }
const pendingQty = new Map();              // crate id -> the quantity we already sent (fast repeated clicks)
const busy = new Set();
const UNDO_MS = 10000;
let ownDrag = null;                        // { team } while a crate row of that team is being dragged (a drop on its own tab is ignored)
let dropOwn = null;                        // { team, at }: the crate row that was being dragged at the last drop event

const TYPE_ICON = { gear: "fa-solid fa-toolbox", vehicleWeapon: "fa-solid fa-gun" };
const VTYPE_ICON = { ground: "fa-solid fa-car-side", water: "fa-solid fa-ship", aerial: "fa-solid fa-plane", space: "fa-solid fa-rocket" };
const ST_ICON = { active: "fa-circle-check", installing: "fa-hourglass-half", disabled: "fa-ban", broken: "fa-burst", lost: "fa-lock" };
const VEH_UP = { "vehicle-defense": "defense", "vehicle-mobility": "mobility", "vehicle-room": "room", "vehicle-targeting": "targeting", "vehicle-weaponry": "weaponry" };
const STATS = ["passengers", "maneuverability", "speed", "durability", "armor"];

const pk = (ctx, box) => `${ctx.team.id}:${box}`;
const flt = (id) => filters.get(id) ?? { q: "", type: "all" };

/* ------------------------------------------------------------------ vehicles */
function vehModel(ctx, v) {
  const a = fromUuidSync(v.uuid, { strict: false });
  const exists = !!a && a.documentName === "Actor";
  const visible = exists && (ctx.isStaff || a.testUserPermission(ctx.user, "LIMITED"));
  let info = null;
  try { info = ctx.api.vehicles.stats(ctx.team.id, v.id); } catch { info = null; }          // the row may be gone for a moment
  return {
    v, a, exists, visible, info, occupied: !!ctx.B.base.occupied, primary: !!v.primary,
    name: visible ? a.name : (v.name || "?"), img: visible ? (a.img || v.img) : v.img,
    type: visible ? String(a.system?.type ?? "") : "", cost: visible ? String(a.system?.cost ?? "").trim() : ""
  };
}

function effectText(ctx, kind, count) {
  const { t } = ctx;
  if (kind === "defense") return t("IPB.Gr.Eff.defense", { dur: 2 * count, arm: count });
  if (kind === "mobility") return t("IPB.Gr.Eff.mobility", { n: count });
  return t(`IPB.Gr.Eff.${kind}`);
}
/** one chip per vehicle upgrade the team owns: what it does, or why it does nothing right now (status word, never colour alone) */
function upChips(ctx, m) {
  const { esc, icon, t } = ctx;
  const ups = P.sortedList(ctx.B.upgrades).filter((u) => VEH_UP[u.key]);
  if (!ups.length) return "";
  const items = ups.map((u) => {
    const shown = m.occupied ? "lost" : u.status;
    const on = shown === "active";
    const eff = on ? effectText(ctx, VEH_UP[u.key], u.count) : `${t(`IPB.Status.${shown}`)}, ${t("IPB.Gr.Eff.none")}`;
    return `<li class="ipb-gr-up" data-status="${esc(shown)}">${icon(`fa-solid ${ST_ICON[shown] ?? "fa-circle"}`)}<span class="ipb-gr-up-name">${esc(u.name)}${u.count > 1 ? ` x${u.count}` : ""}</span><span class="ipb-gr-up-eff">${esc(eff)}</span></li>`;
  }).join("");
  return `<div class="ipb-gr-ups-box"><p class="ipb-gr-ups-h">${esc(t("IPB.Gr.UpsH"))}</p><ul class="ipb-gr-ups">${items}</ul></div>`;
}

function statCell(ctx, k, m) {
  const { esc, t } = ctx;
  const label = t(`IPB.Gr.Stat.${k}`);
  if (!m.visible || !m.info) return `<div class="ipb-gr-stat" data-na="true"><dt>${esc(label)}</dt><dd><b>-</b><span class="ipb-sr">${esc(t("IPB.Gr.StatNone"))}</span></dd></div>`;
  const s = m.info.stats[k];
  const bonus = m.primary ? s.bonus : 0;
  const sus = bonus > 0 && m.occupied;
  const total = sus ? s.base : s.base + bonus;
  const sub = bonus > 0 ? (sus ? t("IPB.Gr.StatSuspended", { bonus }) : t("IPB.Gr.StatSum", { base: s.base, bonus })) : "";
  return `<div class="ipb-gr-stat"${sus ? ' data-suspended="true"' : ""}><dt>${esc(label)}</dt><dd><b>${total}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</dd></div>`;
}

function vehRow(ctx, v, list) {
  const { esc, icon, t } = ctx;
  const m = vehModel(ctx, v);
  const nm = m.name;
  const type = m.type && VTYPE_ICON[m.type] ? `<span class="ipb-gr-chip">${icon(VTYPE_ICON[m.type])}<span>${esc(t(`IPB.Gr.VType.${m.type}`))}</span></span>` : "";
  const star = m.primary ? `<span class="ipb-gr-chip ipb-gr-chip-star">${icon("fa-solid fa-star")}<span>${esc(t("IPB.Gr.Star"))}</span></span>` : "";
  const acts = [];
  acts.push(m.visible
    ? `<button type="button" class="ipb-btn ipb-btn-small" data-gr-act="veh-open" data-vid="${esc(v.id)}" data-fk="gr-vo-${esc(v.id)}" aria-label="${esc(t("IPB.Gr.OpenSheetAria", { name: nm }))}">${icon("fa-solid fa-up-right-from-square")}${esc(t("IPB.Gr.OpenSheet"))}</button>`
    : `<button type="button" class="ipb-btn ipb-btn-small" aria-disabled="true" data-gr-act="none" data-fk="gr-vo-${esc(v.id)}" aria-describedby="${esc(ctx.app.id)}-gr-vr-${esc(v.id)}">${icon("fa-solid fa-up-right-from-square")}${esc(t("IPB.Gr.OpenSheet"))}</button>`);
  if (ctx.canEdit) {
    if (!m.primary) acts.push(`<button type="button" class="ipb-btn ipb-btn-small" data-gr-act="veh-primary" data-vid="${esc(v.id)}" data-fk="gr-vp-${esc(v.id)}" aria-pressed="false" aria-label="${esc(t("IPB.Gr.StarMake", { name: nm }))}">${icon("fa-regular fa-star")}${esc(t("IPB.Gr.Star"))}</button>`);
    acts.push(`<button type="button" class="ipb-btn ipb-btn-small" data-gr-act="veh-remove" data-vid="${esc(v.id)}" data-fk="gr-vx-${esc(v.id)}" aria-label="${esc(t("IPB.Gr.RemoveVehAria", { name: nm }))}">${icon("fa-solid fa-trash-can")}${esc(t("IPB.Gr.RemoveVeh"))}</button>`);
  }
  const lines = [];
  if (!m.exists) lines.push(`<p class="ipb-bt-warn" id="${esc(ctx.app.id)}-gr-vr-${esc(v.id)}">${icon("fa-solid fa-triangle-exclamation")}<span>${esc(t("IPB.Gr.Missing"))}</span></p>`);
  else if (!m.visible) lines.push(`<p class="ipb-bt-hint" id="${esc(ctx.app.id)}-gr-vr-${esc(v.id)}">${icon("fa-solid fa-eye-slash")} ${esc(t("IPB.Gr.Unseen"))}</p>`);
  if (m.visible && m.primary && m.occupied && m.info && STATS.some((k) => m.info.stats[k].bonus > 0)) lines.push(`<p class="ipb-bt-warn ipb-gr-sus">${icon("fa-solid fa-lock")}<span>${esc(t("IPB.Gr.Suspended"))}</span></p>`);
  if (m.visible && !m.primary && list.length > 1 && P.sortedList(ctx.B.upgrades).some((u) => VEH_UP[u.key])) lines.push(`<p class="ipb-bt-hint">${icon("fa-solid fa-circle-info")} ${esc(t("IPB.Gr.NotTeamVeh"))}</p>`);
  if (m.visible && m.primary && m.info) {
    const wup = P.sortedList(ctx.B.upgrades).filter((u) => u.key === "vehicle-weaponry").reduce((n, u) => n + u.count, 0);
    if (m.info.weapons || wup) lines.push(`<p class="ipb-bt-hint">${icon("fa-solid fa-gun")} ${esc(t("IPB.Gr.WeaponsLine", { n: m.info.weapons, up: wup }))}</p>`);
  }
  const note = ctx.canEdit
    ? `<details class="ipb-up-notebox" data-gr-box="${esc(pk(ctx, `vn-${v.id}`))}"${v.note || openBoxes.has(pk(ctx, `vn-${v.id}`)) ? " open" : ""}><summary>${icon("fa-solid fa-pen")}<span>${esc(t("IPB.Gr.NoteSummary"))}</span></summary>`
      + `<textarea class="ipb-input ipb-gr-vnote" rows="3" name="ipb-gr-vnote-${esc(v.id)}" data-gr-note="veh" data-id="${esc(v.id)}" maxlength="1000" aria-label="${esc(t("IPB.Gr.NoteLabel", { name: nm }))}" placeholder="${esc(t("IPB.Gr.NotePh"))}">${esc(v.note)}</textarea></details>`
    : (v.note ? `<p class="ipb-up-note-ro">${icon("fa-solid fa-pen")} ${esc(v.note)}</p>` : "");
  const img = m.img ? `<img class="ipb-gr-vimg" src="${esc(m.img)}" alt="" loading="lazy">` : `<span class="ipb-gr-vimg ipb-gr-vimg-none">${icon("fa-solid fa-van-shuttle")}</span>`;
  const cost = m.visible
    ? `<div class="ipb-gr-stat"><dt>${esc(t("IPB.Gr.Stat.cost"))}</dt><dd><b>${esc(m.cost || "-")}</b></dd></div>`
    : `<div class="ipb-gr-stat" data-na="true"><dt>${esc(t("IPB.Gr.Stat.cost"))}</dt><dd><b>-</b><span class="ipb-sr">${esc(t("IPB.Gr.StatNone"))}</span></dd></div>`;
  return `<li class="ipb-gr-veh" data-vid="${esc(v.id)}" data-primary="${m.primary}"${m.exists ? "" : ' data-missing="true"'}>
    <div class="ipb-gr-vtop">${img}
      <div class="ipb-gr-vhead">
        <p class="ipb-gr-vname"><strong>${esc(nm)}</strong>${type}${star}</p>
        <div class="ipb-gr-acts">${acts.join("")}</div>
      </div>
    </div>
    <dl class="ipb-gr-stats">${STATS.map((k) => statCell(ctx, k, m)).join("")}${cost}</dl>
    ${m.primary && m.visible ? upChips(ctx, m) : ""}
    ${lines.join("")}
    ${note}
  </li>`;
}

function pickableVehicles(ctx) {
  const have = new Set(P.sortedList(ctx.B.vehicles).map((v) => v.uuid));
  return game.actors.filter((a) => a.type === "vehicle" && !ctx.api.isCard(a) && !have.has(a.uuid) && (ctx.isStaff || a.testUserPermission(ctx.user, "LIMITED")))
    .sort((x, y) => x.name.localeCompare(y.name));
}

function zoneBox(ctx, kind, textKey, hintKey, pickerHtml) {
  const { esc, icon, t } = ctx;
  const id = `${ctx.app.id}-gr-${kind}`;
  return `<div class="ipb-gr-zone" data-gr-zone="${kind}" role="group" aria-labelledby="${id}-zt" aria-describedby="${id}-zh">
    <div class="ipb-gr-zone-line">${icon("fa-solid fa-arrow-down-to-bracket")}<p class="ipb-gr-zone-t" id="${id}-zt">${esc(t(textKey))}</p>${pickerHtml.summary}</div>
    <p class="ipb-bt-hint ipb-gr-zone-h" id="${id}-zh">${esc(t(hintKey))}</p>
    ${pickerHtml.body}
  </div>`;
}

function vehPicker(ctx) {
  const { esc, icon, t } = ctx;
  const box = pk(ctx, "veh-pick");
  const list = pickableVehicles(ctx);
  const body = list.length
    ? `<div class="ipb-gr-picker"><label class="ipb-field"><span>${esc(t("IPB.Gr.AddVehSelect"))}</span><select class="ipb-input" name="ipb-gr-veh-sel" data-gr-sel="veh" data-fk="gr-veh-sel">${list.map((a) => `<option value="${esc(a.uuid)}">${esc(a.name)}</option>`).join("")}</select></label>`
      + `<button type="button" class="ipb-btn ipb-btn-primary ipb-btn-small" data-gr-act="veh-add" data-fk="gr-veh-add">${icon("fa-solid fa-plus")}${esc(t("IPB.Gr.AddVehYes"))}</button></div>`
    : `<p class="ipb-bt-hint">${esc(t("IPB.Gr.AddVehNone"))}</p>`;
  return {
    summary: "",
    body: `<details class="ipb-gr-pick" data-gr-box="${esc(box)}"${openBoxes.has(box) ? " open" : ""}><summary class="ipb-btn ipb-btn-small">${icon("fa-solid fa-plus")}<span>${esc(t("IPB.Gr.AddVeh"))}</span></summary>${body}</details>`
  };
}

function vehiclesBlock(ctx) {
  const { esc, icon, t } = ctx;
  const list = P.sortedList(ctx.B.vehicles);
  const hid = `${ctx.app.id}-gr-vh`;
  const owns = P.sortedList(ctx.B.upgrades).some((u) => u.key === "team-vehicle");
  const empty = `<p class="ipb-muted ipb-gr-empty">${esc(t(ctx.canEdit ? (owns ? "IPB.Gr.VehEmptyUp" : "IPB.Gr.VehEmptyNo") : "IPB.Gr.VehEmptyRo"))}</p>`;
  return `<section class="ipb-gr-veh-sec" aria-labelledby="${hid}">
    <h2 class="ipb-bt-h" id="${hid}">${esc(t("IPB.Gr.VehH"))}</h2>
    ${list.length ? `<p class="ipb-bt-hint">${esc(t("IPB.Gr.VehHint"))}</p>` : ""}
    ${ctx.canEdit ? zoneBox(ctx, "veh", "IPB.Gr.VehZone", "IPB.Gr.VehZoneHint", vehPicker(ctx)) : ""}
    ${list.length ? `<ul class="ipb-gr-list">${list.map((v) => vehRow(ctx, v, list)).join("")}</ul>` : empty}
  </section>`;
}

/* ------------------------------------------------------------------ crate */
function filterRows(rows, f) {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => (f.type === "all" || r.type === f.type) && (!q || r.name.toLowerCase().includes(q) || r.note.toLowerCase().includes(q)));
}

/** the eligible give targets for a crate row for THIS user (the ops repeat every check) */
function giveTargets(ctx, row) {
  if (!ctx.canEdit) return { list: [], why: "IPB.Gr.GiveNoRight" };
  if (row.type === "gear") {
    const list = ctx.members.filter((a) => ctx.isStaff || a.testUserPermission(ctx.user, "OWNER"));
    return { list, why: "IPB.Gr.GiveNoHero" };
  }
  const list = P.sortedList(ctx.B.vehicles).map((v) => fromUuidSync(v.uuid, { strict: false })).filter((a) => a?.documentName === "Actor" && (ctx.isStaff || a.testUserPermission(ctx.user, "OWNER")));
  return { list, why: "IPB.Gr.GiveNoVeh" };
}

function crateRow(ctx, r) {
  const { esc, icon, t } = ctx;
  const nm = r.name;
  const kindWord = t(`IPB.Gr.Type.${r.type}`);
  const chips = `<span class="ipb-gr-chip">${icon(TYPE_ICON[r.type] ?? "fa-solid fa-box")}<span>${esc(kindWord)}</span></span>`
    + (r.cost !== null ? `<span class="ipb-gr-cost">${esc(t("IPB.Gr.Cost", { cost: r.cost }))}</span>` : "")
    + (r.restricted ? `<span class="ipb-gr-chip ipb-gr-chip-warn">${icon("fa-solid fa-lock")}<span>${esc(t("IPB.Gr.Restricted"))}</span></span>` : "");
  const qty = ctx.canEdit
    ? `<div class="ipb-gr-qty" role="group" aria-label="${esc(t("IPB.Gr.QtyLabel", { name: nm }))}">`
      + `<button type="button" class="ipb-btn ipb-btn-small ipb-btn-icon" data-gr-act="qty-down" data-cid="${esc(r.id)}" data-fk="gr-qd-${esc(r.id)}" aria-label="${esc(t("IPB.Gr.QtyDown", { name: nm }))}"${r.qty <= 1 ? ' aria-disabled="true"' : ""}>${icon("fa-solid fa-minus")}</button>`
      + `<input class="ipb-input" type="number" inputmode="numeric" min="1" max="9999" step="1" name="ipb-gr-qty-${esc(r.id)}" data-gr-qty="${esc(r.id)}" value="${r.qty}" aria-label="${esc(t("IPB.Gr.QtyLabel", { name: nm }))}">`
      + `<button type="button" class="ipb-btn ipb-btn-small ipb-btn-icon" data-gr-act="qty-up" data-cid="${esc(r.id)}" data-fk="gr-qu-${esc(r.id)}" aria-label="${esc(t("IPB.Gr.QtyUp", { name: nm }))}">${icon("fa-solid fa-plus")}</button></div>`
    : `<p class="ipb-gr-qty-ro" aria-label="${esc(t("IPB.Gr.QtyLabel", { name: nm }))}">x ${r.qty}</p>`;
  const acts = [];
  if (ctx.canEdit) {
    const g = giveTargets(ctx, r);
    const isW = r.type === "vehicleWeapon";
    const act = isW ? "give-veh" : "give-hero";
    const label = t(isW ? "IPB.Gr.GiveVeh" : "IPB.Gr.GiveHero");
    const aria = t(isW ? "IPB.Gr.GiveVehAria" : "IPB.Gr.GiveHeroAria", { name: nm });
    const rid = `${ctx.app.id}-gr-gw-${r.id}`;
    acts.push(g.list.length
      ? `<button type="button" class="ipb-btn ipb-btn-small" data-gr-act="${act}" data-cid="${esc(r.id)}" data-fk="gr-g-${esc(r.id)}" aria-label="${esc(aria)}">${icon("fa-solid fa-hand-holding-hand")}${esc(label)}</button>`
      : `<button type="button" class="ipb-btn ipb-btn-small" aria-disabled="true" data-gr-act="none" data-fk="gr-g-${esc(r.id)}" aria-describedby="${esc(rid)}" aria-label="${esc(aria)}">${icon("fa-solid fa-hand-holding-hand")}${esc(label)}</button><span class="ipb-gr-why" id="${esc(rid)}">${esc(t(g.why))}</span>`);
    acts.push(`<button type="button" class="ipb-btn ipb-btn-small" data-gr-act="crate-remove" data-cid="${esc(r.id)}" data-fk="gr-cx-${esc(r.id)}" aria-label="${esc(t("IPB.Gr.RemoveAria", { name: nm }))}">${icon("fa-solid fa-trash-can")}${esc(t("IPB.Gr.Remove"))}</button>`);
  }
  const note = ctx.canEdit
    ? `<details class="ipb-up-notebox" data-gr-box="${esc(pk(ctx, `cn-${r.id}`))}"${r.note || openBoxes.has(pk(ctx, `cn-${r.id}`)) ? " open" : ""}><summary>${icon("fa-solid fa-pen")}<span>${esc(t("IPB.Gr.NoteSummary"))}</span></summary>`
      + `<input class="ipb-input" type="text" name="ipb-gr-cnote-${esc(r.id)}" data-gr-note="crate" data-id="${esc(r.id)}" maxlength="300" value="${esc(r.note)}" aria-label="${esc(t("IPB.Gr.NoteLabel", { name: nm }))}" placeholder="${esc(t("IPB.Gr.NotePh"))}" autocomplete="off"></details>`
    : (r.note ? `<p class="ipb-up-note-ro">${icon("fa-solid fa-pen")} ${esc(r.note)}</p>` : "");
  const img = r.img ? `<img src="${esc(r.img)}" alt="" loading="lazy">` : icon("fa-solid fa-box");
  const grip = ctx.canEdit
    ? `<span class="ipb-gr-grip" draggable="true" data-gr-drag="${esc(r.id)}" data-tooltip="${esc(t("IPB.Gr.GripTip"))}" aria-hidden="true">${img}</span>`
    : `<span class="ipb-gr-grip ipb-gr-grip-ro" aria-hidden="true">${img}</span>`;
  return `<li class="ipb-gr-crow" data-cid="${esc(r.id)}" data-type="${esc(r.type)}">
    ${grip}
    <div class="ipb-gr-cmain">
      <div class="ipb-gr-cline"><p class="ipb-gr-cname"><strong>${esc(nm)}</strong></p>${qty}</div>
      <div class="ipb-gr-cmeta">${chips}</div>
      ${acts.length ? `<div class="ipb-gr-acts">${acts.join("")}</div>` : ""}
      ${note}
    </div>
  </li>`;
}

function crateListHtml(ctx, rows, f) {
  const { esc, t } = ctx;
  const shown = filterRows(rows, f);
  if (!shown.length) return `<p class="ipb-muted" role="status">${esc(t("IPB.Gr.NoMatch"))}</p>`;
  return `<ul class="ipb-gr-list">${shown.map((r) => crateRow(ctx, r)).join("")}</ul>`;
}

/** every gear / vehicle weapon the user could add from the keyboard: the Items directory and the items of the visible heroes */
function pickableItems(ctx) {
  const ok = (i) => P.CRATE_TYPES.includes(i.type) && (ctx.isStaff || i.testUserPermission(ctx.user, "LIMITED"));
  const groups = [];
  const world = game.items.filter(ok).sort((x, y) => x.name.localeCompare(y.name));
  if (world.length) groups.push({ label: ctx.t("IPB.Gr.FromWorld"), items: world });
  for (const a of ctx.members) {
    const mine = a.items.filter((i) => P.CRATE_TYPES.includes(i.type)).sort((x, y) => x.name.localeCompare(y.name));
    if (mine.length) groups.push({ label: ctx.t("IPB.Gr.FromHero", { name: a.name }), items: mine });
  }
  return groups;
}
function itemPicker(ctx) {
  const { esc, icon, t } = ctx;
  const box = pk(ctx, "item-pick");
  const groups = pickableItems(ctx);
  const body = groups.length
    ? `<div class="ipb-gr-picker"><label class="ipb-field"><span>${esc(t("IPB.Gr.AddItemSelect"))}</span><select class="ipb-input" name="ipb-gr-item-sel" data-gr-sel="item" data-fk="gr-item-sel">${groups.map((g) => `<optgroup label="${esc(g.label)}">${g.items.map((i) => `<option value="${esc(i.uuid)}">${esc(i.name)} (${esc(t(`IPB.Gr.Type.${i.type}`))})</option>`).join("")}</optgroup>`).join("")}</select></label>`
      + `<button type="button" class="ipb-btn ipb-btn-primary ipb-btn-small" data-gr-act="item-add" data-fk="gr-item-add">${icon("fa-solid fa-plus")}${esc(t("IPB.Gr.AddItemYes"))}</button></div>`
    : `<p class="ipb-bt-hint">${esc(t("IPB.Gr.AddItemNone"))}</p>`;
  return {
    summary: "",
    body: `<details class="ipb-gr-pick" data-gr-box="${esc(box)}"${openBoxes.has(box) ? " open" : ""}><summary class="ipb-btn ipb-btn-small">${icon("fa-solid fa-plus")}<span>${esc(t("IPB.Gr.AddItem"))}</span></summary>${body}</details>`
  };
}

function crateBlock(ctx) {
  const { esc, t } = ctx;
  const rows = P.sortedList(ctx.B.crate);
  const hid = `${ctx.app.id}-gr-ch`;
  const f = flt(ctx.team.id);
  const filter = rows.length
    ? `<div class="ipb-gr-filter"><label class="ipb-field ipb-gr-search"><span>${esc(t("IPB.Gr.Search"))}</span><input class="ipb-input" type="search" name="ipb-gr-q" data-gr-filter="q" data-fk="gr-q" value="${esc(f.q)}" placeholder="${esc(t("IPB.Gr.SearchPh"))}" autocomplete="off"></label>`
      + `<label class="ipb-field"><span>${esc(t("IPB.Gr.TypeFilter"))}</span><select class="ipb-input" name="ipb-gr-type" data-gr-filter="type" data-fk="gr-type">${["all", ...P.CRATE_TYPES].map((k) => `<option value="${k}"${f.type === k ? " selected" : ""}>${esc(t(`IPB.Gr.Type.${k}`))}</option>`).join("")}</select></label></div>`
    : "";
  const empty = `<p class="ipb-muted ipb-gr-empty">${esc(t(ctx.canEdit ? "IPB.Gr.CrateEmpty" : "IPB.Gr.CrateEmptyRo"))}</p>`;
  return `<section class="ipb-gr-crate-sec" aria-labelledby="${hid}">
    <h2 class="ipb-bt-h" id="${hid}">${esc(t("IPB.Gr.CrateH"))}</h2>
    <p class="ipb-bt-hint">${esc(t("IPB.Gr.CrateHint"))}</p>
    ${ctx.canEdit ? zoneBox(ctx, "crate", "IPB.Gr.CrateZone", "IPB.Gr.CrateZoneHint", itemPicker(ctx)) : ""}
    ${filter}
    <div data-gr-crate-list>${rows.length ? crateListHtml(ctx, rows, f) : empty}</div>
  </section>`;
}

/* ------------------------------------------------------------------ trackers */
function trackerRow(ctx, r) {
  const { esc, icon, t } = ctx;
  const nm = r.name;
  const atMax = r.max !== null && r.value >= r.max;
  const atZero = r.value <= 0;
  const pct = r.max ? Math.max(0, Math.min(100, Math.round((r.value / r.max) * 100))) : null;
  const bar = pct !== null ? `<span class="ipb-gr-bar" aria-hidden="true"><span style="width:${pct}%"></span></span>` : "";
  const rid = `${ctx.app.id}-gr-tw-${r.id}`;
  if (!ctx.canEdit) {
    return `<li class="ipb-gr-trow"><p class="ipb-gr-tname"><strong>${esc(nm)}</strong></p><p class="ipb-gr-tval"><b>${r.value}</b>${r.max !== null ? ` <span class="ipb-muted">${esc(t("IPB.Gr.TrackOf", { max: r.max }))}</span>` : ""}</p>${bar}${r.note ? `<p class="ipb-up-note-ro">${icon("fa-solid fa-pen")} ${esc(r.note)}</p>` : ""}</li>`;
  }
  const dis = (cond, why) => (cond ? ` aria-disabled="true" aria-describedby="${esc(rid)}"` : "");
  const why = atMax ? t("IPB.Gr.TrackAtMax", { name: nm }) : atZero ? t("IPB.Gr.TrackAtZero", { name: nm }) : "";
  return `<li class="ipb-gr-trow" data-tid="${esc(r.id)}">
    <div class="ipb-gr-tline">
      <label class="ipb-gr-tnamef"><span class="ipb-sr">${esc(t("IPB.Gr.TrackNameOf", { name: nm }))}</span><input class="ipb-input ipb-gr-tname-in" type="text" name="ipb-gr-tn-${esc(r.id)}" data-gr-trk="name" data-id="${esc(r.id)}" maxlength="60" value="${esc(nm)}" autocomplete="off"></label>
      <div class="ipb-gr-qty" role="group" aria-label="${esc(t("IPB.Gr.TrackValue", { name: nm }))}">
        <button type="button" class="ipb-btn ipb-btn-small ipb-btn-icon" data-gr-act="trk-down" data-id="${esc(r.id)}" data-fk="gr-td-${esc(r.id)}" aria-label="${esc(t("IPB.Gr.TrackDown", { name: nm }))}"${dis(atZero)}>${icon("fa-solid fa-minus")}</button>
        <input class="ipb-input" type="number" inputmode="numeric" min="0" step="1"${r.max !== null ? ` max="${r.max}"` : ""} name="ipb-gr-tv-${esc(r.id)}" data-gr-trk="value" data-id="${esc(r.id)}" value="${r.value}" aria-label="${esc(t("IPB.Gr.TrackValue", { name: nm }))}">
        <button type="button" class="ipb-btn ipb-btn-small ipb-btn-icon" data-gr-act="trk-up" data-id="${esc(r.id)}" data-fk="gr-tu-${esc(r.id)}" aria-label="${esc(t("IPB.Gr.TrackUp", { name: nm }))}"${dis(atMax)}>${icon("fa-solid fa-plus")}</button>
      </div>
      <label class="ipb-gr-tmax"><span class="ipb-sr">${esc(t("IPB.Gr.TrackMaxOf", { name: nm }))}</span><span class="ipb-gr-tof" aria-hidden="true">${esc(t("IPB.Gr.TrackOf", { max: "" }).trim())}</span><input class="ipb-input" type="number" inputmode="numeric" min="0" step="1" name="ipb-gr-tm-${esc(r.id)}" data-gr-trk="max" data-id="${esc(r.id)}" value="${r.max ?? ""}" placeholder="-"></label>
      <button type="button" class="ipb-btn ipb-btn-small" data-gr-act="trk-reset" data-id="${esc(r.id)}" data-fk="gr-tr-${esc(r.id)}" aria-label="${esc(t("IPB.Gr.TrackResetAria", { name: nm }))}"${dis(atZero)}>${icon("fa-solid fa-rotate-left")}${esc(t("IPB.Gr.TrackReset"))}</button>
      <button type="button" class="ipb-btn ipb-btn-small" data-gr-act="trk-remove" data-id="${esc(r.id)}" data-fk="gr-tx-${esc(r.id)}" aria-label="${esc(t("IPB.Gr.TrackRemoveAria", { name: nm }))}">${icon("fa-solid fa-trash-can")}${esc(t("IPB.Gr.TrackRemove"))}</button>
    </div>
    ${bar}
    ${why ? `<span class="ipb-sr" id="${esc(rid)}">${esc(why)}</span>` : ""}
    <details class="ipb-up-notebox" data-gr-box="${esc(pk(ctx, `tn-${r.id}`))}"${r.note || openBoxes.has(pk(ctx, `tn-${r.id}`)) ? " open" : ""}><summary>${icon("fa-solid fa-pen")}<span>${esc(t("IPB.Gr.NoteSummary"))}</span></summary>
      <input class="ipb-input" type="text" name="ipb-gr-tnote-${esc(r.id)}" data-gr-note="trk" data-id="${esc(r.id)}" maxlength="300" value="${esc(r.note)}" aria-label="${esc(t("IPB.Gr.TrackNoteLabel", { name: nm }))}" placeholder="${esc(t("IPB.Gr.NotePh"))}" autocomplete="off"></details>
  </li>`;
}

function trackerForm(ctx) {
  const { esc, icon, t } = ctx;
  const d = drafts.get(ctx.team.id) ?? { name: "", max: "" };
  const named = d.name.trim().length > 0;
  const rid = `${ctx.app.id}-gr-tadd-why`;
  return `<div class="ipb-gr-tform" data-gr-tform>
    <label class="ipb-field"><span>${esc(t("IPB.Gr.TrackName"))}</span><input class="ipb-input" type="text" name="ipb-gr-new-name" data-gr-draft="name" maxlength="60" value="${esc(d.name)}" placeholder="${esc(t("IPB.Gr.TrackNamePh"))}" autocomplete="off"></label>
    <label class="ipb-field ipb-gr-tform-max"><span>${esc(t("IPB.Gr.TrackMax"))}</span><input class="ipb-input" type="number" inputmode="numeric" min="0" step="1" name="ipb-gr-new-max" data-gr-draft="max" value="${esc(d.max)}"></label>
    <span class="ipb-gr-tform-go" data-gr-tadd><button type="button" class="ipb-btn ipb-btn-primary ipb-btn-small" data-gr-act="trk-add" data-fk="gr-tadd"${named ? "" : ` aria-disabled="true" aria-describedby="${esc(rid)}"`}>${icon("fa-solid fa-plus")}${esc(t("IPB.Gr.TrackAdd"))}</button>${named ? "" : `<span class="ipb-gr-why" id="${esc(rid)}">${esc(t("IPB.Gr.TrackNeedName"))}</span>`}</span>
  </div>`;
}

function trackersBlock(ctx) {
  const { esc, t } = ctx;
  const rows = P.sortedList(ctx.B.trackers);
  if (!rows.length && !ctx.canEdit) return "";                                     // nothing to read, nothing to add: the section stays out of the way
  const hid = `${ctx.app.id}-gr-th`;
  return `<section class="ipb-gr-track-sec" aria-labelledby="${hid}">
    <h2 class="ipb-bt-h" id="${hid}">${esc(t("IPB.Gr.TrackH"))}</h2>
    <p class="ipb-bt-hint">${esc(t("IPB.Gr.TrackHint"))}</p>
    ${rows.length ? `<ul class="ipb-gr-list ipb-gr-tlist">${rows.map((r) => trackerRow(ctx, r)).join("")}</ul>` : `<p class="ipb-muted ipb-gr-empty">${esc(t("IPB.Gr.TrackEmpty"))}</p>`}
    ${ctx.canEdit ? trackerForm(ctx) : ""}
  </section>`;
}

/* ------------------------------------------------------------------ render */
function undoBar(ctx) {
  const rec = undoRec.get(ctx.team.id);
  if (!rec) return "";
  return `<p class="ipb-up-undo ipb-gr-undo" role="status">${ctx.icon("fa-solid fa-trash-can")}<span>${ctx.esc(rec.text)}</span><button type="button" class="ipb-bt-link" data-gr-act="undo" data-fk="gr-undo">${ctx.icon("fa-solid fa-rotate-left")}${ctx.esc(ctx.t("IPB.Gr.Undo"))}</button></p>`;
}

function render(ctx) {
  const { esc, icon, t, B } = ctx;
  const banner = B.base.occupied ? `<div class="ipb-bt-occupied" role="status">${icon("fa-solid fa-triangle-exclamation")}<p>${esc(t("IPB.Gr.Occupied"))}</p></div>` : "";
  const ro = ctx.canEdit ? "" : `<p class="ipb-bt-hint ipb-gr-ro">${icon("fa-solid fa-lock")} ${esc(t("IPB.Gr.ReadOnly"))}</p>`;
  return `<div class="ipb-gr${ctx.canEdit ? "" : " ipb-gr-readonly"}">
    ${banner}${undoBar(ctx)}
    <div class="ipb-gr-a">${vehiclesBlock(ctx)}</div>
    <div class="ipb-gr-b">${crateBlock(ctx)}</div>
    <div class="ipb-gr-c">${trackersBlock(ctx)}</div>
    ${ro}
  </div>`;
}

/* ------------------------------------------------------------------ actions */
const q = (root, sel) => root.querySelector(sel);
function startOp(key) { if (busy.has(key)) return false; busy.add(key); return true; }
const warn = (ctx, msg) => { ui.notifications?.warn(msg, { console: false }); ctx.announce(msg); return null; };
const say = (ctx, msg) => { ui.notifications?.info(msg, { console: false }); ctx.announce(msg); };

function setUndo(ctx, text, patch) {
  const prev = undoRec.get(ctx.team.id);
  if (prev) clearTimeout(prev.timer);
  const id = ctx.team.id;
  const timer = setTimeout(() => { undoRec.delete(id); CTX.get(ROOTS.get(id))?.rerender?.(); }, UNDO_MS);
  undoRec.set(id, { text, patch, timer });
}
async function doUndo(root) {
  const ctx = CTX.get(root);
  const rec = ctx && undoRec.get(ctx.team.id);
  if (!rec) return;
  clearTimeout(rec.timer); undoRec.delete(ctx.team.id);
  const res = await ctx.update(rec.patch);
  if (res) ctx.announce(ctx.t("IPB.Gr.UndoDone"));
  CTX.get(root)?.rerender();
}

/* ----- vehicles */
async function addVehicle(ctx, actor) {
  const id = await ctx.run(ctx.api.vehicles.add(ctx.team.id, actor));
  if (id) say(ctx, ctx.t("IPB.Gr.VehAdded", { name: actor.name }));
  return id;
}
async function doVehAdd(root) {
  const ctx = CTX.get(root);
  if (!ctx || !ctx.canEdit) return;
  const sel = q(root, "[data-gr-sel='veh']");
  const actor = sel?.value ? fromUuidSync(sel.value, { strict: false }) : null;
  if (!actor) return;
  const op = `vadd:${ctx.team.id}`;
  if (!startOp(op)) return;
  try { await addVehicle(ctx, actor); } finally { busy.delete(op); }
}
async function doVehRemove(root, vid) {
  const ctx = CTX.get(root);
  if (!ctx || !ctx.canEdit) return;
  const v = ctx.B.vehicles[vid];
  if (!v) return;
  const op = `vrm:${ctx.team.id}:${vid}`;
  if (!startOp(op)) return;
  try {
    const snapshot = foundry.utils.deepClone(v);
    const a = fromUuidSync(v.uuid, { strict: false });
    const name = a?.name ?? v.name;
    const next = v.primary ? P.sortedList(ctx.B.vehicles).find((x) => x.id !== vid) : null;
    const res = await ctx.run(ctx.api.vehicles.remove(ctx.team.id, vid));
    if (res === null) return;
    const patch = { vehicles: { [vid]: snapshot } };
    if (next) { await ctx.run(ctx.api.vehicles.setPrimary(ctx.team.id, next.id)); patch.vehicles[next.id] = { primary: false }; }     // the team always keeps a star while it has a vehicle
    const text = ctx.t("IPB.Gr.VehRemoved", { name });
    setUndo(ctx, text, patch);
    ctx.announce(text);
    CTX.get(root)?.rerender();
  } finally { busy.delete(op); }
}
async function doVehPrimary(root, vid) {
  const ctx = CTX.get(root);
  if (!ctx || !ctx.canEdit || !ctx.B.vehicles[vid]) return;
  const op = `vstar:${ctx.team.id}`;
  if (!startOp(op)) return;
  try {
    const res = await ctx.run(ctx.api.vehicles.setPrimary(ctx.team.id, vid));
    if (res) ctx.announce(ctx.t("IPB.Gr.VehPrimary", { name: fromUuidSync(ctx.B.vehicles[vid].uuid, { strict: false })?.name ?? ctx.B.vehicles[vid].name }));
  } finally { busy.delete(op); }
}
function doVehOpen(root, vid) {
  const ctx = CTX.get(root);
  const v = ctx?.B.vehicles[vid];
  const a = v ? fromUuidSync(v.uuid, { strict: false }) : null;
  if (a && (ctx.isStaff || a.testUserPermission(ctx.user, "LIMITED"))) a.sheet.render({ force: true });
  else if (ctx) warn(ctx, ctx.t("IPB.Gr.OpenNo"));
}

/* ----- crate */
async function addToCrate(ctx, item) {
  const rows = P.sortedList(ctx.B.crate);
  const dup = item.uuid ? rows.find((r) => r.src === item.uuid) : null;
  if (dup) {                                                                  // the same source again: one more of it instead of a second row
    const qty = dup.qty + 1;
    const res = await ctx.run(ctx.api.crate.setQty(ctx.team.id, dup.id, qty));
    if (res) say(ctx, ctx.t("IPB.Gr.AddedQty", { name: dup.name, qty }));
    return res;
  }
  const id = await ctx.run(ctx.api.crate.add(ctx.team.id, item));
  if (id) say(ctx, ctx.t("IPB.Gr.Added", { name: item.name }));
  return id;
}
async function doItemAdd(root) {
  const ctx = CTX.get(root);
  if (!ctx || !ctx.canEdit) return;
  const sel = q(root, "[data-gr-sel='item']");
  if (!sel?.value) return;
  const op = `iadd:${ctx.team.id}`;
  if (!startOp(op)) return;
  try {
    const item = await fromUuid(sel.value);
    if (item) await addToCrate(ctx, item);
  } finally { busy.delete(op); }
}
async function bumpQty(root, cid, delta, abs = null) {
  const ctx = CTX.get(root);
  const row = ctx?.B.crate[cid];
  if (!ctx || !ctx.canEdit || !row) return;
  const base = pendingQty.get(cid) ?? row.qty;
  const next = Math.max(1, Math.min(9999, abs ?? base + delta));
  if (next === base && abs === null) return;
  if (next === row.qty && abs !== null) return;
  pendingQty.set(cid, next);
  try {
    const res = await ctx.run(ctx.api.crate.setQty(ctx.team.id, cid, next));
    if (res) ctx.announce(ctx.t("IPB.Gr.QtySet", { name: row.name, qty: next }));
  } finally { if (pendingQty.get(cid) === next) pendingQty.delete(cid); }
}
async function doCrateRemove(root, cid) {
  const ctx = CTX.get(root);
  const row = ctx?.B.crate[cid];
  if (!ctx || !ctx.canEdit || !row) return;
  const op = `crm:${ctx.team.id}:${cid}`;
  if (!startOp(op)) return;
  try {
    const snapshot = foundry.utils.deepClone(row);
    const res = await ctx.run(ctx.api.crate.remove(ctx.team.id, cid));
    if (res === null) return;
    const text = ctx.t("IPB.Gr.Removed", { name: row.name });
    setUndo(ctx, text, { crate: { [cid]: snapshot } });
    ctx.announce(text);
    CTX.get(root)?.rerender();
  } finally { busy.delete(op); }
}

async function giveDialog(ctx, row, targets) {
  const { esc, t } = ctx;
  const { DialogV2 } = foundry.applications.api;
  const opts = targets.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join("");
  const out = await DialogV2.wait({
    window: { title: t("IPB.Gr.GiveTitle", { name: row.name }), icon: "fa-solid fa-hand-holding-hand" },
    classes: ["ipb-dialog", "ipb-dialog-safe"], position: { width: 440 },
    content: `<p class="ipb-gr-dlg-lede">${esc(t("IPB.Gr.GiveLede", { name: row.name }))}</p><label class="ipb-dlg-field"><span>${esc(t("IPB.Gr.GiveWho"))}</span><select name="target">${opts}</select></label>`,
    render: (_ev, dialog) => {
      const el = dialog.element ?? dialog;
      const sel = el.querySelector("select[name=target]");
      const btn = el.querySelector('button[data-action="give"]');
      const upd = () => { if (btn) btn.textContent = t("IPB.Gr.GiveYes", { name: row.name, target: sel.selectedOptions[0]?.textContent ?? "" }); };
      sel?.addEventListener("change", upd);
      upd();
    },
    buttons: [
      // B12: the SAFE button is the default (Enter / initial focus = Cancel, like the delete dialog's Keep); Give keeps the yellow look through .ipb-primary
      { action: "give", label: t("IPB.Gr.GiveYesBare"), class: "ipb-primary", callback: (_ev, button) => button.form.elements.target.value },
      { action: "cancel", label: t("IPB.Gr.GiveCancel"), default: true, callback: () => null }
    ],
    rejectClose: false, modal: false
  });
  return typeof out === "string" && out && out !== "cancel" ? out : null;          // DialogV2 answers the action NAME when a callback returns null
}
async function doGive(root, cid) {
  const ctx = CTX.get(root);
  const row = ctx?.B.crate[cid];
  if (!ctx || !row) return;
  const g = giveTargets(ctx, { ...row, id: cid });
  if (!g.list.length) { warn(ctx, ctx.t(g.why)); return; }
  const op = `give:${ctx.team.id}:${cid}`;
  if (!startOp(op)) return;
  try {
    const id = await giveDialog(ctx, row, g.list);
    if (!id) return;
    const target = g.list.find((a) => a.id === id);
    const now = CTX.get(root) ?? ctx;
    if (!now.B.crate[cid]) return;                                             // taken out meanwhile
    const item = await now.run(now.api.crate.give(now.team.id, cid, id));
    if (item) { const msg = now.t("IPB.Gr.GiveDone", { name: row.name, target: target?.name ?? "" }); say(now, msg); CTX.get(root)?.rerender(); }
  } finally { busy.delete(op); }
}

/* ----- trackers */
async function trkSet(root, tid, patch, announceKey) {
  const ctx = CTX.get(root);
  const r = ctx?.B.trackers[tid];
  if (!ctx || !ctx.canEdit || !r) return null;
  const res = await ctx.run(ctx.update({ trackers: { [tid]: patch } }));
  if (res && announceKey) ctx.announce(ctx.t(announceKey, { name: patch.name ?? r.name, value: patch.value ?? r.value }));
  return res;
}
async function trkStep(root, tid, delta) {
  const ctx = CTX.get(root);
  const r = ctx?.B.trackers[tid];
  if (!ctx || !r) return;
  const next = Math.max(0, r.max !== null ? Math.min(r.max, r.value + delta) : r.value + delta);
  if (next === r.value) { warn(ctx, ctx.t(delta > 0 ? "IPB.Gr.TrackAtMax" : "IPB.Gr.TrackAtZero", { name: r.name })); return; }
  await trkSet(root, tid, { value: next }, "IPB.Gr.TrackSet");
}
async function trkAdd(root) {
  const ctx = CTX.get(root);
  if (!ctx || !ctx.canEdit) return;
  const d = drafts.get(ctx.team.id) ?? { name: "", max: "" };
  const name = d.name.trim();
  if (!name) { warn(ctx, ctx.t("IPB.Gr.TrackNeedName")); return; }
  const g = P.canAdd(ctx.B, "trackers");
  if (!g.ok) { warn(ctx, ctx.t("IPB.Err.trackersFull", { count: Object.keys(ctx.B.trackers).length, cap: g.cap })); return; }
  const mx = String(d.max).trim() === "" ? null : Math.max(0, parseInt(d.max, 10) || 0);
  const tid = foundry.utils.randomID(8);
  const op = `tadd:${ctx.team.id}`;
  if (!startOp(op)) return;
  try {
    const res = await ctx.run(ctx.update({ trackers: { [tid]: { name, value: 0, max: mx, note: "", sort: P.nextSort(ctx.B.trackers) } } }));
    if (!res) return;
    drafts.delete(ctx.team.id);
    ctx.announce(ctx.t("IPB.Gr.TrackAdded", { name }));
    CTX.get(root)?.rerender();
  } finally { busy.delete(op); }
}
async function trkRemove(root, tid) {
  const ctx = CTX.get(root);
  const r = ctx?.B.trackers[tid];
  if (!ctx || !ctx.canEdit || !r) return;
  const op = `trm:${ctx.team.id}:${tid}`;
  if (!startOp(op)) return;
  try {
    const snapshot = foundry.utils.deepClone(r);
    const res = await ctx.run(ctx.update({ trackers: { [`-=${tid}`]: null } }));
    if (!res) return;
    const text = ctx.t("IPB.Gr.TrackRemoved", { name: r.name });
    setUndo(ctx, text, { trackers: { [tid]: snapshot } });
    ctx.announce(text);
    CTX.get(root)?.rerender();
  } finally { busy.delete(op); }
}
function paintTrackerAdd(root) {
  const ctx = CTX.get(root);
  const el = q(root, "[data-gr-tadd]");
  if (!ctx || !el) return;
  const named = (drafts.get(ctx.team.id)?.name ?? "").trim().length > 0;
  const rid = `${ctx.app.id}-gr-tadd-why`;
  el.innerHTML = `<button type="button" class="ipb-btn ipb-btn-primary ipb-btn-small" data-gr-act="trk-add" data-fk="gr-tadd"${named ? "" : ` aria-disabled="true" aria-describedby="${ctx.esc(rid)}"`}>${ctx.icon("fa-solid fa-plus")}${ctx.esc(ctx.t("IPB.Gr.TrackAdd"))}</button>${named ? "" : `<span class="ipb-gr-why" id="${ctx.esc(rid)}">${ctx.esc(ctx.t("IPB.Gr.TrackNeedName"))}</span>`}`;
}

/* ------------------------------------------------------------------ drops (sheet.mjs: _onDropItem / _onDropActor -> onDrop) */
async function importVehicle(ctx, doc) {
  const existing = game.actors.find((a) => a.type === "vehicle" && !ctx.api.isCard(a) && a._stats?.compendiumSource === doc.uuid);
  if (existing) return { actor: existing, fresh: false };                     // imported before: never a second copy
  const { DialogV2 } = foundry.applications.api;
  const ok = await DialogV2.confirm({
    window: { title: ctx.t("IPB.Gr.DropImportTitle", { name: doc.name }), icon: "fa-solid fa-file-import" }, classes: ["ipb-dialog"],
    content: `<p>${ctx.esc(ctx.t("IPB.Gr.DropImportBody", { name: doc.name }))}</p>`,
    yes: { label: ctx.t("IPB.Gr.DropImportYes", { name: doc.name }), icon: "fa-solid fa-file-import" }, no: { label: ctx.t("IPB.Gr.GiveCancel") },
    rejectClose: false, modal: false
  });
  if (!ok) return null;
  const pack = game.packs.get(doc.pack);
  if (!pack) return null;
  const actor = await ctx.run(game.actors.importFromCompendium(pack, doc.id, {}, { keepId: false }));
  return actor ? { actor, fresh: true } : null;
}

async function dropActor(ctx, doc) {
  let actor = doc;
  if (actor?.isToken) actor = actor.token?.baseActor ?? game.actors.get(actor.id) ?? actor;
  if (!actor || actor.documentName !== "Actor") return warn(ctx, ctx.t("IPB.Gr.DropUnreadable"));
  if (!ctx.canEdit) return warn(ctx, ctx.t("IPB.Gr.DropNoEdit"));
  if (ctx.api.isCard(actor)) return warn(ctx, ctx.t("IPB.Gr.DropBase", { name: actor.name }));
  if (actor.type === "superhero" && actor.pack) return warn(ctx, ctx.t("IPB.Drop.Compendium", { name: actor.name }));      // a hero joins through the header, once it is in the world
  if (actor.type !== "vehicle") return warn(ctx, ctx.t("IPB.Gr.DropNotVehicle", { name: actor.name, type: actor.type }));
  if (actor.pack) {
    if (!ctx.isStaff) return warn(ctx, ctx.t("IPB.Gr.DropCompendium", { name: actor.name }));
    const got = await importVehicle(ctx, actor);
    if (!got) return null;
    const imported = got.actor;
    if (P.sortedList(ctx.B.vehicles).some((v) => v.uuid === imported.uuid)) return warn(ctx, ctx.t("IPB.Gr.DropDup", { name: imported.name }));
    const id = await ctx.run(ctx.api.vehicles.add(ctx.team.id, imported));
    if (id) say(ctx, ctx.t(got.fresh ? "IPB.Gr.DropImported" : "IPB.Gr.VehAdded", { name: imported.name }));
    return id ? imported : null;
  }
  if (P.sortedList(ctx.B.vehicles).some((v) => v.uuid === actor.uuid)) return warn(ctx, ctx.t("IPB.Gr.DropDup", { name: actor.name }));
  const id = await addVehicle(ctx, actor);
  return id ? actor : null;
}
async function dropItem(ctx, item) {
  if (dropOwn && dropOwn.team === ctx.team.id && Date.now() - dropOwn.at < 5000) { dropOwn = null; return null; }      // a crate row dragged back onto its own tab: nothing to do
  if (!ctx.canEdit) return warn(ctx, ctx.t("IPB.Gr.DropNoEdit"));
  if (!P.CRATE_TYPES.includes(item.type)) return warn(ctx, ctx.t("IPB.Gr.DropBadItem", { name: item.name, type: item.type }));
  const res = await addToCrate(ctx, item);
  return res ? item : null;
}

/* (B9: the live repaint when a team vehicle changes moved to entry.mjs, which already watches the bases and the heroes) */

/* ------------------------------------------------------------------ delegated events */
function clearZones(root) { for (const z of root.querySelectorAll("[data-gr-zone][data-over]")) delete z.dataset.over; }
if (typeof window !== "undefined") {
  window.addEventListener("dragend", () => { ownDrag = null; for (const z of document.querySelectorAll("[data-gr-zone][data-over]")) delete z.dataset.over; }, true);
  // the core resolves the dropped document asynchronously and dragend fires right after drop, so who was being dragged is noted at drop time
  window.addEventListener("drop", () => { dropOwn = ownDrag ? { ...ownDrag, at: Date.now() } : null; for (const z of document.querySelectorAll("[data-gr-zone][data-over]")) delete z.dataset.over; }, true);
}

function bind(root) {
  root.addEventListener("click", (ev) => {
    const el = ev.target instanceof Element ? ev.target.closest("[data-gr-act]") : null;
    if (!el || !root.contains(el)) return;
    const act = el.dataset.grAct;
    const ctx = CTX.get(root);
    if (el.getAttribute("aria-disabled") === "true") {                       // a refused action says why instead of doing nothing
      const why = el.getAttribute("aria-describedby") ? document.getElementById(el.getAttribute("aria-describedby")) : null;
      if (ctx && why) ctx.announce(why.textContent.trim());
      return;
    }
    const cid = el.dataset.cid, vid = el.dataset.vid, id = el.dataset.id;
    if (act === "veh-open") doVehOpen(root, vid);
    else if (act === "veh-primary") doVehPrimary(root, vid);
    else if (act === "veh-remove") doVehRemove(root, vid);
    else if (act === "veh-add") doVehAdd(root);
    else if (act === "item-add") doItemAdd(root);
    else if (act === "qty-up") bumpQty(root, cid, 1);
    else if (act === "qty-down") bumpQty(root, cid, -1);
    else if (act === "give-hero" || act === "give-veh") doGive(root, cid);
    else if (act === "crate-remove") doCrateRemove(root, cid);
    else if (act === "undo") doUndo(root);
    else if (act === "trk-up") trkStep(root, id, 1);
    else if (act === "trk-down") trkStep(root, id, -1);
    else if (act === "trk-reset") { const c = CTX.get(root), r = c?.B.trackers[id]; if (r && r.value > 0) trkSet(root, id, { value: 0 }, "IPB.Gr.TrackSet"); }
    else if (act === "trk-add") trkAdd(root);
    else if (act === "trk-remove") trkRemove(root, id);
  });
  root.addEventListener("input", (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    const ctx = CTX.get(root);
    if (!el || !ctx) return;
    if (el.matches("[data-gr-filter]")) {
      const f = { ...flt(ctx.team.id) };
      f[el.dataset.grFilter] = el.value;
      filters.set(ctx.team.id, f);
      const box = q(root, "[data-gr-crate-list]");
      if (box) box.innerHTML = crateListHtml(ctx, P.sortedList(ctx.B.crate), f);
    } else if (el.matches("[data-gr-draft]")) {
      const d = drafts.get(ctx.team.id) ?? { name: "", max: "" };
      d[el.dataset.grDraft] = el.value;
      drafts.set(ctx.team.id, d);
      if (el.dataset.grDraft === "name") paintTrackerAdd(root);
    }
  });
  root.addEventListener("change", (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    const ctx = CTX.get(root);
    if (!el || !ctx) return;
    if (el.matches("[data-gr-filter='type']")) { el.dispatchEvent(new Event("input", { bubbles: true })); return; }
    if (el.matches("[data-gr-qty]")) {
      const n = parseInt(el.value, 10);
      const row = ctx.B.crate[el.dataset.grQty];
      if (!Number.isFinite(n) || n < 1) { if (row) el.value = String(row.qty); return; }
      bumpQty(root, el.dataset.grQty, 0, n);
    } else if (el.matches("[data-gr-note]")) {
      const kind = el.dataset.grNote, id = el.dataset.id, text = el.value.trim();
      if (kind === "crate") { const r = ctx.B.crate[id]; if (r && text !== r.note) ctx.run(ctx.api.crate.setNote(ctx.team.id, id, text)); }
      else if (kind === "veh") { const v = ctx.B.vehicles[id]; if (v && text !== v.note) ctx.run(ctx.update({ vehicles: { [id]: { note: text } } })); }
      else if (kind === "trk") { const r = ctx.B.trackers[id]; if (r && text !== r.note) ctx.run(ctx.update({ trackers: { [id]: { note: text } } })); }
    } else if (el.matches("[data-gr-trk]")) {
      const id = el.dataset.id, r = ctx.B.trackers[id], field = el.dataset.grTrk;
      if (!r) return;
      if (field === "name") {
        const v = el.value.trim();
        if (!v) { el.value = r.name; return; }
        if (v !== r.name) trkSet(root, id, { name: v });
      } else if (field === "value") {
        const n = parseInt(el.value, 10);
        if (!Number.isFinite(n)) { el.value = String(r.value); return; }
        const next = Math.max(0, r.max !== null ? Math.min(r.max, n) : n);
        el.value = String(next);
        if (next !== r.value) trkSet(root, id, { value: next }, "IPB.Gr.TrackSet");
      } else if (field === "max") {
        const raw = el.value.trim();
        const mx = raw === "" ? null : Math.max(0, parseInt(raw, 10) || 0);
        if (mx === r.max) return;
        trkSet(root, id, mx !== null && r.value > mx ? { max: mx, value: mx } : { max: mx });
      }
    }
  });
  root.addEventListener("keydown", (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    if (!el) return;
    if (ev.isComposing || ev.keyCode === 229) return;                 // B13 (IME): Enter / Escape belong to the composition
    if (el.matches("input.ipb-input, textarea.ipb-input")) {
      if (ev.key === "Enter" && el.tagName !== "TEXTAREA") {
        ev.preventDefault();
        if (el.matches("[data-gr-draft]")) { if (el.dataset.grDraft === "name" || el.dataset.grDraft === "max") trkAdd(root); }
        else if (!el.matches("[data-gr-filter]")) el.blur();
      } else if (ev.key === "Escape") {
        ev.stopPropagation();                                                // the core closes the window on Escape otherwise
        const ctx = CTX.get(root);
        if (el.matches("[data-gr-filter='q']")) { el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); }
        else if (ctx) {
          const id = el.dataset.id;
          if (el.matches("[data-gr-qty]")) el.value = String(ctx.B.crate[el.dataset.grQty]?.qty ?? el.value);
          else if (el.matches("[data-gr-note='crate']")) el.value = ctx.B.crate[id]?.note ?? el.value;
          else if (el.matches("[data-gr-note='veh']")) el.value = ctx.B.vehicles[id]?.note ?? el.value;
          else if (el.matches("[data-gr-note='trk']")) el.value = ctx.B.trackers[id]?.note ?? el.value;
          else if (el.matches("[data-gr-trk='name']")) el.value = ctx.B.trackers[id]?.name ?? el.value;
          else if (el.matches("[data-gr-trk='value']")) el.value = String(ctx.B.trackers[id]?.value ?? el.value);
          else if (el.matches("[data-gr-trk='max']")) el.value = String(ctx.B.trackers[id]?.max ?? "");
        }
        el._grEsc = true;
      }
    }
  });
  root.addEventListener("keyup", (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    if (ev.key === "Escape" && el?._grEsc) { ev.stopPropagation(); el._grEsc = false; if (!el.matches("[data-gr-filter]")) el.blur(); }
  });
  root.addEventListener("toggle", (ev) => {                                  // <details> state survives repaints (toggle does not bubble: captured)
    const d = ev.target;
    if (!(d instanceof Element) || !d.dataset?.grBox) return;
    if (d.open) openBoxes.add(d.dataset.grBox); else openBoxes.delete(d.dataset.grBox);
  }, true);
  // dragging a crate row OUT: the payload is the item snapshot (api.crate.dragPayload), a hero sheet creates the item from it
  root.addEventListener("dragstart", (ev) => {
    const g = ev.target instanceof Element ? ev.target.closest("[data-gr-drag]") : null;
    if (!g) return;
    const ctx = CTX.get(root);
    try {
      const payload = ctx.api.crate.dragPayload(ctx.team.id, g.dataset.grDrag);
      ev.dataTransfer.setData("text/plain", JSON.stringify(payload));
      ev.dataTransfer.effectAllowed = "copy";
      const row = g.closest("li");
      if (row) ev.dataTransfer.setDragImage(row, 24, 24);
      ownDrag = { team: ctx.team.id };
    } catch { ev.preventDefault(); }
  });
  // drop zones: highlight the area under the pointer (the drop itself arrives through the sheet's _onDropItem / _onDropActor)
  const over = (ev) => {
    const z = ev.target instanceof Element ? ev.target.closest("[data-gr-zone]") : null;
    if (!z) { clearZones(root); return; }
    if (z.dataset.over !== "true") { clearZones(root); z.dataset.over = "true"; }
  };
  root.addEventListener("dragenter", over);
  root.addEventListener("dragover", over);
  root.addEventListener("dragleave", (ev) => { const z = ev.target instanceof Element ? ev.target.closest("[data-gr-zone]") : null; if (z && !z.contains(ev.relatedTarget)) delete z.dataset.over; });
}

export const gear = {
  id: "gear",
  icon: "fa-solid fa-van-shuttle",
  badge: (ctx) => { const n = Object.keys(ctx.B.vehicles).length + Object.keys(ctx.B.crate).length; return n || ""; },
  render,
  mount(ctx, root) {
    CTX.set(root, ctx);
    ROOTS.set(ctx.team.id, root);
    if (!BOUND.has(root)) { BOUND.add(root); bind(root); }
  },
  /** Called by the sheet for an Item or a vehicle Actor dropped on it while this tab is active. data = { type: "Item" | "Actor", document }. */
  async onDrop(_event, data, ctx) {
    clearZones(ROOTS.get(ctx.team.id) ?? document.body);
    if (data.type === "Item") return dropItem(ctx, data.document);
    if (data.type === "Actor") return dropActor(ctx, data.document);
    return null;
  }
};
export default gear;
