/* Tactical combat, the surfaces: THE ACTION DOCK (the player's surface; the same dock serves the GM driving an NPC). DOM + placement only:
   main.mjs hands over the render data of model-pure.dockData and receives clicks through configure({ ... }). No Foundry documents here.
   WHERE: bottom centre, 6 px above the macro bar: the place of the turn tray, which this dock replaces while tactical combat runs
   (its pips are the budget chips here, its End turn is the red button). Placement is the tray's: measured, never per frame; pushed clear
   of the party column (left), of the sidebar, the chat notifications and the GM desk (right); a window too narrow lets the bar wrap.
   STRUCTURE (bottom up):  waiting line  <  the bar  <  the panel of the armed action  <  the questions asked of this user.
     bar:   [character tabs] [face, name, budget chips, bonus dice, statuses] [action groups] [Something else] [Hold off] [End turn]
     panel: declare (target chips + map pick, dice, chance band, Declare) | blocked (reason + ask the GM) | something else | hold off |
            the own action in progress (what it waits for, change / cancel)
   RESTING (not the user's turn, nothing armed, nothing asked): only the who block; the chevron opens the bar to look or to ask for an
   exception. A question addressed to the user always shows, whoever's turn it is. */
import { h, icon, swap, face, costIcon, askCard, waitChips, visibleRect } from "./dom.mjs";

const ID = "invincible-tactics-dock";
const GAP = 6;
let root = null, stack = null, handlers = {}, shown = false, hideTimer = 0, last = null;

export function configure(x) { handlers = x ?? {}; }
const set = (patch) => handlers.set?.(patch);
const send = (req, after) => handlers.send?.(req, after);

function ensure(label) {
  if (root?.isConnected) return;
  root = h(`div.itd-hidden`, { attrs: { id: ID, role: "region", "aria-label": label } });
  stack = h("div.itd-stack");
  root.append(stack);
  document.body.appendChild(root);
}

/* ---------- placement (the turn tray's algorithm, with the GM desk as one more thing on the right) ---------- */
export function place() {
  if (!root) return;
  const W = window.innerWidth, H = window.innerHeight;
  const hot = visibleRect(document.getElementById("hotbar"));
  /* other modules park their own strips right above the macro bar (the map director's bar): the dock stands above the highest of them */
  let floor = hot && hot.top > H * 0.4 ? hot.top : H - 14;
  for (const id of ["mm-dir-bar"]) { const r = visibleRect(document.getElementById(id)); if (r && r.top > H * 0.5 && r.top < floor && r.left < W * 0.6 && r.right > W * 0.4) floor = r.top; }
  const bottom = H - floor + GAP;
  const cx0 = hot ? (hot.left + hot.right) / 2 : W / 2;
  let lo = 12, hi = W - 12;
  const yBot = H - bottom, yTop = yBot - (stack.offsetHeight || 60) - 4;
  const inBand = (r) => r && r.top < yBot && r.bottom > yTop;
  const sb = visibleRect(document.getElementById("sidebar"));
  if (sb && sb.left > W * 0.5) hi = Math.min(hi, sb.left - 12);
  for (const m of document.querySelectorAll("#chat-notifications .chat-message")) { const r = visibleRect(m); if (inBand(r) && r.left > W * 0.3) hi = Math.min(hi, r.left - 10); }
  for (const el of document.querySelectorAll("#invincible-tactics-desk .igd, #invincible-tactics-desk .igd-handle")) { const r = visibleRect(el); if (inBand(r) && r.left > W * 0.4) hi = Math.min(hi, r.left - 10); }
  const partyEl = document.getElementById("invincible-party"), party = visibleRect(partyEl);
  if (party && party.right < W * 0.5) {
    const kids = [...partyEl.querySelectorAll(".ipt-item")].map(visibleRect).filter(inBand);
    if (kids.length || inBand(party)) lo = Math.max(lo, Math.max(party.right, ...kids.map((k) => k.right)) + 10);
  }
  const pl = visibleRect(document.getElementById("players"));
  if (inBand(pl) && pl.right < W * 0.3) lo = Math.max(lo, pl.right + 8);
  const avail = Math.max(280, hi - lo);
  root.style.setProperty("--itd-bottom", `${Math.round(bottom)}px`);
  root.style.setProperty("--itd-maxw", `${Math.round(avail)}px`);
  /* the questions scroll inside what is left above the bar and the panel, below the initiative bar */
  const asks = stack.querySelector(".itd-asks"), below = asks ? stack.offsetHeight - asks.offsetHeight : 0;
  root.style.setProperty("--itd-maxh", `${Math.max(160, Math.round(H - bottom - below - 96))}px`);
  const w = Math.min(stack.offsetWidth, avail);
  let cx = cx0;
  if (cx + w / 2 > hi) cx = hi - w / 2;
  if (cx - w / 2 < lo) cx = lo + w / 2;
  root.style.setProperty("--itd-cx", `${Math.round(cx)}px`);
}

