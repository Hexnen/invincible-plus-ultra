/* Tactical combat, the surfaces: THE GM DESK. DOM + placement only: main.mjs hands over the render data of model-pure.deskData and
   receives clicks through configure({ ... }). No Foundry documents here. Staff clients only (main.mjs never builds it for a player).
   WHERE: a column at the right edge of the map, ending at the sidebar's left edge, BELOW the challenges HUD (which keeps the top right
   corner) and above the bottom edge; its handle folds it to a yellow tab that carries the number of things waiting. The action dock
   treats the open desk as an obstacle, so the two never overlap; in a narrow window the desk starts folded.
   STRUCTURE: head (title, round and whose turn, three tabs) / "waiting for" strip (always visible) / body:
     Now      what is being settled by hand, the action(s) in progress with the step controls (Override opens them), then the queue of
              cards that wait for the GM (reactions of NPCs, exception requests, confirmations, round-point triggers, absent players)
     Journal  closed actions by round, newest first, each with Undo (last-in-first-out; "only this one" asks how to treat drift)
     Scene    (P7) what stands in the fight without a card: the chase (who flees, who follows, the distance, the chase roll, its end),
              the vehicles (who sits where, the state of the machine) and the challenges (a book preset, what the GM runs by hand)
     Table    rules enforced / free, a forced move or a fall ordered by hand (who, away from whom, how far, how hard), a hazard let loose by hand, the karma notes, and per NPC: the standing answers (block, dodge, at 0 Health) and what the players are shown */
import { h, icon, swap, askCard, waitChips, visibleRect } from "./dom.mjs";

const ID = "invincible-tactics-desk";
let root = null, handleBtn = null, box = null, handlers = {}, last = null;

export function configure(x) { handlers = x ?? {}; }
const set = (patch) => handlers.set?.(patch);
const send = (req, after) => handlers.send?.(req, after);

function ensure(label) {
  if (root?.isConnected) return;
  root = h("div", { attrs: { id: ID, role: "region", "aria-label": label } });
  handleBtn = h("button.igd-handle", { fk: "handle", on: { click: () => set({ collapsed: !last?.d?.collapsed, touched: true }) } });
  box = h("section.igd");
  root.append(handleBtn, box);
  document.body.appendChild(root);
}

/* ---------- placement ---------- */
export function place() {
  if (!root) return;
  const W = window.innerWidth, H = window.innerHeight;
  const sb = visibleRect(document.getElementById("sidebar"));
  const right = sb && sb.left > W * 0.5 ? W - sb.left : 0;
  const hud = document.getElementById("invincible-challenges");
  let top = 11;
  for (const el of hud ? hud.querySelectorAll("#ich-dock, #ich-list > li") : []) { const r = visibleRect(el); if (r && r.right > W * 0.5 && r.left < W - right) top = Math.max(top, r.bottom + 8); }
  const maxTop = Math.max(11, H - 300);
  root.style.setProperty("--igd-right", `${Math.round(right)}px`);
  root.style.setProperty("--igd-top", `${Math.round(Math.min(top, maxTop))}px`);
  /* the chat box that floats at the bottom right while the sidebar is collapsed stays free: the desk ends above it and scrolls inside */
  let floor = H - 14;
  for (const el of document.querySelectorAll("#chat-notifications #chat-message, #chat-notifications textarea, #chat-notifications .chat-form")) { const r = visibleRect(el); if (r && r.top > H * 0.6 && r.right > W - right - 380) floor = Math.min(floor, r.top - 10); }
  root.style.setProperty("--igd-maxh", `${Math.round(Math.max(220, floor - Math.min(top, maxTop)))}px`);
}

