/* Team & Base card ENTRY POINTS (phase B4, B4b: the card is an Actor, its window is the actor's sheet sheet.mjs). Does nothing heavy until a click: the
   "no team yet" window (window.mjs) and the picker are imported on first use.
   Entry points (all open the same sheet; one sheet per base actor, a second click focuses it; the Actors directory lists the bases and has its own
   "Create team base" button, directory.mjs):
     1. a visible icon button in the header of every superhero sheet (fa-people-roof, cyan; the chargen wand is yellow and always stays first),
        DOM-injected by a renderApplicationV2 hook, idempotent, hidden live by the client setting baseHeaderButton;
     2. an entry in the sheet's 3-dot menu (getHeaderControlsInvincibleActorSheet), the keyboard / discoverability path;
     3. a row under the "Team base" field on the Personal tab (summary + Open, or Create / join);
     4. a small button next to the party panel handle (#invincible-party): the card of the user's team, or the picker;
     5. the chat card button data-action="ipb-open-team" (base event cards);
     6. api.base.open(team | actor | nothing), openFor(actor), pick().
   Repaint triggers (hooks below) refresh open windows, the sheet rows and the picker. */
import * as S from "./store.mjs";
import { t, tn } from "./lang.mjs";
import { esc, icon } from "./util.mjs";
import * as Lock from "./lock.mjs";
import * as Join from "./join.mjs";

const MOD = S.MODULE_ID;
const ICON = "fa-solid fa-people-roof";
let BaseSheet = null, NewTeamApp = null, PickerApp = null;
let started = false;
const hooks = [];
const on = (name, fn) => hooks.push([name, Hooks.on(name, fn)]);
const setting = (key, fallback) => { try { return game.settings.get(MOD, key); } catch { return fallback; } };

async function loadSheet() { return (BaseSheet ??= (await import("./sheet.mjs")).BaseSheet); }
async function loadWindow() { return (NewTeamApp ??= (await import("./window.mjs")).NewTeamApp); }
async function loadPicker() { return (PickerApp ??= (await import("./picker.mjs")).PickerApp); }

/* ------------------------------------------------------------------ api: open / openFor / pick */
const asActor = (ref) => (typeof ref === "string" ? (game.actors.get(ref) ?? (ref.includes(".") ? fromUuidSync(ref) : null)) : ref);
const isHero = (ref) => ref?.documentName === "Actor" && ref.type === "superhero";

/** open(team | base actor | hero | nothing, {tab}) -> the sheet (or the picker without an argument, or null when nothing could be opened) */
export async function open(ref, opts = {}) {
  if (!ref) return pick();
  const actor = typeof ref === "string" ? asActor(ref) : ref?.documentName === "Actor" ? ref : null;
  if (isHero(actor)) return openFor(actor, opts);
  let team;
  try { team = S.view(ref); } catch { ui.notifications?.warn(t("IPB.Entry.Deleted")); return null; }
  const Sheet = await loadSheet();
  return Sheet.open({ team: team.id, tab: opts.tab ?? null });
}
/** openFor(actor, {tab}) -> the base sheet of the hero's team, or the create / join / ask window when it has none (a base actor opens itself) */
export async function openFor(actorRef, opts = {}) {
  const actor = asActor(actorRef);
  if (S.isCard(actor)) return open(actor, opts);
  if (!actor || actor.type !== "superhero") { ui.notifications?.warn(t("IPB.Entry.NotHero")); return null; }
  const team = S.find(actor);
  if (team) return (await loadSheet()).open({ team: team.id, tab: opts.tab ?? null });
  if (!actor.isOwner && !S.isStaff()) { ui.notifications?.info(t("IPB.Entry.RowNone")); return null; }
  return (await loadWindow()).open({ actor });
}
/** pick(): the list of cards (a single card is opened directly for players) */
export async function pick() {
  const cards = S.list();
  if (!S.isStaff()) {
    if (cards.length === 1) return open(cards[0].id);
    if (!cards.length) { ui.notifications?.info(t("IPB.Pick.None")); return null; }
  }
  const P = await loadPicker();
  return P.open();
}

