/* Tactical combat, the surfaces: THE PLAY ON THE MAP, the Foundry side (W1; ledger rows U32-U40, U42-U44). What ui/board-pure.mjs and
   ui/model-pure.mjs say stands on the map is handed to the map module here, through the one zones adapter, and what the user does on
   the map (a zone clicked, a right click on a token or a door) comes back as a patch of the dock's own state or as a request.
   EVERYTHING HERE IS A SHOW ON THIS CLIENT, built from this user's own view: marks, lines, warnings and areas are never sent to
   another user (no `users`), so nothing a player's view withholds can reach that player's map, and the GM's client does no work for
   a player's map. The one thing that leaves the client is the armed intention (U43), which the map sends to the GMs alone.
   COST. Nothing runs per mouse move: the map itself draws the route, the hover parts of a mark and the caught tokens of an area from
   what it was handed once. The engine is asked once per change of the declaration or of the fight (main.mjs, facts.reach), once per
   right click on a token (the menu). An intention is said again only when what is armed or the marked token under the pointer
   changes (the map's own enter / leave hook), and the map throttles it.
   The surface writes nothing: requests only (main.mjs `send`). Everything is in try / catch: the map is optional. */
import * as Zones from "../zones-adapter.mjs";
import * as Mv from "../movement.mjs";
import * as Model from "./model-pure.mjs";
import * as BP from "./board-pure.mjs";
import { faOf } from "./dom.mjs";
import { policyReq } from "../desk-pure.mjs";
import { tIn } from "../lang.mjs";

const LOG = "invincible-plus-ultra (tactics board) |";
const DONE = { armed: null, mode: null, to: null, ask: null, why: "", targets: [], tokens: [], text: "", amend: null, weapon: null, opts: {} };
const HZ_ID = "ipu.hz";
const MOD_ID = "invincible-plus-ultra";
const ARM = { mode: null, tokens: [], text: "", amend: null, endArmed: false, weapon: null, opts: {}, peek: true };
let H = null;                 // main.mjs: { t, set(patch), send(req, after), press(fk), notify(kind, text), refresh(), request(req), bar(cid), dock(), showToken(cid) }
let started = false, on = false, last = null, shown = {};
let movePick = null, areaPick = null, menuBusy = false, hover = null, intentKey = "null", intentAt = 0, intentSpec = null, intentTimer = 0, fire = null;
const steps = {};             // the GM's steppers: one request once the clicking stops

const t = (...a) => H.t(...a);
/* D109: an intention is read on the GMs' maps, so its words are the GMs' language (each GM's client writes it on its own user, ui/main.mjs):
   one language for all GMs at the table -> that one; none known, or the GMs read different ones -> this client's own words, as before */
const gmLang = () => { try { const l = [...new Set(game.users.filter((u) => u.isGM && u.active).map((u) => u.getFlag?.(MOD_ID, "lang")).filter((x) => typeof x === "string" && x))]; return l.length === 1 ? l[0] : null; } catch { return null; } };
const intentWords = (p) => {
  const l = p ? gmLang() : null, a = l ? H.bar?.(last?.data?.who?.id)?.actions?.find((x) => x.id === p.action) : null;      // the bar's entry: its name as a key of the lang table (a sheet's own ability keeps its name)
  return BP.intentLabel(a && !a.kit && typeof a.label === "string" && a.label.startsWith("ITAC.") ? tIn(l, a.label, {}, p.title) : p?.title);
};
const tokDoc = (cid) => { try { const td = last?.combat?.combatants.get(cid)?.token ?? null; return td?.object?.visible ? td : null; } catch { return null; } };
const tid = (cid) => tokDoc(cid)?.id ?? null;
const cidOf = (td) => { try { const id = td?.document?.id ?? td?.id ?? null; return id ? last?.combat?.combatants.find((c) => c.tokenId === id)?.id ?? null : null; } catch { return null; } };
const zoneOfCid = (cid) => { try { const td = tokDoc(cid); return td ? Zones.placeOf(td)?.zone ?? null : null; } catch { return null; } };
const spotOfCid = (cid) => { try { const td = tokDoc(cid); return td ? Zones.placeOf(td)?.spot ?? null : null; } catch { return null; } };
const norm = (key) => String(key ?? "").split("|").sort().join("|");
/* U36: is this token ringed as caught by the area under the pointer? The map hands over every token it draws for this user; whom a
   PLAYER may be told about is decided here as well, from the player's own view (P8f: it rested on the map alone): a combatant that
   is not among the candidates of the declaration (the view does not hold it), one the character has not seen, and a token Foundry
   hides or does not draw for this user are never counted. */
