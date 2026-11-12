/* Tactical combat, the surfaces: WIRING. Started by tactics/main.mjs only when tactical combat runs on this world (so with the setting
   off none of this is even imported). Builds the two surfaces from the models and redraws them when the fight changes:
     the action dock (dock.mjs)   every user: api.tactics.player(); for staff the bar of the combatant whose turn it is (the GM drives NPCs
                                  with the same dock, spec 13.3), built with the same barModel from the full state
     the GM desk (desk.mjs)       staff only: api.tactics.desk()
   What a click sends is the request found in the render data (model-pure.mjs), through api.tactics.request; an error is shown as a
   notification in the user's language. The surfaces' own state (armed action, picked targets, drafts, open panels) lives here and is
   never part of the fight. While the dock shows, the turn tray stands down (scripts/turn/main.mjs asks api.tactics.ui.active()) and the
   minimal prompt dialogs are not opened (prompts.mjs keeps only the end-of-scene confirmation).
   MOVEMENT (P3): the map answers "where", the dock answers "how". Arming Move starts the map's own zone pick over the zones one action
   reaches (zones-adapter.pick; shown to this client only); a token dragged into another zone lands in the same panel with that zone
   chosen (movement.setDragSurface), so the price is confirmed in one place. The move itself is a request like any other.
   Everything is in try / catch: a failure here must not break the tracker. */
import * as Store from "../store.mjs";
import * as Sys from "../system-adapter.mjs";
import * as Engine from "../engine.mjs";
import * as Zones from "../zones-adapter.mjs";
import * as Mv from "../movement.mjs";
import { tacticsApi as Api } from "../api.mjs";
import { t as langT, errText, rollTitle } from "../lang.mjs";
import * as Model from "./model-pure.mjs";
import * as RW from "../rollwatch-pure.mjs";
import { plain } from "../../kit.mjs";      // U93: a notification cannot draw a mark: it says its name
import * as Keys from "./keys-pure.mjs";
import * as Dock from "./dock.mjs";
import * as Desk from "./desk.mjs";
import * as Pick from "./pick.mjs";
import * as Board from "./board.mjs";
import * as Feedback from "./feedback.mjs";
import * as Camera from "./camera.mjs";
import * as Lay from "./layout-pure.mjs";
import * as Tip from "./tip.mjs";
import { visibleRect } from "./dom.mjs";
import { setVar } from "./vars.mjs";
import * as Slots from "./slots.mjs";        // U132: the fixed places (the frame the dock works out)

const MOD = Store.MOD, LOG = `${MOD} (tactics ui) |`;
const t = langT;
const NARROW = 1180;                       // with less room than this between the window's left edge and the sidebar the desk starts folded
const blankDock = () => ({ sel: null, armed: null, mode: null, targets: [], tokens: [], text: "", amend: null, endArmed: false, peek: false, weapon: null, opts: {}, picks: {}, texts: {}, quiet: false, to: null, ask: null, why: "", zone: {}, dragged: false, opt: null, attr: null, kopt: null });
const blankDesk = () => ({ tab: "now", collapsed: false, touched: false, override: null, undo: null, sure: null, drift: null, vals: {}, manual: {}, picks: {}, texts: {}, always: {}, zone: {}, force: {}, hazard: {}, karma: {}, scene: {}, kit: {}, folds: {} });
let started = false, down = false, timer = 0, raf = 0, ro = null, turnKey = null;
/* U28: Foundry's macro bar is folded away while the dock is up; the dock's keyboard button brings it back.
   U64: that choice, the key marks, the desk open or folded and the folded parts of its Table tab are THE USER'S LAYOUT
   (layout-pure.mjs): kept in a flag on the user's own document, so they come back in the next session and on another machine. What
   this browser remembered before (localStorage) seeds a user who has no layout yet. Read once when the surfaces start; written a
   moment after a change (one write for a burst of clicks). */
const HOTBAR_KEY = `${MOD}.tactics.hotbar`, KEYS_ON = `${MOD}.tactics.keys`, LAYOUT_FLAG = "tacticsLayout";
const hotbarWas = () => { try { return globalThis.localStorage?.getItem(HOTBAR_KEY) === "1"; } catch { return false; } };
let st = { dock: { ...blankDock(), hotbar: false }, desk: blankDesk() };      // U152: folded at the start (layoutStart)
let layout = Lay.clean(null), saveTimer = 0;
const foldsNow = () => Object.fromEntries(Object.keys(Lay.FOLDS).map((k) => [k, Lay.folded(layout, k)]));
function layoutStart() {
  try {
    const raw = Store.userPref(LAYOUT_FLAG);
    let keys = false; try { keys = globalThis.localStorage?.getItem(KEYS_ON) === "1"; } catch { keys = false; }
    layout = Lay.clean(raw, { hotbar: hotbarWas(), keys });
    /* U152 (UX review 1): the macro bar starts folded under the dock in every session (a player who joins a fight saw Foundry's 1-0 row
       under the dock's own numbered actions, left open in some earlier session); opened with the dock's keyboard button it stays open
       for this session. The choice is still written to the layout, only no longer read back at the start. */
    st.dock.hotbar = false;
    Object.assign(st.desk, Lay.deskStart(layout) ?? {}, { folds: foldsNow() });
    if (layout.keys) document.body.classList.add("ita-keys");
  } catch (e) { console.warn(LOG, "layout failed", e); }
}
function remember(change) {
  try {
    const next = Lay.merge(layout, change);
    if (next === layout) return;
    layout = next; st.desk.folds = foldsNow();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { Store.saveUserPref(LAYOUT_FLAG, Lay.stored(layout)); }, 600);
  } catch (e) { console.warn(LOG, "layout failed", e); }
}
/* U62: THE SIZE of the dock, the desk and their cards: this browser's own setting (a slider, 80..140 %), separate from Foundry's
   interface scale. The stylesheet does the scaling (--ita-scale on the body); the placement runs again so both stand where they fit.
   `preview`: the slider being dragged in the settings window (shown at once, kept only when the settings are saved). */
function applyScale(preview) {
  try {
    const v = Lay.scaleOf(preview ?? Store.setting("tacticsUiScale", Lay.SCALE.def));
    if (v === Lay.SCALE.def) document.body.style.removeProperty("--ita-scale"); else document.body.style.setProperty("--ita-scale", Lay.factorOf(v));
    relayout(); setTimeout(relayout, 60);
  } catch (e) { console.warn(LOG, "scale failed", e); }
}
let hotbarShown = null;
function hotbarSync(on) {
  try {
    const open = !!on && !!st.dock.hotbar, fold = !!on && !st.dock.hotbar, key = `${open}|${fold}`;
    document.body.classList.toggle("ita-hotbar-open", open);
    document.body.classList.toggle("ita-hotbar-fold", fold);
    if (key === hotbarShown) return;
    const first = hotbarShown === null; hotbarShown = key;
    /* what stands on the macro bar (the map's director bar) finds its place again */
    if (!first || fold) setTimeout(() => { try { window.dispatchEvent(new Event("resize")); } catch { /* no window */ } }, 30);
  } catch { /* no body */ }
}
const previews = new Map();           // U: the engine's answer to "what would this declaration roll", per declaration and state (facts.preview)
let previewLast = null;
let rev = 0, moveMemo = null;             // the move options are counted once per change of the fight or of the map, not per keystroke
let lastModel = null, reachLast = null;      // W1: the bars the dock was built from (the board's menus read them); the last answer about who is in reach
const reaches = new Map();
let deskIdle = false;                     // U60: the desk's Now tab has nothing on it (no card, no action in progress)
/* U144: nothing is left of the turn on this seat's bar (model-pure `end.auto`): the turn is passed a moment later, by the same button a
   click would press (one press per turn: the key is the round, the card and the combatant; a refused press is not tried again) */