/* ---------- pieces ---------- */
const pip = (p) => h("button.itd-pip", { fk: `pip:${p.key}`, tip: p.tip, disabled: !p.req, data: { state: p.state, kind: p.kind }, attrs: { "aria-label": p.tip }, on: { click: () => p.req && send(p.req) } }, costIcon(p.unit), h("span", { text: p.label }));

function whoBlock(d) {
  const w = d.who;
  return h("div.itd-who", {},
    d.chars.length ? h("div.itd-chars", { attrs: { role: "group" } }, d.chars.map((c) => h(`button.itd-char${c.onTurn ? ".itd-char-turn" : ""}${c.asked ? ".itd-char-asked" : ""}`, { fk: `char:${c.id}`, tip: c.name, attrs: { "aria-pressed": String(c.sel) }, on: { click: () => set({ sel: c.id, armed: null, mode: null, targets: [], tokens: [], text: "" }) } }, face(c.img, c.name)))) : null,
    !d.chars.length ? face(w.img, w.name, "ita-face.itd-face") : null,
    h("div.itd-id", {},
      h("span.itd-name", { text: w.name }),
      h("div.itd-pips", { attrs: { role: "group" } }, d.pips.map(pip), d.extras.map((x) => h(`span.itd-extra`, { text: x.label, tip: x.tip || null, data: { kind: x.kind } })), w.free ? h("span.itd-extra", { text: w.freeLabel, data: { kind: "free" } }) : null)));
}
function actionBtn(a) {
  return h(`button.itd-act${a.armed ? ".itd-armed" : ""}`, { fk: `act:${a.id}`, disabled: !!a.disabled, clickWhenDisabled: true, tip: a.disabled ? a.disabled : a.costText, attrs: { "aria-pressed": String(!!a.armed), "aria-label": [a.label, a.costText, a.disabled].filter(Boolean).join(", ") },
    on: { click: () => set(a.armed ? { armed: null, mode: null } : { armed: a.id, mode: null, targets: [], tokens: [], text: "", amend: null, endArmed: false }) } }, costIcon(a.cost), h("span", { text: a.label }));
}
function bar(d) {
  const e = d.end;
  return h("div.itd-bar", {},
    whoBlock(d),
    d.rest ? h("button.itd-peek", { fk: "peek", tip: handlers.label?.("peek"), on: { click: () => set({ peek: true }) } }, icon("fa-chevron-up")) : [
      h("div.itd-groups", {}, d.groups.map((g) => h("div.itd-group", { attrs: { role: "group", "aria-label": g.label } }, h("span.itd-glabel", { text: g.label }), h("div.itd-gacts", {}, g.items.map(actionBtn))))),
      h("div.itd-tail", {},
        h(`button.itd-ghost${d.other.armed ? ".itd-armed" : ""}`, { fk: "other", tip: d.other.tip, attrs: { "aria-pressed": String(d.other.armed) }, on: { click: () => set(d.other.armed ? { mode: null } : { mode: "other", armed: null, text: "", endArmed: false }) } }, icon("fa-pen"), h("span", { text: d.other.label })),
        h(`button.itd-ghost${d.holdOff.armed ? ".itd-armed" : ""}`, { fk: "hold", disabled: !!d.holdOff.disabled, tip: d.holdOff.disabled ?? d.holdOff.tip, attrs: { "aria-pressed": String(d.holdOff.armed) }, on: { click: () => set(d.holdOff.armed ? { mode: null } : { mode: "holdOff", armed: null, endArmed: false }) } }, icon("fa-hourglass-half"), h("span", { text: d.holdOff.label })),
        h(`button.itd-end${e.armed ? ".itd-end-sure" : ""}`, { fk: "end", disabled: !!e.disabled, tip: e.tip, on: { click: () => (e.confirm && !e.armed ? set({ endArmed: true }) : e.req && send(e.req, { endArmed: false })) } }, icon("fa-forward-step"), h("span", { text: e.label })),
        d.canRest ? h("button.itd-peek", { fk: "peek", tip: handlers.label?.("cancel"), on: { click: () => set({ peek: false, armed: null, mode: null }) } }, icon("fa-chevron-down")) : null),
    ]);
}