/* ------------------------------------------------------------------ 1. header button + 3. personal row */
const sheetHero = (app) => (app?.document?.documentName === "Actor" && app.document.type === "superhero" && !app.document.pack ? app.document : null);

function wantButton(actor) {
  return setting("baseHeaderButton", true) !== false && (actor.isOwner || !!S.find(actor));
}
function placeButton(header, btn) {
  const chargen = header.querySelector("[data-ipc-chargen]");
  if (chargen) { if (btn.previousElementSibling !== chargen) chargen.after(btn); return; }       // the wand stays first, ours right after it
  const anchor = header.querySelector('[data-action="copyUuid"]') ?? header.querySelector('[data-action="close"]');
  if (anchor) { if (btn.nextElementSibling !== anchor) anchor.before(btn); } else if (!btn.isConnected) header.append(btn);
}
function syncHeader(app, root) {
  const actor = sheetHero(app);
  if (!actor) return;
  const header = (root ?? app.element)?.querySelector?.(".window-header");
  if (!header) return;
  let btn = header.querySelector("[data-ipb-open]");
  if (!wantButton(actor)) { btn?.remove(); return; }
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = `header-control icon ${ICON} ipb-header-btn`;
    btn.dataset.ipbOpen = "";
    btn.dataset.tooltip = t("IPB.Entry.Tooltip");
    btn.setAttribute("aria-label", t("IPB.Entry.Button"));
    btn.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); openFor(actor); });
  }
  placeButton(header, btn);
  // the chargen button can be injected after ours in the same render: put ours behind it once everything has run
  queueMicrotask(() => { if (btn.isConnected) placeButton(header, btn); });
}

function personalRow(actor) {
  const team = S.find(actor);
  const staff = S.isStaff();
  const canMake = staff || (setting(S.SETTING_PLAYERS_CREATE, false) === true && actor.isOwner);
  let body;
  if (team) {
    const n = Object.keys(team.upgrades).length;
    body = `<span class="ipb-pr-text"><strong>${esc(team.name)}</strong> <span class="ipb-pr-meta">${esc(tn("IPB.Entry.Upgrades", n))}</span></span>`
      + (Lock.isMember(actor) && (actor.isOwner || staff) ? "" : `<button type="button" class="ipb-pr-btn" data-ipb-open aria-label="${esc(t("IPB.Entry.RowOpenAria", { team: team.name }))}">${icon(ICON)} ${esc(t("IPB.Entry.RowOpen"))}</button>`);   // B4d: the lock note carries the Open button instead
  } else {
    const label = canMake || S.list().length ? t("IPB.Entry.RowCreate") : t("IPB.Entry.RowAsk");
    body = `<span class="ipb-pr-text ipb-pr-meta">${esc(t("IPB.Entry.RowNone"))}</span><button type="button" class="ipb-pr-btn" data-ipb-open>${icon(ICON)} ${esc(label)}</button>`;
  }
  return body;
}
/* B4d: while the hero is a member, system.team / system.teamBase are read-only here (the card owns them); the note under them says why. Idempotent,
   runs on every render and repaint, so it also unlocks again when the hero leaves the base. readonly (not disabled): still focusable and selectable. */