const AUTO_END_MS = 1500;
let autoKey = null, autoTimer = 0;
function autoEnd(combat, d) {
  const e = d?.show ? d.end : null, key = e?.auto && e.req ? `${combat?.id}:${e.req.round}:${e.req.slot}:${e.req.actor}` : null;
  if (key === autoKey) return;
  clearTimeout(autoTimer); autoKey = key;
  if (key) autoTimer = setTimeout(() => { try { const n = lastDock?.show ? lastDock.end : null; if (n?.auto && n.req && `${combatNow()?.id}:${n.req.round}:${n.req.slot}:${n.req.actor}` === key) Dock.press("end"); } catch (err) { console.warn(LOG, "auto end failed", err); } }, AUTO_END_MS);
}
let cardTop = { id: null, at: 0 };      // U143: the question card on top of the dock and since when it stands there (the keys' guard)
let lastDock = null, byPointer = true;      // U41: what the dock shows now (the keys act on it); was the focus put where it is by the pointer?
let zonePick = null, shownDock = "", shownDesk = "";      // what this client has on the map for the surfaces: a running pick, two highlights
let nudgeSaid = null;                     // U59: the nudge this client already said aloud
let cardsWere = null;                     // the ids of the desk's waiting cards at the last draw: a new one brings the Now tab forward (U12)
/* the room the map has: the window less an open sidebar (U6: with the sidebar open at 1366 px the desk, the dock and the map's own panels do not fit side by side) */
const mapWidth = () => { try { const sb = document.getElementById("sidebar"), r = sb?.getBoundingClientRect(); return r && r.width > 120 && r.left > window.innerWidth * 0.5 ? r.left : window.innerWidth; } catch { return window.innerWidth; } };

const combatNow = () => { try { const c = Store.currentCombat(); return c && Api.active(c) && Api.mode(c) !== "off" && (!c.scene || c.scene.id === globalThis.canvas?.scene?.id) ? c : null; } catch { return null; } };
const isVideo = (s) => /\.(webm|mp4|m4v|ogv)(\?|$)/i.test(String(s ?? ""));
const portrait = (cb) => [cb?.img, cb?.token?.texture?.src, Sys.actorOf(cb)?.img].filter(Boolean).find((s) => !isVideo(s)) ?? null;
const notify = (kind, text) => { try { ui.notifications[kind](plain(text), { console: false }); }      /* U93: a notification cannot draw a mark: it says its name */ catch { /* no ui */ } };

/** what the pure model may ask about the world (model-pure.mjs header); numbers only of actors this user may read */
function factsOf(combat) {
  const staff = Store.isStaff(game.user), view = Api.state(combat), ctx = Engine.context(combat);
  return {
    view, me: game.user.id, staff,
    c: (id) => { const cb = combat.combatants.get(id), base = cb ? ctx.c(id) : null; return base ? { name: base.name, npc: base.npc, kind: base.kind ?? null, img: portrait(cb), summonOf: cb.flags?.[Store.MOD]?.tactics?.summonOf ?? null } : null; },
    kit: (id) => ctx.kit(id), bonus: (id) => ctx.bonus?.(id) ?? null,                                                                  // P6: the abilities of a sheet this user may read (engine.context)
    attrs: (id) => { try { const a = Sys.actorOf(combat.combatants.get(id)); return a && (staff || a.isOwner || view?.revealed?.[id]?.stats) ? Sys.actorFacts(a)?.attrs ?? null : null; } catch { return null; } },
    userName: (u) => game.users.get(u)?.name ?? null, online: (u) => game.users.get(u)?.active === true,
    /* U60 (the desk's character tab, staff only): the sheet's Health and injuries as the engine reads them, and the slots of the turn */
    sheet: (id) => (staff ? ctx.c(id) : null), budget: (id) => { try { return staff && view?.ledger?.[id] ? Api.pure.economy.budget(view, id) : null; } catch { return null; } },
    rollBusy: (rid) => { const at = Sys.rollStarted(rid), left = at ? at + Sys.ROLL_RETRY_MS - Date.now() : 0; if (left > 0) busyRedraw(left); return left > 0; },      // U2: the throw is on its way: no "Roll" button yet; D120: drawn again when that time is up (the "Roll" button comes back)
    preview: (cid, decl) => previewOf(combat, view, cid, decl),
    /* W1: the play on the map (ui/board.mjs). `reach`: the engine's answer about every candidate of a declaration; `onMap`: does that
       combatant stand on this user's map (a token this user sees); `hazards`: what waits on a way of moving; `camera`: the map's switch */
    board: Zones.hasBoard(), reach: (cid, decl, ids) => reachOf(combat, view, cid, decl, ids),
    onMap: (id) => { try { return !!combat.combatants.get(id)?.token?.object?.visible; } catch { return false; } },
    hazards: (cid, zones, to) => Board.hazards(cid, zones, to), camera: () => Board.camera(),
    hidden: (id) => { try { const cb = combat.combatants.get(id); return cb?.hidden === true || cb?.token?.hidden === true; } catch { return false; } },
    /* P7: challenges and vehicles of the fight (no card, no ledger); their numbers only for staff */
    special: () => ctx.special().map((x) => {
      const cb = combat.combatants.get(x.id), f = staff ? Sys.actorFacts(Sys.actorOf(cb)) : null;
      return { ...x, img: portrait(cb), ...(f ? { health: f.health, maxHealth: f.maxHealth, resolve: f.resolve, maxResolve: f.maxResolve, vehicle: f.vehicle ?? null, timeUnit: f.timeUnit ?? null } : {}) };
    }),
    /* movement, only for a combatant this user drives; counted from this user's own view and the map (movement.mjs) */
    move: (id) => {
      try {
        const a = Sys.actorOf(combat.combatants.get(id));
        if (!a || !(staff || a.isOwner) || !Zones.available() || !Mv.api.installed()) return null;
        if (moveMemo?.key !== `${combat.id}:${id}:${rev}`) moveMemo = { key: `${combat.id}:${id}:${rev}`, value: { options: Mv.api.options(id), why: Mv.api.why(id) } };
        return moveMemo.value;
      } catch { return null; }
    },
    /* U102: the zone this user's own combatant stands in was wrecked already (the mark of the zone or the scene's counter, the two the
       attack flow reads [B2451]): the "wreck the zone" switch is not offered for it */
    wrecked: (id) => {
      try {
        const cb = combat.combatants.get(id), a = Sys.actorOf(cb), td = cb?.token;
        if (!a || !(staff || a.isOwner) || !td || !Zones.available()) return false;
        const p = Zones.placeOf(td), key = p?.zone ? String(p.zone).split(":")[0] : null;
        if (!key) return false;
        return !!Mv.levelStates(td, Zones.zoneOf(p.zone))?.wrecked || (Number(view?.counters?.[`zone:${key}:wrecked`]) || 0) > 0;
      } catch { return false; }
    },
    /* U29 / U30: Health and Resolve of a combatant this user drives (the bars of the dock's unit block); nobody else's numbers */
    vitals: (id) => { try { const a = Sys.actorOf(combat.combatants.get(id)); if (!a || !(staff || a.isOwner)) return null; const f = Sys.actorFacts(a); return f ? { health: f.health, maxHealth: f.maxHealth, resolve: f.resolve, maxResolve: f.maxResolve } : null; } catch { return null; } },
    resolve: (id) => { try { const a = Sys.actorOf(combat.combatants.get(id)); return a && staff ? Sys.actorFacts(a)?.resolve ?? null : null; } catch { return null; } },      // the desk's hint for an NPC out of Resolve
    weapons: (id) => { try { const a = Sys.actorOf(combat.combatants.get(id)); return a && (staff || a.isOwner) ? Sys.weaponList(a) : []; } catch { return []; } },      // [P4] what this user's own character can attack with
    doors: (id) => { try { const a = Sys.actorOf(combat.combatants.get(id)); return a && (staff || a.isOwner) ? Mv.api.doors(id) : []; } catch { return []; } },
    /* U8: the spot of a combatant this user drives (its own token: nothing a player does not see on the map) */
    where: (id) => { try { const cb = combat.combatants.get(id), a = Sys.actorOf(cb); return a && (staff || a.isOwner) && cb?.token && Zones.available() ? Zones.spotOf(cb.token) : null; } catch { return null; } },
    /* P5 (the hazard tool, staff only): the zones with somebody of the fight in them */
    places: () => {
      const by = new Map();
      if (!staff) return [];
      try { for (const id of Object.keys(view?.ledger ?? {})) { const cb = combat.combatants.get(id), z = cb?.token ? Zones.placeOf(cb.token)?.zone : null; if (z) by.set(z, [...(by.get(z) ?? []), id]); } } catch { /* the map is optional */ }
      return [...by].map(([zone, ids]) => ({ zone, ids }));
    },
    /* a zone reads as its badge on the map does: the map gives the number in the scene's numerals and the whole phrase in the user's
       language (zones-api.md section 22); on an older map the number is the id + 1 and the phrase is ours */
    zone: (spot) => { try { const p = Zones.place(spot); return p ? { id: Zones.zoneName(spot) ?? (Number.isInteger(p.id) ? p.id + 1 : null), title: Zones.zoneTitle(spot, { level: true }), level: p.level, floor: p.floor, area: p.area, roof: p.roof } : null; } catch { return null; } },
  };
}
/* THE POOL OF A DECLARATION (every number about one roll has one source): asked of the executor (op "preview", through the relay for a
   player), remembered per declaration and state of the fight; while the answer is on its way the last one for the same action stands.
   D94: ... and per state of the map and the sheets (`factsRev`), as the reach below: a sheet edit or a token put into another zone
   changed the chance over the tokens and left the panel's pool at the old number. One key for both (model-pure.previewKey). */