const close = () => set({ armed: null, mode: null, targets: [], tokens: [], text: "", amend: null });
const textBox = (value, placeholder, key = "text") => h("textarea.itd-text", { fk: `draft:${key}`, text: value, attrs: { rows: 2, maxlength: 300, placeholder, "aria-label": placeholder }, on: { input: (e, el) => set({ [key]: el.value }) } });
const submit = (s, cls = "") => h(`button.itd-go${cls}`, { fk: `go${cls}`, text: s.label, disabled: !!s.disabled, tip: s.disabled, on: { click: () => s.req && send(s.req, { armed: null, mode: null, targets: [], tokens: [], text: "", amend: null }) } });
const cancelBtn = () => h("button.itd-x", { fk: "x", tip: handlers.label?.("cancel"), on: { click: close } }, icon("fa-xmark"));
const head = (p) => h("header.itd-phead", {}, h("h3.ita-plate", { text: p.title }), p.cost ? h("span.itd-cost", { text: p.cost }) : null, cancelBtn());

function meter(c) {
  return h("div.itd-chance", {}, h("span.itd-k", { text: handlers.label?.("chance") }),
    h("span.itd-meter", { data: { level: c.level }, attrs: { role: "img", "aria-label": c.text } }, [0, 1, 2, 3].map((i) => h(`i${i <= c.level ? ".on" : ""}`))), h("b.itd-band", { text: c.text }),
    c.defended ? h("span.itd-def", {}, h("span", { text: `${c.defended.label}: ` }), h("b", { text: c.defended.text })) : null);
}
/* one way to make a move / one door: the name, what it costs, and when it cannot be done the reason (a click then opens the way to ask) */
const wayRow = (r) => h(`button.itd-way${r.asking ? ".itd-armed" : ""}`, { fk: `way:${r.id}`, disabled: !!r.disabled, clickWhenDisabled: true, data: { warn: r.warn ? "1" : null },
  attrs: { "aria-label": [r.label, ...r.notes, r.disabled].filter(Boolean).join(", "), "aria-pressed": r.disabled ? String(!!r.asking) : null },
  on: { click: () => (r.disabled ? set({ ask: r.asking ? null : r.id, why: "" }) : r.req && send(r.req, { armed: null, mode: null, to: null, ask: null, why: "" })) } },
  costIcon(r.cost), h("span.itd-way-l", { text: r.label }), h("span.itd-way-n", { text: r.notes.join(" · ") }), r.disabled ? h("span.itd-way-why", {}, icon("fa-ban"), h("span", { text: r.disabled })) : null);
const askRow = (a) => (a ? h("div.itd-pbody.itd-refused", {}, a.reason ? h("p.itd-reason", {}, icon("fa-ban"), h("span", { text: a.reason })) : null,
  a.text !== null ? h("div.itd-col.itd-grow", {}, textBox(a.text, a.placeholder, "why")) : null,
  h("div.itd-col.itd-submit", {}, submit(a.submit, ".itd-go-ask"))) : null);