/* ---------- pieces ---------- */
const val = (id, fallback) => { const v = last?.ui?.vals?.[id]; return v === undefined ? fallback : v; };
const setVal = (id, v) => handlers.val?.(id, v);
const num = (c) => {
  const cur = Number(val(c.id, c.value));
  const clamp = (n) => Math.max(c.min ?? 0, Math.min(c.max ?? 99, Math.trunc(Number(n) || 0)));
  return h("div.igd-ctl", { data: { type: "number" } }, h("span.igd-cl", { text: c.label }),
    h("span.igd-step", {}, h("button", { fk: `m:${c.id}`, tip: "-1", on: { click: () => setVal(c.id, clamp(cur - 1)) } }, icon("fa-minus")),
      h("input", { fk: `n:${c.id}`, attrs: { type: "number", min: c.min, max: c.max, value: cur, "aria-label": c.label }, on: { change: (e, el) => setVal(c.id, clamp(el.value)) } }),
      h("button", { fk: `p:${c.id}`, tip: "+1", on: { click: () => setVal(c.id, clamp(cur + 1)) } }, icon("fa-plus"))),
    h("button.igd-set", { fk: `s:${c.id}`, text: last.d.labels.set, on: { click: () => send(c.req(clamp(cur))) } }));
};
const choice = (c) => h("div.igd-ctl", { data: { type: "choice" } }, h("span.igd-cl", { text: c.label }), h("span.igd-seg", {}, c.choices.map((x) => h("button", { fk: `c:${c.id}:${x.id}`, text: x.label, attrs: { "aria-pressed": String(c.value === x.id) }, on: { click: () => send(x.req) } }))));
const select = (c, key) => h("div.igd-ctl", { data: { type: "select" } }, h("span.igd-cl", { text: c.label }),
  h("select", { fk: `sel:${key}`, attrs: { "aria-label": c.label }, on: { change: (e, el) => { const x = c.choices.find((q) => q.id === el.value); el.value = ""; if (x) send(x.req); } } }, h("option", { text: "…", attrs: { value: "" } }), c.choices.map((x) => h("option", { text: x.label, attrs: { value: x.id } }))));
const button = (c) => h(`button.igd-btn${c.danger ? ".igd-danger" : ""}`, { fk: `b:${c.id}`, text: c.label, on: { click: () => send(c.req, c.id === "manual" || c.id.startsWith("abort") ? { override: null } : undefined) } });

function override(i, L) {
  const by = (g) => i.override.filter((c) => c.group === g);
  const draw = (c) => (c.type === "number" ? num({ ...c, id: `${i.id}:${c.id}` }) : c.type === "choice" ? choice(c) : c.type === "select" ? select(c, `${i.id}:${c.id}`) : button(c));
  return h("div.igd-ovr", {}, ["dice", "result", "step", "end"].map((g) => {
    const list = by(g), extra = g === "result" && i.retarget ? [select(i.retarget, `${i.id}:retarget`)] : [];
    return list.length || extra.length ? h("fieldset.igd-og", { data: { g } }, h("legend", { text: L.groups[g] }), list.map(draw), extra) : null;
  }));
}
function inst(i, L) {
  return h(`article.igd-inst${i.child ? ".igd-child" : ""}`, { data: { locked: i.locked ? "1" : null } },
    h("header.igd-ihead", {}, h("b.igd-actor", { text: i.actor }), icon("fa-caret-right"), h("span.igd-action", { text: i.action }), i.targets.length ? [icon("fa-caret-right"), h("b.igd-target", { text: i.targets.join(", ") })] : null),
    h("div.igd-meta", {}, h("span.igd-stepchip", {}, h("span", { text: `${L.step}: ` }), h("b", { text: i.step })), i.cause ? h("span.igd-tag", { text: i.cause }) : null,
      i.outcomes.map((o) => h(`span.igd-tag${o.hit ? ".igd-hit" : ".igd-miss"}`, { text: `${o.name}: ${o.text}` }))),
    i.text ? h("blockquote.ita-quote", {}, h("span", { text: i.text })) : null,
    i.rolls.length ? h("ul.igd-rolls", {}, i.rolls.map((r) => h(`li${r.waiting ? ".igd-waiting" : ""}`, {}, icon(r.waiting ? "fa-hourglass-half" : "fa-dice"), h("b", { text: r.label }), h("span", { text: r.text }), r.chance ? h("span.igd-pct", { text: r.chance }) : null))) : null,
    h("div.igd-cmds", {}, i.commands.map((c) => (c.toggle
      ? h("button.igd-btn.igd-toggle", { fk: `ovr:${i.id}`, attrs: { "aria-expanded": String(c.on) }, on: { click: () => set({ override: c.on ? null : i.id }) } }, icon("fa-sliders"), h("span", { text: c.label }))
      : h(`button.igd-btn${c.danger ? ".igd-danger" : ""}`, { fk: `cmd:${i.id}:${c.id}`, text: c.label, on: { click: () => send(c.req) } })))),
    i.override ? override(i, L) : null);
}
function manual(m, L) {
  const put = (patch) => handlers.manual?.(m.id, patch);
  return h("article.igd-inst.igd-manual", {},
    h("header.igd-ihead", {}, h("b.igd-actor", { text: m.actor }), icon("fa-caret-right"), h("span.igd-action", { text: m.title }), m.cause ? h("span.igd-tag", { text: m.cause }) : null),
    m.text ? h("blockquote.ita-quote", {}, h("span", { text: m.text })) : null,
    h("div.igd-ctl", { data: { type: "choice" } }, h("span.igd-cl", { text: L.cost }), h("span.igd-seg", {}, m.costs.map((c) => h("button", { fk: `mc:${m.id}:${c.id}`, text: c.label, attrs: { "aria-pressed": String(c.on) }, on: { click: () => put({ cost: c.id }) } })))),
    m.damage.map((d) => h("div.igd-ctl", { data: { type: "number" } }, h("span.igd-cl", { text: `${L.damage}: ${d.name}` }), h("span.igd-step", {}, h("input", { fk: `md:${m.id}:${d.target}`, attrs: { type: "number", min: 0, max: 99, value: d.amount, "aria-label": `${L.damage}: ${d.name}` }, on: { change: (e, el) => put({ damage: { [d.target]: el.value } }) } })))),
    h("input.ita-text", { fk: `mn:${m.id}`, attrs: { type: "text", maxlength: 300, value: m.note.value, placeholder: m.note.placeholder, "aria-label": m.note.placeholder }, on: { input: (e, el) => put({ note: el.value }) } }),
    h("div.igd-cmds", {}, h("button.igd-btn.igd-primary", { fk: `mr:${m.id}`, text: m.resolve.label, on: { click: () => send(m.resolve.req) } }), h("button.igd-btn.igd-danger", { fk: `ma:${m.id}`, text: m.abort.label, on: { click: () => send(m.abort.req) } })));
}
const section = (title, n, kids) => h("section.igd-sec", {}, h("h4.igd-h", {}, h("span", { text: title }), n ? h("b.igd-n", { text: String(n) }) : null), kids);