const previewKey = Model.previewKey;
function previewOf(combat, view, cid, decl) {
  try {
    const key = previewKey(combat.id, view?.rev, factsRev, cid, decl), hit = previews.get(key);
    if (hit) return hit.value !== undefined ? hit.value : previewLast?.who === `${cid}|${decl.action}` ? previewLast.value : null;
    previews.set(key, { value: undefined }); if (previews.size > 60) { previews.clear(); previews.set(key, { value: undefined }); }
    Api.request({ op: "preview", actor: cid, decl }, combat).then((env) => {
      const value = env?.ok ? env.preview ?? null : null;
      if (previews.has(key)) previews.set(key, { value });
      previewLast = { who: `${cid}|${decl.action}`, value };
      clearTimeout(timer); timer = setTimeout(refresh, 20);
    }).catch(() => { /* no number */ });
    return previewLast?.who === `${cid}|${decl.action}` ? previewLast.value : null;
  } catch { return null; }
}
/* W1 (U33 / U34): WHO IS IN REACH of a declaration and what a hit would do: one question to the executor per declaration and state of
   the fight (its own rev) or of the map and the sheets (`factsRev`), never per mouse move and never per redraw; while the answer is on its way the last one for the same action stands. */
function reachOf(combat, view, cid, decl, ids) {
  try {
    const who = `${cid}|${decl.action}`, key = previewKey(combat.id, view?.rev, factsRev, cid, decl, ids), hit = reaches.get(key), old = () => (reachLast?.who === who ? reachLast.value : null);
    if (hit) return hit.value !== undefined ? hit.value : old();
    if (reaches.size > 40) reaches.clear();
    reaches.set(key, { value: undefined });
    Api.request({ op: "preview", actor: cid, decl, of: ids.slice(0, 40) }, combat).then((env) => {
      const value = env?.ok ? env.preview?.per ?? null : null;
      if (reaches.has(key)) reaches.set(key, { value });
      reachLast = { who, value };
      clearTimeout(timer); timer = setTimeout(refresh, 20);
    }).catch(() => { /* no marks */ });
    return old();
  } catch { return null; }
}
/* D120: a chip that says the dice are on their way is drawn again when ROLL_RETRY_MS is up, also after a throw nobody clicked for (the
   relay's tcroll): it then offers "Roll" instead of saying "flying" for as long as nothing else redraws the dock */
let busyTimer = 0, busyAt = 0;
function busyRedraw(left) { const at = Date.now() + left + 120; if (busyTimer && busyAt <= at) return; clearTimeout(busyTimer); busyAt = at; busyTimer = setTimeout(() => { busyTimer = 0; schedule(); }, left + 120); }
/* U1 / U2: a roll button of the surfaces (model-pure.rollButtons `act`): the system's own roll, accept or push, on this client */
const acting = new Map();
async function rollAct(act) {
  try {
    const combat = combatNow(), state = combat ? Api.state(combat) : null;
    const r = state?.stack?.find((i) => i.id === act.inst)?.rolls?.[act.key];
    if (!r) return;
    const k = `${act.do}:${act.inst}:${act.key}`;
    if (Date.now() - (acting.get(k) ?? 0) < 2500) return;      // a second click while the first is on its way
    if (acting.size > 200) acting.clear();      // (the marks of clicks long answered are dropped: the map does not grow with the session)
    acting.set(k, Date.now());
    if (act.do === "roll") {
      if (!r.req?.rid || r.sixes != null) return;
      const actor = Sys.actorOf(combat.combatants.get(r.who));
      await Sys.rollNow({ combat: combat.id, inst: act.inst, key: act.key, rid: r.req.rid, actorUuid: actor?.uuid ?? null, attr: r.attr, pool: r.pool, dice: r.req.dice, maxPush: r.req.maxPush, label: rollTitle(act.key, r.req.label), ...(r.req.mode ? { mode: r.req.mode } : {}) },
        (s) => t(`ITAC.mod.${String(s).split(":")[0]}`, {}, String(s)), { force: true });
      setTimeout(refresh, Sys.ROLL_RETRY_MS + 100);
    } else if (r.messageId) await (act.do === "push" ? Sys.pushRoll(r.messageId) : Sys.acceptRoll(r.messageId));
    refresh();
  } catch (e) { console.warn(LOG, "roll action failed", e); notify("warn", t("ITAC.warn.rollDialog")); }
}
/* the dock's model for staff: the bar of whoever has the turn (or of the combatant the GM chose), from the full state */
function staffModel(combat, desk) {
  const state = Api.state(combat), cid = st.dock.sel && state?.ledger?.[st.dock.sel] ? st.dock.sel : state?.init?.curMember ?? null;
  const rolls = (desk?.info ?? []).flatMap((i) => i.rolls ?? []);      // U1: the GM's own rolls (NPCs, absent players) stand in the dock's line too when the desk is folded
  if (!state || !cid) return { bars: [], prompts: [], mine: [], rolls, stack: desk?.info ?? [], waiting: desk?.waiting ?? [], turn: desk?.turn ?? null };
  const bar = Api.pure.desk.barModel(state, cid, { ...Engine.context(combat), P1: Api.pure.economy });
  if (bar.endTurn) bar.endTurn = { ...bar.endTurn, req: { ...bar.endTurn.req, force: true } };
  /* a hero whose player is at the table: the GM's dock rests (the chevron opens it to act for them) */
  const actor = combat.combatants.get(cid)?.actor ?? null;
  st.dock.quiet = !!actor && game.users.some((u) => u.active && !Store.isStaff(u) && actor.testUserPermission(u, "OWNER"));
  const mine = (desk?.info ?? []).filter((i) => i.actor === cid).map((i) => ({ ...i, rolls: [], commands: [] }));
  /* what this one summoned acts in the same turn: its bars stand beside (the dock's switcher) */
  const cur = state.init?.curMember, more = (state.summons ?? []).filter((x) => x.owner === cur).flatMap((x) => x.combatants.filter((id) => !(x.wait ?? []).includes(id)));
  const bars = more.length ? [...new Set([cur, ...more, cid])].map((id) => (id === cid ? bar : Api.pure.desk.barModel(state, id, { ...Engine.context(combat), P1: Api.pure.economy }))) : [bar];
  return { bars, prompts: [], mine, rolls, stack: desk?.info ?? [], waiting: desk?.waiting ?? [], turn: desk?.turn ?? null };
}

