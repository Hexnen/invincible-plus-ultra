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
import { t, errText } from "../lang.mjs";
import * as Model from "./model-pure.mjs";
import * as Dock from "./dock.mjs";
import * as Desk from "./desk.mjs";
import * as Pick from "./pick.mjs";

const MOD = Store.MOD, LOG = `${MOD} (tactics ui) |`;
const NARROW = 1180;                       // below this window width the desk starts folded
const blankDock = () => ({ sel: null, armed: null, mode: null, targets: [], tokens: [], text: "", amend: null, endArmed: false, peek: false, weapon: null, opts: {}, picks: {}, texts: {}, quiet: false, to: null, ask: null, why: "", zone: {}, dragged: false, opt: null, attr: null });
const blankDesk = () => ({ tab: "now", collapsed: false, touched: false, override: null, undo: null, drift: null, vals: {}, manual: {}, picks: {}, texts: {}, always: {}, zone: {}, force: {}, hazard: {}, karma: {}, scene: {}, kit: {} });
let started = false, down = false, timer = 0, raf = 0, ro = null, turnKey = null;
let st = { dock: blankDock(), desk: blankDesk() };
let rev = 0, moveMemo = null;             // the move options are counted once per change of the fight or of the map, not per keystroke
let zonePick = null, shownDock = "", shownDesk = "";      // what this client has on the map for the surfaces: a running pick, two highlights

const combatNow = () => { try { const c = Store.currentCombat(); return c && Api.active(c) && Api.mode(c) !== "off" && (!c.scene || c.scene.id === globalThis.canvas?.scene?.id) ? c : null; } catch { return null; } };
const isVideo = (s) => /\.(webm|mp4|m4v|ogv)(\?|$)/i.test(String(s ?? ""));
const portrait = (cb) => [cb?.img, cb?.token?.texture?.src, Sys.actorOf(cb)?.img].filter(Boolean).find((s) => !isVideo(s)) ?? null;
const notify = (kind, text) => { try { ui.notifications[kind](text, { console: false }); } catch { /* no ui */ } };