function now(d) {
  const askH = { send: (req) => send(req), pick: handlers.pick, text: handlers.text, always: handlers.always, zone: handlers.zone, again: handlers.again };
  if (!d.cards.length && !d.stack.length && !d.manual.length) return h("p.igd-empty", {}, icon("fa-mug-hot"), h("span", { text: d.empty }));
  return [
    d.manual.length ? section(d.labels.manual, d.manual.length, d.manual.map((m) => manual(m, d.labels))) : null,
    d.stack.length ? section(d.labels.action, 0, d.stack.map((i) => inst(i, d.labels))) : null,
    d.cards.length ? section(d.labels.queue, d.cards.length, d.cards.map((c) => askCard(c, askH))) : null,
  ];
}
function journal(d) {
  if (!d.journal.length) return h("p.igd-empty", {}, icon("fa-book-open"), h("span", { text: d.journalEmpty }));
  return d.journal.map((r) => h("section.igd-sec", {}, h("h4.igd-h", {}, h("span", { text: r.label })),
    h("ol.igd-log", {}, r.rows.map((j) => h("li", { data: { state: j.state } }, h("span.igd-jt", { text: j.text }),
      j.undo ? h("span.igd-jc", {},
        j.undo.drift ? j.undo.drift.map((m) => h("button.igd-btn", { fk: `dr:${j.id}:${m.id}`, text: m.label, on: { click: () => send(m.req, { drift: null, undo: null }) } }))
          : [h(`button.igd-btn${j.undo.armed ? ".igd-danger" : ""}`, { fk: `un:${j.id}`, tip: j.undo.also, on: { click: () => (j.undo.armed ? send(j.undo.req, { undo: null }) : set({ undo: j.id })) } }, icon("fa-rotate-left"), h("span", { text: j.undo.armed ? handlers.label?.("undo.sure") : j.undo.label })),
            j.undo.armed && j.undo.also ? h("span.igd-also", { text: j.undo.also }) : null,
            j.undo.armed && j.undo.force ? h("button.igd-link", { fk: `uo:${j.id}`, text: j.undo.force.label, on: { click: () => handlers.forceUndo?.(j) } }) : null]) : null)))));
}
function table(d) {
  const seg = (c, key) => h("span.igd-seg", {}, c.choices.map((x) => h("button", { fk: `${key}:${x.id}`, text: x.label, attrs: { "aria-pressed": String(x.on) }, on: { click: () => !x.on && send(x.req) } })));
  const f = d.force, put = (patch) => handlers.force?.(patch);
  const pickOf = (c, key) => h("div.igd-ctl", { data: { type: "select" } }, h("span.igd-cl", { text: c.label }),
    h("select", { fk: `force:${key}`, attrs: { "aria-label": c.label }, on: { change: (e, el) => put({ [key]: el.value || null }) } }, h("option", { text: "…", attrs: { value: "", selected: !c.value } }), c.choices.map((x) => h("option", { text: x.label, attrs: { value: x.id, selected: x.id === c.value } }))));
  const numOf = (c, key) => h("div.igd-ctl", { data: { type: "number" } }, h("span.igd-cl", { text: c.label }),
    h("span.igd-step", {}, h("input", { fk: `force:${key}`, attrs: { type: "number", min: c.min, max: c.max, value: c.value, "aria-label": c.label }, on: { change: (e, el) => put({ [key]: el.value }) } })));
  /* P5: the hazard tool and the karma notes keep their drafts the same way (main.mjs) */
  const z = d.hazard, k = d.karma, hput = (patch) => handlers.hazard?.(patch), kput = (patch) => handlers.karma?.(patch);
  const sel = (c, key, to, ns, blank = true) => h("div.igd-ctl", { data: { type: "select" } }, h("span.igd-cl", { text: c.label }),
    h("select", { fk: `${ns}:${key}`, attrs: { "aria-label": c.label }, on: { change: (e, el) => to({ [key]: el.value || null }) } }, blank ? h("option", { text: "…", attrs: { value: "", selected: !c.value } }) : null, c.choices.map((x) => h("option", { text: x.label, attrs: { value: x.id, selected: x.id === c.value } }))));
  const numIn = (c, key, to, ns) => h("div.igd-ctl", { data: { type: "number" } }, h("span.igd-cl", { text: c.label }),
    h("span.igd-step", {}, h("input", { fk: `${ns}:${key}`, attrs: { type: "number", min: c.min, max: c.max, value: c.value, "aria-label": c.label }, on: { change: (e, el) => to({ [key]: el.value }) } })));
  const go = (b, key) => h("button.igd-btn", { fk: `force:${key}`, text: b.label, disabled: !!b.disabled, tip: b.disabled, on: { click: () => b.req && send(b.req, { tab: "now" }) } });
  return [
    h("div.igd-ctl", { data: { type: "choice" } }, h("span.igd-cl", { text: d.mode.label }), seg(d.mode, "mode")),
    section(f.title, 0, h("article.igd-npc", {}, pickOf(f.who, "who"), pickOf(f.from, "from"), numOf(f.distance, "distance"), numOf(f.damage, "damage"), h("div.igd-cmds", {}, go(f.push, "push"), go(f.fall, "fall")))),
    section(z.title, 0, h("article.igd-npc", {}, sel(z.kind, "kind", hput, "hz", false), h("p.igd-hint", { text: z.hint }), sel(z.where, "where", hput, "hz"), z.nums.map((n) => numIn(n, n.id, hput, "hz")), h("div.igd-cmds", {}, go(z.run, "hzrun")))),
    section(k.title, k.rows.length, h("article.igd-npc", {}, k.rows.length ? h("ul.igd-karma", {}, k.rows.map((r) => h("li", {}, h("b", { text: r.kind }), h("span", { text: [r.who, r.round].filter(Boolean).join(", ") }), r.note ? h("q", { text: r.note }) : null))) : h("p.igd-hint", { text: k.empty }),
      sel(k.kind, "kind", kput, "karma", false), sel(k.who, "who", kput, "karma"), h("input.ita-text", { fk: "karma:note", attrs: { type: "text", maxlength: 200, value: k.note.value, placeholder: k.note.placeholder, "aria-label": k.note.placeholder }, on: { input: (e, el) => kput({ note: el.value }) } }),
      h("div.igd-cmds", {}, h("button.igd-btn", { fk: "karma:add", text: k.add.label, disabled: !!k.add.disabled, tip: k.add.disabled, on: { click: () => { if (k.add.req) { send(k.add.req); kput({ note: "" }); } } } })))),
    section(d.npcsTitle, 0, d.npcs.length ? d.npcs.map((n) => h("article.igd-npc", {}, h("b.igd-actor", { text: n.name }), n.note ? h("p.igd-tip", {}, icon("fa-person-running"), h("span", { text: n.note })) : null,
      n.policy.map((p) => h("div.igd-ctl", { data: { type: "choice" } }, h("span.igd-cl", { text: p.label }), seg(p, `pol:${n.id}:${p.id}`))),
      h("div.igd-ctl", { data: { type: "choice" } }, h("span.igd-cl", { text: d.labels.reveal }), h("span.igd-seg.igd-multi", {}, n.reveal.map((r) => h("button", { fk: `rv:${n.id}:${r.id}`, attrs: { "aria-pressed": String(r.on) }, on: { click: () => send(r.req) } }, icon(r.on ? "fa-eye" : "fa-eye-slash"), h("span", { text: r.label }))))))) : h("p.igd-empty", {}, h("span", { text: d.npcsEmpty }))),
  ];
}