function refresh() {
  try {
    const combat = down ? null : combatNow();
    try { document.body.classList.toggle("ita-tactics", !!combat); } catch { /* no body */ }      // styles/tactics-ui.css: what the other surfaces of the module give up while the dock shows
    hotbarSync(!!combat);
    if (!combat) { cardsWere = null; lastDock = lastModel = null; Pick.stop(); Pick.keep(null, []); Board.sync(null, null); Camera.sync(null); mapSync(null, null); Dock.render({ show: false, prompts: [], sum: Feedback.idle().sum }); Desk.render({ show: false }); pokeTray(); return; }      // U57: the card of the fight that just ended may still stand
    const staff = Store.isStaff(game.user), facts = factsOf(combat);
    const key = `${combat.id}:${facts.view?.round}:${facts.view?.init?.curMember}`;
    if (key !== turnKey) { turnKey = key; st.dock = { ...blankDock(), picks: st.dock.picks, texts: st.dock.texts, zone: st.dock.zone, newsSeen: st.dock.newsSeen, hotbar: st.dock.hotbar }; }        // a new turn: nothing stays armed
    const desk = staff ? Api.desk(combat) : null;
    let deskD = null;
    if (staff) {
      if (!st.desk.touched) st.desk.collapsed = mapWidth() < NARROW;
      /* U12: a card that was not waiting a moment ago brings the Now tab forward, unless the GM is typing in the desk */
      const ids = (desk?.cards ?? []).map((c) => c.id), fresh = cardsWere !== null && ids.some((id) => !cardsWere.includes(id));
      cardsWere = ids; deskIdle = !ids.length && !(desk?.info ?? []).length && !(desk?.manual ?? []).length;
      if (fresh && st.desk.auto) st.desk.auto = false;
      if (fresh && st.desk.tab !== "now" && !/^(INPUT|TEXTAREA|SELECT)$/.test(Desk.el()?.contains(document.activeElement) ? document.activeElement.tagName : "")) st.desk.tab = "now";
      deskD = Model.deskData(desk, st.desk, facts, t);
      Desk.render(deskD, st.desk);
    } else { cardsWere = null; Desk.render({ show: false }); }
    const model = staff ? staffModel(combat, desk) : Api.player(combat);
    const data = Model.dockData(model, st.dock, facts, t);
    /* U160 (UX review 1): with the board the map's picks of a zone show no banner at the top (ui/board.mjs `banner: false`): what is
       asked stands in the armed panel on the bar, where the hand is. A move pick gets its panel back (the instruction in its head),
       an area attack says it in its body */
    if (data.show && data.panel && Zones.hasBoard()) {
      if (data.panel.kind === "move" && data.panel.picking && data.panel.ways && data.panel.bare) data.panel = { ...data.panel, bare: false };
      else if (Board.areaMode(data.panel)) data.panel = { ...data.panel, pickHint: t("ITAC.map.area.pick") };
    }
    fightStart(combat);
    /* U5: the open desk already says whose turn it is and who the table waits for, right beside the dock: the GM's dock does not say it again (one line less over the map) */
    if (staff && deskD && !deskD.collapsed && data.show) { data.waiting = []; data.turn = ""; data.rolls = []; }      // the open desk carries the same roll buttons on its rows
    /* U53 / U57 / U58: the first-fight hint over the bar, the summary card of the round that just ended, the two sounds (ui/feedback.mjs) */
    const fb = Feedback.sync({ combat, facts, model, data, cards: desk?.cards ?? null, staff, own: st.dock });
    data.sum = fb.sum; data.hint = fb.hint;
    lastDock = data; lastModel = model;
    { const top = data?.prompts?.[0]?.id ?? null; if (top !== cardTop.id) cardTop = { id: top, at: Date.now() }; }
    autoEnd(combat, data);
    /* U59: the GM nudged this user: the line stands on the dock (news) and is said once as a notification, wherever the eyes are */
    if (data.news?.kind === "nudge" && data.news.id !== nudgeSaid) { nudgeSaid = data.news.id; notify("info", data.news.text); }
    Dock.render(data, st.dock);
    /* U21: this client's target marks follow what is still aimed at (the open panel, the actions in progress) */
    Pick.keep(combat, [...(data.show && data.panel?.kind === "declare" ? (data.panel.targets ?? []).filter((x) => x.picked).map((x) => x.id) : []), ...(staff ? desk?.info ?? [] : model.mine ?? []).flatMap((i) => (i.targets ?? []).map((x) => x.id))]);
    /* W1: on a map with the board the targets are chosen there (rings, the chance, the reason of one out of reach: ui/board.mjs); a
       second click on the one chosen target declares, like Enter. An area attack is put on a zone instead (the board's own pick). */
    const hzAt = deskD?.show && !deskD.collapsed ? String(deskD.hazard?.where?.value ?? "") : "";      // U36: the zone chosen in the GM's hazard tool is shown on the GM's map before the hazard runs
    const board = Board.sync(data, { combat, facts, view: facts.view, staff, rev, hz: hzAt.startsWith("z:") ? hzAt.slice(2) : null });
    Pick.setPlain(board);
    if (data.show && data.panel?.kind === "declare" && data.panel.targets && !(board && Board.areaMode(data.panel))) Pick.start(combat, data.panel.targets.map((x) => x.id), (cid) => { const max = data.panel.maxTargets ?? 1, cur = (st.dock.targets ?? []).filter((x) => x !== cid);
      if (board && max === 1 && (st.dock.targets ?? []).length === 1 && st.dock.targets[0] === cid && lastDock?.panel?.submit?.req) { Dock.press("go"); return; }
      setDock({ targets: max > 1 ? ((st.dock.targets ?? []).includes(cid) ? cur : [...cur, cid].slice(-max)) : [cid] }); });
    else Pick.stop();
    mapSync(data, deskD, board);
    Camera.sync({ combat, view: facts.view, staff, model, dock: st.dock, data });      // U94: what this user's own view and hand give the map's camera (ui/camera.mjs)
    watch(); pokeTray();
  } catch (e) { console.warn(LOG, "refresh failed", e); }
}
/* U150 (UX review 1): THE SCREEN AT THE FIGHT'S START. The initiative bar, the dock and the desk stand in for Foundry's combat tracker,
   which stayed open in the sidebar after "Begin combat" and took 300 px of the map on the seat that moves the most tokens. When this
   client first sees a fight of ours begun (the start itself, or a join while it runs) the sidebar folds, once per fight; opened again
   by hand it stays open. */
let foldedFor = null;
function fightStart(combat) {
  try {
    if (!combat?.started || foldedFor === combat.id) return;
    foldedFor = combat.id;
    if (ui.sidebar?.expanded) ui.sidebar.collapse();
  } catch { /* the sidebar stays as it is */ }
}
const schedule = () => { rev++; clearTimeout(timer); timer = setTimeout(refresh, 40); };
let factsRev = 0;                         // W1: what can change who is in reach besides the fight itself: a token entered a zone, a door, an actor's numbers
const moved = () => { factsRev++; schedule(); };