function caught(doc, who, dec, staff) {
  const cid = cidOf(doc);
  if (cid === who) return false;
  const x = cid ? dec.targets.find((y) => y.id === cid) : null;
  if (!staff) {
    if (doc?.hidden === true || doc?.document?.hidden === true || (doc?.object ?? doc)?.visible === false) return false;
    if (cid && (!x || x.note)) return false;
  }
  // (U133: the chance as its sign in the token's corner)
  const o = x?.reach === "in" ? BP.oddsShow(x.odds) : {};
  return Object.keys(o).length ? o : true;
}
function put(id, set, clear, spec) {
  const key = spec ? JSON.stringify(spec) : "";
  if ((shown[id] ?? "") === key) return;
  shown[id] = key;
  try { if (spec) set({ id, ...spec }); else clear(id); } catch (e) { console.warn(LOG, id, e); }
}
/** the fire of the map, read once per change of the fight or of the map */
function fireNow() {
  if (!last) return null;
  if (fire?.rev !== last.rev) fire = { rev: last.rev, map: BP.fireMap(Mv.api.zoneFacts()) };
  return fire.map;
}
/** U32: what waits on a way of `cid` beyond its walls (model-pure.movePanel asks through facts.hazards) */
export function hazards(cid, zones, to) { try { return last ? BP.zoneHazards(fireNow(), zones, to, { ...(Mv.api.c(cid) ?? {}), id: cid }, Mv.api.zoneFacts(), t) : []; } catch { return []; } }

/* ---------- U38 / U39: the state of the table, from this user's view ---------- */
function table() {
  const s = BP.tableShow(last.view, last.facts, t);
  const tokens = s.marks.map((m) => ({ token: tid(m.cid), marks: m.marks })).filter((x) => x.token);
  put(BP.IDS.table, Zones.markTokens, Zones.clearTokenMarks, tokens.length ? { order: 0, tokens } : null);
  const links = s.links.map((l) => ({ ...(tid(l.from) ? { from: tid(l.from) } : {}), to: tid(l.to), label: l.label, color: l.color })).filter((l) => l.to);
  put(BP.IDS.links, Zones.link, Zones.clearLinks, links.length ? { links } : null);
}
/* ---------- U33 / U34 / U36: whom the armed action can be aimed at ---------- */
function reach() {
  const d = last.data, p = d?.show ? d.panel : null, dec = p?.kind === "declare" ? p : null, who = d?.who?.id;
  const tokens = (dec ? BP.reachMarks(dec, t) : []).map(({ cid, ...r }) => ({ token: tid(cid), ...r })).filter((x) => x.token);
  put(BP.IDS.reach, Zones.markTokens, Zones.clearTokenMarks, tokens.length ? { order: 2, color: "target", tokens } : null);
  const aim = dec?.aim?.length && tid(who) ? dec.aim.map((x) => ({ from: tid(who), to: tid(x.id) })).filter((l) => l.to) : [];
  put(BP.IDS.aim, Zones.link, Zones.clearLinks, aim.length ? { color: "target", style: "dashed", links: aim } : null);      // dashed: chosen, not declared yet
  /* U36: an area attack is put on a zone: the map fills it and rings everyone caught under the pointer, friends too */
  const area = !!dec && areaMode(dec), inReach = area ? dec.targets.filter((x) => x.map && x.reach === "in") : [], staff = !!last.staff;
  const zones = [...new Set(inReach.map((x) => zoneOfCid(x.id)).filter(Boolean))];
  if (area && zones.length && tid(who)) {
    const key = `${who}|${dec.action}|${zones.join(",")}|${dec.submit?.req ? 1 : 0}`;
    if (areaPick?.key !== key && !menuBusy) {
      const mine = (areaPick = { key });
      Zones.pickArea({ zones: zones.map((zone) => ({ zone, color: "target" })), radius: 0, token: tid(who), intent: { label: intentWords(dec) }, color: "target", title: t("ITAC.map.area.title", { name: d.who.name }), hint: t("ITAC.map.area.hint"),
        tokens: (doc) => caught(doc, who, dec, staff) }).then((r) => {
        if (areaPick !== mine) return;
        areaPick = null;
        if (!r?.ok) { if (r?.reason !== "replaced") H.set({ armed: null, mode: null }); return; }
        const first = inReach.find((x) => zoneOfCid(x.id) === r.zone);
        if (!first) return H.refresh();
        if (dec.targets.some((x) => x.picked && zoneOfCid(x.id) === r.zone) && dec.submit?.req) H.press("go");      // the same zone again: declare
        else H.set({ targets: [first.id] });
      });
    }
  } else if (areaPick) { areaPick = null; Zones.cancelPick(); }
  const chosen = area ? dec.targets.find((x) => x.picked && x.map) : null, z = chosen ? zoneOfCid(chosen.id) : null;
  /* D79: `level` is the SPOT the chosen target stands on (the zone and its level). A token id is not one of the forms the map reads
     there: it took it for a spot that does not exist and rang everybody on every level of the zone. */
  const lv = chosen ? spotOfCid(chosen.id) : null;
  put(BP.IDS.area, Zones.areaPreview, Zones.clearArea, z && lv ? { at: z, radius: 0, tokens: true, level: lv } : null);
  /* the GM's hazard tool (the desk): the zone chosen there, with everyone standing in it, before the hazard is let loose */
  put(HZ_ID, Zones.areaPreview, Zones.clearArea, last.hz ? { at: last.hz, radius: 0, tokens: true, color: "danger" } : null);
}
/** is the armed declaration an area attack that is put on the map? (main.mjs then leaves the token pick off) */
export const areaMode = (p) => p?.kind === "declare" && !!p.area && !!p.onMap && !!p.reached && Zones.hasBoard();