/* ---------- the Abilities tab (P6): every item of one sheet with its state (automated, confirmed by the GM, by hand); a row opens to the GM's
   settings for it: out of this fight, which book entry it is, what it is about; and who summoned the chosen character ---------- */
function kitTab(k) {
  const put = (patch) => handlers.kit?.(patch);
  const seg = (c, key) => h("span.igd-seg", {}, c.choices.map((x) => h("button", { fk: `${key}:${x.id}`, text: x.label, attrs: { "aria-pressed": String(x.on) }, on: { click: () => !x.on && send(x.req) } })));
  const pick = (c, key, onChange, blank = "…") => h("div.igd-ctl", { data: { type: "select" } }, h("span.igd-cl", { text: c.label }),
    h("select", { fk: key, attrs: { "aria-label": c.label }, on: { change: (e, el) => onChange(el.value || null) } }, h("option", { text: blank, attrs: { value: "", selected: !c.value } }), c.choices.map((x) => h("option", { text: x.label, attrs: { value: x.id, selected: x.id === c.value } }))));
  return [
    h("article.igd-npc", {}, pick(k.who, "kit:who", (v) => put({ who: v, open: null })), k.summon ? pick(k.summon, "kit:summon", (v) => send(k.summon.req(v)), k.summon.none) : null, k.counts ? h("p.igd-hint.igd-kit-sum", { text: k.counts }) : null),
    k.empty ? h("p.igd-hint", { text: k.empty }) : null,
    k.groups.map((g) => section(g.label, g.rows.length, h("div.igd-kitlist", {}, g.rows.map((r) => h("article.igd-kit", { data: { state: r.state, open: r.open ? "1" : null } },
      h("button.igd-kit-head", { fk: `kit:row:${r.id}`, attrs: { "aria-expanded": String(!!r.open), "aria-label": [r.name, r.stateText].join(", ") }, on: { click: () => put({ open: r.open ? null : r.id }) } },
        h("span.igd-kit-name", {}, h("b", { text: r.name }), r.sub || r.cat ? h("small", { text: [r.cat, r.sub].filter(Boolean).join(", ") }) : null), h("span.igd-kit-state", { text: r.stateText, data: { state: r.state } })),
      r.open ? [r.note ? h("p.igd-hint", { text: r.note }) : null,
        r.map ? pick(r.map, `kit:map:${r.id}`, (v) => send(r.map.req(v))) : null,
        r.types ? h("div.igd-ctl", { data: { type: "text" } }, h("span.igd-cl", { text: r.types.label }), h("input.ita-text", { fk: `kit:ty:${r.id}`, attrs: { type: "text", maxlength: 120, value: r.types.value, "aria-label": r.types.label }, on: { change: (e, el) => send(r.types.req(el.value)) } })) : null,
        r.alt ? h("div.igd-ctl", { data: { type: "choice" } }, h("span.igd-cl", { text: r.alt.label }), seg(r.alt, `kit:alt:${r.id}`)) : null,
        h("div.igd-ctl", { data: { type: "choice" } }, h("span.igd-cl", { text: r.off.label }), seg(r.off, `kit:off:${r.id}`))] : null))))),
  ];
}
/* ---------- the Scene tab (P7): the chase, the vehicles, the challenges (ui/scene-pure.mjs) ---------- */
function scene(s) {
  const put = (patch) => handlers.scene?.(patch);
  const tags = (list) => (list.length ? h("div.igd-meta", {}, list.map((x) => h(`span.igd-tag${x.tone === "hit" ? ".igd-hit" : x.tone === "miss" ? ".igd-miss" : ""}`, { text: x.text }))) : null);
  const note = (text) => (text ? h("p.igd-note", { text }) : null);
  const go = (b, key, cls = "") => h(`button.igd-btn${cls}`, { fk: key, text: b.label, disabled: !!b.disabled, tip: b.disabled, on: { click: () => b.req && send(b.req) } });
  const segSend = (c, key) => h("span.igd-seg", {}, c.choices.map((x) => h("button", { fk: `${key}:${x.id}`, text: x.label, attrs: { "aria-pressed": String(x.on) }, on: { click: () => !x.on && send(x.req) } })));
  const c = s.chase;
  const chase = c.on ? h("article.igd-npc", {},
    h("div.igd-chase", {}, h("b.igd-big", { text: c.headline }), h("span.igd-note", { text: `${c.round} \u00b7 ${c.lost}` })),
    c.state ? tags([c.state]) : null,
    c.sides.map((x) => h("div.igd-ctl", {}, h("span.igd-cl", { text: x.label }), h("b.igd-names", { text: x.units.map((u) => u.name).join(", ") }))),
    c.last ? note(c.last.join(" \u00b7 ")) : null,
    c.crew.length ? h("div.igd-ctl", {}, h("span.igd-cl", { text: c.crewLabel }), h("span.igd-cmds", {}, c.crew.map((x) => h("button.igd-btn", { fk: `crew:${x.id}`, text: x.name, tip: x.tip, on: { click: () => handlers.act?.(x.id) } })))) : null,
    num(c.distance),
    h("div.igd-ctl", { data: { type: "choice" } }, h("span.igd-cl", { text: c.obstacles.label }), segSend(c.obstacles, "chase:obs")),
    h("div.igd-cmds", {}, go(c.roll, "chase:roll", ".igd-primary"), c.end.map((b) => go(b, `chase:end:${b.id}`))))
    : h("article.igd-npc", {}, note(c.hint),
      c.none ? note(c.none) : c.units.map((u) => h("div.igd-ctl", { data: { type: "choice" } }, h("span.igd-cl", { text: u.name }),
        h("span.igd-seg", {}, u.choices.map((x) => h("button", { fk: `side:${u.id}:${x.id}`, text: x.label, attrs: { "aria-pressed": String(x.on) }, on: { click: () => put({ side: { [u.id]: x.side } }) } }))))),
      h("div.igd-ctl", { data: { type: "number" } }, h("span.igd-cl", { text: c.distance.label }), h("span.igd-step", {}, h("input", { fk: "chase:d0", attrs: { type: "number", min: c.distance.min, max: c.distance.max, value: c.distance.value, "aria-label": c.distance.label }, on: { change: (e, el) => put({ distance: el.value }) } }))),
      h("div.igd-ctl", { data: { type: "choice" } }, h("span.igd-cl", { text: c.obstacles.label }), h("span.igd-seg", {}, c.obstacles.choices.map((x) => h("button", { fk: `obs0:${x.id}`, text: x.label, attrs: { "aria-pressed": String(x.on) }, on: { click: () => put({ obstacles: x.value }) } })))),
      h("div.igd-cmds", {}, go(c.start, "chase:start", ".igd-primary"), c.start.disabled ? h("span.igd-note", { text: c.start.disabled }) : null));
  const pickOf = (p, selected) => h("div.igd-ctl", { data: { type: "select" } }, h("span.igd-cl", { text: p.label }),
    h("select", { fk: `sel:${p.id}`, attrs: { "aria-label": p.label }, on: { change: (e, el) => { const x = p.choices.find((q) => q.id === el.value); if (!selected) el.value = ""; if (x) send(x.req); } } },
      selected ? null : h("option", { text: "\u2026", attrs: { value: "" } }), p.choices.map((x) => h("option", { text: x.label, attrs: { value: x.id, selected: selected && x.id === p.value } }))));
  const vehicle = (v) => h("article.igd-npc", {}, h("b.igd-actor", { text: v.name }), tags(v.tags), note(v.stats.join(" \u00b7 ")),
    v.seats.map((x) => h("div.igd-ctl", {}, h("span.igd-cl", {}, h("b.igd-names", { text: x.name }), h("span.igd-note", { text: ` ${x.role}` })),
      h("span.igd-cmds", {}, x.swap ? go(x.swap, `wheel:${v.id}:${x.id}`) : null, go(x.out, `out:${v.id}:${x.id}`)))),
    note(v.empty), v.board ? pickOf(v.board, false) : null,
    h("div.igd-ctl", { data: { type: "choice" } }, h("span.igd-cl", { text: v.flags.label }), h("span.igd-seg.igd-multi", {}, v.flags.items.map((x) => h("button", { fk: `vf:${v.id}:${x.id}`, text: x.label, attrs: { "aria-pressed": String(x.on) }, on: { click: () => send(x.req) } })))));
  const task = (x) => h("article.igd-npc", {}, h("b.igd-actor", { text: x.name }), x.tag ? tags([x.tag]) : null, note(x.stats.join(" \u00b7 ")), pickOf(x.preset, true),
    x.objectives.length ? note(x.objectives.join(" \u00b7 ")) : null, x.manual ? h("p.igd-note", {}, h("span", { text: `${x.manual.label}: ` }), h("b", { text: x.manual.items.join(", ") })) : null, note(x.hint));
  return [
    section(c.title, 0, chase),
    section(s.vehicles.title, s.vehicles.items.length, s.vehicles.items.length ? s.vehicles.items.map(vehicle) : h("p.igd-empty", {}, h("span", { text: s.vehicles.empty }))),
    section(s.challenges.title, s.challenges.items.length, s.challenges.items.length ? s.challenges.items.map(task) : h("p.igd-empty", {}, h("span", { text: s.challenges.empty }))),
  ];
}