/* ---------- what the surfaces put on the map (this client only; zones-api.md 17, 18) ---------- */
function show(id, was, spec) {
  const key = spec ? JSON.stringify(spec) : "";
  if (key === was) return was;
  try { if (spec) Zones.highlight({ id, ...spec }); else Zones.clearHighlights(id); } catch { /* the map is optional */ }
  return key;
}
function mapSync(data, deskD, board = false) {
  try {
    const p = data?.show && !(board && data.panel?.kind === "move") ? data.panel : null;      // W1: with the board a move is picked by ui/board.mjs (pickMove)
    /* Move armed and no zone chosen yet: the map's pick over the zones one action reaches, each in the colour of its cheapest way */
    if (p?.kind === "move" && p.picking) {
      const key = `${data.who.id}|${p.action}|${JSON.stringify(p.zones)}`;
      if (zonePick?.key !== key) {
        const mine = (zonePick = { key });
        /* U5: the panel that just opened may lie over the character: the map slides by the least that shows the zone it stands in (this client's view only) */
        setTimeout(() => { if (zonePick === mine) showToken(data.who.id); }, 350);
        Zones.pick({ zones: p.zones, title: t("ITAC.ui.pick.title", { name: data.who.name }), hint: p.hint, color: "move" }).then((r) => {
          if (zonePick !== mine) return;                    // given up or replaced by a newer one
          zonePick = null;
          if (r?.ok) setDock({ to: r.zone, ask: null, why: "" });
          else { if (r?.reason && !["cancelled", "replaced"].includes(r.reason)) notify("warn", t("ITAC.warn.zones", { reason: t(`ITAC.reason.${r.reason}`, {}, String(r.reason)) })); setDock({ armed: null, mode: null }); }
        });
      }
    } else if (zonePick) { zonePick = null; Zones.cancelPick(); }
    shownDock = show("ipu.dock", shownDock, p?.kind === "move" && p.dest ? { zones: [{ zone: p.dest.zone, color: "target" }] } : p?.kind === "door" && p.borders.length ? { borders: p.borders } : null);
    const forced = (deskD?.cards ?? []).find((c) => c.map)?.map ?? null;      // the GM's card of a forced move: the chain on the map
    shownDesk = show("ipu.forced", shownDesk, forced ? { zones: forced.zones, color: "danger", borders: forced.borders, borderColor: "danger" } : null);
  } catch (e) { console.warn(LOG, "map sync failed", e); }
}
/* U5: the token of the character the dock drives is kept out from under the surfaces: when it lies under the dock (or the macro bar below
   it), above the initiative bar or off to a side, this client's view slides by the least that shows it. Called when Move is armed (its
   panel has just opened over the map) and after a move made from the dock; never on a timer, never for another user's view. */
function showToken(cid) {
  try {
    if (Camera.ready()) return;      // U94: the map's camera keeps the dock's unit in the free part of the screen itself (the cues "arm" and "ownMove")
    const tok = combatNow()?.combatants.get(cid)?.token?.object, stage = canvas?.stage;
    if (!tok || !stage || !tok.visible) return;
    const W = window.innerWidth, H = window.innerHeight, s = stage.scale.x || 1;
    const c = canvas.clientCoordinatesFromCanvas(tok.center), half = Math.min(90, ((tok.h ?? 100) * s) / 2) + 16;
    const dk = Dock.el()?.querySelector(".itd-stack")?.getBoundingClientRect(), sb = document.getElementById("sidebar")?.getBoundingClientRect();
    const top = (Number(document.documentElement.dataset.icbarBottom) || 96) + half, bottom = (dk && dk.height ? dk.top : H - 150) - half;
    const left = Math.min(W * 0.22, 300) + half, right = Math.min(W * 0.72, (sb && sb.width > 120 ? sb.left : W) - 60) - half;
    if (bottom - top < 40 || right - left < 40) return;      // no room to show it in: leave the view alone
    const dx = c.x < left ? c.x - left : c.x > right ? c.x - right : 0, dy = c.y < top ? c.y - top : c.y > bottom ? c.y - bottom : 0;
    if (!dx && !dy) return;
    canvas.animatePan({ x: stage.pivot.x + dx / s, y: stage.pivot.y + dy / s, duration: 320 });
  } catch (e) { console.warn(LOG, "show token failed", e); }
}
let trayWas = null;
function pokeTray() { try { const on = active(); if (on !== trayWas) { trayWas = on; game.modules.get(MOD)?.api?.turn?.refresh?.(); } } catch { /* the tray is optional */ } }

/* ---------- what the surfaces call ---------- */
/* another action armed, another character chosen: what belonged to the last one (the zone, the open question to the GM, a refusal) goes */
function patchDock(patch) {
  if (!patch) return;
  if (("armed" in patch && patch.armed !== st.dock.armed) || ("sel" in patch && patch.sel !== st.dock.sel) || patch.mode) Object.assign(st.dock, { to: null, ask: null, why: "", refused: null, opt: null, attr: null });
  if ("armed" in patch && !patch.armed && st.dock.dragged) Object.assign(st.dock, { sel: null, dragged: false });      // the character a drag brought up steps back
  Object.assign(st.dock, patch);
}
function setDock(patch) {
  if (patch && "camera" in patch) { Board.setCamera(patch.camera); patch = Object.fromEntries(Object.entries(patch).filter(([k]) => k !== "camera")); }      // W1 (U42): the map keeps this user's choice
  if (patch && "hotbar" in patch) { remember({ hotbar: !!patch.hotbar }); try { globalThis.localStorage?.setItem(HOTBAR_KEY, patch.hotbar ? "1" : "0"); } catch { /* private window */ } }
  patchDock(patch); refresh();
}
/* a tooltip for the keyboard: Foundry opens its tooltips for the pointer only; the surfaces ask for the same one on focus */
const tipShow = (el) => { try { game.tooltip?.activate(el); } catch { /* a courtesy */ } };
const tipHide = () => { try { game.tooltip?.deactivate(); } catch { /* a courtesy */ } };
function setDesk(patch) { if (patch && "tab" in patch) st.desk.auto = false; if (patch?.touched && "collapsed" in patch) remember({ desk: patch.collapsed ? "folded" : "open" }); Object.assign(st.desk, patch); refresh(); }
/* U60: THE TOKEN THE GM CLICKED is the one the desk's character tab is about. The tab comes forward by itself only when the desk has
   nothing else to say (the Now tab is open and empty) and steps back when the token is let go; with cards waiting or an action in
   progress the GM's click changes nothing on screen (the map menu's "Show on the desk" brings the tab up at any time). Staff only. */
function unitOf(cid, force = false) {
  try {
    if (!cid || !Store.isStaff(game.user) || !combatNow()?.combatants.get(cid)) return;
    st.desk.kit = { ...st.desk.kit, who: cid, open: null };
    if (force) { Object.assign(st.desk, { collapsed: false, touched: true, tab: "kit", auto: false }); remember({ desk: "open" }); }
    else if (!st.desk.collapsed && st.desk.tab === "now" && deskIdle) Object.assign(st.desk, { tab: "kit", auto: true });
    refresh();
  } catch (e) { console.warn(LOG, "unit failed", e); }
}
function onControl(token, on) {
  try {
    if (!Store.isStaff(game.user)) return;
    const combat = combatNow(), cid = combat?.combatants.find((c) => c.tokenId === token?.document?.id)?.id ?? null;
    if (on && cid) return unitOf(cid);
    if (!on && st.desk.auto && st.desk.tab === "kit" && !(canvas.tokens?.controlled ?? []).length) { Object.assign(st.desk, { tab: "now", auto: false }); refresh(); }
  } catch (e) { console.warn(LOG, "control failed", e); }
}
/* ---------- U41: the keyboard (keys-pure.mjs says what a key does; here only: is the keyboard ours right now, and do it) ----------
   Never while the user types (a text field, the chat box, anything editable) and never while another window has the focus (a sheet, the
   sidebar): only with the focus on the page itself, the map, or one of the two surfaces. A focus that the POINTER left on a button
   of a surface does not make Enter or Space press that button again (it would un-arm the action just clicked, or veto twice): the
   keys keep their meaning; only a focus walked there by Tab leaves Tab, Enter and Space to the browser. */
