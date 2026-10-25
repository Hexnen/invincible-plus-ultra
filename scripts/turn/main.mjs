/* Player turn UX, part of Invincible - Plus Ultra. Started from scripts/module.js by a guarded dynamic import (start() below), the same way as the
   combat banners, the party cards and the splash: a file added to module.json would need a server restart, an import from an already registered
   script does not. Four things, all per client:
     1. YOUR TURN message in the middle of the screen when the active combat's turn reaches a combatant the user owns (message.mjs);
     2. an ACTION TRAY above the macro bar (tray.mjs): the user's characters in the running combat, one toggle per action slot, End turn;
     3. an END TURN confirmation (DialogV2) naming the character and the actions still unused;
     4. an "all actions used, end the turn?" prompt when the user marks the last free action.

   WHAT THE DATA IS (read from yze-combat 1.7.0 and Foundry core 14; see scripts/yze.mjs):
     - The turn is the core pair combat.turn / combat.combatant. A token with speed N is N combatants with the same tokenId.
     - Action usage = status effects on the ACTOR ("fastAction" / "slowAction", or "action1".."action9" with singleAction), toggled with
       Actor#toggleStatusEffect. The yze tracker button does `active = !combatant[prop]` (a flag that is normally unset) then
       `if (!active) combatant.unsetFlag("yze-combat", prop)` and `actor.toggleStatusEffect(id, { active })`. This file calls the same two public
       APIs but computes `active` from the real status (so a second click really un-marks) and unsets the flag only when it is present.
       The pip groups per entry come from party/actions.mjs groupsFor() (shared with the initiative bar and the party cards).
     - Ending a turn: core's tracker control calls combat.nextTurn() and shows it to the owner of the current combatant
       (CombatTracker `isPlayerTurn = combat.combatant.players.includes(game.user)`); the base Combat document lets a non-GM update exactly
       {round, turn, combatants} (common/documents/combat.mjs #canUpdate -> _canChangeTurn / _canChangeRound return true). So a player calls
       combat.nextTurn() directly. EXCEPTION: when the turn would roll over into a new round, yze-combat's nextRound() resets and redraws every
       combatant's initiative (updates the player cannot make) so that case is relayed to the active GM through socketlib (needs "socket": true in
       module.json and a server restart; without it the player gets a clear notification). The GM client validates that the requesting user owns
       combat.combatant before it advances.
   WHEN THE MESSAGE FIRES: updateCombat on every client (like combat/main.mjs), debounced, and only when combat.combatant really becomes the user's:
   no message while yze's initiative is null / being redrawn (yzeWaiting), de-duplicated per (combat id, round, combatant id), a new message only
   after the current combatant was someone else (or nobody) in between. */
import * as Msg from "./message.mjs";
import * as Tray from "./tray.mjs";
import { t } from "./lang.mjs";
import { yzeOn, yzeWaiting, yzeMode, actorOf, hasStatus, MODULE as YZE } from "../yze.mjs";
import { pickCombat, groupsFor } from "../party/actions.mjs";

const MOD = "invincible-plus-ultra";
const SYSTEM = "invincible";
const LOG = `${MOD} (turn) |`;
const KEY = { message: "turnMessage", tray: "turnTray", confirm: "turnConfirm", askAll: "turnAskAll", gm: "turnGm", sound: "turnSound", playersEnd: "turnPlayersEnd" };

let started = false, ready = false, down = false;
const hookIds = [];
const lastKey = new Map();      // combat id -> the (round:combatant) key last seen as the turn, or null (nobody / waiting)
const quiet = new Set();        // combat ids where the user ticked "don't ask again" (session only)
let pinned = null;              // { key, turnKey }: the character tab the user picked, valid while the turn stays where it was
let model = null, askCtx = null, ending = false, busy = false, sock = null;
let timer = 0, evalTimer = 0, raf = 0, waitAt = 0, ro = null;

const get = (key) => { try { return game.settings.get(MOD, key); } catch { return undefined; } };
const msgOn = () => get(KEY.message) !== false;
const trayOn = () => get(KEY.tray) !== false;
const gmOn = () => get(KEY.gm) === true;
const playersEnd = () => get(KEY.playersEnd) !== false;

