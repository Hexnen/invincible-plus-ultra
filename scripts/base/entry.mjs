/* Team & Base card ENTRY POINTS (phase B4). Does nothing heavy until a click: the window (window.mjs) and the picker are imported on first use.
   Entry points (all open the same window; one window per team, a second click focuses it):
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

const MOD = S.MODULE_ID;
const ICON = "fa-solid fa-people-roof";
let BaseApp = null, PickerApp = null;
let started = false;
const hooks = [];
const on = (name, fn) => hooks.push([name, Hooks.on(name, fn)]);
const setting = (key, fallback) => { try { return game.settings.get(MOD, key); } catch { return fallback; } };

async function loadWindow() { return (BaseApp ??= (await import("./window.mjs")).BaseApp); }
async function loadPicker() { return (PickerApp ??= (await import("./picker.mjs")).PickerApp); }

/* ------------------------------------------------------------------ api: open / openFor / pick */
const asActor = (ref) => (typeof ref === "string" ? (game.actors.get(ref) ?? (ref.includes(".") ? fromUuidSync(ref) : null)) : ref);
const isActor = (ref) => ref?.documentName === "Actor" || (typeof ref === "string" && !!game.actors.get(ref));

/** open(team | actor | nothing, {tab}) -> the window (or the picker without an argument, or null when nothing could be opened) */
export async function open(ref, opts = {}) {
  if (!ref) return pick();
  if (isActor(ref)) return openFor(asActor(ref), opts);
  let team;
  try { team = S.view(ref); } catch { ui.notifications?.warn(t("IPB.Entry.Deleted")); return null; }
  const Win = await loadWindow();
  return Win.open({ team: team.id, tab: opts.tab ?? null });
}
/** openFor(actor, {tab}) -> the window of the hero's team, or the create / join / ask window when it has none */
export async function openFor(actorRef, opts = {}) {
  const actor = asActor(actorRef);
  if (!actor || actor.type !== "superhero") { ui.notifications?.warn(t("IPB.Entry.NotHero")); return null; }
  const team = S.find(actor);
  const Win = await loadWindow();
  if (team) return Win.open({ team: team.id, tab: opts.tab ?? null });
  if (!actor.isOwner && !S.isStaff()) { ui.notifications?.info(t("IPB.Entry.RowNone")); return null; }
  return Win.open({ actor });
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
      + `<button type="button" class="ipb-pr-btn" data-ipb-open aria-label="${esc(t("IPB.Entry.RowOpenAria", { team: team.name }))}">${icon(ICON)} ${esc(t("IPB.Entry.RowOpen"))}</button>`;
  } else {
    const label = canMake || S.list().length ? t("IPB.Entry.RowCreate") : t("IPB.Entry.RowAsk");
    body = `<span class="ipb-pr-text ipb-pr-meta">${esc(t("IPB.Entry.RowNone"))}</span><button type="button" class="ipb-pr-btn" data-ipb-open>${icon(ICON)} ${esc(label)}</button>`;
  }
  return body;
}
function syncPersonal(app, root) {
  const actor = sheetHero(app);
  const el = root ?? app?.element;
  if (!actor || !el?.querySelector) return;
  const field = el.querySelector('section.tab.personal [name="system.teamBase"]');
  const group = field?.closest(".form-group");
  const existing = el.querySelector(".ipb-personal");
  if (!group || !(actor.isOwner || S.find(actor))) { existing?.remove(); return; }
  const row = existing ?? Object.assign(document.createElement("div"), { className: "form-group ipb-personal" });
  if (!existing) {
    row.addEventListener("click", (ev) => { if (ev.target.closest("[data-ipb-open]")) openFor(actor); });
    group.after(row);
  }
  const html = `<label>${esc(t("IPB.Entry.RowLabel"))}</label><div class="form-fields ipb-pr-body">${personalRow(actor)}</div>`;
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
function chatButtons(_message, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
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
    BaseApp?.refresh({ teamId, actorId });
    PickerApp?.refresh();
    syncSheets();
  }, 60);
}
const isCard = (doc) => S.isCard(doc);

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
  on("updateJournalEntry", (entry) => { if (isCard(entry)) refreshAll(entry.id, null); });
  on("createJournalEntry", (entry) => { if (isCard(entry)) refreshAll(null, null); });
  on("deleteJournalEntry", (entry) => { if (entry.flags?.[MOD]?.base) refreshAll(null, null); });
  on("updateActor", (actor) => { if (actor.type === "superhero") refreshAll(S.linkOf(actor) || null, actor.id); });
  on("createActor", (actor) => { if (actor.type === "superhero") refreshAll(null, null); });
  on("deleteActor", (actor) => { if (actor.type === "superhero") refreshAll(null, null); });
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