function onKey(ev) {
  try {
    if (!lastDock || ev.defaultPrevented || ev.repeat || ev.ctrlKey || ev.altKey || ev.metaKey || !Keys.KEYS.includes(ev.key)) return;
    const a = document.activeElement, inOurs = !!a && (!!Dock.el()?.contains(a) || !!Desk.el()?.contains(a));
    if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;
    if (a && a !== document.body && a !== document.documentElement && a.tagName !== "CANVAS" && !inOurs) return;
    if (document.querySelector("dialog[open], .application.dialog, #context-menu")) return;      // a dialog or a menu of Foundry is up: its keys
    const plan = Keys.plan(lastDock, st.dock, { key: ev.key, shift: ev.shiftKey, walking: inOurs && !byPointer, age: cardTop.id ? Date.now() - cardTop.at : 0 });
    if (!plan) return;
    ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
    if (inOurs && byPointer) { try { a.blur(); } catch { /* nothing focused */ } }
    if (!document.body.classList.contains("ita-keys")) { document.body.classList.add("ita-keys"); remember({ keys: true }); try { globalThis.localStorage?.setItem(KEYS_ON, "1"); } catch { /* private window */ } }
    if (plan.click) Dock.press(plan.click);
    else if (plan.target) { setDock({ targets: [plan.target] }); try { Pick.show(combatNow(), plan.target); } catch { /* a courtesy */ } }
    else if (plan.set) setDock(plan.set);
  } catch (e) { console.warn(LOG, "key failed", e); }
}
async function send(which, req, after) {
  try {
    if (!req) return null;
    const combat = combatNow();
    const env = await Api.request(req, combat ?? undefined);
    for (const text of Model.envNotes(env, t, Store.isStaff(game.user))) notify("warn", text);      // D99: carried out only in part, an inverse that failed, an action handed to the GM
    if (env?.ok === false) {
      /* a declaration against the rules: the dock keeps the panel and shows the reason with the way to ask for an exception */
      if (which === "dock" && req.op === "declare" && env.error?.code === "illegal" && !req.decl?.exception) {
        const d = req.decl, place = typeof d.to === "string";      // a move or a door is refused for its place (the row of the panel), anything else for its targets
        st.dock.refused = { action: d.action, key: place ? (d.mode ? `${d.mode}|${d.to}` : d.to) : (d.targets ?? []).join(","), reason: env.error.params?.reason ?? "rules", params: env.error.params ?? {} };
        if (place) st.dock.ask = st.dock.refused.key;
      }
      else if (env.error?.code !== "gone") notify("warn", errText(env.error));
      refresh(); return env;
    }
    if (which === "dock") { st.dock.refused = null; st.dock.why = ""; }
    /* U4: an override says what it did (the desk's row changes too, but the GM's eyes are on the control just pressed) */
    if (which === "desk" && req.op === "nudge") notify("info", t("ITAC.ui.nudge.done"));      // U59
    if (which === "desk" && ["setOutcome", "setSixes", "setPool", "setDamage", "skipStep", "goToStep", "askRoll", "retarget"].includes(req.op)) notify("info", t(`ITAC.ui.ovr.did.${req.op}`, { name: combat?.combatants.get(req.target)?.name ?? "", n: req.sixes ?? req.total ?? req.amount ?? "", result: req.op === "setOutcome" ? t(req.hit ? "ITAC.ui.ovr.hit" : "ITAC.ui.ovr.miss") : "" }));
    /* U5: a move the user made from the dock may end under the dock or the macro bar: once the token has arrived the map slides by
       the least that brings that zone into the free part of the window (this client's view only; nothing when it is there already) */
    if (which === "dock" && req.op === "declare" && req.decl?.mode && typeof req.decl.to === "string" && !req.decl.exception) { const cid = req.actor ?? st.dock.sel ?? Api.state(combat)?.init?.curMember; for (const ms of [1200, 2600]) setTimeout(() => showToken(cid), ms); }
    if (after) { if (which === "dock") patchDock(after); else Object.assign(st[which], after); }
    refresh();
    return env;
  } catch (e) { console.warn(LOG, "request failed", e); return null; }
}
const multi = (which) => (id, opt, max = 24) => { const cur = (st[which].picks[id] ?? null), list = cur ? cur.slice() : null; const base = list ?? defaultPicks(id); const i = base.indexOf(opt); if (i >= 0) base.splice(i, 1); else if (base.length < max) base.push(opt); st[which].picks[id] = base; refresh(); };
/* a round-point queue starts with everything ticked (model-pure.askData); a first click must start from that */
function defaultPicks(id) { try { const p = Api.state(combatNow())?.prompts?.[id]; return p?.kind === "triggerQueue" ? (p.options ?? []).map((o) => o.id) : []; } catch { return []; } }
const text = (which) => (id, value) => { st[which].texts[id] = String(value).slice(0, 300); refresh(); };
async function zone(which, option, ask) {
  try {
    const r = await Zones.pick({ zones: option.zones, title: t("ITAC.ui.pick.title", { name: ask.about ?? "" }), color: option.pickZone ? "move" : "target" });
    if (r?.ok) {
      const req = option.zoneReq(option.pickZone ? r.zone : r.spot ?? r.zone);
      if (req) await send(which, req);
      else if (option.pickZone) { st[which].zone[ask.id] = r.zone; refresh(); }       // several ways into that zone: the card lists them
    }
    else if (r?.reason && !["cancelled", "replaced"].includes(r.reason)) notify("warn", t("ITAC.warn.zones", { reason: t(`ITAC.reason.${r.reason}`, {}, String(r.reason)) }));
  } catch (e) { console.warn(LOG, "zone pick failed", e); }
}
const LABELS = { peek: "ITAC.ui.peek", cancel: "ITAC.ui.cancel", chance: "ITAC.ui.chance", target: "ITAC.ui.target", pool: "ITAC.ui.pool", dock: "ITAC.ui.dock", waitingFor: "ITAC.ui.waitingFor", "pick.hint": "ITAC.ui.pick.hint", "undo.sure": "ITAC.ui.undo.sure", slots: "ITAC.ui.slots" };
const label = (k) => t(LABELS[k] ?? k);