/* ---------- settings (registered in init) ---------- */
function registerSettings() {
  const has = (key) => game.settings.settings.has(`${MOD}.${key}`);
  const bool = (key, name, def, extra = {}) => {
    if (!has(key)) game.settings.register(MOD, key, { name: t(`ITN.Settings.${name}.Name`), hint: t(`ITN.Settings.${name}.Hint`), scope: "client", config: true, type: Boolean, default: def, ...extra });
  };
  bool(KEY.message, "Message", true, { onChange: (v) => { if (!v) Msg.clear(); } });
  bool(KEY.tray, "Tray", true, { onChange: () => refresh() });
  bool(KEY.confirm, "Confirm", true);
  bool(KEY.askAll, "AskAll", true);
  bool(KEY.gm, "GM", false, { onChange: () => refresh() });
  bool(KEY.sound, "Sound", false);
  bool(KEY.playersEnd, "PlayersEnd", true, { scope: "world", onChange: () => refresh() });
}

/* ---------- who is mine ---------- */
const keyOf = (c) => c?.tokenId ?? `c:${c?.id}`;
function owns(c) {
  try {
    if (!c) return false;
    if (game.user.isGM) return gmOn();
    const a = actorOf(c);
    return !!(a ? a.isOwner : c.isOwner);
  } catch { return false; }
}
const isVideo = (s) => /\.(webm|mp4|m4v|ogv)(\?|$)/i.test(String(s ?? ""));
function portraitOf(c) {
  const a = actorOf(c);
  const cand = [c?.img, c?.token?.texture?.src, a?.img].filter(Boolean);
  return cand.find((s) => !isVideo(s)) ?? null;
}
function waitingNow(combat) { return yzeOn() && yzeWaiting(combat); }
function turnSig(combat) {
  const c = combat?.combatant;
  return c && !waitingNow(combat) ? `${combat.round}:${c.id}` : null;
}

/* ---------- the message ---------- */
function evalTurn(silent = false) {
  try {
    const combat = pickCombat();
    if (!combat) return;
    const sig = turnSig(combat);
    const prev = lastKey.get(combat.id);
    lastKey.set(combat.id, sig);
    if (!sig) { waitAt = performance.now(); return; }
    if (silent || sig === prev || !ready || down || !msgOn()) return;
    const c = combat.combatant;
    if (!owns(c)) return;
    const entries = (combat.turns ?? []).filter((x) => keyOf(x) === keyOf(c));
    const n = entries.length, k = entries.findIndex((x) => x.id === c.id) + 1;
    Msg.show({ title: t("ITN.Msg.Title"), name: c.name, img: portraitOf(c), entry: n > 1 ? t("ITN.Msg.Entry", { k, n }) : "" });
    if (get(KEY.sound)) {
      try { foundry.audio.AudioHelper.play({ src: "sounds/notify.wav", volume: Number(game.settings.get("core", "globalInterfaceVolume")) || 0.5, autoplay: true, loop: false }, false); } catch { /* no sound */ }
    }
  } catch (e) { console.warn(LOG, "message failed", e); }
}
/* the redraw sequence of yze's resetEachRound (initiative nulled, redrawn, then the round update) is several updates: settle first */
function scheduleTurn() {
  clearTimeout(evalTimer);
  const sinceWait = performance.now() - waitAt;
  evalTimer = setTimeout(() => evalTurn(false), sinceWait < 2500 ? 800 : 280);
}