function applyLock(el, actor, app) {
  const card = Lock.cardOf(actor);
  const noteId = `ipb-lock-note-${app?.id ?? actor.id}`;
  for (const f of Lock.FIELDS) {
    const input = el.querySelector(`section.tab.personal [name="system.${f}"]`);
    if (!input) continue;
    if (card) {
      input.readOnly = true;
      input.setAttribute("aria-readonly", "true");
      input.setAttribute("aria-describedby", noteId);
      input.classList.add("ipb-locked");
    } else if (input.classList.contains("ipb-locked")) {
      input.readOnly = false;
      input.removeAttribute("aria-readonly");
      input.removeAttribute("aria-describedby");
      input.classList.remove("ipb-locked");
    }
  }
}
function lockNote(actor, app) {
  const card = Lock.cardOf(actor);
  if (!card) return "";
  const id = `ipb-lock-note-${app?.id ?? actor.id}`;
  const stuck = !S.isStaff() && !S.canEdit(card.id);          // B11 (A17): an owner who may not edit the card (policy gm, or no rights on it) is told who can
  const open = actor.isOwner || S.isStaff()
    ? ` <button type="button" class="ipb-pr-btn ipb-lock-open" data-ipb-open aria-label="${esc(t("IPB.Entry.RowOpenAria", { team: card.name }))}">${icon(ICON)} ${esc(t("IPB.Entry.RowOpen"))}</button>` : "";
  return `<p class="ipb-lock-note" id="${id}">${icon("fa-solid fa-lock")} <span>${esc(t("IPB.Lock.Note", { team: card.name }))}${stuck ? ` ${esc(t("IPB.Lock.AskGm"))}` : ""}</span>${open}</p>`;
}
function syncPersonal(app, root) {
  const actor = sheetHero(app);
  const el = root ?? app?.element;
  if (!actor || !el?.querySelector) return;
  const field = el.querySelector('section.tab.personal [name="system.teamBase"]');
  const group = field?.closest(".form-group");
  applyLock(el, actor, app);
  const existing = el.querySelector(".ipb-personal");
  if (!group || !(actor.isOwner || S.find(actor))) { existing?.remove(); return; }
  const row = existing ?? Object.assign(document.createElement("div"), { className: "form-group ipb-personal" });
  if (!existing) {
    row.addEventListener("click", (ev) => { if (ev.target.closest("[data-ipb-open]")) openFor(actor); });
    group.after(row);
  }
  const html = `<label>${esc(t("IPB.Entry.RowLabel"))}</label><div class="form-fields ipb-pr-body">${personalRow(actor)}${lockNote(actor, app)}</div>`;
  if (row.dataset.sig !== html) { row.innerHTML = html; row.dataset.sig = html; }
}
function syncSheets() {
  try {
    for (const app of foundry.applications.instances.values()) { if (!sheetHero(app)) continue; syncHeader(app, app.element); syncPersonal(app, app.element); }
  } catch (err) { console.warn(`${MOD} | base entry sync failed`, err); }
  syncParty();
}

/* ------------------------------------------------------------------ 4. party panel button */
function partyTarget() {
  const mine = game.actors.filter((a) => a.type === "superhero" && a.isOwner && !S.isStaff(game.user)).concat(game.user.character ? [game.user.character] : []);
  for (const a of mine) if (S.find(a)) return { actor: a };
  return null;
}
async function partyClick() {
  const tgt = partyTarget();
  if (tgt) return openFor(tgt.actor);
  if (S.isStaff() || S.list().length) return pick();
  const hero = game.actors.find((a) => a.type === "superhero" && a.isOwner);
  if (hero) return openFor(hero);
  return null;
}
/** The keybinding "Open my team card" and the party button share this: the card of the user's hero, else the list (GM) / the only card / the hero's create window. */
export function openMine() { return partyClick(); }
function partyWanted() {
  return S.isStaff() || S.list().length > 0 || game.actors.some((a) => a.type === "superhero" && a.isOwner);
}
function syncParty() {
  const root = document.getElementById("invincible-party");
  if (!root) return;
  let btn = root.querySelector(".ipb-party-btn");
  if (!partyWanted() || setting("baseHeaderButton", true) === false) { btn?.remove(); return; }
  const handle = root.querySelector(".ipt-handle");
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ipb-party-btn";
    btn.dataset.tooltip = t("IPB.Entry.Party");
    btn.dataset.tooltipDirection = "RIGHT";
    btn.setAttribute("aria-label", t("IPB.Entry.Party"));
    btn.innerHTML = icon(ICON);
    btn.addEventListener("click", (ev) => { ev.preventDefault(); partyClick(); });
    root.append(btn);
  }
  const place = () => root.style.setProperty("--ipb-hw", `${handle?.offsetWidth ?? 90}px`);
  place();
  if (handle && !handle._ipbWatch) { handle._ipbWatch = true; new ResizeObserver(place).observe(handle); }
}
let partyWatch = null;
function watchParty() {
  syncParty();
  partyWatch?.disconnect();
  let queued = false;
  partyWatch = new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; if (!document.getElementById("invincible-party")?.querySelector(".ipb-party-btn")) syncParty(); }); });
  partyWatch.observe(document.body, { childList: true });
}