function configure() {
  Dock.configure({
    set: setDock, send: (req, after) => send("dock", req, after), label, tipShow, tipHide,
    pick: multi("dock"), text: text("dock"), always: () => {}, zone: (o, a) => zone("dock", o, a), again: (a) => { delete st.dock.zone[a.id]; refresh(); },
    /* an action that also names a place (Fastball Special): any zone of the map; the executor judges the throw */
    zonePick: async () => { try { const r = await Zones.pick({ title: t("ITAC.ui.pick.title", { name: "" }).replace(/^[:\s]+/, ""), color: "target" }); if (r?.ok) setDock({ to: r.spot ?? r.zone }); } catch (e) { console.warn(LOG, "zone pick failed", e); } },
    target: (cid) => { try { Pick.show(combatNow(), cid); } catch { /* a courtesy */ } },
    locate: (cid, on) => Pick.locate(combatNow(), cid, on), deskRelayout: () => { try { Desk.relayout(); } catch { /* not built */ } },
    roll: rollAct, sumClose: () => Feedback.closeSum(), hintClose: (id) => Feedback.closeHint(id),
    /* U132: what the frame of the fixed places asks: the seat, the hints, where the challenges' band ends (challenges/main.mjs) */
    staff: () => Store.isStaff(game.user), hintsOn: () => Store.setting("tacticsHints", true) !== false,
    ichFloor: (y) => { try { window.dispatchEvent(new CustomEvent("ipu:ich-floor", { detail: y })); } catch { /* the challenges keep their room */ } },
    amend: (p) => { const combat = combatNow(), i = combat ? Api.player(combat).mine.find((x) => x.inst === p.inst) : null; if (i) setDock({ armed: i.action, mode: null, amend: i.inst, targets: i.targets.map((x) => x.id), text: i.text ?? "" }); },
  });
  Desk.configure({
    set: setDesk, send: (req, after) => send("desk", req, after), label, tipShow, tipHide, locate: (cid, on) => Pick.locate(combatNow(), cid, on),
    needFrame: () => { try { Dock.relayout(); } catch { /* not built */ } },      // U132: the desk stands in the dock's frame
    pick: multi("desk"), text: text("desk"), always: (id, on) => { st.desk.always[id] = !!on; refresh(); }, zone: (o, a) => zone("desk", o, a), again: (a) => { delete st.desk.zone[a.id]; refresh(); },
    force: (patch) => { st.desk.force = { ...st.desk.force, ...patch }; refresh(); },
    hazard: (patch) => { st.desk.hazard = { ...st.desk.hazard, ...patch }; refresh(); },
    karma: (patch) => { st.desk.karma = { ...st.desk.karma, ...patch }; refresh(); },
    fold: (id) => { remember({ folds: { [id]: !Lay.folded(layout, id) } }); refresh(); },      // U64 / U80: a part of the Table tab folds; the choice is the user's layout
    kit: (patch) => { st.desk.kit = { ...st.desk.kit, ...patch }; refresh(); },                // P6: whose abilities the tab shows, which row is open
    scene: (patch) => { st.desk.scene = { ...st.desk.scene, ...patch, side: { ...(st.desk.scene.side ?? {}), ...(patch.side ?? {}) } }; refresh(); },      // P7: the draft of a chase
    roll: rollAct,
    act: (cid) => { patchDock({ sel: cid, armed: null, mode: null, peek: true }); refresh(); },      // P7: the dock for somebody who has no turn (the crew in a chase)
    val: (id, v) => { st.desk.vals[id] = v; refresh(); },
    manual: (id, patch) => { const cur = st.desk.manual[id] ?? {}; st.desk.manual[id] = { ...cur, ...patch, damage: { ...(cur.damage ?? {}), ...(patch.damage ?? {}) } }; refresh(); },
    forceUndo: async (j) => { const env = await send("desk", j.undo.force.req, { undo: null }); if (env?.ok === false && env.error?.code === "drift") setDesk({ drift: j.id }); },
  });
}

/* keep both placed when the layout around them moves */
function relayout() { try { Desk.relayout(); Dock.relayout(); } catch { /* not built */ } }
function watch() {
  if (!window.ResizeObserver) return;
  ro ??= new ResizeObserver(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; relayout(); }); });
  const els = ["hotbar", "sidebar", "invincible-party", "invincible-challenges", "invincible-tactics-desk", "chat-notifications", "players", "mm-dir-bar", "mm-orbit-strip", "mm-vram", "invincible-combat-bar"].map((id) => document.getElementById(id));
  for (const el of [...els, document.querySelector("#chat-notifications .chat-log"), document.querySelector(".mm-filter")]) {
    if (el && el.dataset.itdWatched !== "1") { el.dataset.itdWatched = "1"; ro.observe(el); }
  }
}
/* What the map keeps clear of (zones-api.md sections 23, 38 and 41). U132: the dock's root covers the window, so it is not declared
   itself.
     the insets (the free stretch between our bars: the pick's banner, a zone brought into view, THE CAMERA's frame): at the bottom the
       bar's stack (the bar and the armed panel on it); at the top the initiative bar and, under it, the line and the questions while
       they show (Dock.topReach). So a card that hangs over the top of the map never hides what the camera frames for it: a reaction
       card's attacker, the unit whose turn it is, a target are framed under the card, by the least slide (the map's own rule: nothing
       moves when the subject already stands in the free stretch).
     the boxes the map's menus and its "My view" chip keep clear of: the bar's stack, what stands in the top places, the places reserved
       for the panel and the line (slots-pure.frame `reserved`: a place that empties stays that surface's place, the chip does not move
       into it), the desk, the party, the challenges. The session notice is the session part's own declaration (session/main.mjs). */
function declareRoom() {
  Zones.uiInset(`${MOD}.bars`, { bottom: "#invincible-tactics-dock:not(.itd-hidden) .its-bar", top: () => Math.max(reachTop("#invincible-combat-bar"), Dock.topReach()) });
  Zones.uiAvoid(`${MOD}.panels`, () => {
    const shown = Dock.isShown();
    return [...(shown ? ["#invincible-tactics-dock .its-bar", "#invincible-tactics-dock .its-slot:not([data-empty]) > .its-in > *", ...(Slots.frameNow()?.reserved ?? [])] : []),
      "#invincible-tactics-desk", "#invincible-party", "#invincible-challenges", ...(Slots.frameNow()?.toast?.box ? [Slots.frameNow().toast.box] : [])];      // D126 / U150: the toasts' strip too
  });
}
/* how far down from the top an element reaches (0: not shown) */
function reachTop(sel) { try { const r = visibleRect(document.querySelector(sel)); return r ? Math.round(r.bottom) : 0; } catch { return 0; } }

/** does the dock stand in for the turn tray right now? (scripts/turn/main.mjs) */
export const active = () => { try { return started && !!combatNow(); } catch { return false; } };

/* U108: while Dice So Nice shows dice over the interface, the dock and the initiative bar stand one step above its canvas (layout-pure
   diceRaise); the canvas is made by Dice So Nice when it starts, so it is looked for until it exists, then watched */
let diceSeen = null, diceHooked = false, dice = { on: false, shown: false }, diceTimer = 0;
function diceApply() {
  try {
    const cv = diceSeen, style = cv ? { display: cv.style.display, opacity: cv.style.opacity, zIndex: cv.style.zIndex || getComputedStyle(cv).zIndex } : null;
    dice = Lay.diceWatch(dice, style);      // U108 (LIVE ver8): the first roll after a pause starts on a hidden canvas: that is not "the dice are gone"
    const z = dice.on ? Lay.diceRaise(style) : null;
    setVar("--ita-dice-z", z ? String(z) : null);      // perf P2 (ui/vars.mjs): on the bar and the dock alone; a property on the body restyled the whole page at every roll
    document.body.classList.toggle("ita-dice-up", !!z);
  } catch { /* the dice keep their place */ }
}
function watchDice() {
  try {
    if (diceHooked || !game.modules?.get?.("dice-so-nice")?.active) return;
    diceHooked = true;
    /* only while a roll is shown (the canvas may stand visible and empty between rolls); 20 s at most, should the hiding never be seen */
    Hooks.on("diceSoNiceRollStart", () => {
      try {
        const cv = document.getElementById("dice-box-canvas");
        if (cv && cv !== diceSeen) { diceSeen = cv; new MutationObserver(diceApply).observe(cv, { attributes: true, attributeFilter: ["style"] }); }
        const vis = cv && cv.style.display !== "none" && cv.style.opacity !== "0";
        dice = { on: true, shown: !!vis }; clearTimeout(diceTimer); diceTimer = setTimeout(() => { dice = { on: false, shown: false }; diceApply(); }, 20000);
        requestAnimationFrame(diceApply);
      } catch { /* the dice keep their place */ }
    });
  } catch { /* the dice keep their place */ }
}
/* U129: Push / Accept on an old roll card of the fight (rollwatch-pure.cardState) are switched off, with a word why, once the fight settled
   that roll; drawn on Foundry's own disabled button. Every chat surface (log, pop-out, notifications) after each change of the fight. */