/* ---------- the tray model ---------- */
function buildModel() {
  const combat = pickCombat();
  if (!trayOn() || !combat || down) return { show: false };
  const waiting = waitingNow(combat);
  const turnC = waiting ? null : combat.combatant;
  const rows = new Map();
  if (game.user.isGM) { if (gmOn() && turnC) rows.set(keyOf(turnC), turnC); }
  else for (const c of combat.turns ?? []) if (!c.isDefeated && owns(c) && !rows.has(keyOf(c))) rows.set(keyOf(c), c);
  if (!rows.size) return { show: false };
  const turnKey = turnC ? keyOf(turnC) : null;
  const keys = [...rows.keys()];
  const selKey = pinned && pinned.turnKey === turnKey && rows.has(pinned.key) ? pinned.key : (turnKey && rows.has(turnKey) ? turnKey : keys[0]);
  const c0 = rows.get(selKey);
  const isTurn = selKey === turnKey;
  const shown = isTurn ? turnC : c0;
  const actor = actorOf(c0);
  let pips = [], lone = true, slot = 1;
  if (yzeOn() && yzeMode() !== "none" && c0.tokenId && actor) {
    const groups = groupsFor([c0.tokenId], actor, combat);
    if (groups?.length) {
      const g = groups.find((x) => x.active) ?? groups.find((x) => x.pips.some((p) => p.state !== "past")) ?? groups.at(-1);
      slot = g.slot;
      pips = g.pips.map((p) => {
        const id = p.k === "fast" ? "fastAction" : p.k === "slow" ? "slowAction" : `action${g.slot}`;
        const state = p.state === "used" ? "used" : "open";
        const disabled = waiting || p.state === "past";
        return { id, k: p.k, label: t(`ITN.Act.${p.k}`), state, disabled, armed: isTurn && state === "open" && !disabled,
          tip: waiting ? t("ITN.Act.Tip.Wait") : state === "used" ? t("ITN.Act.Tip.Unmark") : t("ITN.Act.Tip.Mark") };
      });
      lone = false;
    }
  }
  const allowed = game.user.isGM || playersEnd();
  const enabled = isTurn && !waiting && allowed;
  const tip = enabled ? t("ITN.End.Tip") : waiting ? t("ITN.End.Off.Wait") : !isTurn ? t("ITN.End.Off.NotTurn") : t("ITN.End.Off.GM");
  return {
    show: true, combat, round: combat.round, rows: keys.map((k) => ({ key: k, name: rows.get(k).name, img: portraitOf(rows.get(k)), isTurn: k === turnKey })),
    sel: selKey, selKey, isTurn, c: shown, actor, slot, pips, lone, who: { name: shown.name, img: portraitOf(shown) },
    end: { enabled, tip }
  };
}

function refresh() {
  if (!ready) return;
  try {
    model = buildModel();
    Tray.render(model);
    watch();
    checkAsk();
  } catch (e) { console.warn(LOG, "refresh failed", e); }
}
function schedule() { clearTimeout(timer); timer = setTimeout(refresh, 50); }

/* keep the tray placed when the layout around it moves */
function watch() {
  if (!window.ResizeObserver) return;
  ro ??= new ResizeObserver(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; Tray.relayout(); }); });
  for (const id of ["hotbar", "sidebar", "invincible-party", "chat-notifications", "players"]) {
    const el = document.getElementById(id);
    if (el && el.dataset.ittWatched !== "1") { el.dataset.ittWatched = "1"; ro.observe(el); }
  }
}

/* ---------- actions ---------- */
function notify(kind, text) { try { ui.notifications[kind](text, { console: false }); } catch { /* no ui */ } }

async function togglePip(id) {
  const m = model;
  if (!m?.show || busy) return;
  const pip = m.pips.find((p) => p.id === id);
  if (!pip || pip.disabled || !m.actor) return;
  busy = true;
  const active = !hasStatus(m.actor, id);
  try {
    await m.actor.toggleStatusEffect(id, { active });
    if (!active && m.c?.getFlag?.(YZE, id)) { try { await m.c.unsetFlag(YZE, id); } catch { /* flag not ours to unset */ } }
  } catch (e) {
    console.warn(LOG, "toggle failed", e);
    notify("warn", t("ITN.Note.Failed", { why: e?.message ?? String(e) }));
  } finally { busy = false; }
  refresh();
  if (active) maybeAskAll();
}

function unusedList(m) { return (m.pips ?? []).filter((p) => p.state === "open").map((p) => p.label); }
const esc = (s) => foundry.utils.escapeHTML?.(String(s)) ?? String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

function openDialog({ title, content, buttons, cls }) {
  const { DialogV2 } = foundry.applications.api;
  return new Promise((resolve) => {
    const dlg = new DialogV2({ window: { title, icon: "fa-solid fa-forward-step" }, classes: ["itn-dialog", cls], position: { width: 360 }, content, buttons, modal: false, submit: (result) => resolve(result) });
    dlg.addEventListener("close", () => resolve(null), { once: true });
    dlg.render({ force: true });
    openDialog.last = dlg;
  });
}

async function confirmEnd(m) {
  const unused = unusedList(m);
  const content = `<p class="itn-body">${esc(t("ITN.Confirm.Body", { name: m.who.name }))}</p>`
    + (unused.length ? `<p class="itn-warn"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>${esc(t("ITN.Confirm.Unused", { list: unused.join(", ") }))}</span></p>` : "");
  const res = await openDialog({
    title: t("ITN.Confirm.Title"), content, cls: "itn-confirm",
    buttons: [
      { action: "end", label: t("ITN.Confirm.Yes"), icon: "fa-solid fa-forward-step", default: true, callback: () => ({ action: "end" }) },
      { action: "cancel", label: t("ITN.Confirm.No"), callback: () => ({ action: "cancel" }) }
    ]
  });
  return res?.action === "end";
}