/** what the pure model may ask about the world (model-pure.mjs header); numbers only of actors this user may read */
function factsOf(combat) {
  const staff = Store.isStaff(game.user), view = Api.state(combat), ctx = Engine.context(combat);
  return {
    view, me: game.user.id, staff,
    c: (id) => { const cb = combat.combatants.get(id), base = cb ? ctx.c(id) : null; return base ? { name: base.name, npc: base.npc, img: portrait(cb), summonOf: cb.flags?.[Store.MOD]?.tactics?.summonOf ?? null } : null; },
    kit: (id) => ctx.kit(id), bonus: (id) => ctx.bonus?.(id) ?? null,                                                                  // P6: the abilities of a sheet this user may read (engine.context)
    attrs: (id) => { try { const a = Sys.actorOf(combat.combatants.get(id)); return a && (staff || a.isOwner || view?.revealed?.[id]?.stats) ? Sys.actorFacts(a)?.attrs ?? null : null; } catch { return null; } },
    userName: (u) => game.users.get(u)?.name ?? null,
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
    resolve: (id) => { try { const a = Sys.actorOf(combat.combatants.get(id)); return a && staff ? Sys.actorFacts(a)?.resolve ?? null : null; } catch { return null; } },      // the desk's hint for an NPC out of Resolve
    weapons: (id) => { try { const a = Sys.actorOf(combat.combatants.get(id)); return a && (staff || a.isOwner) ? Sys.weaponList(a) : []; } catch { return []; } },      // [P4] what this user's own character can attack with
    doors: (id) => { try { const a = Sys.actorOf(combat.combatants.get(id)); return a && (staff || a.isOwner) ? Mv.api.doors(id) : []; } catch { return []; } },
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
/* the dock's model for staff: the bar of whoever has the turn (or of the combatant the GM chose), from the full state */
function staffModel(combat, desk) {
  const state = Api.state(combat), cid = st.dock.sel && state?.ledger?.[st.dock.sel] ? st.dock.sel : state?.init?.curMember ?? null;
  if (!state || !cid) return { bars: [], prompts: [], mine: [], stack: desk?.info ?? [], waiting: desk?.waiting ?? [], turn: desk?.turn ?? null };
  const bar = Api.pure.desk.barModel(state, cid, { ...Engine.context(combat), P1: Api.pure.economy });
  if (bar.endTurn) bar.endTurn = { ...bar.endTurn, req: { ...bar.endTurn.req, force: true } };
  /* a hero whose player is at the table: the GM's dock rests (the chevron opens it to act for them) */
  const actor = combat.combatants.get(cid)?.actor ?? null;
  st.dock.quiet = !!actor && game.users.some((u) => u.active && !Store.isStaff(u) && actor.testUserPermission(u, "OWNER"));
  const mine = (desk?.info ?? []).filter((i) => i.actor === cid).map((i) => ({ ...i, rolls: [], commands: [] }));
  return { bars: [bar], prompts: [], mine, stack: desk?.info ?? [], waiting: desk?.waiting ?? [], turn: desk?.turn ?? null };
}

function refresh() {
  try {
    const combat = down ? null : combatNow();
    if (!combat) { Pick.stop(); mapSync(null, null); Dock.render({ show: false }); Desk.render({ show: false }); pokeTray(); return; }
    const staff = Store.isStaff(game.user), facts = factsOf(combat);
    const key = `${combat.id}:${facts.view?.round}:${facts.view?.init?.curMember}`;
    if (key !== turnKey) { turnKey = key; st.dock = { ...blankDock(), picks: st.dock.picks, texts: st.dock.texts, zone: st.dock.zone }; }        // a new turn: nothing stays armed
    const desk = staff ? Api.desk(combat) : null;
    let deskD = null;
    if (staff) {
      if (!st.desk.touched) st.desk.collapsed = window.innerWidth < NARROW;
      deskD = Model.deskData(desk, st.desk, facts, t);
      Desk.render(deskD, st.desk);
    } else Desk.render({ show: false });
    const model = staff ? staffModel(combat, desk) : Api.player(combat);
    const data = Model.dockData(model, st.dock, facts, t);
    Dock.render(data, st.dock);
    if (data.show && data.panel?.kind === "declare" && data.panel.targets) Pick.start(combat, data.panel.targets.map((x) => x.id), (cid) => { const max = data.panel.maxTargets ?? 1, cur = (st.dock.targets ?? []).filter((x) => x !== cid); setDock({ targets: max > 1 ? ((st.dock.targets ?? []).includes(cid) ? cur : [...cur, cid].slice(-max)) : [cid] }); });
    else Pick.stop();
    mapSync(data, deskD);
    watch(); pokeTray();
  } catch (e) { console.warn(LOG, "refresh failed", e); }
}
const schedule = () => { rev++; clearTimeout(timer); timer = setTimeout(refresh, 40); };

/* ---------- what the surfaces put on the map (this client only; zones-api.md 17, 18) ---------- */
function show(id, was, spec) {
  const key = spec ? JSON.stringify(spec) : "";
  if (key === was) return was;
  try { if (spec) Zones.highlight({ id, ...spec }); else Zones.clearHighlights(id); } catch { /* the map is optional */ }
  return key;
}
function mapSync(data, deskD) {
  try {
    const p = data?.show ? data.panel : null;
    /* Move armed and no zone chosen yet: the map's pick over the zones one action reaches, each in the colour of its cheapest way */
    if (p?.kind === "move" && p.picking) {
      const key = `${data.who.id}|${p.action}|${JSON.stringify(p.zones)}`;
      if (zonePick?.key !== key) {
        const mine = (zonePick = { key });
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
function setDock(patch) { patchDock(patch); refresh(); }
function setDesk(patch) { Object.assign(st.desk, patch); refresh(); }
async function send(which, req, after) {
  try {
    if (!req) return null;
    const combat = combatNow();
    const env = await Api.request(req, combat ?? undefined);
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
const LABELS = { peek: "ITAC.ui.peek", cancel: "ITAC.ui.cancel", chance: "ITAC.ui.chance", target: "ITAC.ui.target", pool: "ITAC.ui.pool", dock: "ITAC.ui.dock", waitingFor: "ITAC.ui.waitingFor", "pick.hint": "ITAC.ui.pick.hint", "undo.sure": "ITAC.ui.undo.sure" };
const label = (k) => t(LABELS[k] ?? k);

function configure() {
  Dock.configure({
    set: setDock, send: (req, after) => send("dock", req, after), label,
    pick: multi("dock"), text: text("dock"), always: () => {}, zone: (o, a) => zone("dock", o, a), again: (a) => { delete st.dock.zone[a.id]; refresh(); },
    /* an action that also names a place (Fastball Special): any zone of the map; the executor judges the throw */
    zonePick: async () => { try { const r = await Zones.pick({ title: t("ITAC.ui.pick.title", { name: "" }).replace(/^[:\s]+/, ""), color: "target" }); if (r?.ok) setDock({ to: r.spot ?? r.zone }); } catch (e) { console.warn(LOG, "zone pick failed", e); } },
    target: (cid) => { try { Pick.show(combatNow(), cid); } catch { /* a courtesy */ } },
    amend: (p) => { const combat = combatNow(), i = combat ? Api.player(combat).mine.find((x) => x.inst === p.inst) : null; if (i) setDock({ armed: i.action, mode: null, amend: i.inst, targets: i.targets.map((x) => x.id), text: i.text ?? "" }); },
  });
  Desk.configure({
    set: setDesk, send: (req, after) => send("desk", req, after), label,
    pick: multi("desk"), text: text("desk"), always: (id, on) => { st.desk.always[id] = !!on; refresh(); }, zone: (o, a) => zone("desk", o, a), again: (a) => { delete st.desk.zone[a.id]; refresh(); },
    force: (patch) => { st.desk.force = { ...st.desk.force, ...patch }; refresh(); },
    hazard: (patch) => { st.desk.hazard = { ...st.desk.hazard, ...patch }; refresh(); },
    karma: (patch) => { st.desk.karma = { ...st.desk.karma, ...patch }; refresh(); },
    kit: (patch) => { st.desk.kit = { ...st.desk.kit, ...patch }; refresh(); },                // P6: whose abilities the tab shows, which row is open
    scene: (patch) => { st.desk.scene = { ...st.desk.scene, ...patch, side: { ...(st.desk.scene.side ?? {}), ...(patch.side ?? {}) } }; refresh(); },      // P7: the draft of a chase
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
  for (const id of ["hotbar", "sidebar", "invincible-party", "invincible-challenges", "invincible-tactics-desk", "chat-notifications", "players", "mm-dir-bar"]) {
    const el = document.getElementById(id);
    if (el && el.dataset.itdWatched !== "1") { el.dataset.itdWatched = "1"; ro.observe(el); }
  }
}
/** does the dock stand in for the turn tray right now? (scripts/turn/main.mjs) */
export const active = () => { try { return started && !!combatNow(); } catch { return false; } };

/** -> true when the surfaces run on this client */
export function start() {
  if (started) return true;
  if (typeof document === "undefined") return false;      // no page (the node checks load main.mjs): no surfaces
  try {
    started = true;
    down = !globalThis.canvas?.scene;        // this can run before Foundry made the canvas: canvasReady lifts it
    configure();
    Store.subscribe(schedule);
    for (const hk of ["updateCombat", "createCombat", "deleteCombat", "createCombatant", "updateCombatant", "deleteCombatant", "userConnected", "combatStart"]) Hooks.on(hk, schedule);
    Hooks.on("updateActor", (_a, ch) => { if (ch && ("system" in ch || "name" in ch || "img" in ch || "ownership" in ch)) schedule(); });
    Hooks.on("canvasReady", () => { down = false; schedule(); });
    Hooks.on("canvasTearDown", () => { down = true; Pick.stop(); zonePick = null; shownDock = shownDesk = ""; Dock.hide(); });
    Zones.onEvent(schedule);                 // a token entered a zone, a door changed: the options of a move are counted again
    Zones.onChange(() => schedule());        // the scene's numerals or its zones changed: every text that names a zone is said again
    Zones.uiInset(`${MOD}.bars`, { bottom: "#invincible-tactics-dock", top: "#invincible-combat-bar" });      // the pick's banner and its "more" chips keep clear of our two bars (zones-api.md section 23)
    /* a token dragged into another zone (movement.mjs asks here first): the dock opens Move for that combatant with the zone chosen */
    Mv.setDragSurface((cid, spot) => {
      const combat = combatNow();
      if (!combat || !st.dock) return false;
      const staff = Store.isStaff(game.user), mine = staff || Api.player(combat).bars.some((b) => b.combatant === cid);
      if (!mine) return false;
      const other = staff ? Api.state(combat)?.init?.curMember !== cid : false;
      patchDock({ sel: cid, armed: "move", mode: null, peek: true });
      Object.assign(st.dock, { to: String(spot).split(":")[0], dragged: other });
      refresh();
      return true;
    });
    for (const hk of ["collapseSidebar", "changeSidebarTab", "renderHotbar", "renderPlayers"]) Hooks.on(hk, () => { relayout(); setTimeout(relayout, 320); });
    window.addEventListener("resize", () => { if (!st.desk.touched) schedule(); else relayout(); });
    document.addEventListener("keydown", (ev) => { try { if (ev.key === "Escape" && (st.dock.armed || st.dock.mode) && Dock.el()?.contains(document.activeElement)) { ev.stopPropagation(); setDock({ armed: null, mode: null, amend: null }); } } catch { /* ignore */ } }, true);
    Api.ui = { active, refresh, state: () => st };
    refresh();
    return true;
  } catch (e) { console.warn(LOG, "start failed", e); return false; }
}