function chatButtons(root = document) {
  try {
    for (const el of root.querySelectorAll?.("[data-message-id] .dice-buttons") ?? []) {
      const id = el.closest("[data-message-id]")?.dataset.messageId, tag = Sys.tacticsOf(game.messages?.get(id));
      if (!tag) continue;
      const combat = RW.cardCombat(tag, (id) => game.combats?.get(id), Store.currentCombat());      // U137: a card of a fight that is gone is settled
      const off = RW.cardState(combat ? Api.state(combat) : null, tag, id) === "settled";
      for (const b of el.querySelectorAll("button")) { b.disabled = off; if (off) b.dataset.tooltip = t("ITAC.ui.chat.settled"); else delete b.dataset.tooltip; }
    }
  } catch { /* the card as the system drew it */ }
}
/** -> true when the surfaces run on this client */
export function start() {
  if (started) return true;
  if (typeof document === "undefined") return false;      // no page (the node checks load main.mjs): no surfaces
  try {
    started = true;
    down = !globalThis.canvas?.scene;        // this can run before Foundry made the canvas: canvasReady lifts it
    configure();
    Tip.start(game.tooltip);      // U88 / U97: the tooltips of the dock, the cards and the desk open outside the block of their owner (ui/tip-pure.mjs)
    Store.subscribe(schedule);
    for (const hk of ["updateCombat", "createCombat", "deleteCombat", "createCombatant", "updateCombatant", "deleteCombatant", "userConnected", "combatStart"]) Hooks.on(hk, schedule);
    Hooks.on("updateActor", (_a, ch) => { if (ch && ("system" in ch || "name" in ch || "img" in ch || "ownership" in ch)) moved(); });
    /* U101 / CAM-14: hiding or revealing a token of the fight alone (no combatant changes) changes who sees whom and is a cue of the camera:
       every surface is drawn again, once now and once after the canvas has redrawn the token (onMap reads its visibility). H2-6: the one handler */
    Hooks.on("updateToken", (td, ch) => { try { if (ch && "hidden" in ch && combatNow()?.combatants.some((c) => c.tokenId === td.id)) { moved(); setTimeout(moved, 120); } } catch { /* a courtesy */ } });
    Hooks.on("canvasReady", () => { down = false; schedule(); });
    watchDice();      // U108
    Hooks.on("controlToken", onControl);      // U60
    Hooks.on("canvasTearDown", () => { down = true; Pick.stop(); zonePick = null; shownDock = shownDesk = ""; Board.reset(); Camera.reset(); Dock.hide(); });
    Hooks.on("createChatMessage", () => { for (const ms of [60, 400, 1200]) setTimeout(relayout, ms); });      // a toast floats in: the desk and the dock step aside once it has its size
    Hooks.on("deleteChatMessage", () => setTimeout(relayout, 60));
    Hooks.on("renderChatMessageHTML", (_m, html) => chatButtons(html?.parentElement ?? html));      // U129
    Store.subscribe(() => setTimeout(chatButtons, 50));
    Zones.onEvent(moved);                    // a token entered a zone, a door changed: the options of a move are counted again
    Zones.onChange(() => moved());           // the scene's numerals or its zones changed: every text that names a zone is said again
    declareRoom();
    /* a token dragged into another zone (movement.mjs asks here first): the dock opens Move for that combatant with the zone chosen */
    Mv.setDragSurface((cid, spot) => {
      const combat = combatNow();
      if (!combat || !st.dock) return false;
      const staff = Store.isStaff(game.user), mine = staff || Api.player(combat).bars.some((b) => b.combatant === cid);
      if (!mine) return false;
      const other = staff ? Api.state(combat)?.init?.curMember !== cid : false;
      patchDock({ sel: cid, armed: "move", mode: null, peek: true });
      /* W1: with the board the priced ways into that zone open as a menu at the zone (ui/board.mjs); without it the panel lists them */
      Object.assign(st.dock, Zones.hasBoard() ? { menuAt: String(spot).split(":")[0], dragMenu: true, dragged: other } : { to: String(spot).split(":")[0], dragged: other });
      refresh();
      return true;
    });
    for (const hk of ["changeSidebarTab", "renderHotbar", "renderPlayers", "renderChatLog", "closeChatLog"]) Hooks.on(hk, () => { relayout(); setTimeout(relayout, 320); });      // U136: also the chat popped out or back in
    Hooks.on("collapseSidebar", () => { relayout(); setTimeout(() => (st.desk.touched ? relayout() : schedule()), 320); });      // the desk folds or opens with the room the sidebar leaves, until the GM chose
    window.addEventListener("resize", () => { if (!st.desk.touched) schedule(); else relayout(); });
    document.addEventListener("keydown", (ev) => { try { if (ev.key === "Escape" && (st.dock.armed || st.dock.mode) && Dock.el()?.contains(document.activeElement)) { ev.stopPropagation(); setDock({ armed: null, mode: null, amend: null }); } } catch { /* ignore */ } }, true);
    /* U41 */
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", () => { byPointer = true; }, true);
    document.addEventListener("keydown", (ev) => { if (ev.key === "Tab" && !ev.defaultPrevented) byPointer = false; });      // the browser walked the focus
    layoutStart();      // U64
    applyScale();       // U62
    /* U62: the slider in the settings window shows the size while it is dragged; closing the window without saving puts the kept size back */
    /* U71: the card of a tactical roll is marked: while the dock is up its toast is not shown (the roll, its Push and Accept are on the
       dock's own chip; the card itself stays in the chat log) */
    Hooks.on("renderChatMessageHTML", (message, html) => { try { if (Sys.tacticsOf(message)) (html instanceof HTMLElement ? html : html?.[0])?.classList.add("ita-troll"); } catch { /* the toast shows */ } });
    Hooks.on("renderSettingsConfig", (_app, el) => { try { const box = el instanceof HTMLElement ? el : el?.[0]; const input = box?.querySelector(`[name="${MOD}.tacticsUiScale"]`); for (const ev of ["input", "change"]) input?.addEventListener(ev, () => applyScale(input.value)); } catch { /* the saved value still applies */ } });
    Hooks.on("closeSettingsConfig", () => setTimeout(() => applyScale(), 50));
    Board.start({ t, set: setDock, send: (req, after) => send("dock", req, after), press: (fk) => Dock.press(fk), notify, refresh, showToken, dock: () => st.dock, unit: (cid) => unitOf(cid, true),
      bar: (cid) => lastModel?.bars?.find((b) => b.combatant === cid) ?? null,
      request: async (req, combat) => { try { const env = await Api.request(req, combat ?? combatNow() ?? undefined); for (const text of Model.envNotes(env, t, Store.isStaff(game.user))) notify("warn", text); if (env?.ok === false && env.error?.code !== "gone") notify("warn", errText(env.error)); return env; } catch { return null; } } });
    Feedback.start({ t, refresh });
    Camera.start();
    Api.camera = { state: () => Camera.state() };      // for a look from the console
    Api.ui = { active, refresh, state: () => st, rescale: (v) => applyScale(v), frame: () => Slots.frameNow(), layout: () => layout, hintsSwitched: (on) => Feedback.hintsSwitched(on) };
    refresh();
    return true;
  } catch (e) { console.warn(LOG, "start failed", e); return false; }
}