/* the last free action was just marked: offer to end the turn */
async function maybeAskAll() {
  const m = model;
  if (!m?.show || !m.isTurn || !m.pips.length || !m.pips.every((p) => p.state === "used")) return;
  if (get(KEY.askAll) === false || quiet.has(m.combat.id) || askCtx || ending || !m.end.enabled) return;
  const sig = turnSig(m.combat);
  const ctx = { sig, key: m.selKey, dlg: null };
  askCtx = ctx;
  const content = `<p class="itn-body">${esc(t("ITN.All.Body"))}</p>`
    + `<label class="itn-never"><input type="checkbox" name="never"><span>${esc(t("ITN.All.Never"))}</span></label>`;
  const p = openDialog({
    title: t("ITN.All.Title"), content, cls: "itn-all",
    buttons: [
      { action: "end", label: t("ITN.All.Yes"), icon: "fa-solid fa-forward-step", callback: (ev, btn) => ({ action: "end", never: !!btn.form?.elements?.never?.checked }) },
      { action: "no", label: t("ITN.All.No"), default: true, callback: (ev, btn) => ({ action: "no", never: !!btn.form?.elements?.never?.checked }) }
    ]
  });
  ctx.dlg = openDialog.last;
  const res = await p;
  if (askCtx === ctx) askCtx = null;
  if (res?.never) quiet.add(m.combat.id);
  if (res?.action === "end") await endTurn({ confirmed: true });
}

/* the turn moved on or an action was un-marked while the prompt was open: close it */
function checkAsk() {
  if (!askCtx) return;
  const m = model, c = askCtx;
  const still = m?.show && m.isTurn && m.selKey === c.key && turnSig(m.combat) === c.sig && m.pips.length && m.pips.every((p) => p.state === "used");
  if (still) return;
  askCtx = null;
  try { c.dlg?.close(); } catch { /* already closed */ }
}

/* would nextTurn() start a new round? (core Combat#nextTurn) */
function wraps(combat) {
  const turn = combat.turn ?? -1, turns = combat.turns ?? [];
  let next = null;
  if (combat.settings?.skipDefeated) { for (let i = turn + 1; i < turns.length; i++) if (!turns[i].isDefeated) { next = i; break; } }
  else next = turn + 1;
  return next === null || next >= turns.length;
}

async function endTurn({ confirmed = false } = {}) {
  const m = model;
  if (ending) return;
  if (!m?.show || !m.end.enabled) return;
  const combat = m.combat, sig = turnSig(combat);
  ending = true;
  try {
    if (!confirmed && get(KEY.confirm) !== false && !(await confirmEnd(m))) return;
    const fresh = pickCombat();
    if (!fresh || fresh.id !== combat.id || turnSig(fresh) !== sig) { notify("info", t("ITN.Note.NotYours")); return; }
    if (game.user.isGM) { await fresh.nextTurn(); return; }
    if (!wraps(fresh)) {
      try { await fresh.nextTurn(); return; } catch (e) { console.warn(LOG, "direct nextTurn refused, relaying", e); }
    }
    await relay(fresh);
  } catch (e) {
    console.warn(LOG, "end turn failed", e);
    notify("warn", t("ITN.Note.Failed", { why: e?.message ?? String(e) }));
  } finally { ending = false; refresh(); }
}

/* ---------- relay to the GM (socketlib; needs "socket": true in module.json) ---------- */
function setupSocket() {
  try {
    if (sock || !globalThis.socketlib || !game.modules.get("socketlib")?.active || !game.modules.get(MOD)?.socket) return;
    sock = globalThis.socketlib.registerModule(MOD) ?? null;
    sock?.register("endTurn", relayEndTurn);
  } catch (e) { console.warn(LOG, "socket not available", e); sock = null; }
}
/* runs on the active GM's client */
async function relayEndTurn(combatId, combatantId, round) {
  const user = game.users.get(this?.socketdata?.userId);
  const combat = game.combats.get(combatId);
  const c = combat?.combatant;
  const a = actorOf(c);
  if (!user || !combat || !c || c.id !== combatantId || combat.round !== round) return { ok: false, why: "stale" };
  if (!playersEnd()) return { ok: false, why: "disabled" };
  if (!(a?.testUserPermission(user, "OWNER") ?? c.testUserPermission?.(user, "OWNER"))) return { ok: false, why: "not owner" };
  await combat.nextTurn();
  return { ok: true };
}
async function relay(combat) {
  setupSocket();
  if (!sock) { notify("warn", t("ITN.Note.NoRelay")); return; }
  if (!game.users.activeGM) { notify("warn", t("ITN.Note.NoGM")); return; }
  const res = await sock.executeAsGM("endTurn", combat.id, combat.combatant.id, combat.round);
  if (res && res.ok === false) notify("warn", t("ITN.Note.Failed", { why: res.why }));
}