function movePanel(p) {
  return h("section.itd-panel", { data: { kind: p.kind } },
    h("header.itd-phead", {}, h("h3.ita-plate", { text: p.title }), p.dest ? h("span.itd-arrow", {}, icon("fa-arrow-right"), h("b", { text: p.dest.label })) : null, cancelBtn()),
    p.empty ? h("div.itd-pbody", {}, h("p.itd-reason", {}, icon("fa-ban"), h("span", { text: p.empty }))) : null,
    p.hint ? h("div.itd-pbody", {}, h("p.itd-hint", {}, icon("fa-map-location-dot"), h("span", { text: p.hint }))) : null,
    p.dest ? h("div.itd-pbody", {}, h("div.itd-ways", { attrs: { role: "group", "aria-label": p.dest.label } }, p.dest.rows.map(wayRow)),
      h("div.itd-col.itd-submit", {}, h("button.itd-ghost", { fk: "again", on: { click: () => set({ to: null, ask: null, why: "" }) } }, icon("fa-map-location-dot"), h("span", { text: p.dest.again })))) : null,
    p.near.length ? h("div.itd-pbody.itd-near", {}, h("span.itd-k", { text: p.nearLabel }), h("div.itd-ways", { attrs: { role: "group", "aria-label": p.nearLabel } }, p.near.map(wayRow))) : null,
    askRow(p.ask));
}
function doorPanel(p) {
  return h("section.itd-panel", { data: { kind: p.kind } }, head(p),
    p.empty ? h("div.itd-pbody", {}, h("p.itd-hint", {}, icon("fa-door-closed"), h("span", { text: p.empty }))) : h("div.itd-pbody", {}, h("div.itd-ways", { attrs: { role: "group", "aria-label": p.title } }, p.rows.map(wayRow))),
    askRow(p.ask));
}
/* P7: the ways of a challenge, one chip each, grouped by what they work on; the last chip is an idea of the player's own */
function approach(a) {
  const chip = (key, label, on, tip, patch, dim = false) => h(`button.itd-chip.itd-chip-plain${dim ? ".itd-chip-dim" : ""}`, { fk: `ap:${key}`, tip, attrs: { "aria-pressed": String(!!on) }, on: { click: () => set(patch) } }, h("span", { text: label }));
  return h("div.itd-col.itd-approach", {}, h("span.itd-k", { text: a.label }),
    a.groups.map((g) => h("div.itd-apg", { attrs: { role: "group", "aria-label": g.label } }, h("span.itd-apn", { text: g.label }), h("div.itd-chips", {}, g.rows.map((r) => chip(r.id, r.label, r.picked, r.tip, { opt: r.id }, r.dim))))),
    a.own.lone ? null : h("div.itd-chips", {}, chip("own", a.own.label, a.own.picked, a.own.tip, { opt: "own" })),
    a.own.attrs ? h("div.itd-apg.itd-apg-wide", { attrs: { role: "group", "aria-label": a.own.attrLabel } }, h("span.itd-apn", { text: a.own.attrLabel }), h("div.itd-chips", {}, a.own.attrs.map((x) => chip(`at:${x.id}`, x.label, x.picked, null, { attr: x.id })))) : null);
}
function panel(p) {
  if (!p) return null;
  if (p.kind === "move") return movePanel(p);
  if (p.kind === "door") return doorPanel(p);
  if (p.kind === "declare") {
    const toggle = (key, id, max = 1) => { const cur = (last.ui?.[key] ?? []).slice(); const i = cur.indexOf(id); if (i >= 0) cur.splice(i, 1); else { cur.push(id); while (cur.length > max) cur.shift(); } set({ [key]: cur }); };
    return h("section.itd-panel", { data: { kind: p.kind } }, head(p),
      h("div.itd-pbody", {},
        p.targets ? h("div.itd-col.itd-targets", {}, h("span.itd-k", { text: handlers.label?.("target") }),
          h("div.itd-chips", { attrs: { role: "group" } }, p.targets.map((x) => h(`button.itd-chip${x.likely ? "" : ".itd-chip-dim"}`, { fk: `tg:${x.id}`, tip: x.note, attrs: { "aria-pressed": String(x.picked) }, on: { click: () => { toggle("targets", x.id); handlers.target?.(x.id); } } }, face(x.img, x.name), h("span", { text: x.name })))),
          p.picking ? h("p.itd-hint", {}, icon("fa-crosshairs"), h("span", { text: handlers.label?.("pick.hint") })) : null) : null,
        p.approach ? approach(p.approach) : null,
        p.dest ? h("div.itd-col", {}, h("span.itd-k", { text: p.dest.label }), p.dest.value ? h("b.itd-destv", { text: p.dest.value }) : null,
          h("button.itd-ghost", { fk: "dest", on: { click: () => handlers.zonePick?.() } }, icon("fa-map-location-dot"), h("span", { text: p.dest.pick }))) : null,
        p.text ? h("div.itd-col.itd-grow", {}, textBox(p.text.value, p.text.placeholder)) : null,
        p.pool || p.tokens.length ? h("div.itd-col", {},
          p.pool ? h("div.itd-pool", {}, h("span.itd-k", { text: handlers.label?.("pool") }), h("b.itd-dice", { text: String(p.pool.total) }), h("span.itd-parts", { text: p.pool.parts.map((x) => `${x.label} ${x.dice > 0 && x !== p.pool.parts[0] ? "+" : ""}${x.dice}`).join(" · ") })) : null,
          p.tokens.length ? h("div.itd-chips", {}, p.tokens.map((k) => h("button.itd-chip.itd-chip-token", { fk: `tk:${k.id}`, tip: k.source, attrs: { "aria-pressed": String(k.picked) }, on: { click: () => toggle("tokens", k.id, 12) } }, icon("fa-dice-d6"), h("span", { text: `${k.label} ${k.source}` })))) : null,
          p.chance ? meter(p.chance) : null) : null,
        h("div.itd-col.itd-submit", {}, submit(p.submit), p.submit.disabled ? h("span.itd-why", { text: p.submit.disabled }) : null)),
      p.refused ? h("div.itd-pbody.itd-refused", {}, h("p.itd-reason", {}, icon("fa-ban"), h("span", { text: p.refused.reason })),
        p.refused.text !== null ? h("div.itd-col.itd-grow", {}, textBox(p.refused.text, p.refused.placeholder, "why")) : null,
        h("div.itd-col.itd-submit", {}, submit(p.refused.submit, ".itd-go-ask"))) : null);
  }
  if (p.kind === "blocked") return h("section.itd-panel", { data: { kind: p.kind } }, head(p), h("div.itd-pbody", {}, h("p.itd-reason", {}, icon("fa-ban"), h("span", { text: p.reason })), h("div.itd-col.itd-grow", {}, textBox(p.text, p.placeholder)), h("div.itd-col.itd-submit", {}, submit(p.submit, ".itd-go-ask"))));
  if (p.kind === "other") return h("section.itd-panel", { data: { kind: p.kind } }, head(p), h("div.itd-pbody", {}, h("div.itd-col.itd-grow", {}, textBox(p.text, p.placeholder), h("p.itd-hint", { text: p.hint })), h("div.itd-col.itd-submit", {}, submit(p.submit, ".itd-go-ask"))));
  if (p.kind === "holdOff") return h("section.itd-panel", { data: { kind: p.kind } }, head(p), h("div.itd-pbody", {}, h("p.itd-hint", { text: p.hint }),
    h("div.itd-chips", {}, p.targets.map((x) => h("button.itd-chip.itd-chip-card", { fk: `ho:${x.slot}`, on: { click: () => send(x.req, { mode: null }) } }, h("b", { text: String(x.card ?? "?") }), h("span", { text: x.names }))))));
  /* the own action in progress */
  return h("section.itd-panel", { data: { kind: "mine", rolling: p.rolling ? "1" : null } },
    h("header.itd-phead", {}, h("h3.ita-plate", { text: p.title }), p.targets.length ? h("span.itd-arrow", {}, icon("fa-arrow-right"), h("b", { text: p.targets.join(", ") })) : null),
    h("div.itd-pbody", {}, h("p.itd-status", {}, icon(p.rolling ? "fa-dice" : "fa-hourglass-half"), h("span", { text: p.status })), p.text ? h("blockquote.ita-quote", {}, h("span", { text: p.text })) : null,
      h("div.itd-col.itd-submit", {}, p.commands.map((c) => h("button.itd-ghost", { fk: `cmd:${c.id}`, text: c.label, on: { click: () => (c.amend ? handlers.amend?.(p) : c.req && send(c.req)) } })))));
}