/* ---------- render ---------- */
export function render(d, ui = {}) {
  try { draw(d, ui); } catch (e) { console.warn("invincible-plus-ultra | tactics desk", e); }
}
function draw(d, ui) {
  last = { d, ui };
  if (!d?.show) return destroy();
  ensure(d.title);
  root.classList.toggle("igd-collapsed", !!d.collapsed);
  root.classList.toggle("igd-busy", d.count > 0);
  swap(handleBtn, [icon(d.collapsed ? "fa-inbox" : "fa-chevron-right"), d.collapsed ? h("span.igd-hl", { text: d.title }) : null, d.count ? h("b.igd-badge", { text: String(d.count) }) : null]);
  handleBtn.dataset.tooltip = d.collapsed ? d.labels.expand : d.labels.collapse;
  handleBtn.setAttribute("aria-label", d.collapsed ? d.labels.expand : d.labels.collapse);
  handleBtn.setAttribute("aria-expanded", String(!d.collapsed));
  swap(box, d.collapsed ? [] : [
    h("header.igd-head", {}, h("h2.ita-plate.igd-title", { text: d.title }), h("span.igd-turn", { text: d.turn })),
    d.turnNote ? h("p.igd-tip", { attrs: { role: "note" } }, icon("fa-person-running"), h("span", { text: d.turnNote })) : null,
    h("nav.igd-tabs", { attrs: { role: "tablist" } }, d.tabs.map((t) => h("button", { fk: `tab:${t.id}`, attrs: { role: "tab", "aria-selected": String(d.tab === t.id) }, on: { click: () => set({ tab: t.id }) } }, h("span", { text: t.label }), t.n ? h("b.igd-badge", { text: String(t.n) }) : null))),
    h("div.igd-wait", { attrs: { role: "status" } }, h("span.igd-k", { text: d.waitingLabel }), d.waiting.length ? waitChips(d.waiting) : h("span.igd-nobody", { text: d.nobody })),
    h("div.igd-body", { data: { keepScroll: d.tab }, attrs: { role: "tabpanel" } }, d.tab === "journal" ? journal(d) : d.tab === "table" ? table(d) : d.tab === "scene" && d.scene ? scene(d.scene) : d.tab === "kit" && d.kit ? kitTab(d.kit) : now(d)),
  ]);
  place();
}
export const relayout = () => { if (root) place(); };
export const el = () => root;
export function destroy() { root?.remove(); root = handleBtn = box = null; }