/* ------------------------------------------------------------------ 5. chat button */
function chatButtons(message, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  Join.bind(message, root, (err) => { console.warn(`${MOD} | base: join request`, err); ui.notifications?.error(err?.message ?? String(err), { console: false }); });   // B11: Approve / Decline (GM)
  for (const b of root?.querySelectorAll?.('[data-action="ipb-open-team"]') ?? []) {
    if (b._ipbBound) continue;
    b._ipbBound = true;
    b.addEventListener("click", (ev) => { ev.preventDefault(); open(b.dataset.team); });
  }
}

/* ------------------------------------------------------------------ hooks + start */
let refreshTimer = 0;
function refreshAll(teamId, actorId) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    BaseSheet?.refresh({ teamId });
    NewTeamApp?.refresh({ actorId });
    PickerApp?.refresh();
    syncSheets();
  }, 60);
}
const isCard = (doc) => S.isCard(doc);
/** B9 (was in tabs/gear.mjs): a vehicle listed on some card changed (stats, weapons, deleted): repaint the open sheets (Gear & vehicles reads it live). */
function watchVehicle(actor) {
  if (actor?.documentName !== "Actor" || actor.type !== "vehicle" || isCard(actor)) return;
  if (game.actors.some((c) => isCard(c) && Object.values(S.rawData(c).vehicles ?? {}).some((v) => v.uuid === actor.uuid))) refreshAll(null, null);
}

/** called when the client setting baseHeaderButton changes */
export function syncAll() { syncSheets(); }

export function start() {
  if (started) return;
  started = true;
  on("renderApplicationV2", (app, element) => { syncHeader(app, element); syncPersonal(app, element); });
  on("getHeaderControlsInvincibleActorSheet", (app, controls) => {
    const actor = sheetHero(app);
    if (!actor) return;
    controls.push({ action: "ipbTeam", icon: ICON, label: t("IPB.Entry.Button"), visible: () => actor.isOwner || !!S.find(actor), onClick: () => openFor(actor) });
  });
  // the base itself (an Actor) or a hero changed / appeared / went away: repaint what shows them
  on("updateActor", (actor) => { if (isCard(actor)) refreshAll(actor.id, null); else if (actor.type === "superhero") refreshAll(S.linkOf(actor) || null, actor.id); else watchVehicle(actor); });
  on("createActor", (actor) => { if (isCard(actor) || actor.type === "superhero") refreshAll(null, null); });
  on("deleteActor", (actor) => { if (isCard(actor) || actor.type === "superhero") refreshAll(null, null); else watchVehicle(actor); });
  for (const h of ["createItem", "updateItem", "deleteItem"]) on(h, (item) => watchVehicle(item?.parent));          // weapons on a team vehicle count in its stats
  on("renderChatMessageHTML", chatButtons);
  watchParty();
  syncSheets();
}
export function stop() {
  for (const [name, id] of hooks.splice(0)) { try { Hooks.off(name, id); } catch { /* gone */ } }
  partyWatch?.disconnect();
  document.querySelectorAll("[data-ipb-open], .ipb-personal, .ipb-party-btn").forEach((el) => el.remove());
  started = false;
}