/* ---------- render ---------- */
export function render(d, ui = {}) {
  try { draw(d, ui); } catch (e) { console.warn("invincible-plus-ultra | tactics dock", e); }
}
function draw(d, ui) {
  last = { d, ui };
  const any = d?.show || d?.prompts?.length;
  if (!any) return hide();
  ensure(handlers.label?.("dock") ?? "");
  root.classList.toggle("itd-turn", !!d.onTurn);
  root.classList.toggle("itd-rest", !!d.rest);
  const askH = { send: (req) => send(req), pick: handlers.pick, text: handlers.text, always: handlers.always, zone: handlers.zone, again: handlers.again };
  swap(stack, [
    d.prompts?.length ? h("div.itd-asks", {}, d.prompts.map((a) => askCard(a, askH))) : null,
    d.show ? panel(d.panel) : null,
    d.show ? bar(d) : null,
    d.show && (d.waiting?.length || d.turn) ? h("div.itd-wait", { attrs: { role: "status" } }, d.turn ? h("span.itd-turnline", { text: d.turn }) : null, d.waiting.length ? [h("span.itd-k", { text: handlers.label?.("waitingFor") }), waitChips(d.waiting)] : null) : null,
  ]);
  place();
  reveal();
}
function reveal() {
  clearTimeout(hideTimer);
  if (shown) return;
  shown = true;
  root.style.visibility = "";
  requestAnimationFrame(() => requestAnimationFrame(() => root?.classList.remove("itd-hidden")));
}
export function hide() {
  if (!root || !shown) return;
  shown = false;
  root.classList.add("itd-hidden");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { if (root && !shown) root.style.visibility = "hidden"; }, 320);
}
export const relayout = () => { if (root && shown) place(); };
export const el = () => root;
export const isShown = () => shown;
export function destroy() { clearTimeout(hideTimer); root?.remove(); root = stack = null; shown = false; last = null; }