/* ---------- U32 / U14: a move under the pointer ---------- */
function waysMenu(p, zone, drag = false) {
  const rows = p.ways?.[zone] ?? [];
  if (!rows.length) { if (drag) { H.notify("warn", t("ITAC.move.cannot", { reason: Model.reasonText(t, "noRoute") })); H.set({ armed: null, mode: null }); } return; }
  const blocked = rows.filter((r) => r.disabled);
  const items = rows.map((r) => ({ id: r.id, label: r.label, icon: faOf("move"), hint: r.hint, ...(r.signs ? { signs: r.signs } : {}), ...(r.disabled ? { disabled: r.disabled } : {}) }));      // U100: `signs` the price as marks
  if (blocked.length === rows.length) items.push({ separator: true }, { id: "@ask", label: t(last.staff ? "ITAC.map.menu.gm" : "ITAC.map.menu.ask"), icon: last.staff ? "fa-solid fa-gavel" : "fa-solid fa-comment" });
  menuBusy = true;
  Zones.menu({ zone, title: Model.zoneText(last.facts, t, zone), sub: p.title, items }).then((r) => {
    menuBusy = false;
    if (!r?.ok) return drag ? H.set({ armed: null, mode: null }) : H.refresh();
    if (r.id === "@ask") return last.staff && blocked[0].gm ? H.send(blocked[0].gm, DONE) : H.set({ ask: blocked[0].id, why: "" });      // U106: the GM's word goes at once; a player writes why first
    const w = rows.find((x) => x.id === r.id);
    return w?.req ? H.send(w.req, DONE) : H.refresh();
  }).catch(() => { menuBusy = false; });
}
function move() {
  const d = last.data, p = d?.show ? d.panel : null, who = d?.who?.id;
  if (!(p?.kind === "move" && p.picking && p.ways && tid(who))) { if (movePick) { movePick = null; Zones.cancelPick(); } return; }
  const own = H.dock();
  if (own.menuAt) {                                                                           // a token was dragged into that zone, or a wall was asked about: its ways, priced
    const z = own.menuAt, drag = !!own.dragMenu; own.menuAt = null; own.dragMenu = false;
    if (movePick) { movePick = null; Zones.cancelPick(); }
    return waysMenu(p, z, drag);
  }
  const key = `${who}|${p.action}|${JSON.stringify(p.zones)}`;
  if (movePick?.key === key || menuBusy) return;
  const mine = (movePick = { key });
  setTimeout(() => { if (movePick === mine) H.showToken(who); }, 350);                        // U5: the character is kept out from under the dock
  Zones.pickMove({ token: tid(who), zones: p.zones.map(({ way, ask, menu, tip, ...z }) => z), intent: { label: intentWords(p) }, title: t("ITAC.ui.pick.title", { name: d.who.name }), hint: p.hint, color: "move" }).then((r) => {
    if (movePick !== mine) return;                                                            // given up or replaced by a newer one
    movePick = null;
    if (!r?.ok) {
      if (r?.reason && !["cancelled", "replaced"].includes(r.reason)) H.notify("warn", t("ITAC.warn.zones", { reason: t(`ITAC.reason.${r.reason}`, {}, String(r.reason)) }));
      if (r?.reason !== "replaced") H.set({ armed: null, mode: null });
      return;
    }
    const e = p.zones.find((z) => z.zone === r.zone);
    if (!e) return H.refresh();
    if (r.alt || e.menu || (!e.way && !e.ask)) return waysMenu(p, e.zone);                    // another way was asked for (right click), or there is no single default
    if (e.way) { const w = (p.ways[e.zone] ?? []).find((x) => x.id === e.way); return w?.req ? H.send(w.req, DONE) : H.refresh(); }      // ONE CLICK: the default way
    return H.set({ ask: e.ask, why: "" });                                                    // a zone nobody can pay for or reach: the reason and the way to ask
  }).catch(() => { if (movePick === mine) movePick = null; });
}
/* ---------- U40: the zone where the turn would end ---------- */
function warn() {
  const d = last.data, who = d?.show && d.onTurn ? d.who?.id : null, spot = who ? last.facts.where?.(who) : null;
  const w = spot ? BP.endWarnings(fireNow(), spot, Mv.api.c(who), Mv.api.zoneFacts(), t) : [];
  put(BP.IDS.warn, Zones.warnOn, Zones.clearHighlights, w.length ? { zones: w } : null);
}
/* ---------- U43: what this user has armed, for the GMs (a player's client; the map sends it to the GMs alone) ---------- */
function intent() {
  if (!last || last.staff) return;
  const d = last.data, p = d?.show && d.panel?.kind === "declare" && !areaMode(d.panel) ? d.panel : null, from = p ? tid(d.who.id) : null;
  const to = p && hover && p.targets?.some((x) => x.id === hover && x.map) ? hover : p?.aim?.[0]?.id ?? null;
  const spec = from ? { token: from, ...(to && tid(to) ? { to: tid(to) } : {}), label: intentWords(p), ttl: INTENT_TTL } : null;
  const key = JSON.stringify(spec), now = Date.now();
  if (key === intentKey && (!spec || now - intentAt < INTENT_AGAIN)) return;
  say(spec, key);
}
/* D58 (U43, W1-7): the GMs' maps drop an intention after its `ttl` unless it is said again, and this surface spoke only inside a sync
   or a change of the token under the pointer: an action armed and left standing fell silent, and left the GM's map with the action
   still armed. Now a clock of the board's own says the standing intention again every INTENT_AGAIN ms, for as long as it stands
   (the same words: the map sends an intention said again to the GMs again, zones-api.md section 32); it stops when the intention
   is taken back. One message per period, never per mouse move. */