/* ---------- hooks ---------- */
function on(name, fn) { hookIds.push([name, Hooks.on(name, fn)]); }
function registerHooks() {
  if (hookIds.length) return;
  on("updateCombat", (combat, changes) => {
    schedule();
    if (changes && ("turn" in changes || "round" in changes || "active" in changes)) scheduleTurn();
  });
  on("createCombat", () => schedule());
  on("deleteCombat", (combat) => { lastKey.delete(combat.id); quiet.delete(combat.id); schedule(); });
  for (const h of ["createCombatant", "updateCombatant", "deleteCombatant"]) on(h, () => { schedule(); });
  const fx = (e) => { try { if (e?.parent?.documentName === "Actor") schedule(); } catch { /* ignore */ } };
  on("createActiveEffect", fx); on("updateActiveEffect", fx); on("deleteActiveEffect", fx);
  on("updateActor", (_a, changes) => { if (changes && ("ownership" in changes || "name" in changes || "img" in changes)) schedule(); });
  on("updateToken", (_t, changes) => { if (changes && ("name" in changes || "texture" in changes || "actorLink" in changes)) schedule(); });
  on("canvasReady", () => {
    down = false;
    const combat = pickCombat();
    if (combat && !lastKey.has(combat.id)) lastKey.set(combat.id, turnSig(combat));   // a combat already running on the scene we just opened: no message for a turn that began earlier
    schedule();
  });
  on("canvasTearDown", () => { down = true; Msg.clear(); Tray.hide(); });
  on("collapseSidebar", () => { Tray.relayout(); setTimeout(() => Tray.relayout(), 320); });
  on("changeSidebarTab", () => { Tray.relayout(); setTimeout(() => Tray.relayout(), 300); });
  on("renderHotbar", () => { Tray.relayout(); setTimeout(() => Tray.relayout(), 320); });
  on("renderPlayers", () => Tray.relayout());
  on("i18nInit", () => { Tray.destroy(); schedule(); });
}

function onResize() { Msg.relayout(); Tray.relayout(); }

function onReady() {
  try {
    ready = true;
    down = !canvas?.scene;
    for (const c of game.combats ?? []) lastKey.set(c.id, turnSig(c));   // joined mid-combat: whoever has the turn already had the message
    Tray.configure({
      onPip: togglePip,
      onEnd: () => endTurn(),
      onPick: (key) => { pinned = { key, turnKey: model?.rows?.find((r) => r.isTurn)?.key ?? null }; refresh(); }
    });
    setupSocket();
    window.addEventListener("resize", onResize);
    const mod = game.modules.get(MOD);
    if (mod) mod.api = { ...(mod.api ?? {}), turn: { preview, refresh, stop } };
    refresh();
    console.log(`${LOG} ready`);
  } catch (e) { console.warn(LOG, "ready failed", e); }
}

/* game.modules.get("invincible-plus-ultra").api.turn.preview(): the message without a combat */
function preview(name = "Preview Hero", entry = "") {
  Msg.show({ title: t("ITN.Msg.Title"), name, img: null, entry });
}

/* ---------- start / stop (called from module.js; both idempotent) ---------- */
export function start(phases = {}) {
  if (started) return;
  started = true;
  const run = (name, fn) => { if (phases[name]) fn(); else Hooks.once(name, fn); };
  run("init", () => {
    try {
      if (game.system.id !== SYSTEM) return;
      registerSettings();
      registerHooks();
      run("ready", onReady);
    } catch (e) { console.warn(LOG, "start failed", e); }
  });
}

export function stop() {
  for (const [name, id] of hookIds.splice(0)) { try { Hooks.off(name, id); } catch { /* gone */ } }
  window.removeEventListener("resize", onResize);
  clearTimeout(timer); clearTimeout(evalTimer); cancelAnimationFrame(raf); raf = 0;
  ro?.disconnect(); ro = null;
  try { askCtx?.dlg?.close(); } catch { /* ignore */ }
  askCtx = null;
  Msg.destroy(); Tray.destroy();
  lastKey.clear(); quiet.clear();
  ready = false; started = false;
}
