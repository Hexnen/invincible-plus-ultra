/* Tactical combat, the surfaces: WIRING. Started by tactics/main.mjs only when tactical combat runs on this world (so with the setting
   off none of this is even imported). Builds the two surfaces from the models and redraws them when the fight changes:
     the action dock (dock.mjs)   every user: api.tactics.player(); for staff the bar of the combatant whose turn it is (the GM drives NPCs
                                  with the same dock, spec 13.3), built with the same barModel from the full state
     the GM desk (desk.mjs)       staff only: api.tactics.desk()
   What a click sends is the request found in the render data (model-pure.mjs), through api.tactics.request; an error is shown as a
   notification in the user's language. The surfaces' own state (armed action, picked targets, drafts, open panels) lives here and is
   never part of the fight. While the dock shows, the turn tray stands down (scripts/turn/main.mjs asks api.tactics.ui.active()) and the
   minimal prompt dialogs are not opened (prompts.mjs keeps only the end-of-scene confirmation).
   Everything is in try / catch: a failure here must not break the tracker. */
import * as Store from "../store.mjs";
import * as Sys from "../system-adapter.mjs";
import * as Engine from "../engine.mjs";
import * as Zones from "../zones-adapter.mjs";
import { tacticsApi as Api } from "../api.mjs";
import { t, errText } from "../lang.mjs";
import * as Model from "./model-pure.mjs";
import * as Dock from "./dock.mjs";
import * as Desk from "./desk.mjs";
import * as Pick from "./pick.mjs";

const MOD = Store.MOD, LOG = `${MOD} (tactics ui) |`;
const NARROW = 1180;                       // below this window width the desk starts folded
const blankDock = () => ({ sel: null, armed: null, mode: null, targets: [], tokens: [], text: "", amend: null, endArmed: false, peek: false, picks: {}, texts: {}, quiet: false });
const blankDesk = () => ({ tab: "now", collapsed: false, touched: false, override: null, undo: null, drift: null, vals: {}, manual: {}, picks: {}, texts: {}, always: {} });
let started = false, down = false, timer = 0, raf = 0, ro = null, turnKey = null;
let st = { dock: blankDock(), desk: blankDesk() };

const combatNow = () => { try { const c = Store.currentCombat(); return c && Api.active(c) && Api.mode(c) !== "off" && (!c.scene || c.scene.id === canvas?.scene?.id) ? c : null; } catch { return null; } };
const isVideo = (s) => /\.(webm|mp4|m4v|ogv)(\?|$)/i.test(String(s ?? ""));
const portrait = (cb) => [cb?.img, cb?.token?.texture?.src, Sys.actorOf(cb)?.img].filter(Boolean).find((s) => !isVideo(s)) ?? null;
const notify = (kind, text) => { try { ui.notifications[kind](text, { console: false }); } catch { /* no ui */ } };

/** what the pure model may ask about the world (model-pure.mjs header); numbers only of actors this user may read */
function factsOf(combat) {
  const staff = Store.isStaff(game.user), view = Api.state(combat), ctx = Engine.context(combat);
  return {
    view, me: game.user.id, staff,
    c: (id) => { const cb = combat.combatants.get(id), base = cb ? ctx.c(id) : null; return base ? { name: base.name, npc: base.npc, img: portrait(cb) } : null; },
    attrs: (id) => { try { const a = Sys.actorOf(combat.combatants.get(id)); return a && (staff || a.isOwner || view?.revealed?.[id]?.stats) ? Sys.actorFacts(a)?.attrs ?? null : null; } catch { return null; } },
    userName: (u) => game.users.get(u)?.name ?? null,
  };
}
/* the dock's model for staff: the bar of whoever has the turn (or of the combatant the GM chose), from the full state */
function staffModel(combat, desk) {
  const state = Api.state(combat), cid = st.dock.sel && state?.ledger?.[st.dock.sel] ? st.dock.sel : state?.init?.curMember ?? null;
  if (!state || !cid) return { bars: [], prompts: [], mine: [], stack: desk?.info ?? [], waiting: desk?.waiting ?? [], turn: desk?.turn ?? null };
  const bar = Api.pure.desk.barModel(state, cid, { ...Engine.context(combat), P1: Api.pure.economy });
  if (bar.endTurn) bar.endTurn = { ...bar.endTurn, req: { ...bar.endTurn.req, force: true } };
  const owners = Engine.context(combat).c(cid)?.owners ?? [];
  st.dock.quiet = !Engine.context(combat).c(cid)?.npc && owners.some((u) => game.users.get(u)?.active && !Store.isStaff(game.users.get(u)));
  const mine = (desk?.info ?? []).filter((i) => i.actor === cid).map((i) => ({ ...i, rolls: [], commands: [] }));
  return { bars: [bar], prompts: [], mine, stack: desk?.info ?? [], waiting: desk?.waiting ?? [], turn: desk?.turn ?? null };
}