export const INTENT_AGAIN = 100000, INTENT_TTL = 120000;
function say(spec, key) {
  intentKey = key; intentAt = Date.now(); intentSpec = spec;
  clearTimeout(intentTimer); intentTimer = 0;
  try { Zones.intent(spec); } catch { /* the map is optional */ }
  if (spec) { intentTimer = setTimeout(() => { intentTimer = 0; if (intentSpec && intentKey !== "null") say(intentSpec, intentKey); }, INTENT_AGAIN); intentTimer?.unref?.(); }
}

/* ---------- U35 / U44: a right click on a thing ---------- */
/* U80 (P8f-8): a correction that the executor refused left the refused number standing in the open menu (the map draws the stepper and
   shows what was clicked). The menu is the map's, so it is opened again at the same token with the numbers as they are; a menu the
   GM closed in the meantime stays closed (the warning was said). */
function again(cid) {
  try {
    if (!last?.staff || !Zones.menuOpen()) return;
    const doc = tokDoc(cid), acts = cid === last.data?.who?.id || last.data?.rest ? [] : Model.targetActs(H.bar(last.data.who.id), cid, last.facts, t);
    if (!doc) return;
    Promise.resolve(tokenMenu(cid, acts)).then((spec) => { if (spec && Zones.menuOpen()) Zones.menu({ token: doc.id, ...spec }); }).catch(() => {});
  } catch (e) { console.warn(LOG, "menu again failed", e); }
}
function tokenMenu(cid, acts) {
  const { combat, facts, staff, data } = last, who = data.who.id, name = facts.c?.(cid)?.name ?? "";
  const fix = () => {
    if (!staff) return [];
    const items = BP.gmItems(cid, facts.vitals?.(cid), last.view?.statuses?.[cid] ?? [], t, facts.c?.(cid)?.kind === "minions" ? { quick: last.view?.npc?.[cid]?.quick === true, req: (on) => policyReq(last.view, cid, { quick: on }) } : null);
    /* a stepper sends ONE request once the clicking stops (450 ms): the STEP from the number the last request was counted from, which
       the executor adds to what the character has at that moment (so a hit that landed while the menu stood open is kept). One
       burst of clicks is one journal entry, one undo. A request that fails is said by main.mjs (`request` warns). */
    return items.map((it) => { let from = it.stepper?.value; return (it.stepper ? { id: it.id, label: it.label, icon: it.icon, stepper: it.stepper, onStep: (v) => { const k = `${cid}|${it.id}`; clearTimeout(steps[k]); steps[k] = setTimeout(() => { steps[k] = 0; const was = from; from = v; if (v !== was) Promise.resolve(H.request(it.req(v, was))).then((env) => { if (BP.stepFailed(env)) { from = was; again(cid); } }).catch(() => {}); }, 450); return v; } }
      : { id: it.id, label: it.label, icon: it.icon, ...(it.tip ? { tip: it.tip } : {}), toggle: true, on: it.on, onToggle: async (o) => { const env = await H.request(it.req(o)); return env?.ok === false ? !o : o; } }); });
  };
  const spec = (rows) => {
    const list = BP.actItems(acts, rows, cid, facts, t).map((a) => ({ id: a.id, label: a.label, icon: faOf(a.icon), hint: a.hint, ...(a.signs ? { signs: a.signs } : {}), ...(a.tip ? { tip: a.tip } : {}), ...(a.disabled ? { disabled: a.disabled } : {}),
      run: () => H.set({ ...ARM, sel: who, armed: a.id, targets: [cid] }) })), gm = fix();
    /* the GM's menu stands where Foundry's token HUD would open: one entry brings that HUD up (Shift + right click opens it directly) */
    const hud = staff ? [{ separator: true }, { id: "@unit", label: t("ITAC.map.menu.unit"), icon: "fa-solid fa-address-card", run: () => H.unit?.(cid) }, { id: "@hud", label: t("ITAC.map.menu.hud"), icon: "fa-solid fa-id-badge", run: () => { try { const tok = tokDoc(cid)?.object; if (tok && !tok.controlled) tok.control({ releaseOthers: true }); (canvas.hud?.token ?? tok?.layer?.hud)?.bind(tok); } catch { /* a courtesy */ } } }] : [];      // U128: Foundry's HUD toggles (the eye, the lock) act on the CONTROLLED tokens: the token is taken in hand first, as Foundry's own right-click does
    const items = [...list, ...(list.length && gm.length ? [{ separator: true }] : []), ...gm, ...hud];
    return items.length ? { title: name, ...(gm.length && !list.length ? { sub: t("ITAC.map.menu.fix") } : {}), items } : null;
  };
  if (!acts.length) return spec(null);
  /* one question to the engine for the whole menu: is each action legal against this one, what does it roll, what would a hit do */
  return H.request({ op: "preview", actor: who, decl: acts[0].decl, acts: acts.map((a) => a.decl), at: cid }, combat).then((env) => spec(env?.ok ? env.preview?.acts ?? null : null)).catch(() => spec(null));
}
function borderMenu(br, bar) {
  const { facts, staff, data } = last, who = data.who.id, key = norm(br?.key);
  const door = (facts.doors?.(who) ?? []).find((d) => norm(d.to) === key) ?? null;
  const items = door ? BP.doorItems(bar, door, t).map((a) => ({ id: a.id, label: a.label, icon: faOf(a.icon), hint: a.hint, ...(a.signs ? { signs: a.signs } : {}), ...(a.disabled ? { disabled: a.disabled } : {}), run: () => a.req && H.send(a.req, DONE) })) : [];
  /* a wall (or a door that stays shut) can be gone through by force: the ways of moving that break this very border */
  const through = [...new Set((facts.move?.(who)?.options ?? []).filter((o) => o.zone && (o.barriers ?? []).some((b) => norm(b.border) === key)).map((o) => o.zone))];
  for (const z of through.slice(0, 4)) items.push({ id: `@go:${z}`, label: t("ITAC.map.menu.breach", { zone: Model.zoneText(facts, t, z) }), icon: "fa-solid fa-hammer", run: () => { H.dock().menuAt = z; H.dock().dragMenu = true; H.set({ ...ARM, sel: who, armed: "move" }); } });
  if (!items.length || (staff && !items.some((x) => !x.disabled))) return null;              // nothing of ours here (the GM keeps the map's own door menu)
  const title = door ? t("ITAC.ui.door.to", { zone: Model.zoneText(facts, t, door.zone) }) : t("ITAC.map.haz.wall", { n: br?.armor ?? 0 });
  return { title, ...(door ? { sub: `${t(`ITAC.ui.door.${door.state}`, {}, String(door.state))}, ${t("ITAC.ui.armor", { n: door.armor ?? 0 })}` } : {}), items, signs: BP.borderSigns(door, br, t) };      // U100: Armor as its mark
}
function onCtx(ctx) {
  try {
    if (!last?.data?.show || ctx?.shift || menuBusy) return null;                              // Shift + right click: Foundry's own and the map's own menus
    const who = last.data.who.id, bar = H.bar(who);
    if (!bar) return null;
    if (ctx.kind === "token") {
      const cid = cidOf(ctx.token);
      if (!cid) return null;
      const acts = cid === who || (last.staff && last.data.rest) ? [] : Model.targetActs(bar, cid, last.facts, t);      // (the GM's dock rests while a player drives the hero: only the corrections)
      if (!acts.length && !last.staff) return null;                                            // a player's own token, somebody nothing can be done to: Foundry's token HUD
      return tokenMenu(cid, acts);
    }
    if (ctx.kind === "border") return borderMenu(ctx.border, bar);
    return null;
  } catch (e) { console.warn(LOG, "context failed", e); return null; }
}

/* ---------- main.mjs calls ---------- */
function clear() {
  try {
    if (movePick || areaPick) { movePick = areaPick = null; Zones.cancelPick(); }
    for (const id of [BP.IDS.reach, BP.IDS.table]) put(id, Zones.markTokens, Zones.clearTokenMarks, null);
    for (const id of [BP.IDS.links, BP.IDS.aim]) put(id, Zones.link, Zones.clearLinks, null);
    put(BP.IDS.warn, Zones.warnOn, Zones.clearHighlights, null);
    put(BP.IDS.area, Zones.areaPreview, Zones.clearArea, null); put(HZ_ID, Zones.areaPreview, Zones.clearArea, null);
    if (intentKey !== "null") say(null, "null");
  } catch (e) { console.warn(LOG, "clear failed", e); }
}
/** Put on the map what the dock's data and this user's view say. ctx = { combat, facts, view, staff, rev, hz } | null (no fight here).
    -> true when the map plays (main.mjs then leaves its own zone pick and target marks off) */
export function sync(data, ctx) {
  try {
    if (!started || !Zones.hasBoard()) return false;
    last = ctx?.combat ? { data, ...ctx } : null;
    if (!last) { clear(); if (on) { on = false; Zones.present(null); } return true; }
    if (!on) { on = true; Zones.present({ numbers: "always", distances: false, show: true }); }      // U37: one language of zones for the whole table while a fight runs
    table(); reach(); move(); warn(); intent();
    return true;
  } catch (e) { console.warn(LOG, "sync failed", e); return false; }
}
/** the scene goes away: what was shown went with it */
export function reset() { shown = {}; movePick = areaPick = null; menuBusy = false; hover = null; fire = null; clearTimeout(intentTimer); intentTimer = 0; intentSpec = null; intentKey = "null"; }
export const camera = () => { try { const c = Zones.hasBoard() ? Zones.camera() : null; return c ? { ...c, shots: Zones.hasShot() } : null; } catch { return null; } };
export const setCamera = (follow) => { try { Zones.camera({ follow }); } catch { /* the map is optional */ } };
export function start(h) {
  try {
    if (started) return true;
    H = h; started = true;
    if (!Zones.hasBoard()) return false;
    Zones.camera({ default: Zones.hasShot() ? "action" : "turn" });                           // U98: the action camera is the fight's default; an older map keeps U42's "turn"
    Zones.onContext(onCtx);
    Zones.onTokenHover((doc) => { try { const cid = doc ? cidOf(doc) : null; if (cid !== hover) { hover = cid; intent(); } } catch { /* a courtesy */ } });
    return true;
  } catch (e) { console.warn(LOG, "start failed", e); return false; }
}