function refresh() {
  try {
    const combat = down ? null : combatNow();
    if (!combat) { Pick.stop(); Dock.render({ show: false }); Desk.render({ show: false }); pokeTray(); return; }
    const staff = Store.isStaff(game.user), facts = factsOf(combat);
    const key = `${combat.id}:${facts.view?.round}:${facts.view?.init?.curMember}`;
    if (key !== turnKey) { turnKey = key; st.dock = { ...blankDock(), picks: st.dock.picks, texts: st.dock.texts }; }        // a new turn: nothing stays armed
    const desk = staff ? Api.desk(combat) : null;
    if (staff) {
      if (!st.desk.touched) st.desk.collapsed = window.innerWidth < NARROW;
      Desk.render(Model.deskData(desk, st.desk, facts, t), st.desk);
    } else Desk.render({ show: false });
    const model = staff ? staffModel(combat, desk) : Api.player(combat);
    const data = Model.dockData(model, st.dock, facts, t);
    Dock.render(data, st.dock);
    if (data.show && data.panel?.kind === "declare" && data.panel.targets) Pick.start(combat, data.panel.targets.map((x) => x.id), (cid) => setDock({ targets: [cid] }));
    else Pick.stop();
    watch(); pokeTray();
  } catch (e) { console.warn(LOG, "refresh failed", e); }
}
const schedule = () => { clearTimeout(timer); timer = setTimeout(refresh, 40); };
let trayWas = null;
function pokeTray() { try { const on = active(); if (on !== trayWas) { trayWas = on; game.modules.get(MOD)?.api?.turn?.refresh?.(); } } catch { /* the tray is optional */ } }

/* ---------- what the surfaces call ---------- */
function setDock(patch) { Object.assign(st.dock, patch); refresh(); }
function setDesk(patch) { Object.assign(st.desk, patch); refresh(); }
async function send(which, req, after) {
  try {
    if (!req) return null;
    const combat = combatNow();
    const env = await Api.request(req, combat ?? undefined);
    if (env?.ok === false) { if (env.error?.code !== "gone") notify("warn", errText(env.error)); refresh(); return env; }
    if (after) Object.assign(st[which], after);
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
    const r = await Zones.pick({ zones: option.zones, title: t("ITAC.ui.pick.title", { name: ask.about ?? "" }), color: "target" });
    if (r?.ok) await send(which, option.zoneReq(r.spot ?? r.zone));
    else if (r?.reason && !["cancelled", "replaced"].includes(r.reason)) notify("warn", t("ITAC.warn.zones", { reason: t(`ITAC.reason.${r.reason}`, {}, String(r.reason)) }));
  } catch (e) { console.warn(LOG, "zone pick failed", e); }
}
const LABELS = { peek: "ITAC.ui.peek", cancel: "ITAC.ui.cancel", chance: "ITAC.ui.chance", target: "ITAC.ui.target", pool: "ITAC.ui.pool", dock: "ITAC.ui.dock", waitingFor: "ITAC.ui.waitingFor", "pick.hint": "ITAC.ui.pick.hint", "undo.sure": "ITAC.ui.undo.sure" };
const label = (k) => t(LABELS[k] ?? k);

function configure() {
  Dock.configure({
    set: setDock, send: (req, after) => send("dock", req, after), label,
    pick: multi("dock"), text: text("dock"), always: () => {}, zone: (o, a) => zone("dock", o, a),
    target: (cid) => { try { Pick.show(combatNow(), cid); } catch { /* a courtesy */ } },
    amend: (p) => { const combat = combatNow(), i = combat ? Api.player(combat).mine.find((x) => x.inst === p.inst) : null; if (i) setDock({ armed: i.action, mode: null, amend: i.inst, targets: i.targets.map((x) => x.id), text: i.text ?? "" }); },
  });
  Desk.configure({
    set: setDesk, send: (req, after) => send("desk", req, after), label,
    pick: multi("desk"), text: text("desk"), always: (id, on) => { st.desk.always[id] = !!on; refresh(); }, zone: (o, a) => zone("desk", o, a),
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
  for (const id of ["hotbar", "sidebar", "invincible-party", "invincible-challenges", "invincible-tactics-desk", "chat-notifications", "players"]) {
    const el = document.getElementById(id);
    if (el && el.dataset.itdWatched !== "1") { el.dataset.itdWatched = "1"; ro.observe(el); }
  }
}
/** does the dock stand in for the turn tray right now? (scripts/turn/main.mjs) */
export const active = () => { try { return started && !!combatNow(); } catch { return false; } };

/** -> true when the surfaces run on this client */
export function start() {
  if (started) return true;
  if (typeof document === "undefined" || typeof canvas === "undefined") return false;      // no page (the node checks load main.mjs): no surfaces
  try {
    started = true;
    down = !canvas?.scene;
    configure();
    Store.subscribe(schedule);
    for (const hk of ["updateCombat", "createCombat", "deleteCombat", "createCombatant", "updateCombatant", "deleteCombatant", "userConnected", "combatStart"]) Hooks.on(hk, schedule);
    Hooks.on("updateActor", (_a, ch) => { if (ch && ("system" in ch || "name" in ch || "img" in ch || "ownership" in ch)) schedule(); });
    Hooks.on("canvasReady", () => { down = false; schedule(); });
    Hooks.on("canvasTearDown", () => { down = true; Pick.stop(); Dock.hide(); });
    for (const hk of ["collapseSidebar", "changeSidebarTab", "renderHotbar", "renderPlayers"]) Hooks.on(hk, () => { relayout(); setTimeout(relayout, 320); });
    window.addEventListener("resize", () => { if (!st.desk.touched) schedule(); else relayout(); });
    document.addEventListener("keydown", (ev) => { try { if (ev.key === "Escape" && (st.dock.armed || st.dock.mode) && Dock.el()?.contains(document.activeElement)) { ev.stopPropagation(); setDock({ armed: null, mode: null, amend: null }); } } catch { /* ignore */ } }, true);
    Api.ui = { active, refresh, state: () => st };
    refresh();
    return true;
  } catch (e) { console.warn(LOG, "start failed", e); return false; }
}
